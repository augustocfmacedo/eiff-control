// Diretor Financeiro virtual. Para a EQUIPE: conversa para pedir pagamentos e acompanhar o andamento, sem saldo, reserva
// ou parecer. Para a DIRETORIA (quem ve bancos e aprova): a Central, onde o DF entrega cada pedido ja orientado (data,
// impacto no caixa, alcada), o briefing do dia, a agenda da semana e o historico; e a conversa completa com numeros.
// Toda analise e deterministica (src/core/cfo.ts); a IA (opcional) so interpreta o texto.
import React, { useEffect, useRef, useState } from 'react';
import { NOME_DF, ROTULO_STATUS_DF, analisarPagamento, br, catalogoDe, centralDF, completarPedido, fmt, interpretacaoDaIa, interpretarPedido, meusPedidosDF, montarPrevisao, responderDF, statusPedidoDF, type Parecer, type PedidoInterpretado } from '../core/cfo';
import { addDays } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { tokenSessao } from '../data/supabase';
import { Badge, Field, Input, Modal, PageHead, Select, Tabs, money, tentar, useToast } from '../ui/components';
import { Icon } from '../ui/icons';
import { registrarAcao } from '../data/telemetria';

interface Msg { papel: 'usuario' | 'assistente'; texto: string; pedido?: PedidoInterpretado; parecer?: Parecer; registrado?: string; sugestoes?: string[]; origem?: 'ia' | 'local' }
const CHAVE = 'eiff-control:df:conversa';
const TOM_STATUS: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'muted'> = { aguardando: 'warn', programado: 'ok', em_aprovacao: 'info', reagendado: 'info', recusado: 'bad', pago: 'ok' };

function Texto({ t }: { t: string }) {
  return <>{t.split('\n').map((ln, i) => { const li = /^\s*[-•]\s+(.*)$/.exec(ln); const partes = (li ? li[1] : ln).split(/(\*\*[^*]+\*\*|\[\/[a-zA-Z0-9/-]*\])/g).map((p, j) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={j}>{p.slice(2, -2)}</b> : /^\[\/[a-zA-Z0-9/-]*\]$/.test(p) ? <a key={j} href={`#${p.slice(1, -1)}`}>{p.slice(1, -1) === '/pagar' ? 'Contas a pagar' : p.slice(1, -1)}</a> : <span key={j}>{p}</span>)); return li ? <div key={i} className="df-item">• {partes}</div> : ln.trim() ? <p key={i}>{partes}</p> : null; })}</>;
}

/** Chat com o Diretor Financeiro. veCaixa = Diretoria/Financeiro (respostas com numeros); equipe so pede e acompanha. */
export function ConversaDF({ veCaixa }: { veCaixa: boolean }) {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const chave = `${CHAVE}:${usuario.id}`; // conversa por usuario: num aparelho compartilhado ninguem ve o chat do outro
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { const v = sessionStorage.getItem(chave); return v ? (JSON.parse(v) as Msg[]) : []; } catch { return []; } });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ia, setIa] = useState<'desconhecido' | 'ok' | 'indisponivel'>(modo === 'remoto' ? 'desconhecido' : 'indisponivel');
  const [ajuste, setAjuste] = useState<{ idx: number; valor: number; vencimento: string; categoria: string; codigoObra: string; contraparte: string; descricao: string } | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); try { sessionStorage.setItem(chave, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } }, [msgs, chave]);
  const catalogo = catalogoDe(ds);
  const podeRegistrar = pode(usuario, 'editar_lancamento');
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

  const enviar = async (q0?: string) => {
    const q = (q0 ?? texto).trim(); if (!q || ocupado) return;
    setTexto(''); const hist: Msg[] = [...msgs, { papel: 'usuario', texto: q }]; setMsgs(hist); setOcupado(true); registrarAcao('df:pergunta');
    try {
      let pedido = /^meus pedidos$/i.test(q) ? { ...interpretarPedido(q, catalogo), intencao: 'previsoes' as const, faltando: [] } : await interpretar(q, msgs);
      const pendente = ultimoPedidoIncompleto();
      // complemento ("500 reais, sexta") junta-se ao pedido que ficou incompleto; um pedido novo e completo segue sozinho
      if (pendente && (pedido.intencao === 'pagamento' || pedido.intencao === 'outro') && (pedido.valor || pedido.vencimento) && (pedido.intencao === 'outro' || pedido.faltando.length > 0)) pedido = completarPedido(pendente, pedido);
      const r = responderDF(ds, usuario, pedido, veCaixa);
      setMsgs([...hist, { papel: 'assistente', texto: r.texto, pedido: r.pedido, parecer: r.parecer, sugestoes: r.sugestoes, origem: pedido.origem }]);
    } finally { setOcupado(false); }
  };

  const confirmacao = (id: string, valor: number, venc: string, cat: string, obra: string, forn: string) => veCaixa
    ? `Previsão **${id}** registrada: ${fmt(valor)} em ${br(venc)}, ${cat}${obra ? `, obra ${obra}` : ''}, fornecedor ${forn}. Entra na Central para decisão; acompanhe em [/lancamentos/${id}].`
    : `Pedido **${id}** encaminhado à Diretoria: ${fmt(valor)} para ${br(venc)}${forn !== 'A definir' ? `, ${forn}` : ''}. Te aviso quando for decidido; veja o andamento em "Meus pedidos".`;
  const registrar = (idx: number, data: string) => {
    const m = msgs[idx]; if (!m.pedido || !m.parecer) return;
    const prev = montarPrevisao(ds, m.pedido, m.parecer, data);
    tentar(() => { const l = actions.registrarPrevisaoDF(prev); setMsgs((ms) => ms.map((x, i) => (i === idx ? { ...x, registrado: l.id } : x)).concat({ papel: 'assistente', texto: confirmacao(l.id, l.valorBruto, l.vencimento, l.categoria, l.codigoObra, l.contraparte) })); registrarAcao('df:previsao'); }, toast);
  };
  const abrirAjuste = (idx: number) => { const m = msgs[idx]; if (!m.pedido || !m.parecer) return; const prev = montarPrevisao(ds, m.pedido, m.parecer, veCaixa ? m.parecer.dataSugerida ?? m.parecer.vencimento : m.parecer.vencimento); setAjuste({ idx, valor: prev.valor, vencimento: prev.vencimento, categoria: prev.categoria, codigoObra: prev.codigoObra ?? '', contraparte: prev.contraparte === 'A definir' ? '' : prev.contraparte, descricao: prev.descricao }); };
  const confirmarAjuste = () => {
    if (!ajuste) return;
    const m = msgs[ajuste.idx]; if (!m.pedido) return;
    const pedido: PedidoInterpretado = { ...m.pedido, valor: ajuste.valor, vencimento: ajuste.vencimento, categoria: ajuste.categoria, codigoObra: ajuste.codigoObra || undefined, contraparte: ajuste.contraparte || undefined, descricao: ajuste.descricao, faltando: [] };
    const parecer = analisarPagamento(ds, { valor: pedido.valor!, vencimento: pedido.vencimento, codigoObra: pedido.codigoObra, categoria: pedido.categoria });
    const prev = montarPrevisao(ds, pedido, parecer, ajuste.vencimento);
    tentar(() => { const l = actions.registrarPrevisaoDF(prev); setMsgs((ms) => ms.map((x, i) => (i === ajuste.idx ? { ...x, registrado: l.id } : x)).concat({ papel: 'assistente', texto: confirmacao(l.id, l.valorBruto, l.vencimento, l.categoria, l.codigoObra, l.contraparte) })); setAjuste(null); registrarAcao('df:previsao'); }, toast);
  };
  const tom = (p: Parecer) => (p.decisao === 'liberar' ? 'ok' : p.decisao === 'reagendar' ? 'info' : p.decisao === 'atencao' ? 'warn' : 'bad') as 'ok' | 'info' | 'warn' | 'bad';
  const sugestoesIniciais = veCaixa ? ['Preciso pagar um frete de R$ 500 amanhã', 'Como está o caixa?', 'O que vence essa semana?', 'Quais previsões estão pendentes?'] : ['Preciso pagar um frete de R$ 500 amanhã para a Transportadora X', 'Meus pedidos'];

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
              {m.parecer && !m.registrado && podeRegistrar && <div className="df-card">
                {veCaixa && <div className="df-card-cab"><Badge tone={tom(m.parecer)}>{m.parecer.decisao === 'liberar' ? 'cabe no caixa' : m.parecer.decisao === 'reagendar' ? 'melhor reagendar' : m.parecer.decisao === 'atencao' ? 'consome a reserva' : 'não recomendado'}</Badge><span>{fmt(m.parecer.valor)} · {br(m.parecer.dataSugerida ?? m.parecer.vencimento)}</span></div>}
                <div className="actions">
                  {veCaixa
                    ? <><button className="btn primary sm" onClick={() => registrar(i, m.parecer!.dataSugerida ?? m.parecer!.vencimento)}>Registrar previsão{m.parecer.dataSugerida ? ` para ${br(m.parecer.dataSugerida)}` : ''}</button>{m.parecer.dataSugerida && <button className="btn sm" onClick={() => registrar(i, m.parecer!.vencimento)}>Manter {br(m.parecer.vencimento)} mesmo assim</button>}</>
                    : <button className="btn primary sm" onClick={() => registrar(i, m.parecer!.vencimento)}>Confirmar e encaminhar à Diretoria</button>}
                  <button className="btn sm" onClick={() => abrirAjuste(i)}>Ajustar</button>
                </div>
              </div>}
              {m.parecer && !podeRegistrar && <div className="small muted" style={{ marginTop: 6 }}>Seu perfil não registra pedidos; peça a um gestor ou ao financeiro.</div>}
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
      {ajuste && <Modal title={veCaixa ? 'Ajustar a previsão' : 'Ajustar o pedido'} onClose={() => setAjuste(null)}>
        <div className="form">
          <Field label="Valor (R$)" req><Input type="number" step="0.01" min={0} value={ajuste.valor} onChange={(e) => setAjuste({ ...ajuste, valor: Number(e.target.value) })} /></Field>
          <Field label="Data do pagamento" req><Input type="date" value={ajuste.vencimento} onChange={(e) => setAjuste({ ...ajuste, vencimento: e.target.value })} /></Field>
          <Field label="Categoria" req><Select value={ajuste.categoria} onChange={(v) => setAjuste({ ...ajuste, categoria: v })} options={catalogo.categorias} /></Field>
          <Field label="Obra"><Select value={ajuste.codigoObra} onChange={(v) => setAjuste({ ...ajuste, codigoObra: v })} allowEmpty="— sem obra —" options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} /></Field>
          <Field label="Para quem (fornecedor)" hint="Ajuda a Diretoria a decidir"><Input value={ajuste.contraparte} onChange={(e) => setAjuste({ ...ajuste, contraparte: e.target.value })} /></Field>
          <Field label="Descrição" req full><Input value={ajuste.descricao} onChange={(e) => setAjuste({ ...ajuste, descricao: e.target.value })} /></Field>
        </div>
        <div className="foot"><button className="btn" onClick={() => setAjuste(null)}>Cancelar</button><button className="btn primary" onClick={confirmarAjuste}>{veCaixa ? 'Registrar previsão' : 'Encaminhar à Diretoria'}</button></div>
      </Modal>}
      {el}
    </div>
  );
}

/** Andamento dos pedidos do proprio usuario (equipe), sem dados de caixa. */
export function MeusPedidosDF() {
  const { ds, usuario } = useStore();
  const meus = meusPedidosDF(ds, usuario).slice(0, 20);
  return (
    <div className="card">
      <h2>Meus pedidos</h2>
      {!meus.length && <p className="muted small">Nenhum pedido ainda. Fale com o Diretor Financeiro ao lado.</p>}
      {meus.map((l) => { const s = statusPedidoDF(l); return (
        <div key={l.id} className="df-prev">
          <div><b>{l.descricao}</b> <span className="muted small">{l.id}{l.codigoObra ? ` · ${l.codigoObra}` : ''}{l.contraparte !== 'A definir' ? ` · ${l.contraparte}` : ''}</span><div className="small muted">{money(l.valorBruto)} · {br(l.vencimento)}{s === 'recusado' && l.motivoCancelamento ? ` · ${l.motivoCancelamento.replace(/^Recusada no alinhamento diário: /, '')}` : ''}</div></div>
          <Badge tone={TOM_STATUS[s]}>{ROTULO_STATUS_DF[s]}</Badge>
        </div>
      ); })}
    </div>
  );
}

/** Central da Diretoria: o DF entrega os pedidos ja orientados; um clique segue a recomendacao. */
export function CentralDF() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const c = centralDF(ds);
  const al = c.alinhamento;
  const [reag, setReag] = useState<{ id: string; data: string } | null>(null);
  const [recusa, setRecusa] = useState<{ id: string; motivo: string } | null>(null);
  const podeDecidir = pode(usuario, 'aprovar');
  const max = Math.max(1, ...al.dias.map((d) => Math.abs(d.saldo)), ...al.dias.map((d) => Math.abs(d.saldoComPrevisoes)), al.reserva);
  const seguir = (id: string, o: ReturnType<typeof centralDF>['orientacoes'] extends Map<string, infer V> ? V : never) => {
    if (o.acaoSugerida === 'programar') tentar(() => actions.decidirPrevisaoDF(id, 'programar'), toast, () => toast(`${id} programado.`));
    else if (o.acaoSugerida === 'reagendar' && o.dataSugerida) tentar(() => actions.decidirPrevisaoDF(id, 'reagendar', { vencimento: o.dataSugerida }), toast, () => toast(`${id} reagendado para ${br(o.dataSugerida)}.`));
    else if (o.acaoSugerida === 'recusar') setRecusa({ id, motivo: 'Caixa não comporta no período' });
  };
  return (
    <div>
      <div className="card df-briefing">
        <div className="df-avatar"><Icon name="chat" size={22} /></div>
        <div><b>Briefing do {NOME_DF} · {br(ds.params.dataBase)}</b><p>{c.briefing}</p></div>
      </div>
      <div className="grid cols-4" style={{ margin: '14px 0' }}>
        <div className="kpi"><div className="label">Pedidos para decidir</div><div className="value">{al.previsoes.length}</div><div className="hint">{money(al.totalPrevisoes)}</div></div>
        <div className="kpi"><div className="label">Caixa hoje · Posição diária</div><div className="value">{money(al.saldoHoje)}</div><div className="hint">{al.extrato.texto}{al.compromissosHoje ? ` · vencidos e hoje −${money(al.compromissosHoje)}` : ''} · piso {money(al.reserva)}</div></div>
        <div className="kpi"><div className="label">Menor saldo da semana</div><div className="value">{money(Math.min(...al.dias.map((d) => d.saldoComPrevisoes)))}</div><div className="hint">com os pedidos</div></div>
        <div className="kpi"><div className="label">Vence hoje</div><div className="value">{al.venceHoje.length}</div><div className="hint">{money(al.venceHoje.reduce((s, l) => s + l.saldoAberto, 0))}</div></div>
      </div>
      {al.alertas.map((a) => <div key={a} className="alert warn">{a}</div>)}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Pedidos da equipe · orientação do {NOME_DF}</h2>
        {!al.previsoes.length && <p className="muted small">Nenhum pedido aguardando. Quando alguém pedir um pagamento ao Diretor Financeiro, ele aparece aqui já analisado.</p>}
        {al.previsoes.map(({ lancamento: l, parecerAtual: p, solicitante, diasEsperando }) => { const o = c.orientacoes.get(l.id)!; return (
          <div key={l.id} className="df-pedido">
            <div className="df-pedido-cab">
              <div><b>{l.descricao}</b> <span className="muted small">{l.id} · {l.categoria}{l.codigoObra ? ` · ${l.codigoObra}` : ''} · {l.contraparte}</span><div className="small muted">Pedido de <b>{solicitante}</b>{diasEsperando ? ` há ${diasEsperando} dia(s)` : ' hoje'} · <b>{money(l.valorLiquidoPrevisto)}</b> para {br(l.vencimento)}{p.precisaAprovacao && <> · alçada {p.alcada.join(' → ')}</>}</div></div>
              <Badge tone={o.acaoSugerida === 'programar' ? 'ok' : o.acaoSugerida === 'reagendar' ? 'info' : o.acaoSugerida === 'avaliar' ? 'warn' : 'bad'}>{o.acaoSugerida === 'programar' ? 'programar' : o.acaoSugerida === 'reagendar' ? `reagendar → ${br(o.dataSugerida)}` : o.acaoSugerida === 'avaliar' ? 'seu aval' : 'não recomendado'}</Badge>
            </div>
            <div className="df-orientacao"><b>{o.titulo}.</b> {o.detalhe}</div>
            {podeDecidir && <div className="actions">
              {o.acaoSugerida !== 'avaliar' && <button className="btn primary sm" onClick={() => seguir(l.id, o)}>{o.acaoSugerida === 'programar' ? `Programar para ${br(l.vencimento)}` : o.acaoSugerida === 'reagendar' ? `Reagendar para ${br(o.dataSugerida)}` : 'Recusar'}</button>}
              {o.acaoSugerida !== 'programar' && <button className="btn sm" onClick={() => tentar(() => actions.decidirPrevisaoDF(l.id, 'programar'), toast, () => toast(`${l.id} programado${p.precisaAprovacao ? ' e enviado à alçada' : ''}.`))}>Programar mesmo assim</button>}
              <button className="btn sm" onClick={() => setReag({ id: l.id, data: o.dataSugerida ?? addDays(l.vencimento, 1) })}>Outra data</button>
              {o.acaoSugerida !== 'recusar' && <button className="btn sm danger" onClick={() => setRecusa({ id: l.id, motivo: '' })}>Recusar</button>}
            </div>}
          </div>
        ); })}
      </div>

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
      {reag && <Modal title={`Outra data para ${reag.id}`} onClose={() => setReag(null)}><Field label="Nova data" req><Input type="date" value={reag.data} onChange={(e) => setReag({ ...reag, data: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setReag(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.decidirPrevisaoDF(reag.id, 'reagendar', { vencimento: reag.data }), toast, () => { setReag(null); toast('Pedido reagendado; o solicitante vê a nova data em Meus pedidos.'); })}>Reagendar</button></div></Modal>}
      {recusa && <Modal title={`Recusar ${recusa.id}`} onClose={() => setRecusa(null)}><Field label="Motivo (o solicitante vê)" req full><Input autoFocus value={recusa.motivo} onChange={(e) => setRecusa({ ...recusa, motivo: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setRecusa(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.decidirPrevisaoDF(recusa.id, 'recusar', { motivo: recusa.motivo }), toast, () => { setRecusa(null); toast('Pedido recusado.'); })}>Recusar</button></div></Modal>}
      {el}
    </div>
  );
}

export default function DiretorFinanceiro({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const veCaixa = pode(usuario, 'ver_bancos');
  const diretoria = veCaixa && pode(usuario, 'aprovar');
  const [aba, setAba] = useState<'central' | 'conversa'>(diretoria && aba0 !== 'conversa' ? 'central' : 'conversa');
  const pendentes = ds.lancamentos.filter((l) => l.origem === 'diretor-financeiro' && l.status === 'Rascunho' && !l.excluidoEm).length;
  if (!diretoria) return (
    <>
      <PageHead title={`${NOME_DF} virtual`} subtitle="Peça um pagamento, informe quanto, para quando e para quem. O Diretor confere com a Diretoria e te avisa a decisão." />
      <div className="df-equipe"><div className="card df-card-chat"><ConversaDF veCaixa={veCaixa} /></div><MeusPedidosDF /></div>
    </>
  );
  return (
    <>
      <PageHead title={`${NOME_DF} virtual · Central`} subtitle="O Diretor escuta a equipe, analisa cada pedido contra o caixa e a reserva e traz aqui a orientação. Você decide; nada é pago sem isso." />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'central', label: `Central (${pendentes})` }, { id: 'conversa', label: 'Conversar com o Diretor' }]} />
      {aba === 'central' ? <CentralDF /> : <div className="card df-card-chat"><ConversaDF veCaixa /></div>}
    </>
  );
}
