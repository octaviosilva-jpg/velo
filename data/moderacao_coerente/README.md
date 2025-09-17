# Pasta de Moderação Coerente

Esta pasta contém os modelos de moderações que foram aprovadas como "coerentes" pelo usuário.

## Arquivos

- `modelos_moderacoes.json` - Arquivo principal contendo todos os modelos de moderações aprovadas
- `README.md` - Este arquivo explicativo

## Como funciona

1. **Geração de Moderação**: O usuário gera uma solicitação de moderação
2. **Avaliação**: O usuário avalia se a moderação está coerente
3. **Salvamento**: Se marcada como "coerente", é salva automaticamente como modelo
4. **Aprendizado**: Modelos salvos são aplicados automaticamente em futuras gerações

## Estrutura dos Modelos

Cada modelo contém:
- **Dados da moderação original** (solicitação, resposta, motivo, consideração)
- **Linha de raciocínio interna** gerada
- **Texto final de moderação** aprovado
- **Contexto** para referência futura

## Aprendizado Automático

Os modelos são consultados automaticamente pelo sistema para:
- Seguir padrões aprovados
- Evitar erros repetidos
- Melhorar a qualidade das gerações

## Manutenção

- Os modelos são salvos automaticamente
- Não é necessário intervenção manual
- O sistema mantém os 3 modelos mais recentes por tipo de motivo
