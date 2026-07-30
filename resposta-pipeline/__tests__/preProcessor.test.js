'use strict';

const assert = require('assert');
const { buildInsumosPreparados, avaliarDisponibilidadeSolucao } = require('../preProcessor');
const { getPipelineMode, isShadowEnabled } = require('../index');
const { SCHEMA_VERSION, PIPELINE_MODE, REGIME_SOLUCAO } = require('../constants');
const { isSchemaVersionValid } = require('../contracts');

const dadosFormulario = {
    tipo_solicitacao: 'antecipacao',
    motivo_solicitacao: 'atraso restituicao',
    id_reclamacao: 'RA-123',
    solucao_implementada: 'Cliente contatado. Orientado a acompanhar aplicativo.',
    texto_cliente: 'Meu dinheiro nao caiu na conta',
    historico_atendimento: 'Nenhum',
    nome_solicitante: 'Joao'
};

const insumos = buildInsumosPreparados(dadosFormulario, { modelosCoerentes: [], feedbacksRelevantes: [] }, '', {});

assert.strictEqual(insumos.schemaVersion, SCHEMA_VERSION);
assert.ok(isSchemaVersionValid(insumos));
assert.strictEqual(insumos.regimeSolucao, REGIME_SOLUCAO.PARCIAL);
assert.ok(insumos.kitReferencia);
assert.ok(insumos.matrizAutoridade);
assert.strictEqual(insumos.casoNormalizado.id_reclamacao, 'RA-123');

assert.strictEqual(getPipelineMode({}), PIPELINE_MODE.OFF);
assert.strictEqual(getPipelineMode({ RESPOSTA_PIPELINE_MODE: 'shadow' }), PIPELINE_MODE.SHADOW);
assert.strictEqual(isShadowEnabled(PIPELINE_MODE.SHADOW), true);
assert.strictEqual(isShadowEnabled(PIPELINE_MODE.OFF), false);

assert.strictEqual(avaliarDisponibilidadeSolucao(''), REGIME_SOLUCAO.VAZIA);
assert.strictEqual(
    avaliarDisponibilidadeSolucao('Solucao completa com muitos detalhes e fundamentacao extensa sobre o caso.'),
    REGIME_SOLUCAO.COMPLETA
);

console.log('resposta-pipeline/preProcessor.test.js — OK');
