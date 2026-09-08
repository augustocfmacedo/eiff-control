// Intelligence economics: custo real da inteligencia comercial a partir do ledger radar_vibe_operation.
// Nada aqui e estimado: creditos vem do delta real registrado pela funcao Netlify; sem consumo, tudo e 0 ou "—".
import type { RadarDataset } from './types';

export interface EconomiaInteligencia {
  creditsConsumed: number; // soma dos creditos reais das operacoes SUCCEEDED
  creditsUncertain: number; // reservas de operacoes UNCERTAIN (a reconciliar; nao entram no consumido)
  companiesResearched: number; // empresas-alvo das operacoes concluidas (tentadas no match, alvo da descoberta)
  prospectsDiscovered: number; // registros pagos devolvidos pelas descobertas concluidas
  validEmails: number; // e-mails devolvidos pelos enriquecimentos concluidos
  accountsCovered: number; // empresas ativas do Radar com pelo menos um contato vindo do Vibe (prospect_id)
  creditsPerProspect: number | null; creditsPerValidEmail: number | null; creditsPerCoveredAccount: number | null;
  operacoes: { total: number; concluidas: number; falhas: number; incertas: number; abertas: number };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : 0);
const razao = (creditos: number, base: number) => (creditos > 0 && base > 0 ? Math.round((creditos / base) * 100) / 100 : null);

export function economiaInteligencia(r: Pick<RadarDataset, 'operacoesVibe' | 'contatos' | 'empresas'>): EconomiaInteligencia {
  const ops = r.operacoesVibe ?? [];
  const ok = ops.filter((o) => o.status === 'SUCCEEDED');
  const reais = (o: (typeof ops)[number]) => (o.creditosReais != null ? o.creditosReais : o.creditosAntes != null && o.creditosDepois != null ? Math.max(0, o.creditosAntes - o.creditosDepois) : 0);
  const creditsConsumed = ok.reduce((s, o) => s + reais(o), 0);
  const creditsUncertain = ops.filter((o) => o.status === 'UNCERTAIN').reduce((s, o) => s + o.creditosReservados, 0);
  const companiesResearched = ok.reduce((s, o) => s + (o.tipo === 'match' ? num(o.resumo?.tentadas) : o.tipo === 'discovery' || o.tipo === 'discovery_pool' ? num(o.resumo?.empresas_alvo) : 0), 0);
  const prospectsDiscovered = ok.filter((o) => o.tipo === 'discovery' || o.tipo === 'discovery_pool').reduce((s, o) => s + o.registrosDevolvidos, 0);
  const validEmails = ok.filter((o) => o.tipo === 'enrich_email' || o.tipo === 'enrich_phone' || o.tipo === 'test_email').reduce((s, o) => s + num(o.resumo?.com_email), 0);
  const ativas = new Set(r.empresas.filter((e) => e.ativo && !e.mescladaEm).map((e) => e.id));
  const accountsCovered = new Set(r.contatos.filter((c) => c.ativo && ativas.has(c.empresaId) && c.fonteExternaId && /^[a-f0-9]{40}$/i.test(c.fonteExternaId)).map((c) => c.empresaId)).size;
  return {
    creditsConsumed, creditsUncertain, companiesResearched, prospectsDiscovered, validEmails, accountsCovered,
    creditsPerProspect: razao(creditsConsumed, prospectsDiscovered), creditsPerValidEmail: razao(creditsConsumed, validEmails), creditsPerCoveredAccount: razao(creditsConsumed, accountsCovered),
    operacoes: { total: ops.length, concluidas: ok.length, falhas: ops.filter((o) => o.status === 'FAILED' || o.status === 'CANCELLED').length, incertas: ops.filter((o) => o.status === 'UNCERTAIN').length, abertas: ops.filter((o) => o.status === 'RESERVED' || o.status === 'RUNNING' || o.status === 'PLANNED').length },
  };
}
