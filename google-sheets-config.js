const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleSheetsConfig {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.spreadsheetId = null;
        this.initialized = false;
    }

    /**
     * Inicializa a configuração do Google Sheets com credenciais diretas
     * @param {object} credentials - Objeto de credenciais
     * @param {string} spreadsheetId - ID da planilha do Google Sheets
     */
    async initializeWithCredentials(credentials, spreadsheetId) {
        try {
            console.log('🔧 Inicializando Google Sheets API com credenciais diretas...');
            
            // Configurar OAuth2 com credenciais diretas
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
            this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            // Para Vercel, vamos usar um token temporário ou desabilitar
            console.log('⚠️ Inicialização com credenciais diretas - token não disponível');
            console.log('📊 Google Sheets desabilitado temporariamente na Vercel');
            return false;

        } catch (error) {
            console.error('❌ Erro ao inicializar Google Sheets com credenciais:', error.message);
            return false;
        }
    }

    /**
     * Inicializa a configuração do Google Sheets
     * @param {string} credentialsPath - Caminho para o arquivo de credenciais JSON
     * @param {string} spreadsheetId - ID da planilha do Google Sheets
     * @param {string} tokenPath - Caminho para o arquivo de token (opcional)
     */
    async initialize(credentialsPath, spreadsheetId, tokenPath = null) {
        try {
            console.log('🔧 Inicializando Google Sheets API...');
            
            // Verificar se o arquivo de credenciais existe
            if (!fs.existsSync(credentialsPath)) {
                throw new Error(`Arquivo de credenciais não encontrado: ${credentialsPath}`);
            }

            // Carregar credenciais
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            
            // Configurar OAuth2
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
            this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            // Tentar carregar token existente
            if (tokenPath && fs.existsSync(tokenPath)) {
                const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                this.auth.setCredentials(token);
                console.log('✅ Token carregado com sucesso');
            } else {
                console.log('⚠️ Token não encontrado. Será necessário autorizar a aplicação.');
                console.log('📋 Para obter o token, execute: node google-sheets-auth.js');
                return false;
            }

            // Inicializar Sheets API
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            this.spreadsheetId = spreadsheetId;
            this.initialized = true;

            console.log('✅ Google Sheets API inicializada com sucesso');
            return true;

        } catch (error) {
            console.error('❌ Erro ao inicializar Google Sheets API:', error.message);
            return false;
        }
    }

    /**
     * Verifica se a API está inicializada
     */
    isInitialized() {
        return this.initialized && this.sheets && this.auth;
    }

    /**
     * Obtém a instância do Sheets API
     */
    getSheets() {
        if (!this.isInitialized()) {
            throw new Error('Google Sheets API não foi inicializada');
        }
        return this.sheets;
    }

    /**
     * Obtém o ID da planilha
     */
    getSpreadsheetId() {
        if (!this.spreadsheetId) {
            throw new Error('ID da planilha não foi configurado');
        }
        return this.spreadsheetId;
    }

    /**
     * Adiciona uma linha à planilha
     * @param {string} range - Range da planilha (ex: 'Sheet1!A1:Z1')
     * @param {Array} values - Array de valores para adicionar
     */
    async appendRow(range, values) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            const request = {
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [values]
                }
            };

            const response = await sheets.spreadsheets.values.append(request);
            console.log('✅ Linha adicionada com sucesso:', response.data.updates.updatedRows);
            return response.data;

        } catch (error) {
            console.error('❌ Erro ao adicionar linha:', error.message);
            throw error;
        }
    }

    /**
     * Atualiza uma célula específica
     * @param {string} range - Range da célula (ex: 'Sheet1!A1')
     * @param {string} value - Valor para inserir
     */
    async updateCell(range, value) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            const request = {
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[value]]
                }
            };

            const response = await sheets.spreadsheets.values.update(request);
            console.log('✅ Célula atualizada com sucesso');
            return response.data;

        } catch (error) {
            console.error('❌ Erro ao atualizar célula:', error.message);
            throw error;
        }
    }

    /**
     * Lê dados de uma planilha
     * @param {string} range - Range para ler (ex: 'Sheet1!A1:Z100')
     */
    async readData(range) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: range
            });

            return response.data.values || [];

        } catch (error) {
            console.error('❌ Erro ao ler dados:', error.message);
            throw error;
        }
    }

    /**
     * Cria cabeçalhos para uma nova planilha
     * @param {string} sheetName - Nome da planilha
     * @param {Array} headers - Array com os cabeçalhos
     */
    async createHeaders(sheetName, headers) {
        try {
            const range = `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`;
            await this.appendRow(range, headers);
            console.log(`✅ Cabeçalhos criados na planilha ${sheetName}`);
        } catch (error) {
            console.error('❌ Erro ao criar cabeçalhos:', error.message);
            throw error;
        }
    }

    /**
     * Limpa o conteúdo de uma planilha
     * @param {string} sheetName - Nome da planilha
     */
    async clearSheet(sheetName) {
        try {
            const range = `${sheetName}!A:Z`;
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: range
            });
            console.log(`✅ Planilha ${sheetName} limpa com sucesso`);
        } catch (error) {
            console.error('❌ Erro ao limpar planilha:', error.message);
            throw error;
        }
    }
}

// Instância singleton
const googleSheetsConfig = new GoogleSheetsConfig();

module.exports = googleSheetsConfig;
