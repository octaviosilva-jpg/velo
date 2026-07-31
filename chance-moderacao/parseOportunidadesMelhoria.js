'use strict';

const { MARCADOR_OPORTUNIDADES_JSON } = require('./secoesV8');
const { parseJsonTolerante } = require('../resposta-pipeline/openaiStep');

/**
 * Separa relatório markdown e bloco JSON de oportunidades (A16).
 * @returns {{ relatorio: string, jsonRaw: string|null }}
 */
function separarRelatorioEOportunidades(texto) {
    if (!texto || typeof texto !== 'string') {
        return { relatorio: '', jsonRaw: null };
    }
    const idx = texto.indexOf(MARCADOR_OPORTUNIDADES_JSON);
    if (idx === -1) {
        return { relatorio: texto.trim(), jsonRaw: null };
    }
    const relatorio = texto.slice(0, idx).trim();
    const resto = texto.slice(idx + MARCADOR_OPORTUNIDADES_JSON.length);
    const matchJson = resto.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonRaw = matchJson ? matchJson[1].trim() : null;
    return { relatorio, jsonRaw };
}

/** Extrai e normaliza DTO oportunidadesMelhoria da saída da Auditora. */
function parseOportunidadesMelhoria(texto) {
    const { jsonRaw } = separarRelatorioEOportunidades(texto);
    if (!jsonRaw) return null;
    const parsed = parseJsonTolerante(jsonRaw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
        schemaVersion: parsed.schemaVersion || 'oportunidades-v1',
        itens: Array.isArray(parsed.itens) ? parsed.itens : []
    };
}

module.exports = { separarRelatorioEOportunidades, parseOportunidadesMelhoria };
