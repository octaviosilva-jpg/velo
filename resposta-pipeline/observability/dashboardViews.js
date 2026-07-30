'use strict';

const {
    getResumo,
    getPipelineMetrics,
    getPlannerMetrics,
    getExecutorGateMetrics,
    getAuditoresMetrics,
    getSkipPolicyMetrics,
    getShadowMetrics,
    getQualidadeMetrics,
    getDailySeries
} = require('./queryService');

function buildExecutivoView(opts) {
    const resumo = getResumo(opts);
    const serie = getDailySeries(opts?.periodo || '30d');
    return {
        tipo: 'executivo',
        ...resumo,
        serieDiaria: serie
    };
}

function buildTecnicoView(opts) {
    return {
        tipo: 'tecnico',
        pipeline: getPipelineMetrics(opts),
        planner: getPlannerMetrics(opts),
        executorGate: getExecutorGateMetrics(opts),
        auditores: getAuditoresMetrics(opts),
        skipPolicy: getSkipPolicyMetrics(opts)
    };
}

function buildShadowView(opts) {
    return {
        tipo: 'shadow',
        ...getShadowMetrics(opts)
    };
}

function buildQualidadeView(opts) {
    return {
        tipo: 'qualidade',
        ...getQualidadeMetrics(opts)
    };
}

module.exports = {
    buildExecutivoView,
    buildTecnicoView,
    buildShadowView,
    buildQualidadeView
};
