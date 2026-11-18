# Política de releases do `eiff-control` (CRM)

**Situação: APROVADA PELA DIREÇÃO EM 18/11/2026, AINDA NÃO EM OPERAÇÃO.** A Direção aprovou D1, D2 e D4 para
mudanças VERDES e AMARELAS e escolheu a opção B em D3 (seção 5). A política só entra em operação quando as duas
condições abaixo valerem:
- os controles da seção 6 estão cumpridos;
- **a Direção registrou por escrito a frase `POLÍTICA DE RELEASES EM OPERAÇÃO`**, citando o commit deste documento.

O estado da tabela da seção 6 **não basta**: este documento é VERMELHO justamente para não poder ser afrouxado pelo
próprio rito. Até lá continuam valendo `MERGE AUTORIZADO` e `PRODUCTION AUTORIZADA`.

**Uma política para o repositório inteiro.** Todo merge na `main` do `eiff-control` vai para o mesmo deploy do
`eiffcontrol.com.br`, seja a mudança da Frente A ou da Frente B. Por isso a classe de risco e o rito daqui valem para
**qualquer** PR deste repositório. A política da Frente A (PR #98) continua sendo a do `eiff-site` (outro repositório
e outro projeto Netlify). Para o `eiff-control`, onde as duas tratam do mesmo assunto, vale este documento. As duas
concordam no essencial: a classe é a do diff entre o publicado e o candidato, a trava fica sempre ligada, a publicação
restaura um deploy já construído e a identidade dos agentes não é a conta pessoal da Direção.

**Origem:** diretriz da Direção de 18/11/2026 («autonomia operacional da Frente B») e decisão executiva do mesmo dia.

**Escopo:** todo o repositório `eiff-control` e o projeto Netlify `eiff-control`. O SIM-04 (engenharia estrutural)
fica fora.

## 1. Situação conferida em 18/11/2026

| Controle | Estado | Como foi conferido |
|---|---|---|
| Ruleset `Protecao da main` (id 23878598) | ativo: exige PR, `EIFF Quality Gate` obrigatório, branch atualizada, sem force push, sem deleção, sem bypass | `gh api repos/.../rulesets` |
| Publicação no Netlify | travada: o deploy publicado `6afda676` (commit `148c7ab`, igual à `main`, PR #97 da Frente A, publicado em 18/11 às 13:59 UTC com `PRODUCTION AUTORIZADA` registrada pela Frente A; ponto de retorno `6afb298f`) está `locked: true`. Push em `main` constrói, mas não publica | `netlify api getSite` e `listSiteDeploys`, só leitura |
| Merge | só com a frase `MERGE AUTORIZADO` (regra de 22/09/2026) | regra registrada |
| Publicação | só com `PRODUCTION AUTORIZADA`, separada do merge | regra registrada |
| Congelamento | os PRs abertos da frente declaram `main` congelada | descrições dos PRs #89 a #95 |
| Identidade de quem mescla e publica | conta pessoal da Direção (CLIs `gh` e `netlify` desta máquina) | `gh auth status`, `netlify status` |

Os controles técnicos (ruleset, Quality Gate e trava) **continuam valendo** com esta proposta. O que muda é **quem
autoriza** cada operação de rotina, não a proteção.

## 2. Classes de mudança

### VERDE: rotina, executada pelos agentes

Uma mudança é VERDE quando **todos** os itens abaixo valem, conferidos no diff e não na descrição do PR:

1. não cria nem altera arquivo em `supabase/migrations/`;
2. não muda RLS, concessões, papéis, funções auxiliares de acesso nem a matriz de permissões (`MATRIZ`);
3. não muda autenticação, credenciais, variáveis de ambiente nem cabeçalhos de chamadas privilegiadas;
4. não tem efeito financeiro real (liquidação, caixa, saldo, alçadas);
5. não liga nada que hoje está desligado: agendamento, envio externo, reconciliação, interruptor (*kill switch*);
6. não toca registro em produção (só código que roda quando alguém usa a tela);
7. tem recuperação de um passo: republicar o deploy anterior.

Na prática só a documentação é VERDE. O piso automático (`src/core/release/classe.ts`) nega por padrão:
- é AMARELO só o que está numa lista explícita: telas, componentes, regra pura em `src/core`, testes e propostas SQL;
- é VERMELHO todo o resto (banco, `src/data`, funções, scripts, build, configuração);
- são VERMELHOS também, pelo nome, os arquivos que decidem autorização, segredo, envio externo, dinheiro ou a própria
  política, como `CLAUDE.md`, este documento e o classificador.

### AMARELO: rotina com o efeito declarado

Mudança VERDE que **altera o comportamento visível** de uma tela que já está em uso, ou que **lê** uma entidade nova
sem gravar. Segue o mesmo rito, mas o efeito vai escrito no relatório à Direção **antes** da publicação.

### VERMELHO: crítica, com autorização específica da Direção

Qualquer item que falhe a lista VERDE, e sempre:

- migration de produção;
- RLS, permissões ou concessões;
- credenciais e configuração sensível;
- operação destrutiva;
- mudança financeira com efeito real;
- alteração relevante de autenticação;
- release de alto risco ou sem recuperação segura;
- qualquer PR que dependa de migration ainda não aplicada.

Para essas mudanças a frase `MERGE AUTORIZADO` continua obrigatória, e `PRODUCTION AUTORIZADA` também. Depois da
autorização, **os agentes executam** o procedimento aprovado, sem passar comandos ao Augusto.

**Na dúvida, a mudança é VERMELHA.** A classe é registrada no PR **antes** da revisão independente, e o revisor
confere a classe junto com o código.

## 3. Rito da mudança VERDE

| Passo | Quem | Evidência registrada no PR |
|---|---|---|
| 1. Classe declarada com a lista da seção 2 conferida item a item, e o piso calculado por `npx vite-node scripts/release-classe.mts -- pr origin/main <branch>` depois de `git fetch`. O piso nunca é rebaixado. **Só a saída 0 libera**: a saída 2 vale para VERMELHO e também para qualquer erro. A revisão confere ainda: dependência de coluna, RPC ou tabela que não existe em produção (caso da 0070), guarda de teste enfraquecida e efeito financeiro | agente orquestrador | comentário «Classe: VERDE/AMARELO» com os 7 itens e a saída do script, com os SHAs resolvidos |
| 2. Revisão independente: outro agente recebe o código, não a conclusão | agente revisor | veredito APTO e achados resolvidos |
| 3. Quality Gate verde **no SHA final** e branch atualizada com `main` | CI | link do run e SHA |
| 4. Merge pelo GitHub (`gh pr merge --merge`), sem bypass do ruleset | agente orquestrador | commit de merge |
| 5. Build do Netlify a partir da `main` (automático; a trava impede a publicação) | Netlify | id do deploy construído |
| 6. Publicação desse deploy e nova trava | agente orquestrador | id publicado, id anterior (para reverter), `locked: true` |
| 7. Verificação depois da publicação, sem gravar nada: o site responde, os assets carregam e a tela mudada abre em modo leitura | agente QA | resultado |
| 8. Reversão se o passo 7 falhar: republicar o deploy anterior e travar | agente orquestrador | ids e horário |

**A classe da publicação é a do conjunto, não a do PR.** Um deploy publica tudo o que está na `main` e ainda não
está no ar. Por isso o passo 6 confere o intervalo com o mesmo script, no modo de publicação:
`release-classe.mts -- publicacao <commit publicado> <candidato>`.
- Esse modo compara as **árvores** (dois pontos), não o merge-base.
- Ele **recusa** quando o publicado não é ancestral do candidato, porque publicar desfaria o que só existe no ar. Se qualquer commit desse intervalo
for VERMELHO e não tiver a própria autorização de publicação, a publicação é VERMELHA. A proposta da Frente A
(PR #98) chegou à mesma regra.

O passo 6 nunca publica deploy de outra branch nem de um SHA diferente do mesclado. Antes de cada merge, o agente
confere por leitura que a trava está ligada. Se estiver desligada, para e reporta (incidente de 30/09/2026).

## 4. Relatório

Cada entrega publicada vai ao relatório executivo da Direção como CONCLUÍDO, com a funcionalidade, o PR, o SHA, o run
do Quality Gate, o deploy publicado e o deploy anterior.

## 5. Decisões da Direção (18/11/2026)

| # | Decisão | Resultado |
|---|---|---|
| D1 | Para mudança VERDE ou AMARELA que cumpre a seção 3, o registro no PR substitui a frase `MERGE AUTORIZADO` | **aprovada** |
| D2 | Para mudança VERDE ou AMARELA, o agente publica o deploy construído e trava de novo (passos 6 a 8), sem `PRODUCTION AUTORIZADA` | **aprovada** |
| D3 | Identidade dos agentes | **opção B**: identidade própria, menor privilégio, rastreável. A sessão pessoal da Direção não é credencial operacional permanente |
| D4 | O congelamento da `main` deixa de valer para VERDE e AMARELO; continua para tudo que depende da S3 | **aprovada** |

## 5a. Identidade própria dos agentes (opção B)

**GitHub: GitHub App privada, registrada na conta do dono e instalada só no `eiff-control`.**
- Permissões:
  - Contents leitura e escrita (exigida pelo merge);
  - Pull requests leitura e escrita, para a App registrar no PR a classe, o parecer e a evidência;
  - Checks, Commit statuses e Metadata, só leitura.

  Declarado: com Contents escrita, a App também cria e apaga branches e tags que não sejam a `main`. A `main` continua
  protegida pelo ruleset.
- Sem Workflows, Administration, Secrets nem Actions. Consequência: mudança em `.github/` (já VERMELHA) continua sendo
  merge humano.
- Fora da lista de bypass do ruleset: a App obedece a PR obrigatório, ao Quality Gate e à branch atualizada, como
  qualquer outro ator.
- Token de instalação de 1 hora, gerado a cada operação a partir da chave privada.
- Os merges aparecem como `<app>[bot]`, separados da Direção.
- Não serve um usuário-máquina com fine-grained PAT: o fine-grained não alcança repositório pessoal em que o usuário é
  colaborador, e o PAT clássico vale para todos os repositórios da conta.

**Netlify: o Netlify não tem token restrito a um site nem escopos de API.**
- O menor alcance possível é um **usuário Netlify dedicado**, com MFA, convidado ao time com o papel **Developer só
  no projeto `eiff-control`**, mais um PAT dele com validade curta (90 dias).
- Os papéis abaixo de Developer não publicam em produção.
- Risco residual declarado: o token desse usuário também pode alterar variáveis e configuração **deste** site.
  Mitigações:
  - os agentes só chamam `getSite`, `listSiteDeploys`, `restoreSiteDeploy`, `lockDeploy` e `unlockDeploy`, numa lista
    fechada do script de publicação, que **ainda não existe** e é parte do C6;
  - antes e depois de cada publicação o agente confere, por leitura, a trava, a publicação automática parada e os
    **nomes** das variáveis do site (nunca os valores). Qualquer diferença não explicada é incidente;
  - o log de auditoria do time, se o plano tiver, é revisado pelo orquestrador a cada publicação e pela Direção uma
    vez por mês;
  - falta confirmar que o plano atual permite limitar o Developer a um único projeto. Se não permitir, o token alcança
    também o `eiff-site`, onde o encaminhador de leads está ativo, e a opção B não fecha sem trocar de plano.

**Guarda dos segredos:** Windows Credential Manager (ou arquivo DPAPI do usuário Windows), lidos no momento do uso.
Nunca no repositório, em `.env`, em log ou em mensagem.

**Revogação:**
- GitHub: apagar a chave da App ou suspender a instalação.
- Netlify: apagar o PAT ou remover o membro.

**Ação administrativa indispensável (só a Direção pode fazer):**
1. Registrar a GitHub App com as permissões acima, gerar a chave privada e instalar a App só no `eiff-control`.
2. Criar o usuário Netlify dedicado com MFA, dar a ele o papel Developer só no `eiff-control` e gerar o PAT de 90 dias.
3. Gravar App ID, Installation ID, a chave privada e o PAT no cofre da máquina. Os agentes indicam o comando, e o
   valor nunca passa pelo chat.

## 6. Controles a provar antes de a política entrar em operação

Cada item tem evidência registrada neste documento. Até o último, a política não opera.

| # | Controle | Prova | Estado |
|---|---|---|---|
| C1 | Proteção da branch | ruleset ativo, sem bypass, exige PR, Quality Gate e branch atualizada (`gh api .../rules/branches/main`) | conferido em 18/11 pela conta da Direção; repetir com a App |
| C2 | A App não fura a proteção | com a App, cinco recusas: push direto na `main`; merge de PR sem Quality Gate verde; merge com a branch desatualizada; alteração do ruleset; gravação em `.github/`. Testes com PR só de documentação | aguarda a App |
| C3 | Autenticação | o merge de rotina aparece no histórico como `<app>[bot]`, e nenhuma operação de rotina usa a conta pessoal | aguarda a App |
| C4 | Classe mínima automática | `src/core/release/classe.ts` com **negação por padrão** e teste. O script falha fechado e compara as árvores na publicação. Revisão independente de 18/11: rename, acento no caminho, três pontos na publicação, autoproteção e lacunas da lista, todos corrigidos e cobertos por teste. Sobre os PRs abertos: #89 VERMELHO (rota e menu com permissão), #59 VERDE (depois de tirar a linha do `CLAUDE.md`), #92 VERMELHO | **feito**; nova revisão independente pendente |
| C5 | Revisão independente registrada | parecer de outro agente no PR, sem achado aberto. **Controle procedimental**: o ruleset não exige aprovação, e nada técnico impede um merge sem revisão. A garantia vem do rito e da auditoria posterior (relatório) | rito em uso desde 18/11 |
| C6 | Publicação travada | com o usuário Netlify dedicado e o script de lista fechada: publicar um deploy só de documentação; conferir antes e depois a trava (`locked: true`), a publicação automática parada, o id publicado e os nomes das variáveis; confirmar que o Developer está limitado a um único projeto | aguarda o usuário Netlify e o script |
| C7 | Recuperação | com o mesmo usuário: restaurar o ponto de retorno anotado, conferir o id e a trava, e restaurar de novo o candidato | aguarda o usuário Netlify |

## 7. Classificação dos PRs abertos (18/11/2026)

Feita sobre o código, depois da revisão independente de cada PR.

| PR | Conteúdo | Classe | Por quê | Revisão independente |
|---|---|---|---|---|
| #89 | Central de Gestão Comercial, só leitura, restrita à Direção (`radar` + Administrador/Diretoria) | **VERMELHO** (piso do script) | cria rota e item de menu com regra de permissão (`App.tsx`, `Paleta.tsx`). Não depende da S3, porque não lê views. Na reavaliação de 18/11 a rota foi fechada à Direção (`eca79dd`): com `radar` sozinha, Financeiro, Compras, Gestor de obra e Engenharia veriam valores e dossiês consolidados | APTO COM RESSALVAS; o achado médio (KPI contava duas vezes o lead vencido) foi corrigido em `08a18f2` |
| #59 | documentação da 0068 já aplicada | **VERDE** | só `docs/commercial-director-1.0.md`; a linha do `CLAUDE.md` saiu do PR (`0269645`), porque o `CLAUDE.md` é VERMELHO | APTO COM RESSALVAS; a ressalva (texto desatualizado sobre a E3/E5) foi corrigida em `817c1d4` |
| #90 | permissões `comercial_gestao`/`comercial_projetos` e guardas do Radar | VERMELHO | muda a matriz de permissões | APTO COM RESSALVAS; a Engenharia continua lendo o Radar inteiro pelo app e pelo banco (D2 do documento da Central) |
| #91 | solicitações de projeto em memória | VERMELHO | depende do #90 | APTO COM RESSALVAS; as divergências da SQL já estão resolvidas na versão do #93 |
| #93 | persistência das solicitações (proposta SQL, adaptador desligado) | VERMELHO | depende do #90 e das migrations 0078–0080, depois da S3 | APTO COM RESSALVAS; os dois achados médios foram corrigidos em `ff7b50a` (smoke 19/19) |
| #95 | cabeçalhos da chave de serviço (S1/R1) | VERMELHO | credencial e chamadas privilegiadas | APTO; com a chave de hoje, os cabeçalhos são idênticos aos de antes |
| #92 | reconciliação a cada 10 min e monitor do formulário | VERMELHO | agendamento novo em produção (desligado por variável) e depende do #95 | APTO COM RESSALVAS; a quebra de CI com o #95 foi corrigida em `8b3b380` |
| #94 | chave central do e-mail (0076) | VERMELHO | migration, aplicada depois da 0077 | — |
| #96 | S3, migration 0077 | VERMELHO | RLS e permissões | APTO (3ª revisão) |
| #69, #21, #2 | documentação e integração antigas | fora | em conflito com a `main` e **não absorvidos** (revisão de 18/11). #69: a `main` ainda diz que a 0070 não foi aplicada. #21: §16.9/§16.10 do Inbox. #2: a 0052 está **aplicada em produção** (conferido em 18/11) e o arquivo não está na `main` | não fechar; refazer o conteúdo sobre a `main` |

Ordem de merge que respeita as dependências: #96 (S3) → #95 → #92; #89 → #90 → #91 → #93 (migrations depois da
S3); #94 depois da 0077.
