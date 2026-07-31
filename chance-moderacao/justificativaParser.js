'use strict';

/**
 * Parser da seção Justificativa dos Critérios do Motor (markdown Auditora → cards).
 * Contrato atual: ### Nome + labels. Sem DTO justificativasCriterios[] (melhoria futura).
 * Graceful degradation: bloco sem labels → texto limpo.
 */

const TEXTO_TETO = 'Não se aplica — critério já está na pontuação máxima.';

const CAMPOS = [
    { key: 'classificacao', labels: ['classificação', 'classificacao'] },
    { key: 'pontuacao', labels: ['pontuação', 'pontuacao'] },
    { key: 'trechoReclamacao', labels: ['trecho da reclamação', 'trecho da reclamacao'] },
    { key: 'trechoResposta', labels: ['trecho da resposta'] },
    { key: 'justificativaTecnica', labels: ['justificativa técnica', 'justificativa tecnica'] },
    { key: 'oQueReduziu', labels: ['o que reduziu a pontuação', 'o que reduziu a pontuacao'] },
    { key: 'comoAumentar', labels: ['como aumentar a pontuação', 'como aumentar a pontuacao'] }
];

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkdownTokens(texto) {
    return String(texto || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/#{1,6}\s*/g, '')
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/`/g, '')
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isNaTeto(valor) {
    const v = String(valor || '').toLowerCase();
    if (!v) return false;
    return (
        /\bn\/?\s*a\b/.test(v) ||
        v.includes('pontuação máxima') ||
        v.includes('pontuacao maxima') ||
        v.includes('critério já no teto') ||
        v.includes('criterio ja no teto') ||
        v.includes('já está na pontuação máxima') ||
        v.includes('ja esta na pontuacao maxima')
    );
}

function humanizarCampo(valor) {
    const limpo = stripMarkdownTokens(valor);
    if (isNaTeto(limpo)) return TEXTO_TETO;
    return limpo;
}

function extrairCampo(bloco, labels) {
    const allLabels = CAMPOS.flatMap((c) => c.labels).map(escapeRegex).join('|');
    for (const label of labels) {
        const re = new RegExp(
            `(?:^|\\n)\\s*\\*?\\*?${escapeRegex(label)}\\*?\\*?\\s*[:：]\\s*([\\s\\S]*?)(?=(?:\\n\\s*\\*?\\*?(?:${allLabels})\\*?\\*?\\s*[:：])|$)`,
            'i'
        );
        const m = bloco.match(re);
        if (m) return m[1].trim();
    }
    return null;
}

/**
 * @returns {Array<{ nome: string, campos: object|null, textoBruto: string, parcial: boolean }>}
 */
function parseJustificativaCriterios(markdownSecao) {
    if (!markdownSecao || typeof markdownSecao !== 'string') return [];

    const texto = markdownSecao.trim();
    if (!texto) return [];

    const comecaComH3 = /^###\s+/m.test(texto);
    const partes = texto.split(/^###\s+/m).filter((p) => p.trim());

    if (!comecaComH3 || partes.length === 0) {
        return [{
            nome: 'Justificativa',
            campos: null,
            textoBruto: stripMarkdownTokens(texto),
            parcial: true
        }];
    }

    const blocos = [];
    for (const parte of partes) {
        const raw = parte.trim();
        if (!raw) continue;
        const nl = raw.indexOf('\n');
        const nome = stripMarkdownTokens(nl === -1 ? raw : raw.slice(0, nl));
        const corpo = nl === -1 ? '' : raw.slice(nl + 1);

        const campos = {};
        let reconhecidos = 0;
        for (const { key, labels } of CAMPOS) {
            const val = extrairCampo(corpo, labels);
            if (val != null && String(val).trim()) {
                campos[key] = humanizarCampo(val);
                reconhecidos += 1;
            } else {
                campos[key] = null;
            }
        }

        if (reconhecidos === 0) {
            blocos.push({
                nome: nome || 'Critério',
                campos: null,
                textoBruto: stripMarkdownTokens(corpo || raw),
                parcial: true
            });
        } else {
            blocos.push({
                nome: nome || 'Critério',
                campos,
                textoBruto: stripMarkdownTokens(corpo),
                parcial: reconhecidos < 3
            });
        }
    }

    return blocos.length
        ? blocos
        : [{
            nome: 'Justificativa',
            campos: null,
            textoBruto: stripMarkdownTokens(texto),
            parcial: true
        }];
}

function escapeHtml(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderCitacao(label, valor) {
    if (!valor) return '';
    return `<div class="mb-2"><div class="text-muted small fw-semibold">${escapeHtml(label)}</div>` +
        `<blockquote class="border-start border-3 border-secondary ps-3 mb-0 small fst-italic">${escapeHtml(valor)}</blockquote></div>`;
}

function renderCampoTexto(label, valor) {
    if (!valor) return '';
    return `<div class="mb-2"><div class="fw-semibold small">${escapeHtml(label)}</div>` +
        `<div class="small">${escapeHtml(valor)}</div></div>`;
}

/** HTML dos cards (sem ### / **). */
function renderJustificativaCriteriosHtml(markdownSecao) {
    const itens = parseJustificativaCriterios(markdownSecao);
    if (!itens.length) return '';

    let html = '<div class="justificativa-criterios">';
    for (const item of itens) {
        html += `<div class="card mb-2 border-light shadow-sm"><div class="card-header py-2 bg-light">` +
            `<strong>${escapeHtml(item.nome)}</strong></div><div class="card-body py-2">`;

        if (!item.campos) {
            html += `<p class="small mb-0">${escapeHtml(item.textoBruto)}</p>`;
        } else {
            const c = item.campos;
            if (c.classificacao || c.pontuacao) {
                html += '<p class="mb-2">';
                if (c.classificacao) {
                    html += `<span class="badge bg-secondary me-1">${escapeHtml(c.classificacao)}</span>`;
                }
                if (c.pontuacao) {
                    html += `<span class="badge bg-primary">${escapeHtml(c.pontuacao)}</span>`;
                }
                html += '</p>';
            }
            html += renderCitacao('Trecho da reclamação', c.trechoReclamacao);
            html += renderCitacao('Trecho da resposta', c.trechoResposta);
            html += renderCampoTexto('Justificativa técnica', c.justificativaTecnica);
            html += renderCampoTexto('O que reduziu a pontuação', c.oQueReduziu);
            html += renderCampoTexto('Como aumentar a pontuação', c.comoAumentar);
            if (item.parcial && item.textoBruto && !c.justificativaTecnica) {
                html += `<p class="small text-muted mb-0">${escapeHtml(item.textoBruto)}</p>`;
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    return html;
}

module.exports = {
    TEXTO_TETO,
    stripMarkdownTokens,
    parseJustificativaCriterios,
    renderJustificativaCriteriosHtml,
    humanizarCampo,
    isNaTeto
};
