// ===== CARREGADOR SIMPLES DE VARIÁVEIS DE AMBIENTE =====

class SimpleEnvLoader {
    constructor() {
        this.envVars = {};
        this.isLoaded = false;
    }

    // Carregar variáveis de ambiente do arquivo .env
    async loadEnvFile() {
        try {
            console.log('🔐 Carregando configurações do arquivo .env...');
            
            // Tentar carregar via backend primeiro
            try {
                const response = await fetch('/api/config/public');
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.envVars = data.config;
                        this.isLoaded = true;
                        console.log('✅ Configurações carregadas via backend');
                        console.log('📋 Configurações do backend:', Object.keys(this.envVars));
                        return true;
                    }
                }
            } catch (backendError) {
                console.log('⚠️ Backend não disponível, tentando carregar localmente...');
            }
            
            // Fallback: tentar carregar configurações do servidor
            console.log('📁 Tentando carregar configurações do servidor...');
            const response = await fetch('/api/config/public');
            if (!response.ok) {
                throw new Error(`Erro ao carregar configurações: ${response.status}`);
            }
            
            const configData = await response.json();
            console.log('📄 Configurações carregadas do servidor:', configData);
            
            // Converter para formato de variáveis de ambiente
            this.envVars = configData;
            console.log('📋 Variáveis carregadas:', Object.keys(this.envVars));
            
            // Validar configurações críticas
            this.validateCriticalConfigs();
            
            this.isLoaded = true;
            console.log('✅ Configurações carregadas com sucesso');
            
            return true;
        } catch (error) {
            console.error('❌ Erro ao carregar .env:', error);
            this.handleLoadError(error);
            return false;
        }
    }

    // Parsear conteúdo do arquivo .env
    parseEnvContent(content) {
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Ignorar comentários e linhas vazias
            if (trimmedLine.startsWith('#') || trimmedLine === '') {
                continue;
            }
            
            // Parsear variável=valor
            const equalIndex = trimmedLine.indexOf('=');
            if (equalIndex === -1) {
                continue;
            }
            
            const key = trimmedLine.substring(0, equalIndex).trim();
            const value = trimmedLine.substring(equalIndex + 1).trim();
            
            // Remover aspas se existirem
            const cleanValue = value.replace(/^["']|["']$/g, '');
            
            this.envVars[key] = cleanValue;
            
            // Log especial para a chave da API
            if (key === 'OPENAI_API_KEY') {
                console.log(`🔑 Chave da API carregada: ${cleanValue ? cleanValue.substring(0, 20) + '...' : 'VAZIA'}`);
            }
        }
        
        console.log(`📋 ${Object.keys(this.envVars).length} variáveis carregadas`);
        console.log('📋 Variáveis carregadas:', Object.keys(this.envVars));
    }

    // Validar configurações críticas
    validateCriticalConfigs() {
        const criticalVars = [
            'OPENAI_MODEL',
            'OPENAI_TEMPERATURE',
            'OPENAI_MAX_TOKENS'
        ];
        
        for (const varName of criticalVars) {
            if (!this.envVars[varName]) {
                console.warn(`⚠️ Variável crítica ausente: ${varName}`);
            }
        }
        
        // Validar tipos de dados
        const temperature = parseFloat(this.envVars.OPENAI_TEMPERATURE);
        if (isNaN(temperature) || temperature < 0 || temperature > 1) {
            console.warn('⚠️ OPENAI_TEMPERATURE deve ser um número entre 0 e 1');
        }
        
        const maxTokens = parseInt(this.envVars.OPENAI_MAX_TOKENS);
        if (isNaN(maxTokens) || maxTokens < 100 || maxTokens > 4000) {
            console.warn('⚠️ OPENAI_MAX_TOKENS deve ser um número entre 100 e 4000');
        }
        
        console.log('✅ Validação de configurações concluída');
    }

    // Obter variável de ambiente
    get(key, defaultValue = null) {
        if (!this.isLoaded) {
            console.warn('⚠️ Variáveis de ambiente não carregadas ainda');
            return defaultValue;
        }
        
        const value = this.envVars[key] || defaultValue;
        console.log(`🔍 Buscando ${key}: ${value ? 'encontrado' : 'não encontrado'}`);
        return value;
    }

    // Obter chave da API
    getApiKey() {
        console.log('🔍 Buscando chave da API...');
        console.log('🔍 Variáveis disponíveis:', Object.keys(this.envVars));
        const apiKey = this.get('OPENAI_API_KEY');
        
        if (!apiKey) {
            console.log('❌ Chave da API não encontrada no .env');
            console.log('🔍 Valor retornado:', apiKey);
            return null;
        }
        
        console.log('✅ Chave da API encontrada:', apiKey.substring(0, 20) + '...');
        
        // Validar formato da chave
        if (!apiKey.startsWith('sk-')) {
            console.warn('⚠️ Formato de chave API suspeito');
            return null;
        }
        
        console.log('✅ Chave da API validada com sucesso');
        return apiKey;
    }

    // Verificar se API está configurada
    isApiConfigured() {
        return this.getApiKey() !== null;
    }

    // Tratar erro de carregamento
    handleLoadError(error) {
        console.error('Erro no carregamento de configurações:', error);
        
        // Usar configurações padrão em caso de erro
        this.envVars = {
            OPENAI_MODEL: 'gpt-4o',
            OPENAI_TEMPERATURE: '0.7',
            OPENAI_MAX_TOKENS: '2000',
            OPENAI_BASE_URL: 'https://api.openai.com/v1',
            SESSION_TIMEOUT: '3600000',
            MAX_API_CALLS_PER_HOUR: '100',
            APP_NAME: 'Velotax Bot',
            APP_VERSION: '2.0.0',
            DEBUG_MODE: 'false',
            LOG_LEVEL: 'info'
        };
        
        this.isLoaded = true;
        console.log('🔄 Usando configurações padrão');
    }

    // Obter todas as configurações (sem dados sensíveis)
    getPublicConfig() {
        const publicConfig = { ...this.envVars };
        
        // Remover dados sensíveis
        delete publicConfig.OPENAI_API_KEY;
        
        return publicConfig;
    }

    // Verificar integridade das configurações
    checkIntegrity() {
        const requiredVars = [
            'OPENAI_MODEL',
            'OPENAI_TEMPERATURE',
            'OPENAI_MAX_TOKENS',
            'OPENAI_BASE_URL'
        ];
        
        console.log('🔍 Verificando integridade das configurações...');
        console.log('📋 Variáveis disponíveis:', Object.keys(this.envVars));
        
        const missing = requiredVars.filter(varName => !this.envVars[varName]);
        
        if (missing.length > 0) {
            console.error('❌ Variáveis obrigatórias ausentes:', missing);
            return false;
        }
        
        console.log('✅ Integridade das configurações verificada');
        return true;
    }
}

// ===== INSTÂNCIA GLOBAL =====
const simpleEnvLoader = new SimpleEnvLoader();

// ===== FUNÇÕES GLOBAIS =====

// Inicializar sistema simples
async function initializeSimpleSystem() {
    try {
        console.log('🚀 Inicializando sistema simples...');
        
        // Carregar variáveis de ambiente
        const envLoaded = await simpleEnvLoader.loadEnvFile();
        if (!envLoaded) {
            console.warn('⚠️ Usando configurações padrão');
        }
        
        // Verificar integridade
        const integrityOk = simpleEnvLoader.checkIntegrity();
        if (!integrityOk) {
            console.warn('⚠️ Problemas de integridade detectados, mas continuando...');
        }
        
        console.log('✅ Sistema simples inicializado');
        return true;
        
    } catch (error) {
        console.error('❌ Erro na inicialização do sistema simples:', error);
        return false;
    }
}

// Obter configuração
function getSimpleConfig(key, defaultValue = null) {
    return simpleEnvLoader.get(key, defaultValue);
}

// Obter chave da API
function getSimpleApiKey() {
    return simpleEnvLoader.getApiKey();
}

// Verificar se API está configurada
function isSimpleApiConfigured() {
    return simpleEnvLoader.isApiConfigured();
}

// Exportar para uso global
window.simpleEnvLoader = simpleEnvLoader;
window.initializeSimpleSystem = initializeSimpleSystem;
window.getSimpleConfig = getSimpleConfig;
window.getSimpleApiKey = getSimpleApiKey;
window.isSimpleApiConfigured = isSimpleApiConfigured;
