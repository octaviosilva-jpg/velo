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
            console.log('🔧 Inicializando Google Sheets API com Service Account...');

            // Verificar se é Service Account (tem private_key) ou OAuth2 (tem client_secret)
            if (credentials.private_key) {
                // Service Account - método correto para Vercel
                this.auth = new google.auth.GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
                console.log('✅ Usando Service Account para autenticação');
            } else {
                // OAuth2 - método antigo (não funciona bem na Vercel)
                const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
                this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
                console.log('⚠️ Usando OAuth2 (pode não funcionar na Vercel)');
            }

            this.sheets = google.sheets({ 
                version: 'v4', 
                auth: this.auth,
                timeout: 10000 // 10 segundos de timeout
            });
            this.spreadsheetId = spreadsheetId;
            this.initialized = true;
            console.log('✅ Google Sheets API inicializado com sucesso (timeout: 10s)');
            return true;

        } catch (error) {
            console.error('❌ Erro ao inicializar Google Sheets:', error.message);
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
        // Coagido pra boolean de proposito: "&&" encadeado sem coercao retorna o ULTIMO operando
        // truthy (aqui, this.auth — o cliente OAuth com a chave privada e o access token dentro)
        // em vez de true/false. Varios endpoints (ex. /api/google-sheets-queue-status,
        // /api/force-initialize-google-sheets, /api/debug-google-sheets) devolvem esse valor direto
        // no JSON de resposta, entao o objeto de credencial inteiro estava vazando publicamente,
        // sem autenticacao, pra quem chamasse esses endpoints (achado real em 2026-09-11).
        return !!(this.initialized && this.sheets && this.auth);
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
            console.log('🔍 [DEBUG] appendRow chamado com range:', range);
            console.log('🔍 [DEBUG] appendRow chamado com values:', values);
            
            if (!this.isInitialized()) {
                console.log('❌ [DEBUG] Google Sheets API não foi inicializada');
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();
            
            console.log('🔍 [DEBUG] Spreadsheet ID:', spreadsheetId);

            const request = {
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'RAW', // Usar RAW para preservar HTML sem interpretação
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [values]
                }
            };

            const response = await sheets.spreadsheets.values.append(request);
            console.log('✅ Linha adicionada com sucesso:', response.data.updates.updatedRows, 'range:', response.data.updates.updatedRange);
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
        console.log('=== UPDATE CELL ===', `Range: ${range}, Value: ${value}`);
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            const response = await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[value]]
                }
            });
            
            console.log('=== UPDATE RESULT ===', `UpdatedCells: ${response.data.updatedCells}, Range: ${response.data.updatedRange || 'N/A'}`);
            
            if (response.data.updatedCells === 0) {
                throw new Error('A API do Google Sheets não atualizou nenhuma célula');
            }
            
            return response.data;

        } catch (error) {
            console.error('Erro ao atualizar célula:', error.message);
            throw error;
        }
    }

    /**
     * Atualiza uma linha específica
     * @param {string} range - Range da linha (ex: 'Sheet1!A2:Z2')
     * @param {Array} values - Array de valores para atualizar
     */
    async updateRow(range, values) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            const request = {
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'RAW', // Usar RAW para preservar HTML sem interpretação
                resource: {
                    values: [values]
                }
            };

            const response = await sheets.spreadsheets.values.update(request);
            console.log('✅ Linha atualizada com sucesso');
            return response.data;

        } catch (error) {
            console.error('❌ Erro ao atualizar linha:', error.message);
            throw error;
        }
    }

    /**
     * Deleta uma linha específica de uma planilha
     * @param {string} sheetName - Nome da planilha (ex: 'Sheet1')
     * @param {number} rowIndex - Índice da linha a ser deletada (1-based, linha 1 = cabeçalho)
     */
    async deleteRow(sheetName, rowIndex) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            // Primeiro, obter o ID da planilha pelo nome
            const spreadsheet = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheetId
            });

            const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
            if (!sheet) {
                throw new Error(`Planilha "${sheetName}" não encontrada`);
            }

            const sheetId = sheet.properties.sheetId;

            // Deletar a linha usando batchUpdate
            const request = {
                spreadsheetId: spreadsheetId,
                resource: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndex - 1, // 0-based
                                endIndex: rowIndex
                            }
                        }
                    }]
                }
            };

            const response = await sheets.spreadsheets.batchUpdate(request);
            console.log(`✅ Linha ${rowIndex} deletada com sucesso da planilha "${sheetName}"`);
            return response.data;

        } catch (error) {
            console.error('❌ Erro ao deletar linha:', error.message);
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

    /**
     * Aplica formatação básica nas planilhas para corrigir problemas de visualização
     * @param {string} sheetName - Nome da planilha
     */
    async aplicarFormatacaoBasica(sheetName) {
        try {
            if (!this.isInitialized()) {
                throw new Error('Google Sheets API não foi inicializada');
            }

            const sheets = this.getSheets();
            const spreadsheetId = this.getSpreadsheetId();

            // Obter informações da planilha
            const spreadsheet = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheetId
            });

            // Encontrar o ID da planilha pelo nome
            let sheetId = null;
            for (const sheet of spreadsheet.data.sheets) {
                if (sheet.properties.title === sheetName) {
                    sheetId = sheet.properties.sheetId;
                    break;
                }
            }

            if (!sheetId) {
                console.log(`⚠️ Planilha ${sheetName} não encontrada para formatação`);
                return;
            }

            // Aplicar formatação básica
            const requests = [
                {
                    repeatCell: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: 0,
                            endRowIndex: 1000,
                            startColumnIndex: 0,
                            endColumnIndex: 20
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: {
                                    red: 1.0,
                                    green: 1.0,
                                    blue: 1.0
                                },
                                textFormat: {
                                    foregroundColor: {
                                        red: 0.0,
                                        green: 0.0,
                                        blue: 0.0
                                    }
                                }
                            }
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat)'
                    }
                },
                {
                    repeatCell: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: 0,
                            endRowIndex: 1,
                            startColumnIndex: 0,
                            endColumnIndex: 20
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: {
                                    red: 0.9,
                                    green: 0.9,
                                    blue: 0.9
                                },
                                textFormat: {
                                    bold: true,
                                    foregroundColor: {
                                        red: 0.0,
                                        green: 0.0,
                                        blue: 0.0
                                    }
                                }
                            }
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat)'
                    }
                }
            ];

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheetId,
                resource: {
                    requests: requests
                }
            });

            console.log(`✅ Formatação básica aplicada na planilha ${sheetName}`);

        } catch (error) {
            console.error(`❌ Erro ao aplicar formatação na planilha ${sheetName}:`, error.message);
        }
    }
}

// Instância singleton
const googleSheetsConfig = new GoogleSheetsConfig();

module.exports = googleSheetsConfig;
