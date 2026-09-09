// /api/comunicacao: geracao de abordagem por LLM, server-side. Valida o JWT do Supabase, le o papel SO do perfil no banco,
// reconstroi o ContentSpec a partir do banco (Server Truth 01), reaproveita rascunho ativo com o mesmo context_hash,
// chama a Anthropic com saida estruturada, valida (fact gate + juiz semantico, uma regeneracao) e insere a comunicacao
// completa em READY_FOR_REVIEW. ANTHROPIC_API_KEY so aqui (nunca VITE_, nunca no navegador, nunca em logs/respostas).
// Modelos: ANTHROPIC_COMMUNICATION_MODEL -> claude-sonnet-5 (nunca herda ANTHROPIC_MODEL, que e do Assistente);
// ANTHROPIC_COMMUNICATION_JUDGE_MODEL -> claude-sonnet-5.
// Orcamento de tempo (Latency Budget Patch 01): funcao sincrona = 60 s rigidos. SDK sem retry implicito, timeout por
// chamada (ANTHROPIC_CALL_TIMEOUT_MS, 22 s) nunca maior que o restante do deadline total (COMMUNICATION_DEADLINE_MS, 50 s);
// estouro vira 503 llm_timeout controlado, nunca 504 do Netlify. Telemetria communication_timing so com numeros/modelos.
import Anthropic from '@anthropic-ai/sdk';
import { COMMUNICATION_LLM_PROMPT_V1, EFFORT_COMUNICACAO, ErroTimeoutLlm, MAX_TOKENS_GERACAO, MAX_TOKENS_JUIZ, OPCOES_CLIENTE_ANTHROPIC, PROMPT_JUIZ_V1, SCHEMA_JUIZ, SCHEMA_SAIDA_LLM, configuracaoLlm, type ChamadaLlm, type ConfiguracaoLlm, type OpcoesChamada, type PortasLlm } from '../../src/core/radar/comunicacaoLlm';
import { tratarGeracaoComunicacao } from '../../src/core/radar/comunicacaoServidor';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

function portasAnthropic(chave: string, cfg: ConfiguracaoLlm, modelo: string, modeloJuiz: string): PortasLlm {
  const client = new Anthropic({ apiKey: chave, ...OPCOES_CLIENTE_ANTHROPIC, timeout: cfg.timeoutChamadaMs }); // maxRetries: 0
  const chamar = async (m: string, system: string, usuario: string, schema: Record<string, unknown>, maxTokens: number, o?: OpcoesChamada): Promise<ChamadaLlm> => {
    const inicio = Date.now();
    // timeout desta chamada: o menor entre o teto por chamada e o que o orquestrador ainda tem de deadline
    const timeout = Math.max(1_000, Math.min(cfg.timeoutChamadaMs, o?.timeoutMs ?? cfg.timeoutChamadaMs));
    let r: Anthropic.Message;
    try {
      r = await client.messages.create({
        model: m, max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: usuario }],
        output_config: { effort: EFFORT_COMUNICACAO, format: { type: 'json_schema', schema } },
      }, { timeout });
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ErroTimeoutLlm(`timeout ${timeout} ms`);
      throw e;
    }
    const latenciaMs = Date.now() - inicio;
    if (r.stop_reason === 'refusal') return { json: null, modelo: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, latenciaMs, recusa: r.stop_details?.category ?? 'refusal' };
    const texto = r.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = ((): unknown => { try { return JSON.parse(texto); } catch { return null; } })();
    return { json: parsed, modelo: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, latenciaMs, truncada: r.stop_reason === 'max_tokens' };
  };
  return {
    gerar: (u, o) => chamar(modelo, COMMUNICATION_LLM_PROMPT_V1, u, SCHEMA_SAIDA_LLM as unknown as Record<string, unknown>, MAX_TOKENS_GERACAO, o),
    julgar: (u, o) => chamar(modeloJuiz, PROMPT_JUIZ_V1, u, SCHEMA_JUIZ as unknown as Record<string, unknown>, MAX_TOKENS_JUIZ, o),
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const cfg = configuracaoLlm(process.env);
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);
  let body: unknown; try { body = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }
  try {
    const r = await tratarGeracaoComunicacao({ method: req.method, authorization: req.headers.get('authorization'), body }, {
      fetch, supabaseUrl, anon, llmDisponivel: !!chave, portas: (m, mj) => portasAnthropic(chave, cfg, m, mj), modelo: cfg.modelo, modeloJuiz: cfg.modeloJuiz,
      cidadeRemetente: (process.env.EIFF_REMETENTE_CIDADE ?? 'Goiânia').trim(),
      deadlineMs: cfg.deadlineMs, timeoutChamadaMs: cfg.timeoutChamadaMs,
      log: (t) => console.log('[communication_timing]', JSON.stringify(t)), // so numeros, modelos, etapa e outcome
    });
    return json(r.corpo, r.status);
  } catch (e) {
    // nunca a chave, nunca o corpo: so a classe do erro
    if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof ErroTimeoutLlm) { console.error('[comunicacao] llm_timeout'); return json({ erro: 'llm_timeout', etapa: null, mensagem: 'A geração excedeu o orçamento de tempo. Tente novamente.' }, 503); }
    const msg = e instanceof Anthropic.APIError ? `anthropic ${e.status ?? ''}` : 'falha interna';
    console.error('[comunicacao]', msg);
    return json({ erro: 'ia_indisponivel', mensagem: msg }, 502);
  }
};

export const config = { path: '/api/comunicacao' };
