# Relatório — Fase 4.5 Observabilidade do Pipeline PEV

**Data:** 2026-07-30  
**Escopo:** Camada passiva de observabilidade — indexação, agregações, consultas, dashboards e exportações sobre artefatos PEV existentes  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/observability/constants.js` |
| `resposta-pipeline/observability/metricsCatalog.js` |
| `resposta-pipeline/observability/percentiles.js` |
| `resposta-pipeline/observability/executionExtractor.js` |
| `resposta-pipeline/observability/aggregator.js` |
| `resposta-pipeline/observability/indexer.js` |
| `resposta-pipeline/observability/queryService.js` |
| `resposta-pipeline/observability/exportService.js` |
| `resposta-pipeline/observability/dashboardViews.js` |
| `resposta-pipeline/observability/reindex.js` |
| `resposta-pipeline/observability/index.js` |
| `resposta-pipeline/observability/__tests__/*.test.js` |
| `pev-observabilidade.html` |
| `auditoria/RELATORIO_FASE45_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/index.js` | Flags observabilidade + hook async pós-persist |
| `server.js` | Endpoints `/api/pev/observabilidade/*` |
| `resposta-pipeline/__tests__/flags.test.js` | Testes novas flags |
| `.gitignore` | `data/pev_observability/` |

**Explicitamente inalterados:** Planner, Executor, Gate, auditores, `auditorSkipPolicy`, contratos v1, prompts, política de skip.

---

## 2. Arquitetura

```
Pipeline PEV (Fases 1–4) → persistWorkflowState → data/resposta_pipeline_pev/
                              ↓ (async, flag on)
                         indexer → ExecutionSnapshot → data/pev_observability/
                              ↓
                         aggregator (daily/weekly/monthly)
                              ↓
                    queryService / exportService / dashboards
```

Observabilidade **somente leitura** — não altera workflowState, vereditos ou decisões de skip.

---

## 3. Feature flags

| Variável | Default | Efeito |
|----------|---------|--------|
| **`PEV_OBSERVABILITY_ENABLED`** | **`false`** | Indexação async + APIs |
| **`PEV_OBSERVABILITY_EXPORTS`** | **`false`** | POST export CSV/JSON/Markdown |

**Ativação:**

```
PEV_OBSERVABILITY_ENABLED=true
PEV_OBSERVABILITY_EXPORTS=true   # opcional
```

**Rollback:** `PEV_OBSERVABILITY_ENABLED=false` — pipeline inalterado; APIs retornam 503.

---

## 4. Persistência

```
data/pev_observability/
  meta/           index_manifest.json, last_indexed.json, metrics_version.json
  snapshots/      by_date/YYYY-MM-DD/{executionId}.snapshot.json
  aggregates/     daily|weekly|monthly/*.json
  exports/        arquivos gerados sob demanda
```

JSON bruto PEV permanece em `data/resposta_pipeline_pev/` (formato inalterado).

`METRICS_VERSION = '1.0'`

---

## 5. Métricas cobertas

- **Pipeline:** volume, sucesso, fallback, latência P50/P95/P99, chamadas LLM, tokens, custo
- **Planner:** distribuições modo/regime/fonte, retries técnicos
- **Executor/Gate:** retries, aprovação 1ª passagem, falhas por tipo
- **Auditores:** execução, skip, aprovação, falhas, retries, duração
- **Skip Policy:** taxas skip, estratos, codigoMotivo, regraDecisiva, fasePrecedencia, divergencia_shadow, economia
- **Financeiro:** tokens/custo totais, economizados, percentual

---

## 6. API REST

| Rota | Descrição |
|------|-----------|
| `GET /api/pev/observabilidade/resumo` | KPIs consolidados |
| `GET .../pipeline` | Métricas pipeline |
| `GET .../planner` | Distribuições planner |
| `GET .../executor-gate` | Executor + Gate |
| `GET .../auditores` | Factual + Editorial |
| `GET .../skip-policy` | Skip + estratos |
| `GET .../shadow` | Divergências shadow |
| `GET .../qualidade` | Aprovações e falhas |
| `GET .../execucao/:id` | Snapshot indexado |
| `GET .../dashboard/:tipo` | executivo \| tecnico \| shadow \| qualidade |
| `POST .../reindex` | Rebuild índice |
| `POST .../export` | CSV / JSON / Markdown |

---

## 7. Dashboards

Página [`pev-observabilidade.html`](pev-observabilidade.html):

- **Executivo** — volume, fallback, latência, tokens, economia
- **Técnico** — retries, gate, skip, auditores
- **Shadow** — divergência temporal + tabela
- **Qualidade** — aprovações, top falhas

---

## 8. CLI

```bash
node resposta-pipeline/observability/reindex.js
node resposta-pipeline/observability/reindex.js --force
```

---

## 9. Testes

| Arquivo | Cenários |
|---------|----------|
| `executionExtractor.test.js` | Snapshot Fase 4, compat Fase 1, reprodutibilidade |
| `aggregator.test.js` | Rollup daily, merge, percentis |
| `skipShadow.test.js` | divergencia_shadow |
| `indexer.test.js` | Indexação, dedupe, force |
| `exportService.test.js` | CSV, JSON, Markdown |
| `perf.test.js` | 200 agregações < 5s |
| `flags.test.js` | Novas flags |
| Suites Fases 1–4 | Regressão intacta |

**Resultado:** 21 suites OK.

---

## 10. Rollout recomendado

1. Deploy com flags off — validar regressão pipeline
2. `PEV_OBSERVABILITY_ENABLED=true` em staging — reindex backfill
3. Validar dashboards 7 dias
4. Habilitar exports se necessário
5. Produção gradual

---

## 11. Fora de escopo (mantido)

- Grafana, Prometheus, OpenTelemetry, BI externo
- Streaming, tempo real, alertas automáticos
- ML, Chance de Moderação (Fase 5)
- Alteração de artefatos PEV existentes
