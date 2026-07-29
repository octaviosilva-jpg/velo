'use strict';

/**
 * Teste offline (SEM chamadas pagas) do pipeline completo usando um openaiStep mockado.
 * Executa: node moderacao-pipeline/__tests__/pipeline.mock.test.js
 *
 * Cobre: COMPREENSAO -> DECISAO -> GATE -> (back-edge) -> REDACAO, write-guard,
 * evidenceMap, decisionLog com actor, telemetria e resultMapper.
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const orchestrator = require('../orchestrator');
const resultMapper = require('../resultMapper');

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

function makeMock({ confPrimeira }) {
    let decisaoCount = 0;
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('extrator objetivo de fatos')) {
            return jsonResp({
                fatos_reclamacao: ['Cliente afirma que a chave Pix sumiu'],
                pedidos_cliente: ['Reativar a chave'],
                acusacoes: ['Empresa roubou a chave'],
                fatos_resposta: ['Chave vinculada como garantia na CCB'],
                solucoes_apresentadas: ['Explicacao do vinculo contratual'],
                consideracao_tipo: 'confirma',
                novos_fatos: [],
                conflito_principal: 'pix',
                conflitos_secundarios: ['descumprimento contratual'],
                confianca_conflito: 0.9,
                cobertura_resposta: [
                    { alegacao: 'Cliente afirma que a chave Pix sumiu', respondido: true, tipo: 'direto', trechoResposta: 'Chave vinculada como garantia' }
                ]
            });
        }
        if (sys.includes('AUDITOR de moderacao')) {
            decisaoCount++;
            const confianca = decisaoCount === 1 ? confPrimeira : 0.9;
            return jsonResp({
                hipoteses_candidatas: [{ hipotese: 'AENV', score: 0.8, aderencia: 'alta' }],
                hipoteses_descartadas: [
                    { hipotese: 'Fraude', score: 0.2, evidenciasFavoraveis: [], evidenciasContrarias: ['sem indicio de fraude'], trechos: [], motivoDescarte: 'nao ha elementos de fraude' }
                ],
                hipotese_selecionada: { id: 'aenv', titulo: 'A empresa nao violou o direito do consumidor', manual: 'Manual Geral', comoCitar: 'conforme Manual Geral' },
                justificativa: 'Vinculo contratual aceito, confirmado na consideracao final',
                trechos_sustentam: [{ trecho: 'Cliente afirma que a chave Pix sumiu', origem: 'reclamacao' }],
                confianca
            });
        }
        if (sys.includes('redator de solicitacoes')) {
            return jsonResp({
                linha_raciocinio: 'Auditoria confirmou AENV com base no vinculo contratual.',
                texto_final: 'Prezados,\n\nSolicitamos a moderacao ...\n\nConforme registros ...\n\nDessa forma, solicitamos a moderacao.'
            });
        }
        throw new Error('prompt de sistema nao reconhecido pelo mock');
    };
}

async function cenario(nome, confPrimeira, esperaBackedge) {
    const state = createWorkflowState({
        idReclamacao: '123456',
        entradasCruas: { solicitacao: 'A chave Pix sumiu...', resposta: 'Vinculada na CCB...', consideracao: 'Era isso do contrato.' }
    });
    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMock({ confPrimeira }),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => ''
    };
    await orchestrator.runPipeline(state, deps);

    assert.ok(state.hipoteseSelecionada, 'hipotese selecionada');
    assert.ok(state.textoFinal.startsWith('Prezados,'), 'texto final inicia com Prezados');
    assert.ok(state.evidenceMap.length > 0, 'evidenceMap montado');
    assert.ok(state.decisionLog.some(d => d.actor === 'llm'), 'ha decisao actor=llm');
    assert.ok(state.decisionLog.some(d => d.actor === 'codigo'), 'ha decisao actor=codigo');
    assert.ok(state.hipotesesDescartadas.length > 0 && state.hipotesesDescartadas[0].score != null, 'descartadas com score');

    const backedges = (state.telemetria.find(t => t.node === 'TOTAL') || {}).backedges;
    assert.strictEqual(backedges, esperaBackedge ? 1 : 0, `backedges esperado=${esperaBackedge ? 1 : 0}`);

    const mapped = resultMapper.mapToLegacyContract(state, { confLimiar: 0.6 });
    assert.ok(mapped.result.includes('(1) AUDITORIA DA HIPÓTESE'), 'result tem bloco 1');
    assert.ok(mapped.result.includes('(2) LINHA DE RACIOCÍNIO INTERNA'), 'result tem bloco 2');
    assert.ok(mapped.result.includes('(3) TEXTO FINAL DE MODERAÇÃO'), 'result tem bloco 3');

    console.log(`OK [${nome}] backedges=${backedges} conf=${state.confianca} confiancaBaixa=${mapped.confiancaBaixa}`);
}

(async () => {
    await cenario('happy-path', 0.9, false);
    await cenario('back-edge-por-confianca-baixa', 0.4, true);
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
