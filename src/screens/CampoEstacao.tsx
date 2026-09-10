// Apontamento de estacao no celular (fabrica ou canteiro): obra e estacao por chips, quilos em campo grande, equipe do local
// ja marcada com as horas do diario do dia; conjuntos opcionais por busca. Regras em actions.apontarEstacao.
import React, { useState } from 'react';
import { ESTACAO_CONCLUI, estacoesDe, resumoProdutividade } from '../core/producao';
import { calcConjunto } from '../core/materiais';
import { apontamentoDoDia, equipeDoLocal } from '../core/equipe';
import type { ApontamentoEstacao, LinhaProducao } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { tentar } from '../ui/components';
import { Stepper } from './CampoDiario';

const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');

export default function CampoEstacao({ data, linha, toast }: { data: string; linha: LinhaProducao; toast: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const obras = obrasVisiveis(usuario, ds.obras).filter((o) => o.status === 'Em execução' || o.status === 'Planejamento');
  const [a, setA] = useState<ApontamentoEstacao>(() => actions.novoApontamentoEstacao({ data, linha, estacao: estacoesDe(linha)[0], codigoObra: obras.length === 1 ? obras[0].codigo : '' }));
  const [busca, setBusca] = useState('');
  const [verConjuntos, setVerConjuntos] = useState(false);
  const up = (p: Partial<ApontamentoEstacao>) => setA({ ...a, ...p });
  const local = linha === 'Fabricação' ? 'Fábrica' : 'Obra';
  const equipe = a.codigoObra || linha === 'Fabricação' ? equipeDoLocal(ds, data, local, linha === 'Fabricação' ? undefined : a.codigoObra) : [];
  const diario = a.codigoObra || linha === 'Fabricação' ? apontamentoDoDia(ds, data, local, linha === 'Fabricação' ? undefined : a.codigoObra) : undefined;
  const horasDoDiario = (id: string) => { const l = diario?.linhas.find((x) => x.colaboradorId === id); return l ? (l.presenca === 'Presente' ? l.horas + l.horasExtras : 0) : ds.colaboradores.find((c) => c.id === id)?.jornadaDiaria ?? 8; };
  const outros = ds.colaboradores.filter((c) => c.ativo && !equipe.some((e) => e.id === c.id) && !a.colaboradores.some((x) => x.colaboradorId === c.id)).sort((x, y) => x.nome.localeCompare(y.nome));
  const horas = a.colaboradores.reduce((s, c) => s + c.horas, 0);
  const setColab = (id: string, h: number) => up({ colaboradores: h > 0 ? [...a.colaboradores.filter((c) => c.colaboradorId !== id), { colaboradorId: id, horas: h }] : a.colaboradores.filter((c) => c.colaboradorId !== id) });
  const marco = ESTACAO_CONCLUI[a.estacao];
  const campo = marco === 'fabricado' ? 'fabricadoQtd' : marco === 'expedido' ? 'expedidoQtd' : marco === 'montado' ? 'montadoQtd' : null;
  const conjuntosObra = ds.conjuntos.filter((c) => c.codigoObra === a.codigoObra).map(calcConjunto);
  const candidatos = conjuntosObra.filter((c) => (!busca || `${c.marca} ${c.descricao}`.toLowerCase().includes(busca.toLowerCase())) && (!campo || c[campo] < c.quantidade)).slice(0, 12);
  const pesoConj = a.conjuntos.reduce((s, it) => s + it.quantidade * (conjuntosObra.find((c) => c.id === it.conjuntoId)?.pesoUnitario ?? 0), 0);
  const setConj = (id: string, q: number) => up({ conjuntos: q > 0 ? [...a.conjuntos.filter((c) => c.conjuntoId !== id), { conjuntoId: id, quantidade: q }] : a.conjuntos.filter((c) => c.conjuntoId !== id) });
  const ordens = ds.ordens.filter((o) => o.codigoObra === a.codigoObra && !o.cancelada && o.tipo === linha);
  const hoje = resumoProdutividade(ds, { de: data, ate: data, linha });
  const podeApontar = pode(usuario, 'comentar', a.codigoObra || undefined);
  const registrar = () => tentar(() => { const r = actions.apontarEstacao(a); const h = r.colaboradores.reduce((s, c) => s + c.horas, 0); toast(`${a.estacao}: ${kg(r.pesoKg)}${h ? ` · ${n1(h)} h · ${n1(r.pesoKg / h)} kg/HH` : ''}.`); setA(actions.novoApontamentoEstacao({ data, linha, estacao: a.estacao, codigoObra: a.codigoObra, ordemId: a.ordemId, colaboradores: a.colaboradores })); setBusca(''); }, toast);

  return (
    <div>
      <h2>{linha === 'Fabricação' ? 'Fábrica' : 'Montagem no canteiro'} · {data.split('-').reverse().join('/')}</h2>
      {obras.length === 0 && <div className="alert warn small">Nenhuma obra em execução visível para você.</div>}
      {obras.length > 1 && <div className="bloco-campo"><h3>Obra</h3><div className="chips">{obras.map((o) => <button key={o.codigo} className={`chip ${a.codigoObra === o.codigo ? 'on' : ''}`} onClick={() => up({ codigoObra: o.codigo, servicoId: undefined, ordemId: undefined, conjuntos: [] })}>{o.codigo}</button>)}</div></div>}
      <div className="bloco-campo"><h3>Estação</h3><div className="chips">{estacoesDe(linha).map((e) => <button key={e} className={`chip ${a.estacao === e ? 'on' : ''}`} onClick={() => up({ estacao: e })}>{e}</button>)}</div>{marco && <div className="muted small" style={{ marginTop: 6 }}>Esta estação marca os conjuntos informados como <b>{marco}</b>.</div>}</div>

      <div className="bloco-campo">
        <h3>Quilos processados</h3>
        <input className="num-grande" type="number" inputMode="decimal" min={0} step={1} placeholder={a.conjuntos.length ? `${Math.round(pesoConj)} (dos conjuntos)` : '0'} value={a.pesoKg || ''} onChange={(e) => up({ pesoKg: Number(e.target.value) })} />
        <div className="horas" style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>
          <span>Peças <Stepper value={a.pecas} onChange={(v) => up({ pecas: v })} passo={1} max={9999} un="" /></span>
          {a.conjuntos.length > 0 && <span>{a.conjuntos.length} conjunto(s) · {kg(pesoConj)}</span>}
        </div>
        {conjuntosObra.length > 0 && <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setVerConjuntos(!verConjuntos)}>{verConjuntos ? 'Ocultar conjuntos' : `Marcar conjuntos da lista${a.conjuntos.length ? ` (${a.conjuntos.length})` : ''}`}</button>}
        {verConjuntos && <div style={{ marginTop: 8 }}>
          <input placeholder="Buscar marca (ex.: P-01)" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%' }} />
          {!candidatos.length && <div className="muted small" style={{ marginTop: 6 }}>{busca ? 'Nenhuma marca com esse texto.' : `Todos os conjuntos já constam como ${marco}.`}</div>}
          {candidatos.map((c) => <div key={c.id} className="linha-colab" style={{ marginTop: 6 }}><div className="nome">{c.marca}<small>{c.descricao.slice(0, 40)} · {c.quantidade} pç · {kg(c.pesoUnitario)}/pç{campo ? ` · feito ${c[campo]}` : ''}</small></div><Stepper value={a.conjuntos.find((x) => x.conjuntoId === c.id)?.quantidade ?? 0} onChange={(v) => setConj(c.id, v)} passo={1} max={campo ? c.quantidade - c[campo] : c.quantidade} un="" /></div>)}
        </div>}
        {ordens.length > 0 && <select value={a.ordemId ?? ''} onChange={(e) => up({ ordemId: e.target.value || undefined })} style={{ width: '100%', marginTop: 8 }}><option value="">Ordem: nenhuma (só produtividade)</option>{ordens.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.descricao.slice(0, 40)}</option>)}</select>}
      </div>

      <div className="bloco-campo">
        <h3>Quem trabalhou nesta estação · {n1(horas)} h</h3>
        {equipe.length === 0 && !a.codigoObra && linha === 'Montagem' && <div className="muted small">Escolha a obra para ver a equipe do canteiro.</div>}
        {equipe.length === 0 && (a.codigoObra || linha === 'Fabricação') && <div className="muted small">Ninguém alocado aqui hoje. Adicione abaixo.</div>}
        {[...equipe, ...ds.colaboradores.filter((c) => a.colaboradores.some((x) => x.colaboradorId === c.id) && !equipe.some((e) => e.id === c.id))].map((c) => { const h = a.colaboradores.find((x) => x.colaboradorId === c.id)?.horas ?? 0; const on = h > 0; return (
          <div key={c.id} className={`linha-colab ${on ? '' : 'ausente'}`}>
            <div className="nome">{c.nome}<small>{c.funcao}</small></div>
            <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setColab(c.id, on ? 0 : horasDoDiario(c.id) || c.jornadaDiaria)}>{on ? 'Trabalhou' : 'Marcar'}</button>
            {on && <div className="horas"><span>Horas nesta estação <Stepper value={h} onChange={(v) => setColab(c.id, v)} max={24} /></span></div>}
          </div>
        ); })}
        {outros.length > 0 && <select value="" onChange={(e) => { const c = ds.colaboradores.find((x) => x.id === e.target.value); if (c) setColab(c.id, horasDoDiario(c.id) || c.jornadaDiaria); }} style={{ width: '100%' }}><option value="">+ Adicionar pessoa de outra equipe</option>{outros.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.funcao}</option>)}</select>}
      </div>

      <div className="bloco-campo"><input placeholder="observação (lote, eixo, ocorrência)" value={a.observacao} onChange={(e) => up({ observacao: e.target.value })} style={{ width: '100%' }} /></div>

      <div className="rodape-fixo">
        <div className="tot"><b>{kg(a.pesoKg || pesoConj)}</b> · {n1(horas)} h{horas > 0 && (a.pesoKg || pesoConj) > 0 && <><br />{n1((a.pesoKg || pesoConj) / horas)} kg/HH</>}</div>
        <button className="btn primary" disabled={!podeApontar || !a.codigoObra} onClick={registrar}>Registrar</button>
      </div>

      {hoje.apontamentos.length > 0 && <div className="bloco-campo">
        <h3>Já registrado hoje · {kg(hoje.apontamentos.reduce((s, x) => s + x.pesoKg, 0))}</h3>
        <ul className="lista-simples">{hoje.apontamentos.map((x) => <li key={x.id}><span>{x.estacao} · {x.codigoObra}</span><span>{kg(x.pesoKg)} · {n1(x.horas)} h{x.horas ? ` · ${n1(x.kgPorHH)} kg/HH` : ''}</span></li>)}</ul>
      </div>}
    </div>
  );
}
