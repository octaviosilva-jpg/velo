const googleSheetsConfig = require('./google-sheets-config');
const googleSheetsFallback = require('./google-sheets-fallback');
const fs = require('fs');

class GoogleSheetsIntegration {
    constructor() {
        this.initialized = false;
        this.spreadsheetId = null;
        this.rateLimitQueue = [];
        this.isProcessingQueue = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000; // 1 segundo entre requests
        this.cache = new Map();
        this.cacheTimeout = 2 * 60 * 1000; // 2 minutos (mais responsivo)
    }

    /**
     * Inicializa a integração com Google Sheets usando sistema de fallback
     */
    async initialize(envVars = null) {
        try {
            console.log('🔧 Inicializando integração com Google Sheets (sistema de fallback)...');
            
            // 1. Primeiro, tentar usar o sistema de fallback
            const fallbackSuccess = await googleSheetsFallback.initialize();
            
            if (fallbackSuccess) {
                console.log(`✅ Sistema de fallback funcionou usando método: ${googleSheetsFallback.getMethod()}`);
                
                const credentials = googleSheetsFallback.getCredentials();
                const spreadsheetId = googleSheetsFallback.getSpreadsheetId();
                
                if (credentials && spreadsheetId) {
                    this.spreadsheetId = spreadsheetId;
                    this.initialized = await googleSheetsConfig.initializeWithCredentials(credentials, spreadsheetId);
                    
                    if (this.initialized) {
                        console.log('✅ Integração com Google Sheets inicializada com sucesso via fallback');
                        await this.ensureSheetsExist();
                        this.startCacheCleanup();
                        return true;
                    }
                } else if (spreadsheetId) {
                    // Configuração mínima - apenas ID da planilha
                    console.log('⚠️ Configuração mínima detectada - apenas ID da planilha');
                    this.spreadsheetId = spreadsheetId;
                    this.initialized = false; // Não inicializar completamente
                    return false;
                }
            }
            
            // 2. Fallback para método antigo (compatibilidade)
            console.log('🔄 Tentando método de inicialização antigo...');
            
            // Carregar configurações do ambiente
            const spreadsheetId = envVars?.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_ID;
            if (!spreadsheetId) {
                console.log('⚠️ GOOGLE_SHEETS_ID não configurado. Integração desabilitada.');
                return false;
            }

            this.spreadsheetId = spreadsheetId;
            
            // Verificar se as credenciais do Service Account estão nas variáveis de ambiente
            const serviceAccountEmail = envVars?.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
            const privateKey = envVars?.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
            const projectId = envVars?.GOOGLE_PROJECT_ID || process.env.GOOGLE_PROJECT_ID;

            // Priorizar Service Account (método correto para Vercel)
            if (serviceAccountEmail && privateKey && projectId) {
                console.log('🔧 Usando Service Account para autenticação...');
                
                // Montar objeto de credenciais do Service Account
                const credentials = {
                    type: 'service_account',
                    project_id: projectId,
                    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || 'default',
                    private_key: privateKey.replace(/\\n/g, '\n'),
                    client_email: serviceAccountEmail,
                    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(serviceAccountEmail)}`
                };

                this.initialized = await googleSheetsConfig.initializeWithCredentials(credentials, spreadsheetId);
                
                if (this.initialized) {
                    console.log('✅ Integração com Google Sheets (Service Account) inicializada com sucesso');
                    await this.ensureSheetsExist();
                    this.startCacheCleanup(); // Iniciar limpeza periódica de cache
                } else {
                    console.log('⚠️ Integração com Google Sheets (Service Account) não pôde ser inicializada');
                }

                return this.initialized;
            }
            
            // Fallback para OAuth2 (método antigo)
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            
            if (clientId && clientSecret) {
                console.log('⚠️ Usando OAuth2 (método antigo - pode não funcionar na Vercel)...');
            } else {
                console.log('⚠️ Credenciais do Google não configuradas. Integração desabilitada.');
                return false;
            }

            // Criar objeto de credenciais a partir das variáveis de ambiente
            const credentials = {
                installed: {
                    client_id: clientId,
                    project_id: process.env.GOOGLE_PROJECT_ID || 'velotax-bot-v2',
                    auth_uri: process.env.GOOGLE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
                    client_secret: clientSecret,
                    redirect_uris: process.env.GOOGLE_REDIRECT_URIS ? process.env.GOOGLE_REDIRECT_URIS.split(',') : ['http://localhost', 'https://velotax-bot-v2.vercel.app/']
                }
            };

            this.initialized = await googleSheetsConfig.initializeWithCredentials(credentials, spreadsheetId);
            
            if (this.initialized) {
                console.log('✅ Integração com Google Sheets inicializada com sucesso');
                await this.ensureSheetsExist();
            } else {
                console.log('⚠️ Integração com Google Sheets não pôde ser inicializada');
            }

            return this.initialized;

        } catch (error) {
            console.error('❌ Erro ao inicializar integração com Google Sheets:', error.message);
            return false;
        }
    }

    /**
     * Verifica se a integração está ativa
     */
    isActive() {
        // Google Sheets habilitado para Vercel com Service Account
        return this.initialized && googleSheetsConfig.isInitialized();
    }

    /**
     * Verifica o status da API do Google Sheets
     */
    async checkApiStatus() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo');
            return false;
        }

        try {
            console.log('🔍 Verificando status da API do Google Sheets...');
            
            // Tentar uma operação simples para verificar se a API está funcionando
            const sheets = googleSheetsConfig.getSheets();
            const spreadsheetId = googleSheetsConfig.getSpreadsheetId();
            
            // Fazer uma requisição simples para verificar conectividade
            const response = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheetId,
                fields: 'properties.title'
            });
            
            console.log('✅ API do Google Sheets funcionando. Planilha:', response.data.properties.title);
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao verificar status da API do Google Sheets:', error.message);
            
            // Verificar se é erro de quota
            if (error.message.includes('quota') || error.message.includes('exceeded') || error.message.includes('429')) {
                console.log('⚠️ Quota da API do Google Sheets excedida');
                this.handleQuotaError(error);
            }
            
            return false;
        }
    }

    /**
     * Rate limiting para evitar esgotamento de quota
     */
    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            console.log(`⏳ Rate limiting: aguardando ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }

    /**
     * Verifica cache antes de fazer request
     */
    getFromCache(key, forceRefresh = false) {
        if (forceRefresh) {
            console.log(`🔄 Forçando refresh do cache para: ${key}`);
            this.cache.delete(key);
            return null;
        }
        
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            console.log(`📋 Cache hit para: ${key}`);
            return cached.data;
        }
        return null;
    }

    /**
     * Salva no cache
     */
    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        console.log(`💾 Cache salvo para: ${key}`);
    }

    /**
     * Limpa cache expirado
     */
    cleanExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if ((now - value.timestamp) >= this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Invalida cache específico (usado após operações de escrita)
     */
    invalidateCache(keys = []) {
        if (keys.length === 0) {
            // Se não especificar chaves, limpar todo o cache
            this.cache.clear();
            console.log('🗑️ Cache completamente limpo');
        } else {
            keys.forEach(key => {
                this.cache.delete(key);
                console.log(`🗑️ Cache invalidado para: ${key}`);
            });
        }
    }

    /**
     * Força refresh de dados específicos
     */
    async forceRefreshData(dataType) {
        const cacheKeys = {
            'modelos': 'modelos_respostas',
            'feedbacks': 'feedbacks_respostas',
            'feedbacks_moderacoes': 'feedbacks_moderacoes',
            'moderacoes_coerentes': 'moderacoes_coerentes',
            'all': ['modelos_respostas', 'feedbacks_respostas', 'feedbacks_moderacoes', 'moderacoes_coerentes']
        };

        const keys = cacheKeys[dataType] || [dataType];
        this.invalidateCache(Array.isArray(keys) ? keys : [keys]);
        
        // Recarregar dados se necessário
        if (dataType === 'modelos' || dataType === 'all') {
            return await this.obterModelosRespostas();
        }
        if (dataType === 'feedbacks' || dataType === 'all') {
            return await this.obterFeedbacksRespostas();
        }
        if (dataType === 'feedbacks_moderacoes' || dataType === 'all') {
            return await this.obterFeedbacksModeracoes();
        }
        if (dataType === 'moderacoes_coerentes' || dataType === 'all') {
            return await this.obterModeracoesCoerentes();
        }
    }

    /**
     * Trata erros de quota do Google Sheets
     */
    handleQuotaError(error) {
        console.log('🔍 Analisando erro do Google Sheets:', error.message);
        
        // Detectar erros de quota excedida
        if (error.message && (error.message.includes('quota') || error.message.includes('esgotado') || error.message.includes('exceeded'))) {
            console.log('⚠️ QUOTA EXCEDIDA! Aumentando drasticamente o intervalo de rate limiting...');
            this.minRequestInterval = Math.min(this.minRequestInterval * 3, 30000); // Máximo 30 segundos
            this.lastQuotaError = Date.now();
            return true;
        }
        
        // Verificar outros tipos de erro que podem indicar problemas de API
        if (error.message && (error.message.includes('403') || error.message.includes('429') || error.message.includes('rate limit'))) {
            console.log('⚠️ Rate limit ou erro de permissão detectado. Aguardando antes de tentar novamente...');
            this.minRequestInterval = Math.min(this.minRequestInterval * 2, 20000); // Máximo 20 segundos
            this.lastQuotaError = Date.now();
            return true;
        }
        
        // Detectar erros de timeout ou conectividade
        if (error.message && (error.message.includes('timeout') || error.message.includes('socket hang up') || error.message.includes('ECONNRESET'))) {
            console.log('⚠️ Problemas de conectividade detectados. Aumentando intervalo...');
            this.minRequestInterval = Math.min(this.minRequestInterval * 1.5, 15000); // Máximo 15 segundos
            return true;
        }
        
        return false;
    }
    
    /**
     * Verifica se deve aguardar devido a problemas recentes de quota
     */
    shouldWaitForQuotaRecovery() {
        if (!this.lastQuotaError) return false;
        
        const timeSinceLastError = Date.now() - this.lastQuotaError;
        const recoveryTime = 5 * 60 * 1000; // 5 minutos
        
        if (timeSinceLastError < recoveryTime) {
            const remainingTime = Math.ceil((recoveryTime - timeSinceLastError) / 1000);
            console.log(`⏳ Aguardando recuperação de quota: ${remainingTime}s restantes`);
            return true;
        }
        
        // Reset do erro após recuperação
        this.lastQuotaError = null;
        this.minRequestInterval = 2000; // Reset para intervalo normal
        console.log('✅ Quota recuperada - resetando intervalos');
        return false;
    }

    /**
     * Inicializa limpeza periódica de cache
     */
    startCacheCleanup() {
        setInterval(() => {
            this.cleanExpiredCache();
        }, 60000); // Limpar a cada minuto
    }

    /**
     * Garante que as planilhas necessárias existam
     */
    async ensureSheetsExist() {
        if (!this.isActive()) return;

        try {
            // Verificar se as planilhas existem e criar cabeçalhos se necessário
            await this.ensureSheetExists('Feedbacks', [
                'Data/Hora',
                'ID',
                'Tipo',
                'Texto Cliente',
                'Resposta Anterior',
                'Feedback',
                'Resposta Reformulada',
                'Tipo Solicitação',
                'Motivo Solicitação',
                'Solução Implementada',
                'Histórico Atendimento',
                'Observações Internas'
            ]);

            await this.ensureSheetExists('Respostas Coerentes', [
                'Data/Hora',
                'ID',
                'Tipo',
                'Texto Cliente',
                'Resposta Aprovada',
                'Tipo Solicitação',
                'Motivo Solicitação',
                'Solução Implementada',
                'Histórico Atendimento',
                'Observações Internas',
                'Status Aprovação'
            ]);

            await this.ensureSheetExists('Acessos Interface', [
                'Data/Hora',
                'Usuário',
                'Ação',
                'IP',
                'User Agent',
                'Duração Sessão (min)',
                'Status'
            ]);

            await this.ensureSheetExists('Moderações', [
                'Data/Hora',
                'ID',
                'Tipo',
                'Solicitação Cliente',
                'Resposta Empresa',
                'Consideração Final',
                'Motivo Moderação',
                'Texto Moderação Anterior',
                'Feedback',
                'Texto Moderação Reformulado',
                'Linha Raciocínio',
                'Status Aprovação',
                'Observações Internas'
            ]);

            console.log('✅ Planilhas verificadas/criadas com sucesso');

        } catch (error) {
            console.error('❌ Erro ao verificar/criar planilhas:', error.message);
        }
    }

    /**
     * Garante que uma planilha específica existe
     */
    async ensureSheetExists(sheetName, headers) {
        if (!this.isActive()) return;

        try {
            // Tentar ler a primeira linha para verificar se a planilha existe
            const range = `${sheetName}!A1:Z1`;
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length === 0) {
                // Planilha vazia, criar cabeçalhos
                await googleSheetsConfig.appendRow(range, headers);
                console.log(`✅ Cabeçalhos criados na planilha: ${sheetName}`);
                
                // Aplicar formatação básica para corrigir problemas de visualização
                try {
                    await googleSheetsConfig.aplicarFormatacaoBasica(sheetName);
                } catch (error) {
                    console.error(`⚠️ Erro ao aplicar formatação na planilha ${sheetName}:`, error.message);
                }
            } else {
                console.log(`✅ Planilha ${sheetName} já existe`);
            }

        } catch (error) {
            console.error(`❌ Erro ao verificar planilha ${sheetName}:`, error.message);
        }
    }

    /**
     * Registra um feedback no Google Sheets
     */
    async registrarFeedback(feedbackData) {
        console.log('🔍 [DEBUG] Tentando registrar feedback...');
        console.log('🔍 [DEBUG] Google Sheets ativo?', this.isActive());
        
        // Tentar inicializar se não estiver ativo
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Tentando inicializar...');
            const inicializado = await this.initialize();
            if (!inicializado) {
                console.log('❌ Não foi possível inicializar Google Sheets. Feedback não registrado.');
                return false;
            }
            console.log('✅ Google Sheets inicializado com sucesso para registrar feedback');
        }

        try {
            // Rate limiting para operações de escrita
            await this.waitForRateLimit();
            
            // Invalidar cache relacionado para forçar atualização
            this.invalidateCache(['feedbacks_respostas']);
            // Criar perfil do usuário para a coluna ID
            const userProfile = feedbackData.userProfile || 
                (feedbackData.userEmail ? `${feedbackData.userName || 'Usuário'} (${feedbackData.userEmail})` : 'N/A');

            const row = [
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), // Coluna A: Data/Hora
                feedbackData.id || '', // Coluna B: ID
                feedbackData.tipo || 'feedback', // Coluna C: Tipo
                feedbackData.textoCliente || feedbackData.dadosFormulario?.texto_cliente || '', // Coluna D: Texto Cliente
                feedbackData.respostaAnterior || '', // Coluna E: Resposta Anterior
                feedbackData.feedback || '', // Coluna F: Feedback
                feedbackData.respostaReformulada || '', // Coluna G: Resposta Reformulada
                feedbackData.dadosFormulario?.tipo_solicitacao || feedbackData.tipoSituacao || '', // Coluna H: Tipo Solicitação
                feedbackData.dadosFormulario?.motivo_solicitacao || '', // Coluna I: Motivo Solicitação
                feedbackData.dadosFormulario?.solucao_implementada || '', // Coluna J: Solução Implementada
                feedbackData.dadosFormulario?.historico_atendimento || '', // Coluna K: Histórico Atendimento
                feedbackData.dadosFormulario?.observacoes_internas || '' // Coluna L: Observações Internas
            ];

            await googleSheetsConfig.appendRow('Feedbacks!A:Z', row);
            console.log('✅ Feedback registrado no Google Sheets com perfil do usuário:', userProfile);
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar feedback no Google Sheets:', error.message);
            this.handleQuotaError(error);
            return false;
        }
    }

    /**
     * Salva um modelo de resposta no Google Sheets (alias para registrarRespostaCoerente)
     */
    async salvarModeloResposta(modeloData) {
        console.log('💾 Salvando modelo de resposta no Google Sheets...');
        return await this.registrarRespostaCoerente(modeloData);
    }

    /**
     * Registra uma resposta coerente no Google Sheets
     */
    async registrarRespostaCoerente(respostaData) {
        console.log('🔍 [DEBUG] Iniciando registro de resposta coerente...');
        console.log('🔍 [DEBUG] Google Sheets ativo?', this.isActive());
        console.log('🔍 [DEBUG] Dados recebidos:', JSON.stringify(respostaData, null, 2));
        
        // Tentar inicializar se não estiver ativo
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Tentando inicializar...');
            const inicializado = await this.initialize();
            if (!inicializado) {
                console.log('❌ Não foi possível inicializar Google Sheets. Resposta não registrada.');
                return false;
            }
            console.log('✅ Google Sheets inicializado com sucesso para registrar resposta');
        }

        try {
            // Rate limiting para operações de escrita
            await this.waitForRateLimit();
            
            // Invalidar cache relacionado para forçar atualização
            this.invalidateCache(['modelos_respostas']);
            // Criar perfil do usuário para a coluna ID
            const userProfile = respostaData.userProfile || 
                (respostaData.userEmail ? `${respostaData.userName || 'Usuário'} (${respostaData.userEmail})` : 'N/A');

            const row = [
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), // Coluna A: Data/Hora
                respostaData.id || '', // Coluna B: ID
                respostaData.tipo || 'resposta', // Coluna C: Tipo
                respostaData.textoCliente || respostaData.dadosFormulario?.texto_cliente || '', // Coluna D: Texto Cliente
                respostaData.respostaAprovada || respostaData.respostaFinal || '', // Coluna E: Resposta Aprovada
                respostaData.dadosFormulario?.tipo_solicitacao || respostaData.tipoSituacao || '', // Coluna F: Tipo Solicitação
                respostaData.dadosFormulario?.motivo_solicitacao || respostaData.motivoSolicitacao || '', // Coluna G: Motivo Solicitação
                respostaData.dadosFormulario?.solucao_implementada || '', // Coluna H: Solução Implementada
                respostaData.dadosFormulario?.historico_atendimento || '', // Coluna I: Histórico Atendimento
                respostaData.dadosFormulario?.observacoes_internas || '', // Coluna J: Observações Internas
                'Aprovada' // Coluna K: Status Aprovação
            ];

            await googleSheetsConfig.appendRow('Respostas Coerentes!A:Z', row);
            console.log('✅ Resposta coerente registrada no Google Sheets com perfil do usuário:', userProfile);
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar resposta coerente no Google Sheets:', error.message);
            this.handleQuotaError(error);
            return false;
        }
    }

    /**
     * Registra um feedback de moderação no Google Sheets
     */
    async registrarFeedbackModeracao(feedbackData) {
        console.log('🔍 [DEBUG] Tentando registrar feedback de moderação...');
        console.log('🔍 [DEBUG] Google Sheets ativo?', this.isActive());
        
        // Tentar inicializar se não estiver ativo
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Tentando inicializar...');
            const inicializado = await this.initialize();
            if (!inicializado) {
                console.log('❌ Não foi possível inicializar Google Sheets. Feedback de moderação não registrado.');
                return false;
            }
            console.log('✅ Google Sheets inicializado com sucesso para registrar feedback');
        }

        // Verificar se deve aguardar recuperação de quota
        if (this.shouldWaitForQuotaRecovery()) {
            console.log('⏳ Aguardando recuperação de quota antes de registrar feedback');
            return false;
        }

        try {
            console.log('🔍 [DEBUG] Verificando status da API...');
            // Verificar status da API antes de tentar registrar
            const apiStatus = await this.checkApiStatus();
            if (!apiStatus) {
                console.log('⚠️ API do Google Sheets não está funcionando. Feedback não registrado.');
                return false;
            }
            console.log('✅ [DEBUG] API do Google Sheets está funcionando');

            // Rate limiting para operações de escrita
            await this.waitForRateLimit();
            
            // Invalidar cache relacionado para forçar atualização
            this.invalidateCache(['feedbacks_moderacoes']);
            
            // Criar perfil do usuário para a coluna ID
            const userProfile = feedbackData.userProfile || 
                (feedbackData.userEmail ? `${feedbackData.userName || 'Usuário'} (${feedbackData.userEmail})` : 'N/A');

            const row = [
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), // Coluna A: Data/Hora
                feedbackData.id || '', // Coluna B: ID
                feedbackData.tipo || 'moderacao', // Coluna C: Tipo
                feedbackData.dadosModeracao?.solicitacaoCliente || '', // Coluna D: Solicitação Cliente
                feedbackData.dadosModeracao?.respostaEmpresa || '', // Coluna E: Resposta Empresa
                feedbackData.dadosModeracao?.consideracaoFinal || '', // Coluna F: Consideração Final
                feedbackData.dadosModeracao?.motivoModeracao || '', // Coluna G: Motivo Moderação
                feedbackData.textoNegado || '', // Coluna H: Texto Moderação Anterior
                feedbackData.motivoNegativa || '', // Coluna I: Feedback
                feedbackData.textoReformulado || '', // Coluna J: Texto Moderação Reformulado
                feedbackData.linhaRaciocinio || '', // Coluna K: Linha Raciocínio
                'Pendente', // Coluna L: Status Aprovação
                feedbackData.observacoesInternas || '' // Coluna M: Observações Internas
            ];

            await googleSheetsConfig.appendRow('Moderações!A:Z', row);
            console.log('✅ Feedback de moderação registrado no Google Sheets com perfil do usuário:', userProfile);
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar feedback de moderação no Google Sheets:', error.message);
            
            // Se for erro de socket hang up, tentar novamente uma vez
            if (error.message.includes('socket hang up') || error.message.includes('timeout')) {
                console.log('🔄 Tentando novamente após erro de conectividade...');
                try {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguardar 2 segundos
                    await googleSheetsConfig.appendRow('Moderações!A:Z', row);
                    console.log('✅ Feedback de moderação registrado no Google Sheets (retry bem-sucedido)');
                    return true;
                } catch (retryError) {
                    console.error('❌ Retry falhou:', retryError.message);
                }
            }
            
            this.handleQuotaError(error);
            return false;
        }
    }

    /**
     * Registra uma moderação coerente no Google Sheets
     */
    async registrarModeracaoCoerente(moderacaoData) {
        console.log('🔍 [DEBUG] Tentando registrar moderação coerente...');
        console.log('🔍 [DEBUG] Google Sheets ativo?', this.isActive());
        
        // Tentar inicializar se não estiver ativo
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Tentando inicializar...');
            const inicializado = await this.initialize();
            if (!inicializado) {
                console.log('❌ Não foi possível inicializar Google Sheets. Moderação coerente não registrada.');
                return false;
            }
            console.log('✅ Google Sheets inicializado com sucesso para registrar moderação');
        }

        // Verificar se deve aguardar recuperação de quota
        if (this.shouldWaitForQuotaRecovery()) {
            console.log('⏳ Aguardando recuperação de quota antes de registrar moderação');
            return false;
        }

        try {
            console.log('🔍 [DEBUG] Verificando status da API...');
            // Verificar status da API antes de tentar registrar
            const apiStatus = await this.checkApiStatus();
            if (!apiStatus) {
                console.log('⚠️ API do Google Sheets não está funcionando. Moderação não registrada.');
                return false;
            }
            console.log('✅ [DEBUG] API do Google Sheets está funcionando');

            // Rate limiting para operações de escrita
            await this.waitForRateLimit();
            
            // Invalidar cache relacionado para forçar atualização
            this.invalidateCache(['moderacoes_coerentes']);
            
            // Criar perfil do usuário para a coluna ID
            const userProfile = moderacaoData.userProfile || 
                (moderacaoData.userEmail ? `${moderacaoData.userName || 'Usuário'} (${moderacaoData.userEmail})` : 'N/A');

            const row = [
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), // Coluna A: Data/Hora
                moderacaoData.id || '', // Coluna B: ID
                moderacaoData.tipo || 'moderacao', // Coluna C: Tipo
                moderacaoData.dadosModeracao?.solicitacaoCliente || '', // Coluna D: Solicitação Cliente
                moderacaoData.dadosModeracao?.respostaEmpresa || '', // Coluna E: Resposta Empresa
                moderacaoData.dadosModeracao?.consideracaoFinal || '', // Coluna F: Consideração Final
                moderacaoData.dadosModeracao?.motivoModeracao || '', // Coluna G: Motivo Moderação
                '', // Coluna H: Texto Moderação Anterior (vazio para moderações aprovadas)
                '', // Coluna I: Feedback (vazio para moderações aprovadas)
                moderacaoData.textoModeracao || moderacaoData.textoFinal || '', // Coluna J: Texto Moderação Reformulado
                moderacaoData.linhaRaciocinio || '', // Coluna K: Linha Raciocínio
                'Aprovada', // Coluna L: Status Aprovação
                moderacaoData.observacoesInternas || '' // Coluna M: Observações Internas
            ];

            await googleSheetsConfig.appendRow('Moderações!A:Z', row);
            console.log('✅ Moderação coerente registrada no Google Sheets com perfil do usuário:', userProfile);
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar moderação coerente no Google Sheets:', error.message);
            this.handleQuotaError(error);
            return false;
        }
    }

    /**
     * Registra um acesso à interface no Google Sheets
     */
    async registrarAcessoInterface(acessoData) {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Acesso não registrado.');
            return false;
        }

        try {
            // Criar perfil do usuário para a coluna ID
            const userProfile = acessoData.userProfile || 
                (acessoData.userEmail ? `${acessoData.userName || 'Usuário'} (${acessoData.userEmail})` : 
                (acessoData.usuario || 'Anônimo'));

            const row = [
                userProfile, // Perfil do usuário na coluna ID
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                acessoData.usuario || 'Anônimo',
                acessoData.acao || 'Acesso',
                acessoData.ip || '',
                acessoData.userAgent || '',
                acessoData.duracaoSessao || 0,
                acessoData.status || 'Sucesso'
            ];

            await googleSheetsConfig.appendRow('Acessos Interface!A:Z', row);
            console.log('✅ Acesso à interface registrado no Google Sheets com perfil do usuário:', userProfile);
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar acesso no Google Sheets:', error.message);
            return false;
        }
    }

    /**
     * Registra estatísticas globais no Google Sheets
     */
    async registrarEstatisticas(estatisticas) {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Estatísticas não registradas.');
            return false;
        }

        try {
            // Criar planilha de estatísticas se não existir
            await this.ensureSheetExists('Estatísticas', [
                'Data',
                'Respostas Geradas',
                'Respostas Coerentes',
                'Moderações Geradas',
                'Moderações Coerentes',
                'Revisões Texto',
                'Explicações Geradas'
            ]);

            const dataHoje = new Date().toLocaleDateString('pt-BR');
            
            // Tentar buscar dados existentes para atualizar em vez de sempre adicionar
            try {
                const range = 'Estatísticas!A2:G1000'; // Buscar todas as linhas (exceto cabeçalho)
                const rows = await googleSheetsConfig.readData(range);
                
                // Procurar se já existe uma linha para hoje
                let linhaEncontrada = -1;
                if (rows && rows.length > 0) {
                    linhaEncontrada = rows.findIndex(row => row && row[0] === dataHoje);
                }
                
                const rowData = [
                    dataHoje,
                    estatisticas.respostas_geradas || 0,
                    estatisticas.respostas_coerentes || 0,
                    estatisticas.moderacoes_geradas || 0,
                    estatisticas.moderacoes_coerentes || 0,
                    estatisticas.revisoes_texto || 0,
                    estatisticas.explicacoes_geradas || 0
                ];
                
                if (linhaEncontrada >= 0) {
                    // Atualizar linha existente (linhaEncontrada + 2 porque começa em A2)
                    const linhaAtualizar = linhaEncontrada + 2;
                    const updateRange = `Estatísticas!A${linhaAtualizar}:G${linhaAtualizar}`;
                    await googleSheetsConfig.updateRow(updateRange, rowData);
                    console.log(`✅ Estatísticas do dia ${dataHoje} atualizadas no Google Sheets`);
                } else {
                    // Adicionar nova linha se não existir
                    await googleSheetsConfig.appendRow('Estatísticas!A:Z', rowData);
                    console.log(`✅ Estatísticas do dia ${dataHoje} registradas no Google Sheets`);
                }
            } catch (error) {
                // Se falhar ao buscar, adicionar nova linha
                console.log('⚠️ Não foi possível verificar linha existente, adicionando nova linha:', error.message);
                const rowData = [
                    dataHoje,
                    estatisticas.respostas_geradas || 0,
                    estatisticas.respostas_coerentes || 0,
                    estatisticas.moderacoes_geradas || 0,
                    estatisticas.moderacoes_coerentes || 0,
                    estatisticas.revisoes_texto || 0,
                    estatisticas.explicacoes_geradas || 0
                ];
                await googleSheetsConfig.appendRow('Estatísticas!A:Z', rowData);
                console.log(`✅ Estatísticas do dia ${dataHoje} registradas no Google Sheets (fallback)`);
            }
            
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar estatísticas no Google Sheets:', error.message);
            return false;
        }
    }

    /**
     * Carrega aprendizado do Google Sheets
     */
    async carregarAprendizado() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível carregar aprendizado.');
            return null;
        }

        try {
            console.log('📚 Carregando aprendizado do Google Sheets...');
            
            // Ler dados da planilha de aprendizado
            const range = 'Aprendizado!A1:Z1000';
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length === 0) {
                console.log('📚 Nenhum aprendizado encontrado no Google Sheets');
                return null;
            }
            
            // Converter dados da planilha para formato JSON
            const aprendizado = {
                tiposSituacao: {},
                lastUpdated: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            };
            
            // Processar dados (implementar lógica de conversão)
            // Por enquanto, retornar estrutura básica
            console.log('✅ Aprendizado carregado do Google Sheets');
            return aprendizado;
            
        } catch (error) {
            console.error('❌ Erro ao carregar aprendizado do Google Sheets:', error.message);
            return null;
        }
    }

    /**
     * Obtém todos os modelos de respostas da planilha
     */
    async obterModelosRespostas() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível obter modelos.');
            return [];
        }

        try {
            console.log('📚 Obtendo modelos de respostas do Google Sheets...');
            
            // Verificar cache primeiro
            const cacheKey = 'modelos_respostas';
            const cachedData = this.getFromCache(cacheKey);
            if (cachedData) {
                return cachedData;
            }
            
            // Verificar se googleSheetsConfig está inicializado
            console.log('🔍 DEBUG - Verificando googleSheetsConfig:', {
                existe: !!googleSheetsConfig,
                isInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
            });
            
            if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
                console.log('⚠️ googleSheetsConfig não está inicializado');
                return [];
            }
            
            // Rate limiting
            await this.waitForRateLimit();
            
            // Ler dados da planilha de modelos
            const range = 'Respostas Coerentes!A1:Z1000';
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length <= 1) {
                console.log('📚 Nenhum modelo encontrado no Google Sheets');
                return [];
            }
            
            // Converter dados da planilha para array de objetos
            const headers = data[0];
            const modelos = [];
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row[0]) { // Se tem ID
                    const modelo = {};
                    headers.forEach((header, index) => {
                        if (row[index] !== undefined) {
                            modelo[header] = row[index];
                        }
                    });
                    // Filtrar apenas respostas aprovadas/coerentes
                    if (modelo['Status Aprovação'] === 'Aprovada' || !modelo['Status Aprovação']) {
                        // Se não tem status, assumir que é aprovada (compatibilidade com dados antigos)
                        modelos.push(modelo);
                    }
                }
            }
            
            console.log(`✅ ${modelos.length} respostas coerentes obtidas do Google Sheets`);
            
            // Salvar no cache
            this.setCache(cacheKey, modelos);
            
            return modelos;
            
        } catch (error) {
            console.error('❌ Erro ao obter modelos do Google Sheets:', error.message);
            this.handleQuotaError(error);
            return [];
        }
    }

    /**
     * Obtém todos os feedbacks de moderações da planilha
     */
    async obterFeedbacksModeracoes() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível obter feedbacks de moderações.');
            return [];
        }

        try {
            console.log('📚 Obtendo feedbacks de moderações do Google Sheets...');
            
            // Verificar cache primeiro
            const cacheKey = 'feedbacks_moderacoes';
            const cachedData = this.getFromCache(cacheKey);
            if (cachedData) {
                return cachedData;
            }
            
            // Verificar se googleSheetsConfig está inicializado
            console.log('🔍 DEBUG - Verificando googleSheetsConfig:', {
                existe: !!googleSheetsConfig,
                isInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
            });
            
            if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
                console.log('⚠️ googleSheetsConfig não está inicializado');
                return [];
            }
            
            // Rate limiting
            await this.waitForRateLimit();
            
            // Ler dados da planilha de moderações
            const range = 'Moderações!A1:Z1000';
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length <= 1) {
                console.log('📚 Nenhum feedback de moderação encontrado no Google Sheets');
                return [];
            }
            
            // Converter dados da planilha para array de objetos
            const headers = data[0];
            const feedbacks = [];
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row[0]) { // Se tem ID
                    const feedback = {};
                    headers.forEach((header, index) => {
                        if (row[index] !== undefined) {
                            feedback[header] = row[index];
                        }
                    });
                    // Filtrar apenas feedbacks (com texto de moderação anterior e feedback)
                    if (feedback['Texto Moderação Anterior'] && feedback['Feedback']) {
                        feedbacks.push(feedback);
                    }
                }
            }
            
            console.log(`✅ ${feedbacks.length} feedbacks de moderação obtidos do Google Sheets`);
            
            // Salvar no cache
            this.setCache(cacheKey, feedbacks);
            
            return feedbacks;
            
        } catch (error) {
            console.error('❌ Erro ao obter feedbacks de moderação do Google Sheets:', error.message);
            this.handleQuotaError(error);
            return [];
        }
    }

    /**
     * Obtém todas as moderações coerentes da planilha
     */
    async obterModeracoesCoerentes() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível obter moderações coerentes.');
            return [];
        }

        try {
            console.log('📚 Obtendo moderações coerentes do Google Sheets...');
            
            // Verificar cache primeiro
            const cacheKey = 'moderacoes_coerentes';
            const cachedData = this.getFromCache(cacheKey);
            if (cachedData) {
                return cachedData;
            }
            
            // Verificar se googleSheetsConfig está inicializado
            console.log('🔍 DEBUG - Verificando googleSheetsConfig:', {
                existe: !!googleSheetsConfig,
                isInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
            });
            
            if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
                console.log('⚠️ googleSheetsConfig não está inicializado');
                return [];
            }
            
            // Rate limiting
            await this.waitForRateLimit();
            
            // Ler dados da planilha de moderações
            const range = 'Moderações!A1:Z1000';
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length <= 1) {
                console.log('📚 Nenhuma moderação coerente encontrada no Google Sheets');
                return [];
            }
            
            // Converter dados da planilha para array de objetos
            const headers = data[0];
            const moderacoes = [];
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row[0]) { // Se tem ID
                    const moderacao = {};
                    headers.forEach((header, index) => {
                        if (row[index] !== undefined) {
                            moderacao[header] = row[index];
                        }
                    });
                    // Filtrar apenas moderações aprovadas (sem feedback)
                    if (moderacao['Status Aprovação'] === 'Aprovada' && !moderacao['Feedback']) {
                        moderacoes.push(moderacao);
                    }
                }
            }
            
            console.log(`✅ ${moderacoes.length} moderações coerentes obtidas do Google Sheets`);
            
            // Salvar no cache
            this.setCache(cacheKey, moderacoes);
            
            return moderacoes;
            
        } catch (error) {
            console.error('❌ Erro ao obter moderações coerentes do Google Sheets:', error.message);
            this.handleQuotaError(error);
            return [];
        }
    }

    /**
     * Obtém todos os feedbacks de respostas da planilha
     */
    async obterFeedbacksRespostas() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível obter feedbacks.');
            return [];
        }

        try {
            console.log('📚 Obtendo feedbacks de respostas do Google Sheets...');
            
            // Verificar cache primeiro
            const cacheKey = 'feedbacks_respostas';
            const cachedData = this.getFromCache(cacheKey);
            if (cachedData) {
                return cachedData;
            }
            
            // Verificar se googleSheetsConfig está inicializado
            console.log('🔍 DEBUG - Verificando googleSheetsConfig:', {
                existe: !!googleSheetsConfig,
                isInitialized: googleSheetsConfig ? googleSheetsConfig.isInitialized() : false
            });
            
            if (!googleSheetsConfig || !googleSheetsConfig.isInitialized()) {
                console.log('⚠️ googleSheetsConfig não está inicializado');
                return [];
            }
            
            // Rate limiting
            await this.waitForRateLimit();
            
            // Ler dados da planilha de feedbacks
            const range = 'Feedbacks!A1:Z1000';
            const data = await googleSheetsConfig.readData(range);
            
            if (!data || data.length <= 1) {
                console.log('📚 Nenhum feedback encontrado no Google Sheets');
                return [];
            }
            
            // Converter dados da planilha para array de objetos
            const headers = data[0];
            const feedbacks = [];
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row[0]) { // Se tem ID
                    const feedback = {};
                    headers.forEach((header, index) => {
                        if (row[index] !== undefined) {
                            feedback[header] = row[index];
                        }
                    });
                    feedbacks.push(feedback);
                }
            }
            
            console.log(`✅ ${feedbacks.length} feedbacks obtidos do Google Sheets`);
            
            // Salvar no cache
            this.setCache(cacheKey, feedbacks);
            
            return feedbacks;
            
        } catch (error) {
            console.error('❌ Erro ao obter feedbacks do Google Sheets:', error.message);
            this.handleQuotaError(error);
            return [];
        }
    }

    /**
     * Salva aprendizado no Google Sheets
     */
    async salvarAprendizado(aprendizado) {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Não é possível salvar aprendizado.');
            return false;
        }

        try {
            console.log('💾 Salvando aprendizado no Google Sheets...');
            
            // Garantir que a planilha de aprendizado existe
            await this.ensureSheetExists('Aprendizado', [
                'Tipo Situação',
                'Tipo Dados',
                'ID',
                'Timestamp',
                'Conteúdo JSON'
            ]);
            
            // Converter aprendizado para formato de planilha
            const rows = [];
            for (const [tipoSituacao, dados] of Object.entries(aprendizado.tiposSituacao)) {
                // Salvar feedbacks
                for (const feedback of dados.feedbacks || []) {
                    rows.push([
                        tipoSituacao,
                        'feedback',
                        feedback.id || Date.now(),
                        feedback.timestamp || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                        JSON.stringify(feedback)
                    ]);
                }
                
                // Salvar respostas coerentes
                for (const resposta of dados.respostasCoerentes || []) {
                    rows.push([
                        tipoSituacao,
                        'resposta_coerente',
                        resposta.id || Date.now(),
                        resposta.timestamp || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                        JSON.stringify(resposta)
                    ]);
                }
                
                // Salvar padrões identificados
                for (const padrao of dados.padroesIdentificados || []) {
                    rows.push([
                        tipoSituacao,
                        'padrao',
                        Date.now(),
                        new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                        padrao
                    ]);
                }
            }
            
            if (rows.length > 0) {
                // Limpar planilha existente
                await googleSheetsConfig.clearSheet('Aprendizado');
                
                // Adicionar cabeçalhos
                await googleSheetsConfig.appendRow('Aprendizado!A1:E1', [
                    'Tipo Situação',
                    'Tipo Dados',
                    'ID',
                    'Timestamp',
                    'Conteúdo JSON'
                ]);
                
                // Adicionar dados
                for (const row of rows) {
                    await googleSheetsConfig.appendRow('Aprendizado!A:E', row);
                }
                
                console.log(`✅ Aprendizado salvo no Google Sheets: ${rows.length} registros`);
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao salvar aprendizado no Google Sheets:', error.message);
            return false;
        }
    }

    /**
     * Sincroniza dados existentes com o Google Sheets
     */
    async sincronizarDadosExistentes() {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Sincronização não realizada.');
            return false;
        }

        try {
            console.log('🔄 Iniciando sincronização de dados existentes...');
            
            // Verificar se estamos na Vercel (sem sistema de arquivos)
            if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
                console.log('⚠️ Sincronização desabilitada na Vercel (sem sistema de arquivos)');
                return false;
            }

            // Sincronizar feedbacks
            const feedbacksPath = './data/feedbacks.json';
            if (fs.existsSync(feedbacksPath)) {
                const feedbacks = JSON.parse(fs.readFileSync(feedbacksPath, 'utf8'));
                for (const feedback of feedbacks.respostas || []) {
                    await this.registrarFeedback(feedback);
                }
                for (const moderacao of feedbacks.moderacoes || []) {
                    await this.registrarFeedback(moderacao);
                }
            }

            // Sincronizar respostas coerentes
            const respostasPath = './data/feedbacks_respostas.json';
            if (fs.existsSync(respostasPath)) {
                const respostas = JSON.parse(fs.readFileSync(respostasPath, 'utf8'));
                for (const resposta of respostas.respostas || []) {
                    await this.registrarRespostaCoerente(resposta);
                }
            }

            // Sincronizar estatísticas
            const estatisticasPath = './data/estatisticas_globais.json';
            if (fs.existsSync(estatisticasPath)) {
                const estatisticas = JSON.parse(fs.readFileSync(estatisticasPath, 'utf8'));
                await this.registrarEstatisticas(estatisticas.estatisticas);
            }

            console.log('✅ Sincronização de dados existentes concluída');
            return true;

        } catch (error) {
            console.error('❌ Erro na sincronização de dados:', error.message);
            return false;
        }
    }
}

// Instância singleton
const googleSheetsIntegration = new GoogleSheetsIntegration();

module.exports = googleSheetsIntegration;
