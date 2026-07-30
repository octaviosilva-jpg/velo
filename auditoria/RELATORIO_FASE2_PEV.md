# Relatório — Fase 2 Auditor Factual (PEV)

**Data:** 2026-07-30  
**Escopo:** AuditorFactual adversarial pós-DeterministicGate, retry focalizado no Executor, rollout via `PEV_FACTUAL_AUDITOR_ENABLED`  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/__tests__/contracts.factual.test.js` |
| `resposta-pipeline/__tests__/auditorFactual.step.test.js` |
| `resposta-pipeline/__tests__/orchestrator.factual.mock.test.js` |
| `auditoria/RELATORIO_FASE2_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/constants.js` | `NODES.AUDITOR_FACTUAL`, DEFAULTS auditor (model, temp, tokens, retries) |
| `resposta-pipeline/contracts.js` | `isVereditoFactualValid()` |
| `resposta-pipeline/promptRegistry.js` | `auditor-factual@v1` (append-only); `executor@v1` suporte `factualFeedback` |
| `resposta-pipeline/steps.js` | Step `AUDITOR_FACTUAL`; `mapVereditoFromParsed`; Executor com factualFeedback |
| `resposta-pipeline/workflowState.js` | `vereditoFactual`, `factualRetryCount`, `auditorTechnicalRetryCount` |
| `resposta-pipeline/orchestrator.js` | `runAuditorWithTechnicalRetry`, `runFactualAuditWithRetry`; integração pós-gate |
| `resposta-pipeline/index.js` | `isPevFactualAuditorEnabled()`, passagem de flag ao orchestrator |
| `resposta-pipeline/persistence.js` | Métricas factual em `resumo()` |
| `resposta-pipeline/resultMapper.js` | Métricas factual em `metrics` |
| `resposta-pipeline/__tests__/flags.test.js` | Testes da nova flag |
| `resposta-pipeline/__tests__/orchestrator.mock.test.js` | Regressão Fase 1 com auditor desligado |

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
formatarRespostaRA (server.js)
```

Com `PEV_FACTUAL_AUDITOR_ENABLED=false`, o fluxo permanece idêntico à Fase 1.

---

## 3. Feature flags

| Variável | Default | Efeito |
|----------|---------|--------|
| `RESPOSTA_PIPELINE_MODE` | `off` | Monólito / shadow / pev |
| `PEV_PLAN_EXEC_ENABLED` | `false` | Fase 1 Plan-and-Execute |
| **`PEV_FACTUAL_AUDITOR_ENABLED`** | **`false`** | **Fase 2 — Auditor após Gate** |

**Ativação completa:** `mode=pev` AND `PEV_PLAN_EXEC_ENABLED=true` AND `PEV_FACTUAL_AUDITOR_ENABLED=true`

**Rollback:** `PEV_FACTUAL_AUDITOR_ENABLED=false` → volta ao fluxo Fase 1 imediatamente.

---

## 4. Contrato VereditoFactual

Alias de `VereditoBase` (schemaVersion 1.0, congelado). Validador dedicado:

- `isVereditoFactualValid()` — prefixo `factual.*` em todas as falhas
- `aprovado=true` ⇒ `falhas=[]` e `recomendacaoRetry=nenhum`
- `aprovado=false` ⇒ `falhas.length>=1` e `recomendacaoRetry≠nenhum`

Taxonomia de falhas: `factual.inventao`, `factual.omissao`, `factual.contradicao`, `factual.exclusao_violada`, `factual.vazamento_coerente`, `factual.norma_ausente`.

---

## 5. Auditoria claim-aware (Opção B)

O prompt `auditor-factual@v1` instrui decomposição claim-a-claim **na mesma inferência LLM**:

1. Enumerar claims factuais do miolo
2. Verificar cada claim contra fontes autorizadas
3. Emitir `VereditoFactual` público

Campo interno `_claims_trace` é persistido em `state.artefatos[]` como `ClaimsAuditTrace` (não-contrato), removido antes da validação pública.

---

## 6. Estratégia de retry

| Origem | Condição | Alvo | Max tentativas |
|--------|----------|------|----------------|
| Gate | reprovação determinística | Executor | 2 (Fase 1) |
| Auditor | `recomendacaoRetry=executor` | Executor | 2 pós-gate |
| Auditor | JSON inválido | Auditor | 1 retry técnico |
| Auditor | `recomendacaoRetry=planner` | Fallback | — |
| Esgotamento | retries esgotados | Fallback mecânico | — |

`PlanoDeResposta` permanece imutável durante retries factuais (write-guard + sem back-edge ao Planner).

---

## 7. Persistência e métricas

Novos campos em `persistence.resumo()` e `resultMapper.metrics`:

- `factualRetryCount`
- `auditorTechnicalRetryCount`
- `vereditoFactualAprovado`
- `falhasFactualTipos`

Artefatos adicionais: `VereditoFactual`, `ClaimsAuditTrace`, prompt audit do auditor.

Diretório inalterado: `data/resposta_pipeline_pev/{executionId}.json`

---

## 8. Testes

| Arquivo | Cenários |
|---------|----------|
| `contracts.factual.test.js` | Validador, prefixos, coerência aprovado/falhas/retry |
| `auditorFactual.step.test.js` | `buildCtx`, `toPartial`, snake_case → camelCase |
| `orchestrator.factual.mock.test.js` | Gate OK → Auditor OK; retry Executor; retry técnico; esgotamento → fallback; planner → fallback |
| `orchestrator.mock.test.js` | Regressão Fase 1 com auditor desligado |
| `flags.test.js` | `isPevFactualAuditorEnabled` |

**Resultado:** 7 suites OK (incluindo Fase 1 intacta).

---

## 9. Fora de escopo (mantido)

- AuditorEditorial (Fase 3)
- RetryRouter completo
- Back-edge estratégico ao Planner
- Alteração de DeterministicGate, planner@v1, executor@v1 (prompts congelados)
- Alteração de contratos/enums/schemaVersion v1

---

## 10. Próximos passos sugeridos

1. Rollout gradual: shadow com auditor ativo para comparar métricas vs Fase 1
2. Monitorar `falhasFactualTipos` e `factualRetryCount` em produção parcial
3. Se taxa de `recomendacaoRetry=planner` > 10%, avaliar ADR para back-edge (Fase 3)
4. Fase 3: AuditorEditorial + RetryRouter
