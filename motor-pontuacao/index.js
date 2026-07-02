// Orquestrador do Motor de Pontuacao da Chance de Moderacao.
// Pipeline: contrato (validacao) -> motor (calculo) -> validador (coerencia) -> metadados.
// A IA produz o JSON de estados; o texto da analise NUNCA entra aqui.

const crypto = require('crypto');
const { carregarPerfil, PERFIL_PADRAO } = require('./perfil');
const { validarContrato } = require('./contrato');
const motor = require('./motor');
const validador = require('./validador');

const SCHEMA_AUDITORIA_VERSION = 'auditoria_v1';

function hashEntrada(auditoria, perfilVersao) {
    const base = JSON.stringify({ e: auditoria.estados, g: auditoria.gates, p: perfilVersao });
    return crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
}

/**
 * Calcula a Chance de Moderacao a partir da auditoria estruturada.
 * @param {object} auditoria  { estados: {...}, gates: {...}, ... }
 * @param {object} opts       { perfilVersao }
 * @returns {object} resultado com chance_final, faixa_final, validador e metadados
 */
function analisarChance(auditoria, opts = {}) {
    const perfilVersao = opts.perfilVersao || PERFIL_PADRAO;
    const perfil = carregarPerfil(perfilVersao);

    // 1. Contrato
    const contrato = validarContrato(auditoria, perfil);
    if (!contrato.valido) {
        return {
            sucesso: false,
            erros: contrato.erros,
            contradicoes: contrato.contradicoes,
            metadados: {
                motor_version: motor.MOTOR_VERSION,
                perfil_calibracao_version: perfilVersao,
                schema_version_auditoria: SCHEMA_AUDITORIA_VERSION
            }
        };
    }

    const estados = auditoria.estados;
    const estadosGates = { ...estados, ...auditoria.gates };

    // 2. Motor (determinístico)
    const resultadoMotor = motor.calcular(estadosGates, perfil);

    // 3. Validador Especialista RA (nao recalcula)
    const val = validador.validar(estadosGates, resultadoMotor, perfil);

    // 4. Metadados completos (Ponto 4)
    const metadados = {
        motor_version: motor.MOTOR_VERSION,
        perfil_calibracao_version: perfilVersao,
        schema_version_auditoria: SCHEMA_AUDITORIA_VERSION,
        estados_consumidos: estadosGates,
        score_base: resultadoMotor.metadados.score_base,
        faixa_natural: resultadoMotor.metadados.faixa_natural,
        historico_aplicado: resultadoMotor.metadados.historico_aplicado,
        score_pos_historico: resultadoMotor.metadados.score_pos_historico,
        gates_ativados: resultadoMotor.metadados.gates_ativados,
        faixa_permitida: resultadoMotor.metadados.faixa_permitida,
        compressao_aplicada: resultadoMotor.metadados.compressao_aplicada,
        score_pos_gates: resultadoMotor.metadados.score_pos_gates,
        detalhe_criterios: resultadoMotor.metadados.detalhe_criterios,
        deficiencias_consideradas: Array.isArray(auditoria.deficiencias)
            ? auditoria.deficiencias.map(d => (d && d.id) ? d.id : d)
            : [],
        validador_status: val.status,
        validador_motivo: val.motivo,
        chance_pre_validador: resultadoMotor.chance,
        chance_final: val.chance_final,
        faixa_final: val.faixa_final,
        input_hash: hashEntrada(auditoria, perfilVersao),
        timestamp: new Date().toISOString()
    };

    return {
        sucesso: true,
        chance_final: val.chance_final,
        faixa_final: val.faixa_final,
        validador: { status: val.status, motivo: val.motivo },
        metadados
    };
}

module.exports = { analisarChance, SCHEMA_AUDITORIA_VERSION, MOTOR_VERSION: motor.MOTOR_VERSION };
