import React, { useState } from 'react';
import { slaVencido } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Link, Modal, Money, PageHead, StatusBadge, Tabs, dataHora, money, tentar, useToast } from '../ui/components';

export default function Aprovacoes({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'pendentes' | 'minhas' | 'historico'>('pendentes');
  const [sel, setSel] = useState<string | null>(query.get('id'));
  const [decisao, setDecisao] = useState<{ tipo: 'Aprovado' | 'Rejeitado' | 'Devolvido'; just: string } | null>(null);
  const agora = new Date().toISOString();
  const lista = ds.aprovacoes.filter((a) => (aba === 'pendentes' ? a.status === 'Pendente' : aba === 'minhas' ? a.solicitante === usuario.nome : a.status !== 'Pendente'));
  const ap = ds.aprovacoes.find((a) => a.id === sel);
  const etapaAtual = ap?.etapas.find((e) => e.status === 'Pendente');
  const admin = usuario.papel === 'Administrador';
  const possoDecidir = !!ap && ap.status === 'Pendente' && (ap.solicitante !== usuario.nome || admin) && pode(usuario, 'aprovar', ap.codigoObra) && (etapaAtual?.papel === usuario.papel || admin);

  return (
    <>
      <PageHead title="Central de aprovações" subtitle="Fila, impacto no orçamento e no caixa, decisão, devolução e histórico. O solicitante nunca decide a própria solicitação." />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'pendentes', label: `Pendentes (${ds.aprovacoes.filter((a) => a.status === 'Pendente').length})` }, { id: 'minhas', label: 'Minhas solicitações' }, { id: 'historico', label: 'Histórico' }]} />
      <div className="grid cols-2">
        <div className="card table-wrap">
          {lista.length === 0 ? <Empty>Nada aqui.</Empty> : (
            <table>
              <thead><tr><th>Pedido</th><th>Valor</th><th>Etapa</th><th>SLA</th><th>Status</th></tr></thead>
              <tbody>
                {lista.map((a) => {
                  const et = a.etapas.find((e) => e.status === 'Pendente');
                  return (
                    <tr key={a.id} className="clickable" onClick={() => setSel(a.id)} style={a.id === sel ? { outline: '2px solid var(--primary-2)' } : undefined}>
                      <td><b>{a.id}</b> · {a.tipo}<div className="muted small">{a.titulo}</div><div className="muted small">{a.solicitante} · {dataHora(a.criadoEm)}</div></td>
                      <td><Money v={a.valor} /></td>
                      <td>{et ? <Badge tone={et.papel === usuario.papel ? 'info' : 'muted'}>{et.papel}</Badge> : '—'}</td>
                      <td>{a.status === 'Pendente' ? (slaVencido(a, agora) ? <Badge tone="bad">vencido</Badge> : <span className="small">{dataHora(a.prazoSla)}</span>) : ''}</td>
                      <td><StatusBadge s={a.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          {!ap ? <Empty>Selecione um pedido para ver impacto e decidir.</Empty> : (
            <>
              <h2>{ap.id} · {ap.titulo}</h2>
              <dl className="kv">
                <dt>Tipo</dt><dd>{ap.tipo} · <Link to={`/lancamentos/${ap.entidadeId}`}>{ap.entidadeId}</Link></dd>
                <dt>Valor</dt><dd><Money v={ap.valor} /></dd>
                <dt>Obra</dt><dd>{ap.codigoObra ? <Link to={`/obras/${ap.codigoObra}`}>{ap.codigoObra}</Link> : '—'}</dd>
                <dt>Solicitante</dt><dd>{ap.solicitante} · {dataHora(ap.criadoEm)}</dd>
                <dt>SLA</dt><dd className={slaVencido(ap, agora) ? 'neg' : ''}>{dataHora(ap.prazoSla)}</dd>
                <dt>Status</dt><dd><StatusBadge s={ap.status} /></dd>
              </dl>
              <h3 style={{ marginTop: 12 }}>Impacto (evidência para a decisão)</h3>
              <dl className="kv">
                <dt>Menor saldo 13S antes → depois</dt><dd>{money(ap.impacto.saldoMinimo13sAntes)} → <b className={ap.impacto.abaixoDaReserva ? 'neg' : ''}>{money(ap.impacto.saldoMinimo13sDepois)}</b> {ap.impacto.abaixoDaReserva && <Badge tone="bad">abaixo da reserva</Badge>}</dd>
                {ap.codigoObra && <><dt>Comprometido da obra</dt><dd>{money(ap.impacto.comprometidoObra)}</dd><dt>Orçamento disponível</dt><dd className={(ap.impacto.orcamentoDisponivel ?? 0) < 0 ? 'neg' : ''}>{money(ap.impacto.orcamentoDisponivel)} {ap.impacto.foraDoOrcamento && <Badge tone="bad">fora do orçamento</Badge>}</dd><dt>EAC / margem projetada</dt><dd>{money(ap.impacto.eacObra)} / {money(ap.impacto.margemProjetadaObra)}</dd></>}
              </dl>
              {ap.justificativaExcecao && <div className="alert warn" style={{ marginTop: 8 }}>{ap.justificativaExcecao}</div>}
              <h3 style={{ marginTop: 12 }}>Etapas</h3>
              <ul className="timeline">
                {ap.etapas.map((e, i) => (
                  <li key={i}><div><b>{e.papel}</b> · <StatusBadge s={e.status} /> {e.justificativa && <span className="small">— {e.justificativa}</span>}</div>{e.decididoEm && <div className="meta">{e.decididoPor} · {dataHora(e.decididoEm)}</div>}</li>
                ))}
              </ul>
              {ap.status === 'Pendente' && (
                <div className="actions" style={{ marginTop: 12 }}>
                  {possoDecidir ? (
                    <>
                      <button className="btn primary" onClick={() => setDecisao({ tipo: 'Aprovado', just: '' })}>Aprovar</button>
                      <button className="btn" onClick={() => setDecisao({ tipo: 'Devolvido', just: '' })}>Devolver</button>
                      <button className="btn danger" onClick={() => setDecisao({ tipo: 'Rejeitado', just: '' })}>Rejeitar</button>
                    </>
                  ) : (
                    <span className="muted small">{ap.solicitante === usuario.nome ? 'Você é o solicitante: aguarde a decisão.' : `Etapa atual exige o papel ${etapaAtual?.papel}. Você é ${usuario.papel}.`}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {decisao && ap && (
        <Modal title={`${decisao.tipo === 'Aprovado' ? 'Aprovar' : decisao.tipo === 'Devolvido' ? 'Devolver' : 'Rejeitar'} ${ap.id}`} onClose={() => setDecisao(null)}>
          <Field label={decisao.tipo === 'Aprovado' ? 'Observação (opcional)' : 'Justificativa'} req={decisao.tipo !== 'Aprovado'} full><textarea rows={3} value={decisao.just} onChange={(e) => setDecisao({ ...decisao, just: e.target.value })} /></Field>
          <div className="foot"><button className="btn" onClick={() => setDecisao(null)}>Voltar</button><button className={`btn ${decisao.tipo === 'Rejeitado' ? 'danger' : 'primary'}`} onClick={() => tentar(() => actions.decidirAprovacao(ap.id, decisao.tipo, decisao.just), toast, () => { setDecisao(null); toast(`Decisão registrada: ${decisao.tipo}.`); })}>Confirmar</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
