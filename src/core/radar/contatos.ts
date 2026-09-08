// Selecao e qualidade de decisores: persona (mapeamento configuravel cargo/departamento -> persona), decision fit
// 0-100 (matriz de pesos configuravel em tabela), qualidade de dados do contato, sugestao explicada do contato
// principal e regra de elegibilidade (nunca do_not_contact, invalido ou quem saiu da empresa).
import { normalizarDominio, semAcento } from './normalizar';
import type { Contato, Empresa, PesoDecisionFit, Persona, Projeto, RadarDataset, RegraPersona, Supressao } from './types';

export const PERSONAS: Persona[] = ['OWNER', 'CEO', 'PRESIDENT', 'COO', 'INDUSTRIAL_DIRECTOR', 'ENGINEERING_DIRECTOR', 'OPERATIONS_DIRECTOR', 'EXPANSION_DIRECTOR', 'FACILITIES', 'ENGINEERING', 'OPERATIONS', 'MANUFACTURING', 'LOGISTICS', 'SUPPLY_CHAIN', 'PROCUREMENT', 'REAL_ESTATE', 'OTHER'];
export const NOME_PERSONA: Record<Persona, string> = { OWNER: 'Proprietário/Sócio', CEO: 'CEO', PRESIDENT: 'Presidente', COO: 'COO', INDUSTRIAL_DIRECTOR: 'Diretor industrial', ENGINEERING_DIRECTOR: 'Diretor de engenharia', OPERATIONS_DIRECTOR: 'Diretor de operações', EXPANSION_DIRECTOR: 'Diretor de expansão', FACILITIES: 'Facilities', ENGINEERING: 'Engenharia', OPERATIONS: 'Operações', MANUFACTURING: 'Produção', LOGISTICS: 'Logística', SUPPLY_CHAIN: 'Supply chain', PROCUREMENT: 'Compras', REAL_ESTATE: 'Imobiliário/Patrimônio', OTHER: 'Outra' };
export type Porte = 'pequena' | 'media' | 'grande';
export const NOME_PORTE: Record<Porte, string> = { pequena: 'pequeno porte', media: 'médio porte', grande: 'grande porte' };
export type Senioridade = 'C-level' | 'Diretor' | 'Gerente' | 'Coordenador' | 'Analista' | 'Outro';

const norm = (s?: string) => semAcento((s ?? '').toLowerCase()).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Persona pelo cargo e departamento, usando as regras configuraveis (primeira que casa, por prioridade). */
export function inferirPersona(cargo: string | undefined, departamento: string | undefined, regras: RegraPersona[]): Persona {
  const texto = `${norm(cargo)} | ${norm(departamento)}`;
  for (const g of [...regras].filter((x) => x.ativo).sort((a, b) => a.prioridade - b.prioridade)) {
    const termos = g.termos.map(norm).filter(Boolean);
    if (!termos.length) continue;
    const alvo = g.campo === 'cargo' ? norm(cargo) : g.campo === 'departamento' ? norm(departamento) : texto;
    if (termos.some((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(alvo)) && (!g.excluir?.length || !g.excluir.map(norm).some((t) => alvo.includes(t)))) return g.persona;
  }
  return 'OTHER';
}

/** Senioridade pelo cargo quando nao informada. */
export function inferirSenioridade(cargo?: string, senioridade?: string): Senioridade {
  const s = norm(senioridade);
  if (s) { if (/\b(c ?level|ceo|cfo|coo|cto|presidente|socio|proprietario|dono|founder)\b/.test(s)) return 'C-level'; if (s.startsWith('diretor') || s.startsWith('director') || s === 'vp' || s.startsWith('vice')) return 'Diretor'; if (s.startsWith('gerente') || s.startsWith('manager') || s.startsWith('head')) return 'Gerente'; if (s.startsWith('coord') || s.startsWith('supervis') || s.startsWith('lider') || s.startsWith('lead')) return 'Coordenador'; if (s.startsWith('anal') || s.startsWith('assist') || s.startsWith('espec') || s.startsWith('eng')) return 'Analista'; }
  const c = norm(cargo);
  if (/\b(ceo|cfo|coo|cto|cio|presidente|president|socio|socia|proprietario|proprietaria|dono|dona|owner|founder|fundador|fundadora)\b/.test(c)) return 'C-level';
  if (/\b(diretor|diretora|director|vp|vice presidente)\b/.test(c)) return 'Diretor';
  if (/\b(gerente|manager|head|gestor)\b/.test(c)) return 'Gerente';
  if (/\b(coordenador|coordenadora|supervisor|supervisora|lider|leader|encarregado)\b/.test(c)) return 'Coordenador';
  if (/\b(analista|assistente|especialista|engenheiro|engenheira|comprador|compradora|tecnico|auxiliar|estagiario)\b/.test(c)) return 'Analista';
  return 'Outro';
}

export function porteDe(e: Pick<Empresa, 'faixaFuncionarios' | 'faixaReceita' | 'capitalSocial'>, pesos: PesoDecisionFit[] = []): Porte {
  const v = (k: string, padrao: number) => pesos.find((p) => p.chave === k)?.valor ?? padrao;
  const f = e.faixaFuncionarios ?? '';
  const n = Number((f.match(/\d+/g) ?? []).pop() ?? NaN);
  if (Number.isFinite(n)) return n <= v('porte.pequena.max', 50) ? 'pequena' : n <= v('porte.media.max', 500) ? 'media' : 'grande';
  if (e.faixaReceita) return /300|90-300|mi\+/.test(e.faixaReceita) ? 'grande' : /16-90/.test(e.faixaReceita) ? 'media' : 'pequena';
  if (e.capitalSocial) return e.capitalSocial >= 20000000 ? 'grande' : e.capitalSocial >= 1000000 ? 'media' : 'pequena';
  return 'media';
}

/** Tipo de projeto normalizado para a matriz (expansao, fabrica, galpao, cd, escritorio, retrofit, outro). */
export const tipoProjetoChave = (tipo?: string): string => { const t = norm(tipo); if (!t) return 'outro'; if (/expans|amplia/.test(t)) return 'expansao'; if (/fabric|planta|industr/.test(t)) return 'fabrica'; if (/galp|armaz|warehouse/.test(t)) return 'galpao'; if (/\bcd\b|distribui/.test(t)) return 'cd'; if (/escrit|office|sede/.test(t)) return 'escritorio'; if (/retrofit|reforma|manuten/.test(t)) return 'retrofit'; return 'outro'; };

export interface DecisionFit { score: number; razoes: string[]; persona: Persona; senioridade: Senioridade; porte: Porte }

/**
 * Decision fit 0-100: base por persona x porte da empresa (chaves persona.<PERSONA>.<porte>), bonus por senioridade
 * (senioridade.<nivel>), por departamento (departamento.<termo>) e por tipo de projeto x persona (projeto.<tipo>.<PERSONA>).
 * Todos os pesos vem de `pesosDecisionFit` (tabela); sem linha, usa 0.
 */
export function calcularDecisionFit(c: Pick<Contato, 'persona' | 'cargo' | 'departamento' | 'senioridade'>, empresa: Pick<Empresa, 'faixaFuncionarios' | 'faixaReceita' | 'capitalSocial'>, pesos: PesoDecisionFit[], regrasPersona: RegraPersona[], tipoProjeto?: string): DecisionFit {
  const v = (k: string) => pesos.find((p) => p.chave === k)?.valor;
  const persona = c.persona && c.persona !== 'OTHER' ? c.persona : inferirPersona(c.cargo, c.departamento, regrasPersona);
  const senioridade = inferirSenioridade(c.cargo, c.senioridade);
  const porte = porteDe(empresa, pesos);
  const razoes: string[] = [];
  let score = v(`persona.${persona}.${porte}`) ?? v(`persona.OTHER.${porte}`) ?? 0;
  razoes.push(`${NOME_PERSONA[persona]} em empresa de ${NOME_PORTE[porte]}`);
  const bs = v(`senioridade.${senioridade}`) ?? 0;
  if (bs) { score += bs; razoes.push(senioridade === 'C-level' ? 'nível C' : senioridade === 'Diretor' ? 'diretoria' : senioridade === 'Gerente' ? 'gerência' : senioridade.toLowerCase()); }
  const dep = norm(c.departamento);
  const linhaDep = pesos.filter((p) => p.chave.startsWith('departamento.')).find((p) => dep.includes(p.chave.slice('departamento.'.length)));
  if (linhaDep && dep) { score += linhaDep.valor; razoes.push(`área ${c.departamento}`); }
  const tp = tipoProjetoChave(tipoProjeto);
  const bp = tipoProjeto ? v(`projeto.${tp}.${persona}`) ?? 0 : 0;
  if (bp) { score += bp; razoes.push(`oportunidade de ${tp === 'expansao' ? 'expansão' : tp === 'fabrica' ? 'fábrica' : tp === 'galpao' ? 'galpão' : tp === 'cd' ? 'centro de distribuição' : tp}`); }
  if (persona === 'PROCUREMENT') razoes.push('compras entra mais tarde no processo');
  return { score: Math.max(0, Math.min(100, Math.round(score))), razoes, persona, senioridade, porte };
}

const GENERICO = /@(gmail|hotmail|outlook|yahoo|uol|bol|terra|icloud|live|globo|ig)\./i;
export const emailProfissional = (email?: string, dominioEmpresa?: string) => !!email && !GENERICO.test(email) && (!dominioEmpresa || normalizarDominio(email) === dominioEmpresa || !!normalizarDominio(email));

/** Qualidade de dados do contato 0-100 (nome completo, cargo, empresa confirmada, departamento, senioridade, e-mail profissional e status, telefone e status, LinkedIn, verificacao). */
export function calcularQualidadeContato(c: Pick<Contato, 'nome' | 'cargo' | 'departamento' | 'senioridade' | 'email' | 'statusEmail' | 'telefone' | 'celular' | 'whatsapp' | 'statusTelefone' | 'linkedin' | 'verificadoEm'>, empresa: Pick<Empresa, 'cnpj' | 'dominio'> | undefined, hoje: string): number {
  let q = 0;
  if (c.nome.trim().split(/\s+/).length >= 2) q += 10;
  if (c.cargo) q += 10;
  if (empresa && (empresa.cnpj || empresa.dominio)) q += 10;
  if (c.departamento) q += 5;
  if (c.senioridade) q += 5;
  if (c.email) { q += emailProfissional(c.email, empresa?.dominio) ? 20 : 8; if (c.statusEmail === 'valido') q += 10; else if (c.statusEmail === 'invalido' || c.statusEmail === 'devolvido') q -= 20; }
  if (c.telefone || c.celular || c.whatsapp) { q += 15; if (c.statusTelefone === 'invalido') q -= 15; }
  if (c.linkedin) q += 10;
  if (c.verificadoEm) { const dias = Math.floor((new Date(hoje).getTime() - new Date(c.verificadoEm).getTime()) / 86400000); q += dias <= 180 ? 5 : dias > 365 ? -5 : 0; }
  return Math.max(0, Math.min(100, q));
}

/** Contato elegivel para abordagem automatica: ativo, nao saiu da empresa, nao invalido, sem do_not_contact/opt_out. */
export function contatoElegivel(c: Contato, supressoes: Supressao[]): boolean {
  if (!c.ativo || (c.situacao && c.situacao !== 'ATIVO')) return false;
  return !supressoes.some((s) => (s.contatoId === c.id || (s.empresaId === c.empresaId && !s.contatoId)) && (s.tipo === 'do_not_contact' || s.tipo === 'opt_out'));
}

export const temCanal = (c: Contato) => (!!c.email && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido') || ((!!c.telefone || !!c.celular || !!c.whatsapp) && c.statusTelefone !== 'invalido');

export interface SugestaoContato { contato: Contato; fit: DecisionFit; motivo: string }

/** Melhor contato para abordar: o principal definido pelo usuario (se elegivel) ou o maior decision fit entre os elegiveis. */
export function sugerirContatoPrincipal(empresa: Empresa, contatos: Contato[], r: Pick<RadarDataset, 'supressoes' | 'pesosDecisionFit' | 'regrasPersona' | 'projetos'>, tipoProjeto?: string): SugestaoContato | undefined {
  const tp = tipoProjeto ?? tipoProjetoPrincipal(empresa.id, r.projetos);
  const elegiveis = contatos.filter((c) => c.empresaId === empresa.id && contatoElegivel(c, r.supressoes));
  if (!elegiveis.length) return undefined;
  const principal = elegiveis.find((c) => c.isPrimario);
  const avaliar = (c: Contato) => calcularDecisionFit(c, empresa, r.pesosDecisionFit, r.regrasPersona, tp);
  if (principal) { const fit = avaliar(principal); return { contato: principal, fit, motivo: 'definido como contato principal' }; }
  const melhor = elegiveis.map((c) => ({ c, fit: avaliar(c), canal: temCanal(c) ? 1 : 0 })).sort((a, b) => b.fit.score - a.fit.score || b.canal - a.canal || b.c.qualidade - a.c.qualidade)[0];
  return { contato: melhor.c, fit: melhor.fit, motivo: `maior decision fit (${melhor.fit.score})` };
}

export const tipoProjetoPrincipal = (empresaId: string, projetos: Projeto[]): string | undefined => projetos.filter((p) => p.empresaId === empresaId).sort((a, b) => (b.atualizadoEm > a.atualizadoEm ? 1 : -1))[0]?.tipo;

/** Aplica persona, senioridade, qualidade e decision fit ao contato (usado ao salvar/importar). */
export function enriquecerContato(c: Contato, empresa: Empresa | undefined, r: Pick<RadarDataset, 'pesosDecisionFit' | 'regrasPersona' | 'projetos'>, hoje: string): Contato {
  const persona = c.persona && c.persona !== 'OTHER' && c.personaManual ? c.persona : inferirPersona(c.cargo, c.departamento, r.regrasPersona);
  const senioridade = c.senioridade || (inferirSenioridade(c.cargo) !== 'Outro' ? inferirSenioridade(c.cargo) : undefined);
  const base = { ...c, persona, senioridade };
  const fit = empresa ? calcularDecisionFit(base, empresa, r.pesosDecisionFit, r.regrasPersona, tipoProjetoPrincipal(c.empresaId, r.projetos)) : undefined;
  const decisor = c.decisor || (fit ? fit.score >= 70 : false);
  return { ...base, decisor, decisionFitScore: fit?.score ?? 0, qualidade: calcularQualidadeContato(base, empresa, hoje), poderDecisao: c.poderDecisao ?? (fit ? (fit.score >= 75 ? 'Alto' : fit.score >= 45 ? 'Médio' : 'Baixo') : undefined) };
}
