import React from 'react';
import { carteiraObras, dashboard, posicaoBancaria } from '../core/engine';
import { useStore } from '../data/store';
import { Badge, Bars, Kpi, Link, Money, PageHead, StatusBadge, money, pct } from '../ui/components';

export default function Dashboard() {
  const { ds } = useStore();
  const d = dashboard(ds);
  const carteira = carteiraObras(ds);
  const alertas = [
    { nome: 'Recebíveis vencidos', valor: money(d.recebiveisVencidos), ok: d.recebiveisVencidos === 0, acao: 'Cobrança e reprogramação', to: '/receber?situacao=Atrasado' },
    { nome: 'Pagamentos vencidos', valor: money(d.pagamentosVencidos), ok: d.pagamentosVencidos === 0, acao: 'Negociar ou regularizar', to: '/pagar?situacao=Atrasado' },
    { nome: 'Realizados sem conciliação', valor: String(d.realizadosSemConciliacao), ok: d.realizadosSemConciliacao === 0, acao: 'Conciliar com extrato', to: '/conciliacao' },
    { nome: 'Obras com margem negativa', valor: String(d.obrasMargemNegativa), ok: d.obrasMargemNegativa === 0, acao: 'Reorçar e travar novos compromissos', to: '/obras', critico: true },
    { nome: 'Aprovações pendentes', valor: String(d.aprovacoesPendentes), ok: d.aprovacoesPendentes === 0, acao: `${d.aprovacoesSlaVencido} com SLA vencido`, to: '/aprovacoes' },
    { nome: 'Caixa abaixo da reserva (13S)', valor: money(d.menorSaldo13s), ok: d.menorSaldo13s >= ds.params.reservaMinima, acao: 'Plano de ação no comitê de caixa', to: '/fluxo13', critico: true },
  ];
  return (
    <>
      <PageHead title="Painel executivo" subtitle={<>Caixa, carteira de obras, compromissos e alertas. Data-base <b>{ds.params.dataBase.split('-').reverse().join('/')}</b> · cenário <b>{ds.params.cenario}</b> · controles <StatusBadge s={d.statusModelo} /></>} />
      {ds.params.incluirDemo && <div className="alert warn">Dados demonstrativos ativos. Desative em Cadastros › Parâmetros antes do uso oficial.</div>}
      <div className="grid cols-4">
        <Kpi label="Saldo bancário hoje" value={money(posicaoBancaria(ds).reduce((a, p) => a + p.saldoBancario, 0))} hint={`abertura ${money(d.saldoInicial, true)} · ${money(Math.abs(posicaoBancaria(ds).reduce((a, p) => a + p.naoLancado, 0)), true)} do extrato não lançados`} to="/posicao" tone={posicaoBancaria(ds).some((p) => p.transacoesPendentes) ? 'warn' : undefined} />
        <Kpi label="Saldo final — 13 semanas" value={money(d.saldoFinal13s)} to="/fluxo13" tone={d.saldoFinal13s < 0 ? 'bad' : undefined} />
        <Kpi label="Menor saldo — 13 semanas" value={money(d.menorSaldo13s)} tone={d.menorSaldo13s < ds.params.reservaMinima ? 'bad' : 'ok'} to="/fluxo13" />
        <Kpi label="Necessidade máxima vs. reserva" value={money(d.necessidadeMaxima)} hint={`reserva mínima ${money(ds.params.reservaMinima)}`} tone={d.necessidadeMaxima > 0 ? 'warn' : 'ok'} to="/fluxo13" />
        <Kpi label="Entradas projetadas — 13S" value={money(d.entradas13s)} to="/receber" />
        <Kpi label="Saídas projetadas — 13S" value={money(d.saidas13s)} to="/pagar" />
        <Kpi label="Backlog contratado a receber" value={money(d.backlog)} hint="receita contratada − recebido" to="/obras" />
        <Kpi label="Saldo devedor total" value={money(d.saldoDevedor)} hint={`serviço mensal ${money(d.servicoDividaMensal)}`} to="/dividas" />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Saldo final por semana (13S)</h2>
          <Bars valores={d.fluxo13.saldoFinal} rotulos={d.fluxo13.periodos.map((p) => p.rotulo)} />
          <div className="muted small" style={{ marginTop: 6 }}>Próximos 7 dias: entradas {money(d.proximos7DiasEntradas)} · saídas {money(d.proximos7DiasSaidas)}</div>
        </div>
        <div className="card">
          <h2>Alertas financeiros</h2>
          <table>
            <thead><tr><th>Alerta</th><th>Quantidade / Valor</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.nome}>
                  <td><Link to={a.to}>{a.nome}</Link></td>
                  <td className="num">{a.valor}</td>
                  <td><Badge tone={a.ok ? 'ok' : a.critico ? 'bad' : 'warn'}>{a.ok ? 'OK' : a.critico ? 'CRÍTICO' : 'ATENÇÃO'}</Badge></td>
                  <td className="muted small">{a.acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Carteira de obras</h2>
          <table>
            <thead><tr><th>Indicador</th><th>Valor</th><th>Leitura</th></tr></thead>
            <tbody>
              <tr><td>Obras ativas</td><td className="num">{d.obrasAtivas}</td><td className="muted small">Carteira em andamento ou planejamento</td></tr>
              <tr><td>Receita contratada</td><td className="num">{money(d.receitaContratada)}</td><td className="muted small">Contrato + aditivos</td></tr>
              <tr><td>Custo total projetado (EAC)</td><td className="num">{money(d.custoTotalProjetado)}</td><td className="muted small">Pago + comprometido em aberto + ETC não comprometido</td></tr>
              <tr><td>Margem projetada da carteira</td><td className="num">{pct(d.margemCarteira)}</td><td className="muted small">Margem ponderada pela receita</td></tr>
            </tbody>
          </table>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Obra</th><th>Status</th><th>Receita</th><th>EAC</th><th>Margem proj.</th><th>Caixa</th></tr></thead>
            <tbody>
              {carteira.map((o) => (
                <tr key={o.obra.codigo}>
                  <td><Link to={`/obras/${o.obra.codigo}`}>{o.obra.codigo}</Link><div className="muted small">{o.obra.nome}</div></td>
                  <td><StatusBadge s={o.obra.status} /></td>
                  <td><Money v={o.receitaTotal} compact /></td>
                  <td><Money v={o.eac} compact /></td>
                  <td className={`num ${o.margemProjetada < 0 ? 'neg' : ''}`}>{pct(o.pctMargemProjetada)}</td>
                  <td><Money v={o.caixaGerado} compact sign /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Aging</h2>
          <div className="grid cols-2">
            {[{ t: 'A receber', a: d.agingReceber, to: '/receber' }, { t: 'A pagar', a: d.agingPagar, to: '/pagar' }].map((x) => (
              <div key={x.t}>
                <h3><Link to={x.to}>{x.t}</Link></h3>
                <table>
                  <tbody>
                    {x.a.map((f) => (
                      <tr key={f.faixa}><td>{f.faixa}</td><td className="num">{f.quantidade}</td><td><Money v={f.valor} compact /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
