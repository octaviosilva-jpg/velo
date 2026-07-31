'use strict';

const assert = require('assert');
const {
    isChanceDebugEnabled,
    metadadosDebugAuditora,
    montarDebugAuditora,
    hashConteudo
} = require('../debug');

function testFlagDebug() {
    assert.strictEqual(isChanceDebugEnabled({}, false), false);
    assert.strictEqual(isChanceDebugEnabled({ CHANCE_DEBUG: 'true' }, false), true);
    assert.strictEqual(isChanceDebugEnabled({}, true), true); // não-produção default
    assert.strictEqual(isChanceDebugEnabled({ NODE_ENV: 'production' }, true), false);
    assert.strictEqual(isChanceDebugEnabled({ NODE_ENV: 'production', CHANCE_DEBUG: 'true' }, true), true);
    console.log('  flag debug — OK');
}

function testMontarEMetadadosSemRawNoWs() {
    const outAud = {
        fallback: true,
        avisoValidacao: 'seções H2 faltando',
        errosPorTentativa: [{ tentativa: 1, erro: 'seções H2 faltando' }],
        tentativas: [{ n: 1, duracaoMs: 100, valida: false }],
        auditoraRaw: '## Relatorio bruto completo com muito texto',
        telemetriaChamada: {
            tentativa: 3,
            duracaoMs: 5000,
            schemaVersion: 'auditora-v1',
            tentativas: [{ n: 1, duracaoMs: 100, valida: false }]
        }
    };

    const debugFull = montarDebugAuditora(outAud);
    assert.strictEqual(debugFull.fallback, true);
    assert.ok(debugFull.auditoraRaw);
    assert.ok(debugFull.auditoraRawHash);
    assert.strictEqual(debugFull.auditoraRawHash, hashConteudo(outAud.auditoraRaw));

    const meta = metadadosDebugAuditora(debugFull);
    assert.strictEqual(meta.fallback, true);
    assert.strictEqual(meta.motivoValidacao, 'seções H2 faltando');
    assert.ok(meta.auditoraRawHash);
    assert.strictEqual(meta.auditoraRaw, undefined);
    assert.ok(!('auditoraRaw' in meta) || meta.auditoraRaw === undefined);

    const serializado = JSON.stringify(meta);
    assert.ok(!serializado.includes('Relatorio bruto'));
    console.log('  metadados WS sem raw — OK');
}

function testDebugDesabilitadoSemRaw() {
    const outAud = {
        fallback: false,
        avisoValidacao: null,
        telemetriaChamada: { tentativa: 1, duracaoMs: 10, schemaVersion: 'auditora-v1' }
    };
    // sem auditoraRaw quando debug off
    assert.strictEqual(outAud.auditoraRaw, undefined);
    console.log('  debug off sem raw — OK');
}

testFlagDebug();
testMontarEMetadadosSemRawNoWs();
testDebugDesabilitadoSemRaw();
console.log('chance-moderacao/__tests__/debugAuditora.test.js — OK');
