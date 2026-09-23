// LE-3B — o simulador de politica explica, nao pontua. Nenhum corte real da EIFF vive aqui.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CnoObservacaoCanonica } from './cnoDadosAbertos';
import {
  AREAS_SENSIBILIDADE, JANELAS_SENSIBILIDADE, MOTIVOS_ACEITE_CNO, MOTIVOS_RECUSA_CNO,
  areaM2, avaliarPolitica, cenariosLe3b, dataMenosDias, diasEntre,
} from './cnoDiscoveryPolicy';

const CNPJ = '11222333000181';
const obra = (p: Partial<CnoObservacaoCanonica> = {}): CnoObservacaoCanonica => ({
  cno: '010010092278', dataInicio: '2026-06-01', dataRegistro: '2026-06-02', dataSituacao: '2026-06-03',
  cnpjResponsavel: CNPJ, nomeResponsavel: 'Construtora Fictícia Alfa Ltda', qualificacaoResponsavel: '0053',
  nomeObra: 'Galpão Alfa', municipio: 'ANÁPOLIS', uf: 'GO', areaTotal: 1500, unidadeMedida: 'm2', situacao: '02',
  areas: [{ categoria: 'Obra Nova', destinacao: 'Galpão industrial', tipoConstrutivo: 'Alvenaria', tipoArea: 'Principal', metragem: 1500 }],
  cnaes: [], vinculos: [], ...p,
});

describe('LE-3B · política de descoberta — cada filtro explica', () => {
  it('sem filtro tudo passa, sem motivo nenhum', () => {
    expect(avaliarPolitica(obra(), {})).toEqual({ elegivel: true, motivosAceite: [], motivosRecusa: [] });
  });

  it('PJ e CNPJ válido', () => {
    expect(avaliarPolitica(obra(), { exigirPessoaJuridica: true, exigirCnpjValido: true }).motivosAceite).toEqual(['PJ', 'CNPJ_VALIDO']);
    const pf = avaliarPolitica(obra({ nomeResponsavel: undefined, cnpjResponsavel: undefined }), { exigirPessoaJuridica: true, exigirCnpjValido: true });
    expect(pf.elegivel).toBe(false);
    expect(pf.motivosRecusa).toEqual(['SEM_PJ', 'SEM_CNPJ_VALIDO']);
  });

  it('situação, UF, município e qualificação — sem diferenciar caixa', () => {
    expect(avaliarPolitica(obra(), { situacoes: ['02'] }).motivosAceite).toEqual(['SITUACAO_OK']);
    expect(avaliarPolitica(obra({ situacao: '15' }), { situacoes: ['02'] }).motivosRecusa).toEqual(['SITUACAO_FORA']);
    expect(avaliarPolitica(obra(), { ufs: ['go'] }).motivosAceite).toEqual(['UF_OK']);
    expect(avaliarPolitica(obra({ uf: 'SP' }), { ufs: ['GO', 'MT'] }).motivosRecusa).toEqual(['UF_FORA']);
    expect(avaliarPolitica(obra(), { municipios: ['Anápolis'] }).motivosAceite).toEqual(['MUNICIPIO_OK']);
    expect(avaliarPolitica(obra({ municipio: 'GOIÂNIA' }), { municipios: ['Anápolis'] }).motivosRecusa).toEqual(['MUNICIPIO_FORA']);
    expect(avaliarPolitica(obra(), { qualificacoes: ['0053'] }).motivosAceite).toEqual(['QUALIFICACAO_OK']);
    expect(avaliarPolitica(obra({ qualificacaoResponsavel: '0070' }), { qualificacoes: ['0053'] }).motivosRecusa).toEqual(['QUALIFICACAO_FORA']);
  });

  it('categoria e destinação olham TODAS as áreas da obra', () => {
    const duas = obra({ areas: [{ categoria: 'Existente', destinacao: 'Residencial unifamiliar' }, { categoria: 'Acréscimo', destinacao: 'Galpão industrial' }] });
    expect(avaliarPolitica(duas, { categorias: ['Acréscimo'] }).elegivel).toBe(true);
    expect(avaliarPolitica(duas, { destinacoes: ['Galpão industrial'] }).elegivel).toBe(true);
    expect(avaliarPolitica(duas, { categorias: ['Obra Nova'] }).motivosRecusa).toEqual(['CATEGORIA_FORA']);
    expect(avaliarPolitica(duas, { destinacoes: ['Casa popular'] }).motivosRecusa).toEqual(['DESTINACAO_FORA']);
    expect(avaliarPolitica(obra({ areas: [] }), { destinacoes: ['Galpão industrial'] }).motivosRecusa).toEqual(['DESTINACAO_FORA']);
  });

  it('sinal: só Obra Nova / Acréscimo / Reforma contam', () => {
    expect(avaliarPolitica(obra(), { exigirSinal: true }).motivosAceite).toEqual(['SINAL']);
    expect(avaliarPolitica(obra({ areas: [{ categoria: 'Demolição' }] }), { exigirSinal: true }).motivosRecusa).toEqual(['SEM_SINAL']);
    expect(avaliarPolitica(obra({ areas: [{ categoria: 'Existente' }] }), { exigirSinal: true }).motivosRecusa).toEqual(['SEM_SINAL']);
    expect(avaliarPolitica(obra({ areas: [] }), { exigirSinal: true }).motivosRecusa).toEqual(['SEM_SINAL']);
  });

  it('janela temporal: recente, antigo e sem data', () => {
    expect(avaliarPolitica(obra(), { eventoDepoisDe: '2026-01-01' }).motivosAceite).toEqual(['EVENTO_RECENTE']);
    expect(avaliarPolitica(obra(), { eventoDepoisDe: '2026-06-01' }).elegivel).toBe(true); // inclusivo
    expect(avaliarPolitica(obra(), { eventoDepoisDe: '2026-07-01' }).motivosRecusa).toEqual(['EVENTO_ANTIGO']);
    expect(avaliarPolitica(obra({ dataInicio: undefined, dataRegistro: undefined, dataSituacao: undefined }), { eventoDepoisDe: '2026-01-01' }).motivosRecusa).toEqual(['SEM_DATA_EVENTO']);
    // a precedencia do §34.7 vale aqui tambem: sem dataInicio, usa dataRegistro
    expect(avaliarPolitica(obra({ dataInicio: undefined, dataRegistro: '2020-01-01' }), { eventoDepoisDe: '2026-01-01' }).motivosRecusa).toEqual(['EVENTO_ANTIGO']);
  });

  it('área: abaixo, acima, ok, e unidade que não é m² conta como sem área', () => {
    expect(avaliarPolitica(obra(), { areaMinimaM2: 1000 }).motivosAceite).toEqual(['AREA_OK']);
    expect(avaliarPolitica(obra(), { areaMinimaM2: 2000 }).motivosRecusa).toEqual(['AREA_ABAIXO']);
    expect(avaliarPolitica(obra(), { areaMaximaM2: 1000 }).motivosRecusa).toEqual(['AREA_ACIMA']);
    expect(avaliarPolitica(obra({ areaTotal: undefined }), { areaMinimaM2: 1 }).motivosRecusa).toEqual(['SEM_AREA']);
    expect(avaliarPolitica(obra({ unidadeMedida: 'km' }), { areaMinimaM2: 1 }).motivosRecusa).toEqual(['SEM_AREA']);
    expect(areaM2({ areaTotal: 5, unidadeMedida: 'kw' })).toBeUndefined();
    expect(areaM2({ areaTotal: 5, unidadeMedida: 'm2' })).toBe(5);
    expect(areaM2({ areaTotal: 5, unidadeMedida: 'M2' })).toBe(5);
  });

  it('combinação de filtros acumula motivos: uma obra pode ser recusada por vários', () => {
    const r = avaliarPolitica(
      obra({ nomeResponsavel: undefined, cnpjResponsavel: undefined, uf: 'SP', areaTotal: 100, areas: [{ categoria: 'Demolição' }] }),
      { exigirPessoaJuridica: true, exigirCnpjValido: true, ufs: ['GO'], exigirSinal: true, areaMinimaM2: 500, eventoDepoisDe: '2026-01-01' },
    );
    expect(r.elegivel).toBe(false);
    expect(r.motivosRecusa).toEqual(['SEM_PJ', 'SEM_CNPJ_VALIDO', 'UF_FORA', 'SEM_SINAL', 'AREA_ABAIXO']);
    expect(r.motivosAceite).toEqual(['EVENTO_RECENTE']);
    // e a mesma politica aceita a obra boa com todos os aceites nomeados
    const ok = avaliarPolitica(obra(), { exigirPessoaJuridica: true, exigirCnpjValido: true, ufs: ['GO'], exigirSinal: true, areaMinimaM2: 500, eventoDepoisDe: '2026-01-01' });
    expect(ok.elegivel).toBe(true);
    expect(ok.motivosAceite).toEqual(['PJ', 'CNPJ_VALIDO', 'UF_OK', 'SINAL', 'EVENTO_RECENTE', 'AREA_OK']);
  });

  it('catálogo fechado: todo motivo emitido pertence ao catálogo', () => {
    const r = avaliarPolitica(obra({ nomeResponsavel: undefined, cnpjResponsavel: undefined, areas: [] }), { exigirPessoaJuridica: true, exigirCnpjValido: true, exigirSinal: true, categorias: ['x'], destinacoes: ['y'], situacoes: ['z'], ufs: ['w'], municipios: ['v'], qualificacoes: ['u'], areaMinimaM2: 1, eventoDepoisDe: '2099-01-01' });
    for (const m of r.motivosRecusa) expect(MOTIVOS_RECUSA_CNO).toContain(m);
    for (const m of r.motivosAceite) expect(MOTIVOS_ACEITE_CNO).toContain(m);
  });
});

describe('LE-3B · datas, cenários e eixos', () => {
  it('dataMenosDias e diasEntre em UTC, sem depender do fuso', () => {
    expect(dataMenosDias('2026-09-12', 365)).toBe('2025-09-12');
    expect(dataMenosDias('2026-03-01', 1)).toBe('2026-02-28');
    expect(diasEntre('2026-09-01', '2026-09-12')).toBe(11);
    expect(diasEntre('2026-09-20', '2026-09-12')).toBe(-8);
  });

  it('os cenários A–F existem, partem todos de PJ + CNPJ + sinal e nenhum é marcado como escolhido', () => {
    const cs = cenariosLe3b('2026-09-12');
    expect(cs.map((c) => c.id)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F']));
    for (const c of cs) {
      expect(c.politica.exigirPessoaJuridica).toBe(true);
      expect(c.politica.exigirCnpjValido).toBe(true);
      expect(c.politica.exigirSinal).toBe(true);
      expect(c.nome).not.toMatch(/correto|final|escolhid|adotad/i);
    }
    expect(cs.find((c) => c.id === 'A')!.politica.eventoDepoisDe).toBe('2025-09-12');
    expect(cs.find((c) => c.id === 'D')!.politica.areaMinimaM2).toBe(2000);
    expect(cs.find((c) => c.id === 'E')!.politica.destinacoes).toEqual(['Galpão industrial']);
    expect([...JANELAS_SENSIBILIDADE]).toEqual([30, 90, 180, 365, 730]);
    expect([...AREAS_SENSIBILIDADE]).toEqual([0, 500, 1000, 2000, 5000]);
  });
});

describe('LE-3B · fronteiras da política', () => {
  const fonte = readFileSync('src/core/radar/cnoDiscoveryPolicy.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('sem score, sem prioridade, sem classe, sem Commercial Queue, sem ordenação comercial', () => {
    for (const proibido of ['score', 'Score', 'priority', 'prioridade', 'classe', 'CommercialQueue', 'Cadencia', 'cadencia', 'oportunidade', 'tarefa']) {
      expect(fonte).not.toContain(proibido);
    }
  });
  it('nenhum corte geográfico ou de porte hardcoded como regra', () => {
    // 'GO' so pode aparecer em teste/relatorio; no core da politica, nunca como constante
    expect(fonte).not.toMatch(/ufs:\s*\[\s*'GO'/);
    expect(fonte).not.toContain("'GO'");
    expect(fonte).not.toContain('Goiânia');
  });
  it('só importa do core do Radar', () => {
    const imports = [...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('./'))).toBe(true);
    for (const proibido of ['fetch(', 'node:fs', 'supabase', 'data/store', 'react']) expect(fonte).not.toContain(proibido);
  });
});
