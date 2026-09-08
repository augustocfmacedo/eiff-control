import React from 'react';
import { EMPRESAS_SIGNAL_PILOT, NOME_ESTADO_ACAO, visaoSignalPilot } from '../../core/radar';
import { useStore } from '../../data/store';
import { Badge, KpiStrip, Link } from '../../ui/components';
import { d } from './comum';

/** Signal Pilot 01: 10 empresas acompanhadas para observar a reacao do score aos primeiros sinais reais (inseridos a mao). */
export function SignalPilot() {
  const { ds } = useStore();
  const linhas = visaoSignalPilot(ds.radar, ds.params.dataBase);
  const comSinal = linhas.filter((l) => l.signalCount > 0).length;
  const naoEncontradas = linhas.filter((l) => !l.encontrada);
  return (
    <div className="card">
      <h2>Signal Pilot 01</h2>
      <div className="small muted">{EMPRESAS_SIGNAL_PILOT.length} empresas fixas do piloto. Nada aqui é estimado: sem sinais, a contagem fica 0, o sinal mais forte fica "—" e timing/intent mostram o score atual. Insira os primeiros sinais reais na página da empresa (Registrar sinal) e volte aqui para ver como o score reage.</div>
      <KpiStrip itens={[
        { label: 'Empresas acompanhadas', value: linhas.filter((l) => l.encontrada).length, hint: naoEncontradas.length ? `${naoEncontradas.length} não encontrada(s): ${naoEncontradas.map((l) => l.nome).join(', ')}` : 'todas no Radar' },
        { label: 'Com sinal', value: comSinal },
        { label: 'Sem sinal', value: linhas.length - comSinal - naoEncontradas.length, hint: 'ação recomendada: pesquisar sinais' },
        { label: 'Sinais registrados', value: linhas.reduce((s, l) => s + l.signalCount, 0) },
      ]} />
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="small">
          <thead><tr><th>Empresa</th><th className="num">Priority score</th><th className="num">Decision fit</th><th>Contato atual</th><th className="num">Signal count</th><th>Strongest signal</th><th>Signal date</th><th className="num">Confidence</th><th className="num">Timing</th><th className="num">Intent</th><th>Recommended action</th></tr></thead>
          <tbody>{linhas.map((l) => (
            <tr key={l.nome}>
              <td>{l.empresaId ? <Link to={`/radar/empresas/${l.empresaId}`}>{l.empresa}</Link> : <span className="muted">{l.nome} (não encontrada)</span>}</td>
              <td className="num">{l.encontrada ? <>{Math.round(l.priorityScore ?? 0)} <Badge tone="muted">{l.classe}</Badge></> : '—'}</td>
              <td className="num">{l.decisionFit ?? '—'}</td>
              <td>{l.contato ? <>{l.contato}<span className="muted"> · {l.cargo ?? '—'}</span></> : '—'}</td>
              <td className="num">{l.signalCount}</td>
              <td>{l.strongestSignal ?? '—'}</td>
              <td>{l.signalDate ? d(l.signalDate) : '—'}</td>
              <td className="num">{l.confidence != null ? Math.round(l.confidence * 100) + '%' : '—'}</td>
              <td className="num">{l.timingScore != null ? Math.round(l.timingScore) : '—'}</td>
              <td className="num">{l.intentScore != null ? Math.round(l.intentScore) : '—'}</td>
              <td>{l.recommendedAction === '—' ? '—' : <><Badge tone={l.recommendedAction === 'RESEARCH_SIGNALS' ? 'muted' : l.recommendedAction === 'CONTACT_NOW' ? 'ok' : 'warn'}>{l.recommendedAction}</Badge> <span className="muted">{NOME_ESTADO_ACAO[l.recommendedAction]}</span></>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
