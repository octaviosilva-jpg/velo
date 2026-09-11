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
const orchestratorReformulacaoHolistica = require('./orchestratorReformulacaoHolistica');
const orchestratorFortalecida = require('./orchestratorFortalecida');
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

/**
 * Variante ADITIVA de runReformulacaoV2, irma de runReformulacaoV2Melhorada: mesmo contrato de
 * entrada/saida, mas usa orchestratorReformulacaoHolistica.runPipelineReformulacaoHolistica
 * (REDACAO_REFORMULACAO_HOLISTICA em vez de REDACAO_REFORMULACAO) — trata a negativa como
 * diagnostico da deficiencia em vez de unico alvo do texto, reavaliando reclamacao/resposta/
 * consideracao/hipotese por inteiro. runReformulacaoV2 e runReformulacaoV2Melhorada continuam
 * intocadas; esta so e chamada pelo wiring quando explicitamente selecionada (ver flag
 * MODERACAO_REFORMULACAO_HOLISTICA_V2 em server.js / gerarAnaliseReformulacaoIA). Ver
 * moderacao-pipeline/orchestratorReformulacaoHolistica.js para a motivacao (caso real 258450515).
 */
async function runReformulacaoHolistica(input = {}, deps = {}) {
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

    await orchestratorReformulacaoHolistica.runPipelineReformulacaoHolistica(state, deps);

    let persistResult = null;
    try {
        persistResult = await persistence.persistWorkflow(state, deps);
    } catch (e) {
        console.error('[pipelineV2/reformulacaoHolistica] persistencia falhou (nao bloqueante):', e.message);
    }

    const mapped = resultMapper.mapReformulacaoToLegacyContract(state, { confLimiar: deps.confLimiar });
    return { mapped, state: serialize(state), persistResult };
}

/**
 * Variante ADITIVA de runPipelineV2: mesmo contrato de entrada/saida, mas usa
 * orchestratorFortalecida.runPipelineFortalecida (REDACAO_FORTALECIDA em vez de REDACAO) — exige
 * demonstrar criterio por criterio do manual pra hipotese escolhida, em vez de so citar a
 * categoria. runPipelineV2 (acima) continua intocada e e o caminho padrao em producao; esta so e
 * chamada pelo wiring quando explicitamente selecionada (ver flag
 * MODERACAO_REDACAO_FORTALECIDA_V2 em server.js / executarPipelineModeracaoV2Fortalecida). Ver
 * moderacao-pipeline/orchestratorFortalecida.js para a motivacao.
 */
async function runPipelineV2Fortalecida(input = {}, deps = {}) {
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

    await orchestratorFortalecida.runPipelineFortalecida(state, deps);

    let persistResult = null;
    try {
        persistResult = await persistence.persistWorkflow(state, deps);
    } catch (e) {
        console.error('[pipelineV2/fortalecida] persistencia falhou (nao bloqueante):', e.message);
    }

    const mapped = resultMapper.mapToLegacyContract(state, { confLimiar: deps.confLimiar });
    return { mapped, state: serialize(state), persistResult };
}

module.exports = {
    runPipelineV2,
    runPipelineV2Fortalecida,
    runReformulacaoV2,
    runReformulacaoV2Melhorada,
    runReformulacaoHolistica,
    constants,
    // reexports uteis para testes/harness
    createWorkflowState,
    orchestrator,
    orchestratorReformulacaoV2,
    orchestratorReformulacaoHolistica,
    orchestratorFortalecida,
    persistence,
    resultMapper
};
