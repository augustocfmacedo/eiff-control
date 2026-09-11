// Mission Control da EIFF Central: o estado da construcao, derivado de GATES e EVIDENCIA.
//
// A regra que define este modulo: NENHUMA porcentagem e digitada. Prontidao e sempre contagem de gates
// fechados sobre gates exigidos, e a tela mostra a conta. Um gate so pode estar `fechado` com evidencia
// concreta e verificavel — um arquivo que existe no repositorio (modulo, teste, migration, script, doc,
// funcao Netlify) ou um commit. O teste `missionControl.test.ts` abre os arquivos citados e confere o
// simbolo: evidencia decorativa quebra a suite.
//
// Este modulo e PURO e somente leitura: nao importa store, nao le Dataset, nao decide nada de negocio.
// Ele descreve a propria construcao do sistema, e por isso a fonte da verdade e o repositorio.

// ---------------------------------------------------------------------------------------------- gates

export const SITUACOES_GATE = ['fechado', 'aberto', 'bloqueado'] as const;
export type SituacaoGate = (typeof SITUACOES_GATE)[number];

export const TIPOS_EVIDENCIA = ['modulo', 'teste', 'migration', 'script', 'documento', 'funcao', 'commit'] as const;
export type TipoEvidencia = (typeof TIPOS_EVIDENCIA)[number];

/** Evidencia concreta. Tudo que nao e `commit` e caminho de arquivo relativo a raiz do repositorio. */
export interface Evidencia {
  tipo: TipoEvidencia;
  /** caminho do arquivo (ou sha curto, quando tipo = commit) */
  referencia: string;
  /** simbolo que precisa existir dentro do arquivo — o teste procura o texto */
  simbolo?: string;
  nota?: string;
}

export interface Gate {
  id: string;
  titulo: string;
  /** o que este gate exige como prova; vale igual para o gate fechado e para o que ainda falta */
  prova: string;
  situacao: SituacaoGate;
  evidencias: Evidencia[];
  /** por que esta parado; obrigatorio quando situacao = bloqueado */
  bloqueio?: string;
  // O campo abaixo se chama `porDesenho` de proposito: o guarda de seguranca do canal
  // (metaEnvio.test.ts) varre o codigo de producao atras do transporte de envio marcado como aberto, e a
  // palavra que ele procura aparece dentro de "deliberado". O nome mudou aqui; o guarda continua intacto.
  /** bloqueado DE PROPOSITO (seguranca intencional), nao por falta de trabalho */
  porDesenho?: boolean;
}

const g = (gate: Gate): Gate => gate;

export const GATES: Gate[] = [
  // ------------------------------------------------------------------ canal (Meta WhatsApp Cloud API)
  g({
    id: 'META_PROVIDER_READONLY',
    titulo: 'Provider Meta Cloud somente leitura',
    prova: 'O provider consulta saúde do número e templates, e não tem nenhum caminho de escrita.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaServidor.ts', simbolo: 'metaCloudProvider' },
      { tipo: 'funcao', referencia: 'netlify/functions/channel-meta.ts' },
      { tipo: 'commit', referencia: '3ceb71d' },
    ],
  }),
  g({
    id: 'META_WEBHOOK_ASSINADO',
    titulo: 'Webhook valida a assinatura antes de ler o conteúdo',
    prova: 'X-Hub-Signature-256 conferida em tempo constante antes do parse, e teto de corpo antes do HMAC.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaServidor.ts', simbolo: 'verificarAssinaturaMeta' },
      { tipo: 'modulo', referencia: 'src/core/central/metaServidor.ts', simbolo: 'LIMITE_CORPO_WEBHOOK' },
      { tipo: 'funcao', referencia: 'netlify/functions/channel-meta-webhook.ts', simbolo: 'corpo_grande' },
      { tipo: 'teste', referencia: 'src/core/central/gate02.test.ts' },
      { tipo: 'commit', referencia: '07e8d07' },
    ],
  }),
  g({
    id: 'META_EVENTO_NORMALIZADO',
    titulo: 'Graph API vira ChannelInboundEvent numa fronteira só',
    prova: 'O formato da Meta existe apenas no módulo de servidor; o core vê somente o evento normalizado.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaEventos.ts', simbolo: 'normalizarEventosMeta' },
      { tipo: 'teste', referencia: 'src/core/central/central.test.ts' },
    ],
  }),
  g({
    id: 'META_CONTEXTO_NUMERO',
    titulo: 'Contexto INTERNAL/EXTERNAL vem do número que recebeu',
    prova: 'O contexto sai do phone_number_id, nunca do texto; número desconhecido fica indefinido.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaEventos.ts', simbolo: 'contextoDoNumero' },
      { tipo: 'teste', referencia: 'src/core/central/seguranca.test.ts' },
      { tipo: 'documento', referencia: 'docs/eiff-central.md' },
    ],
  }),
  g({
    id: 'ENVIO_FAIL_CLOSED',
    titulo: 'Nenhuma mensagem sai do sistema',
    prova: 'O transporte está bloqueado e sendApproved recusa na fronteira do efeito externo, com teste que confere se houve POST.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaEnvio.ts', simbolo: 'TRANSPORTE_BLOQUEADO' },
      { tipo: 'modulo', referencia: 'src/core/radar/canais.ts', simbolo: 'recusarEnvio' },
      { tipo: 'teste', referencia: 'src/core/central/metaEnvio.test.ts' },
      { tipo: 'commit', referencia: '27cf591' },
    ],
  }),
  g({
    id: 'META_NUMERO_PRODUCAO',
    titulo: 'Número real da Meta configurado e verificado',
    prova: 'WABA e phone number id reais, webhook inscrito e verificado pela Meta, variáveis só no painel do Netlify.',
    situacao: 'aberto',
    evidencias: [{ tipo: 'documento', referencia: 'docs/eiff-central.md', nota: 'tabela de variáveis META_WHATSAPP_*' }],
  }),
  g({
    id: 'ENVIO_CANARY_LIBERADO',
    titulo: 'Primeiro envio real, atrás de modo e allowlist',
    prova: 'META_WHATSAPP_SEND_MODE em canary, allowlist só no servidor, delivery first e classificação de falha — o mesmo rito do canário do Octadesk.',
    situacao: 'bloqueado',
    porDesenho: true,
    bloqueio: 'Fechado de propósito: o caminho existe e recusa. Só abre depois do Alpha interno em pé e da decisão explícita da Diretoria.',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaEnvio.ts', simbolo: 'prepararEnvioMeta' },
      { tipo: 'migration', referencia: 'supabase/migrations/0051_central_meta_delivery.sql' },
    ],
  }),
  g({
    id: 'RATE_LIMIT_EDGE',
    titulo: 'Limite de taxa no webhook',
    prova: 'Regra de taxa na borda (CDN/WAF) na frente de /api/channel/meta/webhook.',
    situacao: 'bloqueado',
    bloqueio: 'Dívida de borda assumida: contador em memória numa função serverless distribuída seria falsa proteção. Tem de ser resolvido antes do primeiro número real em produção.',
    evidencias: [
      { tipo: 'documento', referencia: 'docs/eiff-central.md', simbolo: 'RATE_LIMIT_EDGE' },
      { tipo: 'teste', referencia: 'src/core/central/gate02.test.ts', simbolo: 'RATE_LIMIT_EDGE' },
    ],
  }),

  // -------------------------------------------------------------------------- identidade e autoridade
  g({
    id: 'IDENTIDADE_MODELO',
    titulo: 'Telefone vira pessoa do Control, nunca o nome do WhatsApp',
    prova: 'whatsapp_identity com PENDING/VERIFIED/REVOKED e resolução pelo trio organização + contexto + telefone.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/identidade.ts', simbolo: 'resolverIdentidadeCentral' },
      { tipo: 'migration', referencia: 'supabase/migrations/0049_whatsapp_identity.sql' },
      { tipo: 'teste', referencia: 'src/core/central/identidade.test.ts' },
      { tipo: 'commit', referencia: '2d4f229' },
    ],
  }),
  g({
    id: 'IDENTIDADE_VERIFICACAO',
    titulo: 'Verificação do número é atômica e o código nunca chega em claro no banco',
    prova: 'whatsapp_identity_verify é a única porta para VERIFIED, sob row lock, com teto de tentativas do próprio banco; o servidor manda só o SHA-256.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/identidade.ts', simbolo: 'hashCodigoVerificacao' },
      { tipo: 'migration', referencia: 'supabase/migrations/0049_whatsapp_identity.sql', simbolo: 'whatsapp_identity_verify' },
      { tipo: 'teste', referencia: 'src/core/central/gate02.test.ts' },
      { tipo: 'commit', referencia: '07e8d07' },
    ],
  }),
  g({
    id: 'IDENTIDADE_ONBOARDING',
    titulo: 'Fluxo de cadastro do número para a equipe',
    prova: 'Tela e rotina para pedir, enviar e conferir o código de cada colaborador, com revogação pelo gestor.',
    situacao: 'aberto',
    evidencias: [{ tipo: 'modulo', referencia: 'src/core/central/identidade.ts', simbolo: 'abrirDesafioVerificacao', nota: 'a regra existe; falta o caminho de uso' }],
  }),
  g({
    id: 'AUTORIDADE_SERVIDOR',
    titulo: 'Papel e organização vêm do banco, nunca do payload',
    prova: 'Identidade VERIFIED resolve o usuário real do Dataset, confere organização e estado, e só então consulta a matriz de permissões.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/autoridade.ts', simbolo: 'resolverUsuarioDaCentral' },
      { tipo: 'teste', referencia: 'src/core/central/seguranca.test.ts' },
      { tipo: 'commit', referencia: 'f4c142f' },
    ],
  }),

  // --------------------------------------------------------------------- conversa e orquestracao
  g({
    id: 'CONVERSA_IDEMPOTENTE',
    titulo: 'A Meta reenvia; a Central não duplica',
    prova: 'Dedup por externalMessageId no core e unique no banco: o mesmo evento duas vezes não vira duas mensagens.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/conversa.ts', simbolo: 'chaveMensagem' },
      { tipo: 'migration', referencia: 'supabase/migrations/0050_central_conversation.sql', simbolo: 'central_message_externo_uk' },
      { tipo: 'teste', referencia: 'src/core/central/conversa.test.ts' },
    ],
  }),
  g({
    id: 'ORQUESTRADOR_DETERMINISTICO',
    titulo: 'Intenção por regra, com higiene contra injeção',
    prova: 'Classificação por sinais declarados, confiança mínima, e o texto do WhatsApp tratado como dado (tentativa de instrução é detectada).',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/orquestrador.ts', simbolo: 'higienizarTexto' },
      { tipo: 'teste', referencia: 'src/core/central/orquestrador.test.ts' },
    ],
  }),
  g({
    id: 'PERMISSAO_PELA_ACAO',
    titulo: 'A ação escolhe a permissão — o WhatsApp não cria segunda ACL',
    prova: 'Cada ação do catálogo aponta para uma ação da matriz do Control; a intenção não autoriza nada sozinha.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/tipos.ts', simbolo: 'autorizarAcao' },
      { tipo: 'modulo', referencia: 'src/core/central/permissoes.ts', simbolo: 'autorizar' },
      { tipo: 'teste', referencia: 'src/core/central/permissoes.test.ts' },
      { tipo: 'commit', referencia: 'd952733' },
    ],
  }),

  // ------------------------------------------------------------------------------------- agentes
  g({
    id: 'FINANCE_ADAPTER',
    titulo: 'FINANCE_AGENT é adapter do Diretor Financeiro',
    prova: 'Nenhuma regra financeira reescrita: a leitura do texto e o parecer saem de src/core/cfo.ts.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/agenteFinanceiro.ts', simbolo: 'criarAgenteFinanceiro' },
      { tipo: 'modulo', referencia: 'src/core/cfo.ts', simbolo: 'analisarPagamento' },
      { tipo: 'teste', referencia: 'src/core/central/agenteFinanceiro.test.ts' },
      { tipo: 'commit', referencia: '4a45af8' },
    ],
  }),
  g({
    id: 'ESCRITA_FAIL_CLOSED',
    titulo: 'A Central não grava nada no financeiro',
    prova: 'As portas de escrita recusam com erro próprio em vez de improvisar um ator: a Central responde e propõe, não grava.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/autoridade.ts', simbolo: 'portasSemEscrita' },
      { tipo: 'teste', referencia: 'src/core/central/seguranca.test.ts' },
      { tipo: 'commit', referencia: 'f4c142f' },
    ],
  }),
  g({
    id: 'ESCRITA_SERVIDOR',
    titulo: 'Porta de escrita server-side com ator real',
    prova: 'Execução da ação proposta por caminho de servidor com ator autenticado, sem depender da sessão do navegador, e auditada.',
    situacao: 'bloqueado',
    porDesenho: true,
    bloqueio: 'Fechado de propósito: a única porta de escrita hoje depende da sessão do navegador. Abrir antes disso seria inventar um ator.',
    evidencias: [{ tipo: 'modulo', referencia: 'src/core/central/autoridade.ts', simbolo: 'ExecucaoBloqueadaError' }],
  }),
  g({
    id: 'AGENTES_DEMAIS',
    titulo: 'Compras, obras, estoque, RH e executivo',
    prova: 'Cada agente como adapter do módulo que já existe, no mesmo desenho do FINANCE_AGENT.',
    situacao: 'aberto',
    evidencias: [{ tipo: 'modulo', referencia: 'src/core/central/tipos.ts', simbolo: 'ADAPTERS_PLANEJADOS', nota: 'só contrato, nenhum adapter escrito' }],
  }),

  // --------------------------------------------------------------------------------------- banco
  g({
    id: 'MIGRATIONS_ESCRITAS',
    titulo: 'Migrations da Central escritas com RLS herdada e coerência cross-tenant',
    prova: 'Filho de central_conversation herda a visibilidade do pai, e triggers no banco recusam FK de outra organização.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'migration', referencia: 'supabase/migrations/0049_whatsapp_identity.sql' },
      { tipo: 'migration', referencia: 'supabase/migrations/0050_central_conversation.sql' },
      { tipo: 'migration', referencia: 'supabase/migrations/0051_central_meta_delivery.sql' },
      { tipo: 'teste', referencia: 'src/core/central/gate02.test.ts' },
      { tipo: 'commit', referencia: '07e8d07' },
    ],
  }),
  g({
    id: 'MIGRATIONS_SMOKE_POSTGRES',
    titulo: 'Migrations executadas em Postgres de verdade',
    prova: 'As três migrations aplicam num Postgres descartável, com dez smoke tests A-J e ROLLBACK; a execução pegou um bug que nenhum regex pegaria.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'script', referencia: 'scripts/pg-smoke-central.mjs' },
      { tipo: 'commit', referencia: '00a3405' },
    ],
  }),
  g({
    id: 'MIGRATIONS_APLICADAS',
    titulo: 'Migrations 0049, 0050 e 0051 aplicadas em produção',
    prova: 'As três aplicadas no projeto do Supabase, com backup prévio verificado, envelope transacional, POST-CHECK de cada uma e validação global batendo em todos os valores esperados; numeração registrada no CLAUDE.md.',
    situacao: 'fechado',
    // Fechado com evidencia REAL (11/09/2026): o registro da aplicacao em producao, com os valores do POST-CHECK e da
    // validacao global, esta na secao 11 do runbook. Codigo e preflight sozinhos nunca fechariam este gate.
    evidencias: [
      { tipo: 'documento', referencia: 'docs/central-db-release.md', simbolo: 'Registro de aplicação', nota: 'aplicação em produção em 11/09/2026: apply exit 0 nas três, POST-CHECK e validação global da seção 6 verdes' },
      { tipo: 'migration', referencia: 'supabase/migrations/0049_whatsapp_identity.sql' },
      { tipo: 'migration', referencia: 'supabase/migrations/0050_central_conversation.sql' },
      { tipo: 'migration', referencia: 'supabase/migrations/0051_central_meta_delivery.sql' },
      { tipo: 'script', referencia: 'scripts/pg-preflight-central.mjs', nota: 'preflight 51/51 antes da aplicação' },
    ],
  }),
  g({
    id: 'AUDITORIA_CENTRAL',
    titulo: 'Ponte de auditoria da ação do agente',
    prova: 'Toda ação proposta e executada pela Central entra em audit_log com ator, antes e depois (migration 0052, reservada).',
    situacao: 'aberto',
    evidencias: [{ tipo: 'documento', referencia: 'CENTRAL_PARALLEL_PLAN.md', simbolo: '0052' }],
  }),

  // ------------------------------------------------------------------------ seguranca e operacao
  g({
    id: 'THREAT_MODEL',
    titulo: 'Modelo de ameaças escrito e testado',
    prova: 'Ameaças enumeradas em documento e presas por teste executável, não por promessa.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'documento', referencia: 'docs/central-threat-model.md' },
      { tipo: 'teste', referencia: 'src/core/central/seguranca.test.ts' },
      { tipo: 'commit', referencia: 'd6009e8' },
    ],
  }),
  g({
    id: 'SEGREDOS_SERVIDOR',
    titulo: 'Segredo só no servidor, telefone mascarado em toda saída',
    prova: 'Variáveis META_* nunca com prefixo VITE_, e o sanitizador corta token e telefone antes de qualquer log ou resposta.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/metaServidor.ts', simbolo: 'seguroMeta' },
      { tipo: 'teste', referencia: 'src/core/central/seguranca.test.ts' },
    ],
  }),
  g({
    id: 'E2E_ALPHA',
    titulo: 'Caminho ponta a ponta do Alpha interno provado',
    prova: 'Uma mensagem entra pelo webhook e sai como resposta do motor, com identidade, conversa, orquestrador, agente e permissão encadeados num teste só. Resposta gerada, não enviada; nada gravado (portasSemEscrita).',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/fluxoInterno.ts', simbolo: 'fluxoInterno' },
      { tipo: 'teste', referencia: 'src/core/central/fluxoInterno.test.ts' },
      { tipo: 'commit', referencia: '146e5bd' },
    ],
  }),
  g({
    id: 'CENTRAL_WIRING',
    titulo: 'Webhook ligado ao caminho contínuo (CENTRAL_ALPHA_MODE)',
    prova: 'channel-meta-webhook.ts chama fluxoInterno atrás do interruptor CENTRAL_ALPHA_MODE (off por padrão), com contexto de servidor real: organização pelo número que recebeu, identidades e Dataset carregados server-side, inbound persistido em central_*. Hoje o webhook valida a assinatura, conta os eventos e descarta o payload.',
    situacao: 'aberto',
    evidencias: [
      { tipo: 'funcao', referencia: 'netlify/functions/channel-meta-webhook.ts' },
      { tipo: 'modulo', referencia: 'src/core/central/fluxoInterno.ts', simbolo: 'fluxoInterno' },
    ],
  }),
  g({
    id: 'CENTRAL_INBOUND_PERSISTENCE',
    titulo: 'Conteúdo inbound e trilha de processamento no banco (migration 0052)',
    prova: 'central_message_content (texto normalizado, só inbound, imutável, uma linha por mensagem) e central_message_processing (linha tipada por rodada, can_execute e sent presos em false, um CONCLUIDO de webhook por mensagem) APLICADAS em produção, com o registro no runbook. Migration escrita e provada num Postgres descartável não é migration aplicada.',
    situacao: 'aberto',
    evidencias: [
      { tipo: 'migration', referencia: 'supabase/migrations/0052_central_inbound_content.sql', nota: 'só em código: NÃO aplicada em produção' },
      { tipo: 'script', referencia: 'scripts/pg-smoke-central.mjs', simbolo: '0052_central_inbound_content.sql', nota: 'smoke K–U e preflight 0001..0052' },
    ],
  }),
  g({
    id: 'CENTRAL_CONTENT_RETENTION_POLICY',
    titulo: 'Política de retenção do conteúdo inbound',
    prova: 'Prazo e critério de purga do texto em central_message_content decididos pelo proprietário e executados server-side por DELETE (mensagem e trilha ficam). Dívida explícita da Wave 03: o Alpha controlado anda sem ela; o rollout amplo da equipe, não.',
    situacao: 'aberto',
    evidencias: [{ tipo: 'documento', referencia: 'WAVE03_PLAN.md', simbolo: 'CENTRAL_CONTENT_RETENTION_POLICY' }],
  }),
  g({
    id: 'MISSION_CONTROL_LIVE',
    titulo: 'Mission Control em tempo real',
    prova: 'Endpoint server-side de development-status com adapter do GitHub: SHA de main ao vivo, status do CI, branches/workstreams, última atualização e polling controlado. Hoje o painel é um SNAPSHOT derivado do código no momento do build.',
    situacao: 'aberto',
    // o codigo existe (F4, Wave 03): adapter read-only, /api/development-status e a regra LIVE x SNAPSHOT. O gate
    // so fecha quando a fonte estiver acessivel, autorizada e fresca DE VERDADE (token D3 no ambiente + leitura
    // LIVE demonstrada) — invariante 10: codigo no repositorio nao torna a interface ao vivo.
    bloqueio: undefined,
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/githubAdapter.ts', simbolo: 'tratarDevelopmentStatus' },
      { tipo: 'modulo', referencia: 'src/core/central/statusVivo.ts', simbolo: 'modoDoStatus' },
      { tipo: 'funcao', referencia: 'netlify/functions/development-status.ts' },
      { tipo: 'teste', referencia: 'src/core/central/statusVivo.test.ts' },
      { tipo: 'documento', referencia: 'docs/eiff-central.md', simbolo: 'MISSION_CONTROL_LIVE', nota: 'falta: GITHUB_READ_TOKEN no Netlify e uma leitura LIVE comprovada' },
    ],
  }),
  g({
    id: 'OBSERVABILIDADE',
    titulo: 'Painel executivo do estado da construção',
    prova: 'Prontidão derivada de gates com evidência verificável, sem porcentagem digitada à mão.',
    situacao: 'fechado',
    evidencias: [
      { tipo: 'modulo', referencia: 'src/core/central/missionControl.ts', simbolo: 'prontidaoDoSistema' },
      { tipo: 'teste', referencia: 'src/core/central/missionControl.test.ts' },
    ],
  }),
  g({
    id: 'OPERACAO_MONITORADA',
    titulo: 'Operação com alerta e plano de queda',
    prova: 'Alerta de falha do webhook, de fila parada e de queda do provider, com responsável e rota de retorno.',
    situacao: 'aberto',
    evidencias: [],
  }),
  g({
    id: 'CONTEXTO_EXTERNO',
    titulo: 'Número comercial para cliente e parceiro',
    prova: 'Segundo número em EXTERNAL, sem misturar com a conversa interna, e com a regra de comunicação do Radar valendo.',
    situacao: 'aberto',
    evidencias: [{ tipo: 'documento', referencia: 'docs/eiff-central.md', simbolo: 'EIFF_COMMERCIAL_PHONE_NUMBER_ID' }],
  }),
];

const POR_ID = new Map(GATES.map((x) => [x.id, x]));
export const gatePorId = (id: string): Gate | undefined => POR_ID.get(id);
export const gatesPorId = (ids: string[]): Gate[] => ids.map((i) => POR_ID.get(i)).filter((x): x is Gate => !!x);

// ------------------------------------------------------------------------------------ prontidao

export interface Prontidao {
  exigidos: number;
  fechados: number;
  abertos: number;
  bloqueados: number;
  /** 0..1 — SEMPRE fechados / exigidos; nunca um numero digitado */
  fracao: number;
  pronto: boolean;
  /** os gates que ainda faltam, na ordem declarada */
  faltando: Gate[];
  /** a conta, para a tela poder mostrar de onde veio o numero */
  conta: string;
}

/** Unica funcao que produz numero de prontidao no sistema. Toda tela e todo bloco passam por aqui. */
export function prontidao(ids: string[]): Prontidao {
  const gs = gatesPorId(ids);
  const fechados = gs.filter((x) => x.situacao === 'fechado');
  const bloqueados = gs.filter((x) => x.situacao === 'bloqueado');
  const abertos = gs.filter((x) => x.situacao === 'aberto');
  const exigidos = gs.length;
  return {
    exigidos,
    fechados: fechados.length,
    abertos: abertos.length,
    bloqueados: bloqueados.length,
    fracao: exigidos === 0 ? 0 : fechados.length / exigidos,
    pronto: exigidos > 0 && fechados.length === exigidos,
    faltando: gs.filter((x) => x.situacao !== 'fechado'),
    conta: `${fechados.length} de ${exigidos} gates fechados`,
  };
}

export const prontidaoDoSistema = (): Prontidao => prontidao(GATES.map((x) => x.id));

// -------------------------------------------------------------------------------- workstreams

export interface Workstream {
  id: string;
  titulo: string;
  responsavel: string;
  onda: string;
  foco: string;
  gates: string[];
}

export const WORKSTREAMS: Workstream[] = [
  { id: 'CANAL', titulo: 'Canal Meta Cloud', responsavel: 'Agent Meta', onda: 'Onda 01', foco: 'Entrada e saída pelo WhatsApp oficial, com o envio fechado.', gates: ['META_PROVIDER_READONLY', 'META_WEBHOOK_ASSINADO', 'META_EVENTO_NORMALIZADO', 'META_CONTEXTO_NUMERO', 'ENVIO_FAIL_CLOSED', 'ENVIO_CANARY_LIBERADO', 'META_NUMERO_PRODUCAO'] },
  { id: 'NUCLEO', titulo: 'Núcleo da Central', responsavel: 'Agent Central Core', onda: 'Onda 01', foco: 'Quem está falando, o que está pedindo e quem autoriza.', gates: ['IDENTIDADE_MODELO', 'IDENTIDADE_VERIFICACAO', 'IDENTIDADE_ONBOARDING', 'AUTORIDADE_SERVIDOR', 'CONVERSA_IDEMPOTENTE', 'ORQUESTRADOR_DETERMINISTICO', 'PERMISSAO_PELA_ACAO'] },
  { id: 'AGENTES', titulo: 'Agentes de domínio', responsavel: 'Agent Finance', onda: 'Onda 01', foco: 'Adapter sobre o motor que já existe; propor não é executar.', gates: ['FINANCE_ADAPTER', 'ESCRITA_FAIL_CLOSED', 'ESCRITA_SERVIDOR', 'AGENTES_DEMAIS'] },
  { id: 'SEGURANCA', titulo: 'Segurança e operação', responsavel: 'Agent QA', onda: 'Onda 01', foco: 'Ameaças presas por teste, segredo no servidor, borda protegida.', gates: ['THREAT_MODEL', 'SEGREDOS_SERVIDOR', 'RATE_LIMIT_EDGE', 'OPERACAO_MONITORADA', 'CENTRAL_CONTENT_RETENTION_POLICY'] },
  { id: 'BANCO', titulo: 'Banco da Central', responsavel: 'Agent DB Release', onda: 'Wave 02', foco: 'Levar 0049, 0050 e 0051 ao banco real, com preflight; depois a 0052.', gates: ['MIGRATIONS_ESCRITAS', 'MIGRATIONS_SMOKE_POSTGRES', 'MIGRATIONS_APLICADAS', 'AUDITORIA_CENTRAL', 'CENTRAL_INBOUND_PERSISTENCE'] },
  { id: 'ALPHA', titulo: 'Alpha ponta a ponta', responsavel: 'Agent Alpha E2E', onda: 'Wave 02', foco: 'Uma mensagem atravessando todas as fronteiras num teste só.', gates: ['E2E_ALPHA', 'CONTEXTO_EXTERNO', 'CENTRAL_WIRING'] },
  { id: 'OBSERVABILIDADE', titulo: 'Mission Control', responsavel: 'Agent Observability', onda: 'Wave 02', foco: 'O estado da construção legível em dez segundos.', gates: ['OBSERVABILIDADE', 'MISSION_CONTROL_LIVE'] },
];

export const prontidaoDoWorkstream = (w: Workstream): Prontidao => prontidao(w.gates);

// ------------------------------------------------------------------------------------- marcos

export interface Marco {
  id: string;
  titulo: string;
  objetivo: string;
  gates: string[];
}

export const MARCOS: Marco[] = [
  { id: 'M1_CANAL', titulo: 'Canal confiável', objetivo: 'A EIFF recebe mensagem do WhatsApp oficial sem confiar em nada que o remetente diga.', gates: ['META_PROVIDER_READONLY', 'META_WEBHOOK_ASSINADO', 'META_EVENTO_NORMALIZADO', 'META_CONTEXTO_NUMERO'] },
  { id: 'M2_NUCLEO', titulo: 'Núcleo da Central', objetivo: 'Identidade, conversa, intenção e permissão resolvidos por regra determinística.', gates: ['IDENTIDADE_MODELO', 'IDENTIDADE_VERIFICACAO', 'AUTORIDADE_SERVIDOR', 'CONVERSA_IDEMPOTENTE', 'ORQUESTRADOR_DETERMINISTICO', 'PERMISSAO_PELA_ACAO', 'FINANCE_ADAPTER'] },
  { id: 'M3_BANCO', titulo: 'Central com banco', objetivo: 'A conversa e a identidade passam a existir no banco da EIFF.', gates: ['MIGRATIONS_ESCRITAS', 'MIGRATIONS_SMOKE_POSTGRES', 'MIGRATIONS_APLICADAS'] },
  { id: 'M4_ALPHA', titulo: 'Alpha interno em pé', objetivo: 'Uma pessoa conversa com a Central e recebe o parecer do motor, sem a Central gravar nada de negócio.', gates: ['MIGRATIONS_APLICADAS', 'E2E_ALPHA', 'OBSERVABILIDADE', 'THREAT_MODEL', 'SEGREDOS_SERVIDOR', 'ESCRITA_FAIL_CLOSED', 'CENTRAL_INBOUND_PERSISTENCE', 'CENTRAL_WIRING'] },
  { id: 'M5_RESPOSTA', titulo: 'A Central responde', objetivo: 'A resposta volta pelo WhatsApp, atrás de modo, allowlist e borda protegida.', gates: ['ENVIO_FAIL_CLOSED', 'ENVIO_CANARY_LIBERADO', 'META_NUMERO_PRODUCAO', 'RATE_LIMIT_EDGE', 'IDENTIDADE_ONBOARDING'] },
  { id: 'M6_ACAO', titulo: 'A Central age', objetivo: 'A previsão entra no sistema pelo servidor, com ator real e auditoria.', gates: ['ESCRITA_FAIL_CLOSED', 'ESCRITA_SERVIDOR', 'AUDITORIA_CENTRAL', 'AGENTES_DEMAIS'] },
];

export const prontidaoDoMarco = (m: Marco): Prontidao => prontidao(m.gates);
export const proximoMarco = (): Marco | undefined => MARCOS.find((m) => !prontidaoDoMarco(m).pronto);

// --------------------------------------------------------------------------- release ladder

export interface Degrau {
  id: string;
  titulo: string;
  publico: string;
  oQueMuda: string;
  /** gates NOVOS deste degrau; os degraus anteriores entram por acumulacao */
  novos: string[];
}

export const DEGRAUS: Degrau[] = [
  {
    id: 'ALPHA',
    titulo: 'Alpha interno',
    publico: 'Uma pessoa (Diretoria), um número',
    oQueMuda: 'A Central lê, entende e responde pelo painel. Nada é enviado e nada é gravado.',
    novos: ['META_PROVIDER_READONLY', 'META_WEBHOOK_ASSINADO', 'META_EVENTO_NORMALIZADO', 'META_CONTEXTO_NUMERO', 'ENVIO_FAIL_CLOSED', 'IDENTIDADE_MODELO', 'IDENTIDADE_VERIFICACAO', 'AUTORIDADE_SERVIDOR', 'CONVERSA_IDEMPOTENTE', 'ORQUESTRADOR_DETERMINISTICO', 'PERMISSAO_PELA_ACAO', 'FINANCE_ADAPTER', 'ESCRITA_FAIL_CLOSED', 'MIGRATIONS_ESCRITAS', 'MIGRATIONS_SMOKE_POSTGRES', 'MIGRATIONS_APLICADAS', 'THREAT_MODEL', 'SEGREDOS_SERVIDOR', 'E2E_ALPHA', 'OBSERVABILIDADE', 'CENTRAL_INBOUND_PERSISTENCE', 'CENTRAL_WIRING'],
  },
  {
    id: 'PILOT',
    titulo: 'Piloto',
    publico: 'Duas ou três pessoas escolhidas',
    oQueMuda: 'A resposta volta pelo WhatsApp, só para números da allowlist.',
    // MISSION_CONTROL_LIVE entra aqui, nao no Alpha: o painel ao vivo importa quando mais de uma pessoa acompanha
    novos: ['META_NUMERO_PRODUCAO', 'ENVIO_CANARY_LIBERADO', 'RATE_LIMIT_EDGE', 'IDENTIDADE_ONBOARDING', 'MISSION_CONTROL_LIVE'],
  },
  {
    id: 'TEAM_BETA',
    titulo: 'Beta da equipe',
    publico: 'Equipe interna inteira',
    oQueMuda: 'A Central registra a previsão pelo servidor, e os demais domínios entram.',
    novos: ['ESCRITA_SERVIDOR', 'AUDITORIA_CENTRAL', 'AGENTES_DEMAIS', 'CENTRAL_CONTENT_RETENTION_POLICY'],
  },
  {
    id: 'PRODUCTION',
    titulo: 'Produção',
    publico: 'Equipe interna e, no número comercial, cliente e parceiro',
    oQueMuda: 'Operação monitorada, com plano de queda, e o contexto externo aberto.',
    novos: ['OPERACAO_MONITORADA', 'CONTEXTO_EXTERNO'],
  },
];

/** Gates de um degrau: os dele mais todos os anteriores (a escada e cumulativa por construcao). */
export function gatesDoDegrau(id: string): string[] {
  const i = DEGRAUS.findIndex((d) => d.id === id);
  if (i < 0) return [];
  const vistos = new Set<string>();
  for (const d of DEGRAUS.slice(0, i + 1)) for (const x of d.novos) vistos.add(x);
  return [...vistos];
}

export const prontidaoDoDegrau = (d: Degrau): Prontidao => prontidao(gatesDoDegrau(d.id));
export const proximoDegrau = (): Degrau | undefined => DEGRAUS.find((d) => !prontidaoDoDegrau(d).pronto);
export function degrauAtual(): Degrau | undefined {
  let atual: Degrau | undefined;
  for (const d of DEGRAUS) { if (prontidaoDoDegrau(d).pronto) atual = d; else break; }
  return atual;
}

// ---------------------------------------------------------------------------------- bloqueios

export interface Bloqueios { porDesenho: Gate[]; reais: Gate[] }

/** Bloqueio por desenho e seguranca intencional; bloqueio real e o que precisa de decisao ou trabalho. */
export function bloqueios(): Bloqueios {
  const b = GATES.filter((x) => x.situacao === 'bloqueado');
  return { porDesenho: b.filter((x) => x.porDesenho === true), reais: b.filter((x) => x.porDesenho !== true) };
}

// ---------------------------------------------------------------------- arquitetura (camadas)

export interface CamadaArquitetura {
  id: string;
  titulo: string;
  papel: string;
  gates: string[];
}

export const CAMADAS: CamadaArquitetura[] = [
  { id: 'META', titulo: 'Meta WhatsApp Cloud', papel: 'Provider oficial do canal. Server-only, sem chave no navegador.', gates: ['META_PROVIDER_READONLY', 'META_NUMERO_PRODUCAO', 'ENVIO_FAIL_CLOSED', 'ENVIO_CANARY_LIBERADO'] },
  { id: 'WEBHOOK', titulo: 'Webhook assinado', papel: 'Valida a assinatura antes de ler, normaliza e descarta o bruto.', gates: ['META_WEBHOOK_ASSINADO', 'META_EVENTO_NORMALIZADO', 'RATE_LIMIT_EDGE', 'CENTRAL_WIRING'] },
  { id: 'IDENTIDADE', titulo: 'Contexto e identidade', papel: 'De quem é este número, e em qual contexto ele fala.', gates: ['META_CONTEXTO_NUMERO', 'IDENTIDADE_MODELO', 'IDENTIDADE_VERIFICACAO', 'IDENTIDADE_ONBOARDING'] },
  { id: 'CONVERSA', titulo: 'Conversa', papel: 'Uma conversa por pessoa e contexto, sem duplicar mensagem.', gates: ['CONVERSA_IDEMPOTENTE', 'MIGRATIONS_ESCRITAS', 'MIGRATIONS_SMOKE_POSTGRES', 'MIGRATIONS_APLICADAS', 'CENTRAL_INBOUND_PERSISTENCE'] },
  { id: 'ORQUESTRADOR', titulo: 'Orquestrador', papel: 'Intenção, agente alvo e a permissão exigida pela ação.', gates: ['ORQUESTRADOR_DETERMINISTICO', 'PERMISSAO_PELA_ACAO', 'AUTORIDADE_SERVIDOR'] },
  { id: 'AGENTES', titulo: 'Agentes de domínio', papel: 'Interpretam e PROPÕEM; quem decide é o motor.', gates: ['FINANCE_ADAPTER', 'AGENTES_DEMAIS', 'CONTEXTO_EXTERNO'] },
  { id: 'CONTROL', titulo: 'EIFF Control', papel: 'Motor determinístico, matriz de permissões e execução.', gates: ['ESCRITA_FAIL_CLOSED', 'ESCRITA_SERVIDOR'] },
  { id: 'AUDITORIA', titulo: 'Auditoria e operação', papel: 'Registra, vigia e mostra o estado.', gates: ['AUDITORIA_CENTRAL', 'THREAT_MODEL', 'SEGREDOS_SERVIDOR', 'OPERACAO_MONITORADA', 'E2E_ALPHA', 'OBSERVABILIDADE', 'MISSION_CONTROL_LIVE', 'CENTRAL_CONTENT_RETENTION_POLICY'] },
];

export const prontidaoDaCamada = (c: CamadaArquitetura): Prontidao => prontidao(c.gates);

// --------------------------------------------------------------------------- linha do tempo

export const SITUACOES_ONDA = ['concluida', 'em_andamento', 'planejada'] as const;
export type SituacaoOnda = (typeof SITUACOES_ONDA)[number];

export interface Onda {
  id: string;
  titulo: string;
  quando: string;
  situacao: SituacaoOnda;
  commit?: string;
  entregas: string[];
}

export const ONDAS: Onda[] = [
  {
    id: 'CENTRAL_01', titulo: 'EIFF Central 01 — fundação', quando: '2026-09-10', situacao: 'concluida', commit: '3ceb71d',
    entregas: ['Provider Meta Cloud somente leitura (saúde do número e templates).', 'Webhook com assinatura X-Hub-Signature-256 validada antes do parse.', 'Normalização Graph API para ChannelInboundEvent, com a fronteira presa por teste.', 'Contextos INTERNAL e EXTERNAL pelo número que recebeu.', 'Contratos congelados de identidade, orquestrador, agente, conversa e inbox.'],
  },
  {
    id: 'ONDA_PARALELA', titulo: 'Onda paralela — cinco frentes', quando: '2026-09-10', situacao: 'concluida', commit: '95c4fab',
    entregas: ['Caminho de envio da Meta implementado e fechado (migration 0051), nada enviado.', 'Central Core: identidade, conversa idempotente, orquestrador determinístico e ponte de permissões (0049 e 0050).', 'FINANCE_AGENT como adapter do Diretor Financeiro, sem reescrever regra financeira.', 'Threat model e testes de segurança da Central.', 'ADR do Chatwoot: inbox humana opcional, nunca o cérebro.'],
  },
  {
    id: 'STABILIZATION_01', titulo: 'Stabilization Gate 01', quando: '2026-09-10', situacao: 'concluida', commit: 'f4c142f',
    entregas: ['Confidencialidade financeira fail-closed: ver caixa passou a ser argumento obrigatório.', 'Autoridade server-side: papel e organização sempre do banco, nunca do payload.', 'Segregação de funções na decisão de previsão; quem pede não decide.', 'Acesso entre organizações fechado na resolução de identidade.', 'Onze testes pendentes viraram teste executável.'],
  },
  {
    id: 'GATE_02', titulo: 'Pre-Merge Gate 02 — review externo', quando: '2026-09-11', situacao: 'concluida', commit: '07e8d07',
    entregas: ['RLS dos filhos de central_conversation herdada do pai, escrita uma vez só.', 'Coerência cross-tenant das FKs por trigger no banco, além da validação nas RPCs.', 'Verificação do código atômica: whatsapp_identity_verify virou a única porta para VERIFIED.', 'Teto de corpo do webhook antes da leitura; limite de taxa assumido como dívida de borda.'],
  },
  {
    id: 'GATE_03', titulo: 'Pre-Merge Gate 03 — execução real', quando: '2026-09-11', situacao: 'concluida', commit: '00a3405',
    entregas: ['As três migrations aplicadas num Postgres de verdade, com dez smoke tests A-J e ROLLBACK.', 'Delimitadores quebrados em três funções corrigidos: as migrations não eram aplicáveis.', 'Bug de trigger que nenhum regex pegaria (campo inexistente em central_message) corrigido.', 'Harness versionado em scripts/pg-smoke-central.mjs para a próxima pessoa rodar.'],
  },
  {
    id: 'MERGE', titulo: 'Merge da onda em main', quando: '2026-09-11', situacao: 'concluida', commit: 'c698f67',
    entregas: ['Código da Central integrado em main. Nenhuma migration aplicada em produção, nada enviado.'],
  },
  {
    id: 'WAVE_02', titulo: 'Wave 02 — Mission Control, Alpha E2E, DB Release e Quality Gate', quando: '2026-09-11', situacao: 'concluida', commit: 'ab642be',
    entregas: ['Mission Control: prontidão derivada de gates com evidência verificável, atrás de ver_mission_control.', 'Alpha E2E: uma mensagem atravessando todas as fronteiras num teste só, sem escrita.', 'DB Release preflight: a fila inteira de migrations num Postgres descartável.', 'Quality Gate no GitHub Actions: testes, lint, build, smoke e preflight por exit code.'],
  },
  {
    id: 'WAVE_03', titulo: 'Wave 03 — em andamento', quando: '2026-09-11', situacao: 'em_andamento',
    entregas: ['F1: 0049, 0050 e 0051 aplicadas em produção com backup e envelope transacional.', 'F4: Mission Control ao vivo (adapter GitHub read-only), gate LIVE ainda aberto.', 'F2: webhook ligado ao caminho contínuo atrás de CENTRAL_ALPHA_MODE (off), inbound persistido (0052 só em código).', 'F3: cadastro e verificação do número da equipe. F2R: reprocessar parecer, read-only. F5: QA da wave.'],
  },
  {
    id: 'ALPHA_ONDA', titulo: 'Alpha interno', quando: 'a seguir', situacao: 'planejada',
    entregas: ['Número real da Meta configurado e verificado.', 'Uma pessoa conversando com a Central, sem envio e sem escrita.'],
  },
];

// ------------------------------------------------------------------------------- beneficios

export interface Beneficio {
  id: string;
  titulo: string;
  quem: string;
  gates: string[];
}

export const BENEFICIOS: Beneficio[] = [
  { id: 'QUEM_FALA', titulo: 'A EIFF sabe quem está falando', quem: 'Toda a empresa', gates: ['IDENTIDADE_MODELO', 'IDENTIDADE_VERIFICACAO', 'META_CONTEXTO_NUMERO'] },
  { id: 'SEM_DUPLICATA', titulo: 'Mensagem repetida não vira dois pedidos', quem: 'Financeiro', gates: ['CONVERSA_IDEMPOTENTE'] },
  { id: 'UMA_ACL', titulo: 'O WhatsApp não cria uma segunda lista de permissões', quem: 'Diretoria', gates: ['PERMISSAO_PELA_ACAO', 'AUTORIDADE_SERVIDOR'] },
  { id: 'PARECER', titulo: 'Parecer de caixa sem reescrever regra financeira', quem: 'Diretoria e Financeiro', gates: ['FINANCE_ADAPTER', 'ESCRITA_FAIL_CLOSED'] },
  { id: 'NADA_SAI', titulo: 'Nada sai por engano enquanto o piloto não abre', quem: 'Diretoria', gates: ['ENVIO_FAIL_CLOSED'] },
  { id: 'CONVERSA_GUARDADA', titulo: 'A conversa fica registrada no banco da EIFF', quem: 'Auditoria', gates: ['MIGRATIONS_APLICADAS'] },
  { id: 'PEDIR_PELO_ZAP', titulo: 'Pedir pagamento pelo WhatsApp e receber o parecer', quem: 'Equipe de obra e fábrica', gates: ['META_NUMERO_PRODUCAO', 'ENVIO_CANARY_LIBERADO', 'FINANCE_ADAPTER', 'E2E_ALPHA'] },
  { id: 'PREVISAO_SOZINHA', titulo: 'A previsão entra no sistema sem ninguém digitar', quem: 'Financeiro', gates: ['ESCRITA_SERVIDOR', 'AUDITORIA_CENTRAL'] },
  { id: 'OUTROS_DOMINIOS', titulo: 'Compras, obras e estoque pelo mesmo número', quem: 'Toda a empresa', gates: ['AGENTES_DEMAIS'] },
  { id: 'CLIENTE', titulo: 'Cliente fala com a EIFF Comercial', quem: 'Comercial', gates: ['CONTEXTO_EXTERNO'] },
];

export const beneficioDesbloqueado = (b: Beneficio): boolean => prontidao(b.gates).pronto;

// ------------------------------------------------------------------------------------ resumo

export interface ResumoMissionControl {
  sistema: Prontidao;
  degrauAtual?: Degrau;
  proximoDegrau?: Degrau;
  prontidaoProximoDegrau?: Prontidao;
  proximoMarco?: Marco;
  prontidaoProximoMarco?: Prontidao;
  bloqueiosReais: Gate[];
  bloqueiosPorDesenho: Gate[];
  beneficiosAtivos: number;
  beneficiosTotal: number;
  /** a frase de dez segundos: o que falta para o proximo degrau */
  faltaPara: string;
}

export function resumoMissionControl(): ResumoMissionControl {
  const prox = proximoDegrau();
  const marco = proximoMarco();
  const b = bloqueios();
  const pd = prox ? prontidaoDoDegrau(prox) : undefined;
  return {
    sistema: prontidaoDoSistema(),
    degrauAtual: degrauAtual(),
    proximoDegrau: prox,
    prontidaoProximoDegrau: pd,
    proximoMarco: marco,
    prontidaoProximoMarco: marco ? prontidaoDoMarco(marco) : undefined,
    bloqueiosReais: b.reais,
    bloqueiosPorDesenho: b.porDesenho,
    beneficiosAtivos: BENEFICIOS.filter(beneficioDesbloqueado).length,
    beneficiosTotal: BENEFICIOS.length,
    faltaPara: !prox || !pd
      ? 'Todos os degraus estão liberados.'
      : pd.faltando.length === 1
        ? `Falta 1 gate para ${prox.titulo}: ${pd.faltando[0].titulo}.`
        : `Faltam ${pd.faltando.length} gates para ${prox.titulo}: ${pd.faltando.map((x) => x.titulo).join('; ')}.`,
  };
}

/** Formata a fracao como porcentagem inteira. Existe um lugar so que vira numero em texto. */
export const pctGates = (p: Prontidao): string => `${Math.round(p.fracao * 100)}%`;
