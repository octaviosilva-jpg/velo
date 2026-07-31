'use strict';

const { PROMPT_REFORMULADOR_VERSION } = require('./constants');

const ANTI_FABRICACAO =
    'PERMITIDO: reorganizar, explicitar fatos já disponíveis nos inputs (resposta original + DTO), melhorar clareza, ' +
    'enfrentar argumentos e fundamentar com informações recebidas. ' +
    'PROIBIDO: inventar comprovante, protocolo, documento, registro de envio, data ou horário inexistentes; ' +
    'transformar declaração em "comprovação"; afirmar evidência ausente nos inputs. O DTO não é fonte de fatos novos. ' +
    'Se a oportunidade depender de informação inexistente, NÃO materialize — melhore apenas o que for possível com o texto atual.';

function montarPromptReformulador({ respostaPublica, oportunidadesMelhoria }) {
    const itensJson = JSON.stringify(oportunidadesMelhoria?.itens || [], null, 2);

    return {
        version: PROMPT_REFORMULADOR_VERSION,
        system:
            'Você reformula o miolo da resposta pública da empresa no Reclame Aqui. Produza APENAS o texto reformulado (miolo), ' +
            'sem envelope, sem análise, sem justificativas, sem percentuais. Preserve nomes, datas e fatos existentes. ' +
            ANTI_FABRICACAO,
        user: `PROMPT REFORMULADOR (${PROMPT_REFORMULADOR_VERSION})

RESPOSTA PÚBLICA ORIGINAL (envelope completo — reformule apenas o miolo/conteúdo central, mantendo saudação e assinatura se presentes):
${respostaPublica}

OPORTUNIDADES DE MELHORIA (DTO estruturado — orientação textual; NÃO invente fatos):
${itensJson}

${ANTI_FABRICACAO}

Reescreva a resposta aplicando as ações do DTO sem fabricar evidência. Retorne somente o texto da resposta reformulada.`
    };
}

module.exports = { montarPromptReformulador, ANTI_FABRICACAO };
