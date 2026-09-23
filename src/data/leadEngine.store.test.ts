// LE-2C — a fronteira governada do Lead Engine no store.
//
// O que se prova aqui NAO e regra do Lead Engine (isso e do core, em leadEngineReview.test.ts). E o
// comportamento da PORTA: permissao, releitura do estado atual, contexto canonico, falha fechada, um commit,
// uma auditoria, duplo clique seguro e zero efeito colateral.
//
// Arranjo: o LE-3 (descoberta real) ainda nao existe, entao nao ha action que crie um candidato gerenciado.
// Os testes semeiam `registrosFonte` direto no dataset vivo — arranjo de teste, nunca caminho de producao — e
// depois exercitam a action de verdade.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, RegraLeadEngineError, actions, getState } from './store';
import { payloadFingerprint } from '../core/radar/leadEngineIntake';
import type { Empresa, RegistroFonte, Supressao } from '../core/radar/types';

const CNPJ = '11222333000181';
const ds = () => getState().ds;
const radar = () => getState().ds.radar;
const fonteCno = () => radar().fontes.find((f) => f.codigo === 'CNO')!;

const obra = (p: Record<string, unknown> = {}) => ({
  cno: 'obra-1', nomeResponsavel: 'Construtora Fictícia Alfa Ltda', cnpjResponsavel: CNPJ,
  municipio: 'Anápolis', uf: 'GO', dataInicio: '2026-09-01', nomeObra: 'Galpão Alfa', areaTotal: 4200, ...p,
});

const reg = (p: Partial<RegistroFonte> & { id: string }): RegistroFonte => {
  const payload = p.payload ?? obra();
  return {
    fonteId: fonteCno().id, tipo: 'projeto', externoId: 'obra-1', recebidoEm: '2026-09-20T10:00:00.000Z',
    statusIntake: 'PENDING', ...p, payload, payloadFingerprint: p.payloadFingerprint ?? payloadFingerprint(payload),
  };
};

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-01-01',
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});

const sup = (empresaId: string): Supressao => ({ id: `SUP-${empresaId}`, empresaId, tipo: 'do_not_contact', motivo: 'pedido do cliente', criadoPor: 'u-admin', criadoEm: '2026-08-01' });

/** Arranjo: injeta o cenario no dataset vivo. Nao existe action de descoberta ainda (isso e o LE-3). */
const semear = (registros: RegistroFonte[], empresas: Empresa[] = [], supressoes: Supressao[] = []) => {
  const r = radar();
  r.registrosFonte = registros;
  r.empresas = empresas;
  r.supressoes = supressoes;
};

const pedido = (p: { registroFonteId: string; decisao: 'ASSOCIATE_EXISTING' | 'CREATE_COMPANY' | 'KEEP_REVIEW' | 'REJECT'; empresaId?: string; motivo?: string; fingerprint?: string }) =>
  ({ registroFonteId: p.registroFonteId, payloadFingerprintEsperado: p.fingerprint ?? payloadFingerprint(obra()), decisao: p.decisao, empresaId: p.empresaId, motivo: p.motivo });

const decidir = (p: Parameters<typeof pedido>[0]) => actions.processarCandidatoLeadEngine({ tipo: 'DECISAO', pedido: pedido(p) });
const terminalizar = (registroFonteId: string) => actions.processarCandidatoLeadEngine({ tipo: 'TERMINALIZAR_SUPRIMIDO', registroFonteId });

const registroDe = (id: string) => radar().registrosFonte.find((x) => x.id === id)!;
const auditsLE = () => ds().auditoria.filter((a) => a.acao.startsWith('lead_engine_'));

beforeEach(() => {
  actions.trocarUsuario('u-admin');
  actions.restaurarPlanilha();
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-2C · permissão', () => {
  it('1 · usuário com radar pode decidir', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    expect(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' })).not.toThrow();
    expect(registroDe('SR-1').statusIntake).toBe('RESOLVED');
  });

  it('2 · usuário sem radar é recusado, sem tocar no dataset nem na auditoria', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    actions.trocarUsuario('u-contab'); // Contabilidade nao esta em PAPEIS_RADAR
    const antes = ds();
    const auditsAntes = ds().auditoria.length;
    expect(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' })).toThrow(RegraDeNegocioError);
    expect(ds()).toBe(antes); // nenhum commit
    expect(ds().auditoria).toHaveLength(auditsAntes);
    expect(registroDe('SR-1').statusIntake).toBe('PENDING');
  });
});

describe('LE-2C · decisões que promovem', () => {
  it('3 · CREATE_COMPANY cria a empresa, resolve o registro e audita uma vez', () => {
    semear([reg({ id: 'SR-1' })]);
    const r = decidir({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' });
    expect(radar().empresas).toHaveLength(1);
    expect(radar().empresas[0].cnpj).toBe(CNPJ);
    expect(registroDe('SR-1').statusIntake).toBe('RESOLVED');
    expect(registroDe('SR-1').entidadeId).toBe(r.projetoId);
    expect(auditsLE()).toHaveLength(1);
    expect(auditsLE()[0].acao).toBe('lead_engine_decisao_create_company');
    // 19-22 · nenhum efeito comercial
    expect(radar().oportunidades).toEqual([]);
    expect(radar().tarefas).toEqual([]);
    expect(radar().atividades).toEqual([]);
    expect(radar().comunicacoes).toEqual([]);
  });

  it('4 · ASSOCIATE_EXISTING usa a empresa existente e não cria outra', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    const r = decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' });
    expect(radar().empresas).toHaveLength(1);
    expect(r.empresaId).toBe('EMP-1');
    expect(r.empresaCriada).toBe(false);
    expect(registroDe('SR-1').statusIntake).toBe('RESOLVED');
    expect(auditsLE()).toHaveLength(1);
  });

  it('18 · nenhum segundo RegistroFonte é criado', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' });
    expect(radar().registrosFonte).toHaveLength(1);
    expect(radar().registrosFonte[0].payload).toEqual(obra()); // bruto preservado
  });
});

describe('LE-2C · revisão e rejeição', () => {
  it('5 · KEEP_REVIEW leva PENDING para REVIEW, com um commit', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'KEEP_REVIEW' });
    expect(registroDe('SR-1').statusIntake).toBe('REVIEW');
    expect(auditsLE()).toHaveLength(1);
  });

  it('6 · KEEP_REVIEW em REVIEW não gera commit vazio nem auditoria nova', () => {
    semear([reg({ id: 'SR-1', statusIntake: 'REVIEW' })], [emp('EMP-1', { cnpj: CNPJ })]);
    const antes = ds();
    decidir({ registroFonteId: 'SR-1', decisao: 'KEEP_REVIEW' });
    expect(ds()).toBe(antes); // nada mudou: nada foi commitado
    expect(auditsLE()).toHaveLength(0);
  });

  it('7 · REJECT grava motivo, ator e relógio do store', () => {
    semear([reg({ id: 'SR-1' })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'REJECT', motivo: '  fora do perfil  ' });
    const x = registroDe('SR-1');
    expect(x.statusIntake).toBe('REJECTED');
    expect(x.motivoDecisao).toBe('fora do perfil');
    expect(x.decididoPor).toBe('u-admin');
    expect(x.decididoEm).toBeTruthy();
    expect(auditsLE()).toHaveLength(1);
  });
});

describe('LE-2C · supressão', () => {
  const cenario = () => semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })], [sup('EMP-1')]);

  it('14 · candidato suprimido não promove por decisão humana comum', () => {
    cenario();
    const antes = ds();
    expect(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' })).toThrow(RegraLeadEngineError);
    expect(ds()).toBe(antes);
    expect(radar().projetos).toEqual([]);
    expect(radar().sinais).toEqual([]);
  });

  it('8 · TERMINALIZAR_SUPRIMIDO encerra em REJECTED com motivo SUPRIMIDO, um commit e uma auditoria', () => {
    cenario();
    terminalizar('SR-1');
    const x = registroDe('SR-1');
    expect(x.statusIntake).toBe('REJECTED');
    expect(x.motivoDecisao).toBe('SUPRIMIDO');
    expect(x.decididoPor).toBe('u-admin');
    expect(auditsLE()).toHaveLength(1);
    expect(auditsLE()[0].acao).toBe('lead_engine_terminalizar_suprimido');
    expect(radar().empresas).toHaveLength(1);
    expect(radar().projetos).toEqual([]);
    expect(radar().sinais).toEqual([]);
    expect(radar().supressoes).toHaveLength(1); // supressao intacta
  });

  it('17 · dupla terminalização: a segunda é recusada sem novo commit', () => {
    cenario();
    terminalizar('SR-1');
    const depoisDaPrimeira = ds();
    expect(() => terminalizar('SR-1')).toThrow(RegraLeadEngineError);
    expect(ds()).toBe(depoisDaPrimeira);
    expect(auditsLE()).toHaveLength(1);
  });
});

describe('LE-2C · falha fechada', () => {
  const zeroCommit = (fn: () => void, motivo: string) => {
    const antes = ds();
    const auditsAntes = ds().auditoria.length;
    let erro: unknown;
    try { fn(); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(RegraLeadEngineError);
    expect((erro as RegraLeadEngineError).motivos).toContain(motivo);
    expect(ds()).toBe(antes);
    expect(ds().auditoria).toHaveLength(auditsAntes);
  };

  it('9 · decisão inválida (REJECT sem motivo) não commita', () => {
    semear([reg({ id: 'SR-1' })]);
    zeroCommit(() => decidir({ registroFonteId: 'SR-1', decisao: 'REJECT' }), 'MOTIVO_OBRIGATORIO');
  });

  it('10 · fingerprint velho da tela não commita', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    zeroCommit(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1', fingerprint: 'z'.repeat(64) }), 'CONTEXTO_MUDOU');
  });

  it('10b · corrida real: a tela leu X, o dataset virou Y, o pedido antigo é recusado', () => {
    const velho = obra();
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    // o mundo muda depois que a tela montou o pedido: outra observação do MESMO objeto externo chega
    radar().registrosFonte = [...radar().registrosFonte, reg({ id: 'SR-2', recebidoEm: '2026-09-22T10:00:00.000Z', payload: obra({ areaTotal: 9999 }) })];
    zeroCommit(
      () => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1', fingerprint: payloadFingerprint(velho) }),
      'OBSERVACAO_DESATUALIZADA',
    );
  });

  it('11 · observação mais nova bloqueia a antiga, e a nova fica intacta', () => {
    semear([
      reg({ id: 'SR-1', recebidoEm: '2026-09-20T10:00:00.000Z' }),
      reg({ id: 'SR-2', recebidoEm: '2026-09-22T10:00:00.000Z', payload: obra({ areaTotal: 9999 }) }),
    ], [emp('EMP-1', { cnpj: CNPJ })]);
    zeroCommit(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), 'OBSERVACAO_DESATUALIZADA');
    expect(registroDe('SR-2').statusIntake).toBe('PENDING');
  });

  it('12 · empresa inativa não commita', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ, ativo: false })]);
    zeroCommit(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), 'EMPRESA_INATIVA');
  });

  it('13 · empresa mesclada não commita', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ, mescladaEm: 'EMP-9' }), emp('EMP-9')]);
    zeroCommit(() => decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), 'EMPRESA_MESCLADA');
  });

  it('o erro tipado carrega motivos, registro e operação — sem parsing de texto', () => {
    semear([reg({ id: 'SR-1' })]);
    try {
      decidir({ registroFonteId: 'SR-1', decisao: 'REJECT' });
      expect.unreachable();
    } catch (e) {
      const x = e as RegraLeadEngineError;
      expect(x).toBeInstanceOf(RegraDeNegocioError); // quem so mostra a mensagem nao muda
      expect(x.motivos).toEqual(['MOTIVO_OBRIGATORIO']);
      expect(x.registroFonteId).toBe('SR-1');
      expect(x.operacao).toBe('DECISAO');
      expect(x.message).toContain('MOTIVO_OBRIGATORIO');
    }
  });
});

describe('LE-2C · duplo clique', () => {
  it('15 · CREATE_COMPANY duas vezes: a segunda é recusada, sem segunda empresa', () => {
    semear([reg({ id: 'SR-1' })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' });
    const depoisDaPrimeira = ds();
    expect(() => decidir({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' })).toThrow(RegraLeadEngineError);
    expect(ds()).toBe(depoisDaPrimeira);
    expect(radar().empresas).toHaveLength(1);
    expect(radar().projetos).toHaveLength(1);
    expect(radar().sinais).toHaveLength(1);
    expect(auditsLE()).toHaveLength(1);
  });

  it('16 · ASSOCIATE_EXISTING duas vezes: a segunda é recusada por STATUS_TERMINAL', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' });
    const depoisDaPrimeira = ds();
    try {
      decidir({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' });
      expect.unreachable();
    } catch (e) {
      expect((e as RegraLeadEngineError).motivos).toContain('STATUS_TERMINAL');
    }
    expect(ds()).toBe(depoisDaPrimeira);
    expect(auditsLE()).toHaveLength(1);
  });
});

describe('LE-2C · auditoria e contexto', () => {
  it('23 · a auditoria da decisão guarda o que foi decidido, não o payload bruto', () => {
    semear([reg({ id: 'SR-1' })]);
    decidir({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' });
    const a = auditsLE()[0];
    expect(a.entidade).toBe('radar_source_record');
    expect(a.entidadeId).toBe('SR-1');
    expect(a.antes).toMatchObject({ statusIntake: 'PENDING' });
    expect(a.depois).toMatchObject({ statusIntake: 'RESOLVED', decisao: 'CREATE_COMPANY', empresaCriada: true });
    expect(JSON.stringify(a)).not.toContain('nomeResponsavel'); // o bruto ja esta no RegistroFonte
    expect(a.usuario).toBeTruthy();
  });

  it('24 · a auditoria da supressão distingue a operação e carrega o motivo', () => {
    semear([reg({ id: 'SR-1' })], [emp('EMP-1', { cnpj: CNPJ })], [sup('EMP-1')]);
    terminalizar('SR-1');
    const a = auditsLE()[0];
    expect(a.acao).toBe('lead_engine_terminalizar_suprimido');
    expect(a.motivo).toBe('SUPRIMIDO');
    expect(a.depois).toMatchObject({ statusIntake: 'REJECTED' });
  });

  it('25 · o ator vem do usuário atual do store, não da UI', () => {
    semear([reg({ id: 'SR-1' })]);
    actions.trocarUsuario('u-augusto'); // Diretoria: tem radar
    decidir({ registroFonteId: 'SR-1', decisao: 'REJECT', motivo: 'fora do perfil' });
    expect(registroDe('SR-1').decididoPor).toBe('u-augusto');
  });

  it('26 · relógio e data-base são os canônicos do store', () => {
    semear([reg({ id: 'SR-1' })]);
    const antesDoRelogio = new Date().toISOString();
    decidir({ registroFonteId: 'SR-1', decisao: 'REJECT', motivo: 'fora do perfil' });
    const decididoEm = registroDe('SR-1').decididoEm!;
    expect(decididoEm >= antesDoRelogio).toBe(true);
    expect(decididoEm <= new Date().toISOString()).toBe(true);
    // a assinatura publica nao aceita relogio, usuario nem gerador de id vindos de fora
    expect(Object.keys({ tipo: 'DECISAO', pedido: pedido({ registroFonteId: 'SR-1', decisao: 'KEEP_REVIEW' }) })).toEqual(['tipo', 'pedido']);
  });
});

describe('LE-2C · o store é fronteira, não autoridade', () => {
  const CODIGO = readFileSync('src/data/store.ts', 'utf8');
  const BLOCO = CODIGO.slice(CODIGO.indexOf('processarCandidatoLeadEngine'), CODIGO.indexOf('novoContatoRadar'));

  it('27 · não replica o matcher de identidade', () => {
    for (const proibido of ['encontrarEmpresa', 'identidadeForte', 'similaridade', 'nivel ===', "'certo'", "'provavel'", "'possivel'"]) {
      expect(BLOCO).not.toContain(proibido);
    }
  });

  it('28 · não replica as regras de supressão nem as transições', () => {
    for (const proibido of ['do_not_contact', 'opt_out', 'supressoes', 'transicaoPermitida', 'RESOLVED', 'PENDING']) {
      expect(BLOCO).not.toContain(proibido);
    }
  });

  it('29 · a porta não fala com Supabase, SQL nem persistência direta', () => {
    for (const proibido of ['supabase', 'persistirRadar', 'rpc(', 'from(', 'select(']) {
      expect(BLOCO).not.toContain(proibido);
    }
    expect(BLOCO).toContain('commit(ds)');
  });

  it('30 · existe UM único entrypoint público do Lead Engine no store', () => {
    const publicos = [...CODIGO.matchAll(/^ {2}(\w*[lL]eadEngine\w*)\(/gm)].map((m) => m[1]);
    expect(publicos).toEqual(['processarCandidatoLeadEngine']);
    // e ele delega ao core, sem revalidar por fora
    expect(BLOCO).toContain('aplicarDecisao(r, cmd.pedido, ctx)');
    expect(BLOCO).toContain('terminalizarSuprimido(r, registroFonteId, ctx)');
    expect(BLOCO).not.toContain('validarDecisao('); // aplicarDecisao ja revalida: uma autoridade so
  });

  it('a porta lê o estado ATUAL do store, nunca um dataset vindo de fora', () => {
    expect(BLOCO).toContain('const r = state.ds.radar;');
    expect(BLOCO).toContain('const ctx: ContextoDecisao = idsRadar(r);');
  });
});
