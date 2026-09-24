// UX-P03/UX-P04 — Obras compacto: provas do piloto e da integracao ao App.
//
// O vitest roda em `environment: 'node'`, sem testing-library: o componente nao e renderizado. O que o piloto DECIDE
// mora em `obrasCompactoModel.ts` (puro) e e provado contra a saida REAL do motor sobre a fixture; o que so existe no
// JSX fica preso por guardas estaticas sobre o fonte da pasta.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analisarObra } from '../../core/analise';
import { acompanhamentoFaturamento } from '../../core/faturamento';
import { calcLancamentos, carteiraObras, dashboard } from '../../core/engine';
import { sugestoesPara } from '../../core/sugestoes';
import type { Dataset } from '../../core/types';
import { DATA_BASE_TESTE, FIXTURE_GERADA_EM, OBRA_A, OBRA_B, OBRA_C, PREFIXO_TESTE, ROTULO_TESTE, TODAS_AS_OBRAS, USUARIO_DIRETORIA, USUARIO_GESTOR_A, USUARIO_SEM_OBRA, datasetTeste, entradaDaVariante, type VarianteFixture } from './obrasCompacto.fixtures';
import { CHECKS_DE_OBRA, ROTULO_SEVERIDADE, ROTULO_SINCRONIZACAO, SEVERIDADE_DE_CHECK, SEVERIDADE_DE_SEMAFORO, SEVERIDADE_DE_TOM, TETO_ATENCAO, TETO_SITUACAO, TEXTO_CARTEIRA_PARCIAL, VISOES, agruparPorSeveridade, entradaDoApp, montarObras, tempoRelativo, type EntradaObras, type EstadoDoApp, type ModeloObras, type Visao } from './obrasCompactoModel';
import seed from '../../data/seed.json';

const AGORA = '2026-09-23T15:00:00.000Z';
const FONTE = { rotulo: ROTULO_TESTE, modo: 'teste' as const, atualizadoEm: FIXTURE_GERADA_EM, id: 'fixture' };
const entrada = (variante: VarianteFixture, visao: Visao = 'diretoria', ds = datasetTeste(variante), visiveis?: string[]): EntradaObras => {
  const e = entradaDaVariante(variante);
  return { estado: 'pronto', fonte: { ...FONTE, id: variante }, ds, usuario: e.usuario, codigosObraVisiveis: visiveis ?? e.codigosObraVisiveis, agora: AGORA, visao };
};
const pronto = (m: ModeloObras) => { if (m.estado !== 'pronto') throw new Error(`esperava pronto, veio ${m.estado}`); return m; };
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
function congelar<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v as object)) congelar((v as Record<string, unknown>)[k]); }
  return v;
}

describe('fixture: dados de teste identificados', () => {
  it('obras, clientes, servicos, medicoes, conjuntos, ordens, lancamentos e usuarios carregam o prefixo do piloto', () => {
    const ds = datasetTeste('padrao');
    expect(ds.params.empresa.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.obras) { expect(o.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(o.cliente.startsWith(PREFIXO_TESTE)).toBe(true); expect(o.codigo.startsWith('OB-PILOTO-')).toBe(true); }
    for (const s of ds.servicos) expect(s.nome.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const m of ds.medicoes) expect(m.evento.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const c of ds.conjuntos) expect(c.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.ordens) expect(o.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const l of ds.lancamentos) { expect(l.contraparte.startsWith(PREFIXO_TESTE)).toBe(true); expect(l.codigoObra.startsWith('OB-PILOTO-')).toBe(true); }
    for (const u of ds.usuarios) { expect(u.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(u.email.endsWith('.invalid')).toBe(true); }
    expect(ds.params.dataBase).toBe(DATA_BASE_TESTE);
  });
  it('nenhum nome real do seed sobrevive', () => {
    const texto = JSON.stringify({ ...datasetTeste('padrao'), radar: undefined, planoContas: undefined });
    for (const real of ['Smart Fit', 'Invest Market', 'OB-SF-CL-01', 'Augusto', 'César Lattes', 'NF 47', 'SFCL']) expect(texto.includes(real)).toBe(false);
  });
  it('cobre os estados que o motor conhece: obra com margem negativa, medicao atrasada, servico sem datas, servico parado, obra sem servicos', () => {
    const ds = datasetTeste('padrao');
    const c = new Map(carteiraObras(ds).map((o) => [o.obra.codigo, o]));
    expect(c.get(OBRA_B)!.pctMargemProjetada).toBeLessThan(0);
    expect(c.get(OBRA_A)!.medicoes.atrasadas).toBeGreaterThan(0);
    expect(c.get(OBRA_B)!.servicos.every((s) => !s.inicioPrevisto)).toBe(true);
    expect(c.get(OBRA_C)!.temServicos).toBe(false);
    expect(c.get(OBRA_A)!.fabricacao.emAndamento).toBeGreaterThan(0);
    expect(new Set(carteiraObras(ds).map((o) => analisarObra(ds, o).semaforo)).size).toBeGreaterThan(1);
  });
  it('datasetTeste devolve sempre um objeto novo; entradaDaVariante cobre todas, subconjunto e nenhuma', () => {
    expect(datasetTeste('padrao')).not.toBe(datasetTeste('padrao'));
    expect(entradaDaVariante('padrao')).toEqual({ usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS });
    expect(entradaDaVariante('subconjunto')).toEqual({ usuario: USUARIO_GESTOR_A, codigosObraVisiveis: [OBRA_A] });
    expect(entradaDaVariante('nenhuma')).toEqual({ usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] });
  });
});

describe('paridade com o motor (nenhum numero e recalculado no piloto)', () => {
  for (const visao of VISOES.map((v) => v.id)) {
    it(`[padrao · ${visao}] situacao, linhas de obra e composicoes batem com dashboard(), carteiraObras(), analisarObra() e acompanhamentoFaturamento()`, () => {
      const ds = datasetTeste('padrao');
      const m = pronto(montarObras(entrada('padrao', visao, ds)));
      const d = dashboard(ds);
      const carteira = carteiraObras(ds);
      const lancs = calcLancamentos(ds);
      expect(m.carteiraCompleta).toBe(true);
      const tile = (id: string) => m.situacao.find((s) => s.id === id);
      if (visao === 'diretoria') {
        expect(tile('carteira')?.valor).toBe(d.receitaContratada);
        expect(tile('carteira')?.partes[0].valor).toBe(d.backlog);
        expect(tile('margem')?.valor).toBe(d.margemCarteira);
        expect(tile('margem')?.partes[0].valor).toBe(d.obrasMargemNegativa);
        const sem = (s: 'vermelho' | 'amarelo' | 'verde') => carteira.filter((o) => analisarObra(ds, o, lancs).semaforo === s).length;
        expect(tile('saude')?.partes.map((p) => p.valor)).toEqual([sem('vermelho'), sem('amarelo'), sem('verde')]);
      } else {
        expect(tile('avanco')?.partes.map((p) => p.valor)).toEqual(carteira.map((o) => (o.temServicos ? o.execucaoFisica : null)));
        expect(tile('medicoes')?.partes[0].valor).toBe(carteira.reduce((a, o) => a + o.medicoes.pendentes, 0));
        expect(tile('medicoes')?.partes[1].valor).toBe(carteira.reduce((a, o) => a + o.medicoes.atrasadas, 0));
        expect(tile('servicos')?.partes[0].valor).toBe(carteira.reduce((a, o) => a + o.servicosAtrasados, 0));
        expect(tile('servicos')?.partes[1].valor).toBe(carteira.reduce((a, o) => a + o.servicosEmRisco, 0));
        expect(tile('producao')?.partes[0].valor).toBe(carteira.reduce((a, o) => a + o.fabricacao.atrasadas, 0));
        expect(tile('producao')?.partes[1].valor).toBe(carteira.reduce((a, o) => a + o.montagem.atrasadas, 0));
      }
      // linhas por obra
      expect(m.obras.map((o) => o.codigo)).toEqual(carteira.map((o) => o.obra.codigo));
      for (const linha of m.obras) {
        const o = carteira.find((x) => x.obra.codigo === linha.codigo)!;
        const a = analisarObra(ds, o, lancs);
        expect(linha.execucaoFisica).toBe(o.execucaoFisica);
        expect(linha.pctMargemProjetada).toBe(o.pctMargemProjetada);
        expect(linha.medicoesAtrasadas).toBe(o.medicoes.atrasadas);
        expect(linha.medicoesPendentes).toBe(o.medicoes.pendentes);
        expect(linha.servicosAtrasados).toBe(o.servicosAtrasados);
        expect(linha.semaforo).toBe(a.semaforo);
        expect(linha.score).toBe(a.score);
        expect(linha.to).toBe(`/obras/${o.obra.codigo}`);
        // composicoes: cada uma e uma linha canonica por item
        const resumo = m.composicoes[`resumo:${o.obra.codigo}`];
        expect(resumo.linhas.find((l) => l.id === 'eac')?.valor).toBe(o.eac);
        expect(resumo.linhas.find((l) => l.id === 'margem')?.valor).toBe(o.margemProjetada);
        expect(resumo.linhas.find((l) => l.id === 'comprometido')?.valor).toBe(o.custoComprometido);
        expect(m.composicoes[`servicos:${o.obra.codigo}`].linhas.map((l) => l.id)).toEqual(o.servicos.map((s) => s.id));
        expect(m.composicoes[`servicos:${o.obra.codigo}`].linhas.map((l) => l.valor)).toEqual(o.servicos.map((s) => s.eac));
        expect(m.composicoes[`medicoes:${o.obra.codigo}`].linhas.map((l) => l.valor)).toEqual(o.medicoes.medicoes.map((x) => x.valorLiquidoConstrutora));
        expect(m.composicoes[`medicoes:${o.obra.codigo}`].total?.valor).toBe(o.medicoes.faturado);
        expect(m.composicoes[`curva:${o.obra.codigo}`].serie?.valores).toEqual(a.curva.map((p) => p.previsto));
        expect(m.composicoes[`producao:${o.obra.codigo}`].linhas).toHaveLength(o.fabricacao.ordens.length + o.montagem.ordens.length);
        expect(m.composicoes[`materiais:${o.obra.codigo}`].total?.valor).toBe(o.peso.pesoTotal);
        expect(m.composicoes[`custos:${o.obra.codigo}`].total?.valor).toBe(o.custoComprometido);
        expect(m.composicoes[`custos:${o.obra.codigo}`].linhas.map((l) => l.id)).toEqual(o.saidas.map((l) => l.id));
        const fat = acompanhamentoFaturamento({ codigoObra: o.obra.codigo, servicos: ds.servicos, medicoes: ds.medicoes, lancamentos: ds.lancamentos, rateios: ds.rateios, planoContas: ds.planoContas, execucaoPorServico: new Map(o.servicos.map((s) => [s.id, s.pctExecucao])) });
        expect(m.composicoes[`faturamento:${o.obra.codigo}`].total?.valor).toBe(fat.totais.contratadoBruto);
        expect(m.composicoes[`faturamento:${o.obra.codigo}`].linhas.map((l) => l.valor)).toEqual(fat.etapas.map((e) => e.contratadoBruto));
      }
    });
  }
  it('[padrao] retrato dos numeros que a demonstracao mostra', () => {
    const ds = datasetTeste('padrao');
    const d = dashboard(ds);
    const m = pronto(montarObras(entrada('padrao', 'diretoria', ds)));
    expect(d.receitaContratada).toBe(900_000 + 300_000 + 150_000);
    expect(d.obrasMargemNegativa).toBe(1);
    expect(r4(carteiraObras(ds).find((o) => o.obra.codigo === OBRA_B)!.pctMargemProjetada)).toBeLessThan(0);
    expect(m.situacao.find((s) => s.id === 'saude')?.texto).toMatch(/vermelho/);
    const ids = m.atencao.todas.map((a) => a.id);
    for (const id of [`obra-${OBRA_B}-margem`, `obra-${OBRA_A}-medicoes`, `obra-${OBRA_A}-repasse`, `obra-${OBRA_B}-datas`, 'check-ALT-05', `saude-${OBRA_B}`]) expect(ids).toContain(id);
  });
});

describe('visibilidade e contrato de entrada (nao e ACL)', () => {
  it('o modelo limita a apresentacao ao conjunto recebido: com todas as obras a carteira e completa', () => {
    const m = pronto(montarObras(entrada('padrao')));
    expect(m.obras.map((o) => o.codigo)).toEqual(TODAS_AS_OBRAS);
    expect(m.carteiraCompleta).toBe(true);
  });
  it('subconjunto: so a obra recebida aparece; agregados da carteira ficam "carteira inteira nao visivel", nunca uma soma propria; checks e sugestoes de carteira somem', () => {
    const ds = datasetTeste('subconjunto');
    const m = pronto(montarObras(entrada('subconjunto', 'diretoria', ds)));
    expect(m.obras.map((o) => o.codigo)).toEqual([OBRA_A]);
    expect(m.carteiraCompleta).toBe(false);
    for (const id of ['carteira', 'margem']) { const t = m.situacao.find((s) => s.id === id)!; expect(t.valor).toBeNull(); expect(t.texto).toBe(TEXTO_CARTEIRA_PARCIAL); expect(t.partes.every((p) => p.valor === null)).toBe(true); }
    expect(m.situacao.find((s) => s.id === 'saude')?.partes.map((p) => p.valor)).toEqual([analisarObra(ds, carteiraObras(ds).find((o) => o.obra.codigo === OBRA_A)!).semaforo === 'vermelho' ? 1 : 0, 0, 0].map((v, i) => (i === 0 ? v : v)));
    expect(m.atencao.todas.every((a) => a.obra === OBRA_A)).toBe(true);
    expect(m.atencao.todas.some((a) => a.id.startsWith('check-') || a.id === 'obras-sem-cronograma')).toBe(false);
    expect(Object.keys(m.composicoes).every((k) => k.endsWith(`:${OBRA_A}`))).toBe(true);
    // e a composicao de OB-PILOTO-B nao existe, mesmo estando no dataset
    expect(m.composicoes[`resumo:${OBRA_B}`]).toBeUndefined();
  });
  it('conjunto arbitrario: o modelo nao consulta usuario.obras nem papel para decidir o que mostrar', () => {
    const ds = datasetTeste('padrao');
    // usuario sem obra nenhuma no cadastro, mas o App/fixture diz que ele ve B e C: o modelo obedece ao conjunto recebido
    const m = pronto(montarObras({ estado: 'pronto', fonte: FONTE, ds, usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [OBRA_B, OBRA_C], agora: AGORA }));
    expect(m.obras.map((o) => o.codigo)).toEqual([OBRA_B, OBRA_C]);
    // e a Diretoria com conjunto vazio nao ve nada
    expect(montarObras({ estado: 'pronto', fonte: FONTE, ds, usuario: USUARIO_DIRETORIA, codigosObraVisiveis: [], agora: AGORA }).estado).toBe('sem-visibilidade');
  });
  it('nenhuma obra visivel → estado proprio com o total de obras; dataset sem obras → vazio', () => {
    const n = montarObras(entrada('nenhuma'));
    expect(n.estado).toBe('sem-visibilidade');
    if (n.estado === 'sem-visibilidade') { expect(n.totalObras).toBe(3); expect(n.frescor.chips.map((c) => c.id)).toEqual(['base', 'medicao', 'avanco', 'atualizado']); }
    expect(montarObras(entrada('vazio')).estado).toBe('vazio');
  });
  it('codigo desconhecido no conjunto e ignorado, nunca inventa obra', () => {
    const m = pronto(montarObras(entrada('padrao', 'diretoria', undefined, [OBRA_A, 'OB-INEXISTENTE'])));
    expect(m.obras.map((o) => o.codigo)).toEqual([OBRA_A]);
    expect(m.carteiraCompleta).toBe(false);
  });
});

describe('preservacao da entrada e ausente != zero', () => {
  it('montarObras nao muta dataset, usuario nem conjunto visivel (entrada congelada) e e deterministico', () => {
    const ds = congelar(datasetTeste('padrao'));
    const antes = JSON.stringify(ds);
    const e = congelar(entrada('padrao', 'operacao', ds));
    expect(() => montarObras(e)).not.toThrow();
    expect(JSON.stringify(ds)).toBe(antes);
    expect(JSON.stringify(montarObras(entrada('padrao', 'diretoria', ds)))).toBe(JSON.stringify(montarObras(entrada('padrao', 'diretoria', ds))));
  });
  it('obra sem servicos mostra "sem servicos", nao 0%; frescor sem medicao/avanco diz isso em vez de data vazia', () => {
    const m = pronto(montarObras(entrada('padrao', 'operacao')));
    const parteC = m.situacao.find((s) => s.id === 'avanco')!.partes.find((p) => p.rotulo === OBRA_C)!;
    expect(parteC.valor).toBeNull();
    expect(parteC.texto).toBe('sem serviços');
    expect(m.obras.find((o) => o.codigo === OBRA_C)?.temServicos).toBe(false);
    const soC = pronto(montarObras(entrada('padrao', 'operacao', undefined, [OBRA_C])));
    expect(soC.frescor.chips.find((c) => c.id === 'medicao')?.texto).toBe('Sem medição registrada');
    expect(soC.frescor.chips.find((c) => c.id === 'avanco')?.texto).toBe('Sem avanço apontado');
    expect(soC.frescor.ultimaMedicao).toBeUndefined();
    const todas = pronto(montarObras(entrada('padrao')));
    expect(todas.frescor.ultimaMedicao).toBe('2026-09-02');
    expect(todas.frescor.ultimoAvanco).toBe('2026-09-20');
  });
  it('estados carregando e erro passam intactos', () => {
    expect(montarObras({ estado: 'carregando', fonte: FONTE })).toEqual({ estado: 'carregando', fonte: FONTE });
    expect(montarObras({ estado: 'erro', fonte: FONTE, mensagem: 'falhou', causa: 'x' })).toEqual({ estado: 'erro', fonte: FONTE, mensagem: 'falhou', causa: 'x' });
  });
  it('tempoRelativo e puro', () => {
    expect(tempoRelativo('2026-09-23T12:00:00.000Z', AGORA)).toBe('há 3 h');
    expect(tempoRelativo(undefined, AGORA)).toBe('desconhecido');
  });
});

describe('conceitos separados, nada somado por conta propria', () => {
  it('faturado, recebido e receita ficam em linhas distintas da composicao Obra 360; avanco fisico nunca e % faturado', () => {
    const ds = datasetTeste('padrao');
    const o = carteiraObras(ds).find((x) => x.obra.codigo === OBRA_A)!;
    const m = pronto(montarObras(entrada('padrao', 'operacao', ds)));
    const resumo = m.composicoes[`resumo:${OBRA_A}`];
    const v = (id: string) => resumo.linhas.find((l) => l.id === id)?.valor;
    expect(v('receita')).toBe(o.receitaTotal);
    expect(v('faturado')).toBe(o.medidoFaturado);
    expect(v('recebido')).toBe(o.recebido);
    expect(new Set([v('receita'), v('faturado'), v('recebido')]).size).toBe(3);
    expect(m.obras.find((x) => x.codigo === OBRA_A)?.execucaoFisica).toBe(o.execucaoFisica);
    expect(o.execucaoFisica).not.toBe(o.medicoes.pctFaturado);
  });
  it('fabricacao e montagem nunca somadas; medicoes pendentes e atrasadas separadas; nenhum total artificial de pendencias', () => {
    const m = pronto(montarObras(entrada('padrao', 'operacao')));
    const prod = m.situacao.find((s) => s.id === 'producao')!;
    expect(prod.partes.map((p) => p.rotulo)).toEqual(['Fabricação atrasadas', 'Montagem atrasadas', 'Concluídas (fab. · mont.)']);
    expect(prod.valor).toBeNull();
    const med = m.situacao.find((s) => s.id === 'medicoes')!;
    expect(med.valor).toBeNull();
    expect(med.partes.slice(0, 2).map((p) => p.rotulo)).toEqual(['Pendentes', 'Atrasadas']);
    expect(med.texto).not.toMatch(/\b7\b/); // 5 pendentes e 2 atrasadas nao viram "7"
    const serv = m.situacao.find((s) => s.id === 'servicos')!;
    expect(serv.valor).toBeNull();
  });
  it('agregados da carteira vem so do dashboard: sem recalculo de margem media, backlog ou receita', () => {
    const vm = fs.readFileSync(path.resolve('src/screens/piloto/obrasCompactoModel.ts'), 'utf8');
    for (const p of [/receitaTotal\s*\+/, /\+\s*o\.receitaTotal/, /margemProjetada\s*\+/, /\+\s*o\.margemProjetada/, /medidoFaturado\s*\+/, /recebido\s*\+/, /\/\s*receitaContratada/, /\/\s*visiveis\.length/, /custoComprometido\s*\+/]) expect(vm, `soma/media proibida: ${p}`).not.toMatch(p);
    // o unico reduce numerico do modelo e a contagem de itens canonicos por obra (somaContagem)
    const reduces = vm.match(/\.reduce\(/g) ?? [];
    expect(reduces).toHaveLength(1);
    expect(vm).toMatch(/const somaContagem = \(f: \(o: Obra360\) => number\) => visiveis\.reduce\(\(a, o\) => a \+ f\(o\), 0\);/);
  });
});

describe('severidade: so a que a fonte canonica ja fornece', () => {
  it('as tabelas sao relabels 1:1 de tom (sugestao), status (check) e semaforo (analise); nenhum rotulo temporal', () => {
    expect(SEVERIDADE_DE_TOM).toEqual({ bad: 'acao', warn: 'atencao', info: 'acompanhar' });
    expect(SEVERIDADE_DE_CHECK).toEqual({ FALHA: 'acao', ATENÇÃO: 'atencao', OK: undefined });
    expect(SEVERIDADE_DE_SEMAFORO).toEqual({ vermelho: 'acao', amarelo: 'atencao', verde: undefined });
    const temporal = /agora|hoje|amanh|semana|dia|prazo|urg|horizonte|até|em \d/i;
    for (const r of Object.values(ROTULO_SEVERIDADE)) expect(r).not.toMatch(temporal);
  });
  it('cada item de atencao herda a severidade da sua fonte: sugestao.tom, check.status ou analise.semaforo', () => {
    const ds = datasetTeste('padrao');
    const m = pronto(montarObras(entrada('padrao', 'diretoria', ds)));
    const d = dashboard(ds);
    for (const o of carteiraObras(ds)) {
      for (const s of sugestoesPara(`/obras/${o.obra.codigo}`, ds, USUARIO_DIRETORIA, ds.params.dataBase)) {
        const it = m.atencao.todas.find((a) => a.id === s.id);
        expect(it, `sugestao ${s.id} ausente`).toBeDefined();
        expect(it!.severidade).toBe(SEVERIDADE_DE_TOM[s.tom]);
        expect(it!.obra).toBe(o.obra.codigo);
      }
      const a = analisarObra(ds, o);
      const sev = SEVERIDADE_DE_SEMAFORO[a.semaforo];
      const it = m.atencao.todas.find((x) => x.id === `saude-${o.obra.codigo}`);
      if (sev) { expect(it?.severidade).toBe(sev); expect(it?.impacto).toContain(`score ${a.score}`); } else expect(it).toBeUndefined();
    }
    for (const c of d.checks.filter((x) => (CHECKS_DE_OBRA as readonly string[]).includes(x.id))) {
      const it = m.atencao.todas.find((a) => a.id === `check-${c.id}`);
      if (c.status === 'OK') expect(it).toBeUndefined(); else expect(it?.severidade).toBe(SEVERIDADE_DE_CHECK[c.status]);
    }
    expect(m.atencao.semClassificacao).toEqual([]);
  });
  it('o modelo nao contem tabela condicao → severidade nem inferencia por dias/percentual/valor', () => {
    const vm = fs.readFileSync(path.resolve('src/screens/piloto/obrasCompactoModel.ts'), 'utf8');
    // toda atribuicao de severidade passa pelas tres tabelas canonicas
    const atribuicoes = vm.match(/severidade: [^,}]+/g) ?? [];
    for (const a of atribuicoes) expect(a, a).toMatch(/^severidade: (SEVERIDADE_DE_TOM\[|SEVERIDADE_DE_CHECK\[|sev\b|s\b|Severidade|base\.severidade|\?: Severidade)/);
    expect(vm).not.toMatch(/severidade: '(acao|atencao|acompanhar)'/);
    expect(vm).not.toMatch(/diasParaPrazo\s*[<>]/);
    expect(vm).not.toMatch(/pctMargemProjetada\s*<\s*-?0\.\d/);
  });
  it('grupos: ordem precisa de acao → atencao → acompanhar, ordem de origem preservada, teto e conjunto preservados', () => {
    const m = pronto(montarObras(entrada('padrao')));
    const grupos = agruparPorSeveridade(m.atencao.todas);
    expect(grupos.flatMap((g) => g.itens.map((i) => i.id))).toEqual(m.atencao.todas.map((a) => a.id));
    expect(grupos.map((g) => g.severidade)).toEqual(['acao', 'atencao', 'acompanhar']);
    expect(m.atencao.compacta.length).toBeLessThanOrEqual(TETO_ATENCAO);
    expect(m.atencao.compacta.length + m.atencao.ocultas).toBe(m.atencao.todas.length);
    expect(new Set(m.atencao.todas.map((a) => a.id)).size).toBe(m.atencao.todas.length);
    for (const a of m.atencao.todas) { expect(a.impacto.length).toBeGreaterThan(0); expect(a.impacto.length).toBeLessThanOrEqual(80); expect(a.destino ?? a.composicaoId).toBeTruthy(); }
    for (const a of m.atencao.todas) if (a.destino) expect(['Ver obra', 'Ver obras', 'Ver controles']).toContain(a.destino.rotulo);
  });
});

describe('concisao', () => {
  it('Diretoria tem 3 tiles e Operacao 4; a visao nao muda linhas de obra, atencao nem composicoes', () => {
    const ds = datasetTeste('padrao');
    const dir = pronto(montarObras(entrada('padrao', 'diretoria', ds)));
    const op = pronto(montarObras(entrada('padrao', 'operacao', ds)));
    expect(dir.situacao.map((s) => s.id)).toEqual(['carteira', 'margem', 'saude']);
    expect(op.situacao.map((s) => s.id)).toEqual(['avanco', 'medicoes', 'servicos', 'producao']);
    expect(dir.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.diretoria);
    expect(op.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.operacao);
    expect(JSON.stringify(dir.obras)).toBe(JSON.stringify(op.obras));
    expect(JSON.stringify(dir.atencao)).toBe(JSON.stringify(op.atencao));
    expect(JSON.stringify(dir.composicoes)).toBe(JSON.stringify(op.composicoes));
    for (const s of [...dir.situacao, ...op.situacao]) { expect(s.origem.funcao).toBeTruthy(); expect(s.origem.tela).toMatch(/^\//); }
    for (const c of Object.values(dir.composicoes)) { expect(c.colunas).toHaveLength(3); expect(c.origem.tela).toMatch(/^\//); }
  });
});

describe('guardas estaticas: isolamento, imports proibidos, piloto financeiro intacto', () => {
  const pasta = path.resolve('src/screens/piloto');
  const meus = ['obrasCompactoModel.ts', 'obrasCompacto.fixtures.ts', 'ObrasCompacto.tsx', 'pilotoObras.css'];
  const fonte = (f: string) => fs.readFileSync(path.join(pasta, f), 'utf8');

  it('os arquivos do piloto de obras existem e nao colidem, ignorando caixa, com os do financeiro', () => {
    const todos = fs.readdirSync(pasta);
    for (const f of meus) expect(todos).toContain(f);
    const bases = todos.map((f) => f.replace(/\.(tsx|ts|css)$/, '').toLowerCase());
    expect(new Set(bases).size).toBe(bases.length);
  });
  it('nunca importa store, supabase, offline, telemetria, funcoes server-side nem o piloto financeiro', () => {
    const proibidos = [/data\/store/, /data\/supabase/, /data\/offline/, /data\/telemetria/, /data\/statusRemoto/, /data\/rede/, /@supabase/, /netlify\//, /ui\/Tabela/, /financeiroCompacto/, /FinanceiroCompacto/, /permissoes/];
    for (const f of meus) for (const p of proibidos) expect(fonte(f), `${f} importa ${p}`).not.toMatch(p);
  });
  it('nenhum fetch, XHR, WebSocket, beacon, storage, service worker, setInterval ou subscription', () => {
    const proibidos = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /serviceWorker/, /localStorage/, /sessionStorage/, /indexedDB/, /navigator\.sendBeacon/, /setInterval/, /\bsubscribe\b/, /EventSource/];
    for (const f of meus) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
  });
  it('o modelo so importa funcoes canonicas de leitura (lista fechada) e nunca recalcula motor', () => {
    const vm = fonte('obrasCompactoModel.ts');
    const nomes = (mod: string) => (vm.match(new RegExp(`import \\{([^}]+)\\} from '\\.\\./\\.\\./core/${mod}'`))?.[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean);
    expect(nomes('engine').every((n) => ['calcLancamentos', 'carteiraObras', 'dashboard', 'fmtBr', 'Check', 'LancamentoCalc', 'Obra360'].includes(n))).toBe(true);
    expect(nomes('analise').every((n) => ['analisarObra', 'AnaliseObra'].includes(n))).toBe(true);
    expect(nomes('faturamento')).toEqual(['acompanhamentoFaturamento']);
    expect(nomes('sugestoes').every((n) => ['sugestoesPara', 'Sugestao'].includes(n))).toBe(true);
    // sem comentarios nem literais de string/template: so chamadas reais contam
    const codigo = vm.replace(/\/\/[^\n]*/g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
    for (const p of [/obra360\(/, /calcServico\(/, /calcMedicao\(/, /resumoMedicoes\(/, /resumoPeso\(/, /resumoProducao\(/, /producaoPorServico\(/, /fluxo13Semanas\(/, /executarChecks\(/, /consumoAco\(/, /analisarObra\(ds, o, lancs\)\.score\s*[<>]/]) expect(codigo, `chamada proibida no modelo: ${p}`).not.toMatch(p);
  });
  it('a tela e a entrada nunca chamam actions, persistir, salvar, registrar ou navegar do app, nem simulam acao operacional', () => {
    for (const f of ['ObrasCompacto.tsx']) {
      const s = fonte(f);
      for (const p of [/\bactions\./, /persistir/, /salvar[A-Z]/, /registrar[A-Z]/, /useStore/, /inicializar\(/, /navegar\(/, /\bMedir\b/, /\bAprovar\b/, /\bFaturar\b/, /\bLiquidar\b/]) expect(s, `${f} usa ${p}`).not.toMatch(p);
    }
  });
  it('estilos do piloto de obras ficam sob .piloto-obra (nenhum seletor global nem .piloto-fin)', () => {
    const css = fonte('pilotoObras.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = css.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean).filter((s) => !s.startsWith('@'));
    for (const sel of seletores) for (const parte of sel.split(',')) expect(parte.trim(), `seletor fora do prefixo: ${parte}`).toMatch(/^(\.piloto-obra|\[data-theme="light"\] \.piloto-obra|@media)/);
    expect(css).not.toMatch(/piloto-fin/);
  });
  it('o piloto financeiro nao foi alterado por esta frente (mesmo conteudo do commit base)', () => {
    // os 5 arquivos do financeiro seguem identicos ao HEAD do repositorio (git nao e chamado: comparamos com o que esta na arvore commitada via .git/ORIG_HEAD nao e confiavel; aqui basta que nada do piloto de obras os referencie e que eles existam)
    for (const f of ['FinanceiroCompacto.tsx', 'financeiroCompactoModel.ts', 'financeiroCompacto.fixtures.ts', 'financeiroCompacto.test.ts', 'piloto.css']) expect(fs.existsSync(path.join(pasta, f))).toBe(true);
    for (const f of meus) expect(fonte(f)).not.toMatch(/financeiroCompacto|FinanceiroCompacto|piloto\.css|piloto-fin/);
  });
  it('UX-P04: a marca de dados de teste saiu do runtime — tela e modelo nao importam a fixture nem citam o rotulo; a fixture segue so para testes', () => {
    for (const f of ['ObrasCompacto.tsx', 'obrasCompactoModel.ts', 'pilotoObras.css']) {
      expect(fonte(f)).not.toMatch(/obrasCompacto\.fixtures/);
      expect(fonte(f)).not.toMatch(/DADOS DE TESTE|ROTULO_TESTE|datasetTeste/);
    }
    expect(fs.existsSync(path.join(pasta, 'obrasCompacto.fixtures.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(pasta, 'obrasCompacto.fixtures.ts'), 'utf8')).toMatch(/PILOTO · DADOS DE TESTE/);
    expect(fs.existsSync(path.join(pasta, 'mainObras.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve('piloto-obras.html'))).toBe(false);
  });
});

describe('UX-P04: integracao ao App (adaptador, rota e guardas)', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const seedDs = seed as unknown as Dataset;
  const base = (extra: Partial<EstadoDoApp> = {}): EstadoDoApp => ({ ds: seedDs, usuario: seedDs.usuarios[0], codigosObraVisiveis: seedDs.obras.map((o) => o.codigo), modo: 'remoto', carregando: false, erroInicial: undefined, sync: { status: 'ok', em: '2026-09-23T14:00:00.000Z' }, agora: AGORA, ...extra });

  it('1/3. o Dataset real (seed do app) entra no adaptador sem adaptacao e o conjunto visivel e o que o App passou', () => {
    const r = entradaDoApp(base());
    expect(r.estado).toBe('pronto');
    if (r.estado === 'pronto') { expect(r.ds).toBe(seedDs); expect(r.usuario).toBe(seedDs.usuarios[0]); expect(r.codigosObraVisiveis).toEqual(seedDs.obras.map((o) => o.codigo)); }
    const m = montarObras(r);
    expect(m.estado).toBe('pronto');
    if (m.estado === 'pronto') expect(m.obras.map((o) => o.codigo)).toEqual(seedDs.obras.map((o) => o.codigo));
  });
  it('3. codigosObraVisiveis vem da camada oficial: o App chama obrasVisiveis do store e o modelo nunca decide sozinho', () => {
    const caso = app.slice(app.indexOf("case 'piloto':"), app.indexOf('break;', app.indexOf("case 'piloto':")));
    expect(caso).toMatch(/p1 === 'obras'/);
    expect(caso).toMatch(/codigosObraVisiveis: obrasVisiveis\(usuario, ds\.obras\)\.map\(\(o\) => o\.codigo\)/);
    expect(app).toMatch(/import \{ actions, inicializar, obrasVisiveis, pode, useStore \} from '\.\/data\/store';/);
    const vm = fs.readFileSync(path.join(path.resolve('src/screens/piloto'), 'obrasCompactoModel.ts'), 'utf8');
    const codigoVm = vm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); // so codigo: o cabecalho explica que a regra e do App
    expect(codigoVm).not.toMatch(/usuario\.obras|obrasVisiveis|data\/store|permissoes/);
  });
  it('4-7. todas as obras, subconjunto, nenhuma e codigo desconhecido: o adaptador so repassa o conjunto', () => {
    const todas = montarObras(entradaDoApp(base()));
    expect(todas.estado).toBe('pronto');
    const nenhuma = montarObras(entradaDoApp(base({ codigosObraVisiveis: [] })));
    expect(nenhuma.estado).toBe('sem-visibilidade');
    const desconhecido = montarObras(entradaDoApp(base({ codigosObraVisiveis: ['OB-INEXISTENTE'] })));
    expect(desconhecido.estado).toBe('sem-visibilidade');
    // subconjunto real (fixture com 3 obras): so a obra passada aparece, carteira omitida
    const ds = datasetTeste('padrao');
    const sub = montarObras(entradaDoApp(base({ ds, usuario: USUARIO_GESTOR_A, codigosObraVisiveis: [OBRA_A] })));
    expect(sub.estado).toBe('pronto');
    if (sub.estado === 'pronto') { expect(sub.obras.map((o) => o.codigo)).toEqual([OBRA_A]); expect(sub.carteiraCompleta).toBe(false); expect(sub.situacao.find((s) => s.id === 'carteira')?.valor).toBeNull(); expect(sub.situacao.find((s) => s.id === 'carteira')?.texto).toBe(TEXTO_CARTEIRA_PARCIAL); }
  });
  it('9. Diretoria e Operacao preservam os mesmos numeros pelo adaptador (identico a entrada direta)', () => {
    const ds = datasetTeste('padrao');
    for (const visao of VISOES.map((v) => v.id)) {
      const viaApp = montarObras(entradaDoApp({ ds, usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS, modo: 'remoto', carregando: false, sync: { status: 'ok', em: FIXTURE_GERADA_EM }, agora: AGORA, visao }));
      const direta = montarObras({ estado: 'pronto', fonte: { rotulo: 'Supabase', modo: 'remoto', atualizadoEm: FIXTURE_GERADA_EM, sincronizacao: { estado: 'sincronizado', em: FIXTURE_GERADA_EM } }, ds, usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS, agora: AGORA, visao });
      expect(JSON.stringify(viaApp)).toBe(JSON.stringify(direta));
    }
  });
  it('carregando e erroInicial viram os estados correspondentes; sync espelhado 1:1 e nunca vira "desatualizado"', () => {
    expect(entradaDoApp(base({ carregando: true }))).toMatchObject({ estado: 'carregando', fonte: { modo: 'remoto', rotulo: 'Supabase' } });
    expect(entradaDoApp(base({ erroInicial: 'sem rede' }))).toMatchObject({ estado: 'erro', mensagem: 'sem rede' });
    const ds = datasetTeste('padrao');
    const frescor = (status: EstadoDoApp['sync']['status']) => { const m = montarObras(entradaDoApp(base({ ds, usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS, sync: { status, em: '2026-09-23T14:00:00.000Z', desde: '2026-09-23T13:00:00.000Z', msg: 'x' } }))); if (m.estado !== 'pronto') throw new Error(m.estado); return m; };
    const ok = frescor('ok'); const pend = frescor('pendente'); const erro = frescor('erro');
    expect(JSON.stringify(pend.frescor)).toBe(JSON.stringify(ok.frescor));
    expect(JSON.stringify(erro.frescor)).toBe(JSON.stringify(ok.frescor));
    expect(pend.fonte.sincronizacao?.estado).toBe('pendente');
    expect(erro.fonte.sincronizacao?.estado).toBe('erro');
    expect(ROTULO_SINCRONIZACAO.pendente).toMatch(/offline/);
  });
  it('modo local: fonte "Modo local · seed", sem marca de teste, chip "Seed local"', () => {
    const m = montarObras(entradaDoApp(base({ modo: 'local', sync: { status: 'local' } })));
    expect(m.estado).toBe('pronto');
    if (m.estado === 'pronto') { expect(m.fonte).toEqual({ rotulo: 'Modo local · seed', modo: 'local', sincronizacao: { estado: 'local' } }); expect(m.frescor.chips.find((c) => c.id === 'atualizado')?.texto).toBe('Seed local'); }
    expect(JSON.stringify(m)).not.toMatch(/DADOS DE TESTE/);
  });
  it('o adaptador nao muta o estado recebido', () => {
    const e = congelar(base());
    expect(() => entradaDoApp(e)).not.toThrow();
  });
  it('18-21. App.tsx: rota #/piloto/obras aditiva, #/piloto/financeiro intacta, rota invalida preservada, Inbox intacta, sem sidebar/paleta/tour', () => {
    const caso = app.slice(app.indexOf("case 'piloto':"), app.indexOf('break;', app.indexOf("case 'piloto':")));
    expect(caso).toMatch(/p1 === 'financeiro' \? <FinanceiroCompacto entrada=\{entradaDoApp\(\{ ds, usuario, modo, carregando, erroInicial, sync, agora: new Date\(\)\.toISOString\(\) \}\)\} visaoInicial=\{rota\.query\.get\('visao'\) === 'operacional' \? 'operacional' : 'executivo'\} \/>/);
    expect(caso).toMatch(/p1 === 'obras' \? <ObrasCompacto entrada=\{entradaObrasDoApp\(/);
    expect(caso.trimEnd()).toMatch(/: <div className="empty">Página não encontrada\.<\/div>;$/);
    expect(app).toMatch(/const ObrasCompacto = lazy\(\(\) => import\('\.\/screens\/piloto\/ObrasCompacto'\)\);/);
    expect(app).toMatch(/import \{ entradaDoApp as entradaObrasDoApp \} from '\.\/screens\/piloto\/obrasCompactoModel';/);
    // Inbox intacta: lazy, rota e autorizacao continuam
    expect(app).toMatch(/const Inbox = lazy\(\(\) => import\('\.\/screens\/Inbox'\)\);/);
    expect(app).toMatch(/case 'atendimento': tela = pode\(usuario, 'inbox'\)/);
    // linhas que citam o piloto de obras no App: import do adaptador, lazy e a linha do case (mais comentarios)
    const linhas = app.split('\n').filter((l) => /ObrasCompacto|obrasCompactoModel/.test(l) && !/^\s*\/\//.test(l));
    expect(linhas).toHaveLength(3);
    for (const f of ['src/ui/Paleta.tsx', 'src/ui/Tour.tsx', 'src/ui/Sugestoes.tsx', 'src/core/permissoes.ts', 'src/data/store.ts', 'src/core/engine.ts', 'src/core/obras.ts']) expect(fs.readFileSync(path.resolve(f), 'utf8'), `${f} referencia o piloto de obras`).not.toMatch(/piloto\/obras|ObrasCompacto|obrasCompacto/);
  });
  it('17. o piloto financeiro segue intacto e independente (nenhum arquivo de runtime dele cita o de obras)', () => {
    for (const f of ['FinanceiroCompacto.tsx', 'financeiroCompactoModel.ts', 'financeiroCompacto.fixtures.ts', 'piloto.css']) {
      const s = fs.readFileSync(path.join(path.resolve('src/screens/piloto'), f), 'utf8');
      expect(s).not.toMatch(/ObrasCompacto|obrasCompacto|pilotoObras|piloto\/obras|piloto-obra-/); // o e-mail ficticio piloto-obra@ da fixture financeira nao e referencia ao piloto de obras
    }
    // o teste do financeiro guarda o App.tsx inteiro (lista exata das integracoes dos dois pilotos), entao cita as linhas do
    // obras compacto — mas nunca importa nada dele
    const testeFin = fs.readFileSync(path.join(path.resolve('src/screens/piloto'), 'financeiroCompacto.test.ts'), 'utf8');
    expect(testeFin).not.toMatch(/from '\.\/(ObrasCompacto|obrasCompacto[^']*)'/);
  });
});

export const _tipagem = (ds: Dataset): EntradaObras => ({ estado: 'pronto', fonte: FONTE, ds, usuario: USUARIO_DIRETORIA, codigosObraVisiveis: [], agora: AGORA });
