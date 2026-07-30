'use strict';

const { REGIME_SOLUCAO, DEFAULTS } = require('../constants');

/**
 * Curadoria mecanica de modelos coerentes — fonte unica de verdade.
 * Usada pelo PreProcessor (PEV) e reformularComConhecimento (monolito).
 */

function normalizarTextoTipo(t) {
    return String(t || '').toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function calcularSimilaridadeSolicitacao(textoA, textoB) {
    const stopwords = new Set([
        'para', 'como', 'sobre', 'apos', 'desde', 'pela', 'pelo', 'pelas', 'pelos', 'com', 'sem',
        'que', 'uma', 'uns', 'das', 'dos', 'nos', 'nas', 'foi', 'ser', 'esta', 'este', 'essa',
        'esse', 'isso', 'caso', 'velotax', 'meu', 'minha', 'mas', 'por', 'dia', 'fiz', 'sou'
    ]);
    const tokenizar = (t) => new Set(
        normalizarTextoTipo(t)
            .split(/\s+/)
            .map(p => p.replace(/[^a-z0-9]/gi, ''))
            .filter(p => p.length >= 4 && !stopwords.has(p))
    );
    const a = tokenizar(textoA);
    const b = tokenizar(textoB);
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

function ordenarModelosPorSimilaridade(modelos, dadosFormulario) {
    const textoAtual = dadosFormulario?.texto_cliente || '';
    const motivoAtual = dadosFormulario?.motivo_solicitacao || dadosFormulario?.motivoSolicitacao || '';
    return (modelos || [])
        .map(m => {
            const textoModelo = m['Texto Cliente'] || m.dadosFormulario?.texto_cliente || '';
            const motivoModelo = m['Motivo Solicitação'] || m.motivo_solicitacao || m.dadosFormulario?.motivo_solicitacao || '';
            const simTexto = calcularSimilaridadeSolicitacao(textoModelo, textoAtual);
            const simMotivo = motivoAtual ? calcularSimilaridadeSolicitacao(motivoModelo, motivoAtual) : 0;
            const similaridade = motivoAtual ? (simTexto * 0.7 + simMotivo * 0.3) : simTexto;
            return { modelo: m, similaridade, simTexto, simMotivo };
        })
        .sort((x, y) => y.similaridade - x.similaridade);
}

function avaliarDisponibilidadeSolucao(solucao) {
    const s = String(solucao || '').trim();
    if (s.length === 0) return REGIME_SOLUCAO.VAZIA;
    const palavras = s.split(/\s+/).filter(p => p.replace(/[^a-zA-Z0-9á-úÁ-Ú]/g, '').length >= 3);
    if (palavras.length < 6 || s.length < 40) return REGIME_SOLUCAO.PARCIAL;
    return REGIME_SOLUCAO.COMPLETA;
}

function selecionarCoerentesCurados(modelosComResposta, dadosFormulario, opts = {}) {
    const pisoContexto = opts.pisoContextoSimilaridade ?? DEFAULTS.pisoContextoSimilaridade;
    const maxSelecionados = opts.coerentesMaxSelecionados ?? DEFAULTS.coerentesMaxSelecionados;
    const orcamentoChars = opts.coerentesOrcamentoChars ?? DEFAULTS.coerentesOrcamentoChars;

    if (!modelosComResposta.length) {
        return {
            selecionados: [],
            descartadosPorDivergencia: 0,
            baixaAderencia: false,
            simTopo: 0,
            totalDisponiveis: 0
        };
    }

    const ranqueados = ordenarModelosPorSimilaridade(modelosComResposta, dadosFormulario);
    const simTopo = ranqueados.length ? ranqueados[0].similaridade : 0;
    const motivoAtual = (dadosFormulario?.motivo_solicitacao || dadosFormulario?.motivoSolicitacao || '').trim();

    const pisoRelativo = simTopo > 0 ? simTopo * 0.4 : 0;
    const limiar = Math.max(pisoContexto, pisoRelativo);
    let consistentes = ranqueados.filter(item => item.similaridade >= limiar);

    if (motivoAtual && consistentes.length > 1) {
        const comMotivoOuTextoForte = consistentes.filter(item =>
            item.simMotivo > 0 || item.simTexto >= Math.max(0.15, simTopo * 0.6));
        if (comMotivoOuTextoForte.length > 0) consistentes = comMotivoOuTextoForte;
    }

    const descartadosPorDivergencia = ranqueados.length - consistentes.length;

    let baixaAderencia = false;
    if (consistentes.length === 0 && ranqueados.length > 0) {
        baixaAderencia = true;
        consistentes = [ranqueados[0]];
    }

    const selecionados = [];
    let totalChars = 0;
    for (const item of consistentes) {
        const respostaItem = item.modelo['Resposta Aprovada'] || item.modelo.respostaAprovada || '';
        if (!respostaItem || respostaItem.trim().length === 0) continue;
        totalChars += respostaItem.length + 400;
        if (selecionados.length >= maxSelecionados && totalChars > orcamentoChars) break;
        selecionados.push(item);
    }

    return {
        selecionados,
        descartadosPorDivergencia,
        baixaAderencia,
        simTopo,
        totalDisponiveis: modelosComResposta.length
    };
}

module.exports = {
    normalizarTextoTipo,
    calcularSimilaridadeSolicitacao,
    ordenarModelosPorSimilaridade,
    avaliarDisponibilidadeSolucao,
    selecionarCoerentesCurados
};
