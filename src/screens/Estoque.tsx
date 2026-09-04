import React, { useState } from 'react';
import { FAMILIAS_ESTOQUE, LOCAIS_ESTOQUE, consumoAco, corridas, efeitoMovimento, exigeCorrida, posicaoEstoque, rastrearConjunto, rastrearCorrida, type ItemEstoqueCalc } from '../core/estoque';
import type { FamiliaEstoque, ItemEstoque, LocalEstoque, MovimentoEstoque, TipoMovimento } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, KpiHero, KpiStrip, Modal, NumberInput, PageHead, ProgressRow, Select, Tabs, money, tentar, useToast, type Tone } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const kg = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
const t = (v: number) => `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`;
const rkg = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} R$/kg`;
const TONE_TIPO: Record<TipoMovimento, Tone> = { Entrada: 'ok', Consumo: 'info', Sobra: 'warn', Ajuste: 'muted', Estorno: 'bad' };

// ---------------------------------------------------------------------------
// Cadastro do item
// ---------------------------------------------------------------------------
function ItemForm({ inicial, onClose, onErro, onOk }: { inicial: ItemEstoque; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [i, setI] = useState<ItemEstoque>(inicial);
  const up = (p: Partial<ItemEstoque>) => setI({ ...i, ...p });
  const insumos = ds.insumos.filter((x) => x.ativo && x.tipo === 'Material' && x.unidade.toLowerCase() === 'kg').slice(0, 400);
  return (
    <Modal title={inicial.codigo ? `Item ${inicial.codigo}` : 'Novo item de estoque'} onClose={onClose}>
      <div className="form">
        <Field label="Código" req hint="ex.: W200X26.6, CH-3/8, TUBO-100X100"><Input value={i.codigo} onChange={(e) => up({ codigo: e.target.value })} /></Field>
        <Field label="Família"><Select value={i.familia} onChange={(v) => up({ familia: v as FamiliaEstoque })} options={FAMILIAS_ESTOQUE} /></Field>
        <Field label="Descrição" req full><Input value={i.descricao} onChange={(e) => up({ descricao: e.target.value })} placeholder="Perfil W 200 x 26,6 kg/m ASTM A572 Gr.50" /></Field>
        <Field label="Peso unitário (kg/peça ou kg/m)" hint="para converter peças ou metros em kg"><NumberInput value={i.pesoUnitario ?? 0} onChange={(v) => up({ pesoUnitario: v || undefined })} /></Field>
        <Field label="Estoque mínimo (kg)" hint="0 = sem alerta"><NumberInput value={i.estoqueMinimo} onChange={(v) => up({ estoqueMinimo: v })} /></Field>
        <Field label="Insumo do catálogo" hint="preço de referência no orçamento"><Select value={i.insumoId ?? ''} onChange={(v) => up({ insumoId: v || undefined })} options={insumos.map((x) => ({ value: x.id, label: `${x.codigo} · ${x.descricao.slice(0, 50)}` }))} allowEmpty="—" /></Field>
        <Field label="Ativo"><Select value={i.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><Input value={i.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.salvarItemEstoque(i); onOk(`Item ${r.codigo} salvo.`); }, onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Movimento (entrada, consumo, sobra, ajuste)
// ---------------------------------------------------------------------------
function MovimentoForm({ inicial, onClose, onErro, onOk }: { inicial: MovimentoEstoque; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [m, setM] = useState<MovimentoEstoque>(inicial);
  const [busca, setBusca] = useState('');
  const [pedidoItem, setPedidoItem] = useState('');
  const up = (p: Partial<MovimentoEstoque>) => setM({ ...m, ...p });
  const pos = posicaoEstoque(ds);
  const itens = ds.itensEstoque.filter((i) => i.ativo);
  const item = pos.itens.find((i) => i.id === m.itemId);
  const lotes = item ? item.lotes.filter((l) => m.tipo !== 'Consumo' || l.saldoPorLocal[m.local] > 0) : [];
  const obras = obrasVisiveis(usuario, ds.obras);
  const conjuntosObra = ds.conjuntos.filter((c) => c.codigoObra === m.codigoObra);
  const candidatos = conjuntosObra.filter((c) => !busca || `${c.marca} ${c.descricao} ${c.perfil ?? ''}`.toLowerCase().includes(busca.toLowerCase())).slice(0, 40);
  const pedidos = ds.pedidos.filter((p) => p.status === 'Emitido' || p.status === 'Recebido parcial' || p.status === 'Recebido');
  const pedido = ds.pedidos.find((p) => p.id === m.pedidoId);
  const setConj = (id: string, q: number) => up({ conjuntos: q > 0 ? [...m.conjuntos.filter((c) => c.conjuntoId !== id), { conjuntoId: id, quantidade: q }] : m.conjuntos.filter((c) => c.conjuntoId !== id) });
  const usarItemPedido = (id: string) => {
    setPedidoItem(id);
    const it = pedido?.itens.find((x) => x.id === id);
    if (!it || !pedido) return;
    const emKg = it.unidade.toLowerCase() === 'kg';
    up({ quantidade: emKg ? it.quantidadeRecebida || it.quantidade : m.quantidade, custoUnitario: emKg ? it.precoUnitario : m.custoUnitario, fornecedor: pedido.fornecedor, notaFiscal: pedido.documento ?? m.notaFiscal, codigoObra: pedido.codigoObra, observacao: m.observacao || `${pedido.codigo}: ${it.descricao}` });
  };
  const corridaSel = (m.corrida ?? '').trim().toUpperCase();
  const saldoLote = corridaSel ? lotes.find((l) => l.corrida === corridaSel)?.saldoPorLocal[m.local] : undefined;
  const titulo = { Entrada: 'Entrada de material', Consumo: 'Consumo (corte)', Sobra: 'Sobra / retalho devolvido', Ajuste: 'Ajuste de inventário', Estorno: 'Estorno' }[m.tipo];
  return (
    <Modal title={titulo} onClose={onClose} wide>
      <div className="form">
        <Field label="Data" req><Input type="date" value={m.data} onChange={(e) => up({ data: e.target.value })} /></Field>
        <Field label="Tipo"><Select value={m.tipo} onChange={(v) => up({ tipo: v as TipoMovimento, conjuntos: [] })} options={['Entrada', 'Consumo', 'Sobra', 'Ajuste']} /></Field>
        <Field label="Item" req><Select value={m.itemId} onChange={(v) => up({ itemId: v, corrida: undefined })} options={itens.map((i) => ({ value: i.id, label: `${i.codigo} · ${i.descricao.slice(0, 40)}` }))} allowEmpty="— escolha —" /></Field>
        <Field label="Local" hint={item ? `fábrica ${kg(item.saldoFabrica)} · obra ${kg(item.saldoObra)}` : undefined}><Select value={m.local} onChange={(v) => up({ local: v as LocalEstoque })} options={LOCAIS_ESTOQUE} /></Field>
        {m.tipo === 'Entrada' && (
          <>
            <Field label="Pedido de compra" hint="preenche fornecedor, NF, kg e preço"><Select value={m.pedidoId ?? ''} onChange={(v) => { up({ pedidoId: v || undefined }); setPedidoItem(''); }} options={pedidos.map((p) => ({ value: p.id, label: `${p.codigo} · ${p.fornecedor} · ${p.codigoObra}` }))} allowEmpty="—" /></Field>
            <Field label="Item do pedido"><Select value={pedidoItem} onChange={usarItemPedido} options={(pedido?.itens ?? []).map((it) => ({ value: it.id, label: `${it.descricao.slice(0, 40)} · ${it.quantidade} ${it.unidade}` }))} allowEmpty="—" /></Field>
            <Field label="Corrida (heat)" req={!!item && exigeCorrida(item.familia)} hint="número no certificado de qualidade"><Input value={m.corrida ?? ''} onChange={(e) => up({ corrida: e.target.value || undefined })} placeholder="ex.: 7A12345" /></Field>
            <Field label="Certificado"><Input value={m.certificado ?? ''} onChange={(e) => up({ certificado: e.target.value || undefined })} placeholder="nº do certificado / usina" /></Field>
            <Field label="Fornecedor"><Input value={m.fornecedor ?? ''} onChange={(e) => up({ fornecedor: e.target.value || undefined })} /></Field>
            <Field label="Nota fiscal"><Input value={m.notaFiscal ?? ''} onChange={(e) => up({ notaFiscal: e.target.value || undefined })} /></Field>
            <Field label="Custo (R$/kg)" req><NumberInput value={m.custoUnitario} onChange={(v) => up({ custoUnitario: v })} /></Field>
            <Field label="Reservado para a obra"><Select value={m.codigoObra ?? ''} onChange={(v) => up({ codigoObra: v || undefined })} options={obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— estoque geral —" /></Field>
          </>
        )}
        {(m.tipo === 'Consumo' || m.tipo === 'Sobra') && (
          <>
            <Field label="Obra" req><Select value={m.codigoObra ?? ''} onChange={(v) => up({ codigoObra: v || undefined, servicoId: undefined, ordemId: undefined, conjuntos: [] })} options={obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— escolha —" /></Field>
            <Field label="Serviço" hint="custo real de material do serviço"><Select value={m.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === m.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
            <Field label="Ordem de fabricação"><Select value={m.ordemId ?? ''} onChange={(v) => up({ ordemId: v || undefined })} options={ds.ordens.filter((o) => o.codigoObra === m.codigoObra && !o.cancelada).map((o) => ({ value: o.id, label: `${o.codigo} · ${o.descricao}` }))} allowEmpty="—" /></Field>
            <Field label="Corrida (lote)" hint={saldoLote !== undefined ? `saldo do lote em ${m.local}: ${kg(saldoLote)}` : m.tipo === 'Consumo' ? 'obrigatória para rastreabilidade do aço' : 'lote de onde veio o retalho'}>
              {lotes.length ? <Select value={m.corrida ?? ''} onChange={(v) => up({ corrida: v || undefined })} options={lotes.map((l) => ({ value: l.corrida, label: `${l.corrida || '(sem corrida)'} · ${kg(l.saldoPorLocal[m.local])}${l.fornecedor ? ` · ${l.fornecedor}` : ''}` }))} allowEmpty="— saldo geral do item —" /> : <Input value={m.corrida ?? ''} onChange={(e) => up({ corrida: e.target.value || undefined })} placeholder="sem lotes com saldo" />}
            </Field>
            {m.tipo === 'Sobra' && <Field label="Custo (R$/kg)" hint="vazio = custo médio do lote"><NumberInput value={m.custoUnitario} onChange={(v) => up({ custoUnitario: v })} /></Field>}
          </>
        )}
        <Field label={m.tipo === 'Ajuste' ? 'Quantidade (kg, negativa para baixa)' : 'Quantidade (kg)'} req hint={item?.pesoUnitario ? `${item.pesoUnitario} kg por peça/m` : undefined}><NumberInput value={m.quantidade} onChange={(v) => up({ quantidade: v })} /></Field>
        <Field label="Peças / barras"><NumberInput value={m.pecas ?? 0} onChange={(v) => up({ pecas: v || undefined })} /></Field>
        <Field label={m.tipo === 'Ajuste' ? 'Justificativa' : 'Observação'} req={m.tipo === 'Ajuste'} full><Input value={m.observacao} onChange={(e) => up({ observacao: e.target.value })} placeholder={m.tipo === 'Ajuste' ? 'inventário, perda, erro de pesagem' : 'lote, eixo, plano de corte'} /></Field>
      </div>
      {m.tipo === 'Consumo' && m.codigoObra && (
        <div style={{ marginTop: 14 }}>
          <h3>Conjuntos cortados com este material {m.conjuntos.length ? `(${m.conjuntos.length})` : ''}</h3>
          {!conjuntosObra.length ? <div className="muted small">Sem lista de materiais nesta obra: o consumo fica no serviço/ordem.</div> : (
            <>
              <Input placeholder="Buscar marca…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
                <table>
                  <thead><tr><th>Marca</th><th>Descrição</th><th>Perfil</th><th className="num">Peças</th><th className="num">Nesta corrida</th></tr></thead>
                  <tbody>{candidatos.map((c) => <tr key={c.id}><td><b>{c.marca}</b></td><td className="small">{c.descricao.slice(0, 30)}</td><td className="small muted">{c.perfil ?? ''}</td><td className="num">{c.quantidade}</td><td className="num"><input type="number" min={0} value={m.conjuntos.find((x) => x.conjuntoId === c.id)?.quantidade ?? ''} placeholder="0" onChange={(e) => setConj(c.id, Number(e.target.value))} style={{ width: 70, textAlign: 'right' }} /></td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.registrarMovimento(m); onOk(`${r.tipo} de ${kg(Math.abs(r.quantidade))} registrada${r.tipo === 'Consumo' ? ` a ${rkg(r.custoUnitario)}` : ''}.`); }, onErro, onClose)}>Registrar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function Estoque({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const obras = obrasVisiveis(usuario, ds.obras);
  const [obra, setObra] = useState(query.get('obra') ?? (obras.length === 1 ? obras[0].codigo : ''));
  const [aba, setAba] = useState<'posicao' | 'movimentos' | 'rastreio' | 'itens'>(query.get('aba') === 'movimentos' ? 'movimentos' : 'posicao');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [buscaItem, setBuscaItem] = useState('');
  const [rastro, setRastro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<ItemEstoque | null>(null);
  const [mov, setMov] = useState<MovimentoEstoque | null>(null);
  const pos = posicaoEstoque(ds);
  const cons = consumoAco(ds, { codigoObra: obra || undefined });
  const podeComprar = pode(usuario, 'comprar');
  const podeApontar = pode(usuario, 'comentar', obra || undefined);
  const nomeItem = new Map(ds.itensEstoque.map((i) => [i.id, i.codigo]));
  const nomeSrv = new Map(ds.servicos.map((s) => [s.id, s.codigo]));
  const marca = new Map(ds.conjuntos.map((c) => [c.id, c.marca]));
  const estornados = new Set(ds.movimentosEstoque.filter((m) => m.origemId).map((m) => m.origemId!));
  const movimentos = ds.movimentosEstoque.filter((m) => (!tipoFiltro || m.tipo === tipoFiltro) && (!obra || !m.codigoObra || m.codigoObra === obra)).slice().sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.criadoEm < b.criadoEm ? 1 : -1));
  const itensLista = pos.itens.filter((i) => !buscaItem || `${i.codigo} ${i.descricao} ${i.familia}`.toLowerCase().includes(buscaItem.toLowerCase()));
  const rastroCorrida = rastro ? rastrearCorrida(ds, rastro) : undefined;
  const corridasLista = rastro && !rastroCorrida ? corridas(ds).filter((c) => c.includes(rastro.trim().toUpperCase())).slice(0, 20) : [];
  const conjuntosRastro = rastro ? ds.conjuntos.filter((c) => c.marca.toLowerCase().includes(rastro.trim().toLowerCase())).slice(0, 10).map((c) => ({ c, corridas: rastrearConjunto(ds, c.id) })).filter((x) => x.corridas.length) : [];
  const estornar = (m: MovimentoEstoque) => { const motivo = window.prompt(`Motivo do estorno de ${m.tipo.toLowerCase()} de ${kg(Math.abs(m.quantidade))} (${nomeItem.get(m.itemId)}):`); if (motivo) tentar(() => actions.estornarMovimento(m.id, motivo), toast, () => toast('Estorno registrado.')); };
  const novoMov = (tipo: TipoMovimento) => setMov(actions.novoMovimentoEstoque({ tipo, codigoObra: tipo === 'Entrada' ? undefined : obra || undefined, local: 'Fábrica' }));
  return (
    <>
      <PageHead title="Estoque de aço" subtitle="Entradas com corrida e certificado, saldo por perfil e lote, consumo por obra, ordem e conjunto, sobras que voltam ao estoque. Custo médio móvel e custo real de material por serviço.">
        <Select value={obra} onChange={setObra} options={obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="Todas as obras" />
        {podeComprar && <button className="btn" onClick={() => setEditItem(actions.novoItemEstoque())}>+ Item</button>}
        {podeComprar && <button className="btn" onClick={() => novoMov('Ajuste')}>Ajuste</button>}
        {podeApontar && <button className="btn" onClick={() => novoMov('Sobra')}>Sobra</button>}
        {podeApontar && <button className="btn" onClick={() => novoMov('Consumo')}>Consumo</button>}
        {podeComprar && <button className="btn primary" onClick={() => novoMov('Entrada')}>+ Entrada</button>}
      </PageHead>
      <div className="hero-grid">
        <KpiHero label="Aço em estoque" value={t(pos.saldoKg)} sufixo={money(pos.valor, true)} tone={pos.abaixoMinimo ? 'warn' : undefined}
          hint={`${pos.lotes} lote(s) com saldo · ${pos.itens.length} item(ns)${pos.abaixoMinimo ? ` · ${pos.abaixoMinimo} abaixo do mínimo` : ''}`}
          secundarios={[{ label: 'Na fábrica', value: t(pos.saldoFabrica) }, { label: 'Em obra', value: t(pos.saldoObra) }, { label: 'Entradas', value: t(pos.entradasKg) }, { label: 'Sobras devolvidas', value: kg(pos.sobrasKg) }]}>
          {pos.itens.filter((i) => i.saldo > 0).slice(0, 5).map((i) => <ProgressRow key={i.id} label={i.codigo} valor={pos.saldoKg ? i.saldo / pos.saldoKg : 0} texto={`${kg(i.saldo)} · ${money(i.valor, true)}`} />)}
          {!pos.itens.length && <div className="muted small">Cadastre os perfis e chapas e registre a primeira entrada com a corrida do certificado.</div>}
        </KpiHero>
        <KpiHero label={obra ? `Aço consumido · ${obra}` : 'Aço consumido nas obras'} value={t(cons.total.liquidoKg)} sufixo={money(cons.total.custo, true)} hint={cons.total.liquidoKg ? `${rkg(cons.total.custoPorKg)} · ${kg(cons.total.consumidoKg)} cortados, ${kg(cons.total.sobraKg)} devolvidos` : 'sem consumo registrado'}
          secundarios={[{ label: 'Custo médio', value: cons.total.liquidoKg ? rkg(cons.total.custoPorKg) : '—' }, { label: 'Sobras', value: kg(cons.total.sobraKg) }, { label: 'Movimentos', value: cons.total.movimentos }]}>
          {(obra ? cons.porServico : cons.porObra).slice(0, 5).map((c) => <ProgressRow key={c.chave} label={c.nome} valor={cons.total.liquidoKg ? c.liquidoKg / cons.total.liquidoKg : 0} texto={`${kg(c.liquidoKg)} · ${money(c.custo, true)}`} />)}
        </KpiHero>
      </div>
      <KpiStrip itens={pos.porFamilia.slice(0, 6).map((f) => ({ label: f.familia, value: t(f.saldo), hint: money(f.valor, true) }))} />
      <div style={{ height: 16 }} />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'posicao', label: `Posição (${pos.itens.length})` }, { id: 'movimentos', label: `Movimentos (${movimentos.length})` }, { id: 'rastreio', label: 'Rastreabilidade' }, { id: 'itens', label: 'Itens' }]} />
      {aba === 'posicao' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><Input placeholder="Buscar código, descrição, família…" value={buscaItem} onChange={(e) => setBuscaItem(e.target.value)} /></div>
          {!itensLista.length ? <Empty icone="estoque" titulo="Sem itens em estoque">Cadastre perfis, chapas e tubos e registre as entradas com a corrida do certificado.</Empty> : (
            <table>
              <thead><tr><th /><th>Código</th><th>Descrição</th><th>Família</th><th className="num">Fábrica</th><th className="num">Obra</th><th className="num">Saldo</th><th className="num">Custo médio</th><th className="num">Valor</th><th className="num">Lotes</th><th>Último</th></tr></thead>
              <tbody>
                {itensLista.map((i: ItemEstoqueCalc) => (
                  <React.Fragment key={i.id}>
                    <tr onClick={() => setAberto(aberto === i.id ? null : i.id)} style={{ cursor: 'pointer' }}>
                      <td className="muted small">{aberto === i.id ? '▾' : '▸'}</td>
                      <td><b>{i.codigo}</b>{i.abaixoMinimo && <> <Badge tone="warn">mínimo {kg(i.estoqueMinimo)}</Badge></>}</td>
                      <td className="small">{i.descricao}</td><td className="small muted">{i.familia}</td>
                      <td className="num">{kg(i.saldoFabrica)}</td><td className="num">{kg(i.saldoObra)}</td><td className={`num ${i.saldo < 0 ? 'neg' : ''}`}><b>{kg(i.saldo)}</b></td>
                      <td className="num">{i.custoMedio ? rkg(i.custoMedio) : '—'}</td><td className="num">{money(i.valor, true)}</td><td className="num">{i.lotes.filter((l) => l.saldo > 0).length}</td><td className="small muted">{d(i.ultimoMovimento)}</td>
                    </tr>
                    {aberto === i.id && (
                      <tr><td /><td colSpan={10}>
                        {!i.lotes.length ? <div className="muted small">Sem movimentos.</div> : (
                          <table className="small">
                            <thead><tr><th>Corrida</th><th>Certificado</th><th>Fornecedor</th><th>Entrada</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Fábrica</th><th className="num">Obra</th><th className="num">Saldo</th><th className="num">Custo</th></tr></thead>
                            <tbody>{i.lotes.map((l) => <tr key={l.corrida}><td><b>{l.corrida || '(sem corrida)'}</b></td><td>{l.certificado ?? '—'}</td><td>{l.fornecedor ?? '—'}</td><td>{d(l.entradaEm)}</td><td className="num">{kg(l.entradas)}</td><td className="num">{kg(l.saidas)}</td><td className="num">{kg(l.saldoPorLocal.Fábrica)}</td><td className="num">{kg(l.saldoPorLocal.Obra)}</td><td className="num"><b>{kg(l.saldo)}</b></td><td className="num">{l.custoMedio ? rkg(l.custoMedio) : '—'}</td></tr>)}</tbody>
                          </table>
                        )}
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {aba === 'movimentos' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><Select value={tipoFiltro} onChange={setTipoFiltro} options={['Entrada', 'Consumo', 'Sobra', 'Ajuste', 'Estorno']} allowEmpty="Todos os tipos" /></div>
          {!movimentos.length ? <Empty icone="estoque" titulo="Nenhum movimento">Registre a entrada do aço com a corrida do certificado; o corte aponta o consumo por obra e conjunto.</Empty> : (
            <table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Item</th><th>Corrida</th><th>Local</th><th>Obra / serviço</th><th className="num">kg</th><th className="num">R$/kg</th><th className="num">Valor</th><th>Conjuntos</th><th>Observação</th><th /></tr></thead>
              <tbody>{movimentos.map((m) => { const e = efeitoMovimento(m); return (
                <tr key={m.id}>
                  <td>{d(m.data)}</td><td><Badge tone={TONE_TIPO[m.tipo]}>{m.tipo}{m.origemTipo ? ` de ${m.origemTipo.toLowerCase()}` : ''}</Badge></td>
                  <td><b>{nomeItem.get(m.itemId) ?? m.itemId}</b></td><td className="small">{m.corrida ?? '—'}{m.fornecedor && <div className="muted">{m.fornecedor}{m.notaFiscal ? ` · NF ${m.notaFiscal}` : ''}</div>}</td><td className="small">{m.local}</td>
                  <td className="small">{m.codigoObra ?? '—'}{m.servicoId && <div className="muted">{nomeSrv.get(m.servicoId)}</div>}</td>
                  <td className={`num ${e < 0 ? 'neg' : ''}`}><b>{e > 0 ? '+' : ''}{e.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</b></td><td className="num">{m.custoUnitario ? m.custoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td><td className="num">{money(Math.abs(e) * m.custoUnitario, true)}</td>
                  <td className="small">{m.conjuntos.map((c) => `${marca.get(c.conjuntoId) ?? c.conjuntoId}×${c.quantidade}`).join(', ')}</td><td className="small muted">{m.observacao}</td>
                  <td>{podeComprar && m.tipo !== 'Estorno' && !estornados.has(m.id) && <button className="btn sm" onClick={() => estornar(m)}>Estornar</button>}</td>
                </tr>
              ); })}</tbody>
            </table>
          )}
        </div>
      )}
      {aba === 'rastreio' && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}><Input placeholder="Corrida (heat) ou marca do conjunto…" value={rastro} onChange={(e) => setRastro(e.target.value)} /></div>
          {!rastro && <Empty icone="auditoria" titulo="Rastreabilidade de corrida">Digite a corrida do certificado para ver em quais obras e conjuntos ela foi usada, ou a marca de um conjunto para ver as corridas que entraram nele.</Empty>}
          {rastroCorrida && (
            <>
              <h2>Corrida {rastroCorrida.corrida}</h2>
              <KpiStrip itens={[{ label: 'Entrou', value: kg(rastroCorrida.kgEntrado) }, { label: 'Consumido', value: kg(rastroCorrida.kgConsumido) }, { label: 'Saldo', value: kg(rastroCorrida.kgSaldo) }, { label: 'Obras', value: rastroCorrida.obras.join(', ') || '—' }]} />
              <h3 style={{ marginTop: 12 }}>Entradas</h3>
              <table><thead><tr><th>Data</th><th>Item</th><th>Certificado</th><th>Fornecedor</th><th>NF</th><th className="num">kg</th><th className="num">R$/kg</th></tr></thead>
                <tbody>{rastroCorrida.entradas.map((m) => <tr key={m.id}><td>{d(m.data)}</td><td>{m.item}</td><td>{m.certificado ?? '—'}</td><td>{m.fornecedor ?? '—'}</td><td>{m.notaFiscal ?? '—'}</td><td className="num">{kg(m.quantidade)}</td><td className="num">{m.custoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table>
              <h3 style={{ marginTop: 12 }}>Consumos</h3>
              {!rastroCorrida.consumos.length ? <div className="muted small">Ainda não consumida.</div> : (
                <table><thead><tr><th>Data</th><th>Obra</th><th>Serviço</th><th>Item</th><th className="num">kg</th><th>Conjuntos</th><th>Observação</th></tr></thead>
                  <tbody>{rastroCorrida.consumos.map((m) => <tr key={m.id}><td>{d(m.data)}</td><td>{m.codigoObra}</td><td className="small">{m.servicoId ? nomeSrv.get(m.servicoId) : '—'}</td><td className="small">{m.item}</td><td className="num">{kg(m.quantidade)}</td><td className="small">{m.marcas.map((x) => `${x.marca}×${x.quantidade}`).join(', ') || '—'}</td><td className="small muted">{m.observacao}</td></tr>)}</tbody></table>
              )}
            </>
          )}
          {!!corridasLista.length && <div className="muted small" style={{ marginTop: 8 }}>Corridas parecidas: {corridasLista.map((c) => <button key={c} className="btn sm" style={{ marginRight: 4 }} onClick={() => setRastro(c)}>{c}</button>)}</div>}
          {!!conjuntosRastro.length && (
            <>
              <h2 style={{ marginTop: 16 }}>Conjuntos</h2>
              {conjuntosRastro.map(({ c, corridas: cs }) => (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <b>{c.marca}</b> <span className="muted small">{c.descricao} · {c.codigoObra}</span>
                  <table className="small"><thead><tr><th>Corrida</th><th>Certificado</th><th>Fornecedor</th><th>Data</th><th>Item</th><th className="num">Peças</th><th className="num">kg do corte</th></tr></thead>
                    <tbody>{cs.map((x, i) => <tr key={i}><td><button className="btn sm" onClick={() => setRastro(x.corrida)}>{x.corrida}</button></td><td>{x.certificado ?? '—'}</td><td>{x.fornecedor ?? '—'}</td><td>{d(x.data)}</td><td>{x.item}</td><td className="num">{x.quantidade}</td><td className="num">{kg(x.kg)}</td></tr>)}</tbody></table>
                </div>
              ))}
            </>
          )}
          {rastro && !rastroCorrida && !corridasLista.length && !conjuntosRastro.length && <div className="muted small">Nada encontrado para “{rastro}”.</div>}
        </div>
      )}
      {aba === 'itens' && (
        <div className="card table-wrap">
          {!ds.itensEstoque.length ? <Empty icone="estoque" titulo="Nenhum item cadastrado">Cadastre perfis, chapas, tubos e consumíveis. O código é a chave nas entradas e nos planos de corte.</Empty> : (
            <table>
              <thead><tr><th>Código</th><th>Descrição</th><th>Família</th><th className="num">Peso unit.</th><th className="num">Mínimo</th><th>Insumo</th><th>Ativo</th><th /></tr></thead>
              <tbody>{ds.itensEstoque.map((i) => <tr key={i.id}><td><b>{i.codigo}</b></td><td className="small">{i.descricao}</td><td className="small muted">{i.familia}</td><td className="num">{i.pesoUnitario ?? '—'}</td><td className="num">{i.estoqueMinimo ? kg(i.estoqueMinimo) : '—'}</td><td className="small muted">{i.insumoId ? ds.insumos.find((x) => x.id === i.insumoId)?.codigo ?? i.insumoId : '—'}</td><td>{i.ativo ? <Badge tone="ok">ativo</Badge> : <Badge tone="muted">inativo</Badge>}</td><td>{podeComprar && <button className="btn sm" onClick={() => setEditItem(i)}>Editar</button>}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      {editItem && <ItemForm inicial={editItem} onClose={() => setEditItem(null)} onErro={toast} onOk={toast} />}
      {mov && <MovimentoForm inicial={mov} onClose={() => setMov(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
