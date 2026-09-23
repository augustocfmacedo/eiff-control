// EIFF Inbox — a porta governada no store: permissao, regra do core, auditoria, sem efeito externo.
// O que se prova aqui NAO e regra do Inbox (isso e do core, em src/core/inbox/inbox.test.ts): e o comportamento da
// PORTA — quem pode, o que muda, o que fica na trilha e o que nunca acontece (envio, IA, Factory).
import { readFileSync } from 'node:fs';
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
    expect(t.status).toBe('ATRIBUIDA'); expect(t.setorCodigo).toBe('COMERCIAL'); expect(t.responsavelId).toBe('u-augusto'); expect(t.participantes).toEqual([]);
    const ev = inbox().eventos.filter((e) => e.threadId === 'THR-00007').map((e) => e.tipo);
    expect(ev).toContain('ROUTED'); expect(ev).toContain('ASSIGNED'); expect(ev).toContain('STATUS_CHANGED');
    const atr = inbox().atribuicoes.filter((a) => a.threadId === 'THR-00007');
    expect(atr).toHaveLength(1); expect(atr[0]).toMatchObject({ setorCodigo: 'COMERCIAL', usuarioId: 'u-augusto', origem: 'manual', atorId: 'u-admin' }); expect(atr[0].liberadaEm).toBeUndefined();
    expect(audits().map((a) => a.acao)).toEqual(['inbox_atribuir']);
  });
  it('transferir mantém o histórico e marca TRANSFERIDA; sem mudança nada é gravado', () => {
    actions.inboxAtribuir('THR-00001', { setorCodigo: 'COMPRAS', responsavelId: 'u-compras' });
    const t = thread('THR-00001');
    expect(t.participantes).toEqual(['u-fin']); // encaminhar e receber nao tornam ninguem participante: historico fica na atribuicao
    expect(inbox().eventos.filter((e) => e.threadId === 'THR-00001' && e.tipo === 'REASSIGNED')).toHaveLength(2);
    // historico: a atribuicao anterior fechou (liberadaEm) e a nova esta vigente; quem transferiu virou participante
    const hist = inbox().atribuicoes.filter((a) => a.threadId === 'THR-00001');
    expect(hist).toHaveLength(2); expect(hist[0].liberadaEm).toBeTruthy(); expect(hist[1]).toMatchObject({ setorCodigo: 'COMPRAS', usuarioId: 'u-compras', atorId: 'u-admin' });
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
    expect(inbox().eventos.some((e) => e.threadId === t.id && e.tipo === 'MESSAGE_REGISTERED' && /nada foi enviado/.test(e.detalhe))).toBe(true);
    // auditoria nunca leva o texto: so ids, contagem e entrega
    expect(JSON.stringify(audits().find((x) => x.acao === 'inbox_responder'))).not.toContain('programada');
    const a = audits().find((x) => x.acao === 'inbox_responder')!;
    expect(a.depois).toMatchObject({ entrega: 'registrada' });
  });
  it('usar a sugestão marca a sugestão como aceita; descartar exige que esteja pendente', async () => {
    actions.trocarUsuario('u-fin');
    const s = inbox().acoes.find((x) => x.threadId === 'THR-00001' && x.tipo === 'responder' && x.estado === 'proposta')!;
    const m = await actions.inboxResponder('THR-00001', s.descricao, { propostaId: s.id });
    expect(inbox().acoes.find((x) => x.id === s.id)).toMatchObject({ estado: 'executada', referencia: m.id }); expect(m.propostaId).toBe(s.id);
    expect(() => actions.inboxDescartarSugestao(s.id)).toThrow(/já decidida/);
  });
  it('responder em conversa fechada é recusado; nota interna não muda o status', async () => {
    actions.inboxMudarStatus('THR-00008', 'FECHADA');
    await expect(actions.inboxResponder('THR-00008', 'oi')).rejects.toThrow(/fechada/i);
    actions.inboxAnotar('THR-00001', 'conferir no contas a pagar');
    expect(thread('THR-00001').status).toBe('ATRIBUIDA');
    const notas = inbox().mensagens.filter((m) => m.threadId === 'THR-00001' && m.direcao === 'interna');
    expect(notas).toHaveLength(1); expect(notas[0].tipo).toBe('nota');
    expect(inbox().eventos.some((e) => e.tipo === 'NOTE_ADDED' && e.mensagemId === notas[0].id)).toBe(true);
    expect(JSON.stringify(audits().find((x) => x.acao === 'inbox_anotar'))).not.toContain('contas a pagar');
  });
});

describe('triagem humana', () => {
  it('classifica com provedor HUMANO e roteia pelas regras do core (setor da regra, responsável padrão, nível da política)', () => {
    actions.inboxTriar('THR-00007', { intencao: 'solicitar_orcamento', assunto: 'Mezanino metálico para loja', prioridade: 'Normal', nivel: 'A' });
    const t = thread('THR-00007');
    expect(t.classificacao?.provedor).toBe('HUMANO'); expect(t.setorCodigo).toBe('COMERCIAL'); expect(t.responsavelId).toBe('u-augusto'); expect(t.status).toBe('ATRIBUIDA');
    expect(t.nivel).toBe('B'); // a pessoa pediu A, a politica diz B para solicitar_orcamento: o mais restritivo vence
    expect(t.sla).toBeTruthy();
    expect(inbox().eventos.filter((e) => e.threadId === t.id).map((e) => e.tipo)).toEqual(expect.arrayContaining(['TRIAGED', 'ROUTED', 'ASSIGNED', 'STATUS_CHANGED']));
    expect(inbox().atribuicoes.find((a) => a.threadId === t.id && !a.liberadaEm)).toMatchObject({ setorCodigo: 'COMERCIAL', usuarioId: 'u-augusto', origem: 'triagem' });
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

describe('autoridade dentro da permissão', () => {
  it('atendente de outro setor não muda status nem transfere; pode assumir conversa sem responsável do seu recorte', () => {
    actions.trocarUsuario('u-contab'); // Contabilidade: atendente de FINANCEIRO (equipe Faturamento), tem `inbox`
    expect(() => actions.inboxMudarStatus('THR-00001', 'AGUARDANDO_CONTATO')).toThrow(/responsável, o gestor/);
    expect(() => actions.inboxAtribuir('THR-00001', { responsavelId: 'u-contab' })).toThrow(/transferem/);
    actions.inboxAtribuir('THR-00007', { responsavelId: 'u-contab' }); // NOVA sem setor: assumir e permitido
    expect(thread('THR-00007').responsavelId).toBe('u-contab'); expect(thread('THR-00007').status).toBe('ATRIBUIDA');
  });
});

describe('configuração (inbox_config)', () => {
  it('usuário sem inbox_config não administra setores, equipes, membros nem roteamento', () => {
    actions.trocarUsuario('u-fin');
    expect(() => actions.inboxSalvarSetor({ codigo: 'JURIDICO', nome: 'Jurídico', ativo: true, ordem: 6 })).toThrow(RegraDeNegocioError);
    expect(() => actions.inboxSalvarEquipe({ setorCodigo: 'FINANCEIRO', nome: 'Cobrança', ativo: true, ordem: 3 })).toThrow(RegraDeNegocioError);
    expect(() => actions.inboxSalvarMembro({ usuarioId: 'u-contab', setorCodigo: 'OBRAS', papel: 'atendente' })).toThrow(RegraDeNegocioError);
    expect(() => actions.inboxRemoverMembro('MBR-00001')).toThrow(RegraDeNegocioError);
    expect(() => actions.inboxSalvarConfiguracao({ setorFallback: 'OBRAS' })).toThrow(RegraDeNegocioError);
    expect(audits()).toHaveLength(0);
  });
  it('Administrador cria setor, equipe e membro com validação e auditoria; duplicidade é recusada', () => {
    actions.inboxSalvarSetor({ codigo: 'pos venda 2', nome: 'Pós-venda 2', ativo: true, ordem: 13 });
    expect(inbox().setores.find((s) => s.codigo === 'POS_VENDA_2')).toBeTruthy();
    const eq = actions.inboxSalvarEquipe({ setorCodigo: 'FINANCEIRO', nome: 'Cobrança', ativo: true, ordem: 3, responsavelPadraoId: 'u-contab' });
    expect(() => actions.inboxSalvarEquipe({ setorCodigo: 'FINANCEIRO', nome: 'cobrança', ativo: true, ordem: 4 })).toThrow(/Já existe/);
    const m = actions.inboxSalvarMembro({ usuarioId: 'u-contab', setorCodigo: 'FINANCEIRO', equipeId: eq.id, papel: 'atendente' });
    expect(() => actions.inboxSalvarMembro({ usuarioId: 'u-contab', setorCodigo: 'FINANCEIRO', equipeId: eq.id, papel: 'gestor' })).toThrow(/já é membro/);
    expect(() => actions.inboxSalvarMembro({ usuarioId: 'u-contab', setorCodigo: 'OBRAS', equipeId: eq.id, papel: 'atendente' })).toThrow(/não é do setor/);
    actions.inboxRemoverMembro(m.id);
    expect(inbox().membros.some((x) => x.id === m.id)).toBe(false);
    expect(() => actions.inboxSalvarConfiguracao({ setorFallback: 'NAO_EXISTE' })).toThrow(/fallback/);
    actions.inboxSalvarConfiguracao({ slaHorasPorPrioridade: { Urgente: 0.5, Alta: 2, Normal: 12, Baixa: 48 } });
    expect(inbox().configuracao.slaHorasPorPrioridade.Normal).toBe(12);
    expect(audits().map((a) => a.acao)).toEqual(expect.arrayContaining(['inbox_criar_setor', 'inbox_criar_equipe', 'inbox_criar_membro', 'inbox_remover_membro', 'inbox_alterar_configuracao']));
  });
  it('carregar exemplo é recusado fora do modo local (a suíte roda em modo local: a regra é lida no código do store)', () => {
    const codigo = readFileSync('src/data/store.ts', 'utf8');
    expect(codigo).toMatch(/inboxCarregarExemplo\(\) \{[\s\S]*?state\.modo === 'remoto'[\s\S]*?throw new RegraDeNegocioError/);
  });
});

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
