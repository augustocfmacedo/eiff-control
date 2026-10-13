// CD-D3 / E0 — fluxo de oportunidades antes de metas e realizado (docs/commercial-director-1.0.md §19.6).
//
// Regressão do defeito F1 pelo MESMO caminho do formulário (`gravarOportunidadeDoFormulario`, chamado pelo botão
// Salvar do `OportunidadeForm`): marcar como ganha pelo formulário apagava `fechadoEm` e devolvia a próxima ação,
// porque o formulário gravava duas vezes e a segunda gravação usava o estado inicial. Mais: WON → WON, reabertura com
// motivo, campos travados do ganho, criação já fechada e compatibilidade com perda e estágios ativos.
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { aplicarTransicao, motivosRecusaEdicao, motivosRecusaTransicao, type Oportunidade } from '../core/radar';
import { gravarOportunidadeDoFormulario, motivoPedidoNoFormulario } from '../screens/radar/comum';

const radar = () => getState().ds.radar;
const opp = (id: string) => radar().oportunidades.find((o) => o.id === id)!;
const historico = (id: string) => radar().historicoEstagios.filter((h) => h.oportunidadeId === id).map((h) => `${h.de ?? '·'}>${h.para}${h.motivo ? `:${h.motivo}` : ''}`);
const ultimaAuditoria = () => getState().ds.auditoria[0];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let empresa = '';
let outraEmpresa = '';
/** Oportunidade ativa nova, com próxima ação e uma tarefa aberta, como o usuário a deixaria antes de ganhar. */
const ativa = (extra: Partial<Oportunidade> = {}): Oportunidade => {
  const o = actions.salvarOportunidadeRadar({ ...actions.novaOportunidadeRadar(empresa), estagio: 'NEGOTIATION', valorEstimado: 250000, proximaAcao: 'Ligar para o comprador', proximaAcaoEm: '2026-10-20', ...extra });
  actions.salvarTarefaRadar(actions.novaTarefaRadar(empresa, { oportunidadeId: o.id, descricao: 'Enviar minuta', venceEm: '2026-10-22', responsavelId: 'u-admin' }));
  return o;
};
const ganhaPeloFormulario = (o: Oportunidade, motivo = 'contrato assinado', extra: Partial<Oportunidade> = {}) =>
  gravarOportunidadeDoFormulario(o, { ...o, estagio: 'WON', ...extra }, motivo, true);

beforeAll(() => {
  actions.trocarUsuario('u-admin');
  actions.restaurarPlanilha();
  empresa = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Oportunidades E0 Fictícia LTDA', uf: 'GO' }).id;
  outraEmpresa = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Outra E0 Fictícia LTDA', uf: 'GO' }).id;
});
beforeEach(() => actions.trocarUsuario('u-admin'));

describe('E0 · F1 — ganho pelo formulário preserva o fechamento (fluxo real do OportunidadeForm)', () => {
  it('marcar como ganha pelo formulário grava o instante, o motivo e encerra a próxima ação e as tarefas, numa ação só', () => {
    const o = ativa();
    const nAud = getState().ds.auditoria.length;
    const r = ganhaPeloFormulario(o, 'contrato assinado', { observacoes: 'assinado na visita' });
    const salva = opp(o.id);
    expect(salva.estagio).toBe('WON');
    expect(salva.fechadoEm).toMatch(ISO);
    expect(salva.fechadoEm).toBe(r.fechadoEm);
    expect(salva.motivoFechamento).toBe('contrato assinado');
    expect(salva.proximaAcao).toBeUndefined();
    expect(salva.proximaAcaoEm).toBeUndefined();
    expect(salva.observacoes).toBe('assinado na visita'); // as demais edições do formulário vão no mesmo commit
    expect(salva.probabilidade).toBe(1);
    expect(radar().tarefas.filter((t) => t.oportunidadeId === o.id).map((t) => t.status)).toEqual(['Cancelada']);
    expect(historico(o.id)).toEqual(['·>NEGOTIATION', 'NEGOTIATION>WON:contrato assinado']);
    expect(getState().ds.auditoria.length - nAud).toBe(1); // uma gravação só (antes eram duas)
    expect(ultimaAuditoria()).toMatchObject({ acao: 'radar_mudar_estagio', antes: { estagio: 'NEGOTIATION', fechadoEm: null }, depois: { estagio: 'WON', fechadoEm: salva.fechadoEm }, motivo: 'contrato assinado' });
  });

  it('a segunda gravação antiga (estado inicial por cima do ganho) agora é recusada e não apaga o fechamento', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    const fechadoEm = opp(o.id).fechadoEm;
    // o que o formulário fazia depois de mudar o estágio: salvar o objeto do formulário, sem o instante de fechamento
    expect(() => actions.salvarOportunidadeRadar({ ...o, estagio: 'WON', motivoFechamento: 'contrato assinado' })).toThrow(/data de fechamento|próxima ação/);
    expect(opp(o.id).fechadoEm).toBe(fechadoEm);
    expect(opp(o.id).proximaAcao).toBeUndefined();
  });

  it('o botão Salvar do formulário chama só a ação única (guarda de fonte)', () => {
    const fonte = readFileSync('src/screens/radar/comum.tsx', 'utf8');
    const form = fonte.slice(fonte.indexOf('export function OportunidadeForm'), fonte.indexOf('</Modal>', fonte.indexOf('export function OportunidadeForm')));
    expect(form).toContain('gravarOportunidadeDoFormulario(inicial, o, motivo, existe)');
    expect(form).not.toMatch(/actions\.(salvarOportunidadeRadar|mudarEstagioRadar)/);
    const helper = fonte.slice(fonte.indexOf('export function gravarOportunidadeDoFormulario'), fonte.indexOf('export function motivoPedidoNoFormulario'));
    expect(helper.match(/actions\.\w+\(/g)).toEqual(['actions.mudarEstagioRadar(', 'actions.salvarOportunidadeRadar(']); // um ou outro, nunca os dois
    expect(helper).toMatch(/return actions\.mudarEstagioRadar[\s\S]*\}\s*return actions\.salvarOportunidadeRadar/);
  });
});

describe('E0 · transição canônica', () => {
  it('WON → WON não é nova transição: recusado, sem mexer no instante nem no histórico', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    const antes = structuredClone(opp(o.id));
    const nHist = historico(o.id).length;
    expect(() => actions.mudarEstagioRadar(o.id, 'WON', { motivo: 'de novo' })).toThrow(/já está ganha/);
    expect(opp(o.id)).toEqual(antes);
    expect(historico(o.id)).toHaveLength(nHist);
  });

  it('reabrir um ganho exige motivo; com motivo limpa o instante, registra o motivo e volta a exigir próxima ação', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    expect(() => actions.mudarEstagioRadar(o.id, 'NEGOTIATION', { proximaAcao: 'Revisar escopo', proximaAcaoEm: '2026-10-25' })).toThrow(/reabrir/);
    expect(opp(o.id).estagio).toBe('WON');
    expect(() => actions.mudarEstagioRadar(o.id, 'NEGOTIATION', { motivo: 'cliente pediu revisão' })).toThrow(/próxima ação/);
    const reaberta = gravarOportunidadeDoFormulario(opp(o.id), { ...opp(o.id), estagio: 'NEGOTIATION', proximaAcao: 'Revisar escopo', proximaAcaoEm: '2026-10-25' }, 'cliente pediu revisão', true);
    expect(reaberta).toMatchObject({ estagio: 'NEGOTIATION', fechadoEm: undefined, proximaAcao: 'Revisar escopo' });
    expect(historico(o.id).slice(-1)).toEqual(['WON>NEGOTIATION:cliente pediu revisão']);
    expect(motivoPedidoNoFormulario({ estagio: 'WON' }, { estagio: 'NEGOTIATION' }, true)).toBe('Motivo da reabertura');
  });

  it('ganhar de novo depois de reabrir é uma transição nova, com instante novo', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    const primeiro = opp(o.id).fechadoEm!;
    actions.mudarEstagioRadar(o.id, 'NEGOTIATION', { motivo: 'reaberta', proximaAcao: 'Ajustar', proximaAcaoEm: '2026-10-25' });
    actions.mudarEstagioRadar(o.id, 'WON', { motivo: 'fechou de novo' });
    expect(opp(o.id).fechadoEm! >= primeiro).toBe(true);
    expect(historico(o.id).slice(-3)).toEqual(['NEGOTIATION>WON:contrato assinado', 'WON>NEGOTIATION:reaberta', 'NEGOTIATION>WON:fechou de novo']);
  });

  it('salvar não muda estágio: a mudança é só pela ação de estágio', () => {
    const o = ativa();
    expect(() => actions.salvarOportunidadeRadar({ ...o, estagio: 'PRICING' })).toThrow(/mudança de estágio/);
    expect(opp(o.id).estagio).toBe('NEGOTIATION');
  });
});

describe('E0 · oportunidade ganha não muda valor, empresa, responsável nem data de fechamento', () => {
  it('cada campo travado é recusado e nada muda; título e observações seguem editáveis', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    const ganha = opp(o.id);
    const nAud = getState().ds.auditoria.length;
    for (const [campo, valor, re] of [
      ['valorEstimado', 999999, /o valor/],
      ['valorEstimado', undefined, /o valor/],
      ['empresaId', outraEmpresa, /a empresa/],
      ['responsavelId', 'u-fin', /o responsável/],
      ['fechadoEm', '2026-01-01T12:00:00.000Z', /a data de fechamento/],
      ['fechadoEm', undefined, /a data de fechamento/],
      ['proximaAcao', 'nova ação', /não tem próxima ação/],
    ] as const) {
      expect(() => actions.salvarOportunidadeRadar({ ...ganha, [campo]: valor }), campo).toThrow(re);
      expect(() => actions.salvarOportunidadeRadar({ ...ganha, [campo]: valor }), campo).toThrow(RegraDeNegocioError);
    }
    expect(opp(o.id)).toEqual(ganha);
    expect(getState().ds.auditoria.length).toBe(nAud);
    const editada = actions.salvarOportunidadeRadar({ ...ganha, titulo: 'Galpão principal (contrato)', observacoes: 'OS emitida' });
    expect(editada).toMatchObject({ titulo: 'Galpão principal (contrato)', observacoes: 'OS emitida', fechadoEm: ganha.fechadoEm, valorEstimado: 250000, estagio: 'WON' });
  });

  it('reabrir com motivo libera a correção do valor; ganhar de novo grava o valor corrigido', () => {
    const o = ativa();
    ganhaPeloFormulario(o);
    actions.mudarEstagioRadar(o.id, 'NEGOTIATION', { motivo: 'valor do contrato errado', proximaAcao: 'Conferir contrato', proximaAcaoEm: '2026-10-25' });
    actions.salvarOportunidadeRadar({ ...opp(o.id), valorEstimado: 240000 });
    actions.mudarEstagioRadar(o.id, 'WON', { motivo: 'contrato conferido' });
    expect(opp(o.id)).toMatchObject({ estagio: 'WON', valorEstimado: 240000 });
  });
});

describe('E0 · criação e compatibilidade', () => {
  it('criar já ganha exige motivo; com motivo nasce com instante, sem próxima ação e com histórico', () => {
    const nova = { ...actions.novaOportunidadeRadar(empresa), estagio: 'WON' as const, valorEstimado: 50000, proximaAcao: 'x', proximaAcaoEm: '2026-10-30' };
    expect(() => gravarOportunidadeDoFormulario(nova, nova, '', false)).toThrow(/motivo/);
    const criada = gravarOportunidadeDoFormulario(nova, nova, 'pedido direto', false);
    expect(criada).toMatchObject({ estagio: 'WON', motivoFechamento: 'pedido direto', proximaAcao: undefined, proximaAcaoEm: undefined, probabilidade: 1 });
    expect(criada.fechadoEm).toMatch(ISO);
    expect(historico(criada.id)).toEqual(['·>WON:pedido direto']);
    expect(motivoPedidoNoFormulario({ estagio: 'WON' }, { estagio: 'WON' }, false)).toBe('Motivo do ganho');
    expect(motivoPedidoNoFormulario({ estagio: 'WON' }, { estagio: 'WON' }, true)).toBeUndefined(); // ganha mantida ganha: nada a pedir
  });

  it('perda segue igual: exige motivo e grava o instante; reabrir uma perda não exige motivo; LOST → LOST é recusado', () => {
    const o = ativa();
    expect(() => actions.mudarEstagioRadar(o.id, 'LOST', {})).toThrow(/motivo/);
    actions.mudarEstagioRadar(o.id, 'LOST', { motivo: 'preço' });
    expect(opp(o.id).fechadoEm).toMatch(ISO);
    expect(() => actions.mudarEstagioRadar(o.id, 'LOST', { motivo: 'de novo' })).toThrow(/já está nesse estágio/);
    actions.mudarEstagioRadar(o.id, 'NURTURE', {});
    expect(opp(o.id)).toMatchObject({ estagio: 'NURTURE', fechadoEm: undefined });
  });

  it('estágios ativos e a regra da próxima ação continuam como antes', () => {
    const o = ativa();
    actions.mudarEstagioRadar(o.id, 'PROPOSAL_SENT', { proximaAcao: 'Cobrar retorno', proximaAcaoEm: '2026-10-28' });
    expect(opp(o.id)).toMatchObject({ estagio: 'PROPOSAL_SENT', proximaAcao: 'Cobrar retorno', fechadoEm: undefined });
    const semAcao = actions.salvarOportunidadeRadar({ ...actions.novaOportunidadeRadar(empresa), estagio: 'QUALIFIED', proximaAcao: 'Ligar', proximaAcaoEm: '2026-10-21' });
    expect(() => actions.salvarOportunidadeRadar({ ...semAcao, proximaAcao: undefined, proximaAcaoEm: undefined })).toThrow(/próxima ação/);
  });

  it('sem a permissão radar nada muda', () => {
    const o = ativa();
    actions.trocarUsuario('u-contab');
    expect(() => actions.mudarEstagioRadar(o.id, 'WON', { motivo: 'x' })).toThrow(/permiss/i);
    expect(opp(o.id).estagio).toBe('NEGOTIATION');
  });
});

describe('E0 · regras puras', () => {
  const base: Oportunidade = { id: 'O1', empresaId: 'E1', titulo: 'T', estagio: 'NEGOTIATION', valorEstimado: 10, probabilidade: 0.85, responsavelId: 'u', proximaAcao: 'a', proximaAcaoEm: '2026-10-20', observacoes: '', criadoEm: 'c', atualizadoEm: 'c' };
  it('motivosRecusaTransicao: inválido, mesmo estágio, fechar sem motivo, reabrir ganho sem motivo', () => {
    expect(motivosRecusaTransicao(base, 'XYZ' as never)).toEqual(['Estágio inválido.']);
    expect(motivosRecusaTransicao({ estagio: 'WON' }, 'WON', { motivo: 'm' })[0]).toMatch(/já está ganha/);
    expect(motivosRecusaTransicao(base, 'WON', { motivo: '  ' })[0]).toMatch(/motivo/);
    expect(motivosRecusaTransicao({ estagio: 'WON' }, 'NEGOTIATION')[0]).toMatch(/reabrir/);
    expect(motivosRecusaTransicao({ estagio: 'LOST' }, 'NEGOTIATION')).toEqual([]);
    expect(motivosRecusaTransicao(undefined, 'DETECTED')).toEqual([]);
  });
  it('aplicarTransicao é determinística e não muda a entrada', () => {
    const congelada = Object.freeze({ ...base });
    const a = aplicarTransicao(congelada, 'WON', { motivo: ' ok ', valorEstimado: 12 }, '2026-10-13T12:00:00.000Z');
    expect(a).toEqual(aplicarTransicao(congelada, 'WON', { motivo: ' ok ', valorEstimado: 12 }, '2026-10-13T12:00:00.000Z'));
    expect(a).toMatchObject({ estagio: 'WON', fechadoEm: '2026-10-13T12:00:00.000Z', motivoFechamento: 'ok', valorEstimado: 12, proximaAcao: undefined, probabilidade: 1 });
    expect(aplicarTransicao({ ...a }, 'NEGOTIATION', { motivo: 'r', proximaAcao: 'b', proximaAcaoEm: '2026-11-01' }, 'x')).toMatchObject({ fechadoEm: undefined, proximaAcao: 'b' });
  });
  it('motivosRecusaEdicao: travas só no ganho; fechada sem próxima ação', () => {
    const ganha = { ...base, estagio: 'WON' as const, fechadoEm: 'f', proximaAcao: undefined, proximaAcaoEm: undefined };
    expect(motivosRecusaEdicao(ganha, { ...ganha })).toEqual([]);
    expect(motivosRecusaEdicao(ganha, { ...ganha, valorEstimado: 11, responsavelId: 'v' })).toHaveLength(2);
    expect(motivosRecusaEdicao(base, { ...base, valorEstimado: 11, responsavelId: 'v' })).toEqual([]); // ativa: livre
  });
});
