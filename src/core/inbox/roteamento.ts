// EIFF Inbox: roteamento, politica IA + humano, SLA, visibilidade e caixas virtuais. PURO.
//
// Roteamento e decisao deterministica sobre a CLASSIFICACAO (que pode vir da IA ou de triagem humana): regra ->
// setor -> responsavel padrao -> prioridade -> nivel -> SLA. A decisao vem com os motivos, porque a tela mostra
// "por que foi para cá" e a auditoria precisa reler isso sem reexecutar nada.
import type { Usuario } from '../types';
import { ehAberta, type RecorteUsuario } from './estados';
import type { Classificacao, ConfiguracaoInbox, ContatoInbox, InboxDataset, InboxThread, MembroSetor, NivelAtendimento, Prioridade, RegraNivel, RegraRoteamento, Setor } from './tipos';

// ---------------------------------------------------------------------------
// 1) Roteamento
// ---------------------------------------------------------------------------
export interface DecisaoRoteamento {
  setorCodigo: string;
  responsavelId?: string;
  prioridade: Prioridade;
  nivel: NivelAtendimento;
  regraRoteamentoId?: string;
  regraNivelId?: string;
  motivos: string[];
  fallback: boolean;
}

const ORDEM_PRIORIDADE: Record<Prioridade, number> = { Baixa: 0, Normal: 1, Alta: 2, Urgente: 3 };
export const maiorPrioridade = (a: Prioridade, b: Prioridade): Prioridade => (ORDEM_PRIORIDADE[a] >= ORDEM_PRIORIDADE[b] ? a : b);
const ORDEM_NIVEL: Record<NivelAtendimento, number> = { A: 0, B: 1, C: 2 };
/** A < B < C. Uma pessoa pode apertar o nivel, nunca afrouxar abaixo da politica. */
export const nivelMaisRestritivo = (a: NivelAtendimento, b: NivelAtendimento): NivelAtendimento => (ORDEM_NIVEL[a] >= ORDEM_NIVEL[b] ? a : b);

function casaRoteamento(r: RegraRoteamento, c: Classificacao | undefined, contato: ContatoInbox | undefined, thread: Pick<InboxThread, 'contexto' | 'assunto'>): boolean {
  const cond = r.condicao;
  if (cond.contexto && cond.contexto !== thread.contexto) return false;
  if (cond.intencoes?.length && !(c && cond.intencoes.includes(c.intencao))) return false;
  if (cond.tiposRelacao?.length && !(contato && cond.tiposRelacao.includes(contato.tipoRelacao))) return false;
  if (cond.palavras?.length) {
    const texto = `${thread.assunto} ${c?.assunto ?? ''}`.toLowerCase();
    if (!cond.palavras.some((p) => texto.includes(p.toLowerCase()))) return false;
  }
  return true;
}

function casaNivel(r: RegraNivel, c: Classificacao | undefined, setorCodigo: string, contato: ContatoInbox | undefined): boolean {
  if (r.intencoes?.length && !(c && r.intencoes.includes(c.intencao))) return false;
  if (r.setores?.length && !r.setores.includes(setorCodigo)) return false;
  if (r.tiposRelacao?.length && !(contato && r.tiposRelacao.includes(contato.tipoRelacao))) return false;
  return true;
}

/** Nivel de atendimento pela politica configuravel. Sem classificacao ou sem regra: o padrao (B), nunca A por conveniencia. */
export function nivelPara(config: ConfiguracaoInbox, c: Classificacao | undefined, setorCodigo: string, contato: ContatoInbox | undefined): { nivel: NivelAtendimento; regraId?: string; motivo: string } {
  const regras = [...config.regrasNivel].filter((r) => r.ativa).sort((a, b) => a.ordem - b.ordem);
  for (const r of regras) if (casaNivel(r, c, setorCodigo, contato)) return { nivel: r.nivel, regraId: r.id, motivo: r.motivo };
  if (!c) return { nivel: 'C', motivo: 'sem classificação: humano obrigatório' };
  return { nivel: config.nivelPadrao, motivo: 'nenhuma regra de nível casou: nível padrão' };
}

/**
 * Decide setor, responsavel, prioridade e nivel. A primeira regra de roteamento (por ordem) que casar vence; sem
 * regra, o setor de fallback. O responsavel so vem da regra ou do padrao do setor — o Inbox nunca escolhe uma
 * pessoa por conta propria. Uma recomendacao da classificacao entra como sinal, nunca como autoridade.
 */
export function rotear(entrada: { thread: Pick<InboxThread, 'contexto' | 'assunto' | 'prioridade'>; classificacao?: Classificacao; contato?: ContatoInbox; setores: Setor[]; config: ConfiguracaoInbox }): DecisaoRoteamento {
  const { thread, classificacao: c, contato, setores, config } = entrada;
  const ativos = new Set(setores.filter((s) => s.ativo).map((s) => s.codigo));
  const motivos: string[] = [];
  let setorCodigo: string | undefined;
  let regraId: string | undefined;
  let prioridade: Prioridade = thread.prioridade;
  let responsavelId: string | undefined;

  const regras = [...config.regrasRoteamento].filter((r) => r.ativa && ativos.has(r.destino.setorCodigo)).sort((a, b) => a.ordem - b.ordem);
  const regra = regras.find((r) => casaRoteamento(r, c, contato, thread));
  if (regra) {
    setorCodigo = regra.destino.setorCodigo; regraId = regra.id; responsavelId = regra.destino.responsavelId;
    motivos.push(`regra ${regra.id}: ${regra.motivo}`);
    if (regra.destino.prioridade) prioridade = maiorPrioridade(prioridade, regra.destino.prioridade);
  } else if (c?.setorRecomendado && ativos.has(c.setorRecomendado)) {
    setorCodigo = c.setorRecomendado;
    motivos.push(`setor recomendado pela classificação (${c.provedor}, confiança ${Math.round(c.confianca * 100)}%)`);
  }
  const fallback = !setorCodigo;
  if (!setorCodigo) { setorCodigo = config.setorFallback; motivos.push(`nenhuma regra casou: setor de fallback ${config.setorFallback}`); }
  if (c) prioridade = maiorPrioridade(prioridade, c.prioridadeRecomendada);
  if (!responsavelId) {
    const padrao = setores.find((s) => s.codigo === setorCodigo)?.responsavelPadraoId;
    if (padrao) { responsavelId = padrao; motivos.push('responsável padrão do setor'); }
    else motivos.push('setor sem responsável padrão: fica em Não atribuídos');
  }
  const n = nivelPara(config, c, setorCodigo, contato);
  motivos.push(`nível ${n.nivel}: ${n.motivo}`);
  return { setorCodigo, responsavelId, prioridade, nivel: n.nivel, regraRoteamentoId: regraId, regraNivelId: n.regraId, motivos, fallback };
}

// ---------------------------------------------------------------------------
// 2) SLA e escalacao
// ---------------------------------------------------------------------------
export const slaDe = (config: ConfiguracaoInbox, prioridade: Prioridade, abertaEm: string): string =>
  new Date(new Date(abertaEm).getTime() + config.slaHorasPorPrioridade[prioridade] * 3_600_000).toISOString();

export type EstadoSla = 'sem_sla' | 'no_prazo' | 'vencendo' | 'vencido' | 'cumprido';
/** Estado do SLA de primeira resposta agora. `vencendo` = menos de 25% do prazo restante. */
export function estadoSla(t: InboxThread, agoraIso: string): EstadoSla {
  if (!t.sla) return 'sem_sla';
  if (t.sla.primeiraRespostaEm) return 'cumprido';
  if (!ehAberta(t.status)) return 'cumprido';
  const ate = new Date(t.sla.primeiraRespostaAte).getTime();
  const agora = new Date(agoraIso).getTime();
  if (agora > ate) return 'vencido';
  const total = ate - new Date(t.abertaEm).getTime();
  return ate - agora < total * 0.25 ? 'vencendo' : 'no_prazo';
}

export interface Escalacao { threadId: string; para: string; motivo: string }
/** Threads com SLA vencido e sem resposta escalam para o setor de escalacao — a decisao, nao a execucao. */
export function escalacoesPendentes(threads: InboxThread[], config: ConfiguracaoInbox, agoraIso: string): Escalacao[] {
  return threads
    .filter((t) => estadoSla(t, agoraIso) === 'vencido' && t.setorCodigo !== config.setorEscalacao)
    .map((t) => ({ threadId: t.id, para: config.setorEscalacao, motivo: `SLA de primeira resposta vencido em ${t.sla?.primeiraRespostaAte}` }));
}

// ---------------------------------------------------------------------------
// 3) Visibilidade (recorte dentro da permissao `inbox`)
// ---------------------------------------------------------------------------
export interface Visibilidade { transversal: boolean; setores: string[]; gestorDe: string[] }
/** Administrador e Diretoria veem tudo; gestor de setor ve o setor inteiro; atendente ve o setor em que esta. */
export function visibilidadeDe(usuario: Pick<Usuario, 'id' | 'papel'>, membros: MembroSetor[]): Visibilidade {
  const meus = membros.filter((m) => m.usuarioId === usuario.id);
  return {
    transversal: usuario.papel === 'Administrador' || usuario.papel === 'Diretoria',
    setores: [...new Set(meus.map((m) => m.setorCodigo))],
    gestorDe: meus.filter((m) => m.papel === 'gestor').map((m) => m.setorCodigo),
  };
}
/** Recorte do usuario para as regras de autoridade (estados.ts): a mesma leitura de membros usada pela visibilidade. */
export const recorteDe = (usuario: Pick<Usuario, 'id' | 'papel'>, membros: MembroSetor[]): RecorteUsuario => ({ id: usuario.id, ...visibilidadeDe(usuario, membros) });
/** A thread e visivel se e do meu setor, se sou responsavel/participante, se ainda nao tem setor (triagem) ou se vejo tudo. */
export function threadVisivel(t: InboxThread, usuarioId: string, v: Visibilidade): boolean {
  if (v.transversal) return true;
  if (t.responsavelId === usuarioId || t.participantes.includes(usuarioId)) return true;
  if (!t.setorCodigo) return true;
  return v.setores.includes(t.setorCodigo);
}

// ---------------------------------------------------------------------------
// 4) Caixas virtuais e visao executiva
// ---------------------------------------------------------------------------
export type CaixaFixa = 'minha' | 'precisa_de_mim' | 'nao_atribuidos' | 'urgentes' | 'automatizados' | 'aguardando' | 'concluidos' | 'factory' | 'todas';
export interface Caixa { id: string; nome: string; fixa?: CaixaFixa; setorCodigo?: string; quantidade: number }

/** Precisa de mim = e minha e esta viva (nao em espera de contato nem resolvida), ou aguarda aprovacao do meu papel. */
export function precisaDeMim(t: InboxThread, usuario: Pick<Usuario, 'id' | 'papel'>, acoesAguardandoMeuPapel: Set<string>): boolean {
  if (acoesAguardandoMeuPapel.has(t.id)) return true;
  if (t.responsavelId !== usuario.id) return false;
  return t.status === 'ATRIBUIDA' || t.status === 'EM_ATENDIMENTO' || t.status === 'AGUARDANDO_INTERNO';
}

export function caixasVirtuais(ds: InboxDataset, usuario: Pick<Usuario, 'id' | 'papel'>): Caixa[] {
  const v = visibilidadeDe(usuario, ds.membros);
  const visiveis = ds.threads.filter((t) => threadVisivel(t, usuario.id, v));
  const aguardandoMeuPapel = new Set(ds.acoes.filter((a) => a.estado === 'aguardando_aprovacao' && a.aprovacao.papelDecisor === usuario.papel).map((a) => a.threadId));
  const comJob = new Set(ds.jobs.map((j) => j.threadId));
  const abertas = visiveis.filter((t) => ehAberta(t.status));
  const fixas: Caixa[] = [
    { id: 'precisa_de_mim', fixa: 'precisa_de_mim', nome: 'Precisa de mim', quantidade: abertas.filter((t) => precisaDeMim(t, usuario, aguardandoMeuPapel)).length },
    { id: 'minha', fixa: 'minha', nome: 'Minha caixa', quantidade: abertas.filter((t) => t.responsavelId === usuario.id).length },
    { id: 'nao_atribuidos', fixa: 'nao_atribuidos', nome: 'Não atribuídos', quantidade: abertas.filter((t) => !t.responsavelId).length },
    { id: 'urgentes', fixa: 'urgentes', nome: 'Urgentes', quantidade: abertas.filter((t) => t.prioridade === 'Urgente').length },
    { id: 'aguardando', fixa: 'aguardando', nome: 'Aguardando', quantidade: abertas.filter((t) => t.status.startsWith('AGUARDANDO')).length },
    { id: 'automatizados', fixa: 'automatizados', nome: 'Automatizados', quantidade: visiveis.filter((t) => t.resolvidaPor === 'ia').length },
    { id: 'concluidos', fixa: 'concluidos', nome: 'Concluídos', quantidade: visiveis.filter((t) => !ehAberta(t.status)).length },
    { id: 'factory', fixa: 'factory', nome: 'Factory', quantidade: visiveis.filter((t) => comJob.has(t.id)).length },
  ];
  const setores = [...ds.setores].filter((s) => s.ativo && (v.transversal || v.setores.includes(s.codigo))).sort((a, b) => a.ordem - b.ordem)
    .map<Caixa>((s) => ({ id: `setor:${s.codigo}`, setorCodigo: s.codigo, nome: s.nome, quantidade: abertas.filter((t) => t.setorCodigo === s.codigo).length }));
  return [...fixas, ...setores];
}

/** Aplica o filtro de uma caixa sobre as threads visiveis (nao reordena). */
export function threadsDaCaixa(ds: InboxDataset, usuario: Pick<Usuario, 'id' | 'papel'>, caixaId: string): InboxThread[] {
  const v = visibilidadeDe(usuario, ds.membros);
  const visiveis = ds.threads.filter((t) => threadVisivel(t, usuario.id, v));
  const aguardandoMeuPapel = new Set(ds.acoes.filter((a) => a.estado === 'aguardando_aprovacao' && a.aprovacao.papelDecisor === usuario.papel).map((a) => a.threadId));
  const comJob = new Set(ds.jobs.map((j) => j.threadId));
  if (caixaId.startsWith('setor:')) { const s = caixaId.slice(6); return visiveis.filter((t) => t.setorCodigo === s && ehAberta(t.status)); }
  switch (caixaId as CaixaFixa) {
    case 'precisa_de_mim': return visiveis.filter((t) => ehAberta(t.status) && precisaDeMim(t, usuario, aguardandoMeuPapel));
    case 'minha': return visiveis.filter((t) => ehAberta(t.status) && t.responsavelId === usuario.id);
    case 'nao_atribuidos': return visiveis.filter((t) => ehAberta(t.status) && !t.responsavelId);
    case 'urgentes': return visiveis.filter((t) => ehAberta(t.status) && t.prioridade === 'Urgente');
    case 'aguardando': return visiveis.filter((t) => ehAberta(t.status) && t.status.startsWith('AGUARDANDO'));
    case 'automatizados': return visiveis.filter((t) => t.resolvidaPor === 'ia');
    case 'concluidos': return visiveis.filter((t) => !ehAberta(t.status));
    case 'factory': return visiveis.filter((t) => comJob.has(t.id));
    default: return visiveis;
  }
}

/** Ordem de trabalho: vencido primeiro, depois prioridade, depois a mais antiga sem resposta. So ordena; nao filtra. */
export function ordenarParaTrabalho(threads: InboxThread[], agoraIso: string): InboxThread[] {
  const peso = (t: InboxThread) => (estadoSla(t, agoraIso) === 'vencido' ? 100 : estadoSla(t, agoraIso) === 'vencendo' ? 50 : 0) + ORDEM_PRIORIDADE[t.prioridade] * 10 + (ehAberta(t.status) ? 1 : 0);
  return [...threads].sort((a, b) => peso(b) - peso(a) || (a.ultimaMensagemEm < b.ultimaMensagemEm ? -1 : a.ultimaMensagemEm > b.ultimaMensagemEm ? 1 : a.id.localeCompare(b.id)));
}

export interface ResumoExecutivo { precisaDeMim: number; urgente: number; aguardandoContato: number; aguardandoEiff: number; iaResolveu: number; emAtendimento: number; slaVencido: number }
export function resumoExecutivo(ds: InboxDataset, usuario: Pick<Usuario, 'id' | 'papel'>, agoraIso: string): ResumoExecutivo {
  const v = visibilidadeDe(usuario, ds.membros);
  const visiveis = ds.threads.filter((t) => threadVisivel(t, usuario.id, v));
  const abertas = visiveis.filter((t) => ehAberta(t.status));
  const aguardandoMeuPapel = new Set(ds.acoes.filter((a) => a.estado === 'aguardando_aprovacao' && a.aprovacao.papelDecisor === usuario.papel).map((a) => a.threadId));
  return {
    precisaDeMim: abertas.filter((t) => precisaDeMim(t, usuario, aguardandoMeuPapel)).length,
    urgente: abertas.filter((t) => t.prioridade === 'Urgente').length,
    aguardandoContato: abertas.filter((t) => t.status === 'AGUARDANDO_CONTATO').length,
    aguardandoEiff: abertas.filter((t) => t.status === 'AGUARDANDO_INTERNO' || t.status === 'AGUARDANDO_APROVACAO' || t.status === 'NOVA' || t.status === 'TRIADA' || t.status === 'ATRIBUIDA').length,
    iaResolveu: visiveis.filter((t) => t.resolvidaPor === 'ia').length,
    emAtendimento: abertas.filter((t) => t.status === 'EM_ATENDIMENTO').length,
    slaVencido: abertas.filter((t) => estadoSla(t, agoraIso) === 'vencido').length,
  };
}
