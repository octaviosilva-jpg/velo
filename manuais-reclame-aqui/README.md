# Manuais Reclame Aqui (oficiais)

Esta pasta é para guardar **cópias locais** dos manuais que o bot referencia nos prompts (`server.js`, `script.js`), para backup e consulta sem depender só da internet.

## Manuais utilizados pelo projeto

1. **Manual Geral de Moderação** (conteúdo / moderação)
2. **Manual de Moderação – Bancos, Instituições Financeiras e Meios**

> O **Manual de Moderação RA Reviews** não é utilizado neste projeto.

## Onde obter os arquivos oficiais

- Portal de manuais do RA: [manual.reclameaqui.com.br](https://manual.reclameaqui.com.br/)
- Seção de moderação: [manual.reclameaqui.com.br/moderacao](https://manual.reclameaqui.com.br/moderacao)

Baixe os PDFs (ou exporte da página) e salve **nesta pasta** com nomes claros:

- `manual-moderacao-geral.pdf`
- `manual-moderacao-bancos-financeiras.pdf`

## Como o bot consulta os manuais (base normativa)

O servidor lê o arquivo **`manuais-moderacao.json`** (nesta pasta) e injeta as hipóteses relevantes nos prompts:

- **Moderação** (`/api/generate-moderation`): bloco "BASE NORMATIVA — MANUAIS DO RA" com as hipóteses que os fatos do caso sustentam + como citar.
- **Resposta RA** (`/api/gerar-resposta`): checklist "CONFORMIDADE COM OS MANUAIS DO RA" para a resposta pública não violar as regras (mantendo tom e estrutura atuais).

> **Status atual:** a base está **ATIVA e preenchida** a partir dos PDFs oficiais (versão `1.2` do `manuais-moderacao.json`): 7 categorias de moderação, requisitos e 6 regras da categoria AENV, 15 hipóteses do Manual Geral e 11 hipóteses do Manual de Bancos. Cada hipótese traz `origem` (`manual-geral-oficial` / `manual-bancos-oficial`) para auditoria.

Se o `hipoteses` de todos os manuais ficar **vazio**, a base volta a ficar **inativa** (nada é injetado). Veja o campo `_schema` no JSON para o formato de cada hipótese.

### Como atualizar a base a partir dos PDFs

1. Mantenha os PDFs oficiais nesta pasta (já presentes):
   - `Manual Geral de Moderação de Conteúdo - Reclame AQUI.pdf`
   - `Manual de Moderação - Bancos, Instituições Financeiras e Meios (1).pdf`
2. Avise o assistente: ele lê os PDFs e atualiza o `manuais-moderacao.json` com as hipóteses estruturadas (título, categoria, ação, status, prazo, quando se aplica, critérios, como citar, palavras-chave).
3. Reinicie o servidor — o log deve mostrar `📚 Manuais de moderação carregados: N manuais, M temas, K regras AENV`.

## Backup

Ao gerar uma cópia segura do projeto, inclua esta pasta — assim os manuais (PDFs + `manuais-moderacao.json`) viajam junto com o código.

Quando a pasta estiver só com este README, o backup ainda **não** contém os PDFs; após adicionar os arquivos acima, gere o backup de novo.
