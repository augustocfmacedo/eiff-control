// EIFF Inbox — Octopus Router: POLITICA DE AUTOMACAO (IA x humano) como contrato, nao como `if` espalhado. PURO.
//
// Para cada conversa o router responde UMA pergunta: a IA pode agir sozinha (AUTO), pode preparar e um humano aprova
// (APPROVAL) ou o humano e obrigatorio (HUMAN)? A resposta e uma `DecisaoAutomacao` auditavel, com motivo, risco,
// confianca, papel exigido e as acoes que a IA pode propor dentro daquele modo. Ordem de decisao:
//   1) regra de automacao configurada (a primeira, por ordem, que casa intencao/setor/tipo de relacao) — dado, nao codigo;
//   2) sem regra: o nivel de atendimento da politica (A → AUTO, B → APPROVAL, C → HUMAN);
//   3) guardas que so APERTAM (nunca afrouxam): risco ALTO → HUMAN; confianca abaixo do corte de setor → HUMAN;
//      contato desconhecido nunca recebe AUTO; contexto INTERNAL sem identidade verificada nunca recebe AUTO.
// Nada aqui executa: quem le a decisao (store, servidor) e quem aplica.
import type { CommunicationContext } from '../radar/canais';
import type { ContatoInbox, DecisaoAutomacao, ModoAutomacao, NivelAtendimento, RegraAutomacao, Risco, TipoAcao } from './tipos';

/** Acoes que a IA pode propor/executar em cada modo. HUMAN: a IA no maximo consulta o sistema para preparar contexto. */
export const ACOES_POR_MODO: Record<ModoAutomacao, TipoAcao[]> = {
  AUTO: ['responder', 'consultar_sistema'],
  APPROVAL: ['responder', 'encaminhar', 'criar_tarefa', 'consultar_sistema', 'registrar_previsao'],
  HUMAN: ['consultar_sistema'],
};
const MODO_POR_NIVEL: Record<NivelAtendimento, ModoAutomacao> = { A: 'AUTO', B: 'APPROVAL', C: 'HUMAN' };
const ORDEM_MODO: Record<ModoAutomacao, number> = { AUTO: 0, APPROVAL: 1, HUMAN: 2 };
const ORDEM_RISCO: Record<Risco, number> = { BAIXO: 0, MEDIO: 1, ALTO: 2 };
/** O modo so aperta: AUTO < APPROVAL < HUMAN. */
export const modoMaisRestritivo = (a: ModoAutomacao, b: ModoAutomacao): ModoAutomacao => (ORDEM_MODO[a] >= ORDEM_MODO[b] ? a : b);
export const riscoMaior = (a: Risco, b: Risco): Risco => (ORDEM_RISCO[a] >= ORDEM_RISCO[b] ? a : b);

export interface EntradaAutomacao {
  regras: RegraAutomacao[];
  intencao: string;
  setorCodigo?: string;
  contato?: Pick<ContatoInbox, 'tipoRelacao' | 'identidades'>;
  contexto: CommunicationContext;
  nivel: NivelAtendimento;
  confianca: number;
  /** Corte abaixo do qual a IA nao age sozinha nem prepara (configuracao `confiancaAtribuirSetor`). */
  confiancaMinima: number;
  /** Modo quando nenhuma regra casa e o nivel nao decide (configuracao `automacaoPadrao`). */
  modoPadrao: ModoAutomacao;
  /** Risco vindo da analise (entidades de valor, tema sensivel); a regra pode elevar. */
  riscoBase?: Risco;
}

function casaRegra(r: RegraAutomacao, e: EntradaAutomacao): boolean {
  if (!r.ativa) return false;
  if (r.intencoes?.length && !r.intencoes.includes(e.intencao)) return false;
  if (r.setores?.length && !(e.setorCodigo && r.setores.includes(e.setorCodigo))) return false;
  if (r.tiposRelacao?.length && !(e.contato && r.tiposRelacao.includes(e.contato.tipoRelacao))) return false;
  return true;
}

/** Decide o modo de automacao desta conversa. Deterministico; a IA nunca escolhe o proprio modo. */
export function decidirAutomacao(e: EntradaAutomacao): DecisaoAutomacao {
  const regra = [...e.regras].sort((a, b) => a.ordem - b.ordem).find((r) => casaRegra(r, e));
  let modo: ModoAutomacao; let motivo: string; let risco: Risco = e.riscoBase ?? 'BAIXO'; let papelExigido: string | undefined; let regraId: string | undefined;
  if (regra) { modo = regra.modo; motivo = `regra ${regra.id}: ${regra.motivo}`; risco = riscoMaior(risco, regra.risco); papelExigido = regra.papelExigido; regraId = regra.id; }
  else if (e.intencao && e.intencao !== 'indefinida') { modo = MODO_POR_NIVEL[e.nivel]; motivo = `sem regra de automação: nível ${e.nivel} da política`; }
  else { modo = modoMaisRestritivo(e.modoPadrao, MODO_POR_NIVEL[e.nivel]); motivo = 'intenção indefinida: modo padrão da configuração'; }
  // guardas — so apertam
  const guardas: string[] = [];
  if (risco === 'ALTO' && modo !== 'HUMAN') { modo = 'HUMAN'; guardas.push('risco alto'); }
  if (e.confianca < e.confiancaMinima && modo !== 'HUMAN') { modo = 'HUMAN'; guardas.push(`confiança ${Math.round(e.confianca * 100)}% abaixo do mínimo ${Math.round(e.confiancaMinima * 100)}%`); }
  if (modo === 'AUTO' && (!e.contato || e.contato.tipoRelacao === 'desconhecido')) { modo = 'APPROVAL'; guardas.push('contato não identificado nunca recebe resposta automática'); }
  if (modo === 'AUTO' && e.contexto === 'INTERNAL' && !e.contato?.identidades.some((i) => i.verificada)) { modo = 'APPROVAL'; guardas.push('identidade interna não verificada'); }
  if (guardas.length) motivo = `${motivo} · apertado: ${guardas.join('; ')}`;
  return { modo, motivo, papelExigido, acoesPermitidas: ACOES_POR_MODO[modo], risco, confianca: e.confianca, regraId };
}

/** Uma acao proposta cabe no modo decidido? (a IA so propoe o que a politica permite; o humano propoe o que quiser) */
export const acaoPermitidaPelaAutomacao = (d: DecisaoAutomacao, tipo: TipoAcao): boolean => d.acoesPermitidas.includes(tipo);
