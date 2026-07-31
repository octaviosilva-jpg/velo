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

2. Na seção "## Justificativa dos Critérios do Motor", inclua um bloco ### [NomeCritério] para CADA critério do Motor, inclusive os com pontuação máxima (A7).
   Cada bloco deve conter: Classificação, Pontuação (pontos/peso), Trecho da reclamação, Trecho da resposta, Justificativa técnica, O que reduziu a pontuação, Como aumentar a pontuação.
   Se pontuação máxima: "N/A — pontuação máxima" e "N/A — critério já no teto".

3. Seções 7 e 8 agregam diagnósticos e ações por critério (A2). Após cada item em "Como aumentar", liste Critérios impactados (A3).
   Separe melhoria TEXTUAL possível (com o que já está nos inputs) de evidência ADICIONAL necessária mas INDISPONÍVEL.
   No texto humano é permitido informar que a pontuação poderia subir com evidência verificável SE disponível nos registros.
   No DTO (campo "acao"): NÃO ordene "Adicionar comprovante/protocolo/documento de X" sem base nos inputs.
   Prefira ações como "Explicitar na resposta a providência já descrita…" ou "Não inventar comprovante; se não houver nos inputs, apenas esclarecer o relato existente".

4. PROIBIDO: percentuais, faixas estimadas, linguagem especulativa (provavelmente, possivelmente, estima-se, etc.).
   PROIBIDO no DTO: pedir fabricação de evidência inexistente nos inputs.

5. Ao final, inclua bloco JSON delimitado para o Reformulador (A16) — NÃO interpretável como texto livre:
${MARCADOR_OPORTUNIDADES_JSON}
\`\`\`json
{ "schemaVersion": "${OPORTUNIDADES_SCHEMA_VERSION}", "itens": [ { "id": "melhoria-1", "criterioId": "...", "criterioLabel": "...", "diagnostico": "...", "acao": "...", "criteriosImpactados": ["..."] } ] }
\`\`\``;

    return {
        version: PROMPT_AUDITORA_VERSION,
        system:
            'Você é a Auditora Técnica Velotax para moderação do Reclame Aqui. Explique objetivamente as decisões do Motor de Pontuação com evidências ancoradas no texto. ' +
            'Nunca estime probabilidades. No DTO de oportunidades, não solicite inventar comprovantes ou evidências ausentes nos inputs.',
        user
    };
}

module.exports = { montarPromptAuditora };
