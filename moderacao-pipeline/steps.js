'use strict';

const { NODES, ETAPAS, DEFAULTS } = require('./constants');

/**
 * Registro data-driven dos 3 nos (1 chamada cada). Cada step declara:
 *  - writes: campos do WorkflowState que pode escrever (write-guard)
 *  - etapas: etapas logicas cobertas (rastreabilidade E1..E7)
 *  - promptRef: template versionado
 *  - model/temperature/maxTokens: selecionados a partir de deps/env
 *  - buildCtx(state, deps): contexto para o prompt (pode ser async)
 *  - toPartial(parsed, state): converte o JSON do modelo em partial do estado
 *
 * A execucao (render prompt -> openaiStep -> applyStepResult) fica no orchestrator.
 */

function arr(x) { return Array.isArray(x) ? x : (x == null ? [] : [x]); }

const COMPREENSAO = {
    id: 'COMPREENSAO',
    node: NODES.COMPREENSAO,
    etapas: [ETAPAS.E1_FATOS, ETAPAS.E2_CONFLITO, ETAPAS.E3_COBERTURA],
    promptRef: 'compreensao@v1',
    actor: 'llm',
    writes: ['fatos', 'pedidos', 'acusacoes', 'fatosResposta', 'solucoes', 'consideracaoTipo', 'novosFatos', 'conflitoPrincipal', 'conflitosSecundarios', 'coberturaResposta'],
    model: (deps) => deps.models?.compreensao || DEFAULTS.models.compreensao,
    temperature: (deps) => num(deps.temperatures?.compreensao, DEFAULTS.temperatures.compreensao),
    maxTokens: (deps) => deps.maxTokens?.compreensao || DEFAULTS.maxTokens.compreensao,
    buildCtx(state) {
        return {
            solicitacao: state.entradasCruas.solicitacao,
            resposta: state.entradasCruas.resposta,
            consideracao: state.entradasCruas.consideracao
        };
    },
    toPartial(parsed) {
        parsed = parsed || {};
        return {
            fatos: arr(parsed.fatos_reclamacao),
            pedidos: arr(parsed.pedidos_cliente),
            acusacoes: arr(parsed.acusacoes),
            fatosResposta: arr(parsed.fatos_resposta),
            solucoes: arr(parsed.solucoes_apresentadas),
            consideracaoTipo: parsed.consideracao_tipo || null,
            novosFatos: arr(parsed.novos_fatos),
            conflitoPrincipal: parsed.conflito_principal || null,
            conflitosSecundarios: arr(parsed.conflitos_secundarios),
            coberturaResposta: arr(parsed.cobertura_resposta)
        };
    }
};

const DECISAO = {
    id: 'DECISAO',
    node: NODES.DECISAO,
    etapas: [ETAPAS.E4_HIPOTESE, ETAPAS.E5_AUTOAUDITORIA],
    promptRef: 'decisao@v3',
    actor: 'llm',
    writes: ['analiseDecisao', 'hipotesesCandidatas', 'hipotesesDescartadas', 'hipoteseSelecionada', 'justificativa', 'trechosSustentam', 'confianca'],
    model: (deps) => deps.models?.decisao || DEFAULTS.models.decisao,
    temperature: (deps) => num(deps.temperatures?.decisao, DEFAULTS.temperatures.decisao),
    maxTokens: (deps) => deps.maxTokens?.decisao || DEFAULTS.maxTokens.decisao,
    async buildCtx(state, deps) {
        return {
            compreensao: {
                fatos: state.fatos, pedidos: state.pedidos, acusacoes: state.acusacoes,
                fatosResposta: state.fatosResposta, solucoes: state.solucoes,
                consideracaoTipo: state.consideracaoTipo,
                conflitoPrincipal: state.conflitoPrincipal, conflitosSecundarios: state.conflitosSecundarios,
                coberturaResposta: state.coberturaResposta
            },
            solicitacao: state.entradasCruas.solicitacao,
            resposta: state.entradasCruas.resposta,
            consideracao: state.entradasCruas.consideracao,
            manualBloco: deps.buildManualBloco ? await deps.buildManualBloco(state) : '',
            universoHipoteses: deps.buildUniversoHipoteses ? await deps.buildUniversoHipoteses(state) : ''
        };
    },
    toPartial(parsed) {
        parsed = parsed || {};
        const ah = parsed.analise_holistica || null;
        return {
            analiseDecisao: ah ? {
                nucleoReclamacao: ah.nucleo_reclamacao || '',
                conflitos: arr(ah.conflitos).map(c => ({
                    conflito: c.conflito || '',
                    tipo: c.tipo === 'principal' || c.tipo === 'secundario' ? c.tipo : 'secundario',
                    respondidoPelaEmpresa: c.respondido_pela_empresa,
                    evidencia: c.evidencia || ''
                })),
                leituraConsideracaoFinal: ah.leitura_consideracao_final || ''
            } : null,
            hipotesesCandidatas: arr(parsed.hipoteses_candidatas),
            hipotesesDescartadas: arr(parsed.hipoteses_descartadas).map(h => ({
                hipotese: h.hipotese || h.titulo || '',
                score: num(h.score, null),
                evidenciasFavoraveis: arr(h.evidenciasFavoraveis),
                evidenciasContrarias: arr(h.evidenciasContrarias),
                trechos: arr(h.trechos),
                motivoDescarte: h.motivoDescarte || ''
            })),
            hipoteseSelecionada: parsed.hipotese_selecionada || null,
            justificativa: parsed.justificativa || null,
            trechosSustentam: arr(parsed.trechos_sustentam),
            confianca: num(parsed.confianca, null)
        };
    }
};

const REDACAO = {
    id: 'REDACAO',
    node: NODES.REDACAO,
    etapas: [ETAPAS.E6_RACIOCINIO, ETAPAS.E7_TEXTO],
    promptRef: 'redacao@v2',
    actor: 'llm',
    writes: ['linhaRaciocinio', 'textoFinal'],
    model: (deps) => deps.models?.redacao || DEFAULTS.models.redacao,
    temperature: (deps) => num(deps.temperatures?.redacao, DEFAULTS.temperatures.redacao),
    maxTokens: (deps) => deps.maxTokens?.redacao || DEFAULTS.maxTokens.redacao,
    async buildCtx(state, deps) {
        return {
            hipoteseSelecionada: state.hipoteseSelecionada,
            justificativa: state.justificativa,
            trechosSustentam: state.trechosSustentam,
            analiseDecisao: state.analiseDecisao,
            solicitacao: state.entradasCruas.solicitacao,
            resposta: state.entradasCruas.resposta,
            consideracao: state.entradasCruas.consideracao,
            aprendizadoBloco: deps.buildAprendizado ? await deps.buildAprendizado(state) : ''
        };
    },
    toPartial(parsed) {
        parsed = parsed || {};
        return {
            linhaRaciocinio: parsed.linha_raciocinio || '',
            textoFinal: parsed.texto_final || ''
        };
    }
};

function num(v, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

module.exports = { COMPREENSAO, DECISAO, REDACAO, STEPS: [COMPREENSAO, DECISAO, REDACAO] };
