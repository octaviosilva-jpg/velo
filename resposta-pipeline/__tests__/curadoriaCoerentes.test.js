'use strict';

const assert = require('assert');
const {
    selecionarCoerentesCurados,
    avaliarDisponibilidadeSolucao,
    calcularSimilaridadeSolicitacao
} = require('../shared/curadoriaCoerentes');
const { REGIME_SOLUCAO } = require('../constants');

const dadosFormulario = {
    texto_cliente: 'Meu dinheiro nao caiu na conta do imposto de renda',
    motivo_solicitacao: 'atraso restituicao'
};

const modelos = [
    {
        id: 'c1',
        'Texto Cliente': 'Restituicao do imposto atrasada na conta',
        'Motivo Solicitação': 'atraso restituicao',
        'Resposta Aprovada': 'Resposta aprovada sobre restituicao com orientacao completa.',
        'Tipo Solicitação': 'restituicao'
    },
    {
        id: 'c2',
        'Texto Cliente': 'Problema com seguro de vida totalmente diferente',
        'Motivo Solicitação': 'cancelamento seguro',
        'Resposta Aprovada': 'Resposta sobre seguro.',
        'Tipo Solicitação': 'seguro'
    },
    {
        id: 'c3',
        'Texto Cliente': 'Valor da restituicao nao creditado',
        'Motivo Solicitação': 'atraso restituicao',
        'Resposta Aprovada': 'Outra resposta sobre restituicao.',
        'Tipo Solicitação': 'restituicao'
    }
];

const modelosComResposta = modelos.filter(m => m['Resposta Aprovada']);

const curadoria = selecionarCoerentesCurados(modelosComResposta, dadosFormulario);

assert.ok(curadoria.selecionados.length >= 1, 'deve selecionar ao menos 1 coerente');
assert.ok(curadoria.selecionados.length <= 3, 'max 3 coerentes');
assert.strictEqual(curadoria.selecionados[0].modelo.id, 'c1', 'mais similar primeiro');

const sim = calcularSimilaridadeSolicitacao(
    modelos[0]['Texto Cliente'],
    dadosFormulario.texto_cliente
);
assert.ok(sim > 0, 'similaridade positiva');

assert.strictEqual(avaliarDisponibilidadeSolucao(''), REGIME_SOLUCAO.VAZIA);
assert.strictEqual(avaliarDisponibilidadeSolucao('curto'), REGIME_SOLUCAO.PARCIAL);
assert.strictEqual(
    avaliarDisponibilidadeSolucao('Solucao completa com muitos detalhes e fundamentacao extensa sobre o caso.'),
    REGIME_SOLUCAO.COMPLETA
);

console.log('resposta-pipeline/__tests__/curadoriaCoerentes.test.js — OK');
