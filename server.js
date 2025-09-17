// ===== SERVIDOR BACKEND SEGURO - VELOTAX BOT =====

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== SISTEMA DE APRENDIZADO BASEADO EM FEEDBACK SEPARADO POR ABA =====

// Arquivos separados para cada tipo de feedback
const FEEDBACKS_RESPOSTAS_FILE = path.join(__dirname, 'data', 'feedbacks_respostas.json');
const FEEDBACKS_MODERACOES_FILE = path.join(__dirname, 'data', 'feedbacks_moderacoes.json');
const FEEDBACKS_EXPLICACOES_FILE = path.join(__dirname, 'data', 'feedbacks_explicacoes.json');

// Arquivo para modelos de respostas aprovadas
const MODELOS_RESPOSTAS_FILE = path.join(__dirname, 'data', 'modelos_respostas.json');

// Arquivo para aprendizado direto no script de formulação
const APRENDIZADO_SCRIPT_FILE = path.join(__dirname, 'data', 'aprendizado_script.json');

// Garantir que o diretório data existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ===== FUNÇÕES PARA FEEDBACKS DE RESPOSTAS RA =====

// Carregar feedbacks de respostas
function loadFeedbacksRespostas() {
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
        lastUpdated: new Date().toISOString()
    };
}

// Salvar feedbacks de respostas
function saveFeedbacksRespostas(feedbacks) {
    try {
        feedbacks.lastUpdated = new Date().toISOString();
        fs.writeFileSync(FEEDBACKS_RESPOSTAS_FILE, JSON.stringify(feedbacks, null, 2));
        console.log('✅ Feedbacks de respostas salvos com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de respostas:', error);
    }
}

// ===== FUNÇÕES PARA FEEDBACKS DE MODERAÇÕES RA =====

// Carregar feedbacks de moderações
function loadFeedbacksModeracoes() {
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
        lastUpdated: new Date().toISOString()
    };
}

// Salvar feedbacks de moderações
function saveFeedbacksModeracoes(feedbacks) {
    try {
        feedbacks.lastUpdated = new Date().toISOString();
        fs.writeFileSync(FEEDBACKS_MODERACOES_FILE, JSON.stringify(feedbacks, null, 2));
        console.log('✅ Feedbacks de moderações salvos com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de moderações:', error);
    }
}

// ===== FUNÇÕES PARA FEEDBACKS DE EXPLICAÇÕES =====

// Carregar feedbacks de explicações
function loadFeedbacksExplicacoes() {
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
        lastUpdated: new Date().toISOString()
    };
}

// Salvar feedbacks de explicações
function saveFeedbacksExplicacoes(feedbacks) {
    try {
        feedbacks.lastUpdated = new Date().toISOString();
        fs.writeFileSync(FEEDBACKS_EXPLICACOES_FILE, JSON.stringify(feedbacks, null, 2));
        console.log('✅ Feedbacks de explicações salvos com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar feedbacks de explicações:', error);
    }
}

// ===== FUNÇÕES PARA MODELOS DE RESPOSTAS APROVADAS =====

// Carregar modelos de respostas
function loadModelosRespostas() {
    try {
        if (fs.existsSync(MODELOS_RESPOSTAS_FILE)) {
            const data = fs.readFileSync(MODELOS_RESPOSTAS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar modelos de respostas:', error);
    }
    return {
        modelos: [],
        lastUpdated: new Date().toISOString()
    };
}

// Salvar modelos de respostas
function saveModelosRespostas(modelos) {
    try {
        modelos.lastUpdated = new Date().toISOString();
        fs.writeFileSync(MODELOS_RESPOSTAS_FILE, JSON.stringify(modelos, null, 2));
        console.log('✅ Modelos de respostas salvos com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar modelos de respostas:', error);
    }
}

// Adicionar modelo de resposta aprovada
function addModeloResposta(dadosFormulario, respostaAprovada) {
    const modelos = loadModelosRespostas();
    
    const novoModelo = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        tipo_situacao: dadosFormulario.tipo_solicitacao,
        motivo_solicitacao: dadosFormulario.motivo_solicitacao,
        dadosFormulario: dadosFormulario,
        respostaAprovada: respostaAprovada,
        contexto: {
            tipoSituacao: dadosFormulario.tipo_solicitacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao
        }
    };
    
    modelos.modelos.push(novoModelo);
    saveModelosRespostas(modelos);
    
    // Também adicionar ao aprendizado direto do script
    addRespostaCoerenteAprendizado(dadosFormulario.tipo_solicitacao, dadosFormulario.motivo_solicitacao, respostaAprovada, dadosFormulario);
    
    console.log('📝 Modelo de resposta aprovada adicionado:', novoModelo.id);
    return novoModelo;
}

// Obter modelos relevantes para um tipo de situação
function getModelosRelevantes(tipoSituacao, motivoSolicitacao) {
    const modelos = loadModelosRespostas();
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

// ===== FUNÇÕES PARA APRENDIZADO DIRETO NO SCRIPT DE FORMULAÇÃO =====

// Carregar aprendizado do script
function loadAprendizadoScript() {
    try {
        if (fs.existsSync(APRENDIZADO_SCRIPT_FILE)) {
            const data = fs.readFileSync(APRENDIZADO_SCRIPT_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar aprendizado do script:', error);
    }
    return {
        tiposSituacao: {},
        lastUpdated: new Date().toISOString()
    };
}

// Salvar aprendizado do script
function saveAprendizadoScript(aprendizado) {
    try {
        aprendizado.lastUpdated = new Date().toISOString();
        fs.writeFileSync(APRENDIZADO_SCRIPT_FILE, JSON.stringify(aprendizado, null, 2));
        console.log('✅ Aprendizado do script salvo com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar aprendizado do script:', error);
    }
}

// Adicionar feedback ao aprendizado do script
function addFeedbackAprendizado(tipoSituacao, feedback, respostaReformulada) {
    const aprendizado = loadAprendizadoScript();
    
    if (!aprendizado.tiposSituacao[tipoSituacao]) {
        aprendizado.tiposSituacao[tipoSituacao] = {
            feedbacks: [],
            respostasCoerentes: [],
            padroesIdentificados: [],
            clausulasUsadas: []
        };
    }
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        feedback: feedback,
        respostaReformulada: respostaReformulada
    };
    
    aprendizado.tiposSituacao[tipoSituacao].feedbacks.push(novoFeedback);
    
    // Manter apenas os últimos 10 feedbacks por tipo
    if (aprendizado.tiposSituacao[tipoSituacao].feedbacks.length > 10) {
        aprendizado.tiposSituacao[tipoSituacao].feedbacks = 
            aprendizado.tiposSituacao[tipoSituacao].feedbacks.slice(-10);
    }
    
    // Identificar padrões automaticamente baseado no feedback
    console.log('🔍 Identificando padrões para:', tipoSituacao);
    identificarPadroesAprendizado(tipoSituacao, '', respostaReformulada);
    
    saveAprendizadoScript(aprendizado);
    console.log('📝 Feedback adicionado ao aprendizado do script:', tipoSituacao);
}

// Adicionar resposta coerente ao aprendizado do script
function addRespostaCoerenteAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada, dadosFormulario) {
    const aprendizado = loadAprendizadoScript();
    
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
        timestamp: new Date().toISOString(),
        motivoSolicitacao: motivoSolicitacao,
        respostaAprovada: respostaAprovada,
        dadosFormulario: dadosFormulario
    };
    
    aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.push(novaResposta);
    
    // Manter apenas as últimas 5 respostas coerentes por tipo
    if (aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.length > 5) {
        aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes = 
            aprendizado.tiposSituacao[tipoSituacao].respostasCoerentes.slice(-5);
    }
    
    // Identificar padrões automaticamente
    identificarPadroesAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada);
    
    saveAprendizadoScript(aprendizado);
    console.log('📝 Resposta coerente adicionada ao aprendizado do script:', tipoSituacao);
}

// Identificar padrões automaticamente
function identificarPadroesAprendizado(tipoSituacao, motivoSolicitacao, respostaAprovada) {
    console.log('🔍 Identificando padrões para:', tipoSituacao);
    const aprendizado = loadAprendizadoScript();
    
    if (!aprendizado.tiposSituacao[tipoSituacao]) {
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
function processarPadroesExistentes(tipoSituacao) {
    console.log('🔄 Processando padrões existentes para:', tipoSituacao);
    const aprendizado = loadAprendizadoScript();
    
    if (!aprendizado.tiposSituacao[tipoSituacao]) {
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
    
    saveAprendizadoScript(aprendizado);
    console.log('✅ Padrões processados:', padroesUnicos.length, 'padrões,', clausulasUnicas.length, 'cláusulas');
    console.log('📋 Padrões identificados:', padroesUnicos);
}

// Obter aprendizado para um tipo de situação
function getAprendizadoTipoSituacao(tipoSituacao) {
    const aprendizado = loadAprendizadoScript();
    return aprendizado.tiposSituacao[tipoSituacao] || {
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
        lastUpdated: new Date().toISOString()
    };
}

// Adicionar feedback de resposta (APENAS para aba Respostas RA)
function addRespostaFeedback(dadosFormulario, respostaAnterior, feedback, respostaReformulada) {
    const feedbacks = loadFeedbacksRespostas();
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        tipo: 'resposta',
        dadosFormulario: dadosFormulario,
        respostaAnterior: respostaAnterior,
        feedback: feedback,
        respostaReformulada: respostaReformulada,
        contexto: {
            tipoSituacao: dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao
        }
    };
    
    feedbacks.respostas.push(novoFeedback);
    saveFeedbacksRespostas(feedbacks);
    
    // Também adicionar ao aprendizado direto do script
    addFeedbackAprendizado(dadosFormulario.tipo_solicitacao, feedback, respostaReformulada);
    
    console.log('📝 Feedback de resposta adicionado (aba Respostas RA):', novoFeedback.id);
    return novoFeedback;
}

// Adicionar feedback de moderação (APENAS para aba Moderação RA)
function addModeracaoFeedback(textoNegado, motivoNegativa, textoReformulado) {
    const feedbacks = loadFeedbacksModeracoes();
    
    const novoFeedback = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        tipo: 'moderacao',
        textoNegado: textoNegado,
        motivoNegativa: motivoNegativa,
        textoReformulado: textoReformulado
    };
    
    feedbacks.moderacoes.push(novoFeedback);
    saveFeedbacksModeracoes(feedbacks);
    
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
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'file://'],
    credentials: true
}));

app.use(express.json());
app.use(express.static('.'));

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
                LOG_LEVEL: process.env.LOG_LEVEL || 'info'
            };
            
            console.log(`✅ ${Object.keys(envVars).filter(k => envVars[k]).length} variáveis carregadas do process.env`);
            return envVars;
        }
        
        // Para desenvolvimento local, tentar carregar do arquivo .env
        const envPath = path.join(__dirname, '.env');
        
        if (!fs.existsSync(envPath)) {
            console.warn('⚠️ Arquivo .env não encontrado na raiz do projeto');
            return {};
        }
        
        const envContent = fs.readFileSync(envPath, 'utf8');
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
        
        console.log(`✅ ${Object.keys(envVars).length} variáveis carregadas do .env`);
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

// Rota para verificar status do servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        environment: 'production'
    });
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
            LOG_LEVEL: envVars.LOG_LEVEL || 'info'
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
        
        let conhecimentoFeedback = '';
        if (feedbacksRelevantes.length > 0) {
            conhecimentoFeedback = '\n\nCONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES DE MODERAÇÃO:\n';
            conhecimentoFeedback += 'Com base em moderações negadas anteriormente, evite os seguintes erros:\n\n';
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. Motivo da negativa: "${fb.motivoNegativa}"\n`;
                conhecimentoFeedback += `   Texto reformulado: "${fb.textoReformulado.substring(0, 150)}..."\n\n`;
            });
            conhecimentoFeedback += 'Use este conhecimento para gerar um texto de moderação de alta qualidade desde o início, evitando negativas do RA.\n';
        }
        
        const prompt = `
DADOS PARA MODERAÇÃO:
- Solicitação do Cliente: ${dadosModeracao.solicitacaoCliente}
- Resposta da Empresa: ${dadosModeracao.respostaEmpresa}
- Motivo da Moderação: ${dadosModeracao.motivoModeracao}
- Consideração Final do Consumidor: ${dadosModeracao.consideracaoFinal}

INSTRUÇÕES ESPECIALIZADAS:
Você é um especialista em Reclame Aqui, com foco em formulação de textos de moderação. Seu papel é redigir solicitações técnicas e objetivas, em nome da empresa Velotax, com base nos manuais oficiais de moderação do Reclame Aqui.

IMPORTANTE: Seu texto deve ser endereçado ao time de moderação do RA, nunca ao consumidor.

DIRETRIZES OBRIGATÓRIAS:

1. TOM E ESTILO:
- Técnico, impessoal, formal e objetivo
- Sem linguagem comercial, promocional ou emocional
- Clareza > quantidade. Não usar floreios, apenas fatos e base normativa
- Evite repetições desnecessárias

2. ESTRUTURA PADRÃO:
a) Introdução curta e técnica:
SEMPRE iniciar com: "Conforme o apontamento acima, solicitamos a moderação desta publicação…"

b) Exposição dos fatos:
- Contextualize em ordem cronológica e objetiva
- Explique o ponto de divergência ou motivo que torna a publicação indevida
- Use registros internos (datas, atendimentos, exclusões, quitações, etc.)

c) Fundamentação normativa:
- Relacione o motivo com os manuais oficiais do RA
- Cite especificamente: Manual Geral, Manual de Reviews ou Manual de Bancos/Instituições Financeiras/Meios

d) Encerramento formal:
SEMPRE finalizar com: "Diante do exposto, solicitamos a exclusão/moderação do conteúdo, em conformidade com as diretrizes da plataforma."

3. MOTIVOS DE MODERAÇÃO ACEITOS:
- Informação falsa ou incorreta (Manual Geral)
- Caso já resolvido antes da abertura no RA (Manual Geral)
- Ofensa a empresa ou colaboradores (Manual Bancos/Meios)
- Divulgação de dados pessoais/sensíveis (Manual Geral)
- Reclamação duplicada (Manual de Reviews)
- Reclamação de outra empresa (Manual de Reviews)
- Reclamação trabalhista (Manual de Reviews)
- Caso de fraude (Manual Bancos/Meios)
- A empresa não violou o direito do consumidor (Manual Bancos/Meios)

${conhecimentoFeedback}

IMPORTANTE: Use o conhecimento dos feedbacks anteriores para gerar um texto de moderação de alta qualidade desde o início, evitando negativas do RA.

Gere uma solicitação de moderação seguindo EXATAMENTE esta estrutura e tom técnico.`;

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
                console.log('⚠️ Moderação genérica detectada - NUNCA usar resposta genérica para RA/Moderações');
                console.log('📝 Formulando moderação específica baseada nos dados fornecidos pelo usuário...');
                
                // Criar moderação específica baseada nos dados fornecidos
                const solicitacao = dadosModeracao.solicitacaoCliente;
                const respostaEmpresa = dadosModeracao.respostaEmpresa;
                const motivo = dadosModeracao.motivoModeracao;
                const consideracao = dadosModeracao.consideracaoFinal;
                
                let moderacaoEspecifica = `Prezados Senhores,

Solicitamos a moderação do conteúdo em questão pelos seguintes motivos:

**DADOS DO CASO:**
- Solicitação do Cliente: ${solicitacao}
- Resposta da Empresa: ${respostaEmpresa}
- Motivo da Moderação: ${motivo}
- Consideração Final do Consumidor: ${consideracao}

**FUNDAMENTAÇÃO:**
${motivo ? `O conteúdo viola as diretrizes do Reclame Aqui conforme ${motivo}.` : 'O conteúdo não está em conformidade com as diretrizes da plataforma.'}

**SOLICITAÇÃO:**
Diante do exposto, solicitamos a moderação do conteúdo, em conformidade com as diretrizes da plataforma.

Atenciosamente,
Equipe Velotax`;
                
                resposta = moderacaoEspecifica;
            }
            
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

// Rota para gerar resposta RA via API OpenAI
app.post('/api/generate-response', rateLimitMiddleware, async (req, res) => {
    try {
        const envVars = loadEnvFile();
        const apiKey = envVars.OPENAI_API_KEY;
        
        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                success: false,
                error: 'Chave da API não configurada ou inválida'
            });
        }
        
        const { dadosFormulario } = req.body;
        
        if (!dadosFormulario) {
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
        
        // Obter aprendizado direto do script para este tipo de situação (PRIORITÁRIO)
        const aprendizadoScript = getAprendizadoTipoSituacao(dadosFormulario.tipo_solicitacao);
        
        // Obter feedbacks relevantes para melhorar a geração de resposta (COMPLEMENTAR)
        const feedbacksRelevantes = getRelevantFeedbacks('resposta', {
            tipoSituacao: dadosFormulario.tipo_solicitacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao
        });
        
        // Obter modelos de respostas aprovadas para o mesmo tipo de situação
        const modelosRelevantes = getModelosRelevantes(dadosFormulario.tipo_solicitacao, dadosFormulario.motivo_solicitacao);
        
        console.log(`🔍 Buscando aprendizado para: ${dadosFormulario.tipo_solicitacao} - ${dadosFormulario.motivo_solicitacao}`);
        console.log(`🧠 APRENDIZADO DO SCRIPT: ${aprendizadoScript.feedbacks.length} feedbacks, ${aprendizadoScript.respostasCoerentes.length} respostas coerentes`);
        console.log(`📚 Feedbacks complementares: ${feedbacksRelevantes.length}`);
        console.log(`🎯 Modelos encontrados: ${modelosRelevantes.length}`);
        
        let conhecimentoFeedback = '';
        
        // Identificar padrões automaticamente se ainda não foram identificados
        console.log('🔍 Verificando se precisa identificar padrões:', {
            tipo: dadosFormulario.tipo_solicitacao,
            feedbacks: aprendizadoScript.feedbacks.length,
            padroes: aprendizadoScript.padroesIdentificados.length
        });
        
        if (aprendizadoScript.feedbacks.length > 0 && aprendizadoScript.padroesIdentificados.length === 0) {
            console.log('🔍 Identificando padrões automaticamente para:', dadosFormulario.tipo_solicitacao);
            processarPadroesExistentes(dadosFormulario.tipo_solicitacao);
            // Recarregar aprendizado após identificar padrões
            const aprendizadoAtualizado = getAprendizadoTipoSituacao(dadosFormulario.tipo_solicitacao);
            aprendizadoScript.padroesIdentificados = aprendizadoAtualizado.padroesIdentificados;
            aprendizadoScript.clausulasUsadas = aprendizadoAtualizado.clausulasUsadas;
            console.log('✅ Padrões atualizados:', aprendizadoScript.padroesIdentificados.length);
        }
        
        // PRIORIDADE 1: APRENDIZADO DIRETO DO SCRIPT (mais recente e específico)
        if (aprendizadoScript.feedbacks.length > 0 || aprendizadoScript.respostasCoerentes.length > 0 || aprendizadoScript.padroesIdentificados.length > 0) {
            conhecimentoFeedback = '\n\n🎓 APRENDIZADO DIRETO DO SCRIPT DE FORMULAÇÃO (PRIORITÁRIO):\n';
            conhecimentoFeedback += `Baseado em ${aprendizadoScript.feedbacks.length} feedbacks e ${aprendizadoScript.respostasCoerentes.length} respostas coerentes para "${dadosFormulario.tipo_solicitacao}":\n\n`;
            console.log('🧠 Aplicando aprendizado do script:', {
                feedbacks: aprendizadoScript.feedbacks.length,
                respostasCoerentes: aprendizadoScript.respostasCoerentes.length,
                padroes: aprendizadoScript.padroesIdentificados.length
            });
            
            // Adicionar padrões identificados
            if (aprendizadoScript.padroesIdentificados.length > 0) {
                conhecimentoFeedback += '📋 PADRÕES IDENTIFICADOS (OBRIGATÓRIOS):\n';
                aprendizadoScript.padroesIdentificados.forEach((padrao, index) => {
                    conhecimentoFeedback += `${index + 1}. ${padrao}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // Adicionar cláusulas usadas
            if (aprendizadoScript.clausulasUsadas.length > 0) {
                conhecimentoFeedback += '⚖️ CLÁUSULAS CCB APLICÁVEIS:\n';
                aprendizadoScript.clausulasUsadas.forEach(clausula => {
                    conhecimentoFeedback += `• ${clausula}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // Adicionar feedbacks recentes (CRÍTICO - EVITAR ESTES ERROS)
            if (aprendizadoScript.feedbacks.length > 0) {
                conhecimentoFeedback += '⚠️ FEEDBACKS RECENTES (EVITAR ESTES ERROS):\n';
                aprendizadoScript.feedbacks.slice(-5).forEach((fb, index) => {
                    conhecimentoFeedback += `${index + 1}. ERRO: "${fb.feedback}"\n`;
                    conhecimentoFeedback += `   RESPOSTA CORRIGIDA: "${fb.respostaReformulada.substring(0, 200)}..."\n\n`;
                });
            }
            
            // Adicionar respostas coerentes recentes (SEGUIR ESTE PADRÃO)
            if (aprendizadoScript.respostasCoerentes.length > 0) {
                conhecimentoFeedback += '✅ RESPOSTAS COERENTES RECENTES (SEGUIR ESTE PADRÃO):\n';
                aprendizadoScript.respostasCoerentes.slice(-3).forEach((resp, index) => {
                    conhecimentoFeedback += `${index + 1}. Motivo: ${resp.motivoSolicitacao}\n`;
                    conhecimentoFeedback += `   RESPOSTA APROVADA: "${resp.respostaAprovada.substring(0, 250)}..."\n\n`;
                });
            }
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO CRÍTICA: Use este aprendizado direto do script para gerar uma resposta de alta qualidade desde o início, aplicando os padrões identificados e evitando os erros documentados.\n';
        }
        
        // PRIORIDADE 2: FEEDBACKS COMPLEMENTARES (se não houver aprendizado do script)
        else if (feedbacksRelevantes.length > 0) {
            conhecimentoFeedback = '\n\n🧠 CONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES:\n';
            conhecimentoFeedback += 'Com base em feedbacks anteriores de situações similares, siga estas diretrizes:\n\n';
            
            // Extrair padrões dos feedbacks e determinar cláusulas
            const padroes = new Set();
            const exemplos = [];
            const clausulasPorTipo = {};
            
            feedbacksRelevantes.forEach((fb, index) => {
                if (fb.feedback) {
                    padroes.add(fb.feedback);
                    
                    // Determinar cláusula baseada no tipo de situação
                    const tipoSituacao = fb.contexto.tipoSituacao || fb.dadosFormulario?.tipo_solicitacao || '';
                    let clausulaAplicavel = '';
                    
                    if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade') || tipoSituacao.toLowerCase().includes('chave')) {
                        clausulaAplicavel = 'Cláusula 7 - Vínculo da Chave Pix e Quitação Automática';
                    } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação') || tipoSituacao.toLowerCase().includes('encerramento')) {
                        clausulaAplicavel = 'Cláusula 8 - Liquidação Antecipada';
                    } else if (tipoSituacao.toLowerCase().includes('inadimplência') || tipoSituacao.toLowerCase().includes('vencimento')) {
                        clausulaAplicavel = 'Cláusula 10 - Inadimplência e Vencimento Antecipado';
                    } else if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('dados') || tipoSituacao.toLowerCase().includes('lgpd')) {
                        clausulaAplicavel = 'Cláusula 14 - Proteção de Dados (LGPD)';
                    }
                    
                    if (clausulaAplicavel) {
                        if (!clausulasPorTipo[tipoSituacao]) {
                            clausulasPorTipo[tipoSituacao] = new Set();
                        }
                        clausulasPorTipo[tipoSituacao].add(clausulaAplicavel);
                    }
                    
                    exemplos.push({
                        feedback: fb.feedback,
                        contexto: `${tipoSituacao} - ${fb.contexto.motivoSolicitacao || fb.dadosFormulario?.motivo_solicitacao || ''}`,
                        clausula: clausulaAplicavel,
                        resposta: fb.respostaReformulada.substring(0, 200)
                    });
                }
            });
            
            // Adicionar padrões identificados
            if (padroes.size > 0) {
                conhecimentoFeedback += '📋 PADRÕES IDENTIFICADOS (OBRIGATÓRIOS):\n';
                Array.from(padroes).forEach((padrao, index) => {
                    conhecimentoFeedback += `${index + 1}. ${padrao}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // Adicionar cláusulas por tipo de situação
            if (Object.keys(clausulasPorTipo).length > 0) {
                conhecimentoFeedback += '⚖️ CLÁUSULAS CCB POR TIPO DE SITUAÇÃO:\n';
                Object.keys(clausulasPorTipo).forEach(tipo => {
                    const clausulas = Array.from(clausulasPorTipo[tipo]);
                    conhecimentoFeedback += `• **${tipo}**: ${clausulas.join(', ')}\n`;
                });
                conhecimentoFeedback += '\n';
            }
            
            // Adicionar exemplos de boas práticas
            if (exemplos.length > 0) {
                conhecimentoFeedback += '✅ EXEMPLOS DE BOAS PRÁTICAS:\n';
                exemplos.slice(0, 3).forEach((exemplo, index) => {
                    conhecimentoFeedback += `${index + 1}. Contexto: ${exemplo.contexto}\n`;
                    if (exemplo.clausula) {
                        conhecimentoFeedback += `   Cláusula CCB: ${exemplo.clausula}\n`;
                    }
                    conhecimentoFeedback += `   Aplicar: ${exemplo.feedback}\n`;
                    conhecimentoFeedback += `   Exemplo: "${exemplo.resposta}..."\n\n`;
                });
            }
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO: Use este conhecimento para gerar uma resposta de alta qualidade desde o início, aplicando os padrões identificados e a cláusula CCB correta para cada tipo de situação.\n';
        }
        
        // Adicionar modelos de respostas aprovadas
        if (modelosRelevantes.length > 0) {
            conhecimentoFeedback += '\n\n🏆 MODELOS DE RESPOSTAS APROVADAS:\n';
            conhecimentoFeedback += 'Baseado em respostas que foram marcadas como "coerentes" para situações similares, use estes exemplos como referência:\n\n';
            
            modelosRelevantes.forEach((modelo, index) => {
                conhecimentoFeedback += `📋 **MODELO ${index + 1}** (${modelo.tipo_situacao}):\n`;
                conhecimentoFeedback += `   Motivo: ${modelo.motivo_solicitacao}\n`;
                conhecimentoFeedback += `   Resposta aprovada: "${modelo.respostaAprovada.substring(0, 300)}..."\n\n`;
            });
            
            conhecimentoFeedback += '🎯 INSTRUÇÃO: Use estes modelos como base para estruturar sua resposta, adaptando o conteúdo para os dados específicos fornecidos acima.\n';
        }
        
        
        const prompt = `Você é responsável por redigir respostas da empresa Velotax no Reclame Aqui.

ANÁLISE OBRIGATÓRIA DE TODOS OS CAMPOS:

Você receberá os seguintes campos que DEVEM ser analisados em conjunto:
- **Reclamação do Cliente**: O que o cliente está solicitando/reclamando
- **Solução Implementada**: O que a empresa fez para resolver
- **Histórico de Atendimento**: Contexto de atendimentos anteriores
- **Observações Internas**: Informações adicionais da equipe
- **Tipo de Situação**: Categoria da solicitação
- **Motivo da Solicitação**: Razão da solicitação

DADOS RECEBIDOS PARA ANÁLISE COMPLETA:

**Tipo de solicitação:** ${dadosFormulario.tipo_solicitacao}
**Motivo da solicitação:** ${dadosFormulario.motivo_solicitacao}

**RECLAMAÇÃO DO CLIENTE (ANALISAR PRIMEIRO):**
"${dadosFormulario.texto_cliente}"

**SOLUÇÃO IMPLEMENTADA (BASE FACTUAL):**
"${dadosFormulario.solucao_implementada}"

**HISTÓRICO DE ATENDIMENTO:**
${dadosFormulario.historico_atendimento || 'Nenhum'}

**OBSERVAÇÕES INTERNAS:**
${dadosFormulario.observacoes_internas || 'Nenhuma'}

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

ANÁLISE INTELIGENTE DAS CLÁUSULAS DA CCB:

Você deve analisar QUAL cláusula da CCB se aplica ao tipo de situação específica:

**Cláusulas Disponíveis:**
- **Cláusula 7**: Vínculo da Chave Pix e Quitação Automática (para casos de chave Pix, portabilidade, liberação)
- **Cláusula 8**: Liquidação Antecipada (para casos de quitação, liquidação, encerramento)
- **Cláusula 10**: Inadimplência e Vencimento Antecipado (para casos de inadimplência, vencimento)
- **Cláusula 14**: Proteção de Dados (LGPD) (para casos de exclusão de cadastro, dados pessoais)

**Como determinar a cláusula correta:**
1. **ANALISAR** o tipo de situação: ${dadosFormulario.tipo_solicitacao}
2. **IDENTIFICAR** qual cláusula se aplica baseado no tipo de situação
3. **USAR** o conhecimento dos feedbacks para aplicar a cláusula correta
4. **FUNDAMENTAR** a resposta com base na cláusula contratual específica
5. **EXPLICAR** ao cliente como a cláusula justifica a solução implementada

**IMPORTANTE:** Nem todos os casos usam a Cláusula 14 (LGPD). Use a cláusula apropriada para cada tipo de situação.

IMPORTANTE:

A resposta deve ser uma formulação completa que:
1. Reconhece a solicitação do cliente
2. Analisa a solução implementada com base nas cláusulas da CCB
3. Explica como a solução resolve a solicitação fundamentada contratualmente
4. Inclui contexto relevante do histórico e observações
5. Demonstra conhecimento das obrigações contratuais
6. Mantém tom profissional e empático

${conhecimentoFeedback}

Formule uma resposta personalizada e completa que responda diretamente à solicitação do cliente, explicando como a solução implementada resolve o problema fundamentada nas cláusulas contratuais.`;

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

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ` - ${motivo}` : ''}.

${solucao ? `Confirmamos que ${solucao}.` : 'Analisamos sua solicitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? `Considerando o histórico de atendimento: ${historico}. ` : ''}${observacoes && observacoes !== 'Nenhuma' ? `Observamos que: ${observacoes}. ` : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                
                // Adicionar contexto específico baseado no tipo de situação
                if (tipoSituacao.toLowerCase().includes('exclusão') || tipoSituacao.toLowerCase().includes('exclusao')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de exclusão de cadastro${motivo ? ` - ${motivo}` : ''}.

${solucao ? `Confirmamos que ${solucao}.` : 'Analisamos sua solicitação de exclusão e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? `Considerando o histórico de atendimento: ${historico}. ` : ''}${observacoes && observacoes !== 'Nenhuma' ? `Observamos que: ${observacoes}. ` : ''}

O processo foi concluído conforme solicitado. Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                } else if (tipoSituacao.toLowerCase().includes('pix') || tipoSituacao.toLowerCase().includes('portabilidade')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ` - ${motivo}` : ''}.

${solucao ? `Confirmamos que ${solucao}.` : 'Analisamos sua solicitação de portabilidade e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? `Considerando o histórico de atendimento: ${historico}. ` : ''}${observacoes && observacoes !== 'Nenhuma' ? `Observamos que: ${observacoes}. ` : ''}

A operação foi realizada conforme estabelecido na Cláusula 7 de sua Cédula de Crédito Bancário (CCB), que trata do vínculo da chave Pix e quitação automática.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                } else if (tipoSituacao.toLowerCase().includes('quitação') || tipoSituacao.toLowerCase().includes('liquidação')) {
                    respostaEspecifica = `Prezado(a) cliente,

Agradecemos seu contato e reconhecemos sua solicitação de ${tipoSituacao}${motivo ? ` - ${motivo}` : ''}.

${solucao ? `Confirmamos que ${solucao}.` : 'Analisamos sua solicitação de quitação e implementamos a solução adequada.'}

${historico && historico !== 'Nenhum' ? `Considerando o histórico de atendimento: ${historico}. ` : ''}${observacoes && observacoes !== 'Nenhuma' ? `Observamos que: ${observacoes}. ` : ''}

A operação foi realizada conforme estabelecido na Cláusula 8 de sua Cédula de Crédito Bancário (CCB), que trata da liquidação antecipada.

Caso tenha dúvidas, nossa equipe está disponível para esclarecimentos.

Atenciosamente,
Equipe Velotax`;
                }
                
                resposta = respostaEspecifica;
            }
            
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
        console.error('Erro ao gerar resposta RA:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
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
TAREFA: Reformular texto de moderação negado pelo Reclame Aqui

DADOS DE ENTRADA:
- Motivo da negativa: ${motivoNegativa}
- Texto de moderação negado: ${textoNegado}

INSTRUÇÕES ESPECIALIZADAS:
Você é um especialista em Reclame Aqui, com foco em reformulação de textos de moderação negados. Sua função é reformular textos de moderação negados pelo RA, garantindo aderência total aos manuais oficiais de moderação (Manual Geral, Manual de Reviews e Manual de Bancos/Instituições Financeiras/Meios).

🔹 ANÁLISE OBRIGATÓRIA:
1. Identifique por que o RA negou (ex.: "Resposta não condizente", "sem relação com os fatos", "tom inadequado")
2. Compare com os manuais de moderação e detecte onde o texto falhou
3. Analise o texto negado e identifique os pontos problemáticos

🔹 REFORMULAÇÃO OBRIGATÓRIA:
1. Ajuste apenas o necessário para alinhar ao motivo da negativa
2. Reforce com base no manual aplicável (sempre citar)
3. Mantenha texto objetivo, técnico e impessoal
4. Direcione sempre ao RA (não ao consumidor)

🔹 ESTRUTURA PADRÃO OBRIGATÓRIA:
"Conforme o apontamento acima, solicitamos a moderação desta publicação [inserir motivo reformulado]. Tal situação está em desacordo com o [manual aplicável]. Diante disso, solicitamos a exclusão/moderação do conteúdo."

🔹 REGRAS INQUEBRÁVEIS:
- Não inventar fatos
- Usar somente registros fornecidos + manuais
- Sempre citar manual aplicável
- Texto deve ser curto, objetivo e técnico
- Pedido sempre direcionado ao RA
- Manter tom impessoal e formal

🔹 MANUAIS APLICÁVEIS:
- Manual Geral de Moderação do RA
- Manual de Moderação de Reviews do RA
- Manual de Moderação – Bancos, Instituições Financeiras e Meios

Gere uma versão reformulada que corrija especificamente o motivo da negativa, mantendo aderência total aos manuais oficiais.

${conhecimentoFeedback}

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
        
        const { dadosFormulario, respostaAnterior, feedback } = req.body;
        
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
        
        // Obter feedbacks relevantes para melhorar a reformulação
        const feedbacksRelevantes = getRelevantFeedbacks('resposta', {
            tipoSituacao: dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
            motivoSolicitacao: dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao
        });
        
        let conhecimentoFeedback = '';
        if (feedbacksRelevantes.length > 0) {
            conhecimentoFeedback = '\n\nCONHECIMENTO BASEADO EM FEEDBACKS ANTERIORES:\n';
            feedbacksRelevantes.forEach((fb, index) => {
                conhecimentoFeedback += `${index + 1}. Feedback: "${fb.feedback}"\n`;
                conhecimentoFeedback += `   Resposta reformulada: "${fb.respostaReformulada.substring(0, 200)}..."\n\n`;
            });
            conhecimentoFeedback += 'Use este conhecimento para evitar erros similares e melhorar a qualidade da reformulação.\n';
        }
        
        const prompt = `
TAREFA: ${feedback ? 'GERAR NOVA RESPOSTA' : 'REFORMULAR RESPOSTA'} do Reclame Aqui

DADOS DO CASO:
- Tipo de Situação: ${dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao}
- Motivo da Solicitação: ${dadosFormulario.motivo_solicitacao || dadosFormulario.motivoSolicitacao}
- Solução Implementada: ${dadosFormulario.solucao_implementada || dadosFormulario.solucaoImplementada}
- Reclamação do Cliente: ${dadosFormulario.texto_cliente || dadosFormulario.reclamacaoCliente}
- Histórico de Atendimento: ${dadosFormulario.historico_atendimento || dadosFormulario.historicoAtendimento}
- Observações Internas: ${dadosFormulario.observacoes_internas || dadosFormulario.observacoesInternas}

${feedback ? `
FEEDBACK DO OPERADOR (a resposta anterior estava incorreta):
${feedback}

INSTRUÇÕES CRÍTICAS:
- A resposta anterior estava INCORRETA e não deve ser usada como base
- GERE UMA NOVA RESPOSTA COMPLETA do zero
- Use APENAS os dados do caso acima como base
- Analise o feedback para entender o que estava errado
- Evite os erros identificados no feedback
- Foque na solução implementada e como ela resolve a solicitação do cliente
- Seja específico e conclusivo` : `
RESPOSTA ANTERIOR (para referência):
${respostaAnterior}

INSTRUÇÕES PARA REFORMULAÇÃO:
- Analise a resposta anterior e identifique pontos de melhoria
- Reformule para ser mais completa e eficaz
- Mantenha o tom profissional e empático
- Aborde todos os aspectos da reclamação do cliente`}

${conhecimentoFeedback}

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
                addFeedbackAprendizado(
                    dadosFormulario.tipo_solicitacao || dadosFormulario.tipoSituacao,
                    feedback,
                    respostaReformulada
                );
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
app.get('/api/aprendizado-script', (req, res) => {
    try {
        const aprendizado = loadAprendizadoScript();
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
app.get('/api/aprendizado-script/:tipoSituacao', (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        const aprendizado = getAprendizadoTipoSituacao(tipoSituacao);
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
app.post('/api/processar-padroes/:tipoSituacao', (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        console.log('🔄 Forçando processamento de padrões para:', tipoSituacao);
        processarPadroesExistentes(tipoSituacao);
        const aprendizado = getAprendizadoTipoSituacao(tipoSituacao);
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

// Endpoint para verificar status do aprendizado
app.get('/api/status-aprendizado/:tipoSituacao', (req, res) => {
    try {
        const { tipoSituacao } = req.params;
        const aprendizado = getAprendizadoTipoSituacao(tipoSituacao);
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
app.delete('/api/feedbacks/respostas', (req, res) => {
    try {
        const feedbacksVazios = {
            respostas: [],
            lastUpdated: new Date().toISOString()
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
app.delete('/api/feedbacks/moderacoes', (req, res) => {
    try {
        const feedbacksVazios = {
            moderacoes: [],
            lastUpdated: new Date().toISOString()
        };
        saveFeedbacksModeracoes(feedbacksVazios);
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
            lastUpdated: new Date().toISOString()
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
            lastUpdated: new Date().toISOString()
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
app.post('/api/save-modelo-resposta', (req, res) => {
    console.log('🎯 Endpoint /api/save-modelo-resposta chamado');
    try {
        const { dadosFormulario, respostaAprovada } = req.body;
        
        if (!dadosFormulario || !respostaAprovada) {
            return res.status(400).json({
                success: false,
                error: 'Dados do formulário e resposta aprovada são obrigatórios'
            });
        }
        
        console.log('💾 Salvando resposta como modelo:', {
            tipo_situacao: dadosFormulario.tipo_solicitacao,
            motivo_solicitacao: dadosFormulario.motivo_solicitacao,
            resposta_length: respostaAprovada.length
        });
        
        // Salvar como modelo
        const modelo = addModeloResposta(dadosFormulario, respostaAprovada);
        
        res.json({
            success: true,
            message: 'Resposta salva como modelo para futuras solicitações similares',
            modeloId: modelo.id,
            tipoSituacao: modelo.tipo_situacao
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

// Middleware para rotas não encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        message: 'A rota solicitada não existe'
    });
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====

app.listen(PORT, () => {
    console.log('🚀 Servidor Velotax Bot iniciado!');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('🔐 Sistema de segurança ativo');
    console.log('📁 Arquivo .env carregado da raiz do projeto');
    console.log('🧠 Sistema de aprendizado baseado em feedback ativo');
    
    // Verificar se arquivo .env existe
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        console.log('✅ Arquivo .env encontrado na raiz');
    } else {
        console.warn('⚠️ Arquivo .env não encontrado na raiz');
    }
    
    // Verificar sistema de feedbacks
    const feedbacks = loadFeedbacks();
    console.log(`📚 ${feedbacks.respostas.length} feedbacks de respostas salvos`);
    console.log(`📚 ${feedbacks.moderacoes.length} feedbacks de moderação salvos`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando servidor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Encerrando servidor...');
    process.exit(0);
});

module.exports = app;

