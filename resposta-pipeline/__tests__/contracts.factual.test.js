'use strict';

const assert = require('assert');
const { isVereditoFactualValid, SCHEMA_VERSION } = require('../contracts');
const { RECOMENDACAO_RETRY, SEVERIDADE } = require('../constants');

const aprovado = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacaoRetry: RECOMENDACAO_RETRY.NENHUM
};
assert.ok(isVereditoFactualValid(aprovado));

const reprovado = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'factual.inventao',
        descricao: 'Fato inventado',
        trecho: 'protocolo 12345',
        severidade: SEVERIDADE.ERROR
    }],
    recomendacaoRetry: RECOMENDACAO_RETRY.EXECUTOR
};
assert.ok(isVereditoFactualValid(reprovado));

const prefixoInvalido = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'gate.comprimento', descricao: 'curto', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.EXECUTOR
};
assert.strictEqual(isVereditoFactualValid(prefixoInvalido), false);

const aprovadoComFalhas = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: true,
    falhas: [{ tipo: 'factual.omissao', descricao: 'x', severidade: SEVERIDADE.WARNING }],
    recomendacaoRetry: RECOMENDACAO_RETRY.NENHUM
};
assert.strictEqual(isVereditoFactualValid(aprovadoComFalhas), false);

const reprovadoSemRetry = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'factual.contradicao', descricao: 'x', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.NENHUM
};
assert.strictEqual(isVereditoFactualValid(reprovadoSemRetry), false);

console.log('resposta-pipeline/__tests__/contracts.factual.test.js — OK');
