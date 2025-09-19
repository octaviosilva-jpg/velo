# 🔧 Configuração de Domínio - Velotax Bot

## 📋 **Visão Geral**
Este documento explica como alterar as configurações de domínio, nome da empresa e site no sistema Velotax Bot.

---

## 🎯 **1. CONFIGURAÇÕES PRINCIPAIS**

### **Arquivo: `script.js` (linhas 4-6)**
```javascript
// ================== CONFIGURAÇÕES ==================
const DOMINIO_CORPORATIVO = "@velotax.com.br"; // Domínio corporativo para validação
const NOME_EMPRESA = "Velotax"; // Nome da empresa
const SITE_EMPRESA = "www.velotax.com.br"; // Site da empresa
```

### **Arquivo: `auth.js` (linha 6)**
```javascript
const DOMINIO_PERMITIDO = "@velotax.com.br"; // Domínio corporativo
```

---

## 🔄 **2. COMO ALTERAR AS CONFIGURAÇÕES**

### **Método 1: Edição Manual (Recomendado)**

1. **Abra o arquivo `script.js`**
2. **Localize as linhas 4-6:**
   ```javascript
   const DOMINIO_CORPORATIVO = "@velotax.com.br";
   const NOME_EMPRESA = "Velotax";
   const SITE_EMPRESA = "www.velotax.com.br";
   ```

3. **Altere para seus valores:**
   ```javascript
   const DOMINIO_CORPORATIVO = "@sua-empresa.com.br";
   const NOME_EMPRESA = "Sua Empresa";
   const SITE_EMPRESA = "www.sua-empresa.com.br";
   ```

4. **Abra o arquivo `auth.js`**
5. **Localize a linha 6:**
   ```javascript
   const DOMINIO_PERMITIDO = "@velotax.com.br";
   ```

6. **Altere para o mesmo domínio:**
   ```javascript
   const DOMINIO_PERMITIDO = "@sua-empresa.com.br";
   ```

### **Método 2: Função JavaScript (Temporário)**

```javascript
// No console do navegador ou no código
window.velotaxBot.alterarConfiguracaoEmpresa(
    "@sua-empresa.com.br",    // Novo domínio
    "Sua Empresa",            // Novo nome
    "www.sua-empresa.com.br"  // Novo site
);
```

**⚠️ Nota:** Este método é apenas para visualização. Para alteração permanente, use o Método 1.

---

## 📝 **3. EXEMPLOS DE CONFIGURAÇÃO**

### **Para uma empresa de tecnologia:**
```javascript
const DOMINIO_CORPORATIVO = "@techcorp.com.br";
const NOME_EMPRESA = "TechCorp";
const SITE_EMPRESA = "www.techcorp.com.br";
```

### **Para uma empresa financeira:**
```javascript
const DOMINIO_CORPORATIVO = "@financeira.com.br";
const NOME_EMPRESA = "Financeira ABC";
const SITE_EMPRESA = "www.financeira.com.br";
```

### **Para uma startup:**
```javascript
const DOMINIO_CORPORATIVO = "@startup.io";
const NOME_EMPRESA = "StartupXYZ";
const SITE_EMPRESA = "www.startup.io";
```

---

## 🔍 **4. ONDE AS CONFIGURAÇÕES SÃO USADAS**

### **No sistema de autenticação:**
- Validação de domínio corporativo no login
- Verificação de e-mails permitidos

### **Nos textos gerados:**
- Nome da empresa nas respostas
- Site da empresa nas instruções
- Assinatura dos e-mails

### **Nos exemplos e templates:**
- Casos de teste
- Mensagens explicativas
- Instruções para clientes

---

## ✅ **5. CHECKLIST DE ALTERAÇÃO**

- [ ] Alterar `DOMINIO_CORPORATIVO` em `script.js`
- [ ] Alterar `NOME_EMPRESA` em `script.js`
- [ ] Alterar `SITE_EMPRESA` em `script.js`
- [ ] Alterar `DOMINIO_PERMITIDO` em `auth.js`
- [ ] Reiniciar o servidor
- [ ] Testar login com novo domínio
- [ ] Verificar textos gerados
- [ ] Validar assinaturas de e-mail

---

## 🚨 **6. IMPORTANTE**

### **Sincronização:**
- **SEMPRE** altere o domínio nos dois arquivos (`script.js` e `auth.js`)
- Os domínios devem ser **exatamente iguais** nos dois arquivos

### **Reinicialização:**
- Após alterar as configurações, **reinicie o servidor**
- Recarregue a página no navegador

### **Teste:**
- Teste o login com uma conta do novo domínio
- Verifique se os textos são gerados corretamente
- Confirme se as assinaturas estão corretas

---

## 🔧 **7. FUNÇÕES DISPONÍVEIS**

### **Verificar configurações atuais:**
```javascript
console.log(window.velotaxConfig);
```

### **Alterar configurações (temporário):**
```javascript
window.velotaxBot.alterarConfiguracaoEmpresa(
    "@novo-dominio.com.br",
    "Nova Empresa",
    "www.novo-dominio.com.br"
);
```

### **Verificar domínio atual:**
```javascript
console.log("Domínio atual:", window.velotaxConfig.DOMINIO_CORPORATIVO);
console.log("Nome atual:", window.velotaxConfig.NOME_EMPRESA);
console.log("Site atual:", window.velotaxConfig.SITE_EMPRESA);
```

---

## 📞 **8. SUPORTE**

Se precisar de ajuda para alterar as configurações:

1. **Verifique os logs do console** para erros
2. **Confirme se os domínios estão sincronizados**
3. **Reinicie o servidor** após as alterações
4. **Teste com uma conta válida** do novo domínio

---

**🎯 Pronto! Agora você sabe como alterar todas as configurações de domínio no Velotax Bot!**
