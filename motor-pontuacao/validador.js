// VALIDADOR ESPECIALISTA RA.
// NAO recalcula a pontuacao. Apenas verifica a coerencia entre estados auditados,
// gates aplicados e faixa final; reconcilia dentro de limites com justificativa.

const { faixaDoScore, ordemFaixa } = require('./motor');

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

    // V2/V3 (rede de seguranca): estados fracos nunca deveriam alcancar faixa >= boa.
    // Se ocorrer, houve falha de gate/parsing: rebaixa e alerta.
    if (fraco && ordemFaixa(faixa, perfil) >= ordemFaixa('boa', perfil)) {
        const alvo = resultadoMotor.metadados.faixa_permitida;
        const [lo, hi] = perfil.faixas.limites[alvo];
        chance = +Math.min(Math.max(chance, lo), hi - 0.01).toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V3: estados fracos incompativeis com faixa alta; rebaixado para a faixa permitida (${alvo}).`);
        status = 'alerta';
    }

    // V1: estados fortes + sem gate legitimo, mas chance abaixo do piso => eleva ao piso.
    if (forte && !gateAtivo && chance < v.piso_estados_fortes) {
        chance = +v.piso_estados_fortes.toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V1: estados de nucleo fortes exigiam piso de ${v.piso_estados_fortes}%; chance elevada por coerencia.`);
        status = status === 'alerta' ? 'alerta' : 'ajustado';
    }

    // V4: faixa Alta sem lastro objetivo de evidencia => teto.
    if (evidenciaFraca && ordemFaixa(faixa, perfil) >= ordemFaixa('alta', perfil)) {
        chance = +Math.min(chance, v.teto_alta_sem_evidencia).toFixed(2);
        faixa = faixaDoScore(chance, perfil);
        notas.push(`V4: faixa Alta sem evidencia objetiva suficiente; limitada a ${v.teto_alta_sem_evidencia}%.`);
        status = status === 'alerta' ? 'alerta' : 'ajustado';
    }

    return {
        status,
        motivo: notas.length ? notas.join(' ') : 'Pontuacao coerente com a auditoria.',
        chance_final: chance,
        faixa_final: faixa
    };
}

module.exports = { validar };
