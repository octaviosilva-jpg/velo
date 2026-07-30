# Relatório — Fase 5 Consolidação da Resposta Pública (PEV)

**Data:** 2026-07-30  
**Escopo:** ResponseBuilder como etapa terminal de composição RA; `respostaPublica` como contrato público do Pipeline PEV  
**Status:** Implementado

---

## 1. Arquivos criados e modificados

### Criados

| Arquivo |
|---------|
| `resposta-pipeline/responseBuilder/index.js` |
| `resposta-pipeline/__tests__/responseBuilder.test.js` |
| `auditoria/RELATORIO_FASE5_PEV.md` |

### Modificados

| Arquivo | Alteração |
|---------|-----------|
| `resposta-pipeline/workflowState.js` | Campo `respostaPublica: null` |
| `resposta-pipeline/orchestrator.js` | `finalizeWithResponseBuilder()`; 8 exit points |
| `resposta-pipeline/resultMapper.js` | Retorno `respostaPublica` |
| `resposta-pipeline/index.js` | `userData` em `runPlanExec`; export `responseBuilder` |
| `resposta-pipeline/persistence.js` | `respostaPublicaPresente` em `resumo()` |
| `server.js` | Caminho PEV consome `pevResult.respostaPublica`; `formatarRespostaRA` delega ao responseBuilder |
| `resposta-pipeline/__tests__/orchestrator.mock.test.js` | Asserts `respostaPublica` + `userData` |
| `resposta-pipeline/__tests__/orchestrator.factual.mock.test.js` | Idem |
| `resposta-pipeline/__tests__/orchestrator.editorial.mock.test.js` | Idem |
| `resposta-pipeline/__tests__/orchestrator.conditional.mock.test.js` | Idem |

**Explicitamente inalterados:** Planner, Executor, DeterministicGate, auditores, prompts, observabilidade (sem novas métricas), Chance de Moderação, fluxo monolítico estrutural.

**Não criado:** `NODES.RESPONSE_BUILDER`, `respostaPublicaMeta`, feature flag nova.

---

## 2. Fluxo antigo vs novo

### Antigo (até Fase 4.5)

```
PreProcessor → Planner → Executor → Gate → [Skip] → [Factual] → [Editorial]
      ↓
persistWorkflowState (conteudoMiolo em rascunhoMiolo)
      ↓
server.js formatarRespostaRA(conteudoMiolo)
      ↓
HTTP res.json({ result })
```

### Novo (Fase 5)

```
PreProcessor → Planner → Executor → Gate → [Skip] → [Factual] → [Editorial]
      ↓
ResponseBuilder (composição terminal — código, não nó cognitivo)
      ↓
persistWorkflowState (conteudoMiolo + respostaPublica)
      ↓
[async] Observabilidade indexer (inalterado)
      ↓
HTTP res.json({ result: pevResult.respostaPublica })
```

---

## 3. Responsabilidades por componente

| Componente | Responsabilidade |
|------------|------------------|
| **`responseBuilder/index.js`** | Composição RA-específica: envelope (saudação, apresentação, rodapé, assinatura), normalizações de pontuação e Velotax, resolução de nomes |
| **`finalizeWithResponseBuilder()`** | Etapa de finalização no orchestrator — **não acumular responsabilidades futuras** (Chance, otimização, etc.) |
| **`conteudoMiolo`** | Artefato **interno** — rastreabilidade, auditoria, depuração |
| **`respostaPublica`** | Contrato **público** — entrega HTTP ao usuário |
| **`server.js` (PEV)** | Passa `userData`; consome `respostaPublica` pronta |
| **`formatarRespostaRA` (monolito/reformulação/chance)** | Wrapper fino delegando a `buildRespostaPublica` — uma única implementação |

---

## 4. Diretriz de transparência semântica

O ResponseBuilder **não altera o conteúdo semântico** do miolo validado pelo Pipeline. Apenas organiza a apresentação para entrega (envelope RA Velotax). Testes validam que trechos distintivos do `conteudoMiolo` aparecem integralmente em `respostaPublica`.

Funções legadas (`extrairMioloRespostaRA`, `reduzirAgradecimentosExcessivos`) preservadas para idempotência quando o texto já traz envelope parcial.

---

## 5. Contrato final do Pipeline

```javascript
// Retorno runPlanExec()
{
  conteudoMiolo: string,      // interno
  respostaPublica: string,    // contrato público HTTP
  usedFallback: boolean,
  metrics: { executionId, ... },
  state: {
    respostaPublica,
    rascunhoMiolo: { conteudo },
    decisionLog, telemetria, artefatos, ...
  },
  persistResult: { localOk, resumo }
}
```

API pública exportada: `respostaPipeline.responseBuilder.buildRespostaPublica`, `resolveContextoResposta`.

---

## 6. Consumo no server.js

**Antes:** `formatarRespostaRA(pevResult.conteudoMiolo, nomeCliente, nomeAgente, userData)`

**Depois:**

```javascript
runPlanExec({ ..., userData }, { ..., userData })
// ...
res.json({ result: pevResult.respostaPublica, ... })
```

`formatarRespostaRA` permanece para monolito/reformulação/chance como wrapper de 1 linha sobre `buildRespostaPublica`.

---

## 7. Persistência

- JSON em `data/resposta_pipeline_pev/{executionId}.json` inclui `respostaPublica`.
- `rascunhoMiolo.conteudo` (miolo interno) **mantido**.
- `resumo()` inclui `respostaPublicaPresente: boolean`.

---

## 8. Observabilidade

- **Sem novas métricas** no catálogo.
- `executionExtractor.js` **inalterado** — `respostaPublica` disponível no JSON persistido para análises futuras.

---

## 9. Compatibilidade

| Fluxo | Status |
|-------|--------|
| PEV | Consome `respostaPublica` diretamente |
| Monolito | Inalterado estruturalmente; usa wrapper `formatarRespostaRA` |
| Reformulação | Idem monolito |
| Chance de Moderação | Inalterado |
| Feature flags existentes | Preservadas |
| Testes existentes | 21 suites verdes + 1 nova |

---

## 10. Testes executados

```
21 arquivos *.test.js em resposta-pipeline/ — ALL PASSED
Inclui responseBuilder.test.js (envelope, idempotência, transparência semântica, Caroline→Carol)
```

---

## 11. Oportunidades documentadas (não implementadas)

1. **Unificação explícita monolito → PEV** — monolito ainda passa por `formatarRespostaRA` wrapper; migração estrutural futura.
2. **Chance de Moderação pós-PEV** — consumir `respostaPublica` do workflow persistido (Fase futura).
3. **Extração de submódulos** em `responseBuilder/` — só se ganho de manutenção comprovado.
4. **Generalização multi-canal** — ResponseBuilder permanece RA-específico; compositor genérico seria nova fase.

---

## 12. Pontos de atenção

- `finalizeWithResponseBuilder()` deve permanecer etapa de finalização — não expandir com integrações futuras.
- `userData` ausente → `nomeAgente: 'Agente'` (comportamento herdado).
- Fallback mecânico recebe envelope RA igualmente via ResponseBuilder.
