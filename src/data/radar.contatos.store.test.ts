// Jornada do lote piloto: empresas -> contatos por id externo/dominio/nome -> fila de revisao -> contato principal.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { contatoRecomendado, filaHoje, resumoRadar } from '../core/radar';

const radar = () => getState().ds.radar;

describe('Radar: decisores no lote piloto', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('importa empresas com id externo e depois contatos associados por id, dominio e nome; ambiguidade vai para revisao', () => {
    actions.importarCsvRadar('id;Razão Social;Site;Cidade;UF;Setor;Funcionários\nV-1;Acme Indústria LTDA;www.acme.com.br;Goiânia;GO;Indústria;1200\nV-2;Acme Indústria LTDA;www.acme-mg.com.br;Uberlândia;MG;Indústria;300\nV-3;Beta Logística;beta.com.br;Anápolis;GO;Logística;40', { tipo: 'empresas', fonteId: 'FONTE-VIBE' });
    expect(radar().empresas.filter((e) => e.ativo)).toHaveLength(3);
    const job = actions.importarCsvRadar('Empresa ID;Empresa;Domínio;Nome;Cargo;Departamento;E-mail;Status do e-mail;Celular;LinkedIn\nV-1;Acme;;Roberto Silva;Diretor Industrial;Industrial;roberto@acme.com.br;valid;62999990001;li/roberto\nV-1;Acme;;Carla Compras;Compradora;Compras;carla@acme.com.br;;;\n;;acme-mg.com.br;Paulo Eng;Gerente de Engenharia;Engenharia;paulo@acme-mg.com.br;bounced;;\n;Beta Logistica;;Dona Beta;Sócia proprietária;;dona@beta.com.br;valid;62999990002;\n;ACME INDUSTRIA;;Ambíguo Silva;Diretor;;amb@gmail.com;;;\n;Empresa Inexistente XYZ;;Ninguém;Analista;;;;;', { tipo: 'contatos', fonteId: 'FONTE-VIBE' });
    expect(job).toMatchObject({ total: 6, importados: 5, revisao: 1, erros: 0 });
    // "Empresa Inexistente XYZ": sem match nenhum e com nome -> cria a empresa (sem ambiguidade)
    expect(radar().empresas.some((e) => e.razaoSocial === 'Empresa Inexistente XYZ')).toBe(true);
    const acme = radar().empresas.find((e) => e.fonteExternaId === 'V-1')!;
    const roberto = radar().contatos.find((c) => c.nome === 'Roberto Silva')!;
    expect(roberto.empresaId).toBe(acme.id);
    expect(roberto.persona).toBe('INDUSTRIAL_DIRECTOR'); expect(roberto.senioridade).toBe('Diretor'); expect(roberto.statusEmail).toBe('valido');
    expect(roberto.decisionFitScore).toBeGreaterThan(80); expect(roberto.decisor).toBe(true); expect(roberto.qualidade).toBeGreaterThan(70);
    const carla = radar().contatos.find((c) => c.nome === 'Carla Compras')!;
    expect(carla.persona).toBe('PROCUREMENT'); expect(carla.decisionFitScore).toBeLessThan(roberto.decisionFitScore!);
    const paulo = radar().contatos.find((c) => c.nome === 'Paulo Eng')!;
    expect(paulo.empresaId).toBe(radar().empresas.find((e) => e.fonteExternaId === 'V-2')!.id); expect(paulo.statusEmail).toBe('devolvido');
    const dona = radar().contatos.find((c) => c.nome === 'Dona Beta')!;
    expect(dona.persona).toBe('OWNER'); expect(dona.decisionFitScore).toBeGreaterThan(80); // dona de empresa pequena
    const rev = radar().importacaoLinhas.find((l) => l.status === 'revisao')!;
    expect(rev.candidatos?.length).toBe(2);
    expect(radar().contatos.some((c) => c.nome === 'Ambíguo Silva')).toBe(false);
    expect(radar().empresas.filter((e) => e.ativo)).toHaveLength(4); // nenhuma Acme extra
  });

  it('resolve a fila de revisao associando a empresa escolhida', () => {
    const rev = radar().importacaoLinhas.find((l) => l.status === 'revisao')!;
    const mg = radar().empresas.find((e) => e.fonteExternaId === 'V-2')!;
    expect(() => actions.resolverLinhaRevisaoRadar(rev.id, {})).toThrow(RegraDeNegocioError);
    const c = actions.resolverLinhaRevisaoRadar(rev.id, { empresaId: mg.id })!;
    expect(c.empresaId).toBe(mg.id); expect(c.nome).toBe('Ambíguo Silva');
    expect(radar().importacaoLinhas.find((l) => l.id === rev.id)!.status).toBe('importada');
    expect(resumoRadar(radar(), getState().ds.params.dataBase).revisoesPendentes).toBe(0);
  });

  it('contato principal: sugestao explicada, definicao manual e recusa de contato inelegivel', () => {
    const acme = radar().empresas.find((e) => e.fonteExternaId === 'V-1')!;
    const sug = contatoRecomendado(acme.id, radar())!;
    expect(sug.contato.nome).toBe('Roberto Silva');
    expect(sug.fit.razoes).toEqual(expect.arrayContaining(['Diretor industrial em empresa de grande porte', 'diretoria']));
    const carla = radar().contatos.find((c) => c.nome === 'Carla Compras')!;
    actions.definirContatoPrincipalRadar(carla.id);
    expect(contatoRecomendado(acme.id, radar())!.contato.id).toBe(carla.id);
    expect(radar().contatos.filter((c) => c.empresaId === acme.id && c.isPrimario)).toHaveLength(1);
    actions.definirContatoPrincipalRadar(carla.id, false);
    expect(contatoRecomendado(acme.id, radar())!.contato.nome).toBe('Roberto Silva');
    actions.adicionarSupressaoRadar({ contatoId: carla.id, tipo: 'do_not_contact', motivo: 'pediu' });
    expect(() => actions.definirContatoPrincipalRadar(carla.id)).toThrow(/não contatar/);
    const roberto = radar().contatos.find((c) => c.nome === 'Roberto Silva')!;
    actions.salvarContatoRadar({ ...roberto, situacao: 'SAIU_DA_EMPRESA' });
    expect(contatoRecomendado(acme.id, radar())?.contato.nome).not.toBe('Roberto Silva');
    const item = filaHoje(radar(), getState().ds.params.dataBase).find((i) => i.empresa.id === acme.id)!;
    expect(item.recomendacao.estado).toBe('SEARCH_DECISION_MAKER');
    actions.salvarContatoRadar({ ...roberto, situacao: 'ATIVO' });
    expect(filaHoje(radar(), getState().ds.params.dataBase).find((i) => i.empresa.id === acme.id)!.recomendacao.estado).toBe('RESEARCH_SIGNALS');
  });

  it('metricas de cobertura no command center e recalculo apos mudar pesos', () => {
    const r = resumoRadar(radar(), getState().ds.params.dataBase);
    expect(r.empresas).toBe(4); expect(r.comContato).toBe(4); expect(r.comDecisor).toBeGreaterThanOrEqual(2); expect(r.comCanal).toBeGreaterThanOrEqual(2);
    expect(r.precisamPesquisa).toBeGreaterThan(0);
    const roberto = radar().contatos.find((c) => c.nome === 'Roberto Silva')!;
    actions.salvarPesoDecisionFitRadar('persona.INDUSTRIAL_DIRECTOR.grande', 10);
    actions.recalcularContatosRadar();
    expect(radar().contatos.find((c) => c.id === roberto.id)!.decisionFitScore).toBeLessThan(roberto.decisionFitScore!);
    actions.restaurarPadroesRadar('pesosDecisionFit');
    actions.recalcularContatosRadar();
    expect(radar().contatos.find((c) => c.id === roberto.id)!.decisionFitScore).toBe(roberto.decisionFitScore);
  });
});
