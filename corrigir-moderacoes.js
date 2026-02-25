// Script para corrigir dados da planilha Moderações
// Execute: node corrigir-moderacoes.js

const https = require('https');

// URL da Vercel (ajuste se necessário)
const url = process.env.VERCEL_URL || 'velotax-bot-v2.vercel.app';
const fullUrl = `https://${url}/api/corrigir-moderacoes`;

console.log('🔧 Chamando endpoint para corrigir moderações...');
console.log('📍 URL:', fullUrl);

const options = {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = https.request(fullUrl, options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('✅ Resposta recebida:');
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.log(data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Erro:', error.message);
});

req.end();
