# Vibe Prospecting (Explorium) — integração

Duas formas, ambas sem chave no código nem no navegador:

1. **Data API** (chave do painel *Data API* do Vibe Prospecting): usada pelo script server-side `scripts/vibe.mjs`
   e, na fase seguinte, por uma função Netlify protegida que alimentará o EIFF Radar.
2. **MCP remoto no Claude Code** (`.mcp.json`): `https://vibeprospecting.explorium.ai/mcp`, autenticação OAuth pelo
   navegador na primeira sessão, sem chave. Serve para pesquisa conversacional; exportações consomem créditos.

## Caminho recomendado: pela aplicação (função Netlify `/api/vibe`)

1. No Netlify: Site configuration › Environment variables › `VIBE_API_KEY` (secret). Publique de novo.
2. No sistema, como Administrador ou Diretoria: Radar › Command Center › aba **Vibe Prospecting**:
   1 · Testar conexão (créditos, estatística gratuita, 1 registro em preview) ·
   2 · Casar empresas do Radar na Explorium (1 crédito por empresa; grava `business_id`) ·
   3 · Cobertura por prioridade e amostra de 5 (sem créditos) com a estimativa ·
   4 · Buscar até N decisores (1 por empresa, confirmação com custo), importar no Radar (preserva `business_id` e
   `prospect_id`) e enriquecer e-mail profissional (2 créditos cada; telefone só sob pedido).
   A função (`netlify/functions/vibe.ts`) valida a sessão do Supabase e o papel; a chave nunca chega ao navegador.

## Alternativa local: script com a chave em `.env.local`

1. Crie o arquivo `.env.local` na raiz do projeto (já ignorado pelo git por `.env.*`):
   ```
   VIBE_API_KEY=<chave copiada do painel Data API>
   ```
2. Teste sem consumo relevante:
   ```bash
   node scripts/vibe.mjs teste
   ```
   O comando valida a variável, consulta `/v2/credits` (grátis), uma estatística (`/v2/prospects/stats`, grátis) e um
   registro em modo `preview`. A chave nunca é exibida; erros da API são mascarados.

Em produção a chave vai só para o painel do Netlify (Environment variables › `VIBE_API_KEY`, secret), lida pela
função serverless. O front-end nunca recebe a chave nem chama a Explorium diretamente.

## Endpoints usados (base `https://api.explorium.ai`, cabeçalho `api_key`)

| Endpoint | Uso | Custo |
|---|---|---|
| `GET /v2/credits` | saldo | grátis |
| `POST /v2/prospects/stats` | contagem por filtro | grátis |
| `GET /v2/autocomplete?field=&query=` | valores válidos de departamento/nível | grátis |
| `POST /v2/prospects` (`mode: preview`) | amostra com campos limitados | sem consumo relevante |
| `POST /v2/prospects` (`mode: full`) | busca de decisores com `business_id`, `job_department`, `job_level`, `job_title` | ≈ 1 crédito/registro |
| `POST /v2/businesses/match` | resolver `business_id` por nome/domínio (lotes de 50) | 1 crédito/empresa |
| `POST /v2/prospects/contact_information/enrich` | e-mail profissional (+ status) e/ou telefone (lotes de 50) | 2 créditos (e-mail) · 5 (telefone ou ambos) |
| `POST /v2/prospects/profiles/enrich` | perfil (LinkedIn, workplace) | ≈ 1 crédito |

## Fluxo do lote piloto

1. Exporte do Vibe a lista `eiff_radar_piloto_empresas_<data>` como CSV **com a coluna `business_id`** (e `id_eiff`
   ou o id externo da empresa no Radar, se existir). Salve em `dados/vibe/` (pasta ignorada pelo git).
2. `node scripts/vibe.mjs decisores --lista dados/vibe/lista.csv --max 56 --amostra 5`
   Mostra a cobertura por prioridade (estatística grátis), 5 registros de amostra em preview e a estimativa de
   créditos. Nada é gravado nem cobrado além da amostra.
3. `... --executar`: busca os decisores (1 por empresa, na ordem engenharia → direção industrial → expansão →
   operações → facilities → COO → proprietário → presidente → CEO → supply chain → logística → compras) e grava
   `dados/vibe/decisores.csv` preservando `business_id` e `prospect_id`.
4. `node scripts/vibe.mjs enriquecer --entrada dados/vibe/decisores.csv` mostra o custo (2 créditos por e-mail);
   com `--executar` grava `decisores-enriquecido.csv` com e-mail profissional e status. Telefone só com `--telefone`.
5. Importe o CSV no EIFF Radar (Command Center › Importar CSV › Contatos). As colunas `id_eiff`/`business_id`
   associam o contato à empresa existente; `prospect_id` fica como id externo do contato; `fonte` = VIBE.

## Segurança

- Chave apenas em `VIBE_API_KEY` (ambiente ou `.env.local`); `.gitignore` cobre `.env.*` e `dados/vibe/`.
- O script recusa rodar sem a variável e mascara qualquer sequência longa em mensagens de erro.
- Exportações contêm dados pessoais: ficam fora do repositório e devem ser importadas no Radar e apagadas.
