// Central de Gestão Comercial EIFF (E11.0) — a tela só APRESENTA o retrato de src/core/comercial/central.ts.
// Nenhuma regra, ordenação de negócio ou gravação aqui: as ações levam para a tela da autoridade (Inbox, Leads do
// site, Radar, Orçamentos). O que ainda não tem contrato oficial (proposta, pedido de projeto, documentos,
// reagendamento, vínculo orçamento × negócio) aparece DESATIVADO com a justificativa à vista.
import React, { useEffect, useMemo, useState } from 'react';
import './central.css';
import {
  AREAS_CENTRAL, CICLOS_DE_VIDA, FASES_JORNADA, NOME_FASE, OPERACOES_CENTRAL, FILTROS_ATENDIMENTO, JANELAS_CENTRAL, NOME_AREA, NOME_ESTAGIO, NOME_FILTRO_ATENDIMENTO, NOME_FONTE_SOLICITACAO, NOME_SITUACAO_PRAZO, NOME_TIPO_RETORNO,
  contarAtendimentos, dossie as montarDossie, ehArea, filtrarAtendimentos, indiceDossies, retratoCentral,
  type AreaCentral, type Dossie, type FaseJornada, type SituacaoImplementacao, type FiltroAtendimento, type FontesCentral, type Indicador, type LinhaAtendimento, type RetratoCentral, type SituacaoPrazo,
} from '../../core/comercial/central';
import { areaNoEscopo, dossieNoEscopo, escopoCentral } from '../../core/comercial/acesso';
import { MARCA_DEMONSTRACAO, demonstracaoCentral } from '../../core/comercial/demonstracao';
import type { EstadoSla } from '../../core/inbox';
import { pode, useStore } from '../../data/store';
import { Badge, Empty, KpiHero, KpiStrip, Link, PageHead, Tabs, data, dataHora, money, pct, type Tone } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { navegar } from '../../ui/router';
import { Tabela, type Coluna } from '../../ui/Tabela';

const NOME_SLA: Record<EstadoSla, string> = { sem_sla: 'sem prazo', no_prazo: 'no prazo', vencendo: 'vencendo', vencido: 'prazo vencido', cumprido: 'respondido no prazo', atrasada: 'respondido fora do prazo', sem_resposta: 'encerrado sem resposta' };
const TOM_SLA: Record<EstadoSla, Tone> = { sem_sla: 'muted', no_prazo: 'ok', vencendo: 'warn', vencido: 'bad', cumprido: 'ok', atrasada: 'warn', sem_resposta: 'bad' };
const TOM_PRAZO: Record<SituacaoPrazo, Tone> = { vencido: 'bad', hoje: 'warn', proximo: 'info', futuro: 'muted' };
const NOME_FORMULARIO: Record<string, string> = { 'simular-galpao': 'Simulador de galpão', 'iniciar-projeto': 'Iniciar projeto' };
const origemTexto = (l: LinhaAtendimento) => (l.origem === 'site' ? `Site · ${NOME_FORMULARIO[l.canalOuFormulario] ?? l.canalOuFormulario}` : `Conversa · ${l.canalOuFormulario}`);
const TOM_FASE: Record<FaseJornada, Tone> = { lead: 'bad', atendimento: 'warn', qualificacao: 'info', estudo: 'info', proposta: 'info', negociacao: 'warn', contratacao: 'ok', perdido: 'muted', nutricao: 'muted', encerrado: 'muted' };
const TOM_IMPL: Record<SituacaoImplementacao, Tone> = { implementado: 'ok', sinal: 'info', a_desenvolver: 'muted' };
const NOME_IMPL: Record<SituacaoImplementacao, string> = { implementado: 'implementado', sinal: 'lido de sinais', a_desenvolver: 'a desenvolver' };
const rotaDe = (area: AreaCentral, extra = '') => `/comercial/gestao?area=${area}${extra}`;
const rotaDossie = (chave: string) => `/comercial/gestao?dossie=${encodeURIComponent(chave)}`;

/** Indicador para os KPIs: número ou «indisponível» (o motivo vai no hint). */
const valorDe = (i: Indicador, fmt: (n: number) => string = (n) => n.toLocaleString('pt-BR')) => (i.valor === null ? 'indisponível' : fmt(i.valor));
const motivoDe = (i: Indicador) => (i.valor === null ? i.motivo : undefined);
const moeda = (n: number) => money(n, true);

/** Ação que ainda não tem contrato oficial: fica desativada e diz por quê (texto visível, não só no hover). */
function SemContrato({ rotulo, motivo }: { rotulo: string; motivo: string }) {
  return <div className="cgc-sem-contrato"><button className="btn sm" disabled aria-disabled="true" title={motivo}>{rotulo}</button><span className="small">{motivo}</span></div>;
}

// A troca de aba muda a URL e o App remonta o conteúdo: lembra (fora do componente) que o foco estava nas abas.
let focarAbaAoMontar = false;

export default function CentralGestao({ query }: { query: URLSearchParams }) {
  const { ds, usuario, modo } = useStore();
  const [demo, setDemo] = useState(false);
  const [filtro, setFiltro] = useState<FiltroAtendimento>('abertos');
  const [busca, setBusca] = useState('');
  const [buscaDossie, setBuscaDossie] = useState('');
  const [responsavel, setResponsavel] = useState('');
  // escopo do perfil (src/core/comercial/acesso.ts): área e dossiê pedidos pela URL nunca passam do que o perfil pode ver
  const escopo = escopoCentral(usuario);
  const area: AreaCentral = areaNoEscopo(escopo, ehArea(query.get('area')) ? query.get('area') : null) ?? 'projetos';
  const dossiePedido = query.get('dossie');
  const chaveDossie = dossieNoEscopo(escopo, dossiePedido);
  const veInbox = pode(usuario, 'inbox');
  const demonstracaoPermitida = modo !== 'remoto' && escopo.demonstracao;
  const emDemo = demo && demonstracaoPermitida;

  const fontes = useMemo<FontesCentral>(() => {
    const base: FontesCentral = { inbox: ds.inbox, radar: ds.radar, orcamentos: ds.orcamentos, catalogo: { insumos: ds.insumos, composicoes: ds.composicoes }, usuarios: ds.usuarios };
    if (!emDemo) return base;
    const d = demonstracaoCentral(ds.params.dataBase, ds.inbox);
    return { ...base, radar: d.radar, orcamentos: d.orcamentos, inbox: d.inbox ?? ds.inbox };
  }, [ds, emDemo]);
  // um único instante por renderização dos dados (o SLA do Inbox depende do relógio)
  const ctx = useMemo(() => ({ usuario, agoraIso: new Date().toISOString(), hoje: ds.params.dataBase, veInbox }), [usuario, ds.params.dataBase, veInbox, fontes]);
  const retrato = useMemo(() => retratoCentral(fontes, ctx), [fontes, ctx]);
  // visão técnica: a tela recebe SÓ a projeção técnica (nada do retrato comercial atravessa as props); índice e dossiê só na integral
  const indice = useMemo(() => (escopo.dossie ? indiceDossies(fontes, retrato) : []), [escopo.dossie, fontes, retrato]);
  // o Revelar esconde o conteúdo durante a entrada (elemento invisível não recebe foco): tenta até a aba aceitar o foco
  useEffect(() => {
    if (!focarAbaAoMontar) return;
    focarAbaAoMontar = false;
    const timers = [0, 150, 400, 800].map((ms) => window.setTimeout(() => { const el = document.querySelector<HTMLElement>('.cgc [role=tab][aria-selected=true]'); if (el && document.activeElement !== el) el.focus(); }, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [area]);
  const dossieAberto = useMemo(() => (chaveDossie ? montarDossie(chaveDossie, fontes, ctx, retrato) : undefined), [chaveDossie, fontes, ctx, retrato]);

  const cabecalho = (
    <>
      <PageHead title="Central de Gestão Comercial" subtitle={<>Quem nos procurou, quem está atendendo, quem precisa de retorno, propostas, pedidos de projeto e pipeline — lidos do EIFF Inbox, do Radar e dos Orçamentos. Data-base {data(retrato.hoje)}.</>}>
        {demonstracaoPermitida && <button className={`btn sm ${emDemo ? 'primary' : ''}`} onClick={() => setDemo((v) => !v)} aria-pressed={emDemo} title="Liga dados fictícios do Radar e de orçamentos (somente nesta tela, nada é gravado)">{emDemo ? 'Desligar demonstração' : 'Ver com demonstração'}</button>}
        <button className="btn sm no-print" onClick={() => window.print()}><Icon name="dre" size={14} /> Imprimir</button>
      </PageHead>
      {emDemo && <div className="cgc-demo" role="note"><Icon name="aviso" size={16} /><span><b>{MARCA_DEMONSTRACAO}.</b> Radar e orçamentos desta tela são exemplos; os leads são o exemplo do EIFF Inbox do modo local.</span></div>}
    </>
  );

  if (escopo.nivel === 'tecnico') {
    return <div className="cgc">{cabecalho}<TecnicoView motivo={escopo.motivo} dossieNegado={!!dossiePedido} /></div>;
  }

  if (chaveDossie) {
    return <div className="cgc">{cabecalho}{dossieAberto ? <DossieView d={dossieAberto} /> : <Empty icone="vazio" titulo="Dossiê não encontrado" acao={<Link className="btn sm" to={rotaDe('visao')}>Voltar à Central</Link>}>A chave «{chaveDossie}» não corresponde a uma empresa do Radar nem a uma conversa visível para você.</Empty>}</div>;
  }

  return (
    <div className="cgc">
      {cabecalho}
      <Tabs value={area} onChange={(a) => { focarAbaAoMontar = document.activeElement?.getAttribute('role') === 'tab'; navegar(rotaDe(a)); }} items={AREAS_CENTRAL.filter((a) => escopo.areas.includes(a)).map((a) => ({ id: a, label: NOME_AREA[a] }))} />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {area === 'visao' && <VisaoGeralView r={retrato} indice={indice} busca={buscaDossie} setBusca={setBuscaDossie} />}
        {area === 'leads' && <LeadsView r={retrato} usuarioId={usuario.id} filtro={filtro} setFiltro={setFiltro} busca={busca} setBusca={setBusca} veInbox={veInbox} responsavel={responsavel} setResponsavel={setResponsavel} />}
        {area === 'retornos' && <RetornosView r={retrato} responsavel={responsavel} setResponsavel={setResponsavel} />}
        {area === 'propostas' && <PropostasView r={retrato} />}
        {area === 'projetos' && <ProjetosView r={retrato} />}
        {area === 'pipeline' && <PipelineView r={retrato} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- A · Visão geral */

function VisaoGeralView({ r, indice, busca, setBusca }: { r: RetratoCentral; indice: { chave: string; titulo: string; sub: string }[]; busca: string; setBusca: (v: string) => void }) {
  const v = r.visao;
  const vencidos = r.retornos.filter((x) => x.situacao === 'vencido').slice(0, 6);
  const aguardando = (r.atendimentos ?? []).filter((l) => l.aberta && !l.ensaio && l.situacao === 'aguardando').slice(0, 6);
  const responsaveis = [...new Set((r.atendimentos ?? []).filter((l) => l.aberta && !l.ensaio).map((l) => l.responsavelNome ?? 'sem responsável'))];
  const termo = busca.trim().toLowerCase();
  const achados = termo.length >= 2 ? indice.filter((i) => `${i.titulo} ${i.sub}`.toLowerCase().includes(termo)).slice(0, 8) : [];
  const perguntas: { q: string; a: Indicador; fmt?: (n: number) => string; to: string; extra?: string }[] = [
    { q: 'Quem pediu orçamento ou projeto?', a: v.pedidosDeProjeto, to: rotaDe('projetos'), extra: v.leadsDoSiteRecebidos.valor !== null ? `${v.leadsDoSiteRecebidos.valor} lead(s) do site em ${JANELAS_CENTRAL.recebidosDias} dias` : undefined },
    { q: 'Quem aguarda o primeiro contato?', a: v.aguardandoPrimeiraResposta, to: rotaDe('leads'), extra: v.primeiraRespostaVencida.valor ? `${v.primeiraRespostaVencida.valor} com prazo vencido` : undefined },
    { q: 'Retornos atrasados', a: v.retornosVencidos, to: rotaDe('retornos'), extra: v.retornosProximos.valor ? `${v.retornosProximos.valor} agendado(s) até ${JANELAS_CENTRAL.proximosDias} dias` : undefined },
    { q: 'Orçamentos técnicos enviados', a: v.orcamentosAguardando, to: rotaDe('propostas') },
    { q: 'Propostas aguardando resposta', a: v.propostasAguardandoResposta, to: rotaDe('propostas'), extra: v.valorPropostasAguardando.valor ? `${moeda(v.valorPropostasAguardando.valor)} estimados` : undefined },
    { q: 'Projetos pedidos à engenharia', a: v.analisesEngenharia, to: rotaDe('projetos') },
    { q: 'Negociações avançando / paradas', a: v.negociacoesAvancando, fmt: (n) => `${n} / ${v.negociacoesParadas.valor ?? '—'}`, to: rotaDe('propostas') },
    { q: `Ganhos / perdidos (${JANELAS_CENTRAL.desfechosDias} dias)`, a: v.ganhos, fmt: (n) => `${n} / ${v.perdidos.valor ?? '—'}`, to: rotaDe('pipeline', '#desfechos') },
    { q: 'Em negociação (valor estimado)', a: v.valorPipeline, fmt: moeda, to: rotaDe('pipeline'), extra: v.oportunidadesSemValor.valor ? `${v.oportunidadesSemValor.valor} sem valor estimado` : undefined },
  ];
  return (
    <>
      <div className="hero-grid">
        <KpiHero label="Precisa de ação agora" value={v.aguardandoPrimeiraResposta.valor === null ? valorDe(v.retornosVencidos) : String((v.aguardandoPrimeiraResposta.valor ?? 0) + (v.retornosVencidos.valor ?? 0))}
          hint={v.aguardandoPrimeiraResposta.valor === null ? `Só retornos do Radar: ${motivoDe(v.aguardandoPrimeiraResposta)}.` : 'Leads aguardando a 1ª resposta + retornos vencidos'}
          tone={(v.primeiraRespostaVencida.valor ?? 0) + (v.retornosVencidos.valor ?? 0) > 0 ? 'bad' : 'ok'} to={rotaDe('retornos')}
          secundarios={[{ label: '1ª resposta vencida', value: valorDe(v.primeiraRespostaVencida), tone: v.primeiraRespostaVencida.valor ? 'neg' : undefined }, { label: 'Sem responsável', value: valorDe(v.semResponsavel) }, { label: 'Sem próxima ação', value: valorDe(v.semProximaAcao), tone: v.semProximaAcao.valor ? 'warn' : undefined }, { label: 'Paradas (CM1-A)', value: valorDe(v.paradas), tone: v.paradas.valor ? 'warn' : undefined }]} />
        <KpiHero label="Em negociação (valor estimado)" value={valorDe(v.valorPipeline, moeda)} hint={motivoDe(v.valorPipeline) ?? `${valorDe(v.oportunidadesAtivas)} oportunidades ativas no Radar; ${valorDe(v.oportunidadesSemValor)} sem valor estimado não somam`} to={rotaDe('pipeline')}
          secundarios={[{ label: 'Ponderado pela probabilidade', value: valorDe(v.valorPonderado, moeda) }, { label: `Ganho (${JANELAS_CENTRAL.desfechosDias} d)`, value: valorDe(v.valorGanho, moeda), tone: 'pos' }, { label: 'Ganhos sem valor', value: valorDe(v.ganhosSemValor) }]} />
      </div>
      <Jornada r={r} />
      <KpiStrip itens={[
        { label: `Leads recebidos (${JANELAS_CENTRAL.recebidosDias} d)`, value: valorDe(v.leadsRecebidos), hint: motivoDe(v.leadsRecebidos), to: rotaDe('leads') },
        { label: 'Atendimentos em aberto', value: valorDe(v.atendimentosPendentes), hint: motivoDe(v.atendimentosPendentes), to: rotaDe('leads') },
        { label: `Retornos até ${JANELAS_CENTRAL.proximosDias} d`, value: valorDe(v.retornosProximos), to: rotaDe('retornos') },
        { label: 'Propostas em andamento', value: valorDe(v.propostasEmAndamento), to: rotaDe('propostas') },
        { label: 'Pedidos de projeto', value: valorDe(v.pedidosDeProjeto), to: rotaDe('projetos') },
        { label: `Ganhos / perdidos (${JANELAS_CENTRAL.desfechosDias} d)`, value: `${valorDe(v.ganhos)} / ${valorDe(v.perdidos)}`, to: rotaDe('pipeline') },
      ]} />
      <div className="card">
        <h2>Respostas rápidas</h2>
        <div className="cgc-perguntas">
          {perguntas.map((p) => (
            <Link key={p.q} className="cgc-pergunta" to={p.to}>
              <span className="q">{p.q}{p.extra && <span className="small muted" style={{ display: 'block' }}>{p.extra}</span>}</span>
              <span className={`a ${p.a.valor === null ? 'indisp' : ''}`} title={motivoDe(p.a)}>{p.a.valor === null ? `indisponível — ${p.a.motivo}` : (p.fmt ?? ((n: number) => n.toLocaleString('pt-BR')))(p.a.valor)}</span>
            </Link>
          ))}
          <div className="cgc-pergunta"><span className="q">Quem está atendendo?</span><span className="a" style={{ fontWeight: 500 }}>{r.atendimentos ? (responsaveis.length ? responsaveis.join(', ') : 'ninguém com conversa aberta') : 'indisponível'}</span></div>
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Aguardando a 1ª resposta</h2>
          {!r.atendimentos ? <p className="small muted">Indisponível: EIFF Inbox não carregado ou sem a permissão inbox.</p>
            : aguardando.length === 0 ? <p className="small muted">Nenhum lead aguardando a primeira resposta.</p>
            : <ul className="cgc-lista">{aguardando.map((l) => <li key={l.threadId}><span><Link to={rotaDossie(l.dossie)}>{l.nome}{l.empresa ? ` · ${l.empresa}` : ''}</Link><span className="sub">{origemTexto(l)} · {l.responsavelNome ?? 'sem responsável'}</span></span><Badge tone={TOM_SLA[l.sla]}>{NOME_SLA[l.sla]}</Badge></li>)}</ul>}
        </div>
        <div className="card">
          <h2>Retornos vencidos</h2>
          {vencidos.length === 0 ? <p className="small muted">Nenhum retorno vencido.</p>
            : <ul className="cgc-lista">{vencidos.map((x) => <li key={x.id}><span><Link to={rotaDossie(x.dossie)}>{x.cliente}</Link><span className="sub">{x.descricao} · {x.responsavelNome ?? 'sem responsável'}</span></span><Badge tone="bad">{x.diasAtraso > 0 ? `${x.diasAtraso} d` : 'vencido'}</Badge></li>)}</ul>}
        </div>
      </div>
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Abrir um dossiê comercial</h2>
        <div className="cgc-busca-dossie"><input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome da empresa ou do contato" aria-label="Buscar dossiê" /><span className="small muted">{indice.length} dossiê(s) com movimento comercial</span></div>
        {achados.length > 0 && <ul className="cgc-lista" style={{ marginTop: 8 }}>{achados.map((i) => <li key={i.chave}><Link to={rotaDossie(i.chave)}>{i.titulo}</Link><span className="sub">{i.sub}</span></li>)}</ul>}
        {termo.length >= 2 && achados.length === 0 && <p className="small muted">Nenhum dossiê com esse nome.</p>}
      </div>
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>O que já opera e o que falta</h2>
        <p className="small muted">A Central não grava: cada operação acontece na tela da autoridade. O que ainda não tem contrato oficial está listado como a desenvolver.</p>
        <ul className="cgc-lista">{OPERACOES_CENTRAL.map((o) => <li key={o.acao}><span>{o.acao}<span className="sub">{o.rota ? <Link to={o.rota}>{o.onde}</Link> : o.onde}</span></span><Badge tone={o.situacao === 'opera' ? 'ok' : 'muted'}>{o.situacao === 'opera' ? 'já opera' : 'a desenvolver'}</Badge></li>)}</ul>
      </div>
    </>
  );
}

/** A jornada Lead recebido → Contratação: quantos clientes (dossiês) em cada fase, mais os desfechos. */
function Jornada({ r }: { r: RetratoCentral }) {
  const p = r.jornada.porFase;
  return (
    <div className="card cgc-jornada" aria-label="Jornada comercial">
      <h2>Jornada comercial <span className="small muted" style={{ fontWeight: 400 }}>· clientes por fase, cada um uma vez</span></h2>
      <ol className="cgc-fases">
        {FASES_JORNADA.map((f) => <li key={f} className={p[f] ? 'tem' : ''}><span className="n">{p[f]}</span><span className="nome">{NOME_FASE[f]}</span></li>)}
      </ol>
      <p className="small muted" style={{ marginTop: 6 }}>Fora da jornada ativa: {p.perdido} perdido(s) · {p.nutricao} em nutrição · {p.encerrado} conversa(s) encerrada(s) sem negócio. Fase = leitura do estado da conversa (Inbox) e do estágio da oportunidade (Radar), sem estado novo.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- B · Leads e atendimentos */

function LeadsView({ r, usuarioId, filtro, setFiltro, busca, setBusca, veInbox, responsavel, setResponsavel }: { r: RetratoCentral; usuarioId: string; filtro: FiltroAtendimento; setFiltro: (f: FiltroAtendimento) => void; busca: string; setBusca: (v: string) => void; veInbox: boolean; responsavel: string; setResponsavel: (v: string) => void }) {
  if (!r.atendimentos) return <Empty icone="atendimento" titulo="Leads e atendimentos indisponíveis">{veInbox ? 'O EIFF Inbox não foi carregado nesta sessão.' : 'Seu perfil não tem a permissão inbox, que é a autoridade das conversas e do SLA.'}</Empty>;
  const contagem = contarAtendimentos(r.atendimentos, usuarioId);
  const linhas = filtrarAtendimentos(r.atendimentos, filtro, usuarioId, busca).filter((l) => !responsavel || (responsavel === '-' ? !l.responsavelId : l.responsavelId === responsavel));
  const responsaveis = [...new Map(r.atendimentos.filter((l) => l.responsavelId).map((l) => [l.responsavelId!, l.responsavelNome ?? l.responsavelId!])).entries()];
  const colunas: Coluna<LinhaAtendimento>[] = [
    { titulo: 'Recebido', ordenar: (l) => l.recebidoEm, largura: 110 },
    { titulo: 'Contato / empresa', ordenar: (l) => l.nome },
    { titulo: 'Origem', ordenar: (l) => origemTexto(l) },
    { titulo: 'Configuração declarada (preliminar)', title: 'Como o visitante informou no simulador; não é orientação de engenharia' },
    { titulo: 'Responsável', ordenar: (l) => l.responsavelNome ?? '' },
    { titulo: 'Fase', ordenar: (l) => l.aberta ? (l.situacao === 'aguardando' ? 0 : 1) : 2 },
    { titulo: '1ª resposta (SLA)', ordenar: (l) => l.sla },
    { titulo: 'Próxima ação' },
  ];
  return (
    <>
      <div className="chips" role="group" aria-label="Filtrar atendimentos">
        {FILTROS_ATENDIMENTO.map((f) => <button key={f} className={`chip ${filtro === f ? 'on' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{NOME_FILTRO_ATENDIMENTO[f]}<span className="n">{contagem[f]}</span></button>)}
      </div>
      <div className="filters"><input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, empresa, cidade, medidas…" aria-label="Buscar atendimentos" style={{ minWidth: 0, flex: '1 1 240px' }} /><FiltroResponsavel valor={responsavel} setValor={setResponsavel} opcoes={responsaveis} /></div>
      <Tabela colunas={colunas} linhas={linhas} chave={(l) => l.threadId} onLinha={(l) => navegar(rotaDossie(l.dossie))} vazio="Nenhum atendimento neste filtro."
        linha={(l) => (<>
          <td className="small">{dataHora(l.recebidoEm)}</td>
          <td><b>{l.nome}</b>{l.ensaio && <> <Badge tone="muted">ensaio</Badge></>}<div className="small muted">{[l.empresa, l.cidade].filter(Boolean).join(' · ') || 'empresa não informada'}</div></td>
          <td className="small">{origemTexto(l)}</td>
          <td className="small">{l.configuracao || l.medidas ? <>{l.configuracao}{l.medidas && <div className="muted">{l.medidas}</div>}</> : <span className="muted">não informada</span>}</td>
          <td className="small">{l.responsavelNome ?? <Badge tone="warn">sem responsável</Badge>}</td>
          <td><FaseLinha l={l} r={r} /></td>
          <td><Badge tone={TOM_SLA[l.sla]}>{NOME_SLA[l.sla]}</Badge>{l.prazoAte && l.situacao === 'aguardando' && <div className="small muted">até {dataHora(l.prazoAte)}</div>}</td>
          <td className="small">{l.proximaAcao}<div><Link to={l.link} onClick={(e) => e.stopPropagation()}>{l.origem === 'site' ? 'Atender em Leads do site' : 'Abrir no Inbox'}</Link></div></td>
        </>)} />
      <p className="small muted" style={{ marginTop: 8 }}>Autoridade: EIFF Inbox. Leads do site seguem a ordem de trabalho do Inbox; o prazo de 1ª resposta do site é de 30 minutos úteis e só contato realizado o cumpre. Qualificação: a classificação do Inbox quando existe — não há qualificação comercial própria nesta versão. Clique na linha para o dossiê.</p>
    </>
  );
}

function FiltroResponsavel({ valor, setValor, opcoes }: { valor: string; setValor: (v: string) => void; opcoes: [string, string][] }) {
  return <select value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Filtrar por responsável" style={{ flex: '0 1 220px', minWidth: 0 }}><option value="">Todos os responsáveis</option><option value="-">Sem responsável</option>{opcoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select>;
}

/** Fase do cliente na jornada: a do dossiê (empresa com oportunidade vale mais que a conversa). */
function FaseLinha({ l, r }: { l: LinhaAtendimento; r: RetratoCentral }) {
  const f = l.ensaio ? undefined : r.jornada.dossies.find((d) => d.chave === l.dossie)?.fase;
  return f ? <Badge tone={TOM_FASE[f]}>{NOME_FASE[f]}</Badge> : <span className="small muted">—</span>;
}

/* ---------------------------------------------------------------- C · Retornos */

function RetornosView({ r, responsavel, setResponsavel }: { r: RetratoCentral; responsavel: string; setResponsavel: (v: string) => void }) {
  const itens = r.retornos.filter((x) => !responsavel || (responsavel === '-' ? !x.responsavelId : x.responsavelId === responsavel));
  const responsaveis = [...new Map(r.retornos.filter((x) => x.responsavelId).map((x) => [x.responsavelId!, x.responsavelNome ?? x.responsavelId!])).entries()];
  const grupos: SituacaoPrazo[] = ['vencido', 'hoje', 'proximo', 'futuro'];
  const cols: Coluna<RetratoCentral['retornos'][number]>[] = [
    { titulo: 'Prazo', ordenar: (x) => x.venceEm, largura: 110 }, { titulo: 'Cliente', ordenar: (x) => x.cliente }, { titulo: 'O que fazer' }, { titulo: 'Tipo', ordenar: (x) => x.tipo }, { titulo: 'Responsável', ordenar: (x) => x.responsavelNome ?? '' }, { titulo: 'Situação', ordenar: (x) => x.situacao },
  ];
  return (
    <>
      <div className="filters"><FiltroResponsavel valor={responsavel} setValor={setResponsavel} opcoes={responsaveis} /></div>
      <KpiStrip itens={grupos.map((g) => ({ label: NOME_SITUACAO_PRAZO[g], value: String(itens.filter((x) => x.situacao === g).length), tone: g === 'vencido' && itens.some((x) => x.situacao === 'vencido') ? 'neg' as const : undefined }))} />
      <div className="card">
        <h2>Agenda: próximas ações e retornos prometidos</h2>
        <Tabela colunas={cols} linhas={itens} chave={(x) => x.id} onLinha={(x) => navegar(rotaDossie(x.dossie))} vazio="Nenhum retorno com prazo."
          linha={(x) => (<>
            <td className="small">{data(x.venceEm)}</td><td><b>{x.cliente}</b></td><td className="small">{x.descricao}</td><td className="small">{NOME_TIPO_RETORNO[x.tipo]}</td>
            <td className="small">{x.responsavelNome ?? <Badge tone="warn">sem responsável</Badge>}</td>
            <td><Badge tone={TOM_PRAZO[x.situacao]}>{x.situacao === 'vencido' && x.diasAtraso > 0 ? `vencido há ${x.diasAtraso} d` : NOME_SITUACAO_PRAZO[x.situacao]}</Badge> <Link to={x.link} onClick={(e) => e.stopPropagation()} className="small">abrir</Link></td>
          </>)} />
        <div className="actions" style={{ marginTop: 10 }}><SemContrato rotulo="Reagendar" motivo="Sem histórico de reagendamento: a tarefa e a próxima ação guardam só o prazo atual. Reagende na tela da empresa no Radar." /></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Oportunidades sem próxima ação</h2>
          <p className="small muted">Regra do Radar: oportunidade ativa precisa de próxima ação ou tarefa aberta.</p>
          {r.semProximaAcao.length === 0 ? <p className="small muted">Nenhuma.</p> : <ul className="cgc-lista">{r.semProximaAcao.map((o) => <li key={o.oportunidadeId}><span><Link to={rotaDossie(o.dossie)}>{o.cliente}</Link><span className="sub">{o.titulo} · {NOME_ESTAGIO[o.estagio]}</span></span><Badge tone="warn">obrigatória</Badge></li>)}</ul>}
        </div>
        <div className="card">
          <h2>Oportunidades paradas</h2>
          <p className="small muted">Pela fila da Commercial Machine ({r.versaoFila}): dias sem movimento acima do SLA do estágio.</p>
          {r.paradas.length === 0 ? <p className="small muted">Nenhuma parada.</p> : <ul className="cgc-lista">{r.paradas.map((o) => <li key={o.oportunidadeId}><span><Link to={rotaDossie(o.dossie)}>{o.cliente}</Link><span className="sub">{o.titulo} · {NOME_ESTAGIO[o.estagio]} · fila: {o.categoria}</span></span><Badge tone={o.critica ? 'bad' : 'warn'}>{o.dias} d</Badge></li>)}</ul>}
        </div>
      </div>
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Acompanhamentos registrados</h2>
        {r.acompanhamentos.length === 0 ? <p className="small muted">Nenhuma atividade registrada no Radar.</p>
          : <ul className="cgc-lista">{r.acompanhamentos.map((a) => <li key={a.id}><span><Link to={rotaDossie(a.dossie)}>{a.cliente}</Link><span className="sub">{a.tipo} · {a.canal}{a.resultado ? ` · ${a.resultado}` : ''}{a.notas ? ` — ${a.notas}` : ''}</span></span><span className="small muted">{data(a.em.slice(0, 10))}{a.autor ? ` · ${a.autor}` : ''}</span></li>)}</ul>}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- D · Orçamentos e propostas */

function PropostasView({ r }: { r: RetratoCentral }) {
  const parada = (id: string) => r.paradas.find((x) => x.oportunidadeId === id);
  const colsOrc: Coluna<RetratoCentral['orcamentos'][number]>[] = [
    { titulo: 'Código', ordenar: (o) => o.codigo }, { titulo: 'Orçamento / cliente (texto do orçamento)', ordenar: (o) => o.cliente }, { titulo: 'Situação', ordenar: (o) => o.status },
    { titulo: 'Data', ordenar: (o) => o.data }, { titulo: 'Validade', ordenar: (o) => o.validade ?? '' }, { titulo: 'Custo', num: true, ordenar: (o) => o.custoTotal }, { titulo: 'Preço', num: true, ordenar: (o) => o.precoTotal }, { titulo: 'Margem', num: true, ordenar: (o) => o.pctMargem },
  ];
  const colsProp: Coluna<RetratoCentral['propostas'][number]>[] = [
    { titulo: 'Cliente / oportunidade', ordenar: (p) => p.cliente }, { titulo: 'Estágio', ordenar: (p) => p.estagio }, { titulo: 'Valor estimado', num: true, ordenar: (p) => p.valorEstimado ?? -1 },
    { titulo: 'Prob.', num: true, ordenar: (p) => p.probabilidade }, { titulo: 'No estágio', num: true, ordenar: (p) => p.diasNoEstagio ?? -1 }, { titulo: 'Revisões registradas', num: true, ordenar: (p) => p.propostasRegistradas },
    { titulo: 'Previsão', ordenar: (p) => p.previsaoFechamento ?? '' }, { titulo: 'Próxima ação' },
  ];
  const desfechos = r.desfechos.slice(0, 20);
  return (
    <>
      <div className="card">
        <h2>Três ciclos distintos</h2>
        <p className="small muted">Orçamento técnico (custo), proposta comercial (o que o cliente recebe) e solicitação de projeto (pedido à engenharia) não são a mesma coisa. Só o primeiro tem entidade própria hoje.</p>
        <div className="grid cols-3">{CICLOS_DE_VIDA.map((c) => (
          <div key={c.id} className="cgc-ciclo">
            <h3>{c.nome}</h3>
            <p className="small">{c.oQueE} <span className="muted">Dono: {c.dono}.</span></p>
            <ol className="cgc-estados">{c.estados.map((e) => <li key={e.nome}><span>{e.nome}</span><Badge tone={TOM_IMPL[e.situacao]}>{NOME_IMPL[e.situacao]}</Badge></li>)}</ol>
            <p className="small"><b>Hoje:</b> {c.hoje}</p>
            <p className="small muted"><b>Falta:</b> {c.falta}</p>
          </div>
        ))}</div>
      </div>
      <div className="card">
        <h2>Orçamentos técnicos</h2>
        <p className="small muted">Do módulo de Orçamentos (custo das composições, BDI e preço). O cliente é o texto do orçamento: não há vínculo canônico com a empresa ou a oportunidade do Radar.</p>
        <Tabela colunas={colsOrc} linhas={r.orcamentos} chave={(o) => o.id} onLinha={(o) => navegar(o.link)} vazio="Nenhum orçamento cadastrado."
          linha={(o) => (<>
            <td><b>{o.codigo}</b></td><td>{o.titulo}<div className="small muted">{o.cliente}</div></td><td><Badge tone={o.status === 'Enviado' ? 'info' : o.status === 'Aprovado' || o.status === 'Contratado' ? 'ok' : o.status === 'Perdido' || o.status === 'Cancelado' ? 'bad' : 'muted'}>{o.status}</Badge></td>
            <td className="small">{data(o.data)}</td><td className="small">{o.validade ? data(o.validade) : '—'}{o.validadeVencida && <> <Badge tone="bad">vencida</Badge></>}</td>
            <td className="num">{money(o.custoTotal)}</td><td className="num">{money(o.precoTotal)}</td><td className="num">{o.precoTotal > 0 ? pct(o.pctMargem) : '—'}{o.incompletos > 0 && <div className="small muted">{o.incompletos} item(ns) sem custo</div>}</td>
          </>)} />
        <div className="actions" style={{ marginTop: 10 }}><SemContrato rotulo="Vincular orçamento à oportunidade" motivo="Não existe campo de vínculo orçamento × oportunidade/empresa. Ligar por nome seria adivinhar; o vínculo exige contrato próprio (ver lacunas)." /></div>
      </div>
      <div className="card">
        <h2>Propostas em andamento <Badge tone="muted">sinal do Radar</Badge></h2>
        <p className="small muted">Não há entidade de proposta com revisões, condições e validade. Aqui estão as oportunidades em Precificação, Proposta enviada e Negociação; «revisões registradas» são as atividades do tipo Proposta.</p>
        <Tabela colunas={colsProp} linhas={r.propostas} chave={(p) => p.oportunidadeId} onLinha={(p) => navegar(rotaDossie(p.dossie))} vazio="Nenhuma oportunidade em estágio de proposta."
          linha={(p) => (<>
            <td><b>{p.cliente}</b><div className="small muted">{p.titulo}</div></td><td><Badge tone={p.estagio === 'NEGOTIATION' ? 'warn' : 'info'}>{NOME_ESTAGIO[p.estagio]}</Badge>{p.estagio !== 'PRICING' && <div className="small">{parada(p.oportunidadeId) ? <span className="neg">parada há {parada(p.oportunidadeId)!.dias} d</span> : <span className="muted">avançando</span>}</div>}</td>
            <td className="num">{p.valorEstimado !== undefined ? money(p.valorEstimado) : <span className="muted">sem valor</span>}</td><td className="num">{pct(p.probabilidade)}</td>
            <td className="num">{p.diasNoEstagio !== undefined ? `${p.diasNoEstagio} d` : '—'}</td><td className="num">{p.propostasRegistradas}{p.ultimaPropostaEm && <div className="small muted">últ. {data(p.ultimaPropostaEm.slice(0, 10))}</div>}</td>
            <td className="small">{p.previsaoFechamento ? data(p.previsaoFechamento) : '—'}</td><td className="small">{p.proximaAcao ?? <span className="muted">sem próxima ação</span>}{p.proximaAcaoEm && <div className="muted">{data(p.proximaAcaoEm)}</div>}</td>
          </>)} />
        <div className="actions" style={{ marginTop: 10 }}><SemContrato rotulo="Registrar proposta / revisão" motivo="Sem entidade de proposta (número, revisão, condições, validade, aceite). Hoje: registre uma atividade «Proposta» e mude o estágio na empresa do Radar." /></div>
      </div>
      <div className="card">
        <h2>Ganhos e perdidos</h2>
        {desfechos.length === 0 ? <p className="small muted">Nenhuma oportunidade ganha ou perdida.</p>
          : <ul className="cgc-lista">{desfechos.map((d) => <li key={d.oportunidadeId}><span><Link to={rotaDossie(d.dossie)}>{d.cliente}</Link><span className="sub">{d.titulo}{d.motivo ? ` · motivo: ${d.motivo}` : ' · motivo não registrado'}</span></span><span style={{ textAlign: 'right' }}><Badge tone={d.resultado === 'WON' ? 'ok' : 'bad'}>{d.resultado === 'WON' ? 'Ganha' : 'Perdida'}</Badge><span className="sub">{d.fechadoEm ? data(d.fechadoEm.slice(0, 10)) : 'sem data'}{d.resultado === 'WON' ? ` · ${d.valorFechado !== undefined ? money(d.valorFechado) : 'valor não confirmado'}` : ''}</span></span></li>)}</ul>}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- E · Solicitações de projeto */

function ProjetosView({ r }: { r: RetratoCentral }) {
  const cols: Coluna<RetratoCentral['solicitacoes'][number]>[] = [
    { titulo: 'Solicitado em', ordenar: (s) => s.solicitadaEm, largura: 110 }, { titulo: 'Cliente', ordenar: (s) => s.cliente }, { titulo: 'Tipo', ordenar: (s) => s.tipo }, { titulo: 'Dados técnicos / escopo' },
    { titulo: 'Fonte', ordenar: (s) => s.fonte }, { titulo: 'Responsável', ordenar: (s) => s.responsavelNome ?? '' }, { titulo: 'Prazo', ordenar: (s) => s.prazo ?? '' }, { titulo: 'Situação', ordenar: (s) => s.situacao }, { titulo: 'Formalizar' },
  ];
  return (
    <>
    <div className="card">
      <h2>Solicitações formais à Engenharia</h2>
      <p className="small muted">O pedido de projeto agora é uma solicitação própria, com responsável técnico, prazo, pendências, entrega e histórico (Comercial → Engenharia → Comercial).</p>
      <div className="actions" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn sm primary" to="/comercial/projetos">Abrir solicitações de projeto</Link>
        <Link className="btn sm" to="/comercial/projetos/novo">Nova solicitação</Link>
      </div>
    </div>
    <div className="card" style={{ marginTop: 'var(--space-4)' }}>
      <h2>Sinais de pedido de projeto <Badge tone="muted">ainda não formalizados</Badge></h2>
      <p className="small muted">Juntas três fontes, sem duplicar: lead do site com configuração do simulador, oportunidade em «Projeto recebido» ou «Engenharia» e atividade com resultado «pediu orçamento / análise técnica». Formalize a partir da oportunidade.</p>
      <Tabela colunas={cols} linhas={r.solicitacoes} chave={(s) => s.id} onLinha={(s) => navegar(rotaDossie(s.dossie))} vazio="Nenhuma solicitação de projeto identificada."
        linha={(s) => (<>
          <td className="small">{data(s.solicitadaEm.slice(0, 10))}</td><td><b>{s.cliente}</b></td><td className="small">{s.tipo}</td>
          <td className="small">{s.dadosTecnicos.length ? s.dadosTecnicos.join(' · ') : <span className="muted">não informados</span>}{s.escopo && <div className="muted">{s.escopo}</div>}</td>
          <td className="small">{NOME_FONTE_SOLICITACAO[s.fonte]}</td><td className="small">{s.responsavelNome ?? <span className="muted">—</span>}</td>
          <td className="small">{s.prazo ? (s.prazo.length > 10 ? dataHora(s.prazo) : data(s.prazo)) : '—'}</td><td className="small">{s.situacao}</td>
          <td className="small" onClick={(e) => e.stopPropagation()}>{s.fonte === 'oportunidade'
            ? <Link to={`/comercial/projetos/novo?empresa=${encodeURIComponent(s.dossie.replace(/^empresa:/, ''))}&oportunidade=${encodeURIComponent(s.id.replace(/^oportunidade:/, ''))}`}>Abrir solicitação</Link>
            : s.dossie.startsWith('empresa:') ? <Link to={`/comercial/projetos/novo?empresa=${encodeURIComponent(s.dossie.replace(/^empresa:/, ''))}`}>Abrir solicitação</Link>
              : <span className="muted" title="Sem empresa no Radar: promova o candidato no Lead Engine antes">promover o lead antes</span>}</td>
        </>)} />
      <div className="actions" style={{ marginTop: 10, gap: 16, flexWrap: 'wrap' }}>
        <SemContrato rotulo="Anexar documentos" motivo="Ainda não há armazenamento de documentos de projeto: a solicitação registra a situação de cada documento; os arquivos vêm com a persistência." />
      </div>
    </div>
    </>
  );
}

/* ---------------------------------------------------------------- Visão técnica (Engenharia) */

/**
 * O que a Engenharia vê na Central: o atalho para as solicitações formais (PedidosProjeto.tsx). Sem dossiê, sem links
 * para a conversa ou para a empresa no Radar, sem valores, sem nome da pessoa, sem observações comerciais.
 */
function TecnicoView({ motivo, dossieNegado }: { motivo: string; dossieNegado: boolean }) {
  return (
    <>
      <div className="cgc-lacuna" role="note"><b>Visão técnica.</b> {motivo}</div>
      {dossieNegado && <div className="cgc-lacuna" role="alert" style={{ marginTop: 8 }}>O dossiê comercial não está disponível para o seu perfil.</div>}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Solicitações de projeto encaminhadas à Engenharia</h2>
        <p className="small muted">O Comercial encaminha cada pedido como uma solicitação formal, vinculada à oportunidade; a Engenharia recebe só os dados técnicos, os documentos e as pendências. Nada do Inbox Comercial é aberto para isso.</p>
        <div className="actions" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm primary" to="/comercial/projetos?filtro=engenharia">Abrir solicitações com a Engenharia</Link>
          <Link className="btn sm" to="/comercial/projetos?filtro=minhas">Atribuídas a mim</Link>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- F · Pipeline */

function PipelineView({ r }: { r: RetratoCentral }) {
  const p = r.pipeline;
  const maior = Math.max(1, ...p.etapas.map((e) => e.quantidade));
  const mes = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
  const ganhos = r.desfechos.filter((d) => d.resultado === 'WON');
  const perdidos = r.desfechos.filter((d) => d.resultado === 'LOST');
  return (
    <>
      <KpiStrip itens={[
        { label: 'Oportunidades ativas', value: String(p.ativas) }, { label: 'Valor estimado', value: valorDe(r.visao.valorPipeline, moeda), hint: motivoDe(r.visao.valorPipeline) },
        { label: 'Ponderado', value: valorDe(r.visao.valorPonderado, moeda), hint: 'valor × probabilidade registrada' }, { label: 'Sem valor estimado', value: String(p.semValor), tone: p.semValor ? 'warn' : undefined },
        { label: 'Previsão vencida', value: String(p.previsaoVencida), tone: p.previsaoVencida ? 'warn' : undefined, hint: 'data de fechamento no passado' },
      ]} />
      <div className="card">
        <h2>Etapas</h2>
        {p.ativas === 0 ? <p className="small muted">Nenhuma oportunidade ativa no Radar.</p>
          : <div className="cgc-etapas">{p.etapas.map((e) => <div className="cgc-etapa" key={e.estagio}><span>{e.nome} <span className="muted">({e.quantidade})</span></span><div className="cgc-barra" aria-hidden="true"><span style={{ width: `${(e.quantidade / maior) * 100}%` }} /></div><span className="v">{e.comValor ? money(e.valor, true) : e.quantidade ? <span className="muted">sem valor</span> : '—'}</span></div>)}</div>}
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Previsão de fechamento</h2>
          <p className="small muted">Só oportunidades ativas com valor estimado e previsão de fechamento registrados; ponderado pela probabilidade registrada. {p.foraDaPrevisao} sem valor ou sem previsão ficam de fora.</p>
          <ul className="cgc-lista">{p.previsao.map((m) => <li key={m.mes}><span>{mes(m.mes)}<span className="sub">{m.quantidade} oportunidade(s)</span></span><span style={{ textAlign: 'right' }}><b>{money(m.ponderado, true)}</b><span className="sub">de {money(m.valor, true)} estimados</span></span></li>)}</ul>
        </div>
        <div className="card" id="desfechos">
          <h2>Ganhas e perdidas</h2>
          <KpiStrip itens={[{ label: 'Ganhas (total)', value: String(ganhos.length), tone: 'pos' }, { label: 'Perdidas (total)', value: String(perdidos.length), tone: perdidos.length ? 'neg' : undefined }, { label: 'Valor fechado confirmado', value: money(ganhos.reduce((s, d) => s + (d.valorFechado ?? 0), 0), true) }]} />
          <p className="small muted">Valor fechado vem só do que foi confirmado ao marcar ganha; o estimado nunca vira valor de venda. Motivos de ganho e perda em «Orçamentos e propostas».</p>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Dossiê */

function DossieView({ d }: { d: Dossie }) {
  const fase = d.fase;
  return (
    <>
      <div className="card">
        <div className="cgc-dossie-cab">
          <div><div className="small muted">Dossiê comercial · {d.empresa ? 'empresa do Radar' : 'contato do Inbox'}</div><h2 style={{ margin: '2px 0' }}>{d.titulo}</h2><div className="small muted">{d.subtitulo}</div>{fase && <div style={{ marginTop: 6 }}><span className="small muted">Situação comercial atual: </span><Badge tone={TOM_FASE[fase]}>{NOME_FASE[fase]}</Badge></div>}</div>
          <div className="actions"><Link className="btn sm" to={rotaDe('visao')}>Voltar à Central</Link>{d.links.map((l) => <Link key={l.to} className="btn sm" to={l.to}>{l.rotulo}</Link>)}</div>
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Próxima atividade e responsáveis</h2>
          {d.proximaAtividade ? <p><b>{d.proximaAtividade.descricao}</b><span className="small muted" style={{ display: 'block' }}>{d.proximaAtividade.fonte}{d.proximaAtividade.venceEm ? ` · prazo ${data(d.proximaAtividade.venceEm)}` : ''}</span>{d.proximaAtividade.situacao && <Badge tone={TOM_PRAZO[d.proximaAtividade.situacao]}>{NOME_SITUACAO_PRAZO[d.proximaAtividade.situacao]}</Badge>}</p>
            : <p className="small muted">Nenhuma próxima atividade registrada.</p>}
          {d.filaCM ? <div className="cgc-lacuna"><b>Fila da Commercial Machine:</b> posição {d.filaCM.posicao} · {d.filaCM.categoria} — {d.filaCM.razao}{d.filaCM.venceEm ? ` (prazo ${data(d.filaCM.venceEm)})` : ''}{d.filaCM.contato ? ` · abordar ${d.filaCM.contato}` : ''}. <Link to="/radar/hoje">Abrir Radar · Hoje</Link></div>
            : d.empresa ? <div className="cgc-lacuna">Esta conta não está na fila da Commercial Machine hoje.</div> : null}
          <dl className="kv">{d.responsaveis.length === 0 ? <><dt>Responsável</dt><dd className="muted">nenhum registrado</dd></> : d.responsaveis.map((x) => <React.Fragment key={x.papel}><dt>{x.papel}</dt><dd>{x.nome}</dd></React.Fragment>)}</dl>
        </div>
        <div className="card">
          <h2>Contatos</h2>
          {d.contatos.length === 0 ? <p className="small muted">Nenhum contato.</p> : <ul className="cgc-lista">{d.contatos.map((c) => <li key={`${c.fonte}:${c.id}`}><span>{c.nome}<span className="sub">{c.cargo ?? ''}{c.cargo && c.canais.length ? ' · ' : ''}{c.canais.join(' · ')}</span></span><Badge tone="muted">{c.fonte}</Badge></li>)}</ul>}
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Origem</h2>
          {d.origens.length === 0 ? <p className="small muted">Origem não registrada.</p> : <ul className="cgc-lista">{d.origens.map((o, i) => <li key={i}><span>{o.link ? <Link to={o.link}>{o.tipo}</Link> : o.tipo}<span className="sub">{o.descricao}</span></span><span className="small muted">{o.em ? dataHora(o.em) : ''}</span></li>)}</ul>}
        </div>
        <div className="card">
          <h2>Dados preenchidos no simulador</h2>
          {d.configuracao ? <dl className="kv">
            <dt>Formulário</dt><dd>{NOME_FORMULARIO[d.configuracao.formulario] ?? d.configuracao.formulario} · {dataHora(d.configuracao.em)}</dd>
            {d.configuracao.configuracao && <><dt>Configuração</dt><dd>{d.configuracao.configuracao}</dd></>}
            {d.configuracao.medidas && <><dt>Medidas</dt><dd>{d.configuracao.medidas}</dd></>}
            {d.configuracao.especificacao && <><dt>Uso</dt><dd>{d.configuracao.especificacao}</dd></>}
            {d.configuracao.escopo && <><dt>Escopo</dt><dd>{d.configuracao.escopo}</dd></>}
            {d.configuracao.prazo && <><dt>Prazo informado</dt><dd>{d.configuracao.prazo}</dd></>}
          </dl> : <p className="small muted">Sem configuração do simulador para este cliente.</p>}
          <p className="small muted" style={{ marginTop: 6 }}><Badge tone="warn">declaração preliminar</Badge> Como o visitante informou no site; não é orientação de engenharia nem dado verificado.</p>
        </div>
      </div>
      {d.solicitacoesDoSite.length > 1 && <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Solicitações recebidas pelo site ({d.solicitacoesDoSite.length})</h2>
        <p className="small muted">Cada envio do formulário é uma solicitação própria; declaração preliminar do cliente, não orientação de engenharia.</p>
        <ul className="cgc-lista">{d.solicitacoesDoSite.map((s) => <li key={`${s.threadId}:${s.em}`}><span>{s.solicitacao.configuracao ?? s.solicitacao.mensagem ?? 'sem configuração informada'}<span className="sub">{[s.solicitacao.medidas, s.solicitacao.especificacao, s.solicitacao.prazo ? `prazo: ${s.solicitacao.prazo}` : undefined].filter(Boolean).join(' · ')}</span></span><span className="small muted">{NOME_FORMULARIO[s.formulario] ?? s.formulario} · {dataHora(s.em)}</span></li>)}</ul>
      </div>}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Oportunidades, orçamentos e pedidos de projeto</h2>
        {d.oportunidades.length === 0 ? <p className="small muted">Nenhuma oportunidade no Radar.</p>
          : <ul className="cgc-lista">{d.oportunidades.map((o) => <li key={o.id}><span>{o.titulo}<span className="sub">{NOME_ESTAGIO[o.estagio]} · prob. {pct(o.probabilidade)}{o.previsaoFechamento ? ` · previsão ${data(o.previsaoFechamento)}` : ''}{o.responsavelNome ? ` · ${o.responsavelNome}` : ''}</span></span><span className="small">{o.valorFechado !== undefined ? <>fechado {money(o.valorFechado, true)}</> : o.valorEstimado !== undefined ? money(o.valorEstimado, true) : <span className="muted">sem valor</span>}{!['WON', 'LOST', 'NURTURE'].includes(o.estagio) && d.empresa && <> · <Link to={`/comercial/projetos/novo?empresa=${encodeURIComponent(d.empresa.id)}&oportunidade=${encodeURIComponent(o.id)}`}>abrir solicitação técnica</Link></>}</span></li>)}</ul>}
        <div className="cgc-lacuna">Orçamentos: não há vínculo canônico entre orçamento e empresa/oportunidade; procure em <Link to="/orcamentos">Orçamentos e composições</Link>.</div>
        {d.solicitacoes.length > 0 && <ul className="cgc-lista">{d.solicitacoes.map((s) => <li key={s.id}><span>Pedido de projeto · {s.tipo}<span className="sub">{s.dadosTecnicos.join(' · ') || 'dados técnicos não informados'} · {NOME_FONTE_SOLICITACAO[s.fonte]}</span></span><span className="small muted">{s.situacao}</span></li>)}</ul>}
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Histórico</h2>
          {d.historico.length === 0 ? <p className="small muted">Sem histórico.</p> : <ul className="cgc-linha-tempo">{d.historico.slice(0, 40).map((h) => <li key={h.id} className={h.tipo}><div><b>{h.titulo}</b></div><div className="quando">{dataHora(h.em)}{h.autor ? ` · ${h.autor}` : ''}</div>{h.detalhe && <div className="det">{h.detalhe}</div>}</li>)}</ul>}
        </div>
        <div className="card">
          <h2>Decisões</h2>
          <p className="small muted">Mudanças de estágio com motivo e decisões de entrada do Lead Engine.</p>
          {d.decisoes.length === 0 ? <p className="small muted">Nenhuma decisão registrada.</p> : <ul className="cgc-linha-tempo">{d.decisoes.map((h) => <li key={h.id} className={h.tipo}><div><b>{h.titulo}</b></div><div className="quando">{dataHora(h.em)}{h.autor ? ` · ${h.autor}` : ''}</div>{h.detalhe && <div className="det">{h.detalhe}</div>}</li>)}</ul>}
        </div>
      </div>
    </>
  );
}
