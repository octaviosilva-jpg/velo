'use strict';

/**
 * ResponseBuilder — composição terminal da resposta pública RA (Reclame Aqui).
 * Etapa de apresentação: envelope fixo Velotax sobre conteudoMiolo validado.
 * Semanticamente transparente — não altera o miolo resolutivo.
 */

function obterPrimeiroNomeUsuario(userData) {
    if (!userData || !userData.nome) {
        return 'Agente';
    }

    const nomeCompleto = userData.nome.trim().replace(/\s+/g, ' ');
    if (/^caroline\s+santiago$/i.test(nomeCompleto)) {
        return 'Carol';
    }

    const primeiroNome = nomeCompleto.split(/\s+/)[0];
    return primeiroNome || 'Agente';
}

function normalizarChavePrimeiroNome(nome) {
    if (!nome || typeof nome !== 'string') return '';
    const primeiro = nome.trim().split(/\s+/)[0] || '';
    return primeiro.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function inferirGeneroPorNomeExibicao(nomeExibicao, userData) {
    if (userData) {
        const g = String(userData.genero || userData.sexo || '').toLowerCase();
        if (['f', 'feminino', 'mulher', 'fem'].includes(g)) return 'F';
        if (['m', 'masculino', 'homem', 'masc'].includes(g)) return 'M';
    }
    if (!nomeExibicao || String(nomeExibicao).trim() === '' || nomeExibicao === 'Agente') return 'M';
    const key = normalizarChavePrimeiroNome(nomeExibicao);
    const feminino = new Set(['carol', 'caroline', 'nayara', 'ana', 'maria', 'julia', 'juliana', 'fernanda', 'patricia', 'amanda', 'camila', 'lais', 'luana', 'bruna', 'beatriz', 'lara', 'laura', 'paula', 'monica', 'janaina', 'taina', 'raquel', 'ingrid', 'deborah', 'debora', 'bianca', 'solange', 'vanessa', 'aline', 'priscila', 'roberta', 'tatiana', 'adriana', 'fabiana', 'liliane', 'simone', 'gabriela', 'daniela', 'leticia', 'tamires', 'jessica', 'carla', 'viviane', 'ariane', 'milene', 'mariana', 'renata', 'cristina', 'silvana', 'suelen', 'thais', 'yasmim', 'yasmin', 'brenda', 'tamara', 'michelle', 'sheila', 'rosana', 'lidiane', 'mayara', 'dayane', 'graziela', 'tainara', 'samara', 'valeria', 'claudia', 'eliane', 'karina', 'sabrina']);
    const masculino = new Set(['octavio', 'marcos', 'carlos', 'paulo', 'joao', 'pedro', 'lucas', 'gabriel', 'rafael', 'daniel', 'bruno', 'felipe', 'andre', 'ricardo', 'rodrigo', 'thiago', 'gustavo', 'leonardo', 'matheus', 'mateus', 'marcelo', 'vinicius', 'renan', 'eduardo', 'fernando', 'fabricio', 'alexandre', 'diego', 'igor', 'samuel', 'henrique', 'antonio', 'caio', 'murilo', 'sergio', 'jorge', 'william', 'guilherme', 'caua', 'enzo', 'otavio', 'alan', 'julio', 'jonathan', 'wagner', 'kleber', 'fabio', 'rogerio', 'claudio']);
    const masculinoComA = new Set(['luca', 'isaque', 'isaac', 'josu', 'josue', 'tobias', 'abias', 'elias', 'jonas', 'mathias']);
    if (feminino.has(key)) return 'F';
    if (masculino.has(key)) return 'M';
    if (key.length >= 3 && key.endsWith('a') && !masculinoComA.has(key)) return 'F';
    return 'M';
}

function obterArtigoDefinidoAgente(nomeExibicao, userData) {
    if (!nomeExibicao || String(nomeExibicao).trim() === '' || nomeExibicao === 'Agente') return null;
    return inferirGeneroPorNomeExibicao(nomeExibicao, userData) === 'F' ? 'a' : 'o';
}

function humanizarPontuacaoGerada(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    let t = texto.replace(/\u2014/g, ', ').replace(/\u2013/g, ', ').replace(/\u2012/g, ', ');
    t = t.replace(/\s+--\s+/g, ', ').replace(/\s+-\s+/g, ', ');
    t = t.replace(/,\s*,+/g, ', ');
    return t;
}

function normalizarNomeVelotax(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    const urls = [];
    let t = texto.replace(/(https?:\/\/[^\s]+|www\.velotax\.com\.br)/gi, (match) => {
        urls.push(match);
        return `\x00URL${urls.length - 1}\x00`;
    });
    t = t.replace(/\b(?:a|A) Velotax\b/g, 'o Velotax');
    t = t.replace(/\b(?:ao|Ao) Velotax\b/g, 'ao Velotax');
    t = t.replace(/\b(?:da|Da) Velotax\b/g, 'do Velotax');
    t = t.replace(/\b(?:das|Das) Velotax\b/g, 'dos Velotax');
    t = t.replace(/\b(?:na|Na) Velotax\b/g, 'no Velotax');
    t = t.replace(/\b(?:nas|Nas) Velotax\b/g, 'nos Velotax');
    t = t.replace(/\b(?:pela|Pela) Velotax\b/g, 'pelo Velotax');
    t = t.replace(/\b(?:pelas|Pelas) Velotax\b/g, 'pelos Velotax');
    t = t.replace(/\b(?:uma|Uma) Velotax\b/g, 'um Velotax');
    t = t.replace(/\bvelotax\b/gi, 'Velotax');
    t = t.replace(/\x00URL(\d+)\x00/g, (_, i) => urls[Number(i)]);
    return t;
}

function reduzirAgradecimentosExcessivos(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    const padroesAgradecimento = [
        /[^.!?\n]*\b(?:agradecemos|agradeço|agradece|obrigad[oa])\b[^.!?\n]*[.!?]\s*/gi,
        /[^.!?\n]*\b(?:pela (?:preocupa(?:ção|co)|confiança|oportunidade de esclarecimento|sua manifestação))\b[^.!?\n]*[.!?]\s*/gi,
        /[^.!?\n]*\brecebemos sua manifestação\b[^.!?\n]*[.!?]\s*/gi
    ];
    let t = texto;
    for (const padrao of padroesAgradecimento) {
        t = t.replace(padrao, '');
    }
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

function extrairNomeCliente(textoReclamacao) {
    if (!textoReclamacao || typeof textoReclamacao !== 'string') {
        return null;
    }

    const padroes = [
        /(?:Olá|Oi|Bom dia|Boa tarde|Boa noite|Prezados?|Sr\.|Sra\.|Srª\.|Dr\.|Dra\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /(?:meu nome é|sou|chamo-me|chamo me|me chamo)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+está|\s+foi|\s+será)/i
    ];

    for (const padrao of padroes) {
        const match = textoReclamacao.match(padrao);
        if (match && match[1]) {
            const nome = match[1].trim();
            if (nome.length <= 50 && !/\d/.test(nome)) {
                return nome;
            }
        }
    }

    return null;
}

function extrairMioloRespostaRA(respostaTexto) {
    if (!respostaTexto || typeof respostaTexto !== 'string') return respostaTexto || '';

    let textoLimpo = humanizarPontuacaoGerada(respostaTexto).trim();

    textoLimpo = textoLimpo.replace(/^(Olá|Oi|Prezado\(a\)?\s+cliente|Prezado\s+cliente|Prezada\s+cliente)[^!\n]*[!.,]\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou\s+(?:(?:o|a)\s+)?[^,]+,\s+(?:especialista|analista)[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^[^,]+,\s+(?:especialista|analista)\s+de\s+atendimento[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou analista de atendimento do Velotax\.\s*Recebemos[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou analista de atendimento do Velotax\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Espero\s+que\s+esteja\s+bem[.!]?\s*/i, '');
    textoLimpo = textoLimpo.replace(/^[^.]*recebemos\s+sua\s+manifestação[^.]*\.\s*/i, '');

    textoLimpo = reduzirAgradecimentosExcessivos(textoLimpo);

    textoLimpo = textoLimpo.replace(/\n*Permanecemos\s+à\s+disposição[^.]*\.\s*/gi, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*3003-7293[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*0800-800-0049[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*🌐\s*www\.velotax\.com\.br\s*/g, '');
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*[^\n]*\s*\n*Equipe\s+de\s+Atendimento[^\n]*$/i, '');
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*Equipe\s+Velotax\s*$/i, '');

    return normalizarNomeVelotax(textoLimpo.replace(/\n{3,}/g, '\n\n').trim());
}

/**
 * Resolve nomes para composição da resposta pública RA.
 * @param {{ entradasCruas?: object, userData?: object }} params
 */
function resolveContextoResposta({ entradasCruas = {}, userData } = {}) {
    const ec = entradasCruas || {};
    const nomeSolicitante = ec.nome_solicitante && String(ec.nome_solicitante).trim();
    const nomeCliente = nomeSolicitante || extrairNomeCliente(ec.texto_cliente) || null;
    const nomeAgente = obterPrimeiroNomeUsuario(userData);

    return { nomeCliente, nomeAgente };
}

/**
 * Compõe resposta pública RA a partir do miolo validado.
 * @param {{ conteudoMiolo: string, nomeCliente?: string|null, nomeAgente?: string, userData?: object }} params
 */
function buildRespostaPublica({ conteudoMiolo, nomeCliente, nomeAgente, userData } = {}) {
    let respostaTexto = conteudoMiolo;
    if (!respostaTexto || typeof respostaTexto !== 'string') {
        return respostaTexto;
    }

    respostaTexto = humanizarPontuacaoGerada(respostaTexto);

    if (!nomeAgente || nomeAgente.trim() === '') {
        nomeAgente = 'Agente';
    }

    const linhaApresentacaoAgente = () => {
        if (nomeAgente === 'Agente') {
            return 'Sou analista de atendimento do Velotax.';
        }
        const art = obterArtigoDefinidoAgente(nomeAgente, userData);
        return `Sou ${art} ${nomeAgente}, analista de atendimento do Velotax.`;
    };

    const jaTemEstruturaCompleta = respostaTexto.includes('Permanecemos à disposição por meio de nossos canais oficiais') ||
        respostaTexto.includes('3003-7293') ||
        respostaTexto.includes('0800-800-0049');

    if (jaTemEstruturaCompleta) {
        const temSaudacao = /Olá,\s+[^!]+!/.test(respostaTexto);
        const temApresentacao = /Sou\s+(?:(?:o|a)\s+)?[^,]+,?\s+(?:analista|especialista)\s+de\s+atendimento/i.test(respostaTexto)
            || /Sou analista de atendimento do Velotax/i.test(respostaTexto);
        const temContato = respostaTexto.includes('3003-7293') && respostaTexto.includes('0800-800-0049');
        const temAssinatura = /Atenciosamente,/.test(respostaTexto);

        if (temSaudacao && temApresentacao && temContato && temAssinatura) {
            if (nomeAgente !== 'Agente') {
                const art = obterArtigoDefinidoAgente(nomeAgente, userData);
                respostaTexto = respostaTexto.replace(
                    /Sou\s+(?:(?:o|a)\s+)?[^,]+,\s+(?:especialista|analista)/gi,
                    `Sou ${art} ${nomeAgente}, analista`
                );
                respostaTexto = respostaTexto.replace(
                    /Atenciosamente,\s*\n\s*[^\n]+\s*\n\s*Equipe de Atendimento Velotax/g,
                    `Atenciosamente,\n${nomeAgente} \nEquipe de Atendimento Velotax`
                );
            }
            return normalizarNomeVelotax(humanizarPontuacaoGerada(respostaTexto));
        }
    }

    const textoLimpo = extrairMioloRespostaRA(respostaTexto);
    const saudacaoCliente = nomeCliente && nomeCliente.trim() !== '' ? nomeCliente : 'cliente';

    const respostaFormatada = `Olá, ${saudacaoCliente}!

Espero que esteja bem.

${linhaApresentacaoAgente()}  

${textoLimpo}



Permanecemos à disposição por meio de nossos canais oficiais de atendimento:


📞 3003-7293 (capitais e regiões metropolitanas)
📞 0800-800-0049 (demais localidades)
🌐 www.velotax.com.br

Atenciosamente,
${nomeAgente} 
Equipe de Atendimento Velotax`;

    return normalizarNomeVelotax(humanizarPontuacaoGerada(respostaFormatada));
}

module.exports = {
    buildRespostaPublica,
    resolveContextoResposta,
    extrairNomeCliente,
    obterPrimeiroNomeUsuario
};
