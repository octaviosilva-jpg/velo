'use strict';

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const {
    evaluateSkipFactual,
    evaluateSkipEditorial,
    FASE
} = require('../auditorSkipPolicy');
const { SKIP_MOTIVO, NODES, REGIME_SOLUCAO, MODO_OPERACAO, FONTE_PRIMARIA } = require('../constants');

function baseDeps(overrides = {}) {
    return {
        conditionalAuditEnabled: true,
        conditionalAuditShadow: false,
        skipFactualTier1Enabled: false,
        factualAuditorEnabled: true,
        editorialAuditorEnabled: true,
        ...overrides
    };
}

function buildState(overrides = {}) {
    const state = createWorkflowState({
        dadosFormulario: {
            solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
            texto_cliente: 'Dinheiro nao caiu'
        }
    });

    state.insumosPreparados = {
        regimeSolucao: REGIME_SOLUCAO.COMPLETA,
        matrizAutoridade: {
            lacunasDetectadas: [],
            solucaoImplementadaPresente: true,
            fatosAutorizados: [{ origem: 'solucao_implementada', texto: 'Cliente contatado.' }]
        },
        kitReferencia: { checklistRA: '' },
        ...(overrides.insumosPreparados || {})
    };

    state.planoDeResposta = {
        modoOperacao: MODO_OPERACAO.REFINAR,
        fontePrimaria: FONTE_PRIMARIA.SOLUCAO_IMPLEMENTADA,
        fatosAutorizados: ['Cliente contatado.'],
        ...(overrides.planoDeResposta || {})
    };

    state.vereditoGate = { aprovado: true, falhas: [] };
    state.executorRetryCount = 0;
    state.vereditoFactual = { aprovado: true, falhas: [] };

    Object.assign(state, overrides.state || {});

    if (overrides.regimeSolucao) {
        state.insumosPreparados.regimeSolucao = overrides.regimeSolucao;
    }
    if (overrides.modoOperacao) {
        state.planoDeResposta.modoOperacao = overrides.modoOperacao;
    }
    if (overrides.checklistRA !== undefined) {
        state.insumosPreparados.kitReferencia.checklistRA = overrides.checklistRA;
    }
    if (overrides.executorRetryCount !== undefined) {
        state.executorRetryCount = overrides.executorRetryCount;
    }
    if (overrides.factualAuditorSkipped !== undefined) {
        state.factualAuditorSkipped = overrides.factualAuditorSkipped;
    }

    return state;
}

// editorial skip: completa + refinar + checklist vazio + retry 0
{
    const state = buildState();
    const d = evaluateSkipEditorial(state, baseDeps());
    assert.strictEqual(d.executar, false, 'editorial skip tier1');
    assert.strictEqual(d.codigoMotivo, SKIP_MOTIVO.EDITORIAL_TIER1);
    assert.strictEqual(d.fasePrecedencia, FASE.SKIP_FINAL);
    assert.strictEqual(d.alvo, NODES.AUDITOR_EDITORIAL);
}

// editorial executar: checklist presente
{
    const state = buildState({ checklistRA: 'Regra AENV: seja objetivo.' });
    const d = evaluateSkipEditorial(state, baseDeps());
    assert.strictEqual(d.executar, true);
    assert.strictEqual(d.regraDecisiva, 'E03');
}

// vazia: nunca skip factual/editorial
{
    const state = buildState({ regimeSolucao: REGIME_SOLUCAO.VAZIA });
    assert.strictEqual(evaluateSkipFactual(state, baseDeps({ skipFactualTier1Enabled: true })).executar, true);
    assert.strictEqual(evaluateSkipFactual(state, baseDeps({ skipFactualTier1Enabled: true })).regraDecisiva, 'V01');
    assert.strictEqual(evaluateSkipEditorial(state, baseDeps()).executar, true);
    assert.strictEqual(evaluateSkipEditorial(state, baseDeps()).regraDecisiva, 'V01');
}

// parcial: nunca skip
{
    const state = buildState({ regimeSolucao: REGIME_SOLUCAO.PARCIAL });
    state.insumosPreparados.matrizAutoridade.lacunasDetectadas = ['solucao_implementada_incompleta'];
    assert.strictEqual(evaluateSkipFactual(state, baseDeps({ skipFactualTier1Enabled: true })).executar, true);
    assert.strictEqual(evaluateSkipEditorial(state, baseDeps()).executar, true);
}

// executorRetryCount > 0: nunca skip
{
    const state = buildState({ executorRetryCount: 1 });
    assert.strictEqual(evaluateSkipEditorial(state, baseDeps()).executar, true);
    assert.strictEqual(evaluateSkipEditorial(state, baseDeps()).regraDecisiva, 'V03');
}

// factual skip tier1 com sub-flag
{
    const state = buildState();
    const d = evaluateSkipFactual(state, baseDeps({ skipFactualTier1Enabled: true }));
    assert.strictEqual(d.executar, false);
    assert.strictEqual(d.codigoMotivo, SKIP_MOTIVO.FACTUAL_TIER1);
}

// factual skip + editorial: anti skip-duplo
{
    const state = buildState();
    state.factualAuditorSkipped = true;
    const d = evaluateSkipEditorial(state, baseDeps());
    assert.strictEqual(d.executar, true);
    assert.ok(d.regraDecisiva === 'E05' || d.regraDecisiva === 'E06');
}

// reprodutibilidade
{
    const state = buildState();
    const deps = baseDeps();
    const d1 = evaluateSkipEditorial(state, deps);
    const d2 = evaluateSkipEditorial(state, deps);
    assert.deepStrictEqual(
        { executar: d1.executar, regraDecisiva: d1.regraDecisiva, codigoMotivo: d1.codigoMotivo },
        { executar: d2.executar, regraDecisiva: d2.regraDecisiva, codigoMotivo: d2.codigoMotivo }
    );
}

// precedencia: V03 prevalece sobre F01-F08 satisfeitas
{
    const state = buildState({ executorRetryCount: 1 });
    const d = evaluateSkipFactual(state, baseDeps({ skipFactualTier1Enabled: true }));
    assert.strictEqual(d.executar, true);
    assert.strictEqual(d.regraDecisiva, 'V03');
    assert.strictEqual(d.fasePrecedencia, FASE.VETO);
}

// precedencia: flag master off — nivel 2, nivel 3 nao avaliado
{
    const state = buildState();
    const d = evaluateSkipEditorial(state, baseDeps({ conditionalAuditEnabled: false }));
    assert.strictEqual(d.executar, true);
    assert.strictEqual(d.regraDecisiva, 'flag.master_off');
    assert.strictEqual(d.fasePrecedencia, FASE.FLAG);
    assert.ok(!d.regrasAvaliadas.includes('E01'));
}

// factual tier1 off por default
{
    const state = buildState();
    const d = evaluateSkipFactual(state, baseDeps());
    assert.strictEqual(d.executar, true);
    assert.strictEqual(d.regraDecisiva, 'flag.factual_tier1_off');
}

// complementar: nunca skip editorial
{
    const state = buildState({ modoOperacao: MODO_OPERACAO.COMPLEMENTAR });
    const d = evaluateSkipEditorial(state, baseDeps());
    assert.strictEqual(d.executar, true);
    assert.strictEqual(d.regraDecisiva, 'E02');
}

console.log('resposta-pipeline/__tests__/auditorSkipPolicy.test.js — OK');
