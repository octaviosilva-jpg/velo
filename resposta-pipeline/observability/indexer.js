'use strict';

const fs = require('fs');
const path = require('path');
const persistence = require('../persistence');
const { extractExecutionSnapshot } = require('./executionExtractor');
const { updateAggregatesForSnapshot } = require('./aggregator');
const {
    META_DIR,
    SNAPSHOTS_DIR,
    MANIFEST_FILE,
    LAST_INDEXED_FILE,
    METRICS_VERSION_FILE
} = require('./constants');
const { getMetricsVersionInfo } = require('./metricsCatalog');

function ensureDirs() {
    fs.mkdirSync(META_DIR, { recursive: true });
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

function loadManifest() {
    ensureDirs();
    if (!fs.existsSync(MANIFEST_FILE)) {
        return { executionIds: [], metricsVersion: require('./constants').METRICS_VERSION };
    }
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

function saveManifest(manifest) {
    ensureDirs();
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

function saveLastIndexed(executionId) {
    ensureDirs();
    const manifest = loadManifest();
    fs.writeFileSync(LAST_INDEXED_FILE, JSON.stringify({
        executionId,
        ts: new Date().toISOString(),
        count: manifest.executionIds.length
    }, null, 2), 'utf8');
}

function initMetricsVersionFile() {
    ensureDirs();
    if (!fs.existsSync(METRICS_VERSION_FILE)) {
        fs.writeFileSync(METRICS_VERSION_FILE, JSON.stringify(getMetricsVersionInfo(), null, 2), 'utf8');
    }
}

function snapshotPath(snapshot) {
    const day = (snapshot.timestamp || '').slice(0, 10) || 'unknown';
    const dir = path.join(SNAPSHOTS_DIR, day);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${snapshot.executionId}.snapshot.json`);
}

function loadWorkflowState(executionId) {
    const mem = persistence.getFromMemoria(executionId);
    if (mem) return mem;

    const pevFile = path.join(persistence._PEV_DIR, `${executionId}.json`);
    if (fs.existsSync(pevFile)) {
        return JSON.parse(fs.readFileSync(pevFile, 'utf8'));
    }
    return null;
}

function indexExecution(executionId, { force = false } = {}) {
    initMetricsVersionFile();
    const manifest = loadManifest();
    if (!force && manifest.executionIds.includes(executionId)) {
        return { indexed: false, reason: 'already_indexed', executionId };
    }

    const state = loadWorkflowState(executionId);
    if (!state) {
        return { indexed: false, reason: 'state_not_found', executionId };
    }

    const snapshot = extractExecutionSnapshot(state);
    const fp = snapshotPath(snapshot);
    fs.writeFileSync(fp, JSON.stringify(snapshot, null, 2), 'utf8');

    if (!manifest.executionIds.includes(executionId)) {
        manifest.executionIds.push(executionId);
    }
    saveManifest(manifest);
    saveLastIndexed(executionId);

    const periods = updateAggregatesForSnapshot(snapshot);
    return { indexed: true, executionId, snapshot, periods };
}

function scheduleIndex(executionId, deps = {}) {
    setImmediate(() => {
        try {
            indexExecution(executionId);
        } catch (err) {
            const msg = `[observability/indexer] falha ao indexar ${executionId}: ${err.message}`;
            if (typeof deps.onError === 'function') deps.onError(msg, err);
            else console.error(msg);
        }
    });
}

function reindexAll({ force = false } = {}) {
    initMetricsVersionFile();
    const pevDir = persistence._PEV_DIR;
    if (!fs.existsSync(pevDir)) {
        return { indexed: 0, errors: [] };
    }

    const files = fs.readdirSync(pevDir).filter(f => f.endsWith('.json'));
    let indexed = 0;
    const errors = [];

    for (const file of files) {
        const executionId = file.replace('.json', '');
        try {
            const result = indexExecution(executionId, { force });
            if (result.indexed) indexed += 1;
        } catch (err) {
            errors.push({ executionId, error: err.message });
        }
    }

    return { indexed, total: files.length, errors };
}

function readSnapshot(executionId) {
    const manifest = loadManifest();
    if (!manifest.executionIds.includes(executionId)) return null;

    const pevDir = persistence._PEV_DIR;
    const stateFile = path.join(pevDir, `${executionId}.json`);
    if (!fs.existsSync(stateFile)) {
        const mem = persistence.getFromMemoria(executionId);
        if (mem) return extractExecutionSnapshot(mem);
        return null;
    }

    const dayPrefix = executionId.split('-')[0];
    const candidates = fs.readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(SNAPSHOTS_DIR, d.name, `${executionId}.snapshot.json`));

    for (const fp of candidates) {
        if (fs.existsSync(fp)) {
            return JSON.parse(fs.readFileSync(fp, 'utf8'));
        }
    }

    const state = loadWorkflowState(executionId);
    return state ? extractExecutionSnapshot(state) : null;
}

module.exports = {
    ensureDirs,
    loadManifest,
    indexExecution,
    scheduleIndex,
    reindexAll,
    readSnapshot,
    loadWorkflowState
};
