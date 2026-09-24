// UX-P01/UX-P02 — Financeiro compacto: provas do piloto (rodada 2 + integracao).
//
// O vitest roda em `environment: 'node'`, sem testing-library, e so inclui `src/**/*.test.ts`: o componente React nao e
// renderizado aqui. O que o piloto DECIDE mora em `financeiroCompactoModel.ts` (puro) e e provado caso a caso contra a
// saida REAL do motor; o que so existe no JSX fica preso por guardas estaticas sobre o fonte da pasta.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saldoBancarioHoje, defasagemExtrato } from '../../core/cfo';
import { calcLancamentos, dashboard, posicaoBancaria, reservaVinculadaTotal, slaVencido } from '../../core/engine';
import { pode } from '../../core/permissoes';
import type { Dataset } from '../../core/types';
import { DATA_BASE_TESTE, EXTRATO_ATE_PADRAO, FIXTURE_GERADA_EM, PREFIXO_TESTE, ROTULO_TESTE, USUARIO_FINANCEIRO, USUARIO_OBRA, VARIANTES, datasetTeste, usuarioDaVariante, type VarianteFixture } from './financeiroCompacto.fixtures';
import { ROTULO_SEVERIDADE, ROTULO_SINCRONIZACAO, SEVERIDADE_POR_TOM, TETO_ATENCAO, TETO_SITUACAO, TEXTO_RESTRITO, TEXTO_SEM_EXTRATO, VISOES, agruparPorSeveridade, entradaDoApp, montarPiloto, tempoRelativo, type EntradaPiloto, type EstadoDoApp, type ModeloPiloto, type Visao } from './financeiroCompactoModel';

const AGORA = '2026-09-23T15:00:00.000Z';
const FONTE = { rotulo: ROTULO_TESTE, modo: 'teste' as const, atualizadoEm: FIXTURE_GERADA_EM, id: 'fixture' };
const entrada = (variante: VarianteFixture, ds = datasetTeste(variante), visao: Visao = 'executivo'): EntradaPiloto => ({ estado: 'pronto', fonte: { ...FONTE, id: variante }, ds, usuario: usuarioDaVariante(variante), agora: AGORA, visao });
const pronto = (m: ModeloPiloto) => { if (m.estado !== 'pronto') throw new Error(`esperava pronto, veio ${m.estado}`); return m; };
const soma = (vs: (number | null)[]) => vs.reduce<number>((a, v) => a + (v ?? 0), 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

function congelar<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v as object)) congelar((v as Record<string, unknown>)[k]); }
  return v;
}

describe('fixture: dados de teste identificados', () => {
  it('toda contraparte, conta, obra, empresa e usuario carrega o prefixo do piloto', () => {
    const ds = datasetTeste('padrao');
    expect(ds.params.empresa.startsWith(PREFIXO_TESTE)).toBe(true);
    expect(ds.params.responsavel).toBe(ROTULO_TESTE);
    for (const l of ds.lancamentos) { expect(l.contraparte.startsWith(PREFIXO_TESTE)).toBe(true); expect(l.descricao.startsWith(PREFIXO_TESTE)).toBe(true); }
    for (const c of ds.contas) expect(c.instituicao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const t of ds.transacoes) expect(t.historico.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.obras) { expect(o.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(o.cliente.startsWith(PREFIXO_TESTE)).toBe(true); }
    for (const a of ds.aprovacoes) expect(a.titulo.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const u of ds.usuarios) { expect(u.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(u.email.endsWith('.invalid')).toBe(true); }
  });
  it('nenhum nome real do seed sobrevive na fixture (obra, cliente, contraparte, conta)', () => {
    const texto = JSON.stringify({ ...datasetTeste('padrao'), radar: undefined, planoContas: undefined });
    for (const real of ['Smart Fit', 'Invest Market', 'OB-SF-CL-01', 'Augusto', 'César Lattes', 'NF 47']) expect(texto.includes(real)).toBe(false);
  });
  it('a data-base e fixa e o cenario padrao deixa o extrato 4 dias defasado', () => {
    const ds = datasetTeste('padrao');
    expect(ds.params.dataBase).toBe(DATA_BASE_TESTE);
    expect(ds.params.dataBaseAutomatica).toBe(false);
    const def = defasagemExtrato(ds);
    expect(def.ate).toBe(EXTRATO_ATE_PADRAO);
    expect(def.dias).toBe(4);
    expect(def.alerta).toBeTruthy();
  });
  it('cada situacao do motor aparece ao menos uma vez na variante padrao', () => {
    const sit = new Set(calcLancamentos(datasetTeste('padrao')).map((l) => l.situacao));
    for (const s of ['Atrasado', 'Próximos 7 dias', 'A vencer', 'Realizado', 'Pendente de aprovação', 'Rascunho', 'Cancelado', 'Excluído']) expect(sit.has(s as never)).toBe(true);
  });
  it('datasetTeste devolve sempre um objeto novo', () => {
    expect(datasetTeste('padrao')).not.toBe(datasetTeste('padrao'));
  });
});

describe('paridade com o motor (nenhum numero e recalculado no piloto)', () => {
  for (const v of VARIANTES.filter((x) => x.id !== 'vazio')) for (const visao of VISOES.map((x) => x.id)) {
    it(`[${v.id} · ${visao}] situacao e composicoes batem centavo a centavo com dashboard(), posicaoBancaria() e saldoBancarioHoje()`, () => {
      const ds = datasetTeste(v.id);
      const m = pronto(montarPiloto(entrada(v.id, ds, visao)));
      const d = dashboard(ds);
      const lancs = calcLancamentos(ds);
      const posicao = posicaoBancaria(ds, lancs);
      const veBancos = pode(usuarioDaVariante(v.id), 'ver_bancos');
      const item = (id: string) => m.situacao.find((s) => s.id === id);
      const parte = (id: string, prefixo: string) => item(id)?.partes.find((p) => p.rotulo.startsWith(prefixo));
      expect(m.usuario.veBancos).toBe(veBancos);
      expect(m.visao).toBe(visao);

      if (veBancos) {
        expect(item('caixa')?.valor).toBe(saldoBancarioHoje(ds, lancs));
        expect(item('caixa')?.valor).toBe(posicao.reduce((a, p) => a + p.saldoBancario, 0));
        expect(parte('caixa', 'Reserva mínima')?.valor).toBe(ds.params.reservaMinima);
        expect(parte('caixa', 'Reserva vinculada')?.valor).toBe(reservaVinculadaTotal(ds));
        const caixa = m.composicoes.caixa;
        expect(caixa.linhas.map((l) => l.valor)).toEqual(posicao.map((p) => p.saldoBancario));
        expect(caixa.linhas.map((l) => l.data)).toEqual(posicao.map((p) => p.ultimaTransacao));
        expect(caixa.total?.valor).toBe(item('caixa')?.valor);
        const proj = m.composicoes['menor-saldo'];
        expect(proj.serie?.valores).toEqual(d.fluxo13.saldoFinal);
        expect(proj.serie?.rotulos).toEqual(d.fluxo13.periodos.map((p) => p.rotulo));
        expect(proj.serie?.referencia).toBe(ds.params.reservaMinima);
        expect(Math.min(...(proj.serie?.valores ?? []))).toBe(d.menorSaldo13s);
        if (visao === 'executivo') {
          expect(item('menor-saldo')?.valor).toBe(d.menorSaldo13s);
          expect(parte('menor-saldo', 'Falta p/ reserva')?.valor).toBe(d.necessidadeMaxima);
          expect(parte('menor-saldo', 'Saldo final')?.valor).toBe(d.saldoFinal13s);
        }
      }
      expect(parte('vencido', 'A receber')?.valor).toBe(d.recebiveisVencidos);
      expect(parte('vencido', 'A pagar')?.valor).toBe(d.pagamentosVencidos);
      if (visao === 'operacional') {
        expect(parte('proximos-7', 'Entradas')?.valor).toBe(d.proximos7DiasEntradas);
        expect(parte('proximos-7', 'Saídas')?.valor).toBe(d.proximos7DiasSaidas);
        expect(parte('pendencias', 'Aprovações')?.valor).toBe(d.aprovacoesPendentes);
        expect(parte('pendencias', 'Realizados sem conciliação')?.valor).toBe(d.realizadosSemConciliacao);
        if (veBancos) expect(parte('pendencias', 'Extrato sem lançamento')?.valor).toBe(posicao.reduce((a, p) => a + p.transacoesPendentes, 0));
        else expect(parte('pendencias', 'Extrato sem lançamento')).toBeUndefined();
      }

      // composicoes de lancamentos: a soma das linhas SELECIONADAS pelo campo canonico e o agregado do motor
      const pares: [string, number][] = [['vencido-receber', d.recebiveisVencidos], ['vencido-pagar', d.pagamentosVencidos], ['proximos-7-receber', d.proximos7DiasEntradas], ['proximos-7-pagar', d.proximos7DiasSaidas]];
      for (const [id, agregado] of pares) {
        const c = m.composicoes[id];
        expect(r2(soma(c.linhas.map((l) => l.valor)))).toBe(r2(agregado));
        expect(c.total?.valor).toBe(agregado);
        for (const l of c.linhas) expect(lancs.find((x) => x.id === l.id)?.oficial).toBe(true);
      }
      expect(m.composicoes.aprovacoes.linhas).toHaveLength(d.aprovacoesPendentes);
      expect(m.composicoes.aprovacoes.linhas.filter((l) => l.tom === 'bad')).toHaveLength(ds.aprovacoes.filter((a) => slaVencido(a, AGORA)).length);
      expect(m.composicoes['sem-conciliacao'].linhas).toHaveLength(d.realizadosSemConciliacao);
      expect(m.frescor.extratoAte).toBe(defasagemExtrato(ds).ate);
      expect(m.frescor.periodo.de).toBe(d.fluxo13.periodos[0].ini);
      expect(m.frescor.periodo.ate).toBe(d.fluxo13.periodos[12].fim);
    });
  }

  it('[padrao] os numeros que a demonstracao mostra sao exatamente estes (retrato do motor sobre a fixture)', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const m = pronto(montarPiloto(entrada('padrao', ds)));
    expect(m.situacao.find((s) => s.id === 'caixa')?.valor).toBe(r2(182_400 + 36_150.5 + 76_000 - 89.9 - 15_000 + 210.35 - 4_350));
    expect(d.recebiveisVencidos).toBe(96_000 - 4_800 + 42_500);
    expect(d.pagamentosVencidos).toBe(58_300 + 31_200);
    expect(d.proximos7DiasEntradas).toBe(128_000 - 6_400);
    expect(d.proximos7DiasSaidas).toBe(74_000 + 8_900 + 11_400);
    expect(d.aprovacoesPendentes).toBe(2);
    expect(d.aprovacoesSlaVencido).toBe(1);
    expect(d.realizadosSemConciliacao).toBe(1);
    expect(d.menorSaldo13s).toBeLessThan(ds.params.reservaMinima);
    const ids = m.atencao.todas.map((a) => a.id);
    for (const id of ['extrato-defasado', 'pagamentos-vencidos', 'aprovacoes', 'caixa-reserva']) expect(ids).toContain(id);
    expect(ids).not.toContain('sla-aprovacoes');
    expect(m.atencao.todas.filter((a) => a.id === 'aprovacoes' || a.id === 'sla-aprovacoes')).toHaveLength(1);
  });

  it('as fontes de atencao coincidem com os alertas do painel e do Diretor Financeiro (mesmos campos, mesmas condicoes)', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const m = pronto(montarPiloto(entrada('padrao', ds)));
    const ids = new Set(m.atencao.todas.map((a) => a.id));
    expect(ids.has('caixa-reserva')).toBe(d.menorSaldo13s < ds.params.reservaMinima);
    expect(ids.has('pagamentos-vencidos')).toBe(d.pagamentosVencidos > 0);
    expect(ids.has('recebiveis-vencidos')).toBe(d.recebiveisVencidos > 0);
    expect(ids.has('aprovacoes')).toBe(d.aprovacoesPendentes > 0);
    expect(ids.has('sem-conciliacao')).toBe(d.realizadosSemConciliacao > 0);
    expect(ids.has('margem-negativa')).toBe(d.obrasMargemNegativa > 0);
    expect(ids.has('extrato-defasado')).toBe(!!defasagemExtrato(ds).alerta);
    for (const c of d.checks.filter((c) => c.status === 'FALHA')) expect(ids.has(`check-${c.id}`)).toBe(true);
    const pv = m.atencao.todas.find((a) => a.id === 'pagamentos-vencidos')!;
    expect(pv.valor).toBe(d.pagamentosVencidos);
    expect(pv.destino?.to).toBe('/pagar?situacao=Atrasado');
    expect(pv.impacto).toContain('89.500,00');
    const cr = m.atencao.todas.find((a) => a.id === 'caixa-reserva')!;
    expect(cr.impacto).toContain('14.679,50');
  });
});

describe('preservacao da entrada', () => {
  it('montarPiloto nao muta o dataset nem o usuario (entrada congelada e comparada antes/depois)', () => {
    const ds = congelar(datasetTeste('padrao'));
    const antes = JSON.stringify(ds);
    const e = entrada('padrao', ds);
    congelar(e);
    expect(() => montarPiloto(e)).not.toThrow();
    montarPiloto(congelar(entrada('padrao', ds, 'operacional')));
    expect(JSON.stringify(ds)).toBe(antes);
  });
  it('duas chamadas com a mesma entrada devolvem o mesmo modelo (puro e deterministico)', () => {
    const ds = datasetTeste('padrao');
    expect(JSON.stringify(montarPiloto(entrada('padrao', ds)))).toBe(JSON.stringify(montarPiloto(entrada('padrao', ds))));
  });
});

describe('ausente nunca vira zero; conceitos distintos nunca se fundem', () => {
  it('[vazio] sem conta ativa e sem lancamento oficial o estado e vazio, nao um painel de zeros', () => {
    const m = montarPiloto(entrada('vazio'));
    expect(m.estado).toBe('vazio');
    if (m.estado === 'vazio') { expect(m.motivo).toMatch(/Nenhuma conta/); expect(m.frescor.extratoAte).toBeUndefined(); expect(m.frescor.periodo.rotulo).toContain('sem projeção'); }
  });
  it('[sem-extrato] o caixa mostra a abertura com micro "sem extrato", chip de aviso e item de atencao, nunca R$ 0', () => {
    const ds = datasetTeste('sem-extrato');
    const m = pronto(montarPiloto(entrada('sem-extrato', ds)));
    const caixa = m.situacao.find((s) => s.id === 'caixa')!;
    expect(caixa.micro).toBe(TEXTO_SEM_EXTRATO);
    expect(caixa.tom).toBe('warn');
    expect(m.frescor.extratoAte).toBeUndefined();
    expect(m.frescor.diasExtrato).toBeUndefined();
    expect(m.frescor.chips.find((c) => c.id === 'extrato')).toMatchObject({ texto: 'Sem extrato', tom: 'warn' });
    expect(m.atencao.todas.some((a) => a.id === 'sem-extrato')).toBe(true);
    expect(m.atencao.todas.some((a) => a.id === 'extrato-defasado')).toBe(false);
    expect(m.composicoes.caixa.linhas.every((l) => l.data === undefined)).toBe(true);
  });
  it('[restrito] sem ver_bancos o saldo e a projecao ficam restritos (null + texto), sem partes, sem composicao, sem origem', () => {
    for (const visao of VISOES.map((v) => v.id)) {
      const m = pronto(montarPiloto(entrada('restrito', undefined, visao)));
      expect(pode(USUARIO_OBRA, 'ver_bancos')).toBe(false);
      expect(pode(USUARIO_FINANCEIRO, 'ver_bancos')).toBe(true);
      for (const s of m.situacao.filter((x) => x.id === 'caixa' || x.id === 'menor-saldo')) {
        expect(s.valor).toBeNull();
        expect(s.texto).toBe(TEXTO_RESTRITO);
        expect(s.partes).toEqual([]);
        expect(s.composicaoId).toBeUndefined();
        expect(s.origem.tela).toBeUndefined();
      }
      expect(m.composicoes.caixa).toBeUndefined();
      expect(m.composicoes['menor-saldo']).toBeUndefined();
      expect(m.atencao.todas.some((a) => a.id === 'caixa-reserva' || a.id === 'extrato-defasado' || a.id === 'extrato-sem-lancamento')).toBe(false);
      expect(m.situacao.find((x) => x.id === 'vencido')!.partes.every((p) => p.valor !== null)).toBe(true);
    }
  });
  it('vencido a receber e vencido a pagar ficam separados: nenhum valor apresentado e a soma dos dois', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    for (const visao of VISOES.map((v) => v.id)) {
      const m = pronto(montarPiloto(entrada('padrao', ds, visao)));
      const somaProibida = d.recebiveisVencidos + d.pagamentosVencidos;
      const apresentados = [...m.situacao.flatMap((s) => [s.valor, ...s.partes.map((p) => p.valor)]), ...m.atencao.todas.map((a) => a.valor ?? null)];
      expect(apresentados).not.toContain(somaProibida);
      expect(m.situacao.find((s) => s.id === 'vencido')!.valor).toBeNull();
    }
  });
  it('caixa hoje (extrato) e diferente de saldo inicial da projecao e de disponivel: campos e origens distintos', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const m = pronto(montarPiloto(entrada('padrao', ds)));
    const caixa = m.situacao.find((s) => s.id === 'caixa')!;
    expect(caixa.origem.funcao).toBe('posicaoBancaria(ds)');
    expect(caixa.valor).not.toBe(d.saldoInicial);
    expect(caixa.valor).not.toBe(d.saldoDisponivel);
  });
});

describe('ajuste conceitual: severidade sem prazo, pendencias em tres grandezas, vencidos em duas direcoes', () => {
  it('severidade e so o rotulo do tom canonico e nunca produz classificacao temporal', () => {
    expect(SEVERIDADE_POR_TOM).toEqual({ bad: 'acao', warn: 'atencao', info: 'acompanhar', ok: 'acompanhar' });
    expect(Object.values(ROTULO_SEVERIDADE)).toEqual(['Precisa de ação', 'Atenção', 'Acompanhar']);
    const temporal = /agora|hoje|amanh|semana|dia|prazo|urg|horizonte|até|em \d/i;
    for (const r of Object.values(ROTULO_SEVERIDADE)) expect(r, `rotulo temporal: ${r}`).not.toMatch(temporal);
    const m = pronto(montarPiloto(entrada('padrao')));
    for (const g of m.atencao.grupos) { expect(g.rotulo).not.toMatch(temporal); expect(g.itens.every((i) => i.severidade === g.severidade)).toBe(true); }
    for (const a of m.atencao.todas) expect(a.severidade).toBe(SEVERIDADE_POR_TOM[a.tom]);
    // o proprio tom continua sendo o do alerta canonico: pagamento vencido e bad no Painel, recebivel vencido e warn
    expect(m.atencao.todas.find((a) => a.id === 'pagamentos-vencidos')?.severidade).toBe('acao');
    expect(m.atencao.todas.find((a) => a.id === 'recebiveis-vencidos')?.severidade).toBe('atencao');
    expect(m.atencao.todas.find((a) => a.id === 'extrato-sem-lancamento')?.severidade).toBe('acompanhar');
  });
  it('pendencias operacionais continuam tres grandezas: contagens independentes, sem total', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const naoLancadas = posicaoBancaria(ds).reduce((a, p) => a + p.transacoesPendentes, 0);
    const m = pronto(montarPiloto(entrada('padrao', ds, 'operacional')));
    const t = m.situacao.find((s) => s.id === 'pendencias')!;
    expect(t.valor).toBeNull();
    expect(t.partes.map((p) => p.valor)).toEqual([d.aprovacoesPendentes, d.realizadosSemConciliacao, naoLancadas]);
    expect(t.texto).toBe(`${d.aprovacoesPendentes} aprovações · ${d.realizadosSemConciliacao} conciliação · ${naoLancadas} lançamentos`);
    const total = d.aprovacoesPendentes + d.realizadosSemConciliacao + naoLancadas;
    expect(total).toBe(6);
    expect(t.texto).not.toMatch(new RegExp(`\\b${total}\\b`));
    expect(t.texto).not.toMatch(/pendência/);
    expect([t.valor, ...t.partes.map((p) => p.valor)]).not.toContain(total);
    const r = pronto(montarPiloto(entrada('restrito', undefined, 'operacional'))).situacao.find((s) => s.id === 'pendencias')!;
    expect(r.partes).toHaveLength(2);
    expect(r.texto.split(' · ')).toHaveLength(2);
  });
  it('vencidos: um tile, duas direcoes, nunca um valor nem uma contagem fundidos', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const lancs = calcLancamentos(ds);
    const nPag = lancs.filter((l) => l.tipo === 'Saída' && l.situacao === 'Atrasado' && l.oficial && !l.direto).length;
    const nRec = lancs.filter((l) => l.tipo === 'Entrada' && l.situacao === 'Atrasado' && l.oficial && !l.direto).length;
    for (const visao of VISOES.map((v) => v.id)) {
      const t = pronto(montarPiloto(entrada('padrao', ds, visao))).situacao.find((s) => s.id === 'vencido')!;
      expect(t.valor).toBeNull();
      expect(t.partes.map((p) => [p.rotulo, p.valor])).toEqual([['A pagar', d.pagamentosVencidos], ['A receber', d.recebiveisVencidos]]);
      expect(t.texto).toBe(`${nPag} a pagar · ${nRec} a receber`);
      expect(t.texto).not.toMatch(new RegExp(`\\b${nPag + nRec}\\b`));
      expect(t.origem.campo).toBe('pagamentosVencidos · recebiveisVencidos');
    }
    const p7 = pronto(montarPiloto(entrada('padrao', ds, 'operacional'))).situacao.find((s) => s.id === 'proximos-7')!;
    expect(p7.valor).toBeNull();
    expect(p7.texto).toBe('3 saídas · 1 entrada');
    expect(p7.partes.map((p) => p.valor)).toEqual([d.proximos7DiasSaidas, d.proximos7DiasEntradas]);
  });
  it('nenhuma formula nova: o modelo nao soma campos do dashboard entre si nem contagens de direcoes distintas', () => {
    const vm = fs.readFileSync(path.resolve('src/screens/piloto/financeiroCompactoModel.ts'), 'utf8');
    for (const p of [/recebiveisVencidos\s*\+/, /\+\s*d\.pagamentosVencidos/, /aprovacoesPendentes\s*\+/, /realizadosSemConciliacao\s*\+/, /recAtras\.length\s*\+/, /rec7\.length\s*\+/, /\+\s*naoLancadas/, /totalPend/]) expect(vm, `soma proibida: ${p}`).not.toMatch(p);
    // o unico reduce numerico e a contagem de transacoes pendentes por conta (contagem, nao valor)
    const reduces = vm.match(/\.reduce\(/g) ?? [];
    expect(reduces).toHaveLength(1);
    expect(vm).toMatch(/posicao\.reduce\(\(a, p\) => a \+ p\.transacoesPendentes, 0\)/);
  });
});

describe('rodada 2: visoes, severidade, impacto e frescor (apresentacao, nunca regra)', () => {
  it('Executivo mostra 3 itens (caixa, menor saldo, vencido) e Operacional 4 (vencido, proximos 7, a destravar, caixa)', () => {
    const ex = pronto(montarPiloto(entrada('padrao', undefined, 'executivo')));
    const op = pronto(montarPiloto(entrada('padrao', undefined, 'operacional')));
    expect(ex.situacao.map((s) => s.id)).toEqual(['caixa', 'menor-saldo', 'vencido']);
    expect(op.situacao.find((s) => s.id === 'pendencias')?.rotulo).toBe('Pendências operacionais');
    expect(op.situacao.map((s) => s.id)).toEqual(['vencido', 'proximos-7', 'pendencias', 'caixa']);
    expect(ex.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.executivo);
    expect(op.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.operacional);
    // a visao nao muda nenhum numero: os mesmos campos canonicos aparecem com os mesmos valores
    const v = (m: ModeloPiloto, id: string) => (m.estado === 'pronto' ? m.situacao.find((s) => s.id === id) : undefined);
    expect(v(op, 'caixa')?.valor).toBe(v(ex, 'caixa')?.valor);
    expect(v(op, 'vencido')?.partes.map((p) => p.valor)).toEqual(v(ex, 'vencido')?.partes.map((p) => p.valor));
    expect(JSON.stringify(ex.atencao)).toBe(JSON.stringify(op.atencao));
    expect(JSON.stringify(ex.composicoes)).toBe(JSON.stringify(op.composicoes));
    expect(montarPiloto({ estado: 'pronto', fonte: FONTE, ds: datasetTeste('padrao'), usuario: USUARIO_FINANCEIRO, agora: AGORA })).toMatchObject({ visao: 'executivo' });
  });
  it('cada item de atencao responde o que aconteceu, impacto, severidade e proximo passo, e a severidade e so a leitura do tom', () => {
    const m = pronto(montarPiloto(entrada('padrao')));
    expect(m.atencao.todas.length).toBeGreaterThan(0);
    for (const a of m.atencao.todas) {
      expect(a.texto.length).toBeGreaterThan(0);
      expect(a.texto.length).toBeLessThanOrEqual(80);
      expect(a.impacto.length).toBeGreaterThan(0);
      expect(a.impacto.length).toBeLessThanOrEqual(80);
      expect(a.severidade).toBe(SEVERIDADE_POR_TOM[a.tom]);
      expect(a.destino ?? a.composicaoId).toBeTruthy();
      if (a.destino) expect(['Ver pendências', 'Ver origem', 'Ver projeção']).toContain(a.destino.rotulo);
    }
    expect(SEVERIDADE_POR_TOM).toEqual({ bad: 'acao', warn: 'atencao', info: 'acompanhar', ok: 'acompanhar' });
  });
  it('grupos por severidade: ordem precisa de acao → atencao → acompanhar, ordem de origem preservada dentro do grupo, nada perdido', () => {
    const m = pronto(montarPiloto(entrada('padrao')));
    const grupos = agruparPorSeveridade(m.atencao.todas);
    expect(grupos.map((g) => g.severidade)).toEqual(['acao', 'atencao', 'acompanhar'].filter((u) => m.atencao.todas.some((a) => a.severidade === u)));
    expect(grupos.flatMap((g) => g.itens.map((i) => i.id))).toEqual(m.atencao.todas.map((a) => a.id));
    for (const g of grupos) expect(g.rotulo).toBe(ROTULO_SEVERIDADE[g.severidade]);
    expect(m.atencao.grupos).toEqual(grupos);
    expect(m.atencao.gruposCompactos.flatMap((g) => g.itens.map((i) => i.id))).toEqual(m.atencao.compacta.map((a) => a.id));
    expect(m.atencao.compacta.length).toBeLessThanOrEqual(TETO_ATENCAO);
    expect(m.atencao.compacta.length + m.atencao.ocultas).toBe(m.atencao.todas.length);
    const ordem = { bad: 0, warn: 1, info: 2, ok: 3 };
    for (let i = 1; i < m.atencao.todas.length; i++) expect(ordem[m.atencao.todas[i].tom]).toBeGreaterThanOrEqual(ordem[m.atencao.todas[i - 1].tom]);
    expect(new Set(m.atencao.todas.map((a) => a.id)).size).toBe(m.atencao.todas.length);
  });
  it('frescor vira microinformacao: Base dd/mm, Extrato ate dd/mm · n d, Atualizado ha …', () => {
    const m = pronto(montarPiloto(entrada('padrao')));
    expect(m.frescor.chips.map((c) => c.texto)).toEqual(['Base 23/09', 'Extrato até 19/09 · 4 d', 'Atualizado há 3 h']);
    expect(m.frescor.chips.find((c) => c.id === 'extrato')?.tom).toBe('warn');
    expect(m.frescor.desatualizado).toBe(true);
    const ok = pronto(montarPiloto(entrada('atualizado')));
    expect(ok.frescor.chips.map((c) => c.texto)).toEqual(['Base 23/09', 'Extrato até 23/09', 'Atualizado há 3 h']);
    expect(ok.frescor.chips.every((c) => !c.tom)).toBe(true);
    expect(ok.frescor.desatualizado).toBe(false);
    const semAtualizacao = pronto(montarPiloto({ ...entrada('atualizado'), fonte: { rotulo: ROTULO_TESTE, modo: 'teste' } }));
    expect(semAtualizacao.frescor.chips.find((c) => c.id === 'atualizado')).toMatchObject({ texto: 'Atualização desconhecida', tom: 'warn' });
    expect(semAtualizacao.frescor.desatualizado).toBe(true);
  });
  it('tempoRelativo e puro e legivel', () => {
    expect(tempoRelativo('2026-09-23T14:59:40.000Z', AGORA)).toBe('agora');
    expect(tempoRelativo('2026-09-23T14:52:00.000Z', AGORA)).toBe('há 8 min');
    expect(tempoRelativo('2026-09-23T12:00:00.000Z', AGORA)).toBe('há 3 h');
    expect(tempoRelativo('2026-09-15T15:00:00.000Z', AGORA)).toBe('há 8 d');
    expect(tempoRelativo(undefined, AGORA)).toBe('desconhecido');
    expect(tempoRelativo('x', AGORA)).toBe('desconhecido');
  });
  it('toda composicao referenciada existe, declara origem e tem exatamente as 3 colunas renderizadas', () => {
    const m = pronto(montarPiloto(entrada('padrao', undefined, 'operacional')));
    for (const s of m.situacao) if (s.composicaoId) expect(m.composicoes[s.composicaoId]).toBeDefined();
    for (const a of m.atencao.todas) if (a.composicaoId) expect(m.composicoes[a.composicaoId]).toBeDefined();
    for (const c of Object.values(m.composicoes)) { expect(c.origem.funcao).toBeTruthy(); expect(c.colunas).toHaveLength(3); }
  });
  it('estados de carregamento e erro passam intactos pelo view-model', () => {
    expect(montarPiloto({ estado: 'carregando', fonte: FONTE })).toEqual({ estado: 'carregando', fonte: FONTE });
    expect(montarPiloto({ estado: 'erro', fonte: FONTE, mensagem: 'falhou', causa: 'teste' })).toEqual({ estado: 'erro', fonte: FONTE, mensagem: 'falhou', causa: 'teste' });
  });
});

describe('guardas estaticas: somente leitura, sem store, sem rede, sem gravacao', () => {
  const pasta = path.resolve('src/screens/piloto');
  const arquivos = fs.readdirSync(pasta).filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith('.test.ts'));
  const fonte = (f: string) => fs.readFileSync(path.join(pasta, f), 'utf8');
  const entradaHtml = fs.existsSync(path.resolve('piloto-financeiro.html')) ? fs.readFileSync(path.resolve('piloto-financeiro.html'), 'utf8') : '';

  it('os nomes da pasta nao colidem em disco sem distincao de caixa', () => {
    const bases = arquivos.map((f) => f.replace(/\.(tsx|ts|css)$/, '').toLowerCase());
    expect(new Set(bases).size).toBe(bases.length);
    expect(arquivos).toContain('financeiroCompactoModel.ts');
    expect(arquivos).not.toContain('financeiroCompacto.ts');
  });
  it('a pasta do piloto nunca importa store, supabase, offline, telemetria ou funcoes server-side', () => {
    const proibidos = [/data\/store/, /data\/supabase/, /data\/offline/, /data\/telemetria/, /data\/statusRemoto/, /data\/rede/, /@supabase/, /netlify\//, /ui\/Tabela/];
    for (const f of arquivos) for (const p of proibidos) expect(fonte(f), `${f} importa ${p}`).not.toMatch(p);
  });
  it('nenhum arquivo do piloto usa fetch, XMLHttpRequest, WebSocket, service worker, localStorage, sessionStorage ou IndexedDB', () => {
    const proibidos = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /serviceWorker/, /localStorage/, /sessionStorage/, /indexedDB/, /navigator\.sendBeacon/];
    for (const f of arquivos) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
    for (const p of proibidos) expect(entradaHtml).not.toMatch(p);
  });
  it('o view-model so importa funcoes canonicas de leitura (lista fechada) e nunca recalcula fluxo, aging ou DRE', () => {
    const vm = fonte('financeiroCompactoModel.ts');
    const importEngine = vm.match(/import \{([^}]+)\} from '\.\.\/\.\.\/core\/engine'/)?.[1] ?? '';
    const nomes = importEngine.split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean);
    const permitidos = new Set(['calcLancamentos', 'dashboard', 'fmtBr', 'posicaoBancaria', 'reservaVinculadaTotal', 'slaVencido', 'Dashboard', 'LancamentoCalc', 'PosicaoConta']);
    for (const n of nomes) expect(permitidos.has(n), `import nao permitido no view-model: ${n}`).toBe(true);
    for (const p of [/fluxo13Semanas\(/, /fluxo24Meses\(/, /dreGerencial\(/, /aging\(/, /obra360\(/, /carteiraObras\(/, /calcLancamento\(/, /executarChecks\(/, /projecaoDiaria\(/, /analisarPagamento\(/]) expect(vm).not.toMatch(p);
  });
  it('a tela e a entrada nunca chamam actions, persistir, salvar, registrar ou navegar do app, e so oferecem acoes de leitura', () => {
    for (const f of arquivos.filter((x) => x.endsWith('.tsx'))) {
      const s = fonte(f);
      for (const p of [/\bactions\./, /persistir/, /salvar[A-Z]/, /registrar[A-Z]/, /useStore/, /inicializar\(/, /navegar\(/]) expect(s, `${f} usa ${p}`).not.toMatch(p);
      for (const p of [/\bPagar\b/, /\bConciliar\b/, /\bAprovar\b/, /\bLiquidar\b/]) expect(s, `${f} simula acao operacional ${p}`).not.toMatch(p);
    }
  });
  it('estilos do piloto ficam sob o prefixo .piloto-fin (nenhum seletor global)', () => {
    const css = fonte('piloto.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = css.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean).filter((s) => !s.startsWith('@'));
    for (const sel of seletores) for (const parte of sel.split(',')) expect(parte.trim(), `seletor fora do prefixo: ${parte}`).toMatch(/^(\.piloto-fin|\[data-theme="light"\] \.piloto-fin|@media)/);
  });
  it('UX-P02: a marca de dados de teste saiu do runtime — tela e modelo nao importam a fixture nem citam o rotulo', () => {
    for (const f of ['FinanceiroCompacto.tsx', 'financeiroCompactoModel.ts', 'piloto.css']) {
      expect(fonte(f)).not.toMatch(/financeiroCompacto\.fixtures/);
      expect(fonte(f)).not.toMatch(/DADOS DE TESTE|ROTULO_TESTE|datasetTeste/);
    }
    // a fixture continua existindo, so para os testes
    expect(arquivos).toContain('financeiroCompacto.fixtures.ts');
    expect(fs.readFileSync(path.join(pasta, 'financeiroCompacto.fixtures.ts'), 'utf8')).toMatch(/PILOTO · DADOS DE TESTE/);
  });
  it('UX-P02: os arquivos de isolamento foram removidos e o App liga o piloto so por lazy + case, sem sidebar, paleta ou tour', () => {
    expect(arquivos).not.toContain('main.tsx');
    expect(fs.existsSync(path.resolve('piloto-financeiro.html'))).toBe(false);
    const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
    // UX-P04: o App liga DOIS pilotos experimentais somente leitura pelo mesmo padrao (Financeiro compacto, UX-P02, e Obras
    // compacto, UX-P04). Em vez de contar linhas, a guarda prende a lista exata das integracoes esperadas: toda linha nao
    // comentada de App.tsx que cite "piloto" tem de ser uma destas, e cada uma tem de existir exatamente uma vez.
    const INTEGRACOES_ESPERADAS: Array<[string, RegExp]> = [
      ['import do adaptador do Financeiro compacto', /^import \{ entradaDoApp \} from '\.\/screens\/piloto\/financeiroCompactoModel';$/],
      ['import do adaptador do Obras compacto (UX-P04)', /^import \{ entradaDoApp as entradaObrasDoApp \} from '\.\/screens\/piloto\/obrasCompactoModel';$/],
      ['lazy do Financeiro compacto', /^const FinanceiroCompacto = lazy\(\(\) => import\('\.\/screens\/piloto\/FinanceiroCompacto'\)\);$/],
      ['lazy do Obras compacto (UX-P04)', /^const ObrasCompacto = lazy\(\(\) => import\('\.\/screens\/piloto\/ObrasCompacto'\)\);$/],
      ['case da rota #/piloto (financeiro primeiro)', /^ {4}case 'piloto': tela = p1 === 'financeiro' \? <FinanceiroCompacto entrada=\{entradaDoApp\(/],
    ];
    const linhas = app.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => /piloto/i.test(l) && !/^\s*\/\//.test(l));
    expect(linhas).toHaveLength(INTEGRACOES_ESPERADAS.length); // 5: dois imports de adaptador, dois lazy e o case da rota
    for (const l of linhas) expect(INTEGRACOES_ESPERADAS.filter(([, re]) => re.test(l)), `linha inesperada com "piloto" em App.tsx: ${l.trim()}`).toHaveLength(1);
    for (const [nome, re] of INTEGRACOES_ESPERADAS) expect(linhas.filter((l) => re.test(l)), nome).toHaveLength(1);
    // nada de fixture no runtime, nem entrada de menu/paleta: a rota existe so pelo case
    expect(app).not.toMatch(/fixtures|piloto-obra|piloto-fin|DADOS DE TESTE/);
    expect(app).not.toMatch(/ROTAS_NAV[^\n]*piloto|piloto[^\n]*ROTAS_NAV/);
    expect(app).toMatch(/const FinanceiroCompacto = lazy\(\(\) => import\('\.\/screens\/piloto\/FinanceiroCompacto'\)\);/);
    expect(app).toMatch(/import \{ entradaDoApp \} from '\.\/screens\/piloto\/financeiroCompactoModel';/);
    const caso = app.slice(app.indexOf("case 'piloto':"), app.indexOf('break;', app.indexOf("case 'piloto':")));
    expect(caso).toMatch(/p1 === 'financeiro'/);
    expect(caso).toMatch(/entradaDoApp\(\{ ds, usuario, modo, carregando, erroInicial, sync, agora: new Date\(\)\.toISOString\(\) \}\)/);
    expect(caso).toMatch(/Página não encontrada/);
    for (const f of ['src/ui/Paleta.tsx', 'src/ui/Tour.tsx', 'src/ui/Sugestoes.tsx', 'src/core/permissoes.ts', 'src/data/store.ts', 'src/core/engine.ts']) expect(fs.readFileSync(path.resolve(f), 'utf8'), `${f} referencia o piloto`).not.toMatch(/piloto\/financeiro|FinanceiroCompacto|financeiroCompacto|piloto\/obras|ObrasCompacto|obrasCompacto/);
  });
});

describe('UX-P02: adaptador entradaDoApp (leitura do que o App ja carregou; sync e frescor separados)', () => {
  const base = (extra: Partial<EstadoDoApp> = {}): EstadoDoApp => ({ ds: datasetTeste('padrao'), usuario: USUARIO_FINANCEIRO, modo: 'remoto', carregando: false, erroInicial: undefined, sync: { status: 'ok', em: '2026-09-23T14:00:00.000Z' }, agora: AGORA, ...extra });
  it('carregando e erroInicial viram os estados correspondentes; pronto carrega ds, usuario, agora e visao sem copiar nem alterar', () => {
    expect(entradaDoApp(base({ carregando: true }))).toMatchObject({ estado: 'carregando', fonte: { modo: 'remoto', rotulo: 'Supabase' } });
    expect(entradaDoApp(base({ erroInicial: 'sem rede' }))).toMatchObject({ estado: 'erro', mensagem: 'sem rede' });
    const e = base({ visao: 'operacional' });
    const r = entradaDoApp(e);
    expect(r.estado).toBe('pronto');
    if (r.estado === 'pronto') { expect(r.ds).toBe(e.ds); expect(r.usuario).toBe(e.usuario); expect(r.agora).toBe(AGORA); expect(r.visao).toBe('operacional'); }
  });
  it('remoto: fonte Supabase com atualizadoEm = sync.em; sincronizacao espelha o status 1:1 (ok, enviando, pendente, erro)', () => {
    for (const [status, estado] of [['ok', 'sincronizado'], ['enviando', 'enviando'], ['pendente', 'pendente'], ['erro', 'erro']] as const) {
      const r = entradaDoApp(base({ sync: { status, em: '2026-09-23T14:00:00.000Z', desde: '2026-09-23T13:00:00.000Z', msg: 'x' } }));
      expect(r.fonte).toMatchObject({ rotulo: 'Supabase', modo: 'remoto', atualizadoEm: '2026-09-23T14:00:00.000Z', sincronizacao: { estado, em: '2026-09-23T14:00:00.000Z', desde: '2026-09-23T13:00:00.000Z', msg: 'x' } });
      expect(ROTULO_SINCRONIZACAO[estado]).toBeTruthy();
    }
  });
  it('sync pendente/erro NAO vira "dados desatualizados": o frescor e identico ao do sync ok', () => {
    const ds = datasetTeste('atualizado');
    const ok = pronto(montarPiloto(entradaDoApp(base({ ds, sync: { status: 'ok', em: '2026-09-23T14:00:00.000Z' } }))));
    const pend = pronto(montarPiloto(entradaDoApp(base({ ds, sync: { status: 'pendente', em: '2026-09-23T14:00:00.000Z', desde: '2026-09-23T13:00:00.000Z' } }))));
    const erro = pronto(montarPiloto(entradaDoApp(base({ ds, sync: { status: 'erro', em: '2026-09-23T14:00:00.000Z', msg: 'falhou' } }))));
    expect(JSON.stringify(pend.frescor)).toBe(JSON.stringify(ok.frescor));
    expect(JSON.stringify(erro.frescor)).toBe(JSON.stringify(ok.frescor));
    expect(ok.frescor.desatualizado).toBe(false);
    expect(pend.fonte.sincronizacao?.estado).toBe('pendente');
    expect(erro.fonte.sincronizacao?.estado).toBe('erro');
    expect(ok.frescor.chips.map((c) => c.id)).toEqual(['base', 'extrato', 'atualizado']);
    expect(ok.frescor.chips.find((c) => c.id === 'atualizado')?.texto).toBe('Atualizado há 1 h');
  });
  it('modo local: fonte "Modo local · seed", sincronizacao local, sem chip de aviso de atualizacao e sem marca de teste', () => {
    const r = entradaDoApp(base({ modo: 'local', sync: { status: 'local' } }));
    expect(r.fonte).toEqual({ rotulo: 'Modo local · seed', modo: 'local', sincronizacao: { estado: 'local' } });
    const m = pronto(montarPiloto(r));
    expect(m.fonte.modo).toBe('local');
    expect(m.frescor.chips.find((c) => c.id === 'atualizado')).toMatchObject({ texto: 'Seed local' });
    expect(m.frescor.chips.find((c) => c.id === 'atualizado')?.tom).toBeUndefined();
    expect(m.frescor.motivos.some((x) => /desconhecido/.test(x))).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/DADOS DE TESTE/);
  });
  it('paridade e permissao continuam as mesmas pelo adaptador: o modelo e identico ao montado pela entrada direta', () => {
    for (const variante of ['padrao', 'restrito'] as const) {
      const ds = datasetTeste(variante);
      const viaApp = montarPiloto(entradaDoApp({ ds, usuario: usuarioDaVariante(variante), modo: 'remoto', carregando: false, sync: { status: 'ok', em: FIXTURE_GERADA_EM }, agora: AGORA }));
      const direta = montarPiloto({ estado: 'pronto', fonte: { rotulo: 'Supabase', modo: 'remoto', atualizadoEm: FIXTURE_GERADA_EM, sincronizacao: { estado: 'sincronizado', em: FIXTURE_GERADA_EM } }, ds, usuario: usuarioDaVariante(variante), agora: AGORA });
      expect(JSON.stringify(viaApp)).toBe(JSON.stringify(direta));
      if (viaApp.estado === 'pronto') expect(viaApp.usuario.veBancos).toBe(pode(usuarioDaVariante(variante), 'ver_bancos'));
    }
  });
  it('o adaptador nao muta o estado recebido', () => {
    const e = congelar(base());
    expect(() => entradaDoApp(e)).not.toThrow();
  });
});

// tipagem: garante que EntradaPiloto aceita um Dataset real do seed sem adaptacao (integracao futura)
export const _tipagem = (ds: Dataset): EntradaPiloto => ({ estado: 'pronto', fonte: FONTE, ds, usuario: USUARIO_FINANCEIRO, agora: AGORA });
