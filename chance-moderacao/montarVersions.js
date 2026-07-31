'use strict';

const {
    PROMPT_EXTRATOR_VERSION,
    PROMPT_AUDITORA_VERSION,
    PROMPT_REFORMULADOR_VERSION,
    MOTOR_COMPONENT_VERSION,
    PERFIL_PADRAO
} = require('./constants');

/**
 * Agrega versões da execução conforme fluxo (A15).
 * @param {'padrao'|'completo'} fluxo
 */
function montarVersions(fluxo, perfilVersao = PERFIL_PADRAO) {
    const versions = {
        motor: MOTOR_COMPONENT_VERSION,
        perfil: perfilVersao,
        extrator: PROMPT_EXTRATOR_VERSION,
        auditora: PROMPT_AUDITORA_VERSION,
        reformulador: fluxo === 'completo' ? PROMPT_REFORMULADOR_VERSION : null
    };
    return versions;
}

module.exports = { montarVersions };
