import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_BLOQUEIO_PLANO_CM, MODOS_PLANO_CM, MOTIVOS_MODO_PLANO_CM, TEXTO_BLOQUEIO_PLANO_CM, TEXTO_MOTIVO_MODO_CM, VERSAO_REGRAS_PLANO_CM,
  canaisDaPoliticaCM, itemIdCM, planoDeAcaoCM, planosDaFilaCM, resumoPorModoCM, type CommercialActionPlan,
} from './commercialActionPlan';
import { VERSAO_REGRAS_CM, canaisAcionaveisCM, construirCommercialQueue, type CommercialQueue } from './commercialMachine';
import { OBJETIVOS, OBJETIVOS_COMUNICACAO, PLAYBOOKS_CODIGOS, TRANSICOES_RESULTADO, contextoComunicacaoDe, recomendarCanal, historicoDe } from './comunicacao';
import { contatoElegivel } from './contatos';
import { recomendarAcao } from './pipeline';
import { radarVazio, type Atividade, type ComunicacaoRadar, type Contato, type Empresa, type Oportunidade, type RadarDataset, type Sinal, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures (ficticias; mesmas convencoes do teste do CM1-A)
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const PESOS = [
  { chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 },
  { chave: 'persona.CEO.media', valor: 85 }, { chave: 'persona.ENGINEERING.media', valor: 80 }, { chave: 'persona.OPERATIONS.media', valor: 55 }, { chave: 'persona.PROCUREMENT.media', valor: 30 },
];
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
const emp = (id: string, priorityClass: Empresa['priorityClass'] = 'A', priorityScore = 75, p: Partial<Empresa> = {}): Empresa => ({ id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore, priorityClass, ...p });
const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({ id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO', email: `${id}@conta-${empresaId}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p });
const sin = (id: string, empresaId: string, p: Partial<Sinal> = {}): Sinal => ({ id, empresaId, fonteId: 'f-news', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade', descricao: 'Nova unidade anunciada', eventoEm: '2026-09-10', detectadoEm: '2026-09-12', confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-12'), ...p });
const atv = (id: string, empresaId: string, p: Partial<Atividade> = {}): Atividade => ({ id, empresaId, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts('2026-09-14'), notas: '', criadoEm: ts('2026-09-14'), ...p });
const tar = (id: string, empresaId: string, p: Partial<TarefaRadar> = {}): TarefaRadar => ({ id, empresaId, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: HOJE, status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-10', '09:00'), ...p });
const opp = (id: string, empresaId: string, p: Partial<Oportunidade> = {}): Oportunidade => ({ id, empresaId, titulo: `Galpão ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: ts('2026-09-12'), atualizadoEm: ts('2026-09-12'), ...p });
const com = (id: string, empresaId: string, contatoId: string, p: Partial<ComunicacaoRadar> = {}): ComunicacaoRadar => ({
  id, empresaId, contatoId, canal: 'EMAIL', objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', estado: 'READY_FOR_REVIEW', spec: {},
  resultado: { versaoPrincipal: 'texto', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: `h-${id}`,
  versoes: { playbook: '1', contentSpec: '3', prompt: '1', provedor: 'deterministico' }, validacao: { ok: true, problemas: [] }, criadoEm: ts('2026-09-13'), atualizadoEm: ts('2026-09-13'), criadoPor: 'u1', historico: [], ...p,
});
const supr = (id: string, p: { contatoId?: string; empresaId?: string; tipo: 'do_not_contact' | 'opt_out' | 'invalid_phone' | 'email_bounced' }) => ({ id, motivo: 'teste', criadoPor: 'u1', criadoEm: ts('2026-09-01'), ...p });
const ds = (p: Partial<RadarDataset>): RadarDataset => ({ ...radarVazio(), pesosDecisionFit: PESOS, ...p });
const fila = (r: RadarDataset) => construirCommercialQueue(r, HOJE);
const plano = (r: RadarDataset, empresaId = 'a'): CommercialActionPlan => { const i = fila(r).itens.find((x) => x.empresaId === empresaId); if (!i) throw new Error(`sem item ${empresaId}`); return planoDeAcaoCM(r, i); };
const umaConta = (p: Partial<RadarDataset>, classe: Empresa['priorityClass'] = 'A') => ds({ empresas: [emp('a', classe)], ...p });

function cenarioRico(): RadarDataset {
  return ds({
    empresas: [
      emp('resp', 'A', 80), emp('venc', 'B', 60), emp('sinal', 'B', 55), emp('oppsem', 'B', 50), emp('parada', 'A', 72), emp('critica', 'B', 48), emp('hoje', 'B', 58),
      emp('aprov', 'A', 70), emp('follow', 'B', 52), emp('interv', 'B', 51), emp('rev', 'C', 35), emp('dup1', 'A', 75), emp('dup2', 'B', 45), emp('prosp', 'A+', 90),
      emp('enriq', 'A', 71), emp('neg', 'A', 74), emp('lost', 'B', 50), emp('won', 'B', 50), emp('futura', 'A', 73), emp('saiu', 'A', 76), emp('telinv', 'A', 77),
      emp('conflito', 'B', 49), emp('semdono', 'B', 50), emp('supr', 'A', 95), emp('dnada', 'D', 10), emp('interna', 'B', 57),
    ],
    contatos: [
      cont('c-resp', 'resp'), cont('c-venc', 'venc'), cont('c-sinal', 'sinal'), cont('c-oppsem', 'oppsem'), cont('c-parada', 'parada'), cont('c-hoje', 'hoje'), cont('c-aprov', 'aprov'),
      cont('c-follow', 'follow', { whatsapp: '5562999990002' }), cont('c-interv', 'interv'), cont('c-rev', 'rev'), cont('c-dup1', 'dup1'), cont('c-prosp', 'prosp', { whatsapp: '5562999990000' }), cont('c-neg', 'neg'),
      cont('c-saiu', 'saiu', { situacao: 'SAIU_DA_EMPRESA' }), cont('c-telinv', 'telinv', { email: undefined, telefone: '5562999990001' }),
      cont('c-conf1', 'conflito'), cont('c-conf2', 'conflito', { persona: 'OPERATIONS' }), cont('c-supr', 'supr'), cont('c-interna', 'interna'),
    ],
    sinais: [sin('s-sinal', 'sinal', { detectadoEm: '2026-09-13' }), sin('s-neg', 'neg', { detectadoEm: '2026-08-20', eventoEm: '2026-08-18' })],
    atividades: [
      atv('a-resp', 'resp', { contatoId: 'c-resp', resultado: 'REQUESTED_MEETING', ocorreuEm: ts('2026-09-12'), criadoEm: ts('2026-09-12') }),
      atv('a-follow', 'follow', { contatoId: 'c-follow', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-08'), criadoEm: ts('2026-09-08') }),
      atv('a-interv', 'interv', { contatoId: 'c-interv', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-13'), criadoEm: ts('2026-09-13') }),
      atv('a-neg', 'neg', { contatoId: 'c-neg', resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-09-01'), criadoEm: ts('2026-09-01') }),
      atv('a-nota', 'resp', { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-13'), criadoEm: ts('2026-09-13') }),
    ],
    tarefas: [
      tar('t-venc', 'venc', { contatoId: 'c-venc', venceEm: '2026-09-11' }), tar('t-parada', 'parada', { oportunidadeId: 'o-parada', venceEm: '2026-09-20' }),
      tar('t-critica', 'critica', { oportunidadeId: 'o-critica', venceEm: '2026-09-30' }), tar('t-hoje', 'hoje'),
      tar('t-futura', 'futura', { tipo: 'CALL', venceEm: '2026-09-20' }), tar('t-conf', 'conflito', { contatoId: 'c-conf1' }), tar('t-interna', 'interna', { tipo: 'RESEARCH', venceEm: '2026-09-09' }),
    ],
    oportunidades: [
      opp('o-oppsem', 'oppsem', { estagio: 'QUALIFIED' }), opp('o-parada', 'parada', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-08'), valorEstimado: 500_000 }),
      opp('o-critica', 'critica', { estagio: 'NEGOTIATION', criadoEm: ts('2026-08-20') }),
      opp('o-lost', 'lost', { estagio: 'LOST', fechadoEm: '2026-08-15' }), opp('o-won', 'won', { estagio: 'WON', fechadoEm: '2026-08-10' }),
      opp('o-semdono', 'semdono', { responsavelId: '', proximaAcao: 'retomar', proximaAcaoEm: '2026-09-25' }),
    ],
    comunicacoes: [com('m-aprov', 'aprov', 'c-aprov', { estado: 'APPROVED', aprovadoEm: ts('2026-09-14') }), com('m-rev', 'rev', 'c-rev'), com('m-conf', 'conflito', 'c-conf2')],
    duplicatas: [{ id: 'd1', empresaId: 'dup2', candidataId: 'dup1', confianca: 0.7, motivo: 'mesmo domínio', status: 'pendente', criadoEm: ts('2026-09-10') }],
    supressoes: [supr('sp-supr', { empresaId: 'supr', tipo: 'do_not_contact' }), supr('sp-tel', { contatoId: 'c-telinv', tipo: 'invalid_phone' })],
  });
}

function deepFreeze<T>(o: T): T { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; }
const COLECOES = ['empresas', 'contatos', 'atividades', 'tarefas', 'sinais', 'oportunidades', 'comunicacoes', 'duplicatas', 'supressoes', 'historicoEstagios', 'projetos', 'pesosDecisionFit', 'estrategias'] as const;
function permutar(r: RadarDataset, f: <T>(xs: T[]) => T[]): RadarDataset { const out = { ...r } as RadarDataset; for (const k of COLECOES) (out as unknown as Record<string, unknown[]>)[k] = f([...(r[k] as unknown[])]); return out; }
const embaralhar = (seed: number) => <T,>(xs: T[]): T[] => { let s = seed; const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Invariante de CONTATO: so com contato elegivel da empresa, canal acionavel e objetivo/playbook do catalogo; fora de CONTATO, nada de abordagem. */
function conferirPlanos(r: RadarDataset, planos: CommercialActionPlan[]) {
  for (const p of planos) {
    if (p.modo !== 'CONTATO') { expect([p.itemId, p.contato, p.comunicacao]).toEqual([p.itemId, undefined, undefined]); continue; }
    const c = r.contatos.find((x) => x.id === p.contato!.id)!;
    const acionaveis = canaisAcionaveisCM(c, r.supressoes);
    expect([p.itemId, c.empresaId, contatoElegivel(c, r.supressoes)]).toEqual([p.itemId, p.empresaId, true]);
    expect(r.supressoes.some((s) => s.empresaId === p.empresaId && !s.contatoId && (s.tipo === 'do_not_contact' || s.tipo === 'opt_out'))).toBe(false);
    expect([p.itemId, acionaveis.includes(p.comunicacao!.canal)]).toEqual([p.itemId, true]);
    for (const alt of p.comunicacao!.canaisAlternativos) expect(acionaveis).toContain(alt);
    expect(OBJETIVOS_COMUNICACAO).toContain(p.comunicacao!.objetivo);
    expect(PLAYBOOKS_CODIGOS).toContain(p.comunicacao!.playbook);
    expect(p.comunicacao!.cta).toBe(OBJETIVOS[p.comunicacao!.objetivo].cta);
    expect(p.bloqueios).toEqual([]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-B — modo operacional nasce da ação concreta', () => {
  it('1 AGIR_AGORA por resposta → contato válido a partir da resposta (com e sem contato na atividade)', () => {
    for (const contatoId of ['c', undefined]) {
      const p = plano(umaConta({ contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId, resultado: 'REQUESTED_BUDGET' })] }));
      expect(p).toMatchObject({ acaoCodigo: 'RESPOSTA_NAO_TRATADA', categoria: 'AGIR_AGORA', modo: 'CONTATO', motivoModo: 'RESPONDER_CLIENTE', contato: { id: 'c', fit: 85, persona: 'CEO' } });
      expect(p.comunicacao).toMatchObject({ origem: 'SELECAO_ATUAL', objetivo: TRANSICOES_RESULTADO.REQUESTED_BUDGET.objetivo, playbook: TRANSICOES_RESULTADO.REQUESTED_BUDGET.playbook, canal: 'EMAIL', canaisAlternativos: [] });
      expect(p.comunicacao!.motivoSelecao).toContain('REQUESTED_BUDGET');
    }
  });

  it('2 AGIR_AGORA por tarefa RESEARCH → ação interna; reunião/visita marcada também é interna', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { tipo: 'RESEARCH', contatoId: 'c', venceEm: '2026-09-10' })] }));
    expect(p).toMatchObject({ acaoCodigo: 'TAREFA_VENCIDA', categoria: 'AGIR_AGORA', modo: 'ACAO_INTERNA', motivoModo: 'TAREFA_INTERNA', tipoTarefa: 'RESEARCH' });
    expect([p.contato, p.comunicacao]).toEqual([undefined, undefined]);
    for (const tipo of ['MEETING', 'VISIT'] as const) expect(plano(umaConta({ contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { tipo, contatoId: 'c', venceEm: '2026-09-10' })] })).motivoModo).toBe('COMPROMISSO_PRESENCIAL');
  });

  it('3 tarefa de follow-up vencida → contato; tarefa CALL pede o telefone como preferência explícita', () => {
    const contato = cont('c', 'a', { telefone: '5562988887777', whatsapp: '5562988887777' });
    const follow = plano(umaConta({ contatos: [contato], tarefas: [tar('t', 'a', { contatoId: 'c', venceEm: '2026-09-12' })] }));
    expect(follow).toMatchObject({ modo: 'CONTATO', motivoModo: 'TAREFA_DE_CONTATO', comunicacao: { canal: 'WHATSAPP', canaisAlternativos: ['PHONE'] } });
    const ligar = plano(umaConta({ contatos: [contato], tarefas: [tar('t', 'a', { tipo: 'CALL', contatoId: 'c', venceEm: '2026-09-12' })] }));
    expect(ligar.comunicacao).toMatchObject({ canal: 'PHONE', canaisAlternativos: ['WHATSAPP'], motivoCanal: 'canal pedido pela tarefa (PHONE)' });
  });

  it('4 sinal acionável + decisor + canal → contato', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a')], sinais: [sin('s', 'a')] }));
    expect(p).toMatchObject({ acaoCodigo: 'SINAL_ACIONAVEL_NOVO', modo: 'CONTATO', motivoModo: 'SINAL_COM_DECISOR_PRONTO', comunicacao: { objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', canal: 'EMAIL', estagio: 'DECISION_MAKER_FOUND' } });
  });

  it('5 sinal sem decisor (ou abaixo do ideal) nunca produz contato, nem com item obsoleto', () => {
    expect(plano(umaConta({ sinais: [sin('s', 'a')] }))).toMatchObject({ acaoCodigo: 'SEM_DECISOR', modo: 'ENRIQUECER', enriquecer: { alvo: 'DECISOR', sinalId: 's' } });
    expect(plano(umaConta({ contatos: [cont('c', 'a', { persona: 'OPERATIONS' })], sinais: [sin('s', 'a')] }))).toMatchObject({ acaoCodigo: 'SEM_DECISOR_IDEAL_PARA_SINAL', modo: 'ENRIQUECER' });
    const comContato = umaConta({ contatos: [cont('c', 'a')], sinais: [sin('s', 'a')] });
    const item = fila(comContato).itens[0];
    const semContato = { ...comContato, contatos: [] };
    expect(planoDeAcaoCM(semContato, item)).toMatchObject({ acaoCodigo: 'SINAL_ACIONAVEL_NOVO', modo: 'ENRIQUECER', bloqueios: [{ codigo: 'CONTATO_AUSENTE' }] });
  });

  it('6 INVALID_CONTACT → validar o mesmo contato (ENRIQUECER) ou trocar de contato; nunca abordar o inválido', () => {
    const mesmo = plano(umaConta({ contatos: [cont('c1', 'a', { telefone: '5562999999999' })], atividades: [atv('at', 'a', { contatoId: 'c1', resultado: 'INVALID_CONTACT' })], supressoes: [supr('sp', { contatoId: 'c1', tipo: 'invalid_phone' })] }, 'B'));
    expect(mesmo).toMatchObject({ acaoCodigo: 'TENTATIVA_CONTATO_INVALIDO', modo: 'ENRIQUECER', motivoModo: 'VALIDAR_CONTATO', enriquecer: { alvo: 'CONTATO_VALIDO', contatoId: 'c1' }, bloqueios: [{ codigo: 'CONTATO_INVALIDO_NA_ULTIMA_TENTATIVA' }] });
    expect(mesmo.comunicacao).toBeUndefined();
    const troca = plano(umaConta({ contatos: [cont('c1', 'a', { persona: 'OPERATIONS', email: undefined, telefone: '5562999999999' }), cont('c2', 'a')], atividades: [atv('at', 'a', { contatoId: 'c1', resultado: 'INVALID_CONTACT' })], supressoes: [supr('sp', { contatoId: 'c1', tipo: 'invalid_phone' })] }, 'B'));
    expect(troca).toMatchObject({ acaoCodigo: 'TENTATIVA_CONTATO_INVALIDO', modo: 'CONTATO', motivoModo: 'TROCA_DE_CONTATO', contato: { id: 'c2' }, comunicacao: { canal: 'EMAIL' } });
  });

  it('7 invalid_phone elimina telefone e WhatsApp; 8 email_bounced elimina e-mail', () => {
    const tel = plano(umaConta({ contatos: [cont('c', 'a', { telefone: '5562911112222', whatsapp: '5562911112222' })], sinais: [sin('s', 'a')], supressoes: [supr('sp', { contatoId: 'c', tipo: 'invalid_phone' })] }));
    expect(tel.contato!.canaisAcionaveis).toEqual(['EMAIL']);
    expect(tel.comunicacao).toMatchObject({ canal: 'EMAIL', canaisAlternativos: [] });
    expect(tel.comunicacao!.canaisDescartados).toEqual([{ canal: 'PHONE', motivo: 'NAO_ACIONAVEL' }, { canal: 'WHATSAPP', motivo: 'NAO_ACIONAVEL' }]);
    const mail = plano(umaConta({ contatos: [cont('c', 'a', { telefone: '5562911112222', celular: '5562911112222' })], sinais: [sin('s', 'a')], supressoes: [supr('sp', { contatoId: 'c', tipo: 'email_bounced' })] }));
    expect(mail.contato!.canaisAcionaveis).toEqual(['WHATSAPP', 'PHONE']);
    expect(mail.comunicacao).toMatchObject({ canal: 'WHATSAPP', canaisAlternativos: ['PHONE'] });
    expect(mail.comunicacao!.canaisDescartados).toEqual([{ canal: 'EMAIL', motivo: 'NAO_ACIONAVEL' }]);
  });

  it('9 canal sugerido pela política mas suprimido no CM não é usado; a interseção nunca promove canal fora da política', () => {
    const r = umaConta({ contatos: [cont('c', 'a', { whatsapp: '5562911112222' })], sinais: [sin('s', 'a')], supressoes: [supr('sp', { contatoId: 'c', tipo: 'invalid_phone' })] });
    const bruta = recomendarCanal({ contato: r.contatos[0], persona: 'CEO', historico: historicoDe(r.atividades, 'a', 'c'), estagio: 'DECISION_MAKER_FOUND', playbook: 'TECHNICAL_DISCOVERY' });
    expect(bruta.primario).toBe('WHATSAPP');
    const p = plano(r);
    expect(p.comunicacao!.canal).toBe('EMAIL');
    expect([p.comunicacao!.canal, ...p.comunicacao!.canaisAlternativos]).not.toContain('WHATSAPP');
    expect(canaisDaPoliticaCM({ primario: 'PHONE', secundario: 'LINKEDIN' }, ['EMAIL'])).toEqual([]);
    expect(canaisDaPoliticaCM({ primario: 'PHONE' }, ['EMAIL', 'PHONE'])).toEqual(['PHONE']);
    expect(canaisDaPoliticaCM({ primario: 'WHATSAPP', secundario: 'EMAIL' }, ['EMAIL'])).toEqual(['EMAIL']);
    expect(canaisDaPoliticaCM({ primario: 'EMAIL', secundario: 'REFERRAL' }, ['EMAIL'])).toEqual(['EMAIL']);
  });

  it('10 nenhum canal acionável → nenhum plano de contato (tarefa de contato vira ENRIQUECER)', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a', { email: undefined, linkedin: 'in/pessoa' })], tarefas: [tar('t', 'a', { tipo: 'CALL', contatoId: 'c', venceEm: '2026-09-11' })] }));
    expect(p).toMatchObject({ acaoCodigo: 'TAREFA_VENCIDA', modo: 'ENRIQUECER', motivoModo: 'COMPLETAR_CANAL', enriquecer: { alvo: 'CANAL', contatoId: 'c' }, bloqueios: [{ codigo: 'SEM_CANAL_ACIONAVEL' }] });
    expect(p.comunicacao).toBeUndefined();
  });

  it('11 resultado com comunicar=false → não abordar, mesmo com score alto ou tarefa de contato aberta', () => {
    const tarefa = plano(ds({ empresas: [emp('a', 'A+', 99)], contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-09-10'), criadoEm: ts('2026-09-10') })], tarefas: [tar('t', 'a', { tipo: 'CALL', contatoId: 'c', venceEm: '2026-09-12' })] }));
    expect(tarefa).toMatchObject({ acaoCodigo: 'TAREFA_VENCIDA', modo: 'REVISAR', motivoModo: 'CONTATO_NAO_PERMITIDO', revisar: { alvo: 'COMPROMISSO' }, bloqueios: [{ codigo: 'RESULTADO_NAO_PERMITE_COMUNICACAO', resultado: 'NOT_INTERESTED' }] });
    expect(tarefa.comunicacao).toBeUndefined();
    const nurture = plano(ds({ empresas: [emp('a', 'A+', 99)], contatos: [cont('c', 'a')], sinais: [sin('s', 'a')], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'ALREADY_HAS_SUPPLIER' })] }));
    expect(nurture).toMatchObject({ acaoCodigo: 'RESULTADO_NEGATIVO_SEM_FATO_NOVO', modo: 'AGUARDAR', motivoModo: 'NUTRIR_SEM_ABORDAGEM' });
  });

  it('12 comunicação READY_FOR_REVIEW → revisar; sem segunda abordagem concorrente para o mesmo contato', () => {
    const rev = plano(umaConta({ contatos: [cont('c', 'a')], comunicacoes: [com('m', 'a', 'c')] }, 'C'));
    expect(rev).toMatchObject({ acaoCodigo: 'COMUNICACAO_PARA_REVISAO', modo: 'REVISAR', motivoModo: 'REVISAR_ABORDAGEM', revisar: { alvo: 'COMUNICACAO', referencia: { tipo: 'comunicacao', id: 'm' } } });
    const concorrente = plano(umaConta({ contatos: [cont('c', 'a')], sinais: [sin('s', 'a', { detectadoEm: '2026-09-13' })], comunicacoes: [com('m', 'a', 'c', { criadoEm: ts('2026-09-10') })] }));
    expect(concorrente).toMatchObject({ acaoCodigo: 'SINAL_ACIONAVEL_NOVO', modo: 'REVISAR', bloqueios: [{ codigo: 'ABORDAGEM_PENDENTE_MESMO_CONTATO', referencia: { tipo: 'comunicacao', id: 'm' } }] });
    expect(concorrente.comunicacao).toBeUndefined();
  });

  it('13 comunicação aprovada → execução humana do artefato aprovado, sem inventar entrega', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a')], comunicacoes: [com('m', 'a', 'c', { estado: 'APPROVED', aprovadoEm: ts('2026-09-14'), resultado: { versaoPrincipal: 't', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: { deliveryStatus: 'UNKNOWN' } } })] }));
    expect(p).toMatchObject({ acaoCodigo: 'COMUNICACAO_APROVADA_NAO_ENVIADA', modo: 'CONTATO', motivoModo: 'EXECUTAR_ABORDAGEM_APROVADA', comunicacao: { origem: 'ARTEFATO_APROVADO', comunicacaoId: 'm', objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', canal: 'EMAIL' } });
    const chaves = (o: unknown): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [k, ...chaves(v)]) : []);
    expect(chaves(p).filter((k) => /deliver|entrega|status|provider|reconcil|^sent|enviadaEm/i.test(k))).toEqual([]);
    const fora = plano(umaConta({ contatos: [cont('c', 'a')], comunicacoes: [com('m', 'a', 'c', { estado: 'APPROVED', objetivo: 'OBJETIVO_ANTIGO' })] }));
    expect(fora).toMatchObject({ modo: 'REVISAR', bloqueios: [{ codigo: 'ARTEFATO_FORA_DO_CATALOGO' }] });
  });

  it('14 AGENDADO → aguardar até o prazo, sem plano antecipado de contato', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a')], tarefas: [tar('t', 'a', { tipo: 'CALL', contatoId: 'c', venceEm: '2026-09-20' })] }));
    expect(p).toMatchObject({ categoria: 'AGENDADO', modo: 'AGUARDAR', motivoModo: 'AGUARDAR_PRAZO', aguardarAte: '2026-09-20' });
    expect([p.contato, p.comunicacao]).toEqual([undefined, undefined]);
  });

  it('15 NURTURE → sem abordagem imediata', () => {
    for (const r of [umaConta({ contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'WON', fechadoEm: '2026-08-01' })] }, 'B'), umaConta({ contatos: [cont('c', 'a')], oportunidades: [opp('o', 'a', { estagio: 'NURTURE' })] }, 'B')]) {
      const p = plano(r);
      expect(p).toMatchObject({ categoria: 'NURTURE', modo: 'AGUARDAR', motivoModo: 'NUTRIR_SEM_ABORDAGEM' });
      expect(p.comunicacao).toBeUndefined();
    }
  });

  it('16 empresa ou contato suprimido → impossível retornar CONTATO, mesmo com item obsoleto', () => {
    const r = umaConta({ contatos: [cont('c', 'a')], sinais: [sin('s', 'a')] });
    const item = fila(r).itens[0];
    expect(planoDeAcaoCM(r, item).modo).toBe('CONTATO');
    const empresa = planoDeAcaoCM({ ...r, supressoes: [supr('sp', { empresaId: 'a', tipo: 'do_not_contact' })] }, item);
    expect(empresa).toMatchObject({ modo: 'REVISAR', bloqueios: [{ codigo: 'EMPRESA_SUPRIMIDA' }] });
    const contato = planoDeAcaoCM({ ...r, supressoes: [supr('sp', { contatoId: 'c', tipo: 'opt_out' })] }, item);
    expect(contato).toMatchObject({ modo: 'REVISAR', bloqueios: [{ codigo: 'CONTATO_INELEGIVEL' }] });
    const outraEmpresa = planoDeAcaoCM({ ...r, contatos: [cont('c', 'b')] }, item);
    expect(outraEmpresa).toMatchObject({ modo: 'REVISAR', bloqueios: [{ codigo: 'CONTATO_DE_OUTRA_EMPRESA' }] });
    const rico = cenarioRico();
    const planos = planosDaFilaCM(rico, fila(rico));
    expect(planos.some((p) => p.empresaId === 'supr')).toBe(false);
    expect(planos.filter((p) => p.contato?.id === 'c-saiu' || p.contato?.id === 'c-supr')).toEqual([]);
  });

  it('17 NOTE não vira última interação comercial', () => {
    const p = plano(umaConta({ contatos: [cont('c', 'a')], atividades: [atv('at1', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' }), atv('at2', 'a', { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-14', '11:00'), criadoEm: ts('2026-09-14', '11:00') })] }));
    expect(p.historico).toMatchObject({ ultimaInteracao: { atividadeId: 'at1', resultado: 'REQUESTED_BUDGET' }, ultimoResultado: { atividadeId: 'at1' }, ultimoContatoId: 'c', tentativas: 1, houveResposta: true });
    const soNota = plano(umaConta({ contatos: [cont('c', 'a')], atividades: [atv('at', 'a', { tipo: 'NOTE', canal: 'OTHER' })] }));
    expect(soNota.historico).toMatchObject({ ultimaInteracao: undefined, tentativas: 0, houveResposta: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-B — cenário rico, invariantes e determinismo', () => {
  it('matriz ação → modo no cenário rico', () => {
    const r = cenarioRico();
    const planos = planosDaFilaCM(r, fila(r));
    expect(Object.fromEntries(planos.map((p) => [p.empresaId, [p.acaoCodigo, p.modo, p.motivoModo]]))).toEqual({
      resp: ['RESPOSTA_NAO_TRATADA', 'CONTATO', 'RESPONDER_CLIENTE'], venc: ['TAREFA_VENCIDA', 'CONTATO', 'TAREFA_DE_CONTATO'], interna: ['TAREFA_VENCIDA', 'ACAO_INTERNA', 'TAREFA_INTERNA'],
      sinal: ['SINAL_ACIONAVEL_NOVO', 'CONTATO', 'SINAL_COM_DECISOR_PRONTO'], critica: ['OPORTUNIDADE_PARADA_CRITICA', 'ENRIQUECER', 'COMPLETAR_DECISOR'],
      oppsem: ['OPORTUNIDADE_SEM_PROXIMA_ACAO', 'ACAO_INTERNA', 'DEFINIR_PROXIMA_ACAO'], parada: ['OPORTUNIDADE_PARADA', 'CONTATO', 'MOVIMENTO_COM_CLIENTE'],
      hoje: ['PROXIMA_ACAO_HOJE', 'CONTATO', 'TAREFA_DE_CONTATO'], conflito: ['PROXIMA_ACAO_HOJE', 'CONTATO', 'TAREFA_DE_CONTATO'], follow: ['FOLLOW_UP_SEM_RESPOSTA', 'CONTATO', 'FOLLOW_UP_DE_TENTATIVA'],
      rev: ['COMUNICACAO_PARA_REVISAO', 'REVISAR', 'REVISAR_ABORDAGEM'], dup1: ['TRAVA_PARA_RESOLVER', 'REVISAR', 'RESOLVER_TRAVA'], dup2: ['INCONSISTENCIA_PARA_REVISAR', 'REVISAR', 'RESOLVER_INCONSISTENCIA'], semdono: ['INCONSISTENCIA_PARA_REVISAR', 'REVISAR', 'RESOLVER_INCONSISTENCIA'],
      aprov: ['COMUNICACAO_APROVADA_NAO_ENVIADA', 'CONTATO', 'EXECUTAR_ABORDAGEM_APROVADA'], prosp: ['CONTA_PRIORITARIA_NUNCA_ABORDADA', 'CONTATO', 'PRIMEIRO_CONTATO'],
      enriq: ['SEM_DECISOR', 'ENRIQUECER', 'COMPLETAR_DECISOR'], saiu: ['SEM_DECISOR', 'ENRIQUECER', 'COMPLETAR_DECISOR'], telinv: ['SEM_CANAL_VALIDO', 'ENRIQUECER', 'COMPLETAR_CANAL'],
      neg: ['RESULTADO_NEGATIVO_SEM_FATO_NOVO', 'AGUARDAR', 'NUTRIR_SEM_ABORDAGEM'], lost: ['OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO', 'AGUARDAR', 'NUTRIR_SEM_ABORDAGEM'], won: ['CLIENTE_GANHO', 'AGUARDAR', 'NUTRIR_SEM_ABORDAGEM'],
      futura: ['PROXIMA_ACAO_AGENDADA', 'AGUARDAR', 'AGUARDAR_PRAZO'], interv: ['FOLLOW_UP_EM_INTERVALO', 'AGUARDAR', 'AGUARDAR_PRAZO'],
    });
    expect(planos.map((p) => p.empresaId)).toEqual(fila(r).itens.map((i) => i.empresaId));
    expect(resumoPorModoCM(planos)).toEqual({ CONTATO: 9, ACAO_INTERNA: 2, REVISAR: 4, ENRIQUECER: 4, AGUARDAR: 5 });
    expect(planos.every((p) => p.versaoPlano === VERSAO_REGRAS_PLANO_CM && p.versaoRegrasFila === VERSAO_REGRAS_CM)).toBe(true);
  });

  it('matriz resultado → objetivo/playbook/canal nos principais casos', () => {
    const r = cenarioRico();
    const planos = new Map(planosDaFilaCM(r, fila(r)).map((p) => [p.empresaId, p.comunicacao && [p.comunicacao.objetivo, p.comunicacao.playbook, p.comunicacao.canal, p.comunicacao.canaisAlternativos]]));
    expect(planos.get('resp')).toEqual(['SCHEDULE_MEETING', 'TECHNICAL_DISCOVERY', 'EMAIL', []]); // REQUESTED_MEETING
    expect(planos.get('follow')).toEqual(['FOLLOW_UP', 'NO_RESPONSE_FOLLOWUP', 'WHATSAPP', ['PHONE']]); // NO_RESPONSE por e-mail: alterna o canal
    expect(planos.get('sinal')).toEqual(['START_DISCOVERY', 'TECHNICAL_DISCOVERY', 'EMAIL', []]);
    expect(planos.get('prosp')).toEqual(['START_DISCOVERY', 'TECHNICAL_DISCOVERY', 'WHATSAPP', ['PHONE']]);
    expect(planos.get('aprov')).toEqual(['START_DISCOVERY', 'TECHNICAL_DISCOVERY', 'EMAIL', []]);
  });

  it('21/22 todo plano CONTATO tem contato elegível, canal acionável e objetivo/playbook do catálogo (também com lacunas e supressões)', () => {
    const base = cenarioRico();
    const variantes: RadarDataset[] = [
      base,
      { ...base, supressoes: [...base.supressoes, ...base.contatos.map((c, k) => supr(`x${k}`, { contatoId: c.id, tipo: k % 2 ? 'invalid_phone' : 'email_bounced' }))] },
      { ...base, contatos: base.contatos.map((c) => ({ ...c, email: undefined })) },
      { ...base, supressoes: [...base.supressoes, ...base.empresas.map((e) => supr(`e-${e.id}`, { empresaId: e.id, tipo: 'opt_out' }))] },
    ];
    for (const r of variantes) {
      const q = fila(r);
      const planos = planosDaFilaCM(r, q);
      conferirPlanos(r, planos);
      // itens obsoletos (fila do dataset base) sobre o dataset alterado tambem respeitam o invariante
      conferirPlanos(r, fila(base).itens.filter((i) => r.empresas.some((e) => e.id === i.empresaId)).map((i) => planoDeAcaoCM(r, i)));
      for (const p of planos.filter((x) => x.acaoCodigo === 'RESPOSTA_NAO_TRATADA' && x.comunicacao)) {
        const at = r.atividades.find((a) => a.id === p.referencia!.id)!;
        expect(p.comunicacao!.objetivo).toBe(TRANSICOES_RESULTADO[at.resultado!].objetivo);
      }
    }
    expect(planosDaFilaCM(variantes[3], fila(variantes[3]))).toEqual([]);
  });

  it('tentativa com contato inválido nunca gera abordagem para o mesmo contato', () => {
    const r = umaConta({ contatos: [cont('c', 'a', { telefone: '1', whatsapp: '1' })], atividades: [atv('at', 'a', { contatoId: 'c', canal: 'WHATSAPP', tipo: 'MESSAGE', resultado: 'INVALID_CONTACT' })], supressoes: [supr('sp', { contatoId: 'c', tipo: 'invalid_phone' })] }, 'B');
    const p = plano(r);
    expect(p.modo).not.toBe('CONTATO');
    expect(p.comunicacao).toBeUndefined();
  });

  it('18 mesmo dataset + mesmo item → mesmo plano; 19 permutação das coleções → mesmo plano', () => {
    const r = cenarioRico();
    const q = fila(r);
    const base = planosDaFilaCM(r, q);
    expect(JSON.stringify(planosDaFilaCM(r, q))).toBe(JSON.stringify(base));
    for (const v of [(xs: unknown[]) => xs.reverse(), embaralhar(3), embaralhar(99), embaralhar(2026)]) {
      const rp = permutar(r, v as <T>(xs: T[]) => T[]);
      const qp = fila(rp);
      expect(qp).toEqual(q);
      expect(planosDaFilaCM(rp, qp)).toEqual(base);
      expect(q.itens.map((i) => planoDeAcaoCM(rp, i))).toEqual(base);
    }
  });

  it('20 entrada congelada (dataset e item) não é mutada e dá o mesmo plano', () => {
    const livre = planosDaFilaCM(cenarioRico(), fila(cenarioRico()));
    const r = deepFreeze(cenarioRico());
    const q = deepFreeze(fila(r)) as CommercialQueue;
    expect(() => planosDaFilaCM(r, q)).not.toThrow();
    expect(planosDaFilaCM(r, q)).toEqual(livre);
  });

  it('o plano nunca altera a fila: ação, categoria, referência e ordem vêm do item', () => {
    const r = cenarioRico();
    const q = fila(r);
    const antes = JSON.stringify(q);
    for (const [k, p] of planosDaFilaCM(r, q).entries()) {
      const i = q.itens[k];
      expect([p.itemId, p.acaoCodigo, p.categoria, p.referencia, p.tipoTarefa]).toEqual([itemIdCM(i), i.porQueAgora.codigo, i.categoria, i.porQueAgora.referencia, i.porQueAgora.tipoTarefa]);
    }
    expect(JSON.stringify(q)).toBe(antes);
  });

  it('todo modo, motivo e bloqueio tem texto pt-BR e a explicação usa esses textos', () => {
    for (const m of MOTIVOS_MODO_PLANO_CM) expect(TEXTO_MOTIVO_MODO_CM[m]?.trim()).toBeTruthy();
    for (const b of CODIGOS_BLOQUEIO_PLANO_CM) expect(TEXTO_BLOQUEIO_PLANO_CM[b]?.trim()).toBeTruthy();
    expect(MODOS_PLANO_CM).toEqual(['CONTATO', 'ACAO_INTERNA', 'REVISAR', 'ENRIQUECER', 'AGUARDAR']);
    const r = cenarioRico();
    for (const p of planosDaFilaCM(r, fila(r))) expect(p.explicacao).toEqual({ acao: expect.any(String), modo: TEXTO_MOTIVO_MODO_CM[p.motivoModo], bloqueios: p.bloqueios.map((b) => TEXTO_BLOQUEIO_PLANO_CM[b.codigo]) });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-B — paridade com contextoComunicacaoDe (oráculo) sem herdar a autoridade do pipeline', () => {
  const casos: [string, RadarDataset][] = [
    ['sinal com CEO', umaConta({ contatos: [cont('c', 'a')], sinais: [sin('s', 'a')] })],
    ['resposta pedindo reunião', umaConta({ contatos: [cont('c', 'a', { telefone: '5562977776666' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_MEETING' })] })],
    ['follow-up sem resposta por WhatsApp', umaConta({ contatos: [cont('c', 'a', { whatsapp: '5562977776666' })], atividades: [atv('at', 'a', { contatoId: 'c', canal: 'WHATSAPP', tipo: 'MESSAGE', resultado: 'NO_RESPONSE', ocorreuEm: ts('2026-09-08'), criadoEm: ts('2026-09-08') })] }, 'B')],
    ['prospecção com engenharia', umaConta({ contatos: [cont('c', 'a', { persona: 'ENGINEERING', telefone: '5562977776666' })] })],
  ];
  for (const [nome, r] of casos) {
    it(`objetivo, playbook e canal iguais ao contexto existente: ${nome}`, () => {
      const item = fila(r).itens[0];
      const p = planoDeAcaoCM(r, item);
      expect(p.modo).toBe('CONTATO');
      const ctx = contextoComunicacaoDe(r, 'a', HOJE, { contatoId: p.contato!.id, sinalId: item.sinalId })!;
      expect([p.comunicacao!.objetivo, p.comunicacao!.playbook, p.comunicacao!.canal, p.comunicacao!.estagio]).toEqual([ctx.objetivo, ctx.playbook, ctx.canal.primario, ctx.estagio]);
    });
  }
});

describe('CM1-B — teste 23: D1–D9 não mudam a ação principal por influência de recomendarAcao', () => {
  const r1 = (p: Partial<RadarDataset>) => ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a')], ...p });
  const casos: { nome: string; r: RadarDataset; pipeline: string; acao: string; modo: string; motivo: string }[] = [
    { nome: 'D1', r: r1({ oportunidades: [opp('o', 'a', { criadoEm: ts('2026-09-01'), proximaAcao: 'visita', proximaAcaoEm: '2026-09-20' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' })] }), pipeline: 'PLANNED_ACTION', acao: 'RESPOSTA_NAO_TRATADA', modo: 'CONTATO', motivo: 'RESPONDER_CLIENTE' },
    { nome: 'D2', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at1', 'a', { contatoId: 'c', resultado: 'REQUESTED_BUDGET' }), atv('at2', 'a', { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-14', '11:00') })] }), pipeline: 'OPEN_OPPORTUNITY', acao: 'RESPOSTA_NAO_TRATADA', modo: 'CONTATO', motivo: 'RESPONDER_CLIENTE' },
    { nome: 'D3', r: r1({ sinais: [sin('s', 'a', { detectadoEm: '2026-09-12' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED' })] }), pipeline: 'CONTACT_NOW', acao: 'RESULTADO_NEGATIVO_SEM_FATO_NOVO', modo: 'AGUARDAR', motivo: 'NUTRIR_SEM_ABORDAGEM' },
    { nome: 'D4', r: ds({ empresas: [emp('a', 'B')], contatos: [cont('c', 'a', { email: undefined, telefone: '5562999999999' })], sinais: [sin('s', 'a')], supressoes: [supr('sp', { contatoId: 'c', tipo: 'invalid_phone' })] }), pipeline: 'CONTACT_NOW', acao: 'SEM_CANAL_VALIDO', modo: 'ENRIQUECER', motivo: 'COMPLETAR_CANAL' },
    { nome: 'D5', r: r1({ atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'REQUESTED_MEETING' })], tarefas: [tar('t', 'a', { venceEm: '2026-09-22', criadoEm: ts('2026-09-14', '10:05') })] }), pipeline: 'RESPOND', acao: 'PROXIMA_ACAO_AGENDADA', modo: 'AGUARDAR', motivo: 'AGUARDAR_PRAZO' },
    { nome: 'D6', r: r1({ oportunidades: [opp('o', 'a', { proximaAcao: 'ligar', proximaAcaoEm: '2026-09-05' })] }), pipeline: 'PLANNED_ACTION', acao: 'OPORTUNIDADE_ACAO_VENCIDA', modo: 'CONTATO', motivo: 'MOVIMENTO_COM_CLIENTE' },
    { nome: 'D7', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NO_RESPONSE' })] }), pipeline: 'CONTACT_NOW', acao: 'FOLLOW_UP_EM_INTERVALO', modo: 'AGUARDAR', motivo: 'AGUARDAR_PRAZO' },
    { nome: 'D8', r: r1({ sinais: [sin('s', 'a', { tipo: 'NEWS' })], atividades: [atv('at', 'a', { contatoId: 'c', resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-08-26'), criadoEm: ts('2026-08-26') })] }), pipeline: 'FOLLOW_UP', acao: 'RESULTADO_NEGATIVO_SEM_FATO_NOVO', modo: 'AGUARDAR', motivo: 'NUTRIR_SEM_ABORDAGEM' },
    { nome: 'D9', r: r1({ sinais: [sin('s', 'a', { eventoEm: '2026-08-10', detectadoEm: '2026-08-16' })] }), pipeline: 'CONTACT_NOW', acao: 'SEM_TIMING_ATUAL', modo: 'AGUARDAR', motivo: 'NUTRIR_SEM_ABORDAGEM' },
  ];
  for (const c of casos) {
    it(`${c.nome}: pipeline diz ${c.pipeline}; o plano segue a fila (${c.acao} → ${c.modo})`, () => {
      expect(recomendarAcao(c.r.empresas[0], c.r, HOJE).estado).toBe(c.pipeline);
      const item = fila(c.r).itens[0];
      const p = planoDeAcaoCM(c.r, item);
      expect([p.acaoCodigo, p.categoria, p.modo, p.motivoModo]).toEqual([c.acao, item.categoria, c.modo, c.motivo]);
      expect(item.porQueAgora.codigo).toBe(c.acao);
      if (c.nome === 'D1' || c.nome === 'D2') expect(p.comunicacao?.objetivo).toBe(TRANSICOES_RESULTADO.REQUESTED_BUDGET.objetivo);
    });
  }

  it('fronteira: o plano não importa recomendarAcao nem contextoComunicacaoDe, não gera texto e não chama servidor', () => {
    const src = fs.readFileSync('src/core/radar/commercialActionPlan.ts', 'utf8');
    const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect([...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort()).toEqual(['./commercialMachine', './comunicacao', './contatos', './pipeline', './types']);
    expect(codigo).not.toMatch(/recomendarAcao|contextoComunicacaoDe|buildCommunicationContext|proximaAcaoAtual|filaHoje|lerEmpresa|sinalPrincipal|montarContentSpec|generateCommunication|fetch\(|\/api\/|anthropic|Date\.now|new Date\(|Math\.random|localeCompare/i);
    expect(fs.readFileSync('src/core/radar/pipeline.ts', 'utf8')).not.toMatch(/commercialActionPlan|commercialMachine/);
  });
});
