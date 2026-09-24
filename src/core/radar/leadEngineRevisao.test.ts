// LE3-D.1 — a revisao comercial dos candidatos: projecao de obra/sinal/contexto CNO, "novo hoje" pela
// descoberta (nunca pela data oficial), filtros de revisao sem score, handoff de decisores sem consumo,
// promocao humana e metricas do piloto.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contextoCnoDoPayload, envelopeCno, pedidoIntakeCno, type CnoObservacao, type CnoObservacaoCanonica } from './cnoDadosAbertos';
import { registroDeIntake, validarIntake } from './leadEngineIntake';
import { filaDeRevisao, type ItemRevisaoLeadEngine } from './leadEngineReview';
import {
  FILTRO_VAZIO, JANELAS_DESCOBERTA, contadoresRevisao, dataLocalDe, descobertoHoje, filtrarRevisao, handoffDecisores, metricasPiloto,
} from './leadEngineRevisao';
import { radarVazio, type Empresa, type Fonte, type RadarDataset, type RegistroFonte } from './types';

const FONTE: Fonte = { id: 'FONTE-CNO', codigo: 'CNO', nome: 'Cadastro Nacional de Obras', tipo: 'CNO', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: '2026-01-01' };
const CNPJ = '11222333000181';
const HOJE = '2026-09-23';

const obs = (cno: string, p: Partial<CnoObservacaoCanonica> = {}): CnoObservacao => {
  const canonical: CnoObservacaoCanonica = {
    cno, dataInicio: '2026-08-15', dataRegistro: '2026-08-20', cnpjResponsavel: CNPJ, nomeResponsavel: 'Construtora Fictícia Alfa Ltda',
    qualificacaoResponsavel: '0053', qualificacaoResponsavelNome: 'Pessoa Jurídica Construtora',
    nomeObra: 'Galpão Alfa', municipio: 'ANÁPOLIS', uf: 'GO', endereco: 'RUA DAS ACÁCIAS SN', bairro: 'DISTRITO INDUSTRIAL',
    areaTotal: 4200, unidadeMedida: 'm2', situacao: '02', situacaoNome: 'ATIVA',
    areas: [{ categoria: 'Obra Nova', destinacao: 'Galpão industrial' }, { categoria: 'Existente', destinacao: 'Comercial salas e lojas' }], cnaes: [], vinculos: [], ...p,
  };
  return { cno, evidence: { obra: { CNO: cno }, areas: [], cnaes: [], vinculos: [] }, canonical };
};

/** RegistroFonte PENDING como o intake do LE-1 cria — payload = envelope completo. */
const registro = (id: string, o: CnoObservacao, recebidoEm: string, extra: Partial<RegistroFonte> = {}): RegistroFonte => {
  const p = pedidoIntakeCno(o, FONTE.id, recebidoEm);
  const v = validarIntake(p);
  if (!v.ok) throw new Error('intake inválido');
  return { ...registroDeIntake(v, p, id), ...extra };
};

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-01-01',
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});

const ds = (registros: RegistroFonte[], empresas: Empresa[] = []): RadarDataset => ({ ...radarVazio(), fontes: [FONTE], registrosFonte: registros, empresas });

// recebido em 2026-09-23 10:00 BRT = 13:00Z; recebido dia 22 as 23:30 BRT = 23 02:30Z (armadilha de fuso)
const HOJE_ISO = '2026-09-23T13:00:00.000Z';
const ONTEM_TARDE_ISO = '2026-09-23T02:30:00.000Z';
const item = (r: RadarDataset, i = 0): ItemRevisaoLeadEngine => filaDeRevisao(r)[i];

describe('LE3-D.1 · projeção de apresentação', () => {
  const r = ds([registro('SR-1', obs('010010092278'), HOJE_ISO)]);

  it('1 · o projeto do adapter chega ao ItemRevisaoLeadEngine', () => {
    const i = item(r);
    expect(i.projetoNormalizado?.nome).toBe('Galpão Alfa');
    expect(i.projetoNormalizado?.cidade).toBe('ANÁPOLIS');
    expect(i.projetoNormalizado?.uf).toBe('GO');
    expect(i.projetoNormalizado?.areaM2).toBe(4200);
    expect(i.projetoNormalizado?.externoId).toBe('010010092278');
  });

  it('2 · o sinal chega à projeção com a data oficial do evento', () => {
    const i = item(r);
    expect(i.sinaisNormalizados).toHaveLength(1);
    expect(i.sinaisNormalizados?.[0].tipo).toBe('CNO_NEW');
    expect(i.sinaisNormalizados?.[0].eventoEm).toBe('2026-08-15');
  });

  it('3 · a empresa normalizada continua igual (razão social da PJ, CNPJ, local)', () => {
    const i = item(r);
    expect(i.empresaNormalizada?.razaoSocial).toBe('Construtora Fictícia Alfa Ltda');
    expect(i.empresaNormalizada?.cnpj).toBe(CNPJ);
    expect(i.empresaNormalizada?.cidade).toBe('ANÁPOLIS');
    expect(i.identidadeForte).toBe(true);
    expect(i.bloqueios).toEqual([]);
  });

  it('1b · o contexto CNO traz obra, responsável, categorias, destinações e a data OFICIAL', () => {
    const c = item(r).contextoCno!;
    expect(c).toMatchObject({
      cno: '010010092278', nomeObra: 'Galpão Alfa', municipio: 'ANÁPOLIS', uf: 'GO', endereco: 'RUA DAS ACÁCIAS SN', bairro: 'DISTRITO INDUSTRIAL',
      areaM2: 4200, situacao: '02', situacaoNome: 'ATIVA', dataEventoCno: '2026-08-15', origemDataEvento: 'dataInicio', tipoSinal: 'CNO_NEW',
      cnpjResponsavel: CNPJ, nomeResponsavel: 'Construtora Fictícia Alfa Ltda', qualificacaoResponsavel: '0053', qualificacaoResponsavelNome: 'Pessoa Jurídica Construtora',
    });
    expect(c.categorias).toEqual(['Existente', 'Obra Nova']);
    expect(c.destinacoes).toEqual(['Comercial salas e lojas', 'Galpão industrial']);
    // area em unidade que nao e m2 nao vira area
    expect(contextoCnoDoPayload(envelopeCno(obs('1', { unidadeMedida: 'km' })))?.areaM2).toBeUndefined();
    // payload que nao e o envelope do CNO nao tem contexto
    expect(contextoCnoDoPayload({ cno: 'x', nomeResponsavel: 'y' })).toBeUndefined();
    expect(contextoCnoDoPayload(null)).toBeUndefined();
  });

  it('4 · a UI não lê regra comercial do payload: tudo que ela mostra vem do item projetado', () => {
    const ui = readFileSync('src/screens/radar/LeadEngineCandidatos.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const proibido of ['payload.', 'evidence', 'canonical', 'contextoCnoDoPayload', 'avaliarPolitica', 'sinalCno(', 'encontrarEmpresa', 'normalizarCnpj', 'adapterDe', 'JSON.parse']) {
      expect(ui).not.toContain(proibido);
    }
    // `.payloadFingerprint` (impressao, so repassada a porta do LE-2) e permitido; `.payload` bruto, nao
    expect(ui).not.toMatch(/\.payload(?!Fingerprint)/);
    expect(ui).toContain('c.contextoCno');
    expect(ui).toContain('c.projetoNormalizado');
    expect(ui).toContain('c.sinaisNormalizados');
  });

  it('5 · recebidoEm ≠ data oficial do CNO, e a projeção guarda as duas separadas', () => {
    const i = item(r);
    expect(i.recebidoEm).toBe(HOJE_ISO);
    expect(i.contextoCno?.dataEventoCno).toBe('2026-08-15');
    expect(i.recebidoEm.slice(0, 10)).not.toBe(i.contextoCno?.dataEventoCno);
    // e a tela nunca chama recebidoEm de data do CNO
    const ui = readFileSync('src/screens/radar/LeadEngineCandidatos.tsx', 'utf8');
    expect(ui).not.toMatch(/inclu[ií]d[ao] (hoje )?no CNO/i);
    expect(ui).toContain('descoberto pelo EIFF em');
    expect(ui).toContain('registro/evento CNO');
  });
});

describe('LE3-D.1 · "Novo hoje" e filtros de revisão', () => {
  const r = ds([
    registro('SR-hoje', obs('1'), HOJE_ISO),                                  // descoberto hoje (evento oficial 15/08)
    registro('SR-ontem', obs('2'), ONTEM_TARDE_ISO),                         // 22/09 23:30 BRT: ontem no fuso local, "hoje" em UTC
    registro('SR-5d', obs('3', { municipio: 'GOIÂNIA', areaTotal: 1200 }), '2026-09-18T12:00:00.000Z'),
    registro('SR-20d', obs('4', { areas: [{ categoria: 'Reforma', destinacao: 'Casa popular' }] }), '2026-09-03T12:00:00.000Z'),
    registro('SR-60d', obs('5', { dataInicio: '2026-09-22' }), '2026-07-25T12:00:00.000Z'), // evento oficial RECENTE, descoberta antiga
    registro('SR-200d', obs('6'), '2026-03-07T12:00:00.000Z', { statusIntake: 'REVIEW' }),
  ]);
  const fila = filaDeRevisao(r);

  it('6 · "Novo hoje" usa a data de DESCOBERTA no fuso local, não a data oficial do CNO', () => {
    expect(descobertoHoje({ recebidoEm: HOJE_ISO }, HOJE)).toBe(true);
    expect(descobertoHoje({ recebidoEm: ONTEM_TARDE_ISO }, HOJE)).toBe(false);   // 02:30Z e 23:30 de ontem em Brasilia
    expect(dataLocalDe(ONTEM_TARDE_ISO)).toBe('2026-09-22');
    // evento oficial de ontem (22/09) mas descoberto ha 60 dias: NAO e novo hoje
    const sr60 = fila.find((i) => i.registroFonteId === 'SR-60d')!;
    expect(sr60.contextoCno?.dataEventoCno).toBe('2026-09-22');
    expect(descobertoHoje(sr60, HOJE)).toBe(false);
  });

  it('7 · janelas hoje / 7 / 30 / 90 dias recortam pela descoberta', () => {
    const ids = (j: (typeof JANELAS_DESCOBERTA)[number]) => filtrarRevisao(fila, { janela: j }, HOJE).map((i) => i.registroFonteId);
    expect(ids('hoje')).toEqual(['SR-hoje']);
    expect(ids('7d')).toEqual(['SR-5d', 'SR-ontem', 'SR-hoje']);
    expect(ids('30d')).toEqual(['SR-20d', 'SR-5d', 'SR-ontem', 'SR-hoje']);
    expect(ids('90d')).toEqual(['SR-60d', 'SR-20d', 'SR-5d', 'SR-ontem', 'SR-hoje']);
    expect(ids('todos')).toHaveLength(6);
    expect(filtrarRevisao(fila, FILTRO_VAZIO, HOJE)).toHaveLength(6);
    const c = contadoresRevisao(fila, HOJE);
    expect(c).toMatchObject({ total: 6, hoje: 1, '7d': 3, '30d': 4, '90d': 5, pending: 5, review: 1, cnoNew: 5, cnoExpansion: 1 });
    expect(c.municipios[0]).toEqual(['ANÁPOLIS', 5]);
  });

  it('7b · município, tipo de sinal, área e status', () => {
    expect(filtrarRevisao(fila, { municipio: 'goiânia' }, HOJE).map((i) => i.registroFonteId)).toEqual(['SR-5d']);
    expect(filtrarRevisao(fila, { tipoSinal: 'CNO_EXPANSION' }, HOJE).map((i) => i.registroFonteId)).toEqual(['SR-20d']);
    expect(filtrarRevisao(fila, { areaMinimaM2: 2000 }, HOJE)).toHaveLength(5);
    expect(filtrarRevisao(fila, { areaMinimaM2: 5000 }, HOJE)).toHaveLength(0);
    expect(filtrarRevisao(fila, { status: 'REVIEW' }, HOJE).map((i) => i.registroFonteId)).toEqual(['SR-200d']);
    expect(filtrarRevisao(fila, { janela: '7d', tipoSinal: 'CNO_NEW', municipio: 'ANÁPOLIS' }, HOJE).map((i) => i.registroFonteId)).toEqual(['SR-ontem', 'SR-hoje']);
  });

  it('8 · nenhuma ordenação cria score: o filtro preserva a ordem de chegada da fila', () => {
    const ordemFila = fila.map((i) => i.registroFonteId);
    const filtrada = filtrarRevisao(fila, { janela: '90d' }, HOJE).map((i) => i.registroFonteId);
    expect(filtrada).toEqual(ordemFila.filter((id) => filtrada.includes(id)));
    const core = readFileSync('src/core/radar/leadEngineRevisao.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['score', 'Score', 'priority', 'prioridade', 'classe', 'CommercialQueue', 'cadencia', '.sort(']) {
      // o unico sort permitido e o dos contadores por municipio (desc por contagem), nunca dos itens
      if (p === '.sort(') { expect((core.match(/\.sort\(/g) ?? []).length).toBeLessThanOrEqual(2); continue; }
      expect(core).not.toContain(p);
    }
  });
});

describe('LE3-D.1 · promoção humana e handoff', () => {
  it('9 · a promoção continua humana: a projeção não muda estado e a tela só fala com a porta do LE-2', () => {
    const r = ds([registro('SR-1', obs('1'), HOJE_ISO)], [emp('EMP-1', { cnpj: CNPJ })]);
    const antes = JSON.stringify(r.registrosFonte);
    filaDeRevisao(r); filtrarRevisao(filaDeRevisao(r), { janela: 'hoje' }, HOJE); contadoresRevisao(filaDeRevisao(r), HOJE); metricasPiloto(r, HOJE);
    expect(JSON.stringify(r.registrosFonte)).toBe(antes);
    expect(r.registrosFonte[0].statusIntake).toBe('PENDING');
    const ui = readFileSync('src/screens/radar/LeadEngineCandidatos.tsx', 'utf8');
    expect([...new Set([...ui.matchAll(/actions\.([a-zA-Z]+)/g)].map((m) => m[1]))]).toEqual(['processarCandidatoLeadEngine']);
  });

  it('10 · "Buscar decisores" não consome crédito: é handoff para a empresa existente ou pede promoção primeiro', () => {
    const comMatch = ds([registro('SR-1', obs('1'), HOJE_ISO)], [emp('EMP-1', { cnpj: CNPJ })]);
    const h1 = handoffDecisores(item(comMatch));
    expect(h1).toEqual({ tipo: 'EMPRESA_EXISTENTE', empresaId: 'EMP-1', rota: '/radar/empresas/EMP-1?aba=contatos' });
    const semMatch = ds([registro('SR-2', obs('2'), HOJE_ISO)]);
    const h2 = handoffDecisores(item(semMatch));
    expect(h2.tipo).toBe('PROMOVER_PRIMEIRO');
    // nem o core nem a tela chamam Vibe / busca de decisor / reserva de credito
    const core = readFileSync('src/core/radar/leadEngineRevisao.ts', 'utf8');
    const ui = readFileSync('src/screens/radar/LeadEngineCandidatos.tsx', 'utf8');
    for (const p of ['buscarDecisor', 'vibe', 'Vibe', 'reserve_vibe', 'fetch(', '/api/']) { expect(core).not.toContain(p); expect(ui).not.toContain(p); }
  });
});

describe('LE3-D.1 · métricas do piloto', () => {
  it('conta descobertos, novos hoje, promovidos (associados x criadas), revisão, rejeitados e dimensões', () => {
    const r = ds([
      registro('SR-1', obs('1'), HOJE_ISO),
      registro('SR-2', obs('2', { cnpjResponsavel: '11444777000161', nomeResponsavel: 'Beta' }), '2026-09-10T12:00:00.000Z', { statusIntake: 'RESOLVED', entidadeId: 'PRJ-2', decididoEm: '2026-09-11T00:00:00.000Z' }),
      registro('SR-3', obs('3', { municipio: 'GOIÂNIA', areas: [{ categoria: 'Reforma', destinacao: 'Comercial salas e lojas' }] }), '2026-09-10T12:00:00.000Z', { statusIntake: 'RESOLVED', entidadeId: 'PRJ-3' }),
      registro('SR-4', obs('4'), '2026-09-10T12:00:00.000Z', { statusIntake: 'REJECTED', motivoDecisao: 'obra fora do perfil' }),
      registro('SR-5', obs('5'), '2026-09-10T12:00:00.000Z', { statusIntake: 'REVIEW' }),
    ], [
      emp('EMP-A', { cnpj: CNPJ, criadoEm: '2026-01-01' }),                       // existia antes: SR-3 foi ASSOCIADA
      emp('EMP-B', { cnpj: '11444777000161', criadoEm: '2026-09-11T00:00:00.000Z' }), // nasceu depois de SR-2: CRIADA pelo candidato
    ]);
    const m = metricasPiloto(r, HOJE);
    expect(m).toMatchObject({ descobertos: 5, novosHoje: 1, promovidos: 2, associados: 1, empresasCriadas: 1, emRevisao: 1, pendentes: 1, rejeitados: 1 });
    expect(m.motivosRejeicao).toEqual([['obra fora do perfil', 1]]);
    expect(Object.fromEntries(m.porSinal)).toEqual({ CNO_NEW: 4, CNO_EXPANSION: 1 });
    expect(Object.fromEntries(m.porMunicipio)).toEqual({ 'ANÁPOLIS': 4, 'GOIÂNIA': 1 });
    expect(Object.fromEntries(m.porFaixaArea)).toEqual({ '2000-4999': 5 });
    expect(m.porDestinacao.map(([k]) => k)).toContain('Galpão industrial');
    expect(m.porQualificacao[0]).toEqual(['Pessoa Jurídica Construtora', 5]);
  });

  it('registros de outras fontes ou sem intake_status ficam fora das métricas do piloto', () => {
    const legado: RegistroFonte = { id: 'SR-L', fonteId: FONTE.id, tipo: 'empresa', recebidoEm: '2026-09-01T00:00:00.000Z', payload: { x: 1 } };
    const r = ds([legado, registro('SR-1', obs('1'), HOJE_ISO)]);
    expect(metricasPiloto(r, HOJE).descobertos).toBe(1);
  });
});
