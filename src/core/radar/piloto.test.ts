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
    expect(e).toMatchObject({ creditsConsumed: 21, creditsUncertain: 4, companiesResearched: 7, prospectsDiscovered: 10, validEmails: 0, accountsCovered: 2, creditsPerProspect: 2.1, creditsPerValidEmail: null, creditsPerCoveredAccount: 10.5 }); // contatos sem e-mail: valid_emails conta so status valid
    expect(e.operacoes).toEqual({ total: 6, concluidas: 3, falhas: 1, incertas: 1, abertas: 1 });
  });
});

describe('piloto: cobertura de decisores e semantica de e-mail', () => {
  it('niveis por empresa pelo melhor contato, cortes configuraveis (fit.ideal 70 / fit.usavel 50) e metricas de e-mail', async () => {
    const { coberturaEmpresa, relatorioCobertura, metricasEmail, cortesCobertura } = await import('./cobertura');
    const { upsertContato } = await import('./ingestao');
    let r = radarComEmpresas();
    expect(cortesCobertura(r)).toEqual({ ideal: 70, usavel: 50 });
    const add = (empresaIdx: number, c: Record<string, unknown>) => { r = upsertContato(r, r.empresas[empresaIdx].id, c as never, 'F1', ids).radar; };
    add(0, { nome: 'Ana Souza', cargo: 'Diretora Industrial', departamento: 'manufacturing', email: 'ana@alfametal.com.br', statusEmail: 'valido' }); // grande: diretor industrial = ideal
    add(1, { nome: 'Carla Dias', cargo: 'Compradora', departamento: 'procurement', email: 'carla@betalog.com.br', statusEmail: 'catch_all' }); // pequena: compras = fit baixo
    add(2, { nome: 'Eva Nunes', cargo: 'Gerente de Operações', departamento: 'operations', email: 'eva@gama.com.br', statusEmail: 'invalido' }); // media: gerente de operacoes = utilizavel (50-69)
    const niveis = r.empresas.map((e) => coberturaEmpresa(e, r).nivel);
    expect(niveis).toEqual(['IDEAL_DECISION_MAKER', 'NEEDS_BETTER_DECISION_MAKER', 'USABLE_CONTACT', 'NO_CONTACT']);
    const rel = relatorioCobertura(r, HOJE);
    expect(rel).toMatchObject({ empresas: 4, comContato: 3, ideal: 1, usavel: 1, baixo: 1, semContato: 1 });
    expect(rel.semContatoLista.map((x) => x.nome)).toEqual(['Delta Sem Id']);
    expect(rel.precisamDecisorMelhor.map((x) => x.empresa)).toEqual(['Beta Logística SA', 'Gama Alimentos']);
    expect(rel.email).toEqual({ disponiveis: 3, validos: 1, catchAll: 1, invalidos: 1, desconhecidos: 0 });
    expect(rel.linhas.map((l) => l.nivel)).toEqual(['IDEAL_DECISION_MAKER', 'USABLE_CONTACT', 'NEEDS_BETTER_DECISION_MAKER', 'NO_CONTACT']);
    expect(rel.linhas[0]).toMatchObject({ empresa: 'Alfa Metal Ltda', contato: 'Ana Souza', principal: false, statusEmail: 'valido' });
    expect(rel.fitMedio).toBeGreaterThan(0); expect(rel.fitMediana).toBeGreaterThan(0);
    expect(rel.proximasAcoes.reduce((s, a) => s + a.quantidade, 0)).toBe(4);
    // corte configuravel: baixando fit.ideal para 50, Gama passa a ideal
    const r2 = { ...r, pesosDecisionFit: r.pesosDecisionFit.map((p) => (p.chave === 'fit.ideal' ? { ...p, valor: 50 } : p)) };
    expect(coberturaEmpresa(r2.empresas[2], r2).nivel).toBe('IDEAL_DECISION_MAKER');
    expect(metricasEmail([])).toEqual({ disponiveis: 0, validos: 0, catchAll: 0, invalidos: 0, desconhecidos: 0 });
  });
  it('economia: valid_emails conta so status valid dos contatos do Vibe', () => {
    const r = radarComEmpresas();
    const c = (i: number, statusEmail: string) => ({ id: `C${i}`, empresaId: r.empresas[0].id, nome: `N${i}`, fonteExternaId: P(10 + i), email: `n${i}@alfametal.com.br`, statusEmail, decisor: true, qualidade: 50, observacoes: '', ativo: true, situacao: 'ATIVO', criadoEm: ids.agora, atualizadoEm: ids.agora }) as Contato;
    const e = economiaInteligencia({ ...r, contatos: [c(1, 'valido'), c(2, 'valido'), c(3, 'catch_all'), c(4, 'invalido')] });
    expect(e).toMatchObject({ emailsAvailable: 4, validEmails: 2, emailsCatchAll: 1, emailsInvalid: 1, accountsCovered: 1 });
  });
});

describe('piloto: UF por nome do estado e pais', () => {
  it('aceita sigla e nome do estado (com/sem acento); pais brazil -> Brasil', async () => {
    const { normalizarUf, normalizarPais } = await import('./normalizar');
    expect(normalizarUf('GO')).toBe('GO'); expect(normalizarUf('goiás')).toBe('GO'); expect(normalizarUf('Mato Grosso do Sul')).toBe('MS'); expect(normalizarUf('distrito federal')).toBe('DF'); expect(normalizarUf('mato grosso')).toBe('MT'); expect(normalizarUf('xx')).toBeUndefined(); expect(normalizarUf('')).toBeUndefined();
    expect(normalizarPais('brazil')).toBe('Brasil'); expect(normalizarPais('BR')).toBe('Brasil'); expect(normalizarPais('argentina')).toBe('Argentina');
    const { normalizarEmpresasCsv } = await import('./csv');
    const e = normalizarEmpresasCsv('business_name,business_region,business_country_name,business_id\nX,goiás,brazil,' + 'a'.repeat(32)).empresas[0];
    expect(e).toMatchObject({ uf: 'GO', pais: 'Brasil', erros: [] });
  });
});

describe('piloto: importacao pura e Signal Pilot', () => {
  it('importarCsv (core) gera job, linhas, registros brutos e recalcula; Signal Pilot sem sinais mostra 0, — e RESEARCH_SIGNALS', async () => {
    const { importarCsv, recalcularEmpresas, criarIds } = await import('./importacao');
    const { visaoSignalPilot } = await import('./signalPilot');
    const { FONTES_PADRAO, REGRAS_PADRAO, CONFIG_SCORE_PADRAO } = await import('./padroes');
    let r: RadarDataset = { ...base(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO };
    const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
    const idsC = criarIds(r, { hoje: HOJE, agora: ids.agora, usuarioId: 'U1' });
    const e1 = importarCsv(r, ['business_name,business_domain,business_region,business_country_name,business_number_of_employees_range,business_id', `Cereal Ouro,cerealouro.com.br,goiás,brazil,201-500,${B(1)}`, `Fiagril Ltda.,fiagril.com.br,mato grosso,brazil,501-1000,${B(2)}`].join('\n'), { tipo: 'empresas', fonte, arquivo: 'ds-empresas', usuarioId: 'U1', agora: ids.agora }, idsC);
    r = recalcularEmpresas(e1.radar, e1.afetadas, idsC);
    expect(e1.job).toMatchObject({ tipo: 'empresas', arquivo: 'ds-empresas', total: 2, importados: 2, erros: 0, status: 'Concluída', fonteId: fonte.id });
    expect(r.empresas.map((e) => [e.uf, e.pais, e.businessId])).toEqual([['GO', 'Brasil', B(1)], ['MT', 'Brasil', B(2)]]);
    expect(r.registrosFonte.filter((x) => x.tipo === 'empresa').map((x) => x.externoId)).toEqual([B(1), B(2)]);
    expect(r.snapshotsScore).toHaveLength(2);
    const e2 = importarCsv(r, ['prospect_id,prospect_full_name,prospect_job_title,prospect_job_seniority_level,contact_professional_email,contact_professional_email_status,business_id,business_name', `${P(1)},André Schwening,Chief executive officer,cxo,andre@cerealouro.com.br,valid,${B(1)},Cereal Ouro`].join('\n'), { tipo: 'contatos', fonte, arquivo: 'ds-contatos', usuarioId: 'U1', agora: ids.agora }, idsC);
    r = recalcularEmpresas(e2.radar, e2.afetadas, idsC);
    expect(e2.job).toMatchObject({ tipo: 'contatos', total: 1, importados: 1, erros: 0 });
    expect(r.contatos[0]).toMatchObject({ fonteExternaId: P(1), persona: 'CEO', senioridade: 'C-level', statusEmail: 'valido' });
    expect(r.importacaoLinhas).toHaveLength(3); expect(r.registrosFonte).toHaveLength(3); expect(r.oportunidades).toHaveLength(0);
    const v = visaoSignalPilot(r, HOJE, ['Cereal Ouro', 'Fiagril', 'Inexistente SA']);
    expect(v[0]).toMatchObject({ encontrada: true, signalCount: 0, strongestSignal: undefined, recommendedAction: 'RESEARCH_SIGNALS', estadoCrm: 'RESEARCH_SIGNALS', contato: 'André Schwening', decisionFit: 75, timingScore: 0, intentScore: 0, whyNow: 'Sem sinal recente' });
    expect(v[1]).toMatchObject({ encontrada: true, signalCount: 0, recommendedAction: 'NURTURE', estadoCrm: 'SEARCH_DECISION_MAKER', contato: undefined });
    expect(v[2]).toMatchObject({ encontrada: false, signalCount: 0, recommendedAction: '—' });
  });
});
