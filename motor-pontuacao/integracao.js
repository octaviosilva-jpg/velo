// Integracao entre a IA (auditor) e o Motor de Pontuacao.
// - montarInstrucaoEstados: gera a instrucao para a 2a chamada (extrai o JSON de estados).
// - derivarCalibracaoHistorica: o SISTEMA (nao a IA) define o estado historico pela busca de similares.
// - montarBlocoOficial: monta o bloco de apresentacao oficial (% do Motor + composicao + validador).
// Regra: sem travessao (o servidor converte "-" com espacos em virgula).

const LABELS = {
    cobertura_fato_principal: 'Cobertura do fato principal',
    adequacao_hipotese: 'Adequacao da hipotese ao Manual',
    correlacao: 'Correlacao reclamacao x resposta x consideracao final',
    evidencia_objetiva: 'Evidencia objetiva',
    cobertura_secundaria: 'Cobertura dos fatos secundarios',
    conformidade_aenv: 'Conformidade AENV',
    qualidade_fundamentacao: 'Qualidade da fundamentacao',
    clareza: 'Clareza',
    pedidos_acessorios: 'Pedidos acessorios',
    calibracao_historica: 'Calibracao historica'
};

// Guias curtos por criterio para orientar a classificacao (nao alteram o calculo).
const GUIA = {
    cobertura_fato_principal: 'A empresa enfrentou objetivamente o NUCLEO da reclamacao? respondido_diretamente | respondido_indiretamente | respondido_parcialmente | nao_respondido. Baixa clareza NAO rebaixa para parcial.',
    adequacao_hipotese: 'Quao bem o caso se enquadra em uma hipotese normativa do Manual do RA (independente do fato ter sido respondido): muito_forte | forte | media | fraca | inadequada.',
    correlacao: 'A resposta endereca o que foi reclamado e a consideracao final nao reabre o ponto: alta | media | baixa | contraditoria (a consideracao final desmonta a resposta).',
    evidencia_objetiva: 'Quantidade/qualidade de elementos VERIFICAVEIS na resposta: documental_conclusiva (protocolos, prints, datas/contratos) | objetiva_forte (fatos concretos checaveis) | objetiva_moderada (concreta com lacunas) | declaratoria (so afirmacoes) | sem_evidencia.',
    cobertura_secundaria: 'Fatos secundarios (contexto, nao o nucleo): respondido | parcial | nao_respondido | inexistente (se nao houver fatos secundarios).',
    conformidade_aenv: 'Regras que bloqueiam moderacao (falha de atendimento, divergencia nao respondida, discussao de merito, clausula abusiva, resposta generica/evasiva): sem_riscos | riscos_leves | risco_bloqueante.',
    qualidade_fundamentacao: 'Organizacao/coerencia/objetividade da resposta: boa | media | baixa. NAO confundir com cobertura.',
    clareza: 'Facilidade de o moderador compreender a posicao da empresa: excelente | boa | media | baixa. NAO altera a cobertura.',
    pedidos_acessorios: 'Pedidos/consequencias derivados do fato principal: respondido_diretamente | respondido_indiretamente (absorvido pela solucao do fato principal) | autonomo_nao_respondido (pedido autonomo que exige resposta propria e nao foi atendido) | inexistente.'
};

const GATE_GUIA = {
    prazo: 'A reclamacao foi avaliada/respondida e esta dentro do prazo de moderacao? elegivel | nao_elegivel.',
    resposta_generica: 'A resposta e comprovadamente generica (nao explica causa, so frases institucionais, serviria para qualquer reclamacao)? nao_generica | generica_comprovada. Use generica_comprovada apenas com justificativa objetiva.'
};

/** Monta a instrucao da 2a chamada (extracao de estados), derivada do perfil (sem drift de enums). */
function montarInstrucaoEstados(perfil) {
    const linhasCriterios = Object.keys(perfil.criterios)
        .map(c => `- "${c}" (${LABELS[c]}): ${Object.keys(perfil.criterios[c].estados).join(' | ')}\n    ${GUIA[c] || ''}`)
        .join('\n');

    const linhasGates = Object.keys(perfil.gates_independentes)
        .map(g => `- "${g}": ${perfil.gates_independentes[g].estados_validos.join(' | ')}\n    ${GATE_GUIA[g] || ''}`)
        .join('\n');

    return `TAREFA: classificar o caso em ESTADOS CATEGORICOS para o Motor de Pontuacao. NAO calcule porcentagem. NAO escreva analise. Responda APENAS um objeto JSON valido.

Baseie-se exclusivamente na reclamacao, na resposta publica e na consideracao final fornecidas. Para cada campo escolha UM valor da lista permitida (exatamente como escrito, em minusculas).

CRITERIOS (campo "estados"):
${linhasCriterios}

GATES (campo "gates"):
${linhasGates}

Tambem inclua:
- "hipotese_escolhida": { "titulo": "<hipotese do Manual aplicavel ou 'nenhuma'>" }
- "deficiencias": lista de { "id": "<ID_CANONICO_EM_MAIUSCULAS>", "criterio": "<criterio>", "descricao": "<curta>" } para cada problema real (consolidar problemas equivalentes em UM id).

NAO inclua o campo calibracao_historica (o sistema define). Responda somente o JSON, sem texto antes ou depois. Formato:
{
  "estados": { ${Object.keys(perfil.criterios).map(c => `"${c}": "..."`).join(', ')} },
  "gates": { ${Object.keys(perfil.gates_independentes).map(g => `"${g}": "..."`).join(', ')} },
  "hipotese_escolhida": { "titulo": "..." },
  "deficiencias": []
}`;
}

/** O sistema define a calibracao historica pela quantidade de casos aprovados semelhantes. */
function derivarCalibracaoHistorica(qtdCasosSimilares) {
    if (!qtdCasosSimilares || qtdCasosSimilares <= 0) return 'sem_referencia';
    if (qtdCasosSimilares >= 3) return 'positiva_alta';
    return 'positiva_media';
}

/** Monta o bloco de apresentacao oficial (a ser prependido ao texto da IA). */
function montarBlocoOficial(resultado, perfilVersao) {
    const m = resultado.metadados;
    const linhasCrit = Object.entries(m.detalhe_criterios)
        .map(([c, d]) => `  . ${LABELS[c] || c}: ${d.estado} (${d.pontos} pts)`)
        .join('\n');

    const histLabel = `${LABELS.calibracao_historica}: ${m.estados_consumidos.calibracao_historica} (${m.historico_aplicado >= 0 ? '+' : ''}${m.historico_aplicado} pts)`;

    const gates = (m.gates_ativados && m.gates_ativados.length)
        ? m.gates_ativados.map(g => `${g.origem}=${g.estado} (teto: ${g.faixaMaxima})`).join('; ')
        : 'nenhum';

    const faixaTxt = String(resultado.faixa_final).replace('_', ' ');

    return [
        `📊 CHANCE DE MODERACAO (OFICIAL, Motor ${resultado_motorVersao(m)} / Perfil ${perfilVersao})`,
        `Resultado: ${resultado.chance_final}% | Faixa: ${faixaTxt}`,
        '',
        '🧮 Composicao da chance (Motor de Pontuacao):',
        linhasCrit,
        `  . ${histLabel}`,
        `  Score base: ${m.score_base} | Apos historico: ${m.score_pos_historico} | Apos gates: ${m.score_pos_gates}`,
        `  Gates ativos: ${gates}`,
        `  Validador RA: ${resultado.validador.status}. ${resultado.validador.motivo}`,
        '',
        'Observacao: a estimativa qualitativa da IA abaixo e apenas referencia (fase de validacao). O valor OFICIAL e o do Motor acima.',
        '============================================================',
        ''
    ].join('\n');
}

function resultado_motorVersao(metadados) {
    return metadados.motor_version || 'v1';
}

/**
 * Regra: quando a chance oficial >= chance_minima, suprime a resposta reformulada
 * (e o bloco de impacto associado), exibindo apenas a mensagem definida no perfil.
 * Substitui a partir do marcador de revisao ate o marcador de Auditoria de consistencia (🔍).
 * @returns { texto, aplicada }
 */
function aplicarRegraSemReformulacao(texto, chanceFinal, perfil) {
    const regra = perfil.regra_sem_reformulacao;
    if (!regra || typeof chanceFinal !== 'number' || chanceFinal < regra.chance_minima) {
        return { texto, aplicada: false };
    }

    const marcadores = [
        '✍️ Revisão estratégica da resposta',
        'Revisão estratégica da resposta',
        '✍️ Revisão de Textos (versão estratégica)',
        'Revisão de Textos (versão estratégica)',
        'REVISÃO DE TEXTOS'
    ];

    for (const marc of marcadores) {
        const idx = texto.indexOf(marc);
        if (idx === -1) continue;
        const inicioConteudo = idx + marc.length;
        // Vai ate a Auditoria de consistencia (preserva esse bloco final).
        let fim = texto.indexOf('🔍', inicioConteudo);
        if (fim === -1) fim = texto.length;
        const antes = texto.substring(0, inicioConteudo);
        const depois = texto.substring(fim);
        return { texto: `${antes}\n\n${regra.mensagem}\n\n${depois}`, aplicada: true };
    }

    // Sem marcador de revisao: anexa a mensagem ao final.
    return { texto: `${texto}\n\n${regra.mensagem}\n`, aplicada: true };
}

module.exports = { montarInstrucaoEstados, derivarCalibracaoHistorica, montarBlocoOficial, aplicarRegraSemReformulacao };
