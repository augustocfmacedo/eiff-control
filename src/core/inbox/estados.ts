// EIFF Inbox: maquina de estados da thread. PURO.
//
//   NOVA -> TRIADA -> ATRIBUIDA -> EM_ATENDIMENTO -> (AGUARDANDO_CONTATO | AGUARDANDO_INTERNO | AGUARDANDO_APROVACAO)
//        -> RESOLVIDA -> FECHADA;  RESOLVIDA/FECHADA -> EM_ATENDIMENTO (reabertura, sempre com motivo)
//
// Regras que a maquina carrega:
// - TRIADA = tem setor (classificada ou triada a mao), ainda sem pessoa; ATRIBUIDA = tem pessoa, ninguem respondeu;
//   EM_ATENDIMENTO = alguem da EIFF ja agiu. A distincao existe por causa do SLA de primeira resposta;
// - nenhum "aguardando" e alcancado sem responsavel: aguardar e uma decisao de quem atende;
// - RESOLVIDA exige responsavel (ou resolucao pela IA no nivel A); FECHADA e o unico estado terminal, e mesmo ele reabre;
// - mensagem nova do contato numa thread AGUARDANDO_CONTATO, RESOLVIDA ou FECHADA volta para EM_ATENDIMENTO;
// - QUEM pode mudar: Administrador/Diretoria (transversal), o responsavel, o gestor do setor da thread, e — so para
//   assumir ou triar uma thread sem responsavel — qualquer membro que a enxerga (`podeMudarStatus`).
import type { InboxThread, StatusThread, TipoEventoThread } from './tipos';

export const TRANSICOES_THREAD: Record<StatusThread, readonly StatusThread[]> = {
  NOVA: ['TRIADA', 'ATRIBUIDA', 'FECHADA'],
  TRIADA: ['ATRIBUIDA', 'EM_ATENDIMENTO', 'RESOLVIDA', 'FECHADA'],
  ATRIBUIDA: ['EM_ATENDIMENTO', 'AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA', 'TRIADA'],
  EM_ATENDIMENTO: ['AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA', 'TRIADA'],
  AGUARDANDO_CONTATO: ['EM_ATENDIMENTO', 'RESOLVIDA', 'FECHADA'],
  AGUARDANDO_INTERNO: ['EM_ATENDIMENTO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA'],
  AGUARDANDO_APROVACAO: ['EM_ATENDIMENTO', 'AGUARDANDO_INTERNO', 'RESOLVIDA', 'FECHADA'],
  RESOLVIDA: ['FECHADA', 'EM_ATENDIMENTO'],
  FECHADA: ['EM_ATENDIMENTO'],
};

export const NOME_STATUS: Record<StatusThread, string> = {
  NOVA: 'Nova', TRIADA: 'Triada', ATRIBUIDA: 'Atribuída', EM_ATENDIMENTO: 'Em atendimento', AGUARDANDO_CONTATO: 'Aguardando contato',
  AGUARDANDO_INTERNO: 'Aguardando EIFF', AGUARDANDO_APROVACAO: 'Aguardando aprovação', RESOLVIDA: 'Resolvida', FECHADA: 'Fechada',
};

export const STATUS_ABERTOS: readonly StatusThread[] = ['NOVA', 'TRIADA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO'];
export const ehAberta = (s: StatusThread): boolean => STATUS_ABERTOS.includes(s);
export const ehReabertura = (de: StatusThread, para: StatusThread): boolean => (de === 'RESOLVIDA' || de === 'FECHADA') && para === 'EM_ATENDIMENTO';

/** Evento gerado por cada transicao: reabrir, resolver e fechar tem nome proprio; o resto e STATUS_CHANGED. */
export function eventoDaTransicao(de: StatusThread, para: StatusThread): TipoEventoThread {
  if (ehReabertura(de, para)) return 'THREAD_REOPENED';
  if (para === 'RESOLVIDA') return 'RESOLVED';
  if (para === 'FECHADA') return 'CLOSED';
  return 'STATUS_CHANGED';
}

export interface VeredictoTransicao { ok: boolean; motivo: string }

/**
 * Valida a transicao pedida sobre a thread como ela esta. Nao muda nada: quem aplica e `aplicarStatus`.
 * `motivo` e obrigatorio para reabrir e para fechar sem resolver (a trilha precisa dizer por que).
 */
export function validarTransicao(t: InboxThread, para: StatusThread, opcoes: { motivo?: string } = {}): VeredictoTransicao {
  if (t.status === para) return { ok: false, motivo: `a conversa já está em ${NOME_STATUS[para]}` };
  if (!TRANSICOES_THREAD[t.status].includes(para)) return { ok: false, motivo: `${NOME_STATUS[t.status]} não vai para ${NOME_STATUS[para]}` };
  const motivo = (opcoes.motivo ?? '').trim();
  if (ehReabertura(t.status, para) && !motivo) return { ok: false, motivo: 'reabrir exige motivo' };
  if (para === 'FECHADA' && t.status !== 'RESOLVIDA' && !motivo) return { ok: false, motivo: 'fechar sem resolver exige motivo' };
  if (para === 'ATRIBUIDA' && !t.responsavelId) return { ok: false, motivo: 'atribuída exige responsável' };
  if ((para === 'AGUARDANDO_CONTATO' || para === 'AGUARDANDO_INTERNO' || para === 'AGUARDANDO_APROVACAO') && !t.responsavelId) {
    return { ok: false, motivo: 'só quem atende pode colocar a conversa em espera: atribua um responsável' };
  }
  if (para === 'RESOLVIDA' && !t.responsavelId && t.nivel !== 'A') return { ok: false, motivo: 'resolver exige responsável (só o nível A resolve sem pessoa)' };
  return { ok: true, motivo: 'transição válida' };
}

/** Aplica a transicao ja validada. Marcas de tempo coerentes: resolver limpa fechamento, reabrir limpa as duas. */
export function aplicarStatus(t: InboxThread, para: StatusThread, agoraIso: string, resolvidaPor?: 'ia' | 'humano'): InboxThread {
  const base: InboxThread = { ...t, status: para };
  if (para === 'RESOLVIDA') return { ...base, resolvidaEm: agoraIso, fechadaEm: undefined, resolvidaPor: resolvidaPor ?? (t.nivel === 'A' && !t.responsavelId ? 'ia' : 'humano') };
  if (para === 'FECHADA') return { ...base, fechadaEm: agoraIso, resolvidaEm: t.resolvidaEm ?? agoraIso, resolvidaPor: t.resolvidaPor ?? resolvidaPor ?? 'humano' };
  if (ehReabertura(t.status, para)) return { ...base, resolvidaEm: undefined, fechadaEm: undefined, resolvidaPor: undefined };
  return base;
}

/**
 * Status derivado depois de ATRIBUIR setor/responsavel: NOVA vira TRIADA (setor) ou ATRIBUIDA (pessoa); quem ja esta
 * em atendimento ou em espera nao regride. Perder o responsavel numa thread em espera volta para TRIADA.
 */
export function statusAposAtribuicao(t: InboxThread, setorCodigo: string | undefined, responsavelId: string | undefined): StatusThread {
  if (t.status === 'NOVA' || t.status === 'TRIADA' || t.status === 'ATRIBUIDA') {
    if (responsavelId) return 'ATRIBUIDA';
    if (setorCodigo) return 'TRIADA';
    return t.status === 'ATRIBUIDA' ? 'TRIADA' : t.status;
  }
  if (!responsavelId && (t.status === 'AGUARDANDO_CONTATO' || t.status === 'AGUARDANDO_INTERNO' || t.status === 'AGUARDANDO_APROVACAO')) return 'TRIADA';
  return t.status;
}

/** Mensagem nova do CONTATO reabre o que estava esperando por ele ou ja resolvido; o resto so atualiza o relogio. */
export function aoReceberMensagem(t: InboxThread, em: string): InboxThread {
  const maior = (a: string | undefined, b: string) => (!a || b > a ? b : a);
  const base: InboxThread = { ...t, ultimaMensagemEm: maior(t.ultimaMensagemEm, em), ultimaInboundEm: maior(t.ultimaInboundEm, em) };
  if (t.status === 'AGUARDANDO_CONTATO' || t.status === 'RESOLVIDA' || t.status === 'FECHADA') {
    return { ...base, status: 'EM_ATENDIMENTO', resolvidaEm: undefined, fechadaEm: undefined, resolvidaPor: undefined };
  }
  return base;
}

/** Resposta da EIFF: registra a primeira resposta no SLA e leva ATRIBUIDA/TRIADA para EM_ATENDIMENTO. */
export function aoResponder(t: InboxThread, em: string): InboxThread {
  const sla = t.sla && !t.sla.primeiraRespostaEm ? { ...t.sla, primeiraRespostaEm: em } : t.sla;
  const status: StatusThread = t.status === 'ATRIBUIDA' || t.status === 'TRIADA' || t.status === 'NOVA' ? 'EM_ATENDIMENTO' : t.status;
  return { ...t, sla, status, ultimaMensagemEm: em };
}

// ---------------------------------------------------------------------------
// Quem pode agir (a permissao `inbox` e o portao; isto e o recorte dentro dela, espelhado no RLS da 0056)
// ---------------------------------------------------------------------------
export interface RecorteUsuario { id: string; transversal: boolean; gestorDe: string[]; setores: string[] }
export interface VeredictoAutoridade { ok: boolean; motivo: string }

/** Responsavel, gestor do setor ou transversal decidem o status. Sem responsavel, quem enxerga a thread pode assumi-la/tria-la. */
export function podeMudarStatus(u: RecorteUsuario, t: InboxThread, para: StatusThread): VeredictoAutoridade {
  if (u.transversal) return { ok: true, motivo: 'visão transversal' };
  if (t.responsavelId === u.id) return { ok: true, motivo: 'responsável pela conversa' };
  if (t.setorCodigo && u.gestorDe.includes(t.setorCodigo)) return { ok: true, motivo: 'gestor do setor' };
  if (!t.responsavelId && (para === 'TRIADA' || para === 'ATRIBUIDA' || para === 'EM_ATENDIMENTO' || para === 'FECHADA') && (!t.setorCodigo || u.setores.includes(t.setorCodigo))) {
    return { ok: true, motivo: 'conversa sem responsável no meu recorte' };
  }
  return { ok: false, motivo: 'só o responsável, o gestor do setor ou a Diretoria mudam o status desta conversa' };
}

/**
 * Atribuir: assumir para si uma conversa visivel sem responsavel e sempre permitido; transferir para outra pessoa ou
 * setor exige ser o responsavel atual, gestor do setor atual ou transversal.
 */
export function podeAtribuir(u: RecorteUsuario, t: InboxThread, alvo: { setorCodigo?: string; responsavelId?: string }): VeredictoAutoridade {
  if (u.transversal) return { ok: true, motivo: 'visão transversal' };
  const assumir = alvo.responsavelId === u.id && (alvo.setorCodigo === undefined || alvo.setorCodigo === t.setorCodigo);
  if (assumir && !t.responsavelId && (!t.setorCodigo || u.setores.includes(t.setorCodigo))) return { ok: true, motivo: 'assumindo conversa sem responsável' };
  if (t.responsavelId === u.id) return { ok: true, motivo: 'responsável pela conversa' };
  if (t.setorCodigo && u.gestorDe.includes(t.setorCodigo)) return { ok: true, motivo: 'gestor do setor' };
  if (!t.responsavelId && !t.setorCodigo) return { ok: true, motivo: 'triagem de conversa sem setor' };
  return { ok: false, motivo: 'só o responsável, o gestor do setor ou a Diretoria transferem esta conversa' };
}
