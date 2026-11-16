// Adaptador SUPABASE das solicitações de projeto (E11.2C). Implementa RepositorioPedidosAsync falando SÓ com as funções
// do banco (docs/propostas/pedido-projeto.proposta.sql): pp_criar, pp_transicionar, pp_listar, pp_obter, pp_eventos,
// pp_arquivos, pp_doc_preparar, pp_doc_registrar, pp_doc_remover. Nenhuma escrita em tabela, nenhum diff genérico do
// Dataset: o banco confere papel, fila técnica, versão, intenção e vínculos e grava solicitação + histórico na mesma
// transação. Este módulo não decide permissão nenhuma; só traduz.
//
// DESLIGADO até a homologação: nada no app o instancia hoje (src/data/pedidosProjeto.ts continua devolvendo a memória
// no modo local e "persistência pendente" no remoto). A prova é src/data/pedidosProjeto.supabase.integracao.test.ts,
// contra PostgreSQL descartável com a fila inteira de migrations + as propostas.
import { ErroPedido, type ACOES_PEDIDO, type CodigoErroPedido, type DadosAcao, type EntradaPedido, type EventoPedido } from '../core/comercial/pedidoProjeto'
import type { ArquivoPedido, ArquivoParaEnviar, PedidoLido, RepositorioPedidosAsync } from '../core/comercial/pedidosRepositorio'

export const BUCKET_PROJETOS = 'projetos-tecnicos'

/** O mínimo do cliente do Supabase de que o adaptador precisa (o supabase-js real cumpre; o teste usa um falso sobre PGlite). */
export interface ClientePedidos {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
  enviarArquivo(bucket: string, caminho: string, conteudo: Blob | Uint8Array, mime: string): PromiseLike<{ error: { message: string } | null }>
}

const CODIGOS: readonly CodigoErroPedido[] = ['SEM_PERMISSAO', 'TRANSICAO_INVALIDA', 'MOTIVO_OBRIGATORIO', 'DADOS_INCOMPLETOS', 'VERSAO_DESATUALIZADA', 'ENSAIO', 'VINCULO_INVALIDO', 'DUPLICADA', 'ESTADO_FINAL']

/**
 * Erro do banco → ErroPedido. As regras saem como 'PP:<CODIGO>: mensagem'; violações de índice único da solicitação
 * aberta viram DUPLICADA; permissão negada do PostgreSQL vira SEM_PERMISSAO. O resto sobe como está (erro técnico).
 */
export function traduzirErro(e: { message: string; code?: string }): Error {
  const m = /PP:([A-Z_]+):\s*(.*)$/s.exec(e.message)
  if (m && (CODIGOS as readonly string[]).includes(m[1])) return new ErroPedido(m[1] as CodigoErroPedido, m[2].trim())
  if (e.code === '23505' && /project_request_aberta_uk/.test(e.message)) return new ErroPedido('DUPLICADA', 'Já existe solicitação aberta deste tipo para esta oportunidade.')
  if (e.code === '42501' || /permission denied/i.test(e.message)) return new ErroPedido('SEM_PERMISSAO', 'Sem permissão.')
  return new Error(e.message)
}

export function repositorioSupabase(c: ClientePedidos): RepositorioPedidosAsync {
  const chamar = async <T>(nome: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await c.rpc(nome, args)
    if (error) throw traduzirErro(error)
    return data as T
  }
  return {
    adaptador: 'supabase',
    listar: () => chamar<PedidoLido[]>('pp_listar', {}).then((x) => x ?? []),
    obter: (id) => chamar<PedidoLido | null>('pp_obter', { p_id: id }).then((x) => x ?? undefined),
    eventos: (id) => chamar<EventoPedido[]>('pp_eventos', { p_id: id }).then((x) => x ?? []),
    async criar(e: EntradaPedido, intencao: string) {
      try { return await chamar<PedidoLido>('pp_criar', { p: e, p_intencao: intencao }) }
      catch (x) {
        // corrida de duas criações com a MESMA intenção: a perdedora esbarra no índice único da intenção; a segunda
        // tentativa devolve a solicitação que a vencedora gravou (o banco a encontra pela intenção)
        if (x instanceof Error && /project_request_event_intencao_uk/.test(x.message)) return chamar<PedidoLido>('pp_criar', { p: e, p_intencao: intencao })
        throw x
      }
    },
    agir: (id: string, acao: (typeof ACOES_PEDIDO)[number], d: DadosAcao, intencao: string) => {
      const { versao, ...dados } = d
      return chamar<PedidoLido>('pp_transicionar', { p_id: id, p_acao: acao, p_dados: dados, p_versao: versao, p_intencao: intencao })
    },
    arquivos: (id) => chamar<ArquivoPedido[]>('pp_arquivos', { p_id: id }).then((x) => x ?? []),
    // três passos, como os anexos financeiros (0073): o banco dá a pasta, o arquivo sobe, o banco registra a VERSÃO.
    // Se o envio falhar, nada é registrado; se o registro falhar, o objeto órfão não aparece em lugar nenhum.
    async anexar(id: string, tipo: string, a: ArquivoParaEnviar, intencao: string) {
      const caminho = await chamar<string>('pp_doc_preparar', { p_id: id, p_tipo: tipo, p_extensao: a.extensao.toLowerCase() })
      const { error } = await c.enviarArquivo(BUCKET_PROJETOS, caminho, a.conteudo, a.mime)
      if (error) throw traduzirErro(error)
      return chamar<{ id: string; versao: number; caminho: string }>('pp_doc_registrar', { p_id: id, p_tipo: tipo, p_caminho: caminho, p_nome: a.nome, p_mime: a.mime, p_tamanho: a.tamanho, p_intencao: intencao })
    },
    removerArquivo: (arquivoId, motivo, intencao) => chamar<void>('pp_doc_remover', { p_arquivo: arquivoId, p_motivo: motivo, p_intencao: intencao }),
  }
}
