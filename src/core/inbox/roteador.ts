// EIFF Inbox — OCTOPUS ROUTER: o cerebro de roteamento como PIPELINE EXPLICITO e auditavel. PURO (sem IO).
//
// Cada passo e uma funcao com entrada e saida claras; `decidirRoteamento` so as encadeia:
//   1. resolverIdentidade      quem fala (contato conhecido? relacao? colaborador? obra?)
//   2. resolverThread          conversa nova, reaberta ou em andamento (feito por receberMensagem; aqui vira sinal)
//   3. carregarContexto        obra, responsaveis, historico do contato (memoria operacional), setores/equipes/membros
//   4. analisarMensagem        texto normalizado, marcas de urgencia, pergunta, anexos
//   5. detectarIntencao        catalogo de palavras (deterministico) + classificacao da IA como REFINO, nunca autoridade
//   6. detectarEntidades       NF, obra, valor, data, medicao, pedido (regex; a IA acrescenta as dela)
//   7. determinarPrioridade    so sobe: urgencia no texto, tema sensivel, jurídico, SLA vencido, recomendacao da IA
//   8. selecionarSetor         regra explicita > memoria operacional > catalogo da intencao > IA > fallback
//   9. selecionarEquipe        equipe da regra > equipe do historico > unica equipe do setor > equipe do responsavel da obra
//  10. selecionarResponsavel   regra > responsavel da obra (se membro do setor) > historico > padrao da equipe > padrao do setor
//  11. decidirAutomacao        AUTO / APPROVAL / HUMAN (automacao.ts)
//  12. determinarSla           prazo de primeira resposta pela prioridade
//  13. persistir a decisao     (store / RPC) — fora daqui: o router devolve a DecisaoOctopus
//  14. aplicar a atribuicao    (store / RPC inbox_apply_routing) — fora daqui
//  15. emitir eventos          (store / RPC) — fora daqui
//
// Confianca e MODELO EXPLICITO: cada fonte de setor tem um piso, cada sinal soma ou subtrai um peso declarado, e os
// cortes da configuracao dizem o que fazer com a banda (HIGH atribui pessoa, MEDIUM so setor/equipe, LOW triagem humana
// em "Nao atribuidos"). Regra explicita sempre vence sugestao da IA. Historico e SINAL, nunca regra. Um override
// humano registrado nunca e sobrescrito por reavaliacao automatica.
import { decidirAutomacao } from './automacao';
import { maiorPrioridade, nivelMaisRestritivo, nivelPara, slaDe } from './roteamento';
import {
  bandaDe, VERSAO_OCTOPUS,
  type AplicacaoRoteamento, type BandaConfianca, type Classificacao, type ConfiguracaoInbox, type ContatoInbox, type DecisaoOctopus, type EntidadeExtraida, type Equipe, type InboxDataset,
  type InboxMessage, type InboxThread, type MembroSetor, type NivelAtendimento, type OrigemDecisao, type Prioridade, type Reavaliacao, type RegraRoteamento, type Risco, type Setor, type SinalRoteamento,
} from './tipos';

// ---------------------------------------------------------------------------
// Entrada e contexto
// ---------------------------------------------------------------------------
export interface ObraContexto { codigo: string; nome?: string; responsavelId?: string; emExecucao?: boolean }
export interface UsuarioContexto { id: string; ativo: boolean; papel?: string }
export interface EntradaRoteador {
  inbox: InboxDataset;
  thread: InboxThread;
  /** A mensagem que disparou o roteamento (ultima inbound). */
  mensagem: InboxMessage;
  obras: ObraContexto[];
  usuarios: UsuarioContexto[];
  /** Classificacao vinda da IA (opcional): REFINA a decisao deterministica, nunca a substitui. */
  classificacaoIa?: Classificacao;
  agora: string;
}

export interface Identidade {
  contato?: ContatoInbox;
  conhecido: boolean;
  colaborador: boolean;
  verificada: boolean;
  sinais: SinalRoteamento[];
}
export interface ContextoRoteamento {
  identidade: Identidade;
  obra?: ObraContexto;
  responsavelObraId?: string;
  /** Memoria operacional: conversas ANTERIORES do mesmo contato (setor, responsavel, intencao). Sinal, nao regra. */
  historico: { threadId: string; setorCodigo?: string; equipeId?: string; responsavelId?: string; intencao?: string; resolvida: boolean }[];
  mensagensRecentes: InboxMessage[];
  setoresAtivos: Setor[];
  equipesAtivas: Equipe[];
  membros: MembroSetor[];
  usuariosAtivos: Set<string>;
  config: ConfiguracaoInbox;
  novaThread: boolean;
  reaberta: boolean;
  sinais: SinalRoteamento[];
}
export interface AnaliseMensagem { texto: string; normalizado: string; urgente: boolean; pergunta: boolean; comAnexo: boolean; sinais: SinalRoteamento[] }
export interface IntencaoDetectada { intencao: string; assunto: string; confianca: number; origem: 'catalogo' | 'ia' | 'catalogo+ia' | 'indefinida'; setorSugerido?: string; risco: Risco; sinais: SinalRoteamento[] }

// ---------------------------------------------------------------------------
// Catalogo de intencoes (deterministico, em codigo; as regras de roteamento da configuracao ficam ACIMA dele)
// ---------------------------------------------------------------------------
export interface IntencaoCatalogo { intencao: string; assunto: string; palavras: string[]; setorPadrao: string; risco: Risco; prioridade?: Prioridade }
export const CATALOGO_INTENCOES: IntencaoCatalogo[] = [
  { intencao: 'juridico', assunto: 'Tema jurídico', palavras: ['notificação', 'notificacao', 'jurídico', 'juridico', 'advogad', 'processo', 'multa contratual', 'rescisão', 'rescisao', 'extrajudicial'], setorPadrao: 'JURIDICO', risco: 'ALTO', prioridade: 'Alta' },
  { intencao: 'alteracao_contratual', assunto: 'Alteração contratual', palavras: ['reajuste', 'aditivo', 'alteração contratual', 'alteracao contratual', 'renegoci', 'cláusula', 'clausula'], setorPadrao: 'JURIDICO', risco: 'ALTO', prioridade: 'Alta' },
  { intencao: 'reclamacao', assunto: 'Reclamação', palavras: ['reclama', 'insatisf', 'absurdo', 'péssimo', 'pessimo', 'não aceito', 'nao aceito', 'inaceitável', 'inaceitavel'], setorPadrao: 'POS_VENDA', risco: 'ALTO', prioridade: 'Alta' },
  { intencao: 'risco_operacional', assunto: 'Risco operacional', palavras: ['acidente', 'queda', 'incêndio', 'incendio', 'desab', 'interdit', 'embargo', 'fiscalização do trabalho', 'segurança do trabalho'], setorPadrao: 'OBRAS', risco: 'ALTO', prioridade: 'Urgente' },
  { intencao: 'consultar_pagamento', assunto: 'Pagamento de nota fiscal', palavras: ['pago', 'paga', 'liberad', 'nota fiscal', 'nf ', 'nf-', 'nfe', 'boleto', 'depósito', 'deposito', 'pix', 'transferência', 'transferencia', 'faturamento'], setorPadrao: 'FINANCEIRO', risco: 'MEDIO' },
  { intencao: 'cobranca', assunto: 'Cobrança', palavras: ['cobran', 'em atraso', 'vencid', 'atrasado', 'inadimpl', 'segunda via'], setorPadrao: 'FINANCEIRO', risco: 'MEDIO' },
  { intencao: 'aprovacao_medicao', assunto: 'Medição', palavras: ['medição', 'medicao', 'boletim de medição', 'aprovada a medição'], setorPadrao: 'FINANCEIRO', risco: 'MEDIO' },
  { intencao: 'logistica_entrega', assunto: 'Logística e entrega', palavras: ['entrega', 'carreta', 'caminhão', 'caminhao', 'descarga', 'romaneio', 'carga', 'transporte', 'frete', 'guindaste', 'munck', 'chegou', 'chegada'], setorPadrao: 'OBRAS', risco: 'MEDIO' },
  { intencao: 'prazo_obra', assunto: 'Prazo e cronograma', palavras: ['cronograma', 'prazo', 'atras', 'quando termina', 'previsão de conclusão', 'previsao de conclusao', 'montagem'], setorPadrao: 'OBRAS', risco: 'MEDIO' },
  { intencao: 'revisao_projeto', assunto: 'Projeto e engenharia', palavras: ['projeto', 'revisão', 'revisao', 'desenho', 'detalhamento', 'cálculo', 'calculo', 'art', 'rrt', 'memorial', 'r0', 'r1', 'r2'], setorPadrao: 'ENGENHARIA', risco: 'MEDIO' },
  { intencao: 'solicitar_orcamento', assunto: 'Solicitação de orçamento', palavras: ['orçamento', 'orcamento', 'proposta', 'cotação', 'cotacao', 'quanto custa', 'preço', 'preco', 'galpão', 'galpao', 'mezanino', 'estrutura metálica', 'estrutura metalica', 'm²', 'm2'], setorPadrao: 'COMERCIAL', risco: 'MEDIO' },
  { intencao: 'compra_insumo', assunto: 'Compra de insumos', palavras: ['pedido de compra', 'fornecimento', 'material', 'aço', 'aco', 'chapa', 'perfil', 'parafuso', 'tinta', 'fornecedor', 'disponibilidade', 'prazo de entrega'], setorPadrao: 'COMPRAS', risco: 'MEDIO' },
  { intencao: 'defeito_sistema', assunto: 'Defeito no EIFF Control', palavras: ['eiff control', 'sistema', 'tela', 'botão', 'botao', 'não funciona', 'nao funciona', 'erro ao', 'bug', 'exportar', 'login'], setorPadrao: 'SISTEMA', risco: 'BAIXO' },
  { intencao: 'consultar_endereco', assunto: 'Endereço', palavras: ['endereço', 'endereco', 'localização', 'localizacao', 'onde fica', 'como chegar'], setorPadrao: 'ADMINISTRATIVO', risco: 'BAIXO', prioridade: 'Baixa' },
  { intencao: 'consultar_horario', assunto: 'Horário', palavras: ['horário', 'horario', 'que horas', 'abre', 'fecha', 'funcionamento'], setorPadrao: 'ADMINISTRATIVO', risco: 'BAIXO', prioridade: 'Baixa' },
  { intencao: 'solicitar_documento', assunto: 'Documento', palavras: ['certidão', 'certidao', 'cnd', 'contrato social', 'documento', 'comprovante', 'apólice', 'apolice', 'anexo'], setorPadrao: 'ADMINISTRATIVO', risco: 'BAIXO' },
  { intencao: 'confirmar_recebimento', assunto: 'Confirmação', palavras: ['recebido', 'confirmo', 'ok, obrigado', 'ok obrigado', 'ciente', 'perfeito, obrigado'], setorPadrao: 'ADMINISTRATIVO', risco: 'BAIXO', prioridade: 'Baixa' },
  { intencao: 'apontamento_campo', assunto: 'Apontamento de campo', palavras: ['apontamento', 'diário', 'diario', 'efetivo', 'faltou', 'hora extra', 'chuva', 'parou a obra'], setorPadrao: 'OBRAS', risco: 'BAIXO' },
];
const PALAVRAS_URGENCIA = ['urgente', 'urgência', 'urgencia', 'imediat', 'hoje sem falta', 'parado', 'parada', 'emergência', 'emergencia', 'agora'];
const PESOS = {
  regraExplicita: 0.9, historicoMesmoSetor: 0.75, catalogo: 0.7, ia: 0.5, fallback: 0.3,
  contatoConhecido: 0.05, contatoComObra: 0.05, iaConcorda: 0.1, iaDiscorda: -0.15, contatoDesconhecido: -0.1, intencaoIndefinida: -0.15, historicoConfirma: 0.05, urgencia: 0,
} as const;

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const limitar = (x: number) => Math.max(0, Math.min(1, Math.round(x * 100) / 100));

// ---------------------------------------------------------------------------
// 1) identidade
// ---------------------------------------------------------------------------
export function resolverIdentidade(inbox: InboxDataset, thread: InboxThread): Identidade {
  const contato = inbox.contatos.find((c) => c.id === thread.contatoId);
  const sinais: SinalRoteamento[] = [];
  const conhecido = !!contato && contato.tipoRelacao !== 'desconhecido';
  const colaborador = !!contato && (contato.tipoRelacao === 'colaborador' || !!contato.usuarioId || !!contato.colaboradorId);
  const verificada = !!contato?.identidades.some((i) => i.verificada);
  if (contato && conhecido) sinais.push({ codigo: 'contato_conhecido', peso: PESOS.contatoConhecido, descricao: `contato conhecido: ${contato.tipoRelacao}${contato.empresaNome ? ` (${contato.empresaNome})` : ''}` });
  else sinais.push({ codigo: 'contato_desconhecido', peso: PESOS.contatoDesconhecido, descricao: 'contato não identificado' });
  if (contato?.obras.length) sinais.push({ codigo: 'contato_com_obra', peso: PESOS.contatoComObra, descricao: `ligado à obra ${contato.obras.join(', ')}` });
  if (colaborador) sinais.push({ codigo: 'colaborador', peso: 0, descricao: 'colaborador da EIFF' });
  if (verificada) sinais.push({ codigo: 'identidade_verificada', peso: 0, descricao: 'identidade verificada' });
  return { contato, conhecido, colaborador, verificada, sinais };
}

// ---------------------------------------------------------------------------
// 2+3) thread e contexto
// ---------------------------------------------------------------------------
export function carregarContexto(e: EntradaRoteador): ContextoRoteamento {
  const { inbox, thread } = e;
  const identidade = resolverIdentidade(inbox, thread);
  const codigoObra = thread.codigoObra ?? (identidade.contato?.obras.length === 1 ? identidade.contato.obras[0] : undefined);
  const obra = codigoObra ? e.obras.find((o) => o.codigo === codigoObra) : undefined;
  const usuariosAtivos = new Set(e.usuarios.filter((u) => u.ativo).map((u) => u.id));
  const responsavelObraId = obra?.responsavelId && usuariosAtivos.has(obra.responsavelId) ? obra.responsavelId : undefined;
  const historico = inbox.threads
    .filter((t) => t.id !== thread.id && t.contatoId === thread.contatoId && (t.setorCodigo || t.responsavelId))
    .sort((a, b) => b.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm)).slice(0, 5)
    .map((t) => ({ threadId: t.id, setorCodigo: t.setorCodigo, equipeId: t.equipeId, responsavelId: t.responsavelId, intencao: t.classificacao?.intencao, resolvida: t.status === 'RESOLVIDA' || t.status === 'FECHADA' }));
  const mensagensRecentes = inbox.mensagens.filter((m) => m.threadId === thread.id).sort((a, b) => a.em.localeCompare(b.em)).slice(-10);
  const inbound = mensagensRecentes.filter((m) => m.direcao === 'inbound').length;
  const sinais: SinalRoteamento[] = [...identidade.sinais];
  if (obra) sinais.push({ codigo: 'obra', peso: 0, descricao: `obra ${obra.codigo}${obra.nome ? ` · ${obra.nome}` : ''}${responsavelObraId ? ' · responsável cadastrado' : ''}` });
  if (historico.length) sinais.push({ codigo: 'historico', peso: 0, descricao: `${historico.length} conversa(s) anterior(es) do contato` });
  const novaThread = inbound <= 1 && !thread.setorCodigo;
  const reaberta = thread.resolvidaEm !== undefined && (thread.status === 'EM_ATENDIMENTO' || thread.status === 'NOVA');
  if (reaberta) sinais.push({ codigo: 'reaberta', peso: 0, descricao: 'conversa reaberta pelo contato' });
  return {
    identidade, obra, responsavelObraId, historico, mensagensRecentes,
    setoresAtivos: inbox.setores.filter((s) => s.ativo), equipesAtivas: inbox.equipes.filter((q) => q.ativo), membros: inbox.membros, usuariosAtivos, config: inbox.configuracao,
    novaThread, reaberta, sinais,
  };
}

// ---------------------------------------------------------------------------
// 4) mensagem
// ---------------------------------------------------------------------------
export function analisarMensagem(m: Pick<InboxMessage, 'texto' | 'anexos'>, assuntoThread: string): AnaliseMensagem {
  const texto = m.texto.trim() || assuntoThread;
  const normalizado = normalizar(texto);
  const urgente = PALAVRAS_URGENCIA.some((p) => normalizado.includes(normalizar(p)));
  const pergunta = /\?/.test(texto) || /^(qual|quando|como|onde|quem|pode|podem|consegue|conseguem)\b/.test(normalizado);
  const comAnexo = (m.anexos?.length ?? 0) > 0;
  const sinais: SinalRoteamento[] = [];
  if (urgente) sinais.push({ codigo: 'urgencia_no_texto', peso: PESOS.urgencia, descricao: 'texto pede urgência' });
  if (comAnexo) sinais.push({ codigo: 'anexo', peso: 0, descricao: `${m.anexos?.length} anexo(s)` });
  return { texto, normalizado, urgente, pergunta, comAnexo, sinais };
}

// ---------------------------------------------------------------------------
// 5) intencao
// ---------------------------------------------------------------------------
export function detectarIntencao(a: AnaliseMensagem, ia?: Classificacao, catalogo: IntencaoCatalogo[] = CATALOGO_INTENCOES): IntencaoDetectada {
  // pontos = quantas palavras do catalogo aparecem; empate desempata por risco ALTO e depois pela palavra mais ESPECIFICA (mais longa)
  const pontos = catalogo.map((c) => { const casadas = c.palavras.filter((p) => a.normalizado.includes(normalizar(p))); return { c, n: casadas.length, especificidade: Math.max(0, ...casadas.map((p) => p.length)) }; }).filter((x) => x.n > 0);
  pontos.sort((x, y) => y.n - x.n || (y.c.risco === 'ALTO' ? 1 : 0) - (x.c.risco === 'ALTO' ? 1 : 0) || y.especificidade - x.especificidade);
  const melhor = pontos[0];
  const sinais: SinalRoteamento[] = [];
  if (melhor) {
    const conf = limitar(0.55 + 0.1 * Math.min(melhor.n, 3) + (pontos[1] && pontos[1].n === melhor.n ? -0.15 : 0));
    sinais.push({ codigo: 'palavras_chave', peso: 0, descricao: `palavras do catálogo "${melhor.c.intencao}": ${melhor.c.palavras.filter((p) => a.normalizado.includes(normalizar(p))).slice(0, 3).join(', ')}` });
    if (pontos[1] && pontos[1].n === melhor.n) sinais.push({ codigo: 'intencao_ambigua', peso: 0, descricao: `empate com "${pontos[1].c.intencao}"` });
    if (ia) {
      const concorda = ia.intencao === melhor.c.intencao;
      sinais.push({ codigo: concorda ? 'ia_concorda' : 'ia_discorda', peso: concorda ? PESOS.iaConcorda : PESOS.iaDiscorda, descricao: concorda ? `IA concorda (${Math.round(ia.confianca * 100)}%)` : `IA sugere "${ia.intencao}" (${Math.round(ia.confianca * 100)}%)` });
      // a IA so prevalece sobre o catalogo quando o catalogo ficou ambiguo e ela esta segura
      if (!concorda && pontos[1]?.n === melhor.n && ia.confianca >= 0.8 && catalogo.some((c) => c.intencao === ia.intencao)) {
        const c = catalogo.find((x) => x.intencao === ia.intencao)!;
        return { intencao: c.intencao, assunto: ia.assunto || c.assunto, confianca: limitar(conf + 0.1), origem: 'catalogo+ia', setorSugerido: c.setorPadrao, risco: c.risco, sinais };
      }
    }
    return { intencao: melhor.c.intencao, assunto: melhor.c.assunto, confianca: ia && ia.intencao === melhor.c.intencao ? limitar(conf + 0.1) : conf, origem: ia && ia.intencao === melhor.c.intencao ? 'catalogo+ia' : 'catalogo', setorSugerido: melhor.c.setorPadrao, risco: melhor.c.risco, sinais };
  }
  if (ia && ia.intencao) {
    const c = catalogo.find((x) => x.intencao === ia.intencao);
    sinais.push({ codigo: 'intencao_da_ia', peso: 0, descricao: `intenção vinda da IA: ${ia.intencao} (${Math.round(ia.confianca * 100)}%)` });
    return { intencao: ia.intencao, assunto: ia.assunto, confianca: limitar(Math.min(ia.confianca, 0.85)), origem: 'ia', setorSugerido: c?.setorPadrao ?? ia.setorRecomendado, risco: c?.risco ?? 'MEDIO', sinais };
  }
  sinais.push({ codigo: 'intencao_indefinida', peso: PESOS.intencaoIndefinida, descricao: 'nenhuma palavra do catálogo e sem IA' });
  return { intencao: 'indefinida', assunto: a.texto.replace(/\s+/g, ' ').slice(0, 80), confianca: 0.2, origem: 'indefinida', risco: 'MEDIO', sinais };
}

// ---------------------------------------------------------------------------
// 6) entidades
// ---------------------------------------------------------------------------
export function detectarEntidades(texto: string, mensagemId: string, obras: ObraContexto[], ia?: Classificacao): EntidadeExtraida[] {
  const out: EntidadeExtraida[] = [];
  const add = (tipo: EntidadeExtraida['tipo'], valor: string) => { const v = valor.trim(); if (v && !out.some((e) => e.tipo === tipo && e.valor.toLowerCase() === v.toLowerCase())) out.push({ tipo, valor: v.slice(0, 80), mensagemId }); };
  for (const m of texto.matchAll(/\b(?:nf|nf-e|nfe|nota fiscal|nota)\s*(?:n[ºo°.]?\s*)?(\d{2,9})\b/gi)) add('nota_fiscal', `NF ${m[1]}`);
  for (const m of texto.matchAll(/\b(?:pedido|pc|oc)\s*(?:n[ºo°.]?\s*)?(\d{2,9})\b/gi)) add('pedido', `pedido ${m[1]}`);
  for (const m of texto.matchAll(/\bmedi[çc][ãa]o\s*(?:n[ºo°.]?\s*)?(\d{1,3})\b/gi)) add('medicao', `medição ${m[1]}`);
  for (const m of texto.matchAll(/R\$\s?([\d.]+(?:,\d{2})?)/g)) add('valor', `R$ ${m[1]}`);
  for (const m of texto.matchAll(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g)) add('data', m[1]);
  for (const m of texto.matchAll(/\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?\b/gi)) add('data', m[1].toLowerCase());
  for (const m of texto.matchAll(/\b(OB-[A-Z0-9-]{3,})\b/g)) add('obra', m[1]);
  const norm = normalizar(texto);
  for (const o of obras) { const chave = o.nome ? normalizar(o.nome).split(/ - | – /)[0] : ''; if (chave.length >= 6 && norm.includes(chave)) add('obra', o.codigo); }
  for (const e of ia?.entidades ?? []) add(e.tipo, e.valor);
  return out.slice(0, 12);
}

// ---------------------------------------------------------------------------
// 7) prioridade (so sobe)
// ---------------------------------------------------------------------------
export function determinarPrioridade(base: Prioridade, a: AnaliseMensagem, i: IntencaoDetectada, ctx: ContextoRoteamento, ia?: Classificacao, catalogo: IntencaoCatalogo[] = CATALOGO_INTENCOES): { prioridade: Prioridade; urgente: boolean; sinais: SinalRoteamento[] } {
  let p = base; const sinais: SinalRoteamento[] = [];
  const cat = catalogo.find((c) => c.intencao === i.intencao);
  if (cat?.prioridade) { const antes = p; p = maiorPrioridade(p, cat.prioridade); if (p !== antes) sinais.push({ codigo: 'prioridade_da_intencao', peso: 0, descricao: `intenção ${i.intencao} → ${cat.prioridade}` }); }
  if (a.urgente) { const antes = p; p = maiorPrioridade(p, 'Alta'); if (p !== antes) sinais.push({ codigo: 'prioridade_urgencia', peso: 0, descricao: 'urgência no texto → Alta' }); }
  if (i.risco === 'ALTO') { const antes = p; p = maiorPrioridade(p, 'Alta'); if (p !== antes) sinais.push({ codigo: 'prioridade_risco', peso: 0, descricao: 'tema de risco alto → Alta' }); }
  if (ctx.reaberta) { const antes = p; p = maiorPrioridade(p, 'Alta'); if (p !== antes) sinais.push({ codigo: 'prioridade_reaberta', peso: 0, descricao: 'reaberta pelo contato → Alta' }); }
  if (ia) { const antes = p; p = maiorPrioridade(p, ia.prioridadeRecomendada); if (p !== antes) sinais.push({ codigo: 'prioridade_ia', peso: 0, descricao: `IA recomenda ${ia.prioridadeRecomendada}` }); }
  return { prioridade: p, urgente: a.urgente || p === 'Urgente', sinais };
}

// ---------------------------------------------------------------------------
// 8) setor
// ---------------------------------------------------------------------------
export interface EscolhaSetor { setorCodigo?: string; regra?: RegraRoteamento; origem: 'regra' | 'historico' | 'catalogo' | 'ia' | 'fallback' | 'nenhum'; piso: number; sinais: SinalRoteamento[] }
function casaRegra(r: RegraRoteamento, i: IntencaoDetectada, a: AnaliseMensagem, ctx: ContextoRoteamento, thread: InboxThread): boolean {
  const c = r.condicao;
  if (c.contexto && c.contexto !== thread.contexto) return false;
  if (c.canais?.length && !c.canais.includes(thread.canal)) return false;
  if (c.temObra !== undefined && c.temObra !== !!ctx.obra) return false;
  if (c.intencoes?.length && !c.intencoes.includes(i.intencao)) return false;
  if (c.tiposRelacao?.length && !(ctx.identidade.contato && c.tiposRelacao.includes(ctx.identidade.contato.tipoRelacao))) return false;
  if (c.palavras?.length && !c.palavras.some((p) => a.normalizado.includes(normalizar(p)))) return false;
  return true;
}
export function selecionarSetor(i: IntencaoDetectada, a: AnaliseMensagem, ctx: ContextoRoteamento, thread: InboxThread, ia?: Classificacao): EscolhaSetor {
  const ativos = new Set(ctx.setoresAtivos.map((s) => s.codigo));
  const sinais: SinalRoteamento[] = [];
  const regras = [...ctx.config.regrasRoteamento].filter((r) => r.ativa && ativos.has(r.destino.setorCodigo)).sort((x, y) => x.ordem - y.ordem);
  const regra = regras.find((r) => casaRegra(r, i, a, ctx, thread));
  if (regra) {
    sinais.push({ codigo: 'regra_explicita', peso: 0, descricao: `regra ${regra.id}: ${regra.motivo}` });
    if (ia?.setorRecomendado && ia.setorRecomendado !== regra.destino.setorCodigo) sinais.push({ codigo: 'ia_vencida_pela_regra', peso: 0, descricao: `IA sugeria ${ia.setorRecomendado}; a regra explícita prevalece` });
    return { setorCodigo: regra.destino.setorCodigo, regra, origem: 'regra', piso: PESOS.regraExplicita, sinais };
  }
  // memoria operacional: mesma intencao em conversa anterior do contato -> mesmo setor
  const hist = ctx.historico.find((h) => h.setorCodigo && ativos.has(h.setorCodigo) && h.intencao === i.intencao && i.intencao !== 'indefinida');
  if (hist) { sinais.push({ codigo: 'historico_mesmo_setor', peso: 0, descricao: `conversa anterior ${hist.threadId} com a mesma intenção foi para ${hist.setorCodigo}` }); return { setorCodigo: hist.setorCodigo, origem: 'historico', piso: PESOS.historicoMesmoSetor, sinais }; }
  if (i.setorSugerido && ativos.has(i.setorSugerido) && i.origem !== 'ia' && i.origem !== 'indefinida') {
    sinais.push({ codigo: 'setor_do_catalogo', peso: 0, descricao: `intenção ${i.intencao} → ${i.setorSugerido}` });
    if (ia?.setorRecomendado === i.setorSugerido) sinais.push({ codigo: 'ia_confirma_setor', peso: PESOS.iaConcorda, descricao: 'IA recomenda o mesmo setor' });
    return { setorCodigo: i.setorSugerido, origem: 'catalogo', piso: PESOS.catalogo, sinais };
  }
  const daIa = ia?.setorRecomendado && ativos.has(ia.setorRecomendado) ? ia.setorRecomendado : i.origem === 'ia' && i.setorSugerido && ativos.has(i.setorSugerido) ? i.setorSugerido : undefined;
  if (daIa) { sinais.push({ codigo: 'setor_da_ia', peso: 0, descricao: `IA recomenda ${daIa} (${Math.round((ia?.confianca ?? 0.5) * 100)}%)` }); return { setorCodigo: daIa, origem: 'ia', piso: limitar(PESOS.ia + (ia?.confianca ?? 0.5) * 0.3), sinais }; }
  // historico por contato (sem intencao igual): sinal fraco, so orienta a triagem
  const ultimo = ctx.historico.find((h) => h.setorCodigo && ativos.has(h.setorCodigo));
  if (ultimo) sinais.push({ codigo: 'historico_outro_assunto', peso: 0, descricao: `última conversa do contato foi com ${ultimo.setorCodigo}` });
  if (ativos.has(ctx.config.setorFallback)) { sinais.push({ codigo: 'fallback', peso: 0, descricao: `nenhuma regra, memória ou catálogo: setor de fallback ${ctx.config.setorFallback}` }); return { setorCodigo: ctx.config.setorFallback, origem: 'fallback', piso: PESOS.fallback, sinais }; }
  return { origem: 'nenhum', piso: 0, sinais };
}

// ---------------------------------------------------------------------------
// 9) equipe e 10) responsavel (sempre dentro do contexto permitido: setor ativo, equipe do setor, pessoa ativa e membro)
// ---------------------------------------------------------------------------
export function selecionarEquipe(setorCodigo: string | undefined, escolha: EscolhaSetor, ctx: ContextoRoteamento): { equipeId?: string; sinais: SinalRoteamento[] } {
  const sinais: SinalRoteamento[] = [];
  if (!setorCodigo) return { sinais };
  const doSetor = ctx.equipesAtivas.filter((q) => q.setorCodigo === setorCodigo);
  if (!doSetor.length) return { sinais };
  const daRegra = escolha.regra?.destino.equipeId && doSetor.find((q) => q.id === escolha.regra!.destino.equipeId);
  if (daRegra) { sinais.push({ codigo: 'equipe_da_regra', peso: 0, descricao: `equipe ${daRegra.nome} (regra)` }); return { equipeId: daRegra.id, sinais }; }
  const hist = ctx.historico.find((h) => h.setorCodigo === setorCodigo && h.equipeId && doSetor.some((q) => q.id === h.equipeId));
  if (hist) { sinais.push({ codigo: 'equipe_do_historico', peso: 0, descricao: `equipe da conversa anterior ${hist.threadId}` }); return { equipeId: hist.equipeId, sinais }; }
  if (ctx.responsavelObraId) {
    const doResponsavel = doSetor.find((q) => ctx.membros.some((m) => m.usuarioId === ctx.responsavelObraId && m.setorCodigo === setorCodigo && m.equipeId === q.id) || q.responsavelPadraoId === ctx.responsavelObraId);
    if (doResponsavel) { sinais.push({ codigo: 'equipe_do_responsavel_da_obra', peso: 0, descricao: `equipe ${doResponsavel.nome} (responsável da obra)` }); return { equipeId: doResponsavel.id, sinais }; }
  }
  if (doSetor.length === 1) { sinais.push({ codigo: 'equipe_unica', peso: 0, descricao: `única equipe do setor: ${doSetor[0].nome}` }); return { equipeId: doSetor[0].id, sinais }; }
  sinais.push({ codigo: 'equipe_indefinida', peso: 0, descricao: `${doSetor.length} equipes no setor; fica com o setor` });
  return { sinais };
}

export function selecionarResponsavel(setorCodigo: string | undefined, equipeId: string | undefined, escolha: EscolhaSetor, ctx: ContextoRoteamento, ia?: Classificacao): { responsavelId?: string; sinais: SinalRoteamento[] } {
  const sinais: SinalRoteamento[] = [];
  if (!setorCodigo) return { sinais };
  const setor = ctx.setoresAtivos.find((s) => s.codigo === setorCodigo);
  const equipe = equipeId ? ctx.equipesAtivas.find((q) => q.id === equipeId) : undefined;
  const membro = (id: string) => ctx.membros.some((m) => m.usuarioId === id && m.setorCodigo === setorCodigo);
  const permitido = (id?: string) => !!id && ctx.usuariosAtivos.has(id) && (membro(id) || setor?.responsavelPadraoId === id || equipe?.responsavelPadraoId === id);
  const daRegra = escolha.regra?.destino.responsavelId;
  if (daRegra && permitido(daRegra)) { sinais.push({ codigo: 'responsavel_da_regra', peso: 0, descricao: 'responsável definido pela regra' }); return { responsavelId: daRegra, sinais }; }
  if (daRegra) sinais.push({ codigo: 'responsavel_da_regra_invalido', peso: 0, descricao: 'responsável da regra não é membro ativo do setor: ignorado' });
  if (ctx.responsavelObraId && permitido(ctx.responsavelObraId)) { sinais.push({ codigo: 'responsavel_da_obra', peso: 0, descricao: 'responsável da obra é membro do setor' }); return { responsavelId: ctx.responsavelObraId, sinais }; }
  const hist = ctx.historico.find((h) => h.setorCodigo === setorCodigo && permitido(h.responsavelId));
  if (hist) { sinais.push({ codigo: 'responsavel_do_historico', peso: 0, descricao: `quem atendeu a conversa anterior ${hist.threadId}` }); return { responsavelId: hist.responsavelId, sinais }; }
  if (ia?.responsavelRecomendadoId && permitido(ia.responsavelRecomendadoId)) { sinais.push({ codigo: 'responsavel_da_ia', peso: 0, descricao: 'IA recomendou pessoa do setor' }); return { responsavelId: ia.responsavelRecomendadoId, sinais }; }
  if (equipe?.responsavelPadraoId && permitido(equipe.responsavelPadraoId)) { sinais.push({ codigo: 'responsavel_padrao_equipe', peso: 0, descricao: `responsável padrão da equipe ${equipe.nome}` }); return { responsavelId: equipe.responsavelPadraoId, sinais }; }
  if (setor?.responsavelPadraoId && permitido(setor.responsavelPadraoId)) { sinais.push({ codigo: 'responsavel_padrao_setor', peso: 0, descricao: 'responsável padrão do setor' }); return { responsavelId: setor.responsavelPadraoId, sinais }; }
  sinais.push({ codigo: 'sem_responsavel', peso: 0, descricao: 'setor sem pessoa disponível no contexto: fica com o setor' });
  return { sinais };
}

// ---------------------------------------------------------------------------
// Confianca, banda e aplicacao
// ---------------------------------------------------------------------------
export function calcularConfianca(escolha: EscolhaSetor, i: IntencaoDetectada, sinais: SinalRoteamento[]): number {
  if (!escolha.setorCodigo) return 0;
  const soma = sinais.reduce((acc, s) => acc + s.peso, 0);
  // a confianca da intencao entra como ajuste em torno do piso da fonte do setor (regra explicita nao depende dela)
  const ajusteIntencao = escolha.origem === 'regra' ? 0 : (i.confianca - 0.6) * 0.5;
  return limitar(escolha.piso + soma + ajusteIntencao);
}
export function aplicacaoPara(banda: BandaConfianca, responsavelId: string | undefined, setorCodigo: string | undefined): AplicacaoRoteamento {
  if (!setorCodigo || banda === 'LOW') return 'TRIAGEM';
  if (banda === 'HIGH' && responsavelId) return 'ATRIBUIR_PESSOA';
  return 'ATRIBUIR_SETOR';
}
/** Caminho de escalacao (contrato; nenhum scheduler): pessoa → equipe → gestor do setor → setor → setor de escalacao. */
export function cadeiaEscalacao(setorCodigo: string | undefined, equipeId: string | undefined, responsavelId: string | undefined, ctx: Pick<ContextoRoteamento, 'membros' | 'equipesAtivas' | 'config'>): string[] {
  const out: string[] = [];
  if (responsavelId) out.push(`responsável ${responsavelId}`);
  const equipe = equipeId ? ctx.equipesAtivas.find((q) => q.id === equipeId) : undefined;
  if (equipe) out.push(`equipe ${equipe.nome}`);
  if (setorCodigo) {
    const gestores = ctx.membros.filter((m) => m.setorCodigo === setorCodigo && m.papel === 'gestor').map((m) => m.usuarioId);
    if (gestores.length) out.push(`gestor de ${setorCodigo} (${gestores.join(', ')})`);
    out.push(`setor ${setorCodigo}`);
  }
  if (ctx.config.setorEscalacao !== setorCodigo) out.push(`setor de escalação ${ctx.config.setorEscalacao}`);
  return out;
}

// ---------------------------------------------------------------------------
// A decisao (passos 1-12)
// ---------------------------------------------------------------------------
export function decidirRoteamento(e: EntradaRoteador): DecisaoOctopus {
  const ia = e.classificacaoIa;
  const ctx = carregarContexto(e);                                                  // 1-3
  const analise = analisarMensagem(e.mensagem, e.thread.assunto);                   // 4
  const intencao = detectarIntencao(analise, ia);                                   // 5
  const entidades = detectarEntidades(analise.texto, e.mensagem.id, e.obras, ia);   // 6
  const prio = determinarPrioridade(e.thread.prioridade, analise, intencao, ctx, ia);// 7
  const escolha = selecionarSetor(intencao, analise, ctx, e.thread, ia);            // 8
  const equipe = selecionarEquipe(escolha.setorCodigo, escolha, ctx);               // 9
  const resp = selecionarResponsavel(escolha.setorCodigo, equipe.equipeId, escolha, ctx, ia); // 10
  const sinais = [...ctx.sinais, ...analise.sinais, ...intencao.sinais, ...prio.sinais, ...escolha.sinais, ...equipe.sinais, ...resp.sinais];
  const confianca = calcularConfianca(escolha, intencao, sinais);
  const auto = ctx.config.autoRoteamento;
  const banda = bandaDe(confianca, auto);
  const aplicacao = aplicacaoPara(banda, resp.responsavelId, escolha.setorCodigo);
  const nivelPolitica = nivelPara(ctx.config, ia ?? classificacaoSintetica(intencao, prio.prioridade, escolha.setorCodigo, e.agora), escolha.setorCodigo ?? ctx.config.setorFallback, ctx.identidade.contato);
  const nivel: NivelAtendimento = ia?.nivelRecomendado ? nivelMaisRestritivo(nivelPolitica.nivel, ia.nivelRecomendado) : nivelPolitica.nivel;
  const automacao = decidirAutomacao({                                               // 11
    regras: ctx.config.regrasAutomacao, intencao: intencao.intencao, setorCodigo: escolha.setorCodigo, contato: ctx.identidade.contato, contexto: e.thread.contexto,
    nivel, confianca, confiancaMinima: auto.confiancaAtribuirSetor, modoPadrao: auto.automacaoPadrao, riscoBase: intencao.risco,
  });
  const slaAte = e.thread.sla?.primeiraRespostaAte ?? slaDe(ctx.config, prio.prioridade, e.thread.abertaEm); // 12
  const origem: OrigemDecisao = ia ? (escolha.origem === 'ia' ? 'IA' : 'HIBRIDO') : 'DETERMINISTICO';
  const setorNome = ctx.setoresAtivos.find((s) => s.codigo === escolha.setorCodigo)?.nome ?? escolha.setorCodigo ?? 'nenhum';
  const motivoOperacional = aplicacao === 'TRIAGEM'
    ? `confiança ${Math.round(confianca * 100)}% abaixo de ${Math.round(auto.confiancaAtribuirSetor * 100)}%: sugestão ${setorNome}, decisão humana`
    : `${escolha.sinais[0]?.descricao ?? 'sem fonte'} → ${setorNome}${resp.responsavelId && aplicacao === 'ATRIBUIR_PESSOA' ? ' · pessoa atribuída' : ''} (${Math.round(confianca * 100)}%)`;
  return {
    versao: VERSAO_OCTOPUS, em: e.agora, mensagemId: e.mensagem.id, origem,
    intencao: intencao.intencao, assunto: intencao.assunto, entidades, prioridade: prio.prioridade, urgente: prio.urgente, nivel,
    setorCodigo: escolha.setorCodigo, equipeId: equipe.equipeId, responsavelId: aplicacao === 'ATRIBUIR_PESSOA' || aplicacao === 'TRIAGEM' ? resp.responsavelId : undefined,
    aplicacao, automacao, confianca, banda, sinais: sinais.slice(0, 24), motivoOperacional: motivoOperacional.slice(0, 300), fallback: escolha.origem === 'fallback' || escolha.origem === 'nenhum', slaAte,
    escalacao: cadeiaEscalacao(escolha.setorCodigo, equipe.equipeId, aplicacao === 'ATRIBUIR_PESSOA' ? resp.responsavelId : undefined, ctx),
    override: e.thread.roteamento?.override,
  };
}
/** Classificacao minima para a politica de nivel quando nao ha IA (deterministica, provedor SEED = "sem IA"). */
function classificacaoSintetica(i: IntencaoDetectada, prioridade: Prioridade, setor: string | undefined, agora: string): Classificacao | undefined {
  if (i.origem === 'indefinida') return undefined;
  return { intencao: i.intencao, assunto: i.assunto, entidades: [], setorRecomendado: setor, prioridadeRecomendada: prioridade, nivelRecomendado: 'C', confianca: i.confianca, sinais: [], evidencias: [], provedor: 'SEED', versao: VERSAO_OCTOPUS, em: agora };
}

/** O que a decisao efetivamente aplica na thread (setor/equipe/pessoa), respeitando a banda. TRIAGEM nao aplica nada. */
export function alvoDaDecisao(d: DecisaoOctopus): { setorCodigo?: string; equipeId?: string; responsavelId?: string } | undefined {
  if (d.aplicacao === 'TRIAGEM') return undefined;
  return { setorCodigo: d.setorCodigo, equipeId: d.equipeId, responsavelId: d.aplicacao === 'ATRIBUIR_PESSOA' ? d.responsavelId : undefined };
}

// ---------------------------------------------------------------------------
// Reavaliacao (mensagem nova em conversa ja roteada) e override humano
// ---------------------------------------------------------------------------
export function reavaliar(thread: InboxThread, nova: DecisaoOctopus, auto: ConfiguracaoInbox['autoRoteamento']): Reavaliacao {
  const base = { em: nova.em, mensagemId: nova.mensagemId, setorSugerido: nova.setorCodigo, equipeSugeridaId: nova.equipeId, confianca: nova.confianca };
  if (!thread.setorCodigo) return { ...base, veredicto: 'KEEP', motivo: 'conversa ainda sem setor: roteamento normal' };
  if (!nova.setorCodigo || nova.setorCodigo === thread.setorCodigo) return { ...base, veredicto: 'KEEP', motivo: 'mesmo setor' };
  if (thread.roteamento?.override) return { ...base, veredicto: 'KEEP', motivo: `override humano de ${thread.roteamento.override.por} em ${thread.roteamento.override.em}: não sobrescrito` };
  if (nova.aplicacao === 'TRIAGEM') return { ...base, veredicto: 'KEEP', motivo: `assunto parece ${nova.setorCodigo}, mas confiança baixa: mantém` };
  if (auto.transferenciaAutomatica && nova.confianca >= auto.confiancaTransferir && !thread.responsavelId) return { ...base, veredicto: 'AUTO_TRANSFER', motivo: `assunto mudou para ${nova.setorCodigo} com ${Math.round(nova.confianca * 100)}% e ninguém atende ainda` };
  return { ...base, veredicto: 'RECOMMEND_TRANSFER', motivo: thread.responsavelId ? `assunto parece ${nova.setorCodigo}; ${thread.responsavelId} já atende — recomendar, não mover` : `assunto parece ${nova.setorCodigo} (${Math.round(nova.confianca * 100)}%): recomendar transferência` };
}

/** Resumo curto para quem recebe a conversa (handoff): quem, o que, por que aqui, o que fazer. Sem raciocinio. */
export function resumoParaHumano(d: DecisaoOctopus, contato: ContatoInbox | undefined, setorNome: string | undefined): string {
  const quem = contato ? `${contato.nome}${contato.empresaNome ? ` (${contato.empresaNome})` : ''}, ${contato.tipoRelacao.replace('_', ' ')}` : 'contato não identificado';
  const ent = d.entidades.slice(0, 3).map((x) => x.valor).join(', ');
  return `${quem} · ${d.assunto}${ent ? ` · ${ent}` : ''} · ${d.aplicacao === 'TRIAGEM' ? 'aguarda triagem' : `em ${setorNome ?? d.setorCodigo}`} porque ${d.sinais.find((s) => ['regra_explicita', 'historico_mesmo_setor', 'setor_do_catalogo', 'setor_da_ia', 'fallback'].includes(s.codigo))?.descricao ?? d.motivoOperacional} · automação ${d.automacao.modo} · prioridade ${d.prioridade}`.slice(0, 500);
}

