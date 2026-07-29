'use strict';

const { DEFAULTS } = require('./constants');

/**
 * Converte o WorkflowState final no CONTRATO ATUAL do endpoint /api/generate-moderation,
 * garantindo compatibilidade total com separarBlocosModeracao (server.js) e o frontend.
 *
 * O campo `result` reproduz os 3 blocos com os MESMOS marcadores que a V1, de modo que
 * separarBlocosModeracao consiga reparsear identicamente.
 */
function construirAuditoria(state) {
    const hip = state.hipoteseSelecionada || {};
    const hipTitulo = typeof hip === 'object' ? (hip.titulo || hip.id || '(nao definida)') : hip;
    const linhas = [];
    linhas.push(`Hipotese selecionada: ${hipTitulo}`);
    if (hip && typeof hip === 'object' && hip.comoCitar) linhas.push(`Como citar: ${hip.comoCitar}`);
    if (state.justificativa) linhas.push(`Justificativa: ${state.justificativa}`);
    if (state.confianca != null) linhas.push(`Confianca: ${state.confianca}`);
    if (state.conflitoPrincipal) linhas.push(`Conflito principal: ${state.conflitoPrincipal}`);

    if (Array.isArray(state.hipotesesDescartadas) && state.hipotesesDescartadas.length) {
        linhas.push('');
        linhas.push('Hipoteses descartadas:');
        state.hipotesesDescartadas.forEach((h, i) => {
            linhas.push(`  ${i + 1}. ${h.hipotese} (score: ${h.score != null ? h.score : 'n/a'}) - ${h.motivoDescarte || ''}`);
        });
    }
    return linhas.join('\n');
}

function mapToLegacyContract(state, { confLimiar = DEFAULTS.confLimiar } = {}) {
    const auditoriaHipotese = construirAuditoria(state);
    const linhaRaciocinio = state.linhaRaciocinio || '';
    const textoModeracao = state.textoFinal || '';
    const confiancaBaixa = typeof state.confianca === 'number' ? state.confianca < confLimiar : false;

    const alerta = confiancaBaixa ? '\n\n⚠️ Confianca baixa: revise a aderencia da hipotese antes de enviar.' : '';

    // Reproduz os 3 blocos com os marcadores esperados por separarBlocosModeracao.
    const result = [
        '(1) AUDITORIA DA HIPÓTESE (uso interno — NÃO enviar ao RA)',
        auditoriaHipotese + alerta,
        '',
        '(2) LINHA DE RACIOCÍNIO INTERNA (explicação do processo)',
        linhaRaciocinio,
        '',
        '(3) TEXTO FINAL DE MODERAÇÃO (a ser enviado ao RA)',
        textoModeracao
    ].join('\n');

    return {
        result,
        auditoriaHipotese,
        linhaRaciocinio,
        textoModeracao,
        confiancaBaixa,
        // extras V2 (nao quebram o contrato; o frontend ignora o que nao usa)
        confianca: state.confianca,
        executionId: state.executionId,
        workflowVersion: state.workflowVersion
    };
}

module.exports = { mapToLegacyContract, construirAuditoria };
