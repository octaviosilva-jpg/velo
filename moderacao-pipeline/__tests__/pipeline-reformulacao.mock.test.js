'use strict';

/**
 * Teste offline (SEM chamadas pagas) do pipeline de REFORMULAÇÃO usando um openaiStep mockado.
 * Executa: node moderacao-pipeline/__tests__/pipeline-reformulacao.mock.test.js
 *
 * Cobre: COMPREENSAO -> DECISAO_REFORMULACAO -> GATE -> REDACAO, negativaReal como contexto,
 * troca de tese quando teseBateu=false, diagnostico + força da tentativa, mapReformulacaoToLegacyContract.
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const orchestrator = require('../orchestrator');
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
                novos_fatos: ['Cliente diz que nunca recebeu o contrato'],
                conflito_principal: 'cobranca',
                conflitos_secundarios: [],
                confianca_conflito: 0.9,
                cobertura_resposta: [
                    { alegacao: 'Cliente afirma cobranca de juros abusivos', respondido: true, tipo: 'direto', trechoResposta: 'juros informados no contrato' }
                ]
            });
        }

        if (sys.includes('JA FOI NEGADO')) {
            // Confere que o contexto da negativa real chegou no prompt renderizado.
            assert.ok(user.includes('CO06'), 'prompt de decisao-reformulacao deve conter o codigo da negativa');
            assert.ok(user.includes('hipotese-fraca-anterior'), 'prompt deve conter a hipotese anterior');
            assert.ok(user.includes('NAO e a mesma regra'), 'teseBateu=false deve gerar o sinal de troca de tese');

            return jsonResp({
                analise_holistica: {
                    nucleo_reclamacao: 'Divergencia sobre informacao previa dos juros',
                    conflitos: [
                        { conflito: 'Juros nao informados', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'contrato anexado com os juros' }
                    ],
                    leitura_consideracao_final: 'Cliente contesta ter recebido o contrato, ponto novo nao tratado antes'
                },
                hipoteses_candidatas: [{ hipotese: 'sem-divergencia', score: 0.85, aderencia: 'alta' }],
                hipoteses_descartadas: [
                    { hipotese: 'hipotese-fraca-anterior', score: 0.3, evidenciasFavoraveis: [], evidenciasContrarias: ['nao e a regra citada pelo RA'], trechos: [], motivoDescarte: 'RA citou CO06, essa hipotese nao trata de divergencia de informacoes' }
                ],
                hipotese_selecionada: { id: 'sem-divergencia', titulo: 'Nao pode haver divergencia de informacoes', manual: 'Manual Geral', comoCitar: 'conforme Manual Geral, divergencia de informacoes' },
                justificativa: 'O cliente nega ter recebido o contrato enquanto a empresa demonstra o envio, configurando divergencia direta de versoes',
                trechos_sustentam: [{ trecho: 'Cliente afirma cobranca de juros abusivos', origem: 'reclamacao' }],
                confianca: 0.82,
                onde_a_tentativa_anterior_falhou: 'A tese anterior nao tratava da divergencia sobre o recebimento do contrato, que e o ponto central levantado na consideracao final',
                forca_da_nova_tentativa: 'forte',
                forca_justificativa: 'A nova tese ataca exatamente o motivo citado pelo RA (CO06), com trecho literal da consideracao final'
            });
        }

        if (sys.includes('DOCUMENTO DE FUNDAMENTACAO')) {
            return jsonResp({
                linha_raciocinio: 'Auditoria de reformulacao trocou a tese para divergencia de informacoes, aderente ao motivo real da negativa.',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nEntendemos que a reclamacao se enquadra na hipotese de divergencia de informacoes prevista no Manual Geral.\n\nA resposta publica demonstra o envio do contrato, o que diverge diretamente da alegacao do consumidor.\n\nDiante do exposto, solicitamos a moderacao da reclamacao.'
            });
        }

        throw new Error(`prompt de sistema nao reconhecido pelo mock: ${sys.slice(0, 80)}`);
    };
}

async function cenarioTrocaDeTese() {
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
            regraOrientacao: 'Sustentar a resposta em fatos verificaveis e registros proprios.',
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

    await orchestrator.runPipelineReformulacao(state, deps);

    assert.ok(state.hipoteseSelecionada, 'hipotese selecionada');
    assert.strictEqual(state.hipoteseSelecionada.id, 'sem-divergencia', 'trocou para a hipotese que bate com o codigo real do RA');
    assert.ok(state.ondeATentativaAnteriorFalhou, 'diagnostico de onde a tentativa anterior falhou preenchido');
    assert.strictEqual(state.forcaDaTentativa, 'forte', 'forca da tentativa classificada');
    assert.ok(state.textoFinal.startsWith('Prezada equipe de moderacao'), 'texto final dirigido a equipe de moderacao (nao "Prezados,")');

    const val = validarTextoModeracao(state.textoFinal);
    assert.strictEqual(val.ok, true, `texto_final valido como pedido de moderacao (${JSON.stringify(val)})`);

    const mapped = resultMapper.mapReformulacaoToLegacyContract(state, { confLimiar: 0.6 });
    assert.ok(mapped.result.includes('Onde a tentativa anterior falhou'), 'result inclui o diagnostico');
    assert.ok(mapped.result.includes('Força da nova tentativa: 🟢 Forte'), 'result inclui a forca com rotulo');
    assert.strictEqual(mapped.forcaDaTentativa, 'forte', 'contrato expoe forcaDaTentativa separadamente');
    assert.strictEqual(mapped.confiancaBaixa, false, 'confianca 0.82 acima do limiar 0.6');

    console.log(`OK [troca-de-tese] hipotese=${state.hipoteseSelecionada.id} forca=${state.forcaDaTentativa}`);
}

(async () => {
    await cenarioTrocaDeTese();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
