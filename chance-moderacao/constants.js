'use strict';

const { PRICES, DEFAULTS } = require('../resposta-pipeline/constants');
const { MOTOR_VERSION } = require('../motor-pontuacao/motor');
const { PERFIL_PADRAO } = require('../motor-pontuacao/perfil');

const PROMPT_EXTRATOR_VERSION = 'extrator-v1';
const PROMPT_AUDITORA_VERSION = 'auditora-v1';
const PROMPT_REFORMULADOR_VERSION = 'reformulador-v1';
const MOTOR_COMPONENT_VERSION = `motor-${MOTOR_VERSION}`;
const OPORTUNIDADES_SCHEMA_VERSION = 'oportunidades-v1';
const CHANCE_LIMIAR_REFORMULACAO = 90;

const LINGUAGEM_ESPECULATIVA_PROIBIDA = [
    'provavelmente',
    'possivelmente',
    'estima-se',
    'há boa chance',
    'ha boa chance',
    'é provável',
    'e provavel',
    'acredita-se',
    'acredita se',
    'talvez',
    'pode ser que',
    'tendência a',
    'tendencia a'
];

function resolverModelo(envVars, chaveEnv, fallback) {
    return (envVars && envVars[chaveEnv]) || process.env[chaveEnv] || fallback;
}

module.exports = {
    PRICES,
    DEFAULTS,
    MOTOR_VERSION,
    MOTOR_COMPONENT_VERSION,
    PERFIL_PADRAO,
    PROMPT_EXTRATOR_VERSION,
    PROMPT_AUDITORA_VERSION,
    PROMPT_REFORMULADOR_VERSION,
    OPORTUNIDADES_SCHEMA_VERSION,
    CHANCE_LIMIAR_REFORMULACAO,
    LINGUAGEM_ESPECULATIVA_PROIBIDA,
    resolverModelo
};
