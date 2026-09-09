'use strict';

/**
 * Relatório por e-mail dos testes automáticos periódicos (moderação 1a tentativa, reformulação,
 * geração de resposta + aprendizado, saúde geral dos flags). A COLETA dos dados/execução dos
 * pipelines fica em server.js (tem acesso direto às funções/planilha já existentes); este arquivo
 * só formata o relatório e envia o e-mail — mesmo padrão de separação de email-lembretes.js.
 *
 * Nenhuma escrita na planilha acontece aqui. Ver rodarTestesAutomaticosCompletos em server.js.
 */

const DESTINATARIOS_PADRAO = [
    'casos.especiais@velotax.com.br',
    'Emerson.jose@velotax.com.br',
    'octavio.silva@velotax.com.br'
];

function parseDestinatarios(raw) {
    return String(raw || '')
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function obterConfigEmailTeste() {
    const destinatarios = process.env.TESTE_AUTOMATICO_EMAIL_DESTINATARIOS
        ? parseDestinatarios(process.env.TESTE_AUTOMATICO_EMAIL_DESTINATARIOS)
        : DESTINATARIOS_PADRAO;
    const from = (process.env.LEMBRETE_EMAIL_FROM || process.env.SMTP_USER || '').trim();
    let provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const temSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const temResend = !!process.env.RESEND_API_KEY;
    if (!provider) {
        if (temSmtp) provider = 'smtp';
        else if (temResend) provider = 'resend';
    }
    const configurado = destinatarios.length > 0 && from && (provider === 'smtp' ? temSmtp : provider === 'resend' ? temResend : false);
    return { configurado, destinatarios, from, provider };
}

const STATUS_EMOJI = { ok: '✅', alerta: '⚠️', erro: '❌', sem_dados: 'ℹ️' };
const STATUS_LABEL = { ok: 'OK', alerta: 'Atenção', erro: 'Erro', sem_dados: 'Sem dados' };

function piorStatus(statuses) {
    const ordem = ['erro', 'alerta', 'sem_dados', 'ok'];
    for (const s of ordem) if (statuses.includes(s)) return s;
    return 'ok';
}

function truncar(texto, max = 900) {
    const t = String(texto || '').trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + '… (truncado)';
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatarSecaoTexto(titulo, teste) {
    const linhas = [`${STATUS_EMOJI[teste.status] || ''} ${titulo} — ${STATUS_LABEL[teste.status] || teste.status}`];
    if (teste.caso) linhas.push(`Caso testado: ${teste.caso}`);
    if (teste.resumo) linhas.push(teste.resumo);
    if (Array.isArray(teste.checks) && teste.checks.length) {
        linhas.push('Checagens:');
        teste.checks.forEach(c => linhas.push(`  ${c.ok ? 'OK' : 'FALHOU'} — ${c.label}${c.detalhe ? ' (' + c.detalhe + ')' : ''}`));
    }
    if (teste.erro) linhas.push(`Erro: ${teste.erro}`);
    if (teste.amostraOutputGerado) linhas.push(`\nTrecho gerado agora:\n"${truncar(teste.amostraOutputGerado, 500)}"`);
    if (teste.amostraOutputReal) linhas.push(`\nTrecho real (referência histórica):\n"${truncar(teste.amostraOutputReal, 500)}"`);
    return linhas.join('\n');
}

function formatarSecaoHtml(titulo, teste) {
    const cor = { ok: '#1a7f37', alerta: '#9a6700', erro: '#cf222e', sem_dados: '#57606a' }[teste.status] || '#333';
    let html = `<h3 style="margin-bottom:4px;">${STATUS_EMOJI[teste.status] || ''} ${escapeHtml(titulo)} — <span style="color:${cor};">${STATUS_LABEL[teste.status] || teste.status}</span></h3>`;
    if (teste.caso) html += `<p style="margin:2px 0;"><strong>Caso testado:</strong> ${escapeHtml(teste.caso)}</p>`;
    if (teste.resumo) html += `<p style="margin:2px 0;">${escapeHtml(teste.resumo)}</p>`;
    if (Array.isArray(teste.checks) && teste.checks.length) {
        html += '<ul style="margin:4px 0;">';
        teste.checks.forEach(c => {
            html += `<li>${c.ok ? '✅' : '❌'} ${escapeHtml(c.label)}${c.detalhe ? ' — <em>' + escapeHtml(c.detalhe) + '</em>' : ''}</li>`;
        });
        html += '</ul>';
    }
    if (teste.erro) html += `<p style="color:#cf222e;margin:2px 0;"><strong>Erro:</strong> ${escapeHtml(teste.erro)}</p>`;
    if (teste.amostraOutputGerado) {
        html += `<p style="margin:8px 0 2px;"><strong>Trecho gerado agora:</strong></p><pre style="white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:12px;">${escapeHtml(truncar(teste.amostraOutputGerado, 500))}</pre>`;
    }
    if (teste.amostraOutputReal) {
        html += `<p style="margin:8px 0 2px;"><strong>Trecho real (referência histórica):</strong></p><pre style="white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:12px;">${escapeHtml(truncar(teste.amostraOutputReal, 500))}</pre>`;
    }
    return html;
}

/** Monta assunto/texto/html do relatório a partir do resultado coletado em server.js. */
function montarRelatorio(resultado) {
    const testes = resultado.testes || {};
    const statusGeral = piorStatus([
        ...Object.values(testes).map(t => t.status || 'ok'),
        resultado.saudeGeral?.erros?.length ? 'alerta' : 'ok'
    ]);

    const assunto = statusGeral === 'ok'
        ? `[VeloBot] Teste automático ${resultado.horario} — OK`
        : `[VeloBot] Teste automático ${resultado.horario} — ${STATUS_LABEL[statusGeral]}`;

    const flags = resultado.saudeGeral?.flags || {};
    const flagsTexto = Object.entries(flags).map(([k, v]) => `${k}=${v ? 'true' : 'false'}`).join(', ');

    const textoPartes = [
        `Relatório automático de testes — ${resultado.horario} (${resultado.timestampISO})`,
        '',
        `Saúde geral: flags de produção → ${flagsTexto || 'não verificado'}`,
        resultado.saudeGeral?.erros?.length ? `Erros de infraestrutura: ${resultado.saudeGeral.erros.join('; ')}` : 'Sem erros de infraestrutura.',
        '',
        '=== 1) Moderação — 1ª tentativa ===',
        formatarSecaoTexto('Moderação 1ª tentativa', testes.moderacaoPrimeira || { status: 'sem_dados' }),
        '',
        '=== 2) Moderação — Reformulação (2ª tentativa) ===',
        formatarSecaoTexto('Reformulação', testes.reformulacao || { status: 'sem_dados' }),
        '',
        '=== 3) Geração de Resposta + Aprendizado ===',
        formatarSecaoTexto('Resposta + Aprendizado', testes.respostaAprendizado || { status: 'sem_dados' }),
        '',
        '—',
        'Mensagem automática gerada pelo VeloBot RA (teste periódico, não afeta dados de produção).'
    ];
    const texto = textoPartes.join('\n');

    const html = `
<p>Relatório automático de testes — <strong>${escapeHtml(resultado.horario)}</strong> (${escapeHtml(resultado.timestampISO)})</p>
<p><strong>Saúde geral:</strong> flags de produção → ${escapeHtml(flagsTexto || 'não verificado')}<br>
${resultado.saudeGeral?.erros?.length ? `<span style="color:#cf222e;">Erros de infraestrutura: ${escapeHtml(resultado.saudeGeral.erros.join('; '))}</span>` : 'Sem erros de infraestrutura.'}</p>
<hr>
${formatarSecaoHtml('1) Moderação — 1ª tentativa', testes.moderacaoPrimeira || { status: 'sem_dados' })}
<hr>
${formatarSecaoHtml('2) Moderação — Reformulação (2ª tentativa)', testes.reformulacao || { status: 'sem_dados' })}
<hr>
${formatarSecaoHtml('3) Geração de Resposta + Aprendizado', testes.respostaAprendizado || { status: 'sem_dados' })}
<hr>
<p>—<br>Mensagem automática gerada pelo VeloBot RA (teste periódico, não afeta dados de produção).</p>`;

    return { assunto, texto, html, statusGeral };
}

async function enviarRelatorioTestes(resultado) {
    const cfg = obterConfigEmailTeste();
    const msg = montarRelatorio(resultado);

    if (!cfg.configurado) {
        return { enviado: false, motivo: 'E-mail não configurado (defina SMTP_HOST/SMTP_USER/SMTP_PASS ou RESEND_API_KEY na Vercel)', configurado: false, preview: msg };
    }

    try {
        const { enviarViaResend, enviarViaSmtp } = require('./email-lembretes');
        const payload = { from: cfg.from, to: cfg.destinatarios, assunto: msg.assunto, texto: msg.texto, html: msg.html };
        if (cfg.provider === 'resend') {
            await enviarViaResend(payload);
        } else {
            await enviarViaSmtp(payload);
        }
        return { enviado: true, configurado: true, destinatarios: cfg.destinatarios, provider: cfg.provider, statusGeral: msg.statusGeral, assunto: msg.assunto };
    } catch (e) {
        console.error('❌ Erro ao enviar relatório de testes automáticos:', e.message);
        return { enviado: false, motivo: 'erro no envio: ' + e.message, configurado: true, preview: msg };
    }
}

module.exports = {
    obterConfigEmailTeste,
    montarRelatorio,
    enviarRelatorioTestes,
    DESTINATARIOS_PADRAO
};
