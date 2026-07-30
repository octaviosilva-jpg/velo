# Relatório — Fase 3 Auditor Editorial (PEV)

**Data:** 2026-07-30  
**Escopo:** AuditorEditorial adversarial pós-AuditorFactual (ou pós-Gate), retries inline, rollout via `PEV_EDITORIAL_AUDITOR_ENABLED`  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/__tests__/contracts.editorial.test.js` |
| `resposta-pipeline/__tests__/auditorEditorial.step.test.js` |
| `resposta-pipeline/__tests__/orchestrator.editorial.mock.test.js` |
| `auditoria/RELATORIO_FASE3_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/constants.js` | `NODES.AUDITOR_EDITORIAL`, DEFAULTS editorial |
| `resposta-pipeline/contracts.js` | `isVereditoEditorialValid()` (rejeita `planner`) |
| `resposta-pipeline/promptRegistry.js` | `auditor-editorial@v1`; bloco `editorialFeedback` em `executor@v1` |
| `resposta-pipeline/steps.js` | Step `AUDITOR_EDITORIAL`; `editorialFeedback` em `EXECUTOR.buildCtx` |
| `resposta-pipeline/workflowState.js` | Campos Fase 3 |
| `resposta-pipeline/orchestrator.js` | `runAuditorEditorialWithTechnicalRetry`, `runEditorialAuditWithRetry` |
| `resposta-pipeline/index.js` | `isPevEditorialAuditorEnabled()` |
| `resposta-pipeline/persistence.js` | Métricas editorial em `resumo()` |
| `resposta-pipeline/resultMapper.js` | Métricas editorial |
| `resposta-pipeline/__tests__/flags.test.js` | Testes da nova flag |
| `resposta-pipeline/__tests__/orchestrator.mock.test.js` | Regressão Fase 1 |
| `resposta-pipeline/__tests__/orchestrator.factual.mock.test.js` | Regressão Fase 2 |

---

## 2. Fluxo implementado

```
PreProcessor (código)
      ↓
Planner (LLM — planner@v1)
      ↓
Executor (LLM — executor@v1)
      ↓
DeterministicGate (código — inalterado)
      ↓
AuditorFactual (LLM — auditor-factual@v1)   ← Fase 2, condicional
      ↓
AuditorEditorial (LLM — auditor-editorial@v1)   ← Fase 3, condicional
      ↓
formatarRespostaRA (server.js)
```

Com `PEV_EDITORIAL_AUDITOR_ENABLED=false`, o fluxo permanece idêntico à Fase 2 (ou Fase 1 se factual também desligado).

---

## 3. Feature flags

| Variável | Default | Efeito |
|----------|---------|--------|
| `RESPOSTA_PIPELINE_MODE` | `off` | Monólito / shadow / pev |
| `PEV_PLAN_EXEC_ENABLED` | `false` | Fase 1 |
| `PEV_FACTUAL_AUDITOR_ENABLED` | `false` | Fase 2 |
| **`PEV_EDITORIAL_AUDITOR_ENABLED`** | **`false`** | **Fase 3 — Auditor editorial** |

**Ativação Fase 3 completa:**

```
mode=pev AND PEV_PLAN_EXEC_ENABLED=true
AND PEV_FACTUAL_AUDITOR_ENABLED=true
AND PEV_EDITORIAL_AUDITOR_ENABLED=true
```

**Rollback:** `PEV_EDITORIAL_AUDITOR_ENABLED=false` → Fase 2 imediata.

---

## 4. Contrato VereditoEditorial

Alias de `VereditoBase` (schemaVersion 1.0, congelado). Validador dedicado:

- `isVereditoEditorialValid()` — prefixo `editorial.*` em todas as falhas
- `recomendacaoRetry=planner` **rejeitado** pelo validador
- `aprovado=true` ⇒ `falhas=[]` e `recomendacaoRetry=nenhum`
- `aprovado=false` ⇒ `falhas.length>=1` e `recomendacaoRetry=executor`

Taxonomia: `editorial.evasao_sac`, `editorial.generico`, `editorial.resolutividade`, `editorial.profundidade`, `editorial.tom`, `editorial.conformidade_aenv`, `editorial.tema_ra`, `editorial.clausula_contratual`, `editorial.problema_resolvido_unico`.

---

## 5. Rubrica interna (Opção trace)

O prompt `auditor-editorial@v1` pode emitir `_rubrica_trace` na mesma inferência LLM. Persistido em `state.artefatos[]` como `RubricaAuditTrace` (não-contrato), removido antes da validação pública.

---

## 6. Estratégia de retry (inline)

| Origem | Condição | Alvo | Max tentativas |
|--------|----------|------|----------------|
| Gate | reprovação | Executor | 2 (Fase 1) |
| AuditorFactual | `recomendacaoRetry=executor` | Executor | 2 pós-gate |
| AuditorEditorial | `recomendacaoRetry=executor` | Executor | 2 pós-factual |
| AuditorEditorial | JSON inválido | Auditor | 1 retry técnico |
| Esgotamento | retries esgotados | Fallback mecânico | — |

Retry editorial revalida **Gate → [Factual] → Editorial** end-to-end.

`editorialFeedback` injetado via `buildCtx` em **`executor@v1`** (sem nova versão do prompt).

**RetryRouter:** fora de escopo — refactor independente em fase posterior.

---

## 7. Persistência e métricas

Novos campos em `persistence.resumo()` e `resultMapper.metrics`:

- `editorialRetryCount`
- `auditorEditorialTechnicalRetryCount`
- `vereditoEditorialAprovado`
- `falhasEditorialTipos`

Artefatos: `VereditoEditorial`, `RubricaAuditTrace`, prompt audit do auditor editorial.

---

## 8. Testes

| Arquivo | Cenários |
|---------|----------|
| `contracts.editorial.test.js` | Validador, prefixos, rejeição de `planner` |
| `auditorEditorial.step.test.js` | `buildCtx`, `toPartial`, `editorialFeedback` no Executor |
| `orchestrator.editorial.mock.test.js` | Factual+Editorial OK; retry Executor; retry técnico; fallback; editorial sem factual |
| `orchestrator.factual.mock.test.js` | Editorial desligado = Fase 2 idêntica |
| `orchestrator.mock.test.js` | Ambos auditores desligados = Fase 1 |

**Resultado:** 9 suites OK (incluindo regressão Fases 1–2).

---

## 9. Fora de escopo (mantido)

- RetryRouter (`retryRouter.js`) — fase posterior
- Skip condicional de auditores (Fase 4)
- Back-edge estratégico ao Planner
- Desativação obrigatória do monólito
- Alteração de contratos/enums/schemaVersion v1 congelados

---

## 10. Ativação gradual recomendada

1. Deploy com `PEV_EDITORIAL_AUDITOR_ENABLED=false` — validar regressão Fase 2
2. Ativar editorial em shadow/amostra com factual ativo
3. Monitorar `falhasEditorialTipos`, `editorialRetryCount`, taxa fallback
4. Comparar resolutividade/conformidade AENV vs baseline monólito (n ≥ 30)
