// EIFF Commercial Director — CD-1: snapshot comercial canônico, somente leitura.
//
// Responde "o que sabemos objetivamente sobre a operação comercial neste instante?" — e só isso. Diagnóstico começa no
// CD-2 e recomendação no CD-5 (docs/commercial-director-1.0.md).
//
// Regras deste módulo:
// - COMPÕE as autoridades existentes e nunca recalcula regra de outra: Commercial Queue (construirCommercialQueue),
//   Action Plan (planosDaFilaCM), Cadência (cadenciasDaFilaCM), cobertura (coberturaEmpresa), elegibilidade
//   (contatoElegivel), histórico de contato (historicoDe), Lead Engine (filaDeRevisao, contadoresRevisao,
//   metricasPiloto) e Inbox (estadoSla).
// - O legado resumoRadar / filaHoje está DEPRECADO como autoridade comercial (decisão D-6) e não é usado.
// - Sem score, sem peso, sem ranking do Diretor. Contas só aparecem por referência à Commercial Queue, na ordem dela.
// - `hoje` é explícito; o instante do Inbox (SLA) também. Nenhuma leitura de relógio, rede ou persistência.
// - Texto livre (notas, payload bruto, corpo de mensagem, motivos) não participa de nenhuma regra.
import { MODOS_PLANO_CM, planosDaFilaCM, resumoPorModoCM } from './commercialActionPlan';
import { ESTADOS_CADENCIA_CM, cadenciasDaFilaCM } from './commercialCadence';
import { CATEGORIAS_COMMERCIAL_QUEUE, CODIGOS_TRAVA_CM, MOTIVOS_FORA_DA_FILA, construirCommercialQueue, normalizarHojeCM, type CategoriaCommercialQueue, type CodigoRazaoCM, type CommercialQueue, type CommercialQueueItem, type OpcoesCommercialQueue, type ReferenciaCM } from './commercialMachine';
import { disponivel, insuficiente, taxa, type MedidaComercial } from './commercialMetrics';
import { NIVEIS_COBERTURA, coberturaEmpresa } from './cobertura';
import { ESTADOS_COMUNICACAO, historicoDe } from './comunicacao';
import { contatoElegivel } from './contatos';
import { CONTEXTOS_COMUNICACAO } from './canais';
import { descobertasSuprimidas, filaDeRevisao } from './leadEngineReview';
import { contadoresRevisao, metricasPiloto } from './leadEngineRevisao';
import { semProximaAcao } from './pipeline';
import { diasEntre } from './score';
import { ESTAGIOS, TIPOS_ATIVIDADE, estagioAtivo, type ClassePrioridade, type RadarDataset, type TipoSupressao } from './types';
import { STATUS_THREAD, type InboxDataset } from '../inbox/tipos';
import { estadoSla } from '../inbox/roteamento';

/** Versão das definições do snapshot. Mudar uma definição ou um recorte sobe a versão. */
export const VERSAO_REGRAS_CD = 'CD-1.0';

const CLASSES_RADAR = ['A+', 'A', 'B', 'C', 'D'] as const satisfies readonly ClassePrioridade[];
const TIPOS_SUPRESSAO = ['do_not_contact', 'email_bounced', 'invalid_phone', 'opt_out'] as const satisfies readonly TipoSupressao[];
/** Janelas (em dias, inclusivas) dos toques recentes. */
const JANELAS_TOQUE_DIAS = [7, 30] as const;
/** Quantas referências da fila o snapshot carrega por padrão (a lista inteira continua na Commercial Queue). */
const LIMITE_REFERENCIAS_PADRAO = 10;
/** Razões da fila que já apontam dado faltante na conta (a fila é a autoridade; o Diretor só conta). */
const RAZOES_DADO_FALTANTE: readonly CodigoRazaoCM[] = ['SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL', 'SEM_CANAL_VALIDO', 'SINAL_NAO_VERIFICADO', 'INCONSISTENCIA_PARA_REVISAR'];

// ---------------------------------------------------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------------------------------------------------
export interface OpcoesSnapshotCD {
  /** Repassado à Commercial Queue (mesma semântica de `OpcoesCommercialQueue`). */
  usuariosValidos?: OpcoesCommercialQueue['usuariosValidos'];
  /** O Inbox como veio do carregamento (já recortado pelo RLS). Ausente = Inbox não disponível. */
  inbox?: InboxDataset;
  /** Instante de referência (ISO) para SLA do Inbox. Sem ele, medidas de SLA saem DADO_INSUFICIENTE. */
  agoraIso?: string;
  /** Quantas referências da fila carregar (padrão 10). */
  limiteReferencias?: number;
}

/** Uma conta citada pelo Diretor: sempre a referência da Commercial Queue, na posição original. */
export interface ReferenciaContaCD {
  posicao: number;
  empresaId: string;
  categoria: CategoriaCommercialQueue;
  porQueAgora: CodigoRazaoCM;
  referencia?: ReferenciaCM;
}

export interface BlocoCommercialQueueCD {
  versaoRegras: string;
  total: MedidaComercial;
  porCategoria: Record<CategoriaCommercialQueue, MedidaComercial>;
  foraDaFila: Record<(typeof MOTIVOS_FORA_DA_FILA)[number], MedidaComercial>;
  /** as primeiras contas da fila, NA ORDEM DA FILA */
  referencias: ReferenciaContaCD[];
}

export interface BlocoBaseCD {
  empresasRadar: MedidaComercial;
  /** não mescladas e ativas (o complemento dos motivos EMPRESA_MESCLADA / EMPRESA_INATIVA da fila) */
  empresasAtivas: MedidaComercial;
  naFila: MedidaComercial;
  foraDaFila: MedidaComercial;
  porClasseRadar: Record<ClassePrioridade, MedidaComercial>;
}

export interface BlocoDecisoresCD {
  comAlgumContatoAtivo: MedidaComercial;
  comDecisorMarcado: MedidaComercial;
  comContatoElegivel: MedidaComercial;
  comContatoRecomendado: MedidaComercial;
  porNivelCobertura: Record<(typeof NIVEIS_COBERTURA)[number], MedidaComercial>;
  /** contas da fila cujo contato (da fila) tem ao menos um canal acionável */
  filaComCanalAcionavel: MedidaComercial;
  /** contas da fila cujo Action Plan está em modo CONTATO */
  prontasParaContato: MedidaComercial;
}

export interface BlocoAtividadeCD {
  atividadesRegistradas: MedidaComercial;
  notas: MedidaComercial;
  toquesComerciais: MedidaComercial;
  toquesPorTipo: Record<(typeof TIPOS_ATIVIDADE)[number], MedidaComercial>;
  toquesRecentes: Record<`${(typeof JANELAS_TOQUE_DIAS)[number]}d`, MedidaComercial>;
  reunioes: MedidaComercial;
  toquesComResultado: MedidaComercial;
  respostasPositivas: MedidaComercial;
  contasTocadas: MedidaComercial;
  contasNuncaTocadas: MedidaComercial;
  tarefasAbertas: MedidaComercial;
  tarefasVencidasNaFila: MedidaComercial;
  comunicacoesPorEstado: Record<(typeof ESTADOS_COMUNICACAO)[number], MedidaComercial>;
  planosPorModo: Record<(typeof MODOS_PLANO_CM)[number], MedidaComercial>;
  cadenciasPorEstado: Record<(typeof ESTADOS_CADENCIA_CM)[number], MedidaComercial>;
}

export interface BlocoFunilCD {
  oportunidades: MedidaComercial;
  ativas: MedidaComercial;
  porEstagio: Record<(typeof ESTAGIOS)[number], MedidaComercial>;
  valorEstimadoAtivas: MedidaComercial;
  ativasSemValor: MedidaComercial;
  semProximaAcao: MedidaComercial;
  paradasNaFila: MedidaComercial;
  paradasCriticasNaFila: MedidaComercial;
  registrosDeEstagio: MedidaComercial;
  ganhas: MedidaComercial;
  perdidas: MedidaComercial;
  taxaGanhoSobreFechadas: MedidaComercial;
  taxaContaTocadaParaOportunidade: MedidaComercial;
}

export interface BlocoProspeccaoCD {
  fontesCnoAtivas: MedidaComercial;
  descobertos: MedidaComercial;
  pendentes: MedidaComercial;
  emRevisao: MedidaComercial;
  rejeitados: MedidaComercial;
  promovidos: MedidaComercial;
  promovidosAssociados: MedidaComercial;
  promovidosComEmpresaCriada: MedidaComercial;
  filaDeRevisao: MedidaComercial;
  filaPorSinal: { CNO_NEW: MedidaComercial; CNO_EXPANSION: MedidaComercial };
  filaPorDescoberta: { hoje: MedidaComercial; '7d': MedidaComercial; '30d': MedidaComercial; '90d': MedidaComercial };
  suprimidos: MedidaComercial;
}

export interface BlocoQualidadeCD {
  duplicatasPendentes: MedidaComercial;
  supressoesPorTipo: Record<TipoSupressao, MedidaComercial>;
  contatosInelegiveis: MedidaComercial;
  sinaisNaoVerificados: MedidaComercial;
  travasNaFila: Record<(typeof CODIGOS_TRAVA_CM)[number], MedidaComercial>;
  /** contas da fila com alguma razão (principal ou secundária) que já aponta dado faltante */
  dadoFaltanteNaFila: Record<string, MedidaComercial>;
}

export interface BlocoInboxCD {
  disponivel: boolean;
  /** de onde veio o recorte; o Inbox já chega filtrado pelo RLS do usuário */
  origem: InboxDataset['origem'] | 'AUSENTE';
  threadsVisiveis: MedidaComercial;
  porContexto: Record<(typeof CONTEXTOS_COMUNICACAO)[number], MedidaComercial>;
  porStatus: Record<(typeof STATUS_THREAD)[number], MedidaComercial>;
  externasPorIntencao: Record<string, MedidaComercial>;
  externasSemClassificacao: MedidaComercial;
  comPrimeiraResposta: MedidaComercial;
  slaVencido: MedidaComercial;
  contatosVinculadosAoRadar: MedidaComercial;
  /** conversas por conta do Radar: só existe com vínculo explícito contato ↔ empresa */
  threadsPorContaRadar: MedidaComercial;
}

export interface CommercialDirectorSnapshot {
  versaoRegras: string;
  hoje: string;
  geradoDe: { versaoFila: string };
  commercialQueue: BlocoCommercialQueueCD;
  base: BlocoBaseCD;
  decisores: BlocoDecisoresCD;
  atividade: BlocoAtividadeCD;
  funil: BlocoFunilCD;
  prospeccao: BlocoProspeccaoCD;
  qualidade: BlocoQualidadeCD;
  inbox: BlocoInboxCD;
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilitários puros
// ---------------------------------------------------------------------------------------------------------------------
const dia = (v: string) => v.slice(0, 10);
const porCatalogo = <K extends string>(chaves: readonly K[], f: (k: K) => MedidaComercial): Record<K, MedidaComercial> =>
  Object.fromEntries(chaves.map((k) => [k, f(k)])) as Record<K, MedidaComercial>;
/** Chaves abertas (ex.: intenções do Inbox) em ordem alfabética — ordena CHAVES de agregado, nunca contas. */
const chavesOrdenadas = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const razoesDoItem = (i: CommercialQueueItem) => [i.porQueAgora, ...i.secundarias];

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------------------------------
export function snapshotComercialCD(radar: RadarDataset, hoje: string, opcoes: OpcoesSnapshotCD = {}): CommercialDirectorSnapshot {
  const d0 = normalizarHojeCM(hoje);
  const fila: CommercialQueue = construirCommercialQueue(radar, d0, { usuariosValidos: opcoes.usuariosValidos });
  const planos = planosDaFilaCM(radar, fila);
  const cadencias = cadenciasDaFilaCM(radar, fila, planos, d0);

  const ativas = radar.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const idsAtivas = new Set(ativas.map((e) => e.id));
  const nAtivas = ativas.length;

  return {
    versaoRegras: VERSAO_REGRAS_CD,
    hoje: d0,
    geradoDe: { versaoFila: fila.versaoRegras },
    commercialQueue: blocoFila(),
    base: blocoBase(),
    decisores: blocoDecisores(),
    atividade: blocoAtividade(),
    funil: blocoFunil(),
    prospeccao: blocoProspeccao(),
    qualidade: blocoQualidade(),
    inbox: blocoInbox(opcoes),
  };

  function blocoFila(): BlocoCommercialQueueCD {
    const limite = Math.max(0, Math.floor(opcoes.limiteReferencias ?? LIMITE_REFERENCIAS_PADRAO));
    return {
      versaoRegras: fila.versaoRegras,
      total: disponivel({ id: 'fila.total', descricao: 'contas na Commercial Queue', unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.itens.length),
      porCategoria: porCatalogo(CATEGORIAS_COMMERCIAL_QUEUE, (c) => disponivel({ id: `fila.categoria.${c}`, descricao: `contas da fila na categoria ${c}`, unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.porCategoria[c], fila.itens.length)),
      foraDaFila: porCatalogo(MOTIVOS_FORA_DA_FILA, (m) => disponivel({ id: `fila.fora.${m}`, descricao: `contas fora da fila pelo motivo ${m}`, unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.foraDaFila.filter((f) => f.motivo === m).length, radar.empresas.length)),
      // a fila já vem ordenada pela autoridade: o Diretor só corta, nunca reordena
      referencias: fila.itens.slice(0, limite).map((i) => ({ posicao: i.posicao, empresaId: i.empresaId, categoria: i.categoria, porQueAgora: i.porQueAgora.codigo, ...(i.porQueAgora.referencia ? { referencia: { ...i.porQueAgora.referencia } } : {}) })),
    };
  }

  function blocoBase(): BlocoBaseCD {
    const fora = (m: (typeof MOTIVOS_FORA_DA_FILA)[number]) => fila.foraDaFila.filter((f) => f.motivo === m).length;
    return {
      empresasRadar: disponivel({ id: 'base.empresasRadar', descricao: 'empresas no Radar (todas)', unidade: 'CONTAS', autoridade: 'RADAR' }, radar.empresas.length),
      empresasAtivas: disponivel({ id: 'base.empresasAtivas', descricao: 'empresas ativas e não mescladas', unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, radar.empresas.length - fora('EMPRESA_MESCLADA') - fora('EMPRESA_INATIVA'), radar.empresas.length),
      naFila: disponivel({ id: 'base.naFila', descricao: 'empresas com entrada na Commercial Queue', unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.itens.length, radar.empresas.length),
      foraDaFila: disponivel({ id: 'base.foraDaFila', descricao: 'empresas fora da Commercial Queue (qualquer motivo)', unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.foraDaFila.length, radar.empresas.length),
      porClasseRadar: porCatalogo(CLASSES_RADAR, (c) => disponivel({ id: `base.classe.${c}`, descricao: `empresas ativas com classe ${c} no Radar`, unidade: 'CONTAS', autoridade: 'RADAR' }, ativas.filter((e) => e.priorityClass === c).length, nAtivas)),
    };
  }

  function blocoDecisores(): BlocoDecisoresCD {
    const contatosAtivasPor = new Map<string, RadarDataset['contatos']>();
    for (const c of radar.contatos) if (idsAtivas.has(c.empresaId)) { const l = contatosAtivasPor.get(c.empresaId); if (l) l.push(c); else contatosAtivasPor.set(c.empresaId, [c]); }
    const contar = (p: (cs: RadarDataset['contatos']) => boolean) => ativas.filter((e) => p(contatosAtivasPor.get(e.id) ?? [])).length;
    const cobertura = ativas.map((e) => coberturaEmpresa(e, radar).nivel);
    const itens = fila.itens.length;
    return {
      comAlgumContatoAtivo: disponivel({ id: 'decisores.comAlgumContatoAtivo', descricao: 'empresas ativas com ao menos um contato ativo (qualquer cargo)', unidade: 'CONTAS', autoridade: 'CONTATOS' }, contar((cs) => cs.some((c) => c.ativo)), nAtivas),
      comDecisorMarcado: disponivel({ id: 'decisores.comDecisorMarcado', descricao: 'empresas ativas com ao menos um contato ativo marcado como decisor', unidade: 'CONTAS', autoridade: 'CONTATOS' }, contar((cs) => cs.some((c) => c.ativo && c.decisor)), nAtivas),
      comContatoElegivel: disponivel({ id: 'decisores.comContatoElegivel', descricao: 'empresas ativas com ao menos um contato elegível (contatoElegivel: ativo, situação ATIVO, sem não-contatar/opt-out)', unidade: 'CONTAS', autoridade: 'CONTATOS' }, contar((cs) => cs.some((c) => contatoElegivel(c, radar.supressoes))), nAtivas),
      comContatoRecomendado: disponivel({ id: 'decisores.comContatoRecomendado', descricao: 'empresas ativas com contato recomendado (coberturaEmpresa ≠ NO_CONTACT)', unidade: 'CONTAS', autoridade: 'COBERTURA' }, cobertura.filter((n) => n !== 'NO_CONTACT').length, nAtivas),
      porNivelCobertura: porCatalogo(NIVEIS_COBERTURA, (n) => disponivel({ id: `decisores.cobertura.${n}`, descricao: `empresas ativas no nível de cobertura ${n}`, unidade: 'CONTAS', autoridade: 'COBERTURA' }, cobertura.filter((x) => x === n).length, nAtivas)),
      filaComCanalAcionavel: disponivel({ id: 'decisores.filaComCanalAcionavel', descricao: 'contas da fila cujo contato da fila tem ao menos um canal acionável', unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.itens.filter((i) => (i.contato?.canais.length ?? 0) > 0).length, itens),
      prontasParaContato: disponivel({ id: 'decisores.prontasParaContato', descricao: 'contas da fila cujo Action Plan está em modo CONTATO', unidade: 'CONTAS', autoridade: 'ACTION_PLAN' }, planos.filter((p) => p.modo === 'CONTATO').length, itens),
    };
  }

  function blocoAtividade(): BlocoAtividadeCD {
    const doRadar = radar.atividades.filter((a) => idsAtivas.has(a.empresaId));
    const toques = doRadar.filter((a) => a.tipo !== 'NOTE');
    const ate = (a: { ocorreuEm: string }) => dia(a.ocorreuEm) <= d0;
    const historicos = ativas.map((e) => historicoDe(radar.atividades, e.id));
    const tocadas = historicos.filter((h) => h.tentativas > 0).length;
    const sentimento = new Map(radar.tiposResposta.map((t) => [t.codigo, t.sentimento]));
    const comResultado = toques.filter((a) => !!a.resultado);
    const vencidas = new Set(fila.itens.flatMap((i) => razoesDoItem(i).filter((r) => r.codigo === 'TAREFA_VENCIDA' && r.referencia?.tipo === 'tarefa').map((r) => r.referencia!.id)));
    const modo = resumoPorModoCM(planos);
    const DA = { unidade: 'ATIVIDADES', autoridade: 'HISTORICO_CONTATO' } as const;
    return {
      atividadesRegistradas: disponivel({ id: 'atividade.registradas', descricao: 'atividades registradas em empresas ativas (inclui notas)', unidade: 'ATIVIDADES', autoridade: 'RADAR' }, doRadar.length),
      notas: disponivel({ id: 'atividade.notas', descricao: 'notas (NOTE): registro administrativo, não é toque comercial', unidade: 'ATIVIDADES', autoridade: 'RADAR' }, doRadar.length - toques.length, doRadar.length),
      toquesComerciais: disponivel({ id: 'atividade.toques', descricao: 'toques comerciais: atividades diferentes de NOTE (mesma regra de historicoDe)', ...DA }, toques.length, doRadar.length),
      toquesPorTipo: porCatalogo(TIPOS_ATIVIDADE, (t) => t === 'NOTE'
        ? insuficiente({ id: 'atividade.tipo.NOTE', descricao: 'NOTE não é toque comercial', ...DA }, 'NOTE é registro administrativo; não entra na contagem de toques')
        : disponivel({ id: `atividade.tipo.${t}`, descricao: `toques do tipo ${t}`, ...DA }, toques.filter((a) => a.tipo === t).length, toques.length)),
      toquesRecentes: Object.fromEntries(JANELAS_TOQUE_DIAS.map((n) => [`${n}d`, disponivel({ id: `atividade.toques${n}d`, descricao: `toques comerciais ocorridos nos últimos ${n} dias (até hoje, inclusive)`, ...DA }, toques.filter((a) => ate(a) && diasEntre(dia(a.ocorreuEm), d0) <= n).length, toques.length)])) as BlocoAtividadeCD['toquesRecentes'],
      reunioes: disponivel({ id: 'atividade.reunioes', descricao: 'reuniões realizadas (atividade MEETING)', ...DA }, toques.filter((a) => a.tipo === 'MEETING').length, toques.length),
      toquesComResultado: disponivel({ id: 'atividade.toquesComResultado', descricao: 'toques com resultado registrado', ...DA }, comResultado.length, toques.length),
      respostasPositivas: radar.tiposResposta.length
        ? disponivel({ id: 'atividade.respostasPositivas', descricao: 'toques com resultado de sentimento positivo (catálogo radar_response_type)', ...DA }, comResultado.filter((a) => sentimento.get(a.resultado!) === 'positivo').length, comResultado.length)
        : insuficiente({ id: 'atividade.respostasPositivas', descricao: 'toques com resultado de sentimento positivo', ...DA }, 'catálogo de tipos de resposta não carregado'),
      contasTocadas: disponivel({ id: 'atividade.contasTocadas', descricao: 'empresas ativas com ao menos um toque comercial (historicoDe.tentativas > 0)', unidade: 'CONTAS', autoridade: 'HISTORICO_CONTATO' }, tocadas, nAtivas),
      contasNuncaTocadas: disponivel({ id: 'atividade.contasNuncaTocadas', descricao: 'empresas ativas sem nenhum toque comercial', unidade: 'CONTAS', autoridade: 'HISTORICO_CONTATO' }, nAtivas - tocadas, nAtivas),
      tarefasAbertas: disponivel({ id: 'atividade.tarefasAbertas', descricao: 'tarefas abertas em empresas ativas', unidade: 'TAREFAS', autoridade: 'RADAR' }, radar.tarefas.filter((t) => t.status === 'Aberta' && idsAtivas.has(t.empresaId)).length),
      tarefasVencidasNaFila: disponivel({ id: 'atividade.tarefasVencidasNaFila', descricao: 'tarefas com razão TAREFA_VENCIDA na Commercial Queue', unidade: 'TAREFAS', autoridade: 'COMMERCIAL_QUEUE' }, vencidas.size),
      comunicacoesPorEstado: porCatalogo(ESTADOS_COMUNICACAO, (s) => disponivel({ id: `atividade.comunicacao.${s}`, descricao: `comunicações no estado ${s}`, unidade: 'COMUNICACOES', autoridade: 'COMUNICACAO' }, radar.comunicacoes.filter((c) => c.estado === s).length, radar.comunicacoes.length)),
      planosPorModo: porCatalogo(MODOS_PLANO_CM, (m) => disponivel({ id: `atividade.plano.${m}`, descricao: `contas da fila com Action Plan no modo ${m}`, unidade: 'CONTAS', autoridade: 'ACTION_PLAN' }, modo[m], planos.length)),
      cadenciasPorEstado: porCatalogo(ESTADOS_CADENCIA_CM, (s) => disponivel({ id: `atividade.cadencia.${s}`, descricao: `contas da fila com cadência no estado ${s}`, unidade: 'CONTAS', autoridade: 'CADENCIA' }, cadencias.filter((c) => c.estado === s).length, cadencias.length)),
    };
  }

  function blocoFunil(): BlocoFunilCD {
    const ops = radar.oportunidades.filter((o) => idsAtivas.has(o.empresaId));
    const ativasOp = ops.filter((o) => estagioAtivo(o.estagio));
    const comValor = ativasOp.filter((o) => typeof o.valorEstimado === 'number');
    const opsDaFila = (codigo: CodigoRazaoCM) => new Set(fila.itens.flatMap((i) => razoesDoItem(i).filter((r) => r.codigo === codigo && r.referencia?.tipo === 'oportunidade').map((r) => r.referencia!.id))).size;
    const idsOps = new Set(ops.map((o) => o.id));
    const ganhas = ops.filter((o) => o.estagio === 'WON').length;
    const perdidas = ops.filter((o) => o.estagio === 'LOST').length;
    const contasComOportunidade = new Set(ops.map((o) => o.empresaId));
    const tocadas = ativas.filter((e) => historicoDe(radar.atividades, e.id).tentativas > 0);
    const O = { unidade: 'OPORTUNIDADES', autoridade: 'RADAR' } as const;
    return {
      oportunidades: disponivel({ id: 'funil.oportunidades', descricao: 'oportunidades de empresas ativas (todas as fases)', ...O }, ops.length),
      ativas: disponivel({ id: 'funil.ativas', descricao: 'oportunidades em estágio ativo (nem WON, nem LOST, nem NURTURE)', ...O }, ativasOp.length, ops.length),
      porEstagio: porCatalogo(ESTAGIOS, (s) => disponivel({ id: `funil.estagio.${s}`, descricao: `oportunidades no estágio ${s}`, ...O }, ops.filter((o) => o.estagio === s).length, ops.length)),
      valorEstimadoAtivas: comValor.length
        ? disponivel({ id: 'funil.valorEstimadoAtivas', descricao: 'soma do valor estimado das oportunidades ativas que têm valor', unidade: 'BRL', autoridade: 'RADAR' }, comValor.reduce((s, o) => s + (o.valorEstimado as number), 0), comValor.length)
        : insuficiente({ id: 'funil.valorEstimadoAtivas', descricao: 'soma do valor estimado das oportunidades ativas que têm valor', unidade: 'BRL', autoridade: 'RADAR' }, ativasOp.length ? 'nenhuma oportunidade ativa tem valor estimado' : 'não há oportunidade ativa', 0),
      ativasSemValor: disponivel({ id: 'funil.ativasSemValor', descricao: 'oportunidades ativas sem valor estimado', ...O }, ativasOp.length - comValor.length, ativasOp.length),
      semProximaAcao: disponivel({ id: 'funil.semProximaAcao', descricao: 'oportunidades ativas sem próxima ação nem tarefa aberta (semProximaAcao, a mesma primitiva da fila)', ...O }, ativasOp.filter((o) => semProximaAcao(o, radar.tarefas)).length, ativasOp.length),
      paradasNaFila: disponivel({ id: 'funil.paradasNaFila', descricao: 'oportunidades com razão OPORTUNIDADE_PARADA na fila (SLA da hipótese CM)', unidade: 'OPORTUNIDADES', autoridade: 'COMMERCIAL_QUEUE' }, opsDaFila('OPORTUNIDADE_PARADA'), ativasOp.length),
      paradasCriticasNaFila: disponivel({ id: 'funil.paradasCriticasNaFila', descricao: 'oportunidades com razão OPORTUNIDADE_PARADA_CRITICA na fila', unidade: 'OPORTUNIDADES', autoridade: 'COMMERCIAL_QUEUE' }, opsDaFila('OPORTUNIDADE_PARADA_CRITICA'), ativasOp.length),
      registrosDeEstagio: disponivel({ id: 'funil.registrosDeEstagio', descricao: 'registros de mudança de estágio das oportunidades de empresas ativas', unidade: 'REGISTROS_ESTAGIO', autoridade: 'RADAR' }, radar.historicoEstagios.filter((h) => idsOps.has(h.oportunidadeId)).length),
      ganhas: disponivel({ id: 'funil.ganhas', descricao: 'oportunidades em WON', ...O }, ganhas, ops.length),
      perdidas: disponivel({ id: 'funil.perdidas', descricao: 'oportunidades em LOST', ...O }, perdidas, ops.length),
      taxaGanhoSobreFechadas: taxa({ id: 'funil.taxaGanhoSobreFechadas', descricao: 'WON ÷ (WON + LOST)', autoridade: 'RADAR' }, ganhas, ganhas + perdidas),
      taxaContaTocadaParaOportunidade: taxa({ id: 'funil.taxaContaTocadaParaOportunidade', descricao: 'empresas tocadas com oportunidade ÷ empresas tocadas', autoridade: 'RADAR' }, tocadas.filter((e) => contasComOportunidade.has(e.id)).length, tocadas.length),
    };
  }

  function blocoProspeccao(): BlocoProspeccaoCD {
    const m = metricasPiloto(radar, d0);
    const itensFila = filaDeRevisao(radar);
    const c = contadoresRevisao(itensFila, d0);
    const LE = { unidade: 'CANDIDATOS', autoridade: 'LEAD_ENGINE' } as const;
    return {
      fontesCnoAtivas: disponivel({ id: 'prospeccao.fontesCnoAtivas', descricao: 'fontes CNO ativas', unidade: 'FONTES', autoridade: 'RADAR' }, radar.fontes.filter((f) => f.tipo === 'CNO' && f.ativo).length),
      descobertos: disponivel({ id: 'prospeccao.descobertos', descricao: 'candidatos CNO gerenciados pelo Lead Engine (metricasPiloto)', ...LE }, m.descobertos),
      pendentes: disponivel({ id: 'prospeccao.pendentes', descricao: 'candidatos PENDING', ...LE }, m.pendentes, m.descobertos),
      emRevisao: disponivel({ id: 'prospeccao.emRevisao', descricao: 'candidatos REVIEW', ...LE }, m.emRevisao, m.descobertos),
      rejeitados: disponivel({ id: 'prospeccao.rejeitados', descricao: 'candidatos REJECTED', ...LE }, m.rejeitados, m.descobertos),
      promovidos: disponivel({ id: 'prospeccao.promovidos', descricao: 'candidatos RESOLVED (promovidos por decisão humana)', ...LE }, m.promovidos, m.descobertos),
      // associar × criar não é gravado no registro: metricasPiloto infere por data — não publicamos inferência
      promovidosAssociados: insuficiente({ id: 'prospeccao.promovidosAssociados', descricao: 'promovidos por associação a empresa existente', ...LE }, 'a decisão associar × criar não é gravada no registro; a separação seria inferência', m.promovidos),
      promovidosComEmpresaCriada: insuficiente({ id: 'prospeccao.promovidosComEmpresaCriada', descricao: 'promovidos que criaram empresa nova', ...LE }, 'a decisão associar × criar não é gravada no registro; a separação seria inferência', m.promovidos),
      filaDeRevisao: disponivel({ id: 'prospeccao.filaDeRevisao', descricao: 'candidatos acionáveis na fila de revisão (PENDING + REVIEW, sem suprimidos)', ...LE }, c.total),
      filaPorSinal: {
        CNO_NEW: disponivel({ id: 'prospeccao.sinal.CNO_NEW', descricao: 'candidatos da fila de revisão com sinal CNO_NEW', ...LE }, c.cnoNew, c.total),
        CNO_EXPANSION: disponivel({ id: 'prospeccao.sinal.CNO_EXPANSION', descricao: 'candidatos da fila de revisão com sinal CNO_EXPANSION', ...LE }, c.cnoExpansion, c.total),
      },
      filaPorDescoberta: {
        hoje: disponivel({ id: 'prospeccao.descobertos.hoje', descricao: 'candidatos da fila descobertos pelo EIFF hoje (data local)', ...LE }, c.hoje, c.total),
        '7d': disponivel({ id: 'prospeccao.descobertos.7d', descricao: 'candidatos da fila descobertos nos últimos 7 dias', ...LE }, c['7d'], c.total),
        '30d': disponivel({ id: 'prospeccao.descobertos.30d', descricao: 'candidatos da fila descobertos nos últimos 30 dias', ...LE }, c['30d'], c.total),
        '90d': disponivel({ id: 'prospeccao.descobertos.90d', descricao: 'candidatos da fila descobertos nos últimos 90 dias', ...LE }, c['90d'], c.total),
      },
      suprimidos: disponivel({ id: 'prospeccao.suprimidos', descricao: 'redescobertas de contas suprimidas (fora da fila acionável)', ...LE }, descobertasSuprimidas(radar).length),
    };
  }

  function blocoQualidade(): BlocoQualidadeCD {
    const itens = fila.itens.length;
    const contatosAtivas = radar.contatos.filter((c) => idsAtivas.has(c.empresaId));
    return {
      duplicatasPendentes: disponivel({ id: 'qualidade.duplicatasPendentes', descricao: 'possíveis duplicatas pendentes de revisão', unidade: 'DUPLICATAS', autoridade: 'RADAR' }, radar.duplicatas.filter((x) => x.status === 'pendente').length),
      supressoesPorTipo: porCatalogo(TIPOS_SUPRESSAO, (t) => disponivel({ id: `qualidade.supressao.${t}`, descricao: `supressões do tipo ${t}`, unidade: 'SUPRESSOES', autoridade: 'RADAR' }, radar.supressoes.filter((s) => s.tipo === t).length, radar.supressoes.length)),
      contatosInelegiveis: disponivel({ id: 'qualidade.contatosInelegiveis', descricao: 'contatos de empresas ativas que não são elegíveis (contatoElegivel)', unidade: 'CONTATOS', autoridade: 'CONTATOS' }, contatosAtivas.filter((c) => !contatoElegivel(c, radar.supressoes)).length, contatosAtivas.length),
      sinaisNaoVerificados: disponivel({ id: 'qualidade.sinaisNaoVerificados', descricao: 'sinais de empresas ativas ainda não verificados', unidade: 'SINAIS', autoridade: 'RADAR' }, radar.sinais.filter((s) => idsAtivas.has(s.empresaId) && !s.verificado).length, radar.sinais.filter((s) => idsAtivas.has(s.empresaId)).length),
      travasNaFila: porCatalogo(CODIGOS_TRAVA_CM, (t) => disponivel({ id: `qualidade.trava.${t}`, descricao: `contas da fila com a trava ${t}`, unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.itens.filter((i) => i.travas.some((x) => x.codigo === t)).length, itens)),
      dadoFaltanteNaFila: porCatalogo(RAZOES_DADO_FALTANTE, (r) => disponivel({ id: `qualidade.razao.${r}`, descricao: `contas da fila com a razão ${r} (principal ou secundária)`, unidade: 'CONTAS', autoridade: 'COMMERCIAL_QUEUE' }, fila.itens.filter((i) => razoesDoItem(i).some((x) => x.codigo === r)).length, itens)),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Inbox — somente contagens estruturadas; nunca corpo de mensagem, nome ou telefone
// ---------------------------------------------------------------------------------------------------------------------
function blocoInbox(opcoes: OpcoesSnapshotCD): BlocoInboxCD {
  const ib = opcoes.inbox;
  const T = { unidade: 'THREADS', autoridade: 'INBOX' } as const;
  if (!ib || ib.origem === 'vazio') {
    const motivo = !ib ? 'Inbox não carregado neste contexto' : 'Inbox carregado vazio (nada lido do banco)';
    const falta = (id: string, descricao: string, unidade: 'THREADS' | 'CONTATOS' = 'THREADS') => insuficiente({ id, descricao, unidade, autoridade: 'INBOX' }, motivo);
    return {
      disponivel: false,
      origem: ib ? ib.origem : 'AUSENTE',
      threadsVisiveis: falta('inbox.threadsVisiveis', 'threads visíveis no recorte do usuário'),
      porContexto: porCatalogo(CONTEXTOS_COMUNICACAO, (c) => falta(`inbox.contexto.${c}`, `threads no contexto ${c}`)),
      porStatus: porCatalogo(STATUS_THREAD, (s) => falta(`inbox.status.${s}`, `threads no status ${s}`)),
      externasPorIntencao: {},
      externasSemClassificacao: falta('inbox.externasSemClassificacao', 'threads EXTERNAL sem classificação'),
      comPrimeiraResposta: falta('inbox.comPrimeiraResposta', 'threads com primeira resposta registrada'),
      slaVencido: falta('inbox.slaVencido', 'threads abertas com SLA de primeira resposta vencido'),
      contatosVinculadosAoRadar: falta('inbox.contatosVinculadosAoRadar', 'contatos do Inbox com vínculo explícito a empresa do Radar', 'CONTATOS'),
      threadsPorContaRadar: falta('inbox.threadsPorContaRadar', 'threads cujo contato tem vínculo explícito com empresa do Radar'),
    };
  }
  const threads = ib.threads;
  const externas = threads.filter((t) => t.contexto === 'EXTERNAL');
  const intencoes = chavesOrdenadas(externas.flatMap((t) => (t.classificacao?.intencao ? [t.classificacao.intencao] : [])));
  const vinculados = new Set(ib.contatos.filter((c) => !!c.empresaRadarId).map((c) => c.id));
  const comConta = threads.filter((t) => vinculados.has(t.contatoId)).length;
  return {
    disponivel: true,
    origem: ib.origem,
    threadsVisiveis: disponivel({ id: 'inbox.threadsVisiveis', descricao: 'threads visíveis no recorte do usuário (o RLS já filtrou)', ...T }, threads.length),
    porContexto: porCatalogo(CONTEXTOS_COMUNICACAO, (c) => disponivel({ id: `inbox.contexto.${c}`, descricao: `threads no contexto ${c}`, ...T }, threads.filter((t) => t.contexto === c).length, threads.length)),
    porStatus: porCatalogo(STATUS_THREAD, (s) => disponivel({ id: `inbox.status.${s}`, descricao: `threads no status ${s}`, ...T }, threads.filter((t) => t.status === s).length, threads.length)),
    externasPorIntencao: Object.fromEntries(intencoes.map((i) => [i, disponivel({ id: `inbox.intencao.${i}`, descricao: `threads EXTERNAL classificadas com a intenção ${i}`, ...T }, externas.filter((t) => t.classificacao?.intencao === i).length, externas.length)])),
    externasSemClassificacao: disponivel({ id: 'inbox.externasSemClassificacao', descricao: 'threads EXTERNAL sem classificação', ...T }, externas.filter((t) => !t.classificacao?.intencao).length, externas.length),
    comPrimeiraResposta: disponivel({ id: 'inbox.comPrimeiraResposta', descricao: 'threads com primeira resposta registrada no SLA', ...T }, threads.filter((t) => !!t.sla?.primeiraRespostaEm).length, threads.length),
    slaVencido: opcoes.agoraIso && Number.isFinite(Date.parse(opcoes.agoraIso))
      ? disponivel({ id: 'inbox.slaVencido', descricao: 'threads com SLA de primeira resposta vencido (estadoSla)', ...T }, threads.filter((t) => estadoSla(t, opcoes.agoraIso!) === 'vencido').length, threads.length)
      : insuficiente({ id: 'inbox.slaVencido', descricao: 'threads com SLA de primeira resposta vencido (estadoSla)', ...T }, 'instante de referência (agoraIso) não informado', threads.length),
    contatosVinculadosAoRadar: disponivel({ id: 'inbox.contatosVinculadosAoRadar', descricao: 'contatos do Inbox com vínculo explícito a empresa do Radar', unidade: 'CONTATOS', autoridade: 'INBOX' }, vinculados.size, ib.contatos.length),
    threadsPorContaRadar: vinculados.size
      ? disponivel({ id: 'inbox.threadsPorContaRadar', descricao: 'threads cujo contato tem vínculo explícito com empresa do Radar', ...T }, comConta, threads.length)
      : insuficiente({ id: 'inbox.threadsPorContaRadar', descricao: 'threads cujo contato tem vínculo explícito com empresa do Radar', ...T }, 'nenhum contato do Inbox tem vínculo com empresa do Radar; não se infere por telefone, nome ou texto', threads.length),
  };
}

/** Todas as medidas do snapshot, achatadas (para auditoria e testes). */
export function medidasDoSnapshotCD(s: CommercialDirectorSnapshot): MedidaComercial[] {
  const out: MedidaComercial[] = [];
  const visitar = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visitar); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'string' && typeof o.estado === 'string' && typeof o.autoridade === 'string') { out.push(o as unknown as MedidaComercial); return; }
    for (const k of Object.keys(o)) visitar(o[k]);
  };
  visitar(s);
  return out;
}
