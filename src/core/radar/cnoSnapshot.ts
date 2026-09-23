// LE-3B — controle do snapshot oficial do CNO: "mudou ou nao mudou?" antes de gastar 1,4 GB de leitura.
//
// Puro. Este descritor pertence ao CONTROLE DA FONTE e nunca entra em `RegistroFonte.payload`: se entrasse, a
// mesma observacao geraria fingerprint novo a cada snapshot, destruindo a idempotencia do LE-1 (ver §34.12).
//
// Principio operacional: a Receita nao publica delta. Snapshot IGUAL -> nao baixar, nao processar. Snapshot
// NOVO -> reprocessar a base inteira e deixar o fingerprint do LE-1 dizer, CNO a CNO, o que e repeticao
// (IDEMPOTENT_NOOP), o que e alteracao (NOVA_OBSERVACAO) e o que e novo (NOVO_REGISTRO).

export interface CnoSnapshotDescriptor {
  etag?: string;
  lastModified?: string;
  contentLength?: number;
}

export const COMPARACOES_SNAPSHOT = ['MESMO_SNAPSHOT', 'SNAPSHOT_NOVO', 'INDETERMINADO'] as const;
export type ComparacaoSnapshot = (typeof COMPARACOES_SNAPSHOT)[number];

const limpo = (v?: string): string | undefined => {
  const t = (v ?? '').trim();
  return t ? t : undefined;
};

/** ETag pode vir forte (`"abc"`) ou fraca (`W/"abc"`); o conteudo e o mesmo, a forma nao importa aqui. */
const etagNormalizada = (v?: string): string | undefined => {
  const t = limpo(v);
  return t ? t.replace(/^W\//i, '').replace(/^"|"$/g, '') : undefined;
};

/**
 * Regras, nesta ordem:
 *   ETag nos dois lados e igual                      -> MESMO_SNAPSHOT
 *   ETag nos dois lados e diferente                  -> SNAPSHOT_NOVO
 *   sem ETag num dos lados: Last-Modified + tamanho  -> iguais MESMO_SNAPSHOT, diferentes SNAPSHOT_NOVO
 *   sem metadata suficiente para afirmar             -> INDETERMINADO (nunca "mesmo" por palpite)
 */
export function compararSnapshot(anterior: CnoSnapshotDescriptor, atual: CnoSnapshotDescriptor): ComparacaoSnapshot {
  const ea = etagNormalizada(anterior.etag);
  const eb = etagNormalizada(atual.etag);
  if (ea && eb) return ea === eb ? 'MESMO_SNAPSHOT' : 'SNAPSHOT_NOVO';

  const la = limpo(anterior.lastModified);
  const lb = limpo(atual.lastModified);
  const ta = anterior.contentLength;
  const tb = atual.contentLength;
  const temMetadata = la !== undefined && lb !== undefined && ta !== undefined && tb !== undefined;
  if (!temMetadata) {
    // metadata parcial que ja DIVERGE e evidencia suficiente de mudanca; parcial que coincide nao prova nada
    if (la && lb && la !== lb) return 'SNAPSHOT_NOVO';
    if (ta !== undefined && tb !== undefined && ta !== tb) return 'SNAPSHOT_NOVO';
    return 'INDETERMINADO';
  }
  return la === lb && ta === tb ? 'MESMO_SNAPSHOT' : 'SNAPSHOT_NOVO';
}

/** Snapshot igual e a unica situacao em que pular o processamento e correto. INDETERMINADO processa. */
export const devePularProcessamento = (c: ComparacaoSnapshot): boolean => c === 'MESMO_SNAPSHOT';
