// Documentos dos pedidos de pagamento (0073): quem anexa o quê, validação do arquivo, remoção lógica, o que falta e o aviso
// de pedido pago sem comprovante.
import { beforeEach, describe, expect, it } from 'vitest';
import { anexosDe, mimeDoArquivo, pendenciasDocumentos, podeRemoverAnexo, podeVerAnexos, tiposQuePodeAnexar, validarArquivoAnexo } from './anexos';
import { addDays } from './engine';
import { sugestoesPara } from './sugestoes';
import { RegraDeNegocioError, actions, getState } from '../data/store';
import { anexosDosPedidos, datasetSolicitante, type PedidoSolicitante } from '../data/solicitante';

const PDF = { nome: 'NF 123.pdf', mime: 'application/pdf', tamanho: 2048, dados: 'data:application/pdf;base64,JVBERi0=' };
const lanc = (id: string) => getState().ds.lancamentos.find((x) => x.id === id)!;
function pedir(descricao = 'Frete de chapas', valor = 500) {
  actions.trocarUsuario('u-obra');
  const ds = getState().ds;
  return actions.registrarPrevisaoDF({ valor, vencimento: addDays(ds.params.dataBase, 2), categoria: 'Outros custos diretos', codigoObra: ds.obras[0].codigo, contraparte: 'Transportadora', descricao, parecer: undefined as never });
}

describe('regras dos documentos', () => {
  it('arquivo: PDF ou imagem até 10 MB; tipo pela extensão quando o navegador não informa (iPhone)', () => {
    expect(validarArquivoAnexo({ name: 'nf.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
    expect(validarArquivoAnexo({ name: 'foto.HEIC', type: '', size: 1000 })).toBeNull();
    expect(mimeDoArquivo({ name: 'foto.HEIC', type: '' })).toBe('image/heic');
    expect(validarArquivoAnexo({ name: 'planilha.xlsx', type: 'application/vnd.ms-excel', size: 1000 })).toMatch(/PDF ou imagem/);
    expect(validarArquivoAnexo({ name: 'grande.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/limite é 10 MB/);
    expect(validarArquivoAnexo({ name: 'vazio.pdf', type: 'application/pdf', size: 0 })).toMatch(/vazio/);
  });
});

describe('documentos no pedido de pagamento', () => {
  beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('quem pediu anexa nota fiscal e boleto, mas não o comprovante; quem paga anexa tudo', async () => {
    const l = pedir();
    const u = getState().usuario;
    expect(tiposQuePodeAnexar(u, l)).toEqual(['NOTA_FISCAL', 'BOLETO', 'OUTRO']);
    const nf = await actions.anexarDocumento(l.id, 'NOTA_FISCAL', PDF);
    expect(nf).toMatchObject({ lancamentoId: l.id, tipo: 'NOTA_FISCAL', nome: 'NF 123.pdf', enviadoPor: 'Gestor Smart Fit' });
    await expect(actions.anexarDocumento(l.id, 'COMPROVANTE', PDF)).rejects.toThrow(/quem paga/);
    actions.trocarUsuario('u-fin');
    expect(tiposQuePodeAnexar(getState().usuario, l)).toContain('COMPROVANTE');
    await actions.anexarDocumento(l.id, 'COMPROVANTE', { ...PDF, nome: 'comprovante.pdf' });
    expect(anexosDe(getState().ds, l.id).map((a) => a.tipo)).toEqual(['NOTA_FISCAL', 'COMPROVANTE']);
    expect(getState().ds.auditoria.filter((x) => x.acao === 'anexar_documento' && x.entidadeId === l.id)).toHaveLength(2);
  });

  it('outra pessoa da equipe não vê nem anexa; Contabilidade vê mas não anexa; cancelado não recebe documento', async () => {
    const l = pedir();
    actions.trocarUsuario('u-eng');
    expect(podeVerAnexos(getState().usuario, l)).toBe(false);
    await expect(actions.anexarDocumento(l.id, 'NOTA_FISCAL', PDF)).rejects.toThrow(RegraDeNegocioError);
    actions.trocarUsuario('u-contab');
    expect(podeVerAnexos(getState().usuario, l)).toBe(true);
    expect(tiposQuePodeAnexar(getState().usuario, l)).toEqual([]);
    actions.trocarUsuario('u-admin');
    actions.decidirPrevisaoDF(l.id, 'recusar', { motivo: 'sem nota' });
    expect(tiposQuePodeAnexar(getState().usuario, lanc(l.id))).toEqual([]);
  });

  it('remoção lógica com motivo: quem enviou remove antes do pagamento; depois de pago só o Financeiro', async () => {
    const l = pedir();
    const nf = await actions.anexarDocumento(l.id, 'NOTA_FISCAL', PDF);
    await expect(actions.removerDocumento(nf.id, '')).rejects.toThrow(/motivo/);
    await actions.removerDocumento(nf.id, 'arquivo errado');
    expect(anexosDe(getState().ds, l.id)).toHaveLength(0);
    expect(getState().ds.anexosLancamento?.find((a) => a.id === nf.id)).toMatchObject({ motivoRemocao: 'arquivo errado', removidoPor: 'Gestor Smart Fit' });
    const boleto = await actions.anexarDocumento(l.id, 'BOLETO', { ...PDF, nome: 'boleto.pdf' });
    expect(podeRemoverAnexo(getState().usuario, boleto, { ...lanc(l.id), status: 'Realizado' })).toBe(false);
    actions.trocarUsuario('u-fin');
    expect(podeRemoverAnexo(getState().usuario, boleto, { ...lanc(l.id), status: 'Realizado' })).toBe(true);
  });

  it('o que falta: boleto quando a forma é boleto; comprovante depois de pago; aviso para quem paga', async () => {
    const l = pedir();
    const comBoleto = { ...lanc(l.id), formaPagamento: 'Boleto' as const };
    expect(pendenciasDocumentos(getState().ds, comBoleto)).toEqual(['boleto']);
    const pago = { ...lanc(l.id), status: 'Realizado' as const };
    expect(pendenciasDocumentos(getState().ds, pago)).toEqual(['comprovante de pagamento']);
    actions.trocarUsuario('u-admin');
    const ds = { ...getState().ds, lancamentos: getState().ds.lancamentos.map((x) => (x.id === l.id ? pago : x)) };
    const s = sugestoesPara('/pagar', ds, getState().usuario);
    expect(s.find((x) => x.id === 'df-sem-comprovante')).toMatchObject({ acao: { to: `/lancamentos/${l.id}` } });
    const comComprovante = { ...ds, anexosLancamento: [{ id: 'x', lancamentoId: l.id, tipo: 'COMPROVANTE' as const, nome: 'c.pdf', mime: 'application/pdf', tamanho: 1, enviadoPor: 'Administrador', enviadoEm: '2026-10-14T10:00:00Z' }] };
    expect(sugestoesPara('/pagar', comComprovante, getState().usuario).some((x) => x.id === 'df-sem-comprovante')).toBe(false);
  });

  it('Solicitante: documentos vêm com os pedidos pela porta df_meus_pedidos', () => {
    const p: PedidoSolicitante = {
      codigo: 'PED-0003', descricao: 'Frete', contraparte: 'Transp', categoria: 'Outros pagamentos', codigoObra: null, valor: 300, vencimento: '2026-10-20', status: 'Realizado', motivoCancelamento: null, excluido: false, reagendado: false, criadoEm: '2026-10-14T10:00:00Z', atualizadoEm: '2026-10-14T10:00:00Z',
      anexos: [{ id: 'a1', codigo: 'PED-0003', tipo: 'COMPROVANTE', nome: 'comprovante.pdf', caminho: 'org/ent/x.pdf', mime: 'application/pdf', tamanho: 5000, enviadoPor: 'Admin', enviadoPorId: 'u1', enviadoEm: '2026-10-14T12:00:00Z', removidoEm: null, removidoPor: null, motivoRemocao: null }],
    };
    expect(anexosDosPedidos([p])).toEqual([expect.objectContaining({ lancamentoId: 'PED-0003', tipo: 'COMPROVANTE', caminho: 'org/ent/x.pdf' })]);
    const { ds, usuario } = datasetSolicitante({ perfil: { id: 's', nome: 'Equipe', email: 'e@t', papel: 'Solicitante' }, organizacao: 'o', categorias: [{ categoria: 'Outros pagamentos', grupoFluxo: 'g' }], obras: [] }, [p], '2026-10-14');
    const l = ds.lancamentos[0];
    expect(podeVerAnexos(usuario, l)).toBe(true);
    expect(anexosDe(ds, 'PED-0003')).toHaveLength(1);
    expect(tiposQuePodeAnexar(usuario, l)).toEqual(['NOTA_FISCAL', 'BOLETO', 'OUTRO']);
  });
});
