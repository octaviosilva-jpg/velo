'use strict';

const assert = require('assert');
const {
    parseJustificativaCriterios,
    renderJustificativaCriteriosHtml,
    TEXTO_TETO,
    stripMarkdownTokens
} = require('../justificativaParser');

const FIXTURE_OK = `
### Evidência Objetiva
**Classificação:** declaratoria
**Pontuação:** 4.8/16
**Trecho da reclamação:** Cliente alega não receber o reembolso.
**Trecho da resposta:** O pagamento foi realizado em 31/07/2026.
**Justificativa técnica:** Há data, mas sem comprovante verificável.
**O que reduziu a pontuação:** Ausência de documento.
**Como aumentar a pontuação:** N/A — pontuação máxima
`.trim();

const FIXTURE_PARCIAL = `
### Clareza
Classificação: boa
Pontuação: 3/4
Texto solto sem demais labels **com negrito** e ### residual
### Cobertura do Fato Principal
**Classificação:** respondido_diretamente
**Pontuação:** 20/20
**Trecho da reclamação:** Fato X
**Trecho da resposta:** Resposta Y
**Justificativa técnica:** Núcleo enfrentado.
**O que reduziu a pontuação:** N/A — critério já no teto
**Como aumentar a pontuação:** N/A — critério já no teto
`.trim();

function testCasoE() {
    const itens = parseJustificativaCriterios(FIXTURE_OK);
    assert.strictEqual(itens.length, 1);
    assert.strictEqual(itens[0].nome, 'Evidência Objetiva');
    assert.ok(itens[0].campos);
    assert.strictEqual(itens[0].campos.classificacao, 'declaratoria');
    assert.ok(itens[0].campos.trechoResposta.includes('31/07/2026'));
    assert.strictEqual(itens[0].campos.comoAumentar, TEXTO_TETO);

    const html = renderJustificativaCriteriosHtml(FIXTURE_OK);
    assert.ok(!html.includes('###'));
    assert.ok(!html.includes('**'));
    assert.ok(html.includes('Evidência Objetiva'));
    assert.ok(html.includes(TEXTO_TETO));
    assert.ok(html.includes('<blockquote'));
}

function testCasoF() {
    const itens = parseJustificativaCriterios(FIXTURE_PARCIAL);
    assert.ok(itens.length >= 2, 'bloco malformado não deve abortar os demais');
    const clareza = itens.find((i) => i.nome === 'Clareza');
    const cobertura = itens.find((i) => i.nome.includes('Cobertura'));
    assert.ok(clareza, 'critério Clareza presente');
    assert.ok(cobertura && cobertura.campos, 'Cobertura parseada com labels');
    assert.strictEqual(cobertura.campos.oQueReduziu, TEXTO_TETO);

    const html = renderJustificativaCriteriosHtml(FIXTURE_PARCIAL);
    assert.ok(!html.includes('###'));
    assert.ok(!html.includes('**'));
    assert.ok(html.includes('Clareza'));
    assert.ok(html.includes('Cobertura'));
}

function testStrip() {
    assert.strictEqual(stripMarkdownTokens('### **X**'), 'X');
}

testCasoE();
testCasoF();
testStrip();
console.log('justificativaParser.test.js OK');
