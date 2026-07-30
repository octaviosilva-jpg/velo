'use strict';

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPlanExecPipeline } = require('../orchestrator');
const { SCHEMA_VERSION } = require('../constants');

function jsonResp(obj) {
    return {
        conteudo: JSON.stringify(obj),
        usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
        duracaoMs: 5,
        custoEstimado: 0.001,
        model: 'mock',
        temperature: 0,
        promptRenderizado: { system: '', user: '' },
        respostaCrua: {}
    };
}

const planoJson = {
    schema_version: SCHEMA_VERSION,
    problema_central: 'Atraso restituicao',
    entendimento_situacional: 'Cliente aguarda credito',
    modo_operacao: 'complementar',
    fonte_primaria: 'misto',
    fatos_autorizados: ['Cliente contatado'],
    fundamentacoes_obrigatorias: ['Prazo informado'],
    estrategia_resolucao: 'Explicar status',
    plano_argumentativo: [{
        funcao: 'resposta_direta',
        pontos_obrigatorios: ['Status'],
        profundidade_esperada: 'padrao'
    }],
    exclusoes: [],
    coerentes_utilizadas: []
};

const mioloLongo = 'Cliente contatado. Orientado a acompanhar aplicativo. ' + 'Detalhes adicionais sobre o caso. '.repeat(8);

const mockUserData = { nome: 'Joao Silva', genero: 'M' };

function makeMock({ plannerFailsFirst = false, executorFailsFirst = false } = {}) {
    let plannerCalls = 0;
    let executorCalls = 0;
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) {
            plannerCalls++;
            if (plannerFailsFirst && plannerCalls === 1) {
                return { ...jsonResp({ invalid: true }), conteudo: 'not json at all' };
            }
            return jsonResp(planoJson);
        }
        if (sys.includes('EXECUTOR')) {
            executorCalls++;
            if (executorFailsFirst && executorCalls === 1) {
                return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: 'curto' });
            }
            return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        }
        throw new Error('prompt nao reconhecido');
    };
}

async function runCase(label, mockOpts) {
    const state = createWorkflowState({
        dadosFormulario: {
            tipo_solicitacao: 'restituicao',
            solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
            texto_cliente: 'Dinheiro nao caiu'
        }
    });

    const result = await runPlanExecPipeline(state, {
        openaiStep: makeMock(mockOpts),
        apiKey: 'test-key',
        factualAuditorEnabled: false,
        editorialAuditorEnabled: false,
        dadosFormulario: state.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: mockUserData,
        montarTextoFallbackRespostaRA: (df) => `Fallback: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => ''
    });

    assert.ok(result.conteudoMiolo, `${label}: conteudoMiolo presente`);
    assert.ok(result.respostaPublica, `${label}: respostaPublica presente`);
    assert.ok(result.respostaPublica.includes('3003-7293'), `${label}: envelope RA`);
    assert.ok(state.respostaPublica, `${label}: state.respostaPublica`);
    return { state, result };
}

(async () => {
    const { state: s1 } = await runCase('fluxo ok', {});
    assert.ok(s1.planoDeResposta);
    assert.ok(s1.rascunhoMiolo);
    assert.strictEqual(s1.executorRetryCount, 0);

    const { state: s2 } = await runCase('planner retry tecnico', { plannerFailsFirst: true });
    assert.strictEqual(s2.plannerTechnicalRetryCount, 1);

    const planoAntes = JSON.stringify(s2.planoDeResposta);
    const { state: s3 } = await runCase('executor retry gate', { executorFailsFirst: true });
    assert.ok(s3.executorRetryCount >= 1);
    assert.ok(s3.planoDeResposta);
    assert.strictEqual(s1.vereditoFactual, null);
    assert.strictEqual(s1.vereditoEditorial, null);

    console.log('resposta-pipeline/__tests__/orchestrator.mock.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
