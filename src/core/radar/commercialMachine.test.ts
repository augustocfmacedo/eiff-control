import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_COMMERCIAL_QUEUE, CHAVES_ORDEM_CM, CODIGOS_RAZAO_CM, CODIGOS_TRAVA_CM, DEGRAU_CATEGORIA, HIPOTESE_COMMERCIAL_MACHINE, MOTIVOS_FORA_DA_FILA, NOME_CATEGORIA_CM,
  TEXTO_FORA_DA_FILA, TEXTO_RAZAO_CM, TEXTO_TRAVA_CM, VERSAO_REGRAS_CM,
  canaisAcionaveisCM, chaveQueDecideCM, compararItensCM, construirCommercialQueue, normalizarHojeCM,
  type CommercialQueue, type CommercialQueueItem, type RazaoCM,
} from './commercialMachine';
import { TRANSICOES_RESULTADO } from './comunicacao';
import { contatoElegivel } from './contatos';
import { recomendarAcao, semProximaAcao } from './pipeline';
import { CODIGOS_RESPOSTA, radarVazio, type Atividade, type ComunicacaoRadar, type Contato, type Empresa, type Oportunidade, type RadarDataset, type Sinal, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures (nomes ficticios; nenhum nome de conta real)
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const PESOS = [
  { chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 },
  { chave: 'persona.CEO.media', valor: 85 }, { chave: 'persona.OPERATIONS.media', valor: 55 }, { chave: 'persona.PROCUREMENT.media', valor: 30 },
];
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;

const emp = (id: string, priorityClass: Empresa['priorityClass'] = 'A', priorityScore = 75, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01',
  fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore, priorityClass, ...p,
});
const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({
  id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO', email: `${id}@conta-${empresaId}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p,
});
const sin = (id: string, empresaId: string, p: Partial<Sinal> = {}): Sinal => ({
  id, empresaId, fonteId: 'f-news', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade', descricao: 'Nova unidade anunciada', eventoEm: '2026-09-10', detectadoEm: '2026-09-12',
  confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-12'), ...p,
});
const atv = (id: string, empresaId: string, p: Partial<Atividade> = {}): Atividade => ({
  id, empresaId, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts('2026-09-14'), notas: '', criadoEm: ts('2026-09-14'), ...p,
});
const tar = (id: string, empresaId: string, p: Partial<TarefaRadar> = {}): TarefaRadar => ({
  id, empresaId, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: HOJE, status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-10', '09:00'), ...p,
});
const opp = (id: string, empresaId: string, p: Partial<Oportunidade> = {}): Oportunidade => ({
  id, empresaId, titulo: `Galpão ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: ts('2026-09-12'), atualizadoEm: ts('2026-09-12'), ...p,
});
const com = (id: string, empresaId: string, contatoId: string, p: Partial<ComunicacaoRadar> = {}): ComunicacaoRadar => ({
  id, empresaId, contatoId, canal: 'EMAIL', objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', estado: 'READY_FOR_REVIEW', spec: {},
  resultado: { versaoPrincipal: 'texto', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: `h-${id}`,
  versoes: { playbook: '1', contentSpec: '3', prompt: '1', provedor: 'deterministico' }, validacao: { ok: true, problemas: [] }, criadoEm: ts('2026-09-13'), atualizadoEm: ts('2026-09-13'), criadoPor: 'u1', historico: [], ...p,
});
const ds = (p: Partial<RadarDataset>): RadarDataset => ({ ...radarVazio(), pesosDecisionFit: PESOS, ...p });
const fila = (r: RadarDataset, hoje = HOJE, opcoes = {}) => construirCommercialQueue(r, hoje, opcoes);
const item = (q: CommercialQueue, id: string) => q.itens.find((i) => i.empresaId === id);
const codigos = (i?: CommercialQueueItem) => (i ? [i.porQueAgora.codigo, ...i.secundarias.map((s) => s.codigo)] : []);
const secundaria = (i: CommercialQueueItem | undefined, codigo: RazaoCM['codigo']) => i?.secundarias.find((s) => s.codigo === codigo);

// Cenario rico: uma conta por situacao comercial relevante
function cenarioRico(): RadarDataset {
  return ds({
    empresas: [
      emp('resp', 'A', 80), emp('venc', 'B', 60), emp('sinal', 'B', 55), emp('oppsem', 'B', 50), emp('parada', 'A', 72), emp('critica', 'B', 48), emp('hoje', 'B', 58),
      emp('aprov', 'A', 70), emp('follow', 'B', 52), emp('interv', 'B', 51), emp('rev', 'C', 35), emp('dup1', 'A', 75), emp('dup2', 'B', 45), emp('prosp', 'A+', 90),
      emp('enriq', 'A', 71), emp('neg', 'A', 74), emp('lost', 'B', 50), emp('won', 'B', 50), emp('futura', 'A', 73), emp('saiu', 'A', 76), emp('telinv', 'A', 77),
      emp('conflito', 'B', 49), emp('semdono', 'B', 50), emp('supr', 'A', 95), emp('merg', 'A', 80, { mescladaEm: 'prosp', ativo: false }), emp('inat', 'A', 80, { ativo: false }), emp('dnada', 'D', 10),
    ],
    contatos: [
      cont('c-resp', 'resp'), cont('c-venc', 'venc'), cont('c-sinal', 'sinal'), cont('c-oppsem', 'oppsem'), cont('c-parada', 'parada'), cont('c-hoje', 'hoje'), cont('c-aprov', 'aprov'),
      cont('c-follow', 'follow'), cont('c-interv', 'interv'), cont('c-rev', 'rev'), cont('c-dup1', 'dup1'), cont('c-prosp', 'prosp', { whatsapp: '5562999990000' }), cont('c-neg', 'neg'),
      cont('c-saiu', 'saiu', { situacao: 'SAIU_DA_EMPRESA' }), cont('c-telinv', 'telinv', { email: undefined, telefone: '5562999990001' }),
      cont('c-conf1', 'conflito'), cont('c-conf2', 'conflito', { persona: 'OPERATIONS' }), cont('c-supr', 'supr'),
    ],
    sinais: [sin('s-sinal', 'sinal', { detectadoEm: '2026-09-13' }), sin('s-neg', 'neg', { detectadoEm: '2026-08-20', eventoEm: '2026-08-18' })],
    atividades: [
      atv('a-resp', 'resp', { contatoId: 'c-resp', resultado: 'REQUESTED_MEETING', ocorreuEm: ts('2026-09-12'), criadoEm: ts('2026-09-12') }),
      atv('a-follow', 'follow', { contatoId: 'c-follow', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-08'), criadoEm: ts('2026-09-08') }),
      atv('a-interv', 'interv', { contatoId: 'c-interv', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-13'), criadoEm: ts('2026-09-13') }),
      atv('a-neg', 'neg', { contatoId: 'c-neg', resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-09-01'), criadoEm: ts('2026-09-01') }),
    ],
    tarefas: [
      tar('t-venc', 'venc', { contatoId: 'c-venc', venceEm: '2026-09-11' }), tar('t-parada', 'parada', { oportunidadeId: 'o-parada', venceEm: '2026-09-20' }),
      tar('t-critica', 'critica', { oportunidadeId: 'o-critica', venceEm: '2026-09-30' }), tar('t-hoje', 'hoje'),
      tar('t-futura', 'futura', { tipo: 'RESEARCH', venceEm: '2026-09-20' }), tar('t-conf', 'conflito', { contatoId: 'c-conf1' }),
    ],
    oportunidades: [
      opp('o-oppsem', 'oppsem', { estagio: 'QUALIFIED' }), opp('o-parada', 'parada', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-08'), valorEstimado: 500_000 }),
      opp('o-critica', 'critica', { estagio: 'NEGOTIATION', criadoEm: ts('2026-08-20') }),
      opp('o-lost', 'lost', { estagio: 'LOST', fechadoEm: '2026-08-15', motivoFechamento: 'preço' }), opp('o-won', 'won', { estagio: 'WON', fechadoEm: '2026-08-10' }),
      opp('o-semdono', 'semdono', { responsavelId: '', proximaAcao: 'retomar', proximaAcaoEm: '2026-09-25' }),
    ],
    comunicacoes: [com('m-aprov', 'aprov', 'c-aprov', { estado: 'APPROVED', aprovadoEm: ts('2026-09-14') }), com('m-rev', 'rev', 'c-rev'), com('m-conf', 'conflito', 'c-conf2')],
    duplicatas: [{ id: 'd1', empresaId: 'dup2', candidataId: 'dup1', confianca: 0.7, motivo: 'mesmo domínio', status: 'pendente', criadoEm: ts('2026-09-10') }],
    supressoes: [
      { id: 'sp-supr', empresaId: 'supr', tipo: 'do_not_contact', motivo: 'pedido', criadoPor: 'u1', criadoEm: ts('2026-09-01') },
      { id: 'sp-tel', contatoId: 'c-telinv', tipo: 'invalid_phone', motivo: 'INVALID_CONTACT', criadoPor: 'u1', criadoEm: ts('2026-09-01') },
    ],
  });
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}
const COLECOES = ['empresas', 'contatos', 'atividades', 'tarefas', 'sinais', 'oportunidades', 'comunicacoes', 'duplicatas', 'supressoes', 'historicoEstagios', 'projetos', 'pesosDecisionFit'] as const;
function permutar(r: RadarDataset, f: <T>(xs: T[]) => T[]): RadarDataset {
  const out = { ...r } as RadarDataset;
  for (const k of COLECOES) (out as unknown as Record<string, unknown[]>)[k] = f([...(r[k] as unknown[])]);
  return out;
}
const embaralhar = (seed: number) => <T,>(xs: T[]): T[] => { let s = seed; const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-A — casos da auditoria do CM0 (P1–P16)', () => {
  it('P1 empresa com supressão de empresa nunca entra na fila, mesmo com tarefa vencida', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { venceEm: '2026-09-10' })], supressoes: [{ id: 's', empresaId: 'a', tipo: 'opt_out', motivo: 'pediu', criadoPor: 'u1', criadoEm: HOJE }] });
    const q = fila(r);
    expect(q.itens).toEqual([]);
    expect(q.foraDaFila).toEqual([{ empresaId: 'a', motivo: 'EMPRESA_SUPRIMIDA' }]);
    expect(recomendarAcao(r.empresas[0], r, HOJE).estado).toBe('DO_NOT_CONTACT');
  });

  it('P2 contato que saiu da empresa nunca é recomendado: conta A vai para ENRIQUECER sem contato', () => {
    const i = item(fila(ds({ empresas: [emp('a')], contatos: [cont('c', 'a', { situacao: 'SAIU_DA_EMPRESA' })] })), 'a')!;
    expect(i.categoria).toBe('ENRIQUECER');
    expect(i.porQueAgora.codigo).toBe('SEM_DECISOR');
    expect(i.contato).toBeUndefined();
  });

  it('P3 supressão invalid_phone invalida o telefone: ENRIQUECER por falta de canal', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a', { email: undefined, telefone: '5562999999999' })], supressoes: [{ id: 's', contatoId: 'c', tipo: 'invalid_phone', motivo: 'INVALID_CONTACT', criadoPor: 'u1', criadoEm: HOJE }] });
    const i = item(fila(r), 'a')!;
    expect(i.categoria).toBe('ENRIQUECER');
    expect(i.porQueAgora.codigo).toBe('SEM_CANAL_VALIDO');
    expect(i.contato?.canais).toEqual([]);
    const c = cont('x', 'a', { telefone: '1', celular: '2' });
    expect(canaisAcionaveisCM(c, [])).toEqual(['WHATSAPP', 'PHONE', 'EMAIL']);
    expect(canaisAcionaveisCM(c, [{ id: 's', contatoId: 'x', tipo: 'email_bounced', motivo: '', criadoPor: 'u1', criadoEm: HOJE }])).toEqual(['WHATSAPP', 'PHONE']);
    expect(canaisAcionaveisCM(cont('y', 'a', { email: undefined, linkedin: 'in/y' }), [])).toEqual([]);
  });

  it('P4 pedido de orçamento não tratado continua em AGIR_AGORA depois de 5 e de 370 dias', () => {
    for (const [d, dias] of [['2026-09-10', 5], ['2025-09-10', 370]] as const) {
      const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET', ocorreuEm: ts(d), criadoEm: ts(d) })] });
      const i = item(fila(r), 'a')!;
      expect(i.categoria).toBe('AGIR_AGORA');
      expect(i.porQueAgora).toMatchObject({ codigo: 'RESPOSTA_NAO_TRATADA', dias, urgencia: dias, resultado: 'REQUESTED_BUDGET', referencia: { tipo: 'atividade', id: 'at' } });
    }
  });

  it('P5 resposta tratada por tarefa criada depois deixa de ser urgente e a conta fica AGENDADO', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_MEETING' })], tarefas: [tar('t', 'a', { tipo: 'MEETING', venceEm: '2026-09-22', criadoEm: ts('2026-09-14', '10:05') })] });
    const i = item(fila(r), 'a')!;
    expect(codigos(i)).not.toContain('RESPOSTA_NAO_TRATADA');
    expect(i.categoria).toBe('AGENDADO');
    expect(i.porQueAgora).toMatchObject({ codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-22', dias: 7 });
  });

  it('P6 NOT_INTERESTED sem fato novo não reacende a conta; sinal detectado depois reacende', () => {
    const base = { empresas: [emp('a')], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED' as const })] };
    const antes = item(fila(ds({ ...base, sinais: [sin('s', 'a', { detectadoEm: '2026-09-12' })] })), 'a')!;
    expect(antes.categoria).toBe('NURTURE');
    expect(antes.porQueAgora.codigo).toBe('RESULTADO_NEGATIVO_SEM_FATO_NOVO');
    expect(codigos(antes)).not.toContain('SINAL_ACIONAVEL_NOVO');
    const depois = item(fila(ds({ ...base, sinais: [sin('s', 'a', { detectadoEm: '2026-09-15' })] })), 'a')!;
    expect(depois.categoria).toBe('AGIR_AGORA');
    expect(depois.porQueAgora.codigo).toBe('SINAL_ACIONAVEL_NOVO');
  });

  it('P7 lacuna de dados não soma prioridade: conta B com sinal quente fica acima de conta A+ sem decisor', () => {
    const r = ds({ empresas: [emp('quente', 'B', 40), emp('lacuna', 'A+', 100)], contatos: [cont('c', 'quente')], sinais: [sin('s', 'quente')] });
    const q = fila(r);
    expect(q.itens.map((i) => [i.empresaId, i.categoria])).toEqual([['quente', 'AGIR_AGORA'], ['lacuna', 'ENRIQUECER']]);
    expect(chaveQueDecideCM(q.itens[0], q.itens[1])).toBe('degrau');
  });

  it('P8 oportunidade com tarefa aberta vinculada não gera falso "sem próxima ação" (mesma regra de semProximaAcao)', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a')], tarefas: [tar('t', 'a', { oportunidadeId: 'o', venceEm: '2026-09-25' })] });
    const i = item(fila(r), 'a')!;
    expect(semProximaAcao(r.oportunidades[0], r.tarefas)).toBe(false);
    expect(codigos(i)).not.toContain('OPORTUNIDADE_SEM_PROXIMA_ACAO');
    expect(i.categoria).toBe('AGENDADO');
  });

  it('P9 próxima ação da oportunidade vencida, sem tarefa, é detectada em AGIR_AGORA', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'PROPOSAL_SENT', proximaAcao: 'cobrar retorno', proximaAcaoEm: '2026-09-01', criadoEm: ts('2026-09-12') })] });
    const i = item(fila(r), 'a')!;
    expect(i.categoria).toBe('AGIR_AGORA');
    expect(i.porQueAgora).toMatchObject({ codigo: 'OPORTUNIDADE_ACAO_VENCIDA', venceEm: '2026-09-01', dias: 14, referencia: { tipo: 'oportunidade', id: 'o' } });
    expect(i.oportunidadeId).toBe('o');
  });

  it('P10 não existe leitura fantasma de status de entrega: metadados da comunicação não viram trava', () => {
    const c = com('m', 'a', 'c', { estado: 'APPROVED', aprovadoEm: ts('2026-09-14'), resultado: { versaoPrincipal: 't', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: { deliveryStatus: 'UNKNOWN' } } });
    const i = item(fila(ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], comunicacoes: [c] })), 'a')!;
    expect(i.porQueAgora.codigo).toBe('COMUNICACAO_APROVADA_NAO_ENVIADA');
    expect([...CODIGOS_RAZAO_CM, ...CODIGOS_TRAVA_CM].some((x) => /ENTREGA|DELIVERY/.test(x))).toBe(false);
    expect(fs.readFileSync('src/core/radar/commercialMachine.ts', 'utf8')).not.toMatch(/deliveryStatus/);
  });

  it('P11 sinal não acionável não cria urgência; sinal acionável sem decisor ideal vai para ENRIQUECER', () => {
    const noticia = item(fila(ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { tipo: 'NEWS' })] })), 'a')!;
    expect(codigos(noticia)).not.toContain('SINAL_ACIONAVEL_NOVO');
    expect(noticia.categoria).toBe('PROSPECTAR');
    const semContato = ds({ empresas: [emp('a')], sinais: [sin('s', 'a')] });
    const i = item(fila(semContato), 'a')!;
    expect(i.porQueAgora).toMatchObject({ codigo: 'SEM_DECISOR', categoria: 'ENRIQUECER', referencia: { tipo: 'sinal', id: 's' } });
    expect(recomendarAcao(semContato.empresas[0], semContato, HOJE).estado).toBe('SEARCH_DECISION_MAKER');
    const abaixo = item(fila(ds({ empresas: [emp('a')], contatos: [cont('c', 'a', { persona: 'OPERATIONS' })], sinais: [sin('s', 'a')] })), 'a')!;
    expect(abaixo.porQueAgora.codigo).toBe('SEM_DECISOR_IDEAL_PARA_SINAL');
  });

  it('P12 hoje em YYYY-MM-DD e em ISO produz exatamente a mesma fila', () => {
    const r = cenarioRico();
    const base = fila(r, '2026-09-15');
    expect(fila(r, '2026-09-15T12:00:00.000Z')).toEqual(base);
    expect(fila(r, '2026-09-15T23:59:59-03:00')).toEqual(base);
    expect(item(base, 'hoje')!.porQueAgora.codigo).toBe('PROXIMA_ACAO_HOJE');
    expect(base.geradaEm).toBe('2026-09-15');
  });

  it('P13 revisão pendente não engole ação urgente: fica como pendência secundária estruturada', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { contatoId: 'c', venceEm: '2026-09-12' })], comunicacoes: [com('m', 'a', 'c')] });
    const i = item(fila(r), 'a')!;
    expect(i.porQueAgora).toMatchObject({ codigo: 'TAREFA_VENCIDA', estado: 'PRINCIPAL', dias: 3 });
    expect(secundaria(i, 'COMUNICACAO_PARA_REVISAO')).toMatchObject({ estado: 'PENDENTE', categoria: 'REVISAR', referencia: { tipo: 'comunicacao', id: 'm' } });
  });

  it('P14 tarefa futura impede trabalho concorrente: ENRIQUECER fica adiado e a conta é AGENDADO', () => {
    const i = item(fila(ds({ empresas: [emp('a')], tarefas: [tar('t', 'a', { tipo: 'RESEARCH', venceEm: '2026-09-20' })] })), 'a')!;
    expect(i.categoria).toBe('AGENDADO');
    expect(secundaria(i, 'SEM_DECISOR')?.estado).toBe('ADIADA');
  });

  it('P15 cliente ganho sem negócio ativo vai para NURTURE como cliente', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'WON', fechadoEm: '2026-08-01' })], atividades: [atv('at', 'a', { contatoId: 'c', tipo: 'MEETING', canal: 'VISIT', resultado: 'POSITIVE', ocorreuEm: ts('2026-08-01'), criadoEm: ts('2026-08-01') })] });
    const i = item(fila(r), 'a')!;
    expect(i.categoria).toBe('NURTURE');
    expect(i.porQueAgora.codigo).toBe('CLIENTE_GANHO');
  });

  it('P16 NOTE interna depois da resposta não encobre a interação real', () => {
    const r = ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], atividades: [atv('at1', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' }), atv('at2', 'a', { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-14', '11:00'), criadoEm: ts('2026-09-14', '11:00') })] });
    const i = item(fila(r), 'a')!;
    expect(i.porQueAgora).toMatchObject({ codigo: 'RESPOSTA_NAO_TRATADA', referencia: { tipo: 'atividade', id: 'at1' } });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-A — cenário rico (regressão da taxonomia)', () => {
  it('cada situação cai na categoria e na razão esperadas', () => {
    const q = fila(cenarioRico());
    const esperado: Record<string, [string, string]> = {
      resp: ['AGIR_AGORA', 'RESPOSTA_NAO_TRATADA'], venc: ['AGIR_AGORA', 'TAREFA_VENCIDA'], sinal: ['AGIR_AGORA', 'SINAL_ACIONAVEL_NOVO'], critica: ['AGIR_AGORA', 'OPORTUNIDADE_PARADA_CRITICA'],
      oppsem: ['AVANCAR_OPORTUNIDADE', 'OPORTUNIDADE_SEM_PROXIMA_ACAO'], parada: ['AVANCAR_OPORTUNIDADE', 'OPORTUNIDADE_PARADA'],
      hoje: ['FOLLOW_UP', 'PROXIMA_ACAO_HOJE'], conflito: ['FOLLOW_UP', 'PROXIMA_ACAO_HOJE'], follow: ['FOLLOW_UP', 'FOLLOW_UP_SEM_RESPOSTA'],
      rev: ['REVISAR', 'COMUNICACAO_PARA_REVISAO'], dup1: ['REVISAR', 'TRAVA_PARA_RESOLVER'], dup2: ['REVISAR', 'INCONSISTENCIA_PARA_REVISAR'], semdono: ['REVISAR', 'INCONSISTENCIA_PARA_REVISAR'],
      aprov: ['PROSPECTAR', 'COMUNICACAO_APROVADA_NAO_ENVIADA'], prosp: ['PROSPECTAR', 'CONTA_PRIORITARIA_NUNCA_ABORDADA'],
      enriq: ['ENRIQUECER', 'SEM_DECISOR'], saiu: ['ENRIQUECER', 'SEM_DECISOR'], telinv: ['ENRIQUECER', 'SEM_CANAL_VALIDO'],
      neg: ['NURTURE', 'RESULTADO_NEGATIVO_SEM_FATO_NOVO'], lost: ['NURTURE', 'OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO'], won: ['NURTURE', 'CLIENTE_GANHO'],
      futura: ['AGENDADO', 'PROXIMA_ACAO_AGENDADA'], interv: ['AGENDADO', 'FOLLOW_UP_EM_INTERVALO'],
    };
    expect(Object.fromEntries(q.itens.map((i) => [i.empresaId, [i.categoria, i.porQueAgora.codigo]]))).toEqual(esperado);
    expect(q.foraDaFila).toEqual([{ empresaId: 'dnada', motivo: 'SEM_RELEVANCIA_ATUAL' }, { empresaId: 'inat', motivo: 'EMPRESA_INATIVA' }, { empresaId: 'merg', motivo: 'EMPRESA_MESCLADA' }, { empresaId: 'supr', motivo: 'EMPRESA_SUPRIMIDA' }]);
    expect(q.versaoRegras).toBe(VERSAO_REGRAS_CM);
    expect(Object.values(q.porCategoria).reduce((a, b) => a + b, 0)).toBe(q.itens.length);
    expect(q.itens.map((i) => i.posicao)).toEqual(q.itens.map((_, k) => k + 1));
  });

  it('a fila respeita a escada: degrau nunca diminui ao descer a lista', () => {
    const q = fila(cenarioRico());
    for (let k = 1; k < q.itens.length; k++) expect(compararItensCM(q.itens[k - 1], q.itens[k])).toBeLessThan(0);
    for (let k = 1; k < q.itens.length; k++) expect(q.itens[k].ordem.degrau).toBeGreaterThanOrEqual(q.itens[k - 1].ordem.degrau);
    for (const i of q.itens) if (i.porQueAgora.codigo !== 'TRAVA_PARA_RESOLVER') expect(i.ordem.degrau).toBe(DEGRAU_CATEGORIA[i.categoria]);
  });

  it('duplicata pendente segura a prospecção no mesmo degrau da ação bloqueada e fica visível na outra conta', () => {
    const q = fila(cenarioRico());
    const d1 = item(q, 'dup1')!;
    expect(d1.porQueAgora).toMatchObject({ categoria: 'REVISAR', trava: 'DUPLICATA_PENDENTE', acaoBloqueada: 'CONTA_PRIORITARIA_NUNCA_ABORDADA', degrau: DEGRAU_CATEGORIA.PROSPECTAR, referencia: { tipo: 'duplicata', id: 'd1' } });
    expect(secundaria(d1, 'CONTA_PRIORITARIA_NUNCA_ABORDADA')).toMatchObject({ estado: 'BLOQUEADA', bloqueadaPor: ['DUPLICATA_PENDENTE'] });
    expect(d1.travas).toEqual([{ codigo: 'DUPLICATA_PENDENTE', bloqueante: true, referencia: { tipo: 'duplicata', id: 'd1' }, bloqueia: ['CONTA_PRIORITARIA_NUNCA_ABORDADA'] }]);
    expect(item(q, 'dup2')!.porQueAgora).toMatchObject({ trava: 'DUPLICATA_PENDENTE', degrau: DEGRAU_CATEGORIA.REVISAR });
  });

  it('conflito entre tarefa e abordagem e oportunidade sem responsável aparecem como travas não bloqueantes', () => {
    const q = fila(cenarioRico());
    expect(item(q, 'conflito')!.travas).toEqual([{ codigo: 'CONFLITO_TAREFA_COMUNICACAO', bloqueante: false, referencia: { tipo: 'comunicacao', id: 'm-conf' }, relacionada: { tipo: 'tarefa', id: 't-conf' }, bloqueia: [] }]);
    expect(item(q, 'semdono')!.travas.map((t) => t.codigo)).toEqual(['OPORTUNIDADE_SEM_RESPONSAVEL']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-A — invariantes', () => {
  it('permutação de empresas, contatos, atividades, tarefas, sinais e oportunidades não muda a fila', () => {
    const r = cenarioRico();
    const base = fila(r);
    const variantes = [(xs: unknown[]) => xs.reverse(), (xs: unknown[]) => [...xs.slice(3), ...xs.slice(0, 3)], embaralhar(7), embaralhar(42), embaralhar(2026)];
    for (const v of variantes) expect(fila(permutar(r, v as <T>(xs: T[]) => T[]))).toEqual(base);
    // empate total de contatos (mesmo fit, canal e qualidade) tambem nao depende da ordem
    const empate = ds({ empresas: [emp('a')], contatos: [cont('c2', 'a'), cont('c1', 'a')] });
    expect(item(fila(empate), 'a')!.contato?.id).toBe(item(fila(permutar(empate, (xs) => xs.reverse())), 'a')!.contato?.id);
  });

  it('entrada congelada em profundidade: nada é mutado e o resultado é o mesmo', () => {
    const livre = fila(cenarioRico());
    const congelado = deepFreeze(cenarioRico());
    expect(() => fila(congelado)).not.toThrow();
    expect(fila(congelado)).toEqual(livre);
  });

  it('duas execuções sucessivas produzem resultado idêntico', () => {
    const r = cenarioRico();
    expect(JSON.stringify(fila(r))).toBe(JSON.stringify(fila(r)));
  });

  it('empresa suprimida nunca aparece, qualquer que seja a situação dela', () => {
    const r = cenarioRico();
    for (const e of r.empresas) {
      const sup = { ...r, supressoes: [...r.supressoes, { id: `x-${e.id}`, empresaId: e.id, tipo: 'opt_out' as const, motivo: 'teste', criadoPor: 'u1', criadoEm: HOJE }] };
      expect(item(fila(sup), e.id)).toBeUndefined();
    }
  });

  it('contato indicado no item é sempre elegível e da própria empresa', () => {
    const r = cenarioRico();
    for (const i of fila(r).itens) {
      if (!i.contato) continue;
      const c = r.contatos.find((x) => x.id === i.contato!.id)!;
      expect(c.empresaId).toBe(i.empresaId);
      expect(contatoElegivel(c, r.supressoes)).toBe(true);
    }
  });

  it('contato que saiu da empresa nunca é indicado, nem como contato da tarefa', () => {
    const r = cenarioRico();
    const saiu = { ...r, contatos: r.contatos.map((c) => ({ ...c, situacao: 'SAIU_DA_EMPRESA' as const })) };
    const q = fila(saiu);
    expect(q.itens.filter((i) => i.contato)).toEqual([]);
    expect(item(q, 'venc')!.porQueAgora).toMatchObject({ codigo: 'TRAVA_PARA_RESOLVER', trava: 'CONTATO_INELEGIVEL', acaoBloqueada: 'TAREFA_VENCIDA', degrau: 1 });
  });

  it('tarefa futura impede criar prospecção, enriquecimento e follow-up concorrentes', () => {
    const r = ds({ empresas: [emp('a', 'A+')], contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { venceEm: '2026-09-18' })] });
    const i = item(fila(r), 'a')!;
    expect(i.categoria).toBe('AGENDADO');
    expect(secundaria(i, 'CONTA_PRIORITARIA_NUNCA_ABORDADA')?.estado).toBe('ADIADA');
    const f = ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-01'), criadoEm: ts('2026-09-01') })], tarefas: [tar('t', 'a', { venceEm: '2026-09-18' })] });
    expect(secundaria(item(fila(f), 'a'), 'FOLLOW_UP_SEM_RESPOSTA')?.estado).toBe('ADIADA');
  });

  it('resposta tratada deixa de ser urgente por tarefa, mudança de estágio, nova oportunidade ou nova abordagem', () => {
    const base = { empresas: [emp('a')], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'ACTIVE_PROJECT' as const })] };
    const depois = ts('2026-09-14', '12:00');
    const tratamentos: Partial<RadarDataset>[] = [
      { tarefas: [tar('t', 'a', { status: 'Concluída', criadoEm: depois })] },
      { oportunidades: [opp('o', 'a', { criadoEm: ts('2026-09-01'), proximaAcaoEm: '2026-09-20' })], historicoEstagios: [{ id: 'h', oportunidadeId: 'o', de: 'CONTACT_STARTED', para: 'ENGAGED', usuarioId: 'u1', em: depois }] },
      { oportunidades: [opp('o', 'a', { criadoEm: depois, proximaAcaoEm: '2026-09-20' })] },
      { comunicacoes: [com('m', 'a', 'c', { criadoEm: depois })] },
    ];
    expect(item(fila(ds(base)), 'a')!.porQueAgora.codigo).toBe('RESPOSTA_NAO_TRATADA');
    for (const t of tratamentos) expect(codigos(item(fila(ds({ ...base, ...t })), 'a'))).not.toContain('RESPOSTA_NAO_TRATADA');
    // tarefa cancelada ou anterior a resposta nao trata
    expect(item(fila(ds({ ...base, tarefas: [tar('t', 'a', { status: 'Cancelada', criadoEm: depois }), tar('t0', 'a', { status: 'Concluída', criadoEm: ts('2026-09-13') })] })), 'a')!.porQueAgora.codigo).toBe('RESPOSTA_NAO_TRATADA');
  });

  it('todo resultado negativo sem fato novo mantém a conta em NURTURE, mesmo com sinal anterior', () => {
    const negativos = CODIGOS_RESPOSTA.filter((c) => c !== 'INVALID_CONTACT' && !TRANSICOES_RESULTADO[c].comunicar);
    expect(negativos.length).toBeGreaterThan(3);
    for (const resultado of negativos) {
      const i = item(fila(ds({ empresas: [emp('a', 'A+')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { detectadoEm: '2026-09-13' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado, ocorreuEm: ts('2026-09-14') })] })), 'a')!;
      expect([resultado, i.categoria, i.porQueAgora.codigo]).toEqual([resultado, 'NURTURE', 'RESULTADO_NEGATIVO_SEM_FATO_NOVO']);
    }
    const perdida = item(fila(ds({ empresas: [emp('a', 'A+')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'LOST', fechadoEm: '2026-09-01' })], sinais: [sin('s', 'a', { detectadoEm: '2026-08-30' })] })), 'a')!;
    expect(perdida.porQueAgora.codigo).toBe('OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO');
    // perda registrada depois de um sinal ainda "novo" e sem atividade: o sinal nao reacende a conta
    const perdidaComSinalNovo = item(fila(ds({ empresas: [emp('a', 'A+')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'LOST', fechadoEm: '2026-09-13' })], sinais: [sin('s', 'a', { detectadoEm: '2026-09-12' })] })), 'a')!;
    expect([perdidaComSinalNovo.categoria, perdidaComSinalNovo.porQueAgora.codigo]).toEqual(['NURTURE', 'OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO']);
    expect(codigos(perdidaComSinalNovo)).not.toContain('SINAL_ACIONAVEL_NOVO');
  });

  it('sinal fora da janela da família (ou antigo na detecção) não cria urgência', () => {
    const fora = item(fila(ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { eventoEm: '2024-09-01', detectadoEm: '2026-09-14' })] })), 'a')!;
    expect(codigos(fora)).not.toContain('SINAL_ACIONAVEL_NOVO');
    expect(fora.categoria).toBe('NURTURE');
    const velho = item(fila(ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { eventoEm: '2026-08-01', detectadoEm: '2026-08-10' })] })), 'a')!;
    expect(codigos(velho)).not.toContain('SINAL_ACIONAVEL_NOVO');
    const naoVerificado = item(fila(ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { verificado: false })] })), 'a')!;
    expect(naoVerificado.porQueAgora.codigo).toBe('SINAL_NAO_VERIFICADO');
  });

  it('oportunidade: parada respeita o SLA do estágio pelo último movimento real, não pela edição', () => {
    const parada = (p: Partial<RadarDataset>) => item(fila(ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], ...p })), 'a')!;
    const editada = parada({ oportunidades: [opp('o', 'a', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-07'), atualizadoEm: ts('2026-09-15'), proximaAcaoEm: '2026-09-25' })] });
    expect(editada.porQueAgora).toMatchObject({ codigo: 'OPORTUNIDADE_PARADA', dias: 8, urgencia: 3 });
    const moveu = parada({ oportunidades: [opp('o', 'a', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-07'), proximaAcaoEm: '2026-09-25' })], historicoEstagios: [{ id: 'h', oportunidadeId: 'o', para: 'PROPOSAL_SENT', usuarioId: 'u1', em: ts('2026-09-13') }] });
    expect(codigos(moveu)).not.toContain('OPORTUNIDADE_PARADA');
    const falou = parada({ oportunidades: [opp('o', 'a', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-07'), proximaAcaoEm: '2026-09-25' })], atividades: [atv('at', 'a', { oportunidadeId: 'o', contatoId: 'c', resultado: 'CALL_BACK', ocorreuEm: ts('2026-09-13'), criadoEm: ts('2026-09-13') })], tarefas: [tar('t', 'a', { criadoEm: ts('2026-09-13', '11:00'), venceEm: '2026-09-25' })] });
    expect(codigos(falou)).not.toContain('OPORTUNIDADE_PARADA');
    expect(HIPOTESE_COMMERCIAL_MACHINE.slaEstagioDias.PROPOSAL_SENT).toBe(5);
  });

  it('múltiplas oportunidades: a mais urgente é a principal e as demais ficam como pendências', () => {
    const r = ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], oportunidades: [opp('o1', 'a', { estagio: 'QUALIFIED' }), opp('o2', 'a', { estagio: 'PRICING', proximaAcaoEm: '2026-09-10', proximaAcao: 'enviar preço' })] });
    const i = item(fila(r), 'a')!;
    expect(i.porQueAgora).toMatchObject({ codigo: 'OPORTUNIDADE_ACAO_VENCIDA', referencia: { id: 'o2' } });
    expect(secundaria(i, 'OPORTUNIDADE_SEM_PROXIMA_ACAO')?.referencia?.id).toBe('o1');
    expect(i.oportunidadeId).toBe('o2');
  });

  it('adicionar lacuna de dados nunca melhora a posição da conta', () => {
    const r = cenarioRico();
    const antes = fila(r);
    const lacunas: [string, (x: RadarDataset, id: string) => RadarDataset][] = [
      ['sem canais', (x, id) => ({ ...x, contatos: x.contatos.map((c) => (c.empresaId === id ? { ...c, email: undefined, telefone: undefined, celular: undefined, whatsapp: undefined } : c)) })],
      ['sem contatos', (x, id) => ({ ...x, contatos: x.contatos.filter((c) => c.empresaId !== id) })],
      ['status inválido', (x, id) => ({ ...x, contatos: x.contatos.map((c) => (c.empresaId === id ? { ...c, statusEmail: 'invalido' as const, statusTelefone: 'invalido' as const } : c)) })],
      ['sinais não verificados', (x, id) => ({ ...x, sinais: x.sinais.map((s) => (s.empresaId === id ? { ...s, verificado: false } : s)) })],
      ['sem valor estimado', (x, id) => ({ ...x, oportunidades: x.oportunidades.map((o) => (o.empresaId === id ? { ...o, valorEstimado: undefined } : o)) })],
      ['sem persona', (x, id) => ({ ...x, contatos: x.contatos.map((c) => (c.empresaId === id ? { ...c, persona: undefined } : c)) })],
    ];
    for (const e of r.empresas) {
      const i0 = item(antes, e.id);
      if (!i0) continue;
      for (const [nome, lacuna] of lacunas) {
        const depois = fila(lacuna(r, e.id));
        const i1 = item(depois, e.id);
        if (i1) expect([e.id, nome, compararItensCM(i1, i0) >= 0]).toEqual([e.id, nome, true]);
        const naFrenteAntes = antes.itens.filter((x) => compararItensCM(x, i0) < 0).map((x) => x.empresaId);
        const naFrenteDepois = i1 ? depois.itens.filter((x) => compararItensCM(x, i1) < 0).map((x) => x.empresaId) : depois.itens.map((x) => x.empresaId);
        expect([e.id, nome, naFrenteAntes.every((id) => naFrenteDepois.includes(id))]).toEqual([e.id, nome, true]);
      }
    }
  });

  it('todo código de categoria, razão, trava e fora da fila tem texto pt-BR', () => {
    for (const c of CATEGORIAS_COMMERCIAL_QUEUE) expect(NOME_CATEGORIA_CM[c]?.trim()).toBeTruthy();
    for (const c of CODIGOS_RAZAO_CM) expect(TEXTO_RAZAO_CM[c]?.trim()).toBeTruthy();
    for (const c of CODIGOS_TRAVA_CM) expect(TEXTO_TRAVA_CM[c]?.trim()).toBeTruthy();
    for (const c of MOTIVOS_FORA_DA_FILA) expect(TEXTO_FORA_DA_FILA[c]?.trim()).toBeTruthy();
    expect(Object.keys(TEXTO_RAZAO_CM).sort()).toEqual([...CODIGOS_RAZAO_CM].sort());
    expect(CHAVES_ORDEM_CM[CHAVES_ORDEM_CM.length - 1]).toBe('empresaId');
  });

  it('toda referência apontada pelo item existe no dataset e pertence à conta', () => {
    const variantes = [cenarioRico(), (() => { const r = cenarioRico(); return { ...r, contatos: r.contatos.filter((c) => c.empresaId !== 'venc' && c.empresaId !== 'resp') }; })()];
    for (const r of variantes) {
      const existe: Record<string, (id: string, empresaId: string) => boolean> = {
        empresa: (id, e) => id === e && r.empresas.some((x) => x.id === id),
        contato: (id, e) => r.contatos.some((x) => x.id === id && x.empresaId === e),
        tarefa: (id, e) => r.tarefas.some((x) => x.id === id && x.empresaId === e),
        atividade: (id, e) => r.atividades.some((x) => x.id === id && x.empresaId === e),
        oportunidade: (id, e) => r.oportunidades.some((x) => x.id === id && x.empresaId === e),
        sinal: (id, e) => r.sinais.some((x) => x.id === id && x.empresaId === e),
        comunicacao: (id, e) => r.comunicacoes.some((x) => x.id === id && x.empresaId === e),
        duplicata: (id, e) => r.duplicatas.some((x) => x.id === id && (x.empresaId === e || x.candidataId === e)),
      };
      for (const i of fila(r).itens) {
        const razoes = [i.porQueAgora, ...i.secundarias];
        for (const z of razoes) {
          if (z.referencia) expect([i.empresaId, z.codigo, existe[z.referencia.tipo](z.referencia.id, i.empresaId)]).toEqual([i.empresaId, z.codigo, true]);
          if (z.contatoId) expect([i.empresaId, z.codigo, existe.contato(z.contatoId, i.empresaId)]).toEqual([i.empresaId, z.codigo, true]);
        }
        for (const t of i.travas) {
          expect(existe[t.referencia.tipo](t.referencia.id, i.empresaId)).toBe(true);
          if (t.relacionada) expect(existe[t.relacionada.tipo](t.relacionada.id, i.empresaId)).toBe(true);
          if (t.contatoId) expect(r.contatos.some((c) => c.id === t.contatoId)).toBe(true);
        }
        if (i.contato) expect(existe.contato(i.contato.id, i.empresaId)).toBe(true);
        if (i.oportunidadeId) expect(existe.oportunidade(i.oportunidadeId, i.empresaId)).toBe(true);
        if (i.sinalId) expect(existe.sinal(i.sinalId, i.empresaId)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-A — ordenação sem score paralelo', () => {
  it('priorityScore só desempata dentro do mesmo degrau, tier e urgência', () => {
    const r = ds({ empresas: [emp('baixo', 'A', 71), emp('alto', 'A', 79), emp('topo', 'A+', 99)], contatos: [cont('c1', 'baixo'), cont('c2', 'alto')], tarefas: [tar('t1', 'baixo', { venceEm: '2026-09-12' }), tar('t2', 'alto', { venceEm: '2026-09-12' })] });
    const q = fila(r);
    expect(q.itens.map((i) => i.empresaId)).toEqual(['alto', 'baixo', 'topo']);
    expect(chaveQueDecideCM(q.itens[0], q.itens[1])).toBe('priorityScore');
    expect(chaveQueDecideCM(q.itens[1], q.itens[2])).toBe('degrau');
  });

  it('pendências extras não somam: conta com mais razões não passa conta com ação principal mais urgente', () => {
    const r = ds({
      empresas: [emp('muitas', 'A+', 95), emp('uma', 'C', 30)], contatos: [cont('c1', 'muitas'), cont('c2', 'uma')],
      tarefas: [tar('t1', 'muitas', { contatoId: 'c1', venceEm: '2026-09-14' }), tar('t2', 'uma', { contatoId: 'c2', venceEm: '2026-09-05' })],
      oportunidades: [opp('o1', 'muitas', { estagio: 'QUALIFIED', criadoEm: ts('2026-08-01'), valorEstimado: 9_000_000 })],
      comunicacoes: [com('m1', 'muitas', 'c1')], sinais: [sin('s1', 'muitas', { verificado: false })],
    });
    const q = fila(r);
    expect(item(q, 'muitas')!.secundarias.length).toBeGreaterThan(2);
    expect(q.itens.map((i) => i.empresaId)).toEqual(['uma', 'muitas']);
    expect(chaveQueDecideCM(q.itens[0], q.itens[1])).toBe('urgencia');
  });

  it('follow-up: espera o intervalo, depois vira FOLLOW_UP e para no limite de tentativas', () => {
    const tentativa = (id: string, d: string) => atv(id, 'a', { contatoId: 'c', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: ts(d), criadoEm: ts(d) });
    const q = (as: Atividade[]) => item(fila(ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], atividades: as })), 'a')!;
    expect(q([tentativa('a1', '2026-09-13')]).porQueAgora).toMatchObject({ codigo: 'FOLLOW_UP_EM_INTERVALO', categoria: 'AGENDADO', venceEm: '2026-09-17', dias: 2 });
    expect(q([tentativa('a1', '2026-09-10')]).porQueAgora).toMatchObject({ codigo: 'FOLLOW_UP_SEM_RESPOSTA', categoria: 'FOLLOW_UP', contatoId: 'c', dias: 5 });
    expect(q(['2026-08-01', '2026-08-05', '2026-08-10', '2026-08-15', '2026-08-20'].map((d, k) => tentativa(`a${k}`, d))).porQueAgora.codigo).toBe('TENTATIVAS_ESGOTADAS');
  });

  it('contato inválido na última tentativa: segue pelo canal válido restante ou vai para ENRIQUECER', () => {
    const invalido = (p: Partial<Contato>) => item(fila(ds({
      empresas: [emp('a', 'B')], contatos: [cont('c', 'a', { telefone: '5562999999999', ...p })],
      atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'INVALID_CONTACT' })],
      supressoes: [{ id: 'sp', contatoId: 'c', tipo: 'invalid_phone', motivo: 'Resultado INVALID_CONTACT na atividade', criadoPor: 'u1', criadoEm: HOJE }],
    })), 'a')!;
    expect(invalido({}).porQueAgora).toMatchObject({ codigo: 'TENTATIVA_CONTATO_INVALIDO', categoria: 'FOLLOW_UP', contatoId: 'c' });
    expect(invalido({}).contato?.canais).toEqual(['EMAIL']);
    expect(invalido({ email: undefined }).porQueAgora).toMatchObject({ codigo: 'SEM_CANAL_VALIDO', categoria: 'ENRIQUECER' });
  });

  it('responsável vem da ação principal; oportunidade sem responsável válido vira trava com a lista de usuários', () => {
    const r = ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { responsavelId: 'u9', venceEm: '2026-09-13' })], oportunidades: [opp('o', 'a', { responsavelId: 'u-antigo', proximaAcaoEm: '2026-09-20' })] });
    const i = item(fila(r, HOJE, { usuariosValidos: ['u1', 'u9'] }), 'a')!;
    expect([i.responsavelId, i.origemResponsavel]).toEqual(['u9', 'TAREFA']);
    expect(i.travas.map((t) => t.codigo)).toEqual(['OPORTUNIDADE_SEM_RESPONSAVEL']);
    expect(item(fila(r), 'a')!.travas).toEqual([]);
  });

  it('data de referência inválida é recusada', () => {
    for (const d of ['nao-e-data', '', '2026-02-30', '2026-13-01']) expect(() => fila(ds({}), d)).toThrow('commercial_queue_data_invalida');
    expect(normalizarHojeCM('2026-09-15T08:00:00Z')).toBe('2026-09-15');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-A — divergências conhecidas com pipeline.recomendarAcao (pipeline.ts intocado nesta fase)', () => {
  // Cada caso documenta onde a fila decide diferente do recomendarAcao atual e por quê. Se o pipeline for corrigido
  // numa frente propria, este bloco deve falhar e ser revisado junto.
  const r1 = (p: Partial<RadarDataset>) => ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], ...p });
  const casos: { nome: string; r: RadarDataset; pipeline: string; fila: [string, string] }[] = [
    { nome: 'D1 resposta não tratada vs próxima ação planejada da oportunidade', r: r1({ oportunidades: [opp('o', 'a', { criadoEm: ts('2026-09-01'), proximaAcao: 'visita', proximaAcaoEm: '2026-09-20' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' })] }), pipeline: 'PLANNED_ACTION', fila: ['AGIR_AGORA', 'RESPOSTA_NAO_TRATADA'] },
    { nome: 'D2 NOTE depois da resposta', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at1', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' }), atv('at2', 'a', { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-14', '11:00') })] }), pipeline: 'OPEN_OPPORTUNITY', fila: ['AGIR_AGORA', 'RESPOSTA_NAO_TRATADA'] },
    { nome: 'D3 resultado negativo com sinal acionável anterior', r: r1({ sinais: [sin('s', 'a', { detectadoEm: '2026-09-12' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED' })] }), pipeline: 'CONTACT_NOW', fila: ['NURTURE', 'RESULTADO_NEGATIVO_SEM_FATO_NOVO'] },
    { nome: 'D4 telefone com supressão invalid_phone', r: ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a', { email: undefined, telefone: '5562999999999' })], sinais: [sin('s', 'a')], supressoes: [{ id: 'sp', contatoId: 'c', tipo: 'invalid_phone', motivo: 'INVALID_CONTACT', criadoPor: 'u1', criadoEm: HOJE }] }), pipeline: 'CONTACT_NOW', fila: ['ENRIQUECER', 'SEM_CANAL_VALIDO'] },
    { nome: 'D5 resposta já tratada por tarefa futura', r: r1({ atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_MEETING' })], tarefas: [tar('t', 'a', { venceEm: '2026-09-22', criadoEm: ts('2026-09-14', '10:05') })] }), pipeline: 'RESPOND', fila: ['AGENDADO', 'PROXIMA_ACAO_AGENDADA'] },
    { nome: 'D6 próxima ação da oportunidade vencida sem tarefa', r: r1({ oportunidades: [opp('o', 'a', { proximaAcao: 'ligar', proximaAcaoEm: '2026-09-05' })] }), pipeline: 'PLANNED_ACTION', fila: ['AGIR_AGORA', 'OPORTUNIDADE_ACAO_VENCIDA'] },
    { nome: 'D7 sem resposta ontem: a fila respeita o intervalo', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NO_RESPONSE' })] }), pipeline: 'CONTACT_NOW', fila: ['AGENDADO', 'FOLLOW_UP_EM_INTERVALO'] },
    { nome: 'D8 NOT_INTERESTED há 20 dias sem fato novo', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-08-26'), criadoEm: ts('2026-08-26') })] }), pipeline: 'FOLLOW_UP', fila: ['NURTURE', 'RESULTADO_NEGATIVO_SEM_FATO_NOVO'] },
    { nome: 'D9 sinal acionável detectado há 30 dias em conta B nunca abordada', r: r1({ sinais: [sin('s', 'a', { eventoEm: '2026-08-10', detectadoEm: '2026-08-16' })] }), pipeline: 'CONTACT_NOW', fila: ['NURTURE', 'SEM_TIMING_ATUAL'] },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      expect(recomendarAcao(c.r.empresas[0], c.r, HOJE).estado).toBe(c.pipeline);
      const i = item(fila(c.r), 'a')!;
      expect([i.categoria, i.porQueAgora.codigo]).toEqual(c.fila);
    });
  }

  it('concordâncias que a fila preserva', () => {
    const acoes = (r: RadarDataset) => [recomendarAcao(r.empresas[0], r, HOJE).estado, item(fila(r), 'a')?.categoria, item(fila(r), 'a')?.porQueAgora.codigo];
    expect(acoes(ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { contatoId: 'c', venceEm: '2026-09-10' })] }))).toEqual(['OVERDUE_TASK', 'AGIR_AGORA', 'TAREFA_VENCIDA']);
    expect(acoes(ds({ empresas: [emp('a')], contatos: [cont('c', 'a', { persona: 'OPERATIONS' })], sinais: [sin('s', 'a')] }))).toEqual(['SEARCH_DECISION_MAKER', 'ENRIQUECER', 'SEM_DECISOR_IDEAL_PARA_SINAL']);
    expect(acoes(ds({ empresas: [emp('a')], contatos: [cont('c', 'a', { email: undefined })], sinais: [sin('s', 'a')] }))).toEqual(['ENRICH_CONTACT', 'ENRIQUECER', 'SEM_CANAL_VALIDO']);
    expect(acoes(ds({ empresas: [emp('a')], contatos: [cont('c', 'a')], sinais: [sin('s', 'a')] }))).toEqual(['CONTACT_NOW', 'AGIR_AGORA', 'SINAL_ACIONAVEL_NOVO']);
    const sem = ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'QUALIFIED' })] });
    expect([semProximaAcao(sem.oportunidades[0], sem.tarefas), item(fila(sem), 'a')!.porQueAgora.codigo]).toEqual([true, 'OPORTUNIDADE_SEM_PROXIMA_ACAO']);
  });
});

describe('CM1-A — guarda de fronteira do motor', () => {
  it('motor puro: sem store, React, rede, módulos de servidor, Central, data do relógio ou envio', () => {
    const src = fs.readFileSync('src/core/radar/commercialMachine.ts', 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./comunicacao', './contatos', './pipeline', './score', './sinalLeitura', './types']);
    expect(src).not.toMatch(/Date\.now|new Date\(\)|fetch\(|sendApproved|localeCompare|Math\.random/);
  });
});
