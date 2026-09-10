// Bloco ENTREGA da comunicacao aprovada (Channel Provider 01): mostra provider, saude do canal e entregabilidade.
// Nao envia nada: o botao de envio aparece desativado ate o piloto. O diagnostico do Octadesk vem de /api/channel/octadesk
// (server-side, read-only); o provider Manual e avaliado localmente, sem rede.
import React, { useState } from 'react';
import { NOME_PROVIDER, PROVIDERS_ENTREGA, avaliarEntregabilidade, type CodigoProvider, type Entregabilidade, type EstadoConexao, type RemetenteCanal, type SaudeProvider, type TemplateCanal } from '../../core/radar/canais';
import type { ComunicacaoRadar } from '../../core/radar/types';
import { useStore } from '../../data/store';
import { tokenSessao } from '../../data/supabase';
import { Badge } from '../../ui/components';

const TOM_CONEXAO: Record<EstadoConexao, 'ok' | 'muted' | 'bad'> = { CONNECTED: 'ok', NOT_CONFIGURED: 'muted', ERROR: 'bad' };
const ROTULO_CONEXAO: Record<EstadoConexao, string> = { CONNECTED: 'Conectado', NOT_CONFIGURED: 'Não configurado', ERROR: 'Erro' };
interface Diagnostico { saude: SaudeProvider; remetentes: RemetenteCanal[]; templates: TemplateCanal[]; entregabilidade?: Entregabilidade; variaveisFaltando?: string[]; telefoneMascarado?: string; aviso?: string }
interface OpcoesEnvio { modoEnvio: 'disabled' | 'canary' | 'pilot'; destinoAutorizado: boolean; destinoMotivo: string; coerenciaCanal: { ok: boolean; motivo: string }; entregabilidade?: Entregabilidade; remetentes: RemetenteCanal[]; templatesAprovados: TemplateCanal[]; telefoneMascarado?: string }
interface EntregaResp { id: string; status: string; modo?: string; conversaProviderId?: string; mensagemProviderId?: string; statusProvider?: string; erroCodigo?: string; jaProcessada?: boolean }
const ROTULO_ENTREGA: Record<string, string> = { READY: 'preparada', REQUESTED: 'solicitada', ACCEPTED: 'aceita pelo provider', DELIVERED: 'entregue', FAILED: 'recusada', UNKNOWN: 'resultado desconhecido' };

export function Entrega({ c }: { c: ComunicacaoRadar }) {
  const { ds, modo } = useStore();
  const [provider, setProvider] = useState<CodigoProvider>('OCTADESK');
  const [d, setD] = useState<Diagnostico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [envio, setEnvio] = useState<OpcoesEnvio | null>(null);
  const [entrega, setEntrega] = useState<EntregaResp | null>(null);
  const [reconc, setReconc] = useState<{ resultado: string; motivo: string } | null>(null);
  const [remetenteSel, setRemetenteSel] = useState('');
  const [templateSel, setTemplateSel] = useState('');
  const contato = ds.radar.contatos.find((x) => x.id === c.contatoId);
  const suprimido = ds.radar.supressoes?.some((s) => s.contatoId === c.contatoId) ?? false;

  const manual = contato ? avaliarEntregabilidade(c, { ...contato, suprimido }, { provider: 'MANUAL', saude: { estado: 'CONNECTED' }, remetentes: [], templates: [] }) : undefined;
  const atual = provider === 'MANUAL' ? manual : d?.entregabilidade;
  const saude: SaudeProvider = provider === 'MANUAL' ? { estado: 'CONNECTED', detalhe: 'Envio pelo próprio usuário, por fora do sistema.' } : d?.saude ?? { estado: 'NOT_CONFIGURED', detalhe: 'Ainda não verificado.' };

  const chamar = async (corpo: Record<string, unknown>) => {
    const token = await tokenSessao();
    if (!token) throw new Error('Sessão não encontrada: o canal só funciona em produção, com login.');
    const resp = await fetch('/api/channel/octadesk', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = (await resp.json().catch(() => ({}))) as Record<string, unknown> & { erro?: string; mensagem?: string };
    if (!resp.ok) throw new Error(`${j.mensagem ?? j.erro ?? `HTTP ${resp.status}`}`);
    return j;
  };
  const preparar = async () => {
    setOcupado(true); setErro(null);
    try { const j = await chamar({ acao: 'preparar_envio', comunicacaoId: c.id }); const o = j.envio as OpcoesEnvio; setEnvio(o); setRemetenteSel(o.remetentes[0]?.id ?? ''); setTemplateSel(o.templatesAprovados[0]?.id ?? ''); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  const enviarCanary = async () => {
    if (!window.confirm('Enviar de verdade pelo WhatsApp Oficial para o número autorizado do canário?')) return;
    setOcupado(true); setErro(null);
    try {
      const j = await chamar({ acao: 'enviar_canary', comunicacaoId: c.id, ...(remetenteSel ? { senderId: remetenteSel } : {}), ...(templateSel ? { templateId: templateSel } : {}) });
      setEntrega(j.entrega as EntregaResp); setReconc(null);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  const reconciliar = async () => {
    if (!entrega) return;
    setOcupado(true); setErro(null);
    try { const j = await chamar({ acao: 'reconciliar', deliveryId: entrega.id }); setReconc(j.reconciliacao as { resultado: string; motivo: string }); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  const verificar = async () => {
    setOcupado(true); setErro(null);
    try {
      const token = await tokenSessao();
      if (!token) throw new Error('Sessão não encontrada: a verificação do canal só funciona em produção, com login.');
      const resp = await fetch('/api/channel/octadesk', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: 'verificar', comunicacaoId: c.id }) });
      const j = (await resp.json().catch(() => ({}))) as Diagnostico & { erro?: string; mensagem?: string };
      if (!resp.ok) throw new Error(j.mensagem ?? j.erro ?? `HTTP ${resp.status}`);
      setD(j);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };

  return (
    <div className="card" style={{ marginTop: 8, background: 'var(--surface-2)' }}>
      <div className="row small" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>ENTREGA</b>
        <select className="input" style={{ width: 'auto' }} value={provider} onChange={(e) => { setProvider(e.target.value as CodigoProvider); setErro(null); }}>
          {PROVIDERS_ENTREGA.map((p) => <option key={p} value={p}>{NOME_PROVIDER[p]}</option>)}
        </select>
        <span className="muted">Canal: {c.canal}</span>
        <Badge tone={TOM_CONEXAO[saude.estado]}>{provider === 'MANUAL' ? 'Manual' : `Octadesk: ${ROTULO_CONEXAO[saude.estado]}`}</Badge>
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        <b>Entregabilidade:</b>{' '}
        {atual ? <>{atual.motivo} <span className="muted">({atual.resultado}{atual.modo ? ` · ${atual.modo}` : ''})</span></> : <span className="muted">verifique o canal para saber</span>}
      </div>
      {provider === 'OCTADESK' && d && (
        <div className="small muted" style={{ marginTop: 4 }}>
          Números oficiais: {d.remetentes.length ? d.remetentes.map((r) => `${r.nome ?? r.id}${r.numero ? ` (${r.numero})` : ''}`).join(', ') : 'nenhum'} · Templates aprovados: {d.templates.filter((t) => t.status === 'approved' && t.ativo).length}
          {d.templates.length > 0 && <> — {d.templates.slice(0, 4).map((t) => `${t.nome} [${t.status}${t.categoria ? `/${t.categoria}` : ''}${t.idioma ? `/${t.idioma}` : ''}]`).join(', ')}</>}
          {d.telefoneMascarado && <> · WhatsApp do contato: {d.telefoneMascarado}</>}
          {d.aviso && <> · <span style={{ color: 'var(--warn)' }}>{d.aviso}</span></>}
        </div>
      )}
      {provider === 'OCTADESK' && d?.variaveisFaltando?.length ? <div className="small" style={{ marginTop: 4, color: 'var(--warn)' }}>Falta configurar no Netlify: {d.variaveisFaltando.join(', ')}.</div> : null}
      {erro && <div className="small" style={{ marginTop: 4, color: 'var(--bad)' }}>{erro}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {provider === 'OCTADESK' && <button className="btn sm" disabled={ocupado || modo !== 'remoto'} onClick={() => void verificar()}>{ocupado ? 'Verificando…' : 'Verificar Octadesk'}</button>}
        {provider === 'OCTADESK' && <button className="btn sm" disabled={ocupado || modo !== 'remoto'} onClick={() => void preparar()}>Preparar envio</button>}
        {provider !== 'OCTADESK' && <span className="small muted">Provider manual: copie o texto aprovado e envie você mesmo.</span>}
      </div>
      {envio && (
        <div className="df-card" style={{ marginTop: 8 }}>
          <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Envio</b>
            <Badge tone={envio.modoEnvio === 'canary' ? 'warn' : 'muted'}>modo {envio.modoEnvio}</Badge>
            <Badge tone={envio.destinoAutorizado ? 'ok' : 'bad'}>{envio.destinoAutorizado ? 'destino autorizado' : envio.destinoMotivo}</Badge>
            {!envio.coerenciaCanal.ok && <Badge tone="bad">{envio.coerenciaCanal.motivo}</Badge>}
          </div>
          {envio.remetentes.length > 1 && <div className="small" style={{ marginTop: 6 }}>Número: <select value={remetenteSel} onChange={(e) => setRemetenteSel(e.target.value)}>{envio.remetentes.map((r) => <option key={r.id} value={r.id}>{r.nome ?? r.id}{r.numero ? ` (${r.numero})` : ''}</option>)}</select></div>}
          {envio.entregabilidade?.modo === 'TEMPLATE' && <div className="small" style={{ marginTop: 6 }}>Template aprovado: {envio.templatesAprovados.length ? <select value={templateSel} onChange={(e) => setTemplateSel(e.target.value)}>{envio.templatesAprovados.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.idioma ? ` · ${t.idioma}` : ''}{t.variaveis.length ? ` · ${t.variaveis.length} variável(is)` : ''}</option>)}</select> : <span className="muted">nenhum</span>}</div>}
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {envio.modoEnvio === 'canary' && envio.destinoAutorizado && envio.entregabilidade?.apto && envio.coerenciaCanal.ok
              ? <button className="btn sm primary" disabled={ocupado} onClick={() => void enviarCanary()}>Enviar (canário)</button>
              : <button className="btn sm" disabled title={envio.modoEnvio !== 'canary' ? 'OCTADESK_SEND_MODE não está em canary' : !envio.destinoAutorizado ? envio.destinoMotivo : envio.entregabilidade?.motivo}>ENVIO BLOQUEADO — {envio.modoEnvio === 'canary' ? 'canário' : envio.modoEnvio}</button>}
            <span className="small muted">Canário: só números autorizados no servidor. A comunicação não é marcada como enviada nesta fase.</span>
          </div>
        </div>
      )}
      {entrega && (
        <div className="df-card" style={{ marginTop: 8 }}>
          <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Entrega {entrega.id.slice(0, 8)}</b>
            <Badge tone={entrega.status === 'ACCEPTED' || entrega.status === 'DELIVERED' ? 'ok' : entrega.status === 'FAILED' ? 'bad' : entrega.status === 'UNKNOWN' ? 'warn' : 'info'}>{ROTULO_ENTREGA[entrega.status] ?? entrega.status}</Badge>
            {entrega.jaProcessada && <span className="muted">já processada; nenhum novo envio</span>}
          </div>
          {(entrega.conversaProviderId || entrega.mensagemProviderId) && <div className="small muted" style={{ marginTop: 4 }}>conversa {entrega.conversaProviderId ?? '—'} · mensagem {entrega.mensagemProviderId ?? '—'}{entrega.statusProvider ? ` · ${entrega.statusProvider}` : ''}</div>}
          {entrega.erroCodigo && <div className="small" style={{ marginTop: 4, color: 'var(--bad)' }}>código do provider: {entrega.erroCodigo}</div>}
          {entrega.status === 'UNKNOWN' && (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn sm" disabled={ocupado} onClick={() => void reconciliar()}>Reconciliar entrega</button>
              <span className="small muted">Resultado desconhecido: nunca reenviar sem reconciliar.</span>
            </div>
          )}
          {reconc && <div className="small" style={{ marginTop: 6 }}><b>{reconc.resultado}</b> · {reconc.motivo}{reconc.resultado === 'AMBIGUOUS' ? ' — decisão sua.' : reconc.resultado === 'NOT_FOUND' ? ' — nada foi enviado; o reenvio continua sendo decisão sua.' : ''}</div>}
        </div>
      )}
    </div>
  );
}
