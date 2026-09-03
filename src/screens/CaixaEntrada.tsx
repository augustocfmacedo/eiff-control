import React from 'react';
import { calcLancamentos, executarChecks, slaVencido } from '../core/engine';
import { actions, useStore } from '../data/store';
import { Badge, Empty, Link, Money, PageHead, StatusBadge, dataHora } from '../ui/components';

export default function CaixaEntrada() {
  const { ds, usuario } = useStore();
  const agora = new Date().toISOString();
  const minhasAprovacoes = ds.aprovacoes.filter((a) => a.status === 'Pendente' && a.etapas.find((e) => e.status === 'Pendente')?.papel === usuario.papel && a.solicitante !== usuario.nome);
  const minhasSolicitacoes = ds.aprovacoes.filter((a) => a.solicitante === usuario.nome && a.status !== 'Aprovado');
  const tarefas = ds.tarefas.filter((t) => t.status === 'Aberta' && t.responsavel === usuario.id);
  const mencoes = ds.comentarios.filter((c) => c.mencoes.some((m) => usuario.nome.toLowerCase().includes(m.toLowerCase()))).slice(-10).reverse();
  const alertas = executarChecks(ds).filter((c) => c.status !== 'OK');
  const lancs = calcLancamentos(ds).filter((l) => l.oficial);
  const proximos = lancs.filter((l) => l.situacao === 'Próximos 7 dias' || l.situacao === 'Atrasado').sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  return (
    <>
      <PageHead title="Minha caixa de entrada" subtitle={`${usuario.nome} · ${usuario.papel}`} />
      <div className="grid cols-2">
        <div className="card">
          <h2>Aprovações aguardando meu papel ({minhasAprovacoes.length})</h2>
          {minhasAprovacoes.length === 0 ? <Empty>Nenhuma aprovação pendente para {usuario.papel}.</Empty> : (
            <table>
              <thead><tr><th>Pedido</th><th>Valor</th><th>Obra</th><th>SLA</th></tr></thead>
              <tbody>
                {minhasAprovacoes.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/aprovacoes?id=${a.id}`}>{a.titulo}</Link><div className="muted small">{a.solicitante} · {dataHora(a.criadoEm)}</div></td>
                    <td><Money v={a.valor} /></td>
                    <td>{a.codigoObra ?? '—'}</td>
                    <td>{slaVencido(a, agora) ? <Badge tone="bad">Vencido</Badge> : <Badge tone="info">{dataHora(a.prazoSla)}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {minhasSolicitacoes.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Minhas solicitações em andamento</h3>
              <table>
                <tbody>
                  {minhasSolicitacoes.map((a) => (
                    <tr key={a.id}><td><Link to={`/aprovacoes?id=${a.id}`}>{a.titulo}</Link></td><td><StatusBadge s={a.status} /></td><td className="muted small">etapa: {a.etapas.find((e) => e.status === 'Pendente')?.papel ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="card">
          <h2>Minhas tarefas ({tarefas.length})</h2>
          {tarefas.length === 0 ? <Empty>Sem tarefas abertas.</Empty> : (
            <table>
              <tbody>
                {tarefas.map((t) => (
                  <tr key={t.id}>
                    <td>{t.titulo}<div className="muted small">{t.entidade ? <Link to={t.entidade === 'obra' ? `/obras/${t.entidadeId}` : `/lancamentos/${t.entidadeId}`}>{t.entidadeId}</Link> : t.origem}</div></td>
                    <td className={t.prazo < ds.params.dataBase ? 'neg' : ''}>{t.prazo.split('-').reverse().join('/')}</td>
                    <td><button className="btn sm" onClick={() => actions.concluirTarefa(t.id)}>Concluir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 style={{ marginTop: 14 }}>Menções</h3>
          {mencoes.length === 0 ? <div className="muted small">Ninguém mencionou você.</div> : mencoes.map((c) => (
            <div key={c.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <b>{c.autor}</b> em <Link to={c.entidade === 'obra' ? `/obras/${c.entidadeId}` : `/lancamentos/${c.entidadeId}`}>{c.entidadeId}</Link>: {c.texto}
            </div>
          ))}
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Vencidos e próximos 7 dias</h2>
          {proximos.length === 0 ? <Empty>Nada vencendo.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>ID</th><th>Descrição</th><th>Vencimento</th><th>Líquido</th><th>Situação</th></tr></thead>
              <tbody>
                {proximos.slice(0, 15).map((l) => (
                  <tr key={l.id}><td><Link to={`/lancamentos/${l.id}`}>{l.id}</Link></td><td>{l.descricao}</td><td>{l.vencimento.split('-').reverse().join('/')}</td><td><Money v={l.tipo === 'Entrada' ? l.valorLiquidoPrevisto : -l.valorLiquidoPrevisto} sign /></td><td><StatusBadge s={l.situacao} /></td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <h2>Alertas do modelo</h2>
          {alertas.length === 0 ? <Empty>Todos os controles OK.</Empty> : (
            <table><tbody>
              {alertas.map((c) => <tr key={c.id}><td><Link to="/checks">{c.nome}</Link></td><td className="num">{String(c.atual)}</td><td><StatusBadge s={c.status} /></td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
