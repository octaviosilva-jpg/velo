'use strict';

const assert = require('assert');
const { computePercentiles, mean } = require('../percentiles');
const { buildAggregateFromSnapshots, mergeAggregates } = require('../aggregator');
const { extractExecutionSnapshot } = require('../executionExtractor');
const path = require('path');
const fs = require('fs');

const fase4 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pev-fase4-sample.json'), 'utf8'));
const snap = extractExecutionSnapshot(fase4);

const pct = computePercentiles([10, 20, 30, 40, 100]);
assert.strictEqual(pct.p50, 30);
assert.ok(pct.p95 >= 40);

assert.strictEqual(mean([2, 4, 6]), 4);

const agg = buildAggregateFromSnapshots([snap], '2026-07-30', 'daily');
assert.strictEqual(agg.execucoes, 1);
assert.strictEqual(agg.skipPolicy.skipEditorial, 1);
assert.strictEqual(agg.factual.executados, 1);
assert.ok(agg.pipeline.duracaoMsP50 == null || typeof agg.pipeline.duracaoMsP50 === 'number');

const agg2 = mergeAggregates(agg, agg);
assert.strictEqual(agg2.execucoes, 2);
assert.strictEqual(agg2.skipPolicy.skipEditorial, 2);

console.log('observability/__tests__/aggregator.test.js — OK');
