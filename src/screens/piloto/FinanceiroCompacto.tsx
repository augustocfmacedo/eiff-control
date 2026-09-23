// UX-P01 — Financeiro compacto: tela do piloto (somente leitura, sem store). Rodada 2.
//
// Recebe uma `EntradaPiloto` ja resolvida (fixture nesta fase; dataset do store na integracao) e mostra o modelo puro de
// `montarPiloto`. A tela nao decide nada financeiro: so apresenta. Blocos: cabecalho com microfrescor → SITUACAO
// (3 ou 4 tiles conforme a visao) → ATENCAO (nucleo: o que aconteceu · impacto · proximo passo, agrupada pela severidade
// canonica do alerta, sem horizonte temporal) → COMPOSICAO em gaveta lateral, so quando pedida. Acoes: apenas "Ver composicao", "Ver pendencias",
// "Ver origem" e "Ver projecao" para telas ja existentes do EIFF Control.
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, EstadoErro, Link, Skeleton } from '../../ui/components';
import { Sparkline } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { Valor } from '../../ui/motion';
import { fmtBr } from '../../core/engine';
import { ROTULO_TESTE } from './financeiroCompacto.fixtures';
import { VERSAO_PILOTO, VISOES, montarPiloto, type Composicao, type EntradaPiloto, type GrupoAtencao, type ItemAtencao, type ItemSituacao, type ModeloPiloto, type Tom, type Visao } from './financeiroCompactoModel';
import './piloto.css';

const badgeTom = (t?: Tom): 'ok' | 'warn' | 'bad' | 'info' | 'muted' => (t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : t === 'ok' ? 'ok' : t === 'info' ? 'info' : 'muted');

/** Faixa permanente e curta: nada aqui e situacao real. */
function FaixaTeste({ fonte }: { fonte: ModeloPiloto['fonte'] }) {
  if (fonte.modo !== 'teste') return null;
  return <div className="piloto-fin-faixa" role="note" title="Nenhum número desta tela representa a situação real da empresa."><Icon name="aviso" size={13} /><b>{ROTULO_TESTE}</b><span>dados fictícios{fonte.id ? ` · ${fonte.id}` : ''}</span></div>;
}

function Chips({ m }: { m: Extract<ModeloPiloto, { estado: 'pronto' | 'vazio' }> }) {
  return (
    <div className="piloto-fin-chips" aria-label="Frescor dos dados">
      {m.frescor.chips.map((c) => <span key={c.id} className={`piloto-fin-chip ${c.tom ?? ''}`} title={c.titulo}>{c.texto}</span>)}
    </div>
  );
}

function Tile({ item, aberto, onComposicao }: { item: ItemSituacao; aberto: boolean; onComposicao?: () => void }) {
  const clicavel = !!item.composicaoId && !!onComposicao;
  const duplo = item.valor === null && item.partes.length > 0;
  return (
    <div className={`piloto-fin-tile ${item.tom ?? ''} ${aberto ? 'aberto' : ''} ${clicavel ? 'clicavel' : ''} ${duplo ? 'duplo' : ''}`} onClick={clicavel ? onComposicao : undefined} role={clicavel ? 'button' : undefined} tabIndex={clicavel ? 0 : undefined} onKeyDown={clicavel ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onComposicao!(); } } : undefined} aria-expanded={clicavel ? aberto : undefined} title={clicavel ? 'Ver composição' : undefined}>
      <div className="piloto-fin-tile-label">{item.rotulo}</div>
      {duplo ? <div className="piloto-fin-tile-micro">{item.texto}</div> : <div className={`piloto-fin-tile-valor ${item.valor === null ? 'ausente' : ''}`}><Valor v={item.texto} /></div>}
      {item.micro && <div className="piloto-fin-tile-micro">{item.micro}</div>}
      {item.partes.length > 0 && (
        <div className="piloto-fin-tile-partes">
          {item.partes.map((p) => <div key={p.rotulo}><span className="piloto-fin-k">{p.rotulo}</span><span className={`piloto-fin-v ${p.tom ?? ''}`}>{p.texto}</span></div>)}
        </div>
      )}
      {clicavel && <span className="piloto-fin-tile-acao">{aberto ? 'Fechar composição' : 'Ver composição'}</span>}
    </div>
  );
}

function LinhaAtencao({ a, aberta, onComposicao }: { a: ItemAtencao; aberta: boolean; onComposicao?: () => void }) {
  return (
    <li className={`piloto-fin-item ${aberta ? 'aberto' : ''}`}>
      <span className={`piloto-fin-ponto ${a.tom}`} aria-hidden="true" />
      <div className="piloto-fin-item-texto">
        <div className="piloto-fin-item-oque">{a.texto}</div>
        {a.detalhe && <div className="piloto-fin-item-detalhe">{a.detalhe}</div>}
      </div>
      <div className={`piloto-fin-item-impacto ${a.tom}`}>{a.impacto}</div>
      <div className="piloto-fin-item-acoes">
        {a.composicaoId && onComposicao && <button type="button" className="piloto-fin-link" aria-expanded={aberta} onClick={onComposicao}>{aberta ? 'Fechar' : 'Ver composição'}</button>}
        {a.destino && <Link to={a.destino.to} className="piloto-fin-link">{a.destino.rotulo}</Link>}
      </div>
    </li>
  );
}

function Grupo({ g, composicao, alternar }: { g: GrupoAtencao; composicao: string | null; alternar: (id: string) => void }) {
  return (
    <div className={`piloto-fin-grupo ${g.severidade}`}>
      <div className="piloto-fin-grupo-head"><span className={`piloto-fin-ponto ${g.itens[0]?.tom ?? ''}`} aria-hidden="true" />{g.rotulo} <span className="muted">· {g.itens.length}</span></div>
      <ul className="piloto-fin-lista">
        {g.itens.map((a) => <LinhaAtencao key={a.id} a={a} aberta={!!a.composicaoId && composicao === a.composicaoId} onComposicao={a.composicaoId ? () => alternar(a.composicaoId!) : undefined} />)}
      </ul>
    </div>
  );
}

function Gaveta({ c, onFechar }: { c: Composicao; onFechar: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFechar]);
  return (
    <>
      <div className="piloto-fin-veu" onClick={onFechar} aria-hidden="true" />
      <aside className="piloto-fin-gaveta" role="dialog" aria-modal="true" aria-label={`Composição: ${c.titulo}`}>
        <div className="piloto-fin-gaveta-head">
          <div>
            <div className="piloto-fin-k">Composição</div>
            <h2>{c.titulo}</h2>
            <div className="small muted">{c.resumo}</div>
          </div>
          <button type="button" className="btn sm" onClick={onFechar} aria-label="Fechar composição">Fechar</button>
        </div>
        {c.serie && (
          <div className="piloto-fin-serie">
            <Sparkline valores={c.serie.valores} referencia={c.serie.referencia} rotulos={c.serie.rotulos} altura={64} />
            <div className="small muted">saldo por semana · tracejada = reserva mínima</div>
          </div>
        )}
        {c.linhas.length === 0 ? (
          <div className="empty">Nenhuma linha compõe este número.</div>
        ) : (
          <table className="piloto-fin-tabela">
            <thead><tr>{c.colunas.map((col) => <th key={col.titulo} className={col.num ? 'num' : ''}>{col.titulo}</th>)}</tr></thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={l.id}>
                  <td><div className="piloto-fin-linha-titulo">{l.to ? <Link to={l.to}>{l.titulo}</Link> : l.titulo}{l.tom && <Badge tone={badgeTom(l.tom)}>{l.tom === 'bad' ? 'vencido' : l.tom === 'warn' ? 'atenção' : l.tom}</Badge>}</div>{l.sub && <div className="small muted">{l.sub}</div>}</td>
                  <td>{l.data ? fmtBr(l.data) : <span className="muted">—</span>}</td>
                  <td className={`num ${l.tom === 'bad' ? 'neg' : ''}`}>{l.texto}</td>
                </tr>
              ))}
            </tbody>
            {c.total && <tfoot><tr className="total"><td colSpan={2}>{c.total.rotulo}</td><td className="num">{c.total.texto}</td></tr></tfoot>}
          </table>
        )}
        <div className="piloto-fin-origem">
          <div className="piloto-fin-origem-linha"><span className="piloto-fin-k">Origem</span><code>{c.origem.funcao}</code><code>{c.origem.campo}</code></div>
          <div className="small muted">{c.origem.regra}</div>
          {c.origem.tela && <Link to={c.origem.tela} className="piloto-fin-link">Ver origem no EIFF Control</Link>}
        </div>
      </aside>
    </>
  );
}

function Rodape({ m }: { m: Extract<ModeloPiloto, { estado: 'pronto' | 'vazio' }> }) {
  const f = m.frescor;
  return (
    <footer className="piloto-fin-rodape small muted" aria-label="Origem e período">
      Fonte {m.fonte.rotulo}{f.fonteAtualizadaEm ? ` · ${new Date(f.fonteAtualizadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ' · atualização desconhecida'} · período {f.periodo.rotulo} · cenário {f.cenario} · piloto {VERSAO_PILOTO}
    </footer>
  );
}

/** `composicaoInicial`/`visaoInicial` so definem o estado de montagem (capturas e links diretos); a escolha segue do usuario. */
export default function FinanceiroCompacto({ entrada, composicaoInicial = null, visaoInicial }: { entrada: EntradaPiloto; composicaoInicial?: string | null; visaoInicial?: Visao }) {
  const [visao, setVisao] = useState<Visao>(visaoInicial ?? (entrada.estado === 'pronto' ? entrada.visao ?? 'executivo' : 'executivo'));
  const m = useMemo(() => montarPiloto(entrada.estado === 'pronto' ? { ...entrada, visao } : entrada), [entrada, visao]);
  const [composicao, setComposicao] = useState<string | null>(composicaoInicial);
  const [todas, setTodas] = useState(false);
  const alternar = (id: string) => setComposicao((atual) => (atual === id ? null : id));
  const fechar = () => setComposicao(null);

  if (m.estado === 'carregando') {
    return (
      <div className="piloto-fin" aria-busy="true" aria-label="Carregando">
        <FaixaTeste fonte={m.fonte} />
        <div className="piloto-fin-head"><h1>Financeiro compacto</h1><div className="piloto-fin-chips"><Skeleton w={70} h={18} r={9} /><Skeleton w={110} h={18} r={9} /><Skeleton w={90} h={18} r={9} /></div></div>
        <div className="piloto-fin-situacao cols-3">{[0, 1, 2].map((i) => <div key={i} className="piloto-fin-tile"><Skeleton w={100} h={9} /><Skeleton w="65%" h={24} style={{ marginTop: 8 }} /><Skeleton w="80%" h={9} style={{ marginTop: 10 }} /></div>)}</div>
        <div className="card piloto-fin-atencao"><Skeleton w={60} h={9} />{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={13} style={{ marginTop: 10 }} />)}</div>
      </div>
    );
  }
  if (m.estado === 'erro') {
    return (
      <div className="piloto-fin">
        <FaixaTeste fonte={m.fonte} />
        <div className="piloto-fin-head"><h1>Financeiro compacto</h1></div>
        <EstadoErro titulo="Dados financeiros indisponíveis" causa={<>{m.mensagem}{m.causa && <> · <code>{m.causa}</code></>}</>}>Nada foi alterado; nenhum número é mostrado para não confundir ausência com zero.</EstadoErro>
      </div>
    );
  }
  if (m.estado === 'vazio') {
    return (
      <div className="piloto-fin">
        <FaixaTeste fonte={m.fonte} />
        <div className="piloto-fin-head"><h1>Financeiro compacto</h1><Chips m={m} /></div>
        <Empty icone="banco" titulo="Sem dados financeiros">{m.motivo}</Empty>
        <Rodape m={m} />
      </div>
    );
  }

  const grupos = todas ? m.atencao.grupos : m.atencao.gruposCompactos;
  const comp = composicao ? m.composicoes[composicao] : undefined;
  return (
    <div className="piloto-fin">
      <FaixaTeste fonte={m.fonte} />
      <div className="piloto-fin-head">
        <div className="piloto-fin-titulo">
          <h1>Financeiro compacto</h1>
          <Chips m={m} />
        </div>
        <div className="piloto-fin-visoes" role="tablist" aria-label="Visão">
          {VISOES.map((v) => <button key={v.id} type="button" role="tab" aria-selected={visao === v.id} className={`btn sm ${visao === v.id ? 'primary' : ''}`} title={v.descricao} onClick={() => setVisao(v.id)}>{v.rotulo}</button>)}
        </div>
      </div>

      <section aria-label="Situação" className={`piloto-fin-situacao cols-${m.situacao.length}`}>
        {m.situacao.map((s) => <Tile key={s.id} item={s} aberto={!!s.composicaoId && composicao === s.composicaoId} onComposicao={s.composicaoId ? () => alternar(s.composicaoId!) : undefined} />)}
      </section>

      <section className="card piloto-fin-atencao" aria-label="Atenção">
        <div className="piloto-fin-atencao-head">
          <h3 className="piloto-fin-secao">Atenção <span className="muted">· {m.atencao.todas.length}</span></h3>
          {m.atencao.ocultas > 0 && !todas && <button type="button" className="piloto-fin-link" onClick={() => setTodas(true)}>Ver todas (+{m.atencao.ocultas})</button>}
          {todas && m.atencao.ocultas > 0 && <button type="button" className="piloto-fin-link" onClick={() => setTodas(false)}>Só as principais</button>}
        </div>
        {grupos.length === 0 ? <div className="empty">Nada exige atenção.</div> : grupos.map((g) => <Grupo key={g.severidade} g={g} composicao={composicao} alternar={alternar} />)}
      </section>

      <Rodape m={m} />
      {comp && <Gaveta c={comp} onFechar={fechar} />}
    </div>
  );
}
