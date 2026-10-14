// CD-D3/E3 — livro de desfechos pelo caminho real do app (formulário → store). Modo local: o store usa o espelho do
// gatilho; no remoto o banco grava (provado em radar.desfechos.integracao.test.ts e scripts/pg-smoke-desfechos.mjs).
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { apurarMetaComercial, motivosRecusaEdicao, motivosRecusaTransicao, aplicarTransicao, type Oportunidade } from '../core/radar';
import { gravarOportunidadeDoFormulario } from '../screens/radar/comum';

const radar = () => getState().ds.radar;
const livro = (opp: string) => (radar().desfechos ?? []).filter((e) => e.oportunidadeId === opp);
let empresa = '';
const ativa = (extra: Partial<Oportunidade> = {}): Oportunidade =>
  actions.salvarOportunidadeRadar({ ...actions.novaOportunidadeRadar(empresa), estagio: 'NEGOTIATION', valorEstimado: 250000, proximaAcao: 'Ligar', proximaAcaoEm: '2026-10-20', ...extra });
const formulario = (o: Oportunidade, estagio: Oportunidade['estagio'], motivo: string, extra: Partial<Oportunidade> = {}) =>
  gravarOportunidadeDoFormulario(o, { ...o, estagio, ...extra }, motivo, true);

beforeAll(() => {
  actions.trocarUsuario('u-admin');
  actions.restaurarPlanilha();
  empresa = actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: 'Desfechos E3 Fictícia LTDA', uf: 'GO' }).id;
});
beforeEach(() => actions.trocarUsuario('u-admin'));

describe('E3 · valor fechado separado do estimado (E0 ajustado)', () => {
  it('marcar como ganha com valor fechado: o estimado não muda; o livro recebe o GANHO com o valor confirmado', () => {
    const o = ativa();
    const g = formulario(o, 'WON', 'contrato assinado', { valorFechado: 1250000.5 });
    expect([g.estagio, g.valorEstimado, g.valorFechado]).toEqual(['WON', 250000, 1250000.5]);
    expect(livro(o.id).map((e) => [e.tipo, e.valor, e.responsavelId, e.registradoPor, e.motivo])).toEqual([['GANHO', 1250000.5, o.responsavelId, 'u-admin', 'contrato assinado']]);
  });

  it('ganha sem valor: GANHO incompleto (sem `valor`), nunca o estimado', () => {
    const o = ativa();
    formulario(o, 'WON', 'ganho sem valor');
    const [ev] = livro(o.id);
    expect([ev.tipo, 'valor' in ev]).toEqual(['GANHO', false]);
  });

  it('valor fechado só ao marcar como ganha; valor inválido recusado', () => {
    expect(motivosRecusaTransicao({ estagio: 'QUALIFIED' }, 'PRICING', { valorFechado: 10 })).toEqual(['O valor fechado só é informado ao marcar como ganha.']);
    expect(motivosRecusaTransicao({ estagio: 'PRICING' }, 'WON', { motivo: 'motivo ok', valorFechado: 0 })[0]).toMatch(/positivo/);
    expect(motivosRecusaTransicao({ estagio: 'PRICING' }, 'WON', { motivo: 'motivo ok', valorFechado: 10.001 })[0]).toMatch(/2 casas/);
    expect(motivosRecusaTransicao({ estagio: 'PRICING' }, 'WON', { motivo: 'motivo ok', valorFechado: 1e12 + 1 })[0]).toMatch(/máximo/);
    const o = ativa();
    expect(() => formulario(o, 'WON', 'x', { valorFechado: 10.001 })).toThrow(RegraDeNegocioError);
    expect(livro(o.id)).toEqual([]);
  });

  it('ganha travada: o valor fechado também não muda na edição comum (reabrir com motivo)', () => {
    const o = ativa();
    const g = formulario(o, 'WON', 'assinado', { valorFechado: 100 });
    expect(motivosRecusaEdicao(g, { ...g, valorFechado: 200 })).toEqual(['Oportunidade ganha: o valor fechado não pode ser alterado — reabra a oportunidade com motivo para corrigir.']);
    expect(() => actions.salvarOportunidadeRadar({ ...g, valorFechado: 200 })).toThrow(/valor fechado/);
  });

  it('edição comum de oportunidade aberta nunca grava valor fechado (só a transição)', () => {
    const o = ativa();
    const salva = actions.salvarOportunidadeRadar({ ...o, valorFechado: 999 });
    expect(salva.valorFechado).toBeUndefined();
    expect(aplicarTransicao(o, 'PRICING', {}, '2026-10-14T12:00:00.000Z').valorFechado).toBeUndefined();
  });
});

describe('E3 · ciclo completo pelo formulário: ganho, reabertura, novo ganho, perda', () => {
  it('GANHO → ESTORNO (reabrir) → GANHO → ESTORNO (perda); WON → WON não duplica', () => {
    const o = ativa();
    const g1 = formulario(o, 'WON', 'assinado', { valorFechado: 1000 });
    actions.salvarOportunidadeRadar({ ...g1, observacoes: 'editada depois do ganho' }); // WON → WON
    expect(livro(o.id).map((e) => e.tipo)).toEqual(['GANHO']);
    const r = formulario(opp(o.id), 'NEGOTIATION', 'cliente pediu revisão', { proximaAcao: 'Rever escopo', proximaAcaoEm: '2026-10-25' });
    expect(r.valorFechado).toBeUndefined();
    const g2 = formulario(opp(o.id), 'WON', 'aditivo', { valorFechado: 1100 });
    formulario(g2, 'LOST', 'cancelado');
    const l = livro(o.id);
    expect(l.map((e) => e.tipo)).toEqual(['GANHO', 'ESTORNO_GANHO', 'GANHO', 'ESTORNO_GANHO']);
    expect([l[1].ganhoId, l[3].ganhoId]).toEqual([l[0].id, l[2].id]);
  });

  it('criação já ganha pelo formulário gera GANHO', () => {
    const nova = { ...actions.novaOportunidadeRadar(empresa), titulo: 'Nasce ganha', estagio: 'WON' as const, valorFechado: 880000 };
    const o = gravarOportunidadeDoFormulario(nova, nova, 'fechado na criação', false);
    expect(livro(o.id).map((e) => [e.tipo, e.valor])).toEqual([['GANHO', 880000]]);
  });
});

describe('E3 · complemento governado (Administrador e Diretoria)', () => {
  it('completa o ganho sem valor uma vez; outros papéis não; realizado do mês corrigido', () => {
    const o = ativa();
    formulario(o, 'WON', 'sem valor');
    const ganho = livro(o.id)[0];
    for (const u of ['u-fin', 'u-obra', 'u-compras', 'u-eng']) {
      actions.trocarUsuario(u);
      expect(() => actions.complementarValorGanhoRadar(ganho.id, 1000, 'valor da NF'), u).toThrow();
    }
    actions.trocarUsuario('u-augusto'); // Diretoria
    const nAud = getState().ds.auditoria.length;
    const c = actions.complementarValorGanhoRadar(ganho.id, 450000.75, 'valor da NF');
    expect(c).toMatchObject({ tipo: 'COMPLEMENTO_VALOR', ganhoId: ganho.id, valor: 450000.75, registradoPor: 'u-augusto' });
    expect(getState().ds.auditoria.length - nAud).toBe(1);
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'radar_complementar_valor_ganho', motivo: 'valor da NF' });
    expect(() => actions.complementarValorGanhoRadar(ganho.id, 1, 'de novo')).toThrow(/já foi complementado/);
    const mes = ganho.ocorridoEm.slice(0, 7);
    const ap = apurarMetaComercial({ metas: [], eventos: radar().desfechos!, mes, agora: new Date(Date.parse(ganho.ocorridoEm) + 86400000).toISOString() });
    expect(ap.ganhos.find((x) => x.id === ganho.id)?.complemento?.centavos).toBe(45000075);
  });
});

describe('E3 · livro indisponível (banco sem a 0070) e guardas de fonte', () => {
  it('código publicado / 0070 não aplicada: criar ganha, marcar como ganha (com ou sem valor) e reabrir ganha ficam bloqueados; nada muda', () => {
    const livro = radar().desfechos ?? [];
    const ganhaAntes = formulario(ativa(), 'WON', 'ganha antes do bloqueio', { valorFechado: 50 }); // ganha com o livro disponível
    try {
      (getState().ds.radar as { desfechos?: unknown }).desfechos = undefined;
      const o = ativa();
      const nAud = getState().ds.auditoria.length;
      const nHist = radar().historicoEstagios.length;
      expect(() => formulario(o, 'WON', 'assinado', { valorFechado: 10 })).toThrow(/bloqueado.*Nada foi alterado/);
      expect(() => formulario(opp(o.id), 'WON', 'assinado sem valor')).toThrow(/bloqueado/); // nem a alternativa "sem valor"
      const nova = { ...actions.novaOportunidadeRadar(empresa), titulo: 'Nasce ganha bloqueada', estagio: 'WON' as const };
      expect(() => gravarOportunidadeDoFormulario(nova, nova, 'fechado na criação', false)).toThrow(/bloqueado/);
      expect(() => formulario(opp(ganhaAntes.id), 'NEGOTIATION', 'reabrir sem livro', { proximaAcao: 'Rever', proximaAcaoEm: '2026-10-30' })).toThrow(/bloqueado/);
      expect(() => formulario(opp(ganhaAntes.id), 'LOST', 'perder sem livro')).toThrow(/bloqueado/);
      // nada mudou: estágios, histórico, auditoria e nenhuma oportunidade nova
      expect([opp(o.id).estagio, opp(ganhaAntes.id).estagio, radar().historicoEstagios.length, getState().ds.auditoria.length, radar().oportunidades.some((x) => x.titulo === 'Nasce ganha bloqueada')]).toEqual(['NEGOTIATION', 'WON', nHist, nAud, false]);
      // transições sem WON seguem normalmente
      expect(formulario(opp(o.id), 'PRICING', '', { proximaAcao: 'Precificar', proximaAcaoEm: '2026-10-28' }).estagio).toBe('PRICING');
      expect(() => actions.complementarValorGanhoRadar('x', 1, 'motivo')).toThrow(/não está disponível/);
    } finally { (getState().ds.radar as { desfechos?: unknown }).desfechos = livro; }
  });

  it('motivo para entrar/sair de WON: de 3 a 500 caracteres e NOVO (diferente do anterior), como o banco exige', () => {
    expect(motivosRecusaTransicao({ estagio: 'PRICING' }, 'WON', { motivo: 'ok' })).toEqual(['O motivo precisa ter de 3 a 500 caracteres.']);
    expect(motivosRecusaTransicao({ estagio: 'WON', motivoEstagio: 'contrato assinado' }, 'NEGOTIATION', { motivo: ' contrato assinado ' })).toEqual(['Informe o motivo desta mudança de estágio: ele é igual ao da mudança anterior.']);
    const o = ativa();
    const g = formulario(o, 'WON', 'contrato assinado', { valorFechado: 10 });
    expect(g.motivoEstagio).toBe('contrato assinado');
    expect(() => formulario(g, 'NEGOTIATION', 'contrato assinado', { proximaAcao: 'Rever', proximaAcaoEm: '2026-10-30' })).toThrow(/igual ao da mudança anterior/);
    const r = formulario(opp(o.id), 'NEGOTIATION', 'cliente pediu revisão', { proximaAcao: 'Rever', proximaAcaoEm: '2026-10-30' });
    expect(livro(o.id).map((e) => [e.tipo, e.motivo])).toEqual([['GANHO', 'contrato assinado'], ['ESTORNO_GANHO', 'cliente pediu revisão']]);
    expect(actions.salvarOportunidadeRadar({ ...r, motivoEstagio: 'reescrito fora da transição' }).motivoEstagio).toBe('cliente pediu revisão');
  });

  it('no remoto o store nunca fabrica ganho nem estorno (o gatilho do banco grava)', () => {
    const fonte = readFileSync('src/data/store.ts', 'utf8');
    expect(fonte).toMatch(/if \(state\.modo === 'remoto'\) return r\.desfechos;/);
    const persist = readFileSync('src/data/radar.supabase.ts', 'utf8');
    expect(persist).not.toMatch(/tabela: 'radar_commercial_outcome'/);
    expect(persist).toContain("h.rpc('radar_complementar_valor_ganho'");
    expect(persist.match(/'radar_commercial_outcome'/g)).toHaveLength(1); // só a leitura
  });
});

function opp(id: string) { return radar().oportunidades.find((o) => o.id === id)!; }
