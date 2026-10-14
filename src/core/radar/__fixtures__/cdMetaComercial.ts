// CD-D3/E4 — mundo de teste do retrato comercial CD-1.3 (fictício; nunca números de produção).
//
// Cobre as medidas operacionais do CD-1.2 (contas, contatos, atividade, oportunidades) e o resultado comercial do mês:
// metas versionadas (vigente, versionada, futura, retirada), ganhos com e sem valor, complemento retroativo, estorno em
// outro mês, ganho de conta depois inativada e de conta depois mesclada, e a virada do mês em America/Sao_Paulo.
import { radarVazio, type Atividade, type Contato, type Empresa, type Oportunidade, type RadarDataset } from '../types';
import type { EventoDesfecho, VersaoMetaComercial } from '../metaComercial';

export const HOJE_CD13 = '2026-10-14';
/** instante de referência explícito: 14/10/2026 15:00 em São Paulo */
export const AGORA_CD13 = '2026-10-14T18:00:00.000000Z';

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01',
  fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 60, priorityClass: 'B', ...p,
});
const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({
  id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO', email: `${id}@conta-${empresaId}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p,
});
const atv = (id: string, empresaId: string, p: Partial<Atividade> = {}): Atividade => ({
  id, empresaId, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: '2026-10-08T12:00:00.000Z', notas: '', criadoEm: '2026-10-08T12:00:00.000Z', ...p,
});
const opp = (id: string, empresaId: string, p: Partial<Oportunidade> = {}): Oportunidade => ({
  id, empresaId, titulo: `Galpão ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: '2026-09-01T12:00:00.000Z', atualizadoEm: '2026-09-01T12:00:00.000Z', ...p,
});
export const meta = (id: string, mes: string, valor: VersaoMetaComercial['valor'], versao: number, definidaEm: string): VersaoMetaComercial => ({
  id, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao, motivo: `meta ${id}`, definidaPor: 'u-dir', definidaEm,
});
export const ganho = (id: string, oportunidadeId: string, empresaId: string, ocorridoEm: string, valor?: string): EventoDesfecho => ({
  id, tipo: 'GANHO', oportunidadeId, empresaId, ocorridoEm, ...(valor === undefined ? {} : { valor }), responsavelId: 'u1', motivo: 'contrato assinado', registradoPor: 'u1',
});
export const estorno = (id: string, g: EventoDesfecho, ocorridoEm: string): EventoDesfecho => ({
  id, tipo: 'ESTORNO_GANHO', oportunidadeId: g.oportunidadeId, empresaId: g.empresaId, ocorridoEm, ganhoId: g.id, motivo: 'cliente desistiu', registradoPor: 'u1',
});
export const complemento = (id: string, g: EventoDesfecho, ocorridoEm: string, valor: string): EventoDesfecho => ({
  id, tipo: 'COMPLEMENTO_VALOR', oportunidadeId: g.oportunidadeId, empresaId: g.empresaId, ocorridoEm, ganhoId: g.id, valor, motivo: 'valor da NF', registradoPor: 'u-dir',
});

// livro: setembro e outubro de 2026 (instantes com microssegundos, como o PostgREST entrega)
export const G1 = ganho('G1', 'O2', 'E1', '2026-09-10T15:00:00.123456+00:00', '120000.50');
export const G2 = ganho('G2', 'O5', 'E2', '2026-09-20T12:00:00.000001+00:00'); // sem valor
export const C2 = complemento('C2', G2, '2026-10-03T12:00:00.000000+00:00', '30000.25'); // retifica setembro
/** 23h30 de 30/09 em São Paulo (já é 01/10 em UTC): é de SETEMBRO */
export const G7 = ganho('G7', 'O9', 'E5', '2026-10-01T02:30:00.000000+00:00', '5000.00');
/** 00h00 de 01/10 em São Paulo: é de OUTUBRO */
export const G8 = ganho('G8', 'O10', 'E5', '2026-10-01T03:00:00.000000+00:00', '10000.00');
export const G3 = ganho('G3', 'O6', 'E3', '2026-10-02T12:00:00.000000+00:00', '80000.00'); // conta inativada depois
export const G4 = ganho('G4', 'O7', 'E4', '2026-10-05T12:00:00.000000+00:00', '45000.10'); // conta mesclada depois
export const X1 = estorno('X1', G1, '2026-10-06T12:00:00.000000+00:00'); // estorno em outubro do ganho de setembro
export const G5 = ganho('G5', 'O2', 'E1', '2026-10-07T12:00:00.000000+00:00', '100000.00'); // ganha de novo

export const METAS_CD13: VersaoMetaComercial[] = [
  meta('MS1', '2026-09', '100000.00', 1, '2026-09-01T12:00:00.000Z'),
  meta('MO1', '2026-10', '200000.00', 1, '2026-10-01T12:00:00.000Z'),
  meta('MO2', '2026-10', '250000.00', 2, '2026-10-05T12:00:00.000Z'), // versionada: vale a v2
  meta('MN1', '2026-11', '300000.00', 1, '2026-10-10T12:00:00.000Z'), // mês futuro
  meta('MD1', '2026-12', '150000.00', 1, '2026-10-10T12:00:00.000Z'),
  meta('MD2', '2026-12', null, 2, '2026-10-12T12:00:00.000Z'), // retirada
];
export const DESFECHOS_CD13: EventoDesfecho[] = [G1, G2, C2, G7, G8, G3, G4, X1, G5];

/** Mundo do CD-1.3: as coleções do CD-1.2 + metas + livro de desfechos. */
export function mundoCD13(): RadarDataset {
  return {
    ...radarVazio(),
    empresas: [
      emp('E1', { priorityClass: 'A', priorityScore: 80, commercialOwnerId: 'u1' }),
      emp('E2', { priorityClass: 'B' }),
      emp('E3', { ativo: false }), // inativada DEPOIS do ganho G3
      emp('E4', { mescladaEm: 'E1' }), // mesclada DEPOIS do ganho G4
      emp('E5', { priorityClass: 'C' }),
      emp('E6', { priorityClass: 'D' }),
    ],
    contatos: [
      cont('K1', 'E1', { decisor: true, statusEmail: 'valido', cargo: 'Diretor de Engenharia', persona: 'ENGINEERING_DIRECTOR' }),
      cont('K2', 'E2', { cargo: 'Analista' }),
      cont('K5', 'E5', { decisor: true }),
    ],
    atividades: [
      atv('A1', 'E1', { contatoId: 'K1', resultado: 'DECISION_MAKER_REACHED' }),
      atv('A2', 'E2', { tipo: 'MEETING', canal: 'VISIT', ocorreuEm: '2026-09-20T12:00:00.000Z', criadoEm: '2026-09-20T12:00:00.000Z' }),
      atv('A3', 'E6', { tipo: 'NOTE', canal: 'OTHER' }),
    ],
    tiposResposta: [{ codigo: 'DECISION_MAKER_REACHED', nome: 'Falou com o decisor', sentimento: 'positivo', ativo: true }],
    oportunidades: [
      opp('O1', 'E6', { valorEstimado: 900_000, proximaAcaoEm: '2026-10-20' }), // estimativa NUNCA vira receita
      opp('O2', 'E1', { estagio: 'WON', valorEstimado: 999_999, valorFechado: 100_000, fechadoEm: '2026-10-07T12:00:00.000Z' }),
      opp('O5', 'E2', { estagio: 'WON', valorEstimado: 777_777, fechadoEm: '2026-09-20T12:00:00.000Z' }),
      opp('O6', 'E3', { estagio: 'WON', valorFechado: 80_000, fechadoEm: '2026-10-02T12:00:00.000Z' }),
      opp('O7', 'E4', { estagio: 'WON', valorFechado: 45_000.1, fechadoEm: '2026-10-05T12:00:00.000Z' }),
      opp('O9', 'E5', { estagio: 'WON', valorFechado: 5_000, fechadoEm: '2026-10-01T02:30:00.000Z' }),
      opp('O10', 'E5', { estagio: 'WON', valorFechado: 10_000, fechadoEm: '2026-10-01T03:00:00.000Z' }),
      opp('O11', 'E6', { estagio: 'LOST', fechadoEm: '2026-09-15T12:00:00.000Z' }),
    ],
    metasComerciais: METAS_CD13.map((m) => ({ ...m })),
    desfechos: DESFECHOS_CD13.map((e) => ({ ...e })),
  };
}
