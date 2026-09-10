import React, { useMemo, useState } from 'react';
import { calcLancamentos, fluxo13Semanas, fluxo24Meses, posicaoBancaria, reservaVinculadaTotal, type FluxoCaixa } from '../core/engine';
import type { Cenario } from '../core/types';
import { AJUSTES_ZERO, aplicarCenario, cenarioAtivo, type AjustesCenario } from '../core/cenarioCaixa';
import { LineChart } from '../ui/charts';
import { MoedaInput } from '../ui/components';
import { obrasVisiveis, pode, useStore } from '../data/store';
import { Bars, Empty, Kpi, Link, Money, PageHead, money } from '../ui/components';
import { navegar } from '../ui/router';

function TabelaFluxo({ f, onCelula }: { f: FluxoCaixa; onCelula?: (linha: string, ini: string, fim: string) => void }) {
  const n = f.periodos.length;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th className="sticky">Linha</th>{f.periodos.map((p) => <th key={p.ini} className="num">{p.rotulo}</th>)}<th className="num">Total</th></tr>
        </thead>
        <tbody>
          <tr className="total"><td className="sticky">SALDO INICIAL</td>{f.saldoFinal.map((s, i) => <td key={i}><Money v={i === 0 ? f.saldoInicial : f.saldoFinal[i - 1]} /></td>)}<td /></tr>
          {f.grupos.map((g) => (
            <React.Fragment key={g.nome}>
              <tr className="section"><td className="sticky">{g.nome}</td><td colSpan={n + 1} /></tr>
              {g.linhas.filter((li) => li.total !== 0).map((li) => (
                <tr key={li.nome}>
                  <td className="sticky">{li.nome}</td>
                  {li.valores.map((v, i) => <td key={i} className={onCelula && v ? 'clickable' : ''} onClick={onCelula && v ? () => onCelula(li.nome, f.periodos[i].ini, f.periodos[i].fim) : undefined}><Money v={v || undefined} /></td>)}
                  <td><Money v={li.total} /></td>
                </tr>
              ))}
              <tr className="sub"><td className="sticky">TOTAL {g.nome}</td>{g.totais.map((v, i) => <td key={i}><Money v={v} /></td>)}<td><Money v={g.totais.reduce((a, b) => a + b, 0)} /></td></tr>
            </React.Fragment>
          ))}
          <tr className="sub"><td className="sticky">TOTAL ENTRADAS</td>{f.totalEntradas.map((v, i) => <td key={i}><Money v={v} /></td>)}<td><Money v={f.totalEntradas.reduce((a, b) => a + b, 0)} /></td></tr>
          <tr className="sub"><td className="sticky">TOTAL SAÍDAS</td>{f.totalSaidas.map((v, i) => <td key={i}><Money v={v} /></td>)}<td><Money v={f.totalSaidas.reduce((a, b) => a + b, 0)} /></td></tr>
          <tr className="sub"><td className="sticky">FLUXO LÍQUIDO</td>{f.fluxoLiquido.map((v, i) => <td key={i}><Money v={v} sign /></td>)}<td><Money v={f.fluxoLiquido.reduce((a, b) => a + b, 0)} sign /></td></tr>
          <tr className="total"><td className="sticky">SALDO FINAL</td>{f.saldoFinal.map((v, i) => <td key={i}><Money v={v} /></td>)}<td /></tr>
          <tr><td className="sticky">RESERVA MÍNIMA</td>{f.periodos.map((_, i) => <td key={i}><Money v={f.reservaMinima} /></td>)}<td /></tr>
          <tr className="total"><td className="sticky">EXCESSO / (NECESSIDADE)</td>{f.excesso.map((v, i) => <td key={i}><Money v={v} sign /></td>)}<td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function Cenarios({ cenario, setCenario }: { cenario: Cenario; setCenario: (c: Cenario) => void }) {
  const { ds } = useStore();
  return (
    <div className="actions">
      {(['Conservador', 'Base', 'Otimista'] as Cenario[]).map((c) => (
        <button key={c} className={`btn sm ${c === cenario ? 'primary' : ''}`} onClick={() => setCenario(c)} title={`entradas ×${ds.params.fatores[c].entradas} · saídas ×${ds.params.fatores[c].saidas}`}>{c}</button>
      ))}
    </div>
  );
}

export function Fluxo13() {
  const { ds, usuario } = useStore();
  const [cenario, setCenario] = useState<Cenario>(ds.params.cenario);
  const [obra, setObra] = useState('');
  const f = fluxo13Semanas(ds, cenario, 13, obra ? (l) => l.codigoObra === obra : undefined);
  const criticas = f.periodos.filter((_, i) => f.excesso[i] < 0);
  const comp = (['Conservador', 'Base', 'Otimista'] as Cenario[]).map((c) => ({ c, f: fluxo13Semanas(ds, c, 13, obra ? (l) => l.codigoObra === obra : undefined) }));
  return (
    <>
      <PageHead title="Fluxo de caixa — 13 semanas" subtitle="Visão tática para decisões semanais de cobrança, compras, pagamentos e necessidade de capital. Clique em uma célula para ver os lançamentos.">
        <select value={obra} onChange={(e) => setObra(e.target.value)} className="btn sm"><option value="">Consolidado</option>{obrasVisiveis(usuario, ds.obras).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo}</option>)}</select>
        <Cenarios cenario={cenario} setCenario={setCenario} />
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Saldo inicial" value={money(f.saldoInicial)} />
        <Kpi label="Saldo final S13" value={money(f.saldoFinal[12])} tone={f.saldoFinal[12] < f.reservaMinima ? 'bad' : 'ok'} />
        <Kpi label="Menor saldo" value={money(f.menorSaldo)} hint={`na ${f.periodos[f.saldoFinal.indexOf(f.menorSaldo)]?.rotulo}`} tone={f.menorSaldo < f.reservaMinima ? 'bad' : 'ok'} />
        <Kpi label="Necessidade máxima" value={money(f.necessidadeMaxima)} hint={`${criticas.length} semana(s) crítica(s)`} tone={f.necessidadeMaxima > 0 ? 'warn' : 'ok'} />
      </div>
      {criticas.length > 0 && <div className="alert warn"><b>Semanas críticas:</b> {criticas.map((p) => p.rotulo).join(', ')}. Cada semana crítica precisa de plano de ação (cobrar, negociar, reprogramar ou capitalizar) registrado no comitê de caixa.</div>}
      <div className="card"><Bars valores={f.saldoFinal} rotulos={f.periodos.map((p) => p.rotulo)} /></div>
      <CenarioInterativo cenario={cenario} obra={obra} base={f} />
      <div className="card"><TabelaFluxo f={f} onCelula={(linha, ini, fim) => navegar(`/lancamentos?busca=${encodeURIComponent(linha)}&de=${ini}&ate=${fim}`)} /></div>
      <div className="card">
        <h2>Comparação de cenários</h2>
        <table><thead><tr><th>Cenário</th><th>Fatores</th><th>Entradas 13S</th><th>Saídas 13S</th><th>Menor saldo</th><th>Saldo final</th><th>Necessidade</th></tr></thead><tbody>
          {comp.map(({ c, f: x }) => <tr key={c}><td><b>{c}</b></td><td className="small">×{ds.params.fatores[c].entradas} / ×{ds.params.fatores[c].saidas}</td><td><Money v={x.totalEntradas.reduce((a, b) => a + b, 0)} /></td><td><Money v={x.totalSaidas.reduce((a, b) => a + b, 0)} /></td><td><Money v={x.menorSaldo} /></td><td><Money v={x.saldoFinal[12]} /></td><td><Money v={x.necessidadeMaxima} /></td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}

export function Fluxo24() {
  const { ds } = useStore();
  const [cenario, setCenario] = useState<Cenario>(ds.params.cenario);
  const f = fluxo24Meses(ds, cenario);
  return (
    <>
      <PageHead title="Fluxo de caixa — 24 meses" subtitle="Visão mensal para contratação, capacidade produtiva, investimentos e estrutura de capital."><Cenarios cenario={cenario} setCenario={setCenario} /></PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Saldo final M24" value={money(f.saldoFinal[23])} />
        <Kpi label="Menor saldo" value={money(f.menorSaldo)} tone={f.menorSaldo < f.reservaMinima ? 'bad' : 'ok'} />
        <Kpi label="Entradas 24M" value={money(f.totalEntradas.reduce((a, b) => a + b, 0))} />
        <Kpi label="Saídas 24M" value={money(f.totalSaidas.reduce((a, b) => a + b, 0))} />
      </div>
      <div className="card"><Bars valores={f.saldoFinal} rotulos={f.periodos.map((p) => p.rotulo)} /></div>
      <div className="card"><TabelaFluxo f={f} /></div>
    </>
  );
}

export function PosicaoDiaria() {
  const { ds, usuario } = useStore();
  if (!pode(usuario, 'ver_bancos')) return <Empty>Saldos bancários são restritos a Financeiro, Diretoria, Contabilidade e Auditoria.</Empty>;
  const lancs = calcLancamentos(ds).filter((l) => l.oficial);
  const posicoes = posicaoBancaria(ds, lancs);
  const contas = posicoes.map((p) => {
    const vinculado = lancs.filter((l) => l.contaFinanceira === p.conta.instituicao && l.tipo === 'Saída' && l.situacao === 'Próximos 7 dias').reduce((a, l) => a + l.saldoAberto, 0);
    return { ...p, vinculado, disponivel: p.saldoBancario - p.conta.reservaVinculada - vinculado };
  });
  const tot = (f: (x: (typeof contas)[number]) => number) => contas.reduce((a, x) => a + f(x), 0);
  const naoLancado = tot((x) => x.naoLancado);
  const pendentes = tot((x) => x.transacoesPendentes);
  const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
  return (
    <>
      <PageHead title="Posição diária" subtitle={`Saldo bancário = saldo de abertura em ${d(ds.params.dataBase)} + créditos − débitos do extrato importado, conciliados ou não${ds.params.corteExtrato ? ` (só movimentos a partir de ${d(ds.params.corteExtrato)}, corte do extrato)` : ''}. O saldo por lançamentos considera só o que já foi lançado; a diferença é o que falta conciliar ou lançar.`} />
      {ds.params.corteExtrato && contas.some((x) => (x.conta.saldoInicialData ?? ds.params.dataBase) < ds.params.corteExtrato!) && <div className="alert warn">Corte do extrato em {d(ds.params.corteExtrato)}: {contas.filter((x) => (x.conta.saldoInicialData ?? ds.params.dataBase) < ds.params.corteExtrato!).map((x) => x.conta.instituicao).join(', ')} tem saldo de abertura anterior ao corte. Ajuste em Cadastros › Contas financeiras a data e o saldo de abertura para {d(ds.params.corteExtrato)} (saldo do extrato naquele dia), senão o saldo bancário fica sem os movimentos entre a abertura e o corte.</div>}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Saldo bancário hoje" value={money(tot((x) => x.saldoBancario))} hint={`abertura ${money(tot((x) => x.saldoInicial))} · extrato até ${d(contas.map((x) => x.ultimaTransacao).filter(Boolean).sort().pop())}`} />
        <Kpi label="Saldo por lançamentos" value={money(tot((x) => x.saldoLancamentos))} hint={`${money(Math.abs(naoLancado))} ${naoLancado < 0 ? 'de saídas' : 'de entradas'} do extrato ainda não lançadas`} tone={pendentes ? 'warn' : 'ok'} to="/conciliacao" />
        <Kpi label="Saídas próximos 7 dias" value={money(tot((x) => x.vinculado))} hint={`reserva vinculada ${money(reservaVinculadaTotal(ds))}`} to="/pagar" />
        <Kpi label="Disponível" value={money(tot((x) => x.disponivel))} hint="saldo bancário − reserva − próximos 7 dias" tone={tot((x) => x.disponivel) < ds.params.reservaMinima ? 'bad' : 'ok'} />
      </div>
      {pendentes > 0 && <div className="alert warn">{pendentes} transação(ões) do extrato sem lançamento vinculado, somando {money(naoLancado, false)}. Enquanto não forem conciliadas ou lançadas, o fluxo de 13 semanas e a DRE não as enxergam. <Link to="/conciliacao">Ir para a conciliação</Link>.</div>}
      <div className="card table-wrap">
        <table><thead><tr><th>ID</th><th>Instituição</th><th>Conta</th><th>Saldo abertura</th><th>Créditos extrato</th><th>Débitos extrato</th><th>Saldo bancário</th><th>Realizado por lançamentos</th><th>Saldo por lançamentos</th><th>Não lançado</th><th>Reserva</th><th>Próx. 7 dias</th><th>Disponível</th><th>Último extrato</th></tr></thead>
          <tbody>{contas.map((x) => (
            <tr key={x.conta.id}>
              <td>{x.conta.id}</td><td>{x.conta.instituicao}</td><td>{x.conta.conta}</td>
              <td><Money v={x.saldoInicial} /></td><td><Money v={x.creditosBanco} /></td><td><Money v={x.debitosBanco} /></td><td><b><Money v={x.saldoBancario} /></b></td>
              <td><Money v={x.realizadoLancamentos} sign /></td><td><Money v={x.saldoLancamentos} /></td><td className={x.transacoesPendentes ? 'neg' : ''}><Money v={x.naoLancado} sign /><div className="muted small">{x.transacoesPendentes} pend.</div></td>
              <td><Money v={x.conta.reservaVinculada} /></td><td><Money v={x.vinculado} /></td><td><Money v={x.disponivel} /></td><td className="muted small">{d(x.ultimaTransacao)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

/** Cenarios interativos: ajustes hipoteticos (atraso de recebimentos, adiamento de pagamentos, corte, novo contrato) sobre uma
 *  copia dos lancamentos; o motor recalcula as 13 semanas e a curva do cenario aparece contra a base. Nada e gravado. */
function CenarioInterativo({ cenario, obra, base }: { cenario: Cenario; obra: string; base: FluxoCaixa }) {
  const { ds } = useStore();
  const [a, setA] = useState<AjustesCenario>(AJUSTES_ZERO);
  const ativo = cenarioAtivo(a);
  const f = useMemo(() => (ativo ? fluxo13Semanas(aplicarCenario(ds, a), cenario, 13, obra ? (l) => l.codigoObra === obra : undefined) : base), [ds, a, cenario, obra, base, ativo]);
  const up = (p: Partial<AjustesCenario>) => setA((x) => ({ ...x, ...p }));
  const delta = f.menorSaldo - base.menorSaldo;
  return (
    <div className="card cenario">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>E se… (cenário interativo, nada é gravado)</h2>
        {ativo && <button className="btn sm" onClick={() => setA(AJUSTES_ZERO)}>Limpar cenário</button>}
      </div>
      <div className="cenario-controles">
        <label className="field"><span>Recebimentos atrasam <b>{a.atrasoRecebimentosDias} dias</b></span><input type="range" min={0} max={60} step={5} value={a.atrasoRecebimentosDias} onChange={(e) => up({ atrasoRecebimentosDias: Number(e.target.value) })} /></label>
        <label className="field"><span>Pagamentos adiados <b>{a.adiamentoPagamentosDias} dias</b></span><input type="range" min={0} max={60} step={5} value={a.adiamentoPagamentosDias} onChange={(e) => up({ adiamentoPagamentosDias: Number(e.target.value) })} /></label>
        <label className="field"><span>Corte em despesas sem obra <b>{Math.round(a.corteDespesasPct * 100)}%</b></span><input type="range" min={0} max={50} step={5} value={Math.round(a.corteDespesasPct * 100)} onChange={(e) => up({ corteDespesasPct: Number(e.target.value) / 100 })} /></label>
        <label className="field"><span>Novo contrato (receita líquida)</span><MoedaInput value={a.novoContratoValor} onChange={(v) => up({ novoContratoValor: Math.max(0, v) })} /></label>
        <label className="field"><span>Primeira parcela em <b>{a.novoContratoInicioSemanas} semana(s)</b></span><input type="range" min={0} max={12} step={1} value={a.novoContratoInicioSemanas} onChange={(e) => up({ novoContratoInicioSemanas: Number(e.target.value) })} /></label>
        <label className="field"><span>Parcelas mensais <b>{a.novoContratoParcelas}</b></span><input type="range" min={1} max={12} step={1} value={a.novoContratoParcelas} onChange={(e) => up({ novoContratoParcelas: Number(e.target.value) })} /></label>
      </div>
      <div className="grid cols-4" style={{ marginTop: 12 }}>
        <Kpi label="Menor saldo (cenário)" value={money(f.menorSaldo)} hint={ativo ? `${delta >= 0 ? '+' : ''}${money(delta, true)} vs. base` : 'ajuste um controle'} tone={f.menorSaldo < f.reservaMinima ? 'bad' : 'ok'} />
        <Kpi label="Saldo final S13 (cenário)" value={money(f.saldoFinal[12])} hint={ativo ? `${f.saldoFinal[12] - base.saldoFinal[12] >= 0 ? '+' : ''}${money(f.saldoFinal[12] - base.saldoFinal[12], true)} vs. base` : undefined} tone={f.saldoFinal[12] < f.reservaMinima ? 'bad' : 'ok'} />
        <Kpi label="Necessidade máxima (cenário)" value={money(f.necessidadeMaxima)} tone={f.necessidadeMaxima > 0 ? 'warn' : 'ok'} />
        <Kpi label="Semanas críticas" value={String(f.periodos.filter((_, i) => f.excesso[i] < 0).length)} hint={`base: ${base.periodos.filter((_, i) => base.excesso[i] < 0).length}`} />
      </div>
      <div style={{ marginTop: 12 }}><LineChart rotulos={base.periodos.map((p) => p.rotulo)} series={[{ nome: 'Base', valores: base.saldoFinal, tracejada: true }, { nome: ativo ? 'Cenário' : 'Cenário (= base)', valores: f.saldoFinal }, { nome: 'Reserva mínima', valores: base.periodos.map(() => base.reservaMinima), tracejada: true }]} /></div>
    </div>
  );
}
