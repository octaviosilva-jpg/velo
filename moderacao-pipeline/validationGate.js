'use strict';

const { NODES, DEFAULTS } = require('./constants');

/**
 * Portao de validacao DETERMINISTICO (codigo, sem LLM). Opera sobre o WorkflowState
 * (usando o evidenceMap ja montado). Retorna { ok, target, reasons }.
 *
 * target: no para o back-edge quando !ok (por padrao DECISAO, unico back-edge previsto).
 */
function validate(state, { confLimiar = DEFAULTS.confLimiar } = {}) {
    const reasons = [];

    // 1) Toda alegacao/pedido/acusacao precisa ter cobertura mapeada.
    const totalItens = (state.pedidos || []).length + (state.acusacoes || []).length + (state.fatos || []).length;
    const mapa = Array.isArray(state.evidenceMap) ? state.evidenceMap : [];
    const semCobertura = mapa.filter(m => !m.cobertura || m.cobertura.respondido == null);
    if (totalItens > 0 && mapa.length === 0) {
        reasons.push('cobertura ausente: nenhum item do cliente foi mapeado');
    } else if (semCobertura.length > 0) {
        reasons.push(`cobertura incompleta em ${semCobertura.length} item(ns)`);
    }

    // 2) Deve existir hipotese selecionada com ao menos um trecho de Manual.
    if (!state.hipoteseSelecionada) {
        reasons.push('hipotese nao selecionada');
    } else {
        const temTrechoManual = mapa.some(m => m.trechoManual && (m.trechoManual.comoCitar || m.trechoManual.manual));
        if (!temTrechoManual) reasons.push('hipotese sem trecho/citacao do Manual');
    }

    // 3) Consideracao final deve ter sido classificada quando existir.
    if ((state.entradasCruas.consideracao || '').trim() && !state.consideracaoTipo) {
        reasons.push('consideracao final presente mas nao classificada');
    }

    // 3b) A Decisao deve ter avaliado TODOS os conflitos identificados na Compreensao.
    const conflitosIdentificados = (state.conflitoPrincipal ? 1 : 0) + (Array.isArray(state.conflitosSecundarios) ? state.conflitosSecundarios.length : 0);
    const conflitosAvaliados = state.analiseDecisao && Array.isArray(state.analiseDecisao.conflitos)
        ? state.analiseDecisao.conflitos.length : 0;
    if (conflitosIdentificados > 0 && conflitosAvaliados < conflitosIdentificados) {
        reasons.push(`analise holistica incompleta: ${conflitosAvaliados} de ${conflitosIdentificados} conflitos avaliados`);
    }

    // 4) Confianca deve atingir o limiar (senao pede re-decisao 1x).
    const conf = typeof state.confianca === 'number' ? state.confianca : null;
    if (conf == null) {
        reasons.push('score de confianca ausente');
    } else if (conf < confLimiar) {
        reasons.push(`confianca ${conf} abaixo do limiar ${confLimiar}`);
    }

    return {
        ok: reasons.length === 0,
        target: NODES.DECISAO,
        reasons
    };
}

module.exports = { validate };
