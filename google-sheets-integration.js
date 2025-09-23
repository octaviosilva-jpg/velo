const googleSheetsConfig = require('./google-sheets-config');
const fs = require('fs');

class GoogleSheetsIntegration {
    constructor() {
        this.initialized = false;
        this.spreadsheetId = null;
    }

    /**
     * Inicializa a integração com Google Sheets
     */
    async initialize(envVars = null) {
        try {
            console.log('🔧 Inicializando integração com Google Sheets...');
            
            // Google Sheets habilitado para Vercel com Service Account
            
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
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Feedback não registrado.');
            return false;
        }

        try {
            const row = [
                new Date().toLocaleString('pt-BR'),
                feedbackData.id || '',
                feedbackData.tipo || 'feedback',
                feedbackData.textoCliente || feedbackData.dadosFormulario?.texto_cliente || '',
                feedbackData.respostaAnterior || '',
                feedbackData.feedback || '',
                feedbackData.respostaReformulada || '',
                feedbackData.dadosFormulario?.tipo_solicitacao || feedbackData.tipoSituacao || '',
                feedbackData.dadosFormulario?.motivo_solicitacao || '',
                feedbackData.dadosFormulario?.solucao_implementada || '',
                feedbackData.dadosFormulario?.historico_atendimento || '',
                feedbackData.dadosFormulario?.observacoes_internas || ''
            ];

            await googleSheetsConfig.appendRow('Feedbacks!A:Z', row);
            console.log('✅ Feedback registrado no Google Sheets');
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar feedback no Google Sheets:', error.message);
            return false;
        }
    }

    /**
     * Registra uma resposta coerente no Google Sheets
     */
    async registrarRespostaCoerente(respostaData) {
        if (!this.isActive()) {
            console.log('⚠️ Google Sheets não está ativo. Resposta não registrada.');
            return false;
        }

        try {
            const row = [
                new Date().toLocaleString('pt-BR'),
                respostaData.id || '',
                respostaData.tipo || 'resposta',
                respostaData.textoCliente || respostaData.dadosFormulario?.texto_cliente || '',
                respostaData.respostaAprovada || respostaData.respostaFinal || '',
                respostaData.dadosFormulario?.tipo_solicitacao || respostaData.tipoSituacao || '',
                respostaData.dadosFormulario?.motivo_solicitacao || respostaData.motivoSolicitacao || '',
                respostaData.dadosFormulario?.solucao_implementada || '',
                respostaData.dadosFormulario?.historico_atendimento || '',
                respostaData.dadosFormulario?.observacoes_internas || '',
                'Aprovada'
            ];

            await googleSheetsConfig.appendRow('Respostas Coerentes!A:Z', row);
            console.log('✅ Resposta coerente registrada no Google Sheets');
            return true;

        } catch (error) {
            console.error('❌ Erro ao registrar resposta coerente no Google Sheets:', error.message);
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
            const row = [
                new Date().toLocaleString('pt-BR'),
                acessoData.usuario || 'Anônimo',
                acessoData.acao || 'Acesso',
                acessoData.ip || '',
                acessoData.userAgent || '',
                acessoData.duracaoSessao || 0,
                acessoData.status || 'Sucesso'
            ];

            await googleSheetsConfig.appendRow('Acessos Interface!A:Z', row);
            console.log('✅ Acesso à interface registrado no Google Sheets');
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

            const row = [
                new Date().toLocaleDateString('pt-BR'),
                estatisticas.respostas_geradas || 0,
                estatisticas.respostas_coerentes || 0,
                estatisticas.moderacoes_geradas || 0,
                estatisticas.moderacoes_coerentes || 0,
                estatisticas.revisoes_texto || 0,
                estatisticas.explicacoes_geradas || 0
            ];

            await googleSheetsConfig.appendRow('Estatísticas!A:Z', row);
            console.log('✅ Estatísticas registradas no Google Sheets');
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
                lastUpdated: new Date().toLocaleString('pt-BR')
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
                        feedback.timestamp || new Date().toLocaleString('pt-BR'),
                        JSON.stringify(feedback)
                    ]);
                }
                
                // Salvar respostas coerentes
                for (const resposta of dados.respostasCoerentes || []) {
                    rows.push([
                        tipoSituacao,
                        'resposta_coerente',
                        resposta.id || Date.now(),
                        resposta.timestamp || new Date().toLocaleString('pt-BR'),
                        JSON.stringify(resposta)
                    ]);
                }
                
                // Salvar padrões identificados
                for (const padrao of dados.padroesIdentificados || []) {
                    rows.push([
                        tipoSituacao,
                        'padrao',
                        Date.now(),
                        new Date().toLocaleString('pt-BR'),
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
