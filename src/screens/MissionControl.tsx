// Mission Control da EIFF Central — painel executivo da construcao.
//
// Nada e calculado aqui: todo numero vem de src/core/central/missionControl.ts, sempre como contagem de
// gates fechados sobre gates exigidos. A tela mostra a conta ao lado do numero justamente para que
// ninguem precise acreditar na porcentagem.
import React, { useMemo, useState } from 'react';
import {
  BENEFICIOS, CAMADAS, DEGRAUS, GATES, MARCOS, ONDAS, WORKSTREAMS,
  beneficioDesbloqueado, gatePorId, gatesDoDegrau, pctGates, prontidao, prontidaoDaCamada, prontidaoDoDegrau,
  prontidaoDoMarco, prontidaoDoWorkstream, resumoMissionControl,
  type Gate, type Prontidao, type SituacaoGate,
} from '../core/central/missionControl';
import { Badge, Empty, KpiHero, KpiStrip, PageHead, PrintHead, ProgressRow, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';
import { Tabela } from '../ui/Tabela';

const ROTULO_SITUACAO: Record<SituacaoGate, string> = { fechado: 'Fechado', aberto: 'Aberto', bloqueado: 'Bloqueado' };
const toneDoGate = (g: Gate): Tone => (g.situacao === 'fechado' ? 'ok' : g.situacao === 'aberto' ? 'muted' : g.porDesenho ? 'info' : 'bad');
const rotuloDoGate = (g: Gate) => (g.situacao === 'bloqueado' && g.porDesenho ? 'Fechado de propósito' : ROTULO_SITUACAO[g.situacao]);
const temBloqueioReal = (p: Prontidao) => p.faltando.some((x) => x.situacao === 'bloqueado' && !x.porDesenho);
const toneDaProntidao = (p: Prontidao): 'ok' | 'warn' | 'bad' => (p.pronto ? 'ok' : temBloqueioReal(p) ? 'bad' : 'warn');
const frenteDoGate = (id: string) => WORKSTREAMS.find((w) => w.gates.includes(id));

function Conta({ p }: { p: Prontidao }) {
  return <span className="mc-conta" title="Prontidão é contagem de gates fechados sobre gates exigidos — nunca um número digitado">{p.conta}</span>;
}

export default function MissionControl() {
  const [situacao, setSituacao] = useState<SituacaoGate | 'todos'>('todos');
  const [frente, setFrente] = useState<string>('');

  const r = useMemo(() => resumoMissionControl(), []);
  const gatesFiltrados = useMemo(
    () => GATES.filter((g) => (situacao === 'todos' || g.situacao === situacao) && (!frente || frenteDoGate(g.id)?.id === frente)),
    [situacao, frente],
  );

  const prox = r.proximoDegrau;
  const proxP = r.prontidaoProximoDegrau;
  const marco = r.proximoMarco;
  const marcoP = r.prontidaoProximoMarco;

  return (
    <>
      <PrintHead titulo="Mission Control · EIFF Central" subtitulo="Prontidão derivada de gates com evidência verificável" />
      <PageHead
        title="Mission Control · EIFF Central"
        subtitle={<>Quanto falta, o que já funciona, o que está bloqueado e quando cada degrau abre. Toda prontidão desta tela é <b>contagem de gates fechados sobre gates exigidos</b>: nenhum número é digitado à mão, e cada gate fechado aponta para um arquivo, um teste ou um commit que existe no repositório. É um <b>snapshot</b> derivado do código — não é tempo real.</>}
      >
        <div className="actions no-print">
          <Badge tone="muted" title="Prontidão derivada do código no momento do build. Não há endpoint de status, adapter do GitHub nem polling: o que está aqui é o retrato do repositório, não o estado ao vivo (gate MISSION_CONTROL_LIVE).">Snapshot do desenvolvimento</Badge>
          <button className="btn" onClick={() => window.print()}><Icon name="livro" size={15} /> Imprimir</button>
        </div>
      </PageHead>

      <div className={`alert ${r.bloqueiosReais.length ? 'warn' : 'info'}`}>
        <b>Agora:</b> {r.faltaPara} {r.bloqueiosReais.length > 0 && <>· <b>{r.bloqueiosReais.length}</b> bloqueio(s) real(is) em aberto.</>} {r.bloqueiosPorDesenho.length > 0 && <>· <b>{r.bloqueiosPorDesenho.length}</b> fechado(s) de propósito (nada é enviado, nada é gravado).</>}
      </div>

      {/* ------------------------------------------------------------------ System Readiness */}
      <div className="hero-grid">
        <KpiHero
          label="Prontidão do sistema"
          value={`${r.sistema.fechados}/${r.sistema.exigidos}`}
          sufixo="gates com evidência"
          tone={toneDaProntidao(r.sistema)}
          hint={<>{r.sistema.conta} · {pctGates(r.sistema)} — um gate só fecha com arquivo, teste ou commit que a suíte abre e confere.</>}
          secundarios={[
            { label: 'Fechados', value: r.sistema.fechados, tone: 'pos' },
            { label: 'Abertos', value: r.sistema.abertos },
            { label: 'Fechados de propósito', value: r.bloqueiosPorDesenho.length },
            { label: 'Bloqueios reais', value: r.bloqueiosReais.length, tone: r.bloqueiosReais.length ? 'neg' : undefined },
          ]}
        >
          {WORKSTREAMS.map((w) => { const p = prontidaoDoWorkstream(w); return <ProgressRow key={w.id} label={w.titulo} valor={p.fracao} texto={`${p.fechados}/${p.exigidos}`} tone={toneDaProntidao(p)} />; })}
        </KpiHero>

        <KpiHero
          label="Próximo degrau"
          value={prox ? prox.titulo : 'Tudo liberado'}
          tone={proxP ? toneDaProntidao(proxP) : 'ok'}
          hint={prox ? <>{prox.publico} — {prox.oQueMuda}</> : 'Todos os degraus da escada estão liberados.'}
          secundarios={proxP ? [
            { label: 'Exigidos', value: proxP.exigidos },
            { label: 'Fechados', value: proxP.fechados, tone: 'pos' },
            { label: 'Faltam', value: proxP.faltando.length, tone: 'warn' },
            { label: 'Degrau liberado hoje', value: r.degrauAtual?.titulo ?? 'nenhum' },
          ] : undefined}
        >
          {proxP && <ProgressRow label={prox!.titulo} valor={proxP.fracao} texto={`${proxP.fechados}/${proxP.exigidos}`} tone={toneDaProntidao(proxP)} />}
          {proxP && (
            <ul className="mc-falta">
              {proxP.faltando.map((f) => (
                <li key={f.id}><Badge tone={toneDoGate(f)}>{rotuloDoGate(f)}</Badge> <b>{f.titulo}</b><span className="mc-prova">{f.bloqueio ?? f.prova}</span></li>
              ))}
            </ul>
          )}
        </KpiHero>
      </div>

      <KpiStrip itens={[
        { label: 'Próximo marco', value: marco?.titulo ?? '—', hint: marcoP ? marcoP.conta : undefined },
        { label: 'Degrau liberado hoje', value: r.degrauAtual?.titulo ?? 'nenhum', hint: 'escada é cumulativa' },
        { label: 'Bloqueios reais', value: r.bloqueiosReais.length, tone: r.bloqueiosReais.length ? 'neg' : 'pos', hint: 'precisam de decisão ou trabalho' },
        { label: 'Fechados de propósito', value: r.bloqueiosPorDesenho.length, hint: 'segurança por desenho' },
        { label: 'Benefícios destravados', value: `${r.beneficiosAtivos}/${r.beneficiosTotal}`, hint: 'o que a empresa já ganhou' },
        { label: 'Ondas concluídas', value: ONDAS.filter((o) => o.situacao === 'concluida').length, hint: `${ONDAS.filter((o) => o.situacao === 'em_andamento').length} em andamento` },
      ]} />

      {/* ---------------------------------------------------------- Milestones e Blockers */}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Marcos</h2>
          <p className="small muted">Cada marco é um conjunto de gates. A barra é a contagem, não uma estimativa.</p>
          {MARCOS.map((m) => { const p = prontidaoDoMarco(m); return (
            <div key={m.id} className="mc-marco">
              <div className="mc-marco-cab">
                <b>{m.titulo}</b>
                <Badge tone={p.pronto ? 'ok' : temBloqueioReal(p) ? 'bad' : 'muted'}>{p.pronto ? 'fechado' : `faltam ${p.faltando.length}`}</Badge>
                <Conta p={p} />
              </div>
              <div className="small muted">{m.objetivo}</div>
              <ProgressRow label="" valor={p.fracao} texto={`${p.fechados}/${p.exigidos}`} tone={toneDaProntidao(p)} />
              {!p.pronto && <div className="mc-prova">Falta: {p.faltando.map((f) => f.titulo).join(' · ')}</div>}
            </div>
          ); })}
        </div>

        <div className="card">
          <h2>Bloqueios</h2>
          <p className="small muted">Bloqueio por desenho é segurança intencional e não é atraso. Bloqueio real precisa de decisão ou trabalho.</p>
          <h3 className="mc-sub">Reais ({r.bloqueiosReais.length})</h3>
          {r.bloqueiosReais.length === 0
            ? <Empty icone="checks" titulo="Nenhum bloqueio real">Todo impedimento em aberto é intencional.</Empty>
            : r.bloqueiosReais.map((g) => (
              <div key={g.id} className="mc-bloqueio bad">
                <div className="mc-marco-cab"><b>{g.titulo}</b><Badge tone="bad">bloqueado</Badge>{frenteDoGate(g.id) && <span className="mc-conta">{frenteDoGate(g.id)!.titulo}</span>}</div>
                <div className="small">{g.bloqueio}</div>
                <div className="mc-prova">Fecha quando: {g.prova}</div>
              </div>
            ))}
          <h3 className="mc-sub">Fechados de propósito ({r.bloqueiosPorDesenho.length})</h3>
          {r.bloqueiosPorDesenho.map((g) => (
            <div key={g.id} className="mc-bloqueio info">
              <div className="mc-marco-cab"><b>{g.titulo}</b><Badge tone="info">por desenho</Badge>{frenteDoGate(g.id) && <span className="mc-conta">{frenteDoGate(g.id)!.titulo}</span>}</div>
              <div className="small">{g.bloqueio}</div>
              <div className="mc-prova">Abre quando: {g.prova}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------- Release Ladder */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Escada de liberação</h2>
        <p className="small muted">Cada degrau exige os gates dele mais todos os anteriores. &quot;Quando podemos iniciar X&quot; tem resposta factual: os gates que ainda faltam, listados abaixo.</p>
        <div className="mc-escada">
          {DEGRAUS.map((d, i) => { const p = prontidaoDoDegrau(d); return (
            <div key={d.id} className={`mc-degrau ${p.pronto ? 'liberado' : ''} ${prox?.id === d.id ? 'proximo' : ''}`}>
              <div className="mc-degrau-cab">
                <span className="mc-passo">{i + 1}</span>
                <b>{d.titulo}</b>
                <Badge tone={p.pronto ? 'ok' : prox?.id === d.id ? 'warn' : 'muted'}>{p.pronto ? 'liberado' : prox?.id === d.id ? 'a seguir' : 'depois'}</Badge>
              </div>
              <div className="small muted">{d.publico}</div>
              <div className="small">{d.oQueMuda}</div>
              <ProgressRow label="" valor={p.fracao} texto={`${p.fechados}/${p.exigidos}`} tone={toneDaProntidao(p)} />
              <div className="mc-prova">{p.pronto ? `Todos os ${p.exigidos} gates fechados.` : `Faltam ${p.faltando.length} de ${p.exigidos}:`}</div>
              {!p.pronto && <ul className="mc-lista">{p.faltando.map((f) => <li key={f.id}><Badge tone={toneDoGate(f)}>{rotuloDoGate(f)}</Badge> {f.titulo}</li>)}</ul>}
              <div className="mc-conta">{gatesDoDegrau(d.id).length} gates acumulados · {pctGates(p)}</div>
            </div>
          ); })}
        </div>
      </div>

      {/* ------------------------------------------------------------------------- Squad */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Frentes de trabalho</h2>
        <p className="small muted">Cada gate tem exatamente um dono — a suíte falha se sobrar gate sem frente ou com duas.</p>
        <Tabela
          colunas={[
            { titulo: 'Frente', ordenar: (w) => w.titulo },
            { titulo: 'Responsável', ordenar: (w) => w.responsavel },
            { titulo: 'Onda', ordenar: (w) => w.onda },
            { titulo: 'Foco' },
            { titulo: 'Gates', num: true, ordenar: (w) => prontidaoDoWorkstream(w).fracao },
            { titulo: 'Prontidão' },
          ]}
          linhas={WORKSTREAMS}
          className="mc-tabela"
          chave={(w) => w.id}
          linha={(w) => { const p = prontidaoDoWorkstream(w); return (
            <>
              <td><b>{w.titulo}</b></td>
              <td>{w.responsavel}</td>
              <td className="small">{w.onda}</td>
              <td className="small muted">{w.foco}</td>
              <td className="num">{p.fechados}/{p.exigidos}</td>
              <td style={{ minWidth: 180 }}><ProgressRow label="" valor={p.fracao} texto={pctGates(p)} tone={toneDaProntidao(p)} /></td>
            </>
          ); }}
        />
      </div>

      {/* -------------------------------------------------------------- Architecture Map */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Mapa da arquitetura</h2>
        <p className="small muted">Cada seta é uma fronteira: quebrou uma, para. A prontidão de cada camada é a contagem dos gates daquela camada.</p>
        <div className="mc-camadas">
          {CAMADAS.map((c, i) => { const p = prontidaoDaCamada(c); return (
            <React.Fragment key={c.id}>
              {i > 0 && <div className="mc-seta" aria-hidden="true"><Icon name="seta" size={14} /></div>}
              <div className={`mc-camada ${toneDaProntidao(p)}`}>
                <div className="mc-camada-cab"><b>{c.titulo}</b><Badge tone={p.pronto ? 'ok' : temBloqueioReal(p) ? 'bad' : 'muted'}>{p.fechados}/{p.exigidos}</Badge></div>
                <div className="small muted">{c.papel}</div>
                <div className="mc-lista-gates">
                  {c.gates.map((id) => { const g = gatePorId(id)!; return <span key={id} className={`mc-pill ${toneDoGate(g)}`} title={`${rotuloDoGate(g)} — ${g.prova}`}>{g.titulo}</span>; })}
                </div>
              </div>
            </React.Fragment>
          ); })}
        </div>
      </div>

      {/* ------------------------------------------------------- Gates e status de desenvolvimento */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Gates e evidência</h2>
        <p className="small muted">Um gate só aparece fechado com evidência concreta. O teste <code>missionControl.test.ts</code> abre cada arquivo citado e procura o símbolo: evidência decorativa quebra a suíte.</p>
        <div className="actions no-print" style={{ marginBottom: 10 }}>
          {(['todos', 'fechado', 'aberto', 'bloqueado'] as const).map((s) => (
            <button key={s} className={`btn sm ${situacao === s ? 'primary' : ''}`} onClick={() => setSituacao(s)}>
              {s === 'todos' ? `Todos (${GATES.length})` : `${ROTULO_SITUACAO[s]} (${GATES.filter((g) => g.situacao === s).length})`}
            </button>
          ))}
          <span className="mc-conta" style={{ marginLeft: 8 }}>Frente:</span>
          <button className={`btn sm ${frente === '' ? 'primary' : ''}`} onClick={() => setFrente('')}>Todas</button>
          {WORKSTREAMS.map((w) => <button key={w.id} className={`btn sm ${frente === w.id ? 'primary' : ''}`} onClick={() => setFrente(w.id)}>{w.titulo}</button>)}
        </div>
        <Tabela
          colunas={[
            { titulo: 'Gate', ordenar: (g) => g.titulo },
            { titulo: 'Frente', ordenar: (g) => frenteDoGate(g.id)?.titulo ?? '' },
            { titulo: 'Situação', ordenar: (g) => g.situacao },
            { titulo: 'O que prova' },
            { titulo: 'Evidência' },
          ]}
          linhas={gatesFiltrados}
          chave={(g) => g.id}
          altura={520}
          vazio={<Empty icone="buscar" titulo="Nenhum gate nesta combinação">Tire um dos filtros para ver os demais gates.</Empty>}
          csv={{ nome: 'mission-control-gates', cabecalho: ['Gate', 'Frente', 'Situação', 'O que prova', 'Bloqueio', 'Evidência'], linha: (g) => [g.titulo, frenteDoGate(g.id)?.titulo ?? '', rotuloDoGate(g), g.prova, g.bloqueio ?? '', g.evidencias.map((e) => `${e.tipo}:${e.referencia}${e.simbolo ? `#${e.simbolo}` : ''}`).join(' | ')] }}
          linha={(g) => (
            <>
              <td><b>{g.titulo}</b><div className="mc-conta">{g.id}</div></td>
              <td className="small">{frenteDoGate(g.id)?.titulo ?? '—'}</td>
              <td><Badge tone={toneDoGate(g)}>{rotuloDoGate(g)}</Badge></td>
              <td className="small muted">{g.prova}{g.bloqueio && <div className="mc-prova">{g.bloqueio}</div>}</td>
              <td>
                {g.evidencias.length === 0
                  ? <span className="mc-conta">sem evidência ainda</span>
                  : <div className="mc-lista-gates">{g.evidencias.map((e, i) => <span key={i} className="mc-pill ev" title={`${e.tipo}${e.simbolo ? ` · ${e.simbolo}` : ''}${e.nota ? ` · ${e.nota}` : ''}`}>{e.tipo === 'commit' ? `commit ${e.referencia}` : e.referencia.split('/').slice(-1)[0]}</span>)}</div>}
              </td>
            </>
          )}
        />
      </div>

      {/* ------------------------------------------------------------------ Benefits Unlocked */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>O que a EIFF já ganhou</h2>
        <p className="small muted">Um benefício só aparece destravado quando todos os gates que ele exige estão fechados — {r.beneficiosAtivos} de {r.beneficiosTotal} hoje.</p>
        <div className="grid cols-2">
          {BENEFICIOS.map((b) => { const ok = beneficioDesbloqueado(b); const p = prontidao(b.gates); return (
            <div key={b.id} className={`mc-beneficio ${ok ? 'ok' : ''}`}>
              <div className="mc-marco-cab">
                <span className="mc-ico" aria-hidden="true"><Icon name={ok ? 'aprovacoes' : 'ajuda'} size={16} /></span>
                <b>{b.titulo}</b>
                <Badge tone={ok ? 'ok' : 'muted'}>{ok ? 'destravado' : `faltam ${p.faltando.length}`}</Badge>
              </div>
              <div className="small muted">Para {b.quem}</div>
              <div className="mc-prova">{ok ? `Provado por: ${b.gates.map((i) => gatePorId(i)!.titulo).join(' · ')}` : `Depende de: ${p.faltando.map((f) => f.titulo).join(' · ')}`}</div>
            </div>
          ); })}
        </div>
      </div>

      {/* -------------------------------------------------------------------------- Timeline */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Linha do tempo — o que foi entregue</h2>
        <p className="small muted">Cada onda concluída cita o commit que a suíte confere existir no repositório.</p>
        <ol className="mc-ondas">
          {ONDAS.map((o) => (
            <li key={o.id} className={o.situacao}>
              <div className="mc-onda-cab">
                <b>{o.titulo}</b>
                <Badge tone={o.situacao === 'concluida' ? 'ok' : o.situacao === 'em_andamento' ? 'warn' : 'muted'}>{o.situacao === 'concluida' ? 'concluída' : o.situacao === 'em_andamento' ? 'em andamento' : 'planejada'}</Badge>
                <span className="mc-conta">{o.quando}{o.commit ? ` · commit ${o.commit}` : ''}</span>
              </div>
              <ul className="mc-lista">{o.entregas.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
