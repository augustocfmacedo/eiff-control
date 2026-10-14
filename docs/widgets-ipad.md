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
