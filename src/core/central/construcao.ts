// Central de Construção (MC-CONSTRUCTION-1) — projeção PURA dos módulos que compõem o EIFF.
//
// Responde, em dez segundos: o que compõe o EIFF, o que já foi construído, o que está sendo construído agora,
// o que ainda é plano, o que está bloqueado, quais tarefas pertencem a cada módulo e qual é o próximo passo.
//
// Regras que este módulo existe para garantir (cada uma tem teste em construcao.test.ts):
//   1. NENHUM módulo é inventado: todo módulo aponta para evidência concreta no repositório (arquivo, símbolo ou
//      gate do catálogo) e o teste abre o arquivo citado. Módulo sem evidência nem gate cai em SEM_EVIDENCIA.
//   2. NENHUM percentual é digitado: o progresso do módulo é `concluídos/total` de componentes, e o estado de cada
//      componente vem de gate (prontidão) ou de evidência — nunca de estimativa.
//   3. Estado é vocabulário FECHADO (`ESTADOS_CONSTRUCAO`); a tela não cria string solta de status.
//   4. Task → módulo só por relação SEGURA do contrato (`workstreamId` ou `gateIds` do item). Nunca por título,
//      nome parecido ou palpite. Sem relação, a tarefa continua visível como "Módulo não informado".
//   5. Módulo sem dado vivo NÃO desaparece: o catálogo é SNAPSHOT do repositório e existe sem a leitura remota.
//   6. Erro de fonte não vira zero: sem leitura, as contagens de tarefas são `null`, nunca 0.
//   7. O Mission Control continua observador: zero fetch, zero store, zero React, zero escrita.
import { GATES, WORKSTREAMS, gatePorId, prontidao, type Evidencia, type Gate, type Prontidao } from './missionControl';
import { MC_STATUS, type McFonte, type McStatus, type MissionControlWorkItem, type Procedencia } from './workItem';

// ------------------------------------------------------------------------------------------------ vocabulário

export const DOMINIOS_CONSTRUCAO = ['GESTAO', 'COMERCIAL', 'CENTRAL', 'DESENVOLVIMENTO'] as const;
export type DominioConstrucao = (typeof DOMINIOS_CONSTRUCAO)[number];

export const ROTULO_DOMINIO_CONSTRUCAO: Readonly<Record<DominioConstrucao, string>> = {
  GESTAO: 'Gestão da EIFF',
  COMERCIAL: 'Máquina Comercial',
  CENTRAL: 'EIFF Central',
  DESENVOLVIMENTO: 'Construção e fábrica',
};

/** Vocabulário fechado de estado. A UI só conhece estes cinco; nenhum outro texto de estado nasce fora daqui. */
export const ESTADOS_CONSTRUCAO = ['CONCLUIDO', 'EM_CONSTRUCAO', 'PLANEJADO', 'BLOQUEADO', 'SEM_EVIDENCIA'] as const;
export type EstadoConstrucao = (typeof ESTADOS_CONSTRUCAO)[number];

export const ROTULO_ESTADO_CONSTRUCAO: Readonly<Record<EstadoConstrucao, string>> = {
  CONCLUIDO: 'Concluído',
  EM_CONSTRUCAO: 'Em construção',
  PLANEJADO: 'Planejado',
  BLOQUEADO: 'Bloqueado',
  SEM_EVIDENCIA: 'Sem evidência',
};

/** Token de cor do sistema visual; nunca usado sem o rótulo ao lado. */
export const TONE_ESTADO_CONSTRUCAO: Readonly<Record<EstadoConstrucao, 'ok' | 'warn' | 'bad' | 'info' | 'muted'>> = {
  CONCLUIDO: 'ok', EM_CONSTRUCAO: 'warn', PLANEJADO: 'muted', BLOQUEADO: 'bad', SEM_EVIDENCIA: 'info',
};

/**
 * NATUREZA da evidência de um componente — o que a prova prova. NÃO é estado nem máquina de estados: o estado continua
 * sendo o vocabulário fechado acima. Serve para não confundir degraus de maturidade:
 *   CODIGO     — existe no repositório (módulo, teste, migration escrita)
 *   INTEGRACAO — está ligado ao resto do sistema na main (webhook chama, store usa, tela mostra)
 *   PRODUCAO   — foi aplicado/exercitado em produção, registrado em documento integrado (nunca provado por código)
 *   OPERACAO   — funciona com uso real (tráfego de verdade, pessoas usando); prova de produção controlada NÃO vale aqui
 */
export const NATUREZAS_EVIDENCIA = ['CODIGO', 'INTEGRACAO', 'PRODUCAO', 'OPERACAO'] as const;
export type NaturezaEvidencia = (typeof NATUREZAS_EVIDENCIA)[number];

export const ROTULO_NATUREZA: Readonly<Record<NaturezaEvidencia, string>> = {
  CODIGO: 'código', INTEGRACAO: 'integrado', PRODUCAO: 'produção', OPERACAO: 'operação real',
};

/** Os status do quadro que significam "está acontecendo agora" — os mesmos MC_STATUS, sem segundo vocabulário. */
export const STATUS_ATIVOS: readonly McStatus[] = ['EXECUTANDO', 'EM_VALIDACAO', 'AGUARDANDO_HUMANO', 'BLOQUEADO'];

/** O que a tela diz quando a fonte não informa a que módulo a tarefa pertence. Existe um lugar só para a frase. */
export const SEM_MODULO = 'Módulo não informado';

// --------------------------------------------------------------------------------------------------- modelo

/**
 * Evidência da Central. `secao` é a AUTORIDADE DO ESTADO ATUAL: o título exato (linha inteira, com os `#`) da seção de
 * um documento integrado onde o símbolo tem de estar. Obrigatória para estado operacional mutável (produção, operação,
 * configuração, flags, credenciais): uma frase antiga em seção histórica não sustenta o estado vigente. Nada aqui é
 * lido em runtime — quem recorta a seção e procura o símbolo é o teste.
 */
export interface EvidenciaConstrucao extends Evidencia { secao?: string }

export interface ComponenteConstrucao {
  id: string;
  titulo: string;
  /** gates do catálogo que dão o estado por prontidão (o gate continua sendo a autoridade) */
  gates?: string[];
  /** evidência concreta de que o componente existe — o teste abre o arquivo e procura o símbolo */
  evidencias?: EvidenciaConstrucao[];
  /** o que a evidência prova (código, integração, produção, operação real); rótulo, nunca estado */
  natureza?: NaturezaEvidencia;
  /**
   * Só para componente PLANEJADO (sem gate e sem evidência): artefatos EXPLÍCITOS cuja aparição indicaria que a
   * implementação nasceu. O domínio nunca lê isto para mudar estado — quem confere é o teste (guarda de frescor),
   * que FALHA e obriga decisão humana. Nada de descoberta por nome, nada de varredura do repositório.
   */
  sinaisDeImplementacao?: EvidenciaConstrucao[];
  /**
   * Só para componente PLANEJADO: a frase de uma fonte integrada (doc, CLAUDE.md) que DECLARA o item pendente. Se ela
   * sumir, a fonte deixou de dizer que está pendente — o teste falha e obriga a revisão. Foi o ponto cego da 1C: a
   * ativação de 0056/0057 em produção não cria código, mas apaga "só em código" do CLAUDE.md.
   */
  pendenciaDeclarada?: EvidenciaConstrucao[];
  /**
   * Último recurso, quando nem sinal nem frase-fonte existem. Todo componente planejado tem de declarar sinais e/ou
   * pendência declarada, OU este motivo — nunca nada.
   */
  semSinalPorque?: string;
}

export interface ModuloConstrucao {
  id: string;
  titulo: string;
  /** uma frase: o que este módulo faz pela EIFF */
  descricao: string;
  dominio: DominioConstrucao;
  /** rota principal do produto onde o módulo aparece; ausente quando o módulo não tem tela (ex.: fábrica observada) */
  rota?: string;
  /**
   * Superfícies de navegação (rotas de ROTAS_NAV/App) que este módulo COBRE. É a base da guarda de cobertura:
   * toda rota do EIFF tem de estar aqui em algum módulo ou em EXCLUSOES_SUPERFICIE — senão o teste falha e obriga
   * uma decisão humana. Nunca lida em runtime para inferir módulo.
   */
  rotas?: string[];
  componentes: ComponenteConstrucao[];
  /** dependência arquitetural declarada entre módulos (ids deste catálogo) */
  dependeDe?: string[];
  /** frentes de trabalho (WORKSTREAMS) cujos itens pertencem a este módulo — é a relação task → módulo */
  workstreams?: string[];
  /**
   * Fonte viva cujos itens são ATIVIDADE OBSERVADA por este módulo (não pertença). Só a fábrica usa: um job
   * `source = 'FACTORY'` é produzido por ela, mas o módulo a que o job se refere continua não informado.
   */
  observaFonte?: McFonte;
}

const m = (x: ModuloConstrucao): ModuloConstrucao => x;
const mod = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'modulo', referencia, simbolo });
const doc = (referencia: string, simbolo?: string, secao?: string): EvidenciaConstrucao => ({ tipo: 'documento', referencia, simbolo, ...(secao ? { secao } : {}) });
const fn = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'funcao', referencia, simbolo });
const scr = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'script', referencia, simbolo });
const mig = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'migration', referencia, simbolo });

/** Títulos exatos das seções que a Central usa como autoridade do estado atual. Um lugar só. */
export const SECOES_ATUAIS = {
  inboxAplicacao: '### 15.1 O que foi feito',
  inboxShadow: '### 15.2 Estágio operacional: SHADOW MODE',
  inboxProvas: '### 15.4 Provas executadas em produção (dados de teste, contagens apenas)',
  inboxDefaults: '### 16.1 Defaults versionados (migration `0058_inbox_defaults.sql`)',
  inboxFlags: '### 16.2 Kill switches (`src/core/inbox/ativacao.ts`, lidos só no servidor)',
  inboxAmbiente: '### 16.3 Ambiente (presença/ausência, nunca valores)',
  inboxCredencial: '### 16.5 Ponto exato em que a cadeia espera credencial',
  inboxRoteamentoProducao: '### 16.8 Resultado em produção nesta ativação (dados de teste, só contagens)',
  inboxPendencias: '### 14.7 Fora de escopo e pendências',
  estadoProjeto: '## Estado e decisões (atualizar ao mudar)',
} as const;


/**
 * O catálogo. Reconstruído das estruturas reais do repositório (core, telas, funções Netlify, migrations e docs)
 * e do catálogo de gates da Central. Componente sem `gates` e sem `evidencias` é PLANO declarado — aparece como
 * PLANEJADO e nunca conta como construído.
 */
export const MODULOS_CONSTRUCAO: ModuloConstrucao[] = [
  // ------------------------------------------------------------------------------------------ gestão da EIFF
  m({
    id: 'FINANCEIRO', titulo: 'Financeiro', dominio: 'GESTAO', rota: '/lancamentos',
    rotas: ['/lancamentos', '/pagar', '/receber', '/aprovacoes', '/dre', '/checks'],
    descricao: 'Lançamentos, alçadas de aprovação, DRE gerencial e fechamento — a regra de negócio do caixa da EIFF.',
    componentes: [
      { id: 'LANCAMENTOS', titulo: 'Lançamentos e exclusão lógica', evidencias: [mod('src/data/store.ts', 'excluirLancamento'), mod('src/screens/Lancamentos.tsx')] },
      { id: 'ALCADAS', titulo: 'Alçadas e central de aprovações', evidencias: [mod('src/screens/Aprovacoes.tsx'), mod('src/core/engine.ts', 'etapasExigidas')] },
      { id: 'DRE', titulo: 'DRE gerencial por competência', evidencias: [mod('src/core/engine.ts', 'export function dre'), mod('src/screens/Dre.tsx')] },
      { id: 'CHECKS', titulo: 'Checks e fechamento de período', evidencias: [mod('src/screens/Checks.tsx')] },
      { id: 'ALCADAS_REAIS', titulo: 'Alçadas reais da Diretoria (DEC-03)', pendenciaDeclarada: [doc('CLAUDE.md', 'alçadas reais (DEC-03)', SECOES_ATUAIS.estadoProjeto)] },
    ],
  }),
  m({
    id: 'TESOURARIA', titulo: 'Tesouraria', dominio: 'GESTAO', rota: '/fluxo13', dependeDe: ['FINANCEIRO'],
    rotas: ['/posicao', '/fluxo13', '/fluxo24', '/conciliacao', '/dividas'],
    descricao: 'Fluxo de caixa 13 semanas e 24 meses, posição bancária pelo extrato, conciliação e cenários.',
    componentes: [
      { id: 'FLUXO', titulo: 'Fluxo 13 semanas / 24 meses', evidencias: [mod('src/core/engine.ts', 'fluxo13Semanas'), mod('src/screens/Tesouraria.tsx')] },
      { id: 'POSICAO', titulo: 'Posição bancária e corte do extrato', evidencias: [mod('src/core/engine.ts', 'posicaoBancaria'), mod('src/core/engine.ts', 'incluirTransacao')] },
      { id: 'CONCILIACAO', titulo: 'Conciliação e importação OFX', evidencias: [mod('src/data/store.ts', 'conciliar'), mod('src/core/ofx.ts', 'parseOfx'), mod('src/screens/Conciliacao.tsx')] },
      { id: 'CENARIOS', titulo: 'Cenários interativos de caixa', evidencias: [mod('src/core/cenarioCaixa.ts', 'aplicarCenario')] },
      { id: 'DIVIDAS', titulo: 'Dívidas', evidencias: [mod('src/screens/Dividas.tsx')] },
      { id: 'RESERVA_MINIMA', titulo: 'Reserva mínima aprovada (DEC-09)', pendenciaDeclarada: [doc('CLAUDE.md', 'reserva mínima (DEC-09)', SECOES_ATUAIS.estadoProjeto)] },
    ],
  }),
  m({
    id: 'OBRAS', titulo: 'Obras e contratos', dominio: 'GESTAO', rota: '/obras', dependeDe: ['FINANCEIRO'],
    rotas: ['/obras', '/central'],
    descricao: 'Obra 360°: serviços do contrato, medições, faturamento, cronograma, lista de materiais e saúde da obra.',
    componentes: [
      { id: 'OBRA360', titulo: 'Obra 360° e custo previsto', evidencias: [mod('src/core/engine.ts', 'obra360'), mod('src/screens/Obra360.tsx')] },
      { id: 'SERVICOS', titulo: 'Serviços, medições e avanço físico', evidencias: [mod('src/core/obras.ts', 'calcServico')] },
      { id: 'FATURAMENTO', titulo: 'Acompanhamento de faturamento do contrato', evidencias: [mod('src/core/faturamento.ts', 'acompanhamentoFaturamento'), mod('src/screens/FaturamentoObra.tsx'), mig('supabase/migrations/0053_faturamento_contrato.sql')] },
      { id: 'CRONOGRAMA', titulo: 'Cronograma visual e curva S', evidencias: [mod('src/ui/Gantt.tsx', 'export function Gantt')] },
      { id: 'MATERIAIS', titulo: 'Lista de materiais em kg', evidencias: [mod('src/core/materiais.ts', 'avancoPorPeso')] },
      { id: 'SAUDE', titulo: 'Saúde da obra', evidencias: [mod('src/core/analise.ts', 'analisarObra')] },
    ],
  }),
  m({
    id: 'FABRICA', titulo: 'Fábrica e montagem', dominio: 'GESTAO', rota: '/producao', dependeDe: ['OBRAS'],
    rotas: ['/producao'],
    descricao: 'Apontamento por estação, produtividade em kg/HH, romaneios, quiosque da fábrica e estrutura 3D do avanço.',
    componentes: [
      { id: 'ESTACOES', titulo: 'Apontamento por estação e kg/HH', evidencias: [mod('src/core/producao.ts', 'resumoProdutividade'), mod('src/screens/Producao.tsx')] },
      { id: 'QUIOSQUE', titulo: 'Modo quiosque (TV da fábrica)', evidencias: [mod('src/screens/Quiosque.tsx')] },
      { id: 'CENA3D', titulo: 'Estrutura 3D do avanço', evidencias: [mod('src/ui/CenaObra.tsx')] },
    ],
  }),
  m({
    id: 'ESTOQUE', titulo: 'Estoque de aço', dominio: 'GESTAO', rota: '/estoque', dependeDe: ['OBRAS', 'COMPRAS'],
    rotas: ['/estoque'],
    descricao: 'Itens em kg, movimentos imutáveis, custo médio móvel e rastreabilidade de corrida.',
    componentes: [
      { id: 'POSICAO_ESTOQUE', titulo: 'Posição por item, lote e local', evidencias: [mod('src/core/estoque.ts', 'posicaoEstoque'), mod('src/screens/Estoque.tsx')] },
      { id: 'CUSTO_ACO', titulo: 'Custo real de aço por obra e serviço', evidencias: [mod('src/core/estoque.ts', 'consumoAco')] },
    ],
  }),
  m({
    id: 'EQUIPE_CAMPO', titulo: 'Equipe e modo campo', dominio: 'GESTAO', rota: '/campo', dependeDe: ['OBRAS', 'FABRICA'],
    rotas: ['/equipe', '/campo', '/apontamentos'],
    descricao: 'Apontamentos diários, alocações, fluxo guiado do dia no celular, fotos de campo e trabalho offline.',
    componentes: [
      { id: 'APONTAMENTOS', titulo: 'Apontamentos e locais do dia', evidencias: [mod('src/core/equipe.ts', 'locaisDoDia'), mod('src/screens/Equipe.tsx')] },
      { id: 'ALOCACOES', titulo: 'Funções e alocações por período', evidencias: [mod('src/core/equipe.ts', 'alocacoesVigentes')] },
      { id: 'FLUXO_DIA', titulo: 'Fluxo guiado do dia (celular)', evidencias: [mod('src/core/campoFluxo.ts', 'passosDoFluxo'), mod('src/screens/CampoFluxo.tsx')] },
      { id: 'OFFLINE', titulo: 'Fila offline e PWA', evidencias: [mod('src/data/offline.ts', 'guardarPendente'), scr('public/sw.js')] },
      { id: 'FOTOS', titulo: 'Fotos de campo no Storage', evidencias: [mod('src/ui/foto.ts'), mig('supabase/migrations/0041_field_photo.sql')] },
    ],
  }),
  m({
    id: 'ORCAMENTOS', titulo: 'Orçamentos e composições', dominio: 'GESTAO', rota: '/orcamentos', dependeDe: ['OBRAS'],
    rotas: ['/orcamentos'],
    descricao: 'Catálogo de insumos e composições (SINAPI, TCPO, próprias), BDI, curva ABC e contratação em serviços.',
    componentes: [
      { id: 'COMPOSICOES', titulo: 'Custo por composição, BDI e curva ABC', evidencias: [mod('src/core/orcamentos.ts', 'curvaInsumos'), mod('src/screens/Orcamentos.tsx')] },
      { id: 'SINAPI', titulo: 'Importação SINAPI', evidencias: [mod('src/core/sinapi.ts'), scr('scripts/importar-sinapi.mjs')] },
    ],
  }),
  m({
    id: 'COMPRAS', titulo: 'Compras e pedidos', dominio: 'GESTAO', rota: '/compras', dependeDe: ['ORCAMENTOS', 'FINANCEIRO'],
    rotas: ['/compras'],
    descricao: 'Pedidos de compra que viram lançamentos previstos, recebimento e comparativo orçado × comprado.',
    componentes: [
      { id: 'PEDIDOS', titulo: 'Pedidos de compra', evidencias: [mod('src/core/compras.ts', 'calcPedido'), mod('src/screens/Compras.tsx'), mig('supabase/migrations/0024_pedidos_compra.sql')] },
      { id: 'ORCADO_COMPRADO', titulo: 'Orçado × comprado por insumo', evidencias: [mod('src/core/compras.ts', 'comparativoOrcadoComprado')] },
    ],
  }),
  m({
    id: 'DIRETOR_FINANCEIRO', titulo: 'Diretor Financeiro virtual', dominio: 'GESTAO', rota: '/diretor', dependeDe: ['TESOURARIA'],
    rotas: ['/diretor'],
    descricao: 'Parecer determinístico de caixa para qualquer pedido de pagamento, com a IA só interpretando o texto.',
    componentes: [
      { id: 'PARECER', titulo: 'Parecer determinístico do motor', evidencias: [mod('src/core/cfo.ts', 'analisarPagamento'), mod('src/screens/DiretorFinanceiro.tsx')] },
      { id: 'CENTRAL_DF', titulo: 'Central da Diretoria e pedidos da equipe', evidencias: [mod('src/core/cfo.ts', 'centralDF')] },
      { id: 'INTERPRETE_IA', titulo: 'Interpretação do pedido por IA (servidor)', evidencias: [fn('netlify/functions/diretor-financeiro.ts')] },
    ],
  }),
  m({
    id: 'CAPACITACAO', titulo: 'Capacitação e Assistente', dominio: 'GESTAO', rota: '/capacitacao',
    rotas: ['/capacitacao'],
    descricao: 'Lições, trilhas por papel, e-books e o assistente de chat que responde pelo manual.',
    componentes: [
      { id: 'TRILHAS', titulo: 'Lições e trilhas por papel', evidencias: [mod('src/core/capacitacao.ts', 'TRILHAS'), mod('src/screens/Capacitacao.tsx')] },
      { id: 'EBOOKS', titulo: 'E-books por setor', evidencias: [mod('src/core/ebook.ts')] },
      { id: 'ASSISTENTE', titulo: 'Assistente contextual', evidencias: [mod('src/core/assistente.ts', 'buscarLocal'), mod('src/ui/Assistente.tsx'), fn('netlify/functions/assistente.ts')] },
    ],
  }),
  m({
    id: 'EXPERIENCIA', titulo: 'Painel e experiência', dominio: 'GESTAO', rota: '/',
    rotas: ['/', '/inbox'],
    descricao: 'Painel executivo, caixa de entrada pessoal, paleta de comandos, tabela unificada, tour, sugestões, movimento e telemetria local.',
    componentes: [
      { id: 'PAINEL', titulo: 'Painel executivo', evidencias: [mod('src/screens/Dashboard.tsx'), mod('src/screens/Apresentacao.tsx')] },
      { id: 'CAIXA_PESSOAL', titulo: 'Minha caixa de entrada (pendências pessoais)', evidencias: [mod('src/screens/CaixaEntrada.tsx')] },
      { id: 'PALETA', titulo: 'Paleta de comandos e rotas', evidencias: [mod('src/ui/Paleta.tsx', 'ROTAS_NAV')] },
      { id: 'TABELA', titulo: 'Tabela unificada', evidencias: [mod('src/ui/Tabela.tsx', 'ordenarLinhas')] },
      { id: 'TOUR', titulo: 'Tour guiado', evidencias: [mod('src/ui/Tour.tsx')] },
      { id: 'SUGESTOES', titulo: 'Sugestões por tela', evidencias: [mod('src/core/sugestoes.ts', 'sugestoesPara')] },
      { id: 'MOVIMENTO', titulo: 'Sistema de movimento', evidencias: [mod('src/ui/motion.tsx', 'useRevelar')] },
      { id: 'TELEMETRIA', titulo: 'Telemetria local de uso', evidencias: [mod('src/data/telemetria.ts')] },
    ],
  }),

  // ------------------------------------------------------------------------------------------- comercial
  m({
    id: 'RADAR', titulo: 'Radar', dominio: 'COMERCIAL', rota: '/radar',
    rotas: ['/radar', '/radar/empresas'],
    descricao: 'Inteligência comercial e CRM: empresas, decisores, sinais, score por regras configuráveis e Vibe.',
    componentes: [
      { id: 'SCORE', titulo: 'Score por regras configuráveis', evidencias: [mod('src/core/radar/score.ts', 'calcularScore'), mig('supabase/migrations/0031_radar.sql')] },
      { id: 'DECISORES', titulo: 'Decisores e decision fit', evidencias: [mod('src/core/radar/contatos.ts')] },
      { id: 'IMPORTACAO', titulo: 'Importação CSV e deduplicação', evidencias: [mod('src/core/radar/importacao.ts', 'importarCsv')] },
      { id: 'SIGNAL_PILOT', titulo: 'Signal Pilot 01', evidencias: [mod('src/core/radar/signalPilot.ts', 'recomendacaoSignalPilot')] },
      { id: 'VIBE', titulo: 'Vibe Prospecting (operação reservada no banco)', evidencias: [mod('src/core/radar/vibeServidor.ts', 'decidirReserva'), fn('netlify/functions/vibe.ts'), doc('docs/vibe.md')] },
      { id: 'GUIA', titulo: 'Guia do Radar', evidencias: [doc('docs/radar.md')] },
    ],
  }),
  m({
    id: 'COMUNICACAO', titulo: 'Comunicação e canais', dominio: 'COMERCIAL', rota: '/radar/hoje', dependeDe: ['RADAR'],
    rotas: [],
    descricao: 'Fatos, objetivo, playbook, geração com fact gate e entrega por canal — com o envio real fechado.',
    componentes: [
      { id: 'CONTENT_SPEC', titulo: 'Content spec e playbooks', evidencias: [mod('src/core/radar/comunicacao.ts', 'montarContentSpec')] },
      { id: 'FACT_GATE', titulo: 'Fact gate pós-geração', evidencias: [mod('src/core/radar/comunicacaoGeracao.ts', 'validarGeracao')] },
      { id: 'LLM', titulo: 'Provedor LLM no servidor (Server Truth)', evidencias: [mod('src/core/radar/comunicacaoServidor.ts'), fn('netlify/functions/comunicacao.ts')] },
      { id: 'ENTREGABILIDADE', titulo: 'Canais e entregabilidade', evidencias: [mod('src/core/radar/canais.ts', 'avaliarEntregabilidade'), mod('src/screens/radar/Entrega.tsx')] },
      { id: 'OCTADESK', titulo: 'Octadesk: leitura e canário fechado', evidencias: [mod('src/core/radar/canaisServidor.ts'), fn('netlify/functions/channel-octadesk.ts'), doc('docs/octadesk.md')] },
    ],
  }),
  m({
    id: 'MAQUINA_COMERCIAL', titulo: 'Máquina Comercial', dominio: 'COMERCIAL', rota: '/radar/hoje', dependeDe: ['RADAR'],
    rotas: ['/radar/hoje'],
    descricao: 'Fila comercial por regra pura (CM1), cadência (CM2) e as superfícies Panorama e Modo Foco.',
    componentes: [
      { id: 'CM1', titulo: 'Commercial Queue (CM1)', evidencias: [mod('src/core/radar/commercialMachine.ts', 'CATEGORIAS_COMMERCIAL_QUEUE')] },
      { id: 'CM2', titulo: 'Cadência comercial (CM2)', evidencias: [mod('src/core/radar/commercialCadence.ts', 'ESTADOS_CADENCIA_CM')] },
      { id: 'UX_COMERCIAL', titulo: 'Panorama e Modo Foco', evidencias: [mod('src/screens/radar/ComercialPanorama.tsx'), mod('src/screens/radar/ComercialModoFoco.tsx')] },
    ],
  }),
  m({
    id: 'LEAD_ENGINE', titulo: 'Lead Engine', dominio: 'COMERCIAL', rota: '/radar', dependeDe: ['RADAR'],
    rotas: [],
    descricao: 'Entrada governada de candidatos: intake idempotente, evidência imutável, revisão humana e a fonte CNO.',
    componentes: [
      { id: 'INTAKE', titulo: 'Intake canônico e fingerprint', evidencias: [mod('src/core/radar/leadEngineIntake.ts', 'classificarIntake'), mig('supabase/migrations/0055_lead_engine_intake.sql')] },
      { id: 'REVISAO', titulo: 'Fila de revisão e promoção humana', evidencias: [mod('src/core/radar/leadEngineReview.ts', 'filaDeRevisao'), mod('src/screens/radar/LeadEngineCandidatos.tsx')] },
      { id: 'CNO', titulo: 'Fonte CNO (Dados Abertos)', evidencias: [mod('src/core/radar/cnoDadosAbertos.ts', 'HOST_OFICIAL_CNO')] },
      { id: 'PILOTO_CNO', titulo: 'Piloto CNO em produção', evidencias: [mod('src/core/radar/cnoPilot.ts', 'CNO_PILOT_POLICY_V1'), doc('docs/lead-engine-1.0.md')] },
      { id: 'FONTES_FUTURAS', titulo: 'Novas fontes e descoberta automática (PNCP, RFB)', pendenciaDeclarada: [doc('CLAUDE.md', 'Nada de descoberta automática, scheduler, PNCP, RFB, Vibe ou notícias ainda')] },
    ],
  }),

  // ------------------------------------------------------------------------------------------ EIFF Central
  m({
    id: 'CENTRAL_WHATSAPP', titulo: 'EIFF Central (WhatsApp)', dominio: 'CENTRAL', dependeDe: ['DIRETOR_FINANCEIRO', 'PLATAFORMA'],
    rotas: [],
    workstreams: ['CANAL', 'NUCLEO', 'AGENTES', 'SEGURANCA', 'BANCO', 'ALPHA'],
    descricao: 'Central de WhatsApp sobre a Meta Cloud API: canal, identidade, orquestrador, agentes, banco e Alpha.',
    componentes: WORKSTREAMS.filter((w) => w.id !== 'OBSERVABILIDADE').map((w) => ({ id: w.id, titulo: w.titulo, gates: w.gates })),
  }),
  // Entrou em main pelo PR #13 (7e0aa61) DURANTE a MC-CONSTRUCTION-1 — o caso que tornou o drift de SUPERFÍCIE
  // observável. O PR #14 (7a0e723, Octopus Router) tornou observável o drift de COMPONENTE: três planos do catálogo
  // (Octopus, editor de regras, IA real) ganharam código sem rota nova. Só o que a main prova entra como concluído,
  // com a maturidade do Octopus separada em componentes: implementado → provado → integrado → produção → operação.
  // PR #18 (d707531) registrou a ativação: 0056 e 0057 aplicadas em produção e o Inbox em SHADOW MODE, com E2E
  // controlado (dado de teste), idempotência, router e RLS provados em produção (eiff-inbox §15). SHADOW MODE não é
  // operação: nenhuma mensagem real chega (sem chave de serviço, sem Meta, sem setores) e nada sai. Por isso o
  // componente de tráfego real segue PLANEJADO — a prova controlada nunca fecha a operação.
  // PR #19 (0d8fe73): 0058 (12 setores + configuração) aplicada em produção, kill switches em ativacao.ts
  // (montarPortasInbox é o único ponto que monta ingestão/router/IA; produção: inbox ON, router ON, LLM OFF, outbound OFF),
  // observabilidade do Shadow Mode e o router determinístico APLICANDO em produção com dado de teste (§16.8). Estado
  // mutável (produção, flags, ambiente) sempre com `secao`: §15.2 é histórico ("setores vazios"), §16 é o vigente.
  m({
    id: 'INBOX', titulo: 'EIFF Inbox', dominio: 'CENTRAL', rota: '/atendimento', rotas: ['/atendimento'],
    dependeDe: ['CENTRAL_WHATSAPP', 'PLATAFORMA'],
    descricao: 'Central de comunicação, atendimento e decisão: a thread é a unidade; ingestão pela EIFF Central, Octopus Router (roteamento explícito e auditável, IA só como refino no servidor) e fronteiras fail-closed.',
    componentes: [
      { id: 'DOMINIO', titulo: 'Domínio: threads, contatos, estados e roteamento', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/tipos.ts', 'ContatoInbox'), mod('src/core/inbox/estados.ts', 'validarTransicao'), mod('src/core/inbox/roteamento.ts', 'rotear')] },
      { id: 'TELAS', titulo: 'Tela de atendimento e configuração', natureza: 'CODIGO', evidencias: [mod('src/screens/Inbox.tsx'), mod('src/screens/InboxConfig.tsx')] },
      { id: 'PERSISTENCIA', titulo: 'Persistência escrita: 0056, RLS por setor e RPCs', natureza: 'CODIGO', evidencias: [mig('supabase/migrations/0056_inbox.sql', 'inbox_ingest'), mig('supabase/migrations/0056_inbox.sql', 'inbox_assign_thread'), mod('src/data/inbox.supabase.ts', 'carregarInbox')] },
      { id: 'INGESTAO', titulo: 'Ingestão pela EIFF Central (webhook → inbox_ingest)', natureza: 'INTEGRACAO', evidencias: [mod('src/core/inbox/ingestaoServidor.ts', 'ingerirEventosCentral'), mod('src/core/inbox/fronteiras.ts', 'deEventoCentral'), fn('netlify/functions/channel-meta-webhook.ts', 'ingerirEventosCentral')] },
      { id: 'FRONTEIRAS', titulo: 'Fronteiras fail-closed: canal MANUAL, sem inteligência, Factory reservada', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/fronteiras.ts', 'PROVEDOR_MANUAL'), mod('src/core/inbox/fronteiras.ts', 'SEM_INTELIGENCIA'), mod('src/core/inbox/fronteiras.ts', 'EXECUCAO_FACTORY_RESERVADA'), mod('src/core/inbox/ativacao.ts', 'outbound: false')] },
      { id: 'PROVAS', titulo: 'Provas: smoke PGlite e testes de fronteira', natureza: 'CODIGO', evidencias: [scr('scripts/pg-smoke-inbox.mjs'), mod('src/core/inbox/ingestaoServidor.test.ts'), doc('docs/eiff-inbox.md')] },
      { id: 'OCTOPUS_PIPELINE', titulo: 'Octopus Router: pipeline de roteamento e política de automação', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/roteador.ts', 'decidirRoteamento'), mod('src/core/inbox/automacao.ts', 'decidirAutomacao')] },
      { id: 'OCTOPUS_PROVAS', titulo: 'Octopus Router: testes e smoke do banco (provas S–X)', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/roteador.test.ts'), mod('src/core/inbox/roteamentoServidor.test.ts'), scr('scripts/pg-smoke-inbox.mjs', 'inbox_apply_routing')] },
      { id: 'OCTOPUS_INTEGRADO', titulo: 'Octopus Router: integrado (webhook → montarPortasInbox → rotearNoServidor, 0057, store e tela)', natureza: 'INTEGRACAO', evidencias: [fn('netlify/functions/channel-meta-webhook.ts', 'montarPortasInbox'), mod('src/core/inbox/ativacao.ts', 'rotearNoServidor'), mig('supabase/migrations/0057_inbox_octopus_router.sql', 'inbox_apply_routing'), mod('src/data/store.ts', 'inboxConfirmarRoteamento')] },
      { id: 'IA_SERVIDOR', titulo: 'Refino por IA no servidor (opcional pela chave)', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/inteligenciaLlm.ts', 'provedorAnthropic')] },
      { id: 'EDITOR_REGRAS', titulo: 'Editores de regras de roteamento e automação', natureza: 'CODIGO', evidencias: [mod('src/screens/InboxConfig.tsx', 'RegraRoteamento'), mod('src/screens/InboxConfig.tsx', 'RegraAutomacao'), mod('src/data/store.ts', 'validarConfiguracaoOctopus')] },
      { id: 'ATIVACAO', titulo: 'Controles de ativação: kill switches server-side (inbox, router, IA, outbound)', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/ativacao.ts', 'lerFlagsInbox'), mod('src/core/inbox/ativacao.ts', 'montarPortasInbox'), mod('src/core/inbox/ativacao.test.ts')] },
      { id: 'OBSERVABILIDADE', titulo: 'Observabilidade do Shadow Mode: últimas decisões e baseline (confirmação × override)', natureza: 'CODIGO', evidencias: [mod('src/core/inbox/observabilidade.ts', 'ultimasDecisoes'), mod('src/core/inbox/observabilidade.ts', 'metricasShadow'), mod('src/screens/InboxConfig.tsx', "label: 'Shadow mode'")] },
      { id: 'MIGRATION_APLICADA', titulo: 'Migration 0056 aplicada em produção', natureza: 'PRODUCAO', evidencias: [doc('docs/eiff-inbox.md', '**0056** (12 tabelas', SECOES_ATUAIS.inboxAplicacao), doc('CLAUDE.md', '**0056, 0057 e 0058 (defaults: 12 setores por organização', SECOES_ATUAIS.estadoProjeto)] },
      { id: 'OCTOPUS_PRODUCAO', titulo: 'Migration 0057 aplicada em produção', natureza: 'PRODUCAO', evidencias: [doc('docs/eiff-inbox.md', '**0057** (`inbox_thread.routing`', SECOES_ATUAIS.inboxAplicacao), doc('CLAUDE.md', '**0056, 0057 e 0058 (defaults: 12 setores por organização', SECOES_ATUAIS.estadoProjeto)] },
      { id: 'DEFAULTS_0058', titulo: 'Defaults versionados em produção: 0058 com 12 setores e configuração padrão', natureza: 'PRODUCAO', evidencias: [mig('supabase/migrations/0058_inbox_defaults.sql', '12 setores padrão'), scr('scripts/pg-smoke-inbox.mjs', "ok('Y'"), doc('docs/eiff-inbox.md', '24/09/2026 (12 setores, 1 configuração)', SECOES_ATUAIS.inboxDefaults), doc('CLAUDE.md', '**0056, 0057 e 0058 (defaults: 12 setores por organização', SECOES_ATUAIS.estadoProjeto)] },
      { id: 'SHADOW_MODE', titulo: 'Shadow Mode em produção: E2E controlado, idempotência e router determinístico aplicando (dado de teste, sem ação externa)', natureza: 'PRODUCAO', evidencias: [doc('docs/eiff-inbox.md', '### 15.2 Estágio operacional: SHADOW MODE', SECOES_ATUAIS.inboxShadow), doc('docs/eiff-inbox.md', '**Idempotência**: o mesmo', SECOES_ATUAIS.inboxProvas), doc('docs/eiff-inbox.md', '`EIFF_INBOX_ENABLED=true`, `EIFF_INBOX_ROUTER_ENABLED=true`,', SECOES_ATUAIS.inboxFlags), doc('docs/eiff-inbox.md', '`consultar_pagamento`, regra explícita ROT-02 → **FINANCEIRO**', SECOES_ATUAIS.inboxRoteamentoProducao), doc('docs/eiff-inbox.md', '0 falhas de IA, 0 mensagens enviadas', SECOES_ATUAIS.inboxRoteamentoProducao)] },
      { id: 'RLS_PRODUCAO', titulo: 'RLS e autoridade provadas em produção', natureza: 'PRODUCAO', evidencias: [doc('docs/eiff-inbox.md', '**RLS/autoridade** (transação com rollback)', SECOES_ATUAIS.inboxProvas)] },
      {
        id: 'TRAFEGO_REAL', titulo: 'Tráfego externo real (mensagens de WhatsApp ingressando e roteadas)', natureza: 'OPERACAO',
        // autoridade atual: §16.5 e §16.3 — faltam SUPABASE_SERVICE_ROLE_KEY e as variáveis da Meta (com os phone number
        // IDs e o registro do webhook). Setores NÃO são mais pré-requisito: a 0058 os criou (§16.1). O §15.2 é histórico.
        pendenciaDeclarada: [doc('docs/eiff-inbox.md', '(1) `SUPABASE_SERVICE_ROLE_KEY`; (2) as sete variáveis da Meta', SECOES_ATUAIS.inboxCredencial), doc('docs/eiff-inbox.md', '**Ausentes**: `SUPABASE_SERVICE_ROLE_KEY`', SECOES_ATUAIS.inboxAmbiente)],
      },
      {
        id: 'IA_OPERACIONAL', titulo: 'Refino por IA ligado no roteamento em produção (depois da baseline do Shadow Mode)', natureza: 'OPERACAO',
        // implementação existe (IA_SERVIDOR); em produção está DESLIGADA por decisão: EIFF_INBOX_LLM_ENABLED=false (§16.2).
        pendenciaDeclarada: [doc('docs/eiff-inbox.md', 'ANTHROPIC OFF · OUTBOUND OFF · FACTORY OFF', SECOES_ATUAIS.inboxFlags)],
      },
      {
        id: 'ESCALACAO_SLA', titulo: 'Escalação por SLA como execução automática', natureza: 'CODIGO',
        pendenciaDeclarada: [doc('docs/eiff-inbox.md', 'scheduler de escalação', SECOES_ATUAIS.inboxPendencias)],
        // hoje SLA_ESCALATED existe só no catálogo de eventos e nas migrations; §14.7 diz que "continua decisão".
        // Emitir o evento a partir do código de aplicação é o sinal explícito de que a execução nasceu.
        sinaisDeImplementacao: [
          { tipo: 'modulo', referencia: 'src/core/inbox/roteamento.ts', simbolo: "'SLA_ESCALATED'" },
          { tipo: 'modulo', referencia: 'src/core/inbox/roteador.ts', simbolo: "'SLA_ESCALATED'" },
          { tipo: 'modulo', referencia: 'src/data/store.ts', simbolo: "'SLA_ESCALATED'" },
        ],
      },
    ],
  }),

  // ------------------------------------------------------------------------------ construção e fábrica
  m({
    id: 'MISSION_CONTROL', titulo: 'Mission Control', dominio: 'DESENVOLVIMENTO', rota: '/mission-control', dependeDe: ['PLATAFORMA'],
    rotas: ['/mission-control'],
    workstreams: ['OBSERVABILIDADE'],
    descricao: 'A Central de Construção: observa GitHub, Factory e o catálogo de gates, e projeta — nunca escreve.',
    componentes: [
      { id: 'GATES', titulo: 'Prontidão por gates com evidência', gates: ['OBSERVABILIDADE'] },
      { id: 'ENDPOINT', titulo: 'Status ao vivo (/api/development-status)', gates: ['DEVELOPMENT_STATUS_ENDPOINT'] },
      { id: 'GITHUB', titulo: 'Adapter do GitHub somente leitura', gates: ['GITHUB_ADAPTER_READONLY'] },
      { id: 'CONSTRUCAO', titulo: 'Central de Construção (módulos e panorama)', evidencias: [mod('src/core/central/construcao.ts', 'MODULOS_CONSTRUCAO'), mod('src/screens/MissionControlVisao.tsx')] },
      { id: 'CORRELACAO', titulo: 'Correlação ponta a ponta', gates: ['WORK_ITEM_CORRELACAO'] },
      { id: 'MAPA', titulo: 'Mapa vivo', gates: ['MAPA_VIVO'] },
      { id: 'EXECUCAO', titulo: 'Quadro de execução como projeção', gates: ['EXECUCAO_LIVE'] },
      { id: 'DEGRADACAO', titulo: 'Degradação honesta', gates: ['MC_DEGRADACAO'] },
      { id: 'REALTIME', titulo: 'Realtime', gates: ['MC_REALTIME'] },
      { id: 'FACTORY_API', titulo: 'Estado operacional da Factory', gates: ['FACTORY_ADAPTER_READONLY'] },
      { id: 'LIVE', titulo: 'Mission Control em tempo real (conclusão)', gates: ['MISSION_CONTROL_LIVE'] },
    ],
  }),
  m({
    id: 'FACTORY', titulo: 'EIFF Dev Factory (observada)', dominio: 'DESENVOLVIMENTO', observaFonte: 'FACTORY', rotas: [],
    descricao: 'A fábrica de software vive no repositório eiff-dev-factory; aqui ela é apenas observada pelas issues de job.',
    componentes: [
      { id: 'ESPELHO', titulo: 'Espelho do contrato da fábrica com detector de drift', evidencias: [mod('src/core/central/workItem.ts', 'ESPELHO_JOB_STATES')] },
      { id: 'IDENTIDADE', titulo: 'Identidade canônica do job (factory-task:v1)', evidencias: [mod('src/core/central/githubAdapter.ts', 'lerIdentidadeCanonica')] },
      { id: 'API', titulo: 'Leitura pelo estado operacional (packages/api)', gates: ['FACTORY_ADAPTER_READONLY'] },
    ],
  }),
  m({
    id: 'PLATAFORMA', titulo: 'Plataforma, cadastros e auditoria', dominio: 'DESENVOLVIMENTO', rota: '/cadastros', rotas: ['/cadastros', '/auditoria'],
    descricao: 'Supabase com RLS, cadastros e parâmetros, auditoria, funções Netlify, Quality Gate no CI e publicação com auto-publish travado.',
    componentes: [
      { id: 'CADASTROS', titulo: 'Cadastros e parâmetros', evidencias: [mod('src/screens/Cadastros.tsx')] },
      { id: 'AUDITORIA', titulo: 'Auditoria e telemetria de uso', evidencias: [mod('src/screens/Auditoria.tsx')] },
      { id: 'SUPABASE', titulo: 'Supabase e persistência por diferenças', evidencias: [mod('src/data/supabase.ts', 'persistirRemoto'), doc('docs/implantacao-supabase.md')] },
      { id: 'CI', titulo: 'Quality Gate (CI)', evidencias: [scr('.github/workflows/quality-gate.yml')] },
      { id: 'PUBLICACAO', titulo: 'Publicação Netlify', evidencias: [scr('netlify.toml'), doc('docs/publicacao-automatica.md')] },
      { id: 'ARQUITETURA', titulo: 'Arquitetura e regras documentadas', evidencias: [doc('docs/arquitetura-e-regras.md')] },
    ],
  }),
];

const POR_ID = new Map(MODULOS_CONSTRUCAO.map((x) => [x.id, x]));
export const moduloPorId = (id: string): ModuloConstrucao | undefined => POR_ID.get(id);

// ------------------------------------------------------------------------------ cobertura do catálogo

/**
 * Superfícies de navegação que EXISTEM no EIFF e, por decisão explícita, NÃO são cobertas por módulo nenhum.
 * Cada exclusão tem motivo humano. A lista é o "ou" da guarda: rota fora de todo `rotas` e fora daqui = drift.
 */
export const EXCLUSOES_SUPERFICIE: Readonly<Record<string, string>> = {
  '/piloto': 'Protótipo de UX (Financeiro compacto) fora do produto: não é módulo nem componente, é laboratório.',
};

/** Rotas cobertas por algum módulo. Uma rota pertence a no máximo um módulo (teste garante). */
export const superficiesCobertas = (modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): Map<string, string> => {
  const m = new Map<string, string>();
  for (const mo of modulos) for (const r of mo.rotas ?? []) m.set(r, mo.id);
  return m;
};

export type ClassificacaoSuperficie = { tipo: 'MODULO'; moduloId: string } | { tipo: 'EXCLUIDA'; motivo: string } | { tipo: 'SEM_CLASSIFICACAO' };

/** Classificação de UMA superfície. Total: nunca lança, nunca adivinha — sem decisão registrada, SEM_CLASSIFICACAO. */
export function classificarSuperficie(rota: string, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): ClassificacaoSuperficie {
  const moduloId = superficiesCobertas(modulos).get(rota);
  if (moduloId) return { tipo: 'MODULO', moduloId };
  const motivo = EXCLUSOES_SUPERFICIE[rota];
  if (motivo) return { tipo: 'EXCLUIDA', motivo };
  return { tipo: 'SEM_CLASSIFICACAO' };
}

/**
 * As superfícies de um inventário (rotas reais do App/paleta, lidas pelo TESTE, nunca em runtime) que ninguém
 * decidiu como a Central deve tratar. Vazio é a condição saudável; qualquer item é drift do catálogo.
 */
export const superficiesSemClassificacao = (inventario: readonly string[], modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): string[] =>
  [...new Set(inventario)].filter((r) => classificarSuperficie(r, modulos).tipo === 'SEM_CLASSIFICACAO').sort();

/** Mensagem humana da guarda. Uma frase, um lugar. */
export const MENSAGEM_DRIFT_SUPERFICIE = 'Nova superfície do EIFF sem classificação na Central de Construção';

// ---------------------------------------------------------------------------- frescor dos componentes

export interface ComponentePlanejado { moduloId: string; componente: ComponenteConstrucao }

/**
 * Componentes PLANEJADOS do catálogo (sem gate e sem evidência), com o módulo dono. É a lista que a guarda de
 * frescor percorre no TESTE; aqui só se lê o catálogo — nenhum arquivo é aberto e nenhum estado muda.
 */
export const componentesPlanejados = (modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): ComponentePlanejado[] =>
  modulos.flatMap((mo) => mo.componentes
    .filter((c) => !(c.gates?.length) && !(c.evidencias?.length))
    .map((componente) => ({ moduloId: mo.id, componente })));

/** Mensagem humana quando a frase-fonte que declarava o plano pendente sumiu. */
export const mensagemPendenciaSumiu = (componenteId: string): string =>
  `Componente da Central possivelmente desatualizado: a fonte deixou de declarar ${componenteId} como pendente, mas ele continua classificado como PLANEJADO.`;

/** Mensagem humana da guarda de frescor. O teste falha com ela; nunca reclassifica sozinho. */
export const mensagemDriftComponente = (componenteId: string): string =>
  `Componente da Central possivelmente desatualizado: ${componenteId} possui evidência de implementação, mas continua classificado como PLANEJADO.`;

/** Todos os gates citados pelos componentes de um módulo. */
export const gatesDoModulo = (mo: ModuloConstrucao): string[] =>
  [...new Set(mo.componentes.flatMap((c) => c.gates ?? []))];

// ------------------------------------------------------------------------------------------ componentes

export interface ComponenteProjetado {
  id: string;
  titulo: string;
  estado: EstadoConstrucao;
  /** bloqueado DE PROPÓSITO (segurança intencional): não é falha e não bloqueia o módulo */
  porDesenho: boolean;
  /** presente quando o estado vem de gates */
  prontidao?: Prontidao;
  gates: Gate[];
  evidencias: Evidencia[];
  /** de onde veio o estado: gate, evidência ou só plano */
  origem: 'GATE' | 'EVIDENCIA' | 'PLANO';
  natureza?: NaturezaEvidencia;
}

const bloqueioReal = (g: Gate) => g.situacao === 'bloqueado' && g.porDesenho !== true;

/** Estado do componente. Gate manda; sem gate, evidência prova; sem nada, é plano. Nenhuma estimativa. */
export function projetarComponente(c: ComponenteConstrucao): ComponenteProjetado {
  const gates = (c.gates ?? []).map((id) => gatePorId(id)).filter((g): g is Gate => !!g);
  const evidencias = c.evidencias ?? [];
  if (gates.length > 0) {
    const p = prontidao(gates.map((g) => g.id));
    const estado: EstadoConstrucao = p.faltando.some(bloqueioReal)
      ? 'BLOQUEADO'
      : p.pronto ? 'CONCLUIDO'
        : p.fechados > 0 ? 'EM_CONSTRUCAO'
          : p.faltando.every((g) => g.situacao === 'bloqueado') ? 'BLOQUEADO' : 'PLANEJADO';
    const porDesenho = estado === 'BLOQUEADO' && !p.faltando.some(bloqueioReal);
    return { id: c.id, titulo: c.titulo, estado, porDesenho, prontidao: p, gates, evidencias, origem: 'GATE', natureza: c.natureza };
  }
  if (evidencias.length > 0) return { id: c.id, titulo: c.titulo, estado: 'CONCLUIDO', porDesenho: false, gates, evidencias, origem: 'EVIDENCIA', natureza: c.natureza };
  return { id: c.id, titulo: c.titulo, estado: 'PLANEJADO', porDesenho: false, gates, evidencias, origem: 'PLANO', natureza: c.natureza };
}

// ------------------------------------------------------------------------------------- task → módulo

/**
 * A ÚNICA regra de pertença. Só o contrato do item decide: `workstreamId` de uma frente do módulo, ou `gateIds`
 * que cruzam os gates do módulo. Título, prefixo do taskId, repositório e nome parecido NÃO entram — seriam
 * heurística silenciosa. Sem relação, `undefined`: a tela mostra SEM_MODULO e a tarefa continua visível.
 */
export function moduloDaTarefa(item: MissionControlWorkItem, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): ModuloConstrucao | undefined {
  if (item.workstreamId) {
    const porFrente = modulos.find((mo) => mo.workstreams?.includes(item.workstreamId!));
    if (porFrente) return porFrente;
  }
  if (item.gateIds?.length) {
    const ids = new Set(item.gateIds);
    const porGate = modulos.find((mo) => gatesDoModulo(mo).some((g) => ids.has(g)));
    if (porGate) return porGate;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------- módulos

export interface BloqueioModulo { titulo: string; motivo: string; porDesenho: boolean }

export interface ModuloProjetado {
  modulo: ModuloConstrucao;
  estado: EstadoConstrucao;
  componentes: ComponenteProjetado[];
  concluidos: number;
  total: number;
  /** 0..1 — SEMPRE concluidos / total; nunca um número digitado */
  fracao: number;
  /** tarefas cujo contrato informa este módulo (relação segura) */
  tarefas: MissionControlWorkItem[];
  tarefasAtivas: number;
  /** itens da fonte observada (só quando `observaFonte`): atividade produzida, não pertença */
  observados: MissionControlWorkItem[];
  bloqueios: BloqueioModulo[];
  /** derivado: o primeiro componente não concluído, na ordem declarada; null quando tudo está concluído */
  proximoPasso: string | null;
  dependeDe: string[];
  dependentes: string[];
  /** por onde o que está no cartão chegou: catálogo (SNAPSHOT) e, se houver tarefa viva, a procedência dela */
  procedencias: Procedencia[];
}

/** Estado do módulo a partir dos componentes. Bloqueio por desenho nunca bloqueia; tarefa viva ativa marca construção. */
export function estadoDoModulo(componentes: readonly ComponenteProjetado[], tarefasAtivas = 0): EstadoConstrucao {
  const comEvidencia = componentes.filter((c) => c.origem !== 'PLANO');
  if (comEvidencia.length === 0) return 'SEM_EVIDENCIA';
  if (componentes.some((c) => c.estado === 'BLOQUEADO' && !c.porDesenho)) return 'BLOQUEADO';
  if (componentes.every((c) => c.estado === 'CONCLUIDO')) return 'CONCLUIDO';
  if (componentes.some((c) => c.estado === 'CONCLUIDO' || c.estado === 'EM_CONSTRUCAO') || tarefasAtivas > 0) return 'EM_CONSTRUCAO';
  return 'PLANEJADO';
}

const ehAtiva = (i: MissionControlWorkItem): boolean => STATUS_ATIVOS.includes(i.status);

export function projetarModulo(mo: ModuloConstrucao, itens: readonly MissionControlWorkItem[] = [], modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): ModuloProjetado {
  const componentes = mo.componentes.map(projetarComponente);
  const tarefas = itens.filter((i) => moduloDaTarefa(i, modulos)?.id === mo.id);
  const tarefasAtivas = tarefas.filter(ehAtiva).length;
  const observados = mo.observaFonte ? itens.filter((i) => i.source === mo.observaFonte) : [];
  const concluidos = componentes.filter((c) => c.estado === 'CONCLUIDO').length;
  const total = componentes.length;
  const bloqueios: BloqueioModulo[] = componentes.flatMap((c) =>
    c.gates.filter((g) => g.situacao === 'bloqueado').map((g) => ({ titulo: g.titulo, motivo: g.bloqueio ?? '', porDesenho: g.porDesenho === true })));
  for (const t of tarefas) if (t.bloqueio) bloqueios.push({ titulo: t.correlationId ?? t.sourceId, motivo: t.bloqueio.motivo, porDesenho: t.bloqueio.porDesenho });
  const pendente = componentes.find((c) => c.estado !== 'CONCLUIDO' && !(c.estado === 'BLOQUEADO' && c.porDesenho));
  const proximoPasso = pendente
    ? (pendente.estado === 'BLOQUEADO' ? `desbloquear: ${pendente.titulo}` : pendente.prontidao && pendente.prontidao.faltando.length
      ? `${pendente.titulo} — ${pendente.prontidao.faltando.find((g) => !g.porDesenho)?.titulo ?? pendente.prontidao.faltando[0].titulo}`
      : pendente.titulo)
    : null;
  const procedencias: Procedencia[] = (['REPOSITORIO', ...new Set(tarefas.map((t) => t.procedencia))] as Procedencia[]).filter((p, i, a) => a.indexOf(p) === i);
  return {
    modulo: mo,
    estado: estadoDoModulo(componentes, tarefasAtivas),
    componentes, concluidos, total,
    fracao: total === 0 ? 0 : concluidos / total,
    tarefas, tarefasAtivas, observados, bloqueios, proximoPasso,
    dependeDe: mo.dependeDe ?? [],
    dependentes: modulos.filter((x) => x.dependeDe?.includes(mo.id)).map((x) => x.id),
    procedencias,
  };
}

// ------------------------------------------------------------------------------------------ panorama

export interface TarefasPanorama {
  total: number;
  ativas: number;
  porStatus: Readonly<Record<McStatus, number>>;
  comModulo: number;
  semModulo: number;
  stale: number;
  fonteIndisponivel: number;
}

export interface PanoramaConstrucao {
  modulos: ModuloProjetado[];
  total: number;
  porEstado: Readonly<Record<EstadoConstrucao, number>>;
  /** null quando NÃO houve leitura válida — ausência de dado nunca vira zero */
  tarefas: TarefasPanorama | null;
}

const zeroPorStatus = (): Record<McStatus, number> => Object.fromEntries(MC_STATUS.map((s) => [s, 0])) as Record<McStatus, number>;

/**
 * O panorama inteiro. `itens = null` significa "sem leitura" (fonte ainda não respondeu ou caiu sem estado
 * anterior): os módulos continuam todos lá — são catálogo do repositório — e as tarefas ficam `null`.
 */
export function panoramaConstrucao(itens: readonly MissionControlWorkItem[] | null, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): PanoramaConstrucao {
  const lista = itens ?? [];
  const projetados = modulos.map((mo) => projetarModulo(mo, lista, modulos));
  const porEstado = Object.fromEntries(ESTADOS_CONSTRUCAO.map((e) => [e, 0])) as Record<EstadoConstrucao, number>;
  for (const p of projetados) porEstado[p.estado] += 1;
  let tarefas: TarefasPanorama | null = null;
  if (itens) {
    const porStatus = zeroPorStatus();
    for (const i of itens) porStatus[i.status] += 1;
    const comModulo = itens.filter((i) => moduloDaTarefa(i, modulos) !== undefined).length;
    tarefas = {
      total: itens.length,
      ativas: itens.filter(ehAtiva).length,
      porStatus,
      comModulo,
      semModulo: itens.length - comModulo,
      stale: itens.filter((i) => i.frescor.stale).length,
      fonteIndisponivel: itens.filter((i) => i.frescor.fonteIndisponivel).length,
    };
  }
  return { modulos: projetados, total: projetados.length, porEstado, tarefas };
}

/** As tarefas que estão acontecendo agora, na ordem de STATUS_ATIVOS e, dentro de cada uma, por alteração mais recente. */
export function construindoAgora(itens: readonly MissionControlWorkItem[]): MissionControlWorkItem[] {
  const ordem = new Map(STATUS_ATIVOS.map((s, i) => [s, i]));
  return itens
    .filter(ehAtiva)
    .sort((a, b) => {
      const d = (ordem.get(a.status) ?? 99) - (ordem.get(b.status) ?? 99);
      if (d !== 0) return d;
      if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      if (a.updatedAt && !b.updatedAt) return -1;
      if (!a.updatedAt && b.updatedAt) return 1;
      return a.id.localeCompare(b.id);
    });
}

// -------------------------------------------------------------------------------------------- atenção

export const TIPOS_ATENCAO = ['TAREFAS_BLOQUEADAS', 'AGUARDANDO_HUMANO', 'FONTE_INDISPONIVEL', 'MODULOS_BLOQUEADOS', 'ITENS_STALE', 'SEM_MODULO', 'SEM_LEITURA'] as const;
export type TipoAtencao = (typeof TIPOS_ATENCAO)[number];

export interface ItemAtencao { tipo: TipoAtencao; n: number; texto: string }

export interface FontesAtencao {
  /** houve alguma leitura válida */
  leituraValida: boolean;
  /** nomes das fontes/repositórios que não responderam na última leitura */
  indisponiveis: string[];
}

/** Só fatos derivados. Nada opinativo: cada linha é uma contagem com origem conhecida. */
export function atencaoConstrucao(p: PanoramaConstrucao, fontes: FontesAtencao): ItemAtencao[] {
  const out: ItemAtencao[] = [];
  if (!fontes.leituraValida) out.push({ tipo: 'SEM_LEITURA', n: 0, texto: 'Sem leitura das fontes vivas: contagens de tarefas indisponíveis.' });
  if (fontes.indisponiveis.length) out.push({ tipo: 'FONTE_INDISPONIVEL', n: fontes.indisponiveis.length, texto: `Fonte indisponível: ${fontes.indisponiveis.join(', ')}.` });
  const modBloq = p.modulos.filter((x) => x.estado === 'BLOQUEADO');
  if (modBloq.length) out.push({ tipo: 'MODULOS_BLOQUEADOS', n: modBloq.length, texto: `${modBloq.length} módulo(s) com bloqueio real: ${modBloq.map((x) => x.modulo.titulo).join(', ')}.` });
  if (p.tarefas) {
    const t = p.tarefas;
    if (t.porStatus.BLOQUEADO) out.push({ tipo: 'TAREFAS_BLOQUEADAS', n: t.porStatus.BLOQUEADO, texto: `${t.porStatus.BLOQUEADO} tarefa(s) bloqueada(s).` });
    if (t.porStatus.AGUARDANDO_HUMANO) out.push({ tipo: 'AGUARDANDO_HUMANO', n: t.porStatus.AGUARDANDO_HUMANO, texto: `${t.porStatus.AGUARDANDO_HUMANO} tarefa(s) aguardando decisão humana.` });
    if (t.stale) out.push({ tipo: 'ITENS_STALE', n: t.stale, texto: `${t.stale} item(ns) com leitura vencida.` });
    if (t.semModulo) out.push({ tipo: 'SEM_MODULO', n: t.semModulo, texto: `${t.semModulo} tarefa(s) sem módulo informado pela fonte.` });
  }
  return out;
}

/** Texto da fração, num lugar só. A porcentagem, quando aparece, é sempre arredondamento desta conta. */
export const fracaoTexto = (concluidos: number, total: number): string => `${concluidos}/${total}`;
export const pctConstrucao = (fracao: number): string => `${Math.round(fracao * 100)}%`;

/** Os gates de todos os módulos existem no catálogo. Vazio é a condição saudável. */
export const gatesDesconhecidosNosModulos = (): string[] => {
  const conhecidos = new Set(GATES.map((g) => g.id));
  return [...new Set(MODULOS_CONSTRUCAO.flatMap(gatesDoModulo).filter((g) => !conhecidos.has(g)))];
};
