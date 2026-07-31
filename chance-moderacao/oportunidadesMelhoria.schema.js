'use strict';

const { OPORTUNIDADES_SCHEMA_VERSION } = require('./constants');

/** Contrato DTO oportunidadesMelhoria (A16). */
const OPORTUNIDADES_MELHORIA_SCHEMA = {
    schemaVersion: OPORTUNIDADES_SCHEMA_VERSION,
    itens: [
        {
            id: 'string',
            criterioId: 'string',
            criterioLabel: 'string',
            diagnostico: 'string',
            acao: 'string',
            criteriosImpactados: ['string']
        }
    ]
};

module.exports = { OPORTUNIDADES_MELHORIA_SCHEMA, OPORTUNIDADES_SCHEMA_VERSION };
