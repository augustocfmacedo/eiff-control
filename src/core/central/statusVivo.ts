// LIVE x SNAPSHOT x STALE x UNAVAILABLE — a regra que diz o que o painel esta mostrando de verdade.
//
// O Mission Control sempre teve duas naturezas misturadas numa tela so:
//   - a CURADORIA de gates, que vem do codigo e so muda quando alguem faz commit (SNAPSHOT);
//   - o ESTADO OBSERVADO das fontes, que muda sozinho (LIVE).
// Este modulo separa as duas e nomeia o caso em que a primeira ficou para tras da segunda.
//
// PUREZA TOTAL: sem I/O, sem fetch, sem store, sem React. So funcao sobre dado.
import type { CodigoFalhaFonte } from './githubAdapter';
import { TEXTO_FALHA_FONTE } from './githubAdapter';

export const SITUACOES_VIVO = ['LIVE', 'SNAPSHOT', 'STALE', 'UNAVAILABLE'] as const;
export type SituacaoVivo = (typeof SITUACOES_VIVO)[number];

export const ROTULO_SITUACAO_VIVO: Readonly<Record<SituacaoVivo, string>> = {
  LIVE: 'Ao vivo',
  SNAPSHOT: 'Snapshot desatualizado',
  STALE: 'Dado envelhecido',
  UNAVAILABLE: 'Fonte indisponível',
};

/** Token de cor. Nunca usado sozinho: ROTULO_SITUACAO_VIVO sempre acompanha (acessibilidade). */
export const COR_SITUACAO_VIVO: Readonly<Record<SituacaoVivo, 'verde' | 'amarelo' | 'cinza' | 'vermelho'>> = {
  LIVE: 'verde', SNAPSHOT: 'amarelo', STALE: 'amarelo', UNAVAILABLE: 'vermelho',
};

export const COMPARACOES_BUILD = ['ATUALIZADO', 'DESATUALIZADO', 'DESCONHECIDO'] as const;
export type ComparacaoBuild = (typeof COMPARACOES_BUILD)[number];

/**
 * De onde sai o SHA do build publicado. `COMMIT_REF` e a variavel que o proprio Netlify injeta na
 * publicacao — nao e valor digitado, nao e constante mantida a mao, e nao existe fora do servidor.
 *
 * LACUNA CONHECIDA E DECLARADA: em desenvolvimento local e em qualquer ambiente que nao defina
 * `COMMIT_REF`, o SHA do build e DESCONHECIDO. Nesse caso a comparacao devolve 'DESCONHECIDO' e a tela
 * diz isso — nenhum valor e inventado para a comparacao "funcionar".
 */
export const ORIGEM_SHA_BUILD = 'COMMIT_REF' as const;

export interface BuildPublicado {
  /** sha do commit publicado, quando o ambiente informa */
  sha: string | null;
  origem: typeof ORIGEM_SHA_BUILD | null;
}

export interface ComparacaoDeBuild {
  comparacao: ComparacaoBuild;
  shaBuild: string | null;
  shaObservado: string | null;
  texto: string;
}

const curto = (s: string | null): string => (s ? s.slice(0, 7) : '—');

/** Compara o que esta publicado com o `main` observado. Sem um dos dois, DESCONHECIDO — nunca palpite. */
export function compararBuild(build: BuildPublicado, shaMainObservado: string | null): ComparacaoDeBuild {
  const shaBuild = build.sha;
  if (!shaBuild || !shaMainObservado) {
    return {
      comparacao: 'DESCONHECIDO',
      shaBuild,
      shaObservado: shaMainObservado,
      texto: !shaBuild
        ? `SHA do build não informado pelo ambiente (${ORIGEM_SHA_BUILD}): não dá para saber se esta tela está atrás do main.`
        : 'O main observado não foi lido: comparação indisponível.',
    };
  }
  if (shaBuild === shaMainObservado) {
    return { comparacao: 'ATUALIZADO', shaBuild, shaObservado: shaMainObservado, texto: `Esta tela é a publicação de ${curto(shaBuild)}, que é o main atual.` };
  }
  return {
    comparacao: 'DESATUALIZADO',
    shaBuild,
    shaObservado: shaMainObservado,
    texto: `Esta tela é a publicação de ${curto(shaBuild)}; o main observado já está em ${curto(shaMainObservado)}. A curadoria de gates é desse build, não do main.`,
  };
}

export interface EntradaStatusVivo {
  /** a fonte respondeu nesta leitura */
  disponivel: boolean;
  erroCodigo?: CodigoFalhaFonte;
  /** quando a fonte foi lida com sucesso pela ultima vez (pode ser de um ciclo anterior) */
  observadoEm: string | null;
  agora: string;
  limiteStaleSegundos: number;
  build?: BuildPublicado;
  shaMainObservado?: string | null;
}

export interface StatusVivo {
  situacao: SituacaoVivo;
  rotulo: string;
  detalhe: string;
  /** segundos desde a ultima leitura bem-sucedida; null quando nunca houve uma */
  idadeSegundos: number | null;
  stale: boolean;
  comparacaoBuild: ComparacaoDeBuild;
}

const idade = (observadoEm: string | null, agora: string): number | null => {
  if (!observadoEm) return null;
  const dt = (Date.parse(agora) - Date.parse(observadoEm)) / 1000;
  return Number.isNaN(dt) ? null : Math.max(0, Math.round(dt));
};

/**
 * A pergunta que esta funcao responde: "o que eu estou olhando agora?".
 *
 * Precedencia: fonte caida vence tudo (UNAVAILABLE); dado velho vence o resto (STALE); publicacao atras do
 * main observado e SNAPSHOT; so entao LIVE. Comparacao de build DESCONHECIDA nunca vira SNAPSHOT — nao se
 * acusa desatualizacao sem prova.
 */
export function avaliarStatusVivo(e: EntradaStatusVivo): StatusVivo {
  const comparacaoBuild = compararBuild(e.build ?? { sha: null, origem: null }, e.shaMainObservado ?? null);
  const segundos = idade(e.observadoEm, e.agora);
  const stale = segundos === null || segundos > e.limiteStaleSegundos;

  if (!e.disponivel) {
    return {
      situacao: 'UNAVAILABLE',
      rotulo: ROTULO_SITUACAO_VIVO.UNAVAILABLE,
      detalhe: e.erroCodigo ? TEXTO_FALHA_FONTE[e.erroCodigo] : 'A fonte não respondeu.',
      idadeSegundos: segundos, stale: true, comparacaoBuild,
    };
  }
  if (stale) {
    return {
      situacao: 'STALE',
      rotulo: ROTULO_SITUACAO_VIVO.STALE,
      detalhe: segundos === null ? 'Ainda não houve leitura bem-sucedida.' : `Última leitura há ${humanizarIdade(segundos)}.`,
      idadeSegundos: segundos, stale: true, comparacaoBuild,
    };
  }
  if (comparacaoBuild.comparacao === 'DESATUALIZADO') {
    return { situacao: 'SNAPSHOT', rotulo: ROTULO_SITUACAO_VIVO.SNAPSHOT, detalhe: comparacaoBuild.texto, idadeSegundos: segundos, stale: false, comparacaoBuild };
  }
  return {
    situacao: 'LIVE',
    rotulo: ROTULO_SITUACAO_VIVO.LIVE,
    detalhe: comparacaoBuild.comparacao === 'ATUALIZADO' ? comparacaoBuild.texto : `Observado há ${humanizarIdade(segundos ?? 0)}.`,
    idadeSegundos: segundos, stale: false, comparacaoBuild,
  };
}

/** "há 23 s", "há 4 min", "há 2 h". Texto curto para a faixa de frescor. */
export function humanizarIdade(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  if (segundos < 86_400) return `${Math.round(segundos / 3600)} h`;
  return `${Math.round(segundos / 86_400)} d`;
}

/** Limite de frescor por natureza da fonte. GitHub nao e heartbeat de worker: 3 minutos e folgado. */
export const LIMITE_STALE_GITHUB_S = 180;
