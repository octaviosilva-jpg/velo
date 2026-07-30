'use strict';

const {
    SCHEMA_VERSION,
    MODO_OPERACAO,
    FONTE_PRIMARIA,
    FUNCAO_ARGUMENTATIVA,
    PROFUNDIDADE_ESPERADA,
    SEVERIDADE,
    RECOMENDACAO_RETRY,
    FALHA_PREFIXO
} = require('./constants');

/**
 * Contratos v1 — interfaces publicas do pipeline PEV.
 *
 * @typedef {Object} PlanoDeResposta
 * @property {string} schemaVersion
 * @property {string} problemaCentral
 * @property {string} entendimentoSituacional
 * @property {'construir'|'complementar'|'refinar'} modoOperacao
 * @property {'solucao_implementada'|'padrao_coerente'|'misto'} fontePrimaria
 * @property {string[]} fatosAutorizados
 * @property {string[]} fundamentacoesObrigatorias
 * @property {string} [padraoResolucao]
 * @property {CoerenteReferencia[]} coerentesUtilizadas
 * @property {CoerenteDescartada[]} [coerentesDescartadas]
 * @property {string} estrategiaResolucao
 * @property {BlocoArgumentativo[]} planoArgumentativo
 * @property {string[]} exclusoes
 * @property {string[]} [temasRA]
 *
 * @typedef {Object} RascunhoMiolo
 * @property {string} schemaVersion
 * @property {string} conteudo — miolo explicativo resolutivo (sem envelope RA)
 *
 * @typedef {Object} BlocoArgumentativo
 * @property {'resposta_direta'|'esclarecimento_tecnico'|'solucao'|'posicionamento'} funcao
 * @property {string[]} pontosObrigatorios
 * @property {'telegrafica'|'padrao'|'detalhada'} profundidadeEsperada
 *
 * @typedef {Object} CoerenteReferencia
 * @property {string} id
 * @property {number} similaridadePct
 * @property {string} motivo
 * @property {string} tipo
 *
 * @typedef {Object} CoerenteDescartada
 * @property {string} id
 * @property {string} motivo
 *
 * @typedef {Object} FalhaVeredito
 * @property {string} tipo
 * @property {string} descricao
 * @property {string} [trecho]
 * @property {'INFO'|'WARNING'|'ERROR'|'BLOCKER'} severidade
 *
 * @typedef {Object} VereditoBase
 * @property {string} schemaVersion
 * @property {boolean} aprovado
 * @property {FalhaVeredito[]} falhas
 * @property {'executor'|'planner'|'nenhum'} recomendacaoRetry
 *
 * @typedef {VereditoBase} VereditoFactual
 *
 * @typedef {VereditoBase} VereditoEditorial
 *
 * @typedef {Object} InsumosPreparados
 * @property {string} schemaVersion
 * @property {Object} casoNormalizado
 * @property {'vazia'|'parcial'|'completa'} regimeSolucao
 * @property {string} rotaExecucao
 * @property {Object} kitReferencia
 * @property {Object} matrizAutoridade
 */

const ENUMS = {
    modoOperacao: new Set(Object.values(MODO_OPERACAO)),
    fontePrimaria: new Set(Object.values(FONTE_PRIMARIA)),
    funcaoArgumentativa: new Set(Object.values(FUNCAO_ARGUMENTATIVA)),
    profundidadeEsperada: new Set(Object.values(PROFUNDIDADE_ESPERADA)),
    severidade: new Set(Object.values(SEVERIDADE)),
    recomendacaoRetry: new Set(Object.values(RECOMENDACAO_RETRY))
};

function isSchemaVersionValid(obj) {
    return obj && obj.schemaVersion === SCHEMA_VERSION;
}

/** Validacao leve do envelope comum de vereditos. */
function isVereditoEnvelopeValid(veredito) {
    if (!veredito || typeof veredito !== 'object') return false;
    if (veredito.schemaVersion !== SCHEMA_VERSION) return false;
    if (typeof veredito.aprovado !== 'boolean') return false;
    if (!Array.isArray(veredito.falhas)) return false;
    if (!ENUMS.recomendacaoRetry.has(veredito.recomendacaoRetry)) return false;
    return veredito.falhas.every(f =>
        f && typeof f.tipo === 'string' && typeof f.descricao === 'string'
        && ENUMS.severidade.has(f.severidade)
    );
}

function isStringArray(arr) {
    return Array.isArray(arr) && arr.every(x => typeof x === 'string');
}

/** Validacao completa do PlanoDeResposta (Fase 1). */
function isPlanoDeRespostaValid(plano) {
    if (!isSchemaVersionValid(plano)) return false;
    if (!plano.problemaCentral || typeof plano.problemaCentral !== 'string') return false;
    if (!plano.entendimentoSituacional || typeof plano.entendimentoSituacional !== 'string') return false;
    if (!ENUMS.modoOperacao.has(plano.modoOperacao)) return false;
    if (!ENUMS.fontePrimaria.has(plano.fontePrimaria)) return false;
    if (!isStringArray(plano.fatosAutorizados)) return false;
    if (!isStringArray(plano.fundamentacoesObrigatorias)) return false;
    if (!plano.estrategiaResolucao || typeof plano.estrategiaResolucao !== 'string') return false;
    if (!isStringArray(plano.exclusoes)) return false;
    if (!Array.isArray(plano.planoArgumentativo) || plano.planoArgumentativo.length === 0) return false;
    if (!Array.isArray(plano.coerentesUtilizadas)) return false;

    return plano.planoArgumentativo.every(b =>
        b && ENUMS.funcaoArgumentativa.has(b.funcao)
        && ENUMS.profundidadeEsperada.has(b.profundidadeEsperada)
        && isStringArray(b.pontosObrigatorios)
        && b.pontosObrigatorios.length > 0
    );
}

/** Invariante: fatosAutorizados do plano devem estar contidos na matriz de autoridade. */
function assertFatosSubset(plano, matrizAutoridade) {
    if (!plano || !matrizAutoridade) return { ok: false, violacoes: ['plano_ou_matriz_ausente'] };

    const textosMatriz = (matrizAutoridade.fatosAutorizados || []).map(f =>
        typeof f === 'string' ? f : (f?.texto || '')
    ).filter(Boolean);

    const violacoes = [];
    for (const fato of (plano.fatosAutorizados || [])) {
        const encontrado = textosMatriz.some(t =>
            String(t).includes(String(fato)) || String(fato).includes(String(t).substring(0, Math.min(80, t.length)))
        );
        if (!encontrado && textosMatriz.length > 0) {
            violacoes.push(fato);
        }
    }

    return { ok: violacoes.length === 0, violacoes };
}

function isRascunhoMioloValid(rascunho) {
    if (!isSchemaVersionValid(rascunho)) return false;
    return typeof rascunho.conteudo === 'string' && rascunho.conteudo.trim().length > 0;
}

/** Validacao de VereditoFactual (Fase 2) — prefixo factual.* nas falhas. */
function isVereditoFactualValid(veredito) {
    if (!isVereditoEnvelopeValid(veredito)) return false;
    const prefix = FALHA_PREFIXO.FACTUAL;
    for (const f of veredito.falhas) {
        if (!f.tipo.startsWith(prefix)) return false;
    }
    if (veredito.aprovado) {
        return veredito.falhas.length === 0 && veredito.recomendacaoRetry === RECOMENDACAO_RETRY.NENHUM;
    }
    return veredito.falhas.length >= 1 && veredito.recomendacaoRetry !== RECOMENDACAO_RETRY.NENHUM;
}

/** Validacao de VereditoEditorial (Fase 3) — prefixo editorial.*; planner proibido. */
function isVereditoEditorialValid(veredito) {
    if (!isVereditoEnvelopeValid(veredito)) return false;
    if (veredito.recomendacaoRetry === RECOMENDACAO_RETRY.PLANNER) return false;
    const prefix = FALHA_PREFIXO.EDITORIAL;
    for (const f of veredito.falhas) {
        if (!f.tipo.startsWith(prefix)) return false;
    }
    if (veredito.aprovado) {
        return veredito.falhas.length === 0 && veredito.recomendacaoRetry === RECOMENDACAO_RETRY.NENHUM;
    }
    return veredito.falhas.length >= 1
        && (veredito.recomendacaoRetry === RECOMENDACAO_RETRY.EXECUTOR);
}

module.exports = {
    SCHEMA_VERSION,
    ENUMS,
    isSchemaVersionValid,
    isVereditoEnvelopeValid,
    isPlanoDeRespostaValid,
    assertFatosSubset,
    isRascunhoMioloValid,
    isVereditoFactualValid,
    isVereditoEditorialValid
};
