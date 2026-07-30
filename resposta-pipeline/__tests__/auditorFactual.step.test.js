'use strict';

const assert = require('assert');
const { AUDITOR_FACTUAL, mapVereditoFromParsed } = require('../steps');
const { createWorkflowState } = require('../workflowState');
const { SCHEMA_VERSION } = require('../constants');

const state = createWorkflowState({
    dadosFormulario: {
        solucao_implementada: 'Cliente contatado.',
        texto_cliente: 'Aguardo restituicao'
    }
});
state.insumosPreparados = {
    regimeSolucao: 'parcial',
    casoNormalizado: { texto_cliente: 'Aguardo', solucao_implementada: 'Cliente contatado.' },
    matrizAutoridade: { fatosAutorizados: [{ texto: 'Cliente contatado.' }] }
};
state.planoDeResposta = { fatosAutorizados: ['Cliente contatado'] };
state.rascunhoMiolo = { schemaVersion: SCHEMA_VERSION, conteudo: 'Cliente contatado. Orientado.' };

const ctx = AUDITOR_FACTUAL.buildCtx(state, {});
assert.ok(ctx.regimeSolucao === 'parcial');
assert.ok(ctx.rascunhoMiolo.includes('Cliente contatado'));
assert.ok(ctx.planoDeResposta.includes('fatosAutorizados'));

const parsed = {
    schema_version: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'factual.inventao',
        descricao: 'Protocolo inventado',
        trecho: '12345',
        severidade: 'ERROR'
    }],
    recomendacao_retry: 'executor',
    _claims_trace: [{ id: 'c1', texto: 'protocolo 12345', status: 'nao_autorizada' }]
};

const partial = AUDITOR_FACTUAL.toPartial(parsed);
assert.strictEqual(partial.vereditoFactual.aprovado, false);
assert.strictEqual(partial.vereditoFactual.recomendacaoRetry, 'executor');
assert.strictEqual(partial.vereditoFactual.falhas[0].tipo, 'factual.inventao');
assert.strictEqual(partial.vereditoFactual._claims_trace, undefined);

const mapped = mapVereditoFromParsed(parsed);
assert.strictEqual(mapped.recomendacaoRetry, 'executor');

console.log('resposta-pipeline/__tests__/auditorFactual.step.test.js — OK');
