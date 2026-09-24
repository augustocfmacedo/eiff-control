// UX-P03/UX-P04 — Obras compacto: tela do piloto (somente leitura, sem store), integrada em #/piloto/obras.
//
// Recebe uma `EntradaObras` ja resolvida pelo App (`entradaDoApp` sobre Dataset, usuario, sync e o conjunto de obras
// visiveis que o App calcula pela regra oficial; a fixture existe so nos testes) e apresenta o modelo puro de
// `montarObras`. A tela nao decide nada de obra nem de visibilidade: so apresenta. Blocos: cabecalho com
// microfrescor e sincronizacao (separados) → SITUACAO (3 ou 4 tiles conforme a visao) → OBRAS (uma linha por obra
// visivel) → ATENCAO (agrupada pela severidade canonica; o que nao tem classificacao fica fora dos grupos) →
// COMPOSICAO em gaveta lateral, so quando pedida. Acoes: apenas leitura ("Ver composicao", "Ver obra", "Ver obras",
// "Ver controles") para telas ja existentes.
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, EstadoErro, Link, Skeleton } from '../../ui/components';
import { Sparkline } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { Valor } from '../../ui/motion';
import { fmtBr } from '../../core/engine';
import { ROTULO_SINCRONIZACAO, VERSAO_PILOTO, VISOES, montarObras, pct, type Composicao, type EntradaObras, type GrupoAtencao, type ItemAtencao, type ItemSituacao, type LinhaObra, type ModeloObras, type Tom, type Visao } from './obrasCompactoModel';
import './pilotoObras.css';

const badgeTom = (t?: Tom): 'ok' | 'warn' | 'bad' | 'info' | 'muted' => (t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : t === 'ok' ? 'ok' : t === 'info' ? 'info' : 'muted');
const TOM_SEMAFORO: Record<LinhaObra['semaforo'], Tom> = { vermelho: 'bad', amarelo: 'warn', verde: 'ok' };
const dataHoraCurta = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Modo local: o seed nao e a operacao real, e a tela diz isso; em modo remoto nao renderiza nada. */
function Faixa({ fonte }: { fonte: ModeloObras['fonte'] }) {
  if (fonte.modo === 'local') return <div className="piloto-obra-faixa" role="note"><Icon name="aviso" size={13} /><b>Modo local</b><span>dados do seed · não são a operação real</span></div>;
  return null;
}

function ChipSync({ fonte }: { fonte: ModeloObras['fonte'] }) {
  const s = fonte.sincronizacao;
  if (!s) return null;
  const tom = s.estado === 'erro' ? 'bad' : s.estado === 'pendente' ? 'warn' : '';
  const sufixo = s.estado === 'sincronizado' ? dataHoraCurta(s.em) : s.estado === 'pendente' && s.desde ? `desde ${dataHoraCurta(s.desde)}` : '';
  return <span className={`piloto-obra-chip ${tom}`} title={s.msg ?? 'Estado de sincronização do aplicativo'} aria-label="Sincronização">{ROTULO_SINCRONIZACAO[s.estado]}{sufixo ? ` ${sufixo}` : ''}</span>;
}

function Chips({ m }: { m: Extract<ModeloObras, { estado: 'pronto' | 'vazio' | 'sem-visibilidade' }> }) {
  return (
    <div className="piloto-obra-chips" aria-label="Frescor e sincronização dos dados">
      {m.frescor.chips.map((c) => <span key={c.id} className={`piloto-obra-chip ${c.tom ?? ''}`} title={c.titulo}>{c.texto}</span>)}
      <ChipSync fonte={m.fonte} />
    </div>
  );
}

function Tile({ item, aberto, onComposicao }: { item: ItemSituacao; aberto: boolean; onComposicao?: () => void }) {
  const clicavel = !!item.composicaoId && !!onComposicao;
  const duplo = item.valor === null && item.partes.length > 0;
  return (
    <div className={`piloto-obra-tile ${item.tom ?? ''} ${aberto ? 'aberto' : ''} ${clicavel ? 'clicavel' : ''} ${duplo ? 'duplo' : ''}`} onClick={clicavel ? onComposicao : undefined} role={clicavel ? 'button' : undefined} tabIndex={clicavel ? 0 : undefined} onKeyDown={clicavel ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onComposicao!(); } } : undefined} aria-expanded={clicavel ? aberto : undefined} title={item.origem.regra}>
      <div className="piloto-obra-tile-label">{item.rotulo}</div>
      {duplo ? <div className="piloto-obra-tile-micro">{item.texto}</div> : <div className={`piloto-obra-tile-valor ${item.valor === null ? 'ausente' : ''}`}><Valor v={item.texto} /></div>}
      {item.micro && <div className="piloto-obra-tile-micro">{item.micro}</div>}
      {item.partes.length > 0 && <div className="piloto-obra-tile-partes">{item.partes.map((p) => <div key={p.rotulo}><span className="piloto-obra-k">{p.rotulo}</span><span className={`piloto-obra-v ${p.tom ?? ''} ${p.valor === null ? 'ausente' : ''}`}>{p.texto}</span></div>)}</div>}
      {clicavel && <span className="piloto-obra-tile-acao">{aberto ? 'Fechar composição' : 'Ver composição'}</span>}
    </div>
  );
}

function LinhaDeObra({ o, visao, composicao, alternar }: { o: LinhaObra; visao: Visao; composicao: string | null; alternar: (id: string) => void }) {
  return (
    <li className="piloto-obra-linha">
      <span className={`piloto-obra-ponto ${TOM_SEMAFORO[o.semaforo]}`} aria-hidden="true" title={`saúde ${o.semaforo} · score ${o.score}`} />
      <div className="piloto-obra-linha-nome">
        <div className="piloto-obra-linha-titulo"><Link to={o.to}>{o.nome}</Link><Badge tone="muted">{o.status}</Badge></div>
        <div className="piloto-obra-linha-sub">{o.codigo}{o.proximoMarco ? ` · próximo marco: ${o.proximoMarco.evento}${o.proximoMarco.data ? ` em ${fmtBr(o.proximoMarco.data)}` : ''}` : ' · sem marco previsto'}{o.diasParaPrazo !== undefined ? ` · prazo em ${o.diasParaPrazo} d` : ''}</div>
      </div>
      {visao === 'diretoria' ? (
        <>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Margem proj.</span><span className={`piloto-obra-v ${o.pctMargemProjetada < 0 ? 'bad' : ''}`}>{pct(o.pctMargemProjetada)}</span></div>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Avanço físico</span><span className="piloto-obra-v">{o.temServicos ? pct(o.execucaoFisica) : 'sem serviços'}</span></div>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Saúde</span><span className={`piloto-obra-v ${TOM_SEMAFORO[o.semaforo]}`}>{o.semaforo} · {o.score}</span></div>
        </>
      ) : (
        <>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Avanço físico</span><span className="piloto-obra-v">{o.temServicos ? pct(o.execucaoFisica) : 'sem serviços'}</span></div>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Medições</span><span className={`piloto-obra-v ${o.medicoesAtrasadas > 0 ? 'warn' : ''}`}>{o.medicoesPendentes} pend. · {o.medicoesAtrasadas} atras.</span></div>
          <div className="piloto-obra-linha-num"><span className="piloto-obra-k">Serviços</span><span className={`piloto-obra-v ${o.servicosAtrasados > 0 ? 'bad' : o.servicosEmRisco > 0 ? 'warn' : ''}`}>{o.servicosAtrasados} atras. · {o.servicosEmRisco} risco</span></div>
        </>
      )}
      <div className="piloto-obra-linha-acoes">
        {o.composicoes.map((c) => <button key={c.id} type="button" className={`piloto-obra-link ${composicao === c.id ? 'ativo' : ''}`} aria-expanded={composicao === c.id} onClick={() => alternar(c.id)}>{c.rotulo}</button>)}
      </div>
    </li>
  );
}

function LinhaAtencao({ a, aberta, onComposicao }: { a: ItemAtencao; aberta: boolean; onComposicao?: () => void }) {
  return (
    <li className={`piloto-obra-item ${aberta ? 'aberto' : ''}`}>
      <span className={`piloto-obra-ponto ${a.tom ?? ''}`} aria-hidden="true" />
      <div className="piloto-obra-item-texto">
        <div className="piloto-obra-item-oque">{a.texto}</div>
        {a.detalhe && <div className="piloto-obra-item-detalhe">{a.detalhe}</div>}
      </div>
      <div className={`piloto-obra-item-impacto ${a.tom ?? ''}`}>{a.impacto}</div>
      <div className="piloto-obra-item-acoes">
        {a.composicaoId && onComposicao && <button type="button" className="piloto-obra-link" aria-expanded={aberta} onClick={onComposicao}>{aberta ? 'Fechar' : 'Ver composição'}</button>}
        {a.destino && <Link to={a.destino.to} className="piloto-obra-link">{a.destino.rotulo}</Link>}
      </div>
    </li>
  );
}

function Grupo({ g, composicao, alternar }: { g: GrupoAtencao; composicao: string | null; alternar: (id: string) => void }) {
  return (
    <div className={`piloto-obra-grupo ${g.severidade}`}>
      <div className="piloto-obra-grupo-head"><span className={`piloto-obra-ponto ${g.itens[0]?.tom ?? ''}`} aria-hidden="true" />{g.rotulo} <span className="muted">· {g.itens.length}</span></div>
      <ul className="piloto-obra-lista">{g.itens.map((a) => <LinhaAtencao key={a.id} a={a} aberta={!!a.composicaoId && composicao === a.composicaoId} onComposicao={a.composicaoId ? () => alternar(a.composicaoId!) : undefined} />)}</ul>
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
      <div className="piloto-obra-veu" onClick={onFechar} aria-hidden="true" />
      <aside className="piloto-obra-gaveta" role="dialog" aria-modal="true" aria-label={`Composição: ${c.titulo}`}>
        <div className="piloto-obra-gaveta-head">
          <div><div className="piloto-obra-k">Composição</div><h2>{c.titulo}</h2><div className="small muted">{c.resumo}</div></div>
          <button type="button" className="btn sm" onClick={onFechar} aria-label="Fechar composição">Fechar</button>
        </div>
        {c.serie && c.serie.valores.length > 1 && <div className="piloto-obra-serie"><Sparkline valores={c.serie.valores} referencia={c.serie.referencia} rotulos={c.serie.rotulos} altura={64} /><div className="small muted">previsto acumulado por mês (motor)</div></div>}
        {c.linhas.length === 0 ? <div className="empty">Nenhuma linha compõe este número.</div> : (
          <table className="piloto-obra-tabela">
            <thead><tr>{c.colunas.map((col, i) => <th key={`${col.titulo}-${i}`} className={col.num ? 'num' : ''}>{col.titulo}</th>)}</tr></thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={l.id}>
                  <td><div className="piloto-obra-linha-titulo">{l.to ? <Link to={l.to}>{l.titulo}</Link> : l.titulo}{l.tom && <Badge tone={badgeTom(l.tom)}>{l.tom === 'bad' ? 'atrasado' : l.tom === 'warn' ? 'atenção' : l.tom === 'ok' ? 'ok' : l.tom}</Badge>}</div>{l.sub && <div className="small muted">{l.sub}</div>}</td>
                  <td>{l.data ? fmtBr(l.data) : <span className="muted">—</span>}</td>
                  <td className={`num ${l.tom === 'bad' ? 'neg' : ''}`}>{l.texto}</td>
                </tr>
              ))}
            </tbody>
            {c.total && <tfoot><tr className="total"><td colSpan={2}>{c.total.rotulo}</td><td className="num">{c.total.texto}</td></tr></tfoot>}
          </table>
        )}
        <div className="piloto-obra-origem">
          <div className="piloto-obra-origem-linha"><span className="piloto-obra-k">Origem</span><code>{c.origem.funcao}</code><code>{c.origem.campo}</code></div>
          <div className="small muted">{c.origem.regra}</div>
          {c.origem.tela && <Link to={c.origem.tela} className="piloto-obra-link">Ver origem no EIFF Control</Link>}
        </div>
      </aside>
    </>
  );
}

function Rodape({ m }: { m: Extract<ModeloObras, { estado: 'pronto' | 'vazio' | 'sem-visibilidade' }> }) {
  const f = m.frescor;
  return <footer className="piloto-obra-rodape small muted" aria-label="Origem e período">Fonte {m.fonte.rotulo}{f.fonteAtualizadaEm ? ` · ${dataHoraCurta(f.fonteAtualizadaEm)}` : m.fonte.modo === 'remoto' ? ' · atualização desconhecida' : ''} · data-base {fmtBr(f.dataBase)} · piloto {VERSAO_PILOTO}</footer>;
}

export default function ObrasCompacto({ entrada, composicaoInicial = null, visaoInicial }: { entrada: EntradaObras; composicaoInicial?: string | null; visaoInicial?: Visao }) {
  const [visao, setVisao] = useState<Visao>(visaoInicial ?? (entrada.estado === 'pronto' ? entrada.visao ?? 'diretoria' : 'diretoria'));
  const m = useMemo(() => montarObras(entrada.estado === 'pronto' ? { ...entrada, visao } : entrada), [entrada, visao]);
  const [composicao, setComposicao] = useState<string | null>(composicaoInicial);
  const [todas, setTodas] = useState(false);
  const alternar = (id: string) => setComposicao((atual) => (atual === id ? null : id));
  const fechar = () => setComposicao(null);

  if (m.estado === 'carregando') {
    return (
      <div className="piloto-obra" aria-busy="true" aria-label="Carregando">
        <Faixa fonte={m.fonte} />
        <div className="piloto-obra-head"><h1>Obras compacto</h1><div className="piloto-obra-chips"><Skeleton w={70} h={18} r={9} /><Skeleton w={130} h={18} r={9} /><Skeleton w={110} h={18} r={9} /></div></div>
        <div className="piloto-obra-situacao cols-3">{[0, 1, 2].map((i) => <div key={i} className="piloto-obra-tile"><Skeleton w={110} h={9} /><Skeleton w="65%" h={24} style={{ marginTop: 8 }} /><Skeleton w="80%" h={9} style={{ marginTop: 10 }} /></div>)}</div>
        <div className="card piloto-obra-bloco"><Skeleton w={60} h={9} />{[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={14} style={{ marginTop: 10 }} />)}</div>
      </div>
    );
  }
  if (m.estado === 'erro') {
    return (
      <div className="piloto-obra">
        <Faixa fonte={m.fonte} />
        <div className="piloto-obra-head"><h1>Obras compacto</h1></div>
        <EstadoErro titulo="Dados das obras indisponíveis" causa={<>{m.mensagem}{m.causa && <> · <code>{m.causa}</code></>}</>}>Nada foi alterado; nenhum número é mostrado para não confundir ausência com zero.</EstadoErro>
      </div>
    );
  }
  if (m.estado === 'vazio' || m.estado === 'sem-visibilidade') {
    return (
      <div className="piloto-obra">
        <Faixa fonte={m.fonte} />
        <div className="piloto-obra-head"><h1>Obras compacto</h1><Chips m={m} /></div>
        <Empty icone="obras" titulo={m.estado === 'vazio' ? 'Sem obras cadastradas' : 'Nenhuma obra visível'}>{m.motivo}{m.estado === 'sem-visibilidade' ? ` Obras cadastradas: ${m.totalObras}.` : ''}</Empty>
        <Rodape m={m} />
      </div>
    );
  }

  const grupos = todas ? m.atencao.grupos : m.atencao.gruposCompactos;
  const comp = composicao ? m.composicoes[composicao] : undefined;
  return (
    <div className="piloto-obra">
      <Faixa fonte={m.fonte} />
      <div className="piloto-obra-head">
        <div className="piloto-obra-titulo"><h1>Obras compacto</h1><Chips m={m} /></div>
        <div className="piloto-obra-visoes" role="tablist" aria-label="Visão">
          {VISOES.map((v) => <button key={v.id} type="button" role="tab" aria-selected={visao === v.id} className={`btn sm ${visao === v.id ? 'primary' : ''}`} title={v.descricao} onClick={() => setVisao(v.id)}>{v.rotulo}</button>)}
        </div>
      </div>
      {!m.carteiraCompleta && <div className="piloto-obra-aviso small muted">Conjunto parcial: {m.obras.length} obra(s) visível(is). Agregados da carteira inteira não são apresentados.</div>}

      <section aria-label="Situação" className={`piloto-obra-situacao cols-${m.situacao.length}`}>
        {m.situacao.map((s) => <Tile key={s.id} item={s} aberto={!!s.composicaoId && composicao === s.composicaoId} onComposicao={s.composicaoId ? () => alternar(s.composicaoId!) : undefined} />)}
      </section>

      <section className="card piloto-obra-bloco" aria-label="Obras">
        <div className="piloto-obra-bloco-head"><h3 className="piloto-obra-secao">Obras <span className="muted">· {m.obras.length}</span></h3><Link to="/obras" className="piloto-obra-link">Ver obras</Link></div>
        <ul className="piloto-obra-lista">{m.obras.map((o) => <LinhaDeObra key={o.codigo} o={o} visao={visao} composicao={composicao} alternar={alternar} />)}</ul>
      </section>

      <section className="card piloto-obra-bloco" aria-label="Atenção">
        <div className="piloto-obra-bloco-head">
          <h3 className="piloto-obra-secao">Atenção <span className="muted">· {m.atencao.todas.length}</span></h3>
          {m.atencao.ocultas > 0 && !todas && <button type="button" className="piloto-obra-link" onClick={() => setTodas(true)}>Ver todas (+{m.atencao.ocultas})</button>}
          {todas && m.atencao.ocultas > 0 && <button type="button" className="piloto-obra-link" onClick={() => setTodas(false)}>Só as principais</button>}
        </div>
        {grupos.length === 0 ? <div className="empty">Nada exige atenção nas obras visíveis.</div> : grupos.map((g) => <Grupo key={g.severidade} g={g} composicao={composicao} alternar={alternar} />)}
        {m.atencao.semClassificacao.length > 0 && (
          <div className="piloto-obra-grupo">
            <div className="piloto-obra-grupo-head">Sem classificação canônica <span className="muted">· {m.atencao.semClassificacao.length}</span></div>
            <ul className="piloto-obra-lista">{m.atencao.semClassificacao.map((a) => <LinhaAtencao key={a.id} a={a} aberta={!!a.composicaoId && composicao === a.composicaoId} onComposicao={a.composicaoId ? () => alternar(a.composicaoId!) : undefined} />)}</ul>
          </div>
        )}
      </section>

      <Rodape m={m} />
      {comp && <Gaveta c={comp} onFechar={fechar} />}
    </div>
  );
}
