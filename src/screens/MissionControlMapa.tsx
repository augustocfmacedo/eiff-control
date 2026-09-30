// Mission Control · Mapa vivo (MC-LIVE-4 / MC-CONSTRUCTION-1 / V2B executiva).
//
// Uma ferramenta, duas camadas:
//   1. MÓDULOS (padrão): os módulos do catálogo por domínio, com o estado e a fração da MESMA projeção da Visão geral
//      (mapaExecutivo.ts → resumoExecutivo) e só as relações declaradas (dependência) ou colapsadas com prova (fluxo).
//      Clique mostra o contexto e abre o MESMO drill-down da Visão geral. Em tela estreita vira lista relacional.
//   2. ARQUITETURA TÉCNICA: o grafo de src/core/central/mapaVivo.ts como sempre foi — nós técnicos, gates, fontes,
//      observa e evidência. Nós que são módulos mostram o estado do módulo (resumoDoNo) e os gates no detalhe.
// Nada aqui escreve, nada aqui infere, nenhuma leitura remota nova: `itens` chega por prop.
import React, { useMemo, useState } from 'react';
import {
  ARESTAS, NOS, ROTULO_DOMINIO, TIPOS_ARESTA, arestasDe, arestasPara, itensDoNo, layoutDoMapa, noPorId, noRecebeItensVivos,
  type NoMapa, type TipoAresta,
} from '../core/central/mapaVivo';
import { gatePorId, prontidao, type Prontidao } from '../core/central/missionControl';
import {
  DOMINIOS_CONSTRUCAO, MODULO_DO_NO, ROTULO_DOMINIO_CONSTRUCAO, ROTULO_ESTADO_CONSTRUCAO, TONE_ESTADO_CONSTRUCAO, fracaoExecutiva,
  moduloPorId, panoramaConstrucao, resumoDoNo, type ResumoExecutivo,
} from '../core/central/construcao';
import {
  CLASSE_ESTADO_MAPA, FILTROS_MAPA, ROTULO_FILTRO_MAPA, arestasExecutivas, destaqueDoFiltro, impactoDe, layoutExecutivo, nosExecutivos, rotasExecutivas,
  type FiltroMapa,
} from '../core/central/mapaExecutivo';
import { ROTULO_MC_STATUS, type MissionControlWorkItem } from '../core/central/workItem';
import type { RepositorioStatus } from '../core/central/githubAdapter';
import { ROTULO_CI } from '../core/central/githubAdapter';
import { Badge, ProgressRow, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';
import { ListaEspera, PainelModulo } from './MissionControlVisao';

const truncar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ============================================================================================ camada técnica

const ROTULO_ARESTA: Record<TipoAresta, string> = { fluxo: 'fluxo (entrega para)', dependencia: 'dependência (não funciona sem)', observa: 'observa (só lê)', evidencia: 'evidência (prova o estado)' };

const temBloqueioReal = (p: Prontidao) => p.faltando.some((x) => x.situacao === 'bloqueado' && !x.porDesenho);
const toneDaProntidao = (p: Prontidao): Tone => (p.pronto ? 'ok' : temBloqueioReal(p) ? 'bad' : 'warn');

/**
 * Estado exibido no nó técnico. Nó que É um módulo do catálogo (MODULO_DO_NO) mostra o estado executivo da MESMA
 * projeção do panorama (resumoDoNo) — nunca uma segunda regra; gates e fonte técnica descem para o detalhe. Os demais
 * nós: gates → prontidão (snapshot); fonte viva → contagem de itens (live); senão desenho.
 */
function estadoDoNo(no: NoMapa, itens: MissionControlWorkItem[] | null, modulo: ResumoExecutivo | null) {
  if (modulo) {
    return { classe: TONE_ESTADO_CONSTRUCAO[modulo.estado] as Tone, texto: `${modulo.rotuloEstado} · ${modulo.concluidos}/${modulo.total}`, titulo: modulo.proximo ? `Próximo: ${modulo.proximo}` : 'Todos os componentes concluídos', origem: 'módulo' as const };
  }
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

function MapaTecnico({ itens, repositorios, selecionadoInicial }: { itens: MissionControlWorkItem[] | null; repositorios?: RepositorioStatus[]; selecionadoInicial?: string | null }) {
  const layout = useMemo(() => layoutDoMapa(), []);
  const [selecionado, setSelecionado] = useState<string | null>(selecionadoInicial ?? null);
  const pos = useMemo(() => new Map(layout.nos.map((n) => [n.id, n])), [layout]);
  const { largNo, altNo } = layout;
  const no = selecionado ? noPorId(selecionado) : undefined;
  // uma projeção por nó que é módulo, da mesma fonte do panorama
  const modulos = useMemo(() => new Map(NOS.map((n) => [n.id, resumoDoNo(n.id, itens)])), [itens]);

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
    <>
      <div className="small muted mcv-sub">{NOS.length} nós técnicos · {ARESTAS.length} arestas · o modelo é a autoridade, a tela só desenha</div>
      <div className="mcm-legenda small">
        {TIPOS_ARESTA.map((t) => <span key={t} className={`mcm-leg ${t}`}><i /> {ROTULO_ARESTA[t]}</span>)}
        <span className="mcm-leg"><Badge tone="warn">estado</Badge> módulo do catálogo (o mesmo da Visão geral)</span>
        <span className="mcm-leg"><Badge tone="muted">gates</Badge> snapshot</span>
        <span className="mcm-leg"><Badge tone="ok">itens</Badge> live</span>
      </div>
      <div className="mcm-viewport">
        <svg className="mcm-svg" width={layout.largura} height={layout.altura} viewBox={`0 0 ${layout.largura} ${layout.altura}`} role="img" aria-label="Arquitetura técnica: nós por domínio e arestas tipadas">
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
            const e = estadoDoNo(n, itens, modulos.get(n.id) ?? null);
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
        const mod = modulos.get(no.id) ?? null;
        const e = estadoDoNo(no, itens, mod);
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
            {mod && (
              <p className="small"><b>{mod.fracaoTexto}</b> componentes concluídos{mod.proximo ? <> · <span className="muted">Próximo:</span> {mod.proximo}</> : null}</p>
            )}
            {mod && no.gates.length > 0 && <div className="mc-conta">Detalhe técnico · gates</div>}
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
    </>
  );
}

// ============================================================================================ camada executiva

const titulo = (id: string) => moduloPorId(id)?.titulo ?? id;

/** Contexto do módulo clicado: o essencial para decidir se vale abrir o drill-down. */
function ContextoModulo({ r, bloqueiosReais, onSelecionar, onAbrir, onTecnico, onFechar, bloqueados }: {
  r: ResumoExecutivo; bloqueiosReais: string[]; onSelecionar: (id: string) => void; onAbrir: (id: string) => void; onTecnico: (noId: string | null) => void; onFechar: () => void; bloqueados: Set<string>;
}) {
  const mo = moduloPorId(r.moduloId)!;
  const dependentes = impactoDe(r.moduloId);
  const noTecnico = Object.entries(MODULO_DO_NO).find(([, m]) => m === r.moduloId)?.[0] ?? null;
  return (
    <div className="mcv-contexto" aria-live="polite">
      <div className="mcc-topo">
        <h3 style={{ margin: 0 }}>{r.titulo}</h3>
        <Badge tone={TONE_ESTADO_CONSTRUCAO[r.estado]}>{r.rotuloEstado}</Badge>
        <span className="mc-conta">{ROTULO_DOMINIO_CONSTRUCAO[mo.dominio]}</span>
        <span className="spacer" />
        <button className="btn sm primary no-print" onClick={() => onAbrir(r.moduloId)}>Abrir módulo</button>
        <button className="btn sm no-print" onClick={() => onTecnico(noTecnico)}>Ver detalhe técnico</button>
        <button className="btn sm no-print" onClick={onFechar} aria-label="Fechar contexto">Fechar</button>
      </div>
      <ProgressRow label="" valor={r.fracao} texto={`${r.fracaoTexto} componentes`} tone={r.estado === 'CONCLUIDO' ? 'ok' : r.estado === 'BLOQUEADO' ? 'bad' : 'warn'} />
      <p className="small"><span className="muted">Próximo:</span> {r.proximo ?? 'tudo concluído'}</p>
      {r.pendenciasHumanas.length > 0 && <><div className="mc-conta">Esperando você</div><ListaEspera itens={r.pendenciasHumanas} comModulo={false} /></>}
      <div className="mcv-rel">
        <div>
          <div className="mc-conta">Depende de</div>
          {mo.dependeDe?.length ? <div className="mc-lista-gates">{mo.dependeDe.map((d) => <button key={d} className={`mc-pill mcc-pill-btn${bloqueados.has(d) ? ' bad' : ''}`} onClick={() => onSelecionar(d)}>{titulo(d)}{bloqueados.has(d) ? ' · bloqueado' : ''}</button>)}</div> : <p className="small muted">Nenhum módulo.</p>}
        </div>
        <div>
          <div className="mc-conta">É dependência de</div>
          {dependentes.diretos.length ? <div className="mc-lista-gates">{dependentes.diretos.map((d) => <button key={d} className="mc-pill mcc-pill-btn" onClick={() => onSelecionar(d)}>{titulo(d)}</button>)}</div> : <p className="small muted">Nenhum módulo.</p>}
        </div>
      </div>
      {bloqueiosReais.length > 0 && <p className="small"><span className="neg"><Icon name="aviso" size={13} /> Bloqueios:</span> {bloqueiosReais.join(' · ')}</p>}
      {r.estado === 'BLOQUEADO' && (
        <p className="small"><b>Impacto deste bloqueio</b> (só dependências declaradas; o estado dos outros módulos não muda): {dependentes.diretos.length ? <>afeta diretamente {dependentes.diretos.map(titulo).join(', ')}</> : 'nenhum módulo depende dele'}{dependentes.indiretos.length ? <>; indiretamente {dependentes.indiretos.map(titulo).join(', ')}</> : null}.</p>
      )}
      {r.dependenciasBloqueadas.length > 0 && <p className="small"><span className="neg"><Icon name="aviso" size={13} /></span> Depende de {r.dependenciasBloqueadas.join(', ')}, atualmente bloqueado. O estado deste módulo não muda por isso.</p>}
    </div>
  );
}

export default function MapaVivo({ itens, repositorios }: { itens: MissionControlWorkItem[] | null; repositorios?: RepositorioStatus[] }) {
  // a MESMA projeção da Visão geral, sobre o MESMO `itens` recebido por prop
  const panorama = useMemo(() => panoramaConstrucao(itens), [itens]);
  const nos = useMemo(() => new Map(nosExecutivos(panorama).map((n) => [n.id, n])), [panorama]);
  const layout = useMemo(() => layoutExecutivo(), []);
  const arestas = useMemo(() => arestasExecutivas(), []);
  const [vista, setVista] = useState<'modulos' | 'tecnico'>('modulos');
  const [noTecnicoInicial, setNoTecnicoInicial] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroMapa>('TODOS');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const destaque = useMemo(() => destaqueDoFiltro(panorama, filtro), [panorama, filtro]);
  const bloqueados = useMemo(() => new Set(panorama.modulos.filter((p) => p.estado === 'BLOQUEADO').map((p) => p.modulo.id)), [panorama]);
  const { largNo, altNo } = layout;
  const leituraValida = panorama.tarefas !== null;
  const agora = new Date().toISOString();
  const moduloAberto = aberto ? panorama.modulos.find((p) => p.modulo.id === aberto) : undefined;
  const sel = selecionado ? nos.get(selecionado)?.resumo : undefined;

  // o traçado vem do domínio (rotas ortogonais por corredores, provadas por teste geométrico: nenhuma atravessa cartão)
  const rotas = useMemo(() => new Map(rotasExecutivas(layout, arestas).map((r) => [`${r.de}>${r.para}`, r])), [layout, arestas]);
  const caminho = (de: string, para: string): string => {
    const r = rotas.get(`${de}>${para}`);
    return r ? `M ${r.pontos.map((p) => `${p.x} ${p.y}`).join(' L ')}` : '';
  };
  const verTecnico = (noId: string | null) => { setNoTecnicoInicial(noId); setVista('tecnico'); };

  return (
    <div className="card mcm mcv">
      <div className="mcc-topo">
        <h2>Mapa vivo</h2>
        <div className="mcv-vistas no-print" role="group" aria-label="Camada do mapa">
          <button className={`btn sm${vista === 'modulos' ? ' primary' : ''}`} aria-pressed={vista === 'modulos'} onClick={() => setVista('modulos')}>Módulos</button>
          <button className={`btn sm${vista === 'tecnico' ? ' primary' : ''}`} aria-pressed={vista === 'tecnico'} onClick={() => { setNoTecnicoInicial(null); setVista('tecnico'); }}>Arquitetura técnica</button>
        </div>
        {vista === 'modulos' && <span className="small muted">{panorama.total} módulos · {arestas.length} relações declaradas · mesma leitura da Visão geral</span>}
      </div>

      {vista === 'tecnico' && <MapaTecnico key={noTecnicoInicial ?? 'todos'} itens={itens} repositorios={repositorios} selecionadoInicial={noTecnicoInicial} />}

      {vista === 'modulos' && (
        <>
          <div className="mcv-barra small">
            <span className="mcv-leg"><i className="est ok" /> Concluído</span>
            <span className="mcv-leg"><i className="est warn" /> Em construção</span>
            <span className="mcv-leg"><i className="est bad" /> Bloqueado</span>
            <span className="mcv-leg"><i className="lin dep" /> depende de (seta vai para quem depende)</span>
            <span className="mcv-leg"><i className="lin fluxo" /> fluxo principal</span>
            <span className="mcv-leg"><i className="lin impacto" /> impacto de bloqueio</span>
            <span className="spacer" />
            <span className="mcv-filtros no-print" role="group" aria-label="Destacar">
              {FILTROS_MAPA.map((f) => <button key={f} className={`btn sm${filtro === f ? ' primary' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{ROTULO_FILTRO_MAPA[f]}</button>)}
            </span>
          </div>

          {/* desktop: o mapa macro inteiro cabe na largura (viewBox escalado); em tela estreita vira a lista abaixo */}
          <div className="mcv-grafico">
            <svg className="mcv-svg" viewBox={`0 0 ${layout.largura} ${layout.altura}`} role="img" aria-label="Módulos do EIFF por domínio e as dependências declaradas entre eles">
              <defs>
                <marker id="mcv-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="mcv-seta-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
              </defs>
              {layout.faixas.map((f) => {
                const doDominio = panorama.modulos.filter((p) => p.modulo.dominio === f.dominio);
                const prontos = doDominio.filter((p) => p.estado === 'CONCLUIDO').length;
                return (
                  <g key={f.dominio} className="mcv-faixa">
                    <rect x={2} y={f.y} width={layout.largura - 4} height={f.altura} rx={8} />
                    <text x={12} y={f.y + 15}>{ROTULO_DOMINIO_CONSTRUCAO[f.dominio]} · {fracaoExecutiva(prontos, doDominio.length)} módulos concluídos</text>
                  </g>
                );
              })}
              {arestas.map((a) => {
                const impacto = bloqueados.has(a.de);
                const ativa = selecionado && (a.de === selecionado || a.para === selecionado);
                const dim = filtro !== 'TODOS' && !(destaque.has(a.de) && destaque.has(a.para));
                const fluxo = a.tipos.includes('fluxo');
                const extra = `${ativa ? ' ativa' : ''}${dim ? ' dim' : ''}`;
                return (
                  <g key={`${a.de}-${a.para}`}>
                  {/* fluxo que também é impacto de bloqueio: as duas camadas aparecem (laranja por baixo, tracejado por cima) */}
                  {fluxo && impacto && <path className={`mcv-aresta fluxo${extra}`} d={caminho(a.de, a.para)} />}
                  <path className={`mcv-aresta${fluxo && !impacto ? ' fluxo' : ''}${impacto ? ' impacto' : ''}${extra}`} d={caminho(a.de, a.para)} markerEnd={impacto ? 'url(#mcv-seta-bad)' : 'url(#mcv-seta)'}>
                    <title>{`${titulo(a.para)} depende de ${titulo(a.de)}${a.tipos.includes('fluxo') ? ' · fluxo principal' : ''}${impacto ? ` · ${titulo(a.de)} está bloqueado` : ''}`}</title>
                  </path>
                  </g>
                );
              })}
              {layout.nos.map((p) => {
                const n = nos.get(p.id)!; const r = n.resumo;
                const dim = !destaque.has(p.id);
                return (
                  <g key={p.id} className={`mcv-no ${CLASSE_ESTADO_MAPA[r.estado]}${selecionado === p.id ? ' sel' : ''}${dim ? ' dim' : ''}`} transform={`translate(${p.x} ${p.y})`}
                    tabIndex={0} role="button" aria-label={`${r.titulo}: ${r.rotuloEstado}, ${r.fracaoTexto} componentes${r.pendenciasHumanas.length ? ', esperando você' : ''}`}
                    onClick={() => setSelecionado(p.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelecionado(p.id); } }}>
                    <rect width={largNo} height={altNo} rx={7} />
                    <text className="mcv-titulo" x={10} y={19}>{truncar(r.titulo, 27)}</text>
                    <text className="mcv-estado" x={10} y={37}>{r.rotuloEstado} · {r.concluidos}/{r.total}</text>
                    {r.pendenciasHumanas.length > 0 && <text className="mcv-voce" x={largNo - 10} y={37} textAnchor="end">espera você</text>}
                    <title>{`${r.titulo} — ${r.rotuloEstado}, ${r.fracaoTexto} componentes${r.proximo ? `. Próximo: ${r.proximo}` : ''}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* tablet/celular: a mesma informação como lista relacional por domínio */}
          <div className="mcv-lista">
            {DOMINIOS_CONSTRUCAO.map((d) => {
              const doDominio = panorama.modulos.filter((p) => p.modulo.dominio === d);
              if (!doDominio.length) return null;
              const prontos = doDominio.filter((p) => p.estado === 'CONCLUIDO').length;
              return (
                <section key={d} className="mcv-lista-dominio">
                  <div className="mcc-dominio-cab small"><b>{ROTULO_DOMINIO_CONSTRUCAO[d]}</b> <span className="muted">{fracaoExecutiva(prontos, doDominio.length)} módulos concluídos</span></div>
                  {doDominio.map((p) => {
                    const r = nos.get(p.modulo.id)!.resumo;
                    const dep = p.modulo.dependeDe ?? [];
                    const dependentes = impactoDe(p.modulo.id).diretos;
                    return (
                      <details key={p.modulo.id} className={`mcv-item ${CLASSE_ESTADO_MAPA[r.estado]}${destaque.has(p.modulo.id) ? '' : ' dim'}`}>
                        <summary>
                          <span className="mcv-item-titulo">{r.titulo}</span>
                          <Badge tone={TONE_ESTADO_CONSTRUCAO[r.estado]}>{ROTULO_ESTADO_CONSTRUCAO[r.estado]}</Badge>
                          <span className="mcv-item-frac">{r.concluidos}/{r.total}</span>
                        </summary>
                        <div className="small mcv-item-corpo">
                          <div><span className="muted">Próximo:</span> {r.proximo ?? 'tudo concluído'}</div>
                          <div><span className="muted">Depende de:</span> {dep.length ? dep.map((x) => `${titulo(x)}${bloqueados.has(x) ? ' (bloqueado)' : ''}`).join(', ') : 'nenhum módulo'}</div>
                          <div><span className="muted">É dependência de:</span> {dependentes.length ? dependentes.map(titulo).join(', ') : 'nenhum módulo'}</div>
                          {r.pendenciasHumanas.length > 0 && <div><span className="muted">Esperando você:</span> {r.pendenciasHumanas.map((x) => x.acao).join(' · ')}</div>}
                          <button className="btn sm no-print" onClick={() => setAberto(p.modulo.id)}>Abrir módulo</button>
                        </div>
                      </details>
                    );
                  })}
                </section>
              );
            })}
          </div>

          {sel
            ? <ContextoModulo r={sel} bloqueiosReais={(panorama.modulos.find((p) => p.modulo.id === selecionado)?.bloqueios ?? []).filter((b) => !b.porDesenho).map((b) => b.titulo)} bloqueados={bloqueados} onSelecionar={setSelecionado} onAbrir={setAberto} onTecnico={verTecnico} onFechar={() => setSelecionado(null)} />
            : <p className="small muted mcq-rodape-nota mcv-dica">Clique num módulo para ver o contexto e abrir o detalhe. Fluxos técnicos, observa, evidência e gates ficam em &quot;Arquitetura técnica&quot;.</p>}
        </>
      )}

      {moduloAberto && <PainelModulo mo={moduloAberto} panorama={panorama} agora={agora} leituraValida={leituraValida} onFechar={() => setAberto(null)} onIr={setAberto} />}
      {moduloAberto && <div className="mcc-painel-bg no-print" onClick={() => setAberto(null)} aria-hidden="true" />}
    </div>
  );
}
