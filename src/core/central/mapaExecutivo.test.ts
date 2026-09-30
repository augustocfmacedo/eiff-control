// MC-CONSTRUCTION-V2B — Mapa vivo executivo. O mapa mostra MÓDULOS do catálogo, com o estado da MESMA projeção da
// Visão geral, e só relações declaradas ou colapsadas com prova. O grafo técnico continua intacto como segunda camada.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOMINIOS_CONSTRUCAO, MODULOS_CONSTRUCAO, MODULO_DO_NO, gatesDoModulo, moduloDaTarefa, moduloPorId, panoramaConstrucao, projetarModulo,
  resumoExecutivo,
} from './construcao';
import {
  arestasExecutivas, destaqueDoFiltro, impactoDe, layoutExecutivo, moduloDoNoTecnico, nosExecutivos, profundidadeDosModulos,
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
