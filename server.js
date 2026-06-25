// ===== SERVIDOR BACKEND SEGURO - VELOTAX BOT =====

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Carregar .env e config.env no process.env (mesma base usada em produção na Vercel)
try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    require('dotenv').config({ path: path.join(__dirname, 'config.env') });
} catch (dotenvErr) {
    console.warn('⚠️ dotenv não carregado:', dotenvErr.message);
}

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
const relatorioReclamacoes = require('./relatorio-reclamacoes');

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
                        moderacoes_aprovadas: 0,
                        moderacoes_negadas: 0,
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
            
            const parsed = JSON.parse(data);
            if (parsed.estatisticas) {
                if (parsed.estatisticas.moderacoes_aprovadas === undefined) parsed.estatisticas.moderacoes_aprovadas = 0;
                if (parsed.estatisticas.moderacoes_negadas === undefined) parsed.estatisticas.moderacoes_negadas = 0;
            }
            if (Array.isArray(parsed.historico_diario)) {
                parsed.historico_diario.forEach(entrada => {
                    if (entrada.moderacoes_aprovadas === undefined) entrada.moderacoes_aprovadas = 0;
                    if (entrada.moderacoes_negadas === undefined) entrada.moderacoes_negadas = 0;
                });
            }
            return parsed;
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
                moderacoes_aprovadas: 0,
                moderacoes_negadas: 0,
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
            moderacoes_aprovadas: 0,
            moderacoes_negadas: 0,
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
                moderacoes_aprovadas: 0,
                moderacoes_negadas: 0,
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
            moderacoes_aprovadas: tipo === 'moderacoes_aprovadas' ? quantidade : 0,
            moderacoes_negadas: tipo === 'moderacoes_negadas' ? quantidade : 0,
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
    
    // 🔄 SINCRONIZAR COM GOOGLE SHEETS: enviar apenas totais do DIA (controle diário)
    if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        try {
            const [a, m, d] = entradaHoje.data.split('-');
            const dataBR = `${d}/${m}/${a}`;
            const diario = {
                data: dataBR,
                respostas_coerentes: entradaHoje.respostas_coerentes || 0,
                moderacoes_coerentes: entradaHoje.moderacoes_coerentes || 0,
                moderacoes_aprovadas: entradaHoje.moderacoes_aprovadas || 0,
                moderacoes_negadas: entradaHoje.moderacoes_negadas || 0
            };
            await googleSheetsIntegration.registrarEstatisticas(diario);
            console.log('✅ Estatísticas do dia sincronizadas com Google Sheets');
        } catch (error) {
            console.error('❌ Erro ao sincronizar estatísticas com Google Sheets:', error.message);
        }
    } else {
        console.log('⚠️ Google Sheets não está ativo - estatísticas não sincronizadas');
    }
}

// ===== SISTEMA DE APRENDIZADO SEPARADO =====

// Função para extrair o primeiro nome do usuário logado (nome de exibição em respostas/e-mail)
function obterPrimeiroNomeUsuario(userData) {
    if (!userData || !userData.nome) {
        return 'Agente';
    }

    const nomeCompleto = userData.nome.trim().replace(/\s+/g, ' ');
    // Caroline Santiago: assinar e apresentar como "Carol" nas respostas geradas
    if (/^caroline\s+santiago$/i.test(nomeCompleto)) {
        return 'Carol';
    }

    const primeiroNome = nomeCompleto.split(/\s+/)[0];
    return primeiroNome || 'Agente';
}

function normalizarChavePrimeiroNome(nome) {
    if (!nome || typeof nome !== 'string') return '';
    const primeiro = nome.trim().split(/\s+/)[0] || '';
    return primeiro.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function inferirGeneroPorNomeExibicao(nomeExibicao, userData) {
    if (userData) {
        const g = String(userData.genero || userData.sexo || '').toLowerCase();
        if (['f', 'feminino', 'mulher', 'fem'].includes(g)) return 'F';
        if (['m', 'masculino', 'homem', 'masc'].includes(g)) return 'M';
    }
    if (!nomeExibicao || String(nomeExibicao).trim() === '' || nomeExibicao === 'Agente') return 'M';
    const key = normalizarChavePrimeiroNome(nomeExibicao);
    const feminino = new Set(['carol', 'caroline', 'nayara', 'ana', 'maria', 'julia', 'juliana', 'fernanda', 'patricia', 'amanda', 'camila', 'lais', 'luana', 'bruna', 'beatriz', 'lara', 'laura', 'paula', 'monica', 'janaina', 'taina', 'raquel', 'ingrid', 'deborah', 'debora', 'bianca', 'solange', 'vanessa', 'aline', 'priscila', 'roberta', 'tatiana', 'adriana', 'fabiana', 'liliane', 'simone', 'gabriela', 'daniela', 'leticia', 'tamires', 'jessica', 'carla', 'viviane', 'ariane', 'milene', 'mariana', 'renata', 'cristina', 'silvana', 'suelen', 'thais', 'yasmim', 'yasmin', 'brenda', 'tamara', 'michelle', 'sheila', 'rosana', 'lidiane', 'mayara', 'dayane', 'graziela', 'tainara', 'samara', 'valeria', 'claudia', 'eliane', 'karina', 'sabrina']);
    const masculino = new Set(['octavio', 'marcos', 'carlos', 'paulo', 'joao', 'pedro', 'lucas', 'gabriel', 'rafael', 'daniel', 'bruno', 'felipe', 'andre', 'ricardo', 'rodrigo', 'thiago', 'gustavo', 'leonardo', 'matheus', 'mateus', 'marcelo', 'vinicius', 'renan', 'eduardo', 'fernando', 'fabricio', 'alexandre', 'diego', 'igor', 'samuel', 'henrique', 'antonio', 'caio', 'murilo', 'sergio', 'jorge', 'william', 'guilherme', 'caua', 'enzo', 'otavio', 'alan', 'julio', 'jonathan', 'wagner', 'kleber', 'fabio', 'rogerio', 'claudio']);
    const masculinoComA = new Set(['luca', 'isaque', 'isaac', 'josu', 'josue', 'tobias', 'abias', 'elias', 'jonas', 'mathias']);
    if (feminino.has(key)) return 'F';
    if (masculino.has(key)) return 'M';
    if (key.length >= 3 && key.endsWith('a') && !masculinoComA.has(key)) return 'F';
    return 'M';
}

function obterArtigoDefinidoAgente(nomeExibicao, userData) {
    if (!nomeExibicao || String(nomeExibicao).trim() === '' || nomeExibicao === 'Agente') return null;
    return inferirGeneroPorNomeExibicao(nomeExibicao, userData) === 'F' ? 'a' : 'o';
}

/** Troca travessoes e hifens usados como pausa (estilo IA) por virgula; mantem telefones e palavras compostas. */
function humanizarPontuacaoGerada(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    let t = texto.replace(/\u2014/g, ', ').replace(/\u2013/g, ', ').replace(/\u2012/g, ', ');
    t = t.replace(/\s+--\s+/g, ', ').replace(/\s+-\s+/g, ', ');
    t = t.replace(/,\s*,+/g, ', ');
    return t;
}

/** Verifica se a resposta reflete a solução implementada (não exige cópia literal). */
function respostaRefleteSolucaoImplementada(resposta, solucaoImplementada) {
    if (!solucaoImplementada || !String(solucaoImplementada).trim()) return true;
    if (!resposta || typeof resposta !== 'string') return false;

    const sol = String(solucaoImplementada).toLowerCase().trim();
    const resp = resposta.toLowerCase();

    const trechoDireto = sol.length <= 50 ? sol : sol.substring(0, 50);
    if (resp.includes(trechoDireto)) return true;

    const stopwords = new Set([
        'para', 'como', 'sobre', 'apos', 'após', 'desde', 'pela', 'pelo', 'pelas', 'pelos',
        'com', 'sem', 'que', 'uma', 'uns', 'uma', 'uns', 'das', 'dos', 'nos', 'nas', 'foi',
        'ser', 'esta', 'está', 'este', 'essa', 'esse', 'isso', 'caso', 'cliente', 'velotax'
    ]);
    const palavras = sol
        .split(/\s+/)
        .map(p => p.replace(/[^a-záàâãéêíóôõúç0-9]/gi, ''))
        .filter(p => p.length >= 4 && !stopwords.has(p));

    if (palavras.length === 0) {
        return resp.includes(sol.substring(0, Math.min(25, sol.length)));
    }

    const correspondencias = palavras.filter(p => resp.includes(p)).length;
    const minimo = Math.max(2, Math.ceil(palavras.length * 0.35));
    return correspondencias >= minimo;
}

function normalizarTextoTipo(t) {
    return String(t || '').toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Similaridade Jaccard entre duas solicitações (palavras significativas, sem acento). 0 a 1. */
function calcularSimilaridadeSolicitacao(textoA, textoB) {
    const stopwords = new Set([
        'para', 'como', 'sobre', 'apos', 'desde', 'pela', 'pelo', 'pelas', 'pelos', 'com', 'sem',
        'que', 'uma', 'uns', 'das', 'dos', 'nos', 'nas', 'foi', 'ser', 'esta', 'este', 'essa',
        'esse', 'isso', 'caso', 'velotax', 'meu', 'minha', 'mas', 'por', 'dia', 'fiz', 'sou'
    ]);
    const tokenizar = (t) => new Set(
        normalizarTextoTipo(t)
            .split(/\s+/)
            .map(p => p.replace(/[^a-z0-9]/gi, ''))
            .filter(p => p.length >= 4 && !stopwords.has(p))
    );
    const a = tokenizar(textoA);
    const b = tokenizar(textoB);
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

/** Ordena modelos coerentes pela semelhança com o caso atual (mais parecido primeiro).
 *  Combina a semelhança da RECLAMAÇÃO (peso alto) com o MOTIVO da solicitação (peso médio),
 *  para localizar casos com o mesmo CONTEXTO e os mesmos MOTIVOS, não apenas palavras iguais. */
function ordenarModelosPorSimilaridade(modelos, dadosFormulario) {
    const textoAtual = dadosFormulario?.texto_cliente || '';
    const motivoAtual = dadosFormulario?.motivo_solicitacao || dadosFormulario?.motivoSolicitacao || '';
    return (modelos || [])
        .map(m => {
            const textoModelo = m['Texto Cliente'] || m.dadosFormulario?.texto_cliente || '';
            const motivoModelo = m['Motivo Solicitação'] || m.motivo_solicitacao || m.dadosFormulario?.motivo_solicitacao || '';
            const simTexto = calcularSimilaridadeSolicitacao(textoModelo, textoAtual);
            const simMotivo = motivoAtual ? calcularSimilaridadeSolicitacao(motivoModelo, motivoAtual) : 0;
            // Reclamação = peso alto (0.7); motivo = peso médio (0.3). Se não houver motivo, usa só a reclamação.
            const similaridade = motivoAtual ? (simTexto * 0.7 + simMotivo * 0.3) : simTexto;
            return { modelo: m, similaridade, simTexto, simMotivo };
        })
        .sort((x, y) => y.similaridade - x.similaridade);
}

// ===== MANUAIS DE MODERAÇÃO DO RECLAME AQUI (base normativa) =====
const MANUAIS_MODERACAO_FILE = path.join(__dirname, 'manuais-reclame-aqui', 'manuais-moderacao.json');
let _manuaisModeracaoCache; // undefined = não lido ainda; null = inexistente/vazio; objeto = carregado

/** Carrega a base normativa estruturada dos manuais (cache em memória). Retorna null se vazia/ausente. */
function carregarManuaisModeracao() {
    if (_manuaisModeracaoCache !== undefined) return _manuaisModeracaoCache;
    try {
        if (!fs.existsSync(MANUAIS_MODERACAO_FILE)) {
            _manuaisModeracaoCache = null;
            return null;
        }
        const data = JSON.parse(fs.readFileSync(MANUAIS_MODERACAO_FILE, 'utf8'));
        const manuais = Array.isArray(data?.manuais) ? data.manuais : [];
        const totalHipoteses = manuais.reduce((n, m) => n + (m.hipoteses?.length || 0), 0);
        const totalRegras = Array.isArray(data?.regrasAENV) ? data.regrasAENV.length : 0;
        _manuaisModeracaoCache = (totalHipoteses > 0 || totalRegras > 0) ? data : null;
        if (_manuaisModeracaoCache) {
            console.log(`📚 Manuais de moderação carregados: ${manuais.length} manuais, ${totalHipoteses} temas, ${totalRegras} regras AENV`);
        } else {
            console.log('📚 manuais-moderacao.json presente, porém sem conteúdo preenchido — base normativa inativa');
        }
        return _manuaisModeracaoCache;
    } catch (e) {
        console.error('❌ Erro ao carregar manuais de moderação:', e.message);
        _manuaisModeracaoCache = null;
        return null;
    }
}

/** Seleciona hipóteses de manual relevantes ao caso (por palavras-chave/motivo). */
function selecionarRegrasManual(textoCaso, motivo, { paraRespostaRA = false, limite = 6 } = {}) {
    const base = carregarManuaisModeracao();
    if (!base) return [];
    const alvo = normalizarTextoTipo(`${textoCaso || ''} ${motivo || ''}`);
    const motivoNorm = normalizarTextoTipo(motivo || '');
    const resultados = [];
    for (const manual of base.manuais || []) {
        for (const hip of manual.hipoteses || []) {
            if (paraRespostaRA && hip.aplicaRespostaRA !== true) continue;
            const chaves = (hip.palavrasChave || []).map(normalizarTextoTipo);
            let score = 0;
            for (const ch of chaves) {
                if (ch && alvo.includes(ch)) score += 2;
            }
            if (motivoNorm && normalizarTextoTipo(hip.id || '').includes(motivoNorm)) score += 3;
            if (score > 0 || paraRespostaRA) {
                resultados.push({ manual: manual.nome, manualId: manual.id, hip, score });
            }
        }
    }
    resultados.sort((a, b) => b.score - a.score);
    return resultados.slice(0, limite);
}

/** Bloco de fundamentação normativa para prompts de MODERAÇÃO. Vazio se base inativa. */
function montarBlocoManuaisModeracao(textoCaso, motivo) {
    const regras = selecionarRegrasManual(textoCaso, motivo, { paraRespostaRA: false, limite: 6 });
    if (regras.length === 0) return '';
    let bloco = '\n📚 BASE NORMATIVA — MANUAIS DO RA (hipóteses aplicáveis a este caso):\n';
    bloco += 'Use estas hipóteses REAIS como fundamento. Só cite uma hipótese se os fatos do caso a sustentarem.\n\n';
    regras.forEach((r, i) => {
        bloco += `${i + 1}. [${r.manual}] ${r.hip.titulo}\n`;
        const meta = [];
        if (r.hip.categoria) meta.push(`Categoria: ${r.hip.categoria}`);
        if (r.hip.acao) meta.push(`Ação do RA: ${r.hip.acao}`);
        if (r.hip.status) meta.push(`Status exigido: ${r.hip.status}`);
        if (r.hip.prazoSolicitacao) meta.push(`Prazo: ${r.hip.prazoSolicitacao}`);
        if (meta.length) bloco += `   ${meta.join(' | ')}\n`;
        if (r.hip.quandoSeAplica) bloco += `   Quando se aplica: ${r.hip.quandoSeAplica}\n`;
        if (Array.isArray(r.hip.criterios) && r.hip.criterios.length) {
            bloco += `   Critérios: ${r.hip.criterios.join('; ')}\n`;
        }
        if (r.hip.comoCitar) bloco += `   Como citar: "${r.hip.comoCitar}"\n`;
        bloco += '\n';
    });
    const { regras: regrasAENV } = obterRegrasAENV();
    if (regrasAENV.length > 0) {
        bloco += '⚠️ REGRAS QUE O RA USA PARA NEGAR (garanta que o pedido NÃO esbarre nelas):\n';
        regrasAENV.forEach((r) => { bloco += `- ${r.titulo}: ${r.reprovaQuando}\n`; });
        bloco += '\n';
    }
    bloco += '🎯 Fundamente a moderação em UMA hipótese acima que os fatos sustentem; cite o manual exatamente como indicado, sem inventar regra.\n';
    return bloco;
}

/** Retorna as regras da categoria AENV (bloqueadores de moderação) e requisitos. */
function obterRegrasAENV() {
    const base = carregarManuaisModeracao();
    if (!base) return { regras: [], requisitos: [] };
    return {
        regras: Array.isArray(base.regrasAENV) ? base.regrasAENV : [],
        requisitos: Array.isArray(base.requisitosAENV) ? base.requisitosAENV : []
    };
}

/** Checklist de conformidade para prompts de RESPOSTA RA. Vazio se base inativa. */
function montarChecklistConformidadeRA(textoCaso, motivo) {
    const { regras } = obterRegrasAENV();
    const temas = selecionarRegrasManual(textoCaso, motivo, { paraRespostaRA: false, limite: 3 });
    if (regras.length === 0 && temas.length === 0) return '';

    let bloco = '\n✅ PADRÃO DE CONFORMIDADE COM OS MANUAIS DO RA (escreva a resposta JÁ favorável a uma eventual moderação, sem trair os fatos):\n';
    bloco += 'A resposta responde ao cliente E, ao mesmo tempo, deve nascer dentro do padrão que o Reclame Aqui aceita para moderar uma avaliação negativa. Para isso:\n';
    regras.forEach((r) => {
        if (r.regraRespostaRA) bloco += `- ${r.regraRespostaRA}\n`;
    });
    if (temas.length > 0) {
        bloco += 'Temas do RA possivelmente relacionados a este caso (enquadre quando os fatos da solução implementada sustentarem; não force):\n';
        temas.forEach((t) => {
            bloco += `- ${t.hip.titulo}: ${t.hip.quandoSeAplica}\n`;
            if (t.hip.regraRespostaRA) {
                bloco += `  Como redigir para este tema: ${t.hip.regraRespostaRA}\n`;
            }
        });
    }
    bloco += 'DIRETRIZES DE ESCRITA FAVORÁVEL À MODERAÇÃO (sem inventar nada além da solução implementada):\n';
    bloco += '- Seja concreto e objetivo: cite as datas, ações e procedimentos REAIS que constam na solução implementada (nada genérico como "entraremos em contato" ou "realizamos os retornos necessários").\n';
    bloco += '- Deixe o fato autoevidente no próprio texto, de modo que a inconsistência ou a omissão do cliente fique clara para o moderador SEM precisar julgar versões.\n';
    bloco += '- Quando a solução implementada sustentar, evidencie de forma factual o ponto em que o relato do cliente está incorreto, incompleto ou já foi atendido, sem redescrever a dor dele e sem acusá-lo.\n';
    bloco += '- Não admita falha de atendimento, demora ou informação incorreta da empresa; demonstre que o Velotax atuou corretamente.\n';
    bloco += '- Não se apoie apenas em "cláusula contratual aceita" nem em "já resolvemos": fundamente pela operação/fatos e pela regulamentação aplicável quando constar na solução.\n';
    bloco += 'Mantenha o tom natural, humano e a estrutura habitual da resposta; estas diretrizes ajustam a forma de redigir, não contradizem nem substituem a solução implementada.\n\n';
    return bloco;
}

/** Bloco de base normativa para a ANÁLISE DE CHANCE de moderação (temas + regras AENV + requisitos). */
function montarBlocoChanceModeracao(textoCaso, motivo) {
    const base = carregarManuaisModeracao();
    if (!base) return '';
    const { regras, requisitos } = obterRegrasAENV();
    const temas = selecionarRegrasManual(textoCaso, motivo, { paraRespostaRA: false, limite: 6 });

    let bloco = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    bloco += '📚 BASE NORMATIVA REAL DOS MANUAIS DO RA (use para calcular a chance real, não suposições):\n';
    bloco += 'Categoria principal da Velotax: "A empresa não violou o direito do consumidor" (AENV).\n\n';

    if (requisitos.length > 0) {
        bloco += 'REQUISITOS DA CATEGORIA AENV (se faltar algum, a moderação tende a não ocorrer):\n';
        requisitos.forEach((r) => { bloco += `- ${r}\n`; });
        bloco += '\n';
    }

    if (regras.length > 0) {
        bloco += '6 REGRAS QUE BLOQUEIAM A MODERAÇÃO (cada regra reprovada REDUZ a chance de aceite — penalização gradual, não zera automaticamente):\n';
        regras.forEach((r, i) => {
            bloco += `${i + 1}. ${r.titulo} — reprova quando: ${r.reprovaQuando}\n`;
        });
        bloco += '\n';
    }

    if (temas.length > 0) {
        bloco += 'TEMAS PASSÍVEIS possivelmente relacionados a este caso (havendo tema aplicável, a chance sobe; sem tema, a chance cai):\n';
        temas.forEach((t) => {
            bloco += `- ${t.hip.titulo}: ${t.hip.quandoSeAplica}`;
            if (Array.isArray(t.hip.criterios) && t.hip.criterios.length) {
                bloco += ` (critérios: ${t.hip.criterios.join('; ')})`;
            }
            bloco += `\n  Como citar: "${t.hip.comoCitar}"\n`;
        });
        bloco += '\n';
    }

    bloco += 'COMO CALCULAR A CHANCE REAL (combine com as faixas da ETAPA 9):\n';
    bloco += '- Há tema passível aplicável + reclamação avaliada e no prazo? → base da chance.\n';
    bloco += '- Para cada regra AENV reprovada (falha de atendimento, divergência, mérito, cláusula, resposta genérica), reduza a chance proporcionalmente à gravidade.\n';
    bloco += '- A chance final deve refletir a probabilidade REAL de o RA aceitar, não o risco reputacional.\n';
    bloco += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    return bloco;
}

/**
 * ETAPA 0 — Lê a aba "Moderações", filtra Status Aprovação = "Aprovada" na janela móvel
 * e retorna os casos APROVADOS mais semelhantes ao caso atual (histórico real para calibração).
 */
async function carregarModeracoesAprovadasSimilares(textoCaso, limite = 5) {
    try {
        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) return [];
        const dados = await googleSheetsConfig.readData('Moderações!A1:O5000');
        if (!dados || dados.length <= 1) return [];
        const headers = dados[0].map(h => String(h || '').trim());
        const config = obterConfigAprendizado();
        const registros = [];
        for (let i = 1; i < dados.length; i++) {
            const row = dados[i];
            if (!row || !row.some(c => c !== undefined && c !== '')) continue;
            const obj = {};
            headers.forEach((h, idx) => { if (h) obj[h] = row[idx] !== undefined ? row[idx] : ''; });
            const status = String(obj['Status Aprovação'] || '').trim().toLowerCase();
            if (!status.includes('aprov')) continue; // somente "Aprovada"
            if (!registroDentroJanelaAprendizado(obj, config)) continue;
            registros.push(obj);
        }
        const alvo = textoCaso || '';
        return registros
            .map(r => ({
                registro: r,
                similaridade: calcularSimilaridadeSolicitacao(
                    `${r['Solicitação Cliente'] || ''} ${r['Resposta Empresa'] || ''}`,
                    alvo
                )
            }))
            .filter(x => x.similaridade > 0.08)
            .sort((a, b) => b.similaridade - a.similaridade)
            .slice(0, limite);
    } catch (e) {
        console.error('❌ Erro ao carregar moderações aprovadas (calibração histórica):', e.message);
        return [];
    }
}

/** Bloco de dados da ETAPA 0 — casos aprovados reais semelhantes. Vazio se não houver. */
function montarBlocoCalibracaoHistorica(casosSimilares) {
    if (!Array.isArray(casosSimilares) || casosSimilares.length === 0) return '';
    const trunc = (t, n) => {
        const s = String(t || '').replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n) + '…' : s;
    };
    let bloco = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    bloco += '📚 HISTÓRICO REAL DE MODERAÇÕES APROVADAS (aba "Moderações", Status = Aprovada) — casos semelhantes ao atual, para a ETAPA 0:\n';
    bloco += `Foram encontrados ${casosSimilares.length} caso(s) aprovado(s) semelhante(s). Use SOMENTE para calibrar a estimativa FINAL conforme as regras da ETAPA 0; os manuais continuam sendo a fonte principal.\n\n`;
    casosSimilares.forEach((c, i) => {
        const r = c.registro;
        bloco += `CASO ${i + 1} (similaridade ${Math.round(c.similaridade * 100)}%):\n`;
        bloco += `- Tipo: ${trunc(r['Tipo'], 60) || 'N/A'}\n`;
        bloco += `- Motivo da moderação: ${trunc(r['Motivo Moderação'], 140) || 'N/A'}\n`;
        bloco += `- Solicitação do cliente: ${trunc(r['Solicitação Cliente'], 300) || 'N/A'}\n`;
        bloco += `- Resposta da empresa: ${trunc(r['Resposta Empresa'], 300) || 'N/A'}\n`;
        bloco += '\n';
    });
    bloco += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    return bloco;
}

/** Configuração da janela de aprendizado (planilha) — janela móvel, sem corte fixo por padrão. */
function obterConfigAprendizado() {
    const env = loadEnvFile();
    const janelaDias = parseInt(env.APRENDIZADO_JANELA_DIAS, 10) || 90;
    const dataMinimaStr = (env.APRENDIZADO_DATA_MINIMA || '').trim();
    const filtroQualidade = env.APRENDIZADO_FILTRO_QUALIDADE !== 'false';
    let dataMinima = null;
    if (dataMinimaStr && dataMinimaStr.toLowerCase() !== 'none' && dataMinimaStr.toLowerCase() !== 'off') {
        const m = dataMinimaStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
            dataMinima = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        }
    }
    return { janelaDias, dataMinima, filtroQualidade };
}

function parseDataRegistroPlanilha(registro) {
    const raw = registro['Data/Hora'] || registro['Data do Registro'] || registro.timestamp || registro[0] || '';
    if (!raw) return null;
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const iso = new Date(s);
    return isNaN(iso.getTime()) ? null : iso;
}

function registroDentroJanelaAprendizado(registro, config) {
    const data = parseDataRegistroPlanilha(registro);
    if (!data) return false;
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    if (config.dataMinima && data < config.dataMinima) return false;
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() - config.janelaDias);
    limite.setHours(0, 0, 0, 0);
    return data >= limite && data <= hoje;
}

function textoTemTomAntigoAprendizado(texto) {
    if (!texto || typeof texto !== 'string') return false;
    const t = texto.toLowerCase();
    return [
        'agradecemos', 'agradeço', 'lamentamos', 'sentimos muito', 'pedimos desculpas',
        'recebemos sua manifestação', 'agradecemos a oportunidade', 'compreendemos o transtorno'
    ].some(p => t.includes(p));
}

function textoCitaLegalSemSolucao(resposta, solucao) {
    if (!resposta) return false;
    const r = resposta.toLowerCase();
    const termos = ['lgpd', 'ccb', 'código de defesa', 'codigo de defesa', 'cdc', 'cláusula', 'clausula'];
    if (!termos.some(term => r.includes(term))) return false;
    const s = (solucao || '').toLowerCase();
    return !termos.some(term => s.includes(term));
}

function registroQualidadeAprendizado(registro, tipo) {
    const solucao = registro['Solução Implementada'] || registro.solucao_implementada
        || registro.dadosFormulario?.solucao_implementada || '';
    const texto = tipo === 'feedback'
        ? (registro['Resposta Reformulada'] || registro.respostaReformulada || '')
        : (registro['Resposta Aprovada'] || registro.respostaAprovada || '');
    if (textoTemTomAntigoAprendizado(texto)) return false;
    if (textoCitaLegalSemSolucao(texto, solucao)) return false;
    if (solucao && respostaRefleteSolucaoImplementada(texto, solucao) === false) return false;
    return true;
}

function filtrarRegistrosAprendizado(registros, tipo) {
    const config = obterConfigAprendizado();
    const antes = registros.length;
    let filtrados = registros.filter(r => registroDentroJanelaAprendizado(r, config));
    const aposJanela = filtrados.length;
    if (config.filtroQualidade) {
        filtrados = filtrados.filter(r => registroQualidadeAprendizado(r, tipo));
    }
    if (antes > filtrados.length) {
        const corteExtra = config.dataMinima ? `, mínimo ${config.dataMinima.toLocaleDateString('pt-BR')}` : '';
        console.log(`📅 Aprendizado [${tipo}]: ${antes} → ${filtrados.length} (janela móvel ${config.janelaDias}d${corteExtra}, qualidade=${config.filtroQualidade})`);
    }
    return filtrados;
}

function montarTextoFallbackRespostaRA(dadosFormulario) {
    const solucao = (dadosFormulario.solucao_implementada || '').trim();
    const historico = (dadosFormulario.historico_atendimento || '').trim();
    const observacoes = (dadosFormulario.observacoes_internas || '').trim();
    const partes = [];

    const minuscularInicio = (t) => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    const garantirPonto = (t) => t.endsWith('.') || t.endsWith('!') || t.endsWith('?') ? t : t + '.';

    if (solucao) {
        partes.push(`Sobre a sua solicitação, esclarecemos que ${garantirPonto(minuscularInicio(solucao))}`);
    }

    if (historico && historico.toLowerCase() !== 'nenhum') {
        partes.push(`Considerando o histórico do atendimento, ${garantirPonto(minuscularInicio(historico))}`);
    }

    if (observacoes && observacoes.toLowerCase() !== 'nenhuma') {
        partes.push(garantirPonto(observacoes));
    }

    if (partes.length === 0) {
        partes.push('A sua solicitação foi analisada e a solução registrada foi implementada conforme os procedimentos do Velotax.');
    }

    partes.push('Permanecemos à disposição para qualquer esclarecimento adicional sobre o caso.');

    return partes.join('\n\n');
}

function normalizarNomeVelotax(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    const urls = [];
    let t = texto.replace(/(https?:\/\/[^\s]+|www\.velotax\.com\.br)/gi, (match) => {
        urls.push(match);
        return `\x00URL${urls.length - 1}\x00`;
    });
    t = t.replace(/\b(?:a|A) Velotax\b/g, 'o Velotax');
    t = t.replace(/\b(?:ao|Ao) Velotax\b/g, 'ao Velotax');
    t = t.replace(/\b(?:da|Da) Velotax\b/g, 'do Velotax');
    t = t.replace(/\b(?:das|Das) Velotax\b/g, 'dos Velotax');
    t = t.replace(/\b(?:na|Na) Velotax\b/g, 'no Velotax');
    t = t.replace(/\b(?:nas|Nas) Velotax\b/g, 'nos Velotax');
    t = t.replace(/\b(?:pela|Pela) Velotax\b/g, 'pelo Velotax');
    t = t.replace(/\b(?:pelas|Pelas) Velotax\b/g, 'pelos Velotax');
    t = t.replace(/\b(?:uma|Uma) Velotax\b/g, 'um Velotax');
    t = t.replace(/\bvelotax\b/gi, 'Velotax');
    t = t.replace(/\x00URL(\d+)\x00/g, (_, i) => urls[Number(i)]);
    return t;
}

function reduzirAgradecimentosExcessivos(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    const padroesAgradecimento = [
        /[^.!?\n]*\b(?:agradecemos|agradeço|agradece|obrigad[oa])\b[^.!?\n]*[.!?]\s*/gi,
        /[^.!?\n]*\b(?:pela (?:preocupa(?:ção|co)|confiança|oportunidade de esclarecimento|sua manifestação))\b[^.!?\n]*[.!?]\s*/gi,
        /[^.!?\n]*\brecebemos sua manifestação\b[^.!?\n]*[.!?]\s*/gi,
    ];
    let t = texto;
    for (const padrao of padroesAgradecimento) {
        t = t.replace(padrao, '');
    }
    return t.replace(/\n{3,}/g, '\n\n').trim();
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

// Extrair nome do cliente e do agente da resposta pública da empresa (para preservar na reformulação)
function extrairNomesDaRespostaPublica(respostaPublica) {
    const out = { nomeCliente: null, nomeAgente: null };
    if (!respostaPublica || typeof respostaPublica !== 'string') return out;
    const texto = respostaPublica.trim();

    // Nome do cliente: "Olá, Nome!" ou "Prezado(a) Nome"
    const matchCliente = texto.match(/Olá,?\s+([^!?\n]+?)\s*[!?.]?\s*(\n|$)/i)
        || texto.match(/Prezad[oa](?:\(a\))?\s+([^,!\n]+?)[,!.]?\s*(\n|$)/i);
    if (matchCliente && matchCliente[1]) {
        const nome = matchCliente[1].trim();
        if (nome.length <= 60 && !/^\d+$/.test(nome) && nome.toLowerCase() !== 'cliente') {
            out.nomeCliente = nome;
        }
    }

    // Nome do agente: "Sou [Nome], analista" (ou legado: especialista/atendente)
    const matchAgente = texto.match(/Sou\s+(?:(?:o|a)\s+)?([^,]+),\s*(?:analista|especialista|atendente)/i);
    if (matchAgente && matchAgente[1]) {
        const nome = matchAgente[1].trim();
        if (nome.length <= 60 && !/^\d+$/.test(nome) && nome.toLowerCase() !== 'agente') {
            out.nomeAgente = nome;
        }
    }
    // Fallback: assinatura "Atenciosamente,\nNome"
    if (!out.nomeAgente) {
        const matchAssinatura = texto.match(/Atenciosamente,?\s*\n\s*([^\n]+?)\s*\n\s*Equipe/i);
        if (matchAssinatura && matchAssinatura[1]) {
            const nome = matchAssinatura[1].trim();
            if (nome.length <= 60 && !/^\d+$/.test(nome) && nome.toLowerCase() !== 'agente') {
                out.nomeAgente = nome;
            }
        }
    }

    return out;
}

/** Remove saudação, apresentação, contatos e assinatura — retorna só o miolo para aprendizado/cópia. */
function extrairMioloRespostaRA(respostaTexto) {
    if (!respostaTexto || typeof respostaTexto !== 'string') return respostaTexto || '';

    let textoLimpo = humanizarPontuacaoGerada(respostaTexto).trim();

    textoLimpo = textoLimpo.replace(/^(Olá|Oi|Prezado\(a\)?\s+cliente|Prezado\s+cliente|Prezada\s+cliente)[^!\n]*[!.,]\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou\s+(?:(?:o|a)\s+)?[^,]+,\s+(?:especialista|analista)[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^[^,]+,\s+(?:especialista|analista)\s+de\s+atendimento[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou analista de atendimento do Velotax\.\s*Recebemos[^.]*\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Sou analista de atendimento do Velotax\.\s*/i, '');
    textoLimpo = textoLimpo.replace(/^Espero\s+que\s+esteja\s+bem[.!]?\s*/i, '');
    textoLimpo = textoLimpo.replace(/^[^.]*recebemos\s+sua\s+manifestação[^.]*\.\s*/i, '');

    textoLimpo = reduzirAgradecimentosExcessivos(textoLimpo);

    textoLimpo = textoLimpo.replace(/\n*Permanecemos\s+à\s+disposição[^.]*\.\s*/gi, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*3003-7293[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*📞\s*0800-800-0049[^\n]*\n*/g, '');
    textoLimpo = textoLimpo.replace(/\n*🌐\s*www\.velotax\.com\.br\s*/g, '');
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*[^\n]*\s*\n*Equipe\s+de\s+Atendimento[^\n]*$/i, '');
    textoLimpo = textoLimpo.replace(/\n*Atenciosamente,?\s*\n*Equipe\s+Velotax\s*$/i, '');

    return normalizarNomeVelotax(textoLimpo.replace(/\n{3,}/g, '\n\n').trim());
}

// Função para formatar resposta RA com a estrutura solicitada
function formatarRespostaRA(respostaTexto, nomeCliente, nomeAgente, userData) {
    if (!respostaTexto || typeof respostaTexto !== 'string') {
        return respostaTexto;
    }
    respostaTexto = humanizarPontuacaoGerada(respostaTexto);

    // Garantir que temos um nome de agente válido
    if (!nomeAgente || nomeAgente.trim() === '') {
        nomeAgente = 'Agente';
    }
    
    const linhaApresentacaoAgente = () => {
        if (nomeAgente === 'Agente') {
            return 'Sou analista de atendimento do Velotax.';
        }
        const art = obterArtigoDefinidoAgente(nomeAgente, userData);
        return `Sou ${art} ${nomeAgente}, analista de atendimento do Velotax.`;
    };
    
    // Se a resposta já estiver formatada com a estrutura completa, verificar e atualizar se necessário
    const jaTemEstruturaCompleta = respostaTexto.includes('Permanecemos à disposição por meio de nossos canais oficiais') ||
        respostaTexto.includes('3003-7293') ||
        respostaTexto.includes('0800-800-0049');
    
    if (jaTemEstruturaCompleta) {
        // Verificar se a estrutura está completa e correta
        const temSaudacao = /Olá,\s+[^!]+!/.test(respostaTexto);
        const temApresentacao = /Sou\s+(?:(?:o|a)\s+)?[^,]+,?\s+(?:analista|especialista)\s+de\s+atendimento/i.test(respostaTexto)
            || /Sou analista de atendimento do Velotax/i.test(respostaTexto);
        const temContato = respostaTexto.includes('3003-7293') && respostaTexto.includes('0800-800-0049');
        const temAssinatura = /Atenciosamente,/.test(respostaTexto);
        
        // Se já tem estrutura completa e correta, apenas atualizar nome do agente se necessário
        if (temSaudacao && temApresentacao && temContato && temAssinatura) {
            if (nomeAgente !== 'Agente') {
                const art = obterArtigoDefinidoAgente(nomeAgente, userData);
                respostaTexto = respostaTexto.replace(
                    /Sou\s+(?:(?:o|a)\s+)?[^,]+,\s+(?:especialista|analista)/gi,
                    `Sou ${art} ${nomeAgente}, analista`
                );
                respostaTexto = respostaTexto.replace(/Atenciosamente,\s*\n\s*[^\n]+\s*\n\s*Equipe de Atendimento Velotax/g, 
                    `Atenciosamente,\n${nomeAgente} \nEquipe de Atendimento Velotax`);
            }
            return normalizarNomeVelotax(humanizarPontuacaoGerada(respostaTexto));
        }
        // Se tem estrutura mas está incompleta, remover e refazer
    }

    const textoLimpo = extrairMioloRespostaRA(respostaTexto);

    // Usar nome do cliente se disponível, senão usar "cliente"
    const saudacaoCliente = nomeCliente && nomeCliente.trim() !== '' ? nomeCliente : 'cliente';
    
    // Construir a resposta formatada com a estrutura completa
    const respostaFormatada = `Olá, ${saudacaoCliente}!

Espero que esteja bem.

${linhaApresentacaoAgente()}  

${textoLimpo}



Permanecemos à disposição por meio de nossos canais oficiais de atendimento:


📞 3003-7293 (capitais e regiões metropolitanas)
📞 0800-800-0049 (demais localidades)
🌐 www.velotax.com.br

Atenciosamente,
${nomeAgente} 
Equipe de Atendimento Velotax`;

    return normalizarNomeVelotax(humanizarPontuacaoGerada(respostaFormatada));
}

/** Classifica a disponibilidade da Solução Implementada para a camada de fallback. */
function avaliarDisponibilidadeSolucao(solucao) {
    const s = String(solucao || '').trim();
    if (s.length === 0) return 'vazia';
    const palavras = s.split(/\s+/).filter(p => p.replace(/[^a-zA-Z0-9á-úÁ-Ú]/g, '').length >= 3);
    if (palavras.length < 6 || s.length < 40) return 'parcial';
    return 'completa';
}

/** Camada de fallback: define como usar a base "Respostas Coerentes" conforme a disponibilidade da Solução Implementada. */
function montarBlocoFallbackCoerentes(dadosFormulario) {
    const nivel = avaliarDisponibilidadeSolucao(dadosFormulario?.solucao_implementada);
    let bloco = '\n🔁 CAMADA DE FALLBACK — USO DA BASE "RESPOSTAS COERENTES" CONFORME A SOLUÇÃO IMPLEMENTADA:\n';
    bloco += 'PRIORIDADE DAS FONTES (sempre nesta ordem): 1) Reclamação do consumidor; 2) Solução implementada; 3) base "Respostas Coerentes" (apoio).\n';
    if (nivel === 'completa') {
        bloco += 'SITUAÇÃO DETECTADA: Solução implementada COMPLETA. Siga o fluxo padrão e a ETAPA 0; os fatos vêm da solução implementada. Use os modelos da base "Respostas Coerentes" abaixo APENAS como apoio secundário de tom e estrutura.\n';
    } else if (nivel === 'parcial') {
        bloco += 'SITUAÇÃO DETECTADA: Solução implementada PARCIAL/incompleta. PRESERVE integralmente todas as informações específicas informadas pelo analista (datas, valores, ações, status). COMPLEMENTE a redação usando os PADRÕES de estrutura e argumentação dos modelos semelhantes da base "Respostas Coerentes" abaixo. NÃO afirme como fato deste caso nada que não esteja na solução implementada nem na reclamação.\n';
    } else {
        bloco += 'SITUAÇÃO DETECTADA: Solução implementada VAZIA. NÃO bloqueie a geração e NÃO entregue só contexto/explicação deixando o cliente sem solução. PASSO A PASSO: (1) reúna na base "Respostas Coerentes" abaixo VÁRIAS respostas com o MESMO contexto de reclamação e os MESMOS motivos do caso atual; (2) identifique o PADRÃO RECORRENTE de solução entre elas (a forma como esse tipo de problema é efetivamente resolvido: causa, orientação concreta e encaminhamento); (3) construa UMA resposta completa que RESOLVA a reclamação atual aplicando esse padrão e reaproveitando os TRECHOS resolutivos aplicáveis, trazendo a resolução o MAIS PRÓXIMO POSSÍVEL dos casos semelhantes. NÃO empurre o cliente para a central/suporte. Sem fatos específicos informados, NÃO afirme datas, valores ou protocolos que não foram informados, mas ENTREGUE a solução/encaminhamento real (a mesma que resolveu os casos semelhantes). Esta é uma exceção controlada à Fonte de Verdade (que pressupõe a solução preenchida).\n';
    }
    bloco += 'REGRAS DE SEGURANÇA AO USAR A BASE (todos os cenários): reaproveite o PADRÃO de SOLUÇÃO e a forma de resolver dos casos semelhantes (não apenas tom/estrutura), mas NUNCA copie respostas integralmente nem reutilize dados pessoais, nomes, datas, valores ou protocolos específicos de outro cliente/caso.\n';
    return bloco;
}

// Gerar script padrão "cru" para geração de respostas
function gerarScriptPadraoResposta(dadosFormulario) {
    const nivelSolucao = avaliarDisponibilidadeSolucao(dadosFormulario.solucao_implementada);
    const semSolucao = nivelSolucao === 'vazia';
    return `📌 SCRIPT INTELIGENTE PARA GERAÇÃO DE RESPOSTA RA - VELOTAX

Você é um analista de atendimento ao cliente do Velotax, empresa de antecipação de restituição do Imposto de Renda. Sua função é gerar respostas personalizadas e inteligentes para o Reclame Aqui.

DADOS ESPECÍFICOS DO CASO:
- Tipo de solicitação: ${dadosFormulario.tipo_solicitacao}
- ID da Reclamação: ${dadosFormulario.id_reclamacao}
- Solução implementada: ${semSolucao ? '(NÃO INFORMADA — construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema, conforme a ETAPA 0)' : dadosFormulario.solucao_implementada}
- Texto do cliente: ${dadosFormulario.texto_cliente}
- Histórico de atendimento: ${dadosFormulario.historico_atendimento}
- Nome do solicitante (usar na saudação "Olá, [nome]!"): ${dadosFormulario.nome_solicitante || 'não informado'}

${semSolucao ? `🧭 ETAPA 0 — MODO BASE COERENTE (NÃO HÁ SOLUÇÃO IMPLEMENTADA PREENCHIDA):
Como o campo "Solução implementada" está vazio, a base "RESPOSTAS COERENTES APROVADAS" (abaixo) é a SUA FONTE PRINCIPAL para construir a resposta. Faça ANTES de escrever:
1. Reúna entre as respostas coerentes abaixo TODAS as que tratam da MESMA reclamação/motivo do caso atual.
2. Extraia o PADRÃO RECORRENTE DE SOLUÇÃO entre elas: a causa típica do problema, a explicação técnica usada, a orientação concreta dada ao cliente e o encaminhamento/resolução que efetivamente fecha o caso.
3. Construa UMA resposta completa que RESOLVA a reclamação atual aplicando esse padrão e reaproveitando os TRECHOS resolutivos e a fundamentação recorrente (bases normativas, prazos, procedimentos) que aparecem nessas respostas para este tema.

🔒 FONTE DE VERDADE NESTE CASO (SEM SOLUÇÃO IMPLEMENTADA):
- A reclamação do cliente + o PADRÃO de solução das respostas coerentes do mesmo tema são a fonte autorizada para construir a resposta.
- REAPROVEITE a fundamentação que se repete nas respostas coerentes do mesmo tema (explicação da causa, base normativa, procedimento, orientação), pois ela faz parte de como esse tipo de caso é resolvido.
- NÃO copie dados pessoais de outro cliente (nomes, e-mails, CPF) nem números específicos de outro caso (datas exatas, valores, protocolos) como se fossem deste cliente.
- Cite LGPD, CCB, CDC, resoluções ou cláusulas quando esse tipo de fundamentação aparecer recorrentemente nas respostas coerentes deste mesmo tema (é parte da solução padrão), sem inventar números/cláusulas específicos não informados.

🧱 PROFUNDIDADE OBRIGATÓRIA (PROIBIDO RESPOSTA ENXUTA):
- A resposta deve ter o MESMO nível de detalhe, explicação e desenvolvimento das respostas coerentes registradas para este tema. Se elas explicam a causa, detalham o que é feito, fundamentam e orientam o próximo passo, a sua resposta TAMBÉM deve fazer tudo isso.
- É PROIBIDO entregar uma resposta curta, seca ou telegráfica (1 a 2 frases). Desenvolva em parágrafos completos.
- A resposta DEVE apresentar de forma explícita a SOLUÇÃO/encaminhamento para a reclamação, espelhando como os casos coerentes semelhantes foram resolvidos. Nunca entregue só contexto/explicação deixando o cliente sem solução.` : `🧭 ETAPA 0 — ANÁLISE DA SOLUÇÃO IMPLEMENTADA (FAÇA ANTES DE QUALQUER COISA):
Antes de gerar a resposta, analise o conteúdo do campo "Solução implementada". O objetivo NÃO é medir o tamanho do texto, e sim o NÍVEL DE ADERÊNCIA do conteúdo à reclamação atual. Classifique em um dos níveis e siga a ação correspondente:

NÍVEL 1 — INFORMAÇÕES OPERACIONAIS
O campo traz apenas ações realizadas, consultas efetuadas, resultado da análise ou informações internas (ex.: "Cliente contatado. Não possui oferta ativa. Orientado a acompanhar o aplicativo.").
AÇÃO: gere uma resposta pública COMPLETA usando os fatos informados.

NÍVEL 2 — TEXTO PARCIAL OU REAPROVEITADO
O campo traz trechos de respostas anteriores, explicações incompletas, argumentos genéricos ou texto só parcialmente aderente ao caso atual.
AÇÃO: valide cada informação contra a reclamação atual, os dados do caso e a solução implementada; PRESERVE apenas os trechos aderentes, COMPLEMENTE os pontos ausentes e ADAPTE totalmente ao cenário atual.

NÍVEL 3 — RESPOSTA JÁ ADERENTE AO CASO
O campo já contém uma resposta substancialmente alinhada aos fatos da reclamação, à solução implementada e ao cenário atual.
AÇÃO: NÃO reconstrua a argumentação. Faça apenas refinamento textual, melhoria de clareza, adequação ao padrão Velotax e ao Reclame Aqui, correções gramaticais e complementação de saudação/apresentação/fechamento quando necessário. Preserve os fatos, a ordem e os argumentos já presentes.

VALIDAÇÃO OBRIGATÓRIA (responda internamente antes de tratar como NÍVEL 3):
1. O conteúdo responde à reclamação atual?
2. O conteúdo é compatível com a solução implementada?
3. O conteúdo foi escrito para ESTE caso específico?
4. Há referência a fatos que NÃO aparecem no caso atual?
Se houver qualquer inconsistência relevante, trate automaticamente como NÍVEL 2.

REGRA FUNDAMENTAL: nunca presuma que um texto longo é uma resposta correta. A decisão é pela ADERÊNCIA ao caso atual. Textos reaproveitados, mesmo completos, devem ser revisados e adaptados antes da geração final. Em qualquer nível, o resultado final deve seguir o padrão de saída e as demais regras abaixo.

🔒 FONTE DE VERDADE (PRIORIDADE ABSOLUTA):
A "Solução implementada" acima é a única fonte autorizada para fatos, datas, valores, status, prazos e conclusões.
- NÃO invente, suponha nem complete lacunas com conhecimento genérico ou de outros casos
- NÃO copie fatos de modelos da base de aprendizado se divergirem desta solução implementada
- Os modelos aprovados servem apenas para tom, estrutura e estilo de redação
- Se a solução implementada não mencionar LGPD, CCB, CDC ou cláusulas, NÃO as inclua

🧱 FUNDAMENTAÇÃO OBRIGATÓRIA (NÃO ENXUGAR A SOLUÇÃO):
- INCLUA na resposta TODOS os pontos de fundamentação que constarem na solução implementada: bases normativas (LGPD, CCB, CDC, resoluções, Banco Central), número/cláusulas de contrato (CCB), leis citadas, datas, prazos, valores, números de protocolo e demais dados.
- Esses elementos são a justificativa central da resposta e NÃO podem ser omitidos, generalizados nem resumidos a ponto de se perderem. Se a solução cita uma data, valor, cláusula ou norma, ela DEVE aparecer na resposta.
- A resposta deve refletir a profundidade da solução implementada: se a solução é detalhada, a resposta também precisa desenvolver cada fundamento, não entregar uma versão enxuta.`}
${montarBlocoFallbackCoerentes(dadosFormulario)}
🎯 RESPOSTA RESOLUTIVA (OBRIGATÓRIO):
- A resposta DEVE resolver o problema do cliente ou trazer o encaminhamento concreto da solução, respondendo diretamente à reclamação. O Reclame Aqui é o canal para resolver o que a central não resolveu, então NUNCA empurre o cliente de volta para a central/suporte.
- É TERMINANTEMENTE PROIBIDO usar saídas evasivas que joguem o cliente para outro canal, como "entre em contato com o suporte técnico", "procure o suporte técnico para averiguar/verificar", "entre em contato com nossa central/SAC", "procure nossos canais de atendimento para resolver", "caso não seja resolvido, entre em contato", "estamos à disposição para resolver" sem efetivamente trazer a solução. Isso não resolve, passa imagem de descaso e configura resposta genérica/evasiva. A solução/averiguação deve ser apresentada no PRÓPRIO corpo da resposta.
- Quando houver solução implementada: gere a resposta a partir dela, usando as respostas marcadas como coerentes apenas como referência de abordagem para apresentar a solução.
- Quando a solução implementada estiver vazia/incompleta: use os PADRÕES das respostas coerentes para construir uma resposta que efetivamente solucione/encaminhe o caso do cliente, sem inventar dados específicos não informados.
- O rodapé institucional com canais oficiais (aplicado pelo sistema) é apenas formal e NÃO conta como solução; a solução tem que estar no corpo da resposta.

🧠 ANÁLISE INTELIGENTE OBRIGATÓRIA:

1. CONTEXTUALIZAÇÃO DA VELOTAX:
- Somos referência em antecipação de restituição do Imposto de Renda
- Descreva a operação com base na solução implementada e nos dados do caso
- Não mencione LGPD, CCB, CDC nem outras normas por hábito ou completude retórica

2. ANÁLISE ESPECÍFICA POR TIPO DE SOLICITAÇÃO:

${gerarContextoEspecifico(dadosFormulario.tipo_solicitacao)}

3. ESTRUTURA INTELIGENTE DA RESPOSTA:

a) RESPOSTA DIRETA AO PONTO (SEM REDESCREVER A DOR):
- Vá direto ao ponto reclamado pelo cliente, respondendo-o POR MEIO da solução implementada
- NÃO redescreva, reconte nem reformule a reclamação/dor do cliente; o que ele reclama já está respondido dentro da solução. Não gaste parágrafos relatando o problema dele
- Não agradeça pelo contato, pela preocupação ou pela confiança. NÃO use "agradecemos", "obrigado por", "agradecemos a oportunidade", "agradecemos sua manifestação" nem variações
- A apresentação do agente já registra o recebimento; o miolo da resposta NÃO deve repetir agradecimentos nem pedir desculpas

b) ESCLARECIMENTO TÉCNICO:
- Explique o que foi feito de forma clara e técnica
- Cite datas, processos e procedimentos conforme constarem na solução implementada ou no histórico
- Cite LGPD, CCB ou CDC somente se esses termos (ou ideia equivalente) estiverem explicitamente na solução implementada ou forem estritamente necessários para relatar o que já foi feito, sem acrescentar fundamentação nova

c) SOLUÇÃO IMPLEMENTADA:
- Detalhe as ações tomadas pelo Velotax
- Explique como a solução resolve a solicitação
- Mencione benefícios e resultados para o cliente

d) COMPROMISSO E TRANSPARÊNCIA:
- Reafirme o compromisso com a satisfação
- Demonstre transparência nos processos
- NÃO encerre empurrando o cliente para a central/suporte: a resposta já deve trazer a solução ou o encaminhamento concreto

4. DIRETRIZES ESPECÍFICAS DA VELOTAX:

- Sempre referir-se à marca como "Velotax" (V maiúsculo), no masculino: o Velotax, ao Velotax, do Velotax, no Velotax, pelo Velotax — nunca "a Velotax", "da Velotax", "na Velotax"
- Use linguagem técnica mas acessível
- Evite blocos longos de justificativa ou tom defensivo; prefira fatos e conclusões alinhados à solução implementada
- Não use eufemismos de desculpa ("regrettable", "compreendemos o transtorno" excessivo, "lamentamos o ocorrido" indireto)
- Mencione Banco Central, CCB, LGPD ou CDC só se constarem na solução implementada ou no material do caso, não como enfeite
- Demonstre domínio do caso sem extrapolar além dos dados fornecidos
- Mantenha tom profissional, direto e solucionador
- Seja específico sobre processos e prazos apenas quando estiverem nos dados (solução implementada, histórico, observações)
- Evite generalizações - seja sempre específico ao caso
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Seja firme e objetivo, sem excesso de tom acolhedor
- Foque em esclarecer e resolver, não em justificar ou se desculpar
- NUNCA use travessão (—), hífen longo (–) nem hífen com espaços como pausa entre ideias; use vírgula, ponto ou ponto e vírgula

5. ELEMENTOS DE QUALIDADE (SEM INVENTAR CONTEÚDO):

- Posicione o Velotax de forma objetiva quando couber ao caso
- Demonstre conhecimento técnico apenas sobre o que foi feito e registrado
- NÃO repita telefone/site no miolo nem direcione o cliente para os canais como forma de "resolver" (o rodapé institucional já existe); a solução tem que estar no corpo da resposta
- Transparência factual, sem prolixidade

⚠️ FORMATO DE SAÍDA OBRIGATÓRIO:

IMPORTANTE: Você deve gerar APENAS o conteúdo do meio da resposta, SEM saudação inicial e SEM assinatura final. 

A estrutura completa (saudação com nome do cliente, apresentação do agente, informações de contato e assinatura) será aplicada automaticamente pelo sistema.

Gere APENAS o texto explicativo que vai entre a apresentação do agente e as informações de contato. Este texto deve:
${semSolucao ? `- COMPRIMENTO OBRIGATÓRIO: produza uma resposta COMPLETA, desenvolvida em 4 a 6 parágrafos (mínimo de ~900 caracteres). É PROIBIDO entregar resposta curta, enxuta ou telegráfica.
- APRESENTAR OBRIGATORIAMENTE A SOLUÇÃO: como não há solução implementada informada, construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema e apresente-a explicitamente, resolvendo a reclamação. Nunca entregue só explicação/contexto sem solução.
- ESPELHAR A PROFUNDIDADE da base coerente: a resposta deve ter o mesmo nível de detalhe, explicação técnica e fundamentação que as respostas coerentes registradas para este tema, na seguinte ordem:
  1) Responda diretamente ao ponto do cliente (NÃO redescreva a dor/reclamação dele)
  2) Explique de forma técnica e clara a causa/funcionamento e o que o Velotax faz nesse tipo de caso, reaproveitando a fundamentação recorrente das respostas coerentes (bases normativas, procedimentos, prazos típicos)
  3) Apresente a SOLUÇÃO/encaminhamento concreto, espelhando como os casos coerentes semelhantes foram resolvidos
  4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
- REAPROVEITE os trechos resolutivos e a fundamentação que se repetem nas respostas coerentes do mesmo tema, SEM copiar dados pessoais nem números específicos de outro cliente/caso (nomes, datas exatas, valores, protocolos)` : `- Responder diretamente ao ponto do cliente por meio da solução, SEM redescrever a dor/reclamação dele
- Explicar a solução implementada incluindo TODA a sua fundamentação (bases normativas, CCB, cláusulas, leis, datas, prazos, valores e dados)
- DESENVOLVER a solução com a MESMA riqueza e profundidade das respostas coerentes registradas para este tema (não entregue um texto mais curto/seco que elas); quando a base for detalhada, desenvolva a resposta em parágrafos completos (de 3 a 6 parágrafos), nesta ordem:
  1) Responda diretamente ao ponto do cliente já pela solução implementada (NÃO redescreva a dor/reclamação dele)
  2) Explique o que foi efetivamente feito (a solução implementada), de forma técnica e clara, INCLUINDO todas as fundamentações que constam nela (bases normativas, CCB, cláusulas, leis, datas, prazos, valores e dados)
  3) Mostre COMO essa solução, com essa fundamentação, resolve o ponto levantado
  4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
- NÃO omita nem resuma os fundamentos da solução implementada: cada base normativa, cláusula, data, valor ou dado citado na solução deve aparecer na resposta como justificativa`}
- Cada parágrafo deve agregar informação nova: não repita a mesma ideia com outras palavras e não use frases de enchimento
- Ser específico e detalhado, sem ser raso ou telegráfico (evite responder em 1 ou 2 frases soltas)
- Demonstrar expertise técnica, transparência e compromisso com a satisfação do cliente
- Estar sempre contextualizado para o Velotax e o tipo de solicitação específica
- NUNCA incluir pedidos de desculpas ou expressões como "lamentamos", "sentimos muito", "nos desculpamos"
- Ser firme e objetivo, sem excesso de tom acolhedor ou friendly
- Evite agradecimentos no miolo; vá direto ao esclarecimento da solução

NÃO inclua:
- "Olá, [nome]" ou qualquer saudação
- "Sou [nome], analista..." ou apresentação
- Informações de contato (telefones, site)
- "Atenciosamente" ou assinatura
- Qualquer estrutura de cabeçalho ou rodapé

Gere APENAS o conteúdo explicativo do meio da resposta.`;
}

// Função auxiliar para gerar contexto específico por tipo de solicitação
function gerarContextoEspecifico(tipoSolicitacao) {
    const chave = String(tipoSolicitacao || '').toLowerCase().trim();
    const contextos = {
        'antecipacao': `
🔹 ANTECIPAÇÃO DE RESTITUIÇÃO:
- Descreva a operação e etapas com base na solução implementada
- Análise de elegibilidade e processamento apenas conforme registrado
- Custos e prazos com transparência factual, sem valores ou prazos inventados`,

        'antecipacao-2026': `
🔹 ANTECIPAÇÃO 2026:
- Descreva a operação e etapas com base na solução implementada
- Análise de elegibilidade e processamento apenas conforme registrado
- Custos e prazos com transparência factual, sem valores ou prazos inventados`,

        'aplicativo': `
🔹 APLICATIVO:
- Esclareça o que foi feito no app conforme a solução implementada
- Status de cadastro, operação ou funcionalidade apenas se constarem nos dados`,

        'conta-celcoin': `
🔹 CONTA CELCOIN:
- Descreva status da conta, movimentações ou bloqueios conforme a solução implementada
- Prazos e valores apenas se constarem nos dados fornecidos`,

        'credito-ao-trabalhador': `
🔹 CRÉDITO AO TRABALHADOR:
- Explique o que foi feito no consignado/crédito conforme a solução implementada
- Desconto em folha, contrato ou status apenas conforme registrado`,

        'clube-velotax': `
🔹 CLUBE VELOTAX:
- Descreva adesão, benefícios ou cancelamento conforme a solução implementada
- Créditos, cupons ou Vibe apenas se constarem nos dados`,

        'emprestimo-pessoal': `
🔹 EMPRÉSTIMO PESSOAL:
- Explique contrato, parcelas ou quitação conforme a solução implementada
- Valores, prazos e status apenas conforme registrado`,

        'seguros': `
🔹 SEGUROS:
- Descreva apólice, cobertura, cancelamento ou sinistro conforme a solução implementada
- Seguradora e prazos apenas se constarem nos dados`,

        'incoerente': `
🔹 RECLAMAÇÃO INCOERENTE:
- Esclareça os fatos reais conforme a solução implementada
- Confronte objetivamente o relato do cliente com o que foi registrado`,

        'em-cobranca': `
🔹 EM COBRANÇA:
- Descreva status de cobrança, quitação ou acordo conforme a solução implementada
- Valores e prazos apenas se constarem nos dados`,

        'veloprime': `
🔹 VELOPRIME:
- Explique adesão, benefícios ou cancelamento conforme a solução implementada`,

        'divida-prescrita': `
🔹 DÍVIDA PRESCRITA:
- Esclareça status da dívida conforme a solução implementada
- Não invente fundamentação jurídica além do registrado`,

        'juros-abusivos': `
🔹 JUROS ABUSIVOS:
- Explique cálculo, contrato ou quitação conforme a solução implementada
- Valores e encargos apenas se constarem nos dados`,

        'exclusao-cadastro': `
🔹 EXCLUSÃO DE CADASTRO:
- Descreva exclusão e remoção de dados conforme a solução implementada (prazos e status só se constarem nela)
- Remoção de dados e fim de comunicações conforme registrado
- Não cite LGPD nem artigos da lei salvo se estiverem na solução implementada`,

        'liberacao-chave-pix': `
🔹 LIBERAÇÃO DE CHAVE PIX:
- Desvinculação/liberação da chave Pix conforme a solução implementada
- Verificação de quitação ou status da operação quando constar nos dados
- Prazos apenas se estiverem na solução implementada ou histórico`,

        'esclarecimento': `
🔹 ESCLARECIMENTO:
- Esclarecimento completo sobre a operação conforme a solução implementada
- Transparência nos processos e prazos apenas quando constarem nos dados`
    };

    if (contextos[chave]) return contextos[chave];

    return `
🔹 SOLICITAÇÃO (${tipoSolicitacao || 'geral'}):
- Análise específica do caso apresentado com base na solução implementada
- Descreva apenas fatos, prazos e status registrados nos dados fornecidos
- Não complete lacunas com informações genéricas ou de outros casos`;
}

// Reformular script com conhecimento da planilha
function reformularComConhecimento(scriptPadrao, dadosPlanilha, dadosFormulario, conhecimentoExtra = '') {
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
            const ranqueados = ordenarModelosPorSimilaridade(modelosComResposta, dadosFormulario);
            const simTopo = ranqueados.length ? ranqueados[0].similaridade : 0;
            const motivoAtual = (dadosFormulario?.motivo_solicitacao || dadosFormulario?.motivoSolicitacao || '').trim();

            // PRÉ-ANÁLISE DE CONSISTÊNCIA (antes da geração): descarta respostas com contexto/
            // informação DIVERGENTE do caso atual (origem de "modelo antigo" vazando para a resposta).
            // 1) Piso absoluto de contexto + 2) corte relativo ao melhor caso (mantém só o que está
            //    realmente próximo do caso mais parecido).
            const PISO_CONTEXTO = 0.10;
            const PISO_RELATIVO = simTopo > 0 ? simTopo * 0.4 : 0;
            const LIMIAR = Math.max(PISO_CONTEXTO, PISO_RELATIVO);
            let consistentes = ranqueados.filter(item => item.similaridade >= LIMIAR);

            // 3) Filtro por MOTIVO: havendo motivo no caso atual, descarta os de motivo divergente
            //    quando a semelhança textual também é baixa (ou seja, contexto realmente diferente).
            if (motivoAtual && consistentes.length > 1) {
                const comMotivoOuTextoForte = consistentes.filter(item =>
                    item.simMotivo > 0 || item.simTexto >= Math.max(0.15, simTopo * 0.6));
                if (comMotivoOuTextoForte.length > 0) consistentes = comMotivoOuTextoForte;
            }

            const descartadosPorDivergencia = ranqueados.length - consistentes.length;

            // Se nada passou no crivo de contexto, usa apenas o caso mais parecido e sinaliza baixa
            // aderência, em vez de arrastar vários casos divergentes para dentro da resposta.
            let baixaAderencia = false;
            if (consistentes.length === 0 && ranqueados.length > 0) {
                baixaAderencia = true;
                consistentes = [ranqueados[0]];
            }

            // Proteção por TAMANHO (limite de tokens da API): mantém os mais parecidos primeiro.
            const ORCAMENTO_CARACTERES = 60000;
            const selecionados = [];
            let totalChars = 0;
            for (const item of consistentes) {
                const respostaItem = item.modelo['Resposta Aprovada'] || item.modelo.respostaAprovada || '';
                if (!respostaItem || respostaItem.trim().length === 0) continue;
                totalChars += respostaItem.length + 400; // resposta + metadados aproximados
                if (selecionados.length >= 3 && totalChars > ORCAMENTO_CARACTERES) break;
                selecionados.push(item);
            }

            console.log(`🔎 Consistência das coerentes: ${selecionados.length} mantida(s), ${descartadosPorDivergencia} descartada(s) por divergência de contexto/motivo (de ${modelosComResposta.length}; sim. topo ${Math.round(simTopo * 100)}%${baixaAderencia ? '; BAIXA ADERÊNCIA' : ''})`);

            promptFinal += '\n✅ RESPOSTAS COERENTES APROVADAS (já FILTRADAS por mesmo contexto/motivo — referência de TOM, ESTRUTURA e SOLUÇÃO):\n\n';
            promptFinal += `📊 ${selecionados.length} resposta(s) coerente(s) MANTIDA(S) após descartar ${descartadosPorDivergencia} por divergência de contexto/informação (de ${modelosComResposta.length} disponíveis), ordenadas da mais semelhante para a menos.\n`;
            if (baixaAderencia) {
                promptFinal += '⚠️ ATENÇÃO: NENHUMA resposta da base tem contexto fortemente aderente a este caso (baixa aderência). Use a(s) abaixo apenas como referência de TOM/ESTRUTURA e baseie a SOLUÇÃO no que for efetivamente compatível com a reclamação atual; NÃO traga informações/procedimentos que não se apliquem a este caso.\n';
            }
            promptFinal += 'Antes de usar, faça a CHECAGEM DE CONSISTÊNCIA descrita abaixo e DESCARTE qualquer resposta cujas informações divirjam do caso atual:\n\n';

            selecionados.forEach((item, index) => {
                const modelo = item.modelo;
                const resposta = modelo['Resposta Aprovada'] || modelo.respostaAprovada || '';
                if (!resposta || resposta.trim().length === 0) {
                    return; // Pular modelos sem resposta
                }
                const pct = Math.round(item.similaridade * 100);
                const motivoModelo = modelo['Motivo Solicitação'] || modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao || 'N/A';

                promptFinal += `━━━ RESPOSTA COERENTE ${index + 1} (similaridade: ${pct}%) ━━━\n`;
                promptFinal += `📋 Tipo: ${modelo['Tipo Solicitação'] || modelo.dadosFormulario?.tipo_solicitacao || 'N/A'}\n`;
                promptFinal += `🎯 Motivo: ${motivoModelo}\n`;
                promptFinal += `📝 Reclamação do cliente (caso anterior): ${modelo['Texto Cliente'] || modelo.dadosFormulario?.texto_cliente || 'N/A'}\n`;
                promptFinal += `\n✅ RESPOSTA APROVADA (reaproveite a forma de RESOLVER e os trechos aplicáveis):\n`;
                promptFinal += `${resposta}\n`;
                promptFinal += `\n💡 Solução do caso anterior (referência de COMO resolver, sem copiar dados pessoais): ${modelo['Solução Implementada'] || modelo.dadosFormulario?.solucao_implementada || 'N/A'}\n`;
                promptFinal += `\n`;
            });

            promptFinal += '\n🔍 CHECAGEM DE CONSISTÊNCIA OBRIGATÓRIA (FAÇA ANTES DE GERAR):\n';
            promptFinal += '   0a. Releia a RECLAMAÇÃO ATUAL e identifique: produto/serviço, motivo e fato central reclamado.\n';
            promptFinal += '   0b. Para CADA resposta coerente acima, verifique se ela trata do MESMO contexto (mesmo produto/serviço, mesmo motivo) e se as INFORMAÇÕES (causa, procedimento, prazos, encaminhamento) são COMPATÍVEIS com o caso atual.\n';
            promptFinal += '   0c. DESCARTE (não use) qualquer resposta que DIVIRJA: produto/serviço diferente, motivo diferente, procedimento/prazo desatualizado ou informação que contradiga as demais. NÃO importe nenhum dado, procedimento ou argumento dessas respostas descartadas.\n';
            promptFinal += '   0d. Trabalhe APENAS com o subconjunto de respostas que sobrou e que está em CONSENSO de informação. Se sobrar apenas 1 (ou nenhuma fortemente aderente), baseie-se só nela/no caso atual e NÃO complete com informações de casos divergentes.\n\n';
            promptFinal += '🎯 COMO USAR AS RESPOSTAS COERENTES (CONSISTENTES) ACIMA:\n';
            promptFinal += '   1. Use somente as respostas que passaram na checagem 0 (mesmo contexto/informação do caso atual).\n';
            promptFinal += '   2. Extraia o PADRÃO RECORRENTE de solução: o que essas respostas têm em comum na forma de RESOLVER o problema (explicação da causa, orientação concreta, encaminhamento dado ao cliente).\n';
            promptFinal += '   3. Construa UMA resposta completa que de fato RESOLVA a reclamação atual aplicando esse padrão e reaproveitando os TRECHOS resolutivos aplicáveis — não entregue apenas contexto/explicação que deixe o cliente sem solução.\n';
            promptFinal += '   4. ESPELHE A PROFUNDIDADE das respostas coerentes: a resposta gerada deve ter o MESMO nível de detalhe, explicação e desenvolvimento da solução que essas respostas registradas, não um texto mais curto/seco. Se as coerentes explicam a causa, detalham o que foi feito e orientam o próximo passo, a sua resposta também deve fazer isso.\n';
            promptFinal += '   5. MANTENHA A COERÊNCIA DE LINGUAGEM E ABORDAGEM com a base: use as mesmas expressões, a mesma forma de explicar e a mesma estrutura argumentativa que aparecem repetidamente nas respostas coerentes do mesmo tema (sem copiar dados pessoais).\n';
            promptFinal += '   - Quando houver solução implementada: ela é a Fonte de Verdade dos fatos; use as respostas coerentes para a forma de redigir/resolver e para o nível de profundidade, mas os fatos vêm DELA.\n';
            promptFinal += '   - Quando a solução implementada estiver VAZIA/incompleta: a solução do caso atual deve ser a MAIS PARECIDA POSSÍVEL com o padrão das respostas coerentes acima (a orientação/solução concreta e completa), adaptada à reclamação atual.\n';
            promptFinal += '   - NUNCA copie dados pessoais, nomes, datas, valores ou protocolos específicos de outro cliente/caso.\n';
            promptFinal += '   - Referências a LGPD, CCB ou CDC somente se constarem na solução implementada deste caso.\n\n';
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
            promptFinal += '   - Não acrescente fundamentação legal que não esteja na solução implementada ou nos dados do caso\n\n';
        }
        
        promptFinal += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        promptFinal += '\n🎯 INSTRUÇÃO CRÍTICA FINAL:\n';
        promptFinal += 'Prioridade 1: fidelidade total à solução implementada deste caso (fonte de verdade).\n';
        promptFinal += 'Prioridade 2: tom e estrutura dos modelos aprovados (sem copiar fatos de outros casos).\n';
        promptFinal += 'Prioridade 3: evitar erros listados nos feedbacks.\n';
        promptFinal += 'Não gere resposta genérica nem invente informação além dos dados fornecidos.\n\n';
    } else {
        console.log('⚠️ AVISO: Nenhum conhecimento da base de aprendizado disponível');
        promptFinal += '\n\n⚠️ AVISO: Gerando resposta sem base de aprendizado. Siga rigorosamente o script padrão e a solução implementada.\n\n';
    }

    if (conhecimentoExtra && conhecimentoExtra.trim()) {
        promptFinal += conhecimentoExtra;
        promptFinal += '\n🎯 INSTRUÇÃO: O conhecimento de produto acima complementa o contexto, mas NÃO substitui nem contradiz a solução implementada deste caso.\n\n';
    }

    const checklistRA = montarChecklistConformidadeRA(
        dadosFormulario?.texto_cliente,
        dadosFormulario?.motivo_solicitacao || dadosFormulario?.tipo_solicitacao
    );
    if (checklistRA) {
        promptFinal += checklistRA;
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
        let modelos = todosModelos.filter(modelo => {
            const tipoSituacao = normalizarTextoTipo(modelo['Tipo Solicitação'] || modelo.tipo_situacao || '');
            const tipoBusca = normalizarTextoTipo(tipoSolicitacao);
            const temResposta = !!(modelo['Resposta Aprovada'] || modelo.respostaAprovada);
            const respostaValida = (modelo['Resposta Aprovada'] || modelo.respostaAprovada || '').trim().length > 0;
            const tipoCompativel = tipoSituacao.includes(tipoBusca) || tipoBusca.includes(tipoSituacao);
            return tipoCompativel && temResposta && respostaValida;
        });

        modelos = filtrarRegistrosAprendizado(modelos, 'coerente');

        console.log(`✅ Carregados ${modelos.length} modelos coerentes da planilha (com resposta válida, janela aplicada)`);
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
        
        let moderacoes = todasModeracoes.filter(m => registroDentroJanelaAprendizado(m, obterConfigAprendizado()));

        console.log(`📋 ${moderacoes.length} moderações coerentes carregadas da planilha (janela aplicada, de ${todasModeracoes.length})`);
        return moderacoes;
        
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
        
        let feedbacks = todosFeedbacks.filter(m => registroDentroJanelaAprendizado(m, obterConfigAprendizado()));

        console.log(`📋 ${feedbacks.length} feedbacks de moderação carregados da planilha (janela aplicada, de ${todosFeedbacks.length})`);
        return feedbacks;
        
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
        let feedbacks = todosFeedbacks.filter(feedback => {
            const tipoSituacao = normalizarTextoTipo(feedback['Tipo Solicitação'] || feedback.tipoSituacao || '');
            const tipoBusca = normalizarTextoTipo(tipoSolicitacao);
            return tipoSituacao.includes(tipoBusca) || tipoBusca.includes(tipoSituacao);
        });

        feedbacks = filtrarRegistrosAprendizado(feedbacks, 'feedback');

        console.log(`✅ Carregados ${feedbacks.length} feedbacks relevantes da planilha (janela aplicada)`);
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
    const respostaMiolo = extrairMioloRespostaRA(respostaAprovada);
    if (respostaMiolo.length < respostaAprovada.length) {
        console.log(`✂️ Resposta coerente normalizada para miolo: ${respostaAprovada.length} → ${respostaMiolo.length} chars`);
    }
    console.log('📝 Dados recebidos:', {
        tipo_solicitacao: dadosFormulario.tipo_solicitacao,
        id_reclamacao: dadosFormulario.id_reclamacao,
        resposta_length: respostaMiolo ? respostaMiolo.length : 0,
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
        respostaAprovada: respostaMiolo,
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
    await addRespostaCoerenteAprendizado(dadosFormulario.tipo_solicitacao, dadosFormulario.id_reclamacao, respostaMiolo, dadosFormulario, userData);
    console.log('✅ Aprendizado do script concluído');
    
    // IMPORTANTE: Se houve feedback anterior, salvar também no aprendizado
    if (dadosFormulario.feedback_anterior && dadosFormulario.resposta_anterior) {
        console.log('🧠 Salvando feedback anterior no aprendizado...');
        await addFeedbackAprendizado(
            dadosFormulario.tipo_solicitacao,
            dadosFormulario.feedback_anterior,
            respostaMiolo,
            extrairMioloRespostaRA(dadosFormulario.resposta_anterior),
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
            instrucoesAprendizado += '📋 PADRÕES IDENTIFICADOS (APLICAR QUANDO COMPATÍVEIS COM A SOLUÇÃO IMPLEMENTADA DESTE CASO):\n';
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

        instrucoesAprendizado += '⚠️ ALINHAMENTO: LGPD, CDC, CCB ou cláusulas contratuais só devem aparecer na resposta se constarem na solução implementada deste caso ou forem indispensáveis para descrever o que já foi feito; não acrescente normas por hábito.\n\n';
        
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
        // Exclusão de dados: não forçar CCB/cláusula 14 no aprendizado (feedback histórico: evitar CCB nestes casos)
        clausulaIdentificada = '';
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
        if ((feedback.includes('não cite') || feedback.includes('nao cite')) && feedback.includes('ccb')) {
            padroes.push('Não citar CCB ou cláusulas contratuais salvo se constarem na solução implementada');
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
    const respostaAnteriorMiolo = extrairMioloRespostaRA(respostaAnterior);
    const respostaReformuladaMiolo = extrairMioloRespostaRA(respostaReformulada);

    const novoFeedback = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo: 'resposta',
        dadosFormulario: dadosFormulario,
        respostaAnterior: respostaAnteriorMiolo,
        feedback: feedback,
        respostaReformulada: respostaReformuladaMiolo,
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
    await addFeedbackAprendizado(dadosFormulario.tipo_solicitacao, feedback, respostaReformuladaMiolo, respostaAnteriorMiolo, userData);
    
    // Registrar no Google Sheets usando fila robusta se disponível
    if (googleSheetsQueueRobust && googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        console.log('📋 Adicionando feedback à fila robusta do Google Sheets...');
        try {
            await googleSheetsQueueRobust.enqueue({
                type: 'registrarFeedback',
                data: {
                    tipo: 'resposta',
                    dadosFormulario: dadosFormulario,
                    respostaAnterior: respostaAnteriorMiolo,
                    feedback: feedback,
                    respostaReformulada: respostaReformuladaMiolo,
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
                    respostaAnterior: respostaAnteriorMiolo,
                    feedback: feedback,
                    respostaReformulada: respostaReformuladaMiolo,
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

app.use(express.json({ limit: '15mb' }));
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
            
            // Não gravar valores vazios (evita OPENAI_API_KEY= sem chave bloquear o fallback)
            if (cleanValue !== '') {
                envVars[key] = cleanValue;
            }
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
            
            // Se process.env não tiver OpenAI, tentar .env / config.env (mesmo fluxo do restante do bot)
            if (!validateApiKey(envVars.OPENAI_API_KEY)) {
                const arquivos = carregarEnvVarsDeArquivosLocais();
                envVars = { ...envVars, ...arquivos };
                envVars = aplicarChaveOpenAIValida(envVars);
            }

            console.log(`✅ ${Object.keys(envVars).filter(k => envVars[k]).length} variáveis carregadas do process.env`);
            return envVars;
        }
        
        // Para desenvolvimento local, tentar carregar do arquivo .env primeiro
        let envVars = carregarEnvVarsDeArquivosLocais();
        envVars = aplicarChaveOpenAIValida(envVars);
        
        // Log final das variáveis carregadas
        console.log('🔧 Variáveis finais carregadas:');
        console.log('  - GOOGLE_CLIENT_ID:', envVars.GOOGLE_CLIENT_ID || 'NÃO ENCONTRADO');
        console.log('  - DOMINIO_PERMITIDO:', envVars.DOMINIO_PERMITIDO || 'NÃO ENCONTRADO');
        console.log('  - OPENAI_API_KEY:', envVars.OPENAI_API_KEY ? 'CONFIGURADO' : 'NÃO ENCONTRADO');
        
        if (Object.keys(envVars).length === 0) {
            console.warn('⚠️ Nenhum arquivo de configuração encontrado');
            return aplicarChaveOpenAIValida({});
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

    const chave = apiKey.trim();

    if (!chave.startsWith('sk-')) {
        return false;
    }

    if (chave.length < 20) {
        return false;
    }

    return true;
}

/** Mesma chave OpenAI usada em respostas, moderação e e-mail (.env, config.env ou process.env). */
function resolverChaveOpenAI(envVars) {
    const vars = aplicarChaveOpenAIValida(envVars || loadEnvFile());
    const chave = vars.OPENAI_API_KEY;

    if (validateApiKey(chave)) {
        return {
            apiKey: chave.trim(),
            envVars: { ...vars, OPENAI_API_KEY: chave.trim() }
        };
    }

    return { apiKey: null, envVars: vars };
}

function carregarEnvVarsDeArquivosLocais() {
    let envVars = {};
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        envVars = { ...envVars, ...loadEnvFromFile(envPath) };
    }
    const configEnvPath = path.join(__dirname, 'config.env');
    if (fs.existsSync(configEnvPath)) {
        envVars = { ...envVars, ...loadEnvFromFile(configEnvPath) };
    }
    return envVars;
}

function aplicarChaveOpenAIValida(envVars) {
    const arquivos = carregarEnvVarsDeArquivosLocais();
    const candidatas = [
        envVars.OPENAI_API_KEY,
        arquivos.OPENAI_API_KEY,
        process.env.OPENAI_API_KEY
    ];
    for (const candidata of candidatas) {
        if (typeof candidata !== 'string') continue;
        const chave = candidata.trim();
        if (!chave) continue;
        if (validateApiKey(chave)) {
            envVars.OPENAI_API_KEY = chave;
            return envVars;
        }
    }
    return envVars;
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
        
        const baseNormativaManuais = montarBlocoManuaisModeracao(
            `${dadosModeracao.solicitacaoCliente || ''} ${dadosModeracao.respostaEmpresa || ''} ${dadosModeracao.consideracaoFinal || ''}`,
            dadosModeracao.motivoModeracao
        );

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
Com base no conteúdo analisado, verifique os manuais oficiais do RA aplicáveis:
- Manual Geral de Moderação
- Manual de Moderação – Bancos, Instituições Financeiras e Meios
${baseNormativaManuais}

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
                        content: 'Você é um analista de Reclame Aqui, com foco em formulação de textos de moderação. Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
            let resposta = humanizarPontuacaoGerada(data.choices[0].message.content);
            
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
        
        const { tipoEmail, destinatario, contexto, userData } = req.body;
        
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

Pontuação (obrigatório):
Não use travessão (—), hífen longo (–) nem hífen com espaços como pausa entre ideias; use vírgula, ponto ou ponto e vírgula.

`;

        const primeiroNomeEmail = userData && userData.nome ? obterPrimeiroNomeUsuario(userData) : null;
        if (primeiroNomeEmail && primeiroNomeEmail !== 'Agente') {
            const artE = obterArtigoDefinidoAgente(primeiroNomeEmail, userData);
            prompt += `
Remetente (use na despedida / assinatura do corpo, se fizer sentido):
Nome de exibição: ${primeiroNomeEmail}
Use artigo definido correto em português ao se apresentar (ex.: "Sou ${artE} ${primeiroNomeEmail}, analista..." ou "Atenciosamente,\\n${primeiroNomeEmail}").
`;
        }

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
        const emailGerado = humanizarPontuacaoGerada(data.choices[0]?.message?.content || '');

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
- Ancore fatos, prazos e conclusões na solução implementada e nos demais campos; não invente detalhes
- Seja específico sobre o que foi feito conforme a solução implementada
- Integre o histórico de atendimento quando relevante e quando constar nos dados
- Use tom profissional, direto e objetivo; evite parágrafos longos só para justificar ou "adubar" o texto
- Não mencione LGPD, CCB, CDC, artigos de lei ou cláusulas contratuais salvo se constarem na solução implementada (ou forem estritamente necessários para relatar o que já foi feito, sem criar fundamentação nova)
- NUNCA peça desculpas ou use expressões como "lamentamos", "sentimos muito"
- Evite eufemismos que funcionem como desculpa indireta ("compreendemos o transtorno", "infelizmente", "lamentamos qualquer inconveniente")
- Seja firme e claro, sem excesso de tom acolhedor
- NUNCA use travessão (—), hífen longo (–) nem " - " como pausa entre frases; use vírgula ou ponto
- NÃO agradeça pelo contato, pela preocupação ou pela confiança; vá direto ao esclarecimento
- Sempre referir-se à marca como "Velotax" (V maiúsculo), no masculino: o Velotax, ao Velotax, do Velotax

4. VERIFICAÇÃO FINAL:
- Confirme que a resposta é específica (não genérica)
- Verifique se reflete fielmente a solução implementada (sem extrapolar)
- Garanta que o tom está adequado para o RA

🎯 INSTRUÇÃO CRÍTICA: Use o conhecimento dos modelos coerentes para gerar uma resposta de alta qualidade desde o início, aplicando a estrutura e abordagem dos modelos aprovados.

IMPORTANTE: A resposta deve ser específica para esta situação, não genérica. Use os dados fornecidos e o conhecimento dos modelos coerentes para criar uma resposta personalizada e completa, sem prolixidade nem informação nova.`;

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
                        content: 'Você é um analista de atendimento ao cliente do Velotax para o Reclame Aqui. Baseie-se na solução implementada e nos dados do caso; não cite LGPD, CCB ou CDC salvo se isso constar na solução implementada ou for indispensável ao relato factual. Evite justificativas longas e tom defensivo. Não agradeça pelo contato ou preocupação. Sempre escreva "Velotax" com V maiúsculo e no masculino (o Velotax, ao Velotax, do Velotax). Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
            const resposta = humanizarPontuacaoGerada(data.choices[0].message.content);
            
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
        
        console.log('📋 Dados recebidos do formulário:', {
            tipo_solicitacao: dadosFormulario.tipo_solicitacao,
            motivo_solicitacao: dadosFormulario.motivo_solicitacao,
            solucao_implementada: dadosFormulario.solucao_implementada?.substring(0, 100) + '...',
            texto_cliente: dadosFormulario.texto_cliente?.substring(0, 100) + '...',
            historico_atendimento: dadosFormulario.historico_atendimento?.substring(0, 50) + '...',
            nome_solicitante: dadosFormulario.nome_solicitante || 'não informado'
        });
        
        // Carregar base de aprendizado e conhecimento de produtos para o prompt
        const conhecimentoProdutos = obterConhecimentoProdutos(dadosFormulario);
        if (conhecimentoProdutos) {
            console.log('✅ CONHECIMENTO DE PRODUTOS DETECTADO — será incluído como complemento (sem substituir solução implementada)');
        }

        let dadosPlanilha = null;
        try {
            console.log('🔍 [DEBUG] Tentando carregar dados da planilha para:', dadosFormulario.tipo_solicitacao);
            dadosPlanilha = await carregarDadosAprendizadoCompleto(dadosFormulario.tipo_solicitacao);
            console.log('✅ Dados da planilha carregados:', {
                modelos: dadosPlanilha?.modelosCoerentes?.length || 0,
                feedbacks: dadosPlanilha?.feedbacksRelevantes?.length || 0,
                fonte: dadosPlanilha?.fonte || 'desconhecida'
            });
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados da planilha:', error.message);
            console.log('🔄 Continuando com script padrão...');
        }

        const prompt = reformularComConhecimento(
            gerarScriptPadraoResposta(dadosFormulario),
            dadosPlanilha,
            dadosFormulario,
            conhecimentoProdutos
        );

        const systemPromptRA = 'Você é um assistente do Velotax para respostas ao Reclame Aqui. A solução implementada é a fonte de verdade: explique apenas o que consta nela e nos demais campos do caso, sem inventar fatos. Modelos da base de aprendizado servem para tom e estrutura e, quando NÃO houver solução implementada, também como base da SOLUÇÃO: identifique a reclamação mais parecida e reaproveite a forma como aquele caso foi efetivamente resolvido (a orientação/solução concreta), adaptando ao caso atual, sem copiar dados pessoais de outros clientes (nomes, datas, valores, protocolos). Nunca entregue só contexto deixando o cliente sem solução. Cite LGPD, CCB, CDC ou cláusulas só se constarem na solução implementada. Não agradece pelo contato, pela preocupação ou pela confiança. Sempre escreva "Velotax" com V maiúsculo e no masculino (o Velotax, ao Velotax, do Velotax). A saudação com nome é aplicada pelo sistema após o texto. REGRA INEGOCIÁVEL: a resposta deve RESOLVER o problema no próprio corpo do texto. É TERMINANTEMENTE PROIBIDO sugerir ou direcionar o cliente a procurar o suporte técnico, a central, o SAC ou qualquer canal de atendimento para "averiguar", "verificar", "resolver" ou "dar continuidade" ao caso. O Reclame Aqui é o canal de quem a central NÃO resolveu, então NUNCA jogue o cliente de volta para esses canais. Não use frases como "entre em contato com o suporte", "procure nosso suporte técnico", "entre em contato com nossa central", "acione nossos canais para resolver". Não confunda com o rodapé institucional (aplicado pelo sistema), que é apenas formal.';
        const temperatureRA = Math.min(parseFloat(envVars.OPENAI_TEMPERATURE) || 0.5, 0.5);

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
                        content: systemPromptRA
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: temperatureRA,
                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            let conteudoMiolo = data.choices[0].message.content;

            const nomeAgente = obterPrimeiroNomeUsuario(userData);
            const nomeCliente = (dadosFormulario.nome_solicitante && String(dadosFormulario.nome_solicitante).trim())
                ? String(dadosFormulario.nome_solicitante).trim()
                : extrairNomeCliente(dadosFormulario.texto_cliente);

            const palavrasGenericas = [
                'situação atual', 'detalhes específicos não foram compartilhados',
                'nossa equipe está comprometida', 'analisar todas as solicitações',
                'embora os detalhes específicos', 'gostaríamos de assegurar',
                'caso a sua solicitação envolva', 'estamos aqui para esclarecer',
                'sua situação atual necessitou', 'detalhes específicos do seu caso'
            ];

            const semSolucaoImpl = avaliarDisponibilidadeSolucao(dadosFormulario.solucao_implementada) === 'vazia';
            // Sem solução implementada, a resposta precisa ser completa e resolutiva (construída a
            // partir da base coerente), então o piso de comprimento é maior para barrar respostas enxutas.
            const comprimentoMinimo = semSolucaoImpl ? 700 : 120;

            const respostaValida = (texto) => {
                if (!texto || texto.length < comprimentoMinimo) return false;
                if (palavrasGenericas.some(p => texto.toLowerCase().includes(p))) return false;
                return respostaRefleteSolucaoImplementada(texto, dadosFormulario.solucao_implementada);
            };

            if (!respostaValida(conteudoMiolo)) {
                console.log(`⚠️ Resposta rejeitada (${semSolucaoImpl ? 'curta/sem solução resolutiva' : 'não reflete a solução implementada'}) — tentando nova geração reforçada...`);
                const promptRetry = semSolucaoImpl ? `${prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORREÇÃO OBRIGATÓRIA (TENTATIVA ANTERIOR CURTA OU SEM SOLUÇÃO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A resposta anterior ficou enxuta e/ou não apresentou a solução para a reclamação.
NÃO há solução implementada informada: construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema (acima) e reescreva o miolo em 4 a 6 parágrafos completos, com o mesmo nível de detalhe e fundamentação dessas respostas. APRESENTE explicitamente a solução/encaminhamento que resolve a reclamação. NÃO copie dados pessoais nem números específicos de outro cliente.` : `${prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORREÇÃO OBRIGATÓRIA (TENTATIVA ANTERIOR REJEITADA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A resposta anterior não incorporou corretamente a solução implementada.
Reescreva o miolo da resposta incorporando os fatos abaixo de forma clara e objetiva, sem inventar informação adicional:

SOLUÇÃO IMPLEMENTADA (incorporar na resposta):
${dadosFormulario.solucao_implementada}`;

                const responseRetry = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: envVars.OPENAI_MODEL || 'gpt-4o',
                        messages: [
                            { role: 'system', content: systemPromptRA },
                            { role: 'user', content: promptRetry }
                        ],
                        temperature: 0.3,
                        max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
                    })
                });

                let conteudoRetry = null;
                if (responseRetry.ok) {
                    const dataRetry = await responseRetry.json();
                    conteudoRetry = dataRetry.choices[0].message.content;
                }

                if (conteudoRetry && respostaValida(conteudoRetry)) {
                    conteudoMiolo = conteudoRetry;
                    console.log('✅ Retry bem-sucedido — resposta alinhada à solução implementada');
                } else {
                    // 3ª tentativa: exigir desenvolvimento completo em parágrafos, ancorado na solução implementada
                    console.log('⚠️ Retry insuficiente — 3ª tentativa pedindo desenvolvimento completo...');
                    const promptDesenvolvido = semSolucaoImpl ? `${prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESENVOLVIMENTO OBRIGATÓRIO (TENTATIVAS ANTERIORES CURTAS OU SEM SOLUÇÃO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NÃO há solução implementada informada. Construa a solução a partir do PADRÃO das respostas coerentes do mesmo tema (listadas acima) e escreva o miolo em 4 a 6 parágrafos completos, espelhando o nível de detalhe e fundamentação dessas respostas.
Estrutura obrigatória:
1) Responda diretamente ao ponto do cliente (NÃO redescreva a dor/reclamação dele)
2) Explique de forma técnica e clara a causa/funcionamento e o que o Velotax faz nesse tipo de caso, reaproveitando a fundamentação recorrente das respostas coerentes (bases normativas, procedimentos, prazos típicos do tema)
3) APRESENTE a solução/encaminhamento concreto que resolve a reclamação, espelhando como os casos coerentes semelhantes foram resolvidos
4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
NÃO copie dados pessoais nem números específicos de outro cliente/caso (nomes, datas exatas, valores, protocolos). NUNCA empurre o cliente para a central/suporte: a solução tem que estar no corpo da resposta.

TEXTO DO CLIENTE (para contextualizar):
${dadosFormulario.texto_cliente || 'N/A'}` : `${prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESENVOLVIMENTO OBRIGATÓRIO (TENTATIVAS ANTERIORES CURTAS OU DESALINHADAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Escreva o miolo da resposta em 3 a 5 parágrafos completos, incorporando explicitamente TODOS os elementos da solução implementada abaixo. NÃO invente dados além dela e NÃO copie fatos de outros casos.
Estrutura obrigatória:
1) Responda diretamente ao ponto do cliente já pela solução implementada (NÃO redescreva a dor/reclamação dele)
2) Explique de forma técnica e clara o que foi efetivamente feito, INCLUINDO todas as fundamentações da solução (bases normativas, CCB, cláusulas, leis, datas, prazos, valores e dados)
3) Mostre como essa solução, com essa fundamentação, resolve o ponto levantado
4) Encerre com o posicionamento e o compromisso do Velotax pertinentes ao caso
NÃO omita nem resuma os fundamentos: cada base normativa, cláusula, data, valor ou dado citado na solução deve aparecer na resposta.

SOLUÇÃO IMPLEMENTADA (incorpore literalmente os elementos factuais e toda a fundamentação):
${dadosFormulario.solucao_implementada || 'N/A'}

TEXTO DO CLIENTE (para contextualizar):
${dadosFormulario.texto_cliente || 'N/A'}`;

                    let conteudoDesenvolvido = null;
                    try {
                        const responseDev = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            signal: controller.signal,
                            body: JSON.stringify({
                                model: envVars.OPENAI_MODEL || 'gpt-4o',
                                messages: [
                                    { role: 'system', content: systemPromptRA },
                                    { role: 'user', content: promptDesenvolvido }
                                ],
                                temperature: 0.4,
                                max_tokens: parseInt(envVars.OPENAI_MAX_TOKENS) || 2000
                            })
                        });
                        if (responseDev.ok) {
                            const dataDev = await responseDev.json();
                            conteudoDesenvolvido = dataDev.choices[0].message.content;
                        }
                    } catch (devError) {
                        console.log('⚠️ Erro na 3ª tentativa (desenvolvimento):', devError.message);
                    }

                    if (conteudoDesenvolvido && respostaValida(conteudoDesenvolvido)) {
                        conteudoMiolo = conteudoDesenvolvido;
                        console.log('✅ 3ª tentativa bem-sucedida — resposta desenvolvida e alinhada');
                    } else if (semSolucaoImpl) {
                        // Sem solução implementada não usamos o fallback genérico enxuto (deixaria o
                        // cliente sem solução). Preferimos a tentativa mais desenvolvida gerada a partir
                        // da base coerente, escolhendo a de maior conteúdo entre as candidatas.
                        const candidatas = [conteudoDesenvolvido, conteudoRetry, conteudoMiolo]
                            .filter(t => t && typeof t === 'string'
                                && !palavrasGenericas.some(p => t.toLowerCase().includes(p)));
                        const melhor = candidatas.sort((a, b) => b.length - a.length)[0];
                        if (melhor && melhor.length >= 200) {
                            conteudoMiolo = melhor;
                            console.log('⚠️ Sem solução implementada — usando a tentativa mais desenvolvida baseada na base coerente');
                        } else {
                            console.log('⚠️ Tentativas insuficientes — usando fallback');
                            conteudoMiolo = montarTextoFallbackRespostaRA(dadosFormulario);
                        }
                    } else {
                        console.log('⚠️ 3ª tentativa insuficiente — usando fallback baseado na solução implementada');
                        conteudoMiolo = montarTextoFallbackRespostaRA(dadosFormulario);
                    }
                }
            } else {
                console.log('✅ Resposta validada — reflete a solução implementada');
            }

            let resposta = formatarRespostaRA(conteudoMiolo, nomeCliente, nomeAgente, userData);
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
Sempre verificar os manuais oficiais do RA aplicáveis:
- Manual Geral de Moderação
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
                        content: 'Você é um analista de Reclame Aqui, com foco em reformulação de textos de moderação negados. Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
            const textoReformulado = humanizarPontuacaoGerada(data.choices[0].message.content);
            
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
                conhecimentoFeedback += '📋 PADRÕES IDENTIFICADOS (aplicar quando compatíveis com o texto atual e com o feedback do operador):\n';
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

            conhecimentoFeedback += '⚠️ ALINHAMENTO: LGPD, CDC, CCB ou cláusulas listadas só devem aparecer na resposta se constarem na solução implementada deste caso ou forem indispensáveis ao relato do que foi feito.\n';
            
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
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este aprendizado para orientar tom e detalhes; em reformulação com feedback do operador, não substitua o texto atual inteiro por um modelo da base, salvo se o feedback pedir reestruturação total.\n';
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

        const conhecimentoProdutos = obterConhecimentoProdutos(dadosFormulario);
        if (conhecimentoProdutos) {
            conhecimentoFeedback += conhecimentoProdutos;
            console.log('✅ CONHECIMENTO DE PRODUTOS INCLUÍDO NO PROMPT DE REFORMULAÇÃO');
        }

        if (feedback) {
            conhecimentoFeedback += '\n\n⚠️ MODO CIRÚRGICO (feedback do operador): exemplos e modelos da base acima servem só como referência de tom ou detalhe. Não substitua a resposta atual inteira por um modelo genérico. Prioridade: aplicar o pedido do operador sobre o texto atual.\n';
        }

        const dadosScriptGeracao = {
            tipo_solicitacao: dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao || '',
            id_reclamacao: dadosFormulario.id_reclamacao || dadosFormulario.idReclamacao || '',
            solucao_implementada: dadosFormulario.solucao_implementada || dadosFormulario.solucaoImplementada || '',
            texto_cliente: dadosFormulario.texto_cliente || dadosFormulario.reclamacaoCliente || '',
            historico_atendimento: dadosFormulario.historico_atendimento || dadosFormulario.historicoAtendimento || '',
            nome_solicitante: dadosFormulario.nome_solicitante || dadosFormulario.nomeSolicitante || ''
        };
        const scriptGeracaoRA = gerarScriptPadraoResposta(dadosScriptGeracao);

        const dadosConferencia = `Tipo de Situação: ${dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao}
Motivo da Solicitação: ${dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao}
Solução Implementada: ${dadosFormulario.solucao_implementada || dadosFormulario.solucaoImplementada}
Reclamação do Cliente: ${dadosFormulario.texto_cliente || dadosFormulario.reclamacaoCliente}
Histórico de Atendimento: ${dadosFormulario.historico_atendimento || dadosFormulario.historicoAtendimento}
Observações Internas: ${dadosFormulario.observacoes_internas || dadosFormulario.observacoesInternas}`;

        let prompt;
        if (feedback) {
            prompt = `📌 REFORMULAÇÃO CIRÚRGICA — RESPOSTA RA (MESMAS REGRAS DA GERAÇÃO PADRÃO)

Objetivo principal: aplicar EXATAMENTE o pedido do operador no texto já produzido.
Objetivo secundário: preservar o máximo possível da redação anterior (estrutura, ordem dos parágrafos e trechos que o feedback não mexe).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS PERMANENTES — SCRIPT DE GERAÇÃO RA (VÁLIDAS PARA O TEXTO FINAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${scriptGeracaoRA}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEXTO ATUAL (BASE OBRIGATÓRIA — AJUSTAR SÓ O QUE O FEEDBACK EXIGE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${respostaAnterior}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOLICITAÇÃO DE CORREÇÃO DO OPERADOR (PRIORIDADE ABSOLUTA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${feedback}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFERÊNCIA DE DADOS (corrigir inconsistência factual se preciso; não inventar fatos)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${dadosConferencia}

${conhecimentoFeedback || ''}

⚙️ COMO EXECUTAR (ORDEM OBRIGATÓRIA):

1. Leia o feedback e defina com precisão o que deve mudar (trechos a remover, acrescentar, alterar tom, corrigir dado).
2. Parta do TEXTO ATUAL acima: altere apenas o necessário para cumprir o feedback. Mantenha igual trechos que não são alvo do pedido.
3. Se o pedido for pontual (uma palavra, uma frase, um parágrafo), limite-se a isso e preserve o restante.
4. Em caso de conflito entre um exemplo da base de aprendizado e o TEXTO ATUAL, prevalecem o feedback do operador e a fidelidade ao TEXTO ATUAL (salvo erro factual contra os dados de conferência).
5. O resultado final deve obedecer ao FORMATO DE SAÍDA do script (apenas miolo: sem saudação "Olá", sem assinatura, sem telefone/site no miolo).

PROIBIDO: reescrever "do zero", descartar o texto atual sem necessidade ou substituir a resposta inteira por um modelo genérico.

`;
        } else {
            prompt = `📌 REFORMULAR RESPOSTA RA (MESMAS REGRAS DA GERAÇÃO PADRÃO)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS PERMANENTES — SCRIPT DE GERAÇÃO RA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${scriptGeracaoRA}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEXTO ATUAL (PRESERVAR AO MÁXIMO — REFINAR COM LEVEZA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${respostaAnterior}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFERÊNCIA DE DADOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${dadosConferencia}

${conhecimentoFeedback || ''}

INSTRUÇÕES (SEM FEEDBACK ESPECÍFICO DO OPERADOR):
- Parta do TEXTO ATUAL; não substitua por uma resposta genérica nova
- Melhore clareza, lacunas frente à reclamação ou à solução implementada e redundâncias; mantenha parágrafos e trechos válidos
- Tom profissional, direto e objetivo; NUNCA peça desculpas nem use "lamentamos", "sentimos muito"
- Não invente fatos além da solução implementada e dos campos de conferência
- Os exemplos da base de aprendizado são referência; não descarte o texto atual para copiar um modelo

⚠️ FORMATO: apenas o miolo da resposta, conforme o script acima (sem saudação "Olá", sem assinatura, sem telefone/site no miolo).

`;
        }

        // Com feedback do operador: temperatura mais baixa para preservar o texto e aplicar correção pontual
        const temperatureReform = feedback ? 0.35 : (parseFloat(envVars.OPENAI_TEMPERATURE) || 0.7);

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
                        content: feedback
                            ? 'Reformulação CIRÚRGICA de respostas RA no Velotax. O usuário envia o script completo de geração: cumpra-o no texto final. Preserve ao máximo o "TEXTO ATUAL" e altere somente o que o feedback do operador exige. Não reescreva do zero. Não cite LGPD, CCB ou CDC salvo se constar na solução implementada ou for indispensável ao relato. Sem travessão (—) nem hífen com espaços como pausa. Não agradeça pelo contato ou preocupação. Sempre escreva "Velotax" com V maiúsculo e no masculino (o Velotax, ao Velotax, do Velotax).'
                            : 'Reformulação de respostas RA no Velotax. Siga o script de geração enviado na mensagem. Parta do texto atual; refine sem substituir por modelo genérico. Não cite LGPD, CCB ou CDC salvo se constar na solução implementada ou for indispensável ao relato. Não agradeça pelo contato ou preocupação. Sempre escreva "Velotax" com V maiúsculo e no masculino (o Velotax, ao Velotax, do Velotax).'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: temperatureReform,
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
            respostaReformulada = formatarRespostaRA(respostaReformulada, nomeCliente, nomeAgente, userData);
            
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
        const { dataInicio, dataFim, tipo, idReclamacao } = req.query;
        const idReclamacaoFiltro = (idReclamacao || '').toString().trim();
        
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
                        
                        const modIdReclamacao = (moderacao[2] !== undefined && moderacao[2] !== null && moderacao[2] !== ''
                            ? moderacao[2]
                            : (moderacao['ID da Reclamação'] || moderacao.idReclamacao || '')).toString().trim();
                        todasSolicitacoes.push({
                            tipo: 'moderacao',
                            data: moderacao['Data/Hora'] || moderacao.data || '',
                            id: moderacao[1] || moderacao.ID || moderacao.id || '', // Usar índice [1] primeiro (coluna B)
                            idReclamacao: modIdReclamacao,
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

        // Filtrar por ID da Reclamação se fornecido (busca nas 4 fontes: Respostas Coerentes, Moderações, Aceitas, Negadas)
        let solicitacoesFiltradas = todasSolicitacoes;
        if (idReclamacaoFiltro) {
            solicitacoesFiltradas = todasSolicitacoes.filter(s => {
                const id = (s.idReclamacao || '').toString().trim();
                return id === idReclamacaoFiltro;
            });
            console.log(`🔍 Filtro por ID da Reclamação "${idReclamacaoFiltro}": ${solicitacoesFiltradas.length} solicitações`);
        }
        
        // Aplicar filtro de data se fornecido (sobre a lista já filtrada por ID, se houver)
        if (dataInicio || dataFim) {
            console.log('📅 Aplicando filtro de data:', { dataInicio, dataFim });
            solicitacoesFiltradas = solicitacoesFiltradas.filter(solicitacao => {
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
                tipo: tipo || 'todas',
                idReclamacao: idReclamacaoFiltro || null
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
        
        // Incrementar estatística global e registrar na aba Estatísticas da planilha
        await incrementarEstatisticaGlobal('respostas_coerentes');
        console.log('📊 Resposta coerente: estatística incrementada e sincronizada com aba Estatísticas');
        
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
                        content: 'Você é um analista de revisão de textos corporativos, focado em clareza, compliance e padronização. Sempre siga exatamente o formato de saída solicitado. Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
        const resultado = humanizarPontuacaoGerada(data.choices[0].message.content);
        console.log('✅ Revisão de texto gerada com sucesso');

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
    
    // Procurar pela seção de revisão (V7: "Revisão estratégica da resposta" ou legado)
    const marcadores = [
        '✍️ Revisão estratégica da resposta',
        'Revisão estratégica da resposta',
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
        
        // Base normativa real dos manuais (temas + regras AENV) para ancorar a chance
        const baseNormativaChance = montarBlocoChanceModeracao(
            `${reclamacaoCompleta || ''} ${respostaPublica || ''} ${consideracaoFinal || ''}`,
            ''
        );

        // ETAPA 0 — histórico real de moderações aprovadas semelhantes (calibração)
        const casosHistoricos = await carregarModeracoesAprovadasSimilares(
            `${reclamacaoCompleta || ''} ${respostaPublica || ''}`,
            5
        );
        const baseCalibracaoHistorica = montarBlocoCalibracaoHistorica(casosHistoricos);
        console.log(`📚 Calibração histórica: ${casosHistoricos.length} caso(s) aprovado(s) semelhante(s) encontrado(s).`);

        // Construir prompt completo — PROMPT DEFINITIVO VELOTAX V7 MASTER
        const prompt = `PROMPT DEFINITIVO VELOTAX V7 MASTER
SISTEMA COMPLETO DE ANÁLISE ESTRATÉGICA DE MODERAÇÃO DO RECLAME AQUI

1. IDENTIDADE DO SISTEMA

Você é uma inteligência artificial especializada em análise estratégica de moderação de reclamações na plataforma Reclame Aqui, operando sob a visão estratégica Velotax.

Seu papel é atuar como um analista sênior de reputação digital e moderação de conteúdo, especializado em identificar inconsistências em reclamações e orientar decisões sobre solicitações de moderação.

Você não é um assistente genérico.

Você é um analista de moderação de conteúdo do Reclame Aqui, treinado para reproduzir o raciocínio utilizado por analistas humanos experientes que trabalham diariamente com moderação de reclamações.

2. OBJETIVO PRINCIPAL

Diante de uma reclamação e da resposta pública da empresa, você deve:

1️⃣ identificar se o conteúdo da reclamação apresenta inconsistência moderável
2️⃣ estimar a probabilidade real de aceite da moderação
3️⃣ orientar ajustes estratégicos na resposta pública
4️⃣ prever como o sistema do Reclame Aqui interpretaria o caso.

3. BASE OBRIGATÓRIA DE ANÁLISE

Toda análise deve ser fundamentada obrigatoriamente em:

• Manual Geral de Moderação do Reclame Aqui
• Manual de Moderação – Bancos e Instituições Financeiras
• diretrizes de conteúdo da plataforma
• padrões históricos observados de moderação.

Os manuais devem ser tratados como referência obrigatória para identificar critérios de moderação.

Entretanto, a análise deve considerar como essas regras são aplicadas na prática, e não apenas sua interpretação literal.
${baseNormativaChance}
${baseCalibracaoHistorica}

4. PRINCÍPIO FUNDAMENTAL DO RECLAME AQUI

O Reclame Aqui não remove reclamações porque a empresa está correta.

O Reclame Aqui remove reclamações quando o conteúdo publicado apresenta:

• informação incorreta
• omissão de fato essencial
• narrativa que induz interpretação equivocada
• divergência entre relato e realidade factual.

Portanto, a análise deve focar sempre no conteúdo publicado pelo consumidor.

5. COMO FUNCIONA A MODERAÇÃO DO RECLAME AQUI

A moderação geralmente ocorre em duas etapas:

Etapa 1 — triagem automatizada

Um sistema automatizado avalia o pedido de moderação e busca inconsistências claras entre a reclamação e a resposta da empresa.

Esse sistema tende a identificar:

• acusações objetivas
• contradições explícitas
• inconsistências detectáveis sem interpretação complexa.

Etapa 2 — revisão humana

Em alguns casos, a solicitação pode ser analisada por moderadores humanos.

Moderadores humanos tendem a considerar:

• coerência narrativa
• presença de informação incorreta
• omissão relevante de contexto.

6. METODOLOGIA DE ANÁLISE

A análise deve seguir obrigatoriamente as etapas abaixo.

ETAPA 0 — CALIBRAÇÃO HISTÓRICA COM BASE NAS MODERAÇÕES REAIS DA VELOTAX

Objetivo: antes da análise técnica, consultar o histórico real de moderações APROVADAS da empresa (bloco "📚 HISTÓRICO REAL DE MODERAÇÕES APROVADAS" acima) para identificar padrões de aceite e calibrar a estimativa percentual FINAL.

A calibração histórica NÃO substitui os manuais do RA: os manuais continuam sendo a fonte principal da decisão. O histórico só ajusta a estimativa final e identifica padrões recorrentes de sucesso.
Se NÃO houver bloco de histórico acima (nenhum caso aprovado semelhante), NÃO aplique nenhum ajuste histórico e registre "nenhum caso semelhante" na seção de calibração; siga para a ETAPA 1.

PASSO 1 — Classifique o caso ATUAL: tema principal, tese da empresa, tipo de inconsistência alegada, produto envolvido, natureza da reclamação e se há (ou não) falha operacional, falha de atendimento e divergência factual.

PASSO 2 — Busca de similaridade: localize, entre os casos aprovados do histórico, os mais semelhantes ao atual. Pesos: ALTO = assunto principal, produto, tese, motivo da moderação; MÉDIO = tipo de reclamação, resposta pública; BAIXO = redação, nome do cliente, datas. Priorize contexto e fatos, não apenas palavras iguais.

PASSO 3 — Padrões aceitos: nos casos aprovados semelhantes, identifique quais teses tiveram aceite, quais argumentos se repetem, quais tipos de inconsistência foram aceitos e quais estruturas de resposta aparecem com frequência.

PASSO 4 — Aderência: classifique o caso atual como ALTA (muito semelhante aos aprovados), MÉDIA (algumas semelhanças) ou BAIXA (poucas semelhanças relevantes).

PASSO 5 — Impacto na probabilidade (ajuste aplicado sobre a % FINAL da ETAPA 9/11, nunca substituindo os manuais):
• ALTA aderência → +5 a +15 pontos percentuais
• MÉDIA aderência → 0 a +5 pontos percentuais
• BAIXA aderência → sem ajuste

REGRAS OBRIGATÓRIAS — a calibração histórica NÃO pode: ignorar os manuais do RA; transformar um caso fraco em forte; compensar falha grave de atendimento; compensar divergência relevante não respondida; nem compensar ausência de resposta aos fatos centrais — mesmo havendo casos semelhantes aprovados.

VALIDAÇÃO FINAL — antes de aplicar o ajuste, responda:
1. O caso atual atende aos requisitos da categoria AENV?
2. A resposta pública enfrenta os fatos centrais da reclamação?
3. Existe divergência relevante não respondida?
4. O histórico encontrado é realmente semelhante (contexto/fatos) ou só tem palavras parecidas?
Se qualquer resposta indicar baixa aderência, REDUZA ou ELIMINE o impacto histórico.

ETAPA 1 — IDENTIFICAÇÃO DA ACUSAÇÃO CENTRAL

Identifique qual é a acusação principal da reclamação.

Pergunta orientadora:

Qual comportamento da empresa o consumidor afirma que ocorreu?

Exemplos comuns:

• empresa vinculou chave Pix
• empresa bloqueou valor
• empresa cobrou indevidamente
• empresa impediu cancelamento
• empresa registrou dívida inexistente.

ETAPA 2 — IDENTIFICAÇÃO DA PREMISSA FACTUAL

Determine qual fato o consumidor afirma como verdadeiro.

Exemplo:

"a empresa vinculou meu CPF a uma chave Pix".

ETAPA 3 — CONFRONTO COM A RESPOSTA DA EMPRESA

Compare a premissa da reclamação com a resposta da empresa.

Avalie se a resposta:

• nega diretamente o fato alegado
• apresenta contexto omitido
• demonstra que a responsabilidade pertence a terceiro.

ETAPA 3.5 — COBERTURA DOS FATOS (OBRIGATÓRIA)

Liste TODOS os fatos relevantes narrados pelo consumidor (cada alegação, pedido, orientação recebida ou evento descrito).

Para CADA fato, classifique:
• Respondido diretamente — a resposta pública enfrenta o fato de forma clara e específica;
• Respondido parcialmente — a resposta toca no fato, mas de forma incompleta ou superficial;
• Não respondido — a resposta pública não trata o fato.

Calcule o PERCENTUAL DE COBERTURA = (fatos respondidos diretamente + parcialmente ponderados) sobre o total de fatos relevantes.

Se menos de 70% dos fatos relevantes forem efetivamente enfrentados pela resposta pública, REDUZA a chance de moderação (a resposta não cobre o que o consumidor narrou). Esse resultado alimenta a ETAPA 9 e o bloco de Auditoria de cobertura da seção 15.

ETAPA 4 — CLASSIFICAÇÃO DA DISTORÇÃO

Classifique o tipo de inconsistência.

Hierarquia obrigatória:

1️⃣ Omissão de fato essencial
2️⃣ Informação incorreta
3️⃣ Divergência entre relato e solução aplicada
4️⃣ Interpretação equivocada.

Sempre priorizar a categoria mais forte possível.

ETAPA 5 — SIMULAÇÃO DO BOT DE MODERAÇÃO

Simule como o sistema automatizado do Reclame Aqui interpretaria o caso.

Perguntas obrigatórias:

• existe acusação factual clara?
• a resposta contradiz diretamente essa acusação?
• a contradição é detectável automaticamente?

Se a inconsistência exigir interpretação complexa, reduzir a probabilidade estimada.

ETAPA 6 — SIMULAÇÃO DO MODERADOR HUMANO

Avalie como um moderador humano poderia interpretar o caso.

Perguntas orientadoras:

• a narrativa da reclamação induz interpretação equivocada?
• a reclamação omite contexto relevante?
• a resposta demonstra claramente a realidade factual?

TESTE DO MODERADOR (OBRIGATÓRIO):
Considerando APENAS a reclamação e a resposta pública, SEM acesso a CRM, sistemas internos, contratos ou registros da empresa:
1. É possível entender claramente O QUE aconteceu?
2. É possível entender POR QUE aconteceu?
3. É possível entender POR QUE a empresa entende que não violou o direito do consumidor?

Se QUALQUER uma das respostas for NÃO, reduza a probabilidade — o moderador não consegue concluir a favor da empresa só com o conteúdo público.

ETAPA 7 — CLASSIFICAÇÃO DO TEMA

Classifique o tema da reclamação.

Possíveis categorias:

• Pix
• cobrança
• dívida
• fraude
• cancelamento
• atendimento
• problema técnico.

PRINCÍPIO DE SEPARAÇÃO (OBRIGATÓRIO — LEIA ANTES DAS ETAPAS 8 E 9)

• A "chance de moderação" / probabilidade de aceite pelo Reclame Aqui depende dos CRITÉRIOS DOS MANUAIS DO RA e da inconsistência entre o conteúdo publicado na reclamação e os fatos demonstráveis (incluindo o que a resposta da empresa prova). Isso é o que a plataforma avalia ao decidir moderação.

• O RISCO REPUTACIONAL (ETAPA 8) é uma dimensão À PARTE: sensibilidade do tema para imagem, visibilidade ou gravidade percebida na conversa pública. Ele NÃO substitui nem replica as regras do RA.

• PROIBIDO deixar que risco reputacional ALTO, MÉDIO ou BAIXO altere, explique ou "justifique" a faixa de probabilidade da ETAPA 9. PROIBIDO subir ou descer a % só porque o caso menciona Pix, CPF, banco ou dados pessoais: esses fatores podem aumentar risco de imagem (ETAPA 8), mas a probabilidade de aceite da moderação deve refletir apenas aderência ao critério de moderação do conteúdo (informação incorreta, omissão essencial, etc.) e clareza da prova na resposta da empresa.

ETAPA 8 — AVALIAÇÃO DE RISCO REPUTACIONAL (INFORMATIVO — NÃO MISTURAR COM A % DO RA)

Classifique o risco para gestão de imagem e priorização interna, independentemente da probabilidade de aceite pelo RA:

BAIXO
MÉDIO
ALTO.

Indicadores que costumam elevar o risco de imagem (lista não exaustiva):

• Pix
• CPF
• fraude
• retenção de valores
• Bacen
• dados pessoais.

Observação: presença desses temas na reclamação não significa, por si só, maior chance de o RA aceitar moderação; relate-as aqui como risco reputacional, sem transportar esse juízo para a ETAPA 9.

ETAPA 9 — CÁLCULO DE PROBABILIDADE REAL (CONFORMIDADE COM OS MANUAIS DO RA)

NÃO existe faixa "padrão" nem teto artificial. NÃO ancore a estimativa em 40–60% por precaução: use TODA a escala de 5% a 95% conforme a conformidade real do caso com os manuais do RA. Ignore reputação, visibilidade ou "peso" midiático (isso é a ETAPA 8). A % deve refletir a probabilidade REAL de o RA aceitar a moderação, podendo ser alta quando estamos efetivamente em conformidade.

Combine dois eixos objetivos:

EIXO 1 — CONFORMIDADE COM OS MANUAIS (use a BASE NORMATIVA REAL acima):
• Existe um TEMA PASSÍVEL de moderação aplicável ao caso? A AUSÊNCIA de tema específico NÃO reduz automaticamente a chance: muitos casos da Velotax (elegibilidade, análise automática, pré-análise, indisponibilidade de oferta, score, margem) não têm tema correspondente nos manuais. Quando não houver tema aplicável, analise EXCLUSIVAMENTE pelas regras gerais da categoria AENV.
• A reclamação foi avaliada/respondida e está dentro do prazo de moderação?
• A resposta da empresa é condizente, comprova os fatos e NÃO incorre em nenhuma das 6 regras que bloqueiam a moderação (falha de atendimento, divergência de informação, discussão de mérito, cláusula abusiva, resposta genérica/evasiva)? Para CADA regra reprovada, reduza a probabilidade proporcionalmente à gravidade (penalização gradual, não zera automaticamente).

EIXO 2 — FORÇA DA INCONSISTÊNCIA MODERÁVEL:
• reclamação de experiência/insatisfação subjetiva, sem inconsistência factual → fraca
• interpretação equivocada do cliente → moderada
• omissão de fato essencial pelo cliente → forte
• informação incorreta clara → muito forte
• acusação comprovadamente falsa → conclusiva

CALIBRAGEM DA % (cruze os dois eixos, sem travar em 40–60; não seja excessivamente conservador):
• 80–95% → caso extremamente aderente ao manual e sem riscos relevantes (prova clara, nenhuma regra AENV reprovada, inconsistência forte/conclusiva, fatos cobertos).
• 60–80% → caso FORTE (boa conformidade, inconsistência moderada/forte bem demonstrada).
• 40–60% → caso MODERADO (conformidade parcial, 1 regra AENV reprovada ou prova incompleta).
• 25–40% → caso FRACO, mas ainda PLAUSÍVEL (inconsistência tênue ou cobertura/prova limitada).
• 5–25% → caso IMPROVÁVEL — reserve esta faixa apenas para situações CLARAMENTE desfavoráveis (reclamação procedente, empresa realmente falhou, ≥2 regras AENV reprovadas). NÃO use esta faixa para casos meramente "sem tema específico".

PESO DA QUALIDADE DA RESPOSTA DA EMPRESA (DRIVER QUE MOVE A %):
A força da inconsistência (Eixo 2) define a FAIXA possível do caso; a clareza e a conformidade da RESPOSTA da empresa (Eixo 1) definem ONDE dentro dessa faixa o caso cai e se ele chega ao topo. Isso significa:
• Uma resposta concreta, objetiva, que evidencia a inconsistência/omissão e cumpre as 6 regras AENV deve levar o caso ao TOPO da faixa possível (e pode subir uma faixa quando torna a inconsistência inequívoca).
• Uma resposta genérica, evasiva ou que esbarra em alguma regra AENV mantém o caso no PISO da faixa.
• Ao reanalisar uma resposta reformulada, a % só sobe se a reformulação trouxe ganho MATERIAL (enfrentou fato antes ignorado, eliminou divergência, reduziu risco AENV ou tornou o ocorrido mais compreensível). Melhora apenas de tom/estilo/organização não eleva a %.

A INCONSISTÊNCIA NÃO COMPENSA UMA RESPOSTA RUIM:
A força da inconsistência (Eixo 2) NUNCA poderá compensar uma resposta pública insuficiente. Mesmo diante de acusação falsa ou informação incorreta do consumidor, respostas genéricas, evasivas ou que não enfrentem os fatos centrais devem permanecer em faixas MODERADAS, nunca nas faixas altas.

DEFINIÇÃO OBJETIVA DE RESPOSTA GENÉRICA (não decida por conta própria — use estes critérios):
Considera-se resposta genérica quando ela:
• não explica a causa do problema;
• não enfrenta os principais fatos narrados pelo consumidor;
• utiliza apenas frases institucionais;
• depende de sistemas internos da empresa para ser compreendida;
• poderia ser usada em dezenas de reclamações diferentes sem alterações relevantes.
Respostas que se enquadrem em qualquer destes pontos puxam a chance para baixo.

PESO DA DIVERGÊNCIA NÃO RESPONDIDA:
Quando existir um fato CENTRAL narrado pelo consumidor que NÃO seja enfrentado pela resposta da empresa, trate como divergência relevante. Divergências relevantes não respondidas reduzem SIGNIFICATIVAMENTE a chance de moderação (cruze com a cobertura calculada na ETAPA 3.5).

Não use "tema financeiro" ou "tema sensível" como atalho para subir a faixa: só conformidade efetiva com os manuais e evidência de inconsistência qualificável os justificam.

ETAPA 10 — REFORMULAÇÃO ESTRATÉGICA DA RESPOSTA (VERSÃO EXPANDIDA)

A reformulação estratégica da resposta pública deve utilizar obrigatoriamente a resposta original da empresa como base principal do texto.

O objetivo da reformulação não é resumir a resposta, mas sim:

• reorganizar a narrativa

• tornar mais explícita a inconsistência da reclamação

• reforçar os fatos relevantes para moderação.

OBJETIVO DA REVISÃO (CONFORMIDADE COM OS MANUAIS — AUMENTAR A CHANCE REAL):
A resposta revisada deve ser ajustada para AUMENTAR a chance de moderação, sem trair os fatos. Para isso, obrigatoriamente:

• MANTER a solução implementada e o assunto real da resposta original (não inventar fatos novos, datas ou ações que não ocorreram)

• CONTINUAR respondendo de forma clara à reclamação do cliente (a resposta segue sendo uma resposta pública ao consumidor, não um texto interno)

• ENQUADRAR o caso em um TEMA PASSÍVEL aplicável da BASE NORMATIVA acima, quando os fatos sustentarem, citando o manual como indicado

• CUMPRIR as 6 REGRAS AENV: deixar a resposta condizente e objetiva (datas e ações concretas), NÃO admitir falha de atendimento, NÃO deixar pontos que gerem divergência sem prova, NÃO depender de juízo de mérito, NÃO se apoiar só em cláusula contratual, e NÃO usar "já resolvemos" como único argumento

• Pode REESTRUTURAR a narrativa e evidenciar a inconsistência/omissão do cliente, desde que cada fato continue verdadeiro e ancorado na solução implementada

A resposta reformulada deve manter a maior parte do conteúdo factual da resposta original, preservando sempre que possível:

• datas mencionadas

• histórico de atendimento

• descrição de contratação ou serviço

• contexto contratual

• explicações operacionais relevantes.

A reformulação deve ser igual ou ligeiramente mais detalhada que a resposta original, nunca significativamente menor.


REGRA DE PRESERVAÇÃO DE CONTEXTO

A IA não deve remover elementos importantes da resposta original, especialmente quando eles ajudam a demonstrar:

• como ocorreu a contratação

• quais condições foram aceitas pelo consumidor

• quais procedimentos foram realizados pela empresa

• quais consequências decorreram das ações do consumidor.

Essas informações são fundamentais para que o moderador compreenda o contexto completo do caso.


REGRA DE EVIDENCIAÇÃO DA INCONSISTÊNCIA

A resposta reformulada deve deixar explícito:

1️⃣ qual afirmação da reclamação é incorreta ou incompleta

2️⃣ qual contexto factual altera a interpretação do caso

3️⃣ qual ação foi efetivamente realizada pela empresa.

Sempre que possível, a resposta deve conter frases claras como:

"Não houve retenção da chave Pix pelo Velotax."

ou

"A portabilidade da chave Pix foi realizada conforme solicitado."


REGRA DE ESTRUTURA DA RESPOSTA

A resposta reformulada deve seguir a estrutura:

1️⃣ saudação e identificação do atendente

2️⃣ contextualização do atendimento

3️⃣ descrição factual detalhada do ocorrido

4️⃣ esclarecimento da inconsistência da reclamação

5️⃣ explicação das consequências contratuais ou operacionais

6️⃣ reforço da transparência da empresa

7️⃣ canais de atendimento.


REGRA DE PRESERVAÇÃO DE IDENTIDADE

A reformulação deve preservar obrigatoriamente o nome do consumidor e o nome do atendente exatamente como já aparecem no texto da resposta original da empresa. Utilizar sempre esses nomes já presentes na resposta; não inventar, não omitir e não substituir por termos genéricos.

Preservar também:

• canais de atendimento da empresa.

Nunca substituir por termos genéricos como:

"cliente"

"agente"

"empresa".


REGRA DE CLAREZA PARA MODERAÇÃO AUTOMATIZADA

A resposta reformulada deve facilitar a detecção da inconsistência pelo sistema automatizado do Reclame Aqui.

Isso significa que a resposta deve deixar claro que:

• a empresa não realizou a conduta alegada

• o consumidor interpretou incorretamente a situação

• ou omitiu contexto relevante.


RESULTADO ESPERADO

Após aplicar essa reformulação, a resposta estratégica deverá:

• manter densidade factual adequada

• preservar o contexto contratual ou operacional do caso

• tornar a inconsistência da reclamação evidente

• facilitar a leitura pelo sistema de moderação do Reclame Aqui.

ETAPA 11 — REAVALIAÇÃO DA PROBABILIDADE

Após reformular a resposta, reavaliar a probabilidade REAL pelos eixos da ETAPA 9. NÃO existe obrigação de a chance subir: a reformulação pode apenas melhorar a escrita sem alterar os fatos, a tese ou a aderência aos critérios do RA.

A probabilidade pós-revisão somente poderá ser MAIOR quando a reformulação:
• eliminar divergências relevantes;
• responder fatos que a resposta original ignorou;
• reduzir riscos previstos nas regras AENV; ou
• tornar o ocorrido substancialmente mais compreensível para um terceiro (sem acesso a sistemas internos).

Mudanças apenas de tom, cordialidade, organização textual, formalidade ou estilo NÃO justificam aumento significativo da probabilidade. É permitido (e esperado) que a chance permaneça IGUAL quando a reformulação não alterar materialmente a aderência aos critérios de moderação.

Informe DOIS números, sem trava em 40–60%:
• Chance com a resposta ORIGINAL (a que foi enviada para análise)
• Chance com a resposta REFORMULADA da ETAPA 10 (maior apenas se houve ganho material acima; caso contrário, igual)
A resposta reformulada da ETAPA 10 deve ser autossuficiente: se reenviada sozinha para nova análise pela ETAPA 9, teria de alcançar a chance pós-revisão aqui informada. No bloco 📈 Impacto da revisão, declare o percentual antes, o depois, o ganho (ou a ausência de ganho) e o que materialmente mudou para justificá-lo.

ETAPA 12 — VALIDAÇÃO INTERNA

Antes de finalizar a análise, verificar:

• a tese escolhida corresponde ao caso
• a probabilidade estimada está coerente com a tese e com os manuais do RA (não com o nível de risco reputacional da ETAPA 8)
• a resposta reformulada facilita a detecção da inconsistência
• risco reputacional e chance de moderação foram tratados como dimensões independentes na narrativa da análise

13. APRENDIZADO CONTÍNUO

Registrar padrões recorrentes:

• tipo de reclamação
• tese utilizada
• probabilidade estimada.

Utilizar esses padrões para calibrar análises futuras.

13.1 CALIBRAÇÃO HISTÓRICA (ATIVA — ver ETAPA 0):
A calibração histórica é executada na ETAPA 0 a partir do histórico real de moderações APROVADAS injetado no início do prompt. O ajuste percentual segue os limites e as regras da ETAPA 0. Quando não houver histórico semelhante disponível, NÃO invente padrões nem altere a % por suposição.

14. DETECÇÃO DE CRISE REPUTACIONAL

Se múltiplas reclamações apresentarem o mesmo padrão narrativo, indicar possível padrão de crise reputacional.

15. FORMATO FINAL DA ANÁLISE

A resposta deve sempre apresentar (mantendo claro que chance de moderação e risco reputacional são dimensões independentes):

📊 Chance de moderação

⚠️ Risco reputacional (somente sensibilidade de imagem; não repetir como justificativa da % acima)

🎯 Tese principal

🧩 Teses complementares

🧠 Fundamentação técnica

⚠️ Riscos de negativa

📋 Auditoria de cobertura dos fatos (da ETAPA 3.5):
   Liste, em formato "Fato | Status", cada fato relevante narrado pelo consumidor com seu status (Respondido diretamente / Respondido parcialmente / Não respondido) e informe o percentual total de cobertura da resposta. Use este bloco para deixar claro por que a chance foi reduzida quando a cobertura for baixa.

📚 Calibração histórica (da ETAPA 0):
   Casos semelhantes encontrados: X
   Casos aprovados analisados: X
   Padrões identificados: • ... • ... • ...
   Aderência ao histórico: ALTA / MÉDIA / BAIXA
   Impacto aplicado: +X% (0% se não houver histórico semelhante ou se a validação reprovar o ajuste)
   Justificativa do ajuste: ...

✍️ Revisão estratégica da resposta

📈 Impacto da revisão

🔍 Auditoria de consistência.

16. OBJETIVO FINAL DO SISTEMA

O sistema deve funcionar como analista estratégico de moderação do Reclame Aqui, capaz de:

• identificar oportunidades reais de moderação
• prever comportamento do sistema automatizado
• gerar respostas públicas mais eficazes
• apoiar decisões estratégicas da empresa.

---

📥 DADOS DO CASO:

RECLAMAÇÃO COMPLETA DO CONSUMIDOR:
${reclamacaoCompleta}

RESPOSTA PÚBLICA DA EMPRESA:
${respostaPublica}

${consideracaoFinal ? `CONSIDERAÇÃO FINAL DO CONSUMIDOR:\n${consideracaoFinal}\n` : ''}
${historicoModeracao ? `HISTÓRICO DE TENTATIVAS DE MODERAÇÃO:\n${historicoModeracao}\n` : ''}

---

Agora, execute as etapas 0 a 12 da metodologia (começando pela calibração histórica da ETAPA 0) e entregue a análise no formato da seção 15 (FORMATO FINAL DA ANÁLISE).`;

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
                        content: 'Você é o sistema de análise de moderação do Reclame Aqui (PROMPT DEFINITIVO VELOTAX V7 MASTER). Estime a probabilidade de aceite SOMENTE com base nos critérios dos manuais do RA e na inconsistência factual entre reclamação e resposta; o risco reputacional é métrica separada e NÃO deve alterar essa probabilidade. Identifique inconsistências moderáveis, oriente ajustes na resposta pública e preveja como o RA interpretaria o caso. Na revisão estratégica da resposta, preserve nome do consumidor, nome do atendente e dados do caso. Entregue no formato da seção 15. Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
            // Preservar nomes da resposta pública original (regra obrigatória)
            const nomesRespostaOriginal = extrairNomesDaRespostaPublica(respostaPublica);
            let nomeCliente = nomesRespostaOriginal.nomeCliente;
            let nomeAgente = nomesRespostaOriginal.nomeAgente;
            // Fallback: cliente da reclamação e agente do usuário logado
            if (!nomeCliente || nomeCliente.trim() === '') {
                nomeCliente = extrairNomeCliente(reclamacaoCompleta);
            }
            if (!nomeAgente || nomeAgente.trim() === '') {
                const u = req.user || req.userData;
                nomeAgente = (u && u.nome) ? obterPrimeiroNomeUsuario(u) : 'Agente';
            }
            // Aplicar formatação da resposta RA (com nomes da resposta original quando existirem)
            const respostaFormatada = formatarRespostaRA(respostaRevisada, nomeCliente, nomeAgente, req.user || req.userData || null);
            
            // Substituir a resposta revisada no resultado pela versão formatada (V7 e legado)
            const marcadoresSubst = [
                '✍️ Revisão estratégica da resposta',
                'Revisão estratégica da resposta',
                '✍️ Revisão de Textos (versão estratégica)',
                'Revisão de Textos (versão estratégica)',
                'REVISÃO DE TEXTOS'
            ];
            
            for (const marcador of marcadoresSubst) {
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

        res.json({
            success: true,
            result: humanizarPontuacaoGerada(resultado)
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
        const respostaAjustada = humanizarPontuacaoGerada(data.choices[0].message.content.trim());
        
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
            permissoes: ['visualizar', 'gerar_respostas'],
            genero: null
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

// Função simplificada para verificar se a data é hoje (usada pelo endpoint estatísticas-hoje e fallback).
function verificarDataHojeSimples(dataStr, dataHojeBR, dataHojeISO) {
    if (!dataStr) return false;
    const dataLimpa = String(dataStr).trim();
    let dataParte = dataLimpa.split(' ')[0];
    if (dataParte.includes('/')) {
        const partes = dataParte.split('/');
        if (partes.length === 3) {
            const [dia, mes, ano] = partes;
            const dataFormatada = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
            return dataFormatada === dataHojeISO;
        }
    }
    if (dataParte.includes('-')) {
        const partes = dataParte.split('-');
        if (partes.length >= 3) {
            const dataFormatada = `${partes[0]}-${partes[1].padStart(2, '0')}-${partes[2].padStart(2, '0')}`;
            return dataFormatada === dataHojeISO;
        }
    }
    const [diaHoje, mesHoje, anoHoje] = dataHojeBR.split('/');
    if (dataLimpa.includes(diaHoje) && dataLimpa.includes(mesHoje) && dataLimpa.includes(anoHoje)) return true;
    return false;
}

// Conta registros onde coluna A = data do dia (pula cabeçalho). Usado para Moderações Negadas (sem filtro de status).
function contarRegistrosDataHoje(rows, dataHojeBR, dataHojeISO) {
    if (!rows || !Array.isArray(rows)) return 0;
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
        const cell = rows[i] && rows[i][0];
        if (cell != null && String(cell).trim() && verificarDataHojeSimples(cell, dataHojeBR, dataHojeISO)) {
            count++;
        }
    }
    return count;
}

// Conta registros onde coluna A = data do dia E coluna de status = "Aprovada" (pula cabeçalho).
// statusColIndex: K=10 (Respostas Coerentes), M=12 (Moderações e Moderações Aceitas).
function contarRegistrosDataHojeComStatusAprovada(rows, dataHojeBR, dataHojeISO, statusColIndex) {
    if (!rows || !Array.isArray(rows)) return 0;
    let count = 0;
    const aprovada = 'aprovada';
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const cellData = row[0];
        const status = String((row[statusColIndex] != null ? row[statusColIndex] : '')).trim().toLowerCase();
        if (cellData != null && String(cellData).trim() && verificarDataHojeSimples(cellData, dataHojeBR, dataHojeISO) && status === aprovada) {
            count++;
        }
    }
    return count;
}

// Cache simples para /api/estatisticas-hoje (reduz quota do Google Sheets; TTL 90s).
let cacheEstatisticasHoje = { data: null, dataISO: null, timestamp: 0 };
const CACHE_ESTATISTICAS_TTL_MS = 90 * 1000;

// Endpoint para buscar estatísticas do dia atual (contagem nas abas: Respostas Coerentes, Moderações, Moderações Aceitas, Moderações Negadas)
// ===== AUDITORIA EXECUTIVA (aprendizado + moderações) =====
let _cacheAuditoria = {}; // { [janela]: { data, timestamp } }
const CACHE_AUDITORIA_TTL_MS = 5 * 60 * 1000;

function _audParseDataBR(str) {
    if (!str) return null;
    const s = String(str).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const iso = new Date(s);
    return isNaN(iso.getTime()) ? null : iso;
}

function _audRowsToObjects(data) {
    if (!data || data.length <= 1) return [];
    const headers = data[0].map(h => String(h || '').trim());
    const rows = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row.some(c => c !== undefined && c !== '')) continue;
        const obj = { _linha: i + 1 };
        headers.forEach((h, idx) => { if (h) obj[h] = row[idx] !== undefined ? row[idx] : ''; });
        obj._dataRaw = row[0] || obj['Data/Hora'] || obj['Data do Registro'] || '';
        obj._data = _audParseDataBR(String(obj._dataRaw));
        rows.push(obj);
    }
    return rows;
}

const _AUD_TIPOS_NOVOS = new Set([
    'antecipacao', 'antecipacao-2026', 'aplicativo', 'conta-celcoin',
    'credito-ao-trabalhador', 'clube-velotax', 'emprestimo-pessoal', 'seguros',
    'incoerente', 'em-cobranca', 'veloprime', 'divida-prescrita', 'juros-abusivos'
]);
const _AUD_TIPOS_ANTIGOS = new Set([
    'exclusao-cadastro', 'exclusao-chave-pix-cpf', 'liberacao-chave-pix',
    'antecipacao-restituicao', 'quitação-antecipada', 'esclarecimento', 'teste-escrita'
]);
function _audNormTipo(t) {
    return String(t || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function _audClassificarTipo(tipo) {
    const n = _audNormTipo(tipo);
    if (!n) return 'vazio';
    for (const t of _AUD_TIPOS_NOVOS) if (n.includes(t) || t.includes(n)) return 'novo';
    for (const t of _AUD_TIPOS_ANTIGOS) if (n.includes(t.replace(/-/g, '')) || n.includes(t)) return 'antigo';
    return 'outro';
}
function _audTemTomAntigo(texto) {
    if (!texto) return false;
    const t = texto.toLowerCase();
    return ['agradecemos', 'agradeço', 'lamentamos', 'sentimos muito', 'pedimos desculpas',
        'compreendemos o transtorno', 'infelizmente', 'prezado(a) cliente'].some(p => t.includes(p));
}
function _audCitaLegalSemSolucao(resposta, solucao) {
    if (!resposta) return false;
    const r = resposta.toLowerCase();
    const termos = ['lgpd', 'ccb', 'código de defesa', 'codigo de defesa', 'cdc', 'banco central', 'cláusula', 'clausula'];
    if (!termos.some(term => r.includes(term))) return false;
    const s = (solucao || '').toLowerCase();
    return !termos.some(term => s.includes(term));
}
function _audRefleteSolucao(resposta, solucao) {
    if (!solucao || !String(solucao).trim()) return null;
    if (!resposta) return false;
    const sol = String(solucao).toLowerCase().trim();
    const resp = resposta.toLowerCase();
    if (resp.includes(sol.substring(0, Math.min(50, sol.length)))) return true;
    const palavras = sol.split(/\s+/).map(p => p.replace(/[^a-záàâãéêíóôõúç0-9]/gi, '')).filter(p => p.length >= 4);
    if (palavras.length === 0) return resp.includes(sol.substring(0, 20));
    const match = palavras.filter(p => resp.includes(p)).length;
    return match >= Math.max(2, Math.ceil(palavras.length * 0.35));
}
function _audContarPor(arr, fn) {
    const m = {};
    for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; }
    return m;
}
function _audCoerenteBom(r) {
    const resp = r['Resposta Aprovada'] || '';
    const sol = r['Solução Implementada'] || '';
    return !_audTemTomAntigo(resp) && !_audCitaLegalSemSolucao(resp, sol) && _audRefleteSolucao(resp, sol) !== false;
}

async function _audLerAba(nome) {
    try {
        return _audRowsToObjects(await googleSheetsConfig.readData(`${nome}!A1:Z5000`));
    } catch (e) {
        console.warn(`⚠️ Auditoria: erro ao ler "${nome}":`, e.message);
        return [];
    }
}

const AUDITORIA_CFG_PADRAO = {
    fatorResp: 0.25, respMin: 3, respMax: 12,
    fatorAceitas: 0.15, aceitasMin: 5, aceitasMax: 40,
    fatorNegadas: 0.08, negadasMin: 3, negadasMax: 20,
    pesoResp: 0.5, pesoAceitas: 0.3, pesoNegadas: 0.2
};

function normalizarCfgAuditoria(cfg = {}) {
    const num = (v, def) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : def;
    };
    const out = {
        fatorResp: Math.min(Math.max(num(cfg.fatorResp, AUDITORIA_CFG_PADRAO.fatorResp), 0.05), 1),
        respMin: Math.round(Math.min(Math.max(num(cfg.respMin, AUDITORIA_CFG_PADRAO.respMin), 1), 50)),
        respMax: Math.round(Math.min(Math.max(num(cfg.respMax, AUDITORIA_CFG_PADRAO.respMax), 1), 100)),
        fatorAceitas: Math.min(Math.max(num(cfg.fatorAceitas, AUDITORIA_CFG_PADRAO.fatorAceitas), 0.01), 1),
        aceitasMin: Math.round(Math.min(Math.max(num(cfg.aceitasMin, AUDITORIA_CFG_PADRAO.aceitasMin), 1), 200)),
        aceitasMax: Math.round(Math.min(Math.max(num(cfg.aceitasMax, AUDITORIA_CFG_PADRAO.aceitasMax), 1), 500)),
        fatorNegadas: Math.min(Math.max(num(cfg.fatorNegadas, AUDITORIA_CFG_PADRAO.fatorNegadas), 0.01), 1),
        negadasMin: Math.round(Math.min(Math.max(num(cfg.negadasMin, AUDITORIA_CFG_PADRAO.negadasMin), 1), 200)),
        negadasMax: Math.round(Math.min(Math.max(num(cfg.negadasMax, AUDITORIA_CFG_PADRAO.negadasMax), 1), 500)),
        pesoResp: Math.min(Math.max(num(cfg.pesoResp, AUDITORIA_CFG_PADRAO.pesoResp), 0), 1),
        pesoAceitas: Math.min(Math.max(num(cfg.pesoAceitas, AUDITORIA_CFG_PADRAO.pesoAceitas), 0), 1),
        pesoNegadas: Math.min(Math.max(num(cfg.pesoNegadas, AUDITORIA_CFG_PADRAO.pesoNegadas), 0), 1)
    };
    if (out.respMax < out.respMin) out.respMax = out.respMin;
    if (out.aceitasMax < out.aceitasMin) out.aceitasMax = out.aceitasMin;
    if (out.negadasMax < out.negadasMin) out.negadasMax = out.negadasMin;
    // Normaliza os pesos para somarem 1 (evita índice fora de escala)
    const somaPesos = out.pesoResp + out.pesoAceitas + out.pesoNegadas;
    if (somaPesos > 0) {
        out.pesoResp /= somaPesos;
        out.pesoAceitas /= somaPesos;
        out.pesoNegadas /= somaPesos;
    } else {
        out.pesoResp = AUDITORIA_CFG_PADRAO.pesoResp;
        out.pesoAceitas = AUDITORIA_CFG_PADRAO.pesoAceitas;
        out.pesoNegadas = AUDITORIA_CFG_PADRAO.pesoNegadas;
    }
    return out;
}

async function gerarRelatorioAuditoria(janelaDias, cfgEntrada = {}) {
    const cfg = normalizarCfgAuditoria(cfgEntrada);
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - janelaDias);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(hoje);
    fim.setHours(23, 59, 59, 999);

    const dentro = (rows) => rows.filter(r => r._data && r._data >= inicio && r._data <= fim);

    const [coerentesAll, feedbacksAll, modAll, aceitasAll, negadasAll] = await Promise.all([
        _audLerAba('Respostas Coerentes'),
        _audLerAba('Feedbacks'),
        _audLerAba('Moderações'),
        _audLerAba('Moderações Aceitas'),
        _audLerAba('Moderações Negadas')
    ]);

    const coerentes = dentro(coerentesAll);
    const feedbacks = dentro(feedbacksAll);
    const mod = dentro(modAll);
    const aceitas = dentro(aceitasAll);
    const negadas = dentro(negadasAll);

    // ----- Aprendizado: coerentes -----
    const coerentesBons = coerentes.filter(_audCoerenteBom).length;
    const relCoerentes = {
        total: coerentes.length,
        bons: coerentesBons,
        pctBons: coerentes.length ? Math.round((coerentesBons / coerentes.length) * 100) : 0,
        tomAntigo: coerentes.filter(r => _audTemTomAntigo(r['Resposta Aprovada'] || '')).length,
        legalSemSolucao: coerentes.filter(r => _audCitaLegalSemSolucao(r['Resposta Aprovada'] || '', r['Solução Implementada'] || '')).length,
        naoRefleteSolucao: coerentes.filter(r => _audRefleteSolucao(r['Resposta Aprovada'] || '', r['Solução Implementada'] || '') === false).length,
        porTipo: _audContarPor(coerentes, r => r['Tipo Solicitação'] || r['Tipo de Situação'] || '(vazio)'),
        porClassificacaoTipo: _audContarPor(coerentes, r => _audClassificarTipo(r['Tipo Solicitação'] || r['Tipo de Situação']))
    };

    // ----- Aprendizado: feedbacks -----
    const relFeedbacks = {
        total: feedbacks.length,
        tomAntigoReform: feedbacks.filter(r => _audTemTomAntigo(r['Resposta Reformulada'] || '')).length,
        legalSemSolucao: feedbacks.filter(r => _audCitaLegalSemSolucao(r['Resposta Reformulada'] || '', r['Solução Implementada'] || '')).length,
        naoRefleteSolucao: feedbacks.filter(r => _audRefleteSolucao(r['Resposta Reformulada'] || '', r['Solução Implementada'] || '') === false).length,
        porTipo: _audContarPor(feedbacks, r => r['Tipo Solicitação'] || '(vazio)'),
        porClassificacaoTipo: _audContarPor(feedbacks, r => _audClassificarTipo(r['Tipo Solicitação']))
    };

    // ----- Evolução: janelas 60/90/120 + por mês (últimos 6 meses) -----
    const janelas = [60, 90, 120].map(dias => {
        const desde = new Date(hoje); desde.setDate(desde.getDate() - dias);
        const cJanela = coerentesAll.filter(r => r._data && r._data >= desde);
        const fJanela = feedbacksAll.filter(r => r._data && r._data >= desde);
        const cBons = cJanela.filter(_audCoerenteBom).length;
        return {
            dias,
            coerentesTotal: cJanela.length,
            coerentesPadraoAtual: cBons,
            coerentesForaPadrao: cJanela.length - cBons,
            feedbacksTotal: fJanela.length,
            pctBons: cJanela.length ? Math.round((cBons / cJanela.length) * 100) : 0
        };
    });

    const porMes = [];
    for (let i = 5; i >= 0; i--) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const proximo = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 1);
        const cMes = coerentesAll.filter(r => r._data && r._data >= ref && r._data < proximo);
        const fMes = feedbacksAll.filter(r => r._data && r._data >= ref && r._data < proximo);
        const cBons = cMes.filter(_audCoerenteBom).length;
        porMes.push({
            mes: ref.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            coerentes: cMes.length,
            coerentesBons: cBons,
            pctBons: cMes.length ? Math.round((cBons / cMes.length) * 100) : 0,
            feedbacks: fMes.length
        });
    }

    // ----- Moderações -----
    const statusDe = (r) => String(r['Status Aprovação'] || '').trim().toLowerCase();
    const relModeracoes = {
        total: mod.length,
        aprovadas: mod.filter(r => statusDe(r).includes('aprov')).length,
        pendentes: mod.filter(r => statusDe(r).includes('pend')).length,
        comFeedback: mod.filter(r => String(r['Feedback'] || '').trim()).length,
        coerentesUtilizaveis: mod.filter(r => statusDe(r) === 'aprovada' && !String(r['Feedback'] || '').trim()).length,
        porStatus: _audContarPor(mod, r => statusDe(r) || '(vazio)'),
        porMotivo: _audContarPor(mod, r => r['Motivo Moderação'] || '(vazio)')
    };

    const j90 = janelas.find(j => j.dias === 90) || janelas[0];
    let recomendacao;
    if (j90 && j90.coerentesPadraoAtual >= 5 && j90.pctBons >= 40) {
        recomendacao = 'Base de aprendizado saudável: janela de 90 dias + filtro de qualidade. Bom volume de respostas coerentes no padrão atual.';
    } else if (j90 && j90.coerentesPadraoAtual >= 2) {
        recomendacao = `Janela de 90 dias + filtro de qualidade ativo. Poucos coerentes no padrão atual (${j90.coerentesPadraoAtual}) — aprendizado complementar; priorizar script + solução implementada.`;
    } else {
        recomendacao = 'Quase nenhum coerente no padrão atual — geração usa o script padrão até a curadoria de novos exemplos.';
    }

    // ===== ÍNDICE DE MATURIDADE + ONDE FOCAR (lacunas) + PROJEÇÃO DE GANHO =====
    // Parâmetros vindos da configuração (com defaults). A meta de respostas por tipo e as
    // metas de moderação (aceitas/negadas) são CALIBRADAS pela demanda, com piso e teto.
    const META_RESP_MIN = cfg.respMin;
    const META_RESP_MAX = cfg.respMax;
    const FATOR_DEMANDA = cfg.fatorResp;   // fração dos casos atendidos do tipo que viram exemplos curados
    const PESO_RESP = cfg.pesoResp, PESO_ACEITAS = cfg.pesoAceitas, PESO_NEGADAS = cfg.pesoNegadas;

    // Metas de moderação calibradas pelo VOLUME de moderações na janela
    const demandaModeracao = relModeracoes.total;
    const META_ACEITAS = Math.min(cfg.aceitasMax, Math.max(cfg.aceitasMin, Math.ceil(demandaModeracao * cfg.fatorAceitas)));
    const META_NEGADAS = Math.min(cfg.negadasMax, Math.max(cfg.negadasMin, Math.ceil(demandaModeracao * cfg.fatorNegadas)));

    // Bons por tipo (apenas coerentes de qualidade contam para a maturidade)
    const bonsPorTipo = {};
    for (const r of coerentes) {
        const tipo = r['Tipo Solicitação'] || r['Tipo de Situação'] || '(vazio)';
        if (!bonsPorTipo[tipo]) bonsPorTipo[tipo] = 0;
        if (_audCoerenteBom(r)) bonsPorTipo[tipo]++;
    }
    // Tipos ativos = aparecem em coerentes OU em feedbacks (temas que o sistema precisa atender)
    const tiposAtivos = new Set([
        ...Object.keys(relCoerentes.porTipo || {}),
        ...Object.keys(relFeedbacks.porTipo || {})
    ]);
    tiposAtivos.delete('(vazio)');
    const listaTipos = Array.from(tiposAtivos);
    const numTipos = listaTipos.length || 1;

    // Demanda do tipo na janela = casos atendidos (coerentes registrados + correções/feedbacks)
    const demandaPorTipo = {};
    for (const t of listaTipos) {
        demandaPorTipo[t] = (relCoerentes.porTipo?.[t] || 0) + (relFeedbacks.porTipo?.[t] || 0);
    }
    // Meta calibrada por tipo, limitada por piso/teto
    const metaPorTipo = {};
    for (const t of listaTipos) {
        const calc = Math.ceil(demandaPorTipo[t] * FATOR_DEMANDA);
        metaPorTipo[t] = Math.min(META_RESP_MAX, Math.max(META_RESP_MIN, calc));
    }

    const subResp = listaTipos.length
        ? listaTipos.reduce((s, t) => s + Math.min((bonsPorTipo[t] || 0) / metaPorTipo[t], 1), 0) / numTipos
        : 0;
    const subAceitas = Math.min(aceitas.length / META_ACEITAS, 1);
    const subNegadas = Math.min(negadas.length / META_NEGADAS, 1);
    const indiceMaturidade = Math.round((subResp * PESO_RESP + subAceitas * PESO_ACEITAS + subNegadas * PESO_NEGADAS) * 100);

    // Deficit por tipo (quantas respostas de qualidade faltam para atingir a meta calibrada do tipo)
    const deficitPorTipo = listaTipos
        .map(t => ({
            tipo: t,
            bons: bonsPorTipo[t] || 0,
            meta: metaPorTipo[t],
            demanda: demandaPorTipo[t],
            faltam: Math.max(metaPorTipo[t] - (bonsPorTipo[t] || 0), 0)
        }))
        .filter(x => x.faltam > 0)
        .sort((a, b) => b.faltam - a.faltam);
    const deficitTotalResp = deficitPorTipo.reduce((s, x) => s + x.faltam, 0);

    // Projeção: aloca cada novo registro na "vaga" de maior ganho marginal (meta menor rende mais por unidade)
    const vagas = [];
    for (const x of deficitPorTipo) {
        const ganhoUnit = (1 / x.meta) / numTipos; // contribuição de 1 exemplo desse tipo no subResp
        for (let k = 0; k < x.faltam; k++) vagas.push(ganhoUnit);
    }
    vagas.sort((a, b) => b - a);
    const ganhoCoerentes = (n) => {
        let add = 0;
        for (let i = 0; i < Math.min(n, vagas.length); i++) add += vagas[i];
        const novo = Math.round(((subResp + add) * PESO_RESP + subAceitas * PESO_ACEITAS + subNegadas * PESO_NEGADAS) * 100);
        return Math.max(novo - indiceMaturidade, 0);
    };
    const ganhoAceitas = (n) => {
        const novoSub = Math.min((aceitas.length + n) / META_ACEITAS, 1);
        const novo = Math.round((subResp * PESO_RESP + novoSub * PESO_ACEITAS + subNegadas * PESO_NEGADAS) * 100);
        return Math.max(novo - indiceMaturidade, 0);
    };
    const ganhoNegadas = (n) => {
        const novoSub = Math.min((negadas.length + n) / META_NEGADAS, 1);
        const novo = Math.round((subResp * PESO_RESP + subAceitas * PESO_ACEITAS + novoSub * PESO_NEGADAS) * 100);
        return Math.max(novo - indiceMaturidade, 0);
    };

    const projecoes = [
        { acao: '+3 respostas coerentes de qualidade (nos tipos com lacuna)', tipoAcao: 'coerentes', quantidade: 3, ganhoPts: ganhoCoerentes(3) },
        { acao: '+5 respostas coerentes de qualidade (nos tipos com lacuna)', tipoAcao: 'coerentes', quantidade: 5, ganhoPts: ganhoCoerentes(5) },
        { acao: '+10 respostas coerentes de qualidade (nos tipos com lacuna)', tipoAcao: 'coerentes', quantidade: 10, ganhoPts: ganhoCoerentes(10) },
        { acao: '+5 moderações aceitas registradas', tipoAcao: 'aceitas', quantidade: 5, ganhoPts: ganhoAceitas(5) },
        { acao: '+3 moderações negadas com análise (onde errou / como corrigir)', tipoAcao: 'negadas', quantidade: 3, ganhoPts: ganhoNegadas(3) }
    ].sort((a, b) => b.ganhoPts - a.ganhoPts);

    const maturidade = {
        indice: indiceMaturidade,
        meta: 100,
        componentes: [
            { nome: 'Cobertura de respostas por tipo', valor: Math.round(subResp * 100), peso: Math.round(PESO_RESP * 100) },
            { nome: 'Moderações aceitas (positivo)', valor: Math.round(subAceitas * 100), peso: Math.round(PESO_ACEITAS * 100), detalhe: `${aceitas.length}/${META_ACEITAS}` },
            { nome: 'Moderações negadas com análise (negativo)', valor: Math.round(subNegadas * 100), peso: Math.round(PESO_NEGADAS * 100), detalhe: `${negadas.length}/${META_NEGADAS}` }
        ]
    };

    const oportunidades = {
        janelaDias,
        metaCalibrada: true,
        metaRespMin: META_RESP_MIN,
        metaRespMax: META_RESP_MAX,
        fatorDemanda: FATOR_DEMANDA,
        deficitTotalResp,
        tiposComLacuna: deficitPorTipo.slice(0, 12),
        aceitasFaltam: Math.max(META_ACEITAS - aceitas.length, 0),
        negadasFaltam: Math.max(META_NEGADAS - negadas.length, 0),
        metaAceitas: META_ACEITAS,
        metaNegadas: META_NEGADAS,
        metasModeracaoCalibradas: true,
        demandaModeracao,
        projecoes
    };

    // ===== CURVA DE APRENDIZADO SEMANAL (últimas 12 semanas, da fonte de verdade) =====
    const inicioSemana = (d) => {
        const x = new Date(d);
        const dow = (x.getDay() + 6) % 7; // segunda = 0
        x.setDate(x.getDate() - dow);
        x.setHours(0, 0, 0, 0);
        return x;
    };
    const semanaAtual = inicioSemana(hoje);
    const N_SEMANAS = 12;
    const buckets = [];
    for (let i = N_SEMANAS - 1; i >= 0; i--) {
        const ini = new Date(semanaAtual); ini.setDate(ini.getDate() - i * 7);
        const fimS = new Date(ini); fimS.setDate(fimS.getDate() + 6); fimS.setHours(23, 59, 59, 999);
        buckets.push({ ini, fimS,
            label: ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            coerentes: 0, coerentesBons: 0, feedbacks: 0, moderacoes: 0, aceitas: 0, negadas: 0 });
    }
    const indiceBucket = (data) => {
        if (!data) return -1;
        const diff = Math.floor((semanaAtual - inicioSemana(data)) / (7 * 24 * 60 * 60 * 1000));
        const idx = (N_SEMANAS - 1) - diff;
        return (idx >= 0 && idx < N_SEMANAS) ? idx : -1;
    };
    for (const r of coerentesAll) { const i = indiceBucket(r._data); if (i >= 0) { buckets[i].coerentes++; if (_audCoerenteBom(r)) buckets[i].coerentesBons++; } }
    for (const r of feedbacksAll) { const i = indiceBucket(r._data); if (i >= 0) buckets[i].feedbacks++; }
    for (const r of modAll) { const i = indiceBucket(r._data); if (i >= 0) buckets[i].moderacoes++; }
    for (const r of aceitasAll) { const i = indiceBucket(r._data); if (i >= 0) buckets[i].aceitas++; }
    for (const r of negadasAll) { const i = indiceBucket(r._data); if (i >= 0) buckets[i].negadas++; }
    const curvaSemanal = buckets.map(b => ({
        semana: b.label,
        coerentes: b.coerentes,
        coerentesBons: b.coerentesBons,
        pctBons: b.coerentes ? Math.round((b.coerentesBons / b.coerentes) * 100) : 0,
        feedbacks: b.feedbacks,
        moderacoes: b.moderacoes,
        aceitas: b.aceitas,
        negadas: b.negadas
    }));

    return {
        janelaDias,
        periodo: { de: inicio.toLocaleDateString('pt-BR'), ate: hoje.toLocaleDateString('pt-BR') },
        geradoEm: hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        sheetsOk: true,
        resumo: {
            coerentesPeriodo: relCoerentes.total,
            coerentesBons: relCoerentes.bons,
            pctBons: relCoerentes.pctBons,
            feedbacksPeriodo: relFeedbacks.total,
            moderacoesPeriodo: relModeracoes.total,
            moderacoesAprovadas: relModeracoes.aprovadas,
            moderacoesAceitas: aceitas.length,
            moderacoesNegadas: negadas.length
        },
        config: cfg,
        maturidade,
        oportunidades,
        curvaSemanal,
        aprendizado: { coerentes: relCoerentes, feedbacks: relFeedbacks, janelas, porMes, recomendacao },
        moderacoes: {
            totaisPlanilha: { moderacoes: modAll.length, aceitas: aceitasAll.length, negadas: negadasAll.length },
            noPeriodo: { moderacoes: mod.length, aceitas: aceitas.length, negadas: negadas.length },
            abaModeracoes: relModeracoes,
            abaAceitas: { total: aceitas.length, porTema: _audContarPor(aceitas, r => r['Tema'] || r['Motivo Utilizado'] || '(vazio)') },
            abaNegadas: { total: negadas.length, porMotivo: _audContarPor(negadas, r => r['Motivo da Negativa'] || r['Motivo Negativa'] || '(vazio)') }
        },
        totaisGerais: {
            coerentesPlanilha: coerentesAll.length,
            feedbacksPlanilha: feedbacksAll.length,
            coerentesAntesPeriodo: coerentesAll.filter(r => r._data && r._data < inicio).length,
            feedbacksAntesPeriodo: feedbacksAll.filter(r => r._data && r._data < inicio).length
        }
    };
}

app.get('/api/auditoria', async (req, res) => {
    console.log('🎯 Endpoint /api/auditoria chamado');
    try {
        let janelaDias = parseInt(req.query.janela, 10);
        if (!Number.isFinite(janelaDias) || janelaDias <= 0) janelaDias = 90;
        janelaDias = Math.min(janelaDias, 365);

        const cfg = normalizarCfgAuditoria({
            fatorResp: req.query.fatorResp, respMin: req.query.respMin, respMax: req.query.respMax,
            fatorAceitas: req.query.fatorAceitas, aceitasMin: req.query.aceitasMin, aceitasMax: req.query.aceitasMax,
            fatorNegadas: req.query.fatorNegadas, negadasMin: req.query.negadasMin, negadasMax: req.query.negadasMax,
            pesoResp: req.query.pesoResp, pesoAceitas: req.query.pesoAceitas, pesoNegadas: req.query.pesoNegadas
        });

        const chaveCache = `${janelaDias}::${JSON.stringify(cfg)}`;
        const cache = _cacheAuditoria[chaveCache];
        if (cache && (Date.now() - cache.timestamp) < CACHE_AUDITORIA_TTL_MS) {
            return res.json({ success: true, fromCache: true, relatorio: cache.data });
        }

        if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
            return res.json({ success: false, error: 'Planilha do Google Sheets indisponível no momento.', sheetsOk: false });
        }

        const relatorio = await gerarRelatorioAuditoria(janelaDias, cfg);
        _cacheAuditoria[chaveCache] = { data: relatorio, timestamp: Date.now() };
        res.json({ success: true, fromCache: false, relatorio });
    } catch (error) {
        console.error('❌ Erro ao gerar auditoria:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar auditoria: ' + error.message });
    }
});

app.get('/api/estatisticas-hoje', async (req, res) => {
    console.log('🎯 Endpoint /api/estatisticas-hoje chamado');
    try {
        const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        const dia = String(hoje.getDate()).padStart(2, '0');
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const ano = hoje.getFullYear();
        const dataHojeBR = `${dia}/${mes}/${ano}`;
        const dataHojeISO = `${ano}-${mes}-${dia}`;
        const lastUpdated = hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        if (cacheEstatisticasHoje.data && cacheEstatisticasHoje.dataISO === dataHojeISO && (Date.now() - cacheEstatisticasHoje.timestamp) < CACHE_ESTATISTICAS_TTL_MS) {
            const c = cacheEstatisticasHoje.data;
            return res.json({
                success: true,
                data: dataHojeBR,
                respostas_coerentes: c.respostas_coerentes,
                moderacoes_coerentes: c.moderacoes_coerentes,
                moderacoes_aprovadas: c.moderacoes_aprovadas,
                moderacoes_negadas: c.moderacoes_negadas,
                lastUpdated: c.lastUpdated,
                fromCache: true
            });
        }

        let respostas_coerentes = 0;
        let moderacoes_coerentes = 0;
        let moderacoes_aprovadas = 0;
        let moderacoes_negadas = 0;
        let quotaOuErroLeitura = false;

        if (googleSheetsConfig && googleSheetsConfig.isInitialized()) {
            // Respostas coerentes: aba "Respostas Coerentes", col. A = data do dia, col. K = Status aprovação "Aprovada"
            try {
                const rowsRC = await googleSheetsConfig.readData('Respostas Coerentes!A1:K5000');
                respostas_coerentes = contarRegistrosDataHojeComStatusAprovada(rowsRC, dataHojeBR, dataHojeISO, 10); // K = índice 10
                console.log(`📊 Respostas Coerentes (col. A = ${dataHojeBR}, col. K = Aprovada): ${respostas_coerentes}`);
            } catch (err) {
                if ((err.message || '').toLowerCase().includes('quota')) quotaOuErroLeitura = true;
                console.warn('⚠️ Erro ao ler aba Respostas Coerentes:', err.message);
            }
            // Moderações coerentes: aba "Moderações", col. A = data do dia, col. M = Status aprovação "Aprovada"
            try {
                const rowsMod = await googleSheetsConfig.readData('Moderações!A1:M5000');
                moderacoes_coerentes = contarRegistrosDataHojeComStatusAprovada(rowsMod, dataHojeBR, dataHojeISO, 12); // M = índice 12
                console.log(`📊 Moderações (col. A = ${dataHojeBR}, col. M = Aprovada): ${moderacoes_coerentes}`);
            } catch (err) {
                if ((err.message || '').toLowerCase().includes('quota')) quotaOuErroLeitura = true;
                console.warn('⚠️ Erro ao ler aba Moderações:', err.message);
            }
            // Moderações aceitas: aba "Moderações Aceitas", col. A = data do dia, col. M = Status aprovação "Aprovada"
            try {
                const rowsAceitas = await googleSheetsConfig.readData('Moderações Aceitas!A1:M5000');
                moderacoes_aprovadas = contarRegistrosDataHojeComStatusAprovada(rowsAceitas, dataHojeBR, dataHojeISO, 12); // M = índice 12
                console.log(`📊 Moderações Aceitas (col. A = ${dataHojeBR}, col. M = Aprovada): ${moderacoes_aprovadas}`);
            } catch (err) {
                if ((err.message || '').toLowerCase().includes('quota')) quotaOuErroLeitura = true;
                console.warn('⚠️ Erro ao ler aba Moderações Aceitas:', err.message);
            }
            // Moderações negadas: aba "Moderações Negadas", col. A = data do registro (qualquer registro do dia conta)
            try {
                const rowsNegadas = await googleSheetsConfig.readData('Moderações Negadas!A1:A5000');
                moderacoes_negadas = contarRegistrosDataHoje(rowsNegadas, dataHojeBR, dataHojeISO);
                console.log(`📊 Moderações Negadas (col. A = ${dataHojeBR}): ${moderacoes_negadas}`);
            } catch (err) {
                if ((err.message || '').toLowerCase().includes('quota')) quotaOuErroLeitura = true;
                console.warn('⚠️ Erro ao ler aba Moderações Negadas:', err.message);
            }
            console.log(`📊 Estatísticas do dia ${dataHojeBR} (planilha): respostas_coerentes=${respostas_coerentes}, mod_coerentes=${moderacoes_coerentes}, mod_aprovadas=${moderacoes_aprovadas}, mod_negadas=${moderacoes_negadas}`);
        }

        // Fallback: quota excedida, erro de leitura ou todos zerados → usar histórico local
        if (quotaOuErroLeitura || (respostas_coerentes === 0 && moderacoes_coerentes === 0 && moderacoes_aprovadas === 0 && moderacoes_negadas === 0)) {
            const estatisticas = loadEstatisticasGlobais();
            const entradaHoje = estatisticas.historico_diario && estatisticas.historico_diario.find(e => e.data === dataHojeISO);
            if (entradaHoje) {
                respostas_coerentes = entradaHoje.respostas_coerentes || 0;
                moderacoes_coerentes = entradaHoje.moderacoes_coerentes || 0;
                moderacoes_aprovadas = entradaHoje.moderacoes_aprovadas || 0;
                moderacoes_negadas = entradaHoje.moderacoes_negadas || 0;
                console.log(`📊 Estatísticas do dia ${dataHojeBR} (histórico local${quotaOuErroLeitura ? ' - quota/erro de leitura' : ''}): respostas_coerentes=${respostas_coerentes}, mod_coerentes=${moderacoes_coerentes}, mod_aprovadas=${moderacoes_aprovadas}, mod_negadas=${moderacoes_negadas}`);
            }
        }

        const payload = {
            success: true,
            data: dataHojeBR,
            respostas_coerentes,
            moderacoes_coerentes,
            moderacoes_aprovadas,
            moderacoes_negadas,
            lastUpdated
        };
        cacheEstatisticasHoje = { data: payload, dataISO: dataHojeISO, timestamp: Date.now() };
        res.json(payload);
    } catch (error) {
        console.error('Erro ao buscar estatísticas do dia:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar estatísticas do dia'
        });
    }
});

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
        const dataHoje = new Date().toISOString().split('T')[0];
        const entradaHoje = (estatisticas.historico_diario || []).find(e => e.data === dataHoje);
        const [a, m, d] = dataHoje.split('-');
        const dataBR = `${d}/${m}/${a}`;
        const diario = entradaHoje ? {
            data: dataBR,
            respostas_coerentes: entradaHoje.respostas_coerentes || 0,
            moderacoes_coerentes: entradaHoje.moderacoes_coerentes || 0,
            moderacoes_aprovadas: entradaHoje.moderacoes_aprovadas || 0,
            moderacoes_negadas: entradaHoje.moderacoes_negadas || 0
        } : { data: dataBR, respostas_coerentes: 0, moderacoes_coerentes: 0, moderacoes_aprovadas: 0, moderacoes_negadas: 0 };
        
        const success = await googleSheetsIntegration.registrarEstatisticas(diario);
        
        if (success) {
            res.json({
                success: true,
                message: 'Estatísticas do dia sincronizadas com sucesso!',
                estatisticas: diario
            });
        } else {
            // Retornar 200 com success: false para não quebrar o frontend (ex.: Sheets indisponível)
            res.json({
                success: false,
                error: 'Erro ao sincronizar estatísticas',
                message: 'Sincronização com Google Sheets indisponível ou falhou. Tente novamente mais tarde.',
                googleSheetsActive: false
            });
        }
        
    } catch (error) {
        console.error('Erro ao sincronizar estatísticas:', error);
        // Retornar 200 com success: false em vez de 500 para não quebrar o frontend
        res.json({
            success: false,
            error: 'Erro ao sincronizar estatísticas',
            message: error.message || 'Sincronização indisponível no momento.'
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

Você é um analista de moderações do Reclame Aqui. Sua tarefa é analisar uma moderação que foi NEGADA e gerar feedback estruturado em 3 blocos obrigatórios.

DADOS DA MODERAÇÃO NEGADA:
- Texto da moderação enviada: ${textoModeracao}
- Solicitação do cliente: ${solicitacaoCliente}
- Resposta da empresa: ${respostaEmpresa}
- Consideração final do consumidor: ${consideracaoFinal || 'N/A'}
- Motivo de moderação utilizado: ${motivoModeracao}
- Linha de raciocínio interna: ${linhaRaciocinio || 'N/A'}

⚙️ ANÁLISE OBRIGATÓRIA (baseada nos manuais do RA):

Consulte os manuais oficiais do Reclame Aqui aplicáveis:
1. Manual Geral de Moderação
2. Manual de Moderação – Bancos, Instituições Financeiras e Meios

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
                        content: 'Você é um analista de moderações do Reclame Aqui, com conhecimento profundo dos manuais oficiais da plataforma. Não use travessão (—) nem hífen com espaços como pausa; prefira vírgula ou ponto.'
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
        const content = humanizarPontuacaoGerada(data.choices[0].message.content.trim());

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
            bloco1_motivo_negativa: humanizarPontuacaoGerada(String(resultado.bloco1_motivo_negativa || 'Análise não disponível')),
            bloco2_onde_errou: humanizarPontuacaoGerada(String(resultado.bloco2_onde_errou || 'Análise não disponível')),
            bloco3_como_corrigir: humanizarPontuacaoGerada(String(resultado.bloco3_como_corrigir || 'Análise não disponível'))
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
        
        // Estatísticas de controle diário: apenas quantidade (aprovada ou negada)
        try {
            if (resultado === 'Aceita') {
                await incrementarEstatisticaGlobal('moderacoes_aprovadas');
            } else if (resultado === 'Negada') {
                await incrementarEstatisticaGlobal('moderacoes_negadas');
            }
        } catch (err) {
            console.error('Erro ao incrementar estatística de moderação:', err.message);
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

        const { tema, resultado, motivo, periodo, idReclamacao } = req.query;
        const idReclamacaoBusca = (idReclamacao || '').toString().trim();

        const aceitasData = await googleSheetsConfig.readData('Moderações Aceitas!A1:Z1000');
        const negadasData = await googleSheetsConfig.readData('Moderações Negadas!A1:Z1000');

        const moderacoes = [];

        // Processar aceitas
        if (aceitasData && aceitasData.length > 1) {
            for (let i = 1; i < aceitasData.length; i++) {
                const row = aceitasData[i];
                if (!row || row.length < 6) continue;

                const modIdReclamacao = (row[2] || '').toString().trim();
                const modTema = (row[3] || '').toString().trim();
                const modMotivo = (row[4] || '').toString().trim();
                const modResultado = 'Aceita';
                const modData = (row[0] || '').toString().trim();

                // Aplicar filtros
                if (idReclamacaoBusca && modIdReclamacao !== idReclamacaoBusca) continue;
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

                const modIdReclamacao = (row[2] || '').toString().trim();
                const modTema = (row[3] || '').toString().trim();
                const modMotivo = (row[4] || '').toString().trim();
                const modResultado = 'Negada';
                const modData = (row[0] || '').toString().trim();

                // Aplicar filtros
                if (idReclamacaoBusca && modIdReclamacao !== idReclamacaoBusca) continue;
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

// ===== RELATÓRIO DE RECLAMAÇÕES (RECLAME AQUI) =====

async function chamarOpenAIRelatorioReclamacoes(apiKey, envVars, systemPrompt, userPrompt, maxTokens = 2500) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: envVars.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.6,
            max_tokens: maxTokens
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorResponse = tratarErroOpenAI(response, errorData);
        throw new Error(errorResponse.error || errorResponse.message || 'Erro na API OpenAI');
    }

    const data = await response.json();
    const texto = humanizarPontuacaoGerada(data.choices[0]?.message?.content || '').trim();
    if (!texto) {
        throw new Error('Resposta vazia da API OpenAI');
    }
    return texto;
}

app.post('/api/relatorio-reclamacoes/gerar', rateLimitMiddleware, async (req, res) => {
    try {
        const { apiKey, envVars } = resolverChaveOpenAI();

        if (!apiKey) {
            console.warn('⚠️ Relatório de reclamações: OPENAI_API_KEY não encontrada (mesma config das outras abas)');
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada ou inválida'
            });
        }

        const { horarios, produtos, motivos, observacoes } = req.body;
        const processado = relatorioReclamacoes.validarEProcessar({
            horarios: horarios || '',
            produtos: produtos || '',
            motivos: motivos || ''
        });

        if (!processado.success) {
            return res.status(400).json({
                success: false,
                error: processado.error,
                contagens: processado.contagens,
                detalhes: processado.detalhes
            });
        }

        const userPrompt = relatorioReclamacoes.montarPromptGeracao(
            processado.dados,
            observacoes || ''
        );

        const maxTokens = relatorioReclamacoes.calcularMaxTokensGeracao(
            processado.dados.totalReclamacoes
        );
        console.log(
            `📊 Gerando relatório de reclamações via OpenAI (${processado.dados.totalReclamacoes} registro(s), max_tokens: ${maxTokens})...`
        );
        const relatorioBruto = await chamarOpenAIRelatorioReclamacoes(
            apiKey,
            envVars,
            relatorioReclamacoes.PROMPT_SISTEMA_GERACAO,
            userPrompt,
            maxTokens
        );
        const relatorio = relatorioReclamacoes.normalizarSaudacaoRelatorio(
            relatorioReclamacoes.normalizarFormatacaoRelatorio(relatorioBruto)
        );
        const detalhamento = relatorioReclamacoes.formatarDetalhamento(processado.dados);

        res.json({
            success: true,
            relatorio,
            detalhamento,
            resumo: {
                totalReclamacoes: processado.dados.totalReclamacoes,
                dataReferenciaGeracao: processado.dados.dataReferenciaGeracao,
                ontem: {
                    totalReclamacoes: processado.dados.ontem.totalReclamacoes,
                    quantidadeForaExpediente: processado.dados.ontem.quantidadeForaExpediente
                },
                hoje: {
                    totalReclamacoes: processado.dados.hoje.totalReclamacoes,
                    quantidadeForaExpediente: processado.dados.hoje.quantidadeForaExpediente,
                    agrupamentoPorMotivo: processado.dados.hoje.agrupamentoPorMotivo
                }
            }
        });
    } catch (error) {
        console.error('❌ Erro ao gerar relatório de reclamações:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao gerar relatório de reclamações'
        });
    }
});

app.post('/api/relatorio-reclamacoes/detalhamento', rateLimitMiddleware, async (req, res) => {
    try {
        const { horarios, produtos, motivos } = req.body;
        const processado = relatorioReclamacoes.validarEProcessar({
            horarios: horarios || '',
            produtos: produtos || '',
            motivos: motivos || ''
        });

        if (!processado.success) {
            return res.status(400).json({
                success: false,
                error: processado.error,
                contagens: processado.contagens,
                detalhes: processado.detalhes
            });
        }

        const detalhamento = relatorioReclamacoes.formatarDetalhamento(processado.dados);

        res.json({
            success: true,
            detalhamento,
            resumo: {
                totalReclamacoesDetalhamento: processado.dados.totalReclamacoesDetalhamento
            }
        });
    } catch (error) {
        console.error('❌ Erro ao gerar detalhamento de reclamações:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao gerar detalhamento de reclamações'
        });
    }
});

app.post('/api/relatorio-reclamacoes/corrigir', rateLimitMiddleware, async (req, res) => {
    try {
        const { apiKey, envVars } = resolverChaveOpenAI();

        if (!apiKey) {
            console.warn('⚠️ Correção de relatório: OPENAI_API_KEY não encontrada');
            return res.status(400).json({
                success: false,
                error: 'Chave da API OpenAI não configurada ou inválida'
            });
        }

        const { relatorioAtual, correcoes } = req.body;

        if (!relatorioAtual || !String(relatorioAtual).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum relatório disponível para correção. Gere o relatório primeiro.'
            });
        }

        if (!correcoes || !String(correcoes).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Informe as correções ou ajustes desejados.'
            });
        }

        const userPrompt = relatorioReclamacoes.montarPromptCorrecao(
            String(relatorioAtual).trim(),
            String(correcoes)
        );

        console.log('✏️ Aplicando correções ao relatório de reclamações via OpenAI...');
        const relatorio = await chamarOpenAIRelatorioReclamacoes(
            apiKey,
            envVars,
            relatorioReclamacoes.PROMPT_SISTEMA_CORRECAO,
            userPrompt,
            3000
        );

        res.json({
            success: true,
            relatorio
        });
    } catch (error) {
        console.error('❌ Erro ao corrigir relatório de reclamações:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao aplicar correções ao relatório'
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

