'use strict';

const { DEFAULTS, resolverModelo, PROMPT_REFORMULADOR_VERSION } = require('./constants');
const { montarPromptReformulador } = require('./promptReformulador');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');

/**
 * Reformulador LLM — resposta + DTO oportunidadesMelhoria → miolo reformulado.
 */
async function reformulador(entrada, deps = {}) {
    validarEntradaEtapa('reformulador', entrada, deps.strictContratos ? { strict: true } : {});

    const { respostaPublica, oportunidadesMelhoria } = entrada;
    const openaiStep = deps.openaiStep || require('../resposta-pipeline/openaiStep').openaiStep;
    const envVars = deps.envVars || {};
    const model = resolverModelo(envVars, 'CHANCE_REFORMULADOR_MODEL', envVars.OPENAI_MODEL || 'gpt-4o-mini');

    const prompt = montarPromptReformulador({ respostaPublica, oportunidadesMelhoria });

    console.log(`[chance/reformulador] model=${model}`);

    const resp = await openaiStep({
        apiKey: deps.apiKey,
        model,
        temperature: 0.3,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ],
        maxTokens: 3000,
        timeoutMs: deps.timeoutMs || DEFAULTS.openaiTimeoutMs
    });

    const mioloReformulado = (resp.conteudo || '').trim();
    if (!mioloReformulado) {
        throw new Error('[chance/reformulador] resposta vazia');
    }

    const saida = {
        mioloReformulado,
        telemetriaChamada: {
            etapa: 'reformulador',
            model,
            promptVersion: PROMPT_REFORMULADOR_VERSION,
            invocacao: 1,
            tokens: resp.usage,
            duracaoMs: resp.duracaoMs,
            custoEstimado: resp.custoEstimado
        }
    };

    validarSaidaEtapa('reformulador', saida);
    return saida;
}

module.exports = { reformulador };
