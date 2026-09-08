import { describe, expect, it } from 'vitest';
import { adapterCNO, adapterNoticias } from './adapters';
import { lerCsv, mapearColunas, normalizarContatosCsv, normalizarEmpresasCsv, CAMPOS_EMPRESA } from './csv';
import { ingerirRegistro, upsertEmpresa, type Ids } from './ingestao';
import { cnpjValido, encontrarEmpresa, normalizarCidade, normalizarCnpj, normalizarDominio, normalizarNome, similaridade } from './normalizar';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, REGRAS_PADRAO, RESPOSTAS_PADRAO } from './padroes';
import { filaHoje, oportunidadesSemProximaAcao, recalcularEmpresa, recomendarAcao, resumoRadar } from './pipeline';
import { calcularScore, classificar, fatorDecaimento, motivoPrioridade } from './score';
import { radarVazio, type Empresa, type RadarDataset } from './types';

const HOJE = '2026-09-08';
const AGORA = '2026-09-08T12:00:00.000Z';
let seq = 0;
const ids: Ids = { novo: (p) => `${p}-${String(++seq).padStart(4, '0')}`, hoje: HOJE, agora: AGORA, usuarioId: 'u-1' };
const base = (): RadarDataset => ({ ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, tiposResposta: RESPOSTAS_PADRAO });
const empresa = (p: Partial<Empresa>): Empresa => ({ id: 'E1', razaoSocial: 'Empresa Teste', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: AGORA, atualizadoEm: AGORA, fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p });

describe('normalizacao e deduplicacao', () => {
  it('cnpj, dominio e nome', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizarCnpj('11.222.333/0001-80')).toBeUndefined();
    expect(normalizarDominio('https://www.Acme.com.br/sobre')).toBe('acme.com.br');
    expect(normalizarDominio('joao@gmail.com')).toBeUndefined();
    expect(normalizarDominio('maria@acme.ind.br')).toBe('acme.ind.br');
    expect(normalizarNome('ACME Indústria e Comércio LTDA.')).toBe('acme');
    expect(normalizarCidade('goiânia')).toBe('Goiânia');
    expect(normalizarCidade('SÃO JOSÉ DO RIO PRETO')).toBe('São José do Rio Preto');
    expect(similaridade('Acme Metalurgica', 'ACME Metalúrgica S.A.')).toBe(1);
    expect(similaridade('Acme Metalurgica', 'Acme Metalurgia')).toBeGreaterThan(0.7);
  });

  it('encontra por cnpj, dominio, nome+local e aproximado', () => {
    const es = [empresa({ id: 'A', cnpj: '11222333000181', razaoSocial: 'Acme Indústria LTDA', dominio: 'acme.com.br', cidade: 'Goiânia', uf: 'GO' }), empresa({ id: 'B', razaoSocial: 'Beta Logística', cidade: 'Anápolis', uf: 'GO' })];
    expect(encontrarEmpresa({ cnpj: '11222333000181', razaoSocial: 'outro nome' }, es)?.nivel).toBe('certo');
    expect(encontrarEmpresa({ dominio: 'www.acme.com.br', razaoSocial: 'x' }, es)?.empresa.id).toBe('A');
    expect(encontrarEmpresa({ razaoSocial: 'ACME INDUSTRIA', cidade: 'goiania', uf: 'go' }, es)?.nivel).toBe('provavel');
    expect(encontrarEmpresa({ razaoSocial: 'ACME INDUSTRIA', cidade: 'Rio Verde', uf: 'GO' }, es)?.nivel).toBe('possivel');
    expect(encontrarEmpresa({ razaoSocial: 'Beta Logistica Transportes' }, es)?.nivel).toBe('possivel');
    expect(encontrarEmpresa({ razaoSocial: 'Zeta Construções' }, es)).toBeUndefined();
  });

  it('upsert: atualiza existente sem sobrescrever, cria possivel duplicata', () => {
    let r = base();
    const a = upsertEmpresa(r, { razaoSocial: 'Acme Indústria LTDA', cnpj: '11.222.333/0001-81', cidade: 'Goiânia', uf: 'GO', setor: 'Indústria' }, 'FONTE-CSV', ids);
    r = a.radar; expect(a.resultado).toBe('importada'); expect(a.empresa.cnpj).toBe('11222333000181');
    const b = upsertEmpresa(r, { razaoSocial: 'ACME IND', cnpj: '11222333000181', setor: 'Outro', dominio: 'acme.com.br' }, 'FONTE-CSV', ids);
    r = b.radar; expect(b.resultado).toBe('atualizada'); expect(b.empresa.setor).toBe('Indústria'); expect(b.empresa.dominio).toBe('acme.com.br');
    expect(r.empresas).toHaveLength(1);
    const c = upsertEmpresa(r, { razaoSocial: 'Acme Industria', cidade: 'Rio Verde', uf: 'GO' }, 'FONTE-CSV', ids);
    expect(c.resultado).toBe('duplicata_possivel'); expect(c.radar.empresas).toHaveLength(2); expect(c.radar.duplicatas[0].status).toBe('pendente');
  });
});

describe('csv', () => {
  it('le separador, aspas e mapeia colunas', () => {
    const { cabecalho, linhas, separador } = lerCsv('Razão Social;CNPJ;Cidade;UF\n"Acme; Ltda";11.222.333/0001-81;Goiânia;GO\nBeta;;Anápolis;GO\n');
    expect(separador).toBe(';'); expect(linhas[0][0]).toBe('Acme; Ltda'); expect(cabecalho).toEqual(['Razão Social', 'CNPJ', 'Cidade', 'UF']);
    expect(mapearColunas(cabecalho, CAMPOS_EMPRESA)).toEqual(['razaoSocial', 'cnpj', 'cidade', 'uf']);
    const e = normalizarEmpresasCsv('company,domain,employees,state\nAcme,https://acme.com.br,120,go\n,x,1,GO');
    expect(e.empresas[0]).toMatchObject({ razaoSocial: 'Acme', dominio: 'acme.com.br', faixaFuncionarios: '51-200', uf: 'GO' });
    expect(e.empresas[1].erros[0].campo).toBe('razaoSocial');
    const c = normalizarContatosCsv('nome,cargo,email,empresa,decisor\nJoão Silva,Diretor,joao@acme.com.br,Acme,sim');
    expect(c.contatos[0]).toMatchObject({ nome: 'João Silva', decisor: true, empresaDominio: 'acme.com.br', empresaNome: 'Acme' });
  });
});

describe('score', () => {
  it('decaimento linear, dimensoes, pesos e classe', () => {
    expect(fatorDecaimento('2026-08-09', HOJE, 60)).toBeCloseTo(0.5, 6);
    expect(fatorDecaimento('2026-01-01', HOJE, 60)).toBe(0);
    expect(classificar(85, CONFIG_SCORE_PADRAO)).toBe('A+'); expect(classificar(69.9, CONFIG_SCORE_PADRAO)).toBe('B'); expect(classificar(10, CONFIG_SCORE_PADRAO)).toBe('D');
    const e = empresa({ setor: 'Indústria', uf: 'GO', faixaFuncionarios: '201-500', cnpj: '11222333000181', dominio: 'acme.com.br', cidade: 'Goiânia', site: 'x' });
    const r: RadarDataset = { ...base(), empresas: [e], sinais: [{ id: 'S1', empresaId: 'E1', fonteId: 'FONTE-CNO', fonteTipo: 'CNO', tipo: 'NEW_FACTORY', titulo: 'Nova fábrica', descricao: '', eventoEm: '2026-08-09', detectadoEm: AGORA, confianca: 1, scoreBase: 55, scoreEfetivo: 55, verificado: true, criadoEm: AGORA }], contatos: [{ id: 'C1', empresaId: 'E1', nome: 'Ana', email: 'ana@acme.com.br', telefone: '62', decisor: true, qualidade: 80, observacoes: '', ativo: true, criadoEm: AGORA, atualizadoEm: AGORA }] };
    const x = calcularScore({ empresa: e, contatos: r.contatos, sinais: r.sinais, atividades: [], projetos: [] }, r.regrasScore, r.configScore, HOJE);
    const dim = (d: string) => x.dimensoes.find((k) => k.dimensao === d)!;
    expect(dim('FIT').score).toBe(80); // setor 35 + uf 25 + porte 20
    expect(dim('TIMING').score).toBeCloseTo(55 * (1 - 30 / 270), 0); // nova fabrica ha 30 dias, decai em 270
    expect(dim('RELATIONSHIP').score).toBe(45); // decisor 30 + email/telefone 15
    expect(dim('DATA_QUALITY').score).toBe(80); // 7 de 7 campos + contato
    expect(x.total).toBeCloseTo(0.25 * 80 + 0.35 * dim('TIMING').score + 0.25 * dim('INTENT').score + 0.1 * 45 + 0.05 * dim('DATA_QUALITY').score, 0);
    expect(x.classe).toBe(classificar(x.total, CONFIG_SCORE_PADRAO));
    expect(dim('TIMING').fatores[0].motivo).toContain('Nova fábrica');
    expect(motivoPrioridade(x)).toContain('Nova fábrica');
    // regra desativada some do calculo
    const semUf = calcularScore({ empresa: e, contatos: [], sinais: [], atividades: [], projetos: [] }, r.regrasScore.map((g) => (g.nome.startsWith('UF') ? { ...g, ativo: false } : g)), r.configScore, HOJE);
    expect(semUf.dimensoes.find((k) => k.dimensao === 'FIT')!.score).toBe(55);
    // resposta negativa reduz INTENT
    const neg = calcularScore({ empresa: e, contatos: [], sinais: [], atividades: [{ id: 'A1', empresaId: 'E1', usuarioId: 'u', tipo: 'CALL', canal: 'PHONE', ocorreuEm: AGORA, resultado: 'REQUESTED_BUDGET', notas: '', criadoEm: AGORA }, { id: 'A2', empresaId: 'E1', usuarioId: 'u', tipo: 'CALL', canal: 'PHONE', ocorreuEm: AGORA, resultado: 'COMPETITOR_SELECTED', notas: '', criadoEm: AGORA }], projetos: [] }, r.regrasScore, r.configScore, HOJE);
    expect(neg.dimensoes.find((k) => k.dimensao === 'INTENT')!.score).toBe(20); // 60 - 40
  });
});

describe('pipeline', () => {
  it('recalcula caches, detecta oportunidade sem proxima acao e recomenda acao', () => {
    let r: RadarDataset = { ...base(), empresas: [empresa({ setor: 'Indústria', uf: 'GO' })] };
    r = { ...r, oportunidades: [{ id: 'O1', empresaId: 'E1', titulo: 'Galpão', estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u-1', observacoes: '', criadoEm: AGORA, atualizadoEm: AGORA, valorEstimado: 500000 }] };
    expect(oportunidadesSemProximaAcao(r)).toHaveLength(1);
    r = { ...r, tarefas: [{ id: 'T1', empresaId: 'E1', oportunidadeId: 'O1', responsavelId: 'u-1', tipo: 'CALL', prioridade: 'Alta', venceEm: '2026-09-05', status: 'Aberta', descricao: 'Ligar para o decisor', criadoEm: AGORA }] };
    expect(oportunidadesSemProximaAcao(r)).toHaveLength(0);
    const { empresa: e2 } = recalcularEmpresa(r.empresas[0], r, HOJE);
    expect(e2.proximaAcaoEm).toBe('2026-09-05');
    expect(e2.fitScore).toBe(60);
    expect(recomendarAcao(e2, r, HOJE)).toMatchObject({ acao: 'Ligar para o decisor', tipoTarefa: 'CALL' });
    const fila = filaHoje({ ...r, empresas: [e2] }, HOJE);
    expect(fila[0].vencida).toBe(true);
    expect(fila[0].oportunidade?.id).toBe('O1');
    const res = resumoRadar({ ...r, empresas: [e2] }, HOJE);
    expect(res.followUpsVencidos).toBe(1); expect(res.pipeline).toBe(500000); expect(res.pipelinePonderado).toBe(150000);
    // sem contatos: recomenda pesquisar decisor
    const semTarefa: RadarDataset = { ...r, tarefas: [], oportunidades: [] };
    expect(recomendarAcao(e2, semTarefa, HOJE).tipoTarefa).toBe('RESEARCH');
  });
});

describe('adapters e ingestao', () => {
  it('CNO vira empresa + projeto + sinal com payload preservado; noticia infere o tipo', () => {
    const reg = adapterCNO.normalizar({ cno: '12.345.67890/01', nomeResponsavel: 'Gama Alimentos SA', cnpjResponsavel: '11222333000181', municipio: 'Anápolis', uf: 'GO', dataInicio: '2026-08-20', tipoObra: 'Construção nova', areaTotal: '12000' })!;
    expect(reg.sinais?.[0].tipo).toBe('CNO_NEW'); expect(reg.projeto?.areaM2).toBe(12000);
    const fonte = FONTES_PADRAO.find((f) => f.codigo === 'CNO')!;
    let r = base();
    const out = ingerirRegistro(r, reg, fonte, ids);
    r = out.radar;
    expect(out.resultado).toBe('importada'); expect(out.sinais).toBe(1);
    expect(r.registrosFonte).toHaveLength(1); expect(r.registrosFonte[0].payload).toMatchObject({ cno: '12.345.67890/01' });
    expect(r.sinais[0].confianca).toBeCloseTo(0.9 * 0.9, 6);
    // reingestao do mesmo registro nao duplica sinal
    const out2 = ingerirRegistro(r, reg, fonte, ids);
    expect(out2.sinais).toBe(0); expect(out2.radar.empresas).toHaveLength(1);
    const news = adapterNoticias.normalizar({ title: 'Gama Alimentos anuncia nova fábrica em Goiás', company: 'Gama Alimentos', publishedAt: '2026-09-01' })!;
    expect(news.sinais?.[0].tipo).toBe('NEW_FACTORY');
  });
});
