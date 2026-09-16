'use strict';

const crypto = require('crypto');

/**
 * Registro de prompts VERSIONADOS. Uma responsabilidade por prompt:
 *  - compreensao@v1: extrair fatos + conflito + cobertura (JSON). NAO decide hipotese.
 *  - decisao@v1: escolher UMA hipotese com autoauditoria adversarial (JSON). NAO redige.
 *  - decisao@v3: decisao@v2 + ponderacao de insumos concorrentes (JSON). NAO redige.
 *  - decisao-reformulacao@v1: decisao@v3 + negativa real do RA (motivo/codigo/regra/hipotese
 *    anterior) — diagnostica onde a tentativa anterior falhou e decide manter ou trocar de tese
 *    (JSON). NAO redige.
 *  - redacao@v1: redigir linha de raciocinio + texto final (JSON). NAO reabre decisao.
 *  - redacao-reformulacao@v1: redacao@v2 + negativa real do RA (motivo/codigo/diretriz oficial)
 *    como contexto obrigatorio — exige citar o motivo da negativa anterior e refuta-lo
 *    explicitamente antes de reforcar a hipotese (JSON). NAO reabre decisao.
 *  - redacao-reformulacao@v2: redacao-reformulacao@v1 + reavaliacao holistica (2026-09-10) — trata
 *    a negativa como DIAGNOSTICO da deficiencia, nao como o unico alvo do texto; exige reavaliar
 *    integralmente reclamacao/resposta/consideracao final/hipotese e recebe o texto da tentativa
 *    anterior para identificar e incorporar elementos que ficaram de fora dela (JSON). NAO reabre
 *    decisao.
 *  - redacao@v3: redacao@v2 + criterios especificos do manual (quandoSeAplica/criterios[]) para a
 *    hipotese selecionada — exige demonstrar, criterio por criterio, que o caso satisfaz a
 *    hipotese, em vez de so citar o nome da categoria (JSON). NAO reabre decisao.
 *
 * Os builders recebem blocos ja renderizados (manualBloco, universoHipoteses,
 * aprendizadoBloco) via ctx para manter baixo acoplamento com o server.js.
 */

function sha256(s) {
    return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

const REGISTRY = {
    'compreensao@v1': {
        id: 'compreensao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Você é um extrator objetivo de fatos para análise de moderação do Reclame Aqui. '
                + 'NÃO interprete, NÃO julgue, NÃO consulte manuais, NÃO escolha hipótese, NÃO conclua. '
                + 'Apenas extraia o que está explícito no conteúdo. Responda SOMENTE com JSON válido.';
            const user = [
                'A partir do conteúdo abaixo, extraia os dados objetivos.',
                '',
                `SOLICITAÇÃO DO CLIENTE:\n${ctx.solicitacao || ''}`,
                `\nRESPOSTA DA EMPRESA:\n${ctx.resposta || ''}`,
                `\nCONSIDERAÇÃO FINAL DO CONSUMIDOR:\n${ctx.consideracao || '(não informada)'}`,
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "fatos_reclamacao": [ "..." ],',
                '  "pedidos_cliente": [ "..." ],',
                '  "acusacoes": [ "..." ],',
                '  "fatos_resposta": [ "..." ],',
                '  "solucoes_apresentadas": [ "..." ],',
                '  "consideracao_tipo": "insatisfacao|confirma|contradiz|novos_fatos|muda_assunto|incorreta|nao_informada",',
                '  "novos_fatos": [ "..." ],',
                '  "conflito_principal": "negativa de credito|publicidade/expectativa|cobranca|inadimplencia|renegociacao|fraude|pix|lgpd|descumprimento contratual|atendimento|seguro|restituicao|conta|outro",',
                '  "conflitos_secundarios": [ "..." ],',
                '  "confianca_conflito": 0.0,',
                '  "cobertura_resposta": [ { "alegacao": "...", "respondido": true, "tipo": "direto|indireto|parcial|nao", "trechoResposta": "..." } ]',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'decisao@v1': {
        id: 'decisao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Você é um AUDITOR de moderação do Reclame Aqui. Escolha a hipótese MAIS FORTE '
                + 'do Manual sustentada pelos FATOS deste caso (não pelo motivo sugerido, não por modelos anteriores). '
                + 'Estrutura obrigatória: (1) levante candidatas, (2) tente DERRUBAR cada uma com evidências contrárias, '
                + '(3) finalize escolhendo UMA. NÃO redija o texto de moderação. Responda SOMENTE com JSON válido.';
            const user = [
                'FATOS EXTRAÍDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                'BASE NORMATIVA (Manual):',
                ctx.manualBloco || '(base normativa indisponível)',
                '',
                'UNIVERSO DE HIPÓTESES:',
                ctx.universoHipoteses || '(universo indisponível)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "hipoteses_candidatas": [ { "hipotese": "...", "score": 0.0, "aderencia": "alta|media|baixa" } ],',
                '  "hipoteses_descartadas": [ { "hipotese": "...", "score": 0.0, "evidenciasFavoraveis": ["..."], "evidenciasContrarias": ["..."], "trechos": ["..."], "motivoDescarte": "..." } ],',
                '  "hipotese_selecionada": { "id": "...", "titulo": "...", "manual": "...", "comoCitar": "..." },',
                '  "justificativa": "...",',
                '  "trechos_sustentam": [ { "trecho": "...", "origem": "reclamacao|resposta|consideracao" } ],',
                '  "confianca": 0.0',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'decisao@v2': {
        id: 'decisao',
        version: 'v2',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Você é um AUDITOR de moderação do Reclame Aqui. ANTES de escolher a hipótese, é OBRIGATÓRIO '
                + 'analisar a reclamação COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos (principal e secundários); '
                + '(2) determinar o NÚCLEO da reclamação; (3) verificar, para CADA conflito, se foi efetivamente respondido pela '
                + 'empresa e com qual evidência; (4) avaliar a consideração final do consumidor; (5) SÓ ENTÃO selecionar a hipótese '
                + 'do Manual que melhor representa o caso. A existência de um assunto (ex.: negativa de crédito) NÃO determina a '
                + 'hipótese por si só; pondere a relação entre reclamação, resposta pública e consideração final. A BASE NORMATIVA '
                + 'é apenas um recorte por palavra-chave (pode estar incompleta); use TAMBÉM o UNIVERSO DE HIPÓTESES. Escolha pelos '
                + 'FATOS, não pelo motivo sugerido nem por modelos anteriores. NÃO redija o texto de moderação. Responda SOMENTE com JSON válido.';
            const user = [
                'FATOS EXTRAÍDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                'RECORTE AUTOMÁTICO DO MANUAL (não vinculante):',
                ctx.manualBloco || '(base normativa indisponível)',
                '',
                'UNIVERSO DE HIPÓTESES:',
                ctx.universoHipoteses || '(universo indisponível)',
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipótese selecionada a TODOS os conflitos identificados (não apenas ao primeiro tema).',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "analise_holistica": {',
                '    "nucleo_reclamacao": "...",',
                '    "conflitos": [ { "conflito": "...", "tipo": "principal", "respondido_pela_empresa": true, "evidencia": "..." } ],',
                '    "leitura_consideracao_final": "..."',
                '  },',
                '  "hipoteses_candidatas": [ { "hipotese": "...", "score": 0.0, "aderencia": "alta|media|baixa" } ],',
                '  "hipoteses_descartadas": [ { "hipotese": "...", "score": 0.0, "evidenciasFavoraveis": ["..."], "evidenciasContrarias": ["..."], "trechos": ["..."], "motivoDescarte": "..." } ],',
                '  "hipotese_selecionada": { "id": "...", "titulo": "...", "manual": "...", "comoCitar": "..." },',
                '  "justificativa": "...",',
                '  "trechos_sustentam": [ { "trecho": "...", "origem": "reclamacao|resposta|consideracao" } ],',
                '  "confianca": 0.0',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'decisao@v3': {
        id: 'decisao',
        version: 'v3',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Você é um AUDITOR de moderação do Reclame Aqui. ANTES de escolher a hipótese, é OBRIGATÓRIO '
                + 'analisar a reclamação COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos (principal e secundários); '
                + '(2) determinar o NÚCLEO da reclamação; (3) verificar, para CADA conflito, se foi efetivamente respondido pela '
                + 'empresa e com qual evidência; (4) avaliar a consideração final do consumidor; (5) SÓ ENTÃO selecionar a hipótese '
                + 'do Manual que melhor representa o caso. A existência de um assunto (ex.: negativa de crédito) NÃO determina a '
                + 'hipótese por si só; pondere a relação entre reclamação, resposta pública e consideração final. A BASE NORMATIVA '
                + 'é apenas um recorte por palavra-chave (pode estar incompleta); use TAMBÉM o UNIVERSO DE HIPÓTESES. Escolha pelos '
                + 'FATOS, não pelo motivo sugerido nem por modelos anteriores. NÃO redija o texto de moderação. Responda SOMENTE com JSON válido.';
            const user = [
                'FATOS EXTRAÍDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                'RECORTE AUTOMÁTICO DO MANUAL (não vinculante):',
                ctx.manualBloco || '(base normativa indisponível)',
                '',
                'UNIVERSO DE HIPÓTESES:',
                ctx.universoHipoteses || '(universo indisponível)',
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipótese selecionada a TODOS os conflitos identificados (não apenas ao primeiro tema).',
                '',
                'PONDERAÇÃO DE INSUMOS CONCORRENTES (quando apontarem para conflitos diferentes):',
                '',
                '- Os TEXTOS CRUS (reclamação, resposta pública, consideração final) constituem a principal base para a análise dos fatos e para a identificação do núcleo e dos conflitos.',
                '- Os dados estruturados produzidos pela etapa de Compreensão (Chamada 1) auxiliam na organização da análise dos textos, mas não vinculam a classificação e podem ser reavaliados quando os fatos indicarem conclusão diferente.',
                '- O Recorte Automático é referência auxiliar: pode estar incompleto ou destacar tema secundário; não vincula a classificação.',
                '',
                '- Quando houver mais de um conflito plausível, escolha como conflito principal aquele que melhor representa o objeto central da reclamação e explica a controvérsia apresentada pelo consumidor, considerando conjuntamente os fatos narrados, os pedidos formulados, as acusações apresentadas, a resposta da empresa e a consideração final do consumidor. O pedido formulado pode ser consequência desejada e não o objeto principal do conflito. Não escolha com base apenas no primeiro assunto mencionado, no tema mais recorrente na narrativa, no conflito_principal da Compreensão ou no tema destacado pelo Recorte Automático.',
                '',
                '- A cobertura da resposta informa se cada conflito foi respondido (passo 3), mas não substitui a definição do núcleo nem conduz sozinho à escolha da hipótese.',
                '- Recorte e Universo servem para enquadrar a hipótese SOMENTE após definidos núcleo e conflito principal; conflitos secundários devem constar em analise_holistica e justificativa, mas não conduzir sozinhos à escolha da hipótese.',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "analise_holistica": {',
                '    "nucleo_reclamacao": "...",',
                '    "conflitos": [ { "conflito": "...", "tipo": "principal", "respondido_pela_empresa": true, "evidencia": "..." } ],',
                '    "leitura_consideracao_final": "..."',
                '  },',
                '  "hipoteses_candidatas": [ { "hipotese": "...", "score": 0.0, "aderencia": "alta|media|baixa" } ],',
                '  "hipoteses_descartadas": [ { "hipotese": "...", "score": 0.0, "evidenciasFavoraveis": ["..."], "evidenciasContrarias": ["..."], "trechos": ["..."], "motivoDescarte": "..." } ],',
                '  "hipotese_selecionada": { "id": "...", "titulo": "...", "manual": "...", "comoCitar": "..." },',
                '  "justificativa": "...",',
                '  "trechos_sustentam": [ { "trecho": "...", "origem": "reclamacao|resposta|consideracao" } ],',
                '  "confianca": 0.0',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'decisao-reformulacao@v1': {
        id: 'decisao-reformulacao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const nr = ctx.negativaReal || {};
            const system = 'Você é um AUDITOR de moderação do Reclame Aqui investigando por que um pedido JÁ FOI NEGADO e decidindo '
                + 'se a hipótese precisa mudar. NÃO é uma redação com "palavras melhores": é uma nova decisão. ANTES de escolher a '
                + 'hipótese, é OBRIGATÓRIO analisar a reclamação COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos '
                + '(principal e secundários); (2) determinar o NÚCLEO da reclamação; (3) verificar, para CADA conflito, se foi '
                + 'efetivamente respondido pela empresa e com qual evidência; (4) avaliar a consideração final do consumidor; '
                + '(5) diagnosticar EXATAMENTE por que a tentativa anterior falhou, usando o motivo/código real citado pelo RA '
                + '(não suposição); (6) SÓ ENTÃO selecionar, do UNIVERSO DE HIPÓTESES, a hipótese do Manual que melhor representa '
                + 'o caso — mantendo a hipótese anterior e reforçando evidências apenas se ela genuinamente evitar esbarrar na regra '
                + 'AENV que o RA citou, ou trocando por uma hipótese diferente e mais forte quando a anterior esbarrar nessa regra '
                + 'ou não resistir à nova análise. IMPORTANTE: a regra AENV citada pelo RA na negativa (ex.: "Não pode haver '
                + 'divergência de informações") é um CRITÉRIO DE VALIDAÇÃO que toda hipótese da categoria AENV precisa satisfazer, '
                + 'NUNCA é ela própria uma hipótese selecionável — hipotese_selecionada tem que ser sempre um item do UNIVERSO DE '
                + 'HIPÓTESES, nunca o título de uma regra AENV. A existência de um assunto NÃO determina a hipótese por si só; '
                + 'pondere reclamação, resposta pública e consideração final. A BASE NORMATIVA é apenas um recorte por palavra-chave '
                + '(pode estar incompleta); use TAMBÉM o UNIVERSO DE HIPÓTESES. Escolha pelos FATOS, não pelo motivo sugerido nem '
                + 'por hipóteses de tentativas anteriores por si só. NÃO redija o texto de moderação. Responda SOMENTE com JSON válido.';
            const linhasNegativa = [
                '📌 NEGATIVA REAL DO RA (extraída do e-mail colado pelo agente, não é suposição):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(não encontrado no texto colado)'}`,
                `- Código RA: ${nr.codigo || 'não identificado'}`,
                nr.regraTitulo ? `- Regra AENV correspondente (CRITÉRIO DE VALIDAÇÃO, NÃO é uma hipótese selecionável): "${nr.regraTitulo}"` : '- Código ainda não mapeado no manual interno; baseie-se apenas no motivo oficial acima.',
                nr.regraOQueVerifica ? `  O que essa regra verifica: ${nr.regraOQueVerifica}` : null,
                nr.regraReprovaQuando ? `  Reprova quando: ${nr.regraReprovaQuando}` : null,
                nr.regraOrientacao ? `  Diretriz oficial para corrigir: ${nr.regraOrientacao}` : null,
                `- Hipótese usada na tentativa anterior (auditoria interna anterior): ${nr.hipoteseAnterior || '(não registrada)'}`,
                nr.teseBateu === false ? '- ⚠️ SINAL: a hipótese anterior esbarra na regra AENV que o RA citou (não evitava esse problema). Forte indício de que a TESE estava errada, não só a redação.' : null,
                nr.teseBateu === true ? '- ✅ SINAL: a hipótese anterior JÁ evitava esbarrar na regra AENV que o RA citou. Forte indício de que o problema foi de EXECUÇÃO (evidência/redação), não de tese.' : null
            ].filter(l => l !== null);

            const user = [
                'FATOS EXTRAÍDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                'RECORTE AUTOMÁTICO DO MANUAL (não vinculante):',
                ctx.manualBloco || '(base normativa indisponível)',
                '',
                'UNIVERSO DE HIPÓTESES:',
                ctx.universoHipoteses || '(universo indisponível)',
                '',
                ...linhasNegativa,
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipótese selecionada a TODOS os conflitos identificados (não apenas ao primeiro tema).',
                '',
                'PONDERAÇÃO DE INSUMOS CONCORRENTES (quando apontarem para conflitos diferentes):',
                '- Os TEXTOS CRUS (reclamação, resposta pública, consideração final) constituem a principal base para a análise dos fatos.',
                '- Os dados estruturados da Compreensão auxiliam a organizar a análise, mas não vinculam a classificação.',
                '- O Recorte Automático é referência auxiliar, não vincula a classificação.',
                '- Quando houver mais de um conflito plausível, escolha como principal aquele que melhor representa o objeto central da reclamação, considerando fatos, pedidos, acusações, resposta da empresa e consideração final.',
                '',
                'DIAGNÓSTICO OBRIGATÓRIO DA TENTATIVA ANTERIOR:',
                '- Aponte, com base nos fatos e na negativa real acima, exatamente ONDE a tentativa anterior falhou (tese errada? faltou trecho literal que sustentasse? ignorou um conflito relevante? a resposta pública genuinamente não sustenta nenhuma tese?).',
                '- Classifique a FORÇA da nova tentativa: "forte" (a negativa decorreu principalmente de tese ruim e você corrigiu o fundamento), "media" (existe tese defensável mas há divergência factual real ou lacuna na resposta pública), ou "fraca" (a resposta pública realmente não sustenta a moderação, há divergência factual direta ou informação relevante não respondida). Isto é avaliação qualitativa sua, não estatística do RA.',
                '- Mesmo classificando como "fraca", você DEVE selecionar a hipótese mais forte disponível e preencher todos os campos normalmente — a classificação é um alerta interno, nunca motivo para deixar de decidir.',
                '',
                '⚠️ ATENÇÃO CRÍTICA SOBRE O CAMPO "hipotese_selecionada": ele tem que ser, sempre, um dos itens listados em UNIVERSO DE HIPÓTESES acima (com id/titulo/manual/comoCitar tirados de lá). A "Regra AENV correspondente" mostrada em NEGATIVA REAL DO RA (ex.: "Não pode haver divergência de informações", "Resposta pública condiz com o pedido de moderação") é apenas um CRITÉRIO que a categoria AENV exige, igual aos outros critérios do RECORTE AUTOMÁTICO — nunca copie o título dessa regra AENV para "hipotese_selecionada". Se nenhuma hipótese do universo evitar claramente essa regra, escolha a mais próxima e sustentável do universo mesmo assim, registrando a limitação em "justificativa".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "analise_holistica": {',
                '    "nucleo_reclamacao": "...",',
                '    "conflitos": [ { "conflito": "...", "tipo": "principal", "respondido_pela_empresa": true, "evidencia": "..." } ],',
                '    "leitura_consideracao_final": "..."',
                '  },',
                '  "hipoteses_candidatas": [ { "hipotese": "...", "score": 0.0, "aderencia": "alta|media|baixa" } ],',
                '  "hipoteses_descartadas": [ { "hipotese": "...", "score": 0.0, "evidenciasFavoraveis": ["..."], "evidenciasContrarias": ["..."], "trechos": ["..."], "motivoDescarte": "..." } ],',
                '  "hipotese_selecionada": { "id": "...", "titulo": "...", "manual": "...", "comoCitar": "..." },',
                '  "justificativa": "...",',
                '  "trechos_sustentam": [ { "trecho": "...", "origem": "reclamacao|resposta|consideracao" } ],',
                '  "confianca": 0.0,',
                '  "onde_a_tentativa_anterior_falhou": "...",',
                '  "forca_da_nova_tentativa": "forte|media|fraca",',
                '  "forca_justificativa": "..."',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'redacao@v1': {
        id: 'redacao',
        version: 'v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'Você é um redator de solicitações de moderação do Reclame Aqui. A hipótese JÁ foi decidida '
                + 'e é IMUTÁVEL: NÃO a reavalie, NÃO reinterprete os fatos, NÃO escolha outra hipótese. '
                + 'Apenas redija. Não use travessão nem hífen com espaços como pausa; prefira vírgula ou ponto. '
                + 'Responda SOMENTE com JSON válido.';
            const user = [
                'HIPÓTESE DEFINITIVA (imutável):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISÃO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERÊNCIA DE ESTILO (apenas tom/estrutura, NÃO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'Gere o texto final SEGUINDO EXATAMENTE o modelo de 3 parágrafos, iniciando com "Prezados,".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicação interna do processo, consequência da hipótese decidida",',
                '  "texto_final": "Prezados,\\n\\n... (3 parágrafos) ..."',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    'redacao@v2': {
        id: 'redacao',
        version: 'v2',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const system = 'PRIORIDADE MÁXIMA: O texto NÃO representa uma manifestação da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentação utilizada pela empresa para solicitar a moderação da reclamação perante a equipe '
                + 'de moderação do Reclame Aqui. '
                + 'Você redige um DOCUMENTO DE FUNDAMENTAÇÃO dirigido ao analista/equipe de moderação do Reclame Aqui; o consumidor '
                + 'NÃO é interlocutor. A hipótese JÁ foi decidida e é IMUTÁVEL: NÃO a reavalie, NÃO reinterprete os fatos, NÃO '
                + 'escolha outra hipótese. É PROIBIDO qualquer linguagem de atendimento ao cliente: não responda ao consumidor, não '
                + 'agradeça pela reclamação, não peça desculpas, não oriente o consumidor a entrar em contato com a empresa, não se '
                + 'coloque à disposição. Não use travessão nem hífen com espaços como pausa; prefira vírgula ou ponto. Responda SOMENTE com JSON válido.';
            const user = [
                'HIPÓTESE DEFINITIVA (imutável):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISÃO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANÁLISE HOLÍSTICA DA DECISÃO (para embasar a relação lógica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERÊNCIA DE ESTILO (apenas tom/estrutura, NÃO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUÇÕES DE REDAÇÃO:',
                '- A saudação inicial deve ser dirigida à EQUIPE DE MODERAÇÃO do Reclame Aqui (ex.: "Prezada equipe de moderação do Reclame Aqui,"), NUNCA ao cliente.',
                '- Estrutura obrigatória do texto_final:',
                '  (1) justificar por que o caso se enquadra no Manual de Moderação (citando a hipótese/como citar);',
                '  (2) demonstrar a relação entre a reclamação, a resposta pública da empresa e a consideração final do consumidor;',
                '  (3) concluir solicitando EXPLICITAMENTE a moderação (ex.: "Solicitamos a moderação...").',
                '- FUNDAMENTAÇÃO VINCULADA À HIPÓTESE: demonstre POR QUE a reclamação, a resposta pública e a consideração final justificam ESPECIFICAMENTE a hipótese selecionada. Não basta citar a hipótese; construa a relação lógica entre os fatos do caso e o enquadramento. Evite afirmações genéricas como "O caso se enquadra em X" sem demonstrar o porquê.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustração/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questão seja resolvida", "Estamos à disposição", "Caso ainda tenha dúvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente". (Observação: "Entendemos que a reclamação se enquadra..." é permitido, pois é argumentação dirigida ao moderador.)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicação interna do processo, consequência da hipótese decidida",',
                '  "texto_final": "Prezada equipe de moderação do Reclame Aqui,\\n\\n... (fundamentação em parágrafos) ...\\n\\nDiante do exposto, solicitamos a moderação."',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    // Variante de redacao@v2 para REFORMULACAO apos negativa real do RA. Diferenca central: recebe
    // negativaReal (motivo/codigo/diretriz oficial de correcao) e EXIGE que o texto cite e refute
    // esse motivo especifico antes de reforcar a hipotese — em vez de apenas reafirmar a tese sob
    // um rotulo novo. Baseado em casos reais onde a reformulacao que citou o motivo da negativa e
    // aplicou a diretriz oficial de correcao foi aceita, contra tentativas que so trocaram o rotulo
    // da hipotese sem enderecar o motivo (ver analise de calibracao de 2026-09-08).
    'redacao-reformulacao@v1': {
        id: 'redacao',
        version: 'reformulacao-v1',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const nr = ctx.negativaReal || {};
            const system = 'PRIORIDADE MÁXIMA: O texto NÃO representa uma manifestação da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentação utilizada pela empresa para PEDIR A REANÁLISE de uma moderação JÁ NEGADA '
                + 'perante a equipe de moderação do Reclame Aqui. '
                + 'Você redige um DOCUMENTO DE REFUTAÇÃO dirigido ao analista/equipe de moderação do Reclame Aqui; o consumidor '
                + 'NÃO é interlocutor. A hipótese JÁ foi decidida e é IMUTÁVEL: NÃO a reavalie, NÃO reinterprete os fatos, NÃO '
                + 'escolha outra hipótese. Isto NÃO É uma redação nova do zero: é uma REFUTAÇÃO formal do motivo específico pelo '
                + 'qual o pedido anterior foi negado. Nunca redija como se fosse a primeira tentativa. É PROIBIDO qualquer '
                + 'linguagem de atendimento ao cliente: não responda ao consumidor, não agradeça pela reclamação, não peça '
                + 'desculpas, não oriente o consumidor a entrar em contato com a empresa, não se coloque à disposição. Não use '
                + 'travessão nem hífen com espaços como pausa; prefira vírgula ou ponto. Responda SOMENTE com JSON válido.';
            const linhasNegativa = [
                '📌 NEGATIVA RECEBIDA (motivo pelo qual o pedido anterior foi negado — cite isto no texto):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(não encontrado no texto colado)'}`,
                `- Código RA: ${nr.codigo || 'não identificado'}`,
                nr.regraOrientacao ? `- DIRETRIZ OFICIAL PARA CORRIGIR este motivo específico: ${nr.regraOrientacao}` : null,
                nr.regraReprovaQuando ? `- Esse motivo reprova quando: ${nr.regraReprovaQuando}` : null
            ].filter(l => l !== null);
            const user = [
                'HIPÓTESE DEFINITIVA (imutável):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISÃO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANÁLISE HOLÍSTICA DA DECISÃO (para embasar a relação lógica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                ...linhasNegativa,
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERÊNCIA DE ESTILO (apenas tom/estrutura, NÃO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUÇÕES DE REDAÇÃO (ESTRUTURA OBRIGATÓRIA — diferente da 1ª tentativa):',
                '- A saudação inicial deve ser dirigida à EQUIPE DE MODERAÇÃO do Reclame Aqui (ex.: "Prezada equipe de moderação do Reclame Aqui,"), NUNCA ao cliente.',
                '- (1) Cite EXPLICITAMENTE que este é um pedido de reanálise, referenciando o motivo/código da negativa anterior (ex.: "Solicitamos a reanálise do pedido de moderação, anteriormente indeferido sob a justificativa [código] [motivo].").',
                '- (2) REFUTE esse motivo específico de forma direta, aplicando a DIRETRIZ OFICIAL PARA CORRIGIR mostrada acima quando disponível — sustente com fatos verificáveis e trechos literais dos TEXTOS CRUS que o analista do RA não possa contestar. Não basta dizer que o motivo não se aplica; demonstre com evidência concreta por que não se aplica a ESTE caso.',
                '- (3) SÓ DEPOIS de refutar o motivo, reforce por que a hipótese selecionada se sustenta, ligando reclamação, resposta pública e consideração final.',
                '- (4) Conclua solicitando EXPLICITAMENTE a reanálise/moderação (ex.: "Diante do exposto, solicitamos o provimento desta reanálise.").',
                '- Prefira estrutura enumerada (1., 2., 3.) quando houver mais de um ponto a refutar — isso facilita a leitura pelo analista do RA.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustração/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questão seja resolvida", "Estamos à disposição", "Caso ainda tenha dúvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicação interna do processo: como o motivo da negativa foi refutado e por que a hipótese se sustenta",',
                '  "texto_final": "Prezada equipe de moderação do Reclame Aqui,\\n\\nSolicitamos a reanálise... (refutação do motivo + fundamentação) ...\\n\\nDiante do exposto, solicitamos o provimento desta reanálise."',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    // Variante de redacao-reformulacao@v1 com reavaliacao HOLISTICA (2026-09-10). Motivacao: analise
    // do caso real 258450515 (negado por CO07 "Resposta Nao Condizente") mostrou que v1 produz um
    // texto que so se defende do motivo especifico da negativa ("a resposta nao foi generica, foi
    // objetiva...") sem incorporar nenhum fato/trecho que a tentativa anterior nao tinha usado —
    // na pratica repete o mesmo argumento just com "solicitamos a reanalise" na frente. Seguindo
    // orientacao equivalente a criterio de banca de moderacao (a negativa deve ser usada so como
    // DIAGNOSTICO da deficiencia apontada, nao como limite do que o pedido pode conter): esta versao
    // recebe negativaReal.textoAnteriorModeracao (o texto da tentativa que foi negada) e exige
    // reavaliar reclamacao+resposta+consideracao final+hipotese por inteiro, comparando com a
    // tentativa anterior pra achar o que ficou de fora, em vez de so refutar o motivo da negativa.
    //
    // Ajuste 2026-09-11 (mesmo dia do deploy inicial, achado num caso real em producao com a flag ja
    // ligada — reclamacao 258599005, negada por CO06): auditoria externa (revisao cruzada via outro
    // LLM sobre o par reclamacao/resposta/negativa/segunda-tentativa real) encontrou 3 falhas na v2
    // original: (1) o texto abria citando "sob o codigo CO06" como sujeito da frase, o que ainda lia
    // como recurso administrativo em vez de reenquadramento; (2) o texto "virava advogado da
    // empresa" (frases como "isso justifica a variacao", "a empresa esclareceu" como o proprio
    // argumento) em vez de demonstrar objetivamente o enquadramento na hipotese; (3) ignorava por
    // completo a consideracao final mesmo quando ela trazia um fato novo relevante (aqui, "pediram
    // pra eu aguardar atualizacao do app"). Adicionadas 3 regras explicitas pra cada falha: nao abrir
    // com o codigo como sujeito, nao redigir como defesa da empresa, e so abordar a consideracao
    // final quando ela trouxer fato/alegacao NOVA (nao quando so reitera insatisfacao).
    //
    // Ajuste 2026-09-11 (2) — mesma auditoria, rodada 2, apos o fix acima ja rodar de novo no mesmo
    // caso real 258599005: nota subiu de 3/10 pra 7/10, confirmando a melhora, mas sobrou 1 falha
    // fina: o texto novo afirmou "a consideracao final nao apresenta novos fatos" quando na verdade
    // ela TINHA uma alegacao nova ("aguardar atualizacao do app") — so que nao comprovada. A regra
    // binaria (fato novo? sim/nao) deixava o modelo tratar "alegacao nao verificada" como "sem fato",
    // uma afirmacao mais forte do que os dados permitem. Regra ajustada: sempre avaliar se ha
    // alegacao nova, e se houver, reconhece-la sem trata-la como fato comprovado (em vez de negar
    // que ela existe).
    //
    // Ajuste 2026-09-11 (3) — mesma auditoria, rodada 3, sobre uma proposta maior (reestruturar
    // linha_raciocinio + texto_final num objeto com 5 sub-campos "diagnostico_reformulacao"):
    // contestei que a causa raiz fosse "ordem dos campos" (linha_raciocinio ja vem antes de
    // texto_final na geracao sequencial do JSON), e que a regra "texto_final so pode usar o que
    // estiver no diagnostico" nao e fiscalizavel sem outra chamada de IA. Convergimos numa versao
    // mais enxuta: reforcar linha_raciocinio (comparar explicitamente com a tentativa anterior,
    // identificar pontos omitidos/mal explorados/incorretos, e ter permissao EXPLICITA pra concluir
    // que nao ha falha material, proibido inventar deficiencia so pra justificar a reformulacao) e
    // adicionar so 1 campo novo, houve_ganho_material (booleano), como sinal de observabilidade pra
    // medir depois taxa de aceite — nao como controle da geracao. Regra do booleano: true somente
    // quando a mudanca elimina deficiencia real / responde elemento ignorado / reduz divergencia /
    // torna o enquadramento mais sustentavel; melhoria so de estilo/tom nao conta.
    'redacao-reformulacao@v2': {
        id: 'redacao',
        version: 'reformulacao-v2-holistica',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const nr = ctx.negativaReal || {};
            const system = 'PRIORIDADE MÁXIMA: O texto NÃO representa uma manifestação da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentação utilizada pela empresa para PEDIR A REANÁLISE de uma moderação JÁ NEGADA '
                + 'perante a equipe de moderação do Reclame Aqui. '
                + 'Você redige um DOCUMENTO DE REANÁLISE dirigido ao analista/equipe de moderação do Reclame Aqui; o consumidor '
                + 'NÃO é interlocutor. A hipótese JÁ foi decidida e é IMUTÁVEL: NÃO a reavalie, NÃO reinterprete os fatos, NÃO '
                + 'escolha outra hipótese. IMPORTANTE: o código/motivo da negativa (ver CONTEXTO DA REANÁLISE, mais abaixo) é '
                + 'APENAS um metadado de diagnóstico da deficiência do pedido anterior — o novo pedido NÃO deve se limitar a '
                + 'contestar ou refutar esse motivo específico. A abertura do texto deve apresentar diretamente o enquadramento '
                + 'da reclamação na hipótese definitiva e fundamentá-lo pelos fatos do caso; o código/motivo, se mencionado, '
                + 'aparece de forma breve e subordinada, nunca como sujeito da primeira frase. Depois de identificar a '
                + 'deficiência apontada pela negativa, '
                + 'REAVALIE INTEGRALMENTE a reclamação, a resposta pública e o enquadramento na hipótese do manual, produzindo '
                + 'uma fundamentação MATERIALMENTE MAIS FORTE que a tentativa anterior — não apenas uma defesa pontual do mesmo '
                + 'argumento sob palavras diferentes. O texto também NÃO deve soar como uma defesa da empresa: EVITE expressões '
                + 'que validem a posição da empresa como se fossem o próprio argumento (ex.: "isso justifica", "a empresa '
                + 'esclareceu", "o produto é experimental, portanto..."); apresente os fatos da reclamação/resposta e demonstre '
                + 'objetivamente por que eles se enquadram na hipótese do manual — o foco é o enquadramento da reclamação, não a '
                + 'correção da empresa. Avalie sempre se a CONSIDERAÇÃO FINAL contém uma ALEGAÇÃO NOVA — considere nova qualquer '
                + 'informação factual ou relato sobre o ocorrido que NÃO esteja na reclamação nem na resposta pública (ex.: "fui '
                + 'orientado a aguardar uma atualização do aplicativo"), mesmo apresentada de forma breve junto de uma '
                + 'manifestação de insatisfação; NÃO conta como alegação nova só reiterar insatisfação sem informação sobre o '
                + 'ocorrido (ex.: "continuo insatisfeito e a empresa não resolveu meu problema"). Se houver alegação nova, '
                + 'reconheça-a sem tratá-la como fato comprovado e avalie se ela pode alterar ou entrar em conflito com o '
                + 'enquadramento (proibido afirmar "não apresenta novos fatos" quando há alegação nova, mesmo que você conclua '
                + 'que ela não muda o enquadramento). Você recebe o TEXTO DA TENTATIVA ANTERIOR: compare-o com '
                + 'os TEXTOS CRUS antes de escrever e incorpore fatos/trechos que ela não explorou. O novo pedido deve '
                + 'demonstrar novamente, de forma completa, por que a publicação se enquadra na hipótese escolhida. Nunca '
                + 'redija como se fosse a primeira tentativa. É PROIBIDO qualquer linguagem de atendimento ao cliente: não '
                + 'responda ao consumidor, não agradeça pela reclamação, não peça desculpas, não oriente o consumidor a entrar '
                + 'em contato com a empresa, não se coloque à disposição. Não use travessão nem hífen com espaços como pausa; '
                + 'prefira vírgula ou ponto. Responda SOMENTE com JSON válido.';
            // Rotulado como metadado de diagnostico (nao "negativa recebida") e posicionado DEPOIS
            // dos textos crus de proposito (2026-09-11, 4a rodada de auditoria): colocar o
            // codigo/motivo como o PRIMEIRO elemento semantico que o modelo ve (antes ainda da
            // reclamacao/resposta) criava um efeito de proeminencia/priming que competia com a
            // proibicao textual de abrir citando o codigo — mesmo sem contradicao logica entre as
            // regras, o caso real 258599005 mostrou o modelo voltando a abrir com "sob o codigo
            // CO06" em uma reexecucao. Mover pro final e reformular o rotulo reduz essa competicao.
            const linhasNegativa = [
                'CONTEXTO DA REANÁLISE (metadados de diagnóstico do processo anterior — NÃO é o assunto do texto a escrever):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(não encontrado no texto colado)'}`,
                `- Código RA: ${nr.codigo || 'não identificado'}`,
                nr.regraOrientacao ? `- DIRETRIZ OFICIAL PARA CORRIGIR este motivo específico: ${nr.regraOrientacao}` : null,
                nr.regraReprovaQuando ? `- Esse motivo reprova quando: ${nr.regraReprovaQuando}` : null
            ].filter(l => l !== null);
            const user = [
                'HIPÓTESE DEFINITIVA (imutável):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISÃO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANÁLISE HOLÍSTICA DA DECISÃO (para embasar a relação lógica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                '📄 TEXTO DA TENTATIVA ANTERIOR (o que já foi dito e foi negado — identifique o que NÃO foi suficientemente explorado nele):',
                nr.textoAnteriorModeracao ? nr.textoAnteriorModeracao : '(texto da tentativa anterior não disponível)',
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                ...linhasNegativa,
                '',
                ctx.aprendizadoBloco ? `REFERÊNCIA DE ESTILO (apenas tom/estrutura, NÃO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUÇÕES DE REDAÇÃO (ESTRUTURA OBRIGATÓRIA — reavaliação holística, diferente da 1ª tentativa e diferente de uma mera refutação):',
                '- A saudação inicial deve ser dirigida à EQUIPE DE MODERAÇÃO do Reclame Aqui (ex.: "Prezada equipe de moderação do Reclame Aqui,"), NUNCA ao cliente.',
                '- (1) A abertura deve apresentar diretamente o enquadramento da reclamação na hipótese definitiva e, em seguida, fundamentá-lo pelos fatos do caso. O código e o motivo da negativa (ver CONTEXTO DA REANÁLISE) são apenas metadados de diagnóstico do processo anterior — se mencionados, devem aparecer de forma breve e subordinada, nunca como sujeito da primeira frase.',
                '- (2) Reavalie de forma integral: reclamação (fatos e pedido do consumidor) e resposta pública da empresa — usando trechos literais dos TEXTOS CRUS que a TENTATIVA ANTERIOR ainda não tenha citado, quando existirem.',
                '- (3) Avalie sempre se a CONSIDERAÇÃO FINAL contém uma ALEGAÇÃO NOVA: considere nova qualquer informação factual ou relato sobre o ocorrido que NÃO esteja na reclamação nem na resposta pública, mesmo apresentada de forma breve ou junto de uma manifestação de insatisfação. Exemplos de alegação nova: "fui orientado a aguardar uma atualização do aplicativo", "o atendimento informou que o valor seria corrigido até amanhã". NÃO é alegação nova: "continuo insatisfeito e a empresa não resolveu meu problema" (só reitera insatisfação, sem informação nova sobre o ocorrido). Se houver alegação nova, reconheça-a sem tratá-la como fato comprovado e avalie se ela pode alterar ou entrar em conflito com o enquadramento (proibido afirmar "não apresenta novos fatos" quando há uma alegação nova, mesmo que você conclua que ela não muda o enquadramento); se só reiterar insatisfação sem informação nova, não precisa abordá-la explicitamente.',
                '- (4) Construa uma fundamentação materialmente mais forte que a anterior: é PROIBIDO repetir os mesmos argumentos da tentativa anterior só com palavras diferentes, e é PROIBIDO redigir como se estivesse defendendo a empresa (nada de "isso justifica"/"a empresa esclareceu" como argumento principal) — demonstre com fatos por que o caso se enquadra na hipótese.',
                '- (5) Demonstre novamente, de forma completa, por que a hipótese selecionada se sustenta à luz dessa reavaliação ampliada — não apenas que o motivo da negativa não se aplica.',
                '- (6) Conclua solicitando EXPLICITAMENTE a reanálise/moderação (ex.: "Diante do exposto, solicitamos o provimento desta reanálise.").',
                '- Prefira estrutura enumerada (1., 2., 3.) quando houver mais de um ponto a apresentar — isso facilita a leitura pelo analista do RA.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustração/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questão seja resolvida", "Estamos à disposição", "Caso ainda tenha dúvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente".',
                '- DIAGNÓSTICO OBRIGATÓRIO pro campo linha_raciocinio: antes de escrever o texto final, compare EXPLICITAMENTE com a TENTATIVA ANTERIOR e identifique concretamente pontos que ficaram omitidos, mal explorados ou incorretos nela. É PROIBIDO inventar uma deficiência só pra justificar a reformulação — se a tentativa anterior já estiver materialmente adequada num ponto, reconheça isso explicitamente em vez de forçar uma diferença que não existe.',
                '- Preencha houve_ganho_material com true SOMENTE quando a nova redação identificar e incorporar uma mudança que elimina uma deficiência real, responde um elemento relevante antes ignorado, reduz uma divergência ou torna o enquadramento substancialmente mais sustentável. Melhorias só de tom, clareza, organização ou estilo NÃO contam como ganho material — nesses casos, retorne false.',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "diagnóstico concreto: compare com a tentativa anterior e identifique pontos omitidos/mal explorados/incorretos nela (ou reconheça que já estava adequada, sem inventar deficiência), e explique o que foi incorporado agora",',
                '  "houve_ganho_material": true,',
                '  "texto_final": "Prezada equipe de moderação do Reclame Aqui,\\n\\nSolicitamos a reanálise... (reavaliação holística + fundamentação ampliada) ...\\n\\nDiante do exposto, solicitamos o provimento desta reanálise."',
                '}'
            ].join('\n');
            return { system, user };
        }
    },

    // Variante de redacao@v2 que recebe os CRITERIOS ESPECIFICOS do manual (quandoSeAplica +
    // criterios[]) para a hipotese ja decidida — a DECISAO ve esses criterios (via manualBloco),
    // mas hipotese_selecionada so carrega id/titulo/manual/comoCitar, entao REDACAO v2 nunca
    // recebe os criterios em si e acaba citando a categoria de forma generica em vez de demonstrar
    // criterio por criterio que o caso se enquadra. Baseado na mesma analise de calibracao de
    // 2026-09-08 que gerou redacao-reformulacao@v1 (mesmo padrao: citar a base normativa
    // especifica, nao so o rotulo, fortalece o pedido).
    'redacao@v3': {
        id: 'redacao',
        version: 'v3',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const ch = ctx.criteriosHipotese || {};
            const system = 'PRIORIDADE MÁXIMA: O texto NÃO representa uma manifestação da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentação utilizada pela empresa para solicitar a moderação da reclamação perante a equipe '
                + 'de moderação do Reclame Aqui. '
                + 'Você redige um DOCUMENTO DE FUNDAMENTAÇÃO dirigido ao analista/equipe de moderação do Reclame Aqui; o consumidor '
                + 'NÃO é interlocutor. A hipótese JÁ foi decidida e é IMUTÁVEL: NÃO a reavalie, NÃO reinterprete os fatos, NÃO '
                + 'escolha outra hipótese. É PROIBIDO qualquer linguagem de atendimento ao cliente: não responda ao consumidor, não '
                + 'agradeça pela reclamação, não peça desculpas, não oriente o consumidor a entrar em contato com a empresa, não se '
                + 'coloque à disposição. Não use travessão nem hífen com espaços como pausa; prefira vírgula ou ponto. Responda SOMENTE com JSON válido.';
            const linhasCriterios = [
                ch.quandoSeAplica ? `- Quando esta hipótese se aplica, segundo o manual: ${ch.quandoSeAplica}` : null,
                Array.isArray(ch.criterios) && ch.criterios.length
                    ? `- Critérios específicos que o manual exige pra essa hipótese: ${ch.criterios.join(' | ')}`
                    : null
            ].filter(l => l !== null);
            const user = [
                'HIPÓTESE DEFINITIVA (imutável):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISÃO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANÁLISE HOLÍSTICA DA DECISÃO (para embasar a relação lógica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                linhasCriterios.length ? '📖 BASE NORMATIVA ESPECÍFICA DESTA HIPÓTESE (cite e demonstre CADA item abaixo, não só o nome da categoria):' : null,
                ...linhasCriterios,
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitação: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideração final: ${ctx.consideracao || '(não informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERÊNCIA DE ESTILO (apenas tom/estrutura, NÃO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUÇÕES DE REDAÇÃO:',
                '- A saudação inicial deve ser dirigida à EQUIPE DE MODERAÇÃO do Reclame Aqui (ex.: "Prezada equipe de moderação do Reclame Aqui,"), NUNCA ao cliente.',
                '- Estrutura obrigatória do texto_final:',
                '  (1) justificar por que o caso se enquadra no Manual de Moderação (citando a hipótese/como citar);',
                '  (2) SE HOUVER "BASE NORMATIVA ESPECÍFICA" acima, demonstrar EXPLICITAMENTE, com trecho literal dos TEXTOS CRUS, que CADA critério/condição listado é satisfeito pelo caso — não basta nomear a categoria, prove item por item;',
                '  (3) demonstrar a relação entre a reclamação, a resposta pública da empresa e a consideração final do consumidor;',
                '  (4) concluir solicitando EXPLICITAMENTE a moderação (ex.: "Solicitamos a moderação...").',
                '- FUNDAMENTAÇÃO VINCULADA À HIPÓTESE: demonstre POR QUE a reclamação, a resposta pública e a consideração final justificam ESPECIFICAMENTE a hipótese selecionada. Não basta citar a hipótese; construa a relação lógica entre os fatos do caso e o enquadramento. Evite afirmações genéricas como "O caso se enquadra em X" sem demonstrar o porquê.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustração/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questão seja resolvida", "Estamos à disposição", "Caso ainda tenha dúvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente". (Observação: "Entendemos que a reclamação se enquadra..." é permitido, pois é argumentação dirigida ao moderador.)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicação interna do processo, consequência da hipótese decidida",',
                '  "texto_final": "Prezada equipe de moderação do Reclame Aqui,\\n\\n... (fundamentação em parágrafos, com os critérios do manual demonstrados um a um) ...\\n\\nDiante do exposto, solicitamos a moderação."',
                '}'
            ].filter(l => l !== null).join('\n');
            return { system, user };
        }
    }
};

/** Retorna a entrada do registro (ex.: 'decisao@v1'). */
function getPrompt(ref) {
    const entry = REGISTRY[ref];
    if (!entry) throw new Error(`[promptRegistry] prompt inexistente: ${ref}`);
    return entry;
}

/** Renderiza o prompt e devolve tambem versao e hash para persistencia/reprodutibilidade. */
function render(ref, ctx) {
    const entry = getPrompt(ref);
    const { system, user } = entry.build(ctx || {});
    const hash = sha256(`${system}\n----\n${user}`);
    return {
        ref,
        promptId: entry.id,
        version: entry.version,
        responseFormat: entry.responseFormat,
        system,
        user,
        hash
    };
}

module.exports = { REGISTRY, getPrompt, render, sha256 };
