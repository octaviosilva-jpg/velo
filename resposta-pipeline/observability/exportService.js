'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPORTS_DIR, METRICS_VERSION } = require('./constants');
const {
    getResumo,
    getSkipPolicyMetrics,
    getQualidadeMetrics,
    getShadowMetrics,
    getDailySeries
} = require('./queryService');

function ensureExportsDir() {
    const dir = require('./constants').EXPORTS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function exportJson(opts = {}) {
    ensureExportsDir();
    const exportsDir = require('./constants').EXPORTS_DIR;
    const payload = {
        metricsVersion: METRICS_VERSION,
        geradoEm: new Date().toISOString(),
        resumo: getResumo(opts),
        skipPolicy: getSkipPolicyMetrics(opts),
        qualidade: getQualidadeMetrics(opts),
        shadow: getShadowMetrics(opts),
        serieDiaria: getDailySeries(opts.periodo || '30d')
    };
    const id = crypto.randomUUID();
    const fp = path.join(EXPORTS_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
    return { exportId: id, format: 'json', path: fp, payload };
}

function exportCsv(opts = {}) {
    ensureExportsDir();
    const exportsDir = require('./constants').EXPORTS_DIR;
    const serie = getDailySeries(opts.periodo || '30d');
    const headers = [
        'periodo', 'execucoes', 'sucesso', 'fallback',
        'duracaoMsP95', 'tokensTotal', 'tokensEconomizados', 'custoTotal'
    ];
    const rows = serie.map(r => headers.map(h => r[h] ?? '').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const id = crypto.randomUUID();
    const fp = path.join(EXPORTS_DIR, `${id}.csv`);
    fs.writeFileSync(fp, csv, 'utf8');
    return { exportId: id, format: 'csv', path: fp, content: csv };
}

function exportMarkdown(opts = {}) {
    ensureExportsDir();
    const exportsDir = require('./constants').EXPORTS_DIR;
    const resumo = getResumo(opts);
    const skip = getSkipPolicyMetrics(opts);
    const qual = getQualidadeMetrics(opts);
    const shadow = getShadowMetrics(opts);

    const md = `# Relatório Observabilidade PEV

**Gerado em:** ${new Date().toISOString()}  
**Período:** ${resumo.periodo}  
**Métricas:** ${METRICS_VERSION}

## Pipeline

- Execuções: ${resumo.execucoes}
- Taxa fallback: ${((resumo.pipeline?.taxaFallback || 0) * 100).toFixed(1)}%
- Latência P95: ${resumo.pipeline?.duracaoMsP95 ?? 'n/a'} ms
- Custo médio: $${(resumo.pipeline?.custoMedioExecucao || 0).toFixed(4)}

## Financeiro

- Tokens totais: ${resumo.financeiro?.tokensTotais ?? 0}
- Tokens economizados: ${resumo.financeiro?.tokensEconomizadosTotais ?? 0}
- Economia %: ${(resumo.financeiro?.economiaPercentualTokens || 0).toFixed(1)}%

## Skip Policy

- Taxa skip factual: ${((skip.skipPolicy?.taxaSkipFactual || 0) * 100).toFixed(1)}%
- Taxa skip editorial: ${((skip.skipPolicy?.taxaSkipEditorial || 0) * 100).toFixed(1)}%
- Divergência shadow: ${((shadow.divergenciaShadow || 0) * 100).toFixed(1)}%

## Qualidade

- Aprovação factual: ${((qual.factual?.taxaAprovacao || 0) * 100).toFixed(1)}%
- Aprovação editorial: ${((qual.editorial?.taxaAprovacao || 0) * 100).toFixed(1)}%
`;

    const id = crypto.randomUUID();
    const fp = path.join(EXPORTS_DIR, `${id}.md`);
    fs.writeFileSync(fp, md, 'utf8');
    return { exportId: id, format: 'markdown', path: fp, content: md };
}

function exportData(format, opts = {}) {
    if (format === 'csv') return exportCsv(opts);
    if (format === 'md' || format === 'markdown') return exportMarkdown(opts);
    return exportJson(opts);
}

module.exports = {
    exportJson,
    exportCsv,
    exportMarkdown,
    exportData
};
