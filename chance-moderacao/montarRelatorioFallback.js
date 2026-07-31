'use strict';

const motorIntegracao = require('../motor-pontuacao/integracao');
const { LABELS } = motorIntegracao;
const { OPORTUNIDADES_SCHEMA_VERSION } = require('./constants');

/**
 * Relatório determinístico mínimo quando a Auditora LLM falha validação (graceful degradation).
 */
function montarRelatorioFallbackAuditora({ resultadoMotor, perfilVersao, perfil, aviso }) {
    const blocoOficial = motorIntegracao.montarBlocoOficial(resultadoMotor, perfilVersao);
    const m = resultadoMotor.metadados;
    const linhasCrit = Object.entries(m.detalhe_criterios || {})
        .map(([id, d]) => {
            const label = LABELS[id] || id;
            return `### ${label}\nClassificação: ${d.estado}\nPontuação: ${d.pontos}/${d.peso ?? perfil?.criterios?.[id]?.peso ?? '?'}\nJustificativa técnica: resultado oficial do Motor (fallback determinístico).`;
        })
        .join('\n\n');

    return [
        '## Resultado Oficial do Motor',
        blocoOficial.trim(),
        '## Resumo Executivo',
        `Chance oficial ${resultadoMotor.chance_final}% (faixa ${String(resultadoMotor.faixa_final).replace(/_/g, ' ')}). Relatório qualitativo simplificado — a análise detalhada da IA não passou na validação estrutural.`,
        '## Justificativa dos Critérios do Motor',
        linhasCrit,
        '## Tese Principal',
        'Consulte a composição oficial do Motor acima.',
        '## Teses Complementares',
        'N/A — fallback.',
        '## Fundamentação Técnica',
        'Baseada exclusivamente no Motor de Pontuação oficial.',
        '## Pontos que reduziram a pontuação',
        'Ver critérios com pontuação abaixo do teto na justificativa.',
        '## Como aumentar a pontuação',
        'Endereçar lacunas nos critérios com menor pontuação.',
        '## Auditoria dos fatos',
        'N/A — fallback.',
        '## Clareza e Fundamentação',
        'N/A — fallback.',
        '## Calibração Histórica',
        `Estado: ${m.estados_consumidos?.calibracao_historica ?? 'n/a'}.`,
        '## Auditoria de Consistência',
        aviso || 'Análise qualitativa da Auditora indisponível; exibindo apenas resultado oficial do Motor.'
    ].join('\n\n');
}

function montarOportunidadesFallback(resultadoMotor, perfil) {
    const itens = [];
    const detalhe = resultadoMotor.metadados?.detalhe_criterios || {};
    let idx = 1;
    for (const [criterioId, d] of Object.entries(detalhe)) {
        const peso = d.peso ?? perfil?.criterios?.[criterioId]?.peso;
        if (peso != null && d.pontos >= peso) continue;
        itens.push({
            id: `melhoria-fallback-${idx++}`,
            criterioId,
            criterioLabel: LABELS[criterioId] || criterioId,
            diagnostico: `Pontuação ${d.pontos}/${peso} — estado ${d.estado}.`,
            acao: `Endereçar explicitamente o critério ${LABELS[criterioId] || criterioId} na resposta pública.`,
            criteriosImpactados: [criterioId]
        });
    }
    return { schemaVersion: OPORTUNIDADES_SCHEMA_VERSION, itens };
}

module.exports = { montarRelatorioFallbackAuditora, montarOportunidadesFallback };
