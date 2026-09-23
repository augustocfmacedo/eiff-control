// UX-P03 — Obras compacto: view-model puro do piloto (somente leitura).
//
// Filosofia (a mesma do Financeiro compacto): SITUACAO (como a carteira/obra esta) → OBRAS (uma linha por obra visivel)
// → ATENCAO (o que aconteceu · impacto canonico · proximo passo de leitura, agrupada pela severidade que a fonte canonica
// ja fornece) → COMPOSICAO em gaveta, so quando pedida → FRESCOR e SINCRONIZACAO separados.
//
// Este modulo NAO calcula nada de obra. Ele SELECIONA, AGRUPA, ORDENA, ROTULA e PRIORIZA visualmente o que o motor ja
// devolve: `carteiraObras`/`obra360` (engine), `analisarObra` (analise), `acompanhamentoFaturamento` (faturamento),
// `dashboard` (agregados canonicos da carteira) e `sugestoesPara`/`dashboard.checks` (condicoes ja emitidas pelo core).
//
// VISIBILIDADE: o modelo recebe `codigosObraVisiveis` e limita a apresentacao a esse conjunto. Ele nao decide quem pode
// ver o que (isso e ACL do App/store, fora daqui); na demonstracao e nos testes o conjunto vem da fixture.
//
// SEVERIDADE: reaproveitada SOMENTE quando a fonte canonica ja a fornece — `tom` da sugestao do core, `status` do check
// do motor e `semaforo` de `analisarObra`. As tabelas abaixo sao relabels 1:1 dessas classificacoes canonicas, nunca
// condicao → severidade inventada aqui; nada e inferido por dias, percentual, valor ou quantidade, e nada e temporal.
// Condicao sem classificacao canonica fica fora dos grupos (`semClassificacao`).
//
// AGREGADOS DA CARTEIRA (receita contratada, backlog, margem da carteira, obras com margem negativa) so aparecem quando o
// conjunto visivel cobre a carteira inteira, porque `dashboard()` soma todas as obras; com subconjunto o valor e `null`
// ("carteira inteira nao visivel") — nunca uma soma propria (classe C do documento).
import { calcLancamentos, carteiraObras, dashboard, fmtBr, type Check, type LancamentoCalc, type Obra360 } from '../../core/engine';
import { analisarObra, type AnaliseObra } from '../../core/analise';
import { acompanhamentoFaturamento } from '../../core/faturamento';
import { sugestoesPara, type Sugestao } from '../../core/sugestoes';
import type { Dataset, Usuario } from '../../core/types';

export const VERSAO_PILOTO = 'UX-P03.1';
export const TETO_SITUACAO: Record<Visao, number> = { diretoria: 3, operacao: 4 };
export const TETO_ATENCAO = 6;
export const TEXTO_CARTEIRA_PARCIAL = 'carteira inteira não visível';
export const TEXTO_SEM_SERVICOS = 'sem serviços';

export type Visao = 'diretoria' | 'operacao';
export const VISOES: { id: Visao; rotulo: string; descricao: string }[] = [
  { id: 'diretoria', rotulo: 'Diretoria', descricao: 'Carteira contratada e backlog, margem projetada da carteira e saúde das obras.' },
  { id: 'operacao', rotulo: 'Operação', descricao: 'Avanço físico com origem, medições, serviços e produção, cada conceito separado.' },
];

export type Tom = 'bad' | 'warn' | 'info' | 'ok';
export type Severidade = 'acao' | 'atencao' | 'acompanhar';
export const ROTULO_SEVERIDADE: Record<Severidade, string> = { acao: 'Precisa de ação', atencao: 'Atenção', acompanhar: 'Acompanhar' };
const ORDEM_SEVERIDADE: Severidade[] = ['acao', 'atencao', 'acompanhar'];
/** Relabel 1:1 do `tom` que `sugestoesPara` ja atribui a cada sugestao. */
export const SEVERIDADE_DE_TOM: Record<Sugestao['tom'], Severidade> = { bad: 'acao', warn: 'atencao', info: 'acompanhar' };
/** Relabel 1:1 do `status` que `executarChecks` ja atribui; OK nao gera item. */
export const SEVERIDADE_DE_CHECK: Record<Check['status'], Severidade | undefined> = { FALHA: 'acao', ATENÇÃO: 'atencao', OK: undefined };
/** Relabel 1:1 do `semaforo` que `analisarObra` ja atribui; verde nao gera item. */
export const SEVERIDADE_DE_SEMAFORO: Record<AnaliseObra['semaforo'], Severidade | undefined> = { vermelho: 'acao', amarelo: 'atencao', verde: undefined };
const TOM_DE_SEVERIDADE: Record<Severidade, Tom> = { acao: 'bad', atencao: 'warn', acompanhar: 'info' };
/** Checks do motor que falam de obra (ids canonicos em engine.ts). */
export const CHECKS_DE_OBRA = ['ALT-05', 'ALT-06', 'ALT-07', 'ALT-08', 'ALT-09'] as const;

export interface Sincronizacao { estado: 'sincronizado' | 'enviando' | 'pendente' | 'erro' | 'local'; em?: string; desde?: string; msg?: string }
export const ROTULO_SINCRONIZACAO: Record<Sincronizacao['estado'], string> = { sincronizado: 'Supabase · sincronizado', enviando: 'Supabase · sincronizando…', pendente: 'offline · alterações guardadas neste aparelho', erro: 'não sincronizado', local: 'modo local · seed' };
export interface FonteDados { rotulo: string; modo: 'teste' | 'local' | 'remoto'; atualizadoEm?: string; id?: string; sincronizacao?: Sincronizacao }

export type EntradaObras =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'pronto'; fonte: FonteDados; ds: Dataset; usuario: Usuario; codigosObraVisiveis: string[]; agora: string; visao?: Visao };

export interface Origem { funcao: string; campo: string; regra: string; tela?: string }
export interface ParteSituacao { rotulo: string; valor: number | null; texto: string; tom?: Tom }
export interface ItemSituacao {
  id: 'carteira' | 'margem' | 'saude' | 'avanco' | 'medicoes' | 'servicos' | 'producao';
  rotulo: string;
  valor: number | null;
  texto: string;
  tom?: Tom;
  micro?: string;
  partes: ParteSituacao[];
  origem: Origem;
  composicaoId?: string;
}
export interface LinhaObra {
  codigo: string;
  nome: string;
  status: string;
  semaforo: AnaliseObra['semaforo'];
  score: number;
  temServicos: boolean;
  execucaoFisica: number;
  pctMargemProjetada: number;
  medicoesPendentes: number;
  medicoesAtrasadas: number;
  servicosAtrasados: number;
  servicosEmRisco: number;
  proximoMarco?: { evento: string; data?: string; dias?: number };
  diasParaPrazo?: number;
  composicoes: { id: string; rotulo: string }[];
  to: string;
}
export interface ItemAtencao {
  id: string;
  obra?: string;
  severidade?: Severidade;
  tom?: Tom;
  texto: string;
  impacto: string;
  detalhe?: string;
  origem: Origem;
  destino?: { rotulo: string; to: string };
  composicaoId?: string;
}
export interface GrupoAtencao { severidade: Severidade; rotulo: string; itens: ItemAtencao[] }
export interface LinhaComposicao { id: string; titulo: string; sub?: string; data?: string; valor: number | null; texto: string; tom?: Tom; to?: string }
export interface Composicao {
  id: string;
  obra: string;
  titulo: string;
  resumo: string;
  origem: Origem;
  colunas: { titulo: string; num?: boolean }[];
  linhas: LinhaComposicao[];
  total?: { rotulo: string; valor: number; texto: string };
  serie?: { valores: number[]; rotulos: string[]; referencia?: number; destaque?: number };
}
export interface ChipFrescor { id: string; texto: string; tom?: Tom; titulo?: string }
export interface Frescor { dataBase: string; ultimaMedicao?: string; ultimoAvanco?: string; fonteAtualizadaEm?: string; desatualizado: boolean; motivos: string[]; chips: ChipFrescor[] }

export type ModeloObras =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'vazio'; fonte: FonteDados; motivo: string; frescor: Frescor }
  | { estado: 'sem-visibilidade'; fonte: FonteDados; motivo: string; frescor: Frescor; totalObras: number }
  | {
      estado: 'pronto';
      fonte: FonteDados;
      visao: Visao;
      empresa: string;
      usuario: { nome: string; papel: string };
      carteiraCompleta: boolean;
      situacao: ItemSituacao[];
      obras: LinhaObra[];
      atencao: { compacta: ItemAtencao[]; todas: ItemAtencao[]; ocultas: number; grupos: GrupoAtencao[]; gruposCompactos: GrupoAtencao[]; semClassificacao: ItemAtencao[] };
      composicoes: Record<string, Composicao>;
      frescor: Frescor;
    };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : brl.format(v));
export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const diaMes = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const n = (q: number, s: string, p: string) => `${q} ${q === 1 ? s : p}`;
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

function frescorDe(ds: Dataset, visiveis: Obra360[], fonte: FonteDados, agora: string): Frescor {
  const codigos = new Set(visiveis.map((o) => o.obra.codigo));
  const ultimaMedicao = ultimaData(ds.medicoes.filter((m) => codigos.has(m.codigoObra)).map((m) => m.dataMedicao));
  const ultimoAvanco = ultimaData(ds.avancos.filter((a) => codigos.has(a.codigoObra)).map((a) => a.data));
  const motivos: string[] = [];
  if (!fonte.atualizadoEm && fonte.modo === 'remoto') motivos.push('Momento da última atualização da fonte desconhecido.');
  const chips: ChipFrescor[] = [
    { id: 'base', texto: `Base ${diaMes(ds.params.dataBase)}`, titulo: `Data-base ${fmtBr(ds.params.dataBase)} · cenário ${ds.params.cenario}` },
    ultimaMedicao ? { id: 'medicao', texto: `Última medição ${diaMes(ultimaMedicao)}`, titulo: `Última medição registrada nas obras visíveis: ${fmtBr(ultimaMedicao)}` } : { id: 'medicao', texto: 'Sem medição registrada', titulo: 'Nenhuma medição com data nas obras visíveis.' },
    ultimoAvanco ? { id: 'avanco', texto: `Último avanço ${diaMes(ultimoAvanco)}`, titulo: `Última medição física de serviço: ${fmtBr(ultimoAvanco)}` } : { id: 'avanco', texto: 'Sem avanço apontado', titulo: 'Nenhuma medição física de serviço nas obras visíveis.' },
    fonte.atualizadoEm
      ? { id: 'atualizado', texto: `Atualizado ${tempoRelativo(fonte.atualizadoEm, agora)}`, titulo: `Fonte ${fonte.rotulo} · ${new Date(fonte.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` }
      : fonte.modo === 'local'
        ? { id: 'atualizado', texto: 'Seed local', titulo: 'Dados do seed em modo local: não são a operação real.' }
        : fonte.modo === 'teste'
          ? { id: 'atualizado', texto: 'Dados de teste', tom: 'warn', titulo: 'Fixture do piloto: nenhum número é real.' }
          : { id: 'atualizado', texto: 'Atualização desconhecida', tom: 'warn', titulo: 'A fonte não informou quando foi sincronizada.' },
  ];
  return { dataBase: ds.params.dataBase, ultimaMedicao, ultimoAvanco, fonteAtualizadaEm: fonte.atualizadoEm, desatualizado: motivos.length > 0, motivos, chips };
}

// ---- composicoes por obra: linhas canonicas, colunas fixas (titulo · data · valor) ----
const TOM_PRAZO: Record<string, Tom | undefined> = { Atrasado: 'bad', 'Em risco': 'warn', Concluído: 'ok' };
function composicoesDaObra(o: Obra360, a: AnaliseObra, ds: Dataset, lancs: LancamentoCalc[]): Composicao[] {
  const c = o.obra.codigo;
  const tela = `/obras/${c}`;
  const resumo: Composicao = {
    id: `resumo:${c}`, obra: c, titulo: `Obra 360 · ${o.obra.nome}`, resumo: `${o.obra.status} · avanço ${pct(o.execucaoFisica)} · margem projetada ${pct(o.pctMargemProjetada)}`,
    origem: { funcao: 'obra360(ds, obra)', campo: 'receitaTotal · medidoFaturado · recebido · custoPrevisto · custoComprometido · custoPago · eac · margemProjetada · orcamentoDisponivel', regra: 'os mesmos campos da aba Resumo da Obra 360; nada recalculado', tela },
    colunas: [{ titulo: 'Grandeza' }, { titulo: 'Origem' }, { titulo: 'Valor', num: true }],
    linhas: [
      ['receita', 'Receita total (contrato + aditivos)', 'obra360.receitaTotal', o.receitaTotal],
      ['faturado', 'Medido/faturado (construtora, líquido)', 'obra360.medidoFaturado', o.medidoFaturado],
      ['recebido', 'Recebido', 'obra360.recebido', o.recebido],
      ['amedir', 'Saldo a medir', 'obra360.saldoAMedir', o.saldoAMedir],
      ['custoPrevisto', 'Custo previsto', 'obra360.custoPrevisto', o.custoPrevisto],
      ['comprometido', 'Custo comprometido', 'obra360.custoComprometido', o.custoComprometido],
      ['pago', 'Custo pago', 'obra360.custoPago', o.custoPago],
      ['eac', 'EAC (pago + comprometido aberto + ETC não comprometido)', 'obra360.eac', o.eac],
      ['margem', 'Margem projetada', 'obra360.margemProjetada', o.margemProjetada],
      ['disponivel', 'Orçamento disponível', 'obra360.orcamentoDisponivel', o.orcamentoDisponivel],
      ['diretoSaldo', 'Saldo de faturamento direto do contrato', 'obra360.faturamentoDiretoSaldo', o.faturamentoDiretoSaldo],
    ].map(([id, titulo, sub, valor]) => ({ id: String(id), titulo: String(titulo), sub: String(sub), valor: Number(valor), texto: moeda(Number(valor)), tom: id === 'margem' && Number(valor) < 0 ? 'bad' : id === 'diretoSaldo' && Number(valor) < 0 ? 'warn' : undefined })),
  };
  const servicos: Composicao = {
    id: `servicos:${c}`, obra: c, titulo: `Serviços · ${o.obra.nome}`, resumo: `${n(o.servicos.length, 'serviço', 'serviços')} · ${o.servicosAtrasados} atrasados · ${o.servicosEmRisco} em risco`,
    origem: { funcao: 'obra360(ds, obra).servicos', campo: 'ServicoCalc.pctExecucao · origemExecucao · situacaoPrazo · custoPrevisto · eac', regra: 'avanço físico na ordem canônica (concluído → kg → ordens → medição de serviço → quantidade → % faturado); prazo pelo motor', tela },
    colunas: [{ titulo: 'Serviço · avanço e origem' }, { titulo: 'Fim previsto' }, { titulo: 'EAC', num: true }],
    linhas: o.servicos.map((s) => ({ id: s.id, titulo: `${s.codigo} · ${s.nome}`, sub: `${pct(s.pctExecucao)} · ${s.origemExecucao} · ${s.situacaoPrazo} · custo previsto ${moeda(s.custoPrevisto)} (${s.origemCustoPrevisto})`, data: s.fimPrevisto, valor: s.eac, texto: moeda(s.eac), tom: TOM_PRAZO[s.situacaoPrazo] })),
  };
  const medicoes: Composicao = {
    id: `medicoes:${c}`, obra: c, titulo: `Medições · ${o.obra.nome}`, resumo: `${n(o.medicoes.medicoes.length, 'evento', 'eventos')} · ${o.medicoes.pendentes} pendentes · ${o.medicoes.atrasadas} atrasadas · faturado ${moeda(o.medicoes.faturado)}`,
    origem: { funcao: 'obra360(ds, obra).medicoes', campo: 'ResumoMedicoes.medicoes[].atrasada · status · valorLiquidoConstrutora · faturado · aFaturar', regra: 'atrasada = prevista antes da data-base e ainda pendente (calcMedicao)', tela },
    colunas: [{ titulo: 'Evento' }, { titulo: 'Prevista' }, { titulo: 'Líquido construtora', num: true }],
    linhas: o.medicoes.medicoes.map((m) => ({ id: m.id, titulo: `${m.numero} · ${m.evento}`, sub: `${m.status}${m.atrasada ? ' · atrasada' : ''}${m.dataMedicao ? ` · medida em ${fmtBr(m.dataMedicao)}` : ''}${m.faturamentoDireto ? ` · direto ${moeda(m.faturamentoDireto)}` : ''}`, data: m.dataPrevista, valor: m.valorLiquidoConstrutora, texto: moeda(m.valorLiquidoConstrutora), tom: m.atrasada ? 'warn' : m.medida ? 'ok' : undefined })),
    total: { rotulo: 'Faturado (líquido construtora, eventos medidos+)', valor: o.medicoes.faturado, texto: moeda(o.medicoes.faturado) },
  };
  const curva: Composicao = {
    id: `curva:${c}`, obra: c, titulo: `Curva S · ${o.obra.nome}`, resumo: `previsto × faturado acumulados · IDP ${a.idp === undefined ? '—' : a.idp.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} · IDC ${a.idc === undefined ? '—' : a.idc.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`,
    origem: { funcao: 'analisarObra(ds, obra360).curva', campo: 'PontoCurva.previsto · faturado · custoPrevisto · custo (acumulados por mês)', regra: 'a mesma curva do cronograma da Obra 360; faturado e custo param na data-base', tela },
    colunas: [{ titulo: 'Mês · faturado / custo' }, { titulo: 'Mês' }, { titulo: 'Previsto acumulado', num: true }],
    linhas: a.curva.map((p) => ({ id: p.mes, titulo: p.rotulo, sub: `faturado ${p.faturado === undefined ? '—' : moeda(p.faturado)} · custo ${p.custo === undefined ? '—' : moeda(p.custo)} · custo previsto ${moeda(p.custoPrevisto)}`, data: p.mes, valor: p.previsto, texto: moeda(p.previsto) })),
    serie: { valores: a.curva.map((p) => p.previsto), rotulos: a.curva.map((p) => p.rotulo) },
  };
  const producao: Composicao = {
    id: `producao:${c}`, obra: c, titulo: `Produção · ${o.obra.nome}`, resumo: `fabricação ${o.fabricacao.emAndamento} em andamento · ${o.fabricacao.atrasadas} atrasadas | montagem ${o.montagem.emAndamento} em andamento · ${o.montagem.atrasadas} atrasadas`,
    origem: { funcao: 'obra360(ds, obra).fabricacao · .montagem', campo: 'ResumoProducao.ordens[].status · quantidadeConcluida · dataNecessidade', regra: 'ordem atrasada = data de necessidade vencida e não concluída (calcOrdem)', tela: `/producao?obra=${c}` },
    colunas: [{ titulo: 'Ordem · tipo · situação' }, { titulo: 'Necessidade' }, { titulo: 'Concluído', num: true }],
    linhas: [...o.fabricacao.ordens, ...o.montagem.ordens].map((r) => ({ id: r.id, titulo: `${r.codigo} · ${r.descricao}`, sub: `${r.tipo} · ${r.status}${r.etapaAtual ? ` · etapa ${r.etapaAtual}` : ''} · ${r.quantidade} ${r.unidade}${r.atrasada ? ' · atrasada' : ''}`, data: r.dataNecessidade, valor: r.pctConcluido, texto: pct(r.pctConcluido), tom: r.status === 'Concluída' ? 'ok' : r.atrasada ? 'bad' : undefined })),
  };
  const materiais: Composicao = {
    id: `materiais:${c}`, obra: c, titulo: `Materiais · ${o.obra.nome}`, resumo: `${o.peso.pecas} peças · ${Math.round(o.peso.pesoTotal).toLocaleString('pt-BR')} kg · fabricado ${pct(o.peso.pctFabricado)} · montado ${pct(o.peso.pctMontado)}`,
    origem: { funcao: 'obra360(ds, obra).peso', campo: 'ResumoPeso.porTipo[].pesoTotal · pesoFabricado · pesoMontado', regra: 'lista de materiais em kg (resumoPeso); avanço por peso quando o serviço tem lista', tela },
    colunas: [{ titulo: 'Tipo · fabricado / montado (kg)' }, { titulo: '' }, { titulo: 'Peso total (kg)', num: true }],
    linhas: o.peso.porTipo.map((t) => ({ id: t.tipo, titulo: t.tipo, sub: `fabricado ${Math.round(t.pesoFabricado).toLocaleString('pt-BR')} kg · montado ${Math.round(t.pesoMontado).toLocaleString('pt-BR')} kg`, valor: t.pesoTotal, texto: `${Math.round(t.pesoTotal).toLocaleString('pt-BR')} kg` })),
    total: { rotulo: 'Peso total da lista', valor: o.peso.pesoTotal, texto: `${Math.round(o.peso.pesoTotal).toLocaleString('pt-BR')} kg` },
  };
  const fat = acompanhamentoFaturamento({ codigoObra: c, servicos: ds.servicos, medicoes: ds.medicoes, lancamentos: ds.lancamentos, rateios: ds.rateios, planoContas: ds.planoContas, execucaoPorServico: new Map(o.servicos.map((s) => [s.id, s.pctExecucao])) });
  const faturamento: Composicao = {
    id: `faturamento:${c}`, obra: c, titulo: `Faturamento do contrato · ${o.obra.nome}`, resumo: `contratado ${moeda(fat.totais.contratadoBruto)} · faturado ${moeda(fat.totais.faturadoTotal)} · direto não repassado ${moeda(fat.totais.diretoNaoEnviado)}`,
    origem: { funcao: 'acompanhamentoFaturamento({ codigoObra, servicos, medicoes, lancamentos, rateios, planoContas })', campo: 'EtapaFaturamento.contratadoBruto · faturadoDireto · faturadoConstrutora · saldo · diretoNaoEnviado', regra: 'direto = saídas da obra com faturamento direto; construtora = entradas com rateio ou vinculadas a medições', tela },
    colunas: [{ titulo: 'Etapa · faturado direto / construtora' }, { titulo: '' }, { titulo: 'Contratado bruto', num: true }],
    linhas: fat.etapas.map((e) => ({ id: e.codigo, titulo: `${e.codigo} · ${e.etapa}`, sub: `direto ${moeda(e.faturadoDireto)} · construtora ${moeda(e.faturadoConstrutora)} · saldo ${moeda(e.saldo)}${e.diretoNaoEnviado ? ` · não repassado ${moeda(e.diretoNaoEnviado)}` : ''}`, valor: e.contratadoBruto, texto: moeda(e.contratadoBruto), tom: e.diretoNaoEnviado > 0 ? 'warn' : undefined })),
    total: { rotulo: 'Contratado bruto (etapas)', valor: fat.totais.contratadoBruto, texto: moeda(fat.totais.contratadoBruto) },
  };
  const custos: Composicao = {
    id: `custos:${c}`, obra: c, titulo: `Custos lançados · ${o.obra.nome}`, resumo: `${n(o.saidas.length, 'saída', 'saídas')} · comprometido ${moeda(o.custoComprometido)} · pago ${moeda(o.custoPago)}`,
    origem: { funcao: 'obra360(ds, obra).saidas', campo: 'LancamentoCalc.valorLiquidoPrevisto · status · faturamentoDireto', regra: 'saídas da obra que entram no comprometido (oficiais, não canceladas)', tela: `/pagar?obra=${c}` },
    colunas: [{ titulo: 'Contraparte · descrição' }, { titulo: 'Vencimento' }, { titulo: 'Valor previsto', num: true }],
    linhas: o.saidas.map((l) => ({ id: l.id, titulo: l.contraparte, sub: `${l.descricao} · ${l.status}${l.direto ? ' · faturamento direto' : ''}`, data: l.vencimento, valor: l.valorLiquidoPrevisto, texto: moeda(l.valorLiquidoPrevisto), tom: l.situacao === 'Atrasado' ? 'bad' : undefined, to: `/lancamentos/${l.id}` })),
    total: { rotulo: 'Custo comprometido (motor)', valor: o.custoComprometido, texto: moeda(o.custoComprometido) },
  };
  void lancs;
  return [resumo, servicos, medicoes, curva, producao, materiais, faturamento, custos];
}

/** Impacto canonico de cada sugestao de obra do core, lido pelo sufixo do id (os campos vem do proprio obra360). */
function impactoDaSugestao(s: Sugestao, o: Obra360, aRepassar: number): string {
  if (s.id.endsWith('-margem')) return `margem projetada ${pct(o.pctMargemProjetada)} · ${moeda(o.margemProjetada)}`;
  if (s.id.endsWith('-medicoes')) return `${n(o.medicoes.atrasadas, 'medição atrasada', 'medições atrasadas')}`;
  if (s.id.endsWith('-direto')) return `saldo direto ${moeda(o.faturamentoDiretoSaldo)}`;
  if (s.id.endsWith('-repasse')) return `${moeda(aRepassar)} a repassar`;
  if (s.id.endsWith('-parados')) return `${n(o.servicos.filter((x) => x.status === 'Em andamento' && x.pctExecucao === 0).length, 'serviço sem avanço', 'serviços sem avanço')}`;
  if (s.id.endsWith('-datas')) return `${n(o.servicos.length, 'serviço sem datas', 'serviços sem datas')}`;
  return s.detalhe ?? 'ver detalhe';
}

export function agruparPorSeveridade(itens: ItemAtencao[]): GrupoAtencao[] {
  return ORDEM_SEVERIDADE.map((s) => ({ severidade: s, rotulo: ROTULO_SEVERIDADE[s], itens: itens.filter((i) => i.severidade === s) })).filter((g) => g.itens.length > 0);
}

export function montarObras(entrada: EntradaObras): ModeloObras {
  if (entrada.estado === 'carregando') return { estado: 'carregando', fonte: entrada.fonte };
  if (entrada.estado === 'erro') return { estado: 'erro', fonte: entrada.fonte, mensagem: entrada.mensagem, causa: entrada.causa };
  const { ds, usuario, fonte, agora, codigosObraVisiveis } = entrada;
  const visao: Visao = entrada.visao ?? 'diretoria';
  const lancs = calcLancamentos(ds);
  const carteira = carteiraObras(ds);
  if (carteira.length === 0) return { estado: 'vazio', fonte, motivo: 'Nenhuma obra cadastrada nesta fonte.', frescor: frescorDe(ds, [], fonte, agora) };
  const visiveisSet = new Set(codigosObraVisiveis);
  const visiveis = carteira.filter((o) => visiveisSet.has(o.obra.codigo));
  if (visiveis.length === 0) return { estado: 'sem-visibilidade', fonte, motivo: 'Nenhuma obra visível para este usuário. A visibilidade é definida pelo aplicativo, não pelo piloto.', frescor: frescorDe(ds, [], fonte, agora), totalObras: carteira.length };
  const carteiraCompleta = carteira.every((o) => visiveisSet.has(o.obra.codigo));
  const d = dashboard(ds);
  const analises = new Map(visiveis.map((o) => [o.obra.codigo, analisarObra(ds, o, lancs)]));
  const frescor = frescorDe(ds, visiveis, fonte, agora);

  // ---- composicoes ----
  const composicoes: Record<string, Composicao> = {};
  for (const o of visiveis) for (const c of composicoesDaObra(o, analises.get(o.obra.codigo)!, ds, lancs)) composicoes[c.id] = c;

  // ---- SITUACAO ----
  const parcial = (rotulo: string): ParteSituacao => ({ rotulo, valor: null, texto: 'não visível' });
  const porSemaforo = (s: AnaliseObra['semaforo']) => visiveis.filter((o) => analises.get(o.obra.codigo)!.semaforo === s).length;
  const carteiraTile: ItemSituacao = {
    id: 'carteira', rotulo: 'Carteira contratada',
    valor: carteiraCompleta ? d.receitaContratada : null,
    texto: carteiraCompleta ? moeda(d.receitaContratada) : TEXTO_CARTEIRA_PARCIAL,
    micro: carteiraCompleta ? `${n(d.obrasAtivas, 'obra ativa', 'obras ativas')}` : `${n(visiveis.length, 'obra visível', 'obras visíveis')} de ${carteira.length}`,
    partes: carteiraCompleta ? [{ rotulo: 'Backlog (a receber)', valor: d.backlog, texto: moeda(d.backlog) }] : [parcial('Backlog (a receber)')],
    origem: { funcao: 'dashboard(ds)', campo: 'receitaContratada · backlog · obrasAtivas', regra: 'agregados canônicos da carteira inteira (só apresentados quando todas as obras estão visíveis)', tela: '/obras' },
  };
  const margemTile: ItemSituacao = {
    id: 'margem', rotulo: 'Margem projetada da carteira',
    valor: carteiraCompleta ? d.margemCarteira : null,
    texto: carteiraCompleta ? pct(d.margemCarteira) : TEXTO_CARTEIRA_PARCIAL,
    tom: carteiraCompleta ? (d.margemCarteira < 0 ? 'bad' : d.obrasMargemNegativa > 0 ? 'warn' : undefined) : undefined,
    partes: carteiraCompleta ? [{ rotulo: 'Obras com margem negativa', valor: d.obrasMargemNegativa, texto: String(d.obrasMargemNegativa), tom: d.obrasMargemNegativa > 0 ? 'bad' : undefined }] : [parcial('Obras com margem negativa')],
    origem: { funcao: 'dashboard(ds)', campo: 'margemCarteira · obrasMargemNegativa', regra: 'Σ margem projetada ÷ receita contratada, calculada pelo motor; contagem do check ALT-05', tela: '/obras' },
  };
  const saudeTile: ItemSituacao = {
    id: 'saude', rotulo: 'Saúde das obras visíveis',
    valor: null,
    texto: `${porSemaforo('vermelho')} vermelho · ${porSemaforo('amarelo')} amarelo · ${porSemaforo('verde')} verde`,
    tom: porSemaforo('vermelho') > 0 ? 'bad' : porSemaforo('amarelo') > 0 ? 'warn' : 'ok',
    partes: [
      { rotulo: 'Vermelho', valor: porSemaforo('vermelho'), texto: String(porSemaforo('vermelho')), tom: porSemaforo('vermelho') > 0 ? 'bad' : undefined },
      { rotulo: 'Amarelo', valor: porSemaforo('amarelo'), texto: String(porSemaforo('amarelo')), tom: porSemaforo('amarelo') > 0 ? 'warn' : undefined },
      { rotulo: 'Verde', valor: porSemaforo('verde'), texto: String(porSemaforo('verde')), tom: porSemaforo('verde') > 0 ? 'ok' : undefined },
    ],
    origem: { funcao: 'analisarObra(ds, obra360)', campo: 'semaforo (score canônico)', regra: 'contagem das obras visíveis por semáforo; o semáforo é o do motor de análise', tela: '/central' },
  };
  const somaContagem = (f: (o: Obra360) => number) => visiveis.reduce((a, o) => a + f(o), 0);
  const avancoTile: ItemSituacao = {
    id: 'avanco', rotulo: 'Avanço físico',
    valor: null, texto: visiveis.length === 1 ? pct(visiveis[0].execucaoFisica) : `${n(visiveis.length, 'obra', 'obras')} · origem por serviço`,
    micro: visiveis.length === 1 ? (visiveis[0].temServicos ? 'ver origem por serviço na composição' : TEXTO_SEM_SERVICOS) : undefined,
    partes: visiveis.slice(0, 4).map((o) => ({ rotulo: o.obra.codigo, valor: o.temServicos ? o.execucaoFisica : null, texto: o.temServicos ? pct(o.execucaoFisica) : TEXTO_SEM_SERVICOS })),
    origem: { funcao: 'obra360(ds, obra)', campo: 'execucaoFisica (por obra) · ServicoCalc.origemExecucao', regra: 'avanço físico do motor, nunca % faturado; a origem de cada serviço está na composição', tela: '/central' },
    composicaoId: visiveis.length === 1 ? `servicos:${visiveis[0].obra.codigo}` : undefined,
  };
  const medicoesTile: ItemSituacao = {
    id: 'medicoes', rotulo: 'Medições',
    valor: null, texto: `${n(somaContagem((o) => o.medicoes.pendentes), 'pendente', 'pendentes')} · ${n(somaContagem((o) => o.medicoes.atrasadas), 'atrasada', 'atrasadas')}`,
    tom: somaContagem((o) => o.medicoes.atrasadas) > 0 ? 'warn' : undefined,
    partes: [
      { rotulo: 'Pendentes', valor: somaContagem((o) => o.medicoes.pendentes), texto: String(somaContagem((o) => o.medicoes.pendentes)) },
      { rotulo: 'Atrasadas', valor: somaContagem((o) => o.medicoes.atrasadas), texto: String(somaContagem((o) => o.medicoes.atrasadas)), tom: somaContagem((o) => o.medicoes.atrasadas) > 0 ? 'warn' : undefined },
      { rotulo: 'A faturar (líquido)', valor: null, texto: visiveis.length === 1 ? moeda(visiveis[0].medicoes.aFaturar) : 'por obra' },
    ],
    origem: { funcao: 'obra360(ds, obra).medicoes', campo: 'pendentes · atrasadas · aFaturar (por obra; aqui só contagem de itens)', regra: 'contagens canônicas por obra, contadas sobre as obras visíveis; valores só por obra', tela: '/central' },
    composicaoId: visiveis.length === 1 ? `medicoes:${visiveis[0].obra.codigo}` : undefined,
  };
  const servicosTile: ItemSituacao = {
    id: 'servicos', rotulo: 'Serviços',
    valor: null, texto: `${n(somaContagem((o) => o.servicosAtrasados), 'atrasado', 'atrasados')} · ${n(somaContagem((o) => o.servicosEmRisco), 'em risco', 'em risco')}`,
    tom: somaContagem((o) => o.servicosAtrasados) > 0 ? 'bad' : somaContagem((o) => o.servicosEmRisco) > 0 ? 'warn' : undefined,
    partes: [
      { rotulo: 'Atrasados', valor: somaContagem((o) => o.servicosAtrasados), texto: String(somaContagem((o) => o.servicosAtrasados)), tom: somaContagem((o) => o.servicosAtrasados) > 0 ? 'bad' : undefined },
      { rotulo: 'Em risco', valor: somaContagem((o) => o.servicosEmRisco), texto: String(somaContagem((o) => o.servicosEmRisco)), tom: somaContagem((o) => o.servicosEmRisco) > 0 ? 'warn' : undefined },
      { rotulo: 'Sem serviços', valor: visiveis.filter((o) => !o.temServicos).length, texto: String(visiveis.filter((o) => !o.temServicos).length) },
    ],
    origem: { funcao: 'obra360(ds, obra)', campo: 'servicosAtrasados · servicosEmRisco · temServicos', regra: 'situação de prazo do motor (calcServico.situacaoPrazo), contada sobre as obras visíveis', tela: '/central' },
  };
  const producaoTile: ItemSituacao = {
    id: 'producao', rotulo: 'Produção',
    valor: null, texto: `fab. ${somaContagem((o) => o.fabricacao.emAndamento)} em andamento · mont. ${somaContagem((o) => o.montagem.emAndamento)} em andamento`,
    tom: somaContagem((o) => o.fabricacao.atrasadas + o.montagem.atrasadas) > 0 ? 'warn' : undefined,
    partes: [
      { rotulo: 'Fabricação atrasadas', valor: somaContagem((o) => o.fabricacao.atrasadas), texto: String(somaContagem((o) => o.fabricacao.atrasadas)), tom: somaContagem((o) => o.fabricacao.atrasadas) > 0 ? 'bad' : undefined },
      { rotulo: 'Montagem atrasadas', valor: somaContagem((o) => o.montagem.atrasadas), texto: String(somaContagem((o) => o.montagem.atrasadas)), tom: somaContagem((o) => o.montagem.atrasadas) > 0 ? 'bad' : undefined },
      { rotulo: 'Concluídas (fab. · mont.)', valor: null, texto: `${somaContagem((o) => o.fabricacao.concluidas)} · ${somaContagem((o) => o.montagem.concluidas)}` },
    ],
    origem: { funcao: 'obra360(ds, obra).fabricacao · .montagem', campo: 'ResumoProducao.emAndamento · atrasadas · concluidas', regra: 'fabricação e montagem nunca somadas entre si; contagens de ordens do motor', tela: '/producao' },
    composicaoId: visiveis.length === 1 ? `producao:${visiveis[0].obra.codigo}` : undefined,
  };
  const situacao = (visao === 'diretoria' ? [carteiraTile, margemTile, saudeTile] : [avancoTile, medicoesTile, servicosTile, producaoTile]).slice(0, TETO_SITUACAO[visao]);

  // ---- OBRAS: uma linha por obra visivel, na ordem do cadastro ----
  const obras: LinhaObra[] = visiveis.map((o) => {
    const a = analises.get(o.obra.codigo)!;
    const marco = a.proximosMarcos[0];
    return {
      codigo: o.obra.codigo, nome: o.obra.nome, status: o.obra.status, semaforo: a.semaforo, score: a.score, temServicos: o.temServicos,
      execucaoFisica: o.execucaoFisica, pctMargemProjetada: o.pctMargemProjetada,
      medicoesPendentes: o.medicoes.pendentes, medicoesAtrasadas: o.medicoes.atrasadas, servicosAtrasados: o.servicosAtrasados, servicosEmRisco: o.servicosEmRisco,
      proximoMarco: marco ? { evento: marco.evento, data: marco.data, dias: marco.dias } : undefined, diasParaPrazo: o.diasParaPrazo,
      composicoes: [['resumo', 'Obra 360'], ['servicos', 'Serviços'], ['medicoes', 'Medições'], ['curva', 'Curva S'], ['producao', 'Produção'], ['materiais', 'Materiais'], ['faturamento', 'Faturamento'], ['custos', 'Custos']].map(([k, r]) => ({ id: `${k}:${o.obra.codigo}`, rotulo: r })),
      to: `/obras/${o.obra.codigo}`,
    };
  });

  // ---- ATENCAO: so condicoes ja emitidas pelo core, com a severidade que elas trazem ----
  const atencao: ItemAtencao[] = [];
  const item = (base: Omit<ItemAtencao, 'tom'>): ItemAtencao => ({ ...base, tom: base.severidade ? TOM_DE_SEVERIDADE[base.severidade] : undefined });
  for (const o of visiveis) {
    const c = o.obra.codigo;
    const a = analises.get(c)!;
    const aRepassar = acompanhamentoFaturamento({ codigoObra: c, servicos: ds.servicos, medicoes: ds.medicoes, lancamentos: ds.lancamentos, rateios: ds.rateios, planoContas: ds.planoContas }).totais.diretoNaoEnviado;
    for (const s of sugestoesPara(`/obras/${c}`, ds, usuario, ds.params.dataBase)) {
      const comp = s.id.endsWith('-margem') ? `resumo:${c}` : s.id.endsWith('-medicoes') ? `medicoes:${c}` : s.id.endsWith('-direto') || s.id.endsWith('-repasse') ? `faturamento:${c}` : `servicos:${c}`;
      atencao.push(item({ id: s.id, obra: c, severidade: SEVERIDADE_DE_TOM[s.tom], texto: `${o.obra.nome}: ${s.texto}`, impacto: impactoDaSugestao(s, o, aRepassar), detalhe: s.detalhe, origem: { funcao: `sugestoesPara('/obras/${c}')`, campo: s.id, regra: 'sugestão do core para a Obra 360, com o tom que o core atribuiu', tela: s.acao?.to ?? `/obras/${c}` }, destino: { rotulo: 'Ver obra', to: s.acao?.to ?? `/obras/${c}` }, composicaoId: comp }));
    }
    const sev = SEVERIDADE_DE_SEMAFORO[a.semaforo];
    if (sev) {
      const negativos = a.pontos.filter((p) => p.sinal === 'negativo').slice(0, 3).map((p) => `${p.tema}: ${p.texto}`);
      atencao.push(item({ id: `saude-${c}`, obra: c, severidade: sev, texto: `${o.obra.nome}: saúde ${a.semaforo}.`, impacto: `score ${a.score} · ${n(a.pontos.filter((p) => p.sinal === 'negativo').length, 'ponto negativo', 'pontos negativos')}`, detalhe: negativos.join(' · '), origem: { funcao: 'analisarObra(ds, obra360)', campo: 'semaforo · score · pontos[].sinal', regra: 'semáforo e score canônicos da análise de saúde da obra', tela: `/obras/${c}` }, destino: { rotulo: 'Ver obra', to: `/obras/${c}` }, composicaoId: `curva:${c}` }));
    }
  }
  if (carteiraCompleta) {
    for (const s of sugestoesPara('/obras', ds, usuario, ds.params.dataBase)) atencao.push(item({ id: s.id, severidade: SEVERIDADE_DE_TOM[s.tom], texto: s.texto, impacto: s.detalhe ?? 'carteira', origem: { funcao: "sugestoesPara('/obras')", campo: s.id, regra: 'sugestão do core para a lista de obras', tela: s.acao?.to ?? '/obras' }, destino: { rotulo: 'Ver obras', to: s.acao?.to ?? '/obras' } }));
    for (const c of d.checks.filter((x) => (CHECKS_DE_OBRA as readonly string[]).includes(x.id) && x.status !== 'OK')) atencao.push(item({ id: `check-${c.id}`, severidade: SEVERIDADE_DE_CHECK[c.status], texto: `${c.nome}.`, impacto: `${String(c.atual)} (esperado ${String(c.esperado)})`, detalhe: c.nota, origem: { funcao: 'dashboard(ds).checks', campo: c.id, regra: `${c.onde} · status ${c.status} do motor`, tela: '/checks' }, destino: { rotulo: 'Ver controles', to: '/checks' } }));
  }
  const classificadas = atencao.filter((a) => a.severidade);
  const semClassificacao = atencao.filter((a) => !a.severidade);
  const todas = classificadas.map((it, i) => ({ it, i })).sort((x, y) => ORDEM_SEVERIDADE.indexOf(x.it.severidade!) - ORDEM_SEVERIDADE.indexOf(y.it.severidade!) || x.i - y.i).map((x) => x.it);
  const compacta = todas.slice(0, TETO_ATENCAO);

  return {
    estado: 'pronto', fonte, visao, empresa: ds.params.empresa, usuario: { nome: usuario.nome, papel: usuario.papel }, carteiraCompleta,
    situacao, obras,
    atencao: { compacta, todas, ocultas: todas.length - compacta.length, grupos: agruparPorSeveridade(todas), gruposCompactos: agruparPorSeveridade(compacta), semClassificacao },
    composicoes, frescor,
  };
}
