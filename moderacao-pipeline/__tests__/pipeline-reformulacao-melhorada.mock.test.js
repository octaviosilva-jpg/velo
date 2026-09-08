'use strict';

/**
 * Teste offline (SEM chamadas pagas) da variante MELHORADA de reformulação
 * (runPipelineReformulacaoV2Melhorada / REDACAO_REFORMULACAO), aditiva a
 * pipeline-reformulacao.mock.test.js (que continua cobrindo o caminho padrão intocado).
 * Executa: node moderacao-pipeline/__tests__/pipeline-reformulacao-melhorada.mock.test.js
 *
 * Cobre: a redação da reformulação recebe negativaReal (motivo/código/diretriz oficial) e o
 * texto final cita e refuta esse motivo antes de reforçar a hipótese — o padrão observado nos
 * 3 casos reais aceitos pelo RA (análise de calibração 2026-09-08), ausente no caminho padrão
 * (REDACAO v2), que nunca recebe negativaReal.
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPipelineReformulacaoV2Melhorada } = require('../orchestratorReformulacaoV2');
const resultMapper = require('../resultMapper');
const { validarTextoModeracao } = require('../redacaoValidator');

function jsonResp(obj) {
    return {
        conteudo: JSON.stringify(obj),
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        duracaoMs: 5,
        custoEstimado: 0.001,
        model: 'mock',
        temperature: 0,
        promptRenderizado: { system: '', user: '' },
        respostaCrua: {}
    };
}

function makeMock() {
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        const user = (messages[1] && messages[1].content) || '';

        if (sys.includes('extrator objetivo de fatos')) {
            return jsonResp({
                fatos_reclamacao: ['Cliente afirma cobranca de juros abusivos'],
                pedidos_cliente: ['Anular a nota'],
                acusacoes: ['Empresa cobra juros nao informados'],
                fatos_resposta: ['Empresa esclarece que os juros foram informados no contrato'],
                solucoes_apresentadas: ['Explicacao do calculo de juros'],
                consideracao_tipo: 'contradiz',
                novos_fatos: [],
                conflito_principal: 'cobranca',
                conflitos_secundarios: [],
                confianca_conflito: 0.9,
                cobertura_resposta: [
                    { alegacao: 'Cliente afirma cobranca de juros abusivos', respondido: true, tipo: 'direto', trechoResposta: 'juros informados no contrato' }
                ]
            });
        }

        if (sys.includes('JA FOI NEGADO')) {
            return jsonResp({
                analise_holistica: {
                    nucleo_reclamacao: 'Divergencia sobre informacao previa dos juros',
                    conflitos: [{ conflito: 'Juros nao informados', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'contrato anexado com os juros' }],
                    leitura_consideracao_final: 'Cliente reafirma nao ter recebido o contrato'
                },
                hipoteses_candidatas: [{ hipotese: 'inadimplencia-juros', score: 0.85, aderencia: 'alta' }],
                hipoteses_descartadas: [],
                hipotese_selecionada: { id: 'inadimplencia-juros', titulo: 'Cliente inadimplente que questiona juros', manual: 'Manual de Bancos', comoCitar: 'conforme o Manual de Moderacao de Bancos' },
                justificativa: 'O contrato assinado eletronicamente comprova de forma objetiva os juros informados, afastando a divergencia apontada pelo RA',
                trechos_sustentam: [{ trecho: 'Os juros foram informados no contrato assinado eletronicamente', origem: 'resposta' }],
                confianca: 0.82,
                onde_a_tentativa_anterior_falhou: 'A tese anterior nao apresentava fato objetivo que afastasse a divergencia (CO06)',
                forca_da_nova_tentativa: 'forte',
                forca_justificativa: 'Ataca exatamente o motivo citado pelo RA (CO06)'
            });
        }

        if (sys.includes('DOCUMENTO DE REFUTACAO')) {
            // Confere que o contexto da negativa real chegou ATE A REDACAO (o gap corrigido:
            // REDACAO v2 nunca recebia isso).
            assert.ok(user.includes('CO06'), 'prompt de redacao-reformulacao deve conter o codigo da negativa');
            assert.ok(user.includes('Divergência de Informações') || user.includes('Divergencia de Informacoes'), 'prompt deve conter o motivo oficial da negativa');
            assert.ok(user.includes('Sustentar a resposta em fatos verificaveis'), 'prompt deve conter a diretriz oficial de correcao (regraOrientacao)');
            assert.ok(user.includes('ESTRUTURA OBRIGATORIA'), 'prompt deve instruir a estrutura de refutacao, nao redacao do zero');

            return jsonResp({
                linha_raciocinio: 'Refutei diretamente o motivo CO06 (divergencia de informacoes) citando o contrato assinado eletronicamente como fato verificavel, depois reforcei a hipotese de inadimplencia/juros.',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nSolicitamos a reanalise do pedido de moderacao, anteriormente indeferido sob a justificativa CO06 (Divergencia de Informacoes).\n\n1. Nao ha divergencia factual: o contrato assinado eletronicamente comprova de forma objetiva os juros informados ao cliente, fato verificavel e nao contraditado por nenhum registro em sentido contrario.\n\n2. Diante disso, a reclamacao se enquadra na hipotese prevista no Manual de Bancos sobre cliente inadimplente que questiona juros ja informados em contrato.\n\nDiante do exposto, solicitamos o provimento desta reanalise.'
            });
        }

        throw new Error(`prompt de sistema nao reconhecido pelo mock: ${sys.slice(0, 80)}`);
    };
}

async function cenarioRedacaoComNegativaReal() {
    const state = createWorkflowState({
        idReclamacao: '654321',
        entradasCruas: {
            solicitacao: 'Fui cobrado juros que nunca me informaram, nunca recebi contrato.',
            resposta: 'Os juros foram informados no contrato assinado eletronicamente.',
            consideracao: 'Nunca recebi nenhum contrato por e-mail ou qualquer outro canal.'
        },
        negativaReal: {
            motivoOficial: 'Divergência de Informações',
            codigo: 'CO06',
            regraTitulo: 'Nao pode haver divergencia de informacoes',
            regraOQueVerifica: 'Se ha posicionamentos conflitantes entre cliente e empresa sobre um mesmo fato.',
            regraReprovaQuando: 'Empresa afirma algo e o cliente nega; o RA nao decide quem tem razao e nega.',
            regraOrientacao: 'Sustentar a resposta em fatos verificaveis e registros proprios, evitando afirmacoes que o cliente possa contradizer sem prova no conteudo publico.',
            hipoteseAnterior: 'hipotese-fraca-anterior: juros abusivos sem base contratual',
            teseBateu: false
        }
    });

    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMock(),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => ''
    };

    await runPipelineReformulacaoV2Melhorada(state, deps);

    assert.ok(state.hipoteseSelecionada, 'hipotese selecionada');
    assert.ok(state.textoFinal.includes('anteriormente indeferido sob a justificativa CO06'), 'texto final cita explicitamente o motivo/codigo da negativa recebida');
    assert.ok(/\b1\./.test(state.textoFinal) && /\b2\./.test(state.textoFinal), 'texto final usa estrutura enumerada de refutacao');
    assert.ok(state.textoFinal.startsWith('Prezada equipe de moderacao'), 'texto final dirigido a equipe de moderacao');

    const val = validarTextoModeracao(state.textoFinal);
    assert.strictEqual(val.ok, true, `texto_final valido como pedido de moderacao (${JSON.stringify(val)})`);

    const mapped = resultMapper.mapReformulacaoToLegacyContract(state, { confLimiar: 0.6 });
    assert.ok(mapped.result.includes('Onde a tentativa anterior falhou'), 'contrato legado continua funcionando com REDACAO_REFORMULACAO');

    console.log(`OK [redacao-com-negativa-real] hipotese=${state.hipoteseSelecionada.id} cita_codigo=true`);
}

(async () => {
    await cenarioRedacaoComNegativaReal();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
