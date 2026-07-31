'use strict';

const assert = require('assert');
const {
    buildRespostaPublica,
    resolveContextoResposta,
    obterPrimeiroNomeUsuario
} = require('../responseBuilder');

const MIOLO = 'Cliente contatado. Orientado a acompanhar aplicativo. Detalhes sobre prazo de restituicao informados.';

(function runTests() {
    const basica = buildRespostaPublica({
        conteudoMiolo: MIOLO,
        nomeCliente: 'Maria',
        nomeAgente: 'Joao',
        userData: { genero: 'M' }
    });

    assert.ok(basica.includes('Olá, Maria!'), 'saudacao cliente');
    assert.ok(basica.includes('Sou o Joao, analista'), 'apresentacao agente masculino');
    assert.ok(basica.includes('3003-7293'), 'telefone capital');
    assert.ok(basica.includes('0800-800-0049'), 'telefone demais');
    assert.ok(basica.includes('Equipe de Atendimento Velotax'), 'assinatura');
    assert.ok(basica.includes(MIOLO), 'transparencia semantica: miolo integral');

    const semCliente = buildRespostaPublica({
        conteudoMiolo: MIOLO,
        nomeCliente: null,
        nomeAgente: 'Agente'
    });
    assert.ok(semCliente.includes('Olá, cliente!'), 'fallback cliente');

    const semAgente = buildRespostaPublica({
        conteudoMiolo: MIOLO,
        nomeCliente: 'Ana',
        nomeAgente: '',
        userData: null
    });
    assert.ok(semAgente.includes('Sou analista de atendimento do Velotax'), 'fallback agente');

    const feminino = buildRespostaPublica({
        conteudoMiolo: MIOLO,
        nomeCliente: 'Ana',
        nomeAgente: 'Paula',
        userData: { genero: 'F' }
    });
    assert.ok(feminino.includes('Sou a Paula, analista'), 'artigo feminino');

    assert.strictEqual(
        obterPrimeiroNomeUsuario({ nome: 'Caroline Santiago' }),
        'Carol',
        'caso Caroline Santiago'
    );

    const ctx = resolveContextoResposta({
        entradasCruas: {
            nome_solicitante: 'Pedro Silva',
            texto_cliente: 'Reclamacao qualquer'
        },
        userData: { nome: 'Ana Costa', genero: 'F' }
    });
    assert.strictEqual(ctx.nomeCliente, 'Pedro Silva');
    assert.strictEqual(ctx.nomeAgente, 'Ana');

    const ctxSemNome = resolveContextoResposta({
        entradasCruas: {
            texto_cliente: 'Olá, sou iniciante agora e preciso de ajuda'
        },
        userData: { nome: 'Ana Costa' }
    });
    assert.strictEqual(ctxSemNome.nomeCliente, null, 'sem heuristica na reclamacao');

    const jaFormatada = buildRespostaPublica({
        conteudoMiolo: basica,
        nomeCliente: 'Maria',
        nomeAgente: 'Carlos',
        userData: { genero: 'M' }
    });
    assert.ok(jaFormatada.includes('Sou o Carlos, analista'), 'idempotencia: atualiza agente');
    assert.ok(jaFormatada.includes(MIOLO), 'idempotencia: miolo preservado');

    console.log('resposta-pipeline/__tests__/responseBuilder.test.js — OK');
})();
