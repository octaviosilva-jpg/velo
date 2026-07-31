'use strict';

const motorIntegracao = require('../motor-pontuacao/integracao');

/** Reexporta serialização do Motor para a Auditora Técnica. */
function serializarMotor(resultadoMotor, perfil, extras = {}) {
    return motorIntegracao.serializarMotorParaAuditor(resultadoMotor, perfil, extras);
}

module.exports = { serializarMotor };
