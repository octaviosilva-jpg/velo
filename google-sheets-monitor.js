/**
 * Sistema de Monitoramento e Recuperação Automática do Google Sheets
 * 
 * Este módulo monitora a saúde da integração com Google Sheets e implementa
 * recuperação automática quando problemas são detectados.
 */

class GoogleSheetsMonitor {
    constructor(googleSheetsIntegration) {
        this.integration = googleSheetsIntegration;
        this.healthCheckInterval = 5 * 60 * 1000; // 5 minutos
        this.recoveryAttempts = 0;
        this.maxRecoveryAttempts = 3;
        this.lastHealthCheck = null;
        this.isHealthy = true;
        this.healthCheckTimer = null;
        this.failedOperations = [];
        this.maxFailedOperations = 10;
        
        // Métricas de monitoramento
        this.metrics = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            quotaErrors: 0,
            timeoutErrors: 0,
            connectivityErrors: 0,
            lastError: null,
            lastSuccess: null
        };
        
        console.log('🔍 Google Sheets Monitor inicializado');
    }

    /**
     * Inicia o monitoramento automático
     */
    startMonitoring() {
        console.log('🚀 Iniciando monitoramento automático do Google Sheets...');
        
        // Verificação de saúde inicial
        this.performHealthCheck();
        
        // Configurar verificação periódica
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.healthCheckInterval);
        
        console.log(`✅ Monitoramento ativo (verificação a cada ${this.healthCheckInterval / 1000}s)`);
    }

    /**
     * Para o monitoramento
     */
    stopMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            console.log('⏹️ Monitoramento do Google Sheets parado');
        }
    }

    /**
     * Executa verificação de saúde
     */
    async performHealthCheck() {
        try {
            console.log('🔍 Executando verificação de saúde do Google Sheets...');
            
            if (!this.integration || !this.integration.isActive()) {
                console.log('⚠️ Google Sheets não está ativo - tentando recuperação...');
                await this.attemptRecovery();
                return;
            }

            // Verificar status da API
            const apiStatus = await this.integration.checkApiStatus();
            if (!apiStatus) {
                console.log('❌ API do Google Sheets não está respondendo - tentando recuperação...');
                await this.attemptRecovery();
                return;
            }

            // Verificar se há muitas operações falhadas recentemente
            const recentFailures = this.getRecentFailures();
            if (recentFailures.length > 5) {
                console.log(`⚠️ Muitas falhas recentes (${recentFailures.length}) - tentando recuperação...`);
                await this.attemptRecovery();
                return;
            }

            // Se chegou até aqui, está saudável
            this.isHealthy = true;
            this.recoveryAttempts = 0;
            this.lastHealthCheck = new Date();
            
            console.log('✅ Google Sheets está saudável');
            
        } catch (error) {
            console.error('❌ Erro durante verificação de saúde:', error.message);
            this.recordError('health_check', error);
            await this.attemptRecovery();
        }
    }

    /**
     * Tenta recuperar a integração
     */
    async attemptRecovery() {
        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
            console.log('❌ Máximo de tentativas de recuperação atingido');
            this.isHealthy = false;
            return false;
        }

        this.recoveryAttempts++;
        console.log(`🔄 Tentativa de recuperação ${this.recoveryAttempts}/${this.maxRecoveryAttempts}`);

        try {
            // Aguardar um pouco antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 5000 * this.recoveryAttempts));

            // Tentar reinicializar a integração
            const envVars = require('./server.js').loadEnvFile();
            const success = await this.integration.initialize(envVars);

            if (success) {
                console.log('✅ Recuperação bem-sucedida!');
                this.isHealthy = true;
                this.recoveryAttempts = 0;
                this.clearFailedOperations();
                return true;
            } else {
                console.log('❌ Recuperação falhou');
                return false;
            }

        } catch (error) {
            console.error('❌ Erro durante recuperação:', error.message);
            this.recordError('recovery', error);
            return false;
        }
    }

    /**
     * Registra uma operação bem-sucedida
     */
    recordSuccess(operation) {
        this.metrics.totalOperations++;
        this.metrics.successfulOperations++;
        this.metrics.lastSuccess = new Date();
        
        // Remover operações falhadas relacionadas
        this.failedOperations = this.failedOperations.filter(
            op => op.operation !== operation
        );
        
        console.log(`✅ Operação ${operation} registrada com sucesso`);
    }

    /**
     * Registra uma operação falhada
     */
    recordError(operation, error) {
        this.metrics.totalOperations++;
        this.metrics.failedOperations++;
        this.metrics.lastError = new Date();

        // Categorizar o erro
        if (error.message.includes('quota') || error.message.includes('exceeded')) {
            this.metrics.quotaErrors++;
        } else if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
            this.metrics.timeoutErrors++;
        } else if (error.message.includes('socket hang up') || error.message.includes('ENOTFOUND')) {
            this.metrics.connectivityErrors++;
        }

        // Adicionar à lista de operações falhadas
        this.failedOperations.push({
            operation,
            error: error.message,
            timestamp: new Date(),
            type: this.categorizeError(error)
        });

        // Manter apenas as últimas N operações falhadas
        if (this.failedOperations.length > this.maxFailedOperations) {
            this.failedOperations = this.failedOperations.slice(-this.maxFailedOperations);
        }

        console.log(`❌ Erro registrado na operação ${operation}: ${error.message}`);
    }

    /**
     * Categoriza o tipo de erro
     */
    categorizeError(error) {
        if (error.message.includes('quota') || error.message.includes('exceeded')) {
            return 'quota';
        } else if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
            return 'timeout';
        } else if (error.message.includes('socket hang up') || error.message.includes('ENOTFOUND')) {
            return 'connectivity';
        } else if (error.message.includes('403') || error.message.includes('401')) {
            return 'authentication';
        } else {
            return 'unknown';
        }
    }

    /**
     * Obtém falhas recentes
     */
    getRecentFailures(minutes = 10) {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        return this.failedOperations.filter(op => op.timestamp > cutoff);
    }

    /**
     * Limpa operações falhadas
     */
    clearFailedOperations() {
        this.failedOperations = [];
        console.log('🧹 Operações falhadas limpas');
    }

    /**
     * Obtém status de saúde
     */
    getHealthStatus() {
        const recentFailures = this.getRecentFailures();
        const successRate = this.metrics.totalOperations > 0 
            ? (this.metrics.successfulOperations / this.metrics.totalOperations) * 100 
            : 100;

        return {
            isHealthy: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck,
            recoveryAttempts: this.recoveryAttempts,
            successRate: Math.round(successRate * 100) / 100,
            recentFailures: recentFailures.length,
            metrics: this.metrics,
            failedOperations: this.failedOperations.slice(-5) // Últimas 5 falhas
        };
    }

    /**
     * Força uma verificação de saúde
     */
    async forceHealthCheck() {
        console.log('🔍 Forçando verificação de saúde...');
        await this.performHealthCheck();
        return this.getHealthStatus();
    }

    /**
     * Obtém relatório de saúde
     */
    getHealthReport() {
        const status = this.getHealthStatus();
        const recentFailures = this.getRecentFailures();
        
        return {
            timestamp: new Date().toISOString(),
            status: status.isHealthy ? 'HEALTHY' : 'UNHEALTHY',
            summary: {
                totalOperations: status.metrics.totalOperations,
                successRate: `${status.successRate}%`,
                recentFailures: recentFailures.length,
                recoveryAttempts: status.recoveryAttempts
            },
            errors: {
                quota: status.metrics.quotaErrors,
                timeout: status.metrics.timeoutErrors,
                connectivity: status.metrics.connectivityErrors
            },
            lastEvents: {
                lastSuccess: status.metrics.lastSuccess,
                lastError: status.metrics.lastError,
                lastHealthCheck: status.lastHealthCheck
            },
            recentFailures: recentFailures.map(f => ({
                operation: f.operation,
                error: f.error,
                type: f.type,
                timestamp: f.timestamp
            }))
        };
    }
}

module.exports = GoogleSheetsMonitor;
