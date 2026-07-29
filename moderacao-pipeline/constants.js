'use strict';

/**
 * Constantes centrais do Pipeline V2 de moderacao.
 * Nao importa nada do server.js (baixo acoplamento). Valores podem ser
 * sobrescritos por env no wiring (ver index.js/orchestrator.js).
 */

const WORKFLOW_VERSION = '2.0';

// Nos fisicos da State Machine (3 chamadas ao modelo) + portao de codigo.
const NODES = {
    COMPREENSAO: 'COMPREENSAO', // Chamada 1 (E1 fatos + E2 conflito + E3 cobertura)
    DECISAO: 'DECISAO',         // Chamada 2 (E4 selecao + E5 autoauditoria)
    GATE: 'GATE',               // Portao deterministico (codigo)
    REDACAO: 'REDACAO'          // Chamada 3 (E6 raciocinio + E7 texto final)
};

// Etapas logicas preservadas para rastreabilidade fina (mapeadas nos nos).
const ETAPAS = {
    E1_FATOS: 'etapa1',
    E2_CONFLITO: 'etapa2',
    E3_COBERTURA: 'etapa3',
    E4_HIPOTESE: 'etapa4',
    E5_AUTOAUDITORIA: 'etapa5',
    E6_RACIOCINIO: 'etapa6',
    E7_TEXTO: 'etapa7'
};

const DEFAULTS = {
    models: {
        compreensao: 'gpt-4o-mini',
        decisao: 'gpt-4o',
        redacao: 'gpt-4o'
    },
    temperatures: {
        compreensao: 0.0,
        decisao: 0.1,
        redacao: 0.2
    },
    maxTokens: {
        compreensao: 1500,
        decisao: 3000,
        redacao: 2500
    },
    confLimiar: 0.6,     // confianca < limiar => confiancaBaixa (contrato do frontend)
    maxBackedges: 1      // back-edge GATE->DECISAO no maximo 1x (garante terminacao)
};

// Tabela de precos estimados (USD por 1M de tokens). Apenas estimativa para telemetria.
const PRICES = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o-2024-08-06': { input: 2.5, output: 10 }
};

const ACTORS = { LLM: 'llm', CODIGO: 'codigo' };

module.exports = { WORKFLOW_VERSION, NODES, ETAPAS, DEFAULTS, PRICES, ACTORS };
