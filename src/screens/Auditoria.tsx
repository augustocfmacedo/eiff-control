import React, { useState } from 'react';
import { pode, useStore } from '../data/store';
import { Empty, Link, PageHead, dataHora } from '../ui/components';

export default function Auditoria() {
  const { ds, usuario } = useStore();
  const [f, setF] = useState({ usuario: '', acao: '', entidade: '', busca: '' });
  const [aberto, setAberto] = useState<string | null>(null);
  if (!pode(usuario, 'ver_auditoria')) return <Empty>Trilha de auditoria restrita a Administrador, Diretoria, Financeiro, Contabilidade e Auditoria.</Empty>;
  const lista = ds.auditoria
    .filter((a) => !f.usuario || a.usuario === f.usuario)
    .filter((a) => !f.acao || a.acao === f.acao)
    .filter((a) => !f.entidade || a.entidade === f.entidade)
    .filter((a) => !f.busca || `${a.entidadeId} ${a.motivo ?? ''} ${JSON.stringify(a.depois ?? '')}`.toLowerCase().includes(f.busca.toLowerCase()));
  const uniq = (k: 'usuario' | 'acao' | 'entidade') => [...new Set(ds.auditoria.map((a) => a[k]))].sort();
  const link = (a: { entidade: string; entidadeId: string }) => (a.entidade === 'lancamento' ? `/lancamentos/${a.entidadeId}` : a.entidade === 'obra' ? `/obras/${a.entidadeId}` : a.entidade === 'aprovacao' ? `/aprovacoes?id=${a.entidadeId}` : a.entidade === 'transacao' ? `/conciliacao?id=${a.entidadeId}` : '');
  return (
    <>
      <PageHead title="Auditoria" subtitle="Trilha imutável: quem, quando, o quê, antes/depois e motivo. Pesquisa por usuário, entidade, ação e origem." />
      <div className="filters">
        <label className="field"><span>Usuário</span><select value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })}><option value="">Todos</option>{uniq('usuario').map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="field"><span>Ação</span><select value={f.acao} onChange={(e) => setF({ ...f, acao: e.target.value })}><option value="">Todas</option>{uniq('acao').map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="field"><span>Entidade</span><select value={f.entidade} onChange={(e) => setF({ ...f, entidade: e.target.value })}><option value="">Todas</option>{uniq('entidade').map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="field"><span>Buscar</span><input value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} /></label>
      </div>
      <div className="card table-wrap">
        <table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Motivo</th><th></th></tr></thead><tbody>
          {lista.map((a) => (
            <React.Fragment key={a.id}>
              <tr className="clickable" onClick={() => setAberto(aberto === a.id ? null : a.id)}>
                <td className="small">{dataHora(a.ts)}</td><td>{a.usuario}</td><td>{a.acao.replace(/_/g, ' ')}</td><td>{a.entidade} · {link(a) ? <Link to={link(a)}>{a.entidadeId}</Link> : a.entidadeId}</td><td className="small">{a.motivo}</td><td className="muted small">{aberto === a.id ? '▲' : '▼'}</td>
              </tr>
              {aberto === a.id && (
                <tr><td colSpan={6}><div className="grid cols-2"><div><h3>Antes</h3><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{a.antes ? JSON.stringify(a.antes, null, 1) : '—'}</pre></div><div><h3>Depois</h3><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{a.depois ? JSON.stringify(a.depois, null, 1) : '—'}</pre></div></div></td></tr>
              )}
            </React.Fragment>
          ))}
          {lista.length === 0 && <tr><td colSpan={6} className="empty">Sem eventos.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}
