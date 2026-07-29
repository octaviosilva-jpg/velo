'use strict';

/**
 * EvidenceMap: vincula, de forma deterministica (codigo), cada fato a
 * evidencias -> cobertura da resposta -> hipotese -> trecho do Manual.
 *
 * Montado a partir dos parsed da Chamada 1 (COMPREENSAO) e da Chamada 2 (DECISAO).
 * Best-effort na correlacao textual: nao inventa vinculos, apenas cruza o que existe.
 */

function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Encontra a entrada de cobertura mais provavel para um fato/alegacao. */
function acharCobertura(coberturaResposta, alegacaoTexto) {
    if (!Array.isArray(coberturaResposta) || coberturaResposta.length === 0) return null;
    const alvo = norm(alegacaoTexto);
    let melhor = null;
    let melhorScore = 0;
    for (const c of coberturaResposta) {
        const a = norm(c.alegacao || c.fato || '');
        if (!a) continue;
        // similaridade grosseira por prefixo/inclusao
        let score = 0;
        if (a === alvo) score = 1;
        else if (alvo && (a.includes(alvo) || alvo.includes(a))) score = 0.6;
        if (score > melhorScore) { melhorScore = score; melhor = c; }
    }
    return melhor;
}

/** Verifica se algum trecho de sustentacao referencia o fato. */
function trechoDoFato(trechosSustentam, fatoTexto) {
    if (!Array.isArray(trechosSustentam)) return null;
    const alvo = norm(fatoTexto);
    for (const t of trechosSustentam) {
        const tx = norm(typeof t === 'string' ? t : (t.trecho || ''));
        if (tx && alvo && (tx.includes(alvo) || alvo.includes(tx))) return t;
    }
    return null;
}

/**
 * @param {object} p
 * @param {object} p.compreensao - { fatos[], pedidos[], acusacoes[], coberturaResposta[] }
 * @param {object} p.decisao - { hipoteseSelecionada: { id, titulo, manual, comoCitar }, trechosSustentam[] }
 * @returns {Array} evidenceMap
 */
function buildEvidenceMap({ compreensao = {}, decisao = {} } = {}) {
    const fatos = Array.isArray(compreensao.fatos) ? compreensao.fatos : [];
    const pedidos = Array.isArray(compreensao.pedidos) ? compreensao.pedidos : [];
    const acusacoes = Array.isArray(compreensao.acusacoes) ? compreensao.acusacoes : [];
    const cobertura = Array.isArray(compreensao.coberturaResposta) ? compreensao.coberturaResposta : [];

    // Unifica fatos + pedidos + acusacoes num universo de "itens do cliente".
    const itens = [];
    fatos.forEach((f, i) => itens.push({ tipo: 'fato', origemColecao: 'fatos', idx: i, texto: typeof f === 'string' ? f : (f.texto || f.fato || '') }));
    pedidos.forEach((f, i) => itens.push({ tipo: 'pedido', origemColecao: 'pedidos', idx: i, texto: typeof f === 'string' ? f : (f.texto || '') }));
    acusacoes.forEach((f, i) => itens.push({ tipo: 'acusacao', origemColecao: 'acusacoes', idx: i, texto: typeof f === 'string' ? f : (f.texto || '') }));

    const hip = decisao.hipoteseSelecionada || null;
    const hipTitulo = hip && typeof hip === 'object' ? (hip.titulo || hip.hipotese || hip.id) : hip;
    // Vinculo com o Manual derivado do MESMO campo produzido pela Decisao (hipotese_selecionada).
    const trechoManual = (hip && typeof hip === 'object' && (hip.comoCitar || hip.manual))
        ? { hipoteseId: hip.id || null, manual: hip.manual || null, comoCitar: hip.comoCitar || null }
        : null;

    return itens.map((item, n) => {
        const cov = acharCobertura(cobertura, item.texto);
        const trecho = trechoDoFato(decisao.trechosSustentam, item.texto);
        return {
            factId: `f${n + 1}`,
            fato: item.texto,
            tipo: item.tipo,
            origem: 'reclamacao',
            evidencias: trecho ? [{ trecho: typeof trecho === 'string' ? trecho : (trecho.trecho || ''), origem: (trecho && trecho.origem) || 'reclamacao' }] : [],
            cobertura: cov ? {
                respondido: cov.respondido === true || cov.respondido === 'true',
                tipo: cov.tipo || (cov.respondido ? 'direto' : 'nao'),
                trechoResposta: cov.trechoResposta || ''
            } : { respondido: false, tipo: 'nao', trechoResposta: '' },
            hipoteseVinculada: hipTitulo || null,
            trechoManual: trechoManual
        };
    });
}

module.exports = { buildEvidenceMap };
