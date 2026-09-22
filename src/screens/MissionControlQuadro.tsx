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
  COLUNAS_QUADRO, ESCOPOS_QUADRO, FILTRO_VAZIO, STATUS_DESTAQUE, haQuantoTempo, montarQuadro,
  workstreamsDisponiveis, type EscopoQuadro, type FiltroQuadro,
} from '../core/central/quadroOperacional';
import { ROTULO_MC_STATUS, ROTULO_PROCEDENCIA, type McStatus, type MissionControlWorkItem } from '../core/central/workItem';
import { LIMITE_STALE_GITHUB_S, avaliarStatusVivo, type SituacaoVivo } from '../core/central/statusVivo';
import { TEXTO_CODIGO_CLIENTE, type EstadoStatusRemoto } from '../data/statusRemoto';
import { Badge, Empty, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';

const TONE_VIVO: Record<SituacaoVivo, Tone> = { LIVE: 'ok', SNAPSHOT: 'warn', STALE: 'warn', UNAVAILABLE: 'bad' };

const TONE_COLUNA: Partial<Record<McStatus, Tone>> = {
  EXECUTANDO: 'ok', AGUARDANDO_HUMANO: 'warn', BLOQUEADO: 'bad', EM_VALIDACAO: 'info', CONCLUIDO: 'muted',
};

const ROTULO_ESCOPO: Record<EscopoQuadro, string> = { TODOS: 'Todos', ARQUITETURA: 'Arquitetura', FACTORY: 'Factory' };

/** Um elo da cadeia tecnica do cartao (issue, branch, PR, CI). Ausente vira travessao, nunca some. */
function Elo({ rotulo, valor, href }: { rotulo: string; valor?: string; href?: string }) {
  return (
    <div className="mcq-elo">
      <span className="mcq-elo-rotulo">{rotulo}</span>
      {valor
        ? (href ? <a href={href} target="_blank" rel="noreferrer">{valor}</a> : <span>{valor}</span>)
        : <span className="muted">—</span>}
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

function Cartao({ i, agora }: { i: MissionControlWorkItem; agora: string }) {
  const alterado = haQuantoTempo(i.updatedAt, agora);
  const observado = haQuantoTempo(i.frescor.observadoEm, agora);
  return (
    <article className="mcq-cartao" data-status={i.status}>
      <header className="mcq-cartao-topo">
        <b className="mcq-id">{i.correlationId ?? i.sourceId}</b>
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
        <Elo rotulo="CI" valor={i.status === 'EM_VALIDACAO' ? i.statusOrigem : undefined} />
      </div>

      {i.bloqueio && (
        <div className={`mcq-bloqueio${i.bloqueio.porDesenho ? ' por-desenho' : ''}`}>
          <Icon name="alerta" size={13} /> {i.bloqueio.porDesenho ? 'Bloqueado de propósito: ' : 'Bloqueado: '}{i.bloqueio.motivo}
        </div>
      )}

      <footer className="mcq-rodape small muted">
        <span title="Quando o estado mudou NA FONTE">Alterado: {alterado ?? '—'}</span>
        <span title="Quando NÓS lemos a fonte pela última vez com sucesso">Observado: {observado ?? '—'}</span>
        <span title={ROTULO_PROCEDENCIA[i.procedencia]}>{i.procedencia === 'GITHUB_PROJECTION' ? 'GitHub projection of Factory' : ROTULO_PROCEDENCIA[i.procedencia]}</span>
      </footer>
    </article>
  );
}

export default function QuadroOperacional({ estado }: { estado: EstadoStatusRemoto & { recarregar: () => void } }) {
  const { dados, recebidoEm, carregando, erro, recarregar } = estado;
  const [filtro, setFiltro] = useState<FiltroQuadro>(FILTRO_VAZIO);
  const agora = new Date().toISOString();
  const itens = useMemo(() => dados?.workItems ?? [], [dados]);
  const quadro = useMemo(() => montarQuadro(itens, filtro), [itens, filtro]);
  const workstreams = useMemo(() => workstreamsDisponiveis(itens), [itens]);

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

  return (
    <div className="card mcq" data-tour="mc-quadro">
      <div className="mcq-topo">
        <h2>Quadro operacional</h2>
        {primeiraLeitura
          ? <Badge tone="muted">Lendo…</Badge>
          : <Badge tone={TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>GitHub: {vivo.rotulo}</Badge>}
        <Badge tone="muted" title={dados?.factory.aviso}>Factory: GitHub projection of Factory</Badge>
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
            <span className="mcq-contador-n">{quadro.contagens[s]}</span>
            <span className="mcq-contador-r">{ROTULO_MC_STATUS[s]}</span>
          </button>
        ))}
      </div>

      {erro && <div className="alert warn"><b>{TEXTO_CODIGO_CLIENTE[erro]}</b> {dados ? 'O quadro abaixo é o último estado conhecido.' : 'Ainda não há estado conhecido para mostrar.'}</div>}
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
        <span className="small muted">{quadro.visiveis} de {quadro.totalSemFiltro}</span>
        {(filtro.escopo !== 'TODOS' || filtro.status || filtro.busca || filtro.workstreamId) && (
          <button className="btn sm" onClick={() => setFiltro(FILTRO_VAZIO)}>Limpar filtros</button>
        )}
      </div>

      {!itens.length
        ? (primeiraLeitura
          ? <p className="small muted">Lendo o estado da produção…</p>
          : <Empty icone="checks" titulo="Nenhum item de trabalho">A leitura chegou, mas nenhuma issue, PR ou gate foi projetado como item de trabalho.</Empty>)
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
                    {col.itens.map((i) => <Cartao key={i.id} i={i} agora={agora} />)}
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
