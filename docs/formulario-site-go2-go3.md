# Formulário do site → EIFF Control: registro do GO-2 e projeto do GO-3

Este documento registra a decisão da Direção de 11/11/2026 (GO-2) e projeta a próxima etapa (GO-3).
Ele é só documentação: nada aqui está implementado além do que a seção 1 declara em produção.
O desenho da integração está em `docs/formulario-site.md`, o runbook da ativação em
`docs/formulario-site-ativacao.md` e o incidente do Inbox em `docs/eiff-inbox.md` §18.

Não há segredo, token, dado de lead nem log sensível neste arquivo.

---

## 1. Registro formal do GO-2

**Decisão.** Em 11/11/2026 a Direção aprovou o GO-2: **operação comercial provisória em produção**.
O GO-3 não foi declarado.

### 1.1 Estado homologado

| Item | Valor |
|---|---|
| Site no ar (Site-2) | `6af3b1bae1723549d0604a1d`, commit `311119e4b34f298df7c1108dd7f31fb54240eb93` |
| CRM no ar (CRM-1d) | `6af382b0d9c6f6a7b033daaa`, commit `6ce68bb814bf6234f62875b9619d0d5f3c763f1c` |
| Rollback da integração (Site-1, inerte) | `6af32e6486afff0f5fac4db0`, commit `dc1ff72` |
| Publicação do Site-2 | 11/11/2026, 08h40m19s (Goiânia), com a trava de produção ligada |
| Janela supervisionada | 08h40 às 09h41, 60 minutos completos, **sem incidentes** |
| Reconciliação automática | **desligada** |
| Marco da reconciliação | `2026-11-10T01:21:02Z`, preservado |
| Submissões históricas | 11, anteriores ao marco, **fora do processamento** |
| Registros do ensaio | preservados (conversa aberta, candidato pendente) |

### 1.2 O que está provado e o que não está

| Evidência | Situação | Quando |
|---|---|---|
| Entrada autenticada, evidência WEBSITE pendente sem entidade, conversa no Comercial com responsável, regra `ROT-SITE`, prazo de 30 minutos úteis | provado com uma submissão de ensaio | 10/11, 17h05 |
| Notificação por e-mail da submissão | confirmada pela Direção | 10/11 |
| Rascunho gravado e **não** cumprindo o SLA; contato realizado gravado e cumprindo, com horário declarado separado do horário do registro | provado no banco, no CRM-1d | 10/11, 17h54 e 17h56 |
| Idempotência: reenvio da mesma submissão devolve `IDEMPOTENTE`, passos `NADA`, banco idêntico | provado em produção, contra o CRM-1d | 10/11, 18h56 |
| Nenhuma empresa ou oportunidade criada automaticamente | confirmado em todas as leituras | 10 e 11/11 |
| **Encaminhamento do deploy que está no ar (`6af3b1ba`)** | **sem prova por tráfego real**: nenhuma submissão chegou na janela | pendente |

A primeira submissão real exige a conferência específica da seção 1.4.

O encaminhador do `6af3b1ba` é o mesmo código homologado (nenhuma mudança em `netlify/`, `netlify.toml`,
`tsconfig.json` ou `package.json` entre `dc1ff72` e `311119e`) e o deploy foi construído depois da última
alteração da variável do segredo. Isso sustenta a decisão; não substitui a prova.

### 1.3 Procedimento operacional provisório

| Passo | Regra |
|---|---|
| Responsável comercial | Augusto Macedo |
| Alerta de entrada | o e-mail em contato@eiff.com.br. O app **não** avisa lead novo |
| Durante o expediente (segunda a sexta, 8h–18h) | conferir o e-mail e o Inbox Comercial **a cada 20 minutos, no máximo** |
| Atendimento | contato por canal efetivo (telefone, e-mail, WhatsApp) dentro dos 30 minutos úteis |
| Registro | «Registrar contato já feito» **somente depois** do contato realizado, com meio e horário reais. Tentativa sem sucesso é registrada como tentativa e não cumpre o prazo. Rascunho não cumpre o prazo |
| Fora do expediente | o prazo começa a contar às 8h do próximo dia útil; conferir a caixa na abertura |
| Conferência diária | comparar Netlify Forms × Inbox no fim do dia |

O prazo de primeira resposta continua sendo de **30 minutos úteis**. Nenhuma destas medidas o garante:

- A conferência diária serve para **achar** submissão que não chegou ao CRM, não para cumprir prazo.
- O alerta por e-mail e a rotina de 20 minutos **reduzem o risco** de um lead passar despercebido. O cumprimento
  depende também de o e-mail chegar e ser visto, de o encaminhamento e o CRM estarem disponíveis e de haver
  alguém livre para fazer o contato. No pior caso da rotina, um lead é visto 20 minutos depois de entrar e
  sobram 10 para o contato.
- O e-mail do Netlify não tem garantia de entrega (`docs/formulario-site-ativacao.md` §10).

### 1.4 Conferência da primeira submissão real

Somente leitura, quando a Direção comunicar o recebimento:

1. ID da submissão no Netlify.
2. Entrega registrada no log do endpoint do CRM (`formulario_site`, resultado `REGISTRADO`).
3. Uma evidência WEBSITE, `PENDING`, sem entidade.
4. Uma única conversa no setor Comercial.
5. Responsável correto.
6. Prazo de primeira resposta de 30 minutos úteis.
7. Nenhuma duplicação.
8. Nenhuma empresa ou oportunidade criada automaticamente.

Se a entrega falhar: o lead continua no Netlify e no e-mail, o atendimento é manual, e o rollback da seção 1.5
é apresentado à Direção. Nenhum POST de teste sem autorização.

### 1.5 Rollback

Republicar o Site-1 `6af32e6486afff0f5fac4db0` e confirmar a trava. Suspende **só** o encaminhamento:
formulários, páginas e e-mail de notificação continuam, e nenhuma submissão se perde. O Site-1 tem a logomarca
anterior. Não existe deploy inerte com a logomarca atual.

Condições: falha de encaminhamento, resposta 401 ou 5xx, duplicação, conversa sem responsável ou sem prazo,
criação indevida de empresa ou oportunidade, erro de gravação no Inbox, regressão relevante do site.

### 1.6 Controle de publicações do eiff-site

Desde que a variável `EIFF_FORM_SECRET` existe no projeto do site, **todo build novo nasce com o encaminhador
ativo**. Publicar outro deploy não desliga a integração.

- Não publicar novo deployment do eiff-site sem coordenar com a Direção.
- Preservar `netlify/functions/submission-created.mts`, `netlify.toml`, `tsconfig.json` e os nomes dos
  formulários (`simular-galpao`, `iniciar-projeto`) e dos campos.
- Antes de publicar: função presente no deploy, variável sem alteração depois do build (só metadados, nunca o
  valor) e trava de produção ligada.
- Não criar, alterar nem remover variáveis; informar qualquer publicação.

### 1.7 Lições da ativação

| Fato | Regra que fica |
|---|---|
| O Inbox não gravava nenhuma alteração de conversa em produção, e a tela mostrava o rascunho como se existisse | «gravado» se confere no banco, nunca só na tela |
| Resposta 401 do endpoint foi lida como prova de configuração | 401 não prova nada sobre o segredo; a prova é a submissão virar evidência e conversa |
| Variável alterada depois do build | variável nova exige novo deploy do lado alterado; conferir a data da variável contra a do build |
| `netlify env:list` só mostra o contexto de desenvolvimento | ler metadados por `getEnvVars` (nome, escopo, contexto, data), nunca o valor |
| A `main` do site mudou três vezes durante a ativação, e uma publicação de outra frente ativou a integração por cerca de 11 horas sem supervisão | seção 1.6 |
| Dois reenvios manuais falharam com «fetch failed» sem sair da máquina | seção 4.3 |

---

## 2. Matriz de riscos da operação provisória

| # | Risco | Probabilidade | Impacto | Mitigação hoje | Fecha com |
|---|---|---|---|---|---|
| R1 | Submissão não chega ao CRM (função do site falha; o evento não tem reenvio) | baixa | alto: lead sem conversa nem prazo | e-mail de notificação + conferência diária | GO-3 (reconciliação) |
| R2 | Lead chega e ninguém vê dentro de 30 minutos | média | alto: SLA vencido | alerta por e-mail e rotina de 20 minutos (reduzem o risco, não o eliminam) | aviso de lead novo (outra frente) |
| R3 | Outra frente publica o site e muda o comportamento | média | médio | seção 1.6 | coordenação; revisão do processo de publicação |
| R4 | Variável do segredo alterada em um lado só | baixa | alto: toda submissão recusada (401) | conferência de metadados antes de publicar | GO-3 (reconciliação recupera) + alerta |
| R5 | Encaminhamento do deploy atual nunca foi exercitado por tráfego real | — | médio | seção 1.4 | primeira submissão real |
| R6 | App mostra alteração local como gravada quando a sincronização falha | baixa | médio | conferir «sincronizado» no topo | correção de interface (outra frente) |
| R7 | Reconciliador manual pode imprimir o valor de um cabeçalho em um tipo de erro | baixa | alto: exposição de segredo | usar a cópia de diagnóstico local; não usar o script em sessão compartilhada | GO-3 etapa 1 |
| R8 | Conversa do ensaio e candidato pendente poluem as listas | certa | baixo | identificados como ensaio | limpeza com autorização própria |

---

## 3. GO-3: objetivo e decisões pendentes

**Objetivo.** Nenhuma submissão válida se perde sem que alguém fique sabendo: a reconciliação automática lê
as submissões no Netlify e grava o que não entrou, e um alerta avisa quando algo falha.

### 3.1 Decisões que o GO-3 pede da Direção

| # | Decisão | Opções | Preferência registrada |
|---|---|---|---|
| D1 | Credencial de leitura do Netlify | usuário técnico restrito ao projeto do site · reconciliação manual por arquivo · token pessoal administrativo | usuário técnico; **token pessoal administrativo descartado** |
| D2 | Frequência da rodada | de hora em hora (atual) · a cada 10 minutos · a cada 10 minutos só no expediente | a analisar (seção 4.2) |
| D3 | Canal de alerta | e-mail nativo do Netlify para função com falha · envio próprio por provedor de e-mail | destino augusto@eiff.com.br; canal sujeito a autorização |
| D4 | Prova de recuperação em produção | exigir um ensaio específico · aceitar a prova de banco do repositório + primeira rodada real | a decidir |
| D5 | Onde a reconciliação roda | no projeto do CRM (atual) | sem mudança proposta |

### 3.2 O que a pesquisa na documentação do Netlify confirmou e o que ficou em aberto

Consultado em 11/11/2026 (links na seção 8).

| Pergunta | Resposta |
|---|---|
| Dá para restringir um membro a projetos específicos? | **Sim.** Papéis Developer, Publisher, Internal Builder e Reviewer aceitam acesso por projeto; Owner, Git Contributor e Billing Admin não. O Owner configura em Team settings › Members, e a mudança vale na hora |
| Qual é o papel mínimo que lê formulários e submissões? | **Não documentado.** A página de papéis não cita formulários. Reviewer só acessa prévias; Internal Builder não acessa a configuração do projeto. O candidato é **Developer restrito ao projeto do site**, a confirmar na prática |
| O que mais o papel Developer carrega? | Acesso e edição da configuração do projeto, disparo de builds, visibilidade do projeto, aprovação de Reviewers. A documentação não cita variáveis de ambiente nominalmente, mas elas fazem parte da configuração do projeto: **assumir que um Developer do projeto consegue ler e alterar as variáveis do site, inclusive o segredo** |
| O token de um membro restrito fica restrito aos projetos dele? | **Não documentado.** Tem de ser testado antes de confiar: com o token do usuário técnico, listar os projetos e confirmar que o do CRM não aparece |
| Existe token com escopo «só ler submissões»? | **Não.** O token pessoal não tem modelo de escopos; o alcance é o do usuário |
| Expiração | escolhida na criação do token |
| Revogação | a documentação consultada só descreve a invalidação de todos os tokens por troca de senha; a exclusão de um token individual fica na página de aplicações do usuário, **a confirmar** |
| Custo de um membro a mais | no plano Pro por créditos, assentos são ilimitados e sem custo adicional; nos planos antigos, Developer é assento pago. **O tipo do plano contratado precisa ser conferido no painel** |
| Limite da API | 500 requisições por minuto na maioria das operações |

**Consequência para D1.** Um usuário técnico Developer restrito ao projeto do site reduz o alcance em relação
ao token administrativo (não enxerga o CRM, a cobrança nem os outros projetos), mas **não é somente leitura**:
quem tiver o token pode alterar a configuração do site. É a menor credencial que a plataforma oferece hoje,
não a credencial ideal. Compensações: token com expiração curta e rotação agendada, guardado só no painel do
projeto do CRM com escopo Functions, e conta do usuário técnico com 2FA.

Verificações antes de criar o usuário (nenhuma executada):

1. Tipo do plano (créditos ou antigo) e se o acesso por projeto está disponível nele.
2. Custo do assento.
3. Com o usuário criado e antes de gerar o token definitivo: o que ele vê no painel, e o que um token dele lista
   pela API (projetos, formulários, submissões, variáveis).
4. Onde se revoga um token individual.

---

## 4. Arquitetura proposta

### 4.1 Visão geral

```
Netlify Forms (projeto do site)
   │  evento de submissão                      ── caminho principal, já em produção
   ▼
submission-created (função do site) ──POST──▶ /api/formulario-site (CRM) ──▶ evidência + conversa

Netlify API (leitura das submissões)           ── rede de segurança, GO-3
   ▲
   │  token do usuário técnico
formulario-reconciliar (função agendada do CRM)
   │  mesma chave de idempotência (id da submissão), mesmo caminho de gravação
   ├──▶ evidência + conversa do que não entrou
   └──▶ uma linha de resumo por rodada ──▶ alerta (GO-3 etapa 4)
```

O que já existe no código e está desligado: a função agendada `netlify/functions/formulario-reconciliar.mts`,
com a decisão em `src/core/radar/formularioAgendado.ts`. Hoje ela responde «desligada» a cada hora.
Ela exige duas chaves (`FORMULARIO_RECONCILIACAO=ativa` e `EIFF_FORM_MARCO`), além de `NETLIFY_AUTH_TOKEN` e
`EIFF_FORM_NETLIFY_SITE`. Submissão anterior ao marco é sempre retida, e a rodada agendada não tem como
liberá-la.

### 4.2 Frequência: de hora em hora × a cada 10 minutos

O prazo de primeira resposta é de 30 minutos úteis contados do instante **original** da submissão.

| Frequência | Espera máxima até a próxima rodada começar | Efeito no SLA de 30 min |
|---|---|---|
| de hora em hora | 60 min | a conversa recuperada pode nascer já vencida |
| a cada 10 minutos | 10 min | no pior caso de espera restam até 20 minutos para o atendimento, menos a latência e o processamento descritos abaixo |
| a cada 5 minutos | 5 min | ganho pequeno sobre a opção de 10 |

De hora em hora foi escolhido quando o prazo era de um dia. Com 30 minutos, a rodada de hora em hora não
deixa margem; a de 10 minutos **reduz o atraso da recuperação**, mas **não garante** que a submissão
recuperada seja atendida no prazo. A coluna do meio é só a espera pelo início da rodada. O tempo real até a
conversa existir soma ainda:

- a latência do agendador (a plataforma não promete o minuto exato);
- a leitura da API do Netlify e a gravação no banco;
- a disponibilidade dos dois serviços naquela rodada (se ela falhar, a próxima só vem 10 minutos depois);
- a fila: o que passar do lote fica para a rodada seguinte.

E, depois que a conversa existe, o prazo ainda depende de alguém vê-la e fazer o contato (seção 1.3). A
reconciliação é rede de segurança contra perda, não mecanismo de cumprimento do SLA.

| Item | De hora em hora | A cada 10 min | A cada 10 min, só no expediente |
|---|---|---|---|
| Expressão (UTC) | `0 * * * *` | `*/10 * * * *` | `*/10 11-20 * * 1-5` |
| Rodadas por mês | ~730 | ~4.380 | ~1.300 |
| Requisições à API do Netlify por rodada | 3 (lista de formulários + uma página por formulário) | igual | igual |
| Consumo estimado de computação | ~0,4 GB·h | ~2,4 GB·h | ~0,7 GB·h |
| Em créditos (10 por GB·h, plano por créditos) | ~4 | ~24 | ~7 |

Premissas do consumo: 1 GB de memória e cerca de 2 segundos por rodada sem trabalho. São estimativas, não
medição; o plano Pro por créditos começa em 3.000 créditos por mês. Em plano antigo a conta é outra e precisa
ser conferida. A documentação não cita intervalo mínimo para o agendamento.

A variante «só no expediente» economiza pouco e deixa a noite sem cobertura; como o prazo de uma submissão
noturna só começa às 8h, a primeira rodada do dia resolve. A decisão é de custo e simplicidade (D2).

**Limites de execução.** Função agendada tem 30 segundos, sem configuração; só roda em deploy **publicado**;
não aceita chamada por URL em produção; a documentação não menciona reexecução automática.

**Tamanho dos lotes.** Hoje: até 20 submissões por rodada, com reserva de 8 segundos dentro dos 30, e até
10 páginas de leitura. A rodada primeiro tira da fila o que já está inteiramente dentro, para as vagas não
serem gastas sempre nas mesmas. Com rodada a cada 10 minutos o lote de 20 continua folgado: o volume atual é
de menos de uma submissão por dia. O que ficar de fora volta na rodada seguinte.

**Falhas consecutivas.** Hoje cada rodada é independente: falhou, a próxima tenta de novo, e nada conta as
repetições. Proposta para o GO-3:

- a rodada que não pôde rodar continua respondendo 503 e registrando o desfecho;
- o alerta dispara na **segunda** falha seguida do mesmo tipo (uma falha isolada de rede não acorda ninguém);
- falha de credencial (401 ou 403 na leitura) alerta **na primeira**, porque não se resolve sozinha;
- sem contador persistente no primeiro momento: a regra «duas seguidas» pode ser avaliada lendo os resumos das
  últimas rodadas, ou por um registro mínimo de estado (a decidir na etapa 4).

### 4.3 Tratamento seguro de erros

Revisão dos dois caminhos (nenhum código alterado):

| Onde | O que acontece hoje | Risco |
|---|---|---|
| `scripts/formulario-reconciliar.mts`, falha de envio | imprime `(e as Error).message` | em um tipo de erro de cabeçalho o Node põe **o valor do cabeçalho** na mensagem: o segredo iria para a tela |
| idem | descarta `error.cause` | «fetch failed» não distingue cabeçalho inválido de falha de rede: foi o que impediu o diagnóstico em 10/11 |
| `src/core/radar/formularioAgendado.ts`, falha de leitura, de estado e de gravação | registra `(e as Error).message` no log da função | mesma classe de risco para o token de leitura (cabeçalho `authorization`), agora num log persistente |
| os dois | não validam o valor da credencial antes de usar | valor com caractere de controle falha sem explicação |

Reproduzido localmente, com valores fictícios e servidor de teste: caractere de controle no cabeçalho devolve
«fetch failed» com causa `UND_ERR_INVALID_ARG` e nem abre conexão; quebra de linha interna devolve uma mensagem
que contém o valor.

Proposta:

1. **Validar a credencial antes de qualquer requisição.** Aceitar só o que o HTTP aceita em cabeçalho
   (tab, 0x20–0x7E, 0x80–0xFF); recusar com o código `CREDENCIAL_INVALIDA`, sem tocar a rede.
2. **Nunca registrar a mensagem bruta da exceção.** Registrar um código técnico de um catálogo fechado:
   o `code` da causa quando ele casa com `^[A-Z0-9_]{1,40}$`, senão `SEM_CODIGO`. Erros HTTP continuam como
   `http <status>`.
3. **Uma função única** para transformar exceção em código, usada pelo script e pela função agendada.
4. **Testes de não vazamento.** Para cada caminho de erro, rodar com uma credencial fictícia reconhecível e
   afirmar que ela não aparece em nenhuma saída, em nenhum log e em nenhum corpo de resposta, inclusive nos
   casos em que o Node a inclui na mensagem.
5. **Resultado estruturado.** Manter a linha única por rodada (`RECONCILIACAO_AGENDADA`) e acrescentar a ela o
   código do erro e a etapa (`leitura`, `estado`, `gravacao`), sem conteúdo de lead.

### 4.4 Alertas

Destino: augusto@eiff.com.br. O canal de envio depende de autorização posterior; nada foi configurado.

| Alerta | Quando dispara | Conteúdo |
|---|---|---|
| Falha de leitura | segunda falha seguida; na primeira se for de credencial | etapa, código, horário, quantas seguidas |
| Falha de gravação | qualquer submissão que não entrou depois de duas rodadas | quantidade, código, horário |
| Recuperação | a reconciliação gravou algo que o evento não entregou | quantidade e horário: indica que a função do site falhou |
| Rodada não executada | nenhuma rodada registrada no intervalo esperado (duas janelas) | horário da última rodada |
| Falhas consecutivas | três ou mais rodadas seguidas sem concluir | quantidade e o código mais recente |

**Sem dado pessoal.** O alerta leva contagens, códigos, etapas e instantes. Nunca nome, e-mail, telefone,
empresa, texto da solicitação nem o id da submissão. Quem recebe abre o Inbox ou o Netlify para ver o caso.

«Rodada não executada» não pode ser detectada pela própria rodada: precisa de um observador separado (uma
segunda função agendada mais espaçada, ou um monitor externo). É a parte mais cara do desenho e pode ficar para
uma segunda fase.

Opções de canal (D3):

| Canal | Vantagem | Limite |
|---|---|---|
| Notificação nativa do Netlify | sem código e sem credencial nova | a documentação consultada não confirma notificação por falha de função; a verificar |
| Envio próprio por provedor de e-mail | controle total do conteúdo e das regras | exige credencial nova e autorização de canal de saída, que hoje não existe em nenhum módulo |

---

## 5. Plano de implementação em etapas

Cada etapa tem autorização própria. Nenhuma foi iniciada.

| Etapa | Entrega | Toca produção? | Depende de |
|---|---|---|---|
| 0 | Este documento revisado e as decisões D1 a D5 | não | — |
| 1 | PR de código: validação de credencial, códigos de erro, testes de não vazamento (script e função agendada) | só com merge e deploy autorizados; a reconciliação continua desligada | etapa 0 |
| 2 | Usuário técnico: verificações da seção 3.2, criação, token com expiração, registro da data de rotação | variável nova no painel do CRM (feita pela Direção) | D1 |
| 3 | PR de código: nova frequência (D2) e ajustes de lote, se houver | só com merge e deploy autorizados | D2, etapa 1 |
| 4 | Alertas: canal (D3), regras da seção 4.4, testes | credencial de envio, se for canal próprio | D3, etapa 1 |
| 5 | Ativação: `EIFF_FORM_MARCO`, `EIFF_FORM_NETLIFY_SITE`, token, `FORMULARIO_RECONCILIACAO=ativa`, novo deploy do CRM | sim | etapas 1 a 4 homologadas |
| 6 | Acompanhamento de 15 dias e parecer do GO-3 | leitura | etapa 5 |

As variáveis da etapa 5 são criadas pela Direção no painel, em Production e escopo Functions. A chave
`FORMULARIO_RECONCILIACAO` é a última a ser ligada.

---

## 6. Plano de homologação

Nenhum teste novo é executado em produção nesta fase. Os de banco rodam em PostgreSQL descartável
(`npm run smoke:formulario`, hoje com 40 provas); os de unidade usam `fetch`, ambiente e relógio injetados.

**Dois mecanismos, duas coisas que cada um prova.** Os cenários abaixo dizem qual deles é a evidência.

| Mecanismo | O que consulta | O que consegue afirmar |
|---|---|---|
| Simulação manual (`scripts/formulario-reconciliar.mts` sem `--executar`) | só as submissões (API do Netlify ou arquivo) e o marco | quais são **retidas** e quais são **elegíveis** a reenvio. **Não lê o banco**: não sabe o que já entrou e trata toda submissão posterior ao marco como «a reenviar» |
| Rodada agendada (`formulario-reconciliar`, função do CRM) | as submissões, o marco **e o banco** (evidência da mesma impressão, conversa e prazo) | além de retidas e elegíveis, quais já estão inteiramente dentro (`jaDentro`) e não precisam de nada. Só ela distingue «elegível» de «a processar» |

Com o baseline de 12 submissões (11 anteriores ao marco e o ensaio), a simulação manual mostra 11 retidas e
**1 a reenviar**; a rodada agendada mostra 11 retidas, 1 elegível, **1 já dentro e 0 processadas**. Os dois
resultados estão certos: a simulação não tem como saber que o ensaio já foi gravado. Se o reenvio manual for
de fato executado, quem responde é o endpoint, com `IDEMPOTENTE` (provado em 10/11).

| # | Cenário | Como se prova | Aceite |
|---|---|---|---|
| H1 | 11 históricos retidos | simulação manual (sem gravar, sobre arquivo exportado ou com a credencial) e teste de unidade do plano | lidas = 12; **retidas = 11**, todas pelo motivo «anterior ao marco»; **a reenviar = 1** (o ensaio, que a simulação não tem como saber que já entrou). Nada é enviado |
| H2 | Ensaio reconhecido como já processado | **rodada agendada** (resumo `RECONCILIACAO_AGENDADA`) e teste de unidade com a porta de estado; a simulação manual **não** prova este cenário | elegíveis = 1; **jaDentro = 1**; processadas = 0; nenhuma gravação. Vale só se evidência da mesma impressão, conversa e prazo estiverem corretos; faltando um, a submissão deixa de ser «já dentro» e é processada (cenário H6) |
| H3 | Recuperação idempotente | prova de banco (já existe) + D4 | reenvio devolve `IDEMPOTENTE`; banco idêntico |
| H4 | Falha de credencial | teste de unidade: token ausente, inválido, recusado (401, 403) | desfecho `nao_configurada` ou `erro_de_leitura`, código registrado, **credencial ausente de toda saída**, resposta 503 |
| H5 | Falha de rede | teste de unidade com `fetch` que lança | código da causa registrado; nada gravado; próxima rodada tenta de novo |
| H6 | Falha parcial | prova de banco: evidência gravada, conversa não | a rodada seguinte **completa** a conversa; nenhuma duplicação |
| H7 | Ausência de execução | observador da seção 4.4, com relógio injetado | alerta depois de duas janelas sem rodada |
| H8 | Integridade do banco | fotografia antes e depois de cada rodada de homologação | nenhuma alteração além da submissão recuperada; zero empresa, zero oportunidade |
| H9 | Primeira rodada real | resumo da **rodada agendada** e fotografia do banco antes e depois, com a Direção acompanhando | desfecho `concluida`; lidas = total das submissões dos dois formulários (12 no baseline, mais as reais que tiverem chegado); retidas = 11; elegíveis = total − 11; **jaDentro = elegíveis**; processadas = 0; restam = 0; recuperadas = 0; falhas = 0; banco idêntico. Se alguma submissão real não tiver entrado pelo caminho principal, processadas e recuperadas deixam de ser zero: é recuperação legítima, a conferir pelos oito itens da seção 1.4 |
| H10 | 15 dias de acompanhamento | leitura diária dos resumos | nenhuma falha não explicada; toda recuperação investigada; nenhum alerta falso recorrente |

A conferência de cada rodada usa o que o banco tem gravado, nunca a tela.

---

## 7. Rollback do GO-3

| Situação | Ação | Efeito |
|---|---|---|
| Reconciliação gravando errado | apagar `FORMULARIO_RECONCILIACAO` (ou trocar o valor) e publicar novo deploy do CRM | a função volta a responder «desligada»; nada é apagado |
| Suspeita sobre a credencial | revogar o token do usuário técnico no Netlify | a leitura passa a falhar com código registrado; o caminho principal não é afetado |
| Alerta com ruído | desligar o canal | a reconciliação continua |
| Regressão no CRM depois de um deploy do GO-3 | republicar o CRM-1d `6af382b0d9c6f6a7b033daaa` | volta ao estado do GO-2 |

A reconciliação não altera o caminho principal: desligá-la devolve a operação exatamente ao estado do GO-2.

---

## 8. Fontes consultadas (11/11/2026)

- Netlify, Roles and permissions: https://docs.netlify.com/manage/accounts-and-billing/team-management/roles-and-permissions/
- Netlify, Manage project access: https://docs.netlify.com/manage/accounts-and-billing/team-management/manage-project-access/
- Netlify, Scheduled Functions: https://docs.netlify.com/build/functions/scheduled-functions/
- Netlify, How credits work: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- Netlify, Get started with the API: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
- Netlify, User settings: https://docs.netlify.com/manage/accounts-and-billing/user-settings/

O que essas páginas não respondem está marcado como «não documentado» ou «a confirmar» na seção 3.2.
