// Validacao do contrato JSON de auditoria (insumo unico do Motor).
// Garante: presenca de todos os criterios/gates, valores dentro da whitelist de enums
// do perfil, e ausencia de contradicoes estruturais. NAO faz parsing de texto.

/** Lista os campos obrigatorios (criterios + historico + gates) a partir do perfil. */
function camposObrigatorios(perfil) {
    const criterios = Object.keys(perfil.criterios);
    const gates = Object.keys(perfil.gates_independentes);
    return { criterios, gates, historico: 'calibracao_historica' };
}

/** Valida os estados contra a whitelist do perfil. Retorna { valido, erros, contradicoes }. */
function validarContrato(auditoria, perfil) {
    const erros = [];
    const contradicoes = [];

    if (!auditoria || typeof auditoria !== 'object') {
        return { valido: false, erros: ['Auditoria ausente ou nao e um objeto.'], contradicoes };
    }

    const estados = auditoria.estados;
    const gates = auditoria.gates;

    if (!estados || typeof estados !== 'object') {
        return { valido: false, erros: ['Campo "estados" ausente ou invalido.'], contradicoes };
    }
    if (!gates || typeof gates !== 'object') {
        return { valido: false, erros: ['Campo "gates" ausente ou invalido.'], contradicoes };
    }

    const { criterios, gates: gatesNomes, historico } = camposObrigatorios(perfil);

    // Criterios pontuados
    for (const criterio of criterios) {
        const valor = estados[criterio];
        if (valor === undefined || valor === null) {
            erros.push(`Estado obrigatorio ausente: "${criterio}".`);
            continue;
        }
        const permitidos = Object.keys(perfil.criterios[criterio].estados);
        if (!permitidos.includes(valor)) {
            erros.push(`Estado invalido para "${criterio}": "${valor}". Permitidos: ${permitidos.join(', ')}.`);
        }
    }

    // Calibracao historica
    const valorHist = estados[historico];
    if (valorHist === undefined || valorHist === null) {
        erros.push(`Estado obrigatorio ausente: "${historico}".`);
    } else if (!Object.keys(perfil.calibracao_historica.ajustes).includes(valorHist)) {
        erros.push(`Estado invalido para "${historico}": "${valorHist}".`);
    }

    // Gates independentes
    for (const gate of gatesNomes) {
        const valor = gates[gate];
        const permitidos = perfil.gates_independentes[gate].estados_validos;
        if (valor === undefined || valor === null) {
            erros.push(`Gate obrigatorio ausente: "${gate}".`);
        } else if (!permitidos.includes(valor)) {
            erros.push(`Estado invalido para o gate "${gate}": "${valor}". Permitidos: ${permitidos.join(', ')}.`);
        }
    }

    // Contradicoes estruturais (so avaliadas se os estados existirem)
    if (estados.cobertura_fato_principal === 'nao_respondido'
        && estados.evidencia_objetiva === 'documental_conclusiva') {
        contradicoes.push('Fato principal "nao_respondido" com evidencia "documental_conclusiva": estados logicamente incompativeis sobre o mesmo fato.');
    }
    if (estados.cobertura_fato_principal === 'nao_respondido'
        && estados.correlacao === 'alta') {
        contradicoes.push('Fato principal "nao_respondido" com correlacao "alta": incoerente (nao ha como correlacionar resposta a um fato nao enfrentado).');
    }

    const valido = erros.length === 0 && contradicoes.length === 0;
    return { valido, erros, contradicoes };
}

module.exports = { validarContrato };
