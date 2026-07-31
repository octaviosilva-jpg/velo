'use strict';

/**
 * Orquestrador Motor-first da Chance de Moderação (Fase 6, A1–A16).
 * Contrato OpenAI: 2 chamadas (fluxo padrão) ou 4 (fluxo completo) — ver contratoChamadasOpenAI.js
 */

const motorPontuacao = require('../motor-pontuacao');
const { carregarPerfil, PERFIL_PADRAO } = require('../motor-pontuacao/perfil');
const motorIntegracao = require('../motor-pontuacao/integracao');

const { extrator } = require('./extrator');
const { auditora } = require('./auditora');
const { reformulador } = require('./reformulador');
const { comparador } = require('./comparador');
const { montarResultadoFinal } = require('./montarResultadoFinal');
const { serializarMotor } = require('./serializarMotor');
const { montarVersions } = require('./montarVersions');
const { validarContrato } = require('./contratoChamadasOpenAI');
const { CHANCE_LIMIAR_REFORMULACAO, PERFIL_PADRAO: PERFIL_DEFAULT } = require('./constants');

function executarMotor(extracaoNorm, ctx) {
    const auditoria = { ...extracaoNorm.auditoriaPlana };
    auditoria.estados = auditoria.estados || {};
    auditoria.estados.calibracao_historica = motorIntegracao.derivarCalibracaoHistorica(ctx.qtdCasosHistoricos);
    return motorPontuacao.analisarChance(auditoria, { perfilVersao: ctx.perfilVersao });
}

function acumularTelemetria(state, chamada) {
    state.chamadas.push(chamada);
    state.openaiCallCount += 1;
    if (chamada.tokens) {
        state.promptTokens += chamada.tokens.prompt_tokens || 0;
        state.completionTokens += chamada.tokens.completion_tokens || 0;
    }
    state.custoEstimadoTotal += chamada.custoEstimado || 0;
}

function montarMetadadosMotor(resultadoMotor, norm) {
    if (!resultadoMotor?.sucesso) return null;
    return {
        ...resultadoMotor.metadados,
        chance_final: resultadoMotor.chance_final,
        faixa_final: resultadoMotor.faixa_final,
        validador_status: resultadoMotor.validador?.status,
        fundamentos: norm?.fundamentos || null,
        mapa_reclamacao: norm?.mapa_reclamacao || null
    };
}

function resolverNomes(respostaPublica, reclamacao, userData, deps) {
    const nomes = deps.extrairNomesDaRespostaPublica?.(respostaPublica) || {};
    let nomeCliente = nomes.nomeCliente;
    let nomeAgente = nomes.nomeAgente;
    if (!nomeCliente?.trim()) {
        nomeCliente = deps.extrairNomeCliente?.(reclamacao) || 'Cliente';
    }
    if (!nomeAgente?.trim()) {
        nomeAgente = deps.obterPrimeiroNomeUsuario?.(userData) || 'Agente';
    }
    return { nomeCliente, nomeAgente };
}

function tratarErroOpenai(err) {
    if (err.status) {
        return {
            sucesso: false,
            codigoErro: 'openai',
            statusCode: err.status,
            erro: err.message,
            openaiDetails: { success: false, error: err.message, statusCode: err.status }
        };
    }
    return {
        sucesso: false,
        erro: err.message || String(err),
        codigoErro: err.codigo || 'interno'
    };
}

/**
 * Pipeline principal — substitui executarChanceModeracao V7.
 */
async function runChanceModeracaoPipeline(input = {}, deps = {}) {
    const t0 = Date.now();
    const telemetriaState = {
        openaiCallCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        custoEstimadoTotal: 0,
        chamadas: []
    };

    const telemetriaBase = (extras = {}) => ({
        openaiCallCount: telemetriaState.openaiCallCount,
        promptTokens: telemetriaState.promptTokens,
        completionTokens: telemetriaState.completionTokens,
        duracaoMs: Date.now() - t0,
        custoEstimadoTotal: Number(telemetriaState.custoEstimadoTotal.toFixed(6)),
        chamadas: telemetriaState.chamadas,
        ...extras
    });

    const {
        reclamacaoCompleta,
        respostaPublica,
        solucaoImplementada = '',
        consideracaoFinal = '',
        historicoModeracao = '',
        userData = null
    } = input;

    if (!reclamacaoCompleta || !respostaPublica) {
        return {
            sucesso: false,
            erro: 'validacao',
            result: null,
            motor: null,
            telemetria: telemetriaBase()
        };
    }

    if (!deps.apiKey) {
        return {
            sucesso: false,
            erro: 'Chave da API OpenAI não configurada',
            codigoErro: 'api_key',
            result: null,
            motor: null,
            telemetria: telemetriaBase()
        };
    }

    const perfilVersao = PERFIL_PADRAO || PERFIL_DEFAULT;
    const perfil = carregarPerfil(perfilVersao);
    const instrucaoEstados = motorIntegracao.montarInstrucaoEstados(perfil);
    const limiar = perfil.regra_sem_reformulacao?.chance_minima ?? CHANCE_LIMIAR_REFORMULACAO;

    const stepDeps = {
        ...deps,
        perfil,
        instrucaoEstados,
        montarInstrucaoEstados: motorIntegracao.montarInstrucaoEstados
    };

    try {
        const casosHistoricos = await deps.carregarModeracoesAprovadasSimilares?.(
            `${reclamacaoCompleta} ${respostaPublica}`,
            5
        ) || [];

        const baseNormativa = deps.montarBlocoChanceModeracao?.(
            `${reclamacaoCompleta} ${respostaPublica} ${consideracaoFinal}`,
            ''
        ) || '';
        const baseCalibracaoHistorica = deps.montarBlocoCalibracaoHistorica?.(casosHistoricos) || '';

        const ctxMotor = { perfilVersao, qtdCasosHistoricos: casosHistoricos.length };

        // A — Extrator + Motor #1
        const outExt1 = await extrator({
            reclamacao: reclamacaoCompleta,
            respostaPublica,
            consideracaoFinal,
            invocacao: 1
        }, stepDeps);
        acumularTelemetria(telemetriaState, outExt1.telemetriaChamada);

        const motor1 = executarMotor(outExt1.extracao, ctxMotor);
        if (!motor1.sucesso) {
            return {
                sucesso: false,
                erro: 'Motor #1: contrato inválido',
                codigoErro: 'motor_contrato',
                result: null,
                motor: null,
                telemetria: telemetriaBase()
            };
        }

        const motorSerializado = serializarMotor(motor1, perfil, {
            fundamentos: outExt1.extracao.fundamentos,
            mapa_reclamacao: outExt1.extracao.mapa_reclamacao
        });

        // C — Auditora Técnica
        const outAud = await auditora({
            reclamacao: reclamacaoCompleta,
            respostaPublica,
            solucaoImplementada,
            consideracaoFinal,
            historicoModeracao,
            baseNormativa,
            baseCalibracaoHistorica,
            extracao: outExt1.extracao,
            resultadoMotor: motor1,
            motorSerializado
        }, stepDeps);
        acumularTelemetria(telemetriaState, outAud.telemetriaChamada);

        const fluxoCompleto = motor1.chance_final < limiar;
        let respostaReformulada = null;
        let motor2 = null;
        let motorReformulado = null;
        let comparacaoOut = null;
        let respostaSugerida = respostaPublica;
        let reformulacaoAprovada = null;
        let avisoRegressao = null;
        let deltaPorCriterio = null;
        let oportunidadesMelhoria = outAud.oportunidadesMelhoria;

        if (fluxoCompleto) {
            // D — Reformulador
            const outRef = await reformulador({
                respostaPublica,
                oportunidadesMelhoria: outAud.oportunidadesMelhoria
            }, stepDeps);
            acumularTelemetria(telemetriaState, outRef.telemetriaChamada);

            const { nomeCliente, nomeAgente } = resolverNomes(respostaPublica, reclamacaoCompleta, userData, deps);
            respostaReformulada = deps.formatarRespostaRA?.(
                outRef.mioloReformulado,
                nomeCliente,
                nomeAgente,
                userData
            ) || outRef.mioloReformulado;

            // E — Extrator reuso + Motor #2 + Comparador
            const outExt2 = await extrator({
                reclamacao: reclamacaoCompleta,
                respostaPublica: respostaReformulada,
                consideracaoFinal,
                invocacao: 2
            }, stepDeps);
            acumularTelemetria(telemetriaState, outExt2.telemetriaChamada);

            motor2 = executarMotor(outExt2.extracao, ctxMotor);
            if (!motor2.sucesso) {
                return {
                    sucesso: false,
                    erro: 'Motor #2: contrato inválido',
                    codigoErro: 'motor_contrato',
                    result: null,
                    motor: montarMetadadosMotor(motor1, outExt1.extracao),
                    telemetria: telemetriaBase({ fluxo: 'completo' })
                };
            }

            motorReformulado = montarMetadadosMotor(motor2, outExt2.extracao);

            comparacaoOut = comparador({
                resultadoMotor1: motor1,
                resultadoMotor2: motor2,
                extracao1: outExt1.extracao,
                extracao2: outExt2.extracao,
                respostaOriginal: respostaPublica,
                respostaReformulada
            });

            respostaSugerida = comparacaoOut.respostaSugerida;
            reformulacaoAprovada = comparacaoOut.reformulacaoAprovada;
            avisoRegressao = comparacaoOut.avisoRegressao;
            deltaPorCriterio = comparacaoOut.deltaPorCriterio;
        }

        const fluxo = fluxoCompleto ? 'completo' : 'padrao';
        const resultRaw = montarResultadoFinal({
            relatorio: outAud.relatorio,
            respostaReformulada,
            secao14: comparacaoOut?.secao14 || null,
            fluxoCompleto
        });

        const result = deps.humanizarPontuacaoGerada?.(resultRaw) ?? resultRaw;
        const versions = montarVersions(fluxo, perfilVersao);

        const contratoCheck = validarContrato({
            fluxo,
            openaiCallCount: telemetriaState.openaiCallCount,
            chamadas: telemetriaState.chamadas
        });
        if (!contratoCheck.atendido) {
            console.warn('[chance/runner] contrato OpenAI violado:', contratoCheck.violacoes.join('; '));
        }

        const telemetria = telemetriaBase({
            fluxo,
            contrato: {
                esperado: contratoCheck.esperado,
                atendido: contratoCheck.atendido,
                contratoViolado: !contratoCheck.atendido,
                violacoes: contratoCheck.violacoes
            },
            versions
        });

        return {
            sucesso: true,
            result,
            respostaOriginal: respostaPublica,
            respostaReformulada,
            respostaSugerida,
            respostaRevisada: respostaReformulada,
            reformulacaoAprovada,
            avisoRegressao,
            motor: montarMetadadosMotor(motor1, outExt1.extracao),
            motorReformulado,
            comparacao: comparacaoOut?.comparacao || {
                executada: false,
                original: motor1.chance_final,
                reformulada: null,
                delta: null,
                faixaOriginal: motor1.faixa_final,
                faixaReformulada: null,
                reformulacaoAprovada: null
            },
            deltaPorCriterio,
            oportunidadesMelhoria,
            versions,
            telemetria
        };
    } catch (err) {
        console.error('[chance/runner] erro:', err);
        const out = tratarErroOpenai(err);
        return {
            ...out,
            result: null,
            motor: null,
            telemetria: telemetriaBase()
        };
    }
}

module.exports = { runChanceModeracaoPipeline };
