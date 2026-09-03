import React, { useState } from 'react';
import { TIPOS_OCORRENCIA, custoLinha, locaisDoDia } from '../core/equipe';
import type { Apontamento, ApontamentoLinha, LocalTrabalho, Presenca } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, Modal, Money, PageHead, Select, money, tentar, useToast } from '../ui/components';
import { navegar } from '../ui/router';

const PRESENCAS: Presenca[] = ['Presente', 'Falta', 'Atestado', 'Férias', 'Folga'];
const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

/** Escolha do dia e do local antes de abrir o diario. */
function NovoApontamento() {
  const { ds } = useStore();
  const [data, setData] = useState(ds.params.dataBase);
  const locais = locaisDoDia(ds, data);
  return (
    <>
      <PageHead title="Apontar o dia" subtitle="Escolha a data e o local. O diário abre com a equipe do local já preenchida." />
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="form"><Field label="Data"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field></div>
        {locais.length === 0 ? <Empty>Cadastre colaboradores em Equipe › Colaboradores para apontar.</Empty> : (
          <table style={{ marginTop: 12 }}><tbody>
            {locais.map((l) => (
              <tr key={l.rotulo}>
                <td><b>{l.rotulo}</b><div className="muted small">{l.colaboradores.length} colaborador(es)</div></td>
                <td>{l.apontamento ? <Badge tone={l.apontamento.status === 'Fechado' ? 'ok' : 'warn'}>{l.apontamento.status}</Badge> : <Badge tone="muted">não apontado</Badge>}</td>
                <td className="actions">
                  {l.apontamento ? <button className="btn sm" onClick={() => navegar(`/apontamentos/${l.apontamento!.id}`)}>Abrir</button> : (
                    <button className="btn sm primary" onClick={() => { const a = actions.novoApontamento(data, l.local, l.codigoObra); navegar(`/apontamentos/novo?data=${data}&local=${l.local}&obra=${l.codigoObra ?? ''}&id=${a.id}`); }}>Apontar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}

export default function ApontamentoTela({ id, query }: { id: string; query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const existente = ds.apontamentos.find((a) => a.id === id);
  const criando = id === 'novo' && query.get('local');
  const [a, setA] = useState<Apontamento | null>(() => existente ?? (criando ? actions.novoApontamento(query.get('data') ?? ds.params.dataBase, query.get('local') as LocalTrabalho, query.get('obra') || undefined) : null));
  const [reabrir, setReabrir] = useState<string | null>(null);
  if (id === 'novo' && !criando) return <NovoApontamento />;
  if (!a) return <Empty>Apontamento não encontrado.</Empty>;
  const fechado = a.status === 'Fechado';
  const podeEditar = pode(usuario, 'comentar', a.codigoObra) && (!fechado || pode(usuario, 'editar_obra'));
  const colabs = new Map(ds.colaboradores.map((c) => [c.id, c]));
  const servicos = ds.servicos.filter((s) => s.ativo && (a.local !== 'Obra' || s.codigoObra === a.codigoObra));
  const ordens = ds.ordens.filter((o) => !o.cancelada && (a.local !== 'Obra' || o.codigoObra === a.codigoObra) && (a.local !== 'Fábrica' || o.tipo === 'Fabricação'));
  const up = (p: Partial<Apontamento>) => setA({ ...a, ...p });
  const upLinha = (i: number, p: Partial<ApontamentoLinha>) => up({ linhas: a.linhas.map((l, j) => (j === i ? { ...l, ...p, ...(p.presenca && p.presenca !== 'Presente' ? { horas: 0, horasExtras: 0 } : {}) } : l)) });
  const presentes = a.linhas.filter((l) => l.presenca === 'Presente');
  const horas = presentes.reduce((s, l) => s + l.horas + l.horasExtras, 0);
  const custo = presentes.reduce((s, l) => s + custoLinha(l, colabs.get(l.colaboradorId)), 0);
  const foraDaEquipe = ds.colaboradores.filter((c) => c.ativo && !a.linhas.some((l) => l.colaboradorId === c.id));
  const salvar = (fechar: boolean) => tentar(() => { const novo = actions.salvarApontamento(a, fechar); setA(novo); if (id === 'novo') navegar(`/apontamentos/${novo.id}`); }, toast, () => toast(fechar ? 'Diário fechado.' : 'Diário salvo.'));

  return (
    <>
      <PageHead title={`Diário de ${a.local === 'Obra' ? `obra ${a.codigoObra}` : a.local.toLowerCase()} · ${d(a.data)}`} subtitle={<>{a.local === 'Obra' && ds.obras.find((o) => o.codigo === a.codigoObra)?.nome} · <Badge tone={fechado ? 'ok' : 'warn'}>{a.status}</Badge> · {a.responsavel}</>}>
        <button className="btn" onClick={() => navegar('/equipe/apontamentos')}>← Lista</button>
        {podeEditar && !fechado && <button className="btn" onClick={() => salvar(false)}>Salvar rascunho</button>}
        {podeEditar && !fechado && <button className="btn primary" onClick={() => salvar(true)}>Fechar o dia</button>}
        {fechado && pode(usuario, 'editar_obra') && <button className="btn danger" onClick={() => setReabrir('')}>Reabrir</button>}
      </PageHead>
      {fechado && <div className="alert ok">Diário fechado em {a.fechadoEm ? new Date(a.fechadoEm).toLocaleString('pt-BR') : ''}. Alterações exigem reabertura com motivo.</div>}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">Efetivo</div><div className="value">{presentes.length}/{a.linhas.length}</div><div className="hint">{a.linhas.filter((l) => l.presenca === 'Falta').length} falta(s)</div></div>
        <div className="kpi"><div className="label">Horas</div><div className="value">{Math.round(horas * 10) / 10} h</div><div className="hint">{Math.round(presentes.reduce((s, l) => s + l.horasExtras, 0) * 10) / 10} h extras</div></div>
        <div className="kpi"><div className="label">Custo do dia</div><div className="value">{pode(usuario, 'ver_bancos') ? money(custo) : '•••'}</div><div className="hint">HH × custo/hora</div></div>
        <div className="kpi"><div className="label">Produção</div><div className="value">{a.producao.reduce((s, p) => s + p.quantidade, 0) || '—'}</div><div className="hint">{a.producao.map((p) => `${p.quantidade} ${p.unidade}`).join(' · ')}</div></div>
      </div>

      <div className="card">
        <h2>Efetivo e horas</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Colaborador</th><th>Presença</th><th>Horas</th><th>Extras</th><th>Serviço</th><th>Ordem</th><th>Obs.</th><th /></tr></thead>
          <tbody>
            {a.linhas.map((l, i) => {
              const c = colabs.get(l.colaboradorId);
              return (
                <tr key={l.colaboradorId}>
                  <td><b>{c?.nome ?? l.colaboradorId}</b><div className="muted small">{c?.funcao} · {c?.equipe}</div></td>
                  <td><select disabled={!podeEditar} value={l.presenca} onChange={(e) => upLinha(i, { presenca: e.target.value as Presenca })}>{PRESENCAS.map((p) => <option key={p}>{p}</option>)}</select></td>
                  <td><input type="number" step="0.5" min={0} max={14} style={{ width: 70 }} disabled={!podeEditar || l.presenca !== 'Presente'} value={l.horas} onChange={(e) => upLinha(i, { horas: Number(e.target.value) })} /></td>
                  <td><input type="number" step="0.5" min={0} max={8} style={{ width: 70 }} disabled={!podeEditar || l.presenca !== 'Presente'} value={l.horasExtras} onChange={(e) => upLinha(i, { horasExtras: Number(e.target.value) })} /></td>
                  <td><select disabled={!podeEditar} value={l.servicoId ?? ''} onChange={(e) => upLinha(i, { servicoId: e.target.value || undefined })}><option value="">—</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nome}</option>)}</select></td>
                  <td><select disabled={!podeEditar} value={l.ordemId ?? ''} onChange={(e) => upLinha(i, { ordemId: e.target.value || undefined })}><option value="">—</option>{ordens.map((o) => <option key={o.id} value={o.id}>{o.codigo}</option>)}</select></td>
                  <td><input disabled={!podeEditar} value={l.observacao ?? ''} onChange={(e) => upLinha(i, { observacao: e.target.value || undefined })} style={{ width: 140 }} /></td>
                  <td>{podeEditar && <button className="btn sm" title="Remover do diário" onClick={() => up({ linhas: a.linhas.filter((_, j) => j !== i) })}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {podeEditar && foraDaEquipe.length > 0 && (
          <div className="actions" style={{ marginTop: 8 }}>
            <span className="muted small">Adicionar colaborador de outra equipe:</span>
            <Select value="" onChange={(v) => { const c = colabs.get(v); if (c) up({ linhas: [...a.linhas, { colaboradorId: c.id, presenca: 'Presente', horas: c.jornadaDiaria, horasExtras: 0 }] }); }} options={foraDaEquipe.map((c) => ({ value: c.id, label: `${c.nome} · ${c.funcao} · ${c.local}` }))} allowEmpty="+ colaborador" />
            <button className="btn sm" onClick={() => up({ linhas: a.linhas.map((l) => (l.presenca === 'Presente' ? { ...l, servicoId: servicos[0]?.id } : l)) })} disabled={!servicos.length}>Todos no serviço {servicos[0]?.codigo}</button>
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Produção do dia</h2>
          {a.producao.map((p, i) => (
            <div key={i} className="form" style={{ gridTemplateColumns: '2fr 1fr 1fr 2fr auto', marginBottom: 6 }}>
              <input disabled={!podeEditar} placeholder="descrição (ex.: pilares eixo A)" value={p.descricao} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />
              <input type="number" step="0.01" disabled={!podeEditar} value={p.quantidade} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, quantidade: Number(e.target.value) } : x)) })} />
              <select disabled={!podeEditar} value={p.unidade} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, unidade: e.target.value } : x)) })}>{['t', 'kg', 'pç', 'm²', 'm', 'un'].map((u) => <option key={u}>{u}</option>)}</select>
              <select disabled={!podeEditar} value={p.servicoId ?? ''} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, servicoId: e.target.value || undefined } : x)) })}><option value="">serviço —</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nome}</option>)}</select>
              {podeEditar && <button className="btn sm" onClick={() => up({ producao: a.producao.filter((_, j) => j !== i) })}>×</button>}
            </div>
          ))}
          {podeEditar && <button className="btn sm" onClick={() => up({ producao: [...a.producao, { descricao: '', quantidade: 0, unidade: a.local === 'Fábrica' ? 't' : 'pç', servicoId: servicos[0]?.id }] })}>+ Produção</button>}
        </div>
        <div className="card">
          <h2>Ocorrências</h2>
          {a.ocorrencias.map((o, i) => (
            <div key={i} className="form" style={{ gridTemplateColumns: '1.2fr 2fr 1fr auto', marginBottom: 6 }}>
              <select disabled={!podeEditar} value={o.tipo} onChange={(e) => up({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, tipo: e.target.value as typeof o.tipo } : x)) })}>{TIPOS_OCORRENCIA.map((t) => <option key={t}>{t}</option>)}</select>
              <input disabled={!podeEditar} placeholder="descrição" value={o.descricao} onChange={(e) => up({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />
              <input type="number" step="0.5" disabled={!podeEditar} placeholder="h perdidas" value={o.horasPerdidas} onChange={(e) => up({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, horasPerdidas: Number(e.target.value) } : x)) })} />
              {podeEditar && <button className="btn sm" onClick={() => up({ ocorrencias: a.ocorrencias.filter((_, j) => j !== i) })}>×</button>}
            </div>
          ))}
          {podeEditar && <button className="btn sm" onClick={() => up({ ocorrencias: [...a.ocorrencias, { tipo: 'Chuva', descricao: '', horasPerdidas: 0 }] })}>+ Ocorrência</button>}
          <div className="form" style={{ marginTop: 12 }}>
            <Field label="Clima"><Select value={a.clima ?? ''} onChange={(v) => up({ clima: v || undefined })} options={['Bom', 'Nublado', 'Chuva leve', 'Chuva forte', 'Impraticável']} allowEmpty="—" disabled={!podeEditar} /></Field>
            <Field label="Fotos / evidências (nomes ou links, um por linha)" full><textarea rows={2} disabled={!podeEditar} value={a.fotos.join('\n')} onChange={(e) => up({ fotos: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <Field label="Observações do dia" full><textarea rows={3} disabled={!podeEditar} value={a.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
          </div>
        </div>
      </div>
      {reabrir !== null && (
        <Modal title="Reabrir diário" onClose={() => setReabrir(null)}>
          <Field label="Motivo" req full><Input value={reabrir} onChange={(e) => setReabrir(e.target.value)} /></Field>
          <div className="foot"><button className="btn" onClick={() => setReabrir(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => { actions.reabrirApontamento(a.id, reabrir); setA({ ...a, status: 'Rascunho', fechadoEm: undefined }); }, toast, () => setReabrir(null))}>Reabrir</button></div>
        </Modal>
      )}
      {el}
      <span hidden><Money v={0} /></span>
    </>
  );
}
