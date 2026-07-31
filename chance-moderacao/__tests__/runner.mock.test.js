'use strict';

const assert = require('assert');
const { runChanceModeracaoPipeline } = require('../runner');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');

const perfilMock = carregarPerfil('v1');

function buildRelatorioMock() {
    const blocosCriterios = Object.entries(perfilMock.criterios).map(([id, cfg]) => {
        const label = motorIntegracao.LABELS[id] || id;
        const estado = Object.keys(cfg.estados)[0];
        return `### ${label}\nClassificação: ${estado}\nPontuação: 0/${cfg.peso}\nTrecho da reclamação: "trecho"\nTrecho da resposta: "trecho"\nJustificativa técnica: mock\nO que reduziu: lacuna\nComo aumentar: ação. Critérios impactados: ${id}`;
    }).join('\n\n');

    return [
        '## Resultado Oficial do Motor',
        'Motor oficial aplicado.',
        '## Resumo Executivo',
        'Resumo objetivo do caso.',
        '## Justificativa dos Critérios do Motor',
        blocosCriterios,
        '## Tese Principal',
        'Tese principal mock.',
        '## Teses Complementares',
        'Nenhuma complementar.',
        '## Fundamentação Técnica',
        'Fundamentação técnica mock.',
        '## Pontos que reduziram a pontuação',
        'Lacuna identificada no critério clareza.',
        '## Como aumentar a pontuação',
        'Explicitar posição. Critérios impactados: clareza',
        '## Auditoria dos fatos',
        'Fatos auditados.',
        '## Clareza e Fundamentação',
        'Clareza media.',
        '## Calibração Histórica',
        'Sem referência histórica.',
        '## Auditoria de Consistência',
        'Resposta consistente com os fatos apresentados.'
    ].join('\n\n');
}

const OPORTUNIDADES_JSON = `
<!-- OPORTUNIDADES_MELHORIA_JSON -->
\`\`\`json
{"schemaVersion":"oportunidades-v1","itens":[{"id":"m1","criterioId":"clareza","criterioLabel":"Clareza","diagnostico":"d","acao":"a","criteriosImpactados":["clareza"]}]}
\`\`\``;

function estadosExtracao() {
    const perfil = carregarPerfil('v1');
    const estados = {};
    for (const c of Object.keys(perfil.criterios)) {
        estados[c] = 'media';
    }
    estados.cobertura_fato_principal = 'respondido_parcialmente';
    estados.clareza = 'media';
    return {
        auditoriaPlana: {
            estados,
            gates: { prazo: 'elegivel', resposta_generica: 'nao_generica' }
        },
        fundamentos: {},
        mapa_reclamacao: { fato_principal: 'teste' }
    };
}

let openaiCallIndex = 0;

function buildEstadosMock() {
    const estados = {};
    for (const [id, cfg] of Object.entries(perfilMock.criterios)) {
        const keys = Object.keys(cfg.estados);
        const estado = id === 'clareza' ? 'media' : keys[Math.min(1, keys.length - 1)];
        estados[id] = { estado, fundamento: 'mock', trechos_utilizados: { reclamacao: ['trecho'], resposta: ['trecho'] } };
    }
    return estados;
}

async function mockOpenaiStep({ messages }) {
    openaiCallIndex += 1;
    const user = messages.find((m) => m.role === 'user')?.content || '';
    if (user.includes('TAREFA: classificar')) {
        return {
            conteudo: JSON.stringify({
                mapa_reclamacao: { fato_principal: 'x', fatos_secundarios: [], pedidos_acessorios: [] },
                estados: buildEstadosMock(),
                gates: {
                    prazo: { estado: 'elegivel', fundamento: 'mock' },
                    resposta_generica: { estado: 'nao_generica', fundamento: 'mock' }
                },
                hipotese_escolhida: { titulo: 'nenhuma' },
                deficiencias: []
            }),
            usage: { prompt_tokens: 100, completion_tokens: 50 },
            duracaoMs: 10,
            custoEstimado: 0.001,
            model: 'mock'
        };
    }
    if (user.includes('AUDITORA TÉCNICA')) {
        return {
            conteudo: buildRelatorioMock() + OPORTUNIDADES_JSON,
            usage: { prompt_tokens: 200, completion_tokens: 300 },
            duracaoMs: 20,
            custoEstimado: 0.002,
            model: 'mock'
        };
    }
    if (user.includes('REFORMULADOR')) {
        return {
            conteudo: 'Miolo reformulado mock para teste.',
            usage: { prompt_tokens: 50, completion_tokens: 80 },
            duracaoMs: 15,
            custoEstimado: 0.001,
            model: 'mock'
        };
    }
    throw new Error('unexpected openai step: ' + user.slice(0, 80));
}

async function testFluxoCompletoMock() {
    openaiCallIndex = 0;
    const out = await runChanceModeracaoPipeline(
        {
            reclamacaoCompleta: 'Reclamação teste cliente insatisfeito',
            respostaPublica: 'Olá, Cliente! Resposta empresa teste.\n\nAtenciosamente,\nAgente',
            solucaoImplementada: 'Solução teste'
        },
        {
            apiKey: 'sk-test',
            envVars: {},
            openaiStep: mockOpenaiStep,
            montarInstrucaoEstados: motorIntegracao.montarInstrucaoEstados,
            carregarModeracoesAprovadasSimilares: async () => [],
            montarBlocoChanceModeracao: () => '',
            montarBlocoCalibracaoHistorica: () => '',
            formatarRespostaRA: (miolo, nomeCliente) => {
                const saudacao = nomeCliente && String(nomeCliente).trim() ? nomeCliente : 'cliente';
                return `Olá, ${saudacao}!\n\nFORMATADO:${miolo}`;
            },
            humanizarPontuacaoGerada: (t) => t,
            obterPrimeiroNomeUsuario: () => 'Agente'
        }
    );

    assert.strictEqual(out.sucesso, true);
    assert.ok(out.motor);
    assert.ok(out.result.includes('Resumo Executivo'));
    assert.ok(out.versions);
    assert.ok(['padrao', 'completo'].includes(out.telemetria.fluxo));
    assert.ok(out.telemetria.openaiCallCount === 2 || out.telemetria.openaiCallCount === 4);
    assert.ok(Array.isArray(out.telemetria.fluxoExecutado));
    assert.ok(out.telemetria.fluxoExecutado.includes('extrator-1'));
    assert.ok(out.telemetria.fluxoExecutado.includes('motor-1'));
    assert.ok(out.telemetria.fluxoExecutado.includes('auditora'));
    assert.ok(Array.isArray(out.telemetria.etapas));
    assert.ok(out.telemetria.etapas.some((e) => e.fluxoId === 'sheets_calibracao'));
    if (out.respostaReformulada) {
        assert.ok(out.respostaReformulada.includes('Olá, cliente!'), 'saudacao fixa sem heuristica');
        assert.ok(!out.respostaReformulada.includes('iniciante'));
    }
    assert.strictEqual(out.debugAuditora, null);
    console.log(`  runner mock fluxo=${out.telemetria.fluxo} openai=${out.telemetria.openaiCallCount} — OK`);
}

(async () => {
    await testFluxoCompletoMock();
    console.log('chance-moderacao/__tests__/runner.mock.test.js — OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
