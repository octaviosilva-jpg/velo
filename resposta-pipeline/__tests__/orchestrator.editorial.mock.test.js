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

const vereditoFactualAprovado = {
    schema_version: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacao_retry: 'nenhum'
};

const vereditoEditorialAprovado = {
    schema_version: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacao_retry: 'nenhum'
};

const vereditoEditorialReprova = {
    schema_version: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'editorial.evasao_sac',
        descricao: 'Empurra para SAC',
        severidade: 'ERROR'
    }],
    recomendacao_retry: 'executor'
};

function makeMock({ editorialFailsFirst = false, editorialParseFailFirst = false, factualEnabled = true } = {}) {
    let editorialCalls = 0;
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) return jsonResp(planoJson);
        if (sys.includes('EXECUTOR')) {
            return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        }
        if (sys.includes('AUDITOR FACTUAL')) {
            return jsonResp(vereditoFactualAprovado);
        }
        if (sys.includes('AUDITOR EDITORIAL')) {
            editorialCalls++;
            if (editorialParseFailFirst && editorialCalls === 1) {
                return { ...jsonResp({}), conteudo: 'not json' };
            }
            if (editorialFailsFirst && editorialCalls === 1) {
                return jsonResp(vereditoEditorialReprova);
            }
            return jsonResp(vereditoEditorialAprovado);
        }
        throw new Error(`prompt nao reconhecido: ${sys.substring(0, 50)}`);
    };
}

async function runEditorialCase(label, mockOpts, extraDeps = {}) {
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
        factualAuditorEnabled: mockOpts.factualEnabled !== false,
        editorialAuditorEnabled: true,
        dadosFormulario: state.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: { nome: 'Teste', genero: 'M' },
        montarTextoFallbackRespostaRA: (df) => `Fallback: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => 'Checklist AENV teste',
        ...extraDeps
    });

    assert.ok(result.conteudoMiolo, `${label}: conteudoMiolo presente`);
    assert.ok(result.respostaPublica, `${label}: respostaPublica presente`);
    return { state, result };
}

(async () => {
    const { state: s1 } = await runEditorialCase('factual+editorial ok', {});
    assert.ok(s1.vereditoEditorial);
    assert.strictEqual(s1.vereditoEditorial.aprovado, true);
    assert.strictEqual(s1.editorialRetryCount, 0);

    const { state: s2 } = await runEditorialCase('editorial retry executor', { editorialFailsFirst: true });
    assert.ok(s2.editorialRetryCount >= 1);
    assert.strictEqual(s2.vereditoEditorial.aprovado, true);

    const { state: s3 } = await runEditorialCase('editorial retry tecnico', { editorialParseFailFirst: true });
    assert.strictEqual(s3.auditorEditorialTechnicalRetryCount, 1);

    const stateFb = createWorkflowState({
        dadosFormulario: {
            tipo_solicitacao: 'restituicao',
            solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
            texto_cliente: 'Dinheiro nao caiu'
        }
    });
    let editorialAlwaysFail = 0;
    const alwaysFailMock = async ({ messages }) => {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) return jsonResp(planoJson);
        if (sys.includes('EXECUTOR')) return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        if (sys.includes('AUDITOR FACTUAL')) return jsonResp(vereditoFactualAprovado);
        if (sys.includes('AUDITOR EDITORIAL')) {
            editorialAlwaysFail++;
            return jsonResp(vereditoEditorialReprova);
        }
        throw new Error('prompt nao reconhecido');
    };
    const fbResult = await runPlanExecPipeline(stateFb, {
        openaiStep: alwaysFailMock,
        apiKey: 'test-key',
        factualAuditorEnabled: true,
        editorialAuditorEnabled: true,
        maxEditorialExecutorRetries: 1,
        dadosFormulario: stateFb.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: { nome: 'Teste', genero: 'M' },
        montarTextoFallbackRespostaRA: (df) => `Fallback: ${df.solucao_implementada}`,
        montarChecklistConformidadeRA: () => ''
    });
    assert.ok(fbResult.usedFallback);
    assert.ok(fbResult.respostaPublica.includes('3003-7293'));

    const { state: s4 } = await runEditorialCase('editorial sem factual', { factualEnabled: false });
    assert.strictEqual(s4.vereditoFactual, null);
    assert.ok(s4.vereditoEditorial);

    console.log('resposta-pipeline/__tests__/orchestrator.editorial.mock.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
