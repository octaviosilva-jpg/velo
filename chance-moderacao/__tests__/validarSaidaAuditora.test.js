'use strict';

const assert = require('assert');
const { validarSaidaAuditora } = require('../validarSaidaAuditora');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');

const perfil = carregarPerfil('v1');

function buildRelatorioMinimo(chancePct) {
    const blocos = Object.keys(perfil.criterios).map((id) => {
        const label = motorIntegracao.LABELS[id] || id;
        return `### ${label}\nClassificação: mock\nJustificativa técnica: ok.`;
    }).join('\n\n');

    return [
        '## Resultado Oficial do Motor',
        `Chance oficial: ${chancePct}%`,
        '## Resumo Executivo',
        'Resumo.',
        '## Justificativa dos Critérios do Motor',
        blocos,
        '## Tese Principal', 'Tese.',
        '## Teses Complementares', 'N/A.',
        '## Fundamentação Técnica', 'Fund.',
        '## Pontos que reduziram a pontuação', 'Pontos.',
        '## Como aumentar a pontuação', 'Ações.',
        '## Auditoria dos fatos', 'Fatos.',
        '## Clareza e Fundamentação', 'Clareza.',
        '## Calibração Histórica', 'Hist.',
        '## Auditoria de Consistência', 'OK.'
    ].join('\n\n');
}

const r1 = validarSaidaAuditora(buildRelatorioMinimo(72), perfil);
assert.strictEqual(r1.valido, true, r1.erros.join('; '));

const r2 = validarSaidaAuditora(
    buildRelatorioMinimo(72).replace('## Resumo Executivo', '## Resumo Executivo\nChance estimada: 80%'),
    perfil
);
assert.strictEqual(r2.valido, false);
assert.ok(r2.erros.some((e) => e.includes('percentual') || e.includes('estimativa')));

console.log('chance-moderacao/__tests__/validarSaidaAuditora.test.js — OK');
