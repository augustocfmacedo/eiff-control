// EIFF Inbox — kill switches do SHADOW MODE e a prova de que o Inbox não tem caminho de envio.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelInboundEvent } from '../radar/canais';
import { lerFlagsInbox, montarPortasInbox } from './ativacao';
import { ingerirEventosCentral } from './ingestaoServidor';
import { SETORES_PADRAO } from './tipos';

const ENV_OK = { SUPABASE_SERVICE_ROLE_KEY: 'srk-teste', EIFF_INBOX_ORGANIZATION_ID: 'org-1', SUPABASE_URL: 'https://x.supabase.co' };
const evento: ChannelInboundEvent = { provider: 'META_CLOUD', phoneNumberId: 'pn-1', contexto: 'EXTERNAL', externalConversationId: '5562999990000', externalMessageId: 'wamid.1', direction: 'inbound', eventType: 'MESSAGE_RECEIVED', occurredAt: '2026-09-24T12:00:00.000Z', contactPhone: '5562999990000', messageType: 'text' };
const conteudo = [{ externalMessageId: 'wamid.1', texto: 'A NF 583 já foi paga?' }];
/** fetch falso: a RPC de ingestão responde ok; qualquer outra chamada e registrada. */
function fetchFalso() {
  const chamadas: { url: string; metodo: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, metodo: init?.method ?? 'GET' });
    if (url.endsWith('/rpc/inbox_ingest')) return { ok: true, status: 200, json: async () => ({ ok: true, thread_id: 'T1', message_id: 'M1', nova_thread: true }) } as Response;
    if (url.includes('/inbox_thread?id=eq.')) return { ok: true, status: 200, json: async () => [] } as Response; // contexto indisponivel: router devolve ok=false sem lancar
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  return { fn: fn as unknown as typeof fetch, chamadas };
}

describe('flags do Inbox (server-side)', () => {
  it('padrões: inbox e router ligados, LLM desligada, outbound sempre false; valores textuais aceitos', () => {
    expect(lerFlagsInbox({})).toEqual({ inbox: true, router: true, llm: false, outbound: false, avisos: [] });
    expect(lerFlagsInbox({ EIFF_INBOX_ENABLED: 'false', EIFF_INBOX_ROUTER_ENABLED: '0', EIFF_INBOX_LLM_ENABLED: 'on' })).toMatchObject({ inbox: false, router: false, llm: true });
    const f = lerFlagsInbox({ EIFF_INBOX_OUTBOUND_ENABLED: 'true' });
    expect(f.outbound).toBe(false); expect(f.avisos[0]).toMatch(/ignorado/);
  });
  it('EIFF_INBOX_ENABLED=false: nada é montado (a Central segue sozinha) e nenhuma chamada acontece', () => {
    const { fn, chamadas } = fetchFalso();
    const p = montarPortasInbox({ ...ENV_OK, EIFF_INBOX_ENABLED: 'false' }, { fetch: fn });
    expect(p).toMatchObject({ ligado: false, motivo: 'EIFF_INBOX_ENABLED=false' }); expect(chamadas).toHaveLength(0);
    expect(montarPortasInbox({ EIFF_INBOX_ORGANIZATION_ID: 'org-1' }, { fetch: fn })).toMatchObject({ ligado: false, motivo: expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY') });
  });
  it('router desligado: a mensagem persiste pela RPC e cai em triagem (sem porta rotear, nenhuma leitura de contexto)', async () => {
    const { fn, chamadas } = fetchFalso();
    const p = montarPortasInbox({ ...ENV_OK, EIFF_INBOX_ROUTER_ENABLED: 'false' }, { fetch: fn });
    if (!p.ligado) throw new Error(p.motivo);
    expect(p.portas.rotear).toBeUndefined(); expect(p.llm).toBe(false);
    const r = await ingerirEventosCentral(p.organizacaoId, [evento], conteudo, p.portas);
    expect(r).toMatchObject({ ingeridos: 1, roteados: 0, atribuidos: 0, falhas: [] });
    expect(chamadas.map((c) => c.url)).toEqual([`${ENV_OK.SUPABASE_URL}/rest/v1/rpc/inbox_ingest`]);
  });
  it('LLM desligada: router determinístico roda sem provedor de IA mesmo com ANTHROPIC_API_KEY presente; ligada, o provedor entra', async () => {
    const { fn } = fetchFalso(); const logs: Record<string, unknown>[] = [];
    const off = montarPortasInbox({ ...ENV_OK, ANTHROPIC_API_KEY: 'sk-x', EIFF_INBOX_LLM_ENABLED: 'false' }, { fetch: fn, log: (t) => logs.push(t) });
    if (!off.ligado) throw new Error(off.motivo);
    expect(off.portas.rotear).toBeDefined(); expect(off.llm).toBe(false);
    expect(logs.some((l) => l.evento === 'inbox_inteligencia' && l.outcome === 'desligada')).toBe(true);
    const r = await ingerirEventosCentral(off.organizacaoId, [evento], conteudo, off.portas);
    expect(r.ingeridos).toBe(1); expect(r.classificados).toBe(0); // rotear rodou (contexto indisponivel no fake) sem IA e sem lancar
    const on = montarPortasInbox({ ...ENV_OK, ANTHROPIC_API_KEY: 'sk-x', EIFF_INBOX_LLM_ENABLED: 'true' }, { fetch: fn });
    if (!on.ligado) throw new Error(on.motivo);
    expect(on.llm).toBe(true);
    const semChave = montarPortasInbox({ ...ENV_OK, EIFF_INBOX_LLM_ENABLED: 'true' }, { fetch: fn });
    if (!semChave.ligado) throw new Error(semChave.motivo);
    expect(semChave.llm).toBe(false);
  });
  it('falha da IA nunca impede a ingestão nem o determinístico (coberto em roteamentoServidor.test.ts); aqui: IA que lança → relatório sem falhas', async () => {
    const { fn } = fetchFalso();
    const p = montarPortasInbox({ ...ENV_OK, ANTHROPIC_API_KEY: 'sk-x', EIFF_INBOX_LLM_ENABLED: 'true' }, { fetch: fn });
    if (!p.ligado) throw new Error(p.motivo);
    const r = await ingerirEventosCentral(p.organizacaoId, [evento], conteudo, p.portas);
    expect(r.falhas).toEqual([]); expect(r.ingeridos).toBe(1);
  });
});

describe('outbound desligado por construção (SHADOW MODE)', () => {
  const ler = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  it('nenhum módulo do Inbox nem o webhook da Central chama envio de mensagem (Graph /messages, send-template, sendApproved)', () => {
    const dir = path.join(process.cwd(), 'src/core/inbox');
    const arquivos = fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts')).map((x) => `src/core/inbox/${x}`);
    for (const f of [...arquivos, 'netlify/functions/channel-meta-webhook.ts']) {
      const s = ler(f);
      // (a unica URL com "messages" e a API de analise da Anthropic, que le e nunca envia a ninguem)
      expect(s, f).not.toMatch(/graph\.facebook\.com|\/chat\/[^'"`]*messages|send-template|sendApproved|octadesk|metaCloudProvider|whatsapp[^\n]*\/messages/i);
    }
    // as unicas requisicoes do Inbox sao as RPCs do proprio banco e a API de analise (leitura): nunca um canal
    const posts = arquivos.flatMap((f) => [...ler(f).matchAll(/fetchFn\(`\$\{cfg\.url\}\/rest\/v1\/rpc\/([a-z_]+)`|portas\.fetch\('([^']+)'/g)].map((x) => x[1] ?? x[2]));
    expect(new Set(posts)).toEqual(new Set(['inbox_ingest', 'inbox_apply_routing', 'https://api.anthropic.com/v1/messages']));
  });
  it('a flag de outbound nunca liga nada: o Inbox continua sem ChannelProvider real', async () => {
    const { PROVEDOR_MANUAL, provedorCanal } = await import('./fronteiras');
    expect(provedorCanal({ canal: 'WHATSAPP', provider: 'META_CLOUD' })).toBe(PROVEDOR_MANUAL);
    const r = await PROVEDOR_MANUAL.enviar({ thread: {} as never, contato: {} as never, texto: 'x' });
    expect(r.entrega).toBe('registrada');
  });
});

describe('migration 0058 — defaults do Inbox', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0058_inbox_defaults.sql'), 'utf8');
  it('semeia exatamente SETORES_PADRAO (códigos, nomes, ordem) por organização, sem UUID fixo, idempotente, sem equipes', () => {
    const linhas = [...sql.matchAll(/\('([A-Z_]+)', '([^']+)', (\d+)\)/g)].map((m) => ({ codigo: m[1], nome: m[2], ordem: Number(m[3]) }));
    expect(linhas).toEqual(SETORES_PADRAO.map((s) => ({ codigo: s.codigo, nome: s.nome, ordem: s.ordem })));
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(sql).toMatch(/from organization/); expect(sql).toMatch(/on conflict \(organization_id, code\) do nothing/); expect(sql).toMatch(/on conflict \(organization_id\) do nothing/);
    expect(sql).not.toMatch(/inbox_team|alter table|create /i);
  });
});
