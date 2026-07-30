'use strict';

const assert = require('assert');
const { AUDITOR_EDITORIAL, EXECUTOR, mapVereditoFromParsed } = require('../steps');
const { createWorkflowState } = require('../workflowState');
const { SCHEMA_VERSION } = require('../constants');

const state = createWorkflowState({
    dadosFormulario: {
        solucao_implementada: 'Cliente contatado.',
        texto_cliente: 'Aguardo restituicao',
        motivo_solicitacao: 'atraso'
    }
});
state.insumosPreparados = {
    regimeSolucao: 'parcial',
    casoNormalizado: {
        texto_cliente: 'Aguardo',
        motivo_solicitacao: 'atraso',
        tipo_solicitacao: 'restituicao'
    },
    kitReferencia: { checklistRA: 'Regra AENV: seja objetivo.' }
};
state.planoDeResposta = {
    planoArgumentativo: [{ funcao: 'resposta_direta', pontosObrigatorios: ['Status'], profundidadeEsperada: 'padrao' }]
};
state.rascunhoMiolo = { schemaVersion: SCHEMA_VERSION, conteudo: 'Cliente contatado. Orientado.' };

const ctx = AUDITOR_EDITORIAL.buildCtx(state, {});
assert.ok(ctx.regimeSolucao === 'parcial');
assert.ok(ctx.rascunhoMiolo.includes('Cliente contatado'));
assert.ok(ctx.checklistRA.includes('AENV'));
assert.ok(ctx.palavrasGenericas);

const parsed = {
    schema_version: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'editorial.evasao_sac',
        descricao: 'Empurra para central',
        trecho: 'ligue para',
        severidade: 'ERROR'
    }],
    recomendacao_retry: 'executor',
    _rubrica_trace: [{ criterio: 'resolutividade', status: 'falha', evidencia: 'evasao' }]
};

const partial = AUDITOR_EDITORIAL.toPartial(parsed);
assert.strictEqual(partial.vereditoEditorial.aprovado, false);
assert.strictEqual(partial.vereditoEditorial.recomendacaoRetry, 'executor');
assert.strictEqual(partial.vereditoEditorial._rubrica_trace, undefined);

const execCtx = EXECUTOR.buildCtx(state, {
    editorialFeedback: partial.vereditoEditorial
});
assert.ok(execCtx.editorialFeedback.includes('editorial.evasao_sac'));

const mapped = mapVereditoFromParsed(parsed);
assert.strictEqual(mapped.recomendacaoRetry, 'executor');

console.log('resposta-pipeline/__tests__/auditorEditorial.step.test.js — OK');
