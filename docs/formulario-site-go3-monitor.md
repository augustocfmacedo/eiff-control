# Formulário do site → CRM: monitor, alertas e frequência do GO-3 (E10.15 e E10.17)

Estado: **implementado e provado localmente, NÃO publicado, NÃO ativado.** Runbook: `formulario-site-go3-runbook.md`. A reconciliação continua desligada em
produção. Este documento é o relatório de homologação técnica da Frente A; a operação está em
`formulario-site-go2-go3.md` (§1.3.1 para os ensaios, §6 para o plano de homologação) e o runbook em
`formulario-site-ativacao.md`.

## 1. O que existe

| Peça | Arquivo | Papel |
|---|---|---|
| Regras do monitor | `src/core/radar/formularioMonitor.ts` | puro: avalia a sequência de rodadas e decide os alertas; catálogo fechado de códigos; barreira de dado pessoal; orçamento de frequência |
| Persistência | `src/core/radar/formularioMonitorPorta.ts` | rodadas, reivindicações e entregas na `audit_log` (sem migration), pela porta REST com a chave de serviço; porta em memória para testes |
| Observador | `src/core/radar/formularioObservador.ts` + `netlify/functions/formulario-observador.mts` | função agendada **separada** da rodada: lê, avalia, deduplica, entrega |
| Canais | `src/core/radar/formularioAlertaCanais.ts` | `registro` (log da função, padrão), `webhook` (POST JSON assinado), `com registro` (trilha + entrega), `composto`; canal simulado para testes |
| Contrato para a Central | `src/core/radar/formularioMonitorCentral.ts` | somente leitura, sem dado pessoal, versão `formulario-reconciliacao/v1` |
| Registro da rodada | `netlify/functions/formulario-reconciliar.mts` (+1 chamada) | grava o resumo da rodada quando o monitor está ligado; nunca muda a resposta da rodada |
| Concorrência | `src/core/radar/formularioConcorrencia.ts` | classificador da falha depois de uma corrida entre rodadas; **ligado à rodada** (§8) |
| Consulta da Auditoria | `src/data/supabase.ts` (`consultaAuditoria`) | a tela de Auditoria exclui as linhas do monitor no banco, antes do limite de 500 |
| Testes | `formularioMonitor.test.ts`, `formularioConcorrencia.test.ts`, `src/data/auditoria.consulta.test.ts` | 48 + 8 + 3 testes (vitest) |
| Prova em banco | `scripts/pg-smoke-monitor.mts` (`npm run smoke:monitor`) | 23 provas em PostgreSQL descartável (PGlite) |

Interruptores, todos **desligados por padrão** e nenhum configurado:

| Variável (painel do CRM, Production, escopo Functions) | Efeito |
|---|---|
| `FORMULARIO_MONITOR = ativo` | liga o registro das rodadas e o observador. Outro valor ou ausente = desligado (não lê nem grava nada) |
| `FORMULARIO_INTERVALO_MIN` | intervalo esperado entre rodadas; padrão 10 (o `schedule` da rodada). Inválido cai no padrão, nunca em zero |
| `FORMULARIO_ALERTA_CANAL = webhook` + `FORMULARIO_ALERTA_WEBHOOK_URL` + `FORMULARIO_ALERTA_WEBHOOK_SEGREDO` | soma um POST JSON assinado (HMAC-SHA256, https, segredo ≥ 32) ao registro; a ENTREGA depende do webhook. Sem URL https ou sem segredo forte, fica só o registro e o motivo é logado (sem o valor). Formato e reenvio: `formulario-site-go3-runbook.md` §4 D3 |

O monitor reaproveita `SUPABASE_SERVICE_ROLE_KEY` e `EIFF_INBOX_ORGANIZATION_ID`, que já existem. Não usa nada da
frente de e-mail comercial (`GOOGLE_OAUTH_*`, `email-comercial`): um teste varre o código e falha se aparecer.

## 2. Alertas

| Tipo | Quando | Severidade |
|---|---|---|
| `FALHA_LEITURA` | a rodada não leu o Netlify. Credencial (ausente, inválida, 401, 403): na 1ª rodada. Transitória (5xx, rede): na 2ª seguida | crítico |
| `CONFIGURACAO` | ligada sem marco, site ou banco | crítico |
| `FALHA_GRAVACAO` | rodada **concluída** com `falhas > 0` — o caso em que a função responde HTTP 200 | aviso na 1ª; crítico na 2ª seguida |
| `FALHAS_CONSECUTIVAS` | 3 ou mais rodadas seguidas com problema, de qualquer tipo | crítico |
| `RODADA_AUSENTE` | nenhuma rodada há mais de 2 intervalos + 5 min (25 min com rodada de 10 min). Só o observador separado vê | crítico |
| `RECUPERACAO` | a rodada gravou submissão que o evento do site não entregou | aviso |
| `DESLIGADA` | a reconciliação foi desligada de propósito: avisa **uma vez** por período desligado; ausência e falha não contam | informativo |

Conteúdo: tipo, severidade, código de catálogo, contagens e instantes. O motivo bruto da rodada nunca é copiado
(vira código; o que não casa vira `OUTRO`), e a mensagem pronta passa de novo pela barreira
`problemasDeDadoPessoal` antes de sair (e-mail, sequência de dígitos, id de submissão, uuid, palavra de credencial).

### Entrega e deduplicação

A `audit_log` não tem índice único, então a deduplicação usa um protocolo de três linhas:

1. **reivindicação** (`action = alerta`, `entity_id` = chave): o banco dá um id `bigserial`;
2. o observador relê as reivindicações da mesma chave nos últimos `JANELA_REIVINDICACAO_MIN` (5 min) e **só segue
   quem tem o menor id** — dois observadores ao mesmo tempo nunca avisam os dois;
3. canal aceitou → **entrega** (`action = alerta_entregue`). Sem entrega, a passada seguinte tenta de novo.

A chave do alerta usa o **início** do problema: o mesmo problema contínuo tem a mesma chave e é avisado uma vez,
com lembrete depois de 6 h; mudança de severidade ou de código gera chave nova. Garantia: **ao menos uma vez**;
duplicata só se a gravação da entrega falhar depois de o canal aceitar.

## 3. Resultados da prova em PostgreSQL descartável (`npm run smoke:monitor`, 16/11/2026: 23 de 23)

Parte A: `audit_log`, índices e políticas extraídos das migrations 0001, 0003 e 0005; a porta REST de produção roda
contra o banco por um tradutor PostgREST → SQL, como `service_role`.

| # | Prova | Resultado |
|---|---|---|
| A1 | rodada gravada (entidade, ação, origem `formulario-monitor`, `actor_id` nulo) e lida de volta igual | ok |
| A2 | a linha passa pelo mapeamento de auditoria do app | ok |
| A3 | Administrador vê; Compras e anon não; o app (`authenticated`) **não** consegue gravar como monitor (política exige `source = app`) | ok |
| A4 | dois observadores ao mesmo tempo: 2 reivindicações, **1 entrega** | ok |
| A5 | a passada seguinte suprime, sem linha nova | ok |
| A6 | canal fora do ar: sem entrega; a passada seguinte entrega uma vez | ok |
| A7 | execução interrompida depois de reivindicar: a órfã segura só dentro da janela; depois o alerta sai uma vez | ok |
| A8 | sem permissão de gravar, o registro da rodada devolve `falhou` e não lança | ok |
| A9 | só `SELECT` + `INSERT` na `audit_log` e `USAGE` na sequência bastam ao ciclo inteiro | ok |
| A-PII | nenhuma linha gravada pelo monitor tem dado pessoal ou segredo | ok |
| A10 | 30 dias a cada 10 min = 4.320 rodadas, ~2,3 MB (≈ 28 MB/ano); consulta por índice (bitmap). **Efeito colateral confirmado** (consulta antiga): das últimas 500 linhas da tela de Auditoria, 467 eram do monitor (só 33 de 300 registros reais apareciam) | medido |
| A11 | **correção (E10.18)**: a consulta oficial da tela (`consultaAuditoria`), gerada pelo supabase-js e executada como Administrador, traz os 300 registros de negócio e 0 do monitor; as 4.337 linhas do monitor continuam no banco e o monitor segue lendo as suas | ok |

Parte B: schema real do Lead Engine e do Inbox (0055–0057), rodada real, Netlify simulado, dados fictícios.

| # | Prova | Resultado |
|---|---|---|
| B1 | submissão perdida pelo evento é recuperada: 1 evidência, 1 mensagem, 1 conversa | ok |
| B2 | a entregue pelo evento fica «já dentro»; a anterior ao marco e o ensaio excluído ficam retidos | ok |
| B3 | o prazo da conversa recuperada conta da submissão ORIGINAL (não é redefinido) | ok |
| B4 | rodadas repetidas e simultâneas: continua exatamente uma vez | ok |
| B5 | duas rodadas ao mesmo tempo sobre uma submissão nova perdida: exatamente uma vez (índice único da evidência e da mensagem) | ok |
| B6 | o monitor lê o resumo real e avisa `RECUPERACAO`, sem dado pessoal; zero empresa, zero oportunidade | ok |
| B7 | **correção (E10.19)**: duas rodadas simultâneas — a perdedora fica `CONCORRENTE`, 0 falhas, nenhum `FALHA_GRAVACAO`; a seguinte vê tudo «já dentro». (Na E10.17 esta prova media o falso aviso.) | ok |
| B8 | classificador (E10.18): na corrida real, a gravação que perde (409 na evidência) é `CONCLUIDA_POR_OUTRA_RODADA` | ok |
| B9 | classificador: conflito com a conversa ainda ausente é `PARCIAL`; a gravação seguinte completa, exatamente uma vez | ok |
| B10 | classificador: falha real da conversa (503) é `ERRO_PERSISTENCIA`, mesmo com a evidência gravada | ok |

Limites da prova: PGlite é uma conexão (concorrência = intercalação nos `await`); o tradutor cobre só o que a porta
usa; o relógio do banco é controlado pela prova (`occurred_at` lê o GUC `prova.agora`); a parte B roda como dono.

### O que a `audit_log` não garante, e a alternativa

| Ponto | Situação | Proposta |
|---|---|---|
| Tela de Auditoria tomada pelo monitor (A10) | **corrigido na E10.18**: `consultaAuditoria` em `src/data/supabase.ts` aplica `entity_type <> 'formulario_reconciliacao'` na consulta ao banco, antes do `order` e do `limit 500` (prova A11 e `src/data/auditoria.consulta.test.ts`) | a tabela própria segue como alternativa, não necessária para ligar |
| Deduplicação sem índice único | resolvida pelo protocolo de reivindicação (A4–A7); vale ao menos uma vez | com tabela própria, `unique (organization_id, chave, janela)` dá exatamente uma vez no banco |
| Retenção | ~28 MB/ano; nada apaga | tabela própria permite expurgo por idade sem tocar a auditoria imutável |
| Privilégio | a chave de serviço tem muito mais que `SELECT`/`INSERT` (A9 mostra o mínimo necessário) | RPC `security definer` só com o necessário |

**Por que a correção mínima é segura**: só a entidade do monitor sai da tela; nenhuma outra entidade, nenhuma linha
apagada; quem lê o monitor é a porta dele, que filtra pela própria entidade. Os registros de segurança e de negócio
continuam sob a política `audit_select` (Administrador, Diretoria, Financeiro, Contabilidade e Auditoria).

**Retenção**: nada é apagado hoje, e a auditoria é imutável por desenho (sem política de UPDATE/DELETE). O monitor
soma ~28 MB por ano à `audit_log`. Plano: reavaliar em 12 meses ou quando a tabela passar de 1 GB; se for preciso
expurgar, o caminho é a tabela própria (`formulario_monitor_round` e `formulario_monitor_alert`, com
`unique (organization_id, chave)` e expurgo por idade), por migration com autorização própria — nunca apagar linhas
da `audit_log`. A consulta do observador lê no máximo 26 h e usa índice.

## 4. Frequência de 10 minutos

Implementado: `formulario-reconciliar.mts` e `formulario-observador.mts` com `schedule: '*/10 * * * *'`; o padrão do
monitor (`INTERVALO_PADRAO_MIN = 10`) é preso ao `schedule` por teste.

| Item | 60 min (antes) | 10 min (agora) |
|---|---|---|
| Rodadas por dia / por mês | 24 / 720 | 144 / 4.320 |
| Chamadas à API do Netlify por rodada (14 submissões, 2 formulários) | 3 | 3 (11 com 1.000 submissões) |
| Consultas ao banco por rodada («já dentro») | 3 por bloco de 50 elegíveis | idem |
| Vazão máxima de recuperação | 20 por hora | 120 por hora |
| Atraso da recuperação de uma submissão perdida | até 60 min **mais** os atrasos | até 10 min **mais** os atrasos |

**Não é garantia de 10 minutos.** O agendador do Netlify pode atrasar uma execução; a rede e a API do Netlify podem
falhar (a rodada registra a falha e a seguinte tenta); com mais de 20 submissões pendentes, o lote espalha a
recuperação por várias rodadas.

- **Limites da plataforma**: função agendada tem 30 s de execução; a rodada para em 22 s (`LIMITE_MS − RESERVA_MS`)
  e devolve `restam`.
- **Sobreposição**: 30 s ≪ 10 min, então o agendador não sobrepõe rodadas. A sobreposição só ocorre com execução
  manual («Run now») junto da agendada: o banco fica certo (B5) e, desde a E10.19, a rodada que perde fica `CONCORRENTE`, sem falso aviso (B7).
- **Indisponibilidade**: Netlify fora → `erro_de_leitura` (alerta na 2ª seguida); CRM fora → falhas de gravação
  (aviso, depois crítico); a função agendada que nem roda → `RODADA_AUSENTE`, pelo observador.
- **Custo**: o site do CRM está numa conta Pro (crédito, 3.000 créditos por mês). O Netlify cobra funções agendadas
  por GB-hora (10 créditos por GB-hora desde abril de 2026; memória padrão 1 GB). Estimativa: rodada de 1 a 5 s ×
  4.320 = 1,2 a 6 GB-hora (12 a 60 créditos) e observador de ~1 a 2 s × 4.320 (12 a 24 créditos): **menos de 3% do
  plano por mês**. É estimativa; conferir no painel de uso depois da ativação.

## 5. Prova controlada de recuperação

Feita em ambiente isolado (parte B, dados fictícios). Para produção, procedimento **preparado, não executado**, para
autorização própria (decisão D4):

1. Pré-condições: reconciliação ligada (GO-3) com a lista de exclusão verificada (§1.3.1, H11); monitor ligado;
   fotografia do banco (contagem de evidências, mensagens e conversas da fonte WEBSITE).
2. Uma submissão **de ensaio** pelo **deploy preview** do eiff-site (onde a função do site não encaminha: provado
   no E10.4). É exatamente uma submissão legítima não entregue pelo evento. Texto «ENSAIO INTERNO E10.x», dados
   fictícios, autorização própria para o envio.
3. **Não** pôr o id dela na lista de exclusão. Esperar a próxima rodada (até ~10 min, mais atrasos).
4. Aceite: `RECONCILIACAO_AGENDADA` com `recuperadas = 1`; alerta `RECUPERACAO` entregue uma vez; no banco, para o
   id: 1 evidência, 1 mensagem, 1 conversa, prazo contado da submissão original. Rodada seguinte: `jaDentro`
   inclui o id, `recuperadas = 0`, nenhuma linha nova.
5. Encerramento: fechar a conversa e rejeitar o candidato com motivo de ensaio (como no E10.9); acrescentar o id à
   tabela de ensaios da §1.3.1 e a `EIFF_FORM_EXCLUIDOS`.

## 6. Contrato para a Central Comercial (somente leitura)

`estadoOperacional(rodadas, entregues, agora)` em `formularioMonitorCentral.ts`, versão `formulario-reconciliacao/v1`:

| Campo | Significado |
|---|---|
| `situacao` | `sem_registro` · `desligada` · `ok` · `com_falha` · `ausente` |
| `ultimaExecucao`, `ultimoDesfecho` | instante e desfecho da última rodada registrada |
| `codigoUltimaFalha` | código de catálogo, se a última rodada falhou na leitura ou configuração |
| `examinadas` | submissões lidas pela última rodada concluída |
| `recuperadas`, `falhasGravacao`, `rodadasComFalha` | somas da janela (`janelaHoras`, padrão 24) |
| `ultimoAlertaEm` | instante do último alerta entregue |
| `intervaloMin`, `geradoEm`, `versao` | contexto |

Sem nome, e-mail, telefone, id de submissão ou id de lead: QUAIS leads foram recuperados a Central lê do Inbox e do
Lead Engine, que são as autoridades. Nenhuma integração com a Central foi feita.

## 7. Pendências para ligar

1. Credencial de leitura do Netlify (D1): usuário técnico restrito ao eiff-site, com alcance conferido antes.
2. Canal real de alerta (D3): URL de webhook de um receptor escolhido pela Direção, criado por pessoa.
3. Lista de exclusão (§1.3.1) e simulação H11.
4. Variáveis: `FORMULARIO_MONITOR=ativo` (e, se escolhido, as do webhook), depois as da reconciliação.
5. Prova controlada de recuperação em produção (§5), com autorização própria.

## 8. Concorrência entre rodadas: classificador ligado à rodada (E10.18 e E10.19)

Causa (prova B7): duas rodadas sobre a mesma submissão — o agendador e um «Run now» manual — leem o estado antes de
qualquer uma gravar; a segunda a gravar a evidência recebe a violação do índice `radar_source_record_observacao_uidx`
(PostgREST: HTTP 409), `gravarSubmissao` lança `ErroDeGravacao('evidencia', 'ERRO_HTTP 409 …')` e a rodada conta uma
falha. O banco ficava exato; o efeito era um falso aviso `FALHA_GRAVACAO` (corrigido abaixo).

`src/core/radar/formularioConcorrencia.ts` decide, depois da falha, o que aconteceu. O 409 na evidência só ABRE a
verificação; quem decide é o estado lido do banco:

| Desfecho | Condição |
|---|---|
| `CONCLUIDA_POR_OUTRA_RODADA` | 409 na evidência + exatamente uma evidência desta fonte com o mesmo id externo e a mesma impressão + conversa da mesma submissão + prazo correto (`decidirPrazo` = manter) |
| `PARCIAL` | 409 na evidência + a evidência da mesma impressão existe, mas a conversa ou o prazo ainda não (a outra rodada pode estar no meio; a rodada seguinte completa) |
| `INCONSISTENCIA_IDENTIDADE` | 409 na evidência, mas nenhuma evidência desta submissão com esta impressão, ou mais de uma |
| `ERRO_PERSISTENCIA` | qualquer outra falha: rede, 5xx, permissão, conversa, prazo — mesmo que o banco pareça completo |

Provas: 8 testes unitários (`formularioConcorrencia.test.ts`) e B8–B10 no PGlite. `INCONSISTENCIA_IDENTIDADE` só é
provada em teste unitário (o índice único não deixa produzi-la num banco correto).

**Ligado na E10.19** (a Direção pediu a correção), no tratamento de falha da rodada em `formularioAgendado.ts`.
`gravarSubmissao` — o motor de gravação, também usado pelo evento do site — **não mudou**. Quando a falha é o 409 da
evidência, a rodada lê `registrosDaSubmissao`, `conversaExiste` e `prazoDaConversa` e classifica; se der `PARCIAL`,
espera 1,5 s uma única vez (só se couber no orçamento de 22 s) e relê, porque a rodada vencedora costuma estar
gravando a conversa naquele instante:

- `CONCLUIDA_POR_OUTRA_RODADA` → `resultados.CONCORRENTE += 1`; **não** conta em `falhas`; log `RECONCILIACAO_CONCORRENTE`;
- `PARCIAL` (mesmo depois da releitura) → `resultados.PARCIAL += 1` e conta em `falhas` — a submissão não está inteira;
- `INCONSISTENCIA_IDENTIDADE` → `resultados.INCONSISTENCIA_IDENTIDADE += 1` e conta em `falhas`;
- qualquer outra falha (`ERRO_PERSISTENCIA`) → exatamente como antes.

Provas: B7 (banco real, duas rodadas simultâneas: perdedora `CONCORRENTE`, 0 falhas, sem `FALHA_GRAVACAO`) e os
testes «concorrência entre rodadas» em `formularioMonitor.test.ts` (corrida limpa, vencedora interrompida → `PARCIAL`,
falha de rede sem verificação).

O monitor também deixou de olhar só a última rodada para `RECUPERACAO`: toda rodada recente (janela de 6 h) que
recuperou gera seu aviso, com chave própria — duas rodadas que terminam juntas não escondem a recuperação.

## 9. O que é prova de adaptador e o que pede homologação real

| Prova | Banco | Transporte | Pede homologação em Supabase real |
|---|---|---|---|
| `formularioMonitor.test.ts`, `formularioConcorrencia.test.ts` | memória | `fetch` simulado | não (regras puras) |
| `auditoria.consulta.test.ts` | — | **supabase-js real**, `fetch` capturado | a URL é a real; a execução está no smoke (A11) |
| `smoke:monitor` parte A | **PostgreSQL real** (PGlite) com `audit_log`, RLS e GRANT das migrations | tradutor PostgREST → SQL (subconjunto) | sim: confirmar 201 com `return=representation` e id, o filtro `neq` e os GRANT reais da `service_role` |
| `smoke:monitor` parte B | **PostgreSQL real** com 0055–0057 | SQL direto (a porta de teste traduz 23505 em 409) | sim: confirmar que o PostgREST devolve 409 na violação do índice único |
| webhook | — | `fetch` simulado; assinatura conferida com `node:crypto` | sim: o receptor real (D3) confere a assinatura |
| `smoke:formulario` | PostgreSQL real | SQL direto | já homologado no GO-2 |
