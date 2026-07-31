'use strict';

/** Ordem fixa das seções H2 da Auditora Técnica (A10, seções 1–12). */
const SECOES_AUDITORA = [
    'Resultado Oficial do Motor',
    'Resumo Executivo',
    'Justificativa dos Critérios do Motor',
    'Tese Principal',
    'Teses Complementares',
    'Fundamentação Técnica',
    'Pontos que reduziram a pontuação',
    'Como aumentar a pontuação',
    'Auditoria dos fatos',
    'Clareza e Fundamentação',
    'Calibração Histórica',
    'Auditoria de Consistência'
];

const SECAO_REVISAO = 'Revisão Estratégica da Resposta';
const SECAO_COMPARACAO_MOTOR = 'Comparação Motor #1 × Motor #2';

const MARCADOR_OPORTUNIDADES_JSON = '<!-- OPORTUNIDADES_MELHORIA_JSON -->';

function normalizarTitulo(titulo) {
    return String(titulo || '')
        .replace(/^#+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Extrai seções H2 do markdown em objeto ordenado. */
function parseSecoes(markdown) {
    if (!markdown || typeof markdown !== 'string') return {};
    const secoes = {};
    const regex = /^##\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = regex.exec(markdown)) !== null) {
        matches.push({ titulo: m[1].trim(), index: m.index, headerLen: m[0].length });
    }
    for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const inicio = cur.index + cur.headerLen;
        const fim = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
        const conteudo = markdown.slice(inicio, fim).trim();
        secoes[normalizarTitulo(cur.titulo)] = { titulo: cur.titulo, conteudo };
    }
    return secoes;
}

/** Valida presença das seções obrigatórias da Auditora. */
function validarSecoesAuditora(markdown) {
    const parsed = parseSecoes(markdown);
    const faltando = SECOES_AUDITORA.filter(
        (s) => !parsed[normalizarTitulo(s)]
    );
    return { valido: faltando.length === 0, faltando, secoes: parsed };
}

module.exports = {
    SECOES_AUDITORA,
    SECAO_REVISAO,
    SECAO_COMPARACAO_MOTOR,
    MARCADOR_OPORTUNIDADES_JSON,
    parseSecoes,
    validarSecoesAuditora,
    normalizarTitulo
};
