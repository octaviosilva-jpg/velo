'use strict';

/** Contratos I/O por etapa (A14). */

const CONTRATOS = {
    extrator: {
        entrada: ['reclamacao', 'respostaPublica'],
        saida: ['extracao', 'fundamentos', 'mapa_reclamacao'],
        proibidoEntrada: ['resultadoMotor', 'relatorio', 'oportunidadesMelhoria']
    },
    auditora: {
        entrada: ['reclamacao', 'respostaPublica', 'solucaoImplementada', 'extracao', 'resultadoMotor', 'motorSerializado'],
        saida: ['relatorio', 'oportunidadesMelhoria'],
        proibidoEntrada: ['mioloReformulado', 'resultadoMotor2']
    },
    reformulador: {
        entrada: ['respostaPublica', 'oportunidadesMelhoria'],
        saida: ['mioloReformulado'],
        proibidoEntrada: ['relatorio', 'resultadoMotor', 'resultadoMotor2', 'deltaPorCriterio']
    },
    comparador: {
        entrada: ['resultadoMotor1', 'resultadoMotor2', 'extracao1', 'extracao2', 'respostaOriginal', 'respostaReformulada'],
        saida: ['deltaPorCriterio', 'comparacao', 'secao14', 'reformulacaoAprovada', 'respostaSugerida', 'avisoRegressao'],
        proibidoEntrada: ['openaiStep', 'apiKey']
    }
};

function validarEntradaEtapa(nome, payload, opts = {}) {
    const contrato = CONTRATOS[nome];
    if (!contrato) return { valido: false, erros: [`etapa desconhecida: ${nome}`] };

    const erros = [];
    const keys = Object.keys(payload || {});

    for (const campo of contrato.entrada) {
        if (!(campo in (payload || {}))) {
            erros.push(`campo obrigatório ausente: ${campo}`);
        }
    }
    for (const proibido of contrato.proibidoEntrada) {
        if (keys.includes(proibido)) {
            erros.push(`campo proibido na entrada: ${proibido}`);
        }
    }

    if (nome === 'reformulador') {
        const dto = payload?.oportunidadesMelhoria;
        if (!dto || typeof dto !== 'object' || !Array.isArray(dto.itens)) {
            erros.push('oportunidadesMelhoria DTO obrigatório (não aceita texto livre)');
        }
    }

    if (opts.strict && erros.length) {
        throw new Error(`[contratosEtapa/${nome}] ${erros.join('; ')}`);
    }

    return { valido: erros.length === 0, erros };
}

function validarSaidaEtapa(nome, payload) {
    const contrato = CONTRATOS[nome];
    if (!contrato) return { valido: false, erros: [`etapa desconhecida: ${nome}`] };
    const erros = [];
    for (const campo of contrato.saida) {
        if (!(campo in (payload || {}))) {
            erros.push(`campo obrigatório ausente na saída: ${campo}`);
        }
    }
    return { valido: erros.length === 0, erros };
}

module.exports = { CONTRATOS, validarEntradaEtapa, validarSaidaEtapa };
