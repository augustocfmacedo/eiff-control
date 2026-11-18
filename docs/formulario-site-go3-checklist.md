# GO-3 — Checklist executivo de implantação

Para a Direção. Estado em 16/11/2026: PR #92 aberto (Quality Gate aprovado), **sem merge, nada publicado, nada
ativado**. Detalhe técnico em `formulario-site-go3-monitor.md`; passo a passo em `formulario-site-go3-runbook.md`.

## 1. O que o GO-3 faz, em uma frase

A cada 10 minutos o CRM confere o Netlify Forms; se o site não entregou um lead, o CRM o grava uma única vez, com a
data original, e avisa a equipe — sem nenhum dado pessoal no aviso.

## 2. O que já está comprovado e o que ainda depende de produção

| Comprovado em ambiente isolado (PostgreSQL descartável, HTTP local, dados fictícios) | Depende de homologação em produção |
|---|---|
| Recuperação exatamente uma vez, com o id e a data originais (ensaio D4 completo: provas C1–C7) | O 409 real do Supabase na gravação duplicada |
| Duas rodadas ao mesmo tempo: sem duplicar e sem alerta falso (B5, B7, B8) | As linhas reais na `audit_log` e as permissões reais da chave de serviço |
| Retenção de ensaios e de anteriores ao marco (B2, H11 simulado com os dados reais em 16/11) | A credencial de leitura do Netlify e o papel mínimo (D1) |
| Sete situações de alerta, cada uma entregue uma vez (A4–A9, testes) | O receptor real e o canal da equipe (D3) |
| Webhook assinado: recebido, conferido, deduplicado, reenviado quando o destino cai (9 testes por HTTP real) | O agendador do Netlify a cada 10 min (horário real, atrasos) |
| Tela de Auditoria não tomada pelo monitor (A10, A11) | A prova controlada em produção (D4) |
| Nenhum dado pessoal em alerta, log ou registro (A-PII, barreira dupla) | O consumo real de créditos |

## 3. Dependências e decisões da Direção

| # | Decisão | Recomendação | Situação |
|---|---|---|---|
| D1 | Credencial de leitura do Netlify | conta técnica dedicada, só no projeto eiff-site, papel testado do menor para o maior (Reviewer → Internal Builder → Developer), token de 90 dias | **pendente**: a documentação do Netlify não diz que papel lê submissões; precisa de teste autorizado (`scripts/netlify-alcance-token.mts`, só leitura) |
| D1-b | Se só Developer ler | (a) reconciliação manual sem token guardado, (b) Developer com mitigação e aceite expresso, ou (c) adiar | decisão da Direção depois do teste |
| D2 | Frequência | 10 minutos (implementado) | aprovada no código; sem prazo garantido |
| D3 | Destino dos alertas | **receptor próprio fora do Netlify do CRM** (o de referência em `formularioAlertaReceptor.ts`) que confere a assinatura e encaminha a um **espaço do Google Chat da operação** e, para crítico, a um e-mail de monitoramento | **pendente**: escolher onde hospedar o receptor e quem acompanha |
| D4 | Prova em produção | ensaio pelo deploy preview do site, encerramento administrativo | **pendente**: autorização própria (impacto: uma conversa em «Concluídos» e uma resposta fora do prazo nas métricas) |
| — | Fim do congelamento do eiff-control | aviso da sessão de e-mail comercial | **pendente** |

Por que não mandar o alerta direto para o Google Chat: o webhook de entrada do Chat não confere assinatura nem
deduplica — a credencial é só a URL secreta. O receptor de referência faz as três coisas (assinatura, deduplicação,
reenvio) e mantém o caminho do alerta **independente** do Netlify que ele vigia. Hospedagens possíveis: um site
Netlify separado (outra conta, sem nenhuma outra função), um worker, ou um serviço já usado pela EIFF. Google Apps
Script **não serve** como receptor direto: não expõe os cabeçalhos da requisição (a assinatura viaja no cabeçalho).

## 4. Credenciais e variáveis (nenhuma criada; sem valores aqui)

| O quê | Onde | Quem cria | Segredo |
|---|---|---|---|
| Token da conta técnica (D1) | `NETLIFY_AUTH_TOKEN` no CRM | Direção | sim |
| Segredo da assinatura (D3), ≥ 32 caracteres | `FORMULARIO_ALERTA_WEBHOOK_SEGREDO` no CRM **e** no receptor | Direção | sim |
| URL do receptor (D3) | `FORMULARIO_ALERTA_WEBHOOK_URL` e `FORMULARIO_ALERTA_CANAL=webhook` | Direção | a URL não é segredo; o segredo é a assinatura |
| URL do webhook do Google Chat | só no receptor | Direção | sim (é a credencial do Chat) |
| Interruptores | `FORMULARIO_MONITOR=ativo`, depois `FORMULARIO_RECONCILIACAO=ativa` | Direção | não |
| Configuração | `EIFF_FORM_MARCO`, `EIFF_FORM_NETLIFY_SITE`, `EIFF_FORM_EXCLUIDOS` | Direção | não |

Todas só em **Production**, escopo **Functions**, no site do CRM. Nada depende de `GOOGLE_OAUTH_*`.

## 5. Responsáveis

| Papel | Quem | O quê |
|---|---|---|
| Decisão e credenciais | Direção (Augusto) | D1–D4, variáveis, token, segredo |
| Atendimento dos leads recuperados | Comercial (Augusto, responsável padrão do setor) | contato real e registro no Inbox |
| Acompanhamento dos alertas | quem acompanha o espaço da operação no expediente | ler, agir pela «ação» de cada alerta |
| Execução técnica | Frente A, com autorização de cada passo | merge, publicação, conferências |

## 6. Ordem de ativação e critérios de aceite

| Fase | O quê | Aceite |
|---|---|---|
| 0 | Fim do congelamento → merge do #92 → deploy publicado e travado | rodada e observador agendados, registrando «desligada» |
| A | Receptor (D3) no ar; monitor e canal ligados | o receptor recebe **um** «Reconciliação desligada» assinado; a tela de Auditoria não mostra o monitor |
| B | Teste de alcance (D1) → token, site, marco, lista de exclusão | simulação: 3 ensaios e 11 anteriores retidos; nenhum ensaio entre os «a reenviar» |
| C | Ligar a reconciliação, com a Direção acompanhando a 1ª rodada | rodada concluída, tudo «já dentro», zero processadas, zero falhas, banco idêntico |
| D | Prova controlada (D4), com autorização própria | uma recuperação, um alerta, nenhuma duplicata, ensaio encerrado |
| E | 15 dias | §9 |

## 7. Reversão

Desligar = **republicar o deploy anterior da fase** e travar (a variável apagada só vale num deploy novo). Uma rodada
em andamento termina (até 30 s). **Só conta como desligado depois da prova**: o log da rodada seguinte mostra
«desligada» e nenhuma rodada nova é gravada. O que já entrou no CRM fica e é atendido; nada é apagado.

## 8. Em caso de falha

| Sinal | O que fazer |
|---|---|
| «Falha de leitura» (crítico) | conferir validade do token e status do Netlify; se o token expirou, gerar outro (D1) e publicar |
| «Falha de gravação» (aviso, depois crítico) | ver o log `RECONCILIACAO_FALHA` e conferir no Netlify Forms se o lead chegou por outro caminho |
| «Reconciliação parada» (crítico) | conferir no Netlify se a função agendada está publicada; enquanto isso, conferência manual |
| «Lead recuperado» (aviso) | atender o lead no Inbox; a função do site falhou: investigar |
| Qualquer dado pessoal em log ou alerta, ensaio ou histórica reprocessados | **desligar imediatamente** (§7) e investigar |

## 9. Primeiros 15 dias

- Diário: ler os alertas e um resumo de rodada por dia (lidas, já dentro, recuperadas, falhas).
- Semanal: conferir Netlify Forms × Inbox (contagem), créditos consumidos, tamanho da `audit_log`.
- Ao fim: parecer do GO-3 (nenhuma falha sem explicação; toda recuperação investigada; nenhum alerta falso recorrente).

## 10. Impactos

| Onde | Impacto |
|---|---|
| CRM | 2 funções agendadas novas; ~144 linhas por dia na `audit_log` (≈ 28 MB/ano), fora da tela de Auditoria; lead recuperado entra com o prazo da data original (pode já estar vencido) e conta como resposta fora do prazo |
| Site | nenhum: o formulário, a página e a função do site não mudam |
| Custo | < 3% dos créditos do plano Pro por mês (estimativa) |
| Central Comercial | contrato pronto (`estadoOperacionalDasLinhas` + `saudeExibivel`); integração não feita |

## 11. Riscos residuais

O papel mínimo que lê submissões pode ser Developer · token expira (alerta crítico na 1ª rodada) · canal não
acompanhado · receptor é mais um serviço a manter · prova de banco usa PGlite e um tradutor PostgREST · nenhum
prazo de recuperação é garantido (capacidade: 120 por hora; compromisso: detectar e avisar).
