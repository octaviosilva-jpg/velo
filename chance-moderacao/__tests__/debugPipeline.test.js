'use strict';

const assert = require('assert');
const { runChanceModeracaoPipeline } = require('../runner');
const { metadadosDebugAuditora } = require('../debug');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');

const perfilMock = carregarPerfil('v1');

function buildRelatorioInvalido() {
    return '## Resumo Executivo\nSó uma seção — inválido para validação estrutural.';
}

async function mockOpenaiStep({ messages }) {
    const user = messages.find((m) => m.role === 'user')?.content || '';
    if (user.includes('TAREFA: classificar')) {
        const estados = {};
        for (const [id, cfg] of Object.entries(perfilMock.criterios)) {
            const keys = Object.keys(cfg.estados);
            estados[id] = {
                estado: keys[Math.min(1, keys.length - 1)],
                fundamento: 'mock',
                trechos_utilizados: { reclamacao: ['t'], resposta: ['t'] }
            };
        }
        return {
            conteudo: JSON.stringify({
                mapa_reclamacao: { fato_principal: 'x', fatos_secundarios: [], pedidos_acessorios: [] },
                estados,
                gates: {
                    prazo: { estado: 'elegivel', fundamento: 'mock' },
                    resposta_generica: { estado: 'nao_generica', fundamento: 'mock' }
                },
                hipotese_escolhida: { titulo: 'nenhuma' },
                deficiencias: []
            }),
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            duracaoMs: 5,
            custoEstimado: 0.001,
            model: 'mock'
        };
    }
    // Auditora sempre inválida → fallback
    return {
        conteudo: buildRelatorioInvalido(),
        usage: { prompt_tokens: 20, completion_tokens: 20 },
        duracaoMs: 8,
        custoEstimado: 0.001,
        model: 'mock'
    };
}

const baseDeps = {
    apiKey: 'sk-test',
    openaiStep: mockOpenaiStep,
    carregarModeracoesAprovadasSimilares: async () => [],
    montarBlocoChanceModeracao: () => '',
    montarBlocoCalibracaoHistorica: () => '',
    formatarRespostaRA: (miolo, nomeCliente) => `Olá, ${nomeCliente || 'cliente'}!\n${miolo}`,
    humanizarPontuacaoGerada: (t) => t,
    obterPrimeiroNomeUsuario: () => 'Agente'
};

async function testDebugOnComFallback() {
    const out = await runChanceModeracaoPipeline(
        {
            reclamacaoCompleta: 'sou iniciante agora e quero cancelar',
            respostaPublica: 'Olá, cliente!\nResposta.\nAtenciosamente,\nAgente',
            debug: true
        },
        { ...baseDeps, envVars: { CHANCE_DEBUG: 'true' } }
    );

    assert.strictEqual(out.sucesso, true);
    assert.ok(out.debugAuditora);
    assert.strictEqual(out.debugAuditora.fallback, true);
    assert.ok(out.debugAuditora.motivoValidacao);
    assert.ok(out.debugAuditora.auditoraRaw);
    assert.ok(out.debugAuditora.auditoraRawHash);
    assert.ok(out.debugAuditora.errosPorTentativa.length >= 1);

    const meta = metadadosDebugAuditora(out.debugAuditora);
    assert.ok(!JSON.stringify(meta).includes('Resumo Executivo') || !meta.auditoraRaw);
    assert.strictEqual(meta.auditoraRaw, undefined);

    const etapaAud = out.telemetria.etapas.find((e) => e.fluxoId === 'auditora');
    assert.ok(etapaAud);
    assert.ok(Array.isArray(etapaAud.tentativas));
    assert.ok(etapaAud.tentativas.length >= 1);
    console.log('  debug on + fallback — OK');
}

async function testDebugOff() {
    const out = await runChanceModeracaoPipeline(
        {
            reclamacaoCompleta: 'reclamacao',
            respostaPublica: 'resposta',
            debug: false
        },
        { ...baseDeps, envVars: { NODE_ENV: 'production' } }
    );
    assert.strictEqual(out.debugAuditora, null);
    console.log('  debug off — OK');
}

(async () => {
    await testDebugOnComFallback();
    await testDebugOff();
    console.log('chance-moderacao/__tests__/debugPipeline.test.js — OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
