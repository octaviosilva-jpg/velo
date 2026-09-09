'use strict';

/**
 * Checagem DETERMINISTICA adicional (codigo, sem LLM) de elegibilidade da hipotese escolhida —
 * complementa validationGate.js (que nao e tocado) verificando pre-condicoes que o proprio
 * manual declara para hipoteses especificas, mas que a DECISAO (LLM) pode ignorar mesmo tendo
 * o criterio disponivel no recorte do manual.
 *
 * Motivacao (calibracao 2026-09-09, reclamacao 256475367): a DECISAO selecionou a hipotese
 * "reclamacao-outra-empresa" para um caso que JA TINHA resposta publica da empresa preenchida
 * (Resposta Empresa nao vazia) — mas essa hipotese, no manual, so vale "se NAO houver resposta
 * publica registrada" (ver manuais-reclame-aqui/manuais-moderacao.json, id
 * "reclamacao-outra-empresa"). Uma hipotese assim so passaria pelo validationGate hoje porque
 * ele checa cobertura/citacao do manual, nao pre-condicoes binarias declaradas por hipotese
 * especifica.
 *
 * Lista deliberadamente pequena e explicita (nao tenta parsear texto livre de "criterios[]"
 * generico, o que seria fragil) — cobre so o caso observado; adicionar outras hipoteses aqui
 * conforme surgirem casos reais parecidos.
 */

const HIPOTESES_EXIGEM_AUSENCIA_DE_RESPOSTA_PUBLICA = new Set(['reclamacao-outra-empresa']);

function verificarElegibilidadeHipotese(state) {
    const hip = state && state.hipoteseSelecionada;
    if (!hip) return { ok: true };

    const id = (hip.id || '').toString().trim().toLowerCase();
    if (!HIPOTESES_EXIGEM_AUSENCIA_DE_RESPOSTA_PUBLICA.has(id)) return { ok: true };

    const temRespostaPublica = !!(state.entradasCruas && (state.entradasCruas.resposta || '').toString().trim());
    if (temRespostaPublica) {
        return {
            ok: false,
            motivo: `hipotese "${hip.titulo || id}" exige ausencia de resposta publica da empresa (ver manual), mas ha Resposta Empresa preenchida neste caso — selecao provavelmente indevida`
        };
    }
    return { ok: true };
}

module.exports = { verificarElegibilidadeHipotese, HIPOTESES_EXIGEM_AUSENCIA_DE_RESPOSTA_PUBLICA };
