'use strict';

/**
 * Ponto de entrada do Pipeline V2 de moderacao (State Machine + 3 chamadas).
 * NAO e importado por server.js ate a Fase 5 (integracao atras da flag).
 *
 * Uso:
 *   const { runPipelineV2 } = require('./moderacao-pipeline');
 *   const { mapped, state } = await runPipelineV2({ idReclamacao, dadosModeracao }, deps);
 *
 * deps (dependency injection, sem acoplar ao server.js):
 *   apiKey, baseUrl, models, temperatures, maxTokens, confLimiar, maxBackedges,
 *   buildManualBloco(state)     -> string (base normativa do Manual)
 *   buildUniversoHipoteses(st)  -> string (universo de hipoteses)
 *   buildAprendizado(state)     -> string (referencia de estilo; opcional)
 *   appendSheetSummary(resumo)  -> Promise (opcional)
 *   openaiStep(...)             -> override para testes (opcional)
 */

const { createWorkflowState, serialize } = require('./workflowState');
const orchestrator = require('./orchestrator');
const orchestratorReformulacaoV2 = require('./orchestratorReformulacaoV2');
const persistence = require('./persistence');
const resultMapper = require('./resultMapper');
const constants = require('./constants');

async function runPipelineV2(input = {}, deps = {}) {
    const dados = input.dadosModeracao || {};
    const state = createWorkflowState({
        idReclamacao: input.idReclamacao,
        entradasCruas: {
            solicitacao: dados.solicitacaoCliente || '',
            resposta: dados.respostaEmpresa || '',
            consideracao: dados.consideracaoFinal || '',
            motivoHint: dados.motivoModeracao || ''
        }
    });

    await orchestrator.runPipeline(state, deps);

    let persistResult = null;
    try {
        persistResult = await persistence.persistWorkflow(state, deps);
    } catch (e) {
        console.error('[pipelineV2] persistencia falhou (nao bloqueante):', e.message);
    }

    const mapped = resultMapper.mapToLegacyContract(state, { confLimiar: deps.confLimiar });
    return { mapped, state: serialize(state), persistResult };
}

/**
 * Variante de runPipelineV2 para REFORMULAÇÃO apos negativa real do RA.
 * input.negativaReal: { motivoOficial, codigo, regraTitulo, regraOQueVerifica, regraReprovaQuando,
 *                        regraOrientacao, hipoteseAnterior, teseBateu }
 * Uso:
 *   const { runReformulacaoV2 } = require('./moderacao-pipeline');
 *   const { mapped } = await runReformulacaoV2({ idReclamacao, dadosModeracao, negativaReal }, deps);
 */
async function runReformulacaoV2(input = {}, deps = {}) {
    const dados = input.dadosModeracao || {};
    const state = createWorkflowState({
        idReclamacao: input.idReclamacao,
        entradasCruas: {
            solicitacao: dados.solicitacaoCliente || '',
            resposta: dados.respostaEmpresa || '',
            consideracao: dados.consideracaoFinal || '',
            motivoHint: dados.motivoModeracao || ''
        },
        negativaReal: input.negativaReal || null
    });

    await orchestrator.runPipelineReformulacao(state, deps);

    let persistResult = null;
    try {
        persistResult = await persistence.persistWorkflow(state, deps);
    } catch (e) {
        console.error('[pipelineV2/reformulacao] persistencia falhou (nao bloqueante):', e.message);
    }

    const mapped = resultMapper.mapReformulacaoToLegacyContract(state, { confLimiar: deps.confLimiar });
    return { mapped, state: serialize(state), persistResult };
}

/**
 * Variante ADITIVA de runReformulacaoV2: mesmo contrato de entrada/saida, mas usa
 * orchestratorReformulacaoV2.runPipelineReformulacaoV2Melhorada (REDACAO_REFORMULACAO em vez de
 * REDACAO) — exige citar/refutar o motivo da negativa recebida em vez de so reforcar a hipotese.
 * runReformulacaoV2 (acima) continua intocada e e o caminho padrao em producao; esta so e chamada
 * pelo wiring quando explicitamente selecionada (ver flag MODERACAO_REFORMULACAO_REDACAO_V2 em
 * server.js / gerarAnaliseReformulacaoIA). Ver moderacao-pipeline/orchestratorReformulacaoV2.js
 * para a motivacao (analise de calibracao 2026-09-08).
 */
async function runReformulacaoV2Melhorada(input = {}, deps = {}) {
    const dados = input.dadosModeracao || {};
    const state = createWorkflowState({
        idReclamacao: input.idReclamacao,
        entradasCruas: {
            solicitacao: dados.solicitacaoCliente || '',
            resposta: dados.respostaEmpresa || '',
            consideracao: dados.consideracaoFinal || '',
            motivoHint: dados.motivoModeracao || ''
        },
        negativaReal: input.negativaReal || null
    });

    await orchestratorReformulacaoV2.runPipelineReformulacaoV2Melhorada(state, deps);

    let persistResult = null;
    try {
        persistResult = await persistence.persistWorkflow(state, deps);
    } catch (e) {
        console.error('[pipelineV2/reformulacaoMelhorada] persistencia falhou (nao bloqueante):', e.message);
    }

    const mapped = resultMapper.mapReformulacaoToLegacyContract(state, { confLimiar: deps.confLimiar });
    return { mapped, state: serialize(state), persistResult };
}

module.exports = {
    runPipelineV2,
    runReformulacaoV2,
    runReformulacaoV2Melhorada,
    constants,
    // reexports uteis para testes/harness
    createWorkflowState,
    orchestrator,
    orchestratorReformulacaoV2,
    persistence,
    resultMapper
};
