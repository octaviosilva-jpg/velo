/**
 * Sistema de Diagnósticos para Google Sheets
 * 
 * Este módulo fornece endpoints e ferramentas para diagnosticar
 * problemas com a integração do Google Sheets.
 */

class GoogleSheetsDiagnostics {
    constructor(googleSheetsIntegration, monitor, queue) {
        this.integration = googleSheetsIntegration;
        this.monitor = monitor;
        this.queue = queue;
        
        console.log('🔧 Google Sheets Diagnostics inicializado');
    }

    /**
     * Executa diagnóstico completo
     */
    async runFullDiagnostic() {
        console.log('🔍 Executando diagnóstico completo do Google Sheets...');
        
        const diagnostic = {
            timestamp: new Date().toISOString(),
            integration: await this.diagnoseIntegration(),
            connectivity: await this.diagnoseConnectivity(),
            authentication: await this.diagnoseAuthentication(),
            quota: await this.diagnoseQuota(),
            performance: await this.diagnosePerformance(),
            recommendations: []
        };

        // Gerar recomendações
        diagnostic.recommendations = this.generateRecommendations(diagnostic);
        
        console.log('✅ Diagnóstico completo finalizado');
        return diagnostic;
    }

    /**
     * Diagnostica a integração
     */
    async diagnoseIntegration() {
        try {
            const isActive = this.integration.isActive();
            const isInitialized = this.integration.initialized;
            
            return {
                status: isActive ? 'ACTIVE' : 'INACTIVE',
                initialized: isInitialized,
                issues: isActive ? [] : ['Integration not active']
            };
        } catch (error) {
            return {
                status: 'ERROR',
                initialized: false,
                issues: [`Integration error: ${error.message}`]
            };
        }
    }

    /**
     * Diagnostica conectividade
     */
    async diagnoseConnectivity() {
        try {
            const startTime = Date.now();
            const apiStatus = await this.integration.checkApiStatus();
            const responseTime = Date.now() - startTime;
            
            return {
                status: apiStatus ? 'CONNECTED' : 'DISCONNECTED',
                responseTime: responseTime,
                issues: apiStatus ? [] : ['API not responding']
            };
        } catch (error) {
            return {
                status: 'ERROR',
                responseTime: null,
                issues: [`Connectivity error: ${error.message}`]
            };
        }
    }

    /**
     * Diagnostica autenticação
     */
    async diagnoseAuthentication() {
        try {
            // Verificar se as credenciais estão configuradas
            const envVars = require('./server.js').loadEnvFile();
            const hasCredentials = !!(
                envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
                envVars.GOOGLE_PRIVATE_KEY &&
                envVars.GOOGLE_SHEETS_ID
            );
            
            return {
                status: hasCredentials ? 'CONFIGURED' : 'MISSING',
                hasServiceAccount: !!envVars.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                hasPrivateKey: !!envVars.GOOGLE_PRIVATE_KEY,
                hasSpreadsheetId: !!envVars.GOOGLE_SHEETS_ID,
                issues: hasCredentials ? [] : ['Missing authentication credentials']
            };
        } catch (error) {
            return {
                status: 'ERROR',
                issues: [`Authentication error: ${error.message}`]
            };
        }
    }

    /**
     * Diagnostica quota
     */
    async diagnoseQuota() {
        try {
            const healthStatus = this.monitor.getHealthStatus();
            const recentFailures = this.monitor.getRecentFailures();
            const quotaErrors = recentFailures.filter(f => f.type === 'quota');
            
            return {
                status: quotaErrors.length > 0 ? 'LIMITED' : 'AVAILABLE',
                recentQuotaErrors: quotaErrors.length,
                totalQuotaErrors: this.monitor.metrics.quotaErrors,
                issues: quotaErrors.length > 0 ? ['Recent quota errors detected'] : []
            };
        } catch (error) {
            return {
                status: 'ERROR',
                issues: [`Quota error: ${error.message}`]
            };
        }
    }

    /**
     * Diagnostica performance
     */
    async diagnosePerformance() {
        try {
            const queueStatus = this.queue.getQueueStatus();
            const healthStatus = this.monitor.getHealthStatus();
            
            return {
                queueLength: queueStatus.queueLength,
                isProcessing: queueStatus.isProcessing,
                successRate: healthStatus.successRate,
                averageProcessingTime: queueStatus.stats.averageProcessingTime,
                currentDelay: queueStatus.currentDelay,
                issues: this.identifyPerformanceIssues(queueStatus, healthStatus)
            };
        } catch (error) {
            return {
                status: 'ERROR',
                issues: [`Performance error: ${error.message}`]
            };
        }
    }

    /**
     * Identifica problemas de performance
     */
    identifyPerformanceIssues(queueStatus, healthStatus) {
        const issues = [];
        
        if (queueStatus.queueLength > 50) {
            issues.push('Queue is too long');
        }
        
        if (healthStatus.successRate < 80) {
            issues.push('Low success rate');
        }
        
        if (queueStatus.currentDelay > 10000) {
            issues.push('High processing delay');
        }
        
        if (queueStatus.stats.averageProcessingTime > 5000) {
            issues.push('Slow processing time');
        }
        
        return issues;
    }

    /**
     * Gera recomendações baseadas no diagnóstico
     */
    generateRecommendations(diagnostic) {
        const recommendations = [];
        
        // Recomendações de integração
        if (diagnostic.integration.status !== 'ACTIVE') {
            recommendations.push({
                type: 'CRITICAL',
                category: 'Integration',
                message: 'Reinitialize Google Sheets integration',
                action: 'Call /api/force-initialize-google-sheets endpoint'
            });
        }
        
        // Recomendações de conectividade
        if (diagnostic.connectivity.status !== 'CONNECTED') {
            recommendations.push({
                type: 'HIGH',
                category: 'Connectivity',
                message: 'Check network connectivity and API status',
                action: 'Verify internet connection and Google Sheets API availability'
            });
        }
        
        // Recomendações de autenticação
        if (diagnostic.authentication.status !== 'CONFIGURED') {
            recommendations.push({
                type: 'CRITICAL',
                category: 'Authentication',
                message: 'Configure Google Sheets credentials',
                action: 'Set up environment variables in Vercel dashboard'
            });
        }
        
        // Recomendações de quota
        if (diagnostic.quota.status === 'LIMITED') {
            recommendations.push({
                type: 'MEDIUM',
                category: 'Quota',
                message: 'Reduce API usage or wait for quota reset',
                action: 'Implement more aggressive rate limiting'
            });
        }
        
        // Recomendações de performance
        if (diagnostic.performance.issues.length > 0) {
            recommendations.push({
                type: 'LOW',
                category: 'Performance',
                message: 'Optimize queue processing',
                action: 'Clear queue or adjust processing parameters'
            });
        }
        
        return recommendations;
    }

    /**
     * Executa teste de escrita
     */
    async testWriteOperation() {
        console.log('🧪 Testando operação de escrita...');
        
        try {
            const testData = {
                tipo: 'teste',
                timestamp: new Date().toISOString(),
                operacao: 'diagnostico',
                status: 'teste'
            };
            
            const success = await this.integration.registrarFeedback(testData);
            
            return {
                success: success,
                message: success ? 'Write test successful' : 'Write test failed',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Write test error: ${error.message}`,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Executa teste de leitura
     */
    async testReadOperation() {
        console.log('🧪 Testando operação de leitura...');
        
        try {
            const startTime = Date.now();
            const data = await this.integration.obterModelosRespostas();
            const responseTime = Date.now() - startTime;
            
            return {
                success: true,
                message: 'Read test successful',
                responseTime: responseTime,
                dataCount: data ? data.length : 0,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Read test error: ${error.message}`,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Obtém relatório de saúde
     */
    getHealthReport() {
        return {
            timestamp: new Date().toISOString(),
            monitor: this.monitor.getHealthReport(),
            queue: this.queue.getQueueReport(),
            integration: {
                isActive: this.integration.isActive(),
                initialized: this.integration.initialized
            }
        };
    }

    /**
     * Força recuperação do sistema
     */
    async forceRecovery() {
        console.log('🔄 Forçando recuperação do sistema...');
        
        try {
            // Parar processamento da fila
            this.queue.stopProcessing();
            
            // Limpar fila
            this.queue.clearQueue();
            
            // Forçar verificação de saúde
            await this.monitor.forceHealthCheck();
            
            // Tentar recuperação
            const recovered = await this.monitor.attemptRecovery();
            
            // Reiniciar processamento da fila
            if (recovered) {
                this.queue.resumeProcessing();
            }
            
            return {
                success: recovered,
                message: recovered ? 'System recovered successfully' : 'System recovery failed',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Recovery error: ${error.message}`,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = GoogleSheetsDiagnostics;
