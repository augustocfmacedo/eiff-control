import React from 'react';
import { carteiraObras, dashboard, posicaoBancaria } from '../core/engine';
import { useStore } from '../data/store';
import { Badge, Empty, KpiHero, KpiStrip, Link, Money, PageHead, PrintHead, StatusBadge, money, pct } from '../ui/components';
import { Sparkline } from '../ui/charts';

export default function Dashboard() {
  const { ds } = useStore();
  const d = dashboard(ds);
  const carteira = carteiraObras(ds);
  const posicao = posicaoBancaria(ds);
  const saldoBancario = posicao.reduce((a, p) => a + p.saldoBancario, 0);
  const naoLancado = posicao.reduce((a, p) => a + p.naoLancado, 0);
  const reserva = ds.params.reservaMinima;
  const alertas = [
    { nome: 'Recebíveis vencidos', valor: money(d.recebiveisVencidos), ok: d.recebiveisVencidos === 0, acao: 'Cobrança e reprogramação', to: '/receber?situacao=Atrasado' },
    { nome: 'Pagamentos vencidos', valor: money(d.pagamentosVencidos), ok: d.pagamentosVencidos === 0, acao: 'Negociar ou regularizar', to: '/pagar?situacao=Atrasado' },
    { nome: 'Realizados sem conciliação', valor: String(d.realizadosSemConciliacao), ok: d.realizadosSemConciliacao === 0, acao: 'Conciliar com extrato', to: '/conciliacao' },
    { nome: 'Obras com margem negativa', valor: String(d.obrasMargemNegativa), ok: d.obrasMargemNegativa === 0, acao: 'Reorçar e travar novos compromissos', to: '/obras', critico: true },
    { nome: 'Aprovações pendentes', valor: String(d.aprovacoesPendentes), ok: d.aprovacoesPendentes === 0, acao: `${d.aprovacoesSlaVencido} com SLA vencido`, to: '/aprovacoes' },
    { nome: 'Caixa abaixo da reserva (13S)', valor: money(d.menorSaldo13s), ok: d.menorSaldo13s >= reserva, acao: 'Plano de ação no comitê de caixa', to: '/fluxo13', critico: true },
  ];
  const pendentes = alertas.filter((a) => !a.ok);
  const semanaMenor = d.fluxo13.saldoFinal.indexOf(d.menorSaldo13s);
  return (
    <>
      <PageHead title="Painel executivo" subtitle={<>Caixa, carteira de obras, compromissos e alertas. Data-base <b>{ds.params.dataBase.split('-').reverse().join('/')}</b> · cenário <b>{ds.params.cenario}</b> · controles <StatusBadge s={d.statusModelo} /></>}>
        <button className="btn no-print" onClick={() => window.print()}>Imprimir</button>
      </PageHead>
      <PrintHead titulo="Painel executivo" subtitulo={`${ds.params.empresa} · data-base ${ds.params.dataBase.split('-').reverse().join('/')} · cenário ${ds.params.cenario}`} />
      {ds.params.incluirDemo && <div className="alert warn">Dados demonstrativos ativos. Desative em Cadastros › Parâmetros antes do uso oficial.</div>}

      <div className="hero-grid">
        <KpiHero label="Caixa: saldo bancário hoje e projeção de 13 semanas" value={money(saldoBancario)} hint={`abertura ${money(d.saldoInicial, true)} · ${money(Math.abs(naoLancado), true)} do extrato sem lançamento · reserva mínima ${money(reserva, true)}`} to="/posicao" tone={d.menorSaldo13s < reserva ? 'bad' : posicao.some((p) => p.transacoesPendentes) ? 'warn' : undefined}
          secundarios={[
            { label: 'Menor saldo 13S', value: money(d.menorSaldo13s, true), tone: d.menorSaldo13s < reserva ? 'neg' : 'pos' },
            { label: 'Saldo final 13S', value: money(d.saldoFinal13s, true), tone: d.saldoFinal13s < 0 ? 'neg' : undefined },
            { label: 'Necessidade vs. reserva', value: money(d.necessidadeMaxima, true), tone: d.necessidadeMaxima > 0 ? 'warn' : undefined },
            { label: 'Próximos 7 dias', value: `${money(d.proximos7DiasEntradas, true)} / ${money(d.proximos7DiasSaidas, true)}` },
          ]}>
          <Sparkline valores={d.fluxo13.saldoFinal} referencia={reserva} rotulos={d.fluxo13.periodos.map((p) => p.rotulo)} altura={56} />
          <div className="muted small">Saldo final por semana, {d.fluxo13.periodos[0]?.rotulo} a {d.fluxo13.periodos[d.fluxo13.periodos.length - 1]?.rotulo}{semanaMenor >= 0 ? ` · menor saldo na ${d.fluxo13.periodos[semanaMenor]?.rotulo}` : ''} · linha tracejada = reserva mínima</div>
        </KpiHero>
        <KpiHero label="Carteira de obras: margem projetada" value={pct(d.margemCarteira)} tone={d.margemCarteira < 0 ? 'bad' : d.margemCarteira < 0.1 ? 'warn' : 'ok'} hint={`${d.obrasAtivas} obra(s) ativa(s) · ${d.obrasMargemNegativa} com margem negativa`} to="/central"
          secundarios={[
            { label: 'Receita contratada', value: money(d.receitaContratada, true) },
            { label: 'EAC da carteira', value: money(d.custoTotalProjetado, true) },
            { label: 'Backlog a receber', value: money(d.backlog, true) },
            { label: 'Saldo devedor', value: money(d.saldoDevedor, true), tone: d.saldoDevedor > 0 ? 'warn' : undefined },
          ]}>
          {carteira.length === 0 ? <div className="muted small">Sem obras na carteira.</div> : carteira.slice(0, 4).map((o) => (
            <div key={o.obra.codigo} className="progress-row">
              <span className="label"><Link to={`/obras/${o.obra.codigo}`}>{o.obra.codigo}</Link></span>
              <div className="progress"><i style={{ width: `${Math.max(0, Math.min(1, o.execucaoFisica)) * 100}%` }} /></div>
              <span className={`v ${o.margemProjetada < 0 ? 'neg' : ''}`}>{pct(o.pctMargemProjetada)}</span>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 6 }}>Barra = execução física · valor = margem projetada</div>
        </KpiHero>
      </div>
      <KpiStrip itens={[
        { label: 'Entradas 13S', value: money(d.entradas13s, true), to: '/receber' },
        { label: 'Saídas 13S', value: money(d.saidas13s, true), to: '/pagar' },
        { label: 'Recebíveis vencidos', value: money(d.recebiveisVencidos, true), tone: d.recebiveisVencidos > 0 ? 'warn' : undefined, to: '/receber?situacao=Atrasado' },
        { label: 'Pagamentos vencidos', value: money(d.pagamentosVencidos, true), tone: d.pagamentosVencidos > 0 ? 'neg' : undefined, to: '/pagar?situacao=Atrasado' },
        { label: 'Aprovações pendentes', value: d.aprovacoesPendentes, hint: `${d.aprovacoesSlaVencido} com SLA vencido`, tone: d.aprovacoesSlaVencido > 0 ? 'warn' : undefined, to: '/aprovacoes' },
        { label: 'Serviço da dívida / mês', value: money(d.servicoDividaMensal, true), to: '/dividas' },
      ]} />

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Alertas financeiros {pendentes.length ? <Badge tone={pendentes.some((a) => a.critico) ? 'bad' : 'warn'}>{pendentes.length} em aberto</Badge> : <Badge tone="ok">tudo em ordem</Badge>}</h2>
          <table>
            <thead><tr><th>Alerta</th><th className="num">Quantidade / valor</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.nome}>
                  <td><Link to={a.to}>{a.nome}</Link></td>
                  <td className="num">{a.valor}</td>
                  <td><Badge tone={a.ok ? 'ok' : a.critico ? 'bad' : 'warn'}>{a.ok ? 'OK' : a.critico ? 'Crítico' : 'Atenção'}</Badge></td>
                  <td className="muted small">{a.acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Carteira de obras</h2>
          {carteira.length === 0 ? <Empty icone="obras" titulo="Nenhuma obra cadastrada">Cadastre o primeiro contrato em Obras e contratos.</Empty> : (
            <table>
              <thead><tr><th>Obra</th><th>Status</th><th className="num">Receita</th><th className="num">EAC</th><th className="num">Margem proj.</th><th className="num">Caixa</th></tr></thead>
              <tbody>
                {carteira.map((o) => (
                  <tr key={o.obra.codigo}>
                    <td><Link to={`/obras/${o.obra.codigo}`}><b>{o.obra.codigo}</b></Link><div className="muted small">{o.obra.nome}</div></td>
                    <td><StatusBadge s={o.obra.status} /></td>
                    <td className="num"><Money v={o.receitaTotal} compact /></td>
                    <td className="num"><Money v={o.eac} compact /></td>
                    <td className={`num ${o.margemProjetada < 0 ? 'neg' : ''}`}>{pct(o.pctMargemProjetada)}</td>
                    <td className="num"><Money v={o.caixaGerado} compact sign /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Aging</h2>
        <div className="grid cols-2">
          {[{ t: 'A receber', a: d.agingReceber, to: '/receber' }, { t: 'A pagar', a: d.agingPagar, to: '/pagar' }].map((x) => (
            <div key={x.t}>
              <h3><Link to={x.to}>{x.t}</Link></h3>
              <table>
                <tbody>
                  {x.a.map((f) => (
                    <tr key={f.faixa}><td>{f.faixa}</td><td className="num muted">{f.quantidade}</td><td className="num"><Money v={f.valor} compact /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
