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
                analise_holistica: {
                    nucleo_reclamacao: 'Cliente contesta o vinculo da chave Pix como garantia da CCB',
                    conflitos: [
                        { conflito: 'Chave Pix sumiu/foi vinculada', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'Resposta cita vinculo como garantia na CCB' },
                        { conflito: 'Descumprimento contratual', tipo: 'secundario', respondido_pela_empresa: 'parcial', evidencia: 'Resposta explica clausula mas nao detalha' }
                    ],
                    leitura_consideracao_final: 'Consumidor confirma que o vinculo constava do contrato'
                },
                hipoteses_candidatas: [{ hipotese: 'AENV', score: 0.8, aderencia: 'alta' }],
                hipoteses_descartadas: [
                    { hipotese: 'Fraude', score: 0.2, evidenciasFavoraveis: [], evidenciasContrarias: ['sem indicio de fraude'], trechos: [], motivoDescarte: 'nao ha elementos de fraude' }
                ],
                hipotese_selecionada: { id: 'aenv', titulo: 'A empresa nao violou o direito do consumidor', manual: 'Manual Geral', comoCitar: 'conforme Manual Geral' },
                justificativa: 'Vinculo contratual aceito, confirmado na consideracao final; abrange conflito principal e secundario',
                trechos_sustentam: [{ trecho: 'Cliente afirma que a chave Pix sumiu', origem: 'reclamacao' }],
                confianca
            });
        }
        if (sys.includes('DOCUMENTO DE FUNDAMENTACAO')) {
            return jsonResp({
                linha_raciocinio: 'Auditoria confirmou AENV com base no vinculo contratual.',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nEntendemos que a reclamacao se enquadra na hipotese prevista no Manual, conforme o Manual de Moderacao.\n\nA resposta publica e a consideracao final confirmam o vinculo contratual.\n\nDiante do exposto, solicitamos a moderacao da reclamacao.'
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
    assert.ok(state.textoFinal.startsWith('Prezada equipe de moderacao'), 'texto final dirigido a equipe de moderacao');
    assert.ok(state.evidenceMap.length > 0, 'evidenceMap montado');
    assert.ok(state.decisionLog.some(d => d.actor === 'llm'), 'ha decisao actor=llm');
    assert.ok(state.decisionLog.some(d => d.actor === 'codigo'), 'ha decisao actor=codigo');
    assert.ok(state.hipotesesDescartadas.length > 0 && state.hipotesesDescartadas[0].score != null, 'descartadas com score');

    // Decisao holistica: analiseDecisao populado e cobrindo TODOS os conflitos da Compreensao.
    assert.ok(state.analiseDecisao && state.analiseDecisao.nucleoReclamacao, 'analiseDecisao com nucleo');
    assert.ok(Array.isArray(state.analiseDecisao.conflitos), 'analiseDecisao.conflitos e lista');
    assert.ok(state.analiseDecisao.conflitos.some(c => c.tipo === 'principal'), 'ha conflito principal');
    assert.ok(state.analiseDecisao.conflitos.some(c => c.tipo === 'secundario'), 'ha conflito secundario');
    const conflitosIdentificados = (state.conflitoPrincipal ? 1 : 0) + state.conflitosSecundarios.length;
    assert.ok(state.analiseDecisao.conflitos.length >= conflitosIdentificados, 'conflitos avaliados >= identificados');

    // Redacao dirigida ao analista: validacao dupla (negativa + positiva).
    const val = validarTextoModeracao(state.textoFinal);
    assert.strictEqual(val.ok, true, `texto_final valido como pedido de moderacao (${JSON.stringify(val)})`);
    assert.strictEqual(val.linguagemAtendimento.length, 0, 'texto_final sem linguagem de atendimento');
    assert.ok(val.marcadoresPedido.length >= 1, 'texto_final com marcador de pedido');

    const backedges = (state.telemetria.find(t => t.node === 'TOTAL') || {}).backedges;
    assert.strictEqual(backedges, esperaBackedge ? 1 : 0, `backedges esperado=${esperaBackedge ? 1 : 0}`);

    const mapped = resultMapper.mapToLegacyContract(state, { confLimiar: 0.6 });
    assert.ok(mapped.result.includes('(1) AUDITORIA DA HIPÓTESE'), 'result tem bloco 1');
    assert.ok(mapped.result.includes('(2) LINHA DE RACIOCÍNIO INTERNA'), 'result tem bloco 2');
    assert.ok(mapped.result.includes('(3) TEXTO FINAL DE MODERAÇÃO'), 'result tem bloco 3');
    assert.ok(mapped.result.includes('Nucleo da reclamacao'), 'bloco 1 inclui nucleo da reclamacao');
    assert.ok(mapped.result.includes('Conflitos avaliados'), 'bloco 1 inclui conflitos avaliados');

    console.log(`OK [${nome}] backedges=${backedges} conf=${state.confianca} confiancaBaixa=${mapped.confiancaBaixa}`);
}

function testesValidadorRedacao() {
    // Positivo: pedido de moderacao, sem atendimento; "Entendemos que ... se enquadra" NAO e atendimento.
    const valido = validarTextoModeracao('Prezada equipe de moderacao do Reclame Aqui, entendemos que a reclamacao se enquadra na hipotese do Manual. Diante do exposto, solicitamos a moderacao.');
    assert.strictEqual(valido.ok, true, 'caso valido deve passar');
    assert.strictEqual(valido.linguagemAtendimento.length, 0, 'anti-falso-positivo: "Entendemos que ... se enquadra" nao e atendimento');
    assert.ok(valido.marcadoresPedido.length >= 1, 'caso valido tem marcador de pedido');

    // Negativo: linguagem de atendimento ao consumidor.
    const atendimento = validarTextoModeracao('Prezado cliente, entendemos sua frustracao e pedimos desculpas pelo transtorno. Estamos a disposicao.');
    assert.strictEqual(atendimento.ok, false, 'texto de atendimento deve falhar');
    assert.ok(atendimento.linguagemAtendimento.length >= 1, 'detecta linguagem de atendimento');

    // Negativo: sem marcador de pedido de moderacao (mesmo sem atendimento).
    const semMarcador = validarTextoModeracao('Prezada equipe, o caso possui fundamentacao adequada e argumentacao consistente.');
    assert.strictEqual(semMarcador.ok, false, 'sem marcador de pedido deve falhar');
    assert.strictEqual(semMarcador.marcadoresPedido.length, 0, 'nao ha marcador de pedido');

    console.log('OK [validador-redacao] positivo/negativo/anti-falso-positivo');
}

(async () => {
    await cenario('happy-path', 0.9, false);
    await cenario('back-edge-por-confianca-baixa', 0.4, true);
    testesValidadorRedacao();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
