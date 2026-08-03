# Limitação — estabilidade evidencial e Justificativa UI

## Extrator #1 × Extrator #2 (`evidencia_objetiva`)

Não há clamp determinístico do tipo `evidenciaMotor2 ≤ evidenciaMotor1` nem reescrita automática de estado pós-Motor #2.

**Motivo:** distinguir (1) evidência já nos inputs só melhor explicitada, (2) mudança só estilística e (3) evidência inventada exigiria heurísticas frágeis ou nova chamada LLM — fora do escopo. Um clamp cego invalidaria o caso em que o Extrator #1 subestimou evidência real já presente.

**Proteção atual:** reforço semântico em `GUIA.evidencia_objetiva`, `promptExtrator`, `promptReformulador`, `promptAuditora` — mais testes de regressão.

A estabilidade evidencial depende da disciplina do Extrator/Reformulador até eventual DTO/heurística futura calibrada.

## Justificativa dos Critérios (UI)

O parser em `script.js` (espelho em `chance-moderacao/justificativaParser.js`) consome o markdown da Auditora (`###` + labels).

Unicidade dos `###` por critério é validada em `validarSaidaAuditora` (rejeita duplicata). Não há dedupe artificial na UI.

**Não implementado:** DTO estruturado `justificativasCriterios[]`.

## DTO A16 — só oportunidades executáveis

A classificação acionável é responsabilidade da Auditora (prompt: situações 1–3 + quatro condições). Não há filtro semântico por regex/blacklist nem campos novos no schema (`baseNosInputs` / `referenciaInput` fora desta entrega).

Fallback determinístico: relatório humano com “Sem ação textual disponível com os dados fornecidos.” e `oportunidadesMelhoria.itens: []` (runner não executa Reformulador).
