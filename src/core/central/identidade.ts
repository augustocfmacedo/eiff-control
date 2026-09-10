// EIFF Central: resolucao e ciclo de vida do vinculo telefone -> pessoa do EIFF Control.
// PURO: nenhuma rede, nenhuma IA, nenhuma escrita no banco. Quem persiste e o servidor (migration 0049).
//
// Regras duras desta camada:
// - o nome que o WhatsApp informa e apelido do dono do aparelho: NUNCA e identidade;
// - a chave e o par (organizacao, contexto, telefone normalizado): identidade de OUTRO contexto ou de OUTRA
//   organizacao nunca resolve, nem "por conveniencia";
// - uma pessoa pode ter varios numeros; o mesmo numero nao pode estar VERIFIED para duas pessoas no mesmo contexto;
// - o codigo de verificacao tem vida curta, e conferido em tempo constante e NUNCA aparece em log ou mensagem.
import { mascararTelefone, normalizarTelefone, type CommunicationContext } from '../radar/canais';
import { resolverIdentidade, type IdentidadeResolvida, type SituacaoIdentidade, type WhatsappIdentity } from './tipos';

export { resolverIdentidade };
export type { IdentidadeResolvida, SituacaoIdentidade, WhatsappIdentity };

// ---------------------------------------------------------------------------
// 1) Telefone: normalizacao e validacao
// ---------------------------------------------------------------------------
export interface TelefoneCentral { ok: boolean; telefone?: string; motivo: string }
/**
 * Normaliza o telefone para E.164 sem "+" reaproveitando `normalizarTelefone` do canal (regra unica do projeto).
 * Numero que nao passa na normalizacao nao vira identidade: fica de fora, com motivo legivel e SEM o numero em claro.
 */
export function telefoneCentral(bruto?: string): TelefoneCentral {
  const telefone = normalizarTelefone(bruto);
  if (!bruto?.trim()) return { ok: false, motivo: 'telefone ausente' };
  if (!telefone) return { ok: false, motivo: 'telefone fora do formato E.164 (DDI + DDD + número)' };
  return { ok: true, telefone, motivo: `telefone ${mascararTelefone(telefone)}` };
}

// ---------------------------------------------------------------------------
// 2) Resolucao por (organizacao, contexto, telefone)
// ---------------------------------------------------------------------------
export interface ChaveIdentidade { organizationId: string; contexto?: CommunicationContext }
/**
 * Resolve o telefone dentro de UMA organizacao e UM contexto. O filtro de organizacao acontece aqui; o de contexto e
 * de situacao continua em `resolverIdentidade` (tipos.ts), que e a definicao unica.
 * Contexto indefinido (numero de entrada desconhecido) nunca resolve: o evento e tratado como nao confiavel.
 */
export function resolverIdentidadeCentral(telefoneBruto: string | undefined, identidades: WhatsappIdentity[], chave: ChaveIdentidade): IdentidadeResolvida {
  if (!chave.contexto) return { conhecida: false, verificada: false, motivo: 'contexto indefinido: número de entrada desconhecido, evento não confiável' };
  const tel = telefoneCentral(telefoneBruto);
  if (!tel.ok) return { conhecida: false, verificada: false, motivo: tel.motivo };
  const daOrganizacao = identidades.filter((i) => i.organizationId === chave.organizationId);
  return resolverIdentidade(tel.telefone, daOrganizacao, chave.contexto);
}

/** Numeros vinculados a uma pessoa (uma pessoa pode ter varios aparelhos). Sempre mascarados na saida. */
export function identidadesDaPessoa(identidades: WhatsappIdentity[], pessoa: { organizationId: string; usuarioId?: string; colaboradorId?: string }): WhatsappIdentity[] {
  return identidades.filter((i) => i.organizationId === pessoa.organizationId
    && ((pessoa.usuarioId && i.usuarioId === pessoa.usuarioId) || (pessoa.colaboradorId && i.colaboradorId === pessoa.colaboradorId)));
}
/** Descricao segura de uma identidade: telefone mascarado, sem apelido do WhatsApp e sem codigo. */
export const descreverIdentidade = (i: WhatsappIdentity): string =>
  `${mascararTelefone(i.telefoneNormalizado)} · ${i.contexto} · ${i.situacao}${i.usuarioId ? ` · usuário ${i.usuarioId}` : i.colaboradorId ? ` · colaborador ${i.colaboradorId}` : ''}`;

// ---------------------------------------------------------------------------
// 3) Ciclo de vida: PENDING -> VERIFIED -> REVOKED
// ---------------------------------------------------------------------------
/** Transicoes permitidas. REVOKED e terminal: numero revogado volta pelo cadastro, nunca por reativacao silenciosa. */
export const TRANSICOES_IDENTIDADE: Record<SituacaoIdentidade, SituacaoIdentidade[]> = {
  PENDING: ['VERIFIED', 'REVOKED'],
  VERIFIED: ['REVOKED'],
  REVOKED: [],
};
export interface ResultadoTransicao { ok: boolean; motivo: string; identidade?: WhatsappIdentity }

export function transicaoPermitida(de: SituacaoIdentidade, para: SituacaoIdentidade): boolean {
  return TRANSICOES_IDENTIDADE[de].includes(para);
}

/**
 * Conflito de unicidade: o mesmo numero VERIFIED para duas pessoas no mesmo contexto e proibido (espelha o indice
 * unico parcial da migration 0049). A mesma pessoa reverificando o proprio numero nao e conflito.
 */
export function conflitoDeVerificacao(identidade: WhatsappIdentity, todas: WhatsappIdentity[]): WhatsappIdentity | undefined {
  return todas.find((o) => o.id !== identidade.id
    && o.situacao === 'VERIFIED'
    && o.organizationId === identidade.organizationId
    && o.contexto === identidade.contexto
    && o.telefoneNormalizado === identidade.telefoneNormalizado
    && !mesmaPessoa(o, identidade));
}
const mesmaPessoa = (a: WhatsappIdentity, b: WhatsappIdentity): boolean =>
  (!!a.usuarioId && a.usuarioId === b.usuarioId) || (!!a.colaboradorId && a.colaboradorId === b.colaboradorId);

/**
 * Aplica a transicao de situacao. Funcao pura: devolve uma NOVA identidade, nunca altera a recebida.
 * `todas` serve so para conferir a unicidade do VERIFIED; sem ela a conferencia e pulada (uso em teste isolado).
 */
export function transicionarIdentidade(identidade: WhatsappIdentity, para: SituacaoIdentidade, agoraIso: string, todas: WhatsappIdentity[] = []): ResultadoTransicao {
  if (identidade.situacao === para) return { ok: false, motivo: `identidade já está em ${para}` };
  if (!transicaoPermitida(identidade.situacao, para)) return { ok: false, motivo: `transição ${identidade.situacao} → ${para} não é permitida` };
  const nova: WhatsappIdentity = { ...identidade, situacao: para };
  if (para === 'VERIFIED') {
    const conflito = conflitoDeVerificacao(nova, todas);
    if (conflito) return { ok: false, motivo: `${mascararTelefone(nova.telefoneNormalizado)} já está verificado para outra pessoa neste contexto` };
    nova.verificadoEm = agoraIso;
  }
  if (para === 'REVOKED') nova.revogadoEm = agoraIso;
  return { ok: true, motivo: `identidade ${mascararTelefone(nova.telefoneNormalizado)} agora está ${para}`, identidade: nova };
}

// ---------------------------------------------------------------------------
// 4) Codigo de verificacao (vida curta, comparacao de tempo constante)
// ---------------------------------------------------------------------------
export const TAMANHO_CODIGO = 6;
export const VALIDADE_CODIGO_MINUTOS = 10;
export const MAX_TENTATIVAS_CODIGO = 5;

/** Fonte de bytes aleatorios injetavel: o teste passa bytes fixos; em producao vem do `crypto` da plataforma. */
export interface FonteAleatoria { bytes(n: number): Uint8Array }
export const fonteAleatoriaPadrao: FonteAleatoria = {
  bytes: (n) => {
    const b = new Uint8Array(n);
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (!c?.getRandomValues) throw new Error('sem fonte de aleatoriedade segura nesta plataforma');
    c.getRandomValues(b);
    return b;
  },
};

/**
 * Codigo numerico de vida curta, sem vies de modulo (bytes >= 250 sao descartados).
 * O codigo E SEGREDO: nunca entra em log, em `motivo`, em auditoria ou em qualquer texto de saida.
 */
export function gerarCodigoVerificacao(tamanho = TAMANHO_CODIGO, fonte: FonteAleatoria = fonteAleatoriaPadrao): string {
  let codigo = '';
  let rodada = 0;
  while (codigo.length < tamanho && rodada < 8) {
    for (const v of fonte.bytes(tamanho * 2)) {
      if (codigo.length === tamanho) break;
      if (v >= 250) continue; // 250 = maior multiplo de 10 abaixo de 256: descartar tira o vies
      codigo += String(v % 10);
    }
    rodada += 1;
  }
  if (codigo.length < tamanho) throw new Error('não foi possível gerar o código de verificação');
  return codigo;
}

/**
 * Desafio de verificacao. `codigo` so existe em memoria e no envio ao dono do numero; o banco guarda apenas o
 * hash (migration 0049, `verification_code_hash`), calculado pelo servidor.
 */
export interface DesafioVerificacao {
  identidadeId: string;
  organizationId: string;
  contexto: CommunicationContext;
  telefoneNormalizado: string;
  codigo: string; // SEGREDO
  criadoEm: string;
  expiraEm: string;
  tentativas: number;
}
export interface OpcoesDesafio { validadeMinutos?: number; tamanho?: number; fonte?: FonteAleatoria }

export function abrirDesafioVerificacao(identidade: WhatsappIdentity, agoraIso: string, opcoes: OpcoesDesafio = {}): DesafioVerificacao {
  const minutos = opcoes.validadeMinutos ?? VALIDADE_CODIGO_MINUTOS;
  return {
    identidadeId: identidade.id,
    organizationId: identidade.organizationId,
    contexto: identidade.contexto,
    telefoneNormalizado: identidade.telefoneNormalizado,
    codigo: gerarCodigoVerificacao(opcoes.tamanho ?? TAMANHO_CODIGO, opcoes.fonte ?? fonteAleatoriaPadrao),
    criadoEm: agoraIso,
    expiraEm: new Date(new Date(agoraIso).getTime() + minutos * 60_000).toISOString(),
    tentativas: 0,
  };
}
/** Descricao do desafio para tela e log: sem o codigo, com o telefone mascarado. */
export const descreverDesafio = (d: DesafioVerificacao): string =>
  `código de ${d.codigo.length} dígitos enviado para ${mascararTelefone(d.telefoneNormalizado)}, válido até ${d.expiraEm}`;

/**
 * Comparacao de tempo constante: percorre sempre o maior comprimento e nunca sai antes do fim, para nao vazar
 * quantos digitos batem pelo tempo de resposta.
 */
export function comparacaoConstante(a: string, b: string): boolean {
  let diferenca = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diferenca |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diferenca === 0;
}

export interface ResultadoCodigo { ok: boolean; motivo: string; desafio: DesafioVerificacao }
/** Confere o codigo informado. Sempre devolve o desafio com a tentativa contada; o codigo nunca aparece no motivo. */
export function conferirCodigoVerificacao(desafio: DesafioVerificacao, informado: string, agoraIso: string): ResultadoCodigo {
  const gasto: DesafioVerificacao = { ...desafio, tentativas: desafio.tentativas + 1 };
  if (desafio.tentativas >= MAX_TENTATIVAS_CODIGO) return { ok: false, motivo: 'código bloqueado por excesso de tentativas; peça um novo', desafio: gasto };
  if (agoraIso > desafio.expiraEm) return { ok: false, motivo: 'código expirado; peça um novo', desafio: gasto };
  const limpo = (informado ?? '').replace(/\D+/g, '');
  const confere = comparacaoConstante(limpo, desafio.codigo);
  return confere
    ? { ok: true, motivo: 'código conferido', desafio: gasto }
    : { ok: false, motivo: 'código não confere', desafio: gasto };
}

export interface ResultadoVerificacao extends ResultadoCodigo { identidade?: WhatsappIdentity }
/**
 * Fluxo completo PENDING -> VERIFIED: confere o desafio (que tem de ser DESTA identidade) e so entao transiciona.
 * Nenhum atalho: desafio de outra identidade, de outra organizacao ou de outro contexto nao vale.
 */
export function concluirVerificacao(identidade: WhatsappIdentity, desafio: DesafioVerificacao, informado: string, agoraIso: string, todas: WhatsappIdentity[] = []): ResultadoVerificacao {
  if (desafio.identidadeId !== identidade.id || desafio.organizationId !== identidade.organizationId
    || desafio.contexto !== identidade.contexto || desafio.telefoneNormalizado !== identidade.telefoneNormalizado) {
    return { ok: false, motivo: 'desafio não pertence a esta identidade', desafio: { ...desafio, tentativas: desafio.tentativas + 1 } };
  }
  const conferido = conferirCodigoVerificacao(desafio, informado, agoraIso);
  if (!conferido.ok) return conferido;
  const t = transicionarIdentidade(identidade, 'VERIFIED', agoraIso, todas);
  return t.ok
    ? { ...conferido, identidade: t.identidade, motivo: t.motivo }
    : { ...conferido, ok: false, motivo: t.motivo };
}

/** Revogacao: sempre permitida a partir de PENDING ou VERIFIED, com motivo registrado pelo chamador. */
export const revogarIdentidade = (identidade: WhatsappIdentity, agoraIso: string): ResultadoTransicao =>
  transicionarIdentidade(identidade, 'REVOKED', agoraIso);
