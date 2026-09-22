// Commercial UX 1.0 — UX-1.1: a faixa de sugestoes nao concorre com o Panorama.
//
// Prova sobre dados REAIS (fixtures congeladas do CM2-A na carteira do seed): em /radar/hoje a sugestao que so leva de
// volta a propria tela some da APRESENTACAO, enquanto `sugestoesPara` (CM1-D1) continua gerando exatamente o mesmo — e
// nas demais rotas nada muda.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { CASOS, HOJE } from '../core/radar/cadenciaParidadeCM.fixtures';
import { sugestoesPara } from '../core/sugestoes';
import type { Dataset, Usuario } from '../core/types';
import { ROTA_PANORAMA_COMERCIAL, sugestaoRedundanteNoPanorama } from './Sugestoes';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio: carteira real (as fixtures do CM2-A dentro do dataset do seed)
// ---------------------------------------------------------------------------------------------------------------------
const radar = (() => {
  const juntos: Record<string, unknown> = {};
  for (const caso of CASOS) {
    const ids = new Set<string>();
    for (const valor of Object.values(caso.ds as unknown as Record<string, unknown>)) {
      if (Array.isArray(valor)) for (const linha of valor as { id?: string }[]) if (typeof linha?.id === 'string') ids.add(linha.id);
    }
    const prefixar = (v: unknown): unknown => {
      if (typeof v === 'string') return ids.has(v) ? `${caso.id}-${v}` : v;
      if (Array.isArray(v)) return v.map(prefixar);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, prefixar(x)]));
      return v;
    };
    for (const [chave, valor] of Object.entries(caso.ds as unknown as Record<string, unknown>)) {
      if (!Array.isArray(valor)) { if (!(chave in juntos)) juntos[chave] = valor; continue; }
      const atual = (juntos[chave] as unknown[]) ?? [];
      for (const linha of valor) atual.push(prefixar(linha));
      juntos[chave] = atual;
    }
  }
  return juntos;
})();
const DS = { ...(seed as unknown as Dataset), params: { ...(seed as unknown as Dataset).params, dataBase: HOJE }, radar } as unknown as Dataset;
const USUARIO = (seed as unknown as Dataset).usuarios[0] as Usuario;
/** O que a tela de fato mostra: a mesma composicao do componente (gerar -> filtrar apresentacao -> 4 primeiras). */
const naTela = (rota: string) => sugestoesPara(rota, DS, USUARIO, HOJE).filter((s) => !sugestaoRedundanteNoPanorama(rota, s.acao?.to)).slice(0, 4);

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const FONTE_SUGESTOES_UI = leia('src/ui/Sugestoes.tsx');
const FONTE_SUGESTOES_CORE = leia('src/core/sugestoes.ts');
const FONTE_APP = leia('src/App.tsx');

describe('UX-1.1 · faixa de sugestoes no Panorama', () => {
  it('1. em /radar/hoje nenhuma sugestao aponta de volta para /radar/hoje', () => {
    const mostradas = naTela('/radar/hoje');
    expect(mostradas.some((s) => s.acao?.to === '/radar/hoje')).toBe(false);
  });
  it('a geracao do CM1-D1 continua produzindo essas sugestoes (a supressao e so de apresentacao)', () => {
    const geradas = sugestoesPara('/radar/hoje', DS, USUARIO, HOJE);
    const paraAFila = geradas.filter((s) => s.acao?.to === '/radar/hoje');
    expect(paraAFila.length, 'a carteira de teste gera sugestoes que levam a fila').toBeGreaterThan(0);
    expect(paraAFila.map((s) => s.id)).toContain('radar-agir-agora');
    // e o que some da tela e exatamente esse conjunto, nada mais
    const mostradas = naTela('/radar/hoje');
    expect(mostradas.map((s) => s.id)).toEqual(geradas.filter((s) => s.acao?.to !== '/radar/hoje').slice(0, 4).map((s) => s.id));
  });
  it('4. outras rotas continuam com as mesmas sugestoes, inclusive as que levam a /radar/hoje', () => {
    for (const rota of ['/radar', '/radar/empresas', '/', '/lancamentos', '/conciliacao']) {
      expect(naTela(rota).map((s) => s.id), rota).toEqual(sugestoesPara(rota, DS, USUARIO, HOJE).slice(0, 4).map((s) => s.id));
    }
    const noCommandCenter = sugestoesPara('/radar', DS, USUARIO, HOJE).filter((s) => s.acao?.to === '/radar/hoje');
    expect(noCommandCenter.length, 'em /radar a sugestao que leva a fila permanece').toBeGreaterThan(0);
  });
  it('sugestao para outro destino continua visivel no proprio Panorama', () => {
    expect(sugestaoRedundanteNoPanorama('/radar/hoje', '/radar?aba=duplicatas')).toBe(false);
    expect(sugestaoRedundanteNoPanorama('/radar/hoje', '/radar/empresas/x')).toBe(false);
    expect(sugestaoRedundanteNoPanorama('/radar/hoje', undefined)).toBe(false);
    expect(sugestaoRedundanteNoPanorama('/radar/hoje', '/radar/hoje')).toBe(true);
    expect(sugestaoRedundanteNoPanorama('/radar/hoje', '/radar/hoje?x=1')).toBe(true);
  });
  it('a regra e estreita: so vale na rota do Panorama', () => {
    for (const rota of ['/radar', '/radar/empresas', '/', '/diretor']) expect(sugestaoRedundanteNoPanorama(rota, '/radar/hoje')).toBe(false);
    expect(ROTA_PANORAMA_COMERCIAL).toBe('/radar/hoje');
    // e NAO e a regra geral "esconder o que aponta para a rota atual": em /radar o destino util muda so de aba
    expect(sugestaoRedundanteNoPanorama('/radar', '/radar?aba=duplicatas')).toBe(false);
    expect(sugestaoRedundanteNoPanorama('/radar', '/radar')).toBe(false);
    expect(sugestaoRedundanteNoPanorama('/lancamentos', '/lancamentos')).toBe(false);
  });
  it('a faixa realmente aplica a regra (a supressao nao vive so no helper)', () => {
    expect(FONTE_SUGESTOES_UI).toContain('!sugestaoRedundanteNoPanorama(rota, s.acao?.to)');
    expect(FONTE_SUGESTOES_UI).toMatch(/const visiveis = lista\.filter\(\(s\) => !dispensadas\.includes\(s\.id\) && !sugestaoRedundanteNoPanorama\(rota, s\.acao\?\.to\)\)\.slice\(0, 4\)/);
  });
  it('5. nada foi alterado na geracao: o componente nao reescreve regra de sugestao', () => {
    for (const proibido of ['construirCommercialQueue', 'porCategoria', 'cadencia', 'DEVIDA', 'AGIR_AGORA', 'radar-agir-agora']) {
      expect(FONTE_SUGESTOES_UI, `a faixa nao pode conter ${proibido}`).not.toContain(proibido);
    }
    // a fonte das sugestoes do Radar continua a mesma, com os mesmos ids e destinos
    for (const trecho of ["id: 'radar-agir-agora'", "id: 'radar-revisar'", "id: 'radar-enriquecer'", "id: 'radar-follow-up'", "to: '/radar/hoje'", "to: '/radar?aba=duplicatas'"]) {
      expect(FONTE_SUGESTOES_CORE, `sugestoes.ts perdeu ${trecho}`).toContain(trecho);
    }
  });
  it('6. App.tsx nao foi tocado: sidebar, contador e navegacao intactos', () => {
    expect(FONTE_APP).toContain("'/radar': radarAlertas, '/radar/hoje': radarHoje");
    expect(FONTE_APP).toContain('<Sugestoes rota={rota.path} />');
    expect(FONTE_APP).toContain('const radarHoje = (ds.radar?.tarefas ?? []).filter');
  });
  it('13. nenhuma metrica nova nasceu na faixa', () => {
    expect(FONTE_SUGESTOES_UI).not.toMatch(/score|peso|ranking|indice|pressao/i);
    expect(FONTE_SUGESTOES_UI.match(/export const/g) ?? []).toHaveLength(2);
  });
});
