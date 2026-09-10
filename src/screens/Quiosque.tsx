// Painel de fabrica em modo quiosque (TV da fabrica): estacoes de fabricacao e canteiro com kg, horas e kg/HH do dia
// contra a meta das composicoes, totais do dia, ultimos 14 dias e relogio. Le o mesmo resumoProdutividade do Radar de
// producao; nada e calculado aqui. Atualiza sozinho quando o store muda; Esc sai. Bookmark para a TV: #/producao?quiosque=1
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ESTACOES_CANTEIRO, ESTACOES_FABRICA, META_KG_HH, resumoProdutividade } from '../core/producao';
import { somarDias } from '../core/cenarioCaixa';
import { useStore } from '../data/store';
import { Sparkline } from '../ui/charts';
import { Marca } from '../ui/icons';
import { NumeroVivo, useEntrada } from '../ui/motion';

const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
const n1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function Quiosque({ onSair, obra }: { onSair: () => void; obra?: string }) {
  const { ds } = useStore();
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSair(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onSair]);
  const hoje = agora.toISOString().slice(0, 10);
  const dia = useMemo(() => resumoProdutividade(ds, { codigoObra: obra || undefined, de: hoje, ate: hoje }), [ds, obra, hoje]);
  const quinzena = useMemo(() => resumoProdutividade(ds, { codigoObra: obra || undefined, de: somarDias(hoje, -13), ate: hoje }), [ds, obra, hoje]);
  const dias = useMemo(() => { const m = new Map(quinzena.porDia.map((d) => [d.data, d])); return Array.from({ length: 14 }, (_, i) => { const d = somarDias(hoje, i - 13); return m.get(d) ?? { data: d, fabrica: 0, canteiro: 0, horas: 0 }; }); }, [quinzena, hoje]);
  const estacoes = [...ESTACOES_FABRICA.map((e) => ({ estacao: e, linha: 'Fabricação' as const })), ...ESTACOES_CANTEIRO.map((e) => ({ estacao: e, linha: 'Montagem' as const }))].map((x) => {
    const l = dia.porEstacao.find((p) => p.chave === `${x.linha}:${x.estacao}`); const meta = META_KG_HH[x.linha];
    return { ...x, kg: l?.kg ?? 0, horas: l?.horas ?? 0, pecas: l?.pecas ?? 0, kgPorHH: l?.kgPorHH ?? 0, meta, pct: l?.horas ? (l.kgPorHH / meta) : 0 };
  });
  const raiz = useRef<HTMLDivElement>(null); useEntrada(raiz, hoje);
  const tone = (pct: number, horas: number) => (!horas ? '' : pct >= 1 ? 'pos' : pct >= 0.8 ? 'warn' : 'neg');
  return (
    <div className="quiosque no-print" role="dialog" aria-label="Painel de fábrica">
      <div className="cabeca"><Marca size={22} /><span>Fábrica e montagem{obra ? ` · ${obra}` : ' · todas as obras'} · {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span><b className="relogio">{agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b></div>
      <div className="corpo" ref={raiz}>
        <div className="totais">
          <div><div className="label">Fabricado hoje</div><div className="v"><NumeroVivo texto={kg(dia.kgFabricados)} /></div><div className="sub">{n1(dia.horasFabrica)} HH · {n1(dia.kgPorHHFabrica)} kg/HH · meta {n1(dia.metaFabrica)}</div></div>
          <div><div className="label">Expedido hoje</div><div className="v"><NumeroVivo texto={kg(dia.kgExpedidos)} /></div><div className="sub">romaneios e saídas do dia</div></div>
          <div><div className="label">Montado hoje</div><div className="v"><NumeroVivo texto={kg(dia.kgMontados)} /></div><div className="sub">{n1(dia.horasCanteiro)} HH · {n1(dia.kgPorHHCanteiro)} kg/HH · meta {n1(dia.metaCanteiro)}</div></div>
          <div className="tendencia"><div className="label">Últimos 14 dias · fábrica</div><Sparkline valores={dias.map((d) => d.fabrica)} altura={54} rotulos={dias.map((d) => d.data)} /><div className="label" style={{ marginTop: 6 }}>canteiro</div><Sparkline valores={dias.map((d) => d.canteiro)} altura={54} rotulos={dias.map((d) => d.data)} /></div>
        </div>
        <div className="estacoes">
          {estacoes.map((e) => (
            <div key={`${e.linha}:${e.estacao}`} className={`estacao ${tone(e.pct, e.horas)}`}>
              <div className="label">{e.estacao}<span className="linha">{e.linha === 'Fabricação' ? 'fábrica' : 'canteiro'}</span></div>
              <div className="v">{e.horas ? <NumeroVivo texto={`${n1(e.kgPorHH)} kg/HH`} /> : <span className="muted">sem apontamento</span>}</div>
              <div className="barra"><i style={{ width: `${Math.min(1, e.pct) * 100}%` }} /></div>
              <div className="sub">{kg(e.kg)} · {n1(e.horas)} HH · {e.pecas} pç · meta {n1(e.meta)} kg/HH{e.horas ? ` · ${Math.round(e.pct * 100)}%` : ''}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rodape"><span>Metas das composições EIFF-FAB-KG (17,5 HH/t) e EIFF-MON-KG (26 HH/t) · atualiza sozinho · Esc sai</span><button className="btn sm sair" onClick={onSair}>Sair do painel</button></div>
    </div>
  );
}
