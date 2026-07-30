'use strict';

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPlanExecPipeline } = require('../orchestrator');
const { SCHEMA_VERSION, SKIP_MOTIVO, NODES, REGIME_SOLUCAO, MODO_OPERACAO, FONTE_PRIMARIA } = require('../constants');

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

const planoRefinar = {
    schema_version: SCHEMA_VERSION,
    problema_central: 'Atraso restituicao',
    entendimento_situacional: 'Cliente aguarda credito',
    modo_operacao: 'refinar',
    fonte_primaria: 'solucao_implementada',
    fatos_autorizados: ['Cliente contatado. Orientado a acompanhar aplicativo.'],
    fundamentacoes_obrigatorias: ['Prazo informado'],
    estrategia_resolucao: 'Refinar status',
    plano_argumentativo: [{
        funcao: 'resposta_direta',
        pontos_obrigatorios: ['Status'],
        profundidade_esperada: 'padrao'
    }],
    exclusoes: [],
    coerentes_utilizadas: []
};

const planoComplementar = {
    ...planoRefinar,
    modo_operacao: 'complementar',
    fonte_primaria: 'misto'
};

const mioloLongo = 'Cliente contatado. Orientado a acompanhar aplicativo. ' + 'Detalhes adicionais sobre o caso. '.repeat(8);

const vereditoAprovado = {
    schema_version: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacao_retry: 'nenhum'
};

function makeMock({ plano = planoRefinar } = {}) {
    let llmCalls = 0;
    const mock = async function mockStep({ messages }) {
        llmCalls++;
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('PLANNER')) return jsonResp(plano);
        if (sys.includes('EXECUTOR')) {
            return jsonResp({ schema_version: SCHEMA_VERSION, conteudo: mioloLongo });
        }
        if (sys.includes('AUDITOR FACTUAL')) return jsonResp(vereditoAprovado);
        if (sys.includes('AUDITOR EDITORIAL')) return jsonResp(vereditoAprovado);
        throw new Error(`prompt nao reconhecido: ${sys.substring(0, 50)}`);
    };
    mock.getCallCount = () => llmCalls;
    return mock;
}

function baseFormulario() {
    return {
        tipo_solicitacao: 'restituicao',
        solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo. Detalhes completos sobre o caso.',
        texto_cliente: 'Dinheiro nao caiu'
    };
}

async function runCase(label, extraDeps = {}, mockOpts = {}) {
    const mock = makeMock(mockOpts);
    const state = createWorkflowState({ dadosFormulario: baseFormulario() });

    const result = await runPlanExecPipeline(state, {
        openaiStep: mock,
        apiKey: 'test-key',
        factualAuditorEnabled: true,
        editorialAuditorEnabled: true,
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
    return { state, result, mock };
}

(async () => {
    // skip editorial real → 3 LLM calls (planner + executor + factual)
    {
        const { state, result, mock } = await runCase('skip editorial', {
            conditionalAuditEnabled: true,
            conditionalAuditShadow: false,
            skipFactualTier1Enabled: false
        });
        assert.strictEqual(state.editorialAuditorSkipped, true);
        assert.strictEqual(state.vereditoEditorial, null);
        assert.strictEqual(result.metrics.openaiCallCount, 3);
        assert.strictEqual(mock.getCallCount(), 3);
        assert.strictEqual(result.metrics.skipCodigoMotivoEditorial, SKIP_MOTIVO.EDITORIAL_TIER1);
        const skipArtefato = state.artefatos.find(a => a.tipo === 'DecisaoExecucaoAuditor' && a.payload?.alvo === NODES.AUDITOR_EDITORIAL);
        assert.ok(skipArtefato);
        assert.strictEqual(skipArtefato.payload.executar, false);
    }

    // shadow mode → 4 LLM calls + artefato skip
    {
        const { state, result, mock } = await runCase('shadow editorial', {
            conditionalAuditEnabled: true,
            conditionalAuditShadow: true
        });
        assert.strictEqual(state.editorialAuditorSkipped, false);
        assert.ok(state.vereditoEditorial);
        assert.strictEqual(result.metrics.openaiCallCount, 4);
        assert.strictEqual(mock.getCallCount(), 4);
        const skipArtefato = state.artefatos.find(a => a.tipo === 'DecisaoExecucaoAuditor' && a.payload?.alvo === NODES.AUDITOR_EDITORIAL);
        assert.ok(skipArtefato);
        assert.strictEqual(skipArtefato.payload.shadowMode, true);
        assert.strictEqual(skipArtefato.payload.executar, false);
    }

    // conditional off = Fase 3 identica (4 calls)
    {
        const { state, result, mock } = await runCase('conditional off', {
            conditionalAuditEnabled: false
        });
        assert.strictEqual(state.editorialAuditorSkipped, false);
        assert.strictEqual(state.factualAuditorSkipped, false);
        assert.strictEqual(result.metrics.openaiCallCount, 4);
        assert.strictEqual(mock.getCallCount(), 4);
    }

    // skip factual tier1 + editorial obrigatorio → 3 calls (planner+executor+editorial)
    {
        const { state, result, mock } = await runCase('skip factual anti-duplo', {
            conditionalAuditEnabled: true,
            skipFactualTier1Enabled: true
        });
        assert.strictEqual(state.factualAuditorSkipped, true);
        assert.strictEqual(state.editorialAuditorSkipped, false);
        assert.ok(state.vereditoEditorial);
        assert.strictEqual(state.vereditoFactual, null);
        assert.strictEqual(result.metrics.openaiCallCount, 3);
        assert.strictEqual(mock.getCallCount(), 3);
    }

    // complementar nunca skip editorial
    {
        const { state, result } = await runCase('complementar sem skip', {
            conditionalAuditEnabled: true
        }, { plano: planoComplementar });
        assert.strictEqual(state.editorialAuditorSkipped, false);
        assert.strictEqual(result.metrics.openaiCallCount, 4);
    }

    // tokens economizados quando skip editorial
    {
        const { result } = await runCase('tokens economizados', {
            conditionalAuditEnabled: true
        });
        assert.ok(result.metrics.tokensEconomizadosEstimados > 0);
        assert.ok(result.metrics.latenciaEconomizadaMs > 0);
    }

    console.log('resposta-pipeline/__tests__/orchestrator.conditional.mock.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
