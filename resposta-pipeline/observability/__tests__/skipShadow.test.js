'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { extractExecutionSnapshot } = require('../executionExtractor');

const shadowState = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pev-fase4-sample.json'), 'utf8'));
shadowState.skipDecisions = [{
    alvo: 'AUDITOR_EDITORIAL',
    executar: false,
    shadowMode: true,
    codigoMotivo: 'skip.editorial.tier1_refinar_completa_sem_checklist',
    regraDecisiva: 'skip.editorial.tier1_refinar_completa_sem_checklist',
    fasePrecedencia: 5
}];
shadowState.vereditoEditorial = {
    schemaVersion: '1.0',
    aprovado: false,
    falhas: [{ tipo: 'editorial.evasao_sac', severidade: 'ERROR' }],
    recomendacaoRetry: 'executor'
};
shadowState.artefatos.push({
    tipo: 'VereditoEditorial',
    node: 'AUDITOR_EDITORIAL',
    payload: shadowState.vereditoEditorial
});
shadowState.telemetria.push({
    node: 'AUDITOR_EDITORIAL', totalTokens: 160, custoEstimado: 0.001, duracaoMs: 900
});

const snap = extractExecutionSnapshot(shadowState);
assert.strictEqual(snap.shadowDivergencias.length, 1);
assert.strictEqual(snap.shadowDivergencias[0].auditorReprovou, true);
assert.strictEqual(snap.editorialExecutado, true);

console.log('observability/__tests__/skipShadow.test.js — OK');
