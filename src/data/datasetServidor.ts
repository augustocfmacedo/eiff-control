// EIFF Central — Wave 03 F2-DATA: carga SELECT-only do Dataset no servidor.
//
// Contrato: src/core/central/servidorContratos.ts (CarregarDatasetServidor, ALLOWLIST_DATASET, FORA_DO_DATASET_SERVIDOR).
// Regras deste modulo (provadas em datasetServidor.test.ts com cliente-espiao):
//   - SELECT-only: os unicos metodos usados no cliente sao from/select/eq/in/order/limit/range. Nunca insert, upsert,
//     update, delete ou rpc;
//   - toda tabela `raiz` da allowlist leva `.eq(colunaOrganizacao ?? 'organization_id', organizationId)`;
//   - toda filha sem organization_id e consultada SOMENTE por `.in(pai.coluna, ids)` com os ids vindos das linhas do pai
//     (ja filtradas pela organizacao), em blocos de ate BLOCO_IN ids por chamada; pai sem linhas = filha sem consulta;
//   - paginacao de PAGINA em PAGINA com `range`, como o `selTodos` do navegador, ordenando pela coluna da tela e por `id`;
//   - os filtros e ordens replicam os de `carregarRemoto` (src/data/supabase.ts) para as tabelas da allowlist;
//   - tabelas fora da allowlist entram como [] em LinhasDataset (FORA_DO_DATASET_SERVIDOR documenta o porque);
//   - a transformacao linha -> Dataset e a MESMA do navegador: montarDataset (src/data/mapeamentoDataset.ts);
//   - este arquivo NUNCA importa ./supabase (le import.meta.env e nao roda no servidor). O cliente service_role e criado
//     pela funcao Netlify e entra por parametro; ele nao sai daqui.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ALLOWLIST_DATASET, ErroCentralServidor, FORA_DO_DATASET_SERVIDOR, type CarregarDatasetServidor, type ClasseErro, type EntradaAllowlist } from '../core/central/servidorContratos';
import { montarDataset, type LinhasDataset, type Row } from './mapeamentoDataset';

/** Nome da tabela de identidades (whatsapp_identity). Exportado para o escritor unico da Central ler pela constante. */
export const TABELA_IDENTIDADE = 'whatsapp_identity';
/** Tamanho da pagina do PostgREST (limite padrao de 1000 linhas por resposta). */
export const PAGINA = 1000;
/** Maximo de ids por `.in(...)`: mantem a URL curta e cada chamada previsivel. */
export const BLOCO_IN = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// 1) Erros: classificacao unica para os adapters server-side (dataset e persistencia)
// ---------------------------------------------------------------------------
/** Forma minima de uma falha do PostgREST/supabase-js: `code` (Postgres ou PGRSTnnn), `status` HTTP (0 = rede). */
export interface FalhaSupabase { code?: string | null; status?: number | null; message?: string | null; name?: string | null }
const TRANSITORIOS_POSTGRES = ['08', '40', '53', '57']; // conexao, rollback/serializacao/deadlock, recursos, cancelamento (timeout)

/**
 * Classe do erro (contrato ClasseErro): rede, timeout, 5xx e resposta ininteligivel sao `transitorio` (a Meta reenvia);
 * violacoes de integridade (23505/23503/23514), `raise` de trigger (P0001) e qualquer 4xx do PostgREST sao
 * `deterministico` (bug ou contrato violado: nunca retry infinito).
 */
export function classificarFalha(f: unknown): ClasseErro {
  const falha = (f && typeof f === 'object' ? f : {}) as FalhaSupabase;
  const code = typeof falha.code === 'string' ? falha.code : '';
  const status = typeof falha.status === 'number' ? falha.status : undefined;
  if (code) {
    if (TRANSITORIOS_POSTGRES.some((p) => code.startsWith(p))) return 'transitorio';
    if (/^\d{5}$/.test(code) || /^P\d{4}$/.test(code)) return 'deterministico'; // classe SQLSTATE: integridade, sintaxe, dados, trigger
    if (/^PGRST\d+$/.test(code)) return status !== undefined && status >= 500 ? 'transitorio' : 'deterministico';
  }
  if (status === undefined || status === 0) return 'transitorio'; // fetch falhou, abortou ou nem respondeu
  if (status >= 500) return 'transitorio';
  if (status >= 400) return 'deterministico';
  return 'transitorio'; // resposta sem codigo e sem status util: ininteligivel
}

/** Encapsula qualquer falha em ErroCentralServidor. A mensagem leva so o codigo curto, a classe e o codigo do banco: nunca dados. */
export function erroSupabase(codigo: string, falha: unknown): ErroCentralServidor {
  if (falha instanceof ErroCentralServidor) return falha;
  const classe = classificarFalha(falha);
  const f = (falha && typeof falha === 'object' ? falha : {}) as FalhaSupabase;
  const detalhe = [typeof f.code === 'string' && f.code ? `code=${f.code}` : '', typeof f.status === 'number' ? `status=${f.status}` : ''].filter(Boolean).join(' ');
  return new ErroCentralServidor(codigo, classe, `${codigo} (${classe}${detalhe ? `; ${detalhe}` : ''})`);
}

/** Resposta do PostgREST como o supabase-js devolve: `status` 0 quando o fetch nem chegou ao servidor. */
export interface RespostaLinhas { data: Row[] | null; error: FalhaSupabase | null; status?: number }

/** Executa a operacao e converte qualquer falha (erro na resposta ou excecao) em ErroCentralServidor. `data` pode ser null (escrita sem select). */
export async function respostaOuErro(codigo: string, operacao: PromiseLike<RespostaLinhas>): Promise<RespostaLinhas> {
  let resposta: RespostaLinhas;
  try { resposta = await operacao; } catch (e) { throw erroSupabase(codigo, e); }
  if (!resposta || typeof resposta !== 'object') throw new ErroCentralServidor(codigo, 'transitorio', `${codigo} (transitorio; resposta ininteligivel)`);
  if (resposta.error) throw erroSupabase(codigo, { ...resposta.error, status: resposta.status ?? resposta.error.status });
  return resposta;
}

/** Consulta que TEM de devolver linhas: resposta sem array e ininteligivel (transitorio). */
export async function linhasOuErro(codigo: string, consulta: PromiseLike<RespostaLinhas>): Promise<Row[]> {
  const resposta = await respostaOuErro(codigo, consulta);
  if (!Array.isArray(resposta.data)) throw new ErroCentralServidor(codigo, 'transitorio', `${codigo} (transitorio; resposta sem linhas)`);
  return resposta.data;
}

/** Parte a lista em blocos de `tamanho` (para `.in(...)`). */
export function emBlocos<T>(itens: readonly T[], tamanho = BLOCO_IN): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

// ---------------------------------------------------------------------------
// 2) Plano de leitura: os mesmos filtros/ordens de carregarRemoto, tabela a tabela
// ---------------------------------------------------------------------------
type Construtor = any;
interface PlanoTabela {
  /** Fatia de LinhasDataset que recebe as linhas. */
  chave: keyof LinhasDataset;
  /** Filtros e ordens da tela (depois do filtro de organizacao ou do `.in` do pai). */
  configurar?: (q: Construtor) => Construtor;
  /** Uma linha so (parameter_set ativo): `limit(1)` em vez de paginacao. */
  unica?: boolean;
}
const desc = { ascending: false };
/** Tabela da allowlist -> fatia e consulta. Ordem e filtro replicam `carregarRemoto` (src/data/supabase.ts). */
export const PLANO_LEITURA: Record<string, PlanoTabela> = {
  organization: { chave: 'orgs' },
  company: { chave: 'companies' },
  profile: { chave: 'perfis' },
  user_scope: { chave: 'scopes' },
  parameter_set: { chave: 'params', unica: true, configurar: (q) => q.eq('active', true).limit(1) },
  scenario_factor: { chave: 'fatores' },
  chart_account: { chave: 'plano', configurar: (q) => q.order('category') },
  bank_account: { chave: 'contas', configurar: (q) => q.order('code') },
  project: { chave: 'obras', configurar: (q) => q.order('code') },
  financial_entry: { chave: 'lancs', configurar: (q) => q.order('code') },
  settlement: { chave: 'liqs', configurar: (q) => q.eq('reversed', false).order('settled_on') },
  bank_transaction: { chave: 'trans', configurar: (q) => q.order('transaction_date', desc) },
  reconciliation: { chave: 'recs' },
  debt: { chave: 'dividas', configurar: (q) => q.order('code') },
  approval_request: { chave: 'aprovs', configurar: (q) => q.order('requested_at', desc) },
  approval_step: { chave: 'steps', configurar: (q) => q.order('step_order') },
  period_close: { chave: 'closes' },
  project_service: { chave: 'servicosRows', configurar: (q) => q.order('code') },
  measurement: { chave: 'medicoesRows', configurar: (q) => q.order('month_no').order('number') },
  demand: { chave: 'demandasRows', configurar: (q) => q.order('created_at') },
  demand_completion: { chave: 'conclusoesRows' },
  production_order: { chave: 'ordensRows', configurar: (q) => q.order('code') },
  production_stage: { chave: 'etapasRows', configurar: (q) => q.order('stage_order') },
  purchase_order: { chave: 'pedidosRows', configurar: (q) => q.order('code') },
  purchase_order_item: { chave: 'pedidosItens', configurar: (q) => q.order('item_order') },
  assembly: { chave: 'conjuntosRows', configurar: (q) => q.order('mark') },
  service_progress: { chave: 'avancosRows', configurar: (q) => q.order('measured_on') },
};

/** Fatias de LinhasDataset que ficam VAZIAS no servidor (tabelas de FORA_DO_DATASET_SERVIDOR: PII, volume ou irrelevancia). */
export const FATIAS_VAZIAS: (keyof LinhasDataset)[] = [
  'coms', 'tasks', 'audit', 'workers', 'timesheets', 'tsLines', 'tsOutputs', 'tsIncidents', 'estacaoRows', 'romaneioRows',
  'stockItems', 'stockMovs', 'trainingRows', 'fotoRows', 'funcRows', 'alocRows', 'insumosRows', 'compRows', 'compItens', 'estRows', 'estItens',
];
// referencia explicita: a lista do contrato documenta o que fica de fora; este modulo nao consulta nenhuma delas
export const TABELAS_FORA: readonly string[] = FORA_DO_DATASET_SERVIDOR;

// ---------------------------------------------------------------------------
// 3) Leitura paginada, SELECT-only
// ---------------------------------------------------------------------------
type Filtro = (q: Construtor) => Construtor;

/** Le todas as paginas de uma consulta. `abrir` cria a consulta (com o filtro obrigatorio ja aplicado) a cada pagina. */
async function lerPaginado(codigo: string, abrir: () => Construtor, plano: PlanoTabela): Promise<Row[]> {
  if (plano.unica) {
    const q = plano.configurar ? plano.configurar(abrir()) : abrir();
    return linhasOuErro(codigo, q);
  }
  const out: Row[] = [];
  for (let de = 0; ; de += PAGINA) {
    let q = abrir();
    if (plano.configurar) q = plano.configurar(q);
    q = q.order('id').range(de, de + PAGINA - 1);
    const linhas = await linhasOuErro(codigo, q);
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}

async function lerTabela(cliente: SupabaseClient, organizationId: string, entrada: EntradaAllowlist, lidas: Map<string, Row[]>): Promise<Row[]> {
  const plano = PLANO_LEITURA[entrada.tabela];
  if (!plano) throw new ErroCentralServidor('tabela_sem_plano', 'deterministico', `tabela_sem_plano (deterministico; ${entrada.tabela})`);
  const codigo = `ler_${entrada.tabela}`;
  const abrir = (filtro: Filtro) => () => filtro(cliente.from(entrada.tabela).select('*'));
  if (entrada.raiz) {
    const coluna = entrada.colunaOrganizacao ?? 'organization_id';
    return lerPaginado(codigo, abrir((q) => q.eq(coluna, organizationId)), plano);
  }
  const pai = entrada.pai;
  if (!pai) throw new ErroCentralServidor('allowlist_invalida', 'deterministico', `allowlist_invalida (deterministico; ${entrada.tabela} sem raiz e sem pai)`);
  const linhasPai = lidas.get(pai.tabela);
  if (!linhasPai) throw new ErroCentralServidor('allowlist_invalida', 'deterministico', `allowlist_invalida (deterministico; pai de ${entrada.tabela} ainda nao lido)`);
  const ids = [...new Set(linhasPai.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return []; // pai vazio: a filha nem e consultada
  const out: Row[] = [];
  for (const bloco of emBlocos(ids)) out.push(...(await lerPaginado(codigo, abrir((q) => q.in(pai.coluna, bloco)), plano)));
  return out;
}

/** Le todas as tabelas da allowlist: raizes em paralelo, filhas assim que o pai estiver lido. */
export async function lerLinhasAllowlist(cliente: SupabaseClient, organizationId: string): Promise<Map<string, Row[]>> {
  const lidas = new Map<string, Row[]>();
  let pendentes = [...ALLOWLIST_DATASET];
  while (pendentes.length > 0) {
    const prontas = pendentes.filter((e) => e.raiz || (e.pai && lidas.has(e.pai.tabela)));
    if (prontas.length === 0) throw new ErroCentralServidor('allowlist_invalida', 'deterministico', 'allowlist_invalida (deterministico; filha sem pai na allowlist)');
    const resultados = await Promise.all(prontas.map((e) => lerTabela(cliente, organizationId, e, lidas)));
    prontas.forEach((e, i) => lidas.set(e.tabela, resultados[i]));
    pendentes = pendentes.filter((e) => !lidas.has(e.tabela));
  }
  return lidas;
}

/** Monta LinhasDataset a partir das tabelas lidas: allowlist -> fatia; o resto vazio. */
export function linhasDataset(lidas: Map<string, Row[]>): LinhasDataset {
  const l = Object.fromEntries(FATIAS_VAZIAS.map((k) => [k, []])) as Partial<LinhasDataset>;
  for (const [tabela, plano] of Object.entries(PLANO_LEITURA)) l[plano.chave] = lidas.get(tabela) ?? [];
  return l as LinhasDataset;
}

// ---------------------------------------------------------------------------
// 4) Fabrica (nome e assinatura fixos pelo contrato)
// ---------------------------------------------------------------------------
export function criarCarregadorDataset(cliente: SupabaseClient): CarregarDatasetServidor {
  return async (organizationId) => {
    if (typeof organizationId !== 'string' || !UUID.test(organizationId.trim())) {
      throw new ErroCentralServidor('organizacao_ausente', 'deterministico', 'organizacao_ausente (deterministico)');
    }
    const org = organizationId.trim();
    const lidas = await lerLinhasAllowlist(cliente, org);
    try {
      return montarDataset(linhasDataset(lidas)).ds;
    } catch {
      // montarDataset lanca quando organizacao/empresa faltam: sem elas nao ha Dataset (nada e consultado de novo)
      throw new ErroCentralServidor('organizacao_desconhecida', 'deterministico', 'organizacao_desconhecida (deterministico)');
    }
  };
}
