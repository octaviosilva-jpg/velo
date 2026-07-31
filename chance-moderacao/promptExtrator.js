'use strict';

const { PROMPT_EXTRATOR_VERSION } = require('./constants');

function montarPromptExtrator({ instrucaoEstados, reclamacao, respostaPublica, consideracaoFinal }) {
    const dadosCaso = [
        `RECLAMAÇÃO:\n${reclamacao}`,
        `\nRESPOSTA PÚBLICA:\n${respostaPublica}`,
        consideracaoFinal ? `\nCONSIDERAÇÃO FINAL:\n${consideracaoFinal}` : ''
    ].filter(Boolean).join('\n');

    return {
        version: PROMPT_EXTRATOR_VERSION,
        system: 'Você é um auditor de moderação do Reclame Aqui. Classifique o caso em estados categóricos objetivos para o Motor de Pontuação. Responda APENAS com JSON válido, sem texto adicional. NÃO calcule porcentagem. NÃO escreva análise.',
        user: `${instrucaoEstados}\n\n=== DADOS DO CASO ===\n${dadosCaso}`
    };
}

module.exports = { montarPromptExtrator };
