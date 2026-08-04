'use strict';

const { TEXTO_SEM_ACAO, TEXTO_SEM_CAUSA_INDIV } = require('./montarRelatorioFallback');
const { parseJustificativaCriterios, isNaTeto } = require('./justificativaParser');
const { validarSecoesAuditora } = require('./secoesV8');
const { LABELS } = require('../motor-pontuacao/integracao');

function normalizarHeadingCriterio(texto) {
    return String(texto || '')
        .replace(/^\[|\]$/g, '')
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/`+/g, '')
        .replace(/^\*+|\*+$/g, '')
        .replace(/^_+|_+$/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
        .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[^\w\s\-x]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function chavesOficiaisCriterio(criterioId, label) {
    const keys = new Set();
    const idN = normalizarHeadingCriterio(criterioId);
    const labelN = normalizarHeadingCriterio(label);
    if (idN) keys.add(idN);
    if (labelN) keys.add(labelN);
    return keys;
}

function mapaOficialNormParaId(perfil) {
    const mapa = new Map();
    for (const criterioId of Object.keys(perfil?.criterios || {})) {
        const label = LABELS[criterioId] || criterioId;
        for (const k of chavesOficiaisCriterio(criterioId, label)) {
            mapa.set(k, criterioId);
        }
    }
    return mapa;
}

const ERRO_ADEQUACAO_EVIDENCIA = 'adequacao_evidencia_sem_fundamento';
const ERRO_EVIDENCIA_SEM_ANCORA = 'evidencia_acao_sem_ancora';
const ERRO_EVIDENCIA_DTO_SEM_ANCORA = 'evidencia_dto_sem_ancora';
const ERRO_INCOERENCIA_SEM_ACAO_DTO = 'incoerencia_sem_acao_markdown_dto';
const ERRO_MACRO_ACAO_INCOERENTE = 'macro_acao_incoerente_h3';
const ERRO_MACRO_CAUSALIDADE = 'macro_causalidade_indevida';
const ERRO_MACRO_CLAREZA_EVIDENCIA = 'macro_clareza_evidencia_indevida';

function normalizarSemAcento(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function textoMencionaEvidencia(texto) {
    return /\bevidenc/.test(normalizarSemAcento(texto));
}

function coletarTextosTrechos(trechos) {
    const partes = [];
    if (!trechos || typeof trechos !== 'object') return partes;
    for (const val of Object.values(trechos)) {
        if (typeof val === 'string') partes.push(val);
        else if (Array.isArray(val)) {
            for (const x of val) {
                if (typeof x === 'string') partes.push(x);
            }
        } else if (val && typeof val === 'object') {
            partes.push(...coletarTextosTrechos(val));
        }
    }
    return partes;
}

function fundamentoAdequacaoAutorizaEvidencia(fundamentos) {
    const adeq = fundamentos?.adequacao_hipotese;
    if (!adeq) return false;
    if (textoMencionaEvidencia(adeq.fundamento)) return true;
    for (const t of coletarTextosTrechos(adeq.trechos_utilizados)) {
        if (textoMencionaEvidencia(t)) return true;
    }
    return false;
}

/** Padrões causais sobre evidência — aplicados em texto normalizado sem acentos. */
const PADROES_EVIDENCIA_CAUSAL = [
    /evidenc\w*\s+objetiv/,
    /evidencia_objetiva/,
    /\b(?:nao|sem|falta(?:m|de)?|ausencia)\b[^.\n;]{0,55}\bevidenc/,
    /\bevidenc\w*[^.\n;]{0,35}\b(?:objetiv\w*|comprov\w*|document\w*|verific\w*)/,
    /\bnao\s+apresentou\b[^.\n;]{0,35}\bevidenc/,
    /\b(?:porque|pois|devido\s+a)\b[^.\n;]{0,65}\bevidenc/,
    /\bfalt(?:aram|ou)\b[^.\n;]{0,35}\bevidenc/
];

function textoUsaEvidenciaCausalmente(texto) {
    const n = normalizarSemAcento(String(texto || '').trim());
    if (!n) return false;
    return PADROES_EVIDENCIA_CAUSAL.some((re) => re.test(n));
}

const VERBOS_PEDIDO =
    '(?:incluir|inclusao|inserir|adicionar|fornecer|apresentar|anexar|cit(?:ar|e)|mencionar|informar)';
const OBJETOS_VERIFICAVEIS =
    '(?:evidenc\\w*|comprov\\w*|document\\w*|protocol\\w*|registro\\w*|elementos?\\s+(?:objetivos?\\s+)?verific\\w*|detalhes?\\s+verific\\w*|informac\\w+\\s+verific\\w*)';

/** Marcadores de sugestão/recomendação — não tratar como enunciado descritivo. */
function isEnunciadoRecomendatorio(texto) {
    const n = normalizarSemAcento(texto);
    if (!n) return false;
    return /\b(?:poderia|deveria|seria recomendavel|recomenda(?:r|-se)|sugere(?:r|-se)|convém|convem|necessitaria|precisaria)\b/.test(n)
        || /\b(?:poderia|deveria)\s+(?:ser\s+)?melhorad/.test(n)
        || /\b(?:melhorar|melhorada)\s+(?:com|ao|se)\b/.test(n)
        || /\bpara\s+(?:aumentar|melhorar)\b/.test(n);
}

/**
 * Enunciado descritivo do conteúdo atual (não imperativo/recomendatório).
 * Distingue "A resposta fornece detalhes..." de "A resposta poderia ser melhorada fornecendo...".
 */
function isEnunciadoDescritivo(texto) {
    const n = normalizarSemAcento(texto);
    if (!n) return false;
    if (isEnunciadoRecomendatorio(texto)) return false;
    if (/\b(?:a resposta|o texto|a empresa|resposta publica)\s+(?:fornece|apresenta|informa|esclarece|descreve|detalha)\b/.test(n)) {
        return true;
    }
    if (/\b(?:foi|esta|e)\s+(?:clara|claro|bem fundamentad|compreensiv)/.test(n)) {
        return true;
    }
    if (/\b(?:fornece|apresenta)\s+(?:detalhes|elementos)\s+sobre\b/.test(n)) {
        return true;
    }
    if (/\bapresenta\s+de\s+forma\s+clara\b/.test(n)) {
        return true;
    }
    return false;
}

function montarPadroesPedidoInclusao() {
    return [
        new RegExp(`\\b${VERBOS_PEDIDO}\\b[^.;]{0,60}\\b${OBJETOS_VERIFICAVEIS}\\b`),
        new RegExp(`\\b(?:melhorar|melhorada|melhorar com)\\b[^.;]{0,45}\\b(?:a\\s+)?inclusao\\b[^.;]{0,40}\\b${OBJETOS_VERIFICAVEIS}\\b`),
        new RegExp(`\\binclusao\\s+(?:de\\s+)?${OBJETOS_VERIFICAVEIS}\\b`),
        new RegExp(`\\b${VERBOS_PEDIDO}\\b[^.;]{0,60}\\b(?:detalhes?|elementos?)\\s+verific\\w+\\b`),
        new RegExp(`\\b${VERBOS_PEDIDO}\\b[^.;]{0,60}\\b(?:detalhes?|elementos?)\\s+objetivos?\\s+verific\\w+\\b`),
        new RegExp(`\\b(?:poderia|deveria)\\s+(?:ser\\s+)?melhorad\\w+[^.;]{0,40}\\b${VERBOS_PEDIDO}\\b[^.;]{0,40}\\b${OBJETOS_VERIFICAVEIS}\\b`),
        new RegExp(`\\b(?:poderia|deveria)\\s+(?:ser\\s+)?melhorad\\w+[^.;]{0,50}\\b(?:detalhes?|elementos?)\\s+(?:objetivos?\\s+)?verific\\w+\\b`)
    ];
}

const PADROES_PEDIDO_INCLUSAO = montarPadroesPedidoInclusao();

function pedidoInclusaoEvidencia(texto) {
    const bruto = String(texto || '').trim();
    if (!bruto || isEnunciadoDescritivo(bruto)) return false;
    const n = normalizarSemAcento(bruto);
    return PADROES_PEDIDO_INCLUSAO.some((re) => re.test(n));
}

function extrairDigitosSignificativos(texto) {
    const nums = new Set();
    const re = /\d{3,}/g;
    let m;
    while ((m = re.exec(String(texto || ''))) !== null) {
        nums.add(m[0]);
    }
    return nums;
}

function extrairAncorasConcretas(corpus) {
    const fonte = String(corpus || '');
    const ancoras = new Set();
    if (!fonte.trim()) return [];
    const padroes = [
        /protocolo\s*(?:de\s+[\w\s]{0,30}?)?(?:n[ºo°.]?\s*)?\d[\d./-]*/gi,
        /comprovante\s*(?:de\s+[\w\s]{0,25})?[\w\s]{0,40}/gi,
        /cl[a\u00e1]usula\s*(?:n[ºo°.]?\s*)?\d+/gi,
        /registro\s*(?:n[ºo°.]?\s*)?\d+/gi,
        /documento\s*(?:n[ºo°.]?\s*)?\d+/gi,
        /n[ºo°.]\s*\d{3,}/gi
    ];
    for (const re of padroes) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(fonte)) !== null) {
            const frag = m[0].trim();
            if (frag.length >= 4) ancoras.add(frag);
        }
    }
    for (const d of extrairDigitosSignificativos(fonte)) ancoras.add(d);
    return [...ancoras];
}

function acaoReferenciaAncora(texto, ancoras) {
    const acao = String(texto || '');
    if (!acao.trim() || !ancoras?.length) return false;
    const acaoNorm = normalizarSemAcento(acao);
    for (const a of ancoras) {
        const frag = String(a || '').trim();
        if (frag.length >= 4 && acaoNorm.includes(normalizarSemAcento(frag))) return true;
    }
    const numsAcao = extrairDigitosSignificativos(acao);
    for (const a of ancoras) {
        for (const d of extrairDigitosSignificativos(a)) {
            if (numsAcao.has(d)) return true;
        }
    }
    return false;
}

function isSemAcaoTextual(valor) {
    const v = String(valor || '').trim();
    if (!v) return false;
    if (v === TEXTO_SEM_ACAO) return true;
    if (/sem\s+a[c\u00e7][a\u00e3]o\s+textual\s+dispon[i\u00ed]vel/i.test(v)) return true;
    return isNaTeto(v);
}

function isSemCausaTextual(valor) {
    const v = String(valor || '').trim();
    if (!v) return false;
    if (v === TEXTO_SEM_CAUSA_INDIV) return true;
    const n = normalizarSemAcento(v);
    return n.includes('nao ha causa textual especifica individualizada');
}

function coletarTextoFundamentos(fundamentos) {
    const partes = [];
    if (!fundamentos || typeof fundamentos !== 'object') return partes;
    for (const entry of Object.values(fundamentos)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.fundamento) partes.push(String(entry.fundamento));
        partes.push(...coletarTextosTrechos(entry.trechos_utilizados));
    }
    return partes;
}

function coletarCorpusInputs(motorSerializado, contextoCaso) {
    const ctx = contextoCaso || {};
    const partes = [
        ctx.reclamacao,
        ctx.respostaPublica,
        ctx.solucaoImplementada,
        ctx.consideracaoFinal,
        ctx.historicoModeracao,
        ctx.mapa_reclamacao ? JSON.stringify(ctx.mapa_reclamacao) : '',
        ...coletarTextoFundamentos(motorSerializado?.fundamentos),
        ...coletarTextoFundamentos(ctx.fundamentos)
    ];
    return partes.filter(Boolean).join('\n');
}

function criterioOficial(motorSerializado, criterioId) {
    return (motorSerializado?.criterios || []).find((c) => c.id === criterioId) || null;
}

function criterioNoTeto(oficial) {
    if (!oficial || oficial.pontos == null || oficial.peso == null) return false;
    return Number(oficial.pontos) === Number(oficial.peso);
}

function resolverCriterioId(nome, perfil) {
    return mapaOficialNormParaId(perfil).get(normalizarHeadingCriterio(nome)) || null;
}

function extrairConteudoJustificativa(input) {
    if (!input || typeof input !== 'string') return '';
    if (/^##\s+/m.test(input)) {
        const secoes = validarSecoesAuditora(input);
        return secoes.secoes['justificativa dos crit\u00e9rios do motor']?.conteudo || '';
    }
    return input;
}

function indexarCardsH3(conteudoJust, perfil, motorSerializado) {
    const cards = {};
    for (const item of parseJustificativaCriterios(conteudoJust || '')) {
        if (!item.campos) continue;
        const criterioId = resolverCriterioId(item.nome, perfil);
        if (!criterioId) continue;
        const oficial = criterioOficial(motorSerializado, criterioId);
        cards[criterioId] = {
            oQueReduziu: item.campos.oQueReduziu,
            comoAumentar: item.campos.comoAumentar,
            semCausa: isSemCausaTextual(item.campos.oQueReduziu),
            semAcao: isSemAcaoTextual(item.campos.comoAumentar),
            noTeto: criterioNoTeto(oficial)
        };
    }
    return cards;
}

function campoComoAumentarEvidencia(conteudoJust, perfil) {
    for (const item of parseJustificativaCriterios(conteudoJust)) {
        if (resolverCriterioId(item.nome, perfil) === 'evidencia_objetiva' && item.campos) {
            return item.campos.comoAumentar;
        }
    }
    return null;
}

function validarAcaoEvidenciaSemAncora(texto, ancoras) {
    return pedidoInclusaoEvidencia(texto) && !acaoReferenciaAncora(texto, ancoras);
}

function macroAtribuiEvidenciaAAdequacao(texto) {
    const n = normalizarSemAcento(texto);
    if (!n) return false;
    const mencionaAdeq = /\b(?:adequacao|hipotese|enquadramento)\b/.test(n);
    if (!mencionaAdeq) return false;
    if (textoUsaEvidenciaCausalmente(texto)) return true;
    return /\bevidenc/.test(n) && /\b(?:reduz|impact|limit|prejudic|falta|ausencia|sem)\b/.test(n);
}

function secaoSugereMelhoriaEvidencia(texto) {
    if (!texto || !String(texto).trim()) return false;
    if (pedidoInclusaoEvidencia(texto)) return true;
    const n = normalizarSemAcento(texto);
    return /\b(?:melhorar|melhorada|poderia ser melhorada)\b[^.;]{0,50}\bevidenc/.test(n);
}

function validarSemanticaJustificativa(conteudoJust, motorSerializado, perfil, contextoCaso) {
    const erros = [];
    if (!motorSerializado?.criterios?.length) return erros;
    const fundamentos = motorSerializado.fundamentos || contextoCaso?.fundamentos || null;
    const autorizaAdeq = fundamentoAdequacaoAutorizaEvidencia(fundamentos);
    const ancoras = extrairAncorasConcretas(coletarCorpusInputs(motorSerializado, contextoCaso));
    for (const item of parseJustificativaCriterios(conteudoJust || '')) {
        if (!item.campos) continue;
        const criterioId = resolverCriterioId(item.nome, perfil);
        if (!criterioId) continue;
        if (criterioId === 'adequacao_hipotese' && !autorizaAdeq) {
            const campos = [item.campos.justificativaTecnica, item.campos.oQueReduziu, item.campos.comoAumentar];
            if (campos.some((c) => c && textoUsaEvidenciaCausalmente(c))) {
                erros.push(`${ERRO_ADEQUACAO_EVIDENCIA}: N\u00e3o atribua defici\u00eancia de evid\u00eancia ao crit\u00e9rio Adequa\u00e7\u00e3o da hip\u00f3tese sem suporte expl\u00edcito no fundamento do pr\u00f3prio crit\u00e9rio.`);
            }
        }
        if (criterioId === 'evidencia_objetiva') {
            const oficial = criterioOficial(motorSerializado, criterioId);
            if (criterioNoTeto(oficial)) continue;
            const como = item.campos.comoAumentar;
            if (!como || isSemAcaoTextual(como)) continue;
            if (validarAcaoEvidenciaSemAncora(como, ancoras)) {
                erros.push(`${ERRO_EVIDENCIA_SEM_ANCORA}: N\u00e3o proponha inclus\u00e3o de evid\u00eancia/documento/comprovante inexistente nos dados fornecidos; use "${TEXTO_SEM_ACAO}" se n\u00e3o houver a\u00e7\u00e3o execut\u00e1vel.`);
            }
        }
    }
    return erros;
}

/**
 * Valida coerência das seções macro de risco com os cards H3 (SSoT qualitativo).
 */
function validarSemanticaMacro(markdown, conteudoJust, motorSerializado, perfil, contextoCaso) {
    const erros = [];
    if (!markdown || !motorSerializado?.criterios?.length) return erros;

    const secoes = validarSecoesAuditora(markdown).secoes;
    const secComo = secoes['como aumentar a pontuação']?.conteudo || '';
    const secPontos = secoes['pontos que reduziram a pontuação']?.conteudo || '';
    const secClareza = secoes['clareza e fundamentação']?.conteudo || '';

    const cards = indexarCardsH3(conteudoJust, perfil, motorSerializado);
    const ancoras = extrairAncorasConcretas(coletarCorpusInputs(motorSerializado, contextoCaso));
    const fundamentos = motorSerializado.fundamentos || contextoCaso?.fundamentos || null;
    const autorizaAdeq = fundamentoAdequacaoAutorizaEvidencia(fundamentos);

    const evCard = cards.evidencia_objetiva;
    const adeqCard = cards.adequacao_hipotese;
    const clarezaCard = cards.clareza;
    const qfCard = cards.qualidade_fundamentacao;

    if (secComo && validarAcaoEvidenciaSemAncora(secComo, ancoras)) {
        erros.push(`${ERRO_MACRO_ACAO_INCOERENTE}: A se\u00e7\u00e3o "Como aumentar a pontua\u00e7\u00e3o" n\u00e3o pode sugerir inclus\u00e3o de evid\u00eancia/comprovante sem \u00e2ncora quando os cards H3 indicam "${TEXTO_SEM_ACAO}".`);
    }
    if (evCard?.semAcao && secComo && secaoSugereMelhoriaEvidencia(secComo)) {
        erros.push(`${ERRO_MACRO_ACAO_INCOERENTE}: A se\u00e7\u00e3o "Como aumentar a pontua\u00e7\u00e3o" contradiz o card evidencia_objetiva (${TEXTO_SEM_ACAO}).`);
    }

    if (secPontos && !autorizaAdeq && adeqCard?.semCausa && macroAtribuiEvidenciaAAdequacao(secPontos)) {
        erros.push(`${ERRO_MACRO_CAUSALIDADE}: A se\u00e7\u00e3o "Pontos que reduziram a pontua\u00e7\u00e3o" n\u00e3o pode atribuir defici\u00eancia de evid\u00eancia \u00e0 Adequa\u00e7\u00e3o quando o card correspondente indica aus\u00eancia de causa individualizada.`);
    }

    const clarezaSemDeficiencia = clarezaCard?.semCausa && clarezaCard?.semAcao;
    const qfNoTeto = qfCard?.noTeto;
    if (secClareza && clarezaSemDeficiencia && qfNoTeto && secaoSugereMelhoriaEvidencia(secClareza)) {
        erros.push(`${ERRO_MACRO_CLAREZA_EVIDENCIA}: A se\u00e7\u00e3o "Clareza e Fundamenta\u00e7\u00e3o" n\u00e3o pode sugerir inclus\u00e3o de evid\u00eancias objetivas quando Clareza est\u00e1 sem causa/a\u00e7\u00e3o individualizada e Qualidade da fundamenta\u00e7\u00e3o est\u00e1 no teto.`);
    }

    return erros;
}

function validarSemanticaOportunidades(dto, motorSerializado, conteudoJust, perfil, contextoCaso) {
    const erros = [];
    if (!dto?.itens?.length) return erros;
    const ancoras = extrairAncorasConcretas(coletarCorpusInputs(motorSerializado, contextoCaso));
    const comoMd = campoComoAumentarEvidencia(extrairConteudoJustificativa(conteudoJust), perfil);
    const itensEvid = dto.itens.filter((i) => i.criterioId === 'evidencia_objetiva');
    if (comoMd && isSemAcaoTextual(comoMd) && itensEvid.length > 0) {
        erros.push(`${ERRO_INCOERENCIA_SEM_ACAO_DTO}: Markdown indica sem a\u00e7\u00e3o textual para evidencia_objetiva, mas o DTO A16 cont\u00e9m oportunidade para esse crit\u00e9rio.`);
    }
    for (const item of itensEvid) {
        const textoItem = `${item.diagnostico || ''} ${item.acao || ''}`;
        if (validarAcaoEvidenciaSemAncora(textoItem, ancoras)) {
            erros.push(`${ERRO_EVIDENCIA_DTO_SEM_ANCORA}: Oportunidade de evidencia_objetiva pede inclus\u00e3o de material sem \u00e2ncora concreta nos inputs.`);
        }
    }
    return erros;
}

module.exports = {
    ERRO_ADEQUACAO_EVIDENCIA,
    ERRO_EVIDENCIA_SEM_ANCORA,
    ERRO_EVIDENCIA_DTO_SEM_ANCORA,
    ERRO_INCOERENCIA_SEM_ACAO_DTO,
    ERRO_MACRO_ACAO_INCOERENTE,
    ERRO_MACRO_CAUSALIDADE,
    ERRO_MACRO_CLAREZA_EVIDENCIA,
    fundamentoAdequacaoAutorizaEvidencia,
    textoUsaEvidenciaCausalmente,
    pedidoInclusaoEvidencia,
    isEnunciadoDescritivo,
    isEnunciadoRecomendatorio,
    extrairAncorasConcretas,
    acaoReferenciaAncora,
    isSemAcaoTextual,
    isSemCausaTextual,
    coletarCorpusInputs,
    validarSemanticaJustificativa,
    validarSemanticaMacro,
    validarSemanticaOportunidades
};
