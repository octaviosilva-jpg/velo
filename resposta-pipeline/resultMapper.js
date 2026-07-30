'use strict';

const { NODES, SKIP_POLICY_VERSION } = require('./constants');

function mapResult(state, { conteudoMiolo, usedFallback, metrics } = {}) {
    const telemetria = state.telemetria || [];
    const totalTokens = telemetria.reduce((s, t) => s + (t.totalTokens || 0), 0);
    const custoEstimado = telemetria.reduce((s, t) => s + (t.custoEstimado || 0), 0);

    return {
        conteudoMiolo: conteudoMiolo || '',
        respostaPublica: state.respostaPublica || '',
        usedFallback: !!usedFallback,
        metrics: {
            executionId: state.executionId,
            openaiCallCount: metrics?.openaiCallCount ?? telemetria.filter(t =>
                t.node === NODES.PLANNER
                || t.node === NODES.EXECUTOR
                || t.node === NODES.AUDITOR_FACTUAL
                || t.node === NODES.AUDITOR_EDITORIAL
            ).length,
            executorRetryCount: state.executorRetryCount ?? 0,
            plannerTechnicalRetryCount: state.plannerTechnicalRetryCount ?? 0,
            factualRetryCount: state.factualRetryCount ?? 0,
            auditorTechnicalRetryCount: state.auditorTechnicalRetryCount ?? 0,
            vereditoFactualAprovado: state.vereditoFactual?.aprovado ?? null,
            falhasFactualTipos: (state.vereditoFactual?.falhas || []).map(f => f.tipo),
            editorialRetryCount: state.editorialRetryCount ?? 0,
            auditorEditorialTechnicalRetryCount: state.auditorEditorialTechnicalRetryCount ?? 0,
            vereditoEditorialAprovado: state.vereditoEditorial?.aprovado ?? null,
            falhasEditorialTipos: (state.vereditoEditorial?.falhas || []).map(f => f.tipo),
            factualAuditorSkipped: state.factualAuditorSkipped ?? false,
            editorialAuditorSkipped: state.editorialAuditorSkipped ?? false,
            skipCodigoMotivoFactual: (state.skipDecisions || []).find(d => d.alvo === NODES.AUDITOR_FACTUAL)?.codigoMotivo ?? null,
            skipCodigoMotivoEditorial: (state.skipDecisions || []).find(d => d.alvo === NODES.AUDITOR_EDITORIAL)?.codigoMotivo ?? null,
            policyVersion: SKIP_POLICY_VERSION,
            tokensEconomizadosEstimados: state._skipSavingsEstimados?.tokens ?? 0,
            latenciaEconomizadaMs: state._skipSavingsEstimados?.latenciaMs ?? 0,
            promptTokens: metrics?.promptTokens ?? telemetria.reduce((s, t) => s + (t.promptTokens || 0), 0),
            completionTokens: metrics?.completionTokens ?? telemetria.reduce((s, t) => s + (t.completionTokens || 0), 0),
            totalTokens,
            custoEstimado: Number(custoEstimado.toFixed(6)),
            duracaoMs: metrics?.duracaoMs ?? null,
            regimeSolucao: state.insumosPreparados?.regimeSolucao ?? null,
            modoOperacao: state.planoDeResposta?.modoOperacao ?? null
        }
    };
}

module.exports = { mapResult };
