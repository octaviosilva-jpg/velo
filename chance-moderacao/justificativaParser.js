'use strict';

/**
 * Parser da seção Justificativa dos Critérios do Motor (markdown Auditora → cards).
 * Suporta formato multilinha e flat (labels na mesma linha do ###, separados por vírgula).
 * Sem DTO justificativasCriterios[] (melhoria futura).
 */

const TEXTO_TETO = 'Não se aplica — critério já está na pontuação máxima.';

const CAMPOS = [
    { key: 'classificacao', labels: ['classificação', 'classificacao'] },
    { key: 'pontuacao', labels: ['pontuação', 'pontuacao'] },
    { key: 'trechoReclamacao', labels: ['trecho da reclamação', 'trecho da reclamacao'] },
    { key: 'trechoResposta', labels: ['trecho da resposta'] },
    { key: 'justificativaTecnica', labels: ['justificativa técnica', 'justificativa tecnica'] },
    {
        key: 'oQueReduziu',
        // Labels longos primeiro; alias curto aceito pela Auditora/mock.
        labels: ['o que reduziu a pontuação', 'o que reduziu a pontuacao', 'o que reduziu']
    },
    {
        key: 'comoAumentar',
        labels: ['como aumentar a pontuação', 'como aumentar a pontuacao', 'como aumentar']
    }
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

/** Campos em que N/A / teto pode ser humanizado para TEXTO_TETO. */
const CAMPOS_HUMANIZAR_TETO = new Set(['oQueReduziu', 'comoAumentar']);

/**
 * Detecta valor N/A / teto (apenas para oQueReduziu / comoAumentar).
 * Exige "N/A" ou "N / A" com barra — a palavra portuguesa "na" NÃO casa.
 */
function isNaTeto(valor) {
    const v = String(valor || '').toLowerCase().trim();
    if (!v) return false;
    return (
        /\bn\s*\/\s*a\b/.test(v) ||
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

/** Strip + humanização N/A só em oQueReduziu / comoAumentar. */
function valorCampoFinal(key, valor) {
    const limpo = stripMarkdownTokens(valor);
    if (CAMPOS_HUMANIZAR_TETO.has(key) && isNaTeto(limpo)) return TEXTO_TETO;
    return limpo;
}

/** Alternância de todos os labels estruturais (para lookahead). */
function allLabelsAlternation() {
    return CAMPOS.flatMap((c) => c.labels).map(escapeRegex).join('|');
}

/** Prefixo opcional de lista markdown antes de um label (`-`, `*`, `•`, `1.` …). */
const PREFIXO_LISTA_LABEL_REGEX = '(?:[-*•]\\s+|\\d+\\.\\s+)?';

/**
 * Encontra o primeiro label estrutural no texto (início, após newline ou após vírgula).
 * @returns {{ index: number, length: number, label: string }|null}
 */
function encontrarPrimeiroLabel(texto) {
    const alt = allLabelsAlternation();
    const re = new RegExp(
        `(?:^|[\\n,]\\s*)${PREFIXO_LISTA_LABEL_REGEX}(\\*?\\*?(?:${alt})\\*?\\*?)\\s*[:：]`,
        'i'
    );
    const m = re.exec(String(texto || ''));
    if (!m) return null;
    const labelPart = m[1];
    const labelOffsetInMatch = m[0].toLowerCase().lastIndexOf(labelPart.toLowerCase());
    return {
        index: m.index + Math.max(0, labelOffsetInMatch),
        length: labelPart.length,
        label: labelPart.replace(/\*/g, '').trim()
    };
}

/**
 * Separação nome/corpo: multilinha (primeira linha = nome) ou flat (antes do 1º label).
 */
function separarNomeECorpo(raw) {
    const texto = String(raw || '').trim();
    if (!texto) return { nome: 'Critério', corpo: '' };

    const primeiro = encontrarPrimeiroLabel(texto);
    if (primeiro && primeiro.index > 0) {
        const nome = stripMarkdownTokens(texto.slice(0, primeiro.index).replace(/[,\s]+$/, ''));
        const corpo = texto.slice(primeiro.index).replace(/^,\s*/, '');
        return { nome: nome || 'Critério', corpo };
    }

    const nl = texto.indexOf('\n');
    if (nl === -1) {
        return { nome: stripMarkdownTokens(texto) || 'Critério', corpo: '' };
    }
    return {
        nome: stripMarkdownTokens(texto.slice(0, nl)) || 'Critério',
        corpo: texto.slice(nl + 1)
    };
}

/**
 * Extrai valor de um campo; aceita label no início, após newline ou após vírgula.
 * Delimita pelo próximo label estrutural (não por split de vírgulas genérico).
 */
function extrairCampo(bloco, labels) {
    const alt = allLabelsAlternation();
    const fonte = String(bloco || '');
    for (const label of labels) {
        const re = new RegExp(
            `(?:^|[\\n,]\\s*)${PREFIXO_LISTA_LABEL_REGEX}\\*?\\*?${escapeRegex(label)}\\*?\\*?\\s*[:：]\\s*([\\s\\S]*?)(?=(?:[\\n,]\\s*${PREFIXO_LISTA_LABEL_REGEX}\\*?\\*?(?:${alt})\\*?\\*?\\s*[:：])|$)`,
            'i'
        );
        const m = fonte.match(re);
        if (m) {
            let val = m[1].trim();
            // Remove vírgula residual no fim se o próximo campo era o delimitador
            val = val.replace(/,\s*$/, '').trim();
            if (val) return val;
        }
    }
    return null;
}

function montarCampos(corpo) {
    const campos = {};
    let reconhecidos = 0;
    for (const { key, labels } of CAMPOS) {
        const val = extrairCampo(corpo, labels);
        if (val != null && String(val).trim()) {
            campos[key] = valorCampoFinal(key, val);
            reconhecidos += 1;
        } else {
            campos[key] = null;
        }
    }
    return { campos, reconhecidos };
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
        const { nome, corpo } = separarNomeECorpo(texto);
        const { campos, reconhecidos } = montarCampos(corpo || texto);
        if (reconhecidos === 0) {
            return [{
                nome: 'Justificativa',
                campos: null,
                textoBruto: stripMarkdownTokens(texto),
                parcial: true
            }];
        }
        return [{
            nome: nome === 'Critério' ? 'Justificativa' : nome,
            campos,
            textoBruto: stripMarkdownTokens(corpo || texto),
            parcial: reconhecidos < 3
        }];
    }

    const blocos = [];
    for (const parte of partes) {
        const raw = parte.trim();
        if (!raw) continue;

        const { nome, corpo } = separarNomeECorpo(raw);
        const fonteCampos = corpo || raw;
        const { campos, reconhecidos } = montarCampos(fonteCampos);

        if (reconhecidos === 0) {
            blocos.push({
                nome: nome || 'Critério',
                campos: null,
                textoBruto: stripMarkdownTokens(corpo || raw),
                parcial: true
            });
        } else {
            // Nome limpo: se ainda contiver labels, recortar
            let nomeFinal = nome;
            const labNoNome = encontrarPrimeiroLabel(nomeFinal);
            if (labNoNome && labNoNome.index > 0) {
                nomeFinal = stripMarkdownTokens(nomeFinal.slice(0, labNoNome.index).replace(/[,\s]+$/, ''));
            } else if (labNoNome && labNoNome.index === 0) {
                nomeFinal = 'Critério';
            }
            blocos.push({
                nome: nomeFinal || 'Critério',
                campos,
                textoBruto: stripMarkdownTokens(fonteCampos),
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
            // Graceful degradation: não repetir o mesmo texto no header e no body
            const bruto = item.textoBruto || '';
            if (bruto && bruto !== item.nome) {
                html += `<p class="small mb-0">${escapeHtml(bruto)}</p>`;
            } else if (!item.nome || item.nome === 'Critério' || item.nome === 'Justificativa') {
                html += `<p class="small mb-0">${escapeHtml(bruto)}</p>`;
            }
            // se nome === textoBruto, só o <strong> já exibe o conteúdo
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
                const bruto = item.textoBruto;
                if (bruto !== item.nome) {
                    html += `<p class="small text-muted mb-0">${escapeHtml(bruto)}</p>`;
                }
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    return html;
}

module.exports = {
    TEXTO_TETO,
    PREFIXO_LISTA_LABEL_REGEX,
    stripMarkdownTokens,
    parseJustificativaCriterios,
    renderJustificativaCriteriosHtml,
    humanizarCampo,
    isNaTeto,
    separarNomeECorpo,
    extrairCampo,
    encontrarPrimeiroLabel
};
