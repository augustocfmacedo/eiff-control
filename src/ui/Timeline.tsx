import React, { useState } from 'react';
import { actions, pode, useStore } from '../data/store';
import { dataHora, tentar } from './components';

/** Linha do tempo contextual: comentarios, mudancas de estado, aprovacoes e tarefas da entidade. */
export function Timeline({ entidade, entidadeId, onErro }: { entidade: string; entidadeId: string; onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [texto, setTexto] = useState('');
  const [tarefa, setTarefa] = useState({ titulo: '', responsavel: usuario.id, prazo: ds.params.dataBase });
  const eventos = [
    ...ds.comentarios.filter((c) => c.entidade === entidade && c.entidadeId === entidadeId).map((c) => ({ ts: c.ts, quem: c.autor, texto: c.texto, tipo: 'comentário' })),
    ...ds.auditoria.filter((a) => a.entidade === entidade && a.entidadeId === entidadeId).map((a) => ({ ts: a.ts, quem: a.usuario, texto: `${a.acao.replace(/_/g, ' ')}${a.motivo ? ` — ${a.motivo}` : ''}`, tipo: 'ação' })),
    ...ds.aprovacoes.filter((a) => a.entidadeId === entidadeId).flatMap((a) => a.etapas.filter((e) => e.decididoEm).map((e) => ({ ts: e.decididoEm!, quem: e.decididoPor!, texto: `${e.status} (${e.papel})${e.justificativa ? `: ${e.justificativa}` : ''}`, tipo: 'aprovação' }))),
    ...ds.tarefas.filter((t) => t.entidadeId === entidadeId).map((t) => ({ ts: t.criadoEm, quem: t.responsavel, texto: `Tarefa: ${t.titulo} (${t.status}, prazo ${t.prazo})`, tipo: 'tarefa' })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return (
    <div>
      {pode(usuario, 'comentar') && (
        <div className="form" style={{ marginBottom: 12 }}>
          <label className="field full">
            <span>Comentar (use @nome para mencionar)</span>
            <textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <div className="actions full">
            <button className="btn sm primary" disabled={!texto.trim()} onClick={() => tentar(() => actions.comentar(entidade, entidadeId, texto), onErro, () => setTexto(''))}>Comentar</button>
            <span className="muted small">ou converter em tarefa:</span>
            <input placeholder="Título da tarefa" value={tarefa.titulo} onChange={(e) => setTarefa({ ...tarefa, titulo: e.target.value })} style={{ padding: 5, border: '1px solid var(--border)', borderRadius: 6 }} />
            <select value={tarefa.responsavel} onChange={(e) => setTarefa({ ...tarefa, responsavel: e.target.value })} style={{ padding: 5 }}>
              {ds.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <input type="date" value={tarefa.prazo} onChange={(e) => setTarefa({ ...tarefa, prazo: e.target.value })} style={{ padding: 5 }} />
            <button className="btn sm" disabled={!tarefa.titulo.trim()} onClick={() => tentar(() => actions.criarTarefa({ titulo: tarefa.titulo, responsavel: tarefa.responsavel, prazo: tarefa.prazo, entidade, entidadeId, origem: texto || 'manual' }), onErro, () => setTarefa({ ...tarefa, titulo: '' }))}>Criar tarefa</button>
          </div>
        </div>
      )}
      {eventos.length === 0 ? <div className="muted small">Sem eventos.</div> : (
        <ul className="timeline">
          {eventos.map((e, i) => (
            <li key={i}>
              <div>{e.texto}</div>
              <div className="meta">{e.tipo} · {e.quem} · {dataHora(e.ts)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
