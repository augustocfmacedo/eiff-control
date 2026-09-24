// EIFF Inbox — ATIVAÇÃO OPERACIONAL (server-side): kill switches e a montagem das portas da ingestão a partir do ambiente.
// Excecao declarada de pureza do modulo (como ingestaoPorta.ts): `fetch` e injetado; nenhum segredo sai daqui.
//
// Flags (só no ambiente do servidor, nunca VITE_):
//   EIFF_INBOX_ENABLED=false        a Central segue respondendo; o Inbox não ingere nem processa nada; nada é apagado.
//   EIFF_INBOX_ROUTER_ENABLED=false mensagem persiste (Central → Inbox → thread NOVA em Não atribuídos); sem Octopus.
//   EIFF_INBOX_LLM_ENABLED=false    router só determinístico, mesmo com ANTHROPIC_API_KEY presente (a chave é compartilhada
//                                   com Assistente e Diretor Financeiro: desligar o Inbox não os desliga).
//   EIFF_INBOX_OUTBOUND_ENABLED     SEMPRE false nesta fase: não existe caminho de envio no Inbox; `true` é ignorado com aviso.
// Padrões quando a variável não existe: inbox ON, router ON, llm OFF, outbound OFF (fail-safe: o que custa/age fica desligado).
import { configPortaIngest, portaIngestRpc } from './ingestaoPorta';
import type { PortasIngestao } from './ingestaoServidor';
import { configInteligencia, provedorAnthropic, type AmbienteInteligencia } from './inteligenciaLlm';
import { portaAplicarRoteamentoRpc, portaContextoRest, rotearNoServidor } from './roteamentoPorta';

export interface AmbienteAtivacao extends AmbienteInteligencia {
  EIFF_INBOX_ENABLED?: string; EIFF_INBOX_ROUTER_ENABLED?: string; EIFF_INBOX_LLM_ENABLED?: string; EIFF_INBOX_OUTBOUND_ENABLED?: string;
  SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; EIFF_INBOX_ORGANIZATION_ID?: string;
}
export interface FlagsInbox { inbox: boolean; router: boolean; llm: boolean; /** sempre false nesta fase */ outbound: false; avisos: string[] }

const VERDADEIRO = new Set(['true', '1', 'on', 'yes', 'sim']);
const ligado = (v: string | undefined, padrao: boolean): boolean => { const s = (v ?? '').trim().toLowerCase(); return s ? VERDADEIRO.has(s) : padrao; };

/** Lê as flags. `outbound` é sempre false: o Inbox não tem caminho de envio e a flag existe só para deixar a intenção explícita. */
export function lerFlagsInbox(env: AmbienteAtivacao): FlagsInbox {
  const avisos: string[] = [];
  if (ligado(env.EIFF_INBOX_OUTBOUND_ENABLED, false)) avisos.push('EIFF_INBOX_OUTBOUND_ENABLED=true ignorado: o Inbox não envia nesta fase');
  return { inbox: ligado(env.EIFF_INBOX_ENABLED, true), router: ligado(env.EIFF_INBOX_ROUTER_ENABLED, true), llm: ligado(env.EIFF_INBOX_LLM_ENABLED, false), outbound: false, avisos };
}

export interface DepsAtivacao { fetch: typeof fetch; log?: (t: Record<string, unknown>) => void; agora?: () => string }
export type PortasInbox = { ligado: false; motivo: string; flags: FlagsInbox } | { ligado: true; organizacaoId: string; flags: FlagsInbox; portas: PortasIngestao; llm: boolean };

/**
 * Monta as portas da ingestão conforme as flags e o ambiente. Desligado (flag ou falta de chave/organização) devolve
 * `{ ligado: false, motivo }` e quem chama segue como se o Inbox não existisse. Router desligado = sem a porta `rotear`;
 * LLM desligado = sem `inteligencia` mesmo com a chave presente. Nunca lança.
 */
export function montarPortasInbox(env: AmbienteAtivacao, deps: DepsAtivacao): PortasInbox {
  const flags = lerFlagsInbox(env);
  for (const a of flags.avisos) deps.log?.({ evento: 'inbox_flags', outcome: 'aviso', aviso: a });
  if (!flags.inbox) return { ligado: false, motivo: 'EIFF_INBOX_ENABLED=false', flags };
  const porta = configPortaIngest(env);
  if ('motivo' in porta) return { ligado: false, motivo: porta.motivo, flags };
  const portas: PortasIngestao = { ingerir: portaIngestRpc(porta, deps.fetch), log: deps.log, agora: deps.agora };
  let llm = false;
  if (flags.router) {
    const cfgRot = { url: porta.url, chave: porta.chave, organizacaoId: porta.organizacaoId };
    const ia = flags.llm ? configInteligencia(env) : { motivo: 'EIFF_INBOX_LLM_ENABLED=false' };
    llm = 'chave' in ia;
    if (!llm) deps.log?.({ evento: 'inbox_inteligencia', outcome: 'desligada', motivo: (ia as { motivo: string }).motivo });
    portas.rotear = (threadId, messageId) => rotearNoServidor(threadId, messageId, {
      contexto: portaContextoRest(cfgRot, deps.fetch), aplicar: portaAplicarRoteamentoRpc(cfgRot, deps.fetch), log: deps.log, agora: deps.agora,
      inteligencia: 'chave' in ia ? (ctx) => provedorAnthropic(ia, { fetch: deps.fetch }, { equipes: ctx.equipes, regras: ctx.regras, obras: ctx.obras }) : undefined,
    });
  } else deps.log?.({ evento: 'inbox_roteamento', outcome: 'desligado', motivo: 'EIFF_INBOX_ROUTER_ENABLED=false' });
  return { ligado: true, organizacaoId: porta.organizacaoId, flags, portas, llm };
}
