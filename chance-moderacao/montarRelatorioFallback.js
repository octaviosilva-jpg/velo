'use strict';

const motorIntegracao = require('../motor-pontuacao/integracao');
const { LABELS } = motorIntegracao;
const { OPORTUNIDADES_SCHEMA_VERSION } = require('./constants');

const TEXTO_SEM_ACAO = 'Sem ação textual disponível com os dados fornecidos.';
const TEXTO_TETO_REDUZIU = 'N/A — pontuação máxima';
const TEXTO_TETO_AUMENTAR = 'N/A — critério já no teto';

/**
 * Relatório determinístico mínimo quando a Auditora LLM falha validação (graceful degradation).
 * Fallback não inventa oportunidades: cada critério abaixo do teto fica na situação (3).
 */
function montarRelatorioFallbackAuditora({ resultadoMotor, perfilVersao, perfil, aviso }) {
    const blocoOficial = motorIntegracao.montarBlocoOficial(resultadoMotor, perfilVersao);
    const m = resultadoMotor.metadados;
    const abaixoTeto = [];

    const linhasCrit = Object.entries(m.detalhe_criterios || {})
        .map(([id, d]) => {
            const label = LABELS[id] || id;
            const peso = d.peso ?? perfil?.criterios?.[id]?.peso;
            const noTeto = peso != null && d.pontos >= peso;
            if (!noTeto) abaixoTeto.push(label);
            const oQueReduziu = noTeto
                ? TEXTO_TETO_REDUZIU
                : `Pontuação ${d.pontos}/${peso ?? '?'} (estado ${d.estado}) — abaixo do teto.`;
            const comoAumentar = noTeto ? TEXTO_TETO_AUMENTAR : TEXTO_SEM_ACAO;
            return [
                `### ${label}`,
                `Classificação: ${d.estado}`,
                `Pontuação: ${d.pontos}/${peso ?? '?'}`,
                'Justificativa técnica: resultado oficial do Motor (fallback determinístico).',
                `O que reduziu a pontuação: ${oQueReduziu}`,
                `Como aumentar a pontuação: ${comoAumentar}`
            ].join('\n');
        })
        .join('\n\n');

    const secao8 = abaixoTeto.length
        ? abaixoTeto.map((label) => `- ${label}: ${TEXTO_SEM_ACAO}`).join('\n')
        : 'Todos os critérios no teto — nenhuma ação textual.';

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
        abaixoTeto.length
            ? `Critérios abaixo do teto: ${abaixoTeto.join(', ')}.`
            : 'Nenhum critério abaixo do teto.',
        '## Como aumentar a pontuação',
        secao8,
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

/**
 * Fallback sem LLM: não há como apontar ação textual concreta ancorada nos inputs.
 * DTO vazio → runner não executa Reformulador (fluxo padrao / 2 OpenAI).
 */
function montarOportunidadesFallback(_resultadoMotor, _perfil) {
    return { schemaVersion: OPORTUNIDADES_SCHEMA_VERSION, itens: [] };
}

module.exports = {
    montarRelatorioFallbackAuditora,
    montarOportunidadesFallback,
    TEXTO_SEM_ACAO
};
