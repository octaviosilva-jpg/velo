/**
 * Sistema de Fallback para Google Sheets
 * 
 * Este módulo implementa um sistema robusto que funciona tanto localmente
 * quanto na Vercel, com fallback automático para diferentes métodos de autenticação.
 */

const fs = require('fs');
const path = require('path');

class GoogleSheetsFallback {
    constructor() {
        this.credentials = null;
        this.spreadsheetId = null;
        this.method = null;
        this.initialized = false;
        
        console.log('🔧 Google Sheets Fallback inicializado');
    }

    /**
     * Inicializa o sistema de fallback
     */
    async initialize() {
        try {
            console.log('🔍 Iniciando sistema de fallback do Google Sheets...');
            
            // 1. Tentar variáveis de ambiente (Vercel)
            if (await this.tryEnvironmentVariables()) {
                console.log('✅ Usando variáveis de ambiente (Vercel)');
                return true;
            }
            
            // 2. Tentar arquivo de credenciais local
            if (await this.tryLocalCredentials()) {
                console.log('✅ Usando credenciais locais');
                return true;
            }
            
            // 3. Tentar arquivo .env local
            if (await this.tryLocalEnvFile()) {
                console.log('✅ Usando arquivo .env local');
                return true;
            }
            
            // 4. Tentar configuração mínima
            if (await this.tryMinimalConfig()) {
                console.log('✅ Usando configuração mínima');
                return true;
            }
            
            console.log('❌ Nenhum método de autenticação funcionou');
            return false;
            
        } catch (error) {
            console.error('❌ Erro no sistema de fallback:', error.message);
            return false;
        }
    }

    /**
     * Tenta usar variáveis de ambiente (método Vercel)
     */
    async tryEnvironmentVariables() {
        try {
            const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
            const privateKey = process.env.GOOGLE_PRIVATE_KEY;
            const projectId = process.env.GOOGLE_PROJECT_ID;
            const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
            
            if (serviceAccountEmail && privateKey && projectId && spreadsheetId) {
                this.credentials = {
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
                
                this.spreadsheetId = spreadsheetId;
                this.method = 'environment_variables';
                this.initialized = true;
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('⚠️ Erro ao tentar variáveis de ambiente:', error.message);
            return false;
        }
    }

    /**
     * Tenta usar arquivo de credenciais local
     */
    async tryLocalCredentials() {
        try {
            const credentialsPath = './google-sheets-credentials.json';
            const tokenPath = './google-sheets-token.json';
            const spreadsheetId = process.env.GOOGLE_SHEETS_ID || this.getSpreadsheetIdFromFile();
            
            if (fs.existsSync(credentialsPath) && spreadsheetId) {
                const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
                
                // Verificar se é Service Account ou OAuth2
                if (credentials.private_key) {
                    // Service Account
                    this.credentials = credentials;
                } else {
                    // OAuth2 - verificar se tem token
                    if (fs.existsSync(tokenPath)) {
                        this.credentials = credentials;
                        this.tokenPath = tokenPath;
                    } else {
                        console.log('⚠️ Arquivo de token não encontrado para OAuth2');
                        return false;
                    }
                }
                
                this.spreadsheetId = spreadsheetId;
                this.method = 'local_credentials';
                this.initialized = true;
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('⚠️ Erro ao tentar credenciais locais:', error.message);
            return false;
        }
    }

    /**
     * Tenta usar arquivo .env local
     */
    async tryLocalEnvFile() {
        try {
            const envPath = './.env';
            
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const envVars = this.parseEnvFile(envContent);
                
                if (envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL && 
                    envVars.GOOGLE_PRIVATE_KEY && 
                    envVars.GOOGLE_SHEETS_ID) {
                    
                    this.credentials = {
                        type: 'service_account',
                        project_id: envVars.GOOGLE_PROJECT_ID || 'velotax-bot',
                        private_key_id: envVars.GOOGLE_PRIVATE_KEY_ID || 'default',
                        private_key: envVars.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                        client_email: envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                        client_id: envVars.GOOGLE_CLIENT_ID || 'default',
                        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                        token_uri: 'https://oauth2.googleapis.com/token',
                        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL)}`
                    };
                    
                    this.spreadsheetId = envVars.GOOGLE_SHEETS_ID;
                    this.method = 'local_env_file';
                    this.initialized = true;
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.log('⚠️ Erro ao tentar arquivo .env local:', error.message);
            return false;
        }
    }

    /**
     * Tenta configuração mínima (para desenvolvimento)
     */
    async tryMinimalConfig() {
        try {
            // Verificar se existe pelo menos o ID da planilha
            const spreadsheetId = process.env.GOOGLE_SHEETS_ID || this.getSpreadsheetIdFromFile();
            
            if (spreadsheetId) {
                console.log('⚠️ Usando configuração mínima - apenas ID da planilha');
                console.log('📋 Para funcionalidade completa, configure as credenciais do Google Sheets');
                
                this.spreadsheetId = spreadsheetId;
                this.method = 'minimal_config';
                this.initialized = true;
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('⚠️ Erro ao tentar configuração mínima:', error.message);
            return false;
        }
    }

    /**
     * Obtém ID da planilha de arquivo de configuração
     */
    getSpreadsheetIdFromFile() {
        try {
            const configPath = './google-sheets-config.json';
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return config.spreadsheetId;
            }
        } catch (error) {
            console.log('⚠️ Erro ao ler arquivo de configuração:', error.message);
        }
        return null;
    }

    /**
     * Parse do arquivo .env
     */
    parseEnvFile(content) {
        const envVars = {};
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0) {
                    envVars[key.trim()] = valueParts.join('=').trim();
                }
            }
        }
        
        return envVars;
    }

    /**
     * Obtém as credenciais configuradas
     */
    getCredentials() {
        return this.credentials;
    }

    /**
     * Obtém o ID da planilha
     */
    getSpreadsheetId() {
        return this.spreadsheetId;
    }

    /**
     * Obtém o método de autenticação usado
     */
    getMethod() {
        return this.method;
    }

    /**
     * Verifica se está inicializado
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * Obtém informações de diagnóstico
     */
    getDiagnosticInfo() {
        return {
            initialized: this.initialized,
            method: this.method,
            hasCredentials: !!this.credentials,
            hasSpreadsheetId: !!this.spreadsheetId,
            credentialsType: this.credentials ? this.credentials.type : null,
            spreadsheetId: this.spreadsheetId ? this.spreadsheetId.substring(0, 10) + '...' : null
        };
    }

    /**
     * Cria arquivo de configuração de exemplo
     */
    createExampleConfig() {
        const exampleConfig = {
            spreadsheetId: "SEU_GOOGLE_SHEETS_ID_AQUI",
            serviceAccountEmail: "seu-service-account@projeto.iam.gserviceaccount.com",
            projectId: "seu-projeto-id"
        };
        
        const configPath = './google-sheets-config-example.json';
        fs.writeFileSync(configPath, JSON.stringify(exampleConfig, null, 2));
        console.log(`📋 Arquivo de exemplo criado: ${configPath}`);
        
        return configPath;
    }

    /**
     * Cria arquivo .env de exemplo
     */
    createExampleEnvFile() {
        const exampleEnv = `# Configurações do Google Sheets
GOOGLE_SHEETS_ID=SEU_GOOGLE_SHEETS_ID_AQUI
GOOGLE_SERVICE_ACCOUNT_EMAIL=SEU_SERVICE_ACCOUNT_EMAIL@PROJETO.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\nSUA_CHAVE_PRIVADA_AQUI\\n-----END PRIVATE KEY-----
GOOGLE_PROJECT_ID=SEU_PROJETO_ID_AQUI
ENABLE_GOOGLE_SHEETS=true

# Configurações adicionais
GOOGLE_CLIENT_ID=SEU_CLIENT_ID_AQUI
GOOGLE_CLIENT_SECRET=SEU_CLIENT_SECRET_AQUI
`;
        
        const envPath = './.env.example';
        fs.writeFileSync(envPath, exampleEnv);
        console.log(`📋 Arquivo .env de exemplo criado: ${envPath}`);
        
        return envPath;
    }
}

// Instância singleton
const googleSheetsFallback = new GoogleSheetsFallback();

module.exports = googleSheetsFallback;
