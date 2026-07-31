'use strict';

const assert = require('assert');
const { calcularDeltaPorCriterio, comparador } = require('../comparador');

function motorMock(chance, detalhe) {
    return {
        chance_final: chance,
        faixa_final: 'media_alta',
        metadados: { detalhe_criterios: detalhe }
    };
}

function testDeltaPorCriterio() {
    const m1 = motorMock(72, {
        clareza: { estado: 'boa', pontos: 4, peso: 5 },
        cobertura_fato_principal: { estado: 'respondido_parcialmente', pontos: 12.6, peso: 28 }
    });
    const m2 = motorMock(85, {
        clareza: { estado: 'excelente', pontos: 5, peso: 5 },
        cobertura_fato_principal: { estado: 'respondido_diretamente', pontos: 28, peso: 28 }
    });
    const delta = calcularDeltaPorCriterio(m1, m2);
    assert.strictEqual(Object.keys(delta).length, 2);
    assert.strictEqual(delta.clareza.deltaPontos, 1);
    assert.strictEqual(delta.cobertura_fato_principal.alterado, true);
    console.log('  delta por criterio — OK');
}

function testGuardrailRegressao() {
    const m1 = motorMock(80, { clareza: { estado: 'boa', pontos: 4, peso: 5 } });
    const m2 = motorMock(75, { clareza: { estado: 'media', pontos: 3, peso: 5 } });
    const out = comparador({
        resultadoMotor1: m1,
        resultadoMotor2: m2,
        extracao1: { auditoriaPlana: { estados: { clareza: 'boa' } } },
        extracao2: { auditoriaPlana: { estados: { clareza: 'media' } } },
        respostaOriginal: 'ORIGINAL',
        respostaReformulada: 'REFORMULADA'
    });
    assert.strictEqual(out.reformulacaoAprovada, false);
    assert.strictEqual(out.respostaSugerida, 'ORIGINAL');
    assert.ok(out.avisoRegressao);
    console.log('  guardrail regressao — OK');
}

function testGuardrailAprovada() {
    const m1 = motorMock(70, { clareza: { estado: 'media', pontos: 3, peso: 5 } });
    const m2 = motorMock(82, { clareza: { estado: 'boa', pontos: 4, peso: 5 } });
    const out = comparador({
        resultadoMotor1: m1,
        resultadoMotor2: m2,
        extracao1: {},
        extracao2: {},
        respostaOriginal: 'ORIGINAL',
        respostaReformulada: 'REFORMULADA'
    });
    assert.strictEqual(out.reformulacaoAprovada, true);
    assert.strictEqual(out.respostaSugerida, 'REFORMULADA');
    console.log('  guardrail aprovada — OK');
}

testDeltaPorCriterio();
testGuardrailRegressao();
testGuardrailAprovada();
console.log('chance-moderacao/__tests__/comparador.test.js — OK');
