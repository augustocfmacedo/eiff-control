# Formulário do site → EIFF Control: checkpoint de continuidade

> **09/11/2026 — frente SUSPENSA por decisão do Augusto. A integração NÃO funciona em produção.**
> Nada foi publicado, enviado ao GitHub ou aplicado no banco. A próxima prioridade é o SIM-04.

Desenho em `docs/formulario-site.md`; roteiro de ativação, ensaio e reversão em
`docs/formulario-site-ativacao.md`. Este arquivo só diz onde a frente parou e por onde retomar.

## 1. Estado exato

Conferido em 09/11/2026, somente leitura.

### Produção

| item | estado |
|---|---|
| `eiffcontrol.com.br/api/formulario-site` | 404 — não publicado |
| deploy publicado do eiff-control | `6ad6568f` (commit `2bc130a`, 19/10/2026), **travado** |
| setor COMERCIAL do Inbox | ativo, **sem responsável padrão**, 0 membros, 0 equipes |
| regras de roteamento | ROT-01 a ROT-08; **`ROT-SITE` não instalada** |
| variáveis no Netlify do eiff-control | só `SUPABASE_SERVICE_ROLE_KEY`; faltam todas as do formulário e da reconciliação |
| evidências da fonte WEBSITE · conversas do canal PORTAL | 0 · 0 |
| `eiff.com.br` | `main` inalterada; encaminhador não publicado |
| submissões históricas no painel do Netlify | 11 (7 `simular-galpao`, 4 `iniciar-projeto`), **não processadas** |

### eiff-control (`D:\Usuario\Documents\CLAUDE\eiff-control`)

| branch | commit | onde |
|---|---|---|
| `main` = `origin/main` | `2bc130a` | GitHub |
| `feature/radar-formulario-site` | `9079f3d` | **só nesta máquina** — 9 commits à frente da `main` |
| `feature/leads-do-site-menu` | `9079f3d` | só nesta máquina; worktree `.claude/worktrees/leads-do-site`, sem alteração |

Os 9 commits, do mais antigo ao mais novo: `8d16cdb` · `1dbce59` · `26020e9` · `06cdd99` · `d3aeebe` ·
`a8fe171` · `9ccd7f4` · `ee4302b` · `9079f3d`.

### eiff-site (`D:\Usuario\Documents\CLAUDE\eiff-site`)

| branch | commit | conteúdo |
|---|---|---|
| `main` = `origin/main` | `e6894e0` | GitHub |
| `release/encaminhador-crm` | `27ea4af` | **a que publica**: `main` + 3 commits (`d910bed`, `9a4a3e8`, `27ea4af`) — só a função, o teste e o `tsconfig` |
| `feature/formulario-para-o-crm` | `9cc1993` | o mesmo encaminhador, empilhado sobre o resgate — **não publicar esta** |
| `feature/resgate-de-lead` | `57529ee` | muda a página pública; decisão separada |

Nenhuma dessas branches está no GitHub. A worktree da `release/encaminhador-crm` fica numa pasta temporária
do Windows; se a pasta sumir, a branch continua no repositório (`git worktree prune` limpa o registro).

## 2. Backup sem push

Os commits existem só neste disco. `git bundle` grava as branches num arquivo único, sem rede, sem tocar no
GitHub e sem publicar nada. Testado em 09/11/2026 (136 KB e 17 KB, `git bundle verify` sem erro).

Rodar em cada repositório e guardar os dois arquivos fora deste disco (Drive, pendrive):

```bash
git -C "D:/Usuario/Documents/CLAUDE/eiff-control" bundle create eiff-control-formulario-2026-11-09.bundle origin/main..feature/radar-formulario-site
```

```bash
git -C "D:/Usuario/Documents/CLAUDE/eiff-site" bundle create eiff-site-encaminhador-2026-11-09.bundle main..release/encaminhador-crm main..feature/formulario-para-o-crm
```

Restaurar, num clone que já tenha a `main`: `git fetch <arquivo.bundle> <branch>:<branch>`.

O backup definitivo é o push das branches, que depende de autorização e não foi feito.

## 3. Bloqueadores de publicação

Todos dependem de um operador autorizado. Nenhum é defeito de código conhecido.

1. **SQL de configuração não aplicado** (`scripts/formulario-ativacao-producao.sql`): responsável padrão
   provisório do COMERCIAL + regra `ROT-SITE`. O ambiente da sessão de release recusou a operação e ela não
   foi contornada. Provado só em PostgreSQL local: os gatilhos de produção em `inbox_sector`/`inbox_config`
   não foram exercidos.
2. **Variáveis ausentes no Netlify do eiff-control**: `EIFF_FORM_SECRET`, `EIFF_FORM_SOURCE_ID`
   (`0e238b9c-01f1-4a33-9274-de7f1af8245f`), `EIFF_INBOX_ORGANIZATION_ID`
   (`e1a7e58f-29d1-4c22-b41e-597ebdeee86e`); para a reconciliação, `NETLIFY_AUTH_TOKEN`,
   `EIFF_FORM_NETLIFY_SITE`, `EIFF_FORM_MARCO` e, por último, `FORMULARIO_RECONCILIACAO=ativa`.
3. **Push e merge não autorizados** nos dois repositórios.
4. **Deploy do eiff-control travado**: push na `main` constrói e não publica até destravar.
5. **`EIFF_FORM_SECRET` ausente no eiff-site**; o merge na `main` do site publica sozinho.

## 4. Ponto exato de retomada

Na ordem, sem pular: (1) SQL de configuração e leitura de conferência → (2) variáveis do CRM → (3) push,
merge e publicação do eiff-control → (4) POST sem segredo responde 401 → (5) ensaio fictício pelo
reconciliador com `--arquivo scripts/formulario-ensaio-ficticio.json` (`REGISTRADO`, depois `IDEMPOTENTE`) e
conferência em `#/atendimento`: COMERCIAL, responsável, prazo → (6) variável e publicação da
`release/encaminhador-crm` → (7) reconciliação ligada, com o marco no instante da ativação.

Se o lead do ensaio chegar sem responsável, parar antes do passo 6.

Risco conhecido a conferir no passo 5: o roteador só atribui pessoa com confiança ≥ 85%. Com o contato já
marcado como `lead` dá 95%; se o passo que completa o contato falhar (ele é tolerante a falha), dá 80% e o
lead fica só no setor.

## 5. O que fica como está

- **As 11 submissões históricas ficam fora.** A reconciliação retém tudo o que é anterior ao marco, a rodada
  agendada não tem como liberá-las, e o script exige `--incluir-anteriores` mais
  `--confirmar-anteriores LEADS_REAIS_ANTES_DO_MARCO`.
- **A regra de identidade forte não muda.** Criar empresa continua exigindo CNPJ válido ou business_id vindo
  da fonte.
- **Nada envia mensagem a cliente.**

## 6. Leads do Site — aprovado, para depois do release

Proposta comercial aprovada em 09/11/2026 e **não iniciada**. Implementar na worktree
`.claude/worktrees/leads-do-site`, sem publicar sem nova aprovação.

| parte | conteúdo |
|---|---|
| A · menu | «Leads do Site» no grupo Comercial; fila própria sobre as conversas do Inbox; origem conferida pela evidência WEBSITE (`meta.registroFonteId` → registro da fonte), não só pelo canal PORTAL |
| B · lista | interessado e empresa, cidade/UF, área, vão e pé-direito, entrada, responsável, status, prazo e vencimento do SLA; destaque para novo, sem dono e SLA vencido |
| C · atendimento | o clique abre a conversa original; nenhuma ação nova, nenhum registro duplicado |
| D · qualificação | «Qualificar no Radar» abre o candidato exato; revisão humana; menor caminho de candidato promovido a oportunidade com responsável e próxima ação (`oportunidadeDoFormulario` existe e não é usada por tela) |
| E · permissões | ensaio com o Augusto; definitivo com papel de menor privilégio (Inbox + Radar, membro do COMERCIAL) — exige migration, porque os papéis são lista fixa no banco |
| F · homologação | fluxo fictício completo, desktop e celular, ligado aos registros reais |

Estimativa: cerca de 5 dias, mais 1 para o papel comercial. Em aberto por decisão: informar CNPJ na revisão
(mexe na identidade forte, **adiado**), então lead sem CNPJ e sem empresa cadastrada só pode ser associado,
não criado.
