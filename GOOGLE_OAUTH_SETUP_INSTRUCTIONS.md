# 🔐 Configuração do Google OAuth para Localhost

## ⚠️ Problema Atual
O CLIENT_ID `108948157850402889475` não está configurado para aceitar `localhost:3001` no Google Cloud Console.

## 🛠️ Solução

### 1. Acesse o Google Cloud Console
- URL: https://console.cloud.google.com/
- Faça login com sua conta Google

### 2. Navegue para as Credenciais OAuth
- Vá para **APIs & Services** > **Credentials**
- Encontre o OAuth 2.0 Client ID: `108948157850402889475`

### 3. Configure as URLs Autorizadas
Adicione as seguintes URLs nas **Authorized JavaScript origins**:
```
http://localhost:3001
http://127.0.0.1:3001
```

### 4. Configure os Redirect URIs (se necessário)
Adicione nas **Authorized redirect URIs**:
```
http://localhost:3001
http://127.0.0.1:3001
```

### 5. Salve as Configurações
- Clique em **Save**
- Aguarde alguns minutos para a propagação

## 🔍 Verificação

### Teste Local
1. Acesse: http://localhost:3001
2. Clique no botão "Entrar com Google"
3. O popup do Google deve abrir corretamente

### Logs do Servidor
Verifique se aparecem os logs:
```
🔧 GOOGLE_CLIENT_ID carregado: 108948157850402889475
🎯 Endpoint /api/google-config chamado
```

## 📋 Configuração Atual

### Arquivo .env
```env
GOOGLE_CLIENT_ID=108948157850402889475
GOOGLE_CLIENT_SECRET=seu_google_client_secret_aqui
DOMINIO_PERMITIDO=@velotax.com.br
```

### Endpoint de Teste
- URL: http://localhost:3001/api/google-config
- Retorna: `{"success":true,"clientId":"108948157850402889475","dominioPermitido":"@velotax.com.br"}`

## 🚨 Troubleshooting

### Se ainda não funcionar:
1. **Verifique o domínio**: Certifique-se que `localhost:3001` está nas URLs autorizadas
2. **Aguarde propagação**: Pode levar até 10 minutos para as mudanças entrarem em vigor
3. **Limpe o cache**: Limpe o cache do navegador
4. **Verifique o console**: Abra o console do navegador para ver erros específicos

### Erros Comuns:
- `Error 400: redirect_uri_mismatch`: URL de redirecionamento não autorizada
- `Error 403: access_denied`: Domínio não autorizado
- `Error 401: invalid_client`: CLIENT_ID inválido

## ✅ Status Atual
- ✅ CLIENT_ID configurado no arquivo .env
- ✅ Servidor carregando configurações corretamente
- ✅ Endpoint /api/google-config funcionando
- ⚠️ **Pendente**: Configurar localhost no Google Cloud Console
