# Configuração de Domínio - Velotax Bot

## Domínio Corporativo Permitido

O sistema está configurado para permitir acesso apenas a usuários com domínio corporativo:

**Domínio Permitido:** `@velotax.com.br`

## Configuração no Google Cloud Console

Para que a autenticação Google funcione corretamente, é necessário configurar:

### 1. Origens JavaScript Autorizadas
- `http://localhost:3001` (desenvolvimento)
- `https://seu-dominio-producao.com` (produção)

### 2. URIs de Redirecionamento Autorizados
- `http://localhost:3001` (desenvolvimento)
- `https://seu-dominio-producao.com` (produção)

### 3. Tela de Consentimento OAuth
- Status: Publicado
- Usuários de teste: Adicionar emails @velotax.com.br

## Variáveis de Ambiente

```env
DOMINIO_PERMITIDO=@velotax.com.br
GOOGLE_CLIENT_ID=seu_client_id_aqui.apps.googleusercontent.com
```

## Validação de Acesso

O sistema valida automaticamente se o email do usuário termina com `@velotax.com.br` antes de permitir o acesso à aplicação.
