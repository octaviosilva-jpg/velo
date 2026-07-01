/**
 * Lembrete por e-mail — marcações de moderação (aprovada / aceita RA / negada).
 * Provedores: SMTP (ex.: Google Workspace @velotax.com.br) ou Resend (domínio verificado).
 *
 * Variáveis de ambiente (Vercel / .env):
 *   LEMBRETE_EMAIL_DESTINATARIOS  — lista separada por vírgula
 *   LEMBRETE_DIAS_LIMITE          — default 7
 *   LEMBRETE_EMAIL_FROM           — ex.: bot@velotax.com.br
 *   EMAIL_PROVIDER                — smtp | resend (auto se só uma credencial existir)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   RESEND_API_KEY
 *   CRON_SECRET                   — protege /api/cron/lembrete-marcacoes
 */

const CONFIG_SHEET = 'Config Bot';
const CONFIG_CHAVE_ULTIMO_ENVIO = 'lembrete_marcacoes_ultimo_envio';
const CONFIG_CHAVE_DIAS_NO_ENVIO = 'lembrete_marcacoes_dias_parado';

function parseDestinatarios(raw) {
    return String(raw || '')
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function obterConfigEmail() {
    const destinatarios = parseDestinatarios(process.env.LEMBRETE_EMAIL_DESTINATARIOS);
    const from = (process.env.LEMBRETE_EMAIL_FROM || process.env.SMTP_USER || '').trim();
    let provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const temSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const temResend = !!process.env.RESEND_API_KEY;
    if (!provider) {
        if (temSmtp) provider = 'smtp';
        else if (temResend) provider = 'resend';
    }
    const configurado = destinatarios.length > 0 && from && (provider === 'smtp' ? temSmtp : provider === 'resend' ? temResend : false);
    return {
        configurado,
        destinatarios,
        from,
        provider,
        limiteDias: parseInt(process.env.LEMBRETE_DIAS_LIMITE, 10) || 7,
        temSmtp,
        temResend
    };
}

function montarMensagemLembrete(vigilancia) {
    const v = vigilancia || {};
    const diasSemRegistro = v.diasSemResultadoRA ?? v.diasDesdeUltimaMarcacao ?? v.limiteDiasAlerta ?? 7;

    const texto = [
        'Olá!',
        '',
        `Durante a verificação periódica da base de aprendizado, identifiquei que não foram registrados novos resultados de moderação nos últimos ${diasSemRegistro} dias.`,
        '',
        'Para manter meu processo de aprendizado atualizado, preciso receber os resultados das moderações realizadas, sejam elas aceitas ou negadas.',
        '',
        'Caso existam novos resultados, peço que realize o registro na interface.',
        '',
        'Caso não tenha ocorrido nenhuma nova moderação, nenhuma ação é necessária.',
        '',
        'Obrigado por contribuir para manter a base de aprendizado atualizada.',
        '',
        '—',
        'Mensagem automática gerada pela Interface de Moderação.'
    ].join('\n');

    const html = `
<p>Olá!</p>
<p>Durante a verificação periódica da base de aprendizado, identifiquei que <strong>não foram registrados novos resultados de moderação nos últimos ${diasSemRegistro} dias</strong>.</p>
<p>Para manter meu processo de aprendizado atualizado, preciso receber os resultados das moderações realizadas, sejam elas <strong>aceitas</strong> ou <strong>negadas</strong>.</p>
<p><strong>Caso existam novos resultados</strong>, peço que realize o registro na interface.</p>
<p><strong>Caso não tenha ocorrido nenhuma nova moderação</strong>, nenhuma ação é necessária.</p>
<p>Obrigado por contribuir para manter a base de aprendizado atualizada.</p>
<p>—<br>Mensagem automática gerada pela Interface de Moderação.</p>`;

    const assunto = `[Interface de Moderação] ${diasSemRegistro} dia(s) sem registro de resultados de moderação`;

    return { assunto, texto, html, diasSemRegistro };
}

async function enviarViaResend({ from, to, assunto, texto, html }) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to,
            subject: assunto,
            text: texto,
            html
        })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.message || body.error || `Resend HTTP ${res.status}`);
    }
    return body;
}

async function enviarViaSmtp({ from, to, assunto, texto, html }) {
    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch {
        throw new Error('Pacote nodemailer não instalado. Execute: npm install nodemailer');
    }
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
    return transporter.sendMail({
        from,
        to: to.join(', '),
        subject: assunto,
        text: texto,
        html
    });
}

async function lerEstadoUltimoEnvio(googleSheetsConfig) {
    if (!googleSheetsConfig?.isInitialized?.()) return null;
    try {
        const rows = await googleSheetsConfig.readData(`${CONFIG_SHEET}!A1:C50`);
        if (!rows || rows.length <= 1) return null;
        for (let i = 1; i < rows.length; i++) {
            const chave = String(rows[i][0] || '').trim();
            if (chave === CONFIG_CHAVE_ULTIMO_ENVIO) {
                return {
                    linha: i + 1,
                    valor: String(rows[i][1] || '').trim(),
                    diasParado: parseInt(rows[i][2], 10)
                };
            }
        }
    } catch {
        /* aba Config Bot pode não existir ainda */
    }
    return null;
}

async function gravarEstadoUltimoEnvio(googleSheetsConfig, isoDate, diasParado) {
    if (!googleSheetsConfig?.isInitialized?.()) return;
    try {
        const rows = await googleSheetsConfig.readData(`${CONFIG_SHEET}!A1:C50`);
        let linhaExistente = -1;
        if (rows && rows.length > 1) {
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][0] || '').trim() === CONFIG_CHAVE_ULTIMO_ENVIO) {
                    linhaExistente = i + 1;
                    break;
                }
            }
        }
        const valores = [CONFIG_CHAVE_ULTIMO_ENVIO, isoDate, String(diasParado ?? '')];
        if (linhaExistente > 0) {
            await googleSheetsConfig.updateRow(`${CONFIG_SHEET}!A${linhaExistente}:C${linhaExistente}`, valores);
        } else {
            await googleSheetsConfig.appendRow(`${CONFIG_SHEET}!A:C`, valores);
        }
    } catch (e) {
        console.warn('⚠️ Não foi possível gravar estado do lembrete na planilha:', e.message);
    }
}

function deveEnviarAgora(vigilancia, estadoUltimo, { forcar = false } = {}) {
    if (forcar) return { ok: true, motivo: 'forçado' };
    if (!vigilancia?.emAlerta) {
        return { ok: false, motivo: 'sem alerta (dentro do limite de dias)' };
    }
    if (!estadoUltimo?.valor) return { ok: true, motivo: 'primeiro envio' };
    const ultimo = new Date(estadoUltimo.valor);
    if (isNaN(ultimo.getTime())) return { ok: true, motivo: 'estado inválido — reenviar' };
    const horasDesde = (Date.now() - ultimo.getTime()) / (1000 * 60 * 60);
    if (horasDesde < 20) {
        return { ok: false, motivo: 'e-mail já enviado nas últimas 20h' };
    }
    if (vigilancia.diasDesdeUltimaMarcacao > (estadoUltimo.diasParado || 0) + 2) {
        return { ok: true, motivo: 'situação piorou desde o último lembrete' };
    }
    if (horasDesde >= 24 * 7) {
        return { ok: true, motivo: 'reenvio semanal' };
    }
    return { ok: false, motivo: 'aguardando intervalo entre lembretes' };
}

/**
 * Envia lembrete se configurado e em alerta. Retorna objeto de resultado (nunca lança).
 */
async function enviarLembreteMarcacoes(vigilancia, { googleSheetsConfig, forcar = false } = {}) {
    const cfg = obterConfigEmail();
    const preview = montarMensagemLembrete(vigilancia);

    if (!cfg.configurado) {
        return {
            enviado: false,
            motivo: 'E-mail não configurado (defina LEMBRETE_EMAIL_DESTINATARIOS + SMTP ou RESEND na Vercel)',
            configurado: false,
            preview
        };
    }

    const estado = await lerEstadoUltimoEnvio(googleSheetsConfig);
    const decisao = deveEnviarAgora(vigilancia, estado, { forcar });
    if (!decisao.ok) {
        return {
            enviado: false,
            motivo: decisao.motivo,
            configurado: true,
            preview,
            ultimoEnvio: estado?.valor || null
        };
    }

    try {
        const payload = {
            from: cfg.from,
            to: cfg.destinatarios,
            assunto: preview.assunto,
            texto: preview.texto,
            html: preview.html
        };
        if (cfg.provider === 'resend') {
            await enviarViaResend(payload);
        } else {
            await enviarViaSmtp(payload);
        }
        const agora = new Date().toISOString();
        await gravarEstadoUltimoEnvio(googleSheetsConfig, agora, vigilancia?.diasDesdeUltimaMarcacao);
        return {
            enviado: true,
            motivo: decisao.motivo,
            configurado: true,
            destinatarios: cfg.destinatarios,
            provider: cfg.provider,
            preview,
            enviadoEm: agora
        };
    } catch (e) {
        console.error('❌ Erro ao enviar lembrete:', e.message);
        return {
            enviado: false,
            motivo: 'erro no envio: ' + e.message,
            configurado: true,
            preview
        };
    }
}

module.exports = {
    obterConfigEmail,
    montarMensagemLembrete,
    enviarLembreteMarcacoes,
    lerEstadoUltimoEnvio,
    CONFIG_SHEET
};
