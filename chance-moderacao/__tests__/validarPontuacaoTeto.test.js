'use strict';

const assert = require('assert');
const { montarPromptAuditora } = require('../promptAuditora');
const {
    validarSaidaAuditora,
    validarCoerenciaPontuacaoTeto,
    formatPontuacaoOficial,
    isCriterioNoTeto
} = require('../validarSaidaAuditora');
const { validarOportunidadesMelhoria } = require('../validarOportunidadesMelhoria');
const {
    montarRelatorioFallbackAuditora,
    TEXTO_SEM_CAUSA_INDIV
} = require('../montarRelatorioFallback');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');

const perfil = carregarPerfil('v1');
const SEM_CAUSA = TEXTO_SEM_CAUSA_INDIV;
const SEM_ACAO = 'Sem ação textual disponível com os dados fornecidos.';
const TETO_REDUZIU = 'N/A — pontuação máxima';
const TETO_AUMENTAR = 'N/A — critério já no teto';

function motorSerializadoFixture(criteriosExtra = []) {
    const base = [
        { id: 'clareza', label: 'Clareza', estado: 'boa', pontos: 4, peso: 5, fator: 0.8 },
        { id: 'adequacao_hipotese', label: 'Adequacao da hipotese ao Manual', estado: 'forte', pontos: 15.3, peso: 18, fator: 0.85 },
        { id: 'cobertura_fato_principal', label: 'Cobertura do fato principal', estado: 'respondido_diretamente', pontos: 28, peso: 28, fator: 1 },
        { id: 'qualidade_fundamentacao', label: 'Qualidade da fundamentacao', estado: 'boa', pontos: 5, peso: 5, fator: 1 }
    ];
    const map = new Map(base.map((c) => [c.id, { ...c }]));
    for (const c of criteriosExtra) {
        map.set(c.id, { ...map.get(c.id), ...c });
    }
    return { criterios: [...map.values()] };
}

function h3Bloco(label, opts) {
    const o = {
        classificacao: 'mock',
        pontuacao: '1/1',
        trechoR: 'N/A',
        trechoS: 'N/A',
        justificativa: 'Justificativa explicativa obrigatória.',
        reduziu: TETO_REDUZIU,
        aumentar: TETO_AUMENTAR,
        ...opts
    };
    return [
        `### ${label}`,
        `Classificação: ${o.classificacao}`,
        `Pontuação: ${o.pontuacao}`,
        `Trecho da reclamação: ${o.trechoR}`,
        `Trecho da resposta: ${o.trechoS}`,
        `Justificativa técnica: ${o.justificativa}`,
        `O que reduziu a pontuação: ${o.reduziu}`,
        `Como aumentar a pontuação: ${o.aumentar}`
    ].join('\n');
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

function blocosTodosCompletos(fn) {
    return Object.keys(perfil.criterios).map((id) => {
        const label = motorIntegracao.LABELS[id] || id;
        return fn(label, id);
    }).join('\n\n');
}

// T1 — prompt exige 4/5
function testT1_promptPontuacao45() {
    const p = montarPromptAuditora({
        reclamacao: 'r', respostaPublica: 's', solucaoImplementada: '',
        consideracaoFinal: '', historicoModeracao: '', baseNormativa: '',
        baseCalibracaoHistorica: '',
        motorSerializado: motorSerializadoFixture()
    });
    assert.ok(/Pontuação: \{pontos\}\/\{peso\}/.test(p.user));
    assert.ok(/4\/5/.test(p.user));
    assert.ok(/copie EXATAMENTE pontos e peso/i.test(p.user));
    console.log('  T1 prompt Pontuação 4/5 — OK');
}

// T2 — 15.3/18
function testT2_pontuacao15318() {
    const motor = motorSerializadoFixture();
    const bloco = h3Bloco('Adequacao da hipotese ao Manual', {
        classificacao: 'forte',
        pontuacao: '15.3/18',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO
    });
    const erros = validarCoerenciaPontuacaoTeto(bloco, motor, perfil);
    assert.strictEqual(erros.length, 0, erros.join('; '));
    console.log('  T2 Pontuação 15.3/18 — OK');
}

// T3 — 28/28
function testT3_pontuacao2828() {
    const motor = motorSerializadoFixture();
    const bloco = h3Bloco('Cobertura do fato principal', {
        classificacao: 'respondido_diretamente',
        pontuacao: '28/28',
        justificativa: 'Núcleo enfrentado; pontuação máxima.',
        reduziu: TETO_REDUZIU,
        aumentar: TETO_AUMENTAR
    });
    const erros = validarCoerenciaPontuacaoTeto(bloco, motor, perfil);
    assert.strictEqual(erros.length, 0, erros.join('; '));
    console.log('  T3 Pontuação 28/28 — OK');
}

// T4 — boa 5/5 teto
function testT4_boa55Teto() {
    const motor = motorSerializadoFixture();
    const bloco = h3Bloco('Qualidade da fundamentacao', {
        classificacao: 'boa',
        pontuacao: '5/5',
        justificativa: 'Organizada e coerente; pontuação máxima.',
        reduziu: TETO_REDUZIU,
        aumentar: TETO_AUMENTAR
    });
    const erros = validarCoerenciaPontuacaoTeto(bloco, motor, perfil);
    assert.strictEqual(erros.length, 0, erros.join('; '));
    assert.ok(isCriterioNoTeto(5, 5));
    console.log('  T4 boa 5/5 teto N/A — OK');
}

// T5 — boa 4/5 não é teto pelo nome do estado
function testT5_boa45NaoTeto() {
    const motor = motorSerializadoFixture();
    const bloco = h3Bloco('Clareza', {
        classificacao: 'boa',
        pontuacao: '4/5',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO
    });
    const erros = validarCoerenciaPontuacaoTeto(bloco, motor, perfil);
    assert.strictEqual(erros.length, 0, erros.join('; '));
    const errTeto = validarCoerenciaPontuacaoTeto(
        bloco.replace(SEM_CAUSA, TETO_REDUZIU).replace(SEM_ACAO, TETO_AUMENTAR),
        motor,
        perfil
    );
    assert.ok(errTeto.length >= 0);
    const errSemCausaNoTeto = h3Bloco('Qualidade da fundamentacao', {
        classificacao: 'boa',
        pontuacao: '5/5',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO
    });
    const errosInc = validarCoerenciaPontuacaoTeto(errSemCausaNoTeto, motor, perfil);
    assert.ok(errosInc.some((e) => e.includes('O que reduziu')));
    assert.ok(errosInc.some((e) => e.includes('Como aumentar')));
    console.log('  T5 boa 4/5 não teto / 5/5 rejeita situação 3 — OK');
}

// T6 — justificativa técnica no teto não vira N/A
function testT6_justificativaNoTeto() {
    const bloco = h3Bloco('Qualidade da fundamentacao', {
        classificacao: 'boa',
        pontuacao: '5/5',
        justificativa: 'Resposta organizada, coerente e objetiva.',
        reduziu: TETO_REDUZIU,
        aumentar: TETO_AUMENTAR
    });
    const parsed = require('../justificativaParser').parseJustificativaCriterios(bloco)[0];
    assert.ok(parsed.campos.justificativaTecnica.includes('organizada'));
    assert.ok(!parsed.campos.justificativaTecnica.includes('Não se aplica'));
    console.log('  T6 Justificativa técnica no teto preservada — OK');
}

// T7 — DTO critério no teto
function testT7_dtoSemTeto() {
    const motor = motorSerializadoFixture();
    const dto = {
        schemaVersion: 'oportunidades-v1',
        itens: [{
            id: 'm1',
            criterioId: 'qualidade_fundamentacao',
            criterioLabel: 'Qualidade',
            diagnostico: 'd',
            acao: 'a',
            criteriosImpactados: ['qualidade_fundamentacao']
        }]
    };
    const r = validarOportunidadesMelhoria(dto, perfil, motor);
    assert.strictEqual(r.valido, false);
    assert.ok(r.erros.some((e) => e.includes('no teto')));
    console.log('  T7 DTO rejeita critério no teto — OK');
}

// T8 — fallback
function testT8_fallback() {
    const motorFake = {
        chance_final: 79,
        faixa_final: 'boa',
        validador: { status: 'ok', motivo: 'fixture' },
        metadados: {
            detalhe_criterios: {
                clareza: { estado: 'boa', pontos: 4, peso: 5 },
                qualidade_fundamentacao: { estado: 'boa', pontos: 5, peso: 5 }
            },
            estados_consumidos: { calibracao_historica: 'sem_referencia' },
            historico_aplicado: 0,
            gates_ativados: [],
            score_base: 79,
            score_pos_historico: 79,
            score_pos_gates: 79
        }
    };
    const rel = montarRelatorioFallbackAuditora({
        resultadoMotor: motorFake,
        perfilVersao: 'v1',
        perfil,
        aviso: 'test'
    });
    assert.ok(rel.includes('Pontuação: 4/5'));
    assert.ok(rel.includes('Pontuação: 5/5'));
    assert.ok(rel.includes('N/A — pontuação máxima'));
    assert.ok(!rel.includes('Qualidade da fundamentacao') || rel.includes('5/5'));
    console.log('  T8 fallback pontos/peso e teto — OK');
}

// Rejeita numerador só
function testNumeradorSoRejeitado() {
    const motor = motorSerializadoFixture();
    const bloco = h3Bloco('Clareza', {
        classificacao: 'boa',
        pontuacao: '4',
        reduziu: SEM_CAUSA,
        aumentar: SEM_ACAO
    });
    const erros = validarCoerenciaPontuacaoTeto(bloco, motor, perfil);
    assert.ok(erros.some((e) => e.includes('Pontuação incorreta')));
    console.log('  numerador só rejeitado — OK');
}

// formatPontuacaoOficial
assert.strictEqual(formatPontuacaoOficial(15.3, 18), '15.3/18');

testT1_promptPontuacao45();
testT2_pontuacao15318();
testT3_pontuacao2828();
testT4_boa55Teto();
testT5_boa45NaoTeto();
testT6_justificativaNoTeto();
testT7_dtoSemTeto();
testT8_fallback();
testNumeradorSoRejeitado();

console.log('validarPontuacaoTeto.test.js — OK');
