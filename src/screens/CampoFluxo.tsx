// Assistente do dia no celular: um passo por pergunta (dia, faltas, hora extra, producao por estacao, ocorrencias, fechar).
// So se marca a excecao: quem faltou, quem fez extra, o que parou. O rascunho fica no aparelho ate fechar; ao fechar,
// o diario vai por actions.salvarApontamento e cada estacao com producao por actions.apontarEstacao.
import React, { useEffect, useState } from 'react';
import { TIPOS_OCORRENCIA, custoLinha, equipeDoLocal } from '../core/equipe';
import { AUSENCIAS, CLIMAS, LINHA_DA_FRENTE, LOCAL_DA_FRENTE, ROTULO_FRENTE, alternarAusencia, climaDe, climaTexto, horasPorEstacao, iniciarRascunho, pendenciasDoFluxo, passosDoFluxo, type Frente, type RascunhoFluxo } from '../core/campoFluxo';
import { ESTACAO_CONCLUI, estacoesDe } from '../core/producao';
import type { Presenca } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, money, tentar } from '../ui/components';
import { navegar } from '../ui/router';
import { Stepper } from './CampoDiario';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
const chave = (data: string, frente: Frente, obra?: string) => `eiff-control:campo:fluxo:${data}:${frente}:${obra ?? ''}`;
const lerRascunho = (k: string): RascunhoFluxo | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as RascunhoFluxo) : null; } catch { return null; } };

export default function CampoFluxo({ data, frente, codigoObra, toast, Fotos }: { data: string; frente: Frente; codigoObra?: string; toast: (m: string) => void; Fotos: (p: { codigoObra: string; refId: string }) => React.ReactElement }) {
  const { ds, usuario } = useStore();
  const local = LOCAL_DA_FRENTE[frente]; const linha = LINHA_DA_FRENTE[frente];
  const obra = frente === 'canteiro' ? codigoObra : undefined;
  const k = chave(data, frente, obra);
  const [r, setR] = useState<RascunhoFluxo>(() => { const guardado = lerRascunho(k); const base = iniciarRascunho(ds, data, frente, obra, () => actions.novoApontamento(data, local, obra)); return guardado && guardado.apontamento.id === base.apontamento.id && base.apontamento.status !== 'Fechado' ? { ...guardado, passo: Math.min(guardado.passo, 5) } : base; });
  const [ausenciaDe, setAusenciaDe] = useState<string | null>(null);
  const [addColab, setAddColab] = useState(false);
  const [reabrir, setReabrir] = useState<string | null>(null);
  useEffect(() => { try { if (r.apontamento.status !== 'Fechado') localStorage.setItem(k, JSON.stringify(r)); } catch { /* sem espaço: segue só em memória */ } }, [k, r]);
  const passos = passosDoFluxo(frente);
  const passo = passos[r.passo];
  const a = r.apontamento;
  const fechado = a.status === 'Fechado';
  const podeEditar = pode(usuario, 'comentar', obra) && (!fechado || pode(usuario, 'editar_obra'));
  const colabs = new Map(ds.colaboradores.map((c) => [c.id, c]));
  const nome = (id: string) => colabs.get(id)?.nome ?? id;
  const jornada = (id: string) => colabs.get(id)?.jornadaDiaria ?? 8;
  const up = (p: Partial<RascunhoFluxo>) => setR({ ...r, ...p });
  const upA = (p: Partial<RascunhoFluxo['apontamento']>) => up({ apontamento: { ...a, ...p } });
  const presentes = a.linhas.filter((l) => l.presenca === 'Presente');
  const ausentes = a.linhas.filter((l) => l.presenca !== 'Presente');
  const horas = presentes.reduce((s, l) => s + l.horas + l.horasExtras, 0);
  const extras = presentes.reduce((s, l) => s + l.horasExtras, 0);
  const custo = presentes.reduce((s, l) => s + custoLinha(l, colabs.get(l.colaboradorId)), 0);
  const equipeHoje = new Set(equipeDoLocal(ds, data, local, obra).map((c) => c.id));
  const foraDaEquipe = ds.colaboradores.filter((c) => c.ativo && !a.linhas.some((l) => l.colaboradorId === c.id)).sort((x, y) => x.nome.localeCompare(y.nome));
  const { clima, temperatura } = { clima: climaDe(a.clima).clima, temperatura: r.temperatura };
  const setClima = (c?: string, t?: number) => setR({ ...r, temperatura: t, apontamento: { ...a, clima: climaTexto(c, t) } });
  const obrasParaEstacao = frente === 'canteiro' ? obra : ds.obras.find((o) => o.status === 'Em execução')?.codigo ?? ds.obras[0]?.codigo;
  const jaRegistradas = (ds.apontamentosEstacao ?? []).filter((x) => x.data === data && x.linha === linha && (frente === 'fabrica' || x.codigoObra === obra));
  const pendencias = pendenciasDoFluxo(r, frente);
  const ir = (n: number) => { up({ passo: Math.max(0, Math.min(passos.length - 1, n)) }); window.scrollTo({ top: 0 }); };

  const fechar = () => { let estacoes = 0; tentar(() => {
    const novo = actions.salvarApontamento(a, true);
    if (!r.estacoesRegistradas && obrasParaEstacao) {
      const hs = horasPorEstacao(novo.linhas, r.marcacoes, jornada);
      for (const m of r.marcacoes.filter((x) => x.pesoKg > 0 || x.pecas > 0)) { actions.apontarEstacao(actions.novoApontamentoEstacao({ data, codigoObra: obrasParaEstacao, linha, estacao: m.estacao, pesoKg: m.pesoKg, pecas: m.pecas, ordemId: m.ordemId, colaboradores: hs.get(m.estacao) ?? [], observacao: 'fluxo do dia (celular)' })); estacoes += 1; }
    }
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    setR({ ...r, apontamento: novo, estacoesRegistradas: true });
  }, toast, () => { toast(`Dia fechado${estacoes ? ` com ${estacoes} estação(ões) registrada(s)` : ''}. Obrigado!`); navegar('/campo'); }); };
  const guardar = () => tentar(() => { const novo = actions.salvarApontamento(a, false); setR({ ...r, apontamento: novo }); }, toast, () => { toast('Rascunho guardado no sistema. Continue quando puder.'); navegar('/campo'); });

  const Cabecalho = () => (
    <div className="fluxo-cab">
      <div className="fluxo-passos" aria-label="passos">{passos.map((p, i) => <button key={p.id} type="button" className={`${i === r.passo ? 'on' : ''} ${i < r.passo ? 'feito' : ''}`} onClick={() => ir(i)}><span>{i + 1}</span>{p.titulo}</button>)}</div>
      <h2>{passo.pergunta}</h2>
      <p className="muted small">{ROTULO_FRENTE[frente]}{obra ? ` · ${obra}` : ''} · {d(data)} · <Badge tone={fechado ? 'ok' : 'warn'}>{fechado ? 'fechado' : 'em preenchimento'}</Badge></p>
    </div>
  );
  const Rodape = ({ children }: { children?: React.ReactNode }) => (
    <div className="rodape-fixo">
      {r.passo > 0 && <button className="btn" onClick={() => ir(r.passo - 1)}>← Voltar</button>}
      <div className="tot">{children}</div>
      {r.passo < passos.length - 1 && <button className="btn primary" onClick={() => ir(r.passo + 1)}>Próximo →</button>}
    </div>
  );

  if (fechado && reabrir === null) return (
    <div>
      <Cabecalho />
      <div className="alert ok">Dia fechado{a.fechadoEm ? ` em ${new Date(a.fechadoEm).toLocaleString('pt-BR')}` : ''} por {a.responsavel}. {presentes.length} presente(s), {n1(horas)} h{extras ? ` (${n1(extras)} extras)` : ''}{jaRegistradas.length ? `, ${kg(jaRegistradas.reduce((s, x) => s + x.pesoKg, 0))} em ${jaRegistradas.length} estação(ões)` : ''}.</div>
      <ul className="lista-simples">{a.linhas.map((l) => <li key={l.colaboradorId}><span>{nome(l.colaboradorId)}</span><span>{l.presenca === 'Presente' ? `${n1(l.horas)} h${l.horasExtras ? ` + ${n1(l.horasExtras)} extra` : ''}` : l.presenca}</span></li>)}</ul>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => navegar(`/campo/estacao?linha=${linha}`)}>Registrar outra estação</button>
        {pode(usuario, 'editar_obra') && <button className="btn" onClick={() => setReabrir('')}>Reabrir para corrigir</button>}
      </div>
      {obra !== undefined || frente === 'fabrica' ? <Fotos codigoObra={obra ?? ''} refId={a.id} /> : null}
    </div>
  );
  if (fechado && reabrir !== null) return (
    <div><Cabecalho /><div className="card"><input autoFocus placeholder="motivo da reabertura" value={reabrir} onChange={(e) => setReabrir(e.target.value)} style={{ width: '100%' }} /><div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => setReabrir(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => { actions.reabrirApontamento(a.id, reabrir); setR({ ...r, passo: 0, apontamento: { ...a, status: 'Rascunho', fechadoEm: undefined }, estacoesRegistradas: true }); }, toast, () => { setReabrir(null); toast('Dia reaberto: percorra os passos e feche de novo.'); })}>Reabrir</button></div></div></div>
  );

  return (
    <div className="fluxo">
      <Cabecalho />

      {passo.id === 'dia' && <>
        {frente === 'canteiro' && <div className="bloco-campo"><h3>Clima</h3><div className="chips">{CLIMAS.map((c) => <button key={c} className={`chip ${clima === c ? 'on' : ''}`} disabled={!podeEditar} onClick={() => setClima(clima === c ? undefined : c, temperatura)}>{c}</button>)}</div></div>}
        <div className="bloco-campo"><h3>Temperatura (opcional)</h3><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Stepper value={temperatura ?? 0} onChange={(v) => setClima(clima, v)} min={-10} max={50} passo={1} un="°C" disabled={!podeEditar} />{temperatura !== undefined && <button className="chip sm" onClick={() => setClima(clima, undefined)}>limpar</button>}</div></div>
        {frente === 'fabrica' && <div className="bloco-campo"><h3>Turno / observação rápida</h3><div className="chips">{['Turno normal', 'Turno estendido', 'Parada de máquina', 'Manutenção', 'Visita / auditoria'].map((t) => <button key={t} className={`chip sm ${a.observacoes.includes(t) ? 'on' : ''}`} disabled={!podeEditar} onClick={() => upA({ observacoes: a.observacoes.includes(t) ? a.observacoes.replace(t, '').replace(/^[;\s]+|[;\s]+$/g, '').replace(/;\s*;/g, ';') : [a.observacoes, t].filter(Boolean).join('; ') })}>{t}</button>)}</div></div>}
        <div className="bloco-campo"><h3>Alguma observação do dia?</h3><textarea rows={3} disabled={!podeEditar} placeholder={frente === 'canteiro' ? 'visita do cliente, entrega de material, frente liberada…' : 'lote recebido, máquina parada, visita…'} value={a.observacoes} onChange={(e) => upA({ observacoes: e.target.value })} style={{ width: '100%' }} /></div>
        <Rodape>{a.linhas.length} pessoa(s) alocadas {frente === 'canteiro' ? 'no canteiro' : 'na fábrica'} hoje</Rodape>
      </>}

      {passo.id === 'faltas' && <>
        <p className="muted small">Toque em quem <b>não veio</b>. Quem não for marcado fica presente com a jornada normal.</p>
        {a.linhas.length === 0 && <div className="alert warn small">Ninguém alocado aqui hoje. Adicione abaixo quem trabalhou, ou cadastre a alocação em Cadastros › Alocações.</div>}
        <div className="chips" style={{ marginBottom: 10 }}>
          {a.linhas.map((l) => { const aus = l.presenca !== 'Presente'; return <button key={l.colaboradorId} className={`chip ${aus ? 'on falta' : ''}`} disabled={!podeEditar} onClick={() => { if (aus) { upA({ linhas: alternarAusencia(a.linhas, l.colaboradorId, 'Presente', jornada(l.colaboradorId)) }); setAusenciaDe(null); } else { upA({ linhas: alternarAusencia(a.linhas, l.colaboradorId, 'Falta', jornada(l.colaboradorId)) }); setAusenciaDe(l.colaboradorId); } }}>{nome(l.colaboradorId)}{aus && ` · ${l.presenca}`}{!equipeHoje.has(l.colaboradorId) && ' (emprestado)'}</button>; })}
        </div>
        {ausenciaDe && a.linhas.find((l) => l.colaboradorId === ausenciaDe && l.presenca !== 'Presente') && <div className="linha-colab" style={{ gridTemplateColumns: '1fr' }}>
          <div className="nome">{nome(ausenciaDe)}<small>motivo da ausência</small></div>
          <span className="seg">{AUSENCIAS.map((p) => <button key={p} type="button" className={a.linhas.find((l) => l.colaboradorId === ausenciaDe)?.presenca === p ? 'on falta' : ''} onClick={() => upA({ linhas: alternarAusencia(a.linhas, ausenciaDe, p as Presenca, jornada(ausenciaDe)) })}>{p}</button>)}</span>
          <input placeholder="observação (opcional)" value={a.linhas.find((l) => l.colaboradorId === ausenciaDe)?.observacao ?? ''} onChange={(e) => upA({ linhas: a.linhas.map((l) => (l.colaboradorId === ausenciaDe ? { ...l, observacao: e.target.value || undefined } : l)) })} />
        </div>}
        {podeEditar && foraDaEquipe.length > 0 && (addColab
          ? <select autoFocus value="" onChange={(e) => { const c = colabs.get(e.target.value); if (c) upA({ linhas: [...a.linhas, { colaboradorId: c.id, presenca: 'Presente', horas: c.jornadaDiaria, horasExtras: 0 }] }); setAddColab(false); }} onBlur={() => setAddColab(false)}><option value="">Quem mais trabalhou aqui hoje?</option>{foraDaEquipe.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.funcao} · {c.local}{c.codigoObraPadrao ? ` ${c.codigoObraPadrao}` : ''}</option>)}</select>
          : <button className="btn" style={{ width: '100%' }} onClick={() => setAddColab(true)}>+ Alguém de outra equipe trabalhou aqui</button>)}
        <Rodape><b>{presentes.length}</b> presentes · <b>{ausentes.length}</b> ausente(s)</Rodape>
      </>}

      {passo.id === 'extras' && <>
        <p className="muted small">Toque em quem fez hora extra e ajuste as horas. Horas normais seguem a jornada; toque no nome para alterar.</p>
        <div className="chips" style={{ marginBottom: 10 }}><button className={`chip ${r.semExtras && !extras ? 'on' : ''}`} disabled={!podeEditar} onClick={() => setR({ ...r, semExtras: true, apontamento: { ...a, linhas: a.linhas.map((l) => ({ ...l, horasExtras: 0 })) } })}>Ninguém fez hora extra</button></div>
        {presentes.map((l) => { const on = l.horasExtras > 0; return (
          <div key={l.colaboradorId} className={`linha-colab ${on ? '' : 'ausente'}`}>
            <div className="nome">{nome(l.colaboradorId)}<small>{colabs.get(l.colaboradorId)?.funcao} · {n1(l.horas)} h normais</small></div>
            <button type="button" className={`chip ${on ? 'on' : ''}`} disabled={!podeEditar} onClick={() => setR({ ...r, semExtras: false, apontamento: { ...a, linhas: a.linhas.map((x) => (x.colaboradorId === l.colaboradorId ? { ...x, horasExtras: on ? 0 : 1 } : x)) } })}>{on ? 'Fez extra' : 'Marcar'}</button>
            {on && <div className="horas"><span>Extras <Stepper value={l.horasExtras} onChange={(v) => upA({ linhas: a.linhas.map((x) => (x.colaboradorId === l.colaboradorId ? { ...x, horasExtras: v } : x)) })} max={8} /></span><span>Normais <Stepper value={l.horas} onChange={(v) => upA({ linhas: a.linhas.map((x) => (x.colaboradorId === l.colaboradorId ? { ...x, horas: v } : x)) })} max={14} /></span></div>}
          </div>
        ); })}
        <Rodape><b>{n1(extras)} h</b> extras · {n1(horas)} h no total</Rodape>
      </>}

      {passo.id === 'estacoes' && <>
        <p className="muted small">Informe os quilos que passaram por cada estação e toque em quem trabalhou nela. As horas de cada pessoa vêm do diário e se dividem entre as estações marcadas. Estação sem quilos é ignorada.</p>
        {jaRegistradas.length > 0 && <div className="alert ok small">Já registrado hoje: {jaRegistradas.map((x) => `${x.estacao} ${kg(x.pesoKg)}`).join(' · ')}. O que você marcar abaixo entra como registro adicional.</div>}
        {!obrasParaEstacao && <div className="alert warn small">Sem obra em execução para vincular a produção.</div>}
        {estacoesDe(linha).map((e) => { const m = r.marcacoes.find((x) => x.estacao === e)!; const on = m.pesoKg > 0 || m.pecas > 0; const marco = ESTACAO_CONCLUI[e]; return (
          <div key={e} className={`linha-colab ${on ? '' : 'ausente'}`} style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="nome">{e}<small>{marco ? `conclui: ${marco}` : 'produtividade'}</small></div>
            <Stepper value={m.pesoKg} onChange={(v) => up({ marcacoes: r.marcacoes.map((x) => (x.estacao === e ? { ...x, pesoKg: v } : x)) })} passo={50} max={200000} un="kg" disabled={!podeEditar} />
            {on && <div className="horas" style={{ gridColumn: '1 / -1' }}>
              <span>Peças <Stepper value={m.pecas} onChange={(v) => up({ marcacoes: r.marcacoes.map((x) => (x.estacao === e ? { ...x, pecas: v } : x)) })} passo={1} max={9999} un="" /></span>
              <div className="chips" style={{ width: '100%' }}>{presentes.map((l) => <button key={l.colaboradorId} type="button" className={`chip sm ${m.quem.includes(l.colaboradorId) ? 'on' : ''}`} onClick={() => up({ marcacoes: r.marcacoes.map((x) => (x.estacao === e ? { ...x, quem: x.quem.includes(l.colaboradorId) ? x.quem.filter((q) => q !== l.colaboradorId) : [...x.quem, l.colaboradorId] } : x)) })}>{nome(l.colaboradorId).split(' ')[0]}</button>)}{presentes.length > 1 && <button type="button" className="chip sm" onClick={() => up({ marcacoes: r.marcacoes.map((x) => (x.estacao === e ? { ...x, quem: presentes.map((l) => l.colaboradorId) } : x)) })}>todos</button>}</div>
            </div>}
          </div>
        ); })}
        <p className="muted small">Precisa marcar conjuntos da lista de materiais ou uma ordem específica? Use <a href="#/campo/estacao" onClick={(ev) => { ev.preventDefault(); navegar(`/campo/estacao?linha=${linha}`); }}>Registrar estação</a> depois de fechar o dia.</p>
        <Rodape><b>{kg(r.marcacoes.reduce((s, m) => s + m.pesoKg, 0))}</b> em {r.marcacoes.filter((m) => m.pesoKg > 0 || m.pecas > 0).length} estação(ões)</Rodape>
      </>}

      {passo.id === 'ocorrencias' && <>
        <div className="chips" style={{ marginBottom: 10 }}>
          <button className={`chip ${r.semOcorrencias && !a.ocorrencias.length ? 'on' : ''}`} disabled={!podeEditar} onClick={() => setR({ ...r, semOcorrencias: true, apontamento: { ...a, ocorrencias: [] } })}>Nenhuma ocorrência</button>
          {TIPOS_OCORRENCIA.map((t) => <button key={t} className="chip" disabled={!podeEditar} onClick={() => setR({ ...r, semOcorrencias: false, apontamento: { ...a, ocorrencias: [...a.ocorrencias, { tipo: t, descricao: '', horasPerdidas: t === 'Chuva' || t === 'Paralisação' ? 1 : 0 }] } })}>+ {t}</button>)}
        </div>
        {a.ocorrencias.map((o, i) => (
          <div key={i} className="linha-colab">
            <div className="nome">{o.tipo}<small>horas perdidas da equipe</small></div>
            <Stepper value={o.horasPerdidas} onChange={(v) => upA({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, horasPerdidas: v } : x)) })} max={24} disabled={!podeEditar} />
            <div className="horas"><input style={{ flex: 1 }} disabled={!podeEditar} placeholder="o que aconteceu" value={o.descricao} onChange={(e) => upA({ ocorrencias: a.ocorrencias.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />{podeEditar && <button className="chip sm" onClick={() => upA({ ocorrencias: a.ocorrencias.filter((_, j) => j !== i) })}>×</button>}</div>
          </div>
        ))}
        <Rodape>{a.ocorrencias.length ? <><b>{a.ocorrencias.length}</b> ocorrência(s) · {n1(a.ocorrencias.reduce((s, o) => s + o.horasPerdidas, 0))} h perdidas</> : r.semOcorrencias ? 'Sem ocorrências' : 'Marque "Nenhuma" ou adicione'}</Rodape>
      </>}

      {passo.id === 'resumo' && <>
        <div className="faixa-dia">
          <div><b>{presentes.length}/{a.linhas.length}</b><span>presentes</span></div>
          <div><b>{n1(horas)}</b><span>horas</span></div>
          <div><b>{n1(extras)}</b><span>extras</span></div>
          <div><b>{n1(r.marcacoes.reduce((s, m) => s + m.pesoKg, 0) / 1000)}</b><span>t produzidas</span></div>
        </div>
        <ul className="lista-simples">
          <li><span>Dia</span><span>{[clima, temperatura !== undefined ? `${temperatura} °C` : null].filter(Boolean).join(' · ') || '—'}</span></li>
          <li><span>Ausentes</span><span>{ausentes.length ? ausentes.map((l) => `${nome(l.colaboradorId).split(' ')[0]} (${l.presenca})`).join(', ') : 'ninguém'}</span></li>
          <li><span>Hora extra</span><span>{extras ? presentes.filter((l) => l.horasExtras > 0).map((l) => `${nome(l.colaboradorId).split(' ')[0]} ${n1(l.horasExtras)} h`).join(', ') : 'ninguém'}</span></li>
          <li><span>Produção</span><span>{r.marcacoes.filter((m) => m.pesoKg > 0 || m.pecas > 0).map((m) => `${m.estacao} ${kg(m.pesoKg)}`).join(' · ') || 'sem registro'}</span></li>
          <li><span>Ocorrências</span><span>{a.ocorrencias.length ? a.ocorrencias.map((o) => `${o.tipo} ${n1(o.horasPerdidas)} h`).join(' · ') : 'nenhuma'}</span></li>
          {pode(usuario, 'ver_bancos') && <li><span>Mão de obra do dia</span><span>{money(custo)}</span></li>}
        </ul>
        {pendencias.length > 0 && <div className="alert warn" style={{ marginTop: 10 }}><b>Antes de fechar:</b><ul style={{ margin: '4px 0 0 16px' }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        {a.id && a.status === 'Rascunho' && ds.apontamentos.some((x) => x.id === a.id) && <div style={{ marginTop: 10 }}><Fotos codigoObra={obra ?? ''} refId={a.id} /></div>}
        <div className="rodape-fixo">
          <button className="btn" onClick={() => ir(r.passo - 1)}>← Voltar</button>
          <div className="tot" />
          {podeEditar && <button className="btn" onClick={guardar}>Guardar</button>}
          {podeEditar && <button className="btn primary" disabled={pendencias.length > 0} onClick={fechar}>Fechar o dia</button>}
        </div>
      </>}
    </div>
  );
}
