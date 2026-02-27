// ===== SERVIDOR BACKEND SEGURO - VELOTAX BOT =====

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ===== INTEGRAÇÃO COM GOOGLE SHEETS =====
const googleSheetsIntegration = require('./google-sheets-integration');
const googleSheetsConfig = require('./google-sheets-config');
const googleSheetsFallback = require('./google-sheets-fallback');

// ===== SISTEMA DE FILA PARA GOOGLE SHEETS =====
const googleSheetsQueue = require('./google-sheets-queue');

// ===== SISTEMAS DE MONITORAMENTO E RECUPERAÇÃO =====
const GoogleSheetsMonitor = require('./google-sheets-monitor');
const GoogleSheetsQueueRobust = require('./google-sheets-queue-robust');
const GoogleSheetsDiagnostics = require('./google-sheets-diagnostics');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== INSTÂNCIAS GLOBAIS DOS SISTEMAS DE MONITORAMENTO =====
let googleSheetsMonitor = null;
let googleSheetsQueueRobust = null;
let googleSheetsDiagnostics = null;

// ===== SISTEMA DE APRENDIZADO BASEADO EM FEEDBACK SEPARADO POR ABA =====
// ===== FUNÇÕES UTILITÁRIAS PARA DATAS =====

// Função para formatar data no padrão brasileiro (DD/MM/AAAA HH:MM:SS)
function formatarDataBrasil(data = new Date()) {
    const dataBrasil = new Date(data.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    const dia = String(dataBrasil.getDate()).padStart(2, '0');
    const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
    const ano = dataBrasil.getFullYear();
    const horas = String(dataBrasil.getHours()).padStart(2, '0');
    const minutos = String(dataBrasil.getMinutes()).padStart(2, '0');
    const segundos = String(dataBrasil.getSeconds()).padStart(2, '0');
    
    return `${dia}/${mes}/${ano} ${horas}:${minutos}:${segundos}`;
}

// Função para obter timestamp no formato brasileiro
function obterTimestampBrasil() {
    return formatarDataBrasil();
}

// ===== FUNÇÃO DE NORMALIZAÇÃO ROBUSTA DE ID =====
/**
 * Normaliza um ID removendo todos os caracteres problemáticos:
 * - Espaços (início, fim, meio)
 * - Quebras de linha (\n, \r, \t)
 * - Caracteres invisíveis (zero-width spaces, etc)
 * - Normaliza para string e remove acentos opcionalmente
 */
function normalizarId(id) {
    if (!id) return '';
    
    // Converter para string
    let normalized = id.toString();
    
    // Remover caracteres invisíveis e quebras de linha
    normalized = normalized
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces
        .replace(/[\n\r\t]/g, '') // Quebras de linha e tabs
        .replace(/\s+/g, '') // TODOS os espaços (início, fim, meio)
        .trim();
    
    return normalized;
}

// ===== FUNÇÃO PARA ENCONTRAR NOME CORRETO DA ABA =====
/**
 * Tenta encontrar o nome correto da aba, testando variações
 * @param {Array} sheetNames - Lista de nomes de abas disponíveis
 * @param {string} nomeBuscado - Nome que estamos procurando
 * @returns {string|null} - Nome exato da aba encontrada ou null
 */
function encontrarNomeAba(sheetNames, nomeBuscado) {
    if (!sheetNames || !Array.isArray(sheetNames)) return null;
    
    // Normalizar nome buscado
    const nomeBuscadoLower = nomeBuscado.toLowerCase().trim();
    const nomeBuscadoSemAcento = nomeBuscadoLower
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/\s+/g, ' '); // Normaliza espaços
    
    // Tentar encontrar correspondência exata primeiro
    for (const sheetName of sheetNames) {
        if (sheetName === nomeBuscado) {
            return sheetName; // Nome exato encontrado
        }
    }
    
    // Tentar correspondência case-insensitive
    for (const sheetName of sheetNames) {
        if (sheetName.toLowerCase().trim() === nomeBuscadoLower) {
            return sheetName; // Nome encontrado (case diferente)
        }
    }
    
    // Tentar correspondência sem acentos
    for (const sheetName of sheetNames) {
        const sheetNameSemAcento = sheetName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ');
        
        if (sheetNameSemAcento === nomeBuscadoSemAcento) {
            return sheetName; // Nome encontrado (acento diferente)
        }
    }
    
    // Tentar correspondência parcial
    for (const sheetName of sheetNames) {
        const sheetNameLower = sheetName.toLowerCase().trim();
        if (sheetNameLower.includes(nomeBuscadoLower) || nomeBuscadoLower.includes(sheetNameLower)) {
            return sheetName; // Nome parcial encontrado
        }
    }
    
    return null; // Nenhuma correspondência encontrada
}

// ===== SISTEMA DE VERIFICAÇÃO AUTOMÁTICA DE FEEDBACKS =====

// Verificar feedbacks duplicados ou similares
function verificarFeedbacksDuplicados() {
    console.log('🔍 Verificando feedbacks duplicados...');
    const feedbacks = loadFeedbacks();
    const duplicados = [];
    
    for (let i = 0; i < feedbacks.respostas.length; i++) {
        for (let j = i + 1; j < feedbacks.respostas.length; j++) {
            const feedback1 = feedbacks.respostas[i];
            const feedback2 = feedbacks.respostas[j];
            
            // Verificar similaridade no feedback
            if (feedback1.feedback && feedback2.feedback) {
                const similaridade = calcularSimilaridade(feedback1.feedback, feedback2.feedback);
                if (similaridade > 0.8) {
                    duplicados.push({
                        id1: feedback1.id,
                        id2: feedback2.id,
                        similaridade: similaridade,
                        feedback1: feedback1.feedback?.substring(0, 100) || 'N/A' + '...',
                        feedback2: feedback2.feedback?.substring(0, 100) || 'N/A' + '...'
                    });
                }
            }
        }
    }
    
    if (duplicados.length > 0) {
        console.log(`⚠️ Encontrados ${duplicados.length} feedbacks potencialmente duplicados`);
        duplicados.forEach(dup => {
            console.log(`   Similaridade: ${(dup.similaridade * 100).toFixed(1)}% entre IDs ${dup.id1} e ${dup.id2}`);
        });
    } else {
        console.log('✅ Nenhum feedback duplicado encontrado');
    }
    
    return duplicados;
}

// Calcular similaridade entre dois textos
function calcularSimilaridade(texto1, texto2) {
    const palavras1 = texto1.toLowerCase().split(/\s+/);
    const palavras2 = texto2.toLowerCase().split(/\s+/);
    
    const set1 = new Set(palavras1);
    const set2 = new Set(palavras2);
    
    const interseccao = new Set([...set1].filter(x => set2.has(x)));
    const uniao = new Set([...set1, ...set2]);
    
    return interseccao.size / uniao.size;
}

// Validar qualidade dos feedbacks
function validarQualidadeFeedbacks() {
    console.log('📊 Validando qualidade dos feedbacks...');
    const feedbacks = loadFeedbacks();
    const relatorio = {
        total: feedbacks.respostas.length,
        validos: 0,
        invalidos: 0,
        problemas: []
    };
    
    feedbacks.respostas.forEach(feedback => {
        const problemas = [];
        
        // Verificar se tem feedback
        if (!feedback.feedback || feedback.feedback.trim().length < 10) {
            problemas.push('Feedback muito curto ou vazio');
        }
        
        // Verificar se tem resposta reformulada
        if (!feedback.respostaReformulada || feedback.respostaReformulada.trim().length < 50) {
            problemas.push('Resposta reformulada muito curta ou vazia');
        }
        
        // Verificar se tem dados do formulário
        if (!feedback.dadosFormulario) {
            problemas.push('Dados do formulário ausentes');
        }
        
        // Verificar se tem tipo de solicitação
        if (!feedback.dadosFormulario?.tipo_solicitacao) {
            problemas.push('Tipo de solicitação ausente');
        }
        
        if (problemas.length === 0) {
            relatorio.validos++;
        } else {
            relatorio.invalidos++;
            relatorio.problemas.push({
                id: feedback.id,
                problemas: problemas
            });
        }
    });
    
    console.log(`✅ Feedbacks válidos: ${relatorio.validos}`);
    console.log(`❌ Feedbacks inválidos: ${relatorio.invalidos}`);
    
    if (relatorio.problemas.length > 0) {
        console.log('⚠️ Problemas encontrados:');
        relatorio.problemas.forEach(prob => {
            console.log(`   ID ${prob.id}: ${prob.problemas.join(', ')}`);
        });
    }
    
    return relatorio;
}

// Sistema de pontuação de feedbacks
function pontuarFeedbacks() {
    console.log('⭐ Calculando pontuação dos feedbacks...');
    const feedbacks = loadFeedbacks();
    const feedbacksPontuados = [];
    
    feedbacks.respostas.forEach(feedback => {
        let pontuacao = 0;
        const criterios = [];
        
        // Critério 1: Completude do feedback (0-30 pontos)
        if (feedback.feedback && feedback.feedback.length > 50) {
            pontuacao += 30;
            criterios.push('Feedback completo (+30)');
        } else if (feedback.feedback && feedback.feedback.length > 20) {
            pontuacao += 15;
            criterios.push('Feedback parcial (+15)');
        }
        
        // Critério 2: Qualidade da resposta reformulada (0-25 pontos)
        if (feedback.respostaReformulada && feedback.respostaReformulada.length > 100) {
            pontuacao += 25;
            criterios.push('Resposta reformulada completa (+25)');
        } else if (feedback.respostaReformulada && feedback.respostaReformulada.length > 50) {
            pontuacao += 12;
            criterios.push('Resposta reformulada parcial (+12)');
        }
        
        // Critério 3: Dados do formulário completos (0-20 pontos)
        if (feedback.dadosFormulario?.tipo_solicitacao && feedback.dadosFormulario?.id_reclamacao) {
            pontuacao += 20;
            criterios.push('Dados do formulário completos (+20)');
        } else if (feedback.dadosFormulario?.tipo_solicitacao) {
            pontuacao += 10;
            criterios.push('Dados do formulário parciais (+10)');
        }
        
        // Critério 4: Contexto adicional (0-15 pontos)
        if (feedback.contexto && Object.keys(feedback.contexto).length > 0) {
            pontuacao += 15;
            criterios.push('Contexto adicional (+15)');
        }
        
        // Critério 5: Timestamp recente (0-10 pontos)
        const dataFeedback = new Date(feedback.timestamp);
        const agora = new Date();
        const diasDiferenca = (agora - dataFeedback) / (1000 * 60 * 60 * 24);
        
        if (diasDiferenca < 7) {
            pontuacao += 10;
            criterios.push('Feedback recente (+10)');
        } else if (diasDiferenca < 30) {
            pontuacao += 5;
            criterios.push('Feedback moderadamente recente (+5)');
        }
        
        feedbacksPontuados.push({
            id: feedback.id,
            pontuacao: pontuacao,
            criterios: criterios,
            timestamp: feedback.timestamp
        });
    });
    
    // Ordenar por pontuação
    feedbacksPontuados.sort((a, b) => b.pontuacao - a.pontuacao);
    
    console.log('🏆 Top 5 feedbacks com maior pontuação:');
    feedbacksPontuados.slice(0, 5).forEach((fb, index) => {
        console.log(`   ${index + 1}. ID ${fb.id}: ${fb.pontuacao} pontos`);
        fb.criterios.forEach(criterio => console.log(`      - ${criterio}`));
    });
    
    return feedbacksPontuados;
}

// Detectar padrões de feedback
function detectarPadroesFeedback() {
    console.log('🔍 Detectando padrões nos feedbacks...');
    const feedbacks = loadFeedbacks();
    const padroes = {
        problemasComuns: {},
        tiposSolicitacao: {},
        palavrasChave: {},
        tendencias: {}
    };
    
    feedbacks.respostas.forEach(feedback => {
        // Analisar problemas identificados
        if (feedback.feedback) {
            const problemas = feedback.feedback.match(/informacoes-incorretas|nao-condiz-solucao|falta-clareza|nao-empatico|tom-inadequado/g);
            if (problemas) {
                problemas.forEach(problema => {
                    padroes.problemasComuns[problema] = (padroes.problemasComuns[problema] || 0) + 1;
                });
            }
        }
        
        // Analisar tipos de solicitação
        if (feedback.dadosFormulario?.tipo_solicitacao) {
            const tipo = feedback.dadosFormulario.tipo_solicitacao;
            padroes.tiposSolicitacao[tipo] = (padroes.tiposSolicitacao[tipo] || 0) + 1;
        }
        
        // Analisar palavras-chave
        if (feedback.feedback) {
            const palavras = feedback.feedback.toLowerCase().split(/\s+/);
            palavras.forEach(palavra => {
                if (palavra.length > 4) {
                    padroes.palavrasChave[palavra] = (padroes.palavrasChave[palavra] || 0) + 1;
                }
            });
        }
    });
    
    // Ordenar e mostrar resultados
    console.log('📈 Problemas mais comuns:');
    Object.entries(padroes.problemasComuns)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .forEach(([problema, count]) => {
            console.log(`   ${problema}: ${count} ocorrências`);
        });
    
    console.log('📋 Tipos de solicitação mais frequentes:');
    Object.entries(padroes.tiposSolicitacao)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .forEach(([tipo, count]) => {
            console.log(`   ${tipo}: ${count} ocorrências`);
        });
    
    return padroes;
}

// Verificar qualidade de um feedback individual
function verificarQualidadeFeedbackIndividual(feedback) {
    let pontuacao = 0;
    const problemas = [];
    
    // Critério 1: Completude do feedback (0-30 pontos)
    if (feedback.feedback && feedback.feedback.length > 50) {
        pontuacao += 30;
    } else if (feedback.feedback && feedback.feedback.length > 20) {
        pontuacao += 15;
    } else {
        problemas.push('Feedback muito curto ou vazio');
    }
    
    // Critério 2: Qualidade da resposta reformulada (0-25 pontos)
    if (feedback.respostaReformulada && feedback.respostaReformulada.length > 100) {
        pontuacao += 25;
    } else if (feedback.respostaReformulada && feedback.respostaReformulada.length > 50) {
        pontuacao += 12;
    } else {
        problemas.push('Resposta reformulada muito curta ou vazia');
    }
    
    // Critério 3: Contexto adicional (0-15 pontos)
    if (feedback.contexto && Object.keys(feedback.contexto).length > 0) {
        pontuacao += 15;
    }
    
    // Critério 4: Timestamp recente (0-10 pontos)
    const dataFeedback = new Date(feedback.timestamp);
    const agora = new Date();
    const diasDiferenca = (agora - dataFeedback) / (1000 * 60 * 60 * 24);
    
    if (diasDiferenca < 7) {
        pontuacao += 10;
    } else if (diasDiferenca < 30) {
        pontuacao += 5;
    }
    
    return {
        pontuacao: pontuacao,
        problemas: problemas,
        nivel: pontuacao >= 70 ? 'alta' : pontuacao >= 40 ? 'media' : 'baixa'
    };
}

// Executar verificação completa do sistema
function executarVerificacaoCompletaFeedbacks() {
    console.log('🚀 Iniciando verificação completa do sistema de feedbacks...');
    console.log('=' .repeat(60));
    
    const resultados = {
        duplicados: verificarFeedbacksDuplicados(),
        qualidade: validarQualidadeFeedbacks(),
        pontuacao: pontuarFeedbacks(),
        padroes: detectarPadroesFeedback(),
        timestamp: new Date().toISOString()
    };
    
    console.log('=' .repeat(60));
    console.log('✅ Verificação completa finalizada!');
    
    return resultados;
}

// Arquivos separados para cada tipo de feedback
const FEEDBACKS_RESPOSTAS_FILE = path.join(__dirname, 'data', 'feedbacks_respostas.json');
const FEEDBACKS_MODERACOES_FILE = path.join(__dirname, 'data', 'feedbacks_moderacoes.json');
const FEEDBACKS_EXPLICACOES_FILE = path.join(__dirname, 'data', 'feedbacks_explicacoes.json');

// Arquivo para modelos de respostas aprovadas
const MODELOS_RESPOSTAS_FILE = path.join(__dirname, 'data', 'modelos_respostas.json');

// Arquivo para modelos de moderações aprovadas (pasta específica)
const MODELOS_MODERACOES_FILE = path.join(__dirname, 'data', 'moderacao_coerente', 'modelos_moderacoes.json');
const ESTATISTICAS_GLOBAIS_FILE = path.join(__dirname, 'data', 'estatisticas_globais.json');

// Arquivo para aprendizado direto no script de formulação
const APRENDIZADO_SCRIPT_FILE = path.join(__dirname, 'data', 'aprendizado_script.json');

// Garantir que os diretórios data existem
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Garantir que o diretório moderacao_coerente existe
const moderacaoCoerenteDir = path.join(__dirname, 'data', 'moderacao_coerente');
if (!fs.existsSync(moderacaoCoerenteDir)) {
    fs.mkdirSync(moderacaoCoerenteDir, { recursive: true });
}

// ===== FUNÇÕES PARA FEEDBACKS DE RESPOSTAS RA =====

// Carregar feedbacks de respostas
function loadFeedbacksRespostas() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && feedbacksRespostasMemoria) {
        console.log('🌐 Vercel detectado - carregando feedbacks de respostas da memória');
        return feedbacksRespostasMemoria;
    }
    
    try {
        if (fs.existsSync(FEEDBACKS_RESPOSTAS_FILE)) {
            const data = fs.readFileSync(FEEDBACKS_RESPOSTAS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar feedbacks de respostas:', error);
    }
    return {
        respostas: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar feedbacks de respostas
async function saveFeedbacksRespostas(feedbacks) {
    try {
        console.log('🔍 DEBUG - saveFeedbacksRespostas chamada com:', feedbacks.respostas?.length || 0, 'feedbacks');
        feedbacks.lastUpdated = obterTimestampBrasil();
        
        // Salvar baseado no ambiente
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            // Vercel: apenas memória
            console.log('🌐 Vercel - salvando apenas em memória');
            feedbacksRespostasMemoria = feedbacks;
            console.log('✅ Feedbacks de respostas salvos em memória:', feedbacks.respostas?.length || 0);
        } else {
            // Desenvolvimento local: arquivo JSON
            console.log('💻 Desenvolvimento local - salvando no arquivo:', FEEDBACKS_RESPOSTAS_FILE);
            try {
                fs.writeFileSync(FEEDBACKS_RESPOSTAS_FILE, JSON.stringify(feedbacks, null, 2));
                console.log('✅ Feedbacks de respostas salvos no arquivo:', FEEDBACKS_RESPOSTAS_FILE);
                console.log('📊 Total de feedbacks salvos:', feedbacks.respostas?.length || 0);
            } catch (fileError) {
                console.log('❌ ERRO ao salvar no arquivo:', fileError.message);
                // Fallback para memória
                feedbacksRespostasMemoria = feedbacks;
                console.log('✅ Feedbacks de respostas salvos em memória (fallback)');
            }
        }
        

        // GOOGLE SHEETS REATIVADO COM CONTROLE DE QUOTA
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            console.log('🔄 Inicializando Google Sheets com controle de quota...');
            initializeGoogleSheets()
                .then(() => {
                    console.log('✅ Google Sheets inicializado com sucesso');
                })
                .catch((error) => {
                    console.error('❌ Erro ao inicializar Google Sheets:', error.message);
                });
        }
        
        // Registrar no Google Sheets se ativo (SISTEMA SIMPLES)
        console.log('🔍 DEBUG - Google Sheets status:', {
            googleSheetsIntegration: !!googleSheetsIntegration,
            isActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            feedbacksCount: feedbacks.respostas ? feedbacks.respostas.length : 0
        });
        
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                // Salvar apenas o último feedback (mais simples)
                const ultimoFeedback = feedbacks.respostas[feedbacks.respostas.length - 1];
                if (ultimoFeedback) {
                    const feedbackData = {
                        id: ultimoFeedback.id,
                        tipo: 'feedback',
                        tipoSituacao: ultimoFeedback.contexto?.tipoSituacao || 'N/A',
                        textoCliente: ultimoFeedback.dadosFormulario?.texto_cliente || 'N/A',
                        respostaAnterior: ultimoFeedback.respostaAnterior || 'N/A',
                        feedback: ultimoFeedback.feedback || 'N/A',
                        respostaReformulada: ultimoFeedback.respostaReformulada || 'N/A',
                        dadosFormulario: {
                            tipo_solicitacao: ultimoFeedback.dadosFormulario?.tipo_solicitacao || ultimoFeedback.contexto?.tipoSituacao || 'N/A',
                            id_reclamacao: ultimoFeedback.dadosFormulario?.id_reclamacao || ultimoFeedback.contexto?.idReclamacao || 'N/A',
                            solucao_implementada: ultimoFeedback.dadosFormulario?.solucao_implementada || '',
                            historico_atendimento: ultimoFeedback.dadosFormulario?.historico_atendimento || '',
                            nome_solicitante: ultimoFeedback.dadosFormulario?.nome_solicitante || ultimoFeedback.dadosFormulario?.observacoes_internas || '',
                            observacoes_internas: ultimoFeedback.dadosFormulario?.observacoes_internas || '', // compatibilidade leitura
                            texto_cliente: ultimoFeedback.dadosFormulario?.texto_cliente || 'N/A'
                        },
                        timestamp: ultimoFeedback.timestamp,
                        userProfile: ultimoFeedback.userData ? `${ultimoFeedback.userData.nome} (${ultimoFeedback.userData.email})` : 'N/A',
                        userName: ultimoFeedback.userData?.nome || 'N/A',
                        userEmail: ultimoFeedback.userData?.email || 'N/A'
                    };
                    
                    // SALVAMENTO VIA FILA - COM AWAIT
                    await googleSheetsQueue.addToQueue({ type: 'feedback', data: feedbackData }, true);
                    console.log('📋 Feedback salvo no Google Sheets:', ultimoFeedback.id);
                }
            } catch (error) {
                console.error('❌ Erro ao processar feedback:', error.message);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de respostas:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            feedbacksRespostasMemoria = feedbacks;
        }
    }
}

// ===== FUNÇÕES PARA FEEDBACKS DE MODERAÇÕES RA =====

// Carregar feedbacks de moderações
function loadFeedbacksModeracoes() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && feedbacksModeracoesMemoria) {
        console.log('🌐 Vercel detectado - carregando feedbacks de moderações da memória');
        return feedbacksModeracoesMemoria;
    }
    
    try {
        if (fs.existsSync(FEEDBACKS_MODERACOES_FILE)) {
            const data = fs.readFileSync(FEEDBACKS_MODERACOES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar feedbacks de moderações:', error);
    }
    return {
        moderacoes: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar feedbacks de moderações
async function saveFeedbacksModeracoes(feedbacks) {
    try {
        feedbacks.lastUpdated = obterTimestampBrasil();
        
        // Verificar se estamos no Vercel (sistema de arquivos somente leitura)
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            console.log('🌐 Vercel detectado - salvando feedbacks de moderações em memória');
            feedbacksModeracoesMemoria = feedbacks;
            console.log('✅ Feedbacks de moderações salvos em memória');
            
            // Registrar no Google Sheets se ativo (SISTEMA SIMPLES)
            if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
                try {
                    // Salvar apenas a última moderação (mais simples)
                    const ultimaModeracao = feedbacks.moderacoes[feedbacks.moderacoes.length - 1];
                    if (ultimaModeracao) {
                        const moderacaoData = {
                            id: ultimaModeracao.id,
                            tipo: 'moderacao',
                            motivoNegativa: ultimaModeracao.motivoNegativa || 'N/A',
                            textoNegado: ultimaModeracao.textoNegado || 'N/A',
                            textoReformulado: ultimaModeracao.textoReformulado || 'N/A',
                            timestamp: ultimaModeracao.timestamp,
                            userProfile: ultimaModeracao.userData ? `${ultimaModeracao.userData.nome} (${ultimaModeracao.userData.email})` : 'N/A',
                            userName: ultimaModeracao.userData?.nome || 'N/A',
                            userEmail: ultimaModeracao.userData?.email || 'N/A'
                        };
                        
                        // SALVAMENTO VIA FILA - COM AWAIT
                        await googleSheetsQueue.addToQueue({ type: 'feedback', data: moderacaoData }, true);
                        console.log('📋 Moderação salva no Google Sheets:', ultimaModeracao.id);
                    }
                } catch (error) {
                    console.error('❌ Erro ao processar moderação:', error.message);
                }
            }
            return;
        }
        
        // Desenvolvimento local - usar sistema de arquivos
        fs.writeFileSync(FEEDBACKS_MODERACOES_FILE, JSON.stringify(feedbacks, null, 2));
        console.log('✅ Feedbacks de moderações salvos no arquivo:', FEEDBACKS_MODERACOES_FILE);
        
        // Nota: Registros no Google Sheets são feitos em outras funções específicas
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de moderações:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            feedbacksModeracoesMemoria = feedbacks;
        }
    }
}

// ===== FUNÇÕES PARA FEEDBACKS DE EXPLICAÇÕES =====

// Carregar feedbacks de explicações
function loadFeedbacksExplicacoes() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && feedbacksExplicacoesMemoria) {
        console.log('🌐 Vercel detectado - carregando feedbacks de explicações da memória');
        return feedbacksExplicacoesMemoria;
    }
    
    try {
        if (fs.existsSync(FEEDBACKS_EXPLICACOES_FILE)) {
            const data = fs.readFileSync(FEEDBACKS_EXPLICACOES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar feedbacks de explicações:', error);
    }
    return {
        explicacoes: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar feedbacks de explicações
function saveFeedbacksExplicacoes(feedbacks) {
    try {
        feedbacks.lastUpdated = obterTimestampBrasil();
        
        // Verificar se estamos no Vercel (sistema de arquivos somente leitura)
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            console.log('🌐 Vercel detectado - salvando feedbacks de explicações em memória');
            feedbacksExplicacoesMemoria = feedbacks;
            console.log('✅ Feedbacks de explicações salvos em memória');
            return;
        }
        
        // Desenvolvimento local - usar sistema de arquivos
        fs.writeFileSync(FEEDBACKS_EXPLICACOES_FILE, JSON.stringify(feedbacks, null, 2));
        console.log('✅ Feedbacks de explicações salvos no arquivo');
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de explicações:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            feedbacksExplicacoesMemoria = feedbacks;
        }
    }
}

// ===== FUNÇÕES PARA ESTATÍSTICAS GLOBAIS =====

// Carregar estatísticas globais
function loadEstatisticasGlobais() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && estatisticasGlobaisMemoria) {
        console.log('🌐 Vercel detectado - carregando estatísticas da memória');
        return estatisticasGlobaisMemoria;
    }
    
    try {
        if (fs.existsSync(ESTATISTICAS_GLOBAIS_FILE)) {
            const data = fs.readFileSync(ESTATISTICAS_GLOBAIS_FILE, 'utf8');
            
            if (!data.trim()) {
                console.log('Arquivo estatisticas_globais.json está vazio, criando estrutura padrão');
                const estruturaPadrao = {
                    estatisticas: {
                        respostas_geradas: 0,
                        respostas_coerentes: 0,
                        moderacoes_geradas: 0,
                        moderacoes_coerentes: 0,
                        revisoes_texto: 0,
                        explicacoes_geradas: 0
                    },
                    historico_diario: [],
                    lastUpdated: obterTimestampBrasil(),
                    descricao: "Estatísticas globais do sistema Velotax Bot - compartilhadas entre todos os usuários"
                };
                saveEstatisticasGlobais(estruturaPadrao);
                return estruturaPadrao;
            }
            
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas globais:', error);
        console.log('Recriando arquivo estatisticas_globais.json com estrutura padrão');
        
        const estruturaPadrao = {
            estatisticas: {
                respostas_geradas: 0,
                respostas_coerentes: 0,
                moderacoes_geradas: 0,
                moderacoes_coerentes: 0,
                revisoes_texto: 0,
                explicacoes_geradas: 0
            },
            historico_diario: [],
            lastUpdated: obterTimestampBrasil(),
            descricao: "Estatísticas globais do sistema Velotax Bot - compartilhadas entre todos os usuários"
        };
        
        try {
            saveEstatisticasGlobais(estruturaPadrao);
        } catch (saveError) {
            console.error('Erro ao recriar arquivo estatisticas_globais.json:', saveError);
        }
        
        return estruturaPadrao;
    }
    return {
        estatisticas: {
            respostas_geradas: 0,
            respostas_coerentes: 0,
            moderacoes_geradas: 0,
            moderacoes_coerentes: 0,
            revisoes_texto: 0,
            explicacoes_geradas: 0
        },
        historico_diario: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar estatísticas globais
function saveEstatisticasGlobais(estatisticas) {
    try {
        if (!estatisticas || typeof estatisticas !== 'object') {
            throw new Error('Estrutura de estatísticas inválida');
        }
        
        if (!estatisticas.estatisticas) {
            estatisticas.estatisticas = {
                respostas_geradas: 0,
                respostas_coerentes: 0,
                moderacoes_geradas: 0,
                moderacoes_coerentes: 0,
                revisoes_texto: 0,
                explicacoes_geradas: 0
            };
        }
        
        if (!Array.isArray(estatisticas.historico_diario)) {
            estatisticas.historico_diario = [];
        }
        
        estatisticas.lastUpdated = obterTimestampBrasil();
        
        // Verificar se estamos no Vercel (sistema de arquivos somente leitura)
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            console.log('🌐 Vercel detectado - salvando estatísticas em memória');
            estatisticasGlobaisMemoria = estatisticas;
            console.log('✅ Estatísticas globais salvas em memória');
            return;
        }
        
        // Desenvolvimento local - usar sistema de arquivos
        const dir = path.dirname(ESTATISTICAS_GLOBAIS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const tempFile = ESTATISTICAS_GLOBAIS_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(estatisticas, null, 2), 'utf8');
        fs.renameSync(tempFile, ESTATISTICAS_GLOBAIS_FILE);
        
        console.log('✅ Estatísticas globais salvas no arquivo');
    } catch (error) {
        console.error('❌ Erro ao salvar estatísticas globais:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            estatisticasGlobaisMemoria = estatisticas;
        }
        
        try {
            const tempFile = ESTATISTICAS_GLOBAIS_FILE + '.tmp';
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (cleanupError) {
            console.error('Erro ao limpar arquivo temporário:', cleanupError);
        }
    }
}

// Incrementar estatística global
async function incrementarEstatisticaGlobal(tipo, quantidade = 1) {
    console.log(`📊 Incrementando estatística global: ${tipo} (+${quantidade})`);
    
    const estatisticas = loadEstatisticasGlobais();
    
    if (estatisticas.estatisticas[tipo] !== undefined) {
        estatisticas.estatisticas[tipo] += quantidade;
    } else {
        console.log(`⚠️ Tipo de estatística não encontrado: ${tipo}`);
        return;
    }
    
    // Adicionar ao histórico diário
    const hoje = new Date();
    const dataHoje = hoje.toISOString().split('T')[0]; // YYYY-MM-DD
    
    let entradaHoje = estatisticas.historico_diario.find(entrada => entrada.data === dataHoje);
    if (entradaHoje) {
        entradaHoje[tipo] = (entradaHoje[tipo] || 0) + quantidade;
        entradaHoje.ultimaAtualizacao = hoje.toISOString();
    } else {
        entradaHoje = {
            data: dataHoje,
            respostas_geradas: tipo === 'respostas_geradas' ? quantidade : 0,
            respostas_coerentes: tipo === 'respostas_coerentes' ? quantidade : 0,
            moderacoes_geradas: tipo === 'moderacoes_geradas' ? quantidade : 0,
            moderacoes_coerentes: tipo === 'moderacoes_coerentes' ? quantidade : 0,
            revisoes_texto: tipo === 'revisoes_texto' ? quantidade : 0,
            explicacoes_geradas: tipo === 'explicacoes_geradas' ? quantidade : 0,
            ultimaAtualizacao: hoje.toISOString()
        };
        estatisticas.historico_diario.unshift(entradaHoje);
    }
    
    // Manter apenas os últimos 30 dias
    if (estatisticas.historico_diario.length > 30) {
        estatisticas.historico_diario = estatisticas.historico_diario.slice(0, 30);
    }
    
    saveEstatisticasGlobais(estatisticas);
    console.log(`✅ Estatística ${tipo} atualizada: ${estatisticas.estatisticas[tipo]}`);
    
    // 🔄 SINCRONIZAR COM GOOGLE SHEETS AUTOMATICAMENTE
    if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        try {
            console.log('📊 Sincronizando estatísticas com Google Sheets...');
            await googleSheetsIntegration.registrarEstatisticas(estatisticas.estatisticas);
            console.log('✅ Estatísticas sincronizadas com Google Sheets');
        } catch (error) {
            console.error('❌ Erro ao sincronizar estatísticas com Google Sheets:', error.message);
        }
    } else {
        console.log('⚠️ Google Sheets não está ativo - estatísticas não sincronizadas');
    }
}

// ===== SISTEMA DE APRENDIZADO SEPARADO =====

// Função para extrair o primeiro nome do usuário logado
function obterPrimeiroNomeUsuario(userData) {
    if (!userData || !userData.nome) {
        return 'Agente';
    }
    
    // Extrair primeiro nome (até o primeiro espaço)
    const primeiroNome = userData.nome.trim().split(/\s+/)[0];
    return primeiroNome || 'Agente';
}

// Função para tentar extrair o nome do cliente da reclamação
function extrairNomeCliente(textoReclamacao) {
    if (!textoReclamacao || typeof textoReclamacao !== 'string') {
        return null;
    }
    
    // Padrões comuns para encontrar nomes
    const padroes = [
        /(?:Olá|Oi|Bom dia|Boa tarde|Boa noite|Prezados?|Sr\.|Sra\.|Srª\.|Dr\.|Dra\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /(?:meu nome é|sou|chamo-me|chamo me|me chamo)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+está|\s+foi|\s+será)/i
    ];
    
    for (const padrao of padroes) {
        const match = textoReclamacao.match(padrao);
        if (match && match[1]) {
            const nome = match[1].trim();
            // Validar se parece um nome (não muito longo, não contém números)
            if (nome.length <= 50 && !/\d/.test(nome)) {
                return nome;
            }
        }
    }
    
    return null;
}

// Função para formatar resposta RA com a estrutura solicitada
function formatarRespostaRA(respostaTexto, nomeCliente, nomeAgente) {
    if (!respostaTexto || typeof respostaTexto !== 'string') {
        return respostaTexto;
    }
    
    // Garantir que temos um nome de agente válido
    if (!nomeAgente || nomeAgente.trim() === '') {
        nomeAgente = 'Agente';
    }
    
    // Se a resposta já estiver formatada com a estrutura completa, verificar e atualizar se necessário
    const jaTemEstruturaCompleta = respostaTexto.includes('Permanecemos à disposição por meio de nossos canais oficiais') ||
        respostaTexto.includes('3003-7293') ||
        respostaTexto.includes('0800-800-0049');
    
    if (jaTemEstruturaCompleta) {
        // Verificar se a estrutura está completa e correta
        const temSaudacao = /Olá,\s+[^!]+!/.test(respostaTexto);
        const temApresentacao = /Sou\s+[^,]+,?\s+especialista\s+de\s+atendimento/.test(respostaTexto);
        const temContato = respostaTexto.includes('3003-7293') && respostaTexto.includes('0800-800-0049');
        const temAssinatura = /Atenciosamente,/.test(respostaTexto);
        
        // Se já tem estrutura completa e correta, apenas atualizar nome do agente se necessário
        if (temSaudacao && temApresentacao && temContato && temAssinatura) {
            // Atualizar nome do agente se estiver diferente
            if (nomeAgente !== 'Agente') {
                respostaTexto = respostaTexto.replace(/Sou\s+[^,]+,\s+especialista/g, `Sou ${nomeAgente}, especialista`);
                respostaTexto = respostaTexto.replace(/Atenciosamente,\s*\n\s*[^\n]+\s*\n\s*Equipe de Atendimento Velotax/g, 
                    `Atenciosamente,\n${nomeAgente} \nEquipe de Atendimento Velotax`);
            }
            return respostaTexto;
        }
        // Se tem estrutura mas está incompleta, remover e refazer
    }
    
    // Limpar qualquer estrutura antiga ou incompleta
    let textoLimpo = respostaTexto.trim();
    
    // Remover saudações antigas
    textoLimpo = textoLimpo.replace(/^(Olá|Oi|Prezado\(a\)?\s+cliente|Prezado\s+cliente|Prezada\s+cliente)[^!]*[!.,]\s*/i, '');
    
    // Remover apresentações antigas
    textoLimpo = textoLimpo.replace(/^Sou\s+[^,]+,\s+especialista[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^[^,]+,\s+especialista\s+de\s+atendimento[^.]*\.\s*/i, '');
    
    // Remover "Espero que esteja bem" se estiver sozinho
    textoLimpo = textoLimpo.replace(/^Espero\s+que\s+esteja\s+bem[.!]?\s*/i, '');
    
    // Remover "recebemos sua manifestação" se estiver no início
    textoLimpo = textoLimpo.replace(/^[^.]*recebemos\s+sua\s+manifestação[^.]*\.\s*/i, '');
    
    // Remover informações de contato antigas
    textoLimpo = textoLimpo.replace(/\n*Permanecemos\s+à\s+disposição[^.]*\.\s*/gi, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*3003-7293[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*0800-800-0049[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*🌐\s*www\.velotax\.com\.br\s*/g, '');
    
    // Remover assinaturas antigas
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*[^\n]*\s*\n*Equipe\s+de\s+Atendimento[^\n]*$/i, '');
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*Equipe\s+Velotax\s*$/i, '');
    
    // Limpar espaços extras e linhas vazias no início e fim
    textoLimpo = textoLimpo.trim();
    
    // Usar nome do cliente se disponível, senão usar "cliente"
    const saudacaoCliente = nomeCliente && nomeCliente.trim() !== '' ? nomeCliente : 'cliente';
    
    // Construir a resposta formatada com a estrutura completa
    const respostaFormatada = `Olá, ${saudacaoCliente}!

Espero que esteja bem.

Sou ${nomeAgente}, especialista de atendimento do Velotax, recebemos sua manifestação e agradecemos a oportunidade de esclarecimento.  

${textoLimpo}



Permanecemos à disposição por meio de nossos canais oficiais de atendimento:


📞 3003-7293 (capitais e regiões metropolitanas)
📞 0800-800-0049 (demais localidades)
🌐 www.velotax.com.br

Atenciosamente,
${nomeAgente} 
Equipe de Atendimento Velotax`;

    return respostaFormatada;
}

// Gerar script padrão "cru" para geração de respostas
function gerarScriptPadraoResposta(dadosFormulario) {
    return `📌 SCRIPT INTELIGENTE PARA GERAÇÃO DE RESPOSTA RA - VELOTAX

Você é um especialista em atendimento ao cliente da Velotax, empresa de antecipação de restituição do Imposto de Renda. Sua função é gerar respostas personalizadas e inteligentes para o Reclame Aqui.

DADOS ESPECÍFICOS DO CASO:
- Tipo de solicitação: ${dadosFormulario.tipo_solicitacao}
- ID da Reclamação: ${dadosFormulario.id_reclamacao}
- Solução implementada: ${dadosFormulario.solucao_implementada}
- Texto do cliente: ${dadosFormulario.texto_cliente}
- Histórico de atendimento: ${dadosFormulario.historico_atendimento}
- Nome do solicitante (usar na saudação "Olá, [nome]!"): ${dadosFormulario.nome_solicitante || 'não informado'}

🧠 ANÁLISE INTELIGENTE OBRIGATÓRIA:

1. CONTEXTUALIZAÇÃO DA VELOTAX:
- Somos especialistas em antecipação de restituição do Imposto de Renda
- Trabalhamos com Cédula de Crédito Bancário (CCB) conforme legislação
- Seguimos rigorosamente a LGPD e normas do Banco Central
- Nossa operação é 100% legal e regulamentada

2. ANÁLISE ESPECÍFICA POR TIPO DE SOLICITAÇÃO:

${gerarContextoEspecifico(dadosFormulario.tipo_solicitacao)}

3. ESTRUTURA INTELIGENTE DA RESPOSTA:

a) RECONHECIMENTO PERSONALIZADO:
- Agradeça especificamente pela confiança na Velotax (de forma objetiva, sem exageros)
- Reconheça a importância da solicitação do cliente (de forma direta)
- Demonstre compreensão da situação específica (sem pedir desculpas)

b) ESCLARECIMENTO TÉCNICO:
- Explique o que foi feito de forma clara e técnica
- Cite datas, processos e procedimentos específicos
- Contextualize com a legislação aplicável (CCB, LGPD, etc.)

c) SOLUÇÃO IMPLEMENTADA:
- Detalhe as ações tomadas pela Velotax
- Explique como a solução resolve a solicitação
- Mencione benefícios e resultados para o cliente

d) COMPROMISSO E TRANSPARÊNCIA:
- Reafirme o compromisso com a satisfação
- Ofereça canais de comunicação direta
- Demonstre transparência nos processos

4. DIRETRIZES ESPECÍFICAS DA VELOTAX:

- Use linguagem técnica mas acessível
- Cite sempre a legislação aplicável (CCB, LGPD, etc.)
- Mencione a regulamentação do Banco Central quando relevante
- Demonstre expertise em antecipação de restituição
- Mantenha tom profissional, direto e solucionador
- Seja específico sobre processos e prazos
- Evite generalizações - seja sempre específico ao caso
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Seja firme e objetivo, sem excesso de tom acolhedor
- Foque em esclarecer e resolver, não em justificar ou se desculpar

5. ELEMENTOS OBRIGATÓRIOS:

- Mencione a Velotax como especialista em antecipação de restituição
- Cite a legalidade da operação (CCB, regulamentação BC)
- Demonstre conhecimento técnico do processo
- Ofereça canais de contato direto
- Mantenha transparência total

⚠️ FORMATO DE SAÍDA OBRIGATÓRIO:

IMPORTANTE: Você deve gerar APENAS o conteúdo do meio da resposta, SEM saudação inicial e SEM assinatura final. 

A estrutura completa (saudação com nome do cliente, apresentação do agente, informações de contato e assinatura) será aplicada automaticamente pelo sistema.

Gere APENAS o texto explicativo que vai entre a apresentação do agente e as informações de contato. Este texto deve:
- Responder diretamente à solicitação do cliente
- Explicar a solução implementada
- Ser específico e detalhado
- Demonstrar expertise técnica, transparência e compromisso com a satisfação do cliente
- Estar sempre contextualizado para a Velotax e o tipo de solicitação específica
- NUNCA incluir pedidos de desculpas ou expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Ser firme e objetivo, sem excesso de tom acolhedor ou friendly

NÃO inclua:
- "Olá, [nome]" ou qualquer saudação
- "Sou [nome], especialista..." ou apresentação
- Informações de contato (telefones, site)
- "Atenciosamente" ou assinatura
- Qualquer estrutura de cabeçalho ou rodapé

Gere APENAS o conteúdo explicativo do meio da resposta.`;
}

// Função auxiliar para gerar contexto específico por tipo de solicitação
function gerarContextoEspecifico(tipoSolicitacao) {
    const contextos = {
        'exclusao-cadastro': `
🔹 EXCLUSÃO DE CADASTRO:
- Processo de exclusão conforme LGPD (Lei 13.709/2018)
- Remoção completa dos dados pessoais do sistema
- Confirmação de que não receberá mais comunicações
- Prazo de processamento: até 15 dias úteis
- Direito do titular conforme art. 16 da LGPD`,

        'liberacao-chave-pix': `
🔹 LIBERAÇÃO DE CHAVE PIX:
- Processo de desvinculação da chave PIX conforme CCB
- Verificação de quitação da operação
- Liberação para uso em outras instituições
- Conformidade com regulamentação do Banco Central
- Prazo de processamento: até 2 dias úteis`,

        'antecipacao-restituicao': `
🔹 ANTECIPAÇÃO DE RESTITUIÇÃO:
- Operação baseada em Cédula de Crédito Bancário (CCB)
- Análise de elegibilidade conforme Receita Federal
- Processamento conforme regulamentação do Banco Central
- Transparência total nos custos e prazos
- Garantia de legalidade da operação`,

        'quitação-antecipada': `
🔹 QUITAÇÃO ANTECIPADA:
- Direito do cliente conforme CCB
- Cálculo de juros proporcionais
- Processamento conforme regulamentação
- Transparência nos valores e prazos
- Conformidade com normas do Banco Central`,

        'esclarecimento': `
🔹 ESCLARECIMENTO:
- Esclarecimento completo sobre a operação
- Transparência nos processos e prazos
- Explicação técnica da antecipação de restituição
- Conformidade com regulamentação aplicável
- Compromisso com a clareza e transparência`
    };

    return contextos[tipoSolicitacao] || `
🔹 SOLICITAÇÃO GERAL:
- Análise específica do caso apresentado
- Aplicação das melhores práticas da Velotax
- Conformidade com regulamentação aplicável
- Transparência e compromisso com a satisfação
- Especialização em antecipação de restituição`;
}

// Reformular script com conhecimento da planilha
function reformularComConhecimento(scriptPadrao, dadosPlanilha, dadosFormulario) {
    let promptFinal = scriptPadrao;
    
    // Filtrar modelos com resposta válida primeiro
    const modelosComResposta = dadosPlanilha?.modelosCoerentes?.filter(modelo => {
        const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
        return resposta && resposta.trim().length > 0;
    }) || [];
    
    if (dadosPlanilha && (modelosComResposta.length > 0 || dadosPlanilha.feedbacksRelevantes?.length > 0)) {
        promptFinal += '\n\n🧠 CONHECIMENTO APLICADO DA BASE DE APRENDIZADO:\n';
        promptFinal += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        
        if (modelosComResposta.length > 0) {
            promptFinal += '\n✅ MODELOS DE RESPOSTAS APROVADAS (siga estes padrões):\n\n';
            promptFinal += `📊 Total de ${modelosComResposta.length} modelos aprovados para referência:\n\n`;
            
            modelosComResposta.slice(0, 5).forEach((modelo, index) => {
                const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
                if (!resposta || resposta.trim().length === 0) {
                    return; // Pular modelos sem resposta
                }
                
                promptFinal += `━━━ MODELO ${index + 1} ━━━\n`;
                promptFinal += `📋 Tipo: ${modelo['Tipo Solicitação'] || modelo.dadosFormulario?.tipo_solicitacao || 'N/A'}\n`;
                promptFinal += `🎯 Motivo: ${modelo['Motivo Solicitação'] || modelo.dadosFormulario?.motivo_solicitacao || 'N/A'}\n`;
                promptFinal += `📝 Texto do Cliente: ${modelo['Texto Cliente'] || modelo.dadosFormulario?.texto_cliente || 'N/A'}\n`;
                promptFinal += `\n✅ RESPOSTA APROVADA (use como referência de qualidade):\n`;
                promptFinal += `${resposta}\n`;
                promptFinal += `\n💡 Solução Implementada: ${modelo['Solução Implementada'] || modelo.dadosFormulario?.solucao_implementada || 'N/A'}\n`;
                promptFinal += `📜 Histórico: ${modelo['Histórico Atendimento'] || modelo.dadosFormulario?.historico_atendimento || 'N/A'}\n`;
                promptFinal += `\n`;
            });
            
            promptFinal += '\n🎯 INSTRUÇÃO: Analise cuidadosamente estas respostas aprovadas. Observe:\n';
            promptFinal += '   - A estrutura e organização do texto\n';
            promptFinal += '   - O tom profissional e empático usado\n';
            promptFinal += '   - Como integram a solução implementada com o problema do cliente\n';
            promptFinal += '   - As referências legais (CCB, LGPD) quando aplicáveis\n';
            promptFinal += '   - A personalização para cada caso específico\n\n';
        }
        
        // Adicionar feedbacks relevantes COMPLETOS
        if (dadosPlanilha.feedbacksRelevantes?.length > 0) {
            promptFinal += '\n⚠️ FEEDBACKS DE CORREÇÃO (aprenda com estes erros):\n\n';
            promptFinal += `📊 Total de ${dadosPlanilha.feedbacksRelevantes.length} feedbacks para evitar erros:\n\n`;
            
            dadosPlanilha.feedbacksRelevantes.slice(0, 5).forEach((feedback, index) => {
                promptFinal += `━━━ FEEDBACK ${index + 1} ━━━\n`;
                promptFinal += `❌ ERRO IDENTIFICADO:\n${feedback.feedback || feedback.Feedback || 'N/A'}\n\n`;
                promptFinal += `📝 RESPOSTA ORIGINAL (com problema):\n${feedback.respostaAnterior || feedback['Resposta Anterior'] || 'N/A'}\n\n`;
                promptFinal += `✅ RESPOSTA CORRIGIDA (use como referência):\n${feedback.respostaReformulada || feedback['Resposta Reformulada'] || 'N/A'}\n`;
                promptFinal += `\n`;
            });
            
            promptFinal += '\n🎯 INSTRUÇÃO: Evite cometer os mesmos erros identificados nos feedbacks acima.\n';
            promptFinal += '   - Não seja genérico - seja específico para o caso\n';
            promptFinal += '   - Não ignore a solução implementada - explique como ela resolve o problema\n';
            promptFinal += '   - Não use linguagem muito técnica ou muito informal\n';
            promptFinal += '   - Não deixe de mencionar aspectos legais quando relevante\n\n';
        }
        
        promptFinal += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        promptFinal += '\n🎯 INSTRUÇÃO CRÍTICA FINAL:\n';
        promptFinal += 'Use TODA a base de conhecimento acima para gerar uma resposta de ALTA QUALIDADE desde o início.\n';
        promptFinal += 'Siga os padrões das respostas aprovadas e evite os erros dos feedbacks.\n';
        promptFinal += 'Sua resposta deve ser TÃO BOA QUANTO as respostas aprovadas mostradas acima.\n';
        promptFinal += 'Não gere uma resposta genérica - use os dados específicos fornecidos e o conhecimento da base.\n\n';
    } else {
        console.log('⚠️ AVISO: Nenhum conhecimento da base de aprendizado disponível');
        promptFinal += '\n\n⚠️ AVISO: Gerando resposta sem base de aprendizado. Siga rigorosamente o script padrão.\n\n';
    }
    
    return promptFinal;
}

// Carregar dados completos de aprendizado da planilha
async function carregarDadosAprendizadoCompleto(tipoSolicitacao) {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        throw new Error('Google Sheets não está ativo');
    }

    try {
        console.log(`🧠 SISTEMA DE APRENDIZADO: Carregando dados completos para "${tipoSolicitacao}"`);
        
        // Aguardar para evitar quota (controle de rate limiting)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Carregar modelos coerentes da planilha
        const modelosCoerentes = await carregarModelosCoerentesDaPlanilha(tipoSolicitacao);
        
        // Aguardar para evitar quota
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Carregar feedbacks relevantes da planilha
        const feedbacksRelevantes = await carregarFeedbacksRelevantesDaPlanilha(tipoSolicitacao);
        
        // Aguardar para evitar quota
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Carregar moderações coerentes da planilha
        const moderacoesCoerentes = await carregarModeracoesCoerentesDaPlanilha();
        
        // Aguardar para evitar quota
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Carregar feedbacks de moderação da planilha
        const feedbacksModeracoes = await carregarFeedbacksModeracoesDaPlanilha();
        
        return {
            modelosCoerentes,
            feedbacksRelevantes,
            moderacoesCoerentes,
            feedbacksModeracoes,
            fonte: 'planilha',
            timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        };
        
    } catch (error) {
        console.error('❌ Erro ao carregar dados completos de aprendizado:', error.message);
        throw error;
    }
}

// Carregar dados de aprendizado locais (fallback)
async function carregarDadosAprendizadoLocal(tipoSolicitacao) {
    try {
        console.log(`🧠 SISTEMA DE APRENDIZADO: Carregando dados locais para "${tipoSolicitacao}"`);
        
        const feedbacksRespostasLocal = await loadFeedbacksRespostas();
        const modelosRespostasLocal = await loadModelosRespostas();
        
        console.log('🔍 DEBUG - Dados locais carregados:', {
            totalModelos: modelosRespostasLocal?.modelos?.length || 0,
            totalFeedbacks: feedbacksRespostasLocal?.respostas?.length || 0
        });
        
        const modelosCoerentes = modelosRespostasLocal?.modelos?.filter(modelo => 
            modelo.dadosFormulario?.tipo_solicitacao?.toLowerCase().includes(tipoSolicitacao.toLowerCase())
        ) || [];
        
        const feedbacksRelevantes = feedbacksRespostasLocal?.respostas?.filter(fb => 
            fb.dadosFormulario?.tipo_solicitacao?.toLowerCase().includes(tipoSolicitacao.toLowerCase()) ||
            fb.contexto?.tipoSituacao?.toLowerCase().includes(tipoSolicitacao.toLowerCase())
        ) || [];
        
        console.log('🔍 DEBUG - Dados filtrados:', {
            modelosCoerentes: modelosCoerentes.length,
            feedbacksRelevantes: feedbacksRelevantes.length,
            modelosEncontrados: modelosCoerentes.map(m => ({
                tipo: m.dadosFormulario?.tipo_solicitacao,
                id: m.id
            }))
        });
        
        return {
            modelosCoerentes,
            feedbacksRelevantes,
            fonte: 'local',
            timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        };
        
    } catch (error) {
        console.error('❌ Erro ao carregar dados locais de aprendizado:', error.message);
        return {
            modelosCoerentes: [],
            feedbacksRelevantes: [],
            fonte: 'erro',
            timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        };
    }
}

// Carregar modelos coerentes da planilha
async function carregarModelosCoerentesDaPlanilha(tipoSolicitacao) {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        console.log('⚠️ Google Sheets não está ativo. Não é possível carregar modelos da planilha.');
        return [];
    }

    try {
        console.log(`📋 Carregando modelos coerentes da planilha para: ${tipoSolicitacao}`);
        
        // Usar a integração do Google Sheets em vez de acessar diretamente
        const todosModelos = await googleSheetsIntegration.obterModelosRespostas();
        
        if (!todosModelos || todosModelos.length === 0) {
            console.log('📋 Nenhum modelo coerente encontrado na planilha');
            return [];
        }
        
        // Filtrar modelos relevantes para o tipo de solicitação E que tenham resposta aprovada
        const modelos = todosModelos.filter(modelo => {
            const tipoSituacao = modelo['Tipo Solicitação'] || modelo.tipo_situacao || '';
            const temResposta = !!(modelo['Resposta Aprovada'] || modelo.respostaAprovada);
            const respostaValida = (modelo['Resposta Aprovada'] || modelo.respostaAprovada || '').trim().length > 0;
            
            return tipoSituacao.toLowerCase().includes(tipoSolicitacao.toLowerCase()) && temResposta && respostaValida;
        });
        
        console.log(`✅ Carregados ${modelos.length} modelos coerentes da planilha (com resposta válida)`);
        return modelos;
        
    } catch (error) {
        console.error('❌ Erro ao carregar modelos coerentes da planilha:', error.message);
        return [];
    }
}

// Carregar moderações coerentes da planilha
async function carregarModeracoesCoerentesDaPlanilha() {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        console.log('⚠️ Google Sheets não está ativo. Não é possível carregar moderações da planilha.');
        return [];
    }

    try {
        console.log('📋 Carregando moderações coerentes da planilha...');
        
        // Usar a integração do Google Sheets
        const todasModeracoes = await googleSheetsIntegration.obterModeracoesCoerentes();
        
        if (!todasModeracoes || todasModeracoes.length === 0) {
            console.log('📋 Nenhuma moderação coerente encontrada na planilha');
            return [];
        }
        
        console.log(`📋 ${todasModeracoes.length} moderações coerentes carregadas da planilha`);
        return todasModeracoes;
        
    } catch (error) {
        console.error('❌ Erro ao carregar moderações coerentes da planilha:', error.message);
        return [];
    }
}

// Carregar feedbacks de moderação da planilha
async function carregarFeedbacksModeracoesDaPlanilha() {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        console.log('⚠️ Google Sheets não está ativo. Não é possível carregar feedbacks de moderação da planilha.');
        return [];
    }

    try {
        console.log('📋 Carregando feedbacks de moderação da planilha...');
        
        // Usar a integração do Google Sheets
        const todosFeedbacks = await googleSheetsIntegration.obterFeedbacksModeracoes();
        
        if (!todosFeedbacks || todosFeedbacks.length === 0) {
            console.log('📋 Nenhum feedback de moderação encontrado na planilha');
            return [];
        }
        
        console.log(`📋 ${todosFeedbacks.length} feedbacks de moderação carregados da planilha`);
        return todosFeedbacks;
        
    } catch (error) {
        console.error('❌ Erro ao carregar feedbacks de moderação da planilha:', error.message);
        return [];
    }
}

// Carregar feedbacks relevantes da planilha
async function carregarFeedbacksRelevantesDaPlanilha(tipoSolicitacao) {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        console.log('⚠️ Google Sheets não está ativo. Não é possível carregar feedbacks da planilha.');
        return [];
    }

    try {
        console.log(`💬 Carregando feedbacks relevantes da planilha para: ${tipoSolicitacao}`);
        
        // Usar a integração do Google Sheets em vez de acessar diretamente
        const todosFeedbacks = await googleSheetsIntegration.obterFeedbacksRespostas();
        
        if (!todosFeedbacks || todosFeedbacks.length === 0) {
            console.log('💬 Nenhum feedback encontrado na planilha');
            return [];
        }
        
        // Filtrar feedbacks relevantes para o tipo de solicitação
        const feedbacks = todosFeedbacks.filter(feedback => {
            const tipoSituacao = feedback['Tipo Solicitação'] || feedback.tipoSituacao || '';
            return tipoSituacao.toLowerCase().includes(tipoSolicitacao.toLowerCase());
        });
        
        console.log(`✅ Carregados ${feedbacks.length} feedbacks relevantes da planilha`);
        return feedbacks;
        
    } catch (error) {
        console.error('❌ Erro ao carregar feedbacks da planilha:', error.message);
        return [];
    }
}

// ===== FUNÇÕES PARA CARREGAR MODELOS DA PLANILHA =====

// Carregar modelos da planilha para aprendizado (função antiga - mantida para compatibilidade)
async function carregarModelosDaPlanilha(tipoSolicitacao) {
    if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
        console.log('⚠️ Google Sheets não está ativo. Não é possível carregar modelos da planilha.');
        return [];
    }

    try {
        console.log(`📚 Carregando modelos da planilha para: ${tipoSolicitacao}`);
        
        // Usar a integração do Google Sheets em vez de acessar diretamente
        const todosModelos = await googleSheetsIntegration.obterModelosRespostas();
        
        if (!todosModelos || todosModelos.length === 0) {
            console.log('📚 Nenhum modelo encontrado na planilha');
            return [];
        }
        
        // Filtrar modelos relevantes para o tipo de solicitação
        const modelos = todosModelos.filter(modelo => {
            const tipoSituacao = modelo['Tipo Solicitação'] || modelo.tipo_situacao || '';
            return tipoSituacao.toLowerCase().includes(tipoSolicitacao.toLowerCase());
        });
        
        console.log(`✅ Carregados ${modelos.length} modelos relevantes da planilha`);
        return modelos;
        
    } catch (error) {
        console.error('❌ Erro ao carregar modelos da planilha:', error.message);
        return [];
    }
}

// ===== FUNÇÕES PARA MODELOS DE RESPOSTAS APROVADAS =====

// Carregar modelos de respostas
async function loadModelosRespostas() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && modelosRespostasMemoria) {
        console.log('🌐 Vercel detectado - carregando da memória');
        return modelosRespostasMemoria;
    }
    
    try {
        if (fs.existsSync(MODELOS_RESPOSTAS_FILE)) {
            const data = fs.readFileSync(MODELOS_RESPOSTAS_FILE, 'utf8');
            
            // Verificar se o arquivo não está vazio
            if (!data.trim()) {
                console.log('Arquivo modelos_respostas.json está vazio, criando estrutura padrão');
                const estruturaPadrao = {
                    modelos: [],
                    lastUpdated: obterTimestampBrasil(),
                    descricao: "Modelos de respostas aprovadas como coerentes - utilizados para aprendizado automático"
                };
                await saveModelosRespostas(estruturaPadrao);
                return estruturaPadrao;
            }
            
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar modelos de respostas:', error);
        console.log('Recriando arquivo modelos_respostas.json com estrutura padrão');
        
        // Recriar arquivo com estrutura padrão
        const estruturaPadrao = {
            modelos: [],
            lastUpdated: obterTimestampBrasil(),
            descricao: "Modelos de respostas aprovadas como coerentes - utilizados para aprendizado automático"
        };
        
        try {
            await saveModelosRespostas(estruturaPadrao);
        } catch (saveError) {
            console.error('Erro ao recriar arquivo modelos_respostas.json:', saveError);
        }
        
        return estruturaPadrao;
    }
    return {
        modelos: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Armazenamento em memória para Vercel
let modelosRespostasMemoria = null;
let estatisticasGlobaisMemoria = null;
let aprendizadoScriptMemoria = {
    tiposSituacao: {},
    lastUpdated: null
};
let feedbacksRespostasMemoria = null;
let feedbacksModeracoesMemoria = null;

// Inicializar memória do aprendizado no startup
async function inicializarMemoriaAprendizado() {
    try {
        console.log('🔄 Inicializando memória do aprendizado...');
        const aprendizado = await loadAprendizadoScript();
        if (aprendizado && aprendizado.tiposSituacao) {
            aprendizadoScriptMemoria = aprendizado;
            console.log('✅ Memória do aprendizado inicializada:', {
                tiposSituacao: Object.keys(aprendizado.tiposSituacao),
                totalTipos: Object.keys(aprendizado.tiposSituacao).length
            });
        } else {
            console.log('⚠️ Nenhum aprendizado encontrado para inicializar');
        }
    } catch (error) {
        console.error('❌ Erro ao inicializar memória do aprendizado:', error);
    }
}
let feedbacksExplicacoesMemoria = null;
let modelosModeracoesMemoria = null;

// Salvar modelos de respostas
async function saveModelosRespostas(modelos) {
    try {
        // Validar estrutura antes de salvar
        if (!modelos || typeof modelos !== 'object') {
            throw new Error('Estrutura de modelos inválida');
        }
        
        if (!Array.isArray(modelos.modelos)) {
            modelos.modelos = [];
        }
        
        // Atualizar timestamp
        modelos.lastUpdated = obterTimestampBrasil();
        
        // Salvar baseado no ambiente
        const isVercel = process.env.VERCEL;
        const isProduction = process.env.NODE_ENV === 'production';
        const isLocalhost = process.env.HOSTNAME === 'localhost' || process.env.HOSTNAME === '127.0.0.1' || !process.env.HOSTNAME;
        
        console.log('🔍 Detecção de ambiente:', { isVercel, isProduction, isLocalhost });
        
        if (isVercel || (isProduction && !isLocalhost)) {
            // Vercel: memória + tentar salvar em arquivo temporário
            console.log('🌐 Vercel - salvando em memória e tentando arquivo temporário');
            modelosRespostasMemoria = modelos;
            console.log('✅ Modelos de respostas salvos em memória:', modelos.modelos.length);
            
            // Tentar salvar em arquivo temporário (pode funcionar em alguns casos)
            try {
                const tempFile = '/tmp/modelos_respostas.json';
                fs.writeFileSync(tempFile, JSON.stringify(modelos, null, 2));
                console.log('✅ Modelos também salvos em arquivo temporário:', tempFile);
            } catch (tempError) {
                console.log('⚠️ Não foi possível salvar arquivo temporário (normal na Vercel)');
            }
        } else {
            // Desenvolvimento local: arquivo JSON
            console.log('💻 Desenvolvimento local - salvando no arquivo:', MODELOS_RESPOSTAS_FILE);
            try {
                const dir = path.dirname(MODELOS_RESPOSTAS_FILE);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // Escrever arquivo temporário primeiro
                const tempFile = MODELOS_RESPOSTAS_FILE + '.tmp';
                fs.writeFileSync(tempFile, JSON.stringify(modelos, null, 2), 'utf8');
                
                // Mover arquivo temporário para o arquivo final (operação atômica)
                fs.renameSync(tempFile, MODELOS_RESPOSTAS_FILE);
                
                console.log('✅ Modelos de respostas salvos no arquivo:', MODELOS_RESPOSTAS_FILE, '- Total:', modelos.modelos.length);
            } catch (fileError) {
                console.log('❌ ERRO ao salvar no arquivo:', fileError.message);
                // Fallback para memória
                modelosRespostasMemoria = modelos;
                console.log('✅ Modelos de respostas salvos em memória (fallback)');
            }
        }
        
        // NOTA: Registro no Google Sheets é feito apenas quando uma nova resposta é marcada como coerente
        // Para evitar registrar toda a fila de modelos existentes
    } catch (error) {
        console.error('❌ Erro ao salvar modelos de respostas:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            modelosRespostasMemoria = modelos;
        }
        
        // Tentar remover arquivo temporário se existir
        try {
            const tempFile = MODELOS_RESPOSTAS_FILE + '.tmp';
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (cleanupError) {
            console.error('Erro ao limpar arquivo temporário:', cleanupError);
        }
    }
}

// Adicionar modelo de resposta aprovada
async function addModeloResposta(dadosFormulario, respostaAprovada, userData = null) {
    console.log('🚀 FUNÇÃO addModeloResposta INICIADA!');
    console.log('📝 Dados recebidos:', {
        tipo_solicitacao: dadosFormulario.tipo_solicitacao,
        id_reclamacao: dadosFormulario.id_reclamacao,
        resposta_length: respostaAprovada ? respostaAprovada.length : 0,
        userData: userData ? `${userData.nome} (${userData.email})` : 'N/A'
    });
    
    const modelos = await loadModelosRespostas();
    console.log('📚 Modelos carregados:', modelos.modelos ? modelos.modelos.length : 0);
    
    const novoModelo = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo_situacao: dadosFormulario.tipo_solicitacao,
        id_reclamacao: dadosFormulario.id_reclamacao,
        dadosFormulario: dadosFormulario,
        respostaAprovada: respostaAprovada,
        userData: userData, // Incluir dados do usuário
        contexto: {
            tipoSituacao: dadosFormulario.tipo_solicitacao,
            idReclamacao: dadosFormulario.id_reclamacao
        }
    };
    
    console.log('🆕 Novo modelo criado com ID:', novoModelo.id);
    
    modelos.modelos.push(novoModelo);
    console.log('📝 Modelo adicionado ao array. Total agora:', modelos.modelos.length);
    
    // Registrar APENAS a nova resposta no Google Sheets (não toda a fila)
    if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        try {
            const respostaData = {
                id: novoModelo.id,
                tipo: 'resposta',
                tipoSituacao: novoModelo.tipo_situacao || 'N/A',
                idReclamacao: novoModelo.id_reclamacao || 'N/A',
                respostaAprovada: novoModelo.respostaAprovada || 'N/A',
                dadosFormulario: novoModelo.dadosFormulario || {},
                timestamp: novoModelo.timestamp,
                userProfile: novoModelo.userData ? `${novoModelo.userData.nome} (${novoModelo.userData.email})` : 'N/A',
                userName: novoModelo.userData?.nome || 'N/A',
                userEmail: novoModelo.userData?.email || 'N/A'
            };
            await googleSheetsQueue.addToQueue({ type: 'resposta_coerente', data: respostaData }, true); // true = instantâneo
            console.log('✅ NOVA resposta coerente registrada INSTANTANEAMENTE no Google Sheets (ID:', novoModelo.id, ')');
        } catch (error) {
            console.error('❌ Erro ao registrar nova resposta coerente no Google Sheets:', error.message);
        }
    }
    
    console.log('💾 Chamando saveModelosRespostas...');
    await saveModelosRespostas(modelos);
    console.log('✅ saveModelosRespostas concluído');
    
    // Também adicionar ao aprendizado direto do script
    console.log('🧠 Adicionando ao aprendizado do script...');
    await addRespostaCoerenteAprendizado(dadosFormulario.tipo_solicitacao, dadosFormulario.id_reclamacao, respostaAprovada, dadosFormulario, userData);
    console.log('✅ Aprendizado do script concluído');
    
    // IMPORTANTE: Se houve feedback anterior, salvar também no aprendizado
    if (dadosFormulario.feedback_anterior && dadosFormulario.resposta_anterior) {
        console.log('🧠 Salvando feedback anterior no aprendizado...');
        await addFeedbackAprendizado(
            dadosFormulario.tipo_solicitacao,
            dadosFormulario.feedback_anterior,
            respostaAprovada,
            dadosFormulario.resposta_anterior,
            userData
        );
        console.log('✅ Feedback anterior salvo no aprendizado');
    }
    
    console.log('📝 Modelo de resposta aprovada adicionado:', novoModelo.id);
    return novoModelo;
}

// Obter modelos relevantes para um tipo de situação
async function getModelosRelevantes(tipoSituacao, motivoSolicitacao) {
    const modelos = await loadModelosRespostas();
    const relevantes = [];
    
    modelos.modelos.forEach(modelo => {
        let isRelevante = false;
        
        // Verificar correspondência exata de tipo de situação
        if (modelo.tipo_situacao && modelo.tipo_situacao.toLowerCase() === tipoSituacao.toLowerCase()) {
            isRelevante = true;
        }
        
        // Verificar correspondência de motivo da solicitação
        if (modelo.motivo_solicitacao && motivoSolicitacao) {
            if (modelo.motivo_solicitacao.toLowerCase().includes(motivoSolicitacao.toLowerCase()) ||
                motivoSolicitacao.toLowerCase().includes(modelo.motivo_solicitacao.toLowerCase())) {
                isRelevante = true;
            }
        }
        
        if (isRelevante) {
            relevantes.push(modelo);
        }
    });
    
    // Ordenar por timestamp mais recente e retornar os últimos 3
    return relevantes
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 3);
}

// ===== FUNÇÕES PARA MODELOS DE MODERAÇÕES APROVADAS =====

// Carregar modelos de moderações
async function loadModelosModeracoes() {
    // Verificar se estamos no Vercel e temos dados em memória
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && modelosModeracoesMemoria) {
        console.log('🌐 Vercel detectado - carregando modelos de moderações da memória');
        return modelosModeracoesMemoria;
    }
    
    try {
        if (fs.existsSync(MODELOS_MODERACOES_FILE)) {
            const data = fs.readFileSync(MODELOS_MODERACOES_FILE, 'utf8');
            
            // Verificar se o arquivo não está vazio
            if (!data.trim()) {
                console.log('Arquivo modelos_moderacoes.json está vazio, criando estrutura padrão');
                const estruturaPadrao = {
                    modelos: [],
                    lastUpdated: obterTimestampBrasil(),
                    descricao: "Modelos de moderações aprovadas como coerentes - utilizados para aprendizado automático"
                };
                await saveModelosModeracoes(estruturaPadrao);
                return estruturaPadrao;
            }
            
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar modelos de moderações:', error);
        console.log('Recriando arquivo modelos_moderacoes.json com estrutura padrão');
        
        // Recriar arquivo com estrutura padrão
        const estruturaPadrao = {
            modelos: [],
            lastUpdated: obterTimestampBrasil(),
            descricao: "Modelos de moderações aprovadas como coerentes - utilizados para aprendizado automático"
        };
        
        try {
            await saveModelosModeracoes(estruturaPadrao);
        } catch (saveError) {
            console.error('Erro ao recriar arquivo modelos_moderacoes.json:', saveError);
        }
        
        return estruturaPadrao;
    }
    return {
        modelos: [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar modelos de moderações
async function saveModelosModeracoes(modelos) {
    try {
        // Validar estrutura antes de salvar
        if (!modelos || typeof modelos !== 'object') {
            throw new Error('Estrutura de modelos inválida');
        }
        
        if (!Array.isArray(modelos.modelos)) {
            modelos.modelos = [];
        }
        
        // Atualizar timestamp
        modelos.lastUpdated = obterTimestampBrasil();
        
        // Verificar se estamos no Vercel (sistema de arquivos somente leitura)
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            console.log('🌐 Vercel detectado - salvando modelos de moderações em memória');
            modelosModeracoesMemoria = modelos;
            console.log('📝 Modelos de moderações salvos em memória:', modelos.modelos.length);
            return;
        }
        
        // Desenvolvimento local - usar sistema de arquivos
        const dir = path.dirname(MODELOS_MODERACOES_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Escrever arquivo temporário primeiro
        const tempFile = MODELOS_MODERACOES_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(modelos, null, 2), 'utf8');
        
        // Mover arquivo temporário para o arquivo final (operação atômica)
        fs.renameSync(tempFile, MODELOS_MODERACOES_FILE);
        
        console.log('📝 Modelos de moderações salvos no arquivo:', MODELOS_MODERACOES_FILE, '- Total:', modelos.modelos.length);
    } catch (error) {
        console.error('Erro ao salvar modelos de moderações:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            modelosModeracoesMemoria = modelos;
        }
        
        // Tentar remover arquivo temporário se existir
        try {
            const tempFile = MODELOS_MODERACOES_FILE + '.tmp';
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (cleanupError) {
            console.error('Erro ao limpar arquivo temporário:', cleanupError);
        }
    }
}

// Adicionar modelo de moderação aprovada
async function addModeloModeracao(dadosModeracao, linhaRaciocinio, textoModeracao) {
    const modelos = await loadModelosModeracoes();
    
    const novoModelo = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        motivoModeracao: dadosModeracao.motivoModeracao,
        dadosModeracao: dadosModeracao,
        linhaRaciocinio: linhaRaciocinio,
        textoModeracao: textoModeracao,
        contexto: {
            motivoModeracao: dadosModeracao.motivoModeracao,
            solicitacaoCliente: dadosModeracao.solicitacaoCliente,
            respostaEmpresa: dadosModeracao.respostaEmpresa,
            consideracaoFinal: dadosModeracao.consideracaoFinal
        }
    };
    
    modelos.modelos.push(novoModelo);
    modelos.lastUpdated = obterTimestampBrasil();
    
    await saveModelosModeracoes(modelos);
    console.log('📝 Modelo de moderação aprovada adicionado:', novoModelo.id);
    return novoModelo;
}

// Obter modelos de moderação relevantes - VERSÃO MELHORADA
async function getModelosModeracaoRelevantes(motivoModeracao, dadosModeracao = null) {
    const modelos = await loadModelosModeracoes();
    const relevantes = [];
    
    modelos.modelos.forEach(modelo => {
        let score = 0;
        let isRelevante = false;
        
        // 1. Correspondência exata de motivo de moderação
        if (modelo.motivoModeracao && motivoModeracao) {
            if (modelo.motivoModeracao.toLowerCase() === motivoModeracao.toLowerCase()) {
                score += 5; // Máxima relevância
                isRelevante = true;
            } else if (modelo.motivoModeracao.toLowerCase().includes(motivoModeracao.toLowerCase()) ||
                      motivoModeracao.toLowerCase().includes(modelo.motivoModeracao.toLowerCase())) {
                score += 3;
                isRelevante = true;
            }
        }
        
        // 2. Análise de contexto similar se dados disponíveis
        if (dadosModeracao && modelo.dadosModeracao) {
            const modeloDados = modelo.dadosModeracao;
            const contextoDados = dadosModeracao;
            
            // Verificar similaridade na solicitação do cliente
            if (modeloDados.solicitacaoCliente && contextoDados.solicitacaoCliente) {
                const similaridade = calcularSimilaridade(
                    modeloDados.solicitacaoCliente.toLowerCase(),
                    contextoDados.solicitacaoCliente.toLowerCase()
                );
                if (similaridade > 0.3) {
                    score += 2;
                    isRelevante = true;
                }
            }
            
            // Verificar similaridade na resposta da empresa
            if (modeloDados.respostaEmpresa && contextoDados.respostaEmpresa) {
                const similaridade = calcularSimilaridade(
                    modeloDados.respostaEmpresa.toLowerCase(),
                    contextoDados.respostaEmpresa.toLowerCase()
                );
                if (similaridade > 0.3) {
                    score += 2;
                    isRelevante = true;
                }
            }
            
            // Verificar similaridade na consideração final
            if (modeloDados.consideracaoFinal && contextoDados.consideracaoFinal) {
                const similaridade = calcularSimilaridade(
                    modeloDados.consideracaoFinal.toLowerCase(),
                    contextoDados.consideracaoFinal.toLowerCase()
                );
                if (similaridade > 0.3) {
                    score += 1;
                    isRelevante = true;
                }
            }
        }
        
        // 3. Busca por palavras-chave específicas de moderação
        if (modelo.textoModeracao && dadosModeracao) {
            const textoModelo = modelo.textoModeracao.toLowerCase();
            const contextoTexto = (dadosModeracao.solicitacaoCliente + ' ' + 
                                 dadosModeracao.respostaEmpresa + ' ' + 
                                 dadosModeracao.consideracaoFinal).toLowerCase();
            
            const palavrasModeracao = ['pix', 'portabilidade', 'quitação', 'restituição', 'ccb', 'contrato', 'manual'];
            const temPalavraModeracao = palavrasModeracao.some(palavra => 
                textoModelo.includes(palavra) && contextoTexto.includes(palavra)
            );
            
            if (temPalavraModeracao) {
                score += 1;
                isRelevante = true;
            }
        }
        
        // 4. Verificar qualidade do modelo (texto bem estruturado)
        if (modelo.textoModeracao && modelo.textoModeracao.length > 200) {
            const temEstrutura = modelo.textoModeracao.includes('Prezados') && 
                                modelo.textoModeracao.includes('conforme') &&
                                modelo.textoModeracao.includes('solicitamos');
            if (temEstrutura) {
                score += 1;
            }
        }
        
        if (isRelevante) {
            modelo.relevanceScore = score;
            relevantes.push(modelo);
        }
    });
    
    // Ordenar por score de relevância e timestamp, retornar os mais relevantes
    return relevantes
        .sort((a, b) => {
            // Primeiro por score de relevância (maior primeiro)
            if (b.relevanceScore !== a.relevanceScore) {
                return b.relevanceScore - a.relevanceScore;
            }
            // Depois por timestamp mais recente
            return new Date(b.timestamp) - new Date(a.timestamp);
        })
        .slice(0, 5); // Aumentar para 5 modelos mais relevantes
}

// ===== FUNÇÕES PARA APRENDIZADO DIRETO NO SCRIPT DE FORMULAÇÃO =====

// Processar aprendizado obrigatório antes da geração de respostas
async function processarAprendizadoObrigatorio(dadosFormulario) {
    console.log('🎓 PROCESSAMENTO OBRIGATÓRIO DE APRENDIZADO INICIADO');
    console.log('📋 Dados recebidos:', {
        tipo_solicitacao: dadosFormulario.tipo_solicitacao,
        motivo_solicitacao: dadosFormulario.motivo_solicitacao
    });
    
    // 1. Carregar aprendizado da PLANILHA (não da memória)
    console.log('🧠 SISTEMA DE APRENDIZADO: Carregando dados da PLANILHA...');
    let aprendizadoScript = null;
    
    try {
        // Tentar carregar da planilha primeiro
        aprendizadoScript = await carregarDadosAprendizadoCompleto(dadosFormulario.tipo_solicitacao);
        console.log('✅ Aprendizado carregado da PLANILHA:', {
            modelosCoerentes: aprendizadoScript?.modelosCoerentes?.length || 0,
            feedbacksRelevantes: aprendizadoScript?.feedbacksRelevantes?.length || 0,
            fonte: aprendizadoScript?.fonte || 'desconhecida'
        });
    } catch (error) {
        console.log('⚠️ Erro ao carregar da planilha, usando fallback local:', error.message);
        // Fallback para dados locais se a planilha falhar
        aprendizadoScript = await carregarDadosAprendizadoLocal(dadosFormulario.tipo_solicitacao);
        console.log('✅ Aprendizado carregado do FALLBACK LOCAL:', {
            modelosCoerentes: aprendizadoScript?.modelosCoerentes?.length || 0,
            feedbacksRelevantes: aprendizadoScript?.feedbacksRelevantes?.length || 0,
            fonte: aprendizadoScript?.fonte || 'local'
        });
    }
    
    // 2. Verificar se há feedbacks contrários a cláusulas
    const temFeedbackContrario = aprendizadoScript?.feedbacksRelevantes?.some(fb => 
        (fb.feedback || fb.Feedback || '').toLowerCase().includes('não cite') || 
        (fb.feedback || fb.Feedback || '').toLowerCase().includes('nao cite') ||
        (fb.feedback || fb.Feedback || '').toLowerCase().includes('não use') ||
        (fb.feedback || fb.Feedback || '').toLowerCase().includes('nao use')
    );
    
    // 3. Processar padrões se necessário (apenas se não tiver dados da planilha)
    if (aprendizadoScript?.fonte === 'local' && aprendizadoScript?.feedbacksRelevantes?.length > 0) {
        console.log('🔍 Identificando padrões automaticamente...');
        await processarPadroesExistentes(dadosFormulario.tipo_solicitacao);
        // Recarregar aprendizado após identificar padrões
        const aprendizadoAtualizado = await getAprendizadoTipoSituacao(dadosFormulario.tipo_solicitacao);
        if (aprendizadoScript) {
            aprendizadoScript.padroesIdentificados = aprendizadoAtualizado.padroesIdentificados;
            aprendizadoScript.clausulasUsadas = aprendizadoAtualizado.clausulasUsadas;
        }
    }
    
    // 4. Construir instruções de aprendizado
    let instrucoesAprendizado = '';
    
    if (aprendizadoScript?.feedbacksRelevantes?.length > 0 || aprendizadoScript?.modelosCoerentes?.length > 0 || aprendizadoScript?.padroesIdentificados?.length > 0) {
        console.log('✅ APLICANDO APRENDIZADO OBRIGATÓRIO!');
        
        instrucoesAprendizado = '\n\n🎓 INSTRUÇÕES OBRIGATÓRIAS DE APRENDIZADO (BASEADAS EM FEEDBACKS REAIS):\n';
        instrucoesAprendizado += `Baseado em ${aprendizadoScript.feedbacksRelevantes?.length || 0} feedbacks e ${aprendizadoScript.modelosCoerentes?.length || 0} respostas aprovadas para "${dadosFormulario.tipo_solicitacao}":\n\n`;
        
        // Adicionar padrões identificados
        if (aprendizadoScript?.padroesIdentificados?.length > 0) {
            instrucoesAprendizado += '📋 PADRÕES OBRIGATÓRIOS (SEGUIR SEMPRE):\n';
            aprendizadoScript?.padroesIdentificados?.forEach((padrao, index) => {
                instrucoesAprendizado += `${index + 1}. ${padrao}\n`;
            });
            instrucoesAprendizado += '\n';
        }
        
        // Adicionar cláusulas APENAS se não houver feedbacks contrários
        if (aprendizadoScript?.clausulasUsadas?.length > 0 && !temFeedbackContrario) {
            instrucoesAprendizado += '⚖️ CLÁUSULAS CCB APLICÁVEIS:\n';
            aprendizadoScript?.clausulasUsadas?.forEach(clausula => {
                instrucoesAprendizado += `• ${clausula}\n`;
            });
            instrucoesAprendizado += '\n';
        } else if (temFeedbackContrario) {
            console.log('⚠️ Feedback contrário detectado - NÃO incluindo cláusulas CCB');
            instrucoesAprendizado += '⚠️ ATENÇÃO: NÃO cite cláusulas da CCB conforme feedbacks anteriores!\n\n';
        }
        
        // Adicionar feedbacks críticos (ERROS A EVITAR)
        if (aprendizadoScript?.feedbacks?.length > 0) {
            instrucoesAprendizado += '❌ ERROS CRÍTICOS A EVITAR (BASEADOS EM FEEDBACKS REAIS):\n';
            instrucoesAprendizado += 'IMPORTANTE: Estes são erros reais identificados pelo operador. NUNCA repita:\n\n';
            aprendizadoScript?.feedbacks?.slice(-5).forEach((fb, index) => {
                instrucoesAprendizado += `${index + 1}. ❌ ERRO: "${fb.feedback}"\n`;
                instrucoesAprendizado += `   ✅ CORREÇÃO: "${fb.respostaReformulada.substring(0, 200)}..."\n\n`;
            });
        }
        
        // Adicionar respostas aprovadas (MODELOS A SEGUIR)
        if (aprendizadoScript?.respostasCoerentes?.length > 0) {
            instrucoesAprendizado += '✅ MODELOS APROVADOS (SEGUIR ESTE PADRÃO):\n';
            aprendizadoScript?.respostasCoerentes?.slice(-3).forEach((resp, index) => {
                instrucoesAprendizado += `${index + 1}. 📋 Motivo: ${resp.motivoSolicitacao}\n`;
                instrucoesAprendizado += `   ✅ MODELO: "${resp.respostaAprovada?.substring(0, 250) || 'N/A'}..."\n\n`;
            });
        }
        
        instrucoesAprendizado += '🎯 INSTRUÇÃO FINAL: Use este aprendizado para gerar uma resposta de alta qualidade desde o início, aplicando os padrões e evitando os erros documentados.\n';
    } else {
        console.log('⚠️ Nenhum aprendizado disponível para este tipo de situação');
    }
    
    console.log('📊 Instruções de aprendizado construídas:', instrucoesAprendizado.length, 'caracteres');
    return instrucoesAprendizado;
}

// Carregar aprendizado do script
async function loadAprendizadoScript() {
    console.log('🔄 loadAprendizadoScript iniciada');
    console.log('🌍 Ambiente:', {
        vercel: !!process.env.VERCEL,
        nodeEnv: process.env.NODE_ENV,
        temMemoria: !!aprendizadoScriptMemoria
    });
    
    // Verificar se temos dados em memória (PRIORIDADE 1)
    if (aprendizadoScriptMemoria && aprendizadoScriptMemoria.tiposSituacao && Object.keys(aprendizadoScriptMemoria.tiposSituacao).length > 0) {
        console.log('🧠 Carregando aprendizado da memória');
        console.log('📊 Dados em memória:', {
            tiposSituacao: Object.keys(aprendizadoScriptMemoria.tiposSituacao || {}),
            totalTipos: Object.keys(aprendizadoScriptMemoria.tiposSituacao || {}).length
        });
        return aprendizadoScriptMemoria;
    }
    
    try {
        if (fs.existsSync(APRENDIZADO_SCRIPT_FILE)) {
            console.log('📁 Carregando aprendizado do arquivo:', APRENDIZADO_SCRIPT_FILE);
            const data = fs.readFileSync(APRENDIZADO_SCRIPT_FILE, 'utf8');
            const aprendizado = JSON.parse(data);
            console.log('📊 Aprendizado carregado do arquivo:', {
                tiposSituacao: Object.keys(aprendizado.tiposSituacao || {}),
                totalTipos: Object.keys(aprendizado.tiposSituacao || {}).length,
                lastUpdated: aprendizado.lastUpdated
            });
            
            // Atualizar memória com os dados carregados
            aprendizadoScriptMemoria = aprendizado;
            console.log('✅ Memória atualizada com dados do arquivo');
            
            return aprendizado;
        } else {
            console.log('⚠️ Arquivo de aprendizado não existe:', APRENDIZADO_SCRIPT_FILE);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar aprendizado do script:', error);
    }
    
    console.log('🆕 Retornando aprendizado vazio');
    return {
        tiposSituacao: {},
        lastUpdated: obterTimestampBrasil()
    };
}

// Salvar aprendizado do script
async function saveAprendizadoScript(aprendizado) {
    try {
        aprendizado.lastUpdated = obterTimestampBrasil();
        
    // Verificar se estamos no Vercel (sistema de arquivos somente leitura)
    const isVercel = process.env.VERCEL;
    const isProduction = process.env.NODE_ENV === 'production';
    const isLocalhost = process.env.HOSTNAME === 'localhost' || process.env.HOSTNAME === '127.0.0.1' || !process.env.HOSTNAME;
    
    console.log('🔍 Detecção de ambiente (aprendizado):', { isVercel, isProduction, isLocalhost });
    
    if (isVercel || (isProduction && !isLocalhost)) {
        console.log('🌐 Vercel detectado - salvando aprendizado em memória');
        aprendizadoScriptMemoria = aprendizado;
        
        // Tentar salvar em arquivo temporário (pode funcionar em alguns casos)
        try {
            const tempFile = '/tmp/aprendizado_script.json';
            fs.writeFileSync(tempFile, JSON.stringify(aprendizado, null, 2));
            console.log('✅ Aprendizado também salvo em arquivo temporário:', tempFile);
        } catch (tempError) {
            console.log('⚠️ Não foi possível salvar arquivo temporário (normal na Vercel)');
        }
        
        console.log('✅ Aprendizado do script salvo em memória');
        return;
    }
        
        // Desenvolvimento local - usar sistema de arquivos
        fs.writeFileSync(APRENDIZADO_SCRIPT_FILE, JSON.stringify(aprendizado, null, 2));
        console.log('✅ Aprendizado do script salvo no arquivo');
    } catch (error) {
        console.error('❌ Erro ao salvar aprendizado do script:', error);
        
        // Fallback para memória se arquivo falhar
        if (!process.env.VERCEL) {
            console.log('🔄 Fallback para memória devido ao erro de arquivo');
            aprendizadoScriptMemoria = aprendizado;
        }
    }
}

// Adicionar feedback ao aprendizado do script
async function addFeedbackAprendizado(tipoSituacao, feedback, respostaReformulada, respostaAnterior = null, userData = null) {
    console.log('🔄 addFeedbackAprendizado iniciada');
    console.log('📝 Dados recebidos:', {
        tipoSituacao,
        feedback: feedback?.substring(0, 100) + '...',
        respostaReformulada: respostaReformulada?.substring(0, 100) + '...',
        respostaAnterior: respostaAnterior?.substring(0, 100) + '...',
        userData: userData ? `${userData.nome} (${userData.email})` : 'N/A'
    });
    
    const aprendizado = await loadAprendizadoScript();
    console.log('📚 Aprendizado carregado para adicionar feedback:', {
        existe: !!aprendizado,
        temTiposSituacao: !!aprendizado.tiposSituacao,
        tiposExistentes: Object.keys(aprendizado.tiposSituacao || {})
    });
    
    if (!aprendizado.tiposSituacao[tipoSituacao]) {
        console.log('🆕 Criando novo tipo de situação:', tipoSituacao);
        aprendizado.tiposSituacao[tipoSituacao] = {
            feedbacks: [],
            respostasCoerentes: [],
            padroesIdentificados: [],
            clausulasUsadas: []
        };
    }
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        feedback: feedback,
        respostaReformulada: respostaReformulada,
        respostaAnterior: respostaAnterior
    };
    
    console.log('🆕 Novo feedback criado:', {
        id: novoFeedback.id,
        timestamp: novoFeedback.timestamp,
        feedbackLength: feedback?.length || 0
    });
    
    // Verificar qualidade do feedback antes de adicionar
    const qualidadeFeedback = verificarQualidadeFeedbackIndividual(novoFeedback);
    if (qualidadeFeedback.pontuacao < 30) {
        console.log(`⚠️ Feedback de baixa qualidade detectado (${qualidadeFeedback.pontuacao} pontos): ${tipoSituacao}`);
        console.log(`   Problemas: ${qualidadeFeedback.problemas.join(', ')}`);
    }
    
    aprendizado.tiposSituacao[tipoSituacao].feedbacks.push(novoFeedback);
    console.log('✅ Feedback adicionado ao array. Total agora:', aprendizado.tiposSituacao[tipoSituacao].feedbacks.length);
    
    // Manter apenas os últimos 10 feedbacks por tipo
    if (aprendizado.tiposSituacao[tipoSituacao].feedbacks.length > 10) {
        aprendizado.tiposSituacao[tipoSituacao].feedbacks = 
            aprendizado.tiposSituacao[tipoSituacao].feedbacks.slice(-10);
        console.log('✂️ Feedbacks limitados aos últimos 10');
    }
    
    // Identificar padrões automaticamente baseado no feedback
    console.log('🔍 Identificando padrões para:', tipoSituacao);
    await identificarPadroesAprendizado(tipoSituacao, '', respostaReformulada);
    
    console.log('💾 Salvando aprendizado...');
    await saveAprendizadoScript(aprendizado);
    console.log('✅ Aprendizado salvo com sucesso');
    
    // Registrar no Google Sheets se ativo
    if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        try {
            const feedbackData = {
                id: Date.now(),
                tipo: 'feedback',
                tipoSituacao: tipoSituacao,
                feedback: feedback,
                respostaReformulada: respostaReformulada,
                respostaAnterior: respostaAnterior,
                timestamp: obterTimestampBrasil(),
                userProfile: userData ? `${userData.nome} (${userData.email})` : 'N/A',
                userName: userData?.nome || 'N/A',
                userEmail: userData?.email || 'N/A'
            };
            await googleSheetsQueue.addToQueue({ type: 'feedback', data: feedbackData }, true); // true = instantâneo
            console.log('✅ Feedback registrado INSTANTANEAMENTE no Google Sheets (ID:', feedbackData.id, ')');
        } catch (error) {
            console.error('❌ Erro ao registrar feedback no Google Sheets:', error.message);
        }
    }
    
    console.log('📝 Feedback adicionado ao aprendizado do script:', tipoSituacao);
    console.log('👤 Usuário que enviou o feedback:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
}

// Adicionar resposta coerente ao aprendizado do script
async function addRespostaCoerenteAprendizado(tipoSituacao, idReclamacao, respostaAprovada, dadosFormulario, userData = null) {
    const aprendizado = await loadAprendizadoScript();
    
    if (!aprendizado.tiposSituacao[tipoSituacao]) {
        aprendizado.tiposSituacao[tipoSituacao] = {
            feedbacks: [],
            respostasCoerentes: [],
            padroesIdentificados: [],
            clausulasUsadas: []
        };
    }
    
    const novaResposta = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        idReclamacao: idReclamacao,
        respostaAprovada: respostaAprovada,
        dadosFormulario: dadosFormulario,
        userData: userData
    };
    
    aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.push(novaResposta);
    
    // Manter apenas as últimas 5 respostas coerentes por tipo
    if (aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.length > 5) {
        aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes = 
            aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.slice(-5);
    }
    
    // Identificar padrões automaticamente
    await identificarPadroesAprendizado(tipoSituacao, idReclamacao, respostaAprovada);
    
    await saveAprendizadoScript(aprendizado);
    
    // NOTA: Registro no Google Sheets é feito em saveModelosRespostas para evitar duplicação
    
    console.log('📝 Resposta coerente adicionada ao aprendizado do script:', tipoSituacao);
    console.log('👤 Usuário que marcou como coerente:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
}

// Identificar padrões automaticamente
async function identificarPadroesAprendizado(tipoSituacao, idReclamacao, respostaAprovada) {
    console.log('🔍 Identificando padrões para:', tipoSituacao);
    const aprendizado = await loadAprendizadoScript();
    
    if (!aprendizado || !aprendizado.tiposSituacao || !aprendizado.tiposSituacao[tipoSituacao]) {
        console.log('❌ Tipo de situação não encontrado:', tipoSituacao);
        return;
    }
    
    console.log('📊 Feedbacks disponíveis:', aprendizado.tiposSituacao[tipoSituacao].feedbacks.length);
    
    // Identificar cláusula CCB baseada no tipo de situação
    let clausulaIdentificada = '';
    if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade')) {
        clausulaIdentificada = 'Cláusula 7 - Vínculo da Chave Pix e Quitação Automática';
    } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação')) {
        clausulaIdentificada = 'Cláusula 8 - Liquidação Antecipada';
    } else if (tipoSituacao.toLowerCase().includes('inadimplência') || tipoSituacao.toLowerCase().includes('vencimento')) {
        clausulaIdentificada = 'Cláusula 10 - Inadimplência e Vencimento Antecipado';
    } else if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('dados')) {
        clausulaIdentificada = 'Cláusula 14 - Proteção de Dados (LGPD)';
    }
    
    if (clausulaIdentificada && !aprendizado.tiposSituacao[tipoSituacao].clausulasUsadas.includes(clausulaIdentificada)) {
        aprendizado.tiposSituacao[tipoSituacao].clausulasUsadas.push(clausulaIdentificada);
    }
    
    // Identificar padrões na resposta e nos feedbacks
    const padroes = [];
    
    // Padrões da resposta aprovada
    if (respostaAprovada.toLowerCase().includes('conforme solicitado')) {
        padroes.push('Confirmação de atendimento à solicitação');
    }
    if (respostaAprovada.toLowerCase().includes('conforme estabelecido')) {
        padroes.push('Referência a cláusulas contratuais');
    }
    if (respostaAprovada.toLowerCase().includes('lgpd') || respostaAprovada.toLowerCase().includes('lei geral')) {
        padroes.push('Fundamentação legal (LGPD)');
    }
    if (respostaAprovada.toLowerCase().includes('processo foi concluído')) {
        padroes.push('Confirmação de conclusão do processo');
    }
    
    // Padrões dos feedbacks (CRÍTICO - EVITAR ESTES ERROS)
    const feedbacks = aprendizado.tiposSituacao[tipoSituacao].feedbacks;
    feedbacks.forEach(fb => {
        const feedback = fb.feedback.toLowerCase();
        
        if (feedback.includes('não peça desculpas') || feedback.includes('jamais peça desculpas')) {
            padroes.push('NUNCA pedir desculpas em nome da empresa');
        }
        if (feedback.includes('não estipular prazos') || feedback.includes('sem estar presente')) {
            padroes.push('NUNCA estipular prazos que não estão na solução implementada');
        }
        if (feedback.includes('não condiz') || feedback.includes('nao-condiz-solucao')) {
            padroes.push('SEMPRE usar EXATAMENTE a solução implementada como base');
        }
        if (feedback.includes('informações incorretas') || feedback.includes('informacoes-incorretas')) {
            padroes.push('NUNCA inventar informações que não estão nos dados fornecidos');
        }
        if (feedback.includes('falta clareza') || feedback.includes('falta-clareza')) {
            padroes.push('SEMPRE ser específico e conclusivo sobre o que foi feito');
        }
        if (feedback.includes('exclusão de cadastro')) {
            padroes.push('Para exclusão: confirmar que dados foram removidos e não receberá mais comunicações');
        }
        if (feedback.includes('portabilidade') || feedback.includes('chave pix')) {
            padroes.push('Para portabilidade: confirmar que processo foi concluído e chave liberada');
        }
    });
    
    console.log('📋 Padrões identificados:', padroes);
    padroes.forEach(padrao => {
        if (!aprendizado.tiposSituacao[tipoSituacao].padroesIdentificados.includes(padrao)) {
            aprendizado.tiposSituacao[tipoSituacao].padroesIdentificados.push(padrao);
            console.log('✅ Novo padrão adicionado:', padrao);
        }
    });
}

// Processar padrões existentes baseado nos feedbacks salvos
async function processarPadroesExistentes(tipoSituacao) {
    console.log('🔄 Processando padrões existentes para:', tipoSituacao);
    const aprendizado = await loadAprendizadoScript();
    
    if (!aprendizado || !aprendizado.tiposSituacao || !aprendizado.tiposSituacao[tipoSituacao]) {
        return;
    }
    
    const padroes = [];
    const clausulas = [];
    
    // Identificar cláusula CCB baseada no tipo de situação
    if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade')) {
        clausulas.push('Cláusula 7 - Vínculo da Chave Pix e Quitação Automática');
    } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação')) {
        clausulas.push('Cláusula 8 - Liquidação Antecipada');
    } else if (tipoSituacao.toLowerCase().includes('inadimplência') || tipoSituacao.toLowerCase().includes('vencimento')) {
        clausulas.push('Cláusula 10 - Inadimplência e Vencimento Antecipado');
    } else if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('dados')) {
        clausulas.push('Cláusula 14 - Proteção de Dados (LGPD)');
    }
    
    // Analisar todos os feedbacks para extrair padrões
    aprendizado.tiposSituacao[tipoSituacao].feedbacks.forEach(fb => {
        const feedback = fb.feedback.toLowerCase();
        
        if (feedback.includes('não peça desculpas') || feedback.includes('jamais peça desculpas')) {
            padroes.push('NUNCA pedir desculpas em nome da empresa');
        }
        if (feedback.includes('não estipular prazos') || feedback.includes('sem estar presente')) {
            padroes.push('NUNCA estipular prazos que não estão na solução implementada');
        }
        if (feedback.includes('não condiz') || feedback.includes('nao-condiz-solucao')) {
            padroes.push('SEMPRE usar EXATAMENTE a solução implementada como base');
        }
        if (feedback.includes('informações incorretas') || feedback.includes('informacoes-incorretas')) {
            padroes.push('NUNCA inventar informações que não estão nos dados fornecidos');
        }
        if (feedback.includes('falta clareza') || feedback.includes('falta-clareza')) {
            padroes.push('SEMPRE ser específico e conclusivo sobre o que foi feito');
        }
        if (feedback.includes('exclusão de cadastro')) {
            padroes.push('Para exclusão: confirmar que dados foram removidos e não receberá mais comunicações');
        }
        if (feedback.includes('portabilidade') || feedback.includes('chave pix')) {
            padroes.push('Para portabilidade: confirmar que processo foi concluído e chave liberada');
        }
    });
    
    // Analisar respostas coerentes para extrair padrões positivos
    aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.forEach(resp => {
        const resposta = resp.respostaAprovada.toLowerCase();
        
        if (resposta.includes('conforme solicitado')) {
            padroes.push('Confirmação de atendimento à solicitação');
        }
        if (resposta.includes('conforme estabelecido')) {
            padroes.push('Referência a cláusulas contratuais');
        }
        if (resposta.includes('processo foi concluído')) {
            padroes.push('Confirmação de conclusão do processo');
        }
        if (resposta.includes('confirmamos que')) {
            padroes.push('Confirmação direta do que foi feito');
        }
    });
    
    // Remover duplicatas
    const padroesUnicos = [...new Set(padroes)];
    const clausulasUnicas = [...new Set(clausulas)];
    
    // Atualizar aprendizado
    aprendizado.tiposSituacao[tipoSituacao].padroesIdentificados = padroesUnicos;
    aprendizado.tiposSituacao[tipoSituacao].clausulasUsadas = clausulasUnicas;
    
    await saveAprendizadoScript(aprendizado);
    console.log('✅ Padrões processados:', padroesUnicos.length, 'padrões,', clausulasUnicas.length, 'cláusulas');
    console.log('📋 Padrões identificados:', padroesUnicos);
}

// Obter aprendizado para um tipo de situação
async function getAprendizadoTipoSituacao(tipoSituacao) {
    console.log(`🔍 getAprendizadoTipoSituacao chamada para: "${tipoSituacao}"`);
    
    // PRIORIDADE 1: Carregar dos arquivos JSON (desenvolvimento local)
    let feedbacksRespostas, modelosRespostas, feedbacksModeracoes, modelosModeracoes;
    
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        console.log('🌐 Vercel detectado - usando dados em memória (sem persistência)');
        feedbacksRespostas = feedbacksRespostasMemoria;
        modelosRespostas = modelosRespostasMemoria;
        feedbacksModeracoes = feedbacksModeracoesMemoria;
        modelosModeracoes = modelosModeracoesMemoria;
    } else {
        console.log('💻 Desenvolvimento local - carregando dos arquivos JSON');
        feedbacksRespostas = loadFeedbacksRespostas();
        modelosRespostas = await loadModelosRespostas();
        feedbacksModeracoes = loadFeedbacksModeracoes();
        modelosModeracoes = await loadModelosModeracoes();
    }
    
    console.log(`📚 Dados carregados dos arquivos JSON:`, {
        feedbacksRespostas: feedbacksRespostas?.respostas?.length || 0,
        modelosRespostas: modelosRespostas?.modelos?.length || 0,
        feedbacksModeracoes: feedbacksModeracoes?.moderacoes?.length || 0,
        modelosModeracoes: modelosModeracoes?.modelos?.length || 0
    });
    
    // Debug: mostrar alguns exemplos dos dados carregados
    if (feedbacksRespostas?.respostas?.length > 0) {
        console.log(`🔍 Exemplo de feedback carregado:`, {
            tipoSituacao: feedbacksRespostas.respostas[0].contexto?.tipoSituacao || feedbacksRespostas.respostas[0].dadosFormulario?.tipo_solicitacao,
            feedback: feedbacksRespostas.respostas[0].feedback?.substring(0, 100) + '...'
        });
    }
    
    if (modelosRespostas?.modelos?.length > 0) {
        console.log(`🔍 Exemplo de modelo carregado:`, {
            tipoSituacao: modelosRespostas.modelos[0].tipo_situacao || modelosRespostas.modelos[0].contexto?.tipoSituacao,
            resposta: modelosRespostas.modelos[0].respostaAprovada?.substring(0, 100) + '...'
        });
    }
    
    // PRIORIDADE 2: Carregar do sistema de aprendizado (fallback)
    const aprendizado = await loadAprendizadoScript();
    console.log(`📚 Aprendizado do script carregado:`, {
        existe: !!aprendizado,
        temTiposSituacao: !!aprendizado?.tiposSituacao,
        tiposDisponiveis: aprendizado?.tiposSituacao ? Object.keys(aprendizado.tiposSituacao) : [],
        tipoSolicitado: tipoSituacao
    });
    
    // Filtrar dados relevantes para o tipo de situação
    const feedbacksRelevantes = feedbacksRespostas?.respostas?.filter(fb => 
        fb.contexto?.tipoSituacao === tipoSituacao || 
        fb.dadosFormulario?.tipo_solicitacao === tipoSituacao
    ) || [];
    
    const modelosRelevantes = modelosRespostas?.modelos?.filter(modelo => 
        modelo.tipo_situacao === tipoSituacao || 
        modelo.contexto?.tipoSituacao === tipoSituacao
    ) || [];
    
    console.log(`🎯 Dados filtrados para "${tipoSituacao}":`, {
        feedbacksRelevantes: feedbacksRelevantes.length,
        modelosRelevantes: modelosRelevantes.length
    });
    
    // PRIORIDADE 1: Usar sistema de aprendizado (dados mais atualizados e sincronizados)
    if (aprendizado && aprendizado.tiposSituacao && aprendizado.tiposSituacao[tipoSituacao]) {
        const aprendizadoTipo = aprendizado.tiposSituacao[tipoSituacao];
        console.log(`✅ Retornando dados do aprendizado_script.json para "${tipoSituacao}":`, {
            feedbacks: aprendizadoTipo?.feedbacks?.length || 0,
            respostasCoerentes: aprendizadoTipo?.respostasCoerentes?.length || 0,
            padroes: aprendizadoTipo?.padroesIdentificados?.length || 0,
            clausulas: aprendizadoTipo?.clausulasUsadas?.length || 0
        });
        
        return {
            feedbacks: aprendizadoTipo.feedbacks || [],
            respostasCoerentes: aprendizadoTipo.respostasCoerentes || [],
            padroesIdentificados: aprendizadoTipo.padroesIdentificados || [],
            clausulasUsadas: aprendizadoTipo.clausulasUsadas || []
        };
    }
    
    // PRIORIDADE 2: Fallback para arquivos JSON (dados mais antigos)
    if (feedbacksRelevantes.length > 0 || modelosRelevantes.length > 0) {
        console.log(`⚠️ Usando fallback dos arquivos JSON para "${tipoSituacao}":`, {
        feedbacks: feedbacksRelevantes.length,
        respostasCoerentes: modelosRelevantes.length
    });
    
    return {
        feedbacks: feedbacksRelevantes.map(fb => ({
            feedback: fb.feedback,
            respostaReformulada: fb.respostaReformulada,
            timestamp: fb.timestamp
        })),
        respostasCoerentes: modelosRelevantes.map(modelo => ({
            respostaAprovada: modelo.respostaAprovada,
            dadosFormulario: modelo.dadosFormulario,
            timestamp: modelo.timestamp
        })),
        padroesIdentificados: [], // Será preenchido pelo sistema de aprendizado
        clausulasUsadas: [] // Será preenchido pelo sistema de aprendizado
        };
    }
    
    // Nenhum dado encontrado
    console.log(`⚠️ Nenhum aprendizado encontrado para "${tipoSituacao}"`);
    return {
        feedbacks: [],
        respostasCoerentes: [],
        padroesIdentificados: [],
        clausulasUsadas: []
    };
}

// ===== FUNÇÃO COMPATIBILIDADE (para não quebrar código existente) =====

// Carregar feedbacks (mantido para compatibilidade)
function loadFeedbacks() {
    const respostas = loadFeedbacksRespostas();
    const moderacoes = loadFeedbacksModeracoes();
    return {
        respostas: respostas.respostas || [],
        moderacoes: moderacoes.moderacoes || [],
        lastUpdated: obterTimestampBrasil()
    };
}

// Adicionar feedback de resposta (APENAS para aba Respostas RA)
async function addRespostaFeedback(dadosFormulario, respostaAnterior, feedback, respostaReformulada, userData = null) {
    const feedbacks = loadFeedbacksRespostas();
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo: 'resposta',
        dadosFormulario: dadosFormulario,
        respostaAnterior: respostaAnterior,
        feedback: feedback,
        respostaReformulada: respostaReformulada,
        userData: userData,
        contexto: {
            tipoSituacao: dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao
        }
    };
    
    // Criar uma cópia para evitar modificar a referência da memória
    const feedbacksCopy = {
        ...feedbacks,
        respostas: [...(feedbacks.respostas || []), novoFeedback]
    };
    
    await saveFeedbacksRespostas(feedbacksCopy);
    
    // Também adicionar ao aprendizado direto do script
    await addFeedbackAprendizado(dadosFormulario.tipo_solicitacao, feedback, respostaReformulada, respostaAnterior, userData);
    
    // Registrar no Google Sheets usando fila robusta se disponível
    if (googleSheetsQueueRobust && googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        console.log('📋 Adicionando feedback à fila robusta do Google Sheets...');
        try {
            await googleSheetsQueueRobust.enqueue({
                type: 'registrarFeedback',
                data: {
                    tipo: 'resposta',
                    dadosFormulario: dadosFormulario,
                    respostaAnterior: respostaAnterior,
                    feedback: feedback,
                    respostaReformulada: respostaReformulada,
                    userData: userData,
                    timestamp: novoFeedback.timestamp
                },
                priority: 'high'
            });
            console.log('✅ Feedback adicionado à fila robusta');
        } catch (error) {
            console.error('❌ Erro ao adicionar feedback à fila robusta:', error.message);
        }
    } else {
        console.log('⚠️ Fila robusta não disponível - usando método direto');
        // Fallback para método direto
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.registrarFeedback({
                    tipo: 'resposta',
                    dadosFormulario: dadosFormulario,
                    respostaAnterior: respostaAnterior,
                    feedback: feedback,
                    respostaReformulada: respostaReformulada,
                    userData: userData,
                    timestamp: novoFeedback.timestamp
                });
                console.log('✅ Feedback registrado diretamente no Google Sheets');
            } catch (error) {
                console.error('❌ Erro ao registrar feedback diretamente:', error.message);
            }
        }
    }
    
    console.log('📝 Feedback de resposta adicionado (aba Respostas RA):', novoFeedback.id);
    return novoFeedback;
}

// Adicionar feedback de moderação (APENAS para aba Moderação RA)
async function addModeracaoFeedback(textoNegado, motivoNegativa, textoReformulado, dadosModeracao = null, userData = null) {
    const feedbacks = loadFeedbacksModeracoes();
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo: 'moderacao',
        textoNegado: textoNegado,
        motivoNegativa: motivoNegativa,
        textoReformulado: textoReformulado,
        dadosModeracao: dadosModeracao,
        userData: userData
    };
    
    feedbacks.moderacoes.push(novoFeedback);
    await saveFeedbacksModeracoes(feedbacks);
    
    // Registrar no Google Sheets (SEMPRE TENTAR - auto-inicialização dentro da função)
    if (googleSheetsIntegration) {
        console.log('📋 Tentando registrar feedback de moderação no Google Sheets...');
        const feedbackData = {
            id: novoFeedback.id,
            tipo: 'moderacao',
            dadosModeracao: dadosModeracao,
            textoNegado: textoNegado,
            motivoNegativa: motivoNegativa,
            textoReformulado: textoReformulado,
            linhaRaciocinio: '', // Vazio para feedbacks
            userProfile: userData ? `${userData.nome} (${userData.email})` : 'N/A',
            userName: userData?.nome || 'N/A',
            userEmail: userData?.email || 'N/A'
        };
        
        console.log('📋 Dados do feedback para Google Sheets:', {
            id: feedbackData.id,
            tipo: feedbackData.tipo,
            userProfile: feedbackData.userProfile,
            googleSheetsAtivo: googleSheetsIntegration.isActive()
        });
        
        // SALVAMENTO COM AWAIT PARA GARANTIR REGISTRO
        // A função registrarFeedbackModeracao já tem auto-inicialização
        try {
            const resultado = await googleSheetsIntegration.registrarFeedbackModeracao(feedbackData);
            if (resultado) {
                console.log('✅ Feedback de moderação salvo no Google Sheets:', novoFeedback.id);
            } else {
                console.log('⚠️ Falha ao salvar feedback de moderação no Google Sheets:', novoFeedback.id);
            }
        } catch (error) {
            console.error('❌ Erro ao salvar feedback de moderação:', error.message);
            console.error('Stack:', error.stack);
        }
    } else {
        console.log('⚠️ googleSheetsIntegration não está disponível');
    }
    
    console.log('📝 Feedback de moderação adicionado (aba Moderação RA):', novoFeedback.id);
    return novoFeedback;
}

// Obter feedbacks relevantes para um contexto (SEPARADO POR ABA)
function getRelevantFeedbacks(tipo, contexto) {
    const relevantes = [];
    
    if (tipo === 'resposta') {
        // Usar APENAS feedbacks de respostas (aba Respostas RA)
        const feedbacks = loadFeedbacksRespostas();
        feedbacks.respostas.forEach(feedback => {
            let isRelevante = false;
            
            // Verificar correspondência exata de tipo de situação
            if (feedback.contexto && feedback.contexto.tipoSituacao === contexto.tipoSituacao) {
                isRelevante = true;
            }
            
            // Verificar correspondência de motivo de solicitação
            if (feedback.contexto && feedback.contexto.motivoSolicitacao === contexto.motivoSolicitacao) {
                isRelevante = true;
            }
            
            // Busca por palavras-chave no feedback (para casos de exclusão de cadastro, LGPD, etc.)
            if (feedback.feedback && typeof feedback.feedback === 'string') {
                const feedbackLower = feedback.feedback.toLowerCase();
                const contextoLower = (contexto.tipoSituacao + ' ' + contexto.motivoSolicitacao).toLowerCase();
                
                // Buscar palavras-chave importantes
                const palavrasChave = ['exclusão', 'cadastro', 'lgpd', 'dados pessoais', 'desculpas', 'empresa'];
                const temPalavraChave = palavrasChave.some(palavra => 
                    feedbackLower.includes(palavra) && contextoLower.includes(palavra)
                );
                
                if (temPalavraChave) {
                    isRelevante = true;
                }
            }
            
            if (isRelevante) {
                relevantes.push(feedback);
            }
        });
    } else if (tipo === 'moderacao') {
        // Usar APENAS feedbacks de moderações (aba Moderação RA) - VERSÃO MELHORADA
        const feedbacks = loadFeedbacksModeracoes();
        feedbacks.moderacoes.forEach(feedback => {
            let score = 0;
            let isRelevante = false;
            
            // 1. Correspondência exata de motivo de negativa
            if (feedback.motivoNegativa && contexto.motivoNegativa) {
                const motivoFeedback = feedback.motivoNegativa.toLowerCase();
                const motivoContexto = contexto.motivoNegativa.toLowerCase();
                
                if (motivoFeedback === motivoContexto) {
                    score += 5; // Máxima relevância
                    isRelevante = true;
                } else if (motivoFeedback.includes(motivoContexto) || motivoContexto.includes(motivoFeedback)) {
                    score += 3;
                    isRelevante = true;
                }
            }
            
            // 2. Busca por padrões de erro comuns
            const padroesErro = [
                'resposta não condizente', 'tom inadequado', 'sem relação com os fatos',
                'informação falsa', 'ofensivo', 'duplicidade', 'spam'
            ];
            
            if (feedback.motivoNegativa) {
                const motivoLower = feedback.motivoNegativa.toLowerCase();
                const temPadraoComum = padroesErro.some(padrao => motivoLower.includes(padrao));
                if (temPadraoComum) {
                    score += 2;
                    isRelevante = true;
                }
            }
            
            // 3. Análise de contexto similar (solicitação, resposta, consideração)
            if (feedback.dadosModeracao && contexto.dadosModeracao) {
                const fbDados = feedback.dadosModeracao;
                const ctxDados = contexto.dadosModeracao;
                
                // Verificar similaridade na solicitação do cliente
                if (fbDados.solicitacaoCliente && ctxDados.solicitacaoCliente) {
                    const similaridade = calcularSimilaridade(
                        fbDados.solicitacaoCliente.toLowerCase(),
                        ctxDados.solicitacaoCliente.toLowerCase()
                    );
                    if (similaridade > 0.3) {
                        score += 1;
                        isRelevante = true;
                    }
                }
                
                // Verificar similaridade na resposta da empresa
                if (fbDados.respostaEmpresa && ctxDados.respostaEmpresa) {
                    const similaridade = calcularSimilaridade(
                        fbDados.respostaEmpresa.toLowerCase(),
                        ctxDados.respostaEmpresa.toLowerCase()
                    );
                    if (similaridade > 0.3) {
                        score += 1;
                        isRelevante = true;
                    }
                }
            }
            
            // 4. Busca por palavras-chave específicas de moderação
            if (feedback.textoNegado && contexto.dadosModeracao) {
                const textoNegado = feedback.textoNegado.toLowerCase();
                const contextoTexto = (contexto.dadosModeracao.solicitacaoCliente + ' ' + 
                                     contexto.dadosModeracao.respostaEmpresa).toLowerCase();
                
                const palavrasModeracao = ['pix', 'portabilidade', 'quitação', 'restituição', 'ccb', 'contrato'];
                const temPalavraModeracao = palavrasModeracao.some(palavra => 
                    textoNegado.includes(palavra) && contextoTexto.includes(palavra)
                );
                
                if (temPalavraModeracao) {
                    score += 1;
                    isRelevante = true;
                }
            }
            
            if (isRelevante) {
                feedback.relevanceScore = score;
                relevantes.push(feedback);
            }
        });
    }
    
    // Ordenar por score de relevância e timestamp, retornar os mais relevantes
    return relevantes
        .sort((a, b) => {
            // Primeiro por score de relevância (maior primeiro)
            if (b.relevanceScore !== a.relevanceScore) {
                return b.relevanceScore - a.relevanceScore;
            }
            // Depois por timestamp mais recente
            return new Date(b.timestamp) - new Date(a.timestamp);
        })
        .slice(0, 8); // Aumentar para 8 feedbacks mais relevantes
}

// Função auxiliar para calcular similaridade simples entre textos
function calcularSimilaridade(texto1, texto2) {
    if (!texto1 || !texto2) return 0;
    
    const palavras1 = texto1.split(/\s+/).filter(p => p.length > 3);
    const palavras2 = texto2.split(/\s+/).filter(p => p.length > 3);
    
    if (palavras1.length === 0 || palavras2.length === 0) return 0;
    
    const palavrasComuns = palavras1.filter(palavra => palavras2.includes(palavra));
    return palavrasComuns.length / Math.max(palavras1.length, palavras2.length);
}

// Gerar explicação baseada em feedbacks salvos (APENAS feedbacks de respostas)
function gerarExplicacaoBaseadaEmFeedbacks(tema, feedbacks) {
    console.log(`🧠 Gerando explicação para tema: ${tema} baseada em ${feedbacks.respostas.length} feedbacks de respostas (aba Respostas RA)`);
    
    // Buscar feedbacks relevantes para o tema
    const feedbacksRelevantes = [];
    
    // Buscar em feedbacks de respostas
    feedbacks.respostas.forEach(feedback => {
        let isRelevante = false;
        
        // Verificar no contexto (se existir)
        if (feedback.contexto && feedback.contexto.tipoSituacao) {
            const tipoSituacao = feedback.contexto.tipoSituacao.toLowerCase();
            const motivoSolicitacao = feedback.contexto.motivoSolicitacao ? feedback.contexto.motivoSolicitacao.toLowerCase() : '';
            
            if (tipoSituacao.includes(tema.toLowerCase()) || 
                motivoSolicitacao.includes(tema.toLowerCase())) {
                isRelevante = true;
            }
        }
        
        // Verificar nos dados do formulário (fallback para feedbacks antigos)
        if (feedback.dadosFormulario) {
            const tipoSituacao = feedback.dadosFormulario.tipo_solicitacao ? feedback.dadosFormulario.tipo_solicitacao.toLowerCase() : '';
            const motivoSolicitacao = feedback.dadosFormulario.motivo_solicitacao ? feedback.dadosFormulario.motivo_solicitacao.toLowerCase() : '';
            
            if (tipoSituacao.includes(tema.toLowerCase()) || 
                motivoSolicitacao.includes(tema.toLowerCase())) {
                isRelevante = true;
            }
        }
        
        // Verificar no texto do feedback
        if (feedback.feedback) {
            const feedbackTexto = feedback.feedback.toLowerCase();
            if (feedbackTexto.includes(tema.toLowerCase()) ||
                (tema.toLowerCase().includes('exclusao') && feedbackTexto.includes('exclusão')) ||
                (tema.toLowerCase().includes('exclusão') && feedbackTexto.includes('exclusao'))) {
                isRelevante = true;
            }
        }
        
        if (isRelevante) {
            feedbacksRelevantes.push({
                tipo: 'resposta',
                feedback: feedback,
                relevancia: 'alta'
            });
        }
    });
    
    // NOTA: Explicações usam APENAS feedbacks de respostas (aba Respostas RA)
    // Feedbacks de moderação são isolados para a aba Moderação RA
    
    // Gerar explicação baseada nos feedbacks encontrados
    let explicacao = '';
    
    if (feedbacksRelevantes.length > 0) {
        explicacao = gerarExplicacaoDetalhada(tema, feedbacksRelevantes);
    } else {
        explicacao = gerarExplicacaoPadrao(tema);
    }
    
    return explicacao;
}

// Gerar explicação detalhada baseada em feedbacks
function gerarExplicacaoDetalhada(tema, feedbacksRelevantes) {
    let explicacao = `<p><strong>Explicação sobre ${tema.charAt(0).toUpperCase() + tema.slice(1)}</strong></p>`;
    explicacao += `<p><em>Baseada em ${feedbacksRelevantes.length} experiência(s) anterior(es) documentada(s) no sistema.</em></p>`;
    
    // Extrair padrões dos feedbacks
    const padroes = new Set();
    const exemplos = [];
    
    feedbacksRelevantes.forEach(fb => {
        if (fb.feedback.feedback) {
            padroes.add(fb.feedback.feedback);
        }
        if (fb.feedback.respostaReformulada) {
            exemplos.push(fb.feedback.respostaReformulada.substring(0, 200));
        }
    });
    
    // Adicionar padrões identificados
    if (padroes.size > 0) {
        explicacao += `<h6>📋 Diretrizes Identificadas:</h6><ul>`;
        Array.from(padroes).forEach(padrao => {
            explicacao += `<li>${padrao}</li>`;
        });
        explicacao += `</ul>`;
    }
    
    // Adicionar exemplos práticos
    if (exemplos.length > 0) {
        explicacao += `<h6>✅ Exemplos de Boas Práticas:</h6>`;
        exemplos.slice(0, 2).forEach((exemplo, index) => {
            explicacao += `<p><strong>Exemplo ${index + 1}:</strong> "${exemplo}..."</p>`;
        });
    }
    
    // Adicionar explicação específica baseada no tema
    explicacao += gerarExplicacaoEspecifica(tema);
    
    return explicacao;
}

// Gerar explicação específica baseada no tema
function gerarExplicacaoEspecifica(tema) {
    const explicacoesEspecificas = {
        'exclusao': `
            <h6>🔍 Sobre Exclusão de Cadastro:</h6>
            <p>Com base nas experiências documentadas, seguem as diretrizes essenciais:</p>
            <ul>
                <li><strong>LGPD:</strong> Sempre citar a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018)</li>
                <li><strong>Tom Profissional:</strong> Nunca pedir desculpas em nome da empresa</li>
                <li><strong>Foco na Solução:</strong> Enfatizar que a solicitação foi atendida</li>
                <li><strong>Transparência:</strong> Informar a data exata da exclusão</li>
            </ul>
        `,
        'exclusão': `
            <h6>🔍 Sobre Exclusão de Cadastro:</h6>
            <p>Com base nas experiências documentadas, seguem as diretrizes essenciais:</p>
            <ul>
                <li><strong>LGPD:</strong> Sempre citar a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018)</li>
                <li><strong>Tom Profissional:</strong> Nunca pedir desculpas em nome da empresa</li>
                <li><strong>Foco na Solução:</strong> Enfatizar que a solicitação foi atendida</li>
                <li><strong>Transparência:</strong> Informar a data exata da exclusão</li>
            </ul>
        `,
        'moderacao': `
            <h6>🔍 Sobre Moderação no Reclame Aqui:</h6>
            <p>Com base nas experiências documentadas:</p>
            <ul>
                <li><strong>Estrutura Padrão:</strong> "Conforme o apontamento acima, solicitamos a moderação..."</li>
                <li><strong>Fundamentação:</strong> Sempre citar o manual aplicável (Geral, Reviews ou Bancos)</li>
                <li><strong>Tom Técnico:</strong> Linguagem objetiva e impessoal</li>
                <li><strong>Evidências:</strong> Anexar documentação comprobatória</li>
            </ul>
        `
    };
    
    return explicacoesEspecificas[tema.toLowerCase()] || '';
}

// Gerar explicação padrão quando não há feedbacks relevantes
function gerarExplicacaoPadrao(tema) {
    const explicacoesPadrao = {
        'fgts': `
            <p><strong>Explicação sobre FGTS (Fundo de Garantia do Tempo de Serviço)</strong></p>
            <p>O FGTS é um fundo que garante proteção ao trabalhador demitido sem justa causa. O empregador deposita mensalmente 8% do salário do funcionário em uma conta vinculada.</p>
            <p>Restituições podem ocorrer em casos específicos como demissão sem justa causa, aposentadoria, ou compra da casa própria.</p>
            <p>Para consultar seus saldos, utilize o aplicativo FGTS ou o site da Caixa Econômica Federal.</p>
        `,
        'malha-fina': `
            <p><strong>Explicação sobre Malha Fina e Regularização</strong></p>
            <p>A malha fina é um processo de verificação da Receita Federal que identifica inconsistências na declaração do Imposto de Renda.</p>
            <p>Para regularização, é necessário apresentar documentação comprobatória e, se necessário, fazer uma declaração retificadora.</p>
        `,
        'ccb': `
            <p><strong>Explicação sobre Cédula de Crédito Bancário (CCB)</strong></p>
            <p>A CCB é um título de crédito que representa uma promessa de pagamento. É amplamente utilizada em operações de crédito pessoal e empresarial.</p>
            <p>Possui características específicas como prazo, taxa de juros e garantias, conforme estabelecido no contrato.</p>
        `
    };
    
    return explicacoesPadrao[tema.toLowerCase()] || `<p>Explicação sobre ${tema} não disponível no momento. Consulte nossa equipe para mais informações.</p>`;
}

// ===== CONFIGURAÇÕES DE SEGURANÇA =====

// Middleware de segurança
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://127.0.0.1:3000', 
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        'file://',
        'https://velo-xxx.vercel.app',
        'https://velo.vercel.app',
        'https://velotax-bot.vercel.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Headers de segurança
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
});

// Forçar HTTPS em produção
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}

app.use(express.json());
app.use(express.static('.'));

// Rotas específicas para servir arquivos estáticos com MIME type correto
app.get('*.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.png', (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.jpg', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.jpeg', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.gif', (req, res) => {
    res.setHeader('Content-Type', 'image/gif');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('*.ico', (req, res) => {
    res.setHeader('Content-Type', 'image/x-icon');
    res.sendFile(path.join(__dirname, req.path));
});

// Rate limiting simples
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const RATE_LIMIT_MAX = 10; // 10 requests por minuto

// Middleware de rate limiting
function rateLimitMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimit.has(clientIP)) {
        rateLimit.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    const clientData = rateLimit.get(clientIP);
    
    if (now > clientData.resetTime) {
        rateLimit.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    if (clientData.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: 'Muitas requisições. Tente novamente em 1 minuto.'
        });
    }
    
    clientData.count++;
    next();
}

// ===== FUNÇÕES DE SEGURANÇA =====

// Função auxiliar para carregar variáveis de um arquivo específico
function loadEnvFromFile(filePath) {
    try {
        console.log('📁 Carregando arquivo de configuração:', filePath);
        const envContent = fs.readFileSync(filePath, 'utf8');
        const envVars = {};
        
        const lines = envContent.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('#') || trimmedLine === '') {
                continue;
            }
            
            const equalIndex = trimmedLine.indexOf('=');
            if (equalIndex === -1) {
                continue;
            }
            
            const key = trimmedLine.substring(0, equalIndex).trim();
            const value = trimmedLine.substring(equalIndex + 1).trim();
            const cleanValue = value.replace(/^["']|["']$/g, '');
            
            envVars[key] = cleanValue;
        }
        
        console.log(`✅ ${Object.keys(envVars).length} variáveis carregadas de ${path.basename(filePath)}`);
        if (envVars.GOOGLE_CLIENT_ID) {
            console.log('🔧 GOOGLE_CLIENT_ID carregado:', envVars.GOOGLE_CLIENT_ID);
        }
        
        return envVars;
    } catch (error) {
        console.error('❌ Erro ao carregar arquivo:', error);
        return {};
    }
}

// Carregar variáveis de ambiente do arquivo .env ou process.env (Vercel)
function loadEnvFile() {
    try {
        // Se estiver na Vercel (NODE_ENV=production), usar process.env
        if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
            console.log('🌐 Carregando variáveis de ambiente da Vercel (process.env)');
            const envVars = {
                OPENAI_API_KEY: process.env.OPENAI_API_KEY,
                OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
                OPENAI_TEMPERATURE: process.env.OPENAI_TEMPERATURE || '0.7',
                OPENAI_MAX_TOKENS: process.env.OPENAI_MAX_TOKENS || '2000',
                OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
                MAX_API_CALLS_PER_HOUR: process.env.MAX_API_CALLS_PER_HOUR || '100',
                APP_NAME: process.env.APP_NAME || 'Velotax Bot',
                APP_VERSION: process.env.APP_VERSION || '2.0.0',
                DEBUG_MODE: process.env.DEBUG_MODE || 'false',
                LOG_LEVEL: process.env.LOG_LEVEL || 'info',
                GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || null,
                DOMINIO_PERMITIDO: process.env.DOMINIO_PERMITIDO || '@velotax.com.br',
                // Google Sheets
                GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
                ENABLE_GOOGLE_SHEETS: process.env.ENABLE_GOOGLE_SHEETS,
                GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
                GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID
            };
            
            console.log(`✅ ${Object.keys(envVars).filter(k => envVars[k]).length} variáveis carregadas do process.env`);
            return envVars;
        }
        
        // Para desenvolvimento local, tentar carregar do arquivo .env primeiro
        let envPath = path.join(__dirname, '.env');
        let envVars = {};
        
        if (fs.existsSync(envPath)) {
            console.log('📁 Carregando arquivo .env...');
            envVars = loadEnvFromFile(envPath);
        }
        
        // Sempre tentar carregar config.env se não estiver na Vercel
        if (!process.env.VERCEL) {
            const configEnvPath = path.join(__dirname, 'config.env');
            if (fs.existsSync(configEnvPath)) {
                console.log('📁 Carregando config.env...');
                const configVars = loadEnvFromFile(configEnvPath);
                // Mesclar variáveis, priorizando config.env
                envVars = { ...envVars, ...configVars };
            }
        }
        
        // Log final das variáveis carregadas
        console.log('🔧 Variáveis finais carregadas:');
        console.log('  - GOOGLE_CLIENT_ID:', envVars.GOOGLE_CLIENT_ID || 'NÃO ENCONTRADO');
        console.log('  - DOMINIO_PERMITIDO:', envVars.DOMINIO_PERMITIDO || 'NÃO ENCONTRADO');
        
        if (Object.keys(envVars).length === 0) {
            console.warn('⚠️ Nenhum arquivo de configuração encontrado');
            return {};
        }
        
        return envVars;
        
    } catch (error) {
        console.error('❌ Erro ao carregar variáveis de ambiente:', error);
        return {};
    }
}

// Validar chave da API
function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return false;
    }
    
    if (!apiKey.startsWith('sk-')) {
        return false;
    }
    
    if (apiKey.length < 20) {
        return false;
    }
    
    return true;
}

// Tratar erros da API OpenAI de forma detalhada
function tratarErroOpenAI(response, errorData) {
    let errorMessage = 'Erro na API OpenAI';
    let errorDetails = errorData;
    let statusCode = response?.status || 400;
    
    // Tentar parsear o erro para dar mensagem mais específica
    try {
        const errorJson = typeof errorData === 'string' ? JSON.parse(errorData) : errorData;
        const errorType = errorJson.error?.type || '';
        const errorCode = errorJson.error?.code || '';
        const errorMsg = errorJson.error?.message || '';
        
        console.error('❌ Erro detalhado da API OpenAI:', {
            status: statusCode,
            statusText: response?.statusText || '',
            type: errorType,
            code: errorCode,
            message: errorMsg
        });
        
        // Identificar tipo específico de erro
        if (statusCode === 401) {
            if (errorMsg.includes('Invalid API key') || errorMsg.includes('Incorrect API key')) {
                errorMessage = 'Chave da API OpenAI inválida ou incorreta';
                errorDetails = 'A chave da API configurada não é válida. Verifique se a chave está correta na Vercel (Environment Variables).';
            } else if (errorMsg.includes('expired') || errorMsg.includes('revoked')) {
                errorMessage = 'Chave da API OpenAI expirada ou revogada';
                errorDetails = 'A chave da API foi desativada ou expirou. Gere uma nova chave no painel da OpenAI e atualize na Vercel.';
            } else {
                errorMessage = 'Chave da API OpenAI não autorizada';
                errorDetails = 'A chave da API não tem permissão para acessar o serviço. Verifique se a chave está ativa no painel da OpenAI.';
            }
        } else if (statusCode === 429) {
            errorMessage = 'Limite de requisições excedido';
            errorDetails = 'Você atingiu o limite de requisições da API OpenAI. Aguarde alguns minutos ou verifique seu plano de uso.';
        } else if (statusCode === 402 || errorMsg.includes('insufficient_quota') || errorMsg.includes('billing')) {
            errorMessage = 'Créditos insuficientes na conta OpenAI';
            errorDetails = 'Sua conta da OpenAI não tem créditos suficientes. Adicione créditos no painel da OpenAI (https://platform.openai.com/account/billing).';
        } else if (statusCode === 403) {
            errorMessage = 'Acesso negado à API OpenAI';
            errorDetails = 'A chave da API não tem permissão para acessar este recurso. Verifique as permissões da chave.';
        } else {
            errorMessage = `Erro na API OpenAI (${statusCode})`;
            errorDetails = errorMsg || (typeof errorData === 'string' ? errorData : JSON.stringify(errorData));
        }
    } catch (parseError) {
        // Se não conseguir parsear, usar a mensagem original
        console.error('❌ Erro ao parsear resposta da API:', parseError);
        errorDetails = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
    }
    
    console.error('❌ Erro na API OpenAI:', {
        status: statusCode,
        message: errorMessage,
        details: errorDetails
    });
    
    return {
        success: false,
        error: errorMessage,
        details: errorDetails,
        statusCode: statusCode
    };
}

// Criptografar dados sensíveis
function encryptSensitiveData(data, key) {
    try {
        const cipher = crypto.createCipher('aes-256-cbc', key);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    } catch (error) {
        console.error('Erro ao criptografar dados:', error);
        return null;
    }
}

// Descriptografar dados sensíveis
function decryptSensitiveData(encryptedData, key) {
    try {
        const decipher = crypto.createDecipher('aes-256-cbc', key);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (error) {
        console.error('Erro ao descriptografar dados:', error);
        return null;
    }
}

// ===== ROTAS DE API =====

// Endpoint para registrar acesso à interface
app.post('/api/registrar-acesso', rateLimitMiddleware, async (req, res) => {
    try {
        const { acao, usuario } = req.body;
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent') || '';
        
        const acessoData = {
            acao: acao || 'Acesso',
            usuario: usuario || 'Anônimo',
            ip: ip,
            userAgent: userAgent,
            duracaoSessao: 0,
            status: 'Sucesso'
        };
        
        // FORÇAR INICIALIZAÇÃO DO GOOGLE SHEETS SE NÃO ESTIVER ATIVO
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            console.log('🔄 Google Sheets inativo - tentando inicializar automaticamente para registro de acesso...');
            try {
                const envVars = loadEnvFile();
                envVars.ENABLE_GOOGLE_SHEETS = 'true'; // Forçar ativação
                const success = await googleSheetsIntegration.initialize(envVars);
                if (success) {
                    global.googleSheetsInitialized = true;
                    console.log('✅ Google Sheets inicializado automaticamente para registro de acesso!');
                } else {
                    console.log('❌ Falha ao inicializar Google Sheets automaticamente para registro de acesso');
                }
            } catch (error) {
                console.log('❌ Erro ao inicializar Google Sheets para registro de acesso:', error.message);
            }
        }
        
        // Registrar DIRETAMENTE no Google Sheets se ativo
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.registrarAcessoInterface(acessoData);
                console.log('✅ Acesso registrado DIRETAMENTE no Google Sheets');
            } catch (error) {
                console.error('❌ Erro ao registrar acesso no Google Sheets:', error.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Acesso registrado com sucesso'
        });
        
    } catch (error) {
        console.error('❌ Erro ao registrar acesso:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao registrar acesso'
        });
    }
});

// Rota para verificar status do servidor
app.get('/api/status', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const hasApiKey = validateApiKey(envVars.OPENAI_API_KEY);
        
        // Inicializar Google Sheets se ainda não foi inicializado
        if (!global.googleSheetsInitialized) {
            await initializeGoogleSheets(envVars);
            global.googleSheetsInitialized = true;
        }
        
    res.json({
            success: true,
        status: 'online',
            apiKeyConfigured: hasApiKey,
            environment: process.env.NODE_ENV || 'development',
            vercel: !!process.env.VERCEL,
        timestamp: new Date().toISOString(),
            version: '2.0.0'
        });
        
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Rota para obter configurações públicas (sem dados sensíveis)
app.get('/api/config/public', rateLimitMiddleware, (req, res) => {
    try {
        const envVars = loadEnvFile();
        
        // Retornar apenas configurações públicas
        const publicConfig = {
            OPENAI_MODEL: envVars.OPENAI_MODEL || 'gpt-4o',
            OPENAI_TEMPERATURE: envVars.OPENAI_TEMPERATURE || '0.7',
            OPENAI_MAX_TOKENS: envVars.OPENAI_MAX_TOKENS || '2000',
            OPENAI_BASE_URL: envVars.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            MAX_API_CALLS_PER_HOUR: envVars.MAX_API_CALLS_PER_HOUR || '100',
            APP_NAME: envVars.APP_NAME || 'Velotax Bot',
            APP_VERSION: envVars.APP_VERSION || '2.0.0',
            DEBUG_MODE: envVars.DEBUG_MODE || 'false',
            LOG_LEVEL: envVars.LOG_LEVEL || 'info',
            apiKeyConfigured: validateApiKey(envVars.OPENAI_API_KEY)
        };
        
        res.json({
            success: true,
            config: publicConfig,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Erro ao obter configurações públicas:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: 'Não foi possível carregar as configurações'
        });
    }
});

// Rota para validar chave da API (sem expor a chave)
app.post('/api/validate-key', rateLimitMiddleware, (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não fornecida'
            });
        }
        
        const isValid = validateApiKey(apiKey);
        
        if (isValid) {
            res.json({
                success: true,
                message: 'Chave da API válida',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Chave da API inválida',
                message: 'Formato ou tamanho da chave incorreto'
            });
        }
        
    } catch (error) {
        console.error('Erro ao validar chave:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Rota para testar conexão com OpenAI
app.post('/api/test-openai', rateLimitMiddleware, async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API inválida'
            });
        }
        
        // Fazer teste simples com OpenAI
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: 'Conexão com OpenAI bem-sucedida',
                timestamp: new Date().toISOString()
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
        
    } catch (error) {
        console.error('Erro ao testar OpenAI:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: 'Não foi possível testar a conexão'
        });
    }
});

// Rota para testar a chave configurada automaticamente (sem precisar passar a chave)
app.get('/api/test-openai-configured', rateLimitMiddleware, async (req, res) => {
    try {
        console.log('🔍 Testando chave OpenAI configurada automaticamente...');
        
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        console.log('🔍 Status da chave:', {
            temApiKey: !!apiKey,
            tamanhoApiKey: apiKey ? apiKey.length : 0,
            formatoValido: apiKey ? apiKey.startsWith('sk-') : false
        });
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida',
                details: 'A chave da API não está configurada na Vercel ou está em formato inválido. Verifique as Environment Variables na Vercel.',
                configurada: false,
                formatoValido: false
            });
        }
        
        // Fazer teste simples com OpenAI
        console.log('📡 Testando conexão com OpenAI...');
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            console.log('✅ Conexão com OpenAI bem-sucedida!');
            res.json({
                success: true,
                message: 'Conexão com OpenAI bem-sucedida',
                configurada: true,
                formatoValido: true,
                timestamp: new Date().toISOString()
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            console.error('❌ Erro ao testar OpenAI:', errorResponse);
            res.status(errorResponse.statusCode).json({
                ...errorResponse,
                configurada: true,
                formatoValido: true
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao testar OpenAI:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: 'Não foi possível testar a conexão',
            details: error.message
        });
    }
});

/**
 * Extrai padrões positivos da página "Moderações Aceitas" e calcula pesos dinâmicos
 * FASE 3 - Aprendizado Positivo
 * @param {string} tema - Tema da moderação atual
 * @param {string} motivo - Motivo da moderação atual
 * @returns {Promise<Object>} Objeto com modelos priorizados e pesos
 */
async function extrairPadroesPositivos(tema, motivo) {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return { modelos: [], pesoTotal: 0 };
        }
        
        // Consultar página "Moderações Aceitas"
        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        
        if (!aceitasData || aceitasData.length <= 1) {
            return { modelos: [], pesoTotal: 0 };
        }
        
        // Processar moderações aceitas
        const modelosPorTema = {};
        const hoje = new Date();
        
        for (let i = 1; i < aceitasData.length; i++) {
            const row = aceitasData[i];
            if (!row || row.length < 6) continue;
            
            // Estrutura da planilha "Moderações Aceitas":
            // [0] Data do Registro, [1] ID da Moderação, [2] ID da Reclamação, 
            // [3] Tema, [4] Motivo Utilizado, [5] Texto da Moderação Enviada,
            // [6] Resultado, [7] Solicitação do Cliente, [8] Resposta da Empresa,
            // [9] Consideração Final, [10] Linha de Raciocínio
            const dataRegistro = (row[0] || '').toString().trim();
            const temaRow = (row[3] || 'geral').toString().trim().toLowerCase();
            const motivoRow = (row[4] || '').toString().trim();
            const textoModeracao = (row[5] || '').toString().trim();
            const solicitacaoCliente = (row[7] || '').toString().trim();
            const respostaEmpresa = (row[8] || '').toString().trim();
            const linhaRaciocinio = (row[10] || '').toString().trim();
            
            if (!textoModeracao) continue;
            
            // Normalizar tema para comparação
            const temaNormalized = tema.toString().trim().toLowerCase();
            
            // Verificar se o tema corresponde
            if (temaRow === temaNormalized || 
                temaRow.includes(temaNormalized) || 
                temaNormalized.includes(temaRow)) {
                
                // Criar chave única para o modelo (baseado em estrutura do texto)
                const estruturaTexto = extrairEstruturaTexto(textoModeracao);
                const chaveModelo = `${temaRow}_${estruturaTexto.hash}`;
                
                if (!modelosPorTema[chaveModelo]) {
                    modelosPorTema[chaveModelo] = {
                        tema: temaRow,
                        motivo: motivoRow,
                        textoModeracao: textoModeracao,
                        linhaRaciocinio: linhaRaciocinio,
                        solicitacaoCliente: solicitacaoCliente,
                        respostaEmpresa: respostaEmpresa,
                        estrutura: estruturaTexto,
                        aceites: [],
                        peso: 0
                    };
                }
                
                // Adicionar aceite com data para cálculo de peso
                const dataAceite = parsearData(dataRegistro);
                modelosPorTema[chaveModelo].aceites.push({
                    data: dataAceite,
                    dataStr: dataRegistro
                });
            }
        }
        
        // Calcular pesos dinâmicos para cada modelo
        const modelosComPeso = Object.values(modelosPorTema).map(modelo => {
            const quantidadeAceites = modelo.aceites.length;
            
            // Calcular peso baseado em quantidade e recência
            let pesoQuantidade = quantidadeAceites * 10; // Cada aceite = 10 pontos base
            
            // Bônus de recência (aceites mais recentes valem mais)
            let pesoRecencia = 0;
            modelo.aceites.forEach(aceite => {
                if (aceite.data) {
                    const diasDesdeAceite = (hoje - aceite.data) / (1000 * 60 * 60 * 24);
                    // Aceites dos últimos 30 dias recebem bônus
                    if (diasDesdeAceite <= 30) {
                        pesoRecencia += 5 * (1 - diasDesdeAceite / 30); // Bônus decrescente
                    }
                }
            });
            
            // Peso final
            modelo.peso = pesoQuantidade + pesoRecencia;
            
            return modelo;
        });
        
        // Ordenar por peso (maior primeiro)
        modelosComPeso.sort((a, b) => b.peso - a.peso);
        
        // Calcular peso total do tema
        const pesoTotal = modelosComPeso.reduce((sum, m) => sum + m.peso, 0);
        
        console.log(`📊 FASE 3: Encontrados ${modelosComPeso.length} modelos positivos para tema "${tema}" (peso total: ${pesoTotal.toFixed(2)})`);
        
        return {
            modelos: modelosComPeso,
            pesoTotal: pesoTotal,
            modeloPrincipal: modelosComPeso[0] || null
        };
        
    } catch (error) {
        console.error('❌ Erro ao extrair padrões positivos:', error);
        return { modelos: [], pesoTotal: 0 };
    }
}

/**
 * Extrai estrutura do texto para identificar padrões
 * @param {string} texto - Texto da moderação
 * @returns {Object} Estrutura identificada
 */
function extrairEstruturaTexto(texto) {
    if (!texto) return { hash: 'vazio', abertura: '', fechamento: '', paragrafos: 0 };
    
    const linhas = texto.split('\n').filter(l => l.trim());
    const abertura = linhas[0] || '';
    const fechamento = linhas[linhas.length - 1] || '';
    const paragrafos = texto.split(/\n\s*\n/).filter(p => p.trim()).length;
    
    // Criar hash simples baseado em estrutura
    const hash = `${abertura.substring(0, 20)}_${paragrafos}_${fechamento.substring(0, 20)}`.replace(/\s+/g, '_');
    
    return {
        hash: hash.substring(0, 50),
        abertura: abertura.substring(0, 100),
        fechamento: fechamento.substring(0, 100),
        paragrafos: paragrafos
    };
}

/**
 * Parsear data brasileira para Date object
 * @param {string} dataStr - Data no formato DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
 * @returns {Date|null} Data parseada ou null
 */
function parsearData(dataStr) {
    if (!dataStr) return null;
    try {
        // Formato brasileiro: DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
        const partes = dataStr.split(' ')[0].split('/');
        if (partes.length === 3) {
            const [dia, mes, ano] = partes;
            return new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        }
    } catch (e) {
        // Ignorar erro
    }
    return null;
}

// Função para separar linha de raciocínio e texto de moderação
function separarBlocosModeracao(resposta) {
    if (!resposta) return { linhaRaciocinio: '', textoModeracao: '' };
    
    // Procurar por marcadores que indicam os blocos
    const marcadores = [
        '(1) LINHA DE RACIOCÍNIO INTERNA',
        '(2) TEXTO FINAL DE MODERAÇÃO',
        'LINHA DE RACIOCÍNIO INTERNA',
        'TEXTO FINAL DE MODERAÇÃO',
        '1. LINHA DE RACIOCÍNIO INTERNA',
        '2. TEXTO FINAL DE MODERAÇÃO'
    ];
    
    let linhaRaciocinio = '';
    let textoModeracao = '';
    
    // Tentar separar por marcadores
    for (let i = 0; i < marcadores.length; i += 2) {
        const marcador1 = marcadores[i];
        const marcador2 = marcadores[i + 1];
        
        const index1 = resposta.indexOf(marcador1);
        const index2 = resposta.indexOf(marcador2);
        
        if (index1 !== -1 && index2 !== -1) {
            linhaRaciocinio = resposta.substring(index1 + marcador1.length, index2).trim();
            textoModeracao = resposta.substring(index2 + marcador2.length).trim();
            break;
        }
    }
    
    // Se não encontrou marcadores, tentar separar por quebras de linha duplas
    if (!linhaRaciocinio && !textoModeracao) {
        const partes = resposta.split('\n\n');
        if (partes.length >= 2) {
            linhaRaciocinio = partes[0].trim();
            textoModeracao = partes.slice(1).join('\n\n').trim();
        } else {
            // Se não conseguiu separar, usar toda a resposta como texto final
            textoModeracao = resposta;
        }
    }
    
    return { linhaRaciocinio, textoModeracao };
}

// Rota para gerar moderação via API OpenAI
app.post('/api/generate-moderation', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        const { idReclamacao, dadosModeracao } = req.body;
        
        // Validação obrigatória do ID da reclamação
        if (!idReclamacao || !idReclamacao.trim()) {
            return res.status(400).json({
                success: false,
                error: 'ID da Reclamação (Reclame Aqui) é obrigatório'
            });
        }
        
        // Validar se o ID contém apenas números
        if (!/^\d+$/.test(idReclamacao.trim())) {
            return res.status(400).json({
                success: false,
                error: 'ID da Reclamação deve conter apenas números'
            });
        }
        
        if (!dadosModeracao) {
            return res.status(400).json({
                success: false,
                error: 'Dados de moderação não fornecidos'
            });
        }
        
        // Registrar o ID da reclamação para rastreabilidade
        console.log(`📋 ID da Reclamação registrado: ${idReclamacao}`);
        
        // HIERARQUIA DE APRENDIZADO (FASE 3):
        // 1. APRENDIZADO POSITIVO (Moderações Aceitas - FASE 3) - PRIORIDADE MÁXIMA
        // 2. Moderações Coerentes (sistema existente) - PRIORIDADE MÉDIA
        // 3. Aprendizado Negativo (Moderações Negadas - FASE 2) - PRIORIDADE MÍNIMA (filtro corretivo)
        
        const temaAtual = dadosModeracao.motivoModeracao || 'geral';
        let aprendizadoPositivo = null;
        let aprendizadoPositivoAplicado = false;
        
        // FASE 3 - CONSULTAR APRENDIZADO POSITIVO (PRIORIDADE 1)
        try {
            aprendizadoPositivo = await extrairPadroesPositivos(temaAtual, dadosModeracao.motivoModeracao);
            
            if (aprendizadoPositivo.modelos.length > 0) {
                aprendizadoPositivoAplicado = true;
                console.log(`✅ FASE 3: Aprendizado positivo encontrado - ${aprendizadoPositivo.modelos.length} modelos (peso total: ${aprendizadoPositivo.pesoTotal.toFixed(2)})`);
                console.log(`📊 Modelo principal: peso ${aprendizadoPositivo.modeloPrincipal?.peso.toFixed(2)}`);
            } else {
                console.log(`⚠️ FASE 3: Nenhum modelo positivo encontrado para tema "${temaAtual}"`);
            }
        } catch (error) {
            console.error('⚠️ Erro ao consultar aprendizado positivo (continuando sem ele):', error.message);
        }
        
        // PRIORIDADE 2: Moderações Coerentes (sistema existente) - usar como apoio se não houver muitos aceites
        const modelosRelevantes = await getModelosModeracaoRelevantes(dadosModeracao.motivoModeracao, dadosModeracao);
        
        // PRIORIDADE 3: Feedbacks de erros (sistema existente) - usar como referência secundária
        const feedbacksRelevantes = getRelevantFeedbacks('moderacao', {
            motivoNegativa: dadosModeracao.motivoModeracao,
            dadosModeracao: dadosModeracao
        });
        
        // CONSULTAR APRENDIZADO NEGATIVO (FASE 2) - ANTES DE GERAR O TEXTO
        let aprendizadoNegativo = null;
        let aprendizadoNegativoAplicado = false;
        try {
            if (googleSheetsConfig && googleSheetsConfig.isInitialized()) {
                const temaAtual = dadosModeracao.motivoModeracao || 'geral';
                console.log(`🔍 Consultando aprendizado negativo para tema: ${temaAtual}`);
                
                // Consultar página "Moderações Negadas"
                const negativasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z10000');
                
                if (negativasData && negativasData.length > 1) {
                    // Obter cabeçalhos para busca dinâmica
                    const headers = negativasData[0];
                    
                    // Encontrar índices das colunas importantes
                    const temaIndex = headers.findIndex(h => {
                        if (!h) return false;
                        const hStr = h.toString().trim().toLowerCase();
                        return hStr === 'tema' || hStr.includes('tema');
                    });
                    const erroIndex = headers.findIndex(h => {
                        if (!h) return false;
                        const hStr = h.toString().trim().toLowerCase();
                        return hStr.includes('erro') && hStr.includes('identificado') || 
                               hStr.includes('bloco 2') || 
                               (hStr.includes('erro') && !hStr.includes('correção'));
                    });
                    const correcaoIndex = headers.findIndex(h => {
                        if (!h) return false;
                        const hStr = h.toString().trim().toLowerCase();
                        return hStr.includes('correção') || hStr.includes('correcao') || 
                               hStr.includes('orientação') || hStr.includes('orientacao') ||
                               hStr.includes('bloco 3');
                    });
                    const dataIndex = headers.findIndex(h => {
                        if (!h) return false;
                        const hStr = h.toString().trim().toLowerCase();
                        return hStr.includes('data') && hStr.includes('registro');
                    });
                    
                    console.log(`🔍 Índices encontrados em Moderações Negadas - Tema: ${temaIndex} (esperado: 3), Erro: ${erroIndex} (esperado: 8), Correção: ${correcaoIndex} (esperado: 9), Data: ${dataIndex} (esperado: 0)`);
                    
                    // Filtrar negativas do mesmo tema
                    const negativasRelevantes = [];
                    for (let i = 1; i < negativasData.length; i++) {
                        const row = negativasData[i];
                        if (!row || row.length < 10) continue;
                        
                        // Buscar tema usando índice dinâmico ou fallback para índice fixo
                        const temaNegativa = (temaIndex >= 0 && row[temaIndex] !== undefined 
                            ? row[temaIndex] 
                            : (row[3] || '')).toString().toLowerCase().trim();
                        const temaAtualLower = temaAtual.toString().toLowerCase().trim();
                        
                        // Verificar se o tema corresponde
                        if (temaNegativa === temaAtualLower || 
                            temaNegativa.includes(temaAtualLower) || 
                            temaAtualLower.includes(temaNegativa)) {
                            negativasRelevantes.push({
                                erro: (erroIndex >= 0 && row[erroIndex] !== undefined 
                                    ? row[erroIndex] 
                                    : (row[8] || '')).toString().trim(), // Bloco 2 - Onde a Solicitação Errou
                                correcao: (correcaoIndex >= 0 && row[correcaoIndex] !== undefined 
                                    ? row[correcaoIndex] 
                                    : (row[9] || '')).toString().trim(), // Bloco 3 - Como Corrigir em Próximas Solicitações
                                dataRegistro: (dataIndex >= 0 && row[dataIndex] !== undefined 
                                    ? row[dataIndex] 
                                    : (row[0] || '')).toString().trim() // Data para ordenação
                            });
                        }
                    }
                    
                    if (negativasRelevantes.length > 0) {
                        console.log(`📊 Encontradas ${negativasRelevantes.length} negativas relevantes para aprendizado negativo`);
                        
                        // Ordenar por data (mais recentes primeiro) e extrair padrões
                        negativasRelevantes.sort((a, b) => {
                            const dataA = new Date(a.dataRegistro);
                            const dataB = new Date(b.dataRegistro);
                            return dataB - dataA; // Mais recente primeiro
                        });
                        
                        // Extrair padrões de erro (Bloco 2) e correção (Bloco 3)
                        const errosRecorrentes = negativasRelevantes
                            .map(n => n.erro)
                            .filter(e => e && e.trim())
                            .slice(0, 10); // Aumentado de 5 para 10 erros mais recentes
                        
                        const correcoesRecorrentes = negativasRelevantes
                            .map(n => n.correcao)
                            .filter(c => c && c.trim())
                            .slice(0, 10); // Aumentado de 5 para 10 correções mais recentes
                        
                        if (errosRecorrentes.length > 0 || correcoesRecorrentes.length > 0) {
                            aprendizadoNegativo = {
                                erros: errosRecorrentes, // Bloco 2 - Onde Errou
                                correcoes: correcoesRecorrentes, // Bloco 3 - Como Corrigir
                                totalNegativas: negativasRelevantes.length
                            };
                            aprendizadoNegativoAplicado = true;
                            console.log(`✅ Aprendizado negativo identificado: ${errosRecorrentes.length} erros e ${correcoesRecorrentes.length} correções serão aplicados no prompt`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('⚠️ Erro ao consultar aprendizado negativo (continuando sem ele):', error.message);
        }
        
        let conhecimentoFeedback = '';
        let mensagemTransparencia = '';
        
        // HIERARQUIA DE APRENDIZADO APLICADA NO PROMPT:
        // PRIORIDADE 1: APRENDIZADO POSITIVO (FASE 3) - Modelos Aceitos
        if (aprendizadoPositivoAplicado && aprendizadoPositivo.modeloPrincipal) {
            const modeloPrincipal = aprendizadoPositivo.modeloPrincipal;
            conhecimentoFeedback = '\n\n✅ PRIORIDADE MÁXIMA - MODELO BASEADO EM MODERAÇÕES ACEITAS (FASE 3):\n';
            conhecimentoFeedback += `Este modelo foi selecionado por ter o maior peso (${modeloPrincipal.peso.toFixed(2)}) baseado em ${modeloPrincipal.aceites.length} aceite(s) para o tema "${temaAtual}".\n\n`;
            conhecimentoFeedback += `📊 PESO DO MODELO: ${modeloPrincipal.peso.toFixed(2)} (${modeloPrincipal.aceites.length} aceite(s))\n`;
            conhecimentoFeedback += `🎯 Tema: ${modeloPrincipal.tema}\n`;
            conhecimentoFeedback += `📋 Motivo: ${modeloPrincipal.motivo}\n\n`;
            conhecimentoFeedback += `✅ TEXTO DA MODERAÇÃO ACEITA (SEGUIR ESTE PADRÃO):\n"${modeloPrincipal.textoModeracao}"\n\n`;
            
            if (modeloPrincipal.linhaRaciocinio) {
                conhecimentoFeedback += `📝 Linha de Raciocínio: "${modeloPrincipal.linhaRaciocinio.substring(0, 300)}..."\n\n`;
            }
            
            if (modeloPrincipal.solicitacaoCliente) {
                conhecimentoFeedback += `📋 Contexto - Solicitação do Cliente: "${modeloPrincipal.solicitacaoCliente.substring(0, 200)}..."\n`;
            }
            if (modeloPrincipal.respostaEmpresa) {
                conhecimentoFeedback += `📋 Contexto - Resposta da Empresa: "${modeloPrincipal.respostaEmpresa.substring(0, 200)}..."\n`;
            }
            
            conhecimentoFeedback += '\n🎯 INSTRUÇÃO CRÍTICA: Este é o modelo principal. Use-o como base estrutural e de linguagem. Mantenha a mesma abordagem, tom e sequência lógica. Este modelo foi validado como aceito pelo Reclame Aqui.\n';
            
            // Adicionar outros modelos de alto peso como referência adicional
            const outrosModelosAltoPeso = aprendizadoPositivo.modelos.slice(1, 3); // Próximos 2 modelos
            if (outrosModelosAltoPeso.length > 0) {
                conhecimentoFeedback += '\n📚 OUTROS MODELOS ACEITOS DE ALTO PESO (REFERÊNCIA ADICIONAL):\n';
                outrosModelosAltoPeso.forEach((modelo, index) => {
                    conhecimentoFeedback += `${index + 1}. Peso: ${modelo.peso.toFixed(2)} (${modelo.aceites.length} aceite(s))\n`;
                    conhecimentoFeedback += `   Texto: "${modelo.textoModeracao.substring(0, 250)}..."\n\n`;
                });
            }
            
            mensagemTransparencia = 'Esta moderação foi baseada em modelos previamente aceitos para este tema, com ajustes para evitar erros identificados em negativas anteriores.';
        }
        
        // PRIORIDADE 2: MODERAÇÕES COERENTES (sistema existente) - usar como apoio
        if (modelosRelevantes.length > 0) {
            if (conhecimentoFeedback) {
                conhecimentoFeedback += '\n\n📖 PRIORIDADE MÉDIA - MODELOS COERENTES (APOIO):\n';
                conhecimentoFeedback += `Baseado em ${modelosRelevantes.length} moderações marcadas como coerentes para "${dadosModeracao.motivoModeracao}":\n\n`;
            } else {
                conhecimentoFeedback = '\n\n📖 MODELOS DE MODERAÇÃO COERENTES (SEGUIR ESTE PADRÃO):\n';
                conhecimentoFeedback += `Baseado em ${modelosRelevantes.length} moderações aprovadas para "${dadosModeracao.motivoModeracao}":\n\n`;
            }
            
            modelosRelevantes.slice(0, 3).forEach((modelo, index) => { // Limitar a 3 modelos coerentes
                conhecimentoFeedback += `${index + 1}. 📅 Data: ${modelo.timestamp} (Score: ${modelo.relevanceScore})\n`;
                conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivoModeracao}\n`;
                conhecimentoFeedback += `   📝 Linha de raciocínio: "${modelo.linhaRaciocinio.substring(0, 200)}..."\n`;
                conhecimentoFeedback += `   ✅ Texto coerente: "${modelo.textoModeracao.substring(0, 300)}..."\n\n`;
            });
            
            if (!aprendizadoPositivoAplicado) {
                conhecimentoFeedback += '🎯 INSTRUÇÃO: Use estes modelos coerentes como referência para gerar uma moderação de alta qualidade.\n';
            } else {
                conhecimentoFeedback += '🎯 INSTRUÇÃO: Use estes modelos coerentes como referência complementar ao modelo principal aceito.\n';
            }
        }
        
        // PRIORIDADE 3: APRENDIZADO NEGATIVO (FASE 2) - Filtro Corretivo
        if (aprendizadoNegativoAplicado && aprendizadoNegativo) {
            if (conhecimentoFeedback) {
                conhecimentoFeedback += '\n\n🔴 PRIORIDADE MÍNIMA - APRENDIZADO NEGATIVO (FILTRO CORRETIVO - FASE 2):\n';
            } else {
                conhecimentoFeedback = '\n\n🔴 APRENDIZADO NEGATIVO - ERROS A EVITAR (FASE 2):\n';
            }
            
            conhecimentoFeedback += `⚠️ ATENÇÃO: Baseado em ${aprendizadoNegativo.totalNegativas || 0} moderação(ões) negada(s) anterior(es) do mesmo tema, aplique estas correções para evitar erros já identificados:\n\n`;
            
            // BLOCO 2 - ONDE A SOLICITAÇÃO ERROU (O que NÃO fazer)
            if (aprendizadoNegativo.erros && aprendizadoNegativo.erros.length > 0) {
                conhecimentoFeedback += '🟡 BLOCO 2 - ONDE AS SOLICITAÇÕES ANTERIORES ERRARAM (NÃO FAÇA ISSO):\n';
                conhecimentoFeedback += 'Estes são os erros técnicos identificados em moderações negadas do mesmo tema. EVITE estes padrões:\n\n';
                aprendizadoNegativo.erros.forEach((erro, index) => {
                    conhecimentoFeedback += `${index + 1}. ${erro}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // BLOCO 3 - COMO CORRIGIR (O que FAZER)
            if (aprendizadoNegativo.correcoes && aprendizadoNegativo.correcoes.length > 0) {
                conhecimentoFeedback += '🟢 BLOCO 3 - COMO CORRIGIR EM PRÓXIMAS SOLICITAÇÕES (FAÇA ISSO):\n';
                conhecimentoFeedback += 'Estas são as orientações práticas baseadas nas análises de moderações negadas. SIGA estas diretrizes:\n\n';
                aprendizadoNegativo.correcoes.forEach((correcao, index) => {
                    conhecimentoFeedback += `${index + 1}. ${correcao}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: O aprendizado negativo NUNCA cria texto do zero. Ele apenas CORRIGE o modelo positivo/coerente removendo estruturas problemáticas identificadas no Bloco 2 e aplicando as orientações do Bloco 3. Mantenha a estrutura base do modelo aceito, apenas removendo os erros identificados e seguindo as correções sugeridas.\n';
        }
        
        // PRIORIDADE 4: FEEDBACKS DE ERROS (sistema legado) - referência secundária
        if (feedbacksRelevantes.length > 0) {
            if (conhecimentoFeedback) {
                conhecimentoFeedback += '\n\n⚠️ FEEDBACKS LEGADOS (REFERÊNCIA SECUNDÁRIA):\n';
            } else {
                conhecimentoFeedback = '\n\n🧠 CONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES DE MODERAÇÃO:\n';
            }
            
            conhecimentoFeedback += `Baseado em ${feedbacksRelevantes.length} moderações negadas anteriormente, evite os seguintes erros:\n\n`;
            
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. ❌ ERRO IDENTIFICADO: "${fb.motivoNegativa}" (Score: ${fb.relevanceScore})\n`;
                conhecimentoFeedback += `   📝 Texto original negado: "${fb.textoNegado.substring(0, 250)}..."\n`;
                conhecimentoFeedback += `   ✅ Texto reformulado aprovado: "${fb.textoReformulado.substring(0, 250)}..."\n`;
                
                // Incluir contexto do feedback se disponível
                if (fb.dadosModeracao) {
                    conhecimentoFeedback += `   📋 Contexto: Solicitação: "${fb.dadosModeracao.solicitacaoCliente?.substring(0, 100)}..."\n`;
                    conhecimentoFeedback += `   📋 Resposta: "${fb.dadosModeracao.respostaEmpresa?.substring(0, 100)}..."\n`;
                }
                conhecimentoFeedback += '\n';
            });
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este conhecimento para evitar erros similares e aplicar as correções identificadas. Analise os padrões de erro e garanta que sua moderação não repita os mesmos problemas.\n';
        }
        
        const prompt = `
📌 SCRIPT ESTRUTURADO PARA FORMULAÇÃO DE MODERAÇÃO RA

Você é responsável por elaborar solicitações de moderação no Reclame Aqui seguindo o fluxo lógico estruturado abaixo.

INFORMAÇÕES DISPONÍVEIS:
- Solicitação do cliente: ${dadosModeracao.solicitacaoCliente}
- Resposta da empresa: ${dadosModeracao.respostaEmpresa}
- Consideração final do consumidor: ${dadosModeracao.consideracaoFinal}
- Motivo da moderação: ${dadosModeracao.motivoModeracao}

${conhecimentoFeedback || ''}

⚙️ FLUXO LÓGICO OBRIGATÓRIO (siga sem pular etapas):

1. ANÁLISE DO CONTEÚDO REAL:
- Analise a SOLICITAÇÃO DO CLIENTE: identifique o problema alegado, acusações feitas, pedidos solicitados
- Analise a RESPOSTA DA EMPRESA: verifique se a empresa respondeu adequadamente, se ofereceu solução, se esclareceu fatos
- Analise a CONSIDERAÇÃO FINAL DO CONSUMIDOR: verifique se o cliente aceitou a solução, se insistiu no problema, se trouxe novas alegações, se omitiu informações

2. CONSULTA E VALIDAÇÃO NORMATIVA (etapa obrigatória):
Com base no conteúdo analisado, verifique os 3 manuais oficiais do RA:
- Manual Geral de Moderação
- Manual de Moderação RA Reviews  
- Manual de Moderação – Bancos, Instituições Financeiras e Meios

Identifique violações específicas:
- Há informações incorretas ou que não condizem com os registros internos no conteúdo?
- O caso já estava resolvido antes da abertura da reclamação?
- Houve omissão da solução aplicada na plataforma pelo cliente?
- Há linguagem ofensiva, acusações genéricas ou sem provas?
- Existe duplicidade (mesmo cliente, mesmo caso)?
- Para bancos/financeiras: há citação incorreta de cláusula contratual, ou omissão de previsão contratual aceita pelo cliente?

3. REVISÃO CONTRATUAL E FACTUAL:
- Confronte o conteúdo da reclamação/consideração com registros internos e cláusulas contratuais
- Identifique divergências entre o que foi alegado e os fatos reais
- Verifique se há omissão de informações importantes pelo cliente
- Confirme se a solução já foi implementada e não foi mencionada pelo cliente

4. CONSTRUÇÃO DA LINHA DE RACIOCÍNIO INTERNA:
Esse bloco não vai para o RA, mas é obrigatório na saída. Estrutura:
- Análise do conteúdo: resuma o que o cliente alegou, como a empresa respondeu, e o que o cliente disse na consideração final
- Fatos reais comprovados: descreva o que realmente ocorreu, com datas, registros e documentos (internos ou oficiais)
- Divergência/violação identificada: aponte especificamente onde o conteúdo (solicitação, resposta ou consideração) contém informações incorretas, está desatualizado ou infringe regras do RA
- Base normativa: indique explicitamente:
  * Qual manual do RA dá respaldo (citar manual + seção, se aplicável)
  * Qual cláusula contratual ou termo aceito pelo cliente fundamenta o pedido
  * Qual regra específica foi violada pelo conteúdo analisado

5. CONSTRUÇÃO DA RESPOSTA FINAL DE MODERAÇÃO:
Esse é o texto que vai ser enviado ao RA. Deve ser:
- Baseado na análise real do conteúdo (solicitação, resposta, consideração)
- Objetivo e técnico, utilizando termos objetivos e técnicos
- Impessoal (sem "eu", "nós sentimos", etc.)
- Sem tom emocional ou juízo de valor
- Estruturado em 3 parágrafos curtos
- Focado nos fatos e provas, sem dar impressão de defesa contra o cliente
- Priorizar a exposição clara da solução já aplicada e a divergência objetiva com o relato

MODELO FIXO OBRIGATÓRIO - USE EXATAMENTE ESTA ESTRUTURA:

TEXTO FINAL DE MODERAÇÃO (a ser enviado ao RA):
"Prezados,

Solicitamos a moderação da reclamação em questão, tendo em vista que [explique o motivo objetivo baseado na análise do conteúdo real - solicitação, resposta e consideração final do consumidor].

Conforme registros internos e documentação de suporte, [descrever de forma resumida os fatos corretos que não condizem com o que foi apresentado pelo cliente]. Ressaltamos que [especificar qual parte do conteúdo - solicitação, resposta ou consideração - contém informações incorretas], enquadrando-se na hipótese específica de moderação "[informação incorreta sobre solução já aplicada]" prevista no [manual aplicável específico].

Dessa forma, solicitamos a moderação da publicação, conforme regras vigentes da plataforma."

⚠️ IMPORTANTE: O texto final DEVE seguir EXATAMENTE esta estrutura de 3 parágrafos. NÃO use outros formatos como "Prezados Senhores", "Atenciosamente", ou estruturas diferentes.

6. SAÍDA FINAL OBRIGATÓRIA:
A resposta deve conter EXATAMENTE dois blocos:
(1) LINHA DE RACIOCÍNIO INTERNA (explicação do processo)
(2) TEXTO FINAL DE MODERAÇÃO (a ser enviado ao RA)

📋 DICAS CRÍTICAS PARA FORMULAÇÃO DE MODERAÇÃO:

1. CONSULTE SEMPRE OS MANUAIS DO RA:
- Manual Geral de Moderação → regras universais (informação falsa, ofensas, duplicidade)
- Manual RA Reviews → foco em avaliações e comentários de reputação
- Manual de Bancos, Instituições Financeiras e Meios → regras específicas para operações financeiras, contratos, CCB, termos aceitos
⚠️ NÃO PULE ESSA PARTE: o RA pode negar a moderação se o pedido não se apoiar nas regras deles

2. VERIFIQUE OS REGISTROS INTERNOS ANTES DE ESCREVER:
- Data da contratação ou operação
- Status real da solicitação (ex.: quitação antecipada, reagendamento BB, restituição no eCAC)
- Situação da chave Pix (se estava vinculada, portabilizada, ou desvinculada)
- Evidências objetivas: prints, protocolos, comprovantes

3. COMPARE A RECLAMAÇÃO COM OS FATOS:
- O cliente alegou algo que já foi resolvido antes da abertura no RA?
- Há omissão da solução aplicada?
- A descrição do cliente contraria cláusulas aceitas em contrato (ex.: vínculo da chave Pix na CCB)?
- O texto contém linguagem ofensiva ou acusação sem prova?

4. NA LINHA DE RACIOCÍNIO INTERNA, NUNCA ESQUEÇA:
- Fatos reais comprovados → cite data, registro, operação
- Divergência clara → onde o cliente erra ou omite
- Base normativa → diga "conforme Manual Geral de Moderação", "conforme Cláusula 7 da CCB", etc.

5. NA REDAÇÃO FINAL (TEXTO AO RA), SIGA O TOM:
- Técnico, claro e objetivo
- Impessoal (nada de "entendemos sua frustração")
- Estrutura em 3 parágrafos curtos:
  * Motivo objetivo do pedido
  * Fatos internos que comprovam a divergência
  * Solicitação de adequação/exclusão conforme regras do RA

6. NUNCA PEÇA MODERAÇÃO POR MOTIVO FRÁGIL:
- Não basta "não gostar" do comentário
- Só peça moderação se:
  * Violou regra do RA
  * Está em desacordo com fatos comprováveis
  * Houve solução omitida
  * Houve quebra de diretriz contratual clara

7. CITE O MANUAL/CAPÍTULO SEMPRE QUE POSSÍVEL:
- Exemplo: "conforme previsto no Manual Geral de Moderação (item de informações falsas)"
- Exemplo: "em linha com o Manual de Bancos, que prevê correção de informações contratuais incorretas"
- Isso mostra base sólida e aumenta as chances de aprovação

🎯 TRIPÉ DA MODERAÇÃO: registre fatos + aponte divergência + fundamente em manual/contrato

IMPORTANTE: Use o conhecimento dos feedbacks anteriores para gerar um texto de moderação de alta qualidade desde o início, evitando negativas do RA.

Execute o fluxo completo e forneça os dois blocos solicitados.

FORMATO DE SAÍDA OBRIGATÓRIO:
(1) LINHA DE RACIOCÍNIO INTERNA (explicação do processo)
[Conteúdo da linha de raciocínio interna]

(2) TEXTO FINAL DE MODERAÇÃO (a ser enviado ao RA)
[Texto seguindo EXATAMENTE o modelo fixo de 3 parágrafos acima]

⚠️ CRÍTICO: O texto final DEVE começar com "Prezados," e seguir exatamente a estrutura de 3 parágrafos definida. NÃO use variações.

🚫 PROIBIDO: NÃO cite os dados de entrada (solicitação do cliente, resposta da empresa, consideração final) literalmente. Analise o conteúdo e formule baseado na análise, não na citação dos dados.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um especialista em Reclame Aqui, com foco em formulação de textos de moderação.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            let resposta = data.choices[0].message.content;
            
            // Validação pós-processamento para moderação - NUNCA usar resposta genérica
            const palavrasGenericas = [
                'situação atual', 'detalhes específicos não foram compartilhados', 
                'nossa equipe está comprometida', 'analisar todas as solicitações',
                'embora os detalhes específicos', 'gostaríamos de assegurar',
                'caso a sua solicitação envolva', 'estamos aqui para esclarecer',
                'sua situação atual necessitou', 'detalhes específicos do seu caso'
            ];
            
            const temGenericas = palavrasGenericas.some(palavra => 
                resposta.toLowerCase().includes(palavra)
            );
            
            // Verificar se a resposta foi gerada com aprendizado (contém conhecimentoFeedback)
            const temAprendizado = conhecimentoFeedback && conhecimentoFeedback.length > 100;
            
            if (temAprendizado) {
                console.log('✅ Moderação gerada com aprendizado positivo aplicado');
            } else {
                console.log('⚠️ Moderação genérica detectada - usando resposta da IA mesmo assim');
                console.log('📝 A IA deve seguir o script estruturado definido no prompt');
            }
            
            // Separar linha de raciocínio e texto de moderação
            const partes = separarBlocosModeracao(resposta);
            const linhaRaciocinio = partes.linhaRaciocinio || '';
            const textoModeracao = partes.textoModeracao || resposta;
            
            // Gerar ID único para a moderação
            const moderacaoId = Date.now();
            
            // Salvar moderação inicial na planilha "Moderações" com ID da reclamação
            if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
                try {
                    console.log('💾 Salvando moderação inicial na planilha "Moderações"...');
                    const moderacaoData = {
                        id: moderacaoId,
                        idReclamacao: idReclamacao.trim(), // ID da Reclamação
                        tipo: 'moderacao',
                        dadosModeracao: dadosModeracao,
                        linhaRaciocinio: linhaRaciocinio,
                        textoModeracao: textoModeracao,
                        textoFinal: textoModeracao,
                        userProfile: req.userData ? `${req.userData.nome} (${req.userData.email})` : 'N/A',
                        userName: req.userData?.nome || 'N/A',
                        userEmail: req.userData?.email || 'N/A'
                    };
                    
                    // Usar função existente para salvar moderação coerente (mesma estrutura)
                    const resultado = await googleSheetsIntegration.registrarModeracaoCoerente(moderacaoData);
                    if (resultado) {
                        console.log(`✅ Moderação inicial salva na planilha "Moderações" com ID: ${moderacaoId} e ID da Reclamação: ${idReclamacao}`);
                    } else {
                        console.log('⚠️ Falha ao salvar moderação inicial no Google Sheets');
                    }
                } catch (error) {
                    console.error('❌ Erro ao salvar moderação inicial:', error.message);
                    // Não bloquear a resposta se houver erro ao salvar
                }
            }
            
            // Aprendizado negativo já foi consultado antes da geração e incluído no prompt
            
            // Incrementar estatística global
            await incrementarEstatisticaGlobal('moderacoes_geradas');
            
            // Mensagem de transparência (FASE 3)
            let mensagemTransparenciaFinal = null;
            if (aprendizadoPositivoAplicado) {
                mensagemTransparenciaFinal = mensagemTransparencia || 
                    'Esta moderação foi baseada em modelos previamente aceitos para este tema, com ajustes para evitar erros identificados em negativas anteriores.';
            } else if (aprendizadoNegativoAplicado) {
                mensagemTransparenciaFinal = 'Esta moderação foi baseada em modelos coerentes e ajustada para evitar erros identificados em negativas anteriores deste tema.';
            }
            
            res.json({
                success: true,
                result: resposta,
                moderacaoId: moderacaoId, // Retornar ID da moderação para uso no frontend
                aprendizadoPositivoAplicado: aprendizadoPositivoAplicado,
                aprendizadoNegativoAplicado: aprendizadoNegativoAplicado,
                pesoModeloPrincipal: aprendizadoPositivo?.modeloPrincipal?.peso || null,
                quantidadeAceites: aprendizadoPositivo?.modeloPrincipal?.aceites?.length || null,
                mensagem: mensagemTransparenciaFinal
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
    } catch (error) {
        console.error('Erro ao gerar moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para gerar e-mail formal via API OpenAI
app.post('/api/generate-email', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        const { tipoEmail, destinatario, contexto } = req.body;
        
        // Validações
        if (!tipoEmail) {
            return res.status(400).json({
                success: false,
                error: 'Tipo de e-mail é obrigatório'
            });
        }
        
        if (!contexto || !contexto.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Contexto é obrigatório'
            });
        }
        
        // Construir prompt baseado no tipo de e-mail
        let prompt = `Estruturação Inteligente de E-mails Formais
Papel do sistema

Você é um redator corporativo especializado em comunicação institucional, atendimento ao cliente, moderação no Reclame Aqui e comunicações de natureza jurídica, atuando no padrão Velotax.
Seu objetivo é transformar o conteúdo informado no campo "Contexto" em um e-mail completo, com assunto, corpo estruturado, linguagem adequada ao destinatário e tom coerente com o tipo de e-mail selecionado.

Você não deve apenas reorganizar informações:
👉 deve formular, lapidar e redigir o e-mail final, pronto para envio.

Entrada de dados (preenchida pelo agente)

Tipo de E-mail: ${tipoEmail}
Destinatário: ${destinatario || 'Não especificado'}
Contexto: ${contexto}

Regras Gerais de Geração (válidas para todos os tipos)

Sempre gerar:

Assunto do e-mail (claro, objetivo e coerente com o conteúdo).

Saudação inicial adequada ao destinatário.

Corpo do e-mail estruturado em parágrafos, com boa fluidez.

Encerramento profissional.

Assinatura padrão:
Equipe Velotax.

Linguagem:

Português formal.

Gramática revisada.

Texto claro, direto e profissional.

Sem emojis, sem informalidades excessivas.

Nunca:

Copiar o texto do contexto de forma literal.

Listar informações soltas.

Produzir respostas genéricas ou vagas.

Criar leis, artigos ou fundamentos jurídicos inexistentes.

`;

        // Adicionar instruções específicas por tipo
        if (tipoEmail === 'resposta-cliente') {
            prompt += `Estrutura e Estilo por Tipo de E-mail
1. Tipo: Resposta a Cliente

Objetivo
Responder clientes quando não houve contato bem-sucedido ou quando a resposta precisa ser formalizada por e-mail, mantendo empatia e clareza.

Tom

Friendly profissional.

Cordial, respeitoso e acessível.

Mais formal que chat/WhatsApp, mas sem rigidez excessiva.

Estrutura obrigatória

Saudação personalizada ao cliente.

Contextualização breve do motivo do contato.

Explicação clara e organizada da situação, baseada no contexto informado.

Orientações, próximos passos ou esclarecimentos necessários.

Disponibilidade para contato e suporte.

Encerramento cordial.

Assunto

Deve ser gerado automaticamente com base no tema central do e-mail
Ex.:

"Retorno sobre sua solicitação"

"Atualização sobre seu atendimento"

"Esclarecimentos sobre sua solicitação no Velotax"
`;
        } else if (tipoEmail === 'solicitacao-moderacao') {
            prompt += `Estrutura e Estilo por Tipo de E-mail
2. Tipo: Solicitação de Moderação

Objetivo
Redigir e-mails formais de recorrência de moderação ao Reclame Aqui, quando a moderação já foi negada e está sendo reapresentada por e-mail.

Tom

Técnico, respeitoso e institucional.

Neutro, sem confronto.

Foco em fatos, coerência e clareza.

Total alinhamento com boas práticas de moderação.

Estrutura obrigatória

Saudação institucional ao time do Reclame Aqui.

Identificação objetiva do pedido:

Solicitação de moderação e/ou anulação de nota.

Citação do ID da reclamação, quando informado no contexto.

Contextualização resumida do caso.

Exposição estruturada dos fatos relevantes, podendo organizar em parágrafos explicativos (não listas secas).

Demonstração clara de que:

Não houve falha na prestação do serviço.

Não houve descumprimento de oferta.

O atendimento foi prestado de forma transparente, documentada e tempestiva.

Justificativa objetiva de por que o relato publicado contém:

Informação incorreta, distorcida ou desconectada da realidade dos fatos.

Pedido formal e respeitoso de:

Moderação e/ou anulação da nota.

Disponibilidade para envio de documentos complementares.

Encerramento cordial e institucional.

Assunto

Claro e técnico.
Ex.:

"Solicitação de moderação – Reclamação ID XXXXX"

"Pedido de reavaliação de moderação – Velotax"
`;
        } else if (tipoEmail === 'juridico') {
            prompt += `Estrutura e Estilo por Tipo de E-mail
3. Tipo: Jurídico

Objetivo
Comunicações formais com teor jurídico-institucional.

Tom

Extremamente formal.

Impessoal e técnico.

Linguagem jurídica ("juridiquês" leve).

Sem emotividade, sem proximidade excessiva.

Regras específicas

Não criar nem citar leis, artigos ou dispositivos legais, a menos que estejam explicitamente no contexto.

Priorizar clareza, formalidade e precisão linguística.

Estrutura obrigatória

Saudação formal e impessoal.

Identificação objetiva do assunto.

Exposição clara e organizada dos fatos.

Posicionamento institucional da empresa.

Encerramento formal e protocolar.

Assunto

Direto, técnico e institucional.
Ex.:

"Comunicação institucional – Velotax"

"Posicionamento formal sobre o caso informado"
`;
        }
        
        prompt += `

Saída esperada do sistema

O sistema deve retornar APENAS o e-mail completo, formatado da seguinte forma:

ASSUNTO: [assunto gerado]

[corpo completo do e-mail, pronto para envio, formatado em texto corrido, com parágrafos bem definidos e linguagem adequada ao tipo selecionado]

IMPORTANTE: Retorne APENAS o e-mail formatado conforme acima, sem explicações adicionais, sem comentários, sem metadados.`;

        console.log('📧 Gerando e-mail formal via OpenAI...');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um redator corporativo especializado em comunicação institucional, atendimento ao cliente, moderação no Reclame Aqui e comunicações de natureza jurídica, atuando no padrão Velotax. Você transforma contexto em e-mails formais completos e profissionais, prontos para envio.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('❌ Erro na API OpenAI:', errorData);
            return res.status(500).json({
                success: false,
                error: 'Erro ao gerar e-mail',
                details: errorData.error?.message || 'Erro desconhecido na API OpenAI'
            });
        }

        const data = await response.json();
        const emailGerado = data.choices[0]?.message?.content || '';

        if (!emailGerado) {
            return res.status(500).json({
                success: false,
                error: 'Resposta vazia da API OpenAI'
            });
        }

        console.log('✅ E-mail gerado com sucesso');

        res.json({
            success: true,
            email: emailGerado
        });

    } catch (error) {
        console.error('❌ Erro ao gerar e-mail:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para gerar resposta RA via API OpenAI (endpoint com sistema de aprendizado completo)
app.post('/api/generate-response', rateLimitMiddleware, async (req, res) => {
    console.log('=================================');
    console.log('🔥🔥🔥 ENTRADA NO ENDPOINT /api/generate-response 🔥🔥🔥');
    console.log('=================================');
    let timeoutId;
    try {
        console.log('🔥 DENTRO DO TRY - INICIANDO PROCESSAMENTO');
        const { dadosFormulario, userData } = req.body;
        console.log('🎯 Endpoint /api/generate-response chamado');
        console.log('👤 Usuário que fez a solicitação:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
        console.log('📋 Tipo de solicitação:', dadosFormulario?.tipo_solicitacao || 'N/A');
        console.log('🚀 INICIANDO SISTEMA DE APRENDIZADO...');
        
        // DEBUG: Verificar dados recebidos
        console.log('🔍 DEBUG - Dados recebidos:', {
            temDadosFormulario: !!dadosFormulario,
            temUserData: !!userData,
            tipoSolicitacao: dadosFormulario?.tipo_solicitacao
        });
        
        console.log('🔍 DEBUG - Carregando variáveis de ambiente...');
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        console.log('🔍 DEBUG - Validando API Key...', {
            temApiKey: !!apiKey,
            tamanhoApiKey: apiKey ? apiKey.length : 0
        });
        
        if (!validateApiKey(apiKey)) {
            console.log('❌ DEBUG - API Key inválida');
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        if (!dadosFormulario) {
            console.log('❌ DEBUG - Dados do formulário não fornecidos');
            return res.status(400).json({
                success: false,
                error: 'Dados do formulário não fornecidos'
            });
        }
        
        console.log('📋 Dados recebidos do formulário:', {
            tipo_solicitacao: dadosFormulario.tipo_solicitacao,
            motivo_solicitacao: dadosFormulario.motivo_solicitacao,
            solucao_implementada: dadosFormulario.solucao_implementada?.substring(0, 100) + '...',
            texto_cliente: dadosFormulario.texto_cliente?.substring(0, 100) + '...',
            historico_atendimento: dadosFormulario.historico_atendimento?.substring(0, 50) + '...',
            nome_solicitante: dadosFormulario.nome_solicitante || 'não informado'
        });
        
        // SISTEMA DE APRENDIZADO SIMPLES E DIRETO
        let conhecimentoFeedback = '';
        let modelosCoerentes = [];
        let feedbacksRelevantes = [];
        
        console.log('🧠 SISTEMA DE APRENDIZADO SIMPLES: Iniciando consulta direta à planilha...');
        
        // Verificar se Google Sheets está ativo
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                console.log('📚 CONSULTANDO PLANILHA DIRETAMENTE...');
                
                // Carregar modelos coerentes da planilha
                modelosCoerentes = await carregarModelosCoerentesDaPlanilha(dadosFormulario.tipo_solicitacao);
                console.log(`✅ MODELOS ENCONTRADOS: ${modelosCoerentes.length} modelos coerentes na planilha`);
                
                // Carregar feedbacks da planilha
                feedbacksRelevantes = await carregarFeedbacksRelevantesDaPlanilha(dadosFormulario.tipo_solicitacao);
                console.log(`✅ FEEDBACKS ENCONTRADOS: ${feedbacksRelevantes.length} feedbacks relevantes na planilha`);
                
                // APLICAR MODELOS COERENTES
                if (modelosCoerentes.length > 0) {
                    console.log('🎯 APLICANDO MODELOS COERENTES DA PLANILHA!');
                    conhecimentoFeedback += '\n\n🧠 MODELOS COERENTES DA PLANILHA (SEGUIR ESTE PADRÃO):\n';
                    conhecimentoFeedback += `Baseado em ${modelosCoerentes.length} respostas aprovadas como "coerentes" para situações similares:\n\n`;
                    
                    modelosCoerentes.forEach((modelo, index) => {
                        const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
                        // Pular modelos sem resposta válida
                        if (!resposta || resposta.trim().length === 0) {
                            return;
                        }
                        
                        conhecimentoFeedback += `📋 MODELO ${index + 1} (${modelo.tipo_situacao || modelo.dadosFormulario?.tipo_solicitacao || modelo['Tipo Solicitação'] || 'N/A'}):\n`;
                        conhecimentoFeedback += `   📅 Data: ${modelo.timestamp || 'N/A'}\n`;
                        conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao || modelo['Motivo Solicitação'] || 'N/A'}\n`;
                        conhecimentoFeedback += `   🔧 Solução: ${modelo.solucao_implementada || modelo.dadosFormulario?.solucao_implementada || modelo['Solução Implementada'] || 'N/A'}\n`;
                        conhecimentoFeedback += `   📝 Resposta aprovada: "${resposta.substring(0, 400)}${resposta.length > 400 ? '...' : ''}"\n\n`;
                    });
                    
                    conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use estes modelos como base para sua resposta. Mantenha a mesma estrutura, tom e abordagem dos modelos aprovados.\n';
                } else {
                    console.log('⚠️ NENHUM MODELO COERENTE ENCONTRADO na planilha para esta solicitação');
                }
                
                // APLICAR FEEDBACKS RELEVANTES
                if (feedbacksRelevantes.length > 0) {
                    console.log('🎯 APLICANDO FEEDBACKS DA PLANILHA!');
                    conhecimentoFeedback += '\n\n⚠️ FEEDBACKS DA PLANILHA (EVITAR ESTES ERROS):\n';
                    conhecimentoFeedback += `Baseado em ${feedbacksRelevantes.length} feedbacks de situações similares:\n\n`;
                    
                    feedbacksRelevantes.forEach((fb, index) => {
                        conhecimentoFeedback += `${index + 1}. ❌ ERRO: "${fb.feedback}"\n`;
                        conhecimentoFeedback += `   📝 Resposta original: "${fb.respostaAnterior?.substring(0, 150) || 'N/A'}..."\n`;
                        conhecimentoFeedback += `   ✅ Resposta corrigida: "${fb.respostaReformulada?.substring(0, 150) || 'N/A'}..."\n\n`;
                    });
                    
                    conhecimentoFeedback += '🎯 INSTRUÇÃO: Use este conhecimento para evitar erros similares.\n';
                } else {
                    console.log('⚠️ NENHUM FEEDBACK RELEVANTE ENCONTRADO na planilha para esta solicitação');
                }
                
            } catch (error) {
                console.error('❌ ERRO ao consultar planilha:', error.message);
                console.log('🔄 Continuando sem aprendizado da planilha...');
            }
        } else {
            console.log('⚠️ GOOGLE SHEETS INATIVO - Continuando sem aprendizado da planilha');
        }
        
        // ADICIONAR CONHECIMENTO DE PRODUTOS SE MENCIONADOS
        const conhecimentoProdutos = obterConhecimentoProdutos(dadosFormulario);
        if (conhecimentoProdutos) {
            conhecimentoFeedback += conhecimentoProdutos;
            console.log('✅ CONHECIMENTO DE PRODUTOS INCLUÍDO NO PROMPT');
        }
        
        // Verificar se o conhecimento foi construído
        if (conhecimentoFeedback && conhecimentoFeedback.length > 100) {
            console.log('✅ CONHECIMENTO DA PLANILHA INCLUÍDO NO PROMPT');
            console.log('📊 Estatísticas do conhecimento:');
            console.log(`   - Tamanho: ${conhecimentoFeedback.length} caracteres`);
            console.log(`   - Contém modelos: ${conhecimentoFeedback.includes('MODELOS COERENTES')}`);
            console.log(`   - Contém feedbacks: ${conhecimentoFeedback.includes('FEEDBACKS DA PLANILHA')}`);
            console.log(`   - Contém produtos: ${conhecimentoFeedback.includes('CONHECIMENTO DO PRODUTO')}`);
        } else {
            console.log('⚠️ NENHUM CONHECIMENTO DA PLANILHA DISPONÍVEL');
            console.log('📝 Tamanho do conhecimento:', conhecimentoFeedback?.length || 0);
        }

        const prompt = `📌 GERAÇÃO DE RESPOSTA RA COM SISTEMA DE APRENDIZADO ATIVADO

Você é responsável por gerar respostas para o Reclame Aqui seguindo o script estruturado e aplicando o conhecimento dos modelos coerentes.

DADOS DE ENTRADA:
- Tipo de solicitação: ${dadosFormulario.tipo_solicitacao}
- Motivo da solicitação: ${dadosFormulario.motivo_solicitacao}
- Solução implementada: ${dadosFormulario.solucao_implementada}
- Texto do cliente: ${dadosFormulario.texto_cliente}
- Histórico de atendimento: ${dadosFormulario.historico_atendimento}
- Observações internas: ${dadosFormulario.observacoes_internas}

${conhecimentoFeedback || ''}

⚙️ FLUXO LÓGICO OBRIGATÓRIO (siga sem pular etapas):

1. ANÁLISE DA SITUAÇÃO:
- Identifique o tipo de solicitação (exclusão, portabilidade, quitação, etc.)
- Analise o contexto específico (motivo, solução implementada, histórico)
- Considere as observações internas e histórico de atendimento

2. APLICAÇÃO DO CONHECIMENTO:
- Use os modelos coerentes como referência para estrutura e tom
- Evite os erros identificados nos feedbacks
- Mantenha consistência com respostas aprovadas anteriormente

3. GERAÇÃO DA RESPOSTA:
- Estruture a resposta seguindo o padrão dos modelos coerentes
- Seja específico sobre a solução implementada
- Integre o histórico de atendimento quando relevante
- Use tom profissional, direto e objetivo
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito"
- Seja firme e claro, sem excesso de tom acolhedor

4. VERIFICAÇÃO FINAL:
- Confirme que a resposta é específica (não genérica)
- Verifique se menciona a solução implementada
- Garanta que o tom está adequado para o RA

🎯 INSTRUÇÃO CRÍTICA: Use o conhecimento dos modelos coerentes para gerar uma resposta de alta qualidade desde o início, aplicando a estrutura e abordagem dos modelos aprovados.

IMPORTANTE: A resposta deve ser específica para esta situação, não genérica. Use os dados fornecidos e o conhecimento dos modelos coerentes para criar uma resposta personalizada e de alta qualidade.`;

        // Fazer a requisição para a OpenAI
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um especialista em atendimento ao cliente para o Reclame Aqui, com foco em gerar respostas de alta qualidade baseadas em modelos coerentes.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const resposta = data.choices[0].message.content;
            
            // Verificar se a resposta foi gerada com conhecimento da planilha
            const temConhecimentoPlanilha = dadosPlanilha && (dadosPlanilha.modelosCoerentes?.length > 0 || dadosPlanilha.feedbacksRelevantes?.length > 0);
            
            if (temConhecimentoPlanilha) {
                console.log('✅ Resposta gerada com conhecimento da planilha aplicado');
                console.log(`📊 Conhecimento aplicado: ${dadosPlanilha.modelosCoerentes?.length || 0} modelos + ${dadosPlanilha.feedbacksRelevantes?.length || 0} feedbacks`);
            } else {
                console.log('⚠️ Resposta gerada apenas com script padrão (sem conhecimento da planilha)');
            }
            
            // Atualizar estatísticas
            await incrementarEstatisticaGlobal('respostas_geradas');
            
            res.json({
                success: true,
                result: resposta,
                conhecimentoPlanilhaAplicado: temConhecimentoPlanilha,
                modelosUtilizados: dadosPlanilha?.modelosCoerentes?.length || 0,
                feedbacksUtilizados: dadosPlanilha?.feedbacksRelevantes?.length || 0,
                fluxoUtilizado: 'Script Padrão → Consultar Planilha → Reformular'
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
        
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('🔥 ERRO NO ENDPOINT /api/generate-response:', error);
        console.error('🔥 STACK TRACE:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para gerar resposta RA via API OpenAI (endpoint principal com sistema de aprendizado)
app.post('/api/gerar-resposta', rateLimitMiddleware, async (req, res) => {
    console.log('=================================');
    console.log('🔥🔥🔥 ENTRADA NO ENDPOINT /api/gerar-resposta 🔥🔥🔥');
    console.log('=================================');
    let timeoutId;
    try {
        console.log('🔥 DENTRO DO TRY - INICIANDO PROCESSAMENTO');
        const { dadosFormulario, userData } = req.body;
        console.log('🎯 Endpoint /api/generate-response chamado');
        console.log('👤 Usuário que fez a solicitação:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
        console.log('📋 Tipo de solicitação:', dadosFormulario?.tipo_solicitacao || 'N/A');
        console.log('🚀 INICIANDO SISTEMA DE APRENDIZADO...');
        
        // DEBUG: Verificar dados recebidos
        console.log('🔍 DEBUG - Dados recebidos:', {
            temDadosFormulario: !!dadosFormulario,
            temUserData: !!userData,
            tipoSolicitacao: dadosFormulario?.tipo_solicitacao
        });
        
        console.log('🔍 DEBUG - Carregando variáveis de ambiente...');
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        console.log('🔍 DEBUG - Validando API Key...', {
            temApiKey: !!apiKey,
            tamanhoApiKey: apiKey ? apiKey.length : 0
        });
        
        console.log('🔍 DEBUG - Validando API Key...', {
            temApiKey: !!apiKey,
            tamanhoApiKey: apiKey ? apiKey.length : 0
        });
        
        if (!validateApiKey(apiKey)) {
            console.log('❌ DEBUG - API Key inválida');
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        // FORÇAR INICIALIZAÇÃO DO GOOGLE SHEETS SE NÃO ESTIVER ATIVO
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            console.log('🔄 Google Sheets inativo - tentando inicializar automaticamente...');
            try {
                envVars.ENABLE_GOOGLE_SHEETS = 'true'; // Forçar ativação
                const success = await googleSheetsIntegration.initialize(envVars);
                if (success) {
                    global.googleSheetsInitialized = true;
                    console.log('✅ Google Sheets inicializado automaticamente com sucesso!');
                } else {
                    console.log('❌ Falha ao inicializar Google Sheets automaticamente');
                }
            } catch (error) {
                console.log('❌ Erro ao inicializar Google Sheets:', error.message);
            }
        }
        
        console.log('🔍 DEBUG - Verificando dados do formulário...', {
            temDadosFormulario: !!dadosFormulario,
            tipoSolicitacao: dadosFormulario?.tipo_solicitacao
        });
        
        if (!dadosFormulario) {
            console.log('❌ DEBUG - Dados do formulário não fornecidos');
            return res.status(400).json({
                success: false,
                error: 'Dados do formulário não fornecidos'
            });
        }
        
        if (!dadosFormulario.nome_solicitante || !String(dadosFormulario.nome_solicitante).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Nome do solicitante é obrigatório'
            });
        }
        
        console.log('📋 Dados recebidos do formulário:', {
            tipo_solicitacao: dadosFormulario.tipo_solicitacao,
            motivo_solicitacao: dadosFormulario.motivo_solicitacao,
            solucao_implementada: dadosFormulario.solucao_implementada?.substring(0, 100) + '...',
            texto_cliente: dadosFormulario.texto_cliente?.substring(0, 100) + '...',
            historico_atendimento: dadosFormulario.historico_atendimento?.substring(0, 50) + '...',
            nome_solicitante: dadosFormulario.nome_solicitante || 'não informado'
        });
        
        // SISTEMA DE APRENDIZADO SIMPLES E DIRETO
        let conhecimentoFeedback = '';
        let modelosCoerentes = [];
        let feedbacksRelevantes = [];
        
        console.log('🧠 SISTEMA DE APRENDIZADO SIMPLES: Iniciando consulta direta à planilha...');
        
        // Verificar se Google Sheets está ativo
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                console.log('📚 CONSULTANDO PLANILHA DIRETAMENTE...');
                
                // Carregar modelos coerentes da planilha
                modelosCoerentes = await carregarModelosCoerentesDaPlanilha(dadosFormulario.tipo_solicitacao);
                console.log(`✅ MODELOS ENCONTRADOS: ${modelosCoerentes.length} modelos coerentes na planilha`);
                
                // Carregar feedbacks da planilha
                feedbacksRelevantes = await carregarFeedbacksRelevantesDaPlanilha(dadosFormulario.tipo_solicitacao);
                console.log(`✅ FEEDBACKS ENCONTRADOS: ${feedbacksRelevantes.length} feedbacks relevantes na planilha`);
                
                // APLICAR MODELOS COERENTES
                if (modelosCoerentes.length > 0) {
                    console.log('🎯 APLICANDO MODELOS COERENTES DA PLANILHA!');
                    conhecimentoFeedback += '\n\n🧠 MODELOS COERENTES DA PLANILHA (SEGUIR ESTE PADRÃO):\n';
                    conhecimentoFeedback += `Baseado em ${modelosCoerentes.length} respostas aprovadas como "coerentes" para situações similares:\n\n`;
                    
                    modelosCoerentes.forEach((modelo, index) => {
                        const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
                        // Pular modelos sem resposta válida
                        if (!resposta || resposta.trim().length === 0) {
                            return;
                        }
                        
                        conhecimentoFeedback += `📋 MODELO ${index + 1} (${modelo.tipo_situacao || modelo.dadosFormulario?.tipo_solicitacao || modelo['Tipo Solicitação'] || 'N/A'}):\n`;
                        conhecimentoFeedback += `   📅 Data: ${modelo.timestamp || 'N/A'}\n`;
                        conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao || modelo['Motivo Solicitação'] || 'N/A'}\n`;
                        conhecimentoFeedback += `   🔧 Solução: ${modelo.solucao_implementada || modelo.dadosFormulario?.solucao_implementada || modelo['Solução Implementada'] || 'N/A'}\n`;
                        conhecimentoFeedback += `   📝 Resposta aprovada: "${resposta.substring(0, 400)}${resposta.length > 400 ? '...' : ''}"\n\n`;
                    });
                    
                    conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use estes modelos como base para sua resposta. Mantenha a mesma estrutura, tom e abordagem dos modelos aprovados.\n';
                } else {
                    console.log('⚠️ NENHUM MODELO COERENTE ENCONTRADO na planilha para esta solicitação');
                }
                
                // APLICAR FEEDBACKS RELEVANTES
                if (feedbacksRelevantes.length > 0) {
                    console.log('🎯 APLICANDO FEEDBACKS DA PLANILHA!');
                    conhecimentoFeedback += '\n\n⚠️ FEEDBACKS DA PLANILHA (EVITAR ESTES ERROS):\n';
                    conhecimentoFeedback += `Baseado em ${feedbacksRelevantes.length} feedbacks de situações similares:\n\n`;
                    
                    feedbacksRelevantes.forEach((fb, index) => {
                        conhecimentoFeedback += `${index + 1}. ❌ ERRO: "${fb.feedback}"\n`;
                        conhecimentoFeedback += `   📝 Resposta original: "${fb.respostaAnterior?.substring(0, 150) || 'N/A'}..."\n`;
                        conhecimentoFeedback += `   ✅ Resposta corrigida: "${fb.respostaReformulada?.substring(0, 150) || 'N/A'}..."\n\n`;
                    });
                    
                    conhecimentoFeedback += '🎯 INSTRUÇÃO: Use este conhecimento para evitar erros similares.\n';
                } else {
                    console.log('⚠️ NENHUM FEEDBACK RELEVANTE ENCONTRADO na planilha para esta solicitação');
                }
                
            } catch (error) {
                console.error('❌ ERRO ao consultar planilha:', error.message);
                console.log('🔄 Continuando sem aprendizado da planilha...');
            }
        } else {
            console.log('⚠️ GOOGLE SHEETS INATIVO - Continuando sem aprendizado da planilha');
        }
        
        // ADICIONAR CONHECIMENTO DE PRODUTOS SE MENCIONADOS
        const conhecimentoProdutos = obterConhecimentoProdutos(dadosFormulario);
        if (conhecimentoProdutos) {
            conhecimentoFeedback += conhecimentoProdutos;
            console.log('✅ CONHECIMENTO DE PRODUTOS INCLUÍDO NO PROMPT');
        }
        
        // Verificar se o conhecimento foi construído
        if (conhecimentoFeedback && conhecimentoFeedback.length > 100) {
            console.log('✅ CONHECIMENTO DA PLANILHA INCLUÍDO NO PROMPT');
            console.log('📊 Estatísticas do conhecimento:');
            console.log(`   - Tamanho: ${conhecimentoFeedback.length} caracteres`);
            console.log(`   - Contém modelos: ${conhecimentoFeedback.includes('MODELOS COERENTES')}`);
            console.log(`   - Contém feedbacks: ${conhecimentoFeedback.includes('FEEDBACKS DA PLANILHA')}`);
            console.log(`   - Contém produtos: ${conhecimentoFeedback.includes('CONHECIMENTO DO PRODUTO')}`);
        } else {
            console.log('⚠️ NENHUM CONHECIMENTO DA PLANILHA DISPONÍVEL');
            console.log('📝 Tamanho do conhecimento:', conhecimentoFeedback?.length || 0);
        }

        // USAR O NOVO FLUXO: Script Padrão → Consultar Planilha → Reformular
        // Primeiro, tentar carregar dados da planilha
        let dadosPlanilha = null;
        try {
            console.log('🔍 [DEBUG] Tentando carregar dados da planilha para:', dadosFormulario.tipo_solicitacao);
            dadosPlanilha = await carregarDadosAprendizadoCompleto(dadosFormulario.tipo_solicitacao);
            console.log('✅ Dados da planilha carregados:', {
                modelos: dadosPlanilha?.modelosCoerentes?.length || 0,
                feedbacks: dadosPlanilha?.feedbacksRelevantes?.length || 0,
                fonte: dadosPlanilha?.fonte || 'desconhecida'
            });
            
            // Log detalhado dos modelos carregados
            if (dadosPlanilha?.modelosCoerentes?.length > 0) {
                console.log('📋 [DEBUG] Primeiros modelos carregados:');
                dadosPlanilha.modelosCoerentes.slice(0, 2).forEach((modelo, index) => {
                    console.log(`   Modelo ${index + 1}:`, {
                        tipo: modelo['Tipo Solicitação'] || modelo.dadosFormulario?.tipo_solicitacao,
                        temResposta: !!(modelo['Resposta Aprovada'] || modelo.respostaAprovada),
                        tamanhoResposta: (modelo['Resposta Aprovada'] || modelo.respostaAprovada || '').length
                    });
                });
            } else {
                console.log('⚠️ [DEBUG] NENHUM MODELO COERENTE ENCONTRADO!');
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados da planilha:', error.message);
            console.log('🔄 Continuando com script padrão...');
        }
        
        const prompt = reformularComConhecimento(
            gerarScriptPadraoResposta(dadosFormulario), 
            dadosPlanilha, 
            dadosFormulario
        );

        // Configurar timeout de 30 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                signal: controller.signal,
                body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um assistente especializado em atendimento ao cliente para a empresa Velotax. Sua função é analisar TODOS os campos fornecidos (reclamação do cliente, solução implementada, histórico de atendimento, nome do solicitante) e formular uma resposta personalizada que responda diretamente à solicitação do cliente, explicando como a solução implementada resolve o problema. Use as cláusulas da CCB quando aplicável para fundamentar a resposta. A saudação deve usar o nome do solicitante informado (ex.: Olá, Maria!).'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            let resposta = data.choices[0].message.content;
            
            // Nome do cliente: priorizar "Nome do solicitante" do formulário, depois extrair do texto
            const nomeAgente = obterPrimeiroNomeUsuario(userData);
            const nomeCliente = (dadosFormulario.nome_solicitante && String(dadosFormulario.nome_solicitante).trim()) 
                ? String(dadosFormulario.nome_solicitante).trim() 
                : extrairNomeCliente(dadosFormulario.texto_cliente);
            
            // Aplicar formatação da resposta RA com a estrutura solicitada (Olá, {nome do solicitante}!)
            resposta = formatarRespostaRA(resposta, nomeCliente, nomeAgente);
            
            // Validação pós-processamento mais rigorosa e específica
            const palavrasGenericas = [
                'situação atual', 'detalhes específicos não foram compartilhados', 
                'nossa equipe está comprometida', 'analisar todas as solicitações',
                'embora os detalhes específicos', 'gostaríamos de assegurar',
                'caso a sua solicitação envolva', 'estamos aqui para esclarecer',
                'sua situação atual necessitou', 'detalhes específicos do seu caso'
            ];
            
            const temGenericas = palavrasGenericas.some(palavra => 
                resposta.toLowerCase().includes(palavra)
            );
            
            // Verificar se a resposta menciona especificamente a solução implementada
            const mencionaSolucao = dadosFormulario.solucao_implementada && 
                resposta.toLowerCase().includes(dadosFormulario.solucao_implementada.toLowerCase().substring(0, 30));
            
            // Verificar se a resposta é muito curta (menos de 300 caracteres)
            const muitoCurta = resposta.length < 300;
            
            // Verificar se menciona o tipo de solicitação específico
            const mencionaTipoSolicitacao = dadosFormulario.tipo_solicitacao && 
                resposta.toLowerCase().includes(dadosFormulario.tipo_solicitacao.toLowerCase());
            
            // Verificar se tem palavras conclusivas
            const palavrasConclusivas = ['confirmamos', 'concluído', 'finalizado', 'realizado', 'processado', 'implementado', 'resolvido', 'atendido', 'excluído', 'liberado', 'removido', 'cancelado'];
            const temConclusao = palavrasConclusivas.some(palavra => 
                resposta.toLowerCase().includes(palavra)
            );
            
            // Verificar se integra o histórico de atendimento
            const integraHistorico = dadosFormulario.historico_atendimento && 
                dadosFormulario.historico_atendimento !== 'Nenhum' &&
                resposta.toLowerCase().includes(dadosFormulario.historico_atendimento.toLowerCase().substring(0, 20));
            
            // Verificar se integra as observações internas
            const integraObservacoes = dadosFormulario.observacoes_internas && 
                dadosFormulario.observacoes_internas !== 'Nenhuma' &&
                resposta.toLowerCase().includes(dadosFormulario.observacoes_internas.toLowerCase().substring(0, 20));
            
            // Verificar se a resposta foi gerada com aprendizado (contém conhecimentoFeedback)
            const temAprendizado = conhecimentoFeedback && conhecimentoFeedback.length > 100;
            
            if (temAprendizado) {
                console.log('✅ Resposta gerada com aprendizado aplicado - mantendo resposta da IA');
            } else {
                console.log('⚠️ Resposta genérica detectada - NUNCA usar resposta genérica para RA/Moderações');
                console.log('📝 Formulando resposta específica baseada nos dados fornecidos pelo usuário...');
                
                // Extrair informações específicas dos dados
                const tipoSituacao = dadosFormulario.tipo_solicitacao;
                const solucao = dadosFormulario.solucao_implementada;
                const motivo = dadosFormulario.motivo_solicitacao;
                const historico = dadosFormulario.historico_atendimento;
                const observacoes = dadosFormulario.observacoes_internas; // compatibilidade com dados antigos
                
                // Nome do cliente: priorizar nome do solicitante do formulário
                const nomeAgente = obterPrimeiroNomeUsuario(userData);
                const nomeCliente = (dadosFormulario.nome_solicitante && String(dadosFormulario.nome_solicitante).trim()) 
                    ? String(dadosFormulario.nome_solicitante).trim() 
                    : extrairNomeCliente(dadosFormulario.texto_cliente);
                
                // Criar resposta mais específica e completa baseada nos dados fornecidos
                const textoResposta = `Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.`;
                
                let respostaEspecifica = formatarRespostaRA(textoResposta, nomeCliente, nomeAgente);
                
                // Adicionar contexto específico baseado no tipo de situação
                if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('exclusao')) {
                    const textoRespostaExclusao = `Agradecemos seu contato e reconhecemos sua solicitação de exclusão de cadastro${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de exclusão e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.`;
                    respostaEspecifica = formatarRespostaRA(textoRespostaExclusao, nomeCliente, nomeAgente);
                } else if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade')) {
                    const textoRespostaPix = `Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de portabilidade e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

A operação foi realizada conforme estabelecido na Cláusula 7 de sua Cédula de Crédito Bancário (CCB), que trata do vínculo da chave Pix e quitação automática.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.`;
                    respostaEspecifica = formatarRespostaRA(textoRespostaPix, nomeCliente, nomeAgente);
                } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação')) {
                    const textoRespostaQuitacao = `Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de quitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

A operação foi realizada conforme estabelecido na Cláusula 8 de sua Cédula de Crédito Bancário (CCB), que trata da liquidação antecipada.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.`;
                    respostaEspecifica = formatarRespostaRA(textoRespostaQuitacao, nomeCliente, nomeAgente);
                }
                
                resposta = respostaEspecifica;
            }
            
            // Incrementar estatística global
            await incrementarEstatisticaGlobal('respostas_geradas');
            
            res.json({
                success: true,
                result: resposta
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('Erro na requisição para OpenAI:', fetchError);
            res.status(500).json({
                success: false,
                error: 'Erro na comunicação com OpenAI',
                message: fetchError.message
            });
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('🔥 ERRO NO ENDPOINT /api/generate-response:', error);
        console.error('🔥 STACK TRACE:', error.stack);
        
        // Tratamento específico para timeout
        if (error.name === 'AbortError') {
            res.status(408).json({
                success: false,
                error: 'Timeout na API OpenAI',
                message: 'A requisição demorou mais de 30 segundos para ser processada. Tente novamente.'
            });
        } else if (error.code === 'UND_ERR_CONNECT_TIMEOUT') {
            res.status(408).json({
                success: false,
                error: 'Timeout de conexao',
                message: 'Nao foi possivel conectar com a API da OpenAI. Verifique sua conexao com a internet.'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Erro interno do servidor',
                message: error.message
            });
        }
    }
});

// Rota para reformular texto de moderação após negativa
app.post('/api/reformulate-moderation', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        const { motivoNegativa, textoNegado, dadosModeracao } = req.body;
        
        if (!motivoNegativa || !textoNegado) {
            return res.status(400).json({
                success: false,
                error: 'Motivo da negativa e texto negado são obrigatórios'
            });
        }
        
        // Obter feedbacks relevantes para melhorar a reformulação de moderação
        const feedbacksRelevantes = getRelevantFeedbacks('moderacao', {
            motivoNegativa: motivoNegativa
        });
        
        let conhecimentoFeedback = '';
        if (feedbacksRelevantes.length > 0) {
            conhecimentoFeedback = '\n\nCONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES DE MODERAÇÃO:\n';
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. Motivo negativa: "${fb.motivoNegativa}"\n`;
                conhecimentoFeedback += `   Texto reformulado: "${fb.textoReformulado.substring(0, 200)}..."\n\n`;
            });
            conhecimentoFeedback += 'Use este conhecimento para evitar erros similares e melhorar a qualidade da reformulação de moderação.\n';
        }
        
        const prompt = `
📌 REFORMULAÇÃO DE TEXTO DE MODERAÇÃO NEGADO PELO RA

Você é responsável por reformular textos de moderação negados pelo Reclame Aqui seguindo o script estruturado.

DADOS DE ENTRADA:
- Motivo da negativa: ${motivoNegativa}
- Texto de moderação negado: ${textoNegado}

${conhecimentoFeedback || ''}

⚙️ FLUXO DE REFORMULAÇÃO OBRIGATÓRIO:

1. ANÁLISE DA NEGATIVA:
- Identifique por que o RA negou (ex.: "Resposta não condizente", "sem relação com os fatos", "tom inadequado")
- Analise o conteúdo original (solicitação, resposta, consideração) que gerou a negativa
- Compare com os manuais de moderação e detecte onde o texto falhou
- Identifique os pontos problemáticos na análise anterior

2. CONSULTA AOS MANUAIS:
Sempre verificar os 3 manuais oficiais do RA:
- Manual Geral de Moderação
- Manual de Moderação RA Reviews  
- Manual de Moderação – Bancos, Instituições Financeiras e Meios

3. REFORMULAÇÃO ESTRUTURADA:
- Ajuste apenas o necessário para alinhar ao motivo da negativa
- Reforce com base no manual aplicável (sempre citar)
- Mantenha texto objetivo, técnico e impessoal
- Direcione sempre ao RA (não ao consumidor)

4. MODELO FIXO OBRIGATÓRIO PARA REFORMULAÇÃO - USE EXATAMENTE ESTA ESTRUTURA:

"Prezados,

Solicitamos a moderação da reclamação em questão, tendo em vista que [explique o motivo objetivo corrigido, baseado no feedback da negativa].

Conforme registros internos e documentação de suporte, [descrever de forma resumida os fatos corretos]. Ressaltamos que a alegação feita diverge da realidade, enquadrando-se nas hipóteses de moderação previstas no [manual aplicável específico].

Dessa forma, solicitamos a adequação ou exclusão da publicação, conforme regras vigentes da plataforma."

⚠️ IMPORTANTE: O texto reformulado DEVE seguir EXATAMENTE esta estrutura de 3 parágrafos. NÃO use outros formatos.

5. REGRAS INQUEBRÁVEIS:
- Não inventar fatos
- Usar somente registros fornecidos + manuais
- Sempre citar manual aplicável específico
- Texto deve ser curto, objetivo e técnico
- Pedido sempre direcionado ao RA
- Manter tom impessoal e formal

6. SAÍDA FINAL:
Forneça APENAS o texto reformulado seguindo EXATAMENTE o modelo fixo de 3 parágrafos acima, corrigindo especificamente o motivo da negativa.

⚠️ CRÍTICO: O texto DEVE começar com "Prezados," e seguir exatamente a estrutura de 3 parágrafos definida. NÃO use variações.

🚫 PROIBIDO: NÃO cite os dados de entrada literalmente. Analise o conteúdo original e formule baseado na análise, não na citação dos dados.

📋 DICAS CRÍTICAS PARA REFORMULAÇÃO DE MODERAÇÃO:

1. CONSULTE SEMPRE OS MANUAIS DO RA:
- Manual Geral de Moderação → regras universais (informação falsa, ofensas, duplicidade)
- Manual RA Reviews → foco em avaliações e comentários de reputação
- Manual de Bancos, Instituições Financeiras e Meios → regras específicas para operações financeiras, contratos, CCB, termos aceitos
⚠️ NÃO PULE ESSA PARTE: o RA pode negar a moderação se o pedido não se apoiar nas regras deles

2. VERIFIQUE OS REGISTROS INTERNOS ANTES DE ESCREVER:
- Data da contratação ou operação
- Status real da solicitação (ex.: quitação antecipada, reagendamento BB, restituição no eCAC)
- Situação da chave Pix (se estava vinculada, portabilizada, ou desvinculada)
- Evidências objetivas: prints, protocolos, comprovantes

3. COMPARE A RECLAMAÇÃO COM OS FATOS:
- O cliente alegou algo que já foi resolvido antes da abertura no RA?
- Há omissão da solução aplicada?
- A descrição do cliente contraria cláusulas aceitas em contrato (ex.: vínculo da chave Pix na CCB)?
- O texto contém linguagem ofensiva ou acusação sem prova?

4. NA REFORMULAÇÃO, CORRIJA ESPECIFICAMENTE:
- O motivo da negativa identificado pelo RA
- Analise novamente o conteúdo original (solicitação, resposta, consideração) com foco na negativa
- Mantenha fatos reais comprovados → cite data, registro, operação
- Aponte divergência clara → onde o conteúdo analisado erra ou omite informações
- Base normativa → diga "conforme Manual Geral de Moderação", "conforme Cláusula 7 da CCB", etc.

5. NA REDAÇÃO FINAL (TEXTO AO RA), SIGA O TOM:
- Técnico, claro e objetivo
- Impessoal (nada de "entendemos sua frustração")
- Estrutura em 3 parágrafos curtos:
  * Motivo objetivo do pedido
  * Fatos internos que comprovam a divergência
  * Solicitação de adequação/exclusão conforme regras do RA

6. NUNCA PEÇA MODERAÇÃO POR MOTIVO FRÁGIL:
- Não basta "não gostar" do comentário
- Só peça moderação se:
  * Violou regra do RA
  * Está em desacordo com fatos comprováveis
  * Houve solução omitida
  * Houve quebra de diretriz contratual clara

7. CITE O MANUAL/CAPÍTULO SEMPRE QUE POSSÍVEL:
- Exemplo: "conforme previsto no Manual Geral de Moderação (item de informações falsas)"
- Exemplo: "em linha com o Manual de Bancos, que prevê correção de informações contratuais incorretas"
- Isso mostra base sólida e aumenta as chances de aprovação

🎯 TRIPÉ DA MODERAÇÃO: registre fatos + aponte divergência + fundamente em manual/contrato

IMPORTANTE: Use o conhecimento dos feedbacks anteriores para evitar erros similares e melhorar a qualidade da reformulação de moderação.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um especialista em Reclame Aqui, com foco em reformulação de textos de moderação negados.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const textoReformulado = data.choices[0].message.content;
            
            // Salvar feedback para aprendizado futuro
            addModeracaoFeedback(textoNegado, motivoNegativa, textoReformulado, dadosModeracao, req.userData);
            
            res.json({
                success: true,
                result: textoReformulado
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
    } catch (error) {
        console.error('Erro ao reformular moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para reformular resposta RA via API OpenAI
app.post('/api/reformulate-response', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        const { dadosFormulario, respostaAnterior, feedback, userData } = req.body;
        
        if (!dadosFormulario || !respostaAnterior) {
            return res.status(400).json({
                success: false,
                error: 'Dados do formulário e resposta anterior são obrigatórios'
            });
        }
        
        // Log do tipo de operação
        if (feedback) {
            console.log('🔄 GERANDO NOVA RESPOSTA (feedback recebido - resposta anterior estava incorreta)');
            console.log('📝 Feedback:', feedback.substring(0, 100) + '...');
        } else {
            console.log('🔄 REFORMULANDO RESPOSTA (sem feedback)');
        }
        
        // Obter aprendizado direto do script para este tipo de situação (PRIORITÁRIO)
        const aprendizadoScript = await getAprendizadoTipoSituacao(dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao);
        
        // Obter feedbacks relevantes para melhorar a reformulação (COMPLEMENTAR)
        const feedbacksRelevantes = getRelevantFeedbacks('resposta', {
            tipoSituacao: dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao
        });
        
        console.log(`🔄 REFORMULAÇÃO - Buscando aprendizado para: ${dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao}`);
        console.log(`🧠 APRENDIZADO DO SCRIPT: ${aprendizadoScript?.feedbacks?.length || 0} feedbacks, ${aprendizadoScript?.respostasCoerentes?.length || 0} respostas coerentes`);
        console.log(`📚 Feedbacks complementares: ${feedbacksRelevantes.length}`);
        
        let conhecimentoFeedback = '';
        
        // PRIORIDADE 1: APRENDIZADO DIRETO DO SCRIPT (mais recente e específico)
        if (aprendizadoScript?.feedbacks?.length > 0 || aprendizadoScript?.respostasCoerentes?.length > 0 || aprendizadoScript?.padroesIdentificados?.length > 0) {
            conhecimentoFeedback = '\n\n🎓 APRENDIZADO DIRETO DO SCRIPT DE FORMULAÇÃO (PRIORITÁRIO):\n';
            conhecimentoFeedback += `Baseado em ${aprendizadoScript.feedbacks.length} feedbacks e ${aprendizadoScript.respostasCoerentes.length} respostas coerentes para "${dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao}":\n\n`;
            
            console.log('🧠 Aplicando aprendizado do script na reformulação:', {
                feedbacks: aprendizadoScript.feedbacks.length,
                respostasCoerentes: aprendizadoScript.respostasCoerentes.length,
                padroes: aprendizadoScript.padroesIdentificados.length
            });
            
            // Adicionar padrões identificados
            if (aprendizadoScript?.padroesIdentificados?.length > 0) {
                conhecimentoFeedback += '📋 PADRÕES IDENTIFICADOS (OBRIGATÓRIOS):\n';
                aprendizadoScript?.padroesIdentificados?.forEach((padrao, index) => {
                    conhecimentoFeedback += `${index + 1}. ${padrao}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // Adicionar cláusulas usadas (APENAS se não houver feedbacks contrários)
            const temFeedbackContrario = aprendizadoScript?.feedbacks?.some(fb => 
                fb.feedback.toLowerCase().includes('não cite') || 
                fb.feedback.toLowerCase().includes('nao cite') ||
                fb.feedback.toLowerCase().includes('não use') ||
                fb.feedback.toLowerCase().includes('nao use')
            );
            
            if (aprendizadoScript?.clausulasUsadas?.length > 0 && !temFeedbackContrario) {
                conhecimentoFeedback += '⚖️ CLÁUSULAS CCB APLICÁVEIS:\n';
                aprendizadoScript?.clausulasUsadas?.forEach(clausula => {
                    conhecimentoFeedback += `• ${clausula}\n`;
                });
                conhecimentoFeedback += '\n';
            } else if (temFeedbackContrario) {
                console.log('⚠️ Feedback contrário detectado - não incluindo cláusulas CCB');
            }
            
            // Adicionar feedbacks recentes (CRÍTICO - EVITAR ESTES ERROS)
            if (aprendizadoScript?.feedbacks?.length > 0) {
                conhecimentoFeedback += '⚠️ FEEDBACKS RECENTES (EVITAR ESTES ERROS):\n';
                aprendizadoScript?.feedbacks?.slice(-5).forEach((fb, index) => {
                    conhecimentoFeedback += `${index + 1}. ERRO: "${fb.feedback}"\n`;
                    conhecimentoFeedback += `   RESPOSTA CORRIGIDA: "${fb.respostaReformulada.substring(0, 200)}..."\n\n`;
                });
            }
            
            // Adicionar respostas coerentes recentes (SEGUIR ESTE PADRÃO)
            if (aprendizadoScript?.respostasCoerentes?.length > 0) {
                conhecimentoFeedback += '✅ RESPOSTAS COERENTES RECENTES (SEGUIR ESTE PADRÃO):\n';
                aprendizadoScript?.respostasCoerentes?.slice(-3).forEach((resp, index) => {
                    conhecimentoFeedback += `${index + 1}. Motivo: ${resp.motivoSolicitacao}\n`;
                    conhecimentoFeedback += `   RESPOSTA APROVADA: "${resp.respostaAprovada?.substring(0, 250) || 'N/A'}..."\n\n`;
                });
            }
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este aprendizado direto do script para gerar uma resposta de alta qualidade, aplicando os padrões identificados e evitando os erros documentados.\n';
        }
        
        // PRIORIDADE 2: FEEDBACKS COMPLEMENTARES (se não houver aprendizado do script)
        if (!conhecimentoFeedback && feedbacksRelevantes.length > 0) {
            conhecimentoFeedback = '\n\nCONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES:\n';
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. Feedback: "${fb.feedback}"\n`;
                conhecimentoFeedback += `   Resposta reformulada: "${fb.respostaReformulada.substring(0, 200)}..."\n\n`;
            });
            conhecimentoFeedback += 'Use este conhecimento para evitar erros similares e melhorar a qualidade da reformulação.\n';
        }
        
        // PRIORIDADE 3: CONSULTAR FEEDBACKS_RESPOSTAS.JSON COMO BASE DE CONHECIMENTO (REFORMULAÇÃO)
        const feedbacksRespostasReformulacao = loadFeedbacksRespostas();
        if (feedbacksRespostasReformulacao.respostas && feedbacksRespostasReformulacao.respostas.length > 0) {
            const feedbacksRelevantesReformulacao = feedbacksRespostasReformulacao.respostas.filter(fb => {
                const tipoSituacao = fb.contexto?.tipoSituacao || fb.dadosFormulario?.tipo_solicitacao || '';
                return tipoSituacao.toLowerCase() === dadosFormulario.tipo_solicitacao.toLowerCase();
            });
            
            if (feedbacksRelevantesReformulacao.length > 0) {
                if (!conhecimentoFeedback) {
                    conhecimentoFeedback = '\n\n🧠 BASE DE CONHECIMENTO - FEEDBACKS DE RESPOSTAS RA:\n';
                } else {
                    conhecimentoFeedback += '\n\n📚 CONHECIMENTO COMPLEMENTAR - FEEDBACKS DE RESPOSTAS RA:\n';
                }
                
                conhecimentoFeedback += `Baseado em ${feedbacksRelevantesReformulacao.length} feedbacks de respostas RA para "${dadosFormulario.tipo_solicitacao}":\n\n`;
                
                // Analisar problemas mais comuns para reformulação
                const problemasComunsReformulacao = {};
                const exemplosReformulacao = [];
                
                feedbacksRelevantesReformulacao.forEach(fb => {
                    if (fb.feedback) {
                        // Extrair problemas identificados
                        const problemas = fb.feedback.match(/informacoes-incorretas|nao-condiz-solucao|falta-clareza|nao-empatico|tom-inadequado/g);
                        if (problemas) {
                            problemas.forEach(problema => {
                                problemasComunsReformulacao[problema] = (problemasComunsReformulacao[problema] || 0) + 1;
                            });
                        }
                        
                        exemplosReformulacao.push({
                            feedback: fb.feedback,
                            respostaReformulada: fb.respostaReformulada,
                            timestamp: fb.timestamp
                        });
                    }
                });
                
                // Adicionar problemas mais comuns
                if (Object.keys(problemasComunsReformulacao).length > 0) {
                    conhecimentoFeedback += '⚠️ PROBLEMAS MAIS COMUNS IDENTIFICADOS:\n';
                    Object.entries(problemasComunsReformulacao)
                        .sort(([,a], [,b]) => b - a)
                        .forEach(([problema, count]) => {
                            conhecimentoFeedback += `- ${problema.replace(/-/g, ' ').toUpperCase()}: ${count} ocorrências\n`;
                        });
                    conhecimentoFeedback += '\n';
                }
                
                // Adicionar exemplos de correções
                if (exemplosReformulacao.length > 0) {
                    conhecimentoFeedback += '✅ EXEMPLOS DE CORREÇÕES APLICADAS:\n';
                    exemplosReformulacao.slice(0, 3).forEach((exemplo, index) => {
                        conhecimentoFeedback += `${index + 1}. Data: ${exemplo.timestamp}\n`;
                        conhecimentoFeedback += `   Problema: "${exemplo.feedback}"\n`;
                        conhecimentoFeedback += `   Correção aplicada: "${exemplo.respostaReformulada.substring(0, 200)}..."\n\n`;
                    });
                }
                
                conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este conhecimento dos feedbacks de respostas RA para evitar os problemas identificados e aplicar as correções já validadas na reformulação.\n';
            }
        }
        
        let prompt = `
TAREFA: ${feedback ? 'GERAR NOVA RESPOSTA' : 'REFORMULAR RESPOSTA'} do Reclame Aqui

DADOS DO CASO:
- Tipo de Situação: ${dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao}
- Motivo da Solicitação: ${dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao}
- Solução Implementada: ${dadosFormulario.solucao_implementada || dadosFormulario.solucaoImplementada}
- Reclamação do Cliente: ${dadosFormulario.texto_cliente || dadosFormulario.reclamacaoCliente}
- Histórico de Atendimento: ${dadosFormulario.historico_atendimento || dadosFormulario.historicoAtendimento}
- Observações Internas: ${dadosFormulario.observacoes_internas || dadosFormulario.observacoesInternas}

`;

        if (feedback) {
            prompt += `
FEEDBACK DO OPERADOR (a resposta anterior estava incorreta):
${feedback}

INSTRUÇÕES CRÍTICAS:
- A resposta anterior estava INCORRETA e não deve ser usada como base
- GERE UMA NOVA RESPOSTA COMPLETA do zero
- Use APENAS os dados do caso acima como base
- Analise o feedback para entender o que estava errado
- Evite os erros identificados no feedback
- Foque na solução implementada e como ela resolve a solicitação do cliente
- Seja específico e conclusivo`;
        } else {
            prompt += `
RESPOSTA ANTERIOR (para referência):
${respostaAnterior}

INSTRUÇÕES PARA REFORMULAÇÃO:
- Analise a resposta anterior e identifique pontos de melhoria
- Reformule para ser mais completa e eficaz
- Mantenha o tom profissional, direto e objetivo
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito"
- Seja firme e claro, sem excesso de tom acolhedor
- Aborde todos os aspectos da reclamação do cliente`;
        }

        // ADICIONAR CONHECIMENTO DE PRODUTOS SE MENCIONADOS
        const conhecimentoProdutos = obterConhecimentoProdutos(dadosFormulario);
        if (conhecimentoProdutos) {
            conhecimentoFeedback += conhecimentoProdutos;
            console.log('✅ CONHECIMENTO DE PRODUTOS INCLUÍDO NO PROMPT DE REFORMULAÇÃO');
        }
        
        prompt += `

${conhecimentoFeedback || ''}

ANÁLISE OBRIGATÓRIA DE TODOS OS CAMPOS:

Você receberá os seguintes campos que DEVEM ser analisados em conjunto:
- **Reclamação do Cliente**: O que o cliente está solicitando/reclamando
- **Solução Implementada**: O que a empresa fez para resolver
- **Histórico de Atendimento**: Contexto de atendimentos anteriores
- **Observações Internas**: Informações adicionais da equipe
- **Tipo de Situação**: Categoria da solicitação
- **Motivo da Solicitação**: Razão da solicitação

SUA TAREFA É:

1. **ANALISAR** a reclamação do cliente para entender exatamente o que ele está pedindo
2. **CONSIDERAR** a solução implementada como base factual do que foi feito
3. **INTEGRAR** o histórico de atendimento e observações internas para contexto completo
4. **FORMULAR** uma resposta personalizada que responda diretamente à solicitação do cliente
5. **ALINHAR** a resposta com a solução implementada, explicando como ela resolve a solicitação

REGRAS OBRIGATÓRIAS:

- **NUNCA** copie literalmente o texto da "Solução implementada"
- **SEMPRE** formule uma resposta que responda diretamente à reclamação do cliente
- **SEMPRE** explique como a solução implementada resolve a solicitação do cliente
- **SEMPRE** use linguagem cordial, objetiva e empática
- **SEMPRE** contextualize com referências legais quando aplicável (LGPD, CCB, etc.)
- **SEMPRE** deixe o texto pronto para publicação no Reclame Aqui

IMPORTANTE: Use o conhecimento dos feedbacks anteriores para evitar erros similares e melhorar a qualidade da resposta.

🧠 INSTRUÇÕES CRÍTICAS PARA APLICAR O APRENDIZADO:

1. **ANALISE O CONHECIMENTO FORNECIDO**: Leia cuidadosamente todos os feedbacks e respostas aprovadas acima
2. **EVITE ERROS IDENTIFICADOS**: NUNCA repita os erros mencionados nos feedbacks
3. **SEGUE PADRÕES APROVADOS**: Use as respostas aprovadas como modelo de qualidade
4. **APLIQUE PADRÕES IDENTIFICADOS**: Siga os padrões obrigatórios listados
5. **USE CLÁUSULAS CORRETAS**: Aplique as cláusulas CCB identificadas para cada tipo de situação

🎯 SUA RESPOSTA DEVE:
- Ser diferente das respostas incorretas mencionadas nos feedbacks
- Seguir a estrutura e qualidade das respostas aprovadas
- Aplicar os padrões identificados automaticamente
- Usar as cláusulas CCB corretas para o tipo de situação
- Demonstrar que você aprendeu com os feedbacks anteriores

DIRETRIZES GERAIS:
1. TOM E ESTILO:
- Profissional, respeitoso e direto
- Linguagem clara e acessível
- Tom objetivo e solucionador
- Evite jargões técnicos desnecessários
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Seja firme e claro, sem excesso de tom acolhedor ou friendly

2. ESTRUTURA DA RESPOSTA:
a) Agradecimento e reconhecimento
b) Esclarecimento da situação
c) Solução apresentada/implementada
d) Compromisso de melhoria
e) Convite para contato direto

3. DIRETRIZES:
- Reconheça o problema do cliente de forma objetiva (sem pedir desculpas)
- Explique as ações tomadas de forma clara e direta
- Demonstre compromisso com a satisfação (sem exageros)
- Mantenha tom profissional, respeitoso e firme
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Evite repetições desnecessárias
- Seja específico e detalhado
- Seja objetivo, sem excesso de tom acolhedor ou friendly

⚠️ FORMATO DE SAÍDA OBRIGATÓRIO:

IMPORTANTE: Você deve gerar APENAS o conteúdo do meio da resposta, SEM saudação inicial e SEM assinatura final. 

A estrutura completa (saudação com nome do cliente, apresentação do agente, informações de contato e assinatura) será aplicada automaticamente pelo sistema.

Gere APENAS o texto explicativo que vai entre a apresentação do agente e as informações de contato. Este texto deve:
- Responder diretamente à solicitação do cliente
- Explicar a solução implementada
- Ser mais completo, eficaz e atender aos pontos levantados no feedback
- Ser específico e detalhado (não genérico)

NÃO inclua:
- "Olá, [nome]" ou qualquer saudação
- "Sou [nome], especialista..." ou apresentação
- Informações de contato (telefones, site)
- "Atenciosamente" ou assinatura
- Qualquer estrutura de cabeçalho ou rodapé

Gere APENAS o conteúdo explicativo do meio da resposta reformulada.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um assistente especializado em atendimento ao cliente para a empresa Velotax, com foco em reformulação de respostas do Reclame Aqui.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            let respostaReformulada = data.choices[0].message.content;
            
            // Nome do cliente: priorizar nome do solicitante do formulário
            const nomeAgente = obterPrimeiroNomeUsuario(userData);
            const nomeCliente = (dadosFormulario.nome_solicitante && String(dadosFormulario.nome_solicitante).trim()) 
                ? String(dadosFormulario.nome_solicitante).trim() 
                : extrairNomeCliente(dadosFormulario.texto_cliente);
            
            // Aplicar formatação da resposta RA com a estrutura solicitada (Olá, {nome}!)
            respostaReformulada = formatarRespostaRA(respostaReformulada, nomeCliente, nomeAgente);
            
            // Aplicar feedback diretamente no script de formulação para aprendizado imediato
            if (feedback) {
                console.log('📝 Aplicando feedback diretamente no script de formulação para aprendizado imediato');
                await addFeedbackAprendizado(
                    dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
                    feedback,
                    respostaReformulada,
                    respostaAnterior,
                    userData
                );
                
                // Também salvar no arquivo de feedbacks de respostas para histórico completo
                console.log('📝 Salvando feedback no arquivo de feedbacks de respostas');
                await addRespostaFeedback(
                    dadosFormulario,
                    respostaAnterior,
                    feedback,
                    respostaReformulada,
                    userData
                );
                
                console.log('✅ Feedback salvo com sucesso em ambos os sistemas');
            }
            
            res.json({
                success: true,
                result: respostaReformulada
            });
        } else {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            res.status(errorResponse.statusCode).json(errorResponse);
        }
    } catch (error) {
        console.error('Erro ao reformular resposta RA:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Rota para obter configurações do arquivo .env (apenas se chave for válida)
app.post('/api/config/secure', rateLimitMiddleware, (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!validateApiKey(apiKey)) {
            return res.status(401).json({
                success: false,
                error: 'Acesso negado',
                message: 'Chave da API inválida'
            });
        }
        
        const envVars = loadEnvFile();
        
        // Verificar se a chave fornecida corresponde à do arquivo .env
        const envApiKey = envVars.OPENAI_API_KEY;
        if (envApiKey && apiKey !== envApiKey) {
            return res.status(401).json({
                success: false,
                error: 'Acesso negado',
                message: 'Chave da API não corresponde à configuração'
            });
        }
        
        // Retornar configurações completas (sem a chave da API)
        const secureConfig = { ...envVars };
        delete secureConfig.OPENAI_API_KEY;
        delete secureConfig.ENCRYPTION_KEY;
        
        res.json({
            success: true,
            config: secureConfig,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Erro ao obter configurações seguras:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Rota para servir arquivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro no servidor:', err);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: 'Algo deu errado. Tente novamente.'
    });
});

// Endpoint para visualizar feedbacks de respostas (aba Respostas RA)
app.get('/api/feedbacks/respostas', (req, res) => {
    try {
        const feedbacks = loadFeedbacksRespostas();
        res.json({
            success: true,
            data: feedbacks,
            tipo: 'respostas'
        });
    } catch (error) {
        console.error('Erro ao carregar feedbacks de respostas:', error);
        res.status(500).json({
        success: false,
            error: 'Erro ao carregar feedbacks de respostas'
        });
    }
});

// Endpoint para visualizar feedbacks de moderações (aba Moderação RA)
app.get('/api/feedbacks/moderacoes', (req, res) => {
    try {
        const feedbacks = loadFeedbacksModeracoes();
        res.json({
            success: true,
            data: feedbacks,
            tipo: 'moderacoes'
        });
    } catch (error) {
        console.error('Erro ao carregar feedbacks de moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar feedbacks de moderações'
        });
    }
});

// Endpoint para buscar solicitações da planilha com filtro de período
app.get('/api/solicitacoes', async (req, res) => {
    try {
        const { dataInicio, dataFim, tipo } = req.query;
        
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(200).json({
                success: true,
                message: 'Google Sheets não configurado',
                solicitacoes: [],
                total: 0
            });
        }

        console.log('📋 Buscando solicitações:', { dataInicio, dataFim, tipo });
        console.log('📋 Parâmetros recebidos:', req.query);

        const todasSolicitacoes = [];

        // Buscar respostas coerentes (apenas aprovadas)
        if (!tipo || tipo === 'respostas' || tipo === 'todas') {
            try {
                const respostas = await googleSheetsIntegration.obterModelosRespostas();
                if (respostas && respostas.length > 0) {
                    // Filtrar apenas respostas aprovadas/coerentes
                    const respostasAprovadas = respostas.filter(resposta => {
                        const status = resposta['Status Aprovação'] || resposta.Status || '';
                        return status === 'Aprovada' || status === '';
                    });
                    
                    respostasAprovadas.forEach(resposta => {
                        // Buscar Resposta Final na coluna E (índice 4)
                        // A coluna E é o índice 4 (A=0, B=1, C=2, D=3, E=4)
                        const respostaFinal = resposta[4] !== undefined && resposta[4] !== null && resposta[4] !== '' 
                            ? resposta[4] 
                            : (resposta['Resposta Final'] || 
                               resposta['Resposta Aprovada'] || 
                               resposta['Resposta'] ||
                               resposta.respostaFinal ||
                               resposta.respostaAprovada || '');
                        
                        // Buscar Texto Cliente na coluna D (índice 3)
                        const textoCliente = resposta[3] !== undefined && resposta[3] !== null && resposta[3] !== ''
                            ? resposta[3]
                            : (resposta['Texto Cliente'] || resposta.textoCliente || '');
                        
                        // Buscar ID da Reclamação na coluna G (índice 6)
                        const idReclamacao = resposta[6] !== undefined && resposta[6] !== null && resposta[6] !== ''
                            ? resposta[6]
                            : (resposta['ID da Reclamação'] || resposta.idReclamacao || resposta.id_reclamacao || '');
                        
                        // Buscar Tipo de Situação na coluna J (índice 9)
                        const tipoSituacao = resposta[9] !== undefined && resposta[9] !== null && resposta[9] !== ''
                            ? resposta[9]
                            : (resposta['Tipo de Situação'] || 
                               resposta.tipoSituacao || 
                               resposta.tipo_solicitacao || '');
                        
                        console.log('🔍 DEBUG Resposta:', {
                            id: resposta.ID || resposta.id,
                            colunaE: resposta[4],
                            respostaFinal: respostaFinal,
                            colunaD: resposta[3],
                            textoCliente: textoCliente,
                            colunaG: resposta[6],
                            idReclamacao: idReclamacao,
                            colunaJ: resposta[9],
                            tipoSituacao: tipoSituacao
                        });
                        
                        todasSolicitacoes.push({
                            tipo: 'resposta',
                            data: resposta['Data/Hora'] || resposta.data || '',
                            id: resposta.ID || resposta.id || '',
                            idReclamacao: idReclamacao || 'N/A', // ID da Reclamação da coluna G
                            tipoSolicitacao: tipoSituacao || 'N/A', // Tipo de Situação da coluna J
                            motivoSolicitacao: resposta['Motivo Solicitação'] || resposta.motivoSolicitacao || '',
                            textoCliente: textoCliente || 'N/A', // Texto completo do cliente da coluna D
                            resposta: respostaFinal || 'N/A', // Texto final aprovado da coluna E
                            solucaoImplementada: resposta['Solução Implementada'] || resposta.solucaoImplementada || '',
                            historicoAtendimento: resposta['Histórico Atendimento'] || resposta.historicoAtendimento || '',
                            observacoesInternas: resposta['Observações Internas'] || resposta.observacoesInternas || '',
                            status: resposta['Status Aprovação'] || resposta.Status || 'Aprovada'
                        });
                    });
                    
                    console.log(`✅ ${respostasAprovadas.length} respostas coerentes encontradas (de ${respostas.length} total)`);
                }
            } catch (error) {
                console.error('❌ Erro ao buscar respostas:', error.message);
            }
        }

        // Buscar moderações coerentes (apenas aprovadas)
        if (!tipo || tipo === 'moderacoes' || tipo === 'todas') {
            try {
                // Buscar resultados das páginas "Moderações Aceitas" e "Moderações Negadas"
                let resultadosMap = new Map(); // Map<ID, Resultado mais recente>
                try {
                    // Buscar moderações aceitas
                    // Planilha: "Dados de Solicitação", Página: "Moderações Aceitas", ID na coluna B (índice 1)
                    try {
                        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z10000');
                        if (aceitasData && aceitasData.length > 1) {
                            for (let i = 1; i < aceitasData.length; i++) {
                                const row = aceitasData[i];
                                if (!row || row.length < 2) continue;
                                
                                const idModeracao = row[1] ? row[1].toString().trim() : ''; // Coluna B: ID da Moderação
                                const dataRegistro = row[0] ? row[0].toString().trim() : ''; // Coluna A: Data do Registro
                                
                                if (idModeracao) {
                                    const idNormalized = idModeracao.replace(/\s+/g, '');
                                    if (!resultadosMap.has(idNormalized)) {
                                        resultadosMap.set(idNormalized, { resultado: 'Aceita', dataRegistro });
                                    } else {
                                        const existente = resultadosMap.get(idNormalized);
                                        if (dataRegistro && existente.dataRegistro) {
                                            try {
                                                const dataNova = new Date(dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                                const dataExistente = new Date(existente.dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                                if (dataNova > dataExistente) {
                                                    resultadosMap.set(idNormalized, { resultado: 'Aceita', dataRegistro });
                                                }
                                            } catch (e) {
                                                // Se não conseguir comparar, manter o existente
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.log('⚠️ Erro ao buscar moderações aceitas:', error.message);
                    }
                    
                    // Buscar moderações negadas
                    // Planilha: "Dados de Solicitação", Página: "Moderações Negadas", ID na coluna B (índice 1)
                    try {
                        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z10000');
                        if (negadasData && negadasData.length > 1) {
                            for (let i = 1; i < negadasData.length; i++) {
                                const row = negadasData[i];
                                if (!row || row.length < 2) continue;
                                
                                const idModeracao = row[1] ? row[1].toString().trim() : ''; // Coluna B: ID da Moderação
                                const dataRegistro = row[0] ? row[0].toString().trim() : ''; // Coluna A: Data do Registro
                                
                                if (idModeracao) {
                                    const idNormalized = idModeracao.replace(/\s+/g, '');
                                    if (!resultadosMap.has(idNormalized)) {
                                        resultadosMap.set(idNormalized, { resultado: 'Negada', dataRegistro });
                                    } else {
                                        const existente = resultadosMap.get(idNormalized);
                                        if (dataRegistro && existente.dataRegistro) {
                                            try {
                                                const dataNova = new Date(dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                                const dataExistente = new Date(existente.dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                                if (dataNova > dataExistente) {
                                                    resultadosMap.set(idNormalized, { resultado: 'Negada', dataRegistro });
                                                }
                                            } catch (e) {
                                                // Se não conseguir comparar, manter o existente
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.log('⚠️ Erro ao buscar moderações negadas:', error.message);
                    }
                    
                    console.log(`📊 ${resultadosMap.size} resultados encontrados nas páginas "Moderações Aceitas" e "Moderações Negadas"`);
                } catch (error) {
                    console.log('⚠️ Erro ao buscar resultados da moderação (continuando sem resultados):', error.message);
                }
                
                console.log('🔍 [API/SOLICITACOES] Buscando moderações coerentes...');
                const moderacoes = await googleSheetsIntegration.obterModeracoesCoerentes();
                console.log(`🔍 [API/SOLICITACOES] Total de moderações retornadas: ${moderacoes ? moderacoes.length : 0}`);
                
                if (moderacoes && moderacoes.length > 0) {
                    console.log(`✅ [API/SOLICITACOES] Processando ${moderacoes.length} moderações coerentes`);
                    // obterModeracoesCoerentes já filtra por Status Aprovação === 'Aprovada' e sem Feedback
                    moderacoes.forEach((moderacao, index) => {
                        console.log(`📋 [API/SOLICITACOES] Processando moderação ${index + 1}/${moderacoes.length}:`, {
                            id: moderacao[1] || moderacao.ID || moderacao.id,
                            status: moderacao['Status Aprovação'] || moderacao[12]
                        });
                        // Buscar Texto Moderação Reformulado na coluna J (índice 9)
                        // A coluna J é o índice 9 (A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9)
                        const textoModeracaoFinal = moderacao[9] !== undefined && moderacao[9] !== null && moderacao[9] !== ''
                            ? moderacao[9]
                            : (moderacao['Texto Moderação Reformulado'] || 
                               moderacao['Texto Moderação'] || 
                               moderacao.textoModeracao || '');
                        
                        // Buscar Solicitação Cliente na coluna D (índice 3)
                        const solicitacaoCliente = moderacao[3] !== undefined && moderacao[3] !== null && moderacao[3] !== ''
                            ? moderacao[3]
                            : (moderacao['Solicitação Cliente'] || moderacao.solicitacaoCliente || '');
                        
                        // Buscar Resposta Empresa na coluna E (índice 4)
                        const respostaEmpresa = moderacao[4] !== undefined && moderacao[4] !== null && moderacao[4] !== ''
                            ? moderacao[4]
                            : (moderacao['Resposta Empresa'] || moderacao.respostaEmpresa || '');
                        
                        console.log('🔍 DEBUG Moderação:', {
                            id: moderacao.ID || moderacao.id,
                            colunaJ: moderacao[9],
                            textoModeracaoFinal: textoModeracaoFinal,
                            colunaD: moderacao[3],
                            colunaE: moderacao[4]
                        });
                        
                        // Buscar resultado da moderação nas páginas "Moderações Aceitas" ou "Moderações Negadas"
                        // O ID está na coluna B (índice 1) da planilha "Moderações"
                        const moderacaoId = moderacao[1] || moderacao.ID || moderacao.id || '';
                        const moderacaoIdNormalized = moderacaoId.toString().trim().replace(/\s+/g, '');
                        const resultadoEncontrado = resultadosMap.get(moderacaoIdNormalized);
                        const resultadoModeracao = resultadoEncontrado ? resultadoEncontrado.resultado : null;
                        
                        todasSolicitacoes.push({
                            tipo: 'moderacao',
                            data: moderacao['Data/Hora'] || moderacao.data || '',
                            id: moderacao[1] || moderacao.ID || moderacao.id || '', // Usar índice [1] primeiro (coluna B)
                            solicitacaoCliente: solicitacaoCliente || 'N/A', // Solicitação completa do cliente da coluna D
                            respostaEmpresa: respostaEmpresa || 'N/A', // Resposta da empresa da coluna E
                            motivoModeracao: moderacao['Motivo Moderação'] || moderacao.motivoModeracao || '',
                            textoModeracao: textoModeracaoFinal || 'N/A', // Texto final aprovado da coluna J
                            linhaRaciocinio: moderacao['Linha Raciocínio'] || moderacao.linhaRaciocinio || '',
                            consideracaoFinal: moderacao['Consideração Final'] || moderacao.consideracaoFinal || '',
                            status: moderacao['Status Aprovação'] || moderacao.Status || 'Aprovada',
                            resultadoModeracao: resultadoModeracao // Resultado da página "Resultados da Moderação"
                        });
                    });
                    
                    console.log(`✅ ${moderacoes.length} moderações coerentes encontradas`);
                }
            } catch (error) {
                console.error('❌ Erro ao buscar moderações:', error.message);
            }
        }

        // Filtrar por período se fornecido (sempre aplicar se datas forem fornecidas)
        let solicitacoesFiltradas = todasSolicitacoes;
        
        // Aplicar filtro de data se fornecido (obrigatório quando datas são enviadas)
        if (dataInicio || dataFim) {
            console.log('📅 Aplicando filtro de data:', { dataInicio, dataFim });
            solicitacoesFiltradas = todasSolicitacoes.filter(solicitacao => {
                if (!solicitacao.data) return false;
                
                // Função auxiliar para converter data para formato comparável
                const parsearData = (dataStr) => {
                    if (!dataStr) return null;
                    
                    try {
                        // Formato brasileiro: DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
                        if (dataStr.includes('/')) {
                            const partes = dataStr.split(' ')[0].split('/');
                            if (partes.length === 3) {
                                const [dia, mes, ano] = partes;
                                return new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
                            }
                        }
                        
                        // Formato ISO: YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss
                        if (dataStr.includes('-') || dataStr.includes('T')) {
                            return new Date(dataStr);
                        }
                        
                        // Tentar parse direto
                        const parsed = new Date(dataStr);
                        if (!isNaN(parsed.getTime())) {
                            return parsed;
                        }
                    } catch (e) {
                        console.log('⚠️ Erro ao parsear data:', dataStr, e.message);
                    }
                    
                    return null;
                };
                
                const dataSolicitacao = parsearData(solicitacao.data);
                if (!dataSolicitacao) return false;

                // Normalizar datas de filtro para comparar apenas a data (sem hora)
                const inicio = dataInicio ? new Date(dataInicio + 'T00:00:00') : null;
                const fim = dataFim ? new Date(dataFim + 'T23:59:59') : null;

                // Comparar apenas a data (ignorar hora)
                const dataSolicitacaoNormalizada = new Date(dataSolicitacao.getFullYear(), dataSolicitacao.getMonth(), dataSolicitacao.getDate());
                
                if (inicio) {
                    const inicioNormalizado = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
                    if (dataSolicitacaoNormalizada < inicioNormalizado) return false;
                }
                
                if (fim) {
                    const fimNormalizado = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
                    if (dataSolicitacaoNormalizada > fimNormalizado) return false;
                }
                
                return true;
            });
        }

        // Ordenar por data (mais recente primeiro)
        solicitacoesFiltradas.sort((a, b) => {
            const dataA = new Date(a.data || 0);
            const dataB = new Date(b.data || 0);
            return dataB - dataA;
        });

        console.log(`✅ ${solicitacoesFiltradas.length} solicitações encontradas (de ${todasSolicitacoes.length} total)`);
        if (dataInicio || dataFim) {
            console.log(`📅 Filtro aplicado: ${dataInicio || 'sem início'} até ${dataFim || 'sem fim'}`);
        }

        res.json({
            success: true,
            solicitacoes: solicitacoesFiltradas,
            total: solicitacoesFiltradas.length,
            filtros: {
                dataInicio: dataInicio || null,
                dataFim: dataFim || null,
                tipo: tipo || 'todas'
            }
        });

    } catch (error) {
        console.error('Erro ao buscar solicitações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar solicitações',
            message: error.message
        });
    }
});

// Endpoint para visualizar feedbacks de explicações (aba Explicações)
app.get('/api/feedbacks/explicacoes', (req, res) => {
    try {
        const feedbacks = loadFeedbacksExplicacoes();
        res.json({
            success: true,
            data: feedbacks,
            tipo: 'explicacoes'
        });
    } catch (error) {
        console.error('Erro ao carregar feedbacks de explicações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar feedbacks de explicações'
        });
    }
});

// Endpoint para visualizar aprendizado direto do script
app.get('/api/aprendizado-script', async (req, res) => {
    try {
        const aprendizado = await loadAprendizadoScript();
        res.json({
            success: true,
            data: aprendizado,
            tipo: 'aprendizado_script'
        });
    } catch (error) {
        console.error('Erro ao carregar aprendizado do script:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar aprendizado do script'
        });
    }
});

// Endpoint para visualizar aprendizado de um tipo específico
app.get('/api/aprendizado-script/:tipoSituacao', async (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        const aprendizado = await getAprendizadoTipoSituacao(tipoSituacao);
        res.json({
            success: true,
            data: aprendizado,
            tipoSituacao: tipoSituacao
        });
    } catch (error) {
        console.error('Erro ao carregar aprendizado do tipo:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar aprendizado do tipo'
        });
    }
});

// Endpoint para forçar processamento de padrões
app.post('/api/processar-padroes/:tipoSituacao', async (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        console.log('🔄 Forçando processamento de padrões para:', tipoSituacao);
        await processarPadroesExistentes(tipoSituacao);
        const aprendizado = await getAprendizadoTipoSituacao(tipoSituacao);
        res.json({
            success: true,
            message: 'Padrões processados com sucesso',
            data: aprendizado
        });
    } catch (error) {
        console.error('Erro ao processar padrões:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao processar padrões'
        });
    }
});

// Endpoint para forçar sincronização de todos os feedbacks pendentes
app.post('/api/sincronizar-feedbacks-pendentes', async (req, res) => {
    try {
        console.log('🔄 Iniciando sincronização de feedbacks pendentes...');
        
        // Carregar todos os feedbacks de respostas
        const feedbacksRespostasSync = loadFeedbacksRespostas();
        const feedbacksModeracoesSync = loadFeedbacksModeracoes();
        const modelosRespostasSync = await loadModelosRespostas();
        const modelosModeracoesSync = loadModelosModeracoes();
        
        let totalSincronizados = 0;
        
        // Sincronizar feedbacks de respostas
        if (feedbacksRespostasSync?.respostas?.length > 0) {
            console.log(`📝 Sincronizando ${feedbacksRespostasSync.respostas.length} feedbacks de respostas...`);
            for (const feedback of feedbacksRespostasSync.respostas) {
                const tipoSituacao = feedback.contexto?.tipoSituacao || feedback.dadosFormulario?.tipo_solicitacao;
                if (tipoSituacao && feedback.feedback && feedback.respostaReformulada) {
                    await addFeedbackAprendizado(
                        tipoSituacao,
                        feedback.feedback,
                        feedback.respostaReformulada,
                        feedback.respostaAnterior,
                        feedback.userData
                    );
                    totalSincronizados++;
                }
            }
        }
        
        // Sincronizar modelos de respostas
        if (modelosRespostasSync?.modelos?.length > 0) {
            console.log(`📝 Sincronizando ${modelosRespostasSync.modelos.length} modelos de respostas...`);
            for (const modelo of modelosRespostasSync.modelos) {
                const tipoSituacao = modelo.tipo_situacao || modelo.contexto?.tipoSituacao;
                if (tipoSituacao && modelo.respostaAprovada) {
                    await addRespostaCoerenteAprendizado(
                        tipoSituacao,
                        modelo.id_reclamacao || modelo.dadosFormulario?.id_reclamacao,
                        modelo.respostaAprovada,
                        modelo.dadosFormulario,
                        modelo.userData
                    );
                    totalSincronizados++;
                }
            }
        }
        
        console.log(`✅ Sincronização concluída! ${totalSincronizados} itens sincronizados.`);
        
        res.json({
            success: true,
            message: `Sincronização concluída com sucesso! ${totalSincronizados} itens sincronizados.`,
            totalSincronizados: totalSincronizados
        });
    } catch (error) {
        console.error('Erro ao sincronizar feedbacks pendentes:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao sincronizar feedbacks pendentes',
            message: error.message
        });
    }
});

// Endpoint para verificar status do aprendizado
app.get('/api/status-aprendizado/:tipoSituacao', async (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        const aprendizado = await getAprendizadoTipoSituacao(tipoSituacao);
        res.json({
            success: true,
            tipoSituacao: tipoSituacao,
            status: {
                feedbacks: aprendizado.feedbacks.length,
                respostasCoerentes: aprendizado.respostasCoerentes.length,
                padroesIdentificados: aprendizado.padroesIdentificados.length,
                clausulasUsadas: aprendizado.clausulasUsadas.length
            },
            data: aprendizado
        });
    } catch (error) {
        console.error('Erro ao verificar status do aprendizado:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao verificar status do aprendizado'
        });
    }
});

// Endpoint para visualizar dados em memória (Vercel)
app.get('/api/dados-memoria', (req, res) => {
    try {
        const dadosMemoria = {
            feedbacksRespostas: feedbacksRespostasMemoria,
            modelosRespostas: modelosRespostasMemoria,
            feedbacksModeracoes: feedbacksModeracoesMemoria,
            modelosModeracoes: modelosModeracoesMemoria,
            aprendizadoScript: aprendizadoScriptMemoria,
            estatisticas: estatisticasGlobaisMemoria,
            ambiente: {
                vercel: !!process.env.VERCEL,
                nodeEnv: process.env.NODE_ENV,
                timestamp: obterTimestampBrasil()
            }
        };
        
        res.json({
            success: true,
            dados: dadosMemoria,
            resumo: {
                feedbacksRespostas: feedbacksRespostasMemoria?.respostas?.length || 0,
                modelosRespostas: modelosRespostasMemoria?.modelos?.length || 0,
                feedbacksModeracoes: feedbacksModeracoesMemoria?.moderacoes?.length || 0,
                modelosModeracoes: modelosModeracoesMemoria?.modelos?.length || 0,
                aprendizadoTipos: aprendizadoScriptMemoria?.tiposSituacao ? Object.keys(aprendizadoScriptMemoria.tiposSituacao).length : 0
            }
        });
    } catch (error) {
        console.error('Erro ao obter dados da memória:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter dados da memória'
        });
    }
});

// Endpoint para testar carregamento de dados específicos
app.get('/api/test-data-loading/:tipoSituacao', async (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        console.log(`🧪 Testando carregamento de dados para: ${tipoSituacao}`);
        
        // Carregar dados dos arquivos JSON
        const feedbacksRespostasTest = loadFeedbacksRespostas();
        const modelosRespostasTest = await loadModelosRespostas();
        
        console.log(`📊 Dados carregados:`, {
            feedbacksTotal: feedbacksRespostasTest?.respostas?.length || 0,
            modelosTotal: modelosRespostasTest?.modelos?.length || 0
        });
        
        // Filtrar dados relevantes
        const feedbacksRelevantes = feedbacksRespostasTest?.respostas?.filter(fb => 
            fb.contexto?.tipoSituacao === tipoSituacao || 
            fb.dadosFormulario?.tipo_solicitacao === tipoSituacao
        ) || [];
        
        const modelosRelevantes = modelosRespostasTest?.modelos?.filter(modelo => 
            modelo.tipo_situacao === tipoSituacao || 
            modelo.contexto?.tipoSituacao === tipoSituacao
        ) || [];
        
        console.log(`🎯 Dados filtrados para "${tipoSituacao}":`, {
            feedbacksRelevantes: feedbacksRelevantes.length,
            modelosRelevantes: modelosRelevantes.length
        });
        
        // Testar getAprendizadoTipoSituacao
        const aprendizado = await getAprendizadoTipoSituacao(tipoSituacao);
        
        console.log(`📚 Aprendizado retornado:`, {
            feedbacks: aprendizado.feedbacks?.length || 0,
            respostasCoerentes: aprendizado.respostasCoerentes?.length || 0
        });
        
        res.json({
            success: true,
            tipoSituacao,
            dados: {
                feedbacksCarregados: feedbacksRespostasTest?.respostas?.length || 0,
                modelosCarregados: modelosRespostasTest?.modelos?.length || 0,
                feedbacksRelevantes: feedbacksRelevantes.length,
                modelosRelevantes: modelosRelevantes.length,
                aprendizadoRetornado: {
                    feedbacks: aprendizado.feedbacks?.length || 0,
                    respostasCoerentes: aprendizado.respostasCoerentes?.length || 0
                }
            },
            exemplos: {
                feedbacksRelevantes: feedbacksRelevantes.slice(0, 2).map(fb => ({
                    tipoSituacao: fb.contexto?.tipoSituacao || fb.dadosFormulario?.tipo_solicitacao,
                    feedback: fb.feedback?.substring(0, 100) + '...',
                    timestamp: fb.timestamp
                })),
                modelosRelevantes: modelosRelevantes.slice(0, 2).map(modelo => ({
                    tipoSituacao: modelo.tipo_situacao || modelo.contexto?.tipoSituacao,
                    resposta: modelo.respostaAprovada?.substring(0, 100) + '...',
                    timestamp: modelo.timestamp
                }))
            },
            debug: {
                todosFeedbacks: feedbacksRespostasTest?.respostas?.slice(0, 3).map(fb => ({
                    tipoSituacao: fb.contexto?.tipoSituacao || fb.dadosFormulario?.tipo_solicitacao,
                    feedback: fb.feedback?.substring(0, 50) + '...'
                })),
                todosModelos: modelosRespostasTest?.modelos?.slice(0, 3).map(modelo => ({
                    tipoSituacao: modelo.tipo_situacao || modelo.contexto?.tipoSituacao,
                    resposta: modelo.respostaAprovada?.substring(0, 50) + '...'
                }))
            }
        });
    } catch (error) {
        console.error('Erro ao testar carregamento de dados:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao testar carregamento de dados'
        });
    }
});

// Endpoint simples para debug do aprendizado
app.get('/api/debug-aprendizado-simples', (req, res) => {
    try {
        console.log('🔍 DEBUG SIMPLES DO APRENDIZADO');
        
        // Verificar memória
        const memoria = {
            temMemoria: !!aprendizadoScriptMemoria,
            tiposMemoria: aprendizadoScriptMemoria?.tiposSituacao ? Object.keys(aprendizadoScriptMemoria.tiposSituacao) : [],
            lastUpdated: aprendizadoScriptMemoria?.lastUpdated
        };
        
        // Detalhar cada tipo de situação na memória
        const detalhesTipos = {};
        if (aprendizadoScriptMemoria?.tiposSituacao) {
            for (const [tipo, dados] of Object.entries(aprendizadoScriptMemoria.tiposSituacao)) {
                detalhesTipos[tipo] = {
                    feedbacks: dados.feedbacks?.length || 0,
                    respostasCoerentes: dados.respostasCoerentes?.length || 0,
                    padroesIdentificados: dados.padroesIdentificados?.length || 0,
                    clausulasUsadas: dados.clausulasUsadas?.length || 0,
                    ultimoFeedback: dados.feedbacks?.length > 0 ? dados.feedbacks[dados.feedbacks.length - 1]?.timestamp : null,
                    ultimaRespostaCoerente: dados.respostasCoerentes?.length > 0 ? dados.respostasCoerentes[dados.respostasCoerentes.length - 1]?.timestamp : null
                };
            }
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            memoria: memoria,
            detalhesTipos: detalhesTipos
        });
        
    } catch (error) {
        console.error('❌ Erro no debug simples:', error);
        res.status(500).json({
            success: false,
            error: 'Erro no debug simples',
            message: error.message
        });
    }
});

// Endpoint para debug completo do sistema de aprendizado
app.get('/api/debug-aprendizado-completo', async (req, res) => {
    try {
        console.log('🔍 DEBUG COMPLETO DO SISTEMA DE APRENDIZADO');
        
        // Verificar memória primeiro (mais seguro)
        const memoria = {
            temMemoria: !!aprendizadoScriptMemoria,
            tiposMemoria: aprendizadoScriptMemoria?.tiposSituacao ? Object.keys(aprendizadoScriptMemoria.tiposSituacao) : [],
            lastUpdated: aprendizadoScriptMemoria?.lastUpdated
        };
        
        // Tentar carregar aprendizado completo
        let aprendizadoCompleto = null;
        let estrutura = {
            existe: false,
            temTiposSituacao: false,
            tiposDisponiveis: [],
            totalTipos: 0
        };
        
        try {
            aprendizadoCompleto = await loadAprendizadoScript();
            estrutura = {
                existe: !!aprendizadoCompleto,
                temTiposSituacao: !!aprendizadoCompleto?.tiposSituacao,
                tiposDisponiveis: aprendizadoCompleto?.tiposSituacao ? Object.keys(aprendizadoCompleto.tiposSituacao) : [],
                totalTipos: aprendizadoCompleto?.tiposSituacao ? Object.keys(aprendizadoCompleto.tiposSituacao).length : 0
            };
        } catch (loadError) {
            console.error('❌ Erro ao carregar aprendizado:', loadError.message);
            estrutura.erro = loadError.message;
        }
        
        // Detalhar cada tipo de situação
        const detalhesTipos = {};
        if (aprendizadoCompleto?.tiposSituacao) {
            for (const [tipo, dados] of Object.entries(aprendizadoCompleto.tiposSituacao)) {
                detalhesTipos[tipo] = {
                    feedbacks: dados.feedbacks?.length || 0,
                    respostasCoerentes: dados.respostasCoerentes?.length || 0,
                    padroesIdentificados: dados.padroesIdentificados?.length || 0,
                    clausulasUsadas: dados.clausulasUsadas?.length || 0,
                    ultimoFeedback: dados.feedbacks?.length > 0 ? dados.feedbacks[dados.feedbacks.length - 1]?.timestamp : null,
                    ultimaRespostaCoerente: dados.respostasCoerentes?.length > 0 ? dados.respostasCoerentes[dados.respostasCoerentes.length - 1]?.timestamp : null
                };
            }
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            estrutura: estrutura,
            detalhesTipos: detalhesTipos,
            memoria: memoria,
            aprendizadoCompleto: aprendizadoCompleto
        });
        
    } catch (error) {
        console.error('❌ Erro no debug do aprendizado:', error);
        res.status(500).json({
            success: false,
            error: 'Erro no debug do aprendizado',
            message: error.message,
            stack: error.stack
        });
    }
});

// Endpoint para visualizar todos os feedbacks (compatibilidade)
app.get('/api/feedbacks', (req, res) => {
    try {
        const feedbacks = loadFeedbacks();
        res.json({
            success: true,
            data: feedbacks,
            tipo: 'todos'
        });
    } catch (error) {
        console.error('Erro ao carregar feedbacks:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar feedbacks'
        });
    }
});

// Endpoint para limpar feedbacks de respostas (aba Respostas RA)
app.delete('/api/feedbacks/respostas', async (req, res) => {
    try {
        const feedbacksVazios = {
            respostas: [],
            lastUpdated: obterTimestampBrasil()
        };
        await saveFeedbacksRespostas(feedbacksVazios);
        res.json({
            success: true,
            message: 'Feedbacks de respostas limpos com sucesso'
        });
    } catch (error) {
        console.error('Erro ao limpar feedbacks de respostas:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao limpar feedbacks de respostas'
        });
    }
});

// Endpoint para limpar feedbacks de moderações (aba Moderação RA)
app.delete('/api/feedbacks/moderacoes', async (req, res) => {
    try {
        const feedbacksVazios = {
            moderacoes: [],
            lastUpdated: obterTimestampBrasil()
        };
        await saveFeedbacksModeracoes(feedbacksVazios);
        res.json({
            success: true,
            message: 'Feedbacks de moderações limpos com sucesso'
        });
    } catch (error) {
        console.error('Erro ao limpar feedbacks de moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao limpar feedbacks de moderações'
        });
    }
});

// Endpoint para limpar feedbacks de explicações (aba Explicações)
app.delete('/api/feedbacks/explicacoes', (req, res) => {
    try {
        const feedbacksVazios = {
            explicacoes: [],
            lastUpdated: obterTimestampBrasil()
        };
        saveFeedbacksExplicacoes(feedbacksVazios);
        res.json({
            success: true,
            message: 'Feedbacks de explicações limpos com sucesso'
        });
    } catch (error) {
        console.error('Erro ao limpar feedbacks de explicações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao limpar feedbacks de explicações'
        });
    }
});

// Endpoint para limpar todos os feedbacks (compatibilidade)
app.delete('/api/feedbacks', (req, res) => {
    try {
        const feedbacksVazios = {
            respostas: [],
            moderacoes: [],
            lastUpdated: obterTimestampBrasil()
        };
        saveFeedbacks(feedbacksVazios);
        res.json({
            success: true,
            message: 'Todos os feedbacks limpos com sucesso'
        });
    } catch (error) {
        console.error('Erro ao limpar feedbacks:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao limpar feedbacks'
        });
    }
});

// Endpoint para salvar resposta como modelo (quando clicar em "Resposta Coerente")
app.post('/api/save-modelo-resposta', async (req, res) => {
    console.log('🎯 Endpoint /api/save-modelo-resposta chamado');
    try {
        const { dadosFormulario, respostaAprovada, userData } = req.body;
        
        if (!dadosFormulario || !respostaAprovada) {
            return res.status(400).json({
                success: false,
                error: 'Dados do formulário e resposta aprovada são obrigatórios'
            });
        }
        
        console.log('💾 Salvando resposta como modelo:', {
            tipo_situacao: dadosFormulario.tipo_solicitacao,
            motivo_solicitacao: dadosFormulario.motivo_solicitacao,
            resposta_length: respostaAprovada.length,
            userData: userData ? `${userData.nome} (${userData.email})` : 'N/A'
        });
        
        // Salvar como modelo
        const modelo = await addModeloResposta(dadosFormulario, respostaAprovada, userData);
        
        // Incrementar estatística global
        await incrementarEstatisticaGlobal('respostas_coerentes');
        
        // Se estiver na Vercel, salvar diretamente no Google Sheets
        let syncResult = null;
        console.log('🔍 DEBUG - Verificando ambiente:', {
            VERCEL: process.env.VERCEL,
            NODE_ENV: process.env.NODE_ENV,
            googleSheetsActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false
        });
        
        if (process.env.VERCEL) {
            try {
                console.log('🔄 Vercel detectada - salvando diretamente no Google Sheets...');
                
                // Tentar inicializar Google Sheets se não estiver ativo
                if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
                    console.log('🔄 Tentando inicializar Google Sheets automaticamente...');
                    try {
                        const envVars = loadEnvFile();
                        envVars.ENABLE_GOOGLE_SHEETS = 'true'; // Forçar ativação
                        const success = await googleSheetsIntegration.initialize(envVars);
                        if (success) {
                            global.googleSheetsInitialized = true;
                            console.log('✅ Google Sheets inicializado automaticamente');
                        }
                    } catch (error) {
                        console.log('❌ Erro ao inicializar Google Sheets:', error.message);
                    }
                }
                
                // NOTA: Registro no Google Sheets já foi feito em addModeloResposta para evitar duplicação
                syncResult = { googleSheets: 'Registrado em addModeloResposta' };
                console.log('✅ Modelo já registrado no Google Sheets via addModeloResposta');
                
                // Tentar sincronizar com arquivos locais também (backup) - apenas em desenvolvimento
                if (!process.env.VERCEL) {
                    const localServerUrl = 'http://localhost:3001';
                    const syncData = {
                        modeloResposta: modelo,
                        aprendizadoScript: aprendizadoScriptMemoria
                    };
                    
                    // Tentar sincronizar (não bloquear se falhar)
                    fetch(`${localServerUrl}/api/sync-vercel-to-local`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(syncData)
                    }).then(response => response.json())
                    .then(result => {
                        console.log('✅ Sincronização com arquivos locais:', result);
                        if (syncResult) {
                            syncResult.localFiles = result;
                        }
                    }).catch(error => {
                        console.log('⚠️ Servidor local não disponível para sincronização:', error.message);
                    });
                } else {
                    console.log('📊 Modo produção - sincronização local desabilitada');
                }
                
            } catch (error) {
                console.log('⚠️ Erro na sincronização automática:', error.message);
            }
        }
        
        // Verificar status da memória após salvar
        const memoriaStatus = {
            totalModelos: modelosRespostasMemoria?.modelos?.length || 0,
            ultimaAtualizacao: modelosRespostasMemoria?.lastUpdated || 'N/A',
            ambiente: process.env.VERCEL ? 'Vercel (memória)' : 'Local (arquivo)',
            sincronizacao: process.env.VERCEL ? 'Tentativa automática com servidor local' : 'N/A'
        };
        
        res.json({
            success: true,
            message: 'Resposta salva como modelo para futuras solicitações similares',
            modeloId: modelo.id,
            tipoSituacao: modelo.tipo_situacao,
            memoriaStatus: memoriaStatus,
            syncResult: syncResult
        });
        
    } catch (error) {
        console.error('Erro ao salvar modelo de resposta:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para revisão de textos
app.post('/api/revisar-texto', async (req, res) => {
    console.log('🎯 Endpoint /api/revisar-texto chamado');
    try {
        const { textoOriginal, tipoRevisao, observacoes } = req.body;
        
        if (!textoOriginal || !tipoRevisao || tipoRevisao.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Texto original e tipo de revisão são obrigatórios'
            });
        }
        
        // Construir prompt estruturado para revisão
        const tiposRevisaoTexto = tipoRevisao.map(tipo => {
            switch(tipo) {
                case 'padronizacao': return 'Padronização';
                case 'clareza': return 'Melhoria de Clareza';
                case 'compliance': return 'Compliance';
                case 'estrutura': return 'Estrutura';
                default: return tipo;
            }
        }).join(', ');
        
        const prompt = `
📌 SCRIPT ESTRUTURADO PARA REVISÃO DE TEXTOS

ENTRADA OBRIGATÓRIA:
- Texto original: ${textoOriginal}
- Tipo de revisão: ${tiposRevisaoTexto}
- Observações adicionais: ${observacoes || 'Nenhuma'}

⚙️ FLUXO LÓGICO OBRIGATÓRIO:

1. LEITURA INICIAL
- Leia o texto original atentamente
- Entenda o objetivo principal do texto (informar, responder cliente, pedir moderação, etc.)
- Verifique se há observações adicionais que indicam ajustes específicos

2. ANÁLISE CONFORME TIPO DE REVISÃO SELECIONADO:

🔹 PADRONIZAÇÃO (se selecionado):
- Ajustar para o tom de voz usado pela empresa (formal/técnico, ou simpático/acolhedor, conforme contexto)
- Uniformizar termos (ex.: usar sempre "antecipação de restituição" e não variações soltas)
- Garantir consistência em datas, números e referências contratuais

🔹 MELHORIA DE CLAREZA (se selecionado):
- Reescrever frases longas em versões mais diretas
- Evitar jargões técnicos sem explicação
- Dar ritmo fluido (períodos curtos, parágrafos objetivos)

🔹 COMPLIANCE (se selecionado):
- Validar se o texto está aderente à LGPD (dados pessoais só quando necessário)
- Aos contratos (ex.: Cédula de Crédito Bancário – CCB)
- Aos manuais do RA (se for resposta/moderação)
- Remover termos arriscados: promessas não garantidas, subjetividades ("sempre", "nunca", "garantimos")
- Checar se não há afirmações incorretas sobre leis ou processos

🔹 ESTRUTURA (se selecionado):
- Verificar se o texto tem início (contexto), meio (explicação) e fim (encaminhamento/solução)
- Garantir uso de tópicos ou parágrafos quando facilita a leitura
- Sugerir títulos, subtítulos ou formatações quando aplicável

3. CONSTRUÇÃO DA LINHA DE RACIOCÍNIO INTERNA:
- Indicar quais pontos foram analisados
- Explicar quais mudanças foram feitas ou sugeridas
- Justificar com base em boas práticas de redação e, quando aplicável, em compliance/contrato/manual RA

4. ENTREGA FINAL OBRIGATÓRIA:

FORMATO DE SAÍDA OBRIGATÓRIO:
(1) LINHA DE RACIOCÍNIO INTERNA (explicação do processo)
[Conteúdo da linha de raciocínio interna]

(2) TEXTO REVISADO (versão final pronta para uso)
[Texto revisado seguindo as diretrizes solicitadas]

⚠️ CRÍTICO: A saída DEVE conter exatamente estes dois blocos, separados pelos marcadores (1) e (2).

🚫 PROIBIDO: NÃO cite o texto original literalmente. Analise o conteúdo e reformule baseado na análise, não na citação dos dados.`;

        console.log('📝 Enviando solicitação para OpenAI...');
        
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada'
            });
        }
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um especialista em revisão de textos corporativos, focado em clareza, compliance e padronização. Sempre siga exatamente o formato de saída solicitado.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            return res.status(errorResponse.statusCode).json(errorResponse);
        }

        const data = await response.json();
        const resultado = data.choices[0].message.content;
        console.log('✅ Revisão de texto gerada com sucesso');

        // Incrementar estatística global
        await incrementarEstatisticaGlobal('revisoes_texto');

        res.json({
            success: true,
            result: resultado
        });

    } catch (error) {
        console.error('❌ Erro na revisão de texto:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor na revisão de texto'
        });
    }
});

// Função auxiliar para extrair resposta revisada do resultado da análise
function extrairRespostaRevisadaDoResultado(resultado) {
    if (!resultado || typeof resultado !== 'string') return '';
    
    // Procurar pela seção "✍️ Revisão de Textos (versão estratégica)"
    const marcadores = [
        '✍️ Revisão de Textos (versão estratégica)',
        'Revisão de Textos (versão estratégica)',
        'REVISÃO DE TEXTOS',
        'Resposta pública revisada'
    ];
    
    for (const marcador of marcadores) {
        const index = resultado.indexOf(marcador);
        if (index !== -1) {
            // Pegar o conteúdo após o marcador até o próximo marcador ou fim
            let conteudo = resultado.substring(index + marcador.length).trim();
            
            // Remover marcadores seguintes se houver
            const proximosMarcadores = ['🧠', '📊', '⚠️', '🎯', '🧩', '🔍', '📈'];
            for (const proxMarcador of proximosMarcadores) {
                const proxIndex = conteudo.indexOf(proxMarcador);
                if (proxIndex !== -1) {
                    conteudo = conteudo.substring(0, proxIndex).trim();
                }
            }
            
            return conteudo.trim();
        }
    }
    
    return '';
}

// Endpoint para análise de chance de moderação
app.post('/api/chance-moderacao', async (req, res) => {
    console.log('🎯 Endpoint /api/chance-moderacao chamado');
    try {
        const { reclamacaoCompleta, respostaPublica, consideracaoFinal, historicoModeracao } = req.body;
        
        if (!reclamacaoCompleta || !respostaPublica) {
            return res.status(400).json({
                success: false,
                error: 'Reclamação completa e resposta pública são obrigatórias'
            });
        }
        
        // Construir prompt completo conforme especificado
        const prompt = `🧠🔥 PROMPT DEFINITIVO
ANÁLISE DE MODERAÇÃO – VISÃO VELOTAX (MODO ESPECIALISTA ABSOLUTO)
⚠️ LEIA COM ATENÇÃO – ESTE PROMPT DEFINE COMPORTAMENTO

Você NÃO É um assistente genérico.
Você NÃO É um leitor literal de manual.
Você NÃO É um advogado.

Você é uma IA Analista Estratégica de Moderação do Reclame Aqui, treinada para replicar o raciocínio humano especializado utilizado pela Velotax em decisões reais de moderação, com base em:

Experiência prática reiterada na plataforma Reclame Aqui

Padrões históricos de aceite e negativa de moderação

Leitura estratégica (não literal) dos Manuais Oficiais

Foco em resultado operacional (aceite de moderação)

Você atua como se fosse um analista humano sênior, responsável por orientar decisões sensíveis que impactam reputação, score e visibilidade da empresa.

📚 BASE DE CONHECIMENTO (USO OBRIGATÓRIO)

Você tem acesso e deve consultar ativamente:

Manual Geral de Moderação do Reclame Aqui

Manual de Moderação – Bancos, Instituições Financeiras e Meios de Pagamento

⚠️ CONTEXTO OBRIGATÓRIO

Você está analisando reclamações do Reclame Aqui sob a visão estratégica Velotax, utilizando obrigatoriamente os manuais acima.

Seu papel não é avaliar mérito jurídico, mas sim avaliar se o CONTEÚDO DA RECLAMAÇÃO é moderável.

⚠️ IMPORTANTE
Você deve usar os manuais como critério decisório, mas NUNCA como argumento jurídico isolado.

O Reclame Aqui não remove reclamações porque "está no contrato"
O Reclame Aqui remove reclamações porque o conteúdo publicado é inconsistente, incorreto, omisso ou desconectado da realidade factual

🎯 OBJETIVO CENTRAL (VISÃO VELOTAX – NÃO NEGOCIÁVEL)

Dado QUALQUER caso, você deve SEMPRE:

Buscar a melhor tese possível de moderação

Calcular a chance real de aceite, sem inflar números

Ajustar a resposta pública para maximizar a chance

Entregar feedback estratégico, como um analista humano faria

❌ Você NUNCA deve responder apenas "não vale pedir moderação".
✅ Mesmo com chance baixa, você deve explicar o porquê e indicar a melhor estratégia possível.

📥 INPUTS DISPONÍVEIS

Você receberá sempre:

Reclamação completa do consumidor

Resposta pública da empresa

Consideração final (se houver)

Histórico de tentativas de moderação (se houver)

Você deve assumir que:

Os fatos narrados pela empresa são verídicos

Seu papel não é questionar a empresa, mas testar a narrativa do cliente contra critérios do RA

🧩 METODOLOGIA DE ANÁLISE (OBRIGATÓRIA E SEQUENCIAL)

❗ REGRA CRÍTICA (FALHA IDENTIFICADA)

Sempre que o consumidor afirmar um fato objetivo (ex: bloqueio, retenção, impedimento, cobrança, negativa), você deve obrigatoriamente verificar:

Se a resposta da empresa desmente ou contextualiza esse fato

Se existe ação voluntária do cliente omitida

Se a reclamação induz o leitor a erro por ausência de contexto

⚠️ Não trate automaticamente como "interpretação equivocada"
quando houver omissão de um evento relevante.

🧠 NOVA LÓGICA OBRIGATÓRIA DE DECISÃO

PASSO 1 — Classificação da alegação

Pergunte explicitamente:

O cliente está relatando um fato verificável ou apenas uma percepção?

Se for fato verificável, avance para o Passo 2.

PASSO 2 — Confronto com a resposta

Se a resposta indicar que:

o cliente solicitou a retirada da chave

a empresa não impediu portabilidade

não houve bloqueio coercitivo

👉 Isso caracteriza OMISSÃO DE FATO ESSENCIAL, e não apenas interpretação equivocada.

PASSO 3 — Escolha correta da tese principal

Priorize a seguinte hierarquia:

1️⃣ Omissão de fato essencial
2️⃣ Informação incorreta
3️⃣ Divergência entre relato e solução aplicada
4️⃣ Interpretação equivocada

⚠️ Interpretação equivocada só deve ser usada quando NÃO houver omissão relevante.

PASSO 4 — Recalibração da chance de moderação

Quando houver:

alegação grave (ilegalidade, Bacen, retenção)

prova documental na resposta

omissão clara do consumidor

👉 Nunca classificar como "chance baixa" automaticamente.

Faixa mínima recomendada nesses casos:

60–70%

🧠 ETAPA 1 — DESCONSTRUÇÃO TOTAL DA RECLAMAÇÃO

Leia a reclamação e responda internamente:

Qual é a acusação central real?
(não a emocional, a objetiva)

O cliente está afirmando um fato verificável ou uma percepção?

O texto contém:

exagero narrativo?

linguagem jurídica sem prova?

conclusões subjetivas travestidas de fato?

O cliente omite algo essencial?

decisão própria?

contato prévio?

solução aplicada?

prazo ainda em curso?

⚠️ Pense como o analista do RA:

"Se isso fosse verdade, eu removeria?"

🧠 ETAPA 2 — CONFRONTO RECLAMAÇÃO × RESPOSTA

Compare os dois textos como se estivesse procurando falhas narrativas:

A resposta:

enfrenta diretamente a acusação?

traz datas, registros, decisões do cliente?

demonstra cronologia lógica?

A resposta ajuda ou atrapalha a moderação?

defensiva demais?

jurídica demais?

vaga demais?

⚠️ Lembre-se:

Explicar bem ≠ tornar moderável
Só fatos divergentes tornam moderável

🧠 ETAPA 3 — IDENTIFICAÇÃO DO NÚCLEO MODERÁVEL REAL

Você deve identificar UM núcleo central, mesmo que frágil:

Seguindo a hierarquia obrigatória do PASSO 3, escolha APENAS UM como tese principal:

1️⃣ Omissão de fato essencial (PRIORIDADE MÁXIMA)

2️⃣ Informação incorreta

3️⃣ Divergência entre reclamação e solução aplicada

4️⃣ Interpretação equivocada do funcionamento do serviço (só quando NÃO houver omissão relevante)

Conteúdo impróprio (ofensa, ameaça, linguagem abusiva)

❌ Nunca trate "empresa não violou direito" como núcleo isolado.
Ela NÃO É tese editorial primária.

🧠 ETAPA 4 — USO CORRETO DA TESE
"A empresa não violou o direito do consumidor"

Você deve aplicar a seguinte regra OBRIGATÓRIA:

❌ Nunca usar como tese principal isolada

✅ Usar como tese complementar, quando:

a resposta desmonta a acusação factual;

não há dano persistente;

a reclamação perde materialidade;

a narrativa do cliente se sustenta apenas em inconformismo.

👉 Ela serve para reforçar a descaracterização, não para justificá-la sozinha.

📊 ETAPA 5 — CÁLCULO DA CHANCE DE MODERAÇÃO

Você deve sempre apresentar percentual, baseado em padrão real do RA:

Faixa    Leitura correta
0–20%    Muito baixa – tese fraca
25–40%    Baixa
45–60%    Média
65–75%    Média-alta
80–90%    Alta
95%    Muito alta (raro)

⚠️ Regras:

Seja honesto

Não superestime

A credibilidade do sistema depende disso

🔒 CALIBRAÇÃO REALISTA — TETOS AUTOMÁTICOS (OBRIGATÓRIO)

A IA DEVE aplicar limitadores objetivos (hard limits) conforme o tipo de reclamação:

🔹 TETO MÁXIMO: 70%

Aplicar quando a reclamação envolve:

- Pix (CPF como chave)
- Juros, encargos, "juros abusivos"
- Banco Central, Bacen, Resoluções
- Ameaça de Procon ou ação judicial

⚠️ Mesmo após revisão de texto, NÃO ultrapassar 70% nestes casos.

🔹 TETO MÁXIMO: 65%

Aplicar quando a reclamação tem:

- Forte carga emocional
- Narrativa pessoal extensa
- Tom acusatório intenso

🔹 TETO MÁXIMO: 75% (EXCEÇÃO)

Aplicar APENAS quando houver:

- Omissão de fato essencial comprovada e documental
- Pedido expresso do cliente registrado
- Logs claros e incontestáveis

⚠️ NUNCA ultrapassar 75%, mesmo em casos excepcionais.

📌 OBRIGATÓRIO: Explicitar quando o teto foi aplicado.

Exemplo: "A probabilidade foi limitada a 70% em razão da natureza sensível do tema (Pix/CPF), conforme critérios do sistema."

⚠️ REGRA ESPECIAL DE RECALIBRAÇÃO (PASSO 4):

Quando houver alegação grave (ilegalidade, Bacen, retenção) + prova documental na resposta + omissão clara do consumidor:

👉 Nunca classificar como "chance baixa" automaticamente.

Faixa mínima recomendada: 60–70% (respeitando os tetos acima)

⚠️ ETAPA 6 — MAPA DE RISCOS (FEEDBACK HUMANO)

Aqui você deve agir como eu faria com você:

Explique claramente:

por que o RA pode negar

qual leitura mais provável do analista:

dúvida legítima?

inconformismo?

exercício regular do direito de reclamar?

⚠️ IMPORTANTE: Especialmente se o analista não identificar claramente a omissão do pedido de retirada da chave Pix (ou outro fato essencial omitido) no texto do consumidor.

Isso mostra que você entende exatamente onde o RA costuma errar.

Esse feedback é tão importante quanto a porcentagem.

⚠️ REGRA FINAL PARA A INTERFACE

Sempre que o consumidor acusar ilegalidade regulatória
e a resposta demonstrar que o fato central é incompleto ou omitido,
a análise NUNCA deve parar em "inconformismo".

Isso é exatamente o tipo de erro que derruba taxa de moderação.

✍️ ETAPA 7 — REESCRITA ESTRATÉGICA (OBRIGATÓRIA)

⚠️ VALIDAÇÃO OBRIGATÓRIA: REVISÃO REAL vs AJUSTE COSMÉTICO

Antes de classificar um texto como "Resposta Reformulada (versão estratégica)", você DEVE executar validação interna.

📌 DEFINIÇÕES OBRIGATÓRIAS:

✅ REVISÃO REAL (válida):

Considera-se revisão real quando a nova resposta pública apresenta ao menos UM dos critérios abaixo:

- Mudança explícita de enquadramento narrativo
  (ex: antecipação de fato essencial omitido pelo consumidor)

- Reorganização da ordem dos fatos para reduzir risco interpretativo

- Inclusão clara de elemento que reforce diretamente a tese principal de moderação

- Supressão de trechos defensivos longos em favor de objetividade factual

- Alteração que torne inequívoca a omissão, inconsistência ou incorreção do relato do consumidor

❌ AJUSTE COSMÉTICO (não válido como revisão):

Considera-se ajuste cosmético quando ocorre apenas:

- Troca de conectivos

- Pequenos ajustes de fluidez ou formalidade

- Repetição integral da estrutura original

- Manutenção da mesma ordem de argumentos

- Ausência de reforço explícito da tese de moderação

- Texto "mais bonito", porém semanticamente equivalente ao original

🔍 VALIDAÇÃO MÍNIMA OBRIGATÓRIA:

Antes de classificar como "Resposta Reformulada", compare Resposta Pública Original × Resposta Gerada e verifique:

1. Houve mudança de enquadramento?
2. Houve reforço explícito da tese principal?
3. Houve reorganização estratégica dos fatos?

👉 Se todas as respostas forem "não":

❌ AÇÃO OBRIGATÓRIA:

- NÃO classificar como "Resposta Reformulada"
- Classificar como: "Resposta Mantida – sem alteração estratégica"
- NÃO aplicar ganho de chance de moderação
- Manter a chance estimada original

📈 REGRA SOBRE IMPACTO NA CHANCE DE MODERAÇÃO:

O bloco "Impacto da Revisão de Texto":

- Só pode ser exibido se houver revisão real validada
- É proibido atribuir aumento de chance baseado apenas em ajustes cosméticos

Caso não haja revisão real:

- O bloco deve não ser exibido
- OU indicar explicitamente: "Não houve alteração estratégica no texto; a chance de moderação permanece inalterada."

📌 TRANSPARÊNCIA PARA O AGENTE HUMANO:

Sempre que identificar ajuste cosmético, deixe claro:

"A resposta pública foi mantida sem alteração estratégica, pois não foram identificadas mudanças de enquadramento relevantes para moderação."

🧠 REGRA-MÃE DESTA EXTENSÃO:

Texto só é considerado reformulado quando reforça a tese de moderação.
Clareza estética não equivale a impacto estratégico.

---

Sempre que houver QUALQUER possibilidade de ganho REAL (não cosmético):

Você DEVE:

Reescrever a resposta pública

Ajustar:

tom

ordem dos fatos

destaque de omissões do cliente

Tornar o texto:

neutro

factual

pensado para um analista externo

🔄 MUDANÇA DE LINGUAGEM: MENOS DEFENSIVA, MAIS ENQUADRADORA

⚠️ PROBLEMA IDENTIFICADO:

A resposta reformulada não deve soar como "a empresa está se defendendo".

✅ OBJETIVO:

A resposta deve fazer "o leitor perceber que a narrativa do consumidor está incompleta".

✅ REGRA DE LINGUAGEM ESTRATÉGICA:

🔄 Substituir postura defensiva por postura de enquadramento factual

🚫 EVITAR EXCESSO DE:

- "esclarecemos que…"
- "não houve má-fé…"
- "ressaltamos que…"
- "gostaríamos de esclarecer…"
- "é importante destacar que…"

✅ PRIORIZAR CONSTRUÇÕES QUE:

- Apresentam fatos objetivos diretamente
- Deixam a omissão do consumidor implícita e evidente
- Reduzem espaço interpretativo do analista
- Conduzem à conclusão lógica sem confrontar

📌 DIRETRIZ ESTRATÉGICA:

"A resposta deve conduzir o analista do Reclame Aqui à conclusão lógica de que a reclamação parte de uma narrativa incompleta, sem acusar diretamente o consumidor."

🚫 A IA NÃO DEVE:

- Confrontar emocionalmente o cliente
- Usar tom jurídico agressivo
- Parecer justificativa extensa
- Criar tom de "defesa" ou "explicação"

🧠 REGRA-MÃE DESTE AJUSTE:

A análise não existe para "ganhar a discussão",
mas para facilitar a decisão do analista do Reclame Aqui,
reduzindo esforço cognitivo e risco interpretativo.

✍️ AJUSTE NA ABA "REVISÃO DE TEXTOS" (OBRIGATÓRIO)

A resposta revisada deve:

explicitar que não houve retenção coercitiva (quando aplicável)

deixar claro que a retirada da chave ocorreu a pedido do cliente (quando aplicável)

neutralizar a tese de ilegalidade regulatória (quando aplicável)

ser escrita para o analista do RA, não para o consumidor

👉 MICRO MELHORIA ESTRATÉGICA (PARA MAXIMIZAR MODERAÇÃO):

Nomear explicitamente o ponto omitido, sem acusar o cliente.

Exemplo (1 frase que vale ouro):

"Importante esclarecer que não houve retenção coercitiva da chave Pix, uma vez que a desvinculação foi realizada a partir de solicitação do próprio cliente, conforme registrado no atendimento."

Isso "ensina" o analista do RA a enxergar a omissão.

⚠️ FORMATO DE SAÍDA DA REVISÃO DE TEXTOS (OBRIGATÓRIO):

IMPORTANTE: Você deve gerar APENAS o conteúdo do meio da resposta, SEM saudação inicial e SEM assinatura final.

A estrutura completa (saudação com nome do cliente, apresentação do agente, informações de contato e assinatura) será aplicada automaticamente pelo sistema.

Gere APENAS o texto explicativo que vai entre a apresentação do agente e as informações de contato. Este texto deve:
- Responder diretamente à reclamação do consumidor
- Explicar a solução implementada
- Ser específico e detalhado
- Demonstrar expertise técnica, transparência e compromisso
- Estar sempre contextualizado para a Velotax
- NUNCA incluir pedidos de desculpas ou expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Ser firme e objetivo, sem excesso de tom acolhedor
- Ter boa estruturação com parágrafos separados para facilitar a leitura

NÃO inclua:
- "Olá, [nome]" ou qualquer saudação
- "Sou [nome], especialista..." ou apresentação
- Informações de contato (telefones, site)
- "Atenciosamente" ou assinatura
- Qualquer estrutura de cabeçalho ou rodapé

⚠️ REGRA CRÍTICA

A versão revisada DEVE SER AUTOMATICAMENTE INSERIDA na aba
"Revisão de Textos", pronta para publicação.

🧾 FORMATO FINAL DA RESPOSTA (IMUTÁVEL E ÚNICO)

⚠️ REGRA ESTRUTURAL OBRIGATÓRIA — SEM DUPLICIDADE E SEM NUMERAÇÃO

A IA deve respeitar estrutura fixa e única, SEM repetir blocos e SEM numeração automática.

📐 ESTRUTURA FINAL OBRIGATÓRIA (APENAS 1 VEZ CADA SEÇÃO):

📊 Análise da chance de moderação
Chance estimada: XX%
Classificação: …
[Se teto foi aplicado, explicitar aqui]

🧠 Fundamentação técnica (Manuais RA)
[Objetiva, sem redundância. Uma única vez.]

Ao fundamentar, deixe ainda mais explícito o erro factual. Exemplo de reforço:

"A reclamação apresenta afirmação objetiva de retenção ilegal da chave Pix, quando, conforme registros e resposta pública, a chave foi desvinculada a pedido do próprio consumidor, inexistindo bloqueio coercitivo ou impedimento de portabilidade."

Isso ajuda o analista do RA a bater o martelo.

⚠️ Riscos de negativa
[Curto e direto. Uma única vez.]

Explique claramente:

por que o RA pode negar

qual leitura mais provável do analista:

dúvida legítima?

inconformismo?

exercício regular do direito de reclamar?

⚠️ IMPORTANTE: Especialmente se o analista não identificar claramente a omissão do pedido de retirada da chave Pix (ou outro fato essencial omitido) no texto do consumidor.

🎯 Tese principal de moderação
[Uma única vez]

🧩 Teses complementares
[Uma única vez]
(ex: empresa não violou direito do consumidor)

✍️ Revisão de Textos (versão estratégica)
[Resposta pública revisada - uma única vez]

OU (se não houver revisão real validada):

✍️ Revisão de Textos
Resposta Mantida – sem alteração estratégica
[A resposta pública foi mantida sem alteração estratégica, pois não foram identificadas mudanças de enquadramento relevantes para moderação.]

📈 Impacto da revisão de texto
[APENAS 1 comparação antes/depois - uma única vez. Só exibir se houver revisão real validada.]

Se houver revisão real validada:
Antes da revisão: XX%
Após a revisão: YY%
Variação estimada: +Z% (ou -Z% se piorou)

🧠 Justificativa técnica do impacto
[Uma única explicação objetiva e curta]

Se NÃO houver revisão real:
Não houve alteração estratégica no texto; a chance de moderação permanece inalterada.

🔍 Auditoria de Consistência da Resposta
[1 linha conclusiva - sem repetir justificativas]

🚫 É PROIBIDO:

- Repetir qualquer um dos blocos acima
- Repetir "Impacto da revisão" mais de uma vez
- Repetir "Justificativa técnica" após a auditoria
- Duplicar conclusões
- Criar blocos redundantes
- Inserir numeração automática (1, 2, 3, 4...) fora de listas explícitas
- Numerar blocos de análise
- Inserir números isolados entre seções

⚠️ REGRA CRÍTICA DE NUMERAÇÃO:

❌ NUNCA inserir numeração automática (1, 2, 3, 4…) fora de listas explícitas
❌ NUNCA numerar blocos de análise
❌ NUNCA inserir números isolados entre seções

✅ A análise deve ser estruturada EXCLUSIVAMENTE por títulos e emojis, conforme padrão acima.

👉 Se algum mecanismo interno gerar índices numéricos, eles devem ser suprimidos antes do output final.

📈 IMPACTO DA REVISÃO DE TEXTO (ANÁLISE OBRIGATÓRIA)

⚠️ VALIDAÇÃO PRÉVIA OBRIGATÓRIA:

Antes de calcular o impacto, você DEVE validar se houve revisão REAL (não cosmética):

- Se houver revisão real validada → calcular e exibir o impacto
- Se houver apenas ajuste cosmético → NÃO exibir o bloco de impacto OU indicar explicitamente: "Não houve alteração estratégica no texto; a chance de moderação permanece inalterada."

⚠️ REGRA CRÍTICA: NÃO use numeração (1, 2, 3, 1️⃣, 2️⃣, etc.) na saída final. Use apenas títulos com emojis.

Após gerar a "Revisão de Textos (versão estratégica)" OU identificar que não houve revisão real, você DEVE executar esta análise adicional:

Comparar duas versões:
- Resposta pública original (fornecida nos dados do caso)
- Resposta pública gerada (versão estratégica OU resposta mantida)

Avaliar o impacto da reformulação sob a ótica do analista do Reclame Aqui, considerando EXCLUSIVAMENTE:
- clareza factual
- neutralização da acusação central
- evidência de omissão ou inconsistência do consumidor
- redução de ambiguidade
- facilidade de enquadramento nos critérios do Manual de Moderação

⚠️ NÃO avaliar:
- empatia
- cordialidade
- satisfação do cliente

Calcular a chance após a revisão:
- A chance após a revisão NUNCA pode ser inferior à chance base, a menos que a revisão tenha introduzido ambiguidade, linguagem defensiva ou enfraquecido a tese.
- Na maioria dos casos:
  - Revisão neutra → mantém a chance
  - Revisão estratégica → aumenta de 5% a 15%

⚠️ IMPORTANTE: Respeitar os tetos automáticos (70%, 65% ou 75%) mesmo após a revisão.

Se a chance base já estava no teto, a revisão pode melhorar a qualidade da resposta, mas o percentual permanece no teto máximo aplicável.

Gerar explicação obrigatória (estilo humano):
Explique objetivamente:
- Por que a resposta reformulada aumentou, manteve ou reduziu a chance de moderação
- O que ficou mais claro?
- Qual ponto passou a ficar explícito para o analista do RA?
- Qual risco foi reduzido?

🧠 PRINCÍPIO DE DECISÃO (CLONE DO RACIOCÍNIO HUMANO)

Ao calcular o impacto da revisão, sempre se pergunte:

"Com essa versão reformulada, um analista do Reclame Aqui identificaria mais facilmente a omissão ou inconsistência do relato do consumidor?"

Se a resposta for:
- Sim, claramente → aumentar a chance
- Um pouco → pequeno aumento
- Não muda → manter
- Piorou → reduzir

📌 FORMATO DO BLOCO DE IMPACTO (CONSOLIDADO - APENAS 1 VEZ):

⚠️ REGRA OBRIGATÓRIA: O bloco 📈 Impacto da revisão de texto deve aparecer UMA ÚNICA VEZ na análise completa.

📈 Impacto da revisão de texto
Antes da revisão: XX%
Após a revisão: YY%
Variação estimada: +Z% (ou -Z% se piorou)

🧠 Justificativa técnica do impacto
[Explicação objetiva e curta - uma única vez. Responder: o que ficou mais claro? qual ponto passou a ficar explícito? qual risco foi reduzido?]

🚫 É PROIBIDO:
- Apresentar este bloco mais de uma vez
- Reapresentar "Impacto da revisão" após a auditoria
- Duplicar justificativas técnicas em seções diferentes
- Criar textos levemente reescritos do mesmo conteúdo

👉 Se o sistema detectar conteúdo equivalente já exibido, não deve renderizar novamente.

🔍 AUDITORIA DE CONSISTÊNCIA DA RESPOSTA (ETAPA OBRIGATÓRIA)

⚠️ IMPORTANTE: Esta auditoria é INTERNA. O resultado deve aparecer apenas UMA VEZ no formato final, conforme estrutura acima.

⚠️ REGRA CRÍTICA: NÃO use numeração (1, 2, 3, 1️⃣, 2️⃣, etc.) na saída final. Use apenas títulos com emojis.

Após gerar a "Revisão de Textos (versão estratégica)" e calcular o impacto, você DEVE executar esta auditoria:

IDENTIFICAÇÃO DE PROBLEMAS POTENCIAIS

Reler a resposta reformulada com foco exclusivo em:

- coerência com a tese principal de moderação
- risco de interpretação equivocada pelo analista do RA
- termos que possam:
  - sugerir ilegalidade inexistente
  - reforçar narrativa do consumidor
  - gerar ambiguidade desnecessária

⚠️ NÃO avaliar empatia ou tom, apenas impacto na moderação.

🧠 CRITÉRIOS OBRIGATÓRIOS DE DETECÇÃO

Verificar se a resposta contém:

- menção imprecisa (ex: "dívidas" quando o correto é "contrato ativo")
- termos genéricos que enfraquecem a tese
- ausência de reforço de fato essencial
- palavras que podem ser usadas contra a empresa
- inconsistência entre parágrafos

Se nenhum problema for identificado, declarar explicitamente:
"Nenhum ajuste pontual recomendado".

SUGESTÃO DE AJUSTES PONTUAIS

Quando identificar um problema, gerar para CADA problema encontrado:

🔎 Trecho identificado
[Citar exatamente o trecho problemático, sem reescrever o texto inteiro]

🧠 Justificativa técnica
[Explicar por que esse trecho pode reduzir a chance de moderação, sempre com foco no analista do RA]

✍️ Sugestão de ajuste
[Indicar como o trecho pode ser reescrito, mantendo mesma estrutura, mesmo parágrafo, mesma posição, sem acrescentar fatos novos]

📌 FORMATO DE SAÍDA DA AUDITORIA (FORMATO FINAL OBRIGATÓRIO):

⚠️ REGRA CRÍTICA: A auditoria deve ser APENAS 1 linha conclusiva, sem repetir justificativas técnicas já apresentadas.

✅ PADRÃO ÚNICO PERMITIDO:

Se houver problemas identificados:

🔍 Auditoria de Consistência da Resposta

🔎 Problema identificado:
Trecho: "[trecho exato]"
Ajuste sugerido: [sugestão pontual]

[Repetir apenas se houver mais de um problema, sempre no mesmo formato enxuto]

Se NÃO houver problemas:

🔍 Auditoria de Consistência da Resposta
✅ Nenhum ajuste pontual recomendado. A resposta reformulada está consistente com a tese principal de moderação.

🚫 É PROIBIDO NA AUDITORIA:

- Repetir justificativas já ditas em outras seções
- Recalcular impacto (já foi calculado)
- Reexplicar tese (já foi explicada)
- Criar textos longos ou redundantes
- Inserir numeração automática

🧠 REGRA-MÃE (CRÍTICA):

A análise deve parecer finalizada, curada e pronta para decisão,
não um rascunho técnico nem um log de processamento interno.

Se houver dúvida entre exibir mais informação ou preservar clareza,
👉 o sistema deve priorizar clareza.

🧠 PRINCÍPIO DE RACIOCÍNIO (CLONE DO SEU JEITO)

Sempre operar com a lógica:

"Esse ajuste ajuda o analista do Reclame Aqui a identificar mais rápido a inconsistência ou omissão do relato do consumidor?"

Se sim → sugerir
Se não → não sugerir

🧠 PRINCÍPIO FINAL (CLONE DE RACIOCÍNIO)

Você deve sempre pensar assim:

"Se eu fosse o analista do Reclame Aqui,
lendo isso às 18h,
com 50 casos na fila,
isso me convenceria a moderar?"

Se a resposta for "talvez", sua chance é média.
Se for "difícil", chance baixa.
Se for "sim, isso está errado", chance alta

🧭 FECHAMENTO (DO JEITO QUE VOCÊ GOSTA)

A interface não deve:
❌ subestimar o caso
❌ usar tese errada como principal
❌ calcular chance com mentalidade conservadora
❌ ignorar omissão de fato essencial

Com esse prompt, ela passa a:
✔ pensar como analista RA experiente
✔ diferenciar omissão × interpretação
✔ subir a taxa de acerto real

---

📥 DADOS DO CASO:

RECLAMAÇÃO COMPLETA DO CONSUMIDOR:
${reclamacaoCompleta}

RESPOSTA PÚBLICA DA EMPRESA:
${respostaPublica}

${consideracaoFinal ? `CONSIDERAÇÃO FINAL DO CONSUMIDOR:\n${consideracaoFinal}\n` : ''}
${historicoModeracao ? `HISTÓRICO DE TENTATIVAS DE MODERAÇÃO:\n${historicoModeracao}\n` : ''}

---

Agora, execute TODAS as etapas da metodologia e entregue a análise completa no formato especificado.`;

        console.log('📝 Enviando solicitação para OpenAI...');
        
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada'
            });
        }
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é uma IA Analista Estratégica de Moderação do Reclame Aqui, treinada para replicar o raciocínio humano especializado utilizado pela Velotax em decisões reais de moderação. Você atua como um analista humano sênior, responsável por orientar decisões sensíveis que impactam reputação, score e visibilidade da empresa. Sempre siga exatamente o formato de saída solicitado e execute todas as etapas da metodologia.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            return res.status(errorResponse.statusCode).json(errorResponse);
        }

        const data = await response.json();
        let resultado = data.choices[0].message.content;
        console.log('✅ Análise de chance de moderação gerada com sucesso');

        // Extrair e formatar a resposta revisada
        const respostaRevisada = extrairRespostaRevisadaDoResultado(resultado);
        if (respostaRevisada && respostaRevisada.trim().length > 0) {
            // Extrair nome do cliente da reclamação
            const nomeCliente = extrairNomeCliente(reclamacaoCompleta);
            
            // Tentar obter nome do agente do userData se disponível, senão usar padrão
            let nomeAgente = 'Agente';
            if (req.user && req.user.nome) {
                nomeAgente = obterPrimeiroNomeUsuario(req.user);
            }
            
            // Aplicar formatação da resposta RA
            const respostaFormatada = formatarRespostaRA(respostaRevisada, nomeCliente, nomeAgente);
            
            // Substituir a resposta revisada no resultado pela versão formatada
            const marcadores = [
                '✍️ Revisão de Textos (versão estratégica)',
                'Revisão de Textos (versão estratégica)',
                'REVISÃO DE TEXTOS'
            ];
            
            for (const marcador of marcadores) {
                const index = resultado.indexOf(marcador);
                if (index !== -1) {
                    // Encontrar onde começa o conteúdo após o marcador
                    let inicioConteudo = index + marcador.length;
                    // Pular quebras de linha e espaços
                    while (inicioConteudo < resultado.length && 
                           (resultado[inicioConteudo] === '\n' || resultado[inicioConteudo] === ' ' || resultado[inicioConteudo] === '\r')) {
                        inicioConteudo++;
                    }
                    
                    // Encontrar onde termina o conteúdo (próximo marcador ou fim)
                    let fimConteudo = resultado.length;
                    const proximosMarcadores = ['🧠', '📊', '⚠️', '🎯', '🧩', '🔍', '📈'];
                    for (const proxMarcador of proximosMarcadores) {
                        const proxIndex = resultado.indexOf(proxMarcador, inicioConteudo);
                        if (proxIndex !== -1 && proxIndex < fimConteudo) {
                            fimConteudo = proxIndex;
                        }
                    }
                    
                    // Substituir o conteúdo
                    const antes = resultado.substring(0, inicioConteudo);
                    const depois = resultado.substring(fimConteudo);
                    resultado = antes + '\n\n' + respostaFormatada + '\n\n' + depois;
                    break;
                }
            }
        }

        // Incrementar estatística global
        await incrementarEstatisticaGlobal('revisoes_texto');

        res.json({
            success: true,
            result: resultado
        });

    } catch (error) {
        console.error('❌ Erro na análise de chance de moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor na análise de chance de moderação'
        });
    }
});

// Endpoint para aplicar ajuste pontual na resposta
app.post('/api/aplicar-ajuste', async (req, res) => {
    console.log('🎯 Endpoint /api/aplicar-ajuste chamado');
    try {
        const { respostaOriginal, trechoOriginal, sugestaoAjuste } = req.body;
        
        if (!respostaOriginal || !trechoOriginal || !sugestaoAjuste) {
            return res.status(400).json({
                success: false,
                error: 'Resposta original, trecho original e sugestão de ajuste são obrigatórios'
            });
        }
        
        // Aplicar o ajuste: substituir apenas o trecho específico
        let respostaAjustada = respostaOriginal;
        
        // Verificar se o trecho existe na resposta
        if (!respostaAjustada.includes(trechoOriginal)) {
            // Tentar encontrar variações (case insensitive, espaços)
            const trechoRegex = new RegExp(trechoOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            if (trechoRegex.test(respostaAjustada)) {
                respostaAjustada = respostaAjustada.replace(trechoRegex, sugestaoAjuste);
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Trecho original não encontrado na resposta'
                });
            }
        } else {
            // Substituição exata
            respostaAjustada = respostaAjustada.replace(trechoOriginal, sugestaoAjuste);
        }
        
        // Calcular impacto do ajuste (análise simples)
        const promptImpacto = `Analise o impacto deste ajuste pontual na chance de moderação do Reclame Aqui.

Trecho original: "${trechoOriginal}"
Trecho ajustado: "${sugestaoAjuste}"

Calcule apenas:
- Chance antes do ajuste (assumindo que a resposta original tinha chance de 70%)
- Chance após o ajuste
- Variação estimada

Responda APENAS no formato:
Chance antes: XX%
Chance após: YY%
Variação: +Z% ou -Z%`;

        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada'
            });
        }
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um analista especializado em moderação do Reclame Aqui. Analise ajustes pontuais em respostas e calcule o impacto na chance de moderação.'
                    },
                    {
                        role: 'user',
                        content: promptImpacto
                    }
                ],
                temperature: 0.2,
                max_tokens: 200
            })
        });

        let impactoAjuste = null;
        if (response.ok) {
            const data = await response.json();
            const resultado = data.choices[0].message.content;
            
            // Extrair valores
            const matchAntes = resultado.match(/Chance antes:\s*(\d+)%/i);
            const matchDepois = resultado.match(/Chance após:\s*(\d+)%/i);
            const matchVariacao = resultado.match(/Variação:\s*([+-]\d+%)/i);
            
            impactoAjuste = {
                antes: matchAntes ? matchAntes[1] : '70',
                depois: matchDepois ? matchDepois[1] : '72',
                variacao: matchVariacao ? matchVariacao[1] : '+2%'
            };
        }
        
        console.log('✅ Ajuste aplicado com sucesso');
        
        res.json({
            success: true,
            respostaAjustada: respostaAjustada,
            impactoAjuste: impactoAjuste
        });

    } catch (error) {
        console.error('❌ Erro ao aplicar ajuste:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor ao aplicar ajuste'
        });
    }
});

// Endpoint para ajuste manual pontual da resposta
app.post('/api/ajuste-manual', async (req, res) => {
    console.log('🎯 Endpoint /api/ajuste-manual chamado');
    try {
        const { respostaAtual, instrucaoAjuste } = req.body;
        
        if (!respostaAtual || !instrucaoAjuste) {
            return res.status(400).json({
                success: false,
                error: 'Resposta atual e instrução de ajuste são obrigatórias'
            });
        }
        
        // Prompt para ajuste cirúrgico (sem análise adicional)
        const prompt = `Você é um editor de texto. Execute APENAS o ajuste solicitado, sem análise adicional.

RESPOSTA ATUAL:
${respostaAtual}

INSTRUÇÃO DE AJUSTE:
${instrucaoAjuste}

REGRAS OBRIGATÓRIAS:
1. Alterar SOMENTE o trecho indicado na instrução
2. NÃO reescrever o texto inteiro
3. NÃO mudar estrutura, tom ou ordem dos parágrafos
4. NÃO acrescentar novos argumentos
5. NÃO remover informações que não foram citadas
6. NÃO recalcular chance de moderação
7. NÃO sugerir melhorias adicionais

Você deve agir como um editor cirúrgico, não como redator.

Retorne APENAS a resposta ajustada, sem comentários ou explicações adicionais.`;

        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada'
            });
        }
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um editor de texto que executa ajustes pontuais conforme instruções específicas. Você NÃO analisa, NÃO sugere melhorias, NÃO reescreve o texto inteiro. Você apenas aplica o ajuste solicitado de forma cirúrgica.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1, // Baixa temperatura para precisão
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            const errorResponse = tratarErroOpenAI(response, errorData);
            return res.status(errorResponse.statusCode).json(errorResponse);
        }

        const data = await response.json();
        const respostaAjustada = data.choices[0].message.content.trim();
        
        console.log('✅ Ajuste manual aplicado com sucesso');
        
        res.json({
            success: true,
            respostaAjustada: respostaAjustada
        });

    } catch (error) {
        console.error('❌ Erro ao aplicar ajuste manual:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor ao aplicar ajuste manual'
        });
    }
});

// Endpoint para buscar estatísticas globais
// ===== ENDPOINTS DE AUTENTICAÇÃO =====

// Endpoint para obter configurações do Google OAuth
app.get('/api/google-config', (req, res) => {
    console.log('🎯 Endpoint /api/google-config chamado');
    try {
        // Carregar configurações do arquivo .env
        const envVars = loadEnvFile();
        const clientId = envVars.GOOGLE_CLIENT_ID || null;
        const dominioPermitido = envVars.DOMINIO_PERMITIDO || '@velotax.com.br';
        
        console.log('🔧 GOOGLE_CLIENT_ID carregado:', clientId);
        console.log('🔧 DOMINIO_PERMITIDO:', dominioPermitido);
        console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
        console.log('🔧 VERCEL:', process.env.VERCEL);
        console.log('🔧 Todas as variáveis de ambiente:', Object.keys(process.env).filter(k => k.includes('GOOGLE') || k.includes('DOMINIO')));
        
        // Verificar se o CLIENT_ID está no formato correto
        if (clientId && !clientId.includes('.apps.googleusercontent.com')) {
            console.warn('⚠️ CLIENT_ID pode estar incompleto:', clientId);
        }
        
        res.json({
            success: true,
            clientId: clientId,
            dominioPermitido: dominioPermitido,
            debug: {
                nodeEnv: process.env.NODE_ENV,
                vercel: process.env.VERCEL,
                clientIdFormat: clientId.includes('.apps.googleusercontent.com') ? 'correto' : 'incompleto'
            }
        });
    } catch (error) {
        console.error('Erro ao obter configurações do Google:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para obter perfil do usuário
app.get('/api/getUserProfile', (req, res) => {
    console.log('🎯 Endpoint /api/getUserProfile chamado');
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email não fornecido'
            });
        }
        
        // Por enquanto, retornar perfil padrão
        // Em produção, você pode integrar com um banco de dados ou planilha
        const userProfile = {
            funcao: 'Usuário',
            departamento: 'Geral',
            permissoes: ['visualizar', 'gerar_respostas']
        };
        
        console.log('📋 Perfil do usuário retornado:', userProfile);
        
        res.json({
            success: true,
            profile: userProfile
        });
        
    } catch (error) {
        console.error('Erro ao buscar perfil do usuário:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para registrar logs de acesso
app.post('/api/logAccess', async (req, res) => {
    console.log('🎯 Endpoint /api/logAccess chamado');
    try {
        const { email, nome, status, timestamp } = req.body;
        
        if (!email || !status) {
            return res.status(400).json({
                success: false,
                error: 'Dados obrigatórios não fornecidos'
            });
        }
        
        // Log do acesso
        console.log(`📝 Log de acesso: ${email} (${nome}) - ${status} - ${new Date(timestamp).toLocaleString('pt-BR')}`);
        
        // FORÇAR INICIALIZAÇÃO DO GOOGLE SHEETS SE NÃO ESTIVER ATIVO
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            console.log('🔄 Google Sheets inativo - tentando inicializar automaticamente para log de acesso...');
            try {
                const envVars = loadEnvFile();
                envVars.ENABLE_GOOGLE_SHEETS = 'true'; // Forçar ativação
                const success = await googleSheetsIntegration.initialize(envVars);
                if (success) {
                    global.googleSheetsInitialized = true;
                    console.log('✅ Google Sheets inicializado automaticamente para log de acesso!');
                } else {
                    console.log('❌ Falha ao inicializar Google Sheets automaticamente para log de acesso');
                }
            } catch (error) {
                console.log('❌ Erro ao inicializar Google Sheets para log de acesso:', error.message);
            }
        }
        
        // Registrar acesso no Google Sheets
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                const acessoData = {
                    userProfile: `${nome} (${email})`,
                    userName: nome,
                    userEmail: email,
                    usuario: email,
                    acao: status === 'online' ? 'Login' : 'Logout',
                    ip: req.ip || req.connection.remoteAddress || 'N/A',
                    userAgent: req.get('User-Agent') || 'N/A',
                    duracaoSessao: 0,
                    status: 'Sucesso'
                };
                
                await googleSheetsIntegration.registrarAcessoInterface(acessoData);
                console.log('📋 Acesso salvo DIRETAMENTE no Google Sheets');
                console.log('✅ Acesso registrado no Google Sheets');
            } catch (error) {
                console.error('❌ Erro ao registrar acesso no Google Sheets:', error.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Log de acesso registrado'
        });
        
    } catch (error) {
        console.error('Erro ao registrar log de acesso:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para validar token do Google (opcional - para validação no backend)
app.post('/api/validateGoogleToken', async (req, res) => {
    console.log('🎯 Endpoint /api/validateGoogleToken chamado');
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token não fornecido'
            });
        }
        
        // Em produção, você pode usar a biblioteca google-auth-library
        // para validar o token no backend
        // const { OAuth2Client } = require('google-auth-library');
        // const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        // const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        // const payload = ticket.getPayload();
        
        // Por enquanto, retornar sucesso (validação feita no frontend)
        res.json({
            success: true,
            message: 'Token validado com sucesso'
        });
        
    } catch (error) {
        console.error('Erro ao validar token:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// ===== ENDPOINTS DE ESTATÍSTICAS GLOBAIS =====

// Endpoint para buscar estatísticas do dia atual da planilha
app.get('/api/estatisticas-hoje', async (req, res) => {
    console.log('🎯 Endpoint /api/estatisticas-hoje chamado');
    try {
        // Obter data de hoje no fuso horário de São Paulo
        const hoje = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
        const dia = String(hoje.getDate()).padStart(2, '0');
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const ano = hoje.getFullYear();
        const dataHojeBR = `${dia}/${mes}/${ano}`; // DD/MM/YYYY
        const dataHojeISO = `${ano}-${mes}-${dia}`; // YYYY-MM-DD
        
        console.log(`📅 Data de hoje: ${dataHojeBR} (${dataHojeISO})`);
        
        let respostasHoje = 0;
        let moderacoesHoje = 0;
        
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('⚠️ Google Sheets não está inicializado');
            return res.json({
                success: true,
                data: dataHojeBR,
                respostas_geradas: 0,
                moderacoes_geradas: 0
            });
        }
        
        try {
            // ===== BUSCAR RESPOSTAS COERENTES =====
            // Página: "Respostas Coerentes", Coluna A = Data/Hora
            const rangeRespostas = 'Respostas Coerentes!A1:Z1000';
            const dataRespostas = await googleSheetsConfig.readData(rangeRespostas);
            
            console.log(`📋 Respostas Coerentes - Total linhas recebidas: ${dataRespostas ? dataRespostas.length : 0}`);
            
            if (dataRespostas && dataRespostas.length > 1) {
                const headersRespostas = dataRespostas[0];
                console.log('📋 Cabeçalhos Respostas:', headersRespostas);
                
                // Encontrar índice da coluna "Status Aprovação" ou "Status"
                const statusIndex = headersRespostas.findIndex(h => 
                    h === 'Status Aprovação' || 
                    h === 'Status' || 
                    h === 'Status Aprovacao' ||
                    h.toLowerCase().includes('status')
                );
                
                console.log(`📋 Índice da coluna Status: ${statusIndex}`);
                
                let contador = 0;
                respostasHoje = dataRespostas.slice(1).filter((row, index) => {
                    // Coluna A (índice 0) = Data/Hora
                    const dataResposta = row[0];
                    if (!dataResposta) {
                        console.log(`⚠️ Linha ${index + 2}: sem data`);
                        return false;
                    }
                    
                    const dataStr = String(dataResposta).trim();
                    
                    // Verificar se a data é de hoje
                    const isHoje = verificarDataHojeSimples(dataStr, dataHojeBR, dataHojeISO);
                    
                    // Verificar status (se encontrou a coluna)
                    let isAprovada = true; // Se não encontrar coluna, assumir aprovada
                    if (statusIndex >= 0) {
                        const status = String(row[statusIndex] || '').trim();
                        isAprovada = status === 'Aprovada' || status === '';
                        console.log(`📋 Linha ${index + 2}: Data=${dataStr}, Status=${status}, isHoje=${isHoje}, isAprovada=${isAprovada}`);
                    } else {
                        console.log(`📋 Linha ${index + 2}: Data=${dataStr}, Status=N/A (coluna não encontrada), isHoje=${isHoje}, isAprovada=${isAprovada}`);
                    }
                    
                    if (isHoje && isAprovada) {
                        contador++;
                        console.log(`✅ Resposta ${contador} encontrada (linha ${index + 2}): Data=${dataStr}`);
                    }
                    
                    return isHoje && isAprovada;
                }).length;
                
                console.log(`📊 Respostas do dia ${dataHojeBR}: ${respostasHoje}`);
            } else {
                console.log('⚠️ Nenhuma linha encontrada na planilha Respostas Coerentes');
            }
            
            // ===== BUSCAR MODERAÇÕES =====
            // Página: "Moderações", Coluna A = Data/Hora
            const rangeModeracoes = 'Moderações!A1:Z1000';
            const dataModeracoes = await googleSheetsConfig.readData(rangeModeracoes);
            
            console.log(`📋 Moderações - Total linhas recebidas: ${dataModeracoes ? dataModeracoes.length : 0}`);
            
            if (dataModeracoes && dataModeracoes.length > 1) {
                const headersModeracoes = dataModeracoes[0];
                console.log('📋 Cabeçalhos Moderações:', headersModeracoes);
                
                // Encontrar índices das colunas
                const statusIndex = headersModeracoes.findIndex(h => 
                    h === 'Status Aprovação' || 
                    h === 'Status' || 
                    h === 'Status Aprovacao' ||
                    h.toLowerCase().includes('status')
                );
                const feedbackIndex = headersModeracoes.findIndex(h => 
                    h === 'Feedback' || 
                    h.toLowerCase().includes('feedback')
                );
                
                console.log(`📋 Índice Status: ${statusIndex}, Índice Feedback: ${feedbackIndex}`);
                
                let contador = 0;
                moderacoesHoje = dataModeracoes.slice(1).filter((row, index) => {
                    // Coluna A (índice 0) = Data/Hora
                    const dataModeracao = row[0];
                    if (!dataModeracao) {
                        console.log(`⚠️ Linha ${index + 2}: sem data`);
                        return false;
                    }
                    
                    const dataStr = String(dataModeracao).trim();
                    
                    // Verificar se a data é de hoje
                    const isHoje = verificarDataHojeSimples(dataStr, dataHojeBR, dataHojeISO);
                    
                    // Verificar status
                    let isAprovada = false;
                    if (statusIndex >= 0) {
                        const status = String(row[statusIndex] || '').trim();
                        isAprovada = status === 'Aprovada';
                    }
                    
                    // Verificar se não tem feedback
                    let semFeedback = true;
                    if (feedbackIndex >= 0) {
                        const feedback = String(row[feedbackIndex] || '').trim();
                        semFeedback = !feedback || feedback === '';
                    }
                    
                    console.log(`📋 Linha ${index + 2}: Data=${dataStr}, Status=${statusIndex >= 0 ? row[statusIndex] : 'N/A'}, Feedback=${feedbackIndex >= 0 ? row[feedbackIndex] : 'N/A'}, isHoje=${isHoje}, isAprovada=${isAprovada}, semFeedback=${semFeedback}`);
                    
                    if (isHoje && isAprovada && semFeedback) {
                        contador++;
                        console.log(`✅ Moderação ${contador} encontrada (linha ${index + 2}): Data=${dataStr}`);
                    }
                    
                    return isHoje && isAprovada && semFeedback;
                }).length;
                
                console.log(`📊 Moderações do dia ${dataHojeBR}: ${moderacoesHoje}`);
            } else {
                console.log('⚠️ Nenhuma linha encontrada na planilha Moderações');
            }
            
            console.log(`📊 RESULTADO FINAL - Data: ${dataHojeBR} (${dataHojeISO}) | Respostas: ${respostasHoje} | Moderações: ${moderacoesHoje}`);
            
        } catch (error) {
            console.error('❌ Erro ao buscar estatísticas da planilha:', error.message);
            console.error('Stack:', error.stack);
        }
        
        res.json({
            success: true,
            data: dataHojeBR,
            respostas_geradas: respostasHoje,
            moderacoes_geradas: moderacoesHoje
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas do dia:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar estatísticas do dia'
        });
    }
});

// Função simplificada para verificar se a data é hoje
function verificarDataHojeSimples(dataStr, dataHojeBR, dataHojeISO) {
    if (!dataStr) return false;
    
    const dataLimpa = String(dataStr).trim();
    
    // Extrair apenas a data (remover hora se houver)
    let dataParte = dataLimpa.split(' ')[0]; // Pega apenas a parte da data
    
    // Formato brasileiro: DD/MM/YYYY
    if (dataParte.includes('/')) {
        const partes = dataParte.split('/');
        if (partes.length === 3) {
            const [dia, mes, ano] = partes;
            const dataFormatada = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
            return dataFormatada === dataHojeISO;
        }
    }
    
    // Formato ISO: YYYY-MM-DD
    if (dataParte.includes('-')) {
        const partes = dataParte.split('-');
        if (partes.length >= 3) {
            const dataFormatada = `${partes[0]}-${partes[1].padStart(2, '0')}-${partes[2].padStart(2, '0')}`;
            return dataFormatada === dataHojeISO;
        }
    }
    
    // Verificar se contém a data de hoje no formato BR
    const [diaHoje, mesHoje, anoHoje] = dataHojeBR.split('/');
    if (dataLimpa.includes(diaHoje) && dataLimpa.includes(mesHoje) && dataLimpa.includes(anoHoje)) {
        return true;
    }
    
    return false;
}


app.get('/api/estatisticas-globais', (req, res) => {
    console.log('🎯 Endpoint /api/estatisticas-globais chamado');
    try {
        const estatisticas = loadEstatisticasGlobais();
        
        res.json({
            success: true,
            estatisticas: estatisticas.estatisticas,
            historico: estatisticas.historico_diario,
            lastUpdated: estatisticas.lastUpdated
        });
        
    } catch (error) {
        console.error('Erro ao buscar estatísticas globais:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para visualização completa de uma moderação (FASE 2 - Auditoria)
app.get('/api/moderacao-detalhes/:id', async (req, res) => {
    console.log('🎯 Endpoint /api/moderacao-detalhes chamado');
    try {
        const { id } = req.params;
        
        if (!id || !id.toString().trim()) {
            return res.status(400).json({
                success: false,
                error: 'ID da moderação é obrigatório'
            });
        }
        
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }
        
        const moderacaoIdTrimmed = id.toString().trim();
        const moderacaoIdNormalized = moderacaoIdTrimmed.replace(/\s+/g, '');
        
        let detalhes = null;
        let tipo = null;
        
        // Buscar em "Moderações Aceitas"
        try {
            const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
            if (aceitasData && aceitasData.length > 1) {
                for (let i = 1; i < aceitasData.length; i++) {
                    const row = aceitasData[i];
                    if (!row || row.length < 2) continue;
                    
                    const rowId = (row[1] || '').toString().trim().replace(/\s+/g, '');
                    if (rowId === moderacaoIdNormalized) {
                        detalhes = {
                            dataRegistro: row[0] || '',
                            idModeracao: row[1] || '',
                            idReclamacao: row[2] || '',
                            tema: row[3] || '',
                            motivoUtilizado: row[4] || '',
                            textoModeracaoEnviada: row[5] || '',
                            resultado: row[6] || 'Aceita',
                            solicitacaoCliente: row[7] || '',
                            respostaEmpresa: row[8] || '',
                            consideracaoFinal: row[9] || '',
                            linhaRaciocinio: row[10] || '',
                            dataHoraModeracaoOriginal: row[11] || '',
                            statusAprovacao: row[12] || '',
                            nomeSolicitante: row[13] || '',
                            observacoesInternas: row[13] || '', // compatibilidade (mesma coluna N: Nome do solicitante)
                            // Campos específicos de negativa (vazios para aceitas)
                            motivoNegativa: '',
                            erroIdentificado: '',
                            orientacaoCorrecao: ''
                        };
                        tipo = 'aceita';
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('⚠️ Erro ao buscar moderação aceita:', error.message);
        }
        
        // Se não encontrou, buscar em "Moderações Negadas"
        if (!detalhes) {
            try {
                const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');
                if (negadasData && negadasData.length > 1) {
                    for (let i = 1; i < negadasData.length; i++) {
                        const row = negadasData[i];
                        if (!row || row.length < 2) continue;
                        
                        const rowId = (row[1] || '').toString().trim().replace(/\s+/g, '');
                        if (rowId === moderacaoIdNormalized) {
                            detalhes = {
                                dataRegistro: row[0] || '',
                                idModeracao: row[1] || '',
                                idReclamacao: row[2] || '',
                                tema: row[3] || '',
                                motivoUtilizado: row[4] || '',
                                textoModeracaoEnviada: row[5] || '',
                                resultado: row[6] || 'Negada',
                                motivoNegativa: row[7] || '', // Bloco 1
                                erroIdentificado: row[8] || '', // Bloco 2
                                orientacaoCorrecao: row[9] || '', // Bloco 3
                                solicitacaoCliente: row[10] || '',
                                respostaEmpresa: row[11] || '',
                                consideracaoFinal: row[12] || '',
                                linhaRaciocinio: row[13] || '',
                                dataHoraModeracaoOriginal: row[14] || ''
                            };
                            tipo = 'negada';
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error('⚠️ Erro ao buscar moderação negada:', error.message);
            }
        }
        
        if (!detalhes) {
            return res.status(404).json({
                success: false,
                error: `Moderação com ID "${moderacaoIdTrimmed}" não encontrada`
            });
        }
        
        res.json({
            success: true,
            tipo: tipo,
            detalhes: detalhes
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar detalhes da moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para estatísticas de moderações (FASE 2 - Controle Quantitativo)
app.get('/api/estatisticas-moderacoes', async (req, res) => {
    console.log('🎯 Endpoint /api/estatisticas-moderacoes chamado');
    try {
        const { tema, dataInicio, dataFim, motivo } = req.query;
        
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.json({
                success: true,
                totalAnalisadas: 0,
                totalAceitas: 0,
                totalNegadas: 0,
                taxaAceite: 0,
                porTema: {},
                porPeriodo: {},
                porMotivo: {}
            });
        }
        
        // Buscar moderações aceitas
        let aceitasData = [];
        try {
            const data = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
            if (data && data.length > 1) {
                aceitasData = data.slice(1); // Remover cabeçalho
            }
        } catch (error) {
            console.error('⚠️ Erro ao buscar moderações aceitas:', error.message);
        }
        
        // Buscar moderações negadas
        let negadasData = [];
        try {
            const data = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');
            if (data && data.length > 1) {
                negadasData = data.slice(1); // Remover cabeçalho
            }
        } catch (error) {
            console.error('⚠️ Erro ao buscar moderações negadas:', error.message);
        }
        
        // Processar dados
        const totalAceitas = aceitasData.length;
        const totalNegadas = negadasData.length;
        const totalAnalisadas = totalAceitas + totalNegadas;
        const taxaAceite = totalAnalisadas > 0 ? ((totalAceitas / totalAnalisadas) * 100).toFixed(2) : 0;
        
        // Agrupar por tema
        const porTema = {};
        aceitasData.forEach(row => {
            const temaRow = (row[3] || 'geral').toString().trim();
            if (!porTema[temaRow]) {
                porTema[temaRow] = { aceitas: 0, negadas: 0 };
            }
            porTema[temaRow].aceitas++;
        });
        negadasData.forEach(row => {
            const temaRow = (row[3] || 'geral').toString().trim();
            if (!porTema[temaRow]) {
                porTema[temaRow] = { aceitas: 0, negadas: 0 };
            }
            porTema[temaRow].negadas++;
        });
        
        // Agrupar por período (mês/ano)
        const porPeriodo = {};
        const processarData = (dataStr) => {
            if (!dataStr) return null;
            try {
                const partes = dataStr.split(' ')[0].split('/');
                if (partes.length === 3) {
                    return `${partes[1]}/${partes[2]}`; // MM/YYYY
                }
            } catch (e) {}
            return null;
        };
        
        aceitasData.forEach(row => {
            const periodo = processarData(row[0]) || 'N/A';
            if (!porPeriodo[periodo]) {
                porPeriodo[periodo] = { aceitas: 0, negadas: 0 };
            }
            porPeriodo[periodo].aceitas++;
        });
        negadasData.forEach(row => {
            const periodo = processarData(row[0]) || 'N/A';
            if (!porPeriodo[periodo]) {
                porPeriodo[periodo] = { aceitas: 0, negadas: 0 };
            }
            porPeriodo[periodo].negadas++;
        });
        
        // Agrupar por motivo
        const porMotivo = {};
        aceitasData.forEach(row => {
            const motivoRow = (row[4] || 'N/A').toString().trim();
            if (!porMotivo[motivoRow]) {
                porMotivo[motivoRow] = { aceitas: 0, negadas: 0 };
            }
            porMotivo[motivoRow].aceitas++;
        });
        negadasData.forEach(row => {
            const motivoRow = (row[4] || 'N/A').toString().trim();
            if (!porMotivo[motivoRow]) {
                porMotivo[motivoRow] = { aceitas: 0, negadas: 0 };
            }
            porMotivo[motivoRow].negadas++;
        });
        
        // Aplicar filtros se fornecidos
        let dadosFiltrados = {
            aceitas: aceitasData,
            negadas: negadasData
        };
        
        if (tema || dataInicio || dataFim || motivo) {
            dadosFiltrados.aceitas = aceitasData.filter(row => {
                if (tema && (row[3] || '').toString().toLowerCase() !== tema.toLowerCase()) return false;
                if (motivo && (row[4] || '').toString().toLowerCase() !== motivo.toLowerCase()) return false;
                // Filtro de data pode ser adicionado aqui se necessário
                return true;
            });
            
            dadosFiltrados.negadas = negadasData.filter(row => {
                if (tema && (row[3] || '').toString().toLowerCase() !== tema.toLowerCase()) return false;
                if (motivo && (row[4] || '').toString().toLowerCase() !== motivo.toLowerCase()) return false;
                // Filtro de data pode ser adicionado aqui se necessário
                return true;
            });
        }
        
        res.json({
            success: true,
            totalAnalisadas: totalAnalisadas,
            totalAceitas: totalAceitas,
            totalNegadas: totalNegadas,
            taxaAceite: parseFloat(taxaAceite),
            porTema: porTema,
            porPeriodo: porPeriodo,
            porMotivo: porMotivo,
            filtros: {
                tema: tema || null,
                dataInicio: dataInicio || null,
                dataFim: dataFim || null,
                motivo: motivo || null
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas de moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para verificar status da API do Google Sheets
app.get('/api/google-sheets-status', async (req, res) => {
    console.log('🎯 Endpoint /api/google-sheets-status chamado');
    try {
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.json({
                success: false,
                active: false,
                message: 'Google Sheets não está ativo'
            });
        }

        const apiStatus = await googleSheetsIntegration.checkApiStatus();
        
        res.json({
            success: true,
            active: true,
            apiWorking: apiStatus,
            message: apiStatus ? 'Google Sheets funcionando normalmente' : 'Problemas na API do Google Sheets'
        });
        
    } catch (error) {
        console.error('Erro ao verificar status do Google Sheets:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para verificar quota e status detalhado do Google Sheets
app.get('/api/google-sheets-quota-status', async (req, res) => {
    console.log('🎯 Endpoint /api/google-sheets-quota-status chamado');
    try {
        const envVars = loadEnvFile();
        
        // Verificar configurações
        const configStatus = {
            googleSheetsId: envVars.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            enableGoogleSheets: envVars.ENABLE_GOOGLE_SHEETS,
            serviceAccountEmail: envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            privateKey: envVars.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            projectId: envVars.GOOGLE_PROJECT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
        };
        
        // Verificar status da integração
        const integrationStatus = {
            googleSheetsInitialized: global.googleSheetsInitialized || false,
            googleSheetsIntegrationActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            googleSheetsConfigInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
        };
        
        // Testar conectividade e quota
        let quotaStatus = {
            canConnect: false,
            quotaExceeded: false,
            lastError: null,
            testTimestamp: new Date().toISOString()
        };
        
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                console.log('🔍 Testando conectividade e quota do Google Sheets...');
                const testResult = await googleSheetsIntegration.checkApiStatus();
                quotaStatus.canConnect = testResult;
                
                if (!testResult) {
                    quotaStatus.quotaExceeded = true;
                    quotaStatus.lastError = 'Falha na conectividade - possível quota excedida';
                }
            } catch (error) {
                console.error('❌ Erro ao testar quota:', error.message);
                quotaStatus.lastError = error.message;
                
                // Verificar se é erro de quota
                if (error.message.includes('quota') || 
                    error.message.includes('exceeded') || 
                    error.message.includes('429') ||
                    error.message.includes('rate limit')) {
                    quotaStatus.quotaExceeded = true;
                }
            }
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            config: configStatus,
            integration: integrationStatus,
            quota: quotaStatus,
            recommendations: quotaStatus.quotaExceeded ? [
                'Quota da API do Google Sheets pode ter sido excedida',
                'Aguarde alguns minutos antes de tentar novamente',
                'Considere implementar rate limiting mais agressivo',
                'Verifique o Google Cloud Console para monitorar uso da quota'
            ] : [
                'Google Sheets funcionando normalmente',
                'Continue monitorando o uso da quota'
            ]
        });
        
    } catch (error) {
        console.error('❌ Erro ao verificar quota do Google Sheets:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para verificar status específico das moderações
app.get('/api/debug-moderacoes-status', async (req, res) => {
    console.log('🎯 Endpoint /api/debug-moderacoes-status chamado');
    try {
        // Verificar status do Google Sheets
        const googleSheetsStatus = {
            isActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            isInitialized: global.googleSheetsInitialized || false,
            lastError: null
        };
        
        // Testar conectividade
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                const apiStatus = await googleSheetsIntegration.checkApiStatus();
                googleSheetsStatus.apiWorking = apiStatus;
            } catch (error) {
                googleSheetsStatus.apiWorking = false;
                googleSheetsStatus.lastError = error.message;
            }
        }
        
        // Verificar últimas moderações salvas
        const modelosModeracoes = await loadModelosModeracoes();
        const feedbacksModeracoes = loadFeedbacksModeracoes();
        
        const ultimasModeracoes = {
            modelosAprovados: modelosModeracoes.modelos.slice(-5).map(m => ({
                id: m.id,
                timestamp: m.timestamp,
                motivoModeracao: m.motivoModeracao,
                status: 'Aprovada (Modelo)'
            })),
            feedbacksPendentes: feedbacksModeracoes.moderacoes.slice(-5).map(f => ({
                id: f.id,
                timestamp: f.timestamp,
                motivoNegativa: f.motivoNegativa,
                status: 'Pendente (Feedback)'
            }))
        };
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            googleSheets: googleSheetsStatus,
            ultimasModeracoes: ultimasModeracoes,
            recomendacoes: !googleSheetsStatus.isActive ? [
                'Google Sheets não está ativo - moderações não estão sendo registradas',
                'Verifique as variáveis de ambiente na Vercel',
                'Teste o endpoint /api/google-sheets-quota-status para diagnóstico detalhado'
            ] : !googleSheetsStatus.apiWorking ? [
                'Google Sheets ativo mas API não está funcionando',
                'Possível problema de quota ou conectividade',
                'Aguarde alguns minutos e tente novamente'
            ] : [
                'Google Sheets funcionando normalmente',
                'Moderações marcadas como "Coerente" devem aparecer como "Aprovada"',
                'Se ainda aparecer "Pendente", verifique os logs do servidor'
            ]
        });
        
    } catch (error) {
        console.error('❌ Erro ao verificar status das moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para forçar recuperação de quota do Google Sheets
app.post('/api/force-quota-recovery', async (req, res) => {
    console.log('🎯 Endpoint /api/force-quota-recovery chamado');
    try {
        if (!googleSheetsIntegration) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets Integration não está inicializada'
            });
        }
        
        // Forçar reset da quota recovery
        googleSheetsIntegration.lastQuotaError = null;
        googleSheetsIntegration.minRequestInterval = 2000; // Reset para intervalo normal
        
        console.log('🔄 Forçando reset da recuperação de quota...');
        
        // Testar conectividade imediatamente
        let testResult = false;
        let testError = null;
        
        try {
            testResult = await googleSheetsIntegration.checkApiStatus();
            console.log('✅ Teste de conectividade:', testResult ? 'SUCESSO' : 'FALHA');
        } catch (error) {
            testError = error.message;
            console.error('❌ Erro no teste de conectividade:', error.message);
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            quotaRecovery: {
                lastQuotaError: null,
                minRequestInterval: 2000,
                resetSuccessful: true
            },
            connectivityTest: {
                canConnect: testResult,
                error: testError,
                message: testResult ? 'Google Sheets funcionando normalmente' : 'Ainda há problemas de conectividade'
            },
            recommendations: testResult ? [
                '✅ Quota recuperada com sucesso!',
                'Google Sheets está funcionando normalmente',
                'Pode tentar registrar moderações novamente'
            ] : [
                '⚠️ Quota resetada mas ainda há problemas de conectividade',
                'Aguarde mais alguns minutos',
                'Verifique se não há outros problemas de API'
            ]
        });
        
    } catch (error) {
        console.error('❌ Erro ao forçar recuperação de quota:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para sincronizar estatísticas com Google Sheets
app.post('/api/sync-estatisticas', async (req, res) => {
    console.log('🎯 Endpoint /api/sync-estatisticas chamado');
    try {
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(200).json({
                success: true,
                message: 'Google Sheets não configurado - sincronização ignorada',
                googleSheetsActive: false
            });
        }

        const estatisticas = loadEstatisticasGlobais();
        console.log('📊 Sincronizando estatísticas:', estatisticas.estatisticas);
        
        const success = await googleSheetsIntegration.registrarEstatisticas(estatisticas.estatisticas);
        
        if (success) {
            res.json({
                success: true,
                message: 'Estatísticas sincronizadas com sucesso!',
                estatisticas: estatisticas.estatisticas
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Erro ao sincronizar estatísticas',
                message: 'Falha na sincronização com Google Sheets'
            });
        }
        
    } catch (error) {
        console.error('Erro ao sincronizar estatísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para salvar moderação como modelo (quando clicar em "Coerente")
app.post('/api/save-modelo-moderacao', async (req, res) => {
    console.log('🎯 Endpoint /api/save-modelo-moderacao chamado');
    try {
        const { idReclamacao, dadosModeracao, linhaRaciocinio, textoModeracao } = req.body;
        
        // Validar ID da reclamação
        if (!idReclamacao || !idReclamacao.trim()) {
            return res.status(400).json({
                success: false,
                error: 'ID da Reclamação (Reclame Aqui) é obrigatório'
            });
        }
        
        // Validar se o ID contém apenas números
        if (!/^\d+$/.test(idReclamacao.trim())) {
            return res.status(400).json({
                success: false,
                error: 'ID da Reclamação deve conter apenas números'
            });
        }
        
        if (!dadosModeracao || !linhaRaciocinio || !textoModeracao) {
            return res.status(400).json({
                success: false,
                error: 'Dados de moderação, linha de raciocínio e texto de moderação são obrigatórios'
            });
        }
        
        // Registrar o ID da reclamação para rastreabilidade
        console.log(`📋 ID da Reclamação registrado no modelo: ${idReclamacao}`);
        
        // Salvar como modelo de moderação aprovada
        const modelo = await addModeloModeracao(dadosModeracao, linhaRaciocinio, textoModeracao);
        
        // Registrar no Google Sheets (SEMPRE TENTAR - auto-inicialização dentro da função)
        if (googleSheetsIntegration) {
            console.log('📋 Tentando registrar moderação coerente no Google Sheets...');
            const moderacaoData = {
                id: modelo.id,
                idReclamacao: idReclamacao, // ID da Reclamação para rastreabilidade (coluna M da planilha)
                tipo: 'moderacao',
                dadosModeracao: dadosModeracao,
                linhaRaciocinio: linhaRaciocinio,
                textoModeracao: textoModeracao,
                textoFinal: textoModeracao,
                userProfile: req.userData ? `${req.userData.nome} (${req.userData.email})` : 'N/A',
                userName: req.userData?.nome || 'N/A',
                userEmail: req.userData?.email || 'N/A'
            };
            
            console.log('📋 Dados da moderação para Google Sheets:', {
                id: moderacaoData.id,
                tipo: moderacaoData.tipo,
                userProfile: moderacaoData.userProfile,
                googleSheetsAtivo: googleSheetsIntegration.isActive()
            });
            
            // SALVAMENTO COM AWAIT PARA GARANTIR REGISTRO
            // A função registrarModeracaoCoerente já tem auto-inicialização
            // Quando marca como coerente, o status deve ser 'Aprovada'
            moderacaoData.statusAprovacao = 'Aprovada';
            try {
                const resultado = await googleSheetsIntegration.registrarModeracaoCoerente(moderacaoData);
                if (resultado) {
                    console.log('✅ Moderação coerente salva no Google Sheets:', modelo.id);
                } else {
                    console.log('⚠️ Falha ao salvar moderação coerente no Google Sheets:', modelo.id);
                }
            } catch (error) {
                console.error('❌ Erro ao salvar moderação coerente:', error.message);
                console.error('Stack:', error.stack);
            }
        } else {
            console.log('⚠️ googleSheetsIntegration não está disponível');
        }
        
        // Incrementar estatística global
        await incrementarEstatisticaGlobal('moderacoes_coerentes');
        
        res.json({
            success: true,
            message: 'Modelo de moderação salvo com sucesso!',
            modelo: {
                id: modelo.id,
                timestamp: modelo.timestamp,
                motivoModeracao: modelo.motivoModeracao
            }
        });
        
    } catch (error) {
        console.error('Erro ao salvar modelo de moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

/**
 * Analisa uma moderação negada e gera os 3 blocos de feedback estruturado
 * @param {Object} dadosModeracao - Dados completos da moderação negada
 * @returns {Promise<Object>} Objeto com os 3 blocos de feedback
 */
async function analisarModeracaoNegada(dadosModeracao) {
    try {
        const envVars = loadEnvFile();
        const openaiApiKey = envVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
        
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY não configurada');
        }

        const { textoModeracao, solicitacaoCliente, respostaEmpresa, consideracaoFinal, motivoModeracao, linhaRaciocinio } = dadosModeracao;

        const prompt = `
📌 ANÁLISE DE MODERAÇÃO NEGADA PELO RECLAME AQUI

Você é um especialista em análise de moderações do Reclame Aqui. Sua tarefa é analisar uma moderação que foi NEGADA e gerar feedback estruturado em 3 blocos obrigatórios.

DADOS DA MODERAÇÃO NEGADA:
- Texto da moderação enviada: ${textoModeracao}
- Solicitação do cliente: ${solicitacaoCliente}
- Resposta da empresa: ${respostaEmpresa}
- Consideração final do consumidor: ${consideracaoFinal || 'N/A'}
- Motivo de moderação utilizado: ${motivoModeracao}
- Linha de raciocínio interna: ${linhaRaciocinio || 'N/A'}

⚙️ ANÁLISE OBRIGATÓRIA (baseada nos manuais do RA):

Consulte os 3 manuais oficiais do Reclame Aqui:
1. Manual Geral de Moderação
2. Manual de Moderação RA Reviews
3. Manual de Moderação – Bancos, Instituições Financeiras e Meios

Verifique especificamente:
- Presença de debate de mérito
- Tentativa de justificar política interna
- Enquadramento incorreto do motivo de moderação
- Linguagem defensiva ou argumentativa
- Falta de foco na inconsistência objetiva do relato
- Uso incorreto de termos ou estruturas

📋 SAÍDA OBRIGATÓRIA - 3 BLOCOS ESTRUTURADOS:

🔴 BLOCO 1 – MOTIVO DA NEGATIVA
Explique de forma objetiva e neutra, baseada nos manuais do RA, por que a moderação foi negada. 
Cite o manual específico e a regra violada quando aplicável.
Formato: Texto objetivo e técnico, sem juízo de valor.

🟡 BLOCO 2 – ONDE A SOLICITAÇÃO ERROU
Identifique claramente os erros técnicos cometidos no texto de moderação.
Seja específico: cite trechos problemáticos, estruturas incorretas, termos inadequados.
Formato: Lista objetiva de erros identificados, reutilizável para aprendizado.

🟢 BLOCO 3 – COMO CORRIGIR
Forneça orientações práticas e específicas para evitar os mesmos erros em futuras moderações.
Baseie-se nos manuais do RA e nas melhores práticas.
Formato: Orientações práticas, acionáveis e alinhadas aos manuais.

⚠️ REGRAS CRÍTICAS:
- Análise sempre técnica e normativa, nunca subjetiva
- Baseada exclusivamente nos manuais do RA
- Objetiva e neutra
- Focada em erros corrigíveis
- Reutilizável para aprendizado

FORMATO DE SAÍDA (JSON):
{
  "bloco1_motivo_negativa": "[texto do bloco 1]",
  "bloco2_onde_errou": "[texto do bloco 2]",
  "bloco3_como_corrigir": "[texto do bloco 3]"
}

Gere APENAS o JSON com os 3 blocos, sem texto adicional.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um especialista em análise de moderações do Reclame Aqui, com conhecimento profundo dos manuais oficiais da plataforma.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Erro na API OpenAI: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content.trim();

        // Tentar extrair JSON da resposta
        let resultado;
        try {
            // Remover markdown code blocks se houver
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                resultado = JSON.parse(jsonMatch[0]);
            } else {
                resultado = JSON.parse(content);
            }
        } catch (parseError) {
            // Se não conseguir parsear como JSON, criar estrutura manual
            console.warn('⚠️ Não foi possível parsear resposta como JSON, criando estrutura manual');
            const linhas = content.split('\n').filter(l => l.trim());
            resultado = {
                bloco1_motivo_negativa: linhas.find(l => l.includes('BLOCO 1') || l.includes('MOTIVO')) || 'Análise em andamento',
                bloco2_onde_errou: linhas.find(l => l.includes('BLOCO 2') || l.includes('ERROU')) || 'Análise em andamento',
                bloco3_como_corrigir: linhas.find(l => l.includes('BLOCO 3') || l.includes('CORRIGIR')) || 'Análise em andamento'
            };
        }

        return {
            bloco1_motivo_negativa: resultado.bloco1_motivo_negativa || 'Análise não disponível',
            bloco2_onde_errou: resultado.bloco2_onde_errou || 'Análise não disponível',
            bloco3_como_corrigir: resultado.bloco3_como_corrigir || 'Análise não disponível'
        };

    } catch (error) {
        console.error('❌ Erro ao analisar moderação negada:', error);
        // Retornar estrutura padrão em caso de erro
        return {
            bloco1_motivo_negativa: `Erro ao gerar análise automática: ${error.message}`,
            bloco2_onde_errou: 'Análise não disponível devido a erro no processamento',
            bloco3_como_corrigir: 'Consulte os manuais do RA para orientações de correção'
        };
    }
}

// Endpoint para registrar resultado da moderação (Aceita ou Negada)
app.post('/api/registrar-resultado-moderacao', async (req, res) => {
    console.log('=== REGISTRAR RESULTADO ===', `ID: ${req.body.moderacaoId}, Resultado: ${req.body.resultado}`);
    try {
        const { moderacaoId, resultado } = req.body;
        
        // Validações
        if (!moderacaoId || !moderacaoId.toString().trim()) {
            return res.status(400).json({
                success: false,
                error: 'ID da moderação é obrigatório'
            });
        }
        
        if (!resultado || (resultado !== 'Aceita' && resultado !== 'Negada')) {
            return res.status(400).json({
                success: false,
                error: 'Resultado deve ser "Aceita" ou "Negada"'
            });
        }
        
        // Verificar se Google Sheets está ativo
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets não está configurado ou ativo'
            });
        }
        
        // Verificar se googleSheetsConfig está inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets API não foi inicializada'
            });
        }
        
        // Ler dados da planilha "Moderações" para buscar os dados completos
        const range = 'Moderações!A1:Z1000';
        console.log(`📖 Lendo dados da página "Moderações": ${range}`);
        const data = await googleSheetsConfig.readData(range);
        
        if (!data || data.length <= 1) {
            return res.status(404).json({
                success: false,
                error: 'Nenhuma moderação encontrada na planilha'
            });
        }
        
        // Encontrar a linha com o ID correspondente (ID está na coluna B - índice 1)
        // Usar função de normalização robusta
        const moderacaoIdNormalized = normalizarId(moderacaoId);
        let moderacaoRow = null;
        
        console.log(`🔍 Procurando ID: "${moderacaoId}" (normalizado: "${moderacaoIdNormalized}") na página "Moderações"`);
        
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length < 2) continue;
            
            const rowIdNormalized = normalizarId(row[1]);
            const idsCoincidem = rowIdNormalized === moderacaoIdNormalized || 
                                 (rowIdNormalized && !isNaN(rowIdNormalized) && !isNaN(moderacaoIdNormalized) && Number(rowIdNormalized) === Number(moderacaoIdNormalized));
            
            if (idsCoincidem) {
                moderacaoRow = row;
                console.log(`✅ ID encontrado na linha ${i + 1} da página "Moderações"`);
                break;
            }
        }
        
        if (!moderacaoRow) {
            return res.status(404).json({
                success: false,
                error: `Moderação com ID "${moderacaoId}" (normalizado: "${moderacaoIdNormalized}") não encontrada na planilha.`
            });
        }
        
        // Extrair dados da moderação
        // Colunas da página "Moderações" (atualizada):
        // A: Data/Hora (0), B: ID (1), C: ID da Reclamação (2), D: Tipo (3), E: Solicitação Cliente (4),
        // F: Resposta Empresa (5), G: Consideração Final (6), H: Motivo Moderação (7),
        // I: Texto Moderação Anterior (8), J: Feedback (9), K: Texto Moderação Reformulado (10),
        // L: Linha Raciocínio (11), M: Status Aprovação (12), N: Nome do solicitante (13),
        // O: Resultado da Moderação (14)
        
        const dataHoraRegistro = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const dataHoraModeracao = moderacaoRow[0] || ''; // Data/Hora da moderação original
        const idReclamacao = (moderacaoRow[2] || '').toString().trim(); // ID da Reclamação (coluna C)
        const solicitacaoCliente = moderacaoRow[4] || '';
        const respostaEmpresa = moderacaoRow[5] || '';
        const motivoModeracao = moderacaoRow[7] || '';
        const textoModeracao = moderacaoRow[10] || '';
        const linhaRaciocinio = moderacaoRow[11] || '';
        const consideracaoFinal = moderacaoRow[6] || '';
        const statusAprovacao = moderacaoRow[12] || '';
        const nomeSolicitante = moderacaoRow[13] || ''; // Coluna N: Nome do solicitante (antes Observações Internas)
        
        // Identificar tema da moderação (pode ser extraído do motivo ou inferido)
        // Por enquanto, usar o motivo como tema, pode ser refinado depois
        const temaModeracao = motivoModeracao || 'geral';
        
        console.log(`📋 ID da Reclamação extraído da planilha: "${idReclamacao}"`);
        
        let bloco1 = '';
        let bloco2 = '';
        let bloco3 = '';
        
        // Se resultado for "Negada", gerar análise automática
        if (resultado === 'Negada') {
            console.log('🔍 Gerando análise automática para moderação negada...');
            try {
                const analise = await analisarModeracaoNegada({
                    textoModeracao,
                    solicitacaoCliente,
                    respostaEmpresa,
                    consideracaoFinal,
                    motivoModeracao,
                    linhaRaciocinio
                });
                
                bloco1 = analise.bloco1_motivo_negativa;
                bloco2 = analise.bloco2_onde_errou;
                bloco3 = analise.bloco3_como_corrigir;
                
                console.log('✅ Análise gerada com sucesso');
            } catch (error) {
                console.error('❌ Erro ao gerar análise:', error);
                bloco1 = 'Erro ao gerar análise automática';
                bloco2 = 'Análise não disponível';
                bloco3 = 'Consulte os manuais do RA para orientações';
            }
        }
        
        // Salvar na página específica conforme o resultado
        if (resultado === 'Aceita') {
            // Salvar apenas na página "Moderações Aceitas"
            // Ordem dos dados conforme cabeçalhos esperados:
            // 1. Data do Registro
            // 2. ID da Moderação
            // 3. ID da Reclamação
            // 4. Tema
            // 5. Motivo Utilizado
            // 6. Texto da Moderação Enviada
            // 7. Resultado
            // 8. Solicitação do Cliente
            // 9. Resposta da Empresa
            // 10. Consideração Final
            // 11. Linha de Raciocínio
            // 12. Data/Hora da Moderação Original
            // 13. Status Aprovação
            // 14. Nome do solicitante (coluna N)
            const novaLinhaAceitas = [
                dataHoraRegistro || '',                // [0] Data do Registro
                moderacaoIdNormalized || '',           // [1] ID da Moderação (já normalizado)
                idReclamacao || '',                    // [2] ID da Reclamação
                temaModeracao || 'geral',              // [3] Tema
                motivoModeracao || '',                 // [4] Motivo Utilizado
                textoModeracao || '',                  // [5] Texto da Moderação Enviada
                resultado || 'Aceita',                // [6] Resultado
                solicitacaoCliente || '',              // [7] Solicitação do Cliente
                respostaEmpresa || '',                 // [8] Resposta da Empresa
                consideracaoFinal || '',               // [9] Consideração Final
                linhaRaciocinio || '',                 // [10] Linha de Raciocínio
                dataHoraModeracao || '',               // [11] Data/Hora da Moderação Original
                statusAprovacao || '',                 // [12] Status Aprovação
                nomeSolicitante || ''                  // [13] Nome do solicitante
            ];
            
            // Validar que temos pelo menos os campos essenciais
            if (!moderacaoIdNormalized) {
                throw new Error('ID da Moderação é obrigatório');
            }
            
            // Garantir que a aba "Moderações Aceitas" existe e tem os cabeçalhos corretos
            console.log(`🔍 Verificando se a aba "Moderações Aceitas" tem cabeçalhos...`);
            try {
                await googleSheetsIntegration.ensureSheetExists('Moderações Aceitas', [
                    'Data do Registro',
                    'ID da Moderação',
                    'ID da Reclamação',
                    'Tema',
                    'Motivo Utilizado',
                    'Texto da Moderação Enviada',
                    'Resultado',
                    'Solicitação do Cliente',
                    'Resposta da Empresa',
                    'Consideração Final',
                    'Linha de Raciocínio',
                    'Data/Hora da Moderação Original',
                    'Status Aprovação',
                    'Nome do solicitante'
                ]);
                console.log(`✅ Cabeçalhos da aba "Moderações Aceitas" verificados/criados`);
            } catch (ensureError) {
                console.error(`⚠️ Erro ao garantir cabeçalhos da aba "Moderações Aceitas":`, ensureError.message);
                // Continuar mesmo assim, pode ser que os cabeçalhos já existam
            }
            
            console.log(`💾 Salvando na página "Moderações Aceitas"`);
            console.log(`📋 Dados a serem salvos (${novaLinhaAceitas.length} colunas):`);
            console.log(`   [0] Data do Registro: ${novaLinhaAceitas[0]}`);
            console.log(`   [1] ID da Moderação: ${novaLinhaAceitas[1]}`);
            console.log(`   [2] ID da Reclamação: ${novaLinhaAceitas[2]}`);
            console.log(`   [3] Tema: ${novaLinhaAceitas[3]}`);
            console.log(`   [4] Motivo Utilizado: ${novaLinhaAceitas[4]}`);
            console.log(`   [5] Texto da Moderação Enviada: ${(novaLinhaAceitas[5] || '').substring(0, 50)}...`);
            console.log(`   [6] Resultado: ${novaLinhaAceitas[6]}`);
            
            try {
                // Usar range que indica claramente onde adicionar (após última linha)
                const resultado = await googleSheetsConfig.appendRow('Moderações Aceitas!A:Z', novaLinhaAceitas);
                console.log(`✅ Moderação aceita salva com sucesso na página "Moderações Aceitas"`);
                console.log(`📊 Resultado do append:`, resultado);
                
                // Verificar se os dados foram salvos corretamente
                if (resultado && resultado.updates && resultado.updates.updatedRows > 0) {
                    console.log(`✅ ${resultado.updates.updatedRows} linha(s) adicionada(s) com sucesso`);
                }
            } catch (error) {
                console.error(`❌ ERRO ao salvar moderação aceita:`, error);
                console.error(`❌ Stack trace:`, error.stack);
                throw new Error(`Erro ao salvar moderação aceita: ${error.message}`);
            }
        } else if (resultado === 'Negada') {
            // Salvar apenas na página "Moderações Negadas"
            const novaLinhaNegadas = [
                dataHoraRegistro,                // Data do Registro
                moderacaoIdNormalized,           // ID da Moderação (já normalizado)
                idReclamacao,                    // ID da Reclamação
                temaModeracao,                   // Tema
                motivoModeracao,                 // Motivo Utilizado
                textoModeracao,                  // Texto da Moderação Enviada
                resultado,                       // Resultado
                bloco1,                          // Motivo da Negativa (Bloco 1)
                bloco2,                          // Erro Identificado (Bloco 2)
                bloco3,                          // Orientação de Correção (Bloco 3)
                solicitacaoCliente,              // Solicitação do Cliente
                respostaEmpresa,                 // Resposta da Empresa
                consideracaoFinal,               // Consideração Final
                linhaRaciocinio,                 // Linha de Raciocínio
                dataHoraModeracao                // Data/Hora da Moderação Original
            ];
            
            try {
                await googleSheetsConfig.appendRow('Moderações Negadas!A1', novaLinhaNegadas);
                console.log(`✅ Moderação negada salva com sucesso na página "Moderações Negadas"`);
            } catch (error) {
                console.error(`❌ ERRO ao salvar moderação negada:`, error);
                console.error(`❌ Stack trace:`, error.stack);
                throw new Error(`Erro ao salvar moderação negada: ${error.message}`);
            }
        }
        
        // Invalidar cache
        if (googleSheetsIntegration && googleSheetsIntegration.invalidateCache) {
            googleSheetsIntegration.invalidateCache(['moderacoes_coerentes']);
        }
        
        console.log('=== SUCESSO ===', `ID: ${moderacaoId}, Resultado: ${resultado}`);
        
        res.json({
            success: true,
            message: `Resultado da moderação registrado: ${resultado}`,
            moderacaoId: moderacaoId,
            resultado: resultado,
            analise: resultado === 'Negada' ? {
                bloco1,
                bloco2,
                bloco3
            } : null
        });
        
    } catch (error) {
        console.error('❌ Erro ao registrar resultado da moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para limpar resultado da moderação (remove a linha mais recente das páginas "Moderações Aceitas" ou "Moderações Negadas")
app.post('/api/limpar-resultado-moderacao', async (req, res) => {
    console.log('🎯 Endpoint /api/limpar-resultado-moderacao chamado');
    try {
        const { moderacaoId } = req.body;
        
        // Validações
        if (!moderacaoId || !moderacaoId.toString().trim()) {
            return res.status(400).json({
                success: false,
                error: 'ID da moderação é obrigatório'
            });
        }
        
        // Verificar se Google Sheets está ativo
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets não está configurado ou ativo'
            });
        }
        
        // Verificar se googleSheetsConfig está inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets API não foi inicializada'
            });
        }
        
        const moderacaoIdTrimmed = moderacaoId.toString().trim();
        const moderacaoIdNormalized = moderacaoIdTrimmed.replace(/\s+/g, '');
        let linhaMaisRecente = -1;
        let dataMaisRecente = null;
        let paginaEncontrada = null;
        
        // Buscar nas páginas "Moderações Aceitas" e "Moderações Negadas"
        // Primeiro, tentar "Moderações Aceitas"
        try {
            const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
            if (aceitasData && aceitasData.length > 1) {
                for (let i = 1; i < aceitasData.length; i++) {
                    const row = aceitasData[i];
                    if (!row || row.length < 2) continue;
                    
                    const idModeracao = row[1] ? row[1].toString().trim().replace(/\s+/g, '') : '';
                    const dataRegistro = row[0] ? row[0].toString().trim() : '';
                    
                    if (idModeracao === moderacaoIdNormalized) {
                        if (dataMaisRecente === null) {
                            linhaMaisRecente = i + 1;
                            dataMaisRecente = dataRegistro;
                            paginaEncontrada = 'Moderações Aceitas';
                        } else {
                            try {
                                const dataAtual = new Date(dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                const dataExistente = new Date(dataMaisRecente.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                if (dataAtual > dataExistente) {
                                    linhaMaisRecente = i + 1;
                                    dataMaisRecente = dataRegistro;
                                    paginaEncontrada = 'Moderações Aceitas';
                                }
                            } catch (e) {
                                // Se não conseguir comparar, manter o existente
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.log('⚠️ Erro ao buscar moderações aceitas:', error.message);
        }
        
        // Depois, tentar "Moderações Negadas"
        try {
            const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');
            if (negadasData && negadasData.length > 1) {
                for (let i = 1; i < negadasData.length; i++) {
                    const row = negadasData[i];
                    if (!row || row.length < 2) continue;
                    
                    const idModeracao = row[1] ? row[1].toString().trim().replace(/\s+/g, '') : '';
                    const dataRegistro = row[0] ? row[0].toString().trim() : '';
                    
                    if (idModeracao === moderacaoIdNormalized) {
                        if (dataMaisRecente === null) {
                            linhaMaisRecente = i + 1;
                            dataMaisRecente = dataRegistro;
                            paginaEncontrada = 'Moderações Negadas';
                        } else {
                            try {
                                const dataAtual = new Date(dataRegistro.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                const dataExistente = new Date(dataMaisRecente.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
                                if (dataAtual > dataExistente) {
                                    linhaMaisRecente = i + 1;
                                    dataMaisRecente = dataRegistro;
                                    paginaEncontrada = 'Moderações Negadas';
                                }
                            } catch (e) {
                                // Se não conseguir comparar, manter o existente
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.log('⚠️ Erro ao buscar moderações negadas:', error.message);
        }
        
        if (linhaMaisRecente === -1 || !paginaEncontrada) {
            return res.status(404).json({
                success: false,
                error: `Nenhum resultado encontrado para a moderação com ID "${moderacaoIdTrimmed}"`
            });
        }
        
        // Deletar a linha mais recente
        console.log(`🗑️ Deletando linha ${linhaMaisRecente} da página "${paginaEncontrada}"`);
        await googleSheetsConfig.deleteRow(paginaEncontrada, linhaMaisRecente);
        console.log(`✅ Resultado removido com sucesso`);
        
        // Invalidar cache
        if (googleSheetsIntegration && googleSheetsIntegration.invalidateCache) {
            googleSheetsIntegration.invalidateCache(['moderacoes_coerentes']);
        }
        
        res.json({
            success: true,
            message: 'Resultado da moderação removido com sucesso',
            moderacaoId: moderacaoId,
            linhaRemovida: linhaMaisRecente,
            pagina: paginaEncontrada
        });
        
    } catch (error) {
        console.error('❌ Erro ao limpar resultado da moderação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Função para detectar produtos mencionados e retornar conhecimento completo
function obterConhecimentoProdutos(dadosFormulario) {
    let conhecimentoProdutos = '';
    
    if (!dadosFormulario) {
        return conhecimentoProdutos;
    }
    
    // Texto completo para análise (juntar todos os campos relevantes)
    const textoCompleto = [
        dadosFormulario.texto_cliente || '',
        dadosFormulario.solucao_implementada || '',
        dadosFormulario.historico_atendimento || '',
        dadosFormulario.nome_solicitante || dadosFormulario.observacoes_internas || '',
        dadosFormulario.tipo_solicitacao || '',
        dadosFormulario.motivo_solicitacao || ''
    ].join(' ').toLowerCase();
    
    // Detectar menções aos produtos
    const mencionaCreditoTrabalhador = 
        textoCompleto.includes('crédito do trabalhador') ||
        textoCompleto.includes('credito do trabalhador') ||
        textoCompleto.includes('crédito trabalhador') ||
        textoCompleto.includes('credito trabalhador') ||
        textoCompleto.includes('consignado') ||
        textoCompleto.includes('empréstimo consignado') ||
        textoCompleto.includes('emprestimo consignado') ||
        textoCompleto.includes('desconto em folha') ||
        textoCompleto.includes('desconto na folha');
    
    const mencionaCreditoPessoal = 
        textoCompleto.includes('crédito pessoal') ||
        textoCompleto.includes('credito pessoal') ||
        textoCompleto.includes('empréstimo pessoal') ||
        textoCompleto.includes('emprestimo pessoal') ||
        textoCompleto.includes('open finance') ||
        textoCompleto.includes('openfinance');
    
    const mencionaSeguroDividaZero = 
        textoCompleto.includes('seguro dívida zero') ||
        textoCompleto.includes('seguro divida zero') ||
        textoCompleto.includes('seguro dívida zero') ||
        textoCompleto.includes('dívida zero') ||
        textoCompleto.includes('divida zero') ||
        textoCompleto.includes('seguro perda de renda') ||
        textoCompleto.includes('seguro desemprego') ||
        textoCompleto.includes('sabemi') ||
        textoCompleto.includes('pitzi');
    
    const mencionaSeguroSaudeSimplificada = 
        textoCompleto.includes('seguro saúde simplificada') ||
        textoCompleto.includes('seguro saude simplificada') ||
        textoCompleto.includes('seguro saúde') ||
        textoCompleto.includes('seguro saude') ||
        textoCompleto.includes('morte acidental') ||
        textoCompleto.includes('doutor online') ||
        textoCompleto.includes('telemedicina') ||
        textoCompleto.includes('assistência odontológica') ||
        textoCompleto.includes('assistencia odontologica');
    
    const mencionaClubeVelotax = 
        textoCompleto.includes('clube velotax') ||
        textoCompleto.includes('clube velotax') ||
        textoCompleto.includes('vibe') ||
        textoCompleto.includes('créditos vibe') ||
        textoCompleto.includes('creditos vibe') ||
        textoCompleto.includes('cupons de desconto') ||
        textoCompleto.includes('descontos velotax');
    
    // Adicionar conhecimento do Crédito do Trabalhador se mencionado
    if (mencionaCreditoTrabalhador) {
        console.log('📚 DETECTADO: Crédito do Trabalhador mencionado - incluindo conhecimento completo');
        const explicacao = gerarMensagemExplicativa('credito-trabalhador', '');
        // Remover tags HTML para usar em texto puro
        const textoLimpo = explicacao.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        conhecimentoProdutos += '\n\n📚 CONHECIMENTO DO PRODUTO - CRÉDITO DO TRABALHADOR:\n';
        conhecimentoProdutos += 'Use estas informações completas sobre o Crédito do Trabalhador para formular uma resposta precisa e fundamentada:\n\n';
        conhecimentoProdutos += textoLimpo;
        conhecimentoProdutos += '\n\n🎯 INSTRUÇÃO: Use este conhecimento sobre o Crédito do Trabalhador para explicar corretamente o produto, seus processos, prazos e características quando relevante na resposta.\n';
    }
    
    // Adicionar conhecimento do Crédito Pessoal se mencionado
    if (mencionaCreditoPessoal) {
        console.log('📚 DETECTADO: Crédito Pessoal mencionado - incluindo conhecimento completo');
        const explicacao = gerarMensagemExplicativa('credito-pessoal', '');
        // Remover tags HTML para usar em texto puro
        const textoLimpo = explicacao.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        conhecimentoProdutos += '\n\n📚 CONHECIMENTO DO PRODUTO - CRÉDITO PESSOAL:\n';
        conhecimentoProdutos += 'Use estas informações completas sobre o Crédito Pessoal para formular uma resposta precisa e fundamentada:\n\n';
        conhecimentoProdutos += textoLimpo;
        conhecimentoProdutos += '\n\n🎯 INSTRUÇÃO: Use este conhecimento sobre o Crédito Pessoal para explicar corretamente o produto, seus processos, prazos e características quando relevante na resposta.\n';
    }
    
    // Adicionar conhecimento do Seguro Dívida Zero se mencionado
    if (mencionaSeguroDividaZero) {
        console.log('📚 DETECTADO: Seguro Dívida Zero mencionado - incluindo conhecimento completo');
        const explicacao = gerarMensagemExplicativa('seguro-divida-zero', '');
        // Remover tags HTML para usar em texto puro
        const textoLimpo = explicacao.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        conhecimentoProdutos += '\n\n📚 CONHECIMENTO DO PRODUTO - SEGURO DÍVIDA ZERO:\n';
        conhecimentoProdutos += 'Use estas informações completas sobre o Seguro Dívida Zero para formular uma resposta precisa e fundamentada:\n\n';
        conhecimentoProdutos += textoLimpo;
        conhecimentoProdutos += '\n\n🎯 INSTRUÇÃO: Use este conhecimento sobre o Seguro Dívida Zero para explicar corretamente o produto, seus processos, prazos, coberturas e características quando relevante na resposta.\n';
    }
    
    // Adicionar conhecimento do Seguro Saúde Simplificada se mencionado
    if (mencionaSeguroSaudeSimplificada) {
        console.log('📚 DETECTADO: Seguro Saúde Simplificada mencionado - incluindo conhecimento completo');
        const explicacao = gerarMensagemExplicativa('seguro-saude-simplificada', '');
        // Remover tags HTML para usar em texto puro
        const textoLimpo = explicacao.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        conhecimentoProdutos += '\n\n📚 CONHECIMENTO DO PRODUTO - SEGURO SAÚDE SIMPLIFICADA:\n';
        conhecimentoProdutos += 'Use estas informações completas sobre o Seguro Saúde Simplificada para formular uma resposta precisa e fundamentada:\n\n';
        conhecimentoProdutos += textoLimpo;
        conhecimentoProdutos += '\n\n🎯 INSTRUÇÃO: Use este conhecimento sobre o Seguro Saúde Simplificada para explicar corretamente o produto, suas coberturas, assistências, prazos e características quando relevante na resposta.\n';
    }
    
    // Adicionar conhecimento do Clube Velotax se mencionado
    if (mencionaClubeVelotax) {
        console.log('📚 DETECTADO: Clube Velotax mencionado - incluindo conhecimento completo');
        const explicacao = gerarMensagemExplicativa('clube-velotax', '');
        // Remover tags HTML para usar em texto puro
        const textoLimpo = explicacao.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        conhecimentoProdutos += '\n\n📚 CONHECIMENTO DO PRODUTO - CLUBE VELOTAX:\n';
        conhecimentoProdutos += 'Use estas informações completas sobre o Clube Velotax para formular uma resposta precisa e fundamentada:\n\n';
        conhecimentoProdutos += textoLimpo;
        conhecimentoProdutos += '\n\n🎯 INSTRUÇÃO: Use este conhecimento sobre o Clube Velotax para explicar corretamente o produto, seus benefícios, funcionamento, valores e características quando relevante na resposta.\n';
    }
    
    return conhecimentoProdutos;
}

// Função para gerar mensagem explicativa com respostas fixas
function gerarMensagemExplicativa(tema, contexto) {
    const explicacoes = {
        'malha-fina': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Vamos esclarecer sobre a Malha Fina:</p>
            <ol>
                <li><strong>O que é:</strong> É um sistema de fiscalização da Receita Federal que identifica inconsistências na declaração do IR.</li>
                <li><strong>Como funciona:</strong> O sistema compara as informações declaradas com dados de terceiros.</li>
                <li><strong>Prazo para resposta:</strong> Você tem 30 dias para se manifestar após receber a notificação.</li>
                <li><strong>Como resolver:</strong> É necessário apresentar documentos que comprovem as informações declaradas.</li>
                <li><strong>Penalidades:</strong> Caso não seja respondida, pode gerar multas e juros.</li>
            </ol>
            <p>Nossa equipe está disponível para orientações sobre como proceder em seu caso específico.</p>
        `,
        'exclusao': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Se você deseja excluir sua conta na Velotax, preparamos um passo a passo simples. Você pode fazer isso de duas formas:</p>
            
            <p><strong>🔹 1. Pelo aplicativo</strong></p>
            <ol>
                <li>Abra o app da Velotax no seu celular.</li>
                <li>Toque no ícone de Impostos</li>
                <li>Selecione a opção "DARFs para investidores".</li>
                <li>No canto superior direito, toque no ícone de menu (☰).</li>
                <li>Role a tela lateral esquerda até encontrar a opção "Conta".</li>
                <li>Role até o final e toque em "Excluir conta".</li>
            </ol>
            
            <p><strong>🔹 2. Pelo site</strong></p>
            <ol>
                <li>Acesse: www.velotax.com.br</li>
                <li>Faça login com seu CPF e senha.</li>
                <li>No menu inferior, do lado esquerdo, clique em "Conta".</li>
                <li>Role a página até o final e clique em "Excluir conta".</li>
            </ol>
            
            <p><strong>⚠️ Importante</strong></p>
            <p>A exclusão será feita conforme a Lei Geral de Proteção de Dados (LGPD), garantindo segurança e privacidade. Todas as informações registradas (declarações, relatórios e documentos fiscais) serão apagadas definitivamente. Lembrando que a exclusão de seus dados não cancela planos ativos em cobrança.</p>
        `,
        'procuracoes': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Para revogar procurações no eCAC, siga os passos abaixo:</p>
            <ol>
                <li>Acesse www.gov.br/receitafederal</li>
                <li>Clique em "eCAC" e faça login</li>
                <li>No menu, selecione "Procurações"</li>
                <li>Escolha "Revogar Procuração"</li>
                <li>Selecione a procuração a ser revogada</li>
                <li>Confirme a operação</li>
            </ol>
            <p>A revogação é imediata e você receberá confirmação por e-mail.</p>
            <p>Em caso de dificuldades, nossa equipe está disponível para orientações.</p>
        `,
        'ccb': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>A Cédula de Crédito Bancário (CCB) é um título de crédito que representa uma promessa de pagamento. Vamos esclarecer todas as cláusulas contratuais:</p>
            
            <p><strong>📋 CLÁUSULAS DA CCB:</strong></p>
            
            <p><strong>Cláusula 1 - Partes e Definições:</strong><br>
            Identifica quem empresta (credor/instituição), quem toma o crédito (devedor/cliente) e define termos usados no contrato como "Chave Pix", "Conta de Pagamento" e "Antecipação".</p>
            
            <p><strong>Cláusula 2 - Objeto do Contrato:</strong><br>
            Explica qual operação está sendo contratada — antecipação de restituição, empréstimo com garantia de restituição, ou outra modalidade.</p>
            
            <p><strong>Cláusula 3 - Valor, Liberação e Conta de Crédito:</strong><br>
            Estabelece o montante, data de liberação e conta para depósito do valor contratado.</p>
            
            <p><strong>Cláusula 4 - Vencimento e Forma de Pagamento:</strong><br>
            Define quando e como a dívida será paga — parcelamento, vencimento único ou amortizações. A dívida será quitada automaticamente com o crédito da restituição do Imposto de Renda.</p>
            
            <p><strong>Cláusula 5 - Juros, Encargos e Forma de Cálculo:</strong><br>
            Especifica os juros remuneratórios, juros de mora, encargos, periodicidade de capitalização e método de cálculo.</p>
            
            <p><strong>⚠️ IMPORTANTE:</strong><br>
            É fundamental que você leia atentamente todas as cláusulas do contrato antes de assinar, compreendendo os termos, condições, taxas de juros, prazos e consequências do não cumprimento das obrigações assumidas.</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre qualquer cláusula específica da CCB.</p>
        `,
        'credito-trabalhador': `
            <p><strong>👷‍♂️ Crédito do Trabalhador - Informações Completas</strong></p>
            
            <p><strong>O que é o Crédito do Trabalhador?</strong></p>
            <p>O Crédito do Trabalhador é uma modalidade de consignado que oferece mais praticidade e segurança, pois as parcelas são descontadas diretamente do salário ou benefício, sem risco de atraso ou esquecimento. Essa estrutura garante maior controle financeiro, diferentemente do empréstimo pessoal, em que o cliente precisa administrar boletos ou débitos automáticos. Além disso, por ser consignado, costuma apresentar taxas mais acessíveis, tornando-se uma opção mais vantajosa e estável para quem busca crédito com condições mais favoráveis.</p>
            
            <p><strong>📋 Base Legal:</strong> Lei 15.179 de 25/07/2025 (alteração da Lei 10.820 de 2003).</p>
            <p><strong>⚙️ Mecanismo:</strong> Desconto via Guia de pagamento do FGTS.</p>
            
            <p><strong>👥 Para quem é destinado?</strong></p>
            <p>O Crédito do Trabalhador é exclusivo para:</p>
            <ul>
                <li><strong>Trabalhadores domésticos</strong> - Categoria 104 do eSocial</li>
                <li><strong>Trabalhadores com carteira assinada (CLT)</strong> - Categoria 101 do eSocial</li>
                <li><strong>Diretores com conta no FGTS</strong> - Categoria 721 do eSocial</li>
            </ul>
            
            <p><strong>✅ Critérios específicos do Velotax:</strong></p>
            <ul>
                <li>Tempo mínimo de vínculo: <strong>12 meses</strong></li>
                <li>Empresa com status "Ativa" e mais de <strong>24 meses</strong> de cadastramento</li>
            </ul>
            
            <p><strong>💰 Exemplo de Cálculo da Margem:</strong></p>
            <ul>
                <li>Salário Líquido: R$ 2.000,00</li>
                <li>Margem Consignável: 25%</li>
                <li>Valor Disponível: R$ 500,00</li>
            </ul>
            
            <p><strong>⏰ Prazos Importantes:</strong></p>
            <ul>
                <li><strong>Liberação:</strong> Via PIX CPF</li>
                <li><strong>Tempo:</strong> Até 30 minutos</li>
                <li><strong>Carência para o 1º vencimento de parcela:</strong> 60 ou 92 dias</li>
            </ul>
            
            <p><strong>🚫 Não elegíveis:</strong></p>
            <ul>
                <li>Funcionários afastados</li>
                <li>Funcionários em aviso prévio</li>
                <li>Funcionários com data de demissão incluída</li>
            </ul>
            
            <p><strong>🎁 Benefícios para o Cliente:</strong></p>
            <ul>
                <li><strong>Taxa de juros reduzida:</strong> Em comparação a outros tipos de crédito, como cartão de crédito e empréstimo pessoal</li>
                <li><strong>Parcelas fixas e previsíveis:</strong> Sem surpresas no orçamento mensal, facilitando o planejamento financeiro</li>
                <li><strong>Troca de dívidas caras:</strong> Possibilidade de substituir dívidas com juros altos por um empréstimo mais justo</li>
                <li><strong>Praticidade:</strong> Desconto automático na folha de pagamento, sem preocupação com boletos</li>
                <li><strong>Acesso facilitado ao crédito:</strong> Especialmente para trabalhadores que encontram barreiras em outros tipos de empréstimo</li>
                <li><strong>Processo 100% digital:</strong> Todo o processo pode ser realizado pelo aplicativo Velotax, sem burocracia</li>
            </ul>
            
            <p><strong>📱 Passo a Passo da Contratação:</strong></p>
            <p><strong>Processo 100% digital e simplificado</strong></p>
            <ol>
                <li><strong>Acesso e Autorização:</strong> O cliente acessa o aplicativo do Velotax e seleciona a opção Crédito do Trabalhador. Autoriza a Consulta de Margem (validade: 45 dias).</li>
                <li><strong>Análise e Validação:</strong> O Velotax valida a elegibilidade, vínculo, margem e informações da empresa do cliente.</li>
                <li><strong>Proposta e Assinatura:</strong> Após aprovação, o cliente recebe a proposta com as condições, confirma no app e assina o contrato digital.</li>
                <li><strong>Averbação:</strong> O contrato é averbado no sistema (disponível das 06h às 22h, 7 dias por semana).</li>
                <li><strong>Liberação do Crédito:</strong> O valor é disponibilizado exclusivamente via PIX CPF em até 30 minutos após a averbação.</li>
            </ol>
            
            <p><strong>📄 Documentação Necessária:</strong></p>
            <ul>
                <li>Selfie com liveness</li>
                <li>Cópia do RG/CPF/CNH</li>
            </ul>
            
            <p><strong>📅 Datas de Contratação e Vencimento:</strong></p>
            <ul>
                <li><strong>Até dia 20:</strong> Vencimento da primeira parcela 2 meses depois</li>
                <li><strong>A partir do dia 21:</strong> Vencimento da primeira parcela 3 meses depois</li>
            </ul>
            
            <p><strong>❌ Resultado Negativo:</strong></p>
            <p>A análise de crédito pode resultar em aprovação ou não. Se o resultado for negativo, informe apenas que não há oferta disponível no momento. O cliente poderá realizar uma nova tentativa após 30 dias. Caso necessário, oriente a entrar em contato com o suporte para mais informações.</p>
            
            <p><strong>⚠️ Possível motivo de atrito:</strong></p>
            <p>O repasse do consignado é realizado pela Caixa Econômica Federal, e a baixa do pagamento pode levar até 2 dias úteis após o envio pela empresa. Por esse motivo, mesmo que o cliente tenha solicitado o cancelamento dentro do prazo de 7 dias, ainda pode ocorrer a cobrança da primeira parcela após o período de carência (60 a 92 dias). Nesses casos, é importante orientar o cliente com clareza e acolhimento, registrar um chamado imediatamente e acionar o supervisor para acompanhamento da situação.</p>
            
            <p><strong>❓ Perguntas Frequentes:</strong></p>
            <p><strong>Quem pode solicitar o Crédito do Trabalhador?</strong><br>
            Trabalhadores com carteira assinada (CLT), incluindo domésticos e diretores com conta no FGTS, com vínculo mínimo de 12 meses.</p>
            
            <p><strong>Qual o valor máximo das parcelas?</strong><br>
            No Velotax, as parcelas podem comprometer no máximo 25% do salário líquido, embora a lei permita até 35%.</p>
            
            <p><strong>Posso ter mais de um empréstimo ao mesmo tempo?</strong><br>
            É permitido um empréstimo por vínculo de trabalho. Inicialmente, o Velotax permite no máximo um contrato por CPF.</p>
            
            <p><strong>Como o FGTS pode ser usado nesse empréstimo?</strong><br>
            O FGTS pode ser usado como garantia para reduzir os juros. Em caso de demissão, o saldo pode quitar parte ou toda a dívida restante.</p>
            
            <p><strong>Posso cancelar o empréstimo depois de contratado?</strong><br>
            Sim, você tem até 7 dias corridos após receber o dinheiro para devolver o valor e cancelar, sem multa.</p>
            
            <p><strong>Tenho restrição no nome, posso contratar?</strong><br>
            Em muitos casos, sim. A análise considera a política de crédito, avaliando além de restrições, a existência de emprego estável e outros fatores.</p>
            
            <p><strong>Já quitei meu contrato. Em quanto tempo consta no sistema a baixa e a desaverbação? E quando posso solicitar o Crédito do Trabalhador novamente?</strong><br>
            Após a quitação, a baixa e a desaverbação do contrato acontecem em até 2 dias úteis. Somente após esse prazo o sistema libera a possibilidade de contratar novamente o Crédito do Trabalhador. Em resumo: o cliente pode solicitar um novo crédito a partir de 2 dias úteis após a quitação.</p>
            
            <p><strong>💡 Como o Atendimento Deve se Posicionar:</strong></p>
            <p>Use uma <strong>linguagem clara</strong> e <strong>acolhedora</strong>. Evite começar a conversa com termos difíceis ou muito técnicos, que podem gerar confusão logo no início. Explique de forma didática o funcionamento do produto e seus benefícios. Confirme o entendimento do cliente sobre como funciona o desconto em folha. Reforce a transparência: todas as condições estarão descritas no contrato acessível pelo app.</p>
            
            <p><strong>Dicas para um atendimento eficaz:</strong></p>
            <ul>
                <li>Seja <strong>acolhedor</strong> e demonstre interesse genuíno em ajudar</li>
                <li>Ofereça soluções personalizadas de acordo com o perfil do cliente</li>
                <li>Garanta a <strong>confiança</strong> e <strong>fidelização</strong> através do seu atendimento</li>
            </ul>
            
            <p><strong>Exemplo de explicação:</strong><br>
            "O valor da parcela é descontado direto do seu salário, o que facilita o controle financeiro e permite juros menores."</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre o Crédito do Trabalhador.</p>
        `,
        'credito-pessoal': `
            <p><strong>💰 Crédito Pessoal Velotax - Informações Completas</strong></p>
            
            <p><strong>O que é o Empréstimo Pessoal?</strong></p>
            <p>O Empréstimo Pessoal é uma linha de crédito concedida a pessoas físicas por instituições financeiras. Nessa modalidade, o cliente recebe um valor e o paga em parcelas mensais com juros, sem a necessidade de oferecer garantias ou justificar o uso do dinheiro. Esse tipo de crédito oferece flexibilidade e praticidade, podendo ser utilizado para diferentes finalidades, como quitar dívidas, investir em educação, cobrir emergências ou realizar projetos pessoais.</p>
            
            <p><strong>📋 Características do Produto - Empréstimo Pessoal Velotax:</strong></p>
            <ul>
                <li><strong>Valor do limite:</strong> R$ 500,00</li>
                <li><strong>Parcelamento:</strong> 4 parcelas, com vencimento a cada 30 dias</li>
                <li><strong>Data de vencimento:</strong> Definida automaticamente, com base na movimentação financeira do cliente via Open Finance</li>
                <li><strong>Contratos ativos:</strong> Não é permitido ter mais de um contrato ativo ao mesmo tempo</li>
                <li><strong>Pagamento antecipado:</strong> Possível pelo app, mas não garante liberação imediata de novo crédito nem aumento de limite</li>
                <li><strong>Cobrança em atraso:</strong> Operações inadimplentes serão tratadas pela equipe interna de cobrança do Velotax</li>
                <li><strong>Faixa etária:</strong> 18 a 75 anos para todos os clientes</li>
            </ul>
            
            <p><strong>🔗 O que é Open Finance?</strong></p>
            <p>O Open Finance é como se fosse uma "ponte segura" que conecta diferentes bancos e instituições financeiras. Ele permite que você, com a sua autorização, compartilhe suas informações financeiras (como saldo, histórico de movimentações ou limites de crédito) de um banco para outro. Assim, em vez de cada banco conhecer só uma parte da sua vida financeira, eles passam a ter uma visão mais completa — e isso ajuda a oferecer melhores condições de crédito, taxas mais baixas e serviços feitos sob medida para você.</p>
            
            <p><strong>⚙️ Como funciona na prática:</strong></p>
            <ol>
                <li><strong>Consentimento:</strong> Você decide se quer ou não compartilhar seus dados e escolhe exatamente qual banco ou empresa poderá acessá-los</li>
                <li><strong>Compartilhamento seguro:</strong> Esses dados viajam por um sistema de segurança chamado API, que funciona como uma "ponte digital": onde só a instituição autorizada consegue acessar</li>
                <li><strong>Benefícios para você:</strong> Com essas informações, os bancos conseguem entender melhor o seu perfil e oferecer soluções personalizadas, como fácil contratação, aumento do limite de crédito e investimentos mais adequados ao seu bolso</li>
            </ol>
            
            <p><strong>💡 Exemplo simples:</strong><br>
            O Open Finance é como uma estrada com pedágio: só passa quem tem autorização, garantindo que a viagem seja segura. A API é o carro blindado que transporta as informações nessa estrada, protegendo tudo durante o trajeto.</p>
            
            <p><strong>ℹ️ Saiba que:</strong><br>
            Durante a jornada de contratação, pode aparecer para o cliente o símbolo de um 'b' amarelo ao autorizar a conexão com o Open Finance. A Belvo é a empresa autorizada que atua como nossa parceira na tecnologia do Open Finance.</p>
            
            <p><strong>📱 Como Contratar o Crédito Pessoal?</strong></p>
            <p><strong>O processo é simples e 100% digital, feito diretamente no aplicativo Velotax:</strong></p>
            <ol>
                <li><strong>Acesso ao produto:</strong> O cliente acessa o aplicativo Velotax e seleciona o ícone do Empréstimo Pessoal na tela inicial</li>
                <li><strong>Apresentação do produto:</strong> É exibida uma tela com as principais características do empréstimo</li>
                <li><strong>Conexão com o Open Finance:</strong> O cliente autoriza a conexão para análise de crédito e risco de fraude</li>
                <li><strong>Oferta de crédito:</strong> Se aprovado, o cliente visualiza o limite disponível (atualmente R$ 500,00)</li>
                <li><strong>Proposta de empréstimo:</strong> O aplicativo apresenta simulação com: valor contratado, juros e encargos (sigla CET), valor total a pagar, data da primeira parcela e número de parcelas</li>
                <li><strong>Orientação de pagamento:</strong> O cliente é informado sobre a importância de manter os pagamentos em dia e que poderá quitar via Pix Copia e Cola</li>
                <li><strong>Confirmação e assinatura:</strong> O cliente revisa todas as condições, lê a CCB (Contrato de Crédito Bancário) e assina digitalmente para confirmar a contratação</li>
                <li><strong>Liberação do crédito:</strong> O app mostra a confirmação e, em poucos minutos, o valor contratado é creditado na mesma conta corrente vinculada ao Open Finance</li>
            </ol>
            
            <p><strong>❌ Resultado Negativo:</strong></p>
            <p>A análise de crédito pode resultar em aprovação ou não. Se o resultado for negativo, informe apenas que não há oferta disponível no momento. O cliente poderá realizar uma nova tentativa após 30 dias. Caso necessário, oriente a entrar em contato com o suporte para mais informações.</p>
            
            <p><strong>🚫 Cancelamento do Produto – Empréstimo Pessoal Velotax:</strong></p>
            <ul>
                <li>O cliente poderá solicitar o cancelamento do contrato em até 7 dias após a contratação, conforme previsto em lei</li>
                <li>Para o cancelamento, será necessário devolver o valor integral recebido, por meio de PIX</li>
                <li>Após esse prazo, não será mais possível cancelar o contrato. O cliente deverá seguir com o pagamento das parcelas pelo aplicativo Velotax, conforme as condições contratadas, incluindo a incidência de juros e encargos previstos no contrato</li>
            </ul>
            
            <p><strong>💳 Como Quitar o Empréstimo?</strong></p>
            <ol>
                <li>Acessar a página inicial do app Velotax</li>
                <li>Rolar até a seção "Próximos Pagamentos"</li>
                <li>Selecionar "Crédito Pessoal"</li>
                <li>Conferir o valor a ser quitado</li>
                <li>Escolher uma das opções de pagamento disponíveis: PIX ou cartão de crédito</li>
            </ol>
            
            <p>O cliente poderá antecipar parcelas diretamente pelo aplicativo Velotax ou aguardar os lembretes de cobrança enviados por notificações. O pagamento será realizado preferencialmente via Pix Copia e Cola. O cartão de crédito poderá ser oferecido como alternativa, em especial para clientes em atraso.</p>
            
            <p><strong>⚠️ Em caso de não pagamento:</strong> Poderão ser aplicadas medidas de cobrança, incluindo negativação em órgãos de proteção ao crédito e, em alguns casos, protesto em cartório.</p>
            
            <p><strong>📌 Observações Importantes:</strong></p>
            <ul>
                <li>A análise de crédito é feita via Open Finance</li>
                <li><strong>Bancos disponíveis atualmente:</strong> Nubank, Itaú (Pessoa Física), Bradesco (Pessoa Física), Santander (Pessoa Física), Banco do Brasil, Caixa Econômica</li>
                <li>Caso o banco desejado não esteja disponível, não será possível seguir com a vinculação</li>
                <li><strong>Tempo de análise:</strong> até 5 minutos. Se a tela "Aguarde" estiver ativa, oriente o cliente a permanecer aguardando</li>
                <li><strong>Após a aprovação:</strong> o valor é enviado à conta do cliente entre 30 minutos e 24 horas</li>
                <li><strong>Limite inicial:</strong> até R$ 500,00</li>
                <li><strong>Parcelamento:</strong> em até 4 vezes</li>
            </ul>
            
            <p><strong>❓ Perguntas Frequentes sobre o Crédito Pessoal Velotax:</strong></p>
            
            <p><strong>1. O cliente pode alterar o valor da oferta inicial ou reduzir os juros?</strong><br>
            Resposta: Não. Nesta versão inicial, o valor é fixo em R$ 500,00, parcelado em até 4 vezes, com taxa de juros de 19% a.m.</p>
            
            <p><strong>2. O cliente já possui outro produto ativo com o Velotax. Ele pode contratar o Empréstimo Pessoal simultaneamente?</strong><br>
            Resposta: Não. Clientes que já contrataram o Crédito do Trabalhador ou que possuem débitos de Antecipação IRPF precisam quitar esses produtos antes de solicitar o Empréstimo Pessoal.</p>
            
            <p><strong>3. O consentimento do Open Finance é obrigatório?</strong><br>
            Resposta: Sim. O cliente só poderá avançar para a análise de crédito mediante consentimento no Open Finance.</p>
            
            <p><strong>4. Após o consentimento, o empréstimo é aprovado automaticamente?</strong><br>
            Resposta: Não. As informações financeiras do cliente são avaliadas para verificar se há crédito disponível.</p>
            
            <p><strong>5. O cliente pode ser aprovado com conta em qualquer banco?</strong><br>
            Resposta: Não. No momento, aceitamos apenas clientes com conta no Itaú, Bradesco, Santander, Banco do Brasil, Nubank e Inter.</p>
            
            <p><strong>6. O cliente realizou o consentimento, mas a tela não avançou. Isso significa que houve problema?</strong><br>
            Resposta: Não. O processo de análise via Open Finance pode levar entre 2 e 5 minutos para validar todas as informações.</p>
            
            <p><strong>7. O cliente realizou o consentimento, mas o crédito não foi aprovado. Ele pode solicitar novamente?</strong><br>
            Resposta: Sim. O cliente poderá tentar novamente após 30 dias.</p>
            
            <p><strong>8. É necessária biometria ou envio de documentos para contratar o Empréstimo Pessoal?</strong><br>
            Resposta: Não. Nesta primeira versão do produto, não haverá exigência de biometria ou envio de documentos adicionais.</p>
            
            <p><strong>9. O empréstimo foi aprovado, mas o cliente ainda não tem certeza se deseja contratar. Ele pode finalizar depois?</strong><br>
            Resposta: Sim. A proposta permanece válida por 10 dias.</p>
            
            <p><strong>10. O empréstimo foi aprovado, mas a chave Pix do cliente foi recusada. Ele pode corrigir?</strong><br>
            Resposta: Sim. A chave Pix deve ser obrigatoriamente o CPF do cliente e estar vinculada à mesma conta informada no Open Finance. Basta refazer o processo e tentar novamente.</p>
            
            <p><strong>11. O cliente pode escolher a data de vencimento das parcelas?</strong><br>
            Resposta: Não. A data de vencimento será definida automaticamente, de acordo com a análise do fluxo financeiro via Open Finance.</p>
            
            <p><strong>12. O cliente pode pagar o empréstimo com cartão de crédito?</strong><br>
            Resposta: Sim, mas essa opção será disponibilizada preferencialmente para clientes em atraso.</p>
            
            <p><strong>13. O cliente pagou em atraso. Isso aumenta o valor da parcela?</strong><br>
            Resposta: Sim. Em caso de atraso, será cobrada multa de 2% e encargos de 1% ao mês.</p>
            
            <p><strong>14. O cliente não pagou a dívida. Ele pode ser negativado?</strong><br>
            Resposta: Sim. Caso o atraso não seja regularizado, o contrato poderá ser enviado aos órgãos de proteção ao crédito.</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre o Crédito Pessoal Velotax.</p>
        `,
        'seguro-divida-zero': `
            <p><strong>Seguro Dívida Zero Velotax - Informações Completas</strong></p>
            
            <p><strong>📋 O que é o Seguro Dívida Zero?</strong></p>
            <p>O Seguro Dívida Zero (Perda de Renda) é uma proteção financeira exclusiva para clientes Velotax, desenhado para garantir que suas contas fiquem em dia, mesmo quando a vida sai do roteiro. É o "paraquedas" financeiro para quem trabalha com carteira assinada (CLT) e quer dormir tranquilo.</p>
            
            <p><strong>💰 Coberturas - Quanto o cliente recebe?</strong></p>
            
            <p><strong>1. Desemprego Involuntário (sem justa causa):</strong></p>
            <ul>
                <li><strong>Benefício:</strong> Cobre até 6 parcelas de R$ 1.000,00</li>
                <li><strong>Total:</strong> Até R$ 6.000,00 para segurar as pontas</li>
                <li><strong>Carência:</strong> 31 dias após contratar</li>
                <li><strong>Franquia:</strong> 31 dias após o desemprego</li>
            </ul>
            
            <p><strong>2. Incapacidade Temporária por Acidente Pessoal (DIT-AP):</strong></p>
            <ul>
                <li><strong>Benefício:</strong> Pagamento de diárias de até R$ 200,00</li>
                <li><strong>Limite:</strong> Cobre no máximo 90 diárias</li>
                <li><strong>Carência:</strong> Não tem (vale logo após contratar)</li>
                <li><strong>Franquia:</strong> 15 dias de afastamento</li>
            </ul>
            
            <p><strong>🎁 Benefícios Extras:</strong></p>
            <ul>
                <li><strong>Apoio Emocional:</strong> Orientação Psicológica por telefone com psicólogos para suporte preventivo e básico</li>
                <li><strong>Sorteio Mensal:</strong> Todo mês, o cliente concorre a um sorteio de R$ 10.000,00 em dinheiro (bruto). O sorteio acontece todo último sábado do mês</li>
            </ul>
            
            <p><strong>💵 Valor e Contratação:</strong></p>
            <ul>
                <li><strong>Valor:</strong> Apenas R$ 29,90 por mês (menos que uma pizza ou serviço de streaming!)</li>
                <li><strong>Contratação:</strong> 100% online pelo App Velotax</li>
            </ul>
            
            <p><strong>📱 Passo a Passo para Contratar:</strong></p>
            <ol>
                <li>Abra o App Velotax e vá na aba "Seguros"</li>
                <li>No card "Seguro Dívida Zero", clique em "Simular agora"</li>
                <li>Confira os detalhes e clique em "Continuar"</li>
                <li>Escolha como pagar: Mensal, Anual à vista ou Parcelado em 12x</li>
                <li>Pague com Pix ou Cartão de Crédito</li>
                <li>Pronto! Quando aparecer a tela de "Parabéns", o cliente está protegido</li>
            </ol>
            
            <p><strong>🔄 Cancelamento e Estorno (CDC - Art. 49):</strong></p>
            
            <p><strong>Prazo de 7 Dias (Direito de Arrependimento):</strong></p>
            <p>O cliente tem 7 dias corridos após a contratação para desistir da compra.</p>
            
            <p><strong>Cenário A: Até 7 Dias (Responsabilidade Velotax):</strong></p>
            <ul>
                <li><strong>Ação:</strong> Realizar o estorno integral imediatamente</li>
                <li><strong>Destino:</strong> Obrigatoriamente para a mesma conta/cartão de origem</li>
                <li><strong>Script:</strong> "Como está dentro do prazo de 7 dias, processamos o seu cancelamento e o estorno será feito na conta de origem."</li>
            </ul>
            
            <p><strong>Cenário B: Após 7 Dias (Responsabilidade Parceiro):</strong></p>
            <ul>
                <li><strong>Ação:</strong> Transferir a responsabilidade para a empresa parceira (Sabemi, Pitzi, etc.)</li>
                <li><strong>Fluxo:</strong> Informar que o prazo de arrependimento expirou e fornecer os canais do parceiro</li>
                <li><strong>Script:</strong> "A sua contratação tem mais de 7 dias. Por isso, o cancelamento deve ser tratado diretamente com a [Empresa Parceira] conforme o seu contrato."</li>
            </ul>
            
            <p><strong>📞 Contatos para Suporte:</strong></p>
            
            <p><strong>Dúvidas gerais sobre o produto ou contratação:</strong></p>
            <ul>
                <li><strong>Fale com a Velotax:</strong></li>
                <li>Chat no App</li>
                <li>Telefones: 3003-7293 (Capitais) ou 0800 800 0049 (Outras localidades)</li>
            </ul>
            
            <p><strong>Aconteceu um imprevisto? Precisa acionar o seguro, psicólogo ou ver sorteio?</strong></p>
            <ul>
                <li><strong>Fale direto com a seguradora parceira Sabemi:</strong></li>
                <li>Sinistros e Geral: 0800 880 1900 ou WhatsApp (51) 9 9528-0140</li>
                <li>Psicólogo: 0800 775 1911</li>
            </ul>
            
            <p><strong>✅ Resumo do Seguro Dívida Zero:</strong></p>
            <ul>
                <li><strong>Público:</strong> Ideal para CLTs</li>
                <li><strong>Preço:</strong> R$ 29,90/mês</li>
                <li><strong>Cobre:</strong> Desemprego (até R$ 6 mil) e Acidentes (Diárias)</li>
                <li><strong>Bônus:</strong> Psicólogo + Sorteio de R$ 10 mil</li>
                <li><strong>Contratação:</strong> No App Velotax, em menos de 3 minutos</li>
            </ul>
            
            <p><strong>💡 Dica Importante:</strong></p>
            <p>Documente sempre: Data da contratação e motivo do cancelamento no ticket. Isso evita re-trabalho e reduz atritos no N2 ou Reclame Aqui.</p>
        `,
        'seguro-saude-simplificada': `
            <p><strong>Seguro Saúde Simplificada Velotax - Informações Completas</strong></p>
            
            <p><strong>📋 O que é o Seguro Saúde Simplificada?</strong></p>
            <p>Este é um seguro de <strong>Acidente Pessoal</strong>, ou seja, ele protege contra imprevistos graves. Foi desenhado para ser acessível e sem burocracia, oferecendo proteção financeira e uma ampla rede de assistências essenciais.</p>
            
            <p><strong>💼 Cobertura Principal: Morte Acidental (MA)</strong></p>
            <ul>
                <li><strong>O Que Cobre:</strong> Garante o pagamento de uma indenização aos beneficiários se a morte for exclusivamente decorrente de um acidente pessoal</li>
                <li><strong>O Valor:</strong> O Capital Segurado é de R$ 2.000,00</li>
                <li><strong>Nível:</strong> Nacional</li>
                <li><strong>Carência:</strong> Não tem carência (começa a valer na contratação), exceto em caso de suicídio que possui carência de 2 anos ininterruptos</li>
                <li><strong>Franquia:</strong> Não possui franquia</li>
            </ul>
            
            <p><strong>🏥 Rede de Bem-Estar - Benefícios Diários:</strong></p>
            <p>O grande valor deste seguro é o acesso imediato a uma ampla rede de assistências essenciais:</p>
            
            <p><strong>1. Doutor Online (Telemedicina):</strong></p>
            <ul>
                <li><strong>O Que Oferece:</strong> Consultas médicas emergenciais e eletivas por videochamada, com clínicos gerais e especialistas (Pediatria, Ginecologia, Cardiologia, Neurologia, etc.)</li>
                <li><strong>Carência:</strong> 48h úteis</li>
            </ul>
            
            <p><strong>2. Assistência Odontológica:</strong></p>
            <ul>
                <li><strong>O Que Oferece:</strong> Teleorientação inicial e, se for urgência comprovada, agendamento de consulta domiciliar com profissional credenciado em até 48h</li>
                <li><strong>Carência:</strong> 48h úteis</li>
            </ul>
            
            <p><strong>3. Orientação Psicológica:</strong></p>
            <ul>
                <li><strong>O Que Oferece:</strong> Atendimento telefônico com psicólogos para dar suporte preliminar, básico e preventivo em momentos sensíveis</li>
                <li><strong>Carência:</strong> Não se aplica</li>
            </ul>
            
            <p><strong>4. Orientação Nutricional:</strong></p>
            <ul>
                <li><strong>O Que Oferece:</strong> Esclarecimento de dúvidas sobre alimentação adequada e incentivo a uma rotina saudável por telefone</li>
                <li><strong>Carência:</strong> Não se aplica</li>
            </ul>
            
            <p><strong>5. Desconto em Medicamentos & Farmácia Online:</strong></p>
            <ul>
                <li><strong>Carência:</strong> 2 dias úteis</li>
            </ul>
            
            <p><strong>💵 Valor e Contratação:</strong></p>
            <ul>
                <li><strong>Valor:</strong> Apenas R$ 19,90 por mês</li>
                <li><strong>Contratação:</strong> 100% online pelo App Velotax</li>
            </ul>
            
            <p><strong>📱 Passo a Passo para Contratar:</strong></p>
            <ol>
                <li>Abra o App Velotax e vá na aba "Seguros"</li>
                <li>Clique em "Simular agora" no card do Seguro Saúde Simplificada</li>
                <li>Escolha a melhor opção de pagamento: Mensal, Anual à vista ou Parcelado em 12x (no Pix ou Cartão)</li>
                <li>Pronto! Confirme o pagamento e a proteção já começa a valer</li>
            </ol>
            
            <p><strong>🤝 Parceiro Estratégico: Sabemi</strong></p>
            <ul>
                <li><strong>Segurança e Garantia:</strong> A Sabemi é a seguradora responsável por emitir sua apólice e garantir o pagamento de todas as indenizações</li>
                <li><strong>Gestão de Assistências:</strong> Administra toda a rede de serviços (Doutor Online, Psicólogo, etc.) para assegurar que você tenha o melhor atendimento</li>
                <li><strong>Papel na Parceria:</strong> Enquanto a Velotax oferece a tecnologia para contratação ágil, a Sabemi entrega a solidez financeira da proteção</li>
            </ul>
            
            <p><strong>🔄 Cancelamento e Estorno (CDC - Art. 49):</strong></p>
            
            <p><strong>Prazo de 7 Dias (Direito de Arrependimento):</strong></p>
            <p>O cliente tem 7 dias corridos após a contratação para desistir da compra.</p>
            
            <p><strong>Cenário A: Até 7 Dias (Responsabilidade Velotax):</strong></p>
            <ul>
                <li><strong>Ação:</strong> Realizar o estorno integral imediatamente</li>
                <li><strong>Destino:</strong> Obrigatoriamente para a mesma conta/cartão de origem</li>
                <li><strong>Script:</strong> "Como está dentro do prazo de 7 dias, processamos o seu cancelamento e o estorno será feito na conta de origem."</li>
            </ul>
            
            <p><strong>Cenário B: Após 7 Dias (Responsabilidade Parceiro):</strong></p>
            <ul>
                <li><strong>Ação:</strong> Transferir a responsabilidade para a empresa parceira (Sabemi, Pitzi, etc.)</li>
                <li><strong>Fluxo:</strong> Informar que o prazo de arrependimento expirou e fornecer os canais do parceiro</li>
                <li><strong>Script:</strong> "A sua contratação tem mais de 7 dias. Por isso, o cancelamento deve ser tratado diretamente com a [Empresa Parceira] conforme o seu contrato."</li>
            </ul>
            
            <p><strong>📞 Canais de Atendimento:</strong></p>
            
            <p><strong>Dúvidas sobre o produto (antes de contratar):</strong></p>
            <ul>
                <li>Fale Conosco ou Chat do App Velotax</li>
            </ul>
            
            <p><strong>Acionar sinistro (Morte Acidental) ou Assistências em geral:</strong></p>
            <ul>
                <li><strong>Sabemi:</strong> 0800 880 1900 ou WhatsApp (51) 9 9528-0140</li>
            </ul>
            
            <p><strong>Doutor Online/Odontológica (Tele Triagem):</strong></p>
            <ul>
                <li>0800 775 1911 (Central 24h) ou Chat Online</li>
            </ul>
            
            <p><strong>Orientação Psicológica:</strong></p>
            <ul>
                <li>0800 775 1911</li>
            </ul>
            
            <p><strong>💡 Dica Importante:</strong></p>
            <p>Documente sempre: Data da contratação e motivo do cancelamento no ticket. Isso evita re-trabalho e reduz atritos no N2 ou Reclame Aqui.</p>
            
            <p><strong>✅ Resumo do Seguro Saúde Simplificada:</strong></p>
            <ul>
                <li><strong>Preço:</strong> R$ 19,90/mês</li>
                <li><strong>Cobertura Principal:</strong> Morte Acidental (R$ 2.000,00)</li>
                <li><strong>Benefícios:</strong> Telemedicina, Odontologia, Psicologia, Nutrição e Descontos em Farmácia</li>
                <li><strong>Contratação:</strong> 100% online pelo App Velotax</li>
            </ul>
        `,
        'clube-velotax': `
            <p><strong>Clube Velotax - Informações Completas</strong></p>
            
            <p><strong>📋 O que é o Clube Velotax?</strong></p>
            <p>O Clube Velotax é um serviço de assinatura exclusivo para clientes Velotax. É a plataforma exclusiva de descontos para transformar sua fidelidade em economia real. Em parceria com a Vibe, criamos um ecossistema de vantagens onde você não apenas economiza, mas ganha liberdade para comprar o que gosta nas melhores marcas do Brasil.</p>
            
            <p><strong>🎁 O que está incluso?</strong></p>
            <p>Ao se tornar um membro, você tem acesso a:</p>
            <ul>
                <li><strong>Cupons de Desconto:</strong> Economia em eletrônicos, moda, alimentação e muito mais</li>
                <li><strong>Sorteios Exclusivos:</strong> Chances reais de ganhar prêmios</li>
                <li><strong>Crédito Imediato:</strong> Assim que você entra, já recebe R$ 100,00 em créditos Vibe para usar como quiser dentro da rede parceira</li>
                <li><strong>Plataforma Integrada:</strong> Tudo dentro do app Velotax</li>
                <li><strong>Atualizações Frequentes:</strong> Novas ofertas e marcas adicionadas regularmente pela Vibe</li>
                <li><strong>Rede Nacional:</strong> Descontos válidos em todo o Brasil</li>
                <li><strong>Liberdade de Escolha:</strong> Use seus R$ 100 em créditos nos cupons que preferir</li>
            </ul>
            
            <p><strong>💡 Por que criamos o Clube?</strong></p>
            <p>Nosso objetivo é simples: <strong>recompensar você</strong>. Queremos que a sua relação com a Velotax vá além dos impostos e finanças. Queremos estar presentes no seu café da manhã, na compra do seu novo celular e no lazer do final de semana, proporcionando acesso a produtos e serviços com preços muito mais vantajosos.</p>
            
            <p><strong>📱 Como funciona na prática?</strong></p>
            <p>A contratação é 100% online, simples e segura, feita diretamente pelo seu aplicativo Velotax.</p>
            
            <p><strong>Sua Jornada de Economia:</strong></p>
            <ol>
                <li><strong>Assinatura:</strong> Acesse a aba "Clube" no App Velotax e faça sua adesão. O pagamento é feito via cartão de crédito com renovação automática (você não precisa se preocupar todo mês)</li>
                <li><strong>Acesso Imediato:</strong> Após a confirmação, sua conta no parceiro Vibe é criada automaticamente. Você acessa tudo sem sair do app da Velotax</li>
                <li><strong>Ganhe R$ 100:</strong> Ao entrar, seus créditos já estão lá esperando por você!</li>
                <li><strong>Escolha e Economize:</strong> Navegue pelas categorias, escolha sua loja favorita, pegue seu cupom e utilize-o na finalização da compra no site do parceiro</li>
            </ol>
            
            <p><strong>💵 Transparência: Valores e Cancelamento</strong></p>
            <ul>
                <li><strong>Investimento:</strong> Apenas R$ 19,90 por mês</li>
                <li><strong>Sem Multas:</strong> Você pode cancelar quando quiser</li>
                <li><strong>Como Cancelar:</strong> No próprio app, vá em Gestão de Conta > Clube Velotax > Cancelar Assinatura. A cobrança será interrompida para o mês seguinte</li>
            </ul>
            
            <p><strong>⚠️ Importante:</strong></p>
            <p>Nós garantimos o seu acesso à nossa plataforma com descontos. As regras específicas de cada cupom (validade e porcentagem) são definidas pelas lojas parceiras.</p>
            
            <p><strong>📞 Canais de Atendimento:</strong></p>
            
            <p><strong>Dúvidas sobre o Clube Velotax:</strong></p>
            <p>Nossa equipe de atendimento Velotax está pronta para te orientar sobre as características do produto e o acesso à plataforma.</p>
            <ul>
                <li><strong>Capitais e Regiões Metropolitanas:</strong> 3003 7293</li>
                <li><strong>Demais Localidades:</strong> 0800 800 0049</li>
                <li><strong>Horário:</strong> Seg a Sex (08h às 19h) | Sáb (09h às 15h)</li>
                <li><strong>Chat:</strong> No seu aplicativo</li>
            </ul>
            
            <p><strong>Dúvidas sobre créditos e parceiros (Vibe):</strong></p>
            <ul>
                <li><strong>Telefone:</strong> 0800 731 2500</li>
                <li><strong>Site:</strong> creditosvibe.com.br (Procure por "Fale com o Vibe!")</li>
                <li><strong>Instagram:</strong> @minhamelhorvibe</li>
            </ul>
            
            <p><strong>✅ Resumo do Clube Velotax:</strong></p>
            <ul>
                <li><strong>Preço:</strong> R$ 19,90/mês</li>
                <li><strong>Crédito Inicial:</strong> R$ 100,00 em créditos Vibe</li>
                <li><strong>Benefícios:</strong> Cupons de desconto, sorteios exclusivos, rede nacional</li>
                <li><strong>Contratação:</strong> 100% online pelo App Velotax</li>
                <li><strong>Cancelamento:</strong> Sem multas, pode cancelar quando quiser</li>
            </ul>
            
            <p><strong>💡 Dica:</strong></p>
            <p>Velotax & Vibe: Sua melhor escolha, sua melhor economia.</p>
        `
    };
    
    let explicacao = explicacoes[tema] || '<p>Explicação não disponível para este tema.</p>';
    
    if (contexto.trim()) {
        explicacao = explicacao.replace('<p><strong>Prezado(a) cliente,</strong></p>', 
            `<p><strong>Prezado(a) cliente,</strong></p><p><strong>Contexto:</strong> ${contexto}</p>`);
    }
    
    return explicacao;
}

// Endpoint para gerar explicações com respostas fixas do sistema
app.post('/api/generate-explanation', async (req, res) => {
    try {
        const { tema } = req.body;
        
        if (!tema) {
            return res.status(400).json({
                success: false,
                error: 'Tema não fornecido'
            });
        }
        
        // Gerar explicação usando as respostas fixas do sistema
        const explicacao = gerarMensagemExplicativa(tema, '');
        
        // Incrementar estatística global
        await incrementarEstatisticaGlobal('explicacoes_geradas');

        res.json({
            success: true,
            result: explicacao,
            baseadaEmFeedbacks: false,
            totalFeedbacks: 0
        });
        
    } catch (error) {
        console.error('Erro ao gerar explicação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// ===== ENDPOINTS PARA VERIFICAÇÃO DE FEEDBACKS =====

// Endpoint para verificar feedbacks duplicados
app.get('/api/verificacao/duplicados', (req, res) => {
    try {
        const duplicados = verificarFeedbacksDuplicados();
        res.json({
            success: true,
            duplicados: duplicados,
            total: duplicados.length
        });
    } catch (error) {
        console.error('Erro ao verificar duplicados:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para validar qualidade dos feedbacks
app.get('/api/verificacao/qualidade', (req, res) => {
    try {
        const relatorio = validarQualidadeFeedbacks();
        res.json({
            success: true,
            relatorio: relatorio
        });
    } catch (error) {
        console.error('Erro ao validar qualidade:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para pontuar feedbacks
app.get('/api/verificacao/pontuacao', (req, res) => {
    try {
        const feedbacksPontuados = pontuarFeedbacks();
        res.json({
            success: true,
            feedbacks: feedbacksPontuados,
            total: feedbacksPontuados.length
        });
    } catch (error) {
        console.error('Erro ao pontuar feedbacks:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para detectar padrões
app.get('/api/verificacao/padroes', (req, res) => {
    try {
        const padroes = detectarPadroesFeedback();
        res.json({
            success: true,
            padroes: padroes
        });
    } catch (error) {
        console.error('Erro ao detectar padrões:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para executar verificação completa
app.get('/api/verificacao/completa', (req, res) => {
    try {
        const resultados = executarVerificacaoCompletaFeedbacks();
        res.json({
            success: true,
            resultados: resultados
        });
    } catch (error) {
        console.error('Erro ao executar verificação completa:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// ===== ENDPOINTS DE MONITORAMENTO E DIAGNÓSTICO =====

// Endpoint para status de saúde do Google Sheets
app.get('/api/google-sheets/health', async (req, res) => {
    try {
        if (!googleSheetsDiagnostics) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de diagnóstico não inicializado'
            });
        }
        
        const healthReport = googleSheetsDiagnostics.getHealthReport();
        res.json({
            success: true,
            data: healthReport
        });
    } catch (error) {
        console.error('Erro ao obter status de saúde:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para diagnóstico completo
app.get('/api/google-sheets/diagnostic', async (req, res) => {
    try {
        if (!googleSheetsDiagnostics) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de diagnóstico não inicializado'
            });
        }
        
        const diagnostic = await googleSheetsDiagnostics.runFullDiagnostic();
        res.json({
            success: true,
            data: diagnostic
        });
    } catch (error) {
        console.error('Erro ao executar diagnóstico:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para status da fila
app.get('/api/google-sheets/queue-status', async (req, res) => {
    try {
        if (!googleSheetsQueueRobust) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de fila não inicializado'
            });
        }
        
        const queueStatus = googleSheetsQueueRobust.getQueueStatus();
        res.json({
            success: true,
            data: queueStatus
        });
    } catch (error) {
        console.error('Erro ao obter status da fila:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para forçar recuperação
app.post('/api/google-sheets/force-recovery', async (req, res) => {
    try {
        if (!googleSheetsDiagnostics) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de diagnóstico não inicializado'
            });
        }
        
        const recovery = await googleSheetsDiagnostics.forceRecovery();
        res.json({
            success: recovery.success,
            data: recovery
        });
    } catch (error) {
        console.error('Erro ao forçar recuperação:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para teste de escrita
app.post('/api/google-sheets/test-write', async (req, res) => {
    try {
        if (!googleSheetsDiagnostics) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de diagnóstico não inicializado'
            });
        }
        
        const testResult = await googleSheetsDiagnostics.testWriteOperation();
        res.json({
            success: testResult.success,
            data: testResult
        });
    } catch (error) {
        console.error('Erro ao testar escrita:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// Endpoint para teste de leitura
app.post('/api/google-sheets/test-read', async (req, res) => {
    try {
        if (!googleSheetsDiagnostics) {
            return res.status(503).json({
                success: false,
                error: 'Sistema de diagnóstico não inicializado'
            });
        }
        
        const testResult = await googleSheetsDiagnostics.testReadOperation();
        res.json({
            success: testResult.success,
            data: testResult
        });
    } catch (error) {
        console.error('Erro ao testar leitura:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====

// Inicializar Google Sheets se habilitado
async function initializeGoogleSheets(envVars = null) {
    try {
        if (!envVars) {
            envVars = loadEnvFile();
        }
        
        console.log('🔍 DEBUG - Verificando configuração do Google Sheets:', {
            ENABLE_GOOGLE_SHEETS: envVars.ENABLE_GOOGLE_SHEETS,
            GOOGLE_SHEETS_ID: envVars.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_SERVICE_ACCOUNT_EMAIL: envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_PRIVATE_KEY: envVars.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
        });
        
        // Na Vercel, sempre tentar inicializar Google Sheets se as credenciais estiverem disponíveis
        if (envVars.ENABLE_GOOGLE_SHEETS === 'true' || (process.env.VERCEL && envVars.GOOGLE_SHEETS_ID && envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL)) {
            console.log('🔧 Inicializando integração com Google Sheets...');
            // Forçar ativação na Vercel se não estiver configurado
            if (process.env.VERCEL && !envVars.ENABLE_GOOGLE_SHEETS) {
                envVars.ENABLE_GOOGLE_SHEETS = 'true';
                console.log('🔧 ENABLE_GOOGLE_SHEETS forçado como true na Vercel');
            }
            
            const success = await googleSheetsIntegration.initialize(envVars);
            if (success) {
                console.log('✅ Google Sheets integrado com sucesso');
                // Garantir que a instância global esteja disponível
                global.googleSheetsIntegration = googleSheetsIntegration;
                
                // Inicializar sistemas de monitoramento
                console.log('🔧 Inicializando sistemas de monitoramento...');
                googleSheetsMonitor = new GoogleSheetsMonitor(googleSheetsIntegration);
                googleSheetsQueueRobust = new GoogleSheetsQueueRobust(googleSheetsIntegration, googleSheetsMonitor);
                googleSheetsDiagnostics = new GoogleSheetsDiagnostics(googleSheetsIntegration, googleSheetsMonitor, googleSheetsQueueRobust);
                
                // Iniciar monitoramento
                googleSheetsMonitor.startMonitoring();
                console.log('✅ Sistemas de monitoramento inicializados');
                
            } else {
                console.log('⚠️ Google Sheets não pôde ser inicializado');
            }
        } else {
            console.log('📊 Google Sheets desabilitado via configuração');
        }
    } catch (error) {
        console.error('❌ Erro ao inicializar Google Sheets:', error.message);
        console.log('📊 Sistema funcionando sem Google Sheets');
    }
}

// ===== ENDPOINT PARA VERIFICAR STATUS DA FILA DO GOOGLE SHEETS =====
app.get('/api/google-sheets-queue-status', (req, res) => {
    try {
        const queueStatus = googleSheetsQueue.getStatus();
        const envVars = loadEnvFile();
        
        const integrationStatus = {
            googleSheetsActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            queueStatus: queueStatus,
            config: {
                ENABLE_GOOGLE_SHEETS: envVars.ENABLE_GOOGLE_SHEETS,
                GOOGLE_SHEETS_ID: envVars.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                GOOGLE_SERVICE_ACCOUNT_EMAIL: envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                GOOGLE_PRIVATE_KEY: envVars.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
            }
        };
        
        res.json({
            success: true,
            message: 'Status da fila do Google Sheets',
            data: integrationStatus
        });
    } catch (error) {
        console.error('Erro ao verificar status da fila:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== ENDPOINT PARA FORÇAR INICIALIZAÇÃO DO GOOGLE SHEETS =====
app.post('/api/force-initialize-google-sheets', async (req, res) => {
    try {
        console.log('🔄 Forçando inicialização do Google Sheets...');
        
        const envVars = loadEnvFile();
        
        // Forçar ENABLE_GOOGLE_SHEETS como true se não estiver configurado
        if (!envVars.ENABLE_GOOGLE_SHEETS) {
            envVars.ENABLE_GOOGLE_SHEETS = 'true';
            console.log('🔧 ENABLE_GOOGLE_SHEETS definido como true');
        }
        
        // Tentar inicializar
        const success = await googleSheetsIntegration.initialize(envVars);
        
        if (success) {
            global.googleSheetsInitialized = true;
            console.log('✅ Google Sheets inicializado com sucesso');
            
            res.json({
                success: true,
                message: 'Google Sheets inicializado com sucesso',
                data: {
                    googleSheetsActive: googleSheetsIntegration.isActive(),
                    initialized: true
                }
            });
        } else {
            console.log('❌ Falha ao inicializar Google Sheets');
            res.json({
                success: false,
                message: 'Falha ao inicializar Google Sheets',
                data: {
                    googleSheetsActive: false,
                    initialized: false
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao forçar inicialização:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(PORT, async () => {
    console.log('🚀 Servidor Velotax Bot iniciado!');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('🔐 Sistema de segurança ativo');
    console.log('📁 Arquivo .env carregado da raiz do projeto');
    
    console.log('🧠 Sistema de aprendizado baseado em feedback ativo');
    console.log('🔍 Sistema de verificação automática de feedbacks ativo');
    console.log('✅ Integração de feedbacks_respostas.json como base de conhecimento ativa');
    console.log('📅 Formatação de datas em padrão brasileiro (DD/MM/AAAA HH:MM:SS) ativa');
    console.log('🔄 Deploy atualizado em: ' + new Date().toISOString());
    console.log('🔧 Versão: 2.1.0 - Correção de sintaxe aplicada');
    
    // Inicializar memória do aprendizado
    await inicializarMemoriaAprendizado();
    
    // Verificar se arquivo .env existe
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        console.log('✅ Arquivo .env encontrado na raiz');
    } else {
        console.warn('⚠️ Arquivo .env não encontrado na raiz');
    }
    
    // Inicializar Google Sheets (sem bloquear o servidor)
    console.log('🔧 Inicializando Google Sheets...');
    setTimeout(async () => {
        try {
            await initializeGoogleSheets();
            global.googleSheetsInitialized = true;
            
            // Na Vercel, verificar se inicializou corretamente
            if (process.env.VERCEL) {
                console.log('🌐 Vercel detectada - verificando status do Google Sheets...');
                if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
                    console.log('✅ Google Sheets ativo na Vercel - pronto para receber dados');
                } else {
                    console.log('⚠️ Google Sheets não está ativo na Vercel');
                }
            }
        } catch (error) {
            console.error('❌ Erro ao inicializar Google Sheets:', error.message);
            console.log('📊 Sistema funcionando sem Google Sheets');
        }
    }, 1000);
});

// Graceful shutdown
// Endpoint para verificar todo o aprendizado
app.get('/api/aprendizado-completo', async (req, res) => {
    try {
        const aprendizado = await loadAprendizadoScript();
        res.json({
            success: true,
            aprendizado: aprendizado,
            resumo: {
                totalTipos: Object.keys(aprendizado.tiposSituacao || {}).length,
                tiposDisponiveis: Object.keys(aprendizado.tiposSituacao || {}),
                lastUpdated: aprendizado.lastUpdated
            }
        });
    } catch (error) {
        console.error('Erro ao carregar aprendizado completo:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para verificar configurações de ambiente (debug)
app.get('/api/debug-env', (req, res) => {
    try {
        const envVars = loadEnvFile();
        res.json({
            success: true,
            ambiente: {
                nodeEnv: process.env.NODE_ENV,
                vercel: !!process.env.VERCEL,
                port: process.env.PORT
            },
            configuracoes: {
                googleClientId: envVars.GOOGLE_CLIENT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                dominioPermitido: envVars.DOMINIO_PERMITIDO || 'NÃO CONFIGURADO',
                openaiApiKey: envVars.OPENAI_API_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                googleSheetsId: envVars.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                enableGoogleSheets: envVars.ENABLE_GOOGLE_SHEETS
            },
            variaveisProcessEnv: {
                googleClientId: process.env.GOOGLE_CLIENT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
                dominioPermitido: process.env.DOMINIO_PERMITIDO || 'NÃO CONFIGURADO',
                openaiApiKey: process.env.OPENAI_API_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
            }
        });
    } catch (error) {
        console.error('Erro ao verificar configurações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para forçar inicialização do Google Sheets
app.post('/api/force-initialize-google-sheets', async (req, res) => {
    console.log('🎯 Endpoint /api/force-initialize-google-sheets chamado');
    try {
        console.log('🔄 Forçando inicialização do Google Sheets...');
        
        // Tentar inicializar usando o sistema de fallback
        const success = await googleSheetsIntegration.initialize();
        
        if (success) {
            console.log('✅ Google Sheets inicializado com sucesso!');
            return res.json({
                success: true,
                message: 'Google Sheets inicializado com sucesso',
                timestamp: new Date().toISOString(),
                method: googleSheetsFallback ? googleSheetsFallback.getMethod() : 'unknown'
            });
        } else {
            console.log('⚠️ Google Sheets não pôde ser inicializado');
            return res.json({
                success: false,
                message: 'Google Sheets não pôde ser inicializado',
                timestamp: new Date().toISOString(),
                diagnostic: googleSheetsFallback ? googleSheetsFallback.getDiagnosticInfo() : null
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao forçar inicialização do Google Sheets:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para verificar status do Google Sheets
app.get('/api/debug-google-sheets', async (req, res) => {
    try {
        const envVars = loadEnvFile();
        
        // Verificar configurações
        const configStatus = {
            googleSheetsId: envVars.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            enableGoogleSheets: envVars.ENABLE_GOOGLE_SHEETS,
            serviceAccountEmail: envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            privateKey: envVars.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            projectId: envVars.GOOGLE_PROJECT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
        };
        
        // Verificar status da integração
        const integrationStatus = {
            googleSheetsInitialized: global.googleSheetsInitialized || false,
            googleSheetsIntegrationActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            googleSheetsConfigInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
        };
        
        // Tentar inicializar se não estiver inicializado
        if (!global.googleSheetsInitialized) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            await initializeGoogleSheets(envVars);
            global.googleSheetsInitialized = true;
            
            // Verificar novamente após inicialização
            integrationStatus.googleSheetsInitialized = global.googleSheetsInitialized;
            integrationStatus.googleSheetsIntegrationActive = googleSheetsIntegration ? googleSheetsIntegration.isActive() : false;
            integrationStatus.googleSheetsConfigInitialized = googleSheetsConfig ? googleSheetsConfig.isInitialized() : false;
        }
        
        res.json({
            success: true,
            configStatus: configStatus,
            integrationStatus: integrationStatus,
            timestamp: new Date().toISOString(),
            recommendations: getGoogleSheetsRecommendations(configStatus, integrationStatus)
        });
        
    } catch (error) {
        console.error('Erro ao verificar Google Sheets:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para testar o sistema de aprendizado
app.get('/api/debug-aprendizado', async (req, res) => {
    try {
        const aprendizado = await loadAprendizadoScript();
        
        // Verificar estrutura do aprendizado
        const estruturaAprendizado = {
            existe: !!aprendizado,
            temTiposSituacao: !!aprendizado?.tiposSituacao,
            totalTipos: Object.keys(aprendizado?.tiposSituacao || {}).length,
            tiposDisponiveis: Object.keys(aprendizado?.tiposSituacao || {}),
            lastUpdated: aprendizado?.lastUpdated
        };
        
        // Verificar cada tipo de situação
        const detalhesTipos = {};
        if (aprendizado?.tiposSituacao) {
            for (const [tipo, dados] of Object.entries(aprendizado.tiposSituacao)) {
                detalhesTipos[tipo] = {
                    feedbacks: dados.feedbacks?.length || 0,
                    respostasCoerentes: dados.respostasCoerentes?.length || 0,
                    padroesIdentificados: dados.padroesIdentificados?.length || 0,
                    clausulasUsadas: dados.clausulasUsadas?.length || 0,
                    ultimoFeedback: dados.feedbacks?.[dados.feedbacks.length - 1]?.timestamp || 'N/A',
                    ultimaRespostaCoerente: dados.respostasCoerentes?.[dados.respostasCoerentes.length - 1]?.timestamp || 'N/A'
                };
            }
        }
        
        // Verificar memória
        const statusMemoria = {
            aprendizadoScriptMemoria: !!aprendizadoScriptMemoria,
            modelosRespostasMemoria: !!modelosRespostasMemoria,
            feedbacksRespostasMemoria: !!feedbacksRespostasMemoria
        };
        
        res.json({
            success: true,
            estruturaAprendizado: estruturaAprendizado,
            detalhesTipos: detalhesTipos,
            statusMemoria: statusMemoria,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Erro ao verificar aprendizado:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Endpoint para testar registro direto no Google Sheets
app.post('/api/test-google-sheets', async (req, res) => {
    try {
        console.log('🧪 Testando registro direto no Google Sheets...');
        
        // Verificar se Google Sheets está ativo
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(400).json({
                success: false,
                error: 'Google Sheets não está ativo',
                details: {
                    googleSheetsIntegration: !!googleSheetsIntegration,
                    isActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false
                }
            });
        }
        
        // Dados de teste
        const testData = {
            id: Date.now(),
            tipo: 'teste',
            tipoSituacao: 'Teste Manual',
            textoCliente: 'Teste de registro na planilha',
            respostaAprovada: 'Esta é uma resposta de teste para verificar se o registro está funcionando',
            motivoSolicitacao: 'Teste de integração',
            timestamp: new Date().toISOString(),
            userProfile: 'Teste Manual (teste@velotax.com.br)',
            userName: 'Teste Manual',
            userEmail: 'teste@velotax.com.br'
        };
        
        console.log('📝 Dados de teste:', testData);
        
        // Tentar registrar feedback
        try {
            const resultado = await googleSheetsIntegration.registrarFeedback(testData);
            console.log('📝 Resultado do feedback:', resultado);
        } catch (error) {
            console.error('❌ Erro no feedback:', error.message);
        }
        
        // Tentar registrar resposta coerente
        try {
            const resultado = await googleSheetsQueue.addToQueue({ type: 'resposta_coerente', data: testData });
            console.log('📝 Resultado da resposta:', resultado);
        } catch (error) {
            console.error('❌ Erro na resposta:', error.message);
        }
        
        res.json({
            success: true,
            message: 'Teste de registro concluído',
            results: {
                feedback: feedbackResult,
                resposta: respostaResult
            },
            testData: testData
        });
        
    } catch (error) {
        console.error('❌ Erro no teste do Google Sheets:', error);
        res.status(500).json({
            success: false,
            error: 'Erro no teste do Google Sheets',
            message: error.message,
            stack: error.stack
        });
    }
});

// Endpoint para forçar refresh dos dados do Google Sheets
app.post('/api/refresh-google-sheets', async (req, res) => {
    try {
        console.log('🔄 Forçando refresh dos dados do Google Sheets...');
        
        const { dataType = 'all' } = req.body;
        
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(400).json({
                success: false,
                message: 'Google Sheets não está ativo'
            });
        }
        
        // Forçar refresh dos dados
        const result = await googleSheetsIntegration.forceRefreshData(dataType);
        
        res.json({
            success: true,
            message: `Dados ${dataType} atualizados com sucesso`,
            dataType: dataType,
            result: result
        });
        
    } catch (error) {
        console.error('❌ Erro ao forçar refresh:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao forçar refresh dos dados',
            error: error.message
        });
    }
});

// Endpoint para testar carregamento de dados da planilha
app.post('/api/test-planilha-aprendizado', async (req, res) => {
    try {
        console.log('🧪 Testando carregamento de dados da planilha...');
        
        const { tipoSolicitacao = 'exclusao-chave-pix-cpf' } = req.body;
        
        // Verificar e inicializar Google Sheets se necessário
        console.log('🔍 DEBUG - Verificando status do Google Sheets...');
        console.log('🔍 DEBUG - googleSheetsIntegration existe:', !!googleSheetsIntegration);
        console.log('🔍 DEBUG - Google Sheets ativo:', googleSheetsIntegration ? googleSheetsIntegration.isActive() : false);
        
        // Tentar inicializar Google Sheets se não estiver ativo
        if (googleSheetsIntegration && !googleSheetsIntegration.isActive()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await googleSheetsIntegration.initialize(envVars);
                console.log('✅ Google Sheets inicializado com sucesso');
            } catch (error) {
                console.error('❌ Erro ao inicializar Google Sheets:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Erro ao inicializar Google Sheets',
                    error: error.message
                });
            }
        }
        
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.status(400).json({
                success: false,
                message: 'Google Sheets não está ativo após tentativa de inicialização'
            });
        }
        
        console.log('🔍 DEBUG - Testando com tipo:', tipoSolicitacao);
        
        // Forçar refresh do cache
        await googleSheetsIntegration.forceRefreshData('all');
        
        // Carregar modelos
        const modelos = await carregarModelosCoerentesDaPlanilha(tipoSolicitacao);
        console.log('🔍 DEBUG - Modelos carregados:', modelos.length);
        
        // Carregar feedbacks
        const feedbacks = await carregarFeedbacksRelevantesDaPlanilha(tipoSolicitacao);
        console.log('🔍 DEBUG - Feedbacks carregados:', feedbacks.length);
        
        res.json({
            success: true,
            message: 'Teste de carregamento concluído',
            tipoSolicitacao: tipoSolicitacao,
            resultados: {
                modelos: {
                    total: modelos.length,
                    dados: modelos.map(m => ({
                        id: m.ID || m.id,
                        tipo: m['Tipo Solicitação'] || m.tipo_situacao,
                        motivo: m['Motivo Solicitação'] || m.motivo_solicitacao,
                        resposta: m['Resposta Aprovada'] || m.respostaAprovada?.substring(0, 100) + '...'
                    }))
                },
                feedbacks: {
                    total: feedbacks.length,
                    dados: feedbacks.map(f => ({
                        id: f.ID || f.id,
                        tipo: f['Tipo Solicitação'] || f.tipoSituacao,
                        feedback: f.Feedback || f.feedback?.substring(0, 100) + '...'
                    }))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Erro no teste da planilha:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro no teste da planilha',
            error: error.message
        });
    }
});

// Endpoint simples para testar se o Google Sheets está configurado
app.get('/api/test-sheets-simple', async (req, res) => {
    try {
        console.log('🧪 Teste simples do Google Sheets...');
        
        // Verificar variáveis de ambiente diretamente do process.env
        const envStatus = {
            NODE_ENV: process.env.NODE_ENV || 'NÃO CONFIGURADO',
            VERCEL: process.env.VERCEL ? 'SIM' : 'NÃO',
            GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            ENABLE_GOOGLE_SHEETS: process.env.ENABLE_GOOGLE_SHEETS || 'NÃO CONFIGURADO',
            GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
        };
        
        // Verificar status da integração
        const integrationStatus = {
            googleSheetsIntegration: !!googleSheetsIntegration,
            isActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
            googleSheetsConfig: !!googleSheetsConfig,
            isInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
        };
        
        // Tentar adicionar uma linha de teste se estiver ativo
        let testeEscrita = null;
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                console.log('✍️ Tentando adicionar linha de teste...');
                const linhaTeste = [
                    new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    'TESTE-' + Date.now(),
                    'teste',
                    'Teste de integração',
                    'Esta é uma linha de teste para verificar se a escrita está funcionando',
                    'teste',
                    'teste de integração',
                    '',
                    '',
                    '',
                    'Teste'
                ];
                await googleSheetsConfig.appendRow('Respostas Coerentes!A:Z', linhaTeste);
                console.log('✅ Linha de teste adicionada com sucesso');
                testeEscrita = { success: true, linha: linhaTeste };
            } catch (error) {
                console.error('❌ Erro ao adicionar linha de teste:', error.message);
                testeEscrita = { error: error.message };
            }
        }
        
        res.json({
            success: true,
            message: 'Teste simples concluído',
            envStatus: envStatus,
            integrationStatus: integrationStatus,
            globalStatus: {
                googleSheetsInitialized: global.googleSheetsInitialized || false
            },
            testeEscrita: testeEscrita,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro no teste simples:', error);
        res.status(500).json({
            success: false,
            error: 'Erro no teste simples',
            message: error.message,
            stack: error.stack
        });
    }
});

// Endpoint para sincronizar dados do localStorage com o servidor
app.post('/api/sync-local-data', async (req, res) => {
    try {
        const { modelosRespostas, aprendizadoScript } = req.body;
        
        console.log('🔄 Sincronizando dados do localStorage com o servidor...');
        
        let totalSincronizados = 0;
        
        // Sincronizar modelos de respostas
        if (modelosRespostas && Array.isArray(modelosRespostas)) {
            const modelosAtuais = await loadModelosRespostas();
            const novosModelos = [];
            
            for (const modeloLocal of modelosRespostas) {
                // Verificar se o modelo já existe (por ID ou timestamp)
                const existe = modelosAtuais.modelos.some(m => 
                    m.id === modeloLocal.id || 
                    (m.timestamp === modeloLocal.timestamp && m.tipo_situacao === modeloLocal.tipo_situacao)
                );
                
                if (!existe) {
                    novosModelos.push(modeloLocal);
                    totalSincronizados++;
                }
            }
            
            if (novosModelos.length > 0) {
                modelosAtuais.modelos.push(...novosModelos);
                await saveModelosRespostas(modelosAtuais);
                console.log(`✅ ${novosModelos.length} novos modelos sincronizados`);
            }
        }
        
        // Sincronizar aprendizado do script
        if (aprendizadoScript && aprendizadoScript.tiposSituacao) {
            const aprendizadoAtual = await loadAprendizadoScript();
            let aprendizadoAtualizado = false;
            
            for (const [tipoSituacao, dados] of Object.entries(aprendizadoScript.tiposSituacao)) {
                if (!aprendizadoAtual.tiposSituacao[tipoSituacao]) {
                    aprendizadoAtual.tiposSituacao[tipoSituacao] = {
                        feedbacks: [],
                        respostasCoerentes: [],
                        padroesIdentificados: [],
                        clausulasUsadas: []
                    };
                }
                
                // Sincronizar respostas coerentes
                if (dados.respostasCoerentes && Array.isArray(dados.respostasCoerentes)) {
                    for (const respostaLocal of dados.respostasCoerentes) {
                        const existe = aprendizadoAtual.tiposSituacao[tipoSituacao].respostasCoerentes.some(r => 
                            r.id === respostaLocal.id || 
                            (r.timestamp === respostaLocal.timestamp && r.motivoSolicitacao === respostaLocal.motivoSolicitacao)
                        );
                        
                        if (!existe) {
                            aprendizadoAtual.tiposSituacao[tipoSituacao].respostasCoerentes.push(respostaLocal);
                            aprendizadoAtualizado = true;
                            totalSincronizados++;
                        }
                    }
                }
            }
            
            if (aprendizadoAtualizado) {
                await saveAprendizadoScript(aprendizadoAtual);
                console.log('✅ Aprendizado sincronizado');
            }
        }
        
        res.json({
            success: true,
            message: `Sincronização concluída! ${totalSincronizados} itens sincronizados.`,
            totalSincronizados: totalSincronizados
        });
        
    } catch (error) {
        console.error('❌ Erro na sincronização:', error);
        res.status(500).json({
            success: false,
            error: 'Erro na sincronização',
            message: error.message
        });
    }
});

// Endpoint para verificar dados salvos na memória do servidor
app.get('/api/check-memory-data', async (req, res) => {
    try {
        console.log('🔍 Verificando dados na memória do servidor...');
        
        const memoriaStatus = {
            modelosRespostasMemoria: {
                temDados: !!modelosRespostasMemoria,
                totalModelos: modelosRespostasMemoria?.modelos?.length || 0,
                ultimaAtualizacao: modelosRespostasMemoria?.lastUpdated || 'N/A'
            },
            aprendizadoScriptMemoria: {
                temDados: !!aprendizadoScriptMemoria,
                totalTipos: Object.keys(aprendizadoScriptMemoria?.tiposSituacao || {}).length,
                ultimaAtualizacao: aprendizadoScriptMemoria?.lastUpdated || 'N/A'
            },
            ambiente: process.env.VERCEL ? 'Vercel (memória)' : 'Local (arquivo)'
        };
        
        // Mostrar alguns exemplos dos dados
        const exemplos = {
            modelosRecentes: modelosRespostasMemoria?.modelos?.slice(-3).map(m => ({
                id: m.id,
                tipo_situacao: m.tipo_situacao,
                timestamp: m.timestamp
            })) || [],
            tiposAprendizado: Object.keys(aprendizadoScriptMemoria?.tiposSituacao || {}).slice(0, 5)
        };
        
        res.json({
            success: true,
            message: 'Dados da memória do servidor',
            memoriaStatus: memoriaStatus,
            exemplos: exemplos,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao verificar dados da memória:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao verificar dados da memória',
            message: error.message
        });
    }
});

// Endpoint para sincronizar dados da Vercel com arquivos JSON locais
app.post('/api/sync-vercel-to-local', async (req, res) => {
    try {
        console.log('🔄 Sincronizando dados da Vercel para arquivos JSON locais...');
        
        const { modeloResposta, aprendizadoScript } = req.body;
        
        if (!modeloResposta && !aprendizadoScript) {
            return res.status(400).json({
                success: false,
                error: 'Dados não fornecidos',
                message: 'É necessário fornecer modeloResposta ou aprendizadoScript'
            });
        }
        
        let resultados = {
            modeloResposta: { sucesso: false, message: 'Não fornecido' },
            aprendizadoScript: { sucesso: false, message: 'Não fornecido' }
        };
        
        // Sincronizar modelo de resposta
        if (modeloResposta) {
            try {
                console.log('📝 Sincronizando modelo de resposta...');
                
                // Carregar dados existentes
                const dadosExistentes = await loadModelosRespostas();
                
                // Verificar se já existe (evitar duplicatas)
                const jaExiste = dadosExistentes.modelos.some(existente => existente.id === modeloResposta.id);
                
                if (!jaExiste) {
                    dadosExistentes.modelos.push(modeloResposta);
                    dadosExistentes.lastUpdated = obterTimestampBrasil();
                    
                    // Forçar salvamento em arquivo (ignorar detecção de ambiente)
                    const originalNodeEnv = process.env.NODE_ENV;
                    const originalVercel = process.env.VERCEL;
                    
                    process.env.NODE_ENV = 'development';
                    delete process.env.VERCEL;
                    
                    await saveModelosRespostas(dadosExistentes);
                    
                    // Restaurar variáveis de ambiente
                    process.env.NODE_ENV = originalNodeEnv;
                    if (originalVercel) process.env.VERCEL = originalVercel;
                    
                    resultados.modeloResposta = {
                        sucesso: true,
                        message: 'Modelo adicionado aos arquivos JSON locais',
                        id: modeloResposta.id
                    };
                    
                    console.log(`✅ Modelo ${modeloResposta.id} sincronizado com arquivos locais`);
                } else {
                    resultados.modeloResposta = {
                        sucesso: true,
                        message: 'Modelo já existe nos arquivos locais',
                        id: modeloResposta.id
                    };
                    console.log(`ℹ️ Modelo ${modeloResposta.id} já existe nos arquivos locais`);
                }
            } catch (error) {
                console.error('❌ Erro ao sincronizar modelo:', error);
                resultados.modeloResposta = {
                    sucesso: false,
                    message: `Erro: ${error.message}`
                };
            }
        }
        
        // Sincronizar aprendizado do script
        if (aprendizadoScript) {
            try {
                console.log('🧠 Sincronizando aprendizado do script...');
                
                // Carregar dados existentes
                const dadosExistentes = loadAprendizadoScript();
                
                // Mesclar dados
                const dadosMesclados = {
                    ...dadosExistentes,
                    ...aprendizadoScript,
                    lastUpdated: obterTimestampBrasil()
                };
                
                // Forçar salvamento em arquivo (ignorar detecção de ambiente)
                const originalNodeEnv = process.env.NODE_ENV;
                const originalVercel = process.env.VERCEL;
                
                process.env.NODE_ENV = 'development';
                delete process.env.VERCEL;
                
                saveAprendizadoScript(dadosMesclados);
                
                // Restaurar variáveis de ambiente
                process.env.NODE_ENV = originalNodeEnv;
                if (originalVercel) process.env.VERCEL = originalVercel;
                
                resultados.aprendizadoScript = {
                    sucesso: true,
                    message: 'Aprendizado sincronizado com arquivos JSON locais'
                };
                
                console.log('✅ Aprendizado sincronizado com arquivos locais');
            } catch (error) {
                console.error('❌ Erro ao sincronizar aprendizado:', error);
                resultados.aprendizadoScript = {
                    sucesso: false,
                    message: `Erro: ${error.message}`
                };
            }
        }
        
        console.log('📊 Resultado da sincronização:', resultados);
        
        res.json({
            success: true,
            message: 'Sincronização concluída',
            resultados: resultados,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro na sincronização:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: 'Não foi possível sincronizar os dados'
        });
    }
});

// Endpoint para testar salvamento de resposta coerente
app.get('/api/test-save-coerente', async (req, res) => {
    try {
        console.log('🧪 Testando salvamento de resposta coerente...');
        
        // Dados de teste
        const dadosTeste = {
            tipo_solicitacao: 'Teste Sistema',
            motivo_solicitacao: 'Verificar se salvamento funciona',
            solucao_implementada: 'Teste de salvamento',
            texto_cliente: 'Cliente teste',
            historico_atendimento: 'Histórico teste',
            observacoes_internas: 'Observações teste'
        };
        
        const respostaTeste = 'Esta é uma resposta de teste para verificar se o sistema de aprendizado está funcionando corretamente.';
        
        // Tentar salvar
        const modelo = await addModeloResposta(dadosTeste, respostaTeste, { nome: 'Teste', email: 'teste@teste.com' });
        
        res.json({
            success: true,
            message: 'Teste de salvamento realizado com sucesso',
            modeloId: modelo.id,
            ambiente: process.env.VERCEL ? 'Vercel (memória)' : 'Local (arquivo)',
            googleSheetsAtivo: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false
        });
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
        res.status(500).json({
            success: false,
            error: 'Erro no teste de salvamento',
            message: error.message
        });
    }
});

// Endpoint ainda mais simples para testar
app.get('/api/test-basic', (req, res) => {
    res.json({
        success: true,
        message: 'Endpoint básico funcionando',
        timestamp: new Date().toISOString(),
        env: {
            NODE_ENV: process.env.NODE_ENV,
            VERCEL: process.env.VERCEL,
            GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            ENABLE_GOOGLE_SHEETS: process.env.ENABLE_GOOGLE_SHEETS
        }
    });
});

// Endpoint simples para testar se o servidor está funcionando
app.get('/api/test-server', (req, res) => {
    res.json({
        success: true,
        message: 'Servidor funcionando!',
        timestamp: new Date().toISOString(),
        env: {
            NODE_ENV: process.env.NODE_ENV,
            ENABLE_GOOGLE_SHEETS: process.env.ENABLE_GOOGLE_SHEETS
        }
    });
});

// Endpoint para testar registro direto no Google Sheets
app.get('/api/test-sheets-register', async (req, res) => {
    try {
        console.log('🧪 Testando registro direto no Google Sheets...');
        
        // Verificar variáveis de ambiente
        const envVars = {
            GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            ENABLE_GOOGLE_SHEETS: process.env.ENABLE_GOOGLE_SHEETS,
            GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
            GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
        };
        
        // Verificar se Google Sheets está ativo
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            return res.json({
                success: false,
                error: 'Google Sheets não está ativo',
                details: {
                    googleSheetsIntegration: !!googleSheetsIntegration,
                    isActive: googleSheetsIntegration ? googleSheetsIntegration.isActive() : false,
                    envVars: envVars
                }
            });
        }
        
        // Dados de teste
        const testData = {
            id: Date.now(),
            tipo: 'teste',
            tipoSituacao: 'Teste Manual',
            textoCliente: 'Teste de registro na planilha',
            respostaAprovada: 'Esta é uma resposta de teste para verificar se o registro está funcionando',
            motivoSolicitacao: 'Teste de integração',
            timestamp: new Date().toISOString(),
            userProfile: 'Teste Manual (teste@velotax.com.br)',
            userName: 'Teste Manual',
            userEmail: 'teste@velotax.com.br'
        };
        
        console.log('📝 Dados de teste:', testData);
        
        // Tentar registrar resposta coerente
        let resultado = null;
        try {
            resultado = await googleSheetsQueue.addToQueue({ type: 'resposta_coerente', data: testData }, true);
            console.log('📝 Resultado da resposta:', resultado);
        } catch (error) {
            console.error('❌ Erro na resposta:', error.message);
            resultado = { error: error.message };
        }
        
        res.json({
            success: true,
            message: 'Teste de registro concluído',
            result: resultado,
            testData: testData,
            envVars: envVars,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro no teste do Google Sheets:', error);
        res.json({
            success: false,
            error: 'Erro no teste do Google Sheets',
            message: error.message,
            stack: error.stack
        });
    }
});

// ==========================================
// FASE 4 - ENDPOINTS DE ESTATÍSTICAS E AUDITORIA
// ==========================================

/**
 * Endpoint para obter estatísticas globais
 * GET /api/estatisticas/globais?periodo=hoje|7dias|30dias|custom&dataInicio=DD/MM/YYYY&dataFim=DD/MM/YYYY
 */
app.get('/api/estatisticas/globais', async (req, res) => {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const { periodo, dataInicio, dataFim } = req.query;
        
        // Ler dados das planilhas
        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');
        const moderacoesData = await googleSheetsConfig.readData('Moderações!A1:Z1000');

        // Processar dados
        const hoje = new Date();
        const processarData = (dataStr) => {
            if (!dataStr) return null;
            try {
                const partes = dataStr.split(' ')[0].split('/');
                if (partes.length === 3) {
                    return new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
                }
            } catch (e) {}
            return null;
        };

        const filtrarPorPeriodo = (dataRegistro) => {
            if (!dataRegistro) return false;
            const data = processarData(dataRegistro);
            if (!data) return false;

            const diasDiff = (hoje - data) / (1000 * 60 * 60 * 24);

            switch (periodo) {
                case 'hoje':
                    return diasDiff < 1;
                case '7dias':
                    return diasDiff <= 7;
                case '30dias':
                    return diasDiff <= 30;
                case 'custom':
                    if (dataInicio && dataFim) {
                        const inicio = processarData(dataInicio);
                        const fim = processarData(dataFim);
                        if (inicio && fim) {
                            return data >= inicio && data <= fim;
                        }
                    }
                    return true;
                default:
                    return true; // Todos
            }
        };

        // Contar aceitas
        let totalAceitas = 0;
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (row && row[0] && filtrarPorPeriodo(row[0])) {
                    totalAceitas++;
                }
            }
        }

        // Contar negadas
        let totalNegadas = 0;
        if (negadasData && negadasData.length > 1) {
            for (let i = 1; i < negadasData.length; i++) {
                const row = negadasData[i];
                if (row && row[0] && filtrarPorPeriodo(row[0])) {
                    totalNegadas++;
                }
            }
        }

        // Contar total geradas
        let totalGeradas = 0;
        if (moderacoesData && moderacoesData.length > 1) {
            for (let i = 1; i < moderacoesData.length; i++) {
                const row = moderacoesData[i];
                if (row && row[0] && filtrarPorPeriodo(row[0])) {
                    totalGeradas++;
                }
            }
        }

        const totalComResultado = totalAceitas + totalNegadas;
        const taxaAceite = totalComResultado > 0 ? ((totalAceitas / totalComResultado) * 100).toFixed(2) : 0;

        res.json({
            success: true,
            periodo: periodo || 'todos',
            indicadores: {
                totalGeradas: totalGeradas,
                totalAceitas: totalAceitas,
                totalNegadas: totalNegadas,
                totalComResultado: totalComResultado,
                taxaAceite: parseFloat(taxaAceite)
            }
        });

    } catch (error) {
        console.error('❌ Erro ao obter estatísticas globais:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter estatísticas globais',
            message: error.message
        });
    }
});

/**
 * Endpoint para obter estatísticas por tema
 * GET /api/estatisticas/temas
 */
app.get('/api/estatisticas/temas', async (req, res) => {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');

        const temasMap = {};

        // Processar aceitas
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 4) continue;
                const tema = (row[3] || 'Sem tema').toString().trim();
                if (!temasMap[tema]) {
                    temasMap[tema] = { aceitas: 0, negadas: 0 };
                }
                temasMap[tema].aceitas++;
            }
        }

        // Processar negadas
        if (negadasData && negadasData.length > 1) {
            for (let i = 1; i < negadasData.length; i++) {
                const row = negadasData[i];
                if (!row || row.length < 4) continue;
                const tema = (row[3] || 'Sem tema').toString().trim();
                if (!temasMap[tema]) {
                    temasMap[tema] = { aceitas: 0, negadas: 0 };
                }
                temasMap[tema].negadas++;
            }
        }

        // Calcular estatísticas por tema
        const temasEstatisticas = Object.keys(temasMap).map(tema => {
            const stats = temasMap[tema];
            const total = stats.aceitas + stats.negadas;
            const taxaAceite = total > 0 ? ((stats.aceitas / total) * 100).toFixed(2) : 0;
            const taxaNegativa = total > 0 ? ((stats.negadas / total) * 100).toFixed(2) : 0;

            return {
                tema: tema,
                total: total,
                aceitas: stats.aceitas,
                negadas: stats.negadas,
                taxaAceite: parseFloat(taxaAceite),
                taxaNegativa: parseFloat(taxaNegativa)
            };
        });

        // Ordenar por total (maior primeiro)
        temasEstatisticas.sort((a, b) => b.total - a.total);

        res.json({
            success: true,
            temas: temasEstatisticas
        });

    } catch (error) {
        console.error('❌ Erro ao obter estatísticas por tema:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter estatísticas por tema',
            message: error.message
        });
    }
});

/**
 * Endpoint para obter detalhes de um tema específico
 * GET /api/estatisticas/tema/:tema
 */
app.get('/api/estatisticas/tema/:tema', async (req, res) => {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const tema = decodeURIComponent(req.params.tema);
        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');

        const motivosMap = {};
        let totalAceitas = 0;
        let totalNegadas = 0;

        // Processar aceitas do tema
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 5) continue;
                const temaRow = (row[3] || '').toString().trim();
                if (temaRow.toLowerCase() === tema.toLowerCase()) {
                    totalAceitas++;
                    const motivo = (row[4] || 'Sem motivo').toString().trim();
                    if (!motivosMap[motivo]) {
                        motivosMap[motivo] = { aceitas: 0, negadas: 0 };
                    }
                    motivosMap[motivo].aceitas++;
                }
            }
        }

        // Processar negadas do tema
        if (negadasData && negadasData.length > 1) {
            for (let i = 1; i < negadasData.length; i++) {
                const row = negadasData[i];
                if (!row || row.length < 5) continue;
                const temaRow = (row[3] || '').toString().trim();
                if (temaRow.toLowerCase() === tema.toLowerCase()) {
                    totalNegadas++;
                    const motivo = (row[4] || 'Sem motivo').toString().trim();
                    if (!motivosMap[motivo]) {
                        motivosMap[motivo] = { aceitas: 0, negadas: 0 };
                    }
                    motivosMap[motivo].negadas++;
                }
            }
        }

        // Calcular estatísticas por motivo
        const motivosEstatisticas = Object.keys(motivosMap).map(motivo => {
            const stats = motivosMap[motivo];
            const total = stats.aceitas + stats.negadas;
            const taxaAceite = total > 0 ? ((stats.aceitas / total) * 100).toFixed(2) : 0;
            const taxaNegativa = total > 0 ? ((stats.negadas / total) * 100).toFixed(2) : 0;

            return {
                motivo: motivo,
                total: total,
                aceitas: stats.aceitas,
                negadas: stats.negadas,
                taxaAceite: parseFloat(taxaAceite),
                taxaNegativa: parseFloat(taxaNegativa)
            };
        });

        motivosEstatisticas.sort((a, b) => b.total - a.total);

        const total = totalAceitas + totalNegadas;
        const taxaAceite = total > 0 ? ((totalAceitas / total) * 100).toFixed(2) : 0;

        res.json({
            success: true,
            tema: tema,
            total: total,
            aceitas: totalAceitas,
            negadas: totalNegadas,
            taxaAceite: parseFloat(taxaAceite),
            motivos: motivosEstatisticas
        });

    } catch (error) {
        console.error('❌ Erro ao obter detalhes do tema:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter detalhes do tema',
            message: error.message
        });
    }
});

/**
 * Endpoint para listar moderações com filtros
 * GET /api/moderações?tema=...&resultado=...&motivo=...&periodo=...
 */
app.get('/api/moderacoes', async (req, res) => {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const { tema, resultado, motivo, periodo } = req.query;

        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');

        const moderacoes = [];

        // Processar aceitas
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 6) continue;

                const modTema = (row[3] || '').toString().trim();
                const modMotivo = (row[4] || '').toString().trim();
                const modResultado = 'Aceita';
                const modData = (row[0] || '').toString().trim();

                // Aplicar filtros
                if (tema && modTema.toLowerCase() !== tema.toLowerCase()) continue;
                if (resultado && modResultado !== resultado) continue;
                if (motivo && modMotivo.toLowerCase() !== motivo.toLowerCase()) continue;

                moderacoes.push({
                    idModeracao: (row[1] || '').toString().trim(),
                    idReclamacao: (row[2] || '').toString().trim(),
                    tema: modTema,
                    motivo: modMotivo,
                    resultado: modResultado,
                    data: modData,
                    tipo: 'aceita'
                });
            }
        }

        // Processar negadas
        if (negadasData && negadasData.length > 1) {
            for (let i = 1; i < negadasData.length; i++) {
                const row = negadasData[i];
                if (!row || row.length < 6) continue;

                const modTema = (row[3] || '').toString().trim();
                const modMotivo = (row[4] || '').toString().trim();
                const modResultado = 'Negada';
                const modData = (row[0] || '').toString().trim();

                // Aplicar filtros
                if (tema && modTema.toLowerCase() !== tema.toLowerCase()) continue;
                if (resultado && modResultado !== resultado) continue;
                if (motivo && modMotivo.toLowerCase() !== motivo.toLowerCase()) continue;

                moderacoes.push({
                    idModeracao: (row[1] || '').toString().trim(),
                    idReclamacao: (row[2] || '').toString().trim(),
                    tema: modTema,
                    motivo: modMotivo,
                    resultado: modResultado,
                    data: modData,
                    tipo: 'negada'
                });
            }
        }

        // Ordenar por data (mais recente primeiro)
        moderacoes.sort((a, b) => {
            const dataA = processarData(a.data);
            const dataB = processarData(b.data);
            if (!dataA || !dataB) return 0;
            return dataB - dataA;
        });

        res.json({
            success: true,
            total: moderacoes.length,
            moderacoes: moderacoes
        });

    } catch (error) {
        console.error('❌ Erro ao listar moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar moderações',
            message: error.message
        });
    }
});

/**
 * Endpoint para obter detalhes completos de uma moderação
 * GET /api/moderacao/:idModeracao
 */
app.get('/api/moderacao/:idModeracao', async (req, res) => {
    console.log('🔍 [API] Endpoint /api/moderacao/:idModeracao chamado');
    console.log('🔍 [API] Parâmetros:', req.params);
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.error('❌ [API] Google Sheets não está inicializado');
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        // Extrair e normalizar ID usando função robusta
        const idModeracaoRaw = req.params.idModeracao.toString();
        const idModeracaoNormalized = normalizarId(idModeracaoRaw);
        console.log('🔍 [API] ID original (raw):', JSON.stringify(idModeracaoRaw));
        console.log('🔍 [API] ID após normalização robusta:', JSON.stringify(idModeracaoNormalized));
        console.log('🔍 [API] Buscando na planilha "Dados de Solicitação", página "Moderações Negadas", coluna B (ID da Moderação)');

        // Buscar em aceitas
        // Planilha: "Dados de Solicitação", Página: "Moderações Aceitas", ID na coluna B (índice 1)
        let nomeAbaAceitas = 'Moderações Aceitas';
        try {
            const sheets = googleSheetsConfig.getSheets();
            const spreadsheetId = googleSheetsConfig.getSpreadsheetId();
            const spreadsheet = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheetId,
                fields: 'sheets.properties.title'
            });
            const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
            const nomeEncontrado = encontrarNomeAba(sheetNames, 'Moderações Aceitas');
            if (nomeEncontrado) {
                nomeAbaAceitas = nomeEncontrado;
                if (nomeEncontrado !== 'Moderações Aceitas') {
                    console.log(`⚠️ [API] Nome da aba Aceitas é "${nomeEncontrado}" e não "Moderações Aceitas"`);
                }
            }
        } catch (listError) {
            console.log('⚠️ [API] Não foi possível verificar nome da aba Aceitas:', listError.message);
        }
        
        const aceitasData = await googleSheetsConfig.readData(`${nomeAbaAceitas}!A1:Z10000`);
        console.log(`📊 [API] Total de linhas em ${nomeAbaAceitas}: ${aceitasData ? aceitasData.length - 1 : 0}`);
        let moderacao = null;
        let tipo = null;
        let negadasData = null; // Declarar aqui para estar disponível no erro 404

        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 6) continue;
                
                // ID está na coluna B (índice 1) - "ID da Moderação"
                // Usar função de normalização robusta
                const idRowNormalized = normalizarId(row[1]);
                
                // Comparar IDs normalizados
                let idsCoincidem = false;
                
                // Comparação 1: Strings normalizadas (exata)
                if (idRowNormalized === idModeracaoNormalized) {
                    idsCoincidem = true;
                }
                // Comparação 2: Como números (se ambos forem numéricos)
                else if (!isNaN(idRowNormalized) && !isNaN(idModeracaoNormalized) && idRowNormalized && idModeracaoNormalized) {
                    // Para números grandes, usar BigInt se necessário
                    try {
                        const numRow = idRowNormalized.length > 15 ? BigInt(idRowNormalized) : Number(idRowNormalized);
                        const numBuscado = idModeracaoNormalized.length > 15 ? BigInt(idModeracaoNormalized) : Number(idModeracaoNormalized);
                        
                        if (numRow === numBuscado) {
                            idsCoincidem = true;
                        }
                    } catch (e) {
                        // Se BigInt falhar, tentar Number normal
                        if (Number(idRowNormalized) === Number(idModeracaoNormalized)) {
                            idsCoincidem = true;
                        }
                    }
                }
                
                if (idsCoincidem) {
                    console.log(`✅ [API] Moderação encontrada em Moderações Aceitas (linha ${i + 1})`);
                    moderacao = {
                        idModeracao: idRowNormalized,
                        idReclamacao: (row[2] || '').toString().trim(),
                        tema: (row[3] || '').toString().trim(),
                        motivo: (row[4] || '').toString().trim(),
                        textoModeracao: (row[5] || '').toString().trim(),
                        resultado: 'Aceita',
                        dataRegistro: (row[0] || '').toString().trim(),
                        solicitacaoCliente: (row[7] || '').toString().trim(),
                        respostaEmpresa: (row[8] || '').toString().trim(),
                        consideracaoFinal: (row[9] || '').toString().trim(),
                        linhaRaciocinio: (row[10] || '').toString().trim(),
                        dataHoraOriginal: (row[11] || '').toString().trim()
                    };
                    tipo = 'aceita';
                    break;
                }
            }
        }

        // Se não encontrou, buscar em negadas
        // Estrutura: [0]Data, [1]ID Moderação (coluna B), [2]ID Reclamação, [3]Tema, [4]Motivo, [5]Texto,
        // [6]Resultado, [7]Bloco1, [8]Bloco2, [9]Bloco3, [10]Solicitação, [11]Resposta, [12]Consideração, [13]Linha Raciocínio, [14]Data/Hora Original
        // Planilha: "Dados de Solicitação", Página: "Moderações Negadas", ID na coluna B (índice 1), Data/Hora na coluna O (índice 14)
        if (!moderacao) {
            console.log('🔍 [API] Buscando em Moderações Negadas...');
            console.log(`🔍 [API] ID buscado: "${idModeracaoRaw}" (normalizado: "${idModeracaoNormalized}")`);
            
            // Primeiro, buscar a data/hora original na planilha "Moderações" usando o ID
            let dataHoraOriginal = null;
            try {
                const moderacoesData = await googleSheetsConfig.readData('Moderações!A1:Z10000');
                console.log(`📊 [API] Total de linhas na planilha "Moderações": ${moderacoesData ? moderacoesData.length - 1 : 0}`);
                if (moderacoesData && moderacoesData.length > 1) {
                    for (let i = 1; i < moderacoesData.length; i++) {
                        const row = moderacoesData[i];
                        if (!row || row.length < 2) continue;
                        const rowIdNormalized = normalizarId(row[1]);
                        if (rowIdNormalized === idModeracaoNormalized) {
                            dataHoraOriginal = (row[0] || '').toString().trim();
                            console.log(`📅 [API] Data/Hora original encontrada na planilha "Moderações" (linha ${i + 1}): "${dataHoraOriginal}"`);
                            break;
                        }
                    }
                    if (!dataHoraOriginal) {
                        console.log(`⚠️ [API] ID "${idModeracaoNormalized}" não encontrado na planilha "Moderações" para obter Data/Hora Original`);
                    }
                }
            } catch (error) {
                console.log(`⚠️ [API] Erro ao buscar data/hora original: ${error.message}`);
            }
            
            try {
                // Primeiro, tentar listar todas as abas para verificar o nome exato
                let nomeAbaCorreto = 'Moderações Negadas';
                try {
                    const sheets = googleSheetsConfig.getSheets();
                    const spreadsheetId = googleSheetsConfig.getSpreadsheetId();
                    const spreadsheet = await sheets.spreadsheets.get({
                        spreadsheetId: spreadsheetId,
                        fields: 'sheets.properties.title'
                    });
                    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
                    console.log('📋 [API] Abas disponíveis na planilha:', sheetNames);
                    console.log('🔍 [API] Procurando aba "Moderações Negadas" na lista...');
                    
                    // Tentar encontrar o nome correto da aba
                    const nomeEncontrado = encontrarNomeAba(sheetNames, 'Moderações Negadas');
                    if (nomeEncontrado) {
                        nomeAbaCorreto = nomeEncontrado;
                        console.log(`✅ [API] Aba encontrada: "${nomeAbaCorreto}"`);
                        if (nomeEncontrado !== 'Moderações Negadas') {
                            console.log(`⚠️ [API] ATENÇÃO: Nome da aba é "${nomeEncontrado}" e não "Moderações Negadas"`);
                        }
                    } else {
                        console.error('❌ [API] ABA "Moderações Negadas" NÃO ENCONTRADA!');
                        console.error('❌ [API] Abas disponíveis:', sheetNames);
                        console.error('❌ [API] Verifique se o nome da aba está correto na planilha');
                    }
                } catch (listError) {
                    console.log('⚠️ [API] Não foi possível listar abas:', listError.message);
                }
                
                // Usar o nome correto da aba encontrado
                console.log(`📖 [API] Lendo dados da aba: "${nomeAbaCorreto}"`);
                negadasData = await googleSheetsConfig.readData(`${nomeAbaCorreto}!A1:Z10000`);
                console.log(`📊 [API] Total de linhas em Moderações Negadas: ${negadasData ? negadasData.length - 1 : 0}`);
            } catch (error) {
                console.error('❌ [API] Erro ao ler Moderações Negadas:', error.message);
                console.error('❌ [API] Stack trace:', error.stack);
                // Se o erro for sobre a aba não encontrada, tentar variações do nome
                if (error.message.includes('Unable to parse range') || error.message.includes('not found')) {
                    console.error('❌ [API] Possível problema: Nome da aba pode estar diferente!');
                    console.error('❌ [API] Verifique se a aba se chama exatamente "Moderações Negadas" (com acento)');
                }
                throw error;
            }
            if (negadasData && negadasData.length > 1) {
                // Log dos primeiros 5 IDs encontrados para debug
                console.log('📋 [API] Primeiros 5 IDs encontrados:');
                for (let j = 1; j < Math.min(6, negadasData.length); j++) {
                    const tempRow = negadasData[j];
                    if (tempRow && tempRow.length > 1) {
                        const tempIdNormalized = normalizarId(tempRow[1]);
                        const tempDataHora = tempRow.length > 14 ? (tempRow[14] || '').toString().trim() : '';
                        console.log(`   Linha ${j + 1}: ID original="${tempRow[1]}", ID normalizado="${tempIdNormalized}", Data/Hora Original="${tempDataHora}"`);
                    }
                }
                
                for (let i = 1; i < negadasData.length; i++) {
                    const row = negadasData[i];
                    if (!row || row.length < 2) continue;
                    
                    let encontrado = false;
                    let tipoMatch = '';
                    
                    // MÉTODO 1: Buscar pelo ID (coluna B - índice 1) usando normalização robusta
                    const idRowNormalized = normalizarId(row[1]);
                    
                    if (idRowNormalized === idModeracaoNormalized || 
                        (idRowNormalized && !isNaN(idRowNormalized) && !isNaN(idModeracaoNormalized) && 
                         (idRowNormalized.length > 15 ? BigInt(idRowNormalized) === BigInt(idModeracaoNormalized) : 
                          Number(idRowNormalized) === Number(idModeracaoNormalized)))) {
                        encontrado = true;
                        tipoMatch = 'ID';
                    }
                    
                    // MÉTODO 2: Se não encontrou pelo ID e temos a data/hora original, buscar por ela (coluna O - índice 14)
                    if (!encontrado && dataHoraOriginal && row.length > 14) {
                        const dataHoraRowRaw = (row[14] || '').toString();
                        const dataHoraRow = dataHoraRowRaw.trim();
                        // Normalizar ambas as datas para comparação (remover espaços extras, normalizar formato)
                        const dataHoraOriginalNorm = dataHoraOriginal.trim().replace(/\s+/g, ' ');
                        const dataHoraRowNorm = dataHoraRow.replace(/\s+/g, ' ');
                        
                        // Comparação exata
                        if (dataHoraRowNorm === dataHoraOriginalNorm) {
                            encontrado = true;
                            tipoMatch = 'Data/Hora Original';
                            console.log(`📅 [API] Match por Data/Hora Original na linha ${i + 1}: "${dataHoraRow}"`);
                        }
                        // Comparação parcial (caso haja diferenças de formato)
                        else if (dataHoraRowNorm && dataHoraOriginalNorm && 
                                 (dataHoraRowNorm.includes(dataHoraOriginalNorm) || 
                                  dataHoraOriginalNorm.includes(dataHoraRowNorm))) {
                            encontrado = true;
                            tipoMatch = 'Data/Hora Original (parcial)';
                            console.log(`📅 [API] Match parcial por Data/Hora Original na linha ${i + 1}: "${dataHoraRow}" (buscado: "${dataHoraOriginal}")`);
                        }
                    }
                    
                    if (encontrado) {
                        console.log(`✅ [API] Moderação encontrada em Moderações Negadas (linha ${i + 1}) por ${tipoMatch}`);
                        moderacao = {
                            idModeracao: idRowNormalized || normalizarId(row[1]),
                            idReclamacao: (row[2] || '').toString().trim(),
                            tema: (row[3] || '').toString().trim(),
                            motivo: (row[4] || '').toString().trim(),
                            textoModeracao: (row[5] || '').toString().trim(),
                            resultado: 'Negada',
                            dataRegistro: (row[0] || '').toString().trim(),
                            solicitacaoCliente: (row[10] || '').toString().trim(),
                            respostaEmpresa: (row[11] || '').toString().trim(),
                            consideracaoFinal: (row[12] || '').toString().trim(),
                            linhaRaciocinio: (row[13] || '').toString().trim(),
                            dataHoraOriginal: row.length > 14 ? (row[14] || '').toString().trim() : '',
                            // Análise FASE 2
                            motivoNegativa: (row[7] || '').toString().trim(), // Bloco 1
                            ondeErrou: (row[8] || '').toString().trim(), // Bloco 2
                            comoCorrigir: (row[9] || '').toString().trim() // Bloco 3
                        };
                        tipo = 'negada';
                        break;
                    }
                }
                
                if (!moderacao) {
                    console.log(`⚠️ [API] Nenhuma correspondência encontrada após verificar ${negadasData.length - 1} linhas`);
                    if (dataHoraOriginal) {
                        console.log(`⚠️ [API] Tentou buscar também por Data/Hora Original: "${dataHoraOriginal}"`);
                        // Listar algumas datas/horas encontradas na coluna O para debug
                        console.log('📋 [API] Primeiras 5 Data/Hora encontradas na coluna O de Moderações Negadas:');
                        for (let j = 1; j < Math.min(6, negadasData.length); j++) {
                            const tempRow = negadasData[j];
                            if (tempRow && tempRow.length > 14) {
                                const tempDataHora = (tempRow[14] || '').toString().trim();
                                console.log(`   Linha ${j + 1}: "${tempDataHora}"`);
                            }
                        }
                    } else {
                        console.log(`⚠️ [API] Data/Hora Original não foi encontrada na planilha "Moderações" para o ID "${idModeracaoNormalized}"`);
                    }
                }
            }
        }

        if (!moderacao) {
            console.error(`❌ [API] Moderação não encontrada com ID: "${idModeracaoRaw}" (normalizado: "${idModeracaoNormalized}")`);
            console.error(`❌ [API] Verificadas ${aceitasData ? aceitasData.length - 1 : 0} moderações aceitas e ${negadasData ? negadasData.length - 1 : 0} moderações negadas`);
            
            // Log dos primeiros IDs encontrados para debug
            if (aceitasData && aceitasData.length > 1) {
                const primeirosIds = aceitasData.slice(1, Math.min(6, aceitasData.length)).map(r => {
                    const idOriginal = (r[1] || '').toString();
                    const idNormalized = normalizarId(r[1]);
                    return { original: idOriginal, normalizado: idNormalized, tipo: typeof r[1] };
                });
                console.log('📋 [API] Primeiros IDs em Moderações Aceitas:', JSON.stringify(primeirosIds, null, 2));
            }
            if (negadasData && negadasData.length > 1) {
                const primeirosIds = negadasData.slice(1, Math.min(6, negadasData.length)).map(r => {
                    const idOriginal = (r[1] || '').toString();
                    const idNormalized = normalizarId(r[1]);
                    return { original: idOriginal, normalizado: idNormalized, tipo: typeof r[1] };
                });
                console.log('📋 [API] Primeiros IDs em Moderações Negadas:', JSON.stringify(primeirosIds, null, 2));
                
                // Verificar se o ID buscado está parcialmente presente em algum ID
                console.log(`🔍 [API] Verificando correspondências parciais...`);
                for (let i = 1; i < Math.min(negadasData.length, 20); i++) {
                    const row = negadasData[i];
                    if (!row || row.length < 2) continue;
                    const idRowNormalized = normalizarId(row[1]);
                    if (idRowNormalized && idModeracaoNormalized && 
                        (idRowNormalized.includes(idModeracaoNormalized) || idModeracaoNormalized.includes(idRowNormalized))) {
                        console.log(`⚠️ [API] Possível correspondência parcial encontrada na linha ${i + 1}: ID original="${row[1]}", normalizado="${idRowNormalized}"`);
                    }
                }
            }
            
            return res.status(404).json({
                success: false,
                error: `Moderação não encontrada com ID: ${idModeracaoRaw}`,
                idBuscado: idModeracaoRaw,
                idNormalizado: idModeracaoNormalized,
                totalAceitas: aceitasData ? aceitasData.length - 1 : 0,
                totalNegadas: negadasData ? negadasData.length - 1 : 0
            });
        }

        // Buscar informações de aprendizado aplicado (FASE 3)
        let aprendizadoAplicado = null;
        if (tipo === 'aceita') {
            // Verificar se esta moderação reforçou um modelo positivo
            const padroesPositivos = await extrairPadroesPositivos(moderacao.tema, moderacao.motivo);
            if (padroesPositivos.modeloPrincipal) {
                aprendizadoAplicado = {
                    tipo: 'positivo',
                    mensagem: 'Esta moderação reforçou um modelo positivo existente',
                    pesoModelo: padroesPositivos.modeloPrincipal.peso,
                    quantidadeAceites: padroesPositivos.modeloPrincipal.aceites.length
                };
            }
        }

        console.log('✅ [API] Moderação encontrada:', {
            id: moderacao.idModeracao,
            tipo: tipo,
            tema: moderacao.tema
        });

        res.json({
            success: true,
            moderacao: moderacao,
            tipo: tipo,
            aprendizadoAplicado: aprendizadoAplicado
        });

    } catch (error) {
        console.error('❌ [API] Erro ao obter detalhes da moderação:', error);
        console.error('❌ [API] Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter detalhes da moderação',
            message: error.message
        });
    }
});

/**
 * Endpoint para obter evolução temporal
 * GET /api/estatisticas/evolucao?periodo=30dias|90dias|6meses|1ano
 */
app.get('/api/estatisticas/evolucao', async (req, res) => {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const { periodo = '30dias' } = req.query;
        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');

        const hoje = new Date();
        let diasParaVoltar = 30;
        switch (periodo) {
            case '7dias': diasParaVoltar = 7; break;
            case '30dias': diasParaVoltar = 30; break;
            case '90dias': diasParaVoltar = 90; break;
            case '6meses': diasParaVoltar = 180; break;
            case '1ano': diasParaVoltar = 365; break;
        }

        const dataInicio = new Date(hoje);
        dataInicio.setDate(dataInicio.getDate() - diasParaVoltar);

        const evolucao = [];
        const processarData = (dataStr) => {
            if (!dataStr) return null;
            try {
                const partes = dataStr.split(' ')[0].split('/');
                if (partes.length === 3) {
                    return new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
                }
            } catch (e) {}
            return null;
        };

        // Agrupar por dia
        const dadosPorDia = {};

        // Processar aceitas
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 1) continue;
                const data = processarData(row[0]);
                if (data && data >= dataInicio) {
                    const diaKey = `${data.getDate()}/${data.getMonth() + 1}/${data.getFullYear()}`;
                    if (!dadosPorDia[diaKey]) {
                        dadosPorDia[diaKey] = { aceitas: 0, negadas: 0 };
                    }
                    dadosPorDia[diaKey].aceitas++;
                }
            }
        }

        // Processar negadas
        if (negadasData && negadasData.length > 1) {
            for (let i = 1; i < negadasData.length; i++) {
                const row = negadasData[i];
                if (!row || row.length < 1) continue;
                const data = processarData(row[0]);
                if (data && data >= dataInicio) {
                    const diaKey = `${data.getDate()}/${data.getMonth() + 1}/${data.getFullYear()}`;
                    if (!dadosPorDia[diaKey]) {
                        dadosPorDia[diaKey] = { aceitas: 0, negadas: 0 };
                    }
                    dadosPorDia[diaKey].negadas++;
                }
            }
        }

        // Converter para array e calcular taxas
        Object.keys(dadosPorDia).sort().forEach(dia => {
            const dados = dadosPorDia[dia];
            const total = dados.aceitas + dados.negadas;
            const taxaAceite = total > 0 ? ((dados.aceitas / total) * 100).toFixed(2) : 0;

            evolucao.push({
                data: dia,
                aceitas: dados.aceitas,
                negadas: dados.negadas,
                total: total,
                taxaAceite: parseFloat(taxaAceite)
            });
        });

        res.json({
            success: true,
            periodo: periodo,
            evolucao: evolucao
        });

    } catch (error) {
        console.error('❌ Erro ao obter evolução temporal:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter evolução temporal',
            message: error.message
        });
    }
});

// Função auxiliar para processar data (reutilizar)
function processarData(dataStr) {
    if (!dataStr) return null;
    try {
        const partes = dataStr.split(' ')[0].split('/');
        if (partes.length === 3) {
            return new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
        }
    } catch (e) {}
    return null;
}

// Função para gerar recomendações
function getGoogleSheetsRecommendations(configStatus, integrationStatus) {
    const recommendations = [];
    
    if (configStatus.googleSheetsId === 'NÃO CONFIGURADO') {
        recommendations.push('Configure GOOGLE_SHEETS_ID nas variáveis de ambiente');
    }
    
    if (configStatus.enableGoogleSheets !== 'true') {
        recommendations.push('Configure ENABLE_GOOGLE_SHEETS=true nas variáveis de ambiente');
    }
    
    if (configStatus.serviceAccountEmail === 'NÃO CONFIGURADO') {
        recommendations.push('Configure GOOGLE_SERVICE_ACCOUNT_EMAIL nas variáveis de ambiente');
    }
    
    if (configStatus.privateKey === 'NÃO CONFIGURADO') {
        recommendations.push('Configure GOOGLE_PRIVATE_KEY nas variáveis de ambiente');
    }
    
    if (configStatus.projectId === 'NÃO CONFIGURADO') {
        recommendations.push('Configure GOOGLE_PROJECT_ID nas variáveis de ambiente');
    }
    
    if (!integrationStatus.googleSheetsIntegrationActive) {
        recommendations.push('Google Sheets não está ativo - verifique as configurações do Service Account');
    }
    
    if (recommendations.length === 0) {
        recommendations.push('Todas as configurações estão corretas');
    }
    
    return recommendations;
}

process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando servidor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Encerrando servidor...');
    process.exit(0);
});

// ===== ENDPOINT PARA CORRIGIR DADOS DA PLANILHA MODERAÇÕES =====

// POST /api/corrigir-moderacoes - Corrigir dados desalinhados na aba Moderações
app.post('/api/corrigir-moderacoes', async (req, res) => {
    console.log('🔧 Iniciando correção de dados da aba Moderações...');
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.status(503).json({
                success: false,
                error: 'Google Sheets não está inicializado'
            });
        }

        const sheets = googleSheetsConfig.getSheets();
        const spreadsheetId = googleSheetsConfig.getSpreadsheetId();

        // Ler apenas cabeçalhos primeiro
        const headerData = await googleSheetsConfig.readData('Moderações!A1:O1');
        if (!headerData || headerData.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Não foi possível ler cabeçalhos da planilha'
            });
        }

        const headers = headerData[0];
        const linhasCorrigidas = [];
        const erros = [];

        // Estrutura esperada das colunas
        const estruturaEsperada = [
            'Data/Hora',           // [0]
            'ID',                  // [1]
            'ID da Reclamação',    // [2]
            'Tipo',                // [3]
            'Solicitação Cliente', // [4]
            'Resposta Empresa',    // [5]
            'Consideração Final',  // [6]
            'Motivo Moderação',    // [7]
            'Texto Moderação Anterior', // [8]
            'Feedback',            // [9]
            'Texto Moderação Reformulado', // [10]
            'Linha Raciocínio',    // [11]
            'Status Aprovação',    // [12]
            'Nome do solicitante', // [13] (antes Observações Internas)
            'Resultado da Moderação' // [14]
        ];

        // Ler dados em lotes menores para evitar quota
        const tamanhoLoteLeitura = 50; // Ler 50 linhas por vez
        let linhaInicio = 2; // Começar na linha 2 (após cabeçalho)
        let temMaisDados = true;
        const todasLinhasCorrigidas = [];

        // Processar dados em lotes
        while (temMaisDados) {
            try {
                const linhaFim = linhaInicio + tamanhoLoteLeitura - 1;
                const range = `Moderações!A${linhaInicio}:O${linhaFim}`;
                
                console.log(`📖 Lendo linhas ${linhaInicio} a ${linhaFim}...`);
                const loteData = await googleSheetsConfig.readData(range);
                
                if (!loteData || loteData.length === 0) {
                    temMaisDados = false;
                    break;
                }

                // Processar cada linha do lote
                const linhasParaAtualizar = [];
                for (let i = 0; i < loteData.length; i++) {
                    const row = loteData[i];
                    if (!row || row.length === 0) continue;

                    try {
                        // Criar nova linha com dados nas colunas corretas
                        const novaRow = new Array(15).fill('');
                        
                        // Função auxiliar para identificar tipo de dado
                        const identificarTipoDado = (valor) => {
                            if (!valor || valor.toString().trim() === '') return null;
                            const str = valor.toString().trim();
                            
                            // Data/Hora
                            if (str.match(/^\d{2}\/\d{2}\/\d{4}/) || str.match(/^\d{4}-\d{2}-\d{2}/) || str.match(/\d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2}/)) {
                                return 'data';
                            }
                            // ID numérico grande (timestamp)
                            if (!isNaN(str) && str.length >= 10) {
                                return 'id';
                            }
                            // Status Aprovação
                            if (str.toLowerCase() === 'aprovada' || str.toLowerCase() === 'pendente' || str.toLowerCase() === 'negada') {
                                return 'status';
                            }
                            // Tipo
                            if (str.toLowerCase() === 'moderacao' || str.toLowerCase() === 'resposta') {
                                return 'tipo';
                            }
                            return null;
                        };

                        // Mapear dados existentes para as colunas corretas
                        // Estratégia: primeiro tentar pelos cabeçalhos, depois pelo conteúdo
                        
                        // [0] Data/Hora - procurar por padrão de data
                        for (let j = 0; j < row.length; j++) {
                            if (identificarTipoDado(row[j]) === 'data' && !novaRow[0]) {
                                novaRow[0] = row[j];
                                break;
                            }
                        }
                        
                        // [1] ID - procurar número grande (timestamp)
                        for (let j = 0; j < row.length; j++) {
                            if (identificarTipoDado(row[j]) === 'id' && !novaRow[1]) {
                                novaRow[1] = row[j];
                                break;
                            }
                        }
                        
                        // [2] ID da Reclamação - procurar número menor ou texto
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[2]) {
                                const str = val.toString().trim();
                                // Se não é data, não é ID grande, e não está vazio
                                if (identificarTipoDado(val) !== 'data' && 
                                    identificarTipoDado(val) !== 'id' && 
                                    str !== '' && 
                                    (str.length < 10 || isNaN(str))) {
                                    novaRow[2] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [3] Tipo - procurar 'moderacao' ou 'resposta'
                        for (let j = 0; j < row.length; j++) {
                            if (identificarTipoDado(row[j]) === 'tipo' && !novaRow[3]) {
                                novaRow[3] = row[j];
                                break;
                            }
                        }
                        
                        // [4] Solicitação Cliente - texto longo
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[4] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 20 && !str.match(/^\d+$/)) {
                                    novaRow[4] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [5] Resposta Empresa - texto longo
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[5] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 20 && !str.match(/^\d+$/) && val !== novaRow[4]) {
                                    novaRow[5] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [6] Consideração Final - texto
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[6] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 10 && val !== novaRow[4] && val !== novaRow[5]) {
                                    novaRow[6] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [7] Motivo Moderação - texto médio
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[7] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 5 && str.length < 100 && 
                                    val !== novaRow[4] && val !== novaRow[5] && val !== novaRow[6]) {
                                    novaRow[7] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [8] Texto Moderação Anterior - geralmente vazio
                        // [9] Feedback - geralmente vazio
                        
                        // [10] Texto Moderação Reformulado - texto muito longo (moderação completa)
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[10] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 100 && 
                                    val !== novaRow[4] && val !== novaRow[5] && val !== novaRow[6]) {
                                    novaRow[10] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [11] Linha Raciocínio - texto médio/longo
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[11] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 20 && 
                                    val !== novaRow[4] && val !== novaRow[5] && val !== novaRow[6] && 
                                    val !== novaRow[7] && val !== novaRow[10]) {
                                    novaRow[11] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [12] Status Aprovação - procurar 'Aprovada', 'Pendente', etc.
                        for (let j = 0; j < row.length; j++) {
                            if (identificarTipoDado(row[j]) === 'status' && !novaRow[12]) {
                                novaRow[12] = row[j];
                                break;
                            }
                        }
                        // Se não encontrou Status mas tem Texto Moderação Reformulado, é Aprovada
                        if (!novaRow[12] && novaRow[10] && novaRow[10].toString().trim() !== '') {
                            novaRow[12] = 'Aprovada';
                        }
                        
                        // [13] Nome do solicitante - texto (antes Observações Internas)
                        for (let j = 0; j < row.length; j++) {
                            const val = row[j];
                            if (val && !novaRow[13] && identificarTipoDado(val) === null) {
                                const str = val.toString().trim();
                                if (str.length > 0 && 
                                    val !== novaRow[4] && val !== novaRow[5] && val !== novaRow[6] && 
                                    val !== novaRow[7] && val !== novaRow[10] && val !== novaRow[11]) {
                                    novaRow[13] = val;
                                    break;
                                }
                            }
                        }
                        
                        // [14] Resultado da Moderação - geralmente vazio

                        // Garantir que pelo menos ID e Data estão preenchidos
                        if (!novaRow[1] && row[1]) novaRow[1] = row[1];
                        if (!novaRow[0] && row[0]) {
                            const dataStr = row[0].toString();
                            if (dataStr.match(/^\d{2}\/\d{2}\/\d{4}/) || dataStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                                novaRow[0] = row[0];
                            }
                        }

                        linhasParaAtualizar.push({
                            linhaNumero: linhaInicio + i,
                            dados: novaRow
                        });
                    } catch (error) {
                        erros.push({ linha: linhaInicio + i, erro: error.message });
                        console.error(`❌ Erro ao processar linha ${linhaInicio + i}:`, error.message);
                    }
                }

                // Atualizar linhas usando batchUpdate (mais eficiente)
                if (linhasParaAtualizar.length > 0) {
                    try {
                        // Preparar dados para batchUpdate
                        const dataToUpdate = linhasParaAtualizar.map(item => ({
                            range: `Moderações!A${item.linhaNumero}:O${item.linhaNumero}`,
                            values: [item.dados]
                        }));

                        // Atualizar em lotes de 10 usando batchUpdate
                        const tamanhoLoteUpdate = 10;
                        for (let j = 0; j < dataToUpdate.length; j += tamanhoLoteUpdate) {
                            const loteUpdate = dataToUpdate.slice(j, j + tamanhoLoteUpdate);
                            
                            const batchRequest = {
                                spreadsheetId: spreadsheetId,
                                resource: {
                                    valueInputOption: 'RAW',
                                    data: loteUpdate
                                }
                            };

                            await sheets.spreadsheets.values.batchUpdate(batchRequest);
                            
                            loteUpdate.forEach((item, idx) => {
                                const linhaNum = linhasParaAtualizar[j + idx].linhaNumero;
                                linhasCorrigidas.push(linhaNum);
                            });

                            console.log(`✅ Atualizadas ${linhasCorrigidas.length} linhas...`);
                            
                            // Aguardar entre lotes de atualização
                            if (j + tamanhoLoteUpdate < dataToUpdate.length) {
                                await new Promise(resolve => setTimeout(resolve, 1000)); // 1s entre lotes
                            }
                        }
                    } catch (error) {
                        console.error(`❌ Erro ao atualizar lote:`, error.message);
                        linhasParaAtualizar.forEach(item => {
                            erros.push({ linha: item.linhaNumero, erro: error.message });
                        });
                    }
                }

                // Verificar se há mais dados
                if (loteData.length < tamanhoLoteLeitura) {
                    temMaisDados = false;
                } else {
                    linhaInicio += tamanhoLoteLeitura;
                    // Aguardar entre leituras para evitar quota
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2s entre leituras
                }
            } catch (error) {
                console.error(`❌ Erro ao processar lote de leitura:`, error.message);
                if (error.message.includes('Quota exceeded') || error.message.includes('rateLimitExceeded')) {
                    // Se exceder quota, aguardar mais tempo
                    console.log('⏳ Quota excedida, aguardando 10 segundos...');
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    // Continuar do mesmo ponto
                } else {
                    temMaisDados = false;
                    erros.push({ linha: 'lote', erro: error.message });
                }
            }
        }

        // Invalidar cache
        if (googleSheetsIntegration && googleSheetsIntegration.invalidateCache) {
            googleSheetsIntegration.invalidateCache(['moderacoes_coerentes']);
        }

        console.log(`✅ Correção concluída: ${linhasCorrigidas.length} linhas corrigidas, ${erros.length} erros`);

        res.json({
            success: true,
            message: `Correção concluída: ${linhasCorrigidas.length} linhas corrigidas`,
            linhasCorrigidas: linhasCorrigidas.length,
            erros: erros.length,
            detalhesErros: erros
        });

    } catch (error) {
        console.error('❌ Erro ao corrigir moderações:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao corrigir moderações',
            message: error.message
        });
    }
});

// ===== ENDPOINTS PARA GERENCIAMENTO DE FAQs =====

// POST /api/faqs/migrate - Migrar FAQs hardcoded para a planilha (endpoint temporário)
app.post('/api/faqs/migrate', async (req, res) => {
    try {
        console.log('🔄 Iniciando migração de FAQs hardcoded para a planilha...');
        
        // Tentar inicializar Google Sheets se não estiver inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await initializeGoogleSheets(envVars);
            } catch (initError) {
                console.error('❌ Erro ao inicializar Google Sheets:', initError.message);
                return res.status(503).json({
                    success: false,
                    error: 'Google Sheets não está inicializado',
                    message: initError.message
                });
            }
        }

        // Garantir que a planilha FAQs existe
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.ensureSheetExists('FAQs', [
                    'ID',
                    'Título',
                    'Tema',
                    'Explicação',
                    'Data de Criação',
                    'Data de Atualização'
                ]);
            } catch (ensureError) {
                console.warn('⚠️ Erro ao garantir existência da planilha FAQs:', ensureError.message);
            }
        }

        // Verificar quais FAQs já existem na planilha
        let existingFAQs = [];
        try {
            const data = await googleSheetsConfig.readData('FAQs!A1:F1000');
            if (data && data.length > 1) {
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (row && row.length > 0 && row[2]) {
                        existingFAQs.push(String(row[2]).trim());
                    }
                }
            }
        } catch (error) {
            console.log('📭 Planilha vazia ou erro ao ler, continuando...');
        }

        // FAQs hardcoded para migrar
        const faqsToMigrate = [
            {
                tema: 'servicos-velotax',
                titulo: 'Quais são os serviços oferecidos pelo Velotax?',
                explicacao: `<p><strong>Pergunta:</strong> 'Quais são os serviços oferecidos pelo Velotax?'}</p>
<p><strong>Resposta:</strong></p>
<p>O Velotax é uma empresa de tecnologia focada em criar soluções que simplificam o cálculo e o pagamento de impostos Pessoa Física e agora oferece soluções de crédito de maneira simples e rápida. Somos o maior aplicativo de antecipação do país, com mais de 3 milhões de downloads, 📲 oferecendo os serviços abaixo:</p>

<p><strong>💸 Antecipação da Restituição:</strong> Para facilitar ainda mais, oferecemos a opção de antecipação da sua restituição de Imposto de Renda. Em até 48 horas ⏳, o valor estará na sua conta, sem burocracia e sem enrolação. Com o Velotax, você tem praticidade, segurança e velocidade🚀, tudo em um só lugar.</p>

<p><strong>📝 Envio do IRPF:</strong> Nosso serviço de envio de declaração de Imposto de Renda é rápido, fácil ✅ e intuitivo. A plataforma do Velotax guia você passo a passo para garantir o preenchimento correto e eficiente da sua declaração de Imposto de Renda Pessoa Física com rapidez e segurança! Em apenas alguns minutos, você pode declarar seu Imposto de Renda com 100% de precisão.</p>

<p><strong>👷‍♂️ Crédito do Trabalhador:</strong> Empréstimo consignado para trabalhadores CLT, domésticos e diretores, com vínculo ativo mínimo de 12 meses e pagamento descontado diretamente na folha de pagamento pelo e-Social. O processo é 100% digital, com juros menores, liberação rápida via Pix e carência de até 92 dias no primeiro vencimento.</p>

<p><strong>💰 Crédito Pessoal:</strong> É um empréstimo em dinheiro que você pode usar como quiser para pagar dívidas, ou fazer compras. O pagamento é feito em parcelas com juros, e todo o processo é 100% digital pelo aplicativo. A análise é rápida via Open Finance e o valor pode ser liberado em até 24 horas. As propostas são atualizadas diariamente, aumentando suas chances de conseguir uma oferta adequada ao seu perfil.</p>

<p><strong>📌 Veloprime, nossa Calculadora de DARF:</strong> Cálculo automático preciso de impostos, além de emissão de DARF. Tudo o que você precisa para investir com mais segurança 📈 sem se preocupar com os impostos. Nossa ferramenta é completa, integrando informações da B3 e exterior 🌍.</p>`
            },
            {
                tema: 'antecipacao-restituicao',
                titulo: 'Qual é o serviço de Antecipação da Restituição oferecido pelo Velotax?',
                explicacao: `<p><strong>Pergunta:</strong> 'Qual é o serviço de Antecipação da Restituição oferecido pelo Velotax?'}</p>
<p><strong>Resposta:</strong></p>
<p>Durante o período de declaração do Imposto de Renda💰, que ocorre normalmente entre Março e Maio de cada ano📅, o Velotax 📲 oferece aos clientes o serviço de Antecipação da Restituição. Ao declarar seu Imposto de Renda conosco e confirmar que possui saldo a restituir, você tem a opção de antecipar parte desse valor de forma rápida e segura.</p>

<p>A principal vantagem desse serviço é a agilidade🚀: a antecipação é feita em minutos, sem burocracia ou análise de crédito. O valor antecipado é creditado diretamente na sua conta e, quando a Receita Federal libera sua restituição, o montante é utilizado para quitar a antecipação automaticamente✅.</p>

<p>📢 O período de entrega da declaração de 2025 já foi encerrado, mas você ainda pode contar com o Velotax para realizar a antecipação da restituição do Imposto de Renda. Nosso processo é simples, rápido e seguro🔒, garantindo que você tenha acesso ao valor antes do crédito da Receita Federal.</p>

<p>Fique atento ao nosso aplicativo e redes sociais para mais novidades! 🚀💙</p>`
            },
            {
                tema: 'credito-trabalhador',
                titulo: 'Crédito do Trabalhador Velotax: O que é?',
                explicacao: `<p><strong>Pergunta:</strong> 'Crédito do Trabalhador Velotax: O que é?'}</p>
<p><strong>Resposta:</strong></p>
<p><strong>👷‍♂️ Crédito do Trabalhador Velotax: O que é o Crédito do Trabalhador?</strong> Empréstimo consignado lançado em 2025 📅 para trabalhadores CLT, domésticos e diretores, com vínculo ativo mínimo de 12 meses e empresa ativa há 24 meses. Pagamento com desconto diretamente na folha de pagamento pelo e-Social.</p>

<p><strong>Quais os diferenciais de contratar com o Velotax?</strong> Juros menores, troca de dívidas mais caras, processo 100% digital 💻, liberação via Pix CPF e carência de até 92 dias no 1º vencimento.</p>

<p><strong>Como contratar o serviço?</strong> Acesse o app Velotax, autorize a Consulta de Margem, valide informações, assine o contrato digitalmente ✍️ e receba o crédito via Pix em até 24 horas.</p>

<p><strong>Quais documentos são necessários?</strong> Você realizará um processo de confirmação de identidade onde enviará uma foto ou exportação da carteira digital de seu documento de identidade ✍️, e uma selfie para garantir que você mesmo esteja fazendo a solicitação.</p>`
            },
            {
                tema: 'credito-pessoal',
                titulo: 'Crédito Pessoal Velotax: O que é?',
                explicacao: `<p><strong>Pergunta:</strong> 'Crédito Pessoal Velotax: O que é?'}</p>
<p><strong>Resposta:</strong></p>
<p><strong>💰 Crédito Pessoal Velotax: O que é o Empréstimo Pessoal?</strong></p>
<p>O Empréstimo Pessoal é uma linha de crédito concedida a pessoas físicas por instituições financeiras. Nessa modalidade, o cliente recebe um valor e o paga em parcelas mensais com juros, sem a necessidade de oferecer garantias ou justificar o uso do dinheiro. Esse tipo de crédito oferece flexibilidade e praticidade, podendo ser utilizado para diferentes finalidades, como quitar dívidas, investir em educação, cobrir emergências ou realizar projetos pessoais.</p>

<p><strong>📋 Características do Produto:</strong></p>
<ul>
<li><strong>Valor do limite:</strong> R$ 500,00</li>
<li><strong>Parcelamento:</strong> 4 parcelas, com vencimento a cada 30 dias</li>
<li><strong>Data de vencimento:</strong> Definida automaticamente, com base na movimentação financeira do cliente via Open Finance</li>
<li><strong>Taxa de juros:</strong> 19% a.m. (nesta versão inicial)</li>
<li><strong>Faixa etária:</strong> 18 a 75 anos para todos os clientes</li>
</ul>

<p><strong>🔗 O que é Open Finance?</strong></p>
<p>O Open Finance é como se fosse uma "ponte segura" que conecta diferentes bancos e instituições financeiras. Ele permite que você, com a sua autorização, compartilhe suas informações financeiras (como saldo, histórico de movimentações ou limites de crédito) de um banco para outro. Assim, os bancos passam a ter uma visão mais completa do seu perfil financeiro, ajudando a oferecer melhores condições de crédito, taxas mais baixas e serviços personalizados.</p>

<p><strong>📱 Como contratar o serviço?</strong></p>
<p>O processo é 100% digital, feito diretamente no aplicativo Velotax:</p>
<ol>
<li>Acesse o aplicativo Velotax e seleciona o ícone do Empréstimo Pessoal na tela inicial</li>
<li>Autorize a conexão com o Open Finance para análise de crédito</li>
<li>Se aprovado, visualize o limite disponível (R$ 500,00)</li>
<li>Revise a proposta com todas as condições (valor, juros, parcelas)</li>
<li>Leia a CCB (Contrato de Crédito Bancário) e assine digitalmente</li>
<li>O valor será creditado na sua conta entre 30 minutos e 24 horas</li>
</ol>

<p><strong>✨ Diferenciais de contratar com o Velotax:</strong></p>
<ul>
<li>Análise rápida via Open Finance (até 5 minutos) ⏱️</li>
<li>Liberação do valor entre 30 minutos e 24 horas</li>
<li>Processo 100% digital, sem burocracia</li>
<li>Acompanhamento completo pelo aplicativo</li>
<li>Sem necessidade de biometria ou envio de documentos adicionais (nesta versão inicial)</li>
</ul>

<p><strong>🏦 Bancos disponíveis:</strong><br>
Nubank, Itaú (Pessoa Física), Bradesco (Pessoa Física), Santander (Pessoa Física), Banco do Brasil, Caixa Econômica e Inter.</p>

<p><strong>💳 Como quitar o empréstimo?</strong><br>
Acesse o app Velotax, vá até "Próximos Pagamentos", selecione "Crédito Pessoal" e escolha pagar via PIX (preferencial) ou cartão de crédito (principalmente para clientes em atraso).</p>

<p><strong>🚫 Cancelamento:</strong><br>
O cliente pode solicitar o cancelamento em até 7 dias após a contratação, devolvendo o valor integral via PIX. Após esse prazo, não será mais possível cancelar.</p>

<p><strong>⚠️ Importante:</strong></p>
<ul>
<li>Não é permitido ter mais de um contrato ativo ao mesmo tempo</li>
<li>Clientes com Crédito do Trabalhador ou débitos de Antecipação IRPF precisam quitar esses produtos antes</li>
<li>Em caso de atraso: multa de 2% e encargos de 1% ao mês</li>
<li>Caso o atraso não seja regularizado, o contrato poderá ser enviado aos órgãos de proteção ao crédito</li>
</ul>

<p><strong>📄 Documentos necessários:</strong><br>
Não é necessário enviar documentos. Basta ter o CPF cadastrado como chave PIX na conta bancária e autorizar o compartilhamento dos dados pelo app.</p>`
            },
            {
                tema: 'veloprime',
                titulo: 'Veloprime: Calculadora e DARF do Velotax: O que é?',
                explicacao: `<p><strong>Pergunta:</strong> 'Veloprime: Calculadora e DARF do Velotax: O que é?'}</p>
<p><strong>Resposta:</strong></p>
<p>A Calculadora de DARF Velotax é uma ferramenta desenvolvida para facilitar a vida de investidores que atuam na bolsa de valores e em investimentos internacionais. Ela gera automaticamente suas DARFs de imposto sobre ganhos em bolsa de forma altamente precisa, com base em um sistema conectado diretamente à B3, além de possuir integração com investimentos internacionais das corretoras internacionais da BTG e Warren, permitindo que você centralize seus cálculos e relatórios em um só lugar.</p>

<p><strong>❌ Cancelamento do Plano</strong><br>
Você pode solicitar o cancelamento dentro de 7 dias a partir do início do uso da plataforma, com estorno integral dos valores pagos, desde que não tenham sido feitas emissões de DARFs ou relatórios durante esse período.</p>

<p><strong>Como solicitar o cancelamento:</strong></p>
<p><strong>🔹 📱 Pelo aplicativo Velotax:</strong></p>
<ol>
<li>Acesse Início e clique em Ajuda (ícone ❓ no topo do app).</li>
<li>Escolha a opção desejada: Falar no telefone, perguntar ao nosso Chatbot ou abrir chamado (nosso time responderá por e-mail).</li>
</ol>
<p><strong>🔹 📄 Formulário Web:</strong> [Clique aqui] para abrir um chamado rapidamente.</p>

<p><strong>🔄 Cancelamento da Renovação Automática</strong><br>
Os planos da Calculadora Velotax são renovados automaticamente para sua conveniência. Caso queira desativar a renovação, siga os passos no app: 1️⃣ Impostos > DARFs para investidores > Clique no menu do lado esquerdo (≡) > Desça até Conta > Dados do Plano > Cancelar Recorrência.</p>

<p><strong>Ainda precisa de ajuda?</strong><br>
<strong>📞 Atendimento Telefônico:</strong> (Disponível de segunda à sexta, das 08h00 às 19h00 e aos sábados, das 09h00 às 15h00)<br>
📍 3003 7293 – Capitais e regiões metropolitanas<br>
📍 0800 800 0049 – Demais localidades</p>`
            },
            {
                tema: 'login-cadastro',
                titulo: 'Como faço login ou criar uma conta no aplicativo Velotax?',
                explicacao: `<p><strong>Pergunta:</strong> 'Como faço login ou criar uma conta no aplicativo Velotax?'}</p>
<p><strong>Resposta:</strong></p>
<p><strong>Dificuldade de cadastro</strong><br>
Para acessar sua conta no Velotax, siga os passos abaixo:</p>

<p>Se você já tem o app e a conta no Velotax, basta informar seu CPF e senha para acessar! Se seu dispositivo possui essa função, você pode fazer login de forma muito mais prática e segura usando a biometria!</p>

<p><strong>Criando uma conta</strong></p>
<p>Se ainda não tiver, faça o download do Velotax na App Store (iOS) ou Google Play Store (Android). Clique aqui para baixar</p>

<ol>
<li>Abra o aplicativo e clique em "Começar".</li>
<li>Se for seu primeiro acesso, crie sua conta com seu cpf e número de celular. Confirme o acesso com o SMS enviado.</li>
<li>Informe seu melhor e-mail e defina uma senha.</li>
<li>Pronto! Você criou sua conta rápido e fácil!!</li>
</ol>`
            },
            {
                tema: 'malha-fina',
                titulo: 'O que é a malha fina e como saber se minha declaração está retida?',
                explicacao: `<p><strong>Pergunta:</strong> 'O que é a malha fina e como saber se minha declaração está retida?'}</p>
<p><strong>Resposta:</strong></p>
<p>A malha fina ocorre quando a Receita Federal encontra inconsistências, erros ou falta de informações na sua declaração de Imposto de Renda. Isso pode acontecer, por exemplo, quando os dados fornecidos não correspondem ao que consta nas bases de dados da Receita📊, ou quando há divergências nos valores declarados.</p>

<p><strong>Veja alguns motivos para cair na malha fina:</strong></p>
<ul>
<li>❌ erros de digitação;</li>
<li>💲apresentação incorreta ou ilegítima de valores;</li>
<li>📉 omissão de rendimento(s);</li>
<li>📝 erros ou ausência de informações de cadastro;</li>
<li>👨‍👩‍👧 inclusão irregular de dependentes da declaração ou omissão de seus rendimentos;</li>
<li>🏥 incompatibilidade nas despesas médicas apresentadas; e</li>
<li>📑 informações divergentes das informações da fonte pagadora.</li>
</ul>

<p>Para evitar cair na malha fina, é fundamental prestar muita atenção ao preenchimento de todos os campos da sua declaração. Verifique se os valores de rendimentos, deduções e investimentos foram informados corretamente ✅, e se todos os comprovantes necessários estão em ordem. O cuidado com esses detalhes ajuda a evitar problemas futuros.</p>

<p>Caso sua declaração seja retida na malha fina, você pode verificar essa informação diretamente no aplicativo Velotax 📲 ou no site da Receita Federal clicando aqui.</p>

<p>Lembre-se⚠️: se houver pendências, será necessário regularizar a situação junto à Receita Federal para desbloquear a restituição ou evitar multas</p>`
            },
            {
                tema: 'envio-gratuito',
                titulo: 'O envio da declaração pelo app Velotax é gratuito?',
                explicacao: `<p><strong>Pergunta:</strong> 'O envio da declaração pelo app Velotax é gratuito?'}</p>
<p><strong>Resposta:</strong></p>
<p>O Velotax 📲 oferece uma plataforma simples e segura 🔒 para o preenchimento e envio da sua declaração de Imposto de Renda. Nosso serviço inclui verificação automática dos dados, suporte para esclarecer dúvidas 💬 e a facilidade de envio direto pelo aplicativo, garantindo que todo o processo seja realizado de forma correta e eficiente.</p>

<p>A taxa de serviço💵 é cobrada para cobrir os benefícios oferecidos aos nossos clientes e o valor é sempre informado antes da conclusão do envio da declaração. Além disso, o pagamento é realizado apenas quando você recebe a restituição do Imposto de Renda 💸, mas você também tem a opção de pagar na hora, se preferir.</p>`
            },
            {
                tema: 'restituicao-pendente',
                titulo: 'Porque ainda não recebi minha restituição?',
                explicacao: `<p><strong>Pergunta:</strong> 'Porque ainda não recebi minha restituição?'}</p>
<p><strong>Resposta:</strong></p>
<p>A restituição do Imposto de Renda 💰 é paga em lotes, conforme o cronograma definido pela Receita Federal. Em 2025, foram 5 📅 lotes, distribuídos entre Maio e Setembro.</p>

<p>Você pode acompanhar o status da sua restituição pelo aplicativo Velotax📲, acessando a opção "Consultar Restituição", ou diretamente no site da Receita Federal Consulta Restituição.</p>

<p><strong>🔎 Ao consultar, preste atenção ao status da sua declaração:</strong></p>
<p>"No banco de dados", "Em processamento" ou "Em fila de restituição"⏳: significa que a sua declaração ainda não foi incluída em um lote de pagamento, e é necessário aguardar a liberação.</p>

<p>"Com Pendência", indica que sua declaração apresenta irregularidades ou foi retida na malha fina. Nesse caso, será necessário regularizar a situação diretamente no site (acesse aqui), pois a restituição ficará bloqueada até que as pendências sejam resolvidas. ➡️Para maiores informações, acesse nossa FAQ: "O que é a malha fina e como saber se minha declaração está retida?"</p>

<p><strong>📌Se Você contratou o serviço de antecipação da restituição com o Velotax:</strong><br>
Quando você optou por contratar a antecipação da sua restituição de IRPF, foram exibidos dois valores na tela:</p>
<ul>
<li><strong>💵 Valor antecipado:</strong> Esse é o valor líquido que você recebeu imediatamente após a aprovação da antecipação.</li>
<li><strong>⏰ Valor em prazo normal:</strong> Esse seria o valor total que você receberia caso esperasse o pagamento conforme o calendário da Receita Federal.</li>
</ul>

<p>O valor que você recebeu como antecipação já estava líquido, ou seja, após a dedução dos custos de operação da plataforma e da linha de crédito utilizada para liberar o valor. O valor restante, que normalmente seria pago posteriormente, foi retido para cobrir esses custos operacionais e a operação de crédito.</p>

<p>✅ Assim, após a antecipação, não há mais valores pendentes a receber, pois a diferença foi utilizada para cobrir as despesas relacionadas à operação do serviço de antecipação.</p>`
            },
            {
                tema: 'restituicao-resgate',
                titulo: 'Restituição do Imposto de Renda disponível para resgate',
                explicacao: `<p><strong>Pergunta:</strong> 'Restituição do Imposto de Renda disponível para resgate'}</p>
<p><strong>Resposta:</strong></p>
<p>Se você está esperando a restituição do Imposto de Renda e o valor ainda não apareceu na sua conta, não precisa se preocupar! Em algumas situações, o valor pode não ter sido creditado diretamente na conta cadastrada e, nesse caso, fica disponível para resgate manual no site do Banco do Brasil.</p>

<p><strong>❗Ficou com alguma dúvida? 💙</strong><br>
Não se preocupe, a equipe Velotax está aqui para te ajudar! É só entrar em contato que vamos te acompanhar de pertinho, passo a passo, com todo o suporte que você precisar. 👉 Siga as orientações neste link.</p>`
            },
            {
                tema: 'open-finance',
                titulo: 'O que é Open Finance?',
                explicacao: `<p><strong>Pergunta:</strong> 'O que é Open Finance?'}</p>
<p><strong>Resposta:</strong></p>
<p>Open Finance é um jeito seguro de você compartilhar seus dados financeiros entre bancos e outras instituições, sempre com a sua permissão. 🔒</p>

<p>Na prática, isso permite juntar em um só lugar informações de contas, cartões, investimentos e empréstimos. Assim, fica muito mais fácil entender e organizar sua vida financeira.</p>

<p>Com esse compartilhamento, os bancos e financeiras conseguem entender melhor o seu perfil e, assim, oferecer produtos e serviços mais personalizados como crédito, investimentos ou seguros, muitas vezes com condições mais justas e vantajosas do que as oferecidas de forma padrão.</p>

<p>O mais importante: você tem total controle. ✅ Só compartilhe se quiser e pode cancelar a autorização a qualquer momento.</p>`
            },
            {
                tema: 'suporte',
                titulo: 'Como obter suporte no Velotax? Como falar com um atendente?',
                explicacao: `<p><strong>Pergunta:</strong> 'Como obter suporte no Velotax? Como falar com um atendente?'}</p>
<p><strong>Resposta:</strong></p>
<p>Se precisar de ajuda, não hesite em ligar para a equipe Velotax 📞 teremos prazer em te atender e te orientar passo a passo!</p>

<p>Se preferir, você também pode consultar nossa FAQ no Reclame Aqui, onde encontrará respostas rápidas para as dúvidas mais comuns 💙.</p>

<p>Caso ainda precise de suporte, você pode entrar em contato conosco pelos seguintes canais:</p>

<p><strong>🔹 📞 Atendimento Telefônico:</strong> (Disponível de segunda à sexta, das 08h00 às 19h00 e aos sábados, das 09h00 às 15h00)<br>
📍 3003 7293 – Capitais e regiões metropolitanas<br>
📍 0800 800 0049 – Demais localidades</p>

<p><strong>🔹 📱 Pelo aplicativo Velotax:</strong><br>
1️⃣ Acesse Início e cliente em Ajuda (ícone ❓ no topo do app).<br>
2️⃣ Escolha a opção que preferir, Falar no telefone, perguntar ao nosso Chatbot ou abrir chamado por lá que nosso time te responde por e-mail. Simples assim!</p>

<p><strong>🔹 📄 Formulário Web:</strong> [Clique aqui] para abrir um chamado rapidamente.</p>

<p><strong>🔹 💻 Pelo Reclame Aqui:</strong><br>
Na página inicial do Velotax no Reclame Aqui, clique em "Ir para o atendimento".</p>

<p>Estamos aqui para ajudar! 😊</p>`
            }
        ];

        const dataCriacao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        let created = 0;
        let skipped = 0;

        for (const faq of faqsToMigrate) {
            // Verificar se já existe
            if (existingFAQs.includes(faq.tema)) {
                console.log(`⏭️ FAQ "${faq.tema}" já existe, pulando...`);
                skipped++;
                continue;
            }

            try {
                const faqId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                const row = [
                    faqId,
                    faq.titulo,
                    faq.tema,
                    faq.explicacao,
                    dataCriacao,
                    dataCriacao
                ];

                await googleSheetsConfig.appendRow('FAQs!A1', row);
                console.log(`✅ FAQ "${faq.tema}" criado com sucesso`);
                created++;
                
                // Pequeno delay para evitar rate limit
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error(`❌ Erro ao criar FAQ "${faq.tema}":`, error.message);
            }
        }

        res.json({
            success: true,
            message: 'Migração concluída',
            created: created,
            skipped: skipped,
            total: faqsToMigrate.length
        });
    } catch (error) {
        console.error('❌ Erro ao migrar FAQs:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao migrar FAQs',
            message: error.message
        });
    }
});

// GET /api/faqs - Listar todos os FAQs
app.get('/api/faqs', async (req, res) => {
    try {
        console.log('📋 Endpoint /api/faqs chamado');
        
        // Tentar inicializar Google Sheets se não estiver inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await initializeGoogleSheets(envVars);
            } catch (initError) {
                console.error('❌ Erro ao inicializar Google Sheets:', initError.message);
                return res.status(503).json({
                    success: false,
                    error: 'Google Sheets não está inicializado',
                    message: initError.message
                });
            }
        }

        // Garantir que a planilha FAQs existe
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.ensureSheetExists('FAQs', [
                    'ID',
                    'Título',
                    'Tema',
                    'Explicação',
                    'Data de Criação',
                    'Data de Atualização'
                ]);
            } catch (ensureError) {
                console.warn('⚠️ Erro ao garantir existência da planilha FAQs:', ensureError.message);
                // Continuar mesmo se houver erro ao criar a planilha
            }
        }

        console.log('📖 Lendo dados da planilha FAQs...');
        let data;
        try {
            data = await googleSheetsConfig.readData('FAQs!A1:F1000');
        } catch (readError) {
            // Se a planilha não existir, retornar lista vazia
            if (readError.message && (readError.message.includes('Unable to parse range') || readError.message.includes('not found'))) {
                console.log('📭 Planilha FAQs não encontrada, retornando lista vazia');
                return res.json({
                    success: true,
                    faqs: []
                });
            }
            throw readError;
        }
        
        if (!data || data.length <= 1) {
            console.log('📭 Nenhum FAQ encontrado na planilha');
            return res.json({
                success: true,
                faqs: []
            });
        }

        console.log(`📊 ${data.length - 1} linha(s) encontrada(s) na planilha`);
        
        const faqs = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            // Pular linhas completamente vazias ou sem ID
            if (!row || row.length === 0) {
                continue;
            }
            
            // Verificar se tem pelo menos ID e Tema (colunas A e C)
            const id = String(row[0] || '').trim();
            const tema = String(row[2] || '').trim();
            
            // Pular se não tiver ID ou tema
            if (!id || !tema) {
                console.log(`⏭️ Pulando linha ${i + 1}: sem ID ou tema (ID: "${id}", Tema: "${tema}")`);
                continue;
            }
            
            // Preservar HTML da explicação sem escapar
            const explicacao = row[3] ? String(row[3]) : '';
            // Não fazer trim() aqui para preservar espaços no HTML, mas remover espaços no início/fim
            const explicacaoLimpa = explicacao.trim();
            
            faqs.push({
                id: id,
                titulo: String(row[1] || '').trim(),
                tema: tema,
                explicacao: explicacaoLimpa, // Preservar HTML
                dataCriacao: String(row[4] || '').trim(),
                dataAtualizacao: String(row[5] || '').trim()
            });
        }

        console.log(`✅ ${faqs.length} FAQ(s) processado(s)`);

        res.json({
            success: true,
            faqs: faqs
        });
    } catch (error) {
        console.error('❌ Erro ao listar FAQs:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar FAQs',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// POST /api/faqs - Criar novo FAQ
app.post('/api/faqs', rateLimitMiddleware, async (req, res) => {
    try {
        const { titulo, tema, explicacao } = req.body;

        if (!titulo || !tema) {
            return res.status(400).json({
                success: false,
                error: 'Título e tema são obrigatórios'
            });
        }

        // Tentar inicializar Google Sheets se não estiver inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await initializeGoogleSheets(envVars);
            } catch (initError) {
                console.error('❌ Erro ao inicializar Google Sheets:', initError.message);
                return res.status(503).json({
                    success: false,
                    error: 'Google Sheets não está inicializado',
                    message: initError.message
                });
            }
        }

        // Garantir que a planilha FAQs existe
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.ensureSheetExists('FAQs', [
                    'ID',
                    'Título',
                    'Tema',
                    'Explicação',
                    'Data de Criação',
                    'Data de Atualização'
                ]);
            } catch (ensureError) {
                console.warn('⚠️ Erro ao garantir existência da planilha FAQs:', ensureError.message);
            }
        }

        const faqId = Date.now().toString();
        const dataCriacao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const row = [
            faqId,
            titulo.trim(),
            tema.trim(),
            (explicacao || '').trim(),
            dataCriacao,
            dataCriacao
        ];

        await googleSheetsConfig.appendRow('FAQs!A1', row);

        res.json({
            success: true,
            message: 'FAQ criado com sucesso',
            faq: {
                id: faqId,
                titulo: titulo.trim(),
                tema: tema.trim(),
                explicacao: (explicacao || '').trim(),
                dataCriacao: dataCriacao,
                dataAtualizacao: dataCriacao
            }
        });
    } catch (error) {
        console.error('❌ Erro ao criar FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao criar FAQ',
            message: error.message
        });
    }
});

// PUT /api/faqs/:id - Atualizar FAQ existente
app.put('/api/faqs/:id', rateLimitMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, tema, explicacao } = req.body;

        if (!titulo || !tema) {
            return res.status(400).json({
                success: false,
                error: 'Título e tema são obrigatórios'
            });
        }

        // Tentar inicializar Google Sheets se não estiver inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await initializeGoogleSheets(envVars);
            } catch (initError) {
                console.error('❌ Erro ao inicializar Google Sheets:', initError.message);
                return res.status(503).json({
                    success: false,
                    error: 'Google Sheets não está inicializado',
                    message: initError.message
                });
            }
        }

        // Garantir que a planilha FAQs existe
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsIntegration.ensureSheetExists('FAQs', [
                    'ID',
                    'Título',
                    'Tema',
                    'Explicação',
                    'Data de Criação',
                    'Data de Atualização'
                ]);
            } catch (ensureError) {
                console.warn('⚠️ Erro ao garantir existência da planilha FAQs:', ensureError.message);
            }
        }

        // Ler dados atuais
        const data = await googleSheetsConfig.readData('FAQs!A1:F1000');
        
        if (!data || data.length <= 1) {
            return res.status(404).json({
                success: false,
                error: 'FAQ não encontrado'
            });
        }

        // Encontrar a linha com o ID
        let rowIndex = -1;
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i][0] && data[i][0].toString().trim() === id.toString().trim()) {
                rowIndex = i + 1; // +1 porque a linha 1 é o cabeçalho
                break;
            }
        }

        if (rowIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'FAQ não encontrado'
            });
        }

        // Obter data de criação original
        const dataCriacao = data[rowIndex - 1][4] || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const dataAtualizacao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // Atualizar a linha
        const range = `FAQs!A${rowIndex}:F${rowIndex}`;
        const values = [
            id,
            titulo.trim(),
            tema.trim(),
            (explicacao || '').trim(),
            dataCriacao,
            dataAtualizacao
        ];

        await googleSheetsConfig.updateRow(range, values);

        res.json({
            success: true,
            message: 'FAQ atualizado com sucesso',
            faq: {
                id: id,
                titulo: titulo.trim(),
                tema: tema.trim(),
                explicacao: (explicacao || '').trim(),
                dataCriacao: dataCriacao,
                dataAtualizacao: dataAtualizacao
            }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar FAQ',
            message: error.message
        });
    }
});

// DELETE /api/faqs/:id - Excluir FAQ
app.delete('/api/faqs/:id', rateLimitMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // Tentar inicializar Google Sheets se não estiver inicializado
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            console.log('🔄 Tentando inicializar Google Sheets...');
            try {
                const envVars = loadEnvFile();
                await initializeGoogleSheets(envVars);
            } catch (initError) {
                console.error('❌ Erro ao inicializar Google Sheets:', initError.message);
                return res.status(503).json({
                    success: false,
                    error: 'Google Sheets não está inicializado',
                    message: initError.message
                });
            }
        }

        // Ler dados atuais
        const data = await googleSheetsConfig.readData('FAQs!A1:F1000');
        
        if (!data || data.length <= 1) {
            return res.status(404).json({
                success: false,
                error: 'FAQ não encontrado'
            });
        }

        // Encontrar a linha com o ID
        let rowIndex = -1;
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i][0] && data[i][0].toString().trim() === id.toString().trim()) {
                rowIndex = i + 1; // +1 porque a linha 1 é o cabeçalho
                break;
            }
        }

        if (rowIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'FAQ não encontrado'
            });
        }

        // Deletar a linha usando deleteRow
        await googleSheetsConfig.deleteRow('FAQs', rowIndex);

        res.json({
            success: true,
            message: 'FAQ excluído com sucesso'
        });
    } catch (error) {
        console.error('❌ Erro ao excluir FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao excluir FAQ',
            message: error.message
        });
    }
});

// Middleware para rotas não encontradas (DEVE SER O ÚLTIMO, após TODOS os endpoints)
app.use('*', (req, res) => {
    console.log(`❌ [404] Rota não encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        message: 'A rota solicitada não existe'
    });
});

module.exports = app;

