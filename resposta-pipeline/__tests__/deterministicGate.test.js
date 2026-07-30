'use strict';

const assert = require('assert');
const { validateMiolo, getComprimentoMinimo } = require('../deterministicGate');
const { REGIME_SOLUCAO, RECOMENDACAO_RETRY } = require('../constants');

assert.strictEqual(getComprimentoMinimo(REGIME_SOLUCAO.VAZIA), 700);
assert.strictEqual(getComprimentoMinimo(REGIME_SOLUCAO.COMPLETA), 120);

const textoLongo = 'Cliente orientado sobre restituicao e prazo com detalhes adicionais. '.repeat(3);
const ok = validateMiolo(textoLongo, {
    solucaoImplementada: 'Cliente orientado sobre restituicao e prazo',
    regimeSolucao: REGIME_SOLUCAO.COMPLETA
});
assert.ok(ok.aprovado);

const generico = validateMiolo(
    'A situação atual necessita de análise detalhada. '.repeat(50),
    { solucaoImplementada: '', regimeSolucao: REGIME_SOLUCAO.VAZIA }
);
assert.strictEqual(generico.aprovado, false);
assert.ok(generico.falhas.some(f => f.tipo === 'gate.generico'));

const curto = validateMiolo('texto curto', {
    solucaoImplementada: 'solucao implementada detalhada',
    regimeSolucao: REGIME_SOLUCAO.COMPLETA
});
assert.strictEqual(curto.aprovado, false);
assert.strictEqual(curto.recomendacaoRetry, RECOMENDACAO_RETRY.EXECUTOR);

console.log('resposta-pipeline/__tests__/deterministicGate.test.js — OK');
