# S1 — Chave de serviço do Supabase: compatibilidade com `sb_secret` (R1) e roteiro de rotação

> **R1: código pronto, NÃO mesclado.** Nenhuma credencial foi criada, trocada ou revogada. Os portões seguem separados:
> «MERGE AUTORIZADO» (este PR), R2 (criar as chaves novas), R3A (validar sem escrita), R3B (escritas em ambiente descartável), R4 em diante (trocar, publicar, desativar
> as legadas), cada um com autorização própria da Direção.

## 1. Contexto

- **Fase A (concluída em 17/11/2026):** `SUPABASE_SERVICE_ROLE_KEY`, `VIBE_API_KEY` e `GITHUB_READ_TOKEN` passaram a ter valor
  só em Production; o valor de Production foi preservado (mesmo identificador interno). O escopo Builds/Runtime das duas
  primeiras ficou travado no painel (secreta não edita escopo sem recriar).
- **Risco que continua:** cerca de 180 pré-visualizações e 153 deploys de produção antigos guardam a chave legada no
  ambiente do build. Só invalidar a chave resolve, e a chave legada `service_role` (JWT) só morre quando as chaves
  legadas forem **desativadas** no painel do Supabase — o que desliga `anon` e `service_role` juntas.
- **Caminho:** migrar para as chaves novas (`sb_secret_…` no servidor, `sb_publishable_…` no navegador) e então
  desativar as legadas.

## 1.1 O que a documentação da Supabase diz (conferido em 17/11/2026)

- «Understanding API keys» e «Migrating to publishable and secret API keys»: mandar as chaves novas no cabeçalho `apikey`,
  **não** em `Authorization: Bearer`; como não são JWT, quem tenta validá-las como JWT recusa (`Invalid JWT`).
- A documentação **não fala** do Auth admin com a chave nova, nem promete aceitar `Authorization` idêntico ao `apikey`
  (essa regra aparecia em versões anteriores da página e não está no texto atual).
- Issue supabase-js #1568: `auth.admin.createUser` / `inviteUserByEmail` com a chave nova falhavam com `bad_jwt` porque o
  cliente copiava a chave para o `Authorization`; fechada em 28/10/2025 com «a chave nova pode ser usada com o cliente
  admin». É o caminho B — por isso a R3A e a R3B medem A e B nas rotas do Auth em vez de presumir.

## 2. O que a R1 muda (`src/core/chaveServico.ts`)

| Chave | Banco (PostgREST, RPC) | Auth admin (`/auth/v1/admin`, convite, recuperação) |
|---|---|---|
| Legada (JWT) — a de hoje | `apikey` + `Authorization: Bearer <chave>` (**igual a antes**) | igual a antes |
| Nova `sb_secret_…` | só `apikey` (o caminho recomendado pela Supabase) | `apikey` + `Authorization` **idêntico** (a regra de compatibilidade documentada e o que o próprio supabase-js 2.114 faz) |
| `sb_publishable_…`, `sb_temp_…`, outro `sb_…`, vazia | **erro: falha fechada** — nenhuma requisição sai | idem |

Qualquer valor que não comece por `sb_` segue o caminho legado (é o comportamento atual; a chave em produção hoje é JWT).

Aplicado em: `portaLivro` (e-mail), `portaIngestRpc` e `configPortaIngest` (ingestão do Inbox), `roteamentoPorta`
(roteamento), `rpcEntrega` (Octadesk), `portasFormularioRest` e `montarPortasIntegracao` (formulário do site), `cliente`
de `usuariosServidor` (banco × Auth admin separados), e nas funções `vibe`, `widget-caixa`, `diretor-financeiro` e
`email-comercial`. O cliente supabase-js do servidor (`src/data/clienteServidor.ts`) passa a usar `fetchServico`, que
tira o `Authorization` igual à chave nova das chamadas ao banco.

**Não muda:** as chamadas feitas com o JWT do usuário (sempre com a chave anônima no `apikey`), permissões, RLS, RPCs,
migrations, variáveis. Com a chave legada, cada requisição sai com os **mesmos cabeçalhos** de antes (provado por teste).

## 3. Provas (nenhuma rede, nenhuma credencial real)

`src/core/chaveServico.test.ts` (30): classificação e falha fechada; cabeçalhos das duas chaves; mensagem de erro nunca
contém o valor; `fetchServico`; o supabase-js 2.114 REAL com a chave nova (sem `Authorization` no banco) e a legada (com);
cada porta privilegiada com as duas chaves; usuários com banco × Auth admin e o JWT do usuário sempre com a chave anônima;
chave publicável recusada antes de qualquer requisição na ingestão, no formulário, em usuários e no livro do e-mail; e uma
**guarda** que varre `src/` e `netlify/` e falha se algum arquivo voltar a montar à mão `apikey` + `Authorization` com a
mesma variável; e três guardas de credencial: nenhum arquivo do repositório tem chave `sb_` real (só fictícias marcadas),
o CI e o `package.json` nunca citam os scripts da R3 nem `sb_secret`, a chave só entra pelo teclado de terminal interativo e
nunca é impressa, a R3A tem uma única função de requisição que só aceita HEAD/GET, e a R3B recusa a URL de produção antes
de pedir a chave.

## 4. Procedimento das chaves novas (R2 → R6) — cada passo com autorização própria

### R2 — criar (Augusto, painel do Supabase)
1. `supabase.com/dashboard` › projeto `dduobppgomqyagjviwpx` › **Settings › API Keys** › aba das chaves novas
   («Publishable and secret API keys»).
2. **Create new secret key**, nome `netlify-functions`. Copiar UMA vez para o gerenciador de senhas. Não colar no chat.
3. Conferir que já existe uma chave publicável (`default`); **não criar outra** se existir. É pública por desenho e só será
   usada na R5.
4. Nada muda no ar: criar chaves novas não revoga as legadas.

### R3A — homologação SEM ESCRITA em produção (Augusto, terminal dele, após autorização)
```powershell
node scripts/s1/validar-chave-secreta.mjs
```
O script pede a chave com a digitação **oculta** (`scripts/s1/entradaOculta.mjs`: Windows PowerShell 5.1 e 7, sem
`Read-Host -MaskInput`, sem variável de ambiente, sem argumento, sem histórico; sem terminal interativo, recusa). A chave fica só
na memória do processo e nenhuma saída a contém. **Só HEAD e GET**: uma única função faz requisição e lança erro para
qualquer outro método; o script não tem corpo de requisição nem rota de escrita (guardas em `chaveServico.test.ts`).
Nenhum teste e nenhum workflow roda o script.

Cada prova roda nos dois formatos — **A** só `apikey`, **B** `apikey` + `Authorization` idêntico. Obrigatórias: A no banco e
B no Auth admin (o que o código da R1 usa); as demais são diagnóstico.

| Prova | Requisição | Obrigatória | Espera | O que prova |
|---|---|---|---|---|
| `banco_leitura` | HEAD `/rest/v1/organization?select=id` + `Prefer: count=exact` | A | 200/206, contagem ≥ 1 | a chave entra como `service_role` (a RLS de `organization` daria 0 a qualquer outro papel); nenhuma linha lida |
| `banco_rpc` | GET `/rest/v1/rpc/vibe_credits_committed?p_org=<inexistente>` | A | 200, número | privilégio de EXECUTE só de `service_role`; GET em rpc = transação somente leitura; função STABLE de soma |
| `auth_listar` | GET `/auth/v1/admin/users?per_page=1` | B | 200, lista | a porta de administrador do Auth aceita a chave (só a contagem é usada) |
| `auth_buscar` | GET `/auth/v1/admin/users/<id inexistente>` | B | 404 | a rota por id (a mesma do PUT de `usuariosServidor`) passa a porta de administrador |
| `controle_banco` | HEAD/GET como `banco_leitura` com chave **falsa** | sim | 401/403 | o 200 acima depende da chave |
| `controle_auth` | GET como `auth_listar` com chave **falsa** | sim | 401/403 | idem no Auth |

Leitura: tudo PASS → o código vale para leitura; A falha e B passa no banco → `cabecalhosServico` manda o `Authorization`
idêntico também (uma linha, novo commit); B falha e A passa no Auth → `cabecalhosAuthAdmin` manda só `apikey`; os dois
falham ou o controle falha → NO-GO.

**O que a R3A não homologa:** criar, atualizar, convidar e recuperar. Essas rotas têm a mesma porta de administrador que a
R3A atravessa, mas escrevem — ficam para a R3B.

### R3B — homologação das ESCRITAS do Auth em ambiente DESCARTÁVEL (autorização própria; preparado, não executado)
```powershell
node scripts/s1/ensaio-auth-escrita.mjs --url https://<ref-descartavel>.supabase.co --confirmar ENSAIO_AUTH_DESCARTAVEL
```
Recusa, antes de pedir a chave e antes de qualquer requisição: sem a frase; URL que contenha o ref de produção
(`dduobppgomqyagjviwpx`); URL que não seja `https://<ref de 20 letras>.supabase.co` ou a pilha local `http://127.0.0.1:54321`.
Pede a `sb_secret` **do ambiente descartável** (oculta). Ambiente recomendado: um projeto Supabase hospedado criado só para o
ensaio (mesmo gateway que trata a chave nova em produção) e apagado depois; a pilha local é aceita mas menos fiel.

| Etapa | Requisição (formato B) | Espera | Rota do código coberta |
|---|---|---|---|
| 1 criar | POST `admin/users` (e-mail `s1-r3b-…@example.com`, senha aleatória, confirmado) | 200 | `criar` |
| 2 buscar | GET `admin/users/{id}` | 200 | `editar`/`definir_senha` (leitura antes) |
| 3 atualizar | PUT `admin/users/{id}` (senha e metadados) | 200 | `definir_senha`/`editar` |
| 4 convidar | POST `invite` (outro e-mail @example.com) | 200 | `convidar`/`reenviar` |
| 5 recuperar | POST `recover` (e-mail criado) | 200 | `reenviar` para confirmado |
| 6 limpeza | DELETE `admin/users/{id}` dos dois usuários | 200 | — (o ambiente volta ao que era) |

Etapa que falhar em B é repetida só ela em A, como diagnóstico. Saída só com etapa, formato, status e código. E-mails
para `@example.com` não são entregáveis. Se a limpeza não confirmar, o script avisa para apagar no painel do descartável.

### R4 — trocar nas Functions (Augusto + publicação autorizada)
1. «MERGE AUTORIZADO» deste PR.
2. No Netlify, recriar `SUPABASE_SERVICE_ROLE_KEY` com o valor `sb_secret_…`, **escopo só Functions, valor só em
   Production** (aproveita para tirar Builds/Runtime).
3. Um build de produção da `main`, conferência e «PRODUCTION AUTORIZADA».
4. Fumaça sem efeito: e-mail `saude` sem login → 401 e envio sem login → 403 (desligado); widget sem token → 401;
   formulário em verificação; usuários «listar» pela tela; Diretor Financeiro (veredito) pela tela; webhook da Meta com
   assinatura inválida → recusado.
5. Retorno: republicar o deploy anterior (ainda com a legada, válida até a R6).

### R5 — navegador
`VITE_SUPABASE_ANON_KEY` recebe a `sb_publishable_…`; build e publicação; conferir login, telas, tempo real. O código
do navegador não precisa mudar (o supabase-js 2.114 trata a chave publicável).

### R6 — desativar as legadas (Augusto, painel do Supabase)
Só depois de R4 e R5 no ar e conferidos. **Efeito:** todo deploy antigo (pré-visualizações e produção) perde o acesso ao
banco — falha fechada; scripts locais com a chave antiga param (trocar no `.env.local`). Reversível pelo painel
(reativar as legadas). Novo ponto de retorno = o deploy da R5.

### R7 — Vibe e GitHub (independente)
Nova chave da Explorium/Vibe e token fino de leitura do GitHub com validade; recriar as variáveis só Functions/Production;
build; revogar as antigas na origem.

## 5. Riscos

| Risco | Tratamento |
|---|---|
| O projeto recusar a chave nova só no `apikey` no banco | R3A mostra antes de qualquer troca; correção de uma linha |
| Auth admin com a chave nova (sem documentação) | R3A mede leitura nos dois formatos; R3B mede as escritas em ambiente descartável |
| Escrever no Auth de produção para testar | proibido: a R3A só faz HEAD/GET; a R3B recusa a URL de produção |
| Chave publicável colada no lugar da secreta | falha fechada no código (sem requisição) |
| Desativar as legadas antes da R5 | derruba o navegador: ordem obrigatória R4 → R5 → R6 |
| Scripts locais com a chave antiga | param na R6; trocar no `.env.local` |
