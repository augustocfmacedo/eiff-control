// EIFF Inbox — a porta governada no store: permissao, regra do core, auditoria, sem efeito externo.
// O que se prova aqui NAO e regra do Inbox (isso e do core, em src/core/inbox/inbox.test.ts): e o comportamento da
// PORTA — quem pode, o que muda, o que fica na trilha e o que nunca acontece (envio, IA, Factory).
import { beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import type { MensagemRecebida } from '../core/inbox';

const inbox = () => getState().ds.inbox!;
const thread = (id: string) => inbox().threads.find((t) => t.id === id)!;
const audits = () => getState().ds.auditoria.filter((a) => a.acao.startsWith('inbox_'));

beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

describe('slice e permissão', () => {
  it('modo local carrega o exemplo do Inbox; Auditoria não tem a permissão', () => {
    expect(inbox().origem).toBe('seed'); expect(inbox().threads.length).toBeGreaterThan(5);
    actions.trocarUsuario('u-audit');
    expect(() => actions.inboxAtribuir('THR-00007', { setorCodigo: 'OBRAS' })).toThrow(RegraDeNegocioError);
    expect(audits()).toHaveLength(0);
  });
  it('carregar exemplo e receber mensagem exigem inbox_config', () => {
    actions.trocarUsuario('u-fin');
    expect(() => actions.inboxCarregarExemplo()).toThrow(RegraDeNegocioError);
    expect(() => actions.inboxReceber(msg())).toThrow(RegraDeNegocioError);
  });
});

describe('atribuição e status', () => {
  it('atribuir setor e responsável deriva o status, registra eventos e auditoria', () => {
    const antes = thread('THR-00007'); expect(antes.status).toBe('NOVA');
    actions.inboxAtribuir('THR-00007', { setorCodigo: 'COMERCIAL', responsavelId: 'u-augusto', motivo: 'lead' });
    const t = thread('THR-00007');
    expect(t.status).toBe('ATRIBUIDA'); expect(t.setorCodigo).toBe('COMERCIAL'); expect(t.responsavelId).toBe('u-augusto'); expect(t.participantes).toContain('u-augusto');
    const ev = inbox().eventos.filter((e) => e.threadId === 'THR-00007').map((e) => e.tipo);
    expect(ev).toContain('ROTEADA'); expect(ev).toContain('ATRIBUIDA'); expect(ev).toContain('STATUS');
    expect(audits().map((a) => a.acao)).toEqual(['inbox_atribuir']);
  });
  it('transferir mantém o histórico e marca TRANSFERIDA; sem mudança nada é gravado', () => {
    actions.inboxAtribuir('THR-00001', { setorCodigo: 'COMPRAS', responsavelId: 'u-compras' });
    const t = thread('THR-00001');
    expect(t.participantes).toEqual(['u-fin', 'u-compras']);
    expect(inbox().eventos.filter((e) => e.threadId === 'THR-00001' && e.tipo === 'TRANSFERIDA')).toHaveLength(2);
    const n = audits().length;
    actions.inboxAtribuir('THR-00001', { setorCodigo: 'COMPRAS', responsavelId: 'u-compras' });
    expect(audits()).toHaveLength(n);
  });
  it('setor inativo ou responsável inexistente são recusados', () => {
    expect(() => actions.inboxAtribuir('THR-00001', { setorCodigo: 'NAO_EXISTE' })).toThrow(/Setor/);
    expect(() => actions.inboxAtribuir('THR-00001', { responsavelId: 'u-fantasma' })).toThrow(/Responsável/);
  });
  it('mudar status respeita a máquina do core: reabrir exige motivo, resolver exige responsável', () => {
    expect(() => actions.inboxMudarStatus('THR-00008', 'EM_ATENDIMENTO')).toThrow(/motivo/);
    actions.inboxMudarStatus('THR-00008', 'EM_ATENDIMENTO', 'cliente questionou o valor');
    expect(thread('THR-00008').status).toBe('EM_ATENDIMENTO'); expect(thread('THR-00008').resolvidaEm).toBeUndefined();
    expect(() => actions.inboxMudarStatus('THR-00010', 'RESOLVIDA')).toThrow(/responsável/); // TRIADA, sem responsavel, nivel C
    expect(() => actions.inboxMudarStatus('THR-00007', 'NOVA')).toThrow();
    expect(audits().map((a) => a.acao)).toEqual(['inbox_mudar_status']);
  });
});

describe('responder, anotar e sugestões', () => {
  it('responder registra a mensagem de saída SEM enviar, cumpre o SLA e leva ATRIBUIDA a EM_ATENDIMENTO', async () => {
    actions.trocarUsuario('u-fin');
    const m = await actions.inboxResponder('THR-00001', 'Paulo, a NF 583 está programada.');
    expect(m.entrega).toBe('registrada'); expect(m.externalMessageId).toBeUndefined(); expect(m.direcao).toBe('outbound');
    const t = thread('THR-00001');
    expect(t.status).toBe('EM_ATENDIMENTO'); expect(t.sla?.primeiraRespostaEm).toBeTruthy();
    expect(inbox().eventos.some((e) => e.threadId === t.id && e.tipo === 'MENSAGEM' && /nada foi enviado/.test(e.detalhe))).toBe(true);
    const a = audits().find((x) => x.acao === 'inbox_responder')!;
    expect(a.depois).toMatchObject({ entrega: 'registrada' });
  });
  it('usar a sugestão marca a sugestão como aceita; descartar exige que esteja pendente', async () => {
    actions.trocarUsuario('u-fin');
    const s = inbox().sugestoes.find((x) => x.threadId === 'THR-00001')!;
    await actions.inboxResponder('THR-00001', s.texto, { sugestaoId: s.id });
    expect(inbox().sugestoes.find((x) => x.id === s.id)!.estado).toBe('aceita');
    expect(() => actions.inboxDescartarSugestao(s.id)).toThrow(/já decidida/);
  });
  it('responder em conversa fechada é recusado; nota interna não muda o status', async () => {
    actions.inboxMudarStatus('THR-00008', 'FECHADA');
    await expect(actions.inboxResponder('THR-00008', 'oi')).rejects.toThrow(/fechada/i);
    actions.inboxAnotar('THR-00001', 'conferir no contas a pagar');
    expect(thread('THR-00001').status).toBe('ATRIBUIDA');
    expect(inbox().mensagens.filter((m) => m.threadId === 'THR-00001' && m.direcao === 'interna')).toHaveLength(1);
  });
});

describe('triagem humana', () => {
  it('classifica com provedor HUMANO e roteia pelas regras do core (setor da regra, responsável padrão, nível da política)', () => {
    actions.inboxTriar('THR-00007', { intencao: 'solicitar_orcamento', assunto: 'Mezanino metálico para loja', prioridade: 'Normal', nivel: 'A' });
    const t = thread('THR-00007');
    expect(t.classificacao?.provedor).toBe('HUMANO'); expect(t.setorCodigo).toBe('COMERCIAL'); expect(t.responsavelId).toBe('u-augusto'); expect(t.status).toBe('ATRIBUIDA');
    expect(t.nivel).toBe('B'); // a pessoa pediu A, a politica diz B para solicitar_orcamento: o mais restritivo vence
    expect(t.sla).toBeTruthy();
    expect(inbox().eventos.filter((e) => e.threadId === t.id).map((e) => e.tipo)).toEqual(expect.arrayContaining(['CLASSIFICADA', 'ROTEADA', 'ATRIBUIDA', 'STATUS']));
  });
  it('setor escolhido na triagem prevalece sobre a regra; quem já atende continua atendendo', () => {
    actions.inboxTriar('THR-00001', { intencao: 'consultar_pagamento', assunto: 'NF 583', setorCodigo: 'DIRETORIA', prioridade: 'Alta', nivel: 'C' });
    const t = thread('THR-00001');
    expect(t.setorCodigo).toBe('DIRETORIA'); expect(t.responsavelId).toBe('u-fin'); expect(t.nivel).toBe('C'); expect(t.prioridade).toBe('Alta');
  });
});

describe('ações, aprovações e jobs', () => {
  it('propor com aprovador leva a AGUARDANDO_APROVACAO; quem propôs não aprova; papel errado não aprova', () => {
    actions.trocarUsuario('u-obra');
    const a = actions.inboxProporAcao('THR-00005', { tipo: 'criar_tarefa', titulo: 'Reservar guindaste', descricao: 'para a troca do lote', papelDecisor: 'Diretoria' });
    expect(a.estado).toBe('aguardando_aprovacao'); expect(thread('THR-00005').status).toBe('AGUARDANDO_APROVACAO');
    expect(() => actions.inboxDecidirAcao(a.id, 'aprovada')).toThrow(/decidida por Diretoria/);
    actions.trocarUsuario('u-fin');
    expect(() => actions.inboxDecidirAcao(a.id, 'aprovada')).toThrow(/Diretoria/);
    actions.trocarUsuario('u-augusto');
    expect(() => actions.inboxDecidirAcao(a.id, 'rejeitada')).toThrow(/motivo/);
    actions.inboxDecidirAcao(a.id, 'aprovada');
    expect(inbox().acoes.find((x) => x.id === a.id)!.estado).toBe('aprovada'); expect(thread('THR-00005').status).toBe('EM_ATENDIMENTO');
    expect(audits().map((x) => x.acao)).toEqual(['inbox_acao_aprovada', 'inbox_propor_acao']); // auditoria: mais recente primeiro
  });
  it('executar criar_tarefa cria uma tarefa real do EIFF Control e guarda a referência', async () => {
    actions.trocarUsuario('u-obra');
    const a = actions.inboxProporAcao('THR-00002', { tipo: 'criar_tarefa', titulo: 'Conferir portão 2', descricao: 'antes das 8h' });
    expect(a.estado).toBe('aprovada');
    const n = getState().ds.tarefas.length;
    await actions.inboxExecutarAcao(a.id);
    expect(getState().ds.tarefas).toHaveLength(n + 1);
    const tarefa = getState().ds.tarefas[n];
    expect(tarefa.origem).toBe('inbox'); expect(tarefa.codigoObra).toBe('OB-SF-CL-01');
    expect(inbox().acoes.find((x) => x.id === a.id)).toMatchObject({ estado: 'executada', referencia: tarefa.id });
  });
  it('criar_job vai ao provider MANUAL (ENVIADO, sem referência externa); FACTORY é recusado e a ação fica como falhou', async () => {
    const a = actions.inboxProporAcao('THR-00006', { tipo: 'criar_job', titulo: 'Ajustar filtro', descricao: 'a aba não filtra' });
    await actions.inboxExecutarAcao(a.id);
    const job = inbox().jobs.find((j) => j.acaoId === a.id)!;
    expect(job.estado).toBe('ENVIADO'); expect(job.provider).toBe('MANUAL'); expect(job.referenciaExterna).toBeUndefined();
    const b = actions.inboxProporAcao('THR-00006', { tipo: 'criar_job', titulo: 'Outro', descricao: 'x' });
    await expect(actions.inboxExecutarAcao(b.id, { provider: 'FACTORY' })).rejects.toThrow(/Factory/);
    expect(inbox().acoes.find((x) => x.id === b.id)!.estado).toBe('falhou');
    expect(inbox().jobs.find((j) => j.acaoId === b.id)!.estado).toBe('RASCUNHO');
  });
  it('resultado de job registrado por pessoa encerra o job com evidências; job encerrado não recebe outro resultado', () => {
    actions.inboxRegistrarResultadoJob('JOB-00001', { ok: true, resumo: 'corrigido', evidencias: [{ tipo: 'pr', referencia: 'PR #99', descricao: 'correção' }] });
    const j = inbox().jobs.find((x) => x.id === 'JOB-00001')!;
    expect(j.estado).toBe('CONCLUIDO'); expect(j.resultado?.evidencias).toHaveLength(1);
    expect(() => actions.inboxRegistrarResultadoJob('JOB-00001', { ok: false, resumo: 'de novo' })).toThrow(/encerrado/);
  });
});

const msg = (p: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', identidade: { canal: 'WHATSAPP', identificador: '5562900000777', nomeInformado: 'Novo', verificada: false }, externalMessageId: 'ext-1', texto: 'olá, preciso de um orçamento', tipo: 'texto', em: new Date().toISOString(), ...p });

describe('gateway de entrada pelo store', () => {
  it('cria contato, thread NOVA com SLA e auditoria; reenvio é ignorado sem gravar nada', () => {
    const r = actions.inboxReceber(msg());
    expect(r.novaThread && r.novoContato).toBe(true);
    const t = thread(r.thread!.id);
    expect(t.status).toBe('NOVA'); expect(t.sla?.primeiraRespostaAte).toBeTruthy(); expect(t.nivel).toBe('C');
    const n = audits().length;
    const r2 = actions.inboxReceber(msg());
    expect(r2.duplicada).toBe(true); expect(audits()).toHaveLength(n); expect(inbox().mensagens.filter((m) => m.externalMessageId === 'ext-1')).toHaveLength(1);
  });
  it('mensagem de contato conhecido entra na thread dele', () => {
    const r = actions.inboxReceber(msg({ identidade: { canal: 'WHATSAPP', identificador: '5562900000101', verificada: false }, externalMessageId: 'ext-2' }));
    expect(r.novoContato).toBe(false); expect(r.thread?.id).toBe('THR-00001');
  });
});
