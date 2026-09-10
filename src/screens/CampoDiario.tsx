// Diario do dia no celular: presenca por toque, horas em passos de meia hora, ocorrencias por chips, fechamento com um botao.
// Mesmas regras do diario completo (actions.salvarApontamento); esta tela so muda o caminho ate elas.
import React, { useState } from 'react';
import { TIPOS_OCORRENCIA, custoLinha, equipeDoLocal } from '../core/equipe';
import { apontamentoDoDia } from '../core/equipe';
import type { Apontamento, ApontamentoLinha, LocalTrabalho, Presenca } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, money, tentar } from '../ui/components';
import { navegar } from '../ui/router';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const PRESENCAS: { v: Presenca; r: string; cls?: string }[] = [{ v: 'Presente', r: 'P' }, { v: 'Falta', r: 'F', cls: 'falta' }, { v: 'Atestado', r: 'At', cls: 'neutro' }, { v: 'Férias', r: 'Fé', cls: 'neutro' }, { v: 'Folga', r: 'Fo', cls: 'neutro' }];
const CLIMAS = ['Bom', 'Nublado', 'Chuva leve', 'Chuva forte', 'Impraticável'];
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');

/** Campo numerico com botoes de menos/mais (passo 0,5 h por padrao). */
export function Stepper({ value, onChange, min = 0, max = 24, passo = 0.5, un = 'h', disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; passo?: number; un?: string; disabled?: boolean }) {
  const fixar = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / passo) * passo)));
  return (
    <span className="stepper">
      <button type="button" disabled={disabled || value <= min} onClick={() => fixar(value - passo)} aria-label="menos">−</button>
      <input type="number" inputMode="decimal" step={passo} min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} onBlur={(e) => fixar(Number(e.target.value))} />
      <button type="button" disabled={disabled || value >= max} onClick={() => fixar(value + passo)} aria-label="mais">+</button>
      {un && <span className="un">{un}</span>}
    </span>
  );
}

export default function CampoDiario({ data, local, codigoObra, toast, Fotos }: { data: string; local: LocalTrabalho; codigoObra?: string; toast: (m: string) => void; Fotos: (p: { codigoObra: string; refId: string }) => React.ReactElement }) {
  const { ds, usuario } = useStore();
  const existente = apontamentoDoDia(ds, data, local, codigoObra);
  const [a, setA] = useState<Apontamento>(() => existente ?? actions.novoApontamento(data, local, codigoObra));
  const [maisDe, setMaisDe] = useState<string | null>(null);
  const [addColab, setAddColab] = useState(false);
  const [reabrir, setReabrir] = useState<string | null>(null);
  const fechado = a.status === 'Fechado';
  const podeEditar = pode(usuario, 'comentar', a.codigoObra) && (!fechado || pode(usuario, 'editar_obra'));
  const colabs = new Map(ds.colaboradores.map((c) => [c.id, c]));
  const servicos = ds.servicos.filter((s) => s.ativo && (local !== 'Obra' || s.codigoObra === codigoObra));
  const obra = ds.obras.find((o) => o.codigo === codigoObra);
  const up = (p: Partial<Apontamento>) => setA({ ...a, ...p });
  const upLinha = (id: string, p: Partial<ApontamentoLinha>) => up({ linhas: a.linhas.map((l) => (l.colaboradorId === id ? { ...l, ...p, ...(p.presenca && p.presenca !== 'Presente' ? { horas: 0, horasExtras: 0 } : {}), ...(p.presenca === 'Presente' && l.presenca !== 'Presente' ? { horas: colabs.get(id)?.jornadaDiaria ?? 8 } : {}) } : l)) });
  const presentes = a.linhas.filter((l) => l.presenca === 'Presente');
  const horas = presentes.reduce((s, l) => s + l.horas + l.horasExtras, 0);
  const extras = presentes.reduce((s, l) => s + l.horasExtras, 0);
  const custo = presentes.reduce((s, l) => s + custoLinha(l, colabs.get(l.colaboradorId)), 0);
  const equipeHoje = new Set(equipeDoLocal(ds, data, local, codigoObra).map((c) => c.id));
  const foraDaEquipe = ds.colaboradores.filter((c) => c.ativo && !a.linhas.some((l) => l.colaboradorId === c.id)).sort((x, y) => x.nome.localeCompare(y.nome));
  const salvar = (fechar: boolean) => tentar(() => { const novo = actions.salvarApontamento(a, fechar); setA(novo); }, toast, () => { toast(fechar ? 'Dia fechado. Obrigado!' : 'Rascunho guardado.'); if (fechar) navegar('/campo/dia'); });

  return (
    <div>
      <h2>{local === 'Obra' ? `${codigoObra}` : local} · {d(data)}</h2>
      <p className="muted small" style={{ marginTop: -6 }}>{obra?.nome}{obra ? ' · ' : ''}<Badge tone={fechado ? 'ok' : existente ? 'warn' : 'muted'}>{fechado ? 'fechado' : existente ? 'rascunho' : 'não apontado'}</Badge> · {a.linhas.length} pessoa(s)</p>
      {fechado && <div className="alert ok small">Dia fechado{a.fechadoEm ? ` em ${new Date(a.fechadoEm).toLocaleString('pt-BR')}` : ''}. {pode(usuario, 'editar_obra') ? 'Para corrigir, reabra com um motivo.' : 'Peça ao gestor para reabrir se precisar corrigir.'}</div>}

      <div className="bloco-campo">
        <h3>Presença e horas</h3>
        {podeEditar && a.linhas.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>
          <button className="chip sm" onClick={() => up({ linhas: a.linhas.map((l) => ({ ...l, presenca: 'Presente', horas: l.presenca === 'Presente' ? l.horas : colabs.get(l.colaboradorId)?.jornadaDiaria ?? 8 })) })}>Todos presentes</button>
          <button className="chip sm" onClick={() => up({ linhas: a.linhas.map((l) => (l.presenca === 'Presente' ? { ...l, horas: colabs.get(l.colaboradorId)?.jornadaDiaria ?? l.horas, horasExtras: 0 } : l)) })}>Jornada padrão</button>
          {servicos.length > 0 && <button className="chip sm" onClick={() => up({ linhas: a.linhas.map((l) => (l.presenca === 'Presente' ? { ...l, servicoId: servicos[0].id } : l)) })}>Todos em {servicos[0].codigo}</button>}
        </div>}
        {a.linhas.length === 0 && <div className="muted small">Ninguém alocado aqui hoje. Adicione abaixo quem trabalhou.</div>}
        {a.linhas.map((l) => { const c = colabs.get(l.colaboradorId); const presente = l.presenca === 'Presente'; return (
          <div key={l.colaboradorId} className={`linha-colab ${presente ? '' : 'ausente'}`}>
            <div className="nome">{c?.nome ?? l.colaboradorId}<small>{c?.funcao}{!equipeHoje.has(l.colaboradorId) && ' · emprestado'}</small></div>
            <span className="seg" role="group" aria-label="presença">{PRESENCAS.map((p) => <button key={p.v} type="button" disabled={!podeEditar} className={`${l.presenca === p.v ? 'on' : ''} ${p.cls ?? ''}`} title={p.v} onClick={() => upLinha(l.colaboradorId, { presenca: p.v })}>{p.r}</button>)}</span>
            {presente && <div className="horas">
              <span>Horas <Stepper value={l.horas} onChange={(v) => upLinha(l.colaboradorId, { horas: v })} max={14} disabled={!podeEditar} /></span>
              <span>Extras <Stepper value={l.horasExtras} onChange={(v) => upLinha(l.colaboradorId, { horasExtras: v })} max={8} disabled={!podeEditar} /></span>
              {podeEditar && <button type="button" className="chip sm" onClick={() => setMaisDe(maisDe === l.colaboradorId ? null : l.colaboradorId)}>{l.servicoId ? `Serviço ${servicos.find((s) => s.id === l.servicoId)?.codigo ?? ''}` : 'Serviço / obs.'}</button>}
              {maisDe === l.colaboradorId && podeEditar && <div style={{ width: '100%', display: 'grid', gap: 6 }}>
                {servicos.length > 0 && <select value={l.servicoId ?? ''} onChange={(e) => upLinha(l.colaboradorId, { servicoId: e.target.value || undefined })}><option value="">Serviço: nenhum</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nome}</option>)}</select>}
                <input placeholder="observação (ex.: saiu 15h, médico)" value={l.observacao ?? ''} onChange={(e) => upLinha(l.colaboradorId, { observacao: e.target.value || undefined })} />
                <button type="button" className="chip sm" onClick={() => { up({ linhas: a.linhas.filter((x) => x.colaboradorId !== l.colaboradorId) }); setMaisDe(null); }}>Tirar do diário</button>
              </div>}
            </div>}
            {!presente && l.presenca === 'Falta' && podeEditar && <div className="horas"><input style={{ flex: 1 }} placeholder="motivo da falta (opcional)" value={l.observacao ?? ''} onChange={(e) => upLinha(l.colaboradorId, { observacao: e.target.value || undefined })} /></div>}
          </div>
        ); })}
        {podeEditar && foraDaEquipe.length > 0 && (addColab
          ? <select autoFocus value="" onChange={(e) => { const c = colabs.get(e.target.value); if (c) up({ linhas: [...a.linhas, { colaboradorId: c.id, presenca: 'Presente', horas: c.jornadaDiaria, horasExtras: 0 }] }); setAddColab(false); }} onBlur={() => setAddColab(false)}><option value="">Quem mais trabalhou aqui hoje?</option>{foraDaEquipe.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.funcao} · {c.local}{c.codigoObraPadrao ? ` ${c.codigoObraPadrao}` : ''}</option>)}</select>
          : <button className="btn" style={{ width: '100%' }} onClick={() => setAddColab(true)}>+ Adicionar pessoa de outra equipe</button>)}
      </div>

      <div className="bloco-campo">
        <h3>Ocorrências do dia</h3>
        {podeEditar && <div className="chips" style={{ marginBottom: 8 }}>{TIPOS_OCORRENCIA.map((t) => <button key={t} className="chip sm" onClick={() => up({ ocorrencias: [...a.ocorrencias, { tipo: t, descricao: '', horasPerdidas: t === 'Chuva' || t === 'Paralisação' ? 1 : 0 }] })}>+ {t}</button>)}</div>}
        {a.ocorrencias.length === 0 && <div className="muted small">Sem ocorrências. Toque num tipo acima se houve chuva, falta de material, acidente…</div>}
        {a.ocorrencias.map((o, i) => (
          <div key={i} className="linha-colab">
            <div className="nome">{o.tipo}<small>horas perdidas da equipe</small></div>
            <Stepper value={o.horasPerdidas} onChange={(v) => up({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, horasPerdidas: v } : x)) })} max={24} disabled={!podeEditar} />
            <div className="horas"><input style={{ flex: 1 }} disabled={!podeEditar} placeholder="o que aconteceu" value={o.descricao} onChange={(e) => up({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />{podeEditar && <button className="chip sm" onClick={() => up({ ocorrencias: a.ocorrencias.filter((_, j) => j !== i) })}>×</button>}</div>
          </div>
        ))}
      </div>

      <div className="bloco-campo">
        <h3>Produção do dia (opcional)</h3>
        {a.producao.map((p, i) => (
          <div key={i} className="linha-colab" style={{ gridTemplateColumns: '1fr' }}>
            <input disabled={!podeEditar} placeholder="o que foi feito (ex.: pilares eixo A)" value={p.descricao} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />
            <div className="horas">
              <input type="number" inputMode="decimal" step="0.01" style={{ width: 100 }} disabled={!podeEditar} value={p.quantidade || ''} placeholder="qtd" onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, quantidade: Number(e.target.value) } : x)) })} />
              <span className="seg">{['t', 'kg', 'pç', 'm²', 'm'].map((u) => <button key={u} type="button" disabled={!podeEditar} className={p.unidade === u ? 'on' : ''} onClick={() => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, unidade: u } : x)) })}>{u}</button>)}</span>
              {servicos.length > 0 && <select disabled={!podeEditar} value={p.servicoId ?? ''} onChange={(e) => up({ producao: a.producao.map((x, j) => (j === i ? { ...x, servicoId: e.target.value || undefined } : x)) })}><option value="">serviço —</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo}</option>)}</select>}
              {podeEditar && <button className="chip sm" onClick={() => up({ producao: a.producao.filter((_, j) => j !== i) })}>×</button>}
            </div>
          </div>
        ))}
        {podeEditar && <button className="btn" style={{ width: '100%' }} onClick={() => up({ producao: [...a.producao, { descricao: '', quantidade: 0, unidade: local === 'Fábrica' ? 't' : 'pç', servicoId: servicos[0]?.id }] })}>+ Produção</button>}
        <p className="muted small" style={{ marginTop: 6 }}>Quilos por estação (corte, solda, içamento…) vão em <a href="#/campo/fabrica" onClick={(e) => { e.preventDefault(); navegar(local === 'Obra' ? '/campo/montagem' : '/campo/fabrica'); }}>Apontar estação</a>.</p>
      </div>

      {local === 'Obra' && <div className="bloco-campo">
        <h3>Clima</h3>
        <div className="chips">{CLIMAS.map((c) => <button key={c} className={`chip sm ${a.clima === c ? 'on' : ''}`} disabled={!podeEditar} onClick={() => up({ clima: a.clima === c ? undefined : c })}>{c}</button>)}</div>
      </div>}

      <div className="bloco-campo">
        <h3>Observações e fotos</h3>
        <textarea rows={2} disabled={!podeEditar} placeholder="resumo do dia, visitas, entregas recebidas…" value={a.observacoes} onChange={(e) => up({ observacoes: e.target.value })} style={{ width: '100%' }} />
        {existente ? <Fotos codigoObra={codigoObra ?? ''} refId={a.id} /> : <div className="muted small" style={{ marginTop: 6 }}>Guarde o rascunho para anexar fotos.</div>}
      </div>

      <div className="rodape-fixo">
        <div className="tot"><b>{presentes.length}/{a.linhas.length}</b> presentes · <b>{n1(horas)} h</b>{extras > 0 && ` (${n1(extras)} extras)`}{pode(usuario, 'ver_bancos') && custo > 0 && <><br />{money(custo)} de mão de obra</>}</div>
        {podeEditar && !fechado && <button className="btn" onClick={() => salvar(false)}>Guardar</button>}
        {podeEditar && !fechado && <button className="btn primary" onClick={() => salvar(true)}>Fechar o dia</button>}
        {fechado && pode(usuario, 'editar_obra') && reabrir === null && <button className="btn" onClick={() => setReabrir('')}>Reabrir</button>}
      </div>
      {reabrir !== null && <div className="card" style={{ marginTop: 8 }}>
        <input autoFocus placeholder="motivo da reabertura" value={reabrir} onChange={(e) => setReabrir(e.target.value)} style={{ width: '100%' }} />
        <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => setReabrir(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => { actions.reabrirApontamento(a.id, reabrir); setA({ ...a, status: 'Rascunho', fechadoEm: undefined }); }, toast, () => { setReabrir(null); toast('Dia reaberto.'); })}>Reabrir o dia</button></div>
      </div>}
    </div>
  );
}
