// VALIDADOR ESPECIALISTA RA.
// NAO recalcula a pontuacao. Apenas verifica a coerencia entre estados auditados,
// gates aplicados e faixa final; reconcilia dentro de limites com justificativa.

const { faixaDoScore, ordemFaixa } = require('./motor');

/**
 * Compressao linear continua V4 (evidencia fraca).
 * score <= x0 => inalterado; score > x0 => x0 + (teto - x0) * (score - x0) / (ref - x0)
 */
function aplicarV4CompressaoContinua(chance, perfil) {
    const cfg = perfil.validador;
    const x0 = cfg.v4_x0_inicio;
    const teto = cfg.v4_teto_saida;
    const ref = cfg.v4_score_referencia_max;
    if (chance <= x0) return chance;
    return x0 + (teto - x0) * (chance - x0) / (ref - x0);
}

function todosEstadosEm(estados, mapa) {
    return Object.entries(mapa).every(([criterio, permitidos]) => permitidos.includes(estados[criterio]));
}

function algumEstadoEm(estados, mapa) {
    return Object.entries(mapa).some(([criterio, permitidos]) => permitidos.includes(estados[criterio]));
}

/**
 * @param estados  estados auditados
 * @param resultadoMotor  { chance, faixaFinal, metadados }
 * @param perfil
 * @returns { status: 'coerente'|'ajustado'|'alerta', motivo, chance_final, faixa_final }
 */
function validar(estados, resultadoMotor, perfil) {
    const v = perfil.validador;
    let chance = resultadoMotor.chance;
    let faixa = resultadoMotor.faixaFinal;
    const gateAtivo = (resultadoMotor.metadados.gates_ativados || []).length > 0;

    const forte = todosEstadosEm(estados, v.estados_fortes);
    const fraco = algumEstadoEm(estados, v.estados_fracos);
    const evidenciaFraca = v.evidencia_fraca.includes(estados.evidencia_objetiva);

    const notas = [];
    let status = 'coerente';

    if (fraco && ordemFaixa(faixa, perfil) >= ordemFaixa('boa', perfil)) {
        const alvo = resultadoMotor.metadados.faixa_permitida;
        const [lo, hi] = perfil.faixas.limites[alvo];
        chance = +Math.min(Math.max(chance, lo), hi - 0.01).toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V3: estados fracos incompativeis com faixa alta; rebaixado para a faixa permitida (${alvo}).`);
        status = 'alerta';
    }

    if (forte && !gateAtivo && chance < v.piso_estados_fortes) {
        chance = +v.piso_estados_fortes.toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V1: estados de nucleo fortes exigiam piso de ${v.piso_estados_fortes}%; chance elevada por coerencia.`);
        status = status === 'alerta' ? 'alerta' : 'ajustado';
    }

    if (evidenciaFraca && v.v4_modo === 'compressao_continua') {
        const chancePreV4 = chance;
        chance = +aplicarV4CompressaoContinua(chance, perfil).toFixed(2);
        if (chance !== chancePreV4) {
            faixa = faixaDoScore(chance, perfil);
            notas.push(
                `V4: evidencia objetiva insuficiente; chance comprimida de ${chancePreV4}% para ${chance}% ` +
                `(compressao_continua x0=${v.v4_x0_inicio}, teto=${v.v4_teto_saida}).`
            );
            status = status === 'alerta' ? 'alerta' : 'ajustado';
        }
    } else if (evidenciaFraca && ordemFaixa(faixa, perfil) >= ordemFaixa('alta', perfil)) {
        const teto = v.v4_teto_saida ?? v.teto_alta_sem_evidencia;
        chance = +Math.min(chance, teto).toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V4: faixa Alta sem evidencia objetiva suficiente; limitada a ${teto}%.`);
        status = status === 'alerta' ? 'alerta' : 'ajustado';
    }

    return {
        status,
        motivo: notas.length ? notas.join(' ') : 'Pontuacao coerente com a auditoria.',
        chance_final: chance,
        faixa_final: faixa
    };
}

module.exports = { validar, aplicarV4CompressaoContinua };
