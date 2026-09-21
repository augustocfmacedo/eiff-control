// EIFF Commercial Machine — CM1-D2: intencao comercial preservada ate a geracao da abordagem.
//
// A Maquina Comercial decide a INTENCAO (contato, objetivo, playbook, canal, acao de origem); quem gera nunca a reescolhe.
// A intencao e so uma projecao do CommercialActionPlan para transporte (nao e entidade, nao e persistida). Quem a recebe
// (store no navegador, /api/comunicacao no servidor) NAO confia nela: recalcula a fila e o plano sobre os dados que tem
// (o servidor, sobre o banco com o JWT do usuario) e exige que batam. Divergencia vira conflito explicito — nunca troca
// silenciosa de objetivo, playbook, canal ou contato. So depois o contexto e montado, com objetivo/playbook do plano
// recalculado (buildCommunicationContext com `intencao`), e segue o mesmo caminho de ContentSpec, fact gate e revisao.
import { planoDeAcaoCM, itemIdCM, VERSAO_REGRAS_PLANO_CM, type CommercialActionPlan } from './commercialActionPlan';
import { CODIGOS_RAZAO_CM, VERSAO_REGRAS_CM, canaisAcionaveisCM, construirCommercialQueue, type CodigoRazaoCM, type CommercialQueueItem, type ReferenciaCM, type TipoReferenciaCM } from './commercialMachine';
import { OBJETIVOS_COMUNICACAO, PLAYBOOKS_CODIGOS, buildCommunicationContext, type ContextoComunicacao, type ObjetivoComunicacao, type PlaybookCodigo } from './comunicacao';
import { calcularDecisionFit, contatoElegivel, tipoProjetoPrincipal } from './contatos';
import { empresaSuprimida, fitIdealDe } from './pipeline';
import { CANAIS, estagioAtivo, type Canal, type RadarDataset } from './types';

export interface IntencaoComunicacaoCM {
  /** SELECAO_ATUAL: gerar rascunho com a decisao do plano. ARTEFATO_APROVADO: reutilizar a abordagem aprovada, sem gerar. */
  origem: 'SELECAO_ATUAL' | 'ARTEFATO_APROVADO';
  empresaId: string;
  itemId: string;
  contatoId: string;
  objetivo: ObjetivoComunicacao;
  playbook: PlaybookCodigo;
  canal: Canal;
  comunicacaoId?: string;
  acaoCodigo: CodigoRazaoCM;
  referencia?: ReferenciaCM;
  versaoRegrasFila: string;
  versaoRegrasPlano: string;
}

export const CAMPOS_INTENCAO_CM = ['origem', 'empresaId', 'itemId', 'contatoId', 'objetivo', 'playbook', 'canal', 'comunicacaoId', 'acaoCodigo', 'referencia', 'versaoRegrasFila', 'versaoRegrasPlano'] as const;
const TIPOS_REFERENCIA: readonly TipoReferenciaCM[] = ['empresa', 'contato', 'tarefa', 'atividade', 'oportunidade', 'sinal', 'comunicacao', 'duplicata'];

export const CONFLITOS_INTENCAO_CM = ['VERSAO_REGRAS_MUDOU', 'FORA_DA_FILA', 'ACAO_MUDOU', 'MODO_NAO_E_CONTATO', 'ORIGEM_MUDOU', 'CONTATO_MUDOU', 'OBJETIVO_MUDOU', 'PLAYBOOK_MUDOU', 'CANAL_NAO_PERMITIDO', 'ARTEFATO_APROVADO'] as const;
export type ConflitoIntencaoCM = (typeof CONFLITOS_INTENCAO_CM)[number];
export const MENSAGEM_INTENCAO_MUDOU = 'O contexto comercial mudou desde a fila. Reabra a Hoje para recalcular o plano antes de gerar a abordagem.';
export const TEXTO_CONFLITO_INTENCAO_CM: Readonly<Record<ConflitoIntencaoCM, string>> = {
  VERSAO_REGRAS_MUDOU: 'as regras da Máquina Comercial mudaram de versão',
  FORA_DA_FILA: 'a conta não está mais na fila (inativa, mesclada, não contatar ou sem relevância)',
  ACAO_MUDOU: 'a ação principal da conta mudou',
  MODO_NAO_E_CONTATO: 'o plano atual não é mais de contato (revisar, enriquecer, ação interna ou aguardar)',
  ORIGEM_MUDOU: 'a origem da abordagem mudou (seleção atual × abordagem aprovada)',
  CONTATO_MUDOU: 'o contato do plano mudou',
  OBJETIVO_MUDOU: 'o objetivo do plano mudou',
  PLAYBOOK_MUDOU: 'o playbook do plano mudou',
  CANAL_NAO_PERMITIDO: 'o canal pedido não está entre os canais válidos do plano',
  ARTEFATO_APROVADO: 'já existe abordagem aprovada para esta ação: reutilize-a, não gere outra',
};

/** Intencao transportavel de um plano CONTATO (e so dele). */
export function intencaoDoPlanoCM(plano: CommercialActionPlan): IntencaoComunicacaoCM | undefined {
  if (plano.modo !== 'CONTATO' || !plano.contato || !plano.comunicacao) return undefined;
  return {
    origem: plano.comunicacao.origem, empresaId: plano.empresaId, itemId: plano.itemId, contatoId: plano.contato.id,
    objetivo: plano.comunicacao.objetivo, playbook: plano.comunicacao.playbook, canal: plano.comunicacao.canal, comunicacaoId: plano.comunicacao.comunicacaoId,
    acaoCodigo: plano.acaoCodigo, referencia: plano.referencia, versaoRegrasFila: plano.versaoRegrasFila, versaoRegrasPlano: plano.versaoPlano,
  };
}

const texto = (v: unknown, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** Formato estrito (chaves e catalogos fechados). Nao prova nada sobre o contexto: isso e papel de resolverIntencaoCM. */
export function validarFormatoIntencaoCM(x: unknown): { ok: true; intencao: IntencaoComunicacaoCM } | { ok: false; erros: string[] } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, erros: ['intenção comercial inválida'] };
  const b = x as Record<string, unknown>;
  const erros: string[] = [];
  const extras = Object.keys(b).filter((k) => !(CAMPOS_INTENCAO_CM as readonly string[]).includes(k));
  if (extras.length) erros.push(`intenção comercial com campos não permitidos: ${extras.slice(0, 6).join(', ')}`);
  if (b.origem !== 'SELECAO_ATUAL' && b.origem !== 'ARTEFATO_APROVADO') erros.push('origem da intenção inválida');
  for (const k of ['empresaId', 'contatoId', 'versaoRegrasFila', 'versaoRegrasPlano'] as const) if (!texto(b[k], 80)) erros.push(`${k} da intenção inválido`);
  if (!texto(b.itemId, 400)) erros.push('itemId da intenção inválido');
  if (!(OBJETIVOS_COMUNICACAO as readonly string[]).includes(String(b.objetivo))) erros.push('objetivo fora do catálogo');
  if (!(PLAYBOOKS_CODIGOS as readonly string[]).includes(String(b.playbook))) erros.push('playbook fora do catálogo');
  if (!(CANAIS as readonly string[]).includes(String(b.canal))) erros.push('canal fora do catálogo');
  if (!(CODIGOS_RAZAO_CM as readonly string[]).includes(String(b.acaoCodigo))) erros.push('ação de origem fora do catálogo');
  if (b.comunicacaoId !== undefined && !texto(b.comunicacaoId, 80)) erros.push('comunicacaoId da intenção inválido');
  if (b.referencia !== undefined) {
    const ref = b.referencia as Record<string, unknown> | null;
    if (!ref || typeof ref !== 'object' || Object.keys(ref).some((k) => k !== 'tipo' && k !== 'id') || !TIPOS_REFERENCIA.includes(ref.tipo as TipoReferenciaCM) || !texto(ref.id, 80)) erros.push('referência da intenção inválida');
  }
  if (erros.length) return { ok: false, erros };
  return { ok: true, intencao: b as unknown as IntencaoComunicacaoCM };
}

export type ResolucaoIntencaoCM = { ok: true; item: CommercialQueueItem; plano: CommercialActionPlan; canal: Canal } | { ok: false; conflito: ConflitoIntencaoCM };
/**
 * Recalcula a fila e o plano sobre o dataset recebido e exige que a intencao continue sendo a decisao atual.
 * `paraGeracao`: abordagem aprovada nunca gera outra. `canal`: canal pedido, que precisa estar entre os do plano.
 */
export function resolverIntencaoCM(r: RadarDataset, hoje: string, intencao: IntencaoComunicacaoCM, opts: { canal?: Canal; paraGeracao: boolean }): ResolucaoIntencaoCM {
  const falha = (conflito: ConflitoIntencaoCM): ResolucaoIntencaoCM => ({ ok: false, conflito });
  if (intencao.versaoRegrasFila !== VERSAO_REGRAS_CM || intencao.versaoRegrasPlano !== VERSAO_REGRAS_PLANO_CM) return falha('VERSAO_REGRAS_MUDOU');
  const item = construirCommercialQueue(r, hoje).itens.find((i) => i.empresaId === intencao.empresaId);
  if (!item) return falha('FORA_DA_FILA');
  if (itemIdCM(item) !== intencao.itemId || item.porQueAgora.codigo !== intencao.acaoCodigo) return falha('ACAO_MUDOU');
  const plano = planoDeAcaoCM(r, item);
  if (plano.modo !== 'CONTATO' || !plano.contato || !plano.comunicacao) return falha('MODO_NAO_E_CONTATO');
  if (plano.comunicacao.origem !== intencao.origem || plano.comunicacao.comunicacaoId !== intencao.comunicacaoId) return falha('ORIGEM_MUDOU');
  if (plano.contato.id !== intencao.contatoId) return falha('CONTATO_MUDOU');
  if (plano.comunicacao.objetivo !== intencao.objetivo) return falha('OBJETIVO_MUDOU');
  if (plano.comunicacao.playbook !== intencao.playbook) return falha('PLAYBOOK_MUDOU');
  const canaisPlano = [plano.comunicacao.canal, ...plano.comunicacao.canaisAlternativos];
  const canal = opts.canal ?? intencao.canal;
  if (!canaisPlano.includes(intencao.canal) || !canaisPlano.includes(canal)) return falha('CANAL_NAO_PERMITIDO');
  if (opts.paraGeracao && plano.comunicacao.origem === 'ARTEFATO_APROVADO') return falha('ARTEFATO_APROVADO');
  return { ok: true, item, plano, canal };
}

/**
 * Contexto de comunicacao a partir da intencao ja resolvida: objetivo e playbook do plano (sem selecionarPlaybook), sinal
 * e estrategia do plano (sem sinalPrincipal nem recomendarAcao), canal restrito aos canais validos do plano. Fatos, claims,
 * indicacao e alegacoes proibidas continuam vindo das regras existentes de buildCommunicationContext.
 */
export function contextoComunicacaoCM(r: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, hoje: string, opts: { canal: Canal; citarIndicacao?: boolean }): ContextoComunicacao {
  const e = r.empresas.find((x) => x.id === item.empresaId);
  const contato = r.contatos.find((c) => c.id === plano.contato?.id);
  if (!e || !contato || !plano.contato || !plano.comunicacao) throw new Error('commercial_intent_contexto_incompleto');
  const oportunidade = item.oportunidadeId ? r.oportunidades.find((o) => o.id === item.oportunidadeId && o.empresaId === e.id && estagioAtivo(o.estagio)) : undefined;
  const sinal = item.sinalId ? r.sinais.find((s) => s.id === item.sinalId && s.empresaId === e.id) : undefined;
  const estrategia = plano.comunicacao.estrategiaId ? r.estrategias.find((s) => s.id === plano.comunicacao!.estrategiaId) : undefined;
  const ctx = buildCommunicationContext({
    empresa: e, contato, persona: plano.contato.persona, decisionFit: plano.contato.fit, sinal, estagioOportunidade: oportunidade?.estagio, estrategia,
    atividades: r.atividades, contatos: r.contatos, fontes: r.fontes, fitIdeal: fitIdealDe(r), hoje, citarIndicacao: opts.citarIndicacao,
    intencao: { objetivo: plano.comunicacao.objetivo, playbook: plano.comunicacao.playbook, motivo: plano.comunicacao.motivoSelecao },
  });
  const canais = [plano.comunicacao.canal, ...plano.comunicacao.canaisAlternativos];
  return { ...ctx, canal: { primario: opts.canal, secundario: canais.find((c) => c !== opts.canal), motivo: plano.comunicacao.motivoCanal, disponiveis: canais } };
}

/** Metadados de origem gravados no conteudo gerado (sem PII): permitem revalidar uma edicao pela mesma autoridade. */
export interface OrigemComercialCM { itemId: string; acaoCodigo: CodigoRazaoCM; versaoRegrasFila: string; versaoRegrasPlano: string }
export const origemComercialDe = (i: IntencaoComunicacaoCM): OrigemComercialCM => ({ itemId: i.itemId, acaoCodigo: i.acaoCodigo, versaoRegrasFila: i.versaoRegrasFila, versaoRegrasPlano: i.versaoRegrasPlano });

export type ValidadeRascunhoCM = { ok: true; ctx: ContextoComunicacao } | { ok: false; motivo: string };
/**
 * Revalidacao de um rascunho que nasceu da Maquina Comercial (aprovacao com edicao): a decisao e a do proprio rascunho
 * (objetivo/playbook/canal gravados pelo servidor), e o que se confere e se ela CONTINUA valida — empresa nao suprimida,
 * contato elegivel da empresa, canal ainda acionavel. A fila atual nao manda aqui (o rascunho ja a mudou para REVISAR).
 */
export function contextoDeRascunhoCM(r: RadarDataset, rascunho: { empresaId: string; contatoId: string; objetivo: string; playbook: string; canal: Canal; sinalId?: string; estrategiaId?: string }, hoje: string, opts: { citarIndicacao?: boolean }): ValidadeRascunhoCM {
  const e = r.empresas.find((x) => x.id === rascunho.empresaId);
  const contato = r.contatos.find((c) => c.id === rascunho.contatoId);
  if (!e || !e.ativo || e.mescladaEm || empresaSuprimida(e.id, r)) return { ok: false, motivo: 'empresa fora da fila ou marcada como não contatar' };
  if (!contato || contato.empresaId !== e.id || !contatoElegivel(contato, r.supressoes)) return { ok: false, motivo: 'contato não elegível' };
  if (!canaisAcionaveisCM(contato, r.supressoes).includes(rascunho.canal)) return { ok: false, motivo: 'canal não é mais acionável' };
  if (!(OBJETIVOS_COMUNICACAO as readonly string[]).includes(rascunho.objetivo) || !(PLAYBOOKS_CODIGOS as readonly string[]).includes(rascunho.playbook)) return { ok: false, motivo: 'objetivo ou playbook fora do catálogo' };
  const oportunidade = r.oportunidades.filter((o) => o.empresaId === e.id && estagioAtivo(o.estagio)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const sinal = rascunho.sinalId ? r.sinais.find((s) => s.id === rascunho.sinalId && s.empresaId === e.id) : undefined;
  const estrategia = rascunho.estrategiaId ? r.estrategias.find((s) => s.id === rascunho.estrategiaId) : undefined;
  const fit = calcularDecisionFit(contato, e, r.pesosDecisionFit, r.regrasPersona, tipoProjetoPrincipal(e.id, r.projetos));
  const ctx = buildCommunicationContext({
    empresa: e, contato, persona: fit.persona, decisionFit: fit.score, sinal, estagioOportunidade: oportunidade?.estagio, estrategia, atividades: r.atividades, contatos: r.contatos, fontes: r.fontes, fitIdeal: fitIdealDe(r), hoje, citarIndicacao: opts.citarIndicacao,
    intencao: { objetivo: rascunho.objetivo as ObjetivoComunicacao, playbook: rascunho.playbook as PlaybookCodigo, motivo: 'abordagem gerada pela Máquina Comercial' },
  });
  return { ok: true, ctx: { ...ctx, canal: { primario: rascunho.canal, motivo: 'canal do rascunho', disponiveis: [rascunho.canal] } } };
}
