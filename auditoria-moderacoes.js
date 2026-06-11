#!/usr/bin/env node
/**
 * Auditoria das abas de moderação — janela móvel (padrão 90 dias / 3 meses)
 * Uso: node auditoria-moderacoes.js [--janela=90]
 */

const fs = require('fs');
const path = require('path');
const googleSheetsIntegration = require('./google-sheets-integration');
const googleSheetsConfig = require('./google-sheets-config');

function loadEnvFromFile(filePath) {
    const envVars = {};
    if (!fs.existsSync(filePath)) return envVars;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        envVars[trimmed.slice(0, eq).trim()] = value.replace(/\\n/g, '\n');
    }
    return envVars;
}

function parseDataBrasileira(str) {
    if (!str) return null;
    const s = String(str).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const iso = new Date(s);
    return isNaN(iso.getTime()) ? null : iso;
}

function rowsToObjects(data) {
    if (!data || data.length <= 1) return [];
    const headers = data[0].map(h => String(h || '').trim());
    const rows = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row.some(c => c !== undefined && c !== '')) continue;
        const obj = { _linha: i + 1 };
        headers.forEach((h, idx) => { if (h) obj[h] = row[idx] !== undefined ? row[idx] : ''; });
        obj._dataRaw = row[0] || obj['Data/Hora'] || obj['Data do Registro'] || '';
        obj._data = parseDataBrasileira(String(obj._dataRaw));
        rows.push(obj);
    }
    return rows;
}

function filtrarJanela(rows, dias, ate = new Date()) {
    const fim = new Date(ate);
    fim.setHours(23, 59, 59, 999);
    const inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - dias);
    inicio.setHours(0, 0, 0, 0);
    return rows.filter(r => r._data && r._data >= inicio && r._data <= fim);
}

function contarPor(arr, fn) {
    const m = {};
    for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; }
    return m;
}

function pct(n, t) { return t ? `${Math.round((n / t) * 100)}%` : '0%'; }

function topN(obj, n) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([k, v]) => `${k}: ${v}`).join(', ');
}

function textoModeracaoProblematico(texto) {
    if (!texto || typeof texto !== 'string') return { problematico: false, motivos: [] };
    const t = texto.toLowerCase();
    const motivos = [];
    if (t.includes('**dados do caso:**') || t.includes('dados do caso:')) motivos.push('cita_dados_entrada');
    if (t.includes('solicitação do cliente:') && t.includes('resposta da empresa:')) motivos.push('cola_estrutura_entrada');
    if (!t.trim().startsWith('prezados') && !t.includes('prezados,')) motivos.push('nao_inicia_prezados');
    if (t.includes('atenciosamente') && t.includes('equipe velotax') && !t.includes('moderação')) motivos.push('tom_resposta_cliente');
    if (t.includes('entendemos sua frustração') || t.includes('lamentamos')) motivos.push('tom_emocional');
    if ((t.match(/manual/g) || []).length === 0 && texto.length > 200) motivos.push('sem_citar_manual');
    return { problematico: motivos.length > 0, motivos };
}

function analisarAbaModeracoes(rows) {
    let aprovadas = 0, pendentes = 0, comFeedback = 0, coerentesUtilizaveis = 0;
    let textoProblematico = 0;
    const issues = [];
    const porMotivo = {};
    const porStatus = {};

    for (const r of rows) {
        const status = String(r['Status Aprovação'] || '').trim().toLowerCase();
        const feedback = String(r['Feedback'] || '').trim();
        const motivo = r['Motivo Moderação'] || '(vazio)';
        porMotivo[motivo] = (porMotivo[motivo] || 0) + 1;
        porStatus[status || '(vazio)'] = (porStatus[status || '(vazio)'] || 0) + 1;

        if (status.includes('aprov')) aprovadas++;
        else if (status.includes('pend')) pendentes++;
        if (feedback) comFeedback++;

        const textoMod = r['Texto Moderação Reformulado'] || r['Texto Moderação Anterior'] || '';
        const analise = textoModeracaoProblematico(textoMod);
        if (analise.problematico) {
            textoProblematico++;
            if (issues.length < 8) {
                issues.push({
                    linha: r._linha, data: r._dataRaw, motivo,
                    status: r['Status Aprovação'],
                    problemas: analise.motivos.join(', '),
                    trecho: textoMod.substring(0, 150)
                });
            }
        }

        if (status === 'aprovada' && !feedback) coerentesUtilizaveis++;
    }

    return {
        total: rows.length, aprovadas, pendentes, comFeedback, coerentesUtilizaveis,
        textoProblematico, porMotivo, porStatus, issues
    };
}

function analisarAceitas(rows) {
    let semManual = 0, naoPrezados = 0, issues = [];
    const porTema = contarPor(rows, r => r['Tema'] || r['Motivo Utilizado'] || '(vazio)');
    const porMotivo = contarPor(rows, r => r['Motivo Utilizado'] || '(vazio)');

    for (const r of rows) {
        const texto = r['Texto da Moderação Enviada'] || '';
        const a = textoModeracaoProblematico(texto);
        if (!texto.toLowerCase().includes('manual')) semManual++;
        if (a.motivos.includes('nao_inicia_prezados')) naoPrezados++;
        if (a.problematico && issues.length < 5) {
            issues.push({ linha: r._linha, data: r._dataRaw, tema: r['Tema'], problemas: a.motivos.join(', ') });
        }
    }

    return { total: rows.length, porTema, porMotivo, semManual, naoPrezados, issues };
}

function analisarNegadas(rows) {
    let comBlocoErro = 0, comBlocoCorrecao = 0;
    const porMotivo = contarPor(rows, r => r['Motivo da Negativa'] || r['Motivo Negativa'] || '(vazio)');

    for (const r of rows) {
        const b2 = r['Bloco 2 - Onde Errou'] || r['Onde Errou'] || '';
        const b3 = r['Bloco 3 - Como Corrigir'] || r['Como Corrigir'] || '';
        if (b2 && String(b2).trim().length > 20) comBlocoErro++;
        if (b3 && String(b3).trim().length > 20) comBlocoCorrecao++;
    }

    return { total: rows.length, porMotivo, comBlocoErro, comBlocoCorrecao };
}

async function lerAba(nome) {
    try {
        return rowsToObjects(await googleSheetsConfig.readData(`${nome}!A1:Z5000`));
    } catch (e) {
        console.error(`  ❌ Erro ao ler "${nome}":`, e.message);
        return [];
    }
}

async function main() {
    let janelaDias = 90;
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--janela=')) janelaDias = parseInt(arg.split('=')[1], 10) || 90;
    }

    const envVars = {
        ...loadEnvFromFile(path.join(__dirname, '.env')),
        ...loadEnvFromFile(path.join(__dirname, 'config.env')),
        ENABLE_GOOGLE_SHEETS: 'true'
    };

    console.log('🔧 Inicializando Google Sheets...');
    const ok = await googleSheetsIntegration.initialize(envVars, { skipEnsureSheets: true });
    if (!ok || !googleSheetsIntegration.isActive()) {
        console.error('❌ Falha na conexão com a planilha.');
        process.exit(1);
    }

    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - janelaDias);

    console.log(`📊 Auditoria de MODERAÇÕES — janela móvel de ${janelaDias} dias`);
    console.log(`   ${inicio.toLocaleDateString('pt-BR')} → ${hoje.toLocaleDateString('pt-BR')}\n`);

    const [modAll, aceitasAll, negadasAll] = await Promise.all([
        lerAba('Moderações'),
        lerAba('Moderações Aceitas'),
        lerAba('Moderações Negadas')
    ]);

    const mod = filtrarJanela(modAll, janelaDias, hoje);
    const aceitas = filtrarJanela(aceitasAll, janelaDias, hoje);
    const negadas = filtrarJanela(negadasAll, janelaDias, hoje);

    const relMod = analisarAbaModeracoes(mod);
    const relAceitas = analisarAceitas(aceitas);
    const relNegadas = analisarNegadas(negadas);

    const relatorio = {
        janelaDias,
        periodo: { de: inicio.toLocaleDateString('pt-BR'), ate: hoje.toLocaleDateString('pt-BR') },
        totaisPlanilha: { moderacoes: modAll.length, aceitas: aceitasAll.length, negadas: negadasAll.length },
        noPeriodo: { moderacoes: mod.length, aceitas: aceitas.length, negadas: negadas.length },
        abaModeracoes: relMod,
        abaAceitas: relAceitas,
        abaNegadas: relNegadas,
        aprendizado: {
            coerentesNaJanela: relMod.coerentesUtilizaveis,
            aceitasNaJanela: aceitas.length,
            negadasNaJanela: negadas.length,
            observacao: 'Coerentes = Status Aprovada + sem Feedback na aba Moderações (critério do sistema)'
        }
    };

    console.log('='.repeat(70));
    console.log(' RELATÓRIO — AUDITORIA DE MODERAÇÕES');
    console.log('='.repeat(70));

    console.log('\n--- ABA MODERAÇÕES (janela) ---');
    console.log(`Total: ${relMod.total} (planilha inteira: ${modAll.length})`);
    console.log(`Aprovadas: ${relMod.aprovadas} | Pendentes: ${relMod.pendentes} | Com feedback (negativa/reform): ${relMod.comFeedback}`);
    console.log(`Coerentes utilizáveis pelo sistema: ${relMod.coerentesUtilizaveis}`);
    console.log(`Texto com padrão problemático: ${relMod.textoProblematico} (${pct(relMod.textoProblematico, relMod.total)})`);
    console.log('Por status:', JSON.stringify(relMod.porStatus));
    console.log('Top motivos:', topN(relMod.porMotivo, 8));

    console.log('\n--- ABA MODERAÇÕES ACEITAS (janela) ---');
    console.log(`Total: ${relAceitas.total} (planilha: ${aceitasAll.length})`);
    console.log(`Sem citação a manual: ${relAceitas.semManual} (${pct(relAceitas.semManual, relAceitas.total)})`);
    console.log(`Não inicia com "Prezados,": ${relAceitas.naoPrezados} (${pct(relAceitas.naoPrezados, relAceitas.total)})`);
    console.log('Top temas:', topN(relAceitas.porTema, 6));
    console.log('Top motivos:', topN(relAceitas.porMotivo, 6));

    console.log('\n--- ABA MODERAÇÕES NEGADAS (janela) ---');
    console.log(`Total: ${relNegadas.total} (planilha: ${negadasAll.length})`);
    console.log(`Com bloco "onde errou": ${relNegadas.comBlocoErro} | Com "como corrigir": ${relNegadas.comBlocoCorrecao}`);
    console.log('Top motivos negativa:', topN(relNegadas.porMotivo, 6));

    console.log('\n--- APRENDIZADO DE MODERAÇÃO (janela 90d) ---');
    console.log(`Registros que o sistema usaria como coerentes: ${relatorio.aprendizado.coerentesNaJanela}`);
    console.log(`Aceitas registradas (Fase 2): ${relatorio.aprendizado.aceitasNaJanela}`);
    console.log(`Negadas com análise (Fase 2): ${relatorio.aprendizado.negadasNaJanela}`);

    if (relMod.issues.length) {
        console.log('\n--- AMOSTRAS PROBLEMÁTICAS (Moderações) ---');
        relMod.issues.forEach(i => {
            console.log(`  L${i.linha} ${i.data} [${i.motivo}] status=${i.status}`);
            console.log(`    ${i.problemas}: ${i.trecho}...`);
        });
    }
    if (relAceitas.issues.length) {
        console.log('\n--- AMOSTRAS PROBLEMÁTICAS (Aceitas) ---');
        relAceitas.issues.forEach(i => console.log(`  L${i.linha} ${i.data} [${i.tema}] ${i.problemas}`));
    }

    console.log('\n' + '='.repeat(70));

    const outPath = path.join(__dirname, 'auditoria', 'relatorio-moderacoes.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(relatorio, null, 2), 'utf8');
    console.log(`\n💾 JSON: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
