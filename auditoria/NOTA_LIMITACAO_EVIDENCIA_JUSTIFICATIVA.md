# Limitação — estabilidade evidencial e Justificativa UI

## Extrator #1 × Extrator #2 (`evidencia_objetiva`)

Não há clamp determinístico do tipo `evidenciaMotor2 ≤ evidenciaMotor1` nem reescrita automática de estado pós-Motor #2.

**Motivo:** distinguir (1) evidência já nos inputs só melhor explicitada, (2) mudança só estilística e (3) evidência inventada exigiria heurísticas frágeis ou nova chamada LLM — fora do escopo desta entrega. Um clamp cego invalidaria o caso em que o Extrator #1 subestimou evidência real já presente.

**Proteção atual:** reforço semântico em `GUIA.evidencia_objetiva`, `promptExtrator`, `promptReformulador`, `promptAuditora` e ações do fallback — mais testes de regressão A–F.

A estabilidade evidencial depende da disciplina do Extrator/Reformulador até eventual DTO/heurística futura calibrada.

## Justificativa dos Critérios (UI)

O parser em `script.js` (espelho em `chance-moderacao/justificativaParser.js`) consome o markdown da Auditora (`###` + labels).

**Não implementado nesta entrega:** DTO estruturado `justificativasCriterios[]`. Melhoria futura recomendada para eliminar parsing frágil de markdown.
