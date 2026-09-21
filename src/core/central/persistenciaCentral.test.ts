// EIFF Central — Wave 03 F2-DATA: provas do escritor unico (idempotencia, crash recovery, concorrencia, PII).
// Nenhuma rede: o cliente e um PostgREST FALSO em memoria que emula o que importa das migrations 0050/0052 —
// unicidades (central_conversation_chave_uk, central_message_externo_uk, PK do conteudo, indices parciais
// central_event_mensagem_uk e central_message_processing_webhook_uk), erro 23505, `on conflict do nothing`,
// trigger de status da mensagem (nunca anda para tras), imutabilidade do conteudo/processamento e os CHECKs da 0052.
// Tambem emula o que o Postgres faz com ON CONFLICT sobre indice parcial sem predicado (42P10): e por isso que o
// escritor insere eventos tolerando 23505 em vez de fazer upsert.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelInboundEvent } from '../radar/canais';
import { TABELA_IDENTIDADE } from '../../data/datasetServidor';
import { aplicarEventos, type EstadoCentral } from './conversa';
import { criarPersistenciaCentral, sha256, textoSeguro } from './persistenciaCentral';
import { ErroCentralServidor, FLOW_VERSION, NORMALIZATION_VERSION, TABELAS_ESCRITA_CENTRAL, type LotePersistencia, type PortasPersistenciaCentral, type RegistroProcessamento } from './servidorContratos';

// ---------------------------------------------------------------------------
// PostgREST falso em memoria
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'upsert' | 'update';
interface Registro { tabela: string; op: Op }
interface Falha { code?: string; status?: number; message?: string }
const TABELAS = ['central_conversation', 'central_message', 'central_event', 'central_message_content', 'central_message_processing', 'whatsapp_identity'] as const;
const UNICOS: Record<string, { nome: string; colunas: string[]; quando?: (r: Row) => boolean }[]> = {
  central_conversation: [{ nome: 'central_conversation_chave_uk', colunas: ['organization_id', 'context', 'phone_e164'] }],
  central_message: [{ nome: 'central_message_externo_uk', colunas: ['organization_id', 'provider', 'external_message_id'] }],
  central_message_content: [{ nome: 'central_message_content_pkey', colunas: ['message_id'] }],
  central_event: [{ nome: 'central_event_mensagem_uk', colunas: ['organization_id', 'message_id', 'event_type'], quando: (r) => r.message_id != null }],
  central_message_processing: [{ nome: 'central_message_processing_webhook_uk', colunas: ['message_id'], quando: (r) => r.origin === 'WEBHOOK' && r.status === 'CONCLUIDO' }],
  whatsapp_identity: [],
};
const ORDEM_STATUS: Record<string, number> = { RECEBIDA: 0, ENVIADA: 1, FALHOU: 2, ENTREGUE: 3, LIDA: 4 };
class ErroBanco extends Error { constructor(readonly falha: Falha) { super(falha.message ?? falha.code ?? 'erro'); } }

class BancoFalso {
  tabelas: Record<string, Row[]> = Object.fromEntries(TABELAS.map((t) => [t, []]));
  registros: Registro[] = [];
  private seq = 0;
  /** Falha injetada: avaliada em toda execucao; devolver Error = excecao (rede), Falha = resposta com error. */
  falhar?: (tabela: string, op: Op) => Error | Falha | undefined;
  private armado = false;
  private gatilho?: { tabela: string; op: Op };
  /** Depois de uma escrita bem-sucedida em (tabela, op), a PROXIMA operacao qualquer lanca (crash simulado). */
  crashDepois(tabela: string, op: Op) { this.gatilho = { tabela, op }; this.armado = false; }
  uuid() { return `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`; }
  linhas(t: string) { return this.tabelas[t]; }
  escritas() { return this.registros.filter((r) => r.op !== 'select'); }

  from(tabela: string) {
    if (!(tabela in this.tabelas)) throw new Error(`tabela desconhecida ${tabela}`);
    const st: { op: Op; payload?: Row[] | Row; opts?: Row; filtros: ((r: Row) => boolean)[]; cols: string; retornar: boolean; de: number; ate: number; onConflict?: string } = { op: 'select', filtros: [], cols: '*', retornar: false, de: 0, ate: Infinity };
    const q: Record<string, unknown> = {};
    q.select = (cols = '*') => { st.cols = cols; if (st.op !== 'select') st.retornar = true; return q; };
    q.eq = (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { st.filtros.push((r) => vs.includes(r[c])); return q; };
    q.is = (c: string, v: unknown) => { st.filtros.push((r) => r[c] == v); return q; };
    q.order = () => q;
    q.limit = (n: number) => { st.ate = st.de + n; return q; };
    q.range = (a: number, b: number) => { st.de = a; st.ate = b + 1; return q; };
    q.insert = (rows: Row | Row[]) => { st.op = 'insert'; st.payload = rows; return q; };
    q.upsert = (rows: Row | Row[], opts?: Row) => { st.op = 'upsert'; st.payload = rows; st.opts = opts; st.onConflict = opts?.onConflict; return q; };
    q.update = (patch: Row) => { st.op = 'update'; st.payload = patch; return q; };
    q.delete = () => { throw new Error('delete nao e permitido no escritor da Central'); };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      let r: Promise<unknown>;
      try { r = Promise.resolve(this.executar(tabela, st)); } catch (e) { r = Promise.reject(e); }
      return r.then(res, rej);
    };
    return q;
  }

  private executar(tabela: string, st: { op: Op; payload?: Row[] | Row; opts?: Row; filtros: ((r: Row) => boolean)[]; cols: string; retornar: boolean; de: number; ate: number; onConflict?: string }) {
    this.registros.push({ tabela, op: st.op });
    if (this.armado) { this.armado = false; this.gatilho = undefined; throw new Error('crash simulado'); }
    const injetada = this.falhar?.(tabela, st.op);
    if (injetada instanceof Error) throw injetada;
    if (injetada) return { data: null, error: injetada, status: injetada.status ?? 400 };
    try {
      const data = this.aplicar(tabela, st);
      if (this.gatilho && st.op !== 'select' && this.gatilho.tabela === tabela && this.gatilho.op === st.op) this.armado = true;
      return { data, error: null, status: st.op === 'insert' || st.op === 'upsert' ? 201 : 200 };
    } catch (e) {
      if (e instanceof ErroBanco) return { data: null, error: { ...e.falha, message: e.message }, status: e.falha.status ?? 409 };
      throw e;
    }
  }

  private projetar(rows: Row[], cols: string) {
    if (cols.trim() === '*') return rows.map((r) => ({ ...r }));
    const lista = cols.split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(lista.map((c) => [c, r[c]])));
  }
  private conflito(tabela: string, row: Row, colunas?: string[]) {
    const regras = UNICOS[tabela].filter((u) => !colunas || (u.colunas.length === colunas.length && u.colunas.every((c) => colunas.includes(c))));
    for (const u of regras) {
      if (u.quando && !u.quando(row)) continue;
      const existente = this.tabelas[tabela].find((r) => (!u.quando || u.quando(r)) && u.colunas.every((c) => r[c] === row[c]));
      if (existente) return { u, existente };
    }
    return undefined;
  }
  private validar(tabela: string, row: Row) {
    const erro = (message: string, code = 'P0001') => new ErroBanco({ code, status: code === '23514' ? 400 : 409, message });
    if (tabela === 'central_message') {
      const c = this.tabelas.central_conversation.find((x) => x.id === row.conversation_id);
      if (!c) throw erro(`conversa ${row.conversation_id} não encontrada`, '23503');
      if (c.organization_id !== row.organization_id) throw erro('linha de outra organização');
    }
    if (tabela === 'central_event') {
      const c = this.tabelas.central_conversation.find((x) => x.id === row.conversation_id);
      if (!c) throw erro(`conversa ${row.conversation_id} não encontrada`, '23503');
      if (row.message_id != null) {
        const m = this.tabelas.central_message.find((x) => x.id === row.message_id);
        if (!m) throw erro('mensagem não encontrada', '23503');
        if (m.conversation_id !== row.conversation_id) throw erro('evento com mensagem de outra conversa');
      }
      if (typeof row.detail_safe === 'string' && (row.detail_safe.length > 500 || /[0-9]{7,}/.test(row.detail_safe))) throw erro('detail_safe viola o CHECK', '23514');
    }
    if (tabela === 'central_message_content') {
      const m = this.tabelas.central_message.find((x) => x.id === row.message_id);
      if (!m) throw erro(`mensagem ${row.message_id} não encontrada`);
      if (m.organization_id !== row.organization_id) throw erro('conteúdo de outra organização');
      if (m.direction !== 'inbound') throw erro('nesta fase só mensagem inbound tem conteúdo persistido');
      if (typeof row.body_text !== 'string' || row.body_text.length < 1 || row.body_text.length > 1000) throw erro('body_text fora do CHECK', '23514');
      if (!/^[0-9a-f]{64}$/.test(row.body_sha256)) throw erro('body_sha256 fora do CHECK', '23514');
    }
    if (tabela === 'central_message_processing') {
      if (row.can_execute !== false || row.sent !== false) throw erro('can_execute/sent têm de ser false', '23514');
      if (row.status === 'CONCLUIDO' && (!row.output_sha256 || !row.situation || row.error_code)) throw erro('CONCLUIDO exige saída e situação, sem erro', '23514');
      if (row.status === 'ERRO' && !row.error_code) throw erro('ERRO exige código', '23514');
      if (row.origin === 'WEBHOOK' && row.actor_id) throw erro('webhook nunca tem ator', '23514');
      if (row.origin === 'REPROCESSAMENTO' && !row.actor_id) throw erro('reprocessamento exige ator', '23514');
      if (typeof row.error_code === 'string' && /[0-9]{7,}/.test(row.error_code)) throw erro('error_code viola o CHECK', '23514');
      const m = this.tabelas.central_message.find((x) => x.id === row.message_id);
      if (!m) throw erro(`mensagem ${row.message_id} não encontrada`);
      if (m.organization_id !== row.organization_id || m.conversation_id !== row.conversation_id) throw erro('processamento de outra organização ou de outra conversa');
      const conteudo = this.tabelas.central_message_content.find((x) => x.message_id === row.message_id);
      if (conteudo) { if (row.input_sha256 !== conteudo.body_sha256) throw erro('input_sha256 não corresponde ao conteúdo persistido da mensagem'); }
      else if (row.input_sha256) throw erro('input_sha256 informado para mensagem sem conteúdo persistido');
      else if (row.status === 'CONCLUIDO' && row.situation !== 'sem_texto') throw erro('mensagem sem conteúdo persistido só conclui como sem_texto');
    }
  }
  private inserir(tabela: string, row: Row) {
    this.validar(tabela, row);
    const nova = { ...row };
    if (tabela !== 'central_message_content' && !nova.id) nova.id = this.uuid();
    if (!nova.created_at) nova.created_at = '2026-09-10T12:00:00.000Z';
    this.tabelas[tabela].push(nova);
    return nova;
  }
  private aplicar(tabela: string, st: { op: Op; payload?: Row[] | Row; opts?: Row; filtros: ((r: Row) => boolean)[]; cols: string; retornar: boolean; de: number; ate: number; onConflict?: string }): unknown {
    const rows = this.tabelas[tabela];
    if (st.op === 'select') return this.projetar(rows.filter((r) => st.filtros.every((f) => f(r))).slice(st.de, st.ate), st.cols);
    const lote = Array.isArray(st.payload) ? st.payload : [st.payload as Row];
    if (st.op === 'insert') {
      for (const row of lote) { const c = this.conflito(tabela, row); if (c) throw new ErroBanco({ code: '23505', status: 409, message: `duplicate key value violates unique constraint "${c.u.nome}"` }); }
      const inseridas = lote.map((row) => this.inserir(tabela, row));
      return st.retornar ? this.projetar(inseridas, st.cols) : null;
    }
    if (st.op === 'upsert') {
      const colunas = st.onConflict ? st.onConflict.split(',').map((c) => c.trim()) : undefined;
      if (colunas) {
        const alvo = UNICOS[tabela].find((u) => u.colunas.length === colunas.length && u.colunas.every((c) => colunas.includes(c)));
        // Postgres: indice PARCIAL so e inferido com o predicado, e o PostgREST nao o envia
        if (!alvo || alvo.quando) throw new ErroBanco({ code: '42P10', status: 400, message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' });
      }
      const inseridas: Row[] = [];
      for (const row of lote) {
        const c = this.conflito(tabela, row, colunas ?? (tabela === 'central_message_content' ? ['message_id'] : ['id']));
        if (c) {
          if (st.opts?.ignoreDuplicates) continue;
          if (tabela === 'central_message_content' || tabela === 'central_message_processing') throw new ErroBanco({ code: 'P0001', status: 409, message: 'linha imutável' });
          Object.assign(c.existente, row);
          inseridas.push(c.existente);
        } else inseridas.push(this.inserir(tabela, row));
      }
      return st.retornar ? this.projetar(inseridas, st.cols) : null;
    }
    // update
    if (tabela === 'central_event' || tabela === 'central_message_content' || tabela === 'central_message_processing') throw new ErroBanco({ code: 'P0001', status: 409, message: `${tabela} é imutável` });
    const patch = st.payload as Row;
    const alvos = rows.filter((r) => st.filtros.every((f) => f(r)));
    for (const r of alvos) {
      const novo = { ...r, ...patch };
      if (tabela === 'central_message') {
        for (const c of ['organization_id', 'provider', 'external_message_id', 'direction', 'conversation_id', 'occurred_at']) if (c in patch && patch[c] !== r[c]) throw new ErroBanco({ code: 'P0001', status: 409, message: 'mensagem da Central é imutável no que veio do provider' });
        if ('status' in patch && r.status && patch.status !== r.status && ORDEM_STATUS[patch.status] <= ORDEM_STATUS[r.status]) novo.status = r.status; // trigger: nao anda para tras
      }
      if (tabela === 'central_conversation') {
        if (novo.status === 'ATENDIMENTO_HUMANO' && !novo.human_owner_id) throw new ErroBanco({ code: '23514', status: 400, message: 'central_conversation_humano_chk' });
        if (novo.status === 'ENCERRADA' && !novo.closed_at) throw new ErroBanco({ code: '23514', status: 400, message: 'central_conversation_encerrada_chk' });
      }
      Object.assign(r, novo);
    }
    return st.retornar ? this.projetar(alvos, st.cols) : null;
  }
}
const cliente = (b: BancoFalso) => ({ from: (t: string) => b.from(t) } as unknown as SupabaseClient);

// ---------------------------------------------------------------------------
// Cenario
// ---------------------------------------------------------------------------
const ORG = '00000000-0000-4000-8000-00000000000a';
const TEL = '5562988887777';
const AGORA = '2026-09-10T12:00:00.000Z';
const TEXTO = 'preciso pagar um frete de R$ 500 amanhã para a Transportadora X';
const evento = (over: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent => ({
  provider: 'META_CLOUD', contexto: 'INTERNAL', externalConversationId: '', externalMessageId: 'wamid.1', direction: 'inbound',
  eventType: 'MESSAGE_RECEIVED', occurredAt: AGORA, contactPhone: TEL, messageType: 'text', ...over,
});
const externos = (eventos: ChannelInboundEvent[]) => [...new Set(eventos.map((e) => e.externalMessageId).filter((x): x is string => !!x))];

/** Uma invocacao do webhook: carrega o estado, aplica os eventos, persiste e (opcionalmente) registra o processamento. */
async function rodada(p: PortasPersistenciaCentral, eventos: ChannelInboundEvent[], o: { textos?: Map<string, string>; registrar?: 'CONCLUIDO' | 'ERRO' | false; agoraIso?: string; identidade?: string } = {}) {
  const agoraIso = o.agoraIso ?? AGORA;
  const persistido = await p.carregarEstado(ORG, 'INTERNAL', [TEL], externos(eventos));
  const aplicado = aplicarEventos(persistido.estado, eventos, { organizationId: ORG, agoraIso });
  const textos = o.textos ?? new Map([['wamid.1', TEXTO]]);
  const identidadePorConversa = new Map<string, string>();
  if (o.identidade) for (const c of aplicado.estado.conversas) identidadePorConversa.set(c.id, o.identidade);
  const lote: LotePersistencia = { organizationId: ORG, aplicado, textos, identidadePorConversa, agoraIso };
  const r = await p.persistirLote(lote);
  let processamento: { id?: string; jaConcluido: boolean } | undefined;
  if (o.registrar !== false) {
    const m = aplicado.estado.mensagens.find((x) => x.externalMessageId === 'wamid.1')!;
    const texto = textos.get('wamid.1');
    const base: RegistroProcessamento = {
      organizationId: ORG, conversaId: r.ids.conversas.get(m.conversaId)!, mensagemId: r.ids.mensagens.get(m.id)!, origem: 'WEBHOOK', flowVersion: FLOW_VERSION,
      inputSha256: texto ? sha256(texto) : undefined, status: 'CONCLUIDO', outputSha256: sha256('resposta'), intent: 'FINANCE', situacao: 'respondido',
      canExecute: false, sent: false, durationMs: 7, processedAt: agoraIso,
    };
    const registro: RegistroProcessamento = o.registrar === 'ERRO' ? { ...base, status: 'ERRO', errorCode: 'llm_timeout', outputSha256: undefined, intent: undefined, situacao: undefined } : base;
    processamento = await p.registrarProcessamento(registro);
  }
  return { persistido, aplicado, resultado: r, processamento };
}
const contar = (b: BancoFalso) => ({
  conversas: b.linhas('central_conversation').length, mensagens: b.linhas('central_message').length, conteudos: b.linhas('central_message_content').length,
  eventos: b.linhas('central_event').length, recebidas: b.linhas('central_event').filter((e) => e.event_type === 'MESSAGE_RECEIVED').length,
  aberturas: b.linhas('central_event').filter((e) => e.event_type === 'CONVERSA_ABERTA').length,
  concluidos: b.linhas('central_message_processing').filter((p) => p.origin === 'WEBHOOK' && p.status === 'CONCLUIDO').length,
  erros: b.linhas('central_message_processing').filter((p) => p.status === 'ERRO').length,
});
const semDuplicata = (b: BancoFalso) => {
  const chaves = b.linhas('central_event').filter((e) => e.message_id != null).map((e) => `${e.organization_id}|${e.message_id}|${e.event_type}`);
  expect(new Set(chaves).size).toBe(chaves.length);
};
const espioes: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => { for (const m of ['log', 'info', 'warn', 'error'] as const) espioes.push(vi.spyOn(console, m).mockImplementation(() => {})); });
afterEach(() => { for (const s of espioes) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); } espioes.length = 0; });

// ---------------------------------------------------------------------------
// Caminho feliz e idempotencia
// ---------------------------------------------------------------------------
describe('persistenciaCentral: caminho feliz', () => {
  it('uma mensagem recebida vira 1 conversa, 1 mensagem, 1 conteudo, eventos e 1 processamento, na ordem conversa -> mensagem -> conteudo -> eventos', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    const { resultado, aplicado, processamento } = await rodada(p, [evento()]);
    expect(contar(b)).toMatchObject({ conversas: 1, mensagens: 1, conteudos: 1, recebidas: 1, aberturas: 1, concluidos: 1 });
    expect(resultado.conteudosNovos).toEqual(['wamid.1']);
    expect(processamento).toMatchObject({ jaConcluido: false });
    expect(processamento!.id).toMatch(/^[0-9a-f-]{36}$/);
    // MapaIds: id do core -> uuid do banco
    const conv = aplicado.conversasNovas[0]; const msg = aplicado.mensagensNovas[0];
    expect(conv.id).toMatch(/^conv-/); expect(msg.id).toMatch(/^msg-/);
    expect(resultado.ids.conversas.get(conv.id)).toBe(b.linhas('central_conversation')[0].id);
    expect(resultado.ids.mensagens.get(msg.id)).toBe(b.linhas('central_message')[0].id);
    // conteudo: texto normalizado, hash e versao
    const c = b.linhas('central_message_content')[0];
    expect(c).toMatchObject({ body_text: TEXTO, body_sha256: sha256(TEXTO), normalization_version: NORMALIZATION_VERSION, organization_id: ORG });
    // processamento: espelho do contrato, can_execute e sent literais false
    expect(b.linhas('central_message_processing')[0]).toMatchObject({ origin: 'WEBHOOK', status: 'CONCLUIDO', can_execute: false, sent: false, flow_version: FLOW_VERSION, input_sha256: sha256(TEXTO), intent: 'FINANCE', situation: 'respondido', duration_ms: 7, actor_id: null });
    // ordem das escritas e tabelas
    const escritas = b.escritas().map((r) => r.tabela);
    for (const t of escritas) expect(TABELAS_ESCRITA_CENTRAL as readonly string[]).toContain(t);
    const primeira = (t: string) => escritas.indexOf(t);
    expect(primeira('central_conversation')).toBeLessThan(primeira('central_message'));
    expect(primeira('central_message')).toBeLessThan(primeira('central_message_content'));
    expect(primeira('central_message_content')).toBeLessThan(primeira('central_event'));
    expect(primeira('central_event')).toBeLessThan(primeira('central_message_processing'));
    // o telefone nunca entra em claro em evento
    for (const e of b.linhas('central_event')) expect(e.detail_safe).not.toContain(TEL);
  });

  it('o MESMO lote de novo (reenvio da Meta): nada cresce, nenhum conteudo novo e o segundo CONCLUIDO devolve jaConcluido', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    const antes = contar(b);
    const r2 = await rodada(p, [evento()]);
    expect(contar(b)).toEqual(antes);
    expect(r2.aplicado.duplicados).toHaveLength(1);
    expect(r2.resultado.conteudosNovos).toEqual([]);
    expect(r2.processamento).toEqual({ jaConcluido: true });
  });

  it('reenvio com texto DIFERENTE nao altera o conteudo persistido', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()], { registrar: false });
    const r = await rodada(p, [evento()], { textos: new Map([['wamid.1', 'texto adulterado no reenvio']]), registrar: false });
    expect(r.resultado.conteudosNovos).toEqual([]);
    expect(b.linhas('central_message_content')).toHaveLength(1);
    expect(b.linhas('central_message_content')[0].body_text).toBe(TEXTO);
    expect(b.linhas('central_message_content')[0].body_sha256).toBe(sha256(TEXTO));
  });

  it('carregarEstado devolve o modelo do core com uuid do banco e a chave do evento reconstruida', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    const e = await p.carregarEstado(ORG, 'INTERNAL', [TEL], ['wamid.1']);
    expect(e.estado.conversas).toHaveLength(1);
    expect(e.estado.conversas[0]).toMatchObject({ organizationId: ORG, contexto: 'INTERNAL', provider: 'META_CLOUD', telefoneNormalizado: TEL, situacao: 'ABERTA', ultimaMensagemEm: AGORA, ultimaMensagemInboundEm: AGORA });
    expect(e.estado.conversas[0].id).toBe(b.linhas('central_conversation')[0].id);
    expect(e.estado.mensagens[0]).toMatchObject({ externalMessageId: 'wamid.1', direcao: 'inbound', status: 'RECEBIDA', conversaId: e.estado.conversas[0].id });
    expect(e.estado.eventos.map((x) => x.chave)).toEqual([`${ORG}|META_CLOUD|wamid.1|MESSAGE_RECEIVED`]);
    expect(e.pendentesDeProcessamento).toEqual([]);
    expect(e.errosPorMensagem.size).toBe(0);
    // outro contexto ou outro telefone: nada
    expect((await p.carregarEstado(ORG, 'EXTERNAL', [TEL], ['wamid.1'])).estado.conversas).toEqual([]);
    expect((await p.carregarEstado(ORG, 'INTERNAL', ['5562911112222'], [])).estado).toEqual<EstadoCentral>({ conversas: [], mensagens: [], eventos: [] });
  });

  it('pendentesDeProcessamento e errosPorMensagem: mensagem persistida sem CONCLUIDO fica pendente; ERRO conta e some com o CONCLUIDO', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()], { registrar: false });
    let e = await p.carregarEstado(ORG, 'INTERNAL', [TEL], ['wamid.1']);
    expect(e.pendentesDeProcessamento).toEqual(['wamid.1']);
    expect(e.errosPorMensagem.get('wamid.1')).toBeUndefined();
    await rodada(p, [evento()], { registrar: 'ERRO' });
    await rodada(p, [evento()], { registrar: 'ERRO' });
    e = await p.carregarEstado(ORG, 'INTERNAL', [TEL], ['wamid.1']);
    expect(e.pendentesDeProcessamento).toEqual(['wamid.1']);
    expect(e.errosPorMensagem.get('wamid.1')).toBe(2);
    const r = await rodada(p, [evento()]);
    expect(r.processamento).toMatchObject({ jaConcluido: false });
    e = await p.carregarEstado(ORG, 'INTERNAL', [TEL], ['wamid.1']);
    expect(e.pendentesDeProcessamento).toEqual([]);
    expect(e.errosPorMensagem.get('wamid.1')).toBe(2);
    expect(contar(b)).toMatchObject({ concluidos: 1, erros: 2, mensagens: 1, conteudos: 1 });
    // ERRO + retry => exatamente um CONCLUIDO; segundo CONCLUIDO => jaConcluido, sem excecao
    expect((await rodada(p, [evento()])).processamento).toEqual({ jaConcluido: true });
    expect(contar(b).concluidos).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery: as escritas nao sao uma transacao so
// ---------------------------------------------------------------------------
describe('persistenciaCentral: convergencia depois de crash', () => {
  const pontos: [string, string, Op][] = [
    ['apos criar a conversa', 'central_conversation', 'upsert'],
    ['apos criar a mensagem', 'central_message', 'upsert'],
    ['apos criar o conteudo', 'central_message_content', 'upsert'],
    ['antes do processamento (depois dos eventos)', 'central_event', 'insert'],
  ];
  for (const [nome, tabela, op] of pontos) {
    it(`crash ${nome}: a primeira invocacao falha como transitorio e a repeticao converge para 1/1/1 sem duplicatas`, async () => {
      const b = new BancoFalso();
      const p = criarPersistenciaCentral(cliente(b));
      b.crashDepois(tabela, op);
      const erro = await rodada(p, [evento()]).catch((e) => e as ErroCentralServidor);
      expect(erro).toBeInstanceOf(ErroCentralServidor);
      expect((erro as ErroCentralServidor).classe).toBe('transitorio');
      expect(contar(b).concluidos).toBe(0);
      // a Meta reenvia: o mesmo lote, sem crash
      const r = await rodada(p, [evento()]);
      const c = contar(b);
      expect(c).toMatchObject({ conversas: 1, mensagens: 1, conteudos: 1, recebidas: 1, concluidos: 1, erros: 0 });
      expect(c.aberturas).toBeLessThanOrEqual(1);
      semDuplicata(b);
      expect(b.linhas('central_message_content')[0].body_text).toBe(TEXTO);
      expect(r.processamento).toMatchObject({ jaConcluido: false });
      // e uma terceira passagem nao muda nada
      const antes = contar(b);
      expect((await rodada(p, [evento()])).processamento).toEqual({ jaConcluido: true });
      expect(contar(b)).toEqual(antes);
    });
  }

  it('crash depois do processamento registrado: o reenvio devolve jaConcluido sem rodar nada de novo', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    const antes = contar(b);
    const r = await rodada(p, [evento()]);
    expect(r.persistido.pendentesDeProcessamento).toEqual([]);
    expect(r.processamento).toEqual({ jaConcluido: true });
    expect(contar(b)).toEqual(antes);
  });

  it('duas invocacoes concorrentes intercaladas: no maximo um CONCLUIDO e nenhuma linha duplicada', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    const [a, c] = await Promise.all([rodada(p, [evento()]), rodada(p, [evento()])]);
    const total = contar(b);
    expect(total).toMatchObject({ conversas: 1, mensagens: 1, conteudos: 1, recebidas: 1 });
    expect(total.concluidos).toBeLessThanOrEqual(1);
    expect([a.processamento!.jaConcluido, c.processamento!.jaConcluido].filter((x) => !x).length).toBeLessThanOrEqual(1);
    expect(a.resultado.conteudosNovos.length + c.resultado.conteudosNovos.length).toBe(1);
    semDuplicata(b);
    // ambas resolveram os mesmos uuids
    expect([...a.resultado.ids.mensagens.values()]).toEqual([...c.resultado.ids.mensagens.values()]);
  });

  it('a instancia que perde a corrida do evento (23505 no insert) nao falha: o resultado e o mesmo do `do nothing`', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()], { registrar: false });
    // retira a trilha do evento: esta instancia carrega o estado SEM ele, entao o core o reaplica
    const eventoExistente = b.linhas('central_event').find((e) => e.event_type === 'MESSAGE_RECEIVED')!;
    b.tabelas.central_event = b.tabelas.central_event.filter((e) => e !== eventoExistente);
    const est = await p.carregarEstado(ORG, 'INTERNAL', [TEL], ['wamid.1']);
    const aplicado = aplicarEventos(est.estado, [evento()], { organizationId: ORG, agoraIso: AGORA });
    expect(aplicado.eventosNovos.some((e) => e.tipo === 'MESSAGE_RECEIVED')).toBe(true);
    // a OUTRA instancia grava o evento entre o SELECT dos existentes e o INSERT desta: o insert bate no 23505 e e tolerado
    b.falhar = (t, op) => { if (t === 'central_event' && op === 'insert') { b.tabelas.central_event.push(eventoExistente); b.falhar = undefined; } return undefined; };
    const antes = b.registros.length;
    await p.persistirLote({ organizationId: ORG, aplicado, textos: new Map(), identidadePorConversa: new Map(), agoraIso: AGORA });
    expect(contar(b).recebidas).toBe(1);
    semDuplicata(b);
    // o lote inteiro falhou com 23505 e o escritor repetiu linha a linha, tolerando o duplicado
    expect(b.registros.slice(antes).filter((r) => r.tabela === 'central_event' && r.op === 'insert').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Conversa: status nunca rebaixa, reabertura, identidade
// ---------------------------------------------------------------------------
describe('persistenciaCentral: conversa', () => {
  it('conversa em ATENDIMENTO_HUMANO no banco continua assim depois do lote (nunca rebaixa status)', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    const conv = b.linhas('central_conversation')[0];
    Object.assign(conv, { status: 'ATENDIMENTO_HUMANO', human_owner_id: '00000000-0000-4000-8000-0000000000a1' });
    const r = await rodada(p, [evento({ externalMessageId: 'wamid.2', occurredAt: '2026-09-10T13:00:00.000Z' })], { textos: new Map(), registrar: false });
    expect(r.aplicado.paraAgente).toEqual([]); // takeover: nenhum agente responde
    expect(conv.status).toBe('ATENDIMENTO_HUMANO');
    expect(conv.human_owner_id).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(conv.last_message_at).toBe('2026-09-10T13:00:00.000Z');
    expect(contar(b).mensagens).toBe(2);
  });

  it('conversa ENCERRADA reabre com CONVERSA_REABERTA uma vez so; last_message_at guarda sempre o maior valor', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    const conv = b.linhas('central_conversation')[0];
    Object.assign(conv, { status: 'ENCERRADA', closed_at: '2026-09-10T12:30:00.000Z' });
    const depois = '2026-09-11T09:00:00.000Z';
    const r = await rodada(p, [evento({ externalMessageId: 'wamid.3', occurredAt: depois })], { textos: new Map(), registrar: false });
    expect(r.aplicado.eventosNovos.some((e) => e.tipo === 'CONVERSA_REABERTA')).toBe(true);
    expect(conv.status).toBe('ABERTA');
    expect(conv.closed_at).toBeNull();
    expect(conv.last_message_at).toBe(depois);
    expect(b.linhas('central_event').filter((e) => e.event_type === 'CONVERSA_REABERTA')).toHaveLength(1);
    // reenvio do mesmo lote: nada duplica
    await rodada(p, [evento({ externalMessageId: 'wamid.3', occurredAt: depois })], { textos: new Map(), registrar: false });
    expect(b.linhas('central_event').filter((e) => e.event_type === 'CONVERSA_REABERTA')).toHaveLength(1);
    // um evento antigo (fora de ordem) nao rebaixa a marca de tempo
    await rodada(p, [evento({ externalMessageId: 'wamid.0', occurredAt: '2026-09-01T08:00:00.000Z' })], { textos: new Map(), registrar: false });
    expect(conv.last_message_at).toBe(depois);
    expect(conv.last_inbound_at).toBe(depois);
  });

  it('identidadePorConversa grava identity_id na conversa nova e atualiza a existente', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    const ident = '00000000-0000-4000-8000-0000000000i1'.replace('i', 'e');
    await rodada(p, [evento()], { identidade: ident });
    expect(b.linhas('central_conversation')[0].identity_id).toBe(ident);
    const outra = '00000000-0000-4000-8000-0000000000e2';
    await rodada(p, [evento({ externalMessageId: 'wamid.9' })], { textos: new Map(), registrar: false, identidade: outra });
    expect(b.linhas('central_conversation')[0].identity_id).toBe(outra);
    // sem identidade no lote, a que esta no banco fica
    await rodada(p, [evento({ externalMessageId: 'wamid.10' })], { textos: new Map(), registrar: false });
    expect(b.linhas('central_conversation')[0].identity_id).toBe(outra);
  });

  it('status de mensagem existente avanca por update e nunca anda para tras', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    const enviada = evento({ externalMessageId: 'wamid.out', direction: 'outbound', eventType: 'MESSAGE_SENT' });
    await rodada(p, [evento(), enviada]);
    const m = b.linhas('central_message').find((x) => x.external_message_id === 'wamid.out')!;
    expect(m.status).toBe('ENVIADA');
    await rodada(p, [{ ...enviada, eventType: 'MESSAGE_DELIVERED', occurredAt: '2026-09-10T12:01:00.000Z' }], { textos: new Map(), registrar: false });
    expect(m.status).toBe('ENTREGUE');
    expect(b.linhas('central_event').filter((e) => e.message_id === m.id).map((e) => e.event_type).sort()).toEqual(['MESSAGE_DELIVERED', 'MESSAGE_SENT']);
    // `sent` atrasado (reenvio) nao rebaixa
    await rodada(p, [enviada], { textos: new Map(), registrar: false });
    expect(m.status).toBe('ENTREGUE');
    expect(contar(b).mensagens).toBe(2);
    // conteudo so de inbound: texto para a outbound e ignorado sem erro
    const r = await rodada(p, [enviada], { textos: new Map([['wamid.out', 'texto que nao pode ser guardado']]), registrar: false });
    expect(r.resultado.conteudosNovos).toEqual([]);
    expect(contar(b).conteudos).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Identidades, erros e PII
// ---------------------------------------------------------------------------
describe('persistenciaCentral: identidades e erros', () => {
  it('carregarIdentidades le a tabela pela constante (nunca literal), filtra organizacao/contexto/telefones e mapeia para WhatsappIdentity', async () => {
    const b = new BancoFalso();
    b.tabelas.whatsapp_identity.push(
      { id: 'i1', organization_id: ORG, profile_id: 'u-augusto', worker_id: null, phone_e164: TEL, context: 'INTERNAL', status: 'VERIFIED', verified_at: '2026-09-01T10:00:00+00:00', revoked_at: null, created_at: '2026-08-30T10:00:00+00:00', verification_code_hash: 'nunca-sai' },
      { id: 'i2', organization_id: ORG, profile_id: null, worker_id: 'w1', phone_e164: TEL, context: 'EXTERNAL', status: 'PENDING', created_at: '2026-08-30T10:00:00Z' },
      { id: 'i3', organization_id: '11111111-1111-4111-8111-111111111111', profile_id: 'u-x', phone_e164: TEL, context: 'INTERNAL', status: 'VERIFIED', created_at: '2026-08-30T10:00:00Z' },
      { id: 'i4', organization_id: ORG, profile_id: 'u-y', phone_e164: '5562911112222', context: 'INTERNAL', status: 'VERIFIED', created_at: '2026-08-30T10:00:00Z' },
    );
    const p = criarPersistenciaCentral(cliente(b));
    const ids = await p.carregarIdentidades(ORG, 'INTERNAL', [TEL]);
    expect(ids).toEqual([{ id: 'i1', organizationId: ORG, usuarioId: 'u-augusto', colaboradorId: undefined, telefoneNormalizado: TEL, contexto: 'INTERNAL', situacao: 'VERIFIED', verificadoEm: '2026-09-01T10:00:00.000Z', revogadoEm: undefined, criadoEm: '2026-08-30T10:00:00.000Z' }]);
    expect(JSON.stringify(ids)).not.toContain('nunca-sai');
    expect(await p.carregarIdentidades(ORG, 'INTERNAL', [])).toEqual([]);
    expect(b.registros.filter((r) => r.tabela === TABELA_IDENTIDADE).every((r) => r.op === 'select')).toBe(true);
  });

  it('organizationId ausente ou invalido fecha antes de tocar o banco', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    for (const org of ['', 'org-eiff', 'abc']) {
      await expect(p.carregarEstado(org, 'INTERNAL', [TEL], [])).rejects.toMatchObject({ codigo: 'organizacao_ausente', classe: 'deterministico' });
      await expect(p.carregarIdentidades(org, 'INTERNAL', [TEL])).rejects.toMatchObject({ codigo: 'organizacao_ausente' });
      await expect(p.persistirLote({ organizationId: org, aplicado: aplicarEventos({ conversas: [], mensagens: [], eventos: [] }, [], { organizationId: org, agoraIso: AGORA }), textos: new Map(), identidadePorConversa: new Map(), agoraIso: AGORA })).rejects.toMatchObject({ codigo: 'organizacao_ausente' });
      await expect(p.registrarProcessamento({ organizationId: org, conversaId: 'x', mensagemId: 'y', origem: 'WEBHOOK', flowVersion: FLOW_VERSION, status: 'ERRO', errorCode: 'x', canExecute: false, sent: false, durationMs: 0, processedAt: AGORA })).rejects.toMatchObject({ codigo: 'organizacao_ausente' });
    }
    expect(b.registros).toHaveLength(0);
  });

  it('classificacao: 23503/23514/P0001 e 4xx sao deterministicos; rede, excecao e 5xx sao transitorios; 23505 fora do caso do webhook e deterministico', async () => {
    const casos: [Error | Falha, string][] = [
      [{ code: '23503', status: 409 }, 'deterministico'],
      [{ code: '23514', status: 400 }, 'deterministico'],
      [{ code: 'P0001', status: 400 }, 'deterministico'],
      [{ code: 'PGRST102', status: 400 }, 'deterministico'],
      [{ code: '', status: 0, message: 'TypeError: fetch failed' }, 'transitorio'],
      [{ status: 503 }, 'transitorio'],
      [{ code: '57014', status: 500 }, 'transitorio'],
      [new TypeError('fetch failed'), 'transitorio'],
    ];
    for (const [falha, classe] of casos) {
      const b = new BancoFalso();
      const p = criarPersistenciaCentral(cliente(b));
      b.falhar = (t, op) => (t === 'central_conversation' && op === 'upsert' ? falha : undefined);
      const e = await rodada(p, [evento()]).catch((x) => x as ErroCentralServidor);
      expect(e, JSON.stringify(falha)).toBeInstanceOf(ErroCentralServidor);
      expect((e as ErroCentralServidor).classe, JSON.stringify(falha)).toBe(classe);
      expect((e as ErroCentralServidor).codigo).toBe('gravar_conversa');
    }
    // 23505 no processamento so e "ja concluido" para WEBHOOK + CONCLUIDO; um ERRO com 23505 e bug e sobe deterministico
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()], { registrar: false });
    b.falhar = (t, op) => (t === 'central_message_processing' && op === 'insert' ? { code: '23505', status: 409, message: 'duplicate key' } : undefined);
    await expect(rodada(p, [evento()], { registrar: 'ERRO' })).rejects.toMatchObject({ codigo: 'registrar_processamento', classe: 'deterministico' });
    b.falhar = undefined;
    // e um CHECK violado (input_sha256 divergente do conteudo) sobe como deterministico, sem retry infinito
    const m = b.linhas('central_message')[0];
    await expect(p.registrarProcessamento({ organizationId: ORG, conversaId: m.conversation_id, mensagemId: m.id, origem: 'WEBHOOK', flowVersion: FLOW_VERSION, inputSha256: sha256('outro texto'), outputSha256: sha256('r'), intent: 'FINANCE', situacao: 'respondido', status: 'CONCLUIDO', canExecute: false, sent: false, durationMs: 1, processedAt: AGORA }))
      .rejects.toMatchObject({ classe: 'deterministico' });
  });

  it('nenhuma mensagem de erro carrega o texto da mensagem nem o telefone inteiro, mesmo quando o banco os devolve', async () => {
    const b = new BancoFalso();
    const p = criarPersistenciaCentral(cliente(b));
    b.falhar = (t, op) => (t === 'central_message_content' && op === 'upsert' ? { code: '23514', status: 400, message: `new row violates check constraint: body_text=(${TEXTO}) phone=(${TEL})`, details: `Key (phone_e164)=(${TEL})` } as Falha : undefined);
    const e = await rodada(p, [evento()]).catch((x) => x as ErroCentralServidor);
    expect(e).toBeInstanceOf(ErroCentralServidor);
    const serializado = `${(e as Error).message} ${JSON.stringify(e)} ${(e as Error).stack ?? ''}`;
    expect(serializado).not.toContain(TEL);
    expect(serializado).not.toContain('frete');
    expect((e as Error).message).toBe('gravar_conteudo (deterministico; code=23514 status=400)');
    // detail_safe e error_code nunca levam 7+ digitos
    expect(textoSeguro(`erro ${TEL} na conversa`, 500)).not.toContain(TEL);
    expect(textoSeguro('x'.repeat(600), 500)!.length).toBe(500);
    expect(textoSeguro(undefined, 80)).toBeNull();
    const b2 = new BancoFalso();
    const p2 = criarPersistenciaCentral(cliente(b2));
    await rodada(p2, [evento({ erroCodigo: `131047-${TEL}` })]);
    for (const ev of b2.linhas('central_event')) expect(ev.detail_safe).not.toMatch(/[0-9]{7,}/);
    expect(b2.linhas('central_message')[0].error_code).not.toContain(TEL);
  });

  it('upsert sobre o indice parcial de central_event falharia no Postgres (42P10): o falso prende a razao do insert tolerante', async () => {
    const b = new BancoFalso();
    const r = await (b.from('central_event') as any).upsert([{ organization_id: ORG, message_id: 'm', event_type: 'MESSAGE_RECEIVED' }], { onConflict: 'organization_id,message_id,event_type', ignoreDuplicates: true });
    expect(r.error.code).toBe('42P10');
    b.registros = []; // a chamada direta acima nao e do escritor
    const p = criarPersistenciaCentral(cliente(b));
    await rodada(p, [evento()]);
    expect(b.registros.filter((x) => x.tabela === 'central_event' && x.op === 'upsert')).toHaveLength(0);
    expect(b.registros.filter((x) => x.tabela === 'central_event' && x.op === 'insert').length).toBeGreaterThan(0);
  });
});
