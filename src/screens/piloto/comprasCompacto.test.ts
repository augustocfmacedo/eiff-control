// UX-P05 — Compras compacto: provas do piloto isolado.
//
// O vitest roda em `environment: 'node'`, sem testing-library: o componente nao e renderizado. O que o piloto DECIDE
// mora em `comprasCompactoModel.ts` (puro) e e provado contra a saida REAL do core sobre a fixture; o que so existe no
// JSX fica preso por guardas estaticas sobre o fonte da pasta.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcPedido, comparativoOrcadoComprado, resumoCompras } from '../../core/compras';
import { calcLancamentos, obra360 } from '../../core/engine';
import { posicaoEstoque } from '../../core/estoque';
import { sugestoesPara } from '../../core/sugestoes';
import type { Dataset, PedidoCompra } from '../../core/types';
import { AUTOR_DESCONHECIDO, DATA_BASE_TESTE, FIXTURE_GERADA_EM, OBRA_A, OBRA_B, OBRA_C, PREFIXO_TESTE, ROTULO_TESTE, TODAS_AS_OBRAS, USUARIO_COMPRAS_A, USUARIO_DIRETORIA, USUARIO_SEM_OBRA, VARIANTES, datasetTeste, entradaDaVariante, type VarianteFixture } from './comprasCompacto.fixtures';
import { ROTULO_PENDENCIA, ROTULO_SINCRONIZACAO, STATUS_EM_ABERTO, TETO_PEDIDOS, TETO_PENDENCIAS, TETO_SITUACAO, TEXTO_CARTEIRA_PARCIAL, TEXTO_ESTOQUE_INDISPONIVEL, TIPOS_PENDENCIA, VISOES, montarCompras, textoEntrega, type EntradaCompras, type ModeloCompras, type Visao } from './comprasCompactoModel';

const AGORA = '2026-09-23T15:00:00.000Z';
const FONTE = { rotulo: ROTULO_TESTE, modo: 'teste' as const, atualizadoEm: FIXTURE_GERADA_EM, id: 'fixture' };
const entrada = (variante: VarianteFixture, visao: Visao = 'diretoria', ds = datasetTeste(variante), visiveis?: string[]): Extract<EntradaCompras, { estado: 'pronto' }> => {
  const e = entradaDaVariante(variante);
  return { estado: 'pronto', fonte: { ...FONTE, id: variante }, ds, usuario: e.usuario, codigosObraVisiveis: visiveis ?? e.codigosObraVisiveis, agora: AGORA, visao };
};
const pronto = (m: ModeloCompras) => { if (m.estado !== 'pronto') throw new Error(`esperava pronto, veio ${m.estado}`); return m; };
function congelar<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v as object)) congelar((v as Record<string, unknown>)[k]); }
  return v;
}
const semVisao = (m: ReturnType<typeof pronto>) => ({ ...m, visao: undefined, situacao: undefined });

describe('fixture: dados de teste identificados', () => {
  it('obras, fornecedores, insumos, pedidos, lancamentos, aprovacao, estoque e usuarios carregam o prefixo do piloto', () => {
    const ds = datasetTeste('padrao');
    expect(ds.params.empresa.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const o of ds.obras) { expect(o.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(o.codigo.startsWith('OB-PC-')).toBe(true); }
    for (const p of ds.pedidos) { expect(p.fornecedor.startsWith(PREFIXO_TESTE)).toBe(true); for (const it of p.itens) expect(it.descricao.startsWith(PREFIXO_TESTE)).toBe(true); }
    for (const i of ds.insumos) expect(i.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const l of ds.lancamentos) expect(l.contraparte.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const a of ds.aprovacoes) expect(a.titulo.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const i of ds.itensEstoque) expect(i.descricao.startsWith(PREFIXO_TESTE)).toBe(true);
    for (const u of ds.usuarios) { expect(u.nome.startsWith(PREFIXO_TESTE)).toBe(true); expect(u.email.endsWith('.invalid')).toBe(true); }
    expect(ds.params.dataBase).toBe(DATA_BASE_TESTE);
  });
  it('nenhum nome real do seed sobrevive', () => {
    const texto = JSON.stringify({ ...datasetTeste('padrao'), radar: undefined, planoContas: undefined });
    for (const real of ['Smart Fit', 'Invest Market', 'OB-SF-CL-01', 'Augusto', 'César Lattes', 'NF 47', 'SFCL', 'ORC-328']) expect(texto.includes(real)).toBe(false);
  });
  it('cobre os cenarios pedidos, provados pela saida do proprio core', () => {
    const ds = datasetTeste('padrao');
    const r = resumoCompras(ds);
    const p = new Map(r.pedidos.map((x) => [x.id, x]));
    expect(p.get('PC-A1')!.status).toBe('Emitido'); expect(p.get('PC-A1')!.atrasado).toBe(false); // normal
    expect(p.get('PC-A2')!.status).toBe('Recebido parcial'); expect(p.get('PC-A2')!.atrasado).toBe(true); // parcial e atrasado
    expect(p.get('PC-A3')!.lancamento?.status).toBe('Pendente'); // aguardando aprovacao
    expect(p.get('PC-A4')!.status).toBe('Rascunho'); expect(p.get('PC-A4')!.previsaoEntrega).toBeUndefined(); // rascunho, sem previsao
    expect(p.get('PC-A4')!.criadoPor).toBe(AUTOR_DESCONHECIDO); // autor ausente
    expect(p.get('PC-A5')!.status).toBe('Recebido'); expect(p.get('PC-A5')!.lancamento?.status).toBe('Realizado'); // recebido e pago
    expect(p.get('PC-B1')!.lancamento?.status).toBe('Rascunho'); expect(p.get('PC-B1')!.ativo).toBe(true); // emitido com lancamento em Rascunho
    expect(p.get('PC-B3')!.status).toBe('Cancelado');
    expect(p.get('PC-B4')!.lancamentoId).toBeDefined(); expect(p.get('PC-B4')!.lancamento).toBeUndefined(); // vinculo ausente
    expect(comparativoOrcadoComprado(ds, OBRA_A).compradoForaOrcamento).toBeGreaterThan(0); // fora do orcamento
    expect(comparativoOrcadoComprado(ds, OBRA_B).orcadoValor).toBe(0); // sem orcamento
    expect(r.pedidos.some((x) => x.codigoObra === OBRA_C)).toBe(false); // obra sem compras
    expect(posicaoEstoque(ds).abaixoMinimo).toBeGreaterThan(0);
    expect(sugestoesPara(`/obras/${OBRA_B}`, ds, USUARIO_DIRETORIA).some((s) => s.id === `obra-${OBRA_B}-direto`)).toBe(true);
  });
  it('datasetTeste devolve sempre um objeto novo; entradaDaVariante cobre todas as variantes', () => {
    expect(datasetTeste('padrao')).not.toBe(datasetTeste('padrao'));
    expect(VARIANTES.map((v) => v.id)).toEqual(['padrao', 'subconjunto', 'parcial', 'nenhuma', 'sem-pedidos', 'vazio']);
    expect(entradaDaVariante('padrao')).toEqual({ usuario: USUARIO_DIRETORIA, codigosObraVisiveis: TODAS_AS_OBRAS });
    expect(entradaDaVariante('subconjunto')).toEqual({ usuario: USUARIO_COMPRAS_A, codigosObraVisiveis: [OBRA_A] });
    expect(entradaDaVariante('parcial').codigosObraVisiveis).toEqual([OBRA_A, OBRA_B]);
    expect(entradaDaVariante('nenhuma')).toEqual({ usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] });
  });
});

describe('paridade com o core (nenhum numero e recalculado no piloto)', () => {
  const ds = datasetTeste('padrao');
  const m = pronto(montarCompras(entrada('padrao', 'operacao', ds)));
  const global = resumoCompras(ds);
  it('calcPedido: total, recebido, percentual, entrega e itens com saldo de cada linha sao os do core', () => {
    for (const l of m.pedidos.todos) {
      const pc = calcPedido(ds.pedidos.find((p) => p.id === l.id)!, ds, ds.params.dataBase);
      expect([l.total, l.totalRecebido, l.pctRecebido, l.atrasado, l.diasParaEntrega, l.previsaoEntrega, l.status]).toEqual([pc.total, pc.totalRecebido, pc.pctRecebido, pc.atrasado, pc.diasParaEntrega, pc.previsaoEntrega, pc.status]);
      expect(l.itensComSaldo).toBe(pc.itens.filter((i) => i.saldoReceber > 0).length);
    }
  });
  it('resumoCompras: com a carteira completa os tiles sao exatamente o resumo global', () => {
    expect(m.carteiraCompleta).toBe(true);
    expect(m.tiles.emitidos.valor).toBe(global.emitido);
    expect(m.tiles.emitidos.partes.map((p) => p.valor)).toEqual([global.recebido, global.aReceber]);
    expect(m.tiles.areceber.valor).toBe(global.aReceber);
    expect(m.tiles.atrasadas.valor).toBe(global.atrasados);
    expect(m.tiles.aprovacao.valor).toBe(global.aguardandoAprovacao);
    expect(m.tiles.rascunhos.valor).toBe(global.rascunhos);
  });
  it('resumoCompras por obra: cada linha de obra e o resumo daquela obra', () => {
    for (const o of m.obras) {
      const r = resumoCompras(ds, o.codigo);
      expect([o.pedidos, o.emitido, o.recebido, o.aReceber, o.atrasados, o.aguardandoAprovacao, o.rascunhos]).toEqual([r.pedidos.length, r.emitido, r.recebido, r.aReceber, r.atrasados, r.aguardandoAprovacao, r.rascunhos]);
    }
    expect(m.obras.map((o) => o.codigo)).toEqual([OBRA_A, OBRA_B]); // obra C nao tem pedido
  });
  it('comparativoOrcadoComprado: a composicao orcado × comprado repete o comparativo, linha a linha', () => {
    for (const cod of [OBRA_A, OBRA_B]) {
      const c = comparativoOrcadoComprado(ds, cod);
      const comp = m.composicoes[`orcado:${cod}`];
      expect(comp.linhas.map((l) => [l.id, l.valor])).toEqual(c.linhas.map((l) => [l.insumoId, l.compradoValor]));
      expect(comp.total!.valor).toBe(c.compradoValor);
    }
  });
  it('obra360 e posicaoEstoque: custo comprometido e estoque vem das funcoes canonicas', () => {
    const lancs = calcLancamentos(ds);
    for (const o of ds.obras.filter((x) => x.codigo !== OBRA_C)) {
      const par = m.composicoes[`obra-compras:${o.codigo}`].pares.find((p) => p.rotulo === 'Custo comprometido')!;
      expect(par.texto).toBe(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(obra360(ds, o, lancs).custoComprometido));
    }
    const e = posicaoEstoque(ds);
    expect(m.estoque).toEqual({ visivel: true, abaixoMinimo: e.abaixoMinimo, saldoKg: e.saldoKg, composicaoId: 'estoque' });
    expect(m.composicoes.estoque.linhas.map((l) => l.id)).toEqual(e.itens.filter((i) => i.abaixoMinimo).map((i) => i.id));
  });
});

describe('conceitos separados', () => {
  const ds = datasetTeste('padrao');
  const m = pronto(montarCompras(entrada('padrao', 'diretoria', ds)));
  it('emitido != comprometido: rotulos distintos, cada um com a sua funcao; o piloto nunca calcula a diferenca', () => {
    expect(m.tiles.emitidos.rotulo).toBe('Pedidos emitidos');
    for (const t of Object.values(m.tiles)) expect(t.rotulo.toLowerCase()).not.toContain('comprometido');
    const comp = m.composicoes[`obra-compras:${OBRA_A}`];
    const emit = comp.pares.find((p) => p.rotulo === 'Pedidos emitidos')!;
    const compr = comp.pares.find((p) => p.rotulo === 'Custo comprometido')!;
    expect(emit.sub).toMatch(/resumoCompras\.emitido/);
    expect(compr.sub).toMatch(/obra360\.custoComprometido/);
    // a fixture revela a divergencia real do core: os dois valores diferem e nenhum par "diferenca" existe
    expect(resumoCompras(ds, OBRA_A).emitido).not.toBe(obra360(ds, ds.obras[0]).custoComprometido);
    expect(comp.pares.some((p) => /diferen|diverg|delta|gap/i.test(p.rotulo))).toBe(false);
    // o pedido com lancamento Pendente aparece como "nao entra no custo comprometido", sem corrigir o numero
    expect(comp.linhas.find((l) => l.id === 'PC-A3')!.sub).toMatch(/Pendente · não entra no custo comprometido/);
  });
  it('recebido != pago: material recebido e status do lancamento ficam separados; nada e rotulado como pago', () => {
    const txt = JSON.stringify(m);
    expect(txt).not.toMatch(/\bpago\b|\bPago\b/);
    const a5 = m.composicoes['pedido:PC-A5'];
    expect(a5.pares.find((p) => p.rotulo === 'Recebido (material)')!.sub).toMatch(/Não é pagamento/);
    expect(a5.pares.find((p) => p.rotulo === 'Lançamento')!.texto).toMatch(/Realizado/);
    expect(m.composicoes['pedido:PC-A2'].pares.find((p) => p.rotulo === 'Lançamento')!.texto).toMatch(/Programado/);
  });
  it('pedido != lancamento: sem lancamento, lancamento ausente e lancamento existente sao estados distintos', () => {
    const op = pronto(montarCompras(entrada('padrao', 'operacao', ds)));
    const l = new Map(op.pedidos.todos.map((x) => [x.id, x]));
    expect(l.get('PC-A4')!.lancamento).toBeUndefined();
    expect(l.get('PC-B4')!.lancamento).toBeNull();
    expect(l.get('PC-A1')!.lancamento).toEqual({ id: 'L-PC-A1', status: 'Programado', oficial: true });
    expect(l.get('PC-B1')!.lancamento).toEqual({ id: 'L-PC-B1', status: 'Rascunho', oficial: false });
  });
  it('pedido emitido com lancamento em Rascunho aparece como fato, sem afirmar rejeicao', () => {
    const p = m.pendencias.todas.find((x) => x.id === 'lancamento-rascunho:PC-B1')!;
    expect(ROTULO_PENDENCIA[p.tipo]).toBe('Pedido emitido · lançamento em Rascunho');
    expect(JSON.stringify(m)).not.toMatch(/rejeitad|recusad/i);
  });
  it('"criado por" continua "criado por": nunca comprador, solicitante ou responsavel da compra', () => {
    const op = pronto(montarCompras(entrada('padrao', 'operacao', ds)));
    expect(op.composicoes['pedido:PC-A1'].pares.some((p) => p.rotulo === 'Criado por')).toBe(true);
    const txt = JSON.stringify(op) + fs.readFileSync(path.resolve('src/screens/piloto/ComprasCompacto.tsx'), 'utf8');
    expect(txt).not.toMatch(/comprador|solicitante|responsável da compra/i);
  });
});

describe('sem severidade, sem score, sem necessidade', () => {
  const ds = datasetTeste('padrao');
  const m = pronto(montarCompras(entrada('padrao', 'diretoria', ds)));
  const vm = fs.readFileSync(path.resolve('src/screens/piloto/comprasCompactoModel.ts'), 'utf8');
  const codigoVm = vm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
  it('nenhum tile tem tom; pendencias so tem tom quando vem de sugestao canonica, e com o mesmo tom', () => {
    for (const t of Object.values(m.tiles)) expect('tom' in t).toBe(false);
    for (const p of m.pendencias.todas) {
      if (p.tipo !== 'sugestao-direto') { expect(p.tom).toBeUndefined(); continue; }
      const s = sugestoesPara(`/obras/${p.obra}`, ds, USUARIO_DIRETORIA).find((x) => x.id === `obra-${p.obra}-direto`)!;
      expect(p.tom).toBe(s.tom);
    }
  });
  it('rotulos neutros: nada de "Precisa de ação", "Atenção", "Acompanhar", crítico, risco ou urgente', () => {
    const rotulos = [...Object.values(ROTULO_PENDENCIA), ...Object.values(m.tiles).map((t) => t.rotulo), ...VISOES.map((v) => v.descricao)].join(' | ');
    expect(rotulos).not.toMatch(/Precisa de ação|Atenção|Acompanhar|crític|risco|urgent|grave/i);
  });
  it('o modelo nao atribui severidade nem score: nenhum literal de tom e nenhuma pontuacao no codigo', () => {
    expect(codigoVm).not.toMatch(/tom:\s*''/); // literais viram '' acima: qualquer tom literal apareceria assim
    expect(codigoVm.match(/tom:/g)?.length ?? 0).toBe(1); // o unico e `tom: s.tom` (sugestao canonica)
    expect(codigoVm).toMatch(/tom: s\.tom/);
    expect(codigoVm).not.toMatch(/score|pontua|peso\s*\*|severidade/i);
  });
  it('as pendencias seguem a ordem do catalogo (nao prioridade) e cada tipo pertence ao catalogo', () => {
    const idx = m.pendencias.todas.map((p) => TIPOS_PENDENCIA.indexOf(p.tipo));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('nenhuma necessidade liquida: sem orcado − comprado, sem "precisa comprar", "faltante" ou "bloqueado"', () => {
    expect(codigoVm).not.toMatch(/orcadoQtd\s*-|compradoQtd\s*-|orcadoValor\s*-|-\s*compradoQtd|-\s*compradoValor/);
    expect(JSON.stringify(m)).not.toMatch(/precisa comprar|faltante|bloquead|falta de material|falta líquida|necessidade não coberta/i);
    // o unico "saldo" de quantidade e o saldoReceber do item, vindo do core
    const a2 = m.composicoes['pedido:PC-A2'].linhas[0];
    expect(a2.sub).toMatch(/saldo a receber 1\.500 kg/);
  });
});

describe('visibilidade e contrato de entrada (nao e ACL)', () => {
  it('subconjunto de uma obra: nenhum pedido, obra, composicao ou pendencia de outra obra aparece; valores sao os daquela obra', () => {
    const ds = datasetTeste('subconjunto');
    for (const visao of ['diretoria', 'operacao'] as const) {
      const m = pronto(montarCompras(entrada('subconjunto', visao, ds)));
      expect(m.carteiraCompleta).toBe(false);
      const txt = JSON.stringify(m);
      expect(txt).not.toMatch(/OB-PC-B|OB-PC-C|PC-B\d|Mezanino|Cobertura/);
      expect(m.tiles.emitidos.valor).toBe(resumoCompras(ds, OBRA_A).emitido);
      expect(m.tiles.emitidos.micro).toBe(`somente ${OBRA_A}`);
      expect(m.tiles.atrasadas.valor).toBe(resumoCompras(ds, OBRA_A).atrasados);
      expect(m.tiles.atrasadas.micro).toMatch(new RegExp(`somente ${OBRA_A}$`));
    }
  });
  it('carteira parcial com mais de uma obra: valores e contagens ficam "carteira inteira não visível"; nada e somado entre obras e os numeros seguem por obra', () => {
    const ds = datasetTeste('parcial');
    const m = pronto(montarCompras(entrada('parcial', 'operacao', ds)));
    for (const t of Object.values(m.tiles)) {
      expect(t.valor).toBeNull();
      expect(t.texto).toBe(TEXTO_CARTEIRA_PARCIAL);
      expect(t.partes.every((p) => p.valor === null)).toBe(true);
    }
    const soma = resumoCompras(ds, OBRA_A).emitido + resumoCompras(ds, OBRA_B).emitido;
    expect(JSON.stringify(m.tiles)).not.toContain(String(soma));
    // os numeros continuam disponiveis, por obra, exatamente como resumoCompras(ds, obra)
    for (const o of pronto(montarCompras(entrada('parcial', 'diretoria', ds))).obras) expect([o.atrasados, o.aguardandoAprovacao, o.rascunhos]).toEqual([resumoCompras(ds, o.codigo).atrasados, resumoCompras(ds, o.codigo).aguardandoAprovacao, resumoCompras(ds, o.codigo).rascunhos]);
    // e o codigo do modelo nao acumula resultados de varias obras
    const codigoVm = fs.readFileSync(path.resolve('src/screens/piloto/comprasCompactoModel.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(codigoVm).not.toMatch(/obrasVis\.reduce|porObra\.get\([^)]*\)!?\.\w+\s*\+/);
  });
  it('estoque global so com a carteira completa; com subconjunto nao aparece nem na composicao do pedido', () => {
    for (const v of ['subconjunto', 'parcial'] as const) {
      const m = pronto(montarCompras(entrada(v, 'diretoria')));
      expect(m.estoque).toEqual({ visivel: false, motivo: TEXTO_ESTOQUE_INDISPONIVEL });
      expect(m.composicoes.estoque).toBeUndefined();
      expect(m.pendencias.todas.some((p) => p.tipo === 'estoque-minimo')).toBe(false);
      expect(m.composicoes['pedido:PC-A1'].linhas[0].sub).not.toMatch(/estoque/);
      expect(m.frescor.chips.some((c) => c.id === 'estoque')).toBe(false);
    }
    const completo = pronto(montarCompras(entrada('padrao', 'diretoria')));
    expect(completo.composicoes['pedido:PC-A1'].linhas[0].sub).toMatch(/estoque de aço \(global\)/);
  });
  it('unidades nao se misturam: item pedido em outra unidade nunca recebe o saldo do estoque em kg, mesmo com item de estoque do mesmo insumo', () => {
    const ds = datasetTeste('padrao');
    const comParafuso = { ...ds, itensEstoque: [...ds.itensEstoque, { ...ds.itensEstoque[0], id: 'IE-PC-9', codigo: 'PC-PARAF-KG', insumoId: 'INS-PC-3' }] };
    const m = pronto(montarCompras(entrada('padrao', 'diretoria', comParafuso)));
    const itens = m.composicoes['pedido:PC-A2'].linhas;
    expect(itens[0].sub).toMatch(/pedido 3\.000 kg/);
    expect(itens[0].sub).toMatch(/estoque de aço \(global\)/);
    expect(itens[1].sub).toMatch(/pedido 200 un/);
    expect(itens[1].sub).not.toMatch(/estoque|kg/);
  });
  it('carteira completa exige tambem que todo pedido esteja numa obra visivel', () => {
    const ds = datasetTeste('padrao');
    const orfao: PedidoCompra = { ...ds.pedidos[0], id: 'PC-X1', codigo: 'PC-X1', codigoObra: 'OB-FORA', lancamentoId: undefined };
    const m = pronto(montarCompras(entrada('padrao', 'diretoria', { ...ds, pedidos: [...ds.pedidos, orfao] })));
    expect(m.carteiraCompleta).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/PC-X1|OB-FORA/);
  });
  it('nenhuma obra visivel → estado proprio; codigo desconhecido e ignorado e nunca inventa obra', () => {
    const nenhuma = montarCompras(entrada('nenhuma'));
    expect(nenhuma.estado).toBe('sem-visibilidade');
    if (nenhuma.estado === 'sem-visibilidade') expect(nenhuma.totalObras).toBe(3);
    expect(montarCompras(entrada('padrao', 'diretoria', datasetTeste('padrao'), ['OB-DESCONHECIDA'])).estado).toBe('sem-visibilidade');
    const comDesconhecido = pronto(montarCompras(entrada('padrao', 'diretoria', datasetTeste('padrao'), [OBRA_A, 'OB-DESCONHECIDA'])));
    const soA = pronto(montarCompras(entrada('subconjunto', 'diretoria')));
    expect({ ...comDesconhecido, usuario: undefined, fonte: undefined }).toEqual({ ...soA, usuario: undefined, fonte: undefined });
  });
  it('o modelo nao consulta usuario.obras nem papel: o mesmo conjunto com outro usuario da os mesmos numeros', () => {
    const ds = datasetTeste('padrao');
    const a = pronto(montarCompras({ ...entrada('padrao', 'diretoria', ds, [OBRA_A]), usuario: USUARIO_SEM_OBRA }));
    const b = pronto(montarCompras({ ...entrada('padrao', 'diretoria', ds, [OBRA_A]), usuario: USUARIO_DIRETORIA }));
    expect(a.tiles).toEqual(b.tiles);
    expect(a.obras).toEqual(b.obras);
  });
});

describe('estados, entrada preservada e ausente != zero', () => {
  it('carregando e erro passam intactos; sem pedidos e sem obras viram vazio com motivo', () => {
    expect(montarCompras({ estado: 'carregando', fonte: FONTE })).toEqual({ estado: 'carregando', fonte: FONTE });
    expect(montarCompras({ estado: 'erro', fonte: FONTE, mensagem: 'x', causa: 'y' })).toEqual({ estado: 'erro', fonte: FONTE, mensagem: 'x', causa: 'y' });
    const semPedidos = montarCompras(entrada('sem-pedidos'));
    expect(semPedidos.estado === 'vazio' && [semPedidos.semObras, semPedidos.motivo]).toEqual([false, 'Nenhum pedido de compra nas obras visíveis.']);
    const vazio = montarCompras(entrada('vazio'));
    expect(vazio.estado === 'vazio' && [vazio.semObras, vazio.motivo]).toEqual([true, 'Nenhuma obra cadastrada nesta fonte.']);
  });
  it('montarCompras nao muta dataset, usuario nem conjunto visivel (entrada congelada) e e deterministico', () => {
    const e = entrada('padrao', 'operacao');
    const antes = JSON.stringify(e);
    congelar(e);
    const m1 = montarCompras(e);
    const m2 = montarCompras(e);
    expect(JSON.stringify(e)).toBe(antes);
    expect(m1).toEqual(m2);
  });
  it('ausencias viram texto proprio, nunca zero ou nome inventado', () => {
    const m = pronto(montarCompras(entrada('padrao', 'operacao')));
    const a4 = m.pedidos.todos.find((p) => p.id === 'PC-A4')!;
    expect(a4.previsaoEntrega).toBeUndefined();
    expect(a4.diasParaEntrega).toBeUndefined();
    expect(textoEntrega(a4.previsaoEntrega, a4.diasParaEntrega)).toBe('sem previsão de entrega');
    expect(a4.criadoPor).toEqual({ id: AUTOR_DESCONHECIDO, nome: undefined });
    expect(m.composicoes['pedido:PC-A4'].pares.find((p) => p.rotulo === 'Criado por')!.texto).toBe(`usuário não encontrado (${AUTOR_DESCONHECIDO})`);
    const orcB = m.composicoes[`orcado:${OBRA_B}`];
    expect(orcB.pares.find((p) => p.rotulo === 'Orçado')!.texto).toBe('sem orçamento contratado');
    expect(orcB.pares.find((p) => p.rotulo === 'Comprado do orçado')!.texto).toBe('—');
    expect(m.composicoes['pedido:PC-A3'].linhas[0].sub).toMatch(/sem preço de catálogo/);
    expect(m.composicoes['pedido:PC-B4'].pares.find((p) => p.rotulo === 'Lançamento')!.texto).toBe('vínculo L-PC-INEXISTENTE não encontrado');
  });
  it('frescor e sincronizacao sao separados: o estado de sync nunca muda o frescor nem vira "desatualizado"', () => {
    const ds = datasetTeste('padrao');
    const base = pronto(montarCompras(entrada('padrao', 'diretoria', ds)));
    for (const estado of ['sincronizado', 'enviando', 'pendente', 'erro', 'local'] as const) {
      const m = pronto(montarCompras({ ...entrada('padrao', 'diretoria', ds), fonte: { ...FONTE, sincronizacao: { estado } } }));
      expect(m.frescor).toEqual(base.frescor);
      expect(JSON.stringify(m)).not.toMatch(/desatualizad/i);
    }
    expect(Object.keys(ROTULO_SINCRONIZACAO)).toEqual(['sincronizado', 'enviando', 'pendente', 'erro', 'local']);
  });
});

describe('concisao e visoes', () => {
  it('Diretoria tem 3 tiles e Operacao 4, todos canonicos', () => {
    const d = pronto(montarCompras(entrada('padrao', 'diretoria')));
    const o = pronto(montarCompras(entrada('padrao', 'operacao')));
    expect(d.situacao.map((s) => s.id)).toEqual(['emitidos', 'atrasadas', 'aprovacao']);
    expect(o.situacao.map((s) => s.id)).toEqual(['rascunhos', 'aprovacao', 'areceber', 'atrasadas']);
    expect(d.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.diretoria);
    expect(o.situacao.length).toBeLessThanOrEqual(TETO_SITUACAO.operacao);
  });
  it('Diretoria e Operacao usam os mesmos valores canonicos: a visao so escolhe o que mostrar', () => {
    for (const v of ['padrao', 'subconjunto', 'parcial'] as const) {
      const ds = datasetTeste(v);
      const d = pronto(montarCompras(entrada(v, 'diretoria', ds)));
      const o = pronto(montarCompras(entrada(v, 'operacao', ds)));
      expect(semVisao(d)).toEqual(semVisao(o));
      for (const t of o.situacao) expect(t).toEqual(d.tiles[t.id]);
    }
  });
  it('tetos: pendencias e pedidos compactos respeitam o teto e o resto fica em "ver todos"; nada se perde', () => {
    const ds = datasetTeste('padrao');
    const extras: PedidoCompra[] = Array.from({ length: 10 }, (_, i) => ({ ...ds.pedidos[0], id: `PC-A9${i}`, codigo: `PC-A9${i}`, status: 'Rascunho', lancamentoId: undefined, previsaoEntrega: undefined }));
    const m = pronto(montarCompras(entrada('padrao', 'operacao', { ...ds, pedidos: [...ds.pedidos, ...extras] })));
    expect(m.pedidos.compacta.length).toBe(TETO_PEDIDOS);
    expect(m.pedidos.ocultos).toBe(m.pedidos.todos.length - TETO_PEDIDOS);
    expect(m.pendencias.compacta.length).toBe(TETO_PENDENCIAS);
    expect(m.pendencias.ocultas).toBe(m.pendencias.todas.length - TETO_PENDENCIAS);
    expect(m.pedidos.todos.every((p) => STATUS_EM_ABERTO.includes(p.status))).toBe(true);
    expect(m.pedidos.todos.some((p) => p.status === 'Recebido' || p.status === 'Cancelado')).toBe(false);
  });
});

describe('guardas estaticas: isolamento, imports proibidos, pilotos existentes intactos', () => {
  const pasta = path.resolve('src/screens/piloto');
  const meus = ['comprasCompactoModel.ts', 'comprasCompacto.fixtures.ts', 'ComprasCompacto.tsx', 'pilotoCompras.css', 'mainCompras.tsx'];
  const fonte = (f: string) => fs.readFileSync(path.join(pasta, f), 'utf8');

  it('os arquivos do piloto de compras existem e nenhum nome colide, ignorando caixa', () => {
    const todos = fs.readdirSync(pasta);
    for (const f of [...meus, 'comprasCompacto.test.ts']) expect(todos).toContain(f);
    const bases = todos.map((f) => f.replace(/\.(tsx|ts|css)$/, '').toLowerCase());
    expect(new Set(bases).size).toBe(bases.length);
    expect(fs.existsSync(path.resolve('piloto-compras.html'))).toBe(true);
  });
  it('nunca importa store, supabase, offline, telemetria, permissoes, funcoes server-side nem os outros pilotos', () => {
    const proibidos = [/data\/store/, /data\/supabase/, /data\/offline/, /data\/telemetria/, /data\/statusRemoto/, /data\/rede/, /@supabase/, /netlify\//, /ui\/Tabela/, /permissoes/, /obrasVisiveis/, /financeiroCompacto/, /FinanceiroCompacto/, /obrasCompacto/, /ObrasCompacto/, /pilotoObras/, /piloto\.css/];
    for (const f of meus) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
  });
  it('nenhum fetch, XHR, WebSocket, beacon, storage, service worker, setInterval, subscription ou sincronizacao', () => {
    const proibidos = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /serviceWorker/, /localStorage/, /sessionStorage/, /indexedDB/, /navigator\.sendBeacon/, /setInterval/, /\bsubscribe\b/, /EventSource/, /sincronizar\(/];
    for (const f of [...meus]) for (const p of proibidos) expect(fonte(f), `${f} usa ${p}`).not.toMatch(p);
    const html = fs.readFileSync(path.resolve('piloto-compras.html'), 'utf8');
    for (const p of proibidos) expect(html).not.toMatch(p);
  });
  it('o modelo so importa funcoes canonicas de leitura (lista fechada)', () => {
    const vm = fonte('comprasCompactoModel.ts');
    const nomes = (mod: string) => (vm.match(new RegExp(`import \\{([^}]+)\\} from '\\.\\./\\.\\./core/${mod}'`))?.[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean);
    expect(nomes('engine').every((n) => ['calcLancamentos', 'fmtBr', 'obra360', 'LancamentoCalc'].includes(n))).toBe(true);
    expect(nomes('compras').every((n) => ['comparativoOrcadoComprado', 'resumoCompras', 'Comparativo', 'PedidoCalc', 'ResumoCompras'].includes(n))).toBe(true);
    expect(nomes('estoque').every((n) => ['posicaoEstoque', 'PosicaoEstoque'].includes(n))).toBe(true);
    expect(nomes('sugestoes').every((n) => ['sugestoesPara', 'Sugestao'].includes(n))).toBe(true);
    const imports = vm.match(/from '[^']+'/g) ?? [];
    expect(imports.every((i) => /from '\.\.\/\.\.\/core\/(engine|compras|estoque|sugestoes|types)'/.test(i))).toBe(true);
  });
  it('a tela e a entrada so leem e navegam: nenhuma action, gravacao ou botao de emitir/receber/cancelar/aprovar/editar/salvar', () => {
    for (const f of ['ComprasCompacto.tsx', 'mainCompras.tsx']) {
      const s = fonte(f);
      for (const p of [/\bactions\./, /persistir/, /salvar[A-Z]/, /registrar[A-Z]/, /useStore/, /inicializar\(/, /navegar\(/, /\bEmitir\b/, /\bReceber\b/, /\bCancelar\b/, /\bAprovar\b/, /\bEditar\b/, /\bSalvar\b/, /\bNovo pedido\b/]) expect(s, `${f} usa ${p}`).not.toMatch(p);
    }
  });
  it('estilos do piloto de compras ficam sob .piloto-compra (nenhum seletor global nem de outro piloto)', () => {
    const css = fonte('pilotoCompras.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = css.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean).filter((s) => !s.startsWith('@'));
    for (const sel of seletores) for (const parte of sel.split(',')) expect(parte.trim(), `seletor fora do prefixo: ${parte}`).toMatch(/^(\.piloto-compra|\[data-theme="light"\] \.piloto-compra)/);
    expect(css).not.toMatch(/piloto-fin|piloto-obra/);
  });
  it('a fixture fica fora da tela e do modelo; so a demo isolada (dev) e os testes a usam; o build nao empacota a demo', () => {
    for (const f of ['ComprasCompacto.tsx', 'comprasCompactoModel.ts', 'pilotoCompras.css']) expect(fonte(f)).not.toMatch(/comprasCompacto\.fixtures|datasetTeste|ROTULO_TESTE/);
    expect(fonte('mainCompras.tsx')).toMatch(/comprasCompacto\.fixtures/);
    const index = fs.readFileSync(path.resolve('index.html'), 'utf8');
    expect(index).not.toMatch(/piloto-compras|mainCompras/);
  });
  it('nada fora da pasta referencia o piloto de compras: App, Paleta, Tour, store, permissoes e os outros pilotos seguem intocados', () => {
    for (const f of ['src/App.tsx', 'src/ui/Paleta.tsx', 'src/ui/Tour.tsx', 'src/ui/Sugestoes.tsx', 'src/data/store.ts', 'src/core/permissoes.ts', 'src/core/types.ts', 'src/core/compras.ts', 'src/styles.css']) expect(fs.readFileSync(path.resolve(f), 'utf8'), f).not.toMatch(/ComprasCompacto|comprasCompacto|piloto-compra|pilotoCompras/);
    for (const f of ['FinanceiroCompacto.tsx', 'financeiroCompactoModel.ts', 'financeiroCompacto.fixtures.ts', 'financeiroCompacto.test.ts', 'piloto.css', 'ObrasCompacto.tsx', 'obrasCompactoModel.ts', 'obrasCompacto.fixtures.ts', 'obrasCompacto.test.ts', 'pilotoObras.css']) expect(fonte(f), f).not.toMatch(/ComprasCompacto|comprasCompacto|piloto-compra|pilotoCompras/);
  });
});

// tipos usados so para garantir que o contrato da fixture e o do Dataset real
const _contrato: Dataset = datasetTeste('padrao');
void _contrato;
