// CD-D5 — Dono da conta (docs/commercial-director-1.0.md §19.3). Jornada no store, em modo local com o seed.
//
// A matriz de testes da decisão (1 a 16) está marcada em cada caso. O banco (FK, organização, ativo, auditoria e
// mescla no PostgreSQL) é provado à parte por scripts/pg-smoke-dono-conta.mjs.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { construirCommercialQueue, contasSemDonoValido, entraEmMetricaIndividual, estadoDonoConta } from '../core/radar';
import { snapshotComercialCD } from '../core/radar/commercialDirector';

const radar = () => getState().ds.radar;
const hoje = () => getState().ds.params.dataBase;
const usuarios = () => getState().ds.usuarios;
const empresa = (id: string) => radar().empresas.find((e) => e.id === id)!;
const porCnpj = (cnpj: string) => radar().empresas.find((e) => e.cnpj === cnpj)!;
/** O store não tem ação de cadastro de usuário: o teste muda o estado ativo direto no objeto carregado e desfaz depois. */
const comAtivo = <T,>(usuarioId: string, ativo: boolean, fn: () => T): T => {
  const u = getState().ds.usuarios.find((x) => x.id === usuarioId)!;
  const antes = u.ativo;
  u.ativo = ativo;
  try { return fn(); } finally { u.ativo = antes; }
};

describe('CD-D5 · dono da conta (store)', () => {
  let acme = '';
  let beta = '';
  let gama = '';

  beforeAll(() => {
    actions.trocarUsuario('u-admin');
    actions.restaurarPlanilha();
    // a coluna "Dono" do CSV não é reconhecida: importação nunca define dono
    actions.importarCsvRadar([
      'Razão Social;CNPJ;Cidade;UF;Setor;Funcionários;Dono;commercialOwnerId',
      'Acme Dono Fictícia LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;1200;u-eng;u-eng',
      'Beta Dono Fictícia LTDA;;Anápolis;GO;Logística;300;u-fin;u-fin',
      'Gama Dono Fictícia LTDA;;Goiânia;GO;Indústria;150;;',
    ].join('\n'), { tipo: 'empresas' });
    acme = porCnpj('11222333000181').id;
    beta = radar().empresas.find((e) => e.razaoSocial.startsWith('Beta Dono'))!.id;
    gama = radar().empresas.find((e) => e.razaoSocial.startsWith('Gama Dono'))!.id;
    actions.importarCsvRadar('Empresa;Nome;Cargo;E-mail;Status do e-mail;Celular\nAcme Dono Fictícia LTDA;Roberto Fictício;Diretor Industrial;roberto@acme-ficticia.com.br;valid;62999990001', { tipo: 'contatos' });
    actions.registrarSinalRadar({ empresaId: acme, tipo: 'NEW_FACTORY', titulo: 'Nova fábrica (fictício)', eventoEm: '2026-08-28' });
    const o = actions.novaOportunidadeRadar(beta);
    actions.salvarOportunidadeRadar({ ...o, responsavelId: 'u-fin', valorEstimado: 500000, proximaAcao: 'Ligar para o comprador', proximaAcaoEm: '2026-09-09' });
    actions.salvarTarefaRadar(actions.novaTarefaRadar(gama, { descricao: 'Pesquisar decisor', venceEm: '2026-09-05', responsavelId: 'u-compras' }));
  });

  it('1 · empresa nova nasce SEM_DONO (CSV, mesmo com coluna "Dono", e cadastro manual)', () => {
    for (const id of [acme, beta, gama]) {
      expect(empresa(id).commercialOwnerId).toBeUndefined();
      expect(estadoDonoConta(empresa(id), usuarios())).toBe('SEM_DONO');
    }
    const manual = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Delta Manual Fictícia', uf: 'GO', commercialOwnerId: 'u-eng' });
    expect(manual.commercialOwnerId).toBeUndefined(); // o cadastro genérico não define dono
  });

  it('2 · usuário ativo da mesma organização pode ser dono', () => {
    const e = actions.definirDonoContaRadar(acme, 'u-eng');
    expect(e.commercialOwnerId).toBe('u-eng');
    expect(estadoDonoConta(empresa(acme), usuarios())).toBe('COM_DONO');
  });

  it('3 · usuário inativo não pode ser atribuído (falha fechada, nada muda)', () => {
    comAtivo('u-obra', false, () => {
      expect(() => actions.definirDonoContaRadar(beta, 'u-obra')).toThrow(/ativo/);
    });
    expect(empresa(beta).commercialOwnerId).toBeUndefined();
  });

  it('4 · usuário de outra organização (fora da lista da organização) não pode ser atribuído', () => {
    expect(() => actions.definirDonoContaRadar(beta, 'u-de-outra-organizacao')).toThrow(/mesma organização/);
    expect(() => actions.definirDonoContaRadar(beta, '   ')).toThrow(RegraDeNegocioError);
    expect(() => actions.definirDonoContaRadar('empresa-que-nao-existe', 'u-eng')).toThrow(/não encontrada/);
    expect(empresa(beta).commercialOwnerId).toBeUndefined();
  });

  it('5 · remover o dono volta a SEM_DONO', () => {
    actions.definirDonoContaRadar(gama, 'u-compras');
    expect(estadoDonoConta(empresa(gama), usuarios())).toBe('COM_DONO');
    actions.definirDonoContaRadar(gama, null);
    expect(empresa(gama).commercialOwnerId).toBeUndefined();
    expect(estadoDonoConta(empresa(gama), usuarios())).toBe('SEM_DONO');
  });

  it('6 · mudança de dono gera auditoria com o anterior e o novo', () => {
    actions.definirDonoContaRadar(acme, 'u-fin', 'redistribuição da carteira');
    const a = getState().ds.auditoria[0];
    expect(a).toMatchObject({ acao: 'radar_definir_dono_conta', entidade: 'radar_empresa', entidadeId: acme, antes: { commercialOwnerId: 'u-eng' }, depois: { commercialOwnerId: 'u-fin' }, motivo: 'redistribuição da carteira' });
    actions.definirDonoContaRadar(acme, null);
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'radar_remover_dono_conta', antes: { commercialOwnerId: 'u-fin' }, depois: { commercialOwnerId: null } });
    const n = getState().ds.auditoria.length;
    actions.definirDonoContaRadar(acme, null); // sem mudança: nada a auditar
    expect(getState().ds.auditoria.length).toBe(n);
  });

  it('7, 8, 9 e 10 · dono não toca responsável da oportunidade, da tarefa nem da fila; a ordem da fila é a mesma', () => {
    const oportunidades = structuredClone(radar().oportunidades);
    const tarefas = structuredClone(radar().tarefas);
    const filaAntes = construirCommercialQueue(radar(), hoje());
    actions.definirDonoContaRadar(acme, 'u-eng');
    actions.definirDonoContaRadar(beta, 'u-eng');
    actions.definirDonoContaRadar(gama, 'u-eng');
    expect(radar().oportunidades).toEqual(oportunidades); // responsavelId da oportunidade (u-fin) intacto
    expect(radar().oportunidades.find((o) => o.empresaId === beta)!.responsavelId).toBe('u-fin');
    expect(radar().tarefas).toEqual(tarefas); // responsável da tarefa (u-compras) intacto
    expect(radar().tarefas.find((t) => t.empresaId === gama && t.descricao === 'Pesquisar decisor')!.responsavelId).toBe('u-compras');
    const filaDepois = construirCommercialQueue(radar(), hoje());
    expect(filaDepois).toEqual(filaAntes); // mesma fila: itens, ordem, responsável derivado e origem
    expect(filaDepois.itens.map((i) => [i.empresaId, i.responsavelId, i.origemResponsavel])).toEqual(filaAntes.itens.map((i) => [i.empresaId, i.responsavelId, i.origemResponsavel]));
  });

  it('11 · conta sem dono continua podendo estar na fila', () => {
    actions.definirDonoContaRadar(acme, null);
    const fila = construirCommercialQueue(radar(), hoje());
    expect(fila.itens.some((i) => i.empresaId === acme)).toBe(true);
    expect(estadoDonoConta(empresa(acme), usuarios())).toBe('SEM_DONO');
  });

  it('12 · conta sem dono válido fica fora das métricas individuais', () => {
    expect(entraEmMetricaIndividual(empresa(acme), usuarios())).toBe(false); // SEM_DONO
    expect(entraEmMetricaIndividual(empresa(beta), usuarios())).toBe(true); // COM_DONO (u-eng ativo)
    comAtivo('u-eng', false, () => expect(entraEmMetricaIndividual(empresa(beta), usuarios())).toBe(false)); // DONO_INATIVO
  });

  it('13 · dono desativado depois vira DONO_INATIVO, sem limpeza automática; a conta continua editável', () => {
    comAtivo('u-eng', false, () => {
      expect(empresa(beta).commercialOwnerId).toBe('u-eng'); // vínculo histórico preservado
      expect(estadoDonoConta(empresa(beta), usuarios())).toBe('DONO_INATIVO');
      expect(contasSemDonoValido(radar(), usuarios()).map((e) => e.id)).toEqual(expect.arrayContaining([acme, beta, gama]));
      const editada = actions.salvarEmpresaRadar({ ...empresa(beta), observacoes: 'editada com dono inativo' });
      expect(editada.commercialOwnerId).toBe('u-eng'); // editar a conta não limpa nem revalida o dono
      const s = snapshotComercialCD(radar(), hoje(), { usuarios: usuarios() });
      expect(s.base.contasSemDono).toMatchObject({ estado: 'DISPONIVEL', valor: contasSemDonoValido(radar(), usuarios()).length });
      expect(s.versaoRegras).toBe('CD-1.2');
    });
    expect(estadoDonoConta(empresa(beta), usuarios())).toBe('COM_DONO'); // reativado, volta a valer
  });

  it('o cadastro genérico nunca troca o dono (só a ação explícita)', () => {
    const antes = empresa(beta).commercialOwnerId;
    const salva = actions.salvarEmpresaRadar({ ...empresa(beta), commercialOwnerId: 'u-compras', observacoes: 'tentativa indireta' });
    expect(salva.commercialOwnerId).toBe(antes);
  });

  it('14 · mescla com canônica que tem dono preserva o dono da canônica', () => {
    const canonica = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Canônica Com Dono Fictícia', uf: 'GO', cidade: 'Goiânia' });
    const absorvida = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Absorvida Um Fictícia', uf: 'MT', cidade: 'Cuiabá' });
    actions.definirDonoContaRadar(canonica.id, 'u-eng');
    actions.definirDonoContaRadar(absorvida.id, 'u-fin');
    actions.mesclarEmpresasRadar(canonica.id, absorvida.id, 'teste CD-D5');
    expect(empresa(canonica.id).commercialOwnerId).toBe('u-eng');
    expect(empresa(absorvida.id).mescladaEm).toBe(canonica.id);
    expect(() => actions.definirDonoContaRadar(absorvida.id, 'u-eng')).toThrow(/canônica/);
  });

  it('15 · mescla com canônica sem dono NÃO herda o dono da absorvida', () => {
    const canonica = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Canônica Sem Dono Fictícia', uf: 'GO', cidade: 'Anápolis' });
    const absorvida = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Absorvida Dois Fictícia', uf: 'PR', cidade: 'Curitiba' });
    actions.definirDonoContaRadar(absorvida.id, 'u-fin');
    actions.mesclarEmpresasRadar(canonica.id, absorvida.id, 'teste CD-D5');
    expect(empresa(canonica.id).commercialOwnerId).toBeUndefined();
    expect(estadoDonoConta(empresa(canonica.id), usuarios())).toBe('SEM_DONO');
  });

  it('16 · permissão radar é respeitada', () => {
    actions.trocarUsuario('u-contab'); // Contabilidade não tem a permissão radar
    expect(() => actions.definirDonoContaRadar(gama, 'u-eng')).toThrow(/permiss/i);
    actions.trocarUsuario('u-audit');
    expect(() => actions.definirDonoContaRadar(gama, null)).toThrow(/permiss/i);
    actions.trocarUsuario('u-compras'); // Compras tem radar
    expect(actions.definirDonoContaRadar(gama, 'u-compras').commercialOwnerId).toBe('u-compras');
    actions.trocarUsuario('u-admin');
  });
});
