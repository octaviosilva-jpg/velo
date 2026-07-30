'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('./workflowState');
const { NODES, SKIP_POLICY_VERSION } = require('./constants');

const MEMORIA = new Map();
const SHADOW_DIR = path.join(__dirname, '..', 'data', 'resposta_pipeline_shadow');
const PEV_DIR = path.join(__dirname, '..', 'data', 'resposta_pipeline_pev');

function isVercel() {
    return !!(process.env.VERCEL || process.env.NOW_REGION);
}

function resumo(state) {
    const mono = state.monolithTelemetry || {};
    const ins = state.insumosPreparados || {};
    const artefatos = state.artefatos || [];
    const telemetria = state.telemetria || [];

    return {
        executionId: state.executionId,
        timestamp: state.timestamp,
        idReclamacao: state.idReclamacao,
        workflowVersion: state.workflowVersion,
        pipelineMode: state.pipelineMode,
        regimeSolucao: ins.regimeSolucao || null,
        rotaExecucao: ins.rotaExecucao || null,
        modoOperacao: state.planoDeResposta?.modoOperacao ?? null,
        coerentesMantidos: ins.kitReferencia?.curadoria?.mantidos ?? null,
        openaiCallCount: mono.openaiCallCount ?? telemetria.filter(t =>
            t.node === NODES.PLANNER
            || t.node === NODES.EXECUTOR
            || t.node === NODES.AUDITOR_FACTUAL
            || t.node === NODES.AUDITOR_EDITORIAL
        ).length,
        retryCount: mono.retryCount ?? state.executorRetryCount ?? null,
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
        usedFallback: state.usedFallback ?? false,
        respostaPublicaPresente: !!state.respostaPublica,
        chanceModeracaoExecutada: !!state.chanceModeracao?.executada,
        chanceModeracaoSucesso: state.chanceModeracao?.executada
            ? !!state.chanceModeracao.sucesso
            : null,
        chanceFinal: state.chanceModeracao?.motor?.chance_final
            ?? state.chanceModeracao?.motor?.metadados?.chance_final
            ?? null,
        duracaoMs: mono.duracaoMs ?? null,
        promptTokens: telemetria.reduce((s, t) => s + (t.promptTokens || 0), 0) || (mono.promptTokens ?? null),
        completionTokens: telemetria.reduce((s, t) => s + (t.completionTokens || 0), 0) || (mono.completionTokens ?? null),
        promptVersions: artefatos.filter(a => a.promptId).map(a => `${a.promptId}@${a.version}`),
        hashes: artefatos.filter(a => a.hash).map(a => a.hash),
        custoEstimado: Number(telemetria.reduce((s, t) => s + (t.custoEstimado || 0), 0).toFixed(6))
    };
}

async function persistToDir(state, dir, deps) {
    const payload = ws.serialize(state);
    let localOk = false;

    try {
        if (isVercel()) {
            MEMORIA.set(state.executionId, payload);
            localOk = true;
        } else {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, `${state.executionId}.json`),
                JSON.stringify(payload, null, 2),
                'utf8'
            );
            localOk = true;
        }
    } catch (e) {
        const msg = `[resposta-pipeline/persistence] Falha ao gravar: ${e.message}`;
        if (typeof deps.onError === 'function') deps.onError(msg);
        else console.error(msg);
    }

    return { localOk, resumo: resumo(state) };
}

async function persistShadowState(state, deps = {}) {
    return persistToDir(state, SHADOW_DIR, deps);
}

async function persistWorkflowState(state, deps = {}) {
    return persistToDir(state, PEV_DIR, deps);
}

function getFromMemoria(executionId) {
    return MEMORIA.get(executionId) || null;
}

module.exports = {
    persistShadowState,
    persistWorkflowState,
    resumo,
    getFromMemoria,
    _MEMORIA: MEMORIA,
    _SHADOW_DIR: SHADOW_DIR,
    _PEV_DIR: PEV_DIR
};
