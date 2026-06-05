/**
 * Utilitários para o Gerador de Relatório de Reclamações (Reclame Aqui)
 */

const ERRO_LINHAS_DIFERENTES =
    'As colunas Horários, Produtos e Motivos devem possuir a mesma quantidade de registros.';

/** Relatório executivo: apenas os 3 maiores temas por volume no dia. */
const TOP_MOTIVOS_EXECUTIVO = 3;

const SEPARADOR_CAMPO = ' - ';

/** Horário de Brasília para saudação (Bom dia 5h–11h59, Boa tarde 12h–17h59, Boa noite 18h–4h59). */
function obterHoraBrasilia(data = new Date()) {
    const parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: 'numeric',
        hour12: false
    }).formatToParts(data);
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) : data.getHours();
}

/** Datas de referência em America/Sao_Paulo (hoje e ontem no calendário local). */
function obterReferenciasDatasBrasilia(dataRef = new Date()) {
    const hojeISO = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(dataRef);

    const [y, m, d] = hojeISO.split('-').map((n) => parseInt(n, 10));
    const ontemUtc = new Date(Date.UTC(y, m - 1, d - 1));
    const ontemISO = `${ontemUtc.getUTCFullYear()}-${String(ontemUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(ontemUtc.getUTCDate()).padStart(2, '0')}`;

    return {
        dataReferenciaGeracao: hojeISO,
        dataReferenciaOntem: ontemISO
    };
}

function formatarDataCurtaFromISO(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano.slice(-2)}`;
}

function agruparPorMotivo(lista, limite = TOP_MOTIVOS_EXECUTIVO) {
    const total = lista.length;
    const porMotivoMap = new Map();
    for (const r of lista) {
        porMotivoMap.set(r.motivo, (porMotivoMap.get(r.motivo) || 0) + 1);
    }
    const ordenado = Array.from(porMotivoMap.entries())
        .map(([motivo, quantidade]) => ({
            motivo,
            quantidade,
            percentual: total > 0 ? Math.round((quantidade / total) * 100) : 0
        }))
        .sort(
            (a, b) =>
                b.percentual - a.percentual ||
                b.quantidade - a.quantidade ||
                a.motivo.localeCompare(b.motivo, 'pt-BR')
        );
    const top = limite > 0 ? ordenado.slice(0, limite) : ordenado;
    return top.map((item) => ({
        ...item,
        linhaFormatada: `${item.percentual}%${SEPARADOR_CAMPO}${item.motivo} (${item.quantidade})`
    }));
}

function mapearReclamacaoResumo(r) {
    return {
        horario: r.horario,
        produto: r.produto,
        motivo: r.motivo,
        dataChave: r.dataChave,
        foraExpediente: r.foraExpediente,
        dataHoraCurta: r.dataHoraCurta,
        dataHoraDetalhe: r.dataHoraDetalhe,
        dataHoraLinha: r.dataHoraLinha,
        linhaComProduto: r.linhaComProduto
    };
}

function formatarDataHoraLinha(data) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = String(data.getFullYear());
    const h = String(data.getHours()).padStart(2, '0');
    const m = String(data.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano}, ${h}:${m}`;
}

function formatarLinhaReclamacaoComProduto(r) {
    const dataHora = r.dataHoraLinha || formatarDataHoraLinha(r.dataObj);
    return `${dataHora}${SEPARADOR_CAMPO}${r.produto}${SEPARADOR_CAMPO}${r.motivo}`;
}

function montarDetalhamentoCronologico(lista) {
    return lista.map((r) => ({
        dataHoraLinha: r.dataHoraLinha,
        motivo: r.motivo,
        produto: r.produto,
        foraExpediente: r.foraExpediente,
        dataChave: r.dataChave,
        linhaDetalhe: r.linhaComProduto || formatarLinhaReclamacaoComProduto(r)
    }));
}

function montarBlocoPeriodo(lista) {
    const foraLista = lista.filter((r) => r.foraExpediente);
    return {
        totalReclamacoes: lista.length,
        quantidadeForaExpediente: foraLista.length,
        agrupamentoPorMotivo: agruparPorMotivo(lista),
        foraExpediente: foraLista.map((r) => ({
            dataHoraLinha: r.dataHoraLinha,
            motivo: r.motivo,
            produto: r.produto,
            linhaFormatada: r.linhaComProduto || formatarLinhaReclamacaoComProduto(r)
        })),
        detalhamentoCronologico: montarDetalhamentoCronologico(lista)
    };
}

function obterSaudacaoRelatorio(data = new Date()) {
    const hora = obterHoraBrasilia(data);
    let periodo;
    if (hora >= 5 && hora < 12) {
        periodo = 'Bom dia';
    } else if (hora >= 12 && hora < 18) {
        periodo = 'Boa tarde';
    } else {
        periodo = 'Boa noite';
    }
    const saudacaoAbertura = `${periodo}, pessoal!`;
    let despedida;
    if (periodo === 'Bom dia') {
        despedida = 'Bom dia a todos!\nÓtimo trabalho!';
    } else if (periodo === 'Boa tarde') {
        despedida = 'Boa tarde!';
    } else {
        despedida = 'Boa noite a todos!\nBom descanso!';
    }
    return { periodo, horaBrasilia: hora, saudacaoAbertura, despedida };
}

const PROMPT_SISTEMA_GERACAO = `Você é responsável por gerar relatórios operacionais de reclamações do Reclame Aqui.

Objetivo:
Transformar dados estruturados em um relatório executivo claro, organizado e profissional.

Regras obrigatórias:
- Escrever em português brasileiro.
- Utilizar linguagem corporativa.
- Manter tom leve e objetivo.
- Não inventar dados.
- Utilizar apenas informações recebidas.
- Utilizar os percentuais e totais já calculados nos dados fornecidos (não recalcule).
- A data de geração do relatório é dataReferenciaGeracao (fuso Brasília). Classifique cada reclamação pela data do horário informado.
- Na frase "Ontem recebemos X reclamações", use EXATAMENTE ontem.totalReclamacoes e ontem.quantidadeForaExpediente (somente reclamações de ontem.data).
- Se ontem.totalReclamacoes for 0, informe naturalmente que ontem não houve reclamações (sem inventar números).
- Na frase "Hoje, até o momento, recebemos N reclamações", use EXATAMENTE hoje.totalReclamacoes (somente reclamações de hoje.data / dataReferenciaGeracao).
- Os percentuais após "distribuídas da seguinte forma" devem listar APENAS os itens de hoje.agrupamentoPorMotivo (no máximo 3, já são os maiores temas do dia). Não liste outros motivos nem recalcule.
- O percentual (XX%) e a quantidade entre parênteses de cada linha devem refletir APENAS reclamações de hoje (campo quantidade / hoje.totalReclamacoes). A soma das quantidades do top 3 deve bater com o total de hoje.
- NÃO inclua seção "Detalhamento" nem liste reclamações uma a uma no relatório executivo. O detalhamento cronológico é gerado separadamente pelo sistema.
- A lista 🌙 Fora do expediente após o trecho de ontem deve usar APENAS ontem.foraExpediente (reclamações de ontem fora do expediente).
- Se hoje.totalReclamacoes for 0, informe naturalmente que ainda não há reclamações hoje (percentuais de hoje não se aplicam).
- Relatório EXECUTIVO: seja breve, só informações principais, sem excesso de texto.
- Incorporar observações operacionais de forma natural e concisa (não copie literalmente; integre ao texto).
- Não repetir informações desnecessariamente.
- Quando houver poucas reclamações, utilizar um texto mais enxuto.
- Quando não houver reclamações no dia atual, informar isso naturalmente.
- Quando existirem reclamações fora do expediente de ontem, criar a seção 🌙 (somente ontem).
- Utilizar emojis apenas para melhorar a leitura.
- Não exagerar no uso de emojis.
- Separador entre campos: hífen com espaços " - " (NUNCA vírgula entre produto e motivo).
- Na distribuição por motivo (máx. 3 linhas), use linhaFormatada quando existir ou: "XX% - Nome do motivo (quantidade)".
- Em "Fora do expediente", use linhaFormatada de ontem.foraExpediente (copie exatamente) no formato "DD/MM/AAAA, HH:MM - Produto - Motivo".
- A primeira linha do relatório DEVE ser exatamente o valor de saudacaoAbertura nos dados JSON (horário de geração em Brasília: Bom dia, Boa tarde ou Boa noite).
- A despedida final DEVE ser exatamente o valor de despedida nos dados JSON (pode ter uma ou duas linhas). Bom dia: "Bom dia a todos!" + "Ótimo trabalho!"; Boa tarde: só "Boa tarde!"; após 18h (Boa noite): "Boa noite a todos!" + "Bom descanso!".

Padrão de referência (estrutura e tom, não copie números se os dados forem outros):
{Bom dia|Boa tarde|Boa noite}, pessoal!
Ontem recebemos X reclamações, sendo Y fora do horário de expediente.
🌙 Fora do expediente:
04/06/2026, 21:30 - Antecipação 2026 - Juros abusivos
04/06/2026, 22:51 - Empréstimo Pessoal - Liberação chave Pix
📌 Hoje, até o momento, recebemos N reclamações, distribuídas da seguinte forma:
60% - Vencimento antecipado da CCB (3)
20% - Suspeita de fraude (1)
20% - Portabilidade Pix (1)
📌 Observações: (incorporadas naturalmente, de forma breve)
Bom dia a todos!
Ótimo trabalho!

Retorne APENAS o texto do relatório, pronto para copiar e enviar (sem markdown code blocks, sem explicações meta).`;

const PROMPT_SISTEMA_CORRECAO = `Você deve EDITAR um relatório operacional de reclamações do Reclame Aqui.

REGRAS OBRIGATÓRIAS:
- NÃO gere um novo relatório do zero.
- NÃO recalcule dados, totais ou percentuais.
- NÃO reconstrua toda a resposta.
- Utilize como base o relatório atual fornecido.
- Aplique APENAS os ajustes descritos nas instruções de correção.
- Todo o restante do texto deve permanecer intacto, salvo o que for necessário para o ajuste pedido.
- Mantenha português brasileiro, tom corporativo e leve.
- Mantenha a regra de uma reclamação por linha em listas (nunca várias na mesma linha).
- O relatório executivo NÃO deve conter seção "Detalhamento".
- Use hífen " - " entre produto e motivo. Fora do expediente: "DD/MM/AAAA, HH:MM - Produto - Motivo". Percentuais: no máximo 3 maiores temas, formato "XX% - motivo (qtd)".
- Retorne o relatório completo atualizado (texto integral), pronto para envio.
- Sem markdown code blocks, sem explicações meta.`;

function parseLinhas(texto) {
    if (!texto || typeof texto !== 'string') return [];
    return texto
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
}

function parseHorario(str) {
    const trimmed = String(str || '').trim();
    let match = trimmed.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
    );
    if (!match) {
        match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
        if (match) match.push('00');
    }
    if (!match) {
        return { valido: false, original: trimmed, erro: `Formato inválido: "${trimmed}" (use DD/MM/AAAA HH:MM:SS)` };
    }
    const [, dia, mes, ano, hora, minuto, segundo] = match;
    const data = new Date(
        parseInt(ano, 10),
        parseInt(mes, 10) - 1,
        parseInt(dia, 10),
        parseInt(hora, 10),
        parseInt(minuto, 10),
        parseInt(segundo, 10)
    );
    if (Number.isNaN(data.getTime())) {
        return { valido: false, original: trimmed, erro: `Data inválida: "${trimmed}"` };
    }
    const dataChave = `${ano}-${mes}-${dia}`;
    return { valido: true, original: trimmed, data, dataChave };
}

function isForaExpediente(data) {
    const minutos = data.getHours() * 60 + data.getMinutes();
    const inicio = 8 * 60;
    const fim = 19 * 60;
    return minutos < inicio || minutos > fim;
}

function formatarDataCurta(data) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = String(data.getFullYear()).slice(-2);
    return `${dia}/${mes}/${ano}`;
}

function formatarHora(data) {
    const h = String(data.getHours()).padStart(2, '0');
    const m = String(data.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function formatarDataHoraCurta(data) {
    return `${formatarDataCurta(data)}${SEPARADOR_CAMPO}${formatarHora(data)}`;
}

function formatarDataHoraDetalhe(data) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = String(data.getFullYear()).slice(-2);
    const h = String(data.getHours()).padStart(2, '0');
    const m = String(data.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} às ${h}:${m}`;
}

function validarEProcessar({ horarios, produtos, motivos }) {
    const linhasHorarios = parseLinhas(horarios);
    const linhasProdutos = parseLinhas(produtos);
    const linhasMotivos = parseLinhas(motivos);

    if (
        linhasHorarios.length !== linhasProdutos.length ||
        linhasHorarios.length !== linhasMotivos.length
    ) {
        return {
            success: false,
            error: ERRO_LINHAS_DIFERENTES,
            contagens: {
                horarios: linhasHorarios.length,
                produtos: linhasProdutos.length,
                motivos: linhasMotivos.length
            }
        };
    }

    if (linhasHorarios.length === 0) {
        return {
            success: false,
            error: 'Informe ao menos um registro nas colunas Horários, Produtos e Motivos.'
        };
    }

    const reclamacoes = [];
    const errosHorario = [];

    for (let i = 0; i < linhasHorarios.length; i++) {
        const parsed = parseHorario(linhasHorarios[i]);
        if (!parsed.valido) {
            errosHorario.push(`Linha ${i + 1}: ${parsed.erro}`);
            continue;
        }
        const foraExpediente = isForaExpediente(parsed.data);
        const dataHoraLinha = formatarDataHoraLinha(parsed.data);
        const registro = {
            horario: linhasHorarios[i],
            produto: linhasProdutos[i],
            motivo: linhasMotivos[i],
            timestamp: parsed.data.getTime(),
            dataObj: parsed.data,
            dataChave: parsed.dataChave,
            foraExpediente,
            dataCurta: formatarDataCurta(parsed.data),
            horaCurta: formatarHora(parsed.data),
            dataHoraCurta: formatarDataHoraCurta(parsed.data),
            dataHoraDetalhe: formatarDataHoraDetalhe(parsed.data),
            dataHoraLinha
        };
        registro.linhaComProduto = formatarLinhaReclamacaoComProduto(registro);
        reclamacoes.push(registro);
    }

    if (errosHorario.length > 0) {
        return {
            success: false,
            error: 'Corrija os horários inválidos antes de gerar o relatório.',
            detalhes: errosHorario
        };
    }

    reclamacoes.sort((a, b) => a.timestamp - b.timestamp);

    const total = reclamacoes.length;
    const { saudacaoAbertura, despedida, periodo, horaBrasilia } = obterSaudacaoRelatorio();
    const { dataReferenciaGeracao, dataReferenciaOntem } = obterReferenciasDatasBrasilia();

    const ontemLista = reclamacoes.filter((r) => r.dataChave === dataReferenciaOntem);
    const hojeLista = reclamacoes.filter((r) => r.dataChave === dataReferenciaGeracao);
    const outrasLista = reclamacoes.filter(
        (r) => r.dataChave !== dataReferenciaGeracao && r.dataChave !== dataReferenciaOntem
    );

    const ontem = {
        data: dataReferenciaOntem,
        dataLabel: formatarDataCurtaFromISO(dataReferenciaOntem),
        ...montarBlocoPeriodo(ontemLista)
    };

    const detalhamentoCronologico = montarDetalhamentoCronologico(reclamacoes);
    const hoje = {
        data: dataReferenciaGeracao,
        dataLabel: formatarDataCurtaFromISO(dataReferenciaGeracao),
        ...montarBlocoPeriodo(hojeLista),
        totalReclamacoesDetalhamento: reclamacoes.length,
        detalhamentoCronologico
    };

    const datasOutros = [...new Set(outrasLista.map((r) => r.dataChave))].sort();

    const dadosParaIA = {
        totalReclamacoes: total,
        dataReferenciaGeracao,
        dataReferenciaOntem,
        saudacaoAbertura,
        despedida,
        periodoSaudacao: periodo,
        horaGeracaoBrasilia: horaBrasilia,
        ontem,
        hoje,
        outrosDias: {
            totalReclamacoes: outrasLista.length,
            datas: datasOutros.map((iso) => ({
                data: iso,
                dataLabel: formatarDataCurtaFromISO(iso),
                quantidade: outrasLista.filter((r) => r.dataChave === iso).length
            })),
            reclamacoes: outrasLista.map(mapearReclamacaoResumo)
        },
        reclamacoes: reclamacoes.map(mapearReclamacaoResumo),
        detalhamentoCronologico,
        totalReclamacoesDetalhamento: reclamacoes.length
    };

    return {
        success: true,
        dados: dadosParaIA,
        reclamacoes
    };
}

/** Corrige vírgulas indevidas entre horário/percentual e motivo; padroniza hífen. */
function normalizarFormatacaoRelatorio(texto) {
    let t = String(texto || '');
    t = t.replace(/(\d{2}\/\d{2}\/\d{2,4})\s*[–—]\s*/g, `$1${SEPARADOR_CAMPO}`);
    t = t.replace(/(\d{2}:\d{2})\s*[–—]\s*/g, `$1${SEPARADOR_CAMPO}`);
    t = t.replace(/(às\s+\d{2}:\d{2})\s*,\s*/gi, `$1${SEPARADOR_CAMPO}`);
    t = t.replace(/(\d{2}:\d{2})\s*,\s*/g, `$1${SEPARADOR_CAMPO}`);
    t = t.replace(/(\d{1,3}%)\s*,\s*/g, `$1${SEPARADOR_CAMPO}`);
    t = t.replace(/(\d{1,3}%)\s*[–—]\s*/g, `$1${SEPARADOR_CAMPO}`);
    return t;
}

function normalizarSaudacaoRelatorio(texto, data = new Date()) {
    const { saudacaoAbertura, despedida } = obterSaudacaoRelatorio(data);
    const linhas = String(texto || '').trim().split(/\r?\n/);
    if (linhas.length === 0) {
        return [saudacaoAbertura, ...despedida.split('\n')].join('\n');
    }

    const primeira = linhas[0].trim();
    if (/^(Bom dia|Boa tarde|Boa noite)\b/i.test(primeira)) {
        linhas[0] = saudacaoAbertura;
    } else {
        linhas.unshift(saudacaoAbertura);
    }

    const padroesDespedidaAntiga = [
        /^Tenham um[a]?\s+excelente\s+(dia|tarde|noite)!?\s*$/i,
        /^Bom dia a todos!?\s*$/i,
        /^Ótimo trabalho!?\s*$/i,
        /^Boa tarde!?\s*$/i,
        /^Boa noite\b.*$/i,
        /^Bom descanso!?\s*$/i
    ];

    while (linhas.length > 0) {
        const ultima = linhas[linhas.length - 1].trim();
        if (!ultima) {
            linhas.pop();
            continue;
        }
        if (padroesDespedidaAntiga.some((re) => re.test(ultima))) {
            linhas.pop();
            continue;
        }
        break;
    }

    linhas.push(...despedida.split('\n'));
    return linhas.join('\n');
}

function montarPromptGeracao(dadosProcessados, observacoes) {
    const obs = observacoes && observacoes.trim() ? observacoes.trim() : '(nenhuma)';
    const saudacao = dadosProcessados.saudacaoAbertura || obterSaudacaoRelatorio().saudacaoAbertura;
    const despedida = dadosProcessados.despedida || obterSaudacaoRelatorio().despedida;
    const ontemTotal = dadosProcessados.ontem?.totalReclamacoes ?? 0;
    const hojeTotal = dadosProcessados.hoje?.totalReclamacoes ?? 0;
    const ontemFora = dadosProcessados.ontem?.quantidadeForaExpediente ?? 0;
    const outrosTotal = dadosProcessados.outrosDias?.totalReclamacoes ?? 0;
    let instrucaoDatas = `ONTEM (${dadosProcessados.ontem?.dataLabel || 'dia anterior'}): use total ${ontemTotal} e fora do expediente ${ontemFora} na abertura; lista 🌙 somente de ontem.foraExpediente.`;
    const qtdMotivosTop = dadosProcessados.hoje?.agrupamentoPorMotivo?.length ?? 0;
    instrucaoDatas += ` HOJE (${dadosProcessados.hoje?.dataLabel || 'hoje'}): use total ${hojeTotal} em "Hoje, até o momento..."; liste só as ${qtdMotivosTop} linha(s) de hoje.agrupamentoPorMotivo (top 3 executivo), copiando linhaFormatada — percentual e quantidade entre parênteses só do dia atual; separador " - " (não vírgula). NÃO inclua detalhamento cronológico no texto.`;
    if (outrosTotal > 0) {
        instrucaoDatas += ` Há ${outrosTotal} reclamação(ões) em outras datas (outrosDias) — não inclua em ontem, no total "Hoje, até o momento" nem nos percentuais/quantidades de hoje.`;
    }
    return `Gere o relatório operacional com base EXCLUSIVAMENTE nos dados JSON abaixo.

SAUDAÇÃO OBRIGATÓRIA (primeira linha, copie exatamente): ${saudacao}

DESPEDIDA OBRIGATÓRIA (última(s) linha(s), copie exatamente — respeite quebras de linha):
${despedida}

CLASSIFICAÇÃO POR DATA (obrigatório, não recalcule): ${instrucaoDatas}

DADOS ESTRUTURADOS:
${JSON.stringify(dadosProcessados, null, 2)}

OBSERVAÇÕES OPERACIONAIS DA USUÁRIA (incorpore naturalmente ao relatório, sem copiar literalmente):
${obs}`;
}

function montarPromptCorrecao(relatorioAtual, correcoes) {
    return `RELATÓRIO ATUAL (base para edição — mantenha o que não for pedido para alterar):
---
${relatorioAtual}
---

INSTRUÇÕES DE CORREÇÃO (aplique somente estes ajustes):
${correcoes.trim()}`;
}

/** Tokens de saída da OpenAI — relatório executivo (sem detalhamento). */
function calcularMaxTokensGeracao(totalReclamacoes) {
    const total = Math.max(0, Number(totalReclamacoes) || 0);
    return Math.min(4000, Math.max(1200, 900 + total * 15));
}

/** Detalhamento cronológico formatado (todas as datas coladas). */
function formatarDetalhamento(dadosProcessados) {
    const itens = dadosProcessados?.detalhamentoCronologico || [];
    if (itens.length === 0) {
        return 'Nenhuma reclamação para detalhar.';
    }
    const linhas = ['Detalhamento cronológico:', ''];
    for (const item of itens) {
        linhas.push(item.linhaDetalhe);
    }
    return linhas.join('\n');
}

module.exports = {
    ERRO_LINHAS_DIFERENTES,
    PROMPT_SISTEMA_GERACAO,
    PROMPT_SISTEMA_CORRECAO,
    parseLinhas,
    obterReferenciasDatasBrasilia,
    obterSaudacaoRelatorio,
    normalizarFormatacaoRelatorio,
    normalizarSaudacaoRelatorio,
    TOP_MOTIVOS_EXECUTIVO,
    validarEProcessar,
    formatarDetalhamento,
    montarPromptGeracao,
    montarPromptCorrecao,
    calcularMaxTokensGeracao
};
