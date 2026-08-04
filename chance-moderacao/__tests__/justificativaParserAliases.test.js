'use strict';

const assert = require('assert');
const {
    parseJustificativaCriterios,
    renderJustificativaCriteriosHtml
} = require('../justificativaParser');

const TECNICA = 'Resposta compreensível sem ambiguidade concreta.';
const REDUZIU = 'Não há causa textual específica individualizada nos fundamentos disponíveis.';
const AUMENTAR = 'Sem ação textual disponível com os dados fornecidos.';

/** Labels abreviados — multilinha */
function testAbbrevMultilinha() {
    const md = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        `Justificativa técnica: ${TECNICA}`,
        `O que reduziu: ${REDUZIU}`,
        `Como aumentar: ${AUMENTAR}`
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos.justificativaTecnica, TECNICA);
    assert.ok(!item.campos.justificativaTecnica.includes('O que reduziu'));
    assert.ok(!item.campos.justificativaTecnica.includes('Como aumentar'));
    assert.strictEqual(item.campos.oQueReduziu, REDUZIU);
    assert.strictEqual(item.campos.comoAumentar, AUMENTAR);

    const html = renderJustificativaCriteriosHtml(md);
    assert.ok(html.includes('Justificativa técnica'));
    assert.ok(html.includes('O que reduziu a pontuação'));
    assert.ok(html.includes('Como aumentar a pontuação'));
    assert.ok(html.includes(TECNICA));
    assert.ok(html.includes(REDUZIU));
    assert.ok(html.includes(AUMENTAR));
    console.log('  abbrev multilinha — OK');
}

/** Labels abreviados — flat */
function testAbbrevFlat() {
    const md =
        '### Clareza, Classificação: boa, Pontuação: 4/5, ' +
        'Trecho da reclamação: "x", Trecho da resposta: "y", ' +
        `Justificativa técnica: ${TECNICA}, ` +
        `O que reduziu: ${REDUZIU}, Como aumentar: ${AUMENTAR}`;
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.nome, 'Clareza');
    assert.strictEqual(item.campos.justificativaTecnica, TECNICA);
    assert.ok(!/O que reduziu|Como aumentar/i.test(item.campos.justificativaTecnica));
    assert.strictEqual(item.campos.oQueReduziu, REDUZIU);
    assert.strictEqual(item.campos.comoAumentar, AUMENTAR);
    console.log('  abbrev flat — OK');
}

/** Labels completos permanecem inalterados */
function testFullLabelsUnchanged() {
    const md = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        `Justificativa técnica: ${TECNICA}`,
        `O que reduziu a pontuação: ${REDUZIU}`,
        `Como aumentar a pontuação: ${AUMENTAR}`
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos.justificativaTecnica, TECNICA);
    assert.strictEqual(item.campos.oQueReduziu, REDUZIU);
    assert.strictEqual(item.campos.comoAumentar, AUMENTAR);

    const ascii = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        `Justificativa técnica: ${TECNICA}`,
        `O que reduziu a pontuacao: ${REDUZIU}`,
        `Como aumentar a pontuacao: ${AUMENTAR}`
    ].join('\n');
    const item2 = parseJustificativaCriterios(ascii)[0];
    assert.strictEqual(item2.campos.oQueReduziu, REDUZIU);
    assert.strictEqual(item2.campos.comoAumentar, AUMENTAR);
    console.log('  full labels inalterados — OK');
}

/** Mock runner style (abbrev) não absorve em técnica */
function testMockRunnerStyle() {
    const md =
        '### Clareza\nClassificação: boa\nPontuação: 0/5\n' +
        'Trecho da reclamação: "trecho"\nTrecho da resposta: "trecho"\n' +
        'Justificativa técnica: mock\nO que reduziu: lacuna\nComo aumentar: ação. Critérios impactados: clareza';
    const c = parseJustificativaCriterios(md)[0].campos;
    assert.strictEqual(c.justificativaTecnica, 'mock');
    assert.strictEqual(c.oQueReduziu, 'lacuna');
    assert.ok(c.comoAumentar.startsWith('ação'));
    console.log('  mock runner style — OK');
}

testAbbrevMultilinha();
testAbbrevFlat();
testFullLabelsUnchanged();
testMockRunnerStyle();
console.log('justificativaParserAliases.test.js — OK');
