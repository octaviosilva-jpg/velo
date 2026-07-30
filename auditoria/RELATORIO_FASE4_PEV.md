# Relatório — Fase 4 Execução Condicional dos Auditores (PEV)

**Data:** 2026-07-30  
**Escopo:** Skip determinístico de auditores LLM via `auditorSkipPolicy.js`, integrado no orchestrator pós-Gate, com artefatos auditáveis, shadow mode e flags de rollout  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/auditorSkipPolicy.js` |
| `resposta-pipeline/__tests__/auditorSkipPolicy.test.js` |
| `resposta-pipeline/__tests__/orchestrator.conditional.mock.test.js` |
| `auditoria/RELATORIO_FASE4_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/constants.js` | `NODES.AUDITOR_SKIP_POLICY`, `SKIP_POLICY_VERSION`, `SKIP_MOTIVO` |
| `resposta-pipeline/workflowState.js` | Campos skip (`factualAuditorSkipped`, `editorialAuditorSkipped`, `skipDecisions`, flags) |
| `resposta-pipeline/orchestrator.js` | Hooks pré-auditor, shadow mode, estimativa de economia |
| `resposta-pipeline/index.js` | Flags Fase 4 + repasse ao orchestrator |
| `resposta-pipeline/persistence.js` | Métricas skip em `resumo()` |
| `resposta-pipeline/resultMapper.js` | Métricas skip |
| `resposta-pipeline/__tests__/flags.test.js` | Testes das novas flags |

**Explicitamente inalterados:** Planner, Executor, DeterministicGate, auditores, contratos v1, prompts, `retryRouter.js`.

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
AuditorSkipPolicy (código) → [AuditorFactual]   ← Fase 4, condicional
      ↓
AuditorSkipPolicy (código) → [AuditorEditorial]   ← Fase 4, condicional
      ↓
formatarRespostaRA (server.js)
```

Com `PEV_CONDITIONAL_AUDIT_ENABLED=false`, o fluxo permanece idêntico à Fase 3.

---

## 3. Feature flags

| Variável | Default | Efeito |
|----------|---------|--------|
| (existentes) | | `PEV_PLAN_EXEC`, `PEV_FACTUAL_AUDITOR`, `PEV_EDITORIAL_AUDITOR` |
| **`PEV_CONDITIONAL_AUDIT_ENABLED`** | **`false`** | **Master — ativa avaliação de skip** |
| **`PEV_CONDITIONAL_AUDIT_SHADOW`** | **`false`** | **Shadow: loga decisão, executa auditores** |
| **`PEV_SKIP_FACTUAL_TIER1_ENABLED`** | **`false`** | **Sub-flag: skip factual Tier 1** |

**Ativação Fase 4 completa (skip editorial real):**

```
mode=pev
AND PEV_PLAN_EXEC_ENABLED=true
AND PEV_FACTUAL_AUDITOR_ENABLED=true
AND PEV_EDITORIAL_AUDITOR_ENABLED=true
AND PEV_CONDITIONAL_AUDIT_ENABLED=true
AND PEV_CONDITIONAL_AUDIT_SHADOW=false
```

**Rollback:** `PEV_CONDITIONAL_AUDIT_ENABLED=false` → Fase 3 imediata.

---

## 4. Política de skip (`auditorSkipPolicy.js`)

### Precedência (5 níveis)

1. **Vetos globais** (`V01`–`V04`) → sempre executar
2. **Flags** (`flag.master_off`, `flag.auditor_off`, `flag.factual_tier1_off`)
3. **Regras do auditor** — Factual `F01`–`F08` / Editorial `E01`–`E04`, `E06` (AND)
4. **Anti skip-duplo** (`E05`) — factual skipped → editorial obrigatório
5. **Decisão final skip** — `skip.factual.tier1_*` / `skip.editorial.tier1_*`

### Invariantes (I1–I6)

Toda regra futura deve: pertencer a um nível de precedência; ter ID único; ser determinística; não produzir efeitos colaterais; ter teste unitário; possuir justificativa arquitetural.

### Versionamento

`SKIP_POLICY_VERSION = '1.0'` em `constants.js`.

---

## 5. Contrato interno — `DecisaoExecucaoAuditor`

Artefato operacional (não-contrato v1), persistido em `state.artefatos[]`:

- `policyVersion`, `alvo`, `executar`, `codigoMotivo`
- `regrasAvaliadas[]`, `regraDecisiva`, `fasePrecedencia`
- `evidencias` (snapshot determinístico)
- `shadowMode`

Quando `executar=false` (skip real):

- Auditor **não** é invocado
- `vereditoFactual` / `vereditoEditorial` permanecem `null`
- `factualAuditorSkipped` / `editorialAuditorSkipped` = `true`
- Evento `skip.auditor` em `decisionLog`

---

## 6. Integração no orchestrator

- Avaliação **immediately before** cada auditor, **após Gate aprovado**
- **Shadow mode:** política roda igual; orchestrator ignora `executar=false` e chama auditor; artefato com `shadowMode: true`
- Retries reavaliam política a cada passagem (`V03` impede skip após retry de Executor)
- Skip factual Tier 1 (sub-flag) → editorial **obrigatoriamente** executa (`E05` / `E06`)

---

## 7. Persistência e métricas

Novos campos em `persistence.resumo()` e `resultMapper.metrics`:

- `factualAuditorSkipped`, `editorialAuditorSkipped`
- `skipCodigoMotivoFactual`, `skipCodigoMotivoEditorial`
- `policyVersion`
- `tokensEconomizadosEstimados`, `latenciaEconomizadaMs`

Artefatos: `DecisaoExecucaoAuditor` (node `AUDITOR_SKIP_POLICY`).

---

## 8. Testes

| Arquivo | Cenários |
|---------|----------|
| `auditorSkipPolicy.test.js` | Skip editorial Tier 1; vetos vazia/parcial/retry; anti skip-duplo; precedência V03 vs F01–F08; flag master off; factual tier1 sub-flag |
| `orchestrator.conditional.mock.test.js` | Skip editorial → 3 LLM calls; shadow → 4 calls + artefato; conditional off = Fase 3; skip factual + editorial obrigatório; tokens economizados |
| `flags.test.js` | Novas flags Fase 4 |
| Suites Fases 1–3 | Regressão intacta com flags false |

**Resultado:** 14 suites OK.

---

## 9. Rollout incremental recomendado

1. **Fase 4a — Shadow:** `CONDITIONAL_AUDIT_ENABLED=true`, `SHADOW=true` — calibrar `divergencia_shadow`
2. **Fase 4b — Skip editorial Tier 1:** shadow off; factual sempre executa
3. **Fase 4c — Skip factual Tier 1:** sub-flag on em amostra; editorial obrigatório quando factual skip

---

## 10. Fora de escopo (mantido)

- Modificar Planner, Executor, Gate, auditores, contratos v1
- RetryRouter (`retryRouter.js`)
- ML / scoring probabilístico
- Política Tier 2+ (requer ADR)
- Suite regressão CI completa (`casos.json`)

---

## 11. Metas Architecture Freeze Fase 4

| Indicador | Meta |
|-----------|------|
| Latência p95 | −20% vs Fase 3 |
| Custo tokens/request | −15–25% |
| Chamadas LLM médias | 2,5–3,5 (vs 4 fixo) |
| Qualidade humana | ≥ Fase 3 |

Medição pós-rollout via shadow mode, amostragem estratificada e monitoramento de `falhasEditorialTipos`.
