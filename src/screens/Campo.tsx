import React, { useEffect, useRef, useState } from 'react';
import { carteiraObras } from '../core/engine';
import { calcTarefas, locaisDoDia, resumoDiaCampo } from '../core/equipe';
import CampoDiario from './CampoDiario';
import CampoEstacao from './CampoEstacao';
import CampoFluxo from './CampoFluxo';
import { estadoDoFluxo, type Frente } from '../core/campoFluxo';
import { resumoProducao } from '../core/obras';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Badge, Empty, tentar, useToast } from '../ui/components';
import { navegar } from '../ui/router';
import { comprimirFoto } from '../ui/foto';
import { urlFoto } from '../data/supabase';
import type { Foto, LinhaProducao, LocalTrabalho } from '../core/types';

const CHAVE_DATA = 'eiff-control:campo:data';
const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const diaAntes = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00`); t.setDate(t.getDate() - n); return t.toISOString().slice(0, 10); };

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

/** Miniatura que resolve a imagem: local (data URL) ou URL assinada do Storage; sem rede e sem imagem local, mostra um marcador. */
function ImagemFoto({ foto }: { foto: Foto }) {
  const [url, setUrl] = useState<string | null>(foto.dataUrl ?? null);
  useEffect(() => { let ativo = true; if (!foto.dataUrl) void urlFoto(foto).then((u) => { if (ativo) setUrl(u); }); return () => { ativo = false; }; }, [foto]);
  if (!url) return <span className="miniatura-vazia" title="Foto no servidor; abre com conexão">☁</span>;
  return <img src={url} alt="foto de campo" loading="lazy" onClick={() => window.open(url, '_blank')} />;
}
/** Botao de foto do modo campo: abre a camera, comprime e registra a evidencia ligada ao item; miniaturas com exclusao. */
function BotaoFoto({ codigoObra, tipo, refId, onErro, onOk }: { codigoObra: string; tipo: Foto['referenciaTipo']; refId: string; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const fotos = (ds.fotos ?? []).filter((f) => f.referenciaTipo === tipo && f.referenciaId === refId);
  const escolher = async (arquivo?: File) => {
    if (!arquivo) return;
    setOcupado(true);
    try { const dataUrl = await comprimirFoto(arquivo); actions.registrarFoto({ codigoObra, referenciaTipo: tipo, referenciaId: refId, dataUrl }); onOk('Foto registrada.'); }
    catch (e) { onErro((e as Error).message); }
    finally { setOcupado(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="fotos-campo">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void escolher(e.target.files?.[0])} />
      <button className="btn" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? 'Comprimindo…' : `📷 Foto${fotos.length ? ` (${fotos.length})` : ''}`}</button>
      {fotos.length > 0 && <div className="miniaturas">{fotos.slice(-6).map((f) => (
        <span key={f.id} className="miniatura"><ImagemFoto foto={f} />{(f.tomadaPor === usuario.id || pode(usuario, 'editar_obra', codigoObra || undefined)) && <button className="apagar" title="Excluir foto" aria-label="Excluir foto" onClick={() => { if (window.confirm('Excluir esta foto?')) tentar(() => actions.excluirFoto(f.id), onErro); }}>×</button>}</span>
      ))}</div>}
    </div>
  );
}

/** Modo campo: tela simplificada para celular, usada no canteiro e na fabrica. */
export default function Campo({ secao, query }: { secao?: string; query?: URLSearchParams }) {
  const { ds, usuario, sync } = useStore();
  const { toast, el } = useToast();
  const [bloq, setBloq] = useState<{ id: string; motivo: string } | null>(null);
  const hojeBase = ds.params.dataBase;
  // dia apontado: hoje por padrao; "ontem" e data livre ficam guardados na sessao para o encarregado fechar o dia anterior
  const [hoje, setHojeRaw] = useState<string>(() => { try { const v = sessionStorage.getItem(CHAVE_DATA); return v && v <= hojeBase && v >= diaAntes(hojeBase, 7) ? v : hojeBase; } catch { return hojeBase; } });
  const setHoje = (v: string) => { setHojeRaw(v); try { sessionStorage.setItem(CHAVE_DATA, v); } catch { /* ignore */ } };
  const locais = locaisDoDia(ds, hoje);
  const resumo = resumoDiaCampo(ds, hoje);
  const podeEstacao = pode(usuario, 'comentar');
  const Fotos = ({ codigoObra, refId }: { codigoObra: string; refId: string }) => <BotaoFoto codigoObra={codigoObra} tipo="apontamento" refId={refId} onErro={toast} onOk={toast} />;
  const meuColab = ds.colaboradores.find((c) => c.usuarioId === usuario.id);
  const tarefas = calcTarefas(ds, hoje).filter((t) => t.status !== 'Concluída' && (t.responsavel === usuario.id || (meuColab && t.colaboradorId === meuColab.id) || pode(usuario, 'editar_obra'))).sort((a, b) => (a.prazo < b.prazo ? -1 : 1));
  const visiveis = new Set(obrasVisiveis(usuario, ds.obras).map((o) => o.codigo));
  const demandas = carteiraObras(ds).filter((o) => visiveis.has(o.obra.codigo) && o.ativa).flatMap((o) => o.demandas.map((dm) => ({ ...dm, obra: o.obra.codigo }))).filter((dm) => dm.status !== 'Concluída' && (dm.responsavel === usuario.id || pode(usuario, 'editar_obra')));
  const fab = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Fabricação', hoje);
  const mon = resumoProducao(ds.ordens.filter((o) => visiveis.has(o.codigoObra)), 'Montagem', hoje);
  const ordens = [...fab.ordens, ...mon.ordens].filter((o) => o.status !== 'Concluída').sort((a, b) => ((a.dataNecessidade ?? '9') < (b.dataNecessidade ?? '9') ? -1 : 1));
  const abrirDiario = (local: LocalTrabalho, codigoObra?: string) => navegar(`/campo/diario?local=${encodeURIComponent(local)}${codigoObra ? `&obra=${encodeURIComponent(codigoObra)}` : ''}`);
  const SeletorDia = () => (
    <div className="chips" style={{ marginBottom: 10 }}>
      <button className={`chip sm ${hoje === hojeBase ? 'on' : ''}`} onClick={() => setHoje(hojeBase)}>Hoje</button>
      <button className={`chip sm ${hoje === diaAntes(hojeBase, 1) ? 'on' : ''}`} onClick={() => setHoje(diaAntes(hojeBase, 1))}>Ontem</button>
      <input type="date" value={hoje} max={hojeBase} min={diaAntes(hojeBase, 7)} onChange={(e) => e.target.value && setHoje(e.target.value)} style={{ minHeight: 40, padding: '0 8px', fontSize: 14 }} aria-label="Dia do apontamento" />
    </div>
  );
  const Local = ({ l }: { l: (typeof locais)[number] }) => (
    <button className={`btn grande ${l.apontamento ? '' : 'primary'}`} onClick={() => abrirDiario(l.local, l.codigoObra)}>
      <span>{l.rotulo}<span className="sub">{l.colaboradores.length} pessoa(s){l.apontamento ? ` · ${l.apontamento.linhas.filter((x) => x.presenca === 'Presente').length} presentes` : ''}</span></span>
      <Badge tone={l.apontamento?.status === 'Fechado' ? 'ok' : l.apontamento ? 'warn' : 'muted'}>{l.apontamento?.status === 'Fechado' ? 'fechado' : l.apontamento ? 'rascunho' : 'apontar'}</Badge>
    </button>
  );

  const obrasCanteiro = obrasVisiveis(usuario, ds.obras).filter((o) => o.status === 'Em execução');
  const Frente = ({ frente, codigoObra }: { frente: Frente; codigoObra?: string }) => {
    const e = estadoDoFluxo(ds, hoje, frente, codigoObra);
    const obra = ds.obras.find((o) => o.codigo === codigoObra);
    const sub = e.situacao === 'fechado' ? `${e.presentes} presentes${e.faltas ? `, ${e.faltas} ausente(s)` : ''}${e.extras ? `, ${n1(e.extras)} h extras` : ''}${e.kgEstacoes ? ` · ${kg(e.kgEstacoes)}` : ''}` : e.situacao === 'rascunho' ? 'em preenchimento: continue de onde parou' : `${e.equipe.length} pessoa(s) alocadas · passo a passo em 2 minutos`;
    return (
      <button className={`btn grande ${e.situacao === 'nao_iniciado' ? 'primary' : ''}`} onClick={() => navegar(frente === 'fabrica' ? '/campo/fabrica' : `/campo/canteiro?obra=${encodeURIComponent(codigoObra ?? '')}`)}>
        <span>{frente === 'fabrica' ? 'Fábrica' : `Canteiro · ${codigoObra}`}<span className="sub">{obra && frente === 'canteiro' ? `${obra.nome} · ` : ''}{sub}</span></span>
        <Badge tone={e.situacao === 'fechado' ? 'ok' : e.situacao === 'rascunho' ? 'warn' : 'info'}>{e.situacao === 'fechado' ? 'fechado' : e.situacao === 'rascunho' ? 'continuar' : 'começar'}</Badge>
      </button>
    );
  };

  const Home = () => (
    <div>
      <p className="muted small">Olá, {usuario.nome.split(' ')[0]}.{sync.status === 'pendente' && <> <Badge tone="warn">offline · guardado no aparelho</Badge></>}{sync.status === 'erro' && <> <Badge tone="bad">não sincronizado</Badge></>}</p>
      <SeletorDia />
      <div className="faixa-dia" aria-label="resumo do dia">
        <div><b>{resumo.fechados}/{resumo.locais}</b><span>diários fechados</span></div>
        <div><b>{resumo.presentes || resumo.efetivo}</b><span>{resumo.presentes ? 'presentes' : 'na equipe'}</span></div>
        <div><b>{n1(resumo.horas)}</b><span>horas do dia</span></div>
        <div><b>{n1((resumo.kgFabrica + resumo.kgCanteiro) / 1000)}</b><span>t apontadas</span></div>
      </div>

      <div className="bloco-campo">
        <h3>Preencher o dia · {d(hoje)}</h3>
        <Frente frente="fabrica" />
        {obrasCanteiro.map((o) => <Frente key={o.codigo} frente="canteiro" codigoObra={o.codigo} />)}
        {obrasCanteiro.length === 0 && <div className="muted small">Nenhuma obra em execução visível para o canteiro.</div>}
      </div>

      {podeEstacao && <div className="bloco-campo">
        <h3>Registro avulso</h3>
        <button className="btn grande" onClick={() => navegar('/campo/estacao?linha=Fabricação')}><span>Estação da fábrica<span className="sub">com conjuntos da lista e ordem</span></span><span className="small">{resumo.kgFabrica ? kg(resumo.kgFabrica) : '—'}</span></button>
        <button className="btn grande" onClick={() => navegar('/campo/estacao?linha=Montagem')}><span>Estação do canteiro<span className="sub">com conjuntos da lista e ordem</span></span><span className="small">{resumo.kgCanteiro ? kg(resumo.kgCanteiro) : '—'}</span></button>
        <button className="btn grande" onClick={() => navegar('/campo/dia')}><span>Diários por local<span className="sub">formulário completo, um local por vez</span></span><span className="small">{resumo.fechados}/{resumo.locais}</span></button>
      </div>}

      <div className="bloco-campo">
        <h3>Acompanhamento</h3>
        <button className="btn grande" onClick={() => navegar('/campo/producao')}><span>Ordens de fabricação e montagem<span className="sub">etapa atual, avanço, fotos</span></span><span className="small">{ordens.length} em aberto</span></button>
        <button className="btn grande" onClick={() => navegar('/campo/tarefas')}><span>Minhas tarefas</span><span className="small">{tarefas.length}{tarefas.some((t) => t.atrasada) && <> <Badge tone="bad">atrasadas</Badge></>}</span></button>
        <button className="btn grande" onClick={() => navegar('/campo/checklist')}><span>Check-list do dia</span><span className="small">{demandas.length} pendente(s)</span></button>
        <button className="btn grande" onClick={() => navegar('/diretor')}><span>Diretor Financeiro<span className="sub">posso pagar? quanto? quando? registra a previsão</span></span></button>
        <button className="btn grande" onClick={() => navegar('/')}><span>Painel completo</span></button>
      </div>
    </div>
  );

  const Dia = () => (
    <div>
      <h2>Equipe do dia</h2>
      <SeletorDia />
      {locais.length === 0 ? <Empty>Sem equipe cadastrada.</Empty> : locais.map((l) => <Local key={l.rotulo} l={l} />)}
    </div>
  );

  const Tarefas = () => (
    <div>
      <h2>Minhas tarefas</h2>
      {tarefas.length === 0 ? <Empty>Nenhuma tarefa aberta.</Empty> : tarefas.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${t.atrasada ? 'var(--bad)' : t.prioridade === 'Alta' ? 'var(--warn)' : 'var(--primary-2)'}` }}>
          <div><b>{t.titulo}</b> <Badge tone={t.status === 'Bloqueada' ? 'bad' : t.status === 'Em andamento' ? 'info' : 'warn'}>{t.status}</Badge></div>
          <div className="muted small">{[t.codigoObra, t.local, `prazo ${d(t.prazo)}`].filter(Boolean).join(' · ')}{t.bloqueio && ` · ${t.bloqueio}`}</div>
          {t.descricao && <div className="small" style={{ marginTop: 4 }}>{t.descricao}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            {t.status !== 'Em andamento' && <button className="btn" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Em andamento'), toast)}>Iniciar</button>}
            <button className="btn primary" onClick={() => tentar(() => actions.moverTarefa(t.id, 'Concluída'), toast, () => toast('Tarefa concluída.'))}>Concluir</button>
            {t.status !== 'Bloqueada' && <button className="btn" onClick={() => setBloq({ id: t.id, motivo: '' })}>Bloquear</button>}
          </div>
          <BotaoFoto codigoObra={t.codigoObra ?? ''} tipo="tarefa" refId={t.id} onErro={toast} onOk={toast} />
        </div>
      ))}
    </div>
  );

  const Checklist = () => (
    <div>
      <h2>Check-list de hoje</h2>
      {demandas.length === 0 ? <Empty>Tudo concluído por hoje.</Empty> : demandas.map((dm) => (
        <label key={dm.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={dm.concluidaNoPeriodo} onChange={(e) => tentar(() => actions.concluirDemanda(dm.id, e.target.checked), toast)} />
          <span><b>{dm.titulo}</b><div className="muted small">{dm.obra} · {dm.periodicidade} · até {d(dm.prazoPeriodo)}</div><span onClick={(e) => e.preventDefault()}><BotaoFoto codigoObra={dm.obra} tipo="demanda" refId={dm.id} onErro={toast} onOk={toast} /></span></span>
        </label>
      ))}
    </div>
  );

  const Producao = () => (
    <div>
      <h2>Fabricação e montagem</h2>
      {ordens.length === 0 ? <Empty>Nenhuma ordem em aberto.</Empty> : ordens.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${o.atrasada ? 'var(--bad)' : 'var(--primary-2)'}` }}>
          <div><b>{o.codigo}</b> · {o.tipo} · {o.codigoObra}</div>
          <div className="small">{o.descricao} · {o.quantidade} {o.unidade}</div>
          <div className="muted small">etapa atual: <b>{o.etapaAtual}</b> · {o.dataNecessidade ? `necessidade ${d(o.dataNecessidade)}` : 'sem data'}</div>
          <div className="progress" style={{ margin: '6px 0' }}><i style={{ width: `${o.pctConcluido * 100}%` }} /></div>
          <BotaoFoto codigoObra={o.codigoObra} tipo="ordem" refId={o.id} onErro={toast} onOk={toast} />
          {pode(usuario, 'editar_lancamento', o.codigoObra) && o.etapaAtualIdx >= 0 && (
            <div className="actions">
              {o.etapas[o.etapaAtualIdx].status !== 'Em andamento' && <button className="btn" onClick={() => tentar(() => actions.avancarEtapa(o.id, o.etapaAtualIdx, 'Em andamento'), toast)}>Iniciar {o.etapaAtual}</button>}
              <button className="btn primary" onClick={() => tentar(() => actions.avancarEtapa(o.id, o.etapaAtualIdx, 'Concluída'), toast, () => toast(`${o.etapaAtual} concluída.`))}>Concluir {o.etapaAtual}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {secao && <button className="btn sm" style={{ marginBottom: 10 }} onClick={() => navegar(secao === 'diario' ? '/campo/dia' : '/campo')}>← {secao === 'diario' ? 'Equipe do dia' : 'Início'}</button>}
      {!secao && <Home />}
      {secao === 'dia' && <Dia />}
      {secao === 'diario' && query?.get('local') && <CampoDiario key={`${hoje}|${query.get('local')}|${query.get('obra') ?? ''}`} data={hoje} local={query.get('local') as LocalTrabalho} codigoObra={query.get('obra') || undefined} toast={toast} Fotos={Fotos} />}
      {secao === 'fabrica' && <CampoFluxo key={`fab|${hoje}`} data={hoje} frente="fabrica" toast={toast} Fotos={Fotos} />}
      {secao === 'canteiro' && query?.get('obra') && <CampoFluxo key={`cant|${hoje}|${query.get('obra')}`} data={hoje} frente="canteiro" codigoObra={query.get('obra')!} toast={toast} Fotos={Fotos} />}
      {secao === 'estacao' && <CampoEstacao key={`${hoje}|${query?.get('linha')}`} data={hoje} linha={(query?.get('linha') as LinhaProducao) === 'Montagem' ? 'Montagem' : 'Fabricação'} toast={toast} />}
      {secao === 'tarefas' && <Tarefas />}
      {secao === 'checklist' && <Checklist />}
      {secao === 'producao' && <Producao />}
      {bloq && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setBloq(null)}>
          <div className="modal">
            <h2>Motivo do bloqueio</h2>
            <input autoFocus value={bloq.motivo} onChange={(e) => setBloq({ ...bloq, motivo: e.target.value })} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }} placeholder="ex.: aguardando material" />
            <div className="foot"><button className="btn" onClick={() => setBloq(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.moverTarefa(bloq.id, 'Bloqueada', bloq.motivo), toast, () => setBloq(null))}>Bloquear</button></div>
          </div>
        </div>
      )}
      {el}
    </div>
  );
}
