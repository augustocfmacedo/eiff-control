import React, { useState } from 'react';
import type { Obra360 } from '../core/engine';
import { TIPOS_CONJUNTO, parseListaMateriais, type ConjuntoCalc, type ConjuntoImportado, type EtapaPeso } from '../core/materiais';
import type { Planilha } from '../core/sinapi';
import type { Conjunto, TipoConjunto } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, KpiHero, KpiStrip, Modal, NumberInput, ProgressRow, Select, tentar, type Tone } from '../ui/components';

const kg = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
const t = (v: number) => `${(v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
const pctF = (v: number) => `${Math.round(v * 100)}%`;
const toneSit = (s: ConjuntoCalc['situacao']): Tone => (({ 'Não liberado': 'muted', Liberado: 'info', 'Em fabricação': 'warn', Fabricado: 'info', Expedido: 'warn', Montado: 'ok' }) as Record<ConjuntoCalc['situacao'], Tone>)[s];
const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

async function lerArquivos(files: File[]): Promise<Planilha[]> {
  const XLSX = await import('xlsx');
  const out: Planilha[] = [];
  for (const f of files) {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    for (const aba of wb.SheetNames) out.push({ arquivo: f.name, aba, linhas: XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as Planilha['linhas'] });
  }
  return out;
}

function ImportarForm({ codigoObra, onClose, onErro, onOk }: { codigoObra: string; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [servicoId, setServico] = useState('');
  const [lista, setLista] = useState<ConjuntoImportado[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  const carregar = async (files: FileList | null) => {
    if (!files?.length) return;
    try { const r = parseListaMateriais(await lerArquivos([...files])); setLista(r.conjuntos); setAvisos(r.avisos); } catch (e) { onErro((e as Error).message); }
  };
  const colar = () => {
    // texto colado do Excel: colunas separadas por tabulacao, primeira linha = cabecalho
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
    const r = parseListaMateriais([{ arquivo: 'colado', aba: 'colado', linhas }]);
    setLista(r.conjuntos); setAvisos(r.avisos);
  };
  const peso = lista.reduce((a, c) => a + c.quantidade * c.pesoUnitario, 0);
  return (
    <Modal title="Importar lista de materiais" onClose={onClose} wide>
      <p className="small muted">Aceita a lista exportada do Tekla, SolidWorks ou Excel (xlsx/csv) ou o texto copiado da planilha. Colunas reconhecidas pelo cabeçalho: marca/conjunto, descrição, perfil, quantidade, peso unitário ou peso total, tipo e revisão. Marcas já existentes na obra são atualizadas; as demais, criadas.</p>
      <div className="form" style={{ marginTop: 10 }}>
        <Field label="Arquivo (.xlsx, .csv)"><input type="file" accept=".xlsx,.xls,.csv" multiple onChange={(e) => void carregar(e.target.files)} /></Field>
        <Field label="Serviço da obra" hint="Todos os conjuntos importados ficam ligados a este serviço"><Select value={servicoId} onChange={setServico} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="— sem serviço —" /></Field>
        <Field label="Ou cole o texto da planilha (com cabeçalho)" full><textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Marca\tDescrição\tPerfil\tQtd\tPeso unit.\nP-01\tPilar eixo A\tW 310x38,7\t8\t612,5'} /></Field>
      </div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={colar} disabled={!texto.trim()}>Ler texto colado</button></div>
      {avisos.map((a, i) => <div key={i} className="alert warn" style={{ marginTop: 8 }}>{a}</div>)}
      {lista.length > 0 && (
        <>
          <KpiStrip itens={[{ label: 'Conjuntos lidos', value: lista.length }, { label: 'Peças', value: lista.reduce((a, c) => a + c.quantidade, 0) }, { label: 'Peso total', value: t(peso) }, { label: 'Já na obra', value: lista.filter((c) => ds.conjuntos.some((x) => x.codigoObra === codigoObra && x.marca === c.marca)).length, hint: 'serão atualizados' }]} />
          <div className="table-wrap" style={{ maxHeight: '40vh', overflow: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th>Marca</th><th>Descrição</th><th>Perfil</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Peso unit.</th><th className="num">Peso total</th></tr></thead>
              <tbody>{lista.slice(0, 200).map((c) => <tr key={c.marca}><td><b>{c.marca}</b></td><td>{c.descricao}</td><td className="small">{c.perfil ?? ''}</td><td className="small">{c.tipo}</td><td className="num">{c.quantidade}</td><td className="num">{c.pesoUnitario.toLocaleString('pt-BR')}</td><td className="num">{kg(c.quantidade * c.pesoUnitario)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!lista.length} onClick={() => tentar(() => { const r = actions.importarConjuntos(lista, codigoObra, servicoId || undefined); onOk(`${r.novos} conjunto(s) novo(s), ${r.atualizados} atualizado(s) · ${t(r.pesoTotal)}.`); }, onErro, onClose)}>Importar {lista.length ? `${lista.length} conjunto(s)` : ''}</button>
      </div>
    </Modal>
  );
}

function ConjuntoForm({ conjunto, onClose, onErro }: { conjunto: Conjunto; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [c, setC] = useState(conjunto);
  const up = (p: Partial<Conjunto>) => setC({ ...c, ...p });
  const novo = !ds.conjuntos.some((x) => x.id === conjunto.id);
  return (
    <Modal title={novo ? 'Novo conjunto' : `Conjunto ${c.marca}`} onClose={onClose}>
      <div className="form">
        <Field label="Marca" req><Input value={c.marca} onChange={(e) => up({ marca: e.target.value.toUpperCase() })} placeholder="P-01" /></Field>
        <Field label="Tipo"><Select value={c.tipo} onChange={(v) => up({ tipo: v as TipoConjunto })} options={TIPOS_CONJUNTO} /></Field>
        <Field label="Serviço"><Select value={c.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === c.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
        <Field label="Descrição" full><Input value={c.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Perfil"><Input value={c.perfil ?? ''} onChange={(e) => up({ perfil: e.target.value || undefined })} placeholder="W 310x38,7" /></Field>
        <Field label="Quantidade (peças)" req><NumberInput value={c.quantidade} onChange={(v) => up({ quantidade: v })} /></Field>
        <Field label="Peso unitário (kg)" req><NumberInput value={c.pesoUnitario} step="0.001" onChange={(v) => up({ pesoUnitario: v })} /></Field>
        <Field label="Revisão de projeto"><Input value={c.revisao ?? ''} onChange={(e) => up({ revisao: e.target.value || undefined })} /></Field>
        <Field label="Liberado para fabricação em"><Input type="date" value={c.liberadoEm ?? ''} onChange={(e) => up({ liberadoEm: e.target.value || undefined })} /></Field>
        <Field label="Fabricado (peças)"><NumberInput value={c.fabricadoQtd} onChange={(v) => up({ fabricadoQtd: v })} /></Field>
        <Field label="Expedido (peças)"><NumberInput value={c.expedidoQtd} onChange={(v) => up({ expedidoQtd: v })} /></Field>
        <Field label="Montado (peças)"><NumberInput value={c.montadoQtd} onChange={(v) => up({ montadoQtd: v })} /></Field>
        <Field label="Observações" full><Input value={c.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot">
        {!novo && c.fabricadoQtd === 0 && <button className="btn danger" onClick={() => tentar(() => actions.excluirConjunto(c.id), onErro, onClose)}>Excluir</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={() => tentar(() => actions.salvarConjunto(c), onErro, onClose)}>Salvar</button>
      </div>
    </Modal>
  );
}

function ApontarForm({ conjuntos, etapa, onClose, onErro, onOk }: { conjuntos: ConjuntoCalc[]; etapa: EtapaPeso; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [data, setData] = useState(ds.params.dataBase);
  const [obs, setObs] = useState('');
  const campo = etapa === 'fabricado' ? 'fabricadoQtd' : etapa === 'expedido' ? 'expedidoQtd' : 'montadoQtd';
  const [q, setQ] = useState<Record<string, number>>(Object.fromEntries(conjuntos.map((c) => [c.id, etapa === 'liberado' ? 0 : Math.max(0, c.quantidade - c[campo])])));
  const titulo = { liberado: 'Liberar para fabricação', fabricado: 'Apontar fabricação', expedido: 'Apontar expedição', montado: 'Apontar montagem' }[etapa];
  return (
    <Modal title={`${titulo} · ${conjuntos.length} conjunto(s)`} onClose={onClose}>
      <div className="form">
        <Field label="Data" req><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Observação"><Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="lote, romaneio, frente de montagem" /></Field>
      </div>
      {etapa !== 'liberado' && (
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Marca</th><th>Descrição</th><th className="num">Total</th><th className="num">Já apontado</th><th className="num">Agora</th></tr></thead>
          <tbody>{conjuntos.map((c) => <tr key={c.id}><td><b>{c.marca}</b></td><td className="small">{c.descricao}</td><td className="num">{c.quantidade}</td><td className="num">{c[campo]}</td><td className="num"><input type="number" min={0} value={q[c.id] ?? 0} onChange={(e) => setQ({ ...q, [c.id]: Number(e.target.value) })} style={{ width: 90, textAlign: 'right' }} /></td></tr>)}</tbody>
        </table>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.apontarConjuntos(conjuntos.map((c) => ({ id: c.id, etapa, quantidade: etapa === 'liberado' ? undefined : q[c.id] })), data, obs); onOk(etapa === 'liberado' ? `${conjuntos.length} conjunto(s) liberado(s).` : `${kg(r.pesoApontado)} apontados como ${etapa}.`); }, onErro, onClose)}>Confirmar</button></div>
    </Modal>
  );
}

export function MateriaisTab({ o, onErro, onOk }: { o: Obra360; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [importar, setImportar] = useState(false);
  const [edit, setEdit] = useState<Conjunto | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [apontar, setApontar] = useState<EtapaPeso | null>(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [servico, setServico] = useState('');
  const r = o.peso;
  const lista = r.conjuntos.filter((c) => (!tipo || c.tipo === tipo) && (!servico || c.servicoId === servico) && (!busca || `${c.marca} ${c.descricao} ${c.perfil ?? ''}`.toLowerCase().includes(busca.toLowerCase())));
  const podeEditar = pode(usuario, 'editar_etc', o.obra.codigo);
  const podeApontar = pode(usuario, 'comentar', o.obra.codigo);
  const selecionados = lista.filter((c) => sel.has(c.id));
  const alternar = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setSel(s); };
  const nomeServ = (id?: string) => { const s = id ? ds.servicos.find((x) => x.id === id) : undefined; return s ? s.codigo : '—'; };
  return (
    <>
      {r.conjuntos.length === 0 ? (
        <Empty icone="central" titulo="Sem lista de materiais">Importe a lista de conjuntos (marcas) com peso, ou cadastre manualmente. O avanço físico da obra passa a ser medido em quilos.</Empty>
      ) : (
        <div className="hero-grid" style={{ marginBottom: 14 }}>
          <KpiHero label="Peso montado" value={t(r.pesoMontado)} sufixo={`${pctF(r.pctMontado)} de ${t(r.pesoTotal)}`} hint={`${r.conjuntos.length} conjunto(s) · ${r.pecas.toLocaleString('pt-BR')} peça(s) · em fábrica ${t(r.emFabrica)} · em canteiro ${t(r.emCanteiro)}`} tone={r.pctMontado >= 1 ? 'ok' : undefined}
            secundarios={[{ label: 'Liberado', value: pctF(r.pctLiberado) }, { label: 'Fabricado', value: pctF(r.pctFabricado) }, { label: 'Expedido', value: pctF(r.pctExpedido) }, { label: 'Montado', value: pctF(r.pctMontado), tone: 'pos' }]}>
            <ProgressRow label="Liberado p/ fabricação" valor={r.pctLiberado} texto={t(r.pesoLiberado)} />
            <ProgressRow label="Fabricado" valor={r.pctFabricado} texto={t(r.pesoFabricado)} />
            <ProgressRow label="Expedido" valor={r.pctExpedido} texto={t(r.pesoExpedido)} />
            <ProgressRow label="Montado" valor={r.pctMontado} texto={t(r.pesoMontado)} tone="ok" />
          </KpiHero>
          <KpiHero label="Por tipo de conjunto" value={r.porTipo.length} sufixo="tipo(s)" hint="barra = montado sobre o total de cada tipo">
            {r.porTipo.slice(0, 6).map((x) => <ProgressRow key={x.tipo} label={x.tipo} valor={x.pesoTotal ? x.pesoMontado / x.pesoTotal : 0} texto={t(x.pesoTotal)} />)}
          </KpiHero>
        </div>
      )}
      <div className="actions" style={{ marginBottom: 10 }}>
        <Input placeholder="Buscar marca, descrição, perfil…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        <Select value={tipo} onChange={setTipo} options={TIPOS_CONJUNTO} allowEmpty="Todos os tipos" />
        <Select value={servico} onChange={setServico} options={ds.servicos.filter((s) => s.codigoObra === o.obra.codigo && s.ativo).map((s) => ({ value: s.id, label: s.codigo }))} allowEmpty="Todos os serviços" />
        <span className="muted small">{lista.length} de {r.conjuntos.length} · {sel.size} selecionado(s)</span>
        <span className="spacer" style={{ flex: 1 }} />
        {podeApontar && sel.size > 0 && (['liberado', 'fabricado', 'expedido', 'montado'] as EtapaPeso[]).map((e) => <button key={e} className="btn sm" onClick={() => setApontar(e)}>{{ liberado: 'Liberar', fabricado: 'Fabricar', expedido: 'Expedir', montado: 'Montar' }[e]}</button>)}
        {podeEditar && <button className="btn" onClick={() => setImportar(true)}>Importar lista</button>}
        {podeEditar && <button className="btn primary" onClick={() => setEdit(actions.novoConjunto(o.obra.codigo, servico || undefined))}>+ Conjunto</button>}
      </div>
      {r.conjuntos.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th><input type="checkbox" checked={lista.length > 0 && lista.every((c) => sel.has(c.id))} onChange={(e) => setSel(e.target.checked ? new Set(lista.map((c) => c.id)) : new Set())} /></th><th>Marca</th><th>Descrição</th><th>Tipo</th><th>Serviço</th><th className="num">Qtd</th><th className="num">Peso unit.</th><th className="num">Peso total</th><th>Liberado</th><th className="num">Fab.</th><th className="num">Exp.</th><th className="num">Mont.</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.slice(0, 500).map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
                  <td><b>{c.marca}</b>{c.revisao && <span className="muted small"> r{c.revisao}</span>}</td>
                  <td>{c.descricao}{c.perfil && <div className="muted small">{c.perfil}</div>}</td>
                  <td className="small">{c.tipo}</td><td className="small">{nomeServ(c.servicoId)}</td>
                  <td className="num">{c.quantidade}</td><td className="num">{c.pesoUnitario.toLocaleString('pt-BR')}</td><td className="num"><b>{kg(c.pesoTotal)}</b></td>
                  <td className="small">{d(c.liberadoEm)}</td>
                  <td className="num">{c.fabricadoQtd}</td><td className="num">{c.expedidoQtd}</td><td className="num">{c.montadoQtd}</td>
                  <td><Badge tone={toneSit(c.situacao)}>{c.situacao}</Badge></td>
                  <td>{podeEditar && <button className="btn sm" onClick={() => setEdit(c)}>Editar</button>}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={7}>Total ({lista.length})</td><td className="num">{kg(lista.reduce((a, c) => a + c.pesoTotal, 0))}</td><td /><td className="num">{kg(lista.reduce((a, c) => a + c.pesoFabricado, 0))}</td><td className="num">{kg(lista.reduce((a, c) => a + c.pesoExpedido, 0))}</td><td className="num">{kg(lista.reduce((a, c) => a + c.pesoMontado, 0))}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      )}
      {importar && <ImportarForm codigoObra={o.obra.codigo} onClose={() => setImportar(false)} onErro={onErro} onOk={onOk} />}
      {edit && <ConjuntoForm conjunto={edit} onClose={() => setEdit(null)} onErro={onErro} />}
      {apontar && <ApontarForm conjuntos={selecionados} etapa={apontar} onClose={() => { setApontar(null); setSel(new Set()); }} onErro={onErro} onOk={onOk} />}
    </>
  );
}
