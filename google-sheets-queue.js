/**
 * Sistema de Fila para Google Sheets
 * Evita exceder quotas do Google Sheets API
 */

class GoogleSheetsQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.minInterval = 2000; // 2 segundos entre requisições
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 segundos
    }

    /**
     * Adiciona item à fila
     */
    addToQueue(item) {
        console.log('📋 Adicionando item à fila do Google Sheets:', item.type);
        this.queue.push({
            ...item,
            id: Date.now() + Math.random(),
            retries: 0,
            addedAt: new Date()
        });
        
        // Inicia processamento se não estiver rodando
        if (!this.processing) {
            this.processQueue();
        }
    }

    /**
     * Processa a fila com rate limiting
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        console.log(`🔄 Processando fila do Google Sheets: ${this.queue.length} itens`);

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            
            try {
                // Rate limiting - aguarda intervalo mínimo
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.minInterval) {
                    const waitTime = this.minInterval - timeSinceLastRequest;
                    console.log(`⏳ Aguardando ${waitTime}ms para respeitar rate limit...`);
                    await this.sleep(waitTime);
                }

                // Processa o item
                await this.processItem(item);
                this.lastRequestTime = Date.now();
                
                console.log(`✅ Item processado com sucesso: ${item.type} (ID: ${item.id})`);

            } catch (error) {
                console.error(`❌ Erro ao processar item ${item.type} (ID: ${item.id}):`, error.message);
                
                // Retry logic
                if (item.retries < this.maxRetries) {
                    item.retries++;
                    console.log(`🔄 Tentativa ${item.retries}/${this.maxRetries} para item ${item.type}`);
                    
                    // Adiciona de volta à fila com delay
                    setTimeout(() => {
                        this.queue.unshift(item);
                    }, this.retryDelay * item.retries);
                } else {
                    console.error(`💥 Item ${item.type} falhou após ${this.maxRetries} tentativas`);
                }
            }
        }

        this.processing = false;
        console.log('✅ Fila do Google Sheets processada');
    }

    /**
     * Processa um item individual
     */
    async processItem(item) {
        // Usar a instância global se disponível, senão importar
        let googleSheetsIntegration;
        if (global.googleSheetsIntegration) {
            googleSheetsIntegration = global.googleSheetsIntegration;
        } else {
            googleSheetsIntegration = require('./google-sheets-integration');
        }
        
        // Verificar se está ativo
        if (!googleSheetsIntegration || !googleSheetsIntegration.isActive()) {
            throw new Error('Google Sheets não está ativo ou disponível');
        }
        
        switch (item.type) {
            case 'feedback':
                return await googleSheetsIntegration.registrarFeedback(item.data);
            
            case 'resposta_coerente':
                return await googleSheetsIntegration.registrarRespostaCoerente(item.data);
            
            case 'acesso':
                return await googleSheetsIntegration.registrarAcessoInterface(item.data);
            
            case 'estatistica':
                return await googleSheetsIntegration.registrarEstatisticas(item.data);
            
            default:
                throw new Error(`Tipo de item não suportado: ${item.type}`);
        }
    }

    /**
     * Utilitário para sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retorna status da fila
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            lastRequestTime: this.lastRequestTime,
            minInterval: this.minInterval
        };
    }

    /**
     * Limpa a fila (para emergências)
     */
    clearQueue() {
        console.log('🧹 Limpando fila do Google Sheets');
        this.queue = [];
        this.processing = false;
    }
}

// Instância singleton
const googleSheetsQueue = new GoogleSheetsQueue();

module.exports = googleSheetsQueue;
