'use strict';

/**
 * Teste offline (SEM chamadas pagas) da reformulacao HOLISTICA (redacao-reformulacao@v2), calibrado
 * no caso real 258450515 (2026-09-10, negado por CO07 "Resposta Nao Condizente"). Confirma que:
 *  (a) o prompt builder de redacao-reformulacao@v2 recebe negativaReal.textoAnteriorModeracao e o
 *      inclui no texto enviado ao modelo (sem isso a reformulacao nao tem como comparar com a
 *      tentativa anterior e achar o que ficou de fora, que foi a falha observada no caso real);
 *  (b) runPipelineReformulacaoHolistica roda a state machine completa (COMPREENSAO ->
 *      DECISAO_REFORMULACAO -> REDACAO_REFORMULACAO_HOLISTICA) e usa o promptRef correto;
 *  (c) orchestratorReformulacaoV2.js (v1) continua produzindo redacao-reformulacao@v1 sem mudanca
 *      (garante que a nova variante nao afetou a existente).
 * Executa: node moderacao-pipeline/__tests__/reformulacao-holistica.mock.test.js
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPipelineReformulacaoHolistica } = require('../orchestratorReformulacaoHolistica');
const { runPipelineReformulacaoV2Melhorada } = require('../orchestratorReformulacaoV2');
const { REGISTRY } = require('../promptRegistry');

const TEXTO_TENTATIVA_ANTERIOR = "Prezada equipe de moderacao do Reclame Aqui,\n\nO caso em questao se enquadra na hipotese 'Cliente inadimplente que questiona juros'...";

function testPromptBuilderIncluiTextoAnterior() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({
        hipoteseSelecionada: { id: 'cliente-inadimplente-juros', titulo: 'Cliente inadimplente que questiona juros' },
        justificativa: 'Justificativa mock',
        trechosSustentam: [],
        analiseDecisao: {},
        solicitacao: 'Cliente alega juros abusivos',
        resposta: 'Empresa explica encargos por inadimplencia',
        consideracao: 'Cliente mantem insatisfacao',
        negativaReal: {
            motivoOficial: 'Resposta Não Condizente',
            codigo: 'CO07',
            regraOrientacao: 'A resposta deve esclarecer o caso de forma objetiva, com datas e acoes concretas.',
            textoAnteriorModeracao: TEXTO_TENTATIVA_ANTERIOR
        }
    });
    assert.ok(user.includes(TEXTO_TENTATIVA_ANTERIOR), 'user prompt deve incluir o texto literal da tentativa anterior');
    assert.ok(user.includes('TEXTO DA TENTATIVA ANTERIOR'), 'deve rotular o bloco da tentativa anterior');
    assert.ok(system.includes('DIAGNOSTICO'), 'system deve tratar a negativa como diagnostico, nao como unico alvo');
    assert.ok(system.includes('NAO deve se limitar a contestar ou refutar'), 'system deve proibir explicitamente se limitar a refutar o motivo');
    console.log('OK [unidade] redacao-reformulacao@v2 inclui texto da tentativa anterior e trata negativa como diagnostico');
}

function testPromptBuilderSemTextoAnteriorNaoQuebra() {
    const { user } = REGISTRY['redacao-reformulacao@v2'].build({
        hipoteseSelecionada: {}, negativaReal: {}
    });
    assert.ok(user.includes('nao disponivel'), 'sem textoAnteriorModeracao deve cair no fallback, sem quebrar');
    console.log('OK [unidade] redacao-reformulacao@v2 tolera negativaReal sem textoAnteriorModeracao');
}

function jsonResp(obj) {
    return {
        conteudo: JSON.stringify(obj),
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        duracaoMs: 5, custoEstimado: 0.001, model: 'mock', temperature: 0,
        promptRenderizado: { system: '', user: '' }, respostaCrua: {}
    };
}

function makeMock() {
    return async function mockStep({ messages }) {
        const sys = (messages[0] && messages[0].content) || '';
        if (sys.includes('extrator objetivo de fatos')) {
            return jsonResp({
                fatos_reclamacao: ['Cliente contesta juros sobre antecipacao de IR'],
                pedidos_cliente: ['Reanalise da moderacao'],
                acusacoes: [], fatos_resposta: ['Empresa explica encargos por inadimplencia'],
                solucoes_apresentadas: ['Negociacao'], consideracao_tipo: 'contradiz', novos_fatos: [],
                conflito_principal: 'cobranca', conflitos_secundarios: [], confianca_conflito: 0.9,
                cobertura_resposta: [{ alegacao: 'Cliente contesta juros sobre antecipacao de IR', respondido: true, tipo: 'direto', trechoResposta: 'Empresa explica encargos por inadimplencia' }]
            });
        }
        if (sys.includes('AUDITOR de moderacao') || sys.includes('auditoria adversarial') || sys.includes('reanalisar')) {
            return jsonResp({
                analise_holistica: {
                    nucleo_reclamacao: 'Cliente contesta juros sobre antecipacao de IR',
                    conflitos: [{ conflito: 'cobranca', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'Empresa explica encargos por inadimplencia' }],
                    leitura_consideracao_final: 'Cliente mantem insatisfacao'
                },
                hipoteses_candidatas: [{ hipotese: 'Cliente inadimplente que questiona juros', score: 0.9, aderencia: 'alta' }],
                hipoteses_descartadas: [],
                hipotese_selecionada: { id: 'cliente-inadimplente-juros', titulo: 'Cliente inadimplente que questiona juros', manual: 'Manual de Bancos', comoCitar: 'conforme o Manual de Moderacao de Bancos' },
                justificativa: 'Justificativa mock', trechos_sustentam: [{ trecho: 'Empresa explica encargos por inadimplencia', origem: 'resposta' }],
                confianca: 0.95,
                manteve_tese: true
            });
        }
        if (sys.includes('DOCUMENTO DE REANALISE') || sys.includes('DOCUMENTO DE REFUTACAO')) {
            const holistica = sys.includes('DIAGNOSTICO');
            return jsonResp({
                linha_raciocinio: holistica ? 'reavaliacao holistica mock' : 'refutacao mock',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nSolicitamos a reanalise...\n\nDiante do exposto, solicitamos o provimento desta reanalise.'
            });
        }
        throw new Error(`prompt de sistema nao reconhecido pelo mock: ${sys.slice(0, 80)}`);
    };
}

async function testPipelineHolisticaUsaPromptRefCorreto() {
    const state = createWorkflowState({
        idReclamacao: '258450515',
        entradasCruas: {
            solicitacao: 'Cliente alega juros abusivos sobre antecipacao de IR',
            resposta: 'Empresa explica encargos por inadimplencia',
            consideracao: 'Cliente mantem insatisfacao'
        },
        negativaReal: {
            motivoOficial: 'Resposta Não Condizente', codigo: 'CO07',
            textoAnteriorModeracao: TEXTO_TENTATIVA_ANTERIOR
        }
    });
    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMock(),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => ''
    };

    await runPipelineReformulacaoHolistica(state, deps);

    assert.ok(state.textoFinal && state.textoFinal.length > 0, 'deve gerar texto final');
    const refsUsados = (state.artefatos || []).map(a => a.ref).filter(Boolean);
    assert.ok(refsUsados.includes('redacao-reformulacao@v2'), `deve usar redacao-reformulacao@v2, usou: ${refsUsados.join(', ')}`);
    console.log(`OK [integracao-holistica] pipeline usou promptRef correto (${refsUsados.join(', ')})`);
}

async function testPipelineV1ContinuaIntocado() {
    const state = createWorkflowState({
        idReclamacao: '258450515',
        entradasCruas: {
            solicitacao: 'Cliente alega juros abusivos sobre antecipacao de IR',
            resposta: 'Empresa explica encargos por inadimplencia',
            consideracao: 'Cliente mantem insatisfacao'
        },
        negativaReal: { motivoOficial: 'Resposta Não Condizente', codigo: 'CO07' }
    });
    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMock(),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => ''
    };

    await runPipelineReformulacaoV2Melhorada(state, deps);

    const refsUsados = (state.artefatos || []).map(a => a.ref).filter(Boolean);
    assert.ok(refsUsados.includes('redacao-reformulacao@v1'), `v1 (existente) deve continuar usando redacao-reformulacao@v1, usou: ${refsUsados.join(', ')}`);
    console.log(`OK [regressao-v1] orchestratorReformulacaoV2 (existente) segue usando redacao-reformulacao@v1 sem alteracao`);
}

(async () => {
    testPromptBuilderIncluiTextoAnterior();
    testPromptBuilderSemTextoAnteriorNaoQuebra();
    await testPipelineHolisticaUsaPromptRefCorreto();
    await testPipelineV1ContinuaIntocado();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
