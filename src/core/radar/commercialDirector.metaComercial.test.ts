// CD-D3/E4 — retrato comercial canônico CD-1.3: o bloco metaComercial do snapshot do Diretor Comercial.
//
// Prova: paridade EXATA com o motor E1 (apurarMetaComercial), CD-1.2 preservado byte a byte (golden gerado com o código
// do CD-1.2), meta ausente/retirada/versionada, livro indisponível ≠ livro vazio, ganho sem valor sem estimativa,
// estorno em outro mês, complemento retroativo, virada de mês e de ano em São Paulo, conta inativada/mesclada depois do
// ganho, centavos e realizado negativo, determinismo, imutabilidade e nenhuma fórmula duplicada.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { medidasDoSnapshotCD, snapshotComercialCD, VERSAO_REGRAS_CD, type BlocoMetaComercialCD, type OpcoesSnapshotCD } from './commercialDirector';
import { ESTADOS_MEDIDA } from './commercialMetrics';
import { apurarMetaComercial, type EventoDesfecho, type VersaoMetaComercial } from './metaComercial';
import type { RadarDataset } from './types';
import { AGORA_CD13, C2, DESFECHOS_CD13, G1, HOJE_CD13, METAS_CD13, X1, complemento, estorno, ganho, meta, mundoCD13 } from './__fixtures__/cdMetaComercial';
import golden from './__fixtures__/cd-1.2-snapshot.json';

const USUARIOS = [{ id: 'u1', ativo: true }];
const snap = (r: RadarDataset = mundoCD13(), opcoes: OpcoesSnapshotCD = {}) => snapshotComercialCD(r, HOJE_CD13, { agoraIso: AGORA_CD13, usuarios: USUARIOS, ...opcoes });
const bloco = (r: RadarDataset = mundoCD13(), opcoes: OpcoesSnapshotCD = {}): BlocoMetaComercialCD => snap(r, opcoes).metaComercial;
const valor = (m: { estado: string; valor?: number }) => (m.estado === 'DISPONIVEL' ? m.valor : m.estado);
const e1 = (r: RadarDataset, mes: string, agora = AGORA_CD13) => apurarMetaComercial({ metas: r.metasComerciais ?? [], eventos: r.desfechos ?? [], mes, agora });
const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; };
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const CODIGO_CD = semComentarios(readFileSync('src/core/radar/commercialDirector.ts', 'utf8'));

describe('CD-1.3 · versão e preservação do CD-1.2', () => {
  it('a versão sobe para CD-1.3', () => {
    expect(VERSAO_REGRAS_CD).toBe('CD-1.3');
    expect(snap().versaoRegras).toBe('CD-1.3');
  });

  it('todas as medidas do CD-1.2 ficam idênticas ao snapshot gerado com o código do CD-1.2 (golden)', () => {
    const { metaComercial, versaoRegras, ...resto } = snap();
    expect(metaComercial).toBeDefined();
    expect(versaoRegras).toBe('CD-1.3');
    const { versaoRegras: versaoGolden, ...goldenResto } = golden as Record<string, unknown>;
    expect(versaoGolden).toBe('CD-1.2');
    expect(JSON.parse(JSON.stringify(resto))).toEqual(goldenResto);
  });
});

describe('CD-1.3 · paridade exata com o motor E1', () => {
  for (const mes of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
    it(`${mes}: medidas, alertas, retificações e inconsistências são exatamente as do apurarMetaComercial`, () => {
      const r = mundoCD13();
      const b = bloco(r, { mesComercial: mes });
      const a = e1(r, mes);
      const { retificacoes, eventosInconsistentes, ...doMotor } = b.medidas;
      expect(doMotor).toEqual(a.medidas);
      expect(b.alertas).toEqual(a.alertas);
      expect(b.retificacoes).toEqual(a.retificacoes);
      expect(b.inconsistencias).toEqual(a.inconsistencias);
      expect([b.mes, b.situacao, b.vistoEm, b.versaoRegras]).toEqual([a.mes, a.situacao, a.vistoEm, a.versaoRegras]);
      if (a.situacao !== 'FUTURO') expect(valor(retificacoes)).toBe(a.retificacoes.length);
      expect(valor(eventosInconsistentes)).toBe(a.inconsistencias.eventos.length);
    });
  }

  it('o mês padrão é o do instante de referência em São Paulo (não o de UTC)', () => {
    // 01/11 02:00 UTC = 31/10 23:00 em São Paulo
    expect(bloco(mundoCD13(), {}).mes).toBe('2026-10');
    expect(snapshotComercialCD(mundoCD13(), HOJE_CD13, { agoraIso: '2026-11-01T02:00:00Z' }).metaComercial.mes).toBe('2026-10');
    expect(snapshotComercialCD(mundoCD13(), HOJE_CD13, { agoraIso: '2026-11-01T03:00:00Z' }).metaComercial.mes).toBe('2026-11');
  });
});

describe('CD-1.3 · números do mundo de teste (centavos exatos)', () => {
  it('setembro: ganho confirmado, ganho sem valor complementado em outubro (retifica setembro) e a virada de 30/09 23h30 em SP', () => {
    const m = bloco(mundoCD13(), { mesComercial: '2026-09' }).medidas;
    // G1 120.000,50 + G2 complementado 30.000,25 + G7 5.000,00 (23h30 de 30/09 em São Paulo)
    expect([valor(m.ganhos), valor(m.ganhosSemValor), valor(m.valorGanhos), valor(m.estornos), valor(m.realizado), valor(m.retificacoes)]).toEqual([3, 0, 155000.75, 0, 155000.75, 1]);
    expect([valor(m.meta), valor(m.atingimento), valor(m.faltaParaMeta), valor(m.excedente)]).toEqual([100000, 1.5500075, 0, 55000.75]);
  });

  it('outubro: estorno do ganho de setembro conta em outubro; meta versionada vale a v2; contas inativada e mesclada contam', () => {
    const b = bloco();
    const m = b.medidas;
    // G8 10.000 (00h00 de 01/10 em SP) + G3 80.000 (conta inativada) + G4 45.000,10 (conta mesclada) + G5 100.000
    expect([valor(m.ganhos), valor(m.valorGanhos), valor(m.estornos), valor(m.valorEstornos), valor(m.realizadoConfirmado), valor(m.realizado)]).toEqual([4, 235000.1, 1, 120000.5, 114999.6, 114999.6]);
    expect([valor(m.meta), valor(m.faltaParaMeta), valor(m.excedente)]).toEqual([250000, 135000.4, 0]);
    expect(valor(m.atingimento)).toBeCloseTo(0.4599984, 12);
    expect(b.metaVigente).toEqual({ estado: 'VIGENTE', id: 'MO2', versao: 2 });
    expect(valor(m.retificacoes)).toBe(0); // o complemento C2 é de outubro, mas corrige SETEMBRO
    expect(b.alertas.map((x) => x.codigo)).toEqual(['ESTORNO_NO_MES']);
  });

  it('atingimento não usa a amostra mínima de 30 das taxas operacionais (4 ganhos bastam)', () => {
    const m = bloco().medidas;
    expect(valor(m.ganhos)).toBe(4);
    expect(m.atingimento.estado).toBe('DISPONIVEL');
    expect(m.atingimento.unidade).toBe('RAZAO');
  });

  it('mês futuro: NAO_APLICAVEL; meta futura e meta retirada aparecem como são', () => {
    const nov = bloco(mundoCD13(), { mesComercial: '2026-11' });
    expect(nov.situacao).toBe('FUTURO');
    expect([nov.medidas.ganhos.estado, nov.medidas.realizado.estado, nov.medidas.retificacoes.estado]).toEqual(['NAO_APLICAVEL', 'NAO_APLICAVEL', 'NAO_APLICAVEL']);
    expect(valor(nov.medidas.meta)).toBe(300000);
    const dez = bloco(mundoCD13(), { mesComercial: '2026-12' });
    expect(dez.metaVigente).toEqual({ estado: 'RETIRADA', id: 'MD2', versao: 2 });
    expect(dez.medidas.meta.estado).toBe('DADO_INSUFICIENTE');
    expect(dez.medidas.meta.motivoInsuficiencia).toBe('meta retirada (versão 2)');
  });

  it('meta ausente não vira meta zero', () => {
    const b = bloco(mundoCD13(), { mesComercial: '2026-08' });
    expect(b.metaVigente).toEqual({ estado: 'AUSENTE' });
    expect(b.medidas.meta).toMatchObject({ estado: 'DADO_INSUFICIENTE', motivoInsuficiencia: 'sem meta definida para o mês' });
    expect(b.medidas.meta.valor).toBeUndefined();
    expect(b.medidas.atingimento.estado).toBe('DADO_INSUFICIENTE');
    expect(valor(b.medidas.ganhos)).toBe(0);
  });
});

describe('CD-1.3 · indisponível ≠ vazio ≠ zero', () => {
  it('livro carregado e vazio = zero eventos (DISPONIVEL 0)', () => {
    const m = bloco({ ...mundoCD13(), desfechos: [] }).medidas;
    expect([valor(m.ganhos), valor(m.valorGanhos), valor(m.estornos), valor(m.realizado), valor(m.eventosInconsistentes)]).toEqual([0, 0, 0, 0, 0]);
    expect([valor(m.atingimento), valor(m.faltaParaMeta)]).toEqual([0, 250000]);
  });

  it('livro NÃO carregado = DADO_INSUFICIENTE com motivo (nunca zero); a meta continua disponível', () => {
    const b = bloco({ ...mundoCD13(), desfechos: undefined });
    expect(b.disponibilidade).toEqual({ instante: true, metas: true, livro: false });
    for (const k of ['ganhos', 'ganhosSemValor', 'valorGanhos', 'estornos', 'valorEstornos', 'realizadoConfirmado', 'realizado', 'atingimento', 'faltaParaMeta', 'excedente', 'retificacoes', 'eventosInconsistentes'] as const) {
      expect(b.medidas[k].estado, k).toBe('DADO_INSUFICIENTE');
      expect(b.medidas[k].valor, k).toBeUndefined();
      expect(b.medidas[k].motivoInsuficiencia, k).toMatch(/livro de desfechos não carregado/);
    }
    expect(valor(b.medidas.meta)).toBe(250000);
  });

  it('metas NÃO carregadas = meta e comparações DADO_INSUFICIENTE (sem alerta de meta ausente); o realizado continua', () => {
    const b = bloco({ ...mundoCD13(), metasComerciais: undefined });
    expect(b.disponibilidade).toEqual({ instante: true, metas: false, livro: true });
    expect(b.metaVigente).toBeUndefined();
    for (const k of ['meta', 'atingimento', 'faltaParaMeta', 'excedente'] as const) expect(b.medidas[k].motivoInsuficiencia, k).toMatch(/metas comerciais não carregadas/);
    expect(valor(b.medidas.realizado)).toBe(114999.6);
    expect(b.alertas.some((x) => x.codigo.startsWith('META_'))).toBe(false);
  });

  it('nada carregado: os dois motivos aparecem juntos nas comparações', () => {
    const b = bloco({ ...mundoCD13(), metasComerciais: undefined, desfechos: undefined });
    expect(b.medidas.atingimento.motivoInsuficiencia).toMatch(/livro de desfechos não carregado.*; metas comerciais não carregadas/);
  });

  it('sem instante explícito (ou só data civil): o bloco inteiro é DADO_INSUFICIENTE, com as definições do motor', () => {
    for (const agoraIso of [undefined, '2026-10-14', 'ontem']) {
      const b = snapshotComercialCD(mundoCD13(), HOJE_CD13, { agoraIso }).metaComercial;
      expect(b.disponibilidade.instante).toBe(false);
      expect(b.mes).toBeUndefined();
      const ms = Object.values(b.medidas);
      expect(ms.every((m) => m.estado === 'DADO_INSUFICIENTE' && m.valor === undefined && /instante de referência/.test(m.motivoInsuficiencia!))).toBe(true);
      expect(Object.keys(b.medidas).sort()).toEqual(Object.keys(bloco().medidas).sort());
      expect(Object.fromEntries(Object.entries(b.medidas).map(([k, m]) => [k, m.descricao]))).toEqual(Object.fromEntries(Object.entries(bloco().medidas).map(([k, m]) => [k, m.descricao])));
    }
  });

  it('mês comercial inválido é recusado', () => {
    expect(() => bloco(mundoCD13(), { mesComercial: '2026-13' })).toThrow(/mês comercial inválido/);
  });
});

describe('CD-1.3 · regras de negócio', () => {
  it('ganho sem valor não é preenchido pelo valor estimado nem pelo valor fechado da oportunidade', () => {
    const r: RadarDataset = { ...mundoCD13(), desfechos: [...DESFECHOS_CD13, ganho('G6', 'O1', 'E6', '2026-10-09T12:00:00.000000+00:00')] };
    const b = bloco(r);
    expect([valor(b.medidas.ganhos), valor(b.medidas.ganhosSemValor), valor(b.medidas.valorGanhos), valor(b.medidas.realizadoConfirmado)]).toEqual([5, 1, 235000.1, 114999.6]);
    expect(b.medidas.realizado.estado).toBe('DADO_INSUFICIENTE');
    expect(b.medidas.atingimento.estado).toBe('DADO_INSUFICIENTE');
    // mexer em valor estimado, valor fechado, estágio ou probabilidade das oportunidades não muda nada
    const mexido: RadarDataset = { ...r, oportunidades: r.oportunidades.map((o) => ({ ...o, valorEstimado: 9_999_999, valorFechado: 8_888_888, probabilidade: 1, estagio: 'WON' as const })) };
    expect(bloco(mexido)).toEqual(b);
  });

  it('conta inativada ou mesclada depois do ganho não apaga a receita histórica', () => {
    const r = mundoCD13();
    const reativadas: RadarDataset = { ...r, empresas: r.empresas.map((e) => ({ ...e, ativo: true, mescladaEm: undefined })) };
    const semEmpresas: RadarDataset = { ...r, empresas: [] };
    expect(bloco(reativadas)).toEqual(bloco(r));
    expect(bloco(semEmpresas)).toEqual(bloco(r));
  });

  it('estorno conta no mês em que ocorreu, com o valor do ganho; o mês do ganho não muda', () => {
    const set = bloco(mundoCD13(), { mesComercial: '2026-09' }).medidas;
    const out = bloco().medidas;
    expect(valor(set.valorGanhos)).toBe(155000.75); // G1 continua em setembro
    expect([valor(set.estornos), valor(out.estornos), valor(out.valorEstornos)]).toEqual([0, 1, 120000.5]);
    const b = bloco();
    expect(b.alertas.find((x) => x.codigo === 'ESTORNO_NO_MES')?.evidencias).toEqual([X1.id]);
  });

  it('complemento retroativo corrige o mês do ganho original, com rastro do mês do complemento', () => {
    const set = bloco(mundoCD13(), { mesComercial: '2026-09' });
    expect(set.retificacoes).toEqual([{ ganhoId: 'G2', oportunidadeId: 'O5', complementoId: C2.id, complementadoEm: C2.ocorridoEm, mesDoComplemento: '2026-10', centavos: 3000025 }]);
    // visto ANTES do complemento, setembro tinha um ganho sem valor e o realizado era incompleto
    const antes = snapshotComercialCD(mundoCD13(), HOJE_CD13, { agoraIso: '2026-10-02T12:00:00Z', mesComercial: '2026-09' }).metaComercial;
    expect([valor(antes.medidas.ganhosSemValor), antes.medidas.realizado.estado, valor(antes.medidas.realizadoConfirmado)]).toEqual([1, 'DADO_INSUFICIENTE', 125000.5]);
  });

  it('virada de ano no fuso comercial: 31/12 23h59 em SP é dezembro; 00h00 de 01/01 é janeiro', () => {
    const r: RadarDataset = {
      ...mundoCD13(),
      metasComerciais: [meta('MDZ', '2026-12', '1000.00', 1, '2026-12-01T12:00:00Z'), meta('MJA', '2027-01', '1000.00', 1, '2027-01-01T12:00:00Z')],
      desfechos: [ganho('GD', 'OD', 'E1', '2027-01-01T02:59:59.999999+00:00', '700.00'), ganho('GJ', 'OJ', 'E1', '2027-01-01T03:00:00.000000+00:00', '300.00')],
    };
    const agora = '2027-01-15T12:00:00Z';
    const dez = snapshotComercialCD(r, '2027-01-15', { agoraIso: agora, mesComercial: '2026-12' }).metaComercial.medidas;
    const jan = snapshotComercialCD(r, '2027-01-15', { agoraIso: agora }).metaComercial;
    expect([valor(dez.ganhos), valor(dez.valorGanhos), valor(dez.faltaParaMeta)]).toEqual([1, 700, 300]);
    expect([jan.mes, valor(jan.medidas.ganhos), valor(jan.medidas.valorGanhos)]).toEqual(['2027-01', 1, 300]);
  });

  it('centavos exatos e realizado negativo depois de estornos (piso conhecido negativo é publicado)', () => {
    const g1 = ganho('GA', 'OA', 'E1', '2026-10-02T12:00:00Z', '0.10');
    const g2 = ganho('GB', 'OB', 'E1', '2026-10-03T12:00:00Z', '0.20');
    const r: RadarDataset = { ...mundoCD13(), metasComerciais: [meta('MN', '2026-11', '1000.00', 1, '2026-10-20T12:00:00Z')], desfechos: [g1, g2, estorno('XA', g1, '2026-11-02T12:00:00Z'), estorno('XB', g2, '2026-11-03T12:00:00Z')] };
    const out = snapshotComercialCD(r, '2026-11-10', { agoraIso: '2026-11-10T12:00:00Z', mesComercial: '2026-10' }).metaComercial.medidas;
    expect(valor(out.valorGanhos)).toBe(0.3); // 10 + 20 centavos, sem erro de ponto flutuante
    const nov = snapshotComercialCD(r, '2026-11-10', { agoraIso: '2026-11-10T12:00:00Z' }).metaComercial.medidas;
    expect([valor(nov.ganhos), valor(nov.valorEstornos), valor(nov.realizadoConfirmado), valor(nov.realizado), valor(nov.faltaParaMeta), valor(nov.excedente)]).toEqual([0, 0.3, -0.3, -0.3, 1000.3, 0]);
    expect(valor(nov.atingimento)).toBeCloseTo(-0.0003, 12);
  });

  it('eventos inconsistentes não contam duas vezes e viram alerta e medida', () => {
    const r: RadarDataset = { ...mundoCD13(), desfechos: [...DESFECHOS_CD13, { ...G1 }, ganho('GX', 'O2', 'E1', '2026-10-08T12:00:00Z', '1.00')] };
    const b = bloco(r);
    expect(valor(b.medidas.eventosInconsistentes)).toBe(2); // G1 repetido + segundo ganho vigente da mesma oportunidade
    expect(valor(b.medidas.valorGanhos)).toBe(235000.1);
    expect(b.alertas.some((x) => x.codigo === 'EVENTOS_INCONSISTENTES')).toBe(true);
  });
});

describe('CD-1.3 · contrato, determinismo e autoridade única', () => {
  it('toda medida nova tem id meta.*, autoridade META_COMERCIAL e forma coerente com o estado; ids únicos no snapshot', () => {
    const s = snap();
    const todas = medidasDoSnapshotCD(s);
    expect(new Set(todas.map((m) => m.id)).size).toBe(todas.length);
    const novas = Object.values(s.metaComercial.medidas);
    expect(novas.length).toBe(14);
    for (const m of novas) {
      expect(m.id).toMatch(/^meta\./);
      expect(m.autoridade).toBe('META_COMERCIAL');
      expect(ESTADOS_MEDIDA).toContain(m.estado);
      if (m.estado === 'DISPONIVEL') { expect(typeof m.valor, m.id).toBe('number'); expect(m.motivoInsuficiencia, m.id).toBeUndefined(); }
      else { expect(m.valor, m.id).toBeUndefined(); expect(m.motivoInsuficiencia, m.id).toBeTruthy(); }
    }
    expect(todas.filter((m) => m.id.startsWith('meta.')).length).toBe(14);
  });

  it('determinismo: mesma entrada = mesmo bloco; ordem das coleções não importa; entrada não é modificada', () => {
    expect(bloco()).toEqual(bloco());
    const r = mundoCD13();
    const invertido: RadarDataset = { ...r, desfechos: [...(r.desfechos as EventoDesfecho[])].reverse(), metasComerciais: [...(r.metasComerciais as VersaoMetaComercial[])].reverse() };
    expect(bloco(invertido)).toEqual(bloco(r));
    const congelado = deepFreeze(mundoCD13()); const antes = JSON.stringify(congelado);
    expect(() => bloco(congelado)).not.toThrow();
    expect(JSON.stringify(congelado)).toBe(antes);
  });

  it('nenhuma fórmula duplicada: o Diretor só chama apurarMetaComercial e não lê valor de evento, oportunidade ou financeiro', () => {
    expect(CODIGO_CD.match(/apurarMetaComercial\(/g)?.length).toBe(2); // apuração + definições sem instante
    for (const proibido of ['lerLivroDesfechos', 'centavosDoGanho', 'lerValor', 'metaVigenteDoMes', 'reais(', 'valorFechado', 'valorEstimado ?', 'faturamento', 'financial', 'cfo', 'caixa', '../engine'])
      expect(CODIGO_CD, proibido).not.toContain(proibido);
    // o bloco só lê do dataset as metas e o livro (as empresas não filtram receita)
    const corpo = CODIGO_CD.slice(CODIGO_CD.indexOf('function blocoMetaComercial'), CODIGO_CD.indexOf('export function medidasDoSnapshotCD'));
    expect([...corpo.matchAll(/radar\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(['desfechos', 'desfechos', 'desfechos', 'metasComerciais', 'metasComerciais']);
  });

  it('fixtures coerentes: as metas e o livro do mundo de teste são as do arquivo de fixture', () => {
    expect(mundoCD13().metasComerciais).toEqual(METAS_CD13);
    expect(mundoCD13().desfechos).toEqual(DESFECHOS_CD13);
    expect(complemento('Z', G1, '2026-10-01T00:00:00Z', '1.00').ganhoId).toBe('G1');
  });
});
