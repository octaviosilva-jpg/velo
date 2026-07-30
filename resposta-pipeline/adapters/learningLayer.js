'use strict';

/**
 * Adapter para camada de aprendizado (Google Sheets / funcoes do server.js injetadas).
 * Fase 0: apenas delegacao; sem logica de negocio propria.
 */
async function carregarAprendizado(deps, tipoSolicitacao) {
    if (typeof deps.carregarDadosAprendizadoCompleto !== 'function') {
        return null;
    }
    try {
        return await deps.carregarDadosAprendizadoCompleto(tipoSolicitacao);
    } catch (err) {
        if (typeof deps.onError === 'function') {
            deps.onError('learningLayer.carregarAprendizado', err);
        }
        return null;
    }
}

function obterConhecimentoProduto(deps, dadosFormulario) {
    if (typeof deps.obterConhecimentoProdutos !== 'function') {
        return '';
    }
    return deps.obterConhecimentoProdutos(dadosFormulario) || '';
}

module.exports = {
    carregarAprendizado,
    obterConhecimentoProduto
};
