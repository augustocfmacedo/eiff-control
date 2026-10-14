// Forma e dados de pagamento (0072): normalização, validação por forma, resumo e o caminho do pedido ao Diretor Financeiro
// até o título em Lançamentos / Contas a pagar.
import { beforeEach, describe, expect, it } from 'vitest';
import { cpfValido, linhasPagamento, normalizarDadosPagamento, resumoPagamento, validarDadosPagamento } from './pagamento';
import { addDays } from './engine';
import { actions, getState, validarLancamento } from '../data/store';
import { lancamentoDoPedido, type PedidoSolicitante } from '../data/solicitante';

const CNPJ = '11222333000181';
const CPF = '52998224725';
const BOLETO = '23793381286008301234567890123456789012345678'.slice(0, 47).padEnd(47, '1');

describe('regras de forma e dados de pagamento', () => {
  it('CPF com dígito verificador', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
  });

  it('PIX: tipo e chave obrigatórios, formato por tipo; normaliza CPF/CNPJ em dígitos, telefone com +55 e e-mail minúsculo', () => {
    expect(validarDadosPagamento('PIX', {})).toEqual(['Pagamento: escolha o tipo da chave PIX.']);
    expect(validarDadosPagamento('PIX', { pixTipo: 'CNPJ', pixChave: '11.222.333/0001-81' })).toEqual([]);
    expect(validarDadosPagamento('PIX', { pixTipo: 'CNPJ', pixChave: '11.222.333/0001-80' })).toEqual(['Pagamento: chave PIX CNPJ inválida.']);
    expect(validarDadosPagamento('PIX', { pixTipo: 'CPF', pixChave: '529.982.247-25' })).toEqual([]);
    expect(validarDadosPagamento('PIX', { pixTipo: 'E-mail', pixChave: 'financeiro@fornecedor' })).toHaveLength(1);
    expect(validarDadosPagamento('PIX', { pixTipo: 'Aleatória', pixChave: '123e4567-e89b-12d3-a456-426614174000' })).toEqual([]);
    expect(normalizarDadosPagamento('PIX', { pixTipo: 'Telefone', pixChave: '(62) 99999-8888' }).pixChave).toBe('+5562999998888');
    expect(normalizarDadosPagamento('PIX', { pixTipo: 'Telefone', pixChave: '+55 55 99999-8888' }).pixChave).toBe('+5555999998888'); // DDD 55 não perde o país
    expect(validarDadosPagamento('PIX', { pixTipo: 'Telefone', pixChave: '(55) 99999-8888' })).toEqual([]);
    expect(normalizarDadosPagamento('PIX', { pixTipo: 'E-mail', pixChave: ' Fin@Empresa.com.BR ' }).pixChave).toBe('fin@empresa.com.br');
  });

  it('Boleto: 47, 48 ou 44 dígitos; espaços e pontos da linha digitável são ignorados', () => {
    expect(validarDadosPagamento('Boleto', { boletoLinha: BOLETO.replace(/(\d{5})/g, '$1.') })).toEqual([]);
    expect(normalizarDadosPagamento('Boleto', { boletoLinha: '2379 3.38128' }).boletoLinha).toBe('2379338128');
    expect(validarDadosPagamento('Boleto', { boletoLinha: '123' })[0]).toMatch(/3 dígitos/);
    expect(validarDadosPagamento('Boleto', {})).toEqual(['Pagamento: informe a linha digitável do boleto.']);
  });

  it('Transferência: banco, agência, conta, favorecido e CPF/CNPJ válido', () => {
    expect(validarDadosPagamento('Transferência', {})).toHaveLength(5);
    expect(validarDadosPagamento('Transferência', { banco: 'Itaú', agencia: '1234', conta: '56789-0', favorecido: 'Fornecedor Ltda', documentoFavorecido: '11.222.333/0001-81' })).toEqual([]);
    expect(validarDadosPagamento('Transferência', { banco: 'Itaú', agencia: '1234', conta: '56789-0', favorecido: 'X', documentoFavorecido: '123' })).toEqual(['Pagamento: CPF/CNPJ do favorecido inválido.']);
  });

  it('Cartão e Dinheiro não exigem dados; sem forma não há o que validar; campos de outra forma são descartados', () => {
    expect(validarDadosPagamento('Cartão', {})).toEqual([]);
    expect(validarDadosPagamento('Dinheiro', { observacao: 'entregar ao motorista' })).toEqual([]);
    expect(validarDadosPagamento(undefined, { pixChave: 'x' })).toEqual([]);
    expect(normalizarDadosPagamento('Boleto', { pixTipo: 'CPF', pixChave: CPF, boletoLinha: BOLETO })).toEqual({ boletoLinha: BOLETO });
  });

  it('resumo e linhas para copiar', () => {
    expect(resumoPagamento('PIX', { pixTipo: 'CNPJ', pixChave: CNPJ })).toBe('PIX · CNPJ 11.222.333/0001-81');
    expect(resumoPagamento('Transferência', { banco: 'Itaú', agencia: '1234', conta: '56789-0', tipoConta: 'Corrente', favorecido: 'F', documentoFavorecido: CPF })).toBe('Transferência · Itaú ag 1234 cc 56789-0');
    const l = linhasPagamento('Boleto', { boletoLinha: BOLETO, favorecido: 'Banco X' });
    expect(l.find((x) => x.rotulo === 'Linha digitável')).toMatchObject({ copiar: BOLETO });
    expect(linhasPagamento('PIX', { pixTipo: 'CPF', pixChave: CPF }).find((x) => x.rotulo.startsWith('Chave'))).toMatchObject({ valor: '529.982.247-25', copiar: CPF });
  });
});

describe('pedido ao Diretor Financeiro leva a forma de pagamento até o título', () => {
  beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); actions.trocarUsuario('u-obra'); });

  it('o pedido grava forma e dados normalizados; aparecem no lançamento', () => {
    const ds = getState().ds;
    const l = actions.registrarPrevisaoDF({ valor: 480, vencimento: addDays(ds.params.dataBase, 2), categoria: 'Outros custos diretos', codigoObra: ds.obras[0].codigo, contraparte: 'Oficina do Zé', descricao: 'Manutenção', parecer: undefined as never, formaPagamento: 'PIX', dadosPagamento: { pixTipo: 'CNPJ', pixChave: '11.222.333/0001-81', favorecido: 'Oficina do Zé', boletoLinha: 'lixo' } });
    const salvo = getState().ds.lancamentos.find((x) => x.id === l.id)!;
    expect(salvo.formaPagamento).toBe('PIX');
    expect(salvo.dadosPagamento).toEqual({ pixTipo: 'CNPJ', pixChave: CNPJ, favorecido: 'Oficina do Zé' });
  });

  it('dados inválidos recusam o lançamento; entrada não leva forma de pagamento', () => {
    const ds = getState().ds;
    expect(() => actions.registrarPrevisaoDF({ valor: 100, vencimento: addDays(ds.params.dataBase, 2), categoria: 'Outros pagamentos', contraparte: 'X', descricao: 'Boleto ruim', parecer: undefined as never, formaPagamento: 'Boleto', dadosPagamento: { boletoLinha: '123' } })).toThrow(/boleto/);
    const entrada = { ...actions.novoLancamento({ categoria: 'Medições de obras', centroCusto: 'Obra', codigoObra: ds.obras[0].codigo, contraparte: 'Cliente', descricao: 'Medição', valorBruto: 10, vencimento: ds.params.dataBase, competencia: ds.params.dataBase }), formaPagamento: 'PIX' as const, dadosPagamento: { pixTipo: 'CPF' as const, pixChave: CPF } };
    expect(validarLancamento(getState().ds, entrada)).toContain('Forma de pagamento é só para saídas.');
  });

  it('Solicitante: forma e dados vêm na porta df_meus_pedidos', () => {
    const p: PedidoSolicitante = { codigo: 'PED-0009', descricao: 'Frete', contraparte: 'Transp', categoria: 'Outros pagamentos', codigoObra: null, valor: 300, vencimento: '2026-10-20', status: 'Rascunho', motivoCancelamento: null, excluido: false, reagendado: false, criadoEm: '2026-10-14T10:00:00Z', atualizadoEm: '2026-10-14T10:00:00Z', formaPagamento: 'Boleto', dadosPagamento: { boletoLinha: BOLETO } };
    expect(lancamentoDoPedido(p, 'Equipe')).toMatchObject({ formaPagamento: 'Boleto', dadosPagamento: { boletoLinha: BOLETO } });
    expect(lancamentoDoPedido({ ...p, formaPagamento: null, dadosPagamento: null }, 'Equipe').formaPagamento).toBeUndefined();
  });
});
