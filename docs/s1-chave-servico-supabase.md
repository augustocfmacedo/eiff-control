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

`src/core/chaveServico.test.ts` (25): classificação e falha fechada; cabeçalhos das duas chaves; mensagem de erro nunca
contém o valor; `fetchServico`; o supabase-js 2.114 REAL com a chave nova (sem `Authorization` no banco) e a legada (com);
cada porta privilegiada com as duas chaves; usuários com banco × Auth admin e o JWT do usuário sempre com a chave anônima;
chave publicável recusada antes de qualquer requisição na ingestão, no formulário, em usuários e no livro do e-mail; e uma
**guarda** que varre `src/` e `netlify/` e falha se algum arquivo voltar a montar à mão `apikey` + `Authorization` com a
mesma variável.

## 4. Procedimento das chaves novas (R2 → R6) — cada passo com autorização própria

### R2 — criar (Augusto, painel do Supabase)
1. `supabase.com/dashboard` › projeto `dduobppgomqyagjviwpx` › **Settings › API Keys** › aba das chaves novas
   («Publishable and secret API keys»).
2. **Create new secret key**, nome `netlify-functions`. Copiar UMA vez para o gerenciador de senhas. Não colar no chat.
3. Anotar a `sb_publishable_…` padrão (é pública por desenho, vai para o navegador).
4. Nada muda no ar: criar chaves novas não revoga as legadas.

### R3 — validar sem produção (Augusto, terminal dele)
```powershell
$env:EIFF_SB_SECRET = Read-Host -MaskInput 'sb_secret'; node scripts/s1/validar-chave-secreta.mjs; Remove-Item Env:EIFF_SB_SECRET
```
Três provas de leitura ou recusa (banco só com `apikey`; RPC só de `service_role` devolvendo `entrega_nao_encontrada`;
Auth admin com `Authorization` idêntico). Saída só com status e códigos. **Tem de dar PASS nas três.** Se a prova 1 ou 2
falhar e a 3 passar, o projeto não aceita a chave nova só no `apikey` para o banco: a correção é de uma linha
(`cabecalhosServico` passa a mandar o `Authorization` idêntico também), com novo PR.

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
| Auth admin com a chave nova | R3, prova 3 |
| Chave publicável colada no lugar da secreta | falha fechada no código (sem requisição) |
| Desativar as legadas antes da R5 | derruba o navegador: ordem obrigatória R4 → R5 → R6 |
| Scripts locais com a chave antiga | param na R6; trocar no `.env.local` |
