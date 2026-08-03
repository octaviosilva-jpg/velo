'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validarSaidaAuditora } = require('../validarSaidaAuditora');
const { montarPromptAuditora } = require('../promptAuditora');
const {
    montarOportunidadesFallback,
    montarRelatorioFallbackAuditora,
    TEXTO_SEM_ACAO
} = require('../montarRelatorioFallback');
const { parseJustificativaCriterios } = require('../justificativaParser');
const { LABELS } = require('../../motor-pontuacao/integracao');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');

const perfil = carregarPerfil('v1');
const runnerSrc = fs.readFileSync(path.join(__dirname, '../runner.js'), 'utf8');

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

function blocosUnicos() {
    return Object.keys(perfil.criterios).map((id) => {
        const label = LABELS[id] || id;
        return `### ${label}\nClassificação: mock\nJustificativa técnica: ok.`;
    }).join('\n\n');
}

function testDup1_rejeitaDuplicata() {
    const duplicado = `${blocosUnicos()}\n\n${blocosUnicos()}`;
    const r = validarSaidaAuditora(buildRelatorio(duplicado), perfil);
    assert.strictEqual(r.valido, false);
    assert.ok(
        r.erros.some((e) => e.includes('duplicado') && e.includes('###')),
        `erros: ${r.erros.join('; ')}`
    );
    console.log('  Dup-1 rejeita ### duplicado — OK');
}

function testDup2_aceitaUnicoEParser() {
    const unicos = blocosUnicos();
    const r = validarSaidaAuditora(buildRelatorio(unicos), perfil);
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    const nCriterios = Object.keys(perfil.criterios).length;
    const cards = parseJustificativaCriterios(unicos);
    assert.strictEqual(cards.length, nCriterios);
    console.log('  Dup-2 um ### por critério + parser — OK');
}

function testOpp1_promptSituacoes() {
    const p = montarPromptAuditora({
        reclamacao: 'r',
        respostaPublica: 'resp',
        solucaoImplementada: 'sol',
        consideracaoFinal: '',
        historicoModeracao: '',
        baseNormativa: '',
        baseCalibracaoHistorica: '',
        motorSerializado: { chance_final: 50 }
    });
    const text = `${p.system}\n${p.user}`;
    assert.ok(/Três situações|três situações|\(1\) Critério no teto/i.test(text));
    assert.ok(/Sem ação textual disponível com os dados fornecidos/i.test(text));
    assert.ok(/info concreta nos inputs|informação concreta nos inputs/i.test(text));
    assert.ok(/qual informação existente|informação existente/i.test(text));
    assert.ok(/como melhora o critério/i.test(text));
    assert.ok(/nada novo a presumir|nenhuma informação nova/i.test(text));
    assert.ok(/Exatamente UM H3|EXATAMENTE UM/i.test(text));
    assert.ok(/itens": \[\]|"itens": \[\]/i.test(text));
    assert.ok(/NÃO implica automaticamente/i.test(text));
    assert.ok(/trecho\/característica|trechos_utilizados/i.test(text));
    assert.ok(/parafrasear|NÃO apenas parafrasear/i.test(text));
    assert.ok(/ÚNICOS headings H3|PROIBIDO: ### Critério —/i.test(text));
    console.log('  Opp-1 prompt situações e condições DTO — OK');
}

function motorFakeAbaixoTeto() {
    return {
        chance_final: 40,
        faixa_final: 'baixa',
        validador: { status: 'ok', motivo: 'fixture' },
        metadados: {
            motor_versao: 'test',
            detalhe_criterios: {
                evidencia_objetiva: { estado: 'declaratoria', pontos: 4.8, peso: 16 },
                clareza: { estado: 'media', pontos: 2, peso: 4 },
                cobertura_fato_principal: { estado: 'respondido_diretamente', pontos: 20, peso: 20 }
            },
            estados_consumidos: { calibracao_historica: 'sem_referencia' },
            historico_aplicado: 0,
            gates_ativados: [],
            score_base: 40,
            score_pos_historico: 40,
            score_pos_gates: 40
        }
    };
}

function testOpp2_fallbackDtoVazio() {
    const ops = montarOportunidadesFallback(motorFakeAbaixoTeto(), perfil);
    assert.ok(Array.isArray(ops.itens));
    assert.strictEqual(ops.itens.length, 0, 'fallback não gera oportunidades genéricas');
    console.log('  Opp-2 fallback itens [] — OK');
}

function testOpp3_fallbackMarkdownSemAcao() {
    const rel = montarRelatorioFallbackAuditora({
        resultadoMotor: motorFakeAbaixoTeto(),
        perfilVersao: 'v1',
        perfil,
        aviso: 'test'
    });
    assert.ok(rel.includes(TEXTO_SEM_ACAO));
    assert.ok(rel.includes('Evidencia objetiva') || rel.includes('Evidência objetiva'));
    assert.ok(rel.includes('N/A — critério já no teto') || rel.includes('N/A — pontuação máxima'));
    // Unicidade: um ### por critério presente no detalhe
    const just = rel.split('## Justificativa dos Critérios do Motor')[1].split('## Tese Principal')[0];
    const r = validarSaidaAuditora(
        buildRelatorio(
            Object.keys(perfil.criterios).map((id) => {
                const label = LABELS[id] || id;
                // Completa critérios ausentes no motorFake para validação de presença
                if (just.includes(`### ${label}`)) {
                    return just.match(new RegExp(`### ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n### |$)`))?.[0]
                        || `### ${label}\nClassificação: x\nJustificativa técnica: ok.`;
                }
                return `### ${label}\nClassificação: x\nJustificativa técnica: ok.`;
            }).join('\n\n')
        ),
        perfil
    );
    assert.strictEqual(r.valido, true, r.erros.join('; '));
    console.log('  Opp-3 fallback markdown Sem ação textual — OK');
}

function testDtoVazioImpedeReformulador() {
    assert.ok(
        /fluxoCompleto\s*&&\s*oportunidadesMelhoria\?\.itens\?\.length\s*>\s*0/.test(runnerSrc),
        'runner só chama reformulador com itens.length > 0'
    );
    assert.ok(
        /fluxoFinal\s*=\s*respostaReformulada\s*\?\s*'completo'\s*:\s*'padrao'/.test(runnerSrc),
        'DTO vazio → fluxoFinal padrao'
    );
    console.log('  DTO vazio impede Reformulador / fluxo padrao — OK');
}

function testExemplosSituacoesNoPrompt() {
    const p = montarPromptAuditora({
        reclamacao: 'Cliente questiona Y',
        respostaPublica: 'Empresa menciona X',
        solucaoImplementada: '',
        consideracaoFinal: '',
        historicoModeracao: '',
        baseNormativa: '',
        baseCalibracaoHistorica: '',
        motorSerializado: {}
    });
    // Situação 2 (acionável) e 3 (sem ação) documentadas no prompt
    assert.ok(p.user.includes('Sem ação textual disponível com os dados fornecidos'));
    assert.ok(/situação \(2\)|itens\[\] SOMENTE situação/i.test(p.user));
    assert.ok(/limitação evidencial|ausência de causa individualizada/i.test(p.user));
    assert.ok(/trechos_utilizados|fundamentos\[criterioId\]/i.test(p.user));
    assert.ok(/NÃO significa erro do Motor/i.test(p.user));
    console.log('  Exemplos situação 2 e 3 + âncora no prompt — OK');
}

testDup1_rejeitaDuplicata();
testDup2_aceitaUnicoEParser();
testOpp1_promptSituacoes();
testOpp2_fallbackDtoVazio();
testOpp3_fallbackMarkdownSemAcao();
testDtoVazioImpedeReformulador();
testExemplosSituacoesNoPrompt();
console.log('justificativaUnicidadeOportunidades.test.js — OK');
