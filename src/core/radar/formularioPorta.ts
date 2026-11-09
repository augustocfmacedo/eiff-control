/**
 * As portas REAIS da gravação do formulário: PostgREST com a chave de serviço.
 *
 * Mesmo desenho de `src/core/inbox/ingestaoPorta.ts`, e pelas mesmas razões:
 * - a chave vem do ambiente da função Netlify (`SUPABASE_SERVICE_ROLE_KEY`),
 *   nunca de `VITE_`, nunca do navegador, e NÃO sai daqui — nem em log, nem
 *   em mensagem de erro (o erro carrega só o status HTTP);
 * - `fetch` é injetado, para a prova não precisar de rede;
 * - a conversa continua sendo gravada pela RPC `inbox_ingest`, que já existia:
 *   esta porta não escreve em `inbox_thread` nem em `inbox_message`.
 *
 * ── A CHAVE DE SERVIÇO IGNORA RLS: O FILTRO DE ORGANIZAÇÃO É NOSSO ───────
 *
 * Toda consulta aqui carrega `organization_id` explícito. Com a chave de
 * serviço não há política nenhuma para esquecer de passar — o que sobra é a
 * disciplina de filtrar, e ela está em cada chamada.
 */
import type { CodigoProvider } from './canais'
import type { PortasGravacao, ResumoContatoCompletado } from './formularioGravacao'
import type { DadosDoContato } from '../inbox/formularioSite'
import type { RegistroFonte } from './types'
import { montarPortasInbox, type AmbienteAtivacao } from '../inbox/ativacao'

export interface ConfigPortaFormulario {
  url: string
  chave: string
  organizacaoId: string
  /** `radar_source.id` da fonte WEBSITE. */
  fonteId: string
}

export interface AmbienteFormulario {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  EIFF_INBOX_ORGANIZATION_ID?: string
  EIFF_FORM_SOURCE_ID?: string
}

export const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co'

/** Lê a configuração. Sem chave, organização ou fonte, a integração não grava — e diz por quê. */
export function configPortaFormulario(env: AmbienteFormulario): ConfigPortaFormulario | { motivo: string } {
  const chave = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const organizacaoId = (env.EIFF_INBOX_ORGANIZATION_ID ?? '').trim()
  const fonteId = (env.EIFF_FORM_SOURCE_ID ?? '').trim()
  if (chave === '') return { motivo: 'sem SUPABASE_SERVICE_ROLE_KEY' }
  if (organizacaoId === '') return { motivo: 'sem EIFF_INBOX_ORGANIZATION_ID' }
  if (fonteId === '') return { motivo: 'sem EIFF_FORM_SOURCE_ID' }
  return { url: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO).replace(/\/$/, ''), chave, organizacaoId, fonteId }
}

/** Linha de `radar_source_record` → `RegistroFonte`. Mesmo mapeamento do adapter do Radar. */
export function registroDoBanco(x: Record<string, unknown>): RegistroFonte {
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v))
  return {
    id: String(x['id']), fonteId: String(x['source_id']), tipo: x['record_type'] as RegistroFonte['tipo'],
    externoId: s(x['external_id']), payload: x['payload'], recebidoEm: String(x['received_at']),
    payloadFingerprint: s(x['payload_fingerprint']), statusIntake: s(x['intake_status']) as RegistroFonte['statusIntake'],
    entidadeId: s(x['entity_id']), decididoEm: s(x['decided_at']), decididoPor: s(x['decided_by']),
    motivoDecisao: s(x['decision_reason']),
  }
}

const CAMPOS_REGISTRO = 'id,source_id,record_type,external_id,payload,payload_fingerprint,intake_status,entity_id,received_at,decided_at,decided_by,decision_reason'

/** Campos do contato que o formulário completa quando estão vazios. */
export const CAMPOS_COMPLETAVEIS: readonly string[] = Object.freeze(['name', 'company_name', 'relation_kind'])

export function portasFormularioRest(
  cfg: ConfigPortaFormulario,
  fetchFn: typeof fetch,
  log?: (t: Record<string, unknown>) => void,
): PortasGravacao {
  const base = { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, 'content-type': 'application/json' }
  const org = `organization_id=eq.${encodeURIComponent(cfg.organizacaoId)}`
  const q = (v: string) => encodeURIComponent(v)

  async function pedir(caminho: string, init?: RequestInit): Promise<Record<string, unknown>[]> {
    const r = await fetchFn(`${cfg.url}/rest/v1/${caminho}`, { ...init, headers: { ...base, ...(init?.headers ?? {}) } })
    // o erro carrega SÓ o status: nunca o corpo (poderia ecoar dado do lead) e nunca a chave
    if (!r.ok) throw new Error(`postgrest ${init?.method ?? 'GET'} ${caminho.split('?')[0]} http ${r.status}`)
    if (r.status === 204) return []
    const d = await r.json().catch(() => [])
    return Array.isArray(d) ? (d as Record<string, unknown>[]) : [d as Record<string, unknown>]
  }

  return {
    async registrosDaSubmissao(fonteId, externoId) {
      const linhas = await pedir(`radar_source_record?${org}&source_id=eq.${q(fonteId)}&external_id=eq.${q(externoId)}&select=${CAMPOS_REGISTRO}`)
      return linhas.map(registroDoBanco)
    },

    async conversaExiste(provider: CodigoProvider, externalMessageId: string) {
      const linhas = await pedir(`inbox_message?${org}&provider=eq.${q(provider)}&external_message_id=eq.${q(externalMessageId)}&select=id&limit=1`)
      return linhas.length > 0
    },

    /**
     * O estado de muitas submissões em duas consultas, em lotes de 50 ids.
     *
     * Para a reconciliação agendada isto não é otimização: sem ele, o teto do
     * lote reprocessaria sempre as mesmas submissões mais antigas e a fila
     * nunca andaria. Aqui só se LÊ o que existe; quem decide o que pular é o
     * core, com os dois critérios do plano.
     */
    async estadoEmLote(fonteId: string, provider: CodigoProvider, externoIds: readonly string[]) {
      const evidencias: { externoId: string; impressao?: string }[] = []
      const conversas: string[] = []
      for (let i = 0; i < externoIds.length; i += 50) {
        const parte = externoIds.slice(i, i + 50)
        // PostgREST: in.("a","b"). As aspas valem para qualquer id, inclusive com vírgula.
        const lista = `in.(${parte.map((x) => `"${encodeURIComponent(x)}"`).join(',')})`
        for (const linha of await pedir(`radar_source_record?${org}&source_id=eq.${q(fonteId)}&external_id=${lista}&select=external_id,payload_fingerprint`)) {
          evidencias.push({
            externoId: String(linha['external_id']),
            ...(linha['payload_fingerprint'] === null || linha['payload_fingerprint'] === undefined
              ? {} : { impressao: String(linha['payload_fingerprint']) }),
          })
        }
        for (const linha of await pedir(`inbox_message?${org}&provider=eq.${q(provider)}&external_message_id=${lista}&select=external_message_id`)) {
          conversas.push(String(linha['external_message_id']))
        }
      }
      return { evidencias, conversas }
    },

    async gravarEvidencia(linha) {
      // `return=representation` não é conforto: é a CONFIRMAÇÃO de que a linha
      // existe. Sem id na volta, quem chamou não devolve sucesso.
      const linhas = await pedir('radar_source_record?select=id', {
        method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(linha),
      })
      const id = linhas[0]?.['id']
      return id === undefined ? '' : String(id)
    },

    // A conversa é da RPC que já existia. Quem a monta é `montarPortasInbox`.
    ingerir: async () => { throw new Error('porta de ingestão não ligada: use montarPortasInbox') },

    async contatoDaIdentidade(canal, identificador) {
      const linhas = await pedir(`inbox_contact_identity?${org}&channel=eq.${q(canal)}&identifier=eq.${q(identificador)}&select=contact_id&limit=1`)
      const id = linhas[0]?.['contact_id']
      return id === undefined ? undefined : String(id)
    },

    async completarContato(contatoId, dados: DadosDoContato): Promise<ResumoContatoCompletado> {
      const atuais = await pedir(`inbox_contact?${org}&id=eq.${q(contatoId)}&select=id,name,company_name,relation_kind`)
      const c = atuais[0]
      if (c === undefined) return { campos: [], identidades: 0 }

      const mudar: Record<string, unknown> = {}
      const nomeVazio = String(c['name'] ?? '').trim() === '' || c['name'] === 'Contato não identificado'
      if (nomeVazio && dados.nome !== undefined) mudar['name'] = dados.nome
      if ((c['company_name'] ?? null) === null && dados.empresaNome !== undefined) mudar['company_name'] = dados.empresaNome
      if (c['relation_kind'] === 'desconhecido') mudar['relation_kind'] = dados.relacaoSeDesconhecido
      if (Object.keys(mudar).length > 0) {
        await pedir(`inbox_contact?${org}&id=eq.${q(contatoId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(mudar) })
      }

      // O telefone como segunda identidade. `ignore-duplicates` é o ponto:
      // se o número já pertence a alguém, NÃO se mexe no dono — a unique
      // (organização, canal, identificador) é a regra, e ela fica no banco.
      let identidades = 0
      for (const i of dados.identidades) {
        try {
          await pedir('inbox_contact_identity?select=id', {
            method: 'POST',
            headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
            body: JSON.stringify({
              organization_id: cfg.organizacaoId, contact_id: contatoId, channel: i.canal,
              identifier: i.identificador, display_name: i.nomeInformado ?? null, verified: false,
            }),
          }).then((r) => { identidades += r.length })
        } catch (e) {
          log?.({ evento: 'formulario_identidade', outcome: 'ignorada', motivo: (e as Error).message })
        }
      }
      return { campos: Object.keys(mudar), identidades }
    },

    log,
  }
}

/* ---------------------------------------------------------------
   A montagem completa, usada pelos DOIS caminhos de entrada
--------------------------------------------------------------- */

/**
 * As portas da integração, prontas: PostgREST (evidência e contato) + a RPC
 * `inbox_ingest` + o Octopus Router.
 *
 * Existe para que a borda do webhook e a reconciliação agendada partam da
 * MESMA montagem. Se um dos dois caminhos montasse as portas por conta
 * própria, bastaria uma flag lida de forma diferente para que o lead que
 * entra pelo webhook e o lead que entra pela recuperação acabassem em
 * lugares diferentes — e isso não apareceria em teste nenhum dos dois.
 */
export interface DepsIntegracao {
  fetch: typeof fetch
  log?(t: Record<string, unknown>): void
}

export type PortasIntegracao =
  | { ok: true; cfg: ConfigPortaFormulario; portas: PortasGravacao; roteador: boolean }
  | { ok: false; motivo: string }

export function montarPortasIntegracao(
  env: AmbienteFormulario & AmbienteAtivacao,
  deps: DepsIntegracao,
): PortasIntegracao {
  const cfg = configPortaFormulario(env)
  if ('motivo' in cfg) return { ok: false, motivo: cfg.motivo }
  // A conversa e o roteamento continuam sendo do Inbox, com os mesmos kill switches.
  const inbox = montarPortasInbox(env, { fetch: deps.fetch, log: deps.log })
  if (!inbox.ligado) return { ok: false, motivo: `inbox: ${inbox.motivo}` }
  const portas: PortasGravacao = {
    ...portasFormularioRest(cfg, deps.fetch, deps.log),
    ingerir: inbox.portas.ingerir,
    ...(inbox.portas.rotear !== undefined ? { rotear: inbox.portas.rotear } : {}),
  }
  return { ok: true, cfg, portas, roteador: inbox.portas.rotear !== undefined }
}
