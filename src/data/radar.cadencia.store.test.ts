// CM2-E (store) — porta governada de criacao da tarefa de cadencia: revalida contra o dataset atual, so entao gera id,
// persiste pelo mecanismo do Radar, audita a origem e recusa o segundo clique com JA_COBERTA. O legado nao muda.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import {
  cadenciasDaFilaCM, construirCommercialQueue, expectativaDaSugestaoCM, planosDaFilaCM, sugestoesTarefaDaFilaCM,
  type ExpectativaCriacaoCadenciaCM, type RadarDataset,
} from '../core/radar';
import { CASOS } from '../core/radar/cadenciaParidadeCM.fixtures';

const HOJE = '2026-09-15';
const USUARIO = 'u-admin';
const radar = () => getState().ds.radar;
const auditoria = () => getState().ds.auditoria;

const caso = (id: string) => CASOS.find((c) => c.id === id)!.ds;
/** Cenario: uma conta com silencio depois de resposta tratada (05b) e outra com oportunidade sem proxima acao (17b). */
function cenario(): Partial<RadarDataset> {
  const a = caso('05b'); const b = caso('17b');
  // terceira conta: mesmo silêncio, mas sem responsável em lugar nenhum (nenhum padrão pode preencher)
  const semDono = {
    empresas: a.empresas.map((e) => ({ ...e, id: 'semdono2', razaoSocial: 'Conta semdono2' })),
    contatos: a.contatos.map((c) => ({ ...c, id: 'c-semdono2', empresaId: 'semdono2' })),
    atividades: a.atividades.map((x) => ({ ...x, id: `${x.id}-sd`, empresaId: 'semdono2', contatoId: 'c-semdono2', usuarioId: '' })),
    tarefas: a.tarefas.map((t) => ({ ...t, id: `${t.id}-sd`, empresaId: 'semdono2', contatoId: 'c-semdono2', responsavelId: '' })),
  };
  return {
    empresas: [...a.empresas, ...b.empresas, ...semDono.empresas],
    contatos: [...a.contatos, ...b.contatos, ...semDono.contatos],
    atividades: [...a.atividades.map((x) => ({ ...x, usuarioId: USUARIO })), ...semDono.atividades],
    tarefas: [...a.tarefas.map((t) => ({ ...t, responsavelId: USUARIO })), ...semDono.tarefas],
    oportunidades: b.oportunidades.map((o) => ({ ...o, responsavelId: USUARIO })),
    pesosDecisionFit: a.pesosDecisionFit,
  };
}

function expectativaDe(empresaId: string): ExpectativaCriacaoCadenciaCM {
  const r = radar();
  const fila = construirCommercialQueue(r, HOJE);
  const planos = planosDaFilaCM(r, fila);
  const cadencias = cadenciasDaFilaCM(r, fila, planos, HOJE);
  const sugestoes = sugestoesTarefaDaFilaCM(r, fila, planos, cadencias, HOJE);
  const i = fila.itens.findIndex((it) => it.empresaId === empresaId);
  const e = expectativaDaSugestaoCM(cadencias[i], sugestoes[i]);
  if (!e) throw new Error(`sem sugestão datada para ${empresaId}`);
  return e;
}

describe('CM2-E (store) — criarTarefaDaCadenciaCM', () => {
  // a expectativa e capturada UMA vez, como a tela faria: depois da criacao ela nao pode mais ser remontada
  let expectativaLida: ExpectativaCriacaoCadenciaCM;
  beforeAll(() => {
    actions.trocarUsuario(USUARIO);
    actions.restaurarPlanilha();
    const ds = getState().ds;
    actions.importarJson(JSON.stringify({
      ...ds,
      params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false },
      radar: { ...ds.radar, ...cenario(), sinais: [], comunicacoes: [], duplicatas: [], supressoes: [], historicoEstagios: [], projetos: [] },
    }));
  });

  it('cria a tarefa do próximo passo com id novo, status Aberta e os campos da sugestão', () => {
    expectativaLida = expectativaDe('posdepois');
    const e = expectativaLida;
    const antes = radar().tarefas.length;
    const nova = actions.criarTarefaDaCadenciaCM(e);
    expect(nova.id).toMatch(/^TSK/);
    expect(nova).toMatchObject({ empresaId: 'posdepois', tipo: 'FOLLOW_UP', status: 'Aberta', prioridade: 'Normal', venceEm: e.dataRecomendada, responsavelId: USUARIO });
    expect(nova.descricao).toBe('Conta relevante sem momento comercial atual');
    expect(nova.criadoEm).toBeTruthy();
    expect(radar().tarefas).toHaveLength(antes + 1);
    expect(radar().tarefas.find((t) => t.id === nova.id)).toBeDefined();
  });

  it('audita a origem da criação (chave, motivo, âncora e versões)', () => {
    const registro = auditoria().find((a) => a.acao === 'radar_criar_tarefa_cadencia')!;
    expect(registro).toBeDefined();
    const depois = registro.depois as { tarefa: { id: string }; origem: ExpectativaCriacaoCadenciaCM & { dataEditada: boolean } };
    expect(registro.entidade).toBe('radar_tarefa');
    expect(depois.origem.chave).toMatch(/^cad:/);
    expect(depois.origem).toMatchObject({ motivo: 'SEM_TIMING_ATUAL', versaoCadencia: 'CM2-B.1', versaoRegrasFila: 'CM1-A.1', versaoPlano: 'CM1-B.1', dataEditada: false });
    expect(depois.origem.ancora.em).toBe('2026-09-10');
  });

  it('segundo clique com a mesma expectativa: recusa por já coberta, sem criar nada', () => {
    const e = expectativaLida;
    // a fila já mudou: a conta tem compromisso e a sugestão original não existe mais
    const r = radar();
    const fila = construirCommercialQueue(r, HOJE);
    const planos = planosDaFilaCM(r, fila);
    const sugestoes = sugestoesTarefaDaFilaCM(r, fila, planos, cadenciasDaFilaCM(r, fila, planos, HOJE), HOJE);
    expect(sugestoes.some((s) => s.chave === e.chave)).toBe(false);
    const antes = radar().tarefas.length;
    expect(() => actions.criarTarefaDaCadenciaCM(e)).toThrow(RegraDeNegocioError);
    expect(() => actions.criarTarefaDaCadenciaCM(e)).toThrow(/Já existe tarefa aberta para este ciclo/);
    expect(radar().tarefas).toHaveLength(antes);
  });

  it('aplica as edições humanas e mantém tipo e oportunidade da sugestão', () => {
    const e = expectativaDe('oppsem');
    const nova = actions.criarTarefaDaCadenciaCM(e, { venceEm: '2026-09-29', descricao: '  Fechar a próxima etapa  ', responsavelId: 'u-fin', contatoId: 'c-oppsem' });
    expect(nova).toMatchObject({ empresaId: 'oppsem', tipo: e.tipoTarefa, oportunidadeId: 'o1', venceEm: '2026-09-29', descricao: 'Fechar a próxima etapa', responsavelId: 'u-fin', contatoId: 'c-oppsem' });
    const registro = auditoria().find((a) => a.acao === 'radar_criar_tarefa_cadencia' && a.entidadeId === nova.id)!;
    expect((registro.depois as { origem: { dataEditada: boolean; descricaoEditada: boolean; contatoEditado: boolean } }).origem).toMatchObject({ dataEditada: true, descricaoEditada: true, contatoEditado: true });
  });

  it('recusa expectativa de versão antiga e responsável desconhecido, sem escrever', () => {
    const e = expectativaLida;
    const antes = radar().tarefas.length;
    expect(() => actions.criarTarefaDaCadenciaCM({ ...e, versaoCadencia: 'CM2-B.0' })).toThrow(/regras da Máquina Comercial mudaram/);
    expect(() => actions.criarTarefaDaCadenciaCM(e, { responsavelId: 'u-fantasma' })).toThrow(RegraDeNegocioError);
    expect(radar().tarefas).toHaveLength(antes);
  });

  it('conta sem responsável: nunca usa o usuário logado como padrão e valida contra os usuários reais', () => {
    const e = expectativaDe('semdono2');
    const antes = radar().tarefas.length;
    expect(() => actions.criarTarefaDaCadenciaCM(e)).toThrow(/Informe quem será responsável/);
    expect(() => actions.criarTarefaDaCadenciaCM(e, { responsavelId: 'u-fantasma' })).toThrow(/Informe quem será responsável/);
    expect(radar().tarefas).toHaveLength(antes);
    const nova = actions.criarTarefaDaCadenciaCM(e, { responsavelId: 'u-obra' });
    expect(nova.responsavelId).toBe('u-obra');
  });

  it('o caminho legado de tarefa continua livre da revalidação', () => {
    const antes = radar().tarefas.length;
    const manual = actions.novaTarefaRadar('posdepois', { descricao: 'tarefa manual', venceEm: '2026-10-01', responsavelId: USUARIO });
    const salva = actions.salvarTarefaRadar(manual);
    expect(salva.descricao).toBe('tarefa manual');
    expect(radar().tarefas).toHaveLength(antes + 1);
    expect(auditoria()[0].acao).toBe('radar_criar_tarefa');
  });
});
