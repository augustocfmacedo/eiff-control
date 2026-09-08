import React from 'react';
import { EMPRESAS_SIGNAL_PILOT, HIPOTESE_SIGNAL_PILOT, NOME_ACAO_SINAL, NOME_COBERTURA, NOME_ESTADO_ACAO, NOME_FAIXA_CONFIANCA, NOME_GRUPO_SINAL, relatorioSignalIntelligence, visaoSignalPilot, type AcaoSinal, type LinhaSignalPilot } from '../../core/radar';
import { useStore } from '../../data/store';
import { Badge, KpiStrip, Link } from '../../ui/components';
import { d } from './comum';

const TOM_ACAO: Record<AcaoSinal, 'ok' | 'warn' | 'bad' | 'muted'> = { CONTACT_NOW: 'ok', FIND_BETTER_DECISION_MAKER: 'warn', RESEARCH_PROJECT: 'warn', WATCH: 'muted', RESEARCH_SIGNALS: 'muted', NURTURE: 'muted', IGNORE: 'bad' };
const pc = (v?: number) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v?: number) => (v == null ? '—' : String(Math.round(v)));

function Acao({ l }: { l: LinhaSignalPilot }) {
  if (l.recommendedAction === '—') return <>—</>;
  return <><Badge tone={TOM_ACAO[l.recommendedAction]}>{l.recommendedAction}</Badge> <span className="muted">{NOME_ACAO_SINAL[l.recommendedAction]}{l.origemAcao === 'analista' ? ' · analista' : ''}</span></>;
}
function Confianca({ l }: { l: LinhaSignalPilot }) {
  if (l.confidence == null) return <>—</>;
  const baixa = l.faixaConfianca === 'nao_usar' || l.faixaConfianca === 'indireta';
  return <><Badge tone={l.faixaConfianca === 'nao_usar' ? 'bad' : baixa ? 'warn' : 'ok'}>{pc(l.confidence)}</Badge> <span className="muted">{l.faixaConfianca ? NOME_FAIXA_CONFIANCA[l.faixaConfianca] : ''}</span></>;
}

/** Signal Pilot 01: 10 empresas acompanhadas para observar a reacao do score aos primeiros sinais reais (inseridos a mao). */
export function SignalPilot() {
  const { ds } = useStore();
  const hoje = ds.params.dataBase;
  const linhas = visaoSignalPilot(ds.radar, hoje);
  const relatorio = relatorioSignalIntelligence(ds.radar, hoje);
  const comSinal = linhas.filter((l) => l.signalCount > 0).length;
  const naoEncontradas = linhas.filter((l) => !l.encontrada);
  const H = HIPOTESE_SIGNAL_PILOT;
  return (
    <>
      <div className="card">
        <h2>Signal Pilot 01</h2>
        <div className="small muted">{EMPRESAS_SIGNAL_PILOT.length} empresas fixas do piloto. Nada aqui é estimado: sem sinais, a contagem fica 0, o sinal mais forte fica "—" e timing/intent mostram o score atual. Registre os sinais pesquisados na página da empresa (Registrar sinal, com relevância estrutural, o que aconteceu, por que importa e ação) e a linha reage sozinha. A ação recomendada vem da leitura do analista quando informada; senão da matriz operacional (hipótese do piloto: confiança ≥ {H.confiancaMinima * 100}%, timing ≥ {H.timingAlto}, fit ≥ {H.fitIdeal}, janela {H.recenteDias} dias; confiança &lt; {H.confiancaDescartar * 100}% nunca eleva prioridade). Ela não substitui a regra oficial do CRM.</div>
        <KpiStrip itens={[
          { label: 'Empresas acompanhadas', value: linhas.filter((l) => l.encontrada).length, hint: naoEncontradas.length ? `${naoEncontradas.length} não encontrada(s): ${naoEncontradas.map((l) => l.nome).join(', ')}` : 'todas no Radar' },
          { label: 'Com sinal', value: comSinal },
          { label: 'Sem sinal', value: linhas.length - comSinal - naoEncontradas.length, hint: 'ação: pesquisar sinais' },
          { label: 'Sinais registrados', value: linhas.reduce((s, l) => s + l.signalCount, 0) },
          { label: 'Contas HOT', value: linhas.filter((l) => l.matriz?.conta === 'HOT').length, hint: 'matriz operacional' },
          { label: 'Contas WARM', value: linhas.filter((l) => l.matriz?.conta === 'WARM').length },
        ]} />
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="small">
            <thead><tr><th>Empresa</th><th className="num">Priority</th><th>Classe</th><th className="num">Decision fit</th><th>Contato atual</th><th>Cobertura</th><th className="num">Sinais</th><th>Sinal mais forte</th><th>Tipo</th><th>Grupo</th><th>Relevância estrutural</th><th>Data</th><th>Confiança</th><th>Verificado</th><th className="num">Timing</th><th className="num">Intent</th><th>Ação recomendada</th><th>Why now</th></tr></thead>
            <tbody>{linhas.map((l) => (
              <tr key={l.nome}>
                <td>{l.empresaId ? <Link to={`/radar/empresas/${l.empresaId}`}>{l.empresa}</Link> : <span className="muted">{l.nome} (não encontrada)</span>}</td>
                <td className="num">{num(l.priorityScore)}</td><td>{l.classe ? <Badge tone="muted">{l.classe}</Badge> : '—'}</td>
                <td className="num">{l.decisionFit ?? '—'}</td>
                <td>{l.contato ? <>{l.contato}<span className="muted"> · {l.cargo ?? '—'}</span></> : '—'}</td>
                <td>{l.cobertura ? <span title={NOME_COBERTURA[l.cobertura]}>{l.cobertura}</span> : '—'}</td>
                <td className="num">{l.signalCount}</td>
                <td>{l.strongestSignal ?? '—'}{l.fonte ? <span className="muted"> · {l.fonte}</span> : null}</td>
                <td>{l.strongestTypeNome ?? '—'}</td>
                <td>{l.grupo ? <span title={NOME_GRUPO_SINAL[l.grupo]}>{l.grupo} · {NOME_GRUPO_SINAL[l.grupo]}</span> : '—'}</td>
                <td>{l.relevancia ?? (l.strongestType ? 'requer análise' : '—')}</td>
                <td>{l.signalDate ? d(l.signalDate) : '—'}</td>
                <td><Confianca l={l} /></td>
                <td>{l.verified == null ? '—' : l.verified ? <Badge tone="ok">sim</Badge> : <Badge tone="warn">não verificado</Badge>}</td>
                <td className="num">{num(l.timingScore)}</td><td className="num">{num(l.intentScore)}</td>
                <td><Acao l={l} />{l.estadoCrm && l.encontrada ? <div className="muted" style={{ fontSize: 11 }}>CRM: {NOME_ESTADO_ACAO[l.estadoCrm]}</div> : null}</td>
                <td>{l.whyNow}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Signal Intelligence Report 01</h2>
        <div className="small muted">Mesmas 10 empresas, ordenadas por ação recomendada (contatar → buscar decisor → pesquisar projeto → acompanhar → pesquisar sinais → nutrir → ignorar), priority score, timing e confiança. "O que aconteceu" e "por que importa" só aparecem quando o analista registrou; nunca são gerados.</div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="small">
            <thead><tr><th>#</th><th>Empresa</th><th className="num">Priority</th><th className="num">Fit</th><th className="num">Timing</th><th className="num">Intent</th><th className="num">Decision fit</th><th>Sinal mais forte</th><th>Relevância</th><th>Confiança</th><th>Data</th><th>Ação recomendada</th><th>Matriz</th><th>Analista</th><th>CRM</th><th>Conflito</th><th>Why now</th><th>O que aconteceu</th><th>Por que importa para a EIFF</th></tr></thead>
            <tbody>{relatorio.map((l, i) => (
              <tr key={l.nome}>
                <td>{i + 1}</td>
                <td>{l.empresaId ? <Link to={`/radar/empresas/${l.empresaId}`}>{l.empresa}</Link> : <span className="muted">{l.nome}</span>}</td>
                <td className="num">{num(l.priorityScore)}</td><td className="num">{num(l.fitScore)}</td><td className="num">{num(l.timingScore)}</td><td className="num">{num(l.intentScore)}</td><td className="num">{l.decisionFit ?? '—'}</td>
                <td>{l.strongestSignal ?? '—'}</td><td>{l.relevancia ?? (l.strongestType ? 'requer análise' : '—')}</td><td><Confianca l={l} /></td><td>{l.signalDate ? d(l.signalDate) : '—'}</td>
                <td><Acao l={l} />{l.matriz ? <div className="muted" style={{ fontSize: 11 }}>{l.matriz.conta} · {l.matriz.motivo}</div> : null}</td>
                <td>{l.matriz?.acao ?? '—'}</td><td>{l.leitura?.acaoRecomendada ?? '—'}</td><td>{l.estadoCrm ?? '—'}</td>
                <td>{l.conflito ? <Badge tone={l.conflito === 'ACTION_CONFLICT' ? 'warn' : 'ok'}>{l.conflito}</Badge> : '—'}</td>
                <td>{l.whyNow}</td>
                <td>{l.leitura?.oQueAconteceu ?? (l.strongestType ? 'requer análise' : '—')}</td>
                <td>{l.leitura?.porQueImporta ?? (l.strongestType ? 'requer análise' : '—')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
