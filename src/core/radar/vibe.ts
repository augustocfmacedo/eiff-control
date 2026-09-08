// Vibe Prospecting (Explorium Data API): prioridades de decisores, estimativa de creditos e conversao de prospects
// em contatos do Radar. Puro: usado pela funcao Netlify (servidor) e pela tela. A chave da API nunca passa por aqui.
import type { Contato, Persona } from './types';

export interface PrioridadeDecisor { nome: string; filtros: Record<string, unknown> }

/** Ordem pedida pela EIFF: engenharia → direção industrial → expansão → operações → facilities → COO → proprietário → presidente → CEO → supply chain → logística → compras. */
export const PRIORIDADE_DECISORES: PrioridadeDecisor[] = [
  { nome: 'engenharia', filtros: { job_department: { values: ['engineering'] }, job_level: { values: ['cxo', 'vp', 'director', 'manager'] } } },
  { nome: 'direção industrial', filtros: { job_title: { values: ['diretor industrial', 'industrial director', 'plant director', 'diretor de produção', 'diretor fabril'], include_related_job_titles: true } } },
  { nome: 'expansão', filtros: { job_title: { values: ['diretor de expansão', 'expansion director', 'gerente de expansão', 'head of expansion', 'novos negócios'], include_related_job_titles: true } } },
  { nome: 'operações', filtros: { job_department: { values: ['operations'] }, job_level: { values: ['cxo', 'vp', 'director', 'manager'] } } },
  { nome: 'facilities', filtros: { job_title: { values: ['facilities', 'gerente de facilities', 'infraestrutura', 'manutenção predial'], include_related_job_titles: true } } },
  { nome: 'COO', filtros: { job_title: { values: ['COO', 'chief operating officer', 'diretor de operações'], include_related_job_titles: false } } },
  { nome: 'proprietário', filtros: { job_level: { values: ['owner', 'partner'] } } },
  { nome: 'presidente', filtros: { job_title: { values: ['presidente', 'president'], include_related_job_titles: false } } },
  { nome: 'CEO', filtros: { job_title: { values: ['CEO', 'chief executive officer', 'diretor geral'], include_related_job_titles: false } } },
  { nome: 'supply chain', filtros: { job_title: { values: ['supply chain'], include_related_job_titles: true } } },
  { nome: 'logística', filtros: { job_title: { values: ['logística', 'logistics'], include_related_job_titles: true } } },
  { nome: 'compras e suprimentos', filtros: { job_title: { values: ['compras', 'suprimentos', 'procurement', 'purchasing'], include_related_job_titles: true } } },
];

/** Custos documentados pela Explorium (creditos por registro). */
export const CUSTO_VIBE = { match: 1, buscaFull: 1, email: 2, telefone: 5, perfil: 1 } as const;

export function estimarCreditos(opts: { empresasSemId: number; decisores: number; cobertura: number; email?: boolean; telefone?: boolean; perfil?: boolean }): { match: number; busca: number; email: number; telefone: number; perfil: number; total: number } {
  const busca = Math.min(opts.decisores * 2, opts.cobertura) * CUSTO_VIBE.buscaFull;
  const match = opts.empresasSemId * CUSTO_VIBE.match;
  const email = opts.email === false ? 0 : opts.decisores * CUSTO_VIBE.email;
  const telefone = opts.telefone ? opts.decisores * (CUSTO_VIBE.telefone - CUSTO_VIBE.email) : 0;
  const perfil = opts.perfil ? opts.decisores * CUSTO_VIBE.perfil : 0;
  return { match, busca, email, telefone, perfil, total: match + busca + email + telefone + perfil };
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

/** Campos normalizados de contato a partir de um prospect (para upsertContato). */
export function prospectParaContato(p: ProspectVibe, hoje: string) {
  const nome = (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim();
  return {
    nome, cargo: p.job_title, departamento: p.job_department_main, senioridade: senioridadeVibe(p.job_level_main),
    email: p.professional_email, statusEmail: statusEmailVibe(p.professional_email_status), celular: p.mobile_phone, statusTelefone: p.mobile_phone ? ('desconhecido' as const) : undefined,
    linkedin: p.linkedin ?? p.linkedin_url_array?.[0], externoId: p.prospect_id, verificadoEm: hoje,
    observacoes: p.prioridade ? `Vibe: prioridade ${p.prioridade}` : undefined,
  };
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
