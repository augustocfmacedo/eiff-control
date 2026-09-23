// EIFF Inbox — adapter Supabase com helpers falsos: o que o adapter MANDA (ordem, insert-only, update sem select,
// nada de texto fora de inbox_message) e como LE (linhas -> InboxDataset). O que o banco ACEITA e assunto de
// scripts/pg-smoke-inbox.mjs.
import { describe, expect, it } from 'vitest';
import { seedInbox, inboxVazio } from '../core/inbox';
import { carregarInbox, persistirInbox, type HelpersInbox } from './inbox.supabase';

const ORG = '11111111-1111-1111-1111-111111111111';
const AGORA = '2026-09-23T12:00:00.000Z';
type Chamada = { op: 'inserir' | 'atualizar' | 'composta' | 'apagar'; tabela: string; rows: Record<string, unknown>[] };

function helpersFalsos(tabelas: Record<string, Record<string, unknown>[]> = {}) {
  const chamadas: Chamada[] = [];
  let seq = 0;
  const h: HelpersInbox = {
    sel: async (tabela) => tabelas[tabela] ?? [],
    inserir: async (tabela, rows) => { chamadas.push({ op: 'inserir', tabela, rows }); return rows.map(() => ({ id: `uuid-${tabela}-${++seq}` })); },
    atualizar: async (tabela, id, row) => { chamadas.push({ op: 'atualizar', tabela, rows: [{ id, ...row }] }); },
    gravarComposta: async (tabela, chave, row) => { chamadas.push({ op: 'composta', tabela, rows: [{ ...chave, ...row }] }); },
    apagar: async (tabela, id) => { chamadas.push({ op: 'apagar', tabela, rows: [{ id }] }); },
    orgId: ORG, atorId: 'perfil-ator', uuid: (v) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null), perfil: (id) => (id ? `perfil-${id}` : null),
    obra: (c) => (c ? `proj-${c}` : null), obraCodigo: (id) => (id ? String(id).replace('proj-', '') : undefined),
  };
  return { h, chamadas };
}

describe('escrita', () => {
  it('do vazio ao exemplo: ordem das dependências, mensagem/evento só INSERT, thread e configuração gravadas; texto só em inbox_message', async () => {
    const { h, chamadas } = helpersFalsos();
    await carregarInbox(h); // inicializa os refs
    const seed = seedInbox(AGORA);
    await persistirInbox(h, inboxVazio(), seed);
    const ordem = [...new Set(chamadas.map((c) => c.tabela))];
    const idx = (t: string) => ordem.indexOf(t);
    expect(idx('inbox_sector')).toBeLessThan(idx('inbox_team'));
    expect(idx('inbox_team')).toBeLessThan(idx('inbox_member'));
    expect(idx('inbox_contact')).toBeLessThan(idx('inbox_thread'));
    expect(idx('inbox_thread')).toBeLessThan(idx('inbox_action'));
    // atribuicao entra entre o insert e o update da thread (inbox_encaminhei no RLS)
    expect(idx('inbox_assignment')).toBeLessThan(idx('inbox_action'));
    expect(idx('inbox_action')).toBeLessThan(idx('inbox_message'));
    expect(idx('inbox_message')).toBeLessThan(idx('inbox_thread_event'));
    expect(chamadas.filter((c) => c.tabela === 'inbox_message').every((c) => c.op === 'inserir')).toBe(true);
    expect(chamadas.filter((c) => c.tabela === 'inbox_thread_event').every((c) => c.op === 'inserir')).toBe(true);
    expect(chamadas.filter((c) => c.tabela === 'inbox_thread' && c.op === 'inserir').flatMap((c) => c.rows)).toHaveLength(seed.threads.length);
    expect(chamadas.filter((c) => c.tabela === 'inbox_contact_identity' && c.op === 'composta')).toHaveLength(seed.contatos.flatMap((c) => c.identidades).length);
    expect(chamadas.some((c) => c.tabela === 'inbox_config' && c.op === 'composta')).toBe(true);
    // o corpo de cada mensagem aparece SO nas linhas de inbox_message
    const corpo = seed.mensagens[0].texto;
    for (const c of chamadas) { if (c.tabela !== 'inbox_message') expect(JSON.stringify(c.rows), c.tabela).not.toContain(corpo); }
    // ids de usuario do app viram perfil; participantes idem; obra vira project_id
    const t1 = chamadas.find((c) => c.tabela === 'inbox_thread')!.rows[0];
    expect(t1).toMatchObject({ assignee_id: 'perfil-u-fin', project_id: 'proj-OB-SF-CL-01', status: 'ATRIBUIDA' }); expect(String(t1.sector_id)).toMatch(/^uuid-inbox_sector-/); expect(String(t1.team_id)).toMatch(/^uuid-inbox_team-/);
    expect(t1.participant_ids).toEqual(['perfil-u-fin']);
    // o job criado ganhou o job_id de volta na acao
    expect(chamadas.some((c) => c.tabela === 'inbox_action' && c.op === 'atualizar' && c.rows[0].job_id === 'uuid-inbox_job-1' || (c.tabela === 'inbox_action' && c.op === 'atualizar' && typeof c.rows[0].job_id === 'string'))).toBe(true);
  });
  it('persistir o mesmo dataset de novo não grava nada; mudar o status de uma thread gera UM update sem select', async () => {
    const { h, chamadas } = helpersFalsos();
    await carregarInbox(h);
    const seed = seedInbox(AGORA);
    await persistirInbox(h, inboxVazio(), seed);
    chamadas.length = 0;
    await persistirInbox(h, seed, seed);
    expect(chamadas).toEqual([]);
    const depois = { ...seed, threads: seed.threads.map((t) => (t.id === 'THR-00001' ? { ...t, status: 'EM_ATENDIMENTO' as const } : t)) };
    await persistirInbox(h, seed, depois);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ op: 'atualizar', tabela: 'inbox_thread' });
    expect(chamadas[0].rows[0]).toMatchObject({ status: 'EM_ATENDIMENTO' }); expect(String(chamadas[0].rows[0].id)).toMatch(/^uuid-inbox_thread-/);
  });
  it('remover membro apaga a linha; setor novo é inserido e existente alterado', async () => {
    const { h, chamadas } = helpersFalsos();
    await carregarInbox(h);
    const seed = seedInbox(AGORA);
    await persistirInbox(h, inboxVazio(), seed);
    chamadas.length = 0;
    const depois = { ...seed, membros: seed.membros.filter((m) => m.id !== 'MBR-00002'), setores: [...seed.setores.map((s) => (s.codigo === 'OBRAS' ? { ...s, nome: 'Obras' } : s)), { codigo: 'NOVO', nome: 'Novo', ativo: true, ordem: 99 }] };
    await persistirInbox(h, seed, depois);
    expect(chamadas.map((c) => `${c.op}:${c.tabela}`)).toEqual(['atualizar:inbox_sector', 'inserir:inbox_sector', 'apagar:inbox_member']);
  });
});

describe('leitura', () => {
  it('linhas do banco viram InboxDataset com códigos de setor, identidades por contato e obra por código', async () => {
    const { h } = helpersFalsos({
      inbox_sector: [{ id: 'sec-1', code: 'FINANCEIRO', name: 'Financeiro', active: true, sort_order: 1, default_assignee_id: 'p-fin' }],
      inbox_team: [{ id: 'team-1', sector_id: 'sec-1', name: 'Contas a pagar', active: true, sort_order: 1 }],
      inbox_member: [{ id: 'mem-1', profile_id: 'p-fin', sector_id: 'sec-1', team_id: 'team-1', member_role: 'gestor' }],
      inbox_contact: [{ id: 'c-1', name: 'Paulo', company_name: 'Aços', relation_kind: 'fornecedor', project_codes: ['OB-SF-CL-01'], created_at: AGORA }],
      inbox_contact_identity: [{ id: 'i-1', contact_id: 'c-1', channel: 'WHATSAPP', identifier: '5562900000101', display_name: 'Paulo Aços', verified: false }],
      inbox_thread: [{ id: 't-1', channel: 'WHATSAPP', provider: 'META_CLOUD', context: 'EXTERNAL', contact_id: 'c-1', subject: 'NF 583', status: 'TRIADA', priority: 'Normal', service_level: 'B', sector_id: 'sec-1', team_id: 'team-1', participant_ids: [], project_id: 'proj-OB-SF-CL-01', labels: [], classification: { intencao: 'consultar_pagamento', assunto: 'NF', entidades: [], prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', confianca: 0.9, sinais: [], evidencias: [], provedor: 'LLM', versao: 'v', em: AGORA }, sla_first_response_due: AGORA, opened_at: AGORA, last_message_at: AGORA, origin: 'META_CLOUD' }],
      inbox_message: [{ id: 'm-1', thread_id: 't-1', provider: 'META_CLOUD', direction: 'inbound', content_type: 'texto', sender_kind: 'contato', sender_id: 'c-1', sender_name: 'Paulo', body: 'Bom dia', attachments: [], external_message_id: 'wamid.1', occurred_at: AGORA, meta: {} }],
      inbox_assignment: [{ id: 'a-1', thread_id: 't-1', sector_id: 'sec-1', team_id: 'team-1', assigned_at: AGORA, origin: 'roteamento' }],
      inbox_thread_event: [{ id: 'e-1', thread_id: 't-1', message_id: 'm-1', event_type: 'MESSAGE_RECEIVED', occurred_at: AGORA, actor_kind: 'contato', actor_id: 'c-1', actor_name: 'Paulo', detail: 'mensagem recebida (texto)' }],
      inbox_config: [{ organization_id: ORG, fallback_sector_code: 'FINANCEIRO', escalation_sector_code: 'FINANCEIRO', sla_hours: { Normal: 12 }, default_level: 'C', level_rules: [], routing_rules: [] }],
    });
    const ds = await carregarInbox(h);
    expect(ds.origem).toBe('remoto');
    expect(ds.setores[0]).toMatchObject({ codigo: 'FINANCEIRO', responsavelPadraoId: 'p-fin' });
    expect(ds.equipes[0]).toMatchObject({ id: 'team-1', setorCodigo: 'FINANCEIRO' });
    expect(ds.membros[0]).toMatchObject({ usuarioId: 'p-fin', setorCodigo: 'FINANCEIRO', equipeId: 'team-1', papel: 'gestor' });
    expect(ds.contatos[0].identidades).toEqual([{ canal: 'WHATSAPP', identificador: '5562900000101', nomeInformado: 'Paulo Aços', verificada: false }]);
    expect(ds.threads[0]).toMatchObject({ setorCodigo: 'FINANCEIRO', equipeId: 'team-1', codigoObra: 'OB-SF-CL-01', classificacao: { intencao: 'consultar_pagamento' }, sla: { primeiraRespostaAte: AGORA }, origem: 'META_CLOUD' });
    expect(ds.mensagens[0]).toMatchObject({ texto: 'Bom dia', autor: { tipo: 'contato', nome: 'Paulo' }, externalMessageId: 'wamid.1' }); expect(ds.mensagens[0].meta).toBeUndefined();
    expect(ds.atribuicoes[0]).toMatchObject({ setorCodigo: 'FINANCEIRO', origem: 'roteamento' });
    expect(ds.eventos[0]).toMatchObject({ tipo: 'MESSAGE_RECEIVED', mensagemId: 'm-1' });
    expect(ds.configuracao.slaHorasPorPrioridade).toEqual({ Urgente: 1, Alta: 4, Normal: 12, Baixa: 72 }); expect(ds.configuracao.nivelPadrao).toBe('C'); expect(ds.configuracao.regrasRoteamento.length).toBeGreaterThan(0);
  });
  it('sem tabelas (ou sem linhas) o slice é vazio e o app segue', async () => {
    const { h } = helpersFalsos();
    const ds = await carregarInbox(h);
    expect(ds.origem).toBe('vazio'); expect(ds.threads).toEqual([]);
  });
});
