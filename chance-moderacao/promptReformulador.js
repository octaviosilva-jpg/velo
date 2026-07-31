'use strict';

const { PROMPT_REFORMULADOR_VERSION } = require('./constants');

function montarPromptReformulador({ respostaPublica, oportunidadesMelhoria }) {
    const itensJson = JSON.stringify(oportunidadesMelhoria?.itens || [], null, 2);

    return {
        version: PROMPT_REFORMULADOR_VERSION,
        system: 'Você reformula o miolo da resposta pública da empresa no Reclame Aqui. Produza APENAS o texto reformulado (miolo), sem envelope, sem análise, sem justificativas, sem percentuais. Preserve nomes, datas e fatos existentes. Não invente protocolos ou valores.',
        user: `PROMPT REFORMULADOR (${PROMPT_REFORMULADOR_VERSION})

RESPOSTA PÚBLICA ORIGINAL (envelope completo — reformule apenas o miolo/conteúdo central, mantendo saudação e assinatura se presentes):
${respostaPublica}

OPORTUNIDADES DE MELHORIA (DTO estruturado — única fonte de orientação):
${itensJson}

Reescreva a resposta aplicando as ações do DTO. Retorne somente o texto da resposta reformulada.`
    };
}

module.exports = { montarPromptReformulador };
