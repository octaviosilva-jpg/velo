# 🔧 CONFIGURAR VARIÁVEIS DE AMBIENTE NA VERCEL

## 🚨 PROBLEMA:
O arquivo `.env` não é commitado no Git, então as alterações não sobem automaticamente para a Vercel.

## ✅ SOLUÇÃO:
Configure as variáveis de ambiente diretamente no painel da Vercel.

### 📋 PASSOS:

#### 1. Acesse o Painel da Vercel:
- URL: https://vercel.com/dashboard
- Entre no projeto: `velotax-bot-v2`

#### 2. Configure as Variáveis de Ambiente:
- Vá para: **Settings** > **Environment Variables**
- Adicione/edite as seguintes variáveis:

```
GOOGLE_CLIENT_ID = [SEU_CLIENT_ID_AQUI]
GOOGLE_CLIENT_SECRET = [SEU_CLIENT_SECRET_AQUI]
```

#### 3. Deploy:
- Após salvar, a Vercel fará um novo deploy automaticamente
- Ou force um redeploy em: **Deployments** > **Redeploy**

### 🧪 TESTE:
Após o deploy, teste em: https://velotax-bot-v2.vercel.app/

### 📝 NOTA:
- O CLIENT_ID correto já está configurado no Google Cloud Console
- Apenas precisa atualizar na Vercel
