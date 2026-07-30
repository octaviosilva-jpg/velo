'use strict';

const assert = require('assert');
const { isVereditoEditorialValid, SCHEMA_VERSION } = require('../contracts');
const { RECOMENDACAO_RETRY, SEVERIDADE } = require('../constants');

const aprovado = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: true,
    falhas: [],
    recomendacaoRetry: RECOMENDACAO_RETRY.NENHUM
};
assert.ok(isVereditoEditorialValid(aprovado));

const reprovado = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{
        tipo: 'editorial.evasao_sac',
        descricao: 'Empurra para SAC',
        trecho: 'entre em contato',
        severidade: SEVERIDADE.ERROR
    }],
    recomendacaoRetry: RECOMENDACAO_RETRY.EXECUTOR
};
assert.ok(isVereditoEditorialValid(reprovado));

const prefixoInvalido = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'factual.inventao', descricao: 'x', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.EXECUTOR
};
assert.strictEqual(isVereditoEditorialValid(prefixoInvalido), false);

const plannerProibido = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'editorial.tom', descricao: 'x', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.PLANNER
};
assert.strictEqual(isVereditoEditorialValid(plannerProibido), false);

const reprovadoSemRetry = {
    schemaVersion: SCHEMA_VERSION,
    aprovado: false,
    falhas: [{ tipo: 'editorial.generico', descricao: 'x', severidade: SEVERIDADE.ERROR }],
    recomendacaoRetry: RECOMENDACAO_RETRY.NENHUM
};
assert.strictEqual(isVereditoEditorialValid(reprovadoSemRetry), false);

console.log('resposta-pipeline/__tests__/contracts.editorial.test.js — OK');
