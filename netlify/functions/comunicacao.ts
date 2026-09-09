// /api/comunicacao: geracao de abordagem por LLM, server-side. Valida o JWT do Supabase, le o papel SO do perfil no banco,
// valida o ContentSpec (catalogos fechados, sem PII, hash recalculado), reaproveita rascunho ativo com o mesmo context_hash,
// chama a Anthropic com saida estruturada, valida (fact gate + juiz semantico, uma regeneracao) e insere a comunicacao
// completa em READY_FOR_REVIEW. ANTHROPIC_API_KEY so aqui (nunca VITE_, nunca no navegador, nunca em logs/respostas).
// Modelo: ANTHROPIC_COMMUNICATION_MODEL -> ANTHROPIC_MODEL -> claude-opus-5.
import Anthropic from '@anthropic-ai/sdk';
import { COMMUNICATION_LLM_PROMPT_V1, PROMPT_JUIZ_V1, SCHEMA_JUIZ, SCHEMA_SAIDA_LLM, type ChamadaLlm, type PortasLlm } from '../../src/core/radar/comunicacaoLlm';
import { tratarGeracaoComunicacao } from '../../src/core/radar/comunicacaoServidor';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

function portasAnthropic(chave: string, modelo: string): PortasLlm {
  const client = new Anthropic({ apiKey: chave, maxRetries: 1, timeout: 60_000 });
  const chamar = async (system: string, usuario: string, schema: Record<string, unknown>, maxTokens: number): Promise<ChamadaLlm> => {
    const inicio = Date.now();
    const r = await client.messages.create({
      model: modelo, max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: usuario }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    });
    const latenciaMs = Date.now() - inicio;
    if (r.stop_reason === 'refusal') return { json: null, modelo: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, latenciaMs, recusa: r.stop_details?.category ?? 'refusal' };
    const texto = r.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = ((): unknown => { try { return JSON.parse(texto); } catch { return null; } })();
    return { json: parsed, modelo: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, latenciaMs };
  };
  return {
    gerar: (u) => chamar(COMMUNICATION_LLM_PROMPT_V1, u, SCHEMA_SAIDA_LLM as unknown as Record<string, unknown>, 2500),
    julgar: (u) => chamar(PROMPT_JUIZ_V1, u, SCHEMA_JUIZ as unknown as Record<string, unknown>, 800),
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const modelo = (process.env.ANTHROPIC_COMMUNICATION_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-5').trim();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);
  let body: unknown; try { body = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }
  try {
    const r = await tratarGeracaoComunicacao({ method: req.method, authorization: req.headers.get('authorization'), body }, { fetch, supabaseUrl, anon, llmDisponivel: !!chave, portas: (m) => portasAnthropic(chave, m), modelo });
    return json(r.corpo, r.status);
  } catch (e) {
    // nunca a chave, nunca o corpo: so a classe do erro
    const msg = e instanceof Anthropic.APIError ? `anthropic ${e.status ?? ''}` : 'falha interna';
    console.error('[comunicacao]', msg);
    return json({ erro: 'ia_indisponivel', mensagem: msg }, 502);
  }
};

export const config = { path: '/api/comunicacao' };
