# EIFF Radar — inteligência comercial e CRM de oportunidades

Módulo nativo do EIFF Control (menu **Comercial**) que transforma empresas e sinais de mercado em oportunidades
priorizadas, explica por que cada empresa é relevante e direciona a equipe para a melhor próxima ação.

## Domínio

Empresa (`Empresa`) é a raiz. Dela dependem Contatos, Projetos, Sinais, Oportunidades, Atividades e Tarefas.
**Lead não é entidade**: um lead é uma empresa com classe de prioridade (A+, A, B, C, D) e sem oportunidade ganha.

| Entidade | Tabela | Observação |
|---|---|---|
| Fonte | `radar_source` | registro de origens (VIBE, CNO, PNCP, CNPJ_RFB, NEWS, LINKEDIN, PARTNER, MANUAL, WEBSITE, CSV) com confiabilidade |
| Empresa | `radar_company` | cadastro + campos de cache (scores por dimensão, prioridade, classe, último sinal/contato, próxima ação) |
| Contato | `radar_contact` | decisor, poder de decisão, qualidade (0-100), verificação |
| Projeto | `radar_project` | empreendimento com área, valor, estágio e início previsto |
| Sinal | `radar_signal` | fato de mercado com data, confiança, payload bruto, score base/efetivo, verificação |
| Oportunidade | `radar_opportunity` + `radar_opportunity_stage_history` | 15 estágios; toda mudança de estágio gera histórico |
| Atividade | `radar_activity` | interação por canal com resultado (taxonomia `radar_response_type`) e estratégia |
| Tarefa | `radar_task` | próxima ação com prazo, responsável e status |
| Estratégia | `radar_strategy` | configurável; modelo de mensagem editável na tela |
| Experimento | `radar_experiment` | hipótese × estratégia × canal |
| Score | `radar_score_rule`, `radar_score_setting`, `radar_score_snapshot` | regras, pesos/cortes e histórico com explicação |
| Importação | `radar_import_job`, `radar_import_row`, `radar_import_error` | cada linha bruta e cada erro ficam guardados |
| Duplicata | `radar_possible_duplicate` | baixa confiança vira revisão humana (mesclar ou "são diferentes") |
| Supressão | `radar_suppression` | do_not_contact, opt_out, email_bounced, invalid_phone |
| Registro bruto | `radar_source_record` | payload original de toda ingestão (linhagem e reprocessamento) |

Código: tipos em `src/core/radar/types.ts`; regras puras em `normalizar.ts` (CNPJ, domínio, nome, dedup),
`score.ts` (motor), `pipeline.ts` (caches, fila, recomendação, indicadores), `csv.ts` (leitura de planilhas),
`adapters.ts` (fontes externas → formato normalizado), `ingestao.ts` (upsert com dedup e linhagem), `padroes.ts`
(valores iniciais). Ações no `store.ts` (seção "EIFF Radar"); persistência em `src/data/radar.supabase.ts`.

## Regras críticas

- **Oportunidade ativa nunca fica sem próxima ação**: salvar, mudar estágio e concluir a última tarefa exigem
  descrição + data (ou tarefa aberta). O indicador "sem próxima ação" aparece no Command Center, em Hoje e na empresa.
- **Deduplicação** na ordem CNPJ → domínio → razão social normalizada + cidade/UF → nome parecido. Igual/provável
  atualiza a existente só nos campos vazios; parecido cria a empresa e uma possível duplicata para revisão. Cadastro
  manual com CNPJ/domínio/razão social já existente é recusado.
- **Supressão**: contato com do_not_contact/opt_out não aparece como decisor nas filas e não aceita atividade
  (exceto canal Indicação). INVALID_CONTACT em atividade marca o contato automaticamente.
- **WON/LOST** exigem motivo e cancelam as tarefas abertas da oportunidade.
- **Nada é apagado**: empresas são inativadas ou mescladas; sinais e atividades são imutáveis; auditoria no app
  (`registrar`) e no banco (triggers `audit_row` em empresa, oportunidade, regras de score e supressões).

## Score

Dimensões FIT, TIMING, INTENT, RELATIONSHIP, DATA_QUALITY, cada uma 0-100 pela soma das regras ativas
(`radar_score_rule`): condição (sinal, campo da empresa, contato, resposta, atividade, projeto, completude),
peso (pode ser negativo), decaimento linear em N dias. Score final = Σ dimensão × peso (pesos e cortes em
`radar_score_setting`: 0,25/0,35/0,25/0,10/0,05 e A+ ≥ 85, A ≥ 70, B ≥ 50, C ≥ 30). Cada cálculo guarda um snapshot
com a explicação; na interface o score é clicável e mostra fator por fator, com o motivo e o decaimento aplicado.
"Recalcular scores" no Command Center reaplica regras e decaimento a toda a base.

## Telas

- **Command Center** (`#/radar`): pipeline ponderado, leads A+/A, novos sinais, follow-ups vencidos, oportunidades sem
  próxima ação, atividades, respostas, reuniões, projetos recebidos, propostas; abas Alertas, Regras de score,
  Estratégias, Importações, Duplicatas, Não contatar.
- **Hoje** (`#/radar/hoje`): fila por prioridade (vencidas primeiro), com motivo, sinal principal, decisor, última
  interação, próxima ação e ação recomendada; registrar atividade, concluir tarefa ou agendar direto da fila.
- **Empresas** (`#/radar/empresas`): tabela com filtros (classe, UF, setor, situação) e ordenação.
- **Empresa** (`#/radar/empresas/:id`): Overview, Contatos, Projetos, Sinais, Atividades (com tarefas),
  Oportunidades (com histórico), Inteligência (explicação do score, estratégia sugerida, linhagem).

## Importação CSV

Command Center ou Empresas › Importar CSV: arquivo ou texto colado, com cabeçalho. Colunas reconhecidas por sinônimos
em português e inglês (razão social/empresa, CNPJ, domínio/site, setor, cidade, UF, funcionários, faturamento,
capital social…; contatos: nome, cargo, e-mail, telefone, celular, WhatsApp, LinkedIn, decisor, empresa/CNPJ).
O resultado mostra novas, atualizadas, possíveis duplicatas e erros por linha.

## Fontes externas (arquitetura futura)

`src/core/radar/adapters.ts` define a interface `AdapterFonte` (`normalizar(bruto)` → empresa, contatos, projeto,
sinais e payload preservado) com adapters iniciais para CNO, PNCP, CNPJ (Receita), enriquecimento B2B e notícias.
`actions.ingerirRegistrosRadar(codigoFonte, brutos[])` aplica o adapter e o upsert. A busca automática (`buscar`)
fica para a próxima fase, por função serverless no Netlify, sem mudar o core.

## Permissões

`radar` (Administrador, Diretoria, Financeiro, Gestor de obra, Engenharia, Compras) para operar;
`radar_config` (Administrador, Diretoria) para regras, pesos, estratégias e fontes. Contabilidade e Auditoria só leem.
RLS espelha isso por organização e papel (migration 0031).
