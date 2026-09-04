import React, { useMemo, useState } from 'react';
import { aging, calcLancamentos } from '../core/engine';
import type { Lancamento } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Kpi, Money, PageHead, StatusBadge, money, useToast } from '../ui/components';
import { navegar } from '../ui/router';
import { LancamentoForm } from './LancamentoForm';

export type ModoLista = 'todos' | 'pagar' | 'receber';

/** Celula de data editavel na grade: salva ao escolher a data; clique nao abre o detalhe. */
function DataCell({ valor, editavel, onChange, className, title }: { valor?: string; editavel: boolean; onChange: (v: string) => void; className?: string; title?: string }) {
  if (!editavel) return <td className={className} title={title}>{valor?.split('-').reverse().join('/')}</td>;
  return (
    <td className={className} title={title} onClick={(e) => e.stopPropagation()}>
      <input
        type="date"
        value={valor ?? ''}
        onChange={(e) => e.target.value && e.target.value !== valor && onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        style={{ padding: '2px 4px', border: '1px solid transparent', borderRadius: 6, background: 'transparent', color: 'inherit', font: 'inherit', width: 130, cursor: 'pointer' }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--primary-2)')}
        onBlur={(e) => (e.target.style.borderColor = 'transparent')}
      />
    </td>
  );
}

export default function Lancamentos({ modo, query }: { modo: ModoLista; query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [novo, setNovo] = useState<Lancamento | null>(null);
  const podeEditar = (l: { status: string; codigoObra: string }) => l.status !== 'Cancelado' && l.status !== 'Realizado' && pode(usuario, 'editar_lancamento', l.codigoObra || undefined);
  const alterar = (id: string, datas: { competencia?: string; vencimento?: string; realizacao?: string }) => {
    try {
      const l = actions.alterarDatas(id, datas);
      toast(l.status === 'Pendente' ? `${id}: data alterada; título reenviado para aprovação.` : `${id}: data alterada.`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const [f, setF] = useState({
    busca: query.get('busca') ?? '', obra: query.get('obra') ?? '', categoria: '', status: query.get('status') ?? '', situacao: query.get('situacao') ?? '', de: '', ate: '', contraparte: '',
  });
  const visiveis = obrasVisiveis(usuario, ds.obras).map((o) => o.codigo);
  const verBancos = pode(usuario, 'ver_bancos');
  const todos = useMemo(() => calcLancamentos(ds), [ds]);
  const lista = todos
    .filter((l) => usuario.obras === '*' || !l.codigoObra || visiveis.includes(l.codigoObra))
    .filter((l) => (usuario.obras === '*' || l.codigoObra) ? true : ['Financeiro', 'Diretoria', 'Administrador', 'Contabilidade', 'Auditoria', 'Compras'].includes(usuario.papel))
    .filter((l) => modo === 'todos' || (modo === 'pagar' ? l.tipo === 'Saída' : l.tipo === 'Entrada'))
    .filter((l) => !f.obra || l.codigoObra === f.obra)
    .filter((l) => !f.categoria || l.categoria === f.categoria)
    .filter((l) => !f.status || l.status === f.status)
    .filter((l) => !f.situacao || l.situacao === f.situacao)
    .filter((l) => !f.contraparte || l.contraparte === f.contraparte)
    .filter((l) => !f.de || (l.dataCaixa ?? '') >= f.de)
    .filter((l) => !f.ate || (l.dataCaixa ?? '') <= f.ate)
    .filter((l) => !f.busca || `${l.id} ${l.descricao} ${l.contraparte} ${l.documento} ${l.categoria}`.toLowerCase().includes(f.busca.toLowerCase()))
    .sort((a, b) => ((a.dataCaixa ?? '') < (b.dataCaixa ?? '') ? -1 : 1));
  const abertos = lista.filter((l) => l.oficial && l.status !== 'Cancelado' && l.status !== 'Realizado');
  const totalAberto = abertos.reduce((a, l) => a + l.saldoAberto, 0);
  const vencido = abertos.filter((l) => l.situacao === 'Atrasado').reduce((a, l) => a + l.saldoAberto, 0);
  const sete = abertos.filter((l) => l.situacao === 'Próximos 7 dias').reduce((a, l) => a + l.saldoAberto, 0);
  const realizado = lista.filter((l) => l.oficial && l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const titulo = modo === 'pagar' ? 'Contas a pagar' : modo === 'receber' ? 'Contas a receber' : 'Lançamentos';
  const ag = modo === 'todos' ? null : aging(lista, modo === 'pagar' ? 'Saída' : 'Entrada');

  const exportarCsv = () => {
    const cab = ['ID', 'Tipo', 'Categoria', 'Grupo', 'Obra', 'Contraparte', 'Documento', 'Descrição', 'Competência', 'Vencimento', 'Data caixa', 'Status', 'Situação', 'Bruto', 'Líquido', 'Realizado', 'Caixa projetado'];
    const rows = lista.map((l) => [l.id, l.tipo, l.categoria, l.grupoFluxo, l.codigoObra, l.contraparte, l.documento, l.descricao, l.competencia, l.vencimento, l.dataCaixa ?? '', l.status, l.situacao, l.valorBruto, l.valorLiquidoPrevisto, l.valorRealizadoTotal, l.valorCaixaProjetado]);
    const csv = [cab, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${titulo.toLowerCase().replace(/ /g, '-')}.csv`;
    a.click();
  };

  return (
    <>
      <PageHead title={titulo} subtitle="Base única de recebimentos e pagamentos previstos ou realizados. Valores positivos; o tipo define o sinal.">
        {pode(usuario, 'exportar') && <button className="btn" onClick={exportarCsv}>Exportar CSV</button>}
        {pode(usuario, 'editar_lancamento') && <button className="btn primary" onClick={() => setNovo(actions.novoLancamento(modo === 'receber' ? { categoria: 'Medições de obras', centroCusto: 'Obra' } : {}))}>+ Novo lançamento</button>}
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Saldo em aberto" value={money(totalAberto)} hint={`${abertos.length} títulos`} />
        <Kpi label="Vencido" value={money(vencido)} tone={vencido > 0 ? 'bad' : 'ok'} />
        <Kpi label="Próximos 7 dias" value={money(sete)} tone={sete > 0 ? 'warn' : undefined} />
        <Kpi label="Realizado (filtro)" value={money(realizado)} />
      </div>
      {ag && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Aging</h2>
          <div className="grid cols-3">
            {ag.map((x) => <div key={x.faixa} className="small"><b>{x.faixa}</b>: {money(x.valor)} <span className="muted">({x.quantidade})</span></div>)}
          </div>
        </div>
      )}
      <div className="filters">
        <label className="field"><span>Buscar</span><input value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} placeholder="ID, descrição, documento" /></label>
        <label className="field"><span>Obra</span><select value={f.obra} onChange={(e) => setF({ ...f, obra: e.target.value })}><option value="">Todas</option>{visiveis.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>Categoria</span><select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">Todas</option>{ds.planoContas.filter((p) => modo === 'todos' || p.tipo === (modo === 'pagar' ? 'Saída' : 'Entrada')).map((p) => <option key={p.categoria}>{p.categoria}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todos</option>{['Rascunho', 'Pendente', 'Aprovado', 'Programado', 'Realizado', 'Cancelado'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="field"><span>Situação</span><select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}><option value="">Todas</option>{['Atrasado', 'Próximos 7 dias', 'A vencer', 'Parcialmente liquidado', 'Realizado', 'Pendente de aprovação', 'Rascunho', 'Cancelado', 'Sem vencimento'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="field"><span>Data caixa de</span><input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label className="field"><span>até</span><input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        <button className="btn sm" onClick={() => setF({ busca: '', obra: '', categoria: '', status: '', situacao: '', de: '', ate: '', contraparte: '' })}>Limpar</button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Categoria</th><th>Obra</th><th>Contraparte</th><th>Descrição</th><th>Competência</th><th>Vencimento</th><th>Data caixa</th><th>Líquido</th><th>Saldo aberto</th><th>Caixa proj.</th><th>Status</th><th>Situação</th>{verBancos && <th>Conc.</th>}</tr></thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.id} className="clickable" onClick={() => navegar(`/lancamentos/${l.id}`)}>
                <td><b>{l.id}</b>{l.registro === 'Exemplo' && <span className="badge muted" style={{ marginLeft: 4 }}>ex</span>}</td>
                <td>{l.categoria}<div className="muted small">{l.grupoFluxo}</div></td>
                <td>{l.codigoObra || <span className="muted">—</span>}</td>
                <td>{l.contraparte}</td>
                <td>{l.descricao}{l.faturamentoDireto && <> <Badge tone="info">direto cliente</Badge></>}<div className="muted small">{l.documento}</div></td>
                <DataCell valor={l.competencia} editavel={podeEditar(l)} onChange={(v) => alterar(l.id, { competencia: v })} />
                <DataCell valor={l.vencimento} editavel={podeEditar(l)} className={l.situacao === 'Atrasado' ? 'neg' : ''} onChange={(v) => alterar(l.id, { vencimento: v })} />
                <DataCell valor={l.dataCaixa} editavel={l.status === 'Realizado' ? pode(usuario, 'liquidar') : podeEditar(l)} title={l.status === 'Realizado' ? 'Data de realização' : 'Segue o vencimento até a liquidação'} onChange={(v) => alterar(l.id, l.status === 'Realizado' ? { realizacao: v } : { vencimento: v })} />
                <td><Money v={l.tipo === 'Entrada' ? l.valorLiquidoPrevisto : -l.valorLiquidoPrevisto} sign /></td>
                <td><Money v={l.saldoAberto} /></td>
                <td><Money v={l.valorCaixaProjetado} sign /></td>
                <td><StatusBadge s={l.status} /></td>
                <td><StatusBadge s={l.situacao} /></td>
                {verBancos && <td title={l.vinculoBancario ? 'Vinculado ao extrato' : ''}>{l.vinculoBancario ? '✓' : ''}</td>}
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={14} className="empty">Nenhum lançamento com esses filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      {novo && <LancamentoForm inicial={novo} onClose={() => setNovo(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
