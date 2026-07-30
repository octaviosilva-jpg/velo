'use strict';

const {
    SCHEMA_VERSION,
    RECOMENDACAO_RETRY,
    SEVERIDADE,
    REGIME_SOLUCAO
} = require('./constants');

const PALAVRAS_GENERICAS = [
    'situação atual', 'detalhes específicos não foram compartilhados',
    'nossa equipe está comprometida', 'analisar todas as solicitações',
    'embora os detalhes específicos', 'gostaríamos de assegurar',
    'caso a sua solicitação envolva', 'estamos aqui para esclarecer',
    'sua situação atual necessitou', 'detalhes específicos do seu caso'
];

function respostaRefleteSolucaoImplementada(resposta, solucaoImplementada) {
    if (!solucaoImplementada || !String(solucaoImplementada).trim()) return true;
    if (!resposta || typeof resposta !== 'string') return false;

    const sol = String(solucaoImplementada).toLowerCase().trim();
    const resp = resposta.toLowerCase();

    const trechoDireto = sol.length <= 50 ? sol : sol.substring(0, 50);
    if (resp.includes(trechoDireto)) return true;

    const stopwords = new Set([
        'para', 'como', 'sobre', 'apos', 'após', 'desde', 'pela', 'pelo', 'pelas', 'pelos',
        'com', 'sem', 'que', 'uma', 'uns', 'das', 'dos', 'nos', 'nas', 'foi',
        'ser', 'esta', 'está', 'este', 'essa', 'esse', 'isso', 'caso', 'cliente', 'velotax'
    ]);
    const palavras = sol
        .split(/\s+/)
        .map(p => p.replace(/[^a-záàâãéêíóôõúç0-9]/gi, ''))
        .filter(p => p.length >= 4 && !stopwords.has(p));

    if (palavras.length === 0) {
        return resp.includes(sol.substring(0, Math.min(25, sol.length)));
    }

    const correspondencias = palavras.filter(p => resp.includes(p)).length;
    const minimo = Math.max(2, Math.ceil(palavras.length * 0.35));
    return correspondencias >= minimo;
}

function getComprimentoMinimo(regimeSolucao) {
    return regimeSolucao === REGIME_SOLUCAO.VAZIA ? 700 : 120;
}

/**
 * Gate deterministico v1 — pos-Executor.
 * Sem interpretacao semantica LLM.
 */
function validateMiolo(texto, { solucaoImplementada, regimeSolucao } = {}) {
    const falhas = [];
    const minLen = getComprimentoMinimo(regimeSolucao);

    if (!texto || texto.length < minLen) {
        falhas.push({
            tipo: 'gate.comprimento',
            descricao: `Miolo abaixo do minimo (${minLen} caracteres)`,
            severidade: SEVERIDADE.ERROR
        });
    }

    const lower = String(texto || '').toLowerCase();
    for (const p of PALAVRAS_GENERICAS) {
        if (lower.includes(p)) {
            falhas.push({
                tipo: 'gate.generico',
                descricao: `Frase generica detectada: "${p}"`,
                severidade: SEVERIDADE.ERROR
            });
            break;
        }
    }

    if (!respostaRefleteSolucaoImplementada(texto, solucaoImplementada)) {
        falhas.push({
            tipo: 'gate.solucao',
            descricao: 'Miolo nao reflete a solucao implementada',
            severidade: SEVERIDADE.ERROR
        });
    }

    const aprovado = falhas.length === 0;
    return {
        schemaVersion: SCHEMA_VERSION,
        aprovado,
        falhas,
        recomendacaoRetry: aprovado ? RECOMENDACAO_RETRY.NENHUM : RECOMENDACAO_RETRY.EXECUTOR
    };
}

module.exports = {
    PALAVRAS_GENERICAS,
    respostaRefleteSolucaoImplementada,
    getComprimentoMinimo,
    validateMiolo
};
