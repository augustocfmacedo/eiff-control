// CM2-A — Fixtures congeladas dos casos temporais (28 obrigatorios + variantes) e vocabulario do contrato temporal.
//
// Modulo so de teste, compartilhado pela paridade (commercialCadence.paridade.test.ts, que guarda o contrato independente)
// e pelo teste do motor (commercialCadence.test.ts). Extraido do arquivo de paridade sem alterar nenhuma expectativa.
// Nao e importado por codigo de producao. Nenhum nome de conta real.
import { HIPOTESE_COMMERCIAL_MACHINE, type CategoriaCommercialQueue, type CodigoRazaoCM, type MotivoForaDaFila } from './commercialMachine';
import { radarVazio, type Atividade, type ComunicacaoRadar, type Contato, type Empresa, type Oportunidade, type RadarDataset, type Sinal, type Supressao, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Vocabulario do contrato temporal
// ---------------------------------------------------------------------------------------------------------------------
export const ESTADOS_TEMPORAIS = ['DEVIDA', 'AGUARDANDO', 'SUGERIR_PROXIMO_PASSO', 'PAUSADA', 'ENCERRADA', 'NAO_APLICAVEL'] as const;
export type EstadoTemporal = (typeof ESTADOS_TEMPORAIS)[number];
export type RetomaCom = 'DATA' | 'FATO_NOVO' | 'DECISAO_HUMANA' | 'DADO';
/** FIRME = data humana (tarefa/proximaAcaoEm); BASE_CM1 = data calculada pelo CM1-A; RECOMENDADA = lacuna D4; IMEDIATA = sem espera. */
export type Natureza = 'FIRME' | 'BASE_CM1' | 'RECOMENDADA' | 'IMEDIATA';
export type Sugestao = 'NENHUMA' | 'TRATAR_AGORA' | 'PEDIR_DATA' | 'RECOMENDAR_DATA' | 'DECISAO_HUMANA';
export const AVISOS_PREVISTOS = [
  'GATEKEEPER_NAO_CONTA_NO_LIMITE', 'ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA', 'CONTAGEM_POR_EMPRESA',
  'TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO', 'HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO', 'COMPROMISSOS_CONCORRENTES',
  'CONTATO_DA_TAREFA_INELEGIVEL', 'CANAL_DA_TAREFA_INDISPONIVEL', 'COMUNICACAO_PENDENTE_NO_MESMO_TOQUE', 'RESPONSAVEL_NECESSARIO',
  'CONTATO_RECOMENDADO_SEM_CANAL', 'CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA',
] as const;
export type Aviso = (typeof AVISOS_PREVISTOS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------
export const HOJE = '2026-09-15';
export const H = HIPOTESE_COMMERCIAL_MACHINE;
export const PESOS = [
  { chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 },
  { chave: 'persona.CEO.media', valor: 85 }, { chave: 'persona.OPERATIONS.media', valor: 55 }, { chave: 'persona.PROCUREMENT.media', valor: 30 },
];
export const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
export const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const maxDia = (a: string, b: string) => (a > b ? a : b);
export const emp = (id: string, priorityClass: Empresa['priorityClass'] = 'A'): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01',
  fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 70, priorityClass,
});
export const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({
  id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO', email: `${id}@conta-${empresaId}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p,
});
export const sin = (id: string, empresaId: string, p: Partial<Sinal> = {}): Sinal => ({
  id, empresaId, fonteId: 'f-news', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade', descricao: 'Nova unidade anunciada', eventoEm: '2026-09-10', detectadoEm: '2026-09-14',
  confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-14'), ...p,
});
export const atv = (id: string, empresaId: string, dia: string, p: Partial<Atividade> = {}): Atividade => ({
  id, empresaId, contatoId: `c-${empresaId}`, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts(dia), notas: '', criadoEm: ts(dia), ...p,
});
export const tar = (id: string, empresaId: string, venceEm: string, p: Partial<TarefaRadar> = {}): TarefaRadar => ({
  id, empresaId, contatoId: `c-${empresaId}`, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm, status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-10', '09:00'), ...p,
});
export const opp = (id: string, empresaId: string, p: Partial<Oportunidade> = {}): Oportunidade => ({
  id, empresaId, titulo: `Galpão ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: ts('2026-09-12'), atualizadoEm: ts('2026-09-12'), ...p,
});
export const com = (id: string, empresaId: string, p: Partial<ComunicacaoRadar> = {}): ComunicacaoRadar => ({
  id, empresaId, contatoId: `c-${empresaId}`, canal: 'EMAIL', objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', estado: 'READY_FOR_REVIEW', spec: {},
  resultado: { versaoPrincipal: 'texto', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: `h-${id}`,
  versoes: { playbook: '1', contentSpec: '3', prompt: '1', provedor: 'deterministico' }, validacao: { ok: true, problemas: [] }, criadoEm: ts('2026-09-13'), atualizadoEm: ts('2026-09-13'), criadoPor: 'u1', historico: [], ...p,
});
export const sup = (id: string, p: Partial<Supressao>): Supressao => ({ id, tipo: 'do_not_contact', motivo: 'teste', criadoPor: 'u1', criadoEm: ts('2026-09-01'), ...p });
/** Uma conta por caso, com contato padrao `c-<id>` (CEO, e-mail). */
export const conta = (id: string, p: Partial<RadarDataset> = {}, classe: Empresa['priorityClass'] = 'A', padrao: Partial<Contato> = {}): RadarDataset => ({
  ...radarVazio(), pesosDecisionFit: PESOS, ...p, empresas: [emp(id, classe)], contatos: [cont(`c-${id}`, id, padrao), ...(p.contatos ?? [])],
});
export const sequencia = (empresaId: string, dias: string[], p: (k: number) => Partial<Atividade>) => dias.map((d, k) => atv(`a${k}`, empresaId, d, p(k)));

export interface EsperadoCM1 {
  categoria: CategoriaCommercialQueue;
  codigo: CodigoRazaoCM;
  venceEm?: string;
  contatoId?: string;
  temAgenda: boolean;
  /** `CODIGO:ESTADO[@venceEm]`, na ordem da fila. */
  secundarias: string[];
  travas?: string[];
  semRespostaSeguidas?: number;
  acaoBloqueada?: CodigoRazaoCM;
  responsavelId?: string;
}
export interface EsperadoCM2 {
  estado: EstadoTemporal;
  retomaCom?: RetomaCom;
  proximoToque?: { natureza: Natureza; em?: string; ancora?: string };
  sugestao: Sugestao;
  avisos?: Aviso[];
}
export interface Caso {
  id: string; titulo: string; empresaId: string; ds: RadarDataset;
  cm1?: EsperadoCM1;
  foraDaFila?: MotivoForaDaFila;
  /** null = sem cadencia operacional (conta fora da Commercial Queue). */
  cm2: EsperadoCM2 | null;
}

export const CASOS: Caso[] = [
  { id: '01', titulo: 'Nunca contatada (A com decisor e canal)', empresaId: 'nunca', ds: conta('nunca'),
    cm1: { categoria: 'PROSPECTAR', codigo: 'CONTA_PRIORITARIA_NUNCA_ABORDADA', contatoId: 'c-nunca', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '01b', titulo: 'Nunca contatada (C sem historico) fica fora da fila', empresaId: 'nuncab', ds: conta('nuncab', {}, 'C'), foraDaFila: 'SEM_RELEVANCIA_ATUAL', cm2: null },
  { id: '02', titulo: 'Primeiro contato sem resposta (dentro do intervalo)', empresaId: 'primeira', ds: conta('primeira', { atividades: [atv('a1', 'primeira', '2026-09-13', { resultado: 'NO_RESPONSE' })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'FOLLOW_UP_EM_INTERVALO', venceEm: somarDias('2026-09-13', H.intervaloFollowUpDias), contatoId: 'c-primeira', temAgenda: false, secundarias: [], semRespostaSeguidas: 1 },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'BASE_CM1', em: somarDias('2026-09-13', H.intervaloFollowUpDias) }, sugestao: 'NENHUMA' } },
  { id: '03', titulo: 'Segunda tentativa (intervalo cumprido)', empresaId: 'segunda', ds: conta('segunda', { atividades: [atv('a1', 'segunda', '2026-09-08', { resultado: 'NO_RESPONSE' })] }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'FOLLOW_UP_SEM_RESPOSTA', contatoId: 'c-segunda', temAgenda: false, secundarias: [], semRespostaSeguidas: 1 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '04', titulo: 'Quinta tentativa sem resposta esgota a cadencia', empresaId: 'quinta', ds: conta('quinta', { atividades: sequencia('quinta', ['2026-08-01', '2026-08-05', '2026-08-10', '2026-08-15', '2026-08-20'], () => ({ resultado: 'NO_RESPONSE' })) }),
    cm1: { categoria: 'NURTURE', codigo: 'TENTATIVAS_ESGOTADAS', contatoId: 'c-quinta', temAgenda: false, secundarias: [], semRespostaSeguidas: H.limiteTentativasSemResposta },
    cm2: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO', sugestao: 'NENHUMA' } },
  { id: '04b', titulo: 'Quatro tentativas: a quinta esta devida', empresaId: 'quarta', ds: conta('quarta', { atividades: sequencia('quarta', ['2026-08-01', '2026-08-05', '2026-08-10', '2026-09-08'], () => ({ resultado: 'NO_RESPONSE' })) }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'FOLLOW_UP_SEM_RESPOSTA', contatoId: 'c-quarta', temAgenda: false, secundarias: [], semRespostaSeguidas: 4 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '05', titulo: 'Resposta positiva nao tratada', empresaId: 'positiva', ds: conta('positiva', { atividades: [atv('a1', 'positiva', '2026-09-14', { resultado: 'POSITIVE' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'RESPOSTA_NAO_TRATADA', contatoId: 'c-positiva', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'TRATAR_AGORA' } },
  { id: '05b', titulo: 'Resposta positiva tratada sem proximo compromisso (silencio: lacuna D4)', empresaId: 'posdepois',
    ds: conta('posdepois', { atividades: [atv('a1', 'posdepois', '2026-09-08', { resultado: 'POSITIVE' })], tarefas: [tar('t1', 'posdepois', '2026-09-10', { criadoEm: ts('2026-09-08', '11:00'), status: 'Concluída', concluidaEm: ts('2026-09-10') })] }),
    cm1: { categoria: 'NURTURE', codigo: 'SEM_TIMING_ATUAL', contatoId: 'c-posdepois', temAgenda: false, secundarias: [] },
    cm2: { estado: 'SUGERIR_PROXIMO_PASSO', proximoToque: { natureza: 'RECOMENDADA', ancora: '2026-09-10', em: maxDia(somarDias('2026-09-10', H.intervaloFollowUpDias), HOJE) }, sugestao: 'RECOMENDAR_DATA' } },
  { id: '06', titulo: 'Resposta negativa sem fato novo', empresaId: 'negativa', ds: conta('negativa', { atividades: [atv('a1', 'negativa', '2026-09-01', { resultado: 'NOT_INTERESTED' })] }),
    cm1: { categoria: 'NURTURE', codigo: 'RESULTADO_NEGATIVO_SEM_FATO_NOVO', contatoId: 'c-negativa', temAgenda: false, secundarias: [] },
    cm2: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO', sugestao: 'NENHUMA' } },
  { id: '06b', titulo: 'Negativa com tarefa futura criada antes: a tarefa continua mandando', empresaId: 'negtarefa',
    ds: conta('negtarefa', { atividades: [atv('a1', 'negtarefa', '2026-09-01', { resultado: 'NOT_INTERESTED' })], tarefas: [tar('t1', 'negtarefa', '2026-09-20', { criadoEm: ts('2026-08-25') })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-20', contatoId: 'c-negtarefa', temAgenda: true, secundarias: ['RESULTADO_NEGATIVO_SEM_FATO_NOVO:ADIADA'] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-20' }, sugestao: 'NENHUMA', avisos: ['TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO'] } },
  { id: '07', titulo: 'Gatekeeper: entra no intervalo e zera a contagem', empresaId: 'gate',
    ds: conta('gate', { atividades: [atv('a0', 'gate', '2026-09-05', { resultado: 'NO_RESPONSE' }), atv('a1', 'gate', '2026-09-13', { resultado: 'GATEKEEPER' })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'FOLLOW_UP_EM_INTERVALO', venceEm: somarDias('2026-09-13', H.intervaloFollowUpDias), contatoId: 'c-gate', temAgenda: false, secundarias: [], semRespostaSeguidas: 0 },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'BASE_CM1', em: somarDias('2026-09-13', H.intervaloFollowUpDias) }, sugestao: 'NENHUMA', avisos: ['GATEKEEPER_NAO_CONTA_NO_LIMITE'] } },
  { id: '07b', titulo: 'Gatekeeper alternado com sem resposta nunca esgota (divida C5)', empresaId: 'gates',
    ds: conta('gates', { atividades: sequencia('gates', ['2026-07-01', '2026-07-10', '2026-07-20', '2026-08-01', '2026-08-10', '2026-08-20'], (k) => ({ resultado: k % 2 ? 'GATEKEEPER' : 'NO_RESPONSE' })) }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'FOLLOW_UP_SEM_RESPOSTA', contatoId: 'c-gates', temAgenda: false, secundarias: [], semRespostaSeguidas: 0 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA', avisos: ['GATEKEEPER_NAO_CONTA_NO_LIMITE'] } },
  { id: '08', titulo: 'Callback com data so nas notas: falta data estruturada', empresaId: 'callback',
    ds: conta('callback', { atividades: [atv('a1', 'callback', '2026-09-14', { resultado: 'CALL_BACK', notas: 'pediu para ligar dia 25' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'RESPOSTA_NAO_TRATADA', contatoId: 'c-callback', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'PEDIR_DATA' } },
  { id: '08b', titulo: 'Callback com tarefa na data pedida: data humana soberana', empresaId: 'callbackt',
    ds: conta('callbackt', { atividades: [atv('a1', 'callbackt', '2026-09-14', { resultado: 'CALL_BACK' })], tarefas: [tar('t1', 'callbackt', '2026-09-25', { tipo: 'CALL', criadoEm: ts('2026-09-14', '11:00') })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-25', contatoId: 'c-callbackt', temAgenda: true, secundarias: [] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-25' }, sugestao: 'NENHUMA' } },
  { id: '09', titulo: 'Projeto futuro sem horizonte estruturado', empresaId: 'futuro', ds: conta('futuro', { atividades: [atv('a1', 'futuro', '2026-09-10', { resultado: 'FUTURE_PROJECT' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'RESPOSTA_NAO_TRATADA', contatoId: 'c-futuro', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'PEDIR_DATA' } },
  { id: '09b', titulo: 'Projeto futuro com horizonte guardado em oportunidade NURTURE (data ignorada pela fila)', empresaId: 'futuron',
    ds: conta('futuron', { atividades: [atv('a1', 'futuron', '2026-09-10', { resultado: 'FUTURE_PROJECT' })], oportunidades: [opp('o1', 'futuron', { estagio: 'NURTURE', proximaAcao: 'retomar', proximaAcaoEm: '2026-12-01', criadoEm: ts('2026-09-10', '11:00') })] }),
    cm1: { categoria: 'NURTURE', codigo: 'OPORTUNIDADE_EM_NURTURE', contatoId: 'c-futuron', temAgenda: false, secundarias: [] },
    cm2: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO', sugestao: 'DECISAO_HUMANA', avisos: ['HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO'] } },
  { id: '10', titulo: 'Pediu reuniao', empresaId: 'reuniao', ds: conta('reuniao', { atividades: [atv('a1', 'reuniao', '2026-09-14', { resultado: 'REQUESTED_MEETING' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'RESPOSTA_NAO_TRATADA', contatoId: 'c-reuniao', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'PEDIR_DATA' } },
  { id: '11', titulo: 'Pediu orcamento', empresaId: 'orcamento', ds: conta('orcamento', { atividades: [atv('a1', 'orcamento', '2026-09-14', { resultado: 'REQUESTED_BUDGET' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'RESPOSTA_NAO_TRATADA', contatoId: 'c-orcamento', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'TRATAR_AGORA' } },
  { id: '12', titulo: 'Telefone invalido: segue sem intervalo pelo canal restante', empresaId: 'telinv',
    ds: conta('telinv', { atividades: [atv('a1', 'telinv', '2026-09-14', { resultado: 'INVALID_CONTACT' })], supressoes: [sup('s1', { contatoId: 'c-telinv', tipo: 'invalid_phone' })] }, 'A', { telefone: '556232220000' }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'TENTATIVA_CONTATO_INVALIDO', contatoId: 'c-telinv', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '12b', titulo: 'Tarefa CALL aberta para contato com telefone suprimido', empresaId: 'tarefacanal',
    ds: conta('tarefacanal', { supressoes: [sup('s1', { contatoId: 'c-tarefacanal', tipo: 'invalid_phone' })], atividades: [atv('a0', 'tarefacanal', '2026-09-01', { resultado: 'DECISION_MAKER_REACHED' })], tarefas: [tar('t1', 'tarefacanal', '2026-09-20', { tipo: 'CALL' })] }, 'A', { telefone: '556232220000' }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-20', contatoId: 'c-tarefacanal', temAgenda: true, secundarias: [] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-20' }, sugestao: 'NENHUMA', avisos: ['CANAL_DA_TAREFA_INDISPONIVEL'] } },
  { id: '13', titulo: 'E-mail devolvido: recomendado sem canal, mesmo com contato alternativo com telefone', empresaId: 'bounce',
    ds: conta('bounce', { contatos: [cont('c2-bounce', 'bounce', { persona: 'OPERATIONS', email: undefined, celular: '5562999990000' })], atividades: [atv('a1', 'bounce', '2026-09-14', { tipo: 'EMAIL', canal: 'EMAIL', resultado: 'INVALID_CONTACT' })], supressoes: [sup('s1', { contatoId: 'c-bounce', tipo: 'email_bounced' })] }),
    cm1: { categoria: 'ENRIQUECER', codigo: 'SEM_CANAL_VALIDO', contatoId: 'c-bounce', temAgenda: false, secundarias: [] },
    cm2: { estado: 'PAUSADA', retomaCom: 'DADO', sugestao: 'NENHUMA', avisos: ['CONTATO_RECOMENDADO_SEM_CANAL'] } },
  { id: '14', titulo: 'Troca de contato: tentativas contam por empresa', empresaId: 'troca',
    ds: conta('troca', { contatos: [cont('c2-troca', 'troca', { persona: 'OPERATIONS' })], atividades: [...sequencia('troca', ['2026-08-01', '2026-08-05', '2026-08-10', '2026-08-15'], () => ({ resultado: 'NO_RESPONSE' })), atv('a9', 'troca', '2026-09-13', { contatoId: 'c2-troca', resultado: 'NO_RESPONSE' })] }),
    cm1: { categoria: 'NURTURE', codigo: 'TENTATIVAS_ESGOTADAS', contatoId: 'c-troca', temAgenda: false, secundarias: [], semRespostaSeguidas: H.limiteTentativasSemResposta },
    cm2: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO', sugestao: 'NENHUMA', avisos: ['CONTAGEM_POR_EMPRESA'] } },
  { id: '15', titulo: 'Tarefa futura existente segura o follow-up', empresaId: 'futura',
    ds: conta('futura', { atividades: [atv('a1', 'futura', '2026-09-01', { resultado: 'NO_RESPONSE' })], tarefas: [tar('t1', 'futura', '2026-09-20')] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-20', contatoId: 'c-futura', temAgenda: true, secundarias: ['FOLLOW_UP_SEM_RESPOSTA:ADIADA'], semRespostaSeguidas: 1 },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-20' }, sugestao: 'NENHUMA' } },
  { id: '16', titulo: 'Duas tarefas abertas: a mais proxima e a principal', empresaId: 'duas', ds: conta('duas', { tarefas: [tar('t1', 'duas', '2026-09-20'), tar('t2', 'duas', '2026-09-18')] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-18', contatoId: 'c-duas', temAgenda: true, secundarias: ['CONTA_PRIORITARIA_NUNCA_ABORDADA:ADIADA', 'PROXIMA_ACAO_AGENDADA:PENDENTE@2026-09-20'] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-18' }, sugestao: 'NENHUMA', avisos: ['COMPROMISSOS_CONCORRENTES'] } },
  { id: '17', titulo: 'Oportunidade ativa com proxima acao futura', empresaId: 'oppativa', ds: conta('oppativa', { oportunidades: [opp('o1', 'oppativa', { proximaAcao: 'ligar', proximaAcaoEm: '2026-09-19' })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-19', contatoId: 'c-oppativa', temAgenda: true, secundarias: [] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-19' }, sugestao: 'NENHUMA' } },
  { id: '17b', titulo: 'Oportunidade ativa sem proxima acao: data limitada pelo SLA restante', empresaId: 'oppsem', ds: conta('oppsem', { oportunidades: [opp('o1', 'oppsem')] }),
    cm1: { categoria: 'AVANCAR_OPORTUNIDADE', codigo: 'OPORTUNIDADE_SEM_PROXIMA_ACAO', contatoId: 'c-oppsem', temAgenda: false, secundarias: [] },
    cm2: { estado: 'SUGERIR_PROXIMO_PASSO', proximoToque: { natureza: 'RECOMENDADA', ancora: '2026-09-12', em: maxDia(somarDias('2026-09-12', H.slaEstagioDias.ENGAGED), HOJE) }, sugestao: 'RECOMENDAR_DATA' } },
  { id: '18', titulo: 'Oportunidade parada: o aging nao cede a acao futura', empresaId: 'parada',
    ds: conta('parada', { oportunidades: [opp('o1', 'parada', { estagio: 'PROPOSAL_SENT', criadoEm: ts('2026-09-08') })], tarefas: [tar('t1', 'parada', '2026-09-20', { oportunidadeId: 'o1' })] }),
    cm1: { categoria: 'AVANCAR_OPORTUNIDADE', codigo: 'OPORTUNIDADE_PARADA', contatoId: 'c-parada', temAgenda: true, secundarias: ['PROXIMA_ACAO_AGENDADA:PENDENTE@2026-09-20'] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '18b', titulo: 'Oportunidade parada critica', empresaId: 'critica',
    ds: conta('critica', { oportunidades: [opp('o1', 'critica', { estagio: 'NEGOTIATION', criadoEm: ts('2026-08-20') })], tarefas: [tar('t1', 'critica', '2026-09-30', { oportunidadeId: 'o1' })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'OPORTUNIDADE_PARADA_CRITICA', contatoId: 'c-critica', temAgenda: true, secundarias: ['PROXIMA_ACAO_AGENDADA:PENDENTE@2026-09-30'] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '19', titulo: 'Negociacao dentro do SLA com acao marcada', empresaId: 'negocia',
    ds: conta('negocia', { oportunidades: [opp('o1', 'negocia', { estagio: 'NEGOTIATION', criadoEm: ts('2026-09-12'), proximaAcao: 'fechar condições', proximaAcaoEm: '2026-09-16' })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'PROXIMA_ACAO_AGENDADA', venceEm: '2026-09-16', contatoId: 'c-negocia', temAgenda: true, secundarias: [] },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-16' }, sugestao: 'NENHUMA' } },
  { id: '20', titulo: 'Oportunidade em NURTURE (proximaAcaoEm nao e lida pela fila)', empresaId: 'nurtureh',
    ds: conta('nurtureh', { atividades: [atv('a0', 'nurtureh', '2026-05-20', { resultado: 'DECISION_MAKER_REACHED' })], oportunidades: [opp('o1', 'nurtureh', { estagio: 'NURTURE', criadoEm: ts('2026-06-01'), proximaAcao: 'retomar', proximaAcaoEm: '2026-10-01' })] }),
    cm1: { categoria: 'NURTURE', codigo: 'OPORTUNIDADE_EM_NURTURE', contatoId: 'c-nurtureh', temAgenda: false, secundarias: [] },
    cm2: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO', sugestao: 'DECISAO_HUMANA', avisos: ['HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO'] } },
  { id: '20b', titulo: 'NURTURE sem nenhuma atividade vira conta nunca abordada', empresaId: 'nurture',
    ds: conta('nurture', { oportunidades: [opp('o1', 'nurture', { estagio: 'NURTURE', criadoEm: ts('2026-06-01'), proximaAcao: 'retomar', proximaAcaoEm: '2026-10-01' })] }),
    cm1: { categoria: 'PROSPECTAR', codigo: 'CONTA_PRIORITARIA_NUNCA_ABORDADA', contatoId: 'c-nurture', temAgenda: false, secundarias: ['OPORTUNIDADE_EM_NURTURE:PENDENTE'] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA', avisos: ['CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA', 'HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO'] } },
  { id: '21', titulo: 'LOST sem fato novo', empresaId: 'lost', ds: conta('lost', { oportunidades: [opp('o1', 'lost', { estagio: 'LOST', fechadoEm: '2026-08-15', motivoFechamento: 'preço' })] }),
    cm1: { categoria: 'NURTURE', codigo: 'OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO', contatoId: 'c-lost', temAgenda: false, secundarias: [] },
    cm2: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO', sugestao: 'NENHUMA' } },
  { id: '21b', titulo: 'LOST reaberto por qualquer atividade posterior (assimetria C8)', empresaId: 'lostdepois',
    ds: conta('lostdepois', { oportunidades: [opp('o1', 'lostdepois', { estagio: 'LOST', fechadoEm: '2026-08-15', motivoFechamento: 'preço' })], atividades: [atv('a1', 'lostdepois', '2026-09-13', { resultado: 'NO_RESPONSE' })] }),
    cm1: { categoria: 'AGENDADO', codigo: 'FOLLOW_UP_EM_INTERVALO', venceEm: somarDias('2026-09-13', H.intervaloFollowUpDias), contatoId: 'c-lostdepois', temAgenda: false, secundarias: [], semRespostaSeguidas: 1 },
    cm2: { estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'BASE_CM1', em: somarDias('2026-09-13', H.intervaloFollowUpDias) }, sugestao: 'NENHUMA' } },
  { id: '22', titulo: 'WON sem negocio ativo', empresaId: 'wonh',
    ds: conta('wonh', { atividades: [atv('a0', 'wonh', '2026-07-01', { resultado: 'POSITIVE' })], oportunidades: [opp('o1', 'wonh', { estagio: 'WON', criadoEm: ts('2026-07-02'), fechadoEm: '2026-08-10', motivoFechamento: 'fechado' })] }),
    cm1: { categoria: 'NURTURE', codigo: 'CLIENTE_GANHO', contatoId: 'c-wonh', temAgenda: false, secundarias: [] },
    cm2: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO', sugestao: 'NENHUMA' } },
  { id: '22b', titulo: 'WON sem nenhuma atividade vira conta nunca abordada', empresaId: 'won',
    ds: conta('won', { oportunidades: [opp('o1', 'won', { estagio: 'WON', fechadoEm: '2026-08-10', motivoFechamento: 'fechado' })] }),
    cm1: { categoria: 'PROSPECTAR', codigo: 'CONTA_PRIORITARIA_NUNCA_ABORDADA', contatoId: 'c-won', temAgenda: false, secundarias: ['CLIENTE_GANHO:PENDENTE'] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA', avisos: ['CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA'] } },
  { id: '23', titulo: 'Sinal novo durante o intervalo fura a espera', empresaId: 'sinalint',
    ds: conta('sinalint', { atividades: [atv('a1', 'sinalint', '2026-09-13', { resultado: 'NO_RESPONSE' })], sinais: [sin('s1', 'sinalint')] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'SINAL_ACIONAVEL_NOVO', contatoId: 'c-sinalint', temAgenda: false, secundarias: [`FOLLOW_UP_EM_INTERVALO:PENDENTE@${somarDias('2026-09-13', H.intervaloFollowUpDias)}`], semRespostaSeguidas: 1 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '23b', titulo: 'Sinal novo fura tarefa futura criada antes da deteccao', empresaId: 'sinalag',
    ds: conta('sinalag', { sinais: [sin('s1', 'sinalag')], tarefas: [tar('t1', 'sinalag', '2026-09-20', { criadoEm: ts('2026-09-10') })] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'SINAL_ACIONAVEL_NOVO', contatoId: 'c-sinalag', temAgenda: true, secundarias: ['PROXIMA_ACAO_AGENDADA:PENDENTE@2026-09-20'] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '23c', titulo: 'Sinal novo apos negativa e fato novo', empresaId: 'sinalneg',
    ds: conta('sinalneg', { atividades: [atv('a1', 'sinalneg', '2026-09-01', { resultado: 'NOT_INTERESTED' })], sinais: [sin('s1', 'sinalneg')] }),
    cm1: { categoria: 'AGIR_AGORA', codigo: 'SINAL_ACIONAVEL_NOVO', contatoId: 'c-sinalneg', temAgenda: false, secundarias: [] },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '24', titulo: 'Empresa suprimida fica fora da fila mesmo com tarefa vencida', empresaId: 'supr',
    ds: conta('supr', { supressoes: [sup('s1', { empresaId: 'supr' })], tarefas: [tar('t1', 'supr', '2026-09-10')] }), foraDaFila: 'EMPRESA_SUPRIMIDA', cm2: null },
  { id: '25', titulo: 'Contato suprimido com tarefa vencida vira trava', empresaId: 'csupr',
    ds: conta('csupr', { contatos: [cont('c2-csupr', 'csupr', { persona: 'OPERATIONS' })], supressoes: [sup('s1', { contatoId: 'c-csupr', tipo: 'opt_out' })], tarefas: [tar('t1', 'csupr', '2026-09-12')] }),
    cm1: { categoria: 'REVISAR', codigo: 'TRAVA_PARA_RESOLVER', venceEm: '2026-09-12', contatoId: 'c2-csupr', temAgenda: false, acaoBloqueada: 'TAREFA_VENCIDA', secundarias: ['TAREFA_VENCIDA:BLOQUEADA@2026-09-12', 'CONTA_PRIORITARIA_NUNCA_ABORDADA:PENDENTE'], travas: ['CONTATO_INELEGIVEL:true'] },
    cm2: { estado: 'PAUSADA', retomaCom: 'DECISAO_HUMANA', sugestao: 'DECISAO_HUMANA', avisos: ['CONTATO_DA_TAREFA_INELEGIVEL'] } },
  { id: '26', titulo: 'Comunicacao em revisao nao segura o follow-up devido', empresaId: 'revisao',
    ds: conta('revisao', { atividades: [atv('a1', 'revisao', '2026-09-08', { resultado: 'NO_RESPONSE' })], comunicacoes: [com('m1', 'revisao')] }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'FOLLOW_UP_SEM_RESPOSTA', contatoId: 'c-revisao', temAgenda: false, secundarias: ['COMUNICACAO_PARA_REVISAO:PENDENTE'], semRespostaSeguidas: 1 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA', avisos: ['COMUNICACAO_PENDENTE_NO_MESMO_TOQUE'] } },
  { id: '27', titulo: 'Comunicacao aprovada aguardando envio manual', empresaId: 'aprovada',
    ds: conta('aprovada', { atividades: [atv('a1', 'aprovada', '2026-09-08', { resultado: 'NO_RESPONSE' })], comunicacoes: [com('m1', 'aprovada', { estado: 'APPROVED', aprovadoEm: ts('2026-09-14') })] }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'COMUNICACAO_APROVADA_NAO_ENVIADA', contatoId: 'c-aprovada', temAgenda: false, secundarias: ['FOLLOW_UP_SEM_RESPOSTA:PENDENTE'], semRespostaSeguidas: 1 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA' } },
  { id: '28', titulo: 'Conta sem responsavel: inconsistencia na frente da agenda', empresaId: 'semdono',
    ds: conta('semdono', { oportunidades: [opp('o1', 'semdono', { responsavelId: '', proximaAcao: 'retomar', proximaAcaoEm: '2026-09-25' })] }, 'B'),
    cm1: { categoria: 'REVISAR', codigo: 'INCONSISTENCIA_PARA_REVISAR', contatoId: 'c-semdono', temAgenda: true, responsavelId: undefined, secundarias: ['PROXIMA_ACAO_AGENDADA:PENDENTE@2026-09-25'], travas: ['OPORTUNIDADE_SEM_RESPONSAVEL:false'] },
    cm2: { estado: 'NAO_APLICAVEL', proximoToque: { natureza: 'FIRME', em: '2026-09-25' }, sugestao: 'DECISAO_HUMANA', avisos: ['RESPONSAVEL_NECESSARIO'] } },
  { id: 'C6', titulo: 'Atividade sem resultado conta como tentativa sem resposta', empresaId: 'semres',
    ds: conta('semres', { atividades: [atv('a1', 'semres', '2026-09-08', { tipo: 'MEETING', canal: 'VISIT' })] }),
    cm1: { categoria: 'FOLLOW_UP', codigo: 'FOLLOW_UP_SEM_RESPOSTA', contatoId: 'c-semres', temAgenda: false, secundarias: [], semRespostaSeguidas: 1 },
    cm2: { estado: 'DEVIDA', proximoToque: { natureza: 'IMEDIATA' }, sugestao: 'NENHUMA', avisos: ['ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA'] } },
];

/** Os 28 casos obrigatorios da auditoria CM2-A (variantes b/C6 caracterizam achados). */
export const OBRIGATORIOS = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));
