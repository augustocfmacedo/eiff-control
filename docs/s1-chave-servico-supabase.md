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

### R3B — escritas do Auth em projeto DESCARTÁVEL (plano para aprovação específica; NÃO executado)

**Estado da R3A (17/11/2026):** PASS nas seis provas obrigatórias, controles negativos com 401 — leitura do banco e do Auth
admin homologada com a `sb_secret` `netlifyfunctions`.

**Ambiente.** Recomendado: **uma organização Supabase NOVA, no plano Free, com um único projeto** (`s1-r3b`), sem nenhum
projeto operacional e sem outro membro além do Augusto. A organização atual tem quatro projetos ativos (EIFF Control,
modolab, Locus tracker, Retiro SJST), todos excluídos do ensaio. Alternativa menos isolada: projeto na organização atual
(paga), ~US$ 0,01344/h de compute (cobra hora cheia; para de cobrar ao apagar) — dividiria organização com os operacionais.

**Custo.** Organização Free + projeto Nano: US$ 0 (a documentação dá dois projetos gratuitos por pessoa, contando as
organizações em que ela é dona/administradora; o painel mostra o preço antes de confirmar — se aparecer qualquer valor,
parar). Alternativa paga: ~US$ 0,03 para duas horas.

**Dependências.** Conta do Augusto no painel do Supabase; Node local (v24, já instalado); a pasta do PR #95; um commit
revisado preenchendo `REF_AUTORIZADO` com o identificador do projeto criado (público, não é segredo). Não usa Netlify, chave
de produção, SMTP externo nem variável de ambiente.

**Script (`scripts/s1/ensaio-auth-escrita.mjs`).** Aceita SÓ o projeto em `REF_AUTORIZADO` (vazio nesta versão: recusa tudo)
e recusa os quatro projetos operacionais mesmo que a constante seja preenchida errado; frase `ENSAIO_AUTH_DESCARTAVEL`;
tudo antes de pedir a chave. Depois da chave, **portão do projeto**: GET `admin/users` precisa dar 200 com **zero**
usuários — a chave de outro projeto (inclusive a de produção) dá 401 e o ensaio para sem escrever.

**E-mail.** O SMTP padrão do Supabase só entrega a membros da equipe da organização; qualquer outro endereço recebe
`email_address_not_authorized` e nada sai (limite de 2 e-mails/hora no SMTP padrão).
- Modo padrão (recomendado): convite e recuperação para `@example.com` → o código `email_address_not_authorized` prova que a
  porta de administrador foi atravessada; **nenhum e-mail é enviado**.
- Modo `--email-real <endereço> --confirmar-email ENVIAR_DOIS_EMAILS` (autorização à parte): convite e recuperação para o
  endereço do Augusto (único membro da organização nova) → no máximo 2 e-mails, do remetente padrão do Supabase, a ele.

**Isolamento e limpeza.** Usuários de ensaio com e-mail `s1-r3b-<aleatório>@example.com` (ou o endereço real, no modo
opcional) e metadado `s1_r3b`. No fim: apaga os ids criados e qualquer usuário de ensaio que a listagem mostrar; o PASS exige
a listagem final com **zero** usuários (`7_limpeza_conferida`). Depois o projeto e a organização inteiros são apagados.

| Etapa | Requisição (formato B) | PASS |
|---|---|---|
| 0 projeto vazio | GET `admin/users` | 200 e 0 usuários |
| 1 criar | POST `admin/users` (confirmado, senha aleatória) | 200 |
| 2 buscar | GET `admin/users/{id}` | 200 |
| 3 atualizar | PUT `admin/users/{id}` (senha e metadados) | 200 |
| 4 convidar | POST `invite` | 200, ou `email_address_not_authorized` no modo padrão |
| 5 recuperar | POST `recover` | 200, ou `email_address_not_authorized` no modo padrão |
| 6 limpeza | DELETE `admin/users/{id}` | 200 |
| 7 limpeza conferida | GET `admin/users` | 200 e 0 usuários |

Etapa que falhar em B é repetida em A (diagnóstico). Simulação offline (Auth falso em memória, sem rede) conferiu os quatro
caminhos: tudo certo → PASS; chave de outro projeto → 1 GET, nada escrito; projeto com usuário → 1 GET, nada escrito;
apagar falha → NO-GO com aviso de limpeza manual.

**Checklist de execução (cada passo com a Direção)**
1. Aprovação deste plano.
2. Augusto: painel › *New organization* (Free, «EIFF ensaio descartável») › *New project* `s1-r3b` (Nano; senha do banco
   gerada e descartada; qualquer região). Conferir US$ 0 antes de confirmar.
3. Augusto informa só o **identificador do projeto** (20 letras, público). Eu confiro por metadados que ele está na
   organização nova, sozinho, e não é operacional.
4. Commit no PR #95 preenchendo `REF_AUTORIZADO`; Quality Gate; revisão da Direção.
5. Augusto copia a chave `sb_secret` **do projeto descartável** (*Settings › API Keys*, a `default` serve) para o
   gerenciador de senhas, numa entrada marcada DESCARTÁVEL. Nunca a chave de produção.
6. Autorização de execução (modo padrão; o modo e-mail real só com autorização à parte).
7. Augusto roda, na pasta do PR: `node scripts/s1/ensaio-auth-escrita.mjs --ref <ref> --confirmar ENSAIO_AUTH_DESCARTAVEL`
   e cola a tabela.
8. Exclusão: *Project settings › General › Delete project*; depois *Organization settings › Delete organization*; apagar a
   entrada do gerenciador. Eu confiro por metadados que o projeto sumiu da lista.
9. Commit voltando `REF_AUTORIZADO` para vazio.

**Retorno.** Nada da produção muda em nenhum passo; o retorno é apagar o projeto e a organização (passo 8). Se a limpeza não
for conferida, apaga-se o projeto inteiro do mesmo jeito.

**Critérios.** PASS = etapas 0 a 7 PASS no formato B (4 e 5 aceitam a recusa do SMTP padrão) e saída 0. NO-GO = qualquer
outra coisa. Se B falhar e A passar numa escrita, a correção é `cabecalhosAuthAdmin` mandar só `apikey` (commit no PR,
R3A e R3B de novo). Portão 0 falhando = nada foi escrito; conferir a chave e o projeto.

**O que nem a R3B prova** (fica para a R4, no uso real pela tela de Usuários, com autorização): o projeto de produção
especificamente (a R3B roda na mesma plataforma, outro projeto) e a entrega de e-mail pela configuração de SMTP da produção.

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
