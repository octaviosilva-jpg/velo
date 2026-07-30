'use strict';

/**
 * Constantes e enums congelados (Architecture Freeze v1) — ARPC-RA PEV.
 * Contratos publicos do pipeline; nao importar server.js.
 */

const WORKFLOW_VERSION = '1.0';
const SCHEMA_VERSION = '1.0';

const PIPELINE_MODE = {
    OFF: 'off',
    SHADOW: 'shadow',
    PEV: 'pev'
};

const REGIME_SOLUCAO = {
    VAZIA: 'vazia',
    PARCIAL: 'parcial',
    COMPLETA: 'completa'
};

const MODO_OPERACAO = {
    CONSTRUIR: 'construir',
    COMPLEMENTAR: 'complementar',
    REFINAR: 'refinar'
};

const FONTE_PRIMARIA = {
    SOLUCAO_IMPLEMENTADA: 'solucao_implementada',
    PADRAO_COERENTE: 'padrao_coerente',
    MISTO: 'misto'
};

const FUNCAO_ARGUMENTATIVA = {
    RESPOSTA_DIRETA: 'resposta_direta',
    ESCLARECIMENTO_TECNICO: 'esclarecimento_tecnico',
    SOLUCAO: 'solucao',
    POSICIONAMENTO: 'posicionamento'
};

const PROFUNDIDADE_ESPERADA = {
    TELEGRAFICA: 'telegrafica',
    PADRAO: 'padrao',
    DETALHADA: 'detalhada'
};

const SEVERIDADE = {
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    BLOCKER: 'BLOCKER'
};

const RECOMENDACAO_RETRY = {
    EXECUTOR: 'executor',
    PLANNER: 'planner',
    NENHUM: 'nenhum'
};

const FALHA_PREFIXO = {
    FACTUAL: 'factual.',
    EDITORIAL: 'editorial.'
};

const SKIP_POLICY_VERSION = '1.0';

const SKIP_MOTIVO = {
    FACTUAL_TIER1: 'skip.factual.tier1_refinar_completa',
    EDITORIAL_TIER1: 'skip.editorial.tier1_refinar_completa_sem_checklist'
};

const NODES = {
    PRE_PROCESSOR: 'PRE_PROCESSOR',
    PLANNER: 'PLANNER',
    EXECUTOR: 'EXECUTOR',
    DETERMINISTIC_GATE: 'DETERMINISTIC_GATE',
    AUDITOR_SKIP_POLICY: 'AUDITOR_SKIP_POLICY',
    AUDITOR_FACTUAL: 'AUDITOR_FACTUAL',
    AUDITOR_EDITORIAL: 'AUDITOR_EDITORIAL',
    MONOLITH: 'MONOLITH'
};

const ACTORS = {
    CODIGO: 'codigo',
    LLM: 'llm'
};

const PRICES = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 }
};

const DEFAULTS = {
    coerentesOrcamentoChars: 60000,
    coerentesMaxSelecionados: 3,
    feedbacksMax: 5,
    pisoContextoSimilaridade: 0.10,
    models: {
        planner: 'gpt-4o',
        executor: 'gpt-4o',
        auditorFactual: 'gpt-4o',
        auditorEditorial: 'gpt-4o'
    },
    temperatures: {
        planner: 0.2,
        executor: 0.4,
        auditorFactual: 0.1,
        auditorEditorial: 0.1
    },
    maxTokens: {
        planner: 2500,
        executor: 2000,
        auditorFactual: 2000,
        auditorEditorial: 2000
    },
    maxExecutorRetries: 2,
    maxPlannerTechnicalRetries: 1,
    maxFactualExecutorRetries: 2,
    maxAuditorTechnicalRetries: 1,
    maxEditorialExecutorRetries: 2,
    maxAuditorEditorialTechnicalRetries: 1,
    openaiTimeoutMs: 60000
};

module.exports = {
    WORKFLOW_VERSION,
    SCHEMA_VERSION,
    SKIP_POLICY_VERSION,
    SKIP_MOTIVO,
    PIPELINE_MODE,
    REGIME_SOLUCAO,
    MODO_OPERACAO,
    FONTE_PRIMARIA,
    FUNCAO_ARGUMENTATIVA,
    PROFUNDIDADE_ESPERADA,
    SEVERIDADE,
    RECOMENDACAO_RETRY,
    FALHA_PREFIXO,
    NODES,
    ACTORS,
    PRICES,
    DEFAULTS
};
