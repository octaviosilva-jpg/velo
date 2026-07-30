'use strict';

const { METRICS_VERSION } = require('./constants');

/**
 * Catálogo de métricas da observabilidade PEV (Fase 4.5).
 * IDs estáveis para agregações e dashboards.
 */
const METRIC_IDS = {
    EXECUCOES_TOTAL: 'execucoes_total',
    EXECUCOES_SUCESSO: 'execucoes_sucesso',
    EXECUCOES_FALLBACK: 'execucoes_fallback',
    TAXA_FALLBACK: 'taxa_fallback',
    DURACAO_MS_MEDIA: 'duracao_ms_media',
    DURACAO_MS_P50: 'duracao_ms_p50',
    DURACAO_MS_P95: 'duracao_ms_p95',
    DURACAO_MS_P99: 'duracao_ms_p99',
    OPENAI_CALL_COUNT_MEDIA: 'openai_call_count_media',
    TOKENS_TOTAL: 'tokens_total',
    CUSTO_TOTAL: 'custo_total',
    CUSTO_MEDIO_EXECUCAO: 'custo_medio_execucao',
    TAXA_SKIP_FACTUAL: 'taxa_skip_factual',
    TAXA_SKIP_EDITORIAL: 'taxa_skip_editorial',
    DIVERGENCIA_SHADOW: 'divergencia_shadow',
    TOKENS_ECONOMIZADOS_MEDIA: 'tokens_economizados_media',
    LATENCIA_ECONOMIZADA_MS_MEDIA: 'latencia_economizada_ms_media',
    ECONOMIA_PERCENTUAL_TOKENS: 'economia_percentual_tokens'
};

function getMetricsVersionInfo() {
    return {
        metricsVersion: METRICS_VERSION,
        changelog: [
            { version: '1.0', date: '2026-07-30', note: 'Release inicial Fase 4.5' }
        ]
    };
}

module.exports = {
    METRIC_IDS,
    METRICS_VERSION,
    getMetricsVersionInfo
};
