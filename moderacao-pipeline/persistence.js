'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('./workflowState');

/**
 * Persistencia permanente do WorkflowState.
 *  - Local: data/moderacao_workflow/{executionId}.json (artefatos completos).
 *  - Vercel (fs somente-leitura): fallback em memoria (Map do processo).
 *  - Sheets: resumo opcional via deps.appendSheetSummary(summary) (injetado no wiring).
 *
 * Nao lanca erro para nao bloquear a geracao: falha de persistencia e apenas logada.
 */

const MEMORIA = new Map(); // fallback quando process.env.VERCEL
const DIR = path.join(__dirname, '..', 'data', 'moderacao_workflow');

function isVercel() {
    return !!(process.env.VERCEL || process.env.NOW_REGION);
}

function resumo(state) {
    const totalTokens = (state.telemetria || []).reduce((n, t) => n + (t.totalTokens || 0), 0);
    const custo = (state.telemetria || []).reduce((n, t) => n + (t.custoEstimado || 0), 0);
    const duracao = (state.telemetria || []).find(t => t.node === 'TOTAL');
    const hip = state.hipoteseSelecionada || {};
    return {
        executionId: state.executionId,
        timestamp: state.timestamp,
        idReclamacao: state.idReclamacao,
        workflowVersion: state.workflowVersion,
        conflitoPrincipal: state.conflitoPrincipal,
        hipoteseSelecionada: typeof hip === 'object' ? (hip.titulo || hip.id || '') : hip,
        confianca: state.confianca,
        tokensTotal: totalTokens,
        custoEstimado: Number(custo.toFixed(6)),
        duracaoMs: duracao ? duracao.duracaoMs : null,
        promptVersions: (state.artefatos || []).map(a => `${a.promptId}@${a.version}`),
        hashes: (state.artefatos || []).map(a => a.hash)
    };
}

async function persistWorkflow(state, deps = {}) {
    const payload = ws.serialize(state);
    let localOk = false;

    try {
        if (isVercel()) {
            MEMORIA.set(state.executionId, payload);
            localOk = true;
        } else {
            fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(path.join(DIR, `${state.executionId}.json`), JSON.stringify(payload, null, 2), 'utf8');
            localOk = true;
        }
    } catch (e) {
        console.error('[persistence] Falha ao gravar artefato local:', e.message);
    }

    let sheetOk = false;
    try {
        if (typeof deps.appendSheetSummary === 'function') {
            await deps.appendSheetSummary(resumo(state));
            sheetOk = true;
        }
    } catch (e) {
        console.error('[persistence] Falha ao gravar resumo no Sheets:', e.message);
    }

    return { localOk, sheetOk, resumo: resumo(state) };
}

function getFromMemoria(executionId) {
    return MEMORIA.get(executionId) || null;
}

module.exports = { persistWorkflow, resumo, getFromMemoria, _MEMORIA: MEMORIA };
