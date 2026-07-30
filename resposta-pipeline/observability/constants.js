'use strict';

const path = require('path');

const METRICS_VERSION = '1.0';

const OBS_ROOT = path.join(__dirname, '..', '..', 'data', 'pev_observability');
const META_DIR = path.join(OBS_ROOT, 'meta');
const SNAPSHOTS_DIR = path.join(OBS_ROOT, 'snapshots', 'by_date');
const AGGREGATES_DIR = path.join(OBS_ROOT, 'aggregates');
const EXPORTS_DIR = path.join(OBS_ROOT, 'exports');

const MANIFEST_FILE = path.join(META_DIR, 'index_manifest.json');
const LAST_INDEXED_FILE = path.join(META_DIR, 'last_indexed.json');
const METRICS_VERSION_FILE = path.join(META_DIR, 'metrics_version.json');

const RETENTION = {
    snapshotsDays: 90,
    dailyDays: 365,
    weeklyDays: 730,
    exportsDays: 7
};

module.exports = {
    METRICS_VERSION,
    OBS_ROOT,
    META_DIR,
    SNAPSHOTS_DIR,
    AGGREGATES_DIR,
    EXPORTS_DIR,
    MANIFEST_FILE,
    LAST_INDEXED_FILE,
    METRICS_VERSION_FILE,
    RETENTION
};
