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

function extrairTitulosH3(conteudo) {
    const titulos = [];
    const re = /^###\s+(.+)$/gm;
    let m;
    while ((m = re.exec(conteudo)) !== null) {
        titulos.push(String(m[1] || '').replace(/^\[|\]$/g, '').trim());
    }
    return titulos;
}

function contarHeadingCriterio(titulosH3, criterioId, label) {
    const idNorm = normalizarTitulo(criterioId);
    const labelNorm = normalizarTitulo(label);
    let count = 0;
    for (const t of titulosH3) {
        const n = normalizarTitulo(t);
        if (n === labelNorm || n === idNorm) count += 1;
    }
    return count;
}

/**
 * Valida saída markdown da Auditora Técnica (A1, A4, A10 + unicidade ###).
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
            const conteudoJust = secJust.conteudo;
            const titulosH3 = extrairTitulosH3(conteudoJust);
            for (const criterioId of Object.keys(perfil.criterios)) {
                const label = LABELS[criterioId] || criterioId;
                const count = contarHeadingCriterio(titulosH3, criterioId, label);
                if (count === 0) {
                    erros.push(`critério ausente na justificativa: ${label}`);
                } else if (count > 1) {
                    erros.push(`critério duplicado na justificativa (### repetido): ${label}`);
                }
            }
        } else if (!secoes.valido) {
            // seção justificativa ausente já reportada acima
        } else {
            erros.push('seção Justificativa dos Critérios do Motor vazia ou ilegível');
        }
    }

    return { valido: erros.length === 0, erros };
}

module.exports = {
    validarSaidaAuditora,
    extrairTitulosH3,
    contarHeadingCriterio
};
