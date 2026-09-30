// UX-P07 — Produção compacto: provas do piloto isolado.
//
// O vitest roda em `environment: 'node'`, sem testing-library: o componente nao e renderizado. O que o piloto DECIDE
// mora em `producaoCompactoModel.ts` (puro) e e provado contra a saida REAL do core sobre a fixture; o que so existe no
// JSX fica preso por guardas estaticas sobre o fonte da pasta.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDays, calcLancamentos, executarChecks, obra360 } from '../../core/engine';
import { calcOrdem, resumoProducao } from '../../core/obras';
import { calcConjunto, resumoPeso } from '../../core/materiais';
import { calcRomaneio, resumoProdutividade } from '../../core/producao';
import { consumoAco } from '../../core/estoque';
import { analisarObra } from '../../core/analise';
import { sugestoesPara } from '../../core/sugestoes';
import type { Dataset, OrdemProducao, PedidoCompra, Tarefa } from '../../core/types';
import { DATA_BASE_TESTE, FIXTURE_GERADA_EM, MOTORISTA_TESTE, OBRA_A, OBRA_B, OBRA_C, PREFIXO_TESTE, ROTULO_TESTE, TODAS_AS_OBRAS, USUARIO_DIRETORIA, USUARIO_GESTOR_A, USUARIO_SEM_OBRA, VARIANTES, datasetTeste, entradaDaVariante, type VarianteFixture } from './producaoCompacto.fixtures';
import { DIAS_PERIODO_PRODUTIVIDADE, ROTULO_ESCOPO_PARCIAL, ROTULO_KG_HH, ROTULO_PENDENCIA, ROTULO_SINCRONIZACAO, STATUS_ABERTA, TETO_ORDENS, TETO_PENDENCIAS, TETO_SITUACAO, TEXTO_SEM_LISTA, TEXTO_SEM_ORDENS, TIPOS_NEUTROS, TIPOS_PENDENCIA, VISOES, kg, montarProducao, pct, textoNecessidade, type EntradaProducao, type ModeloProducao, type Visao } from './producaoCompactoModel';

const AGORA = '2026-09-23T15:00:00.000Z';
const FONTE = { rotulo: ROTULO_TESTE, modo: 'teste' as const, atualizadoEm: FIXTURE_GERADA_EM, id: 'fixture' };
const entrada = (variante: VarianteFixture, visao: Visao = 'diretoria', ds = datasetTeste(variante), visiveis?: string[]): Extract<EntradaProducao, { estado: 'pronto' }> => {
  const e = entradaDaVariante(variante);
  return { estado: 'pronto', fonte: { ...FONTE, id: variante }, ds, usuario: e.usuario, codigosObraVisiveis: visiveis ?? e.codigosObraVisiveis, agora: AGORA, visao };
};
const pronto = (m: ModeloProducao) => { if (m.estado !== 'pronto') throw new Error(`esperava pronto, veio ${m.estado}`); return m; };
function congelar<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v as object)) congelar((v as Record<string, unknown>)[k]); }
  return v;
}
const semVisao = (m: ReturnType<typeof pronto>) => ({ ...m, visao: undefined, situacao: undefined });
const semEntrada = (m: ReturnType<typeof pronto>) => ({ ...m, usuario: undefined, fonte: undefined });
const DB = DATA_BASE_TESTE;
const PERIODO = { de: addDays(DB, -DIAS_PERIODO_PRODUTIVIDADE), ate: DB };
const daObra = <T extends { codigoObra: string }>(xs: T[], cods: string[]) => xs.filter((x) => cods.includes(x.codigoObra));

const pasta = path.resolve('src/screens/piloto');
const fonte = (f: string) => fs.readFileSync(path.join(pasta, f), 'utf8');
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const semTextos = (s: string) => semComentarios(s).replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');

describe('fixture: dados de teste identificados', () => {
  it('obras, servicos, ordens, conjuntos, colaboradores, estoque e usuarios carregam o prefixo do piloto', () => {
    const ds = datasetTeste('padrao');
    expect(ds.params.empresa.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.obras) { expect(o.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(o.codigo.startsWith('OB-PP-')).toBe(true); }
    for (const s of ds.servicos) expect(s.nome.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.ordens) expect(o.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const c of ds.conjuntos) expect(c.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const c of ds.colaboradores) expect(c.nome.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const i of ds.itensEstoque) expect(i.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const u of ds.usuarios) { expect(u.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(u.email.endsWith('.invalid')).toBe(true); }
    expect(ds.params.dataBase).toBe(DB);
  });
  it('nenhum nome real do seed sobrevive', () => {
    const texto = JSON.stringify({ ...datasetTeste('padrao'), radar: undefined, planoContas: undefined, inbox: undefined });
    for (const real of ['Smart Fit', 'Invest Market', 'OB-SF-CL-01', 'Augusto', 'César Lattes', 'NF 47', 'SFCL', 'ORC-328']) expect(texto.includes(real)).toBe(false);
  });
  it('cobre os cenarios pedidos, provados pela saida do proprio core', () => {
    const ds = datasetTeste('padrao');
    const o = new Map(ds.ordens.map((x) => [x.id, calcOrdem(x, DB)]));
    expect([o.get('OF-PP-A1')!.status, o.get('OF-PP-A1')!.atrasada]).toEqual(['Em andamento', false]); // fabricacao normal
    expect([o.get('OF-PP-A2')!.status, o.get('OF-PP-A2')!.atrasada]).toEqual(['Em andamento', true]); // fabricacao parcial atrasada
    expect(o.get('OF-PP-A2')!.etapas[o.get('OF-PP-A2')!.etapaAtualIdx].responsavel).toBeUndefined(); // etapa sem responsavel
    expect(o.get('OF-PP-A3')!.status).toBe('Concluída'); // fabricacao concluida
    expect(o.get('OF-PP-A3')!.atrasada).toBe(false); // data passada, mas concluida
    expect(o.get('OM-PP-A1')!.status).toBe('Não iniciada'); // montagem pendente
    expect([o.get('OM-PP-A2')!.status, o.get('OM-PP-A2')!.dataNecessidade, o.get('OM-PP-A2')!.atrasada]).toEqual(['Em andamento', undefined, false]); // montagem parcial sem data
    expect([o.get('OM-PP-B1')!.status, o.get('OM-PP-B1')!.atrasada]).toEqual(['Em andamento', true]); // montagem parcial atrasada
    expect(o.get('OF-PP-B1')!.status).toBe('Cancelada');
    const sit = new Set(ds.conjuntos.map((c) => calcConjunto(c).situacao));
    for (const s of ['Não liberado', 'Liberado', 'Em fabricação', 'Fabricado', 'Expedido', 'Montado']) expect(sit.has(s as never)).toBe(true);
    const pA = resumoPeso(daObra(ds.conjuntos, [OBRA_A]));
    expect(pA.emFabrica).toBeGreaterThan(0); expect(pA.emCanteiro).toBeGreaterThan(0);
    const oA = obra360(ds, ds.obras[0]);
    expect(oA.servicos.some((s) => s.situacaoPrazo === 'Em risco')).toBe(true);
    expect(obra360(ds, ds.obras[1]).servicos.some((s) => s.situacaoPrazo === 'Atrasado')).toBe(true);
    expect(new Set(ds.romaneios.map((r) => r.status))).toEqual(new Set(['Entregue', 'Emitido', 'Cancelado']));
    const prod = resumoProdutividade(ds, PERIODO);
    expect(prod.kgPorHHCanteiro).toBeLessThan(prod.metaCanteiro);
    expect(prod.kgPorHHFabrica).toBeGreaterThan(prod.metaFabrica);
    expect(consumoAco(ds, { codigoObra: OBRA_A }).total.movimentos).toBeGreaterThan(0);
    expect([ds.ordens, ds.conjuntos, ds.apontamentosEstacao, ds.romaneios].every((xs) => !xs.some((x) => x.codigoObra === OBRA_C))).toBe(true); // obra sem producao
    expect(sugestoesPara('/producao', ds, USUARIO_DIRETORIA).some((s) => s.id === 'ordens-sem-data')).toBe(true);
    expect(sugestoesPara(`/obras/${OBRA_B}`, ds, USUARIO_DIRETORIA).some((s) => s.id === `obra-${OBRA_B}-parados`)).toBe(true);
    expect(sugestoesPara(`/obras/${OBRA_C}`, ds, USUARIO_DIRETORIA).some((s) => s.id === `obra-${OBRA_C}-datas`)).toBe(true);
    const checks = executarChecks(ds);
    expect(checks.find((c) => c.id === 'ALT-07')!.status).toBe('ATENÇÃO');
    expect(checks.find((c) => c.id === 'ALT-09')!.status).toBe('ATENÇÃO');
  });
  it('datasetTeste devolve sempre um objeto novo; entradaDaVariante cobre todas as variantes', () => {
    expect(datasetTeste('padrao')).not.toBe(datasetTeste('padrao'));
    expect(VARIANTES.map((v) => v.id)).toEqual(['padrao', 'subconjunto', 'parcial', 'nenhuma', 'sem-producao', 'vazio']);
    expect(entradaDaVariante('padrao')).toEqual({ usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS });
    expect(entradaDaVariante('subconjunto')).toEqual({ usuario: USUARIO_GESTOR_A, codigosObraVisiveis: [OBRA_A] });
    expect(entradaDaVariante('parcial').codigosObraVisiveis).toEqual([OBRA_A, OBRA_B]);
    expect(entradaDaVariante('nenhuma')).toEqual({ usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] });
  });
});

describe('paridade com o core (nenhum numero e recalculado no piloto)', () => {
  const ds = datasetTeste('padrao');
  const m = pronto(montarProducao(entrada('padrao', 'operacao', ds)));
  it('calcOrdem: status, etapa, percentual por etapas, necessidade e atraso de cada ordem sao os do core', () => {
    expect(m.ordens.todas.length).toBeGreaterThan(0);
    for (const l of m.ordens.todas) {
      const c = calcOrdem(ds.ordens.find((o) => o.id === l.id)!, DB);
      expect([l.status, l.etapaAtual, l.pctConcluido, l.atrasada, l.dataNecessidade, l.diasParaNecessidade, l.quantidade, l.unidade]).toEqual([c.status, c.etapaAtual, c.pctConcluido, c.atrasada, c.dataNecessidade, c.diasParaNecessidade, c.quantidade, c.unidade]);
      expect(l.responsavelEtapa).toBe(c.etapaAtualIdx >= 0 ? c.etapas[c.etapaAtualIdx].responsavel : undefined);
    }
    for (const o of ds.ordens.filter((x) => !x.cancelada)) {
      const comp = m.composicoes[`ordem:${o.id}`];
      expect(comp.linhas.map((l) => [l.titulo, l.valor])).toEqual(o.etapas.map((e) => [e.nome, e.quantidadeConcluida]));
    }
  });
  it('resumoProducao: com a carteira completa os tiles de ordens sao o resumo global, fabricacao e montagem separadas', () => {
    const f = resumoProducao(ds.ordens, 'Fabricação', DB);
    const mo = resumoProducao(ds.ordens, 'Montagem', DB);
    expect(m.carteiraCompleta).toBe(true);
    expect(m.tiles['ordens-atrasadas'].numeros.map((x) => [x.rotulo, x.valor])).toEqual([['Fabricação', f.atrasadas], ['Montagem', mo.atrasadas]]);
    expect(m.tiles['ordens-andamento'].numeros.map((x) => [x.rotulo, x.valor])).toEqual([['Fabricação', f.emAndamento], ['Montagem', mo.emAndamento]]);
    expect(m.tiles['ordens-andamento'].partes.map((p) => p.valor)).toEqual([f.concluidas, mo.concluidas]);
    expect(m.tiles['ordens-atrasadas'].partes.map((p) => p.valor)).toEqual([f.ordens.length, mo.ordens.length]);
    expect(m.composicoes.ordens.linhas.map((l) => l.valor)).toEqual([...f.porEtapa, ...mo.porEtapa].map((e) => e.ordens.length));
  });
  it('resumoProducao por obra: cada linha de obra e o resumo daquela obra (obra360), ausente quando nao ha ordem', () => {
    const d = pronto(montarProducao(entrada('padrao', 'diretoria', ds)));
    for (const o of d.obras) {
      for (const [campo, tipo] of [['fabricacao', 'Fabricação'], ['montagem', 'Montagem']] as const) {
        const r = resumoProducao(ds.ordens, tipo, DB, o.codigo);
        expect(o[campo]).toEqual(r.ordens.length ? { ordens: r.ordens.length, emAndamento: r.emAndamento, atrasadas: r.atrasadas, concluidas: r.concluidas } : null);
      }
    }
  });
  it('calcConjunto/resumoPeso: tiles de peso sao o resumo global; linhas de obra e conjuntos sao os do core', () => {
    const p = resumoPeso(ds.conjuntos);
    const t = m.tiles;
    expect(pronto(montarProducao(entrada('padrao', 'diretoria', ds))).tiles['peso-fabricado'].numeros[0].valor).toBe(p.pesoFabricado);
    expect(t['peso-fabricado'].micro).toContain(pct(p.pctFabricado));
    expect(t['peso-fabricado'].partes.map((x) => x.valor)).toEqual([p.pesoTotal, p.pesoLiberado]);
    expect(t['peso-montado'].numeros[0].valor).toBe(p.pesoMontado);
    expect(t['peso-montado'].micro).toContain(pct(p.pctMontado));
    expect(t['peso-montado'].partes.map((x) => x.valor)).toEqual([p.pesoExpedido, p.emCanteiro]);
    expect(t['peso-em-fabrica'].numeros[0].valor).toBe(p.emFabrica);
    expect(t['peso-em-canteiro'].numeros[0].valor).toBe(p.emCanteiro);
    const d = pronto(montarProducao(entrada('padrao', 'diretoria', ds)));
    for (const o of d.obras) {
      const r = resumoPeso(daObra(ds.conjuntos, [o.codigo]));
      expect(o.peso).toEqual(r.conjuntos.length ? { total: r.pesoTotal, fabricado: r.pesoFabricado, pctFabricado: r.pctFabricado, expedido: r.pesoExpedido, montado: r.pesoMontado, pctMontado: r.pctMontado, emFabrica: r.emFabrica, emCanteiro: r.emCanteiro } : null);
    }
    for (const cod of [OBRA_A, OBRA_B]) {
      const linhas = m.composicoes[`conjuntos:${cod}`].linhas;
      const esperado = daObra(ds.conjuntos, [cod]).map(calcConjunto);
      expect(linhas.map((l) => [l.id, l.valor])).toEqual(esperado.map((c) => [c.id, c.pesoTotal]));
      for (const [i, c] of esperado.entries()) expect(linhas[i].sub).toContain(c.situacao);
    }
  });
  it('resumoProdutividade: a composicao repete o resumo do periodo padrao, estacao a estacao; por obra idem', () => {
    const r = resumoProdutividade(ds, PERIODO);
    const c = m.composicoes.produtividade;
    const par = (rotulo: string) => c.pares.find((p) => p.rotulo === rotulo)!.texto;
    expect(par('Fabricado (Pintura)')).toBe(kg(r.kgFabricados));
    expect(par('Expedido (Expedição)')).toBe(kg(r.kgExpedidos));
    expect(par('Montado (Liberação)')).toBe(kg(r.kgMontados));
    expect(c.linhas.map((l) => [l.id, l.valor])).toEqual(r.porEstacao.map((e) => [e.chave, e.kg]));
    expect(c.pares.find((p) => p.rotulo === 'Período')!.texto).toMatch(/24\/08\/2026 a 23\/09\/2026/);
    for (const cod of [OBRA_A, OBRA_B]) {
      const ro = resumoProdutividade(ds, { codigoObra: cod, ...PERIODO });
      expect(m.composicoes[`produtividade:${cod}`].linhas.map((l) => [l.id, l.valor])).toEqual(ro.porEstacao.map((e) => [e.chave, e.kg]));
    }
    // o apontamento fora do periodo nao entra (mesmo padrao da tela Fabrica e montagem)
    expect(r.apontamentos.some((a) => a.id === 'AP-PP-A0')).toBe(false);
  });
  it('calcRomaneio e consumoAco: romaneios e aco da obra vem das funcoes canonicas', () => {
    for (const cod of [OBRA_A, OBRA_B]) {
      const rs = daObra(ds.romaneios, [cod]).map((r) => calcRomaneio(r, ds.conjuntos));
      expect(m.composicoes[`romaneios:${cod}`].linhas.map((l) => l.valor).sort()).toEqual(rs.map((r) => r.pesoTotal).sort());
      const aco = consumoAco(ds, { codigoObra: cod });
      expect(m.composicoes[`aco:${cod}`].pares.find((p) => p.rotulo === 'Líquido')!.texto).toBe(kg(aco.total.liquidoKg));
      expect(aco.total).toEqual(obra360(ds, ds.obras.find((o) => o.codigo === cod)!).aco);
    }
    const emitido = m.pendencias.todas.find((p) => p.tipo === 'romaneio-emitido')!;
    const rom = calcRomaneio(ds.romaneios.find((r) => r.id === 'ROM-PP-2')!, ds.conjuntos);
    expect(emitido.impacto).toBe(`${kg(rom.pesoTotal)} · 2 peças`);
  });
});

describe('semantica preservada', () => {
  const ds = datasetTeste('padrao');
  const d = pronto(montarProducao(entrada('padrao', 'diretoria', ds)));
  const o = pronto(montarProducao(entrada('padrao', 'operacao', ds)));
  it('fabricacao != montagem: tiles de ordens tem dois numeros rotulados, nunca um total', () => {
    for (const id of ['ordens-atrasadas', 'ordens-andamento'] as const) {
      const t = d.tiles[id];
      expect(t.numeros.map((x) => x.rotulo)).toEqual(['Fabricação', 'Montagem']);
      expect([...t.numeros, ...t.partes].map((x) => x.rotulo).join(' | ')).not.toMatch(/total|soma/i);
      expect(Object.keys(t)).not.toContain('total');
    }
    const sub = pronto(montarProducao(entrada('subconjunto', 'operacao')));
    const [f, mo] = sub.tiles['ordens-andamento'].numeros.map((x) => x.valor!);
    expect(f).not.toBe(mo);
    expect(sub.tiles['ordens-andamento'].numeros.some((x) => x.valor === f + mo)).toBe(false);
  });
  it('fabricado != expedido != montado: pesos distintos, rotulos distintos, cada um do seu campo do core', () => {
    const p = resumoPeso(ds.conjuntos);
    expect(new Set([p.pesoFabricado, p.pesoExpedido, p.pesoMontado]).size).toBe(3);
    expect(d.tiles['peso-fabricado'].rotulo).toBe('Peso fabricado');
    expect(d.tiles['peso-montado'].rotulo).toBe('Peso montado');
    expect(d.tiles['peso-montado'].partes.map((x) => x.rotulo)).toEqual(['Expedido', 'Em canteiro']);
    expect(d.tiles['peso-montado'].numeros[0].valor).not.toBe(d.tiles['peso-montado'].partes[0].valor);
  });
  it('peso produzido != percentual financeiro; kg em fabrica != faltante; kg em canteiro != montagem concluida', () => {
    expect(d.tiles['peso-fabricado'].micro).toMatch(/do peso da lista/);
    expect(d.tiles['peso-fabricado'].origem.regra).toMatch(/não é percentual financeiro/);
    expect(o.tiles['peso-em-fabrica'].origem.regra).toMatch(/não é material faltante/);
    expect(o.tiles['peso-em-canteiro'].origem.regra).toMatch(/não é montagem concluída/);
    expect(JSON.stringify(d)).not.toMatch(/faturad|R\$/);
  });
  it('ordem atrasada != servico atrasado: contagens separadas, servico atrasado so como informacao da obra', () => {
    const b = d.obras.find((x) => x.codigo === OBRA_B)!;
    expect(b.servicos.atrasados).toBe(obra360(ds, ds.obras[1]).servicosAtrasados);
    expect(b.montagem!.atrasadas).toBe(resumoProducao(ds.ordens, 'Montagem', DB, OBRA_B).atrasadas);
    expect(d.pendencias.todas.filter((p) => p.tipo === 'ordem-atrasada').map((p) => p.id)).toEqual(resumoProducao(ds.ordens, 'Fabricação', DB).ordens.concat(resumoProducao(ds.ordens, 'Montagem', DB).ordens).filter((x) => x.atrasada).map((x) => `ordem-atrasada:${x.id}`));
  });
  it('ordem sem data != ordem atrasada: fica aberta, sem atraso e com texto proprio', () => {
    const semData = o.ordens.todas.find((l) => l.id === 'OM-PP-A2')!;
    expect([semData.dataNecessidade, semData.diasParaNecessidade, semData.atrasada]).toEqual([undefined, undefined, false]);
    expect(textoNecessidade(semData.dataNecessidade, semData.diasParaNecessidade, semData.status)).toBe('sem data de necessidade');
    expect(o.pendencias.todas.some((p) => p.id === 'ordem-atrasada:OM-PP-A2')).toBe(false);
    expect(o.ordens.todas.at(-1)!.id).toBe('OM-PP-A2'); // sem data por ultimo
    expect(textoNecessidade('2026-09-01', -22, 'Concluída')).toBe('necessidade 01/09 · ordem concluída');
  });
  it('ordens abertas: so Nao iniciada/Em andamento, por necessidade; concluida e cancelada ficam fora', () => {
    expect(o.ordens.todas.map((l) => l.codigo)).toEqual(['OM-B1', 'OF-A2', 'OF-B2', 'OF-A1', 'OM-A1', 'OM-A2']);
    expect(o.ordens.todas.every((l) => STATUS_ABERTA.includes(l.status))).toBe(true);
    expect(JSON.stringify(o)).not.toMatch(/OF-PP-B1|Lote cancelado/);
  });
  it('estoque fisico != material disponivel: so o aco consumido da obra; nenhum disponivel, necessidade ou falta', () => {
    expect(Object.keys(d.composicoes).some((k) => /estoque|disponivel/.test(k))).toBe(false);
    // as unicas mencoes sao as negacoes explicitas das regras ("não é material faltante", "não é material disponível")
    const txt = JSON.stringify(d).replace(/não é material faltante|não é material disponível/g, '');
    expect(txt).not.toMatch(/faltante|falta de material|falta líquida|necessidade líquida|material disponível/i);
    expect(d.composicoes[`aco:${OBRA_A}`].nota).toMatch(/não é material disponível/);
  });
});

describe('sem score, sem severidade nova, sem bloqueio e sem ligacao com compras', () => {
  const ds = datasetTeste('padrao');
  const m = pronto(montarProducao(entrada('padrao', 'diretoria', ds)));
  const vm = fonte('producaoCompactoModel.ts');
  const codigoVm = semTextos(vm);
  it('tiles nunca tem tom nem sinal; fatos neutros nunca tem sinal', () => {
    for (const t of Object.values(m.tiles)) { expect('tom' in t).toBe(false); expect('sinal' in t).toBe(false); }
    for (const p of m.pendencias.todas) if (TIPOS_NEUTROS.includes(p.tipo)) expect(p.sinal, p.id).toBeUndefined();
    expect(m.pendencias.todas.filter((p) => !TIPOS_NEUTROS.includes(p.tipo)).every((p) => !!p.sinal)).toBe(true);
  });
  it('sugestoes preservam o tom do core 1:1', () => {
    const sug = m.pendencias.todas.filter((p) => p.sinal?.fonte === 'sugestao');
    expect(sug.map((p) => p.tipo).sort()).toEqual(['sugestao-datas', 'sugestao-ordens-sem-data', 'sugestao-parados']);
    for (const p of sug) {
      const rota = p.tipo === 'sugestao-ordens-sem-data' ? '/producao' : `/obras/${p.obra}`;
      const id = p.tipo === 'sugestao-ordens-sem-data' ? 'ordens-sem-data' : `obra-${p.obra}-${p.tipo === 'sugestao-parados' ? 'parados' : 'datas'}`;
      const s = sugestoesPara(rota, ds, USUARIO_DIRETORIA).find((x) => x.id === id)!;
      expect(p.sinal).toEqual({ fonte: 'sugestao', valor: s.tom });
    }
  });
  it('checks ALT-07 e ALT-09 preservam status e numero do motor 1:1', () => {
    const checks = executarChecks(ds);
    for (const id of ['ALT-07', 'ALT-09']) {
      const c = checks.find((x) => x.id === id)!;
      const p = m.pendencias.todas.find((x) => x.id === `check-${id.toLowerCase()}`)!;
      expect([p.sinal, p.impacto, p.texto]).toEqual([{ fonte: 'check', valor: c.status }, String(c.atual), c.nome]);
    }
  });
  it('pontos de analisarObra com tema Producao aparecem 1:1 na composicao da obra; o semaforo geral nunca e usado', () => {
    const lancs = calcLancamentos(ds);
    for (const o of ds.obras.filter((x) => x.codigo !== OBRA_C)) {
      const pontos = analisarObra(ds, obra360(ds, o, lancs), lancs).pontos.filter((p) => p.tema === 'Produção');
      expect(pontos.length).toBeGreaterThan(0);
      const pares = m.composicoes[`obra-producao:${o.codigo}`].pares.filter((p) => p.sinal);
      expect(pares.map((p) => [p.texto, p.sinal])).toEqual(pontos.map((p) => [p.texto, { fonte: 'analise', valor: p.sinal }]));
    }
    expect(codigoVm).not.toMatch(/semaforo|\.score\b/);
    expect(JSON.stringify(m)).not.toMatch(/"(verde|amarelo|vermelho)"|semáforo|saúde da obra/i);
  });
  it('o modelo nao atribui severidade nem score: todo sinal vem de s.tom, c.status ou p.sinal; nenhum literal de tom', () => {
    const sinais = [...vm.matchAll(/sinal: \{ fonte: '(sugestao|check|analise)'(?: as const)?, valor: ([\w.]+) \}/g)];
    expect(sinais.length).toBe((vm.match(/sinal: \{/g) ?? []).length);
    expect(new Set(sinais.map((s) => s[2]))).toEqual(new Set(['s.tom', 'c.status', 'p.sinal']));
    expect(codigoVm).not.toMatch(/\btom\s*:/);
    expect(codigoVm).not.toMatch(/score|pontua|peso\s*\*|severidade/i);
    expect(vm).not.toMatch(/'(bad|warn|info|crítico|urgente)'/);
  });
  it('rotulos neutros: nada de "Precisa de ação", "Atenção", crítico, urgente ou prioridade; "Em risco" so como valor citado do core', () => {
    const rotulos = [...TIPOS_NEUTROS.map((t) => ROTULO_PENDENCIA[t]), ...Object.values(m.tiles).map((t) => t.rotulo), ...VISOES.map((v) => v.descricao)];
    expect(rotulos.join(' | ')).not.toMatch(/Precisa de ação|Atenção|Acompanhar|crític|urgent|grave|prioridad/i);
    for (const r of rotulos.filter((x) => x !== ROTULO_PENDENCIA['servico-em-risco'])) expect(r).not.toMatch(/risco/i);
    expect(ROTULO_PENDENCIA['servico-em-risco']).toMatch(/"Em risco"/);
  });
  it('as pendencias seguem a ordem do catalogo (nao prioridade)', () => {
    const idx = m.pendencias.todas.map((p) => TIPOS_PENDENCIA.indexOf(p.tipo));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(TIPOS_PENDENCIA.slice(0, TIPOS_NEUTROS.length)).toEqual(TIPOS_NEUTROS);
  });
  it('sem bloqueio inventado: uma tarefa Bloqueada ligada a ordem nao muda nada e nao aparece', () => {
    const tarefa: Tarefa = { id: 'TF-PP-1', titulo: `${PREFIXO_TESTE} tarefa bloqueada`, responsavel: USUARIO_GESTOR_A.id, codigoObra: OBRA_A, ordemId: 'OF-PP-A2', prazo: '2026-09-20', status: 'Bloqueada', origem: 'piloto', criadoEm: FIXTURE_GERADA_EM, bloqueio: 'PILOTO · aguardando chapa' };
    const com = pronto(montarProducao(entrada('padrao', 'operacao', { ...ds, tarefas: [tarefa] })));
    expect(com).toEqual(pronto(montarProducao(entrada('padrao', 'operacao', ds))));
    expect(JSON.stringify(com)).not.toMatch(/bloque|aguardando chapa|falta de material|aguardando material/i);
    expect(codigoVm).not.toMatch(/tarefas|Bloqueada|bloqueio/);
  });
  it('sem ligacao Producao → Compra: um pedido de compra da obra nao muda nada; o modelo nao le compras', () => {
    const pedido: PedidoCompra = { id: 'PC-PP-1', codigo: 'PC-PP-1', codigoObra: OBRA_A, fornecedor: `${PREFIXO_TESTE} Siderúrgica`, documento: 'TESTE', data: '2026-09-10', previsaoEntrega: '2026-09-15', prazoPagamentoDias: 30, categoria: 'Aço e perfis', faturamentoDireto: false, status: 'Emitido', itens: [{ id: 'PC-PP-1-1', descricao: `${PREFIXO_TESTE} Chapa`, unidade: 'kg', quantidade: 1_000, precoUnitario: 9, quantidadeRecebida: 0 }], observacoes: ROTULO_TESTE, criadoEm: FIXTURE_GERADA_EM, criadoPor: USUARIO_GESTOR_A.id, atualizadoEm: FIXTURE_GERADA_EM };
    expect(pronto(montarProducao(entrada('padrao', 'diretoria', { ...ds, pedidos: [pedido] })))).toEqual(m);
    expect(vm).not.toMatch(/core\/compras|\.pedidos\b|pedidoId/);
    expect(JSON.stringify(m)).not.toMatch(/\bpedidos?\b|\bcompras?\b/i); // "expedido" nao conta: palavra inteira
  });
  it('sem dado individual: nenhum nome de colaborador, custo de mao de obra, motorista ou placa', () => {
    const txt = JSON.stringify(m) + JSON.stringify(pronto(montarProducao(entrada('padrao', 'operacao', ds))));
    for (const c of ds.colaboradores) expect(txt).not.toContain(c.nome);
    expect(txt).not.toContain(MOTORISTA_TESTE);
    expect(txt).not.toContain('TST0A00');
    expect(codigoVm).not.toMatch(/porColaborador|custoMaoDeObra|custoPorKg|custoHora|motorista|placa|\.custo\b/);
  });
});

describe('visibilidade, agregacao e contrato de entrada (nao e ACL)', () => {
  it('subconjunto de uma obra: nenhuma ordem, conjunto, apontamento, romaneio, composicao ou pendencia de outra obra', () => {
    const ds = datasetTeste('subconjunto');
    for (const visao of ['diretoria', 'operacao'] as const) {
      const m = pronto(montarProducao(entrada('subconjunto', visao, ds)));
      expect(m.carteiraCompleta).toBe(false);
      expect(m.escopo).toEqual({ tipo: 'obra', texto: `somente ${OBRA_A}`, obras: 1, totalObras: 3 });
      const txt = JSON.stringify(m);
      expect(txt).not.toMatch(/OB-PP-B|OB-PP-C|Mezanino|Cobertura|OM-B1|OF-B2|CJ-PP-B|AP-PP-B|ROM-900[34]|Montador/);
      expect(m.tiles['peso-fabricado'].numeros[0].valor).toBe(resumoPeso(daObra(ds.conjuntos, [OBRA_A])).pesoFabricado);
      expect(m.tiles['ordens-atrasadas'].numeros.map((x) => x.valor)).toEqual([resumoProducao(ds.ordens, 'Fabricação', DB, OBRA_A).atrasadas, resumoProducao(ds.ordens, 'Montagem', DB, OBRA_A).atrasadas]);
      expect(m.composicoes.produtividade.linhas.map((l) => l.id)).toEqual(resumoProdutividade(ds, { codigoObra: OBRA_A, ...PERIODO }).porEstacao.map((e) => e.chave));
    }
  });
  it('carteira parcial com varias obras: agregador canonico sobre a colecao ja filtrada, rotulado "obras visíveis", nunca "carteira inteira"', () => {
    const ds = datasetTeste('parcial');
    const m = pronto(montarProducao(entrada('parcial', 'operacao', ds)));
    const vis = [OBRA_A, OBRA_B];
    expect(m.escopo.texto).toBe(`${ROTULO_ESCOPO_PARCIAL} · 2 de 3`);
    const p = resumoPeso(daObra(ds.conjuntos, vis));
    expect([m.tiles['peso-em-fabrica'].numeros[0].valor, m.tiles['peso-em-canteiro'].numeros[0].valor]).toEqual([p.emFabrica, p.emCanteiro]);
    const f = resumoProducao(daObra(ds.ordens, vis), 'Fabricação', DB);
    const mo = resumoProducao(daObra(ds.ordens, vis), 'Montagem', DB);
    expect(m.tiles['ordens-andamento'].numeros.map((x) => x.valor)).toEqual([f.emAndamento, mo.emAndamento]);
    const r = resumoProdutividade({ apontamentosEstacao: daObra(ds.apontamentosEstacao, vis), colaboradores: ds.colaboradores }, PERIODO);
    expect(m.composicoes.produtividade.linhas.map((l) => [l.id, l.valor])).toEqual(r.porEstacao.map((e) => [e.chave, e.kg]));
    for (const t of Object.values(m.tiles)) expect(t.micro).toContain(ROTULO_ESCOPO_PARCIAL);
    expect(JSON.stringify(m)).not.toMatch(/carteira inteira|todas as obras/i);
  });
  it('nenhum somatorio manual entre obras: o modelo nao usa reduce, += nem soma de campos', () => {
    const codigo = semTextos(fonte('producaoCompactoModel.ts'));
    expect(codigo).not.toMatch(/\.reduce\(|\+=/);
    expect(codigo).not.toMatch(/[\w\])]\s\+\s[\w(]/);
  });
  it('globais (ALT-07, ALT-09 e ordens-sem-data) so com a carteira completa', () => {
    const globais = ['check-alt-07', 'check-alt-09', 'sugestao-ordens-sem-data'];
    expect(pronto(montarProducao(entrada('padrao'))).pendencias.todas.filter((p) => globais.includes(p.tipo)).length).toBe(3);
    for (const v of ['subconjunto', 'parcial'] as const) expect(pronto(montarProducao(entrada(v))).pendencias.todas.some((p) => globais.includes(p.tipo))).toBe(false);
  });
  it('carteira completa exige tambem que todo registro de producao esteja numa obra visivel', () => {
    const ds = datasetTeste('padrao');
    const orfa: OrdemProducao = { ...ds.ordens[0], id: 'OF-PP-X1', codigo: 'OF-X1', codigoObra: 'OB-FORA' };
    const m = pronto(montarProducao(entrada('padrao', 'diretoria', { ...ds, ordens: [...ds.ordens, orfa] })));
    expect(m.carteiraCompleta).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/OF-PP-X1|OF-X1|OB-FORA/);
    expect(m.pendencias.todas.some((p) => p.tipo.startsWith('check-') || p.tipo === 'sugestao-ordens-sem-data')).toBe(false);
  });
  it('nenhuma obra visivel → estado proprio; codigo desconhecido e ignorado e nunca inventa obra', () => {
    const nenhuma = montarProducao(entrada('nenhuma'));
    expect(nenhuma.estado).toBe('sem-visibilidade');
    if (nenhuma.estado === 'sem-visibilidade') expect(nenhuma.totalObras).toBe(3);
    expect(montarProducao(entrada('padrao', 'diretoria', datasetTeste('padrao'), ['OB-DESCONHECIDA'])).estado).toBe('sem-visibilidade');
    const comDesconhecido = pronto(montarProducao(entrada('padrao', 'diretoria', datasetTeste('padrao'), [OBRA_A, 'OB-DESCONHECIDA'])));
    const soA = pronto(montarProducao(entrada('subconjunto', 'diretoria')));
    expect(semEntrada(comDesconhecido)).toEqual(semEntrada(soA));
  });
  it('o modelo nao consulta usuario.obras nem papel: o mesmo conjunto com outro usuario da os mesmos numeros', () => {
    const ds = datasetTeste('padrao');
    const a = pronto(montarProducao({ ...entrada('padrao', 'diretoria', ds, [OBRA_A]), usuario: USUARIO_SEM_OBRA }));
    const b = pronto(montarProducao({ ...entrada('padrao', 'diretoria', ds, [OBRA_A]), usuario: USUARIO_DIRETORIA }));
    expect([a.tiles, a.obras, a.ordens, a.pendencias, a.composicoes]).toEqual([b.tiles, b.obras, b.ordens, b.pendencias, b.composicoes]);
    const codigo = semComentarios(fonte('producaoCompactoModel.ts'));
    expect(codigo).not.toMatch(/usuario\.obras|obrasVisiveis/);
    // o papel so e lido para o cabecalho (nome e papel de quem ve), nunca para decidir visibilidade ou numero
    expect(codigo.match(/usuario\.papel/g)).toHaveLength(1);
    expect(codigo).toMatch(/usuario: \{ nome: usuario\.nome, papel: usuario\.papel \}/);
  });
});

describe('estados, entrada preservada e ausente != zero', () => {
  it('carregando e erro passam intactos; sem producao e sem obras viram vazio com motivo', () => {
    expect(montarProducao({ estado: 'carregando', fonte: FONTE })).toEqual({ estado: 'carregando', fonte: FONTE });
    expect(montarProducao({ estado: 'erro', fonte: FONTE, mensagem: 'x', causa: 'y' })).toEqual({ estado: 'erro', fonte: FONTE, mensagem: 'x', causa: 'y' });
    const sem = montarProducao(entrada('sem-producao'));
    expect(sem.estado === 'vazio' && [sem.semObras, sem.motivo]).toEqual([false, 'Nenhuma ordem, lista de materiais, apontamento de estação ou romaneio nas obras visíveis.']);
    const vazio = montarProducao(entrada('vazio'));
    expect(vazio.estado === 'vazio' && [vazio.semObras, vazio.motivo]).toEqual([true, 'Nenhuma obra cadastrada nesta fonte.']);
  });
  it('montarProducao nao muta dataset, usuario nem conjunto visivel (entrada congelada) e e deterministico', () => {
    const e = entrada('padrao', 'operacao');
    const antes = JSON.stringify(e);
    congelar(e);
    const m1 = montarProducao(e);
    const m2 = montarProducao(e);
    expect(JSON.stringify(e)).toBe(antes);
    expect(m1).toEqual(m2);
  });
  it('obra sem producao: linha com "sem lista" e "sem ordens", nunca 0 kg nem 0 ordens', () => {
    const m = pronto(montarProducao(entrada('padrao', 'diretoria')));
    const c = m.obras.find((o) => o.codigo === OBRA_C)!;
    expect([c.peso, c.fabricacao, c.montagem, c.composicoes]).toEqual([null, null, null, []]);
  });
  it('sem lista de materiais nas obras visiveis: tiles de peso ausentes; sem ordens de um tipo: "sem ordens"', () => {
    const ds = datasetTeste('padrao');
    const m = pronto(montarProducao(entrada('padrao', 'operacao', { ...ds, conjuntos: [], ordens: ds.ordens.filter((o) => o.tipo === 'Fabricação') })));
    for (const id of ['peso-em-fabrica', 'peso-em-canteiro'] as const) expect(m.tiles[id].numeros[0]).toEqual({ rotulo: m.tiles[id].numeros[0].rotulo, valor: null, texto: TEXTO_SEM_LISTA });
    expect(m.tiles['ordens-andamento'].numeros[1]).toEqual({ rotulo: 'Montagem', valor: null, texto: TEXTO_SEM_ORDENS });
    expect(m.composicoes.peso).toBeUndefined();
  });
  it('responsavel so quando registrado: etapa sem responsavel vira texto proprio; nada e inferido', () => {
    const m = pronto(montarProducao(entrada('padrao', 'operacao')));
    const a2 = m.ordens.todas.find((l) => l.id === 'OF-PP-A2')!;
    expect(a2.responsavelEtapa).toBeUndefined();
    expect(m.composicoes['ordem:OF-PP-A2'].pares.find((p) => p.rotulo === 'Etapa atual')!.sub).toBe('responsável não registrado na etapa');
    expect(m.obras.find((o) => o.codigo === OBRA_B)!.responsavel).toBeUndefined();
    expect(m.obras.find((o) => o.codigo === OBRA_A)!.responsavel).toBe('PILOTO · Gestor da obra A');
    expect(JSON.stringify(m)).not.toMatch(/encarregado da ordem|montador responsável/i);
  });
  it('frescor e sincronizacao sao separados: o estado de sync nunca muda o frescor nem vira "desatualizado"', () => {
    const ds = datasetTeste('padrao');
    const base = pronto(montarProducao(entrada('padrao', 'diretoria', ds)));
    for (const estado of ['sincronizado', 'enviando', 'pendente', 'erro', 'local'] as const) {
      const m = pronto(montarProducao({ ...entrada('padrao', 'diretoria', ds), fonte: { ...FONTE, sincronizacao: { estado } } }));
      expect(m.frescor).toEqual(base.frescor);
      expect(JSON.stringify(m)).not.toMatch(/desatualizad/i);
    }
    expect(Object.keys(ROTULO_SINCRONIZACAO)).toEqual(['sincronizado', 'enviando', 'pendente', 'erro', 'local']);
    expect(base.frescor.ultimoApontamento).toBe('2026-09-22');
  });
});

describe('produtividade, concisao e visoes', () => {
  it('produtividade fica fora dos tiles: nenhum tile de kg/HH; so composicao, rotulada "kg processado por HH"', () => {
    for (const visao of ['diretoria', 'operacao'] as const) {
      const m = pronto(montarProducao(entrada('padrao', visao)));
      expect(JSON.stringify(Object.values(m.tiles))).not.toMatch(/HH|produtiv/i);
      expect(m.composicoes.produtividade.pares.some((p) => p.rotulo.includes(ROTULO_KG_HH))).toBe(true);
      expect(m.composicoes.produtividade.origem.regra).toMatch(/TODAS as estações/);
      expect(m.composicoes.produtividade.nota).toMatch(/kg processado não é kg produzido/);
    }
  });
  it('kg/HH abaixo da meta e fato neutro, sem numero fora da composicao', () => {
    const m = pronto(montarProducao(entrada('padrao')));
    const p = m.pendencias.todas.filter((x) => x.tipo === 'kghh-abaixo-meta');
    expect(p.map((x) => x.id)).toEqual(['kghh-abaixo-meta:Canteiro']);
    expect(p[0].sinal).toBeUndefined();
    expect(p[0].impacto).not.toMatch(/\d+(,\d+)?\s*kg\/HH/);
    expect(p[0].composicaoId).toBe('produtividade');
  });
  it('Diretoria tem 3 tiles e Operacao 4, nos ids aprovados', () => {
    const d = pronto(montarProducao(entrada('padrao', 'diretoria')));
    const o = pronto(montarProducao(entrada('padrao', 'operacao')));
    expect(d.situacao.map((s) => s.id)).toEqual(['peso-fabricado', 'peso-montado', 'ordens-atrasadas']);
    expect(o.situacao.map((s) => s.id)).toEqual(['ordens-andamento', 'ordens-atrasadas', 'peso-em-fabrica', 'peso-em-canteiro']);
    expect(d.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.diretoria);
    expect(o.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.operacao);
  });
  it('Diretoria e Operacao usam os mesmos dados canonicos: a visao so escolhe o que mostrar', () => {
    for (const v of ['padrao', 'subconjunto', 'parcial'] as const) {
      const ds = datasetTeste(v);
      const d = pronto(montarProducao(entrada(v, 'diretoria', ds)));
      const o = pronto(montarProducao(entrada(v, 'operacao', ds)));
      expect(semVisao(d)).toEqual(semVisao(o));
      for (const t of o.situacao) expect(t).toEqual(d.tiles[t.id]);
    }
  });
  it('tetos: pendencias e ordens compactas respeitam o teto e o resto fica em "ver todas"; nada se perde', () => {
    const ds = datasetTeste('padrao');
    const extras: OrdemProducao[] = Array.from({ length: 6 }, (_, i) => ({ ...ds.ordens[0], id: `OF-PP-E${i}`, codigo: `OF-E${i}`, dataNecessidade: undefined }));
    const m = pronto(montarProducao(entrada('padrao', 'operacao', { ...ds, ordens: [...ds.ordens, ...extras] })));
    expect(m.ordens.compacta.length).toBe(TETO_ORDENS);
    expect(m.ordens.ocultas).toBe(m.ordens.todas.length - TETO_ORDENS);
    expect(m.pendencias.compacta.length).toBe(TETO_PENDENCIAS);
    expect(m.pendencias.ocultas).toBe(m.pendencias.todas.length - TETO_PENDENCIAS);
  });
});

describe('guardas estaticas: isolamento, efeitos externos, pilotos existentes intactos', () => {
  const meus = ['producaoCompactoModel.ts', 'producaoCompacto.fixtures.ts', 'ProducaoCompacto.tsx', 'pilotoProducao.css', 'mainProducao.tsx'];
  it('os arquivos do piloto de producao existem e nenhum nome colide, ignorando caixa', () => {
    const todos = fs.readdirSync(pasta);
    for (const f of [...meus, 'producaoCompacto.test.ts']) expect(todos).toContain(f);
    const bases = todos.map((f) => f.replace(/\.(tsx|ts|css)$/, '').toLowerCase());
    expect(new Set(bases).size).toBe(bases.length);
    expect(fs.existsSync(path.resolve('piloto-producao.html'))).toBe(true);
  });
  it('nunca importa store, supabase, offline, telemetria, permissoes, funcoes server-side nem os outros pilotos', () => {
    const proibidos = [/data\/store/, /data\/supabase/, /data\/offline/, /data\/telemetria/, /data\/statusRemoto/, /data\/rede/, /@supabase/, /netlify\//, /ui\/Tabela/, /permissoes/, /obrasVisiveis/, /financeiroCompacto/i, /obrasCompacto/i, /comprasCompacto/i, /pilotoObras/, /pilotoCompras/, /piloto\.css/];
    for (const f of meus) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
  });
  it('nenhum fetch, XHR, WebSocket, beacon, storage, IndexedDB, service worker, setInterval, subscription ou sincronizacao', () => {
    const proibidos = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /serviceWorker/, /localStorage/, /sessionStorage/, /indexedDB/, /navigator\.sendBeacon/, /setInterval/, /\bsubscribe\b/, /EventSource/, /sincronizar\(/];
    for (const f of meus) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
    const html = fs.readFileSync(path.resolve('piloto-producao.html'), 'utf8');
    for (const p of proibidos) expect(html).not.toMatch(p);
  });
  it('o modelo so importa funcoes canonicas de leitura (lista fechada)', () => {
    const vm = fonte('producaoCompactoModel.ts');
    const nomes = (mod: string) => (vm.match(new RegExp(`import \\{([^}]+)\\} from '\\.\\./\\.\\./core/${mod}'`))?.[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean);
    const permitido: Record<string, string[]> = {
      engine: ['addDays', 'calcLancamentos', 'executarChecks', 'fmtBr', 'obra360', 'Obra360'],
      obras: ['resumoProducao', 'OrdemCalc', 'ResumoProducao'],
      materiais: ['resumoPeso', 'ResumoPeso'],
      producao: ['calcRomaneio', 'resumoProdutividade', 'ResumoProdutividade'],
      estoque: ['consumoAco'],
      analise: ['analisarObra', 'Ponto'],
      sugestoes: ['sugestoesPara'],
    };
    for (const [mod, lista] of Object.entries(permitido)) expect(nomes(mod).every((n) => lista.includes(n)), mod).toBe(true);
    const imports = vm.match(/from '[^']+'/g) ?? [];
    expect(imports.every((i) => /from '\.\.\/\.\.\/core\/(engine|obras|materiais|producao|estoque|analise|sugestoes|types)'/.test(i))).toBe(true);
  });
  it('a tela e a entrada so leem e navegam: nenhuma action, gravacao ou botao de apontar, romaneio, excluir, liberar, concluir ou editar', () => {
    for (const f of ['ProducaoCompacto.tsx', 'mainProducao.tsx']) {
      const s = fonte(f);
      for (const p of [/\bactions\./, /persistir/, /salvar[A-Z]/, /registrar[A-Z]/, /apontarEstacao/, /useStore/, /inicializar\(/, /navegar\(/, /\bApontar\b/, /Novo romaneio/, /\bExcluir\b/, /\bLiberar\b/, /\bConcluir\b/, /\bEditar\b/, /\bSalvar\b/, /Avançar etapa/, /\bEmitir\b/]) expect(s, `${f} usa ${p}`).not.toMatch(p);
    }
  });
  it('estilos do piloto de producao ficam sob .piloto-producao (nenhum seletor global nem de outro piloto)', () => {
    const css = fonte('pilotoProducao.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = css.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean).filter((s) => !s.startsWith('@'));
    for (const sel of seletores) for (const parte of sel.split(',')) expect(parte.trim(), `seletor fora do prefixo: ${parte}`).toMatch(/^(\.piloto-producao|\[data-theme="light"\] \.piloto-producao)/);
    expect(css).not.toMatch(/piloto-fin|piloto-obra|piloto-compra/);
  });
  it('a fixture fica fora da tela, do modelo e dos estilos; so a demo isolada (dev) e os testes a usam; o build nao empacota a demo', () => {
    for (const f of ['ProducaoCompacto.tsx', 'producaoCompactoModel.ts', 'pilotoProducao.css']) expect(fonte(f)).not.toMatch(/producaoCompacto\.fixtures|datasetTeste|ROTULO_TESTE/);
    const quemImporta = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? quemImporta(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && /producaoCompacto\.fixtures/.test(fs.readFileSync(path.join(dir, e.name), 'utf8')) ? [path.join(dir, e.name)] : []));
    expect(quemImporta(path.resolve('src')).map((f) => path.basename(f)).sort()).toEqual(['mainProducao.tsx', 'producaoCompacto.test.ts']);
    expect(fonte('producaoCompacto.fixtures.ts')).toMatch(/PILOTO · DADOS DE TESTE/);
    expect(fs.readFileSync(path.resolve('index.html'), 'utf8')).not.toMatch(/piloto-producao|mainProducao/);
    expect(fs.readFileSync(path.resolve('vite.config.ts'), 'utf8')).not.toMatch(/piloto/);
  });
  it('nada fora da pasta referencia o piloto de producao: App, Paleta, Tour, store, permissoes, tipos, core e os outros pilotos seguem intocados', () => {
    for (const f of ['src/App.tsx', 'src/ui/Paleta.tsx', 'src/ui/Tour.tsx', 'src/ui/Sugestoes.tsx', 'src/data/store.ts', 'src/core/permissoes.ts', 'src/core/types.ts', 'src/core/producao.ts', 'src/core/obras.ts', 'src/core/engine.ts', 'src/styles.css']) expect(fs.readFileSync(path.resolve(f), 'utf8'), f).not.toMatch(/ProducaoCompacto|producaoCompacto|piloto-producao|pilotoProducao|mainProducao/);
    // os arquivos dos outros pilotos vem da propria pasta (sem citar os nomes deles aqui: a guarda da UX-P06 procura quem
    // menciona a fixture de compras pelo nome do arquivo)
    const outros = fs.readdirSync(pasta).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/producao/i.test(f));
    expect(outros.length).toBeGreaterThanOrEqual(15);
    for (const f of outros) expect(fonte(f), f).not.toMatch(/ProducaoCompacto|producaoCompacto|piloto-producao|pilotoProducao|mainProducao/);
  });
});

// tipos usados so para garantir que o contrato da fixture e o do Dataset real
const _contrato: Dataset = datasetTeste('padrao');
void _contrato;
