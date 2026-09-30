// UX-P07 — Produção compacto: view-model puro do piloto (somente leitura, isolado, sem integração ao App).
//
// Mesma filosofia dos pilotos de Financeiro, Obras e Compras: SITUACAO (poucos numeros canonicos) → lista curta (obras
// na Diretoria, ordens abertas na Operacao) → PENDENCIAS (fatos da producao) → COMPOSICAO em gaveta, so quando pedida →
// FRESCOR e SINCRONIZACAO separados.
//
// Este modulo NAO calcula nada de producao. Ele SELECIONA, AGRUPA, ORDENA e ROTULA o que o core ja devolve:
// `resumoProducao`/`calcOrdem` (obras), `resumoPeso`/`calcConjunto` (materiais), `resumoProdutividade`/`calcRomaneio`
// (producao), `obra360` e `executarChecks` (engine), `consumoAco` (estoque), `analisarObra` (analise) e `sugestoesPara`.
//
// AGREGACAO: os agregadores canonicos recebem a colecao JA FILTRADA pelas obras visiveis (`resumoProducao(ordens, ...)`,
// `resumoPeso(conjuntos)`, `resumoProdutividade({ apontamentosEstacao, colaboradores }, ...)`), que e a assinatura real
// do core. O piloto nao soma nada entre obras: quando a carteira inteira nao e visivel, o numero e rotulado "obras
// visiveis", nunca "carteira inteira". Dados so globais (checks ALT-07/ALT-09 e a sugestao `ordens-sem-data`) so
// aparecem com a carteira completa.
//
// SEVERIDADE: producao nao tem severidade canonica propria para ordem, peso, romaneio ou produtividade. Pendencias sao
// fatos NEUTROS, sem tom, sem score e sem prioridade: a ordem e a do catalogo (`TIPOS_PENDENCIA`). So tres fontes
// canonicas trazem tom e o preservam 1:1: sugestoes do core (`tom`), checks do motor (`status`) e pontos individuais de
// `analisarObra` com tema "Produção" (`sinal`). O semaforo geral da obra nunca e usado.
//
// SEMANTICA: fabricacao e montagem nunca sao somadas; fabricado, expedido e montado sao pesos distintos; ordem sem data
// de necessidade nao e ordem atrasada; o percentual da ordem e por etapas, nao por kg; kg/HH e "kg processado por HH"
// (soma o peso de todas as estacoes da linha) e fica so na composicao; nao existe bloqueio de producao, falta de
// material, disponivel nem ligacao producao → compra no core, e o piloto nao os cria.
//
// VISIBILIDADE: o modelo recebe `codigosObraVisiveis` e limita a apresentacao a esse conjunto. Ele nao decide quem ve o
// que: numa integracao futura o conjunto vira da regra oficial do App.
import { addDays, calcLancamentos, executarChecks, fmtBr, obra360, type Obra360 } from '../../core/engine';
import { resumoProducao, type OrdemCalc, type ResumoProducao } from '../../core/obras';
import { resumoPeso, type ResumoPeso } from '../../core/materiais';
import { calcRomaneio, resumoProdutividade, type ResumoProdutividade } from '../../core/producao';
import { consumoAco } from '../../core/estoque';
import { analisarObra, type Ponto } from '../../core/analise';
import { sugestoesPara } from '../../core/sugestoes';
import type { Dataset, Obra, TipoOrdem, Usuario } from '../../core/types';

export const VERSAO_PILOTO = 'UX-P07';
export const TETO_SITUACAO: Record<Visao, number> = { diretoria: 3, operacao: 4 };
export const TETO_PENDENCIAS = 6;
export const TETO_ORDENS = 8;
/** Mesmo periodo padrao da tela Fabrica e montagem (Producao.tsx: data-base − 30 dias ate a data-base). */
export const DIAS_PERIODO_PRODUTIVIDADE = 30;
export const TEXTO_SEM_LISTA = 'sem lista de materiais';
export const TEXTO_SEM_ORDENS = 'sem ordens';
export const ROTULO_KG_HH = 'kg processado por HH';
export const ROTULO_ESCOPO_PARCIAL = 'obras visíveis';

export type Visao = 'diretoria' | 'operacao';
export const VISOES: { id: Visao; rotulo: string; descricao: string }[] = [
  { id: 'diretoria', rotulo: 'Diretoria', descricao: 'Peso fabricado, peso montado e ordens atrasadas, com uma linha por obra.' },
  { id: 'operacao', rotulo: 'Operação', descricao: 'Ordens em andamento e atrasadas, peso em fábrica e em canteiro, ordem a ordem.' },
];

/** Status de ordem que ainda tem etapa pela frente (entra na lista de ordens abertas). */
export const STATUS_ABERTA: OrdemCalc['status'][] = ['Não iniciada', 'Em andamento'];

/** Catalogo de pendencias. A ordem e so a do catalogo (nao e prioridade). Os sete primeiros sao fatos neutros. */
export const TIPOS_PENDENCIA = ['ordem-atrasada', 'servico-em-risco', 'peso-em-fabrica', 'peso-em-canteiro', 'kghh-abaixo-meta', 'romaneio-emitido', 'conjunto-nao-liberado', 'sugestao-ordens-sem-data', 'sugestao-parados', 'sugestao-datas', 'check-alt-07', 'check-alt-09'] as const;
export type TipoPendencia = (typeof TIPOS_PENDENCIA)[number];
export const TIPOS_NEUTROS: TipoPendencia[] = ['ordem-atrasada', 'servico-em-risco', 'peso-em-fabrica', 'peso-em-canteiro', 'kghh-abaixo-meta', 'romaneio-emitido', 'conjunto-nao-liberado'];
export const ROTULO_PENDENCIA: Record<TipoPendencia, string> = {
  'ordem-atrasada': 'Ordem atrasada (data de necessidade vencida)',
  'servico-em-risco': 'Serviço com situação de prazo "Em risco" (calcServico)',
  'peso-em-fabrica': 'Peso fabricado ainda não expedido',
  'peso-em-canteiro': 'Peso expedido ainda não montado',
  'kghh-abaixo-meta': `${ROTULO_KG_HH} abaixo da meta`,
  'romaneio-emitido': 'Romaneio emitido · entrega não registrada',
  'conjunto-nao-liberado': 'Conjuntos não liberados para fabricação',
  'sugestao-ordens-sem-data': 'Sugestão do sistema · ordens sem data de necessidade',
  'sugestao-parados': 'Sugestão do sistema · serviços em andamento sem avanço',
  'sugestao-datas': 'Sugestão do sistema · serviços sem datas previstas',
  'check-alt-07': 'Check do sistema ALT-07',
  'check-alt-09': 'Check do sistema ALT-09',
};

export interface Sincronizacao { estado: 'sincronizado' | 'enviando' | 'pendente' | 'erro' | 'local'; em?: string; desde?: string; msg?: string }
export const ROTULO_SINCRONIZACAO: Record<Sincronizacao['estado'], string> = { sincronizado: 'Supabase · sincronizado', enviando: 'Supabase · sincronizando…', pendente: 'offline · alterações guardadas neste aparelho', erro: 'não sincronizado', local: 'modo local · seed' };
export interface FonteDados { rotulo: string; modo: 'teste' | 'local' | 'remoto'; atualizadoEm?: string; id?: string; sincronizacao?: Sincronizacao }

export type EntradaProducao =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'pronto'; fonte: FonteDados; ds: Dataset; usuario: Usuario; codigosObraVisiveis: string[]; agora: string; visao?: Visao };

export interface Origem { funcao: string; campo: string; regra: string; tela?: string }
export interface NumeroSituacao { rotulo: string; valor: number | null; texto: string }
export interface ParteSituacao { rotulo: string; valor: number | null; texto: string }
export type IdSituacao = 'peso-fabricado' | 'peso-montado' | 'ordens-atrasadas' | 'ordens-andamento' | 'peso-em-fabrica' | 'peso-em-canteiro';
/** Tile de situacao: sem `tom` por construcao. Fabricacao e montagem sao dois numeros, nunca um so. */
export interface ItemSituacao {
  id: IdSituacao;
  rotulo: string;
  numeros: NumeroSituacao[];
  micro: string;
  partes: ParteSituacao[];
  origem: Origem;
  composicaoId?: string;
}
export interface ResumoOrdensLinha { ordens: number; emAndamento: number; atrasadas: number; concluidas: number }
export interface LinhaObraProducao {
  codigo: string;
  nome: string;
  status: Obra['status'];
  /** Obra.responsavel, quando registrado. */
  responsavel?: string;
  /** null = obra sem lista de materiais (nunca 0 kg). */
  peso: { total: number; fabricado: number; pctFabricado: number; expedido: number; montado: number; pctMontado: number; emFabrica: number; emCanteiro: number } | null;
  /** null = obra sem ordens daquele tipo (nunca 0 ordens). */
  fabricacao: ResumoOrdensLinha | null;
  montagem: ResumoOrdensLinha | null;
  servicos: { total: number; atrasados: number; emRisco: number };
  composicoes: { id: string; rotulo: string }[];
  to: string;
}
export interface LinhaOrdem {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoOrdem;
  codigoObra: string;
  nomeObra: string;
  servico?: string;
  status: OrdemCalc['status'];
  etapaAtual?: string;
  etapas: number;
  pctConcluido: number;
  dataNecessidade?: string;
  diasParaNecessidade?: number;
  atrasada: boolean;
  quantidade: number;
  unidade: string;
  /** EtapaOrdem.responsavel da etapa atual, quando registrado. Nunca inferido. */
  responsavelEtapa?: string;
  composicaoId: string;
  to: string;
}
/** Tom preservado 1:1 de uma fonte canonica. Fatos neutros nunca tem este campo. */
export interface SinalCanonico { fonte: 'sugestao' | 'check' | 'analise'; valor: string }
export interface ItemPendencia {
  id: string;
  tipo: TipoPendencia;
  obra?: string;
  texto: string;
  impacto: string;
  detalhe?: string;
  sinal?: SinalCanonico;
  origem: Origem;
  destino?: { rotulo: string; to: string };
  composicaoId?: string;
}
export interface ParComposicao { rotulo: string; texto: string; sub?: string; to?: string; sinal?: SinalCanonico }
export interface LinhaComposicao { id: string; titulo: string; sub?: string; data?: string; valor: number | null; texto: string; to?: string }
export interface Composicao {
  id: string;
  titulo: string;
  resumo: string;
  origem: Origem;
  pares: ParComposicao[];
  colunas: { titulo: string; num?: boolean }[];
  linhas: LinhaComposicao[];
  nota?: string;
}
export interface ChipFrescor { id: string; texto: string; titulo?: string }
export interface Frescor { dataBase: string; ultimoApontamento?: string; listaAtualizadaEm?: string; fonteAtualizadaEm?: string; chips: ChipFrescor[] }
export interface Escopo { tipo: 'carteira' | 'obra' | 'visiveis'; texto: string; obras: number; totalObras: number }

export type ModeloProducao =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'vazio'; fonte: FonteDados; semObras: boolean; motivo: string; frescor: Frescor }
  | { estado: 'sem-visibilidade'; fonte: FonteDados; motivo: string; frescor: Frescor; totalObras: number }
  | {
      estado: 'pronto';
      fonte: FonteDados;
      visao: Visao;
      empresa: string;
      usuario: { nome: string; papel: string };
      carteiraCompleta: boolean;
      escopo: Escopo;
      periodo: { de: string; ate: string };
      situacao: ItemSituacao[];
      /** Os dois conjuntos de tiles, com os MESMOS objetos: a visao so escolhe quais mostrar. */
      tiles: Record<IdSituacao, ItemSituacao>;
      obras: LinhaObraProducao[];
      ordens: { compacta: LinhaOrdem[]; todas: LinhaOrdem[]; ocultas: number };
      pendencias: { compacta: ItemPendencia[]; todas: ItemPendencia[]; ocultas: number };
      composicoes: Record<string, Composicao>;
      frescor: Frescor;
    };

export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
export const num = (v: number, casas = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
export const qtd = (v: number, unidade: string) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unidade}`.trim();
export const diaMes = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const n = (q: number, s: string, p: string) => `${q.toLocaleString('pt-BR')} ${q === 1 ? s : p}`;
export function tempoRelativo(iso: string | undefined, agora: string): string {
  if (!iso) return 'desconhecido';
  const ms = Date.parse(agora) - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'desconhecido';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
const ultimaData = (datas: (string | undefined)[]) => datas.filter((d): d is string => !!d).sort().pop();

/** Data de necessidade em palavras, a partir de `calcOrdem.diasParaNecessidade` (ausente nunca vira 0 nem "atrasada"). */
export function textoNecessidade(data: string | undefined, dias: number | undefined, status?: OrdemCalc['status']): string {
  if (!data || dias === undefined) return 'sem data de necessidade';
  if (status === 'Concluída') return `necessidade ${diaMes(data)} · ordem concluída`;
  if (dias < 0) return `necessidade ${diaMes(data)} · vencida há ${n(-dias, 'dia', 'dias')}`;
  if (dias === 0) return `necessidade ${diaMes(data)} · hoje`;
  return `necessidade ${diaMes(data)} · em ${n(dias, 'dia', 'dias')}`;
}

const TELA_PRODUCAO = (obra?: string) => (obra ? `/producao?obra=${obra}` : '/producao');
const TELA_OBRA = (obra: string) => `/obras/${obra}`;

function frescorDe(ds: Dataset, aps: Dataset['apontamentosEstacao'], conjuntos: Dataset['conjuntos'], fonte: FonteDados, agora: string): Frescor {
  const ultimoApontamento = ultimaData(aps.map((a) => a.data));
  const listaAtualizadaEm = ultimaData(conjuntos.map((c) => c.atualizadoEm));
  const chips: ChipFrescor[] = [
    { id: 'base', texto: `Base ${diaMes(ds.params.dataBase)}`, titulo: `Data-base ${fmtBr(ds.params.dataBase)}: referência de "data de necessidade vencida" (calcOrdem.atrasada)` },
    ultimoApontamento ? { id: 'apontamento', texto: `Último apontamento ${diaMes(ultimoApontamento)}`, titulo: `Apontamento de estação mais recente nas obras visíveis: ${fmtBr(ultimoApontamento)}` } : { id: 'apontamento', texto: 'Sem apontamento de estação', titulo: 'Nenhum apontamento de estação nas obras visíveis.' },
    listaAtualizadaEm ? { id: 'lista', texto: `Lista de materiais atualizada ${tempoRelativo(listaAtualizadaEm, agora)}`, titulo: `Conjunto atualizado mais recente: ${new Date(listaAtualizadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` } : { id: 'lista', texto: 'Sem lista de materiais', titulo: 'Nenhum conjunto nas obras visíveis.' },
  ];
  chips.push(fonte.atualizadoEm
    ? { id: 'atualizado', texto: `Atualizado ${tempoRelativo(fonte.atualizadoEm, agora)}`, titulo: `Fonte ${fonte.rotulo}` }
    : fonte.modo === 'local' ? { id: 'atualizado', texto: 'Seed local', titulo: 'Dados do seed em modo local: não são a operação real.' }
      : fonte.modo === 'teste' ? { id: 'atualizado', texto: 'Dados de teste', titulo: 'Fixture do piloto: nenhum número é real.' }
        : { id: 'atualizado', texto: 'Atualização desconhecida', titulo: 'A fonte não informou quando foi sincronizada.' });
  return { dataBase: ds.params.dataBase, ultimoApontamento, listaAtualizadaEm, fonteAtualizadaEm: fonte.atualizadoEm, chips };
}

const resumoOrdens = (r: ResumoProducao): ResumoOrdensLinha | null => (r.ordens.length ? { ordens: r.ordens.length, emAndamento: r.emAndamento, atrasadas: r.atrasadas, concluidas: r.concluidas } : null);

function linhaOrdem(o: OrdemCalc, ds: Dataset): LinhaOrdem {
  const obra = ds.obras.find((x) => x.codigo === o.codigoObra);
  const servico = o.servicoId ? ds.servicos.find((s) => s.id === o.servicoId) : undefined;
  const etapa = o.etapaAtualIdx >= 0 ? o.etapas[o.etapaAtualIdx] : undefined;
  return {
    id: o.id, codigo: o.codigo, descricao: o.descricao, tipo: o.tipo, codigoObra: o.codigoObra, nomeObra: obra?.nome ?? o.codigoObra, servico: servico ? `${servico.codigo} · ${servico.nome}` : undefined,
    status: o.status, etapaAtual: o.etapaAtual, etapas: o.etapas.length, pctConcluido: o.pctConcluido, dataNecessidade: o.dataNecessidade, diasParaNecessidade: o.diasParaNecessidade, atrasada: o.atrasada,
    quantidade: o.quantidade, unidade: o.unidade, responsavelEtapa: etapa?.responsavel || undefined,
    composicaoId: `ordem:${o.id}`, to: TELA_OBRA(o.codigoObra),
  };
}

function composicaoOrdem(o: OrdemCalc, l: LinhaOrdem): Composicao {
  const pares: ParComposicao[] = [
    { rotulo: 'Obra', texto: `${l.codigoObra} · ${l.nomeObra}`, sub: l.servico ? `serviço ${l.servico}` : 'sem serviço vinculado', to: TELA_OBRA(o.codigoObra) },
    { rotulo: 'Tipo · status', texto: `${o.tipo} · ${o.status}`, sub: 'calcOrdem.status: pelas etapas da ordem' },
    { rotulo: 'Etapa atual', texto: o.etapaAtual ?? (o.status === 'Concluída' ? 'todas as etapas concluídas' : '—'), sub: l.responsavelEtapa ? `responsável registrado na etapa: ${l.responsavelEtapa}` : 'responsável não registrado na etapa' },
    { rotulo: 'Por etapas', texto: pct(o.pctConcluido), sub: 'calcOrdem.pctConcluido = etapas concluídas ÷ etapas; não é peso nem quantidade' },
    { rotulo: 'Necessidade', texto: textoNecessidade(o.dataNecessidade, o.diasParaNecessidade, o.status), sub: o.dataNecessidade ? 'calcOrdem.diasParaNecessidade = data de necessidade − data-base' : 'sem data de necessidade: a ordem não é considerada atrasada' },
    { rotulo: 'Quantidade', texto: qtd(o.quantidade, o.unidade), sub: 'OrdemProducao.quantidade na unidade da ordem' },
    { rotulo: 'Criada por', texto: o.criadoPor || 'não registrado', sub: `OrdemProducao.criadoPor · ${fmtBr(o.criadoEm.slice(0, 10))}` },
  ];
  return {
    id: l.composicaoId, titulo: `Ordem ${o.codigo} · ${o.descricao}`, resumo: `${o.tipo} · ${o.status} · ${n(o.etapas.length, 'etapa', 'etapas')}`,
    origem: { funcao: 'calcOrdem(ordem, dataBase)', campo: 'etapas[] · status · etapaAtual · pctConcluido · atrasada · diasParaNecessidade', regra: 'atrasada = não concluída, não cancelada e data de necessidade antes da data-base', tela: TELA_OBRA(o.codigoObra) },
    pares,
    colunas: [{ titulo: 'Etapa · status · responsável' }, { titulo: 'Conclusão' }, { titulo: 'Concluído', num: true }],
    linhas: o.etapas.map((e, i) => ({
      id: `${o.id}:${i}`, titulo: e.nome,
      sub: `${e.status} · ${e.responsavel ? `responsável ${e.responsavel}` : 'responsável não registrado'}${e.inicio ? ` · início ${fmtBr(e.inicio)}` : ''}`,
      data: e.fim, valor: e.quantidadeConcluida, texto: qtd(e.quantidadeConcluida, o.unidade),
    })),
  };
}

function linhasPeso(r: ResumoPeso) {
  return [
    { rotulo: 'Peso da lista', texto: kg(r.pesoTotal), sub: `ResumoPeso.pesoTotal · ${n(r.conjuntos.length, 'marca', 'marcas')} · ${n(r.pecas, 'peça', 'peças')}` },
    { rotulo: 'Liberado', texto: `${kg(r.pesoLiberado)} · ${pct(r.pctLiberado)}`, sub: 'ResumoPeso.pesoLiberado: conjuntos com liberação para fabricação' },
    { rotulo: 'Fabricado', texto: `${kg(r.pesoFabricado)} · ${pct(r.pctFabricado)}`, sub: 'ResumoPeso.pesoFabricado' },
    { rotulo: 'Expedido', texto: `${kg(r.pesoExpedido)} · ${pct(r.pctExpedido)}`, sub: 'ResumoPeso.pesoExpedido' },
    { rotulo: 'Montado', texto: `${kg(r.pesoMontado)} · ${pct(r.pctMontado)}`, sub: 'ResumoPeso.pesoMontado' },
    { rotulo: 'Em fábrica', texto: kg(r.emFabrica), sub: 'ResumoPeso.emFabrica = fabricado e ainda não expedido' },
    { rotulo: 'Em canteiro', texto: kg(r.emCanteiro), sub: 'ResumoPeso.emCanteiro = expedido e ainda não montado; não é montagem concluída' },
  ];
}

function composicaoPesoObra(obra: Obra, r: ResumoPeso, ds: Dataset): Composicao {
  const nomeSrv = (id: string) => { const s = ds.servicos.find((x) => x.id === id); return s ? `${s.codigo} · ${s.nome}` : id; };
  return {
    id: `obra-peso:${obra.codigo}`, titulo: `Peso da lista · ${obra.nome}`, resumo: `${kg(r.pesoTotal)} na lista · fabricado ${pct(r.pctFabricado)} · montado ${pct(r.pctMontado)}`,
    origem: { funcao: 'obra360(ds, obra).peso = resumoPeso(conjuntos da obra)', campo: 'pesoTotal · pesoLiberado · pesoFabricado · pesoExpedido · pesoMontado · emFabrica · emCanteiro · porServico', regra: 'peso por marco da lista de materiais (calcConjunto); não é percentual financeiro', tela: TELA_OBRA(obra.codigo) },
    pares: linhasPeso(r),
    colunas: [{ titulo: 'Serviço · fabricado / montado' }, { titulo: '' }, { titulo: 'Peso da lista', num: true }],
    linhas: r.porServico.map((s) => ({ id: s.servicoId, titulo: nomeSrv(s.servicoId), sub: `fabricado ${kg(s.pesoFabricado)} · montado ${kg(s.pesoMontado)}`, valor: s.pesoTotal, texto: kg(s.pesoTotal) })),
    nota: 'Por serviço o core separa fabricado e montado, mas não o expedido. Conjuntos sem serviço não entram nesta tabela.',
  };
}

function composicaoConjuntos(obra: Obra, r: ResumoPeso): Composicao {
  const situacoes = ['Não liberado', 'Liberado', 'Em fabricação', 'Fabricado', 'Expedido', 'Montado'] as const;
  return {
    id: `conjuntos:${obra.codigo}`, titulo: `Conjuntos · ${obra.nome}`, resumo: `${n(r.conjuntos.length, 'marca', 'marcas')} na lista de materiais`,
    origem: { funcao: 'calcConjunto(conjunto) via resumoPeso', campo: 'situacao · pesoTotal · fabricadoQtd · expedidoQtd · montadoQtd · liberadoEm', regra: 'situação do conjunto pelo marco mais avançado registrado', tela: TELA_OBRA(obra.codigo) },
    pares: situacoes.map((s) => ({ rotulo: s, texto: n(r.conjuntos.filter((c) => c.situacao === s).length, 'marca', 'marcas'), sub: 'marcas desta obra nesta situação (calcConjunto.situacao)' })),
    colunas: [{ titulo: 'Marca · situação · peças' }, { titulo: 'Liberação' }, { titulo: 'Peso', num: true }],
    linhas: r.conjuntos.map((c) => ({ id: c.id, titulo: `${c.marca} · ${c.descricao}`, sub: `${c.tipo} · ${c.situacao} · ${n(c.quantidade, 'peça', 'peças')} · fabricadas ${c.fabricadoQtd} · expedidas ${c.expedidoQtd} · montadas ${c.montadoQtd}`, data: c.liberadoEm, valor: c.pesoTotal, texto: kg(c.pesoTotal) })),
  };
}

function composicaoProducaoObra(o: Obra360, pontos: Ponto[], ds: Dataset): Composicao {
  const lin = (r: ResumoProducao, tipo: string) => (r.ordens.length ? `${n(r.ordens.length, 'ordem', 'ordens')} · ${r.emAndamento} em andamento · ${r.atrasadas} atrasada(s) · ${r.concluidas} concluída(s)` : `${TEXTO_SEM_ORDENS} de ${tipo.toLowerCase()}`);
  const ordens = [...o.fabricacao.ordens, ...o.montagem.ordens];
  const pares: ParComposicao[] = [
    { rotulo: 'Fabricação', texto: lin(o.fabricacao, 'Fabricação'), sub: 'obra360.fabricacao = resumoProducao(ordens, Fabricação, dataBase, obra)' },
    { rotulo: 'Montagem', texto: lin(o.montagem, 'Montagem'), sub: 'obra360.montagem = resumoProducao(ordens, Montagem, dataBase, obra)' },
    { rotulo: 'Serviços', texto: `${n(o.servicos.length, 'serviço', 'serviços')} · ${o.servicosAtrasados} atrasado(s) · ${o.servicosEmRisco} em risco`, sub: 'obra360.servicosAtrasados · servicosEmRisco (calcServico.situacaoPrazo). Serviço atrasado não é ordem atrasada.' },
    { rotulo: 'Responsável da obra', texto: o.obra.responsavel || 'não registrado', sub: 'Obra.responsavel' },
    ...pontos.map((p, i) => ({ rotulo: i === 0 ? 'Análise da obra · Produção' : '', texto: p.texto, sub: 'ponto de analisarObra com tema Produção; sinal preservado do core', sinal: { fonte: 'analise' as const, valor: p.sinal } })),
  ];
  return {
    id: `obra-producao:${o.obra.codigo}`, titulo: `Ordens · ${o.obra.nome}`, resumo: 'fabricação e montagem separadas; o percentual de cada ordem é por etapas',
    origem: { funcao: 'obra360(ds, obra).fabricacao · .montagem · analisarObra(ds, obra360).pontos[tema Produção]', campo: 'ordens[] · emAndamento · atrasadas · concluidas', regra: 'ordem atrasada = data de necessidade vencida e ordem não concluída; ordem sem data nunca é atrasada', tela: TELA_OBRA(o.obra.codigo) },
    pares,
    colunas: [{ titulo: 'Ordem · tipo · etapa' }, { titulo: 'Necessidade' }, { titulo: 'Por etapas', num: true }],
    linhas: ordens.map((r) => ({ id: r.id, titulo: `${r.codigo} · ${r.descricao}`, sub: `${r.tipo} · ${r.status}${r.etapaAtual ? ` · etapa ${r.etapaAtual}` : ''} · ${qtd(r.quantidade, r.unidade)}${r.dataNecessidade ? '' : ' · sem data de necessidade'}`, data: r.dataNecessidade, valor: r.pctConcluido, texto: pct(r.pctConcluido) })),
    nota: ds.ordens.some((x) => x.codigoObra === o.obra.codigo && x.cancelada) ? 'Ordens canceladas ficam fora (resumoProducao as exclui).' : undefined,
  };
}

function composicaoProdutividade(id: string, titulo: string, r: ResumoProdutividade, periodo: { de: string; ate: string }, escopo: string, tela: string): Composicao {
  const horas = (h: number) => `${num(h)} h`;
  return {
    id, titulo, resumo: `${escopo} · ${fmtBr(periodo.de)} a ${fmtBr(periodo.ate)} · ${n(r.apontamentos.length, 'apontamento', 'apontamentos')}`,
    origem: { funcao: `resumoProdutividade({ apontamentosEstacao, colaboradores }, { de, ate })`, campo: 'kgFabricados · kgExpedidos · kgMontados · horasFabrica · horasCanteiro · kgPorHHFabrica · kgPorHHCanteiro · metaFabrica · metaCanteiro · porEstacao', regra: `${ROTULO_KG_HH} soma o peso apontado em TODAS as estações da linha e divide pelas horas da linha; a meta vem de META_KG_HH (17,5 HH/t na fábrica, 26 HH/t no canteiro). Período padrão da tela Fábrica e montagem.`, tela },
    pares: [
      { rotulo: 'Período', texto: `${fmtBr(periodo.de)} a ${fmtBr(periodo.ate)}`, sub: `data-base − ${DIAS_PERIODO_PRODUTIVIDADE} dias até a data-base` },
      { rotulo: 'Fabricado (Pintura)', texto: kg(r.kgFabricados), sub: 'kgFabricados: só a estação que conclui a fabricação' },
      { rotulo: 'Expedido (Expedição)', texto: kg(r.kgExpedidos), sub: 'kgExpedidos' },
      { rotulo: 'Montado (Liberação)', texto: kg(r.kgMontados), sub: 'kgMontados' },
      { rotulo: `Fábrica · ${ROTULO_KG_HH}`, texto: r.horasFabrica ? `${num(r.kgPorHHFabrica)} kg/HH · meta ${num(r.metaFabrica)}` : 'sem horas apontadas', sub: `${horas(r.horasFabrica)} na fábrica` },
      { rotulo: `Canteiro · ${ROTULO_KG_HH}`, texto: r.horasCanteiro ? `${num(r.kgPorHHCanteiro)} kg/HH · meta ${num(r.metaCanteiro)}` : 'sem horas apontadas', sub: `${horas(r.horasCanteiro)} no canteiro` },
    ],
    colunas: [{ titulo: 'Estação · horas · peças' }, { titulo: '' }, { titulo: 'Peso processado', num: true }],
    linhas: r.porEstacao.map((e) => ({ id: e.chave, titulo: e.nome, sub: `${horas(e.horas)} · ${n(e.pecas, 'peça', 'peças')} · ${e.horas ? `${num(e.kgPorHH)} kg/HH` : 'sem horas'} · ${n(e.dias, 'dia', 'dias')} com apontamento`, valor: e.kg, texto: kg(e.kg) })),
    nota: 'O mesmo quilo passa por várias estações e é contado em cada uma: kg processado não é kg produzido. Sem custo de mão de obra e sem dados por colaborador nesta visão.',
  };
}

function composicaoRomaneios(obra: Obra, ds: Dataset): Composicao {
  const rs = ds.romaneios.filter((r) => r.codigoObra === obra.codigo).map((r) => calcRomaneio(r, ds.conjuntos)).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return {
    id: `romaneios:${obra.codigo}`, titulo: `Romaneios · ${obra.nome}`, resumo: n(rs.length, 'romaneio', 'romaneios'),
    origem: { funcao: 'calcRomaneio(romaneio, conjuntos)', campo: 'status · data · entregueEm · pesoTotal · pecas', regra: 'status do romaneio como registrado (Emitido, Entregue, Cancelado); não há cálculo de atraso de entrega', tela: TELA_PRODUCAO(obra.codigo) },
    pares: [],
    colunas: [{ titulo: 'Romaneio · status · peças' }, { titulo: 'Emissão' }, { titulo: 'Peso', num: true }],
    linhas: rs.map((r) => ({ id: r.id, titulo: `${r.numero} · ${r.status}`, sub: `${n(r.pecas, 'peça', 'peças')} · destino ${r.destino || 'não registrado'}${r.entregueEm ? ` · entregue em ${fmtBr(r.entregueEm)}` : r.status === 'Emitido' ? ' · entrega não registrada' : ''}`, data: r.data, valor: r.pesoTotal, texto: kg(r.pesoTotal) })),
  };
}

function composicaoAco(obra: Obra, ds: Dataset): Composicao {
  const c = consumoAco(ds, { codigoObra: obra.codigo });
  return {
    id: `aco:${obra.codigo}`, titulo: `Aço consumido · ${obra.nome}`, resumo: `${kg(c.total.liquidoKg)} líquidos de sobra · ${n(c.total.movimentos, 'movimento', 'movimentos')}`,
    origem: { funcao: `consumoAco(ds, { codigoObra: '${obra.codigo}' })`, campo: 'total.consumidoKg · sobraKg · liquidoKg · porServico', regra: 'consumo do estoque menos sobras devolvidas, com estornos revertidos; não é material disponível nem necessidade', tela: `/estoque?obra=${obra.codigo}` },
    pares: [
      { rotulo: 'Consumido', texto: kg(c.total.consumidoKg), sub: 'ConsumoAco.consumidoKg' },
      { rotulo: 'Sobra devolvida', texto: kg(c.total.sobraKg), sub: 'ConsumoAco.sobraKg' },
      { rotulo: 'Líquido', texto: kg(c.total.liquidoKg), sub: 'ConsumoAco.liquidoKg = consumido − sobra (core)' },
    ],
    colunas: [{ titulo: 'Serviço · movimentos' }, { titulo: '' }, { titulo: 'Líquido', num: true }],
    linhas: c.porServico.map((s) => ({ id: s.chave, titulo: s.nome, sub: n(s.movimentos, 'movimento', 'movimentos'), valor: s.liquidoKg, texto: kg(s.liquidoKg) })),
    nota: 'Estoque físico não é material disponível: o core não tem reserva, disponível nem necessidade por obra.',
  };
}

export function montarProducao(entrada: EntradaProducao): ModeloProducao {
  if (entrada.estado === 'carregando') return { estado: 'carregando', fonte: entrada.fonte };
  if (entrada.estado === 'erro') return { estado: 'erro', fonte: entrada.fonte, mensagem: entrada.mensagem, causa: entrada.causa };
  const { ds, usuario, fonte, agora, codigosObraVisiveis } = entrada;
  const visao: Visao = entrada.visao ?? 'diretoria';
  const dataBase = ds.params.dataBase;
  if (ds.obras.length === 0) return { estado: 'vazio', fonte, semObras: true, motivo: 'Nenhuma obra cadastrada nesta fonte.', frescor: frescorDe(ds, [], [], fonte, agora) };
  const visiveis = new Set(codigosObraVisiveis);
  const obrasVis = ds.obras.filter((o) => visiveis.has(o.codigo));
  if (obrasVis.length === 0) return { estado: 'sem-visibilidade', fonte, motivo: 'Nenhuma obra visível para este usuário. A visibilidade é definida pelo aplicativo, não pelo piloto.', frescor: frescorDe(ds, [], [], fonte, agora), totalObras: ds.obras.length };

  // colecoes recortadas pelo vinculo canonico com a obra (codigoObra); nada fora do conjunto visivel segue adiante
  const naObra = <T extends { codigoObra: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => visiveis.has(x.codigoObra));
  const ordensVis = naObra(ds.ordens);
  const conjuntosVis = naObra(ds.conjuntos);
  const apontamentosVis = naObra(ds.apontamentosEstacao);
  const romaneiosVis = naObra(ds.romaneios);
  const frescor = frescorDe(ds, apontamentosVis, conjuntosVis, fonte, agora);
  if ([ordensVis, conjuntosVis, apontamentosVis, romaneiosVis].every((xs) => xs.length === 0)) return { estado: 'vazio', fonte, semObras: false, motivo: 'Nenhuma ordem, lista de materiais, apontamento de estação ou romaneio nas obras visíveis.', frescor };

  // carteira completa = todas as obras E todo registro de producao numa obra visivel (so entao o global vale para quem ve)
  const carteiraCompleta = ds.obras.every((o) => visiveis.has(o.codigo))
    && [ds.ordens ?? [], ds.conjuntos ?? [], ds.apontamentosEstacao ?? [], ds.romaneios ?? []].every((xs) => xs.every((x) => visiveis.has(x.codigoObra)));
  const unica = obrasVis.length === 1 ? obrasVis[0] : undefined;
  const escopo: Escopo = carteiraCompleta ? { tipo: 'carteira', texto: 'todas as obras', obras: obrasVis.length, totalObras: ds.obras.length }
    : unica ? { tipo: 'obra', texto: `somente ${unica.codigo}`, obras: 1, totalObras: ds.obras.length }
      : { tipo: 'visiveis', texto: `${ROTULO_ESCOPO_PARCIAL} · ${obrasVis.length} de ${ds.obras.length}`, obras: obrasVis.length, totalObras: ds.obras.length };

  // ---- agregadores canonicos sobre a colecao ja filtrada (nenhuma soma no piloto) ----
  const fab = resumoProducao(ordensVis, 'Fabricação', dataBase);
  const mont = resumoProducao(ordensVis, 'Montagem', dataBase);
  const peso = resumoPeso(conjuntosVis);
  const periodo = { de: addDays(dataBase, -DIAS_PERIODO_PRODUTIVIDADE), ate: dataBase };
  const prod = resumoProdutividade({ apontamentosEstacao: apontamentosVis, colaboradores: ds.colaboradores ?? [] }, periodo);

  const lancs = calcLancamentos(ds);
  const o360 = new Map(obrasVis.map((o) => [o.codigo, obra360(ds, o, lancs)]));

  // ---- composicoes ----
  const composicoes: Record<string, Composicao> = {};
  const todasOrdens = [...fab.ordens, ...mont.ordens];
  const linhas = todasOrdens.map((o) => linhaOrdem(o, ds));
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  for (const o of todasOrdens) { const c = composicaoOrdem(o, linhaPorId.get(o.id)!); composicoes[c.id] = c; }
  for (const o of obrasVis) {
    const r = o360.get(o.codigo)!;
    const pontos = analisarObra(ds, r, lancs).pontos.filter((p) => p.tema === 'Produção');
    if (r.fabricacao.ordens.length > 0 || r.montagem.ordens.length > 0) { const c = composicaoProducaoObra(r, pontos, ds); composicoes[c.id] = c; }
    if (r.peso.conjuntos.length > 0) { const c1 = composicaoPesoObra(o, r.peso, ds); composicoes[c1.id] = c1; const c2 = composicaoConjuntos(o, r.peso); composicoes[c2.id] = c2; }
    if (apontamentosVis.some((a) => a.codigoObra === o.codigo)) {
      const rp = resumoProdutividade({ apontamentosEstacao: ds.apontamentosEstacao, colaboradores: ds.colaboradores ?? [] }, { codigoObra: o.codigo, ...periodo });
      const c = composicaoProdutividade(`produtividade:${o.codigo}`, `Produtividade · ${o.nome}`, rp, periodo, `somente ${o.codigo}`, TELA_PRODUCAO(o.codigo)); composicoes[c.id] = c;
    }
    if (romaneiosVis.some((x) => x.codigoObra === o.codigo)) { const c = composicaoRomaneios(o, ds); composicoes[c.id] = c; }
    if (r.aco.movimentos > 0) { const c = composicaoAco(o, ds); composicoes[c.id] = c; }
  }
  if (apontamentosVis.length > 0) { const c = composicaoProdutividade('produtividade', 'Produtividade', prod, periodo, escopo.texto, TELA_PRODUCAO(unica?.codigo)); composicoes[c.id] = c; }
  if (peso.conjuntos.length > 0) {
    composicoes.peso = {
      id: 'peso', titulo: 'Peso da lista de materiais', resumo: `${escopo.texto} · ${kg(peso.pesoTotal)} na lista`,
      origem: { funcao: 'resumoPeso(conjuntos das obras visíveis)', campo: 'pesoTotal · pesoLiberado · pesoFabricado · pesoExpedido · pesoMontado · emFabrica · emCanteiro · porTipo', regra: 'agregador canônico sobre a lista já recortada pelas obras visíveis; o piloto não soma entre obras', tela: TELA_PRODUCAO(unica?.codigo) },
      pares: linhasPeso(peso),
      colunas: [{ titulo: 'Tipo · fabricado / montado' }, { titulo: '' }, { titulo: 'Peso da lista', num: true }],
      linhas: peso.porTipo.map((t) => ({ id: t.tipo, titulo: t.tipo, sub: `fabricado ${kg(t.pesoFabricado)} · montado ${kg(t.pesoMontado)}`, valor: t.pesoTotal, texto: kg(t.pesoTotal) })),
      nota: 'Peso em canteiro não é montagem concluída; peso em fábrica não é material faltante.',
    };
  }
  if (todasOrdens.length > 0) {
    const linhaResumo = (r: ResumoProducao) => (r.ordens.length ? `${n(r.ordens.length, 'ordem', 'ordens')} · ${r.emAndamento} em andamento · ${r.atrasadas} atrasada(s) · ${r.concluidas} concluída(s)` : TEXTO_SEM_ORDENS);
    composicoes.ordens = {
      id: 'ordens', titulo: 'Ordens de fabricação e de montagem', resumo: `${escopo.texto} · fabricação e montagem separadas`,
      origem: { funcao: "resumoProducao(ordens das obras visíveis, 'Fabricação' | 'Montagem', dataBase)", campo: 'porEtapa[].ordens · emAndamento · atrasadas · concluidas', regra: 'ordens canceladas ficam fora; a coluna de cada ordem é a etapa atual (calcOrdem.etapaAtual)', tela: '/central' },
      pares: [
        { rotulo: 'Fabricação', texto: linhaResumo(fab), sub: 'resumoProducao(…, Fabricação)' },
        { rotulo: 'Montagem', texto: linhaResumo(mont), sub: 'resumoProducao(…, Montagem)' },
      ],
      colunas: [{ titulo: 'Linha · etapa' }, { titulo: '' }, { titulo: 'Ordens', num: true }],
      linhas: [...(fab.ordens.length ? fab.porEtapa.map((e) => ({ ...e, tipo: 'Fabricação' })) : []), ...(mont.ordens.length ? mont.porEtapa.map((e) => ({ ...e, tipo: 'Montagem' })) : [])]
        .map((e) => ({ id: `${e.tipo}:${e.nome}`, titulo: `${e.tipo} · ${e.nome}`, sub: e.ordens.map((o) => o.codigo).join(', ') || 'nenhuma ordem nesta etapa', valor: e.ordens.length, texto: String(e.ordens.length) })),
      nota: 'A quantidade das ordens não é somada por etapa: cada ordem tem a sua unidade (t, pç, m²).',
    };
  }

  // ---- SITUACAO: numeros canonicos, sem tom; fabricacao e montagem sempre em numeros separados ----
  const semLista = peso.conjuntos.length === 0;
  const kgOuAusente = (rotulo: string, v: number): NumeroSituacao => (semLista ? { rotulo, valor: null, texto: TEXTO_SEM_LISTA } : { rotulo, valor: v, texto: kg(v) });
  const parteKg = (rotulo: string, v: number): ParteSituacao => (semLista ? { rotulo, valor: null, texto: TEXTO_SEM_LISTA } : { rotulo, valor: v, texto: kg(v) });
  const contagem = (rotulo: string, r: ResumoProducao, v: number): NumeroSituacao => (r.ordens.length ? { rotulo, valor: v, texto: String(v) } : { rotulo, valor: null, texto: TEXTO_SEM_ORDENS });
  const origemPeso = (campo: string, regra: string): Origem => ({ funcao: 'resumoPeso(conjuntos das obras visíveis)', campo, regra, tela: TELA_PRODUCAO(unica?.codigo) });
  const origemOrdens = (campo: string, regra: string): Origem => ({ funcao: "resumoProducao(ordens das obras visíveis, 'Fabricação' | 'Montagem', dataBase)", campo, regra, tela: '/central' });
  const compPeso = semLista ? undefined : 'peso';
  const compOrdens = todasOrdens.length ? 'ordens' : undefined;
  const tiles: Record<IdSituacao, ItemSituacao> = {
    'peso-fabricado': {
      id: 'peso-fabricado', rotulo: 'Peso fabricado', numeros: [kgOuAusente('Fabricado', peso.pesoFabricado)],
      micro: semLista ? escopo.texto : `${pct(peso.pctFabricado)} do peso da lista · ${escopo.texto}`,
      partes: [parteKg('Peso da lista', peso.pesoTotal), parteKg('Liberado', peso.pesoLiberado)],
      origem: origemPeso('pesoFabricado · pctFabricado · pesoTotal · pesoLiberado', 'peso fabricado pela lista de materiais (calcConjunto); não é percentual financeiro'), composicaoId: compPeso,
    },
    'peso-montado': {
      id: 'peso-montado', rotulo: 'Peso montado', numeros: [kgOuAusente('Montado', peso.pesoMontado)],
      micro: semLista ? escopo.texto : `${pct(peso.pctMontado)} do peso da lista · ${escopo.texto}`,
      partes: [parteKg('Expedido', peso.pesoExpedido), parteKg('Em canteiro', peso.emCanteiro)],
      origem: origemPeso('pesoMontado · pctMontado · pesoExpedido · emCanteiro', 'montado, expedido e em canteiro são pesos distintos do core'), composicaoId: compPeso,
    },
    'ordens-atrasadas': {
      id: 'ordens-atrasadas', rotulo: 'Ordens atrasadas', numeros: [contagem('Fabricação', fab, fab.atrasadas), contagem('Montagem', mont, mont.atrasadas)],
      micro: `data de necessidade antes da data-base e ordem não concluída · ${escopo.texto}`,
      partes: [{ rotulo: 'Ordens de fabricação', valor: fab.ordens.length, texto: String(fab.ordens.length) }, { rotulo: 'Ordens de montagem', valor: mont.ordens.length, texto: String(mont.ordens.length) }],
      origem: origemOrdens('atrasadas · ordens', 'calcOrdem.atrasada; ordem sem data de necessidade nunca é atrasada; fabricação e montagem não são somadas'), composicaoId: compOrdens,
    },
    'ordens-andamento': {
      id: 'ordens-andamento', rotulo: 'Ordens em andamento', numeros: [contagem('Fabricação', fab, fab.emAndamento), contagem('Montagem', mont, mont.emAndamento)],
      micro: `alguma etapa iniciada ou concluída, ordem não concluída · ${escopo.texto}`,
      partes: [{ rotulo: 'Concluídas · fabricação', valor: fab.concluidas, texto: String(fab.concluidas) }, { rotulo: 'Concluídas · montagem', valor: mont.concluidas, texto: String(mont.concluidas) }],
      origem: origemOrdens('emAndamento · concluidas', "calcOrdem.status = 'Em andamento'"), composicaoId: compOrdens,
    },
    'peso-em-fabrica': {
      id: 'peso-em-fabrica', rotulo: 'Peso em fábrica', numeros: [kgOuAusente('Em fábrica', peso.emFabrica)],
      micro: `fabricado e ainda não expedido · ${escopo.texto}`,
      partes: [parteKg('Fabricado', peso.pesoFabricado), parteKg('Expedido', peso.pesoExpedido)],
      origem: origemPeso('emFabrica', 'ResumoPeso.emFabrica = fabricado − expedido (core); não é material faltante'), composicaoId: compPeso,
    },
    'peso-em-canteiro': {
      id: 'peso-em-canteiro', rotulo: 'Peso em canteiro', numeros: [kgOuAusente('Em canteiro', peso.emCanteiro)],
      micro: `expedido e ainda não montado · ${escopo.texto}`,
      partes: [parteKg('Expedido', peso.pesoExpedido), parteKg('Montado', peso.pesoMontado)],
      origem: origemPeso('emCanteiro', 'ResumoPeso.emCanteiro = expedido − montado (core); não é montagem concluída'), composicaoId: compPeso,
    },
  };
  const ordem: Record<Visao, IdSituacao[]> = { diretoria: ['peso-fabricado', 'peso-montado', 'ordens-atrasadas'], operacao: ['ordens-andamento', 'ordens-atrasadas', 'peso-em-fabrica', 'peso-em-canteiro'] };
  const situacao = ordem[visao].map((id) => tiles[id]).slice(0, TETO_SITUACAO[visao]);

  // ---- OBRAS (Diretoria): uma linha por obra visivel, com obra360 daquela obra ----
  const obras: LinhaObraProducao[] = obrasVis.map((o) => {
    const r = o360.get(o.codigo)!;
    const composicoesObra = [['obra-producao', 'Ordens'], ['obra-peso', 'Peso'], ['conjuntos', 'Conjuntos'], ['produtividade', 'Produtividade'], ['romaneios', 'Romaneios'], ['aco', 'Aço consumido']]
      .map(([k, rotulo]) => ({ id: `${k}:${o.codigo}`, rotulo })).filter((c) => composicoes[c.id]);
    return {
      codigo: o.codigo, nome: o.nome, status: o.status, responsavel: o.responsavel || undefined,
      peso: r.peso.conjuntos.length ? { total: r.peso.pesoTotal, fabricado: r.peso.pesoFabricado, pctFabricado: r.peso.pctFabricado, expedido: r.peso.pesoExpedido, montado: r.peso.pesoMontado, pctMontado: r.peso.pctMontado, emFabrica: r.peso.emFabrica, emCanteiro: r.peso.emCanteiro } : null,
      fabricacao: resumoOrdens(r.fabricacao), montagem: resumoOrdens(r.montagem),
      servicos: { total: r.servicos.length, atrasados: r.servicosAtrasados, emRisco: r.servicosEmRisco },
      composicoes: composicoesObra, to: TELA_PRODUCAO(o.codigo),
    };
  });

  // ---- ORDENS ABERTAS (Operacao): por data de necessidade (sem data por ultimo), depois codigo; a ordem nao e prioridade ----
  const abertas = linhas.filter((l) => STATUS_ABERTA.includes(l.status)).sort((a, b) => {
    if (a.dataNecessidade && b.dataNecessidade && a.dataNecessidade !== b.dataNecessidade) return a.dataNecessidade < b.dataNecessidade ? -1 : 1;
    if (!!a.dataNecessidade !== !!b.dataNecessidade) return a.dataNecessidade ? -1 : 1;
    return a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;
  });

  // ---- PENDENCIAS: fatos neutros + fontes com tom canonico, na ordem do catalogo ----
  const pend: ItemPendencia[] = [];
  for (const o of todasOrdens.filter((x) => x.atrasada)) {
    const l = linhaPorId.get(o.id)!;
    pend.push({ id: `ordem-atrasada:${o.id}`, tipo: 'ordem-atrasada', obra: o.codigoObra, texto: `${o.codigo} · ${o.descricao}`, impacto: textoNecessidade(o.dataNecessidade, o.diasParaNecessidade, o.status), detalhe: `${o.codigoObra} · ${o.tipo}${o.etapaAtual ? ` · etapa ${o.etapaAtual}` : ''} · ${l.responsavelEtapa ? `responsável da etapa ${l.responsavelEtapa}` : 'responsável da etapa não registrado'}`, origem: { funcao: 'calcOrdem().atrasada', campo: 'dataNecessidade · diasParaNecessidade · status', regra: 'não concluída, não cancelada e data de necessidade antes da data-base', tela: TELA_OBRA(o.codigoObra) }, destino: { rotulo: 'Ver obra', to: TELA_OBRA(o.codigoObra) }, composicaoId: l.composicaoId });
  }
  for (const o of obrasVis) {
    const r = o360.get(o.codigo)!;
    for (const s of r.servicos.filter((x) => x.situacaoPrazo === 'Em risco')) pend.push({ id: `servico-em-risco:${s.id}`, tipo: 'servico-em-risco', obra: o.codigo, texto: `${s.codigo} · ${s.nome}`, impacto: `execução ${pct(s.pctExecucao)} · fim previsto ${s.fimPrevisto ? fmtBr(s.fimPrevisto) : '—'}`, detalhe: `${o.codigo} · execução por ${s.origemExecucao.toLowerCase()} · ${s.responsavel ? `responsável do serviço ${s.responsavel}` : 'responsável do serviço não registrado'}`, origem: { funcao: 'obra360().servicos[].situacaoPrazo', campo: "situacaoPrazo === 'Em risco'", regra: 'calendário decorrido − execução física > 15 p.p. (calcServico); serviço em risco não é ordem atrasada', tela: TELA_OBRA(o.codigo) }, destino: { rotulo: 'Ver obra', to: TELA_OBRA(o.codigo) }, composicaoId: composicoes[`obra-producao:${o.codigo}`] ? `obra-producao:${o.codigo}` : undefined });
  }
  for (const o of obrasVis) {
    const r = o360.get(o.codigo)!;
    if (r.peso.conjuntos.length && r.peso.emFabrica > 0) pend.push({ id: `peso-em-fabrica:${o.codigo}`, tipo: 'peso-em-fabrica', obra: o.codigo, texto: o.nome, impacto: kg(r.peso.emFabrica), detalhe: `${o.codigo} · fabricado ${kg(r.peso.pesoFabricado)} · expedido ${kg(r.peso.pesoExpedido)}`, origem: { funcao: 'obra360().peso.emFabrica', campo: 'emFabrica', regra: 'fabricado e ainda não expedido; não é material faltante', tela: TELA_OBRA(o.codigo) }, destino: { rotulo: 'Ver produção da obra', to: TELA_PRODUCAO(o.codigo) }, composicaoId: `obra-peso:${o.codigo}` });
  }
  for (const o of obrasVis) {
    const r = o360.get(o.codigo)!;
    if (r.peso.conjuntos.length && r.peso.emCanteiro > 0) pend.push({ id: `peso-em-canteiro:${o.codigo}`, tipo: 'peso-em-canteiro', obra: o.codigo, texto: o.nome, impacto: kg(r.peso.emCanteiro), detalhe: `${o.codigo} · expedido ${kg(r.peso.pesoExpedido)} · montado ${kg(r.peso.pesoMontado)}`, origem: { funcao: 'obra360().peso.emCanteiro', campo: 'emCanteiro', regra: 'expedido e ainda não montado; não é montagem concluída', tela: TELA_OBRA(o.codigo) }, destino: { rotulo: 'Ver produção da obra', to: TELA_PRODUCAO(o.codigo) }, composicaoId: `obra-peso:${o.codigo}` });
  }
  // kg/HH: fato de comparacao entre dois campos do core (valor da linha x meta da linha); o numero fica so na composicao
  const periodoTxt = `${diaMes(periodo.de)} a ${diaMes(periodo.ate)}`;
  const linhasMeta: [string, number, number, number][] = [['Fábrica', prod.horasFabrica, prod.kgPorHHFabrica, prod.metaFabrica], ['Canteiro', prod.horasCanteiro, prod.kgPorHHCanteiro, prod.metaCanteiro]];
  for (const [linha, horas, valor, meta] of linhasMeta) {
    if (horas > 0 && valor < meta) pend.push({ id: `kghh-abaixo-meta:${linha}`, tipo: 'kghh-abaixo-meta', texto: `${linha} · ${escopo.texto}`, impacto: `período ${periodoTxt} · números na composição`, detalhe: 'soma de todas as estações da linha ÷ horas da linha, contra META_KG_HH', origem: { funcao: 'resumoProdutividade()', campo: `kgPorHH${linha === 'Fábrica' ? 'Fabrica' : 'Canteiro'} < meta${linha === 'Fábrica' ? 'Fabrica' : 'Canteiro'}`, regra: 'comparação dos dois campos do core, sem cor e sem escala', tela: TELA_PRODUCAO(unica?.codigo) }, destino: { rotulo: 'Ver produção', to: TELA_PRODUCAO(unica?.codigo) }, composicaoId: 'produtividade' });
  }
  for (const rm of romaneiosVis.filter((x) => x.status === 'Emitido').map((x) => calcRomaneio(x, ds.conjuntos)).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))) {
    pend.push({ id: `romaneio-emitido:${rm.id}`, tipo: 'romaneio-emitido', obra: rm.codigoObra, texto: `${rm.numero} · ${rm.codigoObra}`, impacto: `${kg(rm.pesoTotal)} · ${n(rm.pecas, 'peça', 'peças')}`, detalhe: `emitido em ${fmtBr(rm.data)} · status Emitido`, origem: { funcao: 'calcRomaneio()', campo: "status === 'Emitido'", regra: 'status registrado; não há cálculo de atraso de entrega no core', tela: TELA_PRODUCAO(rm.codigoObra) }, destino: { rotulo: 'Ver produção da obra', to: TELA_PRODUCAO(rm.codigoObra) }, composicaoId: `romaneios:${rm.codigoObra}` });
  }
  for (const o of obrasVis) {
    const r = o360.get(o.codigo)!;
    const naoLib = r.peso.conjuntos.filter((c) => c.situacao === 'Não liberado');
    if (naoLib.length) pend.push({ id: `conjunto-nao-liberado:${o.codigo}`, tipo: 'conjunto-nao-liberado', obra: o.codigo, texto: o.nome, impacto: n(naoLib.length, 'marca', 'marcas'), detalhe: `${o.codigo} · ${naoLib.slice(0, 4).map((c) => c.marca).join(', ')}${naoLib.length > 4 ? '…' : ''}`, origem: { funcao: 'calcConjunto().situacao', campo: "situacao === 'Não liberado'", regra: 'sem liberação e sem peça fabricada; contagem de marcas dentro desta obra', tela: TELA_OBRA(o.codigo) }, destino: { rotulo: 'Ver obra', to: TELA_OBRA(o.codigo) }, composicaoId: `conjuntos:${o.codigo}` });
  }
  // fontes com tom canonico (preservado 1:1)
  if (carteiraCompleta) {
    for (const s of sugestoesPara('/producao', ds, usuario, dataBase).filter((x) => x.id === 'ordens-sem-data')) pend.push({ id: 'sugestao-ordens-sem-data', tipo: 'sugestao-ordens-sem-data', texto: s.texto, impacto: 'carteira completa', sinal: { fonte: 'sugestao', valor: s.tom }, origem: { funcao: "sugestoesPara('/producao')", campo: s.id, regra: 'sugestão global do core, com o tom do core; só aparece com a carteira completa', tela: '/producao' }, destino: s.acao ? { rotulo: s.acao.rotulo, to: s.acao.to } : undefined, composicaoId: compOrdens });
  }
  for (const o of obrasVis) {
    for (const s of sugestoesPara(TELA_OBRA(o.codigo), ds, usuario, dataBase)) {
      const tipo: TipoPendencia | undefined = s.id === `obra-${o.codigo}-parados` ? 'sugestao-parados' : s.id === `obra-${o.codigo}-datas` ? 'sugestao-datas' : undefined;
      if (tipo) pend.push({ id: `${tipo}:${o.codigo}`, tipo, obra: o.codigo, texto: o.nome, impacto: s.texto, detalhe: s.detalhe, sinal: { fonte: 'sugestao', valor: s.tom }, origem: { funcao: `sugestoesPara('/obras/${o.codigo}')`, campo: s.id, regra: 'sugestão do core, com o tom que o core atribuiu', tela: TELA_OBRA(o.codigo) }, destino: { rotulo: 'Ver obra', to: TELA_OBRA(o.codigo) } });
    }
  }
  if (carteiraCompleta) {
    for (const c of executarChecks(ds).filter((x) => (x.id === 'ALT-07' || x.id === 'ALT-09') && x.status !== 'OK')) {
      const tipo: TipoPendencia = c.id === 'ALT-07' ? 'check-alt-07' : 'check-alt-09';
      pend.push({ id: tipo, tipo, texto: c.nome, impacto: String(c.atual), detalhe: c.nota, sinal: { fonte: 'check', valor: c.status }, origem: { funcao: 'executarChecks(ds)', campo: `${c.id}.status · atual`, regra: `check global do motor (onde: ${c.onde}); só aparece com a carteira completa`, tela: '/checks' }, destino: { rotulo: 'Ver checks', to: '/checks' } });
    }
  }
  const todas = pend.map((it, i) => ({ it, i })).sort((a, b) => TIPOS_PENDENCIA.indexOf(a.it.tipo) - TIPOS_PENDENCIA.indexOf(b.it.tipo) || a.i - b.i).map((x) => x.it);
  const compacta = todas.slice(0, TETO_PENDENCIAS);

  return {
    estado: 'pronto', fonte, visao, empresa: ds.params.empresa, usuario: { nome: usuario.nome, papel: usuario.papel }, carteiraCompleta, escopo, periodo,
    situacao, tiles, obras,
    ordens: { compacta: abertas.slice(0, TETO_ORDENS), todas: abertas, ocultas: Math.max(0, abertas.length - TETO_ORDENS) },
    pendencias: { compacta, todas, ocultas: todas.length - compacta.length },
    composicoes, frescor,
  };
}
