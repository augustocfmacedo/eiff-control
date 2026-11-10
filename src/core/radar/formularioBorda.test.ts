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
import { existsSync, readFileSync } from 'node:fs';
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
const FONTE_DO_SITE = { id: 'FNT-SITE', code: 'WEBSITE', source_type: 'WEBSITE', active: true };
const THREAD_NOVA = { id: 'THR-1', status: 'NOVA', opened_at: '2026-11-09T14:00:00.000Z', sla_first_response_due: '2026-11-10T14:00:00.000Z', sla_first_response_at: null as string | null };
let fonte: Record<string, unknown> | undefined = FONTE_DO_SITE;
let fonteFalha = false;
let ingerida = false;
let thread = { ...THREAD_NOVA };
let prazoFalha: undefined | 'erro' | 'sem_confirmacao';

const falsoFetch = ((url: string, init?: RequestInit) => {
  const metodo = init?.method ?? 'GET';
  const corpo = init?.body === undefined ? undefined : JSON.parse(String(init.body));
  pedidos.push({ url, metodo, corpo });
  const ok = (d: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => d } as unknown as Response);
  if (url.includes('/rpc/inbox_ingest')) {
    if (!rpcRecusa) ingerida = true;
    return ok(rpcRecusa
      ? { ok: false, erro: 'somente_servidor' }
      : { ok: true, duplicada: false, thread_id: 'THR-1', message_id: 'MSG-1', contact_id: 'CTI-1', nova_thread: true, novo_contato: true });
  }
  if (url.includes('radar_source_record')) return ok(metodo === 'POST' ? (semEvidencia ? [] : [{ id: 'RF-1' }]) : registros);
  // a fonte configurada: o que o banco devolve para o id pedido, já com o filtro de organização
  if (url.includes('radar_source?')) return fonteFalha ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as unknown as Response) : ok(fonte === undefined ? [] : [fonte]);
  // a conversa nasce com as 24 h corridas da configuração; o PATCH do prazo é o que a corrige
  if (url.includes('inbox_thread')) {
    if (metodo === 'PATCH') {
      if (prazoFalha === 'erro') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
      if (prazoFalha === 'sem_confirmacao') return ok([]);
      thread = { ...thread, sla_first_response_due: (corpo as Record<string, string>)['sla_first_response_due']! };
      return ok([{ sla_first_response_due: thread.sla_first_response_due }]);
    }
    return ok([thread]);
  }
  if (url.includes('inbox_message') && url.includes('select=thread_id')) return ok(ingerida || mensagens.length > 0 ? [{ thread_id: 'THR-1' }] : []);
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
  fonte = FONTE_DO_SITE; fonteFalha = false; ingerida = false; thread = { ...THREAD_NOVA }; prazoFalha = undefined;
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

/* ---------------------------------------------------------------
   O que a borda ARRASTA consigo — medido no grafo de importação
--------------------------------------------------------------- */

/**
 * O grafo transitivo de `formularioBorda.ts`, seguindo só import relativo.
 *
 * Por que medir isto: a função Netlify é empacotada pelo esbuild, que junta
 * tudo o que o grafo alcança. Duas perguntas do preflight de ativação se
 * respondem aqui e em nenhum outro teste — se o caminho do lead toca o motor
 * estrutural (não deve: nenhuma peça dele é homologada para orientar cliente)
 * e se a função arrasta a aplicação (telas, adapters do navegador), o que
 * faria o pacote crescer e acoplaria a borda ao app.
 */
function grafoDaBorda(): string[] {
  const vistos = new Set<string>();
  const pilha = ['src/core/radar/formularioBorda.ts'];
  const pasta = (f: string) => f.slice(0, f.lastIndexOf('/'));
  const normalizar = (p: string) => {
    const partes: string[] = [];
    for (const parte of p.split('/')) {
      if (parte === '.' || parte === '') continue;
      if (parte === '..') partes.pop();
      else partes.push(parte);
    }
    return partes.join('/');
  };
  while (pilha.length > 0) {
    const f = pilha.pop()!;
    if (vistos.has(f)) continue;
    vistos.add(f);
    const texto = readFileSync(f, 'utf8');
    for (const m of texto.matchAll(/from '(\.[^']+)'/g)) {
      const alvo = normalizar(`${pasta(f)}/${m[1]!}`);
      const cand = [`${alvo}.ts`, `${alvo}.tsx`, `${alvo}/index.ts`].find((c) => existsSync(c));
      if (cand === undefined) throw new Error(`import não resolvido: ${m[1]} em ${f}`);
      pilha.push(cand);
    }
  }
  return [...vistos].sort();
}

describe('borda · o que ela arrasta para o pacote da função', () => {
  const grafo = grafoDaBorda();

  it('o caminhador anda de verdade: o grafo é grande e começa na borda', () => {
    /* sem esta guarda, um caminhador quebrado passaria em todas as asserções abaixo */
    expect(grafo.length).toBeGreaterThan(20);
    expect(grafo).toContain('src/core/radar/formularioBorda.ts');
    expect(grafo).toContain('src/core/inbox/ingestaoPorta.ts');
  });

  it('NADA do motor estrutural entra: nem código, nem vocabulário', () => {
    const fonte = grafo.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const termo of ['solveFrame', 'checkMember', 'resolverPortico', 'generateFrameModel', 'calcS2', 'LOCUS-ENGINE', 'api/pre-engenharia']) {
      expect(fonte.includes(termo)).toBe(false);
    }
  });

  it('e a borda não arrasta a aplicação: só módulos de src/core', () => {
    const forasteiros = grafo.filter((f) => !f.startsWith('src/core/'));
    expect(forasteiros).toEqual([]);
    expect(grafo.filter((f) => f.startsWith('src/ui/') || f.startsWith('src/screens/') || f.startsWith('src/data/'))).toEqual([]);
  });
});

describe('borda · a fonte configurada', () => {
  const escritasDe = () => pedidos.filter((p) => p.metodo !== 'GET');

  const invalidas: [string, () => void, string][] = [
    ['inexistente ou de outra organização', () => { fonte = undefined; }, 'fonte_inexistente'],
    ['de outro tipo', () => { fonte = { id: 'FNT-SITE', code: 'CNO', source_type: 'CNO', active: true }; }, 'fonte_nao_website'],
    ['WEBSITE que não é a do simulador', () => { fonte = { id: 'FNT-SITE', code: 'OFFICIAL_COMPANY_SOURCE', source_type: 'WEBSITE', active: true }; }, 'fonte_nao_canonica'],
    ['inativa', () => { fonte = { ...FONTE_DO_SITE, active: false }; }, 'fonte_inativa'],
    ['que o banco não deixou ler', () => { fonteFalha = true; }, 'fonte_nao_verificada'],
  ];
  it.each(invalidas)('fonte %s → 503 integracao_nao_configurada e ZERO escrita', async (_nome, preparar, motivo) => {
    preparar();
    const r = await pedir(CORPO);
    expect(r.status).toBe(503);
    expect(r.corpo).toEqual({ erro: 'integracao_nao_configurada', motivo });
    expect(escritasDe()).toEqual([]);
  });

  it('a leitura da fonte carrega a organização e vem antes de qualquer outra consulta', async () => {
    await pedir(CORPO);
    expect(pedidos[0]!.url).toContain('radar_source?');
    expect(pedidos[0]!.url).toContain('organization_id=eq.ORG-1');
    expect(pedidos[0]!.url).toContain('id=eq.FNT-SITE');
  });
});

describe('borda · prazo de primeira resposta', () => {
  // CORPO chega segunda 09/11/2026 às 11:00 em São Paulo: 30 min úteis → 14:30 UTC
  const ALVO = '2026-11-09T14:30:00.000Z';

  it('sucesso devolve o vencimento de 30 minutos úteis, já gravado na conversa', async () => {
    const r = await pedir(CORPO);
    expect(r.status).toBe(200);
    expect(r.corpo['primeiraRespostaAte']).toBe(ALVO);
    expect(thread.sla_first_response_due).toBe(ALVO);
    const patch = pedidos.find((p) => p.metodo === 'PATCH' && p.url.includes('inbox_thread'))!;
    expect(patch.corpo).toEqual({ sla_first_response_due: ALVO }); // só o prazo: nada de setor, responsável ou status
    expect(patch.url).toContain('organization_id=eq.ORG-1');
  });

  it.each([['erro' as const], ['sem_confirmacao' as const]])('falha ao gravar o prazo (%s) → 502 na etapa «prazo», nunca 200', async (modo) => {
    prazoFalha = modo;
    const r = await pedir(CORPO);
    expect(r.status).toBe(502);
    expect(r.corpo).toEqual({ erro: 'gravacao_falhou', etapa: 'prazo' });
    expect(thread.sla_first_response_due).toBe(THREAD_NOVA.sla_first_response_due);
  });

  it('o reenvio depois da falha conserta o prazo e não regrava evidência nem conversa', async () => {
    prazoFalha = 'erro';
    expect((await pedir(CORPO)).status).toBe(502);
    // o que a primeira tentativa deixou no banco
    const primeiro = pedidos.find((p) => p.metodo === 'POST' && p.url.includes('radar_source_record'))!.corpo as Record<string, unknown>;
    registros = [{
      id: 'RF-1', source_id: 'FNT-SITE', record_type: 'empresa', external_id: 'nf-777', payload: primeiro['payload'],
      payload_fingerprint: primeiro['payload_fingerprint'], intake_status: 'PENDING', entity_id: null, received_at: primeiro['received_at'],
    }];
    mensagens = [{ id: 'MSG-1' }];
    prazoFalha = undefined; pedidos = [];

    const r = await pedir(CORPO);
    expect(r.status).toBe(200);
    expect(r.corpo['resultado']).toBe('IDEMPOTENTE');
    expect(pedidos.some((p) => p.metodo === 'POST' && p.url.includes('radar_source_record'))).toBe(false);
    expect(pedidos.some((p) => p.url.includes('rpc/inbox_ingest'))).toBe(false);
    expect(thread.sla_first_response_due).toBe(ALVO);
  });

  it('nenhuma chamada toca a configuração global de SLA do Inbox', async () => {
    await pedir(CORPO);
    expect(pedidos.filter((p) => p.metodo !== 'GET').some((p) => p.url.includes('inbox_config'))).toBe(false);
  });
});
