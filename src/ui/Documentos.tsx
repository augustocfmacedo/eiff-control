// Documentos de um lançamento (0073): lista (nota fiscal, boleto, comprovante, outro) com Abrir e Remover, e o envio de um
// arquivo novo (PDF ou foto; no celular o seletor oferece a câmera). Usado no detalhe do lançamento, no "Meus pedidos" da
// equipe e nos pedidos da Central. Regras em src/core/anexos.ts; quem garante é o banco.
import { useRef, useState } from 'react';
import { ROTULO_ANEXO, TIPOS_ANEXO, anexosDe, pendenciasDocumentos, podeRemoverAnexo, podeVerAnexos, tamanhoLegivel, tiposQuePodeAnexar } from '../core/anexos';
import type { AnexoLancamento, Lancamento, TipoAnexo } from '../core/types';
import { actions, useStore } from '../data/store';
import { urlAnexo } from '../data/supabase';
import { Badge, dataHora } from './components';

const TOM: Record<TipoAnexo, 'ok' | 'info' | 'warn' | 'muted'> = { NOTA_FISCAL: 'info', BOLETO: 'warn', COMPROVANTE: 'ok', OUTRO: 'muted' };

/** Abre o documento numa aba nova. A aba é aberta já no clique (Safari bloqueia janela aberta depois de um await). */
async function abrir(a: AnexoLancamento, aviso: (m: string) => void) {
  const aba = window.open('', '_blank');
  try {
    let url: string | null = null;
    if (a.caminho) url = await urlAnexo(a.caminho);
    else if (a.dataUrl) url = URL.createObjectURL(await (await fetch(a.dataUrl)).blob());
    if (!url) throw new Error('Documento indisponível.');
    if (aba) aba.location.href = url; else window.location.href = url;
  } catch (e) { aba?.close(); aviso((e as Error).message); }
}

export function DocumentosLancamento({ lancamento: l, aviso, compacto = false, tipoInicial }: { lancamento: Lancamento; aviso: (m: string) => void; compacto?: boolean; tipoInicial?: TipoAnexo }) {
  const { ds, usuario } = useStore();
  const tipos = tiposQuePodeAnexar(usuario, l);
  const [tipo, setTipo] = useState<TipoAnexo>(tipoInicial && tipos.includes(tipoInicial) ? tipoInicial : tipos.includes('NOTA_FISCAL') ? 'NOTA_FISCAL' : tipos[0] ?? 'OUTRO');
  const [enviando, setEnviando] = useState(false);
  const [removendo, setRemovendo] = useState<{ id: string; motivo: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!podeVerAnexos(usuario, l)) return null;
  const docs = anexosDe(ds, l.id);
  const pend = pendenciasDocumentos(ds, l);
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    setEnviando(true);
    try { await actions.anexarDocumento(l.id, tipo, { nome: f.name, mime: f.type, tamanho: f.size, dados: f }); aviso(`${ROTULO_ANEXO[tipo]} anexado(a) a ${l.id}.`); }
    catch (e) { aviso((e as Error).message); }
    finally { setEnviando(false); if (input.current) input.current.value = ''; }
  };
  const remover = async () => {
    if (!removendo) return;
    try { await actions.removerDocumento(removendo.id, removendo.motivo); setRemovendo(null); aviso('Documento removido (o arquivo fica guardado no histórico).'); }
    catch (e) { aviso((e as Error).message); }
  };
  return (
    <div className={`documentos${compacto ? ' compacto' : ''}`}>
      {!docs.length && <p className="small muted" style={{ margin: 0 }}>Nenhum documento anexado.</p>}
      {docs.map((a) => (
        <div key={a.id} className="documento">
          <Badge tone={TOM[a.tipo]}>{ROTULO_ANEXO[a.tipo]}</Badge>
          <button type="button" className="link documento-nome" title="Abrir" onClick={() => void abrir(a, aviso)}>{a.nome}</button>
          {!compacto && <span className="small muted">{tamanhoLegivel(a.tamanho)} · {a.enviadoPor} · {dataHora(a.enviadoEm)}</span>}
          {podeRemoverAnexo(usuario, a, l) && (removendo?.id === a.id
            ? <span className="actions"><input aria-label="Motivo da remoção" autoFocus value={removendo.motivo} placeholder="motivo (ex.: arquivo errado)" onChange={(e) => setRemovendo({ id: a.id, motivo: e.target.value })} /><button type="button" className="btn sm danger" disabled={removendo.motivo.trim().length < 3} onClick={() => void remover()}>Remover</button><button type="button" className="btn sm" onClick={() => setRemovendo(null)}>Cancelar</button></span>
            : <button type="button" className="btn sm" onClick={() => setRemovendo({ id: a.id, motivo: '' })}>Remover</button>)}
        </div>
      ))}
      {!!pend.length && <p className="small" style={{ margin: '4px 0 0', color: 'var(--warn)' }}>Falta: {pend.join(' e ')}.</p>}
      {!!tipos.length && (
        <div className="documento-novo">
          <select aria-label="Tipo do documento" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAnexo)}>
            {TIPOS_ANEXO.filter((t) => tipos.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
          </select>
          <input ref={input} type="file" accept="application/pdf,image/*" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
          <button type="button" className="btn sm" disabled={enviando} onClick={() => input.current?.click()}>{enviando ? 'Enviando…' : 'Anexar arquivo'}</button>
          <span className="small muted">PDF ou foto, até 10 MB</span>
        </div>
      )}
    </div>
  );
}
