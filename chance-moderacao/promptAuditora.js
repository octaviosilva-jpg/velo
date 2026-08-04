'use strict';

const { PROMPT_AUDITORA_VERSION } = require('./constants');
const { SECOES_AUDITORA, MARCADOR_OPORTUNIDADES_JSON } = require('./secoesV8');
const { OPORTUNIDADES_SCHEMA_VERSION } = require('./constants');

function montarPromptAuditora({
    reclamacao,
    respostaPublica,
    solucaoImplementada,
    consideracaoFinal,
    historicoModeracao,
    baseNormativa,
    baseCalibracaoHistorica,
    motorSerializado
}) {
    const ordemSecoes = SECOES_AUDITORA.map((s, i) => `${i + 1}. ## ${s}`).join('\n');

    const user = `PROMPT AUDITORA TÉCNICA (${PROMPT_AUDITORA_VERSION})
Motor-first: interprete EXCLUSIVAMENTE o resultado oficial do Motor. NÃO calcule pontuação. NÃO estime chance ou percentuais. NÃO contradiga o Motor. NÃO reformule a resposta. Explique o resultado oficial — NÃO questione sua validade.

BASE NORMATIVA:
${baseNormativa || '(não disponível)'}

CALIBRAÇÃO HISTÓRICA:
${baseCalibracaoHistorica || '(nenhum caso similar)'}

DADOS DO CASO:
RECLAMAÇÃO:
${reclamacao}

RESPOSTA PÚBLICA:
${respostaPublica}

${consideracaoFinal ? `CONSIDERAÇÃO FINAL:\n${consideracaoFinal}\n` : ''}
${historicoModeracao ? `HISTÓRICO DE MODERAÇÃO:\n${historicoModeracao}\n` : ''}
${solucaoImplementada ? `SOLUÇÃO IMPLEMENTADA:\n${solucaoImplementada}\n` : ''}

RESULTADO OFICIAL DO MOTOR (payload serializado — use criterios[] e fundamentos[criterioId] do MESMO critério):
${JSON.stringify(motorSerializado, null, 2)}

INSTRUÇÕES:
1. Produza EXATAMENTE as seções markdown H2 na ordem abaixo (seções 1–12):
${ordemSecoes}

2. Na seção "## Justificativa dos Critérios do Motor", os ÚNICOS headings H3 permitidos são:
   ### [nome oficial do critério]
   Exatamente UM H3 por critério do Motor (use o label oficial do payload). total de H3 = número de critérios.
   PROIBIDO: ### Critério — [nome], ### Análise — [nome], ### Resumo, ### Diagnóstico, ### Oportunidade, ou qualquer H3 auxiliar.
   PROIBIDO: repetir o mesmo critério (inclusive com negrito, acento ou variação tipográfica).
   Classificação, Pontuação, Trecho da reclamação, Trecho da resposta, Justificativa técnica, O que reduziu a pontuação e Como aumentar a pontuação são CAMPOS dentro do H3 oficial — nunca novos H3.
   PROIBIDO usar ### de critérios nas seções 7 e 8.

   CAMPOS OBRIGATÓRIOS (7) — TODO critério deve conter EXATAMENTE UMA ocorrência reconhecível de cada campo abaixo. NENHUM campo pode ser omitido:
   1. Classificação
   2. Pontuação
   3. Trecho da reclamação
   4. Trecho da resposta
   5. Justificativa técnica
   6. O que reduziu a pontuação (aceito também: O que reduziu a pontuacao / O que reduziu)
   7. Como aumentar a pontuação (aceito também: Como aumentar a pontuacao / Como aumentar)

   Quando não houver conteúdo aplicável, preencha explicitamente — nunca deixe o campo de fora:
   - Critério no teto → O que reduziu: "N/A — pontuação máxima" ou "N/A — critério já no teto"; Como aumentar: "N/A — critério já no teto" ou "N/A — pontuação máxima".
   - Abaixo do teto sem causa individualizada → O que reduziu: "Não há causa textual específica individualizada nos fundamentos disponíveis."; Como aumentar: "Sem ação textual disponível com os dados fornecidos."
   - Trecho inexistente/inaplicável → Trecho da reclamação: "N/A"; Trecho da resposta: "N/A".

   FORMATO DE SAÍDA dos 7 campos (dentro de cada H3 — preferencialmente um campo por linha):
   Classificação: valor
   Pontuação: valor
   Trecho da reclamação: valor
   Trecho da resposta: valor
   Justificativa técnica: valor
   O que reduziu a pontuação: valor
   Como aumentar a pontuação: valor
   NÃO usar bullets, listas ou numeração antes dos labels. PROIBIDO: "- Classificação:", "* Pontuação:", "1. Trecho da reclamação:".

3. JUSTIFICATIVA CAUSAL POR CRITÉRIO — separe mentalmente:
   (A) resultado matemático do Motor: estado, pontos, peso, fator;
   (B) fundamento disponível: fundamentos[criterioId].fundamento e trechos_utilizados daquele MESMO criterioId + textos do caso;
   (C) causalidade que NÃO está disponível: não invente deficiência só para preencher campos.

   Justificativa técnica deve usar (A)+(B). NÃO apenas parafrasear a definição abstrata do estado (ex.: NÃO escrever "pequenas ambiguidades" só porque o estado é "boa").
   Só afirme deficiência textual/factual concreta se localizar trecho/característica sustentada em (B).

   "Ausência de causa individualizada" NÃO significa erro do Motor, classificação sem fundamento, impossibilidade de justificar o estado nem inconsistência da pontuação.
   Significa APENAS que, com os fundamentos/trechos daquele criterioId, não é seguro atribuir a diferença entre a pontuação obtida e o teto a uma deficiência textual/factual específica.
   Nesses casos, AINDA explique: (1) estado atribuído; (2) pontuação resultante; (3) o que os fundamentos/trechos disponíveis sustentam — sem inventar causa dos pontos não obtidos.
   Exemplo correto (clareza = boa, 4/5, sem ambiguidade concreta nos fundamentos):
   Justificativa técnica: "O Motor classificou a clareza como 'boa', resultando em 4/5. Os fundamentos disponíveis sustentam que a resposta permanece compreensível, porém não individualizam uma deficiência textual específica responsável pela diferença em relação à pontuação máxima."
   O que reduziu a pontuação: "Não há causa textual específica individualizada nos fundamentos disponíveis."
   Como aumentar a pontuação: "Sem ação textual disponível com os dados fornecidos."
   EVITAR: "Não foi possível justificar a classificação." / "O Motor não apresentou fundamento para a nota."

   PROIBIDO causalidade cruzada: não atribuir a perda de um critério à deficiência de outro critério independente (ex.: adequacao_hipotese pela evidencia_objetiva declaratoria), salvo se fundamentos[criterioAtual] estabelecerem explicitamente essa relação.

   ADEQUAÇÃO × EVIDÊNCIA (distinção semântica):
   PROIBIDO escrever que Adequação perdeu pontos porque Evidência objetiva ficou abaixo do teto — por exemplo:
   - "A Adequação perdeu pontos porque Evidência objetiva foi declaratória."
   - "A resposta ficou em 15.3/18 em Adequação porque faltaram evidências objetivas" quando inferido apenas do estado/pontuação de evidencia_objetiva.
   O estado ou pontuação de evidencia_objetiva, isoladamente, NÃO pode ser usado como explicação causal para adequacao_hipotese.
   PERMITIDO mencionar evidência em adequacao_hipotese SOMENTE quando fundamentos.adequacao_hipotese estabelecerem explicitamente essa relação como requisito do próprio enquadramento daquele critério — redija como requisito interno da Adequação, não como causalidade entre critérios independentes.
   Exemplo preferível: "O enquadramento permaneceu no estado 'forte' conforme os requisitos próprios do critério de adequação. Os fundamentos deste critério indicam que [causa explicitamente presente em fundamentos.adequacao_hipotese]."
   Se fundamentos.adequacao_hipotese não individualizarem a causa da diferença ao teto: use O que reduziu / Como aumentar da situação (3) — sem questionar a validade do resultado oficial.

   ESTADO "INEXISTENTE" COM PONTUAÇÃO MÁXIMA (cobertura_secundaria, pedidos_acessorios):
   Quando estado = inexistente E pontos === peso, "inexistente" NÃO representa deficiência — significa que não havia fato secundário/pedido acessório a tratar; o critério está no teto por inaplicabilidade.
   Justificativa técnica deve deixar explícito que o elemento avaliado não existia no caso e não havia obrigação de resposta naquele critério. EVITE frases que façam "inexistente" parecer sinônimo de "não respondido".
   Exemplo cobertura_secundaria: "Não foram identificados fatos secundários que exigissem resposta específica; portanto, o critério permanece na pontuação máxima."
   Exemplo pedidos_acessorios: "Não foram identificados pedidos acessórios que exigissem tratamento específico; portanto, o critério permanece na pontuação máxima."
   O que reduziu / Como aumentar: N/A conforme critério no teto.

4. Três situações em "Como aumentar" / DTO:
   (1) Critério no teto: "N/A — pontuação máxima" / "N/A — critério já no teto". Sem item no DTO.
   (2) Abaixo do teto + melhoria textual executável com inputs (âncora concreta): ação específica; pode criar item no DTO A16.
   (3) Abaixo do teto sem ação textual segura (inclui ausência de causa individualizada ou limitação evidencial): "Sem ação textual disponível com os dados fornecidos." Sem item no DTO.
   Critério abaixo do teto NÃO implica automaticamente oportunidade. A regra "Nunca preencher 'O que reduziu' só porque pontos < peso" significa NÃO INVENTAR uma causa apenas porque pontos < peso — o CAMPO "O que reduziu" continua OBRIGATÓRIO; se não houver causa segura, use "Não há causa textual específica individualizada nos fundamentos disponíveis."

5. Seções 7 e 8 agregam em texto/listas SEM blocos ### de critérios. Após item acionável, liste Critérios impactados (A3).

6. PROIBIDO: percentuais fora do Resultado Oficial, faixas estimadas, linguagem especulativa (provavelmente, possivelmente, estima-se, etc.).
   PROIBIDO no DTO: pedir fabricação de evidência ou informação inexistente nos inputs.

7. Ao final, bloco JSON delimitado (A16):
${MARCADOR_OPORTUNIDADES_JSON}
\`\`\`json
{ "schemaVersion": "${OPORTUNIDADES_SCHEMA_VERSION}", "itens": [ { "id": "melhoria-1", "criterioId": "...", "criterioLabel": "...", "diagnostico": "...", "acao": "...", "criteriosImpactados": ["..."] } ] }
\`\`\`
   itens[] SOMENTE situação (2). Emita item só se: (a) info concreta nos inputs; (b) acao indica qual informação existente; (c) como melhora o critério; (d) nada novo a presumir. Senão → situação (3) e não inclua no DTO. Sem situação (2) → "itens": [].`;

    return {
        version: PROMPT_AUDITORA_VERSION,
        system:
            'Você é a Auditora Técnica Velotax para moderação do Reclame Aqui. Explique o resultado oficial do Motor com fundamentos e trechos do mesmo critério — sem questionar a validade da pontuação. ' +
            'Não parafraseie definições abstratas de estado. Não invente deficiências. Não use causalidade cruzada entre critérios. ' +
            'Na Justificativa, um H3 oficial por critério com os 7 campos obrigatórios sempre preenchidos. DTO A16 só com melhorias textuais executáveis.',
        user
    };
}

module.exports = { montarPromptAuditora };
