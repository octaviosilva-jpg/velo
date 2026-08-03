'use strict';

const assert = require('assert');
const {
    validarSaidaAuditora,
    normalizarHeadingCriterio,
    contarHeadingCriterio,
    extrairTitulosH3
} = require('../validarSaidaAuditora');
const { LABELS } = require('../../motor-pontuacao/integracao');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');

const perfil = carregarPerfil('v1');
const IDS = Object.keys(perfil.criterios);

function buildRelatorio(blocosJust) {
    return [
        '## Resultado Oficial do Motor',
        'Chance oficial: 72%',
        '## Resumo Executivo',
        'Resumo.',
        '## Justificativa dos Critérios do Motor',
        blocosJust,
        '## Tese Principal', 'Tese.',
        '## Teses Complementares', 'N/A.',
        '## Fundamentação Técnica', 'Fund.',
        '## Pontos que reduziram a pontuação', 'Pontos.',
        '## Como aumentar a pontuação', 'Ações.',
        '## Auditoria dos fatos', 'Fatos.',
        '## Clareza e Fundamentação', 'Clareza.',
        '## Calibração Histórica', 'Hist.',
        '## Auditoria de Consistência', 'OK.'
    ].join('\n\n');
}

function bloco(label, extra = '') {
    return `### ${label}\nClassificação: mock\nJustificativa técnica: ok.${extra ? `\n${extra}` : ''}`;
}

function blocosOficiais() {
    return IDS.map((id) => bloco(LABELS[id] || id)).join('\n\n');
}

function testNormalizarEquivalencias() {
    const a = normalizarHeadingCriterio('Evidencia objetiva');
    const b = normalizarHeadingCriterio('**Evidencia objetiva**');
    const c = normalizarHeadingCriterio('Evidência objetiva');
    const d = normalizarHeadingCriterio('### Evidência objetiva'.replace(/^###\s+/, ''));
    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
    assert.strictEqual(a, d);
    assert.strictEqual(a, normalizarHeadingCriterio(LABELS.evidencia_objetiva));
    console.log('  normalizarHeadingCriterio equivalências — OK');
}

function testBoldDupInvalido() {
    const just = `${blocosOficiais()}\n\n${bloco('**Evidencia objetiva**')}`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('duplicado') && /Evidencia/i.test(e)), r.erros.join('; '));
    console.log('  ### Label + ### **Label** → inválido — OK');
}

function testAcentoDupInvalido() {
    const just = `${blocosOficiais()}\n\n${bloco('Evidência objetiva')}`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('duplicado') && /Evidencia/i.test(e)), r.erros.join('; '));
    console.log('  ### Evidencia + ### Evidência → inválido — OK');
}

function testMixMarkdownAcentoInvalido() {
    const just = `${blocosOficiais()}\n\n${bloco('**Evidência objetiva**')}`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('duplicado')), r.erros.join('; '));
    console.log('  markdown + acento → inválido — OK');
}

function testUmPorCriterioValido() {
    const r = validarSaidaAuditora(buildRelatorio(blocosOficiais()), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  exatamente um heading por critério → válido — OK');
}

function testHeadingAuxiliarNaoInvalida() {
    const just = `${blocosOficiais()}\n\n### Resumo auxiliar\nTexto auxiliar.`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    const titulos = extrairTitulosH3(just);
    assert.ok(titulos.length > IDS.length);
    const countEv = contarHeadingCriterio(titulos, 'evidencia_objetiva', LABELS.evidencia_objetiva);
    assert.strictEqual(countEv, 1);
    console.log('  9 oficiais + ### auxiliar → válido — OK');
}

function testAusenteNaoCompensadoPorAuxiliar() {
    const semClareza = IDS.filter((id) => id !== 'clareza')
        .map((id) => bloco(LABELS[id] || id))
        .join('\n\n');
    const just = `${semClareza}\n\n### Resumo auxiliar\nNão é Clareza.`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('ausente') && /Clareza/i.test(e)), r.erros.join('; '));
    assert.ok(!r.erros.some((e) => e.includes('Resumo')), 'auxiliar não gera erro próprio');
    console.log('  8 oficiais + auxiliar → ausente (não compensa) — OK');
}

function testDesconhecidoNaoContaComoOficial() {
    // Só headings desconhecidos — todos oficiais ausentes
    const just = '### Resumo auxiliar\nX.\n\n### Outro bloco\nY.';
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.filter((e) => e.includes('ausente')).length >= IDS.length - 1);
    console.log('  headings desconhecidos não contam como oficiais — OK');
}

testNormalizarEquivalencias();
testBoldDupInvalido();
testAcentoDupInvalido();
testMixMarkdownAcentoInvalido();
testUmPorCriterioValido();
testHeadingAuxiliarNaoInvalida();
testAusenteNaoCompensadoPorAuxiliar();
testDesconhecidoNaoContaComoOficial();
console.log('unicidadeHeadingNormalizada.test.js — OK');
