#!/usr/bin/env node
/**
 * Auditoria da planilha Google Sheets — aprendizado RA/Moderação
 * Uso: node auditoria-planilha.js [--desde=01/05/2026] [--ate=hoje]
 */

const fs = require('fs');
const path = require('path');
const googleSheetsIntegration = require('./google-sheets-integration');
const googleSheetsConfig = require('./google-sheets-config');

const DATA_INICIO_PADRAO = new Date(2026, 4, 1); // 01/05/2026
const TIPOS_NOVOS = new Set([
    'antecipacao', 'antecipacao-2026', 'aplicativo', 'conta-celcoin',
    'credito-ao-trabalhador', 'clube-velotax', 'emprestimo-pessoal', 'seguros',
    'incoerente', 'em-cobranca', 'veloprime', 'divida-prescrita', 'juros-abusivos'
]);
const TIPOS_ANTIGOS = new Set([
    'exclusao-cadastro', 'exclusao-chave-pix-cpf', 'liberacao-chave-pix',
    'antecipacao-restituicao', 'quitação-antecipada', 'esclarecimento', 'teste-escrita'
]);

function loadEnvFromFile(filePath) {
    const envVars = {};
    if (!fs.existsSync(filePath)) return envVars;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        envVars[key] = value.replace(/\\n/g, '\n');
    }
    return envVars;
}

function parseDataBrasileira(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim();
    // DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    // ISO
    const iso = new Date(s);
    return isNaN(iso.getTime()) ? null : iso;
}

function normalizarTipo(t) {
    return String(t || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function classificarTipo(tipo) {
    const n = normalizarTipo(tipo);
    if (!n) return 'vazio';
    for (const t of TIPOS_NOVOS) {
        if (n.includes(t) || t.includes(n)) return 'novo';
    }
    for (const t of TIPOS_ANTIGOS) {
        if (n.includes(t.replace(/-/g, '')) || n.includes(t)) return 'antigo';
    }
    return 'outro';
}

function temTomAntigo(texto) {
    if (!texto) return false;
    const t = texto.toLowerCase();
    const padroes = [
        'agradecemos', 'agradeço', 'lamentamos', 'sentimos muito', 'pedimos desculpas',
        'compreendemos o transtorno', 'infelizmente', 'prezado(a) cliente'
    ];
    return padroes.some(p => t.includes(p));
}

function citaLegalSemSolucao(resposta, solucao) {
    if (!resposta) return false;
    const r = resposta.toLowerCase();
    const termos = ['lgpd', 'ccb', 'código de defesa', 'codigo de defesa', 'cdc', 'banco central', 'cláusula', 'clausula'];
    const temNaResposta = termos.some(term => r.includes(term));
    if (!temNaResposta) return false;
    const s = (solucao || '').toLowerCase();
    return !termos.some(term => s.includes(term));
}

function respostaRefleteSolucao(resposta, solucao) {
    if (!solucao || !String(solucao).trim()) return null;
    if (!resposta) return false;
    const sol = String(solucao).toLowerCase().trim();
    const resp = resposta.toLowerCase();
    if (resp.includes(sol.substring(0, Math.min(50, sol.length)))) return true;
    const palavras = sol.split(/\s+/).map(p => p.replace(/[^a-záàâãéêíóôõúç0-9]/gi, '')).filter(p => p.length >= 4);
    if (palavras.length === 0) return resp.includes(sol.substring(0, 20));
    const match = palavras.filter(p => resp.includes(p)).length;
    return match >= Math.max(2, Math.ceil(palavras.length * 0.35));
}

function motivoPareceIdReclamacao(valor) {
    if (!valor || typeof valor !== 'string') return false;
    const v = valor.trim();
    return /^\d{6,}$/.test(v) || /^[a-f0-9-]{20,}$/i.test(v);
}

function rowsToObjects(data) {
    if (!data || data.length <= 1) return [];
    const headers = data[0].map(h => String(h || '').trim());
    const rows = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row.some(c => c !== undefined && c !== '')) continue;
        const obj = { _linha: i + 1 };
        headers.forEach((h, idx) => {
            if (h) obj[h] = row[idx] !== undefined ? row[idx] : '';
        });
        obj._dataRaw = row[0] || obj['Data/Hora'] || obj['Data do Registro'] || '';
        obj._data = parseDataBrasileira(String(obj._dataRaw));
        rows.push(obj);
    }
    return rows;
}

function filtrarPeriodo(rows, desde, ate) {
    return rows.filter(r => {
        if (!r._data) return false;
        return r._data >= desde && r._data <= ate;
    });
}

function contarPor(arr, fn) {
    const m = {};
    for (const x of arr) {
        const k = fn(x);
        m[k] = (m[k] || 0) + 1;
    }
    return m;
}

async function lerAba(nome) {
    const range = `${nome}!A1:Z5000`;
    try {
        const data = await googleSheetsConfig.readData(range);
        return rowsToObjects(data);
    } catch (e) {
        console.error(`  ❌ Erro ao ler "${nome}":`, e.message);
        return [];
    }
}

function analisarCoerentes(rows) {
    const issues = [];
    let tomAntigo = 0, legalSemSolucao = 0, naoRefleteSolucao = 0, duplicatas = 0;
    const vistos = new Map();

    for (const r of rows) {
        const tipo = r['Tipo Solicitação'] || r['Tipo de Situação'] || '';
        const resposta = r['Resposta Aprovada'] || '';
        const solucao = r['Solução Implementada'] || '';
        const idRec = r['ID da Reclamação'] || r['ID'] || '';

        if (temTomAntigo(resposta)) tomAntigo++;
        if (citaLegalSemSolucao(resposta, solucao)) legalSemSolucao++;
        if (respostaRefleteSolucao(resposta, solucao) === false) naoRefleteSolucao++;

        const chave = `${idRec}::${String(solucao).substring(0, 80)}`;
        if (vistos.has(chave)) duplicatas++;
        else vistos.set(chave, true);

        if (tomAntigo && issues.length < 5 && temTomAntigo(resposta)) {
            issues.push({ linha: r._linha, data: r._dataRaw, tipo, problema: 'tom_antigo', trecho: resposta.substring(0, 120) });
        }
    }

    return {
        total: rows.length,
        porTipo: contarPor(rows, r => r['Tipo Solicitação'] || r['Tipo de Situação'] || '(vazio)'),
        porClassificacaoTipo: contarPor(rows, r => classificarTipo(r['Tipo Solicitação'] || r['Tipo de Situação'])),
        tomAntigo,
        legalSemSolucao,
        naoRefleteSolucao,
        duplicatas,
        issues
    };
}

function analisarFeedbacks(rows) {
    let motivoComId = 0, tomAntigoReform = 0, legalSemSolucao = 0, naoRefleteSolucao = 0;
    const issues = [];

    for (const r of rows) {
        const motivo = r['Motivo Solicitação'] || '';
        const reform = r['Resposta Reformulada'] || '';
        const solucao = r['Solução Implementada'] || '';
        const tipo = r['Tipo Solicitação'] || '';

        if (motivoPareceIdReclamacao(motivo)) {
            motivoComId++;
            if (issues.length < 3) {
                issues.push({ linha: r._linha, data: r._dataRaw, tipo, problema: 'motivo_coluna_id', valor: motivo });
            }
        }
        if (temTomAntigo(reform)) tomAntigoReform++;
        if (citaLegalSemSolucao(reform, solucao)) legalSemSolucao++;
        if (respostaRefleteSolucao(reform, solucao) === false) naoRefleteSolucao++;
    }

    return {
        total: rows.length,
        porTipo: contarPor(rows, r => r['Tipo Solicitação'] || '(vazio)'),
        porClassificacaoTipo: contarPor(rows, r => classificarTipo(r['Tipo Solicitação'])),
        motivoComId,
        tomAntigoReform,
        legalSemSolucao,
        naoRefleteSolucao,
        issues
    };
}

function analisarModeracoes(rows) {
    return {
        total: rows.length,
        comFeedback: rows.filter(r => r['Feedback'] && r['Texto Moderação Anterior']).length,
        aprovadas: rows.filter(r => String(r['Status Aprovação'] || '').toLowerCase().includes('aprov')).length
    };
}

function proporJanela(coerentes, feedbacks, hoje) {
    const janelas = [60, 90, 120];
    const propostas = [];

    for (const dias of janelas) {
        const desde = new Date(hoje);
        desde.setDate(desde.getDate() - dias);
        const cJanela = coerentes.filter(r => r._data && r._data >= desde);
        const fJanela = feedbacks.filter(r => r._data && r._data >= desde);
        const cBons = cJanela.filter(r => {
            const resp = r['Resposta Aprovada'] || '';
            const sol = r['Solução Implementada'] || '';
            return !temTomAntigo(resp) && !citaLegalSemSolucao(resp, sol) && respostaRefleteSolucao(resp, sol) !== false;
        });
        const cRuins = cJanela.length - cBons.length;

        propostas.push({
            dias,
            coerentesTotal: cJanela.length,
            coerentesPadraoAtual: cBons.length,
            coerentesForaPadrao: cRuins,
            feedbacksTotal: fJanela.length,
            pctBons: cJanela.length ? Math.round((cBons.length / cJanela.length) * 100) : 0
        });
    }

    // Desde 01/05/2026
    const cDesdeMaio = coerentes.filter(r => r._data && r._data >= DATA_INICIO_PADRAO);
    const cBonsMaio = cDesdeMaio.filter(r => {
        const resp = r['Resposta Aprovada'] || '';
        const sol = r['Solução Implementada'] || '';
        return !temTomAntigo(resp) && !citaLegalSemSolucao(resp, sol) && respostaRefleteSolucao(resp, sol) !== false;
    });

    return { janelas: propostas, desdeMaio: { total: cDesdeMaio.length, padraoAtual: cBonsMaio.length } };
}

function imprimirRelatorio(relatorio) {
    console.log('\n' + '='.repeat(70));
    console.log(' RELATÓRIO DE AUDITORIA — PLANILHA DE APRENDIZADO');
    console.log('='.repeat(70));
    console.log(`Período: ${relatorio.desdeStr} até ${relatorio.ateStr}`);
    console.log(`Planilha ativa: ${relatorio.sheetsOk ? 'SIM' : 'NÃO'}`);

    console.log('\n--- RESPOSTAS COERENTES ---');
    const c = relatorio.coerentes;
    console.log(`Total no período: ${c.total}`);
    console.log(`Tom antigo (agradecimentos/lamentamos): ${c.tomAntigo} (${pct(c.tomAntigo, c.total)})`);
    console.log(`Cita LGPD/CCB/CDC sem constar na solução: ${c.legalSemSolucao} (${pct(c.legalSemSolucao, c.total)})`);
    console.log(`Não reflete solução implementada: ${c.naoRefleteSolucao} (${pct(c.naoRefleteSolucao, c.total)})`);
    console.log(`Duplicatas (mesmo ID+solução): ${c.duplicatas}`);
    console.log('Por classificação de tipo:', JSON.stringify(c.porClassificacaoTipo));
    console.log('Top tipos:', topN(c.porTipo, 8));

    console.log('\n--- FEEDBACKS ---');
    const f = relatorio.feedbacks;
    console.log(`Total no período: ${f.total}`);
    console.log(`Coluna "Motivo" parece ID reclamação: ${f.motivoComId} (${pct(f.motivoComId, f.total)}) ⚠️ bug gravação`);
    console.log(`Reformulação com tom antigo: ${f.tomAntigoReform} (${pct(f.tomAntigoReform, f.total)})`);
    console.log(`Reformulação cita legal sem solução: ${f.legalSemSolucao} (${pct(f.legalSemSolucao, f.total)})`);
    console.log(`Reformulação não reflete solução: ${f.naoRefleteSolucao} (${pct(f.naoRefleteSolucao, f.total)})`);
    console.log('Por classificação de tipo:', JSON.stringify(f.porClassificacaoTipo));

    console.log('\n--- MODERAÇÕES (aba Moderações) ---');
    console.log(JSON.stringify(relatorio.moderacoes, null, 2));
    console.log(`Moderações Aceitas no período: ${relatorio.moderacoesAceitas}`);
    console.log(`Moderações Negadas no período: ${relatorio.moderacoesNegadas}`);

    console.log('\n--- TOTAIS FORA DO PERÍODO (referência) ---');
    console.log(`Coerentes antes de ${relatorio.desdeStr}: ${relatorio.coerentesAntes}`);
    console.log(`Feedbacks antes: ${relatorio.feedbacksAntes}`);

    console.log('\n--- PROPOSTA DE JANELA DE APRENDIZADO (90 dias móveis) ---');
    const j90 = relatorio.proposta.janelas.find(j => j.dias === 90);
    if (j90) {
        console.log(`  Coerentes na janela: ${j90.coerentesTotal} total, ${j90.coerentesPadraoAtual} no padrão atual (${j90.pctBons}%)`);
        console.log(`  Feedbacks na janela: ${j90.feedbacksTotal}`);
    }
    console.log('');
    for (const j of relatorio.proposta.janelas) {
        console.log(`  ${j.dias} dias: ${j.coerentesPadraoAtual}/${j.coerentesTotal} coerentes úteis (${j.pctBons}%), ${j.feedbacksTotal} feedbacks`);
    }
    console.log(`\n  ➜ Recomendação: ${relatorio.recomendacao}`);

    if (relatorio.coerentes.issues.length) {
        console.log('\n--- AMOSTRAS PROBLEMÁTICAS (coerentes) ---');
        relatorio.coerentes.issues.forEach(i => console.log(`  L${i.linha} ${i.data} [${i.tipo}] ${i.problema}: ${i.trecho}...`));
    }
    if (relatorio.feedbacks.issues.length) {
        console.log('\n--- AMOSTRAS PROBLEMÁTICAS (feedbacks) ---');
        relatorio.feedbacks.issues.forEach(i => console.log(`  L${i.linha} ${i.data} [${i.tipo}] ${i.problema}: ${i.valor}`));
    }

    console.log('\n' + '='.repeat(70));
}

function pct(n, total) {
    if (!total) return '0%';
    return `${Math.round((n / total) * 100)}%`;
}

function topN(obj, n) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function escolherRecomendacao(proposta) {
    const j90 = proposta.janelas.find(j => j.dias === 90);
    const j60 = proposta.janelas.find(j => j.dias === 60);
    if (j90 && j90.coerentesPadraoAtual >= 5 && j90.pctBons >= 40) {
        return `Janela móvel de 90 dias + filtro de qualidade. Fallback: script padrão se < 2 modelos úteis por tipo.`;
    }
    if (j90 && j90.coerentesPadraoAtual >= 2) {
        return `Janela móvel de 90 dias + filtro de qualidade ativo. Poucos coerentes bons (${j90.coerentesPadraoAtual}) — aprendizado complementar; priorizar script + solução implementada.`;
    }
    return 'Janela de 90 dias + filtro de qualidade: quase nenhum coerente no padrão atual — geração usa script padrão até curadoria de novos exemplos.';
}

const JANELA_PADRAO_DIAS = 90;

async function main() {
    const args = process.argv.slice(2);
    let janelaDias = JANELA_PADRAO_DIAS;
    let dataInicio = null;
    let dataFim = new Date();

    for (const arg of args) {
        if (arg.startsWith('--janela=')) janelaDias = parseInt(arg.split('=')[1], 10) || JANELA_PADRAO_DIAS;
        if (arg.startsWith('--desde=')) {
            const d = parseDataBrasileira(arg.split('=')[1]);
            if (d) { dataInicio = d; janelaDias = null; }
        }
        if (arg.startsWith('--ate=') && arg.split('=')[1] !== 'hoje') {
            const d = parseDataBrasileira(arg.split('=')[1]);
            if (d) dataFim = d;
        }
    }

    if (!dataInicio) {
        dataInicio = new Date(dataFim);
        dataInicio.setDate(dataInicio.getDate() - janelaDias);
        dataInicio.setHours(0, 0, 0, 0);
    }

    const envVars = { ...loadEnvFromFile(path.join(__dirname, '.env')), ...loadEnvFromFile(path.join(__dirname, 'config.env')) };
    envVars.ENABLE_GOOGLE_SHEETS = 'true';

    console.log('🔧 Inicializando Google Sheets...');
    const ok = await googleSheetsIntegration.initialize(envVars, { skipEnsureSheets: true });
    if (!ok || !googleSheetsIntegration.isActive()) {
        console.error('❌ Não foi possível conectar à planilha. Verifique .env e compartilhamento com Service Account.');
        process.exit(1);
    }

    console.log('📊 Lendo abas...');
    const [coerentesAll, feedbacksAll, moderacoesAll, aceitasAll, negadasAll] = await Promise.all([
        lerAba('Respostas Coerentes'),
        lerAba('Feedbacks'),
        lerAba('Moderações'),
        lerAba('Moderações Aceitas'),
        lerAba('Moderações Negadas')
    ]);

    const coerentes = filtrarPeriodo(coerentesAll, dataInicio, dataFim);
    const feedbacks = filtrarPeriodo(feedbacksAll, dataInicio, dataFim);
    const moderacoes = filtrarPeriodo(moderacoesAll, dataInicio, dataFim);
    const aceitas = filtrarPeriodo(aceitasAll, dataInicio, dataFim);
    const negadas = filtrarPeriodo(negadasAll, dataInicio, dataFim);

    const proposta = proporJanela(coerentesAll, feedbacksAll, dataFim);

    const relatorio = {
        desdeStr: dataInicio.toLocaleDateString('pt-BR'),
        ateStr: dataFim.toLocaleDateString('pt-BR'),
        sheetsOk: true,
        coerentes: analisarCoerentes(coerentes),
        feedbacks: analisarFeedbacks(feedbacks),
        moderacoes: analisarModeracoes(moderacoes),
        moderacoesAceitas: aceitas.length,
        moderacoesNegadas: negadas.length,
        coerentesAntes: coerentesAll.filter(r => r._data && r._data < dataInicio).length,
        feedbacksAntes: feedbacksAll.filter(r => r._data && r._data < dataInicio).length,
        proposta,
        recomendacao: ''
    };
    relatorio.recomendacao = escolherRecomendacao(proposta);

    imprimirRelatorio(relatorio);

    const outPath = path.join(__dirname, 'auditoria', 'relatorio-aprendizado.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(relatorio, null, 2), 'utf8');
    console.log(`\n💾 Relatório JSON: ${outPath}`);
}

main().catch(err => {
    console.error('❌ Falha na auditoria:', err);
    process.exit(1);
});
