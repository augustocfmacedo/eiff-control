// MC-CONSTRUCTION-V2B — Mapa vivo executivo. O mapa mostra MÓDULOS do catálogo, com o estado da MESMA projeção da
// Visão geral, e só relações declaradas ou colapsadas com prova. O grafo técnico continua intacto como segunda camada.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOMINIOS_CONSTRUCAO, MODULOS_CONSTRUCAO, MODULO_DO_NO, gatesDoModulo, moduloDaTarefa, moduloPorId, panoramaConstrucao, projetarModulo,
  resumoExecutivo,
} from './construcao';
import {
  arestasExecutivas, cartoesAtravessados, destaqueDoFiltro, impactoDe, layoutExecutivo, moduloDoNoTecnico, nosExecutivos, profundidadeDosModulos,
  DISTANCIA_MINIMA_TRILHAS, retanguloDoNo, rotasExecutivas, type Ponto,
} from './mapaExecutivo';
import { ARESTAS, NOS, layoutDoMapa } from './mapaVivo';
import type { MissionControlWorkItem } from './workItem';

const conteudo = (f: string) => fs.readFileSync(f, 'utf8');
const MAPA = 'src/screens/MissionControlMapa.tsx';
const DOMINIO = 'src/core/central/mapaExecutivo.ts';
const TELAS = ['src/screens/MissionControl.tsx', 'src/screens/MissionControlVisao.tsx', MAPA, 'src/screens/MissionControlGovernanca.tsx', 'src/screens/MissionControlQuadro.tsx'];
const item = (p: Partial<MissionControlWorkItem> & { id: string }): MissionControlWorkItem => ({
  source: 'GITHUB', procedencia: 'GITHUB_PROJECTION', sourceId: p.id, title: 'x', status: 'EXECUTANDO', statusOrigem: 'pr:open',
  frescor: { observadoEm: '2026-09-30T12:00:00Z', stale: false, fonteIndisponivel: false },
  ...p,
});

describe('V2B · mapa vivo executivo', () => {
  const panorama = panoramaConstrucao(null);

  it('1 · a camada executiva usa exatamente os módulos do catálogo, nos domínios do catálogo', () => {
    const nos = nosExecutivos(panorama);
    expect(nos.map((n) => n.id)).toEqual(MODULOS_CONSTRUCAO.map((m) => m.id));
    for (const n of nos) expect(n.dominio).toBe(moduloPorId(n.id)!.dominio);
    const l = layoutExecutivo();
    expect(l.nos.map((n) => n.id).sort()).toEqual(MODULOS_CONSTRUCAO.map((m) => m.id).sort());
    expect(l.faixas.map((f) => f.dominio)).toEqual(DOMINIOS_CONSTRUCAO.filter((d) => MODULOS_CONSTRUCAO.some((m) => m.dominio === d)));
    // nenhum nó técnico sem módulo entra na camada executiva
    for (const id of NOS.map((n) => n.id).filter((id) => !moduloPorId(id))) expect(l.nos.some((n) => n.id === id), id).toBe(false);
  });

  it('2 · estado e fração vêm da MESMA projeção da Visão geral (resumoExecutivo), com e sem leitura viva', () => {
    for (const n of nosExecutivos(panorama)) {
      expect(n.resumo).toEqual(resumoExecutivo(panorama.modulos.find((p) => p.modulo.id === n.id)!, panorama));
    }
    const itens = [item({ id: 'a', workstreamId: 'OBSERVABILIDADE' })];
    const vivo = panoramaConstrucao(itens);
    const mc = nosExecutivos(vivo).find((n) => n.id === 'MISSION_CONTROL')!;
    expect(mc.resumo).toEqual(resumoExecutivo(vivo.modulos.find((p) => p.modulo.id === 'MISSION_CONTROL')!, vivo));
    expect(mc.resumo.tarefasAtivas).toBe(1);
    // a tela pede a projeção ao domínio e desenha o resumo; não soma componentes
    const src = conteudo(MAPA);
    expect(src).toMatch(/panoramaConstrucao\(itens\)/);
    expect(src).toMatch(/nosExecutivos\(panorama\)/);
  });

  it('3 · não existe estado paralelo de módulo: o domínio do mapa não classifica nem conta componentes', () => {
    const src = conteudo(DOMINIO);
    expect(src).not.toMatch(/projetarComponente|estadoDoModulo|\.componentes\b|concluidos\s*[/+]|['"]EM_CONSTRUCAO['"]\s*:/);
    // o único uso de estado é ler o que a projeção já decidiu (filtros e classes visuais)
    const tela = conteudo(MAPA);
    expect(tela).not.toMatch(/projetarComponente|estadoDoModulo|componentes\.filter/);
    expect(tela).not.toMatch(/function\s+\w*[Ee]stadoDoModulo/);
  });

  it('4 · nenhuma aresta executiva é inventada: ou está declarada no catálogo, ou vem de aresta técnica com dono provado', () => {
    const declaradas = new Set(MODULOS_CONSTRUCAO.flatMap((m) => (m.dependeDe ?? []).map((d) => `${d}>${m.id}`)));
    const arestas = arestasExecutivas();
    for (const a of arestas) {
      if (a.declarada) expect(declaradas.has(`${a.de}>${a.para}`), `${a.de}>${a.para}`).toBe(true);
      else expect(a.tecnicas.length, `${a.de}>${a.para} sem origem`).toBeGreaterThan(0);
      for (const t of a.tecnicas) {
        const [par, tipo] = t.split(':');
        const [de, para] = par.split('→');
        expect(ARESTAS.some((x) => x.de === de && x.para === para && x.tipo === tipo), t).toBe(true);
        expect(moduloDoNoTecnico(de)).toBe(a.de);
        expect(moduloDoNoTecnico(para)).toBe(a.para);
      }
      expect(a.tipos.every((x) => x === 'dependencia' || x === 'fluxo')).toBe(true);
    }
    // toda dependência declarada aparece; observa e evidência nunca sobem para a camada executiva
    for (const d of declaradas) expect(arestas.some((a) => `${a.de}>${a.para}` === d), d).toBe(true);
    expect(arestas.length).toBe(declaradas.size + arestas.filter((a) => !a.declarada).length);
    // o fluxo principal colapsado é o da EIFF Central para o Inbox, sobre a dependência já declarada
    const fluxo = arestas.filter((a) => a.tipos.includes('fluxo'));
    expect(fluxo.map((a) => `${a.de}>${a.para}`)).toEqual(['CENTRAL_WHATSAPP>INBOX']);
    expect(fluxo[0].declarada).toBe(true);
    // a tela não declara arestas próprias
    expect(conteudo(MAPA)).not.toMatch(/const (arestas|ARESTAS_EXECUTIVAS)\s*[:=]\s*\[/);
  });

  it('5 · nó técnico não vira módulo por heurística: só por correspondência declarada ou por gates de um único módulo', () => {
    for (const n of NOS) {
      const m = moduloDoNoTecnico(n.id);
      if (MODULO_DO_NO[n.id]) { expect(m).toBe(MODULO_DO_NO[n.id]); continue; }
      if (n.gates.length === 0) { expect(m, n.id).toBeNull(); continue; }
      const donos = MODULOS_CONSTRUCAO.filter((mo) => { const g = new Set(gatesDoModulo(mo)); return n.gates.every((x) => g.has(x)); });
      expect(m, n.id).toBe(donos.length === 1 ? donos[0].id : null);
    }
    // casos do estado atual: camada com gates mistos e nós sem gate ficam sem dono
    expect(moduloDoNoTecnico('AUDITORIA')).toBeNull();
    expect(moduloDoNoTecnico('COMMERCIAL_QUEUE')).toBeNull();
    expect(moduloDoNoTecnico('DISPATCHER')).toBeNull();
    expect(moduloDoNoTecnico('WEBHOOK')).toBe('CENTRAL_WHATSAPP');
    // nenhum casamento por nome no domínio nem na tela
    for (const f of [DOMINIO, MAPA]) expect(conteudo(f), f).not.toMatch(/titulo\s*===|\.titulo\.(includes|startsWith|match)|toLowerCase\(\)\.includes/);
  });

  it('6 · dependência bloqueada é caminho de impacto, não mudança de estado', () => {
    const central = panorama.modulos.find((p) => p.modulo.id === 'CENTRAL_WHATSAPP')!;
    expect(central.estado).toBe('BLOQUEADO');
    const imp = impactoDe('CENTRAL_WHATSAPP');
    expect(imp.diretos).toEqual(MODULOS_CONSTRUCAO.filter((m) => m.dependeDe?.includes('CENTRAL_WHATSAPP')).map((m) => m.id));
    for (const id of [...imp.diretos, ...imp.indiretos]) {
      const p = panorama.modulos.find((x) => x.modulo.id === id)!;
      expect(p.estado).toBe(projetarModulo(p.modulo, []).estado);
      expect(p.estado).not.toBe('BLOQUEADO');
    }
    // o filtro "Bloqueados e impacto" só destaca; não muda nada
    const d = destaqueDoFiltro(panorama, 'BLOQUEIOS');
    expect([...d].sort()).toEqual(['CENTRAL_WHATSAPP', ...imp.diretos, ...imp.indiretos].sort());
    // impacto é fechamento transitivo das dependências declaradas, sem repetir e sem incluir o próprio módulo
    const fin = impactoDe('FINANCEIRO');
    expect(new Set([...fin.diretos, ...fin.indiretos]).size).toBe(fin.diretos.length + fin.indiretos.length);
    expect([...fin.diretos, ...fin.indiretos]).not.toContain('FINANCEIRO');
  });

  it('7 · o detalhe técnico continua inteiro: grafo técnico intacto e acessível na mesma ferramenta', () => {
    expect(layoutDoMapa().nos.length).toBe(NOS.length);
    expect(NOS.length).toBe(20);
    expect(ARESTAS.length).toBe(29);
    const src = conteudo(MAPA);
    expect(src).toMatch(/Arquitetura técnica/);
    expect(src).toMatch(/function MapaTecnico/);
    expect(src).toMatch(/ARESTAS\.map/);
    expect(src).toMatch(/gatePorId\(/);
    expect(src).toMatch(/Ver detalhe técnico/);
    // um drill-down só: o mapa reutiliza o painel da Visão geral
    expect(src).toMatch(/import \{ ListaEspera, PainelModulo \} from '\.\/MissionControlVisao'/);
    expect(src).not.toMatch(/function PainelModulo/);
  });

  it('8 · o mapa continua somente leitura: nenhuma rede, escrita, arraste ou ação que mude estado', () => {
    for (const f of [MAPA, DOMINIO]) {
      const src = conteudo(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(|useStatusRemoto\(|setInterval|actions\.|supabase|onDrag|draggable|method:\s*['"](POST|PATCH|PUT|DELETE)/i);
    }
    expect(conteudo(DOMINIO)).not.toMatch(/from 'react'|from 'node:/);
  });

  it('9 · continua existindo um único useStatusRemoto', () => {
    const total = TELAS.reduce((n, f) => n + (conteudo(f).match(/useStatusRemoto\(/g)?.length ?? 0), 0);
    expect(total).toBe(1);
    expect(conteudo('src/screens/MissionControl.tsx').match(/useStatusRemoto\(/g)?.length).toBe(1);
  });

  it('10 · task → módulo continua contratual: título, branch ou arquivo não dão módulo', () => {
    for (const t of [
      item({ id: 't1', title: 'Mapa vivo executivo (V2B)', links: { branch: 'feature/mc-construction-v2b-mapa-vivo' } }),
      item({ id: 't2', title: 'EIFF Inbox — tráfego real' }),
      item({ id: 't3', title: 'src/core/central/mapaExecutivo.ts' }),
    ]) expect(moduloDaTarefa(t)).toBeUndefined();
  });

  it('layout macro: dependência vai da esquerda para a direita, nenhuma célula repetida, cabe numa largura de tela', () => {
    const l = layoutExecutivo();
    const pos = new Map(l.nos.map((n) => [n.id, n]));
    for (const a of arestasExecutivas()) expect(pos.get(a.para)!.coluna, `${a.de}>${a.para}`).toBeGreaterThan(pos.get(a.de)!.coluna);
    expect(new Set(l.nos.map((n) => `${n.dominio}|${n.coluna}|${n.linha}`)).size).toBe(l.nos.length);
    for (const n of l.nos) expect(n.x + l.largNo).toBeLessThanOrEqual(l.largura);
    // proporção de tela: mais largo que alto, e não mais largo que ~1200 unidades (cabe em 1440 sem rolar de lado)
    expect(l.largura).toBeLessThanOrEqual(1200);
    expect(l.altura).toBeLessThan(l.largura);
    // profundidade: raiz = 0, e cada módulo fica depois das dependências
    const prof = profundidadeDosModulos();
    for (const m of MODULOS_CONSTRUCAO) for (const d of m.dependeDe ?? []) expect(prof.get(m.id)!).toBeGreaterThan(prof.get(d)!);
    expect(layoutExecutivo()).toEqual(l);
  });
});

// V2B · roteamento das arestas: a revisão de aceite achou 5 arestas desenhadas por trás de cartões alheios, sugerindo
// relações inexistentes (ex.: Plataforma → Inbox parecendo passar por Mission Control e pela EIFF Central). A prova é
// geométrica: nenhum segmento de nenhuma aresta toca o interior de cartão algum — só encosta na borda da origem e do
// destino.
describe('V2B · roteamento das arestas executivas', () => {
  const layout = layoutExecutivo();
  const rotas = rotasExecutivas(layout);

  it('19 rotas, uma por aresta executiva, da borda direita da origem à borda esquerda do destino', () => {
    const arestas = arestasExecutivas();
    expect(rotas.length).toBe(19);
    expect(rotas.map((r) => `${r.de}>${r.para}`)).toEqual(arestas.map((a) => `${a.de}>${a.para}`));
    for (const r of rotas) {
      const o = retanguloDoNo(layout, r.de); const d = retanguloDoNo(layout, r.para);
      const ini = r.pontos[0]; const fim = r.pontos[r.pontos.length - 1];
      expect(ini.x, `${r.de}>${r.para} saída`).toBeCloseTo(o.x + o.w, 6);
      expect(ini.y).toBeGreaterThan(o.y); expect(ini.y).toBeLessThan(o.y + o.h);
      expect(fim.x, `${r.de}>${r.para} chegada`).toBeCloseTo(d.x, 6);
      expect(fim.y).toBeGreaterThan(d.y); expect(fim.y).toBeLessThan(d.y + d.h);
    }
  });

  it('nenhuma aresta atravessa o interior de cartão algum (19/19)', () => {
    const cruzam = rotas.map((r) => ({ aresta: `${r.de}>${r.para}`, cartoes: cartoesAtravessados(r, layout) })).filter((x) => x.cartoes.length);
    expect(cruzam).toEqual([]);
  });

  it('a verificação geométrica pega o defeito: a curva direta antiga atravessava exatamente os 5 cartões da revisão', () => {
    const pos = new Map(layout.nos.map((n) => [n.id, n]));
    const curva = (de: string, para: string) => {
      const o = pos.get(de)!; const d = pos.get(para)!;
      const x1 = o.x + layout.largNo, y1 = o.y + layout.altNo / 2, x2 = d.x, y2 = d.y + layout.altNo / 2;
      const dx = Math.max(20, (x2 - x1) / 2);
      const c = (t: number) => { const u = 1 - t; return { x: u * u * u * x1 + 3 * u * u * t * (x1 + dx) + 3 * u * t * t * (x2 - dx) + t * t * t * x2, y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2 }; };
      return { de, para, pontos: Array.from({ length: 81 }, (_, i) => c(i / 80)) };
    };
    const antigas = arestasExecutivas().map((a) => ({ aresta: `${a.de}>${a.para}`, cartoes: cartoesAtravessados(curva(a.de, a.para), layout).sort() })).filter((x) => x.cartoes.length);
    expect(antigas).toEqual([
      { aresta: 'OBRAS>ESTOQUE', cartoes: ['EQUIPE_CAMPO', 'ORCAMENTOS'] },
      { aresta: 'OBRAS>EQUIPE_CAMPO', cartoes: ['FABRICA', 'ORCAMENTOS'] },
      { aresta: 'FINANCEIRO>COMPRAS', cartoes: ['ORCAMENTOS', 'TESOURARIA'] },
      { aresta: 'PLATAFORMA>CENTRAL_WHATSAPP', cartoes: ['MISSION_CONTROL'] },
      // a revisão, por amostragem no navegador, viu 2 cartões nesta; a geometria exata acha também a Dev Factory
      { aresta: 'PLATAFORMA>INBOX', cartoes: ['CENTRAL_WHATSAPP', 'FACTORY', 'MISSION_CONTROL'] },
    ]);
  });

  it('segmentos ortogonais, sem duas arestas sobrepostas no mesmo trecho e sem porta compartilhada', () => {
    type Seg = { a: Ponto; b: Ponto; id: string };
    const segs: Seg[] = rotas.flatMap((r) => r.pontos.slice(1).map((b, i) => ({ a: r.pontos[i], b, id: `${r.de}>${r.para}` })));
    for (const s of segs) expect(s.a.x === s.b.x || s.a.y === s.b.y, `${s.id} diagonal`).toBe(true);
    const sobrepoe = (s: Seg, t: Seg) => {
      if (s.id === t.id) return false;
      // paralelos que coexistem precisam de distância mínima; mais perto que isso as linhas se fundem na tela
      const perto = DISTANCIA_MINIMA_TRILHAS - 0.01;
      if (s.a.x === s.b.x && t.a.x === t.b.x && Math.abs(s.a.x - t.a.x) < perto) return Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y)) > 0.5;
      if (s.a.y === s.b.y && t.a.y === t.b.y && Math.abs(s.a.y - t.a.y) < perto) return Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x)) > 0.5;
      return false;
    };
    const pares: string[] = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (sobrepoe(segs[i], segs[j])) pares.push(`${segs[i].id} × ${segs[j].id}`);
    expect(pares).toEqual([]);
    const portas = rotas.flatMap((r) => [`${r.de}:saida:${r.pontos[0].y}`, `${r.para}:entrada:${r.pontos[r.pontos.length - 1].y}`]);
    expect(new Set(portas).size).toBe(portas.length);
  });

  it('a tela desenha as rotas do domínio (sem curva própria) e o grafo técnico segue 20 nós / 29 arestas', () => {
    const src = conteudo(MAPA);
    expect(src).toMatch(/rotasExecutivas\(/);
    expect(NOS.length).toBe(20);
    expect(ARESTAS.length).toBe(29);
  });
});
