# Vibe Prospecting (Explorium) — integração

Duas formas, ambas sem chave no código nem no navegador:

1. **Data API** (chave do painel *Data API* do Vibe Prospecting): usada pelo script server-side `scripts/vibe.mjs`
   e, na fase seguinte, por uma função Netlify protegida que alimentará o EIFF Radar.
2. **MCP remoto no Claude Code** (`.mcp.json`): `https://vibeprospecting.explorium.ai/mcp`, autenticação OAuth pelo
   navegador na primeira sessão, sem chave. Serve para pesquisa conversacional; exportações consomem créditos.

## Caminho recomendado: pela aplicação (função Netlify `/api/vibe`)

1. No Netlify: Site configuration › Environment variables › `VIBE_API_KEY` (secret). Publique de novo.
2. No sistema, como Administrador ou Diretoria: Radar › Command Center › aba **Vibe Prospecting**:
   1 · Saldo da API e política de créditos (lidos do banco), Testar conexão, Validar catálogo de filtros ·
   2 · Empresas do Radar × Explorium (casar por nome/domínio: 1 crédito por empresa, até 50 por operação) ·
   3 · Cobertura (`DISCOVERY_POOL` + tiers) e amostra de 5 em preview, sem créditos ·
   4 · Operação em duas etapas: **Simular** (sem créditos; a RPC diz se autoriza e qual o limite) → **Confirmar e
   reservar** (grava a operação RESERVED no banco) → **Executar** (a função exige `operationId` + `idempotencyKey`)
   → conclusão automática com o delta real de créditos ·
   5 · Decisores classificados pelo decision fit (uma pessoa por empresa) e importação no Radar (preserva
   `business_id` e `prospect_id`).
   A função (`netlify/functions/vibe.ts`) valida a sessão do Supabase e o papel; a chave nunca chega ao navegador.

## Controle de consumo no servidor (migration 0034)

Nada pago acontece sem uma operação reservada no banco. Budget, reserva e "confirmar" enviados pelo navegador não são
fonte de verdade.

- **`radar_vibe_credit_policy`** (1 linha por organização; criada na migration e na primeira reserva): `enabled`,
  `daily_budget` 60, `monthly_budget` 600, `reserve_credits` 20, `max_credits_per_operation` 40,
  `max_paid_records_per_operation` 20, `email_cache_days` 90, `allowed_roles` {Administrador, Diretoria},
  `validated_filters` (catálogo do autocomplete) e `validated_at`. Leitura por Administrador/Diretoria;
  alteração dos limites financeiros e dos papéis só por Administrador (RLS + GRANT por coluna; Diretoria não aumenta
  o próprio teto); o catálogo validado é gravado pela função Netlify com service_role. Ajustes só por SQL, por enquanto.
- **`radar_vibe_operation`** (ledger, só leitura pelo app): `idempotency_key` (única por organização),
  `request_hash`, `operation_type` (match, discovery, discovery_pool, enrich_email, enrich_phone, test_email),
  `status` (PLANNED → RESERVED → RUNNING → SUCCEEDED | FAILED | UNCERTAIN; CANCELLED), créditos estimados,
  reservados e reais, saldo antes/depois, registros pedidos e devolvidos, `paid_record_cap`, `correlation_ids`,
  erro sanitizado e `result_summary`.
- **Fronteira de confiança (migration 0035)**: `reserve_vibe_operation` e `update_vibe_operation` são
  **server-only** (EXECUTE só para `service_role`; revogado de `public`, `anon` e `authenticated`, com checagem
  extra da claim `role` dentro da função). A função Netlify valida o JWT do usuário (usuário, organização, papel) e
  só então chama essas RPCs com `SUPABASE_SERVICE_ROLE_KEY` (variável só no painel do Netlify: nunca `VITE_`,
  nunca no navegador, nunca em logs ou mensagens de erro, nunca versionada), passando `p_user_id` já validado e
  `p_credits_available` obtido pelo servidor em `/v2/credits`. O navegador nunca fornece o saldo usado na decisão
  e não consegue reservar, cancelar nem marcar RUNNING/FAILED/SUCCEEDED/UNCERTAIN. Sem a service role a função
  responde `configuracao_incompleta` (501) sem fallback para a chave anônima e sem chamar a Explorium.
  `vibe_credits_committed` só é executável por `service_role` (as funções de leitura a usam como definer).
  Leitura (`vibe_operation_state`, `vibe_budget_status`) continua para `authenticated`, sempre por
  `current_org()` e, no caso da política, só para Administrador/Diretoria. Todas as funções SECURITY DEFINER do
  módulo fixam `search_path = public, pg_temp`. A auditoria das escritas é atribuída ao usuário validado.
- **RPCs** (security definer, papel checado no banco): `reserve_vibe_operation(user_id, key, hash, tipo, estimado,
  registros, saldo, cap, dry_run)` decide sob `pg_advisory_xact_lock` por organização com
  limite = min(máximo por operação, diário restante, mensal restante, saldo − reserva); recusa com
  `custo_invalido`, `orcamento_insuficiente`, `registros_acima_do_limite`, `papel_nao_permitido`,
  `politica_desabilitada`. `update_vibe_operation(id, status, campos)` aplica as transições;
  `vibe_operation_state(id)`; `vibe_budget_status(saldo)` alimenta a tela.
- **Idempotência**: mesma chave + mesmo hash → SUCCEEDED devolve o resultado anterior (`ja_executada`),
  RESERVED/RUNNING devolve `operacao_em_andamento`, UNCERTAIN devolve `reconciliacao_necessaria`;
  FAILED/CANCELLED podem ser reservadas de novo na mesma linha. Mesma chave com payload diferente é recusada
  (`payload_diferente`). A função também recusa executar se o hash dos parâmetros não bate com a reserva.
- **Ciclo na função**: marca RUNNING com o saldo antes de chamar a Explorium; SUCCEEDED com saldo depois e delta real;
  erro HTTP → FAILED; rede/timeout depois do envio → UNCERTAIN (bloqueia repetição até reconciliar pelo saldo).
- **Teto global de registros pagos** (`paidRecordCap`, limitado por `max_paid_records_per_operation`): a descoberta
  devolve uma página por chamada com `page_size = min(100, cap restante, política restante, orçamento reservado
  restante)` e para em `cap_atingido`.
- **`DISCOVERY_POOL`**: uma busca ampla com `job_level` + `job_department` validados pelo autocomplete
  (`validar catálogo` na tela ou `node scripts/vibe.mjs validar-filtros`); os candidatos são classificados
  localmente pelo decision fit (`classificarPool`), uma pessoa por empresa. Os tiers por título entram só como
  fallback para empresas sem candidato, e apenas com valores presentes no catálogo. Sem catálogo validado nenhuma
  chamada paga é feita (`catalogo_nao_validado`).
- **Cache de e-mail**: contato com e-mail válido verificado há até `email_cache_days` não é pago de novo. Forçar
  nova verificação: só Administrador, com justificativa (auditada em `radar_vibe_force_refresh`) e nova
  `idempotencyKey`.

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

## Regras operacionais do cliente (script e função)

- `page_size` nunca passa de 100 (limite da AgentSource v2); a descoberta pagina por `next_cursor` até obter empresas
  distintas suficientes (uma pessoa por empresa) ou até 5 páginas, sem presumir que 100 prospects = 100 empresas.
- Enriquecimento: `POST /v2/prospects/contact_information/enrich` com o campo `prospect_id` (string ou lista de até
  50); a resposta é lida de forma defensiva (`prospect_id`/`entity_id`, no item ou em `data`).
- Estimativa separa descoberta (provável e máxima), e-mail, telefone (só com `--telefone`), perfil (só se chamado) e
  reserva; é sempre apresentada como estimativa.
- Budget guard (script): antes de qualquer chamada paga consulta `/v2/credits` e bloqueia se o custo máximo projetado
  passar de `min(--budget, disponíveis − --reserve)` (padrões 180 e 20). Nenhum lote começa parcialmente. Na aplicação
  a decisão é da RPC `reserve_vibe_operation` (seção acima).
- Paginação (`paginar` em `scripts/vibe-core.mjs`): usa `next_cursor` (lido de `page.next_cursor`, `next_cursor` ou
  `pagination.next_cursor`); sem cursor pagina por `page` numérica sem repetir a 1; mantém o conjunto de ids vistos e
  para por `pagina_vazia`, `sem_novos_ids`, `cap_atingido`, `orcamento_atingido`, `max_atingido`,
  `fim_sem_cursor` ou `max_paginas` (motivo impresso no log).
- `node scripts/vibe.mjs validar-filtros` valida pelo autocomplete (grátis) os `job_level`/`job_department` do pool e os
  títulos dos tiers, grava `dados/vibe/filtros-validados.json` e mostra créditos antes/depois. `decisores --executar`
  recusa rodar sem esse catálogo; valores não confirmados nunca entram em chamada paga (`cxo`/`vp` saíram das listas;
  "novos negócios" foi removido).
- `--somente-com-email` aplica `has_contact_details: { value: "email" }` na descoberta (opcional, para não pagar
  e-mail de quem não tem).
- Idempotência: prospects já no CSV de saída ou já importados no Radar são excluídos; e-mail válido verificado dentro
  do cache (`--cache-dias`, padrão 90; coluna `verificado_em`) não é pago de novo; `--force sim --justificativa "..."`
  é a única forma de repetir, e exige `--executar`.
- Log de consumo em `dados/vibe/consumo.log` (JSON por linha, ignorado pelo git): timestamp, operação, registros
  pedidos e devolvidos, créditos antes/depois, delta real, estimativa, correlation_id e status. Sem chave, e-mail
  completo, telefone ou payload pessoal.

## Fluxo do lote piloto

1. Exporte do Vibe a lista `eiff_radar_piloto_empresas_<data>` como CSV **com a coluna `business_id`** (e `id_eiff`
   ou o id externo da empresa no Radar, se existir). Salve em `dados/vibe/` (pasta ignorada pelo git).
2. `node scripts/vibe.mjs decisores --lista dados/vibe/lista.csv --max 56 --amostra 5`
   Mostra a cobertura por prioridade (estatística grátis), 5 registros de amostra em preview e a estimativa de
   créditos. Nada é gravado nem cobrado além da amostra.
3. `node scripts/vibe.mjs validar-filtros` (grátis) e depois `... decisores ... --cap 20 --executar`: busca ampla
   `DISCOVERY_POOL` limitada ao teto de registros pagos, uma pessoa por empresa; tiers por título (engenharia →
   direção industrial → expansão → operações → facilities → COO → proprietário → presidente → CEO → supply chain →
   logística → compras) só como fallback para empresas sem candidato. Grava `dados/vibe/decisores.csv` preservando
   `business_id` e `prospect_id`.
4. `node scripts/vibe.mjs enriquecer --entrada dados/vibe/decisores.csv` mostra o custo (2 créditos por e-mail);
   com `--executar` grava `decisores-enriquecido.csv` com e-mail profissional e status. Telefone só com `--telefone`.
5. Importe o CSV no EIFF Radar (Command Center › Importar CSV › Contatos). As colunas `id_eiff`/`business_id`
   associam o contato à empresa existente; `prospect_id` fica como id externo do contato; `fonte` = VIBE.

## Segurança

- Chave apenas em `VIBE_API_KEY` (ambiente ou `.env.local`); `.gitignore` cobre `.env.*` e `dados/vibe/`.
- `SUPABASE_SERVICE_ROLE_KEY` só no painel do Netlify (server-side), usada apenas depois de o JWT do usuário ter sido
  validado, e nunca para autenticar o usuário. Testes de segurança executados no Postgres (migration 0035): authenticated
  não executa `reserve_vibe_operation`, `update_vibe_operation` nem `vibe_credits_committed` (42501); claim
  `service_role` forjada num JWT de usuário também é negada; `service_role` reserva; usuário sem perfil na
  organização não lê ledger, política nem estado; Diretoria não altera `daily_budget` (0 linhas) mas lê a política;
  Administrador altera e a auditoria registra o ator; tabela temporária com o mesmo nome antes de `public` não muda o
  que `vibe_budget_status` lê; mesma chave em duas reservas gera uma única linha.
- O script recusa rodar sem a variável e mascara qualquer sequência longa em mensagens de erro.
- Exportações contêm dados pessoais: ficam fora do repositório e devem ser importadas no Radar e apagadas.
