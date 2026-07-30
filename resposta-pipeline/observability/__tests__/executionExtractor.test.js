'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { extractExecutionSnapshot } = require('../executionExtractor');

const fase4 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pev-fase4-sample.json'), 'utf8'));
const fase1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pev-fase1-sample.json'), 'utf8'));

const snap4 = extractExecutionSnapshot(fase4);
assert.strictEqual(snap4.executionId, '1730000000000-test-exec-fase4');
assert.strictEqual(snap4.editorialSkipped, true);
assert.strictEqual(snap4.factualExecutado, true);
assert.strictEqual(snap4.editorialExecutado, false);
assert.strictEqual(snap4.gateAprovadoPrimeiraPassagem, true);
assert.strictEqual(snap4.openaiCallCount, 3);
assert.ok(snap4.totalTokens > 0);
assert.strictEqual(snap4.regimeSolucao, 'completa');
assert.strictEqual(snap4.modoOperacao, 'refinar');

const snap1 = extractExecutionSnapshot(fase1);
assert.strictEqual(snap1.factualExecutado, false);
assert.strictEqual(snap1.editorialSkipped, false);
assert.strictEqual(snap1.factualSkipped, false);
assert.strictEqual(snap1.regimeSolucao, 'parcial');

const snap4b = extractExecutionSnapshot(fase4);
assert.deepStrictEqual(
    { id: snap4.executionId, skip: snap4.editorialSkipped },
    { id: snap4b.executionId, skip: snap4b.editorialSkipped }
);

console.log('observability/__tests__/executionExtractor.test.js — OK');
