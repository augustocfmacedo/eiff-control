// Mapa vivo executivo (MC-CONSTRUCTION-V2B) — projeção PURA do mapa por MÓDULOS da Central de Construção.
//
// A primeira camada do Mapa vivo mostra os módulos do catálogo (MODULOS_CONSTRUCAO), agrupados pelos domínios, com o
// estado e a fração da MESMA projeção da Visão geral (panoramaConstrucao → resumoExecutivo). Nada aqui calcula estado.
// O grafo técnico de mapaVivo.ts continua intacto e é a segunda camada ("arquitetura técnica").
//
// Regras que este módulo existe para garantir (cada uma com teste em mapaExecutivo.test.ts):
//   1. Os nós são exatamente os módulos do catálogo — nó técnico não vira módulo por nome.
//   2. Aresta executiva só existe se estiver DECLARADA (`dependeDe` do catálogo) ou se vier de uma aresta técnica cujos
//      dois extremos pertencem, de forma demonstrável, a módulos diferentes (moduloDoNoTecnico). Nada é inventado.
//   3. Um nó técnico pertence a um módulo só por correspondência declarada (MODULO_DO_NO) ou quando TODOS os seus gates
//      pertencem aos gates de UM único módulo. Nó sem gate e sem correspondência não pertence a módulo nenhum.
//   4. Impacto de bloqueio é leitura das dependências declaradas; o estado de nenhum módulo muda por ele.
//   5. Zero rede, zero escrita, zero React.
import {
  DOMINIOS_CONSTRUCAO, MODULOS_CONSTRUCAO, MODULO_DO_NO, gatesDoModulo, resumoExecutivo,
  type DominioConstrucao, type EstadoConstrucao, type ModuloConstrucao, type PanoramaConstrucao, type ResumoExecutivo,
} from './construcao';
import { ARESTAS, NOS, type TipoAresta } from './mapaVivo';

// ---------------------------------------------------------------------------------------- pertença

/**
 * O módulo a que um nó TÉCNICO pertence, quando isso é demonstrável; senão null. Duas regras e nenhuma outra:
 * correspondência declarada (o nó É o módulo) ou todos os gates do nó dentro dos gates de exatamente um módulo.
 */
export function moduloDoNoTecnico(noId: string, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): string | null {
  const declarado = MODULO_DO_NO[noId];
  if (declarado) return declarado;
  const no = NOS.find((n) => n.id === noId);
  if (!no || no.gates.length === 0) return null;
  const donos = modulos.filter((mo) => { const g = new Set(gatesDoModulo(mo)); return no.gates.every((x) => g.has(x)); });
  return donos.length === 1 ? donos[0].id : null;
}

// ---------------------------------------------------------------------------------------- arestas

/** Os dois tipos que a camada executiva mostra; observa e evidência ficam na arquitetura técnica. */
export type TipoArestaExecutiva = Extract<TipoAresta, 'dependencia' | 'fluxo'>;

export interface ArestaExecutiva {
  /** o módulo de que o outro depende (ou que entrega) */
  de: string;
  /** o módulo que depende (ou que recebe) */
  para: string;
  tipos: TipoArestaExecutiva[];
  /** está no `dependeDe` do catálogo */
  declarada: boolean;
  /** as arestas técnicas que colapsaram nesta (de→para:tipo), para o detalhe */
  tecnicas: string[];
  /** rótulo da aresta técnica de fluxo, quando houver */
  rotulo?: string;
}

/**
 * Arestas módulo → módulo. Base: as dependências declaradas no catálogo. Acima delas, só as arestas técnicas de
 * `fluxo`/`dependencia` cujos dois extremos pertencem a módulos DIFERENTES (moduloDoNoTecnico). Observa e evidência
 * não sobem para a camada executiva. Ordem determinística: a do catálogo.
 */
export function arestasExecutivas(modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): ArestaExecutiva[] {
  const porPar = new Map<string, ArestaExecutiva>();
  const chave = (de: string, para: string) => `${de}>${para}`;
  for (const mo of modulos) for (const d of mo.dependeDe ?? []) {
    porPar.set(chave(d, mo.id), { de: d, para: mo.id, tipos: ['dependencia'], declarada: true, tecnicas: [] });
  }
  for (const a of ARESTAS) {
    if (a.tipo !== 'fluxo' && a.tipo !== 'dependencia') continue;
    const de = moduloDoNoTecnico(a.de, modulos);
    const para = moduloDoNoTecnico(a.para, modulos);
    if (!de || !para || de === para) continue;
    const k = chave(de, para);
    const atual = porPar.get(k) ?? { de, para, tipos: [], declarada: false, tecnicas: [] };
    if (!atual.tipos.includes(a.tipo)) atual.tipos.push(a.tipo);
    atual.tecnicas.push(`${a.de}→${a.para}:${a.tipo}`);
    if (a.tipo === 'fluxo' && a.rotulo && !atual.rotulo) atual.rotulo = a.rotulo;
    porPar.set(k, atual);
  }
  const ordem = new Map(modulos.map((m, i) => [m.id, i]));
  return [...porPar.values()].sort((x, y) => (ordem.get(x.para)! - ordem.get(y.para)!) || (ordem.get(x.de)! - ordem.get(y.de)!));
}

// ---------------------------------------------------------------------------------------- impacto

/**
 * O que um módulo alcança pelas dependências DECLARADAS: quem depende dele diretamente e quem depende indiretamente.
 * É leitura do catálogo — nenhum estado é propagado nem alterado.
 */
export function impactoDe(moduloId: string, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): { diretos: string[]; indiretos: string[] } {
  const dependentes = (id: string) => modulos.filter((m) => m.dependeDe?.includes(id)).map((m) => m.id);
  const diretos = dependentes(moduloId);
  const vistos = new Set([moduloId, ...diretos]);
  const indiretos: string[] = [];
  const fila = [...diretos];
  while (fila.length) {
    for (const d of dependentes(fila.shift()!)) if (!vistos.has(d)) { vistos.add(d); indiretos.push(d); fila.push(d); }
  }
  return { diretos, indiretos };
}

// ---------------------------------------------------------------------------------------- filtros

export const FILTROS_MAPA = ['TODOS', 'EM_CONSTRUCAO', 'BLOQUEIOS'] as const;
export type FiltroMapa = (typeof FILTROS_MAPA)[number];
export const ROTULO_FILTRO_MAPA: Readonly<Record<FiltroMapa, string>> = {
  TODOS: 'Todos', EM_CONSTRUCAO: 'Em construção', BLOQUEIOS: 'Bloqueados e impacto',
};

/** Os módulos em destaque para um filtro. O resto só fica esmaecido — nada some e nenhum estado muda. */
export function destaqueDoFiltro(panorama: PanoramaConstrucao, filtro: FiltroMapa, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): Set<string> {
  if (filtro === 'TODOS') return new Set(panorama.modulos.map((p) => p.modulo.id));
  if (filtro === 'EM_CONSTRUCAO') return new Set(panorama.modulos.filter((p) => p.estado === 'EM_CONSTRUCAO' || p.estado === 'BLOQUEADO').map((p) => p.modulo.id));
  const bloqueados = panorama.modulos.filter((p) => p.estado === 'BLOQUEADO').map((p) => p.modulo.id);
  return new Set(bloqueados.flatMap((id) => { const i = impactoDe(id, modulos); return [id, ...i.diretos, ...i.indiretos]; }));
}

// ---------------------------------------------------------------------------------------- nós

/** Um nó do mapa executivo: o módulo e o MESMO resumo executivo da Visão geral. */
export interface NoExecutivo { id: string; dominio: DominioConstrucao; resumo: ResumoExecutivo }

export function nosExecutivos(panorama: PanoramaConstrucao): NoExecutivo[] {
  return panorama.modulos.map((p) => ({ id: p.modulo.id, dominio: p.modulo.dominio, resumo: resumoExecutivo(p, panorama) }));
}

// ---------------------------------------------------------------------------------------- layout

export interface PosicaoExecutiva { id: string; dominio: DominioConstrucao; coluna: number; linha: number; x: number; y: number }
export interface FaixaExecutiva { dominio: DominioConstrucao; y: number; altura: number; linhas: number }
export interface LayoutExecutivo {
  nos: PosicaoExecutiva[];
  faixas: FaixaExecutiva[];
  colunas: number;
  largura: number;
  altura: number;
  largNo: number;
  altNo: number;
  /** geometria dos corredores (espaços livres de cartão) — o roteamento das arestas usa só estes espaços */
  margem: number;
  gapX: number;
  gapY: number;
  faixaTitulo: number;
}

/** Profundidade de cada módulo pelo caminho mais longo de dependências declaradas (raiz = 0). O catálogo não tem ciclo. */
export function profundidadeDosModulos(modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): Map<string, number> {
  const ids = new Set(modulos.map((m) => m.id));
  const prof = new Map<string, number>();
  const visita = (id: string, pilha: Set<string>): number => {
    if (prof.has(id)) return prof.get(id)!;
    if (pilha.has(id)) throw new Error(`ciclo de dependência no catálogo em ${id}`);
    pilha.add(id);
    const deps = (modulos.find((m) => m.id === id)?.dependeDe ?? []).filter((d) => ids.has(d));
    const p = deps.length ? Math.max(...deps.map((d) => visita(d, pilha) + 1)) : 0;
    pilha.delete(id);
    prof.set(id, p);
    return p;
  };
  for (const m of modulos) visita(m.id, new Set());
  return prof;
}

/**
 * Posições determinísticas: colunas pela profundidade de dependência (quem habilita à esquerda, quem depende à
 * direita), faixas horizontais pelos domínios do catálogo. Módulo SEM nenhuma relação executiva não tem profundidade
 * que signifique algo: vai para a coluna mais vazia da própria faixa (empate: a mais à esquerda), o que mantém a
 * visão macro compacta sem mentir sobre dependência — as setas continuam só as declaradas.
 */
export function layoutExecutivo(opts: { largNo?: number; altNo?: number; gapX?: number; gapY?: number; margem?: number; faixaTitulo?: number } = {}, modulos: readonly ModuloConstrucao[] = MODULOS_CONSTRUCAO): LayoutExecutivo {
  const largNo = opts.largNo ?? 196;
  const altNo = opts.altNo ?? 48;
  const gapX = opts.gapX ?? 40;
  const gapY = opts.gapY ?? 10;
  const margem = opts.margem ?? 12;
  const faixaTitulo = opts.faixaTitulo ?? 22;
  const prof = profundidadeDosModulos(modulos);
  const relacionados = new Set(arestasExecutivas(modulos).flatMap((a) => [a.de, a.para]));
  const colunas = Math.max(0, ...prof.values()) + 1;
  const nos: PosicaoExecutiva[] = [];
  const faixas: FaixaExecutiva[] = [];
  let y = margem;
  for (const dominio of DOMINIOS_CONSTRUCAO) {
    const doDominio = modulos.filter((m) => m.dominio === dominio);
    if (!doDominio.length) continue;
    const porColuna: string[][] = Array.from({ length: colunas }, () => []);
    for (const m of doDominio.filter((x) => relacionados.has(x.id))) porColuna[prof.get(m.id)!].push(m.id);
    for (const m of doDominio.filter((x) => !relacionados.has(x.id))) {
      const menor = Math.min(...porColuna.map((c) => c.length));
      porColuna[porColuna.findIndex((c) => c.length === menor)].push(m.id);
    }
    const linhas = Math.max(1, ...porColuna.map((c) => c.length));
    const topo = y + faixaTitulo;
    porColuna.forEach((ids, coluna) => ids.forEach((id, linha) => {
      nos.push({ id, dominio, coluna, linha, x: margem + coluna * (largNo + gapX), y: topo + linha * (altNo + gapY) });
    }));
    const altura = faixaTitulo + linhas * altNo + (linhas - 1) * gapY + 8;
    faixas.push({ dominio, y, altura, linhas });
    y += altura + gapY;
  }
  return { nos, faixas, colunas, largura: margem * 2 + colunas * largNo + (colunas - 1) * gapX, altura: y - gapY + margem, largNo, altNo, margem, gapX, gapY, faixaTitulo };
}

/** Estado → classe visual do nó. O texto do estado está sempre no nó; a cor nunca é o único sinal. */
export const CLASSE_ESTADO_MAPA: Readonly<Record<EstadoConstrucao, 'ok' | 'warn' | 'bad' | 'muted' | 'info'>> = {
  CONCLUIDO: 'ok', EM_CONSTRUCAO: 'warn', BLOQUEADO: 'bad', PLANEJADO: 'muted', SEM_EVIDENCIA: 'info',
};

// ---------------------------------------------------------------------------------------- geometria das arestas

export interface Ponto { x: number; y: number }
export interface Retangulo { x: number; y: number; w: number; h: number }
/** O traçado de uma aresta executiva: uma polilinha da borda do módulo de origem até a borda do módulo de destino. */
export interface RotaExecutiva { de: string; para: string; pontos: Ponto[] }

export const retanguloDoNo = (layout: LayoutExecutivo, id: string): Retangulo => {
  const n = layout.nos.find((x) => x.id === id);
  if (!n) throw new Error(`módulo sem posição no mapa: ${id}`);
  return { x: n.x, y: n.y, w: layout.largNo, h: layout.altNo };
};

/**
 * O segmento a→b toca o INTERIOR do retângulo? (Liang–Barsky sobre o retângulo encolhido pela folga.) Encostar na borda
 * — o ponto de saída ou de chegada de uma aresta — não conta como atravessar.
 */
export function segmentoCruzaRetangulo(a: Ponto, b: Ponto, r: Retangulo, folga = 0.5): boolean {
  const xmin = r.x + folga, xmax = r.x + r.w - folga, ymin = r.y + folga, ymax = r.y + r.h - folga;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - xmin, xmax - a.x, a.y - ymin, ymax - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

/** Os cartões cujo interior a rota atravessa. Vazio é a condição exigida para toda aresta executiva. */
export function cartoesAtravessados(rota: RotaExecutiva, layout: LayoutExecutivo): string[] {
  const out = new Set<string>();
  for (let i = 1; i < rota.pontos.length; i++) {
    for (const n of layout.nos) if (segmentoCruzaRetangulo(rota.pontos[i - 1], rota.pontos[i], retanguloDoNo(layout, n.id))) out.add(n.id);
  }
  return [...out];
}

/** Distância mínima entre duas trilhas paralelas que coexistem (unidades do mapa). */
export const DISTANCIA_MINIMA_TRILHAS = 3.5;

/** Espalha n trilhas dentro de [ini, fim], com a do meio no centro quando n = 1. */
const trilhas = (ini: number, fim: number, n: number): number[] =>
  n <= 1 ? [(ini + fim) / 2] : Array.from({ length: n }, (_, i) => ini + ((fim - ini) * i) / (n - 1));

/**
 * Coloração de intervalos: cada item recebe a menor trilha livre no seu trecho [ini, fim]. Itens que não coexistem
 * dividem trilha; os que coexistem nunca. Devolve a trilha de cada item e quantas trilhas foram usadas.
 */
function colorir<T>(itens: T[], ini: (t: T) => number, fim: (t: T) => number): { trilha: Map<T, number>; total: number } {
  const ord = [...itens].sort((a, b) => ini(a) - ini(b));
  const ocupadaAte: number[] = [];
  const trilha = new Map<T, number>();
  for (const t of ord) {
    let k = ocupadaAte.findIndex((ate) => ate + 2 <= ini(t));
    if (k < 0) { k = ocupadaAte.length; ocupadaAte.push(fim(t)); } else ocupadaAte[k] = fim(t);
    trilha.set(t, k);
  }
  return { trilha, total: ocupadaAte.length };
}

/**
 * Traçado das arestas executivas — roteamento ORTOGONAL por corredores, determinístico, que nunca atravessa cartão:
 *   1. sai da borda direita da origem por uma porta própria, na metade de CIMA da borda; entra no destino por uma porta
 *      própria, na metade de BAIXO — assim uma saída e uma chegada na mesma linha nunca ficam na mesma altura;
 *   2. corre na vertical pelo CORREDOR entre colunas (o espaço gapX não tem cartão);
 *   3. quando o destino está mais de uma coluna adiante, cruza as colunas do meio por uma VIA horizontal livre — entre
 *      duas linhas de uma faixa ou entre duas faixas (as linhas de cartões são alinhadas, então a via é livre em toda a
 *      largura) —, a mais próxima da origem entre as que ficam no caminho e que ainda tenham trilha livre;
 *   4. arestas que coexistem num corredor ou numa via ganham trilhas separadas por DISTANCIA_MINIMA_TRILHAS.
 * Nenhum trecho é sobreposto a outro, então nenhuma linha parece continuar outra. A prova é o teste geométrico.
 */
export function rotasExecutivas(layout: LayoutExecutivo = layoutExecutivo(), arestas: readonly ArestaExecutiva[] = arestasExecutivas()): RotaExecutiva[] {
  const { largNo, altNo, gapX, gapY, margem, faixaTitulo } = layout;
  const pos = new Map(layout.nos.map((n) => [n.id, n]));
  const colEsq = (c: number) => margem + c * (largNo + gapX);
  const colDir = (c: number) => colEsq(c) + largNo;
  const meio = (id: string) => pos.get(id)!.y + altNo / 2;
  const indice = new Map(arestas.map((a, i) => [a, i]));
  const col = (id: string) => pos.get(id)!.coluna;

  // 1 · portas: saídas na metade de cima (ordenadas pela altura do destino), chegadas na metade de baixo
  const saida = new Map<ArestaExecutiva, number>();
  const entrada = new Map<ArestaExecutiva, number>();
  for (const n of layout.nos) {
    const sai = arestas.filter((a) => a.de === n.id).sort((a, b) => meio(a.para) - meio(b.para) || indice.get(a)! - indice.get(b)!);
    trilhas(n.y + 6, n.y + altNo / 2 - 3, sai.length).forEach((y, i) => sai[i] && saida.set(sai[i], y));
    const entra = arestas.filter((a) => a.para === n.id).sort((a, b) => meio(a.de) - meio(b.de) || indice.get(a)! - indice.get(b)!);
    trilhas(n.y + altNo / 2 + 3, n.y + altNo - 6, entra.length).forEach((y, i) => entra[i] && entrada.set(entra[i], y));
  }

  // 3 · vias horizontais livres, com capacidade pelo espaçamento mínimo
  const vias: { topo: number; base: number }[] = [];
  layout.faixas.forEach((f, k) => {
    const topoLinha = (r: number) => f.y + faixaTitulo + r * (altNo + gapY);
    for (let r = 0; r < f.linhas - 1; r++) vias.push({ topo: topoLinha(r) + altNo, base: topoLinha(r + 1) });
    vias.push({ topo: topoLinha(f.linhas - 1) + altNo, base: k < layout.faixas.length - 1 ? f.y + f.altura + gapY : f.y + f.altura });
  });
  const centro = (v: { topo: number; base: number }) => (v.topo + v.base) / 2;
  const capacidade = (v: { topo: number; base: number }) => Math.floor((v.base - v.topo - 5) / DISTANCIA_MINIMA_TRILHAS) + 1;
  // a via cobre o trecho horizontal entre o corredor da origem e o corredor antes do destino
  const trechoX = (a: ArestaExecutiva): [number, number] => [colDir(col(a.de)), colEsq(col(a.para))];
  const viaDe = new Map<ArestaExecutiva, number>();
  const longas = arestas.filter((a) => col(a.para) > col(a.de) + 1);
  for (const a of longas) {
    const ys = saida.get(a)!, yt = entrada.get(a)!;
    const lo = Math.min(ys, yt), hi = Math.max(ys, yt);
    const custo = (v: { topo: number; base: number }) => {
      const noCaminho = centro(v) >= lo && centro(v) <= hi;
      return (noCaminho ? 0 : 10_000) + Math.abs(centro(v) - ys) + (noCaminho ? 0 : Math.abs(centro(v) - yt));
    };
    const ordem = vias.map((v, i) => ({ v, i })).sort((x, y) => custo(x.v) - custo(y.v) || x.i - y.i);
    const escolhida = ordem.find(({ v, i }) => {
      const juntas = [...longas.filter((b) => viaDe.get(b) === i), a];
      return colorir(juntas, (b) => trechoX(b)[0], (b) => trechoX(b)[1]).total <= capacidade(v);
    }) ?? ordem[0];
    viaDe.set(a, escolhida.i);
  }
  const yNaVia = new Map<ArestaExecutiva, number>();
  vias.forEach((v, i) => {
    const naVia = longas.filter((a) => viaDe.get(a) === i);
    if (!naVia.length) return;
    const { trilha, total } = colorir(naVia, (b) => trechoX(b)[0], (b) => trechoX(b)[1]);
    const ys = trilhas(v.topo + 2.5, v.base - 2.5, total);
    for (const a of naVia) yNaVia.set(a, ys[trilha.get(a)!]);
  });

  // 2 · trilhas verticais: em cada corredor, usos que coexistem na altura ganham x diferentes
  type Uso = { a: ArestaExecutiva; papel: 'saida' | 'entrada'; y1: number; y2: number };
  const usos = new Map<number, Uso[]>();
  const usar = (k: number, u: Uso) => usos.set(k, [...(usos.get(k) ?? []), u]);
  for (const a of arestas) {
    const cs = col(a.de), ct = col(a.para);
    const ys = saida.get(a)!, yt = entrada.get(a)!;
    if (ct === cs + 1) { usar(cs, { a, papel: 'saida', y1: ys, y2: yt }); continue; }
    const yl = yNaVia.get(a)!;
    usar(cs, { a, papel: 'saida', y1: ys, y2: yl });
    usar(ct - 1, { a, papel: 'entrada', y1: yl, y2: yt });
  }
  const xDoUso = new Map<string, number>();
  for (const [k, lista] of usos) {
    // usos que coexistem na mesma faixa de altura (com folga) precisam de x diferentes
    const { trilha, total } = colorir(lista, (u) => Math.min(u.y1, u.y2) - altNo / 2, (u) => Math.max(u.y1, u.y2) + altNo / 2);
    const xs = trilhas(colDir(k) + 8, colEsq(k + 1) - 8, total);
    for (const u of lista) xDoUso.set(`${indice.get(u.a)}:${u.papel}`, xs[trilha.get(u)!]);
  }

  return arestas.map((a) => {
    const cs = col(a.de), ct = col(a.para);
    const ys = saida.get(a)!, yt = entrada.get(a)!;
    const x1 = xDoUso.get(`${indice.get(a)}:saida`)!;
    const pontos: Ponto[] = ct === cs + 1
      ? [{ x: colDir(cs), y: ys }, { x: x1, y: ys }, { x: x1, y: yt }, { x: colEsq(ct), y: yt }]
      : (() => {
        const yl = yNaVia.get(a)!; const x2 = xDoUso.get(`${indice.get(a)}:entrada`)!;
        return [{ x: colDir(cs), y: ys }, { x: x1, y: ys }, { x: x1, y: yl }, { x: x2, y: yl }, { x: x2, y: yt }, { x: colEsq(ct), y: yt }];
      })();
    return { de: a.de, para: a.para, pontos: pontos.filter((p, i) => i === 0 || p.x !== pontos[i - 1].x || p.y !== pontos[i - 1].y) };
  });
}
