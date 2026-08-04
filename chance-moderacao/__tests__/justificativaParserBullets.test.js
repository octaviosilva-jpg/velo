'use strict';

const assert = require('assert');
const { parseJustificativaCriterios } = require('../justificativaParser');
const { validarSaidaAuditora, validarCamposInternosJustificativa } = require('../validarSaidaAuditora');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');

const perfil = carregarPerfil('v1');
const CHAVES = [
    'classificacao', 'pontuacao', 'trechoReclamacao', 'trechoResposta',
    'justificativaTecnica', 'oQueReduziu', 'comoAumentar'
];

function assertSeteCampos(item, msg) {
    assert.ok(item && item.campos, msg || 'campos deve existir');
    for (const k of CHAVES) {
        assert.ok(item.campos[k] != null && String(item.campos[k]).trim(), `campo ${k} ausente`);
    }
}

function buildRelatorio(blocosJust) {
    return [
        '## Resultado Oficial do Motor',
        'Chance oficial: 79%',
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

function h3Canonico(label) {
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

function h3BulletsHifen(label) {
    return [
        `### ${label}`,
        '- Classificação: mock',
        '- Pontuação: 1/1',
        '- Trecho da reclamação: N/A',
        '- Trecho da resposta: N/A',
        '- Justificativa técnica: ok.',
        '- O que reduziu a pontuação: N/A — pontuação máxima',
        '- Como aumentar a pontuação: N/A — critério já no teto'
    ].join('\n');
}

function blocosTodos(fn) {
    return Object.keys(perfil.criterios)
        .map((id) => fn(motorIntegracao.LABELS[id] || id))
        .join('\n\n');
}

// P1 — multilinha canônico sem bullet
function testP1() {
    const md = h3Canonico('Clareza');
    const item = parseJustificativaCriterios(md)[0];
    assertSeteCampos(item, 'P1');
    assert.strictEqual(validarSaidaAuditora(buildRelatorio(blocosTodos(h3Canonico)), perfil).valido, true);
    console.log('  P1 multilinha canônico — OK');
}

// P2 — hífen
function testP2() {
    const item = parseJustificativaCriterios(h3BulletsHifen('Clareza'))[0];
    assertSeteCampos(item, 'P2');
    console.log('  P2 bullets hífen — OK');
}

// P3 — asterisco
function testP3() {
    const md = [
        '### Clareza',
        '* Classificação: mock',
        '* Pontuação: 1/1',
        '* Trecho da reclamação: N/A',
        '* Trecho da resposta: N/A',
        '* Justificativa técnica: ok.',
        '* O que reduziu a pontuação: N/A',
        '* Como aumentar a pontuação: N/A'
    ].join('\n');
    assertSeteCampos(parseJustificativaCriterios(md)[0], 'P3');
    console.log('  P3 bullets asterisco — OK');
}

// P4 — bullet •
function testP4() {
    const md = [
        '### Clareza',
        '• Classificação: mock',
        '• Pontuação: 1/1',
        '• Trecho da reclamação: N/A',
        '• Trecho da resposta: N/A',
        '• Justificativa técnica: ok.',
        '• O que reduziu a pontuação: N/A',
        '• Como aumentar a pontuação: N/A'
    ].join('\n');
    assertSeteCampos(parseJustificativaCriterios(md)[0], 'P4');
    console.log('  P4 bullets • — OK');
}

// P5 — numeração
function testP5() {
    const md = [
        '### Clareza',
        '1. Classificação: mock',
        '2. Pontuação: 1/1',
        '3. Trecho da reclamação: N/A',
        '4. Trecho da resposta: N/A',
        '5. Justificativa técnica: ok.',
        '6. O que reduziu a pontuação: N/A',
        '7. Como aumentar a pontuação: N/A'
    ].join('\n');
    assertSeteCampos(parseJustificativaCriterios(md)[0], 'P5');
    console.log('  P5 numeração — OK');
}

// P6 — mistura de prefixos
function testP6() {
    const md = [
        '### Clareza',
        '- Classificação: mock',
        '* Pontuação: 1/1',
        '• Trecho da reclamação: N/A',
        '1. Trecho da resposta: N/A',
        '2. Justificativa técnica: ok.',
        '3. O que reduziu a pontuação: N/A',
        '4. Como aumentar a pontuação: N/A'
    ].join('\n');
    assertSeteCampos(parseJustificativaCriterios(md)[0], 'P6');
    console.log('  P6 mistura de bullets — OK');
}

// P7 — aliases curtos com bullet
function testP7() {
    const md = [
        '### Clareza',
        '- Classificação: boa',
        '- Pontuação: 4/5',
        '- Trecho da reclamação: "x"',
        '- Trecho da resposta: "y"',
        '- Justificativa técnica: ok.',
        '- O que reduziu: N/A',
        '- Como aumentar: N/A'
    ].join('\n');
    const c = parseJustificativaCriterios(md)[0].campos;
    assert.ok(c.oQueReduziu);
    assert.ok(c.comoAumentar);
    console.log('  P7 aliases curtos com bullet — OK');
}

// P8 — valores com vírgulas
function testP8() {
    const md = [
        '### Clareza',
        '- Classificação: boa, com ressalvas',
        '- Pontuação: 4/5',
        '- Trecho da reclamação: "Cliente alega atraso, com detalhes adicionais."',
        '- Trecho da resposta: "Empresa explica o fluxo, com prazos."',
        '- Justificativa técnica: Texto longo, com vírgulas, e mais detalhes.',
        '- O que reduziu a pontuação: N/A',
        '- Como aumentar a pontuação: N/A'
    ].join('\n');
    const c = parseJustificativaCriterios(md)[0].campos;
    assert.ok(c.classificacao.includes('ressalvas'));
    assert.ok(c.trechoReclamacao.includes('atraso, com detalhes'));
    assert.ok(c.justificativaTecnica.includes('vírgulas'));
    console.log('  P8 valores com vírgulas — OK');
}

// P9 — 9 critérios com bullets → validarSaidaAuditora
function testP9() {
    const r = validarSaidaAuditora(buildRelatorio(blocosTodos(h3BulletsHifen)), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  P9 9 critérios bullets → validarSaidaAuditora true — OK');
}

// P10 — 9 critérios canônicos
function testP10() {
    const r = validarSaidaAuditora(buildRelatorio(blocosTodos(h3Canonico)), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  P10 9 critérios canônicos — OK');
}

// P11 — campo realmente ausente continua inválido
function testP11() {
    const incompleto = [
        '### Clareza',
        '- Classificação: boa',
        '- Pontuação: 4/5',
        '- Trecho da reclamação: "x"',
        '- Trecho da resposta: "y"',
        '- Justificativa técnica: ok.'
    ].join('\n');
    const blocos = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return incompleto;
        return h3BulletsHifen(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocos), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('O que reduziu') || e.includes('Como aumentar')));
    console.log('  P11 campo ausente continua inválido — OK');
}

// P12 — label sem ":" continua inválido
function testP12() {
    const md = [
        '### Clareza',
        '- Classificação',
        'forte',
        '- Pontuação',
        '4/5'
    ].join('\n');
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos, null);
    const erros = validarCamposInternosJustificativa(md);
    assert.ok(erros.some((e) => e.includes('ilegíveis')));
    console.log('  P12 label sem ":" rejeitado — OK');
}

// P13 — formato desconhecido → erro agregado
function testP13() {
    const md = '### Bloco estranho\nTexto solto sem labels conhecidos';
    const item = parseJustificativaCriterios(md)[0];
    assert.strictEqual(item.campos, null);
    const erros = validarCamposInternosJustificativa(md);
    assert.ok(erros.some((e) => e.includes('campos obrigatórios ausentes ou ilegíveis')));
    console.log('  P13 formato desconhecido → erro agregado — OK');
}

testP1();
testP2();
testP3();
testP4();
testP5();
testP6();
testP7();
testP8();
testP9();
testP10();
testP11();
testP12();
testP13();

console.log('justificativaParserBullets.test.js — OK');
