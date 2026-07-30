'use strict';

const preProcessor = require('../preProcessor');
const { validateMiolo, PALAVRAS_GENERICAS } = require('../deterministicGate');
const { REGIME_SOLUCAO } = require('../constants');

const SYSTEM_PROMPT_RA = 'Você é um assistente do Velotax para respostas ao Reclame Aqui. A solução implementada é a fonte de verdade: explique apenas o que consta nela e nos demais campos do caso, sem inventar fatos. Modelos da base de aprendizado servem para tom e estrutura e, quando NÃO houver solução implementada, também como base da SOLUÇÃO: identifique a reclamação mais parecida e reaproveite a forma como aquele caso foi efetivamente resolvido (a orientação/solução concreta), adaptando ao caso atual, sem copiar dados pessoais de outros clientes (nomes, datas, valores, protocolos). Nunca entregue só contexto deixando o cliente sem solução. Cite LGPD, CCB, CDC ou cláusulas só se constarem na solução implementada. Não agradece pelo contato, pela preocupação ou pela confiança. Sempre escreva "Velotax" com V maiúsculo e no masculino (o Velotax, ao Velotax, do Velotax). A saudação com nome é aplicada pelo sistema após o texto. REGRA INEGOCIÁVEL: a resposta deve RESOLVER o problema no próprio corpo do texto. É TERMINANTEMENTE PROIBIDO sugerir ou direcionar o cliente a procurar o suporte técnico, a central, o SAC ou qualquer canal de atendimento para "averiguar", "verificar", "resolver" ou "dar continuidade" ao caso. O Reclame Aqui é o canal de quem a central NÃO resolveu, então NUNCA jogue o cliente de volta para esses canais. Não use frases como "entre em contato com o suporte", "procure nosso suporte técnico", "entre em contato com nossa central", "acione nossos canais para resolver". Não confunda com o rodapé institucional (aplicado pelo sistema), que é apenas formal.';

const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function buildPromptUsuarioBase(state, deps = {}) {
    const df = deps.dadosFormulario || state.entradasCruas || {};
    const dadosPlanilha = deps.dadosPlanilha;
    const conhecimentoProdutos = deps.conhecimentoProdutos;

    if (typeof deps.gerarScriptPadraoResposta !== 'function') {
        throw new Error('[raStandardPrompt] gerarScriptPadraoResposta ausente em deps');
    }
    if (typeof deps.reformularComConhecimento !== 'function') {
        throw new Error('[raStandardPrompt] reformularComConhecimento ausente em deps');
    }

    const script = deps.gerarScriptPadraoResposta(df);
    return deps.reformularComConhecimento(script, dadosPlanilha, df, conhecimentoProdutos);
}

function isSemSolucaoImplementada(dadosFormulario) {
    return preProcessor.avaliarDisponibilidadeSolucao(dadosFormulario?.solucao_implementada) === REGIME_SOLUCAO.VAZIA;
}

function buildRetryPromptCorrecao(basePrompt, dadosFormulario) {
    const semSolucao = isSemSolucaoImplementada(dadosFormulario);
    if (semSolucao) {
        return `${basePrompt}

${SEP}
CORREÇÃO OBRIGATÓRIA (TENTATIVA ANTERIOR CURTA OU SEM SOLUÇÃO)
${SEP}
A resposta anterior ficou enxuta e/ou não apresentou a solução para a reclamação.
NÃO há solução implementada informada: construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema (acima) e reescreva o miolo em 4 a 6 parágrafos completos, com o mesmo nível de detalhe e fundamentação dessas respostas. APRESENTE explicitamente a solução/encaminhamento que resolve a reclamação. NÃO copie dados pessoais nem números específicos de outro cliente.`;
    }

    return `${basePrompt}

${SEP}
CORREÇÃO OBRIGATÓRIA (TENTATIVA ANTERIOR REJEITADA)
${SEP}
A resposta anterior não incorporou corretamente a solução implementada.
Reescreva o miolo da resposta incorporando os fatos abaixo de forma clara e objetiva, sem inventar informação adicional:

SOLUÇÃO IMPLEMENTADA (incorporar na resposta):
${dadosFormulario.solucao_implementada || 'N/A'}`;
}

function buildRetryPromptDesenvolvimento(basePrompt, dadosFormulario) {
    const semSolucao = isSemSolucaoImplementada(dadosFormulario);
    if (semSolucao) {
        return `${basePrompt}

${SEP}
DESENVOLVIMENTO OBRIGATÓRIO (TENTATIVAS ANTERIORES CURTAS OU SEM SOLUÇÃO)
${SEP}
NÃO há solução implementada informada. Construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema (listadas acima) e escreva o miolo em 4 a 6 parágrafos completos, espelhando o nível de detalhe e fundamentação dessas respostas.
Estrutura obrigatória:
1) Responda diretamente ao ponto do cliente (NÃO redescreva a dor/reclamação dele)
2) Explique de forma técnica e clara a causa/funcionamento e o que o Velotax faz nesse tipo de caso, reaproveitando a fundamentação recorrente das respostas coerentes (bases normativas, procedimentos, prazos típicos do tema)
3) APRESENTE a solução/encaminhamento concreto que resolve a reclamação, espelhando como os casos coerentes semelhantes foram resolvidos
4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
NÃO copie dados pessoais nem números específicos de outro cliente/caso (nomes, datas exatas, valores, protocolos). NUNCA empurre o cliente para a central/suporte: a solução tem que estar no corpo da resposta.

TEXTO DO CLIENTE (para contextualizar):
${dadosFormulario.texto_cliente || 'N/A'}`;
    }

    return `${basePrompt}

${SEP}
DESENVOLVIMENTO OBRIGATÓRIO (TENTATIVAS ANTERIORES CURTAS OU DESALINHADAS)
${SEP}
Escreva o miolo da resposta em 3 a 5 parágrafos completos, incorporando explicitamente TODOS os elementos da solução implementada abaixo. NÃO invente dados além dela e NÃO copie fatos de outros casos.
Estrutura obrigatória:
1) Responda diretamente ao ponto do cliente já pela solução implementada (NÃO redescreva a dor/reclamação dele)
2) Explique de forma técnica e clara o que foi efetivamente feito, INCLUINDO todas as fundamentações da solução (bases normativas, CCB, cláusulas, leis, datas, prazos, valores e dados)
3) Mostre como essa solução, com essa fundamentação, resolve o ponto levantado
4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
NÃO omita nem resuma os fundamentos: cada base normativa, cláusula, data, valor ou dado citado na solução deve aparecer na resposta.

SOLUÇÃO IMPLEMENTADA (incorpore literalmente os elementos factuais e toda a fundamentação):
${dadosFormulario.solucao_implementada || 'N/A'}

TEXTO DO CLIENTE (para contextualizar):
${dadosFormulario.texto_cliente || 'N/A'}`;
}

function validateMioloLikeMonolith(texto, dadosFormulario) {
    const regime = preProcessor.avaliarDisponibilidadeSolucao(dadosFormulario?.solucao_implementada);
    return validateMiolo(texto, {
        solucaoImplementada: dadosFormulario?.solucao_implementada,
        regimeSolucao: regime
    });
}

function pickBestCandidate(candidatas) {
    return candidatas
        .filter(t => t && typeof t === 'string'
            && !PALAVRAS_GENERICAS.some(p => t.toLowerCase().includes(p)))
        .sort((a, b) => b.length - a.length)[0] || null;
}

function getRaStandardTemperatures() {
    return { base: 0.5, correcao: 0.3, desenvolvimento: 0.4 };
}

module.exports = {
    SYSTEM_PROMPT_RA,
    buildPromptUsuarioBase,
    buildRetryPromptCorrecao,
    buildRetryPromptDesenvolvimento,
    isSemSolucaoImplementada,
    validateMioloLikeMonolith,
    pickBestCandidate,
    getRaStandardTemperatures
};
