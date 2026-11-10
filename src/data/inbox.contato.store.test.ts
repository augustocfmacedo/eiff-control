// EIFF Inbox — cumprimento do SLA de primeira resposta pela PORTA do store.
// O que se prova: rascunho, nota, assumir, reatribuir, tentativa e encerramento NÃO cumprem; só o contato declarado
// como realizado cumpre, uma única vez, com quem declarou e quando; e os prazos dos canais não mudam.
import { beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { contatoDaMensagem, estadoSla, origemPrimeiraResposta, situacaoPrimeiraResposta, type PedidoDeContato } from '../core/inbox';

const inbox = () => getState().ds.inbox!;
const thread = (id: string) => inbox().threads.find((t) => t.id === id)!;
const mensagens = (id: string) => inbox().mensagens.filter((m) => m.threadId === id);
const audits = (acao: string) => getState().ds.auditoria.filter((a) => a.acao === acao);
const agora = () => new Date().toISOString();
const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const contato = (extra: Partial<PedidoDeContato> = {}): PedidoDeContato => ({ resultado: 'realizado', meio: 'telefone', em: minutosAtras(5), resumo: 'Falei com o cliente; ficou de mandar a planta.', ...extra });

// No exemplo: THR-00001 (WhatsApp, ATRIBUIDA a u-fin, aberta há 3 h, prazo de 24 h, sem resposta),
// THR-00004 (e-mail, ATRIBUIDA, aberta há 20 h) e THR-00010 (TRIADA, Alta: prazo de 4 h já vencido há 2 h).
beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

describe('o que NÃO cumpre o SLA de primeira resposta', () => {
  it('rascunho de resposta: a conversa entra em atendimento e o relógio continua', async () => {
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBeUndefined();
    const m = await actions.inboxResponder('THR-00001', 'Paulo, estou verificando.');
    expect(m.entrega).toBe('registrada');
    const t = thread('THR-00001');
    expect(t.status).toBe('EM_ATENDIMENTO');
    expect(t.sla?.primeiraRespostaEm).toBeUndefined();
    expect(situacaoPrimeiraResposta(t)).toBe('aguardando');
    expect(audits('inbox_responder')[0]!.depois).toMatchObject({ cumpreSla: false });
  });

  it('rascunho numa conversa já vencida não a tira do vencido', async () => {
    actions.inboxAtribuir('THR-00010', { setorCodigo: 'JURIDICO', responsavelId: 'u-admin' });
    expect(estadoSla(thread('THR-00010'), agora())).toBe('vencido');
    await actions.inboxResponder('THR-00010', 'Recebido, vamos analisar.');
    expect(estadoSla(thread('THR-00010'), agora())).toBe('vencido');
  });

  it('nota interna, assumir e alterar o responsável não cumprem', () => {
    actions.inboxAnotar('THR-00001', 'Vou ligar depois do almoço.');
    actions.inboxAtribuir('THR-00001', { setorCodigo: 'FINANCEIRO', responsavelId: 'u-admin' });
    actions.inboxAtribuir('THR-00001', { setorCodigo: 'COMPRAS', responsavelId: 'u-compras' });
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBeUndefined();
    expect(situacaoPrimeiraResposta(thread('THR-00001'))).toBe('aguardando');
  });

  it('tentativa sem sucesso vira nota interna marcada, e o prazo continua correndo', () => {
    const m = actions.inboxRegistrarContato('THR-00001', contato({ resultado: 'tentativa', resumo: 'Liguei duas vezes, ninguém atendeu.' }));
    expect(m.direcao).toBe('interna'); expect(m.tipo).toBe('nota'); expect(m.entrega).toBeUndefined();
    expect(contatoDaMensagem(m)).toEqual({ resultado: 'tentativa', meio: 'telefone' });
    const t = thread('THR-00001');
    expect(t.sla?.primeiraRespostaEm).toBeUndefined();
    expect(t.status).toBe('ATRIBUIDA'); // tentativa não é «primeira ação da EIFF na conversa»
    expect(audits('inbox_tentativa_contato')).toHaveLength(1);
    expect(audits('inbox_contato_realizado')).toHaveLength(0);
    expect(inbox().eventos.some((e) => e.threadId === 'THR-00001' && e.tipo === 'NOTE_ADDED' && /sem sucesso/.test(e.detalhe) && /não cumpre o SLA/.test(e.detalhe))).toBe(true);
  });

  it('resolver ou fechar sem resposta é «encerrada sem resposta», não atendimento realizado', () => {
    actions.inboxMudarStatus('THR-00001', 'RESOLVIDA');
    const t = thread('THR-00001');
    expect(t.sla?.primeiraRespostaEm).toBeUndefined();
    expect(situacaoPrimeiraResposta(t)).toBe('encerrada_sem_resposta');
    expect(estadoSla(t, agora())).toBe('sem_resposta');
  });
});

describe('contato realizado', () => {
  it('dentro do prazo: cumpre o SLA com o instante DECLARADO, e fica registrado quem declarou e quando', () => {
    actions.trocarUsuario('u-fin');
    const declarado = minutosAtras(12);
    const antesDeRegistrar = Date.now();
    const m = actions.inboxRegistrarContato('THR-00001', contato({ em: declarado, meio: 'whatsapp_externo' }));
    const t = thread('THR-00001');
    expect(t.sla?.primeiraRespostaEm).toBe(declarado);
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_no_prazo');
    expect(t.status).toBe('EM_ATENDIMENTO');
    expect(origemPrimeiraResposta(t, inbox().mensagens)).toBe('contato_declarado');
    // o registro: canal, responsável autenticado, data declarada, data de registro, resumo, conversa
    expect(m).toMatchObject({ threadId: 'THR-00001', direcao: 'outbound', entrega: 'entregue', em: declarado, autor: { tipo: 'usuario', id: 'u-fin' } });
    expect(contatoDaMensagem(m)).toEqual({ resultado: 'realizado', meio: 'whatsapp_externo' });
    expect(Date.parse(m.registradaEm!)).toBeGreaterThanOrEqual(antesDeRegistrar - 1000);
    expect(Date.parse(m.registradaEm!)).toBeGreaterThan(Date.parse(m.em));
    const a = audits('inbox_contato_realizado')[0]!;
    expect(a.usuario).toBeTruthy();
    expect(a.depois).toMatchObject({ mensagemId: m.id, meio: 'whatsapp_externo', declaradoEm: declarado, declaradoPor: 'u-fin', primeiraResposta: true, situacao: 'respondida_no_prazo' });
    expect((a.depois as Record<string, unknown>)['registradoEm']).toBeTruthy();
    // a auditoria nunca leva o texto do resumo
    expect(JSON.stringify(a)).not.toContain('mandar a planta');
    expect(inbox().eventos.some((e) => e.threadId === 'THR-00001' && e.tipo === 'MESSAGE_REGISTERED' && /contato realizado por WhatsApp externo/.test(e.detalhe) && /dentro do prazo/.test(e.detalhe))).toBe(true);
  });

  it('depois do vencimento: fica «respondida fora do prazo», nunca cumprida', () => {
    actions.inboxAtribuir('THR-00010', { setorCodigo: 'JURIDICO', responsavelId: 'u-admin' });
    expect(estadoSla(thread('THR-00010'), agora())).toBe('vencido');
    actions.inboxRegistrarContato('THR-00010', contato({ em: minutosAtras(1), meio: 'email' }));
    const t = thread('THR-00010');
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_fora_do_prazo');
    expect(estadoSla(t, agora())).toBe('atrasada');
    expect(audits('inbox_contato_realizado')[0]!.depois).toMatchObject({ situacao: 'respondida_fora_do_prazo', primeiraResposta: true });
    expect(inbox().eventos.some((e) => e.threadId === 'THR-00010' && /FORA do prazo/.test(e.detalhe))).toBe(true);
  });

  it('o PRIMEIRO contato é o que vale: o segundo fica no histórico e não substitui', () => {
    const primeiro = minutosAtras(30);
    actions.inboxRegistrarContato('THR-00001', contato({ em: primeiro }));
    actions.inboxRegistrarContato('THR-00001', contato({ em: minutosAtras(3), meio: 'presencial', resumo: 'Visitei o cliente na obra para alinhar.' }));
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBe(primeiro);
    expect(mensagens('THR-00001').filter((m) => contatoDaMensagem(m)?.resultado === 'realizado')).toHaveLength(2);
    const a = audits('inbox_contato_realizado');
    expect(a).toHaveLength(2);
    // a trilha não tem ordem garantida aqui: o que importa é que só UM registro foi a primeira resposta, e qual
    const primeiros = a.filter((x) => (x.depois as Record<string, unknown>)['primeiraResposta'] === true);
    expect(primeiros).toHaveLength(1);
    expect((primeiros[0]!.depois as Record<string, unknown>)['declaradoEm']).toBe(primeiro);
  });

  it('registro duplicado (duplo clique, reenvio) devolve o que já existe e não grava de novo', () => {
    const p = contato();
    const m1 = actions.inboxRegistrarContato('THR-00001', p);
    const n = { msgs: mensagens('THR-00001').length, audits: audits('inbox_contato_realizado').length, eventos: inbox().eventos.length };
    const m2 = actions.inboxRegistrarContato('THR-00001', p);
    expect(m2.id).toBe(m1.id);
    expect({ msgs: mensagens('THR-00001').length, audits: audits('inbox_contato_realizado').length, eventos: inbox().eventos.length }).toEqual(n);
  });

  it('tentativa primeiro, contato depois: só o contato cumpre, com o instante dele', () => {
    actions.inboxRegistrarContato('THR-00001', contato({ resultado: 'tentativa', em: minutosAtras(40), resumo: 'Liguei, caiu na caixa postal.' }));
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBeUndefined();
    const quando = minutosAtras(10);
    actions.inboxRegistrarContato('THR-00001', contato({ em: quando }));
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBe(quando);
  });

  it('reabertura pelo contato não apaga a primeira resposta nem o histórico', () => {
    const quando = minutosAtras(20);
    actions.inboxRegistrarContato('THR-00001', contato({ em: quando }));
    actions.trocarUsuario('u-fin');
    actions.inboxMudarStatus('THR-00001', 'RESOLVIDA');
    actions.trocarUsuario('u-admin');
    actions.inboxMudarStatus('THR-00001', 'EM_ATENDIMENTO', 'cliente voltou a perguntar');
    const t = thread('THR-00001');
    expect(t.status).toBe('EM_ATENDIMENTO');
    expect(t.sla?.primeiraRespostaEm).toBe(quando);
    expect(mensagens('THR-00001').some((m) => contatoDaMensagem(m)?.resultado === 'realizado')).toBe(true);
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_no_prazo');
  });

  it('recusa o que não é contato declarável: futuro, antes da abertura, sem resumo, meio inválido, conversa fechada, sem permissão', () => {
    expect(() => actions.inboxRegistrarContato('THR-00001', contato({ em: new Date(Date.now() + 3_600_000).toISOString() }))).toThrow(/futuro/);
    expect(() => actions.inboxRegistrarContato('THR-00001', contato({ em: new Date(Date.now() - 30 * 86_400_000).toISOString() }))).toThrow(/anterior à abertura/);
    expect(() => actions.inboxRegistrarContato('THR-00001', contato({ resumo: 'ok' }))).toThrow(/Resuma/);
    expect(() => actions.inboxRegistrarContato('THR-00001', contato({ meio: 'fax' as never }))).toThrow(/meio/);
    expect(() => actions.inboxRegistrarContato('THR-00001', contato({ em: '' }))).toThrow(/data e a hora/);
    actions.trocarUsuario('u-audit');
    expect(() => actions.inboxRegistrarContato('THR-00001', contato())).toThrow(RegraDeNegocioError);
    expect(thread('THR-00001').sla?.primeiraRespostaEm).toBeUndefined();
    expect(audits('inbox_contato_realizado')).toHaveLength(0);
  });
});

describe('o que a correção NÃO muda', () => {
  it('a duração dos SLAs dos canais continua a da configuração (Urgente 1 h, Alta 4 h, Normal 24 h, Baixa 72 h)', () => {
    expect(inbox().configuracao.slaHorasPorPrioridade).toEqual({ Urgente: 1, Alta: 4, Normal: 24, Baixa: 72 });
    const horas = (id: string) => (Date.parse(thread(id).sla!.primeiraRespostaAte) - Date.parse(thread(id).abertaEm)) / 3_600_000;
    expect(horas('THR-00001')).toBe(24); // WhatsApp, Normal
    expect(horas('THR-00004')).toBe(24); // e-mail, Normal
    expect(horas('THR-00010')).toBe(4);  // e-mail, Alta
    // registrar contato não mexe no vencimento
    const antes = thread('THR-00004').sla!.primeiraRespostaAte;
    actions.inboxRegistrarContato('THR-00004', contato({ meio: 'email' }));
    expect(thread('THR-00004').sla!.primeiraRespostaAte).toBe(antes);
  });

  it('a regra vale igual para WhatsApp e e-mail: rascunho não cumpre, contato cumpre', async () => {
    for (const id of ['THR-00001', 'THR-00004']) {
      await actions.inboxResponder(id, 'Estamos verificando o seu pedido.');
      expect(thread(id).sla?.primeiraRespostaEm, `${id} rascunho`).toBeUndefined();
      actions.inboxRegistrarContato(id, contato());
      expect(situacaoPrimeiraResposta(thread(id)), `${id} contato`).toBe('respondida_no_prazo');
    }
  });

  it('registros antigos do exemplo ficam como estão e são identificados como anteriores à regra', () => {
    // THR-00002 já vem com primeira resposta registrada, sem nenhum contato declarado
    const t = thread('THR-00002');
    expect(t.sla?.primeiraRespostaEm).toBeTruthy();
    expect(situacaoPrimeiraResposta(t)).toMatch(/^respondida_/);
    expect(origemPrimeiraResposta(t, inbox().mensagens)).toBe('anterior_a_regra');
  });
});
