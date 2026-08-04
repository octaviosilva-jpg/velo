'use strict';

const assert = require('assert');
const {
    validarSaidaAuditora,
    normalizarHeadingCriterio,
    contarHeadingCriterio,
    extrairTitulosH3,
    analisarHeadingsJustificativa
} = require('../validarSaidaAuditora');
const { LABELS } = require('../../motor-pontuacao/integracao');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');

const perfil = carregarPerfil('v1');
const IDS = Object.keys(perfil.criterios);
const N = IDS.length;

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

function bloco(label) {
    return [
        `### ${label}`,
        'Classificação: mock',
        'Pontuação: 1/1',
        'Trecho da reclamação: N/A',
        'Trecho da resposta: N/A',
        'Justificativa técnica: ok.',
        'O que reduziu a pontuação: N/A — pontuação máxima',
        'Como aumentar a pontuação: N/A — critério já no teto'
    ].join('\n');
}

function blocosOficiais() {
    return IDS.map((id) => bloco(LABELS[id] || id)).join('\n\n');
}

// U1
function testU1() {
    const r = validarSaidaAuditora(buildRelatorio(blocosOficiais()), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    const a = analisarHeadingsJustificativa(blocosOficiais(), perfil);
    assert.strictEqual(a.totalH3, N);
    assert.strictEqual(a.totalReconhecidos, N);
    console.log('  U1 9 oficiais → válido — OK');
}

// U2
function testU2() {
    const r = validarSaidaAuditora(buildRelatorio(`${blocosOficiais()}\n\n${blocosOficiais()}`), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('duplicado')));
    assert.ok(r.erros.some((e) => e.includes('total de headings H3')));
    console.log('  U2 18 idênticos → inválido — OK');
}

// U3
function testU3() {
    const rBold = validarSaidaAuditora(
        buildRelatorio(`${blocosOficiais()}\n\n${bloco('**Evidencia objetiva**')}`),
        perfil
    );
    assert.strictEqual(rBold.valido, false);
    const rAccent = validarSaidaAuditora(
        buildRelatorio(`${blocosOficiais()}\n\n${bloco('Evidência objetiva')}`),
        perfil
    );
    assert.strictEqual(rAccent.valido, false);
    console.log('  U3 bold/acento → inválido — OK');
}

// U4
function testU4() {
    const just = `${blocosOficiais()}\n\n${bloco('Critério — Evidência objetiva')}`;
    const r = validarSaidaAuditora(buildRelatorio(just), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(
        r.erros.some((e) => e.includes('não oficial') || e.includes('total de headings')),
        r.erros.join('; ')
    );
    console.log('  U4 Critério — + oficial → inválido — OK');
}

// U5
function testU5() {
    const r = validarSaidaAuditora(
        buildRelatorio(`${blocosOficiais()}\n\n### Resumo\nAux.`),
        perfil
    );
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('não oficial') && /Resumo/i.test(e)));
    console.log('  U5 9 + ### Resumo → inválido — OK');
}

// U6
function testU6() {
    const r = validarSaidaAuditora(
        buildRelatorio(`${blocosOficiais()}\n\n### Diagnóstico\nX.`),
        perfil
    );
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('não oficial')));
    console.log('  U6 H3 desconhecido → inválido — OK');
}

// U7
function testU7() {
    const a = analisarHeadingsJustificativa(blocosOficiais(), perfil);
    assert.strictEqual(a.totalH3, N);
    assert.strictEqual(
        normalizarHeadingCriterio('Evidência objetiva'),
        normalizarHeadingCriterio(LABELS.evidencia_objetiva)
    );
    const titulos = extrairTitulosH3(blocosOficiais());
    assert.strictEqual(contarHeadingCriterio(titulos, 'clareza', LABELS.clareza), 1);
    console.log('  U7 totalH3 === N — OK');
}

testU1();
testU2();
testU3();
testU4();
testU5();
testU6();
testU7();
console.log('unicidadeHeadingNormalizada.test.js — OK');
