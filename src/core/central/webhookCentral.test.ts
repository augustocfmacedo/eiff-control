// EIFF Central — Wave 03 F2-WEBHOOK: orquestracao do webhook sobre PORTAS mockadas (zero rede, zero banco).
// Cada caso confere o que foi chamado, em que ordem, e que NADA de conteudo (texto, telefone inteiro) sai no resumo,
// nos registros, nos erros ou em log. O motor roda de verdade (fluxoInterno sobre o Dataset local do store).
import fs from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aplicarEventos, estadoVazio, type EstadoCentral } from './conversa';
import { fluxoInterno, limparTexto, type AtendimentoInterno, type EntradaFluxoInterno } from './fluxoInterno';
import { normalizarEventosMeta } from './metaEventos';
import { resolverContextoCentral } from './contextoServidor';
import { codigoSeguro, impressaoTexto, processarWebhookCentral, removerPendentes, separarPendentes, type EntradaWebhookCentral } from './webhookCentral';
import {
  ErroCentralServidor, LIMITE_TENTATIVAS_TRANSITORIAS,
  type EstadoPersistido, type LotePersistencia, type PortasPersistenciaCentral, type RegistroProcessamento, type ResultadoPersistencia,
} from './servidorContratos';
import type { WhatsappIdentity } from './tipos';
import { actions, getState } from '../../data/store';

// ---------------------------------------------------------------------------
// Mocks do handler Netlify (so a secao final usa): cliente Supabase e fabricas da F2-DATA
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ marca: 'cliente-falso' })),
  criarPersistenciaCentral: vi.fn(),
  criarCarregadorDataset: vi.fn(),
  fluxoOriginal: undefined as undefined | typeof fluxoInterno,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('./persistenciaCentral', () => ({ criarPersistenciaCentral: mocks.criarPersistenciaCentral }));
vi.mock('../../data/datasetServidor', () => ({ criarCarregadorDataset: mocks.criarCarregadorDataset }));
// fluxoInterno segue o original; um unico caso (j) troca a implementacao para simular um atendimento executavel
vi.mock('./fluxoInterno', async (importOriginal) => {
  const original = await importOriginal<typeof import('./fluxoInterno')>();
  mocks.fluxoOriginal = original.fluxoInterno;
  return { ...original, fluxoInterno: vi.fn(original.fluxoInterno) };
});

// ---------------------------------------------------------------------------
// Cenario
// ---------------------------------------------------------------------------
const ORG = '0f1e2d3c-4b5a-4978-8765-43210fedcba9';
const INTERNO = 'pn-interno-1';
const EXTERNO = 'pn-externo-2';
const TELEFONE = '5562988887777';
const OUTRO = '5562911112222';
const AGORA = '2026-09-11T12:00:00.000Z';
const WAMID = 'wamid.HBgMNTU2Mjk4ODg4Nzc3NxUCABIYFjNFQjA=';
const TEXTO = 'Quanto temos de caixa hoje?';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const identidade = (over: Partial<WhatsappIdentity> = {}): WhatsappIdentity => ({
  id: 'wid-1', organizationId: ORG, usuarioId: 'u-fin', telefoneNormalizado: TELEFONE,
  contexto: 'INTERNAL', situacao: 'VERIFIED', criadoEm: AGORA, ...over,
});

/** Notificacao REAL do webhook da Meta (entry[].changes[].value.messages[]). */
function payload(texto: string, opcoes: { numero?: string; de?: string; id?: string; tipo?: string } = {}): unknown {
  const m: Record<string, unknown> = { from: opcoes.de ?? TELEFONE, id: opcoes.id ?? WAMID, timestamp: '1789041600', type: opcoes.tipo ?? 'text' };
  if ((opcoes.tipo ?? 'text') === 'text') m.text = { body: texto };
  if (opcoes.tipo === 'audio') m.audio = { id: 'media-1', mime_type: 'audio/ogg' };
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '556230000000', phone_number_id: opcoes.numero ?? INTERNO },
      contacts: [{ profile: { name: 'Fulano do WhatsApp' }, wa_id: opcoes.de ?? TELEFONE }],
      messages: [m],
    } }] }],
  };
}
const NUMEROS = { interno: INTERNO, externo: EXTERNO };
const eventosDe = (p: unknown) => normalizarEventosMeta(p, { numeros: NUMEROS, agoraIso: AGORA });
const contextoPronto = () => resolverContextoCentral({
  CENTRAL_ALPHA_MODE: 'on', EIFF_CENTRAL_ORGANIZATION_ID: ORG, EIFF_CENTRAL_PHONE_NUMBER_ID: INTERNO,
  EIFF_COMMERCIAL_PHONE_NUMBER_ID: EXTERNO, CENTRAL_ALPHA_NUMBERS: TELEFONE, COMMIT_REF: 'abc1234',
});

/** Estado como o banco devolveria: ids uuid, montado aplicando os eventos sobre o vazio. */
function estadoDoBanco(p: unknown): EstadoCentral {
  const e = aplicarEventos(estadoVazio(), eventosDe(p), { organizationId: ORG, agoraIso: AGORA }).estado;
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const mapa = new Map<string, string>();
  let n = 1;
  const de = (id: string) => { if (!mapa.has(id)) mapa.set(id, uuid(n++)); return mapa.get(id)!; };
  return {
    conversas: e.conversas.map((c) => ({ ...c, id: de(c.id) })),
    mensagens: e.mensagens.map((m) => ({ ...m, id: de(m.id), conversaId: de(m.conversaId) })),
    eventos: e.eventos.map((ev) => ({ ...ev, id: de(ev.id), conversaId: de(ev.conversaId), mensagemId: ev.mensagemId ? de(ev.mensagemId) : undefined })),
  };
}
const persistidoVazio = (): EstadoPersistido => ({ estado: estadoVazio(), pendentesDeProcessamento: [], errosPorMensagem: new Map() });

interface Espiao {
  portas: PortasPersistenciaCentral;
  chamadas: string[];
  lotes: LotePersistencia[];
  registros: RegistroProcessamento[];
  carregarDataset: ReturnType<typeof vi.fn>;
}
function espiao(over: {
  estado?: EstadoPersistido;
  identidades?: WhatsappIdentity[];
  persistir?: (lote: LotePersistencia) => Promise<ResultadoPersistencia>;
  registrar?: (r: RegistroProcessamento) => Promise<{ id?: string; jaConcluido: boolean }>;
  dataset?: () => Promise<unknown>;
} = {}): Espiao {
  const chamadas: string[] = [];
  const lotes: LotePersistencia[] = [];
  const registros: RegistroProcessamento[] = [];
  const idsDe = (lote: LotePersistencia): ResultadoPersistencia => {
    let n = 100;
    const uuid = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
    const conversas = new Map(lote.aplicado.estado.conversas.map((c) => [c.id, UUID.test(c.id) ? c.id : uuid()]));
    const mensagens = new Map(lote.aplicado.estado.mensagens.map((m) => [m.id, UUID.test(m.id) ? m.id : uuid()]));
    return { ids: { conversas, mensagens }, conteudosNovos: [...lote.textos.keys()] };
  };
  const carregarDataset = vi.fn(async () => { chamadas.push('carregarDataset'); return (over.dataset ?? (async () => getState().ds))(); });
  return {
    chamadas, lotes, registros, carregarDataset,
    portas: {
      carregarEstado: async () => { chamadas.push('carregarEstado'); return over.estado ?? persistidoVazio(); },
      carregarIdentidades: async () => { chamadas.push('carregarIdentidades'); return over.identidades ?? [identidade()]; },
      persistirLote: async (lote) => { chamadas.push('persistirLote'); lotes.push(lote); return (over.persistir ?? idsDe)(lote); },
      registrarProcessamento: async (r) => { chamadas.push(`registrarProcessamento:${r.status}`); registros.push(r); return over.registrar ? over.registrar(r) : { id: 'p-1', jaConcluido: false }; },
    },
  };
}
const entradaDe = (p: unknown, e: Espiao, over: Partial<EntradaWebhookCentral> = {}): EntradaWebhookCentral => ({
  payload: p, eventos: eventosDe(p), contexto: contextoPronto(), portas: e.portas,
  carregarDataset: e.carregarDataset as unknown as EntradaWebhookCentral['carregarDataset'], agoraIso: AGORA, relogio: (() => { let t = 1000; return () => (t += 7); })(), ...over,
});
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
/** Resposta que o motor daria — para conferir o outputSha256 sem guardar texto no registro. */
async function respostaDoMotor(p: unknown, identidades: WhatsappIdentity[] = [identidade()]): Promise<AtendimentoInterno> {
  const entrada: EntradaFluxoInterno = { payload: p, servidor: { ds: getState().ds, organizationId: ORG, identidades, numeros: NUMEROS }, agoraIso: AGORA };
  const r = await mocks.fluxoOriginal!(entrada);
  expect(r.atendimentos).toHaveLength(1);
  return r.atendimentos[0];
}

let fetchSpy = vi.spyOn(globalThis, 'fetch');
beforeEach(() => {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  vi.mocked(fluxoInterno).mockClear();
  vi.mocked(fluxoInterno).mockImplementation(mocks.fluxoOriginal!);
});
afterEach(() => {
  // (k) nenhum POST/fetch para fora, em nenhum caso
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// (a) off e contexto fechado
// ---------------------------------------------------------------------------
describe('(a) contexto não pronto', () => {
  it('modo off ⇒ 200, tudo descartado e ZERO chamadas às portas e ao Dataset', async () => {
    const e = espiao();
    const contexto = resolverContextoCentral({ EIFF_CENTRAL_ORGANIZATION_ID: ORG, EIFF_CENTRAL_PHONE_NUMBER_ID: INTERNO, CENTRAL_ALPHA_NUMBERS: TELEFONE });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e, { contexto }));
    expect(s.status).toBe(200);
    expect(s.resumo).toEqual({ modo: 'off', status: 200, eventos: 1, descartados: 1, persistidos: 0, processados: 0, concluidos: 0, erros: 0, codigos: [] });
    expect(e.chamadas).toEqual([]);
    expect(e.carregarDataset).not.toHaveBeenCalled();
  });
  it('on mas fechado (allowlist vazia) ⇒ mesmo comportamento: nada tocado', async () => {
    const e = espiao();
    const contexto = resolverContextoCentral({ CENTRAL_ALPHA_MODE: 'on', EIFF_CENTRAL_ORGANIZATION_ID: ORG, EIFF_CENTRAL_PHONE_NUMBER_ID: INTERNO });
    expect(contexto).toMatchObject({ pronto: false, motivo: 'allowlist_vazia' });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e, { contexto }));
    expect(s.status).toBe(200);
    expect(s.resumo.descartados).toBe(1);
    expect(e.chamadas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) filtro D4
// ---------------------------------------------------------------------------
describe('(b) filtro D4: INTERNAL + allowlist', () => {
  it('número fora da allowlist ⇒ descartado: zero persistência, zero leitura, Dataset não carregado', async () => {
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO, { de: OUTRO }), e));
    expect(s.status).toBe(200);
    expect(s.resumo).toMatchObject({ eventos: 1, descartados: 1, persistidos: 0, processados: 0 });
    expect(e.chamadas).toEqual([]);
    expect(e.carregarDataset).not.toHaveBeenCalled();
  });
  it('evento EXTERNAL (número comercial), mesmo de telefone da allowlist ⇒ descartado', async () => {
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO, { numero: EXTERNO }), e));
    expect(s.resumo).toMatchObject({ eventos: 1, descartados: 1 });
    expect(e.chamadas).toEqual([]);
  });
  it('número desconhecido (contexto indefinido) ⇒ descartado', async () => {
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO, { numero: 'pn-de-outra-conta' }), e));
    expect(s.resumo).toMatchObject({ eventos: 1, descartados: 1 });
    expect(e.chamadas).toEqual([]);
  });
  it('lote misto: só o evento permitido entra; o texto do descartado não chega à persistência', async () => {
    const e = espiao();
    const p = payload(TEXTO) as { entry: { changes: { value: { messages: unknown[] } }[] }[] };
    p.entry[0].changes[0].value.messages.push({ from: OUTRO, id: 'wamid.OUTRO', timestamp: '1789041601', type: 'text', text: { body: 'segredo de terceiro' } });
    const s = await processarWebhookCentral(entradaDe(p, e));
    expect(s.status).toBe(200);
    expect(s.resumo).toMatchObject({ eventos: 2, descartados: 1, persistidos: 1, processados: 1, concluidos: 1 });
    expect([...e.lotes[0].textos.keys()]).toEqual([WAMID]);
    expect(JSON.stringify(e.lotes[0])).not.toContain('segredo de terceiro');
    expect(JSON.stringify(e.lotes[0])).not.toContain(OUTRO);
  });
});

// ---------------------------------------------------------------------------
// (c) caminho feliz: ordem exata e hashes
// ---------------------------------------------------------------------------
describe('(c) mensagem INTERNAL permitida', () => {
  it('ordem exata carregarEstado → carregarIdentidades → persistirLote → carregarDataset → registrarProcessamento(CONCLUIDO)', async () => {
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote', 'carregarDataset', 'registrarProcessamento:CONCLUIDO']);
    expect(s.resumo).toEqual({ modo: 'on', status: 200, eventos: 1, descartados: 0, persistidos: 1, processados: 1, concluidos: 1, erros: 0, codigos: [] });
  });
  it('o registro CONCLUIDO leva canExecute false, sent false, hashes corretos, intent, situação, versões e uuids do banco', async () => {
    const e = espiao();
    await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    const motor = await respostaDoMotor(payload(TEXTO));
    expect(e.registros).toHaveLength(1);
    const r = e.registros[0];
    expect(r).toMatchObject({
      organizationId: ORG, origem: 'WEBHOOK', status: 'CONCLUIDO', canExecute: false, sent: false,
      intent: 'FINANCE', situacao: 'respondido', identidadeId: 'wid-1', engineSha: 'abc1234', flowVersion: 'central-alpha-1', processedAt: AGORA,
    });
    expect(r.atorId).toBeUndefined();
    expect(r.conversaId).toMatch(UUID);
    expect(r.mensagemId).toMatch(UUID);
    expect(r.durationMs).toBeGreaterThan(0);
    // inputSha256 = sha256(texto NORMALIZADO) e outputSha256 = sha256(resposta.texto), com o hash do Node (o mesmo da F2-DATA)
    expect(r.inputSha256).toBe(sha(limparTexto(TEXTO)!));
    expect(r.outputSha256).toBe(sha(motor.resposta.texto));
    expect(r.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('o texto persistido é o normalizado (limparTexto) e a identidade VERIFIED vai por conversa no lote', async () => {
    const e = espiao();
    const bruto = '  Quanto temos   de caixa\thoje?  ';
    await processarWebhookCentral(entradaDe(payload(bruto), e));
    const lote = e.lotes[0];
    expect(lote.organizationId).toBe(ORG);
    expect(lote.textos.get(WAMID)).toBe(limparTexto(bruto));
    expect(lote.textos.get(WAMID)).toBe('Quanto temos de caixa hoje?');
    const conversa = lote.aplicado.estado.conversas[0];
    expect(lote.identidadePorConversa.get(conversa.id)).toBe('wid-1');
    expect(e.registros[0].inputSha256).toBe(sha('Quanto temos de caixa hoje?'));
  });
  it('impressaoTexto é byte a byte o createHash("sha256") do Node (a trigger da 0052 compara com body_sha256)', () => {
    for (const t of ['', 'a', TEXTO, 'ação · 31 °C — ç ã é 🙂', 'x'.repeat(1000)]) expect(impressaoTexto(t)).toBe(sha(t));
  });
});

// ---------------------------------------------------------------------------
// (d) reenvio da Meta de mensagem já CONCLUIDO
// ---------------------------------------------------------------------------
describe('(d) reenvio de mensagem já concluída', () => {
  it('200, persistência idempotente chamada, Dataset NÃO carregado, motor não roda, nenhum registro novo', async () => {
    const e = espiao({ estado: { estado: estadoDoBanco(payload(TEXTO)), pendentesDeProcessamento: [], errosPorMensagem: new Map() } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote']);
    expect(e.carregarDataset).not.toHaveBeenCalled();
    expect(fluxoInterno).not.toHaveBeenCalled();
    expect(e.registros).toHaveLength(0);
    expect(s.resumo).toMatchObject({ persistidos: 0, processados: 0, concluidos: 0, erros: 0 });
    expect(e.lotes[0].aplicado.mensagensNovas).toHaveLength(0);
    expect(e.lotes[0].aplicado.duplicados).toHaveLength(1);
  });
  it('segundo CONCLUIDO recusado pelo índice parcial (jaConcluido) conta como processado, não como concluído nem erro', async () => {
    const e = espiao({ registrar: async () => ({ jaConcluido: true }) });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(s.resumo).toMatchObject({ processados: 1, concluidos: 0, erros: 0, codigos: [] });
  });
});

// ---------------------------------------------------------------------------
// (e) mensagem pendente (persistida sem CONCLUIDO)
// ---------------------------------------------------------------------------
describe('(e) mensagem pendente de processamento', () => {
  it('é reprocessada: sai do estado antes de aplicar, o motor roda e nasce exatamente um CONCLUIDO com os uuids do banco', async () => {
    const banco = estadoDoBanco(payload(TEXTO));
    const e = espiao({ estado: { estado: banco, pendentesDeProcessamento: [WAMID], errosPorMensagem: new Map([[WAMID, 1]]) } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote', 'carregarDataset', 'registrarProcessamento:CONCLUIDO']);
    expect(e.registros.filter((r) => r.status === 'CONCLUIDO')).toHaveLength(1);
    expect(s.resumo).toMatchObject({ processados: 1, concluidos: 1, erros: 0, codigos: [] });
    // a conversa e reusada (mesmo uuid do banco); a mensagem volta como "nova" para o lote idempotente
    expect(e.lotes[0].aplicado.conversasNovas).toHaveLength(0);
    expect(e.lotes[0].aplicado.mensagensNovas).toHaveLength(1);
    expect(e.registros[0].conversaId).toBe(banco.conversas[0].id);
  });
  it('removerPendentes tira a mensagem e os eventos dela, mantém a conversa e os eventos de abertura; separarPendentes respeita o teto', () => {
    const banco = estadoDoBanco(payload(TEXTO));
    const ajustado = removerPendentes(banco, new Set([WAMID]));
    expect(ajustado.conversas).toEqual(banco.conversas);
    expect(ajustado.mensagens).toHaveLength(0);
    expect(ajustado.eventos.map((ev) => ev.tipo)).toEqual(['CONVERSA_ABERTA']);
    expect(removerPendentes(banco, new Set())).toBe(banco);
    const sep = separarPendentes({ estado: banco, pendentesDeProcessamento: ['a', 'b', 'c'], errosPorMensagem: new Map([['a', LIMITE_TENTATIVAS_TRANSITORIAS], ['b', LIMITE_TENTATIVAS_TRANSITORIAS - 1]]) });
    expect([...sep.reprocessar]).toEqual(['b', 'c']);
    expect(sep.esgotadas).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// (f) erros: transitório × determinístico × teto
// ---------------------------------------------------------------------------
describe('(f) classes de erro e HTTP', () => {
  it('falha transitória em persistirLote de mensagem pendente ⇒ linha ERRO best-effort (uuids do banco) + 503', async () => {
    const banco = estadoDoBanco(payload(TEXTO));
    const e = espiao({
      estado: { estado: banco, pendentesDeProcessamento: [WAMID], errosPorMensagem: new Map() },
      persistir: async () => { throw new ErroCentralServidor('falha_banco', 'transitorio', 'timeout no PostgREST 5562988887777'); },
    });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(503);
    expect(s.resumo).toMatchObject({ erros: 1, codigos: ['falha_banco'], processados: 0, concluidos: 0 });
    expect(e.carregarDataset).not.toHaveBeenCalled();
    expect(e.registros).toHaveLength(1);
    expect(e.registros[0]).toMatchObject({ status: 'ERRO', errorCode: 'falha_banco', origem: 'WEBHOOK', canExecute: false, sent: false, conversaId: banco.conversas[0].id, mensagemId: banco.mensagens[0].id });
    expect(e.registros[0].inputSha256).toBe(sha(TEXTO)); // o conteudo ja estava persistido: a trigger exige o hash
    expect(e.registros[0].outputSha256).toBeUndefined();
  });
  it('falha transitória em persistirLote de mensagem NOVA ⇒ 503 sem linha (não há uuid ainda); a Meta reenvia', async () => {
    const e = espiao({ persistir: async () => { throw new ErroCentralServidor('falha_banco', 'transitorio'); } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(503);
    expect(e.registros).toHaveLength(0);
    expect(e.carregarDataset).not.toHaveBeenCalled();
  });
  it('exceção desconhecida (Error comum) depois da persistência ⇒ tratada como transitória: ERRO + 503, código sem mensagem', async () => {
    const e = espiao({ dataset: async () => { throw new Error(`conexão recusada para ${TELEFONE}: ${TEXTO}`); } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(503);
    expect(s.resumo.codigos).toEqual(['erro_inesperado']);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote', 'carregarDataset', 'registrarProcessamento:ERRO']);
    expect(e.registros[0]).toMatchObject({ status: 'ERRO', errorCode: 'erro_inesperado' });
  });
  it('falha determinística (ex.: stub nao_implementado da F2-DATA) ⇒ ERRO best-effort + 200 (a Meta não reenvia)', async () => {
    const e = espiao({ dataset: async () => { throw new ErroCentralServidor('nao_implementado', 'deterministico'); } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(s.resumo).toMatchObject({ erros: 1, codigos: ['nao_implementado'], concluidos: 0 });
    expect(e.registros.map((r) => r.status)).toEqual(['ERRO']);
  });
  it('falha determinística logo em carregarEstado ⇒ 200 e nada mais tocado', async () => {
    const e = espiao();
    e.portas.carregarEstado = async () => { throw new ErroCentralServidor('nao_implementado', 'deterministico'); };
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(s.resumo.codigos).toEqual(['nao_implementado']);
    expect(e.chamadas).toEqual([]);
  });
  it('teto de tentativas: pendente com erros ≥ limite não é reprocessada ⇒ 200 + tentativas_esgotadas, sem motor e sem registro', async () => {
    const banco = estadoDoBanco(payload(TEXTO));
    const e = espiao({ estado: { estado: banco, pendentesDeProcessamento: [WAMID], errosPorMensagem: new Map([[WAMID, LIMITE_TENTATIVAS_TRANSITORIAS]]) } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(s.resumo.codigos).toEqual(['tentativas_esgotadas']);
    expect(s.resumo).toMatchObject({ erros: 0, processados: 0 });
    expect(e.carregarDataset).not.toHaveBeenCalled();
    expect(e.registros).toHaveLength(0);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote']);
  });
  it('abaixo do teto NUNCA responde 200 para falha transitória', async () => {
    const banco = estadoDoBanco(payload(TEXTO));
    const e = espiao({
      estado: { estado: banco, pendentesDeProcessamento: [WAMID], errosPorMensagem: new Map([[WAMID, LIMITE_TENTATIVAS_TRANSITORIAS - 1]]) },
      dataset: async () => { throw new ErroCentralServidor('rede', 'transitorio'); },
    });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(503);
  });
  it('falha no próprio registro CONCLUIDO ⇒ 503 (transitória) e a linha ERRO best-effort que também falha não muda o status', async () => {
    const e = espiao({ registrar: async () => { throw new Error('indisponível'); } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(503);
    expect(e.chamadas.filter((c) => c.startsWith('registrarProcessamento'))).toEqual(['registrarProcessamento:CONCLUIDO', 'registrarProcessamento:ERRO']);
  });
});

// ---------------------------------------------------------------------------
// (g) sem texto
// ---------------------------------------------------------------------------
describe('(g) mensagem de áudio', () => {
  it('registro CONCLUIDO com situação sem_texto, SEM inputSha256, com outputSha256 da resposta fixa', async () => {
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload('', { tipo: 'audio' }), e));
    const motor = await respostaDoMotor(payload('', { tipo: 'audio' }));
    expect(s.status).toBe(200);
    expect(e.registros).toHaveLength(1);
    expect(e.registros[0]).toMatchObject({ status: 'CONCLUIDO', situacao: 'sem_texto' });
    expect(e.registros[0].inputSha256).toBeUndefined();
    expect(e.registros[0].outputSha256).toBe(sha(motor.resposta.texto));
    expect(e.lotes[0].textos.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (h) identidade
// ---------------------------------------------------------------------------
describe('(h) identidade por conversa', () => {
  it('PENDING ⇒ identidadeId ausente, identidadePorConversa sem a conversa, situação identidade_recusada', async () => {
    const e = espiao({ identidades: [identidade({ situacao: 'PENDING' })] });
    await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(e.lotes[0].identidadePorConversa.size).toBe(0);
    expect(e.registros[0]).toMatchObject({ status: 'CONCLUIDO', situacao: 'identidade_recusada' });
    expect(e.registros[0].identidadeId).toBeUndefined();
  });
  it('número não vinculado e identidade de OUTRA organização ⇒ sem identidade', async () => {
    for (const ids of [[], [identidade({ organizationId: '11111111-1111-4111-8111-111111111111' })], [identidade({ contexto: 'EXTERNAL' })]]) {
      const e = espiao({ identidades: ids });
      await processarWebhookCentral(entradaDe(payload(TEXTO), e));
      expect(e.lotes[0].identidadePorConversa.size).toBe(0);
      expect(e.registros[0].identidadeId).toBeUndefined();
    }
  });
  it('VERIFIED ⇒ o mesmo id nas duas pontas (lote e registro)', async () => {
    const e = espiao({ identidades: [identidade({ id: 'wid-verificada' })] });
    await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    const conversa = e.lotes[0].aplicado.estado.conversas[0];
    expect(e.lotes[0].identidadePorConversa.get(conversa.id)).toBe('wid-verificada');
    expect(e.registros[0].identidadeId).toBe('wid-verificada');
  });
});

// ---------------------------------------------------------------------------
// (i) nada de conteúdo em resumo, erro ou registro
// ---------------------------------------------------------------------------
describe('(i) sem conteúdo em nenhuma saída', () => {
  it('resumo e registros do caminho feliz e do erro não contêm o texto nem o telefone inteiro', async () => {
    const feliz = espiao();
    const s1 = await processarWebhookCentral(entradaDe(payload(TEXTO), feliz));
    const comErro = espiao({ dataset: async () => { throw new Error(`${TELEFONE} ${TEXTO}`); } });
    const s2 = await processarWebhookCentral(entradaDe(payload(TEXTO), comErro));
    for (const saida of [JSON.stringify(s1), JSON.stringify(s2), JSON.stringify(feliz.registros), JSON.stringify(comErro.registros)]) {
      expect(saida).not.toContain(TEXTO);
      expect(saida).not.toContain('caixa');
      expect(saida).not.toContain(TELEFONE);
      expect(saida).not.toContain(TELEFONE.slice(2)); // nem sem o DDI
    }
  });
  it('o código de erro é higienizado: sem espaços, sem mensagem, no máximo 80 caracteres', async () => {
    const e = espiao({ dataset: async () => { throw new ErroCentralServidor(`Falha grave: ${TELEFONE} ${'x'.repeat(200)}`, 'deterministico'); } });
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.resumo.codigos[0]).toMatch(/^[a-z0-9_]{1,80}$/);
    expect(s.resumo.codigos[0]).not.toContain(TELEFONE);
    expect(s.resumo.codigos[0]).not.toMatch(/[0-9]{7,}/); // CHECK da 0052 em error_code
    expect(s.resumo.codigos[0]).toBe('falha_grave_' + 'x'.repeat(68));
    expect(e.registros[0].errorCode).toBe(s.resumo.codigos[0]);
    expect(codigoSeguro('HTTP 503')).toBe('http_503');
    expect(codigoSeguro('   ')).toBe('erro');
  });
});

// ---------------------------------------------------------------------------
// (j) defesa: atendimento executável é bug
// ---------------------------------------------------------------------------
describe('(j) podeExecutar diferente de false', () => {
  it('⇒ erro determinístico execucao_indevida: nenhum CONCLUIDO, linha ERRO e 200', async () => {
    vi.mocked(fluxoInterno).mockImplementationOnce(async (entrada) => {
      const r = await mocks.fluxoOriginal!(entrada);
      return { ...r, atendimentos: r.atendimentos.map((a) => ({ ...a, podeExecutar: true }) as unknown as AtendimentoInterno) };
    });
    const e = espiao();
    const s = await processarWebhookCentral(entradaDe(payload(TEXTO), e));
    expect(s.status).toBe(200);
    expect(s.resumo.codigos).toEqual(['execucao_indevida']);
    expect(e.registros.map((r) => r.status)).toEqual(['ERRO']);
  });
});

// ---------------------------------------------------------------------------
// Guardas estáticos do módulo
// ---------------------------------------------------------------------------
describe('guardas estáticos', () => {
  it('webhookCentral.ts é puro: sem ambiente, sem cliente de banco, sem rede, sem console, sem escrita direta', () => {
    const fonte = fs.readFileSync('src/core/central/webhookCentral.ts', 'utf8');
    expect(fonte).not.toMatch(/process\.env/);
    expect(fonte).not.toMatch(/@supabase|fetch\(|graph\.facebook\.com|api\.anthropic\.com/);
    expect(fonte).not.toMatch(/console\.(log|info|warn|error)\(/);
    expect(fonte).not.toMatch(/\.(insert|upsert|update)\(|\brpc\(/);
    expect(fonte).not.toMatch(/registrarPrevisaoDF|persistirRemoto|decidirPrevisaoDF/);
  });
});

// ---------------------------------------------------------------------------
// Handler Netlify: com o modo desligado responde exatamente como antes; ligado, injeta as portas
// ---------------------------------------------------------------------------
describe('netlify/functions/channel-meta-webhook.ts', () => {
  const APP_SECRET = 'app-secret-longo-o-suficiente-para-hmac';
  const assinar = (corpo: string) => `sha256=${createHmac('sha256', APP_SECRET).update(corpo).digest('hex')}`;
  const requisicao = (corpo: string, assinatura?: string) => new Request('https://eiffcontrol.com.br/api/channel/meta/webhook', {
    method: 'POST', body: corpo, headers: { 'content-type': 'application/json', ...(assinatura ? { 'x-hub-signature-256': assinatura } : {}) },
  });
  const ambienteMeta = () => {
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'EAAtoken-de-teste-que-nunca-sai');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', INTERNO);
    vi.stubEnv('META_WHATSAPP_WABA_ID', 'waba-1');
    vi.stubEnv('META_WHATSAPP_VERIFY_TOKEN', 'verify');
    vi.stubEnv('META_WHATSAPP_APP_SECRET', APP_SECRET);
    vi.stubEnv('EIFF_CENTRAL_PHONE_NUMBER_ID', INTERNO);
    vi.stubEnv('EIFF_COMMERCIAL_PHONE_NUMBER_ID', EXTERNO);
    vi.stubEnv('CENTRAL_ALPHA_MODE', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  };
  const ambienteAlpha = () => {
    ambienteMeta();
    vi.stubEnv('CENTRAL_ALPHA_MODE', 'on');
    vi.stubEnv('EIFF_CENTRAL_ORGANIZATION_ID', ORG);
    vi.stubEnv('CENTRAL_ALPHA_NUMBERS', TELEFONE);
    vi.stubEnv('COMMIT_REF', 'abc1234');
    vi.stubEnv('SUPABASE_URL', 'https://projeto-de-teste.supabase.co');
  };
  const handler = async () => (await import('../../../netlify/functions/channel-meta-webhook')).default;
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
    mocks.createClient.mockClear();
    mocks.criarPersistenciaCentral.mockReset();
    mocks.criarCarregadorDataset.mockReset();
  });

  it('CENTRAL_ALPHA_MODE ausente: POST assinado responde 200 {ok, eventos} como antes; nenhum cliente, nenhuma fábrica', async () => {
    ambienteMeta();
    const corpo = JSON.stringify(payload(TEXTO));
    const resp = await (await handler())(requisicao(corpo, assinar(corpo)));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, eventos: 1 });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.criarPersistenciaCentral).not.toHaveBeenCalled();
    expect(mocks.criarCarregadorDataset).not.toHaveBeenCalled();
  });
  it('POST sem assinatura continua 401 e nada do Alpha é tocado, mesmo com o modo ligado', async () => {
    ambienteAlpha();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-de-teste');
    const resp = await (await handler())(requisicao(JSON.stringify(payload(TEXTO))));
    expect(resp.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('modo on sem SUPABASE_SERVICE_ROLE_KEY: resposta de antes, log com o motivo, nunca fallback para anon', async () => {
    ambienteAlpha();
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-nao-pode-ser-usada');
    const corpo = JSON.stringify(payload(TEXTO));
    const resp = await (await handler())(requisicao(corpo, assinar(corpo)));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, eventos: 1 });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('service_role_ausente');
    expect(logs.join('\n')).not.toContain('anon-nao-pode-ser-usada');
  });
  it('modo on com contexto incompleto (organização inválida): resposta de antes e motivo no log', async () => {
    ambienteAlpha();
    vi.stubEnv('EIFF_CENTRAL_ORGANIZATION_ID', 'org-eiff');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-de-teste');
    const corpo = JSON.stringify(payload(TEXTO));
    const resp = await (await handler())(requisicao(corpo, assinar(corpo)));
    expect(await resp.json()).toEqual({ ok: true, eventos: 1 });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('organizacao_invalida');
  });
  it('modo on completo: cria o cliente service_role uma vez, injeta as fábricas fixas e responde {ok, eventos, processados}', async () => {
    ambienteAlpha();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-de-teste');
    const e = espiao();
    mocks.criarPersistenciaCentral.mockImplementation(() => e.portas);
    mocks.criarCarregadorDataset.mockImplementation(() => e.carregarDataset);
    const corpo = JSON.stringify(payload(TEXTO));
    const resp = await (await handler())(requisicao(corpo, assinar(corpo)));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, eventos: 1, processados: 1 });
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith('https://projeto-de-teste.supabase.co', 'service-role-de-teste', { auth: { persistSession: false, autoRefreshToken: false } });
    const cliente = mocks.createClient.mock.results[0].value;
    expect(mocks.criarPersistenciaCentral).toHaveBeenCalledWith(cliente);
    expect(mocks.criarCarregadorDataset).toHaveBeenCalledWith(cliente);
    expect(e.chamadas).toEqual(['carregarEstado', 'carregarIdentidades', 'persistirLote', 'carregarDataset', 'registrarProcessamento:CONCLUIDO']);
    expect(e.registros[0]).toMatchObject({ organizationId: ORG, status: 'CONCLUIDO', engineSha: 'abc1234', identidadeId: 'wid-1' });
    // log: contagens e codigos, nunca texto, telefone, token ou chave
    const tudo = logs.join('\n');
    expect(tudo).toContain('"processados":1');
    for (const proibido of [TEXTO, TELEFONE, 'service-role-de-teste', 'EAAtoken']) expect(tudo).not.toContain(proibido);
  });
  it('falha transitória da persistência vira 503 na resposta HTTP (a Meta reenvia)', async () => {
    ambienteAlpha();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-de-teste');
    const e = espiao({ persistir: async () => { throw new ErroCentralServidor('falha_banco', 'transitorio'); } });
    mocks.criarPersistenciaCentral.mockImplementation(() => e.portas);
    mocks.criarCarregadorDataset.mockImplementation(() => e.carregarDataset);
    const corpo = JSON.stringify(payload(TEXTO));
    const resp = await (await handler())(requisicao(corpo, assinar(corpo)));
    expect(resp.status).toBe(503);
    expect(await resp.json()).toEqual({ ok: false, eventos: 1, processados: 0 });
  });
  it('guardas estáticos da função: sem Graph POST, sem RPC, sem tabela direta, sem fluxoInterno/cfo importados', () => {
    const fonte = fs.readFileSync('netlify/functions/channel-meta-webhook.ts', 'utf8');
    expect(fonte).not.toMatch(/graph\.facebook\.com|api\.anthropic\.com/);
    expect(fonte).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/);
    expect(fonte).not.toMatch(/\brpc\(|\.(insert|upsert|update|delete)\(|\bfrom\(['"`][a-z_]+['"`]\)/);
    expect(fonte).not.toMatch(/central\/fluxoInterno|\/cfo'/);
    expect(fonte).not.toMatch(/VITE_(META|OCTADESK)|SUPABASE_ANON_KEY/);
  });
});
