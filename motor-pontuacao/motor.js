// MOTOR DE PONTUACAO (determinístico e puro).
// Consome apenas estados categoricos (JSON validado) + um Perfil de Calibracao.
// Mesma entrada => mesma saida. Nenhum numero "chumbado": tudo vem do perfil.

const MOTOR_VERSION = 'v1';

const EPS = 1e-9;

/** Retorna o nome da faixa correspondente ao score (top inclusivo apenas na faixa mais alta). */
function faixaDoScore(score, perfil) {
    const { ordem, limites } = perfil.faixas;
    for (let i = 0; i < ordem.length; i++) {
        const nome = ordem[i];
        const [lo, hi] = limites[nome];
        const ultima = i === ordem.length - 1;
        if (score >= lo && (score < hi || (ultima && score <= hi))) {
            return nome;
        }
    }
    // Fallback defensivo: abaixo do minimo => primeira faixa; acima => ultima.
    return score < limites[ordem[0]][0] ? ordem[0] : ordem[ordem.length - 1];
}

function ordemFaixa(nome, perfil) {
    return perfil.faixas.ordem.indexOf(nome);
}

/** Soma ponderada dos criterios (score base 0..100). */
function calcularScoreBase(estados, perfil) {
    let score = 0;
    const detalhe = {};
    for (const [criterio, cfg] of Object.entries(perfil.criterios)) {
        const estado = estados[criterio];
        const fator = cfg.estados[estado];
        const pontos = +(cfg.peso * fator).toFixed(4);
        score += pontos;
        detalhe[criterio] = { estado, fator, peso: cfg.peso, pontos };
    }
    return { score: +score.toFixed(4), detalhe };
}

/** Coleta os gates ativos (de criterios e independentes) e devolve a faixa permitida mais restritiva. */
function resolverGates(estados, perfil) {
    const ativos = [];

    for (const [criterio, cfg] of Object.entries(perfil.criterios)) {
        if (cfg.gate && cfg.gate[estados[criterio]]) {
            ativos.push({ origem: criterio, estado: estados[criterio], faixaMaxima: cfg.gate[estados[criterio]] });
        }
    }
    for (const [nome, cfg] of Object.entries(perfil.gates_independentes)) {
        const estado = estados[nome];
        if (cfg.gate && cfg.gate[estado]) {
            ativos.push({ origem: nome, estado, faixaMaxima: cfg.gate[estado] });
        }
    }

    // Faixa permitida = a mais restritiva (menor ordem). Sem gates => 'alta'.
    let faixaPermitida = perfil.faixas.ordem[perfil.faixas.ordem.length - 1];
    for (const g of ativos) {
        if (ordemFaixa(g.faixaMaxima, perfil) < ordemFaixa(faixaPermitida, perfil)) {
            faixaPermitida = g.faixaMaxima;
        }
    }
    return { ativos, faixaPermitida };
}

/** Ajuste historico intra-faixa: nunca reclassifica a faixa natural. */
function aplicarHistorico(scoreBase, estados, perfil) {
    const cfg = perfil.calibracao_historica;
    const ajuste = cfg.ajustes[estados.calibracao_historica] || 0;
    if (ajuste === 0) return { scorePosHistorico: scoreBase, ajuste: 0 };

    const faixaBase = faixaDoScore(scoreBase, perfil);
    const [, hi] = perfil.faixas.limites[faixaBase];
    // Positivo apenas; preso ao teto da faixa natural (intra-faixa).
    const tetoIntraFaixa = cfg.intra_faixa ? (hi - EPS) : Infinity;
    const scorePosHistorico = +Math.min(scoreBase + ajuste, tetoIntraFaixa).toFixed(4);
    return { scorePosHistorico, ajuste };
}

function clampGlobal(valor, perfil) {
    const { min, max } = perfil.clamp_global;
    return Math.min(Math.max(valor, min), max);
}

/**
 * Calcula a chance (antes do Validador Especialista RA).
 * @returns { chance, faixaFinal, metadados }
 */
function calcular(estados, perfil) {
    // 1. Score base
    const { score: scoreBase, detalhe } = calcularScoreBase(estados, perfil);
    const faixaNaturalBase = faixaDoScore(scoreBase, perfil);

    // 2. Historico (intra-faixa)
    const { scorePosHistorico, ajuste } = aplicarHistorico(scoreBase, estados, perfil);
    const faixaPosHistorico = faixaDoScore(scorePosHistorico, perfil);

    // 3. Gates (teto de faixa + compressao)
    const { ativos: gatesAtivos, faixaPermitida } = resolverGates(estados, perfil);

    let scorePosGates = scorePosHistorico;
    let compressaoAplicada = false;
    if (ordemFaixa(faixaPosHistorico, perfil) > ordemFaixa(faixaPermitida, perfil)) {
        const [lo, hi] = perfil.faixas.limites[faixaPermitida];
        scorePosGates = +(lo + (hi - lo) * (scorePosHistorico / 100)).toFixed(4);
        compressaoAplicada = true;
    }

    // 4. Clamp global
    const chance = +clampGlobal(scorePosGates, perfil).toFixed(2);
    const faixaFinal = faixaDoScore(chance, perfil);

    return {
        chance,
        faixaFinal,
        metadados: {
            score_base: scoreBase,
            faixa_natural: faixaNaturalBase,
            historico_aplicado: ajuste,
            score_pos_historico: scorePosHistorico,
            gates_ativados: gatesAtivos,
            faixa_permitida: faixaPermitida,
            compressao_aplicada: compressaoAplicada,
            score_pos_gates: scorePosGates,
            detalhe_criterios: detalhe
        }
    };
}

module.exports = { calcular, faixaDoScore, ordemFaixa, MOTOR_VERSION };
