import React, { useMemo, useState } from 'react';
import { Calculadora, TIPOS_INSUMO, calcOrcamento, type CurvaAbcItem, type OrcamentoCalc } from '../core/orcamentos';
import { UFS, detectarUfs, parseSinapi, selecionarComDependencias, type CatalogoImportado, type Planilha } from '../core/sinapi';
import type { Composicao, Insumo, ItemComposicao, ItemOrcamento, Orcamento, OrigemCatalogo, StatusOrcamento, TipoInsumo } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, Kpi, Link, Modal, Money, NumberInput, PageHead, Select, Tabs, money, pct, tentar, useToast, type Tone } from '../ui/components';
import { navegar } from '../ui/router';

const ORIGENS: OrigemCatalogo[] = ['SINAPI', 'TCPO', 'Própria'];
const STATUS: StatusOrcamento[] = ['Rascunho', 'Enviado', 'Aprovado', 'Contratado', 'Perdido', 'Cancelado'];
const toneStatus = (s: StatusOrcamento): Tone => (({ Rascunho: 'muted', Enviado: 'info', Aprovado: 'ok', Contratado: 'ok', Perdido: 'bad', Cancelado: 'bad' }) as Record<StatusOrcamento, Tone>)[s];
const toneAbc = (c: 'A' | 'B' | 'C'): Tone => (c === 'A' ? 'bad' : c === 'B' ? 'warn' : 'muted');
const n4 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
const n2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const normaliza = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const casa = (texto: string, busca: string) => { const t = normaliza(texto); return normaliza(busca).split(/\s+/).filter(Boolean).every((p) => t.includes(p)); };

// ---------------------------------------------------------------------------
// Seletor de insumo/composicao (busca no catalogo)
// ---------------------------------------------------------------------------
function SeletorCatalogo({ tipo, onPick, onClose, excluir }: { tipo: 'Insumo' | 'Composição' | 'ambos'; onPick: (t: 'Insumo' | 'Composição', id: string) => void; onClose: () => void; excluir?: string }) {
  const { ds } = useStore();
  const [busca, setBusca] = useState('');
  const calc = useMemo(() => new Calculadora(ds), [ds]);
  const insumos = tipo === 'Composição' ? [] : ds.insumos.filter((i) => i.ativo && (!busca || casa(`${i.codigo} ${i.descricao}`, busca))).slice(0, 60);
  const comps = tipo === 'Insumo' ? [] : ds.composicoes.filter((c) => c.ativo && c.id !== excluir && (!busca || casa(`${c.codigo} ${c.descricao} ${c.grupo}`, busca))).slice(0, 60);
  return (
    <Modal title={tipo === 'Insumo' ? 'Escolher insumo' : tipo === 'Composição' ? 'Escolher composição' : 'Escolher insumo ou composição'} onClose={onClose} wide>
      <Input autoFocus placeholder="Buscar por código, descrição ou grupo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto', marginTop: 10 }}>
        <table>
          <thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th>Origem</th><th className="num">Custo unit.</th><th /></tr></thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.id}>
                <td><Badge tone="info">Composição</Badge></td><td>{c.codigo}</td><td>{c.descricao}<div className="muted small">{c.grupo}</div></td><td>{c.unidade}</td><td className="small">{c.origem}</td>
                <td className="num">{n2(calc.custo(c.id).custoUnitario)}</td><td><button className="btn sm primary" onClick={() => onPick('Composição', c.id)}>Usar</button></td>
              </tr>
            ))}
            {insumos.map((i) => (
              <tr key={i.id}>
                <td><Badge>{i.tipo}</Badge></td><td>{i.codigo}</td><td>{i.descricao}</td><td>{i.unidade}</td><td className="small">{i.origem}</td>
                <td className="num">{n2(i.preco)}</td><td><button className="btn sm primary" onClick={() => onPick('Insumo', i.id)}>Usar</button></td>
              </tr>
            ))}
            {!comps.length && !insumos.length && <tr><td colSpan={7} className="empty">Nada encontrado. Importe o SINAPI ou cadastre insumos e composições.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------
function InsumoForm({ insumo, onClose, onErro }: { insumo: Insumo; onClose: () => void; onErro: (m: string) => void }) {
  const [i, setI] = useState(insumo);
  const up = (p: Partial<Insumo>) => setI({ ...i, ...p });
  return (
    <Modal title={insumo.descricao ? `Insumo ${insumo.codigo}` : 'Novo insumo'} onClose={onClose}>
      <div className="form">
        <Field label="Código" req><Input value={i.codigo} onChange={(e) => up({ codigo: e.target.value })} /></Field>
        <Field label="Origem"><Select value={i.origem} onChange={(v) => up({ origem: v as OrigemCatalogo })} options={ORIGENS} /></Field>
        <Field label="Tipo"><Select value={i.tipo} onChange={(v) => up({ tipo: v as TipoInsumo })} options={TIPOS_INSUMO} /></Field>
        <Field label="Descrição" req full><Input value={i.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Unidade"><Input value={i.unidade} onChange={(e) => up({ unidade: e.target.value })} /></Field>
        <Field label="Preço unitário"><NumberInput value={i.preco} step="0.0001" onChange={(v) => up({ preco: v })} /></Field>
        <Field label="Data do preço"><Input type="date" value={i.precoData ?? ''} onChange={(e) => up({ precoData: e.target.value || undefined })} /></Field>
        <Field label="Fonte do preço" hint="Cotação, compra (PAG-xxxx) ou referência"><Input value={i.precoFonte ?? ''} onChange={(e) => up({ precoFonte: e.target.value || undefined })} /></Field>
        <Field label="Classe/grupo"><Input value={i.classe ?? ''} onChange={(e) => up({ classe: e.target.value || undefined })} /></Field>
        <Field label="Ativo"><Select value={i.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><Input value={i.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarInsumo(i), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

function InsumosTab({ onErro }: { onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [origem, setOrigem] = useState('');
  const [edit, setEdit] = useState<Insumo | null>(null);
  const lista = ds.insumos.filter((i) => (!tipo || i.tipo === tipo) && (!origem || i.origem === origem) && (!busca || casa(`${i.codigo} ${i.descricao} ${i.classe ?? ''}`, busca)));
  const podeEditar = pode(usuario, 'orcar');
  return (
    <div className="card table-wrap">
      <div className="actions" style={{ marginBottom: 10 }}>
        <Input placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
        <Select value={tipo} onChange={setTipo} options={TIPOS_INSUMO} allowEmpty="Todos os tipos" />
        <Select value={origem} onChange={setOrigem} options={ORIGENS} allowEmpty="Todas as origens" />
        <span className="muted small">{lista.length} de {ds.insumos.length}</span>
        <span className="spacer" />
        {podeEditar && <button className="btn primary" onClick={() => setEdit(actions.novoInsumo())}>Novo insumo</button>}
      </div>
      {ds.insumos.length === 0 ? <Empty>Catálogo vazio. Importe a planilha do SINAPI na aba "Importar SINAPI" ou cadastre insumos próprios.</Empty> : (
        <table>
          <thead><tr><th>Código</th><th>Descrição</th><th>Unid.</th><th>Tipo</th><th>Origem</th><th className="num">Preço</th><th>Referência</th><th /></tr></thead>
          <tbody>
            {lista.slice(0, 300).map((i) => (
              <tr key={i.id} style={i.ativo ? undefined : { opacity: 0.5 }}>
                <td>{i.codigo}</td><td>{i.descricao}{i.classe && <div className="muted small">{i.classe}</div>}</td><td>{i.unidade}</td><td><Badge>{i.tipo}</Badge></td><td className="small">{i.origem}</td>
                <td className="num">{n2(i.preco)}</td><td className="small muted">{i.precoFonte ?? ''}{i.precoData ? ` · ${d(i.precoData)}` : ''}</td>
                <td>{podeEditar && <button className="btn sm" onClick={() => setEdit(i)}>Editar</button>}</td>
              </tr>
            ))}
            {lista.length > 300 && <tr><td colSpan={8} className="muted small">Mostrando 300 de {lista.length}. Refine a busca.</td></tr>}
          </tbody>
        </table>
      )}
      {edit && <InsumoForm insumo={edit} onClose={() => setEdit(null)} onErro={onErro} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composicoes
// ---------------------------------------------------------------------------
function ComposicaoForm({ composicao, onClose, onErro }: { composicao: Composicao; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [c, setC] = useState(composicao);
  const [pick, setPick] = useState(false);
  const calc = useMemo(() => new Calculadora(ds), [ds]);
  const up = (p: Partial<Composicao>) => setC({ ...c, ...p });
  const nomeRef = (it: ItemComposicao) => (it.tipo === 'Insumo' ? calc.getInsumo(it.refId) : calc.getComposicao(it.refId));
  const precoRef = (it: ItemComposicao) => (it.tipo === 'Insumo' ? calc.getInsumo(it.refId)?.preco ?? 0 : calc.custo(it.refId).custoUnitario);
  const total = c.itens.reduce((a, it) => a + it.coeficiente * precoRef(it), 0);
  const setItem = (idx: number, p: Partial<ItemComposicao>) => up({ itens: c.itens.map((it, i) => (i === idx ? { ...it, ...p } : it)) });
  return (
    <Modal title={ds.composicoes.some((x) => x.id === c.id) ? `Composição ${c.codigo}` : 'Nova composição própria'} onClose={onClose} wide>
      <div className="form">
        <Field label="Código" req><Input value={c.codigo} onChange={(e) => up({ codigo: e.target.value })} /></Field>
        <Field label="Origem"><Select value={c.origem} onChange={(v) => up({ origem: v as OrigemCatalogo })} options={ORIGENS} /></Field>
        <Field label="Unidade"><Input value={c.unidade} onChange={(e) => up({ unidade: e.target.value })} /></Field>
        <Field label="Descrição" req full><Input value={c.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Grupo"><Input value={c.grupo} onChange={(e) => up({ grupo: e.target.value })} /></Field>
        <Field label="Ativa"><Select value={c.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><Input value={c.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <h3 style={{ marginTop: 14 }}>Itens (por {c.unidade || 'unidade'})</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="num">Coeficiente</th><th className="num">Preço/custo unit.</th><th className="num">Custo</th><th /></tr></thead>
          <tbody>
            {c.itens.map((it, idx) => {
              const ref = nomeRef(it);
              return (
                <tr key={idx}>
                  <td><Badge tone={it.tipo === 'Composição' ? 'info' : 'muted'}>{it.tipo}</Badge></td><td>{ref?.codigo ?? '?'}</td><td>{ref?.descricao ?? '(não encontrado)'}</td><td>{ref?.unidade}</td>
                  <td className="num"><input type="number" step="0.000001" value={it.coeficiente} onChange={(e) => setItem(idx, { coeficiente: Number(e.target.value) })} style={{ width: 110, textAlign: 'right' }} /></td>
                  <td className="num">{n2(precoRef(it))}</td><td className="num">{n2(it.coeficiente * precoRef(it))}</td>
                  <td><button className="btn sm" onClick={() => up({ itens: c.itens.filter((_, i) => i !== idx) })}>Remover</button></td>
                </tr>
              );
            })}
            <tr><td colSpan={6}><b>Custo unitário</b></td><td className="num"><b>{n2(total)}</b></td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => setPick(true)}>Adicionar insumo ou composição</button></div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarComposicao(c), onErro, onClose)}>Salvar</button></div>
      {pick && <SeletorCatalogo tipo="ambos" excluir={c.id} onClose={() => setPick(false)} onPick={(tipo, id) => { up({ itens: [...c.itens, { tipo, refId: id, coeficiente: 1 }] }); setPick(false); }} />}
    </Modal>
  );
}

function ComposicaoDetalhe({ composicao, onClose, onEditar, onCopiar }: { composicao: Composicao; onClose: () => void; onEditar?: () => void; onCopiar?: () => void }) {
  const { ds } = useStore();
  const calc = useMemo(() => new Calculadora(ds), [ds]);
  const r = calc.custo(composicao.id);
  return (
    <Modal title={`${composicao.codigo} · ${composicao.descricao}`} onClose={onClose} wide>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <Kpi label={`Custo unitário (${composicao.unidade})`} value={money(r.custoUnitario)} hint={`${composicao.origem} · ${composicao.grupo}`} />
        <Kpi label="Material" value={money(r.porTipo.Material)} hint={pct(r.custoUnitario ? r.porTipo.Material / r.custoUnitario : 0)} />
        <Kpi label="Mão de obra" value={money(r.porTipo['Mão de obra'])} hint={pct(r.custoUnitario ? r.porTipo['Mão de obra'] / r.custoUnitario : 0)} />
        <Kpi label="Equipamento e serviços" value={money(r.porTipo.Equipamento + r.porTipo.Serviço + r.porTipo.Outros)} tone={r.faltantes.length || r.ciclo ? 'bad' : undefined} hint={r.faltantes.length ? `${r.faltantes.length} item(ns) não encontrado(s)` : r.ciclo ? 'ciclo detectado' : undefined} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="num">Coef.</th><th className="num">Preço unit.</th><th className="num">Custo</th></tr></thead>
          <tbody>
            {composicao.itens.map((it, idx) => {
              const ref = it.tipo === 'Insumo' ? calc.getInsumo(it.refId) : calc.getComposicao(it.refId);
              const preco = it.tipo === 'Insumo' ? calc.getInsumo(it.refId)?.preco ?? 0 : calc.custo(it.refId).custoUnitario;
              return <tr key={idx}><td><Badge tone={it.tipo === 'Composição' ? 'info' : 'muted'}>{it.tipo === 'Insumo' ? calc.getInsumo(it.refId)?.tipo ?? 'Insumo' : 'Composição'}</Badge></td><td>{ref?.codigo ?? it.refId}</td><td>{ref?.descricao ?? '(não encontrado)'}</td><td>{ref?.unidade}</td><td className="num">{n4(it.coeficiente)}</td><td className="num">{n2(preco)}</td><td className="num">{n2(it.coeficiente * preco)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {r.insumos.size > 0 && composicao.itens.some((it) => it.tipo === 'Composição') && (
        <>
          <h3 style={{ marginTop: 14 }}>Insumos explodidos (por {composicao.unidade})</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Insumo</th><th>Unid.</th><th className="num">Quantidade</th><th className="num">Preço</th><th className="num">Custo</th></tr></thead>
              <tbody>{[...r.insumos].map(([id, q]) => { const i = calc.getInsumo(id); return <tr key={id}><td>{i?.codigo}</td><td>{i?.descricao}</td><td>{i?.unidade}</td><td className="num">{n4(q)}</td><td className="num">{n2(i?.preco ?? 0)}</td><td className="num">{n2(q * (i?.preco ?? 0))}</td></tr>; })}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="foot">
        {onCopiar && <button className="btn" onClick={onCopiar}>Copiar como composição própria</button>}
        {onEditar && <button className="btn" onClick={onEditar}>Editar</button>}
        <button className="btn primary" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

function ComposicoesTab({ onErro }: { onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [origem, setOrigem] = useState('');
  const [ver, setVer] = useState<Composicao | null>(null);
  const [edit, setEdit] = useState<Composicao | null>(null);
  const calc = useMemo(() => new Calculadora(ds), [ds]);
  const grupos = [...new Set(ds.composicoes.map((c) => c.grupo).filter(Boolean))].sort();
  const lista = ds.composicoes.filter((c) => (!grupo || c.grupo === grupo) && (!origem || c.origem === origem) && (!busca || casa(`${c.codigo} ${c.descricao} ${c.grupo}`, busca)));
  const podeEditar = pode(usuario, 'orcar');
  return (
    <div className="card table-wrap">
      <div className="actions" style={{ marginBottom: 10 }}>
        <Input placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
        <Select value={grupo} onChange={setGrupo} options={grupos} allowEmpty="Todos os grupos" />
        <Select value={origem} onChange={setOrigem} options={ORIGENS} allowEmpty="Todas as origens" />
        <span className="muted small">{lista.length} de {ds.composicoes.length}</span>
        <span className="spacer" />
        {podeEditar && <button className="btn primary" onClick={() => setEdit(actions.novaComposicao())}>Nova composição própria</button>}
      </div>
      {ds.composicoes.length === 0 ? <Empty>Nenhuma composição. Importe o SINAPI ou crie composições próprias com a produtividade da EIFF.</Empty> : (
        <table>
          <thead><tr><th>Código</th><th>Descrição</th><th>Grupo</th><th>Unid.</th><th>Origem</th><th className="num">Itens</th><th className="num">Custo unit.</th><th /></tr></thead>
          <tbody>
            {lista.slice(0, 300).map((c) => {
              const r = calc.custo(c.id);
              return (
                <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.5 }}>
                  <td>{c.codigo}</td><td><a href="#" onClick={(e) => { e.preventDefault(); setVer(c); }}>{c.descricao}</a></td><td className="small">{c.grupo}</td><td>{c.unidade}</td><td className="small">{c.origem}</td>
                  <td className="num">{c.itens.length}</td><td className={`num ${r.faltantes.length || r.ciclo ? 'neg' : ''}`}>{n2(r.custoUnitario)}</td>
                  <td className="actions">{podeEditar && c.origem === 'Própria' && <button className="btn sm" onClick={() => setEdit(c)}>Editar</button>}{podeEditar && <button className="btn sm" onClick={() => setEdit(actions.novaComposicao(c))}>Copiar</button>}</td>
                </tr>
              );
            })}
            {lista.length > 300 && <tr><td colSpan={8} className="muted small">Mostrando 300 de {lista.length}. Refine a busca.</td></tr>}
          </tbody>
        </table>
      )}
      {ver && <ComposicaoDetalhe composicao={ver} onClose={() => setVer(null)} onEditar={podeEditar && ver.origem === 'Própria' ? () => { setEdit(ver); setVer(null); } : undefined} onCopiar={podeEditar ? () => { setEdit(actions.novaComposicao(ver)); setVer(null); } : undefined} />}
      {edit && <ComposicaoForm composicao={edit} onClose={() => setEdit(null)} onErro={onErro} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Importacao SINAPI
// ---------------------------------------------------------------------------
async function lerPlanilhas(files: File[]): Promise<Planilha[]> {
  const XLSX = await import('xlsx');
  const out: Planilha[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) throw new Error(`${f.name}: descompacte o arquivo .zip e selecione a planilha .xlsx.`);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
    for (const aba of wb.SheetNames) {
      const ws = wb.Sheets[aba];
      out.push({ arquivo: f.name, aba, linhas: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Planilha['linhas'] });
    }
  }
  return out;
}

function ImportarTab({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [planilhas, setPlanilhas] = useState<Planilha[]>([]);
  const [uf, setUf] = useState('GO');
  const [desonerado, setDesonerado] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ufs = useMemo(() => detectarUfs(planilhas), [planilhas]);
  const cat: CatalogoImportado | null = useMemo(() => (planilhas.length ? parseSinapi(planilhas, { uf: ufs.includes(uf) ? uf : ufs[0] ?? uf, desonerado }) : null), [planilhas, uf, desonerado, ufs]);
  const jaTem = new Set(ds.composicoes.filter((c) => c.origem === 'SINAPI').map((c) => c.codigo));
  const grupos = cat ? [...new Set(cat.composicoes.map((c) => c.grupo).filter(Boolean))].sort() : [];
  const lista = cat ? cat.composicoes.filter((c) => (!grupo || c.grupo === grupo) && (!busca || casa(`${c.codigo} ${c.descricao} ${c.grupo}`, busca))) : [];
  const podeEditar = pode(usuario, 'orcar');

  const carregar = async (files: FileList | null) => {
    if (!files?.length) return;
    setLendo(true);
    try { setPlanilhas(await lerPlanilhas([...files])); setSel(new Set()); } catch (e) { onErro((e as Error).message); } finally { setLendo(false); }
  };
  const importar = (codigos: string[], soInsumos = false) => {
    if (!cat) return;
    const recorte = soInsumos ? { insumos: cat.insumos, composicoes: [] } : selecionarComDependencias(cat, codigos);
    tentar(() => {
      const r = actions.importarCatalogo(recorte, 'SINAPI', cat.referencia, cat.competencia ? `${cat.competencia}-01` : undefined);
      onOk(`${cat.referencia}: ${r.insumosNovos} insumo(s) novo(s), ${r.insumosAtualizados} atualizado(s); ${r.composicoesNovas} composição(ões) nova(s), ${r.composicoesAtualizadas} atualizada(s).`);
      setSel(new Set());
    }, onErro);
  };
  const alternar = (cod: string) => { const s = new Set(sel); if (s.has(cod)) s.delete(cod); else s.add(cod); setSel(s); };

  return (
    <>
      <div className="card">
        <h2>Planilha de referência do SINAPI</h2>
        <p className="small muted">Baixe em caixa.gov.br › Downloads › SINAPI a planilha de referência do mês (formato xlsx; descompacte o zip). O arquivo unificado traz insumos, composições sintéticas e o analítico com preços por UF. No formato antigo, selecione juntos o arquivo de insumos e o de composições analítico da sua UF. Os dados da Caixa são públicos; a TCPO (PINI) não pode ser carregada sem licença.</p>
        <div className="form" style={{ marginTop: 10 }}>
          <Field label="Arquivos (.xlsx)" full><input type="file" accept=".xlsx,.xls,.xlsm" multiple onChange={(e) => void carregar(e.target.files)} disabled={!podeEditar} /></Field>
          <Field label="UF de referência"><Select value={ufs.includes(uf) ? uf : ufs[0] ?? uf} onChange={setUf} options={ufs.length ? ufs : UFS} /></Field>
          <Field label="Encargos"><Select value={desonerado ? 'Desonerado' : 'Não desonerado'} onChange={(v) => setDesonerado(v === 'Desonerado')} options={['Não desonerado', 'Desonerado']} /></Field>
        </div>
        {lendo && <div className="alert info" style={{ marginTop: 10 }}>Lendo a planilha… arquivos grandes levam alguns segundos.</div>}
        {cat && (
          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <Kpi label="Referência" value={cat.referencia} />
            <Kpi label="Insumos lidos" value={cat.insumos.length} hint={`${cat.insumos.filter((i) => i.preco > 0).length} com preço`} />
            <Kpi label="Composições lidas" value={cat.composicoes.length} hint={`${cat.composicoes.filter((c) => c.itens.length).length} com itens`} />
            <Kpi label="Já no catálogo" value={cat.composicoes.filter((c) => jaTem.has(c.codigo)).length} hint="serão atualizadas na importação" />
          </div>
        )}
        {cat?.avisos.map((a, i) => <div key={i} className="alert warn" style={{ marginTop: 8 }}>{a}</div>)}
      </div>
      {cat && cat.composicoes.length > 0 && (
        <div className="card table-wrap">
          <div className="actions" style={{ marginBottom: 10 }}>
            <Input placeholder="Buscar composição (ex.: estrutura metálica, perfil, solda)…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 320 }} />
            <Select value={grupo} onChange={setGrupo} options={grupos} allowEmpty="Todos os grupos" />
            <span className="muted small">{lista.length} composição(ões) · {sel.size} selecionada(s)</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setSel(new Set([...sel, ...lista.map((c) => c.codigo)]))}>Selecionar filtradas</button>
            <button className="btn primary" disabled={!sel.size || !podeEditar} onClick={() => importar([...sel])}>Importar selecionadas + dependências</button>
            <button className="btn" disabled={!podeEditar} onClick={() => { if (window.confirm(`Importar todos os ${cat.insumos.length} insumos (só preços, sem composições)?`)) importar([], true); }}>Só atualizar preços dos insumos</button>
          </div>
          <table>
            <thead><tr><th /><th>Código</th><th>Descrição</th><th>Grupo</th><th>Unid.</th><th className="num">Itens</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.slice(0, 400).map((c) => (
                <tr key={c.codigo}>
                  <td><input type="checkbox" checked={sel.has(c.codigo)} onChange={() => alternar(c.codigo)} /></td>
                  <td>{c.codigo}</td><td>{c.descricao}</td><td className="small">{c.grupo}</td><td>{c.unidade}</td><td className="num">{c.itens.length}</td>
                  <td>{jaTem.has(c.codigo) ? <Badge tone="info">no catálogo</Badge> : <Badge>nova</Badge>}</td>
                </tr>
              ))}
              {lista.length > 400 && <tr><td colSpan={7} className="muted small">Mostrando 400 de {lista.length}. Refine a busca ou o grupo.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Orcamento (detalhe)
// ---------------------------------------------------------------------------
function CurvaAbc({ itens, titulo }: { itens: CurvaAbcItem[]; titulo: string }) {
  const total = itens.reduce((a, i) => a + i.valor, 0);
  const porClasse = (['A', 'B', 'C'] as const).map((c) => ({ classe: c, n: itens.filter((i) => i.classe === c).length, valor: itens.filter((i) => i.classe === c).reduce((a, i) => a + i.valor, 0) }));
  return (
    <div className="card table-wrap">
      <h2>{titulo}</h2>
      <div className="grid cols-3" style={{ marginBottom: 12 }}>
        {porClasse.map((k) => <Kpi key={k.classe} label={`Classe ${k.classe} · ${k.classe === 'A' ? 'até 80%' : k.classe === 'B' ? '80–95%' : 'acima de 95%'}`} value={`${k.n} item(ns)`} hint={`${money(k.valor)} · ${pct(total ? k.valor / total : 0)}`} tone={k.classe === 'A' ? 'bad' : k.classe === 'B' ? 'warn' : undefined} />)}
      </div>
      {itens.length === 0 ? <Empty>Sem dados: vincule composições aos itens do orçamento.</Empty> : (
        <table>
          <thead><tr><th>#</th><th>Classe</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="num">Quantidade</th><th className="num">Preço unit.</th><th className="num">Valor</th><th className="num">%</th><th style={{ minWidth: 160 }}>Acumulado</th></tr></thead>
          <tbody>
            {itens.map((i, idx) => (
              <tr key={i.id}>
                <td className="muted small">{idx + 1}</td><td><Badge tone={toneAbc(i.classe)}>{i.classe}</Badge></td><td>{i.codigo}</td><td>{i.descricao}{i.tipo && <span className="muted small"> · {i.tipo}</span>}</td><td>{i.unidade}</td>
                <td className="num">{n4(i.quantidade)}</td><td className="num">{n2(i.precoUnitario)}</td><td className="num"><b>{money(i.valor)}</b></td><td className="num">{pct(i.pct)}</td>
                <td><div className="progress"><i style={{ width: `${i.acumulado * 100}%`, background: i.classe === 'A' ? 'var(--bad)' : i.classe === 'B' ? 'var(--warn)' : 'var(--primary-2)' }} /></div><span className="small muted">{pct(i.acumulado)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ContratarForm({ o, onClose, onErro, onOk }: { o: OrcamentoCalc; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const obras = obrasVisiveis(usuario, ds.obras).filter((x) => x.status !== 'Cancelada' && x.status !== 'Concluída');
  const [codigoObra, setObra] = useState(o.codigoObra ?? obras[0]?.codigo ?? '');
  const [ajustar, setAjustar] = useState(true);
  const obra = ds.obras.find((x) => x.codigo === codigoObra);
  const contrato = obra ? obra.valorContrato + obra.aditivos : 0;
  return (
    <Modal title="Contratar orçamento → serviços da obra" onClose={onClose}>
      <p className="small muted">Cada item vira um serviço da obra com custo orçado (custo direto das composições) e preço de venda (com BDI). O custo orçado da obra passa a ser a soma dos itens, substituindo a projeção por margem alvo. Os itens do orçamento ficam congelados.</p>
      <div className="form" style={{ marginTop: 10 }}>
        <Field label="Obra" req full><Select value={codigoObra} onChange={setObra} options={obras.map((x) => ({ value: x.codigo, label: `${x.codigo} · ${x.nome}` }))} allowEmpty="— escolha —" /></Field>
        {obra && Math.abs(contrato - o.precoTotal) > 0.5 && (
          <Field label="Valor do contrato difere do preço do orçamento" full hint={`Contrato ${money(contrato)} × orçamento ${money(o.precoTotal)}`}>
            <label className="small"><input type="checkbox" checked={ajustar} onChange={(e) => setAjustar(e.target.checked)} /> Redistribuir os preços de venda para fechar no valor do contrato (custo orçado mantido)</label>
          </Field>
        )}
      </div>
      {!obras.length && <div className="alert warn" style={{ marginTop: 8 }}>Nenhuma obra ativa. Cadastre a obra em <Link to="/obras">Obras e contratos</Link> e volte aqui.</div>}
      <div className="grid cols-3" style={{ marginTop: 10 }}>
        <Kpi label="Serviços a criar" value={o.itens.filter((i) => i.quantidade > 0).length} />
        <Kpi label="Custo orçado total" value={money(o.custoTotal)} />
        <Kpi label="Preço de venda" value={money(ajustar && obra && Math.abs(contrato - o.precoTotal) > 0.5 ? contrato : o.precoTotal)} hint={`margem ${pct(o.precoTotal ? 1 - o.custoTotal / (ajustar && obra && contrato ? contrato : o.precoTotal) : 0)}`} />
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!codigoObra} onClick={() => tentar(() => { const r = actions.contratarOrcamento(o.id, { codigoObra, ajustarAoContrato: ajustar }); onOk(`${r.servicos.length} serviço(s) criado(s) na obra ${codigoObra}.`); }, onErro, onClose)}>Contratar</button></div>
    </Modal>
  );
}

function OrcamentoDetalhe({ id, onErro, onOk }: { id: string; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const salvo = ds.orcamentos.find((x) => x.id === id);
  const [rascunho, setRascunho] = useState<Orcamento | null>(null);
  const [aba, setAba] = useState<'itens' | 'insumos' | 'abcItens' | 'resumo'>('itens');
  const [pick, setPick] = useState<number | null>(null);
  const [contratar, setContratar] = useState(false);
  const o = rascunho ?? salvo;
  if (!o) return <Empty>Orçamento não encontrado. <Link to="/orcamentos">Voltar</Link></Empty>;
  const calc = calcOrcamento(o, ds);
  const podeEditar = pode(usuario, 'orcar') && o.status !== 'Contratado';
  const alterado = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(salvo);
  const up = (p: Partial<Orcamento>) => setRascunho({ ...o, ...p });
  const setItem = (idx: number, p: Partial<ItemOrcamento>) => up({ itens: o.itens.map((it, i) => (i === idx ? { ...it, ...p } : it)) });
  const addItem = () => up({ itens: [...o.itens, { id: `IT-${Date.now().toString(36)}-${o.itens.length + 1}`, ordem: o.itens.length + 1, etapa: o.itens[o.itens.length - 1]?.etapa ?? '', codigo: `${o.itens.length + 1}`, descricao: '', unidade: 'un', quantidade: 0 }] });
  const mover = (idx: number, dir: -1 | 1) => { const itens = [...o.itens]; const j = idx + dir; if (j < 0 || j >= itens.length) return; [itens[idx], itens[j]] = [itens[j], itens[idx]]; up({ itens }); };
  const salvar = () => tentar(() => { actions.salvarOrcamento(o); }, onErro, () => { setRascunho(null); onOk('Orçamento salvo.'); });
  const obra = o.codigoObra ? ds.obras.find((x) => x.codigo === o.codigoObra) : undefined;

  return (
    <>
      <PageHead title={`${o.codigo} · ${o.titulo || 'Novo orçamento'}`} subtitle={<><Badge tone={toneStatus(o.status)}>{o.status}</Badge> {o.cliente && <>· {o.cliente}</>} {obra && <>· <Link to={`/obras/${obra.codigo}`}>{obra.codigo}</Link></>} {o.referenciaPrecos && <>· preços {o.referenciaPrecos}</>}</>}>
        <Link to="/orcamentos" className="btn">Voltar</Link>
        {podeEditar && <button className="btn primary" onClick={salvar} disabled={!alterado && !!salvo}>{salvo ? 'Salvar alterações' : 'Salvar'}</button>}
        {salvo && o.status !== 'Contratado' && pode(usuario, 'orcar') && <button className="btn" disabled={alterado} title={alterado ? 'Salve antes de contratar' : ''} onClick={() => setContratar(true)}>Contratar → serviços da obra</button>}
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Custo direto" value={money(calc.custoTotal)} hint={`${calc.itens.length} item(ns)${calc.semCusto ? ` · ${calc.semCusto} sem custo` : ''}`} tone={calc.semCusto || calc.incompletos ? 'warn' : undefined} />
        <Kpi label={calc.itens.some((i) => i.precoInformado) ? `Margem sobre a venda (${pct(calc.pctMargem)})` : `BDI ${pct(o.bdi)}`} value={money(calc.margem)} tone={calc.custoTotal > 0 && calc.margem < 0 ? 'bad' : undefined} hint={calc.itens.some((i) => i.precoInformado) ? `${calc.itens.filter((i) => i.precoInformado).length} item(ns) com preço de venda informado` : undefined} />
        <Kpi label="Preço de venda" value={money(calc.precoTotal)} hint={obra ? `contrato ${money(obra.valorContrato + obra.aditivos)}` : undefined} />
        <Kpi label="Material / MO / Equip." value={`${pct(calc.custoTotal ? calc.porTipo.Material / calc.custoTotal : 0)} / ${pct(calc.custoTotal ? calc.porTipo['Mão de obra'] / calc.custoTotal : 0)} / ${pct(calc.custoTotal ? calc.porTipo.Equipamento / calc.custoTotal : 0)}`} hint={`serviços/outros ${pct(calc.custoTotal ? (calc.porTipo.Serviço + calc.porTipo.Outros) / calc.custoTotal : 0)}`} />
      </div>
      <div className="card">
        <div className="form">
          <Field label="Título" req full><Input value={o.titulo} onChange={(e) => up({ titulo: e.target.value })} disabled={!podeEditar} /></Field>
          <Field label="Cliente"><Input value={o.cliente} onChange={(e) => up({ cliente: e.target.value })} disabled={!podeEditar} /></Field>
          <Field label="Obra vinculada"><Select value={o.codigoObra ?? ''} onChange={(v) => up({ codigoObra: v || undefined })} options={obrasVisiveis(usuario, ds.obras).map((x) => ({ value: x.codigo, label: `${x.codigo} · ${x.nome}` }))} allowEmpty="—" disabled={o.status === 'Contratado'} /></Field>
          <Field label="Status"><Select value={o.status} onChange={(v) => up({ status: v as StatusOrcamento })} options={STATUS.filter((s) => s !== 'Contratado' || o.status === 'Contratado')} disabled={o.status === 'Contratado'} /></Field>
          <Field label="Data"><Input type="date" value={o.data} onChange={(e) => up({ data: e.target.value })} disabled={!podeEditar} /></Field>
          <Field label="Validade"><Input type="date" value={o.validade ?? ''} onChange={(e) => up({ validade: e.target.value || undefined })} disabled={!podeEditar} /></Field>
          <Field label="BDI (%)" hint="Preço = custo direto × (1 + BDI)"><input type="number" step="0.1" value={Math.round(o.bdi * 10000) / 100} onChange={(e) => up({ bdi: Number(e.target.value) / 100 })} disabled={!podeEditar} /></Field>
          <Field label="Referência de preços"><Input value={o.referenciaPrecos} onChange={(e) => up({ referenciaPrecos: e.target.value })} placeholder="ex.: SINAPI GO 07/2026" disabled={!podeEditar} /></Field>
          <Field label="Observações" full><Input value={o.observacoes} onChange={(e) => up({ observacoes: e.target.value })} disabled={!podeEditar} /></Field>
        </div>
      </div>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'itens', label: `Itens (${o.itens.length})` }, { id: 'insumos', label: 'Curva ABC de insumos' }, { id: 'abcItens', label: 'Curva ABC de itens' }, { id: 'resumo', label: 'Resumo por etapa e tipo' }]} />

      {aba === 'itens' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th style={{ width: 60 }} /><th>Etapa</th><th>Item</th><th style={{ minWidth: 260 }}>Descrição</th><th>Unid.</th><th className="num">Quantidade</th><th>Composição</th><th className="num">Custo unit.</th><th className="num">Custo total</th><th className="num">Preço unit.</th><th className="num">Preço total</th><th /></tr></thead>
            <tbody>
              {calc.itens.map((it, idx) => (
                <tr key={it.id} style={it.incompleto ? { background: 'rgba(245, 158, 11, 0.08)' } : undefined}>
                  <td className="small">{podeEditar && <><button className="btn sm" onClick={() => mover(idx, -1)} title="Subir">↑</button><button className="btn sm" onClick={() => mover(idx, 1)} title="Descer">↓</button></>}</td>
                  <td><input value={it.etapa} onChange={(e) => setItem(idx, { etapa: e.target.value })} disabled={!podeEditar} style={{ width: 120 }} list="etapas-orc" /></td>
                  <td><input value={it.codigo} onChange={(e) => setItem(idx, { codigo: e.target.value })} disabled={!podeEditar} style={{ width: 70 }} /></td>
                  <td><input value={it.descricao} onChange={(e) => setItem(idx, { descricao: e.target.value })} disabled={!podeEditar} style={{ width: '100%' }} />{it.servicoId && <div className="small muted">serviço <b>{ds.servicos.find((s) => s.id === it.servicoId)?.codigo ?? ''}</b></div>}</td>
                  <td><input value={it.unidade} onChange={(e) => setItem(idx, { unidade: e.target.value })} disabled={!podeEditar} style={{ width: 55 }} /></td>
                  <td className="num"><input type="number" step="0.0001" value={it.quantidade} onChange={(e) => setItem(idx, { quantidade: Number(e.target.value) })} disabled={!podeEditar} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td className="small">
                    {it.composicao ? <><b>{it.composicao.codigo}</b> <span className="muted">{it.composicao.descricao.slice(0, 50)}{it.composicao.descricao.length > 50 ? '…' : ''}</span></> : it.origemCusto === 'Manual' ? <span className="muted">custo manual</span> : <span className="neg">sem custo</span>}
                    {podeEditar && <div className="actions" style={{ marginTop: 4 }}><button className="btn sm" onClick={() => setPick(idx)}>{it.composicao ? 'Trocar' : 'Vincular'}</button>{it.composicaoId && <button className="btn sm" onClick={() => setItem(idx, { composicaoId: undefined })}>Desvincular</button>}</div>}
                  </td>
                  <td className="num">{it.composicaoId ? n2(it.custoUnitario) : <input type="number" step="0.01" value={it.custoUnitarioManual ?? ''} placeholder="manual" onChange={(e) => setItem(idx, { custoUnitarioManual: e.target.value === '' ? undefined : Number(e.target.value) })} disabled={!podeEditar} style={{ width: 100, textAlign: 'right' }} />}</td>
                  <td className="num"><b>{money(it.custoTotal)}</b></td>
                  <td className="num"><input type="number" step="0.0001" value={it.precoUnitarioVenda ?? ''} placeholder={n2(it.precoUnitario)} title="Vazio = custo × (1 + BDI); preenchido = preço de venda informado" onChange={(e) => setItem(idx, { precoUnitarioVenda: e.target.value === '' ? undefined : Number(e.target.value) })} disabled={!podeEditar} style={{ width: 110, textAlign: 'right' }} /></td>
                  <td className="num">{money(it.precoTotal)}{it.custoTotal > 0 && <div className={`small ${it.margem < 0 ? 'neg' : 'muted'}`}>margem {pct(it.pctMargem)}</div>}</td>
                  <td>{podeEditar && <button className="btn sm" onClick={() => up({ itens: o.itens.filter((_, i) => i !== idx) })}>✕</button>}</td>
                </tr>
              ))}
              {calc.itens.length === 0 && <tr><td colSpan={12} className="empty">Sem itens. Adicione os serviços da proposta e vincule cada um a uma composição.</td></tr>}
              <tr><td colSpan={8}><b>Totais</b></td><td className="num"><b>{money(calc.custoTotal)}</b></td><td /><td className="num"><b>{money(calc.precoTotal)}</b></td><td /></tr>
            </tbody>
          </table>
          <datalist id="etapas-orc">{['Projeto', 'Fabricação', 'Montagem', 'Pintura', 'Cobertura e fechamento', 'Civil', 'Instalações', 'Mobilização', 'Outros'].map((e) => <option key={e} value={e} />)}</datalist>
          {podeEditar && <div className="actions" style={{ marginTop: 10 }}><button className="btn" onClick={addItem}>Adicionar item</button>{alterado && <span className="small muted">Alterações não salvas.</span>}</div>}
        </div>
      )}
      {aba === 'insumos' && <CurvaAbc itens={calc.curvaInsumos} titulo="Curva ABC de insumos (explosão das composições × quantidades)" />}
      {aba === 'abcItens' && <CurvaAbc itens={calc.curvaItens} titulo="Curva ABC de itens do orçamento (custo direto)" />}
      {aba === 'resumo' && calc.porServico.length > 0 && (
        <div className="card table-wrap" style={{ marginBottom: 16 }}>
          <h2>Por serviço da obra</h2>
          <table>
            <thead><tr><th>Serviço</th><th className="num">Itens</th><th className="num">Custo direto</th><th className="num">Preço de venda</th><th className="num">Margem</th><th className="num">Base do serviço</th></tr></thead>
            <tbody>{calc.porServico.map((s) => { const sv = ds.servicos.find((x) => x.id === s.servicoId); return <tr key={s.servicoId}><td>{sv ? <Link to={`/obras/${sv.codigoObra}`}><b>{sv.codigo}</b> {sv.nome}</Link> : s.servicoId}</td><td className="num">{s.itens}</td><td className="num">{money(s.custo)}</td><td className="num">{money(s.preco)}</td><td className={`num ${s.custo > 0 && s.preco - s.custo < 0 ? 'neg' : ''}`}>{s.custo > 0 ? `${money(s.preco - s.custo)} (${pct(s.preco ? (s.preco - s.custo) / s.preco : 0)})` : '—'}</td><td className="num">{sv?.valorBaseOrcamento !== undefined ? money(sv.valorBaseOrcamento) : '—'}</td></tr>; })}</tbody>
          </table>
        </div>
      )}
      {aba === 'resumo' && (
        <div className="grid cols-2">
          <div className="card table-wrap">
            <h2>Por etapa</h2>
            <table>
              <thead><tr><th>Etapa</th><th className="num">Itens</th><th className="num">Custo</th><th className="num">%</th><th className="num">Preço</th></tr></thead>
              <tbody>{calc.porEtapa.map((e) => <tr key={e.etapa}><td>{e.etapa}</td><td className="num">{e.itens}</td><td className="num">{money(e.custo)}</td><td className="num">{pct(e.pct)}</td><td className="num">{money(e.preco)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="card table-wrap">
            <h2>Por tipo de insumo</h2>
            <table>
              <thead><tr><th>Tipo</th><th className="num">Custo</th><th className="num">%</th><th style={{ minWidth: 140 }} /></tr></thead>
              <tbody>{TIPOS_INSUMO.map((t) => <tr key={t}><td>{t}</td><td className="num">{money(calc.porTipo[t])}</td><td className="num">{pct(calc.custoTotal ? calc.porTipo[t] / calc.custoTotal : 0)}</td><td><div className="progress"><i style={{ width: `${calc.custoTotal ? (calc.porTipo[t] / calc.custoTotal) * 100 : 0}%` }} /></div></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      {pick !== null && <SeletorCatalogo tipo="Composição" onClose={() => setPick(null)} onPick={(_, cid) => { const c = ds.composicoes.find((x) => x.id === cid); setItem(pick, { composicaoId: cid, unidade: o.itens[pick].unidade || c?.unidade || 'un', descricao: o.itens[pick].descricao || c?.descricao || '' }); setPick(null); }} />}
      {contratar && <ContratarForm o={calc} onClose={() => setContratar(false)} onErro={onErro} onOk={onOk} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Lista de orcamentos e pagina
// ---------------------------------------------------------------------------
function OrcamentosTab({ onErro }: { onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const lista = [...ds.orcamentos].sort((a, b) => (a.data < b.data ? 1 : -1)).map((o) => calcOrcamento(o, ds));
  return (
    <div className="card table-wrap">
      <div className="actions" style={{ marginBottom: 10 }}>
        <span className="muted small">{lista.length} orçamento(s)</span>
        <span className="spacer" />
        {pode(usuario, 'orcar') && <button className="btn primary" onClick={() => tentar(() => { const o = actions.salvarOrcamento({ ...actions.novoOrcamento(), titulo: 'Novo orçamento' }); navegar(`/orcamentos/${o.id}`); }, onErro)}>Novo orçamento</button>}
      </div>
      {lista.length === 0 ? <Empty>Nenhum orçamento. Crie o primeiro e monte os itens com as composições do catálogo.</Empty> : (
        <table>
          <thead><tr><th>Código</th><th>Título</th><th>Cliente</th><th>Obra</th><th>Data</th><th>Status</th><th className="num">Itens</th><th className="num">Custo direto</th><th className="num">BDI</th><th className="num">Preço de venda</th></tr></thead>
          <tbody>
            {lista.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/orcamentos/${o.id}`}><b>{o.codigo}</b></Link></td><td>{o.titulo}</td><td className="small">{o.cliente}</td><td className="small">{o.codigoObra ? <Link to={`/obras/${o.codigoObra}`}>{o.codigoObra}</Link> : '—'}</td><td className="small">{d(o.data)}</td>
                <td><Badge tone={toneStatus(o.status)}>{o.status}</Badge></td><td className="num">{o.itens.length}{o.semCusto ? <span className="neg small"> ({o.semCusto} s/ custo)</span> : null}</td>
                <td className="num"><Money v={o.custoTotal} compact /></td><td className="num">{pct(o.bdi)}</td><td className="num"><b><Money v={o.precoTotal} compact /></b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Orcamentos({ id, aba0 }: { id?: string; aba0?: string }) {
  const { ds } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'orcamentos' | 'composicoes' | 'insumos' | 'importar'>((['orcamentos', 'composicoes', 'insumos', 'importar'].includes(aba0 ?? '') ? aba0 : 'orcamentos') as 'orcamentos');
  if (id && id !== 'composicoes' && id !== 'insumos' && id !== 'importar') return <><OrcamentoDetalhe id={id} onErro={toast} onOk={toast} />{el}</>;
  const abertos = ds.orcamentos.filter((o) => o.status === 'Rascunho' || o.status === 'Enviado' || o.status === 'Aprovado');
  return (
    <>
      <PageHead title="Orçamentos e composições" subtitle="Catálogo de insumos e composições (SINAPI, TCPO ou próprias), propostas com BDI e curva ABC, e conversão do orçamento contratado em serviços da obra com custo orçado." />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Orçamentos em aberto" value={abertos.length} hint={`${ds.orcamentos.filter((o) => o.status === 'Contratado').length} contratado(s)`} />
        <Kpi label="Composições" value={ds.composicoes.length} hint={`${ds.composicoes.filter((c) => c.origem === 'Própria').length} própria(s) · ${ds.composicoes.filter((c) => c.origem === 'SINAPI').length} SINAPI`} />
        <Kpi label="Insumos" value={ds.insumos.length} hint={`${ds.insumos.filter((i) => i.tipo === 'Mão de obra').length} de mão de obra`} />
        <Kpi label="Referência de preços" value={ds.insumos.find((i) => i.origem === 'SINAPI')?.precoFonte ?? '—'} hint={ds.insumos.length ? `última data ${d([...ds.insumos].map((i) => i.precoData ?? '').sort().pop())}` : 'importe o SINAPI'} />
      </div>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'orcamentos', label: `Orçamentos (${ds.orcamentos.length})` }, { id: 'composicoes', label: `Composições (${ds.composicoes.length})` }, { id: 'insumos', label: `Insumos (${ds.insumos.length})` }, { id: 'importar', label: 'Importar SINAPI' }]} />
      {aba === 'orcamentos' && <OrcamentosTab onErro={toast} />}
      {aba === 'composicoes' && <ComposicoesTab onErro={toast} />}
      {aba === 'insumos' && <InsumosTab onErro={toast} />}
      {aba === 'importar' && <ImportarTab onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
