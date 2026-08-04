'use strict';

const assert = require('assert');
const { analisarChance } = require('../index');
const { aplicarV4CompressaoContinua } = require('../validador');
const { carregarPerfil } = require('../perfil');

const perfil = carregarPerfil('v1');
const gatesOk = { prazo: 'elegivel', resposta_generica: 'nao_generica' };

function f(score) {
    return +aplicarV4CompressaoContinua(score, perfil).toFixed(2);
}

function bundleEst(hist = 'neutra', overrides = {}) {
    return {
        estados: {
            cobertura_fato_principal: 'respondido_diretamente',
            adequacao_hipotese: 'forte',
            correlacao: 'alta',
            evidencia_objetiva: 'declaratoria',
            cobertura_secundaria: 'inexistente',
            conformidade_aenv: 'sem_riscos',
            qualidade_fundamentacao: 'boa',
            clareza: 'boa',
            pedidos_acessorios: 'inexistente',
            calibracao_historica: hist,
            ...overrides
        },
        gates: gatesOk
    };
}

let falhas = 0;
function test(nome, fn) {
    try {
        fn();
        console.log('OK  ' + nome);
    } catch (e) {
        falhas++;
        console.log('FALHA ' + nome + ': ' + e.message);
    }
}

// --- Formula SSoT ---
test('formula: 77 permanece 77', () => assert.strictEqual(f(77), 77));
test('formula: 79.7 -> 77.23', () => assert.strictEqual(f(79.7), 77.23));
test('formula: 80 -> 77.26', () => assert.strictEqual(f(80), 77.26));
test('formula: 81.6 -> 77.40', () => assert.strictEqual(f(81.6), 77.4));
test('formula: 85.1 -> 77.70', () => assert.strictEqual(f(85.1), 77.7));
test('formula: 86.1 -> 77.79', () => assert.strictEqual(f(86.1), 77.79));
test('formula: 88.1 -> 77.97', () => assert.strictEqual(f(88.1), 77.97));
test('formula: 90.1 -> 78.14', () => assert.strictEqual(f(90.1), 78.14));
test('formula: 95 -> 78.57', () => assert.strictEqual(f(95), 78.57));
test('formula: 100 -> 79', () => assert.strictEqual(f(100), 79));

// --- Abaixo x0 inalterado ---
test('abaixo x0: 60, 70, 75, 76.9', () => {
    assert.strictEqual(f(60), 60);
    assert.strictEqual(f(70), 70);
    assert.strictEqual(f(75), 75);
    assert.strictEqual(f(76.9), 76.9);
});

// --- Monotonicidade fronteiras ---
test('monotonicidade fronteiras', () => {
    const grid = [76.9, 77, 77.1, 78, 79, 79.5, 79.9, 80, 80.1, 81, 85.1, 86.1, 88.1, 90.1, 95, 100];
    for (let i = 1; i < grid.length; i++) {
        assert.ok(f(grid[i - 1]) <= f(grid[i]), grid[i - 1] + ' <= ' + grid[i]);
    }
});

// --- Teto ---
test('teto <= 79 com V4 ativo', () => {
    for (const s of [80, 85.1, 90.1, 100]) assert.ok(f(s) <= 79);
});

// --- Pipeline bundle ---
test('pipeline bundle padrao 85.1 -> 77.70', () => {
    const r = analisarChance(bundleEst());
    assert.strictEqual(r.chance_final, 77.7);
    assert.strictEqual(r.faixa_final, 'boa');
    assert.strictEqual(r.validador.status, 'ajustado');
    assert.ok(r.validador.motivo.includes('V4'));
});

// --- Historico ---
test('historico crescente com V4 ativo', () => {
    const r0 = analisarChance(bundleEst('neutra'));
    const r3 = analisarChance(bundleEst('positiva_media'));
    const r5 = analisarChance(bundleEst('positiva_alta'));
    assert.ok(r0.chance_final < r3.chance_final);
    assert.ok(r3.chance_final < r5.chance_final);
    assert.strictEqual(r0.chance_final, 77.7);
    assert.strictEqual(r3.chance_final, 77.97);
    assert.strictEqual(r5.chance_final, 78.14);
});

// --- Sem V4 (evidencia suficiente) ---
test('evidencia moderada nao comprime', () => {
    const r = analisarChance(bundleEst('neutra', { evidencia_objetiva: 'objetiva_moderada' }));
    assert.strictEqual(r.chance_final, 89.1);
    assert.strictEqual(r.validador.status, 'coerente');
});

test('evidencia forte nao comprime', () => {
    const r = analisarChance(bundleEst('neutra', { evidencia_objetiva: 'objetiva_forte' }));
    assert.strictEqual(r.chance_final, 93.1);
});

test('evidencia documental excelente clamp 95', () => {
    const r = analisarChance(bundleEst('neutra', {
        evidencia_objetiva: 'documental_conclusiva',
        adequacao_hipotese: 'muito_forte',
        clareza: 'excelente'
    }));
    assert.strictEqual(r.metadados.score_base, 100);
    assert.strictEqual(r.chance_final, 95);
});

// --- Sub-77 inalterado com EO fraca ---
test('sub-77 mediana EO declaratoria inalterada', () => {
    const r = analisarChance({
        estados: {
            cobertura_fato_principal: 'respondido_indiretamente',
            adequacao_hipotese: 'media',
            correlacao: 'media',
            evidencia_objetiva: 'declaratoria',
            cobertura_secundaria: 'parcial',
            conformidade_aenv: 'riscos_leves',
            qualidade_fundamentacao: 'media',
            clareza: 'media',
            pedidos_acessorios: 'inexistente',
            calibracao_historica: 'neutra'
        },
        gates: gatesOk
    });
    assert.strictEqual(r.chance_final, 57.8);
});

console.log(falhas === 0 ? '\nTODOS OS TESTES V4 PASSARAM.' : '\n' + falhas + ' TESTE(S) FALHARAM.');
process.exit(falhas === 0 ? 0 : 1);

