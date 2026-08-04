'use strict';

const assert = require('assert');
const { carregarPerfil } = require('../../motor-pontuacao/perfil');
const motorIntegracao = require('../../motor-pontuacao/integracao');
const { validarSaidaAuditora, validarCoerenciaPontuacaoTeto } = require('../validarSaidaAuditora');
const { validarOportunidadesMelhoria } = require('../validarOportunidadesMelhoria');
const { TEXTO_SEM_ACAO, TEXTO_SEM_CAUSA_INDIV } = require('../montarRelatorioFallback');
const {
    validarSemanticaJustificativa,
    validarSemanticaOportunidades,
    validarSemanticaMacro,
    pedidoInclusaoEvidencia,
    isEnunciadoDescritivo,
    ERRO_ADEQUACAO_EVIDENCIA,
    ERRO_EVIDENCIA_SEM_ANCORA,
    ERRO_EVIDENCIA_DTO_SEM_ANCORA,
    ERRO_INCOERENCIA_SEM_ACAO_DTO,
    ERRO_MACRO_ACAO_INCOERENTE,
    ERRO_MACRO_CAUSALIDADE,
    ERRO_MACRO_CLAREZA_EVIDENCIA
} = require('../validarSemanticaAuditora');

const perfil = carregarPerfil('v1');
const SEM_CAUSA = TEXTO_SEM_CAUSA_INDIV;
const SEM_ACAO = TEXTO_SEM_ACAO;
const TETO_REDUZIU = 'N/A — pontuação máxima';
const TETO_AUMENTAR = 'N/A — critério já no teto';
const LABEL_ADEQUACAO = motorIntegracao.LABELS.adequacao_hipotese;
const LABEL_EVIDENCIA = motorIntegracao.LABELS.evidencia_objetiva;
const LABEL_CLAREZA = motorIntegracao.LABELS.clareza;

const DEFAULTS = {
  clareza: { estado: 'boa', pontos: 4, peso: 5, fator: 0.8 },
  adequacao_hipotese: { estado: 'forte', pontos: 15.3, peso: 18, fator: 0.85 },
  evidencia_objetiva: { estado: 'declaratoria', pontos: 4.8, peso: 16, fator: 0.3 },
  cobertura_fato_principal: { estado: 'respondido_diretamente', pontos: 28, peso: 28, fator: 1 },
  qualidade_fundamentacao: { estado: 'boa', pontos: 5, peso: 5, fator: 1 }
};

function motorCompleto(extra = {}) {
  const criterios = Object.keys(perfil.criterios).map((id) => {
    const peso = perfil.criterios[id]?.peso ?? 1;
    const d = DEFAULTS[id] || { estado: 'respondido_diretamente', pontos: peso, peso, fator: 1 };
    return { id, label: motorIntegracao.LABELS[id] || id, fator: d.fator ?? 1, ...d };
  });
  return {
    criterios,
    fundamentos: {
      adequacao_hipotese: {
        fundamento: 'Enquadramento forte com base nos textos do caso.',
        trechos_utilizados: { resposta: ['Tratamos o nucleo da reclamacao.'] }
      },
      evidencia_objetiva: {
        fundamento: 'Resposta declarativa sem elementos verificaveis citados.',
        trechos_utilizados: { resposta: ['Informamos a situacao ao cliente.'] }
      }
    },
    ...extra
  };
}

function h3(label, opts = {}) {
  const o = {
    classificacao: 'mock', pontuacao: '1/1', trechoR: 'N/A', trechoS: 'N/A',
    justificativa: 'Justificativa explicativa.', reduziu: TETO_REDUZIU, aumentar: TETO_AUMENTAR,
    ...opts
  };
  return [
    `### ${label}`,
    `Classificação: ${o.classificacao}`,
    `Pontuação: ${o.pontuacao}`,
    `Trecho da reclamação: ${o.trechoR}`,
    `Trecho da resposta: ${o.trechoS}`,
    `Justificativa técnica: ${o.justificativa}`,
    `O que reduziu a pontuação: ${o.reduziu}`,
    `Como aumentar a pontuação: ${o.aumentar}`
  ].join('\n');
}

function blocosPadrao(overrideFn) {
  const motor = motorCompleto();
  return Object.keys(perfil.criterios).map((id) => {
    const label = motorIntegracao.LABELS[id] || id;
    const custom = overrideFn ? overrideFn(id, label) : null;
    if (custom) return custom;
    const c = motor.criterios.find((x) => x.id === id);
    const noTeto = c && Number(c.pontos) === Number(c.peso);
    return h3(label, {
      classificacao: c?.estado || 'mock',
      pontuacao: c ? `${c.pontos}/${c.peso}` : '1/1',
      reduziu: noTeto ? TETO_REDUZIU : SEM_CAUSA,
      aumentar: noTeto ? TETO_AUMENTAR : SEM_ACAO
    });
  }).join('\n\n');
}

function buildRelatorio(blocosJust, macro = {}) {
  return [
    '## Resultado Oficial do Motor', 'Chance oficial: 79%',
    '## Resumo Executivo', 'Resumo.',
    '## Justificativa dos Critérios do Motor', blocosJust,
    '## Tese Principal', 'Tese.', '## Teses Complementares', 'N/A.',
    '## Fundamentação Técnica', 'Fund.',
    '## Pontos que reduziram a pontuação', macro.pontos || 'Pontos.',
    '## Como aumentar a pontuação', macro.como || 'Ações.',
    '## Auditoria dos fatos', 'Fatos.',
    '## Clareza e Fundamentação', macro.clareza || 'Clareza.',
    '## Calibração Histórica', 'Hist.', '## Auditoria de Consistência', 'OK.'
  ].join('\n\n');
}

function blocoEvidencia(comoAumentar, reduziu = 'Falta de elementos objetivos verificaveis.') {
  return h3(LABEL_EVIDENCIA, {
    classificacao: 'declaratoria', pontuacao: '4.8/16',
    justificativa: 'Resposta baseada em declaracoes.',
    reduziu, aumentar: comoAumentar
  });
}

function rejeitaEvidenciaSemAncora(acao) {
  const motor = motorCompleto();
  const bloco = blocoEvidencia(acao);
  const erros = validarSemanticaJustificativa(bloco, motor, perfil, ctxBase());
  assert.ok(erros.some((e) => e.includes(ERRO_EVIDENCIA_SEM_ANCORA)), `Esperava rejeicao para: ${acao}`);
}

function ctxBase(extra = {}) {
  return { reclamacao: 'Cliente relata cobranca indevida.', respostaPublica: 'Empresa explica a situacao contratual.', ...extra };
}

function testE1() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_ADEQUACAO, { classificacao: 'forte', pontuacao: '15.3/18', justificativa: 'A resposta enfrentou o nucleo, mas nao apresentou evidencias objetivas.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
  const erros = validarSemanticaJustificativa(bloco, motor, perfil, ctxBase());
  assert.ok(erros.some((e) => e.includes(ERRO_ADEQUACAO_EVIDENCIA)));
  console.log('  E1 rejeita adequacao cross evidencia sem fundamento — OK');
}

function testE2() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_ADEQUACAO, { classificacao: 'forte', pontuacao: '15.3/18', justificativa: 'A existencia de pendencias contratuais impede acao imediata, considerado no enquadramento.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  E2 aceita pendencias contratuais — OK');
}

function testE3() {
  const motor = motorCompleto({ fundamentos: { adequacao_hipotese: { fundamento: 'Forte porque nao ha evidencia objetiva suficiente para muito_forte.', trechos_utilizados: {} } } });
  const bloco = h3(LABEL_ADEQUACAO, { classificacao: 'forte', pontuacao: '15.3/18', justificativa: 'Os fundamentos deste criterio indicam ausencia de evidencia objetiva para muito_forte.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  E3 aceita quando fundamento menciona evidencia — OK');
}

function testE4() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Resposta baseada em declaracoes.', reduziu: 'Falta de elementos verificaveis.', aumentar: 'Incluir evidencias objetivas.' });
  assert.ok(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).some((e) => e.includes(ERRO_EVIDENCIA_SEM_ANCORA)));
  console.log('  E4 rejeita incluir evidencias sem ancora — OK');
}

function testE5() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Resposta baseada em declaracoes sem elementos verificaveis.', reduziu: 'Falta de elementos verificaveis.', aumentar: SEM_ACAO });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  E5 aceita SEM_ACAO — OK');
}

function testE6() {
  const motor = motorCompleto();
  const dto = { schemaVersion: 'oportunidades-v1', itens: [{ id: 'm-ev', criterioId: 'evidencia_objetiva', criterioLabel: LABEL_EVIDENCIA, diagnostico: 'Declaracoes sem comprovacao.', acao: 'Incluir comprovante que sustente a afirmacao.', criteriosImpactados: ['evidencia_objetiva'] }] };
  assert.ok(validarSemanticaOportunidades(dto, motor, '', perfil, ctxBase()).some((e) => e.includes(ERRO_EVIDENCIA_DTO_SEM_ANCORA)));
  console.log('  E6 rejeita DTO sem ancora — OK');
}

function testE7() {
  const ctx = ctxBase({ respostaPublica: 'Protocolo de atendimento nº 12345 registrado em 10/07/2026.' });
  const motor = motorCompleto();
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Ha protocolo nos dados do caso.', reduziu: 'Elementos verificaveis nao citados.', aumentar: 'Incluir o protocolo nº 12345 na resposta.' });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctx).length, 0);
  console.log('  E7 aceita protocolo 12345 ancorado — OK');
}

function testE8() {
  const motor = motorCompleto({ fundamentos: { evidencia_objetiva: { fundamento: 'Comprovante de pagamento n 9876 disponivel nos autos internos.', trechos_utilizados: { solucao: ['Comprovante de pagamento n 9876'] } } } });
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Existe comprovante identificado nos fundamentos.', reduziu: 'Comprovante nao citado na resposta publica.', aumentar: 'Citar o comprovante de pagamento n 9876 na resposta.' });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  E8 aceita ancora em fundamento/trechos — OK');
}

function testE9() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Sem elementos verificaveis.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
  const rel = buildRelatorio(blocosPadrao((id) => (id === 'evidencia_objetiva' ? bloco : null)));
  const dto = { schemaVersion: 'oportunidades-v1', itens: [{ id: 'm-ev2', criterioId: 'evidencia_objetiva', criterioLabel: LABEL_EVIDENCIA, diagnostico: 'd', acao: 'Incluir evidencias objetivas.', criteriosImpactados: ['evidencia_objetiva'] }] };
  const r = validarOportunidadesMelhoria(dto, perfil, motor, rel, ctxBase());
  assert.ok(r.erros.some((e) => e.includes(ERRO_INCOERENCIA_SEM_ACAO_DTO)));
  console.log('  E9 rejeita SEM_ACAO markdown + DTO — OK');
}

function testE10() {
  const ctx = ctxBase({ respostaPublica: 'Protocolo n 55501 registrado.' });
  const motor = motorCompleto();
  const bloco = h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Protocolo disponivel.', reduziu: 'Protocolo nao citado.', aumentar: 'Incluir o protocolo n 55501 na resposta publica.' });
  const rel = buildRelatorio(blocosPadrao((id) => (id === 'evidencia_objetiva' ? bloco : null)));
  const dto = { schemaVersion: 'oportunidades-v1', itens: [{ id: 'm-ev3', criterioId: 'evidencia_objetiva', criterioLabel: LABEL_EVIDENCIA, diagnostico: 'Protocolo omitido.', acao: 'Incluir o protocolo n 55501 na resposta.', criteriosImpactados: ['evidencia_objetiva'] }] };
  const r = validarOportunidadesMelhoria(dto, perfil, motor, rel, ctx);
  assert.strictEqual(r.valido, true, r.erros.join('; '));
  console.log('  E10 aceita markdown + DTO ancorados — OK');
}

function testE11() {
  const motor = motorCompleto();
  const rel = buildRelatorio(blocosPadrao((id, label) => (id === 'clareza' ? h3(label, { classificacao: 'boa', pontuacao: '4/5', justificativa: 'Motor classificou clareza como boa, 4/5.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO }) : null)));
  const r = validarSaidaAuditora(rel, perfil, motor, ctxBase());
  assert.strictEqual(r.valido, true, r.erros.join('; '));
  console.log('  E11 clareza controle ainda passa — OK');
}

function testE12() {
  const motor = motorCompleto();
  const bloco = h3(LABEL_ADEQUACAO, { classificacao: 'forte', pontuacao: '15.3/18', trechoR: '"O cliente pediu evidencia do pagamento."', trechoS: '"Seguimos analise."', justificativa: 'Enquadramento forte sustentado pelos textos citados, coerente com os fundamentos disponiveis para adequacao.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  E12 trecho com evidencia nao gera falso positivo — OK');
}

function testE13() {
  const motor = motorCompleto({ criterios: Object.keys(perfil.criterios).map((id) => ({ id, label: motorIntegracao.LABELS[id] || id, estado: 'respondido_diretamente', pontos: perfil.criterios[id]?.peso ?? 1, peso: perfil.criterios[id]?.peso ?? 1, fator: 1 })) });
  const blocos = Object.keys(perfil.criterios).map((id) => { const label = motorIntegracao.LABELS[id] || id; const peso = perfil.criterios[id]?.peso ?? 1; return h3(label, { classificacao: 'respondido_diretamente', pontuacao: `${peso}/${peso}`, reduziu: TETO_REDUZIU, aumentar: TETO_AUMENTAR }); }).join('\n\n');
  const rel = buildRelatorio(blocos);
  assert.strictEqual(validarSaidaAuditora(rel, perfil, motor, ctxBase()).valido, true);
  assert.strictEqual(validarCoerenciaPontuacaoTeto(blocos, motor, perfil).length, 0);
  console.log('  E13 teto inalterado — OK');
}

function testL1() {
  rejeitaEvidenciaSemAncora('Fornecer detalhes verificáveis sobre as pendências contratuais.');
  console.log('  L1 fornecer detalhes verificaveis — REJEITA OK');
}

function testL2() {
  rejeitaEvidenciaSemAncora('Fornecer elementos objetivos verificáveis.');
  console.log('  L2 fornecer elementos objetivos verificaveis — REJEITA OK');
}

function testL3() {
  rejeitaEvidenciaSemAncora('A resposta poderia melhorar com a inclusão de evidências objetivas.');
  console.log('  L3 melhorar com inclusao de evidencias — REJEITA OK');
}

function testL4() {
  rejeitaEvidenciaSemAncora('Apresentar comprovante da operação.');
  console.log('  L4 apresentar comprovante sem ancora — REJEITA OK');
}

function testL5() {
  rejeitaEvidenciaSemAncora('Adicionar protocolo do atendimento.');
  console.log('  L5 adicionar protocolo sem ancora — REJEITA OK');
}

function testL6() {
  const motor = motorCompleto();
  const bloco = blocoEvidencia(SEM_ACAO, SEM_CAUSA);
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctxBase()).length, 0);
  console.log('  L6 SEM_ACAO — ACEITA OK');
}

function testL7() {
  const ctx = ctxBase({ respostaPublica: 'Protocolo nº 12345 registrado no atendimento.' });
  const motor = motorCompleto();
  const bloco = blocoEvidencia('Informar o protocolo nº 12345 na resposta.');
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctx).length, 0);
  console.log('  L7 protocolo 12345 ancorado — ACEITA OK');
}

function testL8() {
  const ctx = ctxBase({ solucaoImplementada: 'Documento interno registro n 778899 comprova a operacao.' });
  const motor = motorCompleto();
  const bloco = blocoEvidencia('Citar o registro n 778899 na resposta publica.');
  assert.strictEqual(validarSemanticaJustificativa(bloco, motor, perfil, ctx).length, 0);
  console.log('  L8 registro ancorado — ACEITA OK');
}

function testL9() {
  const frase = 'A resposta fornece detalhes sobre as pendências contratuais.';
  assert.strictEqual(pedidoInclusaoEvidencia(frase), false);
  assert.strictEqual(isEnunciadoDescritivo(frase), true);
  console.log('  L9 descritivo fornece detalhes — NAO detecta OK');
}

function testL10() {
  const frase = 'A resposta apresenta de forma clara a situação.';
  assert.strictEqual(pedidoInclusaoEvidencia(frase), false);
  console.log('  L10 apresenta de forma clara — NAO bloqueia OK');
}

function testL11_recomendatorioNaoDescritivo() {
  const frase = 'A resposta poderia ser melhorada fornecendo detalhes verificáveis.';
  assert.strictEqual(isEnunciadoDescritivo(frase), false);
  assert.strictEqual(pedidoInclusaoEvidencia(frase), true);
  console.log('  L11 recomendatorio nao libera falso descritivo — OK');
}

function blocosTesteB() {
  return blocosPadrao((id, label) => {
    if (id === 'adequacao_hipotese') {
      return h3(label, { classificacao: 'forte', pontuacao: '15.3/18', justificativa: 'Enquadramento forte sustentado pelos textos.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
    }
    if (id === 'evidencia_objetiva') {
      return h3(label, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Resposta declarativa sem elementos verificaveis citados.', reduziu: 'A falta de elementos objetivos verificaveis reduziu a pontuacao.', aumentar: SEM_ACAO });
    }
    if (id === 'clareza') {
      return h3(label, { classificacao: 'boa', pontuacao: '4/5', justificativa: 'Motor classificou clareza como boa, 4/5.', reduziu: SEM_CAUSA, aumentar: SEM_ACAO });
    }
    if (id === 'qualidade_fundamentacao') {
      return h3(label, { classificacao: 'boa', pontuacao: '5/5', justificativa: 'Fundamentacao no teto.', reduziu: TETO_REDUZIU, aumentar: TETO_AUMENTAR });
    }
    return null;
  });
}

function testM1_macroComoAumentarIncoerente() {
  const motor = motorCompleto();
  const blocos = blocosTesteB();
  const rel = buildRelatorio(blocos, {
    como: 'Para aumentar a pontuação, a Velotax poderia fornecer detalhes verificáveis sobre as pendências.'
  });
  const r = validarSaidaAuditora(rel, perfil, motor, ctxBase());
  assert.ok(!r.valido);
  assert.ok(r.erros.some((e) => e.includes(ERRO_MACRO_ACAO_INCOERENTE)));
  console.log('  M1 macro como aumentar incoerente — REJEITA OK');
}

function testM2_macroClarezaEvidenciaIndevida() {
  const motor = motorCompleto();
  const blocos = blocosTesteB();
  const rel = buildRelatorio(blocos, {
    clareza: 'A resposta foi clara e bem fundamentada, mas poderia ser melhorada com a inclusão de evidências objetivas.'
  });
  const r = validarSaidaAuditora(rel, perfil, motor, ctxBase());
  assert.ok(!r.valido);
  assert.ok(r.erros.some((e) => e.includes(ERRO_MACRO_CLAREZA_EVIDENCIA)));
  console.log('  M2 macro clareza evidencia indevida — REJEITA OK');
}

function testM3_macroCausalidadeAdequacao() {
  const motor = motorCompleto();
  const blocos = blocosTesteB();
  const rel = buildRelatorio(blocos, {
    pontos: 'A falta de evidências reduziu a Adequação da hipótese.'
  });
  const r = validarSaidaAuditora(rel, perfil, motor, ctxBase());
  assert.ok(!r.valido);
  assert.ok(r.erros.some((e) => e.includes(ERRO_MACRO_CAUSALIDADE)));
  console.log('  M3 macro causalidade adequacao — REJEITA OK');
}

function testM4_macroAceitavelEvidenciaCorreta() {
  const motor = motorCompleto();
  const blocos = blocosTesteB();
  const rel = buildRelatorio(blocos, {
    pontos: 'A ausência de elementos objetivos verificáveis reduziu o critério Evidência objetiva.',
    como: 'Não há ações textuais específicas disponíveis com os dados fornecidos.',
    clareza: 'A resposta foi clara e bem fundamentada, sem deficiência específica individualizada nesses critérios.'
  });
  const r = validarSaidaAuditora(rel, perfil, motor, ctxBase());
  assert.strictEqual(r.valido, true, r.erros.join('; '));
  console.log('  M4 macro coerente Teste B — ACEITA OK');
}

function testM5_macroComAncoraLegitima() {
  const ctx = ctxBase({ respostaPublica: 'Protocolo n 12345 registrado.' });
  const motor = motorCompleto();
  const blocos = blocosPadrao((id) => {
    if (id === 'evidencia_objetiva') {
      return h3(LABEL_EVIDENCIA, { classificacao: 'declaratoria', pontuacao: '4.8/16', justificativa: 'Protocolo disponivel.', reduziu: 'Protocolo nao citado.', aumentar: 'Informar o protocolo n 12345 na resposta.' });
    }
    return null;
  });
  const rel = buildRelatorio(blocos, {
    como: 'Informar o protocolo n 12345 na resposta publica.'
  });
  const r = validarSaidaAuditora(rel, perfil, motor, ctx);
  assert.strictEqual(r.valido, true, r.erros.join('; '));
  console.log('  M5 macro com ancora legitima — ACEITA OK');
}

testE1(); testE2(); testE3(); testE4(); testE5(); testE6(); testE7(); testE8(); testE9(); testE10(); testE11(); testE12(); testE13();
testL1(); testL2(); testL3(); testL4(); testL5(); testL6(); testL7(); testL8(); testL9(); testL10(); testL11_recomendatorioNaoDescritivo();
testM1_macroComoAumentarIncoerente(); testM2_macroClarezaEvidenciaIndevida(); testM3_macroCausalidadeAdequacao();
testM4_macroAceitavelEvidenciaCorreta(); testM5_macroComAncoraLegitima();
console.log('validarSemanticaAuditora.test.js — OK');
