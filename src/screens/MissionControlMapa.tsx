// Mission Control · Mapa vivo — a primeira UI do grafo de src/core/central/mapaVivo.ts (MC-LIVE-4 / MC-CONSTRUCTION-1).
//
// O modelo é autoridade: NOS, ARESTAS e o layout determinístico vêm do domínio; esta tela só desenha em SVG
// (sem dependência nova) e mostra, em cada nó, o estado que vem da fonte dele — gates (SNAPSHOT) ou itens vivos
// por responsável/fonte (LIVE, por prop). Nada aqui escreve, nada aqui infere.
import React, { useMemo, useState } from 'react';
import {
  ARESTAS, NOS, ROTULO_DOMINIO, TIPOS_ARESTA, arestasDe, arestasPara, itensDoNo, layoutDoMapa, noPorId, noRecebeItensVivos,
  type NoMapa, type TipoAresta,
} from '../core/central/mapaVivo';
import { gatePorId, prontidao, type Prontidao } from '../core/central/missionControl';
import { ROTULO_MC_STATUS, type MissionControlWorkItem } from '../core/central/workItem';
import type { RepositorioStatus } from '../core/central/githubAdapter';
import { ROTULO_CI } from '../core/central/githubAdapter';
import { Badge, type Tone } from '../ui/components';

const ROTULO_ARESTA: Record<TipoAresta, string> = { fluxo: 'fluxo (entrega para)', dependencia: 'dependência (não funciona sem)', observa: 'observa (só lê)', evidencia: 'evidência (prova o estado)' };

const temBloqueioReal = (p: Prontidao) => p.faltando.some((x) => x.situacao === 'bloqueado' && !x.porDesenho);
const toneDaProntidao = (p: Prontidao): Tone => (p.pronto ? 'ok' : temBloqueioReal(p) ? 'bad' : 'warn');

/** Estado exibido no nó: gates → prontidão (snapshot); fonte viva → contagem de itens (live); senão desenho. */
function estadoDoNo(no: NoMapa, itens: MissionControlWorkItem[] | null) {
  if (no.gates.length) {
    const p = prontidao(no.gates);
    return { classe: toneDaProntidao(p), texto: `${p.fechados}/${p.exigidos} gates`, titulo: p.conta, origem: 'snapshot' as const };
  }
  if (noRecebeItensVivos(no.id)) {
    if (!itens) return { classe: 'muted' as Tone, texto: 'sem leitura', titulo: 'Sem leitura das fontes vivas', origem: 'live' as const };
    const n = itensDoNo(no.id, itens).length;
    return { classe: (n > 0 ? 'ok' : 'muted') as Tone, texto: `${n} item(ns)`, titulo: 'Itens vivos cujo responsável ou fonte é este nó', origem: 'live' as const };
  }
  return { classe: 'muted' as Tone, texto: no.fonte ? `fonte ${no.fonte}` : 'desenho', titulo: no.fonte ? 'Fonte declarada, sem leitura nesta resposta' : 'Nó de desenho, sem estado próprio', origem: 'desenho' as const };
}

const truncar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function MapaVivo({ itens, repositorios }: { itens: MissionControlWorkItem[] | null; repositorios?: RepositorioStatus[] }) {
  const layout = useMemo(() => layoutDoMapa(), []);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const pos = useMemo(() => new Map(layout.nos.map((n) => [n.id, n])), [layout]);
  const { largNo, altNo } = layout;
  const no = selecionado ? noPorId(selecionado) : undefined;

  const caminho = (de: string, para: string): string => {
    const a = pos.get(de)!; const b = pos.get(para)!;
    const x1 = a.x + largNo; const y1 = a.y + altNo / 2;
    const x2 = b.x; const y2 = b.y + altNo / 2;
    if (x2 >= x1) { const dx = Math.max(24, (x2 - x1) / 2); return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`; }
    // aresta para trás (observa/evidência): contorna por cima do alvo
    const xa = a.x + largNo / 2; const xb = b.x + largNo / 2; const ya = a.y; const yb = b.y;
    const sobe = Math.min(ya, yb) - 28;
    return `M ${xa} ${ya} C ${xa} ${sobe}, ${xb} ${sobe}, ${xb} ${yb}`;
  };

  return (
    <div className="card mcm">
      <div className="mcc-topo">
        <h2>Mapa vivo</h2>
        <span className="small muted">{NOS.length} nós · {ARESTAS.length} arestas · o modelo é a autoridade, a tela só desenha</span>
      </div>
      <div className="mcm-legenda small">
        {TIPOS_ARESTA.map((t) => <span key={t} className={`mcm-leg ${t}`}><i /> {ROTULO_ARESTA[t]}</span>)}
        <span className="mcm-leg"><Badge tone="muted">gates</Badge> snapshot</span>
        <span className="mcm-leg"><Badge tone="ok">itens</Badge> live</span>
      </div>
      <div className="mcm-viewport">
        <svg className="mcm-svg" width={layout.largura} height={layout.altura} viewBox={`0 0 ${layout.largura} ${layout.altura}`} role="img" aria-label="Grafo do sistema: nós por domínio e arestas tipadas">
          <defs>
            <marker id="mcm-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
          </defs>
          {layout.faixas.map((f) => (
            <g key={f.dominio} className="mcm-faixa">
              <rect x={4} y={f.y - 4} width={layout.largura - 8} height={f.altura + 4} rx={8} />
              <text x={16} y={f.y + 14}>{ROTULO_DOMINIO[f.dominio]}</text>
            </g>
          ))}
          {ARESTAS.map((a) => (
            <path key={`${a.de}-${a.para}-${a.tipo}`} className={`mcm-aresta ${a.tipo}${selecionado && (a.de === selecionado || a.para === selecionado) ? ' ativa' : ''}`} d={caminho(a.de, a.para)} markerEnd="url(#mcm-seta)">
              <title>{`${noPorId(a.de)?.titulo} → ${noPorId(a.para)?.titulo}: ${ROTULO_ARESTA[a.tipo]}${a.rotulo ? ` — ${a.rotulo}` : ''}`}</title>
            </path>
          ))}
          {NOS.map((n) => {
            const p = pos.get(n.id)!;
            const e = estadoDoNo(n, itens);
            return (
              <g key={n.id} className={`mcm-no ${e.classe}${selecionado === n.id ? ' sel' : ''}`} transform={`translate(${p.x} ${p.y})`} tabIndex={0} role="button" aria-label={`${n.titulo}: ${e.texto}`}
                onClick={() => setSelecionado(n.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelecionado(n.id); } }}>
                <rect width={largNo} height={altNo} rx={8} />
                <text className="mcm-titulo" x={10} y={22}>{truncar(n.titulo, 20)}</text>
                <text className="mcm-estado" x={10} y={44}>{e.texto}</text>
                <circle className="mcm-origem" cx={largNo - 12} cy={12} r={4}><title>{e.origem}</title></circle>
                <title>{`${n.titulo} — ${e.titulo}`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      {no && (() => {
        const e = estadoDoNo(no, itens);
        const vivos = itens ? itensDoNo(no.id, itens) : [];
        const ci = no.id === 'CI' ? repositorios?.filter((r) => r.disponivel) : undefined;
        return (
          <div className="mcm-detalhe">
            <div className="mcc-topo">
              <h3 style={{ margin: 0 }}>{no.titulo}</h3>
              <Badge tone={e.classe} title={e.titulo}>{e.texto}</Badge>
              <span className="mc-conta">{ROTULO_DOMINIO[no.dominio]} · {e.origem}</span>
              <span className="spacer" />
              <button className="btn sm no-print" onClick={() => setSelecionado(null)}>Fechar</button>
            </div>
            <p className="small">{no.papel}</p>
            {no.gates.length > 0 && (
              <div className="mc-lista-gates">{no.gates.map((id) => { const g = gatePorId(id); return g ? <span key={id} className={`mc-pill ${g.situacao === 'fechado' ? 'ok' : g.situacao === 'bloqueado' ? (g.porDesenho ? 'info' : 'bad') : ''}`} title={g.prova}>{g.titulo}</span> : null; })}</div>
            )}
            {ci && ci.length > 0 && (
              <p className="small">{ci.map((r) => <span key={r.repository} className="mcm-ci">{r.repository.split('/')[1]}: {r.ci ? `${ROTULO_CI[r.ci.situacao]} · ${r.ci.statusOrigem}` : 'CI indisponível'}</span>)}</p>
            )}
            {noRecebeItensVivos(no.id) && (
              !itens ? <p className="small muted">Sem leitura das fontes vivas.</p>
                : vivos.length === 0 ? <p className="small muted">Nenhum item vivo neste nó na última leitura.</p>
                  : <ul className="mcc-lista">{vivos.slice(0, 12).map((i) => <li key={i.id}><b className="mcc-tarefa-id">{i.correlationId ?? i.sourceId}</b> <span>{i.title}</span> <Badge tone="muted">{ROTULO_MC_STATUS[i.status]}</Badge> <span className="mcq-cru">{i.statusOrigem}</span></li>)}</ul>
            )}
            <div className="grid cols-2" style={{ marginTop: 10 }}>
              <div>
                <div className="mc-conta">Recebe de</div>
                <ul className="mcc-lista small">{arestasPara(no.id).map((a) => <li key={`${a.de}${a.tipo}`}><button className="mc-pill mcc-pill-btn" onClick={() => setSelecionado(a.de)}>{noPorId(a.de)?.titulo}</button> <span className="muted">{a.tipo}{a.rotulo ? ` · ${a.rotulo}` : ''}</span></li>)}{!arestasPara(no.id).length && <li className="muted">—</li>}</ul>
              </div>
              <div>
                <div className="mc-conta">Entrega / observa</div>
                <ul className="mcc-lista small">{arestasDe(no.id).map((a) => <li key={`${a.para}${a.tipo}`}><button className="mc-pill mcc-pill-btn" onClick={() => setSelecionado(a.para)}>{noPorId(a.para)?.titulo}</button> <span className="muted">{a.tipo}{a.rotulo ? ` · ${a.rotulo}` : ''}</span></li>)}{!arestasDe(no.id).length && <li className="muted">—</li>}</ul>
              </div>
            </div>
          </div>
        );
      })()}
      {!no && <p className="small muted mcq-rodape-nota">Clique num nó para ver papel, gates, itens vivos e arestas. Arestas que apontam para trás (observa, evidência) contornam por cima: observar não cria ordem.</p>}
    </div>
  );
}
