// CM2-A — Congelamento do contrato temporal e da paridade com o CM1-A.1.
//
// Este arquivo NAO testa um Cadence Engine (ele ainda nao existe). Ele caracteriza o que o CM1-A.1 faz hoje em 28 casos
// temporais (mais variantes) e fixa, como dado, o comportamento que o futuro CM2 devera respeitar. Quando o CM2-B nascer,
// os campos `cm2` destas fixtures viram expectativa executavel; se o motor da fila mudar, os campos `cm1` quebram aqui.
// Contrato: docs/commercial-machine-cm2.md. Nenhum nome de conta real.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODIGOS_RAZAO_CM, HIPOTESE_COMMERCIAL_MACHINE, VERSAO_REGRAS_CM, construirCommercialQueue, type CategoriaCommercialQueue, type CodigoRazaoCM, type CommercialQueue, type MotivoForaDaFila } from './commercialMachine';
import { HIPOTESE_RECENCIA_FALLBACK_DIAS, JANELAS_FAMILIA } from './sinalLeitura';
import { estagioAtivo, radarVazio, type Atividade, type ComunicacaoRadar, type Contato, type Empresa, type Oportunidade, type RadarDataset, type Sinal, type Supressao, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Contrato temporal do CM2 (dado congelado; a implementacao vira no CM2-B)
// ---------------------------------------------------------------------------------------------------------------------
const ESTADOS_TEMPORAIS = ['DEVIDA', 'AGUARDANDO', 'SUGERIR_PROXIMO_PASSO', 'PAUSADA', 'ENCERRADA', 'NAO_APLICAVEL'] as const;
type EstadoTemporal = (typeof ESTADOS_TEMPORAIS)[number];
type RetomaCom = 'DATA' | 'FATO_NOVO' | 'DECISAO_HUMANA' | 'DADO';
/** FIRME = data humana (tarefa/proximaAcaoEm); BASE_CM1 = data calculada pelo CM1-A; RECOMENDADA = lacuna D4; IMEDIATA = sem espera. */
type Natureza = 'FIRME' | 'BASE_CM1' | 'RECOMENDADA' | 'IMEDIATA';
type Sugestao = 'NENHUMA' | 'TRATAR_AGORA' | 'PEDIR_DATA' | 'RECOMENDAR_DATA' | 'DECISAO_HUMANA';
const AVISOS_PREVISTOS = [
  'GATEKEEPER_NAO_CONTA_NO_LIMITE', 'ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA', 'CONTAGEM_POR_EMPRESA',
  'TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO', 'HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO', 'COMPROMISSOS_CONCORRENTES',
  'CONTATO_DA_TAREFA_INELEGIVEL', 'CANAL_DA_TAREFA_INDISPONIVEL', 'COMUNICACAO_PENDENTE_NO_MESMO_TOQUE', 'RESPONSAVEL_NECESSARIO',
  'CONTATO_RECOMENDADO_SEM_CANAL', 'CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA',
] as const;
type Aviso = (typeof AVISOS_PREVISTOS)[number];

/**
 * Estado temporal por razao principal do CM1-A. O motivo operacional continua sendo o proprio codigo do CM1-A
 * (o CM2 nao cria segunda taxonomia comercial). `lacunaD4`: a razao pode virar SUGERIR_PROXIMO_PASSO quando ha ancora real.
 */
const CONTRATO_TEMPORAL: Readonly<Record<CodigoRazaoCM, { estado: EstadoTemporal; retomaCom?: RetomaCom; lacunaD4?: true }>> = {
  RESPOSTA_NAO_TRATADA: { estado: 'DEVIDA' },
  TAREFA_VENCIDA: { estado: 'DEVIDA' },
  OPORTUNIDADE_ACAO_VENCIDA: { estado: 'DEVIDA' },
  SINAL_ACIONAVEL_NOVO: { estado: 'DEVIDA' },
  OPORTUNIDADE_PARADA_CRITICA: { estado: 'DEVIDA' },
  OPORTUNIDADE_SEM_PROXIMA_ACAO: { estado: 'SUGERIR_PROXIMO_PASSO' },
  OPORTUNIDADE_PARADA: { estado: 'DEVIDA' },
  PROXIMA_ACAO_HOJE: { estado: 'DEVIDA' },
  COMUNICACAO_APROVADA_NAO_ENVIADA: { estado: 'DEVIDA' },
  FOLLOW_UP_SEM_RESPOSTA: { estado: 'DEVIDA' },
  TENTATIVA_CONTATO_INVALIDO: { estado: 'DEVIDA' },
  COMUNICACAO_PARA_REVISAO: { estado: 'DEVIDA' },
  TRAVA_PARA_RESOLVER: { estado: 'PAUSADA', retomaCom: 'DECISAO_HUMANA' },
  INCONSISTENCIA_PARA_REVISAR: { estado: 'NAO_APLICAVEL' },
  CONTA_PRIORITARIA_NUNCA_ABORDADA: { estado: 'DEVIDA' },
  SINAL_NAO_VERIFICADO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR_IDEAL_PARA_SINAL: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_CANAL_VALIDO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  RESULTADO_NEGATIVO_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  TENTATIVAS_ESGOTADAS: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_EM_NURTURE: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  CLIENTE_GANHO: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  SEM_TIMING_ATUAL: { estado: 'NAO_APLICAVEL', lacunaD4: true },
  PROXIMA_ACAO_AGENDADA: { estado: 'AGUARDANDO', retomaCom: 'DATA' },
  FOLLOW_UP_EM_INTERVALO: { estado: 'AGUARDANDO', retomaCom: 'DATA' },
};

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const H = HIPOTESE_COMMERCIAL_MACHINE;
const PESOS = [
  { chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 },
  { chave: 'persona.CEO.media', valor: 85 }, { chave: 'persona.OPERATIONS.media', valor: 55 }, { chave: 'persona.PROCUREMENT.media', valor: 30 },
];
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const maxDia = (a: string, b: string) => (a > b ? a : b);
const emp = (id: string, priorityClass: Empresa['priorityClass'] = 'A'): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01',
  fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 70, priorityClass,
});
const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({
  id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO', email: `${id}@conta-${empresaId}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p,
});
const sin = (id: string, empresaId: string, p: Partial<Sinal> = {}): Sinal => ({
  id, empresaId, fonteId: 'f-news', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade', descricao: 'Nova unidade anunciada', eventoEm: '2026-09-10', detectadoEm: '2026-09-14',
  confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-14'), ...p,
});
const atv = (id: string, empresaId: string, dia: string, p: Partial<Atividade> = {}): Atividade => ({
  id, empresaId, contatoId: `c-${empresaId}`, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts(dia), notas: '', criadoEm: ts(dia), ...p,
});
const tar = (id: string, empresaId: string, venceEm: string, p: Partial<TarefaRadar> = {}): TarefaRadar => ({
  id, empresaId, contatoId: `c-${empresaId}`, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm, status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-10', '09:00'), ...p,
});
const opp = (id: string, empresaId: string, p: Partial<Oportunidade> = {}): Oportunidade => ({
  id, empresaId, titulo: `Galpão ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: ts('2026-09-12'), atualizadoEm: ts('2026-09-12'), ...p,
});
const com = (id: string, empresaId: string, p: Partial<ComunicacaoRadar> = {}): ComunicacaoRadar => ({
  id, empresaId, contatoId: `c-${empresaId}`, canal: 'EMAIL', objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', estado: 'READY_FOR_REVIEW', spec: {},
  resultado: { versaoPrincipal: 'texto', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: `h-${id}`,
  versoes: { playbook: '1', contentSpec: '3', prompt: '1', provedor: 'deterministico' }, validacao: { ok: true, problemas: [] }, criadoEm: ts('2026-09-13'), atualizadoEm: ts('2026-09-13'), criadoPor: 'u1', historico: [], ...p,
});
const sup = (id: string, p: Partial<Supressao>): Supressao => ({ id, tipo: 'do_not_contact', motivo: 'teste', criadoPor: 'u1', criadoEm: ts('2026-09-01'), ...p });
/** Uma conta por caso, com contato padrao `c-<id>` (CEO, e-mail). */
const conta = (id: string, p: Partial<RadarDataset> = {}, classe: Empresa['priorityClass'] = 'A', padrao: Partial<Contato> = {}): RadarDataset => ({
  ...radarVazio(), pesosDecisionFit: PESOS, ...p, empresas: [emp(id, classe)], contatos: [cont(`c-${id}`, id, padrao), ...(p.contatos ?? [])],
});
const sequencia = (empresaId: string, dias: string[], p: (k: number) => Partial<Atividade>) => dias.map((d, k) => atv(`a${k}`, empresaId, d, p(k)));

interface EsperadoCM1 {
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
interface EsperadoCM2 {
  estado: EstadoTemporal;
  retomaCom?: RetomaCom;
  proximoToque?: { natureza: Natureza; em?: string; ancora?: string };
  sugestao: Sugestao;
  avisos?: Aviso[];
}
interface Caso {
  id: string; titulo: string; empresaId: string; ds: RadarDataset;
  cm1?: EsperadoCM1;
  foraDaFila?: MotivoForaDaFila;
  /** null = sem cadencia operacional (conta fora da Commercial Queue). */
  cm2: EsperadoCM2 | null;
}

const CASOS: Caso[] = [
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
const OBRIGATORIOS = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));

// Agenda na regra do CM1-A (passo 10), recalculada aqui so para congelar o fato na fixture.
const temAgendaDe = (r: RadarDataset, empresaId: string) =>
  r.tarefas.some((t) => t.empresaId === empresaId && t.status === 'Aberta' && t.venceEm.slice(0, 10) >= HOJE)
  || r.oportunidades.some((o) => o.empresaId === empresaId && estagioAtivo(o.estagio) && !!o.proximaAcaoEm && o.proximaAcaoEm.slice(0, 10) >= HOJE);

const filaDe = (c: Caso): CommercialQueue => construirCommercialQueue(c.ds, HOJE);

// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-A — hipoteses temporais do CM1-A.1 congeladas', () => {
  it('versao e valores das hipoteses nao mudaram (mudar exige nova versao e recalibracao aprovada)', () => {
    expect(VERSAO_REGRAS_CM).toBe('CM1-A.1');
    expect(HIPOTESE_COMMERCIAL_MACHINE).toEqual({
      slaEstagioDias: { DETECTED: 14, RESEARCHING: 10, QUALIFIED: 7, DECISION_MAKER_FOUND: 5, CONTACT_STARTED: 5, ENGAGED: 7, NEED_CONFIRMED: 7, PROJECT_RECEIVED: 3, ENGINEERING: 10, PRICING: 7, PROPOSAL_SENT: 5, NEGOTIATION: 5 },
      multiplicadorParadaCritica: 2, intervaloFollowUpDias: 4, limiteTentativasSemResposta: 5, sinalNovoDias: 7, fitAdequadoPadrao: 40,
    });
    expect(JANELAS_FAMILIA).toEqual({ LONG_CYCLE: 540, MEDIUM_CYCLE: 270, SHORT_CYCLE: 120 });
    expect(HIPOTESE_RECENCIA_FALLBACK_DIAS).toBe(120);
  });
});

describe('CM2-A — paridade CM1-A.1 nos casos temporais', () => {
  it('cobre os 28 casos obrigatorios, sem id repetido', () => {
    const ids = CASOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of OBRIGATORIOS) expect(ids, `caso ${id}`).toContain(id);
  });

  for (const c of CASOS) {
    it(`${c.id} — ${c.titulo}`, () => {
      const q = filaDe(c);
      const item = q.itens.find((i) => i.empresaId === c.empresaId);
      if (c.foraDaFila) {
        expect(item).toBeUndefined();
        expect(q.foraDaFila).toContainEqual({ empresaId: c.empresaId, motivo: c.foraDaFila });
        return;
      }
      const e = c.cm1!;
      expect(item, 'conta na fila').toBeDefined();
      const p = item!.porQueAgora;
      expect(item!.categoria).toBe(e.categoria);
      expect(p.codigo).toBe(e.codigo);
      expect(p.venceEm).toBe(e.venceEm);
      expect(item!.contato?.id).toBe(e.contatoId);
      expect(temAgendaDe(c.ds, c.empresaId), 'agenda').toBe(e.temAgenda);
      expect(item!.secundarias.map((s) => `${s.codigo}:${s.estado}${s.venceEm ? `@${s.venceEm}` : ''}`)).toEqual(e.secundarias);
      expect(item!.travas.map((t) => `${t.codigo}:${t.bloqueante}`)).toEqual(e.travas ?? []);
      if (e.semRespostaSeguidas !== undefined) expect(item!.historico.semRespostaSeguidas).toBe(e.semRespostaSeguidas);
      if (e.acaoBloqueada) expect(p.acaoBloqueada).toBe(e.acaoBloqueada);
      if ('responsavelId' in e) expect(item!.responsavelId).toBe(e.responsavelId);
    });
  }
});

describe('CM2-A — contrato temporal que o CM2 devera respeitar', () => {
  it('toda razao do CM1-A tem estado temporal e todo estado usado existe', () => {
    expect(Object.keys(CONTRATO_TEMPORAL).sort()).toEqual([...CODIGOS_RAZAO_CM].sort());
    for (const r of Object.values(CONTRATO_TEMPORAL)) expect(ESTADOS_TEMPORAIS).toContain(r.estado);
  });

  it('o estado temporal nao duplica a taxonomia comercial: nenhum estado tem nome de razao do CM1-A', () => {
    for (const e of ESTADOS_TEMPORAIS) expect(CODIGOS_RAZAO_CM as readonly string[]).not.toContain(e);
  });

  for (const c of CASOS) {
    it(`${c.id} — expectativa CM2 coerente com o CM1-A`, () => {
      if (!c.cm1) { expect(c.cm2, 'fora da fila nao tem cadencia operacional').toBeNull(); return; }
      const cm2 = c.cm2!;
      const q = filaDe(c);
      const item = q.itens.find((i) => i.empresaId === c.empresaId)!;
      const regra = CONTRATO_TEMPORAL[item.porQueAgora.codigo];

      // estado vem da razao principal; SUGERIR_PROXIMO_PASSO so onde o contrato admite lacuna D4
      if (cm2.estado === 'SUGERIR_PROXIMO_PASSO' && regra.lacunaD4) expect(regra.estado).toBe('NAO_APLICAVEL');
      else expect(cm2.estado).toBe(regra.estado);
      expect(cm2.retomaCom).toBe(regra.retomaCom);

      const t = cm2.proximoToque;
      // data RECOMENDADA so em SUGERIR_PROXIMO_PASSO, sempre com ancora real e nunca antes de hoje
      if (t?.natureza === 'RECOMENDADA') {
        expect(cm2.estado).toBe('SUGERIR_PROXIMO_PASSO');
        expect(t.ancora).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(t.em! >= HOJE).toBe(true);
        expect(cm2.sugestao).toBe('RECOMENDAR_DATA');
      }
      if (cm2.estado === 'SUGERIR_PROXIMO_PASSO') expect(t?.natureza).toBe('RECOMENDADA');
      // FIRME e BASE_CM1 repetem uma data que o CM1-A ja produziu (principal ou secundaria): nunca uma segunda verdade
      if (t?.natureza === 'FIRME' || t?.natureza === 'BASE_CM1') {
        const datas = [item.porQueAgora.venceEm, ...item.secundarias.map((s) => s.venceEm)].filter(Boolean);
        expect(datas).toContain(t.em);
        if (item.porQueAgora.venceEm) expect(t.em).toBe(item.porQueAgora.venceEm);
      }
      if (t?.natureza === 'BASE_CM1') expect(item.porQueAgora.codigo).toBe('FOLLOW_UP_EM_INTERVALO');
      if (cm2.estado === 'AGUARDANDO') expect(t && t.em! > HOJE).toBe(true);
      // IMEDIATA nao carrega data; PEDIR_DATA nunca inventa horizonte
      if (t?.natureza === 'IMEDIATA') expect(t.em).toBeUndefined();
      if (cm2.sugestao === 'PEDIR_DATA') expect(t?.em).toBeUndefined();
      // pausa e encerramento nao tem proximo toque
      if (cm2.estado === 'PAUSADA' || cm2.estado === 'ENCERRADA') expect(t).toBeUndefined();
      for (const a of cm2.avisos ?? []) expect(AVISOS_PREVISTOS).toContain(a);
    });
  }

  it('a lacuna D4 reaproveita hipoteses do CM1-A (intervalo sem oportunidade, SLA com oportunidade)', () => {
    const semOpp = CASOS.find((c) => c.id === '05b')!.cm2!.proximoToque!;
    expect(semOpp.em).toBe(maxDia(somarDias(semOpp.ancora!, H.intervaloFollowUpDias), HOJE));
    const comOpp = CASOS.find((c) => c.id === '17b')!.cm2!.proximoToque!;
    expect(comOpp.em).toBe(maxDia(somarDias(comOpp.ancora!, H.slaEstagioDias.ENGAGED), HOJE));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guarda para o futuro modulo de producao do CM2 (commercialCadence*.ts). Hoje nenhum existe: a guarda roda vazia e o
// autoteste prova que ela pega as violacoes quando o CM2-B nascer.
// ---------------------------------------------------------------------------------------------------------------------
const NUMEROS_TEMPORAIS = new Set<number>([
  ...Object.values(H.slaEstagioDias), H.intervaloFollowUpDias, H.limiteTentativasSemResposta, H.sinalNovoDias,
  ...Object.values(JANELAS_FAMILIA), HIPOTESE_RECENCIA_FALLBACK_DIAS, 180, 14,
]);
const IMPORTS_PROIBIDOS = [/\brecomendarAcao\b/, /\bfilaHoje\b/, /\blerEmpresa\b/, /\brecomendarCanal\b/, /from\s+['"][./]*data\//, /supabase/i, /\bfetch\s*\(/, /from\s+['"]\.\/(canais|comunicacaoServidor)['"]/];

function violacoesDeCadencia(fonte: string): string[] {
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const semStrings = semComentarios.replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""').replace(/\.slice\(0,\s*10\)/g, '');
  const out: string[] = [];
  for (const m of semStrings.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)) if (NUMEROS_TEMPORAIS.has(Number(m[1]))) out.push(`literal temporal ${m[1]}`);
  for (const re of IMPORTS_PROIBIDOS) if (re.test(semComentarios)) out.push(`uso proibido ${re}`);
  return out;
}

describe('CM2-A — guarda de numeros temporais para o CM2-B', () => {
  it('autoteste: a guarda pega literal de politica e dependencia proibida, e aceita importacao da hipotese', () => {
    expect(violacoesDeCadencia('const intervalo = 4;')).toEqual(['literal temporal 4']);
    expect(violacoesDeCadencia('if (dias > 14) {}')).toEqual(['literal temporal 14']);
    expect(violacoesDeCadencia("import { recomendarAcao } from './pipeline';").length).toBe(1);
    expect(violacoesDeCadencia("import { recomendarCanal } from './comunicacao';").length).toBe(1);
    expect(violacoesDeCadencia("import { HIPOTESE_COMMERCIAL_MACHINE as H } from './commercialMachine';\nconst d = H.intervaloFollowUpDias; const dia = v.slice(0, 10); const x = a[0] + 1;")).toEqual([]);
    expect(violacoesDeCadencia("// comentario com 4 dias\nconst texto = 'espera 4 dias';")).toEqual([]);
  });

  it('nenhum modulo de producao commercialCadence*.ts usa literal temporal nem autoridade legada', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const arquivos = fs.readdirSync(dir).filter((f) => /^commercialCadence.*\.ts$/.test(f) && !f.endsWith('.test.ts'));
    for (const f of arquivos) expect(violacoesDeCadencia(fs.readFileSync(path.join(dir, f), 'utf8')), f).toEqual([]);
  });
});
