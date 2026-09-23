// LE-3B — perfil estatistico: so agregados, memoria limitada, e a recorrencia de snapshot provada com o
// fingerprint do LE-1 (sem persistir nada).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envelopeCno, type CnoObservacao, type CnoObservacaoCanonica } from './cnoDadosAbertos';
import { classificarIntake, discoveryRecordDe, registroDeIntake, validarIntake } from './leadEngineIntake';
import { compararSnapshot, devePularProcessamento } from './cnoSnapshot';
import { Histograma, PerfilCno, faixaArea, faixaIdade, faixaObrasPorCnpj, fatosDe } from './cnoPerfil';
import { pedidoIntakeCno } from './cnoDadosAbertos';

const REF = '2026-09-12';
const CNPJ_A = '11222333000181';
const CNPJ_B = '11444777000161';

const obs = (p: Partial<CnoObservacaoCanonica> & { cno: string }): CnoObservacao => {
  const canonical: CnoObservacaoCanonica = {
    dataInicio: '2026-08-01', cnpjResponsavel: CNPJ_A, nomeResponsavel: 'Construtora Fictícia Alfa Ltda',
    nomeObra: 'Galpão', municipio: 'ANÁPOLIS', uf: 'GO', areaTotal: 1500, unidadeMedida: 'm2', situacao: '02',
    areas: [{ categoria: 'Obra Nova', destinacao: 'Galpão industrial', tipoConstrutivo: 'Alvenaria' }], cnaes: [], vinculos: [], ...p,
  };
  return { cno: p.cno, evidence: { obra: { CNO: p.cno, Nome: canonical.nomeObra ?? '' }, areas: [], cnaes: [], vinculos: [] }, canonical };
};
const pf = (cno: string, p: Partial<CnoObservacaoCanonica> = {}) => obs({ cno, cnpjResponsavel: undefined, nomeResponsavel: undefined, ...p });

describe('LE-3B · buckets', () => {
  it('área: faixas oficiais do gate, e sem área para undefined', () => {
    expect(faixaArea(undefined)).toBe('sem area');
    expect(faixaArea(0)).toBe('<250');
    expect(faixaArea(249.99)).toBe('<250');
    expect(faixaArea(250)).toBe('250-499');
    expect(faixaArea(500)).toBe('500-999');
    expect(faixaArea(1000)).toBe('1000-1999');
    expect(faixaArea(2000)).toBe('2000-4999');
    expect(faixaArea(5000)).toBe('5000-9999');
    expect(faixaArea(10000)).toBe('10000-19999');
    expect(faixaArea(20000)).toBe('20000+');
    expect(faixaArea(1e9)).toBe('20000+');
  });
  it('idade do evento: faixas em dias, futuro e sem data separados', () => {
    expect(faixaIdade(undefined)).toBe('sem data');
    expect(faixaIdade(-1)).toBe('futuro');
    expect(faixaIdade(0)).toBe('0-30');
    expect(faixaIdade(30)).toBe('0-30');
    expect(faixaIdade(31)).toBe('31-90');
    expect(faixaIdade(180)).toBe('91-180');
    expect(faixaIdade(365)).toBe('181-365');
    expect(faixaIdade(730)).toBe('366-730');
    expect(faixaIdade(731)).toBe('>730');
  });
  it('obras por CNPJ', () => {
    expect(['1', '2-5', '6-20', '21-100', '100+']).toEqual([1, 5, 20, 100, 101].map(faixaObrasPorCnpj));
  });
});

describe('LE-3B · histograma de largura fixa (percentis sem guardar a lista)', () => {
  it('percentis com erro ≤ largura do bin, máximo exato, vazio → undefined', () => {
    const h = new Histograma(10, 1000);
    expect(h.percentil(50)).toBeUndefined();
    for (let v = 1; v <= 100; v++) h.adicionar(v);
    expect(h.n).toBe(100);
    expect(h.maximo).toBe(100);
    const p50 = h.percentil(50)!;
    expect(p50).toBeGreaterThanOrEqual(50);
    expect(p50).toBeLessThanOrEqual(60);
    const p90 = h.percentil(90)!;
    expect(p90).toBeGreaterThanOrEqual(90);
    expect(p90).toBeLessThanOrEqual(100);
    expect(h.media).toBe(50.5);
  });
  it('valores acima do teto contam no último bin e o máximo continua exato', () => {
    const h = new Histograma(10, 100);
    h.adicionar(5); h.adicionar(5_000_000);
    expect(h.n).toBe(2);
    expect(h.maximo).toBe(5_000_000);
    expect(h.percentil(99)).toBe(5_000_000);
  });
  it('ignora valores inválidos ou negativos', () => {
    const h = new Histograma(1, 10);
    h.adicionar(-1); h.adicionar(NaN); h.adicionar(Infinity);
    expect(h.n).toBe(0);
  });
});

describe('LE-3B · perfil', () => {
  const perfilDe = (lista: CnoObservacao[]) => { const p = new PerfilCno(REF); for (const o of lista) p.adicionar(o); return p.resumo(); };

  it('fatos derivados uma vez: PJ, CNPJ, sinal, dias, área, galpão, ativa', () => {
    const f = fatosDe(obs({ cno: '1' }).canonical, REF);
    expect(f).toMatchObject({ pj: true, cnpj: true, sinal: 'CNO_NEW', temSinal: true, dias: 42, area: 1500, uf: 'GO', galpao: true, ativa: true });
    expect(fatosDe(pf('2', { areas: [{ categoria: 'Existente', destinacao: 'Galpão industrial' }], unidadeMedida: 'km', situacao: '15', dataInicio: undefined }).canonical, REF))
      .toMatchObject({ pj: false, cnpj: false, temSinal: false, dias: undefined, area: undefined, galpao: true, ativa: false });
  });

  it('contagens por UF, situação, destinação, sinal, idade e área', () => {
    const r = perfilDe([obs({ cno: '1' }), obs({ cno: '2', uf: 'SP', situacao: '15', areas: [{ categoria: 'Demolição', destinacao: 'Casa popular' }] }), pf('3', { uf: 'SP', dataInicio: '2020-01-01' })]);
    expect(r.total).toBe(3);
    expect(r.pj).toBe(2);
    expect(r.semPj).toBe(1);
    expect(r.cnpjValido).toBe(2);
    expect(Object.fromEntries(r.porUf)).toEqual({ GO: 1, SP: 2 });
    expect(Object.fromEntries(r.porSituacao)).toMatchObject({ '02': 2, '15': 1 });
    expect(Object.fromEntries(r.porDestinacao)).toEqual({ 'Galpão industrial': 2, 'Casa popular': 1 });
    expect(Object.fromEntries(r.porSinal)).toEqual({ CNO_NEW: 2, NENHUM: 1 });
    expect(Object.fromEntries(r.porIdade)).toMatchObject({ '31-90': 2, '>730': 1 });
    expect(Object.fromEntries(r.porArea)).toMatchObject({ '1000-1999': 3 });
  });

  it('interseções: PJ+sinal, +ATIVA, +recente, +área; PJ+galpão', () => {
    const r = perfilDe([
      obs({ cno: '1' }),                                                        // PJ, sinal, ativa, recente, 1500 m2, galpao
      obs({ cno: '2', situacao: '15', areaTotal: 300, dataInicio: '2024-01-01' }), // PJ, sinal, encerrada, antiga, 300 m2, galpao
      pf('3'),                                                                  // PF: nao entra em nada
      obs({ cno: '4', areas: [{ categoria: 'Existente', destinacao: 'Galpão industrial' }], areaTotal: 5000 }), // PJ, sem sinal, galpao 5000
    ]);
    const i = Object.fromEntries(r.intersecoes);
    expect(i).toEqual({
      'PJ+CNPJ_VALIDO': 3, 'PJ+SINAL': 2, 'PJ+SINAL+ATIVA': 1, 'PJ+SINAL+EVENTO<=365': 1,
      'PJ+SINAL+AREA>=500': 1, 'PJ+SINAL+AREA>=1000': 1, 'PJ+GALPAO': 3, 'PJ+GALPAO+EVENTO<=365': 2, 'PJ+GALPAO+AREA>=1000': 2,
    });
    expect(r.intersecoesPorUf['GO']['PJ+SINAL']).toBe(2);
  });

  it('Goiás é relatório: os números de GO existem, mas o perfil nacional não é filtrado por GO', () => {
    const r = perfilDe([obs({ cno: '1' }), obs({ cno: '2', uf: 'SP' })]);
    expect(r.goias.total).toBe(1);
    expect(r.goias.pj).toBe(1);
    expect(r.goias.sinal).toBe(1);
    expect(r.goias.sinalRecente365).toBe(1);
    expect(r.total).toBe(2);
    expect(r.cenarios.find((c) => c.id === 'A')!.total).toBe(2);
    expect(r.cenarios.find((c) => c.id === 'A')!.go).toBe(1);
  });

  it('cenários contam elegíveis, explicam recusas e medem área', () => {
    const r = perfilDe([obs({ cno: '1' }), obs({ cno: '2', areaTotal: 100 }), pf('3')]);
    const A = r.cenarios.find((c) => c.id === 'A')!;
    const C = r.cenarios.find((c) => c.id === 'C')!;
    expect(A.total).toBe(2);
    expect(Object.fromEntries(A.recusas)).toEqual({ SEM_PJ: 1, SEM_CNPJ_VALIDO: 1 });
    expect(C.total).toBe(1);
    expect(Object.fromEntries(C.recusas)).toEqual({ SEM_PJ: 1, SEM_CNPJ_VALIDO: 1, AREA_ABAIXO: 1 });
    expect(C.area.max).toBe(1500);
    expect(Object.fromEntries(A.porSinal)).toEqual({ CNO_NEW: 2 });
  });

  it('matriz de sensibilidade: janela × área mínima, Brasil e GO', () => {
    const r = perfilDe([
      obs({ cno: '1', dataInicio: '2026-09-01', areaTotal: 600 }),   // 11 dias, 600 m2, GO
      obs({ cno: '2', dataInicio: '2026-03-01', areaTotal: 3000, uf: 'SP' }), // 195 dias, 3000 m2, SP
      obs({ cno: '3', dataInicio: '2023-01-01', areaTotal: 9000 }),  // antiga: fora de todas as janelas
    ]);
    const s = r.sensibilidade;
    const linha = (dias: number) => s.brasil[s.janelas.indexOf(dias)];
    expect(linha(30)).toEqual([1, 1, 0, 0, 0]);
    expect(linha(365)).toEqual([2, 2, 1, 1, 0]);
    expect(linha(730)).toEqual([2, 2, 1, 1, 0]);
    expect(s.go[s.janelas.indexOf(365)]).toEqual([1, 1, 0, 0, 0]);
    expect(s.eventoDepoisDe[365]).toBe('2025-09-12');
  });

  it('tamanho do envelope: só obras com PJ, percentis, limiares e os maiores por CNO', () => {
    const grande = obs({ cno: '9', nomeObra: 'x'.repeat(200_000) });
    const r = perfilDe([obs({ cno: '1' }), grande, pf('2')]);
    expect(r.payload.n).toBe(2);
    expect(r.payload.max).toBeGreaterThan(200_000);
    expect(r.payload.acima100k).toBe(1);
    expect(r.payload.acima500k).toBe(0);
    expect(r.payload.maiores[0].cno).toBe('9');
    // o resumo carrega so CNO + bytes, nunca o conteudo
    expect(JSON.stringify(r.payload)).not.toContain('xxxxx');
    // e o tamanho medido e o do envelope real
    const bytes = new TextEncoder().encode(JSON.stringify(envelopeCno(grande))).length;
    expect(r.payload.max).toBe(bytes);
  });

  it('duplicidade por CNPJ: únicos, média, mediana, p90, máximo e distribuição', () => {
    const lista = [obs({ cno: '1' }), obs({ cno: '2' }), obs({ cno: '3' }), obs({ cno: '4', cnpjResponsavel: CNPJ_B }), pf('5')];
    const r = perfilDe(lista);
    expect(r.responsaveis.cnpjsUnicos).toBe(2);
    expect(r.responsaveis.obrasComCnpj).toBe(4);
    expect(r.responsaveis.mediaObrasPorCnpj).toBe(2);
    expect(r.responsaveis.maximo).toBe(3);
    expect(Object.fromEntries(r.responsaveis.distribuicao)).toEqual({ '1': 1, '2-5': 1, '6-20': 0, '21-100': 0, '100+': 0 });
  });

  it('privacidade: o resumo não carrega nome de obra, nome empresarial, endereço nem payload', () => {
    const r = perfilDe([obs({ cno: '1', nomeObra: 'NOME DE PESSOA FISICA', endereco: 'RUA TAL 123' }), pf('2', { nomeObra: 'OUTRA PESSOA' })]);
    const texto = JSON.stringify(r);
    for (const proibido of ['NOME DE PESSOA', 'OUTRA PESSOA', 'RUA TAL', 'Construtora Fictícia', 'evidence', CNPJ_A]) expect(texto).not.toContain(proibido);
  });
});

describe('LE-3B · recorrência de snapshot com o fingerprint do LE-1 (nada persistido)', () => {
  const FONTE = 'FONTE-CNO';
  const pedido = (o: CnoObservacao, em: string) => pedidoIntakeCno(o, FONTE, em);
  const existentes = (o: CnoObservacao) => {
    const p = pedido(o, '2026-09-12T00:00:00.000Z');
    const v = validarIntake(p);
    if (!v.ok) throw new Error('intake inválido');
    return [discoveryRecordDe(registroDeIntake(v, p, 'SR-' + o.cno))!];
  };
  const classificar = (o: CnoObservacao, base: ReturnType<typeof existentes>) => {
    const v = validarIntake(pedido(o, '2026-10-12T00:00:00.000Z'));
    if (!v.ok) throw new Error('intake inválido');
    return classificarIntake(v, base).resultado;
  };

  it('snapshot igual → skip no nível da fonte, antes de qualquer leitura', () => {
    const d = { etag: '"abc"', lastModified: 'x', contentLength: 1 };
    expect(devePularProcessamento(compararSnapshot(d, { ...d }))).toBe(true);
  });

  it('snapshot novo, CNO igual, dado igual → IDEMPOTENT_NOOP', () => {
    const o = obs({ cno: '1' });
    expect(devePularProcessamento(compararSnapshot({ etag: '"a"' }, { etag: '"b"' }))).toBe(false);
    expect(classificar(o, existentes(o))).toBe('IDEMPOTENT_NOOP');
  });

  it('snapshot novo, CNO igual, dado alterado → NOVA_OBSERVACAO', () => {
    const base = existentes(obs({ cno: '1' }));
    expect(classificar(obs({ cno: '1', situacao: '15' }), base)).toBe('NOVA_OBSERVACAO');
    // alteracao so na evidencia (o canonico ignora) tambem e observacao nova, porque a fonte mudou
    const alterada = obs({ cno: '1' });
    alterada.evidence.obra['Campo futuro'] = 'ABC';
    expect(classificar(alterada, base)).toBe('NOVA_OBSERVACAO');
  });

  it('CNO novo → NOVO_REGISTRO', () => {
    expect(classificar(obs({ cno: '2' }), existentes(obs({ cno: '1' })))).toBe('NOVO_REGISTRO');
  });
});

describe('LE-3B · fronteiras do perfil e do join', () => {
  for (const arquivo of ['cnoPerfil.ts', 'cnoStreamJoin.ts', 'cnoSnapshot.ts']) {
    it(`${arquivo}: puro, só core do Radar, sem persistência, sem score`, () => {
      const fonte = readFileSync(`src/core/radar/${arquivo}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const imports = [...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(imports.every((i) => i.startsWith('./'))).toBe(true);
      for (const proibido of ['fetch(', 'node:fs', 'readFileSync', 'supabase', 'Supabase', 'data/store', 'actions.', 'react', 'persistir', 'RegistroFonte', 'oportunidade', 'tarefa', 'atividade', 'comunicac', 'priorityScore', 'fitScore', 'CommercialQueue']) {
        expect(fonte).not.toContain(proibido);
      }
    });
  }
});
