'use strict';

const crypto = require('crypto');
const { parseSecoes, normalizarTitulo } = require('./secoesV8');
const { analisarHeadingsJustificativa } = require('./validarSaidaAuditora');

/** Debug habilitado por env CHANCE_DEBUG ou body debug em não-produção / com env. */
function isChanceDebugEnabled(envVars = {}, bodyDebug = false) {
    const envOn = String(envVars.CHANCE_DEBUG || process.env.CHANCE_DEBUG || '')
        .toLowerCase() === 'true';
    if (envOn) return true;
    if (!bodyDebug) return false;
    const nodeEnv = envVars.NODE_ENV || process.env.NODE_ENV || '';
    return nodeEnv !== 'production';
}

function hashConteudo(texto) {
    if (!texto || typeof texto !== 'string') return null;
    return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

/** Metadados seguros para WorkflowState (sem auditoraRaw). */
function metadadosDebugAuditora(debugAuditora) {
    if (!debugAuditora) return null;
    return {
        fallback: !!debugAuditora.fallback,
        motivoValidacao: debugAuditora.motivoValidacao || null,
        etapa: debugAuditora.etapa || 'auditora',
        tentativa: debugAuditora.tentativa ?? null,
        schemaVersion: debugAuditora.schemaVersion || null,
        duracaoMs: debugAuditora.duracaoMs ?? null,
        errosPorTentativa: debugAuditora.errosPorTentativa || [],
        tentativas: debugAuditora.tentativas || [],
        auditoraRawHash: debugAuditora.auditoraRawHash || null,
        justificativaH3: debugAuditora.justificativaH3
            ? {
                totalH3: debugAuditora.justificativaH3.totalH3,
                totalReconhecidos: debugAuditora.justificativaH3.totalReconhecidos,
                headingsNormalizados: debugAuditora.justificativaH3.headingsNormalizados
            }
            : null
    };
}

function extrairMetaJustificativaH3(relatorio, perfil) {
    if (!relatorio || typeof relatorio !== 'string') return null;
    try {
        const secoes = parseSecoes(relatorio);
        const just = secoes[normalizarTitulo('Justificativa dos Critérios do Motor')];
        if (!just?.conteudo) return null;
        return analisarHeadingsJustificativa(just.conteudo, perfil || { criterios: {} });
    } catch (_e) {
        return null;
    }
}

function montarDebugAuditora(outAud, perfil) {
    if (!outAud) return null;
    const raw = outAud.auditoraRaw || null;
    const tel = outAud.telemetriaChamada || {};
    const justificativaH3 = extrairMetaJustificativaH3(outAud.relatorio, perfil);
    return {
        fallback: !!outAud.fallback,
        motivoValidacao: outAud.avisoValidacao || null,
        etapa: 'auditora',
        tentativa: tel.tentativa != null
            ? tel.tentativa
            : ((outAud.tentativas || []).length || null),
        auditoraRaw: raw,
        auditoraRawHash: hashConteudo(raw),
        schemaVersion: tel.schemaVersion || tel.promptVersion || 'auditora-v1',
        duracaoMs: tel.duracaoMs ?? null,
        errosPorTentativa: outAud.errosPorTentativa || [],
        tentativas: outAud.tentativas || tel.tentativas || [],
        justificativaH3
    };
}

module.exports = {
    isChanceDebugEnabled,
    hashConteudo,
    metadadosDebugAuditora,
    montarDebugAuditora,
    extrairMetaJustificativaH3
};
