'use strict';

const { LINGUAGEM_ESPECULATIVA_PROIBIDA } = require('./constants');
const { validarSecoesAuditora, normalizarTitulo } = require('./secoesV8');
const { LABELS } = require('../motor-pontuacao/integracao');

/** Proíbe estimativa de chance; permite citação do valor oficial na seção 1. */
const REGEX_CHANCE_ESTIMADA = /chance\s*(estimada|provável|provavel)/i;
const REGEX_PERCENTUAL_PROIBIDO = /\d+\s*%/g;
const SECAO_RESULTADO_MOTOR = normalizarTitulo('Resultado Oficial do Motor');

function textoForaSecaoResultadoMotor(markdown) {
    const regex = /^##\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = regex.exec(markdown)) !== null) {
        matches.push({ titulo: m[1].trim(), index: m.index });
    }
    const i = matches.findIndex((x) => normalizarTitulo(x.titulo) === SECAO_RESULTADO_MOTOR);
    if (i === -1) return markdown;
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    return markdown.slice(0, start) + markdown.slice(end);
}

/**
 * Normaliza heading ### / label / criterioId para comparação tipograficamente estável.
 */
function normalizarHeadingCriterio(texto) {
    return String(texto || '')
        .replace(/^\[|\]$/g, '')
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/`+/g, '')
        .replace(/^\*+|\*+$/g, '')
        .replace(/^_+|_+$/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
        .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[^\w\s\-x]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extrairTitulosH3(conteudo) {
    const titulos = [];
    const re = /^###\s+(.+)$/gm;
    let m;
    while ((m = re.exec(conteudo)) !== null) {
        titulos.push(String(m[1] || '').trim());
    }
    return titulos;
}

function chavesOficiaisCriterio(criterioId, label) {
    const keys = new Set();
    const idN = normalizarHeadingCriterio(criterioId);
    const labelN = normalizarHeadingCriterio(label);
    if (idN) keys.add(idN);
    if (labelN) keys.add(labelN);
    return keys;
}

function mapaOficialNormParaId(perfil) {
    const mapa = new Map();
    for (const criterioId of Object.keys(perfil?.criterios || {})) {
        const label = LABELS[criterioId] || criterioId;
        for (const k of chavesOficiaisCriterio(criterioId, label)) {
            mapa.set(k, criterioId);
        }
    }
    return mapa;
}

function contarHeadingCriterio(titulosH3, criterioId, label) {
    const oficiais = chavesOficiaisCriterio(criterioId, label);
    let count = 0;
    for (const t of titulosH3) {
        const n = normalizarHeadingCriterio(t);
        if (oficiais.has(n)) count += 1;
    }
    return count;
}

function contarHeadingsReconhecidos(titulosH3, perfil) {
    const mapa = mapaOficialNormParaId(perfil);
    let total = 0;
    for (const t of titulosH3) {
        if (mapa.has(normalizarHeadingCriterio(t))) total += 1;
    }
    return total;
}

/**
 * Metadados de H3 da Justificativa (debug / testes).
 */
function analisarHeadingsJustificativa(conteudoJust, perfil) {
    const titulosH3 = extrairTitulosH3(conteudoJust || '');
    const mapa = mapaOficialNormParaId(perfil);
    const normalizados = titulosH3.map((t) => normalizarHeadingCriterio(t));
    let totalReconhecidos = 0;
    const naoOficiais = [];
    for (let i = 0; i < titulosH3.length; i++) {
        if (mapa.has(normalizados[i])) totalReconhecidos += 1;
        else naoOficiais.push(titulosH3[i]);
    }
    return {
        headingsBrutos: titulosH3,
        headingsNormalizados: normalizados,
        totalH3: titulosH3.length,
        totalReconhecidos,
        naoOficiais
    };
}

/**
 * Valida saída markdown da Auditora (A1/A4/A10 + unicidade estrutural de H3).
 * @returns {{ valido: boolean, erros: string[] }}
 */
function validarSaidaAuditora(markdown, perfil) {
    const erros = [];
    if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
        return { valido: false, erros: ['relatório vazio'] };
    }

    const secoes = validarSecoesAuditora(markdown);
    if (!secoes.valido) {
        erros.push(`seções H2 faltando: ${secoes.faltando.join(', ')}`);
    }

    const textoForaResultado = textoForaSecaoResultadoMotor(markdown);
    const textoLower = textoForaResultado.toLowerCase();
    if (REGEX_CHANCE_ESTIMADA.test(textoForaResultado)) {
        erros.push('contém estimativa especulativa de chance (proibido fora do resultado oficial)');
    }
    const pctForaOficial = textoForaResultado.match(REGEX_PERCENTUAL_PROIBIDO);
    if (pctForaOficial && pctForaOficial.length > 0) {
        erros.push('contém percentual fora da seção Resultado Oficial do Motor (proibido)');
    }
    for (const termo of LINGUAGEM_ESPECULATIVA_PROIBIDA) {
        if (textoLower.includes(termo.toLowerCase())) {
            erros.push(`linguagem especulativa proibida: "${termo}"`);
        }
    }

    if (perfil && perfil.criterios) {
        const secJust = secoes.secoes['justificativa dos critérios do motor'];
        if (secJust) {
            const criteriosIds = Object.keys(perfil.criterios);
            const nEsperado = criteriosIds.length;
            const analise = analisarHeadingsJustificativa(secJust.conteudo, perfil);
            const { titulosH3 } = { titulosH3: analise.headingsBrutos };

            if (analise.totalH3 !== nEsperado) {
                erros.push(
                    `total de headings H3 na justificativa (${analise.totalH3}) ` +
                    `diferente do perfil (${nEsperado})`
                );
            }

            for (const titulo of analise.naoOficiais) {
                erros.push(`heading H3 não oficial na justificativa: ${titulo}`);
            }

            for (const criterioId of criteriosIds) {
                const label = LABELS[criterioId] || criterioId;
                const count = contarHeadingCriterio(titulosH3, criterioId, label);
                if (count === 0) {
                    erros.push(`critério ausente na justificativa: ${label}`);
                } else if (count > 1) {
                    erros.push(`critério duplicado na justificativa (### repetido): ${label}`);
                }
            }

            if (analise.totalReconhecidos !== nEsperado) {
                erros.push(
                    `quantidade de headings de critérios reconhecidos (${analise.totalReconhecidos}) ` +
                    `diferente do perfil (${nEsperado})`
                );
            }
        } else if (!secoes.valido) {
            // já reportado
        } else {
            erros.push('seção Justificativa dos Critérios do Motor vazia ou ilegível');
        }
    }

    return { valido: erros.length === 0, erros };
}

module.exports = {
    validarSaidaAuditora,
    extrairTitulosH3,
    contarHeadingCriterio,
    normalizarHeadingCriterio,
    contarHeadingsReconhecidos,
    analisarHeadingsJustificativa
};
