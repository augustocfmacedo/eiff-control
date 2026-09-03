// Graficos em SVG puro seguindo as diretrizes de visualizacao: linhas de 2px, marcadores >= 8px,
// legenda sempre presente para 2+ series, rotulos diretos seletivos, tooltip por hover, eixo unico,
// cores categoricas em ordem fixa (--viz-1..4) e status reservado. Texto sempre em tokens de texto.

import React, { useMemo, useState } from 'react';
import { money } from './components';

export interface Serie {
  nome: string;
  valores: (number | undefined)[];
  tracejada?: boolean;
}

const W = 720;
const H = 260;
const PAD = { top: 16, right: 24, bottom: 34, left: 64 };

const fmtEixo = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.', ',')} mi` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} mil` : `${Math.round(v)}`);

/** Linhas acumuladas (curva S). Uma escala y; series com undefined param no ultimo ponto conhecido. */
export function LineChart({ rotulos, series, titulo, marcador }: { rotulos: string[]; series: Serie[]; titulo?: string; marcador?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...series.flatMap((s) => s.valores.filter((v): v is number => v !== undefined))), [series]);
  const n = rotulos.length;
  const x = (i: number) => PAD.left + (n > 1 ? (i * (W - PAD.left - PAD.right)) / (n - 1) : 0);
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const path = (s: Serie) => {
    let d = '';
    s.valores.forEach((v, i) => { if (v === undefined) return; d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; });
    return d;
  };
  const ultimo = (s: Serie) => { for (let i = s.valores.length - 1; i >= 0; i--) if (s.valores[i] !== undefined) return i; return -1; };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; let bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }
    setHover(best);
  };
  return (
    <div className="viz-root">
      {titulo && <h3 style={{ marginBottom: 6 }}>{titulo}</h3>}
      <div className="viz-legend">
        {series.map((s, i) => <span key={s.nome}><i className={`viz-swatch viz-c${i + 1} ${s.tracejada ? 'dash' : ''}`} />{s.nome}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={titulo ?? 'gráfico'} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', maxWidth: '100%' }}>
        {ticks.map((t) => <g key={t}><line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="viz-grid" /><text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="viz-axis">{fmtEixo(t)}</text></g>)}
        {rotulos.map((r, i) => (n <= 14 || i % Math.ceil(n / 12) === 0) && <text key={r} x={x(i)} y={H - 10} textAnchor="middle" className="viz-axis">{r}</text>)}
        {marcador !== undefined && marcador >= 0 && marcador < n && <line x1={x(marcador)} x2={x(marcador)} y1={PAD.top} y2={H - PAD.bottom} className="viz-hoje" />}
        {marcador !== undefined && marcador >= 0 && marcador < n && <text x={x(marcador) + 4} y={PAD.top + 10} className="viz-axis">hoje</text>}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="viz-crosshair" />}
        {series.map((s, si) => (
          <g key={s.nome}>
            <path d={path(s)} className={`viz-line viz-c${si + 1}`} strokeDasharray={s.tracejada ? '6 4' : undefined} />
            {ultimo(s) >= 0 && <circle cx={x(ultimo(s))} cy={y(s.valores[ultimo(s)]!)} r={5} className={`viz-dot viz-c${si + 1}`} />}
            {ultimo(s) >= 0 && <text x={Math.min(x(ultimo(s)) + 8, W - 4)} y={y(s.valores[ultimo(s)]!) + 4} className="viz-label" textAnchor={x(ultimo(s)) > W - 90 ? 'end' : 'start'} dx={x(ultimo(s)) > W - 90 ? -10 : 0}>{fmtEixo(s.valores[ultimo(s)]!)}</text>}
            {hover !== null && s.valores[hover] !== undefined && <circle cx={x(hover)} cy={y(s.valores[hover]!)} r={5} className={`viz-dot viz-c${si + 1}`} />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="viz-tooltip">
          <b>{rotulos[hover]}</b>
          {series.map((s, i) => <div key={s.nome}><i className={`viz-swatch viz-c${i + 1}`} />{s.nome}: {s.valores[hover] === undefined ? '—' : money(s.valores[hover]!)}</div>)}
        </div>
      )}
    </div>
  );
}

/** Barras horizontais divergentes em torno de zero (ex.: desvio de custo por servico). */
export function DivergingBars({ itens, titulo, formato = money }: { itens: { nome: string; valor: number; detalhe?: string }[]; titulo?: string; formato?: (v: number) => string }) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  return (
    <div className="viz-root">
      {titulo && <h3 style={{ marginBottom: 6 }}>{titulo}</h3>}
      <div className="viz-bars">
        {itens.map((i) => (
          <div key={i.nome} className="viz-bar-row" title={i.detalhe}>
            <span className="viz-bar-name">{i.nome}</span>
            <span className="viz-bar-track">
              <span className="viz-bar-zero" />
              <i className={i.valor < 0 ? 'neg' : 'pos'} style={{ width: `${(Math.abs(i.valor) / max) * 50}%`, [i.valor < 0 ? 'right' : 'left']: '50%' } as React.CSSProperties} />
            </span>
            <span className={`viz-bar-val ${i.valor > 0 ? 'neg' : ''}`}>{formato(i.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Medidor simples: valor contra meta, em barra fina com marcador. */
export function Gauge({ label, valor, meta, formato = (v: number) => `${Math.round(v * 100)}%`, maior = true }: { label: string; valor: number; meta?: number; formato?: (v: number) => string; maior?: boolean }) {
  const ok = meta === undefined ? true : maior ? valor >= meta : valor <= meta;
  const pctV = Math.max(0, Math.min(1, valor));
  return (
    <div className="viz-gauge">
      <div className="viz-gauge-head"><span>{label}</span><b className={ok ? 'pos' : 'neg'}>{formato(valor)}</b></div>
      <div className="viz-gauge-track"><i style={{ width: `${pctV * 100}%` }} className={ok ? 'ok' : 'bad'} />{meta !== undefined && <span className="viz-gauge-meta" style={{ left: `${Math.max(0, Math.min(1, meta)) * 100}%` }} title={`meta ${formato(meta)}`} />}</div>
    </div>
  );
}
