'use strict';

/**
 * Teste offline (SEM chamadas pagas) da checagem adicional de elegibilidade de hipotese
 * (ver hipoteseElegibilidade.js), calibrado no caso real da reclamacao 256475367 (2026-09-09):
 * a DECISAO selecionou "reclamacao-outra-empresa" com Resposta Empresa preenchida, o que viola
 * o proprio criterio do manual pra essa hipotese ("so vale se NAO houver resposta publica").
 * Executa: node moderacao-pipeline/__tests__/hipotese-elegibilidade.mock.test.js
 *
 * Cobre: 1a tentativa (orchestratorFortalecida) faz backedge quando a 1a DECISAO erra assim, e
 * segue em frente (com hipotese diferente) na 2a tentativa — sem alterar validationGate.js nem
 * orchestrator.js.
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPipelineFortalecida } = require('../orchestratorFortalecida');
const { verificarElegibilidadeHipotese } = require('../hipoteseElegibilidade');

function jsonResp(obj) {
    return {
        conteudo: JSON.stringify(obj),
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        duracaoMs: 5, custoEstimado: 0.001, model: 'mock', temperature: 0,
        promptRenderizado: { system: '', user: '' }, respostaCrua: {}
    };
}

function unidade() {
    // hipotese incompativel (resposta publica existe) deve reprovar
    const semResposta = verificarElegibilidadeHipotese({
        hipoteseSelecionada: { id: 'reclamacao-outra-empresa', titulo: 'Reclamacao de outra empresa' },
        entradasCruas: { resposta: '' }
    });
    assert.strictEqual(semResposta.ok, true, 'sem resposta publica: hipotese permanece elegivel');

    const comResposta = verificarElegibilidadeHipotese({
        hipoteseSelecionada: { id: 'reclamacao-outra-empresa', titulo: 'Reclamacao de outra empresa' },
        entradasCruas: { resposta: 'Sou a Carol, especialista de atendimento do Velotax...' }
    });
    assert.strictEqual(comResposta.ok, false, 'com resposta publica: hipotese deve ser reprovada');
    assert.ok(comResposta.motivo.includes('resposta publica'), 'motivo explica a reprovacao');

    const outraHipotese = verificarElegibilidadeHipotese({
        hipoteseSelecionada: { id: 'analise-credito', titulo: 'Analise de credito negada' },
        entradasCruas: { resposta: 'Sou a Carol...' }
    });
    assert.strictEqual(outraHipotese.ok, true, 'hipoteses fora da lista nao sao afetadas');

    console.log('OK [unidade] verificarElegibilidadeHipotese');
}

function makeMockQueSempreEscolheOutraEmpresa() {
    let decisaoCount = 0;
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('extrator objetivo de fatos')) {
            return jsonResp({
                fatos_reclamacao: ['Cliente contratou seguro via Velotax em parceria com terceiro'],
                pedidos_cliente: ['Moderacao da reclamacao'],
                acusacoes: [], fatos_resposta: ['Empresa explica a cobertura do seguro'],
                solucoes_apresentadas: ['Explicacao'], consideracao_tipo: 'contradiz', novos_fatos: [],
                conflito_principal: 'seguro', conflitos_secundarios: [], confianca_conflito: 0.9,
                cobertura_resposta: [{ alegacao: 'Cliente contratou seguro via Velotax em parceria com terceiro', respondido: true, tipo: 'direto', trechoResposta: 'Empresa explica a cobertura do seguro' }]
            });
        }
        if (sys.includes('AUDITOR de moderacao')) {
            decisaoCount++;
            // 1a chamada: erra do mesmo jeito que o caso real (hipotese incompativel com resposta publica).
            // 2a chamada (apos backedge): "corrige", escolhendo outra hipotese.
            const hipotese = decisaoCount === 1
                ? { id: 'reclamacao-outra-empresa', titulo: 'Reclamacao de outra empresa', manual: 'Manual Geral', comoCitar: 'conforme o Manual Geral de Moderacao, categoria "Reclamacao de outra empresa"' }
                : { id: 'analise-credito', titulo: 'Analise de credito negada', manual: 'Manual Geral', comoCitar: 'conforme o Manual Geral de Moderacao' };
            return jsonResp({
                analise_holistica: {
                    nucleo_reclamacao: 'Cliente contesta cobertura de seguro contratado via Velotax',
                    conflitos: [{ conflito: 'Cobertura do seguro', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'Empresa explica a cobertura do seguro' }],
                    leitura_consideracao_final: 'Cliente reitera insatisfacao'
                },
                hipoteses_candidatas: [{ hipotese: hipotese.titulo, score: 0.8, aderencia: 'alta' }],
                hipoteses_descartadas: [],
                hipotese_selecionada: hipotese,
                justificativa: 'Justificativa mock', trechos_sustentam: [{ trecho: 'Empresa explica a cobertura do seguro', origem: 'resposta' }],
                confianca: 0.9
            });
        }
        if (sys.includes('DOCUMENTO DE FUNDAMENTACAO')) {
            return jsonResp({
                linha_raciocinio: 'Raciocinio mock',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nFundamentacao mock.\n\nDiante do exposto, solicitamos a moderacao.'
            });
        }
        throw new Error(`prompt de sistema nao reconhecido pelo mock: ${sys.slice(0, 80)}`);
    };
}

async function integracaoBackedge() {
    const state = createWorkflowState({
        idReclamacao: '256475367',
        entradasCruas: {
            solicitacao: 'Tenho um Seguro de Perda de Renda contratado via Velotax (em parceria com terceiro).',
            resposta: 'Sou a Carol, especialista de atendimento do Velotax no Reclame Aqui...',
            consideracao: 'Continuo sem solucao.'
        }
    });
    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMockQueSempreEscolheOutraEmpresa(),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => '',
        buildCriteriosHipotese: async () => ({})
    };

    await runPipelineFortalecida(state, deps);

    assert.strictEqual(state.hipoteseSelecionada.id, 'analise-credito', 'apos backedge, hipotese final NAO deve ser a incompativel');
    const backedges = (state.telemetria.find(t => t.node === 'TOTAL') || {}).backedges;
    assert.strictEqual(backedges, 1, 'deve ter ocorrido exatamente 1 backedge por causa da elegibilidade');
    const logBackedge = state.decisionLog.find(d => d.event === 'gate.backedge');
    assert.ok(logBackedge && logBackedge.reason.includes('resposta publica'), 'log do backedge deve citar o motivo de elegibilidade');

    console.log(`OK [integracao-backedge] hipotese inicial rejeitada, final=${state.hipoteseSelecionada.id}, backedges=${backedges}`);
}

(async () => {
    unidade();
    await integracaoBackedge();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
