#!/usr/bin/env node

/**
 * Script para gerar chaves seguras para o projeto
 * Execute: node generate-secure-keys.js
 */

const crypto = require('crypto');

console.log('🔐 Gerando chaves seguras para o projeto...\n');

// Gerar Session Secret seguro (64 caracteres)
const sessionSecret = crypto.randomBytes(32).toString('hex');
console.log('✅ SESSION_SECRET gerado:');
console.log(`SESSION_SECRET=${sessionSecret}\n`);

// Gerar chave para JWT (se necessário)
const jwtSecret = crypto.randomBytes(32).toString('base64');
console.log('✅ JWT_SECRET gerado:');
console.log(`JWT_SECRET=${jwtSecret}\n`);

// Gerar chave para criptografia (se necessário)
const encryptionKey = crypto.randomBytes(32).toString('base64');
console.log('✅ ENCRYPTION_KEY gerado:');
console.log(`ENCRYPTION_KEY=${encryptionKey}\n`);

console.log('📋 INSTRUÇÕES:');
console.log('1. Copie o SESSION_SECRET gerado acima');
console.log('2. Substitua no arquivo .env');
console.log('3. NUNCA compartilhe essas chaves');
console.log('4. Mantenha o arquivo .env seguro e fora do controle de versão');

console.log('\n⚠️  IMPORTANTE:');
console.log('- Regenerar todas as credenciais expostas no Google Cloud Console');
console.log('- Atualizar as variáveis de ambiente na Vercel');
console.log('- Remover credenciais hardcoded do código');
