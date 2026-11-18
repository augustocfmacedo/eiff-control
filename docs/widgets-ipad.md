# Widgets do iPad — caixa da EIFF na tela de início

Pedido do Augusto em 14/10/2026: ver o fluxo de caixa no iPad sem abrir o sistema. Decisões: app **Scriptable**
(gratuito, sem Mac), **token por aparelho** (migration 0069; a E3 do Diretor Comercial passa a ser 0070) e quatro formatos:
pequeno, médio, grande (e extra grande no iPad) e tela de bloqueio.

## O que aparece

Os mesmos números da tela **Caixa** e do Diretor Financeiro — nada é recalculado (`src/core/widgetCaixa.ts` lê
`livroCaixa`, `saudeCaixa` e `defasagemExtrato`):

| Formato | Conteúdo |
|---|---|
| Pequeno | caixa hoje, caixa mínimo, semáforo da saúde do caixa, pagamentos vencidos (ou menor saldo), hora da atualização |
| Médio | curva do saldo em degrau dos próximos 30 dias com a linha tracejada do mínimo; hoje, menor saldo (com a data) e saldo em 30 dias |
| Grande / extra grande | o médio + próximos 7 dias (vencidos primeiro, até 6/8 linhas, entra e sai da semana) + até 3 alertas |
| Tela de bloqueio | retangular (caixa, menor saldo, vencido ou mínimo), em linha e circular |

"Semana" é o que **ainda** entra e sai (os pagos de hoje já estão no caixa de hoje). Recebimento vencido aparece marcado,
fora do saldo, como na Caixa. Rascunho e em aprovação não aparecem. Tocar no widget abre `#/caixa`.

## Widget dos pagamentos do dia (script próprio EIFF Pagamentos)

Pedido do Augusto em 14/10/2026: uma lista bonita, na tela de início do iPad, com os pagamentos do dia, a situação de cada
um e o somatório, atualizando de 15 em 15 minutos. Script próprio (`scriptWidgetPagamentos` em
`src/core/widgetScriptablePagamentos.ts`, botão "Copiar script dos pagamentos"), mesma porta e mesmo token
(`GET /api/widget-caixa?visao=pagamentos`, exige ver o caixa), sem migration. `resumoWidgetPagamentos`
(`src/core/widgetPagamentos.ts`) é leitura do `livroCaixa`, a mesma lista da tela Caixa, só as saídas:

| Situação | O que entra |
|---|---|
| Atrasado | pagamento vencido e não pago (conta no caixa de hoje), com os dias de atraso |
| A pagar | previsto com vencimento hoje |
| Aprovação | aguardando alçada com vencimento até hoje — fica fora do total, como fica fora do saldo |
| Pago | pago hoje (inclusive parcial) |

Rascunho (pedido ao Diretor ainda não decidido), faturamento direto ao cliente e entradas não aparecem. Total = pago + a
pagar + atrasado; "falta pagar" = a pagar + atrasado; "caixa depois de pagar" = caixa de hoje − o que falta, com o aviso
quando fica abaixo do caixa mínimo. A lista põe o que exige ação primeiro (atrasado, a pagar, aprovação, pagos), o maior
valor antes em cada grupo.

| Formato | Conteúdo |
|---|---|
| Pequeno | quanto falta pagar hoje, barra pago/a pagar/atrasado, "x de y pagos" e atrasados |
| Médio | total, falta pagar, barra, legenda e os 2 primeiros |
| Grande / extra grande | o médio + até 7/8 linhas com etiqueta de situação, para quem e departamento, e o caixa depois de pagar |
| Tela de bloqueio | "Pagar hoje R$ 6.500 · pago R$ 12 mil", o anel da fração paga ou o retangular com o que falta |

**Atualização**: o script pede ao iOS uma nova execução a cada 15 minutos (`refreshAfterDate`, constante
`MINUTOS_ATUALIZACAO_WIDGET`). O iOS pode atrasar (economia de bateria, orçamento de atualizações), nunca adiantar. Tocar
abre `#/caixa`.

## Widget de pedidos da equipe (script próprio EIFF Pedidos)

A pedido do Augusto (14/10/2026) o widget de pedidos ganhou **script próprio**, sem nada do caixa
(`scriptWidgetPedidos` em `src/core/widgetScriptablePedidos.ts`, botão "Copiar script dos pedidos"). Usa a mesma chave do
Keychain do script do caixa, então o token já guardado vale para os dois. O Parameter `pedidos` no script do caixa continua
funcionando (compatibilidade), mas o caminho recomendado é o script separado.


Pedido do Augusto em 14/10/2026: ver na tela de início o que a equipe está pedindo ao Diretor Financeiro. Mesmo script,
mesmo token, mesma porta (`GET /api/widget-caixa?visao=pedidos`), sem migration. `resumoWidgetPedidos`
(`src/core/widgetPedidos.ts`) é leitura de `centralDF`: pedidos em rascunho de origem `diretor-financeiro` pelo vencimento,
quem pediu, há quantos dias, "novo" (pedido de hoje), a orientação do Diretor (programar / reagendar para a data em que cabe /
seu aval porque consome a reserva / não recomendado), a contagem por orientação, o total e os decididos dos últimos 3 dias.
O servidor exige, além de ver o caixa, a permissão de aprovar (a mesma da Central).

| Formato | Conteúdo |
|---|---|
| Pequeno | quantos aguardam, o total e o mais urgente com a orientação |
| Médio | total e contagem por orientação + os 2 mais urgentes |
| Grande / extra grande | até 6/8 pedidos + decididos recentes |
| Tela de bloqueio | "2 pedidos · R$ 200.180", o primeiro com a orientação, ou o número no círculo |

Tocar abre a Central do Diretor (`#/diretor`). **Aviso de pedido novo**: a cada atualização o script compara com os
pedidos que já viu neste iPad e agenda uma notificação local ("Novo pedido de Tiago: Vale combustível · R$ 180,00 para
14/10 · programar 14/10"), no máximo 3 e um resumo do restante; a primeira execução só memoriza; sem rede nunca avisa. O
horário é o da atualização do widget, que o iOS decide (minutos, não segundos) — não é push. Para ativar: copiar o script de
novo (Caixa › Widgets do iPad › Copiar script), colar por cima do **EIFF Caixa** no Scriptable (o token continua no
Keychain), adicionar outro widget do Scriptable com `pedidos` em Parameter e permitir notificações do Scriptable.

## Segurança

- **Token por aparelho, só leitura** (`widget_token`, migration 0069): nasce no banco (gerador criptográfico), aparece
  uma vez na tela e o banco guarda só o SHA-256 e os 4 últimos caracteres. Escopo fixo `caixa_resumo`.
- **Quem pode**: só o Administrador ativo (o mesmo papel de `ver_bancos` na MATRIZ). Se o papel mudar ou o perfil for
  desativado, o token para de valer na hora. Validade de 1 a 365 dias; até 10 aparelhos ativos por pessoa.
- **Validação só no servidor**: `/api/widget-caixa` (`src/core/widgetServidor.ts`) chama `widget_token_validar`
  (EXECUTE só para `service_role`), confere de novo a MATRIZ no app, carrega o caixa com a chave de serviço e devolve
  apenas o resumo — sem conta bancária, sem lançamento completo, sem cadastro. Só GET; o token nunca vai para log.
- **No iPad**: o script não contém o token. Na primeira execução no Scriptable ele lê o token da área de transferência
  (ou pede para colar), guarda no **Keychain** do iPad e limpa a área de transferência. Token recusado (revogado,
  vencido) apaga o resumo guardado: o widget nunca mostra dado antigo de um acesso cortado. Sem rede, mostra o último
  resumo marcado "sem conexão".
- **Revogar**: Caixa › Widgets do iPad › Revogar (com motivo). Criar e revogar ficam no `audit_log` (fonte `rpc`).
- O cliente (`authenticated`) lê só os próprios aparelhos e nunca a coluna `token_hash`; insert/update/delete diretos são
  negados; os gatilhos impedem apagar, mudar o hash, estender a validade ou desfazer a revogação.

## Como instalar (no iPad)

1. Instale o **Scriptable** (App Store).
2. No Safari do iPad, entre no EIFF Control › **Caixa** › **Widgets do iPad**, dê um nome ao aparelho e toque em
   **Gerar token**.
3. Toque em **Copiar script**; no Scriptable toque em **+**, cole e dê o nome **EIFF Caixa**.
4. Volte ao Safari, toque em **Copiar token**; no Scriptable toque no script **EIFF Caixa** e confirme "Usar o token
   copiado". Pelo mesmo script dá para ver a prévia de cada tamanho, trocar ou remover o token.
5. Tela de início: toque e segure → **Editar** → **Adicionar widget** → **Scriptable** → escolha o tamanho → toque no
   widget → Script **EIFF Caixa**. Tela de bloqueio: o mesmo pelo editor da tela de bloqueio.

O iOS decide quando atualizar o widget (em geral a cada 15–30 minutos). Cada atualização carrega o caixa inteiro no
servidor, como o Diretor Financeiro faz para o veredito.

## Estado

Em produção desde 14/10/2026: PR #55 (main a4ace64) e correção do Node 20 no PR #56 (main 68b9b37, deploy 6acefe47), 0069
aplicada às 03:38 UTC. Funcionando no iPad do Augusto (widget extra grande do caixa). As funções Netlify criam o cliente do
Supabase por `src/data/clienteServidor.ts`: no Node 20 o supabase-js recusa o createClient puro (sem WebSocket nativo).

## Implantação (cada passo com autorização própria)

1. `MERGE AUTORIZADO` do PR.
2. `PRODUCTION AUTORIZADA`: publicar o código. Sem a 0069, a tela mostra "Widgets ainda não estão disponíveis neste banco"
   e `/api/widget-caixa` recusa todo token.
3. Conferir que `SUPABASE_SERVICE_ROLE_KEY` existe no painel do Netlify (já usada por Usuários e pelo veredito do Diretor);
   sem ela a função responde 501.
4. Aplicar a 0069 numa transação (`npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f
   supabase/migrations/0069_widget_token.sql`), conferir os objetos e testar com um token real criado pelo Augusto.

Rollback: `supabase/rollbacks/0069_widget_token.rollback.sql` (apaga os tokens; todos os widgets param). Tirar o código
antes do banco.

## Provas

- `npm run smoke:widget-token` (`scripts/pg-smoke-widget-token.mjs`, PGlite, também no Quality Gate): 64 provas.
- `src/core/widgetCaixa.test.ts`: o resumo reproduz a planilha do caixa de 13/10 (41.988,93; menor 23.768,93 em 15/10).
- `src/core/widgetServidor.test.ts`: ordem das barreiras e cada recusa.
- `src/core/widgetScriptable.test.ts`: o script roda num Scriptable simulado em todos os tamanhos, sem token, com token
  recusado e sem rede. **Não substitui** o teste no iPad de verdade, que fica para depois da 0069.
