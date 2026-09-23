// EIFF Inbox — central de comunicacao, atendimento e decisao (fundacao, docs/eiff-inbox.md).
// A tela so APRESENTA o que o core decidiu: caixas, ordem de trabalho, SLA, visibilidade e transicoes validas vem de
// src/core/inbox; toda mutacao passa por `actions.inbox*` no store. Nada aqui envia mensagem, chama IA ou fala com a Factory.
// Tres areas, como no EIFF Control: FILTROS (caixas + conversas) · CONVERSA (mensagens + composer) · CONTEXTO (contato,
// classificacao, atribuicao, status, acoes, historico).
import React, { useEffect, useMemo, useState } from 'react';
import {
  CANAIS_INBOX, NIVEIS_ATENDIMENTO, NOME_STATUS, PRIORIDADES, TIPOS_ACAO, TRANSICOES_THREAD, caixasVirtuais, ehAberta, escalacoesPendentes, estadoSla,
  identificadorMascarado, ordenarParaTrabalho, resumoExecutivo, threadsDaCaixa, validarTransicao,
  type CanalInbox, type EstadoSla, type InboxAction, type InboxJob, type InboxThread, type NivelAtendimento, type Prioridade, type StatusThread, type TipoAcao,
} from '../core/inbox';
import { RegraDeNegocioError, actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, KpiStrip, Link, Modal, PageHead, Select, Tabs, dataHora, useToast, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';
import { navegar } from '../ui/router';

const NOME_CANAL: Record<CanalInbox, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', PORTAL: 'Portal', WEBCHAT: 'Webchat', SISTEMA: 'Sistema' };
const TOM_PRIORIDADE: Record<Prioridade, Tone> = { Baixa: 'muted', Normal: 'info', Alta: 'warn', Urgente: 'bad' };
const TOM_STATUS: Record<StatusThread, Tone> = { NOVA: 'bad', TRIADA: 'warn', ATRIBUIDA: 'warn', EM_ATENDIMENTO: 'info', AGUARDANDO_CONTATO: 'muted', AGUARDANDO_INTERNO: 'warn', AGUARDANDO_APROVACAO: 'warn', RESOLVIDA: 'ok', FECHADA: 'muted' };
const NOME_SLA: Record<EstadoSla, string> = { sem_sla: 'sem SLA', no_prazo: 'no prazo', vencendo: 'vencendo', vencido: 'SLA vencido', cumprido: 'respondida' };
const TOM_SLA: Record<EstadoSla, Tone> = { sem_sla: 'muted', no_prazo: 'ok', vencendo: 'warn', vencido: 'bad', cumprido: 'muted' };
const NOME_NIVEL: Record<NivelAtendimento, string> = { A: 'A · IA responde', B: 'B · IA prepara, humano aprova', C: 'C · humano obrigatório' };
const NOME_ACAO: Record<TipoAcao, string> = { responder: 'Responder', encaminhar: 'Encaminhar', criar_tarefa: 'Criar tarefa', consultar_sistema: 'Consultar sistema', registrar_previsao: 'Registrar previsão', criar_job: 'Criar job' };
const TOM_ACAO: Record<InboxAction['estado'], Tone> = { proposta: 'muted', aguardando_aprovacao: 'warn', aprovada: 'info', rejeitada: 'bad', executada: 'ok', falhou: 'bad' };
const TOM_JOB: Record<InboxJob['estado'], Tone> = { RASCUNHO: 'muted', ENVIADO: 'info', EM_EXECUCAO: 'info', CONCLUIDO: 'ok', FALHOU: 'bad', CANCELADO: 'muted' };

function haQuanto(iso: string, agoraIso: string): string {
  const min = Math.max(0, Math.round((new Date(agoraIso).getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'agora'; if (min < 60) return `${min} min`; const h = Math.round(min / 60); if (h < 48) return `${h} h`; return `${Math.round(h / 24)} d`;
}
const erroDe = (e: unknown) => (e instanceof RegraDeNegocioError || e instanceof Error ? e.message : String(e));

export default function Inbox({ threadId, query }: { threadId?: string; query: URLSearchParams }) {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const inbox = ds.inbox;
  const agora = useMemo(() => new Date().toISOString(), [ds]);
  const [caixa, setCaixa] = useState(query.get('caixa') ?? 'precisa_de_mim');
  const [busca, setBusca] = useState('');
  const [aba, setAba] = useState<'contexto' | 'acoes' | 'historico'>('contexto');
  const [texto, setTexto] = useState('');
  const [nota, setNota] = useState(false);
  const [modal, setModal] = useState<null | 'triar' | 'acao' | 'resultado' | 'simular' | 'status'>(null);
  const [jobAlvo, setJobAlvo] = useState<InboxJob | null>(null);
  const [statusAlvo, setStatusAlvo] = useState<StatusThread | null>(null);
  useEffect(() => { setTexto(''); setNota(false); setAba('contexto'); }, [threadId]);

  const podeConfigurar = pode(usuario, 'inbox_config');
  const caixas = useMemo(() => (inbox ? caixasVirtuais(inbox, usuario) : []), [inbox, usuario]);
  const resumo = useMemo(() => (inbox ? resumoExecutivo(inbox, usuario, agora) : null), [inbox, usuario, agora]);
  const lista = useMemo(() => {
    if (!inbox) return [];
    const base = ordenarParaTrabalho(threadsDaCaixa(inbox, usuario, caixa), agora);
    const q = busca.trim().toLowerCase();
    if (!q) return base;
    return base.filter((t) => { const c = inbox.contatos.find((x) => x.id === t.contatoId); return `${t.assunto} ${c?.nome ?? ''} ${c?.empresaNome ?? ''} ${t.labels.join(' ')}`.toLowerCase().includes(q); });
  }, [inbox, usuario, caixa, busca, agora]);
  const thread = inbox?.threads.find((t) => t.id === threadId);
  const contato = thread ? inbox?.contatos.find((c) => c.id === thread.contatoId) : undefined;
  const mensagens = useMemo(() => (thread ? (inbox?.mensagens ?? []).filter((m) => m.threadId === thread.id).sort((a, b) => (a.em < b.em ? -1 : 1)) : []), [inbox, thread]);
  const eventos = useMemo(() => (thread ? (inbox?.eventos ?? []).filter((e) => e.threadId === thread.id).sort((a, b) => (a.em < b.em ? 1 : -1)) : []), [inbox, thread]);
  const acoes = thread ? (inbox?.acoes ?? []).filter((a) => a.threadId === thread.id) : [];
  const jobs = thread ? (inbox?.jobs ?? []).filter((j) => j.threadId === thread.id) : [];
  const sugestao = thread ? inbox?.sugestoes.find((s) => s.threadId === thread.id && s.estado === 'pendente') : undefined;
  const escalacoes = useMemo(() => (inbox ? escalacoesPendentes(inbox.threads.filter((t) => ehAberta(t.status)), inbox.configuracao, agora) : []), [inbox, agora]);
  const nomeUsuario = (id?: string) => (id ? ds.usuarios.find((u) => u.id === id)?.nome ?? id : '—');
  // a conversa vai na query (nao no path) para o tour da rota ser visto uma vez so e a rota continuar sendo /atendimento
  const abrir = (id: string) => navegar(`/atendimento?t=${id}&caixa=${caixa}`);
  const tentar = (fn: () => unknown, ok?: string) => { try { const r = fn(); if (r instanceof Promise) r.then(() => ok && toast(ok)).catch((e) => toast(erroDe(e))); else if (ok) toast(ok); } catch (e) { toast(erroDe(e)); } };

  if (!inbox || (inbox.origem === 'vazio' && inbox.threads.length === 0)) {
    return (
      <>
        <PageHead title="EIFF Inbox" subtitle="Central de comunicação, atendimento e decisão. Uma EIFF para quem está fora; setores e pessoas por dentro." />
        <div className="card">
          <Empty icone="atendimento" titulo="Nenhum canal conectado ainda" acao={podeConfigurar ? <button className="btn primary" onClick={() => tentar(() => actions.inboxCarregarExemplo(), 'Exemplo carregado neste navegador')}>Carregar dados de exemplo</button> : undefined}>
            O Inbox está na fase de fundação: modelo, fronteiras e tela existem; WhatsApp, e-mail e a persistência no banco entram nas próximas etapas.
            {podeConfigurar ? ' Carregue o exemplo fictício para navegar pela central (fica só neste navegador).' : ''}
          </Empty>
        </div>
        {el}
      </>
    );
  }

  const enviar = () => {
    if (!thread || !texto.trim()) return;
    if (nota) tentar(() => { actions.inboxAnotar(thread.id, texto); setTexto(''); }, 'Nota registrada');
    else tentar(async () => { const m = await actions.inboxResponder(thread.id, texto, { sugestaoId: sugestao && texto.trim() === sugestao.texto ? sugestao.id : undefined }); setTexto(''); toast(m.entrega === 'registrada' ? 'Resposta registrada. Canal não conectado: nada foi enviado.' : `Resposta ${m.entrega}`); });
  };
  const mudarStatus = (para: StatusThread) => {
    if (!thread) return;
    const v = validarTransicao(thread, para);
    if (v.ok) tentar(() => actions.inboxMudarStatus(thread.id, para), `Conversa: ${NOME_STATUS[para]}`);
    else if (/motivo/.test(v.motivo)) { setStatusAlvo(para); setModal('status'); }
    else toast(v.motivo);
  };

  return (
    <>
      <PageHead title="EIFF Inbox" subtitle={<>Central de comunicação, atendimento e decisão. {inbox.origem === 'seed' && <Badge tone="warn">dados de exemplo{modo === 'remoto' ? ' · só neste navegador' : ''}</Badge>}</>}>
        {podeConfigurar && <button className="btn sm" onClick={() => setModal('simular')} title="Entra pelo mesmo gateway que o canal real usará">Simular mensagem recebida</button>}
        {podeConfigurar && <button className="btn sm" onClick={() => { if (window.confirm('Substituir o Inbox pelo exemplo fictício?')) tentar(() => actions.inboxCarregarExemplo(), 'Exemplo carregado'); }}>Recarregar exemplo</button>}
      </PageHead>
      {resumo && (
        <KpiStrip itens={[
          { label: 'Precisa de mim', value: resumo.precisaDeMim, tone: resumo.precisaDeMim ? 'warn' : undefined, to: '/atendimento?caixa=precisa_de_mim' },
          { label: 'Urgente', value: resumo.urgente, tone: resumo.urgente ? 'neg' : undefined, to: '/atendimento?caixa=urgentes' },
          { label: 'SLA vencido', value: resumo.slaVencido, tone: resumo.slaVencido ? 'neg' : undefined, hint: escalacoes.length ? `${escalacoes.length} para escalar` : undefined },
          { label: 'Aguardando contato', value: resumo.aguardandoContato },
          { label: 'Aguardando EIFF', value: resumo.aguardandoEiff, tone: resumo.aguardandoEiff ? 'warn' : undefined },
          { label: 'IA resolveu', value: resumo.iaResolveu, tone: resumo.iaResolveu ? 'pos' : undefined, to: '/atendimento?caixa=automatizados' },
          { label: 'Em atendimento', value: resumo.emAtendimento },
        ]} />
      )}

      <div className="inbox-layout">
        {/* FILTROS: caixas virtuais + conversas */}
        <aside className="card inbox-filtros" aria-label="Caixas e conversas">
          <div className="inbox-caixas">
            {caixas.filter((c) => c.fixa).map((c) => (
              <button key={c.id} className={`inbox-caixa ${caixa === c.id ? 'ativa' : ''}`} onClick={() => setCaixa(c.id)}><span>{c.nome}</span>{c.quantidade > 0 && <span className="cnt">{c.quantidade}</span>}</button>
            ))}
            <h3 className="inbox-grupo">Setores</h3>
            {caixas.filter((c) => c.setorCodigo).map((c) => (
              <button key={c.id} className={`inbox-caixa ${caixa === c.id ? 'ativa' : ''}`} onClick={() => setCaixa(c.id)}><span>{c.nome}</span>{c.quantidade > 0 && <span className="cnt">{c.quantidade}</span>}</button>
            ))}
          </div>
          <div className="inbox-lista">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa, contato, empresa…" aria-label="Buscar conversa" />
            {lista.length === 0 ? <div className="muted small" style={{ padding: 12 }}>Nada nesta caixa.</div> : lista.map((t) => {
              const c = inbox.contatos.find((x) => x.id === t.contatoId); const sla = estadoSla(t, agora);
              return (
                <button key={t.id} className={`inbox-item ${t.id === threadId ? 'ativa' : ''}`} onClick={() => abrir(t.id)}>
                  <div className="inbox-item-topo"><b>{c?.nome ?? 'Contato'}</b><span className="muted small">{haQuanto(t.ultimaMensagemEm, agora)}</span></div>
                  <div className="inbox-item-assunto">{t.assunto}</div>
                  <div className="inbox-item-meta">
                    <Badge tone={TOM_STATUS[t.status]}>{NOME_STATUS[t.status]}</Badge>
                    {t.prioridade !== 'Normal' && <Badge tone={TOM_PRIORIDADE[t.prioridade]}>{t.prioridade}</Badge>}
                    {(sla === 'vencido' || sla === 'vencendo') && <Badge tone={TOM_SLA[sla]}>{NOME_SLA[sla]}</Badge>}
                    <span className="muted small">{NOME_CANAL[t.canal]}{t.setorCodigo ? ` · ${inbox.setores.find((s) => s.codigo === t.setorCodigo)?.nome ?? t.setorCodigo}` : ' · sem setor'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CONVERSA */}
        <section className="card inbox-conversa" aria-label="Conversa">
          {!thread ? <Empty icone="atendimento" titulo="Escolha uma conversa">A ordem da lista é a ordem de trabalho: SLA vencido primeiro, depois prioridade, depois a mais antiga sem resposta.</Empty> : (
            <>
              <div className="inbox-conversa-cab">
                <div>
                  <h2>{thread.assunto}</h2>
                  <div className="small muted">{contato?.nome}{contato?.empresaNome ? ` · ${contato.empresaNome}` : ''} · {NOME_CANAL[thread.canal]} · {thread.contexto === 'INTERNAL' ? 'interno' : 'externo'}{thread.codigoObra && <> · <Link to={`/obras/${thread.codigoObra}`}>{thread.codigoObra}</Link></>} · responsável: {nomeUsuario(thread.responsavelId)}</div>
                </div>
                <div className="actions">
                  <Badge tone={TOM_STATUS[thread.status]}>{NOME_STATUS[thread.status]}</Badge>
                  <Badge tone={TOM_PRIORIDADE[thread.prioridade]}>{thread.prioridade}</Badge>
                  <Badge tone={TOM_SLA[estadoSla(thread, agora)]}>{NOME_SLA[estadoSla(thread, agora)]}</Badge>
                </div>
              </div>
              {thread.resumoIa && <div className="inbox-resumo small"><Icon name="chat" size={14} /> {thread.resumoIa}</div>}
              <div className="inbox-msgs">
                {mensagens.map((m) => (
                  <div key={m.id} className={`chat-msg ${m.direcao === 'outbound' ? 'usuario' : m.direcao === 'interna' ? 'interna' : 'assistente'}`}>
                    <div className={`chat-bolha ${m.direcao === 'interna' ? 'nota' : ''}`}>
                      <div className="inbox-msg-autor small">{m.direcao === 'interna' ? 'Nota interna · ' : ''}{m.autor.nome}{m.autor.tipo === 'ia' ? ' (IA)' : ''} · {dataHora(m.em)}{m.entrega ? ` · ${m.entrega}` : ''}</div>
                      <p>{m.texto}</p>
                      {m.anexos.length > 0 && <div className="small muted">{m.anexos.map((a) => a.nome).join(', ')}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {sugestao && !nota && (
                <div className="inbox-sugestao">
                  <div className="small"><b>Sugestão de resposta</b> <span className="muted">· {sugestao.provedor} · nível {thread.nivel}: {thread.nivel === 'A' ? 'poderia ir sozinha' : 'precisa da sua aprovação'}</span></div>
                  <p className="small">{sugestao.texto}</p>
                  <div className="actions"><button className="btn sm" onClick={() => setTexto(sugestao.texto)}>Usar esta</button><button className="btn sm" onClick={() => tentar(() => actions.inboxDescartarSugestao(sugestao.id), 'Sugestão descartada')}>Descartar</button></div>
                </div>
              )}
              <div className="inbox-composer">
                <div className="actions small">
                  <label><input type="checkbox" checked={nota} onChange={(e) => setNota(e.target.checked)} /> Nota interna (o contato não vê)</label>
                  {!nota && <span className="muted">Canal não conectado nesta fase: a resposta fica registrada, nada é enviado.</span>}
                </div>
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder={nota ? 'Anotar para a equipe…' : `Responder a ${contato?.nome ?? 'contato'}…`} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') enviar(); }} disabled={thread.status === 'FECHADA'} />
                <div className="actions">
                  <button className="btn primary" onClick={enviar} disabled={!texto.trim() || thread.status === 'FECHADA'}>{nota ? 'Registrar nota' : 'Registrar resposta'}</button>
                  <span className="muted small">Ctrl+Enter</span>
                  <div className="spacer" />
                  {thread.status === 'FECHADA' ? <button className="btn sm" onClick={() => mudarStatus('EM_ATENDIMENTO')}>Reabrir</button> : (
                    <>
                      {TRANSICOES_THREAD[thread.status].filter((s) => s !== 'TRIADA' && s !== 'ATRIBUIDA').map((s) => <button key={s} className="btn sm" onClick={() => mudarStatus(s)}>{NOME_STATUS[s]}</button>)}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {/* CONTEXTO */}
        <aside className="card inbox-contexto" aria-label="Contexto">
          {!thread ? <div className="muted small">Contato, classificação, responsável e ações da conversa escolhida.</div> : (
            <>
              <Tabs value={aba} onChange={setAba} items={[{ id: 'contexto', label: 'Contexto' }, { id: 'acoes', label: `Ações${acoes.length ? ` (${acoes.length})` : ''}` }, { id: 'historico', label: 'Histórico' }]} />
              {aba === 'contexto' && (
                <>
                  <h3>Contato</h3>
                  <dl className="kv">
                    <dt>Nome</dt><dd>{contato?.nome}</dd>
                    <dt>Empresa</dt><dd>{contato?.empresaNome ?? '—'}</dd>
                    <dt>Relação</dt><dd>{contato?.tipoRelacao.replace('_', ' ')}</dd>
                    <dt>Canais</dt><dd>{contato?.identidades.map((i) => `${NOME_CANAL[i.canal]} ${identificadorMascarado(i)}${i.verificada ? ' ✓' : ''}`).join(' · ')}</dd>
                    <dt>Obras</dt><dd>{contato?.obras.length ? contato.obras.map((o) => <Link key={o} to={`/obras/${o}`}>{o}</Link>) : '—'}</dd>
                    {contato?.empresaRadarId && <><dt>Radar</dt><dd><Link to={`/radar/empresas/${contato.empresaRadarId}`}>abrir empresa</Link></dd></>}
                    {contato?.observacoes && <><dt>Notas</dt><dd>{contato.observacoes}</dd></>}
                  </dl>
                  <h3>Classificação <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setModal('triar')}>{thread.classificacao ? 'Retriar' : 'Triar'}</button></h3>
                  {thread.classificacao ? (
                    <dl className="kv">
                      <dt>Intenção</dt><dd>{thread.classificacao.intencao}</dd>
                      <dt>Assunto</dt><dd>{thread.classificacao.assunto}</dd>
                      {thread.classificacao.entidades.length > 0 && <><dt>Entidades</dt><dd>{thread.classificacao.entidades.map((e) => `${e.tipo}: ${e.valor}`).join(' · ')}</dd></>}
                      <dt>Nível</dt><dd>{NOME_NIVEL[thread.nivel]}</dd>
                      <dt>Confiança</dt><dd>{Math.round(thread.classificacao.confianca * 100)}% · {thread.classificacao.provedor}</dd>
                      <dt>Sinais</dt><dd>{thread.classificacao.sinais.join('; ')}</dd>
                      {thread.classificacao.acaoSugerida && <><dt>Ação sugerida</dt><dd>{thread.classificacao.acaoSugerida}</dd></>}
                    </dl>
                  ) : <div className="small muted">Sem classificação: inteligência não configurada. Faça a triagem para rotear.</div>}
                  <h3>Atribuição</h3>
                  <Atribuicao thread={thread} setores={inbox.setores} usuarios={ds.usuarios} onAplicar={(setorCodigo, responsavelId) => tentar(() => actions.inboxAtribuir(thread.id, { setorCodigo, responsavelId }), 'Atribuição aplicada')} />
                  {thread.sla && <div className="small muted" style={{ marginTop: 8 }}>SLA de primeira resposta: {dataHora(thread.sla.primeiraRespostaAte)}{thread.sla.primeiraRespostaEm ? ` · respondida ${dataHora(thread.sla.primeiraRespostaEm)}` : ''}</div>}
                  {thread.labels.length > 0 && <div className="actions" style={{ marginTop: 8 }}>{thread.labels.map((l) => <Badge key={l} tone="muted">{l}</Badge>)}</div>}
                </>
              )}
              {aba === 'acoes' && (
                <>
                  <div className="actions" style={{ marginBottom: 10 }}><button className="btn sm primary" onClick={() => setModal('acao')}>Propor ação</button></div>
                  {acoes.length === 0 && jobs.length === 0 && <div className="small muted">Nenhuma ação nasceu desta conversa ainda.</div>}
                  {acoes.map((a) => (
                    <div key={a.id} className="inbox-acao">
                      <div className="inbox-item-topo"><b>{a.titulo}</b><Badge tone={TOM_ACAO[a.estado]}>{a.estado.replace('_', ' ')}</Badge></div>
                      <div className="small muted">{NOME_ACAO[a.tipo]} · proposta por {a.propostaPor.nome} · {dataHora(a.criadaEm)}{a.aprovacao.papelDecisor ? ` · decide: ${a.aprovacao.papelDecisor}` : ''}</div>
                      {a.descricao && <p className="small">{a.descricao}</p>}
                      {a.aprovacao.motivo && <div className="small muted">motivo: {a.aprovacao.motivo}</div>}
                      {a.referencia && <div className="small">referência: {a.referencia}</div>}
                      <div className="actions">
                        {a.estado === 'aguardando_aprovacao' && <><button className="btn sm primary" onClick={() => tentar(() => actions.inboxDecidirAcao(a.id, 'aprovada'), 'Ação aprovada')}>Aprovar</button><button className="btn sm" onClick={() => { const m = window.prompt('Motivo da rejeição'); if (m) tentar(() => actions.inboxDecidirAcao(a.id, 'rejeitada', m), 'Ação rejeitada'); }}>Rejeitar</button></>}
                        {a.estado === 'aprovada' && <button className="btn sm primary" onClick={() => tentar(() => actions.inboxExecutarAcao(a.id), 'Ação executada')}>Executar</button>}
                      </div>
                    </div>
                  ))}
                  {jobs.length > 0 && <h3>Jobs</h3>}
                  {jobs.map((j) => (
                    <div key={j.id} className="inbox-acao">
                      <div className="inbox-item-topo"><b>{j.id} · {j.titulo}</b><Badge tone={TOM_JOB[j.estado]}>{j.estado}</Badge></div>
                      <div className="small muted">provider {j.provider}{j.referenciaExterna ? ` · ${j.referenciaExterna}` : ''} · {dataHora(j.criadoEm)}</div>
                      <p className="small">{j.objetivo}</p>
                      {j.resultado && <div className="small">{j.resultado.ok ? 'Concluído' : 'Falhou'}: {j.resultado.resumo}{j.resultado.evidencias.length ? ` · ${j.resultado.evidencias.map((e) => e.referencia).join(', ')}` : ''}</div>}
                      {(j.estado === 'ENVIADO' || j.estado === 'EM_EXECUCAO') && <div className="actions"><button className="btn sm" onClick={() => { setJobAlvo(j); setModal('resultado'); }}>Registrar resultado</button></div>}
                    </div>
                  ))}
                  <div className="small muted" style={{ marginTop: 10 }}>Jobs vão para o provider MANUAL nesta fase. A EIFF Dev Factory entra por `ExecutionProvider` quando expuser a API, sem mudar a conversa.</div>
                </>
              )}
              {aba === 'historico' && (
                <ul className="timeline">
                  {eventos.map((e) => <li key={e.id}><div>{e.detalhe}</div><div className="meta">{e.tipo} · {e.ator.nome} · {dataHora(e.em)}</div></li>)}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>

      {modal === 'triar' && thread && <TriarModal thread={thread} setores={inbox.setores.filter((s) => s.ativo)} onClose={() => setModal(null)} onOk={(d) => tentar(() => { actions.inboxTriar(thread.id, d); setModal(null); }, 'Conversa triada e roteada')} />}
      {modal === 'acao' && thread && <AcaoModal onClose={() => setModal(null)} onOk={(d) => tentar(() => { actions.inboxProporAcao(thread.id, d); setModal(null); setAba('acoes'); }, 'Ação proposta')} />}
      {modal === 'resultado' && jobAlvo && <ResultadoModal job={jobAlvo} onClose={() => setModal(null)} onOk={(d) => tentar(() => { actions.inboxRegistrarResultadoJob(jobAlvo.id, d); setModal(null); }, 'Resultado registrado')} />}
      {modal === 'status' && thread && statusAlvo && <MotivoModal titulo={`${NOME_STATUS[statusAlvo]}: informe o motivo`} onClose={() => setModal(null)} onOk={(m) => tentar(() => { actions.inboxMudarStatus(thread.id, statusAlvo, m); setModal(null); }, `Conversa: ${NOME_STATUS[statusAlvo]}`)} />}
      {modal === 'simular' && <SimularModal onClose={() => setModal(null)} onOk={(d) => tentar(() => { const r = actions.inboxReceber(d); setModal(null); if (r.thread) abrir(r.thread.id); toast(r.duplicada ? 'Mensagem repetida: ignorada pelo gateway' : r.motivo); }) } />}
      {el}
    </>
  );
}

function Atribuicao({ thread, setores, usuarios, onAplicar }: { thread: InboxThread; setores: { codigo: string; nome: string; ativo: boolean }[]; usuarios: { id: string; nome: string; ativo: boolean }[]; onAplicar: (setor: string, responsavel: string) => void }) {
  const [setor, setSetor] = useState(thread.setorCodigo ?? '');
  const [resp, setResp] = useState(thread.responsavelId ?? '');
  useEffect(() => { setSetor(thread.setorCodigo ?? ''); setResp(thread.responsavelId ?? ''); }, [thread.id, thread.setorCodigo, thread.responsavelId]);
  const mudou = setor !== (thread.setorCodigo ?? '') || resp !== (thread.responsavelId ?? '');
  return (
    <div className="form">
      <Field label="Setor"><Select value={setor} onChange={setSetor} allowEmpty="— sem setor —" options={setores.filter((s) => s.ativo).map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
      <Field label="Responsável"><Select value={resp} onChange={setResp} allowEmpty="— não atribuído —" options={usuarios.filter((u) => u.ativo).map((u) => ({ value: u.id, label: u.nome }))} /></Field>
      <div className="full actions"><button className="btn sm primary" disabled={!mudou} onClick={() => onAplicar(setor, resp)}>Aplicar</button></div>
    </div>
  );
}

function TriarModal({ thread, setores, onClose, onOk }: { thread: InboxThread; setores: { codigo: string; nome: string }[]; onClose: () => void; onOk: (d: { intencao: string; assunto: string; setorCodigo?: string; prioridade: Prioridade; nivel: NivelAtendimento }) => void }) {
  const c = thread.classificacao;
  const [intencao, setIntencao] = useState(c?.intencao ?? '');
  const [assunto, setAssunto] = useState(c?.assunto ?? thread.assunto);
  const [setor, setSetor] = useState(thread.setorCodigo ?? '');
  const [prioridade, setPrioridade] = useState<Prioridade>(thread.prioridade);
  const [nivel, setNivel] = useState<NivelAtendimento>(thread.nivel);
  return (
    <Modal title="Triagem humana" onClose={onClose}>
      <p className="small muted">A triagem vira uma classificação com provedor HUMANO e passa pelo mesmo roteamento das regras. O setor escolhido aqui prevalece; o nível nunca fica menos restritivo que a política.</p>
      <div className="form">
        <Field label="Intenção" req hint="ex.: consultar_pagamento, logistica_entrega, solicitar_orcamento, juridico"><Input value={intencao} onChange={(e) => setIntencao(e.target.value)} /></Field>
        <Field label="Assunto" req><Input value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Field>
        <Field label="Setor"><Select value={setor} onChange={setSetor} allowEmpty="— deixar as regras decidirem —" options={setores.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
        <Field label="Prioridade"><Select value={prioridade} onChange={(v) => setPrioridade(v as Prioridade)} options={[...PRIORIDADES]} /></Field>
        <Field label="Nível"><Select value={nivel} onChange={(v) => setNivel(v as NivelAtendimento)} options={NIVEIS_ATENDIMENTO.map((n) => ({ value: n, label: NOME_NIVEL[n] }))} /></Field>
        <div className="full actions"><button className="btn primary" disabled={!intencao.trim() || !assunto.trim()} onClick={() => onOk({ intencao, assunto, setorCodigo: setor || undefined, prioridade, nivel })}>Triar e rotear</button><button className="btn" onClick={onClose}>Cancelar</button></div>
      </div>
    </Modal>
  );
}

function AcaoModal({ onClose, onOk }: { onClose: () => void; onOk: (d: { tipo: TipoAcao; titulo: string; descricao: string; papelDecisor?: string }) => void }) {
  const [tipo, setTipo] = useState<TipoAcao>('criar_tarefa');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [papel, setPapel] = useState('');
  return (
    <Modal title="Propor ação a partir da conversa" onClose={onClose}>
      <div className="form">
        <Field label="Tipo"><Select value={tipo} onChange={(v) => setTipo(v as TipoAcao)} options={TIPOS_ACAO.map((t) => ({ value: t, label: NOME_ACAO[t] }))} /></Field>
        <Field label="Quem aprova" hint="vazio = não exige aprovação"><Select value={papel} onChange={setPapel} allowEmpty="— ninguém —" options={['Diretoria', 'Financeiro', 'Gestor de obra', 'Administrador']} /></Field>
        <Field label="Título" req full><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <Field label="Descrição" full><textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} /></Field>
        <div className="full actions"><button className="btn primary" disabled={!titulo.trim()} onClick={() => onOk({ tipo, titulo, descricao, papelDecisor: papel || undefined })}>Propor</button><button className="btn" onClick={onClose}>Cancelar</button></div>
      </div>
    </Modal>
  );
}

function ResultadoModal({ job, onClose, onOk }: { job: InboxJob; onClose: () => void; onOk: (d: { ok: boolean; resumo: string; evidencias: { tipo: 'link' | 'texto'; referencia: string; descricao: string }[] }) => void }) {
  const [ok, setOk] = useState(true);
  const [resumo, setResumo] = useState('');
  const [ref, setRef] = useState('');
  return (
    <Modal title={`Resultado do job ${job.id}`} onClose={onClose}>
      <div className="form">
        <Field label="Resultado"><Select value={ok ? 'ok' : 'falhou'} onChange={(v) => setOk(v === 'ok')} options={[{ value: 'ok', label: 'Concluído' }, { value: 'falhou', label: 'Falhou' }]} /></Field>
        <Field label="Evidência (link ou referência)"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="PR, commit, documento…" /></Field>
        <Field label="Resumo" req full><textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={3} /></Field>
        <div className="full actions"><button className="btn primary" disabled={!resumo.trim()} onClick={() => onOk({ ok, resumo, evidencias: ref.trim() ? [{ tipo: /^https?:/.test(ref) ? 'link' : 'texto', referencia: ref.trim(), descricao: 'evidência informada' }] : [] })}>Registrar</button><button className="btn" onClick={onClose}>Cancelar</button></div>
      </div>
    </Modal>
  );
}

function MotivoModal({ titulo, onClose, onOk }: { titulo: string; onClose: () => void; onOk: (motivo: string) => void }) {
  const [m, setM] = useState('');
  return (
    <Modal title={titulo} onClose={onClose}>
      <div className="form"><Field label="Motivo" req full><textarea value={m} onChange={(e) => setM(e.target.value)} rows={3} /></Field><div className="full actions"><button className="btn primary" disabled={!m.trim()} onClick={() => onOk(m)}>Confirmar</button><button className="btn" onClick={onClose}>Cancelar</button></div></div>
    </Modal>
  );
}

function SimularModal({ onClose, onOk }: { onClose: () => void; onOk: (d: Parameters<typeof actions.inboxReceber>[0]) => void }) {
  const [canal, setCanal] = useState<CanalInbox>('WHATSAPP');
  const [contexto, setContexto] = useState<'EXTERNAL' | 'INTERNAL'>('EXTERNAL');
  const [identificador, setIdentificador] = useState('5562900000199');
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('');
  const [externo, setExterno] = useState(`sim-${Date.now()}`);
  return (
    <Modal title="Simular mensagem recebida" onClose={onClose}>
      <p className="small muted">Entra pelo mesmo gateway idempotente que o canal real usará (deduplicação por provider + id externo). Nenhum canal é chamado.</p>
      <div className="form">
        <Field label="Canal"><Select value={canal} onChange={(v) => setCanal(v as CanalInbox)} options={CANAIS_INBOX.map((c) => ({ value: c, label: NOME_CANAL[c] }))} /></Field>
        <Field label="Contexto"><Select value={contexto} onChange={(v) => setContexto(v as 'EXTERNAL' | 'INTERNAL')} options={[{ value: 'EXTERNAL', label: 'Externo (cliente, fornecedor…)' }, { value: 'INTERNAL', label: 'Interno (colaborador)' }]} /></Field>
        <Field label="Identificador no canal" req hint="telefone E.164 sem +, e-mail ou id"><Input value={identificador} onChange={(e) => setIdentificador(e.target.value)} /></Field>
        <Field label="Nome informado pelo canal"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Id externo da mensagem" hint="repetir o mesmo id prova a deduplicação"><Input value={externo} onChange={(e) => setExterno(e.target.value)} /></Field>
        <Field label="Texto" req full><textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} /></Field>
        <div className="full actions"><button className="btn primary" disabled={!texto.trim() || !identificador.trim()} onClick={() => onOk({ canal, provider: 'MANUAL', contexto, identidade: { canal, identificador: identificador.trim(), nomeInformado: nome.trim() || undefined, verificada: false }, externalMessageId: externo.trim() || `sim-${Date.now()}`, texto, tipo: 'texto', em: new Date().toISOString() })}>Receber</button><button className="btn" onClick={onClose}>Cancelar</button></div>
      </div>
    </Modal>
  );
}

