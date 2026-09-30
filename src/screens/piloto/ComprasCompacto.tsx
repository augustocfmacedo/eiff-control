// UX-P05/UX-P06 — Compras compacto: tela do piloto (somente leitura, sem store), integrada em #/piloto/compras.
//
// Recebe uma `EntradaCompras` ja resolvida pelo App (`entradaDoApp` sobre Dataset, usuario, sync e o conjunto de obras
// visiveis que o App calcula pela regra oficial; a fixture existe so nos testes) e apresenta o modelo
// puro de `montarCompras`. A tela nao decide nada de compras nem de visibilidade: so apresenta. Blocos: cabecalho com
// microfrescor e sincronizacao (separados) → SITUACAO (3 ou 4 tiles conforme a visao, sem cor de severidade) → OBRAS
// (Diretoria) ou PEDIDOS EM ABERTO (Operacao) → PENDENCIAS (fatos neutros, sem classificacao) → COMPOSICAO em gaveta
// lateral, so quando pedida. Acoes: apenas leitura e navegacao para telas que ja existem.
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, EstadoErro, Link, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { Valor } from '../../ui/motion';
import { fmtBr } from '../../core/engine';
import { ROTULO_PENDENCIA, ROTULO_SINCRONIZACAO, VERSAO_PILOTO, VISOES, moeda, montarCompras, pct, textoEntrega, type Composicao, type EntradaCompras, type ItemPendencia, type ItemSituacao, type LinhaObraCompras, type LinhaPedido, type ModeloCompras, type Visao } from './comprasCompactoModel';
import './pilotoCompras.css';

const dataHoraCurta = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
type ModeloComFrescor = Extract<ModeloCompras, { estado: 'pronto' | 'vazio' | 'sem-visibilidade' }>;

/** Modo local: o seed nao e a operacao real, e a tela diz isso; em modo remoto nao renderiza nada. */
function Faixa({ fonte }: { fonte: ModeloCompras['fonte'] }) {
  if (fonte.modo === 'local') return <div className="piloto-compra-faixa" role="note"><Icon name="aviso" size={13} /><b>Modo local</b><span>dados do seed · não são a operação real</span></div>;
  return null;
}

function ChipSync({ fonte }: { fonte: ModeloCompras['fonte'] }) {
  const s = fonte.sincronizacao;
  if (!s) return null;
  const sufixo = s.estado === 'sincronizado' ? dataHoraCurta(s.em) : s.estado === 'pendente' && s.desde ? `desde ${dataHoraCurta(s.desde)}` : '';
  return <span className={`piloto-compra-chip ${s.estado === 'erro' ? 'sync-erro' : s.estado === 'pendente' ? 'sync-pendente' : ''}`} title={s.msg ?? 'Estado de sincronização do aplicativo'} aria-label="Sincronização">{ROTULO_SINCRONIZACAO[s.estado]}{sufixo ? ` ${sufixo}` : ''}</span>;
}

function Chips({ m }: { m: ModeloComFrescor }) {
  return (
    <div className="piloto-compra-chips" aria-label="Frescor e sincronização dos dados">
      {m.frescor.chips.map((c) => <span key={c.id} className="piloto-compra-chip" title={c.titulo}>{c.texto}</span>)}
      <ChipSync fonte={m.fonte} />
    </div>
  );
}

function Tile({ item, aberto, onComposicao }: { item: ItemSituacao; aberto: boolean; onComposicao?: () => void }) {
  const clicavel = !!item.composicaoId && !!onComposicao;
  return (
    <div className={`piloto-compra-tile ${aberto ? 'aberto' : ''} ${clicavel ? 'clicavel' : ''}`} onClick={clicavel ? onComposicao : undefined} role={clicavel ? 'button' : undefined} tabIndex={clicavel ? 0 : undefined} onKeyDown={clicavel ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onComposicao!(); } } : undefined} aria-expanded={clicavel ? aberto : undefined} title={item.origem.regra}>
      <div className="piloto-compra-tile-label">{item.rotulo}</div>
      <div className={`piloto-compra-tile-valor ${item.valor === null ? 'ausente' : ''}`}>{item.valor === null ? item.texto : <Valor v={item.texto} />}</div>
      {item.micro && <div className="piloto-compra-tile-micro">{item.micro}</div>}
      {item.partes.length > 0 && <div className="piloto-compra-tile-partes">{item.partes.map((p) => <div key={p.rotulo}><span className="piloto-compra-k">{p.rotulo}</span><span className={`piloto-compra-v ${p.valor === null ? 'ausente' : ''}`}>{p.texto}</span></div>)}</div>}
      {clicavel && <span className="piloto-compra-tile-acao">{aberto ? 'Fechar composição' : 'Ver composição'}</span>}
    </div>
  );
}

function LinhaDeObra({ o, composicao, alternar }: { o: LinhaObraCompras; composicao: string | null; alternar: (id: string) => void }) {
  return (
    <li className="piloto-compra-linha">
      <div className="piloto-compra-linha-nome">
        <div className="piloto-compra-linha-titulo"><Link to={`/obras/${o.codigo}`}>{o.nome}</Link><Badge tone="muted">{o.status}</Badge></div>
        <div className="piloto-compra-linha-sub">{o.codigo} · {o.pedidos} pedido(s) · {o.rascunhos} rascunho(s)</div>
      </div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">Pedidos emitidos</span><span className="piloto-compra-v">{moeda(o.emitido)}</span></div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">A receber</span><span className="piloto-compra-v">{moeda(o.aReceber)}</span></div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">Atrasados · aprovação</span><span className="piloto-compra-v">{o.atrasados} · {o.aguardandoAprovacao}</span></div>
      <div className="piloto-compra-linha-acoes">
        {o.composicoes.map((c) => <button key={c.id} type="button" className={`piloto-compra-link ${composicao === c.id ? 'ativo' : ''}`} aria-expanded={composicao === c.id} onClick={() => alternar(c.id)}>{c.rotulo}</button>)}
        <Link to={o.to} className="piloto-compra-link">Ver compras da obra</Link>
      </div>
    </li>
  );
}

const textoLancamento = (l: LinhaPedido['lancamento']) => (l === undefined ? 'sem lançamento' : l === null ? 'lançamento não encontrado' : `lançamento ${l.status}`);

function LinhaDePedido({ p, composicao, alternar }: { p: LinhaPedido; composicao: string | null; alternar: (id: string) => void }) {
  const aberto = composicao === p.composicaoId;
  return (
    <li className={`piloto-compra-linha ${aberto ? 'aberto' : ''}`}>
      <div className="piloto-compra-linha-nome">
        <div className="piloto-compra-linha-titulo"><span>{p.codigo} · {p.fornecedor}</span><Badge tone="muted">{p.status}</Badge>{p.faturamentoDireto && <Badge tone="muted">faturamento direto</Badge>}</div>
        <div className="piloto-compra-linha-sub">{p.codigoObra} · {textoEntrega(p.previsaoEntrega, p.diasParaEntrega)} · {textoLancamento(p.lancamento)} · criado por {p.criadoPor.nome ?? `usuário não encontrado (${p.criadoPor.id})`}</div>
      </div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">Total</span><span className="piloto-compra-v">{moeda(p.total)}</span></div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">Recebido</span><span className="piloto-compra-v">{moeda(p.totalRecebido)} · {pct(p.pctRecebido)}</span></div>
      <div className="piloto-compra-linha-num"><span className="piloto-compra-k">Itens com saldo</span><span className="piloto-compra-v">{p.itensComSaldo} de {p.itens}</span></div>
      <div className="piloto-compra-linha-acoes">
        <button type="button" className={`piloto-compra-link ${aberto ? 'ativo' : ''}`} aria-expanded={aberto} onClick={() => alternar(p.composicaoId)}>{aberto ? 'Fechar' : 'Ver pedido'}</button>
        <Link to={p.to} className="piloto-compra-link">Ver compras da obra</Link>
      </div>
    </li>
  );
}

function LinhaPendencia({ a, aberta, onComposicao }: { a: ItemPendencia; aberta: boolean; onComposicao?: () => void }) {
  return (
    <li className={`piloto-compra-item ${aberta ? 'aberto' : ''}`}>
      <div className="piloto-compra-item-texto">
        <div className="piloto-compra-item-tipo">{ROTULO_PENDENCIA[a.tipo]}{a.tom && <span className={`piloto-compra-sinal ${a.tom}`} title="Tom atribuído pela sugestão do core">sinalizado pelo sistema</span>}</div>
        <div className="piloto-compra-item-oque">{a.texto}</div>
        {a.detalhe && <div className="piloto-compra-item-detalhe">{a.detalhe}</div>}
      </div>
      <div className="piloto-compra-item-impacto">{a.impacto}</div>
      <div className="piloto-compra-item-acoes">
        {a.composicaoId && onComposicao && <button type="button" className="piloto-compra-link" aria-expanded={aberta} onClick={onComposicao}>{aberta ? 'Fechar' : 'Ver composição'}</button>}
        {a.destino && <Link to={a.destino.to} className="piloto-compra-link">{a.destino.rotulo}</Link>}
      </div>
    </li>
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
      <div className="piloto-compra-veu" onClick={onFechar} aria-hidden="true" />
      <aside className="piloto-compra-gaveta" role="dialog" aria-modal="true" aria-label={`Composição: ${c.titulo}`}>
        <div className="piloto-compra-gaveta-head">
          <div><div className="piloto-compra-k">Composição</div><h2>{c.titulo}</h2><div className="small muted">{c.resumo}</div></div>
          <button type="button" className="btn sm" onClick={onFechar} aria-label="Fechar composição">Fechar</button>
        </div>
        {c.pares.length > 0 && (
          <dl className="piloto-compra-pares">
            {c.pares.map((p) => (
              <div key={p.rotulo}>
                <dt className="piloto-compra-k">{p.rotulo}</dt>
                <dd><span className="piloto-compra-par-texto">{p.to ? <Link to={p.to}>{p.texto}</Link> : p.texto}</span>{p.sub && <span className="small muted">{p.sub}</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        {c.linhas.length === 0 ? <div className="empty">Nenhuma linha compõe este bloco.</div> : (
          <table className="piloto-compra-tabela">
            <thead><tr>{c.colunas.map((col, i) => <th key={`${col.titulo}-${i}`} className={col.num ? 'num' : ''}>{col.titulo}</th>)}</tr></thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={l.id}>
                  <td><div className="piloto-compra-linha-titulo">{l.to ? <Link to={l.to}>{l.titulo}</Link> : l.titulo}</div>{l.sub && <div className="small muted">{l.sub}</div>}</td>
                  <td>{l.data ? fmtBr(l.data) : <span className="muted">—</span>}</td>
                  <td className="num">{l.texto}</td>
                </tr>
              ))}
            </tbody>
            {c.total && <tfoot><tr className="total"><td colSpan={2}>{c.total.rotulo}</td><td className="num">{c.total.texto}</td></tr></tfoot>}
          </table>
        )}
        {c.nota && <div className="piloto-compra-nota small">{c.nota}</div>}
        <div className="piloto-compra-origem">
          <div className="piloto-compra-origem-linha"><span className="piloto-compra-k">Origem</span><code>{c.origem.funcao}</code><code>{c.origem.campo}</code></div>
          <div className="small muted">{c.origem.regra}</div>
          {c.origem.tela && <Link to={c.origem.tela} className="piloto-compra-link">Ver origem no EIFF Control</Link>}
        </div>
      </aside>
    </>
  );
}

function Rodape({ m }: { m: ModeloComFrescor }) {
  const f = m.frescor;
  return <footer className="piloto-compra-rodape small muted" aria-label="Origem e período">Fonte {m.fonte.rotulo}{f.fonteAtualizadaEm ? ` · ${dataHoraCurta(f.fonteAtualizadaEm)}` : m.fonte.modo === 'remoto' ? ' · atualização desconhecida' : ''} · data-base {fmtBr(f.dataBase)} · piloto {VERSAO_PILOTO}</footer>;
}

export default function ComprasCompacto({ entrada, composicaoInicial = null, visaoInicial }: { entrada: EntradaCompras; composicaoInicial?: string | null; visaoInicial?: Visao }) {
  const [visao, setVisao] = useState<Visao>(visaoInicial ?? (entrada.estado === 'pronto' ? entrada.visao ?? 'diretoria' : 'diretoria'));
  const m = useMemo(() => montarCompras(entrada.estado === 'pronto' ? { ...entrada, visao } : entrada), [entrada, visao]);
  const [composicao, setComposicao] = useState<string | null>(composicaoInicial);
  const [todas, setTodas] = useState(false);
  const [todosPedidos, setTodosPedidos] = useState(false);
  const alternar = (id: string) => setComposicao((atual) => (atual === id ? null : id));
  const fechar = () => setComposicao(null);

  if (m.estado === 'carregando') {
    return (
      <div className="piloto-compra" aria-busy="true" aria-label="Carregando">
        <Faixa fonte={m.fonte} />
        <div className="piloto-compra-head"><h1>Compras compacto</h1><div className="piloto-compra-chips"><Skeleton w={70} h={18} r={9} /><Skeleton w={130} h={18} r={9} /><Skeleton w={110} h={18} r={9} /></div></div>
        <div className="piloto-compra-situacao cols-3">{[0, 1, 2].map((i) => <div key={i} className="piloto-compra-tile"><Skeleton w={110} h={9} /><Skeleton w="65%" h={24} style={{ marginTop: 8 }} /><Skeleton w="80%" h={9} style={{ marginTop: 10 }} /></div>)}</div>
        <div className="card piloto-compra-bloco"><Skeleton w={60} h={9} />{[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={14} style={{ marginTop: 10 }} />)}</div>
      </div>
    );
  }
  if (m.estado === 'erro') {
    return (
      <div className="piloto-compra">
        <Faixa fonte={m.fonte} />
        <div className="piloto-compra-head"><h1>Compras compacto</h1></div>
        <EstadoErro titulo="Dados de compras indisponíveis" causa={<>{m.mensagem}{m.causa && <> · <code>{m.causa}</code></>}</>}>Nada foi alterado; nenhum número é mostrado para não confundir ausência com zero.</EstadoErro>
      </div>
    );
  }
  if (m.estado === 'vazio' || m.estado === 'sem-visibilidade') {
    return (
      <div className="piloto-compra">
        <Faixa fonte={m.fonte} />
        <div className="piloto-compra-head"><h1>Compras compacto</h1><Chips m={m} /></div>
        <Empty icone="compras" titulo={m.estado === 'vazio' ? (m.semObras ? 'Sem obras cadastradas' : 'Sem pedidos de compra') : 'Nenhuma obra visível'}>{m.motivo}{m.estado === 'sem-visibilidade' ? ` Obras cadastradas: ${m.totalObras}.` : ''}</Empty>
        <Rodape m={m} />
      </div>
    );
  }

  const pendencias = todas ? m.pendencias.todas : m.pendencias.compacta;
  const pedidos = todosPedidos ? m.pedidos.todos : m.pedidos.compacta;
  const comp = composicao ? m.composicoes[composicao] : undefined;
  return (
    <div className="piloto-compra">
      <Faixa fonte={m.fonte} />
      <div className="piloto-compra-head">
        <div className="piloto-compra-titulo"><h1>Compras compacto</h1><Chips m={m} /></div>
        <div className="piloto-compra-visoes" role="tablist" aria-label="Visão">
          {VISOES.map((v) => <button key={v.id} type="button" role="tab" aria-selected={visao === v.id} className={`btn sm ${visao === v.id ? 'primary' : ''}`} title={v.descricao} onClick={() => setVisao(v.id)}>{v.rotulo}</button>)}
        </div>
      </div>
      {!m.carteiraCompleta && <div className="piloto-compra-aviso small muted">Conjunto parcial: {m.obrasNoConjunto} de {m.totalObras} obra(s) visível(is). Valores da carteira inteira e estoque global não são apresentados.</div>}

      <section aria-label="Situação" className={`piloto-compra-situacao cols-${m.situacao.length}`}>
        {m.situacao.map((s) => <Tile key={s.id} item={s} aberto={!!s.composicaoId && composicao === s.composicaoId} onComposicao={s.composicaoId ? () => alternar(s.composicaoId!) : undefined} />)}
      </section>

      {visao === 'diretoria' ? (
        <section className="card piloto-compra-bloco" aria-label="Obras">
          <div className="piloto-compra-bloco-head"><h3 className="piloto-compra-secao">Obras com pedidos <span className="muted">· {m.obras.length}</span></h3><Link to="/compras" className="piloto-compra-link">Ver compras</Link></div>
          <ul className="piloto-compra-lista">{m.obras.map((o) => <LinhaDeObra key={o.codigo} o={o} composicao={composicao} alternar={alternar} />)}</ul>
        </section>
      ) : (
        <section className="card piloto-compra-bloco" aria-label="Pedidos em aberto">
          <div className="piloto-compra-bloco-head">
            <h3 className="piloto-compra-secao">Pedidos em aberto <span className="muted">· {m.pedidos.todos.length}</span></h3>
            {m.pedidos.ocultos > 0 && <button type="button" className="piloto-compra-link" onClick={() => setTodosPedidos(!todosPedidos)}>{todosPedidos ? 'Só os primeiros' : `Ver todos (+${m.pedidos.ocultos})`}</button>}
          </div>
          {pedidos.length === 0 ? <div className="empty">Nenhum pedido em aberto nas obras visíveis.</div> : <ul className="piloto-compra-lista">{pedidos.map((p) => <LinhaDePedido key={p.id} p={p} composicao={composicao} alternar={alternar} />)}</ul>}
          <div className="small muted piloto-compra-legenda">Ordem por previsão de entrega; sem previsão por último. A ordem não é prioridade.</div>
        </section>
      )}

      <section className="card piloto-compra-bloco" aria-label="Pendências">
        <div className="piloto-compra-bloco-head">
          <h3 className="piloto-compra-secao">Pendências <span className="muted">· {m.pendencias.todas.length}</span></h3>
          {m.pendencias.ocultas > 0 && <button type="button" className="piloto-compra-link" onClick={() => setTodas(!todas)}>{todas ? 'Só as primeiras' : `Ver todas (+${m.pendencias.ocultas})`}</button>}
        </div>
        {pendencias.length === 0 ? <div className="empty">Nenhuma pendência de compras nas obras visíveis.</div> : <ul className="piloto-compra-lista">{pendencias.map((a) => <LinhaPendencia key={a.id} a={a} aberta={!!a.composicaoId && composicao === a.composicaoId} onComposicao={a.composicaoId ? () => alternar(a.composicaoId!) : undefined} />)}</ul>}
        <div className="small muted piloto-compra-legenda">Fatos do fluxo de compras, sem classificação de severidade: o sistema ainda não define uma para compras.{m.estoque.visivel ? '' : ` ${m.estoque.motivo}.`}</div>
      </section>

      <Rodape m={m} />
      {comp && <Gaveta c={comp} onFechar={fechar} />}
    </div>
  );
}
