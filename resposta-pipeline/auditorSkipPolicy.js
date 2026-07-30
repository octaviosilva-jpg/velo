'use strict';

const {
    SKIP_POLICY_VERSION,
    SKIP_MOTIVO,
    NODES,
    REGIME_SOLUCAO,
    MODO_OPERACAO,
    FONTE_PRIMARIA
} = require('./constants');
const { assertFatosSubset } = require('./contracts');

const FASE = {
    VETO: 1,
    FLAG: 2,
    REGRAS: 3,
    ANTI_DUPLO: 4,
    SKIP_FINAL: 5
};

const VETOS_GLOBAIS = [
    {
        id: 'V01',
        match: (state) => (state.insumosPreparados?.regimeSolucao === REGIME_SOLUCAO.VAZIA)
    },
    {
        id: 'V02',
        match: (state) => (state.planoDeResposta?.modoOperacao === MODO_OPERACAO.CONSTRUIR)
    },
    {
        id: 'V03',
        match: (state) => ((state.executorRetryCount || 0) > 0)
    },
    {
        id: 'V04',
        match: (state) => (state.vereditoGate?.aprovado !== true)
    }
];

const REGRAS_FACTUAL = [
    {
        id: 'F01',
        match: (state) => (state.insumosPreparados?.regimeSolucao === REGIME_SOLUCAO.COMPLETA)
    },
    {
        id: 'F02',
        match: (state) => (state.planoDeResposta?.modoOperacao === MODO_OPERACAO.REFINAR)
    },
    {
        id: 'F03',
        match: (state) => (state.planoDeResposta?.fontePrimaria === FONTE_PRIMARIA.SOLUCAO_IMPLEMENTADA)
    },
    {
        id: 'F04',
        match: (state) => ((state.insumosPreparados?.matrizAutoridade?.lacunasDetectadas || []).length === 0)
    },
    {
        id: 'F05',
        match: (state) => (state.insumosPreparados?.matrizAutoridade?.solucaoImplementadaPresente === true)
    },
    {
        id: 'F06',
        match: (state) => ((state.planoDeResposta?.fatosAutorizados || []).length >= 1)
    },
    {
        id: 'F07',
        match: (state) => assertFatosSubset(
            state.planoDeResposta,
            state.insumosPreparados?.matrizAutoridade
        ).ok
    },
    {
        id: 'F08',
        match: (state) => ((state.executorRetryCount || 0) === 0)
    }
];

const REGRAS_EDITORIAL = [
    {
        id: 'E01',
        match: (state) => (state.insumosPreparados?.regimeSolucao === REGIME_SOLUCAO.COMPLETA)
    },
    {
        id: 'E02',
        match: (state) => (state.planoDeResposta?.modoOperacao === MODO_OPERACAO.REFINAR)
    },
    {
        id: 'E03',
        match: (state) => {
            const checklist = state.insumosPreparados?.kitReferencia?.checklistRA || '';
            return String(checklist).trim().length === 0;
        }
    },
    {
        id: 'E04',
        match: (state) => ((state.executorRetryCount || 0) === 0)
    },
    {
        id: 'E06',
        match: (state, deps) => {
            if (!deps.factualAuditorEnabled) return true;
            if (state.factualAuditorSkipped) return false;
            return state.vereditoFactual?.aprovado === true;
        }
    }
];

function isAuditorEnabled(alvo, deps) {
    if (alvo === 'factual') return deps.factualAuditorEnabled === true;
    if (alvo === 'editorial') return deps.editorialAuditorEnabled === true;
    return false;
}

function alvoNode(alvo) {
    return alvo === 'factual' ? NODES.AUDITOR_FACTUAL : NODES.AUDITOR_EDITORIAL;
}

function codigoMotivoSkip(alvo) {
    return alvo === 'factual' ? SKIP_MOTIVO.FACTUAL_TIER1 : SKIP_MOTIVO.EDITORIAL_TIER1;
}

function codigoMotivoExec(regraDecisiva) {
    return `exec.obrigatorio.${regraDecisiva}`;
}

function buildEvidencias(state) {
    const checklist = state.insumosPreparados?.kitReferencia?.checklistRA || '';
    return {
        regimeSolucao: state.insumosPreparados?.regimeSolucao ?? null,
        modoOperacao: state.planoDeResposta?.modoOperacao ?? null,
        fontePrimaria: state.planoDeResposta?.fontePrimaria ?? null,
        executorRetryCount: state.executorRetryCount ?? 0,
        factualRetryCount: state.factualRetryCount ?? 0,
        editorialRetryCount: state.editorialRetryCount ?? 0,
        checklistRAPresente: String(checklist).trim().length > 0,
        lacunasDetectadas: [...(state.insumosPreparados?.matrizAutoridade?.lacunasDetectadas || [])],
        vereditoGateAprovado: state.vereditoGate?.aprovado === true,
        factualSkipped: state.factualAuditorSkipped === true
    };
}

function decisao({ alvo, executar, regraDecisiva, regrasAvaliadas, fasePrecedencia, shadowMode = false }) {
    const codigoMotivo = executar
        ? codigoMotivoExec(regraDecisiva)
        : codigoMotivoSkip(alvo);

    return {
        policyVersion: SKIP_POLICY_VERSION,
        alvo: alvoNode(alvo),
        executar,
        codigoMotivo,
        regrasAvaliadas,
        regraDecisiva,
        fasePrecedencia,
        evidencias: null,
        shadowMode
    };
}

function evaluateSkipPolicy(state, { alvo, deps }) {
    const avaliadas = [];
    const evidencias = buildEvidencias(state);

    for (const veto of VETOS_GLOBAIS) {
        avaliadas.push(veto.id);
        if (veto.match(state, deps)) {
            const d = decisao({
                alvo,
                executar: true,
                regraDecisiva: veto.id,
                regrasAvaliadas: [...avaliadas],
                fasePrecedencia: FASE.VETO
            });
            d.evidencias = evidencias;
            return d;
        }
    }

    if (!deps.conditionalAuditEnabled) {
        const d = decisao({
            alvo,
            executar: true,
            regraDecisiva: 'flag.master_off',
            regrasAvaliadas: [...avaliadas],
            fasePrecedencia: FASE.FLAG
        });
        d.evidencias = evidencias;
        return d;
    }

    if (!isAuditorEnabled(alvo, deps)) {
        const d = decisao({
            alvo,
            executar: false,
            regraDecisiva: 'flag.auditor_off',
            regrasAvaliadas: [...avaliadas, 'V05'],
            fasePrecedencia: FASE.FLAG
        });
        d.evidencias = evidencias;
        return d;
    }

    if (alvo === 'factual' && !deps.skipFactualTier1Enabled) {
        const d = decisao({
            alvo,
            executar: true,
            regraDecisiva: 'flag.factual_tier1_off',
            regrasAvaliadas: [...avaliadas],
            fasePrecedencia: FASE.FLAG
        });
        d.evidencias = evidencias;
        return d;
    }

    const regras = alvo === 'factual' ? REGRAS_FACTUAL : REGRAS_EDITORIAL;
    for (const regra of regras) {
        avaliadas.push(regra.id);
        if (!regra.match(state, deps)) {
            const d = decisao({
                alvo,
                executar: true,
                regraDecisiva: regra.id,
                regrasAvaliadas: [...avaliadas],
                fasePrecedencia: FASE.REGRAS
            });
            d.evidencias = evidencias;
            return d;
        }
    }

    if (alvo === 'editorial' && state.factualAuditorSkipped) {
        avaliadas.push('E05');
        const d = decisao({
            alvo,
            executar: true,
            regraDecisiva: 'E05',
            regrasAvaliadas: [...avaliadas],
            fasePrecedencia: FASE.ANTI_DUPLO
        });
        d.evidencias = evidencias;
        return d;
    }

    const d = decisao({
        alvo,
        executar: false,
        regraDecisiva: codigoMotivoSkip(alvo),
        regrasAvaliadas: [...avaliadas],
        fasePrecedencia: FASE.SKIP_FINAL
    });
    d.evidencias = evidencias;
    return d;
}

function evaluateSkipFactual(state, deps) {
    return evaluateSkipPolicy(state, { alvo: 'factual', deps });
}

function evaluateSkipEditorial(state, deps) {
    return evaluateSkipPolicy(state, { alvo: 'editorial', deps });
}

module.exports = {
    FASE,
    VETOS_GLOBAIS,
    REGRAS_FACTUAL,
    REGRAS_EDITORIAL,
    evaluateSkipPolicy,
    evaluateSkipFactual,
    evaluateSkipEditorial,
    buildEvidencias
};
