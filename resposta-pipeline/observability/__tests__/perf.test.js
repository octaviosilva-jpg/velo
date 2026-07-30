'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { extractExecutionSnapshot } = require('../executionExtractor');
const { buildAggregateFromSnapshots } = require('../aggregator');

const fixturesDir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

const t0 = Date.now();
const snapshots = files.map(f => extractExecutionSnapshot(JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'))));

for (let i = 0; i < 200; i++) {
    buildAggregateFromSnapshots(snapshots, '2026-07-30', 'daily');
}
const elapsed = Date.now() - t0;
assert.ok(elapsed < 5000, `perf too slow: ${elapsed}ms`);

console.log(`observability/__tests__/perf.test.js — OK (${elapsed}ms)`);
