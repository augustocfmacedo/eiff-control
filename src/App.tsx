import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { CenaEstrutura, IndicadorNav, MicroInteracoes, Revelar } from './ui/motion';
import { dashboard } from './core/engine';
import { actions, inicializar, pode, useStore } from './data/store';
import { Badge, EstadoErro, SkeletonTela, StatusBadge, dataHora } from './ui/components';
import { href, useRota } from './ui/router';
import Login from './screens/Login';
import { trilhaDe } from './core/capacitacao';
import { Assistente } from './ui/Assistente';
import { oportunidadesSemProximaAcao, radarVazio } from './core/radar';
import { Icon, Logotipo, Marca } from './ui/icons';
import { Paleta, ROTAS_NAV, type AcaoPaleta } from './ui/Paleta';
import { Tour, tourVisto } from './ui/Tour';
import { Sugestoes } from './ui/Sugestoes';
import { registrarAcao, registrarVisita } from './data/telemetria';
import { aplicarDensidade, lerDensidade, type Densidade } from './ui/Tabela';
// telas carregadas sob demanda (um chunk por tela): o primeiro carregamento traz so a casca, o painel e o que a rota pede
const Aprovacoes = lazy(() => import('./screens/Aprovacoes'));
const Auditoria = lazy(() => import('./screens/Auditoria'));
const Cadastros = lazy(() => import('./screens/Cadastros'));
const DiretorFinanceiro = lazy(() => import('./screens/DiretorFinanceiro'));
const CaixaEntrada = lazy(() => import('./screens/CaixaEntrada'));
const CentralObras = lazy(() => import('./screens/CentralObras'));
const Checks = lazy(() => import('./screens/Checks'));
const Conciliacao = lazy(() => import('./screens/Conciliacao'));
const Dashboard = lazy(() => import('./screens/Dashboard'));
const Dividas = lazy(() => import('./screens/Dividas'));
const Dre = lazy(() => import('./screens/Dre'));
const LancamentoDetalhe = lazy(() => import('./screens/LancamentoDetalhe'));
const Lancamentos = lazy(() => import('./screens/Lancamentos'));
const Obra360 = lazy(() => import('./screens/Obra360'));
const Obras = lazy(() => import('./screens/Obras'));
const Equipe = lazy(() => import('./screens/Equipe'));
const ApontamentoTela = lazy(() => import('./screens/Apontamento'));
const Campo = lazy(() => import('./screens/Campo'));
const Orcamentos = lazy(() => import('./screens/Orcamentos'));
const Compras = lazy(() => import('./screens/Compras'));
const Producao = lazy(() => import('./screens/Producao'));
const Estoque = lazy(() => import('./screens/Estoque'));
const Capacitacao = lazy(() => import('./screens/Capacitacao'));
const MissionControl = lazy(() => import('./screens/MissionControl'));
const RadarCommandCenter = lazy(() => import('./screens/radar/CommandCenter'));
const RadarHoje = lazy(() => import('./screens/radar/Hoje'));
const RadarEmpresas = lazy(() => import('./screens/radar/Empresas'));
const RadarEmpresa = lazy(() => import('./screens/radar/Empresa'));
const Fluxo13 = lazy(() => import('./screens/Tesouraria').then((m) => ({ default: m.Fluxo13 })));
const Fluxo24 = lazy(() => import('./screens/Tesouraria').then((m) => ({ default: m.Fluxo24 })));
const PosicaoDiaria = lazy(() => import('./screens/Tesouraria').then((m) => ({ default: m.PosicaoDiaria })));

export default function App() {
  const rota = useRota();
  const { ds, usuario, modo, carregando, sessao, sync, erroInicial, pendencias } = useStore();
  useEffect(() => { void inicializar(); }, []);
  // todos os hooks antes de qualquer saida antecipada (regra dos hooks)
  const [recolhida, setRecolhida] = useState<boolean>(() => { try { return localStorage.getItem('eiff-control:sidebar') === 'recolhida'; } catch { return false; } });
  const [tema, setTema] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('eiff-control:tema') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = tema; try { localStorage.setItem('eiff-control:tema', tema); } catch { /* ignore */ } }, [tema]);
  // paleta de comandos (Ctrl+K), densidade das tabelas
  const [paleta, setPaleta] = useState(false);
  const [densidade, setDensidade] = useState<Densidade>(() => lerDensidade());
  useEffect(() => { aplicarDensidade(densidade); }, [densidade]);
  const [escala, setEscala] = useState<'normal' | 'grande'>(() => { try { return localStorage.getItem('eiff-control:escala') === 'grande' ? 'grande' : 'normal'; } catch { return 'normal'; } });
  useEffect(() => { document.documentElement.dataset.escala = escala; try { localStorage.setItem('eiff-control:escala', escala); } catch { /* ignore */ } }, [escala]);
  const lerLista = (chave: string): string[] => { try { const v = JSON.parse(localStorage.getItem(chave) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
  const [favoritos, setFavoritos] = useState<string[]>(() => lerLista('eiff-control:favoritos'));
  const [gruposFechados, setGruposFechados] = useState<string[]>(() => lerLista('eiff-control:grupos'));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaleta((p) => !p); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const acoesPaleta = useMemo<AcaoPaleta[]>(() => [
    { id: 'tema', rotulo: 'Alternar tema claro/escuro', icone: 'sol', executar: () => setTema((t) => (t === 'dark' ? 'light' : 'dark')) },
    { id: 'menu', rotulo: 'Recolher ou expandir o menu', icone: 'menu', executar: () => setRecolhida((r) => { const v = !r; try { localStorage.setItem('eiff-control:sidebar', v ? 'recolhida' : 'aberta'); } catch { /* ignore */ } return v; }) },
    { id: 'densidade', rotulo: 'Alternar densidade das tabelas', sub: 'normal ou compacta', icone: 'densidade', executar: () => setDensidade((d) => (d === 'compacta' ? 'normal' : 'compacta')) },
    { id: 'texto', rotulo: 'Alternar tamanho do texto', sub: 'normal ou grande', icone: 'livro', executar: () => setEscala((e) => (e === 'grande' ? 'normal' : 'grande')) },
    { id: 'tour', rotulo: 'Tour desta tela', sub: 'o que cada bloco faz', icone: 'ajuda', executar: () => setTimeout(() => setTour(true), 200) },
    { id: 'imprimir', rotulo: 'Imprimir a tela atual', icone: 'dre', executar: () => setTimeout(() => window.print(), 150) },
    { id: 'recarregar', rotulo: 'Recarregar dados', icone: 'fluxo', executar: () => { void actions.recarregar().catch(() => undefined); } },
    { id: 'sair', rotulo: 'Sair', icone: 'sair', executar: () => { void actions.sair(); } },
  ], []);
  const chaveTela = `${rota.path}?${rota.query.toString()}`;
  // tour guiado: abre sozinho na primeira visita a cada tela (depois que a tela montou), e pelo "?" da barra ou pela paleta
  const [tour, setTour] = useState(false);
  useEffect(() => { registrarVisita(rota.path); }, [rota.path]);
  useEffect(() => { if (tour) registrarAcao('tour'); }, [tour]);
  useEffect(() => {
    if (modo === 'remoto' && (!sessao || carregando)) return;
    if (rota.partes[0] === 'campo' || tourVisto(rota.path)) return;
    const t = window.setTimeout(() => { if (document.querySelector('.content .page-head')) setTour(true); }, 1400);
    return () => window.clearTimeout(t);
  }, [rota.path, modo, sessao, carregando]);
  if (modo === 'remoto' && carregando) return <div className="carregando"><CenaEstrutura variante="carregando" /><div className="carregando-txt">Carregando dados do Supabase…</div></div>;
  if (modo === 'remoto' && !sessao) return <Login />;
  if (modo === 'remoto' && erroInicial) {
    return (
      <div className="carregando" style={{ placeItems: 'center' }}>
        <div className="card" style={{ maxWidth: 600, width: '92vw', position: 'relative', zIndex: 1 }}>
          <EstadoErro titulo="Não foi possível carregar os dados" causa={erroInicial} acoes={<><button className="btn primary" onClick={() => void actions.recarregar().catch(() => undefined)}>Tentar de novo</button><button className="btn" onClick={() => void actions.sair()}>Sair</button></>}>A sessão continua válida. Verifique a conexão e tente de novo; se persistir, saia e entre novamente.</EstadoErro>
        </div>
      </div>
    );
  }
  const d = dashboard(ds);
  const pend = ds.aprovacoes.filter((a) => a.status === 'Pendente' && a.etapas.find((e) => e.status === 'Pendente')?.papel === usuario.papel && a.solicitante !== usuario.nome).length;
  const tarefas = ds.tarefas.filter((t) => t.status === 'Aberta' && t.responsavel === usuario.id).length;
  const radarHoje = (ds.radar?.tarefas ?? []).filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) <= ds.params.dataBase).length;
  const radarAlertas = oportunidadesSemProximaAcao(ds.radar ?? radarVazio()).length + (ds.radar?.duplicatas ?? []).filter((d) => d.status === 'pendente').length;
  const licoesPendentes = trilhaDe(usuario.papel).filter((l) => !ds.treinamentos.some((t) => t.usuarioId === usuario.id && t.licaoId === l.id)).length;

  const alternarSidebar = () => {
    const v = !recolhida;
    setRecolhida(v);
    try { localStorage.setItem('eiff-control:sidebar', v ? 'recolhida' : 'aberta'); } catch { /* ignore */ }
  };
  // sidebar gerada da mesma lista da paleta (ROTAS_NAV): grupos recolhiveis e favoritos lembrados por navegador
  const contagens: Record<string, number> = {
    '/inbox': pend + tarefas, '/capacitacao': licoesPendentes, '/orcamentos': ds.orcamentos.filter((o) => o.status === 'Rascunho' || o.status === 'Enviado').length,
    '/equipe': ds.tarefas.filter((t) => t.status !== 'Concluída' && t.prazo < ds.params.dataBase).length, '/radar': radarAlertas, '/radar/hoje': radarHoje,
    '/compras': ds.pedidos.filter((p) => p.status === 'Emitido' || p.status === 'Recebido parcial').length, '/aprovacoes': ds.aprovacoes.filter((a) => a.status === 'Pendente').length,
  };
  const rotasVisiveis = ROTAS_NAV.filter((r) => !r.permissao || pode(usuario, r.permissao as never));
  const ativa = (to: string) => rota.path === to || (to !== '/' && to !== '/radar' && rota.path.startsWith(to));
  const alternarFavorito = (to: string) => setFavoritos((f) => { const v = f.includes(to) ? f.filter((x) => x !== to) : [...f, to]; try { localStorage.setItem('eiff-control:favoritos', JSON.stringify(v)); } catch { /* ignore */ } return v; });
  const alternarGrupo = (g: string) => setGruposFechados((f) => { const v = f.includes(g) ? f.filter((x) => x !== g) : [...f, g]; try { localStorage.setItem('eiff-control:grupos', JSON.stringify(v)); } catch { /* ignore */ } return v; });
  const itemNav = (r: (typeof ROTAS_NAV)[number]) => (
    <div key={r.to} className={`nav-item ${favoritos.includes(r.to) ? 'fav' : ''}`}>
      <a href={href(r.to)} className={ativa(r.to) ? 'active' : ''} title={r.rotulo}><span className="nav-ico" aria-hidden="true"><Icon name={r.icone} size={17} /></span><span className="nav-label">{r.rotulo}</span>{contagens[r.to] ? <span className="cnt">{contagens[r.to]}</span> : null}</a>
      <button className="nav-fav" onClick={() => alternarFavorito(r.to)} title={favoritos.includes(r.to) ? 'Tirar dos favoritos' : 'Favoritar'} aria-label={favoritos.includes(r.to) ? 'Tirar dos favoritos' : 'Favoritar'}><Icon name="estrela" size={12} /></button>
    </div>
  );
  const grupos = [...new Set(rotasVisiveis.map((r) => r.grupo))];

  let tela: React.ReactNode;
  const [p0, p1, p2] = rota.partes;
  switch (p0) {
    case undefined: tela = <Dashboard />; break;
    case 'inbox': tela = <CaixaEntrada />; break;
    case 'obras': tela = p1 ? <Obra360 codigo={p1} /> : <Obras />; break;
    case 'central': tela = <CentralObras />; break;
    case 'producao': tela = <Producao query={rota.query} key={rota.query.toString()} />; break;
    case 'estoque': tela = <Estoque query={rota.query} key={rota.query.toString()} />; break;
    case 'capacitacao': tela = <Capacitacao licao={p1} query={rota.query} key={`${p1}-${rota.query.toString()}`} />; break;
    // autorizacao REAL da rota (nao so do menu): sem ver_mission_control a tela nem monta
    case 'mission-control': tela = pode(usuario, 'ver_mission_control')
      ? <MissionControl />
      : <EstadoErro titulo="Acesso restrito" causa={<>O Mission Control da EIFF Central é visível apenas para <b>Administrador</b> e <b>Diretoria</b> nesta fase. Seu perfil (<b>{usuario.papel}</b>) não tem a permissão <code>ver_mission_control</code>.</>}>Peça ao Administrador se precisar acompanhar o estado da construção.</EstadoErro>;
      break;
    case 'radar': tela = p1 === 'hoje' ? <RadarHoje /> : p1 === 'empresas' ? (p2 ? <RadarEmpresa id={p2} key={p2} query={rota.query} /> : <RadarEmpresas query={rota.query} key={rota.query.toString()} />) : <RadarCommandCenter aba0={rota.query.get('aba') ?? undefined} />; break;
    case 'compras': tela = <Compras query={rota.query} key={rota.query.toString()} />; break;
    case 'orcamentos': tela = <Orcamentos id={p1} aba0={rota.query.get('aba') ?? undefined} key={p1 ?? 'lista'} />; break;
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
    case 'diretor': tela = <DiretorFinanceiro aba0={p1} key={p1} />; break;
    case 'auditoria': tela = <Auditoria />; break;
    case 'equipe': tela = <Equipe aba0={p1} key={p1} />; break;
    case 'apontamentos': tela = <ApontamentoTela id={p1 ?? 'novo'} query={rota.query} key={`${p1}-${rota.query.toString()}`} />; break;
    case 'campo': tela = <Campo secao={p1} query={rota.query} key={p1} />; break;
    default: tela = <div className="empty">Página não encontrada.</div>;
  }

  if (p0 === 'campo') {
    return (
      <div className="campo">
        <header className="topbar" style={{ padding: '10px 14px' }}>
          <div className="brand" style={{ padding: 0 }}><Logotipo height={30} /><div className="brand-txt"><b>Control</b><span>Modo campo</span></div></div>
          <div className="spacer" />
          <span className="small">{usuario.nome.split(' ')[0]}</span>
          {modo === 'remoto' && sync.status === 'erro' && <Badge tone="bad">não sincronizado</Badge>}
          {modo === 'remoto' && sync.status === 'pendente' && <Badge tone="warn" title={sync.msg}>offline · guardado no aparelho</Badge>}
          {modo === 'remoto' && <button className="btn sm" onClick={() => void actions.sair()}>Sair</button>}
        </header>
        <main className="content" style={{ padding: 14 }}><Suspense fallback={<SkeletonTela />}><Revelar chave={chaveTela}>{tela}</Revelar></Suspense></main>
      </div>
    );
  }

  return (
    <div className={`app ${recolhida ? 'recolhida' : ''}`}>
      <a className="salto" href="#conteudo" onClick={(e) => { e.preventDefault(); document.getElementById('conteudo')?.focus(); }}>Ir para o conteúdo</a>
      <aside className="sidebar" aria-label="Menu principal">
        <div className="brand">
          {recolhida ? <Marca size={26} /> : <><Logotipo height={40} /><div className="nav-label brand-txt"><b>Control</b><span>Do orçamento ao caixa</span></div></>}
          <button className="btn sm sidebar-toggle" onClick={alternarSidebar} title={recolhida ? 'Expandir menu' : 'Recolher menu'} aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}><Icon name={recolhida ? 'expandir' : 'recolher'} size={16} /></button>
        </div>
        <nav className="nav" aria-label="Telas">
          <IndicadorNav chave={`${rota.path}|${favoritos.join(',')}|${gruposFechados.join(',')}|${recolhida}`} />
          {favoritos.length > 0 && !recolhida && <><h3 className="grupo fixo"><span>Favoritos</span></h3>{favoritos.map((to) => rotasVisiveis.find((r) => r.to === to)).filter((r): r is (typeof ROTAS_NAV)[number] => !!r).map(itemNav)}</>}
          {grupos.map((g) => { const itens = rotasVisiveis.filter((r) => r.grupo === g); const fechado = !recolhida && gruposFechados.includes(g) && !itens.some((r) => ativa(r.to)); return (
            <React.Fragment key={g}>
              {g !== 'Início' && <h3 className={`grupo ${fechado ? 'fechado' : ''}`} onClick={() => alternarGrupo(g)} role="button" aria-expanded={!fechado} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarGrupo(g); } }}><span>{g}</span><Icon name="seta" size={12} /></h3>}
              {!fechado && itens.map(itemNav)}
            </React.Fragment>
          ); })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm" onClick={alternarSidebar} title={recolhida ? 'Expandir menu' : 'Recolher menu'} aria-label="Alternar menu"><Icon name="menu" size={16} /></button>
          <div className="ctx">
            <span><b>{ds.params.empresa}</b></span>
            <span>· data-base <b>{ds.params.dataBase.split('-').reverse().join('/')}</b></span>
            <span>· cenário <b>{ds.params.cenario}</b></span>
            <span>· controles <StatusBadge s={d.statusModelo} /></span>
            {ds.params.incluirDemo && <span className="badge warn">demo</span>}
          </div>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setTour(true)} title="Tour desta tela" aria-label="Tour desta tela"><Icon name="ajuda" size={15} /></button>
          <button className="btn sm busca" onClick={() => setPaleta(true)} title="Buscar ou ir para (Ctrl+K)" aria-label="Buscar"><Icon name="buscar" size={15} /><span className="nav-label">Buscar</span><kbd>Ctrl K</kbd></button>
          <button className="btn sm" onClick={() => setTema(tema === 'dark' ? 'light' : 'dark')} title={tema === 'dark' ? 'Tema claro' : 'Tema escuro'} aria-label="Alternar tema"><Icon name={tema === 'dark' ? 'sol' : 'lua'} size={15} /></button>
          {modo === 'remoto' ? (
            <>
              {sync.status === 'enviando' && <Badge tone="info">sincronizando…</Badge>}
              {sync.status === 'ok' && <Badge tone="ok">Supabase · sincronizado{sync.em ? ` ${dataHora(sync.em)}` : ''}</Badge>}
              {sync.status === 'pendente' && (
                <span className="actions">
                  <Badge tone="warn" title={sync.msg}>offline · alterações guardadas neste aparelho{sync.desde ? ` desde ${dataHora(sync.desde)}` : ''}</Badge>
                  <button className="btn sm" onClick={() => actions.tentarNovamente()}>Enviar agora</button>
                </span>
              )}
              {sync.status === 'erro' && (
                <span className="actions">
                  <Badge tone="bad">não sincronizado</Badge>
                  <span className="small neg" title={sync.msg}>{(sync.msg ?? '').slice(0, 80)}</span>
                  <button className="btn sm" onClick={() => actions.tentarNovamente()}>Tentar de novo</button>
                  <button className="btn sm" onClick={() => void actions.recarregar()}>Recarregar</button>
                  {pendencias && <button className="btn sm danger" onClick={() => { if (window.confirm('Descartar as alterações feitas offline que não puderam ser aplicadas?')) void actions.descartarPendencias(); }}>Descartar pendências</button>}
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
        <main className="content" id="conteudo" tabIndex={-1}><Suspense fallback={<SkeletonTela />}><Revelar chave={chaveTela}><Sugestoes rota={rota.path} />{tela}</Revelar></Suspense></main>
      </div>
      <Paleta aberta={paleta} onFechar={() => setPaleta(false)} acoes={acoesPaleta} permite={(p) => pode(usuario, p as never)} />
      <Tour rota={rota.path} aberto={tour} onFechar={() => setTour(false)} />
      <MicroInteracoes />
      <Assistente tela={rota.path} />
    </div>
  );
}
