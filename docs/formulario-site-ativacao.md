# Formulário do site → EIFF Control: ativação controlada

Roteiro de publicação, ensaio fictício e reversão. Complementa `docs/formulario-site.md` (o desenho da
integração) e não o substitui.

> Estado em 09/11/2026: **tudo preparado localmente, nada ativado**. Nenhum push, merge, deploy, credencial
> ou escrita em produção. Os leads antigos guardados no painel do Netlify continuam retidos.

## 1. O que é atendimento e o que é promoção

| | onde | quando | quem |
|---|---|---|---|
| **Atendimento imediato** | EIFF Inbox, `#/atendimento` | na hora em que a submissão entra | responsável padrão do COMERCIAL, com prazo de primeira resposta |
| **Evidência** | Lead Engine, aba Candidatos | na mesma hora, PENDING e sem conta | ninguém age automaticamente |
| **Promoção para o Radar** | aba Candidatos → empresa → oportunidade | depois, por decisão humana | comercial |

A ativação cobre a primeira e a segunda linha. A terceira **não é automática e não está ligada a tela**:
`oportunidadeDoFormulario` existe no core e só é usada por um script de demonstração; "Criar empresa" exige
CNPJ e a tela não tem onde informá-lo (só "Associar" a empresa existente funciona). O lead é atendido pelo
Inbox; a oportunidade é trabalho seguinte.

## 2. O responsável: o que foi validado

Simulado com as 8 regras de roteamento lidas da produção (somente leitura) e provado em
`src/core/inbox/formularioRoteamento.test.ts`:

| ponto | resultado |
|---|---|
| setor COMERCIAL ativo | sim, em produção |
| responsável padrão | **nulo em produção** — a conversa cairia no setor, sem dono (`ATRIBUIR_SETOR`) |
| membro ou equipe exigidos? | **não**: o responsável padrão do setor basta para o roteador (`selecionarResponsavel`) e para a RPC `inbox_apply_routing` |
| visibilidade | Administrador é transversal: vê todas as caixas. Único perfil ativo que pode receber: Augusto Macedo |
| prazo | **30 minutos úteis** a partir do instante da submissão (segunda a sexta, 08h–18h, São Paulo; feriados nacionais e de Goiânia). Regra só do lead do site: os demais canais seguem com as horas corridas da configuração (Normal 24 h). Detalhe em `docs/formulario-site.md` §4.1 |
| encaminhamento para o COMERCIAL | **dependia do texto**: «podem me ligar?» no formulário `iniciar-projeto` ia para a ENGENHARIA com 95% (a palavra «projeto», inclusive a do nome do formulário). Corrigido com a regra `ROT-SITE` (canal PORTAL + contexto EXTERNAL → COMERCIAL, ordem 0) |
| onde aparece | selo do menu Atendimento e caixa «Precisa de mim» (atribuídas a mim); «Não atribuídos»; indicador «SLA vencido», que também ordena a lista |

Limite conhecido: **ninguém é avisado**. Não há notificação nem agendador de escalação; o lead aparece para
quem abre o sistema.

## 3. Configuração de produção ainda necessária

Nenhuma foi feita. Cada linha precisa de autorização.

| # | onde | o quê |
|---|---|---|
| C1 | banco (Supabase) | `scripts/formulario-ativacao-producao.sql`: responsável padrão do COMERCIAL = Augusto (provisório) + regra `ROT-SITE`. Idempotente, uma transação, reversão no cabeçalho. Provado em PostgreSQL local; os gatilhos de auditoria de produção não foram exercidos |
| C2 | Netlify do **eiffcontrol** | `EIFF_FORM_SECRET` (novo, gerado por pessoa) · `EIFF_FORM_SOURCE_ID` = `0e238b9c-01f1-4a33-9274-de7f1af8245f` · `EIFF_INBOX_ORGANIZATION_ID` = `e1a7e58f-29d1-4c22-b41e-597ebdeee86e`. `SUPABASE_SERVICE_ROLE_KEY` já existe |
| C3 | Netlify do **eiff-site** | `EIFF_FORM_SECRET` com o mesmo valor (e a URL do CRM, se a função a ler de variável) |
| C4 | Netlify do **eiffcontrol** (rodada agendada) | `NETLIFY_AUTH_TOKEN` (só leitura de submissões) · `EIFF_FORM_NETLIFY_SITE` (site_id do eiff-site) · `EIFF_FORM_MARCO` (instante da ativação) e, por último, `FORMULARIO_RECONCILIACAO=ativa` |

## 4. Ordem de publicação

O CRM fica funcional e provado **antes** de a função do site existir.

1. **C1** (banco) e **C2** (variáveis do CRM).
2. **Publicar o eiff-control** (merge da `feature/radar-formulario-site` + deploy). Sem migration.
3. **Provar o endpoint** (§5, passos 1 a 6). O site ainda não manda nada.
4. **C3** e **publicar o eiff-site** pela branch limpa `release/encaminhador-crm` (só a função, o teste e o
   `tsconfig`; a `feature/formulario-para-o-crm` carrega também o «resgate do lead», que muda a página
   pública e é decisão separada). O merge na `main` do site publica sozinho.
5. **Ensaio pelo site** (§5, passo 7).
6. **C4**: anotar o instante como marco e ligar a reconciliação horária (o interruptor por último).

## 5. Ensaio fictício

Submissão: `scripts/formulario-ensaio-ficticio.json` (nome «ENSAIO FICTÍCIO (não é lead)», e-mail
`@exemplo.invalido`). O envio usa o próprio reconciliador com `--arquivo`: **não lê o painel do Netlify**,
então os leads antigos não são tocados.

| # | passo | esperado | demonstra |
|---|---|---|---|
| 1 | `curl -s -o NUL -w "%{http_code}" -X POST https://eiffcontrol.com.br/api/formulario-site` | `401` (não `404`, não `503`) | endpoint publicado e autenticado |
| 2 | `npx vite-node scripts/formulario-reconciliar.mts -- --arquivo scripts/formulario-ensaio-ficticio.json --marco 2026-11-10T00:00:00Z` | simulação: `aReenviar: 1` | o que seria enviado |
| 3 | o mesmo, com `--executar --confirmar FORMULARIO_SITE_V1` (e `EIFF_FORM_SECRET` no ambiente do terminal) | `200 REGISTRADO` | recebida e gravada; **é o caminho de recuperação** de uma falha de transporte |
| 4 | repetir o passo 3 | `200 IDEMPOTENTE` | reenvio não duplica |
| 5 | `npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/formulario-ensaio-conferencia.sql` | 1 evidência PENDING da fonte WEBSITE · 1 mensagem · COMERCIAL · ATRIBUIDA · responsável · prazo de 30 minutos úteis · contato `lead` com PORTAL e WHATSAPP · 0 contas, 0 oportunidades | banco certo, setor, responsável, prazo, contato |
| 6 | no app, como Augusto: `#/atendimento` → «Precisa de mim» → abrir; conferir nome, telefone e dados do galpão; mudar para Em atendimento; registrar nota interna | permitido | o atendente abre e atualiza |
| 7 | **depois de publicar o site**: preencher o formulário público com dados claramente fictícios | conversa nova em segundos | submissão recebida do site |
| 8 | reconciliador com `--site <id> --marco <instante da ativação>`, em simulação | antigos em `anterior_ao_marco`; a do passo 7 já entrou | marco e retenção |

O arquivo de ensaio traz `created_at` fixo (10/11/2026, 09:00 em São Paulo): o prazo calculado é 09:30 daquele dia, então,
rodado depois disso, o lead **chega com o SLA vencido** — é o comportamento certo para uma submissão antiga. Para ver o
prazo correndo, troque o `created_at` do arquivo pelo instante do ensaio (e o `id`, se o anterior já tiver entrado).

Encerrar: fechar as conversas de ensaio com motivo «ensaio» e rejeitar os candidatos na aba Candidatos com o
mesmo motivo. A evidência é imutável e **fica** (REJECTED); não há como apagá-la, por desenho.

## 6. Reconciliação horária

Executor único: a **Scheduled Function do Netlify** no eiffcontrol (`netlify/functions/formulario-reconciliar.mts`,
`@hourly`), **desligada por padrão** — só roda com `FORMULARIO_RECONCILIACAO = ativa` **e** `EIFF_FORM_MARCO`. O workflow do
GitHub Actions que existia como reserva manual nunca esteve ligado e saiu do release.

- **Alerta**: a rodada que não pôde rodar responde 503 e aparece como falha no painel de Functions; a linha
  `RECONCILIACAO_AGENDADA` traz `falhas` e `recuperadas`. Não há notificação automática.
- **Marco**: `EIFF_FORM_MARCO`. Tudo o que é anterior fica retido; a rodada agendada não tem como incluir anteriores.
- **Mão humana**: `scripts/formulario-reconciliar.mts` (simulação por padrão), validado localmente com a submissão
  fictícia: simulação, retenção pelo marco e os três bloqueios (saída `2`).
- **O que ela não faz**: avisar o comercial e cumprir o prazo de 30 minutos. Um lead recuperado pela rodada chega com o
  prazo contado da submissão original, possivelmente já vencido.
- Não validado: a execução agendada no Netlify (só existe em deploy publicado) e a leitura real da API de submissões.

## 7. Reversão

| situação | ação | efeito |
|---|---|---|
| parar a entrada já | apagar `EIFF_FORM_SECRET` em um dos dois sites | 401 na borda; as submissões ficam no painel do Netlify |
| parar a reconciliação | `FORMULARIO_RECONCILIACAO` ≠ `ativa` | o job deixa de rodar |
| tirar a função do site | reverter o merge da `release/encaminhador-crm` | a página pública não muda |
| tirar o endpoint | reverter o merge no eiff-control e publicar | `404`; nada a desfazer no banco (sem migration) |
| desfazer a configuração | os dois `update` do cabeçalho de `scripts/formulario-ativacao-producao.sql` | COMERCIAL volta a ficar sem responsável e sem a regra |
| o que já entrou | nada é apagado | conversa fechada com motivo; candidato REJECTED |
