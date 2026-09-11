'use strict';

/**
 * Variante ADITIVA de orchestrator.runPipelineReformulacao, irma de orchestratorReformulacaoV2.js.
 * NAO edita orchestrator.js nem steps.js alem da nova exportacao (REDACAO_REFORMULACAO_HOLISTICA,
 * ela mesma aditiva) — STEPS_REFORMULACAO/runPipelineReformulacao continuam intocados. Reusa as
 * mesmas pecas publicas (runNode, NODES, DEFAULTS, ACTORS, validate, workflowState,
 * buildEvidenceMap) e so troca o passo final de REDACAO por REDACAO_REFORMULACAO_HOLISTICA
 * (redacao-reformulacao@v2).
 *
 * Motivacao (analise de 2026-09-10 sobre o caso real 258450515, negado por CO07 "Resposta Nao
 * Condizente"): a reformulacao gerada por REDACAO_REFORMULACAO (v1) se limitou a contestar o
 * motivo especifico da negativa ("a resposta nao foi generica, foi objetiva...") sem incorporar
 * nenhum fato ou trecho que a tentativa anterior nao tinha usado — na pratica repetiu o mesmo
 * argumento so acrescentando "solicitamos a reanalise" no inicio. Seguindo orientacao equivalente a
 * um criterio de banca de moderacao (a negativa deve servir so de DIAGNOSTICO da deficiencia
 * apontada, nunca como limite do que o novo pedido pode conter): apos identificar a deficiencia,
 * reavaliar integralmente reclamacao, resposta, consideracao final e hipotese do manual, e
 * demonstrar novamente o enquadramento na hipotese incorporando elementos nao explorados antes.
 *
 * So e usada quando o wiring (server.js) optar explicitamente por ela — ver flag
 * MODERACAO_REFORMULACAO_HOLISTICA_V2 em gerarAnaliseReformulacaoIA. Por padrao (flag desligada),
 * o fluxo de producao continua chamando runReformulacaoV2/runReformulacaoV2Melhorada sem nenhuma
 * mudanca.
 */

const { NODES, DEFAULTS, ACTORS } = require('./constants');
const { runNode } = require('./orchestrator');
const ws = require('./workflowState');
const { buildEvidenceMap } = require('./evidenceMap');
const { validate } = require('./validationGate');
const { verificarElegibilidadeHipotese } = require('./hipoteseElegibilidade');
const { STEPS_REFORMULACAO, REDACAO_REFORMULACAO_HOLISTICA } = require('./steps');

/** Combina o gate padrao com a checagem extra de elegibilidade de hipotese (ver
 * hipoteseElegibilidade.js) sem alterar validationGate.js. */
function validateComElegibilidade(state, opts) {
    const gate = validate(state, opts);
    if (!gate.ok) return gate;
    const elegibilidade = verificarElegibilidadeHipotese(state);
    if (!elegibilidade.ok) return { ok: false, target: gate.target, reasons: [elegibilidade.motivo] };
    return gate;
}

function rebuildEvidenceMap(state) {
    const evidenceMap = buildEvidenceMap({
        compreensao: {
            fatos: state.fatos, pedidos: state.pedidos, acusacoes: state.acusacoes,
            coberturaResposta: state.coberturaResposta
        },
        decisao: {
            hipoteseSelecionada: state.hipoteseSelecionada,
            trechosSustentam: state.trechosSustentam
        }
    });
    ws.setEvidenceMap(state, evidenceMap, { actor: ACTORS.CODIGO });
}

function num(v, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

/**
 * Mesma State Machine de orchestrator.runPipelineReformulacao (COMPREENSAO -> DECISAO_REFORMULACAO
 * -> [GATE] -> (re-DECISAO max 1x) -> REDACAO_REFORMULACAO_HOLISTICA), trocando so o no final.
 */
async function runPipelineReformulacaoHolistica(state, deps = {}) {
    const confLimiar = num(deps.confLimiar, DEFAULTS.confLimiar);
    const maxBackedges = Number.isInteger(deps.maxBackedges) ? deps.maxBackedges : DEFAULTS.maxBackedges;

    const compreensao = STEPS_REFORMULACAO.find(s => s.node === NODES.COMPREENSAO);
    const decisao = STEPS_REFORMULACAO.find(s => s.id === 'DECISAO_REFORMULACAO');
    const redacao = REDACAO_REFORMULACAO_HOLISTICA;

    const t0 = Date.now();

    await runNode(state, compreensao, deps);
    await runNode(state, decisao, deps);

    rebuildEvidenceMap(state);
    let gate = validateComElegibilidade(state, { confLimiar });
    ws.logDecision(state, {
        node: NODES.GATE, actor: ACTORS.CODIGO, event: 'gate.check',
        reason: gate.ok ? 'ok' : gate.reasons.join('; '), confDepois: state.confianca
    });

    let backedges = 0;
    while (!gate.ok && backedges < maxBackedges) {
        backedges++;
        const confAntes = state.confianca;
        ws.reopenForStep(state, decisao);
        ws.logDecision(state, {
            node: NODES.GATE, actor: ACTORS.CODIGO, event: 'gate.backedge',
            from: NODES.GATE, to: NODES.DECISAO, reason: gate.reasons.join('; '), confAntes
        });
        await runNode(state, decisao, deps);
        rebuildEvidenceMap(state);
        gate = validateComElegibilidade(state, { confLimiar });
        ws.logDecision(state, {
            node: NODES.GATE, actor: ACTORS.CODIGO, event: 'gate.recheck',
            reason: gate.ok ? 'ok' : gate.reasons.join('; '), confDepois: state.confianca
        });
    }

    if (!gate.ok) {
        ws.logDecision(state, {
            node: NODES.GATE, actor: ACTORS.CODIGO, event: 'gate.alerta',
            reason: `prosseguindo com confianca baixa: ${gate.reasons.join('; ')}`
        });
    }

    await runNode(state, redacao, deps);

    state.telemetria.push({ node: 'TOTAL', duracaoMs: Date.now() - t0, backedges });
    return state;
}

module.exports = { runPipelineReformulacaoHolistica };
