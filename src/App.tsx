import React, { useEffect, useState } from 'react';
import { dashboard } from './core/engine';
import { actions, inicializar, pode, useStore } from './data/store';
import { Badge, StatusBadge, dataHora } from './ui/components';
import { href, useRota } from './ui/router';
import Login from './screens/Login';
import Aprovacoes from './screens/Aprovacoes';
import Auditoria from './screens/Auditoria';
import Cadastros from './screens/Cadastros';
import CaixaEntrada from './screens/CaixaEntrada';
import CentralObras from './screens/CentralObras';
import Checks from './screens/Checks';
import Conciliacao from './screens/Conciliacao';
import Dashboard from './screens/Dashboard';
import Dividas from './screens/Dividas';
import Dre from './screens/Dre';
import LancamentoDetalhe from './screens/LancamentoDetalhe';
import Lancamentos from './screens/Lancamentos';
import Obra360 from './screens/Obra360';
import Obras from './screens/Obras';
import { Fluxo13, Fluxo24, PosicaoDiaria } from './screens/Tesouraria';
import Equipe from './screens/Equipe';
import ApontamentoTela from './screens/Apontamento';
import Campo from './screens/Campo';

export default function App() {
  const rota = useRota();
  const { ds, usuario, modo, carregando, sessao, sync, erroInicial } = useStore();
  useEffect(() => { void inicializar(); }, []);
  // todos os hooks antes de qualquer saida antecipada (regra dos hooks)
  const [recolhida, setRecolhida] = useState<boolean>(() => { try { return localStorage.getItem('eiff-control:sidebar') === 'recolhida'; } catch { return false; } });
  if (modo === 'remoto' && carregando) return <div className="empty" style={{ paddingTop: 120 }}>Carregando dados do Supabase…</div>;
  if (modo === 'remoto' && !sessao) return <Login />;
  if (modo === 'remoto' && erroInicial) {
    return (
      <div className="empty" style={{ paddingTop: 100 }}>
        <div className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
          <h2>Não foi possível carregar os dados</h2>
          <div className="alert bad">{erroInicial}</div>
          <p className="small muted">A sessão continua válida. Verifique a conexão e tente de novo; se persistir, saia e entre novamente.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => void actions.recarregar().catch(() => undefined)}>Tentar de novo</button>
            <button className="btn" onClick={() => void actions.sair()}>Sair</button>
          </div>
        </div>
      </div>
    );
  }
  const d = dashboard(ds);
  const pend = ds.aprovacoes.filter((a) => a.status === 'Pendente' && a.etapas.find((e) => e.status === 'Pendente')?.papel === usuario.papel && a.solicitante !== usuario.nome).length;
  const tarefas = ds.tarefas.filter((t) => t.status === 'Aberta' && t.responsavel === usuario.id).length;
  const bancos = pode(usuario, 'ver_bancos');

  const alternarSidebar = () => {
    const v = !recolhida;
    setRecolhida(v);
    try { localStorage.setItem('eiff-control:sidebar', v ? 'recolhida' : 'aberta'); } catch { /* ignore */ }
  };
  const ICONES: Record<string, string> = {
    '/': '📊', '/inbox': '📥', '/central': '🏗️', '/obras': '📁', '/equipe': '👷', '/campo': '📱', '/pagar': '📤', '/receber': '📥', '/lancamentos': '📒', '/aprovacoes': '✅',
    '/posicao': '🏦', '/fluxo13': '📈', '/fluxo24': '📆', '/conciliacao': '🔗', '/dividas': '💳', '/dre': '🧮', '/checks': '🛡️', '/cadastros': '⚙️', '/auditoria': '🔍',
  };
  const nav = (to: string, label: string, cnt?: number) => (
    <a key={to} href={href(to)} className={rota.path === to || (to !== '/' && rota.path.startsWith(to)) ? 'active' : ''} title={label}>
      <span className="nav-ico" aria-hidden="true">{ICONES[to] ?? '•'}</span><span className="nav-label">{label}</span>{cnt ? <span className="cnt">{cnt}</span> : null}
    </a>
  );

  let tela: React.ReactNode;
  const [p0, p1] = rota.partes;
  switch (p0) {
    case undefined: tela = <Dashboard />; break;
    case 'inbox': tela = <CaixaEntrada />; break;
    case 'obras': tela = p1 ? <Obra360 codigo={p1} /> : <Obras />; break;
    case 'central': tela = <CentralObras />; break;
    case 'lancamentos': tela = p1 ? <LancamentoDetalhe id={p1} /> : <Lancamentos modo="todos" query={rota.query} key={rota.query.toString()} />; break;
    case 'pagar': tela = <Lancamentos modo="pagar" query={rota.query} key={'p' + rota.query.toString()} />; break;
    case 'receber': tela = <Lancamentos modo="receber" query={rota.query} key={'r' + rota.query.toString()} />; break;
    case 'aprovacoes': tela = <Aprovacoes query={rota.query} key={rota.query.toString()} />; break;
    case 'posicao': tela = <PosicaoDiaria />; break;
    case 'fluxo13': tela = <Fluxo13 />; break;
    case 'fluxo24': tela = <Fluxo24 />; break;
    case 'conciliacao': tela = <Conciliacao query={rota.query} key={rota.query.toString()} />; break;
    case 'dividas': tela = <Dividas />; break;
    case 'dre': tela = <Dre />; break;
    case 'checks': tela = <Checks />; break;
    case 'cadastros': tela = <Cadastros aba0={p1} key={p1} />; break;
    case 'auditoria': tela = <Auditoria />; break;
    case 'equipe': tela = <Equipe aba0={p1} key={p1} />; break;
    case 'apontamentos': tela = <ApontamentoTela id={p1 ?? 'novo'} query={rota.query} key={`${p1}-${rota.query.toString()}`} />; break;
    case 'campo': tela = <Campo secao={p1} key={p1} />; break;
    default: tela = <div className="empty">Página não encontrada.</div>;
  }

  if (p0 === 'campo') {
    return (
      <div className="campo">
        <header className="topbar" style={{ padding: '10px 14px' }}>
          <div className="brand" style={{ padding: 0 }}><div className="logo">E</div><div><b>EIFF Control</b><span>Modo campo</span></div></div>
          <div className="spacer" />
          <span className="small">{usuario.nome.split(' ')[0]}</span>
          {modo === 'remoto' && sync.status === 'erro' && <Badge tone="bad">não sincronizado</Badge>}
          {modo === 'remoto' && <button className="btn sm" onClick={() => void actions.sair()}>Sair</button>}
        </header>
        <main className="content" style={{ padding: 14 }}>{tela}</main>
      </div>
    );
  }

  return (
    <div className={`app ${recolhida ? 'recolhida' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">E</div>
          <div className="nav-label"><b>EIFF Control</b><span>Do orçamento ao caixa</span></div>
          <button className="btn sm sidebar-toggle" onClick={alternarSidebar} title={recolhida ? 'Expandir menu' : 'Recolher menu'} aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}>{recolhida ? '»' : '«'}</button>
        </div>
        <nav className="nav">
          {nav('/', 'Painel executivo')}
          {nav('/inbox', 'Minha caixa de entrada', pend + tarefas)}
          <h3>Obras</h3>
          {nav('/central', 'Central de obras')}
          {nav('/obras', 'Obras e contratos')}
          {nav('/equipe', 'Equipe e produtividade', ds.tarefas.filter((t) => t.status !== 'Concluída' && t.prazo < ds.params.dataBase).length)}
          {nav('/campo', 'Modo campo (celular)')}
          <h3>Financeiro</h3>
          {nav('/pagar', 'Contas a pagar')}
          {nav('/receber', 'Contas a receber')}
          {nav('/lancamentos', 'Lançamentos')}
          {nav('/aprovacoes', 'Central de aprovações', ds.aprovacoes.filter((a) => a.status === 'Pendente').length)}
          <h3>Tesouraria</h3>
          {bancos && nav('/posicao', 'Posição diária')}
          {nav('/fluxo13', 'Fluxo 13 semanas')}
          {nav('/fluxo24', 'Fluxo 24 meses')}
          {bancos && nav('/conciliacao', 'Bancos e conciliação')}
          {bancos && nav('/dividas', 'Dívidas')}
          <h3>Controladoria</h3>
          {nav('/dre', 'DRE gerencial')}
          {nav('/checks', 'Checks e fechamento')}
          <h3>Administração</h3>
          {nav('/cadastros', 'Cadastros e parâmetros')}
          {pode(usuario, 'ver_auditoria') && nav('/auditoria', 'Auditoria')}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm" onClick={alternarSidebar} title={recolhida ? 'Expandir menu' : 'Recolher menu'} aria-label="Alternar menu">☰</button>
          <div className="ctx">
            <span><b>{ds.params.empresa}</b></span>
            <span>· data-base <b>{ds.params.dataBase.split('-').reverse().join('/')}</b></span>
            <span>· cenário <b>{ds.params.cenario}</b></span>
            <span>· controles <StatusBadge s={d.statusModelo} /></span>
            {ds.params.incluirDemo && <span className="badge warn">demo</span>}
          </div>
          <div className="spacer" />
          {modo === 'remoto' ? (
            <>
              {sync.status === 'enviando' && <Badge tone="info">sincronizando…</Badge>}
              {sync.status === 'ok' && <Badge tone="ok">Supabase · sincronizado{sync.em ? ` ${dataHora(sync.em)}` : ''}</Badge>}
              {sync.status === 'erro' && (
                <span className="actions">
                  <Badge tone="bad">não sincronizado</Badge>
                  <span className="small neg" title={sync.msg}>{(sync.msg ?? '').slice(0, 80)}</span>
                  <button className="btn sm" onClick={() => actions.tentarNovamente()}>Tentar de novo</button>
                  <button className="btn sm" onClick={() => void actions.recarregar()}>Recarregar</button>
                </span>
              )}
              <span className="small"><b>{usuario.nome}</b> · {usuario.papel}</span>
              <button className="btn sm" onClick={() => void actions.sair()}>Sair</button>
            </>
          ) : (
            <label className="small muted">Usuário&nbsp;
              <select value={usuario.id} onChange={(e) => actions.trocarUsuario(e.target.value)} style={{ padding: 4, borderRadius: 6, border: '1px solid var(--border)' }}>
                {ds.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome} · {u.papel}</option>)}
              </select>
            </label>
          )}
        </header>
        <main className="content">{tela}</main>
      </div>
    </div>
  );
}
