import React, { useMemo, useState } from 'react';
import { addDays, startOfMonth } from '../core/engine';
import { FUNCOES_PADRAO, STATUS_TAREFA, calcTarefas, locaisDoDia, resumoEquipe } from '../core/equipe';
import type { Colaborador, LocalTrabalho, Tarefa, Vinculo } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, Kpi, Link, Modal, Money, NumberInput, PageHead, Select, Tabs, money, pct, tentar, useToast, type Tone } from '../ui/components';
import { navegar } from '../ui/router';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const h = (n: number) => `${Math.round(n * 10) / 10} h`;

export function ColaboradorForm({ colaborador, onClose, onErro }: { colaborador: Colaborador; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [c, setC] = useState<Colaborador>(colaborador);
  const up = (p: Partial<Colaborador>) => setC({ ...c, ...p });
  const equipes = [...new Set(ds.colaboradores.map((x) => x.equipe).filter(Boolean))];
  return (
    <Modal title={c.nome ? c.nome : 'Novo colaborador'} onClose={onClose}>
      <div className="form">
        <Field label="Nome" req full><Input value={c.nome} onChange={(e) => up({ nome: e.target.value })} /></Field>
        <Field label="Função" req><Input list="funcoes" value={c.funcao} onChange={(e) => up({ funcao: e.target.value })} /><datalist id="funcoes">{FUNCOES_PADRAO.map((f) => <option key={f} value={f} />)}</datalist></Field>
        <Field label="Vínculo"><Select value={c.vinculo} onChange={(v) => up({ vinculo: v as Vinculo })} options={['CLT', 'Terceiro', 'Sócio', 'Estagiário', 'Temporário']} /></Field>
        <Field label="Equipe"><Input list="equipes" value={c.equipe} onChange={(e) => up({ equipe: e.target.value })} placeholder="ex.: Montagem A, Fábrica - Solda" /><datalist id="equipes">{equipes.map((f) => <option key={f} value={f} />)}</datalist></Field>
        <Field label="Local padrão"><Select value={c.local} onChange={(v) => up({ local: v as LocalTrabalho })} options={['Obra', 'Fábrica', 'Escritório']} /></Field>
        {c.local === 'Obra' && <Field label="Obra padrão" hint="Vazio = qualquer obra"><Select value={c.codigoObraPadrao ?? ''} onChange={(v) => up({ codigoObraPadrao: v || undefined })} options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— qualquer —" /></Field>}
        <Field label="Custo / hora (R$)" hint="Salário + encargos ÷ horas do mês"><NumberInput value={c.custoHora} onChange={(v) => up({ custoHora: v })} /></Field>
        <Field label="Jornada diária (h)"><NumberInput value={c.jornadaDiaria} onChange={(v) => up({ jornadaDiaria: v })} /></Field>
        <Field label="Telefone"><Input value={c.telefone ?? ''} onChange={(e) => up({ telefone: e.target.value || undefined })} /></Field>
        <Field label="Admissão"><Input type="date" value={c.admissao ?? ''} onChange={(e) => up({ admissao: e.target.value || undefined })} /></Field>
        <Field label="Login no sistema" hint="Opcional: liga o colaborador a um usuário"><Select value={c.usuarioId ?? ''} onChange={(v) => up({ usuarioId: v || undefined })} options={ds.usuarios.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty="— sem login —" /></Field>
        <Field label="Ativo"><Select value={c.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><textarea rows={2} value={c.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarColaborador(c), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

export function TarefaForm({ tarefa, onClose, onErro }: { tarefa: Tarefa; onClose: () => void; onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [t, setT] = useState<Tarefa>(tarefa);
  const up = (p: Partial<Tarefa>) => setT({ ...t, ...p });
  return (
    <Modal title={t.titulo ? `Tarefa · ${t.titulo}` : 'Nova tarefa'} onClose={onClose}>
      <div className="form">
        <Field label="Título" req full><Input value={t.titulo} onChange={(e) => up({ titulo: e.target.value })} /></Field>
        <Field label="Descrição / critério de pronto" full><textarea rows={2} value={t.descricao ?? ''} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Executor (colaborador)"><Select value={t.colaboradorId ?? ''} onChange={(v) => up({ colaboradorId: v || undefined })} options={ds.colaboradores.filter((c) => c.ativo).map((c) => ({ value: c.id, label: `${c.nome} · ${c.funcao}` }))} allowEmpty="—" /></Field>
        <Field label="Responsável (usuário)"><Select value={t.responsavel} onChange={(v) => up({ responsavel: v })} options={ds.usuarios.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty="—" /></Field>
        <Field label="Local"><Select value={t.local ?? ''} onChange={(v) => up({ local: (v || undefined) as LocalTrabalho | undefined })} options={['Obra', 'Fábrica', 'Escritório']} allowEmpty="—" /></Field>
        <Field label="Obra"><Select value={t.codigoObra ?? ''} onChange={(v) => up({ codigoObra: v || undefined, servicoId: undefined })} options={obrasVisiveis(usuario, ds.obras).map((o) => ({ value: o.codigo, label: o.codigo }))} allowEmpty="—" /></Field>
        <Field label="Serviço"><Select value={t.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.ativo && (!t.codigoObra || s.codigoObra === t.codigoObra)).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
        <Field label="Ordem de produção"><Select value={t.ordemId ?? ''} onChange={(v) => up({ ordemId: v || undefined })} options={ds.ordens.filter((o) => !o.cancelada && (!t.codigoObra || o.codigoObra === t.codigoObra)).map((o) => ({ value: o.id, label: `${o.codigo} · ${o.descricao}` }))} allowEmpty="—" /></Field>
        <Field label="Prioridade"><Select value={t.prioridade ?? 'Normal'} onChange={(v) => up({ prioridade: v as Tarefa['prioridade'] })} options={['Alta', 'Normal', 'Baixa']} /></Field>
        <Field label="Prazo" req><Input type="date" value={t.prazo} onChange={(e) => up({ prazo: e.target.value })} /></Field>
        <Field label="Status"><Select value={t.status} onChange={(v) => up({ status: v as Tarefa['status'] })} options={STATUS_TAREFA} /></Field>
        {t.status === 'Bloqueada' && <Field label="Motivo do bloqueio" req full><Input value={t.bloqueio ?? ''} onChange={(e) => up({ bloqueio: e.target.value })} /></Field>}
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarTarefa(t), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

export default function Equipe({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'painel' | 'apontamentos' | 'tarefas' | 'colaboradores'>((aba0 as 'painel') ?? 'painel');
  const [periodo, setPeriodo] = useState({ ini: startOfMonth(ds.params.dataBase), fim: ds.params.dataBase });
  const [filtro, setFiltro] = useState<{ local: LocalTrabalho | ''; codigoObra: string; equipe: string }>({ local: '', codigoObra: '', equipe: '' });
  const [colab, setColab] = useState<Colaborador | null>(null);
  const [tarefa, setTarefa] = useState<Tarefa | null>(null);
  const [bloq, setBloq] = useState<{ id: string; motivo: string } | null>(null);
  const r = useMemo(() => resumoEquipe(ds, periodo, filtro), [ds, periodo, filtro]);
  const hoje = locaisDoDia(ds, ds.params.dataBase);
  const tarefas = calcTarefas(ds, ds.params.dataBase);
  const podeEditar = pode(usuario, 'editar_obra');
  const podeApontar = pode(usuario, 'comentar');
  const equipes = [...new Set(ds.colaboradores.map((c) => c.equipe).filter(Boolean))];
  const nomeColab = (id?: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? '';
  const nomeUser = (id: string) => ds.usuarios.find((u) => u.id === id)?.nome ?? id;
  const toneStatus = (s: string): Tone => (({ Concluída: 'ok', 'Em andamento': 'info', Bloqueada: 'bad', Aberta: 'warn' }) as Record<string, Tone>)[s] ?? 'muted';

  return (
    <>
      <PageHead title="Equipe e produtividade" subtitle="Efetivo, horas, custo de mão de obra apropriado por serviço, produção, ocorrências e tarefas de campo e fábrica.">
        {podeApontar && <button className="btn primary" onClick={() => navegar('/apontamentos/novo')}>+ Apontar o dia</button>}
        {podeEditar && <button className="btn" onClick={() => setColab(actions.novoColaborador())}>+ Colaborador</button>}
      </PageHead>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'painel', label: 'Painel de produtividade' }, { id: 'apontamentos', label: `Apontamentos (${ds.apontamentos.length})` }, { id: 'tarefas', label: `Tarefas (${tarefas.filter((t) => t.status !== 'Concluída').length})` }, { id: 'colaboradores', label: `Colaboradores (${ds.colaboradores.filter((c) => c.ativo).length})` }]} />

      {aba === 'painel' && (
        <>
          <div className="filters">
            <label className="field"><span>De</span><input type="date" value={periodo.ini} onChange={(e) => setPeriodo({ ...periodo, ini: e.target.value })} /></label>
            <label className="field"><span>Até</span><input type="date" value={periodo.fim} onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })} /></label>
            <button className="btn sm" onClick={() => setPeriodo({ ini: addDays(ds.params.dataBase, -6), fim: ds.params.dataBase })}>7 dias</button>
            <button className="btn sm" onClick={() => setPeriodo({ ini: startOfMonth(ds.params.dataBase), fim: ds.params.dataBase })}>Mês</button>
            <label className="field"><span>Local</span><select value={filtro.local} onChange={(e) => setFiltro({ ...filtro, local: e.target.value as LocalTrabalho | '' })}><option value="">Todos</option><option>Obra</option><option>Fábrica</option></select></label>
            <label className="field"><span>Obra</span><select value={filtro.codigoObra} onChange={(e) => setFiltro({ ...filtro, codigoObra: e.target.value })}><option value="">Todas</option>{ds.obras.map((o) => <option key={o.codigo}>{o.codigo}</option>)}</select></label>
            <label className="field"><span>Equipe</span><select value={filtro.equipe} onChange={(e) => setFiltro({ ...filtro, equipe: e.target.value })}><option value="">Todas</option>{equipes.map((q) => <option key={q}>{q}</option>)}</select></label>
          </div>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Kpi label="Efetivo médio / dia" value={Math.round(r.efetivoMedio * 10) / 10} hint={`${r.diasApontados} dia(s) apontado(s) · ${r.presentes} presenças`} />
            <Kpi label="Horas trabalhadas" value={h(r.horas + r.horasExtras)} hint={`extras ${h(r.horasExtras)} (${pct(r.pctHorasExtras)})`} tone={r.pctHorasExtras > 0.15 ? 'warn' : undefined} />
            <Kpi label="Custo de mão de obra" value={money(r.custoMO)} hint="HH × custo/hora, extra 1,5×" />
            <Kpi label="Absenteísmo" value={pct(r.absenteismo)} hint={`${r.faltas} falta(s) · ${r.atestados} atestado(s)`} tone={r.absenteismo > 0.05 ? 'bad' : 'ok'} />
            <Kpi label="Horas perdidas" value={h(r.horasPerdidas)} hint={r.ocorrencias.slice(0, 2).map((o) => `${o.tipo} ${h(o.horas)}`).join(' · ') || 'sem ocorrências'} tone={r.horasPerdidas > 0 ? 'warn' : 'ok'} />
            <Kpi label="Produção" value={r.producao.slice(0, 2).map((p) => `${p.quantidade} ${p.unidade}`).join(' · ') || '—'} hint={r.hhPorTonelada ? `${Math.round(r.hhPorTonelada * 10) / 10} HH por tonelada` : 'informe produção em t para HH/t'} />
            <Kpi label="Diários de hoje" value={`${hoje.filter((l) => l.apontamento?.status === 'Fechado').length}/${hoje.length}`} hint={hoje.filter((l) => !l.apontamento).map((l) => l.rotulo).join(', ') || 'todos iniciados'} tone={hoje.some((l) => !l.apontamento) ? 'warn' : 'ok'} to="/apontamentos/novo" />
            <Kpi label="Tarefas atrasadas" value={tarefas.filter((t) => t.atrasada).length} hint={`${tarefas.filter((t) => t.status === 'Bloqueada').length} bloqueada(s)`} tone={tarefas.some((t) => t.atrasada) ? 'bad' : 'ok'} />
          </div>
          <div className="grid cols-2">
            <div className="card table-wrap">
              <h2>Por serviço: mão de obra apropriada</h2>
              {r.porServico.length === 0 ? <Empty>Aponte as horas por serviço para ver custo e produtividade por serviço.</Empty> : (
                <table><thead><tr><th>Serviço</th><th>Horas</th><th>Custo MO</th><th>Orçado (total)</th><th>Produção</th><th>HH / unid.</th></tr></thead><tbody>
                  {r.porServico.map((s) => <tr key={s.servicoId}><td><Link to={`/obras/${s.codigoObra}`}>{s.nome}</Link></td><td className="num">{h(s.horas + s.horasExtras)}</td><td><Money v={s.custoMO} compact /></td><td><Money v={s.custoOrcado} compact /></td><td className="small">{s.producao.map((p) => `${p.quantidade} ${p.unidade}`).join(', ') || '—'}</td><td className="num">{s.hhPorUnidade ? Math.round(s.hhPorUnidade * 100) / 100 : '—'}</td></tr>)}
                </tbody></table>
              )}
              <h3 style={{ marginTop: 14 }}>Por equipe e local</h3>
              <table><tbody>
                {r.porEquipe.map((q) => <tr key={q.equipe}><td>{q.equipe || '(sem equipe)'}</td><td className="num">efetivo {Math.round(q.efetivoMedio * 10) / 10}</td><td className="num">{h(q.horas)}</td><td><Money v={q.custo} compact /></td></tr>)}
                {r.porLocal.map((q) => <tr key={q.local}><td className="muted">{q.local}</td><td className="num">{q.dias} dia(s)</td><td className="num">{h(q.horas)}</td><td><Money v={q.custo} compact /></td></tr>)}
              </tbody></table>
            </div>
            <div className="card table-wrap">
              <h2>Por colaborador</h2>
              {r.porColaborador.length === 0 ? <Empty>Nenhum apontamento no período.</Empty> : (
                <table><thead><tr><th>Colaborador</th><th>Função</th><th>Dias</th><th>Faltas</th><th>Horas</th><th>Extras</th><th>Custo</th></tr></thead><tbody>
                  {r.porColaborador.map((x) => <tr key={x.colaborador.id}><td>{x.colaborador.nome}<div className="muted small">{x.colaborador.equipe}</div></td><td>{x.colaborador.funcao}</td><td className="num">{x.presentes}/{x.dias}</td><td className={`num ${x.faltas ? 'neg' : ''}`}>{x.faltas}</td><td className="num">{h(x.horas)}</td><td className="num">{h(x.horasExtras)}</td><td><Money v={x.custo} compact /></td></tr>)}
                </tbody></table>
              )}
              {r.ocorrencias.length > 0 && (
                <>
                  <h3 style={{ marginTop: 14 }}>Ocorrências</h3>
                  <table><tbody>{r.ocorrencias.map((o) => <tr key={o.tipo}><td>{o.tipo}</td><td className="num">{o.quantidade}×</td><td className="num">{h(o.horas)} perdidas</td></tr>)}</tbody></table>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {aba === 'apontamentos' && (
        <div className="card table-wrap">
          <table><thead><tr><th>Data</th><th>Local</th><th>Efetivo</th><th>Horas</th><th>Produção</th><th>Ocorrências</th><th>Status</th><th>Responsável</th></tr></thead><tbody>
            {[...ds.apontamentos].sort((a, b) => (a.data < b.data ? 1 : -1)).map((a) => {
              const pres = a.linhas.filter((l) => l.presenca === 'Presente');
              return (
                <tr key={a.id} className="clickable" onClick={() => navegar(`/apontamentos/${a.id}`)}>
                  <td>{d(a.data)}</td><td>{a.local}{a.codigoObra ? ` · ${a.codigoObra}` : ''}</td><td className="num">{pres.length}/{a.linhas.length}</td><td className="num">{h(pres.reduce((s, l) => s + l.horas + l.horasExtras, 0))}</td>
                  <td className="small">{a.producao.map((p) => `${p.quantidade} ${p.unidade}`).join(', ') || '—'}</td><td className="small">{a.ocorrencias.length ? `${a.ocorrencias.length} · ${h(a.ocorrencias.reduce((s, o) => s + o.horasPerdidas, 0))}` : '—'}</td>
                  <td><Badge tone={a.status === 'Fechado' ? 'ok' : 'warn'}>{a.status}</Badge></td><td className="small">{a.responsavel}</td>
                </tr>
              );
            })}
            {ds.apontamentos.length === 0 && <tr><td colSpan={8} className="empty">Nenhum diário. Clique em "Apontar o dia".</td></tr>}
          </tbody></table>
        </div>
      )}

      {aba === 'tarefas' && (
        <>
          <div className="actions" style={{ marginBottom: 10 }}>{podeApontar && <button className="btn primary sm" onClick={() => setTarefa(actions.novaTarefaCampo())}>+ Tarefa</button>}</div>
          <div className="table-wrap">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 10, minWidth: 900 }}>
              {STATUS_TAREFA.map((st) => (
                <div key={st} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 8, border: '1px solid var(--border)' }}>
                  <h3 style={{ marginBottom: 6 }}>{st} <span className="muted">({tarefas.filter((t) => t.status === st).length})</span></h3>
                  {tarefas.filter((t) => t.status === st).sort((a, b) => (a.prazo < b.prazo ? -1 : 1)).map((t) => (
                    <div key={t.id} className="card" style={{ padding: 10, marginBottom: 8, borderLeft: `3px solid ${t.atrasada ? 'var(--bad)' : t.prioridade === 'Alta' ? 'var(--warn)' : 'var(--primary-2)'}` }}>
                      <div className="small"><b>{t.titulo}</b></div>
                      <div className="muted small">{[t.codigoObra, t.local, nomeColab(t.colaboradorId) || nomeUser(t.responsavel)].filter(Boolean).join(' · ')}</div>
                      <div className={`small ${t.atrasada ? 'neg' : 'muted'}`}>prazo {d(t.prazo)}{t.prioridade === 'Alta' && ' · alta'}{t.bloqueio && ` · ${t.bloqueio}`}</div>
                      {podeApontar && (
                        <div className="actions" style={{ marginTop: 6 }}>
                          {st !== 'Em andamento' && st !== 'Concluída' && <button className="btn sm" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Em andamento'), toast)}>Iniciar</button>}
                          {st !== 'Concluída' && <button className="btn sm primary" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Concluída'), toast)}>Concluir</button>}
                          {st !== 'Bloqueada' && st !== 'Concluída' && <button className="btn sm" onClick={() => setBloq({ id: t.id, motivo: '' })}>Bloquear</button>}
                          {st === 'Concluída' && <button className="btn sm" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Aberta'), toast)}>Reabrir</button>}
                          <button className="btn sm" onClick={() => setTarefa(t)}>…</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {aba === 'colaboradores' && (
        <div className="card table-wrap">
          <table><thead><tr><th>Nome</th><th>Função</th><th>Vínculo</th><th>Equipe</th><th>Local</th><th>Obra padrão</th>{pode(usuario, 'ver_bancos') && <th>Custo/h</th>}<th>Jornada</th><th>Status</th></tr></thead><tbody>
            {ds.colaboradores.map((c) => (
              <tr key={c.id} className={podeEditar ? 'clickable' : ''} onClick={() => podeEditar && setColab(c)}>
                <td><b>{c.nome}</b>{c.telefone && <div className="muted small">{c.telefone}</div>}</td><td>{c.funcao}</td><td>{c.vinculo}</td><td>{c.equipe}</td><td>{c.local}</td><td>{c.codigoObraPadrao ?? '—'}</td>
                {pode(usuario, 'ver_bancos') && <td><Money v={c.custoHora} /></td>}<td className="num">{c.jornadaDiaria} h</td><td><Badge tone={c.ativo ? 'ok' : 'muted'}>{c.ativo ? 'Ativo' : 'Inativo'}</Badge></td>
              </tr>
            ))}
            {ds.colaboradores.length === 0 && <tr><td colSpan={9} className="empty">Nenhum colaborador. Cadastre a equipe de campo e de fábrica.</td></tr>}
          </tbody></table>
        </div>
      )}

      {colab && <ColaboradorForm colaborador={colab} onClose={() => setColab(null)} onErro={toast} />}
      {tarefa && <TarefaForm tarefa={tarefa} onClose={() => setTarefa(null)} onErro={toast} />}
      {bloq && (
        <Modal title="Bloquear tarefa" onClose={() => setBloq(null)}>
          <Field label="Motivo" req full><Input value={bloq.motivo} onChange={(e) => setBloq({ ...bloq, motivo: e.target.value })} placeholder="ex.: aguardando material, frente ocupada" /></Field>
          <div className="foot"><button className="btn" onClick={() => setBloq(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.moverTarefa(bloq.id, 'Bloqueada', bloq.motivo), toast, () => setBloq(null))}>Bloquear</button></div>
        </Modal>
      )}
      {el}
      <span hidden>{toneStatus('x')}</span>
    </>
  );
}
