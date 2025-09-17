# 🚀 VELOTAX BOT - Sistema Seguro com Backend

## 🔐 Sistema de Segurança Implementado

Este sistema foi desenvolvido com **máxima segurança** para proteger as chaves da API OpenAI, mantendo-as no backend e longe do frontend.

---

## 📁 Estrutura do Projeto

```
velotax-bot/
├── .env                    # 🔒 Configurações sensíveis (BACKEND)
├── server.js              # 🖥️ Servidor backend seguro
├── package.json           # 📦 Dependências do backend
├── start.bat              # 🚀 Script de inicialização (Windows)
├── start.sh               # 🚀 Script de inicialização (Linux/Mac)
├── index.html             # 🌐 Interface frontend
├── script-fixed.js        # 💻 Lógica do frontend
├── openai-config.js       # ⚙️ Configuração da API
├── env-loader.js          # 🔐 Carregador seguro
├── .gitignore             # 🛡️ Proteção de arquivos sensíveis
├── SECURITY.md            # 📋 Guia de segurança
└── README.md              # 📖 Este arquivo
```

---

## 🚀 Como Iniciar o Sistema

### **Windows:**
```bash
# Duplo clique no arquivo start.bat
# OU execute no terminal:
start.bat
```

### **Linux/Mac:**
```bash
# Execute no terminal:
./start.sh
```

### **Manual:**
```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor
node server.js
```

---

## ⚙️ Configuração da Chave da API

### **1. Editar arquivo .env:**
```bash
# Abra o arquivo .env na raiz do projeto
OPENAI_API_KEY=sua_chave_aqui
```

### **2. Iniciar o sistema:**
- Execute `start.bat` (Windows) ou `./start.sh` (Linux/Mac)
- O servidor iniciará na porta 3001

### **3. Acessar a interface:**
- Abra: http://localhost:3001
- A chave será carregada automaticamente do backend

---

## 🔒 Recursos de Segurança

### **🛡️ Proteção de Dados:**
- ✅ Chave da API armazenada no backend
- ✅ Arquivo .env protegido pelo .gitignore
- ✅ Criptografia de dados sensíveis
- ✅ Validação de formato da chave
- ✅ Rate limiting nas requisições

### **📊 Monitoramento:**
- ✅ Logs de segurança detalhados
- ✅ Contador de chamadas à API
- ✅ Alertas automáticos
- ✅ Estatísticas de uso

### **🔄 Fallback Seguro:**
- ✅ Sistema funciona com ou sem backend
- ✅ Validações locais como backup
- ✅ Configurações padrão seguras

---

## 🌐 Endpoints da API

### **Status do Servidor:**
```
GET /api/status
```

### **Configurações Públicas:**
```
GET /api/config/public
```

### **Validar Chave da API:**
```
POST /api/validate-key
Body: { "apiKey": "sua_chave" }
```

### **Testar OpenAI:**
```
POST /api/test-openai
Body: { "apiKey": "sua_chave" }
```

### **Configurações Seguras:**
```
POST /api/config/secure
Body: { "apiKey": "sua_chave" }
```

---

## 🔧 Configurações Disponíveis

### **Arquivo .env:**
```bash
# API OpenAI
OPENAI_API_KEY=sua_chave_aqui
OPENAI_MODEL=gpt-4o
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=2000
OPENAI_BASE_URL=https://api.openai.com/v1

# Segurança
ENCRYPTION_KEY=velotax_secure_key_2024
SESSION_TIMEOUT=3600000
MAX_API_CALLS_PER_HOUR=100

# Aplicação
APP_NAME=Velotax Bot
APP_VERSION=2.0.0
DEBUG_MODE=false
LOG_LEVEL=info
```

---

## 🚨 Troubleshooting

### **Backend não inicia:**
1. Verifique se Node.js está instalado
2. Execute `npm install` para instalar dependências
3. Verifique se a porta 3001 está livre

### **Chave da API não funciona:**
1. Verifique o formato da chave (deve começar com `sk-`)
2. Confirme se a chave está no arquivo `.env`
3. Teste a chave no painel da OpenAI

### **Erro de CORS:**
1. Certifique-se de acessar via `http://localhost:3001`
2. Não use `file://` - use o servidor backend

### **Arquivo .env não encontrado:**
1. Crie o arquivo `.env` na raiz do projeto
2. Copie o conteúdo do exemplo acima
3. Adicione sua chave da API

---

## 📋 Checklist de Segurança

### **Configuração Inicial:**
- [ ] Arquivo `.env` criado na raiz
- [ ] Chave da API configurada
- [ ] Arquivo `.gitignore` atualizado
- [ ] Backend iniciado na porta 3001
- [ ] Interface acessível via http://localhost:3001

### **Uso Diário:**
- [ ] Backend rodando
- [ ] Chave da API válida
- [ ] Logs de segurança verificados
- [ ] Limite de chamadas respeitado
- [ ] Sistema funcionando normalmente

---

## 🔍 Logs e Monitoramento

### **Logs do Backend:**
```bash
🚀 Servidor Velotax Bot iniciado!
📡 Porta: 3001
🌐 URL: http://localhost:3001
🔐 Sistema de segurança ativo
📁 Arquivo .env carregado da raiz do projeto
✅ Arquivo .env encontrado na raiz
```

### **Logs do Frontend:**
```bash
🔐 Inicializando sistema seguro...
✅ Backend online
✅ Configurações carregadas do backend
✅ Chave da API carregada do arquivo .env
```

---

## 📞 Suporte

### **Em Caso de Problemas:**
1. Verifique os logs do console
2. Confirme se o backend está rodando
3. Valide as configurações do arquivo .env
4. Teste a conexão com a API

### **Contatos:**
- **Suporte Técnico:** [seu-email@velotax.com]
- **Segurança:** [security@velotax.com]

---

## ⚖️ Compliance e LGPD

- ✅ Dados armazenados localmente
- ✅ Criptografia de informações sensíveis
- ✅ Logs de acesso mantidos
- ✅ Retenção de dados controlada
- ✅ Direito ao esquecimento implementado

---

**⚠️ IMPORTANTE: Mantenha sempre o backend rodando e o arquivo .env protegido. A segurança é responsabilidade de todos!**