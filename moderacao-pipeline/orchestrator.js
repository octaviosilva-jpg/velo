'use strict';

const { NODES, DEFAULTS, ACTORS } = require('./constants');
const promptRegistry = require('./promptRegistry');
const { openaiStep, parseJsonTolerante } = require('./openaiStep');
const ws = require('./workflowState');
const { buildEvidenceMap } = require('./evidenceMap');
const { validate } = require('./validationGate');
const { STEPS } = require('./steps');

/**
 * Executa um no (uma chamada ao modelo) e aplica o resultado ao estado.
 * Registra artefato (prompt renderizado + resposta crua + versao + hash) e telemetria.
 */
async function runNode(state, step, deps) {
    const ctx = await step.buildCtx(state, deps);
    const rendered = promptRegistry.render(step.promptRef, ctx);

    const runFn = deps.openaiStep || openaiStep; // injecao para testes/mocks
    const result = await runFn({
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        model: step.model(deps),
        temperature: step.temperature(deps),
        messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user }
        ],
        responseFormat: rendered.responseFormat,
        maxTokens: step.maxTokens(deps)
    });

    const parsed = parseJsonTolerante(result.conteudo);
    if (!parsed) {
        const err = new Error(`[orchestrator] Falha ao parsear JSON do no ${step.id}`);
        err.conteudo = result.conteudo;
        throw err;
    }
    const partial = step.toPartial(parsed, state);
    ws.applyStepResult(state, step, partial, { actor: step.actor || ACTORS.LLM });

    ws.addArtefato(state, {
        node: step.node,
        etapas: step.etapas,
        promptId: rendered.promptId,
        version: rendered.version,
        ref: rendered.ref,
        hash: rendered.hash,
        promptRenderizado: rendered,
        respostaCrua: result.conteudo,
        parsed
    });
    ws.addTelemetria(state, {
        node: step.node,
        model: result.model,
        temperature: result.temperature,
        promptTokens: result.usage ? result.usage.prompt_tokens : null,
        completionTokens: result.usage ? result.usage.completion_tokens : null,
        totalTokens: result.usage ? result.usage.total_tokens : null,
        custoEstimado: result.custoEstimado,
        duracaoMs: result.duracaoMs,
        promptVersion: `${rendered.promptId}@${rendered.version}`
    });
    return { parsed, result };
}

/**
 * Roda o pipeline completo: COMPREENSAO -> DECISAO -> [GATE] -> (re-DECISAO max 1x) -> REDACAO.
 * deps: { apiKey, baseUrl, models, temperatures, maxTokens, confLimiar, maxBackedges,
 *         buildManualBloco, buildUniversoHipoteses, buildAprendizado, openaiStep? }
 */
async function runPipeline(state, deps = {}) {
    const confLimiar = num(deps.confLimiar, DEFAULTS.confLimiar);
    const maxBackedges = Number.isInteger(deps.maxBackedges) ? deps.maxBackedges : DEFAULTS.maxBackedges;

    const compreensao = STEPS.find(s => s.node === NODES.COMPREENSAO);
    const decisao = STEPS.find(s => s.node === NODES.DECISAO);
    const redacao = STEPS.find(s => s.node === NODES.REDACAO);

    const t0 = Date.now();

    // Chamada 1
    await runNode(state, compreensao, deps);

    // Chamada 2
    await runNode(state, decisao, deps);

    // EvidenceMap (codigo) + Portao de validacao (codigo)
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
        // Nao interrompe: pedido e SEMPRE gerado. Registra alerta de confianca baixa.
        ws.logDecision(state, {
            node: NODES.GATE, actor: ACTORS.CODIGO, event: 'gate.alerta',
            reason: `prosseguindo com confianca baixa: ${gate.reasons.join('; ')}`
        });
    }

    // Chamada 3
    await runNode(state, redacao, deps);

    state.telemetria.push({ node: 'TOTAL', duracaoMs: Date.now() - t0, backedges });
    return state;
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

module.exports = { runPipeline, runNode };
