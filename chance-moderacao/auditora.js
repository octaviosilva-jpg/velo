'use strict';

const { DEFAULTS, resolverModelo, PROMPT_AUDITORA_VERSION } = require('./constants');
const { montarPromptAuditora } = require('./promptAuditora');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');
const { validarSaidaAuditora } = require('./validarSaidaAuditora');
const { separarRelatorioEOportunidades, parseOportunidadesMelhoria } = require('./parseOportunidadesMelhoria');
const { validarOportunidadesMelhoria } = require('./validarOportunidadesMelhoria');

const MAX_TENTATIVAS = 2;

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
        if (!jsonRaw && tentativa < MAX_TENTATIVAS) {
            prompt.user += `\n\nCORREÇÃO OBRIGATÓRIA: inclua todas as seções H2 e o bloco JSON ${'<!-- OPORTUNIDADES_MELHORIA_JSON -->'}. Erros: ${ultimoErro}`;
        }
    }

    const err = new Error(`[chance/auditora] validação falhou após ${MAX_TENTATIVAS} tentativas: ${ultimoErro}`);
    err.codigo = 'validacao_auditora';
    throw err;
}

module.exports = { auditora };
