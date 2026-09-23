// LE-3B — simulador de politica de descoberta do CNO.
//
// Puro e PARAMETRIZADO. Nenhum valor de corte vive aqui: nem UF, nem area minima, nem janela temporal. O gate
// LE3-B existe para MEDIR o universo antes de decidir; a politica real da EIFF sera escolhida com numeros na
// mao, em gate proprio, e entrara como configuracao — nunca como constante neste arquivo.
//
// O que a politica NAO faz: nao pontua, nao classifica em A/B/C, nao ordena comercialmente. Ela responde so
// "esta obra passa neste recorte?" e explica o porque com um catalogo fechado de motivos.
import { dataEventoCno, sinalCno, type CnoObservacaoCanonica } from './cnoDadosAbertos';

export interface CnoDiscoveryPolicy {
  ufs?: string[];
  municipios?: string[];

  situacoes?: string[];
  categorias?: string[];
  destinacoes?: string[];
  qualificacoes?: string[];

  exigirPessoaJuridica?: boolean;
  exigirCnpjValido?: boolean;
  exigirSinal?: boolean;

  areaMinimaM2?: number;
  areaMaximaM2?: number;

  /** ISO AAAA-MM-DD; a obra passa se a data do evento (precedencia do §34.7) for >= esta */
  eventoDepoisDe?: string;
}

export const MOTIVOS_RECUSA_CNO = [
  'SEM_PJ', 'SEM_CNPJ_VALIDO', 'SITUACAO_FORA', 'SEM_SINAL', 'EVENTO_ANTIGO', 'SEM_DATA_EVENTO',
  'AREA_ABAIXO', 'AREA_ACIMA', 'SEM_AREA', 'UF_FORA', 'MUNICIPIO_FORA', 'CATEGORIA_FORA', 'DESTINACAO_FORA',
  'QUALIFICACAO_FORA',
] as const;
export type MotivoRecusaCno = (typeof MOTIVOS_RECUSA_CNO)[number];

export const MOTIVOS_ACEITE_CNO = [
  'PJ', 'CNPJ_VALIDO', 'SITUACAO_OK', 'SINAL', 'EVENTO_RECENTE', 'AREA_OK', 'UF_OK', 'MUNICIPIO_OK',
  'CATEGORIA_OK', 'DESTINACAO_OK', 'QUALIFICACAO_OK',
] as const;
export type MotivoAceiteCno = (typeof MOTIVOS_ACEITE_CNO)[number];

export interface ResultadoPolitica {
  elegivel: boolean;
  motivosAceite: MotivoAceiteCno[];
  motivosRecusa: MotivoRecusaCno[];
}

/**
 * Area comparavel em m2. A fonte tem `Unidade de medida` = m2 na quase totalidade, mas tambem km, m3, kw e
 * "Outra"; uma area em km ou kw nao e comparavel a metros quadrados, entao vale como AUSENTE — nunca como zero,
 * nunca convertida por palpite.
 */
export function areaM2(o: Pick<CnoObservacaoCanonica, 'areaTotal' | 'unidadeMedida'>): number | undefined {
  if (o.areaTotal === undefined) return undefined;
  const u = (o.unidadeMedida ?? '').toLowerCase();
  return u === 'm2' || u === 'm²' ? o.areaTotal : undefined;
}

const normaliza = (s: string) => s.trim().toUpperCase();
const contem = (lista: string[] | undefined, valor: string | undefined): boolean | undefined =>
  lista === undefined ? undefined : valor !== undefined && lista.map(normaliza).includes(normaliza(valor));

/** Avalia UMA obra contra UMA politica. Deterministica, sem estado, sem efeito. */
export function avaliarPolitica(o: CnoObservacaoCanonica, p: CnoDiscoveryPolicy): ResultadoPolitica {
  const aceite: MotivoAceiteCno[] = [];
  const recusa: MotivoRecusaCno[] = [];
  const ok = (m: MotivoAceiteCno) => { aceite.push(m); };
  const nao = (m: MotivoRecusaCno) => { recusa.push(m); };
  /** um filtro = um par (aceite, recusa); a condicao decide qual dos dois fica registrado */
  const decidir = (passa: boolean | undefined, seSim: MotivoAceiteCno, seNao: MotivoRecusaCno) => { if (passa) ok(seSim); else nao(seNao); };

  if (p.exigirPessoaJuridica) decidir(!!o.nomeResponsavel, 'PJ', 'SEM_PJ');
  if (p.exigirCnpjValido) decidir(!!o.cnpjResponsavel, 'CNPJ_VALIDO', 'SEM_CNPJ_VALIDO');

  if (p.situacoes) decidir(contem(p.situacoes, o.situacao), 'SITUACAO_OK', 'SITUACAO_FORA');
  if (p.ufs) decidir(contem(p.ufs, o.uf), 'UF_OK', 'UF_FORA');
  if (p.municipios) decidir(contem(p.municipios, o.municipio), 'MUNICIPIO_OK', 'MUNICIPIO_FORA');
  if (p.qualificacoes) decidir(contem(p.qualificacoes, o.qualificacaoResponsavel), 'QUALIFICACAO_OK', 'QUALIFICACAO_FORA');

  if (p.categorias) decidir(o.areas.some((a) => contem(p.categorias, a.categoria)), 'CATEGORIA_OK', 'CATEGORIA_FORA');
  if (p.destinacoes) decidir(o.areas.some((a) => contem(p.destinacoes, a.destinacao)), 'DESTINACAO_OK', 'DESTINACAO_FORA');

  if (p.exigirSinal) decidir(sinalCno(o) !== 'NENHUM', 'SINAL', 'SEM_SINAL');

  if (p.eventoDepoisDe) {
    const ev = dataEventoCno(o);
    if (!ev) nao('SEM_DATA_EVENTO');
    else if (ev.data >= p.eventoDepoisDe) ok('EVENTO_RECENTE');
    else nao('EVENTO_ANTIGO');
  }

  if (p.areaMinimaM2 !== undefined || p.areaMaximaM2 !== undefined) {
    const a = areaM2(o);
    if (a === undefined) nao('SEM_AREA');
    else if (p.areaMinimaM2 !== undefined && a < p.areaMinimaM2) nao('AREA_ABAIXO');
    else if (p.areaMaximaM2 !== undefined && a > p.areaMaximaM2) nao('AREA_ACIMA');
    else ok('AREA_OK');
  }

  return { elegivel: recusa.length === 0, motivosAceite: aceite, motivosRecusa: recusa };
}

/** Data ISO `dias` antes de `referencia` (AAAA-MM-DD). Aritmetica em UTC para nao depender do fuso da maquina. */
export function dataMenosDias(referencia: string, dias: number): string {
  const [a, m, d] = referencia.split('-').map(Number);
  const t = Date.UTC(a, m - 1, d) - dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Dias inteiros entre duas datas ISO (referencia - data). Negativo se a data e futura. */
export function diasEntre(data: string, referencia: string): number {
  const p = (s: string) => { const [a, m, d] = s.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((p(referencia) - p(data)) / 86_400_000);
}

/**
 * Cenarios do LE3-B. Sao HIPOTESES para medir, nao a politica da EIFF: nenhum e "o correto". Todos partem
 * de PJ + CNPJ valido + sinal, e variam janela temporal, area e destinacao.
 */
export function cenariosLe3b(referencia: string): { id: string; nome: string; politica: CnoDiscoveryPolicy }[] {
  const base: CnoDiscoveryPolicy = { exigirPessoaJuridica: true, exigirCnpjValido: true, exigirSinal: true, eventoDepoisDe: dataMenosDias(referencia, 365) };
  return [
    { id: 'A', nome: 'PJ + sinal + evento <= 365 dias', politica: base },
    { id: 'B', nome: 'A + area >= 500 m2', politica: { ...base, areaMinimaM2: 500 } },
    { id: 'C', nome: 'A + area >= 1.000 m2', politica: { ...base, areaMinimaM2: 1000 } },
    { id: 'D', nome: 'A + area >= 2.000 m2', politica: { ...base, areaMinimaM2: 2000 } },
    { id: 'E', nome: 'PJ + Galpao industrial + evento <= 365 dias', politica: { ...base, destinacoes: ['Galpão industrial'] } },
    { id: 'F', nome: 'E + area >= 1.000 m2', politica: { ...base, destinacoes: ['Galpão industrial'], areaMinimaM2: 1000 } },
    { id: 'G', nome: 'A + ATIVA (situacao 02)', politica: { ...base, situacoes: ['02'] } },
    { id: 'H', nome: 'PJ + Galpao industrial + evento <= 730 dias + area >= 1.000 m2', politica: { ...base, eventoDepoisDe: dataMenosDias(referencia, 730), destinacoes: ['Galpão industrial'], areaMinimaM2: 1000 } },
  ];
}

/** Eixos da matriz de sensibilidade: janela temporal x area minima. Celula = PJ + CNPJ valido + sinal. */
export const JANELAS_SENSIBILIDADE = [30, 90, 180, 365, 730] as const;
export const AREAS_SENSIBILIDADE = [0, 500, 1000, 2000, 5000] as const;
