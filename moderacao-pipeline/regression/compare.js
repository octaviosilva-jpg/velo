'use strict';

/**
 * Comparador V1 x V2 (FASE 6). Le dois relatorios gerados por runCases.js e produz
 * um relatorio de divergencias por caso: hipotese, confiancaBaixa, cobertura textual
 * (similaridade de Jaccard do texto final), presenca dos 3 blocos e delta de tamanho.
 *
 *   node moderacao-pipeline/regression/compare.js \
 *        --v1=moderacao-pipeline/regression/out/v1.json \
 *        --v2=moderacao-pipeline/regression/out/v2.json \
 *        --out=moderacao-pipeline/regression/out/divergencias.json
 *
 * NAO faz chamadas de rede. Apenas processa arquivos locais.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = {};
    for (const a of argv.slice(2)) {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function tokens(s) {
    return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}

function jaccard(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size && !B.size) return 1;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const uni = A.size + B.size - inter;
    return uni === 0 ? 1 : Number((inter / uni).toFixed(3));
}

function primeiraLinhaHipotese(auditoria) {
    const linha = String(auditoria || '').split('\n').find(l => /hipotese/i.test(l)) || '';
    return linha.replace(/^.*?:/, '').trim();
}

function indexById(rel) {
    const map = new Map();
    for (const r of (rel.resultados || [])) map.set(r.id, r);
    return map;
}

function main() {
    const args = parseArgs(process.argv);
    if (!args.v1 || !args.v2) {
        console.error('[compare] uso: --v1=... --v2=... [--out=...]');
        process.exit(1);
    }
    const v1 = JSON.parse(fs.readFileSync(args.v1, 'utf8'));
    const v2 = JSON.parse(fs.readFileSync(args.v2, 'utf8'));
    const outPath = args.out || path.join(__dirname, 'out', 'divergencias.json');

    const m1 = indexById(v1), m2 = indexById(v2);
    const ids = [...new Set([...m1.keys(), ...m2.keys()])];

    const divergencias = [];
    let hipDiferente = 0, confDiferente = 0, simBaixaCount = 0;

    for (const id of ids) {
        const a = m1.get(id), b = m2.get(id);
        if (!a || !b) {
            divergencias.push({ id, tipo: 'ausente', presenteEmV1: !!a, presenteEmV2: !!b });
            continue;
        }
        const hipV1 = primeiraLinhaHipotese(a.auditoriaHipotese);
        const hipV2 = primeiraLinhaHipotese(b.auditoriaHipotese);
        const simTexto = jaccard(a.textoModeracao, b.textoModeracao);
        const simRaciocinio = jaccard(a.linhaRaciocinio, b.linhaRaciocinio);
        const mesmaHip = tokens(hipV1).size && jaccard(hipV1, hipV2) >= 0.5;
        const confDif = a.confiancaBaixa !== b.confiancaBaixa;

        if (!mesmaHip) hipDiferente++;
        if (confDif) confDiferente++;
        if (simTexto < 0.5) simBaixaCount++;

        divergencias.push({
            id,
            cenario: b.cenario || a.cenario || null,
            hipoteseV1: hipV1,
            hipoteseV2: hipV2,
            mesmaHipotese: !!mesmaHip,
            confiancaBaixaV1: a.confiancaBaixa,
            confiancaBaixaV2: b.confiancaBaixa,
            confiancaDivergente: confDif,
            similaridadeTexto: simTexto,
            similaridadeRaciocinio: simRaciocinio,
            deltaTamanhoChars: (b.tamanhoRespostaChars || 0) - (a.tamanhoRespostaChars || 0)
        });
    }

    const relatorio = {
        geradoEm: new Date().toISOString(),
        v1: { label: v1.label, metricas: v1.metricas },
        v2: { label: v2.label, metricas: v2.metricas },
        resumo: {
            casosComparados: ids.length,
            hipoteseDivergente: hipDiferente,
            confiancaDivergente: confDiferente,
            textoSimilaridadeBaixa: simBaixaCount,
            similaridadeTextoMedia: Number((divergencias.filter(d => d.similaridadeTexto != null)
                .reduce((s, d) => s + d.similaridadeTexto, 0) / (ids.length || 1)).toFixed(3))
        },
        divergencias
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(relatorio, null, 2), 'utf8');
    console.log('[compare] resumo:', JSON.stringify(relatorio.resumo, null, 2));
    console.log(`[compare] salvo em ${outPath}`);
}

main();
