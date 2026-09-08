// Jornada do Radar: importar empresas -> contatos -> sinal -> oportunidade com regra de proxima acao -> atividade ->
// tarefa -> estagio -> score/snapshot -> duplicata -> supressao.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { filaHoje, oportunidadesSemProximaAcao, resumoRadar } from '../core/radar';

const radar = () => getState().ds.radar;

describe('EIFF Radar (store)', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('padroes carregados: fontes, estrategias, respostas, regras e pesos', () => {
    expect(radar().fontes.length).toBeGreaterThan(5);
    expect(radar().estrategias.map((e) => e.codigo)).toContain('TECHNICAL_AUDIT');
    expect(radar().tiposResposta).toHaveLength(22);
    expect(radar().regrasScore.length).toBeGreaterThan(20);
    expect(radar().configScore.find((c) => c.chave === 'peso.TIMING')!.valor).toBe(0.35);
  });

  it('importa CSV de empresas com deduplicacao e depois contatos', () => {
    const job = actions.importarCsvRadar('Razão Social;CNPJ;Cidade;UF;Setor;Funcionários;Site\nAcme Indústria LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;300;www.acme.com.br\nBeta Logística;;Anápolis;GO;Logística;80;\nAcme Industria;11222333000181;Goiânia;GO;;;\nAcme Industria;;Rio Verde;GO;Indústria;;\n;12345678000195;x;GO;;;', { tipo: 'empresas', arquivo: 'teste.csv' });
    expect(job).toMatchObject({ total: 5, importados: 3, atualizados: 0, duplicados: 1, erros: 1, status: 'Com erros' });
    expect(radar().empresas.filter((e) => e.ativo)).toHaveLength(3);
    expect(radar().duplicatas.filter((d) => d.status === 'pendente')).toHaveLength(1);
    expect(radar().importacaoLinhas.filter((l) => l.jobId === job.id)).toHaveLength(5);
    expect(radar().importacaoErros.find((e) => e.jobId === job.id)!.campo).toBe('razaoSocial');
    expect(radar().registrosFonte.length).toBeGreaterThanOrEqual(3);
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    expect(acme.priorityScore).toBeGreaterThan(0);
    expect(acme.fitScore).toBe(70); // FIT balanceado: GO 15 + INDUSTRIA (nome) 35 + 201-500 17,5 + porte 2,5; receita ausente
    const jc = actions.importarCsvRadar('nome,cargo,email,telefone,empresa,decisor\nJoão Silva,Diretor Industrial,joao@acme.com.br,62999990000,Acme Indústria LTDA,sim\nMaria,Compradora,maria@beta.com,,Beta Logística,\nPedro,,,,Empresa Nova Ltda,', { tipo: 'contatos' });
    expect(jc).toMatchObject({ total: 3, importados: 3, erros: 0 });
    expect(radar().contatos.find((c) => c.email === 'joao@acme.com.br')!.empresaId).toBe(acme.id);
    expect(radar().empresas.some((e) => e.razaoSocial === 'Empresa Nova Ltda')).toBe(true);
    expect(radar().empresas.find((e) => e.id === acme.id)!.relationshipScore).toBe(45);
  });

  it('resolve duplicata mesclando na existente', () => {
    const d = radar().duplicatas.find((x) => x.status === 'pendente')!;
    const nova = radar().empresas.find((e) => e.id === d.empresaId)!;
    actions.resolverDuplicataRadar(d.id, 'mesclar');
    expect(radar().empresas.find((e) => e.id === nova.id)!.mescladaEm).toBe(d.candidataId);
    expect(radar().duplicatas.find((x) => x.id === d.id)!.status).toBe('mesclada');
    expect(filaHoje(radar(), getState().ds.params.dataBase).some((i) => i.empresa.id === nova.id)).toBe(false);
  });

  it('cadastro manual recusa CNPJ repetido e sinaliza nome parecido', () => {
    expect(() => actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Outra', cnpj: '11222333000181' })).toThrow(/Já existe/);
    const e = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Beta Logistica Transportes', uf: 'MG', cidade: 'Uberlândia' });
    expect(radar().duplicatas.some((d) => d.empresaId === e.id && d.status === 'pendente')).toBe(true);
  });

  it('sinal manual sobe o timing e gera snapshot; sinal repetido e recusado', () => {
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const antes = acme.timingScore;
    const s = actions.registrarSinalRadar({ empresaId: acme.id, tipo: 'NEW_FACTORY', titulo: 'Nova fábrica em Goiânia', eventoEm: '2026-09-01' });
    expect(s.verificado).toBe(true); expect(s.scoreBase).toBe(55);
    const depois = radar().empresas.find((e) => e.id === acme.id)!;
    expect(depois.timingScore).toBeGreaterThan(antes);
    expect(depois.ultimoSinalEm).toBe('2026-09-01');
    expect(radar().snapshotsScore.filter((x) => x.empresaId === acme.id).length).toBeGreaterThanOrEqual(2);
    expect(radar().snapshotsScore.at(-1)!.explicacao.dimensoes.find((d) => d.dimensao === 'TIMING')!.fatores[0].regra).toBe('Nova fábrica');
    expect(() => actions.registrarSinalRadar({ empresaId: acme.id, tipo: 'NEW_FACTORY', titulo: 'Nova fábrica em Goiânia', eventoEm: '2026-09-01' })).toThrow(/já está registrado/);
  });

  it('oportunidade ativa exige proxima acao; estagio muda com historico; ganha exige motivo', () => {
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const o = actions.novaOportunidadeRadar(acme.id);
    expect(() => actions.salvarOportunidadeRadar({ ...o, valorEstimado: 800000 })).toThrow(RegraDeNegocioError);
    const salva = actions.salvarOportunidadeRadar({ ...o, valorEstimado: 800000, proximaAcao: 'Ligar para o João', proximaAcaoEm: '2026-09-09' });
    expect(radar().historicoEstagios.filter((h) => h.oportunidadeId === salva.id)).toHaveLength(1);
    expect(oportunidadesSemProximaAcao(radar())).toHaveLength(0);
    expect(() => actions.mudarEstagioRadar(salva.id, 'WON', {})).toThrow(/motivo/);
    actions.mudarEstagioRadar(salva.id, 'CONTACT_STARTED', { proximaAcao: 'Enviar apresentação', proximaAcaoEm: '2026-09-10' });
    const h = radar().historicoEstagios.filter((x) => x.oportunidadeId === salva.id);
    expect(h).toHaveLength(2); expect(h[1]).toMatchObject({ de: 'DETECTED', para: 'CONTACT_STARTED' });
    expect(radar().oportunidades.find((x) => x.id === salva.id)!.probabilidade).toBe(0.2);
    expect(radar().empresas.find((e) => e.id === acme.id)!.proximaAcaoEm).toBe('2026-09-10');
  });

  it('atividade com resultado alimenta o score, cria a proxima tarefa e marca decisor; contato invalido vira supressao', () => {
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const joao = radar().contatos.find((c) => c.email === 'joao@acme.com.br')!;
    const opp = radar().oportunidades.find((o) => o.empresaId === acme.id)!;
    const intentAntes = acme.intentScore;
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(acme.id, { contatoId: joao.id, oportunidadeId: opp.id, tipo: 'CALL', canal: 'PHONE', resultado: 'REQUESTED_BUDGET', notas: 'quer orçamento do galpão' }), { tipo: 'PROPOSAL', venceEm: '2026-09-12', descricao: 'Enviar orçamento' });
    const e2 = radar().empresas.find((e) => e.id === acme.id)!;
    expect(e2.intentScore).toBeGreaterThan(intentAntes);
    expect(e2.ultimoContatoEm).toBeTruthy();
    expect(radar().tarefas.some((t) => t.descricao === 'Enviar orçamento' && t.oportunidadeId === opp.id)).toBe(true);
    const item = filaHoje(radar(), getState().ds.params.dataBase).find((i) => i.empresa.id === acme.id)!;
    expect(item.recomendacao.acao).toBe('Enviar apresentação'); // proxima acao da oportunidade tem precedencia
    // contato invalido: supressao de telefone; depois nao pode ser contatado por do_not_contact
    const maria = radar().contatos.find((c) => c.nome === 'Maria')!;
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(maria.empresaId, { contatoId: maria.id, canal: 'PHONE', resultado: 'INVALID_CONTACT' }));
    expect(radar().supressoes.find((s) => s.contatoId === maria.id)!.tipo).toBe('invalid_phone');
    actions.adicionarSupressaoRadar({ contatoId: maria.id, tipo: 'do_not_contact', motivo: 'pediu para não ligar' });
    expect(() => actions.registrarAtividadeRadar(actions.novaAtividadeRadar(maria.empresaId, { contatoId: maria.id, canal: 'WHATSAPP' }))).toThrow(/não contatar/);
    expect(filaHoje(radar(), getState().ds.params.dataBase).find((i) => i.empresa.id === maria.empresaId)!.decisor).toBeUndefined();
  });

  it('concluir a unica tarefa de uma oportunidade ativa exige a proxima; resumo do command center', () => {
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const opp = radar().oportunidades.find((o) => o.empresaId === acme.id)!;
    actions.mudarEstagioRadar(opp.id, 'PRICING', { proximaAcao: 'Enviar orçamento', proximaAcaoEm: '2026-08-01' }); // proxima acao ja passou
    const t = radar().tarefas.find((x) => x.oportunidadeId === opp.id && x.status === 'Aberta')!;
    expect(() => actions.concluirTarefaRadar(t.id)).toThrow(/próxima ação/);
    actions.concluirTarefaRadar(t.id, { tipo: 'FOLLOW_UP', venceEm: '2026-09-15', descricao: 'Cobrar retorno do orçamento' });
    expect(radar().tarefas.filter((x) => x.oportunidadeId === opp.id && x.status === 'Aberta')).toHaveLength(1);
    const r = resumoRadar(radar(), getState().ds.params.dataBase);
    expect(r.oportunidadesAtivas).toBe(1); expect(r.pipeline).toBe(800000); expect(r.respostas30d).toBeGreaterThanOrEqual(2); expect(r.oportunidadesSemAcao).toBe(0);
    expect(r.pipelinePonderado).toBeCloseTo(800000 * 0.65, 6);
  });

  it('configuracao: regra desativada muda o score ao recalcular; permissao de configuracao', () => {
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const regra = radar().regrasScore.find((x) => x.condicao.tipo === 'fitCalibrado' && x.condicao.componente === 'setor')!;
    actions.salvarRegraScoreRadar({ ...regra, ativo: false });
    actions.recalcularScoresRadar();
    expect(radar().empresas.find((e) => e.id === acme.id)!.fitScore).toBe(35); // 70 sem o componente de setor (35)
    actions.salvarRegraScoreRadar({ ...regra, ativo: true });
    actions.salvarConfigScoreRadar('classe.A+', 90);
    actions.trocarUsuario('u-compras');
    expect(() => actions.salvarConfigScoreRadar('classe.A+', 85)).toThrow(/permissão/);
    actions.trocarUsuario('u-audit');
    expect(() => actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'X' })).toThrow(/permissão/);
    actions.trocarUsuario('u-admin');
  });

  it('ingestao por adapter (CNO) cria empresa, projeto e sinal', () => {
    const r = actions.ingerirRegistrosRadar('CNO', [{ cno: '99.001', nomeResponsavel: 'Delta Bebidas SA', cnpjResponsavel: '', municipio: 'Goiânia', uf: 'GO', dataInicio: '2026-09-02', tipoObra: 'Construção nova', areaTotal: 8000 }]);
    expect(r).toMatchObject({ importadas: 1, sinais: 1 });
    const delta = radar().empresas.find((e) => e.razaoSocial === 'Delta Bebidas SA')!;
    expect(radar().projetos.some((p) => p.empresaId === delta.id)).toBe(true);
    expect(delta.timingScore).toBeGreaterThan(40);
  });
});
