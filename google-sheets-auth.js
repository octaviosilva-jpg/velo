const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

/**
 * Script para obter token de autenticação do Google Sheets
 * Execute este script uma vez para configurar a autenticação
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'google-sheets-token.json';
const CREDENTIALS_PATH = 'google-sheets-credentials.json';

async function authorize() {
    try {
        console.log('🔧 Iniciando processo de autenticação do Google Sheets...');
        
        // Verificar se o arquivo de credenciais existe
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.error('❌ Arquivo de credenciais não encontrado:', CREDENTIALS_PATH);
            console.log('📋 Para obter as credenciais:');
            console.log('1. Acesse: https://console.cloud.google.com/');
            console.log('2. Crie um novo projeto ou selecione um existente');
            console.log('3. Ative a Google Sheets API');
            console.log('4. Crie credenciais OAuth 2.0');
            console.log('5. Baixe o arquivo JSON e renomeie para:', CREDENTIALS_PATH);
            return;
        }

        // Carregar credenciais
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        
        // Configurar OAuth2
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        // Verificar se já existe um token
        if (fs.existsSync(TOKEN_PATH)) {
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            oAuth2Client.setCredentials(token);
            console.log('✅ Token já existe e foi carregado');
            return oAuth2Client;
        }

        // Obter novo token
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });

        console.log('🔗 Autorize esta aplicação visitando esta URL:');
        console.log(authUrl);
        console.log('\n📋 Após autorizar, copie o código de autorização da URL');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        return new Promise((resolve, reject) => {
            rl.question('Digite o código de autorização: ', (code) => {
                rl.close();
                
                oAuth2Client.getToken(code, (err, token) => {
                    if (err) {
                        console.error('❌ Erro ao obter token:', err);
                        reject(err);
                        return;
                    }
                    
                    // Salvar token
                    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                    console.log('✅ Token salvo em:', TOKEN_PATH);
                    
                    oAuth2Client.setCredentials(token);
                    resolve(oAuth2Client);
                });
            });
        });

    } catch (error) {
        console.error('❌ Erro na autenticação:', error.message);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    authorize()
        .then(() => {
            console.log('🎉 Autenticação concluída com sucesso!');
            console.log('📋 Agora você pode usar a integração com Google Sheets');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Falha na autenticação:', error.message);
            process.exit(1);
        });
}

module.exports = { authorize, SCOPES, TOKEN_PATH, CREDENTIALS_PATH };
