// Diretor Financeiro virtual: conversa para qualquer funcionario pedir orientacao e registrar previsoes de pagamento,
// e o alinhamento diario onde a Diretoria/Financeiro valida, reagenda ou recusa as previsoes vendo o caixa da semana.
// Toda analise e deterministica (src/core/cfo.ts); a IA (opcional) so interpreta o texto.
import React, { useEffect, useRef, useState } from 'react';
import { NOME_DF, alinhamentoDoDia, analisarPagamento, br, catalogoDe, completarPedido, fmt, interpretacaoDaIa, interpretarPedido, montarPrevisao, responderDF, type Parecer, type PedidoInterpretado } from '../core/cfo';
import { addDays } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { tokenSessao } from '../data/supabase';
import { Badge, Field, Input, Modal, PageHead, Select, Tabs, money, tentar, useToast } from '../ui/components';
import { Icon } from '../ui/icons';
import { registrarAcao } from '../data/telemetria';

interface Msg { papel: 'usuario' | 'assistente'; texto: string; pedido?: PedidoInterpretado; parecer?: Parecer; registrado?: string; sugestoes?: string[]; origem?: 'ia' | 'local' }
const CHAVE = 'eiff-control:df:conversa';

function Texto({ t }: { t: string }) {
  return <>{t.split('\n').map((ln, i) => { const li = /^\s*[-•]\s+(.*)$/.exec(ln); const partes = (li ? li[1] : ln).split(/(\*\*[^*]+\*\*|\[\/[a-z0-9/-]*\])/g).map((p, j) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={j}>{p.slice(2, -2)}</b> : /^\[\/[a-z0-9/-]*\]$/.test(p) ? <a key={j} href={`#${p.slice(1, -1)}`}>{p.slice(1, -1) === '/pagar' ? 'Contas a pagar' : p.slice(1, -1)}</a> : <span key={j}>{p}</span>)); return li ? <div key={i} className="df-item">• {partes}</div> : ln.trim() ? <p key={i}>{partes}</p> : null; })}</>;
}

/** Chat com o Diretor Financeiro. */
export function ConversaDF({ compacto }: { compacto?: boolean }) {
  const { ds, usuario, modo } = useStore();
  const { toast, el } = useToast();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { const v = sessionStorage.getItem(CHAVE); return v ? (JSON.parse(v) as Msg[]) : []; } catch { return []; } });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ia, setIa] = useState<'desconhecido' | 'ok' | 'indisponivel'>(modo === 'remoto' ? 'desconhecido' : 'indisponivel');
  const [ajuste, setAjuste] = useState<{ idx: number; valor: number; vencimento: string; categoria: string; codigoObra: string; contraparte: string; descricao: string } | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); try { sessionStorage.setItem(CHAVE, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } }, [msgs]);
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
      if (p) { setIa('ok'); return { ...p, valor: p.valor ?? local.valor, vencimento: p.vencimento ?? local.vencimento, categoria: p.categoria ?? local.categoria, codigoObra: p.codigoObra ?? local.codigoObra, contraparte: p.contraparte ?? local.contraparte, faltando: p.intencao === 'pagamento' ? ([...(!(p.valor ?? local.valor) ? ['valor'] : []), ...(!(p.vencimento ?? local.vencimento) ? ['vencimento'] : [])] as PedidoInterpretado['faltando']) : [] }; }
      return local;
    } catch { return local; }
  };

  const enviar = async (q0?: string) => {
    const q = (q0 ?? texto).trim(); if (!q || ocupado) return;
    setTexto(''); const hist: Msg[] = [...msgs, { papel: 'usuario', texto: q }]; setMsgs(hist); setOcupado(true); registrarAcao('df:pergunta');
    try {
      let pedido = await interpretar(q, msgs);
      const pendente = ultimoPedidoIncompleto();
      if (pendente && (pedido.intencao === 'pagamento' || pedido.intencao === 'outro') && (pedido.valor || pedido.vencimento)) pedido = completarPedido(pendente, pedido);
      const r = responderDF(ds, usuario, pedido);
      setMsgs([...hist, { papel: 'assistente', texto: r.texto, pedido: r.pedido, parecer: r.parecer, sugestoes: r.sugestoes, origem: pedido.origem }]);
    } finally { setOcupado(false); }
  };

  const registrar = (idx: number, data: string) => {
    const m = msgs[idx]; if (!m.pedido || !m.parecer) return;
    const prev = montarPrevisao(ds, m.pedido, m.parecer, data);
    tentar(() => { const l = actions.registrarPrevisaoDF(prev); setMsgs((ms) => ms.map((x, i) => (i === idx ? { ...x, registrado: l.id } : x)).concat({ papel: 'assistente', texto: `Previsão **${l.id}** registrada: ${fmt(l.valorBruto)} em ${br(l.vencimento)}, ${l.categoria}${l.codigoObra ? `, obra ${l.codigoObra}` : ''}, fornecedor ${l.contraparte}. Entra no alinhamento diário com a Diretoria; você acompanha em [/lancamentos/${l.id}].` })); registrarAcao('df:previsao'); }, toast);
  };
  const abrirAjuste = (idx: number) => { const m = msgs[idx]; if (!m.pedido || !m.parecer) return; const prev = montarPrevisao(ds, m.pedido, m.parecer, m.parecer.dataSugerida ?? m.parecer.vencimento); setAjuste({ idx, valor: prev.valor, vencimento: prev.vencimento, categoria: prev.categoria, codigoObra: prev.codigoObra ?? '', contraparte: prev.contraparte, descricao: prev.descricao }); };
  const confirmarAjuste = () => {
    if (!ajuste) return;
    const m = msgs[ajuste.idx]; if (!m.pedido) return;
    const pedido: PedidoInterpretado = { ...m.pedido, valor: ajuste.valor, vencimento: ajuste.vencimento, categoria: ajuste.categoria, codigoObra: ajuste.codigoObra || undefined, contraparte: ajuste.contraparte, descricao: ajuste.descricao, faltando: [] };
    const parecer = analisarPagamento(ds, { valor: pedido.valor!, vencimento: pedido.vencimento, codigoObra: pedido.codigoObra, categoria: pedido.categoria });
    const prev = montarPrevisao(ds, pedido, parecer, ajuste.vencimento);
    tentar(() => { const l = actions.registrarPrevisaoDF(prev); setMsgs((ms) => ms.map((x, i) => (i === ajuste.idx ? { ...x, registrado: l.id } : x)).concat({ papel: 'assistente', texto: `Previsão **${l.id}** registrada com os ajustes: ${fmt(l.valorBruto)} em ${br(l.vencimento)}, ${l.categoria}${l.codigoObra ? `, obra ${l.codigoObra}` : ''}, fornecedor ${l.contraparte}. ${parecer.decisao === 'liberar' ? 'Cabe no caixa.' : parecer.motivos[parecer.motivos.length - 1]} Entra no alinhamento diário.` })); setAjuste(null); registrarAcao('df:previsao'); }, toast);
  };
  const tom = (p: Parecer) => (p.decisao === 'liberar' ? 'ok' : p.decisao === 'reagendar' ? 'info' : p.decisao === 'atencao' ? 'warn' : 'bad') as 'ok' | 'info' | 'warn' | 'bad';

  return (
    <div className={`df ${compacto ? 'compacto' : ''}`}>
      <div className="df-msgs">
        {!msgs.length && <div className="df-vazio">
          <div className="df-avatar"><Icon name="chat" size={22} /></div>
          <div><b>Olá, {usuario.nome.split(' ')[0]}.</b> Sou o {NOME_DF} virtual. Me diga o que precisa pagar, quanto e para quando, que eu confiro o caixa, a reserva e a alçada e registro a previsão para o alinhamento diário.</div>
          <div className="chips" style={{ marginTop: 10 }}>{['Preciso pagar um frete de R$ 500 amanhã', 'Como está o caixa?', 'O que vence essa semana?', 'Quais previsões estão pendentes?'].map((s) => <button key={s} className="chip sm" onClick={() => void enviar(s)}>{s}</button>)}</div>
        </div>}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.papel}`}>
            <div className="chat-bolha">
              <Texto t={m.texto} />
              {m.parecer && !m.registrado && podeRegistrar && <div className="df-card">
                <div className="df-card-cab"><Badge tone={tom(m.parecer)}>{m.parecer.decisao === 'liberar' ? 'cabe no caixa' : m.parecer.decisao === 'reagendar' ? 'melhor reagendar' : m.parecer.decisao === 'atencao' ? 'consome a reserva' : 'não recomendado'}</Badge><span>{fmt(m.parecer.valor)} · {br(m.parecer.dataSugerida ?? m.parecer.vencimento)}</span></div>
                <div className="actions">
                  <button className="btn primary sm" onClick={() => registrar(i, m.parecer!.dataSugerida ?? m.parecer!.vencimento)}>Registrar previsão{m.parecer.dataSugerida ? ` para ${br(m.parecer.dataSugerida)}` : ''}</button>
                  {m.parecer.dataSugerida && <button className="btn sm" onClick={() => registrar(i, m.parecer!.vencimento)}>Manter {br(m.parecer.vencimento)} mesmo assim</button>}
                  <button className="btn sm" onClick={() => abrirAjuste(i)}>Ajustar detalhes</button>
                </div>
              </div>}
              {m.parecer && !podeRegistrar && <div className="small muted" style={{ marginTop: 6 }}>Seu perfil não registra previsões; peça a um gestor ou ao financeiro.</div>}
              {m.registrado && <div className="small muted" style={{ marginTop: 6 }}>Registrada como {m.registrado}.</div>}
              {m.sugestoes && <div className="chips" style={{ marginTop: 8 }}>{m.sugestoes.map((s) => <button key={s} className="chip sm" onClick={() => void enviar(s)}>{s}</button>)}</div>}
            </div>
          </div>
        ))}
        {ocupado && <div className="chat-msg assistente"><div className="chat-bolha muted">conferindo o caixa…</div></div>}
        <div ref={fim} />
      </div>
      <form className="df-input" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: preciso pagar um frete de R$ 500 amanhã para a Transportadora X" disabled={ocupado} />
        <button className="btn primary" type="submit" disabled={ocupado || !texto.trim()}>Enviar</button>
        <Badge tone={ia === 'ok' ? 'ok' : 'muted'} title="A IA só interpreta o texto; os números vêm do motor do sistema">{ia === 'ok' ? 'IA + motor' : 'motor'}</Badge>
        {!!msgs.length && <button type="button" className="btn sm" onClick={() => setMsgs([])}>Limpar</button>}
      </form>
      {ajuste && <Modal title="Ajustar a previsão" onClose={() => setAjuste(null)}>
        <div className="form">
          <Field label="Valor (R$)" req><Input type="number" step="0.01" min={0} value={ajuste.valor} onChange={(e) => setAjuste({ ...ajuste, valor: Number(e.target.value) })} /></Field>
          <Field label="Data do pagamento" req><Input type="date" value={ajuste.vencimento} onChange={(e) => setAjuste({ ...ajuste, vencimento: e.target.value })} /></Field>
          <Field label="Categoria" req><Select value={ajuste.categoria} onChange={(v) => setAjuste({ ...ajuste, categoria: v })} options={catalogo.categorias} /></Field>
          <Field label="Obra"><Select value={ajuste.codigoObra} onChange={(v) => setAjuste({ ...ajuste, codigoObra: v })} allowEmpty="— sem obra —" options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} /></Field>
          <Field label="Fornecedor" req><Input value={ajuste.contraparte} onChange={(e) => setAjuste({ ...ajuste, contraparte: e.target.value })} /></Field>
          <Field label="Descrição" req full><Input value={ajuste.descricao} onChange={(e) => setAjuste({ ...ajuste, descricao: e.target.value })} /></Field>
        </div>
        <div className="foot"><button className="btn" onClick={() => setAjuste(null)}>Cancelar</button><button className="btn primary" onClick={confirmarAjuste}>Registrar previsão</button></div>
      </Modal>}
      {el}
    </div>
  );
}

/** Alinhamento diario: previsoes aguardando decisao e o caixa da semana com e sem elas. */
export function AlinhamentoDF() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const al = alinhamentoDoDia(ds);
  const [reag, setReag] = useState<{ id: string; data: string } | null>(null);
  const [recusa, setRecusa] = useState<{ id: string; motivo: string } | null>(null);
  const podeDecidir = pode(usuario, 'aprovar');
  const max = Math.max(1, ...al.dias.map((d) => Math.abs(d.saldo)), ...al.dias.map((d) => Math.abs(d.saldoComPrevisoes)), al.reserva);
  return (
    <div>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="label">Caixa hoje</div><div className="value">{money(al.saldoHoje)}</div><div className="hint">reserva {money(al.reserva)}</div></div>
        <div className="kpi"><div className="label">Previsões aguardando</div><div className="value">{al.previsoes.length}</div><div className="hint">{money(al.totalPrevisoes)}</div></div>
        <div className="kpi"><div className="label">Vence hoje</div><div className="value">{al.venceHoje.length}</div><div className="hint">{money(al.venceHoje.reduce((s, l) => s + l.saldoAberto, 0))}</div></div>
        <div className="kpi"><div className="label">Menor saldo da semana</div><div className="value">{money(Math.min(...al.dias.map((d) => d.saldoComPrevisoes)))}</div><div className="hint">com as previsões</div></div>
      </div>
      {al.alertas.map((a) => <div key={a} className="alert warn">{a}</div>)}
      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Caixa dos próximos 7 dias</h2>
        <div className="df-dias">{al.dias.map((d) => <div key={d.data} className={`df-dia ${d.abaixoReserva ? 'furo' : ''}`} title={`${br(d.data)}: entradas ${money(d.entradas)}, saídas ${money(d.saidas)}, previsões ${money(d.previsoes)}`}>
          <div className="barras"><i className="sem" style={{ height: `${Math.max(2, (Math.max(0, d.saldo) / max) * 100)}%` }} /><i className="com" style={{ height: `${Math.max(2, (Math.max(0, d.saldoComPrevisoes) / max) * 100)}%` }} /></div>
          <b>{br(d.data)}</b><span>{money(d.saldoComPrevisoes)}</span>{d.previsoes > 0 && <span className="muted">−{money(d.previsoes)}</span>}
        </div>)}</div>
        <div className="small muted">Barra clara: caixa projetado com os lançamentos oficiais. Barra laranja: incluindo as previsões abaixo. Linha de reserva: {money(al.reserva)}.</div>
      </div>
      <div className="card">
        <h2>Previsões para decidir</h2>
        {!al.previsoes.length && <p className="muted small">Nenhuma previsão aguardando. Os pedidos feitos ao Diretor Financeiro aparecem aqui.</p>}
        {al.previsoes.map(({ lancamento: l, parecerAtual: p, solicitante, diasEsperando }) => (
          <div key={l.id} className="df-prev">
            <div>
              <b>{l.descricao}</b> <span className="muted small">{l.id} · {l.categoria}{l.codigoObra ? ` · ${l.codigoObra}` : ''} · {l.contraparte}</span>
              <div className="small muted">Pedido de {solicitante}{diasEsperando ? ` há ${diasEsperando} dia(s)` : ' hoje'} · {money(l.valorLiquidoPrevisto)} em {br(l.vencimento)} · <Badge tone={p.decisao === 'liberar' ? 'ok' : p.decisao === 'reagendar' ? 'info' : p.decisao === 'atencao' ? 'warn' : 'bad'}>{p.decisao === 'liberar' ? 'cabe' : p.decisao === 'reagendar' ? `melhor em ${br(p.dataSugerida)}` : p.decisao === 'atencao' ? 'consome a reserva' : 'não cabe'}</Badge>{p.precisaAprovacao && <> · alçada {p.alcada.join(' → ')}</>}</div>
              <div className="small muted">Saldo na data {money(p.saldoNaData)} → {money(p.saldoDepois)}; menor saldo em 30 dias {money(p.menorSaldoDepois)} ({br(p.menorSaldoDia)}).</div>
            </div>
            {podeDecidir && <div className="actions">
              <button className="btn primary sm" onClick={() => tentar(() => actions.decidirPrevisaoDF(l.id, 'programar'), toast, () => toast(`${l.id} programado${p.precisaAprovacao ? ' e enviado à alçada' : ''}.`))}>Programar</button>
              <button className="btn sm" onClick={() => setReag({ id: l.id, data: p.dataSugerida ?? addDays(l.vencimento, 1) })}>Reagendar</button>
              <button className="btn sm danger" onClick={() => setRecusa({ id: l.id, motivo: '' })}>Recusar</button>
            </div>}
          </div>
        ))}
      </div>
      {reag && <Modal title={`Reagendar ${reag.id}`} onClose={() => setReag(null)}><Field label="Nova data" req><Input type="date" value={reag.data} onChange={(e) => setReag({ ...reag, data: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setReag(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.decidirPrevisaoDF(reag.id, 'reagendar', { vencimento: reag.data }), toast, () => { setReag(null); toast('Previsão reagendada.'); })}>Reagendar</button></div></Modal>}
      {recusa && <Modal title={`Recusar ${recusa.id}`} onClose={() => setRecusa(null)}><Field label="Motivo" req full><Input autoFocus value={recusa.motivo} onChange={(e) => setRecusa({ ...recusa, motivo: e.target.value })} /></Field><div className="foot"><button className="btn" onClick={() => setRecusa(null)}>Cancelar</button><button className="btn danger" onClick={() => tentar(() => actions.decidirPrevisaoDF(recusa.id, 'recusar', { motivo: recusa.motivo }), toast, () => { setRecusa(null); toast('Previsão recusada.'); })}>Recusar</button></div></Modal>}
      {el}
    </div>
  );
}

export default function DiretorFinanceiro({ aba0 }: { aba0?: string }) {
  const { usuario } = useStore();
  const podeDecidir = pode(usuario, 'aprovar');
  const [aba, setAba] = useState<'conversa' | 'alinhamento'>(aba0 === 'alinhamento' && podeDecidir ? 'alinhamento' : 'conversa');
  return (
    <>
      <PageHead title={`${NOME_DF} virtual`} subtitle="Pergunte se um pagamento cabe, quando pagar e registre a previsão. A Diretoria valida no alinhamento diário para o caixa nunca ficar negativo." />
      {podeDecidir && <Tabs value={aba} onChange={setAba} items={[{ id: 'conversa', label: 'Conversar' }, { id: 'alinhamento', label: 'Alinhamento do dia' }]} />}
      {aba === 'conversa' ? <div className="card df-card-chat"><ConversaDF /></div> : <AlinhamentoDF />}
    </>
  );
}
