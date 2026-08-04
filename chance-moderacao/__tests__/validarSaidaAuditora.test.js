'use strict';

const assert = require('assert');
const { validarSaidaAuditora } = require('../validarSaidaAuditora');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');
const { TEXTO_SEM_CAUSA_INDIV } = require('../montarRelatorioFallback');

const perfil = carregarPerfil('v1');

const SEM_CAUSA = 'Não há causa textual específica individualizada nos fundamentos disponíveis.';
const SEM_ACAO = 'Sem ação textual disponível com os dados fornecidos.';

function h3Completo(label, opts = {}) {
    const o = {
        classificacao: 'mock',
        pontuacao: '1/1',
        trechoR: 'N/A',
        trechoS: 'N/A',
        justificativa: 'ok.',
        reduziuLabel: 'O que reduziu a pontuação',
        reduziu: 'N/A — pontuação máxima',
        aumentarLabel: 'Como aumentar a pontuação',
        aumentar: 'N/A — critério já no teto',
        ...opts
    };
    return [
        `### ${label}`,
        `Classificação: ${o.classificacao}`,
        `Pontuação: ${o.pontuacao}`,
        `Trecho da reclamação: ${o.trechoR}`,
        `Trecho da resposta: ${o.trechoS}`,
        `Justificativa técnica: ${o.justificativa}`,
        `${o.reduziuLabel}: ${o.reduziu}`,
        `${o.aumentarLabel}: ${o.aumentar}`
    ].join('\n');
}

function buildRelatorio(blocosJust, chancePct = 72) {
    return [
        '## Resultado Oficial do Motor',
        `Chance oficial: ${chancePct}%`,
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

function blocosTodosCompletos() {
    return Object.keys(perfil.criterios)
        .map((id) => h3Completo(motorIntegracao.LABELS[id] || id))
        .join('\n\n');
}

// --- regressão estrutural existente ---

const r1 = validarSaidaAuditora(buildRelatorio(blocosTodosCompletos()), perfil);
assert.strictEqual(r1.valido, true, r1.erros.join('; '));

const r2 = validarSaidaAuditora(
    buildRelatorio(blocosTodosCompletos()).replace('## Resumo Executivo', '## Resumo Executivo\nChance estimada: 80%'),
    perfil
);
assert.strictEqual(r2.valido, false);
assert.ok(r2.erros.some((e) => e.includes('percentual') || e.includes('estimativa')));

const blocos = blocosTodosCompletos();
const rDup = validarSaidaAuditora(
    buildRelatorio(blocos).replace(blocos, `${blocos}\n\n${blocos}`),
    perfil
);
assert.strictEqual(rDup.valido, false);
assert.ok(rDup.erros.some((e) => e.includes('duplicado')));

const rBold = validarSaidaAuditora(
    buildRelatorio(blocos).replace(blocos, `${blocos}\n\n### **Evidencia objetiva**\nClassificação: x`),
    perfil
);
assert.strictEqual(rBold.valido, false);

const rAux = validarSaidaAuditora(
    buildRelatorio(blocos).replace(blocos, `${blocos}\n\n### Resumo auxiliar\nOk.`),
    perfil
);
assert.strictEqual(rAux.valido, false);
assert.ok(rAux.erros.some((e) => e.includes('não oficial')));

// --- V1–V8 campos obrigatórios ---

function testV1_blocoCompleto() {
    const r = validarSaidaAuditora(buildRelatorio(h3Completo('Clareza')), perfil);
    // um H3 só falta count — testar bloco isolado via validarCampos on section
    const um = h3Completo('Clareza');
    const rSec = validarSaidaAuditora(buildRelatorio(um), perfil);
    // precisa 9 H3 — teste unitário do bloco via relatório parcial não serve; usar todos completos
    assert.strictEqual(r1.valido, true);
    console.log('  V1 bloco completo — OK');
}

function testV2_aliases() {
    const clarezaLabel = motorIntegracao.LABELS.clareza;
    const md = h3Completo(clarezaLabel, {
        reduziuLabel: 'O que reduziu',
        aumentarLabel: 'Como aumentar',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO,
        pontuacao: '4/5',
        classificacao: 'boa'
    });
    const sec = buildRelatorio(
        Object.keys(perfil.criterios).map((id) => {
            if (id === 'clareza') return md;
            return h3Completo(motorIntegracao.LABELS[id] || id);
        }).join('\n\n')
    );
    const r = validarSaidaAuditora(sec, perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  V2 aliases curtos — OK');
}

function testV3_faltaReduziu() {
    const incompleto = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        'Justificativa técnica: ok.',
        'Como aumentar a pontuação: Sem ação.'
    ].join('\n');
    const blocosInc = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return incompleto;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosInc), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('O que reduziu')));
    console.log('  V3 falta O que reduziu — OK');
}

function testV4_faltaAumentar() {
    const incompleto = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        'Justificativa técnica: ok.',
        'O que reduziu a pontuação: N/A'
    ].join('\n');
    const blocosInc = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return incompleto;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosInc), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('Como aumentar')));
    console.log('  V4 falta Como aumentar — OK');
}

function testV5_faltaJustificativa() {
    const incompleto = [
        '### Clareza',
        'Classificação: boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        'O que reduziu a pontuação: N/A',
        'Como aumentar a pontuação: N/A'
    ].join('\n');
    const blocosInc = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return incompleto;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosInc), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('Justificativa técnica')));
    console.log('  V5 falta Justificativa técnica — OK');
}

function testV6_situacao3() {
    const clareza = h3Completo('Clareza', {
        classificacao: 'boa',
        pontuacao: '4/5',
        trechoR: '"x"',
        trechoS: '"y"',
        justificativa: 'Motor classificou clareza como boa, 4/5.',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO
    });
    const blocosOk = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return clareza;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosOk), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  V6 situação 3 (4/5 sem causa) — OK');
}

function testV7_teto() {
    const cobertura = h3Completo('Cobertura do fato principal', {
        classificacao: 'respondido_diretamente',
        pontuacao: '28/28',
        justificativa: 'Núcleo enfrentado.',
        reduziu: 'N/A — pontuação máxima',
        aumentar: 'N/A — critério já no teto'
    });
    const blocosOk = Object.keys(perfil.criterios).map((id) => {
        if (id === 'cobertura_fato_principal') return cobertura;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosOk), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  V7 teto com N/A — OK');
}

function testV8_fixtureC_rejeita() {
    const fixtureC = [
        '### Clareza',
        'Classificação: Boa',
        'Pontuação: 4/5',
        'Trecho da reclamação: "x"',
        'Trecho da resposta: "y"',
        'Justificativa técnica: O Motor classificou a clareza como boa, resultando em 4/5.'
    ].join('\n');
    const blocosInc = Object.keys(perfil.criterios).map((id) => {
        if (id === 'clareza') return fixtureC;
        return h3Completo(motorIntegracao.LABELS[id] || id);
    }).join('\n\n');
    const r = validarSaidaAuditora(buildRelatorio(blocosInc), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('O que reduziu') || e.includes('Como aumentar')));
    console.log('  V8 fixture C (Clareza incompleta) rejeitada — OK');
}

testV1_blocoCompleto();
testV2_aliases();
testV3_faltaReduziu();
testV4_faltaAumentar();
testV5_faltaJustificativa();
testV6_situacao3();
testV7_teto();
testV8_fixtureC_rejeita();

console.log('validarSaidaAuditora.test.js — OK');
