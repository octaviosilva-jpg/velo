'use strict';

const assert = require('assert');
const {
    parseJustificativaCriterios,
    renderJustificativaCriteriosHtml,
    TEXTO_TETO
} = require('../justificativaParser');

const MULTI = [
    '### Cobertura do fato principal',
    'Classificação: respondido_diretamente',
    'Pontuação: 28/28',
    'Trecho da reclamação: Cliente alega atraso, com detalhes.',
    'Trecho da resposta: Empresa explica o fluxo.',
    'Justificativa técnica: Núcleo enfrentado de forma explícita.',
    'O que reduziu a pontuação: N/A — pontuação máxima',
    'Como aumentar a pontuação: N/A — critério já no teto'
].join('\n');

const FLAT =
    '### Cobertura do fato principal, Classificação: respondido_diretamente, Pontuação: 28/28, ' +
    'Trecho da reclamação: Cliente alega atraso, com detalhes., Trecho da resposta: Empresa explica o fluxo., ' +
    'Justificativa técnica: Núcleo enfrentado, sem lacunas relevantes., ' +
    'O que reduziu a pontuação: N/A — pontuação máxima, Como aumentar a pontuação: N/A — critério já no teto';

const MALFORMED = '### Bloco estranho sem labels conhecidos\nTexto solto **negrito** e ### residual';

function testMultilinha() {
    const itens = parseJustificativaCriterios(MULTI);
    assert.strictEqual(itens.length, 1);
    assert.strictEqual(itens[0].nome, 'Cobertura do fato principal');
    assert.ok(itens[0].campos);
    assert.strictEqual(itens[0].campos.classificacao, 'respondido_diretamente');
    assert.strictEqual(itens[0].campos.pontuacao, '28/28');
    assert.ok(itens[0].campos.trechoReclamacao.includes('atraso, com detalhes'));
    assert.strictEqual(itens[0].campos.comoAumentar, TEXTO_TETO);
    const html = renderJustificativaCriteriosHtml(MULTI);
    assert.ok(html.includes('<strong>Cobertura do fato principal</strong>'));
    assert.ok(html.includes('badge'));
    assert.ok(!/<p class="small mb-0">Cobertura do fato principal,/.test(html));
    console.log('  multilinha — OK');
}

function testFlatNomeECampos() {
    const itens = parseJustificativaCriterios(FLAT);
    assert.strictEqual(itens.length, 1);
    assert.strictEqual(itens[0].nome, 'Cobertura do fato principal');
    assert.ok(itens[0].campos, 'campos não deve ser null no flat');
    assert.strictEqual(itens[0].campos.classificacao, 'respondido_diretamente');
    assert.strictEqual(itens[0].campos.pontuacao, '28/28');
    assert.ok(itens[0].campos.trechoReclamacao.includes('atraso, com detalhes'));
    assert.ok(itens[0].campos.justificativaTecnica.includes('sem lacunas'));
    assert.ok(itens[0].campos.justificativaTecnica.includes(','));
    assert.strictEqual(itens[0].campos.oQueReduziu, TEXTO_TETO);
    assert.strictEqual(itens[0].campos.comoAumentar, TEXTO_TETO);
    console.log('  flat nome + campos — OK');
}

function testFlatRendererSemDup() {
    const html = renderJustificativaCriteriosHtml(FLAT);
    assert.ok(html.includes('<strong>Cobertura do fato principal</strong>'));
    assert.ok(!html.includes('<strong>Cobertura do fato principal, Classificação'));
    assert.ok(html.includes('badge'));
    assert.ok(!/<p class="small mb-0">/.test(html) || !html.includes('<p class="small mb-0">Cobertura do fato principal'));
    // Não deve haver strong e p.small.mb-0 com o mesmo blob completo
    assert.ok(!/<strong>([^<]+)<\/strong>[\s\S]*<p class="small mb-0">\1/.test(html));
    console.log('  flat renderer sem dup strong/p — OK');
}

function testNoveFlat() {
    const nomes = [
        'Cobertura do fato principal',
        'Adequacao da hipotese ao Manual',
        'Correlacao reclamacao x resposta x consideracao final',
        'Evidencia objetiva',
        'Cobertura dos fatos secundarios',
        'Conformidade AENV',
        'Qualidade da fundamentacao',
        'Clareza',
        'Pedidos acessorios'
    ];
    const md = nomes.map((n) =>
        `### ${n}, Classificação: x, Pontuação: 1/1, Justificativa técnica: ok, com vírgula., ` +
        'O que reduziu a pontuação: N/A, Como aumentar a pontuação: N/A'
    ).join('\n');
    const itens = parseJustificativaCriterios(md);
    assert.strictEqual(itens.length, 9);
    assert.ok(itens.every((i) => i.campos != null));
    assert.ok(itens.every((i) => !i.nome.includes('Classificação')));
    assert.ok(itens.every((i) => i.campos.justificativaTecnica && i.campos.justificativaTecnica.includes('vírgula')));
    console.log('  9 flat → 9 objetos estruturados — OK');
}

function testMalformedFallback() {
    const itens = parseJustificativaCriterios(MALFORMED);
    assert.strictEqual(itens.length, 1);
    assert.strictEqual(itens[0].campos, null);
    assert.ok(itens[0].textoBruto);
    const html = renderJustificativaCriteriosHtml(MALFORMED);
    assert.ok(html.includes('<strong>'));
    // nome (primeira linha) !== textoBruto do corpo → body pode existir, mas sem eco idêntico
    const strong = html.match(/<strong>([^<]*)<\/strong>/);
    const p = html.match(/<p class="small mb-0">([^<]*)<\/p>/);
    if (strong && p) {
        assert.notStrictEqual(strong[1], p[1], 'fallback não deve imprimir conteúdo idêntico duas vezes');
    }
    console.log('  malformado fallback — OK');
}

function testFallbackNomeIgualTextoBruto() {
    // Simula objeto que o parser antigo gerava: nome === textoBruto
    const { renderJustificativaCriteriosHtml: render } = require('../justificativaParser');
    // Bloco sem labels e sem newline após título efetivo via ### único flat sem Classificação
    const md = '### Apenas um título sem campos estruturados';
    const itens = parseJustificativaCriterios(md);
    assert.strictEqual(itens[0].campos, null);
    const html = render(md);
    const strong = (html.match(/<strong>([^<]*)<\/strong>/) || [])[1];
    const pMatches = html.match(/<p class="small mb-0">/g);
    // Se nome === textoBruto, não deve haver p.small.mb-0
    if (itens[0].nome === itens[0].textoBruto) {
        assert.ok(!pMatches, 'não repetir strong e p com o mesmo texto');
    }
    assert.ok(strong);
    console.log('  proteção nome===textoBruto — OK');
}

testMultilinha();
testFlatNomeECampos();
testFlatRendererSemDup();
testNoveFlat();
testMalformedFallback();
testFallbackNomeIgualTextoBruto();
console.log('justificativaParserFlat.test.js — OK');
