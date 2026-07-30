'use strict';

const { NODES, DEFAULTS, ACTORS, PIPELINE_MODE, RECOMENDACAO_RETRY, PRICES } = require('./constants');
const promptRegistry = require('./promptRegistry');
const { openaiStep, parseJsonTolerante } = require('./openaiStep');
const ws = require('./workflowState');
const { validateMiolo } = require('./deterministicGate');
const { evaluateSkipFactual, evaluateSkipEditorial } = require('./auditorSkipPolicy');
const { PLANNER, EXECUTOR, AUDITOR_FACTUAL, AUDITOR_EDITORIAL } = require('./steps');
const {
    isPlanoDeRespostaValid,
    assertFatosSubset,
    isRascunhoMioloValid,
    isVereditoFactualValid,
    isVereditoEditorialValid
} = require('./contracts');
const { mapResult } = require('./resultMapper');
const preProcessor = require('./preProcessor');
const responseBuilder = require('./responseBuilder');

function artefatoTipoPrompt(step) {
    if (step.id === 'planner') return 'PlanoDeResposta';
    if (step.id === 'executor') return 'RascunhoMiolo';
    if (step.id === 'auditor-factual') return 'VereditoFactualPrompt';
    if (step.id === 'auditor-editorial') return 'VereditoEditorialPrompt';
    return step.id;
}

async function runNode(state, step, deps) {
    const ctx = await step.buildCtx(state, deps);
    const rendered = promptRegistry.render(step.promptRef, ctx);

    const runFn = deps.openaiStep || openaiStep;
    const result = await runFn({
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl || 'https://api.openai.com/v1',
        model: step.model(deps),
        temperature: step.temperature(deps),
        messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user }
        ],
        responseFormat: rendered.responseFormat,
        maxTokens: step.maxTokens(deps),
        timeoutMs: deps.timeoutMs || DEFAULTS.openaiTimeoutMs
    });

    const parsed = parseJsonTolerante(result.conteudo);
    if (!parsed) {
        const err = new Error(`[orchestrator] Falha ao parsear JSON do no ${step.id}`);
        err.conteudo = result.conteudo;
        err.step = step;
        err.rendered = rendered;
        err.result = result;
        throw err;
    }

    const partial = step.toPartial(parsed, state);
    ws.applyStepResult(state, step, partial, { actor: step.actor || ACTORS.LLM });

    ws.addArtefato(state, {
        node: step.node,
        tipo: artefatoTipoPrompt(step),
        promptId: rendered.promptId,
        version: rendered.version,
        ref: rendered.ref,
        hash: rendered.hash,
        promptRenderizado: { system: rendered.system, user: rendered.user },
        respostaCrua: result.conteudo,
        parsed
    });

    ws.addTelemetria(state, {
        node: step.node,
        model: result.model,
        temperature: result.temperature,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        totalTokens: result.usage?.total_tokens ?? null,
        custoEstimado: result.custoEstimado,
        duracaoMs: result.duracaoMs,
        promptVersion: `${rendered.promptId}@${rendered.version}`
    });

    return { parsed, result, rendered };
}

function validatePlannerOutput(state) {
    const plano = state.planoDeResposta;
    if (!isPlanoDeRespostaValid(plano)) {
        return { ok: false, motivo: 'estrutura_invalida' };
    }
    const subset = assertFatosSubset(plano, state.insumosPreparados?.matrizAutoridade);
    if (!subset.ok) {
        return { ok: false, motivo: 'fatos_fora_matriz', detalhe: subset.violacoes.join('; ') };
    }
    return { ok: true };
}

async function runPlannerWithTechnicalRetry(state, deps) {
    const maxRetries = Number.isInteger(deps.maxPlannerTechnicalRetries)
        ? deps.maxPlannerTechnicalRetries
        : DEFAULTS.maxPlannerTechnicalRetries;

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                state.plannerTechnicalRetryCount = attempt;
                deps = { ...deps, erroTecnicoAnterior: state._plannerErroTecnico };
                ws.reopenForStep(state, PLANNER);
            }
            await runNode(state, PLANNER, deps);
            const validation = validatePlannerOutput(state);
            if (!validation.ok) {
                const msg = validation.detalhe
                    ? `${validation.motivo}: ${validation.detalhe}`
                    : validation.motivo;
                state._plannerErroTecnico = msg;
                lastErr = new Error(`[orchestrator] Planner output invalido: ${msg}`);
                if (attempt < maxRetries) continue;
                throw lastErr;
            }
            return state.planoDeResposta;
        } catch (err) {
            lastErr = err;
            state._plannerErroTecnico = err.message;
            if (attempt < maxRetries) continue;
            throw err;
        }
    }
    throw lastErr || new Error('[orchestrator] Planner falhou');
}

async function runExecutorWithGateRetry(state, deps) {
    const maxRetries = Number.isInteger(deps.maxExecutorRetries)
        ? deps.maxExecutorRetries
        : DEFAULTS.maxExecutorRetries;

    const ins = state.insumosPreparados || {};
    const solucao = ins.casoNormalizado?.solucao_implementada || state.entradasCruas?.solucao_implementada || '';
    const regime = ins.regimeSolucao;

    let veredito = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
        if (attempt > 0) {
            state.executorRetryCount = attempt;
            ws.reopenForStep(state, EXECUTOR);
            state._gateFeedback = veredito;
        }

        await runNode(state, EXECUTOR, { ...deps, gateFeedback: veredito });

        if (!isRascunhoMioloValid(state.rascunhoMiolo)) {
            throw new Error('[orchestrator] Executor produziu RascunhoMiolo invalido');
        }

        veredito = validateMiolo(state.rascunhoMiolo.conteudo, {
            solucaoImplementada: solucao,
            regimeSolucao: regime
        });
        state.vereditoGate = veredito;

        ws.addArtefato(state, {
            node: NODES.DETERMINISTIC_GATE,
            tipo: 'VereditoGate',
            payload: veredito,
            attempt
        });

        ws.logDecision(state, {
            node: NODES.DETERMINISTIC_GATE,
            actor: ACTORS.CODIGO,
            event: veredito.aprovado ? 'gate.aprovado' : 'gate.reprovado',
            reason: veredito.falhas.map(f => f.tipo).join(', ') || 'ok'
        });

        if (veredito.aprovado) {
            return state.rascunhoMiolo.conteudo;
        }

        if (attempt >= maxRetries) break;
        attempt += 1;
    }

    return null;
}

async function runAuditorWithTechnicalRetry(state, deps, { attempt = 0 } = {}) {
    const maxRetries = Number.isInteger(deps.maxAuditorTechnicalRetries)
        ? deps.maxAuditorTechnicalRetries
        : DEFAULTS.maxAuditorTechnicalRetries;

    let lastErr = null;
    for (let techAttempt = 0; techAttempt <= maxRetries; techAttempt++) {
        try {
            if (techAttempt > 0) {
                state.auditorTechnicalRetryCount = techAttempt;
                deps = { ...deps, erroTecnicoAnterior: state._auditorErroTecnico };
                ws.reopenForStep(state, AUDITOR_FACTUAL);
            } else if (state._meta?.consolidated?.vereditoFactual) {
                ws.reopenForStep(state, AUDITOR_FACTUAL);
            }

            const { parsed } = await runNode(state, AUDITOR_FACTUAL, deps);
            const claimsTrace = parsed._claims_trace || parsed.claims_trace || null;
            if (claimsTrace) {
                ws.addArtefato(state, {
                    node: NODES.AUDITOR_FACTUAL,
                    tipo: 'ClaimsAuditTrace',
                    payload: claimsTrace,
                    attempt
                });
            }

            const veredito = state.vereditoFactual;
            if (!isVereditoFactualValid(veredito)) {
                const msg = 'estrutura_invalida_ou_prefixo_factual';
                state._auditorErroTecnico = msg;
                lastErr = new Error(`[orchestrator] AuditorFactual output invalido: ${msg}`);
                if (techAttempt < maxRetries) continue;
                throw lastErr;
            }

            ws.addArtefato(state, {
                node: NODES.AUDITOR_FACTUAL,
                tipo: 'VereditoFactual',
                payload: veredito,
                attempt
            });

            ws.logDecision(state, {
                node: NODES.AUDITOR_FACTUAL,
                actor: ACTORS.LLM,
                event: veredito.aprovado ? 'auditor.aprovado' : 'auditor.reprovado',
                reason: veredito.falhas.map(f => f.tipo).join(', ') || 'ok'
            });

            return veredito;
        } catch (err) {
            lastErr = err;
            state._auditorErroTecnico = err.message;
            if (techAttempt < maxRetries) continue;
            throw err;
        }
    }
    throw lastErr || new Error('[orchestrator] AuditorFactual falhou');
}

async function runFactualAuditWithRetry(state, deps) {
    const maxFactualRetries = Number.isInteger(deps.maxFactualExecutorRetries)
        ? deps.maxFactualExecutorRetries
        : DEFAULTS.maxFactualExecutorRetries;

    let factualAttempt = 0;

    while (true) {
        const veredito = await runAuditorWithTechnicalRetry(state, deps, { attempt: factualAttempt });
        state.vereditoFactual = veredito;

        if (veredito.aprovado) {
            return state.rascunhoMiolo.conteudo;
        }

        if (veredito.recomendacaoRetry === RECOMENDACAO_RETRY.PLANNER) {
            ws.logDecision(state, {
                node: NODES.AUDITOR_FACTUAL,
                actor: ACTORS.CODIGO,
                event: 'auditor.planner_fallback',
                reason: veredito.falhas.map(f => f.tipo).join(', ')
            });
            return null;
        }

        if (veredito.recomendacaoRetry !== RECOMENDACAO_RETRY.EXECUTOR) {
            return null;
        }

        if (factualAttempt >= maxFactualRetries) {
            ws.logDecision(state, {
                node: NODES.AUDITOR_FACTUAL,
                actor: ACTORS.CODIGO,
                event: 'auditor.retries_esgotados',
                reason: veredito.falhas.map(f => f.tipo).join(', ')
            });
            return null;
        }

        factualAttempt += 1;
        state.factualRetryCount = factualAttempt;
        state._factualFeedback = veredito;
        state._gateFeedback = null;

        ws.reopenForStep(state, EXECUTOR);
        const miolo = await runExecutorWithGateRetry(state, {
            ...deps,
            gateFeedback: null,
            factualFeedback: veredito
        });

        if (!miolo) {
            return null;
        }
    }
}

async function runEditorialAuditWithRetry(state, deps, { factualEnabled = false } = {}) {
    const maxEditorialRetries = Number.isInteger(deps.maxEditorialExecutorRetries)
        ? deps.maxEditorialExecutorRetries
        : DEFAULTS.maxEditorialExecutorRetries;

    let editorialAttempt = 0;

    while (true) {
        const veredito = await runAuditorEditorialWithTechnicalRetry(state, deps, { attempt: editorialAttempt });
        state.vereditoEditorial = veredito;

        if (veredito.aprovado) {
            return state.rascunhoMiolo.conteudo;
        }

        if (veredito.recomendacaoRetry !== RECOMENDACAO_RETRY.EXECUTOR) {
            return null;
        }

        if (editorialAttempt >= maxEditorialRetries) {
            ws.logDecision(state, {
                node: NODES.AUDITOR_EDITORIAL,
                actor: ACTORS.CODIGO,
                event: 'auditor.retries_esgotados',
                reason: veredito.falhas.map(f => f.tipo).join(', ')
            });
            return null;
        }

        editorialAttempt += 1;
        state.editorialRetryCount = editorialAttempt;
        state._editorialFeedback = veredito;
        state._gateFeedback = null;
        state._factualFeedback = null;

        ws.reopenForStep(state, EXECUTOR);
        let miolo = await runExecutorWithGateRetry(state, {
            ...deps,
            gateFeedback: null,
            factualFeedback: null,
            editorialFeedback: veredito
        });

        if (!miolo) {
            return null;
        }

        if (factualEnabled) {
            miolo = await runFactualAuditWithRetry(state, deps);
            if (!miolo) {
                return null;
            }
        }
    }
}

async function runAuditorEditorialWithTechnicalRetry(state, deps, { attempt = 0 } = {}) {
    const maxRetries = Number.isInteger(deps.maxAuditorEditorialTechnicalRetries)
        ? deps.maxAuditorEditorialTechnicalRetries
        : DEFAULTS.maxAuditorEditorialTechnicalRetries;

    let lastErr = null;
    for (let techAttempt = 0; techAttempt <= maxRetries; techAttempt++) {
        try {
            if (techAttempt > 0) {
                state.auditorEditorialTechnicalRetryCount = techAttempt;
                deps = { ...deps, erroTecnicoAnterior: state._auditorEditorialErroTecnico };
                ws.reopenForStep(state, AUDITOR_EDITORIAL);
            } else if (state._meta?.consolidated?.vereditoEditorial) {
                ws.reopenForStep(state, AUDITOR_EDITORIAL);
            }

            const { parsed } = await runNode(state, AUDITOR_EDITORIAL, deps);
            const rubricaTrace = parsed._rubrica_trace || parsed.rubrica_trace || null;
            if (rubricaTrace) {
                ws.addArtefato(state, {
                    node: NODES.AUDITOR_EDITORIAL,
                    tipo: 'RubricaAuditTrace',
                    payload: rubricaTrace,
                    attempt
                });
            }

            const veredito = state.vereditoEditorial;
            if (!isVereditoEditorialValid(veredito)) {
                const msg = 'estrutura_invalida_ou_prefixo_editorial';
                state._auditorEditorialErroTecnico = msg;
                lastErr = new Error(`[orchestrator] AuditorEditorial output invalido: ${msg}`);
                if (techAttempt < maxRetries) continue;
                throw lastErr;
            }

            ws.addArtefato(state, {
                node: NODES.AUDITOR_EDITORIAL,
                tipo: 'VereditoEditorial',
                payload: veredito,
                attempt
            });

            ws.logDecision(state, {
                node: NODES.AUDITOR_EDITORIAL,
                actor: ACTORS.LLM,
                event: veredito.aprovado ? 'auditor.aprovado' : 'auditor.reprovado',
                reason: veredito.falhas.map(f => f.tipo).join(', ') || 'ok'
            });

            return veredito;
        } catch (err) {
            lastErr = err;
            state._auditorEditorialErroTecnico = err.message;
            if (techAttempt < maxRetries) continue;
            throw err;
        }
    }
    throw lastErr || new Error('[orchestrator] AuditorEditorial falhou');
}

function applyFallback(state, deps) {
    const df = {
        ...state.entradasCruas,
        solucao_implementada: state.entradasCruas?.solucao_implementada || '',
        texto_cliente: state.entradasCruas?.texto_cliente || '',
        tipo_solicitacao: state.entradasCruas?.tipo_solicitacao || '',
        motivo_solicitacao: state.entradasCruas?.motivo_solicitacao || ''
    };

    if (typeof deps.montarTextoFallbackRespostaRA !== 'function') {
        throw new Error('[orchestrator] montarTextoFallbackRespostaRA ausente em deps');
    }

    const conteudo = deps.montarTextoFallbackRespostaRA(df);
    state.usedFallback = true;
    state.rascunhoMiolo = { schemaVersion: '1.0', conteudo };
    ws.logDecision(state, {
        node: NODES.DETERMINISTIC_GATE,
        actor: ACTORS.CODIGO,
        event: 'fallback.mecanico',
        reason: 'gate_ou_planner_esgotou_tentativas'
    });
    return conteudo;
}

function buildSkipDeps(deps) {
    return {
        conditionalAuditEnabled: deps.conditionalAuditEnabled === true,
        conditionalAuditShadow: deps.conditionalAuditShadow === true,
        skipFactualTier1Enabled: deps.skipFactualTier1Enabled === true,
        factualAuditorEnabled: deps.factualAuditorEnabled === true,
        editorialAuditorEnabled: deps.editorialAuditorEnabled === true
    };
}

function persistDecisaoSkip(state, decisao, shadowMode) {
    const payload = { ...decisao, shadowMode: !!shadowMode };
    ws.addArtefato(state, {
        node: NODES.AUDITOR_SKIP_POLICY,
        tipo: 'DecisaoExecucaoAuditor',
        payload
    });

    if (!payload.executar && !shadowMode) {
        ws.logDecision(state, {
            node: NODES.AUDITOR_SKIP_POLICY,
            actor: ACTORS.CODIGO,
            event: 'skip.auditor',
            reason: payload.codigoMotivo
        });
    }

    if (!Array.isArray(state.skipDecisions)) {
        state.skipDecisions = [];
    }
    state.skipDecisions.push(payload);
    return payload;
}

function shouldRunAuditor(decisao, shadowMode) {
    return decisao.executar || shadowMode;
}

function estimateSkippedAuditorSavings(state, alvo) {
    const maxTokens = alvo === NODES.AUDITOR_FACTUAL
        ? DEFAULTS.maxTokens.auditorFactual
        : DEFAULTS.maxTokens.auditorEditorial;
    const estimatedTokens = maxTokens * 2;
    const model = alvo === NODES.AUDITOR_FACTUAL
        ? (DEFAULTS.models.auditorFactual || 'gpt-4o')
        : (DEFAULTS.models.auditorEditorial || 'gpt-4o');
    const prices = PRICES[model] || { input: 2.5, output: 10 };
    const custoEstimado = (maxTokens * prices.input + maxTokens * prices.output) / 1e6;

    state._skipSavingsEstimados = state._skipSavingsEstimados || { tokens: 0, latenciaMs: 0, custo: 0 };
    state._skipSavingsEstimados.tokens += estimatedTokens;
    state._skipSavingsEstimados.latenciaMs += 3000;
    state._skipSavingsEstimados.custo += custoEstimado;
}

function countOpenaiCalls(state) {
    return (state.telemetria || []).filter(t =>
        t.node === NODES.PLANNER
        || t.node === NODES.EXECUTOR
        || t.node === NODES.AUDITOR_FACTUAL
        || t.node === NODES.AUDITOR_EDITORIAL
    ).length;
}

/**
 * Etapa terminal de composicao — transforma conteudoMiolo em respostaPublica.
 * Nao e no cognitivo; nao acumular responsabilidades futuras neste helper.
 */
function finalizeWithResponseBuilder(state, deps, { conteudoMiolo, usedFallback, metrics } = {}) {
    const ctx = responseBuilder.resolveContextoResposta({
        entradasCruas: state.entradasCruas,
        userData: deps.userData
    });
    state.respostaPublica = responseBuilder.buildRespostaPublica({
        conteudoMiolo,
        nomeCliente: ctx.nomeCliente,
        nomeAgente: ctx.nomeAgente,
        userData: deps.userData
    });
    ws.addArtefato(state, {
        tipo: 'RespostaPublica',
        payload: { respostaPublica: state.respostaPublica }
    });
    return mapResult(state, { conteudoMiolo, usedFallback, metrics });
}

/**
 * Pipeline Fase 1/2/3: PreProcessor -> Planner -> Executor -> Gate [-> Factual] [-> Editorial].
 */
async function runPlanExecPipeline(state, deps = {}) {
    const t0 = Date.now();
    state.pipelineMode = PIPELINE_MODE.PEV;
    const factualEnabled = deps.factualAuditorEnabled === true;
    const editorialEnabled = deps.editorialAuditorEnabled === true;
    const skipDeps = buildSkipDeps(deps);

    state.conditionalAuditEnabled = skipDeps.conditionalAuditEnabled;
    state.conditionalAuditShadow = skipDeps.conditionalAuditShadow;

    const insumos = preProcessor.buildInsumosPreparados(
        deps.dadosFormulario || state.entradasCruas,
        deps.dadosPlanilha,
        deps.conhecimentoProdutos,
        deps
    );
    ws.setInsumosPreparados(state, insumos);
    ws.addArtefato(state, {
        node: NODES.PRE_PROCESSOR,
        tipo: 'InsumosPreparados',
        schemaVersion: insumos.schemaVersion,
        payload: insumos
    });

    let conteudoMiolo = null;

    try {
        await runPlannerWithTechnicalRetry(state, deps);
    } catch (err) {
        ws.logDecision(state, {
            node: NODES.PLANNER,
            actor: ACTORS.CODIGO,
            event: 'planner.falha_tecnica',
            reason: err.message
        });
        conteudoMiolo = applyFallback(state, deps);
        return finalizeWithResponseBuilder(state, deps, {
            conteudoMiolo,
            usedFallback: true,
            metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
        });
    }

    ws.addArtefato(state, {
        node: NODES.PLANNER,
        tipo: 'PlanoDeResposta',
        payload: state.planoDeResposta
    });

    try {
        conteudoMiolo = await runExecutorWithGateRetry(state, deps);
    } catch (err) {
        ws.logDecision(state, {
            node: NODES.EXECUTOR,
            actor: ACTORS.CODIGO,
            event: 'executor.falha',
            reason: err.message
        });
        conteudoMiolo = applyFallback(state, deps);
        return finalizeWithResponseBuilder(state, deps, {
            conteudoMiolo,
            usedFallback: true,
            metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
        });
    }

    if (!conteudoMiolo) {
        conteudoMiolo = applyFallback(state, deps);
        return finalizeWithResponseBuilder(state, deps, {
            conteudoMiolo,
            usedFallback: true,
            metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
        });
    }

    ws.addArtefato(state, {
        node: NODES.EXECUTOR,
        tipo: 'RascunhoMiolo',
        payload: state.rascunhoMiolo
    });

    if (factualEnabled) {
        try {
            let skipFactual = false;
            if (skipDeps.conditionalAuditEnabled) {
                const decisaoFactual = evaluateSkipFactual(state, skipDeps);
                persistDecisaoSkip(state, decisaoFactual, skipDeps.conditionalAuditShadow);
                skipFactual = !shouldRunAuditor(decisaoFactual, skipDeps.conditionalAuditShadow);
                if (skipFactual) {
                    state.factualAuditorSkipped = true;
                    estimateSkippedAuditorSavings(state, NODES.AUDITOR_FACTUAL);
                }
            }

            if (!skipFactual) {
                const factualMiolo = await runFactualAuditWithRetry(state, deps);
                if (!factualMiolo) {
                    conteudoMiolo = applyFallback(state, deps);
                    return finalizeWithResponseBuilder(state, deps, {
                        conteudoMiolo,
                        usedFallback: true,
                        metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
                    });
                }
                conteudoMiolo = factualMiolo;
            }
        } catch (err) {
            ws.logDecision(state, {
                node: NODES.AUDITOR_FACTUAL,
                actor: ACTORS.CODIGO,
                event: 'auditor.falha_tecnica',
                reason: err.message
            });
            conteudoMiolo = applyFallback(state, deps);
            return finalizeWithResponseBuilder(state, deps, {
                conteudoMiolo,
                usedFallback: true,
                metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
            });
        }
    }

    if (editorialEnabled) {
        try {
            let skipEditorial = false;
            if (skipDeps.conditionalAuditEnabled) {
                const decisaoEditorial = evaluateSkipEditorial(state, skipDeps);
                persistDecisaoSkip(state, decisaoEditorial, skipDeps.conditionalAuditShadow);
                skipEditorial = !shouldRunAuditor(decisaoEditorial, skipDeps.conditionalAuditShadow);
                if (skipEditorial) {
                    state.editorialAuditorSkipped = true;
                    estimateSkippedAuditorSavings(state, NODES.AUDITOR_EDITORIAL);
                }
            }

            if (!skipEditorial) {
                const editorialMiolo = await runEditorialAuditWithRetry(state, deps, { factualEnabled });
                if (!editorialMiolo) {
                    conteudoMiolo = applyFallback(state, deps);
                    return finalizeWithResponseBuilder(state, deps, {
                        conteudoMiolo,
                        usedFallback: true,
                        metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
                    });
                }
                conteudoMiolo = editorialMiolo;
            }
        } catch (err) {
            ws.logDecision(state, {
                node: NODES.AUDITOR_EDITORIAL,
                actor: ACTORS.CODIGO,
                event: 'auditor.falha_tecnica',
                reason: err.message
            });
            conteudoMiolo = applyFallback(state, deps);
            return finalizeWithResponseBuilder(state, deps, {
                conteudoMiolo,
                usedFallback: true,
                metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
            });
        }
    }

    return finalizeWithResponseBuilder(state, deps, {
        conteudoMiolo,
        usedFallback: false,
        metrics: { openaiCallCount: countOpenaiCalls(state), duracaoMs: Date.now() - t0 }
    });
}

module.exports = {
    runNode,
    runPlanExecPipeline,
    validatePlannerOutput,
    runPlannerWithTechnicalRetry,
    runExecutorWithGateRetry,
    runAuditorWithTechnicalRetry,
    runFactualAuditWithRetry,
    runAuditorEditorialWithTechnicalRetry,
    runEditorialAuditWithRetry,
    buildSkipDeps,
    persistDecisaoSkip,
    shouldRunAuditor
};
