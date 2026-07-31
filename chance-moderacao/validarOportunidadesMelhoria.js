'use strict';

const { OPORTUNIDADES_SCHEMA_VERSION } = require('./constants');

/**
 * Valida DTO oportunidadesMelhoria contra schema e critérios do perfil Motor.
 * @param {object} dto
 * @param {object} perfil - perfil de calibração carregado
 * @returns {{ valido: boolean, erros: string[] }}
 */
function validarOportunidadesMelhoria(dto, perfil) {
    const erros = [];
    if (!dto || typeof dto !== 'object') {
        return { valido: false, erros: ['DTO ausente ou inválido'] };
    }
    if (dto.schemaVersion !== OPORTUNIDADES_SCHEMA_VERSION) {
        erros.push(`schemaVersion inválido: ${dto.schemaVersion}`);
    }
    if (!Array.isArray(dto.itens)) {
        erros.push('itens deve ser array');
        return { valido: false, erros };
    }

    if (dto.itens.length === 0) {
        return { valido: true, erros: [] };
    }

    const criteriosValidos = new Set(Object.keys(perfil?.criterios || {}));
    const idsVistos = new Set();

    for (const [i, item] of dto.itens.entries()) {
        const prefix = `itens[${i}]`;
        if (!item || typeof item !== 'object') {
            erros.push(`${prefix}: item inválido`);
            continue;
        }
        for (const campo of ['id', 'criterioId', 'criterioLabel', 'diagnostico', 'acao']) {
            if (!item[campo] || typeof item[campo] !== 'string' || !item[campo].trim()) {
                erros.push(`${prefix}.${campo} obrigatório`);
            }
        }
        if (item.criterioId && !criteriosValidos.has(item.criterioId)) {
            erros.push(`${prefix}.criterioId desconhecido: ${item.criterioId}`);
        }
        if (item.id && idsVistos.has(item.id)) {
            erros.push(`${prefix}.id duplicado: ${item.id}`);
        }
        if (item.id) idsVistos.add(item.id);

        if (!Array.isArray(item.criteriosImpactados)) {
            erros.push(`${prefix}.criteriosImpactados deve ser array`);
        } else if (item.criteriosImpactados.length === 0) {
            erros.push(`${prefix}.criteriosImpactados não pode ser vazio`);
        }

        const textoItem = JSON.stringify(item);
        if (/%\s*\d|\d\s*%/.test(textoItem)) {
            erros.push(`${prefix}: percentuais proibidos no DTO`);
        }
    }

    return { valido: erros.length === 0, erros };
}

module.exports = { validarOportunidadesMelhoria };
