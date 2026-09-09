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
    'caroline.santiago@velotax.com.br',
    'Emerson.jose@velotax.com.br',
    'tavin.ramalho@gmail.com'
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

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Relatorio EXECUTIVO: uma linha por funcionalidade + uma linha por checagem, sem trechos de
// texto gerado (isso fica disponivel sob demanda via GET /api/cron/teste-automatico?detalhado=1).
function formatarSecaoTexto(titulo, teste) {
    const linhas = [`${STATUS_EMOJI[teste.status] || ''} ${titulo} — ${STATUS_LABEL[teste.status] || teste.status}${teste.caso ? ' (' + teste.caso + ')' : ''}`];
    if (Array.isArray(teste.checks) && teste.checks.length) {
        teste.checks.forEach(c => linhas.push(`   ${c.ok ? '✓' : '✗'} ${c.label}${c.detalhe ? ' — ' + c.detalhe : ''}`));
    }
    if (teste.resumo) linhas.push(`   • ${teste.resumo}`);
    if (teste.erro) linhas.push(`   ✗ Erro: ${teste.erro}`);
    return linhas.join('\n');
}

function formatarSecaoHtml(titulo, teste) {
    const cor = { ok: '#1a7f37', alerta: '#9a6700', erro: '#cf222e', sem_dados: '#57606a' }[teste.status] || '#333';
    let html = `<p style="margin:6px 0 2px;"><strong>${STATUS_EMOJI[teste.status] || ''} ${escapeHtml(titulo)}</strong> — <span style="color:${cor};">${STATUS_LABEL[teste.status] || teste.status}</span>${teste.caso ? ` <span style="color:#57606a;">(${escapeHtml(teste.caso)})</span>` : ''}</p>`;
    if (Array.isArray(teste.checks) && teste.checks.length) {
        html += '<ul style="margin:2px 0 4px;padding-left:20px;">';
        teste.checks.forEach(c => {
            html += `<li>${c.ok ? '✅' : '❌'} ${escapeHtml(c.label)}${c.detalhe ? ' — <em>' + escapeHtml(c.detalhe) + '</em>' : ''}</li>`;
        });
        html += '</ul>';
    }
    if (teste.resumo) html += `<p style="margin:2px 0;color:#57606a;">${escapeHtml(teste.resumo)}</p>`;
    if (teste.erro) html += `<p style="color:#cf222e;margin:2px 0;"><strong>Erro:</strong> ${escapeHtml(teste.erro)}</p>`;
    return html;
}

/** Monta assunto/texto/html do relatório a partir do resultado coletado em server.js. */
function montarRelatorio(resultado) {
    const testes = resultado.testes || {};
    const statusGeral = piorStatus([
        ...Object.values(testes).map(t => t.status || 'ok'),
        resultado.saudeGeral?.erros?.length ? 'alerta' : 'ok'
    ]);

    const temCritico = Object.values(testes).some(t => t?.alertaCritico) || (resultado.saudeGeral?.erros || []).some(e => e.includes('🚨'));
    const assunto = temCritico
        ? `[VeloBot] 🚨 CRÍTICO — Teste automático ${resultado.horario}`
        : statusGeral === 'ok'
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
        '=== 4) Registro na Planilha (grava, confirma e apaga a linha de teste) ===',
        formatarSecaoTexto('Registro na Planilha', testes.registroNaPlanilha || { status: 'sem_dados' }),
        '',
        '—',
        'Mensagem automática gerada pelo VeloBot RA (teste periódico, não afeta dados de produção).'
    ];
    const texto = textoPartes.join('\n');

    const html = `
${temCritico ? `<p style="background:#ffebe9;border:2px solid #cf222e;border-radius:6px;padding:10px;color:#cf222e;"><strong>🚨 ALERTA CRÍTICO</strong> — alguma checagem de segurança da gravação/exclusão na planilha falhou. Veja a seção 4 abaixo antes de qualquer outra ação. Nada foi corrigido automaticamente.</p>` : ''}
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
${formatarSecaoHtml('4) Registro na Planilha (grava, confirma e apaga a linha de teste)', testes.registroNaPlanilha || { status: 'sem_dados' })}
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
        let info = null;
        if (cfg.provider === 'resend') {
            info = await enviarViaResend(payload);
        } else {
            info = await enviarViaSmtp(payload);
        }
        // nodemailer (SMTP) informa por endereco se o servidor aceitou ou rejeitou — sem isso,
        // um recusa parcial (ex.: 1 de 3 destinatarios) passava despercebido como "enviado: true".
        const aceitos = info?.accepted;
        const rejeitados = info?.rejected;
        return {
            enviado: true,
            configurado: true,
            destinatarios: cfg.destinatarios,
            provider: cfg.provider,
            statusGeral: msg.statusGeral,
            assunto: msg.assunto,
            ...(Array.isArray(aceitos) ? { aceitosPeloServidor: aceitos } : {}),
            ...(Array.isArray(rejeitados) && rejeitados.length ? { rejeitadosPeloServidor: rejeitados } : {})
        };
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
