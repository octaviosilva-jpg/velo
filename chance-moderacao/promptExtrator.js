'use strict';

const { PROMPT_EXTRATOR_VERSION } = require('./constants');

const REFORCO_EVIDENCIA =
    'REGRA evidencia_objetiva: classifique pela natureza factual e relação probatória/verificável com o fato controvertido, ' +
    'não pela força da redação. Mera data, horário, número, linguagem categórica ou descrição detalhada NÃO eleva o estado. ' +
    'Reorganizar a mesma declaração NÃO é evidência nova. Só conte elemento que individualize ou permita verificar concretamente ' +
    'o fato e que já esteja presente nos inputs. Não use regra mecânica só por presença/ausência de datas/números/protocolos.';

function montarPromptExtrator({ instrucaoEstados, reclamacao, respostaPublica, consideracaoFinal }) {
    const dadosCaso = [
        `RECLAMAÇÃO:\n${reclamacao}`,
        `\nRESPOSTA PÚBLICA:\n${respostaPublica}`,
        consideracaoFinal ? `\nCONSIDERAÇÃO FINAL:\n${consideracaoFinal}` : ''
    ].filter(Boolean).join('\n');

    return {
        version: PROMPT_EXTRATOR_VERSION,
        system:
            'Você é um auditor de moderação do Reclame Aqui. Classifique o caso em estados categóricos objetivos para o Motor de Pontuação. ' +
            'Responda APENAS com JSON válido, sem texto adicional. NÃO calcule porcentagem. NÃO escreva análise. ' +
            REFORCO_EVIDENCIA,
        user: `${instrucaoEstados}\n\n${REFORCO_EVIDENCIA}\n\n=== DADOS DO CASO ===\n${dadosCaso}`
    };
}

module.exports = { montarPromptExtrator, REFORCO_EVIDENCIA };
