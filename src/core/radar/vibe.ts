// Vibe Prospecting (Explorium Data API): prioridades de decisores, estimativa de creditos e conversao de prospects
// em contatos do Radar. Puro: usado pela funcao Netlify (servidor) e pela tela. A chave da API nunca passa por aqui.
import type { Contato, Empresa, Persona, RadarDataset } from './types';
import { calcularDecisionFit, inferirSenioridade, tipoProjetoPrincipal } from './contatos';

export interface PrioridadeDecisor { nome: string; filtros: Record<string, unknown> }

/** Ordem pedida pela EIFF: engenharia → direção industrial → expansão → operações → facilities → COO → proprietário → presidente → CEO → supply chain → logística → compras. */
export const PRIORIDADE_DECISORES: PrioridadeDecisor[] = [
  { nome: 'engenharia', filtros: { job_department: { values: ['engineering'] }, job_level: { values: ['director', 'manager'] } } },
  { nome: 'direção industrial', filtros: { job_title: { values: ['diretor industrial', 'industrial director', 'plant director', 'diretor de produção', 'diretor fabril'], include_related_job_titles: true } } },
  { nome: 'expansão', filtros: { job_title: { values: ['diretor de expansão', 'expansion director', 'gerente de expansão', 'head of expansion'], include_related_job_titles: true } } },
  { nome: 'operações', filtros: { job_department: { values: ['operations'] }, job_level: { values: ['director', 'manager'] } } },
  { nome: 'facilities', filtros: { job_title: { values: ['facilities', 'gerente de facilities', 'infraestrutura', 'manutenção predial'], include_related_job_titles: true } } },
  { nome: 'COO', filtros: { job_title: { values: ['COO', 'chief operating officer', 'diretor de operações'], include_related_job_titles: false } } },
  { nome: 'proprietário', filtros: { job_level: { values: ['owner', 'partner'] } } },
  { nome: 'presidente', filtros: { job_title: { values: ['presidente', 'president'], include_related_job_titles: false } } },
  { nome: 'CEO', filtros: { job_title: { values: ['CEO', 'chief executive officer', 'diretor geral'], include_related_job_titles: false } } },
  { nome: 'supply chain', filtros: { job_title: { values: ['supply chain'], include_related_job_titles: true } } },
  { nome: 'logística', filtros: { job_title: { values: ['logística', 'logistics'], include_related_job_titles: true } } },
  { nome: 'compras e suprimentos', filtros: { job_title: { values: ['compras', 'suprimentos', 'procurement', 'purchasing'], include_related_job_titles: true } } },
];

/** Custos documentados pela Explorium (creditos por registro). AgentSource v2 limita page_size a 100. */
export const CUSTO_VIBE = { match: 1, buscaFull: 1, email: 2, telefone: 5, perfil: 1 } as const;
export const PAGE_SIZE_MAX_VIBE = 100;
export const LOTE_ENRIQUECIMENTO_VIBE = 50;
export const BUDGET_PADRAO_VIBE = 180;
export const RESERVA_PADRAO_VIBE = 20;
export const tamanhoPaginaVibe = (desejado: number) => Math.max(1, Math.min(PAGE_SIZE_MAX_VIBE, Math.floor(desejado || 1)));

/** Estimativa (nao e valor exato): descoberta (provavel e maxima com paginacao), e-mail, telefone, perfil so se pedido, reserva. */
export function estimarCreditos(opts: { empresasSemId: number; decisores: number; cobertura: number; email?: boolean; telefone?: boolean; perfil?: boolean; paginasMax?: number; reserva?: number }): { match: number; busca: number; buscaMaxima: number; email: number; telefone: number; perfil: number; subtotal: number; reserva: number; total: number; maximoProjetado: number; natureza: 'estimativa' } {
  const paginas = opts.paginasMax ?? 5;
  const busca = Math.min(opts.decisores * 2, opts.cobertura) * CUSTO_VIBE.buscaFull;
  const buscaMaxima = Math.min(opts.decisores * 2 * paginas, opts.cobertura) * CUSTO_VIBE.buscaFull;
  const match = opts.empresasSemId * CUSTO_VIBE.match;
  const email = opts.email === false ? 0 : opts.decisores * CUSTO_VIBE.email;
  const telefone = opts.telefone ? opts.decisores * (opts.email === false ? CUSTO_VIBE.telefone : CUSTO_VIBE.telefone - CUSTO_VIBE.email) : 0;
  const perfil = opts.perfil ? opts.decisores * CUSTO_VIBE.perfil : 0;
  const subtotal = match + busca + email + telefone + perfil;
  const reserva = opts.reserva ?? RESERVA_PADRAO_VIBE;
  return { match, busca, buscaMaxima, email, telefone, perfil, subtotal, reserva, total: subtotal + reserva, maximoProjetado: match + buscaMaxima + email + telefone + perfil, natureza: 'estimativa' };
}

/** Bloqueia se o custo maximo projetado puder ultrapassar min(budget, disponiveis - reserve). */
export function budgetGuardVibe(x: { custoMaximo: number; disponiveis: number; budget?: number; reserve?: number }): { ok: boolean; limite: number; motivo: string } {
  const budget = x.budget ?? BUDGET_PADRAO_VIBE; const reserve = x.reserve ?? RESERVA_PADRAO_VIBE;
  const limite = Math.min(budget, x.disponiveis - reserve);
  const ok = Number.isFinite(limite) && x.custoMaximo <= limite;
  return { ok, limite, motivo: ok ? `custo máximo projetado ${x.custoMaximo} ≤ limite ${limite}` : `custo máximo projetado ${x.custoMaximo} ultrapassa o limite ${limite} (budget ${budget}, disponíveis ${x.disponiveis}, reserva ${reserve})` };
}

/** Contrato v2 do enriquecimento: campo `prospect_id` com string ou lista de ate 50. */
export function payloadEnriquecimentoVibe(prospectIds: string[], tipos: string[] = ['email']): { prospect_id: string | string[]; parameters: { contact_types: string[] } } {
  const ids = [...new Set(prospectIds.map((p) => p.toLowerCase()).filter((p) => /^[a-f0-9]{40}$/.test(p)))];
  if (!ids.length) throw new Error('Nenhum prospect_id válido.');
  if (ids.length > LOTE_ENRIQUECIMENTO_VIBE) throw new Error(`No máximo ${LOTE_ENRIQUECIMENTO_VIBE} prospect_ids por chamada.`);
  return { prospect_id: ids.length === 1 ? ids[0] : ids, parameters: { contact_types: tipos } };
}

export interface EnriquecimentoVibe { prospect_id: string; professional_email: string | null; professional_email_status: string | null; mobile_phone: string | null }
/** Aceita prospect_id/entity_id no item ou em item.data. */
export function normalizarEnriquecimentoVibe(resposta: unknown): EnriquecimentoVibe[] {
  const r = resposta as { data?: unknown } | unknown[] | null | undefined;
  const itens = (Array.isArray(r) ? r : Array.isArray((r as { data?: unknown })?.data) ? ((r as { data: unknown[] }).data) : r ? [r] : []) as Record<string, unknown>[];
  return itens.map((item) => {
    const inner = (item?.data && typeof item.data === 'object' ? item.data : {}) as Record<string, unknown>;
    const pid = String(item?.prospect_id ?? item?.entity_id ?? inner.prospect_id ?? inner.entity_id ?? '').toLowerCase();
    const v = (k: string) => (item?.[k] ?? inner[k] ?? null) as string | null;
    return { prospect_id: pid, professional_email: v('professional_email'), professional_email_status: v('professional_email_status'), mobile_phone: v('mobile_phone') };
  }).filter((x) => /^[a-f0-9]{40}$/.test(x.prospect_id));
}

/** Prospect como devolvido por POST /v2/prospects (campos usados). */
export interface ProspectVibe {
  prospect_id: string;
  business_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_level_main?: string;
  job_department_main?: string;
  company_name?: string;
  linkedin?: string;
  linkedin_url_array?: string[];
  city?: string;
  region_name?: string;
  professional_email?: string;
  professional_email_status?: string;
  mobile_phone?: string;
  prioridade?: string;
}

export const senioridadeVibe = (nivel?: string): string | undefined => { const n = (nivel ?? '').toLowerCase(); if (!n) return undefined; if (/cxo|c-level|owner|partner|founder/.test(n)) return 'C-level'; if (/vp|director/.test(n)) return 'Diretor'; if (/manager|head/.test(n)) return 'Gerente'; if (/senior|lead/.test(n)) return 'Coordenador'; if (/entry|junior|staff|non-managerial/.test(n)) return 'Analista'; return undefined; };
export const statusEmailVibe = (s?: string): Contato['statusEmail'] => { const v = (s ?? '').toLowerCase(); if (!v) return undefined; if (v === 'valid') return 'valido'; if (v === 'catch_all') return 'catch_all'; if (v === 'invalid') return 'invalido'; return 'desconhecido'; };
export const personaPorDepartamentoVibe = (dep?: string): Persona | undefined => { const d = (dep ?? '').toLowerCase(); if (!d) return undefined; if (d.includes('engineering')) return 'ENGINEERING'; if (d.includes('operations')) return 'OPERATIONS'; if (d.includes('supply')) return 'SUPPLY_CHAIN'; if (d.includes('logist')) return 'LOGISTICS'; if (d.includes('procure') || d.includes('purchas')) return 'PROCUREMENT'; if (d.includes('manufactur') || d.includes('production')) return 'MANUFACTURING'; if (d.includes('facilit')) return 'FACILITIES'; if (d.includes('real estate')) return 'REAL_ESTATE'; return undefined; };

/** Senioridade do prospect: job_level valido da Explorium; senao, inferida do titulo pela regra do Radar (Outro -> indefinida, nunca inventada). */
export function senioridadeProspectVibe(p: Pick<ProspectVibe, 'job_level_main' | 'job_title'>): string | undefined {
  const porNivel = senioridadeVibe(p.job_level_main);
  if (porNivel) return porNivel;
  const porTitulo = inferirSenioridade(p.job_title);
  return porTitulo === 'Outro' ? undefined : porTitulo;
}

/** Campos normalizados de contato a partir de um prospect (para upsertContato). O departamento bruto da Explorium e preservado. */
export function prospectParaContato(p: ProspectVibe, hoje: string) {
  const nome = (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim();
  return {
    nome, cargo: p.job_title, departamento: p.job_department_main, senioridade: senioridadeProspectVibe(p),
    email: p.professional_email, statusEmail: statusEmailVibe(p.professional_email_status), celular: p.mobile_phone, statusTelefone: p.mobile_phone ? ('desconhecido' as const) : undefined,
    linkedin: p.linkedin ?? p.linkedin_url_array?.[0], externoId: p.prospect_id, verificadoEm: hoje,
    observacoes: p.prioridade ? `Vibe: prioridade ${p.prioridade}` : undefined,
  };
}

/**
 * DISCOVERY_POOL: classifica os candidatos do pool pelo decision fit do Radar (persona x porte, senioridade, area,
 * projeto) e escolhe no maximo uma pessoa por empresa. Empresas sem candidato ficam para os tiers especificos.
 */
export function classificarPool(candidatos: ProspectVibe[], empresasPorBusinessId: Map<string, Empresa>, r: Pick<RadarDataset, 'pesosDecisionFit' | 'regrasPersona' | 'projetos'>, max: number): { escolhidos: (ProspectVibe & { fit: number; razoes: string[] })[]; semCandidato: string[] } {
  const porEmpresa = new Map<string, (ProspectVibe & { fit: number; razoes: string[] })[]>();
  for (const p of candidatos) {
    const bid = (p.business_id ?? '').toLowerCase();
    const e = empresasPorBusinessId.get(bid);
    if (!e || !/^[a-f0-9]{40}$/i.test(p.prospect_id ?? '')) continue;
    const c = prospectParaContato(p, '');
    const df = calcularDecisionFit({ cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, persona: personaPorDepartamentoVibe(p.job_department_main) }, e, r.pesosDecisionFit, r.regrasPersona, tipoProjetoPrincipal(e.id, r.projetos));
    porEmpresa.set(bid, [...(porEmpresa.get(bid) ?? []), { ...p, business_id: bid, prioridade: 'DISCOVERY_POOL', fit: df.score, razoes: df.razoes }]);
  }
  const escolhidos = [...porEmpresa.values()].map((lista) => lista.sort((a, b) => b.fit - a.fit)[0]).sort((a, b) => b.fit - a.fit).slice(0, max);
  const comCandidato = new Set(escolhidos.map((p) => p.business_id));
  return { escolhidos, semCandidato: [...empresasPorBusinessId.keys()].filter((b) => !comCandidato.has(b)) };
}

/** Escolhe 1 decisor por empresa seguindo a ordem de prioridade; `porTier[i]` sao os prospects retornados para o tier i. */
export function escolherDecisores(porTier: ProspectVibe[][], businessIds: string[], max: number): ProspectVibe[] {
  const validos = new Set(businessIds.map((b) => b.toLowerCase()));
  const escolhidos = new Map<string, ProspectVibe>();
  porTier.forEach((lista, i) => {
    for (const p of lista) {
      const bid = (p.business_id ?? '').toLowerCase();
      if (!bid || !validos.has(bid) || escolhidos.has(bid) || escolhidos.size >= max) continue;
      escolhidos.set(bid, { ...p, business_id: bid, prioridade: PRIORIDADE_DECISORES[i]?.nome });
    }
  });
  return [...escolhidos.values()];
}
