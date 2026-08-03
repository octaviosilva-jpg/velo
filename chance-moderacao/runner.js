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
const {
    CHANCE_LIMIAR_REFORMULACAO,
    PERFIL_PADRAO: PERFIL_DEFAULT,
    PROMPT_EXTRATOR_VERSION,
    PROMPT_AUDITORA_VERSION,
    PROMPT_REFORMULADOR_VERSION
} = require('./constants');
const { isChanceDebugEnabled, montarDebugAuditora } = require('./debug');

function executarMotor(extracaoNorm, ctx) {
    const auditoria = { ...extracaoNorm.auditoriaPlana };
    auditoria.estados = auditoria.estados || {};
    auditoria.estados.calibracao_historica = motorIntegracao.derivarCalibracaoHistorica(ctx.qtdCasosHistoricos);
    return motorPontuacao.analisarChance(auditoria, { perfilVersao: ctx.perfilVersao });
}

function registrarEtapa(telemetriaState, registro) {
    telemetriaState.fluxoExecutado.push(registro.fluxoId || registro.etapa);
    telemetriaState.etapas.push(registro);
}

function acumularTelemetriaOpenai(state, chamada) {
    state.openaiCallCount += 1;
    state.chamadas.push(chamada);
    if (chamada.tokens) {
        state.promptTokens += chamada.tokens.prompt_tokens || 0;
        state.completionTokens += chamada.tokens.completion_tokens || 0;
    }
    state.custoEstimadoTotal += chamada.custoEstimado || 0;
}

function etapaFromLlmChamada(fluxoId, chamada, extras = {}) {
    const pt = chamada.tokens?.prompt_tokens || 0;
    const ct = chamada.tokens?.completion_tokens || 0;
    return {
        etapa: chamada.etapa,
        fluxoId,
        duracaoMs: chamada.duracaoMs || 0,
        modelo: chamada.model || null,
        promptTokens: pt,
        completionTokens: ct,
        totalTokens: pt + ct,
        invocacao: chamada.invocacao || 1,
        schemaVersion: chamada.schemaVersion || chamada.promptVersion || null,
        tentativas: chamada.tentativas || undefined,
        ...extras
    };
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
        chamadas: [],
        fluxoExecutado: [],
        etapas: []
    };

    const telemetriaBase = (extras = {}) => ({
        openaiCallCount: telemetriaState.openaiCallCount,
        promptTokens: telemetriaState.promptTokens,
        completionTokens: telemetriaState.completionTokens,
        duracaoMs: Date.now() - t0,
        custoEstimadoTotal: Number(telemetriaState.custoEstimadoTotal.toFixed(6)),
        chamadas: telemetriaState.chamadas,
        fluxoExecutado: telemetriaState.fluxoExecutado,
        etapas: telemetriaState.etapas,
        ...extras
    });

    const {
        reclamacaoCompleta,
        respostaPublica,
        solucaoImplementada = '',
        consideracaoFinal = '',
        historicoModeracao = '',
        userData = null,
        debug: inputDebug = false
    } = input;

    const debug = isChanceDebugEnabled(deps.envVars || {}, inputDebug || deps.debug);

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
        debug,
        perfil,
        instrucaoEstados,
        montarInstrucaoEstados: motorIntegracao.montarInstrucaoEstados
    };

    try {
        const tSheets = Date.now();
        const casosHistoricos = await deps.carregarModeracoesAprovadasSimilares?.(
            `${reclamacaoCompleta} ${respostaPublica}`,
            5
        ) || [];
        registrarEtapa(telemetriaState, {
            etapa: 'sheets_calibracao',
            fluxoId: 'sheets_calibracao',
            duracaoMs: Date.now() - tSheets,
            modelo: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            invocacao: 1,
            schemaVersion: null
        });

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
        acumularTelemetriaOpenai(telemetriaState, outExt1.telemetriaChamada);
        registrarEtapa(telemetriaState, etapaFromLlmChamada('extrator-1', {
            ...outExt1.telemetriaChamada,
            schemaVersion: PROMPT_EXTRATOR_VERSION
        }));

        const tMot1 = Date.now();
        const motor1 = executarMotor(outExt1.extracao, ctxMotor);
        registrarEtapa(telemetriaState, {
            etapa: 'motor',
            fluxoId: 'motor-1',
            duracaoMs: Date.now() - tMot1,
            modelo: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            invocacao: 1,
            schemaVersion: `motor-${motor1.metadados?.motor_version || 'v1'}`
        });

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
        acumularTelemetriaOpenai(telemetriaState, outAud.telemetriaChamada);
        registrarEtapa(telemetriaState, etapaFromLlmChamada('auditora', {
            ...outAud.telemetriaChamada,
            schemaVersion: PROMPT_AUDITORA_VERSION
        }, { tentativas: outAud.tentativas || outAud.telemetriaChamada?.tentativas }));

        const debugAuditora = debug ? montarDebugAuditora(outAud, perfil) : null;

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

        if (fluxoCompleto && oportunidadesMelhoria?.itens?.length > 0) {
            const outRef = await reformulador({
                respostaPublica,
                oportunidadesMelhoria: outAud.oportunidadesMelhoria
            }, stepDeps);
            acumularTelemetriaOpenai(telemetriaState, outRef.telemetriaChamada);
            registrarEtapa(telemetriaState, etapaFromLlmChamada('reformulador', {
                ...outRef.telemetriaChamada,
                schemaVersion: PROMPT_REFORMULADOR_VERSION
            }));

            // Saudação fixa: nunca inferir nome do cliente (Olá, cliente!).
            const nomeAgente = deps.obterPrimeiroNomeUsuario?.(userData) || 'Agente';
            respostaReformulada = deps.formatarRespostaRA?.(
                outRef.mioloReformulado,
                null,
                nomeAgente,
                userData
            ) || outRef.mioloReformulado;

            const outExt2 = await extrator({
                reclamacao: reclamacaoCompleta,
                respostaPublica: respostaReformulada,
                consideracaoFinal,
                invocacao: 2
            }, stepDeps);
            acumularTelemetriaOpenai(telemetriaState, outExt2.telemetriaChamada);
            registrarEtapa(telemetriaState, etapaFromLlmChamada('extrator-2', {
                ...outExt2.telemetriaChamada,
                schemaVersion: PROMPT_EXTRATOR_VERSION
            }));

            const tMot2 = Date.now();
            motor2 = executarMotor(outExt2.extracao, ctxMotor);
            registrarEtapa(telemetriaState, {
                etapa: 'motor',
                fluxoId: 'motor-2',
                duracaoMs: Date.now() - tMot2,
                modelo: null,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                invocacao: 2,
                schemaVersion: `motor-${motor2.metadados?.motor_version || 'v1'}`
            });

            if (!motor2.sucesso) {
                return {
                    sucesso: false,
                    erro: 'Motor #2: contrato inválido',
                    codigoErro: 'motor_contrato',
                    result: null,
                    motor: montarMetadadosMotor(motor1, outExt1.extracao),
                    debugAuditora,
                    telemetria: telemetriaBase({ fluxo: 'completo' })
                };
            }

            motorReformulado = montarMetadadosMotor(motor2, outExt2.extracao);

            const tCmp = Date.now();
            comparacaoOut = comparador({
                resultadoMotor1: motor1,
                resultadoMotor2: motor2,
                extracao1: outExt1.extracao,
                extracao2: outExt2.extracao,
                respostaOriginal: respostaPublica,
                respostaReformulada
            });
            registrarEtapa(telemetriaState, {
                etapa: 'comparador',
                fluxoId: 'comparador',
                duracaoMs: Date.now() - tCmp,
                modelo: null,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                invocacao: 1,
                schemaVersion: null
            });

            respostaSugerida = comparacaoOut.respostaSugerida;
            reformulacaoAprovada = comparacaoOut.reformulacaoAprovada;
            avisoRegressao = comparacaoOut.avisoRegressao;
            deltaPorCriterio = comparacaoOut.deltaPorCriterio;
        }

        // Sem reformulação (limiar ou DTO vazio) → fluxo padrao no contrato A13 (2 OpenAI).
        const fluxoFinal = respostaReformulada ? 'completo' : 'padrao';

        const tMontar = Date.now();
        const resultRaw = montarResultadoFinal({
            relatorio: outAud.relatorio,
            respostaReformulada,
            secao14: comparacaoOut?.secao14 || null,
            fluxoCompleto: !!respostaReformulada
        });
        registrarEtapa(telemetriaState, {
            etapa: 'montar_resultado_final',
            fluxoId: 'montar_resultado_final',
            duracaoMs: Date.now() - tMontar,
            modelo: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            invocacao: 1,
            schemaVersion: null
        });

        const result = deps.humanizarPontuacaoGerada?.(resultRaw) ?? resultRaw;
        const versions = montarVersions(fluxoFinal, perfilVersao);

        const contratoCheck = validarContrato({
            fluxo: fluxoFinal,
            openaiCallCount: telemetriaState.openaiCallCount,
            chamadas: telemetriaState.chamadas
        });
        // Fluxo completo sem reformulação (DTO vazio): 2 chamadas — contrato padrao
        if (!contratoCheck.atendido && fluxoCompleto && !respostaReformulada) {
            const checkPadrao = validarContrato({
                fluxo: 'padrao',
                openaiCallCount: telemetriaState.openaiCallCount,
                chamadas: telemetriaState.chamadas
            });
            if (checkPadrao.atendido) {
                Object.assign(contratoCheck, checkPadrao, { atendido: true, violacoes: [] });
            }
        }
        if (!contratoCheck.atendido) {
            console.warn('[chance/runner] contrato OpenAI violado:', contratoCheck.violacoes.join('; '));
        }

        const telemetria = telemetriaBase({
            fluxo: fluxoFinal,
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
            debugAuditora,
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
