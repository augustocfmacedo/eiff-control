import React, { useState } from 'react';
import { carteiraObras } from '../core/engine';
import { resumoProducao } from '../core/obras';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Kpi, Link, Money, PageHead, StatusBadge, Tabs, money, pct, tentar, useToast } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

export default function CentralObras() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'carteira' | 'demandas' | 'fabricacao' | 'montagem'>('carteira');
  const visiveis = new Set(obrasVisiveis(usuario, ds.obras).map((o) => o.codigo));
  const carteira = carteiraObras(ds).filter((o) => visiveis.has(o.obra.codigo) && o.ativa);
  const servicos = carteira.flatMap((o) => o.servicos.map((s) => ({ ...s, obra: o.obra })));
  const demandas = carteira.flatMap((o) => o.demandas.map((dm) => ({ ...dm, obra: o.obra })));
  const fab = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Fabricação', ds.params.dataBase);
  const mon = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Montagem', ds.params.dataBase);
  const nome = (id: string) => ds.usuarios.find((u) => u.id === id)?.nome ?? id;
  const minhasDemandas = demandas.filter((dm) => dm.responsavel === usuario.id && dm.status !== 'Concluída');

  return (
    <>
      <PageHead title="Central de obras" subtitle="Serviços, prazos, orçamento × custo, check-lists e linhas de fabricação e montagem de todas as obras, ligados ao caixa e ao resultado." />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Obras ativas" value={carteira.length} hint={`${servicos.length} serviços`} to="/obras" />
        <Kpi label="Serviços atrasados / em risco" value={`${servicos.filter((s) => s.situacaoPrazo === 'Atrasado').length} / ${servicos.filter((s) => s.situacaoPrazo === 'Em risco').length}`} tone={servicos.some((s) => s.situacaoPrazo === 'Atrasado') ? 'bad' : servicos.some((s) => s.situacaoPrazo === 'Em risco') ? 'warn' : 'ok'} />
        <Kpi label="Demandas pendentes no período" value={demandas.filter((x) => x.status !== 'Concluída').length} hint={`${demandas.filter((x) => x.status === 'Atrasada').length} atrasada(s) · ${minhasDemandas.length} minha(s)`} tone={demandas.some((x) => x.status === 'Atrasada') ? 'bad' : demandas.some((x) => x.status === 'Pendente') ? 'warn' : 'ok'} />
        <Kpi label="Ordens em andamento" value={fab.emAndamento + mon.emAndamento} hint={`${fab.atrasadas + mon.atrasadas} atrasada(s) · fabricação ${fab.ordens.length} · montagem ${mon.ordens.length}`} tone={fab.atrasadas + mon.atrasadas ? 'bad' : undefined} />
      </div>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'carteira', label: 'Carteira e serviços' }, { id: 'demandas', label: `Demandas do período (${demandas.filter((x) => x.status !== 'Concluída').length})` }, { id: 'fabricacao', label: `Linha de fabricação (${fab.ordens.length})` }, { id: 'montagem', label: `Linha de montagem (${mon.ordens.length})` }]} />

      {aba === 'carteira' && (
        <>
          <div className="card table-wrap">
            <h2>Obras</h2>
            <table>
              <thead><tr><th>Obra</th><th>Status</th><th>Prazo</th><th>Físico</th><th>Receita</th><th>Custo orçado</th><th>Comprometido</th><th>Pago</th><th>EAC</th><th>Margem proj.</th><th>Serviços</th><th>Demandas</th><th>Produção</th></tr></thead>
              <tbody>
                {carteira.map((o) => (
                  <tr key={o.obra.codigo}>
                    <td><Link to={`/obras/${o.obra.codigo}`}><b>{o.obra.codigo}</b></Link><div className="muted small">{o.obra.nome}</div></td>
                    <td><StatusBadge s={o.obra.status} /></td>
                    <td className={o.diasParaPrazo !== undefined && o.diasParaPrazo < 0 ? 'neg' : ''}>{d(o.obra.fimContratual)}{o.diasParaPrazo !== undefined && <div className="small">{o.diasParaPrazo} d</div>}</td>
                    <td><div className="progress" style={{ width: 70 }}><i style={{ width: `${o.execucaoFisica * 100}%` }} /></div><span className="small">{pct(o.execucaoFisica)}</span></td>
                    <td><Money v={o.receitaTotal} compact /></td>
                    <td><Money v={o.custoOrcado} compact /></td>
                    <td><Money v={o.custoComprometido} compact /></td>
                    <td><Money v={o.custoPago} compact /></td>
                    <td><Money v={o.eac} compact /></td>
                    <td className={`num ${o.margemProjetada < 0 ? 'neg' : ''}`}>{money(o.margemProjetada, true)}<div className="muted small">{pct(o.pctMargemProjetada)}</div></td>
                    <td className="small">{o.servicos.length} · <span className={o.servicosAtrasados ? 'neg' : ''}>{o.servicosAtrasados} atras.</span> · {o.servicosEmRisco} risco</td>
                    <td className="small">{o.demandasPendentes} pend. · <span className={o.demandasAtrasadas ? 'neg' : ''}>{o.demandasAtrasadas} atras.</span></td>
                    <td className="small">fab {o.fabricacao.emAndamento}/{o.fabricacao.ordens.length} · mont {o.montagem.emAndamento}/{o.montagem.ordens.length}</td>
                  </tr>
                ))}
                {carteira.length === 0 && <tr><td colSpan={13} className="empty">Nenhuma obra ativa no seu escopo.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card table-wrap">
            <h2>Serviços por prazo</h2>
            {servicos.length === 0 ? <Empty>Nenhum serviço cadastrado. Abra uma obra e cadastre os serviços na aba Serviços.</Empty> : (
              <table>
                <thead><tr><th>Obra</th><th>Serviço</th><th>Etapa</th><th>Fim previsto</th><th>Situação</th><th>Físico</th><th>Orçado</th><th>EAC</th><th>Desvio</th><th>Responsável</th></tr></thead>
                <tbody>
                  {[...servicos].sort((a, b) => ((a.fimPrevisto ?? '9999') < (b.fimPrevisto ?? '9999') ? -1 : 1)).map((s) => (
                    <tr key={s.id}>
                      <td><Link to={`/obras/${s.codigoObra}`}>{s.codigoObra}</Link></td>
                      <td><b>{s.codigo}</b> {s.nome}</td>
                      <td>{s.etapa}</td>
                      <td className={s.diasParaFim !== undefined && s.diasParaFim < 0 && s.status !== 'Concluído' ? 'neg' : ''}>{d(s.fimPrevisto)}</td>
                      <td><Badge tone={s.situacaoPrazo === 'Atrasado' ? 'bad' : s.situacaoPrazo === 'Em risco' ? 'warn' : s.situacaoPrazo === 'Concluído' || s.situacaoPrazo === 'No prazo' ? 'ok' : 'muted'}>{s.situacaoPrazo}</Badge></td>
                      <td className="num">{pct(s.pctExecucao)}</td>
                      <td><Money v={s.custoOrcado} compact /></td>
                      <td><Money v={s.eac} compact /></td>
                      <td><Money v={s.desvioOrcamento} compact sign /></td>
                      <td className="small">{s.responsavel ? nome(s.responsavel) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {aba === 'demandas' && (
        <div className="card">
          {demandas.length === 0 ? <Empty>Sem demandas cadastradas. Abra uma obra › aba Demandas › "Criar check-list padrão".</Empty> : (
            <table>
              <thead><tr><th></th><th>Obra</th><th>Demanda</th><th>Periodicidade</th><th>Responsável</th><th>Prazo do período</th><th>Status</th></tr></thead>
              <tbody>
                {[...demandas].sort((a, b) => (a.status === b.status ? 0 : a.status === 'Atrasada' ? -1 : b.status === 'Atrasada' ? 1 : a.status === 'Pendente' ? -1 : 1)).map((dm) => (
                  <tr key={dm.id}>
                    <td><input type="checkbox" checked={dm.concluidaNoPeriodo} disabled={!pode(usuario, 'comentar', dm.codigoObra)} onChange={(e) => tentar(() => actions.concluirDemanda(dm.id, e.target.checked), toast)} /></td>
                    <td><Link to={`/obras/${dm.codigoObra}`}>{dm.codigoObra}</Link></td>
                    <td style={dm.concluidaNoPeriodo ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{dm.titulo}</td>
                    <td>{dm.periodicidade}</td>
                    <td className="small">{nome(dm.responsavel)}</td>
                    <td className="small">{d(dm.prazoPeriodo)}</td>
                    <td><Badge tone={dm.status === 'Concluída' ? 'ok' : dm.status === 'Atrasada' ? 'bad' : 'warn'}>{dm.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(aba === 'fabricacao' || aba === 'montagem') && (() => {
        const r = aba === 'fabricacao' ? fab : mon;
        return (
          <div className="card table-wrap">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${r.porEtapa.length}, minmax(180px, 1fr))`, gap: 10, minWidth: r.porEtapa.length * 190 }}>
              {r.porEtapa.map((col) => (
                <div key={col.nome} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 8, border: '1px solid var(--border)' }}>
                  <h3 style={{ marginBottom: 6 }}>{col.nome} <span className="muted">({col.ordens.length})</span></h3>
                  {col.ordens.map((o) => (
                    <div key={o.id} className="card" style={{ padding: 8, marginBottom: 8, borderLeft: `3px solid ${o.atrasada ? 'var(--bad)' : 'var(--primary-2)'}` }}>
                      <div className="small"><Link to={`/obras/${o.codigoObra}`}>{o.codigoObra}</Link> · <b>{o.codigo}</b></div>
                      <div className="small">{o.descricao} · {o.quantidade} {o.unidade}</div>
                      <div className="muted small">{o.dataNecessidade ? d(o.dataNecessidade) : 'sem data'} · {o.prioridade}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {r.ordens.length === 0 && <Empty>Nenhuma ordem. Abra uma obra e crie ordens na aba {aba === 'fabricacao' ? 'Fabricação' : 'Montagem'}.</Empty>}
          </div>
        );
      })()}
      {el}
    </>
  );
}
