// Mission Control · Visão geral — a Central de Construção do EIFF (MC-CONSTRUCTION-1).
//
// Responde em dez segundos: o que compõe o EIFF, o que já foi construído, o que está sendo construído agora,
// o que é plano, o que está bloqueado, quais tarefas pertencem a cada módulo e qual é o próximo passo.
//
// Nada é calculado aqui: o catálogo e as projeções vêm de src/core/central/construcao.ts (SNAPSHOT do
// repositório) e as tarefas vêm do MESMO estado remoto lido uma vez pela tela principal (LIVE, por prop).
// A tela OBSERVA: nenhum clique escreve em fonte alguma. Task sem módulo informado pela fonte NÃO some.
import React, { useEffect, useMemo, useState } from 'react';
import {
  DOMINIOS_CONSTRUCAO, ROTULO_DOMINIO_CONSTRUCAO, ROTULO_ESTADO_CONSTRUCAO, ROTULO_NATUREZA, SEM_MODULO, STATUS_ATIVOS, TONE_ESTADO_CONSTRUCAO,
  atencaoConstrucao, construindoAgora, fracaoTexto, moduloDaTarefa, moduloPorId, panoramaConstrucao, pctConstrucao,
  type ComponenteProjetado, type ModuloProjetado, type PanoramaConstrucao,
} from '../core/central/construcao';
import { SEM_EVIDENCIA_DE_CI, ciDoItem, haQuantoTempo, rotuloProcedenciaDoItem } from '../core/central/quadroOperacional';
import { LIMITE_STALE_GITHUB_S, avaliarStatusVivo, type SituacaoVivo } from '../core/central/statusVivo';
import { ROTULO_MC_STATUS, ROTULO_PROCEDENCIA, type McStatus, type MissionControlWorkItem } from '../core/central/workItem';
import { TEXTO_CODIGO_CLIENTE, type EstadoStatusRemoto } from '../data/statusRemoto';
import { Badge, Empty, KpiHero, ProgressRow, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';

const TONE_VIVO: Record<SituacaoVivo, Tone> = { LIVE: 'ok', SNAPSHOT: 'warn', STALE: 'warn', UNAVAILABLE: 'bad' };
const TONE_STATUS: Partial<Record<McStatus, Tone>> = { EXECUTANDO: 'ok', AGUARDANDO_HUMANO: 'warn', BLOQUEADO: 'bad', EM_VALIDACAO: 'info', CONCLUIDO: 'muted' };
const LIMITE_AGORA = 12;

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

/** Linha compacta de tarefa. O detalhe abre por disclosure; nada aqui move a tarefa. */
function Tarefa({ i, agora }: { i: MissionControlWorkItem; agora: string }) {
  const mo = moduloDaTarefa(i);
  return (
    <details className="mcc-tarefa" data-status={i.status}>
      <summary>
        <b className="mcc-tarefa-id">{i.correlationId ?? i.sourceId}</b>
        <span className="mcc-tarefa-titulo">{i.title}</span>
        <Badge tone={TONE_STATUS[i.status]}>{ROTULO_MC_STATUS[i.status]}</Badge>
        <span className="mcq-cru" title="Estado cru da fonte, sempre preservado">{i.statusOrigem}</span>
        <span className={`mcc-tarefa-mod${mo ? '' : ' muted'}`} title={mo ? 'Módulo informado pelo contrato do item' : 'A fonte não informa a que módulo esta tarefa pertence; nada é inferido.'}>{mo ? mo.titulo : SEM_MODULO}</span>
        {i.frescor.fonteIndisponivel ? <Badge tone="bad">fonte fora</Badge> : i.frescor.stale ? <Badge tone="warn">vencido</Badge> : null}
      </summary>
      <div className="mcc-tarefa-corpo small">
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

function CartaoModulo({ mo, tarefasDisponiveis, onAbrir }: { mo: ModuloProjetado; tarefasDisponiveis: boolean; onAbrir: (id: string) => void }) {
  const dep = mo.dependeDe.map((d) => moduloPorId(d)?.titulo ?? d);
  const bloqueiosReais = mo.bloqueios.filter((b) => !b.porDesenho).length;
  return (
    <article className={`mcc-card ${mo.estado}`} data-modulo={mo.modulo.id}>
      <header className="mcc-card-cab">
        <b>{mo.modulo.titulo}</b>
        <Badge tone={TONE_ESTADO_CONSTRUCAO[mo.estado]}>{ROTULO_ESTADO_CONSTRUCAO[mo.estado]}</Badge>
      </header>
      <ProgressRow label="" valor={mo.fracao} texto={`${fracaoTexto(mo.concluidos, mo.total)} componentes`} tone={mo.estado === 'CONCLUIDO' ? 'ok' : mo.estado === 'BLOQUEADO' ? 'bad' : 'warn'} />
      <ul className="mcc-comp">
        {mo.componentes.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.titulo}</span></li>)}
      </ul>
      <div className="mcc-card-meta small">
        <span title={tarefasDisponiveis ? 'Tarefas cujo contrato informa este módulo' : 'Sem leitura das fontes vivas'}>
          <Icon name="checks" size={13} /> {tarefasDisponiveis ? `${mo.tarefasAtivas} tarefa(s) ativa(s)` : 'tarefas: sem leitura'}
        </span>
        {mo.modulo.observaFonte && tarefasDisponiveis && <span title="Itens produzidos pela fonte observada; não é pertença"><Icon name="fabrica" size={13} /> {mo.observados.length} job(s) observado(s)</span>}
        {bloqueiosReais > 0 && <span className="neg"><Icon name="aviso" size={13} /> {bloqueiosReais} bloqueio(s)</span>}
      </div>
      {mo.proximoPasso && <div className="mcc-proximo small"><span className="muted">Próximo:</span> {mo.proximoPasso}</div>}
      {dep.length > 0 && <div className="mcc-dep small muted">Depende de {dep.join(', ')}</div>}
      <button className="btn sm mcc-abrir no-print" onClick={() => onAbrir(mo.modulo.id)}>Abrir módulo</button>
    </article>
  );
}

function PainelModulo({ mo, agora, tarefasDisponiveis, onFechar, onIr }: { mo: ModuloProjetado; agora: string; tarefasDisponiveis: boolean; onFechar: () => void; onIr: (id: string) => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  const concluidos = mo.componentes.filter((c) => c.estado === 'CONCLUIDO');
  const andamento = mo.componentes.filter((c) => c.estado === 'EM_CONSTRUCAO');
  const depois = mo.componentes.filter((c) => c.estado === 'PLANEJADO' || (c.estado === 'BLOQUEADO'));
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
      <p className="small">{mo.modulo.descricao}</p>
      <div className="mcc-painel-proc small">
        {mo.procedencias.map((p) => <Badge key={p} tone={p === 'REPOSITORIO' ? 'muted' : 'ok'} title={p === 'REPOSITORIO' ? 'Catálogo compilado no build (snapshot)' : 'Leitura viva por prop'}>{p === 'REPOSITORIO' ? 'catálogo · snapshot' : `tarefas · ${ROTULO_PROCEDENCIA[p]}`}</Badge>)}
      </div>
      <ProgressRow label="Componentes" valor={mo.fracao} texto={`${fracaoTexto(mo.concluidos, mo.total)} · ${pctConstrucao(mo.fracao)}`} tone={mo.estado === 'CONCLUIDO' ? 'ok' : mo.estado === 'BLOQUEADO' ? 'bad' : 'warn'} />

      <h3 className="mc-sub">Concluído ({concluidos.length})</h3>
      <ul className="mcc-lista">{concluidos.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.titulo}</span>{c.natureza && <span className="mc-pill">{ROTULO_NATUREZA[c.natureza]}</span>}{c.origem === 'GATE' && c.prontidao && <span className="mc-conta">{c.prontidao.conta}</span>}</li>)}{!concluidos.length && <li className="muted small">nenhum</li>}</ul>
      <h3 className="mc-sub">Em andamento ({andamento.length})</h3>
      <ul className="mcc-lista">{andamento.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.titulo}</span>{c.prontidao && <span className="mc-conta">{c.prontidao.conta}</span>}</li>)}{!andamento.length && <li className="muted small">nenhum</li>}</ul>
      <h3 className="mc-sub">Vem depois ({depois.length})</h3>
      <ul className="mcc-lista">{depois.map((c) => <li key={c.id}><Ponto c={c} /><span>{c.titulo}</span>{c.estado === 'BLOQUEADO' && <Badge tone={c.porDesenho ? 'info' : 'bad'}>{c.porDesenho ? 'por desenho' : 'bloqueado'}</Badge>}{c.natureza && <span className="mc-pill">{ROTULO_NATUREZA[c.natureza]}</span>}{c.origem === 'PLANO' && <span className="mc-conta">plano declarado, sem evidência</span>}</li>)}{!depois.length && <li className="muted small">nada pendente</li>}</ul>

      {mo.proximoPasso && <div className="mcc-proximo"><b>Próximo passo:</b> {mo.proximoPasso}</div>}

      <h3 className="mc-sub">Bloqueios ({mo.bloqueios.length})</h3>
      {mo.bloqueios.length === 0 ? <p className="small muted">Nenhum.</p> : mo.bloqueios.map((b, i) => (
        <div key={i} className={`mc-bloqueio ${b.porDesenho ? 'info' : 'bad'}`}><div className="mc-marco-cab"><b>{b.titulo}</b><Badge tone={b.porDesenho ? 'info' : 'bad'}>{b.porDesenho ? 'por desenho' : 'real'}</Badge></div><div className="small">{b.motivo}</div></div>
      ))}

      <h3 className="mc-sub">Tarefas ligadas ({tarefasDisponiveis ? mo.tarefas.length : '—'})</h3>
      {!tarefasDisponiveis
        ? <p className="small muted">Sem leitura das fontes vivas: não dá para dizer quantas tarefas existem.</p>
        : mo.tarefas.length === 0
          ? <p className="small muted">Nenhuma tarefa informa este módulo no contrato da fonte. Tarefas sem módulo continuam visíveis em &quot;Construindo agora&quot;.</p>
          : mo.tarefas.map((t) => <Tarefa key={t.id} i={t} agora={agora} />)}
      {mo.modulo.observaFonte && tarefasDisponiveis && mo.observados.length > 0 && (
        <>
          <h3 className="mc-sub">Jobs observados da fonte ({mo.observados.length})</h3>
          <p className="small muted">Produzidos por esta fonte; o módulo a que cada job se refere continua não informado.</p>
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
    </aside>
  );
}

export default function VisaoGeral({ estado, onIrPara }: { estado: EstadoStatusRemoto & { recarregar: () => void }; onIrPara: (aba: 'execucao' | 'mapa' | 'governanca') => void }) {
  const { dados, recebidoEm, erro } = estado;
  const agora = new Date().toISOString();
  const itens = useMemo(() => (dados ? dados.workItems : null), [dados]);
  const panorama: PanoramaConstrucao = useMemo(() => panoramaConstrucao(itens), [itens]);
  const agoraLista = useMemo(() => (itens ? construindoAgora(itens) : []), [itens]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const fonte = dados?.fontes.github;
  const primeiraLeitura = !dados && !erro;
  const vivo = avaliarStatusVivo({
    disponivel: !!fonte?.disponivel && !erro,
    erroCodigo: fonte?.erroCodigo,
    observadoEm: fonte?.observadoEm ?? recebidoEm,
    agora,
    limiteStaleSegundos: dados?.limiteStaleSegundos ?? LIMITE_STALE_GITHUB_S,
    build: dados?.build,
    shaMainObservado: dados?.repositorios.find((r) => r.papel === 'produto')?.main?.sha ?? null,
  });
  const indisponiveis = [
    ...(dados?.repositorios.filter((r) => !r.disponivel).map((r) => r.repository.split('/')[1] ?? r.repository) ?? []),
    ...(erro ? ['/api/development-status'] : []),
  ];
  // barato e puro: recalcular a cada render é mais simples do que memorizar uma lista derivada de outra lista
  const atencao = atencaoConstrucao(panorama, { leituraValida: !!dados, indisponiveis });

  const t = panorama.tarefas;
  const moduloAberto = aberto ? panorama.modulos.find((x) => x.modulo.id === aberto) : undefined;
  const listaAgora = verTodos ? agoraLista : agoraLista.slice(0, LIMITE_AGORA);

  return (
    <>
      <div className="hero-grid">
        <KpiHero
          label="Módulos do EIFF"
          value={panorama.total}
          sufixo="no catálogo"
          tone={panorama.porEstado.BLOQUEADO ? 'bad' : 'ok'}
          hint={<>Catálogo compilado no build (<b>snapshot</b>): cada módulo aponta para arquivo, símbolo ou gate que a suíte confere. Estado = contagem de componentes, nunca estimativa.</>}
          secundarios={[
            { label: 'Concluídos', value: panorama.porEstado.CONCLUIDO, tone: 'pos' },
            { label: 'Em construção', value: panorama.porEstado.EM_CONSTRUCAO, tone: 'warn' },
            { label: 'Planejados', value: panorama.porEstado.PLANEJADO },
            { label: 'Bloqueados', value: panorama.porEstado.BLOQUEADO, tone: panorama.porEstado.BLOQUEADO ? 'neg' : undefined },
          ]}
        >
          {DOMINIOS_CONSTRUCAO.map((d) => {
            const dos = panorama.modulos.filter((x) => x.modulo.dominio === d);
            const ok = dos.filter((x) => x.estado === 'CONCLUIDO').length;
            return <ProgressRow key={d} label={ROTULO_DOMINIO_CONSTRUCAO[d]} valor={dos.length ? ok / dos.length : 0} texto={`${ok}/${dos.length} concluídos`} tone={ok === dos.length ? 'ok' : 'warn'} />;
          })}
        </KpiHero>

        <KpiHero
          label="Tarefas ativas"
          value={t ? t.ativas : '—'}
          sufixo={t ? 'agora' : primeiraLeitura ? 'lendo…' : 'sem leitura'}
          tone={!t ? 'warn' : t.porStatus.BLOQUEADO ? 'bad' : 'ok'}
          hint={primeiraLeitura ? <>Lendo o estado da construção…</> : <><Badge tone={TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>{vivo.rotulo}</Badge> {vivo.detalhe}{erro && <> · {TEXTO_CODIGO_CLIENTE[erro]}</>}</>}
          secundarios={STATUS_ATIVOS.map((s) => ({ label: ROTULO_MC_STATUS[s], value: t ? t.porStatus[s] : '—', tone: s === 'BLOQUEADO' && t?.porStatus[s] ? 'neg' : s === 'AGUARDANDO_HUMANO' && t?.porStatus[s] ? 'warn' : undefined }))}
        >
          {t && (
            <>
              <ProgressRow label="Com módulo informado" valor={t.total ? t.comModulo / t.total : 0} texto={`${t.comModulo}/${t.total}`} tone={t.semModulo ? 'warn' : 'ok'} />
              <p className="small muted">{t.semModulo > 0 ? `${t.semModulo} tarefa(s) sem módulo: a fonte não informa e nada é inferido.` : 'Toda tarefa informa o módulo.'} Contagem de {t.total} item(ns) observado(s).</p>
            </>
          )}
        </KpiHero>
      </div>

      {/* ------------------------------------------------------------------------------ atenção */}
      <div className="card mcc-atencao">
        <div className="mcc-topo"><h2>Atenção</h2><span className="small muted">Só fatos derivados das fontes</span></div>
        {atencao.length === 0
          ? <p className="small muted">Nada exige atenção agora.</p>
          : <ul className="mcc-atencao-lista">{atencao.map((a) => <li key={a.tipo} className={a.tipo === 'ITENS_STALE' || a.tipo === 'SEM_MODULO' ? 'info' : 'warn'}><Icon name="aviso" size={14} /> {a.texto}</li>)}</ul>}
      </div>

      {/* ---------------------------------------------------------------------- construindo agora */}
      <div className="card">
        <div className="mcc-topo">
          <h2>Construindo agora</h2>
          <Badge tone={primeiraLeitura ? 'muted' : TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>{primeiraLeitura ? 'Lendo…' : vivo.rotulo}</Badge>
          <span className="spacer" />
          <button className="btn sm no-print" onClick={() => onIrPara('execucao')}>Quadro completo</button>
        </div>
        {!itens
          ? (primeiraLeitura ? <p className="small muted">Lendo o estado da construção…</p> : <Empty icone="aviso" titulo="Sem leitura das fontes vivas">{erro ? TEXTO_CODIGO_CLIENTE[erro] : 'A fonte não respondeu.'} Nada foi inventado no lugar.</Empty>)
          : agoraLista.length === 0
            ? <Empty icone="checks" titulo="Nenhuma tarefa ativa">A leitura chegou; não há item em execução, validação, aguardando humano ou bloqueado.</Empty>
            : (
              <>
                <div className="mcc-tarefas">{listaAgora.map((i) => <Tarefa key={i.id} i={i} agora={agora} />)}</div>
                {agoraLista.length > LIMITE_AGORA && <button className="btn sm no-print" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Mostrar menos' : `Ver todas (${agoraLista.length})`}</button>}
              </>
            )}
      </div>

      {/* ------------------------------------------------------------------------- panorama */}
      <div className="card">
        <div className="mcc-topo"><h2>Panorama dos módulos</h2><span className="small muted">Clique em um módulo para o detalhe · <button className="btn sm no-print" onClick={() => onIrPara('mapa')}>Mapa vivo</button></span></div>
        {DOMINIOS_CONSTRUCAO.map((d) => {
          const dos = panorama.modulos.filter((x) => x.modulo.dominio === d);
          if (!dos.length) return null;
          return (
            <section key={d} className="mcc-dominio">
              <h3 className="mc-sub">{ROTULO_DOMINIO_CONSTRUCAO[d]} <span className="mc-conta">{dos.length}</span></h3>
              <div className="mcc-grid">{dos.map((mo) => <CartaoModulo key={mo.modulo.id} mo={mo} tarefasDisponiveis={!!t} onAbrir={setAberto} />)}</div>
            </section>
          );
        })}
      </div>

      {moduloAberto && <PainelModulo mo={moduloAberto} agora={agora} tarefasDisponiveis={!!t} onFechar={() => setAberto(null)} onIr={setAberto} />}
      {moduloAberto && <div className="mcc-painel-bg no-print" onClick={() => setAberto(null)} aria-hidden="true" />}
    </>
  );
}
