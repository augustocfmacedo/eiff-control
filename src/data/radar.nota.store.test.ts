// Nota interna (NOTE) no Radar: registra sem contar como contato, sem mexer no score e sem criar oportunidade;
// a tarefa da proxima acao manual entra na fila.
import { beforeAll, describe, expect, it } from 'vitest';
import { filaHoje } from '../core/radar/pipeline';
import { actions, getState } from './store';

const radar = () => getState().ds.radar;

describe('nota interna no Radar', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  it('NOTE não vira último contato, não altera score nem cria oportunidade; a tarefa vira próxima ação na fila', () => {
    actions.importarCsvRadar('Razão Social;CNPJ;Cidade;UF;Setor;Funcionários
Nota Fictícia Indústria LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;300', { tipo: 'empresas' });
    const acme = radar().empresas.find((e) => e.cnpj === '11222333000181')!;
    const antes = { priority: acme.priorityScore, classe: acme.priorityClass, ultimoContato: acme.ultimoContatoEm, opps: radar().oportunidades.length, snaps: radar().snapshotsScore.length };
    const estrategia = radar().estrategias.find((s) => s.codigo === 'PRELIMINARY_ENGINEERING')!;
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(acme.id, { tipo: 'NOTE', canal: 'OTHER', estrategiaId: estrategia.id, notas: 'Director Tier pesquisado: NO_BETTER_DECISION_MAKER. Contato atual como rota de acesso.' }), { tipo: 'CALL', venceEm: '2026-09-09', descricao: 'D0 · pedir indicação do responsável por engenharia', prioridade: 'Alta' });
    const depois = radar().empresas.find((e) => e.id === acme.id)!;
    expect(depois.ultimoContatoEm).toBe(antes.ultimoContato);
    expect([depois.priorityScore, depois.priorityClass]).toEqual([antes.priority, antes.classe]);
    expect(radar().oportunidades.length).toBe(antes.opps);
    expect(radar().snapshotsScore.length).toBe(antes.snaps); // score igual: sem snapshot novo
    expect(depois.proximaAcaoEm).toBe('2026-09-09');
    const item = filaHoje(radar(), '2026-09-08').find((i) => i.empresa.id === acme.id)!;
    expect(item.proximaAcaoEm).toBe('2026-09-09');
    expect(radar().atividades.some((a) => a.empresaId === acme.id && a.tipo === 'NOTE' && a.estrategiaId === estrategia.id)).toBe(true);
  });
});
