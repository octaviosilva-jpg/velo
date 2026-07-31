'use strict';

/** Contrato de chamadas OpenAI (A13) — contagem e responsabilidade imutáveis. */
const CONTRATO = {
    FLUXO_PADRAO: { openaiMax: 2, etapas: ['extrator', 'auditora'], fluxo: 'padrao' },
    FLUXO_COMPLETO: { openaiMax: 4, etapas: ['extrator', 'auditora', 'reformulador', 'extrator'], fluxo: 'completo' },
    COMPARADOR_USA_LLM: false
};

/**
 * Valida se a execução respeitou o contrato de chamadas OpenAI.
 * @returns {{ atendido: boolean, esperado: number, violacoes: string[] }}
 */
function validarContrato({ fluxo, openaiCallCount, chamadas }) {
    const ref = fluxo === 'completo' ? CONTRATO.FLUXO_COMPLETO : CONTRATO.FLUXO_PADRAO;
    const violacoes = [];

    if (openaiCallCount !== ref.openaiMax) {
        violacoes.push(`openaiCallCount=${openaiCallCount}, esperado=${ref.openaiMax}`);
    }

    const etapasObservadas = (chamadas || []).map((c) => c.etapa);
    for (const etapa of ref.etapas) {
        const count = etapasObservadas.filter((e) => e === etapa).length;
        const esperado = ref.etapas.filter((e) => e === etapa).length;
        if (count !== esperado) {
            violacoes.push(`etapa ${etapa}: ${count} chamada(s), esperado ${esperado}`);
        }
    }

    return {
        atendido: violacoes.length === 0,
        esperado: ref.openaiMax,
        violacoes,
        fluxo: ref.fluxo
    };
}

module.exports = { CONTRATO, validarContrato };
