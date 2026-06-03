/**
 * Utilitários para o Gerador de Relatório de Reclamações (Reclame Aqui)
 */

const ERRO_LINHAS_DIFERENTES =
    'As colunas Horários, Produtos e Motivos devem possuir a mesma quantidade de registros.';

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
- Destacar reclamações fora do expediente quando existirem.
- Organizar o detalhamento em ordem cronológica (do mais antigo ao mais recente).
- Incorporar observações operacionais de forma natural (não copie literalmente; integre ao texto).
- Não repetir informações desnecessariamente.
- Adaptar a estrutura conforme o volume de reclamações.
- Quando houver poucas reclamações, utilizar um texto mais enxuto.
- Quando houver muitas reclamações, priorizar organização e legibilidade.
- Quando não houver reclamações no dia atual, informar isso naturalmente.
- Quando existirem reclamações fora do expediente, criar uma seção específica.
- Utilizar emojis apenas para melhorar a leitura.
- Não exagerar no uso de emojis.
- Formatação do TEXTO DO RELATÓRIO (obrigatório): cada reclamação em sua própria linha; NUNCA agrupe várias reclamações na mesma linha, separadas por vírgula, ponto e vírgula ou "e".
- Se totalReclamacoes for 9, o detalhamento cronológico deve ter exatamente 9 linhas (uma por entrada em detalhamentoCronologico), na ordem do JSON.
- Use o array detalhamentoCronologico: uma linha de saída para cada objeto, sem omitir nem fundir registros.
- Na distribuição por motivo, um motivo por linha, no formato: "XX% – Nome do motivo (quantidade)".
- Em "Fora do expediente", uma reclamação por linha: "DD/MM/AA – HH:MM – Motivo" (uma linha por item em foraExpediente).
- No detalhamento cronológico, uma reclamação por linha: "DD/MM/AA às HH:MM – Motivo" (pode incluir emoji de horário quando fizer sentido).

Padrão de referência (estrutura e tom, não copie números se os dados forem outros):
Bom dia, pessoal!
Ontem recebemos X reclamações, sendo Y fora do horário de expediente.
🌙 Fora do expediente:
02/06/26 – 19:58 – Liberação chave Pix
02/06/26 – 22:51 – Liberação chave Pix
📌 Hoje, até o momento, recebemos N reclamações, distribuídas da seguinte forma:
60% – Vencimento antecipado da CCB (3)
20% – Suspeita de fraude (1)
20% – Portabilidade Pix (1)
Detalhamento:
🕡 03/06/26 às 06:43 – Vencimento antecipado da CCB
🕖 03/06/26 às 06:54 – Portabilidade Pix
📌 Observações: (incorporadas naturalmente)
Tenham um excelente dia!

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
- Mantenha a regra de uma reclamação por linha no detalhamento e listas (nunca várias na mesma linha).
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
    return { valido: true, original: trimmed, data };
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
    return `${formatarDataCurta(data)} – ${formatarHora(data)}`;
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
        reclamacoes.push({
            horario: linhasHorarios[i],
            produto: linhasProdutos[i],
            motivo: linhasMotivos[i],
            timestamp: parsed.data.getTime(),
            dataObj: parsed.data,
            foraExpediente,
            dataCurta: formatarDataCurta(parsed.data),
            horaCurta: formatarHora(parsed.data),
            dataHoraCurta: formatarDataHoraCurta(parsed.data),
            dataHoraDetalhe: formatarDataHoraDetalhe(parsed.data)
        });
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
    const foraExpedienteLista = reclamacoes.filter((r) => r.foraExpediente);
    const quantidadeForaExpediente = foraExpedienteLista.length;

    const porMotivoMap = new Map();
    for (const r of reclamacoes) {
        porMotivoMap.set(r.motivo, (porMotivoMap.get(r.motivo) || 0) + 1);
    }

    const agrupamentoPorMotivo = Array.from(porMotivoMap.entries())
        .map(([motivo, quantidade]) => ({
            motivo,
            quantidade,
            percentual: total > 0 ? Math.round((quantidade / total) * 100) : 0
        }))
        .sort((a, b) => b.quantidade - a.quantidade);

    const dadosParaIA = {
        totalReclamacoes: total,
        quantidadeForaExpediente,
        agrupamentoPorMotivo,
        reclamacoes: reclamacoes.map((r) => ({
            horario: r.horario,
            produto: r.produto,
            motivo: r.motivo,
            foraExpediente: r.foraExpediente,
            dataHoraCurta: r.dataHoraCurta,
            dataHoraDetalhe: r.dataHoraDetalhe
        })),
        foraExpediente: foraExpedienteLista.map((r) => ({
            dataHoraCurta: r.dataHoraCurta,
            motivo: r.motivo,
            produto: r.produto
        })),
        detalhamentoCronologico: reclamacoes.map((r) => ({
            dataHoraDetalhe: r.dataHoraDetalhe,
            motivo: r.motivo,
            produto: r.produto,
            foraExpediente: r.foraExpediente
        }))
    };

    return {
        success: true,
        dados: dadosParaIA,
        reclamacoes
    };
}

function montarPromptGeracao(dadosProcessados, observacoes) {
    const obs = observacoes && observacoes.trim() ? observacoes.trim() : '(nenhuma)';
    const total = dadosProcessados.totalReclamacoes || 0;
    return `Gere o relatório operacional com base EXCLUSIVAMENTE nos dados JSON abaixo.

IMPORTANTE: Existem ${total} reclamação(ões). No detalhamento cronológico e em listas de reclamações, inclua exatamente ${total} linhas — uma linha por item em detalhamentoCronologico, sem agrupar na mesma linha.

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

/** Tokens de saída da OpenAI conforme volume (sem limite de linhas no cadastro). */
function calcularMaxTokensGeracao(totalReclamacoes) {
    const total = Math.max(0, Number(totalReclamacoes) || 0);
    return Math.min(8000, Math.max(2500, 1800 + total * 90));
}

module.exports = {
    ERRO_LINHAS_DIFERENTES,
    PROMPT_SISTEMA_GERACAO,
    PROMPT_SISTEMA_CORRECAO,
    parseLinhas,
    validarEProcessar,
    montarPromptGeracao,
    montarPromptCorrecao,
    calcularMaxTokensGeracao
};
