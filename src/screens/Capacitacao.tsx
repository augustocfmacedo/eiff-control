import React, { useState } from 'react';
import { LICOES, PAPEIS, PROCESSOS, ROTINAS, progressoDe, progressoEquipe, trilhaDe, type AreaLicao, type Licao } from '../core/capacitacao';
import { SETORES, gerarHtmlCompleto, gerarHtmlSetor, licoesDoSetor } from '../core/ebook';
import type { Papel } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, KpiHero, KpiStrip, Link, Modal, PageHead, PrintHead, ProgressRow, Select, Tabs, pct, tentar, useToast } from '../ui/components';
import { Icon } from '../ui/icons';

const d = (s?: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const ORDEM_AREAS: AreaLicao[] = ['Base', 'Financeiro', 'Obras', 'Engenharia', 'Fábrica e montagem', 'Estoque', 'Equipe', 'Compras', 'Direção e controladoria', 'Administração'];

// ---------------------------------------------------------------------------
// Licao (leitura + verificacao)
// ---------------------------------------------------------------------------
function LicaoModal({ l, concluida, onClose, onErro, onOk }: { l: Licao; concluida: boolean; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const [resp, setResp] = useState<Record<number, number>>({});
  const [checou, setChecou] = useState(false);
  const acertos = l.verificacao.filter((v, i) => resp[i] === v.correta).length;
  const todas = l.verificacao.every((_, i) => resp[i] !== undefined);
  const concluir = () => { setChecou(true); if (acertos < l.verificacao.length) { onErro(`${acertos} de ${l.verificacao.length} corretas. Reveja os passos e tente de novo.`); return; } tentar(() => { actions.concluirLicao(l.id, 1); onOk(`Lição "${l.titulo}" concluída.`); }, onErro, onClose); };
  return (
    <Modal title={l.titulo} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Badge tone="info">{l.area}</Badge><Badge tone="muted">{l.minutos} min</Badge>{concluida && <Badge tone="ok">concluída</Badge>}
        <span className="spacer" />
        <Link to={l.rota} className="btn sm">Abrir a tela</Link>
      </div>
      <p><b>Objetivo.</b> {l.objetivo}</p>
      <h3>Como fazer</h3>
      <ol className="lista-passos">{l.passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
      <div className="grid cols-2">
        <div>
          <h3>O sistema exige</h3>
          {l.obrigatorios.length ? <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{l.obrigatorios.map((o) => <Badge key={o} tone="warn">{o}</Badge>)}</div> : <div className="muted small">Sem campos obrigatórios nesta lição.</div>}
          {!!l.regras.length && <><h3 style={{ marginTop: 12 }}>Regras automáticas</h3><ul className="small">{l.regras.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
        </div>
        <div>
          {!!l.erros.length && <><h3>Erros comuns</h3><ul className="small">{l.erros.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
        </div>
      </div>
      <h3 style={{ marginTop: 14 }}>Verificação</h3>
      {l.verificacao.map((v, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: 10 }}>
          <div><b>{i + 1}. {v.pergunta}</b></div>
          {v.opcoes.map((o, j) => (
            <label key={j} className="row" style={{ gap: 8, cursor: 'pointer', padding: '3px 0' }}>
              <input type="radio" name={`q${i}`} checked={resp[i] === j} onChange={() => setResp({ ...resp, [i]: j })} />
              <span>{o}</span>
              {checou && resp[i] === j && <Badge tone={j === v.correta ? 'ok' : 'bad'}>{j === v.correta ? 'certo' : 'errado'}</Badge>}
            </label>
          ))}
        </div>
      ))}
      <div className="foot">
        {concluida && <button className="btn" onClick={() => tentar(() => actions.desfazerLicao(l.id), onErro, () => { onOk('Conclusão desfeita.'); onClose(); })}>Desfazer conclusão</button>}
        <button className="btn" onClick={onClose}>Fechar</button>
        {!concluida && <button className="btn primary" disabled={!todas} onClick={concluir}>Concluir lição</button>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function Capacitacao({ licao: licaoUrl, query }: { licao?: string; query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const gestor = pode(usuario, 'editar_obra') || pode(usuario, 'administrar');
  const [papel, setPapel] = useState<Papel>((query.get('papel') as Papel) || usuario.papel);
  const [aba, setAba] = useState<'trilha' | 'processos' | 'rotinas' | 'todas' | 'ebook' | 'equipe'>((query.get('aba') as 'trilha') || 'trilha');
  const abrirEbook = (html: string, nome: string, baixar: boolean) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (baixar) { const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); } else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const [aberta, setAberta] = useState<string | null>(licaoUrl ?? null);
  const feitas = new Set(ds.treinamentos.filter((t) => t.usuarioId === usuario.id).map((t) => t.licaoId));
  const prog = progressoDe(usuario, ds.treinamentos, papel);
  const trilha = trilhaDe(papel);
  const equipe = gestor ? progressoEquipe(ds.usuarios, ds.treinamentos) : [];
  const mediaEquipe = equipe.length ? equipe.reduce((s, p) => s + p.pct, 0) / equipe.length : 0;
  const rotina = ROTINAS[papel];
  const lic = aberta ? LICOES.find((l) => l.id === aberta) : undefined;
  const cardLicao = (l: Licao, i?: number) => (
    <div key={l.id} className={`card licao ${feitas.has(l.id) ? 'ok' : ''}`} onClick={() => setAberta(l.id)} style={{ cursor: 'pointer', padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      <div className={`licao-n ${feitas.has(l.id) ? 'ok' : ''}`}>{feitas.has(l.id) ? <Icon name="aprovacoes" size={16} /> : (i !== undefined ? i + 1 : '·')}</div>
      <div style={{ flex: 1 }}>
        <div><b>{l.titulo}</b> <span className="muted small">· {l.minutos} min</span></div>
        <div className="small muted">{l.objetivo}</div>
      </div>
      <Badge tone={feitas.has(l.id) ? 'ok' : 'muted'}>{feitas.has(l.id) ? 'concluída' : l.area}</Badge>
    </div>
  );
  return (
    <>
      <div className="no-print">
        <PageHead title="Capacitação" subtitle="Trilha de estudo por papel, com o passo a passo de cada tela, os campos que o sistema exige, as regras automáticas e uma verificação ao final. Processos ponta a ponta e rotinas diária, semanal e mensal.">
          {gestor && <Select value={papel} onChange={(v) => setPapel(v as Papel)} options={PAPEIS} />}
          <button className="btn" onClick={() => setAba('ebook')}>E-books</button>
          <button className="btn" onClick={() => window.print()}>Imprimir trilha</button>
        </PageHead>
        <div className="hero-grid">
          <KpiHero label={papel === usuario.papel ? 'Minha trilha' : `Trilha · ${papel}`} value={pct(prog.pct)} sufixo={`${prog.concluidas} de ${prog.total} lições`} tone={prog.pct >= 1 ? 'ok' : undefined}
            hint={prog.proxima ? `Próxima: ${prog.proxima.titulo} · ${prog.minutosRestantes} min restantes` : 'Trilha concluída. Revise as lições quando uma regra mudar.'}
            secundarios={[{ label: 'Concluídas', value: prog.concluidas }, { label: 'Restantes', value: prog.total - prog.concluidas }, { label: 'Tempo restante', value: `${prog.minutosRestantes} min` }, { label: 'Última', value: d(prog.ultima) }]}>
            {prog.porArea.map((a) => <ProgressRow key={a.area} label={a.area} valor={a.total ? a.concluidas / a.total : 0} texto={`${a.concluidas}/${a.total}`} />)}
          </KpiHero>
          {gestor ? (
            <KpiHero label="Equipe" value={pct(mediaEquipe)} sufixo={`${equipe.filter((p) => p.pct >= 1).length} de ${equipe.length} concluíram`} hint="Progresso médio dos usuários ativos na trilha do próprio papel"
              secundarios={[{ label: 'Usuários', value: equipe.length }, { label: 'Sem começar', value: equipe.filter((p) => !p.concluidas).length }, { label: 'Lições no sistema', value: LICOES.length }]}>
              {equipe.slice(0, 6).map((p) => <ProgressRow key={p.usuario.id} label={`${p.usuario.nome.split(' ')[0]} · ${p.usuario.papel}`} valor={p.pct} texto={`${p.concluidas}/${p.total}`} />)}
            </KpiHero>
          ) : (
            <KpiHero label="Processos" value={PROCESSOS.length} sufixo="fluxos ponta a ponta" hint="Como o seu trabalho se liga ao das outras áreas" secundarios={[{ label: 'Lições', value: LICOES.length }, { label: 'Rotina diária', value: rotina.diaria.length }, { label: 'Semanal', value: rotina.semanal.length }, { label: 'Mensal', value: rotina.mensal.length }]}>
              {PROCESSOS.map((p) => <div key={p.id} className="small" style={{ padding: '3px 0' }}><b>{p.titulo}</b> <span className="muted">· {p.etapas.length} etapas</span></div>)}
            </KpiHero>
          )}
        </div>
        <KpiStrip itens={ORDEM_AREAS.filter((a) => trilha.some((l) => l.area === a)).map((a) => ({ label: a, value: `${trilha.filter((l) => l.area === a && feitas.has(l.id)).length}/${trilha.filter((l) => l.area === a).length}`, hint: `${trilha.filter((l) => l.area === a).reduce((s, l) => s + l.minutos, 0)} min` }))} />
        <div style={{ height: 16 }} />
        <Tabs value={aba} onChange={setAba} items={[{ id: 'trilha', label: `Minha trilha (${trilha.length})` }, { id: 'processos', label: `Processos (${PROCESSOS.length})` }, { id: 'rotinas', label: 'Rotinas' }, { id: 'todas', label: `Todas as lições (${LICOES.length})` }, { id: 'ebook', label: `E-books (${SETORES.length})` }, ...(gestor ? [{ id: 'equipe' as const, label: `Equipe (${equipe.length})` }] : [])]} />
        {aba === 'trilha' && (
          <div className="grid" style={{ gap: 8 }}>
            {!trilha.length ? <Empty icone="capacitacao" titulo="Sem trilha para este papel">Peça ao Administrador para revisar o papel do seu usuário.</Empty> : trilha.map((l, i) => cardLicao(l, i))}
          </div>
        )}
        {aba === 'processos' && PROCESSOS.map((p) => (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            <h2>{p.titulo}</h2>
            <div className="muted small" style={{ marginBottom: 8 }}>{p.objetivo}</div>
            <ol className="lista-processo">
              {p.etapas.map((e, i) => (
                <li key={i}>
                  <Badge tone={e.papel === 'Fábrica' || e.papel === 'Canteiro' ? 'info' : e.papel === 'Cliente' ? 'muted' : e.papel === papel ? 'ok' : 'muted'}>{e.papel}</Badge>
                  <b style={{ marginLeft: 8 }}>{e.titulo}</b> <span className="small">{e.descricao}</span>
                  {e.licaoId && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setAberta(e.licaoId!)}>lição</button>}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {aba === 'rotinas' && (
          <div className="grid cols-3">
            {(['diaria', 'semanal', 'mensal'] as const).map((k) => (
              <div key={k} className="card">
                <h2>{k === 'diaria' ? 'Todo dia' : k === 'semanal' ? 'Toda semana' : 'Todo mês'}</h2>
                {!rotina[k].length ? <div className="muted small">Nada fixo para este papel.</div> : (
                  <ul className="lista-rotina">{rotina[k].map((it, i) => <li key={i}><Link to={it.rota}>{it.texto}</Link>{it.licaoId && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setAberta(it.licaoId!)}>lição</button>}</li>)}</ul>
                )}
              </div>
            ))}
          </div>
        )}
        {aba === 'todas' && ORDEM_AREAS.map((a) => (
          <div key={a} style={{ marginBottom: 14 }}>
            <h2>{a}</h2>
            <div className="grid" style={{ gap: 8 }}>{LICOES.filter((l) => l.area === a).map((l) => cardLicao(l))}</div>
          </div>
        ))}
        {aba === 'ebook' && (
          <>
            <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon name="livro" size={22} />
              <div style={{ flex: 1 }}><b>Manual completo</b><div className="small muted">Todos os setores em um único documento: introdução, conceitos, lições passo a passo, processos, rotinas e perguntas frequentes. Abra e use "Imprimir › Salvar como PDF" para distribuir.</div></div>
              <button className="btn" onClick={() => abrirEbook(gerarHtmlCompleto({ empresa: ds.params.empresa, data: ds.params.dataBase }), 'eiff-control-manual-completo.html', true)}>Baixar</button>
              <button className="btn primary" onClick={() => abrirEbook(gerarHtmlCompleto({ empresa: ds.params.empresa, data: ds.params.dataBase }), 'manual-completo.html', false)}>Abrir</button>
            </div>
            <div className="grid cols-2">
              {SETORES.map((s) => (
                <div key={s.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div><b>{s.titulo}</b><div className="small muted">{s.subtitulo}</div></div>
                  <div className="small">{s.introducao[0].slice(0, 220)}…</div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Badge tone="muted">{licoesDoSetor(s).length} lições</Badge><Badge tone="muted">{s.conceitos.length} conceitos</Badge><Badge tone="muted">{s.faq.length} perguntas</Badge>{s.papeis.map((p) => <Badge key={p} tone="info">{p}</Badge>)}</div>
                  <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
                    <button className="btn sm" onClick={() => abrirEbook(gerarHtmlSetor(s, { empresa: ds.params.empresa, data: ds.params.dataBase }), `eiff-control-${s.id}.html`, true)}>Baixar</button>
                    <button className="btn sm primary" onClick={() => abrirEbook(gerarHtmlSetor(s, { empresa: ds.params.empresa, data: ds.params.dataBase }), `${s.id}.html`, false)}>Abrir</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {aba === 'equipe' && gestor && (
          <div className="card table-wrap">
            {!equipe.length ? <Empty icone="equipe">Sem usuários ativos.</Empty> : (
              <table>
                <thead><tr><th>Usuário</th><th>Papel</th><th className="num">Concluídas</th><th className="num">Trilha</th><th>Progresso</th><th>Próxima lição</th><th>Última conclusão</th></tr></thead>
                <tbody>{equipe.map((p) => (
                  <tr key={p.usuario.id}>
                    <td><b>{p.usuario.nome}</b><div className="muted small">{p.usuario.email}</div></td><td className="small">{p.usuario.papel}</td>
                    <td className="num">{p.concluidas}</td><td className="num">{p.total}</td>
                    <td style={{ minWidth: 160 }}><ProgressRow label="" valor={p.pct} texto={pct(p.pct)} /></td>
                    <td className="small">{p.proxima?.titulo ?? <Badge tone="ok">trilha concluída</Badge>}</td><td className="small muted">{d(p.ultima)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* manual impresso: trilha do papel selecionado */}
      <div className="print-only manual">
        <PrintHead titulo={`Manual de operação · ${papel}`} subtitulo="EIFF Control · trilha de capacitação, processos e rotinas" />
        {trilha.map((l, i) => (
          <section key={l.id} className="manual-licao">
            <h2>{i + 1}. {l.titulo}</h2>
            <div className="small muted">{l.area} · tela {l.rota} · {l.minutos} min</div>
            <p><b>Objetivo.</b> {l.objetivo}</p>
            <h3>Como fazer</h3><ol>{l.passos.map((p, j) => <li key={j}>{p}</li>)}</ol>
            {!!l.obrigatorios.length && <p><b>O sistema exige:</b> {l.obrigatorios.join(' · ')}.</p>}
            {!!l.regras.length && <><h3>Regras automáticas</h3><ul>{l.regras.map((r, j) => <li key={j}>{r}</li>)}</ul></>}
            {!!l.erros.length && <><h3>Erros comuns</h3><ul>{l.erros.map((e, j) => <li key={j}>{e}</li>)}</ul></>}
          </section>
        ))}
        <section className="manual-licao">
          <h2>Processos</h2>
          {PROCESSOS.map((p) => <div key={p.id}><h3>{p.titulo}</h3><p className="small">{p.objetivo}</p><ol>{p.etapas.map((e, i) => <li key={i}><b>{e.papel}:</b> {e.titulo}. {e.descricao}</li>)}</ol></div>)}
        </section>
        <section className="manual-licao">
          <h2>Rotinas · {papel}</h2>
          {(['diaria', 'semanal', 'mensal'] as const).map((k) => <div key={k}><h3>{k === 'diaria' ? 'Todo dia' : k === 'semanal' ? 'Toda semana' : 'Todo mês'}</h3><ul>{rotina[k].map((it, i) => <li key={i}>{it.texto}</li>)}</ul></div>)}
        </section>
      </div>

      {lic && <LicaoModal l={lic} concluida={feitas.has(lic.id)} onClose={() => setAberta(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
