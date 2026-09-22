// Lead Engine LE-1 — intake canonico, staging logico e idempotencia.
//
// Este modulo responde UMA pergunta: "ja recebi exatamente esta observacao deste objeto externo?".
// Ele nao descobre, nao busca, nao casa empresa, nao pontua e nao cria conta comercial.
//
// Proibido aqui (contrato do LE-0, docs/lead-engine-1.0.md): fetch/rede, Supabase, store, React, UI,
// Commercial Machine, score/priority, decision fit, Vibe, criacao de Empresa/Contato/Projeto/Sinal.
// O casamento de identidade de empresa e do LE-2 e continua vivendo em normalizar.ts/ingestao.ts.
//
// DOIS conceitos distintos, que nunca podem ser confundidos (D-7 do LE-0):
//   IdentidadeFonte   = fonteId + externoId ....... QUAL objeto externo e (a obra, a licitacao, a empresa)
//   payloadFingerprint = hash canonico do payload .. QUAL VERSAO daquele objeto foi observada
// Mesmo objeto observado de novo com conteudo diferente NAO e duplicata: e uma nova observacao, e a
// observacao anterior continua existindo intacta.
import { hashCanonico, jsonCanonico } from './hash';
import type { RegistroFonte, StatusIntake, TipoRegistroFonte } from './types';

export const STATUS_INTAKE: StatusIntake[] = ['PENDING', 'REVIEW', 'RESOLVED', 'REJECTED'];
export const TIPOS_REGISTRO_FONTE: TipoRegistroFonte[] = ['empresa', 'contato', 'projeto', 'sinal'];

// ---------------------------------------------------------------------------------------------
// Canonicalizacao e impressao da observacao
// ---------------------------------------------------------------------------------------------

/**
 * Forma canonica do payload: chaves de objeto ordenadas em todos os niveis, arrays na ordem recebida
 * (ordem de array e informacao da fonte), `undefined` omitido. Implementacao e a que o repositorio ja
 * usa para o context_hash das comunicacoes (`jsonCanonico` em hash.ts) — nenhuma biblioteca nova.
 * Nao muta a entrada.
 */
export const payloadCanonico = (payload: unknown): string => jsonCanonico(payload);

/**
 * Impressao da OBSERVACAO: sha256 da forma canonica do payload.
 * Recebe SO o payload — por construcao nao ha como o momento da ingestao, o id local ou qualquer campo
 * gerado pelo app entrarem no hash. Determinista e igual no navegador e no servidor (hash.ts e puro).
 */
export const payloadFingerprint = (payload: unknown): string => hashCanonico(payload);

// ---------------------------------------------------------------------------------------------
// Identidade externa
// ---------------------------------------------------------------------------------------------

/** QUAL objeto externo. Nunca confundir com a impressao, que diz qual versao dele foi vista. */
export interface IdentidadeFonte { fonteId: string; externoId: string }

// Chave injetiva sem caractere exotico: o comprimento da fonte prefixa a concatenacao, entao nenhum par
// (fonteId, externoId) diferente pode produzir a mesma chave por ambiguidade de separador.
export const chaveIdentidade = (i: IdentidadeFonte): string => `${i.fonteId.length}:${i.fonteId}:${i.externoId}`;
export const mesmaIdentidade = (a: IdentidadeFonte, b: IdentidadeFonte): boolean => chaveIdentidade(a) === chaveIdentidade(b);

// ---------------------------------------------------------------------------------------------
// DiscoveryRecord: projecao de leitura sobre RegistroFonte (NAO e entidade nova, NAO e tabela nova)
// ---------------------------------------------------------------------------------------------

export interface DiscoveryRecord {
  /** id do proprio RegistroFonte: a projecao nao tem identidade propria. */
  registroFonteId: string;
  fonteId: string;
  externoId: string;
  tipo: TipoRegistroFonte;
  payloadFingerprint: string;
  status: StatusIntake;
  entidadeId?: string;
  recebidoEm: string;
  decididoEm?: string;
  decididoPor?: string;
  motivoDecisao?: string;
}

/**
 * Projeta um RegistroFonte como candidato do Lead Engine.
 * Devolve `undefined` quando o registro NAO e gerenciado pelo Lead Engine — e o caso de todo o historico
 * anterior ao LE-1, da importacao CSV e do Vibe. Isso e o que impede um backlog falso de pendencias
 * (D-20 do LE-0): historico nao tem `statusIntake`, logo nunca vira DiscoveryRecord, logo nunca e PENDING.
 */
export function discoveryRecordDe(r: RegistroFonte): DiscoveryRecord | undefined {
  if (!r.statusIntake || !r.externoId || !r.payloadFingerprint) return undefined;
  return {
    registroFonteId: r.id, fonteId: r.fonteId, externoId: r.externoId, tipo: r.tipo,
    payloadFingerprint: r.payloadFingerprint, status: r.statusIntake, entidadeId: r.entidadeId,
    recebidoEm: r.recebidoEm, decididoEm: r.decididoEm, decididoPor: r.decididoPor, motivoDecisao: r.motivoDecisao,
  };
}

/** Todos os candidatos gerenciados pelo Lead Engine. Registro legado nunca aparece aqui. */
export const discoveryRecords = (registros: RegistroFonte[]): DiscoveryRecord[] =>
  registros.map(discoveryRecordDe).filter((d): d is DiscoveryRecord => !!d);

/** Coerencia do estado, verificavel sem banco. Espelha os CHECKs da migration 0055. */
export function problemasDoDiscoveryRecord(d: DiscoveryRecord): string[] {
  const p: string[] = [];
  if (!STATUS_INTAKE.includes(d.status)) p.push(`status desconhecido: ${d.status}`);
  if (d.status === 'RESOLVED' && !d.entidadeId) p.push('RESOLVED exige entidade ligada');
  if (d.status === 'REJECTED' && !d.motivoDecisao) p.push('REJECTED exige motivo');
  if ((d.status === 'RESOLVED' || d.status === 'REJECTED') && !d.decididoEm) p.push(`${d.status} exige data de decisao`);
  if (!d.externoId) p.push('registro gerenciado exige identidade externa');
  if (!d.payloadFingerprint) p.push('registro gerenciado exige impressao do payload');
  return p;
}

// ---------------------------------------------------------------------------------------------
// Validacao do intake
// ---------------------------------------------------------------------------------------------

export const MOTIVOS_INTAKE_INVALIDO = ['SEM_FONTE', 'SEM_IDENTIDADE_EXTERNA', 'SEM_PAYLOAD', 'TIPO_INVALIDO'] as const;
export type MotivoIntakeInvalido = (typeof MOTIVOS_INTAKE_INVALIDO)[number];

/** Pedido de intake do Lead Engine. E o contrato que toda fonte automatica tera de entregar (LE-3 em diante). */
export interface PedidoIntake {
  fonteId: string;
  tipo: TipoRegistroFonte;
  /** Obrigatorio: fonte automatica sem identidade externa estavel nao e elegivel a intake (D-7). */
  externoId?: string;
  payload: unknown;
  recebidoEm: string;
}

export type IntakeValido = { ok: true; identidade: IdentidadeFonte; payloadFingerprint: string };
export type IntakeInvalido = { ok: false; motivos: MotivoIntakeInvalido[] };

/**
 * Porta de entrada do Lead Engine. CSV e MANUAL NAO passam por aqui: seguem `importacao.ts` e
 * `ingerirRegistro`, inalterados. Quem chega sem `externoId` estavel e recusado com SEM_IDENTIDADE_EXTERNA
 * — sem isso nao existe idempotencia possivel e a fonte nao pode ser automatizada.
 */
export function validarIntake(p: PedidoIntake): IntakeValido | IntakeInvalido {
  const motivos: MotivoIntakeInvalido[] = [];
  if (!p.fonteId?.trim()) motivos.push('SEM_FONTE');
  if (!p.externoId?.trim()) motivos.push('SEM_IDENTIDADE_EXTERNA');
  if (p.payload === undefined || p.payload === null) motivos.push('SEM_PAYLOAD');
  if (!TIPOS_REGISTRO_FONTE.includes(p.tipo)) motivos.push('TIPO_INVALIDO');
  if (motivos.length) return { ok: false, motivos };
  return { ok: true, identidade: { fonteId: p.fonteId, externoId: p.externoId! }, payloadFingerprint: payloadFingerprint(p.payload) };
}

// ---------------------------------------------------------------------------------------------
// Classificacao da repeticao
// ---------------------------------------------------------------------------------------------

export const RESULTADOS_INTAKE = ['NOVO_REGISTRO', 'NOVA_OBSERVACAO', 'IDEMPOTENT_NOOP'] as const;
export type ResultadoIntake = (typeof RESULTADOS_INTAKE)[number];

export interface ClassificacaoIntake {
  resultado: ResultadoIntake;
  identidade: IdentidadeFonte;
  payloadFingerprint: string;
  /** Na repeticao exata, o registro que ja representa esta observacao. */
  observacaoExistente?: DiscoveryRecord;
  /** Na nova observacao, o que ja conhecemos do MESMO objeto externo — preservado, nunca reescrito. */
  observacoesAnteriores: DiscoveryRecord[];
}

/**
 * Compara o pedido com o que ja esta no staging:
 *   mesma identidade + mesma impressao  -> IDEMPOTENT_NOOP  (nao cria nada: nem registro, nem sinal, nem revisao)
 *   mesma identidade + outra impressao  -> NOVA_OBSERVACAO  (novo registro AO LADO; o anterior fica intacto)
 *   identidade desconhecida             -> NOVO_REGISTRO
 * Nao decide nada comercial sobre a diferenca entre as observacoes: isso e de blocos futuros.
 */
export function classificarIntake(valido: IntakeValido, existentes: DiscoveryRecord[]): ClassificacaoIntake {
  const doObjeto = existentes.filter((d) => mesmaIdentidade(d, valido.identidade));
  const exata = doObjeto.find((d) => d.payloadFingerprint === valido.payloadFingerprint);
  const base = { identidade: valido.identidade, payloadFingerprint: valido.payloadFingerprint, observacoesAnteriores: doObjeto };
  if (exata) return { ...base, resultado: 'IDEMPOTENT_NOOP', observacaoExistente: exata };
  return { ...base, resultado: doObjeto.length ? 'NOVA_OBSERVACAO' : 'NOVO_REGISTRO' };
}

/**
 * Monta o RegistroFonte de uma observacao aceita. Funcao pura: recebe o id de fora, nao grava nada e
 * NUNCA toca em registro existente — nova observacao e sempre uma linha nova, entao o payload anterior
 * e preservado por construcao. Nasce PENDING e sem entidade: intake nao cria conta comercial (D-10).
 */
export function registroDeIntake(valido: IntakeValido, p: PedidoIntake, id: string): RegistroFonte {
  return {
    id, fonteId: valido.identidade.fonteId, tipo: p.tipo, externoId: valido.identidade.externoId,
    payload: p.payload, recebidoEm: p.recebidoEm,
    payloadFingerprint: valido.payloadFingerprint, statusIntake: 'PENDING',
  };
}
