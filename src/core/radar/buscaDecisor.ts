// Busca de decisor por conta (Motor Execution Pilot 01): classifica TODOS os candidatos de uma empresa (preview da
// Explorium, sem enrichment) pelo decision fit do Radar, pela adequacao funcional pedida pela EIFF e pela qualidade de
// dados disponivel, e compara o melhor com o contato atual. Puro: nada e gravado, nenhuma chamada externa.
import { calcularDecisionFit, calcularQualidadeContato, inferirPersona, sugerirContatoPrincipal, tipoProjetoPrincipal } from './contatos';
import type { Contato, Empresa, Persona, RadarDataset } from './types';
import { personaPorDepartamentoVibe, prospectParaContato, type ProspectVibe } from './vibe';

/** Prioridade funcional pedida pela EIFF (1 = melhor). Compras e cargos de topo nao vencem por senioridade: so pelo decision fit. */
export const ADEQUACAO_FUNCIONAL: Partial<Record<Persona, number>> = {
  INDUSTRIAL_DIRECTOR: 1, ENGINEERING_DIRECTOR: 2, OPERATIONS_DIRECTOR: 3, EXPANSION_DIRECTOR: 4, ENGINEERING: 5, OPERATIONS: 6, FACILITIES: 7, MANUFACTURING: 8, LOGISTICS: 9, COO: 10,
  REAL_ESTATE: 11, SUPPLY_CHAIN: 12, PROCUREMENT: 13, CEO: 14, PRESIDENT: 15, OWNER: 16, OTHER: 17,
};
/** Personas cuja funcao e diretamente ligada a engenharia/industrial/operacoes/expansao/facilities/implantacao/infraestrutura. */
export const PERSONAS_FUNCAO_DIRETA: Persona[] = ['INDUSTRIAL_DIRECTOR', 'ENGINEERING_DIRECTOR', 'OPERATIONS_DIRECTOR', 'EXPANSION_DIRECTOR', 'ENGINEERING', 'OPERATIONS', 'FACILITIES', 'MANUFACTURING', 'COO'];
/** Diferenca de decision fit considerada material quando o candidato nao chega ao fit.ideal. */
export const DELTA_MATERIAL_DECISION_FIT = 10;
export const MAX_CANDIDATOS_POR_CONTA = 10;
/** Custo (creditos) para enriquecer so o e-mail do melhor candidato. */
export const CUSTO_ENRIQUECER_MELHOR = 2;

export type RecomendacaoBusca = 'ENRICH' | 'KEEP_CURRENT' | 'RESEARCH_MORE';
export interface CandidatoDecisor extends ProspectVibe {
  nome: string; persona: Persona; senioridade?: string; fit: number; razoes: string[]; adequacao: number; funcaoDireta: boolean;
  qualidadeDados: number; jaNoRadar: boolean; contatoDisponivel: boolean; melhorQueAtual: boolean; motivoComparacao: string; recomendacao: RecomendacaoBusca;
}
export interface ResultadoBuscaDecisor {
  empresa: Empresa; candidatos: CandidatoDecisor[]; ignorados: number;
  atual?: { contato: Contato; fit: number; persona: Persona };
  melhor?: CandidatoDecisor; delta?: number; fitIdeal: number; recomendacao: RecomendacaoBusca; motivo: string; custoEnriquecerMelhor: number;
}

/** Candidato melhor que o atual: fit >= fit.ideal, ou materialmente superior com funcao diretamente ligada a obra/industria. */
export function candidatoMelhor(c: { fit: number; persona: Persona }, fitAtual: number | undefined, fitIdeal: number): { melhor: boolean; motivo: string } {
  const atual = fitAtual ?? 0;
  if (c.fit >= fitIdeal && c.fit > atual) return { melhor: true, motivo: `decision fit ${c.fit} ≥ ideal ${fitIdeal}` };
  if (c.fit >= fitIdeal && c.fit === atual) return { melhor: false, motivo: `mesmo decision fit do atual (${atual})` };
  if (c.fit - atual >= DELTA_MATERIAL_DECISION_FIT && PERSONAS_FUNCAO_DIRETA.includes(c.persona)) return { melhor: true, motivo: `+${c.fit - atual} sobre o atual (${atual}) com função direta` };
  if (c.fit - atual >= DELTA_MATERIAL_DECISION_FIT) return { melhor: false, motivo: `+${c.fit - atual} sobre o atual, mas sem função diretamente ligada à obra` };
  return { melhor: false, motivo: c.fit > atual ? `só +${c.fit - atual} sobre o atual (${atual})` : `não supera o atual (${atual})` };
}

/**
 * Classifica os candidatos de UMA empresa (ate `max`), ordenando por decision fit, adequacao funcional e qualidade de dados
 * (nunca so por senioridade). Prospects de outra empresa ou sem prospect_id valido sao ignorados.
 */
export function buscarDecisor(empresa: Empresa, candidatos: ProspectVibe[], r: Pick<RadarDataset, 'contatos' | 'supressoes' | 'pesosDecisionFit' | 'regrasPersona' | 'projetos'>, hoje: string, max = MAX_CANDIDATOS_POR_CONTA): ResultadoBuscaDecisor {
  const fitIdeal = r.pesosDecisionFit.find((p) => p.chave === 'fit.ideal')?.valor ?? 70;
  const tp = tipoProjetoPrincipal(empresa.id, r.projetos);
  const sug = sugerirContatoPrincipal(empresa, r.contatos, r, tp);
  const atual = sug ? { contato: sug.contato, fit: sug.fit.score, persona: sug.fit.persona } : undefined;
  const bid = (empresa.businessId ?? '').toLowerCase();
  const ids = new Set(r.contatos.map((c) => (c.fonteExternaId ?? '').toLowerCase()));
  let ignorados = 0;
  const lista: CandidatoDecisor[] = [];
  for (const p of candidatos) {
    const pid = (p.prospect_id ?? '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(pid) || (p.business_id && bid && p.business_id.toLowerCase() !== bid)) { ignorados++; continue; }
    const c = prospectParaContato(p, '');
    // persona: primeiro as regras do Radar sobre o titulo (mais especificas), depois o departamento da Explorium
    const porRegra = inferirPersona(c.cargo, c.departamento, r.regrasPersona);
    const persona = porRegra !== 'OTHER' ? porRegra : personaPorDepartamentoVibe(p.job_department_main);
    const df = calcularDecisionFit({ cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, persona }, empresa, r.pesosDecisionFit, r.regrasPersona, tp);
    const nome = c.nome || '(nome só após importação)';
    const qualidade = calcularQualidadeContato({ nome, cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, email: c.email, statusEmail: c.statusEmail, celular: c.celular, statusTelefone: c.statusTelefone, linkedin: c.linkedin, verificadoEm: undefined }, empresa, hoje);
    const cmp = candidatoMelhor({ fit: df.score, persona: df.persona }, atual?.fit, fitIdeal);
    const contatoDisponivel = !!(p.professional_email || p.mobile_phone);
    lista.push({ ...p, prospect_id: pid, nome, persona: df.persona, senioridade: c.senioridade, fit: df.score, razoes: df.razoes, adequacao: ADEQUACAO_FUNCIONAL[df.persona] ?? 99, funcaoDireta: PERSONAS_FUNCAO_DIRETA.includes(df.persona), qualidadeDados: qualidade, jaNoRadar: ids.has(pid), contatoDisponivel, melhorQueAtual: cmp.melhor, motivoComparacao: cmp.motivo, recomendacao: cmp.melhor ? (contatoDisponivel || ids.has(pid) ? 'KEEP_CURRENT' : 'ENRICH') : 'KEEP_CURRENT' });
  }
  const ordenados = lista.sort((a, b) => b.fit - a.fit || a.adequacao - b.adequacao || b.qualidadeDados - a.qualidadeDados || a.nome.localeCompare(b.nome)).slice(0, max);
  const melhor = ordenados[0];
  let recomendacao: RecomendacaoBusca; let motivo: string;
  if (!melhor) { recomendacao = 'RESEARCH_MORE'; motivo = 'nenhum candidato devolvido pelo preview: ampliar filtros ou pesquisar fora do pool'; }
  else if (melhor.melhorQueAtual) { recomendacao = melhor.jaNoRadar ? 'KEEP_CURRENT' : 'ENRICH'; motivo = melhor.jaNoRadar ? `${melhor.nome} já está no Radar: marcar como principal em vez de enriquecer` : `${melhor.nome} (${melhor.job_title ?? melhor.persona}) é melhor: ${melhor.motivoComparacao}`; }
  else { recomendacao = ordenados.length < 3 ? 'RESEARCH_MORE' : 'KEEP_CURRENT'; motivo = ordenados.length < 3 ? `só ${ordenados.length} candidato(s) e nenhum melhor que o atual: pesquisar mais` : `nenhum dos ${ordenados.length} candidatos supera o contato atual (${melhor.motivoComparacao})`; }
  return { empresa, candidatos: ordenados, ignorados, atual, melhor, delta: melhor && atual ? melhor.fit - atual.fit : undefined, fitIdeal, recomendacao, motivo, custoEnriquecerMelhor: melhor && recomendacao === 'ENRICH' ? CUSTO_ENRIQUECER_MELHOR : 0 };
}
