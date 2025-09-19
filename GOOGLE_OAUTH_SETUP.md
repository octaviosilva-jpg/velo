# Configuração Google OAuth - Velotax Bot

## Visão Geral

Este documento descreve como configurar a autenticação Google OAuth 2.0 para o sistema Velotax Bot.

## Pré-requisitos

1. Conta Google com acesso ao Google Cloud Console
2. Projeto criado no Google Cloud Console
3. APIs do Google Identity Services habilitadas

## Passo a Passo

### 1. Acessar Google Cloud Console

1. Vá para: https://console.cloud.google.com/
2. Selecione seu projeto ou crie um novo

### 2. Habilitar APIs

1. Vá para "APIs & Services" > "Library"
2. Procure por "Google Identity Services API"
3. Clique em "Enable"

### 3. Configurar OAuth Consent Screen

1. Vá para "APIs & Services" > "OAuth consent screen"
2. Escolha "External" (para usuários externos)
3. Preencha as informações obrigatórias:
   - App name: "Velotax Bot"
   - User support email: seu email
   - Developer contact: seu email
4. Adicione scopes:
   - `../auth/userinfo.email`
   - `../auth/userinfo.profile`
5. Adicione usuários de teste com domínio @velotax.com.br

### 4. Criar Credenciais

1. Vá para "APIs & Services" > "Credentials"
2. Clique em "Create Credentials" > "OAuth 2.0 Client IDs"
3. Escolha "Web application"
4. Configure:
   - Name: "Velotax Bot Web Client"
   - Authorized JavaScript origins:
     - `http://localhost:3001`
     - `https://seu-dominio-producao.com`
   - Authorized redirect URIs:
     - `http://localhost:3001`
     - `https://seu-dominio-producao.com`

### 5. Configurar Variáveis de Ambiente

Adicione no arquivo `.env`:

```env
GOOGLE_CLIENT_ID=seu_client_id_aqui.apps.googleusercontent.com
DOMINIO_PERMITIDO=@velotax.com.br
```

## Teste da Configuração

1. Inicie o servidor: `node server.js`
2. Acesse: `http://localhost:3001`
3. Clique em "Entrar com Google"
4. Faça login com uma conta @velotax.com.br
5. Verifique se o acesso é concedido

## Troubleshooting

### Erro 400: Invalid Request
- Verifique se as origens JavaScript estão configuradas corretamente
- Confirme se o CLIENT_ID está correto

### Erro: Access Denied
- Verifique se o domínio do usuário está em @velotax.com.br
- Confirme se o usuário está na lista de usuários de teste

### Erro: Client ID not configured
- Verifique se o GOOGLE_CLIENT_ID está no arquivo .env
- Confirme se o servidor está carregando as variáveis de ambiente
