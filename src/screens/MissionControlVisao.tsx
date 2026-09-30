// Mission Control · Visão geral — a Central de Construção do EIFF (MC-CONSTRUCTION-1, V2A executiva).
//
// Responde em dez segundos, sem rolar a 1440×900: quantos módulos, quantos concluídos, em construção e bloqueados,
// o que está sendo construído agora e qual o próximo passo de cada um, e o que espera uma decisão ou configuração
// humana. O detalhe técnico (catálogo, gates, fontes) continua existindo — no drill-down, sob "Detalhe técnico", e na
// Governança. A hierarquia mudou; a informação não foi apagada.
//
// Nada é calculado aqui: tudo vem de src/core/central/construcao.ts (catálogo do repositório) e as tarefas vêm do
// MESMO estado remoto lido uma vez pela tela principal (por prop). A tela OBSERVA: nenhum clique escreve em fonte
// alguma. Task sem módulo informado pela fonte NÃO some. Sem leitura válida, contagem viva é "—", nunca 0.
import React, { useEffect, useMemo, useState } from 'react';
import {
  DOMINIOS_CONSTRUCAO, ROTULO_DOMINIO_CONSTRUCAO, ROTULO_ESTADO_CONSTRUCAO, ROTULO_NATUREZA, ROTULO_PENDENCIA, SEM_LEITURA, SEM_MODULO, STATUS_ATIVOS,
  TONE_ESTADO_CONSTRUCAO, atencaoConstrucao, construindoAgora, contagemViva, emConstrucaoAgora, esperandoVoce, fracaoExecutiva,
  moduloDaTarefa, moduloPorId, ordemExecutiva, panoramaConstrucao, pctConstrucao, resumoExecutivo,
  type ComponenteProjetado, type ModuloProjetado, type PanoramaConstrucao, type PendenciaHumana, type ResumoExecutivo, type TipoPendencia,
} from '../core/central/construcao';
import { SEM_EVIDENCIA_DE_CI, ciDoItem, haQuantoTempo, rotuloProcedenciaDoItem } from '../core/central/quadroOperacional';
import { ROTULO_MC_STATUS, ROTULO_PROCEDENCIA, type McStatus, type MissionControlWorkItem } from '../core/central/workItem';
import { TEXTO_CODIGO_CLIENTE, type EstadoStatusRemoto } from '../data/statusRemoto';
import { Badge, KpiStrip, ProgressRow, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';

const TONE_STATUS: Partial<Record<McStatus, Tone>> = { EXECUTANDO: 'ok', AGUARDANDO_HUMANO: 'warn', BLOQUEADO: 'bad', EM_VALIDACAO: 'info', CONCLUIDO: 'muted' };
const LIMITE_AGORA = 12;
/** Concluídos passam deste tamanho e a lista nasce recolhida no drill-down. */
const LIMITE_CONCLUIDOS_ABERTOS = 6;

const ROTULO_ESPERA: Partial<Record<TipoPendencia, string>> = { DECISAO: 'Esperando decisão', CONFIGURACAO: 'Esperando configuração' };
const toneBarra = (estado: string): 'ok' | 'warn' | 'bad' => (estado === 'CONCLUIDO' ? 'ok' : estado === 'BLOQUEADO' ? 'bad' : 'warn');

const curto = (url?: string) => {
  if (!url) return undefined;
  const pr = url.match(/\/pull\/(\d+)/);
  if (pr) return `#${pr[1]}`;
  const iss = url.match(/\/issues\/(\d+)/);
  if (iss) return `#${iss[1]}`;
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, '');
};

/** Marcador de estado do componente: ponto colorido + texto (nunca só cor). */
function Ponto({ c }: { c: ComponenteProjetado }) {
  const rotulo = c.porDesenho ? 'Fechado de propósito' : ROTULO_ESTADO_CONSTRUCAO[c.estado];
  return <span className={`mcc-ponto ${c.porDesenho ? 'desenho' : c.estado}`} title={rotulo} aria-label={rotulo} />;
}

/** Linha compacta de tarefa. Estado cru, frente, branch, PR e procedência ficam no detalhe (disclosure). */
function Tarefa({ i, agora }: { i: MissionControlWorkItem; agora: string }) {
  const mo = moduloDaTarefa(i);
  return (
    <details className="mcc-tarefa" data-status={i.status}>
      <summary>
        <span className="mcc-tarefa-titulo">{i.title}</span>
        <Badge tone={TONE_STATUS[i.status]}>{ROTULO_MC_STATUS[i.status]}</Badge>
        <span className={`mcc-tarefa-mod${mo ? '' : ' muted'}`} title={mo ? 'Módulo informado pelo contrato do item' : 'A fonte não informa a que módulo esta tarefa pertence; nada é inferido.'}>{mo ? mo.titulo : SEM_MODULO}</span>
        {i.responsavel && <span className="small muted">{i.responsavel.rotulo}</span>}
        {i.frescor.fonteIndisponivel ? <Badge tone="bad">fonte fora</Badge> : i.frescor.stale ? <Badge tone="warn">vencido</Badge> : null}
      </summary>
      <div className="mcc-tarefa-corpo small">
        <div><span className="muted">Tarefa</span> <b className="mcc-tarefa-id">{i.correlationId ?? i.sourceId}</b> · <span className="muted">estado na fonte</span> <span className="mcq-cru">{i.statusOrigem}</span></div>
        <div><span className="muted">Responsável</span> {i.responsavel ? <>{i.responsavel.rotulo}{i.responsavel.id ? ` · ${i.responsavel.id}` : ''}</> : '—'}</div>
        <div><span className="muted">Frente</span> {i.workstreamId ?? '—'}</div>
        <div><span className="muted">Branch</span> {i.links?.branch ?? '—'}</div>
        <div><span className="muted">PR</span> {i.links?.pullRequest ? <a href={i.links.pullRequest} target="_blank" rel="noreferrer">{curto(i.links.pullRequest)}</a> : '—'}</div>
        <div><span className="muted">Issue</span> {i.links?.issue ? <a href={i.links.issue} target="_blank" rel="noreferrer">{curto(i.links.issue)}</a> : '—'}</div>
        <div><span className="muted">CI</span> <span title={SEM_EVIDENCIA_DE_CI}>{ciDoItem(i) ?? '—'}</span></div>
        {i.bloqueio && <div className={`mcq-bloqueio${i.bloqueio.porDesenho ? ' por-desenho' : ''}`}><Icon name="aviso" size={13} /> {i.bloqueio.porDesenho ? 'Bloqueado de propósito: ' : 'Bloqueado: '}{i.bloqueio.motivo}</div>}
        <div><span className="muted">Alterado</span> {haQuantoTempo(i.updatedAt, agora) ?? '—'} · <span className="muted">Observado</span> {haQuantoTempo(i.frescor.observadoEm, agora) ?? '—'} · <span className="muted">Procedência</span> {rotuloProcedenciaDoItem(i)}</div>
      </div>
    </details>
  );
}

/**
 * Avisos executivos do módulo: espera humana e dependência bloqueada. Só o que a projeção declara. `curto` é a forma da
 * linha de "Em construção agora" (rótulo curto, frase inteira no title); o cartão e o painel mostram a frase inteira.
 */
function Avisos({ r, curto }: { r: ResumoExecutivo; curto?: boolean }) {
  const tipos = [...new Set(r.pendenciasHumanas.map((p) => p.tipo))];
  if (!tipos.length && !r.dependenciasBloqueadas.length) return null;
  const dep = `Depende de ${r.dependenciasBloqueadas.join(', ')}, atualmente bloqueado`;
  return (
    <span className={`mcc-avisos${curto ? ' curto' : ''}`}>
      {tipos.map((t) => <span key={t} className="mcc-aviso humano"><Icon name="equipe" size={13} /> {ROTULO_ESPERA[t]}</span>)}
      {r.dependenciasBloqueadas.length > 0 && <span className="mcc-aviso dep" title={`${dep}. O estado deste módulo não muda por isso.`}><Icon name="aviso" size={13} /> {curto ? 'Dependência bloqueada' : dep}</span>}
    </span>
  );
}

/** Uma linha de "Em construção agora": módulo, avanço, próximo passo e atenção humana. Nada técnico. */
function LinhaConstrucao({ r, onAbrir }: { r: ResumoExecutivo; onAbrir: (id: string) => void }) {
  return (
    <button className={`mcc-linha ${r.estado}`} onClick={() => onAbrir(r.moduloId)}>
      <span className="mcc-linha-cab">
        <b>{r.titulo}</b>
        {r.estado === 'BLOQUEADO' && <Badge tone="bad">Bloqueado</Badge>}
        <span className="mcc-linha-frac">{r.fracaoTexto}</span>
        <span className="mcc-barra" aria-hidden="true"><i className={toneBarra(r.estado)} style={{ width: `${Math.round(r.fracao * 100)}%` }} /></span>
      </span>
      <span className="mcc-linha-pe">
        <span className="mcc-linha-prox" title={r.proximo ?? undefined}>{r.proximo ? <><span className="muted">Próximo:</span> {r.proximo}</> : 'Tudo concluído'}</span>
        <Avisos r={r} curto />
      </span>
    </button>
  );
}

function CartaoModulo({ r, mo, leituraValida, onAbrir }: { r: ResumoExecutivo; mo: ModuloProjetado; leituraValida: boolean; onAbrir: (id: string) => void }) {
  return (
    <article className={`mcc-card ${r.estado}`} data-modulo={r.moduloId}>
      <header className="mcc-card-cab">
        <b>{r.titulo}</b>
        <Badge tone={TONE_ESTADO_CONSTRUCAO[r.estado]}>{r.rotuloEstado}</Badge>
      </header>
      <div className="small muted">{ROTULO_DOMINIO_CONSTRUCAO[mo.modulo.dominio]}</div>
      <ProgressRow label="" valor={r.fracao} texto={`${r.fracaoTexto} componentes`} tone={toneBarra(r.estado)} />
      {r.proximo && <div className="mcc-proximo small"><span className="muted">Próximo:</span> {r.proximo}</div>}
      <Avisos r={r} />
      {leituraValida && (
        <div className="mcc-card-meta small">
          <span title="Tarefas cujo contrato informa este módulo"><Icon name="checks" size={13} /> {r.tarefasAtivas} tarefa(s) ativa(s)</span>
          {mo.modulo.observaFonte && <span title="Itens produzidos pela fonte observada; não é pertença"><Icon name="fabrica" size={13} /> {mo.observados.length} job(s) observado(s)</span>}
        </div>
      )}
      <button className="btn sm mcc-abrir no-print" onClick={() => onAbrir(r.moduloId)}>Abrir módulo</button>
    </article>
  );
}

/** Módulo concluído em uma linha: não esconde que existe, não empurra o trabalho ativo para baixo. */
function TileConcluido({ r, onAbrir }: { r: ResumoExecutivo; onAbrir: (id: string) => void }) {
  return (
    <button className="mcc-tile" onClick={() => onAbrir(r.moduloId)} aria-label={`Abrir ${r.titulo}: concluído, ${r.fracaoTexto} componentes`}>
      <span className="mcc-ponto CONCLUIDO" aria-hidden="true" />
      <span className="mcc-tile-titulo">{r.titulo}</span>
      <span className="mcc-tile-frac">{r.fracaoTexto}</span>
    </button>
  );
}

/** Reutilizado pelo Mapa vivo (V2B): um drill-down só na Central. */
export function ListaEspera({ itens, onAbrir, comModulo }: { itens: PendenciaHumana[]; onAbrir?: (id: string) => void; comModulo: boolean }) {
  return (
    <ul className="mcc-espera">
      {itens.map((p) => (
        <li key={`${p.moduloId}-${p.componenteId}-${p.gateId ?? ''}`}>
          <span className="mcc-espera-cab">
            {comModulo && onAbrir ? <button className="mcc-espera-mod" onClick={() => onAbrir(p.moduloId)}>{p.moduloTitulo}</button> : null}
            <span className="mc-pill">{ROTULO_PENDENCIA[p.tipo]}</span>
          </span>
          <span className="mcc-espera-acao">{p.acao}</span>
        </li>
      ))}
    </ul>
  );
}

/** Reutilizado pelo Mapa vivo (V2B): um drill-down só na Central. */
export function PainelModulo({ mo, panorama, agora, leituraValida, onFechar, onIr }: { mo: ModuloProjetado; panorama: PanoramaConstrucao; agora: string; leituraValida: boolean; onFechar: () => void; onIr: (id: string) => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  const r = resumoExecutivo(mo, panorama);
  const concluidos = mo.componentes.filter((c) => c.estado === 'CONCLUIDO');
  const andamento = mo.componentes.filter((c) => c.estado === 'EM_CONSTRUCAO');
  const depois = mo.componentes.filter((c) => c.estado === 'PLANEJADO' || c.estado === 'BLOQUEADO');
  const bloqueiosReais = mo.bloqueios.filter((b) => !b.porDesenho);
  const porDesenho = mo.bloqueios.filter((b) => b.porDesenho);
  return (
    <aside className="mcc-painel" role="dialog" aria-label={`Módulo ${mo.modulo.titulo}`}>
      <header className="mcc-painel-cab">
        <div>
          <div className="mc-conta">{ROTULO_DOMINIO_CONSTRUCAO[mo.modulo.dominio]}</div>
          <h2>{mo.modulo.titulo}</h2>
        </div>
        <Badge tone={TONE_ESTADO_CONSTRUCAO[mo.estado]}>{ROTULO_ESTADO_CONSTRUCAO[mo.estado]}</Badge>
        <button className="btn sm" onClick={onFechar} aria-label="Fechar">Fechar</button>
      </header>
      <p className="small">{mo.modulo.resumo ?? mo.modulo.descricao}</p>
      <ProgressRow label="Componentes" valor={mo.fracao} texto={`${fracaoExecutiva(mo.concluidos, mo.total)} · ${pctConstrucao(mo.fracao)}`} tone={toneBarra(mo.estado)} />

      {/* V2A: primeiro o que falta, depois o que já foi feito */}
      {r.proximo
        ? <div className="mcc-proximo mcc-proximo-painel"><b>Próximo passo:</b> {r.proximo}</div>
        : <div className="mcc-proximo mcc-proximo-painel"><b>Tudo concluído.</b> Nenhum componente pendente.</div>}

      {r.pendenciasHumanas.length > 0 && (
        <>
          <h3 className="mc-sub">Esperando você ({r.pendenciasHumanas.length})</h3>
          <ListaEspera itens={r.pendenciasHumanas} comModulo={false} />
        </>
      )}
      {r.dependenciasBloqueadas.length > 0 && <Avisos r={{ ...r, pendenciasHumanas: [] }} />}

      {depois.length > 0 && (
        <>
          <h3 className="mc-sub">Falta fazer ({depois.length})</h3>
          <ul className="mcc-lista">{depois.map((c) => (
            <li key={c.id}>
              <Ponto c={c} /><span>{c.tituloExecutivo}</span>
              {c.estado === 'BLOQUEADO' && <Badge tone={c.porDesenho ? 'info' : 'bad'}>{c.porDesenho ? 'fechado de propósito' : 'bloqueado'}</Badge>}
              {c.tipoPendencia && <span className="mc-pill">{ROTULO_PENDENCIA[c.tipoPendencia]}</span>}
              {c.natureza && <span className="mc-pill">{ROTULO_NATUREZA[c.natureza]}</span>}
            </li>
          ))}</ul>
        </>
      )}

      {bloqueiosReais.length > 0 && (
        <>
          <h3 className="mc-sub">Bloqueios ({bloqueiosReais.length})</h3>
          <ul className="mcc-lista">{bloqueiosReais.map((b, i) => <li key={i}><Badge tone="bad">bloqueio</Badge><span>{b.titulo}</span></li>)}</ul>
        </>
      )}

      {andamento.length > 0 && (
        <>
          <h3 className="mc-sub">Em andamento ({andamento.length})</h3>
          <ul className="mcc-lista">{andamento.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.tituloExecutivo}</span>{c.tipoPendencia && c.tipoPendencia !== 'TRABALHO' && <span className="mc-pill">{ROTULO_PENDENCIA[c.tipoPendencia]}</span>}</li>)}</ul>
        </>
      )}

      <details className="mcc-concluidos" open={concluidos.length > 0 && concluidos.length <= LIMITE_CONCLUIDOS_ABERTOS}>
        <summary><h3 className="mc-sub">Concluídos ({concluidos.length})</h3></summary>
        <ul className="mcc-lista">{concluidos.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.tituloExecutivo}</span>{c.natureza && <span className="mc-pill">{ROTULO_NATUREZA[c.natureza]}</span>}</li>)}{!concluidos.length && <li className="muted small">nenhum ainda</li>}</ul>
      </details>

      <h3 className="mc-sub">Tarefas ligadas ({leituraValida ? mo.tarefas.length : SEM_LEITURA})</h3>
      {leituraValida && (mo.tarefas.length === 0
        ? <p className="small muted">Nenhuma tarefa informa este módulo. Tarefas sem módulo continuam visíveis em &quot;Tarefas em andamento&quot;.</p>
        : mo.tarefas.map((t) => <Tarefa key={t.id} i={t} agora={agora} />))}
      {mo.modulo.observaFonte && leituraValida && mo.observados.length > 0 && (
        <>
          <h3 className="mc-sub">Tarefas observadas da fábrica ({mo.observados.length})</h3>
          <p className="small muted">Produzidas por esta fonte; o módulo a que cada uma se refere continua não informado.</p>
          {mo.observados.slice(0, LIMITE_AGORA).map((t) => <Tarefa key={t.id} i={t} agora={agora} />)}
        </>
      )}

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div>
          <h3 className="mc-sub">Depende de</h3>
          {mo.dependeDe.length === 0 ? <p className="small muted">Nenhum módulo.</p> : <div className="mc-lista-gates">{mo.dependeDe.map((d) => <button key={d} className="mc-pill mcc-pill-btn" onClick={() => onIr(d)}>{moduloPorId(d)?.titulo ?? d}</button>)}</div>}
        </div>
        <div>
          <h3 className="mc-sub">Dependem dele</h3>
          {mo.dependentes.length === 0 ? <p className="small muted">Nenhum módulo.</p> : <div className="mc-lista-gates">{mo.dependentes.map((d) => <button key={d} className="mc-pill mcc-pill-btn" onClick={() => onIr(d)}>{moduloPorId(d)?.titulo ?? d}</button>)}</div>}
        </div>
      </div>
      {mo.modulo.rota && <p className="small" style={{ marginTop: 12 }}><a href={`#${mo.modulo.rota}`}>Abrir a tela do módulo</a></p>}

      {/* tudo que era técnico continua aqui, inteiro */}
      <details className="mcc-tecnico">
        <summary>Detalhe técnico</summary>
        <p className="small">{mo.modulo.descricao}</p>
        <div className="mcc-painel-proc small">
          {mo.procedencias.map((p) => <Badge key={p} tone={p === 'REPOSITORIO' ? 'muted' : 'ok'} title={p === 'REPOSITORIO' ? 'Catálogo compilado no build (snapshot)' : 'Leitura viva por prop'}>{p === 'REPOSITORIO' ? 'catálogo · snapshot' : `tarefas · ${ROTULO_PROCEDENCIA[p]}`}</Badge>)}
        </div>
        {mo.proximoPasso && <p className="small"><span className="muted">Próximo passo (técnico):</span> {mo.proximoPasso}</p>}
        <ul className="mcc-lista small">
          {mo.componentes.map((c) => (
            <li key={c.id}>
              <Ponto c={c} /><span>{c.titulo}</span>
              {c.origem === 'GATE' && c.prontidao && <span className="mc-conta">{c.prontidao.conta}</span>}
              {c.origem === 'PLANO' && <span className="mc-conta">plano declarado, sem evidência</span>}
            </li>
          ))}
        </ul>
        {(bloqueiosReais.length > 0 || porDesenho.length > 0) && mo.bloqueios.map((b, i) => (
          <div key={i} className={`mc-bloqueio ${b.porDesenho ? 'info' : 'bad'}`}><div className="mc-marco-cab"><b>{b.titulo}</b><Badge tone={b.porDesenho ? 'info' : 'bad'}>{b.porDesenho ? 'por desenho' : 'real'}</Badge></div><div className="small">{b.motivo}</div></div>
        ))}
      </details>
    </aside>
  );
}

export default function VisaoGeral({ estado, onIrPara }: { estado: EstadoStatusRemoto & { recarregar: () => void }; onIrPara: (aba: 'execucao' | 'mapa' | 'governanca') => void }) {
  const { dados, erro } = estado;
  const agora = new Date().toISOString();
  const itens = useMemo(() => (dados ? dados.workItems : null), [dados]);
  const panorama: PanoramaConstrucao = useMemo(() => panoramaConstrucao(itens), [itens]);
  const agoraLista = useMemo(() => (itens ? construindoAgora(itens) : []), [itens]);
  const emConstrucao = useMemo(() => emConstrucaoAgora(panorama), [panorama]);
  const espera = useMemo(() => esperandoVoce(panorama), [panorama]);
  const resumos = useMemo(() => new Map(panorama.modulos.map((p) => [p.modulo.id, resumoExecutivo(p, panorama)])), [panorama]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const primeiraLeitura = !dados && !erro;
  const leituraValida = panorama.tarefas !== null;
  const indisponiveis = [
    ...(dados?.repositorios.filter((r) => !r.disponivel).map((r) => r.repository.split('/')[1] ?? r.repository) ?? []),
    ...(erro ? ['leitura ao vivo do desenvolvimento'] : []),
  ];
  // barato e puro: recalcular a cada render é mais simples do que memorizar uma lista derivada de outra lista
  const atencao = atencaoConstrucao(panorama, { leituraValida, indisponiveis });
  const avisoFonte = atencao.filter((a) => a.tipo === 'SEM_LEITURA' || a.tipo === 'FONTE_INDISPONIVEL');
  const fatosVivos = atencao.filter((a) => a.tipo !== 'SEM_LEITURA' && a.tipo !== 'FONTE_INDISPONIVEL' && a.tipo !== 'MODULOS_BLOQUEADOS');

  const t = panorama.tarefas;
  const moduloAberto = aberto ? panorama.modulos.find((x) => x.modulo.id === aberto) : undefined;
  const listaAgora = verTodos ? agoraLista : agoraLista.slice(0, LIMITE_AGORA);
  const ordenados = ordemExecutiva(panorama.modulos);
  const ativos = ordenados.filter((p) => p.estado !== 'CONCLUIDO');
  const concluidos = ordenados.filter((p) => p.estado === 'CONCLUIDO');

  return (
    <>
      {/* UMA mensagem sobre a fonte viva; o resto da tela mostra "—" onde a contagem dependeria dela */}
      {!primeiraLeitura && avisoFonte.length > 0 && (
        <div className="alert warn mcc-fonte" role="status">
          <b>Sem leitura ao vivo do desenvolvimento.</b> {erro ? TEXTO_CODIGO_CLIENTE[erro] : avisoFonte.map((a) => a.texto).join(' ')} As tarefas aparecem como {SEM_LEITURA}; os módulos continuam valendo, porque vêm do catálogo.
        </div>
      )}

      <div className="mcc-numeros"><KpiStrip itens={[
        { label: 'Módulos do EIFF', value: panorama.total },
        { label: 'Concluídos', value: panorama.porEstado.CONCLUIDO, tone: 'pos' },
        { label: 'Em construção', value: panorama.porEstado.EM_CONSTRUCAO, tone: 'warn' },
        { label: 'Bloqueados', value: panorama.porEstado.BLOQUEADO, tone: panorama.porEstado.BLOQUEADO ? 'neg' : undefined },
        { label: 'Planejados', value: panorama.porEstado.PLANEJADO },
        { label: 'Esperando você', value: espera.length, tone: espera.length ? 'warn' : undefined },
      ]} /></div>

      <div className="mcc-exec">
        {/* ------------------------------------------------------------------ em construção agora */}
        <div className="card mcc-agora">
          <div className="mcc-topo"><h2>Em construção agora</h2><span className="small muted">{emConstrucao.length} módulo(s) · bloqueados primeiro</span></div>
          {emConstrucao.length === 0
            ? <p className="small muted">Nenhum módulo em construção ou bloqueado.</p>
            : <div className="mcc-linhas">{emConstrucao.map((r) => <LinhaConstrucao key={r.moduloId} r={r} onAbrir={setAberto} />)}</div>}
        </div>

        {/* ---------------------------------------------------------------------- esperando você */}
        <div className="card mcc-voce">
          <div className="mcc-topo"><h2>Esperando você</h2><span className="small muted">decisões e configurações declaradas</span></div>
          {espera.length === 0
            ? <p className="small muted">Nada depende de uma decisão ou configuração humana agora.</p>
            : <ListaEspera itens={espera} onAbrir={setAberto} comModulo />}
        </div>
      </div>

      {/* -------------------------------------------------------------------- tarefas ao vivo */}
      <div className="card mcc-vivas">
        <div className="mcc-topo">
          <h2>Tarefas em andamento</h2>
          <span className="small muted">ao vivo</span>
          <span className="spacer" />
          <button className="btn sm no-print" onClick={() => onIrPara('execucao')}>Quadro completo</button>
        </div>
        <div className="mcc-contas">
          {STATUS_ATIVOS.map((s) => (
            <span key={s} className={`mcc-conta-viva ${s}`}><b>{primeiraLeitura ? SEM_LEITURA : contagemViva(leituraValida, t ? t.porStatus[s] : 0)}</b> {ROTULO_MC_STATUS[s]}</span>
          ))}
          {t && t.semModulo > 0 && <span className="mcc-conta-viva"><b>{t.semModulo}</b> {SEM_MODULO.toLowerCase()}</span>}
        </div>
        {fatosVivos.length > 0 && <ul className="mcc-atencao-lista">{fatosVivos.map((a) => <li key={a.tipo} className={a.tipo === 'ITENS_STALE' || a.tipo === 'SEM_MODULO' ? 'info' : 'warn'}><Icon name="aviso" size={14} /> {a.texto}</li>)}</ul>}
        {primeiraLeitura && <p className="small muted">Lendo o estado da construção…</p>}
        {itens && (agoraLista.length === 0
          ? <p className="small muted">Nenhuma tarefa em execução, validação, aguardando pessoa ou bloqueada na última leitura.</p>
          : (
            <>
              <div className="mcc-tarefas">{listaAgora.map((i) => <Tarefa key={i.id} i={i} agora={agora} />)}</div>
              {agoraLista.length > LIMITE_AGORA && <button className="btn sm no-print" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Mostrar menos' : `Ver todas (${agoraLista.length})`}</button>}
            </>
          ))}
      </div>

      {/* ------------------------------------------------------------------------- panorama */}
      <div className="card mcc-panorama">
        <div className="mcc-topo"><h2>Panorama dos módulos</h2><span className="small muted">bloqueados e em construção primeiro</span><span className="spacer" /><button className="btn sm no-print" onClick={() => onIrPara('mapa')}>Mapa vivo</button></div>
        {ativos.length > 0 && <div className="mcc-grid">{ativos.map((mo) => <CartaoModulo key={mo.modulo.id} r={resumos.get(mo.modulo.id)!} mo={mo} leituraValida={leituraValida} onAbrir={setAberto} />)}</div>}
        <h3 className="mc-sub mcc-sub-concluidos">Concluídos ({concluidos.length})</h3>
        {DOMINIOS_CONSTRUCAO.map((d) => {
          const doDominio = panorama.modulos.filter((x) => x.modulo.dominio === d);
          const prontos = concluidos.filter((x) => x.modulo.dominio === d);
          if (!prontos.length) return null;
          return (
            <section key={d} className="mcc-dominio">
              <div className="mcc-dominio-cab small"><b>{ROTULO_DOMINIO_CONSTRUCAO[d]}</b> <span className="muted">{fracaoExecutiva(prontos.length, doDominio.length)} módulos concluídos</span></div>
              <div className="mcc-tiles">{prontos.map((mo) => <TileConcluido key={mo.modulo.id} r={resumos.get(mo.modulo.id)!} onAbrir={setAberto} />)}</div>
            </section>
          );
        })}
      </div>

      {moduloAberto && <PainelModulo mo={moduloAberto} panorama={panorama} agora={agora} leituraValida={leituraValida} onFechar={() => setAberto(null)} onIr={setAberto} />}
      {moduloAberto && <div className="mcc-painel-bg no-print" onClick={() => setAberto(null)} aria-hidden="true" />}
    </>
  );
}
