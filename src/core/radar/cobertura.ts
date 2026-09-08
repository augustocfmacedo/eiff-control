// Cobertura de decisores: ter um contato nao significa ter o decisor ideal. Niveis por empresa a partir do melhor
// contato elegivel (decision fit) e cortes configuraveis em radar_decision_fit_weight (fit.ideal, fit.usavel).
import { NOME_PERSONA, contatoElegivel } from './contatos';
import { NOME_ESTADO_ACAO, contatoRecomendado, recomendarAcao, type EstadoAcao } from './pipeline';
import type { Contato, Empresa, Persona, RadarDataset } from './types';

export type NivelCobertura = 'IDEAL_DECISION_MAKER' | 'USABLE_CONTACT' | 'NEEDS_BETTER_DECISION_MAKER' | 'NO_CONTACT';
export const NIVEIS_COBERTURA: NivelCobertura[] = ['IDEAL_DECISION_MAKER', 'USABLE_CONTACT', 'NEEDS_BETTER_DECISION_MAKER', 'NO_CONTACT'];
export const NOME_COBERTURA: Record<NivelCobertura, string> = { IDEAL_DECISION_MAKER: 'Decisor ideal', USABLE_CONTACT: 'Contato utilizável', NEEDS_BETTER_DECISION_MAKER: 'Precisa de decisor melhor', NO_CONTACT: 'Sem contato' };

/** Cortes de decision fit (configuraveis). fit.ideal = 70 e fit.usavel = 50 sao a HIPOTESE OPERACIONAL do piloto, nao regra definitiva. */
export const cortesCobertura = (r: Pick<RadarDataset, 'pesosDecisionFit'>) => {
  const v = (k: string, d: number) => r.pesosDecisionFit.find((p) => p.chave === k)?.valor ?? d;
  return { ideal: v('fit.ideal', 70), usavel: v('fit.usavel', 50) };
};

export function coberturaEmpresa(e: Empresa, r: RadarDataset): { nivel: NivelCobertura; fit?: number; contato?: Contato; motivo: string } {
  const cortes = cortesCobertura(r);
  const sug = contatoRecomendado(e.id, r);
  if (!sug) return { nivel: 'NO_CONTACT', motivo: r.contatos.some((c) => c.empresaId === e.id && c.ativo) ? 'contatos existentes não elegíveis (não contatar/inválido/saiu)' : 'nenhum contato' };
  const fit = sug.fit.score;
  if (fit >= cortes.ideal) return { nivel: 'IDEAL_DECISION_MAKER', fit, contato: sug.contato, motivo: `decision fit ${fit} ≥ ${cortes.ideal}` };
  if (fit >= cortes.usavel) return { nivel: 'USABLE_CONTACT', fit, contato: sug.contato, motivo: `decision fit ${fit} entre ${cortes.usavel} e ${cortes.ideal - 1}: dá para abordar enquanto se busca o decisor` };
  return { nivel: 'NEEDS_BETTER_DECISION_MAKER', fit, contato: sug.contato, motivo: `decision fit ${fit} < ${cortes.usavel}` };
}

export interface LinhaCobertura { empresaId: string; empresa: string; contatoId?: string; contato?: string; cargo?: string; persona?: Persona; fit?: number; statusEmail?: string; email?: string; principal: boolean; nivel: NivelCobertura; estado: EstadoAcao; proximaAcao: string; classe: string; score: number }
export interface MetricasEmail { disponiveis: number; validos: number; catchAll: number; invalidos: number; desconhecidos: number }
export interface RelatorioCobertura {
  cortes: { ideal: number; usavel: number };
  empresas: number; comContato: number; ideal: number; usavel: number; baixo: number; semContato: number;
  fitMedio: number | null; fitMediana: number | null;
  porPersona: Record<string, number>; porSenioridade: Record<string, number>;
  qualidadeContato: Record<string, number>; qualidadeEmpresa: Record<string, number>;
  proximasAcoes: { estado: EstadoAcao; nome: string; quantidade: number }[];
  semContatoLista: { id: string; nome: string }[];
  precisamDecisorMelhor: { id: string; empresa: string; contato: string; fit: number; nivel: NivelCobertura }[];
  email: MetricasEmail;
  linhas: LinhaCobertura[];
}

const faixa = (v: number) => (v >= 70 ? '70-100 (alta)' : v >= 40 ? '40-69 (média)' : '0-39 (baixa)');
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
export const mediana = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };

/** Semantica dos e-mails: disponivel = presente; valido = status "valid"; catch-all; invalido = invalid/bounced. */
export function metricasEmail(contatos: Contato[]): MetricasEmail {
  const ativos = contatos.filter((c) => c.ativo);
  return {
    disponiveis: ativos.filter((c) => !!c.email).length,
    validos: ativos.filter((c) => !!c.email && c.statusEmail === 'valido').length,
    catchAll: ativos.filter((c) => !!c.email && c.statusEmail === 'catch_all').length,
    invalidos: ativos.filter((c) => !!c.email && (c.statusEmail === 'invalido' || c.statusEmail === 'devolvido')).length,
    desconhecidos: ativos.filter((c) => !!c.email && (!c.statusEmail || c.statusEmail === 'desconhecido')).length,
  };
}

export function relatorioCobertura(r: RadarDataset, hoje: string): RelatorioCobertura {
  const cortes = cortesCobertura(r);
  const ativas = r.empresas.filter((e) => e.ativo && !e.mescladaEm).sort((a, b) => (a.nomeFantasia ?? a.razaoSocial).localeCompare(b.nomeFantasia ?? b.razaoSocial));
  const contatosAtivos = r.contatos.filter((c) => c.ativo && ativas.some((e) => e.id === c.empresaId));
  const porPersona: Record<string, number> = {}; const porSenioridade: Record<string, number> = {}; const qualidadeContato: Record<string, number> = {}; const qualidadeEmpresa: Record<string, number> = {};
  for (const c of contatosAtivos) { inc(porPersona, c.persona ? NOME_PERSONA[c.persona] : 'sem persona'); inc(porSenioridade, c.senioridade ?? 'não informada'); inc(qualidadeContato, faixa(c.qualidade)); }
  const acoes = new Map<EstadoAcao, number>();
  const fits: number[] = []; const linhas: LinhaCobertura[] = []; const semContatoLista: RelatorioCobertura['semContatoLista'] = []; const precisamDecisorMelhor: RelatorioCobertura['precisamDecisorMelhor'] = [];
  let comContato = 0; let ideal = 0; let usavel = 0; let baixo = 0;
  for (const e of ativas) {
    inc(qualidadeEmpresa, faixa(e.dataQualityScore));
    const cob = coberturaEmpresa(e, r);
    const rec = recomendarAcao(e, r, hoje);
    acoes.set(rec.estado, (acoes.get(rec.estado) ?? 0) + 1);
    const nome = e.nomeFantasia ?? e.razaoSocial;
    if (cob.nivel === 'NO_CONTACT') semContatoLista.push({ id: e.id, nome });
    else {
      comContato++; fits.push(cob.fit!);
      if (cob.nivel === 'IDEAL_DECISION_MAKER') ideal++; else if (cob.nivel === 'USABLE_CONTACT') usavel++; else baixo++;
      if (cob.nivel !== 'IDEAL_DECISION_MAKER') precisamDecisorMelhor.push({ id: e.id, empresa: nome, contato: cob.contato!.nome, fit: cob.fit!, nivel: cob.nivel });
    }
    const c = cob.contato;
    linhas.push({ empresaId: e.id, empresa: nome, contatoId: c?.id, contato: c?.nome, cargo: c?.cargo, persona: c?.persona, fit: cob.fit, statusEmail: c?.statusEmail ?? (c?.email ? 'desconhecido' : undefined), email: c?.email, principal: !!c?.isPrimario, nivel: cob.nivel, estado: rec.estado, proximaAcao: rec.acao, classe: e.priorityClass, score: e.priorityScore });
  }
  const ordem: Record<NivelCobertura, number> = { IDEAL_DECISION_MAKER: 0, USABLE_CONTACT: 1, NEEDS_BETTER_DECISION_MAKER: 2, NO_CONTACT: 3 };
  linhas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || (b.fit ?? -1) - (a.fit ?? -1) || a.empresa.localeCompare(b.empresa));
  return {
    cortes, empresas: ativas.length, comContato, ideal, usavel, baixo, semContato: ativas.length - comContato,
    fitMedio: fits.length ? Math.round((fits.reduce((s, x) => s + x, 0) / fits.length) * 10) / 10 : null, fitMediana: mediana(fits),
    porPersona, porSenioridade, qualidadeContato, qualidadeEmpresa,
    proximasAcoes: [...acoes.entries()].map(([estado, quantidade]) => ({ estado, nome: NOME_ESTADO_ACAO[estado], quantidade })).sort((a, b) => b.quantidade - a.quantidade),
    semContatoLista, precisamDecisorMelhor: precisamDecisorMelhor.sort((a, b) => a.fit - b.fit),
    email: metricasEmail(contatosAtivos.filter((c) => contatoElegivel(c, r.supressoes) || true)),
    linhas,
  };
}
