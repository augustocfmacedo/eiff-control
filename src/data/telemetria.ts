// Telemetria de uso, local e anonima por desenho: fica no navegador (localStorage), sem rede, so para calibrar o que polir.
// Guarda visitas por tela e acoes (paleta, tour, exportacoes) num anel dos ultimos 3000 eventos; resumo por tela e por dia.
export interface EventoUso { t: 'tela' | 'acao'; k: string; em: string }
const CHAVE = 'eiff-control:uso'; const LIMITE = 3000;
let memoria: EventoUso[] | null = null;
const ler = (): EventoUso[] => { if (memoria) return memoria; try { const v = JSON.parse(localStorage.getItem(CHAVE) ?? '[]'); memoria = Array.isArray(v) ? v : []; } catch { memoria = []; } return memoria; };
const gravar = (ev: EventoUso[]) => { memoria = ev.slice(-LIMITE); try { localStorage.setItem(CHAVE, JSON.stringify(memoria)); } catch { /* ignore */ } };

export function registrarVisita(rota: string, agora = new Date()) { const ev = ler(); const ult = ev[ev.length - 1]; if (ult && ult.t === 'tela' && ult.k === rota && agora.getTime() - new Date(ult.em).getTime() < 5_000) return; gravar([...ev, { t: 'tela', k: rota, em: agora.toISOString() }]); }
export function registrarAcao(nome: string, agora = new Date()) { gravar([...ler(), { t: 'acao', k: nome, em: agora.toISOString() }]); }
export function limparUso() { gravar([]); }

export interface ResumoUso { total: number; telas: { rota: string; visitas: number }[]; acoes: { nome: string; vezes: number }[]; porDia: { data: string; visitas: number }[]; desde?: string }
/** Resumo dos ultimos N dias (funcao pura sobre a lista de eventos, para teste). */
export function resumirUso(eventos: EventoUso[], dias = 30, hoje = new Date()): ResumoUso {
  const limite = new Date(hoje); limite.setDate(limite.getDate() - dias + 1); const de = limite.toISOString().slice(0, 10);
  const ev = eventos.filter((e) => e.em.slice(0, 10) >= de);
  const conta = (lista: EventoUso[], f: (e: EventoUso) => string) => { const m = new Map<string, number>(); for (const e of lista) m.set(f(e), (m.get(f(e)) ?? 0) + 1); return m; };
  const telas = [...conta(ev.filter((e) => e.t === 'tela'), (e) => e.k)].map(([rota, visitas]) => ({ rota, visitas })).sort((a, b) => b.visitas - a.visitas);
  const acoes = [...conta(ev.filter((e) => e.t === 'acao'), (e) => e.k)].map(([nome, vezes]) => ({ nome, vezes })).sort((a, b) => b.vezes - a.vezes);
  const porDia = Array.from({ length: dias }, (_, i) => { const d = new Date(limite); d.setDate(d.getDate() + i); const data = d.toISOString().slice(0, 10); return { data, visitas: ev.filter((e) => e.t === 'tela' && e.em.slice(0, 10) === data).length }; });
  return { total: ev.length, telas, acoes, porDia, desde: eventos[0]?.em };
}
export const resumoUso = (dias = 30) => resumirUso(ler(), dias);
