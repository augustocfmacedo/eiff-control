# GO-3 — Runbook de ativação e reversão da reconciliação Site → CRM

Estado em 16/11/2026: código pronto na branch `feature/formulario-monitor-go3` (não mesclado, não publicado).
Reconciliação e monitor **desligados**. Nada abaixo foi executado. Cada fase pede autorização própria da Direção,
e nenhuma acontece durante o congelamento do eiff-control.

Referências: checklist executivo em `formulario-site-go3-checklist.md`; arquitetura e provas em `formulario-site-go3-monitor.md`; exclusão dos ensaios em
`formulario-site-go2-go3.md` §1.3.1; histórico da ativação do formulário em `formulario-site-ativacao.md`.

## 1. Arquitetura final

```
eiff.com.br (formulário)
  ├─ evento submission-created ─► /api/formulario-site ─► Lead Engine (evidência PENDING) + Inbox (conversa, prazo 30 min úteis)
  └─ Netlify Forms (guarda toda submissão)
         ▲
         │ leitura (NETLIFY_AUTH_TOKEN, usuário técnico)
formulario-reconciliar  (a cada 10 min)
  plano: marco · exclusão por id · já dentro (evidência da mesma impressão + conversa + prazo) · lote de 20
  grava pelo MESMO caminho do evento (gravarSubmissao); conflito de unicidade → classificador (outra rodada? parcial? erro?)
  └─ registra o resumo na audit_log  (FORMULARIO_MONITOR=ativo)
formulario-observador   (a cada 10 min, independente)
  lê as rodadas · avalia 7 situações · deduplica (reivindicação → entrega) · canal: registro (+ webhook assinado)
```

## 2. Fluxo de recuperação de uma submissão

1. A submissão chega ao Netlify Forms. O evento do site deveria entregá-la ao CRM; se falhou, ela fica só no Netlify.
2. A rodada lê as submissões dos formulários `simular-galpao` e `iniciar-projeto`.
3. Retidas, nesta ordem: id na `EIFF_FORM_EXCLUIDOS` (`id_excluido`) → anterior ao marco (`anterior_ao_marco`) →
   intake inválido. A rodada agendada **não tem como** liberar anteriores ao marco.
4. «Já dentro» (evidência da mesma impressão + conversa + prazo correto) sai da fila sem gravar nada.
5. O resto, das mais antigas para as mais novas, no máximo 20 por rodada e até 22 s: `gravarSubmissao` grava a
   evidência (PENDING, sem entidade) e a conversa com o id ORIGINAL do Netlify; o prazo de primeira resposta conta
   da data ORIGINAL da submissão (pode já nascer vencido — é o retrato verdadeiro).
6. Repetição exata → `IDEMPOTENTE`; conteúdo diferente → `NOVA_OBSERVACAO` ao lado; falha no meio → a rodada
   seguinte completa. Duas rodadas juntas → a perdedora confirma pelo banco que a outra concluiu (`CONCORRENTE`).
7. O que entrou pela rodada conta em `recuperadas`; o monitor avisa `RECUPERACAO` (a função do site falhou).

## 3. Variáveis (painel do **eiffcontrol**, Production, escopo Functions)

| Variável | Valor | Quem cria | Fase |
|---|---|---|---|
| `EIFF_FORM_EXCLUIDOS` | `6af72bc662ddce941fc27637,6af761a6cbe0316d6d3211b9,6af379040c7080bc34020601` + os 8 não comerciais anteriores ao marco, se a Direção quiser trava dupla | Direção | B |
| `EIFF_FORM_MARCO` | `2026-11-10T01:21:02Z` | Direção | B |
| `EIFF_FORM_NETLIFY_SITE` | site_id do eiff-site (`fdb653b1-0ffc-4f64-92f9-2624328d2e45`) | Direção | B |
| `NETLIFY_AUTH_TOKEN` | token do usuário técnico (D1), marcado como segredo | Direção | B |
| `FORMULARIO_MONITOR` | `ativo` | Direção | A |
| `FORMULARIO_INTERVALO_MIN` | `10` (opcional; é o padrão) | — | A |
| `FORMULARIO_ALERTA_CANAL` | `webhook` (D3) | Direção | A |
| `FORMULARIO_ALERTA_WEBHOOK_URL` | URL https do receptor (D3) | Direção | A |
| `FORMULARIO_ALERTA_WEBHOOK_SEGREDO` | segredo ≥ 32 caracteres, gerado por pessoa, marcado como segredo | Direção | A |
| `FORMULARIO_RECONCILIACAO` | `ativa` — **a última de todas** | Direção | C |

Já existem e são reutilizadas: `SUPABASE_SERVICE_ROLE_KEY`, `EIFF_INBOX_ORGANIZATION_ID`, `EIFF_FORM_SOURCE_ID`.
Nenhuma depende de `GOOGLE_OAUTH_*`. Variável nova só vale num deploy novo (§3.1 do runbook de ativação).

## 4. Dependências

### D1 — Credencial de leitura do Netlify (menor privilégio)

O token pessoal do Netlify **não tem escopo**: age com o papel do usuário que o criou. Então o menor privilégio é o
**usuário**, não o token.

1. Criar um usuário técnico dedicado (e-mail operacional, MFA), convidado ao time só com acesso ao projeto
   **eiff-site** (o Owner restringe por projeto em Team settings › Members › Edit member).
2. Papel, do menor para o maior, parando no primeiro que **lê submissões**:
   - **Reviewer**: não publica, não edita configuração. A documentação não diz se lê submissões pela API — testar.
   - **Internal Builder**: não publica em produção nem altera variáveis.
   - **Developer**: dispara builds e edita configuração — evitar; só com aceitação expressa.
3. Token desse usuário com **expiração** (90 dias recomendados) e data de rotação anotada.
4. Teste de alcance, antes de criar a variável, só leitura (`scripts/netlify-alcance-token.mts`, token só no ambiente da sessão): `GET /api/v1/sites/{eiff-site}/forms` e
   `GET /api/v1/forms/{id}/submissions?per_page=1` respondem 200; `GET /api/v1/sites` lista **só** o eiff-site.
   O token nunca é colado em conversa, log ou repositório.
5. Token pessoal administrativo (do Augusto): **não usar**.
6. **A capacidade do Reviewer não está provada.** A documentação do Netlify não diz que papel lê submissões pela
   API; só um teste autorizado, com a conta técnica restrita ao projeto, prova. Se só **Developer** servir (ele
   dispara builds e edita a configuração do projeto, inclusive variáveis), o token **não** é instalado sem decisão da
   Direção entre:
   - **(a) operação provisória sem token guardado**: a reconciliação roda pelo script manual, por pessoa logada,
     com a frequência que a Direção definir; o monitor só observa o que for registrado; nenhuma credencial no painel;
   - **(b) Developer aceito com mitigação**: conta técnica só no projeto eiff-site, token de 30 dias, revisão do log
     de atividade do time a cada rotação, e aceite expresso do risco de escrita;
   - **(c) adiar o GO-3** e manter a operação provisória atual (e-mail + conferência diária).

### D2 — Frequência (10 minutos)

- `schedule: '*/10 * * * *'` (UTC) na rodada e no observador; o site do CRM está em conta **Pro** (créditos).
- **Atraso**: o agendador não garante o minuto exato; uma execução perdida **não é reposta** — a próxima pega tudo
  (a leitura é sempre do conjunto inteiro). Isso é coberto: a ausência acima de 25 min vira alerta.
- **Sobreposição**: execução limitada a 30 s pela plataforma e a 22 s pela própria rodada ≪ 10 min. Só um «Run now»
  manual sobrepõe, e aí o classificador garante exatamente uma vez sem falso alerta (provas B5, B7, B8).
- **Lote**: 20 submissões e 22 s por rodada; acima disso, `restam` e a próxima continua (mais antigas primeiro).
- **Indisponibilidade**: Netlify fora → `erro_de_leitura` (alerta na 2ª seguida; credencial, na 1ª); CRM fora →
  falhas de gravação (aviso, depois crítico); nada é perdido — as submissões ficam no Netlify.
- **Acúmulo**: 20 por rodada × 6 rodadas por hora = **120 por hora de capacidade teórica**.
- **Prazo garantido: nenhum.** A capacidade teórica de recuperação é de até ~10 minutos, mas o atraso do agendador,
  a rede e o lote podem estender; o compromisso é «detectado e avisado», não «recuperado em 10 minutos».
- **Custo**: ~12 a 84 créditos por mês somando rodada e observador (< 3% dos 3.000 do Pro); conferir no painel.

### D3 — Canal de alerta

Recomendação: um canal **acompanhado no expediente** pela mesma pessoa que atende os leads.

| Opção | Como | Observação |
|---|---|---|
| **Chat da equipe (Google Chat, Slack)** — recomendado | webhook de entrada do espaço, atrás de um receptor que confere a assinatura | aviso imediato no celular |
| Automação (Make, n8n, Zapier) | recebe o webhook, confere a assinatura, manda e-mail para augusto@eiff.com.br | permite e-mail sem credencial nova no CRM |
| Só o registro | linha `RECONCILIACAO_ALERTA` no log do Netlify | ninguém é avisado: só serve para diagnóstico |

Formato do webhook (`v1`): POST JSON `{ tipo, severidade, titulo, texto, acao, desde, em, contagens, codigo?, chave,
origem, versao }`, sem nenhum dado pessoal. Autenticação: `x-eiff-timestamp` (segundos) e
`x-eiff-assinatura: v1=<hex>` = HMAC-SHA256(segredo, `<timestamp>.<corpo>`); o receptor recusa assinatura errada ou
timestamp a mais de 5 min. Deduplicação: `x-eiff-entrega` = chave do alerta. Tempo limite: 5 s.

Erros e reenvio: 2xx = entregue (gravado em `alerta_entregue`); qualquer outra resposta, rede ou tempo esgotado =
pendente, e a **passada seguinte (10 min) tenta de novo**, sem reenvio imediato; o mesmo problema contínuo é
lembrado a cada 6 h. Garantia: ao menos uma vez — o receptor deduplica pela chave.

Testes de canal antes de ligar a reconciliação: com o monitor ligado e a reconciliação desligada, a primeira rodada
registrada gera `DESLIGADA` (informativo) — é o teste de ponta a ponta do canal, sem lead nenhum.

### D4 — Prova controlada em produção

Procedimento em `formulario-site-go3-monitor.md` §5, resumido: submissão de ENSAIO pelo **deploy preview** do
eiff-site (o encaminhamento não roda lá — provado no E10.4), id fora da lista de exclusão, esperar uma rodada,
conferir `recuperadas = 1`, um alerta `RECUPERACAO`, exatamente uma evidência, uma mensagem e uma conversa com o id
ORIGINAL e o prazo da data original; rodada seguinte `jaDentro`. Encerrar: fechar a conversa e rejeitar o candidato
com motivo de ensaio, acrescentar o id à tabela de ensaios e a `EIFF_FORM_EXCLUIDOS`. Impacto declarado: uma
conversa a mais em «Concluídos» e uma primeira resposta fora do prazo nas métricas. **Autorização própria.**

## 5. Fases de ativação

| Fase | O que | Aceite | Reversão |
|---|---|---|---|
| 0 | Fim do congelamento; merge do PR da Frente A; deploy publicado e travado (sem variável nova); **anotar o id de cada deploy publicado, que é o alvo de reversão da fase seguinte** | rodada e observador agendados; log `RECONCILIACAO_AGENDADA desligada` e `RECONCILIACAO_OBSERVADOR desligado` a cada 10 min | republicar o deploy anterior |
| A | Monitor e canal: `FORMULARIO_MONITOR=ativo` + variáveis do webhook; novo deploy | na 1ª rodada, linha `rodada` (desligada) na `audit_log`; o **receptor externo** confirma o `DESLIGADA` uma vez (o registro local não prova entrega); a tela de Auditoria não mostra o monitor | republicar o deploy da Fase 0 (§5.1) |
| B | Credencial e configuração (D1): token, site, marco, lista de exclusão; novo deploy | simulação manual H11: 3 `id_excluido`, 11 anteriores, 0 a reenviar (+ as reais posteriores) | republicar o deploy da Fase A (§5.1); depois revogar o token |
| C | `FORMULARIO_RECONCILIACAO=ativa`; novo deploy, com a Direção acompanhando a 1ª rodada | `RECONCILIACAO_AGENDADA concluida`; retidas = 14; `jaDentro` = elegíveis; processadas = 0; falhas = 0; banco idêntico (H9) | republicar o deploy da Fase B (§5.1) e provar o desligamento; o que entrou fica e é atendido |
| D | Prova controlada (D4), com autorização própria | §4 D4 | encerramento administrativo do ensaio |
| E | 15 dias de acompanhamento (H10) | leitura diária dos resumos e alertas | — |

### 5.1 Desligamento e reversão — o que é instantâneo e o que não é

Regra do Netlify (`formulario-site-ativacao.md` §3.1): cada deploy usa as variáveis do momento em que foi construído.
Apagar ou mudar uma variável **não muda nada** no que está no ar; o agendamento das funções também pertence ao
deploy publicado.

| Caminho | Como | Quando vale | Observação |
|---|---|---|---|
| **1. Republicar o deploy anterior** (preferido) | «Publish deploy» do último deploy construído **sem** a variável da fase, e travar a publicação | a publicação é imediata; a próxima invocação agendada já usa o deploy republicado; uma rodada **em andamento** termina (até 30 s) | a documentação do Netlify **não descreve expressamente** as variáveis num deploy republicado: **provar** (abaixo) |
| 2. Remover a variável e publicar um deploy novo | apagar no painel → novo build → publicar → travar | só depois que o build termina e é publicado (minutos) | apagar sem novo deploy **não desliga nada** |

Prova obrigatória de que desligou (nunca presumir): na próxima janela de 10 min, a linha
`RECONCILIACAO_AGENDADA` com `desfecho: desligada` no log da função e **nenhuma** linha nova `rodada` concluída na
`audit_log`. Sem essa prova, a reconciliação é tratada como ligada. Para o monitor: linha
`RECONCILIACAO_OBSERVADOR` com `desligado`.

Efeito sobre as funções agendadas: republicar um deploy **anterior à Fase 0** tira também as funções agendadas novas
(observador) e a correção da tela de Auditoria; por isso o alvo da republicação é o deploy **imediatamente anterior
à fase** que se quer desfazer, anotado no início de cada fase. O que já entrou no CRM fica (nada é apagado) e é
atendido.

Condições de desligamento imediato (caminho 1): qualquer submissão histórica
ou ensaio reprocessado; qualquer dado pessoal em log ou alerta; falha não explicada em duas rodadas; recuperação
sem explicação.

