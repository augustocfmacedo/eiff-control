// Diretor Financeiro virtual. Para a EQUIPE: conversa para pedir pagamentos e acompanhar o andamento, sem saldo, reserva
// ou parecer. Para a DIRETORIA (quem ve bancos e aprova): a Central, onde o DF entrega cada pedido ja orientado (data,
// impacto no caixa, alcada), o briefing do dia, a agenda da semana e o historico; e a conversa completa com numeros.
// Toda analise e deterministica (src/core/cfo.ts); a IA (opcional) so interpreta o texto.
import React, { useEffect, useRef, useState } from 'react';
import { NOME_DF, ROTULO_ALTERACAO, ROTULO_STATUS_DF, analisarPagamento, bloqueioAlteracao, ultimaAlteracao, type StatusPedidoDF, dataDoVeredicto, type VeredictoDF, br, catalogoDe, centralDF, completarPedido, type CentralDF as DadosCentralDF, fmt, interpretacaoDaIa, interpretarPedido, meusPedidosDF, montarPrevisao, responderDF, statusPedidoDF, type Parecer, type PedidoInterpretado } from '../core/cfo';
import { addDays } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { tokenSessao } from '../data/supabase';
import { Badge, Field, Input, Modal, MoedaInput, PageHead, Select, Tabs, money, tentar, useToast } from '../ui/components';
import { Icon } from '../ui/icons';
import { CamposPagamento } from '../ui/Pagamento';
import { DocumentosLancamento } from '../ui/Documentos';
import { anexosDe, pendenciasDocumentos } from '../core/anexos';
import { resumoPagamento, validarDadosPagamento, type DadosPagamento, type FormaPagamento } from '../core/pagamento';
import { registrarAcao } from '../data/telemetria';

interface Msg { papel: 'usuario' | 'assistente'; texto: string; pedido?: PedidoInterpretado; parecer?: Parecer; veredicto?: VeredictoDF; registrado?: string; sugestoes?: string[]; origem?: 'ia' | 'local' }
const CHAVE = 'eiff-control:df:conversa';
const TOM_STATUS: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'muted'> = { aguardando: 'warn', programado: 'ok', em_aprovacao: 'info', reagendado: 'info', recusado: 'bad', pago: 'ok' };

function Texto({ t }: { t: string }) {
  return <>{t.split('\n').map((ln, i) => { const li = /^\s*[-•]\s+(.*)$/.exec(ln); const partes = (li ? li[1] : ln).split(/(\*\*[^*]+\*\*|\[\/[a-zA-Z0-9/-]*\])/g).map((p, j) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={j}>{p.slice(2, -2)}</b> : /^\[\/[a-zA-Z0-9/-]*\]$/.test(p) ? <a key={j} href={`#${p.slice(1, -1)}`}>{p.slice(1, -1) === '/pagar' ? 'Contas a pagar' : p.slice(1, -1)}</a> : <span key={j}>{p}</span>)); return li ? <div key={i} className="df-item">• {partes}</div> : ln.trim() ? <p key={i}>{partes}</p> : null; })}</>;
}

/** Chat com o Diretor Financeiro. veCaixa = Diretoria/Financeiro (respostas com numeros); equipe so pede e acompanha. */
export function ConversaDF({ veCaixa, nova = false }: { veCaixa: boolean; nova?: boolean }) {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const chave = `${CHAVE}:${usuario.id}`; // conversa por usuario: num aparelho compartilhado ninguem ve o chat do outro
  // `nova` (link #/diretor/nova): a conversa sempre comeca do zero
  const [msgs, setMsgs] = useState<Msg[]>(() => { if (nova) return []; try { const v = sessionStorage.getItem(chave); return v ? (JSON.parse(v) as Msg[]) : []; } catch { return []; } });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ia, setIa] = useState<'desconhecido' | 'ok' | 'indisponivel'>(modo === 'remoto' ? 'desconhecido' : 'indisponivel');
  const [ajuste, setAjuste] = useState<{ idx: number; valor: number; vencimento: string; categoria: string; codigoObra: string; contraparte: string; descricao: string; formaPagamento?: FormaPagamento; dadosPagamento?: DadosPagamento } | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  // rola so a area das mensagens (nunca a pagina): a conversa tambem vive dentro da tela Caixa
  useEffect(() => { const box = fim.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; try { sessionStorage.setItem(chave, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } }, [msgs, chave]);
  const catalogo = catalogoDe(ds);
  const podeRegistrar = pode(usuario, 'pedir_pagamento');
  // a equipe nao recebe o parecer (saldo, reserva): o botao de encaminhar aparece pelo pedido completo, e o parecer e calculado so na hora de montar
  const pedidoPronto = (m: Msg) => m.papel === 'assistente' && !!m.pedido && m.pedido.intencao === 'pagamento' && !m.pedido.faltando.length && !!m.pedido.valor;
  const parecerDe = (m: Msg) => m.parecer ?? analisarPagamento(ds, { valor: m.pedido!.valor!, vencimento: m.pedido!.vencimento, codigoObra: m.pedido!.codigoObra, categoria: m.pedido!.categoria });
  const enviarPedido = async (prev: ReturnType<typeof montarPrevisao>, marcar: (id: string) => void) => {
    setOcupado(true);
    try { const l = await actions.solicitarPagamentoDF(prev); marcar(l.id); setMsgs((ms) => ms.concat({ papel: 'assistente', texto: confirmacao(l.id, l.valorBruto, l.vencimento, l.categoria, l.codigoObra, l.contraparte) })); registrarAcao('df:previsao'); }
    catch (e) { toast((e as Error).message); }
    finally { setOcupado(false); }
  };
  const ultimoPedidoIncompleto = () => [...msgs].reverse().find((m) => m.papel === 'assistente' && m.pedido?.intencao === 'pagamento' && m.pedido.faltando.length && !m.registrado)?.pedido;

  const interpretar = async (q: string, hist: Msg[]): Promise<PedidoInterpretado> => {
    const local = interpretarPedido(q, catalogo);
    if (ia === 'indisponivel') return local;
    try {
      const token = await tokenSessao();
      const r = await fetch('/api/diretor-financeiro', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ mensagens: [...hist.slice(-5).map((m) => ({ papel: m.papel, texto: m.texto })), { papel: 'usuario', texto: q }], catalogo }) });
      if (r.status === 501 || r.status === 404) { setIa('indisponivel'); return local; }
      if (!r.ok) return local;
      const d = (await r.json()) as { interpretacao?: unknown };
      const p = interpretacaoDaIa(d.interpretacao, catalogo, q);
      if (p) { setIa('ok'); const valor = p.valor ?? local.valor; const vencimento = p.vencimento ?? local.vencimento; return { ...p, valor, vencimento, categoria: p.categoria ?? local.categoria, codigoObra: p.codigoObra ?? local.codigoObra, contraparte: p.contraparte ?? local.contraparte, faltando: p.intencao === 'pagamento' ? ([...(!valor ? ['valor'] : []), ...(!vencimento ? ['vencimento'] : [])] as PedidoInterpretado['faltando']) : [] }; }
      return local;
    } catch { return local; }
  };

  const buscarVeredicto = async (p: PedidoInterpretado): Promise<VeredictoDF | null> => {
    try {
      const token = await tokenSessao();
      const r = await fetch('/api/diretor-financeiro', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ acao: 'veredicto', pedido: { valor: p.valor, vencimento: p.vencimento, ...(p.codigoObra ? { codigoObra: p.codigoObra } : {}), ...(p.categoria ? { categoria: p.categoria } : {}) } }) });
      if (!r.ok) return null;
      const d = (await r.json()) as { veredicto?: VeredictoDF };
      return d.veredicto ?? null;
    } catch { return null; }
  };

  const enviar = async (q0?: string) => {
    const q = (q0 ?? texto).trim(); if (!q || ocupado) return;
    setTexto(''); const hist: Msg[] = [...msgs, { papel: 'usuario', texto: q }]; setMsgs(hist); setOcupado(true); registrarAcao('df:pergunta');
    try {
      let pedido = /^meus pedidos$/i.test(q) ? { ...interpretarPedido(q, catalogo), intencao: 'previsoes' as const, faltando: [] } : await interpretar(q, msgs);
      const pendente = ultimoPedidoIncompleto();
      // complemento ("500 reais, sexta") junta-se ao pedido que ficou incompleto; um pedido novo e completo segue sozinho
      if (pendente && (pedido.intencao === 'pagamento' || pedido.intencao === 'outro') && (pedido.valor || pedido.vencimento) && (pedido.intencao === 'outro' || pedido.faltando.length > 0)) pedido = completarPedido(pendente, pedido);
      // quem nao ve caixa, no sistema ligado ao banco, nao tem o caixa no aparelho: o veredito vem do servidor (sem valores)
      const completo = pedido.intencao === 'pagamento' && !pedido.faltando.length && !!pedido.valor && !!pedido.vencimento;
      const veredictoServidor = !veCaixa && modo === 'remoto' && completo ? await buscarVeredicto(pedido) : undefined;
      const r = responderDF(ds, usuario, pedido, veCaixa, veredictoServidor);
      setMsgs([...hist, { papel: 'assistente', texto: r.texto, pedido: r.pedido, parecer: r.parecer, veredicto: r.veredicto, sugestoes: r.sugestoes, origem: pedido.origem }]);
    } finally { setOcupado(false); }
  };

  const confirmacao = (id: string, valor: number, venc: string, cat: string, obra: string, forn: string) => veCaixa
    ? `Previsão **${id}** registrada: ${fmt(valor)} em ${br(venc)}, ${cat}${obra ? `, obra ${obra}` : ''}, fornecedor ${forn}. Entra na Central para decisão; acompanhe em [/lancamentos/${id}].`
    : `Pedido **${id}** encaminhado à Diretoria: ${fmt(valor)} para ${br(venc)}${forn !== 'A definir' ? `, ${forn}` : ''}. Te aviso quando for decidido; veja o andamento em "Meus pedidos".`;
  const registrar = (idx: number, data: string) => {
    const m = msgs[idx]; if (!m.pedido || (!m.parecer && !pedidoPronto(m))) return;
    // equipe: antes de encaminhar, confere o pedido e informa COMO pagar (forma e dados viajam no titulo)
    if (!veCaixa) { abrirAjuste(idx, data); return; }
    const prev = montarPrevisao(ds, m.pedido, parecerDe(m), data);
    void enviarPedido(prev, (id) => setMsgs((ms) => ms.map((x, i) => (i === idx ? { ...x, registrado: id } : x))));
  };
  const abrirAjuste = (idx: number, data?: string) => { const m = msgs[idx]; if (!m.pedido || (!m.parecer && !pedidoPronto(m))) return; const pa = parecerDe(m); const prev = montarPrevisao(ds, m.pedido, pa, data ?? (veCaixa ? pa.dataSugerida ?? pa.vencimento : m.pedido.vencimento ?? pa.vencimento)); setAjuste((a) => ({ idx, valor: prev.valor, vencimento: prev.vencimento, categoria: prev.categoria, codigoObra: prev.codigoObra ?? '', contraparte: prev.contraparte === 'A definir' ? '' : prev.contraparte, descricao: prev.descricao, formaPagamento: a?.idx === idx ? a.formaPagamento : undefined, dadosPagamento: a?.idx === idx ? a.dadosPagamento : undefined })); };
  const confirmarAjuste = () => {
    if (!ajuste) return;
    const m = msgs[ajuste.idx]; if (!m.pedido) return;
    const pedido: PedidoInterpretado = { ...m.pedido, valor: ajuste.valor, vencimento: ajuste.vencimento, categoria: ajuste.categoria, codigoObra: ajuste.codigoObra || undefined, contraparte: ajuste.contraparte || undefined, descricao: ajuste.descricao, faltando: [] };
    const parecer = analisarPagamento(ds, { valor: pedido.valor!, vencimento: pedido.vencimento, codigoObra: pedido.codigoObra, categoria: pedido.categoria });
    const prev = { ...montarPrevisao(ds, pedido, parecer, ajuste.vencimento), ...(ajuste.formaPagamento ? { formaPagamento: ajuste.formaPagamento, dadosPagamento: ajuste.dadosPagamento } : {}) };
    const idx = ajuste.idx; setAjuste(null);
    void enviarPedido(prev, (id) => setMsgs((ms) => ms.map((x, i) => (i === idx ? { ...x, registrado: id } : x))));
  };
  const errosPagamento = ajuste ? validarDadosPagamento(ajuste.formaPagamento, ajuste.dadosPagamento) : [];
  const tom = (p: Parecer) => (p.decisao === 'liberar' ? 'ok' : p.decisao === 'reagendar' ? 'info' : p.decisao === 'atencao' ? 'warn' : 'bad') as 'ok' | 'info' | 'warn' | 'bad';
  const sugestoesIniciais = veCaixa ? ['Preciso pagar um frete de R$ 500 amanhã', 'Como está o caixa?', 'O que vence essa semana?', 'Quais previsões estão pendentes?'] : ['Preciso agendar um pagamento', 'Preciso pagar um frete de R$ 500 amanhã para a Transportadora X', 'Meus pedidos'];

  return (
    <div className="df">
      <div className="df-msgs">
        {!msgs.length && <div className="df-vazio">
          <div className="df-avatar"><Icon name="chat" size={22} /></div>
          <div><b>Olá, {usuario.nome.split(' ')[0]}.</b> Sou o {NOME_DF} virtual. {veCaixa ? 'Pergunte sobre o caixa e os vencimentos, ou me diga um pagamento que eu analiso e registro a previsão.' : 'Me diga o que precisa pagar, quanto, para quando e para quem. Eu anoto, confiro a possibilidade com a Diretoria e te aviso o que foi decidido.'}</div>
          <div className="chips" style={{ marginTop: 10 }}>{sugestoesIniciais.map((s) => <button key={s} className="chip sm" onClick={() => void enviar(s)}>{s}</button>)}</div>
        </div>}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.papel}`}>
            <div className="chat-bolha">
              <Texto t={m.texto} />
              {(m.parecer || (!veCaixa && pedidoPronto(m))) && !m.registrado && podeRegistrar && <div className="df-card">
                {veCaixa && m.parecer && <div className="df-card-cab"><Badge tone={tom(m.parecer)}>{m.parecer.decisao === 'liberar' ? 'cabe no caixa' : m.parecer.decisao === 'reagendar' ? 'melhor reagendar' : m.parecer.decisao === 'atencao' ? 'consome a reserva' : 'não recomendado'}</Badge><span>{fmt(m.parecer.valor)} · {br(m.parecer.dataSugerida ?? m.parecer.vencimento)}</span></div>}
                <div className="actions">
                  {veCaixa && m.parecer
                    ? <><button className="btn primary sm" onClick={() => registrar(i, m.parecer!.dataSugerida ?? m.parecer!.vencimento)}>Registrar previsão{m.parecer.dataSugerida ? ` para ${br(m.parecer.dataSugerida)}` : ''}</button>{m.parecer.dataSugerida && <button className="btn sm" onClick={() => registrar(i, m.parecer!.vencimento)}>Manter {br(m.parecer.vencimento)} mesmo assim</button>}</>
                    : m.veredicto?.decisao === 'reagendar' && m.veredicto.dataSugerida
                      ? <><button className="btn primary sm" disabled={ocupado} onClick={() => registrar(i, dataDoVeredicto(m.veredicto!))}>Encaminhar para {br(m.veredicto.dataSugerida)}</button><button className="btn sm" disabled={ocupado} onClick={() => registrar(i, m.pedido!.vencimento!)}>Manter {br(m.pedido!.vencimento)} (a Diretoria avalia)</button></>
                      : <button className="btn primary sm" disabled={ocupado} onClick={() => registrar(i, m.pedido!.vencimento ?? parecerDe(m).vencimento)}>Confirmar e encaminhar à Diretoria</button>}
                  <button className="btn sm" onClick={() => abrirAjuste(i)}>Ajustar</button>
                </div>
              </div>}
              {(m.parecer || pedidoPronto(m)) && !podeRegistrar && <div className="small muted" style={{ marginTop: 6 }}>Seu perfil não registra pedidos; peça a um gestor ou ao financeiro.</div>}
              {m.registrado && <div className="small muted" style={{ marginTop: 6 }}>{veCaixa ? 'Registrada como' : 'Encaminhado como'} {m.registrado}.</div>}
              {m.sugestoes && <div className="chips" style={{ marginTop: 8 }}>{m.sugestoes.map((s) => <button key={s} className="chip sm" onClick={() => void enviar(s)}>{s}</button>)}</div>}
            </div>
          </div>
        ))}
        {ocupado && <div className="chat-msg assistente"><div className="chat-bolha muted">{veCaixa ? 'conferindo o caixa…' : 'anotando…'}</div></div>}
        <div ref={fim} />
      </div>
      <form className="df-input" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: preciso pagar um frete de R$ 500 amanhã para a Transportadora X" disabled={ocupado} />
        <button className="btn primary" type="submit" disabled={ocupado || !texto.trim()}>Enviar</button>
        <Badge tone={ia === 'ok' ? 'ok' : 'muted'} title="A IA só interpreta o texto; os números vêm do motor do sistema">{ia === 'ok' ? 'IA + motor' : 'motor'}</Badge>
        {!!msgs.length && <button type="button" className="btn sm" onClick={() => setMsgs([])}>Limpar</button>}
      </form>
      {ajuste && <Modal title={veCaixa ? 'Ajustar a previsão' : 'Conferir o pedido e como pagar'} onClose={() => setAjuste(null)}>
        <div className="form">
          <Field label="Valor (R$)" req><Input type="number" step="0.01" min={0} value={ajuste.valor} onChange={(e) => setAjuste({ ...ajuste, valor: Number(e.target.value) })} /></Field>
          <Field label="Data do pagamento" req><Input type="date" value={ajuste.vencimento} onChange={(e) => setAjuste({ ...ajuste, vencimento: e.target.value })} /></Field>
          <Field label="Categoria" req><Select value={ajuste.categoria} onChange={(v) => setAjuste({ ...ajuste, categoria: v })} options={catalogo.categorias} /></Field>
          <Field label="Obra"><Select value={ajuste.codigoObra} onChange={(v) => setAjuste({ ...ajuste, codigoObra: v })} allowEmpty="— sem obra —" options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} /></Field>
          <Field label="Para quem (fornecedor)" hint="Ajuda a Diretoria a decidir"><Input value={ajuste.contraparte} onChange={(e) => setAjuste({ ...ajuste, contraparte: e.target.value })} /></Field>
          <Field label="Descrição" req full><Input value={ajuste.descricao} onChange={(e) => setAjuste({ ...ajuste, descricao: e.target.value })} /></Field>
          <CamposPagamento forma={ajuste.formaPagamento} dados={ajuste.dadosPagamento} exigir={!veCaixa} erros={errosPagamento} onChange={(formaPagamento, dadosPagamento) => setAjuste({ ...ajuste, formaPagamento, dadosPagamento })} />
        </div>
        <div className="foot"><button className="btn" onClick={() => setAjuste(null)}>Cancelar</button><button className="btn primary" disabled={!veCaixa && (!ajuste.formaPagamento || errosPagamento.length > 0)} onClick={confirmarAjuste}>{veCaixa ? 'Registrar previsão' : 'Encaminhar à Diretoria'}</button></div>
      </Modal>}
      {el}
    </div>
  );
}

/** Grupos de situacao do "Meus pedidos" (filtro por chip). */
const GRUPOS_PEDIDO: { id: 'todos' | 'aguardando' | 'validados' | 'pagos' | 'recusados'; rotulo: string; status: StatusPedidoDF[] }[] = [
  { id: 'todos', rotulo: 'Todos', status: ['aguardando', 'reagendado', 'programado', 'em_aprovacao', 'pago', 'recusado'] },
  { id: 'aguardando', rotulo: 'Aguardando', status: ['aguardando', 'reagendado'] },
  { id: 'validados', rotulo: 'Validados', status: ['programado', 'em_aprovacao'] },
  { id: 'pagos', rotulo: 'Pagos', status: ['pago'] },
  { id: 'recusados', rotulo: 'Não aprovados', status: ['recusado'] },
];
type GrupoPedido = (typeof GRUPOS_PEDIDO)[number];
const TOM_ALTERACAO: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'muted'> = { PENDENTE: 'warn', ACEITA: 'ok', RECUSADA: 'bad', CANCELADA: 'muted' };

/** Andamento dos pedidos do proprio usuario (equipe), sem dados de caixa: situacao de cada um e alteracao de valor. */
export function MeusPedidosDF() {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const solicitante = usuario.papel === 'Solicitante' && modo === 'remoto';
  const [atualizando, setAtualizando] = useState(false);
  const [grupo, setGrupo] = useState<GrupoPedido['id']>('todos');
  const [alterar, setAlterar] = useState<{ id: string; valor: number; motivo: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [docsAbertos, setDocsAbertos] = useState<string | null>(null);
  const atualizar = () => { setAtualizando(true); actions.atualizarPedidosSolicitante().catch(() => undefined).finally(() => setAtualizando(false)); };
  // o Solicitante nao recebe atualizacao automatica dos dados: relê a lista a cada minuto enquanto a tela esta aberta
  useEffect(() => { if (!solicitante) return; const t = window.setInterval(() => { void actions.atualizarPedidosSolicitante().catch(() => undefined); }, 60_000); return () => window.clearInterval(t); }, [solicitante]);
  const todos = meusPedidosDF(ds, usuario);
  const doGrupo = (g: GrupoPedido) => todos.filter((l) => g.status.includes(statusPedidoDF(l)));
  const ativo = GRUPOS_PEDIDO.find((g) => g.id === grupo) ?? GRUPOS_PEDIDO[0];
  const lista = doGrupo(ativo).slice(0, 100);
  const pedidoAlterar = alterar ? todos.find((l) => l.id === alterar.id) : undefined;
  const enviar = async () => {
    if (!alterar) return;
    setEnviando(true);
    try { await actions.pedirAlteracaoValorDF(alterar.id, alterar.valor, alterar.motivo); setAlterar(null); toast('Alteração enviada à Diretoria. O valor muda quando ela aceitar.'); }
    catch (e) { toast((e as Error).message); }
    finally { setEnviando(false); }
  };
  const cancelar = async (id: string) => { try { await actions.cancelarAlteracaoValorDF(id); toast('Alteração cancelada: o pedido segue com o valor atual.'); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><h2 style={{ margin: 0 }}>Meus pedidos</h2>{solicitante && <button className="btn sm" onClick={atualizar} disabled={atualizando}>{atualizando ? 'Atualizando…' : 'Atualizar'}</button>}</div>
      {!todos.length && <p className="muted small">Nenhum pedido ainda. Fale com o Diretor Financeiro ao lado.</p>}
      {!!todos.length && (
        <div className="df-filtros" role="group" aria-label="Filtrar pedidos por situação">
          {GRUPOS_PEDIDO.map((g) => (
            <button key={g.id} className={`btn sm${grupo === g.id ? ' primary' : ''}`} aria-pressed={grupo === g.id} onClick={() => setGrupo(g.id)}>
              {g.rotulo} <span className="df-filtro-n">{doGrupo(g).length}</span>
            </button>
          ))}
        </div>
      )}
      {!!todos.length && <p className="small muted" style={{ margin: '6px 0 4px' }}>{lista.length} pedido(s) · {money(lista.reduce((t, l) => t + l.valorBruto, 0))}</p>}
      {!!todos.length && !lista.length && <p className="muted small">Nenhum pedido nesta situação.</p>}
      {lista.map((l) => { const s = statusPedidoDF(l); const alt = ultimaAlteracao(ds, l.id); const bloqueio = bloqueioAlteracao(ds, l); return (
        <div key={l.id} className="df-prev">
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{l.descricao}</b> <span className="muted small">{l.id}{l.codigoObra ? ` · ${l.codigoObra}` : ''}{l.contraparte !== 'A definir' ? ` · ${l.contraparte}` : ''}</span>
            <div className="small muted">{money(l.valorBruto)} · {br(l.vencimento)}{l.criadoEm ? ` · pedido em ${br(l.criadoEm.slice(0, 10))}` : ''}{s === 'recusado' && l.motivoCancelamento ? ` · ${l.motivoCancelamento.replace(/^Recusada no alinhamento diário: /, '')}` : ''}</div>
            {l.formaPagamento && <div className="small muted">Pagamento: {resumoPagamento(l.formaPagamento, l.dadosPagamento)}</div>}
            {alt && (
              <div className="small df-alteracao">
                <Badge tone={TOM_ALTERACAO[alt.status]}>{ROTULO_ALTERACAO[alt.status]}</Badge>{' '}
                {money(alt.valorAnterior)} → <b>{money(alt.valorNovo)}</b>
                {alt.status === 'RECUSADA' && alt.motivoDecisao ? <> · {alt.motivoDecisao}</> : null}
                {alt.status === 'PENDENTE' && <> <button className="btn sm" onClick={() => void cancelar(alt.id)}>Cancelar alteração</button></>}
              </div>
            )}
          </div>
          <div className="df-prev-acoes">
            <Badge tone={TOM_STATUS[s]}>{ROTULO_STATUS_DF[s]}</Badge>
            {!bloqueio && <button className="btn sm" onClick={() => setAlterar({ id: l.id, valor: l.valorBruto, motivo: '' })}>Alterar valor</button>}
            <button className="btn sm" aria-expanded={docsAbertos === l.id} onClick={() => setDocsAbertos(docsAbertos === l.id ? null : l.id)}>Documentos ({anexosDe(ds, l.id).length}){pendenciasDocumentos(ds, l).length ? ' !' : ''}</button>
          </div>
          {docsAbertos === l.id && <div style={{ flexBasis: '100%' }}><DocumentosLancamento lancamento={l} aviso={toast} compacto /></div>}
        </div>
      ); })}
      {alterar && pedidoAlterar && (
        <Modal title={`Alterar valor de ${pedidoAlterar.id}`} onClose={() => setAlterar(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>{pedidoAlterar.descricao} · valor atual <b>{money(pedidoAlterar.valorBruto)}</b> · {br(pedidoAlterar.vencimento)}. A Diretoria valida a alteração; até lá vale o valor atual.</p>
          <Field label="Novo valor" req><MoedaInput autoFocus value={alterar.valor} onChange={(v) => setAlterar({ ...alterar, valor: v })} /></Field>
          <Field label="Motivo da alteração" req full><Input value={alterar.motivo} maxLength={500} placeholder="ex.: orçamento final veio maior, frete incluído" onChange={(e) => setAlterar({ ...alterar, motivo: e.target.value })} /></Field>
          <div className="foot"><button className="btn" onClick={() => setAlterar(null)}>Cancelar</button><button className="btn primary" disabled={enviando || alterar.motivo.trim().length < 3 || !(alterar.valor > 0) || alterar.valor === pedidoAlterar.valorBruto} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Enviar à Diretoria'}</button></div>
        </Modal>
      )}
      {el}
    </div>
  );
}

/** Central da Diretoria: o DF entrega os pedidos ja orientados; um clique segue a recomendacao. */
/** Briefing falado do dia (src/core/cfo.ts centralDF): usado na Central e no topo da tela Caixa. */
export function BriefingDF({ c, acoes }: { c: DadosCentralDF; acoes?: React.ReactNode }) {
  const { ds } = useStore();
  return (
    <div className="card df-briefing">
      <div className="df-avatar"><Icon name="chat" size={22} /></div>
      <div style={{ flex: 1 }}><b>Briefing do {NOME_DF} · {br(ds.params.dataBase)}</b><p>{c.briefing}</p>{acoes && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{acoes}</div>}</div>
    </div>
  );
}

/** Pedidos da equipe ja orientados, com a decisao na hora (programar, reagendar, outra data, recusar). Na Central e na Caixa. */
export function PedidosDF({ c, vazio = true }: { c: DadosCentralDF; vazio?: boolean }) {
  const { usuario } = useStore();
  const { toast, el } = useToast();
  const al = c.alinhamento;
  const [reag, setReag] = useState<{ id: string; data: string } | null>(null);
  const [recusa, setRecusa] = useState<{ id: string; motivo: string } | null>(null);
  const [recusaAlt, setRecusaAlt] = useState<{ id: string; motivo: string } | null>(null);
  const podeDecidir = pode(usuario, 'aprovar');
  const seguir = (id: string, o: DadosCentralDF['orientacoes'] extends Map<string, infer V> ? V : never) => {
    if (o.acaoSugerida === 'programar') tentar(() => actions.decidirPrevisaoDF(id, 'programar'), toast, () => toast(`${id} programado.`));
    else if (o.acaoSugerida === 'reagendar' && o.dataSugerida) tentar(() => actions.decidirPrevisaoDF(id, 'reagendar', { vencimento: o.dataSugerida }), toast, () => toast(`${id} reagendado para ${br(o.dataSugerida)}.`));
    else if (o.acaoSugerida === 'recusar') setRecusa({ id, motivo: 'Caixa não comporta no período' });
  };
  if (!al.previsoes.length && !c.alteracoes.length && !vazio) return el; // sem pedidos (ex.: acabou de decidir o ultimo): some o cartao, fica o aviso
  return (
    <>
      {!!c.alteracoes.length && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Alterações de valor pedidas pela equipe</h2>
          <p className="small muted" style={{ marginTop: 0 }}>O pedido segue com o valor atual até você aceitar. Aceitar grava o novo valor; pedido já programado volta a passar pelas alçadas.</p>
          {c.alteracoes.map(({ alteracao: a, lancamento: l, analise }) => (
            <div key={a.id} className="df-alteracao-card">
              <div className="df-pedido-cab">
                <div><b>{l.descricao}</b> <span className="muted small">{l.id} · {l.categoria}{l.codigoObra ? ` · ${l.codigoObra}` : ''} · {l.contraparte}</span>
                  <div className="small muted"><b>{a.solicitadoPor}</b> pede {money(a.valorAnterior)} → <b>{money(a.valorNovo)}</b> ({analise.diferenca >= 0 ? '+' : '−'}{money(Math.abs(analise.diferenca))}) para {br(l.vencimento)} · pedido {ROTULO_STATUS_DF[statusPedidoDF(l)]}</div>
                  <div className="small">Motivo: {a.motivo}</div></div>
                <Badge tone={analise.tom}>{analise.titulo}</Badge>
              </div>
              <div className="df-orientacao">{analise.detalhe}</div>
              {podeDecidir && <div className="actions">
                <button className="btn primary sm" onClick={() => tentar(() => actions.decidirAlteracaoValorDF(a.id, 'aceitar'), toast, () => toast(`${l.id}: novo valor ${money(a.valorNovo)} gravado.`))}>Aceitar {money(a.valorNovo)}</button>
                <button className="btn sm danger" onClick={() => setRecusaAlt({ id: a.id, motivo: '' })}>Recusar</button>
              </div>}
            </div>
          ))}
        </div>
      )}
      {(!!al.previsoes.length || vazio) && <div className="card" style={{ marginBottom: 14 }}>
        <h2>Pedidos da equipe · orientação do {NOME_DF}</h2>
        {!al.previsoes.length && <p className="muted small">Nenhum pedido aguardando. Quando alguém pedir um pagamento ao Diretor Financeiro, ele aparece aqui já analisado.</p>}
        {al.previsoes.map(({ lancamento: l, parecerAtual: p, solicitante, diasEsperando }) => { const o = c.orientacoes.get(l.id)!; return (
          <div key={l.id} className="df-pedido">
            <div className="df-pedido-cab">
              <div><b>{l.descricao}</b> <span className="muted small">{l.id} · {l.categoria}{l.codigoObra ? ` · ${l.codigoObra}` : ''} · {l.contraparte}</span><div className="small muted">Pedido de <b>{solicitante}</b>{diasEsperando ? ` há ${diasEsperando} dia(s)` : ' hoje'} · <b>{money(l.valorLiquidoPrevisto)}</b> para {br(l.vencimento)}{p.precisaAprovacao && <> · alçada {p.alcada.join(' → ')}</>}</div></div>
              <Badge tone={o.acaoSugerida === 'programar' ? 'ok' : o.acaoSugerida === 'reagendar' ? 'info' : o.acaoSugerida === 'avaliar' ? 'warn' : 'bad'}>{o.acaoSugerida === 'programar' ? 'programar' : o.acaoSugerida === 'reagendar' ? `reagendar → ${br(o.dataSugerida)}` : o.acaoSugerida === 'avaliar' ? 'seu aval' : 'não recomendado'}</Badge>
            </div>
            {l.formaPagamento && <div className="small muted">Pagamento: {resumoPagamento(l.formaPagamento, l.dadosPagamento)}</div>}
            <DocumentosLancamento lancamento={l} aviso={toast} compacto />
            <div className="df-orientacao"><b>{o.titulo}.</b> {o.detalhe}</div>
            {podeDecidir && <div className="actions">
              {o.acaoSugerida !== 'avaliar' && <button className="btn primary sm" onClick={() => seguir(l.id, o)}>{o.acaoSugerida === 'programar' ? `Programar para ${br(l.vencimento)}` : o.acaoSugerida === 'reagendar' ? `Reagendar para ${br(o.dataSugerida)}` : 'Recusar'}</button>}
              {o.acaoSugerida !== 'programar' && <button className="btn sm" onClick={() => tentar(() => actions.decidirPrevisaoDF(l.id, 'programar'), toast, () => toast(`${l.id} programado${p.precisaAprovacao ? ' e enviado à alçada' : ''}.`))}>Programar mesmo assim</button>}
              <button className="btn sm" onClick={() => setReag({ id: l.id, data: o.dataSugerida ?? addDays(l.vencimento, 1) })}>Outra data</button>
              {o.acaoSugerida !== 'recusar' && <button className="btn sm danger" onClick={() => setRecusa({ id: l.id, motivo: '' })}>Recusar</button>}
            </div>}
          </div>
        ); })}
      </div>}

      {reag && <Modal title={`Outra data para ${reag.id}`} onClose={() => setReag(null)}><Field label="Nova data" req><Input type="date" value={reag.data} onChange={(e) => setReag({ ...reag, data: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setReag(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.decidirPrevisaoDF(reag.id, 'reagendar', { vencimento: reag.data }), toast, () => { setReag(null); toast('Pedido reagendado; o solicitante vê a nova data em Meus pedidos.'); })}>Reagendar</button></div></Modal>}
      {recusaAlt && <Modal title="Recusar alteração de valor" onClose={() => setRecusaAlt(null)}><Field label="Motivo (o solicitante vê)" req full><Input autoFocus value={recusaAlt.motivo} onChange={(e) => setRecusaAlt({ ...recusaAlt, motivo: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setRecusaAlt(null)}>Cancelar</button><button className="btn danger" disabled={recusaAlt.motivo.trim().length < 3} onClick={() => tentar(() => actions.decidirAlteracaoValorDF(recusaAlt.id, 'recusar', recusaAlt.motivo), toast, () => { setRecusaAlt(null); toast('Alteração recusada; o pedido segue com o valor atual.'); })}>Recusar</button></div></Modal>}
      {recusa && <Modal title={`Recusar ${recusa.id}`} onClose={() => setRecusa(null)}><Field label="Motivo (o solicitante vê)" req full><Input autoFocus value={recusa.motivo} onChange={(e) => setRecusa({ ...recusa, motivo: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setRecusa(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.decidirPrevisaoDF(recusa.id, 'recusar', { motivo: recusa.motivo }), toast, () => { setRecusa(null); toast('Pedido recusado.'); })}>Recusar</button></div></Modal>}
      {el}
    </>
  );
}

export function CentralDF() {
  const { ds } = useStore();
  const c = centralDF(ds);
  const al = c.alinhamento;
  const max = Math.max(1, ...al.dias.map((d) => Math.abs(d.saldo)), ...al.dias.map((d) => Math.abs(d.saldoComPrevisoes)), al.reserva);
  return (
    <div>
      <BriefingDF c={c} />
      <div className="grid cols-4" style={{ margin: '14px 0' }}>
        <div className="kpi"><div className="label">Pedidos para decidir</div><div className="value">{al.previsoes.length}</div><div className="hint">{money(al.totalPrevisoes)}</div></div>
        <div className="kpi"><div className="label">Caixa hoje</div><div className="value">{money(al.saldoHoje)}</div><div className="hint">o mesmo da tela Caixa · {al.extrato.texto}{al.compromissosHoje ? ` · vencidos e hoje −${money(al.compromissosHoje)}` : ''} · piso {money(al.reserva)}</div></div>
        <div className="kpi"><div className="label">Menor saldo da semana</div><div className="value">{money(Math.min(...al.dias.map((d) => d.saldoComPrevisoes)))}</div><div className="hint">com os pedidos</div></div>
        <div className="kpi"><div className="label">Vence hoje</div><div className="value">{al.venceHoje.length}</div><div className="hint">{money(al.venceHoje.reduce((s, l) => s + l.saldoAberto, 0))}</div></div>
      </div>
      {al.alertas.map((a) => <div key={a} className="alert warn">{a}</div>)}
      <PedidosDF c={c} />

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Agenda de caixa · próximos 7 dias</h2>
        <div className="df-dias">{al.dias.map((d) => <div key={d.data} className={`df-dia ${d.abaixoReserva ? 'furo' : ''}`} title={`${br(d.data)}: entradas ${money(d.entradas)}, saídas ${money(d.saidas)}, pedidos ${money(d.previsoes)}`}>
          <div className="barras"><i className="sem" style={{ height: `${Math.max(2, (Math.max(0, d.saldo) / max) * 100)}%` }} /><i className="com" style={{ height: `${Math.max(2, (Math.max(0, d.saldoComPrevisoes) / max) * 100)}%` }} /></div>
          <b>{br(d.data)}</b><span>{money(d.saldoComPrevisoes)}</span>{d.previsoes > 0 && <span className="muted">−{money(d.previsoes)}</span>}
        </div>)}</div>
        <div className="small muted">Barra clara: caixa projetado com os lançamentos oficiais. Barra laranja: incluindo os pedidos acima. Piso (reserva mínima + vinculada): {money(al.reserva)}.</div>
      </div>

      <div className="card">
        <h2>Decididos nos últimos 14 dias</h2>
        {!c.decididas.length && <p className="muted small">Nenhuma decisão recente.</p>}
        {c.decididas.slice(0, 20).map(({ lancamento: l, status: s, decididoEm, motivo }) => (
          <div key={l.id} className="df-prev">
            <div><b>{l.descricao}</b> <span className="muted small">{l.id} · pedido de {l.criadoPor}</span><div className="small muted">{money(l.valorBruto)} · {br(l.vencimento)} · decidido em {new Date(decididoEm).toLocaleDateString('pt-BR')}{motivo ? ` · ${motivo}` : ''}</div></div>
            <Badge tone={TOM_STATUS[s]}>{ROTULO_STATUS_DF[s]}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiretorFinanceiro({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const veCaixa = pode(usuario, 'ver_bancos');
  const diretoria = veCaixa && pode(usuario, 'aprovar');
  const [aba, setAba] = useState<'central' | 'conversa'>(diretoria && aba0 !== 'conversa' && aba0 !== 'nova' ? 'central' : 'conversa');
  const pendentes = ds.lancamentos.filter((l) => l.origem === 'diretor-financeiro' && l.status === 'Rascunho' && !l.excluidoEm).length;
  if (!diretoria) return (
    <>
      <PageHead title={`${NOME_DF} virtual`} subtitle="Peça um pagamento, informe quanto, para quando e para quem. O Diretor confere com a Diretoria e te avisa a decisão." />
      <div className="df-equipe"><div className="card df-card-chat"><ConversaDF key={usuario.id} veCaixa={veCaixa} nova={aba0 === 'nova'} /></div><MeusPedidosDF /></div>
    </>
  );
  return (
    <>
      <PageHead title={`${NOME_DF} virtual · Central`} subtitle="O Diretor escuta a equipe, analisa cada pedido contra o caixa e a reserva e traz aqui a orientação. Você decide; nada é pago sem isso." />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'central', label: `Central (${pendentes})` }, { id: 'conversa', label: 'Conversar com o Diretor' }]} />
      {aba === 'central' ? <CentralDF /> : <div className="card df-card-chat"><ConversaDF key={usuario.id} veCaixa nova={aba0 === 'nova'} /></div>}
    </>
  );
}
