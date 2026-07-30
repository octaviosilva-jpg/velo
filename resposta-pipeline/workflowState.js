'use strict';

const crypto = require('crypto');
const { WORKFLOW_VERSION, ACTORS, NODES } = require('./constants');

/**
 * Estado do workflow ARPC-RA PEV.
 * Fase 1: insumosPreparados + planoDeResposta + rascunhoMiolo + vereditoGate.
 * Fase 2: vereditoFactual + factualRetryCount + auditorTechnicalRetryCount.
 * Fase 3: vereditoEditorial + editorialRetryCount + auditorEditorialTechnicalRetryCount.
 * Fase 4: skip condicional de auditores (factualAuditorSkipped, editorialAuditorSkipped).
 * Fase 5: respostaPublica (contrato publico entregue ao usuario).
 * Fase 6: chanceModeracao (analise pos-ResponseBuilder).
 */
function createWorkflowState({ idReclamacao, dadosFormulario } = {}) {
    const df = dadosFormulario || {};
    return {
        workflowVersion: WORKFLOW_VERSION,
        executionId: `${Date.now()}-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        idReclamacao: idReclamacao != null ? String(idReclamacao) : (df.id_reclamacao ? String(df.id_reclamacao) : null),
        pipelineMode: null,

        entradasCruas: {
            tipo_solicitacao: df.tipo_solicitacao || '',
            motivo_solicitacao: df.motivo_solicitacao || df.motivoSolicitacao || '',
            solucao_implementada: df.solucao_implementada || '',
            texto_cliente: df.texto_cliente || '',
            historico_atendimento: df.historico_atendimento || '',
            nome_solicitante: df.nome_solicitante || '',
            observacoes_internas: df.observacoes_internas || '',
            consideracao_final: df.consideracao_final || df.consideracaoFinal || '',
            historico_moderacao: df.historico_moderacao || df.historicoModeracao || ''
        },

        insumosPreparados: null,
        planoDeResposta: null,
        rascunhoMiolo: null,
        vereditoGate: null,
        vereditoFactual: null,
        vereditoEditorial: null,
        executorRetryCount: 0,
        plannerTechnicalRetryCount: 0,
        factualRetryCount: 0,
        auditorTechnicalRetryCount: 0,
        editorialRetryCount: 0,
        auditorEditorialTechnicalRetryCount: 0,
        factualAuditorSkipped: false,
        editorialAuditorSkipped: false,
        conditionalAuditEnabled: false,
        conditionalAuditShadow: false,
        skipDecisions: [],
        usedFallback: false,
        respostaPublica: null,
        chanceModeracao: null,

        monolithTelemetry: null,

        decisionLog: [],
        artefatos: [],
        telemetria: [],

        _meta: { consolidated: {}, reopened: {} }
    };
}

function logDecision(state, entry = {}) {
    const actor = entry.actor === ACTORS.LLM ? ACTORS.LLM : ACTORS.CODIGO;
    state.decisionLog.push({
        ts: new Date().toISOString(),
        node: entry.node || null,
        actor,
        event: entry.event || '',
        reason: entry.reason || '',
        from: entry.from || null,
        to: entry.to || null,
        promptVersion: entry.promptVersion || null
    });
    return state;
}

function addTelemetria(state, t) {
    state.telemetria.push({ ...t, ts: new Date().toISOString() });
    return state;
}

function addArtefato(state, a) {
    state.artefatos.push({ ...a, ts: new Date().toISOString() });
    return state;
}

function applyStepResult(state, step, partial, { actor = ACTORS.LLM } = {}) {
    const writes = Array.isArray(step.writes) ? step.writes : [];
    const keys = Object.keys(partial || {});

    for (const k of keys) {
        if (!writes.includes(k)) {
            throw new Error(`[workflowState] Etapa "${step.id}" tentou escrever campo nao permitido: "${k}"`);
        }
        if (state._meta.consolidated[k] && !state._meta.reopened[k]) {
            throw new Error(`[workflowState] Campo "${k}" ja consolidado e imutavel (etapa "${step.id}")`);
        }
    }
    for (const k of keys) {
        state[k] = partial[k];
        state._meta.consolidated[k] = step.id;
        delete state._meta.reopened[k];
    }
    logDecision(state, {
        node: step.node || step.id,
        actor,
        event: 'step.apply',
        reason: `campos: ${keys.join(', ') || '(nenhum)'}`,
        promptVersion: step.promptRef || null
    });
    return state;
}

function reopenForStep(state, step) {
    for (const k of (step.writes || [])) {
        if (state._meta.consolidated[k]) state._meta.reopened[k] = true;
    }
    return state;
}

function setInsumosPreparados(state, insumos) {
    state.insumosPreparados = insumos;
    logDecision(state, {
        node: NODES.PRE_PROCESSOR,
        actor: ACTORS.CODIGO,
        event: 'insumos.build',
        reason: `regime=${insumos?.regimeSolucao || 'n/a'}`
    });
    return state;
}

function setMonolithTelemetry(state, telemetry) {
    state.monolithTelemetry = telemetry;
    logDecision(state, {
        node: NODES.MONOLITH,
        actor: ACTORS.CODIGO,
        event: 'monolith.complete',
        reason: `calls=${telemetry?.openaiCallCount ?? 0} retries=${telemetry?.retryCount ?? 0}`
    });
    return state;
}

function serialize(state) {
    const {
        _meta,
        _plannerErroTecnico,
        _gateFeedback,
        _factualFeedback,
        _editorialFeedback,
        _auditorErroTecnico,
        _auditorEditorialErroTecnico,
        ...rest
    } = state;
    return rest;
}

module.exports = {
    createWorkflowState,
    logDecision,
    addTelemetria,
    addArtefato,
    applyStepResult,
    reopenForStep,
    setInsumosPreparados,
    setMonolithTelemetry,
    serialize
};
