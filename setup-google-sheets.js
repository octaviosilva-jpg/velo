#!/usr/bin/env node

/**
 * Script de Configuração do Google Sheets
 * 
 * Este script ajuda a configurar a integração com Google Sheets
 * de forma interativa e robusta.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

class GoogleSheetsSetup {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    /**
     * Executa o setup completo
     */
    async run() {
        console.log('🔧 CONFIGURAÇÃO DO GOOGLE SHEETS');
        console.log('=================================');
        console.log('');
        
        try {
            // 1. Verificar configuração atual
            await this.checkCurrentConfig();
            
            // 2. Escolher método de configuração
            const method = await this.chooseConfigurationMethod();
            
            // 3. Configurar baseado no método escolhido
            switch (method) {
                case 'env':
                    await this.setupEnvironmentVariables();
                    break;
                case 'file':
                    await this.setupConfigFile();
                    break;
                case 'credentials':
                    await this.setupCredentialsFile();
                    break;
                case 'minimal':
                    await this.setupMinimalConfig();
                    break;
            }
            
            // 4. Testar configuração
            await this.testConfiguration();
            
            console.log('');
            console.log('✅ Configuração concluída com sucesso!');
            console.log('📋 Próximos passos:');
            console.log('   1. Reinicie o servidor');
            console.log('   2. Teste a aplicação');
            console.log('   3. Verifique se os dados aparecem na planilha');
            
        } catch (error) {
            console.error('❌ Erro durante a configuração:', error.message);
        } finally {
            this.rl.close();
        }
    }

    /**
     * Verifica configuração atual
     */
    async checkCurrentConfig() {
        console.log('🔍 Verificando configuração atual...');
        
        const checks = {
            envVars: this.checkEnvironmentVariables(),
            configFile: this.checkConfigFile(),
            credentialsFile: this.checkCredentialsFile(),
            envFile: this.checkEnvFile()
        };
        
        console.log('');
        console.log('📊 Status da configuração:');
        console.log(`   Variáveis de ambiente: ${checks.envVars ? '✅' : '❌'}`);
        console.log(`   Arquivo de configuração: ${checks.configFile ? '✅' : '❌'}`);
        console.log(`   Arquivo de credenciais: ${checks.credentialsFile ? '✅' : '❌'}`);
        console.log(`   Arquivo .env: ${checks.envFile ? '✅' : '❌'}`);
        console.log('');
    }

    /**
     * Verifica variáveis de ambiente
     */
    checkEnvironmentVariables() {
        return !!(
            process.env.GOOGLE_SHEETS_ID &&
            process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
            process.env.GOOGLE_PRIVATE_KEY
        );
    }

    /**
     * Verifica arquivo de configuração
     */
    checkConfigFile() {
        try {
            return fs.existsSync('./google-sheets-config.json');
        } catch {
            return false;
        }
    }

    /**
     * Verifica arquivo de credenciais
     */
    checkCredentialsFile() {
        try {
            return fs.existsSync('./google-sheets-credentials.json');
        } catch {
            return false;
        }
    }

    /**
     * Verifica arquivo .env
     */
    checkEnvFile() {
        try {
            return fs.existsSync('./.env');
        } catch {
            return false;
        }
    }

    /**
     * Escolhe método de configuração
     */
    async chooseConfigurationMethod() {
        console.log('🎯 Escolha o método de configuração:');
        console.log('   1. Variáveis de ambiente (recomendado para Vercel)');
        console.log('   2. Arquivo de configuração JSON');
        console.log('   3. Arquivo de credenciais JSON');
        console.log('   4. Configuração mínima (apenas ID da planilha)');
        console.log('');
        
        const choice = await this.ask('Digite sua escolha (1-4): ');
        
        switch (choice.trim()) {
            case '1': return 'env';
            case '2': return 'file';
            case '3': return 'credentials';
            case '4': return 'minimal';
            default:
                console.log('⚠️ Escolha inválida, usando configuração mínima...');
                return 'minimal';
        }
    }

    /**
     * Configura variáveis de ambiente
     */
    async setupEnvironmentVariables() {
        console.log('');
        console.log('🔧 Configurando variáveis de ambiente...');
        console.log('');
        
        const spreadsheetId = await this.ask('ID da planilha Google Sheets: ');
        const serviceAccountEmail = await this.ask('Email do Service Account: ');
        const privateKey = await this.ask('Chave privada (completa): ');
        const projectId = await this.ask('ID do projeto Google Cloud: ');
        
        const envContent = `# Configurações do Google Sheets
GOOGLE_SHEETS_ID=${spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${serviceAccountEmail}
GOOGLE_PRIVATE_KEY=${privateKey}
GOOGLE_PROJECT_ID=${projectId}
ENABLE_GOOGLE_SHEETS=true
`;
        
        fs.writeFileSync('./.env', envContent);
        console.log('✅ Arquivo .env criado com sucesso!');
    }

    /**
     * Configura arquivo de configuração
     */
    async setupConfigFile() {
        console.log('');
        console.log('🔧 Configurando arquivo de configuração...');
        console.log('');
        
        const spreadsheetId = await this.ask('ID da planilha Google Sheets: ');
        const serviceAccountEmail = await this.ask('Email do Service Account: ');
        const projectId = await this.ask('ID do projeto Google Cloud: ');
        
        const config = {
            spreadsheetId: spreadsheetId,
            serviceAccountEmail: serviceAccountEmail,
            projectId: projectId,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('./google-sheets-config.json', JSON.stringify(config, null, 2));
        console.log('✅ Arquivo de configuração criado com sucesso!');
    }

    /**
     * Configura arquivo de credenciais
     */
    async setupCredentialsFile() {
        console.log('');
        console.log('🔧 Configurando arquivo de credenciais...');
        console.log('');
        console.log('📋 Para obter o arquivo de credenciais:');
        console.log('   1. Acesse: https://console.cloud.google.com/');
        console.log('   2. Crie um Service Account');
        console.log('   3. Baixe o arquivo JSON');
        console.log('   4. Cole o conteúdo abaixo:');
        console.log('');
        
        const credentialsJson = await this.ask('Cole o conteúdo do arquivo JSON: ');
        
        try {
            const credentials = JSON.parse(credentialsJson);
            fs.writeFileSync('./google-sheets-credentials.json', JSON.stringify(credentials, null, 2));
            console.log('✅ Arquivo de credenciais criado com sucesso!');
        } catch (error) {
            console.log('❌ Erro ao processar JSON:', error.message);
            throw error;
        }
    }

    /**
     * Configuração mínima
     */
    async setupMinimalConfig() {
        console.log('');
        console.log('🔧 Configurando configuração mínima...');
        console.log('');
        
        const spreadsheetId = await this.ask('ID da planilha Google Sheets: ');
        
        const config = {
            spreadsheetId: spreadsheetId,
            minimal: true,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('./google-sheets-config.json', JSON.stringify(config, null, 2));
        console.log('✅ Configuração mínima criada com sucesso!');
        console.log('⚠️ Para funcionalidade completa, configure as credenciais do Google Sheets');
    }

    /**
     * Testa a configuração
     */
    async testConfiguration() {
        console.log('');
        console.log('🧪 Testando configuração...');
        
        try {
            const googleSheetsFallback = require('./google-sheets-fallback');
            const success = await googleSheetsFallback.initialize();
            
            if (success) {
                console.log('✅ Configuração testada com sucesso!');
                console.log(`   Método usado: ${googleSheetsFallback.getMethod()}`);
                
                const diagnostic = googleSheetsFallback.getDiagnosticInfo();
                console.log('   Informações:');
                console.log(`     - Inicializado: ${diagnostic.initialized ? 'Sim' : 'Não'}`);
                console.log(`     - Tem credenciais: ${diagnostic.hasCredentials ? 'Sim' : 'Não'}`);
                console.log(`     - Tem ID da planilha: ${diagnostic.hasSpreadsheetId ? 'Sim' : 'Não'}`);
            } else {
                console.log('⚠️ Configuração não funcionou completamente');
                console.log('   Verifique se as credenciais estão corretas');
            }
        } catch (error) {
            console.log('❌ Erro ao testar configuração:', error.message);
        }
    }

    /**
     * Faz uma pergunta ao usuário
     */
    ask(question) {
        return new Promise((resolve) => {
            this.rl.question(question, resolve);
        });
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const setup = new GoogleSheetsSetup();
    setup.run().catch(console.error);
}

module.exports = GoogleSheetsSetup;
