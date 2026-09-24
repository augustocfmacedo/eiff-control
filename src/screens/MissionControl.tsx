// Mission Control — a Central de Construção do EIFF (MC-CONSTRUCTION-1).
//
// A primeira dobra deixou de ser o painel de gates e passou a ser o panorama da construção: módulos, o que
// está sendo construído agora e o que exige atenção. Gates, marcos, escada, frentes, camadas e evidências
// continuam inteiros na aba Governança — nada foi removido, só reorganizado.
//
// UMA leitura remota por ciclo (`useStatusRemoto`), compartilhada por prop com as quatro abas: nenhuma seção
// cria polling, fetch ou relógio próprio. Nada aqui escreve em fonte alguma.
import React, { useState } from 'react';
import { AVISO_FACTORY_PROJECAO } from '../core/central/statusServidor';
import { LIMITE_STALE_GITHUB_S, avaliarStatusVivo, humanizarIdade, type SituacaoVivo } from '../core/central/statusVivo';
import { ROTULO_CI, TEXTO_FALHA_FONTE, type RepositorioStatus } from '../core/central/githubAdapter';
import { TEXTO_CODIGO_CLIENTE, useStatusRemoto, type EstadoStatusRemoto } from '../data/statusRemoto';
import QuadroOperacional from './MissionControlQuadro';
import VisaoGeral from './MissionControlVisao';
import MapaVivo from './MissionControlMapa';
import Governanca from './MissionControlGovernanca';
import { Badge, PageHead, PrintHead, Tabs, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';

// ---------------------------------------------------------------------------------------------------
// Desenvolvimento ao vivo (MC-LIVE-1): a PRIMEIRA fonte realmente viva desta tela.
// Tudo abaixo vem de /api/development-status; o navegador nunca fala com o GitHub e nunca conhece token.
// ---------------------------------------------------------------------------------------------------
const TONE_VIVO: Record<SituacaoVivo, Tone> = { LIVE: 'ok', SNAPSHOT: 'warn', STALE: 'warn', UNAVAILABLE: 'bad' };

function LinhaRepositorio({ r, agora }: { r: RepositorioStatus; agora: string }) {
  const vivo = avaliarStatusVivo({
    disponivel: r.disponivel, erroCodigo: r.erroCodigo, observadoEm: r.disponivel ? r.observadoEm : null,
    agora, limiteStaleSegundos: LIMITE_STALE_GITHUB_S,
  });
  const nome = r.repository.split('/')[1] ?? r.repository;
  return (
    <div className="mc-vivo-repo">
      <div className="mc-vivo-cab">
        <b>{nome}</b>
        <Badge tone={TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>{vivo.rotulo}</Badge>
        {r.papel === 'fabrica' && <Badge tone="info" title={AVISO_FACTORY_PROJECAO}>projeção do GitHub</Badge>}
      </div>
      {r.disponivel ? (
        <div className="small muted">
          {r.main ? <>main <code>{r.main.shaCurto}</code></> : 'main não lido'}
          {/* capacidade a capacidade: o que falhou diz o que falhou, e não apaga o que foi lido */}
          {r.ci && <> · {ROTULO_CI[r.ci.situacao]} <span className="mc-cru">{r.ci.statusOrigem}</span></>}
          {r.erroCi && <> · <span title={TEXTO_FALHA_FONTE[r.erroCi]}>CI indisponível</span></>}
          {' · '}{r.erroPullRequests ? <span title={TEXTO_FALHA_FONTE[r.erroPullRequests]}>PRs indisponíveis</span> : <>{r.pullRequests.length} PR aberto(s)</>}
          {r.papel === 'fabrica' && (r.erroIssues
            ? <> · <span title={TEXTO_FALHA_FONTE[r.erroIssues]}>issues indisponíveis</span></>
            : <> · {r.issues.length} issue(s) de job</>)}
          {vivo.idadeSegundos !== null && <> · observado há {humanizarIdade(vivo.idadeSegundos)}</>}
        </div>
      ) : (
        <div className="small muted">{r.erroCodigo ? TEXTO_FALHA_FONTE[r.erroCodigo] : 'Fonte indisponível.'} Nada foi inventado no lugar.</div>
      )}
    </div>
  );
}

function DesenvolvimentoAoVivo({ estado }: { estado: EstadoStatusRemoto & { recarregar: () => void } }) {
  const { dados, recebidoEm, carregando, erro, recarregar } = estado;
  const agora = new Date().toISOString();
  const fonte = dados?.fontes.github;
  // antes da PRIMEIRA leitura não se afirma nada: não é "indisponível", é "ainda não perguntamos"
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
  const cont = dados?.factory.contagens;

  return (
    <div className="card mc-vivo">
      <div className="mc-vivo-topo">
        <h2>Desenvolvimento ao vivo</h2>
        {primeiraLeitura
          ? <Badge tone="muted" title="Nenhuma leitura concluída ainda">Lendo…</Badge>
          : <Badge tone={TONE_VIVO[vivo.situacao]} title={vivo.detalhe}>{vivo.rotulo}</Badge>}
        <button className="btn small no-print" onClick={recarregar} disabled={carregando}>
          <Icon name="checks" size={14} /> {carregando ? 'Lendo…' : 'Atualizar'}
        </button>
      </div>
      {!primeiraLeitura && <p className="small muted">{vivo.detalhe}{' '}{vivo.comparacaoBuild.comparacao === 'DESCONHECIDO' && vivo.comparacaoBuild.texto}</p>}

      {erro && <div className="alert warn"><b>{TEXTO_CODIGO_CLIENTE[erro]}</b> {dados ? 'O que está abaixo é o último estado conhecido.' : 'Ainda não há estado conhecido para mostrar.'}</div>}

      {dados
        ? (
          <>
            {dados.repositorios.map((r) => <LinhaRepositorio key={r.repository} r={r} agora={agora} />)}
            {cont && (
              <div className="small muted mc-vivo-resumo">
                <b>Factory</b> (projeção do GitHub): {cont.ARQUITETURA} em arquitetura · {cont.PRONTO} prontos · {cont.EXECUTANDO} em execução · {cont.EM_VALIDACAO} em validação · {cont.AGUARDANDO_HUMANO} aguardando humano · {cont.BLOQUEADO} bloqueados
              </div>
            )}
            <p className="small muted">{dados.factory.aviso}</p>
            {dados.fontes.github.limite && (
              <p className="small muted">GitHub: {dados.fontes.github.chamadas} chamada(s) neste ciclo (teto {dados.fontes.github.maxChamadasPorCiclo}); limite restante {dados.fontes.github.limite.restante} de {dados.fontes.github.limite.total}.</p>
            )}
          </>
        )
        : !erro && <p className="small muted">Lendo o estado da construção…</p>}
    </div>
  );
}

export const ABAS_MISSION_CONTROL = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'execucao', label: 'Execução' },
  { id: 'mapa', label: 'Mapa vivo' },
  { id: 'governanca', label: 'Governança' },
] as const;
export type AbaMissionControl = (typeof ABAS_MISSION_CONTROL)[number]['id'];

export default function MissionControl() {
  // UMA leitura por ciclo, compartilhada por prop com as quatro abas. Dois hooks seriam dois polls por
  // minuto sobre a mesma API, que tem teto de chamadas por ciclo.
  const estado = useStatusRemoto(true);
  const [aba, setAba] = useState<AbaMissionControl>('visao');
  const itens = estado.dados ? estado.dados.workItems : null;

  return (
    <>
      <PrintHead titulo="Mission Control · Central de Construção do EIFF" subtitulo="Módulos, tarefas em andamento e prontidão derivada de evidência" />
      <PageHead
        title="Mission Control"
        subtitle={<>Central de Construção do EIFF: o que compõe o sistema, o que já foi construído, o que está sendo construído agora e o que exige atenção. O catálogo de módulos e gates é <b>snapshot</b> do repositório; as tarefas e os repositórios são <b>projeção viva</b> do GitHub — a tela diz qual é qual e nunca escreve em fonte alguma.</>}
      >
        <div className="actions no-print">
          <Badge tone="muted" title="O catálogo de módulos e gates é derivado do código no momento do build (gate MISSION_CONTROL_LIVE aberto). As tarefas e os repositórios vêm da leitura viva do GitHub pelo endpoint interno.">Snapshot do desenvolvimento + projeção viva</Badge>
          <button className="btn" onClick={() => window.print()}><Icon name="livro" size={15} /> Imprimir</button>
        </div>
      </PageHead>

      <Tabs value={aba} onChange={setAba} items={[...ABAS_MISSION_CONTROL]} />

      {aba === 'visao' && <VisaoGeral estado={estado} onIrPara={setAba} />}
      {aba === 'execucao' && (
        <>
          <DesenvolvimentoAoVivo estado={estado} />
          <QuadroOperacional estado={estado} />
        </>
      )}
      {aba === 'mapa' && <MapaVivo itens={itens} repositorios={estado.dados?.repositorios} />}
      {aba === 'governanca' && <Governanca />}
    </>
  );
}
