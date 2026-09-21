// EIFF Central — Wave 03 F2-DATA: o UNICO escritor da Central.
//
// Contrato: ./servidorContratos.ts (PortasPersistenciaCentral, TABELAS_ESCRITA_CENTRAL, RegistroProcessamento).
// Este modulo escreve SOMENTE em central_conversation, central_message, central_event, central_message_content e
// central_message_processing (nomes literais em `.from('...')`: seguranca.test.ts varre isso). Nenhuma RPC, nenhum
// delete (purga e decisao futura), nenhum console, nenhum texto de mensagem nem telefone em claro em erro ou excecao.
// O cliente service_role entra por parametro (criado pela funcao Netlify) e nao sai daqui.
//
// Idempotencia por construcao (a Meta reenvia ate receber 200; as escritas NAO sao uma transacao so):
//   - conversa: chave (organization_id, context, phone_e164). Conversa nova entra por upsert `on conflict do nothing`;
//     em seguida a linha do banco e relida e recebe um patch com o MAIOR valor de last_message_at/last_inbound_at,
//     identity_id quando o lote trouxer e status so para reabrir uma ENCERRADA — nunca rebaixa status;
//   - mensagem: upsert `on conflict do nothing` em (organization_id, provider, external_message_id) e depois SELECT dos
//     ids de todas as mensagens do lote; status de mensagem existente avanca por update (o trigger do banco garante que
//     nao anda para tras);
//   - conteudo: `on conflict do nothing` sobre message_id — reenvio com texto diferente NUNCA sobrescreve;
//   - evento: o indice unico (organization_id, message_id, event_type) e PARCIAL (where message_id is not null) e o
//     `ON CONFLICT (...)` que o PostgREST gera nao leva o predicado, entao um upsert falharia (42P10). Aqui o evento
//     entra por SELECT dos existentes + INSERT dos faltantes, tolerando 23505 (outra instancia chegou antes) —
//     resultado identico ao `do nothing`. Abertura/reabertura (sem message_id) so quando a conversa foi criada/reaberta
//     nesta chamada, conferindo antes se ja existe (conversa, tipo, occurred_at);
//   - processamento: insert append-only; violacao do indice parcial central_message_processing_webhook_uk (segundo
//     CONCLUIDO de webhook) devolve { jaConcluido: true } sem erro.
// Ordem das escritas: conversa -> mensagem -> conteudo -> eventos. Erros saem como ErroCentralServidor (codigo curto, classe).
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mascararTelefone, type CommunicationContext } from '../radar/canais';
import { emBlocos, erroSupabase, linhasOuErro, PAGINA, respostaOuErro, TABELA_IDENTIDADE, type RespostaLinhas } from '../../data/datasetServidor';
import { chaveMensagem, type CentralConversation, type CentralEvent, type CentralMessage, type EstadoCentral } from './conversa';
import { ErroCentralServidor, NORMALIZATION_VERSION, type EstadoPersistido, type LotePersistencia, type PortasPersistenciaCentral, type RegistroProcessamento, type ResultadoPersistencia } from './servidorContratos';
import type { WhatsappIdentity } from './tipos';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_UNICIDADE = '23505';

// ---------------------------------------------------------------------------
// 1) Utilitarios puros (exportados para teste)
// ---------------------------------------------------------------------------
/** SHA-256 hex do texto normalizado (body_sha256 / input_sha256). */
export const sha256 = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');
/** Texto seguro para detail_safe/error_code: nenhuma sequencia de 7+ digitos (telefone) e tamanho limitado. */
export const textoSeguro = (t: string | undefined, maximo: number): string | null =>
  t ? t.replace(/\d{7,}/g, (d) => mascararTelefone(d)).slice(0, maximo) : null;
/** Timestamp do banco (com fuso) para ISO com "Z": o core compara marcas de tempo como texto. */
const iso = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};
const maior = (a: string | undefined, b: string | undefined): string | undefined => (!a ? b : !b ? a : b > a ? b : a);
const exigirOrganizacao = (org: string): string => {
  if (typeof org !== 'string' || !UUID.test(org.trim())) throw new ErroCentralServidor('organizacao_ausente', 'deterministico', 'organizacao_ausente (deterministico)');
  return org.trim();
};

const conversaDaLinha = (r: Row): CentralConversation => ({
  id: r.id, organizationId: r.organization_id, contexto: r.context, provider: r.provider, telefoneNormalizado: r.phone_e164,
  externalConversationId: r.external_conversation_id ?? undefined, identidadeId: r.identity_id ?? undefined, situacao: r.status,
  humanoResponsavelId: r.human_owner_id ?? undefined, abertaEm: iso(r.opened_at) ?? '', ultimaMensagemEm: iso(r.last_message_at),
  ultimaMensagemInboundEm: iso(r.last_inbound_at), encerradaEm: iso(r.closed_at),
});
const mensagemDaLinha = (r: Row): CentralMessage => ({
  id: r.id, organizationId: r.organization_id, conversaId: r.conversation_id, provider: r.provider, externalMessageId: r.external_message_id,
  direcao: r.direction, tipo: r.message_type ?? undefined, status: r.status ?? undefined, erroCodigo: r.error_code ?? undefined,
  ocorridaEm: iso(r.occurred_at) ?? '', registradaEm: iso(r.received_at) ?? iso(r.created_at) ?? '',
});
const identidadeDaLinha = (r: Row): WhatsappIdentity => ({
  id: r.id, organizationId: r.organization_id, usuarioId: r.profile_id ?? undefined, colaboradorId: r.worker_id ?? undefined,
  telefoneNormalizado: r.phone_e164, contexto: r.context, situacao: r.status, verificadoEm: iso(r.verified_at), revogadoEm: iso(r.revoked_at), criadoEm: iso(r.created_at) ?? '',
});

// ---------------------------------------------------------------------------
// 2) Leitura paginada (as mesmas primitivas SELECT do dataset do servidor)
// ---------------------------------------------------------------------------
type Construtor = any;
async function lerTudo(codigo: string, abrir: () => Construtor): Promise<Row[]> {
  const out: Row[] = [];
  for (let de = 0; ; de += PAGINA) {
    const linhas = await linhasOuErro(codigo, abrir().order('id').range(de, de + PAGINA - 1));
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}
/** Le em blocos de ids: `.in(coluna, bloco)` por chamada; lista vazia = nenhuma consulta. */
async function lerPorIds(codigo: string, ids: readonly string[], abrir: (bloco: string[]) => Construtor): Promise<Row[]> {
  const out: Row[] = [];
  for (const bloco of emBlocos([...new Set(ids)])) out.push(...(await lerTudo(codigo, () => abrir(bloco))));
  return out;
}
/** Executa uma escrita e converte qualquer falha (resposta ou excecao) em ErroCentralServidor. Sem `.select()` o PostgREST devolve data null. */
async function escrever(codigo: string, operacao: PromiseLike<RespostaLinhas>): Promise<Row[]> {
  const resposta = await respostaOuErro(codigo, operacao);
  return Array.isArray(resposta.data) ? resposta.data : [];
}
const ehUnicidade = (e: unknown): boolean => e instanceof ErroCentralServidor && e.message.includes(`code=${CODIGO_UNICIDADE}`);

// ---------------------------------------------------------------------------
// 3) Fabrica (nome e assinatura fixos pelo contrato)
// ---------------------------------------------------------------------------
export function criarPersistenciaCentral(cliente: SupabaseClient): PortasPersistenciaCentral {
  const db: any = cliente;

  async function carregarIdentidades(organizationId: string, contexto: CommunicationContext, telefones: string[]): Promise<WhatsappIdentity[]> {
    const org = exigirOrganizacao(organizationId);
    if (telefones.length === 0) return [];
    const linhas = await lerPorIds('ler_identidades', telefones, (bloco) =>
      db.from(TABELA_IDENTIDADE).select('id, organization_id, profile_id, worker_id, phone_e164, context, status, verified_at, revoked_at, created_at')
        .eq('organization_id', org).eq('context', contexto).in('phone_e164', bloco));
    return linhas.map(identidadeDaLinha);
  }

  async function carregarEstado(organizationId: string, contexto: CommunicationContext, telefones: string[], externalMessageIds: string[]): Promise<EstadoPersistido> {
    const org = exigirOrganizacao(organizationId);
    const conversas = telefones.length === 0 ? [] : (await lerPorIds('ler_conversas', telefones, (bloco) =>
      db.from('central_conversation').select('*').eq('organization_id', org).eq('context', contexto).in('phone_e164', bloco))).map(conversaDaLinha);
    const mensagens = externalMessageIds.length === 0 ? [] : (await lerPorIds('ler_mensagens', externalMessageIds, (bloco) =>
      db.from('central_message').select('*').eq('organization_id', org).in('external_message_id', bloco))).map(mensagemDaLinha);
    const porUuid = new Map(mensagens.map((m) => [m.id, m]));
    const uuids = mensagens.map((m) => m.id);
    const eventos: CentralEvent[] = uuids.length === 0 ? [] : (await lerPorIds('ler_eventos', uuids, (bloco) =>
      db.from('central_event').select('*').eq('organization_id', org).in('message_id', bloco))).flatMap((r) => {
      const m = porUuid.get(r.message_id);
      if (!m) return [];
      return [{
        id: r.id, organizationId: r.organization_id, conversaId: r.conversation_id, mensagemId: r.message_id, tipo: r.event_type,
        chave: `${org}|${m.provider}|${m.externalMessageId}|${r.event_type}`, ocorridaEm: iso(r.occurred_at) ?? '', registradaEm: iso(r.created_at) ?? '', detalhe: r.detail_safe ?? '',
      }];
    });
    const inbound = mensagens.filter((m) => m.direcao === 'inbound');
    const processamentos = inbound.length === 0 ? [] : await lerPorIds('ler_processamentos', inbound.map((m) => m.id), (bloco) =>
      db.from('central_message_processing').select('id, message_id, origin, status').eq('organization_id', org).in('message_id', bloco));
    const concluidas = new Set<string>();
    const erros = new Map<string, number>();
    for (const p of processamentos) {
      if (p.origin !== 'WEBHOOK') continue;
      const m = porUuid.get(p.message_id);
      if (!m) continue;
      if (p.status === 'CONCLUIDO') concluidas.add(m.externalMessageId);
      if (p.status === 'ERRO') erros.set(m.externalMessageId, (erros.get(m.externalMessageId) ?? 0) + 1);
    }
    const estado: EstadoCentral = { conversas, mensagens, eventos };
    return { estado, pendentesDeProcessamento: inbound.filter((m) => !concluidas.has(m.externalMessageId)).map((m) => m.externalMessageId), errosPorMensagem: erros };
  }

  async function persistirLote(lote: LotePersistencia): Promise<ResultadoPersistencia> {
    const org = exigirOrganizacao(lote.organizationId);
    const { aplicado, textos, identidadePorConversa } = lote;
    const estado = aplicado.estado;
    const mensagemPorId = new Map(estado.mensagens.map((m) => [m.id, m]));
    const novasConversas = new Set(aplicado.conversasNovas.map((c) => c.id));
    const novasMensagens = new Set(aplicado.mensagensNovas.map((m) => m.id));
    const reabertas = new Set(aplicado.eventosNovos.filter((e) => e.tipo === 'CONVERSA_REABERTA').map((e) => e.conversaId));
    const tocadas = [...aplicado.conversasNovas, ...aplicado.conversasAtualizadas];

    // 1) conversas: nova entra por `do nothing`; depois todas as tocadas sao relidas e recebem o patch com o maior valor
    if (aplicado.conversasNovas.length > 0) {
      await escrever('gravar_conversa', db.from('central_conversation').upsert(aplicado.conversasNovas.map((c) => ({
        organization_id: org, context: c.contexto, provider: c.provider, phone_e164: c.telefoneNormalizado,
        external_conversation_id: c.externalConversationId ?? null, identity_id: identidadePorConversa.get(c.id) ?? null,
        status: c.situacao, opened_at: c.abertaEm, last_message_at: c.ultimaMensagemEm ?? null, last_inbound_at: c.ultimaMensagemInboundEm ?? null, closed_at: c.encerradaEm ?? null,
      })), { onConflict: 'organization_id,context,phone_e164', ignoreDuplicates: true }));
    }
    const conversasUuid = new Map<string, string>(); // id do core -> uuid
    if (tocadas.length > 0 || estado.conversas.length > 0) {
      const telefones = [...new Set([...tocadas, ...estado.conversas].map((c) => c.telefoneNormalizado))];
      const linhas = (await lerPorIds('ler_conversas', telefones, (bloco) => db.from('central_conversation').select('*').eq('organization_id', org).in('phone_e164', bloco))).map(conversaDaLinha);
      const porChave = new Map(linhas.map((c) => [`${c.contexto}|${c.telefoneNormalizado}`, c]));
      for (const c of [...tocadas, ...estado.conversas]) {
        const banco = porChave.get(`${c.contexto}|${c.telefoneNormalizado}`);
        if (banco) conversasUuid.set(c.id, banco.id);
      }
      for (const c of tocadas) {
        const banco = porChave.get(`${c.contexto}|${c.telefoneNormalizado}`);
        if (!banco) throw new ErroCentralServidor('conversa_nao_persistida', 'transitorio', 'conversa_nao_persistida (transitorio)');
        const patch: Row = {};
        const ultima = maior(banco.ultimaMensagemEm, c.ultimaMensagemEm);
        if (ultima && ultima !== banco.ultimaMensagemEm) patch.last_message_at = ultima;
        const inbound = maior(banco.ultimaMensagemInboundEm, c.ultimaMensagemInboundEm);
        if (inbound && inbound !== banco.ultimaMensagemInboundEm) patch.last_inbound_at = inbound;
        if (!banco.externalConversationId && c.externalConversationId) patch.external_conversation_id = c.externalConversationId;
        const identidade = identidadePorConversa.get(c.id);
        if (identidade && identidade !== banco.identidadeId) patch.identity_id = identidade;
        // status: so REABRE uma conversa que o banco tem como ENCERRADA; qualquer outro estado do banco prevalece
        if ((reabertas.has(c.id) || novasConversas.has(c.id)) && banco.situacao === 'ENCERRADA' && c.situacao === 'ABERTA') { patch.status = 'ABERTA'; patch.closed_at = null; }
        if (Object.keys(patch).length > 0) await escrever('atualizar_conversa', db.from('central_conversation').update(patch).eq('id', banco.id).eq('organization_id', org));
      }
    }
    const uuidConversa = (idCore: string): string => {
      const u = conversasUuid.get(idCore) ?? (UUID.test(idCore) ? idCore : undefined);
      if (!u) throw new ErroCentralServidor('conversa_desconhecida', 'deterministico', 'conversa_desconhecida (deterministico)');
      return u;
    };

    // 2) mensagens: `do nothing` + SELECT de todas as do lote (novas e existentes)
    if (aplicado.mensagensNovas.length > 0) {
      await escrever('gravar_mensagem', db.from('central_message').upsert(aplicado.mensagensNovas.map((m) => ({
        organization_id: org, conversation_id: uuidConversa(m.conversaId), provider: m.provider, external_message_id: m.externalMessageId,
        direction: m.direcao, message_type: m.tipo ?? null, status: m.status ?? null, error_code: textoSeguro(m.erroCodigo, 80), occurred_at: m.ocorridaEm, received_at: m.registradaEm,
      })), { onConflict: 'organization_id,provider,external_message_id', ignoreDuplicates: true }));
    }
    const referenciadas = new Set<string>([...aplicado.mensagensNovas.map((m) => m.id), ...aplicado.eventosNovos.flatMap((e) => (e.mensagemId ? [e.mensagemId] : []))]);
    const externos = new Set<string>([...textos.keys()]);
    for (const id of referenciadas) { const m = mensagemPorId.get(id); if (m) externos.add(m.externalMessageId); }
    const mensagensUuid = new Map<string, string>(); // id do core -> uuid
    const uuidPorExterno = new Map<string, string>();
    const bancoPorUuid = new Map<string, CentralMessage>();
    if (externos.size > 0) {
      const linhas = (await lerPorIds('ler_mensagens', [...externos], (bloco) => db.from('central_message').select('*').eq('organization_id', org).in('external_message_id', bloco))).map(mensagemDaLinha);
      const corePorChave = new Map(estado.mensagens.map((m) => [chaveMensagem(org, m.provider, m.externalMessageId), m.id]));
      for (const m of linhas) {
        bancoPorUuid.set(m.id, m);
        uuidPorExterno.set(m.externalMessageId, m.id);
        const idCore = corePorChave.get(chaveMensagem(org, m.provider, m.externalMessageId));
        if (idCore) mensagensUuid.set(idCore, m.id);
        mensagensUuid.set(m.id, m.id);
      }
    }
    for (const id of referenciadas) {
      if (!mensagensUuid.has(id)) throw new ErroCentralServidor('mensagem_nao_persistida', 'transitorio', 'mensagem_nao_persistida (transitorio)');
    }
    // status de mensagem existente avanca por update (o trigger do banco nunca deixa andar para tras)
    for (const id of referenciadas) {
      if (novasMensagens.has(id)) continue;
      const m = mensagemPorId.get(id);
      const banco = bancoPorUuid.get(mensagensUuid.get(id)!);
      if (!m || !banco || !m.status || m.status === banco.status) continue;
      await escrever('atualizar_mensagem', db.from('central_message').update({ status: m.status, error_code: textoSeguro(m.erroCodigo, 80) ?? null }).eq('id', banco.id).eq('organization_id', org));
    }

    // 3) conteudo: `do nothing` sobre message_id; o retorno traz SO as linhas inseridas
    const conteudosNovos: string[] = [];
    const conteudos: Row[] = [];
    for (const [externo, texto] of textos) {
      const uuid = uuidPorExterno.get(externo);
      if (!uuid || !texto) continue;
      const m = bancoPorUuid.get(uuid);
      if (m && m.direcao !== 'inbound') continue; // nesta fase so o inbound tem conteudo (o banco tambem recusa)
      conteudos.push({ message_id: uuid, organization_id: org, body_text: texto, body_sha256: sha256(texto), normalization_version: NORMALIZATION_VERSION });
    }
    if (conteudos.length > 0) {
      const externoPorUuid = new Map([...uuidPorExterno].map(([e, u]) => [u, e]));
      const inseridas = await escrever('gravar_conteudo', db.from('central_message_content').upsert(conteudos, { onConflict: 'message_id', ignoreDuplicates: true }).select('message_id'));
      for (const r of inseridas) { const e = externoPorUuid.get(r.message_id); if (e) conteudosNovos.push(e); }
    }

    // 4) eventos: com mensagem -> existentes + faltantes tolerando 23505; sem mensagem -> so abertura/reabertura desta chamada
    const linhaEvento = (e: CentralEvent, mensagemUuid: string | null): Row => ({
      organization_id: org, conversation_id: uuidConversa(e.conversaId), message_id: mensagemUuid, event_type: e.tipo,
      occurred_at: e.ocorridaEm, actor_kind: mensagemUuid ? 'PROVIDER' : 'SYSTEM', detail_safe: textoSeguro(e.detalhe, 500),
    });
    const comMensagem = aplicado.eventosNovos.filter((e) => !!e.mensagemId);
    if (comMensagem.length > 0) {
      const uuids = [...new Set(comMensagem.map((e) => mensagensUuid.get(e.mensagemId!)!))];
      const existentes = await lerPorIds('ler_eventos', uuids, (bloco) => db.from('central_event').select('id, message_id, event_type').eq('organization_id', org).in('message_id', bloco));
      const vistos = new Set(existentes.map((r) => `${r.message_id}|${r.event_type}`));
      const faltantes: Row[] = [];
      for (const e of comMensagem) {
        const uuid = mensagensUuid.get(e.mensagemId!)!;
        const chave = `${uuid}|${e.tipo}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        faltantes.push(linhaEvento(e, uuid));
      }
      await inserirEventos(faltantes);
    }
    for (const e of aplicado.eventosNovos.filter((x) => !x.mensagemId)) {
      const criadaOuReaberta = (e.tipo === 'CONVERSA_ABERTA' && novasConversas.has(e.conversaId)) || (e.tipo === 'CONVERSA_REABERTA' && reabertas.has(e.conversaId));
      if (!criadaOuReaberta) continue;
      const conversaUuid = uuidConversa(e.conversaId);
      const ja = await linhasOuErro('ler_eventos', db.from('central_event').select('id').eq('organization_id', org).eq('conversation_id', conversaUuid).eq('event_type', e.tipo).eq('occurred_at', e.ocorridaEm).limit(1));
      if (ja.length > 0) continue;
      await inserirEventos([linhaEvento(e, null)]);
    }

    return { ids: { conversas: conversasUuid, mensagens: mensagensUuid }, conteudosNovos };
  }

  /** Insere o lote de eventos; se outra instancia chegou antes (23505), insere um a um tolerando o duplicado. */
  async function inserirEventos(linhas: Row[]): Promise<void> {
    if (linhas.length === 0) return;
    try {
      await escrever('gravar_evento', db.from('central_event').insert(linhas));
      return;
    } catch (e) {
      if (!ehUnicidade(e)) throw e;
    }
    for (const linha of linhas) {
      try { await escrever('gravar_evento', db.from('central_event').insert(linha)); } catch (e) { if (!ehUnicidade(e)) throw e; }
    }
  }

  async function registrarProcessamento(registro: RegistroProcessamento): Promise<{ id?: string; jaConcluido: boolean }> {
    const org = exigirOrganizacao(registro.organizationId);
    const linha = {
      organization_id: org, conversation_id: registro.conversaId, message_id: registro.mensagemId, identity_id: registro.identidadeId ?? null,
      origin: registro.origem, actor_id: registro.atorId ?? null, engine_sha: registro.engineSha ?? null, flow_version: registro.flowVersion,
      input_sha256: registro.inputSha256 ?? null, output_sha256: registro.outputSha256 ?? null, intent: registro.intent ?? null, situation: registro.situacao ?? null,
      status: registro.status, error_code: textoSeguro(registro.errorCode, 80), can_execute: false, sent: false,
      duration_ms: Math.max(0, Math.round(registro.durationMs)), processed_at: registro.processedAt,
    };
    let resposta: RespostaLinhas;
    try { resposta = await db.from('central_message_processing').insert(linha).select('id'); } catch (e) { throw erroSupabase('registrar_processamento', e); }
    if (resposta.error) {
      if (resposta.error.code === CODIGO_UNICIDADE && registro.origem === 'WEBHOOK' && registro.status === 'CONCLUIDO') return { jaConcluido: true };
      throw erroSupabase('registrar_processamento', { ...resposta.error, status: resposta.status ?? resposta.error.status });
    }
    const id = resposta.data?.[0]?.id;
    return { id: typeof id === 'string' ? id : undefined, jaConcluido: false };
  }

  return { carregarEstado, carregarIdentidades, persistirLote, registrarProcessamento };
}
