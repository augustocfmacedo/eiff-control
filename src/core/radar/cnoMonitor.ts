// LE3-E — monitor diario da fonte CNO: decidir, so com metadados, se vale a pena processar 1,4 GB.
//
// Puro. A fonte e SNAPSHOT (nao ha delta oficial), entao o ciclo e:
//   1. HEAD no artefato oficial (so metadados; nunca o download);
//   2. comparar o descritor com o ultimo processado (`compararSnapshot`, LE3-B);
//   3. MESMO_SNAPSHOT -> ENCERRAR_SEM_DOWNLOAD (nenhum pipeline pesado roda);
//   4. SNAPSHOT_NOVO ou INDETERMINADO -> PROCESSAR: baixar, join em streaming, politica da janela movel,
//      comparar com radar_source_record e planejar SO novos / novas observacoes (idempotencia do LE-1).
//
// Dois conceitos que o monitor nunca mistura:
//   DISCOVERED_TODAY  = recebidoEm (quando a EIFF descobriu);
//   OFFICIAL_CNO_DATE = data oficial do evento na fonte.
//
// Retencao: a janela de 90 dias controla DESCOBERTA, nao historico. Obra que sai da janela nao e apagada —
// o Lead Engine nunca apaga RegistroFonte (a evidencia e imutavel no banco).
//
// Escrita em producao continua atras do hard gate do runner (`modoExecucao`: --executar + --confirmar).
// Nenhum scheduler escreve por conta propria.
import { compararSnapshot, devePularProcessamento, type CnoSnapshotDescriptor, type ComparacaoSnapshot } from './cnoSnapshot';
import { CONFIRMACAO_PILOTO, modoExecucao, type ModoExecucao } from './leadEngineBatchIntake';

export type AcaoMonitor = 'ENCERRAR_SEM_DOWNLOAD' | 'PROCESSAR';

export interface DecisaoMonitor {
  acao: AcaoMonitor;
  comparacao: ComparacaoSnapshot | 'SEM_ESTADO_ANTERIOR';
  motivo: string;
  /** o que deve ser gravado como "ultimo visto" DEPOIS de um processamento bem-sucedido — nunca antes */
  descritorAtual: CnoSnapshotDescriptor;
}

/** Sem estado anterior, processa (primeira execucao). Com estado, so processa se o snapshot mudou ou e indeterminado. */
export function decidirMonitor(anterior: CnoSnapshotDescriptor | undefined, atual: CnoSnapshotDescriptor): DecisaoMonitor {
  if (!anterior) return { acao: 'PROCESSAR', comparacao: 'SEM_ESTADO_ANTERIOR', motivo: 'primeira execucao: nao ha descritor anterior para comparar', descritorAtual: atual };
  const comparacao = compararSnapshot(anterior, atual);
  if (devePularProcessamento(comparacao)) {
    return { acao: 'ENCERRAR_SEM_DOWNLOAD', comparacao, motivo: 'mesmo snapshot: nada a baixar nem processar', descritorAtual: atual };
  }
  return {
    acao: 'PROCESSAR', comparacao,
    motivo: comparacao === 'SNAPSHOT_NOVO' ? 'snapshot novo publicado pela Receita' : 'metadados insuficientes para afirmar que e o mesmo: processar por seguranca',
    descritorAtual: atual,
  };
}

/**
 * O que um executor agendado PODE fazer em cada etapa. Escrever exige o hard gate do runner: um cron sem
 * `--executar --confirmar CNO_PILOT_V1` so planeja. E esse gate e do runner, nao do scheduler — o scheduler
 * nao tem porta propria de escrita.
 */
export interface PlanoExecucaoAgendada {
  monitorar: true;
  baixarEProcessar: boolean;
  planejarIntake: boolean;
  escrever: boolean;
  modo: ModoExecucao;
}

export function planoExecucaoAgendada(decisao: DecisaoMonitor, flags: { executar: boolean; confirmar?: string }): PlanoExecucaoAgendada {
  const modo = modoExecucao(flags);
  const processa = decisao.acao === 'PROCESSAR';
  return { monitorar: true, baixarEProcessar: processa, planejarIntake: processa, escrever: processa && modo === 'ESCRITA', modo };
}

/** A janela movel: obras com evento oficial >= (referencia - 90 dias). Nunca decide o que APAGAR. */
export const JANELA_DESCOBERTA_DIAS = 90;

/** Documenta a retencao como funcao: o conjunto a REMOVER e sempre vazio, por desenho. */
export function registrosARemoverAoSairDaJanela<T>(_registrosForaDaJanela: T[]): T[] {
  return [];
}

export { CONFIRMACAO_PILOTO };
