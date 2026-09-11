// EIFF Central — Alpha interno: o caminho CONTINUO, pela primeira vez ligado de ponta a ponta.
//
//   notificacao da Meta -> normalizarEventosMeta -> contexto INTERNAL (pelo NUMERO que recebeu)
//   -> conversa idempotente -> resolverUsuarioDaCentral (identidade VERIFIED -> usuario real do Dataset
//   -> organizacao -> ativo -> papel) -> orquestrar (intencao + confianca + agente)
//   -> FINANCE_AGENT (interpret -> proposeAction) sobre o Diretor Financeiro -> RESPOSTA pronta.
//
// Este arquivo COSTURA modulos que ja existem e sao testados; nao reescreve nenhuma regra. Nada aqui:
// - grava (as portas do agente sao `portasSemEscrita`: registrar previsao RECUSA com ExecucaoBloqueadaError);
// - envia (a resposta e GERADA; quem envia e a fase de canal, que continua desligada);
// - persiste payload bruto (o texto da mensagem vive so na chamada e nunca volta em log ou em estado);
// - inventa memoria entre requisicoes (pedido incompleto vira PERGUNTA, e a pergunta e devolvida — a Central e
//   serverless e a retencao de conversa ainda nao foi decidida; ver docs/eiff-central.md);
// - loga (nenhum console, nenhum telefone em claro: toda saida passa por `mascararTelefone`).
//
// Duas regras que a costura precisa respeitar e que estao provadas em `fluxoInterno.test.ts`:
// 1) a PERMISSAO vem da ACAO PROPOSTA (CATALOGO_ACOES + autorizarAcao), nunca da intencao;
// 2) os DOIS LADOS do Diretor Financeiro: quem nao tem `ver_bancos` nunca recebe saldo, reserva, vencimentos
//    nem parecer — e `veCaixa` sai de `veCaixaNaCentral(usuario)`, que consulta a matriz do Control.
//
// E a regra que vale para tudo: o texto que chega do WhatsApp e DADO, nunca instrucao.
import type { Acao } from '../../data/store';
import type { Dataset } from '../types';
import { mascararTelefone, type CommunicationContext } from '../radar/canais';
import { aplicarEventos, estadoVazio, type CentralConversation, type CentralMessage, type EstadoCentral } from './conversa';
import { normalizarEventosMeta, type NumerosCentral } from './metaEventos';
import {
  MENSAGEM_EXECUCAO_BLOQUEADA, portasSemEscrita, resolverUsuarioDaCentral, veCaixaNaCentral,
  type ContextoServidor, type UsuarioDaCentral,
} from './autoridade';
import { orquestrar } from './orquestrador';
import { autorizar, type Autorizacao } from './permissoes';
import { criarAgenteFinanceiro, type RespostaFinanceira } from './agenteFinanceiro';
import {
  definicaoDaAcao,
  type AcaoProposta, type CodigoAgente, type ContextoAgente, type DefinicaoAcao, type InternalIntent,
  type LeituraAgente, type OrchestratorDecision, type WhatsappIdentity,
} from './tipos';

// ---------------------------------------------------------------------------
// 1) Texto da mensagem: lido do payload, higienizado, NUNCA guardado
// ---------------------------------------------------------------------------
/** Teto de tamanho do texto considerado. Mensagem maior e cortada: nada de prompt gigante viajando pelo fluxo. */
export const LIMITE_TEXTO = 1000;

type Linha = Record<string, unknown>;
const linhas = (v: unknown): Linha[] => (Array.isArray(v) ? v.filter((x): x is Linha => !!x && typeof x === 'object') : []);
const objeto = (v: unknown): Linha => (v && typeof v === 'object' ? (v as Linha) : {});
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Limpa o texto sem alterar o que a pessoa disse: tira caracteres de controle (que servem para esconder
 * instrucao) e colapsa espaco. A defesa contra tentativa de instrucao NAO e esta: e `higienizarTexto` do
 * orquestrador, que remove o trecho antes de pontuar e manda a mensagem para revisao humana.
 */
export function limparTexto(bruto: string | undefined): string | undefined {
  if (!bruto) return undefined;
  const limpo = bruto.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, LIMITE_TEXTO) : undefined;
}

/**
 * Corpo das mensagens de texto do payload, por `externalMessageId`. O normalizador de eventos NAO carrega
 * conteudo de proposito (o modelo de conversa so guarda metadado), entao o conteudo e lido aqui, em transito,
 * e morre no fim da chamada: nao entra em `EstadoCentral`, nao entra no retorno e nao entra em log.
 * So tipo texto e resposta de botao/lista; audio, imagem e documento nao viram texto nenhum.
 */
export function textosDoPayload(payload: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  const p = objeto(payload);
  if (texto(p.object) !== 'whatsapp_business_account') return mapa;
  for (const entrada of linhas(p.entry)) {
    for (const mudanca of linhas(entrada.changes)) {
      if (texto(mudanca.field) !== 'messages') continue;
      for (const m of linhas(objeto(mudanca.value).messages)) {
        const id = texto(m.id);
        if (!id) continue;
        const interativa = objeto(m.interactive);
        const corpo = texto(objeto(m.text).body)
          ?? texto(objeto(m.button).text)
          ?? texto(objeto(interativa.button_reply).title)
          ?? texto(objeto(interativa.list_reply).title);
        const limpo = limparTexto(corpo);
        if (limpo) mapa.set(id, limpo);
      }
    }
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// 2) Contrato da resposta
// ---------------------------------------------------------------------------
export const SITUACOES_ATENDIMENTO = [
  'respondido', 'pergunta_pendente', 'proposta_aguardando_registro', 'sem_texto', 'contexto_externo',
  'identidade_recusada', 'revisao_humana', 'fora_de_escopo',
] as const;
export type SituacaoAtendimento = (typeof SITUACOES_ATENDIMENTO)[number];

/** Identidade como sai daqui: telefone SEMPRE mascarado, sem apelido do WhatsApp e sem codigo de verificacao. */
export interface IdentidadeNoFluxo { conhecida: boolean; verificada: boolean; motivo: string; identidadeId?: string; telefone: string }
/** Pessoa como sai daqui: papel da MATRIZ do Control e se ela enxerga caixa. Nunca vem do payload. */
export interface UsuarioNoFluxo { id: string; nome: string; papel: string; ativo: boolean; veCaixa: boolean }
/** A resposta e GERADA, nunca enviada: `enviada` e sempre false nesta fase. */
export interface RespostaCentral { texto: string; sugestoes?: string[]; enviada: false }

export interface AtendimentoInterno {
  mensagemId: string;
  externalMessageId: string;
  contexto: CommunicationContext;
  identidade: IdentidadeNoFluxo;
  usuario?: UsuarioNoFluxo;
  decisao: OrchestratorDecision;
  leitura?: LeituraAgente;
  /** Acao do CATALOGO que o caminho propoe. Proposta NAO e execucao. */
  proposta?: AcaoProposta;
  /** Veredicto da ponte de permissao sobre a PROPOSTA (nunca sobre a intencao). */
  autorizacao?: Autorizacao;
  resposta: RespostaCentral;
  /** Nesta fase, sempre false: a porta de escrita server-side ainda nao existe. */
  podeExecutar: false;
  motivo: string;
  situacao: SituacaoAtendimento;
  encaminharParaHumano: boolean;
}

export interface ResultadoFluxoInterno {
  /** Estado da conversa depois do lote. Quem guarda (ou nao) e o servidor; aqui so entra e sai. */
  estado: EstadoCentral;
  atendimentos: AtendimentoInterno[];
  /** So o motivo: o evento ignorado carrega telefone em claro e nao sai daqui. */
  ignorados: { motivo: string }[];
  duplicados: number;
}

export interface EntradaFluxoInterno {
  /** Notificacao da Meta JA validada pelo servidor (assinatura X-Hub-Signature-256 conferida antes de ler). */
  payload: unknown;
  servidor: {
    /** Dataset que o servidor carregou para a organizacao. */
    ds: Dataset;
    /** Organizacao validada pelo SERVIDOR. Identidade de outra organizacao nunca resolve. */
    organizationId: string;
    identidades: WhatsappIdentity[];
    /** Numeros da Central por contexto: e o numero que RECEBEU que define INTERNAL/EXTERNAL, nunca o texto. */
    numeros: NumerosCentral;
  };
  agoraIso: string;
  /** Estado anterior das conversas, quando o servidor tiver um. Sem ele, cada lote comeca do zero. */
  estado?: EstadoCentral;
}

// ---------------------------------------------------------------------------
// 3) Textos fixos (nenhum numero de negocio, nenhum dado de caixa)
// ---------------------------------------------------------------------------
export const TEXTO_SEM_TEXTO = 'Por aqui eu leio só mensagem de texto. Me escreva o que você precisa em uma frase.';
export const TEXTO_NAO_VERIFICADO = 'Não consigo confirmar quem está falando por este número, então não respondo nada por aqui. Peça ao Financeiro para vincular e verificar seu número no EIFF Control.';
export const TEXTO_USUARIO_INATIVO = 'Seu acesso ao EIFF Control está inativo. Fale com o Financeiro para reativar; nada foi consultado nem registrado.';
export const TEXTO_CONTEXTO_EXTERNO = 'Este número atende clientes e parceiros: assuntos internos da EIFF não são tratados por aqui. Uma pessoa da EIFF vai responder.';
export const TEXTO_REVISAO_HUMANA = 'Não tenho certeza do que você precisa, então vou passar para uma pessoa da EIFF. Nada foi consultado nem registrado.';
export const TEXTO_AJUDA = [
  'Sou a Central da EIFF no WhatsApp. Hoje eu atendo assunto financeiro: você me diz o que precisa pagar, quanto e para quando, e eu levo ao Diretor Financeiro.',
  '- Exemplo: "preciso pagar um frete de R$ 5.000 amanhã para a Transportadora X, obra Smart Fit".',
  'Nada é pago nem registrado por aqui.',
].join('\n');
/** A honestidade da fase: a Central le, avalia e PROPOE; registrar ainda nao. */
export const AVISO_SEM_REGISTRO = 'Ainda não registrei nada no sistema: o registro de pedidos pelo WhatsApp ainda não está liberado. Enquanto isso, o registro é no EIFF Control ou com o Financeiro.';

const ASSUNTO: Record<InternalIntent, string> = {
  FINANCE: 'financeiro', PURCHASE: 'compras', WORKSITE: 'obra', INVENTORY: 'estoque',
  COMMERCIAL: 'comercial', HR_ADMIN: 'equipe', EXECUTIVE: 'indicadores', GENERAL: 'geral',
};
const textoForaDeEscopo = (intent: InternalIntent): string =>
  `Por enquanto eu atendo só assunto financeiro por aqui. Seu pedido de ${ASSUNTO[intent]} vai para uma pessoa da EIFF.`;

// ---------------------------------------------------------------------------
// 4) Proposta a partir do catalogo (a ACAO escolhe a PERMISSAO)
// ---------------------------------------------------------------------------
/**
 * `AcaoProposta.permissao` e DECLARACAO, nunca autoridade: `autorizarAcao` confere contra o catalogo e, quando a
 * acao e de ajuda (`permissao: null`), ignora o campo declarado. O contrato congelado tipa o campo como `Acao`,
 * entao a conversao fica aqui, em uma linha — melhor do que inventar uma permissao que a acao nao exige.
 */
// sem cast: a proposta declara exatamente o que o catalogo diz, inclusive null (acao de ajuda)
const permissaoDeclarada = (def: DefinicaoAcao): Acao | null => def.permissao;

/** Monta a proposta de uma acao de LEITURA do catalogo. Nenhum parametro de negocio: a acao so le. */
export function propostaDeLeitura(codigo: string): AcaoProposta | undefined {
  const def = definicaoDaAcao(codigo);
  if (!def || !def.leitura) return undefined;
  return {
    codigo: def.codigo, titulo: def.titulo,
    descricao: `${def.titulo}. Somente leitura: nada é gravado, nada é pago.`,
    permissao: permissaoDeclarada(def), exigeConfirmacao: def.exigeConfirmacao, reversivel: true, parametros: {},
  };
}

/** Intencao lida pelo Diretor Financeiro -> acao de leitura do catalogo. Pagamento nao entra: quem propoe e o agente. */
export const ACAO_POR_LEITURA: Record<string, string> = {
  consulta_caixa: 'FINANCE_CONSULTA_CAIXA',
  vencimentos: 'FINANCE_VENCIMENTOS',
  previsoes: 'FINANCE_MEUS_PEDIDOS',
};

// ---------------------------------------------------------------------------
// 5) O caminho
// ---------------------------------------------------------------------------
const identidadeNoFluxo = (quem: UsuarioDaCentral, telefone: string): IdentidadeNoFluxo => ({
  conhecida: quem.identidade.conhecida,
  verificada: quem.identidade.verificada,
  motivo: quem.identidade.motivo,
  identidadeId: quem.identidade.identidade?.id,
  telefone: mascararTelefone(telefone),
});
const usuarioNoFluxo = (quem: UsuarioDaCentral): UsuarioNoFluxo | undefined => (quem.usuario
  ? { id: quem.usuario.id, nome: quem.usuario.nome, papel: quem.usuario.papel, ativo: quem.usuario.ativo, veCaixa: veCaixaNaCentral(quem.usuario) }
  : undefined);

interface Encerramento {
  situacao: SituacaoAtendimento;
  texto: string;
  motivo: string;
  sugestoes?: string[];
  humano?: boolean;
  leitura?: LeituraAgente;
  proposta?: AcaoProposta;
  autorizacao?: Autorizacao;
}

/**
 * Atende UMA mensagem recebida. Cada chamada cria o proprio agente financeiro: a memoria de pedido incompleto
 * do agente e por instancia, e instancia nova a cada mensagem significa ZERO continuidade inventada — a pergunta
 * volta para a pessoa em vez de o sistema "lembrar" de algo que ninguem decidiu guardar.
 */
async function atender(
  entrada: EntradaFluxoInterno,
  conversa: CentralConversation,
  mensagem: CentralMessage,
  textoDaMensagem: string | undefined,
): Promise<AtendimentoInterno> {
  const servidor: ContextoServidor = {
    ds: entrada.servidor.ds,
    organizationId: entrada.servidor.organizationId,
    contexto: conversa.contexto,
    identidades: entrada.servidor.identidades,
    telefone: conversa.telefoneNormalizado,
  };
  const quem = resolverUsuarioDaCentral(servidor);
  // o texto entra no orquestrador como DADO: `higienizarTexto` tira a tentativa de instrucao antes de pontuar
  const decisao = orquestrar({ texto: textoDaMensagem ?? '', contexto: conversa.contexto, identidade: quem.identidade });

  const fechar = (e: Encerramento): AtendimentoInterno => ({
    mensagemId: mensagem.id,
    externalMessageId: mensagem.externalMessageId,
    contexto: conversa.contexto,
    identidade: identidadeNoFluxo(quem, conversa.telefoneNormalizado),
    usuario: usuarioNoFluxo(quem),
    decisao,
    leitura: e.leitura,
    proposta: e.proposta,
    autorizacao: e.autorizacao,
    resposta: { texto: e.texto, sugestoes: e.sugestoes, enviada: false },
    podeExecutar: false,
    motivo: e.motivo,
    situacao: e.situacao,
    encaminharParaHumano: e.humano ?? false,
  });

  // 1) sem texto legivel nao ha o que interpretar (audio, imagem, documento)
  if (!textoDaMensagem) {
    return fechar({ situacao: 'sem_texto', texto: TEXTO_SEM_TEXTO, motivo: 'mensagem sem texto legível', humano: true });
  }
  // 2) contexto: vem do NUMERO que recebeu. Fora do interno, nenhuma leitura de negocio acontece
  if (conversa.contexto !== 'INTERNAL') {
    return fechar({ situacao: 'contexto_externo', texto: TEXTO_CONTEXTO_EXTERNO, motivo: 'contexto EXTERNAL: assunto interno não é atendido por este número', humano: true });
  }
  // 3) quem esta falando: identidade VERIFIED -> usuario real do Dataset -> organizacao -> ativo
  if (!quem.ok) {
    const inativo = quem.recusa === 'usuario_inativo';
    return fechar({
      situacao: 'identidade_recusada', texto: inativo ? TEXTO_USUARIO_INATIVO : TEXTO_NAO_VERIFICADO,
      motivo: quem.motivo, humano: true,
    });
  }
  // 4) a propria decisao pediu humano (confianca baixa, tentativa de instruir o sistema)
  if (decisao.requiresHuman) {
    return fechar({ situacao: 'revisao_humana', texto: TEXTO_REVISAO_HUMANA, motivo: decisao.motivo, humano: true });
  }
  // 5) dominio: nesta fase so o FINANCE_AGENT existe de verdade
  if (decisao.intent === 'GENERAL') {
    const proposta = propostaDeLeitura('GENERAL_AJUDA');
    const autorizacao = proposta
      ? autorizar({ proposta, agente: 'GENERAL_AGENT', identidade: quem.identidade, usuario: quem.usuario, contexto: conversa.contexto, decisao })
      : undefined;
    return fechar({ situacao: 'respondido', texto: TEXTO_AJUDA, motivo: autorizacao?.motivo ?? 'ajuda, sem dado de negócio', proposta, autorizacao });
  }
  if (decisao.intent !== 'FINANCE') {
    return fechar({ situacao: 'fora_de_escopo', texto: textoForaDeEscopo(decisao.intent), motivo: `intenção ${decisao.intent} ainda não tem agente ligado`, humano: true });
  }

  // 6) FINANCE_AGENT sobre o Diretor Financeiro, com as portas SEM ESCRITA
  const agente = criarAgenteFinanceiro(portasSemEscrita(servidor));
  const ctxAgente: ContextoAgente = { contexto: conversa.contexto, identidade: quem.identidade, texto: textoDaMensagem, agoraIso: entrada.agoraIso };
  const r: RespostaFinanceira = await agente.responder(ctxAgente);

  // defesa em profundidade dos DOIS LADOS: se o lado do agente divergir da matriz, a resposta nao sai
  if (r.veCaixa !== veCaixaNaCentral(quem.usuario)) {
    return fechar({ situacao: 'revisao_humana', texto: TEXTO_REVISAO_HUMANA, motivo: 'divergência entre o lado do agente e a matriz de permissões: resposta retida', humano: true });
  }

  const codigoAgente: CodigoAgente = 'FINANCE_AGENT';
  const intencao = typeof r.leitura.campos.intencao === 'string' ? r.leitura.campos.intencao : 'outro';
  // pagamento completo: a PROPOSTA e do agente (FINANCE_REGISTRAR_PREVISAO, com a permissao do catalogo).
  // consulta: a proposta e a acao de LEITURA do catalogo — e e dela que sai a permissao, nunca da intencao.
  const proposta = r.proposta ?? propostaDeLeitura(ACAO_POR_LEITURA[intencao] ?? '');
  const autorizacao = proposta
    ? autorizar({ proposta, agente: codigoAgente, identidade: quem.identidade, usuario: quem.usuario, contexto: conversa.contexto, decisao })
    : undefined;

  const pendente = r.leitura.faltando.length > 0;
  const escrita = !!r.proposta;
  const situacao: SituacaoAtendimento = escrita ? 'proposta_aguardando_registro' : pendente ? 'pergunta_pendente' : 'respondido';
  const motivo = escrita
    ? MENSAGEM_EXECUCAO_BLOQUEADA
    : pendente
      ? 'pedido incompleto: a pergunta volta para a pessoa, sem memória entre mensagens'
      : autorizacao?.motivo ?? 'resposta de leitura do Diretor Financeiro';
  return fechar({
    situacao,
    // a redacao e SEMPRE do Diretor Financeiro: e ele quem sabe o que cada lado pode ler
    texto: escrita ? `${r.texto}\n${AVISO_SEM_REGISTRO}` : r.texto,
    sugestoes: r.sugestoes, motivo, leitura: r.leitura, proposta, autorizacao,
  });
}

/**
 * Caminho continuo da Central interna: payload da Meta -> resposta pronta. Funcao PURA no que importa — le o
 * Dataset e as identidades que o servidor entregou, devolve estado e respostas, e nao grava nem envia nada.
 * O servidor que chamar isto so precisa decidir "responder ou nao".
 */
export async function fluxoInterno(entrada: EntradaFluxoInterno): Promise<ResultadoFluxoInterno> {
  const eventos = normalizarEventosMeta(entrada.payload, { numeros: entrada.servidor.numeros, agoraIso: entrada.agoraIso });
  const aplicado = aplicarEventos(entrada.estado ?? estadoVazio(), eventos, {
    organizationId: entrada.servidor.organizationId, agoraIso: entrada.agoraIso,
  });
  // o conteudo e lido AGORA, em transito, e some no fim desta funcao: nao entra no estado nem no retorno cru
  const textos = textosDoPayload(entrada.payload);
  const porId = new Map(aplicado.estado.conversas.map((c) => [c.id, c]));
  const atendimentos: AtendimentoInterno[] = [];
  for (const mensagem of aplicado.paraAgente) {
    const conversa = porId.get(mensagem.conversaId);
    if (!conversa) continue; // defensivo: mensagem sempre nasce com conversa
    atendimentos.push(await atender(entrada, conversa, mensagem, textos.get(mensagem.externalMessageId)));
  }
  return {
    estado: aplicado.estado,
    atendimentos,
    ignorados: [...aplicado.ignorados, ...aplicado.foraDeOrdem].map((i) => ({ motivo: i.motivo })),
    duplicados: aplicado.duplicados.length,
  };
}
