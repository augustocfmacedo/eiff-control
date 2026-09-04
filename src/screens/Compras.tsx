import React, { useState } from 'react';
import { calcPedido, comparativoOrcadoComprado, resumoCompras, type PedidoCalc } from '../core/compras';
import type { ItemPedido, PedidoCompra } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, Kpi, Link, Modal, Money, NumberInput, PageHead, Select, Tabs, money, pct, tentar, useToast, type Tone } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const n2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const toneStatus = (s: PedidoCompra['status']): Tone => (({ Rascunho: 'muted', Emitido: 'info', 'Recebido parcial': 'warn', Recebido: 'ok', Cancelado: 'bad' }) as Record<PedidoCompra['status'], Tone>)[s];
const normaliza = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const casa = (texto: string, busca: string) => { const t = normaliza(texto); return normaliza(busca).split(/\s+/).filter(Boolean).every((p) => t.includes(p)); };

// ---------------------------------------------------------------------------
// Seletor de insumo do catalogo
// ---------------------------------------------------------------------------
function SeletorInsumo({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const { ds } = useStore();
  const [busca, setBusca] = useState('');
  const lista = ds.insumos.filter((i) => i.ativo && (!busca || casa(`${i.codigo} ${i.descricao}`, busca))).slice(0, 50);
  return (
    <Modal title="Escolher insumo do catálogo" onClose={onClose} wide>
      <Input autoFocus placeholder="Buscar por código ou descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto', marginTop: 10 }}>
        <table>
          <thead><tr><th>Código</th><th>Descrição</th><th>Unid.</th><th>Origem</th><th className="num">Preço</th><th /></tr></thead>
          <tbody>
            {lista.map((i) => <tr key={i.id}><td>{i.codigo}</td><td>{i.descricao}</td><td>{i.unidade}</td><td className="small">{i.origem}</td><td className="num">{n2(i.preco)}</td><td><button className="btn sm primary" onClick={() => onPick(i.id)}>Usar</button></td></tr>)}
            {!lista.length && <tr><td colSpan={6} className="empty">Nada encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Formulario do pedido
// ---------------------------------------------------------------------------
function PedidoForm({ pedido, onClose, onErro, onOk }: { pedido: PedidoCompra; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [p, setP] = useState<PedidoCompra>(pedido);
  const [pick, setPick] = useState<number | null>(null);
  const salvo = ds.pedidos.some((x) => x.id === pedido.id);
  const rascunho = p.status === 'Rascunho';
  const up = (x: Partial<PedidoCompra>) => setP({ ...p, ...x });
  const setItem = (idx: number, x: Partial<ItemPedido>) => up({ itens: p.itens.map((it, i) => (i === idx ? { ...it, ...x } : it)) });
  const addItem = () => up({ itens: [...p.itens, { id: `PI-${Date.now().toString(36)}-${p.itens.length + 1}`, descricao: '', unidade: 'un', quantidade: 1, precoUnitario: 0, quantidadeRecebida: 0 }] });
  const calc = calcPedido(p, ds, ds.params.dataBase);
  const categorias = ds.planoContas.filter((c) => c.ativa && c.tipo === 'Saída').map((c) => c.categoria);
  const salvar = (emitir: boolean) => tentar(() => {
    const s = actions.salvarPedido(p);
    if (emitir) {
      const r = actions.emitirPedido(s.id);
      onOk(r.aprovacaoAberta ? `Pedido ${s.codigo} emitido; lançamento ${r.lancamento.id} aguarda aprovação por alçada.` : `Pedido ${s.codigo} emitido; lançamento ${r.lancamento.id} programado para ${d(r.lancamento.vencimento)}.`);
    } else onOk(`Pedido ${s.codigo} salvo.`);
  }, onErro, onClose);
  return (
    <Modal title={salvo ? `Pedido ${p.codigo}` : 'Novo pedido de compra'} onClose={onClose} wide>
      <div className="form">
        <Field label="Obra" req><Select value={p.codigoObra} onChange={(v) => up({ codigoObra: v, servicoId: undefined })} options={obrasVisiveis(usuario, ds.obras).map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— escolha —" disabled={!rascunho} /></Field>
        <Field label="Serviço da obra" hint="Liga o comprometido ao orçamento do serviço"><Select value={p.servicoId ?? ''} onChange={(v) => { const s = ds.servicos.find((x) => x.id === v); up({ servicoId: v || undefined, ...(s?.categoriaPadrao ? { categoria: s.categoriaPadrao } : {}) }); }} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === p.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="— sem serviço —" disabled={!rascunho} /></Field>
        <Field label="Fornecedor" req><Input value={p.fornecedor} onChange={(e) => up({ fornecedor: e.target.value })} disabled={!rascunho} /></Field>
        <Field label="Documento" hint="Cotação, proposta ou NF"><Input value={p.documento ?? ''} onChange={(e) => up({ documento: e.target.value || undefined })} /></Field>
        <Field label="Data do pedido" req><Input type="date" value={p.data} onChange={(e) => up({ data: e.target.value })} disabled={!rascunho} /></Field>
        <Field label="Previsão de entrega"><Input type="date" value={p.previsaoEntrega ?? ''} onChange={(e) => up({ previsaoEntrega: e.target.value || undefined })} /></Field>
        <Field label="Prazo de pagamento (dias)" hint="Vencimento do lançamento = data + prazo"><NumberInput value={p.prazoPagamentoDias} onChange={(v) => up({ prazoPagamentoDias: v })} disabled={!rascunho} /></Field>
        <Field label="Categoria do custo" req><Select value={p.categoria} onChange={(v) => up({ categoria: v })} options={categorias} disabled={!rascunho} /></Field>
        <Field label="Faturamento direto" hint="Cliente paga o fornecedor: abate o contrato global, fora do caixa da EIFF"><label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 34 }}><input type="checkbox" checked={p.faturamentoDireto} onChange={(e) => up({ faturamentoDireto: e.target.checked })} disabled={!rascunho} /> Compra paga diretamente pelo cliente</label></Field>
        <Field label="Observações" full><Input value={p.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <h3 style={{ marginTop: 14 }}>Itens</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Insumo do catálogo</th><th style={{ minWidth: 220 }}>Descrição</th><th>Unid.</th><th className="num">Quantidade</th><th className="num">Preço unit.</th><th className="num">Catálogo</th><th className="num">Total</th>{!rascunho && <th className="num">Recebido</th>}<th /></tr></thead>
          <tbody>
            {calc.itens.map((it, idx) => (
              <tr key={it.id}>
                <td className="small">{it.insumo ? <><b>{it.insumo.codigo}</b> <span className="muted">{it.insumo.origem}</span></> : <span className="muted">livre</span>}{rascunho && <div className="actions" style={{ marginTop: 4 }}><button className="btn sm" onClick={() => setPick(idx)}>{it.insumo ? 'Trocar' : 'Vincular'}</button>{it.insumoId && <button className="btn sm" onClick={() => setItem(idx, { insumoId: undefined })}>Soltar</button>}</div>}</td>
                <td><input value={it.descricao} onChange={(e) => setItem(idx, { descricao: e.target.value })} disabled={!rascunho} style={{ width: '100%' }} /></td>
                <td><input value={it.unidade} onChange={(e) => setItem(idx, { unidade: e.target.value })} disabled={!rascunho} style={{ width: 55 }} /></td>
                <td className="num"><input type="number" step="0.0001" value={it.quantidade} onChange={(e) => setItem(idx, { quantidade: Number(e.target.value) })} disabled={!rascunho} style={{ width: 100, textAlign: 'right' }} /></td>
                <td className="num"><input type="number" step="0.0001" value={it.precoUnitario} onChange={(e) => setItem(idx, { precoUnitario: Number(e.target.value) })} disabled={!rascunho} style={{ width: 100, textAlign: 'right' }} /></td>
                <td className="num small">{it.precoCatalogo !== undefined ? <>{n2(it.precoCatalogo)}<div className={it.desvioPreco! > 0.05 ? 'neg' : 'muted'}>{it.desvioPreco! >= 0 ? '+' : ''}{pct(it.desvioPreco!)}</div></> : '—'}</td>
                <td className="num"><b>{money(it.total)}</b></td>
                {!rascunho && <td className="num">{n4(it.quantidadeRecebida)} / {n4(it.quantidade)}</td>}
                <td>{rascunho && <button className="btn sm" onClick={() => up({ itens: p.itens.filter((_, i) => i !== idx) })}>✕</button>}</td>
              </tr>
            ))}
            {!calc.itens.length && <tr><td colSpan={9} className="empty">Sem itens. Adicione os materiais ou serviços comprados; vincule ao catálogo para atualizar preços e comparar com o orçamento.</td></tr>}
            <tr><td colSpan={6}><b>Total do pedido</b></td><td className="num"><b>{money(calc.total)}</b></td><td colSpan={2} /></tr>
          </tbody>
        </table>
      </div>
      {rascunho && <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={addItem}>Adicionar item</button></div>}
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn" onClick={() => salvar(false)}>Salvar</button>
        {rascunho && <button className="btn primary" onClick={() => salvar(true)} title="Gera o lançamento previsto e passa pelas alçadas">Salvar e emitir</button>}
      </div>
      {pick !== null && <SeletorInsumo onClose={() => setPick(null)} onPick={(id) => { const i = ds.insumos.find((x) => x.id === id)!; setItem(pick, { insumoId: id, descricao: p.itens[pick].descricao || i.descricao, unidade: i.unidade, precoUnitario: p.itens[pick].precoUnitario || i.preco }); setPick(null); }} />}
    </Modal>
  );
}

function ReceberForm({ pedido, onClose, onErro, onOk }: { pedido: PedidoCalc; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [data, setData] = useState(ds.params.dataBase);
  const [atualizar, setAtualizar] = useState(true);
  const [q, setQ] = useState<Record<string, number>>(Object.fromEntries(pedido.itens.map((it) => [it.id, it.saldoReceber])));
  return (
    <Modal title={`Receber pedido ${pedido.codigo} · ${pedido.fornecedor}`} onClose={onClose}>
      <div className="form">
        <Field label="Data do recebimento" req><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Preços do catálogo" hint="Grava o preço pago como preço vigente dos insumos vinculados"><label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 34 }}><input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} /> Atualizar preços dos insumos</label></Field>
      </div>
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>Item</th><th className="num">Pedido</th><th className="num">Já recebido</th><th className="num">Receber agora</th></tr></thead>
        <tbody>{pedido.itens.map((it) => <tr key={it.id}><td>{it.descricao}</td><td className="num">{n4(it.quantidade)} {it.unidade}</td><td className="num">{n4(it.quantidadeRecebida)}</td><td className="num"><input type="number" step="0.0001" min={0} value={q[it.id] ?? 0} onChange={(e) => setQ({ ...q, [it.id]: Number(e.target.value) })} style={{ width: 110, textAlign: 'right' }} /></td></tr>)}</tbody>
      </table>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.receberPedido(pedido.id, { data, quantidades: q, atualizarPrecos: atualizar }); onOk(`Pedido ${pedido.codigo}: ${r.pedido.status.toLowerCase()}${r.precosAtualizados ? ` · ${r.precosAtualizados} preço(s) atualizado(s) no catálogo` : ''}.`); }, onErro, onClose)}>Confirmar recebimento</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function Compras({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'pedidos' | 'comparativo'>('pedidos');
  const obras = obrasVisiveis(usuario, ds.obras);
  const [obra, setObra] = useState(query.get('obra') ?? (obras.length === 1 ? obras[0].codigo : ''));
  const [edit, setEdit] = useState<PedidoCompra | null>(null);
  const [receber, setReceber] = useState<PedidoCalc | null>(null);
  const [status, setStatus] = useState('');
  const r = resumoCompras(ds, obra || undefined);
  const lista = r.pedidos.filter((p) => !status || p.status === status).sort((a, b) => (a.data < b.data ? 1 : -1));
  const podeComprar = pode(usuario, 'comprar', obra || undefined);
  const comp = obra ? comparativoOrcadoComprado(ds, obra) : null;
  const cancelar = (p: PedidoCalc) => { const motivo = window.prompt(`Motivo do cancelamento do pedido ${p.codigo}:`); if (motivo) tentar(() => actions.cancelarPedido(p.id, motivo), toast, () => toast(`Pedido ${p.codigo} cancelado.`)); };
  return (
    <>
      <PageHead title="Compras e pedidos" subtitle="Pedidos de compra ligados à obra, ao serviço e ao catálogo. Emitir gera o comprometido na base financeira; receber atualiza os preços; o comparativo confronta orçado × comprado por insumo.">
        <Select value={obra} onChange={setObra} options={obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="Todas as obras" />
        {podeComprar && <button className="btn primary" onClick={() => setEdit(actions.novoPedido(obra))}>+ Novo pedido</button>}
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Pedidos emitidos" value={money(r.emitido)} hint={`${r.pedidos.filter((p) => p.ativo).length} pedido(s) · ${r.rascunhos} rascunho(s)`} />
        <Kpi label="Recebido" value={money(r.recebido)} hint={`a receber ${money(r.aReceber, true)} · ${r.atrasados} atrasado(s)`} tone={r.atrasados ? 'warn' : undefined} />
        <Kpi label="Faturamento direto (cliente)" value={money(r.direto)} hint="pedidos pagos pelo cliente ao fornecedor" />
        <Kpi label="Aguardando aprovação" value={r.aguardandoAprovacao} hint="lançamentos do pedido pendentes por alçada" tone={r.aguardandoAprovacao ? 'warn' : undefined} to="/aprovacoes" />
      </div>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'pedidos', label: `Pedidos (${r.pedidos.length})` }, { id: 'comparativo', label: 'Orçado × comprado por insumo' }]} />
      {aba === 'pedidos' && (
        <div className="card table-wrap">
          <div className="actions" style={{ marginBottom: 10 }}>
            <Select value={status} onChange={setStatus} options={['Rascunho', 'Emitido', 'Recebido parcial', 'Recebido', 'Cancelado']} allowEmpty="Todos os status" />
            <span className="muted small">{lista.length} pedido(s)</span>
          </div>
          {!lista.length ? <Empty>Nenhum pedido. Crie o primeiro com "+ Novo pedido": vincule obra, serviço e insumos do catálogo.</Empty> : (
            <table>
              <thead><tr><th>Pedido</th><th>Obra / serviço</th><th>Fornecedor</th><th>Data</th><th>Entrega</th><th>Status</th><th className="num">Total</th><th className="num">Recebido</th><th>Lançamento</th><th /></tr></thead>
              <tbody>
                {lista.map((p) => {
                  const sv = p.servicoId ? ds.servicos.find((s) => s.id === p.servicoId) : undefined;
                  return (
                    <tr key={p.id}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setEdit(p); }}><b>{p.codigo}</b></a>{p.faturamentoDireto && <> <Badge tone="info">direto cliente</Badge></>}<div className="muted small">{p.itens.length} item(ns) · {p.documento ?? ''}</div></td>
                      <td className="small"><Link to={`/obras/${p.codigoObra}`}>{p.codigoObra}</Link>{sv && <div className="muted">{sv.codigo} {sv.nome.slice(0, 40)}</div>}</td>
                      <td>{p.fornecedor}</td><td className="small">{d(p.data)}</td>
                      <td className={`small ${p.atrasado ? 'neg' : ''}`}>{d(p.previsaoEntrega)}{p.atrasado && <div>atrasado</div>}</td>
                      <td><Badge tone={toneStatus(p.status)}>{p.status}</Badge></td>
                      <td className="num"><Money v={p.total} /></td>
                      <td className="num">{pct(p.pctRecebido)}</td>
                      <td className="small">{p.lancamento ? <Link to={`/lancamentos/${p.lancamento.id}`}>{p.lancamento.id} · {p.lancamento.status}</Link> : '—'}</td>
                      <td className="actions">
                        {podeComprar && p.status === 'Rascunho' && <button className="btn sm primary" onClick={() => tentar(() => { const x = actions.emitirPedido(p.id); toast(x.aprovacaoAberta ? `Emitido; ${x.lancamento.id} aguarda aprovação.` : `Emitido; ${x.lancamento.id} programado.`); }, toast)}>Emitir</button>}
                        {podeComprar && (p.status === 'Emitido' || p.status === 'Recebido parcial') && <button className="btn sm" onClick={() => setReceber(p)}>Receber</button>}
                        {podeComprar && p.status !== 'Cancelado' && p.status !== 'Recebido' && <button className="btn sm" onClick={() => cancelar(p)}>Cancelar</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {aba === 'comparativo' && (
        !comp ? <Empty>Escolha uma obra para comparar o orçamento executivo com as compras.</Empty> : (
          <>
            <div className="grid cols-4" style={{ marginBottom: 16 }}>
              <Kpi label="Insumos orçados" value={money(comp.orcadoValor)} hint={`${comp.linhas.filter((l) => l.orcadoQtd > 0).length} insumo(s) na explosão do orçamento contratado`} />
              <Kpi label="Comprado" value={money(comp.compradoValor)} hint={`${pct(comp.pctComprado)} do orçado`} />
              <Kpi label="Fora do orçamento" value={money(comp.linhas.filter((l) => !l.orcadoQtd).reduce((a, l) => a + l.compradoValor, 0) + comp.compradoForaOrcamento)} hint={`itens livres ${money(comp.compradoForaOrcamento, true)}`} tone={comp.compradoForaOrcamento > 0 ? 'warn' : undefined} />
              <Kpi label="Desvio acima do ritmo orçado" value={money(comp.linhas.reduce((a, l) => a + Math.max(0, l.desvioValor), 0))} hint="comprado − orçado × % comprado, só desvios positivos" tone={comp.linhas.some((l) => l.desvioValor > 1000) ? 'warn' : undefined} />
            </div>
            <div className="card table-wrap">
              {!comp.linhas.length ? <Empty>Sem orçamento contratado com composições nesta obra.</Empty> : (
                <table>
                  <thead><tr><th>Classe</th><th>Código</th><th>Insumo</th><th>Unid.</th><th className="num">Orçado qtd</th><th className="num">Preço orçado</th><th className="num">Orçado</th><th className="num">Comprado qtd</th><th className="num">Preço médio</th><th className="num">Comprado</th><th className="num">% comprado</th><th className="num">Desvio preço</th><th className="num">Desvio valor</th></tr></thead>
                  <tbody>
                    {comp.linhas.slice(0, 300).map((l) => (
                      <tr key={l.insumoId} style={l.desvioValor > 0 ? { background: 'rgba(245, 158, 11, 0.06)' } : undefined}>
                        <td>{l.classe ? <Badge tone={l.classe === 'A' ? 'bad' : l.classe === 'B' ? 'warn' : 'muted'}>{l.classe}</Badge> : <Badge tone="info">extra</Badge>}</td>
                        <td>{l.codigo}</td><td>{l.descricao}{l.tipo && <span className="muted small"> · {l.tipo}</span>}</td><td>{l.unidade}</td>
                        <td className="num">{n4(l.orcadoQtd)}</td><td className="num">{n2(l.orcadoPreco)}</td><td className="num">{money(l.orcadoValor, true)}</td>
                        <td className="num">{n4(l.compradoQtd)}</td><td className="num">{l.compradoQtd ? n2(l.precoMedio) : '—'}</td><td className="num">{money(l.compradoValor, true)}</td>
                        <td className="num">{l.orcadoQtd ? pct(l.pctComprado) : '—'}</td>
                        <td className={`num ${l.desvioPreco > 0.05 ? 'neg' : ''}`}>{l.compradoQtd && l.orcadoQtd ? `${l.desvioPreco >= 0 ? '+' : ''}${pct(l.desvioPreco)}` : '—'}</td>
                        <td className={`num ${l.desvioValor > 0 ? 'neg' : ''}`}>{l.compradoValor ? money(l.desvioValor, true) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )
      )}
      {edit && <PedidoForm pedido={edit} onClose={() => setEdit(null)} onErro={toast} onOk={toast} />}
      {receber && <ReceberForm pedido={receber} onClose={() => setReceber(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
