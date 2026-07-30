'use strict';

const { listAggregatesInRange, readAggregate, mergeAggregates, emptyAggregate, finalizeAggregate } = require('./aggregator');
const { readSnapshot, loadManifest, loadWorkflowState } = require('./indexer');
const { METRICS_VERSION } = require('./constants');

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function resolvePeriod(periodo = '7d') {
    const end = todayISO();
    const d = new Date();
    if (periodo === 'hoje') {
        return { start: end, end, granularity: 'daily' };
    }
    if (periodo === '7d') {
        d.setDate(d.getDate() - 6);
        return { start: d.toISOString().slice(0, 10), end, granularity: 'daily' };
    }
    if (periodo === '30d') {
        d.setDate(d.getDate() - 29);
        return { start: d.toISOString().slice(0, 10), end, granularity: 'daily' };
    }
    return { start: null, end, granularity: 'daily' };
}

function mergeDailyAggregates(aggregates) {
    if (!aggregates.length) {
        return finalizeAggregate(emptyAggregate('none', 'daily'));
    }
    let merged = aggregates[0];
    for (let i = 1; i < aggregates.length; i++) {
        merged = mergeAggregates(merged, aggregates[i]);
    }
    merged.periodo = `${aggregates[0].periodo}..${aggregates[aggregates.length - 1].periodo}`;
    return merged;
}

function filterEstratos(agg, { regimeSolucao, modoOperacao } = {}) {
    if (!regimeSolucao && !modoOperacao) return agg;
    const estratos = {};
    for (const [k, v] of Object.entries(agg.estratos || {})) {
        const [reg, modo] = k.split('|');
        if (regimeSolucao && reg !== regimeSolucao) continue;
        if (modoOperacao && modo !== modoOperacao) continue;
        estratos[k] = v;
    }
    return { ...agg, estratos };
}

function getResumo({ periodo = '7d', dataInicio, dataFim, regimeSolucao, modoOperacao } = {}) {
    const p = dataInicio && dataFim
        ? { start: dataInicio, end: dataFim, granularity: 'daily' }
        : resolvePeriod(periodo);
    const aggregates = listAggregatesInRange('daily', p.start, p.end);
    const merged = filterEstratos(mergeDailyAggregates(aggregates), { regimeSolucao, modoOperacao });
    return {
        enabled: true,
        metricsVersion: METRICS_VERSION,
        periodo: merged.periodo,
        execucoes: merged.execucoes,
        pipeline: merged.pipeline,
        financeiro: merged.financeiro,
        skipPolicy: {
            taxaSkipFactual: merged.skipPolicy.taxaSkipFactual,
            taxaSkipEditorial: merged.skipPolicy.taxaSkipEditorial,
            divergenciaShadow: merged.skipPolicy.divergenciaShadow
        }
    };
}

function getPipelineMetrics(opts = {}) {
    const p = opts.dataInicio && opts.dataFim
        ? { start: opts.dataInicio, end: opts.dataFim }
        : resolvePeriod(opts.periodo || '7d');
    const merged = filterEstratos(
        mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end)),
        opts
    );
    return { metricsVersion: METRICS_VERSION, pipeline: merged.pipeline, execucoes: merged.execucoes };
}

function getPlannerMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const merged = mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end));
    return { metricsVersion: METRICS_VERSION, planner: merged.planner, execucoes: merged.execucoes };
}

function getExecutorGateMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const merged = mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end));
    return {
        metricsVersion: METRICS_VERSION,
        executor: merged.executor,
        gate: merged.gate,
        execucoes: merged.execucoes
    };
}

function getAuditoresMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const merged = mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end));
    return {
        metricsVersion: METRICS_VERSION,
        factual: merged.factual,
        editorial: merged.editorial,
        execucoes: merged.execucoes
    };
}

function getSkipPolicyMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const merged = mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end));
    return {
        metricsVersion: METRICS_VERSION,
        skipPolicy: merged.skipPolicy,
        estratos: merged.estratos,
        execucoes: merged.execucoes
    };
}

function getShadowMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const aggregates = listAggregatesInRange('daily', p.start, p.end);
    const manifest = loadManifest();
    const divergencias = [];

    for (const id of manifest.executionIds.slice(-500)) {
        const snap = readSnapshot(id);
        if (!snap || !snap.shadowDivergencias?.length) continue;
        const day = (snap.timestamp || '').slice(0, 10);
        if (p.start && day < p.start) continue;
        if (p.end && day > p.end) continue;
        for (const d of snap.shadowDivergencias) {
            divergencias.push({
                executionId: snap.executionId,
                timestamp: snap.timestamp,
                regimeSolucao: snap.regimeSolucao,
                modoOperacao: snap.modoOperacao,
                ...d
            });
        }
    }

    const merged = mergeDailyAggregates(aggregates);
    return {
        metricsVersion: METRICS_VERSION,
        divergenciaShadow: merged.skipPolicy.divergenciaShadow,
        shadowAvaliacoes: merged.skipPolicy.shadowAvaliacoes,
        shadowDivergencias: merged.skipPolicy.shadowDivergencias,
        divergencias,
        serieDiaria: aggregates.map(a => ({
            periodo: a.periodo,
            divergenciaShadow: a.skipPolicy.divergenciaShadow,
            shadowAvaliacoes: a.skipPolicy.shadowAvaliacoes
        }))
    };
}

function getQualidadeMetrics(opts) {
    const p = resolvePeriod(opts?.periodo || '7d');
    const merged = mergeDailyAggregates(listAggregatesInRange('daily', p.start, p.end));
    return {
        metricsVersion: METRICS_VERSION,
        factual: {
            taxaAprovacao: merged.factual.taxaAprovacao,
            falhasPorTipo: merged.factual.falhasPorTipo
        },
        editorial: {
            taxaAprovacao: merged.editorial.taxaAprovacao,
            falhasPorTipo: merged.editorial.falhasPorTipo
        },
        gate: { falhasPorTipo: merged.gate.falhasPorTipo },
        estratos: merged.estratos,
        execucoes: merged.execucoes
    };
}

function getExecucao(executionId) {
    const snapshot = readSnapshot(executionId);
    if (!snapshot) return null;
    return {
        metricsVersion: METRICS_VERSION,
        snapshot,
        rawAvailable: !!loadWorkflowState(executionId)
    };
}

function getDailySeries(periodo = '30d') {
    const p = resolvePeriod(periodo);
    return listAggregatesInRange('daily', p.start, p.end).map(a => ({
        periodo: a.periodo,
        execucoes: a.execucoes,
        sucesso: a.pipeline.sucesso,
        fallback: a.pipeline.fallback,
        duracaoMsP95: a.pipeline.duracaoMsP95,
        tokensTotal: a.pipeline.tokensTotal,
        tokensEconomizados: a.financeiro.tokensEconomizadosTotais,
        custoTotal: a.pipeline.custoTotal
    }));
}

module.exports = {
    resolvePeriod,
    getResumo,
    getPipelineMetrics,
    getPlannerMetrics,
    getExecutorGateMetrics,
    getAuditoresMetrics,
    getSkipPolicyMetrics,
    getShadowMetrics,
    getQualidadeMetrics,
    getExecucao,
    getDailySeries,
    readAggregate
};
