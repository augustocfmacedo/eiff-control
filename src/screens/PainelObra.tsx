import React, { useMemo, useState } from 'react';
import { analisarObra, type AnaliseObra } from '../core/analise';
import { calcLancamentos, carteiraObras, startOfMonth, type Obra360 } from '../core/engine';
import { obrasVisiveis, useStore } from '../data/store';
import { Badge, Empty, Kpi, Link, Money, dataHora, money, pct } from '../ui/components';
import { DivergingBars, Gauge, LineChart } from '../ui/charts';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const idx = (v?: number) => (v === undefined ? '—' : v.toFixed(2).replace('.', ','));

function CartaoObra({ a, ativo, onClick }: { a: AnaliseObra; ativo: boolean; onClick: () => void }) {
  const neg = a.pontos.filter((p) => p.sinal === 'negativo').length;
  const at = a.pontos.filter((p) => p.sinal === 'atencao').length;
  const pos = a.pontos.filter((p) => p.sinal === 'positivo').length;
  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer', outline: ativo ? '2px solid var(--primary-2)' : undefined, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b><span className={`semaforo ${a.semaforo}`} />{a.codigo}</b>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{a.score}<span className="muted small">/100</span></span>
      </div>
      <div className="muted small" style={{ marginBottom: 6 }}>{a.nome}</div>
      <div className="small">faturado {pct(a.pctFaturado)} · físico {pct(a.pctFisico)} · margem {pct(a.margemProjetada)}</div>
      <div className="small" style={{ marginTop: 4 }}><Badge tone="bad">{neg} negativo(s)</Badge> <Badge tone="warn">{at} atenção</Badge> <Badge tone="ok">{pos} positivo(s)</Badge></div>
    </div>
  );
}

export default function PainelObra({ carteira }: { carteira: Obra360[] }) {
  const { ds } = useStore();
  const lancs = useMemo(() => calcLancamentos(ds), [ds]);
  const analises = useMemo(() => carteira.map((o) => analisarObra(ds, o, lancs)), [ds, carteira, lancs]);
  const [sel, setSel] = useState<string>(analises[0]?.codigo ?? '');
  const a = analises.find((x) => x.codigo === sel) ?? analises[0];
  const o = carteira.find((x) => x.obra.codigo === a?.codigo);
  if (!a || !o) return <Empty>Nenhuma obra ativa no seu escopo.</Empty>;
  const hojeIdx = a.curva.findIndex((p) => p.mes === startOfMonth(ds.params.dataBase));
  const desvios = o.servicos.filter((s) => s.faturado > 0 || s.custoComprometido > 0).map((s) => ({ nome: `${s.codigo} ${s.nome}`, valor: s.desvioVsFaturado, detalhe: `comprometido ${money(s.custoComprometido)} · previsto p/ faturado ${money(s.custoPrevistoProporcional)}` })).sort((x, y) => y.valor - x.valor).slice(0, 10);
  const scoreCarteira = analises.length ? Math.round(analises.reduce((s, x) => s + x.score, 0) / analises.length) : 0;

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <Kpi label="Saúde da carteira" value={<><span className={`semaforo ${scoreCarteira >= 80 ? 'verde' : scoreCarteira >= 60 ? 'amarelo' : 'vermelho'}`} />{scoreCarteira}/100</>} hint={`${analises.filter((x) => x.semaforo === 'vermelho').length} obra(s) em vermelho · ${analises.filter((x) => x.semaforo === 'amarelo').length} em amarelo`} />
        <Kpi label="Faturado × previsto até hoje" value={money(analises.reduce((s, x) => s + (carteira.find((c) => c.obra.codigo === x.codigo)?.medicoes.faturado ?? 0), 0), true)} hint={`IDP médio ${idx(analises.filter((x) => x.idp !== undefined).length ? analises.reduce((s, x) => s + (x.idp ?? 0), 0) / analises.filter((x) => x.idp !== undefined).length : undefined)}`} />
        <Kpi label="A faturar em 30 dias" value={money(analises.reduce((s, x) => s + x.aFaturar30d, 0), true)} hint={`a receber ${money(analises.reduce((s, x) => s + x.aReceber30d, 0), true)} · a pagar ${money(analises.reduce((s, x) => s + x.pagar30d, 0), true)}`} />
        <Kpi label="Recebíveis vencidos" value={money(analises.reduce((s, x) => s + x.recebiveisVencidos, 0), true)} tone={analises.some((x) => x.recebiveisVencidos > 0) ? 'bad' : 'ok'} hint={`retenção acumulada ${money(analises.reduce((s, x) => s + x.retencaoAcumulada, 0), true)}`} />
      </div>
      {analises.length > 1 && (
        <div className="grid cols-4" style={{ marginBottom: 12 }}>
          {analises.map((x) => <CartaoObra key={x.codigo} a={x} ativo={x.codigo === a.codigo} onClick={() => setSel(x.codigo)} />)}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2><span className={`semaforo ${a.semaforo}`} /><Link to={`/obras/${a.codigo}`}>{a.codigo}</Link> · {a.nome}</h2>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{a.score}<span className="muted small">/100</span></div>
        </div>
        <div className="grid cols-4" style={{ marginTop: 10 }}>
          <div className="kpi"><div className="label">IDP · prazo do faturamento</div><div className={`value ${a.idp !== undefined && a.idp < 0.9 ? 'neg' : ''}`}>{idx(a.idp)}</div><div className="hint">faturado ÷ previsto até hoje · {pct(a.pctFaturado)} de {pct(a.pctPlanejadoAteHoje)}</div></div>
          <div className="kpi"><div className="label">IDC · custo</div><div className={`value ${a.idc !== undefined && a.idc < 0.9 ? 'neg' : ''}`}>{idx(a.idc)}</div><div className="hint">previsto p/ faturado ÷ comprometido · {o.custoComprometido ? money(o.custoComprometido, true) : 'sem custo lançado'}</div></div>
          <div className="kpi"><div className="label">Margem projetada × meta</div><div className={`value ${a.desvioMargemPp < 0 ? 'neg' : 'pos'}`}>{pct(a.margemProjetada)}</div><div className="hint">meta {pct(a.margemAlvo)} · {a.desvioMargemPp >= 0 ? '+' : ''}{a.desvioMargemPp.toFixed(1).replace('.', ',')} pp</div></div>
          <div className="kpi"><div className="label">Caixa da obra</div><div className={`value ${a.caixaObra < 0 ? 'neg' : ''}`}>{money(a.caixaObra, true)}</div><div className="hint">vencidos {money(a.recebiveisVencidos, true)} · receber 30d {money(a.aReceber30d, true)} · pagar 30d {money(a.pagar30d, true)}</div></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Pontos negativos e de atenção</h2>
          {a.pontos.filter((p) => p.sinal !== 'positivo').length === 0 ? <Empty>Nenhum ponto negativo. Obra saudável.</Empty> : (
            <ul className="pontos">
              {a.pontos.filter((p) => p.sinal !== 'positivo').map((p, i) => <li key={i}><span>{p.sinal === 'negativo' ? '🔴' : '🟡'}</span><span><div className="tema">{p.tema} · −{p.peso}</div>{p.texto}</span></li>)}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>Pontos positivos</h2>
          {a.pontos.filter((p) => p.sinal === 'positivo').length === 0 ? <Empty>Ainda sem pontos positivos registrados.</Empty> : (
            <ul className="pontos">
              {a.pontos.filter((p) => p.sinal === 'positivo').map((p, i) => <li key={i}><span>🟢</span><span><div className="tema">{p.tema}</div>{p.texto}</span></li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <LineChart
            titulo="Curva S · receita líquida prevista × faturada e custo previsto × comprometido (acumulado)"
            rotulos={a.curva.map((p) => p.rotulo)}
            marcador={hojeIdx}
            series={[
              { nome: 'Receita prevista', valores: a.curva.map((p) => p.previsto) },
              { nome: 'Faturado', valores: a.curva.map((p) => p.faturado) },
              { nome: 'Custo comprometido', valores: a.curva.map((p) => p.custo) },
              { nome: 'Custo previsto', valores: a.curva.map((p) => p.custoPrevisto), tracejada: true },
            ]}
          />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Avanço</h3>
          <Gauge label="Faturado (receita EIFF)" valor={a.pctFaturado} meta={a.pctPlanejadoAteHoje} />
          <Gauge label="Físico (ponderado pelos serviços)" valor={a.pctFisico} meta={a.pctPlanejadoAteHoje} />
          <Gauge label="Financeiro (pago ÷ EAC)" valor={a.pctFinanceiro} meta={a.pctFaturado} maior={false} />
          <Gauge label="Margem projetada" valor={Math.max(0, a.margemProjetada)} meta={a.margemAlvo} />
          <Gauge label="Aderência ao check-list (30 dias)" valor={a.aderenciaChecklist} meta={0.8} />
          <h3 style={{ margin: '14px 0 8px' }}>Equipe · últimos 30 dias</h3>
          <div className="grid cols-2 small">
            <div>Efetivo médio <b>{Math.round(a.equipe.efetivoMedio * 10) / 10}</b> em {a.equipe.dias} dia(s)</div>
            <div>Horas <b>{Math.round(a.equipe.hh)} h</b> · custo MO <b>{money(a.equipe.custoMO, true)}</b></div>
            <div>Absenteísmo <b className={a.equipe.absenteismo > 0.05 ? 'neg' : ''}>{pct(a.equipe.absenteismo)}</b></div>
            <div>Horas perdidas <b className={a.equipe.horasPerdidas > 0 ? 'neg' : ''}>{Math.round(a.equipe.horasPerdidas)} h</b></div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          {desvios.length ? <DivergingBars titulo="Desvio de custo por serviço (comprometido − previsto para o faturado)" itens={desvios} /> : <><h3>Desvio de custo por serviço</h3><Empty>Aparece quando houver custos lançados contra os serviços.</Empty></>}
          <h3 style={{ margin: '14px 0 6px' }}>Próximos marcos de medição</h3>
          {a.proximosMarcos.length === 0 ? <div className="muted small">Sem eventos pendentes.</div> : (
            <table><tbody>
              {a.proximosMarcos.map((m) => <tr key={m.numero}><td><b>{m.numero}</b></td><td>{m.evento}</td><td className={m.dias !== undefined && m.dias < 0 ? 'neg' : ''}>{d(m.data)}{m.dias !== undefined && <span className="muted small"> ({m.dias} d)</span>}</td><td><Money v={m.liquido} compact /></td></tr>)}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Atividade recente na obra</h3>
          {a.atividade.length === 0 ? <div className="muted small">Sem movimentações registradas.</div> : (
            <ul className="timeline">{a.atividade.map((x, i) => <li key={i}><div>{x.texto}</div><div className="meta">{x.usuario} · {dataHora(x.ts)}</div></li>)}</ul>
          )}
        </div>
      </div>
    </>
  );
}

export { carteiraObras, obrasVisiveis };
