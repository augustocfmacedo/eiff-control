# Processo de release da Frente B (proposta de adequação formal)

**Situação: PROPOSTA.** Nada aqui vale até a Direção decidir os itens da seção 5. Até lá continuam valendo as regras
atuais: merge em `main` só com a frase `MERGE AUTORIZADO` e publicação só com `PRODUCTION AUTORIZADA`.

**Origem:** diretriz da Direção de 18/11/2026, «Diretriz permanente de autonomia operacional da Frente B». A diretriz
entrega aos agentes o merge e o deploy de rotina. Ela também diz que a delegação de rotina não revoga sozinha as regras
administrativas existentes. Este documento é a adequação formal que ela pede.

**Escopo:** CRM, máquina comercial, Inbox, formulário do site → CRM, segurança e integrações do `eiff-control`. O SIM-04
(engenharia estrutural) fica fora.

## 1. Situação conferida em 18/11/2026

| Controle | Estado | Como foi conferido |
|---|---|---|
| Ruleset `Protecao da main` (id 23878598) | ativo: exige PR, `EIFF Quality Gate` obrigatório, branch atualizada, sem force push, sem deleção, sem bypass | `gh api repos/.../rulesets` |
| Publicação no Netlify | travada: o deploy publicado `6afb298f` (commit `e55b3d6`, igual à `main`) está `locked: true`. Push em `main` constrói, mas não publica | `netlify api getSite`, só leitura |
| Merge | só com a frase `MERGE AUTORIZADO` (regra de 22/09/2026) | regra registrada |
| Publicação | só com `PRODUCTION AUTORIZADA`, separada do merge | regra registrada |
| Congelamento | os PRs abertos da frente declaram `main` congelada | descrições dos PRs #89 a #95 |

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

Exemplos: documentação, telas de leitura sob uma permissão já existente, correção de interface, teste novo, regra pura
em `src/core` sem efeito em dados.

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
| 1. Classe declarada com a lista da seção 2 conferida item a item | agente orquestrador | comentário «Classe: VERDE» com os 7 itens |
| 2. Revisão independente: outro agente recebe o código, não a conclusão | agente revisor | veredito APTO e achados resolvidos |
| 3. Quality Gate verde **no SHA final** e branch atualizada com `main` | CI | link do run e SHA |
| 4. Merge pelo GitHub (`gh pr merge --merge`), sem bypass do ruleset | agente orquestrador | commit de merge |
| 5. Build do Netlify a partir da `main` (automático; a trava impede a publicação) | Netlify | id do deploy construído |
| 6. Publicação desse deploy e nova trava | agente orquestrador | id publicado, id anterior (para reverter), `locked: true` |
| 7. Verificação depois da publicação, sem gravar nada: o site responde, os assets carregam e a tela mudada abre em modo leitura | agente QA | resultado |
| 8. Reversão se o passo 7 falhar: republicar o deploy anterior e travar | agente orquestrador | ids e horário |

O passo 6 nunca publica deploy de outra branch nem de um SHA diferente do mesclado. Antes de cada merge, o agente
confere por leitura que a trava está ligada. Se estiver desligada, para e reporta (incidente de 30/09/2026).

## 4. Relatório

Cada entrega publicada vai ao relatório executivo da Direção como CONCLUÍDO, com a funcionalidade, o PR, o SHA, o run
do Quality Gate, o deploy publicado e o deploy anterior.

## 5. Decisões da Direção que ativam este processo

| # | Decisão | Opções |
|---|---|---|
| D1 | Para mudança VERDE ou AMARELA que cumpre a seção 3, o registro no PR substitui a frase `MERGE AUTORIZADO` | sim / não |
| D2 | Para mudança VERDE ou AMARELA, o agente publica o deploy construído e trava de novo (passos 6 a 8), sem `PRODUCTION AUTORIZADA` | sim / não |
| D3 | Credencial da publicação: (a) a sessão da Netlify CLI já autenticada nesta máquina, usada só para publicar e travar deploys por id; ou (b) um token dedicado criado pelo Augusto, guardado fora do repositório | (a) / (b) |
| D4 | O congelamento da `main` deixa de valer para VERDE e AMARELO e continua para tudo que depende da S3 | sim / não |

Sem D1 e D2, os agentes continuam preparando tudo até o passo 3 e param antes do merge.

## 6. Classificação proposta dos PRs abertos (18/11/2026)

Feita sobre o código, depois da revisão independente de cada PR.

| PR | Conteúdo | Classe | Por quê | Revisão independente |
|---|---|---|---|---|
| #89 | Central de Gestão Comercial, só leitura, sob a permissão `radar` que já existe | **VERDE** | tela nova de leitura, sem permissão nova e sem gravação | APTO COM RESSALVAS; o achado médio (KPI contava duas vezes o lead vencido) foi corrigido em `08a18f2` |
| #59 | documentação da 0068 já aplicada | **VERDE** | só documentação | não revisado (2 arquivos de docs) |
| #90 | permissões `comercial_gestao`/`comercial_projetos` e guardas do Radar | VERMELHO | muda a matriz de permissões | APTO COM RESSALVAS; a Engenharia continua lendo o Radar inteiro pelo app e pelo banco (D2 do documento da Central) |
| #91 | solicitações de projeto em memória | VERMELHO | depende do #90 | APTO COM RESSALVAS; as divergências da SQL já estão resolvidas na versão do #93 |
| #93 | persistência das solicitações (proposta SQL, adaptador desligado) | VERMELHO | depende do #90 e das migrations 0078–0080, depois da S3 | APTO COM RESSALVAS; os dois achados médios foram corrigidos em `ff7b50a` (smoke 19/19) |
| #95 | cabeçalhos da chave de serviço (S1/R1) | VERMELHO | credencial e chamadas privilegiadas | APTO; com a chave de hoje, os cabeçalhos são idênticos aos de antes |
| #92 | reconciliação a cada 10 min e monitor do formulário | VERMELHO | agendamento novo em produção (desligado por variável) e depende do #95 | APTO COM RESSALVAS; a quebra de CI com o #95 foi corrigida em `8b3b380` |
| #94 | chave central do e-mail (0076) | VERMELHO | migration, aplicada depois da 0077 | — |
| #96 | S3, migration 0077 | VERMELHO | RLS e permissões | APTO (3ª revisão) |
| #69, #21, #2 | documentação e integração antigas | fora | em conflito com a `main`; precisam de decisão de arquivar ou refazer | — |

Ordem de merge que respeita as dependências: #96 (S3) → #95 → #92; #89 → #90 → #91 → #93 (migrations depois da
S3); #94 depois da 0077.
