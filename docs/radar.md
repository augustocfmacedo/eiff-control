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

### Communication Intelligence 01 (setembro/2026)

Motor de contexto de comunicação, reutilizável para qualquer conta, contato, sinal, estágio e resultado. Nada é enviado.

- **Fatos** (`fatosDaEmpresa`, `fatosDoContato`, `fatosDoSinal`): cada fato carrega origem, fonte, `verificado`, confiança, data e URL. Só fato verificado entra em "fatos permitidos"; a leitura "por que importa" é interpretação e nunca vira fato.
- **Objetivos** (`OBJETIVOS`): condição de sucesso, CTA, estágio mínimo/máximo e personas adequadas.
- **Playbooks** (`PLAYBOOKS`): ACCESS_VIA_EXECUTIVE, REFERRAL_INTRODUCTION, TECHNICAL_DISCOVERY, OPERATIONS_DISCOVERY, PROCUREMENT_ROUTING, NO_RESPONSE_FOLLOWUP, FUTURE_PROJECT_NURTURE, PROJECT_CAPTURE, PRELIMINARY_ENGINEERING. Regras e intenção (fazer, não fazer, tom, elementos obrigatórios e proibidos, objeções), nunca texto fechado.
- **Seleção** (`selecionarPlaybook`): último resultado (`TRANSICOES_RESULTADO`) → indicação recebida → compras → persona técnica/operacional → executivo (decision fit ≥ fit.ideal é o decisor; abaixo disso, pedir indicação).
- **Canal** (`recomendarCanal`): executivo WhatsApp → telefone → e-mail; técnico/operacional telefone → WhatsApp → e-mail; compras e-mail; estágios avançados ligam; sem resposta alterna o canal; indicação vira canal secundário REFERRAL; sem canal válido → enriquecer.
- **Content spec** (`montarContentSpec`): objetivo, playbook, canal, audiência, remetente, tom, limite de palavras, fatos a usar e a evitar, CTA, histórico, indicação, elementos obrigatórios/proibidos, alegações proibidas. É a entrada futura do LLM.
- **Geração** (`generateCommunication`): interface de provedor. Hoje só o determinístico (compõe identificação, fato do sinal, frase da EIFF e CTA). O provedor LLM roda na função Netlify `/api/comunicacao` (ver "Geração com IA"), nunca com chave no navegador.
- **Fact gate (Hardening 01)**: cada claim tem `id`, `tipo` (FACT, INTERPRETATION, INTERNAL_REASONING, TECHNICAL_CLAIM) e `divulgacao` (ALLOWED ou INTERNAL_ONLY). Só FACT verificado e divulgável entra em `allowedClaims`; a leitura "por que importa" é INTERPRETATION; fonte PARTNER e indicação humana são INTERNAL_ONLY até o revisor marcar "autorizado a citar quem indicou". O provedor recebe só `allowedClaims` (nunca o raw_payload). `referenciaAoSinal` descreve o sinal na linguagem da fonte real (registro de obra, contratação pública, comunicado da empresa, publicação, notícia, ou "movimento relacionado a" para parceiro/manual/importação). Claims técnicos (`CLAIMS_TECNICOS`) só entram quando aprovados: "avaliar preliminarmente a solução estrutural e definir o próximo passo técnico" e "entender área, uso, geometria, cargas relevantes e principais premissas" sim; peso/prazo, economia e preço não. `validarGeracao` valida depois: números, datas e entidades só de claims permitidos; elementos obrigatórios e proibidos do playbook; CTA do objetivo; sem presunção de projeto aberto ou de responsabilidade do contato; sem promessa não autorizada; sem revelar fonte confidencial. A interface `ValidadorComunicacao` recebe depois um validador semântico server-side.
- **Saudação, idempotência e versões**: saudação pelo horário local (bom dia / boa tarde / boa noite) ou "Olá, <nome>"; `contextHash` (empresa, contato, sinal, objetivo, playbook, canal, claims, versões) evita rascunhos duplicados; cada rascunho grava playbook, content spec, prompt, provedor e modelo. Persistência proposta em `docs/propostas/0038_radar_communication.sql` (não aplicada).
- **Persistência (0038)**: `radar_communication` guarda o snapshot mínimo do spec (claims permitidos com fonte e verificação, objetivo, playbook, canal, CTA, versões; sem raw_payload, telefone, e-mail ou LinkedIn), o conteúdo gerado original, a edição humana (texto, editor, data), a validação, provedor/modelo/prompt/playbook/content-spec versions, quem aprovou/rejeitou e as atividades de envio e resposta. `radar_communication_event` recebe todo estado por trigger (ator e motivo) e é imutável: usuários só leem, e o banco recusa update, delete e insert manual (0039). O snapshot da comunicação também é imutável depois do insert (contexto, conteúdo gerado, versões, criação): mudança de contexto gera outra comunicação; só estado, edição humana, validação, aprovação/rejeição e atividades de envio/resposta mudam. A minimização de PII/raw é recursiva em qualquer nível do JSON (chaves, não palavras; URL da fonte permitida). Invariantes no core e no banco: SENT exige a atividade do envio manual (nunca nota interna); REPLIED exige envio e atividade com resultado; READY_FOR_REVIEW nunca vai direto a SENT; aprovar revalida o texto efetivo pelo fact gate. `context_hash` SHA-256 canônico com índice único por rascunho ativo: mesmo contexto devolve o rascunho existente; contexto novo (sinal, contato, claim, canal, divulgação, versões) gera outro rascunho sem apagar o histórico. Códigos internos de sinal nunca chegam ao prospect (`referenciaPublicaDoSinal`).
- **Geração com IA (server-side)**: o botão "Gerar com IA" envia apenas `{ empresaId, contatoId, sinalId?, estrategiaId?, canal, citarIndicacao?, horaLocal? }` para `/api/comunicacao`; qualquer outro campo (spec, claims, objetivo, hash, remetente) é recusado com 400. A função valida a sessão, lê o papel só do perfil no banco, **reconstrói o ContentSpec a partir do banco** com o JWT do usuário (empresa, contato, sinal, estratégia, atividades, contatos, fontes, pesos do decision fit), confere as relações (contato e sinal da empresa, mesma organização, estratégia ativa), aceita só canal com dado válido no contato, monta o remetente do perfil e da organização (nunca do cliente), só libera a fonte com indicação real associada ao contato e autorizada, calcula o `contextHash` no servidor, reaproveita rascunho ativo com o mesmo hash, chama a Anthropic com saída JSON estruturada (prompt `COMMUNICATION_LLM_PROMPT_V1`), passa o texto pelo fact gate determinístico e por um juiz semântico (uma regeneração corretiva) e só então insere a comunicação completa em READY_FOR_REVIEW, com provedor, modelo, versão do prompt e métricas (tokens, latência, regeneração). Sem chave configurada ou com a IA indisponível, "Gerar versão padrão" usa o provedor determinístico. Nada é enviado ao prospect em nenhum caso. **Orçamento de tempo**: a função Netlify é síncrona (60 s). O motor usa `claude-sonnet-5` por padrão (variáveis `ANTHROPIC_COMMUNICATION_MODEL` e `ANTHROPIC_COMMUNICATION_JUDGE_MODEL`; nunca o modelo do Assistente), effort baixo, 1200/350 tokens, SDK sem retry, timeout de 22 s por chamada e deadline de 50 s no total; nenhuma chamada começa sem tempo, a regeneração única só acontece se couber geração + juiz no restante, e o estouro devolve 503 `llm_timeout` com a etapa, sem nada gravado (a tela diz "IA demorou além do limite desta tentativa. Nada foi gravado. Tente novamente."). Cada tentativa registra `communication_timing` no log da função (só tempos por etapa, modelos e resultado). **Calibração pelo feedback humano**: a primeira geração real apresentou o destinatário como responsável pela frente e, na mesma mensagem, pediu indicação de quem responde por ela. Desde então a abertura neutra depende do objetivo (em GET_REFERRAL: "Estou tentando chegar à pessoa que conduz essa frente internamente"), o fact gate reprova qualquer afirmação de que o destinatário é responsável, líder, dono ou condutor da frente quando não há indicação autorizada que sustente isso (e sempre em GET_REFERRAL), o juiz semântico tem a mesma regra explícita, e o sinal é citado como fonte + reformulação natural do fato ("Acompanhei o comunicado da empresa sobre a nova unidade e a avaliação de replicar o modelo"), nunca "comunicado sobre" seguido do título colado. A comunicação original fica REJECTED com o motivo humano, como primeiro artefato de calibração. **Ligação entre fatos (Relational Fact Binding)**: a segunda geração real combinou dois fatos válidos numa relação inexistente ("nova infraestrutura em <sede da empresa>"). Agora cada claim tem escopo (fato da conta, do contato, do sinal, local do evento, claim técnico), a localização da conta nunca chega crua ao modelo (no primeiro contato nem vai; depois vai rotulada como "somente localização corporativa"), o fact gate reprova qualquer local citado numa frase sobre o sinal/evento que não conste em claim do sinal ("local do evento não suportado pelo sinal"), e o juiz tem a mesma regra: sede não é local da obra, data de um sinal não é data de outro evento, valor de investimento não é valor de uma obra sem claim que os associe. Quando a fonte informa onde o evento aconteceu, registre em `localEvento` na leitura do sinal: isso autoriza a citação. Ambas as gerações reais ficam REJECTED com motivos distintos. Claims e referências chegam ao modelo sanitizados (sem caracteres de controle, tags ou quebras; tamanho e quantidade limitados; fatos inalterados) e o prompt os declara dados não confiáveis: instruções embutidas em texto de fonte nunca são executadas. O banco (migration 0040) recusa comunicação com contato ou sinal de outra empresa ou organização, seja quem for o autor do insert.
- **Revisão humana**: `gerarComunicacaoRadar` deixa o rascunho em READY_FOR_REVIEW; Aprovar / Editar / Rejeitar no painel "Abordagem" (página da empresa e fila Hoje). SENT e REPLIED estão bloqueados nesta fase: o envio é manual e o resultado é registrado como atividade. **Aprovação**: o que está gravado no banco é um snapshot mínimo do contexto (sem os textos dos claims negados), que serve de evidência e não de validação. Aprovar sem editar não revalida nada: a geração já passou pelo fact gate e pelo juiz antes de ser gravada, e a aprovação só muda estado, quem aprovou e quando (um evento no histórico). Aprovar depois de editar exige revalidação no servidor: ele reconstrói o contexto atual, confere que é o mesmo da geração (senão avisa "O contexto comercial mudou desde a geração. Gere uma nova abordagem antes de aprovar.") e passa o texto editado pelo fact gate e pelo juiz. Se reprovar, o rascunho continua em revisão com os motivos.

### Calibração de produção 01 (setembro/2026)

- **FIT balanceado** por regras `fitCalibrado` (configuráveis como as demais): Geografia 15 (GO 100%, UFs alvo 85%), Setor 35, Porte por funcionários 25, Faixa de receita 20, Porte industrial 5. As regras FIT antigas ficaram inativas (histórico preservado).
- **Setor canônico com gate de confiança** (`src/core/radar/fitCalibracao.ts`): a categoria é derivada em tempo de execução do nome, da descrição e do NAICS/SIC do registro bruto; confiança HIGH (nome ou termo específico na descrição) recebe 100% da afinidade, MEDIUM (termo genérico, slogan ou conflito entre evidências) 70%, LOW (só NAICS/SIC ou sem evidência) 0 e entra na lista de revisão. O setor original importado nunca é reescrito; faixas com colchetes (`[501-1000]`) são lidas sem alterar o dado.
- **Decaimento e recência por família** (`src/core/radar/sinalLeitura.ts`): ciclo longo 540 dias (fábrica, CD, armazém, CNO, terreno, expansão, projeto), médio 270 (investimento, plano/licitação pública, indicação), curto 120 (vagas, notícia, site). NEW_OFFICE e FUNDING seguem em 180; MANUAL sem decaimento. O Signal Pilot usa a mesma janela para "sinal recente".
- **Fonte oficial**: `OFFICIAL_COMPANY_SOURCE` (Comunicado oficial da empresa, 0,95) para releases e páginas institucionais; `WEBSITE` (Site da empresa) segue 0,6 para observações indiretas.
- **Próxima ação do CRM**: sinal acionável (grupo A/B, relevância DIRECT/INDIRECT, confiança ≥ 0,40) com decision fit do contato ≥ `fit.ideal` → Contatar agora; abaixo → Buscar decisor; sem contato → Buscar decisor. Sem sinal acionável vale a regra anterior.
- Aplicação em produção por `scripts/radar-calibracao-aplicar.mts --perfil <uuid>` (simula, mostra o diff esperado e só grava com `--executar`, numa transação; aborta se a calibração já existir).

## Decisores (persona, decision fit, contato principal)

- **Persona** do contato inferida do cargo/departamento pela tabela `radar_persona_rule` (termos por palavra inteira,
  exclusões, prioridade); o usuário pode fixar a persona no formulário (`personaManual`). Personas: OWNER, CEO,
  PRESIDENT, COO, INDUSTRIAL_DIRECTOR, ENGINEERING_DIRECTOR, OPERATIONS_DIRECTOR, EXPANSION_DIRECTOR, FACILITIES,
  ENGINEERING, OPERATIONS, MANUFACTURING, LOGISTICS, SUPPLY_CHAIN, PROCUREMENT, REAL_ESTATE, OTHER.
- **Decision fit 0-100** (`calcularDecisionFit`): base por persona × porte da empresa (pequena ≤ 50, média ≤ 500,
  grande) + senioridade + departamento + tipo de projeto × persona. Todos os pesos vêm de `radar_decision_fit_weight`
  (chaves `persona.<P>.<porte>`, `senioridade.<nível>`, `departamento.<termo>`, `projeto.<tipo>.<P>`, `porte.*.max`,
  `fit.adequado`), editáveis em Command Center › Personas e decision fit, com simulador. Em empresas pequenas
  OWNER/CEO/PRESIDENT lideram; em médias e grandes sobem as diretorias industrial/engenharia/operações/expansão e
  facilities; compras pesa menos.
- **Contato principal** (`is_primary_contact`, um por empresa): o sistema sugere o maior decision fit entre os
  elegíveis com as razões (persona × porte, senioridade, área, tipo de projeto); o usuário pode definir outro na aba
  Contatos. Nunca são selecionados contatos com do_not_contact/opt_out, situação INVALIDO ou SAIU_DA_EMPRESA.
- **Qualidade do contato 0-100**: nome completo, cargo, empresa confirmada (CNPJ ou domínio), departamento,
  senioridade, e-mail profissional e status, telefone e status, LinkedIn, verificação recente.
- **Qualidade da empresa** (dimensão DATA_QUALITY): firmográficos, domínio, CNPJ, localização, decisor adequado,
  contato com canal válido, sinal identificado.
- **Next best action** (`recomendarAcao`, campo `estado`): SEARCH_DECISION_MAKER (sem contato adequado),
  ENRICH_CONTACT (decisor sem canal), RESEARCH_SIGNALS (decisor e canal, sem sinal), CONTACT_NOW (sinal + decisor),
  além de OVERDUE_TASK, PLANNED_ACTION, RESPOND, FOLLOW_UP, OPEN_OPPORTUNITY, WAIT e DO_NOT_CONTACT.
- **Importação de contatos**: colunas id da empresa, empresa, domínio, nome, cargo, departamento, senioridade, e-mail,
  status do e-mail, celular, LinkedIn, fonte. Associação por id externo → domínio → razão social (+ UF). Mais de uma
  candidata, ou só nome parecido, vai para a **fila de revisão** (Command Center) sem criar empresa; empresa
  inexistente sem ambiguidade é criada a partir da linha.
- **Métricas** (Command Center): empresas, com contato, com decisor adequado, com canal, precisam de pesquisa, precisam
  de enriquecimento, sem decisor, fila de revisão; taxas de cobertura em `resumoRadar` e view `v_radar_contact_coverage`.

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
