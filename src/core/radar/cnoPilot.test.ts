// LE-3C — politica piloto congelada e lote deterministico. Piloto != regra definitiva.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envelopeCno, pedidoIntakeCno, type CnoObservacao, type CnoObservacaoCanonica } from './cnoDadosAbertos';
import { payloadFingerprint, validarIntake } from './leadEngineIntake';
import { avaliarPolitica } from './cnoDiscoveryPolicy';
import {
  CNO_PILOT_POLICY_V1, CNO_PILOT_POLICY_VERSION, avaliarPiloto, compararEntradas, manifestosIguais, metricasLote,
  montarLote, montarManifest, ordenarLote, percentilExato, politicaPiloto, projetarEntrada, simularCap,
} from './cnoPilot';

const REF = '2026-09-23';
const CNPJ_A = '11222333000181';
const CNPJ_B = '11444777000161';
const CNPJ_C = '34028316000103';

const obs = (p: Partial<CnoObservacaoCanonica> & { cno: string }): CnoObservacao => {
  const canonical: CnoObservacaoCanonica = {
    dataInicio: '2026-09-01', cnpjResponsavel: CNPJ_A, nomeResponsavel: 'Construtora Fictícia Alfa Ltda',
    qualificacaoResponsavel: '0053', qualificacaoResponsavelNome: 'Pessoa Jurídica Construtora',
    nomeObra: 'Galpão', municipio: 'ANÁPOLIS', uf: 'GO', areaTotal: 1500, unidadeMedida: 'm2', situacao: '02',
    areas: [{ categoria: 'Obra Nova', destinacao: 'Galpão industrial' }], cnaes: [], vinculos: [], ...p,
  };
  return { cno: p.cno, evidence: { obra: { CNO: p.cno, Nome: 'Galpão', Endereço: 'RUA X 1' }, areas: [], cnaes: [], vinculos: [] }, canonical };
};
const POL = politicaPiloto(REF);
const recusa = (o: CnoObservacao) => avaliarPiloto(o, POL).resultado.motivosRecusa;
const passa = (o: CnoObservacao) => avaliarPiloto(o, POL).resultado.elegivel;

describe('LE-3C · política piloto V1 — cada critério', () => {
  it('a política deriva da data de referência explícita; sem relógio', () => {
    expect(POL).toEqual({ ufs: ['GO'], situacoes: ['02'], exigirPessoaJuridica: true, exigirCnpjValido: true, exigirSinal: true, areaMinimaM2: 1000, categorias: ['Obra Nova', 'Acréscimo', 'Reforma'], eventoDepoisDe: '2026-06-25' });
    expect(POL.destinacoes).toBeUndefined();
    expect(politicaPiloto('2026-01-01').eventoDepoisDe).toBe('2025-10-03');
    expect(() => politicaPiloto('23/09/2026')).toThrow();
    expect(CNO_PILOT_POLICY_V1.janelaDias).toBe(90);
    expect(CNO_PILOT_POLICY_VERSION).toBe('CNO_PILOT_POLICY_V1');
  });
  it('1 · GO', () => { expect(passa(obs({ cno: '1' }))).toBe(true); expect(recusa(obs({ cno: '1', uf: 'SP' }))).toEqual(['UF_FORA']); });
  it('2 · ATIVA', () => { expect(recusa(obs({ cno: '1', situacao: '15' }))).toEqual(['SITUACAO_FORA']); expect(recusa(obs({ cno: '1', situacao: '14' }))).toEqual(['SITUACAO_FORA']); });
  it('3-4 · PJ e CNPJ', () => { expect(recusa(obs({ cno: '1', nomeResponsavel: undefined, cnpjResponsavel: undefined }))).toEqual(['SEM_PJ', 'SEM_CNPJ_VALIDO']); });
  it('5 · sinal: Demolição/Existente não passam; NEW e EXPANSION passam sem peso diferente', () => {
    expect(recusa(obs({ cno: '1', areas: [{ categoria: 'Demolição' }] }))).toEqual(['CATEGORIA_FORA', 'SEM_SINAL']);
    expect(recusa(obs({ cno: '1', areas: [{ categoria: 'Existente' }] }))).toEqual(['CATEGORIA_FORA', 'SEM_SINAL']);
    expect(avaliarPiloto(obs({ cno: '1', areas: [{ categoria: 'Reforma' }] }), POL).entrada?.tipoSinal).toBe('CNO_EXPANSION');
    expect(avaliarPiloto(obs({ cno: '1' }), POL).entrada?.tipoSinal).toBe('CNO_NEW');
  });
  it('6 · 90 dias', () => { expect(recusa(obs({ cno: '1', dataInicio: '2026-01-01' }))).toEqual(['EVENTO_ANTIGO']); });
  it('7 · área ≥ 1.000', () => { expect(recusa(obs({ cno: '1', areaTotal: 500 }))).toEqual(['AREA_ABAIXO']); expect(recusa(obs({ cno: '1', unidadeMedida: 'km' }))).toEqual(['SEM_AREA']); });
  it('8 · categorias permitidas: Obra Nova, Acréscimo, Reforma', () => {
    for (const c of ['Obra Nova', 'Acréscimo', 'Reforma']) expect(passa(obs({ cno: '1', areas: [{ categoria: c }] }))).toBe(true);
  });
  it('9 · destinação NÃO filtra, mas acompanha o candidato', () => {
    for (const d of ['Galpão industrial', 'Comercial salas e lojas', 'Residencial unifamiliar', 'Casa popular']) {
      const r = avaliarPiloto(obs({ cno: '1', areas: [{ categoria: 'Obra Nova', destinacao: d }] }), POL);
      expect(r.resultado.elegivel).toBe(true);
      expect(r.entrada?.destinacoes).toEqual([d]);
    }
  });
  it('10 · data de referência explícita muda o corte; o core não consulta o relógio', () => {
    const o = obs({ cno: '1', dataInicio: '2026-07-01' });
    expect(avaliarPolitica(o.canonical, politicaPiloto('2026-09-23')).elegivel).toBe(true);
    expect(avaliarPolitica(o.canonical, politicaPiloto('2026-12-01')).elegivel).toBe(false);
    const fonte = readFileSync('src/core/radar/cnoPilot.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).not.toContain('new Date(');
    expect(fonte).not.toContain('Date.now(');
  });
  it('11 · 91 dias rejeita', () => { expect(recusa(obs({ cno: '1', dataInicio: '2026-06-24' }))).toEqual(['EVENTO_ANTIGO']); });
  it('12 · exatamente 90 dias aceita', () => { expect(passa(obs({ cno: '1', dataInicio: '2026-06-25' }))).toBe(true); });
  it('13 · 999,99 m² rejeita', () => { expect(recusa(obs({ cno: '1', areaTotal: 999.99 }))).toEqual(['AREA_ABAIXO']); });
  it('14 · 1.000 m² aceita', () => { expect(passa(obs({ cno: '1', areaTotal: 1000 }))).toBe(true); });
});

describe('LE-3C · lote determinístico', () => {
  const e = (cno: string, eventoEm: string, cnpj = CNPJ_A) => projetarEntrada(obs({ cno, dataInicio: eventoEm, cnpjResponsavel: cnpj }));

  it('15 · ordenação por evento DESC', () => {
    expect(ordenarLote([e('1', '2026-07-01'), e('2', '2026-09-01'), e('3', '2026-08-01')]).map((x) => x.cno)).toEqual(['2', '3', '1']);
  });
  it('16 · desempate por CNO ASC', () => {
    expect(ordenarLote([e('9', '2026-09-01'), e('1', '2026-09-01'), e('5', '2026-09-01')]).map((x) => x.cno)).toEqual(['1', '5', '9']);
    expect(compararEntradas(e('1', '2026-09-01'), e('1', '2026-09-01'))).toBe(0);
  });
  it('17 · limite 50', () => {
    const muitos = Array.from({ length: 80 }, (_, i) => e(String(i).padStart(12, '0'), '2026-09-01'));
    expect(montarLote(muitos, 50)).toHaveLength(50);
    expect(montarLote(muitos, 0)).toHaveLength(0);
    expect(montarLote(muitos.slice(0, 10), 50)).toHaveLength(10);
  });
  it('18 · determinístico: mesma entrada em ordem diferente → mesmo lote, mesma ordem, mesmos fingerprints', () => {
    const base = [e('3', '2026-08-01'), e('1', '2026-09-01'), e('2', '2026-09-01')];
    const snap = { etag: '"x"', contentLength: 1 };
    const a = montarManifest({ dataReferencia: REF, snapshot: snap, totalAnalisado: 3, elegiveis: base, limite: 50 });
    const b = montarManifest({ dataReferencia: REF, snapshot: snap, totalAnalisado: 3, elegiveis: [...base].reverse(), limite: 50 });
    expect(manifestosIguais(a, b)).toBe(true);
    expect(a.lote.map((x) => x.cno)).toEqual(['1', '2', '3']);
    expect(a.fingerprints).toEqual(b.fingerprints);
    expect(a.totalElegivel).toBe(3);
    expect(a.totalRecusado).toBe(0);
    expect(a.batchSize).toBe(3);
    expect(a.versaoPolitica).toBe('CNO_PILOT_POLICY_V1');
    // e uma diferenca real e detectada
    const c = montarManifest({ dataReferencia: REF, snapshot: snap, totalAnalisado: 3, elegiveis: base.slice(0, 2), limite: 50 });
    expect(manifestosIguais(a, c)).toBe(false);
  });
  it('19 · o fingerprint do manifest é o mesmo que o intake do LE-1 calcularia', () => {
    const o = obs({ cno: '1' });
    const entrada = projetarEntrada(o);
    const v = validarIntake(pedidoIntakeCno(o, 'FONTE-CNO', '2026-09-23T00:00:00.000Z'));
    if (!v.ok) throw new Error('intake inválido');
    expect(entrada.payloadFingerprint).toBe(v.payloadFingerprint);
    expect(entrada.payloadFingerprint).toBe(payloadFingerprint(envelopeCno(o)));
  });
  it('20 · o descritor do snapshot fica no manifest, fora do envelope e fora do fingerprint', () => {
    const o = obs({ cno: '1' });
    const a = montarManifest({ dataReferencia: REF, snapshot: { etag: '"a"', lastModified: 'x', contentLength: 1 }, totalAnalisado: 1, elegiveis: [projetarEntrada(o)], limite: 50 });
    const b = montarManifest({ dataReferencia: REF, snapshot: { etag: '"b"', lastModified: 'y', contentLength: 2 }, totalAnalisado: 1, elegiveis: [projetarEntrada(o)], limite: 50 });
    expect(a.fingerprints).toEqual(b.fingerprints);
    expect(a.snapshot.etag).not.toBe(b.snapshot.etag);
    const env = JSON.stringify(envelopeCno(o));
    for (const proibido of ['etag', 'lastModified', 'contentLength', 'snapshot']) expect(env).not.toContain(proibido);
  });
  it('a projeção do manifest não carrega evidence, endereço nem dado de PF', () => {
    const entrada = projetarEntrada(obs({ cno: '1' }));
    const texto = JSON.stringify(entrada);
    expect(texto).not.toContain('RUA X');
    expect(texto).not.toContain('evidence');
    expect(Object.keys(entrada).sort()).toEqual(['areaTotal', 'categorias', 'cno', 'cnpjResponsavel', 'destinacoes', 'eventoEm', 'municipio', 'nomeResponsavel', 'origemEvento', 'payloadFingerprint', 'qualificacaoResponsavel', 'qualificacaoResponsavelNome', 'situacao', 'tipoSinal', 'uf']);
    // obra que a politica recusaria (sem PJ) nao e projetavel: a projecao falha fechada
    expect(() => projetarEntrada(obs({ cno: '2', nomeResponsavel: undefined, cnpjResponsavel: undefined }))).toThrow();
  });
});

describe('LE-3C · cap por empresa — medido, não aplicado', () => {
  const e = (cno: string, eventoEm: string, cnpj: string) => projetarEntrada(obs({ cno, dataInicio: eventoEm, cnpjResponsavel: cnpj }));
  // A tem 7 obras (as mais recentes), B tem 2, C tem 1
  const elegiveis = [
    ...Array.from({ length: 7 }, (_, i) => e(`A${i}`, `2026-09-0${9 - i}`, CNPJ_A)),
    e('B0', '2026-08-01', CNPJ_B), e('B1', '2026-07-30', CNPJ_B),
    e('C0', '2026-07-01', CNPJ_C),
  ];

  it('sem cap: as 7 de A ocupam as primeiras vagas', () => {
    const s = simularCap(elegiveis, null, 50);
    expect(s).toMatchObject({ cap: null, lote: 10, empresasUnicasNoLote: 3, cnosExcluidosPeloCap: 0, maiorOcupacaoNoLote: 7 });
    expect(s.cnos.slice(0, 7).every((c) => c.startsWith('A'))).toBe(true);
  });
  it('21 · cap 5', () => {
    expect(simularCap(elegiveis, 5, 50)).toMatchObject({ cap: 5, lote: 8, empresasUnicasNoLote: 3, cnosExcluidosPeloCap: 2, maiorOcupacaoNoLote: 5 });
  });
  it('22 · cap 3', () => {
    expect(simularCap(elegiveis, 3, 50)).toMatchObject({ cap: 3, lote: 6, empresasUnicasNoLote: 3, cnosExcluidosPeloCap: 4, maiorOcupacaoNoLote: 3 });
  });
  it('23 · cap 1: uma vaga por empresa, e a ordem de controle escolhe a obra mais recente de cada uma', () => {
    const s = simularCap(elegiveis, 1, 50);
    expect(s).toMatchObject({ cap: 1, lote: 3, empresasUnicasNoLote: 3, cnosExcluidosPeloCap: 7, maiorOcupacaoNoLote: 1 });
    expect(s.cnos).toEqual(['A0', 'B0', 'C0']);
  });
  it('o limite do lote continua valendo depois do cap', () => {
    expect(simularCap(elegiveis, 5, 4).lote).toBe(4);
  });
  it('24 · o cap não é aplicado à política base: a política V1 não tem cap e o manifest sem cap traz todas', () => {
    expect(JSON.stringify(politicaPiloto(REF))).not.toMatch(/cap/i);
    expect(montarLote(elegiveis, 50)).toHaveLength(10);
    expect(metricasLote(montarLote(elegiveis, 50)).maiorOcupacao).toBe(7);
  });
  it('métricas do lote: sinal, área p50/p90, municípios, destinações, CNPJs, vagas', () => {
    const m = metricasLote(montarLote(elegiveis, 50));
    expect(m.tamanho).toBe(10);
    expect(m.porSinal).toEqual([['CNO_NEW', 10]]);
    expect(m.areaP50).toBe(1500);
    expect(m.cnpjsUnicos).toBe(3);
    expect(m.cnpjsComMaisDeUmaVaga).toBe(2);
    expect(m.municipios).toEqual([['ANÁPOLIS', 10]]);
    expect(m.destinacoes).toEqual([['Galpão industrial', 10]]);
    expect(percentilExato([], 50)).toBeUndefined();
    expect(percentilExato([5, 1, 3], 50)).toBe(3);
    expect(percentilExato([5, 1, 3], 90)).toBe(5);
  });
});

describe('LE-3C · fronteiras', () => {
  const fonte = readFileSync('src/core/radar/cnoPilot.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('25 · zero score, prioridade, classe, FIT, decision fit', () => {
    for (const p of ['score', 'Score', 'priority', 'prioridade', 'priorityClass', 'FIT', 'decisionFit', 'classe']) expect(fonte).not.toContain(p);
  });
  it('26 · zero Commercial Queue, cadência, oportunidade, tarefa', () => {
    for (const p of ['CommercialQueue', 'commercialQueue', 'cadencia', 'Cadencia', 'oportunidade', 'tarefa', 'atividade', 'comunicac']) expect(fonte).not.toContain(p);
  });
  it('27 · zero persistência: sem store, Supabase, INSERT, RegistroFonte; só imports do core', () => {
    for (const p of ['data/store', 'actions.', 'supabase', 'Supabase', 'INSERT', 'insert(', 'UPDATE', 'persistir', 'RegistroFonte', 'fetch(', 'node:fs', 'process.env']) expect(fonte).not.toContain(p);
    const imports = [...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('./'))).toBe(true);
  });
});
