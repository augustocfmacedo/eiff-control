import React, { useState } from 'react';
import { ESTACAO_CONCLUI, calcRomaneio, estacoesDe, resumoProdutividade, type ApontamentoEstacaoCalc } from '../core/producao';
import { calcConjunto } from '../core/materiais';
import type { ApontamentoEstacao, LinhaProducao, Romaneio } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, KpiHero, KpiStrip, Modal, NumberInput, PageHead, ProgressRow, Select, Tabs, money, pct, tentar, useToast, type Tone } from '../ui/components';
import { Sparkline } from '../ui/charts';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const kg = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const addDias = (s: string, n: number) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------
// Apontamento de estacao
// ---------------------------------------------------------------------------
function ApontarForm({ inicial, onClose, onErro, onOk }: { inicial: ApontamentoEstacao; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [a, setA] = useState<ApontamentoEstacao>(inicial);
  const [busca, setBusca] = useState('');
  const up = (p: Partial<ApontamentoEstacao>) => setA({ ...a, ...p });
  const estacoes = estacoesDe(a.linha);
  const conjuntosObra = ds.conjuntos.filter((c) => c.codigoObra === a.codigoObra).map(calcConjunto);
  const marco = ESTACAO_CONCLUI[a.estacao];
  const campo = marco === 'fabricado' ? 'fabricadoQtd' : marco === 'expedido' ? 'expedidoQtd' : marco === 'montado' ? 'montadoQtd' : null;
  const candidatos = conjuntosObra.filter((c) => (!busca || `${c.marca} ${c.descricao}`.toLowerCase().includes(busca.toLowerCase())) && (!campo || c[campo] < c.quantidade)).slice(0, 40);
  const pesoConj = a.conjuntos.reduce((s, it) => s + it.quantidade * (conjuntosObra.find((c) => c.id === it.conjuntoId)?.pesoUnitario ?? 0), 0);
  const horas = a.colaboradores.reduce((s, c) => s + c.horas, 0);
  const colabs = ds.colaboradores.filter((c) => c.ativo && (a.linha === 'Fabricação' ? c.local !== 'Obra' : c.local !== 'Fábrica'));
  const setColab = (id: string, h: number) => up({ colaboradores: h > 0 ? [...a.colaboradores.filter((c) => c.colaboradorId !== id), { colaboradorId: id, horas: h }] : a.colaboradores.filter((c) => c.colaboradorId !== id) });
  const setConj = (id: string, q: number) => up({ conjuntos: q > 0 ? [...a.conjuntos.filter((c) => c.conjuntoId !== id), { conjuntoId: id, quantidade: q }] : a.conjuntos.filter((c) => c.conjuntoId !== id) });
  return (
    <Modal title="Apontar estação" onClose={onClose} wide>
      <div className="form">
        <Field label="Data" req><Input type="date" value={a.data} onChange={(e) => up({ data: e.target.value })} /></Field>
        <Field label="Obra" req><Select value={a.codigoObra} onChange={(v) => up({ codigoObra: v, servicoId: undefined, ordemId: undefined, conjuntos: [] })} options={obrasVisiveis(usuario, ds.obras).map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— escolha —" /></Field>
        <Field label="Linha"><Select value={a.linha} onChange={(v) => up({ linha: v as LinhaProducao, estacao: estacoesDe(v as LinhaProducao)[0], colaboradores: [] })} options={['Fabricação', 'Montagem']} /></Field>
        <Field label="Estação" hint={marco ? `Conclui: ${marco} nos conjuntos informados` : undefined}><Select value={a.estacao} onChange={(v) => up({ estacao: v })} options={[...estacoes]} /></Field>
        <Field label="Serviço"><Select value={a.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === a.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
        <Field label="Ordem" hint="Acumula a quantidade na etapa de mesmo nome"><Select value={a.ordemId ?? ''} onChange={(v) => up({ ordemId: v || undefined })} options={ds.ordens.filter((o) => o.codigoObra === a.codigoObra && !o.cancelada && o.tipo === a.linha).map((o) => ({ value: o.id, label: `${o.codigo} · ${o.descricao}` }))} allowEmpty="—" /></Field>
        <Field label="Peso processado (kg)" hint={a.conjuntos.length ? `dos conjuntos: ${kg(pesoConj)} (vazio = usa este)` : 'informe o peso ou selecione conjuntos'}><NumberInput value={a.pesoKg} onChange={(v) => up({ pesoKg: v })} /></Field>
        <Field label="Peças"><NumberInput value={a.pecas} onChange={(v) => up({ pecas: v })} /></Field>
        <Field label="Observação" full><Input value={a.observacao} onChange={(e) => up({ observacao: e.target.value })} placeholder="lote, eixo, ocorrência" /></Field>
      </div>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div>
          <h3>Conjuntos processados {a.conjuntos.length ? `(${a.conjuntos.length})` : ''}</h3>
          {!conjuntosObra.length ? <div className="muted small">Sem lista de materiais nesta obra: aponte por peso.</div> : (
            <>
              <Input placeholder="Buscar marca…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {!candidatos.length && <div className="muted small" style={{ marginTop: 6 }}>{busca ? 'Nenhuma marca com esse texto.' : `Todos os conjuntos já constam como ${marco} nesta obra.`}</div>}
              <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 6 }}>
                <table>
                  <thead><tr><th>Marca</th><th className="num">Total</th>{campo && <th className="num">Feito</th>}<th className="num">Agora</th></tr></thead>
                  <tbody>{candidatos.map((c) => <tr key={c.id}><td><b>{c.marca}</b> <span className="muted small">{c.descricao.slice(0, 26)}</span></td><td className="num">{c.quantidade}</td>{campo && <td className="num">{c[campo]}</td>}<td className="num"><input type="number" min={0} value={a.conjuntos.find((x) => x.conjuntoId === c.id)?.quantidade ?? ''} placeholder="0" onChange={(e) => setConj(c.id, Number(e.target.value))} style={{ width: 70, textAlign: 'right' }} /></td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div>
          <h3>Horas por colaborador · {n1(horas)} h</h3>
          {!colabs.length ? <div className="muted small">Cadastre a equipe em Equipe e produtividade.</div> : (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <table>
                <thead><tr><th>Colaborador</th><th>Função</th><th className="num">Horas</th></tr></thead>
                <tbody>{colabs.map((c) => <tr key={c.id}><td>{c.nome}</td><td className="small muted">{c.funcao}</td><td className="num"><input type="number" min={0} max={24} step={0.5} value={a.colaboradores.find((x) => x.colaboradorId === c.id)?.horas ?? ''} placeholder="0" onChange={(e) => setColab(c.id, Number(e.target.value))} style={{ width: 70, textAlign: 'right' }} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.apontarEstacao(a); onOk(`${a.estacao}: ${kg(r.pesoKg)} · ${n1(horas)} h${horas ? ` · ${n1(r.pesoKg / horas)} kg/HH` : ''}.`); }, onErro, onClose)}>Registrar apontamento</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Romaneio
// ---------------------------------------------------------------------------
function RomaneioForm({ inicial, onClose, onErro, onOk }: { inicial: Romaneio; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [r, setR] = useState<Romaneio>(inicial);
  const [busca, setBusca] = useState('');
  const up = (p: Partial<Romaneio>) => setR({ ...r, ...p });
  const conjuntos = ds.conjuntos.filter((c) => c.codigoObra === r.codigoObra).map(calcConjunto);
  const candidatos = conjuntos.filter((c) => c.expedidoQtd < c.quantidade && (!busca || `${c.marca} ${c.descricao}`.toLowerCase().includes(busca.toLowerCase()))).slice(0, 60);
  const calc = calcRomaneio(r, ds.conjuntos);
  const setItem = (id: string, q: number) => up({ itens: q > 0 ? [...r.itens.filter((i) => i.conjuntoId !== id), { conjuntoId: id, quantidade: q }] : r.itens.filter((i) => i.conjuntoId !== id) });
  return (
    <Modal title={`Romaneio ${r.numero} · ${r.codigoObra}`} onClose={onClose} wide>
      <div className="form">
        <Field label="Data de saída" req><Input type="date" value={r.data} onChange={(e) => up({ data: e.target.value })} /></Field>
        <Field label="Transportadora / veículo" req><Input value={r.transportadora} onChange={(e) => up({ transportadora: e.target.value })} /></Field>
        <Field label="Placa"><Input value={r.placa ?? ''} onChange={(e) => up({ placa: e.target.value || undefined })} /></Field>
        <Field label="Motorista"><Input value={r.motorista ?? ''} onChange={(e) => up({ motorista: e.target.value || undefined })} /></Field>
        <Field label="Destino"><Input value={r.destino} onChange={(e) => up({ destino: e.target.value })} /></Field>
        <Field label="Observações" full><Input value={r.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <h3 style={{ marginTop: 14 }}>Carga · {calc.pecas} peça(s) · {kg(calc.pesoTotal)}</h3>
      {!conjuntos.length ? <Empty>Sem lista de materiais nesta obra. Importe os conjuntos na Obra 360 › Materiais.</Empty> : (
        <>
          <Input placeholder="Buscar marca…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 6 }}>
            <table>
              <thead><tr><th>Marca</th><th>Descrição</th><th className="num">Fabricado</th><th className="num">Já expedido</th><th className="num">Nesta carga</th><th className="num">Peso</th></tr></thead>
              <tbody>{candidatos.map((c) => { const q = r.itens.find((i) => i.conjuntoId === c.id)?.quantidade ?? 0; return <tr key={c.id}><td><b>{c.marca}</b></td><td className="small">{c.descricao}</td><td className="num">{c.fabricadoQtd}/{c.quantidade}</td><td className="num">{c.expedidoQtd}</td><td className="num"><input type="number" min={0} max={c.quantidade - c.expedidoQtd} value={q || ''} placeholder="0" onChange={(e) => setItem(c.id, Number(e.target.value))} style={{ width: 70, textAlign: 'right' }} /></td><td className="num">{q ? kg(q * c.pesoUnitario) : '—'}</td></tr>; })}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!r.itens.length} onClick={() => tentar(() => { actions.emitirRomaneio(r); onOk(`Romaneio ${r.numero} emitido: ${calc.pecas} peça(s), ${kg(calc.pesoTotal)}.`); }, onErro, onClose)}>Emitir romaneio</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function Producao({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const obras = obrasVisiveis(usuario, ds.obras);
  const [obra, setObra] = useState(query.get('obra') ?? (obras.length === 1 ? obras[0].codigo : ''));
  const [aba, setAba] = useState<'apontamentos' | 'produtividade' | 'romaneios'>('apontamentos');
  const [de, setDe] = useState(addDias(ds.params.dataBase, -30));
  const [ate, setAte] = useState(ds.params.dataBase);
  const [apontar, setApontar] = useState<ApontamentoEstacao | null>(null);
  const [romaneio, setRomaneio] = useState<Romaneio | null>(null);
  const r = resumoProdutividade(ds, { codigoObra: obra || undefined, de, ate });
  const podeApontar = pode(usuario, 'comentar', obra || undefined);
  const podeExcluir = pode(usuario, 'editar_etc', obra || undefined);
  const nomeCol = (id: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? id;
  const romaneios = ds.romaneios.filter((x) => !obra || x.codigoObra === obra).map((x) => calcRomaneio(x, ds.conjuntos)).sort((a, b) => (a.data < b.data ? 1 : -1));
  const excluir = (a: ApontamentoEstacaoCalc) => { const m = window.prompt(`Motivo da exclusão do apontamento de ${d(a.data)} · ${a.estacao}:`); if (m) tentar(() => actions.excluirApontamentoEstacao(a.id, m), toast, () => toast('Apontamento excluído.')); };
  const toneMeta = (v?: number): Tone => (v === undefined ? 'muted' : v >= 1 ? 'ok' : v >= 0.8 ? 'warn' : 'bad');
  return (
    <>
      <PageHead title="Fábrica e montagem" subtitle="Apontamento por estação em quilos, peças e horas; produtividade em kg por hora-homem contra a meta das composições; romaneios de expedição. Pintura conclui a fabricação, Expedição e romaneio expedem, Liberação conclui a montagem.">
        <Select value={obra} onChange={setObra} options={obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="Todas as obras" />
        <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        {podeApontar && obra && <button className="btn" onClick={() => setRomaneio(actions.novoRomaneio(obra))}>Romaneio</button>}
        {podeApontar && <button className="btn primary" onClick={() => setApontar(actions.novoApontamentoEstacao({ codigoObra: obra }))}>+ Apontar estação</button>}
      </PageHead>
      <div className="hero-grid">
        <KpiHero label="Fábrica: kg por hora-homem no período" value={n1(r.kgPorHHFabrica)} sufixo={`meta ${n1(r.metaFabrica)} kg/HH`} tone={r.horasFabrica ? (r.kgPorHHFabrica >= r.metaFabrica ? 'ok' : r.kgPorHHFabrica >= r.metaFabrica * 0.8 ? 'warn' : 'bad') : undefined}
          hint={`${kg(r.kgFabricados)} concluídos na pintura · ${n1(r.horasFabrica)} h apontadas · custo de mão de obra ${money(r.custoMaoDeObra, true)}`}
          secundarios={[{ label: 'Fabricado', value: kg(r.kgFabricados) }, { label: 'Expedido', value: kg(r.kgExpedidos) }, { label: 'Horas fábrica', value: `${n1(r.horasFabrica)} h` }, { label: 'Apontamentos', value: r.apontamentos.length }]}>
          {r.porDia.length > 1 ? <><Sparkline valores={r.porDia.map((x) => x.fabrica)} rotulos={r.porDia.map((x) => x.data)} /><div className="muted small">kg processados na fábrica por dia, {d(r.porDia[0].data)} a {d(r.porDia[r.porDia.length - 1].data)}</div></> : <div className="muted small">Aponte as estações para ver a curva diária.</div>}
        </KpiHero>
        <KpiHero label="Canteiro: kg por hora-homem" value={n1(r.kgPorHHCanteiro)} sufixo={`meta ${n1(r.metaCanteiro)} kg/HH`} tone={r.horasCanteiro ? (r.kgPorHHCanteiro >= r.metaCanteiro ? 'ok' : r.kgPorHHCanteiro >= r.metaCanteiro * 0.8 ? 'warn' : 'bad') : undefined} hint={`${kg(r.kgMontados)} liberados · ${n1(r.horasCanteiro)} h apontadas`}
          secundarios={[{ label: 'Montado', value: kg(r.kgMontados) }, { label: 'Horas canteiro', value: `${n1(r.horasCanteiro)} h` }, { label: 'Romaneios', value: romaneios.filter((x) => x.status !== 'Cancelado').length }]}>
          {r.porEstacao.filter((e) => e.chave.startsWith('Montagem')).slice(0, 5).map((e) => <ProgressRow key={e.chave} label={e.nome.replace(' (canteiro)', '')} valor={r.kgMontados ? e.kg / Math.max(r.kgMontados, e.kg) : 0} texto={`${kg(e.kg)} · ${n1(e.kgPorHH)} kg/HH`} />)}
        </KpiHero>
      </div>
      <KpiStrip itens={r.porEstacao.filter((e) => e.chave.startsWith('Fabricação')).map((e) => ({ label: e.nome.replace(' (fábrica)', ''), value: kg(e.kg), hint: `${n1(e.horas)} h · ${n1(e.kgPorHH)} kg/HH` }))} />
      <div style={{ height: 16 }} />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'apontamentos', label: `Apontamentos (${r.apontamentos.length})` }, { id: 'produtividade', label: 'Produtividade por estação e colaborador' }, { id: 'romaneios', label: `Romaneios (${romaneios.length})` }]} />
      {aba === 'apontamentos' && (
        <div className="card table-wrap">
          {!r.apontamentos.length ? <Empty icone="fabrica" titulo="Nenhum apontamento no período">Registre o que cada estação processou no dia: quilos, peças e horas da equipe.</Empty> : (
            <table>
              <thead><tr><th>Data</th><th>Obra</th><th>Linha</th><th>Estação</th><th className="num">Peso</th><th className="num">Peças</th><th className="num">Horas</th><th className="num">kg/HH</th><th className="num">Custo MO</th><th>Equipe</th><th>Observação</th><th /></tr></thead>
              <tbody>
                {r.apontamentos.map((a) => (
                  <tr key={a.id}>
                    <td>{d(a.data)}</td><td className="small">{a.codigoObra}</td><td className="small">{a.linha}</td><td>{a.estacao}{ESTACAO_CONCLUI[a.estacao] && <> <Badge tone="info">{ESTACAO_CONCLUI[a.estacao]}</Badge></>}</td>
                    <td className="num"><b>{kg(a.pesoKg)}</b></td><td className="num">{a.pecas}</td><td className="num">{n1(a.horas)}</td><td className={`num ${a.horas && a.kgPorHH < (a.linha === 'Fabricação' ? r.metaFabrica : r.metaCanteiro) * 0.8 ? 'neg' : ''}`}>{a.horas ? n1(a.kgPorHH) : '—'}</td>
                    <td className="num">{money(a.custoMaoDeObra, true)}</td>
                    <td className="small">{a.colaboradores.map((c) => `${nomeCol(c.colaboradorId).split(' ')[0]} ${n1(c.horas)}h`).join(', ')}</td>
                    <td className="small muted">{a.observacao}</td>
                    <td>{podeExcluir && <button className="btn sm" onClick={() => excluir(a)}>Excluir</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {aba === 'produtividade' && (
        <div className="grid cols-2">
          <div className="card table-wrap">
            <h2>Por estação</h2>
            {!r.porEstacao.length ? <Empty>Sem apontamentos no período.</Empty> : (
              <table>
                <thead><tr><th>Estação</th><th className="num">kg</th><th className="num">Peças</th><th className="num">Horas</th><th className="num">kg/HH</th><th className="num">R$/kg</th><th className="num">Dias</th></tr></thead>
                <tbody>{r.porEstacao.map((e) => <tr key={e.chave}><td>{e.nome}</td><td className="num">{kg(e.kg)}</td><td className="num">{e.pecas}</td><td className="num">{n1(e.horas)}</td><td className="num">{e.horas ? n1(e.kgPorHH) : '—'}</td><td className="num">{e.kg ? e.custoPorKg.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td><td className="num">{e.dias}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div className="card table-wrap">
            <h2>Por colaborador</h2>
            {!r.porColaborador.length ? <Empty>Informe as horas por colaborador nos apontamentos.</Empty> : (
              <table>
                <thead><tr><th>Colaborador</th><th className="num">Horas</th><th className="num">kg atribuídos</th><th className="num">kg/HH</th><th>vs. meta</th><th className="num">Dias</th></tr></thead>
                <tbody>{r.porColaborador.map((c) => <tr key={c.chave}><td>{c.nome}</td><td className="num">{n1(c.horas)}</td><td className="num">{kg(c.kg)}</td><td className="num">{n1(c.kgPorHH)}</td><td><Badge tone={toneMeta(c.pctMeta)}>{c.pctMeta !== undefined ? pct(c.pctMeta) : '—'}</Badge></td><td className="num">{c.dias}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {aba === 'romaneios' && (
        <div className="card table-wrap">
          {!romaneios.length ? <Empty icone="compras" titulo="Nenhum romaneio">Emita o romaneio da carga: os conjuntos passam a expedidos e o canteiro sabe o que vai chegar.</Empty> : (
            <table>
              <thead><tr><th>Romaneio</th><th>Obra</th><th>Data</th><th>Transportadora</th><th>Destino</th><th className="num">Peças</th><th className="num">Peso</th><th>Status</th><th /></tr></thead>
              <tbody>{romaneios.map((x) => (
                <tr key={x.id}>
                  <td><b>{x.numero}</b>{x.placa && <div className="muted small">{x.placa} · {x.motorista ?? ''}</div>}</td><td className="small">{x.codigoObra}</td><td>{d(x.data)}</td><td>{x.transportadora}</td><td className="small">{x.destino}</td>
                  <td className="num">{x.pecas}</td><td className="num"><b>{kg(x.pesoTotal)}</b></td>
                  <td><Badge tone={x.status === 'Entregue' ? 'ok' : x.status === 'Cancelado' ? 'bad' : 'info'}>{x.status}</Badge>{x.entregueEm && <div className="muted small">{d(x.entregueEm)}</div>}</td>
                  <td className="actions">
                    {podeApontar && x.status === 'Emitido' && <button className="btn sm" onClick={() => tentar(() => actions.atualizarRomaneio(x.id, { status: 'Entregue' }), toast, () => toast(`Romaneio ${x.numero} entregue.`))}>Entregue</button>}
                    {podeExcluir && x.status !== 'Cancelado' && <button className="btn sm" onClick={() => { const m = window.prompt(`Motivo do cancelamento do romaneio ${x.numero}:`); if (m) tentar(() => actions.atualizarRomaneio(x.id, { status: 'Cancelado', motivo: m }), toast, () => toast('Romaneio cancelado; conjuntos voltaram a não expedidos.')); }}>Cancelar</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
      {apontar && <ApontarForm inicial={apontar} onClose={() => setApontar(null)} onErro={toast} onOk={toast} />}
      {romaneio && <RomaneioForm inicial={romaneio} onClose={() => setRomaneio(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
