# Relatório Fase 6 — Evolução Motor-First (Chance de Moderação)

**Data:** 2026-07-31  
**Escopo:** Reestruturação A1–A16 conforme plano canônico Fase 6.

## Resumo executivo

A análise de Chance de Moderação deixou de depender do prompt monolítico V7 (~900 linhas em `server.js`) e passou a operar em pipeline **Motor-first** com etapas especializadas no módulo `chance-moderacao/`.

O **Motor de Pontuação** (`motor.js`, `validador.js`, `perfil_calibracao_v1.json`) permanece **inalterado**.

## Arquitetura implementada

```
Extrator → Motor #1 → Auditora (seções 1–12)
  → se Motor #1 < 90%: Reformulador → Extrator (reuso) → Motor #2 → Comparador → montarResultadoFinal
  → se ≥ 90%: fim após Auditora
```

### Módulos criados (`chance-moderacao/`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `runner.js` | Orquestração A1–A16 |
| `extrator.js` | LLM → JSON Motor (reutilizado 2×) |
| `auditora.js` | LLM → seções 1–12 + DTO oportunidades |
| `reformulador.js` | LLM → miolo reformulado (somente DTO A16) |
| `comparador.js` | Delta + guardrail A5 + seção 14 (zero LLM) |
| `montarResultadoFinal.js` | Concatenação determinística A10 |
| `contratoChamadasOpenAI.js` | Contrato A13 (2 ou 4 chamadas OpenAI) |
| `contratosEtapa.js` | Contratos I/O A14 |
| `oportunidadesMelhoria.*` | DTO A16 Auditora → Reformulador |
| `montarVersions.js` | Versionamento A15 |

## Contrato OpenAI (A13)

| Fluxo | OpenAI | Motor | Comparador |
|-------|--------|-------|------------|
| Padrão (≥ 90%) | **2** (extrator + auditora) | 1 | — |
| Completo (< 90%) | **4** (+ reformulador + extrator) | 2 | código |

Validação em `validarContrato()` — alerta em produção, assert em testes.

## Contrato HTTP ampliado

`POST /api/chance-moderacao` retorna além de `result` e `motor`:

- `respostaOriginal`, `respostaReformulada`, `respostaSugerida`
- `reformulacaoAprovada`, `avisoRegressao`
- `motorReformulado`, `comparacao`, `deltaPorCriterio`
- `oportunidadesMelhoria`, `versions`, `telemetria`

Entrada ampliada: `solucaoImplementada`.

## Integração

- `server.js` — `executarChanceModeracao` delega para `chance-moderacao/runner.js` (~30 linhas)
- `motor-pontuacao/integracao.js` — `serializarMotorParaAuditor()`; `montarBlocoOficial` sem menção à IA
- `resposta-pipeline/chanceModeracao/runner.js` — persiste campos A6/A9/A15/A16
- `script.js` — UI Motor-first: cards oficiais, delta, regressão; removido `extrairImpactoRevisao`

## Guardrail A5 (regressão)

Se Motor #2 < Motor #1:
- `respostaSugerida` = original
- `reformulacaoAprovada` = false
- UI exibe alerta + versão reformulada colapsável (auditoria)

## Versionamento (A15)

```javascript
versions: {
  motor: 'motor-v1',
  perfil: 'v1',
  extrator: 'extrator-v1',
  auditora: 'auditora-v1',
  reformulador: 'reformulador-v1' | null
}
```

## Performance / Deploy

- `vercel.json`: `maxDuration` aumentado de 60s → **120s** (fluxo completo = 4 chamadas OpenAI)
- Telemetria acumula `chamadas[]` com `promptVersion` por etapa

## Deprecação V7

Prompt `PROMPT DEFINITIVO VELOTAX V7 MASTER` removido de `server.js`. Substituído por Auditora Técnica + Reformulador (A11).

## Testes

```
node chance-moderacao/__tests__/comparador.test.js
node chance-moderacao/__tests__/parseOportunidadesMelhoria.test.js
node chance-moderacao/__tests__/contratosEtapa.test.js
node chance-moderacao/__tests__/runner.mock.test.js
node resposta-pipeline/__tests__/chanceModeracao.runner.test.js
```

## Próximos passos sugeridos

1. Calibrar prompts Auditora/Reformulador com casos reais e incrementar versões (`auditora-v2`, etc.)
2. Métricas sobre `deltaPorCriterio` agregado (A9 uso futuro)
3. Smoke test em staging com API OpenAI real
