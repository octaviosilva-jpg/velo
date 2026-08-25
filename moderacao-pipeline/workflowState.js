'use strict';

const crypto = require('crypto');
const { WORKFLOW_VERSION, ACTORS } = require('./constants');

/**
 * WorkflowState: objeto de contexto unico, enriquecido progressivamente por cada no.
 *
 * Garantias:
 *  - write-guard: cada etapa so escreve os campos declarados em step.writes.
 *  - imutabilidade: campo consolidado nao pode ser reescrito, exceto apos reopenForStep
 *    (back-edge explicito previsto pelo fluxo).
 *  - rastreabilidade: decisionLog append-only (com actor: 'llm' | 'codigo'), artefatos,
 *    telemetria e evidenceMap.
 */
function createWorkflowState({ idReclamacao, entradasCruas, negativaReal } = {}) {
    const e = entradasCruas || {};
    return {
        workflowVersion: WORKFLOW_VERSION,
        executionId: `${Date.now()}-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        idReclamacao: idReclamacao != null ? String(idReclamacao) : null,

        entradasCruas: {
            solicitacao: e.solicitacao || '',
            resposta: e.resposta || '',
            consideracao: e.consideracao || '',
            motivoHint: e.motivoHint || ''
        },

        // Só presente no fluxo de REFORMULAÇÃO (após negativa real do RA). Entrada fixa,
        // definida na criação do estado, nunca escrita por um step (sem write-guard).
        negativaReal: negativaReal || null, // { motivoOficial, codigo, regraTitulo, regraOQueVerifica, regraReprovaQuando, regraOrientacao, hipoteseAnterior, teseBateu }

        // COMPREENSAO (E1..E3)
        fatos: [],
        pedidos: [],
        acusacoes: [],
        fatosResposta: [],
        solucoes: [],
        consideracaoTipo: null,
        novosFatos: [],
        conflitoPrincipal: null,
        conflitosSecundarios: [],
        coberturaResposta: [],

        // DECISAO (E4..E5)
        analiseDecisao: null, // { nucleoReclamacao, conflitos:[{conflito,tipo,respondidoPelaEmpresa,evidencia}], leituraConsideracaoFinal }
        hipotesesCandidatas: [],
        hipotesesDescartadas: [], // [{ hipotese, score, evidenciasFavoraveis[], evidenciasContrarias[], trechos[], motivoDescarte }]
        hipoteseSelecionada: null,
        justificativa: null,
        trechosSustentam: [],
        confianca: null, // numero 0.0..1.0
        // Só preenchidos no fluxo de REFORMULAÇÃO (etapa DECISAO_REFORMULACAO)
        ondeATentativaAnteriorFalhou: null,
        forcaDaTentativa: null, // 'forte' | 'media' | 'fraca'
        forcaJustificativa: null,

        // REDACAO (E6..E7)
        linhaRaciocinio: null,
        textoFinal: null,

        // Rastreabilidade / auditoria
        evidenceMap: [],
        decisionLog: [],
        artefatos: [],
        telemetria: [],

        // metadados internos (nao persistir como verdade de negocio)
        _meta: { consolidated: {}, reopened: {} }
    };
}

/**
 * Aplica o resultado de um step ao estado respeitando o write-guard e a imutabilidade.
 * @param {object} state
 * @param {{id:string, writes:string[]}} step
 * @param {object} partial - somente chaves declaradas em step.writes
 */
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
        reason: `campos: ${keys.join(', ') || '(nenhum)'}`
    });
    return state;
}

/** Reabre os campos de um step para permitir reexecucao via back-edge explicito. */
function reopenForStep(state, step) {
    for (const k of (step.writes || [])) {
        if (state._meta.consolidated[k]) state._meta.reopened[k] = true;
    }
    return state;
}

/** Registra um evento no decisionLog (append-only). actor deve ser 'llm' ou 'codigo'. */
function logDecision(state, entry = {}) {
    const actor = entry.actor === ACTORS.LLM ? ACTORS.LLM : (entry.actor === ACTORS.CODIGO ? ACTORS.CODIGO : ACTORS.CODIGO);
    state.decisionLog.push({
        ts: new Date().toISOString(),
        node: entry.node || null,
        actor,
        event: entry.event || '',
        from: entry.from || null,
        to: entry.to || null,
        reason: entry.reason || '',
        confAntes: entry.confAntes != null ? entry.confAntes : null,
        confDepois: entry.confDepois != null ? entry.confDepois : null,
        promptVersion: entry.promptVersion || null
    });
    return state;
}

function addTelemetria(state, t) { state.telemetria.push(t); return state; }
function addArtefato(state, a) { state.artefatos.push(a); return state; }

/** Define o evidenceMap (produzido por codigo deterministico). */
function setEvidenceMap(state, evidenceMap, { actor = ACTORS.CODIGO } = {}) {
    state.evidenceMap = Array.isArray(evidenceMap) ? evidenceMap : [];
    logDecision(state, { node: 'GATE', actor, event: 'evidenceMap.build', reason: `${state.evidenceMap.length} vinculo(s)` });
    return state;
}

/** Remove metadados internos para persistencia/serializacao. */
function serialize(state) {
    const { _meta, ...rest } = state;
    return rest;
}

module.exports = {
    createWorkflowState,
    applyStepResult,
    reopenForStep,
    logDecision,
    addTelemetria,
    addArtefato,
    setEvidenceMap,
    serialize
};
