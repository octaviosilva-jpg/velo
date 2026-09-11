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

// Ajuste 2026-09-11 (caso real 258599005, negado por CO06) — auditoria externa achou 3 falhas
// concretas na v2 original: abria citando o codigo como sujeito, redigia como defesa da empresa, e
// ignorava a consideracao final mesmo quando trazia fato novo. Confirma que as 3 regras corretivas
// estao presentes no prompt (nao valida geracao real, isso exigiria chamada paga).
function testPromptBuilderNaoAbreComCodigoComoSujeito() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({
        hipoteseSelecionada: {}, negativaReal: { motivoOficial: 'Divergência de Informações', codigo: 'CO06' }
    });
    assert.ok(system.includes('PROIBIDO') && system.includes('sujeito da frase'), 'system deve proibir abrir o texto com o codigo/motivo como sujeito da frase');
    assert.ok(user.includes('SEM abrir o paragrafo com o codigo/motivo'), 'instrucoes devem reforcar a proibicao de abrir citando o codigo');
    console.log('OK [unidade] redacao-reformulacao@v2 proibe abrir o texto citando o codigo da negativa como sujeito');
}

function testPromptBuilderProibeDefenderEmpresa() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({ hipoteseSelecionada: {}, negativaReal: {} });
    assert.ok(system.includes('nao deve soar como uma defesa da empresa') || system.includes('NAO deve soar como uma defesa'), 'system deve proibir tom de defesa da empresa');
    assert.ok(user.includes('PROIBIDO redigir como se estivesse defendendo a empresa'), 'instrucoes devem proibir redigir como defesa da empresa');
    console.log('OK [unidade] redacao-reformulacao@v2 proibe redigir como defesa da empresa');
}

function testPromptBuilderConsideracaoFinalCondicional() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({ hipoteseSelecionada: {}, negativaReal: {} });
    assert.ok(system.includes('CONSIDERACAO FINAL') && system.includes('NOVA'), 'system deve condicionar a consideracao final a fato/informacao nova');
    assert.ok(user.includes('Avalie sempre se a CONSIDERACAO FINAL'), 'instrucoes devem mandar sempre avaliar se ha alegacao nova (nao pular direto pra "sim/nao" sem checar)');
    console.log('OK [unidade] redacao-reformulacao@v2 torna a consideracao final condicional a fato novo (nao obrigatoria sempre)');
}

// Ajuste 2026-09-11 (2), mesmo caso real 258599005 rodado de novo apos o primeiro fix: a nota subiu
// de 3/10 pra 7/10, mas a auditoria achou que o texto afirmava "nao ha novos fatos" quando na
// verdade havia uma ALEGACAO nova nao verificada ("aguardar atualizacao do app") — afirmacao mais
// forte do que os dados permitem. Confirma que o prompt agora probe tratar alegacao como fato
// comprovado.
function testPromptBuilderNaoTrataAlegacaoComoFatoComprovado() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({ hipoteseSelecionada: {}, negativaReal: {} });
    assert.ok(system.includes('NUNCA trate a alegacao do consumidor como fato comprovado'), 'system deve proibir tratar a alegacao do consumidor como fato comprovado');
    assert.ok(user.includes('NUNCA trate a alegacao do consumidor como fato comprovado'), 'instrucoes devem proibir tratar a alegacao do consumidor como fato comprovado');
    console.log('OK [unidade] redacao-reformulacao@v2 proibe afirmar que uma alegacao nao verificada "nao e fato novo"');
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
                ...(holistica ? { houve_ganho_material: true } : {}),
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
    assert.strictEqual(state.houveGanhoMaterial, true, 'deve propagar houve_ganho_material do parsed pro state (sinal de observabilidade, 2026-09-11 rodada 3)');
    console.log(`OK [integracao-holistica] pipeline usou promptRef correto (${refsUsados.join(', ')}) e propagou houveGanhoMaterial`);
}

// Ajuste 2026-09-11 (3), mesma sequencia de auditoria: "houve_ganho_material" e so um sinal de
// observabilidade (nao controla a geracao) pra medir depois taxa de aceite quando a IA realmente
// achou ganho material vs. quando so reescreveu com estilo melhor. Confirma que falta na resposta
// da IA vira false (nunca undefined/erro) e que o prompt explica a regra de quando marcar true.
function testPromptBuilderExplicaRegraDoGanhoMaterial() {
    const { system, user } = REGISTRY['redacao-reformulacao@v2'].build({ hipoteseSelecionada: {}, negativaReal: {} });
    assert.ok(user.includes('houve_ganho_material') && user.includes('Melhorias so de tom, clareza, organizacao ou estilo NAO contam como ganho material'), 'instrucoes devem explicar quando houve_ganho_material e true vs false');
    console.log('OK [unidade] redacao-reformulacao@v2 explica a regra de quando houve_ganho_material e true');
}

function testToPartialDefaultFalseSemCampo() {
    const { REDACAO_REFORMULACAO_HOLISTICA } = require('../steps');
    const partial = REDACAO_REFORMULACAO_HOLISTICA.toPartial({ linha_raciocinio: 'x', texto_final: 'y' });
    assert.strictEqual(partial.houveGanhoMaterial, false, 'sem houve_ganho_material na resposta da IA, deve assumir false (nunca undefined)');
    console.log('OK [unidade] toPartial assume houveGanhoMaterial=false quando a IA nao retorna o campo');
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
    testPromptBuilderNaoAbreComCodigoComoSujeito();
    testPromptBuilderProibeDefenderEmpresa();
    testPromptBuilderConsideracaoFinalCondicional();
    testPromptBuilderNaoTrataAlegacaoComoFatoComprovado();
    testPromptBuilderExplicaRegraDoGanhoMaterial();
    testToPartialDefaultFalseSemCampo();
    await testPipelineHolisticaUsaPromptRefCorreto();
    await testPipelineV1ContinuaIntocado();
    console.log('TODOS OS CENARIOS PASSARAM');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
