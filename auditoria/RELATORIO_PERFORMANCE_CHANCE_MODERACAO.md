# Relatório de Performance — Chance de Moderação (Fase 6)

**Data:** 2026-07-31  
**Escopo:** Levantamento técnico + instrumentação. Sem alteração de arquitetura, Motor, prompts ou contrato A13.

## Objetivo

Medir o pipeline Motor-first antes da calibração dos prompts, identificando gargalos de latência e tokens.

## Fluxo instrumentado

```
sheets_calibracao → extrator-1 → motor-1 → auditora
  → [se chance < limiar e DTO com itens]
      reformulador → extrator-2 → motor-2 → comparador
  → montar_resultado_final
```

Telemetria por request:

- `telemetria.fluxoExecutado[]` — etapas realmente executadas
- `telemetria.etapas[]` — `duracaoMs`, `modelo`, `promptTokens`, `completionTokens`, `totalTokens`, `invocacao`, `schemaVersion`
- Auditora: `tentativas[]` com `{ n, duracaoMs, valida }`

## Contrato OpenAI (A13)

| Fluxo | Chamadas OpenAI | Motor |
|-------|-----------------|-------|
| Padrão (≥ limiar ou sem DTO acionável) | **2** (extrator + auditora) | 1 |
| Completo | **4** (+ reformulador + extrator) | 2 |

Comparador e Motor: 0 LLM.

## Tabela de tempos (preencher com telemetria real pós-deploy)

Após um request de produção/staging, copiar valores de `telemetria.etapas` e calcular `% = duracaoMs / sum(duracaoMs)`.

| Etapa | Tempo (ms) | % do total | Tokens (in/out) | Natureza |
|-------|------------|------------|-----------------|----------|
| Sheets (`sheets_calibracao`) | _preencher_ | _%_ | — | I/O Google Sheets (GET Moderacões A1:O5000) |
| Extrator #1 | _preencher_ | _%_ | _preencher_ | LLM |
| Motor #1 | _preencher_ | _%_ | — | Código (esperado &lt; 50 ms) |
| Auditora | _preencher_ | _%_ | _preencher_ | LLM (+ até 3 tentativas) |
| Reformulador | _preencher_ / N/A | _%_ | _preencher_ | LLM (fluxo completo) |
| Extrator #2 | _preencher_ / N/A | _%_ | _preencher_ | LLM |
| Motor #2 | _preencher_ / N/A | _%_ | — | Código |
| Comparador | _preencher_ / N/A | _%_ | — | Código |
| montarResultadoFinal | _preencher_ | _%_ | — | Código |
| **Total** | _preencher_ | 100% | | |

Observação do teste pré-instrumentação (~52s, 3 POSTs OpenAI): forte indício de Extrator + **2 tentativas de Auditora** (sem Reformulador naquele request — validação falhou e caiu em fallback).

## Gargalos identificados (hipótese de código)

1. **Auditora Técnica (LLM)** — maior candidato: prompt inclui base normativa + calibração histórica + caso completo + `motorSerializado` pretty-printed + exigência de 12 seções H2 + DTO JSON; retries multiplicam o custo.
2. **Extrator (LLM)** — prompt de estados (`montarInstrucaoEstados`) longo; no fluxo completo executa 2×.
3. **Google Sheets** — leitura ampla da aba Moderacões antes do Extrator; bloqueante e síncrono no request.
4. **Reformulador** — menor que Auditora, mas recebe envelope RA completo (otimizável no futuro: só miolo).
5. **Motor / Comparador / montarResultadoFinal** — desprezíveis frente às chamadas OpenAI.

## Impacto do Google Sheets

- Função: `carregarModeracoesAprovadasSimilares` → calibração histórica.
- Motor consome principalmente a **quantidade** de similares (`derivarCalibracaoHistorica(qtd)`); o texto dos casos vai principalmente para o prompt da Auditora (`baseCalibracaoHistorica`).
- Oportunidade futura (não implementar agora): cache por processo/request; ou separar qtd (Motor) do bloco textual (Auditora).

## Retries da Auditora

Instrumentação grava por tentativa:

```json
{ "n": 1, "duracaoMs": 4100, "valida": false }
```

Usar para responder: a Auditora costuma validar na 1ª tentativa ou depende de retries? Quando `fallback: true`, todas as tentativas falharam — ver `debugAuditora.motivoValidacao` / `errosPorTentativa` (HTTP com `CHANCE_DEBUG=true`).

## Oportunidades futuras (fora do escopo desta entrega)

1. Compactar `motorSerializado` (sem `JSON.stringify(..., null, 2)`).
2. Truncar / filtrar `baseNormativa` e casos históricos no prompt da Auditora.
3. Reformulador: enviar só miolo; envelope via `formatarRespostaRA`.
4. Cache da planilha de Moderacões.
5. Reduzir maxTokens da Auditora se truncagem não for a causa de falha estrutural.
6. **Não** paralelizar Extrator/Auditora (dependência de dados).

## Como coletar dados no próximo teste

1. Deploy com instrumentação.
2. Chamar `POST /api/chance-moderacao` (opcional: `"debug": true` ou `CHANCE_DEBUG=true`).
3. Ler `telemetria.fluxoExecutado`, `telemetria.etapas`, e se debug: `debugAuditora` (raw só na HTTP/logs; WorkflowState só hash + metadados).
4. Preencher a tabela acima e priorizar calibração de prompts da Auditora.

---

## Checklist de validação pré-deploy (ajustes pós-teste Fase 6)

| Critério | Status |
|----------|--------|
| Saudação sem inferência automática de nome; fallback `Olá, cliente!` | OK — Chance passa `nomeCliente: null`; ResponseBuilder só `nome_solicitante` |
| `auditoraRaw` só em debug HTTP/log; **não** persistido no WorkflowState/PEV | OK — `metadadosDebugAuditora()` remove raw; permanece `auditoraRawHash` |
| `debugAuditora` com motivo de validação, tentativas e metadados | OK — `fallback`, `motivoValidacao`, `errosPorTentativa`, `tentativas`, `schemaVersion`, `duracaoMs` |
| `telemetria.fluxoExecutado` reflete o caminho real | OK — inclui `sheets_calibracao`, `extrator-1`, `motor-1`, `auditora`, … |
| `telemetria.etapas` com duração; OpenAI com modelo e tokens | OK |
| Retries da Auditora registrados individualmente | OK — `{ n, duracaoMs, valida }` |
| Motor, prompts, limiares, arquitetura Motor-first e contrato A13 inalterados | OK — sem mudanças em `motor.js` / `validador.js` / perfil / prompts / A13 |
| Sem novas otimizações de performance nesta entrega | OK — apenas instrumentação + relatório |
| Suíte de regressão (33 testes) | **ALL GREEN** |

**Próximo passo operacional:** caso real em produção/staging → preencher tabela de tempos com `telemetria.etapas` → decidir otimizações.

