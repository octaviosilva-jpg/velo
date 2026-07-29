'use strict';

/**
 * Runner de regressao/baseline (FASE 0 + FASE 6).
 * Envia cada caso para /api/generate-moderation do servidor EM EXECUCAO e captura,
 * SEM instrumentar a V1: latencia, tempo total, taxa de sucesso, tamanho da resposta e
 * os campos do contrato (auditoria/raciocinio/texto/confiancaBaixa).
 *
 * Para gerar o baseline V1: rode o servidor com MODERACAO_PIPELINE_V2 desligado e:
 *   node moderacao-pipeline/regression/runCases.js --label=v1 --base=http://localhost:3000 \
 *        --casos=moderacao-pipeline/regression/casos.json --out=moderacao-pipeline/regression/out/v1.json
 *
 * Para o V2: rode o servidor com MODERACAO_PIPELINE_V2=true e use --label=v2 --out=.../v2.json
 *
 * NAO faz chamadas pagas por conta propria: apenas exercita o endpoint ja existente.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = {};
    for (const a of argv.slice(2)) {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
        else if (a.startsWith('--')) out[a.slice(2)] = true;
    }
    return out;
}

function pct(arr, p) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[i];
}

async function main() {
    const args = parseArgs(process.argv);
    const label = args.label || 'run';
    const base = (args.base || 'http://localhost:3000').replace(/\/$/, '');
    const casosPath = args.casos || path.join(__dirname, 'casos.json');
    const outPath = args.out || path.join(__dirname, 'out', `${label}.json`);

    if (!fs.existsSync(casosPath)) {
        console.error(`[runCases] arquivo de casos nao encontrado: ${casosPath}`);
        console.error('Copie casos.example.json para casos.json e preencha com casos reais.');
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(casosPath, 'utf8'));
    const casos = Array.isArray(raw) ? raw : (raw.casos || []);
    if (!casos.length) {
        console.error('[runCases] nenhum caso encontrado no arquivo.');
        process.exit(1);
    }

    console.log(`[runCases] label=${label} base=${base} casos=${casos.length}`);
    const resultados = [];
    const latencias = [];
    let sucessos = 0;
    const t0 = Date.now();

    for (const caso of casos) {
        const started = Date.now();
        let ok = false, status = 0, body = null, erro = null;
        try {
            const resp = await fetch(`${base}/api/generate-moderation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idReclamacao: caso.idReclamacao, dadosModeracao: caso.dadosModeracao })
            });
            status = resp.status;
            body = await resp.json().catch(() => null);
            ok = resp.ok && body && body.success === true;
        } catch (e) {
            erro = e.message;
        }
        const dur = Date.now() - started;
        latencias.push(dur);
        if (ok) sucessos++;

        const texto = (body && body.textoModeracao) || '';
        resultados.push({
            id: caso.id,
            cenario: caso.cenario || null,
            idReclamacao: caso.idReclamacao,
            ok,
            status,
            erro,
            latenciaMs: dur,
            pipelineVersion: (body && body.pipelineVersion) || 'v1',
            confiancaBaixa: body ? body.confiancaBaixa === true : null,
            executionId: (body && body.executionId) || null,
            auditoriaHipotese: (body && body.auditoriaHipotese) || '',
            linhaRaciocinio: (body && body.linhaRaciocinio) || '',
            textoModeracao: texto,
            tamanhoRespostaChars: texto.length
        });
        console.log(`  - ${caso.id}: ${ok ? 'OK' : 'FALHA'} (${dur}ms, ${texto.length} chars)`);
    }

    const tempoTotalMs = Date.now() - t0;
    const relatorio = {
        label,
        base,
        geradoEm: new Date().toISOString(),
        totalCasos: casos.length,
        metricas: {
            taxaSucesso: Number((sucessos / casos.length).toFixed(4)),
            latenciaMediaMs: Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length),
            latenciaP50Ms: pct(latencias, 50),
            latenciaP95Ms: pct(latencias, 95),
            tempoTotalMs,
            tamanhoRespostaMedioChars: Math.round(resultados.reduce((a, r) => a + r.tamanhoRespostaChars, 0) / resultados.length)
        },
        resultados
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(relatorio, null, 2), 'utf8');
    console.log(`[runCases] salvo em ${outPath}`);
    console.log('[runCases] metricas:', JSON.stringify(relatorio.metricas, null, 2));
}

main().catch(e => { console.error('[runCases] erro fatal:', e); process.exit(1); });
