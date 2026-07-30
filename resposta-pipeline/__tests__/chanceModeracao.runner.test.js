'use strict';

const assert = require('assert');
const ws = require('../workflowState');
const { runChanceModeracao } = require('../chanceModeracao/runner');

async function testSkipSemService() {
    const state = ws.createWorkflowState({
        dadosFormulario: { texto_cliente: 'Reclamacao teste', id_reclamacao: '1' }
    });
    state.respostaPublica = 'Resposta publica teste';

    const out = await runChanceModeracao(state, {});
    assert.strictEqual(out.pulada, true);
    assert.strictEqual(out.motivoPulo, 'service_nao_injetado');
    assert.strictEqual(state.chanceModeracao, null);
    console.log('  skip sem service — OK');
}

async function testSkipSemRespostaPublica() {
    const state = ws.createWorkflowState({
        dadosFormulario: { texto_cliente: 'Reclamacao', id_reclamacao: '2' }
    });
    const mockExec = async () => ({ sucesso: true, result: 'x', motor: null });

    const out = await runChanceModeracao(state, { executarChanceModeracao: mockExec });
    assert.strictEqual(out.pulada, true);
    assert.strictEqual(out.motivoPulo, 'resposta_publica_ausente');
    assert.strictEqual(mockExec.called, undefined);
    console.log('  skip sem respostaPublica — OK');
}

async function testSkipSemReclamacao() {
    const state = ws.createWorkflowState({
        dadosFormulario: { texto_cliente: '', id_reclamacao: '3' }
    });
    state.respostaPublica = 'Resposta';

    let called = false;
    const mockExec = async () => { called = true; return { sucesso: true, result: 'x', motor: null }; };

    const out = await runChanceModeracao(state, { executarChanceModeracao: mockExec });
    assert.strictEqual(out.pulada, true);
    assert.strictEqual(out.motivoPulo, 'reclamacao_ausente');
    assert.strictEqual(called, false);
    console.log('  skip sem reclamacao — OK');
}

async function testMapeamentoESucesso() {
    const state = ws.createWorkflowState({
        dadosFormulario: {
            texto_cliente: 'Texto reclamacao',
            consideracao_final: 'Consideracao',
            historico_moderacao: 'Historico mod',
            id_reclamacao: '4'
        }
    });
    state.respostaPublica = 'Resposta envelope RA';

    let capturedInput = null;
    const mockExec = async (input) => {
        capturedInput = input;
        return {
            sucesso: true,
            result: 'Analise completa',
            motor: { chance_final: 72 },
            telemetria: { openaiCallCount: 2, duracaoMs: 100 }
        };
    };

    const out = await runChanceModeracao(state, {
        executarChanceModeracao: mockExec,
        userData: { nome: 'Agente Teste' }
    });

    assert.strictEqual(out.executada, true);
    assert.strictEqual(out.sucesso, true);
    assert.strictEqual(capturedInput.reclamacaoCompleta, 'Texto reclamacao');
    assert.strictEqual(capturedInput.respostaPublica, 'Resposta envelope RA');
    assert.strictEqual(capturedInput.consideracaoFinal, 'Consideracao');
    assert.strictEqual(capturedInput.historicoModeracao, 'Historico mod');
    assert.deepStrictEqual(capturedInput.userData, { nome: 'Agente Teste' });

    assert.strictEqual(state.chanceModeracao.executada, true);
    assert.strictEqual(state.chanceModeracao.sucesso, true);
    assert.strictEqual(state.chanceModeracao.result, 'Analise completa');
    assert.strictEqual(state.chanceModeracao.motor.chance_final, 72);
    assert.strictEqual(state.respostaPublica, 'Resposta envelope RA');
    console.log('  mapeamento e sucesso — OK');
}

async function testFalhaGraceful() {
    const state = ws.createWorkflowState({
        dadosFormulario: { texto_cliente: 'Rec', id_reclamacao: '5' }
    });
    state.respostaPublica = 'Resp';

    const mockExec = async () => ({
        sucesso: false,
        erro: 'openai timeout',
        result: null,
        motor: null
    });

    const out = await runChanceModeracao(state, { executarChanceModeracao: mockExec });
    assert.strictEqual(out.executada, true);
    assert.strictEqual(out.sucesso, false);
    assert.strictEqual(state.chanceModeracao.sucesso, false);
    assert.strictEqual(state.chanceModeracao.erro, 'openai timeout');
    assert.strictEqual(state.respostaPublica, 'Resp');
    console.log('  falha graceful — OK');
}

async function testExcecaoNaoPropaga() {
    const state = ws.createWorkflowState({
        dadosFormulario: { texto_cliente: 'Rec', id_reclamacao: '6' }
    });
    state.respostaPublica = 'Resp';

    const mockExec = async () => { throw new Error('boom'); };

    const out = await runChanceModeracao(state, { executarChanceModeracao: mockExec });
    assert.strictEqual(out.executada, true);
    assert.strictEqual(out.sucesso, false);
    assert.strictEqual(state.chanceModeracao.erro, 'boom');
    console.log('  excecao nao propaga — OK');
}

(async () => {
    await testSkipSemService();
    await testSkipSemRespostaPublica();
    await testSkipSemReclamacao();
    await testMapeamentoESucesso();
    await testFalhaGraceful();
    await testExcecaoNaoPropaga();
    console.log('resposta-pipeline/__tests__/chanceModeracao.runner.test.js — OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
