'use strict';

/**
 * Validacao DETERMINISTICA (codigo, sem LLM) do texto final da Redacao (redacao@v2).
 *
 * Objetivo: garantir que o texto seja um PEDIDO DE MODERACAO dirigido ao analista do
 * Reclame Aqui, e NAO uma resposta/atendimento ao consumidor.
 *
 *  - Validacao NEGATIVA (context-aware): detecta linguagem de atendimento ao cliente.
 *    Nao veta "Entendemos que" generico, que e valido em argumentacao ao moderador
 *    (ex.: "Entendemos que a reclamacao se enquadra...").
 *  - Validacao POSITIVA: exige ao menos 1 marcador caracteristico de pedido de moderacao.
 *
 * ok = (sem linguagem de atendimento) E (>= 1 marcador de pedido).
 */

// Linguagem de atendimento ao consumidor (proibida). Regex sensiveis ao contexto.
const PADROES_ATENDIMENTO = [
    { rotulo: 'entendemos sua frustracao/transtorno/insatisfacao', re: /entendemos\s+(sua|seu|o|a)\s+(frustra|transtorno|insatisfa|inconvenien|aborrec|descontentamento)/i },
    { rotulo: 'lamentamos', re: /lamentamos/i },
    { rotulo: 'pedimos desculpas/desculpe', re: /pedimos\s+desculpas|desculpe/i },
    { rotulo: 'esperamos que sua questao seja resolvida', re: /esperamos\s+que\s+sua\s+quest/i },
    { rotulo: 'estamos a disposicao', re: /estamos\s+(a|à)\s+disposi/i },
    { rotulo: 'caso ainda tenha duvidas', re: /caso\s+ainda\s+tenha\s+d[uú]vidas/i },
    { rotulo: 'entre em contato conosco', re: /entre\s+em\s+contato\s+conosco/i },
    { rotulo: 'agradecemos por utilizar nossa plataforma', re: /agradecemos\s+por\s+(utilizar|usar)\s+(a\s+)?nossa\s+plataforma/i },
    { rotulo: 'recomendamos que entre em contato', re: /recomendamos\s+que\s+entre\s+em\s+contato/i },
    { rotulo: 'prezado cliente', re: /prezad[oa]\s+client/i }
];

// Marcadores de pedido de moderacao (deve haver ao menos 1).
const PADROES_PEDIDO = [
    { rotulo: 'solicitamos a moderacao', re: /solicitamos\s+a\s+modera/i },
    { rotulo: 'solicitamos a exclusao', re: /solicitamos\s+a\s+exclus/i },
    { rotulo: 'reclamacao se enquadra', re: /reclama[cç][aã]o\s+se\s+enquadra/i },
    { rotulo: 'conforme o Manual de Moderacao', re: /conforme\s+o\s+manual\s+de\s+modera/i },
    { rotulo: 'diante do exposto', re: /diante\s+do\s+exposto/i },
    { rotulo: 'por essas razoes solicitamos', re: /por\s+essas\s+raz[oõ]es,?\s+solicitamos/i }
];

/**
 * @param {string} texto Texto final da Redacao.
 * @returns {{ ok: boolean, linguagemAtendimento: string[], marcadoresPedido: string[] }}
 */
function validarTextoModeracao(texto) {
    const t = String(texto || '');
    const linguagemAtendimento = PADROES_ATENDIMENTO.filter(p => p.re.test(t)).map(p => p.rotulo);
    const marcadoresPedido = PADROES_PEDIDO.filter(p => p.re.test(t)).map(p => p.rotulo);
    const ok = linguagemAtendimento.length === 0 && marcadoresPedido.length >= 1;
    return { ok, linguagemAtendimento, marcadoresPedido };
}

module.exports = { validarTextoModeracao, PADROES_ATENDIMENTO, PADROES_PEDIDO };
