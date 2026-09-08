'use strict';

/**
 * Variante ADITIVA de orchestrator.runPipelineReformulacao. NAO edita orchestrator.js nem
 * steps.js (STEPS_REFORMULACAO/runPipelineReformulacao continuam intocados) — reusa as mesmas
 * pecas publicas (runNode, NODES, DEFAULTS, ACTORS, validate, workflowState, buildEvidenceMap) e
 * so troca o passo final de REDACAO (v2) por REDACAO_REFORMULACAO (redacao-reformulacao@v1), que
 * recebe negativaReal e EXIGE citar/refutar o motivo da negativa anterior em vez de so reforcar a
 * hipotese sob um rotulo novo.
 *
 * Motivacao (analise de calibracao 2026-09-08): comparando a unica reformulacao real gerada pelo
 * pipeline (via REDACAO v2, sem acesso a negativaReal) contra 3 reformulacoes reais aceitas pelo
 * RA mas feitas fora da interface, o padrao que funcionou nas 3 foi sempre: citar o codigo/motivo
 * da negativa recebida, refutar-lo formalmente com fatos concretos (aplicando a diretriz oficial
 * do manual pro codigo especifico), e so entao reforcar a hipotese. REDACAO v2 nunca recebe
 * negativaReal, entao nunca produz esse padrao.
 *
 * So e usada quando o wiring (server.js) optar explicitamente por ela — ver flag
 * MODERACAO_REFORMULACAO_REDACAO_V2 em gerarAnaliseReformulacaoIA. Por padrao (flag desligada),
 * o fluxo de producao continua chamando orchestrator.runPipelineReformulacao sem nenhuma mudanca.
 */

const { NODES, DEFAULTS, ACTORS } = require('./constants');
const { runNode } = require('./orchestrator');
const ws = require('./workflowState');
const { buildEvidenceMap } = require('./evidenceMap');
const { validate } = require('./validationGate');
const { STEPS_REFORMULACAO, REDACAO_REFORMULACAO } = require('./steps');

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
 * -> [GATE] -> (re-DECISAO max 1x) -> REDACAO_REFORMULACAO), trocando so o no final.
 */
async function runPipelineReformulacaoV2Melhorada(state, deps = {}) {
    const confLimiar = num(deps.confLimiar, DEFAULTS.confLimiar);
    const maxBackedges = Number.isInteger(deps.maxBackedges) ? deps.maxBackedges : DEFAULTS.maxBackedges;

    const compreensao = STEPS_REFORMULACAO.find(s => s.node === NODES.COMPREENSAO);
    const decisao = STEPS_REFORMULACAO.find(s => s.id === 'DECISAO_REFORMULACAO');
    const redacao = REDACAO_REFORMULACAO;

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

module.exports = { runPipelineReformulacaoV2Melhorada };
