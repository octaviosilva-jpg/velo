'use strict';

const assert = require('assert');
const {
    parseJustificativaCriterios,
    isNaTeto,
    TEXTO_TETO
} = require('../justificativaParser');

const TEXTO_CLAREZA_TECNICA =
    "O Motor classificou a clareza como 'boa', resultando em 4/5. Os fundamentos disponíveis sustentam que a resposta permanece compreensível, porém não individualizam uma deficiência textual específica responsável pela diferença em relação à pontuação máxima.";

const TEXTO_SEM_CAUSA =
    'Não há causa textual específica individualizada nos fundamentos disponíveis.';

const TEXTO_SEM_ACAO = 'Sem ação textual disponível com os dados fornecidos.';

const TEXTO_COBERTURA_TECNICA =
    'A empresa respondeu diretamente ao fato principal da reclamação ao informar as opções de pagamento disponíveis.';

/** H1 — Clareza 4/5: "pontuação máxima" na técnica não vira TEXTO_TETO */
function testH1() {
    const md = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        `Justificativa técnica: ${TEXTO_CLAREZA_TECNICA}`,
        `O que reduziu a pontuação: ${TEXTO_SEM_CAUSA}`,
        `Como aumentar a pontuação: ${TEXTO_SEM_ACAO}`
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos.justificativaTecnica, TEXTO_CLAREZA_TECNICA);
    assert.notStrictEqual(item.campos.justificativaTecnica, TEXTO_TETO);
    assert.ok(item.campos.justificativaTecnica.includes('pontuação máxima'));
    console.log('  H1 Clareza 4/5 técnica preservada — OK');
}

/** H2 — palavra portuguesa "na" não é N/A */
function testH2() {
    assert.strictEqual(isNaTeto('texto na resposta'), false);
    assert.strictEqual(isNaTeto('informação presente na reclamação'), false);
    console.log('  H2 isNaTeto("na") === false — OK');
}

/** H3 — N/A real em oQueReduziu humaniza */
function testH3() {
    const md = [
        '### Evidência Objetiva',
        'Classificação: declaratoria',
        'Pontuação: 4.8/16',
        'Justificativa técnica: Há data, mas sem comprovante.',
        'O que reduziu a pontuação: N/A — pontuação máxima',
        'Como aumentar a pontuação: Sem ação textual disponível com os dados fornecidos.'
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos.oQueReduziu, TEXTO_TETO);
    assert.notStrictEqual(item.campos.justificativaTecnica, TEXTO_TETO);
    assert.strictEqual(
        item.campos.comoAumentar,
        'Sem ação textual disponível com os dados fornecidos.'
    );
    console.log('  H3 N/A real humanizado só em reduziu — OK');
}

/** H4 — critério no teto: técnica real; reduziu/aumentar N/A */
function testH4() {
    const md = [
        '### Cobertura do fato principal',
        'Classificação: respondido_diretamente',
        'Pontuação: 28/28',
        'Trecho da reclamação: Cliente alega atraso.',
        'Trecho da resposta: Empresa explica o fluxo.',
        `Justificativa técnica: ${TEXTO_COBERTURA_TECNICA}`,
        'O que reduziu a pontuação: N/A — pontuação máxima',
        'Como aumentar a pontuação: N/A — critério já no teto'
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos.justificativaTecnica, TEXTO_COBERTURA_TECNICA);
    assert.strictEqual(item.campos.oQueReduziu, TEXTO_TETO);
    assert.strictEqual(item.campos.comoAumentar, TEXTO_TETO);
    console.log('  H4 teto: técnica preservada; N/A humanizado — OK');
}

/** H5 — abaixo do teto sem ação: nenhum campo vira TEXTO_TETO */
function testH5() {
    const md = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        `Justificativa técnica: ${TEXTO_CLAREZA_TECNICA}`,
        `O que reduziu a pontuação: ${TEXTO_SEM_CAUSA}`,
        `Como aumentar a pontuação: ${TEXTO_SEM_ACAO}`
    ].join('\n');
    const c = parseJustificativaCriterios(md)[0].campos;
    assert.strictEqual(c.justificativaTecnica, TEXTO_CLAREZA_TECNICA);
    assert.strictEqual(c.oQueReduziu, TEXTO_SEM_CAUSA);
    assert.strictEqual(c.comoAumentar, TEXTO_SEM_ACAO);
    assert.notStrictEqual(c.justificativaTecnica, TEXTO_TETO);
    assert.notStrictEqual(c.oQueReduziu, TEXTO_TETO);
    assert.notStrictEqual(c.comoAumentar, TEXTO_TETO);
    console.log('  H5 abaixo do teto sem TEXTO_TETO — OK');
}

/** H6 — trechos com "na" preservados */
function testH6() {
    const trecho = 'A empresa informou na resposta que o pagamento estava disponível.';
    const md = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        `Trecho da reclamação: ${trecho}`,
        `Trecho da resposta: ${trecho}`,
        'Justificativa técnica: Resposta compreensível.',
        `O que reduziu a pontuação: ${TEXTO_SEM_CAUSA}`,
        `Como aumentar a pontuação: ${TEXTO_SEM_ACAO}`
    ].join('\n');
    const c = parseJustificativaCriterios(md)[0].campos;
    assert.strictEqual(c.trechoReclamacao, trecho);
    assert.strictEqual(c.trechoResposta, trecho);
    assert.ok(c.trechoResposta.includes(' na '));
    assert.notStrictEqual(c.trechoResposta, TEXTO_TETO);
    console.log('  H6 trechos com "na" preservados — OK');
}

testH1();
testH2();
testH3();
testH4();
testH5();
testH6();
console.log('justificativaParserHumanizacao.test.js — OK');
