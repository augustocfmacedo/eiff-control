# EIFF Control — contexto para o Claude Code

Sistema de gestão da EIFF (engenharia, fabricação e montagem de estruturas metálicas): financeiro, tesouraria,
obras, medições, equipe e produção. Construído a partir da planilha `Fluxo_de_Caixa_EIFF.xlsx` e do
`Blueprint_Funcional_EIFF_Control_v1.docx`. Idioma do produto e das conversas: português do Brasil.

## Stack e comandos

- React 18 + Vite + TypeScript; dados no Supabase (PostgreSQL) do projeto `dduobppgomqyagjviwpx`; site estático no Netlify em `https://eiffcontrol.com.br`.
- `npm run dev` (porta 5173) · `npm test` (vitest) · `npm run build` (tsc + eslint + vite) · `npm run lint`. Para testar telas sem login: `npm run dev -- --mode demo` com um `.env.demo` local contendo `VITE_SUPABASE_URL=` e `VITE_SUPABASE_ANON_KEY=` vazios (modo local com seed; arquivo não versionado).
- Migrations SQL em `supabase/migrations/NNNN_nome.sql`, numeração sequencial. Aplicar com
  `npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f supabase/migrations/NNNN_x.sql`
  (exige `npx supabase login` feito pelo usuário nesta máquina). Nunca apagar registros financeiros; usar cancelamento/estorno.
- `.env` (não versionado) precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; sem eles o app roda em modo local com `src/data/seed.json`.
- Publicar: `npm run build` e `npx netlify deploy --prod --dir dist` (login Netlify do usuário), ou push no GitHub quando a integração estiver ligada (`netlify.toml`).

## Arquitetura (regras que não mudam)

- `src/core/engine.ts` é a única definição dos KPIs (fluxo 13S/24M, DRE, Obra 360°, checks). As views SQL em `0002_views.sql` espelham as mesmas regras. Mudou a regra, muda nos dois e nos testes.
- `src/core/obras.ts` (serviços, medições, demandas, produção), `equipe.ts` (apontamentos), `analise.ts` (saúde da obra), `ofx.ts` (extrato), `compras.ts` (pedidos de compra, orçado × comprado por insumo), `orcamentos.ts` (custo por composição, BDI, curva ABC, conversão em serviços), `sinapi.ts` (leitura das planilhas SINAPI, formatos antigo e unificado; preço da UF com fallback de SP como faz o SINAPI; abas ISE/CSE ignoradas; código 0 de fórmulas descartado).
- Importação SINAPI por linha de comando: `node scripts/importar-sinapi.mjs --arquivo <xlsx|pasta> --uf GO --saida NNNN_nome --todos-insumos --grupos <regex> --composicoes a,b` gera migration idempotente (upsert por origem + código, itens regravados). Os arquivos da Caixa ficam fora do repositório (`D:UsuarioDownloadsSINAPI-2026-07-formato-xlsx`).
- `src/data/store.ts` concentra as regras de negócio (validações, alçadas, aprovações, liquidação, conciliação, fechamento, auditoria, permissões por papel). Toda ação passa por `registrar()` para auditoria.
- `src/data/supabase.ts` lê o banco para o formato `Dataset` e grava só as diferenças (`persistirRemoto`). Novas entidades exigem: tipo em `types.ts`, migration, mapeamento de leitura e de gravação em `supabase.ts`, e `medicoes: []`-style default em `scripts/migrate-spreadsheet.mjs`.
- Telas em `src/screens/`; componentes em `src/ui/`. Hooks do React sempre antes de qualquer `return` antecipado (o ESLint bloqueia o build se violado).
- Testes comparam o motor com a planilha centavo a centavo (`engine.test.ts`); não altere valores esperados sem justificar.
- RLS: política de SELECT nunca deve consultar a própria tabela por função STABLE (ex.: `can_access_project(id)` em `project`), porque `INSERT ... RETURNING` não enxerga a linha nova e falha com "new row violates row-level security policy". Use colunas da própria linha e helpers que leem só `user_scope` (migration 0025).

## Regras de negócio essenciais

- Valores positivos; o tipo (Entrada/Saída) dá o sinal. Caixa usa data de realização ou vencimento; DRE usa competência.
- Saída acima de `LIMITE_GESTOR_OBRA`, fora do orçamento ou que aprofunde o caixa abaixo da reserva exige aprovação Gestor → Financeiro → Diretoria; solicitante não aprova o próprio pedido (Administrador é a exceção na fase de validação).
- Movimento bancário é fato: "Lançar a partir da transação" cria lançamento realizado, liquidado e conciliado, sem alçada.
- Serviços da obra vêm do cronograma físico-financeiro do contrato. Custo previsto do serviço, nesta ordem: custo orçado próprio; custo direto dos itens do orçamento executivo Contratado vinculados ao serviço (`custoOrcamentoPorServico`); receita × (1 − margem alvo). O orçamento disponível da obra = custo previsto − comprometido. EAC = pago + comprometido em aberto + ETC não comprometido.
- Faturamento direto ao cliente (`Lancamento.faturamentoDireto` / `financial_entry.direct_billing`): compra da obra que o cliente paga direto ao fornecedor. Só para saídas com obra. Não entra no caixa, no fluxo, no DRE nem no aging da EIFF (valorCaixaProjetado e valorGerencial = 0), mas conta no comprometido do serviço/obra e abate o saldo de faturamento direto do contrato (soma de `medicoes.faturamentoDireto`, ou dos serviços). Views SQL espelham em 0023 (`direct_billing_*` em `v_project_360`, `v_service_cost`).
- Pedidos de compra (`#/compras`, `PedidoCompra`, tabelas `purchase_order`/`purchase_order_item`, migration 0024): rascunho editável; **Emitir** gera um lançamento previsto (Programado, categoria do pedido, serviço, faturamento direto, vencimento = data + prazo) passando pelas alçadas normais, e congela os itens; **Receber** atualiza quantidades e, se marcado, grava o preço pago como preço vigente do insumo (`precoFonte` = pedido/fornecedor); **Cancelar** cancela o lançamento junto (se não realizado). Comparativo orçado × comprado usa a explosão de insumos (`curvaInsumos`) dos orçamentos Contratados da obra contra os itens de pedidos ativos com insumo vinculado.
- Data-base automática (`auto_base_date`) avança para hoje; a data do saldo de abertura de cada conta é independente dela.
- Orçamentos (`#/orcamentos`): catálogo de insumos e composições (origem SINAPI, TCPO ou Própria; casamento por origem + código na importação), custo unitário = Σ coeficiente × preço (recursivo, sem ciclos), preço de venda = custo × (1 + BDI), curva ABC com cortes 80%/95%. Item pode ter preço de venda informado (`precoUnitarioVenda`, proposta/contrato): substitui custo × (1 + BDI) e a margem passa a ser calculada contra o custo das composições; `porServico` agrega itens vinculados a serviços da obra. "Contratar" gera um serviço por item (custo orçado = custo direto, preço de venda = com BDI ou redistribuído ao valor do contrato), grava `obra.custoOrcado` e congela os itens. A base SINAPI é pública (Caixa); a TCPO é licenciada e não pode ser embutida: só importar o que o usuário exportar.

## Estado e decisões (atualizar ao mudar)

- Obra ativa: OB-SF-CL-01 Smart Fit César Lattes; contrato global 4,1 mi com 65% faturado direto pelo cliente; receita líquida EIFF ≈ 1,285 mi; 26 eventos de medição; E03/E05/E06/E07 faturados na NF 47. Mês contratual 1 = junho/2026 (a confirmar).
- Usuário único em validação: `augusto@eiff.com.br`, papel Administrador (voltar a Diretoria quando a equipe entrar).
- Migrations aplicadas até 0025. Orçamento `ORC-328` (proposta Modo 328 R02, 05/05/2026, R$ 4.131.354,17, 81 itens em 14 etapas) carregado como Contratado na OB-SF-CL-01 com preço de venda por item (`sale_unit_price` = total do PDF ÷ quantidade) e cada item vinculado ao serviço SFCL-xx cujo `budget_base` é o total da etapa (impermeabilização foi para SFCL-05). Fonte: `scripts/proposta-smartfit.mjs` → `0018_smartfit_proposta.sql` (PDF vetorial sem texto, transcrito de páginas renderizadas). Catálogo SINAPI GO 07/2026 não desonerado carregado (migration 0019 gerada por `scripts/importar-sinapi.mjs`: todos os 6.120 insumos com preço de GO ou atribuído de SP, 2.222 composições dos grupos relevantes + dependências, 13,5 mil itens; leitor validado contra o custo oficial da aba CSD em 95% das composições, restante é arredondamento de centavos). 60 dos 81 itens da proposta vinculados a composições/insumos SINAPI (`VINCULOS` em `scripts/proposta-smartfit.mjs`, migration 0020; insumos usados direto viram composições próprias `INS-<código>`). Sem equivalente SINAPI: estrutura metálica MODO (10.3), isopainel PIR, pinos stud, chumbadores, parafusos, verbas de instalações, transporte, EPI, limpeza final. Os 21 itens restantes usam composições próprias da EIFF (`scripts/composicoes-eiff.mjs` → migration 0022; 0021 trouxe do SINAPI as composições de mão de obra/equipamento necessárias): estrutura metálica por kg = `EIFF-FAB-KG` (fabricação, 17,5 HH/t, aço 1,05 kg/kg) + `EIFF-MON-KG` (montagem, 26 HH/t, guindaste 1,2 h/t) somadas em `EIFF-EST-KG`; pinos stud, parafusos, chumbadores, isopainel, cumeeira, rufo 80 cm, transporte, canteiro e subempreitadas (85% do preço de venda). Todos os insumos próprios (`EIFF-INS-xx`) e coeficientes são ESTIMATIVAS marcadas em notes/price_source, a substituir por cotação ou apontamento real. Com isso os 81 itens têm custo: margem prevista da proposta ≈ 22% (ver `node scripts/composicoes-eiff.mjs` para a prévia por composição).
- Pendências conhecidas: registrar E01/E02/E04/E08 se medidos; lançar custos com serviço; alçadas reais (DEC-03); reserva mínima (DEC-09); plano Pro do Supabase para backup.
- Documentação: `README.md`, `docs/arquitetura-e-regras.md`, `docs/implantacao-supabase.md`, `docs/publicacao-automatica.md`.

## Trabalho em paralelo (duas máquinas)

Sempre `git pull` ao começar e `git push` ao terminar; commits pequenos com mensagem em português. Antes de criar uma migration,
conferir o último número no repositório e no banco (`select * from audit_log order by id desc limit 1` não serve; use a lista de arquivos).
Não editar `seed.json` à mão: regenerar com `npm run migrate:planilha`.
