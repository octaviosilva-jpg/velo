'use strict';

const observability = {
    constants: require('./constants'),
    metricsCatalog: require('./metricsCatalog'),
    percentiles: require('./percentiles'),
    executionExtractor: require('./executionExtractor'),
    aggregator: require('./aggregator'),
    indexer: require('./indexer'),
    queryService: require('./queryService'),
    exportService: require('./exportService'),
    dashboardViews: require('./dashboardViews')
};

function isPevObservabilityEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_OBSERVABILITY_ENABLED
        || process.env.PEV_OBSERVABILITY_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevObservabilityExportsEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_OBSERVABILITY_EXPORTS
        || process.env.PEV_OBSERVABILITY_EXPORTS
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

module.exports = {
    ...observability,
    isPevObservabilityEnabled,
    isPevObservabilityExportsEnabled
};
