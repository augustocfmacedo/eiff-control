// FINANCE_AGENT da EIFF Central: ADAPTER sobre o Diretor Financeiro que ja existe (src/core/cfo.ts).
// Nenhuma regra financeira e reescrita aqui: a leitura do texto e `interpretarPedido`, o parecer e `analisarPagamento`,
// a resposta e `responderDF` e a unica escrita possivel e `actions.registrarPrevisaoDF` (rascunho, com permissao e auditoria).
// Este modulo e DETERMINISTICO: nao chama LLM, nao faz rede e nao decide nada por conta propria.
//
// Fronteiras que este arquivo carrega:
// - propor != executar: `proposeAction` so descreve o pedido; `execute` exige identidade VERIFIED, usuario ativo e permissao;
// - dois lados: quem nao tem `ver_bancos` NUNCA recebe saldo, reserva, vencimentos nem parecer (`responderDF(..., veCaixa)`);
// - o texto que chega do WhatsApp e DADO, nunca instrucao: a interpretacao e regex deterministica, sem prompt;
// - "hoje" e a data-base do sistema (`catalogoDe`), como no Diretor Financeiro; `ctx.agoraIso` nao substitui a data-base do motor.
import type { Dataset, Lancamento, Usuario } from '../types';
import {
  analisarPagamento, catalogoDe, completarPedido, interpretarPedido, montarPrevisao, responderDF,
  type Parecer, type PedidoInterpretado, type PrevisaoDF,
} from '../cfo';
import { RegraDeNegocioError, actions, getState, pode, type Acao } from '../../data/store';
import {
  definicaoDaAcao,
  type AcaoProposta, type CodigoAgente, type ContextoAgente, type EnterpriseAgent, type InternalIntent,
  type LeituraAgente, type ResultadoAcao,
} from './tipos';

export const CODIGO_FINANCE: CodigoAgente = 'FINANCE_AGENT';
export const INTENCAO_FINANCE: InternalIntent = 'FINANCE';
/** Unica acao que este agente sabe propor: registrar a PREVISAO em rascunho para a Diretoria decidir na Central do CFO. */
export const ACAO_REGISTRAR_PREVISAO = 'FINANCE_REGISTRAR_PREVISAO';
/**
 * A permissao vem da ACAO, no catalogo congelado — nunca da intencao FINANCE, que cobre desde consultar o caixa
 * (`ver_bancos`) ate liquidar (`liquidar`). Registrar previsao e escrita de rascunho: `editar_lancamento`.
 */
export const PERMISSAO_FINANCEIRA = definicaoDaAcao(ACAO_REGISTRAR_PREVISAO)!.permissao as Acao;

// ---------------------------------------------------------------------------
// Portas (o que vem de fora: dataset, usuario da identidade e a escrita no store)
// ---------------------------------------------------------------------------
/**
 * `pode` NAO e porta de proposito: a permissao vem sempre da matriz unica do Control (`src/data/store.ts`),
 * para que nenhuma implementacao de teste ou de servidor consiga conceder o que a matriz nega.
 */
export interface PortasFinanceiro {
  /** Dataset vivo do sistema (o mesmo que a tela do Diretor Financeiro le). */
  dataset(): Dataset;
  /** Usuario do EIFF Control por tras da identidade de WhatsApp. Sem usuario, nada avanca. */
  usuarioDe(ctx: ContextoAgente): Usuario | undefined;
  /** Escrita: chama `actions.registrarPrevisaoDF` como o usuario identificado. Nunca escreve direto no dataset. */
  registrarPrevisao(previsao: PrevisaoDF, usuario: Usuario): Lancamento;
}

/**
 * Portas padrao, ligadas ao store do app. `registrarPrevisao` e fail-closed: se a sessao do store nao for a mesma
 * pessoa identificada no WhatsApp, recusa — a previsao nunca e registrada em nome de outro usuario.
 */
export function portasDoStore(): PortasFinanceiro {
  return {
    dataset: () => getState().ds,
    usuarioDe: (ctx) => {
      const id = ctx.identidade.identidade?.usuarioId;
      return id ? getState().ds.usuarios.find((u) => u.id === id) : undefined;
    },
    registrarPrevisao: (previsao, usuario) => {
      const sessao = getState().usuario;
      if (sessao.id !== usuario.id) {
        throw new RegraDeNegocioError('A sessão do sistema não é a mesma pessoa identificada no WhatsApp: a previsão não foi registrada.');
      }
      return actions.registrarPrevisaoDF(previsao);
    },
  };
}

// ---------------------------------------------------------------------------
// Leitura <-> pedido do Diretor Financeiro (o contrato so carrega campos simples)
// ---------------------------------------------------------------------------
const INTENCOES: PedidoInterpretado['intencao'][] = ['pagamento', 'consulta_caixa', 'vencimentos', 'previsoes', 'ajuda', 'outro'];
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Campos da leitura a partir do pedido interpretado (nunca telefone, nunca dado de caixa). */
export function leituraDoPedido(pedido: PedidoInterpretado): LeituraAgente {
  const partes = [
    pedido.valor !== undefined ? `R$ ${pedido.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    pedido.vencimento ? `para ${pedido.vencimento.slice(8, 10)}/${pedido.vencimento.slice(5, 7)}` : null,
    pedido.categoria ?? null,
    pedido.codigoObra ? `obra ${pedido.codigoObra}` : null,
    pedido.contraparte ? `fornecedor ${pedido.contraparte}` : null,
  ].filter(Boolean);
  const resumo = pedido.intencao === 'pagamento'
    ? `Pagamento: ${partes.join(' · ') || pedido.descricao}`
    : `${pedido.intencao === 'consulta_caixa' ? 'Consulta de caixa' : pedido.intencao === 'vencimentos' ? 'Consulta de vencimentos' : pedido.intencao === 'previsoes' ? 'Andamento dos pedidos' : pedido.intencao === 'ajuda' ? 'Ajuda' : 'Não é um pedido de pagamento'}: ${pedido.descricao}`;
  return {
    resumo,
    campos: {
      intencao: pedido.intencao, valor: pedido.valor, vencimento: pedido.vencimento, categoria: pedido.categoria,
      codigoObra: pedido.codigoObra, contraparte: pedido.contraparte, descricao: pedido.descricao, origem: pedido.origem,
    },
    faltando: [...pedido.faltando],
  };
}

/** Volta da leitura para o pedido do Diretor Financeiro. `faltando` e sempre recalculado: campo adulterado nao vira proposta. */
export function pedidoDaLeitura(leitura: LeituraAgente): PedidoInterpretado {
  const c = leitura.campos;
  const intencaoLida = texto(c.intencao) as PedidoInterpretado['intencao'] | undefined;
  const intencao = intencaoLida && INTENCOES.includes(intencaoLida) ? intencaoLida : 'outro';
  const valor = numero(c.valor);
  const vencimento = texto(c.vencimento);
  const faltando: PedidoInterpretado['faltando'] = [];
  if (intencao === 'pagamento') { if (!valor) faltando.push('valor'); if (!vencimento) faltando.push('vencimento'); }
  return {
    intencao, valor, vencimento, categoria: texto(c.categoria), codigoObra: texto(c.codigoObra), contraparte: texto(c.contraparte),
    descricao: texto(c.descricao) ?? '', faltando, origem: texto(c.origem) === 'ia' ? 'ia' : 'local',
  };
}

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------
export interface RespostaFinanceira {
  /** Texto conversacional a devolver — SEMPRE de `responderDF`, respeitando os dois lados. */
  texto: string;
  leitura: LeituraAgente;
  proposta?: AcaoProposta;
  sugestoes?: string[];
  /** Se a pessoa enxerga caixa (`ver_bancos`). Falso = equipe: nenhum numero de caixa sai daqui. */
  veCaixa: boolean;
  /** Por que nao ha proposta, quando o pedido esta completo mas a pessoa nao pode registra-lo. */
  impedimento?: string;
}

export interface AgenteFinanceiro extends EnterpriseAgent {
  code: 'FINANCE_AGENT';
  /** Fluxo completo: texto → interpretar → CFO → proposta → resposta conversacional. */
  responder(ctx: ContextoAgente): Promise<RespostaFinanceira>;
}

const chaveConversa = (ctx: ContextoAgente) => `${ctx.contexto}:${ctx.identidade.identidade?.id ?? 'desconhecida'}`;
const primeiroNome = (u: Usuario) => u.nome.split(' ')[0];
/** Data que a proposta leva: a Diretoria ja ve a sugestao do parecer; a equipe ve a data que pediu. */
const dataDaProposta = (p: Parecer, veCaixa: boolean) => (veCaixa ? p.dataSugerida ?? p.vencimento : p.vencimento);

/**
 * Cria o agente financeiro. A memoria de conversa (pedido que ficou incompleto) e por instancia, nunca global:
 * cada Central tem a sua e um pedido pela metade nunca vaza para outra conversa.
 */
export function criarAgenteFinanceiro(portas: PortasFinanceiro = portasDoStore()): AgenteFinanceiro {
  const pendentes = new Map<string, PedidoInterpretado>();

  const interpretar = (ctx: ContextoAgente): PedidoInterpretado => {
    const catalogo = catalogoDe(portas.dataset());
    const lido = interpretarPedido(ctx.texto, catalogo);
    const anterior = pendentes.get(chaveConversa(ctx));
    if (!anterior) return lido;
    // complemento ("500 reais", "sexta") junta-se ao pedido que ficou incompleto; pedido novo e completo segue sozinho
    const complementa = (lido.intencao === 'pagamento' || lido.intencao === 'outro')
      && (lido.valor !== undefined || !!lido.vencimento) && (lido.intencao === 'outro' || lido.faltando.length > 0);
    return complementa ? completarPedido(anterior, lido) : lido;
  };

  const agente: AgenteFinanceiro = {
    code: 'FINANCE_AGENT',

    canHandle(intent: InternalIntent, ctx: ContextoAgente): boolean {
      return intent === INTENCAO_FINANCE && !!ctx.texto.trim();
    },

    async interpret(ctx: ContextoAgente): Promise<LeituraAgente> {
      const pedido = interpretar(ctx);
      const chave = chaveConversa(ctx);
      // pedido incompleto fica guardado para a proxima mensagem completar; qualquer outra coisa limpa a pendencia
      if (pedido.intencao === 'pagamento' && pedido.faltando.length) pendentes.set(chave, pedido);
      else pendentes.delete(chave);
      return leituraDoPedido(pedido);
    },

    /**
     * Descreve a acao possivel. Pedido incompleto NAO vira proposta (vira pergunta), consulta nao vira proposta,
     * e nada aqui executa. Os parametros carregam so o pedido — nenhum numero de caixa, reserva ou parecer:
     * o parecer e recalculado no `execute`, contra o dataset do momento.
     */
    async proposeAction(leitura: LeituraAgente, ctx: ContextoAgente): Promise<AcaoProposta | undefined> {
      const pedido = pedidoDaLeitura(leitura);
      if (pedido.intencao !== 'pagamento' || pedido.faltando.length || pedido.valor === undefined) return undefined;
      const usuario = portas.usuarioDe(ctx);
      if (!usuario || !usuario.ativo) return undefined;
      if (!pode(usuario, PERMISSAO_FINANCEIRA, pedido.codigoObra)) return undefined;
      const ds = portas.dataset();
      const parecer = analisarPagamento(ds, { valor: pedido.valor, vencimento: pedido.vencimento, codigoObra: pedido.codigoObra, categoria: pedido.categoria });
      const previsao = montarPrevisao(ds, pedido, parecer, dataDaProposta(parecer, pode(usuario, 'ver_bancos')));
      const quando = `${previsao.vencimento.slice(8, 10)}/${previsao.vencimento.slice(5, 7)}`;
      const quanto = `R$ ${previsao.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return {
        codigo: ACAO_REGISTRAR_PREVISAO,
        titulo: `Registrar previsão de ${quanto} para ${quando}`,
        // sem saldo, reserva ou parecer: so o que a propria pessoa pediu
        descricao: `Cria um lançamento em Rascunho (origem Diretor Financeiro) de ${quanto} em ${quando}, categoria ${previsao.categoria}${previsao.codigoObra ? `, obra ${previsao.codigoObra}` : ''}, fornecedor ${previsao.contraparte}. Não entra no caixa oficial nem abre alçada: a Diretoria decide na Central do Diretor Financeiro.`,
        permissao: PERMISSAO_FINANCEIRA,
        escopoObra: previsao.codigoObra || undefined,
        exigeConfirmacao: true,
        reversivel: true, // rascunho: a Diretoria pode reagendar ou recusar (cancelamento com motivo), nada e apagado
        parametros: {
          valor: previsao.valor, vencimento: previsao.vencimento, categoria: previsao.categoria,
          codigoObra: previsao.codigoObra ?? '', contraparte: previsao.contraparte, descricao: previsao.descricao,
        },
      };
    },

    /**
     * Executa a acao JA confirmada. Unica escrita do agente, e ainda assim so um RASCUNHO pelo store
     * (`registrarPrevisaoDF` exige `editar_lancamento` e audita). Nenhum pagamento, nenhuma aprovacao, nenhuma
     * decisao: `decidirPrevisaoDF` continua sendo da Diretoria, na Central do CFO.
     */
    async execute(acao: AcaoProposta, ctx: ContextoAgente): Promise<ResultadoAcao> {
      if (acao.codigo !== ACAO_REGISTRAR_PREVISAO) return { ok: false, mensagem: 'Ação desconhecida para o agente financeiro.' };
      if (!ctx.identidade.verificada) return { ok: false, mensagem: `Número não verificado (${ctx.identidade.motivo}): nada foi registrado.` };
      const usuario = portas.usuarioDe(ctx);
      if (!usuario) return { ok: false, mensagem: 'Identidade sem usuário do EIFF Control: nada foi registrado.' };
      if (!usuario.ativo) return { ok: false, mensagem: 'Usuário inativo: nada foi registrado.' };
      const p = acao.parametros as Record<string, unknown>;
      const valor = numero(p.valor);
      const vencimento = texto(p.vencimento);
      const codigoObra = texto(p.codigoObra);
      if (!valor || !vencimento) return { ok: false, mensagem: 'Pedido incompleto (valor e data são obrigatórios): nada foi registrado.' };
      if (!pode(usuario, PERMISSAO_FINANCEIRA, codigoObra)) {
        return { ok: false, mensagem: `Perfil ${usuario.papel} não pode registrar previsão de pagamento${codigoObra ? ` na obra ${codigoObra}` : ''}.` };
      }
      const ds = portas.dataset();
      const pedido: PedidoInterpretado = {
        intencao: 'pagamento', valor, vencimento, categoria: texto(p.categoria), codigoObra,
        contraparte: texto(p.contraparte), descricao: texto(p.descricao) ?? '', faltando: [], origem: 'local',
      };
      // Server Truth: o parecer que acompanha a previsao e recalculado agora, contra o caixa do momento.
      const parecer = analisarPagamento(ds, { valor, vencimento, codigoObra, categoria: pedido.categoria });
      const previsao = montarPrevisao(ds, pedido, parecer, vencimento);
      try {
        const l = portas.registrarPrevisao(previsao, usuario);
        const quanto = `R$ ${l.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const quando = `${l.vencimento.slice(8, 10)}/${l.vencimento.slice(5, 7)}`;
        return {
          ok: true,
          mensagem: pode(usuario, 'ver_bancos')
            ? `Previsão ${l.id} registrada: ${quanto} em ${quando}. Entra na Central do Diretor Financeiro para decisão.`
            : `Pedido ${l.id} encaminhado à Diretoria: ${quanto} para ${quando}. Te aviso quando for decidido.`,
          referencia: l.id,
        };
      } catch (e) {
        return { ok: false, mensagem: e instanceof Error ? e.message : 'Não foi possível registrar a previsão.' };
      }
    },

    async responder(ctx: ContextoAgente): Promise<RespostaFinanceira> {
      const usuario = portas.usuarioDe(ctx);
      const leitura = await agente.interpret(ctx);
      if (!usuario || !usuario.ativo) {
        return { texto: 'Não consegui identificar quem está falando no EIFF Control, então não posso responder por aqui. Fale com o Financeiro para vincular seu número.', leitura, veCaixa: false };
      }
      const veCaixa = pode(usuario, 'ver_bancos');
      const pedido = pedidoDaLeitura(leitura);
      // toda a redacao vem do Diretor Financeiro: e ele quem sabe o que cada lado pode ler
      const r = responderDF(portas.dataset(), usuario, pedido, veCaixa);
      const proposta = await agente.proposeAction(leitura, ctx);
      const completo = pedido.intencao === 'pagamento' && !pedido.faltando.length;
      const impedimento = completo && !proposta
        ? `${primeiroNome(usuario)}, no seu perfil (${usuario.papel}) eu não posso registrar o pedido${pedido.codigoObra ? ` na obra ${pedido.codigoObra}` : ''}. Peça ao Financeiro para registrar.`
        : undefined;
      return { texto: impedimento ? `${r.texto}\n${impedimento}` : r.texto, leitura, proposta, sugestoes: r.sugestoes, veCaixa, impedimento };
    },
  };
  return agente;
}

/** Instancia padrao, ligada ao store do app. */
export const agenteFinanceiro = criarAgenteFinanceiro();
