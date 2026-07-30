'use strict';

const assert = require('assert');
const {
    isPlanoDeRespostaValid,
    assertFatosSubset,
    isRascunhoMioloValid,
    isVereditoEnvelopeValid,
    SCHEMA_VERSION
} = require('../contracts');
const { RECOMENDACAO_RETRY, SEVERIDADE } = require('../constants');

const planoValido = {
    schemaVersion: SCHEMA_VERSION,
    problemaCentral: 'Atraso na restituicao',
    entendimentoSituacional: 'Cliente aguarda credito',
    modoOperacao: 'complementar',
    fontePrimaria: 'misto',
    fatosAutorizados: ['Cliente contatado'],
    fundamentacoesObrigatorias: ['Prazo informado'],
    estrategiaResolucao: 'Explicar status e orientacao',
    planoArgumentativo: [{
        funcao: 'resposta_direta',
        pontosObrigatorios: ['Informar status'],
        profundidadeEsperada: 'padrao'
    }],
    exclusoes: ['empurrar para SAC'],
    coerentesUtilizadas: [{ id: 'c1', similaridadePct: 80, motivo: 'restituicao', tipo: 'restituicao' }]
};

assert.ok(isPlanoDeRespostaValid(planoValido));

const matriz = {
    fatosAutorizados: [{ origem: 'solucao_implementada', texto: 'Cliente contatado. Orientado a acompanhar.' }]
};
assert.ok(assertFatosSubset(planoValido, matriz).ok);

const rascunho = { schemaVersion: SCHEMA_VERSION, conteudo: 'Miolo resolutivo completo.' };
assert.ok(isRascunhoMioloValid(rascunho));

const veredito = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'gate.comprimento', descricao: 'curto', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.EXECUTOR
};
assert.ok(isVereditoEnvelopeValid(veredito));

assert.strictEqual(isPlanoDeRespostaValid({ schemaVersion: '2.0' }), false);

console.log('resposta-pipeline/__tests__/contracts.test.js — OK');
