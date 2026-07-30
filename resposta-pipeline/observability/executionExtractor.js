'use strict';

const persistence = require('../persistence');
const { NODES, SKIP_POLICY_VERSION } = require('../constants');
const { METRICS_VERSION } = require('./constants');

function sumNodeDuracao(telemetria, node) {
    const entries = (telemetria || []).filter(t => t.node === node);
    if (!entries.length) return null;
    return entries.reduce((s, t) => s + (t.duracaoMs || 0), 0);
}

function hasTelemetriaNode(telemetria, node) {
    return (telemetria || []).some(t => t.node === node);
}

function findArtefato(artefatos, tipo) {
    return (artefatos || []).find(a => a.tipo === tipo);
}

function findArtefatos(artefatos, tipo) {
    return (artefatos || []).filter(a => a.tipo === tipo);
}

function extractSkipDecisions(state) {
    const fromState = state.skipDecisions || [];
    if (fromState.length) {
        return fromState.map(d => ({
            alvo: d.alvo,
            executar: d.executar,
            codigoMotivo: d.codigoMotivo,
            regraDecisiva: d.regraDecisiva,
            fasePrecedencia: d.fasePrecedencia,
            shadowMode: d.shadowMode === true
        }));
    }
    return findArtefatos(state.artefatos, 'DecisaoExecucaoAuditor').map(a => ({
        alvo: a.payload?.alvo,
        executar: a.payload?.executar,
        codigoMotivo: a.payload?.codigoMotivo,
        regraDecisiva: a.payload?.regraDecisiva,
        fasePrecedencia: a.payload?.fasePrecedencia,
        shadowMode: a.payload?.shadowMode === true
    }));
}

function computeShadowDivergencias(skipDecisions, state) {
    const divergencias = [];
    for (const d of skipDecisions) {
        if (!d.shadowMode || d.executar !== false) continue;
        const isFactual = d.alvo === NODES.AUDITOR_FACTUAL;
        const isEditorial = d.alvo === NODES.AUDITOR_EDITORIAL;
        if (isFactual && state.vereditoFactual?.aprovado === false) {
            divergencias.push({ alvo: d.alvo, skipSugerido: true, auditorReprovou: true });
        }
        if (isEditorial && state.vereditoEditorial?.aprovado === false) {
            divergencias.push({ alvo: d.alvo, skipSugerido: true, auditorReprovou: true });
        }
    }
    return divergencias;
}

function deriveCustoEconomizado(tokensEconomizados, custoEstimado, totalTokens) {
    if (!tokensEconomizados || !totalTokens) return 0;
    const rate = totalTokens > 0 ? custoEstimado / totalTokens : 0;
    return Number((tokensEconomizados * rate).toFixed(6));
}

function deriveEconomiaPercentual(tokensEconomizados, totalTokens) {
    const consumidos = totalTokens || 0;
    const economizados = tokensEconomizados || 0;
    const base = consumidos + economizados;
    if (base <= 0) return 0;
    return Number(((economizados / base) * 100).toFixed(2));
}

/**
 * Deriva ExecutionSnapshot de workflowState persistido (somente leitura).
 */
function extractExecutionSnapshot(state) {
    if (!state || !state.executionId) {
        throw new Error('[observability/extractor] state ou executionId ausente');
    }

    const resumo = persistence.resumo(state);
    const telemetria = state.telemetria || [];
    const ins = state.insumosPreparados || {};
    const plano = state.planoDeResposta || {};
    const gateArtefato = findArtefato(state.artefatos, 'VereditoGate');

    const vereditoGate = state.vereditoGate || gateArtefato?.payload || null;
    const gateFalhasTipos = (vereditoGate?.falhas || []).map(f => f.tipo);

    const factualArtefato = findArtefato(state.artefatos, 'VereditoFactual');
    const editorialArtefato = findArtefato(state.artefatos, 'VereditoEditorial');

    const factualExecutado = !!factualArtefato
        || hasTelemetriaNode(telemetria, NODES.AUDITOR_FACTUAL);
    const editorialExecutado = !!editorialArtefato
        || hasTelemetriaNode(telemetria, NODES.AUDITOR_EDITORIAL);

    const factualSkipped = state.factualAuditorSkipped === true;
    const editorialSkipped = state.editorialAuditorSkipped === true;

    const skipDecisions = extractSkipDecisions(state);
    const shadowDivergencias = computeShadowDivergencias(skipDecisions, state);

    const promptTokens = telemetria.reduce((s, t) => s + (t.promptTokens || 0), 0);
    const completionTokens = telemetria.reduce((s, t) => s + (t.completionTokens || 0), 0);
    const totalTokens = telemetria.reduce((s, t) => s + (t.totalTokens || 0), 0);
    const custoEstimado = Number(telemetria.reduce((s, t) => s + (t.custoEstimado || 0), 0).toFixed(6));

    const tokensEconomizadosEstimados = resumo.tokensEconomizadosEstimados ?? 0;
    const latenciaEconomizadaMs = resumo.latenciaEconomizadaMs ?? 0;

    return {
        metricsVersion: METRICS_VERSION,
        executionId: state.executionId,
        timestamp: state.timestamp,
        idReclamacao: state.idReclamacao,
        workflowVersion: state.workflowVersion,
        pipelineMode: state.pipelineMode,
        policyVersion: resumo.policyVersion || SKIP_POLICY_VERSION,

        usedFallback: state.usedFallback === true,
        duracaoMs: resumo.duracaoMs ?? null,
        openaiCallCount: resumo.openaiCallCount ?? 0,
        promptTokens,
        completionTokens,
        totalTokens,
        custoEstimado,

        regimeSolucao: ins.regimeSolucao ?? null,
        modoOperacao: plano.modoOperacao ?? null,
        fontePrimaria: plano.fontePrimaria ?? null,
        rotaExecucao: ins.rotaExecucao ?? null,

        plannerTechnicalRetryCount: state.plannerTechnicalRetryCount ?? 0,
        plannerGenerated: !!plano,

        executorRetryCount: state.executorRetryCount ?? 0,
        gateAprovadoPrimeiraPassagem: (state.executorRetryCount ?? 0) === 0
            && vereditoGate?.aprovado === true,
        gateFalhasTipos,
        executorDuracaoMs: sumNodeDuracao(telemetria, NODES.EXECUTOR),

        factualExecutado,
        factualSkipped,
        factualAprovado: state.vereditoFactual?.aprovado ?? null,
        factualRetryCount: state.factualRetryCount ?? 0,
        factualFalhasTipos: (state.vereditoFactual?.falhas || []).map(f => f.tipo),
        factualDuracaoMs: sumNodeDuracao(telemetria, NODES.AUDITOR_FACTUAL),

        editorialExecutado,
        editorialSkipped,
        editorialAprovado: state.vereditoEditorial?.aprovado ?? null,
        editorialRetryCount: state.editorialRetryCount ?? 0,
        editorialFalhasTipos: (state.vereditoEditorial?.falhas || []).map(f => f.tipo),
        editorialDuracaoMs: sumNodeDuracao(telemetria, NODES.AUDITOR_EDITORIAL),

        skipDecisions,
        tokensEconomizadosEstimados,
        latenciaEconomizadaMs,
        shadowDivergencias,

        custoEconomizadoEstimado: deriveCustoEconomizado(
            tokensEconomizadosEstimados,
            custoEstimado,
            totalTokens
        ),
        economiaPercentualTokens: deriveEconomiaPercentual(tokensEconomizadosEstimados, totalTokens)
    };
}

module.exports = {
    extractExecutionSnapshot
};
