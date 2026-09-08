import { describe, expect, it } from 'vitest';
import { dryRunContatosCsv, relatorioDryRun } from './dryrun';
import { economiaInteligencia } from './economia';
import { normalizarEmpresasCsv } from './csv';
import { upsertEmpresa, associarEmpresaContato, type Ids } from './ingestao';
import { PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { radarVazio, type Contato, type OperacaoVibeLedger, type RadarDataset } from './types';

const HOJE = '2026-09-08';
const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');
let seq = 0;
const ids: Ids = { novo: (p) => `${p}-${++seq}`, hoje: HOJE, agora: `${HOJE}T10:00:00.000Z`, usuarioId: 'U' };
const base = (): RadarDataset => ({ ...radarVazio(), regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO });

/** Lista de empresas exportada do Vibe (com business_id) carregada num radar vazio, como sera no piloto. */
function radarComEmpresas(): RadarDataset {
  const csv = ['business_id,name,website,employees,city,state', `${B(1)},Alfa Metal Ltda,alfametal.com.br,1200,Goiânia,GO`, `${B(2)},Beta Logística SA,betalog.com.br,80,Anápolis,GO`, `${B(3)},Gama Alimentos,gama.com.br,300,Rio Verde,GO`, `,Delta Sem Id,delta.com.br,40,Goiânia,GO`].join('\n');
  const { empresas } = normalizarEmpresasCsv(csv);
  let r = base();
  for (const e of empresas) r = upsertEmpresa(r, { businessId: e.businessId, cnpj: e.cnpj, razaoSocial: e.razaoSocial, dominio: e.dominio, site: e.site, cidade: e.cidade, uf: e.uf, faixaFuncionarios: e.faixaFuncionarios }, 'F1', ids).radar;
  return r;
}

describe('piloto: dry run da importacao de decisores', () => {
  it('lista de empresas do Vibe grava business_id e a associacao do contato usa business_id, dominio e nome', () => {
    const r = radarComEmpresas();
    expect(r.empresas.map((e) => e.businessId)).toEqual([B(1), B(2), B(3), undefined]);
    expect(associarEmpresaContato({ empresaExternoId: B(2).toUpperCase() }, r.empresas)).toMatchObject({ nivel: 'certo', motivo: `business_id ${B(2)}` });
    expect(associarEmpresaContato({ empresaDominio: 'www.delta.com.br' }, r.empresas)).toMatchObject({ nivel: 'certo', motivo: 'domínio delta.com.br' });
    expect(associarEmpresaContato({ empresaNome: 'GAMA ALIMENTOS' }, r.empresas)).toMatchObject({ nivel: 'provavel' });
  });
  it('dry run: contagens, associacoes, duplicatas, invalidos, e-mails, personas, decision fit e cobertura sem gravar nada', () => {
    const r = radarComEmpresas();
    const antes = JSON.stringify(r);
    const csv = [
      'prospect_id,full_name,job_title,job_department_main,job_level_main,professional_email,professional_email_status,linkedin_url,business_id,company_name,company_website',
      `${P(1)},Ana Souza,Diretora Industrial,manufacturing,director,ana@alfametal.com.br,valid,li/ana,${B(1)},Alfa Metal Ltda,alfametal.com.br`,
      `${P(2)},Bruno Lima,Gerente de Engenharia,engineering,manager,bruno@alfametal.com.br,,li/bruno,${B(1)},Alfa Metal Ltda,alfametal.com.br`,
      `${P(3)},Carla Dias,COO,operations,cxo,,,li/carla,,Beta Logística SA,betalog.com.br`,
      `${P(4)},Daniel Reis,Sócio proprietário,,owner,daniel@delta.com.br,invalid,li/daniel,,Delta Sem Id,delta.com.br`,
      `${P(5)},Eva Nunes,Compradora,procurement,manager,,,,,GAMA ALIMENTOS,`,
      `${P(1)},Ana Souza,Diretora Industrial,manufacturing,director,ana@alfametal.com.br,valid,li/ana,${B(1)},Alfa Metal Ltda,alfametal.com.br`,
      `${P(6)},,Diretor,,director,x@y.com,,,${B(3)},Gama Alimentos,`,
      `${P(7)},Fábio Melo,Diretor de Expansão,real estate,director,fabio@omega.com.br,valid,,,Ômega Construções,omega.com.br`,
    ].join('\n');
    const d = dryRunContatosCsv(csv, r, HOJE, 91);
    expect(JSON.stringify(r)).toBe(antes); // nada gravado
    expect(d.linhas).toBe(8); expect(d.contatosUnicos).toBe(6); expect(d.invalidos).toBe(1); expect(d.duplicatas.noArquivo).toBe(1);
    expect(d.associacoes).toEqual({ exatas: 0, businessId: 2, dominio: 2, provaveis: 1, ambiguas: 0, naoEncontradas: 1 });
    expect(d.emailsValidos).toBe(3); expect(d.emailsStatusValido).toBe(2); // Ana, Bruno (sem status) e Fábio; Daniel invalido nao conta; Carla e Eva sem e-mail
    expect(d.porPersona['Diretor industrial']).toBe(1); expect(d.porPersona['COO']).toBe(1); expect(d.porPersona['Proprietário/Sócio']).toBe(1);
    expect(Object.values(d.porSenioridade).reduce((s, x) => s + x, 0)).toBe(5); expect(d.porSenioridade['Diretor']).toBe(1); expect(d.porSenioridade['C-level']).toBe(1); expect(d.porSenioridade['Sócio']).toBe(1); expect(d.porSenioridade['Gerente']).toBe(2);
    expect(d.decisionFitMedio).toBeGreaterThan(0);
    expect(d.empresasCobertas).toBe(4); expect(d.totalEmpresas).toBe(91); expect(d.cobertura).toBeCloseTo(4 / 91, 5);
    expect(d.detalhes.find((x) => x.nome === 'Fábio Melo')).toMatchObject({ status: 'revisao', nivel: 'nenhum' });
    expect(d.detalhes.find((x) => x.numero === 8)).toMatchObject({ status: 'invalido' });
    const rel = relatorioDryRun(d);
    expect(rel.some((l) => l.startsWith('cobertura: 4.4%'))).toBe(true);
    expect(rel.some((l) => l.includes('associações por business_id: 2'))).toBe(true);
    // segunda passada com o radar ja contendo Ana: vira "ja no radar"
    const rAna: RadarDataset = { ...r, contatos: [{ id: 'C1', empresaId: r.empresas[0].id, nome: 'Ana Souza', fonteExternaId: P(1), decisor: true, qualidade: 50, observacoes: '', ativo: true, situacao: 'ATIVO', criadoEm: ids.agora, atualizadoEm: ids.agora } as Contato] };
    expect(dryRunContatosCsv(csv, rAna, HOJE).duplicatas.jaNoRadar).toBe(1);
  });
  it('economia da inteligencia: 0 e "—" sem consumo; razoes com dados reais do ledger', () => {
    const r = radarComEmpresas();
    const vazio = economiaInteligencia(r);
    expect(vazio).toMatchObject({ creditsConsumed: 0, companiesResearched: 0, prospectsDiscovered: 0, validEmails: 0, accountsCovered: 0, creditsPerProspect: null, creditsPerValidEmail: null, creditsPerCoveredAccount: null });
    const op = (p: Partial<OperacaoVibeLedger>): OperacaoVibeLedger => ({ id: 'op', tipo: 'match', status: 'SUCCEEDED', creditosEstimados: 0, creditosReservados: 0, registrosPedidos: 0, registrosDevolvidos: 0, criadoEm: ids.agora, ...p });
    const ops = [
      op({ id: '1', tipo: 'match', creditosReais: 3, resumo: { casadas: 3, tentadas: 4 } }),
      op({ id: '2', tipo: 'discovery_pool', creditosAntes: 100, creditosDepois: 90, registrosDevolvidos: 10, resumo: { empresas_alvo: 3, estrategia: 'discovery_pool' } }),
      op({ id: '3', tipo: 'enrich_email', creditosReais: 8, resumo: { pedidos: 4, retornados: 4, com_email: 3 } }),
      op({ id: '4', tipo: 'enrich_email', status: 'UNCERTAIN', creditosReservados: 4 }),
      op({ id: '5', tipo: 'discovery_pool', status: 'FAILED', registrosDevolvidos: 0 }),
      op({ id: '6', tipo: 'match', status: 'RESERVED', creditosReservados: 2 }),
    ];
    const contatos = [P(1), P(2), P(3)].map((pid, i) => ({ id: `C${i}`, empresaId: r.empresas[i < 2 ? 0 : 1].id, nome: `N${i}`, fonteExternaId: pid, decisor: true, qualidade: 50, observacoes: '', ativo: true, situacao: 'ATIVO', criadoEm: ids.agora, atualizadoEm: ids.agora }) as Contato);
    const e = economiaInteligencia({ ...r, operacoesVibe: ops, contatos });
    expect(e).toMatchObject({ creditsConsumed: 21, creditsUncertain: 4, companiesResearched: 7, prospectsDiscovered: 10, validEmails: 3, accountsCovered: 2, creditsPerProspect: 2.1, creditsPerValidEmail: 7, creditsPerCoveredAccount: 10.5 });
    expect(e.operacoes).toEqual({ total: 6, concluidas: 3, falhas: 1, incertas: 1, abertas: 1 });
  });
});
