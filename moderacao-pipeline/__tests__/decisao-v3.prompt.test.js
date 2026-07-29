'use strict';

/**
 * Teste offline: decisao@v3 renderiza bloco PONDERACAO consolidado.
 * Executa: node moderacao-pipeline/__tests__/decisao-v3.prompt.test.js
 */

const assert = require('assert');
const promptRegistry = require('../promptRegistry');

const ctx = {
    compreensao: { conflitoPrincipal: 'pix', conflitosSecundarios: ['lgpd'] },
    solicitacao: 'Texto reclamacao',
    resposta: 'Texto resposta',
    consideracao: 'Texto consideracao',
    manualBloco: 'RECORTE MOCK',
    universoHipoteses: 'UNIVERSO MOCK'
};

const rendered = promptRegistry.render('decisao@v3', ctx);

assert.ok(rendered.user.includes('PONDERACAO DE INSUMOS CONCORRENTES'), 'bloco de ponderacao presente');
assert.ok(rendered.user.includes('principal base para a analise dos fatos'), 'redacao consolidada textos crus');
assert.ok(rendered.user.includes('objeto central da reclamacao e explica a controversia'), 'criterio consolidado conflito principal');
assert.ok(!rendered.user.includes('origem da insatisfacao'), 'nao usa redacao antiga origem insatisfacao');
assert.ok(!rendered.user.includes('fonte primaria de evidencia'), 'nao usa redacao antiga fonte evidencia');
assert.strictEqual(rendered.version, 'v3');

const v2 = promptRegistry.render('decisao@v2', ctx);
assert.ok(!v2.user.includes('PONDERACAO DE INSUMOS CONCORRENTES'), 'v2 sem bloco de ponderacao');

console.log('OK [decisao-v3.prompt] bloco consolidado renderizado corretamente');
