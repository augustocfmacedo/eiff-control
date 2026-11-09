/**
 * A borda `/api/formulario-site` inteira, com o formato EFETIVO de origem.
 *
 * Este é o único lugar onde as duas portas HTTP são exercidas juntas: o
 * `fetch` global é falso e responde como o PostgREST e como a RPC
 * `inbox_ingest` responderiam, então o que se mede aqui é a superfície real —
 * caminhos, cabeçalhos, códigos de resposta — sobre o corpo que o Netlify
 * entrega de verdade (`{ payload: … }`).
 *
 * O que o banco ACEITA é medido em outro lugar, com PostgreSQL de verdade:
 * `npm run smoke:formulario`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corpoDaSubmissaoNetlify } from './formularioTransporte';
import { pedidoDeIntake } from './formularioSite';
import { validarIntake } from './leadEngineIntake';
import { tratarPedidoFormulario } from './formularioBorda';

const SEGREDO = 'segredo-de-teste-0123456789';
const CHAVE = 'chave-de-servico';
const URL_BANCO = 'https://banco.exemplo';

/** O corpo como a função de evento do site o encaminha: a submissão embrulhada. */
const CORPO = {
  payload: {
    id: 'nf-777', form_name: 'simular-galpao', created_at: '2026-11-09T14:00:00.000Z',
    data: {
      nome: 'Ana Lima (FICTÍCIO)', email: 'ana@exemplo.invalido', telefone: '62 90000-0000',
      empresa: 'Lima Indústria', cidade: 'Goiânia, GO', uso: 'industrial', area: '900',
      observacao: 'Preciso de um galpão para a fábrica.',
      'form-name': 'simular-galpao', 'empresa-site': '', ip: '200.0.0.1',
    },
  },
};

interface Pedido { url: string; metodo: string; corpo?: unknown }
let pedidos: Pedido[] = [];
let logs: string[] = [];
let semEvidencia = false;
let rpcRecusa = false;
let registros: unknown[] = [];
let mensagens: unknown[] = [];
let env: Record<string, string | undefined> = {};

const falsoFetch = ((url: string, init?: RequestInit) => {
  const metodo = init?.method ?? 'GET';
  const corpo = init?.body === undefined ? undefined : JSON.parse(String(init.body));
  pedidos.push({ url, metodo, corpo });
  const ok = (d: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => d } as unknown as Response);
  if (url.includes('/rpc/inbox_ingest')) {
    return ok(rpcRecusa
      ? { ok: false, erro: 'somente_servidor' }
      : { ok: true, duplicada: false, thread_id: 'THR-1', message_id: 'MSG-1', contact_id: 'CTI-1', nova_thread: true, novo_contato: true });
  }
  if (url.includes('radar_source_record')) return ok(metodo === 'POST' ? (semEvidencia ? [] : [{ id: 'RF-1' }]) : registros);
  if (url.includes('inbox_message')) return ok(mensagens);
  if (url.includes('inbox_contact_identity')) return ok([]);
  if (url.includes('inbox_contact')) return ok([{ id: 'CTI-1', name: 'Contato não identificado', company_name: null, relation_kind: 'desconhecido' }]);
  return ok([]);
}) as unknown as typeof fetch;

const pedir = (corpo: unknown, cabecalhos: Record<string, string> = { 'x-eiff-form-secret': SEGREDO }, metodo = 'POST') =>
  tratarPedidoFormulario(new Request('https://eiffcontrol.com.br/api/formulario-site', {
    method: metodo, headers: { 'content-type': 'application/json', ...cabecalhos },
    ...(metodo === 'POST' ? { body: JSON.stringify(corpo) } : {}),
  }), { env, fetch: falsoFetch, log: (t) => { logs.push(JSON.stringify(t)); } });

beforeEach(() => {
  pedidos = []; logs = []; semEvidencia = false; rpcRecusa = false; registros = []; mensagens = [];
  env = {
    EIFF_FORM_SECRET: SEGREDO, EIFF_FORM_SOURCE_ID: 'FNT-SITE', SUPABASE_SERVICE_ROLE_KEY: CHAVE,
    EIFF_INBOX_ORGANIZATION_ID: 'ORG-1', SUPABASE_URL: URL_BANCO,
    // o roteador tem leitura própria e prova própria (smoke); aqui o foco é a gravação
    EIFF_INBOX_ROUTER_ENABLED: 'false',
  };
});

afterEach(() => { env = {}; });

describe('borda · autenticação', () => {
  it('sem o segredo é 401, e nada é consultado no banco', async () => {
    const r = await pedir(CORPO, {});
    expect(r.status).toBe(401);
    expect(r.corpo).toEqual({ erro: 'nao_autorizado' });
    expect(pedidos.length).toBe(0);
  });

  it('com segredo errado é 401 — a mesma resposta: quem chama não descobre nada', async () => {
    const r = await pedir(CORPO, { 'x-eiff-form-secret': 'outro' });
    expect(r.status).toBe(401);
    expect(r.corpo).toEqual({ erro: 'nao_autorizado' });
  });

  it('sem segredo CONFIGURADO é 401 também: fail-closed', async () => {
    delete env['EIFF_FORM_SECRET'];
    const r = await pedir(CORPO);
    expect(r.status).toBe(401);
    expect(pedidos.length).toBe(0);
  });

  it('GET não é caminho de entrada', async () => {
    const r = await pedir(undefined, {}, 'GET');
    expect(r.status).toBe(405);
  });
});

describe('borda · o caminho inteiro', () => {
  it('grava evidência e conversa, nessa ordem, e devolve os ids', async () => {
    const r = await pedir(CORPO);
    expect(r.status).toBe(200);
    const d = r.corpo;
    expect(d['resultado']).toBe('REGISTRADO');
    expect(d['registroFonteId']).toBe('RF-1');
    expect(d['threadId']).toBe('THR-1');
    expect(d['novaConversa']).toBe(true);

    const escritas = pedidos.filter((p) => p.metodo === 'POST');
    expect(escritas[0]!.url).toContain('radar_source_record');
    expect(escritas[1]!.url).toContain('rpc/inbox_ingest');
  });

  it('as leituras de estado vêm antes, filtradas pela organização', async () => {
    await pedir(CORPO);
    const leituras = pedidos.filter((p) => p.metodo === 'GET');
    expect(leituras.length).toBeGreaterThanOrEqual(2);
    for (const l of leituras) expect(l.url).toContain('organization_id=eq.ORG-1');
  });

  it('a conversa vai como PORTAL externo, com o rastro da evidência', async () => {
    await pedir(CORPO);
    const rpc = pedidos.find((p) => p.url.includes('rpc/inbox_ingest'))!.corpo as Record<string, any>;
    expect(rpc['p_channel']).toBe('PORTAL');
    expect(rpc['p_context']).toBe('EXTERNAL');
    expect(rpc['p_identifier']).toBe('ana@exemplo.invalido');
    expect(rpc['p_external_message_id']).toBe('nf-777');
    expect(rpc['p_meta'].registroFonteId).toBe('RF-1');
    expect(rpc['p_body']).toContain('Preciso de um galpão para a fábrica.');
  });

  it('o IP e o controle do Netlify não chegam ao banco', async () => {
    await pedir(CORPO);
    const insert = pedidos.find((p) => p.metodo === 'POST' && p.url.includes('radar_source_record'))!;
    const texto = JSON.stringify(insert.corpo);
    expect(texto).not.toContain('200.0.0.1');
    expect(texto).not.toContain('form-name');
  });
});

describe('borda · reenvio', () => {
  it('evidência existente e conversa ausente: COMPLETA só a conversa', async () => {
    registros = [{
      id: 'RF-1', source_id: 'FNT-SITE', record_type: 'empresa', external_id: 'nf-777',
      payload: {}, payload_fingerprint: impressaoEsperada(), intake_status: 'PENDING',
      entity_id: null, received_at: '2026-11-09T14:00:00.000Z', decided_at: null, decided_by: null, decision_reason: null,
    }];
    const r = await pedir(CORPO);
    const d = r.corpo;
    expect(d['resultado']).toBe('COMPLETADO');
    expect(pedidos.some((p) => p.metodo === 'POST' && p.url.includes('radar_source_record'))).toBe(false);
    expect(pedidos.some((p) => p.url.includes('rpc/inbox_ingest'))).toBe(true);
  });

  it('as duas já existem: IDEMPOTENTE, nenhuma escrita', async () => {
    registros = [{
      id: 'RF-1', source_id: 'FNT-SITE', record_type: 'empresa', external_id: 'nf-777',
      payload: {}, payload_fingerprint: impressaoEsperada(), intake_status: 'PENDING',
      entity_id: null, received_at: '2026-11-09T14:00:00.000Z', decided_at: null, decided_by: null, decision_reason: null,
    }];
    mensagens = [{ id: 'MSG-1' }];
    const r = await pedir(CORPO);
    expect(r.corpo['resultado']).toBe('IDEMPOTENTE');
    expect(pedidos.filter((p) => p.metodo === 'POST' && !p.url.includes('rpc')).length).toBe(0);
    expect(pedidos.some((p) => p.url.includes('rpc/inbox_ingest'))).toBe(false);
  });
});

describe('borda · nunca devolve sucesso do que não gravou', () => {
  it('insert sem id na volta é 502', async () => {
    semEvidencia = true;
    const r = await pedir(CORPO);
    expect(r.status).toBe(502);
    expect(r.corpo).toEqual({ erro: 'gravacao_falhou', etapa: 'evidencia' });
  });

  it('RPC que recusa é 502 na etapa conversa', async () => {
    rpcRecusa = true;
    const r = await pedir(CORPO);
    expect(r.status).toBe(502);
    expect(r.corpo).toEqual({ erro: 'gravacao_falhou', etapa: 'conversa' });
  });

  it('sem configuração é 503 e nada é consultado', async () => {
    delete env['EIFF_FORM_SOURCE_ID'];
    const r = await pedir(CORPO);
    expect(r.status).toBe(503);
    expect(r.corpo['erro']).toBe('integracao_nao_configurada');
    expect(pedidos.length).toBe(0);
  });
});

describe('borda · o que é ignorado com 200', () => {
  it('honeypot preenchido, spam e formulário de outra coisa', async () => {
    const casos: [unknown, string][] = [
      [{ payload: { ...CORPO.payload, data: { ...CORPO.payload.data, 'empresa-site': 'bot' } } }, 'honeypot_preenchido'],
      [{ payload: { ...CORPO.payload, state: 'spam' } }, 'marcada_como_spam'],
      [{ payload: { ...CORPO.payload, form_name: 'newsletter' } }, 'formulario_nao_aceito'],
    ];
    for (const [corpo, motivo] of casos) {
      pedidos = [];
      const r = await pedir(corpo);
      expect(r.status).toBe(200);
      const d = r.corpo;
      expect(d['resultado']).toBe('IGNORADA');
      expect(d['motivo']).toBe(motivo);
      expect(pedidos.length).toBe(0);
    }
  });

  it('submissão sem e-mail é 400: melhor o remetente saber do que o lead sumir', async () => {
    const r = await pedir({ payload: { ...CORPO.payload, data: { nome: 'Ana' } } });
    expect(r.status).toBe(400);
    expect(r.corpo['erro']).toBe('sem_email');
  });

  it('corpo que não é JSON é 400', async () => {
    const r = await tratarPedidoFormulario(new Request('https://eiffcontrol.com.br/api/formulario-site', {
      method: 'POST', headers: { 'x-eiff-form-secret': SEGREDO }, body: 'nada disso',
    }), { env, fetch: falsoFetch });
    expect(r.status).toBe(400);
  });
});

describe('borda · o que nunca sai da função', () => {
  it('o log não leva o segredo, a chave de serviço nem o conteúdo do lead', async () => {
    await pedir(CORPO);
    const tudo = logs.join(' | ');
    expect(tudo).not.toContain(SEGREDO);
    expect(tudo).not.toContain(CHAVE);
    expect(tudo).not.toContain('ana@exemplo.invalido');
    expect(tudo).not.toContain('Preciso de um galpão');
    /* mas leva o que serve para investigar */
    expect(tudo).toContain('REGISTRADO');
    expect(tudo).toContain('nf-777');
  });

  it('a resposta não devolve o conteúdo recebido', async () => {
    const r = await pedir(CORPO);
    const texto = JSON.stringify(r.corpo);
    expect(texto).not.toContain('ana@exemplo.invalido');
    expect(texto).not.toContain('Lima Indústria');
    expect(texto).not.toContain(CHAVE);
  });
});

/** A impressão que a borda calcularia para este corpo — usada para montar o estado de reenvio. */
function impressaoEsperada(): string {
  const t = corpoDaSubmissaoNetlify(CORPO);
  if (!t.ok) throw new Error('setup');
  const v = validarIntake(pedidoDeIntake(t.corpo, 'FNT-SITE'));
  if (!v.ok) throw new Error('setup');
  return v.payloadFingerprint;
}
