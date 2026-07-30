'use strict';

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPlanExecPipeline } = require('../orchestrator');

const mioloLongo = 'Cliente contatado. Protocolo 12345. Orientado a acompanhar aplicativo. '
    + 'Detalhes adicionais sobre o caso e fundamentacao. '.repeat(8);

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

const mockUserData = { nome: 'Joao Silva', genero: 'M' };

async function testRaStandardSkipsPlanner() {
    let executorCalls = 0;
    const mockStep = async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        const user = (messages[1] && messages[1].content) || '';
        if (sys.includes('PLANNER')) {
            throw new Error('Planner nao deveria ser invocado no modo RA standard');
        }
        if (user.includes('SCRIPT RA TESTE') || sys.includes('Reclame Aqui')) {
            executorCalls++;
            return jsonResp({ schema_version: '1.0', conteudo: mioloLongo });
        }
        throw new Error(`Prompt inesperado: ${sys.slice(0, 40)}`);
    };

    const state = createWorkflowState({
        idReclamacao: '999',
        dadosFormulario: {
            id_reclamacao: '999',
            tipo_solicitacao: 'aplicativo',
            texto_cliente: 'App nao funciona',
            solucao_implementada: 'Cliente contatado. Protocolo 12345. Orientado a acompanhar aplicativo.',
            historico_atendimento: 'Nenhum',
            nome_solicitante: 'Maria'
        }
    });

    const result = await runPlanExecPipeline(state, {
        raStandardExecutorEnabled: true,
        dadosFormulario: state.entradasCruas,
        dadosPlanilha: { modelosCoerentes: [], feedbacksRelevantes: [] },
        conhecimentoProdutos: '',
        userData: mockUserData,
        openaiStep: mockStep,
        gerarScriptPadraoResposta: () => 'SCRIPT RA TESTE',
        reformularComConhecimento: (script) => script,
        montarTextoFallbackRespostaRA: () => 'Fallback mecanico',
        montarChecklistConformidadeRA: () => ''
    });

    assert.ok(executorCalls >= 1, 'executor RA deve ser invocado');
    assert.ok(result.respostaPublica, 'respostaPublica presente');
    assert.ok(result.respostaPublica.includes('3003-7293'), 'envelope RA aplicado');
    assert.ok(result.conteudoMiolo.includes('Protocolo 12345'), 'miolo preserva solucao');
    console.log('  RA standard — skip planner + envelope — OK');
}

(async () => {
    await testRaStandardSkipsPlanner();
    console.log('resposta-pipeline/__tests__/orchestrator.raStandard.mock.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
