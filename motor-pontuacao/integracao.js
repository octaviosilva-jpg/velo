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

// V2 — Criterios objetivos por estado, com requisitos obrigatorios e regras de rebaixamento.
// (Nao alteram o calculo; orientam a classificacao para aumentar a discriminancia.)
const GUIA = {
    cobertura_fato_principal:
        'Avalie SE o NUCLEO da reclamacao foi enfrentado (independente de clareza/redacao):\n' +
        '      . respondido_diretamente: o nucleo foi enfrentado de forma EXPLICITA e ESPECIFICA, sem depender de inferencia. NAO usar se qualquer parte relevante do nucleo ficou sem resposta.\n' +
        '      . respondido_indiretamente: o nucleo decorre logicamente de outra explicacao apresentada pela empresa.\n' +
        '      . respondido_parcialmente: parte relevante do nucleo permanece sem resposta.\n' +
        '      . nao_respondido: o nucleo nao foi enfrentado.\n' +
        '      REBAIXAMENTO: baixa clareza NAO rebaixa este criterio; avalie apenas o enfrentamento do fato.',
    adequacao_hipotese:
        'Enquadramento normativo no Manual do RA (independente do fato ter sido respondido):\n' +
        '      . muito_forte: SOMENTE se TODOS: responde integralmente o nucleo; enfrenta todos os argumentos centrais; apresenta evidencias objetivas; nao deixa divergencias relevantes abertas; aderencia clara ao Manual. Se QUALQUER requisito faltar, rebaixe para forte.\n' +
        '      . forte: nucleo enfrentado com pequenas deficiencias que nao comprometem. Se houver MULTIPLAS deficiencias relevantes, rebaixe para media.\n' +
        '      . media: aderencia parcial ou deficiencias relevantes.\n' +
        '      . fraca: enquadramento fragil.\n' +
        '      . inadequada: nao existe hipotese normativa valida.',
    correlacao:
        'Aderencia entre reclamacao, resposta e consideracao final:\n' +
        '      . alta: SOMENTE quando TODOS os fatos principais forem enfrentados diretamente.\n' +
        '      . media: pequena divergencia restante.\n' +
        '      . baixa: parte relevante da reclamacao permanece sem resposta.\n' +
        '      . contraditoria: a resposta conflita com a reclamacao ou com a consideracao final.',
    // Limitação: não há clamp determinístico Extrator #1×#2 em evidencia_objetiva
    // (reclassificação depende da disciplina deste GUIA + promptExtrator/Reformulador).
    evidencia_objetiva:
        'Natureza factual do elemento quanto ao fato controvertido — NÃO força da redacao:\n' +
        '      Avalie se o elemento tem RELACAO PROBATORIA/VERIFICAVEL com o fato relevante discutido.\n' +
        '      Mera presenca de data, horario, numero, linguagem categorica ou descricao detalhada NAO eleva evidencia automaticamente.\n' +
        '      O elemento so contribui quando INDIVIDUALIZA ou permite VERIFICAR concretamente o fato (ex.: identificador/documento/registro concretamente relacionado a operacao e PRESENTE nos inputs).\n' +
        '      Reorganizacao ou maior precisao textual da MESMA declaracao NAO constitui nova evidencia.\n' +
        '      NAO criar regra mecanica so por presenca/ausencia de datas, numeros, protocolos ou documentos.\n' +
        '      Ex.: "pagamento em 31/07/2026" — a data sozinha NAO transforma declaracao empresarial em comprovacao.\n' +
        '      . documental_conclusiva: SOMENTE com documento(s) verificavel(is) anexado(s)/citado(s) de forma conclusiva e pertinente ao fato.\n' +
        '      . objetiva_forte: SOMENTE com PELO MENOS DOIS elementos objetivos com relacao probatoria/verificavel ao fato.\n' +
        '      . objetiva_moderada: apenas UM elemento objetivo com relacao probatoria/verificavel ao fato.\n' +
        '      . declaratoria: apenas afirmacoes da empresa, sem elemento com relacao probatoria/verificavel.\n' +
        '      . sem_evidencia: nenhum elemento verificavel pertinente.',
    cobertura_secundaria:
        'Fatos secundarios (contexto, nao o nucleo):\n' +
        '      . respondido: fatos secundarios enfrentados.\n' +
        '      . parcial: enfrentados de forma incompleta.\n' +
        '      . nao_respondido: ignorados.\n' +
        '      . inexistente: nao ha fatos secundarios.',
    conformidade_aenv:
        'Regras que bloqueiam moderacao (falha de atendimento, divergencia nao respondida, discussao de merito, clausula abusiva, resposta generica/evasiva):\n' +
        '      . sem_riscos: nenhuma regra presente.\n' +
        '      . riscos_leves: indicios leves.\n' +
        '      . risco_bloqueante: alguma regra claramente presente.\n' +
        '      REBAIXAMENTO: se houver duvida entre sem_riscos e riscos_leves, use riscos_leves.',
    qualidade_fundamentacao:
        'Organizacao, coerencia e objetividade da resposta (NAO confundir com cobertura nem com clareza):\n' +
        '      . boa: organizada, coerente e objetiva.\n' +
        '      . media: deficiencias de organizacao/coerencia.\n' +
        '      . baixa: desorganizada ou incoerente.',
    clareza:
        'Facilidade de o moderador compreender a POSICAO da empresa (NAO altera cobertura):\n' +
        '      . excelente: SOMENTE quando TODOS: compreendida em uma unica leitura; sem ambiguidades relevantes; sem necessidade de inferencia; sequencia logica clara. Se QUALQUER requisito faltar, NAO use excelente.\n' +
        '      . boa: compreensivel, com pequenas ambiguidades que nao comprometem.\n' +
        '      . media: exige releitura; ambiguidades relevantes; dificulta parcialmente.\n' +
        '      . baixa: impede ou dificulta significativamente a compreensao.',
    pedidos_acessorios:
        'Pedidos/consequencias derivados do fato principal:\n' +
        '      . respondido_diretamente: pedido acessorio tratado explicitamente.\n' +
        '      . respondido_indiretamente: abrangido pela solucao do fato principal. NAO use se existir pedido AUTONOMO sem resposta.\n' +
        '      . autonomo_nao_respondido: pedido autonomo que exige resposta propria e nao foi atendido.\n' +
        '      . inexistente: nao ha pedidos acessorios.'
};

const GATE_GUIA = {
    prazo: 'A reclamacao foi avaliada/respondida e esta dentro do prazo de moderacao? elegivel | nao_elegivel.',
    resposta_generica: 'A resposta e comprovadamente generica (nao explica causa, so frases institucionais, serviria para qualquer reclamacao)? nao_generica | generica_comprovada. Use generica_comprovada apenas com justificativa objetiva (cite o trecho generico).'
};

/** Monta a instrucao da 2a chamada (extracao de estados V2), derivada do perfil (sem drift de enums). */
function montarInstrucaoEstados(perfil) {
    const linhasCriterios = Object.keys(perfil.criterios)
        .map(c => `- "${c}" (${LABELS[c]}): ${Object.keys(perfil.criterios[c].estados).join(' | ')}\n      ${GUIA[c] || ''}`)
        .join('\n');

    const linhasGates = Object.keys(perfil.gates_independentes)
        .map(g => `- "${g}": ${perfil.gates_independentes[g].estados_validos.join(' | ')}\n      ${GATE_GUIA[g] || ''}`)
        .join('\n');

    const objetoEstado = '{ "estado": "<valor da lista>", "fundamento": "<justificativa curta>", "trechos_utilizados": { "reclamacao": ["<trecho curto>"], "resposta": ["<trecho curto>"] } }';

    const formatoEstados = Object.keys(perfil.criterios).map(c => `"${c}": ${objetoEstado}`).join(',\n    ');
    const formatoGates = Object.keys(perfil.gates_independentes).map(g => `"${g}": ${objetoEstado}`).join(',\n    ');

    return `TAREFA: classificar o caso em ESTADOS CATEGORICOS para o Motor de Pontuacao. NAO calcule porcentagem. NAO escreva analise. Responda APENAS um objeto JSON valido.

REGRA DE REQUISITOS (OBRIGATORIA): um estado alto so pode ser usado quando TODOS os criterios obrigatorios daquele estado estiverem CLARAMENTE presentes. Se qualquer requisito obrigatorio nao for atendido, rebaixe para o nivel imediatamente inferior. NAO rebaixe por precaucao quando os requisitos estiverem satisfeitos (evite subestimacao artificial).

AVALIACAO INDEPENDENTE (OBRIGATORIA): avalie cada criterio isoladamente. Cobertura != Clareza; Clareza != Fundamentacao; Fundamentacao != Evidencia; Correlacao != Cobertura. Um problema de redacao (clareza/fundamentacao) NUNCA rebaixa Cobertura ou Evidencia.

REBAIXAMENTO GLOBAL: se existir fato principal sem resposta, divergencia relevante aberta, ou faltar evidencia objetiva importante, rebaixe o estado do criterio afetado para o nivel imediatamente inferior.

ETAPA 0 — MAPEAMENTO DA RECLAMACAO (faca ANTES de classificar; parta SEMPRE da reclamacao, NUNCA da resposta):
1) identifique o fato principal (o nucleo do problema);
2) identifique os fatos secundarios (contexto);
3) identifique os pedidos acessorios (consequencias/pedidos derivados);
4) SOMENTE depois avalie se a resposta publica os enfrenta.
Retorne esse mapeamento no campo "mapa_reclamacao".

Baseie-se exclusivamente na reclamacao, na resposta publica e na consideracao final fornecidas. Para cada campo escolha UM valor da lista permitida (exatamente como escrito, em minusculas).

CRITERIOS (campo "estados"):
${linhasCriterios}

GATES (campo "gates"):
${linhasGates}

Para CADA criterio e CADA gate, retorne um objeto no formato:
${objetoEstado}
Os campos "fundamento" e "trechos_utilizados" servem para auditoria (o Motor usa apenas "estado"). Em "trechos_utilizados" cite trechos CURTOS e literais.

Tambem inclua:
- "hipotese_escolhida": { "titulo": "<hipotese do Manual aplicavel ou 'nenhuma'>" }
- "deficiencias": lista de { "id": "<ID_CANONICO_EM_MAIUSCULAS>", "criterio": "<criterio>", "descricao": "<curta>" } para cada problema real (consolidar problemas equivalentes em UM id).

NAO inclua o campo calibracao_historica (o sistema define). Responda SOMENTE o JSON, sem texto antes ou depois. Formato:
{
  "mapa_reclamacao": { "fato_principal": "...", "fatos_secundarios": [], "pedidos_acessorios": [] },
  "estados": {
    ${formatoEstados}
  },
  "gates": {
    ${formatoGates}
  },
  "hipotese_escolhida": { "titulo": "..." },
  "deficiencias": []
}`;
}

/**
 * Normaliza a saida do Extrator (V2 aninhado {estado,fundamento,trechos_utilizados}
 * ou V1 string pura) para o formato PLANO consumido pelo Motor (estados/gates como string).
 * Coleta fundamentos, trechos e o mapa da reclamacao para os metadados (auditoria).
 * O Motor, o Contrato e o Perfil permanecem inalterados.
 */
function normalizarEstados(auditoria) {
    const extrairEstado = (v) => (v && typeof v === 'object') ? v.estado : v;

    const estadosBrutos = (auditoria && auditoria.estados) || {};
    const gatesBrutos = (auditoria && auditoria.gates) || {};

    const estados = {};
    const gates = {};
    const fundamentos = {};

    for (const [criterio, valor] of Object.entries(estadosBrutos)) {
        estados[criterio] = extrairEstado(valor);
        if (valor && typeof valor === 'object') {
            fundamentos[criterio] = {
                fundamento: valor.fundamento || null,
                trechos_utilizados: valor.trechos_utilizados || null
            };
        }
    }
    for (const [gate, valor] of Object.entries(gatesBrutos)) {
        gates[gate] = extrairEstado(valor);
        if (valor && typeof valor === 'object') {
            fundamentos[gate] = {
                fundamento: valor.fundamento || null,
                trechos_utilizados: valor.trechos_utilizados || null
            };
        }
    }

    return {
        auditoriaPlana: {
            estados,
            gates,
            hipotese_escolhida: auditoria ? auditoria.hipotese_escolhida : undefined,
            deficiencias: auditoria ? auditoria.deficiencias : undefined
        },
        fundamentos,
        mapa_reclamacao: (auditoria && auditoria.mapa_reclamacao) || null
    };
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
        '============================================================',
        ''
    ].join('\n');
}

/** Serializa payload completo do Motor para a Auditora Técnica (Fase 6). */
function serializarMotorParaAuditor(resultadoMotor, perfil, extras = {}) {
    const m = resultadoMotor.metadados || {};
    const criterios = Object.entries(m.detalhe_criterios || {}).map(([id, d]) => ({
        id,
        label: LABELS[id] || id,
        estado: d.estado,
        pontos: d.pontos,
        peso: d.peso ?? perfil?.criterios?.[id]?.peso,
        fator: d.fator
    }));

    return {
        chance_final: resultadoMotor.chance_final,
        faixa_final: resultadoMotor.faixa_final,
        validador: resultadoMotor.validador,
        criterios,
        score_base: m.score_base,
        score_pos_historico: m.score_pos_historico,
        score_pos_gates: m.score_pos_gates,
        gates_ativados: m.gates_ativados,
        historico_aplicado: m.historico_aplicado,
        estados_consumidos: m.estados_consumidos,
        motor_version: m.motor_version,
        perfil_calibracao_version: m.perfil_calibracao_version,
        fundamentos: extras.fundamentos || null,
        mapa_reclamacao: extras.mapa_reclamacao || null
    };
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

module.exports = {
    LABELS,
    montarInstrucaoEstados,
    derivarCalibracaoHistorica,
    montarBlocoOficial,
    aplicarRegraSemReformulacao,
    normalizarEstados,
    serializarMotorParaAuditor
};
