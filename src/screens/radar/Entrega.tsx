// Bloco ENTREGA da comunicacao aprovada (Channel Provider 01): mostra provider, saude do canal e entregabilidade.
// Nao envia nada: o botao de envio aparece desativado ate o piloto. O diagnostico do Octadesk vem de /api/channel/octadesk
// (server-side, read-only); o provider Manual e avaliado localmente, sem rede.
import React, { useState } from 'react';
import { NOME_PROVIDER, PROVIDERS, avaliarEntregabilidade, type CodigoProvider, type Entregabilidade, type EstadoConexao, type RemetenteCanal, type SaudeProvider, type TemplateCanal } from '../../core/radar/canais';
import type { ComunicacaoRadar } from '../../core/radar/types';
import { useStore } from '../../data/store';
import { tokenSessao } from '../../data/supabase';
import { Badge } from '../../ui/components';

const TOM_CONEXAO: Record<EstadoConexao, 'ok' | 'muted' | 'bad'> = { CONNECTED: 'ok', NOT_CONFIGURED: 'muted', ERROR: 'bad' };
const ROTULO_CONEXAO: Record<EstadoConexao, string> = { CONNECTED: 'Conectado', NOT_CONFIGURED: 'Não configurado', ERROR: 'Erro' };
interface Diagnostico { saude: SaudeProvider; remetentes: RemetenteCanal[]; templates: TemplateCanal[]; entregabilidade?: Entregabilidade; variaveisFaltando?: string[]; telefoneMascarado?: string; aviso?: string }

export function Entrega({ c }: { c: ComunicacaoRadar }) {
  const { ds, modo } = useStore();
  const [provider, setProvider] = useState<CodigoProvider>('OCTADESK');
  const [d, setD] = useState<Diagnostico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const contato = ds.radar.contatos.find((x) => x.id === c.contatoId);
  const suprimido = ds.radar.supressoes?.some((s) => s.contatoId === c.contatoId) ?? false;

  const manual = contato ? avaliarEntregabilidade(c, { ...contato, suprimido }, { provider: 'MANUAL', saude: { estado: 'CONNECTED' }, remetentes: [], templates: [] }) : undefined;
  const atual = provider === 'MANUAL' ? manual : d?.entregabilidade;
  const saude: SaudeProvider = provider === 'MANUAL' ? { estado: 'CONNECTED', detalhe: 'Envio pelo próprio usuário, por fora do sistema.' } : d?.saude ?? { estado: 'NOT_CONFIGURED', detalhe: 'Ainda não verificado.' };

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
          {PROVIDERS.map((p) => <option key={p} value={p}>{NOME_PROVIDER[p]}</option>)}
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
        <button className="btn sm" disabled title="Channel Provider 01: infraestrutura pronta, envio desligado até fechar a reconciliação de idempotência">ENVIO DESATIVADO — PILOTO</button>
        <span className="small muted">Nenhuma mensagem é enviada por aqui nesta fase.</span>
      </div>
    </div>
  );
}
