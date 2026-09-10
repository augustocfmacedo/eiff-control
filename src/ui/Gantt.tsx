// Cronograma fisico-financeiro visual da obra: Gantt dos servicos (previsto x real, com o avanco fisico dentro da barra),
// marcos de medicao na linha do tempo, "hoje" marcado e a curva S (previsto acumulado x faturado acumulado). SVG puro,
// tokens do sistema; os numeros vem do motor (obra360) e nada e recalculado aqui.
import React, { useMemo } from 'react';
import type { Obra360 } from '../core/engine';
import { LineChart } from './charts';
import { money } from './components';

const DIA = 86_400_000;
const dataN = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() : undefined);
const fmt = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function Gantt({ o, dataBase }: { o: Obra360; dataBase: string }) {
  const servicos = useMemo(() => o.servicos.filter((s) => s.ativo !== false).slice().sort((a, b) => ((a.inicioPrevisto ?? '9') < (b.inicioPrevisto ?? '9') ? -1 : 1)), [o.servicos]);
  const medicoes = o.medicoes.medicoes.filter((m) => m.dataPrevista);
  const hoje = dataN(dataBase)!;
  const datas = [dataN(o.obra.inicio), dataN(o.obra.fimContratual), hoje, ...servicos.flatMap((s) => [dataN(s.inicioPrevisto), dataN(s.fimPrevisto), dataN(s.inicioReal), dataN(s.fimReal)]), ...medicoes.map((m) => dataN(m.dataPrevista))].filter((x): x is number => x !== undefined);
  if (!datas.length || (!servicos.some((s) => s.inicioPrevisto) && !medicoes.length)) return <div className="empty">Sem datas previstas nos serviços nem marcos com data: informe início/fim previstos nos serviços para ver o cronograma.</div>;
  const ini = new Date(Math.min(...datas)); ini.setUTCDate(1);
  const fim = new Date(Math.max(...datas)); fim.setUTCMonth(fim.getUTCMonth() + 1, 1);
  const t0 = ini.getTime(); const t1 = fim.getTime(); const dias = Math.max(1, (t1 - t0) / DIA);
  const W = 960; const ESQ = 210; const ALT_LINHA = 26; const TOPO = 58; const H = TOPO + servicos.length * ALT_LINHA + 16;
  const x = (t: number) => ESQ + ((t - t0) / DIA / dias) * (W - ESQ - 12);
  const meses: { t: number; tf: number; rotulo: string }[] = [];
  for (const d = new Date(ini); d.getTime() < t1; d.setUTCMonth(d.getUTCMonth() + 1)) { const prox = new Date(d); prox.setUTCMonth(prox.getUTCMonth() + 1); meses.push({ t: d.getTime(), tf: Math.min(t1, prox.getTime()), rotulo: `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` }); }
  const corStatus = (s: (typeof servicos)[number]) => (s.status === 'Concluído' ? 'var(--ok)' : s.situacaoPrazo === 'Atrasado' ? 'var(--bad)' : s.status === 'Em andamento' ? 'var(--brand)' : 'var(--border-strong)');
  // curva S: previsto acumulado x faturado acumulado, por mes contratual (rotulo pela data prevista quando existe)
  const porMes = o.medicoes.porMes; let accP = 0; let accF = 0;
  const curva = porMes.map((m) => { accP += m.liquido; accF += m.faturado; return { rotulo: m.dataPrevista ? `${MESES[Number(m.dataPrevista.slice(5, 7)) - 1]}/${m.dataPrevista.slice(2, 4)}` : `M${m.mes}`, previsto: accP, faturado: accF, passado: !!m.dataPrevista && m.dataPrevista <= dataBase }; });
  const marcadorHoje = curva.reduce((ult, c, i) => (c.passado ? i : ult), -1);
  return (
    <div className="gantt">
      <div className="viz-legend"><span><i className="viz-swatch" style={{ background: 'var(--border-strong)' }} />previsto</span><span><i className="viz-swatch" style={{ background: 'var(--brand)' }} />em andamento / real</span><span><i className="viz-swatch" style={{ background: 'var(--ok)' }} />concluído</span><span><i className="viz-swatch" style={{ background: 'var(--bad)' }} />atrasado</span><span><i className="viz-swatch losango" />marco de medição</span></div>
      <div className="table-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720, display: 'block' }} role="img" aria-label="Cronograma físico-financeiro">
          {meses.map((m, i) => <g key={m.t}>{i % 2 === 1 && <rect x={x(m.t)} y={TOPO - 22} width={Math.max(0, x(m.tf) - x(m.t))} height={H - TOPO + 22} fill="var(--surface-2)" opacity={0.35} />}<line x1={x(m.t)} x2={x(m.t)} y1={TOPO - 22} y2={H} className="viz-grid" /><text x={x(m.t) + 4} y={TOPO - 28} className="viz-axis">{m.rotulo}</text></g>)}
          {medicoes.map((m) => { const t = dataN(m.dataPrevista)!; const cor = m.medida ? 'var(--ok)' : m.atrasada ? 'var(--bad)' : 'var(--warn)'; return <g key={m.id}><polygon points={`${x(t)},${TOPO - 18} ${x(t) + 6},${TOPO - 12} ${x(t)},${TOPO - 6} ${x(t) - 6},${TOPO - 12}`} fill={cor} /><title>{`${m.numero} · ${m.evento} · ${fmt(m.dataPrevista)} · ${money(m.valorBruto)} · ${m.status}`}</title></g>; })}
          {servicos.map((s, i) => {
            const y = TOPO + i * ALT_LINHA; const pi = dataN(s.inicioPrevisto); const pf = dataN(s.fimPrevisto); const ri = dataN(s.inicioReal); const rf = dataN(s.fimReal) ?? (ri ? hoje : undefined);
            return (
              <g key={s.id}>
                <text x={8} y={y + 16} className="viz-axis" style={{ fill: 'var(--text)' }}>{s.codigo} <tspan style={{ fill: 'var(--muted)' }}>{s.nome.length > 22 ? `${s.nome.slice(0, 21)}…` : s.nome}</tspan></text>
                {pi !== undefined && pf !== undefined && <><rect x={x(pi)} y={y + 5} width={Math.max(2, x(pf) - x(pi))} height={14} rx={3} fill="var(--surface-3)" stroke="var(--border-strong)" /><rect className="viz-cresce-h" x={x(pi)} y={y + 5} width={Math.max(0, (x(pf) - x(pi)) * Math.min(1, s.pctExecucao))} height={14} rx={3} fill={corStatus(s)} opacity={0.85} /></>}
                {ri !== undefined && rf !== undefined && <rect x={x(ri)} y={y + 20} width={Math.max(2, x(rf) - x(ri))} height={3} rx={1.5} fill="var(--brand)" />}
                <title>{`${s.codigo} ${s.nome} · ${Math.round(s.pctExecucao * 100)}% (${s.origemExecucao}) · previsto ${fmt(s.inicioPrevisto)}–${fmt(s.fimPrevisto)}${s.inicioReal ? ` · real ${fmt(s.inicioReal)}–${fmt(s.fimReal) || 'em andamento'}` : ''} · ${s.situacaoPrazo}`}</title>
              </g>
            );
          })}
          <line x1={x(hoje)} x2={x(hoje)} y1={TOPO - 24} y2={H} className="viz-hoje" /><text x={x(hoje) + 4} y={H - 4} className="viz-axis">hoje</text>
        </svg>
      </div>
      {curva.length > 1 && <div style={{ marginTop: 14 }}><LineChart titulo="Curva S financeira: previsto acumulado × faturado acumulado (líquido da construtora)" rotulos={curva.map((c) => c.rotulo)} series={[{ nome: 'Previsto acumulado', valores: curva.map((c) => c.previsto), tracejada: true }, { nome: 'Faturado acumulado', valores: curva.map((c, i) => (i <= marcadorHoje || c.faturado > 0 ? c.faturado : undefined)) }]} marcador={marcadorHoje >= 0 ? marcadorHoje : undefined} /></div>}
    </div>
  );
}
