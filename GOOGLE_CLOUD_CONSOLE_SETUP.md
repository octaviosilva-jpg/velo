# 🔧 Configuração do Google Cloud Console para Localhost

## ❌ Problema Atual
O erro 400 indica que o CLIENT_ID não está configurado para permitir `http://localhost:3001` no Google Cloud Console.

## ✅ Solução Passo a Passo

### 1. Acesse o Google Cloud Console
- Vá para: https://console.cloud.google.com/
- Faça login com sua conta Google

### 2. Selecione o Projeto
- Selecione o projeto que contém o CLIENT_ID: `108948157850402889475`

### 3. Configure as Credenciais OAuth 2.0
- Vá em **"APIs e Serviços"** → **"Credenciais"**
- Encontre o CLIENT_ID: `108948157850402889475.apps.googleusercontent.com`
- Clique no nome do CLIENT_ID para editá-lo

### 4. Adicione as Origens Autorizadas
Na seção **"Origens JavaScript autorizadas"**, adicione:
```
http://localhost:3001
```

### 5. Adicione os URIs de Redirecionamento
Na seção **"URIs de redirecionamento autorizados"**, adicione:
```
http://localhost:3001
http://localhost:3001/
```

### 6. Salve as Alterações
- Clique em **"Salvar"** no final da página
- Aguarde alguns minutos para as alterações serem propagadas

### 7. Teste a Configuração
- Acesse: http://localhost:3001
- Clique em "Entrar com Google"
- O popup deve abrir sem erro 400

## 🔍 Verificação da Configuração

### URLs que devem estar configuradas:
- **Origens JavaScript autorizadas:**
  - `http://localhost:3001`
  - `https://seu-dominio.com` (para produção)

- **URIs de redirecionamento autorizados:**
  - `http://localhost:3001`
  - `http://localhost:3001/`
  - `https://seu-dominio.com` (para produção)

## ⚠️ Problemas Comuns

### 1. CLIENT_ID Incorreto
- Verifique se o CLIENT_ID está correto: `108948157850402889475.apps.googleusercontent.com`
- Deve terminar com `.apps.googleusercontent.com`

### 2. Domínio não Autorizado
- Certifique-se de que `http://localhost:3001` está na lista de origens autorizadas
- Não use `https://localhost:3001` (localhost não suporta HTTPS)

### 3. Propagação de Alterações
- As alterações no Google Cloud Console podem levar até 10 minutos para serem propagadas
- Aguarde alguns minutos após salvar as configurações

### 4. Cache do Navegador
- Limpe o cache do navegador (Ctrl+F5)
- Ou use uma aba anônima para testar

## 🚀 Teste Rápido

Após configurar o Google Cloud Console:

1. **Acesse**: http://localhost:3001
2. **Clique**: "Entrar com Google"
3. **Resultado esperado**: Popup do Google abre sem erro 400
4. **Login**: Use uma conta @velotax.com.br
5. **Sucesso**: Interface principal aparece

## 📞 Suporte

Se ainda houver problemas:
1. Verifique se o CLIENT_ID está correto
2. Confirme que `http://localhost:3001` está nas origens autorizadas
3. Aguarde a propagação das alterações (até 10 minutos)
4. Limpe o cache do navegador
5. Teste em uma aba anônima

---
**Última atualização**: 17/01/2025
**Status**: Aguardando configuração do Google Cloud Console
