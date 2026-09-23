// Lead Engine LE-2 — fila de revisao, identidade e promocao HUMANA.
//
// O que este modulo faz: projeta o staging do LE-1 como fila de back-office, normaliza o payload bruto pelo adapter
// da propria fonte, analisa identidade com a UNICA escada que o Radar ja tem, valida a decisao de uma pessoa e
// aplica a promocao no RadarDataset. Nada acontece sem clique humano.
//
// Proibido aqui (contrato do LE-0 e do LE-2): React, fetch, Supabase, store, CM1, CM2, recomendarAcao, score,
// priority, Vibe, scheduler, autopromocao, descoberta externa.
//
// Autoridade de identidade: `encontrarEmpresa` (normalizar.ts). Nao existe matcher do Lead Engine, nem limiar
// proprio, nem score de candidato. A escada continua sendo businessId -> CNPJ -> dominio -> razao social + local ->
// similaridade, e quem decide continua sendo a pessoa.
//
// Supressao (D-12: supressao vence redescoberta): a leitura de `r.supressoes` vive aqui, com a mesma semantica de
// `empresaSuprimida`, para o Lead Engine nao depender da autoridade legada de `pipeline.ts`.
import type { EmpresaNormalizada, RegistroNormalizado } from './adapters';
import { adapterDe } from './adapters';
import { Ids, registrarSinalNormalizado, upsertEmpresa, upsertProjeto } from './ingestao';
import { discoveryRecordDe, discoveryRecords, payloadFingerprint, type DiscoveryRecord } from './leadEngineIntake';
import { encontrarEmpresa, normalizarCnpj, type NivelMatch } from './normalizar';
import type { Empresa, Fonte, RadarDataset, RegistroFonte, StatusIntake, TipoFonte, TipoRegistroFonte } from './types';

// ---------------------------------------------------------------------------------------------
// Bloqueios: motivos pelos quais um candidato NAO pode ser promovido agora
// ---------------------------------------------------------------------------------------------

export const CODIGOS_BLOQUEIO = [
  'FONTE_DESCONHECIDA',
  'SEM_ADAPTER',
  'EVIDENCIA_ALTERADA',
  'IDENTIDADE_EXTERNA_DIVERGENTE',
  'SEM_EMPRESA_NORMALIZADA',
  'SEM_IDENTIDADE_FORTE',
  'SUPRIMIDO',
  'OBSERVACAO_DESATUALIZADA',
  'TIPO_SEM_PROMOCAO_AUTOMATICA',
] as const;
export type CodigoBloqueio = (typeof CODIGOS_BLOQUEIO)[number];

/** Bloqueio que impede QUALQUER promocao, mesmo com decisao humana. Os demais so restringem a decisao. */
const BLOQUEIO_DURO: CodigoBloqueio[] = ['EVIDENCIA_ALTERADA', 'IDENTIDADE_EXTERNA_DIVERGENTE', 'OBSERVACAO_DESATUALIZADA', 'SUPRIMIDO'];

// ---------------------------------------------------------------------------------------------
// Identidade forte: o unico caminho para CRIAR uma raiz nova no Radar
// ---------------------------------------------------------------------------------------------

const BUSINESS_ID = /^[a-f0-9]{32}$/i;

/**
 * Identidade forte = CNPJ valido OU businessId no formato que o Radar ja reconhece.
 * Nome, cidade, UF, dominio e similaridade AJUDAM a associar uma empresa existente, mas nunca bastam para criar uma
 * raiz nova: sem isso o Lead Engine viraria uma maquina de duplicatas.
 */
export function identidadeForte(e: EmpresaNormalizada | undefined): boolean {
  if (!e) return false;
  if (e.businessId && BUSINESS_ID.test(e.businessId)) return true;
  return !!normalizarCnpj(e.cnpj);
}

/** Mesma semantica de `empresaSuprimida` (pipeline.ts), lida aqui para nao acoplar o Lead Engine a autoridade legada. */
export const empresaSuprimidaNoRadar = (empresaId: string, r: Pick<RadarDataset, 'supressoes'>): boolean =>
  r.supressoes.some((s) => s.empresaId === empresaId && !s.contatoId && (s.tipo === 'do_not_contact' || s.tipo === 'opt_out'));

// ---------------------------------------------------------------------------------------------
// Analise de um candidato
// ---------------------------------------------------------------------------------------------

export interface MatchCandidato {
  empresaId: string;
  nivel: NivelMatch;
  confianca: number;
  motivo: string;
}

export interface AnaliseCandidato {
  registro: DiscoveryRecord;
  fonteId: string;
  fonteNome: string;
  fonteTipo?: TipoFonte;
  tipo: TipoRegistroFonte;
  normalizado?: RegistroNormalizado;
  empresaNormalizada?: EmpresaNormalizada;
  match?: MatchCandidato;
  identidadeForte: boolean;
  /** empresa ja resolvida por match, quando existe: base para a checagem de supressao */
  empresaSuprimidaId?: string;
  bloqueios: CodigoBloqueio[];
}

/** Item que a tela mostra. Sem score comercial, sem prioridade: isto e back-office, nao fila de vendas. */
export interface ItemRevisaoLeadEngine {
  registroFonteId: string;
  fonteId: string;
  fonteNome: string;
  fonteTipo?: TipoFonte;
  externoId: string;
  recebidoEm: string;
  status: Extract<StatusIntake, 'PENDING' | 'REVIEW'>;
  tipo: TipoRegistroFonte;
  payloadFingerprint: string;
  empresaNormalizada?: EmpresaNormalizada;
  match?: MatchCandidato;
  identidadeForte: boolean;
  bloqueios: CodigoBloqueio[];
}

const registroPorId = (r: Pick<RadarDataset, 'registrosFonte'>, id: string): RegistroFonte | undefined => r.registrosFonte.find((x) => x.id === id);

/**
 * Observacao mais recente do MESMO objeto externo (fonteId + externoId) ainda nao terminal.
 * Promover a antiga enquanto existe uma mais nova pendente escreveria no Radar um retrato vencido.
 */
export function observacaoMaisRecente(r: Pick<RadarDataset, 'registrosFonte'>, d: DiscoveryRecord): DiscoveryRecord | undefined {
  return discoveryRecords(r.registrosFonte)
    .filter((o) => o.fonteId === d.fonteId && o.externoId === d.externoId && o.registroFonteId !== d.registroFonteId)
    .filter((o) => o.status === 'PENDING' || o.status === 'REVIEW')
    .filter((o) => o.recebidoEm > d.recebidoEm)
    .sort((a, b) => (a.recebidoEm < b.recebidoEm ? 1 : -1))[0];
}

/**
 * Analisa um candidato do staging: fonte, adapter, coerencia da evidencia, identidade externa, empresa normalizada,
 * match na base e bloqueios. Funcao pura; nao decide nada e nao muta o dataset.
 */
export function analisarCandidato(r: RadarDataset, registroFonteId: string): AnaliseCandidato | undefined {
  const bruto = registroPorId(r, registroFonteId);
  if (!bruto) return undefined;
  const registro = discoveryRecordDe(bruto);
  if (!registro) return undefined;

  const bloqueios: CodigoBloqueio[] = [];
  const fonte: Fonte | undefined = r.fontes.find((f) => f.id === registro.fonteId);
  if (!fonte) bloqueios.push('FONTE_DESCONHECIDA');

  // 1. a evidencia bruta tem de ser exatamente a que foi impressa no intake
  if (payloadFingerprint(bruto.payload) !== registro.payloadFingerprint) bloqueios.push('EVIDENCIA_ALTERADA');

  // 2. normalizacao pelo adapter da PROPRIA fonte; sem adapter o candidato fica em revisao, sem inventar dados
  const adapter = fonte ? adapterDe(fonte.tipo) : undefined;
  if (fonte && !adapter) bloqueios.push('SEM_ADAPTER');
  const normalizado = adapter?.normalizar(bruto.payload);
  if (adapter && !normalizado) bloqueios.push('SEM_ADAPTER');

  // 3. identidade externa do adapter nunca pode divergir da identidade do staging (nenhum fallback silencioso)
  if (normalizado?.externoId && normalizado.externoId !== registro.externoId) bloqueios.push('IDENTIDADE_EXTERNA_DIVERGENTE');

  const empresaNormalizada = normalizado?.empresa;
  if (!empresaNormalizada) bloqueios.push('SEM_EMPRESA_NORMALIZADA');

  // 4. match: a escada unica do Radar, sem limiar proprio
  const m = empresaNormalizada ? encontrarEmpresa(empresaNormalizada, r.empresas) : undefined;
  const match: MatchCandidato | undefined = m ? { empresaId: m.empresa.id, nivel: m.nivel, confianca: m.confianca, motivo: m.motivo } : undefined;

  // 5. identidade forte: unica porta para criar empresa nova
  const forte = identidadeForte(empresaNormalizada);
  if (!forte) bloqueios.push('SEM_IDENTIDADE_FORTE');

  // 6. supressao vence redescoberta (D-12)
  const empresaResolvida = match?.empresaId ?? (registro.entidadeId && r.empresas.some((e) => e.id === registro.entidadeId) ? registro.entidadeId : undefined);
  if (empresaResolvida && empresaSuprimidaNoRadar(empresaResolvida, r)) bloqueios.push('SUPRIMIDO');

  // 7. observacao vencida
  if (observacaoMaisRecente(r, registro)) bloqueios.push('OBSERVACAO_DESATUALIZADA');

  // 8. contato ainda nao tem promocao inequivoca (LE-5)
  if (registro.tipo === 'contato') bloqueios.push('TIPO_SEM_PROMOCAO_AUTOMATICA');

  return {
    registro,
    fonteId: registro.fonteId,
    fonteNome: fonte?.nome ?? registro.fonteId,
    fonteTipo: fonte?.tipo,
    tipo: registro.tipo,
    normalizado,
    empresaNormalizada,
    match,
    identidadeForte: forte,
    empresaSuprimidaId: empresaResolvida && empresaSuprimidaNoRadar(empresaResolvida, r) ? empresaResolvida : undefined,
    bloqueios,
  };
}

/**
 * Fila do LE-2: so PENDING e REVIEW, em ordem cronologica determinista (mais antigo primeiro; empate pelo id).
 * Nada de priorityScore, priorityClass, FIT/TIMING/INTENT, valor ou Commercial Queue — isto e back-office.
 */
export function filaDeRevisao(r: RadarDataset): ItemRevisaoLeadEngine[] {
  return discoveryRecords(r.registrosFonte)
    .filter((d): d is DiscoveryRecord & { status: 'PENDING' | 'REVIEW' } => d.status === 'PENDING' || d.status === 'REVIEW')
    .sort((a, b) => (a.recebidoEm === b.recebidoEm ? (a.registroFonteId < b.registroFonteId ? -1 : 1) : a.recebidoEm < b.recebidoEm ? -1 : 1))
    .map((d) => {
      const a = analisarCandidato(r, d.registroFonteId);
      return {
        registroFonteId: d.registroFonteId,
        fonteId: d.fonteId,
        fonteNome: a?.fonteNome ?? d.fonteId,
        fonteTipo: a?.fonteTipo,
        externoId: d.externoId,
        recebidoEm: d.recebidoEm,
        status: d.status,
        tipo: d.tipo,
        payloadFingerprint: d.payloadFingerprint,
        empresaNormalizada: a?.empresaNormalizada,
        match: a?.match,
        identidadeForte: !!a?.identidadeForte,
        bloqueios: a?.bloqueios ?? [],
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Transicoes de status
// ---------------------------------------------------------------------------------------------

const TRANSICOES: Record<StatusIntake, StatusIntake[]> = {
  PENDING: ['REVIEW', 'RESOLVED', 'REJECTED'],
  REVIEW: ['RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

/** Terminal e terminal no LE-2: RESOLVED e REJECTED nao voltam. Reabertura, se existir, sera decisao futura. */
export const transicaoPermitida = (de: StatusIntake, para: StatusIntake): boolean => (TRANSICOES[de] ?? []).includes(para);

// ---------------------------------------------------------------------------------------------
// Decisao humana
// ---------------------------------------------------------------------------------------------

export const DECISOES_LEAD_ENGINE = ['ASSOCIATE_EXISTING', 'CREATE_COMPANY', 'KEEP_REVIEW', 'REJECT'] as const;
export type DecisaoLeadEngine = (typeof DECISOES_LEAD_ENGINE)[number];

export interface PedidoDecisao {
  registroFonteId: string;
  /** impressao que a tela viu quando montou a decisao: se o bruto mudou, a decisao e velha */
  payloadFingerprintEsperado: string;
  decisao: DecisaoLeadEngine;
  /** obrigatorio em ASSOCIATE_EXISTING */
  empresaId?: string;
  /** obrigatorio em REJECT */
  motivo?: string;
}

export const MOTIVOS_RECUSA = [
  'REGISTRO_AUSENTE',
  'REGISTRO_NAO_GERENCIADO',
  'STATUS_TERMINAL',
  'CONTEXTO_MUDOU',
  'OBSERVACAO_DESATUALIZADA',
  'EVIDENCIA_ALTERADA',
  'IDENTIDADE_EXTERNA_DIVERGENTE',
  'SUPRIMIDO',
  'EMPRESA_NAO_ENCONTRADA',
  'EMPRESA_INATIVA',
  'EMPRESA_MESCLADA',
  'EMPRESA_OBRIGATORIA',
  'SEM_IDENTIDADE_FORTE',
  'SEM_EMPRESA_NORMALIZADA',
  'SEM_ADAPTER',
  'MOTIVO_OBRIGATORIO',
  'JA_EXISTE_EMPRESA',
  'TIPO_SEM_PROMOCAO_AUTOMATICA',
  'DECISAO_DESCONHECIDA',
] as const;
export type MotivoRecusa = (typeof MOTIVOS_RECUSA)[number];

export type DecisaoValida = { ok: true; analise: AnaliseCandidato; empresaAlvo?: Empresa };
export type DecisaoRecusada = { ok: false; motivos: MotivoRecusa[] };

const empresaUtilizavel = (e: Empresa | undefined): MotivoRecusa | undefined => {
  if (!e) return 'EMPRESA_NAO_ENCONTRADA';
  if (e.mescladaEm) return 'EMPRESA_MESCLADA';
  if (!e.ativo) return 'EMPRESA_INATIVA';
  return undefined;
};

/**
 * Valida a decisao contra o estado ATUAL do dataset. Toda recusa e explicita: nada de aplicar decisao antiga em
 * silencio, nada de criar empresa por engano, nada de furar supressao.
 */
export function validarDecisao(r: RadarDataset, p: PedidoDecisao): DecisaoValida | DecisaoRecusada {
  const motivos: MotivoRecusa[] = [];
  const bruto = registroPorId(r, p.registroFonteId);
  if (!bruto) return { ok: false, motivos: ['REGISTRO_AUSENTE'] };
  const analise = analisarCandidato(r, p.registroFonteId);
  if (!analise) return { ok: false, motivos: ['REGISTRO_NAO_GERENCIADO'] };
  const d = analise.registro;

  // contexto: status ainda decidivel e bruto ainda o mesmo que a tela viu
  if (d.status !== 'PENDING' && d.status !== 'REVIEW') motivos.push('STATUS_TERMINAL');
  if (p.payloadFingerprintEsperado !== d.payloadFingerprint) motivos.push('CONTEXTO_MUDOU');
  if (analise.bloqueios.includes('EVIDENCIA_ALTERADA')) motivos.push('EVIDENCIA_ALTERADA');
  if (analise.bloqueios.includes('IDENTIDADE_EXTERNA_DIVERGENTE')) motivos.push('IDENTIDADE_EXTERNA_DIVERGENTE');

  if (!DECISOES_LEAD_ENGINE.includes(p.decisao)) return { ok: false, motivos: [...motivos, 'DECISAO_DESCONHECIDA'] };

  // KEEP_REVIEW nao promove nada: so exige que o candidato ainda seja decidivel
  if (p.decisao === 'KEEP_REVIEW') return motivos.length ? { ok: false, motivos } : { ok: true, analise };

  if (p.decisao === 'REJECT') {
    if (!p.motivo?.trim()) motivos.push('MOTIVO_OBRIGATORIO');
    return motivos.length ? { ok: false, motivos } : { ok: true, analise };
  }

  // dai para baixo e promocao: os bloqueios duros valem
  if (analise.bloqueios.includes('OBSERVACAO_DESATUALIZADA')) motivos.push('OBSERVACAO_DESATUALIZADA');
  if (analise.bloqueios.includes('SUPRIMIDO')) motivos.push('SUPRIMIDO');
  if (analise.bloqueios.includes('SEM_ADAPTER')) motivos.push('SEM_ADAPTER');
  if (analise.bloqueios.includes('TIPO_SEM_PROMOCAO_AUTOMATICA')) motivos.push('TIPO_SEM_PROMOCAO_AUTOMATICA');
  if (!analise.empresaNormalizada) motivos.push('SEM_EMPRESA_NORMALIZADA');

  if (p.decisao === 'ASSOCIATE_EXISTING') {
    if (!p.empresaId) motivos.push('EMPRESA_OBRIGATORIA');
    const empresa = p.empresaId ? r.empresas.find((e) => e.id === p.empresaId) : undefined;
    const problema = p.empresaId ? empresaUtilizavel(empresa) : undefined;
    if (problema) motivos.push(problema);
    if (empresa && empresaSuprimidaNoRadar(empresa.id, r)) motivos.push('SUPRIMIDO');
    return motivos.length ? { ok: false, motivos } : { ok: true, analise, empresaAlvo: empresa };
  }

  // CREATE_COMPANY
  if (!analise.identidadeForte) motivos.push('SEM_IDENTIDADE_FORTE');
  // match forte quando a pessoa pediu criar: nunca duplicar — a tela tem de pedir associacao
  if (analise.match && analise.match.nivel !== 'possivel') motivos.push('JA_EXISTE_EMPRESA');
  return motivos.length ? { ok: false, motivos } : { ok: true, analise };
}

// ---------------------------------------------------------------------------------------------
// Promocao
// ---------------------------------------------------------------------------------------------

export interface ContextoDecisao extends Ids {
  usuarioId: string;
}

export interface ResultadoDecisao {
  radar: RadarDataset;
  status: StatusIntake;
  entidadeId?: string;
  empresaId?: string;
  projetoId?: string;
  sinalIds: string[];
  /** true quando uma Empresa nova nasceu desta decisao */
  empresaCriada: boolean;
}

/** Transiciona o PROPRIO RegistroFonte do staging. Nunca cria um segundo registro: a evidencia bruta e uma so. */
function transicionar(r: RadarDataset, id: string, para: StatusIntake, ctx: ContextoDecisao, extra: { entidadeId?: string; motivo?: string }): RadarDataset {
  return {
    ...r,
    registrosFonte: r.registrosFonte.map((x) =>
      x.id === id
        ? {
            ...x,
            statusIntake: para,
            entidadeId: extra.entidadeId ?? x.entidadeId,
            ...(para === 'RESOLVED' || para === 'REJECTED' ? { decididoEm: ctx.agora, decididoPor: ctx.usuarioId } : {}),
            ...(extra.motivo ? { motivoDecisao: extra.motivo } : {}),
          }
        : x,
    ),
  };
}

/**
 * Aplica a decisao humana ja validada. Funcao PURA sobre o RadarDataset.
 *
 * Nunca chama `ingerirRegistro`: aquele caminho CRIA um novo RegistroFonte, e a evidencia deste candidato ja existe
 * — duplicar o bruto seria perder a rastreabilidade. Usa os primitivos (`upsertEmpresa`, `upsertProjeto`,
 * `registrarSinalNormalizado`) e transiciona o registro existente.
 *
 * Nao cria Oportunidade, Tarefa, Atividade nem Comunicacao. Promocao e cadastro, nao pipeline comercial.
 */
export function aplicarDecisao(r: RadarDataset, p: PedidoDecisao, ctx: ContextoDecisao): { ok: true; resultado: ResultadoDecisao } | DecisaoRecusada {
  const v = validarDecisao(r, p);
  if (!v.ok) return v;
  const { analise } = v;
  const id = p.registroFonteId;

  if (p.decisao === 'KEEP_REVIEW') {
    const radar = analise.registro.status === 'REVIEW' ? r : transicionar(r, id, 'REVIEW', ctx, {});
    return { ok: true, resultado: { radar, status: 'REVIEW', sinalIds: [], empresaCriada: false } };
  }

  if (p.decisao === 'REJECT') {
    const radar = transicionar(r, id, 'REJECTED', ctx, { motivo: p.motivo!.trim(), entidadeId: analise.match?.empresaId });
    return { ok: true, resultado: { radar, status: 'REJECTED', entidadeId: analise.match?.empresaId, sinalIds: [], empresaCriada: false } };
  }

  const fonte = r.fontes.find((f) => f.id === analise.fonteId)!;
  const normalizado = analise.normalizado!;
  let radar = r;
  let empresaId: string;
  let empresaCriada = false;

  if (p.decisao === 'ASSOCIATE_EXISTING') {
    empresaId = v.empresaAlvo!.id;
  } else {
    // CREATE_COMPANY: o primitivo existente decide; match certo/provavel ja foi recusado na validacao, entao aqui
    // so pode nascer empresa nova (com PossivelDuplicata quando o match for 'possivel', comportamento preservado)
    const up = upsertEmpresa(radar, analise.empresaNormalizada!, fonte.id, ctx);
    radar = up.radar;
    empresaId = up.empresa.id;
    empresaCriada = up.resultado === 'importada' || up.resultado === 'duplicata_possivel';
  }

  let projetoId: string | undefined;
  if (normalizado.projeto && (analise.tipo === 'projeto' || analise.tipo === 'empresa')) {
    const pr = upsertProjeto(radar, empresaId, normalizado.projeto, fonte.id, ctx);
    radar = pr.radar;
    projetoId = pr.projeto.id;
  }

  const sinalIds: string[] = [];
  for (const s of normalizado.sinais ?? []) {
    const x = registrarSinalNormalizado(radar, empresaId, s, { id: fonte.id, tipo: fonte.tipo, confiabilidade: fonte.confiabilidade }, ctx, { projetoId, payload: normalizado.payload });
    radar = x.radar;
    if (x.resultado === 'importada') sinalIds.push(x.sinal.id);
  }

  // entidade principal segue o TIPO da observacao (o record_type diz do que a observacao fala)
  const entidadeId = analise.tipo === 'projeto' ? projetoId ?? empresaId : analise.tipo === 'sinal' ? sinalIds[0] ?? empresaId : empresaId;
  radar = transicionar(radar, id, 'RESOLVED', ctx, { entidadeId });
  return { ok: true, resultado: { radar, status: 'RESOLVED', entidadeId, empresaId, projetoId, sinalIds, empresaCriada } };
}
