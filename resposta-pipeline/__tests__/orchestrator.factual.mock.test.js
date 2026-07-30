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

const vereditoAprovado = {
    schema_version: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacao_retry: 'nenhum'
};

const vereditoReprovaExecutor = {
    schema_version: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'factual.inventao',
        descricao: 'Protocolo inventado',
        trecho: '12345',
        severidade: 'ERROR'
    }],
    recomendacao_retry: 'executor'
};

const vereditoReprovaPlanner = {
    schema_version: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'factual.omissao',
        descricao: 'Plano incompleto vs matriz',
        severidade: 'BLOCKER'
    }],
    recomendacao_retry: 'planner'
};

function makeMock({ auditorFailsFirst = false, auditorPlanner = false, auditorParseFailFirst = false } = {}) {
    let auditorCalls = 0;
    let executorCalls = 0;
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) {
            return jsonResp(planoJson);
        }
        if (sys.includes('EXECUTOR')) {
            executorCalls++;
            return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        }
        if (sys.includes('AUDITOR FACTUAL')) {
            auditorCalls++;
            if (auditorParseFailFirst && auditorCalls === 1) {
                return { ...jsonResp({}), conteudo: 'not json' };
            }
            if (auditorPlanner) {
                return jsonResp(vereditoReprovaPlanner);
            }
            if (auditorFailsFirst && auditorCalls === 1) {
                return jsonResp(vereditoReprovaExecutor);
            }
            return jsonResp(vereditoAprovado);
        }
        throw new Error(`prompt nao reconhecido: ${sys.substring(0, 40)}`);
    };
}

async function runFactualCase(label, mockOpts, extraDeps = {}) {
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
        factualAuditorEnabled: true,
        editorialAuditorEnabled: false,
        dadosFormulario: state.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: { nome: 'Teste', genero: 'M' },
        montarTextoFallbackRespostaRA: (df) => `Fallback: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => '',
        ...extraDeps
    });

    assert.ok(result.conteudoMiolo, `${label}: conteudoMiolo presente`);
    assert.ok(result.respostaPublica, `${label}: respostaPublica presente`);
    return { state, result };
}

(async () => {
    const { state: s1 } = await runFactualCase('gate ok + auditor ok', {});
    assert.ok(s1.vereditoFactual);
    assert.strictEqual(s1.vereditoFactual.aprovado, true);
    assert.strictEqual(s1.factualRetryCount, 0);
    assert.strictEqual(s1.usedFallback, false);

    const { state: s2 } = await runFactualCase('auditor reprova + retry executor', { auditorFailsFirst: true });
    assert.ok(s2.factualRetryCount >= 1);
    assert.strictEqual(s2.vereditoFactual.aprovado, true);
    assert.ok(s2.planoDeResposta);

    const { state: s3 } = await runFactualCase('auditor retry tecnico', { auditorParseFailFirst: true });
    assert.strictEqual(s3.auditorTechnicalRetryCount, 1);
    assert.strictEqual(s3.vereditoFactual.aprovado, true);

    const stateFb = createWorkflowState({
        dadosFormulario: {
            tipo_solicitacao: 'restituicao',
            solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
            texto_cliente: 'Dinheiro nao caiu'
        }
    });
    let auditorAlwaysFail = 0;
    const alwaysFailMock = async ({ messages }) => {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) return jsonResp(planoJson);
        if (sys.includes('EXECUTOR')) return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        if (sys.includes('AUDITOR FACTUAL')) {
            auditorAlwaysFail++;
            return jsonResp(vereditoReprovaExecutor);
        }
        throw new Error('prompt nao reconhecido');
    };
    const fbResult = await runPlanExecPipeline(stateFb, {
        openaiStep: alwaysFailMock,
        apiKey: 'test-key',
        factualAuditorEnabled: true,
        maxFactualExecutorRetries: 1,
        dadosFormulario: stateFb.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: { nome: 'Teste', genero: 'M' },
        montarTextoFallbackRespostaRA: (df) => `Fallback: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => ''
    });
    assert.ok(fbResult.usedFallback);
    assert.ok(fbResult.conteudoMiolo.startsWith('Fallback:'));
    assert.ok(fbResult.respostaPublica.includes('3003-7293'));

    const statePl = createWorkflowState({
        dadosFormulario: {
            tipo_solicitacao: 'restituicao',
            solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
            texto_cliente: 'Dinheiro nao caiu'
        }
    });
    const plResult = await runPlanExecPipeline(statePl, {
        openaiStep: makeMock({ auditorPlanner: true }),
        apiKey: 'test-key',
        factualAuditorEnabled: true,
        dadosFormulario: statePl.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: { nome: 'Teste', genero: 'M' },
        montarTextoFallbackRespostaRA: (df) => `Fallback planner: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => ''
    });
    assert.ok(plResult.usedFallback);
    assert.ok(plResult.conteudoMiolo.includes('Fallback planner'));
    assert.ok(plResult.respostaPublica.includes('3003-7293'));

    console.log('resposta-pipeline/__tests__/orchestrator.factual.mock.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
