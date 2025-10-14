/**
 * Sistema de Fila Robusta para Google Sheets
 * 
 * Este módulo implementa uma fila robusta com retry automático,
 * rate limiting inteligente e recuperação de falhas.
 */

class GoogleSheetsQueueRobust {
    constructor(googleSheetsIntegration, monitor) {
        this.integration = googleSheetsIntegration;
        this.monitor = monitor;
        this.queue = [];
        this.isProcessing = false;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 segundos
        this.maxQueueSize = 100;
        this.processingInterval = 2000; // 2 segundos
        
        // Configurações de rate limiting dinâmico
        this.baseDelay = 1000; // 1 segundo base
        this.currentDelay = this.baseDelay;
        this.maxDelay = 30000; // 30 segundos máximo
        this.delayMultiplier = 1.5;
        
        // Estatísticas
        this.stats = {
            totalQueued: 0,
            totalProcessed: 0,
            totalFailed: 0,
            totalRetried: 0,
            averageProcessingTime: 0
        };
        
        console.log('🔄 Google Sheets Queue Robusta inicializada');
    }

    /**
     * Adiciona operação à fila
     */
    async enqueue(operation) {
        if (this.queue.length >= this.maxQueueSize) {
            console.log('⚠️ Fila cheia - removendo operação mais antiga');
            this.queue.shift();
        }

        const queueItem = {
            id: Date.now() + Math.random(),
            operation: operation.type,
            data: operation.data,
            retries: 0,
            createdAt: new Date(),
            priority: operation.priority || 'normal'
        };

        this.queue.push(queueItem);
        this.stats.totalQueued++;
        
        console.log(`📝 Operação ${operation.type} adicionada à fila (posição: ${this.queue.length})`);
        
        // Iniciar processamento se não estiver ativo
        if (!this.isProcessing) {
            this.startProcessing();
        }
        
        return queueItem.id;
    }

    /**
     * Inicia o processamento da fila
     */
    startProcessing() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        console.log('🚀 Iniciando processamento da fila do Google Sheets...');
        
        this.processQueue();
    }

    /**
     * Para o processamento da fila
     */
    stopProcessing() {
        this.isProcessing = false;
        console.log('⏹️ Processamento da fila parado');
    }

    /**
     * Processa a fila
     */
    async processQueue() {
        while (this.isProcessing && this.queue.length > 0) {
            try {
                // Ordenar por prioridade
                this.queue.sort((a, b) => {
                    const priorityOrder = { high: 3, normal: 2, low: 1 };
                    return priorityOrder[b.priority] - priorityOrder[a.priority];
                });

                const item = this.queue.shift();
                if (!item) continue;

                console.log(`🔄 Processando operação ${item.operation} (tentativa ${item.retries + 1})`);
                
                const startTime = Date.now();
                const success = await this.processItem(item);
                const processingTime = Date.now() - startTime;
                
                this.updateStats(processingTime);
                
                if (success) {
                    console.log(`✅ Operação ${item.operation} processada com sucesso`);
                    this.monitor.recordSuccess(item.operation);
                } else {
                    console.log(`❌ Operação ${item.operation} falhou`);
                    await this.handleFailedItem(item);
                }

                // Aguardar antes da próxima operação
                await this.waitForNextOperation();

            } catch (error) {
                console.error('❌ Erro durante processamento da fila:', error.message);
                await this.waitForNextOperation();
            }
        }

        if (this.queue.length === 0) {
            console.log('✅ Fila vazia - processamento pausado');
            this.isProcessing = false;
        } else {
            // Continuar processamento após intervalo
            setTimeout(() => this.processQueue(), this.processingInterval);
        }
    }

    /**
     * Processa um item da fila
     */
    async processItem(item) {
        try {
            switch (item.operation) {
                case 'registrarFeedback':
                    return await this.integration.registrarFeedback(item.data);
                
                case 'registrarRespostaCoerente':
                    return await this.integration.registrarRespostaCoerente(item.data);
                
                case 'registrarFeedbackModeracao':
                    return await this.integration.registrarFeedbackModeracao(item.data);
                
                case 'registrarModeracaoCoerente':
                    return await this.integration.registrarModeracaoCoerente(item.data);
                
                case 'registrarAcessoInterface':
                    return await this.integration.registrarAcessoInterface(item.data);
                
                case 'registrarEstatisticas':
                    return await this.integration.registrarEstatisticas(item.data);
                
                default:
                    console.log(`⚠️ Tipo de operação desconhecido: ${item.operation}`);
                    return false;
            }
        } catch (error) {
            console.error(`❌ Erro ao processar operação ${item.operation}:`, error.message);
            this.monitor.recordError(item.operation, error);
            return false;
        }
    }

    /**
     * Trata item que falhou
     */
    async handleFailedItem(item) {
        item.retries++;
        this.stats.totalRetried++;

        if (item.retries < this.maxRetries) {
            console.log(`🔄 Reagendando operação ${item.operation} (tentativa ${item.retries + 1})`);
            
            // Aumentar delay para próxima tentativa
            const retryDelay = this.retryDelay * Math.pow(2, item.retries - 1);
            item.retryAfter = new Date(Date.now() + retryDelay);
            
            // Recolocar na fila
            this.queue.unshift(item);
            
            // Aguardar antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
        } else {
            console.log(`❌ Operação ${item.operation} falhou após ${this.maxRetries} tentativas - descartando`);
            this.stats.totalFailed++;
            this.monitor.recordError(item.operation, new Error('Máximo de tentativas excedido'));
        }
    }

    /**
     * Aguarda antes da próxima operação
     */
    async waitForNextOperation() {
        // Verificar se há problemas de quota
        if (this.monitor && !this.monitor.isHealthy) {
            console.log('⏳ Aguardando recuperação do sistema...');
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 segundos
            return;
        }

        // Rate limiting dinâmico
        await new Promise(resolve => setTimeout(resolve, this.currentDelay));
    }

    /**
     * Ajusta delay baseado no sucesso/falha
     */
    adjustDelay(success) {
        if (success) {
            // Diminuir delay se sucesso
            this.currentDelay = Math.max(this.baseDelay, this.currentDelay / this.delayMultiplier);
        } else {
            // Aumentar delay se falha
            this.currentDelay = Math.min(this.maxDelay, this.currentDelay * this.delayMultiplier);
        }
        
        console.log(`⏱️ Delay ajustado para: ${this.currentDelay}ms`);
    }

    /**
     * Atualiza estatísticas
     */
    updateStats(processingTime) {
        this.stats.totalProcessed++;
        
        // Calcular tempo médio de processamento
        const totalTime = this.stats.averageProcessingTime * (this.stats.totalProcessed - 1) + processingTime;
        this.stats.averageProcessingTime = totalTime / this.stats.totalProcessed;
    }

    /**
     * Obtém status da fila
     */
    getQueueStatus() {
        return {
            isProcessing: this.isProcessing,
            queueLength: this.queue.length,
            currentDelay: this.currentDelay,
            stats: this.stats,
            nextItems: this.queue.slice(0, 5).map(item => ({
                operation: item.operation,
                retries: item.retries,
                createdAt: item.createdAt,
                priority: item.priority
            }))
        };
    }

    /**
     * Limpa a fila
     */
    clearQueue() {
        const clearedCount = this.queue.length;
        this.queue = [];
        console.log(`🧹 Fila limpa - ${clearedCount} itens removidos`);
    }

    /**
     * Pausa o processamento
     */
    pauseProcessing() {
        this.isProcessing = false;
        console.log('⏸️ Processamento da fila pausado');
    }

    /**
     * Resume o processamento
     */
    resumeProcessing() {
        if (this.queue.length > 0) {
            this.startProcessing();
        }
    }

    /**
     * Obtém relatório da fila
     */
    getQueueReport() {
        const successRate = this.stats.totalQueued > 0 
            ? (this.stats.totalProcessed / this.stats.totalQueued) * 100 
            : 0;

        return {
            timestamp: new Date().toISOString(),
            status: this.isProcessing ? 'PROCESSING' : 'IDLE',
            queue: {
                length: this.queue.length,
                maxSize: this.maxQueueSize
            },
            performance: {
                successRate: Math.round(successRate * 100) / 100,
                averageProcessingTime: Math.round(this.stats.averageProcessingTime),
                currentDelay: this.currentDelay
            },
            stats: this.stats,
            nextOperations: this.queue.slice(0, 3).map(item => ({
                operation: item.operation,
                retries: item.retries,
                age: Math.round((Date.now() - item.createdAt.getTime()) / 1000) + 's'
            }))
        };
    }
}

module.exports = GoogleSheetsQueueRobust;
