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

/** Os status do quadro que significam "está acontecendo agora" — os mesmos MC_STATUS, sem segundo vocabulário. */
export const STATUS_ATIVOS: readonly McStatus[] = ['EXECUTANDO', 'EM_VALIDACAO', 'AGUARDANDO_HUMANO', 'BLOQUEADO'];

/** O que a tela diz quando a fonte não informa a que módulo a tarefa pertence. Existe um lugar só para a frase. */
export const SEM_MODULO = 'Módulo não informado';

// --------------------------------------------------------------------------------------------------- modelo

export interface ComponenteConstrucao {
  id: string;
  titulo: string;
  /** gates do catálogo que dão o estado por prontidão (o gate continua sendo a autoridade) */
  gates?: string[];
  /** evidência concreta de que o componente existe — o teste abre o arquivo e procura o símbolo */
  evidencias?: Evidencia[];
}

export interface ModuloConstrucao {
  id: string;
  titulo: string;
  /** uma frase: o que este módulo faz pela EIFF */
  descricao: string;
  dominio: DominioConstrucao;
  /** rota do produto onde o módulo aparece; ausente quando o módulo não tem tela (ex.: fábrica observada) */
  rota?: string;
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
const doc = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'documento', referencia, simbolo });
const fn = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'funcao', referencia, simbolo });
const scr = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'script', referencia, simbolo });
const mig = (referencia: string, simbolo?: string): Evidencia => ({ tipo: 'migration', referencia, simbolo });

/**
 * O catálogo. Reconstruído das estruturas reais do repositório (core, telas, funções Netlify, migrations e docs)
 * e do catálogo de gates da Central. Componente sem `gates` e sem `evidencias` é PLANO declarado — aparece como
 * PLANEJADO e nunca conta como construído.
 */
export const MODULOS_CONSTRUCAO: ModuloConstrucao[] = [
  // ------------------------------------------------------------------------------------------ gestão da EIFF
  m({
    id: 'FINANCEIRO', titulo: 'Financeiro', dominio: 'GESTAO', rota: '/lancamentos',
    descricao: 'Lançamentos, alçadas de aprovação, DRE gerencial e fechamento — a regra de negócio do caixa da EIFF.',
    componentes: [
      { id: 'LANCAMENTOS', titulo: 'Lançamentos e exclusão lógica', evidencias: [mod('src/data/store.ts', 'excluirLancamento'), mod('src/screens/Lancamentos.tsx')] },
      { id: 'ALCADAS', titulo: 'Alçadas e central de aprovações', evidencias: [mod('src/screens/Aprovacoes.tsx'), mod('src/core/engine.ts', 'etapasExigidas')] },
      { id: 'DRE', titulo: 'DRE gerencial por competência', evidencias: [mod('src/core/engine.ts', 'export function dre'), mod('src/screens/Dre.tsx')] },
      { id: 'CHECKS', titulo: 'Checks e fechamento de período', evidencias: [mod('src/screens/Checks.tsx')] },
      { id: 'ALCADAS_REAIS', titulo: 'Alçadas reais da Diretoria (DEC-03)' },
    ],
  }),
  m({
    id: 'TESOURARIA', titulo: 'Tesouraria', dominio: 'GESTAO', rota: '/fluxo13', dependeDe: ['FINANCEIRO'],
    descricao: 'Fluxo de caixa 13 semanas e 24 meses, posição bancária pelo extrato, conciliação e cenários.',
    componentes: [
      { id: 'FLUXO', titulo: 'Fluxo 13 semanas / 24 meses', evidencias: [mod('src/core/engine.ts', 'fluxo13Semanas'), mod('src/screens/Tesouraria.tsx')] },
      { id: 'POSICAO', titulo: 'Posição bancária e corte do extrato', evidencias: [mod('src/core/engine.ts', 'posicaoBancaria'), mod('src/core/engine.ts', 'incluirTransacao')] },
      { id: 'CONCILIACAO', titulo: 'Conciliação e importação OFX', evidencias: [mod('src/data/store.ts', 'conciliar'), mod('src/core/ofx.ts', 'parseOfx'), mod('src/screens/Conciliacao.tsx')] },
      { id: 'CENARIOS', titulo: 'Cenários interativos de caixa', evidencias: [mod('src/core/cenarioCaixa.ts', 'aplicarCenario')] },
      { id: 'DIVIDAS', titulo: 'Dívidas', evidencias: [mod('src/screens/Dividas.tsx')] },
      { id: 'RESERVA_MINIMA', titulo: 'Reserva mínima aprovada (DEC-09)' },
    ],
  }),
  m({
    id: 'OBRAS', titulo: 'Obras e contratos', dominio: 'GESTAO', rota: '/obras', dependeDe: ['FINANCEIRO'],
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
    descricao: 'Apontamento por estação, produtividade em kg/HH, romaneios, quiosque da fábrica e estrutura 3D do avanço.',
    componentes: [
      { id: 'ESTACOES', titulo: 'Apontamento por estação e kg/HH', evidencias: [mod('src/core/producao.ts', 'resumoProdutividade'), mod('src/screens/Producao.tsx')] },
      { id: 'QUIOSQUE', titulo: 'Modo quiosque (TV da fábrica)', evidencias: [mod('src/screens/Quiosque.tsx')] },
      { id: 'CENA3D', titulo: 'Estrutura 3D do avanço', evidencias: [mod('src/ui/CenaObra.tsx')] },
    ],
  }),
  m({
    id: 'ESTOQUE', titulo: 'Estoque de aço', dominio: 'GESTAO', rota: '/estoque', dependeDe: ['OBRAS', 'COMPRAS'],
    descricao: 'Itens em kg, movimentos imutáveis, custo médio móvel e rastreabilidade de corrida.',
    componentes: [
      { id: 'POSICAO_ESTOQUE', titulo: 'Posição por item, lote e local', evidencias: [mod('src/core/estoque.ts', 'posicaoEstoque'), mod('src/screens/Estoque.tsx')] },
      { id: 'CUSTO_ACO', titulo: 'Custo real de aço por obra e serviço', evidencias: [mod('src/core/estoque.ts', 'consumoAco')] },
    ],
  }),
  m({
    id: 'EQUIPE_CAMPO', titulo: 'Equipe e modo campo', dominio: 'GESTAO', rota: '/campo', dependeDe: ['OBRAS', 'FABRICA'],
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
    descricao: 'Catálogo de insumos e composições (SINAPI, TCPO, próprias), BDI, curva ABC e contratação em serviços.',
    componentes: [
      { id: 'COMPOSICOES', titulo: 'Custo por composição, BDI e curva ABC', evidencias: [mod('src/core/orcamentos.ts', 'curvaInsumos'), mod('src/screens/Orcamentos.tsx')] },
      { id: 'SINAPI', titulo: 'Importação SINAPI', evidencias: [mod('src/core/sinapi.ts'), scr('scripts/importar-sinapi.mjs')] },
    ],
  }),
  m({
    id: 'COMPRAS', titulo: 'Compras e pedidos', dominio: 'GESTAO', rota: '/compras', dependeDe: ['ORCAMENTOS', 'FINANCEIRO'],
    descricao: 'Pedidos de compra que viram lançamentos previstos, recebimento e comparativo orçado × comprado.',
    componentes: [
      { id: 'PEDIDOS', titulo: 'Pedidos de compra', evidencias: [mod('src/core/compras.ts', 'calcPedido'), mod('src/screens/Compras.tsx'), mig('supabase/migrations/0024_pedidos_compra.sql')] },
      { id: 'ORCADO_COMPRADO', titulo: 'Orçado × comprado por insumo', evidencias: [mod('src/core/compras.ts', 'comparativoOrcadoComprado')] },
    ],
  }),
  m({
    id: 'DIRETOR_FINANCEIRO', titulo: 'Diretor Financeiro virtual', dominio: 'GESTAO', rota: '/diretor', dependeDe: ['TESOURARIA'],
    descricao: 'Parecer determinístico de caixa para qualquer pedido de pagamento, com a IA só interpretando o texto.',
    componentes: [
      { id: 'PARECER', titulo: 'Parecer determinístico do motor', evidencias: [mod('src/core/cfo.ts', 'analisarPagamento'), mod('src/screens/DiretorFinanceiro.tsx')] },
      { id: 'CENTRAL_DF', titulo: 'Central da Diretoria e pedidos da equipe', evidencias: [mod('src/core/cfo.ts', 'centralDF')] },
      { id: 'INTERPRETE_IA', titulo: 'Interpretação do pedido por IA (servidor)', evidencias: [fn('netlify/functions/diretor-financeiro.ts')] },
    ],
  }),
  m({
    id: 'CAPACITACAO', titulo: 'Capacitação e Assistente', dominio: 'GESTAO', rota: '/capacitacao',
    descricao: 'Lições, trilhas por papel, e-books e o assistente de chat que responde pelo manual.',
    componentes: [
      { id: 'TRILHAS', titulo: 'Lições e trilhas por papel', evidencias: [mod('src/core/capacitacao.ts', 'TRILHAS'), mod('src/screens/Capacitacao.tsx')] },
      { id: 'EBOOKS', titulo: 'E-books por setor', evidencias: [mod('src/core/ebook.ts')] },
      { id: 'ASSISTENTE', titulo: 'Assistente contextual', evidencias: [mod('src/core/assistente.ts', 'buscarLocal'), mod('src/ui/Assistente.tsx'), fn('netlify/functions/assistente.ts')] },
    ],
  }),
  m({
    id: 'EXPERIENCIA', titulo: 'Experiência e navegação', dominio: 'GESTAO', rota: '/',
    descricao: 'Paleta de comandos, tabela unificada, tour guiado, sugestões por tela, movimento e telemetria local.',
    componentes: [
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
    descricao: 'Fila comercial por regra pura (CM1), cadência (CM2) e as superfícies Panorama e Modo Foco.',
    componentes: [
      { id: 'CM1', titulo: 'Commercial Queue (CM1)', evidencias: [mod('src/core/radar/commercialMachine.ts', 'CATEGORIAS_COMMERCIAL_QUEUE')] },
      { id: 'CM2', titulo: 'Cadência comercial (CM2)', evidencias: [mod('src/core/radar/commercialCadence.ts', 'ESTADOS_CADENCIA_CM')] },
      { id: 'UX_COMERCIAL', titulo: 'Panorama e Modo Foco', evidencias: [mod('src/screens/radar/ComercialPanorama.tsx'), mod('src/screens/radar/ComercialModoFoco.tsx')] },
    ],
  }),
  m({
    id: 'LEAD_ENGINE', titulo: 'Lead Engine', dominio: 'COMERCIAL', rota: '/radar', dependeDe: ['RADAR'],
    descricao: 'Entrada governada de candidatos: intake idempotente, evidência imutável, revisão humana e a fonte CNO.',
    componentes: [
      { id: 'INTAKE', titulo: 'Intake canônico e fingerprint', evidencias: [mod('src/core/radar/leadEngineIntake.ts', 'classificarIntake'), mig('supabase/migrations/0055_lead_engine_intake.sql')] },
      { id: 'REVISAO', titulo: 'Fila de revisão e promoção humana', evidencias: [mod('src/core/radar/leadEngineReview.ts', 'filaDeRevisao'), mod('src/screens/radar/LeadEngineCandidatos.tsx')] },
      { id: 'CNO', titulo: 'Fonte CNO (Dados Abertos)', evidencias: [mod('src/core/radar/cnoDadosAbertos.ts', 'HOST_OFICIAL_CNO')] },
      { id: 'PILOTO_CNO', titulo: 'Piloto CNO em produção', evidencias: [mod('src/core/radar/cnoPilot.ts', 'CNO_PILOT_POLICY_V1'), doc('docs/lead-engine-1.0.md')] },
      { id: 'FONTES_FUTURAS', titulo: 'Novas fontes e descoberta automática (PNCP, RFB)' },
    ],
  }),

  // ------------------------------------------------------------------------------------------ EIFF Central
  m({
    id: 'CENTRAL_WHATSAPP', titulo: 'EIFF Central (WhatsApp)', dominio: 'CENTRAL', dependeDe: ['DIRETOR_FINANCEIRO', 'PLATAFORMA'],
    workstreams: ['CANAL', 'NUCLEO', 'AGENTES', 'SEGURANCA', 'BANCO', 'ALPHA'],
    descricao: 'Central de WhatsApp sobre a Meta Cloud API: canal, identidade, orquestrador, agentes, banco e Alpha.',
    componentes: WORKSTREAMS.filter((w) => w.id !== 'OBSERVABILIDADE').map((w) => ({ id: w.id, titulo: w.titulo, gates: w.gates })),
  }),

  // ------------------------------------------------------------------------------ construção e fábrica
  m({
    id: 'MISSION_CONTROL', titulo: 'Mission Control', dominio: 'DESENVOLVIMENTO', rota: '/mission-control', dependeDe: ['PLATAFORMA'],
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
    id: 'FACTORY', titulo: 'EIFF Dev Factory (observada)', dominio: 'DESENVOLVIMENTO', observaFonte: 'FACTORY',
    descricao: 'A fábrica de software vive no repositório eiff-dev-factory; aqui ela é apenas observada pelas issues de job.',
    componentes: [
      { id: 'ESPELHO', titulo: 'Espelho do contrato da fábrica com detector de drift', evidencias: [mod('src/core/central/workItem.ts', 'ESPELHO_JOB_STATES')] },
      { id: 'IDENTIDADE', titulo: 'Identidade canônica do job (factory-task:v1)', evidencias: [mod('src/core/central/githubAdapter.ts', 'lerIdentidadeCanonica')] },
      { id: 'API', titulo: 'Leitura pelo estado operacional (packages/api)', gates: ['FACTORY_ADAPTER_READONLY'] },
    ],
  }),
  m({
    id: 'PLATAFORMA', titulo: 'Plataforma e publicação', dominio: 'DESENVOLVIMENTO',
    descricao: 'Supabase com RLS, funções Netlify, Quality Gate no CI e publicação com auto-publish travado.',
    componentes: [
      { id: 'SUPABASE', titulo: 'Supabase e persistência por diferenças', evidencias: [mod('src/data/supabase.ts', 'persistirRemoto'), doc('docs/implantacao-supabase.md')] },
      { id: 'CI', titulo: 'Quality Gate (CI)', evidencias: [scr('.github/workflows/quality-gate.yml')] },
      { id: 'PUBLICACAO', titulo: 'Publicação Netlify', evidencias: [scr('netlify.toml'), doc('docs/publicacao-automatica.md')] },
      { id: 'ARQUITETURA', titulo: 'Arquitetura e regras documentadas', evidencias: [doc('docs/arquitetura-e-regras.md')] },
    ],
  }),
];

const POR_ID = new Map(MODULOS_CONSTRUCAO.map((x) => [x.id, x]));
export const moduloPorId = (id: string): ModuloConstrucao | undefined => POR_ID.get(id);

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
    return { id: c.id, titulo: c.titulo, estado, porDesenho, prontidao: p, gates, evidencias, origem: 'GATE' };
  }
  if (evidencias.length > 0) return { id: c.id, titulo: c.titulo, estado: 'CONCLUIDO', porDesenho: false, gates, evidencias, origem: 'EVIDENCIA' };
  return { id: c.id, titulo: c.titulo, estado: 'PLANEJADO', porDesenho: false, gates, evidencias, origem: 'PLANO' };
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
