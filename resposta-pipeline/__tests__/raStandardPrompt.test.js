'use strict';

const assert = require('assert');
const {
    SYSTEM_PROMPT_RA,
    buildRetryPromptCorrecao,
    buildRetryPromptDesenvolvimento,
    isSemSolucaoImplementada,
    validateMioloLikeMonolith,
    pickBestCandidate
} = require('../shared/raStandardPrompt');

assert.ok(SYSTEM_PROMPT_RA.includes('Velotax'));
assert.ok(SYSTEM_PROMPT_RA.includes('RESOLVER'));

const base = 'SCRIPT BASE';
const dfComSolucao = {
    solucao_implementada: 'Cliente contatado. Protocolo 12345. Orientado sobre prazo.',
    texto_cliente: 'Reclamação teste'
};
const dfSemSolucao = {
    solucao_implementada: '',
    texto_cliente: 'Reclamação teste'
};

assert.strictEqual(isSemSolucaoImplementada(dfSemSolucao), true);
assert.strictEqual(isSemSolucaoImplementada(dfComSolucao), false);

const correcao = buildRetryPromptCorrecao(base, dfComSolucao);
assert.ok(correcao.includes('CORREÇÃO OBRIGATÓRIA'));
assert.ok(correcao.includes('Protocolo 12345'));

const dev = buildRetryPromptDesenvolvimento(base, dfSemSolucao);
assert.ok(dev.includes('DESENVOLVIMENTO OBRIGATÓRIO'));
assert.ok(dev.includes('4 a 6 parágrafos'));

const mioloOk = 'Cliente contatado. Protocolo 12345. ' + 'Detalhes sobre o caso. '.repeat(10);
const veredito = validateMioloLikeMonolith(mioloOk, dfComSolucao);
assert.strictEqual(veredito.aprovado, true);

const melhor = pickBestCandidate(['curto', mioloOk, 'medio ' + 'x'.repeat(50)]);
assert.strictEqual(melhor, mioloOk);

console.log('resposta-pipeline/__tests__/raStandardPrompt.test.js — OK');
