'use strict';

const assert = require('assert');
const { validarEntradaEtapa } = require('../contratosEtapa');
const { validarContrato, CONTRATO } = require('../contratoChamadasOpenAI');
const { montarVersions } = require('../montarVersions');

function testReformuladorRejeitaSemDto() {
    const r = validarEntradaEtapa('reformulador', { respostaPublica: 'x' });
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('oportunidadesMelhoria')));
    console.log('  reformulador rejeita sem DTO — OK');
}

function testReformuladorAceitaDto() {
    const r = validarEntradaEtapa('reformulador', {
        respostaPublica: 'x',
        oportunidadesMelhoria: { schemaVersion: 'oportunidades-v1', itens: [] }
    });
    assert.strictEqual(r.valido, true);
    console.log('  reformulador aceita DTO — OK');
}

function testContratoFluxoPadrao() {
    const r = validarContrato({
        fluxo: 'padrao',
        openaiCallCount: 2,
        chamadas: [{ etapa: 'extrator' }, { etapa: 'auditora' }]
    });
    assert.strictEqual(r.atendido, true);
    assert.strictEqual(r.esperado, CONTRATO.FLUXO_PADRAO.openaiMax);
    console.log('  contrato fluxo padrao — OK');
}

function testContratoFluxoCompleto() {
    const r = validarContrato({
        fluxo: 'completo',
        openaiCallCount: 4,
        chamadas: [
            { etapa: 'extrator' },
            { etapa: 'auditora' },
            { etapa: 'reformulador' },
            { etapa: 'extrator' }
        ]
    });
    assert.strictEqual(r.atendido, true);
    console.log('  contrato fluxo completo — OK');
}

function testVersionsSkipReformulacao() {
    const v = montarVersions('padrao');
    assert.strictEqual(v.reformulador, null);
    assert.strictEqual(v.auditora, 'auditora-v1');
    console.log('  versions fluxo padrao — OK');
}

testReformuladorRejeitaSemDto();
testReformuladorAceitaDto();
testContratoFluxoPadrao();
testContratoFluxoCompleto();
testVersionsSkipReformulacao();
console.log('chance-moderacao/__tests__/contratosEtapa.test.js — OK');
