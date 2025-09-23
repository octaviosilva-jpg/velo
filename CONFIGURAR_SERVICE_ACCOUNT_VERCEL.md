# 🔧 Configurar Service Account na Vercel

## ✅ Status Atual
- ✅ Google Sheets habilitado no código
- ✅ Todas as chamadas ativas
- ⚠️ Precisa configurar Service Account na Vercel

## 🚀 Variáveis de Ambiente Necessárias na Vercel

Acesse: https://vercel.com/dashboard → Seu Projeto → Settings → Environment Variables

### 📋 Adicione estas variáveis:

```
GOOGLE_SHEETS_ID=1y8D6ifk3ucamTNwAB9SCM-2m93mkbMm6IA_qHagCAjI
ENABLE_GOOGLE_SHEETS=true
GOOGLE_SERVICE_ACCOUNT_EMAIL=seu-service-account@projeto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nSUA_CHAVE_PRIVADA_AQUI\n-----END PRIVATE KEY-----
GOOGLE_PROJECT_ID=seu-projeto-id
```

## 🔑 Como Obter as Credenciais do Service Account

### 1. Acesse Google Cloud Console
- https://console.cloud.google.com/
- Selecione seu projeto

### 2. Crie Service Account
- IAM & Admin → Service Accounts
- Create Service Account
- Nome: `velotax-bot-sheets`
- Descrição: `Service Account para integração com Google Sheets`

### 3. Conceda Permissões
- Role: `Editor` ou `Google Sheets API User`

### 4. Gere Chave JSON
- Clique no Service Account criado
- Keys → Add Key → Create New Key → JSON
- Baixe o arquivo JSON

### 5. Extraia as Informações
Do arquivo JSON baixado, copie:
- `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `private_key` → `GOOGLE_PRIVATE_KEY`
- `project_id` → `GOOGLE_PROJECT_ID`

## 📊 Compartilhar Planilha com Service Account

### 1. Abra sua planilha
- https://docs.google.com/spreadsheets/d/1y8D6ifk3ucamTNwAB9SCM-2m93mkbMm6IA_qHagCAjI

### 2. Compartilhe com Service Account
- Compartilhar → Adicionar pessoas
- Email: `seu-service-account@projeto.iam.gserviceaccount.com`
- Permissão: `Editor`

## ✅ Teste Após Configuração

1. **Redeploy** na Vercel (automático após adicionar variáveis)
2. **Teste** a aplicação
3. **Verifique** se os dados aparecem na planilha

## 🎯 Resultado Esperado

Após configurar, você verá:
- ✅ Logs: "Google Sheets integrado com sucesso"
- ✅ Dados sendo registrados na planilha
- ✅ Abas criadas automaticamente

---
**⚠️ Importante:** Mantenha as credenciais seguras e nunca as exponha publicamente!
