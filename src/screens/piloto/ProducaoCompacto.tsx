// UX-P07/UX-P08 — Produção compacto: tela do piloto (somente leitura, sem store), integrada em #/piloto/producao.
//
// Recebe uma `EntradaProducao` ja resolvida pelo App (`entradaDoApp` sobre Dataset, usuario, sync e o conjunto de obras
// visiveis que o App calcula pela regra oficial; a fixture existe so nos testes) e apresenta o modelo
// puro de `montarProducao`. A tela nao decide nada de producao nem de visibilidade: so apresenta. Blocos: cabecalho com
// microfrescor e sincronizacao (separados) → SITUACAO (3 ou 4 tiles conforme a visao, sem cor de severidade;
// fabricacao e montagem em numeros separados) → OBRAS (Diretoria) ou ORDENS ABERTAS (Operacao) → PENDENCIAS (fatos
// neutros; so fontes canonicas mostram o proprio tom) → COMPOSICAO em gaveta lateral, so quando pedida. Acoes: apenas
// leitura e navegacao para telas que ja existem.
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, EstadoErro, Link, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { Valor } from '../../ui/motion';
import { fmtBr } from '../../core/engine';
import { ROTULO_PENDENCIA, ROTULO_SINCRONIZACAO, TEXTO_SEM_LISTA, TEXTO_SEM_ORDENS, VERSAO_PILOTO, VISOES, kg, montarProducao, pct, qtd, textoNecessidade, type Composicao, type EntradaProducao, type ItemPendencia, type ItemSituacao, type LinhaObraProducao, type LinhaOrdem, type ModeloProducao, type ResumoOrdensLinha, type SinalCanonico, type Visao } from './producaoCompactoModel';
import './pilotoProducao.css';

const dataHoraCurta = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
type ModeloComFrescor = Extract<ModeloProducao, { estado: 'pronto' | 'vazio' | 'sem-visibilidade' }>;

/** Modo local: o seed nao e a operacao real, e a tela diz isso; em modo remoto nao renderiza nada. */
function Faixa({ fonte }: { fonte: ModeloProducao['fonte'] }) {
  if (fonte.modo === 'local') return <div className="piloto-producao-faixa" role="note"><Icon name="aviso" size={13} /><b>Modo local</b><span>dados do seed · não são a operação real</span></div>;
  return null;
}

function ChipSync({ fonte }: { fonte: ModeloProducao['fonte'] }) {
  const s = fonte.sincronizacao;
  if (!s) return null;
  const sufixo = s.estado === 'sincronizado' ? dataHoraCurta(s.em) : s.estado === 'pendente' && s.desde ? `desde ${dataHoraCurta(s.desde)}` : '';
  return <span className={`piloto-producao-chip ${s.estado === 'erro' ? 'sync-erro' : s.estado === 'pendente' ? 'sync-pendente' : ''}`} title={s.msg ?? 'Estado de sincronização do aplicativo'} aria-label="Sincronização">{ROTULO_SINCRONIZACAO[s.estado]}{sufixo ? ` ${sufixo}` : ''}</span>;
}

function Chips({ m }: { m: ModeloComFrescor }) {
  return (
    <div className="piloto-producao-chips" aria-label="Frescor e sincronização dos dados">
      {m.frescor.chips.map((c) => <span key={c.id} className="piloto-producao-chip" title={c.titulo}>{c.texto}</span>)}
      <ChipSync fonte={m.fonte} />
    </div>
  );
}

/** Tom de uma fonte canonica, preservado 1:1. Sugestao usa o proprio tom do core; check e analise mostram o texto do core, sem cor. */
function Sinal({ s }: { s: SinalCanonico }) {
  if (s.fonte === 'sugestao') return <span className={`piloto-producao-sinal ${s.valor}`} title="Tom atribuído pela sugestão do core">sugestão do sistema · {s.valor}</span>;
  if (s.fonte === 'check') return <span className="piloto-producao-sinal" title="Status do check do motor">check do sistema · {s.valor}</span>;
  return <span className="piloto-producao-sinal" title="Sinal do ponto da análise da obra">análise da obra · {s.valor}</span>;
}

function Tile({ item, aberto, onComposicao }: { item: ItemSituacao; aberto: boolean; onComposicao?: () => void }) {
  const clicavel = !!item.composicaoId && !!onComposicao;
  const dividido = item.numeros.length > 1;
  return (
    <div className={`piloto-producao-tile ${aberto ? 'aberto' : ''} ${clicavel ? 'clicavel' : ''}`} onClick={clicavel ? onComposicao : undefined} role={clicavel ? 'button' : undefined} tabIndex={clicavel ? 0 : undefined} onKeyDown={clicavel ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onComposicao!(); } } : undefined} aria-expanded={clicavel ? aberto : undefined} title={item.origem.regra}>
      <div className="piloto-producao-tile-label">{item.rotulo}</div>
      {dividido ? (
        <div className="piloto-producao-tile-divididos">
          {item.numeros.map((x) => (
            <div key={x.rotulo}>
              <span className="piloto-producao-k">{x.rotulo}</span>
              <span className={`piloto-producao-tile-valor ${x.valor === null ? 'ausente' : ''}`}>{x.valor === null ? x.texto : <Valor v={x.texto} />}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={`piloto-producao-tile-valor ${item.numeros[0].valor === null ? 'ausente' : ''}`}>{item.numeros[0].valor === null ? item.numeros[0].texto : <Valor v={item.numeros[0].texto} />}</div>
      )}
      <div className="piloto-producao-tile-micro">{item.micro}</div>
      {item.partes.length > 0 && <div className="piloto-producao-tile-partes">{item.partes.map((p) => <div key={p.rotulo}><span className="piloto-producao-k">{p.rotulo}</span><span className={`piloto-producao-v ${p.valor === null ? 'ausente' : ''}`}>{p.texto}</span></div>)}</div>}
      {clicavel && <span className="piloto-producao-tile-acao">{aberto ? 'Fechar composição' : 'Ver composição'}</span>}
    </div>
  );
}

const textoOrdens = (r: ResumoOrdensLinha | null, campo: 'atrasadas' | 'emAndamento') => (r ? String(r[campo]) : TEXTO_SEM_ORDENS);

function LinhaDeObra({ o, composicao, alternar }: { o: LinhaObraProducao; composicao: string | null; alternar: (id: string) => void }) {
  return (
    <li className="piloto-producao-linha">
      <div className="piloto-producao-linha-nome">
        <div className="piloto-producao-linha-titulo"><Link to={`/obras/${o.codigo}`}>{o.nome}</Link><Badge tone="muted">{o.status}</Badge></div>
        <div className="piloto-producao-linha-sub">{o.codigo} · {o.responsavel ? `responsável da obra ${o.responsavel}` : 'responsável da obra não registrado'} · {o.servicos.total} serviço(s), {o.servicos.atrasados} atrasado(s), {o.servicos.emRisco} em risco</div>
      </div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Peso fabricado</span><span className={`piloto-producao-v ${o.peso ? '' : 'ausente'}`}>{o.peso ? `${kg(o.peso.fabricado)} · ${pct(o.peso.pctFabricado)}` : TEXTO_SEM_LISTA}</span></div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Peso montado</span><span className={`piloto-producao-v ${o.peso ? '' : 'ausente'}`}>{o.peso ? `${kg(o.peso.montado)} · ${pct(o.peso.pctMontado)}` : TEXTO_SEM_LISTA}</span></div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Atrasadas · fab. / mont.</span><span className="piloto-producao-v">{textoOrdens(o.fabricacao, 'atrasadas')} / {textoOrdens(o.montagem, 'atrasadas')}</span></div>
      <div className="piloto-producao-linha-acoes">
        {o.composicoes.map((c) => <button key={c.id} type="button" className={`piloto-producao-link ${composicao === c.id ? 'ativo' : ''}`} aria-expanded={composicao === c.id} onClick={() => alternar(c.id)}>{c.rotulo}</button>)}
        <Link to={o.to} className="piloto-producao-link">Ver produção da obra</Link>
      </div>
    </li>
  );
}

function LinhaDeOrdem({ l, composicao, alternar }: { l: LinhaOrdem; composicao: string | null; alternar: (id: string) => void }) {
  const aberto = composicao === l.composicaoId;
  return (
    <li className={`piloto-producao-linha ${aberto ? 'aberto' : ''}`}>
      <div className="piloto-producao-linha-nome">
        <div className="piloto-producao-linha-titulo"><span>{l.codigo} · {l.descricao}</span><Badge tone="muted">{l.tipo}</Badge><Badge tone="muted">{l.status}</Badge></div>
        <div className="piloto-producao-linha-sub">{l.codigoObra}{l.servico ? ` · ${l.servico}` : ' · sem serviço'} · {l.etapaAtual ? `etapa ${l.etapaAtual}` : 'sem etapa em aberto'} · {l.responsavelEtapa ? `responsável da etapa ${l.responsavelEtapa}` : 'responsável da etapa não registrado'}</div>
      </div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Necessidade</span><span className={`piloto-producao-v ${l.dataNecessidade ? '' : 'ausente'}`}>{textoNecessidade(l.dataNecessidade, l.diasParaNecessidade, l.status)}</span></div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Por etapas</span><span className="piloto-producao-v">{pct(l.pctConcluido)} de {l.etapas}</span></div>
      <div className="piloto-producao-linha-num"><span className="piloto-producao-k">Quantidade</span><span className="piloto-producao-v">{qtd(l.quantidade, l.unidade)}</span></div>
      <div className="piloto-producao-linha-acoes">
        <button type="button" className={`piloto-producao-link ${aberto ? 'ativo' : ''}`} aria-expanded={aberto} onClick={() => alternar(l.composicaoId)}>{aberto ? 'Fechar' : 'Ver etapas'}</button>
        <Link to={l.to} className="piloto-producao-link">Ver obra</Link>
      </div>
    </li>
  );
}

function LinhaPendencia({ a, aberta, onComposicao }: { a: ItemPendencia; aberta: boolean; onComposicao?: () => void }) {
  return (
    <li className={`piloto-producao-item ${aberta ? 'aberto' : ''}`}>
      <div className="piloto-producao-item-texto">
        <div className="piloto-producao-item-tipo">{ROTULO_PENDENCIA[a.tipo]}{a.sinal && <Sinal s={a.sinal} />}</div>
        <div className="piloto-producao-item-oque">{a.texto}</div>
        {a.detalhe && <div className="piloto-producao-item-detalhe">{a.detalhe}</div>}
      </div>
      <div className="piloto-producao-item-impacto">{a.impacto}</div>
      <div className="piloto-producao-item-acoes">
        {a.composicaoId && onComposicao && <button type="button" className="piloto-producao-link" aria-expanded={aberta} onClick={onComposicao}>{aberta ? 'Fechar' : 'Ver composição'}</button>}
        {a.destino && <Link to={a.destino.to} className="piloto-producao-link">{a.destino.rotulo}</Link>}
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
      <div className="piloto-producao-veu" onClick={onFechar} aria-hidden="true" />
      <aside className="piloto-producao-gaveta" role="dialog" aria-modal="true" aria-label={`Composição: ${c.titulo}`}>
        <div className="piloto-producao-gaveta-head">
          <div><div className="piloto-producao-k">Composição</div><h2>{c.titulo}</h2><div className="small muted">{c.resumo}</div></div>
          <button type="button" className="btn sm" onClick={onFechar} aria-label="Fechar composição">Fechar</button>
        </div>
        {c.pares.length > 0 && (
          <dl className="piloto-producao-pares">
            {c.pares.map((p, i) => (
              <div key={`${p.rotulo}-${i}`}>
                <dt className="piloto-producao-k">{p.rotulo}</dt>
                <dd><span className="piloto-producao-par-texto">{p.to ? <Link to={p.to}>{p.texto}</Link> : p.texto}{p.sinal && <Sinal s={p.sinal} />}</span>{p.sub && <span className="small muted">{p.sub}</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        {c.linhas.length === 0 ? <div className="empty">Nenhuma linha compõe este bloco.</div> : (
          <table className="piloto-producao-tabela">
            <thead><tr>{c.colunas.map((col, i) => <th key={`${col.titulo}-${i}`} className={col.num ? 'num' : ''}>{col.titulo}</th>)}</tr></thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={l.id}>
                  <td><div className="piloto-producao-linha-titulo">{l.to ? <Link to={l.to}>{l.titulo}</Link> : l.titulo}</div>{l.sub && <div className="small muted">{l.sub}</div>}</td>
                  <td>{l.data ? fmtBr(l.data) : <span className="muted">—</span>}</td>
                  <td className="num">{l.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {c.nota && <div className="piloto-producao-nota small">{c.nota}</div>}
        <div className="piloto-producao-origem">
          <div className="piloto-producao-origem-linha"><span className="piloto-producao-k">Origem</span><code>{c.origem.funcao}</code><code>{c.origem.campo}</code></div>
          <div className="small muted">{c.origem.regra}</div>
          {c.origem.tela && <Link to={c.origem.tela} className="piloto-producao-link">Ver origem no EIFF Control</Link>}
        </div>
      </aside>
    </>
  );
}

function Rodape({ m }: { m: ModeloComFrescor }) {
  const f = m.frescor;
  return <footer className="piloto-producao-rodape small muted" aria-label="Origem e período">Fonte {m.fonte.rotulo}{f.fonteAtualizadaEm ? ` · ${dataHoraCurta(f.fonteAtualizadaEm)}` : m.fonte.modo === 'remoto' ? ' · atualização desconhecida' : ''} · data-base {fmtBr(f.dataBase)} · piloto {VERSAO_PILOTO}</footer>;
}

export default function ProducaoCompacto({ entrada, composicaoInicial = null, visaoInicial }: { entrada: EntradaProducao; composicaoInicial?: string | null; visaoInicial?: Visao }) {
  const [visao, setVisao] = useState<Visao>(visaoInicial ?? (entrada.estado === 'pronto' ? entrada.visao ?? 'diretoria' : 'diretoria'));
  const m = useMemo(() => montarProducao(entrada.estado === 'pronto' ? { ...entrada, visao } : entrada), [entrada, visao]);
  const [composicao, setComposicao] = useState<string | null>(composicaoInicial);
  const [todas, setTodas] = useState(false);
  const [todasOrdens, setTodasOrdens] = useState(false);
  const alternar = (id: string) => setComposicao((atual) => (atual === id ? null : id));
  const fechar = () => setComposicao(null);

  if (m.estado === 'carregando') {
    return (
      <div className="piloto-producao" aria-busy="true" aria-label="Carregando">
        <Faixa fonte={m.fonte} />
        <div className="piloto-producao-head"><h1>Produção compacto</h1><div className="piloto-producao-chips"><Skeleton w={70} h={18} r={9} /><Skeleton w={130} h={18} r={9} /><Skeleton w={110} h={18} r={9} /></div></div>
        <div className="piloto-producao-situacao cols-3">{[0, 1, 2].map((i) => <div key={i} className="piloto-producao-tile"><Skeleton w={110} h={9} /><Skeleton w="65%" h={24} style={{ marginTop: 8 }} /><Skeleton w="80%" h={9} style={{ marginTop: 10 }} /></div>)}</div>
        <div className="card piloto-producao-bloco"><Skeleton w={60} h={9} />{[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={14} style={{ marginTop: 10 }} />)}</div>
      </div>
    );
  }
  if (m.estado === 'erro') {
    return (
      <div className="piloto-producao">
        <Faixa fonte={m.fonte} />
        <div className="piloto-producao-head"><h1>Produção compacto</h1></div>
        <EstadoErro titulo="Dados de produção indisponíveis" causa={<>{m.mensagem}{m.causa && <> · <code>{m.causa}</code></>}</>}>Nada foi alterado; nenhum número é mostrado para não confundir ausência com zero.</EstadoErro>
      </div>
    );
  }
  if (m.estado === 'vazio' || m.estado === 'sem-visibilidade') {
    return (
      <div className="piloto-producao">
        <Faixa fonte={m.fonte} />
        <div className="piloto-producao-head"><h1>Produção compacto</h1><Chips m={m} /></div>
        <Empty icone="fabrica" titulo={m.estado === 'vazio' ? (m.semObras ? 'Sem obras cadastradas' : 'Sem dados de produção') : 'Nenhuma obra visível'}>{m.motivo}{m.estado === 'sem-visibilidade' ? ` Obras cadastradas: ${m.totalObras}.` : ''}</Empty>
        <Rodape m={m} />
      </div>
    );
  }

  const pendencias = todas ? m.pendencias.todas : m.pendencias.compacta;
  const ordens = todasOrdens ? m.ordens.todas : m.ordens.compacta;
  const comp = composicao ? m.composicoes[composicao] : undefined;
  return (
    <div className="piloto-producao">
      <Faixa fonte={m.fonte} />
      <div className="piloto-producao-head">
        <div className="piloto-producao-titulo"><h1>Produção compacto</h1><Chips m={m} /></div>
        <div className="piloto-producao-visoes" role="tablist" aria-label="Visão">
          {VISOES.map((v) => <button key={v.id} type="button" role="tab" aria-selected={visao === v.id} className={`btn sm ${visao === v.id ? 'primary' : ''}`} title={v.descricao} onClick={() => setVisao(v.id)}>{v.rotulo}</button>)}
        </div>
      </div>
      {!m.carteiraCompleta && <div className="piloto-producao-aviso small muted">Conjunto parcial: {m.escopo.obras} de {m.escopo.totalObras} obra(s) visível(is). Os números são das obras visíveis; checks e sugestões globais não são apresentados.</div>}

      <section aria-label="Situação" className={`piloto-producao-situacao cols-${m.situacao.length}`}>
        {m.situacao.map((s) => <Tile key={s.id} item={s} aberto={!!s.composicaoId && composicao === s.composicaoId} onComposicao={s.composicaoId ? () => alternar(s.composicaoId!) : undefined} />)}
      </section>
      {m.composicoes.produtividade && (
        <div className="piloto-producao-apoio small muted">
          Produtividade do período ({fmtBr(m.periodo.de)} a {fmtBr(m.periodo.ate)}) fica na composição: <button type="button" className={`piloto-producao-link ${composicao === 'produtividade' ? 'ativo' : ''}`} aria-expanded={composicao === 'produtividade'} onClick={() => alternar('produtividade')}>kg processado por HH e estações</button>
        </div>
      )}

      {visao === 'diretoria' ? (
        <section className="card piloto-producao-bloco" aria-label="Obras">
          <div className="piloto-producao-bloco-head"><h3 className="piloto-producao-secao">Obras <span className="muted">· {m.obras.length}</span></h3><Link to="/producao" className="piloto-producao-link">Ver fábrica e montagem</Link></div>
          <ul className="piloto-producao-lista">{m.obras.map((o) => <LinhaDeObra key={o.codigo} o={o} composicao={composicao} alternar={alternar} />)}</ul>
        </section>
      ) : (
        <section className="card piloto-producao-bloco" aria-label="Ordens abertas">
          <div className="piloto-producao-bloco-head">
            <h3 className="piloto-producao-secao">Ordens abertas <span className="muted">· {m.ordens.todas.length}</span></h3>
            {m.ordens.ocultas > 0 && <button type="button" className="piloto-producao-link" onClick={() => setTodasOrdens(!todasOrdens)}>{todasOrdens ? 'Só as primeiras' : `Ver todas (+${m.ordens.ocultas})`}</button>}
          </div>
          {ordens.length === 0 ? <div className="empty">Nenhuma ordem aberta nas obras visíveis.</div> : <ul className="piloto-producao-lista">{ordens.map((l) => <LinhaDeOrdem key={l.id} l={l} composicao={composicao} alternar={alternar} />)}</ul>}
          <div className="small muted piloto-producao-legenda">Ordem por data de necessidade; sem data por último. A ordem não é prioridade.</div>
        </section>
      )}

      <section className="card piloto-producao-bloco" aria-label="Pendências">
        <div className="piloto-producao-bloco-head">
          <h3 className="piloto-producao-secao">Pendências <span className="muted">· {m.pendencias.todas.length}</span></h3>
          {m.pendencias.ocultas > 0 && <button type="button" className="piloto-producao-link" onClick={() => setTodas(!todas)}>{todas ? 'Só as primeiras' : `Ver todas (+${m.pendencias.ocultas})`}</button>}
        </div>
        {pendencias.length === 0 ? <div className="empty">Nenhuma pendência de produção nas obras visíveis.</div> : <ul className="piloto-producao-lista">{pendencias.map((a) => <LinhaPendencia key={a.id} a={a} aberta={!!a.composicaoId && composicao === a.composicaoId} onComposicao={a.composicaoId ? () => alternar(a.composicaoId!) : undefined} />)}</ul>}
        <div className="small muted piloto-producao-legenda">Fatos da produção, sem classificação de severidade. Só sugestões, checks e análise do sistema trazem o próprio sinal.</div>
      </section>

      <Rodape m={m} />
      {comp && <Gaveta c={comp} onFechar={fechar} />}
    </div>
  );
}
