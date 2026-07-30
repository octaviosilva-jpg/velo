'use strict';

const fs = require('fs');
const path = require('path');
const { METRICS_VERSION, AGGREGATES_DIR } = require('./constants');
const { computePercentiles, mean, incrementHistogram, mergeHistograms } = require('./percentiles');

function dateKeyFromTimestamp(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function weekKeyFromTimestamp(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKeyFromTimestamp(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 7);
}

function estratoKey(snapshot) {
    return `${snapshot.regimeSolucao || 'n/a'}|${snapshot.modoOperacao || 'n/a'}`;
}

function emptyAggregate(periodo, granularity) {
    return {
        metricsVersion: METRICS_VERSION,
        periodo,
        granularity,
        geradoEm: new Date().toISOString(),
        execucoes: 0,
        pipeline: {
            sucesso: 0,
            fallback: 0,
            duracaoMs: [],
            openaiCallCount: [],
            tokensTotal: 0,
            custoTotal: 0
        },
        planner: {
            planosGerados: 0,
            distModoOperacao: {},
            distRegimeSolucao: {},
            distFontePrimaria: {},
            technicalRetriesTotal: 0
        },
        executor: {
            retriesTotal: 0,
            gatePrimeiraPassagem: 0,
            duracaoMs: []
        },
        gate: {
            aprovados: 0,
            falhasPorTipo: {}
        },
        factual: {
            executados: 0,
            skipped: 0,
            aprovados: 0,
            retriesTotal: 0,
            falhasPorTipo: {},
            duracaoMs: []
        },
        editorial: {
            executados: 0,
            skipped: 0,
            aprovados: 0,
            retriesTotal: 0,
            falhasPorTipo: {},
            duracaoMs: []
        },
        skipPolicy: {
            skipFactual: 0,
            skipEditorial: 0,
            distCodigoMotivo: {},
            distRegraDecisiva: {},
            distFasePrecedencia: {},
            shadowDivergencias: 0,
            shadowAvaliacoes: 0,
            tokensEconomizados: [],
            latenciaEconomizadaMs: []
        },
        financeiro: {
            tokensTotais: 0,
            tokensEconomizadosTotais: 0,
            custoTotal: 0,
            custoEconomizadoTotal: 0
        },
        estratos: {}
    };
}

function ensureEstrato(agg, key) {
    if (!agg.estratos[key]) {
        agg.estratos[key] = {
            execucoes: 0,
            skipFactual: 0,
            skipEditorial: 0,
            fallback: 0
        };
    }
    return agg.estratos[key];
}

function mergeSnapshotIntoAggregate(agg, s) {
    agg.execucoes += 1;

    if (!s.usedFallback) agg.pipeline.sucesso += 1;
    else agg.pipeline.fallback += 1;
    if (s.duracaoMs != null) agg.pipeline.duracaoMs.push(s.duracaoMs);
    agg.pipeline.openaiCallCount.push(s.openaiCallCount || 0);
    agg.pipeline.tokensTotal += s.totalTokens || 0;
    agg.pipeline.custoTotal += s.custoEstimado || 0;

    if (s.plannerGenerated) agg.planner.planosGerados += 1;
    incrementHistogram(agg.planner.distModoOperacao, s.modoOperacao);
    incrementHistogram(agg.planner.distRegimeSolucao, s.regimeSolucao);
    incrementHistogram(agg.planner.distFontePrimaria, s.fontePrimaria);
    agg.planner.technicalRetriesTotal += s.plannerTechnicalRetryCount || 0;

    agg.executor.retriesTotal += s.executorRetryCount || 0;
    if (s.gateAprovadoPrimeiraPassagem) agg.executor.gatePrimeiraPassagem += 1;
    if (s.executorDuracaoMs != null) agg.executor.duracaoMs.push(s.executorDuracaoMs);

    if (s.gateAprovadoPrimeiraPassagem || (s.gateFalhasTipos || []).length === 0) {
        agg.gate.aprovados += s.gateAprovadoPrimeiraPassagem ? 1 : 0;
    }
    for (const t of (s.gateFalhasTipos || [])) {
        incrementHistogram(agg.gate.falhasPorTipo, t);
    }

    if (s.factualExecutado) agg.factual.executados += 1;
    if (s.factualSkipped) agg.factual.skipped += 1;
    if (s.factualAprovado === true) agg.factual.aprovados += 1;
    agg.factual.retriesTotal += s.factualRetryCount || 0;
    for (const t of (s.factualFalhasTipos || [])) {
        incrementHistogram(agg.factual.falhasPorTipo, t);
    }
    if (s.factualDuracaoMs != null) agg.factual.duracaoMs.push(s.factualDuracaoMs);

    if (s.editorialExecutado) agg.editorial.executados += 1;
    if (s.editorialSkipped) agg.editorial.skipped += 1;
    if (s.editorialAprovado === true) agg.editorial.aprovados += 1;
    agg.editorial.retriesTotal += s.editorialRetryCount || 0;
    for (const t of (s.editorialFalhasTipos || [])) {
        incrementHistogram(agg.editorial.falhasPorTipo, t);
    }
    if (s.editorialDuracaoMs != null) agg.editorial.duracaoMs.push(s.editorialDuracaoMs);

    if (s.factualSkipped) agg.skipPolicy.skipFactual += 1;
    if (s.editorialSkipped) agg.skipPolicy.skipEditorial += 1;
    for (const d of (s.skipDecisions || [])) {
        incrementHistogram(agg.skipPolicy.distCodigoMotivo, d.codigoMotivo);
        incrementHistogram(agg.skipPolicy.distRegraDecisiva, d.regraDecisiva);
        if (d.fasePrecedencia != null) {
            incrementHistogram(agg.skipPolicy.distFasePrecedencia, String(d.fasePrecedencia));
        }
        if (d.shadowMode) agg.skipPolicy.shadowAvaliacoes += 1;
    }
    agg.skipPolicy.shadowDivergencias += (s.shadowDivergencias || []).length;
    if (s.tokensEconomizadosEstimados) {
        agg.skipPolicy.tokensEconomizados.push(s.tokensEconomizadosEstimados);
    }
    if (s.latenciaEconomizadaMs) {
        agg.skipPolicy.latenciaEconomizadaMs.push(s.latenciaEconomizadaMs);
    }

    agg.financeiro.tokensTotais += s.totalTokens || 0;
    agg.financeiro.tokensEconomizadosTotais += s.tokensEconomizadosEstimados || 0;
    agg.financeiro.custoTotal += s.custoEstimado || 0;
    agg.financeiro.custoEconomizadoTotal += s.custoEconomizadoEstimado || 0;

    const ek = estratoKey(s);
    const est = ensureEstrato(agg, ek);
    est.execucoes += 1;
    if (s.factualSkipped) est.skipFactual += 1;
    if (s.editorialSkipped) est.skipEditorial += 1;
    if (s.usedFallback) est.fallback += 1;

    return agg;
}

function finalizeAggregate(agg) {
    const execucoes = agg.execucoes || 0;
    const durPct = computePercentiles(agg.pipeline.duracaoMs);
    const execPct = computePercentiles(agg.executor.duracaoMs);

    agg.pipeline.taxaFallback = execucoes ? agg.pipeline.fallback / execucoes : 0;
    agg.pipeline.duracaoMsMedia = mean(agg.pipeline.duracaoMs);
    agg.pipeline.duracaoMsP50 = durPct.p50;
    agg.pipeline.duracaoMsP95 = durPct.p95;
    agg.pipeline.duracaoMsP99 = durPct.p99;
    agg.pipeline.openaiCallCountMedia = mean(agg.pipeline.openaiCallCount);
    agg.pipeline.custoMedioExecucao = execucoes ? agg.pipeline.custoTotal / execucoes : 0;

    agg.executor.gateTaxaPrimeiraPassagem = execucoes
        ? agg.executor.gatePrimeiraPassagem / execucoes
        : 0;
    agg.executor.retriesMedia = execucoes ? agg.executor.retriesTotal / execucoes : 0;
    agg.executor.duracaoMsMedia = mean(agg.executor.duracaoMs);

    const factualBase = agg.factual.executados + agg.factual.skipped;
    agg.factual.taxaExecucao = execucoes ? agg.factual.executados / execucoes : 0;
    agg.factual.taxaAprovacao = agg.factual.executados
        ? agg.factual.aprovados / agg.factual.executados
        : 0;
    agg.factual.retriesMedia = execucoes ? agg.factual.retriesTotal / execucoes : 0;
    agg.factual.duracaoMsMedia = mean(agg.factual.duracaoMs);

    agg.editorial.taxaExecucao = execucoes ? agg.editorial.executados / execucoes : 0;
    agg.editorial.taxaAprovacao = agg.editorial.executados
        ? agg.editorial.aprovados / agg.editorial.executados
        : 0;
    agg.editorial.retriesMedia = execucoes ? agg.editorial.retriesTotal / execucoes : 0;
    agg.editorial.duracaoMsMedia = mean(agg.editorial.duracaoMs);

    agg.skipPolicy.taxaSkipFactual = execucoes ? agg.skipPolicy.skipFactual / execucoes : 0;
    agg.skipPolicy.taxaSkipEditorial = execucoes ? agg.skipPolicy.skipEditorial / execucoes : 0;
    agg.skipPolicy.divergenciaShadow = agg.skipPolicy.shadowAvaliacoes
        ? agg.skipPolicy.shadowDivergencias / agg.skipPolicy.shadowAvaliacoes
        : 0;
    agg.skipPolicy.tokensEconomizadosMedia = mean(agg.skipPolicy.tokensEconomizados);
    agg.skipPolicy.latenciaEconomizadaMsMedia = mean(agg.skipPolicy.latenciaEconomizadaMs);

    const tokensBase = agg.financeiro.tokensTotais + agg.financeiro.tokensEconomizadosTotais;
    agg.financeiro.economiaPercentualTokens = tokensBase
        ? (agg.financeiro.tokensEconomizadosTotais / tokensBase) * 100
        : 0;
    agg.financeiro.custoMedioExecucao = execucoes ? agg.financeiro.custoTotal / execucoes : 0;

    delete agg.pipeline.duracaoMs;
    delete agg.pipeline.openaiCallCount;
    delete agg.executor.duracaoMs;
    delete agg.factual.duracaoMs;
    delete agg.editorial.duracaoMs;
    delete agg.skipPolicy.tokensEconomizados;
    delete agg.skipPolicy.latenciaEconomizadaMs;

    return agg;
}

function buildAggregateFromSnapshots(snapshots, periodo, granularity) {
    let agg = emptyAggregate(periodo, granularity);
    for (const s of snapshots) {
        agg = mergeSnapshotIntoAggregate(agg, s);
    }
    return finalizeAggregate(agg);
}

function aggregatePath(granularity, periodo) {
    return path.join(AGGREGATES_DIR, granularity, `${periodo}.json`);
}

function readAggregate(granularity, periodo) {
    const fp = aggregatePath(granularity, periodo);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeAggregate(agg, granularity) {
    const dir = path.join(AGGREGATES_DIR, granularity);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(aggregatePath(granularity, agg.periodo), JSON.stringify(agg, null, 2), 'utf8');
}

function mergeAggregates(base, incoming) {
    if (!base) return incoming;
    const merged = emptyAggregate(base.periodo, base.granularity);
    merged.execucoes = base.execucoes + incoming.execucoes;
    merged.pipeline.sucesso = base.pipeline.sucesso + incoming.pipeline.sucesso;
    merged.pipeline.fallback = base.pipeline.fallback + incoming.pipeline.fallback;
    merged.pipeline.tokensTotal = base.pipeline.tokensTotal + incoming.pipeline.tokensTotal;
    merged.pipeline.custoTotal = base.pipeline.custoTotal + incoming.pipeline.custoTotal;
    merged.planner.planosGerados = base.planner.planosGerados + incoming.planner.planosGerados;
    merged.planner.technicalRetriesTotal = base.planner.technicalRetriesTotal + incoming.planner.technicalRetriesTotal;
    merged.planner.distModoOperacao = mergeHistograms(base.planner.distModoOperacao, incoming.planner.distModoOperacao);
    merged.planner.distRegimeSolucao = mergeHistograms(base.planner.distRegimeSolucao, incoming.planner.distRegimeSolucao);
    merged.planner.distFontePrimaria = mergeHistograms(base.planner.distFontePrimaria, incoming.planner.distFontePrimaria);
    merged.executor.retriesTotal = base.executor.retriesTotal + incoming.executor.retriesTotal;
    merged.executor.gatePrimeiraPassagem = base.executor.gatePrimeiraPassagem + incoming.executor.gatePrimeiraPassagem;
    merged.gate.falhasPorTipo = mergeHistograms(base.gate.falhasPorTipo, incoming.gate.falhasPorTipo);
    merged.factual.executados = base.factual.executados + incoming.factual.executados;
    merged.factual.skipped = base.factual.skipped + incoming.factual.skipped;
    merged.factual.aprovados = base.factual.aprovados + incoming.factual.aprovados;
    merged.factual.retriesTotal = base.factual.retriesTotal + incoming.factual.retriesTotal;
    merged.factual.falhasPorTipo = mergeHistograms(base.factual.falhasPorTipo, incoming.factual.falhasPorTipo);
    merged.editorial.executados = base.editorial.executados + incoming.editorial.executados;
    merged.editorial.skipped = base.editorial.skipped + incoming.editorial.skipped;
    merged.editorial.aprovados = base.editorial.aprovados + incoming.editorial.aprovados;
    merged.editorial.retriesTotal = base.editorial.retriesTotal + incoming.editorial.retriesTotal;
    merged.editorial.falhasPorTipo = mergeHistograms(base.editorial.falhasPorTipo, incoming.editorial.falhasPorTipo);
    merged.skipPolicy.skipFactual = base.skipPolicy.skipFactual + incoming.skipPolicy.skipFactual;
    merged.skipPolicy.skipEditorial = base.skipPolicy.skipEditorial + incoming.skipPolicy.skipEditorial;
    merged.skipPolicy.distCodigoMotivo = mergeHistograms(base.skipPolicy.distCodigoMotivo, incoming.skipPolicy.distCodigoMotivo);
    merged.skipPolicy.distRegraDecisiva = mergeHistograms(base.skipPolicy.distRegraDecisiva, incoming.skipPolicy.distRegraDecisiva);
    merged.skipPolicy.distFasePrecedencia = mergeHistograms(base.skipPolicy.distFasePrecedencia, incoming.skipPolicy.distFasePrecedencia);
    merged.skipPolicy.shadowDivergencias = base.skipPolicy.shadowDivergencias + incoming.skipPolicy.shadowDivergencias;
    merged.skipPolicy.shadowAvaliacoes = base.skipPolicy.shadowAvaliacoes + incoming.skipPolicy.shadowAvaliacoes;
    merged.financeiro = {
        tokensTotais: base.financeiro.tokensTotais + incoming.financeiro.tokensTotais,
        tokensEconomizadosTotais: base.financeiro.tokensEconomizadosTotais + incoming.financeiro.tokensEconomizadosTotais,
        custoTotal: base.financeiro.custoTotal + incoming.financeiro.custoTotal,
        custoEconomizadoTotal: base.financeiro.custoEconomizadoTotal + incoming.financeiro.custoEconomizadoTotal
    };
    for (const [k, v] of Object.entries({ ...base.estratos, ...incoming.estratos })) {
        const b = base.estratos[k] || { execucoes: 0, skipFactual: 0, skipEditorial: 0, fallback: 0 };
        const i = incoming.estratos[k] || { execucoes: 0, skipFactual: 0, skipEditorial: 0, fallback: 0 };
        merged.estratos[k] = {
            execucoes: b.execucoes + i.execucoes,
            skipFactual: b.skipFactual + i.skipFactual,
            skipEditorial: b.skipEditorial + i.skipEditorial,
            fallback: b.fallback + i.fallback
        };
    }
    return finalizeAggregate(merged);
}

function updateAggregatesForSnapshot(snapshot) {
    const day = dateKeyFromTimestamp(snapshot.timestamp);
    const week = weekKeyFromTimestamp(snapshot.timestamp);
    const month = monthKeyFromTimestamp(snapshot.timestamp);
    if (!day) return { day, week, month };

    const dayAgg = mergeAggregates(readAggregate('daily', day), buildAggregateFromSnapshots([snapshot], day, 'daily'));
    writeAggregate(dayAgg, 'daily');

    if (week) {
        const weekAgg = mergeAggregates(readAggregate('weekly', week), buildAggregateFromSnapshots([snapshot], week, 'weekly'));
        writeAggregate(weekAgg, 'weekly');
    }
    if (month) {
        const monthAgg = mergeAggregates(readAggregate('monthly', month), buildAggregateFromSnapshots([snapshot], month, 'monthly'));
        writeAggregate(monthAgg, 'monthly');
    }

    return { day, week, month };
}

function listAggregatesInRange(granularity, startDate, endDate) {
    const dir = path.join(AGGREGATES_DIR, granularity);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    return files
        .map(f => f.replace('.json', ''))
        .filter(p => (!startDate || p >= startDate) && (!endDate || p <= endDate))
        .map(p => readAggregate(granularity, p))
        .filter(Boolean);
}

module.exports = {
    dateKeyFromTimestamp,
    weekKeyFromTimestamp,
    monthKeyFromTimestamp,
    estratoKey,
    emptyAggregate,
    mergeSnapshotIntoAggregate,
    finalizeAggregate,
    buildAggregateFromSnapshots,
    updateAggregatesForSnapshot,
    readAggregate,
    listAggregatesInRange,
    mergeAggregates
};
