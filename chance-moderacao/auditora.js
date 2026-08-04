'use strict';

const { DEFAULTS, resolverModelo, PROMPT_AUDITORA_VERSION } = require('./constants');
const { montarPromptAuditora } = require('./promptAuditora');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');
const { validarSaidaAuditora } = require('./validarSaidaAuditora');
const { separarRelatorioEOportunidades, parseOportunidadesMelhoria } = require('./parseOportunidadesMelhoria');
const { validarOportunidadesMelhoria } = require('./validarOportunidadesMelhoria');
const { montarRelatorioFallbackAuditora, montarOportunidadesFallback } = require('./montarRelatorioFallback');

const MAX_TENTATIVAS = 3;

const REGEX_CAMPOS_ILEGIVEIS = /campos obrigatórios ausentes ou ilegíveis em/i;

const ORIENTACAO_FORMATO_JUSTIFICATIVA =
    ' Os campos internos da Justificativa não foram reconhecidos. Em cada ### critério, use exatamente o formato `Label: valor`, um campo por linha, sem bullets ou numeração antes dos labels. Todos os 7 campos são obrigatórios: Classificação, Pontuação, Trecho da reclamação, Trecho da resposta, Justificativa técnica, O que reduziu a pontuação, Como aumentar a pontuação.';

function montarInstrucaoCorrecaoRetry(ultimoErro, proximaTentativa) {
    let msg = `\n\nCORREÇÃO OBRIGATÓRIA (tentativa ${proximaTentativa}): ${ultimoErro}. Inclua todas as seções H2 na ordem A10, bloco ${'<!-- OPORTUNIDADES_MELHORIA_JSON -->'} com schema oportunidades-v1, e use ### [Nome do critério] para cada critério do Motor. Percentual só na seção "Resultado Oficial do Motor" citando o valor oficial.`;
    if (REGEX_CAMPOS_ILEGIVEIS.test(ultimoErro)) {
        msg += ORIENTACAO_FORMATO_JUSTIFICATIVA;
    }
    return msg;
}

/**
 * Auditora Técnica LLM — interpreta resultado oficial do Motor (seções 1–12 + DTO A16).
 */
async function auditora(entrada, deps = {}) {
    validarEntradaEtapa('auditora', entrada, deps.strictContratos ? { strict: true } : {});

    const openaiStep = deps.openaiStep || require('../resposta-pipeline/openaiStep').openaiStep;
    const envVars = deps.envVars || {};
    const model = resolverModelo(envVars, 'CHANCE_AUDITORA_MODEL', 'gpt-4o');
    const perfil = deps.perfil;
    const debug = !!deps.debug;

    const prompt = montarPromptAuditora(entrada);
    let ultimoErro = null;
    let ultimaResp = null;
    const errosPorTentativa = [];
    const tentativasMeta = [];
    const t0Auditora = Date.now();
    let promptTokensTotal = 0;
    let completionTokensTotal = 0;
    let custoTotal = 0;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        console.log(`[chance/auditora] tentativa=${tentativa} model=${model}`);
        const tTent = Date.now();

        const resp = await openaiStep({
            apiKey: deps.apiKey,
            model,
            temperature: 0.2,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ],
            maxTokens: 6000,
            timeoutMs: deps.timeoutMs || DEFAULTS.openaiTimeoutMs
        });

        ultimaResp = resp;
        if (resp.usage) {
            promptTokensTotal += resp.usage.prompt_tokens || 0;
            completionTokensTotal += resp.usage.completion_tokens || 0;
        }
        custoTotal += resp.custoEstimado || 0;

        const { relatorio } = separarRelatorioEOportunidades(resp.conteudo);
        const validacaoMarkdown = validarSaidaAuditora(relatorio, perfil);
        const oportunidadesMelhoria = parseOportunidadesMelhoria(resp.conteudo);
        const validacaoDto = oportunidadesMelhoria
            ? validarOportunidadesMelhoria(oportunidadesMelhoria, perfil)
            : { valido: false, erros: ['DTO oportunidadesMelhoria ausente'] };

        const erros = [
            ...(validacaoMarkdown.erros || []),
            ...(validacaoDto.erros || [])
        ];
        const valida = validacaoMarkdown.valido && validacaoDto.valido;
        const durTent = Date.now() - tTent;

        tentativasMeta.push({ n: tentativa, duracaoMs: durTent, valida });

        if (valida) {
            if (debug && resp.conteudo) {
                console.log(`[chance/auditora] raw tentativa=${tentativa} chars=${resp.conteudo.length} preview=${String(resp.conteudo).slice(0, 400)}`);
            }

            const saida = {
                relatorio,
                oportunidadesMelhoria,
                fallback: false,
                avisoValidacao: null,
                errosPorTentativa,
                tentativas: tentativasMeta,
                auditoraRaw: debug ? resp.conteudo : undefined,
                telemetriaChamada: {
                    etapa: 'auditora',
                    model,
                    promptVersion: PROMPT_AUDITORA_VERSION,
                    schemaVersion: PROMPT_AUDITORA_VERSION,
                    invocacao: 1,
                    tokens: {
                        prompt_tokens: promptTokensTotal,
                        completion_tokens: completionTokensTotal,
                        total_tokens: promptTokensTotal + completionTokensTotal
                    },
                    duracaoMs: Date.now() - t0Auditora,
                    custoEstimado: custoTotal,
                    tentativa,
                    tentativas: tentativasMeta
                }
            };
            validarSaidaEtapa('auditora', saida);
            return saida;
        }

        ultimoErro = erros.join('; ');
        errosPorTentativa.push({ tentativa, erro: ultimoErro });
        console.warn(`[chance/auditora] validação falhou (tentativa ${tentativa}): ${ultimoErro}`);
        if (debug && resp.conteudo) {
            console.log(`[chance/auditora] raw tentativa=${tentativa} chars=${resp.conteudo.length} preview=${String(resp.conteudo).slice(0, 800)}`);
        }
        if (tentativa < MAX_TENTATIVAS) {
            prompt.user += montarInstrucaoCorrecaoRetry(ultimoErro, tentativa + 1);
        }
    }

    console.error(`[chance/auditora] validação falhou após ${MAX_TENTATIVAS} tentativas: ${ultimoErro}`);

    const resultadoMotor = entrada.resultadoMotor;
    const perfilVersao = deps.perfilVersao || 'v1';
    const relatorio = montarRelatorioFallbackAuditora({
        resultadoMotor,
        perfilVersao,
        perfil,
        aviso: `Fallback ativado: ${ultimoErro}`
    });
    const oportunidadesMelhoria = montarOportunidadesFallback(resultadoMotor, perfil);

    if (debug && ultimaResp?.conteudo) {
        console.log(`[chance/auditora] raw fallback chars=${ultimaResp.conteudo.length}`);
    }

    return {
        relatorio,
        oportunidadesMelhoria,
        fallback: true,
        avisoValidacao: ultimoErro,
        errosPorTentativa,
        tentativas: tentativasMeta,
        auditoraRaw: debug ? (ultimaResp?.conteudo || null) : undefined,
        telemetriaChamada: {
            etapa: 'auditora',
            model,
            promptVersion: PROMPT_AUDITORA_VERSION,
            schemaVersion: PROMPT_AUDITORA_VERSION,
            invocacao: 1,
            tokens: {
                prompt_tokens: promptTokensTotal,
                completion_tokens: completionTokensTotal,
                total_tokens: promptTokensTotal + completionTokensTotal
            },
            duracaoMs: Date.now() - t0Auditora,
            custoEstimado: custoTotal,
            tentativa: MAX_TENTATIVAS,
            tentativas: tentativasMeta,
            fallback: true
        }
    };
}

module.exports = { auditora, montarInstrucaoCorrecaoRetry };
