'use strict';

const { SECAO_COMPARACAO_MOTOR } = require('./secoesV8');
const { validarEntradaEtapa, validarSaidaEtapa } = require('./contratosEtapa');
const motorIntegracao = require('../motor-pontuacao/integracao');

const LABELS = motorIntegracao.LABELS || {};

/**
 * Calcula delta determinístico por critério (A8/A9).
 * Critérios inalterados são omitidos.
 */
function calcularDeltaPorCriterio(resultadoMotor1, resultadoMotor2) {
    const d1 = resultadoMotor1?.metadados?.detalhe_criterios || {};
    const d2 = resultadoMotor2?.metadados?.detalhe_criterios || {};
    const delta = {};
    const ids = new Set([...Object.keys(d1), ...Object.keys(d2)]);

    for (const id of ids) {
        const antes = d1[id];
        const depois = d2[id];
        if (!antes || !depois) continue;
        const alterado = antes.estado !== depois.estado || antes.pontos !== depois.pontos;
        if (!alterado) continue;
        delta[id] = {
            alterado: true,
            antes: { estado: antes.estado, pontos: antes.pontos, peso: antes.peso },
            depois: { estado: depois.estado, pontos: depois.pontos, peso: depois.peso },
            deltaPontos: Number((depois.pontos - antes.pontos).toFixed(2))
        };
    }
    return delta;
}

function motivoMudancaDeterministico(criterioId, deltaItem, extracao1, extracao2) {
    const e1 = extracao1?.auditoriaPlana?.estados?.[criterioId];
    const e2 = extracao2?.auditoriaPlana?.estados?.[criterioId];
    if (e1 && e2 && e1 !== e2) {
        return `Estado alterado de "${e1}" para "${e2}" na extração pós-reformulação.`;
    }
    return `Pontuação alterada de ${deltaItem.antes.pontos} para ${deltaItem.depois.pontos} pts (estado: ${deltaItem.antes.estado} → ${deltaItem.depois.estado}).`;
}

/** Monta seção 14 markdown — Comparação Motor #1 × Motor #2 (A8). */
function montarSecaoComparacaoMotor(deltaPorCriterio, chance1, chance2, extracao1, extracao2) {
    const linhas = [
        `## ${SECAO_COMPARACAO_MOTOR}`,
        '',
        `**Resumo global:** Motor #1 = ${chance1}% | Motor #2 = ${chance2}% | Delta = ${chance2 - chance1 >= 0 ? '+' : ''}${(chance2 - chance1).toFixed(1)} p.p.`,
        ''
    ];

    const alterados = Object.entries(deltaPorCriterio || {});
    if (alterados.length === 0) {
        linhas.push('_Nenhum critério alterou estado ou pontuação entre as execuções._');
        return linhas.join('\n');
    }

    for (const [id, item] of alterados) {
        const label = LABELS[id] || id;
        linhas.push(
            `### ${label}`,
            `Motor #1: ${item.antes.estado} (${item.antes.pontos} pts)`,
            `Motor #2: ${item.depois.estado} (${item.depois.pontos} pts)`,
            `Motivo da mudança: ${motivoMudancaDeterministico(id, item, extracao1, extracao2)}`,
            ''
        );
    }
    return linhas.join('\n').trim();
}

/**
 * Comparador determinístico — guardrail A5 + delta + seção 14. Zero LLM.
 */
function comparador(entrada) {
    validarEntradaEtapa('comparador', entrada);

    const {
        resultadoMotor1,
        resultadoMotor2,
        extracao1,
        extracao2,
        respostaOriginal,
        respostaReformulada
    } = entrada;

    const chance1 = resultadoMotor1.chance_final;
    const chance2 = resultadoMotor2.chance_final;
    const reformulacaoAprovada = chance2 >= chance1;
    const respostaSugerida = reformulacaoAprovada ? respostaReformulada : respostaOriginal;
    const avisoRegressao = reformulacaoAprovada
        ? null
        : 'A reformulação reduziu a aderência aos critérios do Motor. A resposta original foi mantida como sugestão.';

    const deltaPorCriterio = calcularDeltaPorCriterio(resultadoMotor1, resultadoMotor2);
    const secao14 = montarSecaoComparacaoMotor(deltaPorCriterio, chance1, chance2, extracao1, extracao2);

    const saida = {
        deltaPorCriterio,
        comparacao: {
            executada: true,
            original: chance1,
            reformulada: chance2,
            delta: Number((chance2 - chance1).toFixed(2)),
            faixaOriginal: resultadoMotor1.faixa_final,
            faixaReformulada: resultadoMotor2.faixa_final,
            reformulacaoAprovada
        },
        secao14,
        reformulacaoAprovada,
        respostaSugerida,
        avisoRegressao
    };

    validarSaidaEtapa('comparador', saida);
    return saida;
}

module.exports = {
    comparador,
    calcularDeltaPorCriterio,
    montarSecaoComparacaoMotor
};
