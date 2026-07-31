'use strict';

const { DEFAULTS, resolverModelo, PROMPT_AUDITORA_VERSION } = require('./constants');
const { montarPromptAuditora } = require('./promptAuditora');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');
const { validarSaidaAuditora } = require('./validarSaidaAuditora');
const { separarRelatorioEOportunidades, parseOportunidadesMelhoria } = require('./parseOportunidadesMelhoria');
const { validarOportunidadesMelhoria } = require('./validarOportunidadesMelhoria');
const { montarRelatorioFallbackAuditora, montarOportunidadesFallback } = require('./montarRelatorioFallback');

const MAX_TENTATIVAS = 3;

/**
 * Auditora Técnica LLM — interpreta resultado oficial do Motor (seções 1–12 + DTO A16).
 */
async function auditora(entrada, deps = {}) {
    validarEntradaEtapa('auditora', entrada, deps.strictContratos ? { strict: true } : {});

    const openaiStep = deps.openaiStep || require('../resposta-pipeline/openaiStep').openaiStep;
    const envVars = deps.envVars || {};
    const model = resolverModelo(envVars, 'CHANCE_AUDITORA_MODEL', 'gpt-4o');
    const perfil = deps.perfil;

    const prompt = montarPromptAuditora(entrada);
    let ultimoErro = null;
    let ultimaResp = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        console.log(`[chance/auditora] tentativa=${tentativa} model=${model}`);

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

        const { relatorio, jsonRaw } = separarRelatorioEOportunidades(resp.conteudo);
        const validacaoMarkdown = validarSaidaAuditora(relatorio, perfil);
        const oportunidadesMelhoria = parseOportunidadesMelhoria(resp.conteudo);
        const validacaoDto = oportunidadesMelhoria
            ? validarOportunidadesMelhoria(oportunidadesMelhoria, perfil)
            : { valido: false, erros: ['DTO oportunidadesMelhoria ausente'] };

        const erros = [
            ...(validacaoMarkdown.erros || []),
            ...(validacaoDto.erros || [])
        ];

        if (validacaoMarkdown.valido && validacaoDto.valido) {
            const saida = {
                relatorio,
                oportunidadesMelhoria,
                telemetriaChamada: {
                    etapa: 'auditora',
                    model,
                    promptVersion: PROMPT_AUDITORA_VERSION,
                    invocacao: 1,
                    tokens: resp.usage,
                    duracaoMs: resp.duracaoMs,
                    custoEstimado: resp.custoEstimado,
                    tentativa
                }
            };
            validarSaidaEtapa('auditora', saida);
            return saida;
        }

        ultimoErro = erros.join('; ');
        console.warn(`[chance/auditora] validação falhou (tentativa ${tentativa}): ${ultimoErro}`);
        if (tentativa < MAX_TENTATIVAS) {
            prompt.user += `\n\nCORREÇÃO OBRIGATÓRIA (tentativa ${tentativa + 1}): ${ultimoErro}. Inclua todas as seções H2 na ordem A10, bloco ${'<!-- OPORTUNIDADES_MELHORIA_JSON -->'} com schema oportunidades-v1, e use ### [Nome do critério] para cada critério do Motor. Percentual só na seção "Resultado Oficial do Motor" citando o valor oficial.`;
        }
    }

    const err = new Error(`[chance/auditora] validação falhou após ${MAX_TENTATIVAS} tentativas: ${ultimoErro}`);
    err.codigo = 'validacao_auditora';
    console.error(err.message);

    const resultadoMotor = entrada.resultadoMotor;
    const perfilVersao = deps.perfilVersao || 'v1';
    const relatorio = montarRelatorioFallbackAuditora({
        resultadoMotor,
        perfilVersao,
        perfil,
        aviso: `Fallback ativado: ${ultimoErro}`
    });
    const oportunidadesMelhoria = montarOportunidadesFallback(resultadoMotor, perfil);

    return {
        relatorio,
        oportunidadesMelhoria,
        fallback: true,
        avisoValidacao: ultimoErro,
        telemetriaChamada: {
            etapa: 'auditora',
            model,
            promptVersion: PROMPT_AUDITORA_VERSION,
            invocacao: 1,
            tokens: ultimaResp?.usage || null,
            duracaoMs: ultimaResp?.duracaoMs || 0,
            custoEstimado: ultimaResp?.custoEstimado || 0,
            tentativa: MAX_TENTATIVAS,
            fallback: true
        }
    };
}

module.exports = { auditora };
