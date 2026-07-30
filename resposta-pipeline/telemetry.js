'use strict';

const { NODES, ACTORS } = require('./constants');
const ws = require('./workflowState');

/**
 * Registra telemetria do fluxo monolito (Fase 0).
 */
function recordMonolithTelemetry(state, metrics) {
    const entry = {
        node: NODES.MONOLITH,
        actor: ACTORS.CODIGO,
        openaiCallCount: metrics.openaiCallCount ?? 0,
        retryCount: metrics.retryCount ?? 0,
        duracaoMs: metrics.duracaoMs ?? null,
        promptTokens: metrics.promptTokens ?? null,
        completionTokens: metrics.completionTokens ?? null,
        totalTokens: metrics.totalTokens ?? null,
        regimeSolucao: metrics.regimeSolucao ?? null,
        pipelineMode: metrics.pipelineMode ?? null,
        usedFallback: metrics.usedFallback ?? false
    };

    ws.addTelemetria(state, entry);
    ws.setMonolithTelemetry(state, entry);
    return state;
}

function accumulateUsage(totals, usage) {
    if (!usage) return totals;
    return {
        promptTokens: (totals.promptTokens || 0) + (usage.prompt_tokens || 0),
        completionTokens: (totals.completionTokens || 0) + (usage.completion_tokens || 0),
        totalTokens: (totals.totalTokens || 0) + (usage.total_tokens || 0)
    };
}

module.exports = {
    recordMonolithTelemetry,
    accumulateUsage
};
