'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const motorIntegracao = require('../../motor-pontuacao/integracao');
const { montarPromptExtrator } = require('../promptExtrator');
const { montarPromptReformulador } = require('../promptReformulador');
const { montarPromptAuditora } = require('../promptAuditora');
const { montarOportunidadesFallback, montarRelatorioFallbackAuditora } = require('../montarRelatorioFallback');

const perfilPath = path.join(__dirname, '../../motor-pontuacao/perfil_calibracao_v1.json');
const perfil = JSON.parse(fs.readFileSync(perfilPath, 'utf8'));

function testCasosAB_guiaEPromptExtrator() {
    const guia = motorIntegracao.GUIA?.evidencia_objetiva || '';
    // GUIA pode não ser exportado — então via montarInstrucaoEstados
    const instrucao = motorIntegracao.montarInstrucaoEstados(perfil);
    const blob = `${guia}\n${instrucao}`;

    assert.ok(
        /relação probat[oó]ria|relacao probatoria|probatoria\/verificavel|PROBATÓRIA|PROBAToria/i.test(blob) ||
            /RELACAO PROBATORIA|relação probatória|relacao probatoria/i.test(blob),
        'GUIA/instrucao deve mencionar relação probatória'
    );
    assert.ok(/mera presenca de data|Mera data|data, horario/i.test(blob), 'anti-upgrade por data isolada');
    assert.ok(/MESMA declaracao|mesma declaração|Reorganizacao|Reorganizar/i.test(blob), 'anti-upgrade por redação');
    assert.ok(/NAO criar regra mecanica|Não use regra mecânica|regra mecanica/i.test(blob), 'sem regra mecânica');

    const prompt = montarPromptExtrator({
        instrucaoEstados: instrucao,
        reclamacao: 'r',
        respostaPublica: 'resp'
    });
    const text = `${prompt.system}\n${prompt.user}`;
    assert.ok(/relação probatória|relação probatoria|probatória\/verificável|probatória/i.test(text));
    assert.ok(/Mera data|mera data/i.test(text));
    assert.ok(/mesma declaração|Reorganizar a mesma/i.test(text));
}

function testCasoC_semClampRunner() {
    const runnerPath = path.join(__dirname, '../runner.js');
    const src = fs.readFileSync(runnerPath, 'utf8');
    assert.ok(!/evidenciaMotor2\s*<=\s*evidenciaMotor1/.test(src));
    assert.ok(!/clamp.*evidencia_objetiva/i.test(src));
    // Não deve sobrescrever evidencia_objetiva pós-Motor #2 com valor do #1
    assert.ok(
        !/estados\.evidencia_objetiva\s*=\s*.*extracao1|extracao\.evidencia_objetiva\s*=\s*extracao1/i.test(src),
        'runner não deve clonar evidencia_objetiva do Extrator #1 sobre #2'
    );
    assert.ok(
        !/sobrescrev\w*.*evidencia_objetiva|evidencia_objetiva.*sobrescrev/i.test(src),
        'sem sobrescrita explícita de evidencia_objetiva'
    );
}

function testCasoD_reformuladorAuditoraFallback() {
    const dtoFabricacao = {
        schemaVersion: '1',
        itens: [{
            id: 'melhoria-1',
            criterioId: 'evidencia_objetiva',
            criterioLabel: 'Evidência objetiva',
            diagnostico: 'Falta comprovante',
            acao: 'Adicionar comprovante de pagamento do reembolso',
            criteriosImpactados: ['evidencia_objetiva']
        }]
    };

    const ref = montarPromptReformulador({
        respostaPublica: 'Olá. Pagamos o valor.',
        oportunidadesMelhoria: dtoFabricacao
    });
    const refText = `${ref.system}\n${ref.user}`;
    assert.ok(/PROIBIDO|não invent|NÃO invent|nao invent/i.test(refText));
    assert.ok(/comprovante|protocolo|documento/i.test(refText));
    assert.ok(/NÃO materialize|nao materialize|não materializar/i.test(refText));
    // Mesmo com DTO pedindo comprovante, o prompt manda não materializar
    assert.ok(ref.user.includes('Adicionar comprovante'));
    assert.ok(/DTO não é fonte|DTO nao e fonte|NÃO invente fatos/i.test(refText));

    const aud = montarPromptAuditora({
        reclamacao: 'r',
        respostaPublica: 'resp',
        solucaoImplementada: '',
        consideracaoFinal: '',
        historicoModeracao: '',
        baseNormativa: '',
        baseCalibracaoHistorica: '',
        motorSerializado: { chance_final: 50 }
    });
    const audText = `${aud.system}\n${aud.user}`;
    assert.ok(/Sem ação textual disponível com os dados fornecidos/i.test(audText));
    assert.ok(/informação concreta nos inputs/i.test(audText));
    assert.ok(/PROIBIDO no DTO: pedir fabricação/i.test(audText));

    const motorFake = {
        chance_final: 40,
        faixa_final: 'baixa',
        validador: { status: 'ok', motivo: 'fixture' },
        metadados: {
            motor_versao: 'test',
            detalhe_criterios: {
                evidencia_objetiva: { estado: 'declaratoria', pontos: 4.8, peso: 16 },
                clareza: { estado: 'media', pontos: 2, peso: 4 }
            },
            estados_consumidos: { calibracao_historica: 'sem_referencia' },
            historico_aplicado: 0,
            gates_ativados: [],
            score_base: 40,
            score_pos_historico: 40,
            score_pos_gates: 40
        }
    };
    const ops = montarOportunidadesFallback(motorFake, perfil);
    assert.strictEqual(ops.itens.length, 0, 'fallback DTO vazio — sem oportunidades genéricas');

    const rel = montarRelatorioFallbackAuditora({
        resultadoMotor: motorFake,
        perfilVersao: 'v1',
        perfil,
        aviso: 'test'
    });
    assert.ok(!/Endereçar lacunas/i.test(rel));
    assert.ok(/Sem ação textual disponível com os dados fornecidos/i.test(rel));
}

testCasosAB_guiaEPromptExtrator();
testCasoC_semClampRunner();
testCasoD_reformuladorAuditoraFallback();
console.log('evidenciaEstabilidade.test.js OK');
