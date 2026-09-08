'use strict';

/**
 * Variante ADITIVA de orchestrator.runPipeline (geracao NORMAL, 1a tentativa). NAO edita
 * orchestrator.js nem steps.js (STEPS/runPipeline continuam intocados) — reusa as mesmas pecas
 * publicas (runNode, NODES, DEFAULTS, ACTORS, validate, workflowState, buildEvidenceMap) e so
 * troca o passo final de REDACAO (v2) por REDACAO_FORTALECIDA (redacao@v3), que recebe os
 * criterios especificos do manual (quandoSeAplica/criterios[]) pra hipotese ja decidida e EXIGE
 * demonstrar cada um, em vez de so citar o nome da categoria.
 *
 * Motivacao (mesma analise de calibracao 2026-09-08 que gerou orchestratorReformulacaoV2.js):
 * a DECISAO ve os criterios especificos de cada hipotese via manualBloco (montarBlocoManuaisModeracao
 * ja inclui "Criterios: ..." por hipotese), mas o contrato de saida hipotese_selecionada so carrega
 * id/titulo/manual/comoCitar — os criterios se perdem antes de chegar na Redacao, que acaba
 * produzindo um paragrafo generico citando so o rotulo da categoria.
 *
 * So e usada quando o wiring (server.js) optar explicitamente por ela — ver flag
 * MODERACAO_REDACAO_FORTALECIDA_V2 em executarPipelineModeracaoV2Fortalecida. Por padrao (flag
 * desligada), o fluxo de producao continua chamando orchestrator.runPipeline sem nenhuma mudanca.
 */

const { NODES, DEFAULTS, ACTORS } = require('./constants');
const { runNode } = require('./orchestrator');
const ws = require('./workflowState');
const { buildEvidenceMap } = require('./evidenceMap');
const { validate } = require('./validationGate');
const { STEPS, REDACAO_FORTALECIDA } = require('./steps');

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
 * Mesma State Machine de orchestrator.runPipeline (COMPREENSAO -> DECISAO -> [GATE] ->
 * (re-DECISAO max 1x) -> REDACAO_FORTALECIDA), trocando so o no final.
 */
async function runPipelineFortalecida(state, deps = {}) {
    const confLimiar = num(deps.confLimiar, DEFAULTS.confLimiar);
    const maxBackedges = Number.isInteger(deps.maxBackedges) ? deps.maxBackedges : DEFAULTS.maxBackedges;

    const compreensao = STEPS.find(s => s.node === NODES.COMPREENSAO);
    const decisao = STEPS.find(s => s.node === NODES.DECISAO);
    const redacao = REDACAO_FORTALECIDA;

    const t0 = Date.now();

    await runNode(state, compreensao, deps);
    await runNode(state, decisao, deps);

    rebuildEvidenceMap(state);
    let gate = validate(state, { confLimiar });
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
        gate = validate(state, { confLimiar });
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

module.exports = { runPipelineFortalecida };
