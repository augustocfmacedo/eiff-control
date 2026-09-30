// MC-LIVE-2A — Mission Control Operational V0: o quadro para acompanhar a producao em paralelo.
//
// A tela OBSERVA. Nao ha drag-and-drop, nao ha botao que mova task, nao ha escrita: o unico caminho e
//   GitHub / Factory -> adapter -> normalizacao -> MissionControlWorkItem -> montarQuadro -> aqui.
// Status normalizado vem pronto de `workItem.ts` e o estado CRU da fonte viaja junto, sempre visivel.
//
// Atualizacao: o MESMO polling da MC-LIVE-1 (60 s com backoff), recebido por prop — a tela nao cria um
// segundo relogio. Trocar isso por realtime depois e substituir a origem de `estado`, sem mexer no quadro.
import React, { useMemo, useState } from 'react';
import {
  COLUNAS_QUADRO, ESCOPOS_QUADRO, FILTRO_VAZIO, ROTULO_FACTORY_VIA_GITHUB, STATUS_DESTAQUE, ciDoItem,
  SEM_EVIDENCIA_DE_CI, haQuantoTempo, montarQuadro, rotuloProcedenciaDoItem, workstreamsDisponiveis,
  type EscopoQuadro, type FiltroQuadro,
} from '../core/central/quadroOperacional';
import { ROTULO_MC_STATUS, type McStatus, type MissionControlEvent, type MissionControlWorkItem } from '../core/central/workItem';
import {
  ROTULO_CHAVE_CORRELACAO, ROTULO_ELO, ROTULO_ESTADO_ELO, ROTULO_TIPO_EVENTO, dataHoraEvento, diagnosticarCorrelacao,
} from '../core/central/correlacao';
import { LIMITE_STALE_GITHUB_S, avaliarStatusVivo, type SituacaoVivo } from '../core/central/statusVivo';
import { type EstadoStatusRemoto } from '../data/statusRemoto';
import { contagemViva } from '../core/central/construcao';
import { Badge, Empty, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';

const TONE_VIVO: Record<SituacaoVivo, Tone> = { LIVE: 'ok', SNAPSHOT: 'warn', STALE: 'warn', UNAVAILABLE: 'bad' };

const TONE_COLUNA: Partial<Record<McStatus, Tone>> = {
  EXECUTANDO: 'ok', AGUARDANDO_HUMANO: 'warn', BLOQUEADO: 'bad', EM_VALIDACAO: 'info', CONCLUIDO: 'muted',
};

const ROTULO_ESCOPO: Record<EscopoQuadro, string> = { TODOS: 'Todos', ARQUITETURA: 'Arquitetura', FACTORY: 'Factory' };

/**
 * Um elo da cadeia tecnica do cartao (issue, branch, PR, CI). Ausente vira travessao, nunca some.
 * `semValor` explica a AUSENCIA quando ela precisa de explicacao; sem ele, o travessao continua exatamente
 * como era — os demais elos nao mudam.
 */
function Elo({ rotulo, valor, href, semValor }: { rotulo: string; valor?: string; href?: string; semValor?: string }) {
  return (
    <div className="mcq-elo">
      <span className="mcq-elo-rotulo">{rotulo}</span>
      {valor
        ? (href ? <a href={href} target="_blank" rel="noreferrer">{valor}</a> : <span>{valor}</span>)
        : <span className="muted" title={semValor} aria-label={semValor ? `${rotulo}: ${semValor}` : undefined}>—</span>}
    </div>
  );
}

const curto = (url?: string) => {
  if (!url) return undefined;
  const pr = url.match(/\/pull\/(\d+)/);
  if (pr) return `#${pr[1]}`;
  const iss = url.match(/\/issues\/(\d+)/);
  if (iss) return `#${iss[1]}`;
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, '');
};

/**
 * MC-LIVE-3 — a tarefa aberta: cadeia (cada elo confirmado ou com a ausência nomeada) e eventos confirmados.
 * Tudo sai de `diagnosticarCorrelacao`; aqui não se correlaciona nada, só se desenha. Lista em ordem de data,
 * sem linha do tempo (isso é a MC-LIVE-7).
 */
function DetalheTarefa({ i, eventos, agora, onFechar }: { i: MissionControlWorkItem; eventos: readonly MissionControlEvent[]; agora: string; onFechar: () => void }) {
  const d = diagnosticarCorrelacao(i, eventos);
  return (
    <section id="mcq-detalhe" className="mcq-detalhe" aria-label={`Tarefa ${i.correlationId ?? i.sourceId}`}>
      <header className="mcq-detalhe-topo">
        <b className="mcq-id">{i.correlationId ?? i.sourceId}</b>
        <span className="mcq-detalhe-titulo">{i.title}</span>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={onFechar}>Fechar</button>
      </header>
      <p className="small muted">{ROTULO_CHAVE_CORRELACAO[d.chave]} · {d.confirmados} de {d.cadeia.length} elos confirmados</p>

      <div className="mcq-detalhe-grade">
        <div>
          <h3>Cadeia da tarefa</h3>
          <ol className="mcq-cadeia">
            {d.cadeia.map((e) => (
              <li key={e.elo} data-estado={e.estado}>
                <span className="mcq-cadeia-elo">{ROTULO_ELO[e.elo]}</span>
                {e.estado === 'CONFIRMADO'
                  ? (e.href
                    ? <a href={e.href} target="_blank" rel="noreferrer">{curto(e.href) ?? e.valor}</a>
                    : <span className="mcq-cadeia-valor">{e.valor}</span>)
                  : <span className="mcq-cadeia-ausente">{ROTULO_ESTADO_ELO[e.estado]}</span>}
                {e.nota && <span className="mcq-cadeia-nota">{e.nota}</span>}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Eventos confirmados</h3>
          {d.eventos.length
            ? (
              <ul className="mcq-eventos">
                {d.eventos.map((e) => (
                  <li key={e.id}>
                    <b>{ROTULO_TIPO_EVENTO[e.tipo]}</b>
                    <time dateTime={e.ocorridoEm}>{dataHoraEvento(e.ocorridoEm)}{haQuantoTempo(e.ocorridoEm, agora) ? ` · há ${haQuantoTempo(e.ocorridoEm, agora)}` : ''}</time>
                    <span className="mcq-cru" title="O fato bruto da fonte">{e.tipoOrigem}</span>
                  </li>
                ))}
              </ul>
            )
            : <p className="small muted">Nenhum evento com data confirmada pela fonte para este item.</p>}
          <p className="small muted">
            Só entram fatos com data da própria fonte: criação da issue, abertura do pull request e conclusão da tarefa.
            Uma atualização sem fato conhecido não vira evento, e o CI do main não é o CI desta tarefa.
          </p>
        </div>
      </div>
    </section>
  );
}

function Cartao({ i, agora, aberto, onAbrir }: { i: MissionControlWorkItem; agora: string; aberto: boolean; onAbrir: () => void }) {
  const alterado = haQuantoTempo(i.updatedAt, agora);
  const observado = haQuantoTempo(i.frescor.observadoEm, agora);
  return (
    <article
      className="mcq-cartao"
      data-status={i.status}
      data-aberto={aberto || undefined}
      // clicar no cartão abre a tarefa; clicar num link ou botão de dentro segue sendo o link ou o botão
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a, button')) onAbrir(); }}
    >
      <header className="mcq-cartao-topo">
        <button type="button" className="mcq-abrir" aria-expanded={aberto} aria-controls={aberto ? 'mcq-detalhe' : undefined} onClick={onAbrir} title="Abrir a cadeia e os eventos desta tarefa">
          <b className="mcq-id">{i.correlationId ?? i.sourceId}</b>
        </button>
        {i.frescor.fonteIndisponivel
          ? <Badge tone="bad" title="A fonte não respondeu nesta leitura; o conteúdo é o último conhecido">fonte fora</Badge>
          : i.frescor.stale ? <Badge tone="warn" title="Leitura mais velha que o limite aceitável para esta fonte">vencido</Badge> : null}
      </header>

      <div className="mcq-titulo">{i.title}</div>

      <div className="mcq-estado">
        <Badge tone={TONE_COLUNA[i.status]}>{ROTULO_MC_STATUS[i.status]}</Badge>
        <span className="mcq-cru" title="Estado cru da fonte, sempre preservado ao lado do normalizado">{i.statusOrigem}</span>
      </div>

      {i.responsavel && (
        <div className="mcq-resp">
          <Icon name="equipe" size={13} /> {i.responsavel.rotulo}
          {i.responsavel.id && <span className="muted"> · {i.responsavel.id}</span>}
        </div>
      )}

      <div className="mcq-elos">
        <Elo rotulo="Issue" valor={curto(i.links?.issue)} href={i.links?.issue} />
        <Elo rotulo="Branch" valor={i.links?.branch} />
        <Elo rotulo="PR" valor={curto(i.links?.pullRequest)} href={i.links?.pullRequest} />
        <Elo rotulo="CI" valor={ciDoItem(i)} semValor={SEM_EVIDENCIA_DE_CI} />
      </div>

      {i.bloqueio && (
        <div className={`mcq-bloqueio${i.bloqueio.porDesenho ? ' por-desenho' : ''}`}>
          <Icon name="alerta" size={13} /> {i.bloqueio.porDesenho ? 'Bloqueado de propósito: ' : 'Bloqueado: '}{i.bloqueio.motivo}
        </div>
      )}

      <footer className="mcq-rodape small muted">
        <span title="Quando o estado mudou NA FONTE">Alterado: {alterado ?? '—'}</span>
        <span title="Quando NÓS lemos a fonte pela última vez com sucesso">Observado: {observado ?? '—'}</span>
        <span title="Por onde este dado chegou até a tela">{rotuloProcedenciaDoItem(i)}</span>
      </footer>
    </article>
  );
}

export default function QuadroOperacional({ estado }: { estado: EstadoStatusRemoto & { recarregar: () => void } }) {
  const { dados, recebidoEm, carregando, erro, recarregar } = estado;
  const [filtro, setFiltro] = useState<FiltroQuadro>(FILTRO_VAZIO);
  const [aberto, setAberto] = useState<string | null>(null);
  const agora = new Date().toISOString();
  const itens = useMemo(() => dados?.workItems ?? [], [dados]);
  const quadro = useMemo(() => montarQuadro(itens, filtro), [itens, filtro]);
  const workstreams = useMemo(() => workstreamsDisponiveis(itens), [itens]);
  // MC-LIVE-3: os eventos vêm da MESMA leitura (`/api/development-status`); nenhuma chamada por cartão
  const eventos = useMemo(() => dados?.events ?? [], [dados]);
  const itemAberto = aberto ? itens.find((i) => i.id === aberto) : undefined;
  const alternar = (id: string) => setAberto((a) => (a === id ? null : id));

  const fonte = dados?.fontes.github;
  const primeiraLeitura = !dados && !erro;
  const vivo = avaliarStatusVivo({
    disponivel: !!fonte?.disponivel && !erro,
    erroCodigo: fonte?.erroCodigo,
    observadoEm: fonte?.observadoEm ?? recebidoEm,
    agora,
    limiteStaleSegundos: dados?.limiteStaleSegundos ?? LIMITE_STALE_GITHUB_S,
    build: dados?.build,
    shaMainObservado: dados?.repositorios.find((r) => r.papel === 'produto')?.main?.sha ?? null,
  });

  const mudar = (p: Partial<FiltroQuadro>) => setFiltro((f) => ({ ...f, ...p }));
  // V2A: a MESMA regra da Visão geral — sem leitura válida, contagem viva é "—", nunca 0 (zero é dado)
  const leituraValida = !!dados;
  const viva = (n: number) => contagemViva(leituraValida, n);

  return (
    <div className="card mcq" data-tour="mc-quadro">
      <div className="mcq-topo">
        <h2>Quadro operacional</h2>
        {primeiraLeitura
          ? <Badge tone="muted">Lendo…</Badge>
          : <Badge tone={TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>GitHub: {vivo.rotulo}</Badge>}
        <Badge tone="muted" title={dados?.factory.aviso}>Factory: {ROTULO_FACTORY_VIA_GITHUB}</Badge>
        <span className="spacer" />
        <span className="small muted">Última atualização: {haQuantoTempo(recebidoEm ?? undefined, agora) ?? '—'}</span>
        <button className="btn small no-print" onClick={recarregar} disabled={carregando}>
          <Icon name="checks" size={14} /> {carregando ? 'Lendo…' : 'Atualizar'}
        </button>
      </div>

      <div className="mcq-contadores">
        {STATUS_DESTAQUE.map((s) => (
          <button
            key={s}
            className={`mcq-contador${filtro.status === s ? ' ativo' : ''}`}
            aria-pressed={filtro.status === s}
            onClick={() => mudar({ status: filtro.status === s ? undefined : s })}
          >
            <span className="mcq-contador-n">{viva(quadro.contagens[s])}</span>
            <span className="mcq-contador-r">{ROTULO_MC_STATUS[s]}</span>
          </button>
        ))}
      </div>

      {erro && dados && <p className="small muted">O quadro abaixo é o último estado conhecido.</p>}
      {(quadro.stale > 0 || quadro.fonteIndisponivel > 0) && (
        <p className="small muted">{quadro.fonteIndisponivel > 0 && `${quadro.fonteIndisponivel} item(ns) de fonte que não respondeu. `}{quadro.stale > 0 && `${quadro.stale} item(ns) com leitura vencida.`}</p>
      )}

      <div className="mcq-filtros no-print">
        <div className="mcq-chips" role="group" aria-label="Escopo">
          {ESCOPOS_QUADRO.map((e) => (
            <button key={e} className={`btn sm${filtro.escopo === e ? ' primary' : ''}`} aria-pressed={filtro.escopo === e} onClick={() => mudar({ escopo: e })}>{ROTULO_ESCOPO[e]}</button>
          ))}
        </div>
        {workstreams.length > 0 && (
          <select className="mcq-ws" aria-label="Frente" value={filtro.workstreamId ?? ''} onChange={(ev) => mudar({ workstreamId: ev.target.value || undefined })}>
            <option value="">Todas as frentes</option>
            {workstreams.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        )}
        <input
          className="mcq-busca"
          type="search"
          placeholder="Buscar por taskId ou título"
          aria-label="Buscar por taskId ou título"
          value={filtro.busca ?? ''}
          onChange={(ev) => mudar({ busca: ev.target.value })}
        />
        <span className="small muted">{viva(quadro.visiveis)} de {viva(quadro.totalSemFiltro)}</span>
        {(filtro.escopo !== 'TODOS' || filtro.status || filtro.busca || filtro.workstreamId) && (
          <button className="btn sm" onClick={() => setFiltro(FILTRO_VAZIO)}>Limpar filtros</button>
        )}
      </div>

      {itemAberto && <DetalheTarefa i={itemAberto} eventos={eventos} agora={agora} onFechar={() => setAberto(null)} />}

      {!itens.length
        ? (primeiraLeitura
          ? <p className="small muted">Lendo o estado da produção…</p>
          : leituraValida
            ? <Empty icone="checks" titulo="Nenhum item de trabalho">A leitura chegou, mas nenhuma issue, PR ou gate foi projetado como item de trabalho.</Empty>
            : <p className="small muted">Sem leitura: nenhum item pode ser mostrado.</p>)
        : (
          <div className="mcq-colunas">
            {COLUNAS_QUADRO.map((s) => {
              const col = quadro.colunas.find((c) => c.status === s)!;
              return (
                <section key={s} className="mcq-coluna" aria-label={ROTULO_MC_STATUS[s]}>
                  <header className="mcq-coluna-topo">
                    <Badge tone={TONE_COLUNA[s]}>{ROTULO_MC_STATUS[s]}</Badge>
                    <span className="mcq-coluna-n">{col.total}</span>
                  </header>
                  <div className="mcq-pilha">
                    {col.itens.map((i) => <Cartao key={i.id} i={i} agora={agora} aberto={i.id === aberto} onAbrir={() => alternar(i.id)} />)}
                    {!col.total && <p className="small muted mcq-vazia">—</p>}
                  </div>
                </section>
              );
            })}
          </div>
        )}

      <p className="small muted mcq-rodape-nota">
        Este quadro é uma <b>projeção</b>: ele observa as fontes e não escreve em nenhuma delas. Mover um cartão aqui
        não existe — o estado muda na Factory e no GitHub, e a tela mostra o que mudou.
      </p>
    </div>
  );
}
