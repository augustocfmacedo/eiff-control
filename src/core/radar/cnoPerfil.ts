// LE-3B — perfil estatistico do universo CNO. Puro: recebe observacoes uma a uma e produz AGREGADOS.
//
// Memoria: histogramas de largura fixa (nunca a lista de valores), contagens por categoria pequena (UF,
// situacao, destinacao...), contagem por municipio (~5,6 mil) e por CNPJ responsavel (limitada ao numero de
// CNPJs distintos, nao ao numero de obras). Nada aqui cresce com o numero de CNOs por si so.
//
// Privacidade: o resumo nunca contem nome de pessoa fisica, CPF, NI de PF, endereco ou payload. So contagens,
// e — para diagnostico de outlier de tamanho — o numero do CNO.
import { envelopeCno, dataEventoCno, sinalCno, type CnoObservacao, type CnoObservacaoCanonica } from './cnoDadosAbertos';
import { AREAS_SENSIBILIDADE, JANELAS_SENSIBILIDADE, areaM2, avaliarPolitica, cenariosLe3b, dataMenosDias, diasEntre, type CnoDiscoveryPolicy } from './cnoDiscoveryPolicy';

// ---------------------------------------------------------------------------------------------------- buckets
export const FAIXAS_IDADE = [
  { rotulo: '0-30', ate: 30 }, { rotulo: '31-90', ate: 90 }, { rotulo: '91-180', ate: 180 },
  { rotulo: '181-365', ate: 365 }, { rotulo: '366-730', ate: 730 }, { rotulo: '>730', ate: Infinity },
] as const;
export const FAIXA_SEM_DATA = 'sem data';
export const FAIXA_FUTURO = 'futuro';

export function faixaIdade(dias: number | undefined): string {
  if (dias === undefined) return FAIXA_SEM_DATA;
  if (dias < 0) return FAIXA_FUTURO;
  for (const f of FAIXAS_IDADE) if (dias <= f.ate) return f.rotulo;
  return '>730';
}

export const FAIXAS_AREA = [
  { rotulo: '<250', ate: 250 }, { rotulo: '250-499', ate: 500 }, { rotulo: '500-999', ate: 1000 },
  { rotulo: '1000-1999', ate: 2000 }, { rotulo: '2000-4999', ate: 5000 }, { rotulo: '5000-9999', ate: 10000 },
  { rotulo: '10000-19999', ate: 20000 }, { rotulo: '20000+', ate: Infinity },
] as const;
export const FAIXA_SEM_AREA = 'sem area';

export function faixaArea(m2: number | undefined): string {
  if (m2 === undefined) return FAIXA_SEM_AREA;
  for (const f of FAIXAS_AREA) if (m2 < f.ate) return f.rotulo;
  return '20000+';
}

export const FAIXAS_OBRAS_POR_CNPJ = ['1', '2-5', '6-20', '21-100', '100+'] as const;
export function faixaObrasPorCnpj(n: number): string {
  if (n <= 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

// -------------------------------------------------------------------------------------------------- histograma
/**
 * Histograma de largura fixa para percentis sem guardar a lista. Erro maximo = largura do bin; o maximo e
 * exato. Valores acima do teto caem no ultimo bin (contados, e o maximo continua exato).
 */
export class Histograma {
  private readonly bins: Uint32Array;
  n = 0;
  maximo: number | undefined;
  soma = 0;
  constructor(readonly largura: number, readonly teto: number) {
    this.bins = new Uint32Array(Math.ceil(teto / largura) + 1);
  }
  adicionar(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    const i = Math.min(this.bins.length - 1, Math.floor(v / this.largura));
    this.bins[i]++;
    this.n++;
    this.soma += v;
    if (this.maximo === undefined || v > this.maximo) this.maximo = v;
  }
  /** Limite superior do bin onde o percentil cai (conservador). `undefined` sem amostras. */
  percentil(p: number): number | undefined {
    if (!this.n) return undefined;
    const alvo = Math.max(1, Math.ceil((p / 100) * this.n));
    let acumulado = 0;
    for (let i = 0; i < this.bins.length; i++) {
      acumulado += this.bins[i];
      if (acumulado >= alvo) return i === this.bins.length - 1 ? (this.maximo ?? (i + 1) * this.largura) : (i + 1) * this.largura;
    }
    return this.maximo;
  }
  get media(): number | undefined { return this.n ? this.soma / this.n : undefined; }
  resumo(): { n: number; p50?: number; p90?: number; p95?: number; p99?: number; max?: number; media?: number } {
    return { n: this.n, p50: this.percentil(50), p90: this.percentil(90), p95: this.percentil(95), p99: this.percentil(99), max: this.maximo, media: this.media === undefined ? undefined : Math.round(this.media) };
  }
}

// ------------------------------------------------------------------------------------------------ contadores
type Contagem = Record<string, number>;
const mais = (c: Contagem, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };
const ordenado = (c: Contagem, limite?: number): [string, number][] => {
  const l = Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return limite ? l.slice(0, limite) : l;
};

const codificarUtf8 = (s: string): number => new TextEncoder().encode(s).length;

export interface FatosObra {
  pj: boolean;
  cnpj: boolean;
  sinal: ReturnType<typeof sinalCno>;
  temSinal: boolean;
  dias: number | undefined;
  area: number | undefined;
  uf: string;
  galpao: boolean;
  ativa: boolean;
}

/** Fatos derivados de uma obra, calculados UMA vez e reutilizados por todas as contagens. */
export function fatosDe(o: CnoObservacaoCanonica, referencia: string): FatosObra {
  const ev = dataEventoCno(o);
  const sinal = sinalCno(o);
  return {
    pj: !!o.nomeResponsavel,
    cnpj: !!o.cnpjResponsavel,
    sinal,
    temSinal: sinal !== 'NENHUM',
    dias: ev ? diasEntre(ev.data, referencia) : undefined,
    area: areaM2(o),
    uf: o.uf ?? '—',
    galpao: o.areas.some((a) => a.categoria !== undefined && a.destinacao === 'Galpão industrial'),
    ativa: o.situacao === '02',
  };
}

interface Cenario { id: string; nome: string; politica: CnoDiscoveryPolicy; total: number; porUf: Contagem; porSinal: Contagem; area: Histograma; recusas: Contagem }

/** Acumulador do perfil. Chame `adicionar` por observacao e `resumo()` no fim. */
export class PerfilCno {
  readonly referencia: string;
  total = 0;
  private readonly c = {
    pj: 0, semPj: 0, cnpjValido: 0,
    situacao: {} as Contagem, uf: {} as Contagem, municipio: {} as Contagem, categoria: {} as Contagem,
    destinacao: {} as Contagem, tipoConstrutivo: {} as Contagem, qualificacao: {} as Contagem,
    sinal: {} as Contagem, idade: {} as Contagem, area: {} as Contagem, unidade: {} as Contagem,
    semArea: 0, semCategoria: 0,
  };
  private readonly inter: Contagem = {};
  private readonly interPorUf: Record<string, Contagem> = {};
  private readonly go = { total: 0, pj: 0, sinal: 0, sinalRecente365: 0, destinacao: {} as Contagem, area: {} as Contagem, municipio: {} as Contagem, idade: {} as Contagem };
  private readonly cenarios: Cenario[];
  private readonly sens: { brasil: number[][]; go: number[][] };
  private readonly payload = new Histograma(64, 4 * 1024 * 1024);
  private readonly payloadGrandes = { acima100k: 0, acima500k: 0, acima1m: 0 };
  private readonly payloadTop: { cno: string; bytes: number }[] = [];
  private readonly obrasPorCnpj = new Map<number, number>();
  private readonly areaPj = new Histograma(25, 100_000);

  constructor(referencia: string) {
    this.referencia = referencia;
    this.cenarios = cenariosLe3b(referencia).map((c) => ({ ...c, total: 0, porUf: {}, porSinal: {}, area: new Histograma(25, 100_000), recusas: {} }));
    this.sens = {
      brasil: JANELAS_SENSIBILIDADE.map(() => AREAS_SENSIBILIDADE.map(() => 0)),
      go: JANELAS_SENSIBILIDADE.map(() => AREAS_SENSIBILIDADE.map(() => 0)),
    };
  }

  adicionar(obs: CnoObservacao): void {
    const o = obs.canonical;
    const f = fatosDe(o, this.referencia);
    const c = this.c;
    this.total++;

    // ---- dimensoes isoladas
    if (f.pj) c.pj++; else c.semPj++;
    if (f.cnpj) c.cnpjValido++;
    mais(c.situacao, o.situacao ? `${o.situacao} ${o.situacaoNome ?? ''}`.trim() : '—');
    mais(c.uf, f.uf);
    mais(c.municipio, `${f.uf}/${o.municipio ?? '—'}`);
    mais(c.qualificacao, o.qualificacaoResponsavel ? `${o.qualificacaoResponsavel} ${o.qualificacaoResponsavelNome ?? ''}`.trim() : '—');
    mais(c.sinal, f.sinal);
    mais(c.idade, faixaIdade(f.dias));
    mais(c.area, faixaArea(f.area));
    mais(c.unidade, o.unidadeMedida ?? '—');
    if (f.area === undefined) c.semArea++;
    const cats = new Set(o.areas.map((a) => a.categoria).filter((x): x is string => !!x));
    const dests = new Set(o.areas.map((a) => a.destinacao).filter((x): x is string => !!x));
    const tipos = new Set(o.areas.map((a) => a.tipoConstrutivo).filter((x): x is string => !!x));
    if (!cats.size) c.semCategoria++;
    for (const x of cats) mais(c.categoria, x);
    for (const x of dests) mais(c.destinacao, x);
    for (const x of tipos) mais(c.tipoConstrutivo, x);

    // ---- intersecoes
    const rec365 = f.dias !== undefined && f.dias >= 0 && f.dias <= 365;
    const marcar = (k: string) => { mais(this.inter, k); mais(this.interPorUf[f.uf] ??= {}, k); };
    if (f.pj && f.cnpj) marcar('PJ+CNPJ_VALIDO');
    if (f.pj && f.temSinal) {
      marcar('PJ+SINAL');
      if (f.ativa) marcar('PJ+SINAL+ATIVA');
      if (rec365) marcar('PJ+SINAL+EVENTO<=365');
      if (f.area !== undefined && f.area >= 500) marcar('PJ+SINAL+AREA>=500');
      if (f.area !== undefined && f.area >= 1000) marcar('PJ+SINAL+AREA>=1000');
      if (f.area !== undefined && f.area >= 2000) marcar('PJ+SINAL+AREA>=2000');
    }
    if (f.pj && f.galpao) {
      marcar('PJ+GALPAO');
      if (rec365) marcar('PJ+GALPAO+EVENTO<=365');
      if (f.area !== undefined && f.area >= 1000) marcar('PJ+GALPAO+AREA>=1000');
    }
    if (f.pj && f.area !== undefined) this.areaPj.adicionar(f.area);

    // ---- Goias: relatorio, nao regra
    if (f.uf === 'GO') {
      const g = this.go;
      g.total++;
      if (f.pj) g.pj++;
      if (f.pj && f.temSinal) g.sinal++;
      if (f.pj && f.temSinal && rec365) g.sinalRecente365++;
      for (const x of dests) mais(g.destinacao, x);
      mais(g.area, faixaArea(f.area));
      mais(g.municipio, o.municipio ?? '—');
      mais(g.idade, faixaIdade(f.dias));
    }

    // ---- cenarios
    for (const cen of this.cenarios) {
      const r = avaliarPolitica(o, cen.politica);
      if (!r.elegivel) { for (const m of r.motivosRecusa) mais(cen.recusas, m); continue; }
      cen.total++;
      mais(cen.porUf, f.uf);
      mais(cen.porSinal, f.sinal);
      if (f.area !== undefined) cen.area.adicionar(f.area);
    }

    // ---- matriz de sensibilidade: PJ + CNPJ valido + sinal, janela x area minima
    if (f.pj && f.cnpj && f.temSinal && f.dias !== undefined && f.dias >= 0) {
      JANELAS_SENSIBILIDADE.forEach((janela, i) => {
        if (f.dias! > janela) return;
        AREAS_SENSIBILIDADE.forEach((minimo, j) => {
          const passa = minimo === 0 || (f.area !== undefined && f.area >= minimo);
          if (!passa) return;
          this.sens.brasil[i][j]++;
          if (f.uf === 'GO') this.sens.go[i][j]++;
        });
      });
    }

    // ---- tamanho do envelope (so PJ: e o universo de todos os cenarios) e duplicidade por CNPJ
    if (f.pj) {
      const bytes = codificarUtf8(JSON.stringify(envelopeCno(obs)));
      this.payload.adicionar(bytes);
      if (bytes > 100 * 1024) this.payloadGrandes.acima100k++;
      if (bytes > 500 * 1024) this.payloadGrandes.acima500k++;
      if (bytes > 1024 * 1024) this.payloadGrandes.acima1m++;
      if (this.payloadTop.length < 5 || bytes > this.payloadTop[this.payloadTop.length - 1].bytes) {
        this.payloadTop.push({ cno: o.cno, bytes });
        this.payloadTop.sort((a, b) => b.bytes - a.bytes);
        if (this.payloadTop.length > 5) this.payloadTop.pop();
      }
    }
    if (o.cnpjResponsavel) {
      const k = Number(o.cnpjResponsavel);
      this.obrasPorCnpj.set(k, (this.obrasPorCnpj.get(k) ?? 0) + 1);
    }
  }

  resumo(): ResumoPerfil {
    const c = this.c;
    // duplicidade por CNPJ: distribuicao e percentis a partir do mapa (limitado a CNPJs distintos)
    const contagens = [...this.obrasPorCnpj.values()].sort((a, b) => a - b);
    const pct = (p: number) => contagens.length ? contagens[Math.min(contagens.length - 1, Math.max(0, Math.ceil((p / 100) * contagens.length) - 1))] : undefined;
    const distCnpj: Contagem = {};
    for (const n of contagens) mais(distCnpj, faixaObrasPorCnpj(n));

    return {
      referencia: this.referencia,
      total: this.total,
      pj: c.pj, semPj: c.semPj, cnpjValido: c.cnpjValido,
      porSituacao: ordenado(c.situacao),
      porUf: ordenado(c.uf),
      topMunicipios: ordenado(c.municipio, 30),
      porCategoria: ordenado(c.categoria),
      porDestinacao: ordenado(c.destinacao),
      porTipoConstrutivo: ordenado(c.tipoConstrutivo),
      porQualificacao: ordenado(c.qualificacao),
      porSinal: ordenado(c.sinal),
      porIdade: [...FAIXAS_IDADE.map((f) => f.rotulo), FAIXA_FUTURO, FAIXA_SEM_DATA].map((r) => [r, c.idade[r] ?? 0] as [string, number]),
      porArea: [...FAIXAS_AREA.map((f) => f.rotulo), FAIXA_SEM_AREA].map((r) => [r, c.area[r] ?? 0] as [string, number]),
      porUnidadeMedida: ordenado(c.unidade),
      semCategoria: c.semCategoria,
      intersecoes: ordenado(this.inter),
      intersecoesPorUf: Object.fromEntries(Object.entries(this.interPorUf).map(([uf, k]) => [uf, k])),
      areaPj: this.areaPj.resumo(),
      goias: {
        total: this.go.total, pj: this.go.pj, sinal: this.go.sinal, sinalRecente365: this.go.sinalRecente365,
        porDestinacao: ordenado(this.go.destinacao), porArea: ordenado(this.go.area), topMunicipios: ordenado(this.go.municipio, 25), porIdade: ordenado(this.go.idade),
      },
      cenarios: this.cenarios.map((cen) => ({
        id: cen.id, nome: cen.nome, politica: cen.politica, total: cen.total,
        go: cen.porUf['GO'] ?? 0, porUf: ordenado(cen.porUf), porSinal: ordenado(cen.porSinal),
        area: cen.area.resumo(), recusas: ordenado(cen.recusas),
      })),
      sensibilidade: {
        janelas: [...JANELAS_SENSIBILIDADE], areas: [...AREAS_SENSIBILIDADE],
        brasil: this.sens.brasil.map((l) => [...l]), go: this.sens.go.map((l) => [...l]),
        eventoDepoisDe: Object.fromEntries(JANELAS_SENSIBILIDADE.map((j) => [j, dataMenosDias(this.referencia, j)])),
      },
      payload: { ...this.payload.resumo(), ...this.payloadGrandes, maiores: this.payloadTop },
      responsaveis: {
        cnpjsUnicos: contagens.length,
        obrasComCnpj: contagens.reduce((a, b) => a + b, 0),
        mediaObrasPorCnpj: contagens.length ? Math.round((contagens.reduce((a, b) => a + b, 0) / contagens.length) * 100) / 100 : undefined,
        medianaObrasPorCnpj: pct(50), p90: pct(90), p99: pct(99), maximo: contagens.length ? contagens[contagens.length - 1] : undefined,
        distribuicao: FAIXAS_OBRAS_POR_CNPJ.map((r) => [r, distCnpj[r] ?? 0] as [string, number]),
      },
    };
  }
}

export interface ResumoPerfil {
  referencia: string;
  total: number;
  pj: number; semPj: number; cnpjValido: number;
  porSituacao: [string, number][];
  porUf: [string, number][];
  topMunicipios: [string, number][];
  porCategoria: [string, number][];
  porDestinacao: [string, number][];
  porTipoConstrutivo: [string, number][];
  porQualificacao: [string, number][];
  porSinal: [string, number][];
  porIdade: [string, number][];
  porArea: [string, number][];
  porUnidadeMedida: [string, number][];
  semCategoria: number;
  intersecoes: [string, number][];
  intersecoesPorUf: Record<string, Contagem>;
  areaPj: ReturnType<Histograma['resumo']>;
  goias: { total: number; pj: number; sinal: number; sinalRecente365: number; porDestinacao: [string, number][]; porArea: [string, number][]; topMunicipios: [string, number][]; porIdade: [string, number][] };
  cenarios: { id: string; nome: string; politica: CnoDiscoveryPolicy; total: number; go: number; porUf: [string, number][]; porSinal: [string, number][]; area: ReturnType<Histograma['resumo']>; recusas: [string, number][] }[];
  sensibilidade: { janelas: number[]; areas: number[]; brasil: number[][]; go: number[][]; eventoDepoisDe: Record<number, string> };
  payload: ReturnType<Histograma['resumo']> & { acima100k: number; acima500k: number; acima1m: number; maiores: { cno: string; bytes: number }[] };
  responsaveis: { cnpjsUnicos: number; obrasComCnpj: number; mediaObrasPorCnpj?: number; medianaObrasPorCnpj?: number; p90?: number; p99?: number; maximo?: number; distribuicao: [string, number][] };
}
