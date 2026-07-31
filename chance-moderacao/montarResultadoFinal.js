'use strict';

const { SECAO_REVISAO } = require('./secoesV8');

/**
 * Concatena seções 1–14 na ordem fixa A10.
 */
function montarResultadoFinal({ relatorio, respostaReformulada, secao14, fluxoCompleto }) {
    const partes = [(relatorio || '').trim()];

    if (fluxoCompleto && respostaReformulada) {
        partes.push(`## ${SECAO_REVISAO}\n\n${respostaReformulada.trim()}`);
    }
    if (fluxoCompleto && secao14) {
        partes.push(secao14.trim());
    }

    return partes.filter(Boolean).join('\n\n');
}

module.exports = { montarResultadoFinal };
