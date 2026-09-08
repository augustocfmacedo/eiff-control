import React, { useMemo, useState } from 'react';
import { NOME_CANAL, NOME_PERSONA, NOME_TOM, OBJETIVOS, PLAYBOOKS, contextoComunicacaoDe, type Canal } from '../../core/radar';
import type { ComunicacaoRadar } from '../../core/radar/types';
import { actions, pode, useStore } from '../../data/store';
import { Badge, Field, Select, tentar, useToast } from '../../ui/components';

const CANAIS_GERACAO: Canal[] = ['WHATSAPP', 'EMAIL', 'PHONE'];
const toneEstado = (e: ComunicacaoRadar['estado']) => (e === 'APPROVED' ? 'ok' : e === 'REJECTED' || e === 'CANCELLED' ? 'bad' : e === 'READY_FOR_REVIEW' ? 'warn' : 'muted');

/** Painel de abordagem: WHY NOW, quem, objetivo, playbook, canais e CTA; gera rascunhos para revisao humana (nunca envia). */
export function Abordagem({ empresaId, contatoId, compacto }: { empresaId: string; contatoId?: string; compacto?: boolean }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const r = ds.radar;
  const [contatoSel, setContatoSel] = useState<string | undefined>(contatoId);
  const [canalSel, setCanalSel] = useState<Canal | ''>('');
  const [editando, setEditando] = useState<{ id: string; texto: string; assunto?: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const ctx = useMemo(() => contextoComunicacaoDe(r, empresaId, ds.params.dataBase, { contatoId: contatoSel, canal: canalSel || undefined }), [r, empresaId, ds.params.dataBase, contatoSel, canalSel]);
  const contatos = r.contatos.filter((c) => c.empresaId === empresaId && c.ativo);
  const comunicacoes = r.comunicacoes.filter((c) => c.empresaId === empresaId).sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
  const podeAgir = pode(usuario, 'radar');
  if (!ctx) return null;
  const gerar = (canal: Canal) => tentar(() => actions.gerarComunicacaoRadar(empresaId, { contatoId: ctx.contato?.id, canal }), toast, () => toast(`Rascunho ${NOME_CANAL[canal]} pronto para revisão.`));
  const ob = ctx.objetivo ? OBJETIVOS[ctx.objetivo] : undefined; const pb = ctx.playbook ? PLAYBOOKS[ctx.playbook] : undefined;
  return (
    <div className="card" id="abordagem">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Abordagem</h2>
        <div className="row small" style={{ gap: 8 }}>
          {contatos.length > 1 && <Select value={contatoSel ?? ctx.contato?.id ?? ''} onChange={(v) => setContatoSel(v || undefined)} options={contatos.map((c) => ({ value: c.id, label: c.nome }))} />}
          <Select value={canalSel} onChange={(v) => setCanalSel(v as Canal | '')} allowEmpty="canal recomendado" options={ctx.canal.disponiveis.map((c) => ({ value: c, label: NOME_CANAL[c] }))} />
        </div>
      </div>
      <table className="small" style={{ marginTop: 8 }}><tbody>
        <tr><td className="muted">WHY NOW</td><td>{ctx.whyNow ?? 'sem sinal verificado: nada a citar como fato'}{ctx.sinal?.url && <> · <a href={ctx.sinal.url} target="_blank" rel="noreferrer">fonte</a></>}</td></tr>
        <tr><td className="muted">WHO</td><td>{ctx.contato ? <>{ctx.contato.nome}{ctx.contato.cargo ? ` · ${ctx.contato.cargo}` : ''} · {NOME_PERSONA[ctx.contato.persona]} · decision fit {ctx.contato.decisionFit} (ideal {ctx.contato.fitIdeal})</> : 'sem contato'}{ctx.indicacao && <> · indicado por {ctx.indicacao.porNome}</>}</td></tr>
        <tr><td className="muted">OBJECTIVE</td><td>{ob ? <><b>{ob.codigo}</b> · {ob.nome}: {ob.condicaoSucesso}</> : <span className="muted">{ctx.motivoSelecao}</span>}</td></tr>
        <tr><td className="muted">PLAYBOOK</td><td>{pb ? <><b>{pb.codigo}</b> · {pb.nome} · tom {NOME_TOM[pb.tom]}</> : '—'}{!compacto && pb && <div className="muted">fazer: {pb.fazer.join('; ')} · não fazer: {pb.naoFazer.join('; ')}</div>}</td></tr>
        <tr><td className="muted">PRIMARY CHANNEL</td><td>{ctx.canal.primario ? NOME_CANAL[ctx.canal.primario] : '—'} <span className="muted">· {ctx.canal.motivo}</span></td></tr>
        <tr><td className="muted">SECONDARY CHANNEL</td><td>{ctx.canal.secundario ? NOME_CANAL[ctx.canal.secundario] : '—'}</td></tr>
        <tr><td className="muted">CTA</td><td>{ctx.cta ?? '—'}</td></tr>
        {!compacto && <tr><td className="muted">Estágio · estratégia</td><td>{ctx.estagio}{ctx.estrategia ? ` · ${ctx.estrategia}` : ''} · {ctx.historico.resumo}</td></tr>}
        {!compacto && <tr><td className="muted">Fatos permitidos</td><td>{ctx.fatosPermitidos.filter((f) => f.origem === 'sinal').map((f) => `${f.texto} [${f.fonte ?? '?'}, ${Math.round(f.confianca * 100)}%]`).join(' · ') || 'nenhum fato de sinal verificado'}{ctx.fatosNaoVerificados.length > 0 && <div className="muted">não usar (não verificado): {ctx.fatosNaoVerificados.map((f) => f.chave).join(', ')}</div>}</td></tr>}
      </tbody></table>
      {podeAgir && ctx.comunicar && ctx.contato && (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {CANAIS_GERACAO.filter((c) => ctx.canal.disponiveis.includes(c) || c === 'EMAIL').map((c) => <button key={c} className={`btn sm ${c === ctx.canal.primario ? 'primary' : ''}`} disabled={!ctx.canal.disponiveis.includes(c)} onClick={() => gerar(c)}>Gerar abordagem · {NOME_CANAL[c]}</button>)}
          <span className="small muted">gera um rascunho em revisão; nada é enviado</span>
        </div>
      )}
      {comunicacoes.slice(0, compacto ? 1 : 5).map((c) => {
        const texto = c.textoEditado ?? c.resultado.versaoPrincipal; const assunto = c.assuntoEditado ?? c.resultado.assunto;
        return (
          <div key={c.id} className="card" style={{ marginTop: 10 }}>
            <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{NOME_CANAL[c.canal]}</b> · {c.objetivo} · {c.playbook} <Badge tone={toneEstado(c.estado)}>{c.estado}</Badge> <span className="muted">{new Date(c.criadoEm).toLocaleString('pt-BR')} · {String(c.resultado.metadados.provedor)} · {String(c.resultado.metadados.palavras)} palavras</span></div>
            {editando?.id === c.id ? (
              <div className="form" style={{ marginTop: 6 }}>
                {c.canal === 'EMAIL' && <Field label="Assunto" full><input className="input" value={editando.assunto ?? ''} onChange={(e) => setEditando({ ...editando, assunto: e.target.value })} /></Field>}
                <Field label="Texto" full><textarea rows={8} value={editando.texto} onChange={(e) => setEditando({ ...editando, texto: e.target.value })} /></Field>
                <div className="row" style={{ gap: 8 }}><button className="btn sm primary" onClick={() => tentar(() => actions.editarComunicacaoRadar(c.id, editando.texto, editando.assunto), toast, () => { setEditando(null); toast('Rascunho editado.'); })}>Salvar</button><button className="btn sm" onClick={() => setEditando(null)}>Cancelar</button></div>
              </div>
            ) : (
              <>
                {assunto && <div className="small" style={{ marginTop: 6 }}><b>Assunto:</b> {assunto}</div>}
                <pre className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{texto}</pre>
                {c.canal === 'PHONE' && c.resultado.roteiroLigacao && <div className="small muted" style={{ marginTop: 4 }}><b>Roteiro:</b> {c.resultado.roteiroLigacao}</div>}
                {!compacto && c.resultado.versoesAlternativas.length > 0 && <details className="small"><summary className="muted">versão alternativa</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{c.resultado.versoesAlternativas[0]}</pre></details>}
                {!compacto && c.resultado.objecoes.length > 0 && <details className="small"><summary className="muted">objeções ({c.resultado.objecoes.length})</summary><ul>{c.resultado.objecoes.map((o) => <li key={o.gatilho}><b>{o.gatilho}</b> {o.resposta}</li>)}</ul></details>}
              </>
            )}
            {podeAgir && (c.estado === 'READY_FOR_REVIEW' || c.estado === 'REJECTED' || c.estado === 'APPROVED') && editando?.id !== c.id && (
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {c.estado === 'READY_FOR_REVIEW' && <button className="btn sm primary" onClick={() => tentar(() => actions.transicionarComunicacaoRadar(c.id, 'APPROVED'), toast, () => toast('Aprovado. O envio é manual: registre o contato como atividade.'))}>Aprovar</button>}
                {c.estado !== 'APPROVED' && <button className="btn sm" onClick={() => setEditando({ id: c.id, texto, assunto })}>Editar</button>}
                {c.estado === 'READY_FOR_REVIEW' && <><input className="input" placeholder="motivo da rejeição" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ minWidth: 200 }} /><button className="btn sm danger" onClick={() => tentar(() => actions.transicionarComunicacaoRadar(c.id, 'REJECTED', { motivo }), toast, () => { setMotivo(''); toast('Rejeitado.'); })}>Rejeitar</button></>}
                {c.estado === 'APPROVED' && <span className="small muted">aprovado: envio manual pelo canal, depois "Registrar atividade" com o resultado</span>}
              </div>
            )}
          </div>
        );
      })}
      {el}
    </div>
  );
}
