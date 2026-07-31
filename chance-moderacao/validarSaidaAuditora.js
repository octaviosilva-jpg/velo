'use strict';

const { LINGUAGEM_ESPECULATIVA_PROIBIDA } = require('./constants');
const { validarSecoesAuditora } = require('./secoesV8');

const REGEX_PERCENTUAL = /\d\s*%|%\s*\d|chance\s*(estimada|de|final)/i;

/**
 * Valida saída markdown da Auditora Técnica (A1, A4, A10).
 * @returns {{ valido: boolean, erros: string[] }}
 */
function validarSaidaAuditora(markdown, perfil) {
    const erros = [];
    if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
        return { valido: false, erros: ['relatório vazio'] };
    }

    const secoes = validarSecoesAuditora(markdown);
    if (!secoes.valido) {
        erros.push(`seções H2 faltando: ${secoes.faltando.join(', ')}`);
    }

    const textoLower = markdown.toLowerCase();
    if (REGEX_PERCENTUAL.test(markdown)) {
        erros.push('contém percentual ou estimativa de chance (proibido)');
    }
    for (const termo of LINGUAGEM_ESPECULATIVA_PROIBIDA) {
        if (textoLower.includes(termo.toLowerCase())) {
            erros.push(`linguagem especulativa proibida: "${termo}"`);
        }
    }

    if (perfil && perfil.criterios) {
        const secJust = secoes.secoes['justificativa dos critérios do motor'];
        if (secJust) {
            for (const criterioId of Object.keys(perfil.criterios)) {
                const label = perfil.criterios[criterioId]?.label || criterioId;
                const padrao = new RegExp(`###\\s*\\[?${escapeRegex(label)}\\]?`, 'i');
                if (!padrao.test(secJust.conteudo) && !secJust.conteudo.includes(criterioId)) {
                    erros.push(`critério ausente na justificativa: ${label}`);
                }
            }
        }
    }

    return { valido: erros.length === 0, erros };
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { validarSaidaAuditora };
