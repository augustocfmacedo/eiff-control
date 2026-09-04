import React, { useEffect, useRef, useState } from 'react';
import { buscarLocal, sugestoesPara, type MensagemChat } from '../core/assistente';
import { licao } from '../core/capacitacao';
import { tokenSessao } from '../data/supabase';
import { useStore } from '../data/store';
import { Badge } from './components';
import { Icon } from './icons';

const TITULOS: Record<string, string> = { '/': 'Painel executivo', '/inbox': 'Caixa de entrada', '/capacitacao': 'Capacitação', '/central': 'Central de obras', '/obras': 'Obras e contratos', '/orcamentos': 'Orçamentos', '/producao': 'Fábrica e montagem', '/estoque': 'Estoque de aço', '/equipe': 'Equipe', '/campo': 'Modo campo', '/compras': 'Compras', '/pagar': 'Contas a pagar', '/receber': 'Contas a receber', '/lancamentos': 'Lançamentos', '/aprovacoes': 'Aprovações', '/posicao': 'Posição diária', '/fluxo13': 'Fluxo 13 semanas', '/fluxo24': 'Fluxo 24 meses', '/conciliacao': 'Bancos e conciliação', '/dividas': 'Dívidas', '/dre': 'DRE', '/checks': 'Checks e fechamento', '/cadastros': 'Cadastros', '/auditoria': 'Auditoria' };

/** Converte a resposta em elementos: **negrito**, [#/rota] -> link da tela, [[licao]] -> link da licao, listas e quebras. */
function Texto({ t }: { t: string }) {
  const linhas = t.split('\n');
  const inline = (s: string, k: number) => {
    const partes = s.split(/(\*\*[^*]+\*\*|\[\[[a-z0-9-]+\]\]|\[#?\/[a-zA-Z0-9/_-]*\])/g);
    return <React.Fragment key={k}>{partes.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
      const l = /^\[\[([a-z0-9-]+)\]\]$/.exec(p);
      if (l) { const lc = licao(l[1]); return lc ? <a key={i} href={`#/capacitacao/${lc.id}`} className="chat-link">lição: {lc.titulo}</a> : <span key={i}>{p}</span>; }
      const r = /^\[#?(\/[a-zA-Z0-9/_-]*)\]$/.exec(p);
      if (r) { const base = '/' + r[1].split('/')[1]; return <a key={i} href={`#${r[1]}`} className="chat-link">{TITULOS[base] ?? r[1]}</a>; }
      return <span key={i}>{p}</span>;
    })}</React.Fragment>;
  };
  const out: React.ReactNode[] = [];
  let lista: string[] = [];
  const fecha = () => { if (lista.length) { out.push(<ul key={`u${out.length}`}>{lista.map((x, i) => <li key={i}>{inline(x, i)}</li>)}</ul>); lista = []; } };
  linhas.forEach((ln, i) => {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(ln);
    if (m) { lista.push(m[1]); return; }
    fecha();
    if (ln.trim()) out.push(<p key={i}>{inline(ln, i)}</p>);
  });
  fecha();
  return <>{out}</>;
}

export function Assistente({ tela }: { tela: string }) {
  const { ds, usuario, modo } = useStore();
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState<MensagemChat[]>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ia, setIa] = useState<'desconhecido' | 'ok' | 'indisponivel'>(modo === 'remoto' ? 'desconhecido' : 'indisponivel');
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [msgs, aberto]);

  const responderLocal = (q: string, nota?: string): MensagemChat => { const r = buscarLocal(q, usuario.papel); return { papel: 'assistente', texto: (nota ? `${nota}\n\n` : '') + r.texto, licoes: r.licoes.map((l) => l.id), origem: 'local' }; };

  const enviar = async (q0?: string) => {
    const q = (q0 ?? texto).trim();
    if (!q || ocupado) return;
    setTexto('');
    const hist: MensagemChat[] = [...msgs, { papel: 'usuario', texto: q }];
    setMsgs(hist);
    setOcupado(true);
    try {
      if (ia !== 'indisponivel') {
        const token = await tokenSessao();
        const pend = ds.aprovacoes.filter((a) => a.status === 'Pendente').length;
        const resumo = `${ds.obras.length} obra(s); ${pend} aprovação(ões) pendente(s); ${ds.tarefas.filter((t) => t.status === 'Aberta' && t.responsavel === usuario.id).length} tarefa(s) aberta(s) do usuário.`;
        const r = await fetch('/api/assistente', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ mensagens: hist.slice(-12).map((m) => ({ papel: m.papel, texto: m.texto })), contexto: { papel: usuario.papel, nome: usuario.nome, tela: TITULOS['/' + tela.split('/')[1]] ?? tela, dataBase: ds.params.dataBase, resumo } }) });
        if (r.ok) { const d = (await r.json()) as { texto: string }; setIa('ok'); setMsgs([...hist, { papel: 'assistente', texto: d.texto || 'Sem resposta.', origem: 'ia' }]); return; }
        if (r.status === 501 || r.status === 404) { setIa('indisponivel'); setMsgs([...hist, responderLocal(q, 'O assistente com IA ainda não está configurado neste site; respondo pelo manual do sistema.')]); return; }
        if (r.status === 401) { setMsgs([...hist, responderLocal(q, 'Sua sessão não foi reconhecida pelo assistente; respondo pelo manual.')]); return; }
        setMsgs([...hist, responderLocal(q, 'O serviço de IA não respondeu agora; respondo pelo manual.')]);
        return;
      }
      setMsgs([...hist, responderLocal(q)]);
    } catch {
      setMsgs([...hist, responderLocal(q, 'Sem conexão com o serviço de IA; respondo pelo manual.')]);
    } finally { setOcupado(false); }
  };

  return (
    <>
      <button className={`chat-fab no-print ${aberto ? 'aberto' : ''}`} onClick={() => setAberto(!aberto)} title="Assistente do sistema" aria-label="Assistente do sistema"><Icon name={aberto ? 'recolher' : 'chat'} size={20} /></button>
      {aberto && (
        <div className="chat-panel no-print" role="dialog" aria-label="Assistente">
          <div className="chat-head">
            <div><b>Assistente EIFF</b><div className="small muted">Tira dúvidas sobre o que fazer e onde fazer</div></div>
            <span className="spacer" />
            <Badge tone={ia === 'ok' ? 'ok' : ia === 'indisponivel' ? 'muted' : 'info'}>{ia === 'ok' ? 'IA' : ia === 'indisponivel' ? 'manual local' : 'conectando'}</Badge>
            {!!msgs.length && <button className="btn sm" onClick={() => setMsgs([])}>Limpar</button>}
          </div>
          <div className="chat-msgs">
            {!msgs.length && (
              <div className="chat-vazio">
                <div className="small muted" style={{ marginBottom: 8 }}>Olá, {usuario.nome.split(' ')[0]}. Pergunte como fazer algo no sistema, o que uma regra significa ou o que fazer a seguir. Sugestões:</div>
                <div className="chat-sug">{sugestoesPara(usuario.papel).map((s) => <button key={s} className="btn sm" onClick={() => void enviar(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.papel}`}>
                <div className="chat-bolha"><Texto t={m.texto} />{m.origem === 'local' && !!m.licoes?.length && <div className="small muted" style={{ marginTop: 6 }}>Fonte: manual do sistema.</div>}</div>
              </div>
            ))}
            {ocupado && <div className="chat-msg assistente"><div className="chat-bolha muted">pensando…</div></div>}
            <div ref={fim} />
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: como lançar uma despesa da obra?" disabled={ocupado} />
            <button className="btn primary" type="submit" disabled={ocupado || !texto.trim()}>Enviar</button>
          </form>
        </div>
      )}
    </>
  );
}
