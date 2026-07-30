'use strict';

const {
    SCHEMA_VERSION,
    REGIME_SOLUCAO,
    DEFAULTS
} = require('./constants');

const curadoria = require('./shared/curadoriaCoerentes');

/**
 * Pre-processamento deterministico — Fase 0/1.
 * Curadoria via shared/curadoriaCoerentes (fonte unica com monolito).
 */

const {
    calcularSimilaridadeSolicitacao,
    ordenarModelosPorSimilaridade,
    avaliarDisponibilidadeSolucao,
    selecionarCoerentesCurados
} = curadoria;

function inferirRotaExecucao(regimeSolucao) {
    if (regimeSolucao === REGIME_SOLUCAO.COMPLETA) return 'padrao_completa';
    if (regimeSolucao === REGIME_SOLUCAO.PARCIAL) return 'complementar_coerentes';
    return 'construir_de_coerentes';
}

function extrairFatosAutorizadosMecanicos(dadosFormulario) {
    const fatos = [];
    const sol = String(dadosFormulario?.solucao_implementada || '').trim();
    const hist = String(dadosFormulario?.historico_atendimento || '').trim();
    const obs = String(dadosFormulario?.observacoes_internas || '').trim();

    if (sol) fatos.push({ origem: 'solucao_implementada', texto: sol });
    if (hist && hist.toLowerCase() !== 'nenhum') fatos.push({ origem: 'historico_atendimento', texto: hist });
    if (obs && obs.toLowerCase() !== 'nenhuma') fatos.push({ origem: 'observacoes_internas', texto: obs });

    return fatos;
}

function montarMatrizAutoridade(dadosFormulario, regimeSolucao) {
    const sol = String(dadosFormulario?.solucao_implementada || '').trim();
    const fatos = extrairFatosAutorizadosMecanicos(dadosFormulario);

    const proibicoes = [
        'inventar_fatos_nao_informados',
        'copiar_dados_pessoais_outro_caso',
        'empurrar_cliente_para_sac_suporte',
        'citar_normas_ausentes_do_caso'
    ];

    const lacunas = [];
    if (regimeSolucao === REGIME_SOLUCAO.VAZIA) {
        lacunas.push('solucao_implementada_ausente');
    } else if (regimeSolucao === REGIME_SOLUCAO.PARCIAL) {
        lacunas.push('solucao_implementada_incompleta');
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        fontePrimariaEsperada: regimeSolucao === REGIME_SOLUCAO.VAZIA ? 'padrao_coerente' : 'solucao_implementada',
        fatosAutorizados: fatos,
        proibicoes,
        lacunasDetectadas: lacunas,
        solucaoImplementadaPresente: sol.length > 0
    };
}

function coerenteId(modelo, index) {
    return modelo.id || modelo['ID'] || modelo['Id'] || `coerente_${index + 1}`;
}

function montarKitReferencia(dadosPlanilha, dadosFormulario, conhecimentoProdutos, deps) {
    const modelosComResposta = dadosPlanilha?.modelosCoerentes?.filter(modelo => {
        const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
        return resposta && resposta.trim().length > 0;
    }) || [];

    const curadoriaResult = selecionarCoerentesCurados(modelosComResposta, dadosFormulario);

    const coerentes = curadoriaResult.selecionados.map((item, index) => {
        const modelo = item.modelo;
        return {
            id: coerenteId(modelo, index),
            similaridadePct: Math.round(item.similaridade * 100),
            simTexto: item.simTexto,
            simMotivo: item.simMotivo,
            tipo: modelo['Tipo Solicitação'] || modelo.dadosFormulario?.tipo_solicitacao || 'N/A',
            motivo: modelo['Motivo Solicitação'] || modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao || 'N/A',
            textoCliente: modelo['Texto Cliente'] || modelo.dadosFormulario?.texto_cliente || '',
            respostaAprovada: modelo['Resposta Aprovada'] || modelo.respostaAprovada || '',
            solucaoReferencia: modelo['Solução Implementada'] || modelo.dadosFormulario?.solucao_implementada || ''
        };
    });

    const feedbacks = (dadosPlanilha?.feedbacksRelevantes || [])
        .slice(0, DEFAULTS.feedbacksMax)
        .map((fb, i) => ({
            id: `feedback_${i + 1}`,
            erro: fb.feedback || fb.Feedback || '',
            respostaAnterior: fb.respostaAnterior || fb['Resposta Anterior'] || '',
            respostaReformulada: fb.respostaReformulada || fb['Resposta Reformulada'] || ''
        }));

    let checklistRA = '';
    if (typeof deps.montarChecklistConformidadeRA === 'function') {
        checklistRA = deps.montarChecklistConformidadeRA(
            dadosFormulario?.texto_cliente,
            dadosFormulario?.motivo_solicitacao || dadosFormulario?.tipo_solicitacao
        ) || '';
    }

    return {
        coerentes,
        curadoria: {
            totalDisponiveis: curadoriaResult.totalDisponiveis,
            mantidos: coerentes.length,
            descartadosPorDivergencia: curadoriaResult.descartadosPorDivergencia,
            baixaAderencia: curadoriaResult.baixaAderencia,
            simTopoPct: Math.round(curadoriaResult.simTopo * 100)
        },
        feedbacks,
        conhecimentoProduto: conhecimentoProdutos || '',
        checklistRA,
        temAprendizado: coerentes.length > 0 || feedbacks.length > 0,
        fonteAprendizado: dadosPlanilha?.fonte || 'indisponivel'
    };
}

function normalizarCaso(dadosFormulario) {
    return {
        tipo_solicitacao: dadosFormulario?.tipo_solicitacao || '',
        motivo_solicitacao: dadosFormulario?.motivo_solicitacao || dadosFormulario?.motivoSolicitacao || '',
        id_reclamacao: dadosFormulario?.id_reclamacao || '',
        solucao_implementada: dadosFormulario?.solucao_implementada || '',
        texto_cliente: dadosFormulario?.texto_cliente || '',
        historico_atendimento: dadosFormulario?.historico_atendimento || '',
        nome_solicitante: dadosFormulario?.nome_solicitante || '',
        observacoes_internas: dadosFormulario?.observacoes_internas || ''
    };
}

/**
 * @param {object} dadosFormulario
 * @param {object|null} dadosPlanilha
 * @param {string} conhecimentoProdutos
 * @param {object} deps — montarChecklistConformidadeRA (opcional)
 * @returns {import('./contracts').InsumosPreparados}
 */
function buildInsumosPreparados(dadosFormulario, dadosPlanilha, conhecimentoProdutos, deps = {}) {
    const casoNormalizado = normalizarCaso(dadosFormulario);
    const regimeSolucao = avaliarDisponibilidadeSolucao(casoNormalizado.solucao_implementada);
    const rotaExecucao = inferirRotaExecucao(regimeSolucao);
    const kitReferencia = montarKitReferencia(dadosPlanilha, dadosFormulario, conhecimentoProdutos, deps);
    const matrizAutoridade = montarMatrizAutoridade(dadosFormulario, regimeSolucao);

    return {
        schemaVersion: SCHEMA_VERSION,
        casoNormalizado,
        regimeSolucao,
        rotaExecucao,
        kitReferencia,
        matrizAutoridade
    };
}

module.exports = {
    buildInsumosPreparados,
    avaliarDisponibilidadeSolucao,
    ordenarModelosPorSimilaridade,
    calcularSimilaridadeSolicitacao,
    selecionarCoerentesCurados,
    montarMatrizAutoridade,
    inferirRotaExecucao
};
