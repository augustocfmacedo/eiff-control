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
nunca é impressa, a R3A tem uma única função de requisição que só aceita HEAD/GET, e a R3B só aceita o projeto descartável autorizado
(nenhum nesta versão) e recusa os projetos operacionais antes de pedir a chave.

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

### R3B — escritas do Auth em projeto DESCARTÁVEL (plano aprovado com condições em 17/11/2026; execução NÃO autorizada)

**Estado da R3A (17/11/2026):** PASS nas seis provas obrigatórias, controles negativos com 401 — leitura do banco e do Auth
admin homologada com a `sb_secret` `netlifyfunctions`.

**Ambiente (aprovado).** Organização Supabase NOVA, plano Free, um único projeto `s1-r3b`; sem Netlify, sem dados reais, sem
credenciais da EIFF Control, sem SMTP personalizado, sem outros membros. **Quota Free:** a documentação dá dois projetos
gratuitos por pessoa, contando as organizações em que ela é dona/administradora; os metadados mostram UMA organização, com
quatro projetos ativos — o que o plano Free não permite, então ela é paga e nenhum projeto gratuito está em uso. O painel dá a
palavra final: se não mostrar Free a US$ 0, ou se recusar o plano Free, **parar** (não é para contornar limite de assinatura).

**Custo:** US$ 0. Qualquer valor, indisponibilidade do Free ou restrição no painel interrompe a criação.

**Script (`scripts/s1/ensaio-auth-escrita.mjs`)**
- **Bloqueio por padrão:** `REF_AUTORIZADO` vazio recusa tudo. Só o commit de autorização o preenche com o identificador
  EXATO do projeto descartável, depois da conferência por metadados. O teste de guarda aceita a constante vazia OU um
  identificador de 20 letras fora da lista operacional (conferido nos dois sentidos).
- **Portões antes da chave:** constante preenchida; `--ref` idêntico; nenhum dos quatro projetos operacionais; frase
  `ENSAIO_AUTH_DESCARTAVEL`. Toda requisição é conferida contra o host do projeto autorizado.
- **Portão do projeto, antes de qualquer escrita:** GET `admin/users` = 200 com **zero** usuários (chave de outro projeto,
  inclusive produção, dá 401 e nada é escrito).
- **Escritas sem repetição:** cada POST/PUT/DELETE é feito UMA vez, no formato do código (B). Sem resposta = **INDETERMINADA**
  (pode ter gravado): as escritas seguintes param e a limpeza procura o que possa ter sido criado. Só as leituras (GET) ganham
  uma segunda tentativa no formato A, como diagnóstico.
- **Três resultados:** `CONCLUIDA` (2xx), `PORTA_ACEITA_EMAIL_RECUSADO` (`email_address_not_authorized`: a chave passou como
  administrador e o SMTP padrão recusou o destinatário; nada enviado), `NAO_HOMOLOGADA` / `INDETERMINADA`.
- **Sem e-mail real:** convite e recuperação só para `@example.com` (domínio reservado, sem caixa de entrada), e o SMTP
  padrão só entrega a membros da equipe. Não há modo de envio real no script. Um 2xx em convite ou recuperação é **ALERTA** e
  NO-GO.
- **Exclusão conferida:** antes de cada DELETE, o script relê o usuário pelo id e só apaga se o e-mail for
  `s1-r3b-…@example.com` E o metadado `s1_r3b` for verdadeiro; o PASS exige a listagem final com **zero** usuários.
- **Simulação offline** (Auth falso em memória, sem rede), sete cenários: tudo certo → PASS; chave de outro projeto → 1 GET,
  nada escrito; projeto com usuário → 1 GET, nada escrito; resposta perdida no criar → 1 POST só, INDETERMINADA, escritas
  param, usuário achado e apagado, NO-GO; SMTP enviando → ALERTA, NO-GO; usuário sem a marca do ensaio → não apagado, NO-GO;
  apagar falha → NO-GO com aviso.

| Etapa | Requisição (formato B, uma vez) | Esperado |
|---|---|---|
| 0 projeto vazio | GET `admin/users` | CONCLUIDA, 0 usuários |
| 1 criar | POST `admin/users` (`s1-r3b-…@example.com`, confirmado, metadado `s1_r3b`) | CONCLUIDA |
| 2 buscar | GET `admin/users/{id}` | CONCLUIDA |
| 3 atualizar | PUT `admin/users/{id}` (senha e metadados) | CONCLUIDA |
| 4 convidar | POST `invite` (`s1-r3b-convite-…@example.com`) | PORTA_ACEITA_EMAIL_RECUSADO |
| 5 recuperar | POST `recover` (o e-mail criado) | PORTA_ACEITA_EMAIL_RECUSADO |
| 6 limpeza | GET de conferência + DELETE de cada usuário do ensaio | CONCLUIDA |
| 7 limpeza conferida | GET `admin/users` | CONCLUIDA, 0 usuários |

**Etapas com a Direção**
1. Criação manual da organização e do projeto (passo a passo no relatório), conferindo US$ 0.
2. Augusto informa só o **identificador do projeto** (público). Conferência por metadados: está na organização nova, sozinho,
   e não é operacional.
3. Commit de autorização preenchendo `REF_AUTORIZADO`; gate local e Quality Gate; matriz final de testes e riscos.
4. Augusto guarda a `sb_secret` **do projeto descartável** no gerenciador, marcada DESCARTÁVEL. Nunca a de produção.
5. Só com «EXECUÇÃO R3B AUTORIZADA»: `node scripts/s1/ensaio-auth-escrita.mjs --ref <ref> --confirmar ENSAIO_AUTH_DESCARTAVEL`.
6. Exclusão do projeto e da organização: **autorização separada**; antes, conferência por metadados do identificador exato
   (o que vai ser apagado é o projeto `s1-r3b` na organização descartável, e só ele); depois, conferência de que sumiu.
7. Commit voltando `REF_AUTORIZADO` para vazio.

**Retorno.** Nada da produção muda. Desfazer = apagar o projeto e a organização descartáveis (passo 6).

**Critérios.** PASS = as oito etapas no resultado esperado, nenhum ALERTA, saída 0. NO-GO = qualquer outro. Escrita que falhe
em B: não há repetição automática; a correção possível (`cabecalhosAuthAdmin` só com `apikey`) volta como commit no PR e
exige R3A e R3B de novo. INDETERMINADA: a limpeza conferida decide se algo ficou; se não conferir, a Direção decide antes de
qualquer ação manual.

**O que nem a R3B prova** (fica para a R4, no primeiro uso real da tela de Usuários, com autorização): o projeto de produção
especificamente e o envio real de convite/recuperação pela configuração de e-mail da produção.

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
| Escrever no Auth de produção para testar | proibido: a R3A só faz HEAD/GET; a R3B só aceita o projeto descartável autorizado e recusa os operacionais |
| Chave publicável colada no lugar da secreta | falha fechada no código (sem requisição) |
| Desativar as legadas antes da R5 | derruba o navegador: ordem obrigatória R4 → R5 → R6 |
| Scripts locais com a chave antiga | param na R6; trocar no `.env.local` |
