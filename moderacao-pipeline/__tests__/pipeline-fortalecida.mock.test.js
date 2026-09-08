'use strict';

/**
 * Teste offline (SEM chamadas pagas) da variante FORTALECIDA da geração normal (1a tentativa)
 * (runPipelineFortalecida / REDACAO_FORTALECIDA), aditivo a pipeline.mock.test.js (que continua
 * cobrindo o caminho padrão intocado, REDACAO v2).
 * Executa: node moderacao-pipeline/__tests__/pipeline-fortalecida.mock.test.js
 *
 * Cobre: a redação da 1a tentativa recebe os critérios específicos do manual (quandoSeAplica +
 * criterios[]) pra hipótese já escolhida pela DECISAO, e o texto final demonstra esses critérios
 * explicitamente — em vez de só citar o nome da categoria, como o caminho padrão faz hoje.
 */

const assert = require('assert');
const { createWorkflowState } = require('../workflowState');
const { runPipelineFortalecida } = require('../orchestratorFortalecida');
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
                fatos_reclamacao: ['Cliente pede aumento de limite de credito'],
                pedidos_cliente: ['Anular a nota'],
                acusacoes: ['Empresa nega credito sem justificativa'],
                fatos_resposta: ['Empresa explica que a analise de credito e automatica e dinamica'],
                solucoes_apresentadas: ['Explicacao do processo de analise'],
                consideracao_tipo: 'contradiz',
                novos_fatos: [],
                conflito_principal: 'credito',
                conflitos_secundarios: [],
                confianca_conflito: 0.9,
                cobertura_resposta: [
                    { alegacao: 'Cliente pede aumento de limite de credito', respondido: true, tipo: 'direto', trechoResposta: 'analise de credito e automatica e dinamica' }
                ]
            });
        }

        if (sys.includes('AUDITOR de moderacao')) {
            return jsonResp({
                analise_holistica: {
                    nucleo_reclamacao: 'Cliente contesta a nao liberacao de credito',
                    conflitos: [{ conflito: 'Analise de credito negada', tipo: 'principal', respondido_pela_empresa: true, evidencia: 'analise automatica e dinamica' }],
                    leitura_consideracao_final: 'Cliente reitera insatisfacao com a negativa'
                },
                hipoteses_candidatas: [{ hipotese: 'analise-credito', score: 0.85, aderencia: 'alta' }],
                hipoteses_descartadas: [],
                hipotese_selecionada: { id: 'analise-credito', titulo: 'Analise de credito negada', manual: 'Manual Geral', comoCitar: 'conforme o Manual Geral de Moderacao, categoria AENV (analise de credito)' },
                justificativa: 'O conflito central e a negativa de credito, respondida pela empresa como processo automatico',
                trechos_sustentam: [{ trecho: 'analise de credito e automatica e dinamica', origem: 'resposta' }],
                confianca: 0.9
            });
        }

        if (sys.includes('DOCUMENTO DE FUNDAMENTACAO')) {
            // Confere que os criterios especificos da hipotese chegaram no prompt (o gap corrigido:
            // REDACAO v2 nunca recebia isso, so o comoCitar generico).
            assert.ok(user.includes('BASE NORMATIVA ESPECIFICA'), 'prompt de redacao@v3 deve ter a secao de base normativa especifica');
            assert.ok(user.includes('A aprovacao depende exclusivamente do perfil'), 'prompt deve conter o criterio especifico da hipotese');
            assert.ok(user.includes('Cliente reclama por nao conseguir contratar'), 'prompt deve conter o quandoSeAplica da hipotese');

            return jsonResp({
                linha_raciocinio: 'Demonstrei que a aprovacao depende exclusivamente do perfil financeiro do cliente, satisfazendo o criterio da hipotese analise-credito.',
                texto_final: 'Prezada equipe de moderacao do Reclame Aqui,\n\nA reclamacao se enquadra na hipotese de analise de credito negada, conforme o Manual Geral de Moderacao, categoria AENV (analise de credito).\n\nConforme o criterio especifico desta hipotese, a aprovacao depende exclusivamente do perfil e habitos financeiros do cliente, e a resposta publica confirma que a analise de credito e um processo automatico e dinamico, sem relacao com decisao arbitraria da empresa.\n\nA consideracao final do cliente nao contesta esse fato, apenas reitera insatisfacao com o resultado da analise.\n\nDiante do exposto, solicitamos a moderacao.'
            });
        }

        throw new Error(`prompt de sistema nao reconhecido pelo mock: ${sys.slice(0, 80)}`);
    };
}

async function cenarioRedacaoComCriteriosDoManual() {
    const state = createWorkflowState({
        idReclamacao: '999888',
        entradasCruas: {
            solicitacao: 'Pedi aumento do limite de credito e foi negado sem explicacao.',
            resposta: 'A analise de credito e automatica e dinamica, considerando o perfil financeiro do cliente.',
            consideracao: 'Continuo sem entender por que fui negado.'
        }
    });

    const deps = {
        apiKey: 'mock', confLimiar: 0.6, maxBackedges: 1,
        openaiStep: makeMock(),
        buildManualBloco: async () => 'BASE NORMATIVA MOCK',
        buildUniversoHipoteses: async () => 'UNIVERSO MOCK',
        buildAprendizado: async () => '',
        buildCriteriosHipotese: async () => ({
            quandoSeAplica: 'Cliente reclama por nao conseguir contratar/aumentar servico que depende de analise de credito (limite, financiamento).',
            criterios: ['A aprovacao depende exclusivamente do perfil/habitos financeiros do cliente']
        })
    };

    await runPipelineFortalecida(state, deps);

    assert.ok(state.hipoteseSelecionada, 'hipotese selecionada');
    assert.ok(state.textoFinal.includes('depende exclusivamente do perfil'), 'texto final demonstra o criterio especifico do manual, nao so a categoria');
    assert.ok(state.textoFinal.startsWith('Prezada equipe de moderacao'), 'texto final dirigido a equipe de moderacao');

    const val = validarTextoModeracao(state.textoFinal);
    assert.strictEqual(val.ok, true, `texto_final valido como pedido de moderacao (${JSON.stringify(val)})`);

    const mapped = resultMapper.mapToLegacyContract(state, { confLimiar: 0.6 });
    assert.ok(mapped.result.includes('(3) TEXTO FINAL DE MODERAÇÃO'), 'contrato legado continua funcionando com REDACAO_FORTALECIDA');

    console.log(`OK [redacao-com-criterios-do-manual] hipotese=${state.hipoteseSelecionada.id}`);
}

(async () => {
    await cenarioRedacaoComCriteriosDoManual();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
