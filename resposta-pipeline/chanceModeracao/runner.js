'use strict';

const ws = require('../workflowState');
const { ACTORS } = require('../constants');

/**
 * Adaptador PEV — invoca executarChanceModeracao (dominio) via deps.
 * Nao conhece prompt, OpenAI ou motor-pontuacao.
 */
async function runChanceModeracao(state, deps = {}) {
    const executar = deps.executarChanceModeracao;
    if (typeof executar !== 'function') {
        ws.logDecision(state, {
            actor: ACTORS.CODIGO,
            event: 'chance.pulada',
            reason: 'service_nao_injetado'
        });
        return { executada: false, sucesso: null, pulada: true, motivoPulo: 'service_nao_injetado' };
    }

    if (!state.respostaPublica || !String(state.respostaPublica).trim()) {
        ws.logDecision(state, {
            actor: ACTORS.CODIGO,
            event: 'chance.pulada',
            reason: 'resposta_publica_ausente'
        });
        return { executada: false, sucesso: null, pulada: true, motivoPulo: 'resposta_publica_ausente' };
    }

    const textoCliente = state.entradasCruas?.texto_cliente;
    if (!textoCliente || !String(textoCliente).trim()) {
        ws.logDecision(state, {
            actor: ACTORS.CODIGO,
            event: 'chance.pulada',
            reason: 'reclamacao_ausente'
        });
        return { executada: false, sucesso: null, pulada: true, motivoPulo: 'reclamacao_ausente' };
    }

    const input = {
        reclamacaoCompleta: textoCliente,
        respostaPublica: state.respostaPublica,
        solucaoImplementada: state.entradasCruas?.solucao_implementada || '',
        consideracaoFinal: state.entradasCruas?.consideracao_final || '',
        historicoModeracao: state.entradasCruas?.historico_moderacao || '',
        userData: deps.userData || null
    };

    try {
        const out = await executar(input);
        state.chanceModeracao = {
            executada: true,
            sucesso: !!out.sucesso,
            result: out.result ?? null,
            motor: out.motor ?? null,
            motorReformulado: out.motorReformulado ?? null,
            respostaOriginal: out.respostaOriginal ?? null,
            respostaReformulada: out.respostaReformulada ?? null,
            respostaSugerida: out.respostaSugerida ?? null,
            reformulacaoAprovada: out.reformulacaoAprovada ?? null,
            avisoRegressao: out.avisoRegressao ?? null,
            comparacao: out.comparacao ?? null,
            deltaPorCriterio: out.deltaPorCriterio ?? null,
            oportunidadesMelhoria: out.oportunidadesMelhoria ?? null,
            versions: out.versions ?? null,
            erro: out.sucesso ? null : (out.erro || null),
            telemetria: out.telemetria || null
        };

        ws.addArtefato(state, {
            tipo: 'ChanceModeracao',
            payload: {
                sucesso: state.chanceModeracao.sucesso,
                chanceFinal: out.motor?.chance_final ?? out.motor?.metadados?.chance_final ?? null,
                fluxo: out.telemetria?.fluxo ?? null
            }
        });

        ws.logDecision(state, {
            actor: ACTORS.CODIGO,
            event: out.sucesso ? 'chance.executada' : 'chance.falha',
            reason: out.sucesso
                ? `chance=${out.motor?.chance_final ?? out.motor?.metadados?.chance_final ?? 'n/a'} fluxo=${out.telemetria?.fluxo ?? 'n/a'}`
                : (out.erro || 'erro_desconhecido')
        });

        return {
            executada: true,
            sucesso: !!out.sucesso,
            pulada: false
        };
    } catch (err) {
        state.chanceModeracao = {
            executada: true,
            sucesso: false,
            result: null,
            motor: null,
            erro: err.message || String(err),
            telemetria: null
        };

        ws.logDecision(state, {
            actor: ACTORS.CODIGO,
            event: 'chance.falha',
            reason: err.message || String(err)
        });

        return {
            executada: true,
            sucesso: false,
            pulada: false
        };
    }
}

module.exports = { runChanceModeracao };
