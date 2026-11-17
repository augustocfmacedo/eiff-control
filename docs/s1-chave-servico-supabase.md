# S1 — Chave de serviço do Supabase: compatibilidade com `sb_secret` (R1) e roteiro de rotação

> **R1: código pronto, NÃO mesclado.** Nenhuma credencial foi criada, trocada ou revogada. Os portões seguem separados:
> «MERGE AUTORIZADO» (este PR), R2 (criar as chaves novas), R3 (validar), R4 em diante (trocar, publicar, desativar
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
  admin». É o caminho B — por isso a R3 mede A e B nas rotas do Auth em vez de presumir.

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

`src/core/chaveServico.test.ts` (28): classificação e falha fechada; cabeçalhos das duas chaves; mensagem de erro nunca
contém o valor; `fetchServico`; o supabase-js 2.114 REAL com a chave nova (sem `Authorization` no banco) e a legada (com);
cada porta privilegiada com as duas chaves; usuários com banco × Auth admin e o JWT do usuário sempre com a chave anônima;
chave publicável recusada antes de qualquer requisição na ingestão, no formulário, em usuários e no livro do e-mail; e uma
**guarda** que varre `src/` e `netlify/` e falha se algum arquivo voltar a montar à mão `apikey` + `Authorization` com a
mesma variável; e três guardas de credencial: nenhum arquivo do repositório tem chave `sb_` real (só fictícias marcadas),
o CI e o `package.json` nunca citam o script da R3 nem `sb_secret`, e o script só lê a chave de terminal interativo, só faz
HEAD/GET no banco e nunca imprime a chave.

## 4. Procedimento das chaves novas (R2 → R6) — cada passo com autorização própria

### R2 — criar (Augusto, painel do Supabase)
1. `supabase.com/dashboard` › projeto `dduobppgomqyagjviwpx` › **Settings › API Keys** › aba das chaves novas
   («Publishable and secret API keys»).
2. **Create new secret key**, nome `netlify-functions`. Copiar UMA vez para o gerenciador de senhas. Não colar no chat.
3. Conferir que já existe uma chave publicável (`default`); **não criar outra** se existir. É pública por desenho e só será
   usada na R5.
4. Nada muda no ar: criar chaves novas não revoga as legadas.

### R3 — conferir sem poder alterar produção (Augusto, terminal dele)
```powershell
node scripts/s1/validar-chave-secreta.mjs
```
O script pede a chave com a digitação **oculta** (funciona no Windows PowerShell 5.1 e no 7; não usa `Read-Host -MaskInput`,
que só existe no 7.1+, nem variável de ambiente, nem histórico). Sem terminal interativo ele recusa. A chave fica só na memória
do processo. Nenhum teste e nenhum workflow roda o script (guarda em `chaveServico.test.ts`).

Cada prova roda nos dois formatos — **A** só `apikey`, **B** `apikey` + `Authorization` idêntico — e o resultado diz qual
formato o projeto aceita em cada caminho. Obrigatórias: **A no banco** e **B no Auth** (o que o código da R1 usa).

| Prova | O que faz | Por que não altera nada |
|---|---|---|
| `banco_leitura` | HEAD `organization` com contagem: ≥ 1 só com papel `service_role` (RLS ignorada) | HEAD não lê linhas |
| `banco_rpc` | GET `rpc/vibe_credits_committed` com organização inexistente (EXECUTE só `service_role`) | GET em rpc = transação somente leitura; função STABLE que só soma |
| `auth_listar` | GET `admin/users?per_page=1` | leitura (só a contagem é usada) |
| `auth_buscar` | GET `admin/users/<id inexistente>` → 404 | leitura |
| `auth_atualizar` | PUT `admin/users/<id inexistente>` → 404 | não há usuário para atualizar |
| `auth_criar` | POST `admin/users` com e-mail **sem @** → 400/422 | recusa de validação: nenhuma conta |
| `auth_convidar` | POST `invite` com e-mail sem @ → 400/422 | nenhum convite, nenhum e-mail |
| `auth_recuperar` | POST `recover` com e-mail sem @ → 400/422 | nenhum e-mail |
| `controle_*` | as mesmas escritas com uma chave **falsa** → 401/403 | prova que o 400 acima só vem depois de a chave ser aceita |

A saída tem só prova, formato, HTTP, código de erro e veredito. Se uma rota de escrita aceitar o e-mail sem @ (impossível pelo
servidor de Auth, mas conferido), o script grita ALERTA.

**O que a R3 NÃO homologa:** o caminho de sucesso de criar e convidar (conta criada, e-mail entregue). A R3 prova que a chave
nova passa pela porta de administrador das MESMAS rotas que o código usa (`admin/users`, `admin/users/{id}`, `invite`,
`recover`); o sucesso só se prova criando ou convidando alguém de verdade, o que altera produção — fica para a R4, como
operação própria, com endereço de teste e autorização específica (ou com o primeiro uso real pela tela de Usuários).

Leitura do resultado:
- tudo PASS → o código da R1 vale como está;
- A falha e B passa no banco → o projeto exige o `Authorization` idêntico também no banco: `cabecalhosServico` passa a mandá-lo
  (novo commit no PR, uma linha);
- B falha e A passa no Auth → `cabecalhosAuthAdmin` passa a mandar só `apikey`;
- os dois falham num caminho, ou o controle falha → NO-GO, nada muda no ar.

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
| O projeto recusar a chave nova só no `apikey` no banco | R3 mostra antes de qualquer troca; correção de uma linha |
| Auth admin com a chave nova (sem documentação) | R3 mede os dois formatos nas cinco rotas usadas |
| Sucesso real de criar/convidar | não coberto pela R3; operação própria na R4 |
| Chave publicável colada no lugar da secreta | falha fechada no código (sem requisição) |
| Desativar as legadas antes da R5 | derruba o navegador: ordem obrigatória R4 → R5 → R6 |
| Scripts locais com a chave antiga | param na R6; trocar no `.env.local` |
