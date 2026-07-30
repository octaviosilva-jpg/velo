'use strict';

/**
 * Ponto de entrada — Pipeline PEV ARPC-RA.
 * Fase 0: shadow pre-process + telemetria.
 * Fase 1: Plan-and-Execute via PEV_PLAN_EXEC_ENABLED.
 */

const constants = require('./constants');
const contracts = require('./contracts');
const ws = require('./workflowState');
const preProcessor = require('./preProcessor');
const learningLayer = require('./adapters/learningLayer');
const persistence = require('./persistence');
const telemetry = require('./telemetry');
const orchestrator = require('./orchestrator');
const observability = require('./observability');
const responseBuilder = require('./responseBuilder');
const chanceModeracao = require('./chanceModeracao');
const { SYSTEM_PROMPT_RA } = require('./shared/raStandardPrompt');

const { PIPELINE_MODE, NODES, ACTORS } = constants;

function getPipelineMode(envVars = {}) {
    const raw = String(
        envVars.RESPOSTA_PIPELINE_MODE
        || process.env.RESPOSTA_PIPELINE_MODE
        || PIPELINE_MODE.OFF
    ).toLowerCase().trim();

    if (raw === PIPELINE_MODE.SHADOW) return PIPELINE_MODE.SHADOW;
    if (raw === PIPELINE_MODE.PEV) return PIPELINE_MODE.PEV;
    return PIPELINE_MODE.OFF;
}

function isShadowEnabled(mode) {
    return mode === PIPELINE_MODE.SHADOW;
}

function isPevPlanExecEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_PLAN_EXEC_ENABLED
        || process.env.PEV_PLAN_EXEC_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevFactualAuditorEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_FACTUAL_AUDITOR_ENABLED
        || process.env.PEV_FACTUAL_AUDITOR_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevEditorialAuditorEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_EDITORIAL_AUDITOR_ENABLED
        || process.env.PEV_EDITORIAL_AUDITOR_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevConditionalAuditEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_CONDITIONAL_AUDIT_ENABLED
        || process.env.PEV_CONDITIONAL_AUDIT_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevConditionalAuditShadow(envVars = {}) {
    const raw = String(
        envVars.PEV_CONDITIONAL_AUDIT_SHADOW
        || process.env.PEV_CONDITIONAL_AUDIT_SHADOW
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevSkipFactualTier1Enabled(envVars = {}) {
    const raw = String(
        envVars.PEV_SKIP_FACTUAL_TIER1_ENABLED
        || process.env.PEV_SKIP_FACTUAL_TIER1_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevChanceModeracaoEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_CHANCE_MODERACAO_ENABLED
        || process.env.PEV_CHANCE_MODERACAO_ENABLED
        || 'false'
    ).toLowerCase().trim();
    return raw === 'true';
}

function isPevRaStandardEnabled(envVars = {}) {
    const raw = String(
        envVars.PEV_RA_STANDARD_ENABLED
        || process.env.PEV_RA_STANDARD_ENABLED
        || 'true'
    ).toLowerCase().trim();
    return raw !== 'false';
}

function isPevObservabilityEnabled(envVars = {}) {
    return observability.isPevObservabilityEnabled(envVars);
}

function isPevObservabilityExportsEnabled(envVars = {}) {
    return observability.isPevObservabilityExportsEnabled(envVars);
}

async function runShadowPreProcess(input = {}, deps = {}) {
    const t0 = Date.now();
    const dadosFormulario = input.dadosFormulario || {};
    const state = ws.createWorkflowState({
        idReclamacao: dadosFormulario.id_reclamacao,
        dadosFormulario
    });
    state.pipelineMode = PIPELINE_MODE.SHADOW;

    let dadosPlanilha = input.dadosPlanilha;
    if (dadosPlanilha === undefined && deps.carregarDadosAprendizadoCompleto) {
        dadosPlanilha = await learningLayer.carregarAprendizado(deps, dadosFormulario.tipo_solicitacao);
    }

    const conhecimentoProdutos = input.conhecimentoProdutos != null
        ? input.conhecimentoProdutos
        : learningLayer.obterConhecimentoProduto(deps, dadosFormulario);

    const insumos = preProcessor.buildInsumosPreparados(
        dadosFormulario,
        dadosPlanilha,
        conhecimentoProdutos,
        deps
    );

    ws.setInsumosPreparados(state, insumos);
    ws.addArtefato(state, {
        node: NODES.PRE_PROCESSOR,
        tipo: 'InsumosPreparados',
        schemaVersion: insumos.schemaVersion,
        payload: insumos
    });

    ws.addTelemetria(state, {
        node: NODES.PRE_PROCESSOR,
        actor: ACTORS.CODIGO,
        duracaoMs: Date.now() - t0,
        regimeSolucao: insumos.regimeSolucao,
        coerentesMantidos: insumos.kitReferencia?.curadoria?.mantidos ?? 0
    });

    const persistResult = await persistence.persistShadowState(state, deps);
    return { state: ws.serialize(state), persistResult };
}

function scheduleShadowPreProcess(input, deps = {}) {
    runShadowPreProcess(input, deps).catch(err => {
        const msg = `[resposta-pipeline] shadow falhou (nao bloqueante): ${err.message}`;
        if (typeof deps.onError === 'function') deps.onError(msg, err);
        else console.error(msg);
    });
}

async function finalizeMonolithTelemetry(input = {}, deps = {}) {
    const mode = getPipelineMode(input.envVars || {});
    if (mode !== PIPELINE_MODE.SHADOW) {
        return null;
    }

    const state = ws.createWorkflowState({
        idReclamacao: input.dadosFormulario?.id_reclamacao,
        dadosFormulario: input.dadosFormulario
    });
    state.pipelineMode = PIPELINE_MODE.SHADOW;

    if (input.insumosPreparados) {
        ws.setInsumosPreparados(state, input.insumosPreparados);
    }

    telemetry.recordMonolithTelemetry(state, {
        ...input.metrics,
        pipelineMode: mode
    });

    return persistence.persistShadowState(state, deps);
}

/**
 * Executa pipeline Plan-and-Execute (Fase 1).
 */
async function runPlanExec(input = {}, deps = {}) {
    const dadosFormulario = input.dadosFormulario || {};
    const state = ws.createWorkflowState({
        idReclamacao: dadosFormulario.id_reclamacao,
        dadosFormulario
    });

    let dadosPlanilha = input.dadosPlanilha;
    if (dadosPlanilha === undefined && deps.carregarDadosAprendizadoCompleto) {
        dadosPlanilha = await deps.carregarDadosAprendizadoCompleto(dadosFormulario.tipo_solicitacao);
    }

    const conhecimentoProdutos = input.conhecimentoProdutos != null
        ? input.conhecimentoProdutos
        : (deps.obterConhecimentoProdutos
            ? deps.obterConhecimentoProdutos(dadosFormulario)
            : learningLayer.obterConhecimentoProduto(deps, dadosFormulario));

    const pipelineDeps = {
        ...deps,
        dadosFormulario,
        dadosPlanilha,
        conhecimentoProdutos,
        userData: input.userData || deps.userData || null,
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        envVars: deps.envVars || input.envVars || {},
        factualAuditorEnabled: isPevFactualAuditorEnabled(deps.envVars || input.envVars || {}),
        editorialAuditorEnabled: isPevEditorialAuditorEnabled(deps.envVars || input.envVars || {}),
        conditionalAuditEnabled: isPevConditionalAuditEnabled(deps.envVars || input.envVars || {}),
        conditionalAuditShadow: isPevConditionalAuditShadow(deps.envVars || input.envVars || {}),
        skipFactualTier1Enabled: isPevSkipFactualTier1Enabled(deps.envVars || input.envVars || {}),
        raStandardExecutorEnabled: isPevRaStandardEnabled(deps.envVars || input.envVars || {}),
        systemPromptRA: SYSTEM_PROMPT_RA,
        models: {
            planner: deps.envVars?.OPENAI_MODEL || deps.models?.planner,
            executor: deps.envVars?.OPENAI_MODEL || deps.models?.executor,
            auditorFactual: deps.envVars?.OPENAI_MODEL || deps.models?.auditorFactual,
            auditorEditorial: deps.envVars?.OPENAI_MODEL || deps.models?.auditorEditorial
        }
    };

    const result = await orchestrator.runPlanExecPipeline(state, pipelineDeps);

    const envVars = deps.envVars || input.envVars || {};
    if (isPevChanceModeracaoEnabled(envVars)) {
        await chanceModeracao.runChanceModeracao(state, pipelineDeps);
    }

    const persistResult = await persistence.persistWorkflowState(state, deps);

    if (isPevObservabilityEnabled(envVars)) {
        observability.indexer.scheduleIndex(state.executionId, deps);
    }

    const chancePayload = state.chanceModeracao?.executada
        ? {
            success: !!state.chanceModeracao.sucesso,
            result: state.chanceModeracao.result,
            motor: state.chanceModeracao.motor
        }
        : null;

    return {
        ...result,
        chanceModeracao: chancePayload,
        state: ws.serialize(state),
        persistResult
    };
}

module.exports = {
    constants,
    contracts,
    getPipelineMode,
    isShadowEnabled,
    isPevPlanExecEnabled,
    isPevFactualAuditorEnabled,
    isPevEditorialAuditorEnabled,
    isPevConditionalAuditEnabled,
    isPevConditionalAuditShadow,
    isPevSkipFactualTier1Enabled,
    isPevChanceModeracaoEnabled,
    isPevRaStandardEnabled,
    isPevObservabilityEnabled,
    isPevObservabilityExportsEnabled,
    observability,
    responseBuilder,
    chanceModeracao,
    runShadowPreProcess,
    scheduleShadowPreProcess,
    finalizeMonolithTelemetry,
    runPlanExec,
    createWorkflowState: ws.createWorkflowState,
    buildInsumosPreparados: preProcessor.buildInsumosPreparados,
    preProcessor,
    persistence,
    telemetry,
    orchestrator
};
