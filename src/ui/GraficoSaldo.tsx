// Evolucao do saldo dia a dia (tela Caixa), seguindo as diretrizes de visualizacao do projeto: serie unica (o titulo da tela
// nomeia, sem legenda), linha de 2px em degrau (o saldo so muda quando ha movimento), area clara ate a base, linha tracejada
// do caixa minimo com a faixa abaixo dele marcada, rotulos diretos so em hoje / menor saldo / fim, grade recessiva, eixo unico,
// e cursor com tooltip por mouse, toque ou teclado (setas, Home, End, Esc). A tabela "Saldo previsto por dia" e a vista em tabela.
import React, { useEffect, useRef, useState } from 'react';
import { money } from './components';

export interface PontoSaldo { data: string; saldo: number; entra: number; sai: number }

const brDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmtEixo = (v: number) => {
  const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (a >= 1000) return `${s}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: a >= 100_000 ? 0 : 1 })} mil`;
  return `${s}${Math.round(a)}`;
};

/** Escala "redonda" para o eixo y: o menor passo de 1, 2, 2,5 ou 5 x 10^n que cobre [min, max] com ate `maxMarcas` marcas. */
export function marcasEixo(min: number, max: number, maxMarcas = 7): number[] {
  if (min === max) { min -= 1; max += 1; }
  const mag0 = 10 ** Math.floor(Math.log10((max - min) / maxMarcas));
  const candidatos = [1, 2, 2.5, 5, 10, 20, 25, 50].map((m) => m * mag0);
  const contar = (p: number) => Math.ceil(max / p - 1e-9) - Math.floor(min / p + 1e-9) + 1;
  const passo = candidatos.find((p) => contar(p) <= maxMarcas) ?? candidatos[candidatos.length - 1];
  const out: number[] = [];
  for (let k = Math.floor(min / passo + 1e-9); k <= Math.ceil(max / passo - 1e-9); k++) out.push(Math.round(k * passo * 100) / 100);
  return out;
}

export function GraficoSaldo({ pontos, minimo, rotuloMinimo = 'Caixa mínimo' }: { pontos: PontoSaldo[]; minimo: number; rotuloMinimo?: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(720);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    setLargura(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const n = pontos.length;
  if (!n) return null;
  const compacto = largura < 520;
  const H = compacto ? 210 : 260;
  const P = { top: 24, right: compacto ? 12 : 20, bottom: 28, left: compacto ? 50 : 64 };
  const valores = pontos.map((p) => p.saldo);
  const vMin = Math.min(0, minimo, ...valores); const vMax = Math.max(minimo, ...valores, 1);
  const folga = (vMax - vMin) * 0.06; // respiro para os rotulos acima/abaixo da linha
  const marcas = marcasEixo(vMin < 0 ? vMin - folga : vMin, vMax + folga, compacto ? 5 : 7);
  const yMin = marcas[0]; const yMax = marcas[marcas.length - 1];
  const x = (i: number) => P.left + (n > 1 ? (i * (largura - P.left - P.right)) / (n - 1) : (largura - P.left - P.right) / 2);
  const y = (v: number) => P.top + (H - P.top - P.bottom) * (1 - (v - yMin) / (yMax - yMin || 1));
  const iMenor = valores.reduce((m, v, i) => (v < valores[m] ? i : m), 0);
  let linha = `M${x(0).toFixed(1)},${y(valores[0]).toFixed(1)}`;
  for (let i = 1; i < n; i++) linha += ` H${x(i).toFixed(1)} V${y(valores[i]).toFixed(1)}`;
  const base = y(Math.max(yMin, Math.min(0, yMax)));
  const area = `${linha} V${base.toFixed(1)} H${x(0).toFixed(1)} Z`;
  const passoX = n <= 10 ? 1 : n <= 40 ? 7 : n <= 100 ? 14 : 30;
  const mostraMinimo = minimo > 0 && minimo >= yMin && minimo <= yMax;
  const yMinimo = y(minimo);

  const escolher = (px: number) => { let best = 0; let bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } } setCursor(best); };
  const mover = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); escolher(((e.clientX - r.left) / r.width) * largura); };
  const tecla = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setCursor((c) => Math.max(0, Math.min(n - 1, (c ?? -1) + (e.key === 'ArrowRight' ? 1 : -1)))); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(n - 1); }
    else if (e.key === 'Escape') setCursor(null);
  };
  const rotulo = (i: number, texto: string, acima: boolean) => {
    const ax = x(i); const ancora = ax > largura - 110 ? 'end' : ax < P.left + 70 ? 'start' : 'middle';
    return <text x={ax} y={y(valores[i]) + (acima ? -10 : 18)} textAnchor={ancora} className="viz-label viz-aparece">{texto}</text>;
  };
  const p = cursor !== null ? pontos[cursor] : null;
  const aDireita = cursor !== null && x(cursor) < largura / 2;
  const resumo = `Evolução do saldo: ${money(valores[0])} hoje, ${money(valores[n - 1])} em ${brDia(pontos[n - 1].data)}; menor saldo ${money(valores[iMenor])} em ${brDia(pontos[iMenor].data)}${minimo > 0 ? `; caixa mínimo ${money(minimo)}` : ''}. Use as setas para percorrer os dias.`;
  const sobeDepois = (i: number) => i + 1 < n && valores[i + 1] > valores[i];

  return (
    <div className="viz-root grafico-saldo" ref={caixa}>
      <svg width="100%" viewBox={`0 0 ${largura} ${H}`} role="img" aria-label={resumo} tabIndex={0}
        onPointerMove={mover} onPointerDown={mover} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setCursor(null); }}
        onKeyDown={tecla} onBlur={() => setCursor(null)} style={{ display: 'block', touchAction: 'pan-y', maxWidth: '100%', height: 'auto' }}>
        {mostraMinimo && <rect x={P.left} y={yMinimo} width={largura - P.left - P.right} height={Math.max(0, y(yMin) - yMinimo)} className="gs-zona" />}
        {marcas.map((t) => (
          <g key={t}>
            <line x1={P.left} x2={largura - P.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'gs-zero' : 'viz-grid'} />
            <text x={P.left - 8} y={y(t) + 4} textAnchor="end" className="viz-axis">{fmtEixo(t)}</text>
          </g>
        ))}
        {pontos.map((pt, i) => ((i % passoX === 0 && n - 1 - i >= passoX / 2) || i === n - 1) && (
          <text key={pt.data} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="viz-axis">{i === 0 ? 'hoje' : brDia(pt.data)}</text>
        ))}
        {mostraMinimo && <>
          <line x1={P.left} x2={largura - P.right} y1={yMinimo} y2={yMinimo} className="gs-minimo" />
          <text x={largura - P.right - 4} y={Math.abs(y(valores[n - 1]) - yMinimo) < 22 ? yMinimo + 15 : yMinimo - 6} textAnchor="end" className="gs-minimo-txt">{rotuloMinimo} {fmtEixo(minimo)}</text>
        </>}
        <path d={area} className="gs-area viz-aparece" />
        <path d={linha} className="viz-line viz-c1 viz-traco-serie" pathLength={1} />
        <circle cx={x(0)} cy={y(valores[0])} r={5} className="viz-dot viz-c1" />
        {rotulo(0, `Hoje ${fmtEixo(valores[0])}`, !(n > 1 && valores[1] > valores[0]))}
        {iMenor !== 0 && iMenor !== n - 1 && <>
          <circle cx={x(iMenor)} cy={y(valores[iMenor])} r={5} className={`viz-dot viz-aparece ${minimo > 0 && valores[iMenor] < minimo ? 'gs-ponto-ruim' : 'viz-c1'}`} />
          {rotulo(iMenor, `Menor ${fmtEixo(valores[iMenor])} · ${brDia(pontos[iMenor].data)}`, false)}
        </>}
        {n > 1 && <>
          <circle cx={x(n - 1)} cy={y(valores[n - 1])} r={5} className="viz-dot viz-c1 viz-aparece" />
          {rotulo(n - 1, fmtEixo(valores[n - 1]), !sobeDepois(n - 1))}
        </>}
        {cursor !== null && <>
          <line x1={x(cursor)} x2={x(cursor)} y1={P.top} y2={H - P.bottom} className="viz-crosshair" />
          <circle cx={x(cursor)} cy={y(valores[cursor])} r={6} className="viz-dot viz-c1" />
        </>}
      </svg>
      {p && cursor !== null && (
        <div className="viz-tooltip gs-tooltip" style={aDireita ? { left: Math.min(x(cursor) + 14, largura - 190), right: 'auto' } : { right: Math.max(largura - x(cursor) + 14, 8), left: 'auto' }}>
          <b>{SEMANA[new Date(`${p.data}T12:00:00Z`).getUTCDay()]}, {brDia(p.data)}{cursor === 0 ? ' · hoje' : ''}</b>
          <div className="gs-tt-saldo">{money(p.saldo)}</div>
          {p.entra > 0 && <div className="muted">entra {money(p.entra)}</div>}
          {p.sai > 0 && <div className="muted">sai {money(p.sai)}</div>}
          {!p.entra && !p.sai && <div className="muted">sem movimento</div>}
          {minimo > 0 && p.saldo < minimo && <div className="gs-tt-alerta">abaixo do caixa mínimo</div>}
        </div>
      )}
    </div>
  );
}
