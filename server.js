// ===== SERVIDOR BACKEND SEGURO - VELOTAX BOT =====

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ===== INTEGRAÇÃO COM GOOGLE SHEETS =====
const googleSheetsIntegration = require('./google-sheets-integration');
const googleSheetsConfig = require('./google-sheets-config');

// ===== SISTEMA DE FILA PARA GOOGLE SHEETS =====
class GoogleSheetsQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.processingInterval = 500; // 500ms entre processamentos (mais rápido)
    }

    async addToQueue(operation, data, instant = false) {
        // Se for instantâneo, processar diretamente sem fila
        if (instant) {
            try {
                console.log(`⚡ Processamento INSTANTÂNEO: ${operation}`);
                const result = await googleSheetsIntegration[operation](data);
                console.log(`✅ Processamento instantâneo concluído: ${operation}`);
                return result;
            } catch (error) {
                console.error(`❌ Erro no processamento instantâneo ${operation}:`, error.message);
                throw error;
            }
        }
        
        // Processamento normal com fila
        return new Promise((resolve, reject) => {
            this.queue.push({
                operation,
                data,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        console.log(`🔄 Processando fila do Google Sheets: ${this.queue.length} itens`);

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            
            try {
                console.log(`📝 Processando: ${item.operation}`);
                const result = await googleSheetsIntegration[item.operation](item.data);
                item.resolve(result);
            } catch (error) {
                console.error(`❌ Erro ao processar ${item.operation}:`, error.message);
                item.reject(error);
            }

            // Aguardar intervalo entre processamentos
            if (this.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.processingInterval));
            }
        }

        this.isProcessing = false;
        console.log('✅ Fila do Google Sheets processada');
    }
}

const googleSheetsQueue = new GoogleSheetsQueue();

const app = express();
const PORT = process.env.PORT || 3001;

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
                        feedback1: feedback1.feedback.substring(0, 100) + '...',
                        feedback2: feedback2.feedback.substring(0, 100) + '...'
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
        if (feedback.dadosFormulario?.tipo_solicitacao && feedback.dadosFormulario?.motivo_solicitacao) {
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
function saveFeedbacksRespostas(feedbacks) {
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
                            motivo_solicitacao: ultimoFeedback.dadosFormulario?.motivo_solicitacao || ultimoFeedback.contexto?.motivoSolicitacao || 'N/A',
                            solucao_implementada: ultimoFeedback.dadosFormulario?.solucao_implementada || '',
                            historico_atendimento: ultimoFeedback.dadosFormulario?.historico_atendimento || '',
                            observacoes_internas: ultimoFeedback.dadosFormulario?.observacoes_internas || '',
                            texto_cliente: ultimoFeedback.dadosFormulario?.texto_cliente || 'N/A'
                        },
                        timestamp: ultimoFeedback.timestamp,
                        userProfile: ultimoFeedback.userData ? `${ultimoFeedback.userData.nome} (${ultimoFeedback.userData.email})` : 'N/A',
                        userName: ultimoFeedback.userData?.nome || 'N/A',
                        userEmail: ultimoFeedback.userData?.email || 'N/A'
                    };
                    
                    // SALVAMENTO SIMPLES - SEM AWAIT
                    googleSheetsIntegration.registrarFeedback(feedbackData).then(() => {
                        console.log('📋 Feedback salvo no Google Sheets:', ultimoFeedback.id);
                    }).catch(error => {
                        console.error('❌ Erro ao salvar feedback:', error.message);
                    });
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
                        
                        // SALVAMENTO SIMPLES - SEM AWAIT
                        googleSheetsIntegration.registrarFeedback(moderacaoData).then(() => {
                            console.log('📋 Moderação salva no Google Sheets:', ultimaModeracao.id);
                        }).catch(error => {
                            console.error('❌ Erro ao salvar moderação:', error.message);
                        });
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
function incrementarEstatisticaGlobal(tipo, quantidade = 1) {
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
}

// ===== SISTEMA DE APRENDIZADO SEPARADO =====

// Gerar script padrão "cru" para geração de respostas
function gerarScriptPadraoResposta(dadosFormulario) {
    return `📌 SCRIPT PADRÃO PARA GERAÇÃO DE RESPOSTA RA

Você é responsável por gerar respostas para o Reclame Aqui seguindo o script estruturado abaixo.

DADOS DE ENTRADA:
- Tipo de solicitação: ${dadosFormulario.tipo_solicitacao}
- Motivo da solicitação: ${dadosFormulario.motivo_solicitacao}
- Solução implementada: ${dadosFormulario.solucao_implementada}
- Texto do cliente: ${dadosFormulario.texto_cliente}
- Histórico de atendimento: ${dadosFormulario.historico_atendimento}
- Observações internas: ${dadosFormulario.observacoes_internas}

⚙️ FLUXO LÓGICO OBRIGATÓRIO:

1. ANÁLISE DA SOLICITAÇÃO:
- Identifique o problema alegado pelo cliente
- Verifique se a solução implementada resolve a solicitação
- Considere o contexto do histórico de atendimento

2. ESTRUTURA DA RESPOSTA:
a) Agradecimento e reconhecimento
b) Esclarecimento da situação
c) Solução apresentada/implementada
d) Compromisso de melhoria
e) Convite para contato direto

3. DIRETRIZES:
- Sempre reconheça o problema do cliente
- Explique as ações tomadas de forma clara
- Demonstre compromisso com a satisfação
- Mantenha tom profissional e respeitoso
- Seja específico e detalhado

Gere uma resposta completa e eficaz que atenda à solicitação do cliente.`;
}

// Reformular script com conhecimento da planilha
function reformularComConhecimento(scriptPadrao, dadosPlanilha, dadosFormulario) {
    let promptFinal = scriptPadrao;
    
    if (dadosPlanilha && (dadosPlanilha.modelosCoerentes?.length > 0 || dadosPlanilha.feedbacksRelevantes?.length > 0)) {
        promptFinal += '\n\n🧠 CONHECIMENTO APLICADO DA PLANILHA:\n';
        
        // Adicionar modelos coerentes
        if (dadosPlanilha.modelosCoerentes?.length > 0) {
            promptFinal += '\n✅ MODELOS COERENTES APROVADOS (use como referência):\n';
            dadosPlanilha.modelosCoerentes.forEach((modelo, index) => {
                promptFinal += `${index + 1}. Resposta aprovada: "${modelo.respostaAprovada?.substring(0, 200)}..."\n`;
                promptFinal += `   Contexto: ${modelo.dadosFormulario?.tipo_solicitacao} - ${modelo.dadosFormulario?.motivo_solicitacao}\n\n`;
            });
        }
        
        // Adicionar feedbacks relevantes
        if (dadosPlanilha.feedbacksRelevantes?.length > 0) {
            promptFinal += '\n⚠️ FEEDBACKS DE CORREÇÃO (evite estes erros):\n';
            dadosPlanilha.feedbacksRelevantes.forEach((feedback, index) => {
                promptFinal += `${index + 1}. ❌ Erro identificado: "${feedback.feedback?.substring(0, 150)}..."\n`;
                promptFinal += `   ✅ Resposta corrigida: "${feedback.respostaReformulada?.substring(0, 150)}..."\n\n`;
            });
        }
        
        promptFinal += '\n🎯 INSTRUÇÃO CRÍTICA: Use os modelos aprovados como referência e evite os erros identificados nos feedbacks.';
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
        
        return {
            modelosCoerentes,
            feedbacksRelevantes,
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
        
        // Filtrar modelos relevantes para o tipo de solicitação
        const modelos = todosModelos.filter(modelo => {
            const tipoSituacao = modelo['Tipo Solicitação'] || modelo.tipo_situacao || '';
            return tipoSituacao.toLowerCase().includes(tipoSolicitacao.toLowerCase());
        });
        
        console.log(`✅ Carregados ${modelos.length} modelos coerentes da planilha`);
        return modelos;
        
    } catch (error) {
        console.error('❌ Erro ao carregar modelos coerentes da planilha:', error.message);
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
        
        // Registrar no Google Sheets se ativo
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                // Registrar cada modelo individualmente com dados do usuário
                for (const modelo of modelos.modelos || []) {
                    const respostaData = {
                        id: modelo.id,
                        tipo: 'resposta',
                        tipoSituacao: modelo.tipo_situacao || modelo.contexto?.tipoSituacao || 'N/A',
                        motivoSolicitacao: modelo.motivo_solicitacao || modelo.contexto?.motivoSolicitacao || 'N/A',
                        respostaAprovada: modelo.respostaAprovada || 'N/A',
                        dadosFormulario: modelo.dadosFormulario || {},
                        timestamp: modelo.timestamp,
                        userProfile: modelo.userData ? `${modelo.userData.nome} (${modelo.userData.email})` : 'N/A',
                        userName: modelo.userData?.nome || 'N/A',
                        userEmail: modelo.userData?.email || 'N/A'
                    };
                await googleSheetsQueue.addToQueue('registrarRespostaCoerente', respostaData, true); // true = instantâneo
                console.log('✅ Resposta coerente registrada INSTANTANEAMENTE no Google Sheets');
                }
            } catch (error) {
                console.error('❌ Erro ao registrar resposta coerente no Google Sheets:', error.message);
            }
        }
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
        motivo_solicitacao: dadosFormulario.motivo_solicitacao,
        resposta_length: respostaAprovada ? respostaAprovada.length : 0,
        userData: userData ? `${userData.nome} (${userData.email})` : 'N/A'
    });
    
    const modelos = await loadModelosRespostas();
    console.log('📚 Modelos carregados:', modelos.modelos ? modelos.modelos.length : 0);
    
    const novoModelo = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo_situacao: dadosFormulario.tipo_solicitacao,
        motivo_solicitacao: dadosFormulario.motivo_solicitacao,
        dadosFormulario: dadosFormulario,
        respostaAprovada: respostaAprovada,
        userData: userData, // Incluir dados do usuário
        contexto: {
            tipoSituacao: dadosFormulario.tipo_solicitacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao
        }
    };
    
    console.log('🆕 Novo modelo criado com ID:', novoModelo.id);
    
    modelos.modelos.push(novoModelo);
    console.log('📝 Modelo adicionado ao array. Total agora:', modelos.modelos.length);
    
    console.log('💾 Chamando saveModelosRespostas...');
    await saveModelosRespostas(modelos);
    console.log('✅ saveModelosRespostas concluído');
    
    // Também adicionar ao aprendizado direto do script
    console.log('🧠 Adicionando ao aprendizado do script...');
    await addRespostaCoerenteAprendizado(dadosFormulario.tipo_solicitacao, dadosFormulario.motivo_solicitacao, respostaAprovada, dadosFormulario, userData);
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

// Obter modelos de moderação relevantes
async function getModelosModeracaoRelevantes(motivoModeracao) {
    const modelos = await loadModelosModeracoes();
    const relevantes = [];
    
    modelos.modelos.forEach(modelo => {
        let isRelevante = false;
        
        // Verificar correspondência de motivo de moderação
        if (modelo.motivoModeracao && motivoModeracao) {
            if (modelo.motivoModeracao.toLowerCase() === motivoModeracao.toLowerCase()) {
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
                instrucoesAprendizado += `   ✅ MODELO: "${resp.respostaAprovada.substring(0, 250)}..."\n\n`;
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
            googleSheetsIntegration.registrarFeedback(feedbackData).then(() => {
                        console.log('📋 Feedback salvo no Google Sheets');
                    }).catch(error => {
                        console.error('❌ Erro ao salvar feedback:', error.message);
                    });
                    console.log('📋 Feedback salvo DIRETAMENTE no Google Sheets');
        } catch (error) {
            console.error('❌ Erro ao registrar feedback no Google Sheets:', error.message);
        }
    }
    
    console.log('📝 Feedback adicionado ao aprendizado do script:', tipoSituacao);
    console.log('👤 Usuário que enviou o feedback:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
}

// Adicionar resposta coerente ao aprendizado do script
async function addRespostaCoerenteAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada, dadosFormulario, userData = null) {
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
        motivoSolicitacao: motivoSolicitacao,
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
    await identificarPadroesAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada);
    
    await saveAprendizadoScript(aprendizado);
    
    // Registrar no Google Sheets se ativo
    if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
        try {
            const respostaData = {
                id: Date.now(),
                tipo: 'resposta',
                tipoSituacao: tipoSituacao,
                motivoSolicitacao: motivoSolicitacao,
                respostaAprovada: respostaAprovada,
                dadosFormulario: dadosFormulario,
                timestamp: obterTimestampBrasil(),
                userProfile: userData ? `${userData.nome} (${userData.email})` : 'N/A',
                userName: userData?.nome || 'N/A',
                userEmail: userData?.email || 'N/A'
            };
            googleSheetsIntegration.registrarRespostaCoerente(respostaData).then(() => {
                        console.log('📋 Resposta coerente salva no Google Sheets');
                    }).catch(error => {
                        console.error('❌ Erro ao salvar resposta coerente:', error.message);
                    });
        } catch (error) {
            console.error('❌ Erro ao registrar resposta coerente no Google Sheets:', error.message);
        }
    }
    
    console.log('📝 Resposta coerente adicionada ao aprendizado do script:', tipoSituacao);
    console.log('👤 Usuário que marcou como coerente:', userData ? `${userData.nome} (${userData.email})` : 'N/A');
}

// Identificar padrões automaticamente
async function identificarPadroesAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada) {
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
    
    saveFeedbacksRespostas(feedbacksCopy);
    
    // Também adicionar ao aprendizado direto do script
    await addFeedbackAprendizado(dadosFormulario.tipo_solicitacao, feedback, respostaReformulada, respostaAnterior, userData);
    
    console.log('📝 Feedback de resposta adicionado (aba Respostas RA):', novoFeedback.id);
    return novoFeedback;
}

// Adicionar feedback de moderação (APENAS para aba Moderação RA)
async function addModeracaoFeedback(textoNegado, motivoNegativa, textoReformulado) {
    const feedbacks = loadFeedbacksModeracoes();
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: obterTimestampBrasil(),
        tipo: 'moderacao',
        textoNegado: textoNegado,
        motivoNegativa: motivoNegativa,
        textoReformulado: textoReformulado
    };
    
    feedbacks.moderacoes.push(novoFeedback);
    await saveFeedbacksModeracoes(feedbacks);
    
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
        // Usar APENAS feedbacks de moderações (aba Moderação RA)
        const feedbacks = loadFeedbacksModeracoes();
        feedbacks.moderacoes.forEach(feedback => {
            if (feedback.motivoNegativa && contexto.motivoNegativa) {
                const motivoFeedback = feedback.motivoNegativa.toLowerCase();
                const motivoContexto = contexto.motivoNegativa.toLowerCase();
                
                if (motivoFeedback.includes(motivoContexto) || 
                    motivoContexto.includes(motivoFeedback) ||
                    motivoFeedback.includes('resposta não condizente') ||
                    motivoFeedback.includes('tom inadequado')) {
                relevantes.push(feedback);
                }
            }
        });
    }
    
    // Ordenar por timestamp mais recente e retornar os últimos 5
    return relevantes
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5);
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
                GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '108948157850402889475',
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
        
        // Registrar no Google Sheets se ativo
        if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
            try {
                await googleSheetsQueue.addToQueue('registrarRespostaCoerente', acessoData, true); // true = instantâneo
                console.log('✅ Acesso registrado INSTANTANEAMENTE no Google Sheets');
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
            res.status(400).json({
                success: false,
                error: 'Erro na conexão com OpenAI',
                message: 'Verifique sua chave da API'
            });
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
        
        const { dadosModeracao } = req.body;
        
        if (!dadosModeracao) {
            return res.status(400).json({
                success: false,
                error: 'Dados de moderação não fornecidos'
            });
        }
        
        // Obter feedbacks relevantes para melhorar a geração de moderação
        const feedbacksRelevantes = getRelevantFeedbacks('moderacao', {
            motivoNegativa: dadosModeracao.motivoModeracao
        });
        
        // Obter modelos de moderação aprovados
        const modelosRelevantes = getModelosModeracaoRelevantes(dadosModeracao.motivoModeracao);
        
        let conhecimentoFeedback = '';
        
        // PRIORIDADE 1: MODELOS APROVADOS (seguir este padrão)
        if (modelosRelevantes.length > 0) {
            conhecimentoFeedback = '\n\n✅ MODELOS DE MODERAÇÃO APROVADOS (SEGUIR ESTE PADRÃO):\n';
            conhecimentoFeedback += `Baseado em ${modelosRelevantes.length} moderações aprovadas para "${dadosModeracao.motivoModeracao}":\n\n`;
            
            modelosRelevantes.forEach((modelo, index) => {
                conhecimentoFeedback += `${index + 1}. 📅 Data: ${modelo.timestamp}\n`;
                conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivoModeracao}\n`;
                conhecimentoFeedback += `   📝 Linha de raciocínio: "${modelo.linhaRaciocinio.substring(0, 200)}..."\n`;
                conhecimentoFeedback += `   ✅ Texto aprovado: "${modelo.textoModeracao.substring(0, 200)}..."\n\n`;
            });
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use estes modelos aprovados como referência para gerar uma moderação de alta qualidade, seguindo a mesma estrutura e abordagem.\n';
        }
        
        // PRIORIDADE 2: FEEDBACKS DE ERROS (evitar estes problemas)
        if (feedbacksRelevantes.length > 0) {
            if (conhecimentoFeedback) {
                conhecimentoFeedback += '\n\n⚠️ ERROS IDENTIFICADOS (EVITAR):\n';
            } else {
                conhecimentoFeedback = '\n\n🧠 CONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES DE MODERAÇÃO:\n';
            }
            
            conhecimentoFeedback += `Baseado em ${feedbacksRelevantes.length} moderações negadas anteriormente, evite os seguintes erros:\n\n`;
            
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. ❌ ERRO IDENTIFICADO: "${fb.motivoNegativa}"\n`;
                conhecimentoFeedback += `   📝 Texto original negado: "${fb.textoNegado.substring(0, 200)}..."\n`;
                conhecimentoFeedback += `   ✅ Texto reformulado aprovado: "${fb.textoReformulado.substring(0, 200)}..."\n\n`;
            });
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este conhecimento para evitar erros similares e aplicar as correções identificadas.\n';
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
- Há informações falsas ou divergentes da realidade no conteúdo?
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
- Divergência/violação identificada: aponte especificamente onde o conteúdo (solicitação, resposta ou consideração) foge da realidade, está desatualizado ou infringe regras do RA
- Base normativa: indique explicitamente:
  * Qual manual do RA dá respaldo (citar manual + seção, se aplicável)
  * Qual cláusula contratual ou termo aceito pelo cliente fundamenta o pedido
  * Qual regra específica foi violada pelo conteúdo analisado

5. CONSTRUÇÃO DA RESPOSTA FINAL DE MODERAÇÃO:
Esse é o texto que vai ser enviado ao RA. Deve ser:
- Baseado na análise real do conteúdo (solicitação, resposta, consideração)
- Objetivo e técnico
- Impessoal (sem "eu", "nós sentimos", etc.)
- Sem tom emocional
- Estruturado em 3 parágrafos curtos
- Focado nas violações específicas identificadas no conteúdo analisado

MODELO FIXO OBRIGATÓRIO - USE EXATAMENTE ESTA ESTRUTURA:

TEXTO FINAL DE MODERAÇÃO (a ser enviado ao RA):
"Prezados,

Solicitamos a moderação da reclamação em questão, tendo em vista que [explique o motivo objetivo baseado na análise do conteúdo real - solicitação, resposta e consideração final do consumidor].

Conforme registros internos e documentação de suporte, [descrever de forma resumida os fatos corretos que divergem do que foi apresentado pelo cliente]. Ressaltamos que [especificar qual parte do conteúdo - solicitação, resposta ou consideração - diverge da realidade], enquadrando-se nas hipóteses de moderação previstas no [manual aplicável específico].

Dessa forma, solicitamos a adequação ou exclusão da publicação, conforme regras vigentes da plataforma."

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
                console.log('✅ Moderação gerada com aprendizado aplicado - mantendo resposta da IA');
            } else {
                console.log('⚠️ Moderação genérica detectada - usando resposta da IA mesmo assim');
                console.log('📝 A IA deve seguir o script estruturado definido no prompt');
            }
            
            // Incrementar estatística global
            incrementarEstatisticaGlobal('moderacoes_geradas');
            
            res.json({
                success: true,
                result: resposta
            });
        } else {
            const errorData = await response.text();
            res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
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
            observacoes_internas: dadosFormulario.observacoes_internas?.substring(0, 50) + '...'
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
                        conhecimentoFeedback += `📋 MODELO ${index + 1} (${modelo.tipo_situacao || modelo.dadosFormulario?.tipo_solicitacao}):\n`;
                        conhecimentoFeedback += `   📅 Data: ${modelo.timestamp}\n`;
                        conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao}\n`;
                        conhecimentoFeedback += `   🔧 Solução: ${modelo.solucao_implementada || modelo.dadosFormulario?.solucao_implementada}\n`;
                        conhecimentoFeedback += `   📝 Resposta aprovada: "${modelo.respostaAprovada.substring(0, 400)}..."\n\n`;
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
                        conhecimentoFeedback += `   📝 Resposta original: "${fb.respostaAnterior.substring(0, 150)}..."\n`;
                        conhecimentoFeedback += `   ✅ Resposta corrigida: "${fb.respostaReformulada.substring(0, 150)}..."\n\n`;
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
        
        // Verificar se o conhecimento foi construído
        if (conhecimentoFeedback && conhecimentoFeedback.length > 100) {
            console.log('✅ CONHECIMENTO DA PLANILHA INCLUÍDO NO PROMPT');
            console.log('📊 Estatísticas do conhecimento:');
            console.log(`   - Tamanho: ${conhecimentoFeedback.length} caracteres`);
            console.log(`   - Contém modelos: ${conhecimentoFeedback.includes('MODELOS COERENTES')}`);
            console.log(`   - Contém feedbacks: ${conhecimentoFeedback.includes('FEEDBACKS DA PLANILHA')}`);
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
- Use tom profissional e empático

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
            incrementarEstatisticaGlobal('respostas_geradas');
            
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
            res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
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
            observacoes_internas: dadosFormulario.observacoes_internas?.substring(0, 50) + '...'
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
                        conhecimentoFeedback += `📋 MODELO ${index + 1} (${modelo.tipo_situacao || modelo.dadosFormulario?.tipo_solicitacao}):\n`;
                        conhecimentoFeedback += `   📅 Data: ${modelo.timestamp}\n`;
                        conhecimentoFeedback += `   🎯 Motivo: ${modelo.motivo_solicitacao || modelo.dadosFormulario?.motivo_solicitacao}\n`;
                        conhecimentoFeedback += `   🔧 Solução: ${modelo.solucao_implementada || modelo.dadosFormulario?.solucao_implementada}\n`;
                        conhecimentoFeedback += `   📝 Resposta aprovada: "${modelo.respostaAprovada.substring(0, 400)}..."\n\n`;
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
                        conhecimentoFeedback += `   📝 Resposta original: "${fb.respostaAnterior.substring(0, 150)}..."\n`;
                        conhecimentoFeedback += `   ✅ Resposta corrigida: "${fb.respostaReformulada.substring(0, 150)}..."\n\n`;
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
        
        // Verificar se o conhecimento foi construído
        if (conhecimentoFeedback && conhecimentoFeedback.length > 100) {
            console.log('✅ CONHECIMENTO DA PLANILHA INCLUÍDO NO PROMPT');
            console.log('📊 Estatísticas do conhecimento:');
            console.log(`   - Tamanho: ${conhecimentoFeedback.length} caracteres`);
            console.log(`   - Contém modelos: ${conhecimentoFeedback.includes('MODELOS COERENTES')}`);
            console.log(`   - Contém feedbacks: ${conhecimentoFeedback.includes('FEEDBACKS DA PLANILHA')}`);
        } else {
            console.log('⚠️ NENHUM CONHECIMENTO DA PLANILHA DISPONÍVEL');
            console.log('📝 Tamanho do conhecimento:', conhecimentoFeedback?.length || 0);
        }

        // USAR O NOVO FLUXO: Script Padrão → Consultar Planilha → Reformular
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
                        content: 'Você é um assistente especializado em atendimento ao cliente para a empresa Velotax. Sua função é analisar TODOS os campos fornecidos (reclamação do cliente, solução implementada, histórico de atendimento, observações internas) e formular uma resposta personalizada que responda diretamente à solicitação do cliente, explicando como a solução implementada resolve o problema. Use as cláusulas da CCB quando aplicável para fundamentar a resposta.'
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
                const observacoes = dadosFormulario.observacoes_internas;
                
                // Criar resposta mais específica e completa baseada nos dados fornecidos
                let respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                
                // Adicionar contexto específico baseado no tipo de situação
                if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('exclusao')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de exclusão de cadastro${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de exclusão e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                } else if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de portabilidade e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

A operação foi realizada conforme estabelecido na Cláusula 7 de sua Cédula de Crédito Bancário (CCB), que trata do vínculo da chave Pix e quitação automática.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ' - ' + motivo : ''}.

${solucao ? 'Confirmamos que ' + solucao + '.' : 'Analisamos sua solicitação de quitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? 'Considerando o histórico de atendimento: ' + historico + '. ' : ''}${observacoes && observacoes !== 'Nenhuma' ? 'Observamos que: ' + observacoes + '. ' : ''}

A operação foi realizada conforme estabelecido na Cláusula 8 de sua Cédula de Crédito Bancário (CCB), que trata da liquidação antecipada.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                }
                
                resposta = respostaEspecifica;
            }
            
            // Incrementar estatística global
            incrementarEstatisticaGlobal('respostas_geradas');
            
            res.json({
                success: true,
                result: resposta
            });
        } else {
            const errorData = await response.text();
            res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
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
        
        const { motivoNegativa, textoNegado } = req.body;
        
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
            addModeracaoFeedback(textoNegado, motivoNegativa, textoReformulado);
            
            res.json({
                success: true,
                result: textoReformulado
            });
        } else {
            const errorData = await response.text();
            res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
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
                    conhecimentoFeedback += `   RESPOSTA APROVADA: "${resp.respostaAprovada.substring(0, 250)}..."\n\n`;
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
- Mantenha o tom profissional e empático
- Aborde todos os aspectos da reclamação do cliente`;
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
- Profissional, respeitoso e empático
- Linguagem clara e acessível
- Tom conciliador e solucionador
- Evite jargões técnicos desnecessários

2. ESTRUTURA DA RESPOSTA:
a) Agradecimento e reconhecimento
b) Esclarecimento da situação
c) Solução apresentada/implementada
d) Compromisso de melhoria
e) Convite para contato direto

3. DIRETRIZES:
- Sempre reconheça o problema do cliente
- Explique as ações tomadas de forma clara
- Demonstre compromisso com a satisfação
- Mantenha tom profissional e respeitoso
- Evite repetições desnecessárias
- Seja específico e detalhado

Gere uma resposta reformulada que seja mais completa, eficaz e atenda aos pontos levantados no feedback.`;

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
            const respostaReformulada = data.choices[0].message.content;
            
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
            res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
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
                        modelo.motivo_solicitacao,
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
        saveFeedbacksRespostas(feedbacksVazios);
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
        incrementarEstatisticaGlobal('respostas_coerentes');
        
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
                
                // Adicionar modelo de resposta INSTANTANEAMENTE ao Google Sheets
                if (googleSheetsIntegration && googleSheetsIntegration.isActive()) {
                    try {
                        await googleSheetsQueue.addToQueue('registrarRespostaCoerente', modelo, true); // true = instantâneo
                        syncResult = { googleSheets: 'Registrado instantaneamente' };
                        console.log('✅ Modelo registrado INSTANTANEAMENTE no Google Sheets');
                    } catch (error) {
                        console.error('❌ Erro ao registrar modelo instantaneamente:', error.message);
                        syncResult = { googleSheets: 'Erro no registro instantâneo' };
                    }
                } else {
                    console.log('⚠️ Google Sheets não está disponível ou não está ativo');
                }
                
                // Tentar sincronizar com arquivos locais também (backup)
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
            console.error('❌ Erro na API OpenAI:', errorData);
            return res.status(400).json({
                success: false,
                error: 'Erro na API OpenAI',
                details: errorData
            });
        }

        const data = await response.json();
        const resultado = data.choices[0].message.content;
        console.log('✅ Revisão de texto gerada com sucesso');

        // Incrementar estatística global
        incrementarEstatisticaGlobal('revisoes_texto');

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

// Endpoint para buscar estatísticas globais
// ===== ENDPOINTS DE AUTENTICAÇÃO =====

// Endpoint para obter configurações do Google OAuth
app.get('/api/google-config', (req, res) => {
    console.log('🎯 Endpoint /api/google-config chamado');
    try {
        // Carregar configurações do arquivo .env
        const envVars = loadEnvFile();
        const clientId = envVars.GOOGLE_CLIENT_ID || '108948157850402889475';
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
        
        // Registrar acesso no Google Sheets
        if (global.googleSheetsInitialized) {
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
                
                googleSheetsIntegration.registrarAcessoInterface(acessoData).then(() => {
                        console.log('📋 Acesso salvo no Google Sheets');
                    }).catch(error => {
                        console.error('❌ Erro ao salvar acesso:', error.message);
                    });
                    console.log('📋 Acesso adicionado à fila do Google Sheets');
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

// Endpoint para salvar moderação como modelo (quando clicar em "Coerente")
app.post('/api/save-modelo-moderacao', (req, res) => {
    console.log('🎯 Endpoint /api/save-modelo-moderacao chamado');
    try {
        const { dadosModeracao, linhaRaciocinio, textoModeracao } = req.body;
        
        if (!dadosModeracao || !linhaRaciocinio || !textoModeracao) {
            return res.status(400).json({
                success: false,
                error: 'Dados de moderação, linha de raciocínio e texto de moderação são obrigatórios'
            });
        }
        
        // Salvar como modelo de moderação aprovada
        const modelo = addModeloModeracao(dadosModeracao, linhaRaciocinio, textoModeracao);
        
        // Incrementar estatística global
        incrementarEstatisticaGlobal('moderacoes_coerentes');
        
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

// Endpoint para gerar explicações baseadas em feedbacks (sem API OpenAI)
app.post('/api/generate-explanation', (req, res) => {
    try {
        const { tema } = req.body;
        
        if (!tema) {
            return res.status(400).json({
                success: false,
                error: 'Tema não fornecido'
            });
        }
        
        // Obter feedbacks relevantes para o tema (APENAS feedbacks de respostas)
        const feedbacks = loadFeedbacksRespostas();
        const explicacao = gerarExplicacaoBaseadaEmFeedbacks(tema, feedbacks);
        
        // Incrementar estatística global
        incrementarEstatisticaGlobal('explicacoes_geradas');

        res.json({
            success: true,
            result: explicacao,
            baseadaEmFeedbacks: true,
            totalFeedbacks: feedbacks.respostas.length + feedbacks.moderacoes.length
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

// Middleware para rotas não encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        message: 'A rota solicitada não existe'
    });
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
        googleSheetsIntegration.registrarFeedback(testData).then(result => {
            console.log('📝 Resultado do feedback:', result);
        }).catch(error => {
            console.error('❌ Erro no feedback:', error.message);
        });
        
        // Tentar registrar resposta coerente
        googleSheetsQueue.addToQueue('registrarRespostaCoerente', testData).then(result => {
            console.log('📝 Resultado da resposta:', result);
        }).catch(error => {
            console.error('❌ Erro na resposta:', error.message);
        });
        
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
        
        res.json({
            success: true,
            message: 'Teste simples concluído',
            envStatus: envStatus,
            integrationStatus: integrationStatus,
            globalStatus: {
                googleSheetsInitialized: global.googleSheetsInitialized || false
            },
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
        googleSheetsQueue.addToQueue('registrarRespostaCoerente', testData).then(result => {
            console.log('📝 Resultado da resposta:', result);
        }).catch(error => {
            console.error('❌ Erro na resposta:', error.message);
        });
        
        res.json({
            success: true,
            message: 'Teste de registro concluído',
            result: respostaResult,
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

module.exports = app;

