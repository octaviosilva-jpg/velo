'use strict';

const assert = require('assert');
const { parseOportunidadesMelhoria, separarRelatorioEOportunidades } = require('../parseOportunidadesMelhoria');

const markdown = `## Resumo Executivo

Texto resumo.

<!-- OPORTUNIDADES_MELHORIA_JSON -->
\`\`\`json
{
  "schemaVersion": "oportunidades-v1",
  "itens": [{
    "id": "melhoria-1",
    "criterioId": "clareza",
    "criterioLabel": "Clareza",
    "diagnostico": "Ambiguidade no trecho X",
    "acao": "Explicitar posição da empresa",
    "criteriosImpactados": ["clareza"]
  }]
}
\`\`\``;

const { relatorio, jsonRaw } = separarRelatorioEOportunidades(markdown);
assert.ok(relatorio.includes('Resumo Executivo'));
assert.ok(jsonRaw.includes('oportunidades-v1'));

const dto = parseOportunidadesMelhoria(markdown);
assert.strictEqual(dto.schemaVersion, 'oportunidades-v1');
assert.strictEqual(dto.itens.length, 1);
assert.strictEqual(dto.itens[0].criterioId, 'clareza');

console.log('chance-moderacao/__tests__/parseOportunidadesMelhoria.test.js — OK');
