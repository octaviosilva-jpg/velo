# Relatório — Fase 6 Integração Chance de Moderação ao Pipeline PEV

**Data:** 2026-07-30  
**Escopo:** Integrar Chance de Moderação existente ao PEV pós-ResponseBuilder; `executarChanceModeracao()` como unidade de domínio; UI automática na aba Revisão  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/chanceModeracao/runner.js` |
| `resposta-pipeline/chanceModeracao/index.js` |
| `resposta-pipeline/__tests__/chanceModeracao.runner.test.js` |
| `auditoria/RELATORIO_FASE6_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `server.js` | `executarChanceModeracao()` (domínio); endpoint `/api/chance-moderacao` = wrapper transporte; PEV injeta função + retorna `chanceModeracao` |
| `resposta-pipeline/workflowState.js` | `chanceModeracao`, `consideracao_final`, `historico_moderacao` |
| `resposta-pipeline/index.js` | `isPevChanceModeracaoEnabled`, hook pós-orchestrator |
| `resposta-pipeline/persistence.js` | Flags chance em `resumo()` |
| `script.js` | Auto-exibir análise PEV; cache/dedup; botão Reanalisar |
| `index.html` | `id="btn-chance-moderacao"` + label dinâmico |
| `resposta-pipeline/__tests__/flags.test.js` | Teste `PEV_CHANCE_MODERACAO_ENABLED` |

**Explicitamente inalterados:** prompt V7, `motor-pontuacao/`, Planner/Executor/Gate/auditores, `finalizeWithResponseBuilder()`, `/api/aplicar-ajuste`, `/api/ajuste-manual`.

---

## 2. Fluxo integrado

```
PreProcessor → Planner → Executor → Gate → [Factual] → [Editorial]
    → ResponseBuilder (finalizeWithResponseBuilder)
    → [Fase 6] runChanceModeracao (se PEV_CHANCE_MODERACAO_ENABLED=true)
    → persistWorkflowState (inclui chanceModeracao)
    → [async] Observabilidade
    → HTTP (result + chanceModeracao opcional)
```

---

## 3. Camadas e contratos

| Camada | Local | Responsabilidade |
|--------|-------|------------------|
| **Domínio** | `executarChanceModeracao()` em `server.js` | Prompt V7, 2 LLM, parser, motor — único ponto de lógica |
| **Runner** | `chanceModeracao/runner.js` | WorkflowState ↔ input domínio; grava `state.chanceModeracao` |
| **Transporte** | `POST /api/chance-moderacao` | Validação HTTP + serialização |
| **Motor** | `motor-pontuacao/` | Inalterado |

**Regra de consumo:** código server-side (PEV) invoca `executarChanceModeracao` via deps — nunca hop HTTP interno.

---

## 4. Feature flag

- `PEV_CHANCE_MODERACAO_ENABLED=true` — executa Chance após ResponseBuilder
- **Default:** `false` (rollout seguro)

---

## 5. WorkflowState

**Consumidos:** `entradasCruas.texto_cliente`, `respostaPublica`, `consideracao_final`, `historico_moderacao`, `userData` (deps)

**Produzidos:** `chanceModeracao: { executada, sucesso, result, motor, erro, telemetria }`

---

## 6. API HTTP

### PEV (`POST /api/gerar-resposta`)

```json
{
  "success": true,
  "result": "<respostaPublica>",
  "pipeline": "pev",
  "executionId": "...",
  "usedFallback": false,
  "chanceModeracao": {
    "success": true,
    "result": "<analise>",
    "motor": { }
  }
}
```

`chanceModeracao` presente apenas quando flag ativa e runner executou.

### Standalone

`POST /api/chance-moderacao` — contrato `{ success, result, motor }` preservado; delega a `executarChanceModeracao()`.

---

## 7. UI (aba Revisão)

1. Ao gerar resposta PEV com flag + `chanceModeracao.success`: campos da aba Revisão preenchidos e análise renderizada **automaticamente** (sem segundo clique).
2. Botão renomeado para **Reanalisar** quando há cache.
3. **Dedup client-side:** Reanalisar sem alterar campos reexibe cache — sem nova requisição HTTP.
4. Alteração de campos → Reanalisar chama endpoint (transporte).

---

## 8. Persistência

JSON em `data/resposta_pipeline_pev/{executionId}.json` inclui `chanceModeracao`.

`resumo()` estende: `chanceModeracaoExecutada`, `chanceModeracaoSucesso`, `chanceFinal`.

---

## 9. Testes executados

```
23 arquivos *.test.js — ALL PASSED
Inclui chanceModeracao.runner.test.js (6 cenários) + flags PEV_CHANCE_MODERACAO_ENABLED
```

---

## 10. Critérios de aceite

| # | Critério | Status |
|---|----------|--------|
| 1 | Unidade de domínio `executarChanceModeracao()` | OK |
| 2 | Paridade motor (inalterado) | OK |
| 3 | API standalone preservada | OK |
| 4 | Contrato runner (skip, mapeamento, graceful) | OK |
| 5 | Integração PEV pós-ResponseBuilder | OK |
| 6 | Persistência `chanceModeracao` | OK |
| 7 | HTTP compatível (`result` = respostaPublica) | OK |
| 8 | ResponseBuilder intacto | OK |
| 9 | Degradação graceful | OK |
| 10 | Escopo mínimo (sem pacote chance-moderacao/) | OK |
| 11 | Regra de consumo (deps, não HTTP interno) | OK |
| 12 | UI automática na aba Revisão | OK |
| 13 | Dedup client-side | OK |

---

## 11. Ativação

```env
RESPOSTA_PIPELINE_MODE=pev
PEV_PLAN_EXEC_ENABLED=true
PEV_CHANCE_MODERACAO_ENABLED=true
```

Com flag inativa, comportamento idêntico à Fase 5; aba Revisão permanece manual via `/api/chance-moderacao`.
