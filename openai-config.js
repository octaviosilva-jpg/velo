// ===== CONFIGURAÇÃO SEGURA DA API OPENAI =====

class OpenAIConfig {
    constructor() {
        this.apiKey = null;
        this.baseURL = 'https://api.openai.com/v1';
        this.model = 'gpt-4o';
        this.maxTokens = 2000;
        this.temperature = 0.7;
        this.isConfigured = false;
        this.securityLevel = 'high';
        this.lastApiCall = null;
        this.apiCallCount = 0;
        this.maxCallsPerHour = 100;
    }

    // Configurar a chave da API de forma segura (apenas via .env)
    setApiKey(apiKey) {
        console.warn('⚠️ Configuração da API deve ser feita apenas via arquivo .env');
        throw new Error('Configuração da API deve ser feita via arquivo .env. Edite o arquivo .env e reinicie o servidor.');
    }

    // Carregar chave salva de forma segura
    loadApiKey() {
        try {
            console.log('🔧 Iniciando carregamento da chave da API...');
            console.log('🔍 getSimpleApiKey disponível?', typeof getSimpleApiKey);
            
            // Primeiro, tentar carregar do arquivo .env (se a função estiver disponível)
            if (typeof getSimpleApiKey === 'function') {
                console.log('🔍 Chamando getSimpleApiKey()...');
                const envApiKey = getSimpleApiKey();
                console.log('🔍 Chave retornada:', envApiKey ? envApiKey.substring(0, 20) + '...' : 'null');
                
                if (envApiKey && envApiKey !== 'sk-your-api-key-here') {
                    this.apiKey = envApiKey;
                    this.isConfigured = true;
                    console.log('✅ Chave da API OpenAI carregada do arquivo .env');
                    return true;
                } else if (envApiKey === 'sk-your-api-key-here') {
                    console.log('⚠️ Chave da API é placeholder, precisa ser substituída por uma chave real');
                } else {
                    console.log('❌ Chave da API não encontrada ou inválida');
                }
            } else {
                console.log('ℹ️ Sistema simples não inicializado ainda, tentando localStorage...');
            }
            
            // Se não encontrar no .env, tentar do localStorage
            const savedKey = localStorage.getItem('openai_api_key');
            if (savedKey && savedKey !== 'sk-your-api-key-here') {
                this.apiKey = savedKey;
                this.isConfigured = true;
                console.log('✅ Chave da API OpenAI carregada do localStorage');
                return true;
            }
            
            console.log('ℹ️ Nenhuma chave da API válida encontrada');
            return false;
        } catch (error) {
            console.error('❌ Erro ao carregar chave da API:', error);
            return false;
        }
    }

    // Verificar se está configurado
    isApiConfigured() {
        return this.isConfigured && this.apiKey !== null;
    }

    // Recarregar chave da API (útil após inicialização do sistema simples)
    reloadApiKey() {
        console.log('🔄 Recarregando chave da API...');
        return this.loadApiKey();
    }

    // Fazer requisição para a API com validações de segurança
    async makeRequest(messages, options = {}) {
        if (!this.isApiConfigured()) {
            throw new Error('API OpenAI não configurada. Configure a chave da API primeiro.');
        }

        // Validar limite de chamadas por hora
        if (!this.validateApiCallLimit()) {
            throw new Error('Limite de chamadas à API excedido. Tente novamente em uma hora.');
        }

        // Validar mensagens
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error('Mensagens inválidas para a API');
        }

        // Validar opções
        const temperature = options.temperature || this.temperature;
        if (temperature < 0 || temperature > 1) {
            throw new Error('Temperature deve estar entre 0 e 1');
        }

        const maxTokens = options.maxTokens || this.maxTokens;
        if (maxTokens < 1 || maxTokens > 4000) {
            throw new Error('Max tokens deve estar entre 1 e 4000');
        }

        const requestBody = {
            model: options.model || this.model,
            messages: messages,
            max_tokens: maxTokens,
            temperature: temperature,
            stream: false
        };

        // Atualizar contador de chamadas
        this.updateApiCallCount();

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Erro da API: ${errorData.error?.message || 'Erro desconhecido'}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('Erro na requisição para OpenAI:', error);
            throw error;
        }
    }

    // Limpar configuração de forma segura
    clearConfig() {
        this.apiKey = null;
        this.isConfigured = false;
        
        // Limpar do localStorage
        localStorage.removeItem('openai_api_key');
        
        // Limpar contadores
        this.apiCallCount = 0;
        this.lastApiCall = null;
        
        console.log('🗑️ Configuração da API OpenAI removida com segurança');
    }

    // Validar limite de chamadas à API
    validateApiCallLimit() {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000; // 1 hora em milissegundos
        
        // Resetar contador se passou uma hora
        if (this.lastApiCall && (now - this.lastApiCall) > oneHour) {
            this.apiCallCount = 0;
        }
        
        // Verificar se excedeu o limite
        if (this.apiCallCount >= this.maxCallsPerHour) {
            console.warn('⚠️ Limite de chamadas à API excedido');
            return false;
        }
        
        return true;
    }

    // Atualizar contador de chamadas
    updateApiCallCount() {
        this.apiCallCount++;
        this.lastApiCall = Date.now();
        
        console.log(`📊 Chamadas à API: ${this.apiCallCount}/${this.maxCallsPerHour}`);
    }

    // Obter estatísticas de uso
    getUsageStats() {
        return {
            callsThisHour: this.apiCallCount,
            maxCallsPerHour: this.maxCallsPerHour,
            lastCall: this.lastApiCall,
            isConfigured: this.isConfigured,
            securityLevel: this.securityLevel
        };
    }

    // Validar configuração de segurança
    validateSecurityConfig() {
        const issues = [];
        
        if (!this.apiKey) {
            issues.push('Chave da API não configurada');
        }
        
        if (this.maxCallsPerHour > 1000) {
            issues.push('Limite de chamadas muito alto');
        }
        
        if (this.temperature > 0.9) {
            issues.push('Temperature muito alta pode gerar respostas inconsistentes');
        }
        
        if (issues.length > 0) {
            console.warn('⚠️ Problemas de segurança detectados:', issues);
            return false;
        }
        
        console.log('✅ Configuração de segurança validada');
        return true;
    }
}

// Instância global
const openaiConfig = new OpenAIConfig();

// Inicializar automaticamente quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔧 Inicializando OpenAIConfig...');
    
    // Aguardar um pouco para o sistema simples estar disponível
    setTimeout(async () => {
        try {
            const loaded = await openaiConfig.loadApiKey();
            if (loaded) {
                console.log('✅ OpenAIConfig inicializado com sucesso');
            } else {
                console.log('⚠️ OpenAIConfig não pôde carregar a chave da API');
            }
        } catch (error) {
            console.error('❌ Erro ao inicializar OpenAIConfig:', error);
        }
    }, 1000);
});

// ===== PROMPTS E BASE DE CONHECIMENTO =====

class KnowledgeBase {
    constructor() {
        this.systemPrompts = {
            // Prompt principal para respostas do Reclame Aqui
            raResponse: `Você é um assistente especializado em atendimento ao cliente para a empresa Velotax, especializada em serviços financeiros e de crédito.

CONTEXTO DA EMPRESA:
- Velotax é uma empresa de serviços financeiros
- Oferece empréstimos, crédito pessoal, crédito do trabalhador
- Trabalha com restituições, FGTS, e serviços bancários
- Possui parceria com Celcoin para serviços financeiros
- Oferece chave Pix e serviços de portabilidade

ESTILO DE RESPOSTA OBRIGATÓRIO:
- Tom profissional, empático e respeitoso
- Linguagem clara e acessível
- Foco na solução e no cliente
- Sempre agradecer o contato
- Demonstrar preocupação genuína
- Oferecer canais de atendimento
- Ser específico sobre prazos e procedimentos

ESTRUTURA DA RESPOSTA:
1. Agradecimento inicial
2. Reconhecimento da situação
3. Explicação clara da solução
4. Próximos passos ou orientações
5. Disponibilidade para esclarecimentos
6. Assinatura da equipe

IMPORTANTE: 
- Sempre entregue o texto final pronto para publicação
- Nunca entregue apenas estrutura ou instruções
- Formule respostas completas e personalizadas
- Baseie-se nas informações específicas fornecidas
- Mantenha o tom profissional da Velotax`,

            // Prompt para moderação do Reclame Aqui
            moderation: `Você é um especialista em moderação de conteúdo para o Reclame Aqui, com foco em bancos e instituições financeiras.

BASE DE CONHECIMENTO - REGRAS DE MODERAÇÃO:

REGRAS GERAIS:
- Manter qualidade, seriedade e veracidade das informações
- Liberdade de expressão respeitando limites legais
- Estado neutro e imparcial
- Proteção de dados pessoais (LGPD)
- Combate a fake news e desinformação

CRITÉRIOS DE MODERAÇÃO:
1. Conteúdo de outra empresa (não relacionado à Velotax)
2. Reclamações trabalhistas (não são de responsabilidade da empresa)
3. Conteúdo impróprio, ofensivo ou discriminatório
4. Reclamações duplicadas
5. Reclamações de terceiros (não do próprio cliente)
6. Casos de fraude comprovada
7. Empresa não violou direitos do consumidor

ESTRUTURA DA SOLICITAÇÃO:
1. Identificação clara do problema
2. Justificativa baseada nas regras
3. Evidências ou argumentos
4. Solicitação formal de moderação
5. Tom respeitoso e profissional

IMPORTANTE:
- Analise cuidadosamente cada caso
- Baseie-se nas regras oficiais do Reclame Aqui
- Seja específico sobre o motivo da moderação
- Mantenha tom profissional e imparcial`,

            // Prompt para explicações
            explanations: `Você é um especialista em atendimento ao cliente da Velotax, responsável por fornecer explicações claras sobre produtos e serviços.

PRODUTOS E SERVIÇOS VELOTAX:

1. CRÉDITO DO TRABALHADOR:
- Linha de crédito consignado
- Parcelas descontadas do salário
- Valor liberado via Pix (CPF)
- Idade: 18-62 anos (homens) / 18-65 anos (mulheres)
- CLT há pelo menos 12 meses
- Empresa com CNPJ ativo há 36+ meses

2. CRÉDITO PESSOAL:
- Análise baseada em Open Finance
- Faixa etária: 18-75 anos
- Liberação em até 30 minutos
- Chave Pix obrigatoriamente CPF
- Pagamento via Pix ou cartão

3. RESTITUIÇÃO:
- Processamento de restituições
- Consulta de malha fina
- Regularização de pendências

4. PORTABILIDADE PIX:
- Transferência de chave Pix entre instituições
- Processo via app Velotax
- Autorização necessária

ESTILO DE EXPLICAÇÃO:
- Linguagem clara e didática
- Explicação passo a passo
- Foco na praticidade
- Exemplos quando necessário
- Tom amigável e profissional`
        };
    }

    // Obter prompt do sistema
    getSystemPrompt(type) {
        return this.systemPrompts[type] || this.systemPrompts.raResponse;
    }

    // Construir mensagens para a API
    buildMessages(type, userInput, context = {}) {
        const systemPrompt = this.getSystemPrompt(type);
        const messages = [
            {
                role: "system",
                content: systemPrompt
            }
        ];

        // Adicionar contexto específico se fornecido
        if (context.additionalInfo) {
            messages.push({
                role: "system",
                content: `INFORMAÇÕES ADICIONAIS DO CONTEXTO:\n${context.additionalInfo}`
            });
        }

        // Adicionar entrada do usuário
        messages.push({
            role: "user",
            content: userInput
        });

        return messages;
    }
}

// Instância global da base de conhecimento
const knowledgeBase = new KnowledgeBase();

// ===== FUNÇÕES DE INTEGRAÇÃO =====

// Função para gerar resposta do Reclame Aqui via API
async function gerarRespostaRAViaAPI(dadosFormulario) {
    try {
        console.log('🔄 Enviando solicitação de resposta RA para o servidor...');
        
        const response = await fetch('/api/generate-response', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dadosFormulario: dadosFormulario
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro na requisição');
        }
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Resposta RA gerada com sucesso via servidor');
            return data.result;
        } else {
            throw new Error(data.error || 'Erro ao gerar resposta RA');
        }
    } catch (error) {
        console.error('Erro ao gerar resposta RA via API:', error);
        throw error;
    }
}

// Função para gerar moderação via API (usando servidor como proxy)
async function gerarModeracaoViaAPI(dadosModeracao) {
    try {
        console.log('🔄 Enviando solicitação de moderação para o servidor...');
        
        const response = await fetch('/api/generate-moderation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dadosModeracao: dadosModeracao
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro na requisição');
        }
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Moderação gerada com sucesso via servidor');
            return data.result;
        } else {
            throw new Error(data.error || 'Erro ao gerar moderação');
        }
    } catch (error) {
        console.error('Erro ao gerar moderação via API:', error);
        throw error;
    }
}

// Função para gerar explicação via API
async function gerarExplicacaoViaAPI(tema, contexto = '') {
    try {
        const prompt = `
TEMA SOLICITADO: ${tema}

${contexto ? `CONTEXTO ADICIONAL: ${contexto}` : ''}

INSTRUÇÕES:
Forneça uma explicação completa e clara sobre o tema solicitado. A explicação deve:
1. Ser didática e fácil de entender
2. Incluir informações práticas
3. Explicar procedimentos passo a passo quando aplicável
4. Manter tom profissional e amigável
5. Ser específica para os serviços da Velotax

Formule uma explicação detalhada e útil.`;

        const messages = knowledgeBase.buildMessages('explanations', prompt);
        const explicacao = await openaiConfig.makeRequest(messages);
        
        return explicacao;
    } catch (error) {
        console.error('Erro ao gerar explicação via API:', error);
        throw error;
    }
}

// Exportar para uso global
window.openaiConfig = openaiConfig;
window.knowledgeBase = knowledgeBase;
window.gerarRespostaRAViaAPI = gerarRespostaRAViaAPI;
window.gerarModeracaoViaAPI = gerarModeracaoViaAPI;
window.gerarExplicacaoViaAPI = gerarExplicacaoViaAPI;
