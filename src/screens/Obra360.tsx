import React, { useState } from 'react';
import { calcLancamentos, fluxo13Semanas, obra360 } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { Bars, Empty, Field, KpiHero, KpiStrip, Link, Modal, Money, NumberInput, PageHead, PrintHead, ProgressRow, StatusBadge, Tabs, money, pct, tentar, useToast } from '../ui/components';
import { Sparkline } from '../ui/charts';
import { Timeline } from '../ui/Timeline';
import { ObraForm } from './Obras';
import { LancamentoForm } from './LancamentoForm';
import { DemandasTab, MedicoesTab, ProducaoTab, ServicosTab } from './ObraOperacao';

export default function Obra360({ codigo }: { codigo: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'resumo' | 'medicoes' | 'servicos' | 'demandas' | 'fabricacao' | 'montagem' | 'financeiro' | 'execucao' | 'timeline'>('resumo');
  const [editando, setEditando] = useState(false);
  const [novoLanc, setNovoLanc] = useState(false);
  const [exec, setExec] = useState<{ execucaoFisica: number; medidoFaturado: number; estimativaConcluir: number; justificativa: string } | null>(null);
  const obra = ds.obras.find((o) => o.codigo === codigo);
  if (!obra) return <Empty>Obra {codigo} não encontrada. <Link to="/obras">Voltar</Link></Empty>;
  if (!pode(usuario, 'comentar', codigo) && usuario.obras !== '*' && !usuario.obras.includes(codigo)) return <Empty>Acesso negado: obra fora do seu escopo.</Empty>;
  const o = obra360(ds, obra, calcLancamentos(ds));
  const f13 = fluxo13Semanas(ds, ds.params.cenario, 13, (l) => l.codigoObra === codigo);
  const verBancos = pode(usuario, 'ver_bancos');
  const movimentos = [...o.entradas, ...o.saidas].sort((a, b) => ((a.dataCaixa ?? '') < (b.dataCaixa ?? '') ? -1 : 1));

  return (
    <>
      <PageHead title={`${obra.codigo} · ${obra.nome}`} subtitle={<>{obra.cliente} · {obra.cidadeUf} · <StatusBadge s={obra.status} /> {o.diasParaPrazo !== undefined && <span className={o.diasParaPrazo < 0 ? 'neg' : 'muted'}> · {o.diasParaPrazo} dias para o prazo contratual</span>}</>}>
        {pode(usuario, 'editar_etc', codigo) && <button className="btn" onClick={() => setExec({ execucaoFisica: obra.execucaoFisica, medidoFaturado: obra.medidoFaturado, estimativaConcluir: obra.estimativaConcluir, justificativa: '' })}>Atualizar execução / ETC</button>}
        {pode(usuario, 'editar_lancamento', codigo) && <button className="btn" onClick={() => setNovoLanc(true)}>+ Compromisso / recebível</button>}
        <button className="btn" onClick={() => window.print()} title="Imprime a Obra 360 como relatório">Imprimir relatório</button>
        {pode(usuario, 'editar_obra', codigo) && <button className="btn primary" onClick={() => setEditando(true)}>Editar contrato</button>}
      </PageHead>
      <PrintHead titulo={`${obra.codigo} · ${obra.nome}`} subtitulo={`${obra.cliente} · ${obra.cidadeUf} · data-base ${ds.params.dataBase.split('-').reverse().join('/')}`} />
      {o.ativa && !o.etc && !o.custoComprometido && <div className="alert warn">Estimativa a concluir (ETC) não informada: a margem projetada de {pct(o.pctMargemProjetada)} está superestimada. Atualize a execução.</div>}
      {o.margemProjetada < 0 && <div className="alert bad">Margem projetada negativa. Reorçar e travar novos compromissos.</div>}

      <div className="hero-grid">
        <KpiHero label="Margem projetada" value={money(o.margemProjetada)} sufixo={pct(o.pctMargemProjetada)} tone={o.margemProjetada < 0 ? 'bad' : o.pctMargemProjetada < 0.1 ? 'warn' : 'ok'}
          hint={`receita ${money(o.receitaTotal, true)} − EAC ${money(o.eac, true)} (pago ${money(o.custoPago, true)} · em aberto ${money(o.comprometidoAberto, true)} · ETC não comprometido ${money(o.etcNaoComprometido, true)})`}
          secundarios={[
            { label: 'Receita total', value: money(o.receitaTotal, true) },
            { label: o.temServicos ? 'Custo previsto' : 'Custo orçado', value: money(o.custoOrcado, true) },
            { label: 'EAC', value: money(o.eac, true) },
            { label: 'Orçamento disponível', value: money(o.orcamentoDisponivel, true), tone: o.orcamentoDisponivel < 0 ? 'neg' : undefined },
          ]}>
          <ProgressRow label="Execução física" valor={o.execucaoFisica} />
          <ProgressRow label="Faturado do contrato" valor={o.medicoes.liquidoConstrutora ? o.medicoes.faturado / o.medicoes.liquidoConstrutora : o.receitaTotal ? o.medidoFaturado / o.receitaTotal : 0} />
          <ProgressRow label="Orçamento comprometido" valor={o.custoOrcado ? o.custoComprometido / o.custoOrcado : 0} tone={o.custoOrcado && o.custoComprometido > o.custoOrcado ? 'bad' : undefined} />
        </KpiHero>
        <KpiHero label="Caixa da obra" value={money(o.caixaGerado)} hint="recebido − pago pela EIFF (sem faturamento direto)" tone={o.caixaGerado < 0 ? 'warn' : undefined} to={`/receber?obra=${codigo}`}
          secundarios={[
            { label: 'Medido / faturado', value: money(o.medidoFaturado, true) },
            { label: 'Recebido', value: money(o.recebido, true) },
            { label: 'Contas a receber', value: money(o.contasAReceber, true) },
            { label: 'Pago pela EIFF', value: money(o.custoPagoEIFF, true) },
          ]}>
          <Sparkline valores={f13.saldoFinal} rotulos={f13.periodos.map((p) => p.rotulo)} />
          <div className="muted small">Saldo acumulado da obra nas próximas 13 semanas</div>
        </KpiHero>
      </div>
      <KpiStrip itens={[
        { label: 'Comprometido', value: money(o.custoComprometido, true), hint: `em aberto ${money(o.comprometidoAberto, true)}`, to: `/pagar?obra=${codigo}` },
        { label: 'Faturamento direto usado', value: money(o.faturamentoDiretoUtilizado, true), hint: `saldo ${money(o.faturamentoDiretoSaldo, true)} de ${money(o.faturamentoDiretoContratado, true)}`, tone: o.faturamentoDiretoSaldo < 0 ? 'neg' : undefined },
        { label: 'ETC', value: money(o.etc, true), hint: `não comprometido ${money(o.etcNaoComprometido, true)}` },
        { label: 'Saldo a medir', value: money(o.saldoAMedir, true), hint: `${o.medicoes.pendentes} evento(s) pendente(s)`, tone: o.medicoes.atrasadas ? 'warn' : undefined },
        { label: 'Margem orçada', value: pct(o.pctMargemOrcada), hint: o.custoOrcamentoExecutivo > 0 ? `orçamento executivo ${money(o.custoOrcamentoExecutivo, true)}` : `margem alvo ${pct(o.margemAlvo)}` },
        { label: 'Prazo', value: o.diasParaPrazo !== undefined ? `${o.diasParaPrazo} d` : '—', hint: obra.fimContratual ? obra.fimContratual.split('-').reverse().join('/') : 'sem fim contratual', tone: o.diasParaPrazo !== undefined && o.diasParaPrazo < 0 ? 'neg' : undefined },
      ]} />

      <div className="card" style={{ marginTop: 16 }}>
        <Tabs value={aba} onChange={setAba} items={[
          { id: 'resumo', label: 'Resumo econômico' },
          { id: 'medicoes', label: `Cronograma e medições (${o.medicoes.medicoes.filter((m) => m.medida).length}/${o.medicoes.medicoes.length})` },
          { id: 'servicos', label: `Serviços (${o.servicos.length})` },
          { id: 'demandas', label: `Demandas (${o.demandasPendentes + o.demandasAtrasadas} pend.)` },
          { id: 'fabricacao', label: `Fabricação (${o.fabricacao.emAndamento}/${o.fabricacao.ordens.length})` },
          { id: 'montagem', label: `Montagem (${o.montagem.emAndamento}/${o.montagem.ordens.length})` },
          { id: 'financeiro', label: `Financeiro (${movimentos.length})` },
          { id: 'execucao', label: 'Execução e prazo' },
          { id: 'timeline', label: 'Documentos e comunicação' },
        ]} />
        {aba === 'medicoes' && <MedicoesTab o={o} onErro={toast} onOk={toast} />}
        {aba === 'servicos' && <ServicosTab o={o} onErro={toast} />}
        {aba === 'demandas' && <DemandasTab o={o} onErro={toast} />}
        {aba === 'fabricacao' && <ProducaoTab o={o} tipo="Fabricação" onErro={toast} />}
        {aba === 'montagem' && <ProducaoTab o={o} tipo="Montagem" onErro={toast} />}
        {aba === 'resumo' && (
          <div className="grid cols-2">
            <div>
              <h3>Composição do resultado</h3>
              <dl className="kv">
                <dt>Receita total aprovada</dt><dd><Money v={o.receitaTotal} /></dd>
                <dt>(−) Custo pago</dt><dd><Money v={o.custoPago} /></dd>
                <dt>(−) Comprometido em aberto</dt><dd><Money v={o.comprometidoAberto} /></dd>
                <dt>(−) ETC não comprometido</dt><dd><Money v={o.etcNaoComprometido} /></dd>
                <dt><b>= Margem projetada</b></dt><dd><b><Money v={o.margemProjetada} sign /></b></dd>
                <dt>Orçamento disponível</dt><dd><Money v={o.orcamentoDisponivel} sign /></dd>
                <dt>Backlog (a medir)</dt><dd><Money v={o.backlog} /></dd>
              </dl>
              <h3 style={{ marginTop: 14 }}>Escopo</h3>
              <p className="small">{obra.escopo || '—'}</p>
              <p className="muted small">{obra.observacoes}</p>
            </div>
            <div>
              <h3>Fluxo líquido da obra — 13 semanas ({ds.params.cenario})</h3>
              <Bars valores={f13.fluxoLiquido} rotulos={f13.periodos.map((p) => p.rotulo)} />
              <div className="muted small">Entradas {money(f13.totalEntradas.reduce((a, b) => a + b, 0))} · saídas {money(f13.totalSaidas.reduce((a, b) => a + b, 0))}</div>
            </div>
          </div>
        )}
        {aba === 'financeiro' && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Categoria</th><th>Descrição</th><th>Contraparte</th><th>Competência</th><th>Data caixa</th><th>Líquido</th><th>Realizado</th><th>Status</th><th>Situação</th>{verBancos && <th>Conta</th>}</tr></thead>
              <tbody>
                {movimentos.map((l) => (
                  <tr key={l.id}>
                    <td><Link to={`/lancamentos/${l.id}`}>{l.id}</Link></td>
                    <td>{l.categoria}</td><td>{l.descricao}</td><td>{l.contraparte}</td>
                    <td>{l.competencia.split('-').reverse().join('/')}</td><td>{l.dataCaixa?.split('-').reverse().join('/')}</td>
                    <td><Money v={l.tipo === 'Entrada' ? l.valorLiquidoPrevisto : -l.valorLiquidoPrevisto} sign /></td>
                    <td><Money v={l.status === 'Realizado' ? (l.tipo === 'Entrada' ? l.valorRealizadoTotal : -l.valorRealizadoTotal) : undefined} sign /></td>
                    <td><StatusBadge s={l.status} /></td><td><StatusBadge s={l.situacao} /></td>
                    {verBancos && <td>{l.contaFinanceira}</td>}
                  </tr>
                ))}
                {movimentos.length === 0 && <tr><td colSpan={11} className="empty">Sem lançamentos vinculados.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {aba === 'execucao' && (
          <div className="grid cols-2">
            <div>
              <h3>Execução física</h3>
              <div className="progress"><i style={{ width: `${Math.min(100, o.execucaoFisica * 100)}%` }} /></div>
              <div className="small" style={{ marginTop: 4 }}>{pct(o.execucaoFisica)} físico{o.temServicos && <span className="muted"> (ponderado pelos serviços)</span>} · {pct(o.receitaTotal ? o.medidoFaturado / o.receitaTotal : 0)} medido · {pct(o.eac ? o.custoPago / o.eac : 0)} do EAC pago</div>
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Assinatura</dt><dd>{obra.assinatura?.split('-').reverse().join('/') ?? '—'}</dd>
                <dt>Início</dt><dd>{obra.inicio?.split('-').reverse().join('/') ?? '—'}</dd>
                <dt>Fim contratual</dt><dd>{obra.fimContratual?.split('-').reverse().join('/') ?? '—'}</dd>
                <dt>Responsável</dt><dd>{ds.usuarios.find((u) => u.id === obra.responsavel)?.nome ?? '—'}</dd>
              </dl>
            </div>
            <div>
              <h3>Histórico de execução / ETC</h3>
              <ul className="timeline">
                {ds.auditoria.filter((a) => a.entidade === 'obra' && a.entidadeId === codigo && a.acao === 'atualizar_execucao').map((a) => {
                  const d = a.depois as { execucaoFisica: number; estimativaConcluir: number; medidoFaturado: number };
                  return <li key={a.id}><div>Físico {pct(d.execucaoFisica)} · medido {money(d.medidoFaturado, true)} · ETC {money(d.estimativaConcluir, true)}</div><div className="meta">{a.usuario} · {new Date(a.ts).toLocaleString('pt-BR')} · {a.motivo}</div></li>;
                })}
                {!ds.auditoria.some((a) => a.entidade === 'obra' && a.entidadeId === codigo && a.acao === 'atualizar_execucao') && <li className="muted">Nenhuma atualização registrada com data-base e autor.</li>}
              </ul>
            </div>
          </div>
        )}
        {aba === 'timeline' && <Timeline entidade="obra" entidadeId={codigo} onErro={toast} />}
      </div>

      {editando && <ObraForm obra={obra} onClose={() => setEditando(false)} onErro={toast} />}
      {novoLanc && <LancamentoForm inicial={actions.novoLancamento({ codigoObra: codigo, centroCusto: 'Obra', contraparte: '' })} onClose={() => setNovoLanc(false)} onErro={toast} onOk={(m) => toast(m)} />}
      {exec && (
        <Modal title="Atualizar execução física, medição e ETC" onClose={() => setExec(null)}>
          <div className="form">
            <Field label="Execução física (%)"><NumberInput value={Math.round(exec.execucaoFisica * 10000) / 100} onChange={(v) => setExec({ ...exec, execucaoFisica: v / 100 })} /></Field>
            <Field label="Medido / faturado acumulado"><NumberInput value={exec.medidoFaturado} onChange={(v) => setExec({ ...exec, medidoFaturado: v })} /></Field>
            <Field label="Estimativa a concluir (ETC)" hint="Custo ainda necessário para terminar, contratado ou não"><NumberInput value={exec.estimativaConcluir} onChange={(v) => setExec({ ...exec, estimativaConcluir: v })} /></Field>
            <Field label="Justificativa" req full><textarea rows={2} value={exec.justificativa} onChange={(e) => setExec({ ...exec, justificativa: e.target.value })} /></Field>
          </div>
          <div className="alert info" style={{ marginTop: 12 }}>Novo EAC: <b>{money(o.custoPago + o.comprometidoAberto + Math.max(0, exec.estimativaConcluir - o.comprometidoAberto))}</b> · margem projetada <b>{money(o.receitaTotal - (o.custoPago + o.comprometidoAberto + Math.max(0, exec.estimativaConcluir - o.comprometidoAberto)))}</b></div>
          <div className="foot"><button className="btn" onClick={() => setExec(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.atualizarExecucao(codigo, exec), toast, () => setExec(null))}>Registrar</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
