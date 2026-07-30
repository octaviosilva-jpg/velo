# Relatório — Fase 1 Plan-and-Execute (PEV)

**Data:** 2026-07-30  
**Escopo:** Planner + Executor + DeterministicGate + integração via feature flags  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/shared/curadoriaCoerentes.js` |
| `resposta-pipeline/openaiStep.js` |
| `resposta-pipeline/promptRegistry.js` |
| `resposta-pipeline/steps.js` |
| `resposta-pipeline/orchestrator.js` |
| `resposta-pipeline/deterministicGate.js` |
| `resposta-pipeline/resultMapper.js` |
| `resposta-pipeline/__tests__/curadoriaCoerentes.test.js` |
| `resposta-pipeline/__tests__/contracts.test.js` |
| `resposta-pipeline/__tests__/deterministicGate.test.js` |
| `resposta-pipeline/__tests__/flags.test.js` |
| `resposta-pipeline/__tests__/orchestrator.mock.test.js` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/preProcessor.js` | Importa curadoria compartilhada |
| `resposta-pipeline/contracts.js` | RascunhoMiolo, validadores completos |
| `resposta-pipeline/constants.js` | NODES Fase 1, DEFAULTS LLM, PRICES |
| `resposta-pipeline/workflowState.js` | applyStepResult, campos Fase 1 |
| `resposta-pipeline/persistence.js` | persistWorkflowState → `data/resposta_pipeline_pev/` |
| `resposta-pipeline/index.js` | isPevPlanExecEnabled, runPlanExec |
| `server.js` | Branch PEV; curadoria unificada; reformularComConhecimento refatorado |
| `.gitignore` | `data/resposta_pipeline_pev/` |

---

## 2. Estrutura atualizada do pacote resposta-pipeline

```
resposta-pipeline/
├── adapters/
│   └── learningLayer.js
├── shared/
│   └── curadoriaCoerentes.js
├── __tests__/
│   ├── curadoriaCoerentes.test.js
│   ├── contracts.test.js
│   ├── deterministicGate.test.js
│   ├── flags.test.js
│   ├── orchestrator.mock.test.js
│   └── preProcessor.test.js
├── constants.js
├── contracts.js
├── preProcessor.js
├── promptRegistry.js
├── steps.js
├── openaiStep.js
├── orchestrator.js
├── deterministicGate.js
├── resultMapper.js
├── workflowState.js
├── persistence.js
├── telemetry.js
└── index.js
```

---

## 3. Fluxo implementado

```
PreProcessor (código)
      ↓
InsumosPreparados
      ↓
Planner (LLM — planner@v1)
      ↓  [retry técnico 1x se JSON inválido]
PlanoDeResposta
      ↓
Executor (LLM — executor@v1)
      ↓  [retry até 2x se DeterministicGate reprovar]
RascunhoMiolo
      ↓
DeterministicGate (código)
      ↓
formatarRespostaRA (server.js — envelope)
```

### Persistência dos artefatos

| Artefato | Onde | Diretório |
|----------|------|-----------|
| Estado completo do workflow | `persistence.persistWorkflowState()` | `data/resposta_pipeline_pev/{executionId}.json` |
| InsumosPreparados | `state.artefatos[]` + campo `insumosPreparados` | idem |
| PlanoDeResposta | `state.planoDeResposta` + artefato com hash do prompt | idem |
| RascunhoMiolo | `state.rascunhoMiolo` + artefato Executor | idem |
| VereditoGate | `state.vereditoGate` + artefato DeterministicGate | idem |
| Shadow Fase 0 (inalterado) | `persistShadowState()` | `data/resposta_pipeline_shadow/` |

---

## 4. Prompt Registry

### Prompts criados

| Ref | Responsabilidade | Saída |
|-----|------------------|-------|
| `planner@v1` | Compreensão, estratégia, plano argumentativo | JSON `PlanoDeResposta` |
| `executor@v1` | Redação do miolo conforme plano | JSON `{ conteudo }` → `RascunhoMiolo` |

### Versionamento (imutabilidade)

- Chaves no formato `id@version` (`planner@v1`, `planner@v1.1`, `executor@v1`, …)
- **Versões publicadas nunca são editadas** — correções exigem nova chave
- Versão ativa definida em `steps.js` via `promptRef`
- Cada chamada LLM persiste `promptId@version` + SHA-256 do prompt renderizado em `state.artefatos[]`

### Coexistência futura

Novas versões são adicionadas ao `REGISTRY` sem remover as anteriores. Rollout = alterar `promptRef` em `steps.js`.

---

## 5. Contratos em uso

- **PlanoDeResposta:** produzido pelo Planner via `steps.PLANNER.toPartial()`; validado por `isPlanoDeRespostaValid()` + `assertFatosSubset()`
- **RascunhoMiolo:** produzido pelo Executor; validado por `isRascunhoMioloValid()`
- **VereditoBase:** produzido pelo DeterministicGate via `validateMiolo()`
- **schemaVersion:** `"1.0"` em todos os artefatos
- Nenhum campo fora dos contratos v1 foi introduzido nos artefatos públicos

---

## 6. Refatoração da curadoria

| Antes | Depois |
|-------|--------|
| Lógica duplicada em `preProcessor.js` e `server.js` | Fonte única: `shared/curadoriaCoerentes.js` |
| `reformularComConhecimento()` com bloco inline ~40 linhas | Chama `selecionarCoerentesCurados()` + montagem de prompt inalterada |

**Equivalência:** mesmo algoritmo (Jaccard, limiar `max(0.10, simTopo*0.4)`, filtro motivo, fallback top-1, orçamento 60k, max 3). Teste `curadoriaCoerentes.test.js` valida seleção e regimes.

---

## 7. Testes

| Arquivo | Cenários |
|---------|----------|
| `curadoriaCoerentes.test.js` | Seleção coerentes, similaridade, regimes vazia/parcial/completa |
| `contracts.test.js` | PlanoDeResposta, assertFatosSubset, RascunhoMiolo, Veredito |
| `deterministicGate.test.js` | Comprimento, frases genéricas, reflexo de solução |
| `flags.test.js` | `getPipelineMode`, `isPevPlanExecEnabled` |
| `preProcessor.test.js` | InsumosPreparados, shadow flags (Fase 0) |
| `orchestrator.mock.test.js` | Fluxo completo mock; retry técnico Planner; retry Executor |

**Execução:** `node resposta-pipeline/__tests__/<arquivo>.test.js` — todos passando.

---

## 8. Compatibilidade

| Configuração | Comportamento |
|--------------|---------------|
| `RESPOSTA_PIPELINE_MODE=off` | Monólito (produção atual) |
| `RESPOSTA_PIPELINE_MODE=shadow` | PreProcessor shadow + monólito |
| `RESPOSTA_PIPELINE_MODE=pev` + `PEV_PLAN_EXEC_ENABLED=false` | Monólito (default seguro) |
| `RESPOSTA_PIPELINE_MODE=pev` + `PEV_PLAN_EXEC_ENABLED=true` | Pipeline Plan-and-Execute |

**Rollback:** `PEV_PLAN_EXEC_ENABLED=false` — imediato, sem redeploy.

---

## 9. Checklist da Fase 1

| Item | Status | Justificativa |
|------|--------|---------------|
| Curadoria unificada | ✅ | `shared/curadoriaCoerentes.js` |
| Prompt Registry (planner@v1, executor@v1) | ✅ | Imutabilidade documentada |
| Planner → PlanoDeResposta | ✅ | JSON only, retry técnico 1x |
| Executor → RascunhoMiolo | ✅ | Consome plano + matrizAutoridade |
| Orchestrator Plan→Execute | ✅ | `runPlanExecPipeline()` |
| DeterministicGate v1 | ✅ | Critérios determinísticos |
| Retry Executor (max 2) | ✅ | `DEFAULTS.maxExecutorRetries: 2` |
| Persistência Plano + Rascunho | ✅ | `data/resposta_pipeline_pev/` |
| Feature flag rollout | ✅ | `pev` + `PEV_PLAN_EXEC_ENABLED` |
| Monólito preservado | ✅ | Branch condicional em server.js |
| AuditorFactual/Editorial | ❌ | Fase 2/3 — fora de escopo |
| RetryRouter completo | ❌ | Fase 2+ — fora de escopo |

---

## 10. Autoauditoria

| Pergunta | Resposta |
|----------|----------|
| Algum contrato congelado foi alterado? | **Não.** Enums, schemaVersion e campos v1 preservados. Apenas completada documentação/validação de `RascunhoMiolo`. |
| Alguma decisão arquitetural foi tomada? | **Não.** Implementação seguiu Architecture Freeze e plano aprovado. |
| Algum componente de fases futuras foi antecipado? | **Não.** Sem Auditores LLM, RetryRouter ou skip condicional. |
| Existe ponto que exija ADR antes da Fase 2? | **Não.** Próxima fase (AuditorFactual) já prevista no plano; nenhum impedimento estrutural identificado. |

---

## Ativação gradual recomendada

1. Deploy com `RESPOSTA_PIPELINE_MODE=pev` e `PEV_PLAN_EXEC_ENABLED=false`
2. Validar persistência em `data/resposta_pipeline_pev/` em ambiente de teste
3. Ativar `PEV_PLAN_EXEC_ENABLED=true` em tráfego parcial
4. Monitorar telemetria (`promptVersions`, `hashes`, retries, fallback rate)
