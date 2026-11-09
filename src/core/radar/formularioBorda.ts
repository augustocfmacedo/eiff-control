/**
 * A borda HTTP do formulário, testável: recebe o pedido e as dependências, e
 * devolve a resposta.
 *
 * Mesmo desenho de `comunicacaoServidor.ts`, `widgetServidor.ts` e
 * `usuariosServidor.ts`: a função Netlify é um invólucro de dez linhas e TODA
 * a decisão mora aqui, onde o teste alcança sem rede e sem variável de ambiente:
 * o ambiente chega por `env`, injetado.
 *
 * `env` e `fetch` são injetados. Nenhum segredo nasce aqui e nenhum sai: o
 * que vai para log é identificador, impressão e resultado.
 */
import { autorizar, validarCorpo } from './formularioServidor'
import { corpoDaSubmissaoNetlify } from './formularioTransporte'
import { ErroDeGravacao, gravarSubmissao } from './formularioGravacao'
import { montarPortasIntegracao, type AmbienteFormulario } from './formularioPorta'
import { FORMULARIOS } from './formularioSite'
import type { AmbienteAtivacao } from '../inbox/ativacao'

export interface AmbienteBorda extends AmbienteFormulario, AmbienteAtivacao {
  EIFF_FORM_SECRET?: string
}

export interface DepsBorda {
  env: AmbienteBorda
  fetch: typeof fetch
  log?(t: Record<string, unknown>): void
}

export interface RespostaBorda {
  status: number
  corpo: Record<string, unknown>
}

/** Só os formulários que o Radar conhece entram no CRM: o catálogo é um só. */
export const FORMULARIOS_ACEITOS = FORMULARIOS

export async function tratarPedidoFormulario(req: Request, deps: DepsBorda): Promise<RespostaBorda> {
  const log = (t: Record<string, unknown>) => deps.log?.(t)
  if (req.method !== 'POST') return { status: 405, corpo: { erro: 'metodo_nao_suportado' } }

  const cabecalhos: Record<string, string | undefined> = {}
  req.headers.forEach((v, k) => { cabecalhos[k.toLowerCase()] = v })

  const auth = autorizar(cabecalhos, deps.env.EIFF_FORM_SECRET)
  if (!auth.ok) {
    // 401 nos dois casos: quem chama não precisa saber se o segredo existe no servidor.
    log({ resultado: 'recusado', motivo: auth.motivo })
    return { status: 401, corpo: { erro: 'nao_autorizado' } }
  }

  let bruto: unknown
  try { bruto = await req.json() } catch { return { status: 400, corpo: { erro: 'corpo_invalido' } } }

  const traduzido = corpoDaSubmissaoNetlify(bruto, { formulariosAceitos: FORMULARIOS_ACEITOS })
  if (!traduzido.ok) {
    // Submissão que não vira lead (spam, honeypot, formulário de outra coisa) é IGNORADA com 200:
    // devolver erro faria o remetente insistir num caso que nunca vai mudar.
    log({ resultado: 'ignorada', motivo: traduzido.motivo })
    return { status: 200, corpo: { resultado: 'IGNORADA', motivo: traduzido.motivo } }
  }

  const corpo = validarCorpo(traduzido.corpo)
  if (!corpo.ok) {
    log({ resultado: 'invalido', motivo: corpo.motivo, campo: corpo.detalhe ?? null })
    return { status: 400, corpo: { erro: corpo.motivo, campo: corpo.detalhe ?? null } }
  }

  // Ligação com o banco: a mesma configuração do Inbox (organização + chave de serviço) mais a fonte WEBSITE.
  // A conversa continua sendo gravada pela porta do Inbox (RPC inbox_ingest) e roteada pelo Octopus Router —
  // os mesmos que a EIFF Central usa, com os mesmos kill switches. Sem segundo mecanismo. É a MESMA montagem
  // que a reconciliação agendada usa: um caminho de entrada não pode divergir do outro.
  const ligacao = montarPortasIntegracao(deps.env, { fetch: deps.fetch, log: deps.log })
  if (!ligacao.ok) {
    log({ resultado: 'nao_configurada', motivo: ligacao.motivo })
    return { status: 503, corpo: { erro: 'integracao_nao_configurada', motivo: ligacao.motivo } }
  }
  const { cfg, portas } = ligacao

  try {
    const r = await gravarSubmissao(corpo.submissao, cfg.fonteId, cfg.organizacaoId, portas)
    log({
      resultado: r.resultado, externoId: r.externoId, impressao: r.payloadFingerprint.slice(0, 16),
      passos: r.passos, registro: r.registroFonteId, thread: r.threadId ?? null,
      contato: r.contatoId ?? null, completado: r.contatoCompletado?.campos ?? [], roteada: r.roteada?.aplicado ?? null,
    })
    return {
      status: 200,
      corpo: {
        resultado: r.resultado, externoId: r.externoId, passos: r.passos,
        registroFonteId: r.registroFonteId, threadId: r.threadId ?? null, novaConversa: r.novaConversa,
      },
    }
  } catch (e) {
    // Gravação exigida que não foi confirmada: 5xx, nada de sucesso. Quem chamou reenvia e o plano COMPLETA
    // o que faltou — e, se ninguém reenviar, o reconciliador traz a submissão de volta sem duplicar.
    const etapa = e instanceof ErroDeGravacao ? e.etapa : 'desconhecida'
    log({ resultado: 'falhou', etapa, motivo: (e as Error).message ?? 'erro' })
    return { status: 502, corpo: { erro: 'gravacao_falhou', etapa } }
  }
}
