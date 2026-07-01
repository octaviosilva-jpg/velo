/**
 * Lembrete por e-mail — marcações de moderação (aceita / negada pelo RA).
 * Níveis: 7 dias (informativo), 14 dias (atenção), 21+ dias (alerta + reenvio semanal).
 */

const CONFIG_SHEET = 'Config Bot';
const CONFIG_CHAVE_ULTIMO_ENVIO = 'lembrete_marcacoes_ultimo_envio';
const NIVEIS_DIAS = [7, 14, 21];

function parseDestinatarios(raw) {
    return String(raw || '')
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function diasSemRegistroDe(vigilancia) {
    const v = vigilancia || {};
    if (v.diasSemResultadoRA !== null && v.diasSemResultadoRA !== undefined) {
        return v.diasSemResultadoRA;
    }
    return v.diasDesdeUltimaMarcacao ?? null;
}

/** 0 = ok; 1 = 7+ dias; 2 = 14+; 3 = 21+ */
function obterNivelAlerta(dias) {
    if (dias === null || dias === undefined || dias < 7) return 0;
    if (dias >= 21) return 3;
    if (dias >= 14) return 2;
    return 1;
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
        niveisDias: NIVEIS_DIAS,
        temSmtp,
        temResend
    };
}

function montarMensagemLembrete(vigilancia) {
    const diasSemRegistro = diasSemRegistroDe(vigilancia);
    const nivel = obterNivelAlerta(diasSemRegistro);
    const d = diasSemRegistro ?? 7;

    if (nivel === 3) {
        const texto = [
            'Olá!',
            '',
            'Esta é uma notificação automática da Interface de Moderação.',
            '',
            `Identifiquei que não há novos registros de moderação há ${d} dias.`,
            '',
            'Os resultados de moderações aceitas e negadas são essenciais para o processo de aprendizado do sistema. Um período prolongado sem novos registros pode comprometer a atualização da base, reduzindo a precisão das análises e a evolução contínua do modelo.',
            '',
            'Solicitação prioritária:',
            'Verifique se houve moderações concluídas que ainda não foram registradas e, em caso positivo, realize a atualização da base o quanto antes.',
            '',
            'Caso não tenham ocorrido novas moderações nesse período, nenhuma ação é necessária e esta mensagem poderá ser desconsiderada.',
            '',
            'Agradeço pela colaboração na manutenção da qualidade e da confiabilidade da base de aprendizado.',
            '',
            '—',
            'Mensagem automática gerada pela Interface de Moderação.'
        ].join('\n');
        const html = `
<p>Olá!</p>
<p>Esta é uma notificação automática da Interface de Moderação.</p>
<p>Identifiquei que <strong>não há novos registros de moderação há ${d} dias</strong>.</p>
<p>Os resultados de moderações <strong>aceitas</strong> e <strong>negadas</strong> são essenciais para o processo de aprendizado do sistema. Um período prolongado sem novos registros pode comprometer a atualização da base, reduzindo a precisão das análises e a evolução contínua do modelo.</p>
<p><strong>Solicitação prioritária:</strong><br>Verifique se houve moderações concluídas que ainda não foram registradas e, em caso positivo, realize a atualização da base o quanto antes.</p>
<p>Caso não tenham ocorrido novas moderações nesse período, nenhuma ação é necessária e esta mensagem poderá ser desconsiderada.</p>
<p>Agradeço pela colaboração na manutenção da qualidade e da confiabilidade da base de aprendizado.</p>
<p>—<br>Mensagem automática gerada pela Interface de Moderação.</p>`;
        return {
            assunto: `[Interface de Moderação] Alerta: ${d} dias sem registro de moderação`,
            texto,
            html,
            diasSemRegistro: d,
            nivel,
            nivelLabel: 'alerta'
        };
    }

    if (nivel === 2) {
        const texto = [
            'Olá!',
            '',
            'Esta é uma notificação automática da Interface de Moderação.',
            '',
            `Identifiquei que não há novos registros de moderação há ${d} dias.`,
            '',
            'A ausência prolongada de registros reduz a frequência de atualização da base de aprendizado utilizada nas análises e respostas geradas pelo sistema.',
            '',
            'Solicitação:',
            'Caso tenha ocorrido alguma moderação aceita ou negada nesse período, realize o registro correspondente na interface para manter a base atualizada.',
            '',
            'Caso não tenham ocorrido novas moderações, nenhuma ação é necessária e esta notificação poderá ser desconsiderada.',
            '',
            'Obrigado por contribuir para a qualidade contínua da base de aprendizado.',
            '',
            '—',
            'Mensagem automática gerada pela Interface de Moderação.'
        ].join('\n');
        const html = `
<p>Olá!</p>
<p>Esta é uma notificação automática da Interface de Moderação.</p>
<p>Identifiquei que <strong>não há novos registros de moderação há ${d} dias</strong>.</p>
<p>A ausência prolongada de registros reduz a frequência de atualização da base de aprendizado utilizada nas análises e respostas geradas pelo sistema.</p>
<p><strong>Solicitação:</strong><br>Caso tenha ocorrido alguma moderação <strong>aceita</strong> ou <strong>negada</strong> nesse período, realize o registro correspondente na interface para manter a base atualizada.</p>
<p>Caso não tenham ocorrido novas moderações, nenhuma ação é necessária e esta notificação poderá ser desconsiderada.</p>
<p>Obrigado por contribuir para a qualidade contínua da base de aprendizado.</p>
<p>—<br>Mensagem automática gerada pela Interface de Moderação.</p>`;
        return {
            assunto: `[Interface de Moderação] Atenção: ${d} dias sem registro de moderação`,
            texto,
            html,
            diasSemRegistro: d,
            nivel,
            nivelLabel: 'atenção'
        };
    }

    const texto = [
        'Olá!',
        '',
        `Durante a verificação periódica da base de aprendizado, identifiquei que não foram registrados novos resultados de moderação nos últimos ${d} dias.`,
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
<p>Durante a verificação periódica da base de aprendizado, identifiquei que <strong>não foram registrados novos resultados de moderação nos últimos ${d} dias</strong>.</p>
<p>Para manter meu processo de aprendizado atualizado, preciso receber os resultados das moderações realizadas, sejam elas <strong>aceitas</strong> ou <strong>negadas</strong>.</p>
<p><strong>Caso existam novos resultados</strong>, peço que realize o registro na interface.</p>
<p><strong>Caso não tenha ocorrido nenhuma nova moderação</strong>, nenhuma ação é necessária.</p>
<p>Obrigado por contribuir para manter a base de aprendizado atualizada.</p>
<p>—<br>Mensagem automática gerada pela Interface de Moderação.</p>`;
    return {
        assunto: `[Interface de Moderação] ${d} dia(s) sem registro de resultados de moderação`,
        texto,
        html,
        diasSemRegistro: d,
        nivel: nivel || 1,
        nivelLabel: 'informativo'
    };
}

async function enviarViaResend({ from, to, assunto, texto, html }) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to, subject: assunto, text: texto, html })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.message || body.error || `Resend HTTP ${res.status}`);
    }
    return body;
}

async function enviarViaSmtp({ from, to, assunto, texto, html }) {
    const nodemailer = require('nodemailer');
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
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
        const rows = await googleSheetsConfig.readData(`${CONFIG_SHEET}!A1:D50`);
        if (!rows || rows.length <= 1) return null;
        for (let i = 1; i < rows.length; i++) {
            const chave = String(rows[i][0] || '').trim();
            if (chave === CONFIG_CHAVE_ULTIMO_ENVIO) {
                return {
                    linha: i + 1,
                    valor: String(rows[i][1] || '').trim(),
                    diasParado: parseInt(rows[i][2], 10) || 0,
                    nivel: parseInt(rows[i][3], 10) || 0
                };
            }
        }
    } catch {
        /* aba Config Bot pode não existir ainda */
    }
    return null;
}

async function gravarEstadoUltimoEnvio(googleSheetsConfig, isoDate, diasParado, nivel) {
    if (!googleSheetsConfig?.isInitialized?.()) return;
    try {
        const rows = await googleSheetsConfig.readData(`${CONFIG_SHEET}!A1:D50`);
        let linhaExistente = -1;
        if (rows && rows.length > 1) {
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][0] || '').trim() === CONFIG_CHAVE_ULTIMO_ENVIO) {
                    linhaExistente = i + 1;
                    break;
                }
            }
        }
        const valores = [
            CONFIG_CHAVE_ULTIMO_ENVIO,
            isoDate || '',
            String(diasParado ?? ''),
            String(nivel ?? 0)
        ];
        if (linhaExistente > 0) {
            await googleSheetsConfig.updateRow(`${CONFIG_SHEET}!A${linhaExistente}:D${linhaExistente}`, valores);
        } else {
            await googleSheetsConfig.appendRow(`${CONFIG_SHEET}!A:D`, valores);
        }
    } catch (e) {
        console.warn('⚠️ Não foi possível gravar estado do lembrete na planilha:', e.message);
    }
}

async function resetarEstadoSeNormalizado(vigilancia, googleSheetsConfig, estado) {
    const dias = diasSemRegistroDe(vigilancia);
    if (obterNivelAlerta(dias) === 0 && estado && (estado.nivel > 0 || estado.valor)) {
        await gravarEstadoUltimoEnvio(googleSheetsConfig, '', 0, 0);
        return true;
    }
    return false;
}

function deveEnviarAgora(vigilancia, estadoUltimo, { forcar = false } = {}) {
    const dias = diasSemRegistroDe(vigilancia);
    const nivelAtual = obterNivelAlerta(dias);

    if (forcar) {
        return { ok: true, motivo: 'forçado', nivel: nivelAtual || 1 };
    }
    if (nivelAtual === 0) {
        return { ok: false, motivo: 'sem alerta (menos de 7 dias sem aceita/negada)' };
    }

    const ultimoNivel = estadoUltimo?.nivel || 0;

    if (nivelAtual > ultimoNivel) {
        return { ok: true, motivo: `escalonamento para nível ${nivelAtual} (${NIVEIS_DIAS[nivelAtual - 1]}+ dias)`, nivel: nivelAtual };
    }

    if (nivelAtual === 3 && ultimoNivel >= 3 && estadoUltimo?.valor) {
        const ultimo = new Date(estadoUltimo.valor);
        if (!isNaN(ultimo.getTime())) {
            const horasDesde = (Date.now() - ultimo.getTime()) / (1000 * 60 * 60);
            if (horasDesde >= 24 * 7) {
                return { ok: true, motivo: 'reenvio semanal no nível 3 (21+ dias)', nivel: 3 };
            }
        }
    }

    return {
        ok: false,
        motivo: ultimoNivel >= nivelAtual
            ? `nível ${nivelAtual} já notificado — aguardando ${nivelAtual < 3 ? `nível ${nivelAtual + 1} (${NIVEIS_DIAS[nivelAtual]} dias)` : 'próximo reenvio semanal'}`
            : 'aguardando próximo nível'
    };
}

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

    let estado = await lerEstadoUltimoEnvio(googleSheetsConfig);
    await resetarEstadoSeNormalizado(vigilancia, googleSheetsConfig, estado);
    estado = await lerEstadoUltimoEnvio(googleSheetsConfig);

    const decisao = deveEnviarAgora(vigilancia, estado, { forcar });
    if (!decisao.ok) {
        return {
            enviado: false,
            motivo: decisao.motivo,
            configurado: true,
            preview,
            nivelAtual: obterNivelAlerta(diasSemRegistroDe(vigilancia)),
            ultimoNivelEnviado: estado?.nivel || 0,
            ultimoEnvio: estado?.valor || null
        };
    }

    const msg = montarMensagemLembrete(vigilancia);

    try {
        const payload = {
            from: cfg.from,
            to: cfg.destinatarios,
            assunto: msg.assunto,
            texto: msg.texto,
            html: msg.html
        };
        if (cfg.provider === 'resend') {
            await enviarViaResend(payload);
        } else {
            await enviarViaSmtp(payload);
        }
        const agora = new Date().toISOString();
        const dias = diasSemRegistroDe(vigilancia);
        await gravarEstadoUltimoEnvio(googleSheetsConfig, agora, dias, decisao.nivel || msg.nivel);
        return {
            enviado: true,
            motivo: decisao.motivo,
            configurado: true,
            destinatarios: cfg.destinatarios,
            provider: cfg.provider,
            preview: msg,
            nivelEnviado: decisao.nivel || msg.nivel,
            enviadoEm: agora
        };
    } catch (e) {
        console.error('❌ Erro ao enviar lembrete:', e.message);
        return {
            enviado: false,
            motivo: 'erro no envio: ' + e.message,
            configurado: true,
            preview: msg
        };
    }
}

/** Dispara os 3 templates (7/14/21 dias) sem alterar estado na planilha — só para teste. */
async function enviarTesteTodosNiveis() {
    const cfg = obterConfigEmail();
    if (!cfg.configurado) {
        return {
            ok: false,
            motivo: 'E-mail não configurado (defina LEMBRETE_EMAIL_DESTINATARIOS + SMTP ou RESEND na Vercel)',
            resultados: []
        };
    }
    const diasPorNivel = [7, 14, 21];
    const resultados = [];
    for (const dias of diasPorNivel) {
        const msg = montarMensagemLembrete({ diasSemResultadoRA: dias });
        const assunto = `[TESTE] ${msg.assunto}`;
        try {
            const payload = {
                from: cfg.from,
                to: cfg.destinatarios,
                assunto,
                texto: msg.texto,
                html: msg.html
            };
            if (cfg.provider === 'resend') {
                await enviarViaResend(payload);
            } else {
                await enviarViaSmtp(payload);
            }
            resultados.push({
                enviado: true,
                dias,
                nivel: msg.nivel,
                nivelLabel: msg.nivelLabel,
                assunto
            });
        } catch (e) {
            resultados.push({
                enviado: false,
                dias,
                nivel: msg.nivel,
                nivelLabel: msg.nivelLabel,
                erro: e.message
            });
        }
    }
    return {
        ok: resultados.every(r => r.enviado),
        resultados,
        destinatarios: cfg.destinatarios,
        provider: cfg.provider
    };
}

module.exports = {
    obterConfigEmail,
    obterNivelAlerta,
    montarMensagemLembrete,
    enviarLembreteMarcacoes,
    enviarTesteTodosNiveis,
    lerEstadoUltimoEnvio,
    NIVEIS_DIAS,
    CONFIG_SHEET
};
