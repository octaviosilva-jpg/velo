'use strict';

const assert = require('assert');
const { montarPromptAuditora } = require('../promptAuditora');
const { montarRelatorioFallbackAuditora, TEXTO_SEM_CAUSA_INDIV, montarOportunidadesFallback } = require('../montarRelatorioFallback');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');

const perfil = carregarPerfil('v1');

function promptText() {
    const p = montarPromptAuditora({
        reclamacao: 'Cliente questiona Y',
        respostaPublica: 'Empresa menciona X sobre pagamento',
        solucaoImplementada: '',
        consideracaoFinal: '',
        historicoModeracao: '',
        baseNormativa: '',
        baseCalibracaoHistorica: '',
        motorSerializado: {
            criterios: [
                { id: 'clareza', label: 'Clareza', estado: 'boa', pontos: 4, peso: 5, fator: 0.8 },
                { id: 'adequacao_hipotese', label: 'Adequacao da hipotese ao Manual', estado: 'forte', pontos: 15.3, peso: 18, fator: 0.85 },
                { id: 'evidencia_objetiva', label: 'Evidencia objetiva', estado: 'declaratoria', pontos: 4.8, peso: 16, fator: 0.3 }
            ],
            fundamentos: {
                clareza: { fundamento: 'Resposta compreensível.', trechos_utilizados: { resposta: ['texto claro'] } }
            }
        }
    });
    return `${p.system}\n${p.user}`;
}

function testJ1() {
    const t = promptText();
    assert.ok(/NÃO escrever "pequenas ambiguidades"|NÃO escrever .pequenas ambiguidades/i.test(t) || /só porque o estado é "boa"/i.test(t));
    assert.ok(/Não há causa textual específica individualizada/i.test(t));
    assert.ok(/Ausência de causa individualizada.*NÃO significa/i.test(t) || /NÃO significa erro do Motor/i.test(t));
    assert.ok(/Sem ação textual disponível com os dados fornecidos/i.test(t));
    assert.ok(/Sem situação \(2\).*itens|: \[\]/i.test(t) || /"itens": \[\]/i.test(t));
    console.log('  J1 Clareza sem fundamento concreto (contrato prompt) — OK');
}

function testJ2() {
    const t = promptText();
    assert.ok(/Só afirme deficiência textual\/factual concreta se localizar/i.test(t));
    assert.ok(/trecho\/característica|trechos_utilizados/i.test(t));
    assert.ok(/situação \(2\)|melhoria textual executável/i.test(t));
    console.log('  J2 Clareza com fundamento concreto permitido — OK');
}

function testJ3() {
    const t = promptText();
    assert.ok(/PROIBIDO causalidade cruzada/i.test(t));
    assert.ok(/adequacao_hipotese pela evidencia_objetiva|adequacao_hipotese.*evidencia_objetiva/i.test(t));
    console.log('  J3 Adequação não herda Evidência automaticamente — OK');
}

function testJ4() {
    const t = promptText();
    assert.ok(/salvo se fundamentos\[criterioAtual\]|fundamentos\[criterioAtual\] estabelecerem/i.test(t));
    console.log('  J4 Adequação com fundamento explícito permitido — OK');
}

function testJ5() {
    const t = promptText();
    assert.ok(/Nunca preencher "O que reduziu" só porque pontos < peso/i.test(t));
    assert.ok(/EVITAR:.*Não foi possível justificar|EVITAR:.*Motor não apresentou fundamento/i.test(t));
    assert.ok(/NÃO questione|não questionar a validade/i.test(t));
    console.log('  J5 sem inventar motivo + não questionar Motor — OK');
}

function testFallbackCausal() {
    const motorFake = {
        chance_final: 79,
        faixa_final: 'boa',
        validador: { status: 'ok', motivo: 'fixture' },
        metadados: {
            detalhe_criterios: {
                clareza: { estado: 'boa', pontos: 4, peso: 5 },
                evidencia_objetiva: { estado: 'declaratoria', pontos: 4.8, peso: 16 }
            },
            estados_consumidos: { calibracao_historica: 'sem_referencia' },
            historico_aplicado: 0,
            gates_ativados: [],
            score_base: 79,
            score_pos_historico: 79,
            score_pos_gates: 79
        }
    };
    const rel = montarRelatorioFallbackAuditora({
        resultadoMotor: motorFake,
        perfilVersao: 'v1',
        perfil,
        aviso: 'test'
    });
    assert.ok(rel.includes(TEXTO_SEM_CAUSA_INDIV));
    assert.ok(/classificou este critério como/i.test(rel));
    assert.ok(!/Não foi possível justificar a classificação/i.test(rel));
    assert.ok(!/Motor não apresentou fundamento/i.test(rel));
    assert.strictEqual(montarOportunidadesFallback(motorFake, perfil).itens.length, 0);
    console.log('  Fallback ausência de causa (sem questionar Motor) — OK');
}

function testEstruturaH3Prompt() {
    const t = promptText();
    assert.ok(/ÚNICOS headings H3 permitidos/i.test(t));
    assert.ok(/PROIBIDO: ### Critério —/i.test(t));
    console.log('  Prompt H3 só oficiais — OK');
}

testJ1();
testJ2();
testJ3();
testJ4();
testJ5();
testFallbackCausal();
testEstruturaH3Prompt();
console.log('justificativaCausalPrompt.test.js — OK');
