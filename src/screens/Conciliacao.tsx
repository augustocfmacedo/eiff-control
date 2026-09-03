import React, { useMemo, useState } from 'react';
import { calcLancamentos, calcTransacoes, sugerirConciliacao } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Kpi, Link, Modal, Money, PageHead, Select, StatusBadge, money, tentar, useToast } from '../ui/components';
import { ImportarOfxModal, LancarTransacaoModal } from './ConciliacaoOfx';

function parseCsv(texto: string) {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: { data: string; historico: string; documento: string; debito: number; credito: number; idExterno?: string }[] = [];
  const num = (s: string) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
  const dt = (s: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : s);
  for (const l of linhas) {
    const c = l.split(/;|\t/).map((x) => x.replace(/^"|"$/g, '').trim());
    if (c.length < 4 || c[0].toLowerCase().startsWith('data')) continue;
    if (c.length >= 5) out.push({ data: dt(c[0]), historico: c[1], documento: c[2], debito: num(c[3]), credito: num(c[4]), idExterno: c[5] });
    else {
      const v = num(c[3]);
      out.push({ data: dt(c[0]), historico: c[1], documento: c[2], debito: v < 0 ? -v : 0, credito: v > 0 ? v : 0 });
    }
  }
  return out;
}

export default function Conciliacao({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [sel, setSel] = useState<string | null>(query.get('id'));
  const [marcados, setMarcados] = useState<string[]>([]);
  const [just, setJust] = useState('');
  const [importar, setImportar] = useState<{ conta: string; texto: string } | null>(null);
  const [ofx, setOfx] = useState(false);
  const [lancar, setLancar] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'Pendente' | 'Divergente' | 'Conciliado'>('todos');
  const lancs = useMemo(() => calcLancamentos(ds), [ds]);
  const trans = useMemo(() => calcTransacoes(ds, lancs), [ds, lancs]);
  if (!pode(usuario, 'ver_bancos')) return <Empty>Extratos e conciliação são restritos a Financeiro, Diretoria, Contabilidade e Auditoria.</Empty>;
  const podeConciliar = pode(usuario, 'conciliar');
  const t = trans.find((x) => x.id === sel);
  const sug = t ? sugerirConciliacao(ds, t, lancs) : [];
  const lista = trans.filter((x) => filtro === 'todos' || x.status === filtro).sort((a, b) => (a.data < b.data ? 1 : -1));
  const taxa = trans.length ? trans.filter((x) => x.status !== 'Pendente').length / trans.length : 1;
  const somaMarcados = marcados.reduce((a, id) => a + (lancs.find((l) => l.id === id)?.valorCaixaProjetado ?? 0), 0);
  const dif = t ? t.movimento - somaMarcados : 0;
  const selecionar = (id: string) => { setSel(id); setMarcados(trans.find((x) => x.id === id)?.lancamentoIds ?? []); setJust(''); };

  return (
    <>
      <PageHead title="Bancos e conciliação" subtitle="Transação bancária é imutável. Sugestão por valor, data, documento e contraparte; divergência fora da tolerância exige justificativa.">
        {podeConciliar && <button className="btn primary" onClick={() => setOfx(true)}>Importar OFX</button>}
        {podeConciliar && <button className="btn" onClick={() => setImportar({ conta: ds.contas[0]?.instituicao ?? 'Caixa', texto: '' })}>Colar extrato (CSV)</button>}
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Transações" value={trans.length} />
        <Kpi label="Pendentes" value={trans.filter((x) => x.status === 'Pendente').length} tone={trans.some((x) => x.status === 'Pendente') ? 'warn' : 'ok'} />
        <Kpi label="Divergentes" value={trans.filter((x) => x.status === 'Divergente').length} tone={trans.some((x) => x.status === 'Divergente') ? 'bad' : 'ok'} />
        <Kpi label="Taxa de conciliação" value={`${Math.round(taxa * 100)}%`} hint="meta ≥ 95% até D+1" tone={taxa >= 0.95 ? 'ok' : 'warn'} />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Contas e conexões</h2>
        <table><thead><tr><th>ID</th><th>Instituição</th><th>Conta</th><th>Status conexão</th><th>Transações</th><th>Última sincronização</th></tr></thead><tbody>
          {ds.contas.map((c) => <tr key={c.id}><td>{c.id}</td><td>{c.instituicao}</td><td>{c.conta}</td><td><Badge tone="muted">manual</Badge> <span className="muted small">Pluggy/Open Finance somente leitura na fase 1</span></td><td className="num">{trans.filter((x) => x.conta === c.instituicao).length}</td><td className="muted small">{trans.filter((x) => x.conta === c.instituicao).map((x) => x.data).sort().pop()?.split('-').reverse().join('/') ?? '—'}</td></tr>)}
        </tbody></table>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <div className="actions" style={{ marginBottom: 8 }}>{(['todos', 'Pendente', 'Divergente', 'Conciliado'] as const).map((f) => <button key={f} className={`btn sm ${filtro === f ? 'primary' : ''}`} onClick={() => setFiltro(f)}>{f}</button>)}</div>
          {lista.length === 0 ? <Empty>Nenhuma transação. Importe um extrato (CSV: data;histórico;documento;débito;crédito).</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>ID</th><th>Data</th><th>Histórico</th><th>Movimento</th><th>Lançamento</th><th>Dif.</th><th>Status</th></tr></thead>
              <tbody>{lista.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => selecionar(x.id)} style={x.id === sel ? { outline: '2px solid var(--primary-2)' } : undefined}>
                  <td>{x.id}</td><td>{x.data.split('-').reverse().join('/')}</td><td>{x.historico}<div className="muted small">{x.documento}</div></td><td><Money v={x.movimento} sign /></td><td className="small">{x.lancamentoIds.join(', ') || '—'}</td><td><Money v={x.lancamentoIds.length ? x.diferenca : undefined} sign /></td><td><StatusBadge s={x.status} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          {!t ? <Empty>Selecione uma transação para ver sugestões.</Empty> : (
            <>
              <h2>{t.id} · {t.data.split('-').reverse().join('/')} · <Money v={t.movimento} sign /></h2>
              <p className="small muted">{t.historico} {t.documento && `· ${t.documento}`} · {t.conta} {t.justificativa && <> · justificativa: {t.justificativa}</>}</p>
              <h3>Sugestões (score e critérios)</h3>
              {sug.length === 0 ? <div className="muted small">Nenhum lançamento compatível. Cadastre o título ou trate como divergência.</div> : (
                <table><tbody>{sug.map((s) => (
                  <tr key={s.lancamento.id}>
                    <td><input type="checkbox" checked={marcados.includes(s.lancamento.id)} disabled={!podeConciliar} onChange={(e) => setMarcados(e.target.checked ? [...marcados, s.lancamento.id] : marcados.filter((i) => i !== s.lancamento.id))} /></td>
                    <td><Link to={`/lancamentos/${s.lancamento.id}`}>{s.lancamento.id}</Link><div className="muted small">{s.lancamento.descricao}</div></td>
                    <td><Money v={s.lancamento.valorCaixaProjetado} sign /></td>
                    <td><Badge tone={s.score >= 75 ? 'ok' : s.score >= 50 ? 'warn' : 'muted'}>{s.score}</Badge><div className="muted small">{s.criterios.join(', ')}</div></td>
                  </tr>
                ))}</tbody></table>
              )}
              <h3 style={{ marginTop: 12 }}>Vincular manualmente</h3>
              <Select value="" onChange={(v) => v && !marcados.includes(v) && setMarcados([...marcados, v])} options={lancs.filter((l) => l.oficial && l.status !== 'Cancelado' && !marcados.includes(l.id)).map((l) => ({ value: l.id, label: `${l.id} · ${l.descricao} · ${money(l.valorCaixaProjetado)}` }))} allowEmpty="+ adicionar lançamento" />
              <div className="small" style={{ marginTop: 8 }}>Selecionados: {marcados.map((m) => <span key={m} className="badge info" style={{ marginRight: 4 }}>{m} <a onClick={() => setMarcados(marcados.filter((i) => i !== m))} style={{ cursor: 'pointer' }}>×</a></span>)}</div>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>Movimento</dt><dd><Money v={t.movimento} sign /></dd>
                <dt>Lançamentos</dt><dd><Money v={somaMarcados} sign /></dd>
                <dt>Diferença</dt><dd className={Math.abs(dif) > ds.params.alcadas.toleranciaConciliacao && marcados.length ? 'neg' : ''}><Money v={marcados.length ? dif : undefined} sign /> {marcados.length > 0 && (Math.abs(dif) <= ds.params.alcadas.toleranciaConciliacao ? <Badge tone="ok">dentro da tolerância</Badge> : <Badge tone="bad">divergente</Badge>)}</dd>
              </dl>
              {marcados.length > 0 && Math.abs(dif) > ds.params.alcadas.toleranciaConciliacao && <Field label="Justificativa da divergência" req full><textarea rows={2} value={just} onChange={(e) => setJust(e.target.value)} /></Field>}
              {podeConciliar && (
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn primary" disabled={marcados.length === 0} onClick={() => tentar(() => actions.conciliar(t.id, marcados, just), toast, () => toast('Conciliação registrada.'))}>Conciliar</button>
                  {t.lancamentoIds.length === 0 && <button className="btn" onClick={() => setLancar(t.id)} title="Cria o lançamento realizado e conciliado a partir deste movimento">Lançar a partir da transação</button>}
                  {t.lancamentoIds.length > 0 && <button className="btn" onClick={() => tentar(() => actions.conciliar(t.id, []), toast, () => { setMarcados([]); toast('Vínculo removido.'); })}>Desfazer vínculo</button>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {ofx && <ImportarOfxModal onClose={() => setOfx(false)} onOk={toast} onErro={toast} />}
      {lancar && trans.find((x) => x.id === lancar) && <LancarTransacaoModal t={trans.find((x) => x.id === lancar)!} onClose={() => setLancar(null)} onOk={(m) => { toast(m); setMarcados([]); }} onErro={toast} />}
      {importar && (
        <Modal title="Importar extrato bancário" onClose={() => setImportar(null)}>
          <p className="small muted">Cole as linhas do extrato no formato <code>data;histórico;documento;débito;crédito</code> (ou <code>data;histórico;documento;valor</code> com sinal). Linhas repetidas são ignoradas (deduplicação).</p>
          <div className="form">
            <Field label="Conta"><Select value={importar.conta} onChange={(v) => setImportar({ ...importar, conta: v })} options={ds.contas.filter((c) => c.ativa).map((c) => c.instituicao)} /></Field>
            <Field label="Linhas" full><textarea rows={8} value={importar.texto} onChange={(e) => setImportar({ ...importar, texto: e.target.value })} placeholder={'10/09/2026;PIX RECEBIDO INVEST MARKET;NF 47;0;150076,25\n07/09/2026;FOLHA SETEMBRO;FOLHA-2026-09;63220,04;0'} /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setImportar(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.importarTransacoes(importar.conta, parseCsv(importar.texto)); toast(`${r.importadas} importada(s), ${r.duplicadas} duplicada(s) ignorada(s).`); }, toast, () => setImportar(null))}>Importar</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
