'use strict';

const { DEFAULTS, resolverModelo, PROMPT_EXTRATOR_VERSION } = require('./constants');
const { montarPromptExtrator } = require('./promptExtrator');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');
const { parseJsonTolerante } = require('../resposta-pipeline/openaiStep');
const { normalizarEstados } = require('../motor-pontuacao/integracao');

/**
 * Extrator LLM — reclamação + resposta → JSON estruturado para o Motor.
 * Reutilizado 2× no fluxo completo (A11).
 */
async function extrator(entrada, deps = {}) {
    validarEntradaEtapa('extrator', entrada, deps.strictContratos ? { strict: true } : {});

    const {
        reclamacao,
        respostaPublica,
        consideracaoFinal = '',
        invocacao = 1
    } = entrada;

    const openaiStep = deps.openaiStep || require('../resposta-pipeline/openaiStep').openaiStep;
    const envVars = deps.envVars || {};
    const model = resolverModelo(envVars, 'CHANCE_EXTRATOR_MODEL', envVars.OPENAI_MODEL || 'gpt-4o-mini');
    const perfil = deps.perfil;
    const instrucaoEstados = deps.instrucaoEstados || (perfil && deps.montarInstrucaoEstados?.(perfil));

    const prompt = montarPromptExtrator({
        instrucaoEstados,
        reclamacao,
        respostaPublica,
        consideracaoFinal
    });

    console.log(`[chance/extrator] invocacao=${invocacao} model=${model}`);

    const resp = await openaiStep({
        apiKey: deps.apiKey,
        model,
        temperature: 0,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ],
        responseFormat: 'json_object',
        maxTokens: 2500,
        timeoutMs: deps.timeoutMs || DEFAULTS.openaiTimeoutMs
    });

    const auditoriaBruta = parseJsonTolerante(resp.conteudo);
    if (!auditoriaBruta) {
        throw new Error('[chance/extrator] JSON inválido na resposta');
    }

    const norm = normalizarEstados(auditoriaBruta);
    const saida = {
        extracao: norm,
        telemetriaChamada: {
            etapa: 'extrator',
            model,
            promptVersion: PROMPT_EXTRATOR_VERSION,
            invocacao,
            tokens: resp.usage,
            duracaoMs: resp.duracaoMs,
            custoEstimado: resp.custoEstimado
        }
    };

    validarSaidaEtapa('extrator', {
        extracao: saida.extracao,
        fundamentos: norm.fundamentos,
        mapa_reclamacao: norm.mapa_reclamacao
    });

    return saida;
}

module.exports = { extrator };
