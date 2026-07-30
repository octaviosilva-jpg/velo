'use strict';

const { PRICES } = require('./constants');

function estimarCusto(model, usage) {
    if (!usage) return null;
    const p = PRICES[model] || PRICES['gpt-4o'];
    const inTok = usage.prompt_tokens || 0;
    const outTok = usage.completion_tokens || 0;
    const custo = (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
    return Number(custo.toFixed(6));
}

async function openaiStep({
    apiKey,
    baseUrl = 'https://api.openai.com/v1',
    model,
    temperature = 0,
    messages,
    responseFormat = null,
    maxTokens = 2000,
    timeoutMs = 60000
}) {
    if (!apiKey) throw new Error('[openaiStep] apiKey ausente');
    if (!model) throw new Error('[openaiStep] model ausente');
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('[openaiStep] messages ausente');

    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (responseFormat) body.response_format = { type: responseFormat };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let resp;
    try {
        resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
    const duracaoMs = Date.now() - started;

    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        const err = new Error(`[openaiStep] OpenAI ${resp.status}: ${String(txt).slice(0, 300)}`);
        err.status = resp.status;
        throw err;
    }

    const data = await resp.json();
    const conteudo = data?.choices?.[0]?.message?.content || '';
    const usage = data?.usage || null;
    const system = (messages.find(m => m.role === 'system') || {}).content || '';
    const user = (messages.find(m => m.role === 'user') || {}).content || '';

    return {
        conteudo,
        usage,
        duracaoMs,
        custoEstimado: estimarCusto(model, usage),
        model,
        temperature,
        promptRenderizado: { system, user },
        respostaCrua: data
    };
}

function parseJsonTolerante(conteudo) {
    if (!conteudo || typeof conteudo !== 'string') return null;
    let s = conteudo.trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(s);
    } catch (_) {
        const i = s.indexOf('{');
        const j = s.lastIndexOf('}');
        if (i !== -1 && j !== -1 && j > i) {
            try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { /* noop */ }
        }
        return null;
    }
}

module.exports = { openaiStep, estimarCusto, parseJsonTolerante };
