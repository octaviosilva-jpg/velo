'use strict';

const { NODES, ACTORS, DEFAULTS, SCHEMA_VERSION } = require('./constants');

function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function mapCoerente(c) {
    if (!c) return null;
    return {
        id: c.id || '',
        similaridadePct: num(c.similaridade_pct ?? c.similaridadePct, 0),
        motivo: c.motivo || '',
        tipo: c.tipo || ''
    };
}

function mapBloco(b) {
    return {
        funcao: b.funcao,
        pontosObrigatorios: Array.isArray(b.pontos_obrigatorios) ? b.pontos_obrigatorios : (b.pontosObrigatorios || []),
        profundidadeEsperada: b.profundidade_esperada || b.profundidadeEsperada
    };
}

function mapPlanoFromParsed(parsed) {
    return {
        schemaVersion: SCHEMA_VERSION,
        problemaCentral: parsed.problema_central || parsed.problemaCentral || '',
        entendimentoSituacional: parsed.entendimento_situacional || parsed.entendimentoSituacional || '',
        modoOperacao: parsed.modo_operacao || parsed.modoOperacao,
        fontePrimaria: parsed.fonte_primaria || parsed.fontePrimaria,
        fatosAutorizados: parsed.fatos_autorizados || parsed.fatosAutorizados || [],
        fundamentacoesObrigatorias: parsed.fundamentacoes_obrigatorias || parsed.fundamentacoesObrigatorias || [],
        padraoResolucao: parsed.padrao_resolucao || parsed.padraoResolucao || '',
        coerentesUtilizadas: (parsed.coerentes_utilizadas || parsed.coerentesUtilizadas || []).map(mapCoerente).filter(Boolean),
        coerentesDescartadas: (parsed.coerentes_descartadas || parsed.coerentesDescartadas || []).map(c => ({
            id: c.id || '',
            motivo: c.motivo || ''
        })),
        estrategiaResolucao: parsed.estrategia_resolucao || parsed.estrategiaResolucao || '',
        planoArgumentativo: (parsed.plano_argumentativo || parsed.planoArgumentativo || []).map(mapBloco),
        exclusoes: parsed.exclusoes || [],
        temasRA: parsed.temas_ra || parsed.temasRA || []
    };
}

function mapVereditoFromParsed(parsed) {
    return {
        schemaVersion: SCHEMA_VERSION,
        aprovado: parsed.aprovado,
        falhas: (parsed.falhas || []).map(f => ({
            tipo: f.tipo,
            descricao: f.descricao,
            trecho: f.trecho,
            severidade: f.severidade
        })),
        recomendacaoRetry: parsed.recomendacao_retry || parsed.recomendacaoRetry
    };
}

function formatFeedback(falhas) {
    if (!falhas) return null;
    if (Array.isArray(falhas)) {
        return falhas.map(f => {
            const trecho = f.trecho ? ` [trecho: "${f.trecho}"]` : '';
            return `- ${f.tipo}: ${f.descricao}${trecho}`;
        }).join('\n');
    }
    return String(falhas);
}

const PLANNER = {
    id: 'planner',
    node: NODES.PLANNER,
    actor: ACTORS.LLM,
    promptRef: 'planner@v1',
    writes: ['planoDeResposta'],
    model: (deps) => deps.models?.planner || DEFAULTS.models.planner,
    temperature: (deps) => num(deps.temperatures?.planner, DEFAULTS.temperatures.planner),
    maxTokens: (deps) => num(deps.maxTokens?.planner, DEFAULTS.maxTokens.planner),
    buildCtx(state, deps) {
        const ins = state.insumosPreparados || {};
        return {
            casoNormalizado: JSON.stringify(ins.casoNormalizado || {}, null, 2),
            regimeSolucao: ins.regimeSolucao || '',
            rotaExecucao: ins.rotaExecucao || '',
            kitReferencia: JSON.stringify(ins.kitReferencia || {}, null, 2),
            matrizAutoridade: JSON.stringify(ins.matrizAutoridade || {}, null, 2),
            erroTecnicoAnterior: deps.erroTecnicoAnterior || state._plannerErroTecnico || null
        };
    },
    toPartial(parsed) {
        return { planoDeResposta: mapPlanoFromParsed(parsed) };
    }
};

const EXECUTOR = {
    id: 'executor',
    node: NODES.EXECUTOR,
    actor: ACTORS.LLM,
    promptRef: 'executor@v1',
    writes: ['rascunhoMiolo'],
    model: (deps) => deps.models?.executor || DEFAULTS.models.executor,
    temperature: (deps) => num(deps.temperatures?.executor, DEFAULTS.temperatures.executor),
    maxTokens: (deps) => num(deps.maxTokens?.executor, DEFAULTS.maxTokens.executor),
    buildCtx(state, deps) {
        const ins = state.insumosPreparados || {};
        const gateFeedback = deps.gateFeedback || state._gateFeedback || null;
        const factualFeedback = deps.factualFeedback || state._factualFeedback || null;
        const editorialFeedback = deps.editorialFeedback || state._editorialFeedback || null;
        return {
            planoDeResposta: JSON.stringify(state.planoDeResposta || {}, null, 2),
            matrizAutoridade: JSON.stringify(ins.matrizAutoridade || {}, null, 2),
            kitReferencia: JSON.stringify({
                coerentes: (ins.kitReferencia?.coerentes || []).slice(0, 3),
                feedbacks: (ins.kitReferencia?.feedbacks || []).slice(0, 3)
            }, null, 2),
            gateFeedback: formatFeedback(gateFeedback?.falhas || gateFeedback),
            factualFeedback: formatFeedback(factualFeedback?.falhas || factualFeedback),
            editorialFeedback: formatFeedback(editorialFeedback?.falhas || editorialFeedback)
        };
    },
    toPartial(parsed) {
        return {
            rascunhoMiolo: {
                schemaVersion: SCHEMA_VERSION,
                conteudo: parsed.conteudo || parsed.texto || parsed.miolo || ''
            }
        };
    }
};

const EXECUTOR_RA = {
    id: 'executor-ra',
    node: NODES.EXECUTOR,
    actor: ACTORS.LLM,
    promptRef: 'executor-ra@v1',
    writes: ['rascunhoMiolo'],
    model: (deps) => deps.models?.executor || DEFAULTS.models.executor,
    temperature: (deps) => {
        if (deps.raExecutorTemperature != null) return deps.raExecutorTemperature;
        return num(deps.temperatures?.executor, DEFAULTS.temperatures.executor);
    },
    maxTokens: (deps) => num(deps.maxTokens?.executor, DEFAULTS.maxTokens.executor),
    buildCtx(state, deps) {
        const gateFeedback = deps.gateFeedback || state._gateFeedback || null;
        const factualFeedback = deps.factualFeedback || state._factualFeedback || null;
        const editorialFeedback = deps.editorialFeedback || state._editorialFeedback || null;
        return {
            promptUsuario: state._raPromptUsuario || deps.raPromptUsuario || '',
            systemPromptRA: deps.systemPromptRA || null,
            gateFeedback: formatFeedback(gateFeedback?.falhas || gateFeedback),
            factualFeedback: formatFeedback(factualFeedback?.falhas || factualFeedback),
            editorialFeedback: formatFeedback(editorialFeedback?.falhas || editorialFeedback)
        };
    },
    toPartial(parsed) {
        return {
            rascunhoMiolo: {
                schemaVersion: SCHEMA_VERSION,
                conteudo: parsed.conteudo || parsed.texto || parsed.miolo || ''
            }
        };
    }
};

const AUDITOR_FACTUAL = {
    id: 'auditor-factual',
    node: NODES.AUDITOR_FACTUAL,
    actor: ACTORS.LLM,
    promptRef: 'auditor-factual@v1',
    writes: ['vereditoFactual'],
    model: (deps) => deps.models?.auditorFactual || DEFAULTS.models.auditorFactual,
    temperature: (deps) => num(deps.temperatures?.auditorFactual, DEFAULTS.temperatures.auditorFactual),
    maxTokens: (deps) => num(deps.maxTokens?.auditorFactual, DEFAULTS.maxTokens.auditorFactual),
    buildCtx(state, deps) {
        const ins = state.insumosPreparados || {};
        const caso = ins.casoNormalizado || {};
        return {
            regimeSolucao: ins.regimeSolucao || '',
            casoNormalizado: JSON.stringify({
                texto_cliente: caso.texto_cliente || '',
                solucao_implementada: caso.solucao_implementada || ''
            }, null, 2),
            planoDeResposta: JSON.stringify(state.planoDeResposta || {}, null, 2),
            matrizAutoridade: JSON.stringify(ins.matrizAutoridade || {}, null, 2),
            rascunhoMiolo: state.rascunhoMiolo?.conteudo || '',
            erroTecnicoAnterior: deps.erroTecnicoAnterior || state._auditorErroTecnico || null
        };
    },
    toPartial(parsed) {
        return { vereditoFactual: mapVereditoFromParsed(parsed) };
    }
};

const AUDITOR_EDITORIAL = {
    id: 'auditor-editorial',
    node: NODES.AUDITOR_EDITORIAL,
    actor: ACTORS.LLM,
    promptRef: 'auditor-editorial@v1',
    writes: ['vereditoEditorial'],
    model: (deps) => deps.models?.auditorEditorial || DEFAULTS.models.auditorEditorial,
    temperature: (deps) => num(deps.temperatures?.auditorEditorial, DEFAULTS.temperatures.auditorEditorial),
    maxTokens: (deps) => num(deps.maxTokens?.auditorEditorial, DEFAULTS.maxTokens.auditorEditorial),
    buildCtx(state, deps) {
        const ins = state.insumosPreparados || {};
        const caso = ins.casoNormalizado || {};
        const { PALAVRAS_GENERICAS } = require('./deterministicGate');
        return {
            regimeSolucao: ins.regimeSolucao || '',
            casoNormalizado: JSON.stringify({
                texto_cliente: caso.texto_cliente || '',
                motivo_solicitacao: caso.motivo_solicitacao || '',
                tipo_solicitacao: caso.tipo_solicitacao || ''
            }, null, 2),
            planoDeResposta: JSON.stringify(state.planoDeResposta || {}, null, 2),
            checklistRA: ins.kitReferencia?.checklistRA || '',
            rascunhoMiolo: state.rascunhoMiolo?.conteudo || '',
            palavrasGenericas: PALAVRAS_GENERICAS.join(', '),
            erroTecnicoAnterior: deps.erroTecnicoAnterior || state._auditorEditorialErroTecnico || null
        };
    },
    toPartial(parsed) {
        return { vereditoEditorial: mapVereditoFromParsed(parsed) };
    }
};

const STEPS = [PLANNER, EXECUTOR, AUDITOR_FACTUAL, AUDITOR_EDITORIAL];

module.exports = {
    STEPS,
    PLANNER,
    EXECUTOR,
    EXECUTOR_RA,
    AUDITOR_FACTUAL,
    AUDITOR_EDITORIAL,
    mapPlanoFromParsed,
    mapVereditoFromParsed
};
