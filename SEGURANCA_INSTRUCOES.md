# 🔒 INSTRUÇÕES DE SEGURANÇA - VELOTAX BOT

## ✅ **STATUS ATUAL - SEGURO**

**TODOS OS DADOS SENSÍVEIS FORAM REMOVIDOS DO REPOSITÓRIO!**

### 🛡️ **CORREÇÕES IMPLEMENTADAS:**

1. **✅ Arquivo .env protegido**
   - Movido `config.env` → `.env` (protegido pelo .gitignore)
   - Criado `env.example` com placeholders seguros

2. **✅ Credenciais hardcoded removidas**
   - Removido CLIENT_ID hardcoded do `auth.js`
   - Removido fallbacks hardcoded do `server.js` e `server-backup.js`
   - Limpado dados sensíveis do `CONFIGURAR_SERVICE_ACCOUNT_VERCEL.md`

3. **✅ Scripts de segurança criados**
   - `generate-secure-keys.js` para gerar chaves seguras
   - `env.example` como template seguro

## 🚨 **AÇÕES URGENTES QUE VOCÊ DEVE FAZER:**

### **1. REGENERAR TODAS AS CREDENCIAIS EXPOSTAS**

**⚠️ IMPORTANTE:** As credenciais que estavam no arquivo `config.env` foram COMPROMETIDAS e devem ser regeneradas!

#### **Google Cloud Console:**
1. Acesse: https://console.cloud.google.com/
2. Vá em: IAM & Admin → Service Accounts
3. **DELETE** o Service Account atual: `velotax-bot-v2@velotax-bot-v2.iam.gserviceaccount.com`
4. **CRIE** um novo Service Account com nome diferente
5. **GERE** nova chave JSON
6. **COMPARTILHE** a planilha com o novo Service Account

#### **Google OAuth:**
1. Vá em: APIs & Services → Credentials
2. **DELETE** o OAuth Client atual: `135724072741-14ahbnqgsmcoegkjgimrmbm3gkpdhdu1.apps.googleusercontent.com`
3. **CRIE** novo OAuth Client
4. **CONFIGURE** domínios autorizados

### **2. CONFIGURAR VARIÁVEIS DE AMBIENTE**

#### **Localmente:**
1. Copie `env.example` para `.env`
2. Preencha com suas novas credenciais
3. Execute: `node generate-secure-keys.js` para gerar SESSION_SECRET seguro

#### **Na Vercel:**
1. Acesse: https://vercel.com/dashboard
2. Vá em: Seu Projeto → Settings → Environment Variables
3. Adicione todas as variáveis do arquivo `.env`

### **3. GERAR SESSION SECRET SEGURO**

```bash
node generate-secure-keys.js
```

Copie o SESSION_SECRET gerado para o arquivo `.env`.

## 📋 **VARIÁVEIS DE AMBIENTE NECESSÁRIAS:**

```env
# Google OAuth
GOOGLE_CLIENT_ID=SEU_NOVO_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=SEU_NOVO_CLIENT_SECRET

# Google Sheets
GOOGLE_SHEETS_ID=SEU_GOOGLE_SHEETS_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL=SEU_NOVO_SERVICE_ACCOUNT@PROJETO.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nSUA_NOVA_CHAVE_PRIVADA\n-----END PRIVATE KEY-----

# Segurança
SESSION_SECRET=CHAVE_ALEATORIA_DE_64_CARACTERES

# OpenAI
OPENAI_API_KEY=sk-SUA_CHAVE_OPENAI
```

## 🔍 **VERIFICAÇÃO DE SEGURANÇA:**

### **✅ O que está SEGURO agora:**
- ✅ Nenhum dado sensível no repositório
- ✅ Arquivo .env protegido pelo .gitignore
- ✅ Credenciais hardcoded removidas
- ✅ Placeholders seguros em todos os arquivos

### **⚠️ O que você DEVE fazer:**
- ⚠️ Regenerar todas as credenciais expostas
- ⚠️ Configurar variáveis de ambiente na Vercel
- ⚠️ Testar a aplicação após as mudanças

## 🎯 **PRÓXIMOS PASSOS:**

1. **HOJE:** Regenerar credenciais no Google Cloud Console
2. **HOJE:** Configurar variáveis de ambiente na Vercel
3. **HOJE:** Testar a aplicação
4. **ESTA SEMANA:** Implementar monitoramento de segurança

## 🆘 **EM CASO DE PROBLEMAS:**

Se algo não funcionar após as mudanças:

1. **Verifique** se todas as variáveis de ambiente estão configuradas
2. **Confirme** se as credenciais foram regeneradas corretamente
3. **Teste** localmente primeiro com o arquivo `.env`
4. **Verifique** os logs da Vercel para erros

---

**🔒 LEMBRE-SE:** Nunca mais exponha credenciais no repositório! Sempre use variáveis de ambiente.