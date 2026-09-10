import React, { useState } from 'react';
import { pode, useStore } from '../data/store';
import { Empty, Link, PageHead, dataHora } from '../ui/components';
import { Sparkline } from '../ui/charts';
import { limparUso, resumoUso } from '../data/telemetria';
import { ROTAS_NAV } from '../ui/Paleta';

export default function Auditoria() {
  const { ds, usuario } = useStore();
  const [f, setF] = useState({ usuario: '', acao: '', entidade: '', busca: '' });
  const [aberto, setAberto] = useState<string | null>(null);
  const [uso, setUso] = useState(() => resumoUso(30));
  const nomeRota = (r: string) => ROTAS_NAV.find((x) => x.to === r)?.rotulo ?? r;
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
      <div className="card uso" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Uso do sistema neste navegador (30 dias)</h2>
          <span className="small muted">{uso.total.toLocaleString('pt-BR')} evento(s) · só neste aparelho, sem envio · <a onClick={() => { if (window.confirm('Limpar a telemetria local?')) { limparUso(); setUso(resumoUso(30)); } }} style={{ cursor: 'pointer' }}>limpar</a></span>
        </div>
        {uso.total === 0 ? <div className="muted small" style={{ marginTop: 6 }}>Ainda sem uso registrado.</div> : (
          <div className="grid cols-3" style={{ marginTop: 8 }}>
            <div><h3>Telas mais usadas</h3><ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{uso.telas.slice(0, 8).map((t) => <li key={t.rota}>{nomeRota(t.rota)} <span className="muted">· {t.visitas}</span></li>)}</ol></div>
            <div><h3>Ações</h3>{uso.acoes.length === 0 ? <div className="muted small">nenhuma</div> : <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{uso.acoes.slice(0, 8).map((a) => <li key={a.nome}>{a.nome} <span className="muted">· {a.vezes}</span></li>)}</ol>}</div>
            <div><h3>Visitas por dia</h3><Sparkline valores={uso.porDia.map((d) => d.visitas)} altura={54} rotulos={uso.porDia.map((d) => d.data)} /></div>
          </div>
        )}
      </div>
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
