import React, { useState } from 'react';
import { carteiraObras } from '../core/engine';
import { calcTarefas, locaisDoDia } from '../core/equipe';
import { resumoProducao } from '../core/obras';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, tentar, useToast } from '../ui/components';
import { navegar } from '../ui/router';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

/** Modo campo: tela simplificada para celular, usada no canteiro e na fabrica. */
export default function Campo({ secao }: { secao?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [bloq, setBloq] = useState<{ id: string; motivo: string } | null>(null);
  const hoje = ds.params.dataBase;
  const locais = locaisDoDia(ds, hoje);
  const meuColab = ds.colaboradores.find((c) => c.usuarioId === usuario.id);
  const tarefas = calcTarefas(ds, hoje).filter((t) => t.status !== 'Concluída' && (t.responsavel === usuario.id || (meuColab && t.colaboradorId === meuColab.id) || pode(usuario, 'editar_obra'))).sort((a, b) => (a.prazo < b.prazo ? -1 : 1));
  const visiveis = new Set(obrasVisiveis(usuario, ds.obras).map((o) => o.codigo));
  const demandas = carteiraObras(ds).filter((o) => visiveis.has(o.obra.codigo) && o.ativa).flatMap((o) => o.demandas.map((dm) => ({ ...dm, obra: o.obra.codigo }))).filter((dm) => dm.status !== 'Concluída' && (dm.responsavel === usuario.id || pode(usuario, 'editar_obra')));
  const fab = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Fabricação', hoje);
  const mon = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Montagem', hoje);
  const ordens = [...fab.ordens, ...mon.ordens].filter((o) => o.status !== 'Concluída').sort((a, b) => ((a.dataNecessidade ?? '9') < (b.dataNecessidade ?? '9') ? -1 : 1));
  const big: React.CSSProperties = { display: 'block', width: '100%', padding: '16px 14px', fontSize: 16, textAlign: 'left', marginBottom: 10 };

  const Home = () => (
    <div>
      <p className="muted small">Olá, {usuario.nome.split(' ')[0]}. {d(hoje)}.</p>
      <button className="btn primary" style={big} onClick={() => navegar('/campo/dia')}>📋 Apontar o dia <span className="muted small" style={{ float: 'right', color: 'inherit' }}>{locais.filter((l) => l.apontamento?.status === 'Fechado').length}/{locais.length} fechados</span></button>
      <button className="btn" style={big} onClick={() => navegar('/campo/tarefas')}>✅ Minhas tarefas <span style={{ float: 'right' }}>{tarefas.length}{tarefas.some((t) => t.atrasada) && <Badge tone="bad">atrasadas</Badge>}</span></button>
      <button className="btn" style={big} onClick={() => navegar('/campo/checklist')}>☑️ Check-list de hoje <span style={{ float: 'right' }}>{demandas.length} pendente(s)</span></button>
      <button className="btn" style={big} onClick={() => navegar('/campo/producao')}>🏭 Fabricação e montagem <span style={{ float: 'right' }}>{ordens.length} em aberto</span></button>
      <button className="btn" style={big} onClick={() => navegar('/')}>📊 Painel completo</button>
    </div>
  );

  const Dia = () => (
    <div>
      <h2>Apontar o dia · {d(hoje)}</h2>
      {locais.length === 0 ? <Empty>Sem equipe cadastrada.</Empty> : locais.map((l) => (
        <button key={l.rotulo} className={`btn ${l.apontamento ? '' : 'primary'}`} style={big} onClick={() => { if (l.apontamento) navegar(`/apontamentos/${l.apontamento.id}`); else { const a = actions.novoApontamento(hoje, l.local, l.codigoObra); navegar(`/apontamentos/novo?data=${hoje}&local=${l.local}&obra=${l.codigoObra ?? ''}&id=${a.id}`); } }}>
          {l.rotulo}<div className="small" style={{ opacity: 0.8 }}>{l.colaboradores.length} pessoas · {l.apontamento ? l.apontamento.status : 'não apontado'}</div>
        </button>
      ))}
    </div>
  );

  const Tarefas = () => (
    <div>
      <h2>Minhas tarefas</h2>
      {tarefas.length === 0 ? <Empty>Nenhuma tarefa aberta.</Empty> : tarefas.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${t.atrasada ? 'var(--bad)' : t.prioridade === 'Alta' ? 'var(--warn)' : 'var(--primary-2)'}` }}>
          <div><b>{t.titulo}</b> <Badge tone={t.status === 'Bloqueada' ? 'bad' : t.status === 'Em andamento' ? 'info' : 'warn'}>{t.status}</Badge></div>
          <div className="muted small">{[t.codigoObra, t.local, `prazo ${d(t.prazo)}`].filter(Boolean).join(' · ')}{t.bloqueio && ` · ${t.bloqueio}`}</div>
          {t.descricao && <div className="small" style={{ marginTop: 4 }}>{t.descricao}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            {t.status !== 'Em andamento' && <button className="btn" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Em andamento'), toast)}>Iniciar</button>}
            <button className="btn primary" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Concluída'), toast, () => toast('Tarefa concluída.'))}>Concluir</button>
            {t.status !== 'Bloqueada' && <button className="btn" onClick={() => setBloq({ id: t.id, motivo: '' })}>Bloquear</button>}
          </div>
        </div>
      ))}
    </div>
  );

  const Checklist = () => (
    <div>
      <h2>Check-list de hoje</h2>
      {demandas.length === 0 ? <Empty>Tudo concluído por hoje.</Empty> : demandas.map((dm) => (
        <label key={dm.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={dm.concluidaNoPeriodo} onChange={(e) => tentar(() => actions.concluirDemanda(dm.id, e.target.checked), toast)} />
          <span><b>{dm.titulo}</b><div className="muted small">{dm.obra} · {dm.periodicidade} · até {d(dm.prazoPeriodo)}</div></span>
        </label>
      ))}
    </div>
  );

  const Producao = () => (
    <div>
      <h2>Fabricação e montagem</h2>
      {ordens.length === 0 ? <Empty>Nenhuma ordem em aberto.</Empty> : ordens.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${o.atrasada ? 'var(--bad)' : 'var(--primary-2)'}` }}>
          <div><b>{o.codigo}</b> · {o.tipo} · {o.codigoObra}</div>
          <div className="small">{o.descricao} · {o.quantidade} {o.unidade}</div>
          <div className="muted small">etapa atual: <b>{o.etapaAtual}</b> · {o.dataNecessidade ? `necessidade ${d(o.dataNecessidade)}` : 'sem data'}</div>
          <div className="progress" style={{ margin: '6px 0' }}><i style={{ width: `${o.pctConcluido * 100}%` }} /></div>
          {pode(usuario, 'editar_lancamento', o.codigoObra) && o.etapaAtualIdx >= 0 && (
            <div className="actions">
              {o.etapas[o.etapaAtualIdx].status !== 'Em andamento' && <button className="btn" onClick={() => tentar(() => actions.avancarEtapa(o.id, o.etapaAtualIdx, 'Em andamento'), toast)}>Iniciar {o.etapaAtual}</button>}
              <button className="btn primary" onClick={() => tentar(() => actions.avancarEtapa(o.id, o.etapaAtualIdx, 'Concluída'), toast, () => toast(`${o.etapaAtual} concluída.`))}>Concluir {o.etapaAtual}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {secao && <button className="btn sm" style={{ marginBottom: 10 }} onClick={() => navegar('/campo')}>← Início</button>}
      {!secao && <Home />}
      {secao === 'dia' && <Dia />}
      {secao === 'tarefas' && <Tarefas />}
      {secao === 'checklist' && <Checklist />}
      {secao === 'producao' && <Producao />}
      {bloq && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setBloq(null)}>
          <div className="modal">
            <h2>Motivo do bloqueio</h2>
            <input autoFocus value={bloq.motivo} onChange={(e) => setBloq({ ...bloq, motivo: e.target.value })} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }} placeholder="ex.: aguardando material" />
            <div className="foot"><button className="btn" onClick={() => setBloq(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.moverTarefa(bloq.id, 'Bloqueada', bloq.motivo), toast, () => setBloq(null))}>Bloquear</button></div>
          </div>
        </div>
      )}
      {el}
    </div>
  );
}
