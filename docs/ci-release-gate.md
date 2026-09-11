# CI & Release Gate — "EIFF Quality Gate"

Workflow: `.github/workflows/quality-gate.yml` · nome no GitHub: **EIFF Quality Gate** · Wave 02 (CI & Release Guard).

Transforma em gate automático e reproduzível as verificações que antes dependiam de execução local:
testes, lint, build e o smoke das migrations da EIFF Central num PostgreSQL descartável.

## O que roda, na ordem

| Step (nome no GitHub) | Comando | O que prova |
| --- | --- | --- |
| Checkout | `actions/checkout@v4` | código do commit em teste |
| Node 20 (paridade com o Netlify) | `actions/setup-node@v4`, `node-version: "20"`, `cache: npm` | mesma major do build de produção (`NODE_VERSION = "20"` em `netlify.toml`) |
| Install (npm ci) | `npm ci` | instalação reproduzível, exatamente o `package-lock.json` |
| Verify PGlite resolves | `npm ls @electric-sql/pglite` + `import()` | a dependência transitiva do smoke resolveu neste checkout limpo (ver abaixo) |
| **Tests** | `npm test` (vitest) | baseline: 72 arquivos, 634 testes + 8 todo |
| **Lint** | `npm run lint` (eslint src) | |
| **Build** | `npm run build` (tsc + eslint + vite) | o mesmo comando do Netlify |
| **PostgreSQL Smoke** | `node scripts/pg-smoke-central.mjs` + veredito | migrations 0049/0050/0051 aplicadas num Postgres real (PGlite) e as regras da Central |

Qualquer step vermelho derruba o run. Objetivo visual em qualquer PR importante: `EIFF Quality Gate` com
✓ Tests ✓ Lint ✓ Build ✓ PostgreSQL Smoke.

Gatilhos: `pull_request` para `main`, `push` em `main`, `workflow_dispatch`. `concurrency` por PR/ref com
`cancel-in-progress: true`: um commit novo cancela o run anterior da mesma ref. `permissions: contents: read`
(o workflow não escreve nada no GitHub). `timeout-minutes: 30`.

Sobre o cache: `cache: npm` do `setup-node` guarda só o diretório de download do npm (tarballs conferidos pelo
`integrity` do lockfile). `npm ci` continua sendo a fonte de verdade e nada que altere resultado de teste é cacheado.

## Somente validação — o que o workflow nunca faz

Violar qualquer item reprova a mudança em revisão:

- não usa nem imprime segredo (nenhuma referência ao contexto de segredos do GitHub; nenhuma chave de produção do
  Supabase, da Meta, da Anthropic, do Vibe ou do Octadesk — nem `SUPABASE_SERVICE_ROLE_KEY`, nem
  `META_WHATSAPP_ACCESS_TOKEN`, nem `ANTHROPIC_API_KEY`);
- não usa o Supabase CLI no modo linked, não aplica migration, não acessa o projeto Supabase;
- não faz deploy, não chama a API do Netlify, da Meta, do Octadesk nem da Anthropic;
- não envia mensagem nem executa mutação externa de nenhum tipo.

A única operação de rede é a instalação normal de dependências pelo registro do npm. Não há variáveis `VITE_*`:
o build é estático e compila em modo local (sem Supabase), como o Netlify faz sem `.env`.

Conferência rápida: `grep -nEi 'secrets\.|--linked|netlify deploy|service_role|api_key' .github/workflows/quality-gate.yml`
tem de devolver nada.

## PostgreSQL Smoke — como o veredito é dado

`scripts/pg-smoke-central.mjs` (lido e confirmado): cria um `new PGlite()` **em memória** (Postgres compilado para
WASM, sem servidor, sem rede), monta o mínimo do schema que as migrations assumem (organization, profile, worker,
audit_log, `auth.uid()` via GUC, `current_org()`, `has_role()`, papéis do Supabase, mínimo do ledger de entrega),
abre `BEGIN`, aplica `0049_whatsapp_identity.sql`, `0050_central_conversation.sql` e
`0051_central_meta_delivery.sql`, roda os dez smoke tests A–J e termina em `ROLLBACK` (e confere que a tabela
`whatsapp_identity` não sobreviveu). Nada toca produção.

O script **imprime JSON e sai com código 0 mesmo quando falha** (o erro vai para `erroFatal`). Por isso o step
faz `tee pg-smoke-central.json` e um validador Node inline reprova (exit 1) se:

- `erroFatal` existir;
- `migrations["0049"|"0050"|"0051"]` não for exatamente `APLICADA sem erro`;
- qualquer `smoke[A..J]` não começar com `PASS`, **ou** contiver `ATENCAO` (o script anexa esse sufixo quando uma
  checagem secundária do mesmo teste passou indevidamente — o gate trata a ressalva como reprovação);
- `rollback` não começar com `ROLLBACK ok`.

O resumo (migrations, A–J, rollback) vai ao Job Summary do run. Provado localmente: exit 0 com a saída real e
exit 1 com JSON adulterado (migration com ERRO, smoke FALHOU, sufixo ATENCAO, rollback ausente, `erroFatal`).

## Situação do `@electric-sql/pglite` — decidida

Desde a Wave 02, `@electric-sql/pglite` é **devDependency fixada** (`"0.3.16"`, sem `^`). `npm ci` o instala
diretamente; o step "Verify PGlite resolves" continua como prova a cada run.

**Por que foi preciso decidir.** Antes ele resolvia só por acidente: chegava como dependência transitiva obrigatória
de `netlify-cli` (`→ @netlify/dev → @netlify/database-dev → @electric-sql/pglite`). Era garantia frágil por dois
motivos, ambos provados pelo CI & Release Guard num checkout limpo:

- `@netlify/database-dev` declara `engines.node >= 22.12.0` — com Node 20 o npm só avisa (`EBADENGINE`) porque não
  há `engine-strict`; o próprio PGlite 0.3.16 não declara `engines` e roda no Node 20;
- um `npm update netlify-cli` (ou o Netlify trocar de motor de banco local) tiraria o PGlite do lockfile e derrubaria
  o smoke **sem que nenhuma linha de SQL tivesse mudado**.

A correção foi a menor reproduzível: fixar a mesma versão já resolvida no lockfile, para o diff ser uma linha em
`package.json` e uma em `package-lock.json`, sem trocar nenhuma versão instalada. Aplicada pelo Architect na
integração da Wave 02 (o worker não tocou em `package.json` por desenho, para não colidir com o DB Release).
## Rodar o mesmo gate localmente

```
npm ci
npm test
npm run lint
npm run build
node scripts/pg-smoke-central.mjs
```

O veredito do smoke é o mesmo bloco `node --input-type=module -` do step "PostgreSQL Smoke" no workflow.

## Branch protection — recomendação (não aplicada)

Este worker não altera configuração administrativa do GitHub. Depois de o workflow provar estabilidade em alguns
PRs e pushes em `main`, recomenda-se, em *Settings › Branches › Branch protection rules* para `main`:

- **Require status checks to pass before merging** com `EIFF Quality Gate` como required check;
- **Require branches to be up to date before merging** (o gate roda sobre o merge commit do PR);
- opcionalmente, **Do not allow bypassing the above settings**.

Hoje `main` não depende disso: o Netlify continua fazendo o build a cada push (`docs/publicacao-automatica.md`),
e este gate é uma camada anterior, sem deploy.

## Validação desta entrega

- YAML válido (parse com o pacote `yaml`; `actionlint` não está disponível na máquina sem download de binário).
- Sequência do CI executada no worktree limpo (Node 24.19 local; Node 20 é exercido pelo run no GitHub):
  `npm ci` ok (1243 pacotes) · Tests 72 arquivos / 634 passed + 8 todo · Lint ok · Build ok · PostgreSQL Smoke
  3 migrations `APLICADA sem erro`, A–J `PASS`, `ROLLBACK ok — nada persistiu`, validador exit 0.
