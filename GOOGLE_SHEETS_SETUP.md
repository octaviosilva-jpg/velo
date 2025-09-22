# 📊 Integração com Google Sheets - Velotax Bot

Este documento explica como configurar e usar a integração com Google Sheets para registrar automaticamente feedbacks, respostas coerentes e acessos à interface.

## 🚀 Configuração Inicial

### 1. Criar Projeto no Google Cloud Console

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Ative a **Google Sheets API**:
   - Vá para "APIs & Services" > "Library"
   - Procure por "Google Sheets API"
   - Clique em "Enable"

### 2. Criar Credenciais OAuth 2.0

1. Vá para "APIs & Services" > "Credentials"
2. Clique em "Create Credentials" > "OAuth 2.0 Client IDs"
3. Configure o tipo de aplicação como "Desktop application"
4. Baixe o arquivo JSON das credenciais
5. Renomeie o arquivo para `google-sheets-credentials.json`
6. Coloque o arquivo na raiz do projeto

### 3. Configurar Variáveis de Ambiente

Edite o arquivo `config.env` e configure:

```env
# ===== CONFIGURAÇÕES DO GOOGLE SHEETS =====
# ID da planilha do Google Sheets (obtenha da URL da planilha)
GOOGLE_SHEETS_ID=seu_google_sheets_id_aqui

# Caminho para o arquivo de credenciais JSON do Google
GOOGLE_SHEETS_CREDENTIALS_PATH=google-sheets-credentials.json

# Caminho para o arquivo de token (gerado automaticamente)
GOOGLE_SHEETS_TOKEN_PATH=google-sheets-token.json

# Habilitar integração com Google Sheets (true/false)
ENABLE_GOOGLE_SHEETS=true
```

### 4. Obter ID da Planilha

1. Crie uma nova planilha no [Google Sheets](https://sheets.google.com/)
2. Copie o ID da planilha da URL:
   ```
   https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit
   ```
3. Cole o ID na variável `GOOGLE_SHEETS_ID`

### 5. Autorizar a Aplicação

Execute o comando para obter o token de autorização:

```bash
node google-sheets-auth.js
```

Siga as instruções para autorizar a aplicação e obter o token.

## 📋 Estrutura das Planilhas

O sistema criará automaticamente as seguintes planilhas:

### 📝 Planilha "Feedbacks"
Registra todos os feedbacks de respostas e moderações:

| Coluna | Descrição |
|--------|-----------|
| Data/Hora | Timestamp do feedback |
| ID | ID único do feedback |
| Tipo | Tipo (resposta/moderação) |
| Texto Cliente | Texto original do cliente |
| Resposta Anterior | Resposta antes do feedback |
| Feedback | Feedback fornecido |
| Resposta Reformulada | Resposta após feedback |
| Tipo Solicitação | Tipo da solicitação |
| Motivo Solicitação | Motivo da solicitação |
| Solução Implementada | Solução aplicada |
| Histórico Atendimento | Histórico do atendimento |
| Observações Internas | Observações internas |

### ✅ Planilha "Respostas Coerentes"
Registra respostas que foram aprovadas:

| Coluna | Descrição |
|--------|-----------|
| Data/Hora | Timestamp da resposta |
| ID | ID único da resposta |
| Tipo | Tipo da resposta |
| Texto Cliente | Texto original do cliente |
| Resposta Final | Resposta final aprovada |
| Tipo Solicitação | Tipo da solicitação |
| Motivo Solicitação | Motivo da solicitação |
| Solução Implementada | Solução aplicada |
| Histórico Atendimento | Histórico do atendimento |
| Observações Internas | Observações internas |
| Status Aprovação | Status (Aprovada) |

### 🔍 Planilha "Acessos Interface"
Registra acessos e ações na interface:

| Coluna | Descrição |
|--------|-----------|
| Data/Hora | Timestamp do acesso |
| Usuário | Usuário que acessou |
| Ação | Ação realizada |
| IP | Endereço IP |
| User Agent | Navegador/dispositivo |
| Duração Sessão (min) | Duração da sessão |
| Status | Status do acesso |

### 📊 Planilha "Estatísticas"
Registra estatísticas globais do sistema:

| Coluna | Descrição |
|--------|-----------|
| Data | Data das estatísticas |
| Respostas Geradas | Total de respostas geradas |
| Respostas Coerentes | Total de respostas coerentes |
| Moderações Geradas | Total de moderações geradas |
| Moderações Coerentes | Total de moderações coerentes |
| Revisões Texto | Total de revisões de texto |
| Explicações Geradas | Total de explicações geradas |

## 🔧 Funcionalidades

### Registro Automático

O sistema registra automaticamente:

- ✅ **Feedbacks de respostas** - Quando um feedback é fornecido
- ✅ **Feedbacks de moderações** - Quando uma moderação é feita
- ✅ **Respostas coerentes** - Quando uma resposta é aprovada
- ✅ **Acessos à interface** - Quando alguém acessa o sistema
- ✅ **Estatísticas** - Estatísticas globais do sistema

### Sincronização de Dados Existentes

Na primeira inicialização, o sistema sincroniza automaticamente todos os dados existentes dos arquivos JSON para o Google Sheets.

### Modo de Produção

O sistema funciona tanto em desenvolvimento local quanto em produção (Vercel), adaptando-se automaticamente ao ambiente.

## 🚨 Solução de Problemas

### Erro de Autenticação

Se você receber erros de autenticação:

1. Verifique se o arquivo `google-sheets-credentials.json` está correto
2. Execute novamente `node google-sheets-auth.js`
3. Verifique se o token não expirou

### Erro de Permissões

Se você receber erros de permissões:

1. Verifique se a Google Sheets API está habilitada
2. Verifique se o ID da planilha está correto
3. Certifique-se de que a planilha é acessível

### Integração Não Funciona

Se a integração não estiver funcionando:

1. Verifique se `ENABLE_GOOGLE_SHEETS=true` no `config.env`
2. Verifique os logs do servidor para mensagens de erro
3. Certifique-se de que todas as dependências estão instaladas

## 📝 Exemplos de Uso

### Registrar Acesso Manualmente

```javascript
// Via API
fetch('/api/registrar-acesso', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        acao: 'Login',
        usuario: 'usuario@velotax.com.br'
    })
});
```

### Verificar Status da Integração

```javascript
// Verificar se está ativa
if (googleSheetsIntegration.isActive()) {
    console.log('Google Sheets está ativo');
} else {
    console.log('Google Sheets não está ativo');
}
```

## 🔒 Segurança

- As credenciais são armazenadas localmente
- O token é gerado automaticamente e renovado conforme necessário
- A integração respeita as configurações de segurança do servidor
- Rate limiting é aplicado aos endpoints

## 📞 Suporte

Para dúvidas ou problemas:

1. Verifique os logs do servidor
2. Consulte este documento
3. Verifique a documentação da Google Sheets API
4. Entre em contato com a equipe de desenvolvimento

---

**Nota**: Esta integração é opcional e pode ser desabilitada definindo `ENABLE_GOOGLE_SHEETS=false` no arquivo de configuração.
