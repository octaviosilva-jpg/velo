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
            const system = 'Voce e um extrator objetivo de fatos para analise de moderacao do Reclame Aqui. '
                + 'NAO interprete, NAO julgue, NAO consulte manuais, NAO escolha hipotese, NAO conclua. '
                + 'Apenas extraia o que esta explicito no conteudo. Responda SOMENTE com JSON valido.';
            const user = [
                'A partir do conteudo abaixo, extraia os dados objetivos.',
                '',
                `SOLICITACAO DO CLIENTE:\n${ctx.solicitacao || ''}`,
                `\nRESPOSTA DA EMPRESA:\n${ctx.resposta || ''}`,
                `\nCONSIDERACAO FINAL DO CONSUMIDOR:\n${ctx.consideracao || '(nao informada)'}`,
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
            const system = 'Voce e um AUDITOR de moderacao do Reclame Aqui. Escolha a hipotese MAIS FORTE '
                + 'do Manual sustentada pelos FATOS deste caso (nao pelo motivo sugerido, nao por modelos anteriores). '
                + 'Estrutura obrigatoria: (1) levante candidatas, (2) tente DERRUBAR cada uma com evidencias contrarias, '
                + '(3) finalize escolhendo UMA. NAO redija o texto de moderacao. Responda SOMENTE com JSON valido.';
            const user = [
                'FATOS EXTRAIDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                'BASE NORMATIVA (Manual):',
                ctx.manualBloco || '(base normativa indisponivel)',
                '',
                'UNIVERSO DE HIPOTESES:',
                ctx.universoHipoteses || '(universo indisponivel)',
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
            const system = 'Voce e um AUDITOR de moderacao do Reclame Aqui. ANTES de escolher a hipotese, e OBRIGATORIO '
                + 'analisar a reclamacao COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos (principal e secundarios); '
                + '(2) determinar o NUCLEO da reclamacao; (3) verificar, para CADA conflito, se foi efetivamente respondido pela '
                + 'empresa e com qual evidencia; (4) avaliar a consideracao final do consumidor; (5) SO ENTAO selecionar a hipotese '
                + 'do Manual que melhor representa o caso. A existencia de um assunto (ex.: negativa de credito) NAO determina a '
                + 'hipotese por si so; pondere a relacao entre reclamacao, resposta publica e consideracao final. A BASE NORMATIVA '
                + 'e apenas um recorte por palavra-chave (pode estar incompleta); use TAMBEM o UNIVERSO DE HIPOTESES. Escolha pelos '
                + 'FATOS, nao pelo motivo sugerido nem por modelos anteriores. NAO redija o texto de moderacao. Responda SOMENTE com JSON valido.';
            const user = [
                'FATOS EXTRAIDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                'RECORTE AUTOMATICO DO MANUAL (nao vinculante):',
                ctx.manualBloco || '(base normativa indisponivel)',
                '',
                'UNIVERSO DE HIPOTESES:',
                ctx.universoHipoteses || '(universo indisponivel)',
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipotese selecionada a TODOS os conflitos identificados (nao apenas ao primeiro tema).',
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
            const system = 'Voce e um AUDITOR de moderacao do Reclame Aqui. ANTES de escolher a hipotese, e OBRIGATORIO '
                + 'analisar a reclamacao COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos (principal e secundarios); '
                + '(2) determinar o NUCLEO da reclamacao; (3) verificar, para CADA conflito, se foi efetivamente respondido pela '
                + 'empresa e com qual evidencia; (4) avaliar a consideracao final do consumidor; (5) SO ENTAO selecionar a hipotese '
                + 'do Manual que melhor representa o caso. A existencia de um assunto (ex.: negativa de credito) NAO determina a '
                + 'hipotese por si so; pondere a relacao entre reclamacao, resposta publica e consideracao final. A BASE NORMATIVA '
                + 'e apenas um recorte por palavra-chave (pode estar incompleta); use TAMBEM o UNIVERSO DE HIPOTESES. Escolha pelos '
                + 'FATOS, nao pelo motivo sugerido nem por modelos anteriores. NAO redija o texto de moderacao. Responda SOMENTE com JSON valido.';
            const user = [
                'FATOS EXTRAIDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                'RECORTE AUTOMATICO DO MANUAL (nao vinculante):',
                ctx.manualBloco || '(base normativa indisponivel)',
                '',
                'UNIVERSO DE HIPOTESES:',
                ctx.universoHipoteses || '(universo indisponivel)',
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipotese selecionada a TODOS os conflitos identificados (nao apenas ao primeiro tema).',
                '',
                'PONDERACAO DE INSUMOS CONCORRENTES (quando apontarem para conflitos diferentes):',
                '',
                '- Os TEXTOS CRUS (reclamacao, resposta publica, consideracao final) constituem a principal base para a analise dos fatos e para a identificacao do nucleo e dos conflitos.',
                '- Os dados estruturados produzidos pela etapa de Compreensao (Chamada 1) auxiliam na organizacao da analise dos textos, mas nao vinculam a classificacao e podem ser reavaliados quando os fatos indicarem conclusao diferente.',
                '- O Recorte Automatico e referencia auxiliar: pode estar incompleto ou destacar tema secundario; nao vincula a classificacao.',
                '',
                '- Quando houver mais de um conflito plausivel, escolha como conflito principal aquele que melhor representa o objeto central da reclamacao e explica a controversia apresentada pelo consumidor, considerando conjuntamente os fatos narrados, os pedidos formulados, as acusacoes apresentadas, a resposta da empresa e a consideracao final do consumidor. O pedido formulado pode ser consequencia desejada e nao o objeto principal do conflito. Nao escolha com base apenas no primeiro assunto mencionado, no tema mais recorrente na narrativa, no conflito_principal da Compreensao ou no tema destacado pelo Recorte Automatico.',
                '',
                '- A cobertura da resposta informa se cada conflito foi respondido (passo 3), mas nao substitui a definicao do nucleo nem conduz sozinho a escolha da hipotese.',
                '- Recorte e Universo servem para enquadrar a hipotese SOMENTE apos definidos nucleo e conflito principal; conflitos secundarios devem constar em analise_holistica e justificativa, mas nao conduzir sozinhos a escolha da hipotese.',
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
            const system = 'Voce e um AUDITOR de moderacao do Reclame Aqui investigando por que um pedido JA FOI NEGADO e decidindo '
                + 'se a hipotese precisa mudar. NAO e uma redacao com "palavras melhores": e uma nova decisao. ANTES de escolher a '
                + 'hipotese, e OBRIGATORIO analisar a reclamacao COMO UM TODO, nesta ordem: (1) identificar TODOS os conflitos '
                + '(principal e secundarios); (2) determinar o NUCLEO da reclamacao; (3) verificar, para CADA conflito, se foi '
                + 'efetivamente respondido pela empresa e com qual evidencia; (4) avaliar a consideracao final do consumidor; '
                + '(5) diagnosticar EXATAMENTE por que a tentativa anterior falhou, usando o motivo/codigo real citado pelo RA '
                + '(nao suposicao); (6) SO ENTAO selecionar, do UNIVERSO DE HIPOTESES, a hipotese do Manual que melhor representa '
                + 'o caso — mantendo a hipotese anterior e reforcando evidencias apenas se ela genuinamente evitar esbarrar na regra '
                + 'AENV que o RA citou, ou trocando por uma hipotese diferente e mais forte quando a anterior esbarrar nessa regra '
                + 'ou nao resistir a nova analise. IMPORTANTE: a regra AENV citada pelo RA na negativa (ex.: "Nao pode haver '
                + 'divergencia de informacoes") e um CRITERIO DE VALIDACAO que toda hipotese da categoria AENV precisa satisfazer, '
                + 'NUNCA e ela propria uma hipotese selecionavel — hipotese_selecionada tem que ser sempre um item do UNIVERSO DE '
                + 'HIPOTESES, nunca o titulo de uma regra AENV. A existencia de um assunto NAO determina a hipotese por si so; '
                + 'pondere reclamacao, resposta publica e consideracao final. A BASE NORMATIVA e apenas um recorte por palavra-chave '
                + '(pode estar incompleta); use TAMBEM o UNIVERSO DE HIPOTESES. Escolha pelos FATOS, nao pelo motivo sugerido nem '
                + 'por hipoteses de tentativas anteriores por si so. NAO redija o texto de moderacao. Responda SOMENTE com JSON valido.';
            const linhasNegativa = [
                '📌 NEGATIVA REAL DO RA (extraida do e-mail colado pelo agente, nao e suposicao):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(nao encontrado no texto colado)'}`,
                `- Codigo RA: ${nr.codigo || 'nao identificado'}`,
                nr.regraTitulo ? `- Regra AENV correspondente (CRITERIO DE VALIDACAO, NAO e uma hipotese selecionavel): "${nr.regraTitulo}"` : '- Codigo ainda nao mapeado no manual interno; baseie-se apenas no motivo oficial acima.',
                nr.regraOQueVerifica ? `  O que essa regra verifica: ${nr.regraOQueVerifica}` : null,
                nr.regraReprovaQuando ? `  Reprova quando: ${nr.regraReprovaQuando}` : null,
                nr.regraOrientacao ? `  Diretriz oficial para corrigir: ${nr.regraOrientacao}` : null,
                `- Hipotese usada na tentativa anterior (auditoria interna anterior): ${nr.hipoteseAnterior || '(nao registrada)'}`,
                nr.teseBateu === false ? '- ⚠️ SINAL: a hipotese anterior esbarra na regra AENV que o RA citou (nao evitava esse problema). Forte indicio de que a TESE estava errada, nao so a redacao.' : null,
                nr.teseBateu === true ? '- ✅ SINAL: a hipotese anterior JA evitava esbarrar na regra AENV que o RA citou. Forte indicio de que o problema foi de EXECUCAO (evidencia/redacao), nao de tese.' : null
            ].filter(l => l !== null);

            const user = [
                'FATOS EXTRAIDOS (Chamada 1):',
                JSON.stringify(ctx.compreensao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos literais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                'RECORTE AUTOMATICO DO MANUAL (nao vinculante):',
                ctx.manualBloco || '(base normativa indisponivel)',
                '',
                'UNIVERSO DE HIPOTESES:',
                ctx.universoHipoteses || '(universo indisponivel)',
                '',
                ...linhasNegativa,
                '',
                'No campo "respondido_pela_empresa" use true, false ou a string "parcial". O campo "tipo" deve ser "principal" ou "secundario".',
                'A "justificativa" deve relacionar a hipotese selecionada a TODOS os conflitos identificados (nao apenas ao primeiro tema).',
                '',
                'PONDERACAO DE INSUMOS CONCORRENTES (quando apontarem para conflitos diferentes):',
                '- Os TEXTOS CRUS (reclamacao, resposta publica, consideracao final) constituem a principal base para a analise dos fatos.',
                '- Os dados estruturados da Compreensao auxiliam a organizar a analise, mas nao vinculam a classificacao.',
                '- O Recorte Automatico e referencia auxiliar, nao vincula a classificacao.',
                '- Quando houver mais de um conflito plausivel, escolha como principal aquele que melhor representa o objeto central da reclamacao, considerando fatos, pedidos, acusacoes, resposta da empresa e consideracao final.',
                '',
                'DIAGNOSTICO OBRIGATORIO DA TENTATIVA ANTERIOR:',
                '- Aponte, com base nos fatos e na negativa real acima, exatamente ONDE a tentativa anterior falhou (tese errada? faltou trecho literal que sustentasse? ignorou um conflito relevante? a resposta publica genuinamente nao sustenta nenhuma tese?).',
                '- Classifique a FORCA da nova tentativa: "forte" (a negativa decorreu principalmente de tese ruim e voce corrigiu o fundamento), "media" (existe tese defensavel mas ha divergencia factual real ou lacuna na resposta publica), ou "fraca" (a resposta publica realmente nao sustenta a moderacao, ha divergencia factual direta ou informacao relevante nao respondida). Isto e avaliacao qualitativa sua, nao estatistica do RA.',
                '- Mesmo classificando como "fraca", voce DEVE selecionar a hipotese mais forte disponivel e preencher todos os campos normalmente — a classificacao e um alerta interno, nunca motivo para deixar de decidir.',
                '',
                '⚠️ ATENCAO CRITICA SOBRE O CAMPO "hipotese_selecionada": ele tem que ser, sempre, um dos itens listados em UNIVERSO DE HIPOTESES acima (com id/titulo/manual/comoCitar tirados de la). A "Regra AENV correspondente" mostrada em NEGATIVA REAL DO RA (ex.: "Nao pode haver divergencia de informacoes", "Resposta publica condiz com o pedido de moderacao") e apenas um CRITERIO que a categoria AENV exige, igual aos outros criterios do RECORTE AUTOMATICO — nunca copie o titulo dessa regra AENV para "hipotese_selecionada". Se nenhuma hipotese do universo evitar claramente essa regra, escolha a mais proxima e sustentavel do universo mesmo assim, registrando a limitacao em "justificativa".',
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
            const system = 'Voce e um redator de solicitacoes de moderacao do Reclame Aqui. A hipotese JA foi decidida '
                + 'e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO escolha outra hipotese. '
                + 'Apenas redija. Nao use travessao nem hifen com espacos como pausa; prefira virgula ou ponto. '
                + 'Responda SOMENTE com JSON valido.';
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'Gere o texto final SEGUINDO EXATAMENTE o modelo de 3 paragrafos, iniciando com "Prezados,".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna do processo, consequencia da hipotese decidida",',
                '  "texto_final": "Prezados,\\n\\n... (3 paragrafos) ..."',
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
            const system = 'PRIORIDADE MAXIMA: O texto NAO representa uma manifestacao da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentacao utilizada pela empresa para solicitar a moderacao da reclamacao perante a equipe '
                + 'de moderacao do Reclame Aqui. '
                + 'Voce redige um DOCUMENTO DE FUNDAMENTACAO dirigido ao analista/equipe de moderacao do Reclame Aqui; o consumidor '
                + 'NAO e interlocutor. A hipotese JA foi decidida e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO '
                + 'escolha outra hipotese. E PROIBIDO qualquer linguagem de atendimento ao cliente: nao responda ao consumidor, nao '
                + 'agradeca pela reclamacao, nao peca desculpas, nao oriente o consumidor a entrar em contato com a empresa, nao se '
                + 'coloque a disposicao. Nao use travessao nem hifen com espacos como pausa; prefira virgula ou ponto. Responda SOMENTE com JSON valido.';
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANALISE HOLISTICA DA DECISAO (para embasar a relacao logica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUCOES DE REDACAO:',
                '- A saudacao inicial deve ser dirigida a EQUIPE DE MODERACAO do Reclame Aqui (ex.: "Prezada equipe de moderacao do Reclame Aqui,"), NUNCA ao cliente.',
                '- Estrutura obrigatoria do texto_final:',
                '  (1) justificar por que o caso se enquadra no Manual de Moderacao (citando a hipotese/como citar);',
                '  (2) demonstrar a relacao entre a reclamacao, a resposta publica da empresa e a consideracao final do consumidor;',
                '  (3) concluir solicitando EXPLICITAMENTE a moderacao (ex.: "Solicitamos a moderacao...").',
                '- FUNDAMENTACAO VINCULADA A HIPOTESE: demonstre POR QUE a reclamacao, a resposta publica e a consideracao final justificam ESPECIFICAMENTE a hipotese selecionada. Nao basta citar a hipotese; construa a relacao logica entre os fatos do caso e o enquadramento. Evite afirmacoes genericas como "O caso se enquadra em X" sem demonstrar o porque.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustracao/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questao seja resolvida", "Estamos a disposicao", "Caso ainda tenha duvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente". (Observacao: "Entendemos que a reclamacao se enquadra..." e permitido, pois e argumentacao dirigida ao moderador.)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna do processo, consequencia da hipotese decidida",',
                '  "texto_final": "Prezada equipe de moderacao do Reclame Aqui,\\n\\n... (fundamentacao em paragrafos) ...\\n\\nDiante do exposto, solicitamos a moderacao."',
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
            const system = 'PRIORIDADE MAXIMA: O texto NAO representa uma manifestacao da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentacao utilizada pela empresa para PEDIR A REANALISE de uma moderacao JA NEGADA '
                + 'perante a equipe de moderacao do Reclame Aqui. '
                + 'Voce redige um DOCUMENTO DE REFUTACAO dirigido ao analista/equipe de moderacao do Reclame Aqui; o consumidor '
                + 'NAO e interlocutor. A hipotese JA foi decidida e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO '
                + 'escolha outra hipotese. Isto NAO E uma redacao nova do zero: e uma REFUTACAO formal do motivo especifico pelo '
                + 'qual o pedido anterior foi negado. Nunca redija como se fosse a primeira tentativa. E PROIBIDO qualquer '
                + 'linguagem de atendimento ao cliente: nao responda ao consumidor, nao agradeca pela reclamacao, nao peca '
                + 'desculpas, nao oriente o consumidor a entrar em contato com a empresa, nao se coloque a disposicao. Nao use '
                + 'travessao nem hifen com espacos como pausa; prefira virgula ou ponto. Responda SOMENTE com JSON valido.';
            const linhasNegativa = [
                '📌 NEGATIVA RECEBIDA (motivo pelo qual o pedido anterior foi negado — cite isto no texto):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(nao encontrado no texto colado)'}`,
                `- Codigo RA: ${nr.codigo || 'nao identificado'}`,
                nr.regraOrientacao ? `- DIRETRIZ OFICIAL PARA CORRIGIR este motivo especifico: ${nr.regraOrientacao}` : null,
                nr.regraReprovaQuando ? `- Esse motivo reprova quando: ${nr.regraReprovaQuando}` : null
            ].filter(l => l !== null);
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANALISE HOLISTICA DA DECISAO (para embasar a relacao logica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                ...linhasNegativa,
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUCOES DE REDACAO (ESTRUTURA OBRIGATORIA — diferente da 1a tentativa):',
                '- A saudacao inicial deve ser dirigida a EQUIPE DE MODERACAO do Reclame Aqui (ex.: "Prezada equipe de moderacao do Reclame Aqui,"), NUNCA ao cliente.',
                '- (1) Cite EXPLICITAMENTE que este e um pedido de reanalise, referenciando o motivo/codigo da negativa anterior (ex.: "Solicitamos a reanalise do pedido de moderacao, anteriormente indeferido sob a justificativa [codigo] [motivo].").',
                '- (2) REFUTE esse motivo especifico de forma direta, aplicando a DIRETRIZ OFICIAL PARA CORRIGIR mostrada acima quando disponivel — sustente com fatos verificaveis e trechos literais dos TEXTOS CRUS que o analista do RA nao possa contestar. Nao basta dizer que o motivo nao se aplica; demonstre com evidencia concreta por que nao se aplica a ESTE caso.',
                '- (3) SO DEPOIS de refutar o motivo, reforce por que a hipotese selecionada se sustenta, ligando reclamacao, resposta publica e consideracao final.',
                '- (4) Conclua solicitando EXPLICITAMENTE a reanalise/moderacao (ex.: "Diante do exposto, solicitamos o provimento desta reanalise.").',
                '- Prefira estrutura enumerada (1., 2., 3.) quando houver mais de um ponto a refutar — isso facilita a leitura pelo analista do RA.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustracao/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questao seja resolvida", "Estamos a disposicao", "Caso ainda tenha duvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna do processo: como o motivo da negativa foi refutado e por que a hipotese se sustenta",',
                '  "texto_final": "Prezada equipe de moderacao do Reclame Aqui,\\n\\nSolicitamos a reanalise... (refutacao do motivo + fundamentacao) ...\\n\\nDiante do exposto, solicitamos o provimento desta reanalise."',
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
    'redacao-reformulacao@v2': {
        id: 'redacao',
        version: 'reformulacao-v2-holistica',
        responseFormat: 'json_object',
        build(ctx = {}) {
            const nr = ctx.negativaReal || {};
            const system = 'PRIORIDADE MAXIMA: O texto NAO representa uma manifestacao da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentacao utilizada pela empresa para PEDIR A REANALISE de uma moderacao JA NEGADA '
                + 'perante a equipe de moderacao do Reclame Aqui. '
                + 'Voce redige um DOCUMENTO DE REANALISE dirigido ao analista/equipe de moderacao do Reclame Aqui; o consumidor '
                + 'NAO e interlocutor. A hipotese JA foi decidida e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO '
                + 'escolha outra hipotese. IMPORTANTE: a negativa recebida (motivo/codigo abaixo) e APENAS um DIAGNOSTICO da '
                + 'deficiencia do pedido anterior — o novo pedido NAO deve se limitar a contestar ou refutar esse motivo '
                + 'especifico, e NAO deve abrir o texto citando o codigo/motivo da negativa como sujeito da frase (PROIBIDO '
                + 'comecar como "Solicitamos a reanalise da moderacao negada sob o codigo X, que indicou..."); se for citar o '
                + 'codigo, faca isso de forma breve e subordinada, so para rastreabilidade — o assunto do paragrafo de abertura '
                + 'e o enquadramento na hipotese, nao a negativa. Depois de identificar a deficiencia apontada pela negativa, '
                + 'REAVALIE INTEGRALMENTE a reclamacao, a resposta publica e o enquadramento na hipotese do manual, produzindo '
                + 'uma fundamentacao MATERIALMENTE MAIS FORTE que a tentativa anterior — nao apenas uma defesa pontual do mesmo '
                + 'argumento sob palavras diferentes. O texto tambem NAO deve soar como uma defesa da empresa: EVITE expressoes '
                + 'que validem a posicao da empresa como se fossem o proprio argumento (ex.: "isso justifica", "a empresa '
                + 'esclareceu", "o produto e experimental, portanto..."); apresente os fatos da reclamacao/resposta e demonstre '
                + 'objetivamente por que eles se enquadram na hipotese do manual — o foco e o enquadramento da reclamacao, nao a '
                + 'correcao da empresa. Avalie sempre se a CONSIDERACAO FINAL do consumidor contem um fato ou alegacao NOVA; se '
                + 'so reiterar insatisfacao sem fato novo, NAO precisa aborda-la. Se houver alegacao nova, verifique se ela pode '
                + 'alterar ou entrar em conflito com o enquadramento — mas NUNCA trate a alegacao do consumidor como fato '
                + 'comprovado (proibido afirmar algo como "nao apresenta novos fatos" quando ha uma alegacao nao verificada; em '
                + 'vez disso, reconheca a alegacao e explique que ela nao vem acompanhada, no conteudo disponivel, de elementos '
                + 'que confirmem alterar o enquadramento). Voce recebe o TEXTO DA TENTATIVA ANTERIOR: compare-o com '
                + 'os TEXTOS CRUS antes de escrever e incorpore fatos/trechos que ela nao explorou. O novo pedido deve '
                + 'demonstrar novamente, de forma completa, por que a publicacao se enquadra na hipotese escolhida. Nunca '
                + 'redija como se fosse a primeira tentativa. E PROIBIDO qualquer linguagem de atendimento ao cliente: nao '
                + 'responda ao consumidor, nao agradeca pela reclamacao, nao peca desculpas, nao oriente o consumidor a entrar '
                + 'em contato com a empresa, nao se coloque a disposicao. Nao use travessao nem hifen com espacos como pausa; '
                + 'prefira virgula ou ponto. Responda SOMENTE com JSON valido.';
            const linhasNegativa = [
                '📌 NEGATIVA RECEBIDA (use como DIAGNOSTICO da deficiencia — NAO e o unico ponto a responder):',
                `- Motivo oficial citado pelo RA: ${nr.motivoOficial || '(nao encontrado no texto colado)'}`,
                `- Codigo RA: ${nr.codigo || 'nao identificado'}`,
                nr.regraOrientacao ? `- DIRETRIZ OFICIAL PARA CORRIGIR este motivo especifico: ${nr.regraOrientacao}` : null,
                nr.regraReprovaQuando ? `- Esse motivo reprova quando: ${nr.regraReprovaQuando}` : null
            ].filter(l => l !== null);
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANALISE HOLISTICA DA DECISAO (para embasar a relacao logica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                ...linhasNegativa,
                '',
                '📄 TEXTO DA TENTATIVA ANTERIOR (o que ja foi dito e foi negado — identifique o que NAO foi suficientemente explorado nele):',
                nr.textoAnteriorModeracao ? nr.textoAnteriorModeracao : '(texto da tentativa anterior nao disponivel)',
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUCOES DE REDACAO (ESTRUTURA OBRIGATORIA — reavaliacao holistica, diferente da 1a tentativa e diferente de uma mera refutacao):',
                '- A saudacao inicial deve ser dirigida a EQUIPE DE MODERACAO do Reclame Aqui (ex.: "Prezada equipe de moderacao do Reclame Aqui,"), NUNCA ao cliente.',
                '- (1) Cite que isto e um pedido de reanalise SEM abrir o paragrafo com o codigo/motivo da negativa como sujeito da frase (nao comece com "Solicitamos a reanalise... sob o codigo X, que indicou..."); o assunto da abertura e o enquadramento na hipotese, nao a negativa. Se citar o codigo, faca de forma breve e subordinada, so pra rastreabilidade.',
                '- (2) Reavalie de forma integral: reclamacao (fatos e pedido do consumidor) e resposta publica da empresa — usando trechos literais dos TEXTOS CRUS que a TENTATIVA ANTERIOR ainda nao tenha citado, quando existirem.',
                '- (3) Avalie sempre se a CONSIDERACAO FINAL do consumidor contem um fato ou alegacao NOVA (ex.: uma orientacao ou promessa diferente da que consta na resposta publica). Se so reiterar insatisfacao sem fato novo, nao precisa aborda-la explicitamente. Se houver alegacao nova, verifique se ela pode alterar ou entrar em conflito com o enquadramento — mas NUNCA trate a alegacao do consumidor como fato comprovado (proibido afirmar "nao apresenta novos fatos" quando ha uma alegacao nao verificada; em vez disso, reconheca a alegacao e explique que ela nao vem acompanhada, no conteudo disponivel, de elementos que confirmem alterar o enquadramento).',
                '- (4) Construa uma fundamentacao materialmente mais forte que a anterior: e PROIBIDO repetir os mesmos argumentos da tentativa anterior so com palavras diferentes, e e PROIBIDO redigir como se estivesse defendendo a empresa (nada de "isso justifica"/"a empresa esclareceu" como argumento principal) — demonstre com fatos por que o caso se enquadra na hipotese.',
                '- (5) Demonstre novamente, de forma completa, por que a hipotese selecionada se sustenta a luz dessa reavaliacao ampliada — nao apenas que o motivo da negativa nao se aplica.',
                '- (6) Conclua solicitando EXPLICITAMENTE a reanalise/moderacao (ex.: "Diante do exposto, solicitamos o provimento desta reanalise.").',
                '- Prefira estrutura enumerada (1., 2., 3.) quando houver mais de um ponto a apresentar — isso facilita a leitura pelo analista do RA.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustracao/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questao seja resolvida", "Estamos a disposicao", "Caso ainda tenha duvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente".',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna: qual deficiencia a negativa diagnosticou, o que a tentativa anterior nao explorou, e o que foi incorporado agora",',
                '  "texto_final": "Prezada equipe de moderacao do Reclame Aqui,\\n\\nSolicitamos a reanalise... (reavaliacao holistica + fundamentacao ampliada) ...\\n\\nDiante do exposto, solicitamos o provimento desta reanalise."',
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
            const system = 'PRIORIDADE MAXIMA: O texto NAO representa uma manifestacao da empresa ao consumidor. Representa '
                + 'EXCLUSIVAMENTE a fundamentacao utilizada pela empresa para solicitar a moderacao da reclamacao perante a equipe '
                + 'de moderacao do Reclame Aqui. '
                + 'Voce redige um DOCUMENTO DE FUNDAMENTACAO dirigido ao analista/equipe de moderacao do Reclame Aqui; o consumidor '
                + 'NAO e interlocutor. A hipotese JA foi decidida e e IMUTAVEL: NAO a reavalie, NAO reinterprete os fatos, NAO '
                + 'escolha outra hipotese. E PROIBIDO qualquer linguagem de atendimento ao cliente: nao responda ao consumidor, nao '
                + 'agradeca pela reclamacao, nao peca desculpas, nao oriente o consumidor a entrar em contato com a empresa, nao se '
                + 'coloque a disposicao. Nao use travessao nem hifen com espacos como pausa; prefira virgula ou ponto. Responda SOMENTE com JSON valido.';
            const linhasCriterios = [
                ch.quandoSeAplica ? `- Quando esta hipotese se aplica, segundo o manual: ${ch.quandoSeAplica}` : null,
                Array.isArray(ch.criterios) && ch.criterios.length
                    ? `- Criterios especificos que o manual exige pra essa hipotese: ${ch.criterios.join(' | ')}`
                    : null
            ].filter(l => l !== null);
            const user = [
                'HIPOTESE DEFINITIVA (imutavel):',
                JSON.stringify(ctx.hipoteseSelecionada || {}, null, 2),
                `\nJUSTIFICATIVA DA DECISAO: ${ctx.justificativa || ''}`,
                '\nTRECHOS QUE SUSTENTAM:',
                JSON.stringify(ctx.trechosSustentam || [], null, 2),
                '\nANALISE HOLISTICA DA DECISAO (para embasar a relacao logica com os fatos):',
                JSON.stringify(ctx.analiseDecisao || {}, null, 2),
                '',
                linhasCriterios.length ? '📖 BASE NORMATIVA ESPECIFICA DESTA HIPOTESE (cite e demonstre CADA item abaixo, nao so o nome da categoria):' : null,
                ...linhasCriterios,
                '',
                'TEXTOS CRUS (para citar trechos, sem copiar dados pessoais):',
                `- Solicitacao: ${ctx.solicitacao || ''}`,
                `- Resposta: ${ctx.resposta || ''}`,
                `- Consideracao final: ${ctx.consideracao || '(nao informada)'}`,
                '',
                ctx.aprendizadoBloco ? `REFERENCIA DE ESTILO (apenas tom/estrutura, NAO muda os fatos):\n${ctx.aprendizadoBloco}\n` : '',
                'INSTRUCOES DE REDACAO:',
                '- A saudacao inicial deve ser dirigida a EQUIPE DE MODERACAO do Reclame Aqui (ex.: "Prezada equipe de moderacao do Reclame Aqui,"), NUNCA ao cliente.',
                '- Estrutura obrigatoria do texto_final:',
                '  (1) justificar por que o caso se enquadra no Manual de Moderacao (citando a hipotese/como citar);',
                '  (2) SE HOUVER "BASE NORMATIVA ESPECIFICA" acima, demonstrar EXPLICITAMENTE, com trecho literal dos TEXTOS CRUS, que CADA criterio/condicao listado e satisfeito pelo caso — nao basta nomear a categoria, prove item por item;',
                '  (3) demonstrar a relacao entre a reclamacao, a resposta publica da empresa e a consideracao final do consumidor;',
                '  (4) concluir solicitando EXPLICITAMENTE a moderacao (ex.: "Solicitamos a moderacao...").',
                '- FUNDAMENTACAO VINCULADA A HIPOTESE: demonstre POR QUE a reclamacao, a resposta publica e a consideracao final justificam ESPECIFICAMENTE a hipotese selecionada. Nao basta citar a hipotese; construa a relacao logica entre os fatos do caso e o enquadramento. Evite afirmacoes genericas como "O caso se enquadra em X" sem demonstrar o porque.',
                '- PROIBIDO usar linguagem de atendimento, por exemplo: "Agradecemos por utilizar nossa plataforma", "Entendemos sua frustracao/seu transtorno", "Lamentamos", "Pedimos desculpas", "Esperamos que sua questao seja resolvida", "Estamos a disposicao", "Caso ainda tenha duvidas", "Entre em contato conosco", "Recomendamos que entre em contato", "Prezado cliente". (Observacao: "Entendemos que a reclamacao se enquadra..." e permitido, pois e argumentacao dirigida ao moderador.)',
                '',
                'Retorne EXATAMENTE este JSON (sem texto adicional):',
                '{',
                '  "linha_raciocinio": "explicacao interna do processo, consequencia da hipotese decidida",',
                '  "texto_final": "Prezada equipe de moderacao do Reclame Aqui,\\n\\n... (fundamentacao em paragrafos, com os criterios do manual demonstrados um a um) ...\\n\\nDiante do exposto, solicitamos a moderacao."',
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
