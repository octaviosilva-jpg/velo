// Regressao dos 5 exemplos aprovados no projeto matematico.
// Uso: node motor-pontuacao/regressao.js
// Espera: ~95 / ~88 / ~54 / ~36 / ~29.

const { analisarChance } = require('./index');

const gatesOk = { prazo: 'elegivel', resposta_generica: 'nao_generica' };

const casos = [
    {
        nome: 'Ex1 - Livro-texto (Alta)',
        esperado: [90, 96],
        auditoria: {
            estados: {
                cobertura_fato_principal: 'respondido_diretamente',
                adequacao_hipotese: 'muito_forte',
                correlacao: 'alta',
                evidencia_objetiva: 'documental_conclusiva',
                cobertura_secundaria: 'respondido',
                conformidade_aenv: 'sem_riscos',
                qualidade_fundamentacao: 'boa',
                clareza: 'boa',
                pedidos_acessorios: 'respondido_indiretamente',
                calibracao_historica: 'positiva_alta'
            },
            gates: gatesOk
        }
    },
    {
        nome: 'Ex2 - Forte com clareza baixa (Alta)',
        esperado: [84, 92],
        auditoria: {
            estados: {
                cobertura_fato_principal: 'respondido_diretamente',
                adequacao_hipotese: 'forte',
                correlacao: 'alta',
                evidencia_objetiva: 'objetiva_forte',
                cobertura_secundaria: 'respondido',
                conformidade_aenv: 'sem_riscos',
                qualidade_fundamentacao: 'media',
                clareza: 'baixa',
                pedidos_acessorios: 'respondido_indiretamente',
                calibracao_historica: 'neutra'
            },
            gates: gatesOk
        }
    },
    {
        nome: 'Ex3 - Fato principal parcial (Intermediaria)',
        esperado: [50, 58],
        auditoria: {
            estados: {
                cobertura_fato_principal: 'respondido_parcialmente',
                adequacao_hipotese: 'forte',
                correlacao: 'media',
                evidencia_objetiva: 'objetiva_forte',
                cobertura_secundaria: 'parcial',
                conformidade_aenv: 'riscos_leves',
                qualidade_fundamentacao: 'boa',
                clareza: 'boa',
                pedidos_acessorios: 'respondido_indiretamente',
                calibracao_historica: 'positiva_media'
            },
            gates: gatesOk
        }
    },
    {
        nome: 'Ex4 - Hipotese inadequada (Baixa)',
        esperado: [32, 40],
        auditoria: {
            estados: {
                cobertura_fato_principal: 'respondido_diretamente',
                adequacao_hipotese: 'inadequada',
                correlacao: 'alta',
                evidencia_objetiva: 'objetiva_forte',
                cobertura_secundaria: 'respondido',
                conformidade_aenv: 'sem_riscos',
                qualidade_fundamentacao: 'boa',
                clareza: 'excelente',
                pedidos_acessorios: 'respondido_diretamente',
                calibracao_historica: 'neutra'
            },
            gates: gatesOk
        }
    },
    {
        nome: 'Ex5 - Empresa falhou, nucleo nao respondido (Baixa)',
        esperado: [25, 33],
        auditoria: {
            estados: {
                cobertura_fato_principal: 'nao_respondido',
                adequacao_hipotese: 'media',
                correlacao: 'baixa',
                evidencia_objetiva: 'objetiva_moderada',
                cobertura_secundaria: 'nao_respondido',
                conformidade_aenv: 'risco_bloqueante',
                qualidade_fundamentacao: 'media',
                clareza: 'media',
                pedidos_acessorios: 'autonomo_nao_respondido',
                calibracao_historica: 'sem_referencia'
            },
            gates: gatesOk
        }
    }
];

let falhas = 0;
for (const caso of casos) {
    const r = analisarChance(caso.auditoria);
    if (!r.sucesso) {
        console.log(`FALHA CONTRATO  ${caso.nome}: ${JSON.stringify(r.erros || r.contradicoes)}`);
        falhas++;
        continue;
    }
    const [lo, hi] = caso.esperado;
    const ok = r.chance_final >= lo && r.chance_final <= hi;
    if (!ok) falhas++;
    console.log(
        `${ok ? 'OK  ' : 'FALHA'} ${caso.nome} => ${r.chance_final}% (${r.faixa_final}) ` +
        `[base ${r.metadados.score_base}, hist ${r.metadados.historico_aplicado}, ` +
        `posGates ${r.metadados.score_pos_gates}, validador ${r.metadados.validador_status}] ` +
        `esperado ${lo}-${hi}`
    );
}

console.log(falhas === 0 ? '\nTODOS OS CASOS PASSARAM.' : `\n${falhas} CASO(S) FALHARAM.`);
process.exit(falhas === 0 ? 0 : 1);
