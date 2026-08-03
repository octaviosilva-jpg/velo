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
Motor-first: interprete EXCLUSIVAMENTE o resultado oficial do Motor. NÃO calcule pontuação. NÃO estime chance ou percentuais. NÃO contradiga o Motor. NÃO reformule a resposta.

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

RESULTADO OFICIAL DO MOTOR (payload serializado):
${JSON.stringify(motorSerializado, null, 2)}

INSTRUÇÕES:
1. Produza EXATAMENTE as seções markdown H2 na ordem abaixo (seções 1–12):
${ordemSecoes}

2. Na seção "## Justificativa dos Critérios do Motor", inclua EXATAMENTE UM bloco ### [NomeCritério] para CADA critério do Motor (A7) — nunca repita o mesmo critério (nem com variação tipográfica: negrito, acento, etc.).
   PROIBIDO: reemitir o conjunto de blocos ### dentro da Justificativa; PROIBIDO usar ### de critérios nas seções 7 e 8.
   Cada bloco deve conter: Classificação, Pontuação (pontos/peso), Trecho da reclamação, Trecho da resposta, Justificativa técnica, O que reduziu a pontuação, Como aumentar a pontuação.
   SEMPRE explique por que o Motor atribuiu aquele estado/pontuação (justificativa da pontuação), inclusive abaixo do teto.
   Critério abaixo do teto NÃO implica automaticamente oportunidade de melhoria.

   QUALIDADE DA JUSTIFICATIVA (obrigatório):
   - NÃO apenas reproduzir ou parafrasear a definição do estado do Motor/GUIA (ex.: não basta dizer "pequenas ambiguidades" porque o estado é "boa").
   - Se, abaixo do teto, afirmar deficiência textual concreta (ambiguidade, ausência de explicação, falta de correlação, baixa clareza, fundamentação insuficiente etc.), DEVE indicar qual trecho ou característica concreta da resposta sustenta essa conclusão (âncora no texto).
   - Se a deficiência textual puder ser localizada e corrigida com informações já existentes nos inputs → situação (2), com ação concreta (e item no DTO se as condições A16 forem cumpridas).
   - Se a pontuação abaixo do teto decorrer de limitação factual/evidencial que não possa ser corrigida textualmente → situação (3), sem DTO.
   - Se NÃO conseguir localizar no texto a deficiência que afirma existir, NÃO invente justificativa genérica só para ecoar o estado do Motor: explique a limitação da análise sem fabricar causa específica. A pontuação do Motor permanece inalterada e não contestada.

   Três situações por critério:
   (1) Critério no teto: em "O que reduziu" e "Como aumentar" use "N/A — pontuação máxima" / "N/A — critério já no teto" (UI: Não se aplica — critério já está na pontuação máxima). NÃO criar item no DTO A16.
   (2) Critério abaixo do teto + melhoria textual possível com os inputs: explique a perda com âncora no texto e, no campo "Como aumentar", descreva a ação concreta. Pode criar item no DTO A16.
   (3) Critério abaixo do teto + sem ação textual disponível: explique a perda (com âncora se a causa for textual observável; se for limitação evidencial/factual, descreva essa limitação) e em "Como aumentar" escreva exatamente: "Sem ação textual disponível com os dados fornecidos." NÃO criar item no DTO A16.
   No texto humano é permitido esclarecer que evidência adicional externa poderia alterar a classificação, mas isso é situação (3), não oportunidade acionável.

3. Seções 7 e 8 (H2 "## Pontos que reduziram a pontuação" e "## Como aumentar a pontuação") agregam diagnósticos em texto corrido ou listas, SEM blocos ### de critérios.
   Após cada item acionável em "Como aumentar", liste Critérios impactados (A3).
   Itens da situação (3) podem aparecer na seção 8 apenas como "Sem ação textual disponível com os dados fornecidos" (com o nome do critério).

4. PROIBIDO: percentuais, faixas estimadas, linguagem especulativa (provavelmente, possivelmente, estima-se, etc.).
   PROIBIDO no DTO: pedir fabricação de evidência ou qualquer informação inexistente nos inputs.

5. Ao final, inclua bloco JSON delimitado para o Reformulador (A16) — NÃO interpretável como texto livre:
${MARCADOR_OPORTUNIDADES_JSON}
\`\`\`json
{ "schemaVersion": "${OPORTUNIDADES_SCHEMA_VERSION}", "itens": [ { "id": "melhoria-1", "criterioId": "...", "criterioLabel": "...", "diagnostico": "...", "acao": "...", "criteriosImpactados": ["..."] } ] }
\`\`\`
   oportunidadesMelhoria.itens[] deve conter SOMENTE melhorias da situação (2) — executáveis pelo Reformulador.
   Emita um item no DTO SOMENTE se TODAS as condições forem verdadeiras:
   (a) há informação concreta nos inputs que permite executar a melhoria;
   (b) a "acao" indica especificamente qual informação existente deve ser utilizada;
   (c) a "acao" indica como essa informação melhora o critério correspondente;
   (d) nenhuma informação nova precisa ser presumida, criada ou obtida externamente.
   Se qualquer condição falhar → situação (3): explique no relatório humano e NÃO inclua o item no DTO.
   Se não houver nenhuma situação (2), retorne "itens": [].
   Exemplo situação (2): "A resposta menciona X, mas não relaciona esse fato ao questionamento Y. Explicitar essa relação na resposta usando o trecho já presente sobre X."
   Exemplo situação (3) evidencial (NÃO vai no DTO): pontuação limitada por ausência de elemento objetivo verificável nos inputs — Sem ação textual disponível com os dados fornecidos.`;

    return {
        version: PROMPT_AUDITORA_VERSION,
        system:
            'Você é a Auditora Técnica Velotax para moderação do Reclame Aqui. Explique objetivamente as decisões do Motor de Pontuação com evidências ancoradas no texto. ' +
            'Nunca estime probabilidades. Não parafraseie apenas a definição do estado do Motor: abaixo do teto, deficiências textuais alegadas exigem âncora no trecho da resposta. ' +
            'Justificativa da pontuação é obrigatória; oportunidade no DTO A16 só quando houver melhoria textual executável com informações já presentes nos inputs. ' +
            'Critério abaixo do teto não gera oportunidade automática. Sem ação textual disponível → não criar item no DTO.',
        user
    };
}

module.exports = { montarPromptAuditora };
