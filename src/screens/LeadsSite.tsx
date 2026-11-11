// Leads do site — a visão do VENDEDOR sobre as conversas que entraram pelo formulário de eiff.com.br.
// O EIFF Inbox continua sendo a fonte única: esta tela só PROJETA (src/core/inbox/leadsSite.ts) e dispara as mesmas
// `actions.inbox*`. Não há cadastro de lead, segunda conversa nem regra aqui: SLA, visibilidade, ordem de trabalho e
// transições vêm do core. Nada é enviado: o e-mail vira rascunho `registrada` e só CONTATO REALIZADO cumpre o prazo.
import React, { useEffect, useMemo, useState } from 'react';
import {
  MEIOS_CONTATO, NOME_MEIO, NOME_STATUS, PRIORIDADES, TRANSICOES_THREAD, contatoDaMensagem, ehAberta, origemPrimeiraResposta, validarTransicao,
  type EstadoSla, type InboxDataset, type MeioContato, type Prioridade, type ResultadoContato, type StatusThread,
} from '../core/inbox';
import {
  FILTROS_LEAD, NOME_FILTRO_LEAD, NOME_ITEM_HISTORICO, PRAZO_LEAD_DO_SITE_MIN, contarPorFiltro, filtrarLeads, formulariosPresentes, historicoDoLead, leadsDoSite, linksDeContato,
  proximaAcao, resumoLeads, sugestaoDeEmail, textoDoRascunhoDeEmail, validarRascunhoDeEmail, type FiltroLead, type LeadDoSite, type TipoItemHistorico,
} from '../core/inbox/leadsSite';
import { RegraDeNegocioError, actions, pode, useStore } from '../data/store';
import type { Usuario } from '../core/types';
import { Badge, Empty, Field, Input, KpiHero, KpiStrip, Link, PageHead, Select, Tabs, dataHora, useToast, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';
import { navegar } from '../ui/router';
import { Tabela, type Coluna } from '../ui/Tabela';

const TOM_STATUS: Record<StatusThread, Tone> = { NOVA: 'bad', TRIADA: 'warn', ATRIBUIDA: 'warn', EM_ATENDIMENTO: 'info', AGUARDANDO_CONTATO: 'muted', AGUARDANDO_INTERNO: 'warn', AGUARDANDO_APROVACAO: 'warn', RESOLVIDA: 'ok', FECHADA: 'muted' };
const TOM_PRIORIDADE: Record<Prioridade, Tone> = { Baixa: 'muted', Normal: 'info', Alta: 'warn', Urgente: 'bad' };
const NOME_SLA: Record<EstadoSla, string> = { sem_sla: 'sem prazo', no_prazo: 'no prazo', vencendo: 'vencendo', vencido: 'prazo vencido', cumprido: 'respondido no prazo', atrasada: 'respondido fora do prazo', sem_resposta: 'encerrado sem resposta' };
const TOM_SLA: Record<EstadoSla, Tone> = { sem_sla: 'muted', no_prazo: 'ok', vencendo: 'warn', vencido: 'bad', cumprido: 'ok', atrasada: 'warn', sem_resposta: 'bad' };
/** Peso só para ordenar a coluna do prazo quando o usuário clica no cabeçalho. */
const ORDEM_SLA: Record<EstadoSla, number> = { vencido: 0, vencendo: 1, no_prazo: 2, sem_resposta: 3, atrasada: 4, cumprido: 5, sem_sla: 6 };
const TOM_ITEM: Record<TipoItemHistorico, Tone> = { solicitacao: 'info', mensagem_recebida: 'info', contato_realizado: 'ok', resposta_enviada: 'ok', tentativa: 'warn', rascunho: 'muted', nota: 'muted', movimento: 'muted' };
const NOME_FORMULARIO: Record<string, string> = { 'simular-galpao': 'Simular galpão', 'iniciar-projeto': 'Iniciar projeto' };
const nomeFormulario = (f?: string) => (f ? NOME_FORMULARIO[f] ?? f : 'não identificado');
const agoraLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const erroDe = (e: unknown) => (e instanceof RegraDeNegocioError || e instanceof Error ? e.message : String(e));
const ehFiltro = (x: string | null): x is FiltroLead => !!x && (FILTROS_LEAD as readonly string[]).includes(x);

export default function LeadsSite({ query }: { query: URLSearchParams }) {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const inbox = ds.inbox;
  const threadId = query.get('t') ?? undefined;
  const inicial = query.get('f');
  const [filtro, setFiltro] = useState<FiltroLead>(ehFiltro(inicial) ? inicial : 'abertos');
  const [formulario, setFormulario] = useState('');
  const [busca, setBusca] = useState('');
  // O prazo corre mesmo sem ninguém mexer nos dados: o relógio da tela anda sozinho.
  const [agora, setAgora] = useState(() => new Date().toISOString());
  useEffect(() => { const t = setInterval(() => setAgora(new Date().toISOString()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { setAgora(new Date().toISOString()); }, [ds]);

  const leads = useMemo(() => (inbox ? leadsDoSite(inbox, usuario, agora) : []), [inbox, usuario, agora]);
  const resumo = useMemo(() => resumoLeads(leads), [leads]);
  const contagem = useMemo(() => contarPorFiltro(leads, usuario.id), [leads, usuario.id]);
  const formularios = useMemo(() => formulariosPresentes(leads), [leads]);
  const lista = useMemo(() => filtrarLeads(leads, { filtro, usuarioId: usuario.id, formulario: formulario || undefined, busca }), [leads, filtro, usuario.id, formulario, busca]);
  const lead = threadId ? leads.find((l) => l.thread.id === threadId) : undefined;
  const nomeUsuario = (id?: string) => (id ? ds.usuarios.find((u) => u.id === id)?.nome ?? id : '—');
  const abrir = (id?: string) => navegar(id ? `/atendimento/leads?t=${id}&f=${filtro}` : `/atendimento/leads?f=${filtro}`);

  const colunas: Coluna<LeadDoSite>[] = [
    { titulo: 'Lead', ordenar: (l) => l.nome.toLowerCase() },
    { titulo: 'Cidade', ordenar: (l) => l.cidade?.toLowerCase(), className: 'leads-opc' },
    { titulo: 'Projeto', className: 'leads-opc' },
    { titulo: 'Origem', ordenar: (l) => l.formulario, className: 'leads-opc' },
    { titulo: 'Recebido', ordenar: (l) => l.recebidoEm },
    { titulo: '1ª resposta', ordenar: (l) => ORDEM_SLA[l.sla], title: `Prazo de primeira resposta: ${PRAZO_LEAD_DO_SITE_MIN} minutos úteis. Só contato realizado cumpre.` },
    { titulo: 'Responsável', ordenar: (l) => nomeUsuario(l.thread.responsavelId), className: 'leads-opc' },
    { titulo: 'Status', ordenar: (l) => NOME_STATUS[l.thread.status] },
  ];

  if (!inbox || leads.length === 0) {
    return (
      <>
        <PageHead title="Leads do site" subtitle="Solicitações de galpão recebidas pelo formulário de eiff.com.br." >
          <Link to="/atendimento" className="btn sm">Abrir o EIFF Inbox</Link>
        </PageHead>
        <div className="card">
          <Empty icone="atendimento" titulo="Nenhum lead do site por aqui" acao={modo === 'local' && pode(usuario, 'inbox_config') ? <button className="btn primary" onClick={() => { try { actions.inboxCarregarExemplo(); toast('Exemplo carregado'); } catch (e) { toast(erroDe(e)); } }}>Carregar dados de exemplo</button> : undefined}>
            Cada solicitação enviada pelo site vira uma conversa do EIFF Inbox no setor Comercial e aparece aqui, com prazo de primeira resposta de {PRAZO_LEAD_DO_SITE_MIN} minutos úteis. Você vê as conversas do seu setor, as suas e as sem setor.
          </Empty>
        </div>
        {el}
      </>
    );
  }

  return (
    <>
      <PageHead title="Leads do site" subtitle={<>Solicitações recebidas pelo formulário de eiff.com.br. Primeira resposta em até <b>{PRAZO_LEAD_DO_SITE_MIN} minutos úteis</b>; só contato realizado cumpre o prazo. {inbox.origem === 'seed' && <Badge tone="warn">dados de exemplo (modo local)</Badge>}</>}>
        <Link to="/atendimento?caixa=setor:COMERCIAL" className="btn sm">Abrir o EIFF Inbox</Link>
      </PageHead>

      <div className="hero-grid leads-resumo">
        <KpiHero label="Aguardando primeira resposta" value={resumo.aguardando} tone={resumo.atrasados ? 'bad' : resumo.vencendo ? 'warn' : 'ok'}
          hint={resumo.atrasados ? 'Há lead com o prazo vencido: é o primeiro da lista.' : resumo.aguardando ? 'Todos ainda dentro do prazo.' : 'Nenhum lead esperando o primeiro contato.'}
          secundarios={[
            { label: 'Prazo vencido', value: resumo.atrasados, tone: resumo.atrasados ? 'neg' : undefined },
            { label: 'Vencendo', value: resumo.vencendo, tone: resumo.vencendo ? 'warn' : undefined },
            { label: 'No prazo', value: resumo.aguardando - resumo.atrasados - resumo.vencendo, tone: 'pos' },
          ]} />
        <KpiStrip itens={[
          { label: 'Em aberto', value: resumo.abertos },
          { label: 'No prazo', hint: 'respondidos a tempo', value: resumo.respondidosNoPrazo, tone: resumo.respondidosNoPrazo ? 'pos' : undefined },
          { label: 'Fora do prazo', hint: 'respondidos com atraso', value: resumo.respondidosForaDoPrazo, tone: resumo.respondidosForaDoPrazo ? 'warn' : undefined },
          { label: 'Sem responsável', value: resumo.semResponsavel, tone: resumo.semResponsavel ? 'warn' : undefined },
          { label: 'Sem resposta', hint: 'encerrados sem contato', value: resumo.encerradosSemResposta, tone: resumo.encerradosSemResposta ? 'neg' : undefined },
        ]} />
      </div>

      <div className={`leads-layout ${lead ? 'com-detalhe' : ''}`}>
        <section className="card leads-lista" aria-label="Lista de leads do site">
          <div className="chips leads-filtros" role="group" aria-label="Filtrar leads">
            {FILTROS_LEAD.map((f) => <button key={f} className={`chip sm ${filtro === f ? 'on' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{NOME_FILTRO_LEAD[f]} <span className="df-filtro-n">{contagem[f]}</span></button>)}
          </div>
          <div className="filters">
            <Field label="Buscar"><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, empresa, cidade, e-mail, telefone…" aria-label="Buscar lead" /></Field>
            {formularios.length > 1 && <Field label="Formulário de origem"><Select value={formulario} onChange={setFormulario} allowEmpty="Todos" options={formularios.map((f) => ({ value: f, label: nomeFormulario(f) }))} /></Field>}
          </div>
          <Tabela colunas={colunas} linhas={lista} chave={(l) => l.thread.id} onLinha={(l) => abrir(l.thread.id)} altura={lead ? 520 : undefined}
            vazio="Nenhum lead neste filtro."
            csv={{ nome: 'leads-do-site', cabecalho: ['Nome', 'Empresa', 'Cidade', 'E-mail', 'Telefone', 'Formulário', 'Recebido em', 'Prazo até', 'Primeira resposta', 'Responsável', 'Status'], linha: (l) => [l.nome, l.empresa ?? '', l.cidade ?? '', l.email ?? '', l.telefone ?? '', l.formulario ?? '', dataHora(l.recebidoEm), dataHora(l.prazoAte), NOME_SLA[l.sla], nomeUsuario(l.thread.responsavelId), NOME_STATUS[l.thread.status]] }}
            linha={(l) => (
              <>
                <td className={l.thread.id === threadId ? 'leads-sel' : undefined}><b>{l.nome}</b><div className="small muted">{l.empresa ?? 'empresa não informada'}</div></td>
                <td className="leads-opc">{l.cidade ?? <span className="muted">não informada</span>}</td>
                <td className="leads-opc leads-projeto" title={l.solicitacao.configuracao ?? l.thread.assunto}>{l.solicitacao.configuracao ?? l.thread.assunto}</td>
                <td className="leads-opc"><Badge tone="muted">{nomeFormulario(l.formulario)}</Badge></td>
                <td>{dataHora(l.recebidoEm)}</td>
                <td><Badge tone={TOM_SLA[l.sla]}>{NOME_SLA[l.sla]}</Badge>{l.situacao === 'aguardando' && l.prazoAte && <div className="small muted">até {dataHora(l.prazoAte)}</div>}</td>
                <td className="leads-opc">{l.thread.responsavelId ? nomeUsuario(l.thread.responsavelId) : <Badge tone="warn">sem responsável</Badge>}</td>
                <td><Badge tone={TOM_STATUS[l.thread.status]}>{NOME_STATUS[l.thread.status]}</Badge></td>
              </>
            )} />
        </section>

        {lead && <DetalheLead key={lead.thread.id} lead={lead} inbox={inbox} usuario={usuario} nomeUsuario={nomeUsuario} toast={toast} onFechar={() => abrir()} />}
        {!lead && threadId && <section className="card"><Empty icone="atendimento" titulo="Lead não encontrado">Esta conversa não é um lead do site ou não está visível para você. <Link to="/atendimento/leads">Voltar à lista</Link></Empty></section>}
      </div>
      {el}
    </>
  );
}

type AbaAcao = 'contato' | 'email' | 'nota';

function DetalheLead({ lead, inbox, usuario, nomeUsuario, toast, onFechar }: { lead: LeadDoSite; inbox: InboxDataset; usuario: Usuario; nomeUsuario: (id?: string) => string; toast: (m: string) => void; onFechar: () => void }) {
  const t = lead.thread;
  const s = lead.solicitacao;
  const [aba, setAba] = useState<AbaAcao>('contato');
  // Contato declarado: o único gesto de pessoa que cumpre o prazo de primeira resposta.
  const [resultado, setResultado] = useState<ResultadoContato>('realizado');
  const [meio, setMeio] = useState<MeioContato>('telefone');
  const [quando, setQuando] = useState(agoraLocal());
  const [resumoContato, setResumoContato] = useState('');
  const sugestao = useMemo(() => sugestaoDeEmail(lead, usuario.nome), [lead, usuario.nome]);
  const [assunto, setAssunto] = useState(sugestao.assunto);
  const [corpo, setCorpo] = useState(sugestao.corpo);
  const [nota, setNota] = useState('');
  const historico = useMemo(() => historicoDoLead(t.id, inbox.mensagens, inbox.eventos), [t.id, inbox.mensagens, inbox.eventos]);
  const acao = proximaAcao(lead);
  const links = linksDeContato(lead);
  const fechada = t.status === 'FECHADA';
  const rascunho = { para: lead.email ?? '', assunto, corpo };
  const errosEmail = validarRascunhoDeEmail(rascunho);
  const setor = t.setorCodigo ? inbox.setores.find((x) => x.codigo === t.setorCodigo)?.nome ?? t.setorCodigo : 'sem setor';
  const naoVerificavel = origemPrimeiraResposta(t, inbox.mensagens) === 'anterior_a_regra';

  const tentar = (fn: () => unknown, ok?: string) => { try { const r = fn(); if (r instanceof Promise) r.then(() => ok && toast(ok)).catch((e) => toast(erroDe(e))); else if (ok) toast(ok); } catch (e) { toast(erroDe(e)); } };
  const registrarContato = () => tentar(() => {
    const m = actions.inboxRegistrarContato(t.id, { resultado, meio, em: quando ? new Date(quando).toISOString() : '', resumo: resumoContato });
    setResumoContato('');
    toast(contatoDaMensagem(m)?.resultado === 'realizado' ? 'Contato realizado registrado.' : 'Tentativa registrada. O prazo de primeira resposta continua correndo.');
  });
  const registrarRascunho = () => tentar(async () => {
    const m = await actions.inboxResponder(t.id, textoDoRascunhoDeEmail(rascunho));
    toast(m.entrega === 'registrada' ? 'Rascunho registrado na conversa. Nada foi enviado e o prazo continua correndo.' : `Resposta ${m.entrega}`);
  });
  const jaEnviei = () => { setAba('contato'); setResultado('realizado'); setMeio('email'); setQuando(agoraLocal()); setResumoContato(`E-mail enviado do meu programa de e-mail. Assunto: ${assunto.trim()}`); };
  const mudarStatus = (para: StatusThread) => {
    const v = validarTransicao(t, para);
    if (v.ok) { tentar(() => actions.inboxMudarStatus(t.id, para), `Conversa: ${NOME_STATUS[para]}`); return; }
    if (!/motivo/.test(v.motivo)) { toast(v.motivo); return; }
    const motivo = window.prompt(`${NOME_STATUS[para]}: informe o motivo`);
    if (motivo?.trim()) tentar(() => actions.inboxMudarStatus(t.id, para, motivo), `Conversa: ${NOME_STATUS[para]}`);
  };

  return (
    <section className="card leads-detalhe" aria-label="Lead selecionado">
      <div className="leads-cab">
        <div>
          <button className="btn sm leads-voltar" onClick={onFechar}><Icon name="seta" size={14} /> Lista</button>
          <h2>{lead.nome}</h2>
          <div className="small muted">{lead.empresa ?? 'empresa não informada'} · {lead.cidade ?? 'cidade não informada'}</div>
        </div>
        <div className="actions">
          <Badge tone={TOM_STATUS[t.status]}>{NOME_STATUS[t.status]}</Badge>
          <Badge tone={TOM_PRIORIDADE[t.prioridade]}>{t.prioridade}</Badge>
          <Link to={`/atendimento?t=${t.id}&caixa=todas`} className="btn sm">Abrir no Inbox</Link>
        </div>
      </div>

      <div className={`leads-prazo ${TOM_SLA[lead.sla]}`} data-sla={lead.sla} data-situacao-resposta={lead.situacao} role="status">
        <div>
          <b>{NOME_SLA[lead.sla]}</b>
          {lead.situacao === 'aguardando' && lead.prazoAte && <> · primeiro contato até <b>{dataHora(lead.prazoAte)}</b></>}
          {lead.primeiraRespostaEm && <> · primeiro contato em {dataHora(lead.primeiraRespostaEm)} (prazo: {dataHora(lead.prazoAte)})</>}
          {naoVerificavel && ' · registro anterior à regra de contato realizado (não verificável)'}
        </div>
        <div className="small">{acao.texto}</div>
      </div>

      <div className="leads-contatos" aria-label="Meios de contato">
        {lead.telefone && <span className="leads-meio"><span className="muted small">Telefone</span><b>{lead.telefone}</b></span>}
        {lead.email && <span className="leads-meio"><span className="muted small">E-mail</span><b>{lead.email}</b></span>}
        <div className="actions">
          {links.telefone && <a className="btn sm" href={links.telefone}>Ligar</a>}
          {links.whatsapp && <a className="btn sm" href={links.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
          {links.email && <button className="btn sm" onClick={() => setAba('email')}>Escrever e-mail</button>}
          {!links.telefone && !links.email && <span className="small muted">Nenhum meio de contato válido na solicitação.</span>}
        </div>
        <div className="small muted">Os atalhos abrem o seu telefone, WhatsApp ou programa de e-mail. Depois de falar com a pessoa, registre o contato realizado abaixo.</div>
      </div>

      <div className="leads-colunas">
        <div>
          <h3>Projeto solicitado</h3>
          {s.mensagem && <blockquote className="leads-mensagem">{s.mensagem}</blockquote>}
          <dl className="kv">
            {s.configuracao && <><dt>Configuração</dt><dd>{s.configuracao}</dd></>}
            {s.especificacao && <><dt>Especificação</dt><dd>{s.especificacao}</dd></>}
            {s.medidas && <><dt>Medidas</dt><dd>{s.medidas}</dd></>}
            {s.prazo && <><dt>Prazo informado</dt><dd>{s.prazo}</dd></>}
            {s.escopo && <><dt>Escopo</dt><dd>{s.escopo}</dd></>}
            <dt>Empresa</dt><dd>{lead.empresa ?? <span className="muted">não informada</span>}</dd>
            <dt>Cidade</dt><dd>{lead.cidade ?? <span className="muted" title="A solicitação não permite distinguir a cidade com segurança. Veja o texto completo no histórico.">não informada</span>}</dd>
            {s.campanha && <><dt>Campanha</dt><dd>{s.campanha}</dd></>}
          </dl>
          {s.leituraDaPagina.map((x, i) => <div key={i} className="leads-leitura small"><b>Texto automático mostrado pelo site.</b> Não é orientação de engenharia da EIFF e não deve ser repetido ao cliente como parecer: {x}</div>)}
        </div>
        <div>
          <h3>Atendimento</h3>
          <dl className="kv">
            <dt>Origem</dt><dd>formulário {nomeFormulario(lead.formulario)} · eiff.com.br</dd>
            <dt>Recebido em</dt><dd>{dataHora(lead.recebidoEm)}{lead.solicitacoes > 1 ? ` · ${lead.solicitacoes} solicitações nesta conversa` : ''}</dd>
            <dt>Setor</dt><dd>{setor}</dd>
            <dt>Responsável</dt><dd>{t.responsavelId ? nomeUsuario(t.responsavelId) : 'ninguém ainda'} {t.responsavelId !== usuario.id && ehAberta(t.status) && <button className="btn sm" onClick={() => tentar(() => actions.inboxAtribuir(t.id, { responsavelId: usuario.id, motivo: 'assumida na tela Leads do site' }), 'Conversa assumida')}>Assumir</button>}</dd>
            <dt>Prioridade</dt><dd><Select value={t.prioridade} onChange={(v) => tentar(() => actions.inboxMudarPrioridade(t.id, v as Prioridade), `Prioridade: ${v}`)} options={[...PRIORIDADES]} aria-label="Prioridade" disabled={!ehAberta(t.status)} /></dd>
            <dt>Contatos</dt><dd>{lead.contatosRealizados} realizado(s) · {lead.tentativas} tentativa(s) · {lead.rascunhos} rascunho(s)</dd>
          </dl>
          <div className="actions" style={{ marginTop: 8 }}>
            {fechada ? <button className="btn sm" onClick={() => mudarStatus('EM_ATENDIMENTO')}>Reabrir</button>
              : TRANSICOES_THREAD[t.status].filter((x) => x === 'EM_ATENDIMENTO' || x === 'AGUARDANDO_CONTATO' || x === 'RESOLVIDA').map((x) => <button key={x} className="btn sm" onClick={() => mudarStatus(x)}>{NOME_STATUS[x]}</button>)}
          </div>
        </div>
      </div>

      <h3>Registrar atendimento</h3>
      <Tabs value={aba} onChange={setAba} items={[{ id: 'contato', label: 'Contato feito ou tentativa' }, { id: 'email', label: 'E-mail (rascunho)' }, { id: 'nota', label: 'Nota interna' }]} />
      {aba === 'contato' && (
        <div className="leads-acao" data-contato-realizado>
          <div className="actions small">
            <label><input type="radio" name="resultado-contato-lead" checked={resultado === 'realizado'} onChange={() => setResultado('realizado')} /> Falei com a pessoa</label>
            <label><input type="radio" name="resultado-contato-lead" checked={resultado === 'tentativa'} onChange={() => setResultado('tentativa')} /> Tentei, sem sucesso</label>
          </div>
          <div className="filters">
            <Field label="Meio"><Select value={meio} onChange={(v) => setMeio(v as MeioContato)} options={MEIOS_CONTATO.map((x) => ({ value: x, label: NOME_MEIO[x] }))} /></Field>
            <Field label="Data e hora do contato"><input type="datetime-local" value={quando} max={agoraLocal()} onChange={(e) => setQuando(e.target.value)} /></Field>
          </div>
          <textarea value={resumoContato} onChange={(e) => setResumoContato(e.target.value)} rows={3} disabled={fechada} placeholder="Com quem falou e o que ficou combinado…" aria-label="Resumo do contato" />
          <div className="actions">
            <button className="btn primary" disabled={!resumoContato.trim() || fechada} onClick={registrarContato}>{resultado === 'realizado' ? 'Registrar contato realizado' : 'Registrar tentativa'}</button>
            <span className="small muted">{resultado === 'realizado' ? 'Só este registro cumpre o prazo de primeira resposta. Fica gravado quem declarou e quando.' : 'Tentativa não cumpre o prazo: fica como nota interna na conversa.'}</span>
          </div>
        </div>
      )}
      {aba === 'email' && (
        <div className="leads-acao">
          <div className="leads-aviso small" role="note"><b>O EIFF Control ainda não envia e-mail.</b> O texto abaixo fica registrado na conversa como rascunho, nada sai daqui e <b>rascunho não conta como primeira resposta</b>. Se você enviar pelo seu programa de e-mail, volte e registre o contato realizado.</div>
          <div className="form">
            <Field label="Para" full><Input value={lead.email ?? ''} readOnly aria-readonly="true" /></Field>
            <Field label="Assunto" req full><Input value={assunto} onChange={(e) => setAssunto(e.target.value)} disabled={fechada} /></Field>
            <Field label="Mensagem" req full><textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={9} disabled={fechada} /></Field>
          </div>
          {errosEmail.length > 0 && <div className="small muted">{errosEmail[0]}</div>}
          <div className="actions">
            <button className="btn primary" disabled={errosEmail.length > 0 || fechada} onClick={registrarRascunho}>Registrar rascunho na conversa</button>
            {lead.email && <a className="btn" href={linksDeContato(lead, { assunto, corpo }).email}>Abrir no meu programa de e-mail</a>}
            <button className="btn" disabled={fechada} onClick={jaEnviei} title="Leva para o registro de contato realizado por e-mail">Já enviei: registrar contato</button>
          </div>
        </div>
      )}
      {aba === 'nota' && (
        <div className="leads-acao">
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="Anotar para a equipe (o cliente não vê)…" aria-label="Nota interna" />
          <div className="actions">
            <button className="btn primary" disabled={!nota.trim()} onClick={() => tentar(() => { actions.inboxAnotar(t.id, nota); setNota(''); }, 'Nota registrada')}>Registrar nota interna</button>
            <span className="small muted">Nota interna não cumpre o prazo de primeira resposta.</span>
          </div>
        </div>
      )}

      <h3>Histórico</h3>
      <ul className="leads-historico">
        {historico.map((i) => (
          <li key={i.id} className={i.tipo}>
            <div className="leads-historico-topo">
              <Badge tone={TOM_ITEM[i.tipo]}>{NOME_ITEM_HISTORICO[i.tipo]}{i.meio ? ` · ${NOME_MEIO[i.meio]}` : ''}</Badge>
              <span className="small muted">{i.autor} · {dataHora(i.em)}{i.registradoEm ? ` · registrado em ${dataHora(i.registradoEm)}` : ''}</span>
              {i.cumpreSla && <span className="small leads-cumpre">conta como resposta</span>}
            </div>
            <p>{i.texto}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
