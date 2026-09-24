// EIFF Inbox — Octopus Router no servidor (fase 3): portas REST/RPC com fetch falso, provedor Anthropic com fetch falso,
// orquestracao `rotearNoServidor` (deterministico sempre, IA como refino, nunca lanca) e a porta `rotear` da ingestao.
// Nenhuma chamada real: tudo e mock; nenhum segredo sai em log ou erro.
import { describe, expect, it, vi } from 'vitest';
import type { ChannelInboundEvent } from '../radar/canais';
import { ingerirEventosCentral, seedInbox, type Classificacao, type InboxDataset, type InboxMessage, type InboxThread } from './index';
import { ESQUEMA_ANALISE_INBOX, configInteligencia, contextoParaIa, interpretarSaidaIa, provedorAnthropic } from './inteligenciaLlm';
import { portaAplicarRoteamentoRpc, portaContextoRest, rotearNoServidor, type ContextoServidor, type PedidoAplicarRoteamento } from './roteamentoPorta';

const AGORA = '2026-09-23T12:00:00.000Z';
const CHAVE = 'sk-teste-nunca-vaza';
const CFG = { url: 'https://x.supabase.co', chave: CHAVE, organizacaoId: 'org-1' };
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body } as unknown as Response);

function contextoDe(inbox: InboxDataset, threadId: string, texto?: string): ContextoServidor {
  const thread = inbox.threads.find((t) => t.id === threadId)!;
  const msgs = inbox.mensagens.filter((m) => m.threadId === threadId);
  const mensagem: InboxMessage = texto ? { id: 'MSG-N', threadId, provider: 'META_CLOUD', direcao: 'inbound', tipo: 'texto', autor: { tipo: 'contato', nome: 'x' }, texto, anexos: [], em: AGORA } : msgs.filter((m) => m.direcao === 'inbound').at(-1)!;
  const contato = inbox.contatos.find((c) => c.id === thread.contatoId);
  return {
    entrada: { inbox: { ...inbox, mensagens: [...msgs, ...(texto ? [mensagem] : [])] }, thread, mensagem, obras: [], usuarios: [{ id: 'u-fin', ativo: true }, { id: 'u-obra', ativo: true }, { id: 'u-eng', ativo: true }, { id: 'u-compras', ativo: true }, { id: 'u-augusto', ativo: true }, { id: 'u-admin', ativo: true }], agora: AGORA },
    setores: inbox.setores.filter((s) => s.ativo).map((s) => ({ codigo: s.codigo, nome: s.nome })), equipes: inbox.equipes, regras: [], obras: contato?.obras.map((c) => ({ codigo: c })) ?? [],
  };
}

describe('portas REST/RPC do router (fetch injetado, chave nunca vaza)', () => {
  it('portaContextoRest lê só o necessário de UMA thread e monta a entrada do router com códigos de setor', async () => {
    const chamadas: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push(url);
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${CHAVE}`);
      if (url.includes('/inbox_thread?id=eq.T1')) return json([{ id: 'T1', channel: 'WHATSAPP', context: 'EXTERNAL', contact_id: 'C1', subject: 'NF', status: 'NOVA', priority: 'Normal', service_level: 'C', sector_id: null, participant_ids: [], labels: [], opened_at: AGORA, last_message_at: AGORA }]);
      if (url.includes('/inbox_thread?contact_id=eq.C1')) return json([{ id: 'T0', channel: 'WHATSAPP', context: 'EXTERNAL', contact_id: 'C1', subject: 'antiga', status: 'RESOLVIDA', priority: 'Normal', service_level: 'B', sector_id: 'S-FIN', assignee_id: 'P-FIN', classification: { intencao: 'consultar_pagamento' }, opened_at: AGORA, last_message_at: AGORA }]);
      if (url.includes('/inbox_message?')) return json([{ id: 'M1', thread_id: 'T1', provider: 'META_CLOUD', direction: 'inbound', content_type: 'texto', sender_kind: 'contato', sender_name: 'Paulo', body: 'A NF 583 foi paga?', attachments: [], occurred_at: AGORA }]);
      if (url.includes('/inbox_contact?')) return json([{ id: 'C1', name: 'Paulo', relation_kind: 'fornecedor', project_codes: ['OB-1'], created_at: AGORA }]);
      if (url.includes('/inbox_contact_identity?')) return json([{ channel: 'WHATSAPP', identifier: '5562999990000', verified: false }]);
      if (url.includes('/inbox_sector?')) return json([{ id: 'S-FIN', code: 'FINANCEIRO', name: 'Financeiro', active: true, sort_order: 1, default_assignee_id: 'P-FIN' }, { id: 'S-OBR', code: 'OBRAS', name: 'Obras', active: true, sort_order: 2 }]);
      if (url.includes('/inbox_team?')) return json([{ id: 'Q1', sector_id: 'S-OBR', name: 'Canteiro', active: true, sort_order: 1 }]);
      if (url.includes('/inbox_member?')) return json([{ id: 'M-1', profile_id: 'P-FIN', sector_id: 'S-FIN', member_role: 'gestor' }]);
      if (url.includes('/inbox_config?')) return json([{ fallback_sector_code: 'FINANCEIRO', escalation_sector_code: 'OBRAS', sla_hours: { Alta: 2 }, default_level: 'B', level_rules: [], routing_rules: [], automation_rules: [], auto_routing: { confiancaAtribuirPessoa: 0.9 } }]);
      if (url.includes('/profile?')) return json([{ id: 'P-FIN', role: 'Financeiro' }]);
      return json([], 404);
    });
    const ctx = await portaContextoRest(CFG, fetchFn as unknown as typeof fetch)('T1', 'M1');
    expect(ctx).toBeDefined();
    const e = ctx!.entrada;
    expect(e.thread.id).toBe('T1'); expect(e.mensagem.texto).toBe('A NF 583 foi paga?'); expect(e.inbox.threads.map((t) => t.id)).toEqual(['T1', 'T0']);
    expect(e.inbox.threads[1].setorCodigo).toBe('FINANCEIRO'); expect(e.inbox.equipes[0].setorCodigo).toBe('OBRAS'); expect(e.inbox.membros[0]).toMatchObject({ usuarioId: 'P-FIN', setorCodigo: 'FINANCEIRO' });
    expect(e.inbox.configuracao.slaHorasPorPrioridade.Alta).toBe(2); expect(e.inbox.configuracao.autoRoteamento.confiancaAtribuirPessoa).toBe(0.9); expect(e.inbox.configuracao.autoRoteamento.confiancaAtribuirSetor).toBe(0.6);
    expect(e.inbox.contatos[0].obras).toEqual(['OB-1']); expect(ctx!.obras).toEqual([{ codigo: 'OB-1' }]);
    expect(chamadas.every((u) => u.startsWith(CFG.url + '/rest/v1/'))).toBe(true);
    expect(chamadas.some((u) => u.includes('inbox_message?thread_id=eq.T1') && u.includes('limit=10'))).toBe(true);
    // thread inexistente: undefined, sem lancar
    const nada = await portaContextoRest(CFG, (async () => json([])) as unknown as typeof fetch)('T9', 'M9');
    expect(nada).toBeUndefined();
  });
  it('portaAplicarRoteamentoRpc posta na RPC inbox_apply_routing com os parâmetros esperados; erro HTTP carrega só o status', async () => {
    let corpo: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => { corpo = JSON.parse(String(init?.body)); return json({ ok: true, aplicado: true, status: 'ATRIBUIDA' }); });
    const p: PedidoAplicarRoteamento = { threadId: 'T1', messageId: 'M1', routing: { versao: 'octopus-1' } as never, sectorCode: 'FINANCEIRO', assigneeId: 'P-FIN', priority: 'Alta', serviceLevel: 'B', apply: true };
    const r = await portaAplicarRoteamentoRpc(CFG, fetchFn as unknown as typeof fetch)(p);
    expect(r).toMatchObject({ ok: true, aplicado: true, status: 'ATRIBUIDA' });
    expect(fetchFn.mock.calls[0][0]).toBe(`${CFG.url}/rest/v1/rpc/inbox_apply_routing`);
    expect(corpo).toMatchObject({ p_organization_id: 'org-1', p_thread_id: 'T1', p_message_id: 'M1', p_sector_code: 'FINANCEIRO', p_assignee_id: 'P-FIN', p_team_id: null, p_priority: 'Alta', p_service_level: 'B', p_apply: true, p_classification: null });
    await expect(portaAplicarRoteamentoRpc(CFG, (async () => json({ message: CHAVE }, 500)) as unknown as typeof fetch)(p)).rejects.toThrow(/http 500$/);
  });
});

describe('rotearNoServidor: determinístico sempre, IA como refino, nunca lança', () => {
  const seed = seedInbox(AGORA);
  const aplicar = () => { const pedidos: PedidoAplicarRoteamento[] = []; return { pedidos, fn: async (p: PedidoAplicarRoteamento) => { pedidos.push(p); return { ok: true, aplicado: p.apply }; } }; };

  it('sem IA: thread nova de fornecedor com pagamento → aplica FINANCEIRO / u-fin (HIGH) pela RPC', async () => {
    const a = aplicar(); const logs: Record<string, unknown>[] = [];
    const r = await rotearNoServidor('THR-00007', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00007', 'Bom dia, a NF 320 já foi paga? Preciso do comprovante do pagamento.'), aplicar: a.fn, log: (t) => logs.push(t), agora: () => AGORA });
    expect(r).toMatchObject({ ok: true, aplicado: true, origem: 'DETERMINISTICO', setorCodigo: 'FINANCEIRO', classificado: false });
    expect(a.pedidos[0]).toMatchObject({ threadId: 'THR-00007', sectorCode: 'FINANCEIRO', apply: true, serviceLevel: expect.any(String) });
    expect(a.pedidos[0].routing.versao).toBe('octopus-1'); expect(a.pedidos[0].classification).toBeUndefined();
    expect(logs.at(-1)).toMatchObject({ evento: 'inbox_roteamento', outcome: 'ok', aplicado: true });
  });
  it('IA disponível refina (classificação persistida, origem HIBRIDO); IA quebrada não impede o roteamento', async () => {
    const ia = { codigo: 'LLM' as const, analisar: async () => ({ ok: true as const, resultado: { intencao: 'consultar_pagamento', assunto: 'Pagamento NF', entidades: [], prioridade: 'Alta' as const, setorRecomendado: 'FINANCEIRO', confianca: 0.9, sinais: ['cita NF'], resumo: 'Fornecedor cobra NF.', provedor: 'LLM' as const, versao: 'inbox-router-llm-1' } }) };
    const a = aplicar();
    const r = await rotearNoServidor('THR-00007', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00007', 'A NF 320 já foi paga?'), aplicar: a.fn, inteligencia: () => ia });
    expect(r).toMatchObject({ ok: true, aplicado: true, origem: 'HIBRIDO', classificado: true });
    expect(a.pedidos[0].classification?.provedor).toBe('LLM'); expect(a.pedidos[0].summary).toBe('Fornecedor cobra NF.'); expect(a.pedidos[0].priority).toBe('Alta');
    const quebrada = { codigo: 'LLM' as const, analisar: async () => { throw new Error('boom'); } };
    const b = aplicar(); const logs: Record<string, unknown>[] = [];
    const r2 = await rotearNoServidor('THR-00007', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00007', 'A NF 320 já foi paga?'), aplicar: b.fn, inteligencia: () => quebrada, log: (t) => logs.push(t) });
    expect(r2).toMatchObject({ ok: true, aplicado: true, origem: 'DETERMINISTICO', classificado: false });
    expect(logs.some((l) => l.evento === 'inbox_inteligencia' && l.outcome === 'indisponivel')).toBe(true);
  });
  it('baixa confiança → apply false (sugestão registrada, thread fica em Não atribuídos)', async () => {
    const a = aplicar();
    const r = await rotearNoServidor('THR-00007', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00007', 'oi'), aplicar: a.fn });
    expect(r.ok).toBe(true); expect(r.aplicado).toBe(false); expect(r.banda).toBe('LOW'); expect(a.pedidos[0].apply).toBe(false); expect(a.pedidos[0].assigneeId).toBeUndefined();
  });
  it('thread já roteada: reavalia — KEEP/RECOMMEND não aplicam; AUTO_TRANSFER aplica; override humano viaja na decisão', async () => {
    const a = aplicar();
    const r = await rotearNoServidor('THR-00001', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00001', 'A carreta chega amanhã? Precisamos liberar a descarga na obra.'), aplicar: a.fn });
    expect(r.reavaliacao).toBe('RECOMMEND_TRANSFER'); expect(a.pedidos[0].apply).toBe(false); expect(a.pedidos[0].routing.reavaliacao?.veredicto).toBe('RECOMMEND_TRANSFER');
    const comAuto: InboxDataset = { ...seed, configuracao: { ...seed.configuracao, autoRoteamento: { ...seed.configuracao.autoRoteamento, transferenciaAutomatica: true, confiancaTransferir: 0.8 } } };
    const b = aplicar();
    const r2 = await rotearNoServidor('THR-00010', 'MSG-N', { contexto: async () => contextoDe(comAuto, 'THR-00010', 'A carreta com as vigas chega amanhã cedo, favor liberar a descarga na obra.'), aplicar: b.fn });
    expect(r2.reavaliacao).toBe('AUTO_TRANSFER'); expect(b.pedidos[0]).toMatchObject({ apply: true, sectorCode: 'OBRAS' });
    const t1: InboxThread = { ...seed.threads.find((t) => t.id === 'THR-00001')!, roteamento: { ...(a.pedidos[0].routing), override: { por: 'u-fin', em: AGORA, de: {}, para: { setorCodigo: 'FINANCEIRO' } } } };
    const comOverride: InboxDataset = { ...comAuto, threads: comAuto.threads.map((t) => (t.id === 'THR-00001' ? t1 : t)) };
    const c = aplicar();
    const r3 = await rotearNoServidor('THR-00001', 'MSG-N', { contexto: async () => contextoDe(comOverride, 'THR-00001', 'A carreta chega amanhã? Liberar a descarga na obra.'), aplicar: c.fn });
    expect(r3.reavaliacao).toBe('KEEP'); expect(c.pedidos[0].apply).toBe(false); expect(c.pedidos[0].routing.override?.por).toBe('u-fin');
  });
  it('contexto indisponível ou RPC falhando: { ok: false } com motivo, sem lançar e sem vazar a chave', async () => {
    const r = await rotearNoServidor('T', 'M', { contexto: async () => undefined, aplicar: async () => ({ ok: true }) });
    expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'contexto indisponível' });
    const logs: Record<string, unknown>[] = [];
    const r2 = await rotearNoServidor('THR-00007', 'MSG-N', { contexto: async () => contextoDe(seed, 'THR-00007', 'A NF 1 foi paga?'), aplicar: async () => { throw new Error('rpc inbox_apply_routing http 500'); }, log: (t) => logs.push(t) });
    expect(r2.ok).toBe(false); expect(r2.motivo).toMatch(/http 500/); expect(JSON.stringify(logs)).not.toContain(CHAVE);
  });
});

describe('ingestão com a porta rotear (fase 3)', () => {
  const evento: ChannelInboundEvent = { provider: 'META_CLOUD', phoneNumberId: 'pn-1', contexto: 'EXTERNAL', externalConversationId: '5562999990000', externalMessageId: 'wamid.1', direction: 'inbound', eventType: 'MESSAGE_RECEIVED', occurredAt: AGORA, contactPhone: '5562999990000', messageType: 'text' };
  it('quando a porta existe, cada mensagem ingerida é roteada e o relatório conta roteados/atribuídos; a porta nunca derruba a ingestão', async () => {
    const rotear = vi.fn(async () => ({ ok: true, aplicado: true, classificado: false }));
    const r = await ingerirEventosCentral('org-1', [evento], [{ externalMessageId: 'wamid.1', texto: 'A NF 1 foi paga?' }], { ingerir: async () => ({ ok: true, threadId: 'T1', messageId: 'M1' }), rotear });
    expect(rotear).toHaveBeenCalledWith('T1', 'M1'); expect(r).toMatchObject({ ingeridos: 1, roteados: 1, atribuidos: 1, classificados: 0, semInteligencia: 1, falhas: [] });
    const r2 = await ingerirEventosCentral('org-1', [evento], [{ externalMessageId: 'wamid.1', texto: 'x' }], { ingerir: async () => ({ ok: true, threadId: 'T1', messageId: 'M1' }), rotear: async () => ({ ok: false, aplicado: false, classificado: false, motivo: 'contexto indisponível' }) });
    expect(r2).toMatchObject({ ingeridos: 1, roteados: 0, atribuidos: 0, falhas: [] });
    // duplicada nao roteia
    const r3 = await ingerirEventosCentral('org-1', [evento], [], { ingerir: async () => ({ ok: true, duplicada: true, threadId: 'T1', messageId: 'M1' }), rotear });
    expect(r3.duplicados).toBe(1); expect(rotear).toHaveBeenCalledTimes(1);
  });
});

describe('provedor Anthropic do Inbox (server-side, fetch injetado)', () => {
  const seed = seedInbox(AGORA);
  const entrada = () => { const t = seed.threads.find((x) => x.id === 'THR-00001')!; return { thread: t, mensagem: seed.mensagens.find((m) => m.threadId === t.id)!, historico: seed.mensagens.filter((m) => m.threadId === t.id), contato: seed.contatos.find((c) => c.id === t.contatoId), organizacaoId: 'org-1', contexto: 'EXTERNAL' as const, setoresDisponiveis: seed.setores.map((s) => ({ codigo: s.codigo, nome: s.nome })) }; };
  it('configInteligencia: sem chave não há provedor; modelo e timeout do ambiente com padrões', () => {
    expect(configInteligencia({})).toMatchObject({ motivo: expect.stringContaining('ANTHROPIC_API_KEY') });
    expect(configInteligencia({ ANTHROPIC_API_KEY: ' k ' })).toEqual({ chave: 'k', modelo: 'claude-sonnet-5', timeoutMs: 20_000 });
    expect(configInteligencia({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_INBOX_MODEL: 'claude-haiku-4-5-20251001', ANTHROPIC_INBOX_TIMEOUT_MS: '5000' })).toEqual({ chave: 'k', modelo: 'claude-haiku-4-5-20251001', timeoutMs: 5000 });
  });
  it('o contexto enviado ao modelo nunca leva telefone, e-mail ou identidade de canal; leva setores, equipes, regras e histórico limitado', () => {
    const ctx = contextoParaIa(entrada(), { equipes: seed.equipes, regras: [{ id: 'ROT-02', setorCodigo: 'FINANCEIRO', motivo: 'pagamento' }], obras: [{ codigo: 'OB-SF-CL-01' }] });
    const s = JSON.stringify(ctx);
    expect(s).not.toMatch(/5562900000101|identificador|identidades|@/); expect(s).toContain('FINANCEIRO'); expect(s).toContain('ROT-02'); expect(s).toContain('Contas a pagar');
    expect((ctx.historicoRecente as unknown[]).length).toBeLessThanOrEqual(10);
    expect(ESQUEMA_ANALISE_INBOX.required).toContain('confianca');
  });
  it('interpretarSaidaIa valida contra catálogos: setor/equipe fora viram nulo, confiança fora de 0-1 é recusada, sinais encurtados e sem telefone', () => {
    const e = entrada();
    const ok = interpretarSaidaIa({ intencao: 'Consultar Pagamento!', assunto: 'Pagamento', resumo: 'x', prioridade: 'Alta', setorRecomendado: 'FINANCEIRO', equipeRecomendadaId: 'EQP-00001', acaoSugerida: 'consultar', confianca: 0.87, sinais: ['cita NF 583', 'liga 5562900000101 agora', 'a'.repeat(400)], entidades: [{ tipo: 'nota_fiscal', valor: 'NF 583' }, { tipo: 'invalido', valor: 'x' }, { tipo: 'pessoa', valor: '5562900000101' }], motivoOperacional: 'm' }, e, { equipes: seed.equipes }, 'm');
    expect(ok).toMatchObject({ intencao: 'consultar_pagamento', setorRecomendado: 'FINANCEIRO', equipeRecomendadaId: 'EQP-00001', prioridade: 'Alta', confianca: 0.87, provedor: 'LLM', modelo: 'm' });
    if ('erro' in ok) throw new Error(ok.erro);
    expect(ok.sinais).toHaveLength(2); expect(ok.sinais[1].length).toBeLessThanOrEqual(160); expect(ok.entidades).toEqual([{ tipo: 'nota_fiscal', valor: 'NF 583', mensagemId: e.mensagem.id }]);
    expect(interpretarSaidaIa({ intencao: 'x', assunto: 'y', confianca: 1.2 }, e, {}, 'm')).toMatchObject({ erro: expect.stringContaining('0-1') });
    expect(interpretarSaidaIa({ intencao: 'x', assunto: 'y', confianca: 0.5, setorRecomendado: 'NAO_EXISTE', equipeRecomendadaId: 'EQP-00003', prioridade: 'Máxima' }, e, { equipes: seed.equipes }, 'm')).toMatchObject({ setorRecomendado: undefined, prioridade: 'Normal' });
    expect(interpretarSaidaIa('texto', e, {}, 'm')).toMatchObject({ erro: expect.any(String) });
  });
  it('provedorAnthropic: chamada com json_schema e chave no header; resposta válida vira resultado; HTTP, JSON inválido, truncada e timeout viram { ok: false } sem lançar', async () => {
    const cfg = { chave: CHAVE, modelo: 'claude-sonnet-5', timeoutMs: 50 };
    let init: RequestInit | undefined;
    const bom = vi.fn(async (_u: string, i?: RequestInit) => { init = i; return json({ content: [{ type: 'text', text: JSON.stringify({ intencao: 'consultar_pagamento', assunto: 'NF', resumo: 'r', prioridade: 'Normal', setorRecomendado: 'FINANCEIRO', equipeRecomendadaId: null, acaoSugerida: null, confianca: 0.8, sinais: ['nf'], entidades: [], motivoOperacional: 'm' }) }], stop_reason: 'end_turn' }); });
    const r = await provedorAnthropic(cfg, { fetch: bom as unknown as typeof fetch }).analisar(entrada());
    expect(r.ok).toBe(true); if (r.ok) expect(r.resultado).toMatchObject({ intencao: 'consultar_pagamento', setorRecomendado: 'FINANCEIRO', provedor: 'LLM', versao: 'inbox-router-llm-1' });
    const corpo = JSON.parse(String(init?.body));
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe(CHAVE); expect(corpo.output_config.format.type).toBe('json_schema'); expect(corpo.model).toBe('claude-sonnet-5'); expect(JSON.stringify(corpo.messages)).not.toMatch(/5562900000101/);
    const http = await provedorAnthropic(cfg, { fetch: (async () => json({ error: CHAVE }, 529)) as unknown as typeof fetch }).analisar(entrada());
    expect(http).toEqual({ ok: false, motivo: 'ia http 529' });
    const naoJson = await provedorAnthropic(cfg, { fetch: (async () => json({ content: [{ type: 'text', text: 'não é json' }] })) as unknown as typeof fetch }).analisar(entrada());
    expect(naoJson.ok).toBe(false);
    const truncada = await provedorAnthropic(cfg, { fetch: (async () => json({ content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' })) as unknown as typeof fetch }).analisar(entrada());
    expect(truncada).toEqual({ ok: false, motivo: 'saída da IA truncada' });
    const lenta = await provedorAnthropic(cfg, { fetch: ((_: string, i?: RequestInit) => new Promise((_res, rej) => i?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch }).analisar(entrada());
    expect(lenta.ok).toBe(false); if (!lenta.ok) expect(lenta.motivo).toMatch(/timeout/);
  });
});

// tipagem: Classificacao continua sendo o contrato que a IA preenche (sem chave nova obrigatoria)
const _c: Classificacao | undefined = undefined; void _c;
