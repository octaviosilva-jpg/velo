// Script para migrar FAQs hardcoded para a planilha do Google Sheets
// Execute: node migrate-faqs.js

const https = require('https');
const http = require('http');

const url = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}/api/faqs/migrate`
    : 'http://localhost:3000/api/faqs/migrate';

console.log('🔄 Iniciando migração de FAQs...');
console.log('📍 URL:', url);

const protocol = url.startsWith('https') ? https : http;

const req = protocol.request(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
}, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const result = JSON.parse(data);
            if (result.success) {
                console.log('✅ Migração concluída com sucesso!');
                console.log(`📊 Criados: ${result.created}`);
                console.log(`⏭️  Pulados (já existiam): ${result.skipped}`);
                console.log(`📋 Total: ${result.total}`);
            } else {
                console.error('❌ Erro na migração:', result.error);
                console.error('Mensagem:', result.message);
            }
        } catch (error) {
            console.error('❌ Erro ao processar resposta:', error);
            console.log('Resposta recebida:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Erro na requisição:', error.message);
    console.log('\n💡 Dica: Certifique-se de que o servidor está rodando.');
    console.log('   Se estiver em produção, use a URL completa do Vercel.');
});

req.end();
