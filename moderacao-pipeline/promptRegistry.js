'use strict';

const crypto = require('crypto');

/**
 * Registro de prompts VERSIONADOS. Uma responsabilidade por prompt:
 *  - compreensao@v1: extrair fatos + conflito + cobertura (JSON). NAO decide hipotese.
 *  - decisao@v1: escolher UMA hipotese com autoauditoria adversarial (JSON). NAO redige.
 *  - redacao@v1: redigir linha de raciocinio + texto final (JSON). NAO reabre decisao.
 *
 * Os builders recebem blocos ja renderizados (manualBloco, universoHipoteses,
 * aprendizadoBloco) via ctx para manter baixo acoplamento com o server.js.
 */

function sha256(s) {
    return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

const REGISTRY = {
    'compreensao@v1': {
        id: 'compreensao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Voce e um extrator objetivo de fatos para analise de moderacao do Reclame Aqui. '
                + 'NAO interprete, NAO julgue, NAO consulte manuais, NAO escolha hipotese, NAO conclua. '
                + 'Apenas extraia o que esta explicito no conteudo. Responda SOMENTE com JSON valido.';
            const user = [
                'A partir do conteudo abaixo, extraia os dados objetivos.',
                '',
                `SOLICITACAO DO CLIENTE:\n${ctx.solicitacao || ''}`,
                `\nRESPOSTA DA EMPRESA:\n${ctx.resposta || ''}`,
                `\nCONSIDERACAO FINAL DO CONSUMIDOR:\n${ctx.consideracao || '(nao informada)'}`,
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "fatos_reclamacao": [ "..." ],',
                '  "pedidos_cliente": [ "..." ],',
                '  "acusacoes": [ "..." ],',
                '  "fatos_resposta": [ "..." ],',
                '  "solucoes_apresentadas": [ "..." ],',
                '  "consideracao_tipo": "insatisfacao|confirma|contradiz|novos_fatos|muda_assunto|incorreta|nao_informada",',
                '  "novos_fatos": [ "..." ],',
                '  "conflito_principal": "negativa de credito|publicidade/expectativa|cobranca|inadimplencia|renegociacao|fraude|pix|lgpd|descumprimento contratual|atendimento|seguro|restituicao|conta|outro",',
                '  "conflitos_secundarios": [ "..." ],',
                '  "confianca_conflito": 0.0,',
                '  "cobertura_resposta": [ { "alegacao": "...", "respondido": true, "tipo": "direto|indireto|parcial|nao", "trechoResposta": "..." } ]',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'decisao@v1': {
        id: 'decisao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Voce e um AUDITOR de moderacao do Reclame Aqui. Escolha a hipotese MAIS FORTE '
                + 'do Manual sustentada pelos FATOS deste caso (nao pelo motivo sugerido, nao por modelos anteriores). '
                + 'Estrutura obrigatoria: (1) levante candidatas, (2) tente DERRUBAR cada uma com evidencias contrarias, '
                + '(3) finalize escolhendo UMA. NAO redija o texto de moderacao. Responda SOMENTE com JSON valido.';
            const user = [
                'FATOS EXTRAIDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                'BASE NORMATIVA (Manual):',
                ctx.manualBloco || '(base normativa indisponivel)',
                '',
                'UNIVERSO DE HIPOTESES:',
                ctx.universoHipoteses || '(universo indisponivel)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "hipoteses_candidatas": [ { "hipotese": "...", "score": 0.0, "aderencia": "alta|media|baixa" } ],',
                '  "hipoteses_descartadas": [ { "hipotese": "...", "score": 0.0, "evidenciasFavoraveis": ["..."], "evidenciasContrarias": ["..."], "trechos": ["..."], "motivoDescarte": "..." } ],',
                '  "hipotese_selecionada": { "id": "...", "titulo": "...", "manual": "...", "comoCitar": "..." },',
                '  "justificativa": "...",',
                '  "trechos_sustentam": [ { "trecho": "...", "origem": "reclamacao|resposta|consideracao" } ],',
                '  "confianca": 0.0',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'redacao@v1': {
        id: 'redacao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Voce e um redator de solicitacoes de moderacao do Reclame Aqui. A hipotese JA foi decidida '
                + 'e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO escolha outra hipotese. '
                + 'Apenas redija. Nao use travessao nem hifen com espacos como pausa; prefira virgula ou ponto. '
                + 'Responda SOMENTE com JSON valido.';
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'Gere o texto final SEGUINDO EXATAMENTE o modelo de 3 paragrafos, iniciando com "Prezados,".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna do processo, consequencia da hipotese decidida",',
                '  "texto_final": "Prezados,\\n\\n... (3 paragrafos) ..."',
                '}'
            ].join('\n');
            return { system, user };
        }
    }
};

/** Retorna a entrada do registro (ex.: 'decisao@v1'). */
function getPrompt(ref) {
    const entry = REGISTRY[ref];
    if (!entry) throw new Error(`[promptRegistry] prompt inexistente: ${ref}`);
    return entry;
}

/** Renderiza o prompt e devolve tambem versao e hash para persistencia/reprodutibilidade. */
function render(ref, ctx) {
    const entry = getPrompt(ref);
    const { system, user } = entry.build(ctx || {});
    const hash = sha256(`${system}\n----\n${user}`);
    return {
        ref,
        promptId: entry.id,
        version: entry.version,
        responseFormat: entry.responseFormat,
        system,
        user,
        hash
    };
}

module.exports = { REGISTRY, getPrompt, render, sha256 };
