import React, { useState } from 'react';
import { NOME_SINAL, decisorDe, empresaSuprimida, sinalPrincipal, type Empresa } from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { Badge, Empty, Input, KpiStrip, Link, PageHead, Select, useToast } from '../../ui/components';
import { EmpresaForm, ImportarForm, ScoreModal, ScorePill, d } from './comum';
import { Tabela } from '../../ui/Tabela';
import { VistasSalvas } from '../../ui/vistas';

export default function RadarEmpresas({ query }: { query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const hoje = ds.params.dataBase;
  const [busca, setBusca] = useState(query.get('q') ?? '');
  const [classe, setClasse] = useState(query.get('classe') ?? '');
  const [uf, setUf] = useState('');
  const [setor, setSetor] = useState('');
  const [situacao, setSituacao] = useState('');
  const [ordem, setOrdem] = useState<'prioridade' | 'nome' | 'proxima' | 'sinal'>('prioridade');
  const [limite, setLimite] = useState(50);
  const [score, setScore] = useState<Empresa | null>(null);
  const [edit, setEdit] = useState<Empresa | null>(null);
  const [importar, setImportar] = useState(false);
  const podeAgir = pode(usuario, 'radar');
  const r = ds.radar;
  const todas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const ufs = [...new Set(todas.map((e) => e.uf).filter((x): x is string => !!x))].sort();
  const setores = [...new Set(todas.map((e) => e.setor).filter((x): x is string => !!x))].sort();
  const q = busca.trim().toLowerCase();
  let lista = todas.filter((e) => (!q || `${e.razaoSocial} ${e.nomeFantasia ?? ''} ${e.cnpj ?? ''} ${e.dominio ?? ''} ${e.cidade ?? ''}`.toLowerCase().includes(q)) && (!classe || e.priorityClass === classe) && (!uf || e.uf === uf) && (!setor || e.setor === setor));
  if (situacao === 'vencida') lista = lista.filter((e) => e.proximaAcaoEm && e.proximaAcaoEm.slice(0, 10) < hoje);
  if (situacao === 'sem-acao') lista = lista.filter((e) => !e.proximaAcaoEm);
  if (situacao === 'sem-decisor') lista = lista.filter((e) => !decisorDe(e.id, r)?.decisor);
  if (situacao === 'sinal-30') lista = lista.filter((e) => e.ultimoSinalEm && e.ultimoSinalEm >= new Date(new Date(hoje).getTime() - 30 * 86400000).toISOString().slice(0, 10));
  if (situacao === 'suprimida') lista = lista.filter((e) => empresaSuprimida(e.id, r));
  lista = lista.sort((a, b) => ordem === 'nome' ? a.razaoSocial.localeCompare(b.razaoSocial) : ordem === 'proxima' ? (a.proximaAcaoEm ?? '9') < (b.proximaAcaoEm ?? '9') ? -1 : 1 : ordem === 'sinal' ? (b.ultimoSinalEm ?? '') < (a.ultimoSinalEm ?? '') ? -1 : 1 : b.priorityScore - a.priorityScore);
  const n = (v: number) => Math.round(v);
  return (
    <>
      <PageHead title="Empresas" subtitle="Base de empresas do Radar com score por dimensão, sinal principal, decisor e próxima ação. Clique no score para ver os fatores.">
        {podeAgir && <button className="btn" onClick={() => setImportar(true)}>Importar CSV</button>}
        {podeAgir && <button className="btn primary" onClick={() => setEdit(actions.novaEmpresaRadar())}>+ Empresa</button>}
      </PageHead>
      <KpiStrip itens={[
        { label: 'Empresas', value: todas.length, hint: `${todas.filter((e) => e.priorityClass === 'A+').length} A+ · ${todas.filter((e) => e.priorityClass === 'A').length} A` },
        { label: 'Com decisor', value: todas.filter((e) => decisorDe(e.id, r)?.decisor).length },
        { label: 'Com sinal (30 d)', value: todas.filter((e) => e.ultimoSinalEm && e.ultimoSinalEm >= new Date(new Date(hoje).getTime() - 30 * 86400000).toISOString().slice(0, 10)).length },
        { label: 'Sem próxima ação', value: todas.filter((e) => !e.proximaAcaoEm).length },
        { label: 'Duplicatas pendentes', value: r.duplicatas.filter((x) => x.status === 'pendente').length, to: '/radar?aba=duplicatas' },
      ]} />
      <div style={{ height: 16 }} />
      <div className="card table-wrap">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Input placeholder="Buscar nome, CNPJ, domínio, cidade…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
          <Select value={classe} onChange={setClasse} options={['A+', 'A', 'B', 'C', 'D']} allowEmpty="Classe" />
          <Select value={uf} onChange={setUf} options={ufs} allowEmpty="UF" />
          <Select value={setor} onChange={setSetor} options={setores} allowEmpty="Setor" />
          <Select value={situacao} onChange={setSituacao} options={[{ value: 'vencida', label: 'Próxima ação vencida' }, { value: 'sem-acao', label: 'Sem próxima ação' }, { value: 'sem-decisor', label: 'Sem decisor' }, { value: 'sinal-30', label: 'Sinal nos últimos 30 dias' }, { value: 'suprimida', label: 'Não contatar' }]} allowEmpty="Situação" />
          <Select value={ordem} onChange={(v) => setOrdem(v as 'prioridade')} options={[{ value: 'prioridade', label: 'Ordenar: prioridade' }, { value: 'nome', label: 'Ordenar: nome' }, { value: 'proxima', label: 'Ordenar: próxima ação' }, { value: 'sinal', label: 'Ordenar: último sinal' }]} />
          <span className="small muted">{lista.length} de {todas.length}</span>
          <VistasSalvas tela="radar-empresas" filtros={{ busca, classe, uf, setor, situacao, ordem }} aplicar={(v) => { setBusca(v.busca); setClasse(v.classe); setUf(v.uf); setSetor(v.setor); setSituacao(v.situacao); setOrdem(v.ordem); }} ehPadrao={(v) => !v.busca && !v.classe && !v.uf && !v.setor && !v.situacao && v.ordem === 'prioridade'} />
        </div>
        {!lista.length ? <Empty icone="empresas" titulo={todas.length ? 'Nenhuma empresa com esses filtros' : 'Nenhuma empresa'}>{todas.length ? 'Ajuste os filtros.' : 'Importe uma base em CSV ou cadastre a primeira empresa.'}</Empty> : (
          <Tabela linhas={lista.slice(0, limite)} chave={(e) => e.id} altura="calc(100vh - 300px)" csv={{ nome: 'radar-empresas', cabecalho: ['Empresa', 'Razão social', 'CNPJ', 'Cidade', 'UF', 'Setor', 'Classe', 'Prioridade', 'Fit', 'Timing', 'Intenção', 'Último contato', 'Próxima ação'], linha: (e) => [e.nomeFantasia ?? e.razaoSocial, e.razaoSocial, e.cnpj, e.cidade, e.uf, e.setor, e.priorityClass, e.priorityScore, e.fitScore, e.timingScore, e.intentScore, e.ultimoContatoEm, e.proximaAcaoEm] }}
            colunas={[{ titulo: 'Empresa', ordenar: (e) => e.nomeFantasia ?? e.razaoSocial }, { titulo: 'Local', ordenar: (e) => [e.cidade, e.uf].filter(Boolean).join('/') || undefined }, { titulo: 'Setor', ordenar: (e) => e.setor }, { titulo: 'Prioridade', num: true, ordenar: (e) => e.priorityScore }, { titulo: 'Fit', num: true, ordenar: (e) => e.fitScore }, { titulo: 'Timing', num: true, ordenar: (e) => e.timingScore }, { titulo: 'Intenção', num: true, ordenar: (e) => e.intentScore }, { titulo: 'Sinal principal' }, { titulo: 'Decisor' }, { titulo: 'Último contato', ordenar: (e) => e.ultimoContatoEm }, { titulo: 'Próxima ação', ordenar: (e) => e.proximaAcaoEm }]}
            linha={(e) => { const s = sinalPrincipal(e.id, r, hoje); const dec = decisorDe(e.id, r); const venc = e.proximaAcaoEm && e.proximaAcaoEm.slice(0, 10) < hoje; return (
              <>
                <td><Link to={`/radar/empresas/${e.id}`}><b>{e.nomeFantasia ?? e.razaoSocial}</b></Link>{e.nomeFantasia && <div className="muted small">{e.razaoSocial}</div>}{empresaSuprimida(e.id, r) && <Badge tone="bad">não contatar</Badge>}</td>
                <td className="small">{[e.cidade, e.uf].filter(Boolean).join('/') || '—'}</td><td className="small">{e.setor ?? '—'}</td>
                <td className="num"><ScorePill e={e} onClick={() => setScore(e)} /></td><td className="num">{n(e.fitScore)}</td><td className="num">{n(e.timingScore)}</td><td className="num">{n(e.intentScore)}</td>
                <td className="small">{s ? `${NOME_SINAL[s.tipo]} · ${d(s.eventoEm)}` : '—'}</td>
                <td className="small">{dec ? `${dec.nome}${dec.decisor ? '' : ' (?)'}` : '—'}</td>
                <td className="small">{d(e.ultimoContatoEm)}</td>
                <td className={`small ${venc ? 'neg' : ''}`}>{d(e.proximaAcaoEm)}</td>
              </>
            ); }} />
        )}
        {lista.length > limite && <button className="btn" style={{ marginTop: 8 }} onClick={() => setLimite(limite + 50)}>Mostrar mais ({lista.length - limite})</button>}
      </div>
      {score && <ScoreModal e={score} onClose={() => setScore(null)} />}
      {edit && <EmpresaForm inicial={edit} onClose={() => setEdit(null)} onErro={toast} onOk={toast} />}
      {importar && <ImportarForm onClose={() => setImportar(false)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
