// Modo campo › Pagamentos (pedido do Augusto em 14/10/2026): no celular, o Administrador filtra as contas a pagar, seleciona e
// paga (uma ou várias), edita valor/data/forma de pagamento e anexa documentos (comprovante pela câmera). Só para quem vê o
// caixa e liquida (hoje: Administrador). Lista e totais em src/core/pagamentosCampo.ts; as ações são as do store.
import { useState } from 'react';
import { FILTROS_PAGAMENTOS_CAMPO, pagamentosCampo, resumoPagamentosCampo, selecaoPagavel, type FiltroPagamentosCampo, type PagamentoCampo } from '../core/pagamentosCampo';
import { resumoPagamento, validarDadosPagamento } from '../core/pagamento';
import type { Lancamento } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Field, Input, Modal, MoedaInput, Select, money } from '../ui/components';
import { CamposPagamento, DadosPagamentoView } from '../ui/Pagamento';
import { DocumentosLancamento } from '../ui/Documentos';
import { AjustePago } from '../ui/AjustePago';

const br = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—');
const CHAVE_FILTRO = 'eiff-control:campo:pagamentos:filtro';

export function CampoPagamentos({ toast }: { toast: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [filtro, setFiltroRaw] = useState<FiltroPagamentosCampo>(() => { try { return (sessionStorage.getItem(CHAVE_FILTRO) as FiltroPagamentosCampo) || 'semana'; } catch { return 'semana'; } });
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [lote, setLote] = useState<{ data: string; conta: string } | null>(null);
  const [pagando, setPagando] = useState(false);
  const setFiltro = (f: FiltroPagamentosCampo) => { setFiltroRaw(f); setSel(new Set()); try { sessionStorage.setItem(CHAVE_FILTRO, f); } catch { /* ignore */ } };
  if (!pode(usuario, 'ver_bancos') || !pode(usuario, 'liquidar')) return <div className="alert info">Pagamentos pelo celular são restritos ao Administrador.</div>;

  const hoje = ds.params.dataBase;
  const r = resumoPagamentosCampo(ds, hoje);
  const itens = pagamentosCampo(ds, filtro, busca, hoje);
  const s = selecaoPagavel(itens, sel);
  const contas = ds.contas.filter((c) => c.ativa).map((c) => c.instituicao);
  const selecionavel = filtro !== 'pagos' && filtro !== 'sem_comprovante' && filtro !== 'aprovacao';
  const alternar = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todos = () => setSel(s.pagaveis.length === itens.filter((p) => p.pagavel).length && s.pagaveis.length > 0 ? new Set() : new Set(itens.filter((p) => p.pagavel).map((p) => p.l.id)));

  const pagarLote = async () => {
    if (!lote) return;
    setPagando(true);
    const falhas: string[] = []; let ok = 0;
    for (const p of s.pagaveis) {
      try { actions.liquidar(p.l.id, { data: lote.data, valor: p.valor, conta: lote.conta, documento: 'Celular: pago' }); ok += 1; }
      catch (e) { falhas.push(`${p.l.id}: ${(e as Error).message}`); }
    }
    setPagando(false); setLote(null); setSel(new Set());
    toast(`${ok} pagamento(s) registrado(s)${falhas.length ? `; ${falhas.length} não: ${falhas.join(' · ')}` : ''}. Anexe os comprovantes em "Sem comprovante".`);
  };

  return (
    <div className="pag-campo">
      <h2>Pagamentos</h2>
      <div className="pag-campo-kpis">
        <button className={`pag-kpi${r.atrasados ? ' ruim' : ''}`} onClick={() => setFiltro('atrasados')}><span>Atrasados</span><b>{money(r.atrasados)}</b><small>{r.contagem.atrasados} título(s)</small></button>
        <button className="pag-kpi" onClick={() => setFiltro('hoje')}><span>Até hoje</span><b>{money(r.ateHoje)}</b><small>{r.contagem.hoje} título(s)</small></button>
        <button className="pag-kpi" onClick={() => setFiltro('semana')}><span>7 dias</span><b>{money(r.semana)}</b><small>{r.contagem.semana} título(s)</small></button>
        <button className="pag-kpi" onClick={() => setFiltro('pagos')}><span>Pagos hoje</span><b>{money(r.pagosHoje.valor)}</b><small>{r.pagosHoje.quantidade} título(s)</small></button>
      </div>

      <div className="chips pag-campo-filtros" role="group" aria-label="Filtrar pagamentos">
        {FILTROS_PAGAMENTOS_CAMPO.map((f) => <button key={f.id} className={`chip sm ${filtro === f.id ? 'on' : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.rotulo} <span className="df-filtro-n">{r.contagem[f.id]}</span></button>)}
      </div>
      <input type="search" value={busca} placeholder="Buscar fornecedor, descrição, obra ou ID" aria-label="Buscar pagamento" onChange={(e) => setBusca(e.target.value)} style={{ width: '100%', margin: '6px 0 10px' }} />

      {selecionavel && itens.some((p) => p.pagavel) && <button className="btn sm" style={{ marginBottom: 8 }} onClick={todos}>{s.pagaveis.length && s.pagaveis.length === itens.filter((p) => p.pagavel).length ? 'Limpar seleção' : 'Selecionar todos'}</button>}
      {!itens.length && <p className="muted small">Nenhum pagamento neste filtro.</p>}
      {itens.map((p) => <Cartao key={p.l.id} p={p} selecionavel={selecionavel} marcado={sel.has(p.l.id)} onMarcar={() => alternar(p.l.id)} onAbrir={() => setAberto(p.l.id)} />)}

      {selecionavel && sel.size > 0 && (
        <div className="pag-campo-barra">
          <span><b>{s.pagaveis.length}</b> a pagar · <b>{money(s.total)}</b>{s.bloqueados.length ? <span className="small muted"> · {s.bloqueados.length} sem liberação</span> : null}</span>
          <button className="btn primary" disabled={!s.pagaveis.length} onClick={() => setLote({ data: hoje, conta: contas[0] ?? '' })}>Pagar selecionados</button>
        </div>
      )}

      {lote && (
        <Modal title={`Pagar ${s.pagaveis.length} título(s)`} onClose={() => setLote(null)}>
          <p className="small" style={{ marginTop: 0 }}>Total <b>{money(s.total)}</b>. Cada título é liquidado pelo valor em aberto.</p>
          <Field label="Data do pagamento" req><Input type="date" value={lote.data} max={hoje} onChange={(e) => setLote({ ...lote, data: e.target.value })} /></Field>
          <Field label="Conta de saída" req><Select value={lote.conta} onChange={(v) => setLote({ ...lote, conta: v })} options={contas} /></Field>
          <div className="foot"><button className="btn" onClick={() => setLote(null)}>Cancelar</button><button className="btn primary" disabled={pagando || !lote.data || !lote.conta} onClick={() => void pagarLote()}>{pagando ? 'Pagando…' : `Confirmar ${money(s.total)}`}</button></div>
        </Modal>
      )}
      {aberto && <Detalhe id={aberto} onClose={() => setAberto(null)} toast={toast} />}
    </div>
  );
}

function Cartao({ p, selecionavel, marcado, onMarcar, onAbrir }: { p: PagamentoCampo; selecionavel: boolean; marcado: boolean; onMarcar: () => void; onAbrir: () => void }) {
  const l = p.l;
  const situacao = l.status === 'Realizado' ? <Badge tone="ok">pago {br(l.realizacao)}</Badge>
    : l.status === 'Rascunho' ? <Badge tone="warn">rascunho</Badge>
    : l.status === 'Pendente' ? <Badge tone="warn">em aprovação</Badge>
    : p.atrasado ? <Badge tone="bad">{p.diasAtraso}d atrasado</Badge>
    : <Badge tone="info">vence {br(p.vencimento)}</Badge>;
  return (
    <div className={`pag-cartao${marcado ? ' marcado' : ''}`}>
      {selecionavel && <input type="checkbox" aria-label={`Selecionar ${l.id}`} checked={marcado} disabled={!p.pagavel} onChange={onMarcar} />}
      <button type="button" className="pag-cartao-corpo" onClick={onAbrir}>
        <span className="pag-cartao-linha"><b>{l.contraparte || l.descricao}</b><b className="mono">{money(p.valor)}</b></span>
        <span className="pag-cartao-linha small muted"><span>{l.descricao}{l.codigoObra ? ` · ${l.codigoObra}` : ''} · {l.id}</span></span>
        <span className="pag-cartao-linha small">{situacao}<span className="muted">{l.formaPagamento ?? 'forma não informada'}{p.documentos ? ` · ${p.documentos} doc.` : ''}{l.status === 'Realizado' && !p.comprovante ? ' · sem comprovante' : ''}</span></span>
      </button>
    </div>
  );
}

function Detalhe({ id, onClose, toast }: { id: string; onClose: () => void; toast: (m: string) => void }) {
  const { ds } = useStore();
  const base = ds.lancamentos.find((x) => x.id === id);
  const item = base ? pagamentosCampo(ds, 'abertos').concat(pagamentosCampo(ds, 'pagos'), pagamentosCampo(ds, 'aprovacao')).find((p) => p.l.id === id) : undefined;
  const contas = ds.contas.filter((c) => c.ativa).map((c) => c.instituicao);
  const [modo, setModo] = useState<'ver' | 'pagar' | 'editar'>('ver');
  const [pag, setPag] = useState(() => ({ data: ds.params.dataBase, valor: item?.valor ?? 0, conta: base && contas.includes(base.contaFinanceira) ? base.contaFinanceira : contas[0] ?? '' }));
  const [ed, setEd] = useState<Lancamento | null>(null);
  const [ajuste, setAjuste] = useState(false);
  if (!base || !item) return null;
  const l = item.l;
  const pagar = () => {
    try { actions.liquidar(id, { data: pag.data, valor: pag.valor, conta: pag.conta, documento: 'Celular: pago' }); toast(`${id} pago. Anexe o comprovante abaixo.`); setModo('ver'); }
    catch (e) { toast((e as Error).message); }
  };
  const salvar = () => {
    if (!ed) return;
    try { const r = actions.salvarLancamento(ed); toast(r.aprovacaoAberta ? `${id} salvo e enviado à aprovação.` : `${id} salvo.`); setEd(null); setModo('ver'); }
    catch (e) { toast((e as Error).message); }
  };
  const errosPag = ed ? validarDadosPagamento(ed.formaPagamento, ed.dadosPagamento) : [];
  const editavel = l.status !== 'Realizado' && l.status !== 'Cancelado';
  return (
    <Modal title={`${l.contraparte || l.descricao} · ${money(item.valor)}`} onClose={onClose}>
      <p className="small" style={{ marginTop: 0 }}>{l.descricao} · {l.id}{l.codigoObra ? ` · ${l.codigoObra}` : ''}<br />Vencimento {br(item.vencimento)} · {l.status}{l.status === 'Realizado' ? ` em ${br(l.realizacao)}` : ''}{item.motivoNaoPagavel && l.status !== 'Realizado' ? ` · ${item.motivoNaoPagavel}` : ''}</p>

      {modo === 'ver' && <>
        <div className="actions" style={{ marginBottom: 10 }}>
          {item.pagavel && <button className="btn primary" onClick={() => { setPag({ ...pag, valor: item.valor }); setModo('pagar'); }}>Pagar {money(item.valor)}</button>}
          {editavel && <button className="btn" onClick={() => { setEd({ ...base }); setModo('editar'); }}>Editar</button>}
          {l.status === 'Realizado' && <button className="btn" disabled={!!l.vinculoBancario} title={l.vinculoBancario ? 'Conciliado com o extrato' : undefined} onClick={() => setAjuste(true)}>Ajustar valor pago</button>}
        </div>
        {ajuste && <AjustePago lancamento={base} tipo={l.tipo} valorPagoAtual={l.valorRealizadoTotal} dataAtual={l.realizacao} onClose={() => setAjuste(false)} aviso={toast} />}
        <h3 className="pag-sub">Dados para pagamento</h3>
        <DadosPagamentoView forma={l.formaPagamento} dados={l.dadosPagamento} />
        <h3 className="pag-sub">Documentos</h3>
        <DocumentosLancamento lancamento={l} aviso={toast} tipoInicial={l.status === 'Realizado' ? 'COMPROVANTE' : 'NOTA_FISCAL'} />
      </>}

      {modo === 'pagar' && <>
        <Field label="Data do pagamento" req><Input type="date" value={pag.data} max={ds.params.dataBase} onChange={(e) => setPag({ ...pag, data: e.target.value })} /></Field>
        <Field label="Valor pago" req hint={pag.valor < item.valor ? 'Menor que o em aberto: fica como pagamento parcial' : undefined}><MoedaInput value={pag.valor} onChange={(v) => setPag({ ...pag, valor: v })} /></Field>
        <Field label="Conta de saída" req><Select value={pag.conta} onChange={(v) => setPag({ ...pag, conta: v })} options={contas} /></Field>
        {l.formaPagamento && <p className="small muted">{resumoPagamento(l.formaPagamento, l.dadosPagamento)}</p>}
        <div className="foot"><button className="btn" onClick={() => setModo('ver')}>Voltar</button><button className="btn primary" disabled={!(pag.valor > 0) || !pag.data || !pag.conta} onClick={pagar}>Confirmar pagamento</button></div>
      </>}

      {modo === 'editar' && ed && <>
        <div className="form">
          <Field label="Valor" req><MoedaInput value={ed.valorBruto} onChange={(v) => setEd({ ...ed, valorBruto: v })} /></Field>
          <Field label="Vencimento" req><Input type="date" value={ed.vencimento} onChange={(e) => setEd({ ...ed, vencimento: e.target.value })} /></Field>
          <Field label="Fornecedor" req><Input value={ed.contraparte} onChange={(e) => setEd({ ...ed, contraparte: e.target.value })} /></Field>
          <Field label="Descrição" req full><Input value={ed.descricao} onChange={(e) => setEd({ ...ed, descricao: e.target.value })} /></Field>
          <CamposPagamento forma={ed.formaPagamento} dados={ed.dadosPagamento} erros={errosPag} onChange={(formaPagamento, dadosPagamento) => setEd({ ...ed, formaPagamento, dadosPagamento: formaPagamento ? dadosPagamento : undefined })} />
        </div>
        <div className="foot"><button className="btn" onClick={() => { setEd(null); setModo('ver'); }}>Voltar</button><button className="btn primary" disabled={errosPag.length > 0 || !(ed.valorBruto > 0)} onClick={salvar}>Salvar</button></div>
      </>}
    </Modal>
  );
}
