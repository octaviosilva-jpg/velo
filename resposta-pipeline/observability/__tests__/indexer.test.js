'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const persistence = require('../../persistence');
const { indexExecution } = require('../indexer');
const { extractExecutionSnapshot } = require('../executionExtractor');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pev-fase4-sample.json'), 'utf8'));
const execId = `test-indexer-${Date.now()}`;
sample.executionId = execId;

fs.mkdirSync(persistence._PEV_DIR, { recursive: true });
fs.writeFileSync(path.join(persistence._PEV_DIR, `${execId}.json`), JSON.stringify(sample), 'utf8');

const result = indexExecution(execId);
assert.strictEqual(result.indexed, true);
assert.ok(result.snapshot);
assert.strictEqual(result.snapshot.executionId, execId);

const again = indexExecution(execId);
assert.strictEqual(again.indexed, false);
assert.strictEqual(again.reason, 'already_indexed');

const forced = indexExecution(execId, { force: true });
assert.strictEqual(forced.indexed, true);

const snap = extractExecutionSnapshot(sample);
assert.strictEqual(snap.editorialSkipped, true);

console.log('observability/__tests__/indexer.test.js — OK');
