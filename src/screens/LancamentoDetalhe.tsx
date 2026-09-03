import React, { useState } from 'react';
import { calcLancamento } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { Empty, Field, Input, Link, Modal, Money, NumberInput, PageHead, Select, StatusBadge, dataHora, money, pct, tentar, useToast } from '../ui/components';
import { Timeline } from '../ui/Timeline';
import { LancamentoForm } from './LancamentoForm';
import { navegar } from '../ui/router';

export default function LancamentoDetalhe({ id }: { id: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [editando, setEditando] = useState(false);
  const [liq, setLiq] = useState<{ data: string; valor: number; conta: string; documento: string } | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const base = ds.lancamentos.find((x) => x.id === id);
  if (!base) return <Empty>Lançamento {id} não encontrado. <Link to="/lancamentos">Voltar</Link></Empty>;
  const l = calcLancamento(base, ds);
  const liqs = ds.liquidacoes.filter((q) => q.lancamentoId === id);
  const aprov = ds.aprovacoes.filter((a) => a.entidadeId === id);
  const verBancos = pode(usuario, 'ver_bancos');
  const editavel = l.status !== 'Cancelado' && l.status !== 'Realizado' && pode(usuario, 'editar_lancamento', l.codigoObra || undefined);
  const podeLiquidar = pode(usuario, 'liquidar') && (l.status === 'Aprovado' || l.status === 'Programado');
  const trans = ds.transacoes.filter((t) => t.lancamentoIds.includes(id));

  return (
    <>
      <PageHead title={`${l.id}`} subtitle={<>{l.descricao} · <StatusBadge s={l.status} /> <StatusBadge s={l.situacao} /> {l.conciliado && <StatusBadge s="Conciliado" />}</>}>
        <button className="btn" onClick={() => navegar(l.tipo === 'Entrada' ? '/receber' : '/pagar')}>← Lista</button>
        {editavel && <button className="btn" onClick={() => setEditando(true)}>Editar</button>}
        {podeLiquidar && <button className="btn primary" onClick={() => setLiq({ data: ds.params.dataBase, valor: l.saldoAberto, conta: l.contaFinanceira, documento: '' })}>Liquidar</button>}
        {(editavel || (l.status === 'Realizado' && pode(usuario, 'liquidar'))) && <button className="btn danger" onClick={() => setCancel('')}>{l.status === 'Realizado' ? 'Estornar' : 'Cancelar'}</button>}
      </PageHead>
      {l.status === 'Pendente' && <div className="alert warn">Aguardando aprovação: fora das visões oficiais de caixa até ser aprovado. <Link to={`/aprovacoes?id=${aprov[0]?.id ?? ''}`}>Ver aprovação</Link></div>}
      {l.status === 'Rascunho' && <div className="alert info">Rascunho: editável e fora das visões oficiais.</div>}
      {l.motivoCancelamento && <div className="alert bad">Cancelado/estornado: {l.motivoCancelamento}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h2>Valores</h2>
          <dl className="kv">
            <dt>Tipo / categoria</dt><dd>{l.tipo} · {l.categoria} {l.subcategoria && `· ${l.subcategoria}`}</dd>
            <dt>Grupo de fluxo / DRE</dt><dd>{l.grupoFluxo} · {l.grupoDre} · {l.classe}</dd>
            <dt>Valor bruto</dt><dd><Money v={l.valorBruto} /></dd>
            <dt>(−) Retenções / impostos</dt><dd><Money v={l.retencoes} /></dd>
            <dt>(−) Desconto</dt><dd><Money v={l.desconto} /></dd>
            <dt>(+) Multa / juros</dt><dd><Money v={l.multaJuros} /></dd>
            <dt><b>Líquido previsto</b></dt><dd><b><Money v={l.valorLiquidoPrevisto} /></b></dd>
            <dt>Realizado</dt><dd><Money v={l.valorRealizadoTotal} /> {l.saldoAberto > 0 && <span className="muted small">(saldo {money(l.saldoAberto)})</span>}</dd>
            <dt>Probabilidade × fator ({ds.params.cenario})</dt><dd>{pct(l.probabilidade)} × {l.fatorCenario}</dd>
            <dt>Caixa projetado</dt><dd><Money v={l.valorCaixaProjetado} sign /></dd>
            <dt>Valor gerencial (DRE)</dt><dd><Money v={l.valorGerencial} sign /></dd>
          </dl>
        </div>
        <div className="card">
          <h2>Vínculos e datas</h2>
          <dl className="kv">
            <dt>Obra</dt><dd>{l.codigoObra ? <Link to={`/obras/${l.codigoObra}`}>{l.codigoObra}</Link> : '—'} · {l.centroCusto}</dd>
            <dt>Contraparte</dt><dd>{l.contraparte}</dd>
            <dt>Documento</dt><dd>{l.documento || '—'}</dd>
            <dt>Competência</dt><dd>{l.competencia.split('-').reverse().join('/')} (chave {l.mesCompetencia})</dd>
            <dt>Vencimento</dt><dd>{l.vencimento?.split('-').reverse().join('/')} {l.diasAtraso > 0 && <span className="neg">({l.diasAtraso} dias de atraso)</span>}</dd>
            <dt>Realização</dt><dd>{l.realizacao?.split('-').reverse().join('/') ?? '—'}</dd>
            <dt>Data caixa / semana / mês</dt><dd>{l.dataCaixa?.split('-').reverse().join('/')} · {l.semanaCaixa?.split('-').reverse().join('/')} · {l.mesCaixa?.slice(0, 7)}</dd>
            {verBancos && <><dt>Conta financeira</dt><dd>{l.contaFinanceira}</dd></>}
            <dt>Confiabilidade</dt><dd>{l.confiabilidade}</dd>
            <dt>Origem</dt><dd>{l.origem} {l.idExterno && `(${l.idExterno})`} · v{l.versao}</dd>
            <dt>Criado / atualizado</dt><dd>{l.criadoPor} {dataHora(l.criadoEm)} · {l.atualizadoPor} {dataHora(l.atualizadoEm)}</dd>
          </dl>
          {l.observacoes && <p className="muted small" style={{ marginTop: 8 }}>{l.observacoes}</p>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Liquidações ({liqs.length})</h2>
          {liqs.length === 0 ? <div className="muted small">Nenhuma liquidação registrada.</div> : (
            <table><thead><tr><th>ID</th><th>Data</th><th>Valor</th>{verBancos && <th>Conta</th>}<th>Evidência</th><th>Por</th></tr></thead><tbody>
              {liqs.map((q) => <tr key={q.id}><td>{q.id}</td><td>{q.data.split('-').reverse().join('/')}</td><td><Money v={q.valor} /></td>{verBancos && <td>{q.conta}</td>}<td>{q.documento}</td><td className="muted small">{q.criadoPor}</td></tr>)}
            </tbody></table>
          )}
          {verBancos && trans.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Transações bancárias conciliadas</h3>
              <table><tbody>{trans.map((t) => <tr key={t.id}><td><Link to={`/conciliacao?id=${t.id}`}>{t.id}</Link></td><td>{t.data.split('-').reverse().join('/')}</td><td>{t.historico}</td><td><Money v={t.credito - t.debito} sign /></td></tr>)}</tbody></table>
            </>
          )}
          {aprov.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Aprovações</h3>
              <table><tbody>{aprov.map((a) => <tr key={a.id}><td><Link to={`/aprovacoes?id=${a.id}`}>{a.id}</Link></td><td><StatusBadge s={a.status} /></td><td className="small">{a.etapas.map((e) => `${e.papel}: ${e.status}`).join(' · ')}</td></tr>)}</tbody></table>
            </>
          )}
        </div>
        <div className="card">
          <h2>Linha do tempo</h2>
          <Timeline entidade="lancamento" entidadeId={id} onErro={toast} />
        </div>
      </div>

      {editando && <LancamentoForm inicial={base} onClose={() => setEditando(false)} onErro={toast} onOk={toast} />}
      {liq && (
        <Modal title={`Liquidar ${l.id}`} onClose={() => setLiq(null)}>
          <div className="alert info">Líquido previsto {money(l.valorLiquidoPrevisto)} · já liquidado {money(l.valorRealizadoTotal)} · saldo {money(l.saldoAberto)}. Liquidação parcial mantém o título aberto.</div>
          <div className="form">
            <Field label="Data" req><Input type="date" value={liq.data} onChange={(e) => setLiq({ ...liq, data: e.target.value })} /></Field>
            <Field label="Valor" req><NumberInput value={liq.valor} onChange={(v) => setLiq({ ...liq, valor: v })} /></Field>
            <Field label="Conta" req><Select value={liq.conta} onChange={(v) => setLiq({ ...liq, conta: v })} options={ds.contas.filter((c) => c.ativa).map((c) => c.instituicao)} /></Field>
            <Field label="Evidência (comprovante / documento)" req><Input value={liq.documento} onChange={(e) => setLiq({ ...liq, documento: e.target.value })} placeholder="ex.: comprovante PIX 123" /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setLiq(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.liquidar(id, liq), toast, () => { setLiq(null); toast('Liquidação registrada.'); })}>Confirmar liquidação</button></div>
        </Modal>
      )}
      {cancel !== null && (
        <Modal title={l.status === 'Realizado' ? `Estornar ${l.id}` : `Cancelar ${l.id}`} onClose={() => setCancel(null)}>
          <p className="small">O registro não é apagado: fica como Cancelado com motivo e trilha de auditoria. {l.status === 'Realizado' && 'As liquidações serão revertidas.'}</p>
          <Field label="Motivo" req full><textarea rows={3} value={cancel} onChange={(e) => setCancel(e.target.value)} /></Field>
          <div className="foot"><button className="btn" onClick={() => setCancel(null)}>Voltar</button><button className="btn danger" onClick={() => tentar(() => actions.cancelarLancamento(id, cancel), toast, () => setCancel(null))}>Confirmar</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
