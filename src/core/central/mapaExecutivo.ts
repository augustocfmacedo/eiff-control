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
  return { nos, faixas, colunas, largura: margem * 2 + colunas * largNo + (colunas - 1) * gapX, altura: y - gapY + margem, largNo, altNo };
}

/** Estado → classe visual do nó. O texto do estado está sempre no nó; a cor nunca é o único sinal. */
export const CLASSE_ESTADO_MAPA: Readonly<Record<EstadoConstrucao, 'ok' | 'warn' | 'bad' | 'muted' | 'info'>> = {
  CONCLUIDO: 'ok', EM_CONSTRUCAO: 'warn', BLOQUEADO: 'bad', PLANEJADO: 'muted', SEM_EVIDENCIA: 'info',
};
