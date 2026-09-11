import fs from 'node:fs';
// Ponte de permissoes da Central: a autorizacao e a MATRIZ do EIFF Control, nunca uma segunda ACL.
// REGRA DEFINITIVA: a INTENCAO escolhe o AGENTE; a ACAO PROPOSTA escolhe a PERMISSAO. A decisao do
// orquestrador entra so como sinal de desconfianca — ela interpreta linguagem, e linguagem nao autoriza.
import { describe, expect, it } from 'vitest';
import { autorizar } from './permissoes';
import { CATALOGO_ACOES, autorizarAcao, decisaoSegura, definicaoDaAcao, permissaoExigida, type AcaoProposta, type CodigoAgente, type IdentidadeResolvida, type InternalIntent, type OrchestratorDecision, type WhatsappIdentity } from './tipos';
import { getState, pode } from '../../data/store';
import type { Papel, Usuario } from '../types';

const TELEFONE = '5562988887777';
const identidade: WhatsappIdentity = {
  id: 'i1', organizationId: 'org-1', usuarioId: 'u-augusto', telefoneNormalizado: TELEFONE,
  contexto: 'INTERNAL', situacao: 'VERIFIED', criadoEm: '2026-09-01T00:00:00.000Z',
};
const resolvida: IdentidadeResolvida = { identidade, conhecida: true, verificada: true, motivo: 'identidade verificada' };
const naoVerificada: IdentidadeResolvida = { conhecida: false, verificada: false, motivo: 'número não vinculado a nenhuma pessoa nesta organização' };
const usuario = (papel: Papel, extra: Partial<Usuario> = {}): Usuario => ({ id: 'u-augusto', nome: 'Augusto', email: 'augusto@eiff.com.br', papel, obras: '*', ativo: true, ...extra });
const decisao = (intent: InternalIntent = 'FINANCE', confidence = 0.94): OrchestratorDecision => decisaoSegura({ intent, confidence, motivo: 'sinais de teste' }, resolvida);

/** Proposta bem formada a partir do catalogo: e assim que um agente honesto propoe. */
function propor(codigo: string, escopoObra?: string): { proposta: AcaoProposta; agente: CodigoAgente } {
  const def = definicaoDaAcao(codigo);
  if (!def) throw new Error(`ação fora do catálogo: ${codigo}`);
  return {
    agente: def.agente,
    proposta: {
      codigo, titulo: def.titulo, descricao: def.titulo, permissao: def.permissao,
      exigeConfirmacao: def.exigeConfirmacao, reversivel: true,
      escopoObra: def.exigeObra ? (escopoObra ?? 'OB-SF-CL-01') : escopoObra,
      parametros: {},
    },
  };
}
const previsao = (escopoObra?: string) => propor('FINANCE_REGISTRAR_PREVISAO', escopoObra);

describe('a matriz é a do EIFF Control', () => {
  it('toda ação do catálogo aponta para uma Acao que existe de verdade no store', () => {
    const eu = getState().usuario;
    for (const a of CATALOGO_ACOES) {
      if (a.permissao === null) continue;
      // pode() estoura se a acao nao existir na MATRIZ: e esta a prova de que a acao e real
      expect(() => pode(eu, a.permissao!), a.codigo).not.toThrow();
    }
  });
  it('a resposta da ponte é a mesma de pode(): nenhuma regra nova', () => {
    for (const papel of ['Administrador', 'Financeiro', 'Compras', 'Contabilidade', 'Auditoria', 'Engenharia'] as Papel[]) {
      for (const def of CATALOGO_ACOES) {
        const { proposta, agente } = propor(def.codigo);
        const a = autorizar({ proposta, agente, identidade: resolvida, usuario: usuario(papel), contexto: 'INTERNAL' });
        const esperado = def.permissao === null ? true : pode(usuario(papel), def.permissao, proposta.escopoObra);
        expect(a.autorizado, `${papel}/${def.codigo}`).toBe(esperado);
      }
    }
  });
  it('a mesma intenção cobre permissões diferentes — é por isso que a intenção não autoriza', () => {
    // Auditoria le o caixa (ver_bancos) mas nao registra previsao (editar_lancamento) nem liquida
    const auditoria = usuario('Auditoria');
    const ctx = { identidade: resolvida, usuario: auditoria, contexto: 'INTERNAL' as const };
    expect(autorizar({ ...propor('FINANCE_CONSULTA_CAIXA'), ...ctx }).autorizado).toBe(true);
    expect(autorizar({ ...propor('FINANCE_REGISTRAR_PREVISAO'), ...ctx }).autorizado).toBe(false);
    expect(autorizar({ ...propor('FINANCE_LIQUIDAR'), ...ctx }).autorizado).toBe(false);
    // e o contrario: Compras registra previsao, mas nao le o caixa
    const compras = { identidade: resolvida, usuario: usuario('Compras'), contexto: 'INTERNAL' as const };
    expect(autorizar({ ...propor('FINANCE_REGISTRAR_PREVISAO'), ...compras }).autorizado).toBe(true);
    expect(autorizar({ ...propor('FINANCE_CONSULTA_CAIXA'), ...compras }).autorizado).toBe(false);
  });
});

describe('recusas', () => {
  it('identidade não verificada nunca autoriza', () => {
    const a = autorizar({ ...previsao(), identidade: naoVerificada, usuario: usuario('Administrador'), contexto: 'INTERNAL', decisao: decisaoSegura({ intent: 'FINANCE', confidence: 0.99, motivo: 'x' }, naoVerificada) });
    expect(a).toMatchObject({ autorizado: false, negativa: 'identidade_nao_verificada', exigeHumano: true });
  });
  it('número verificado sem usuário do Control não autoriza', () => {
    expect(autorizar({ ...previsao(), identidade: resolvida, contexto: 'INTERNAL' })).toMatchObject({ autorizado: false, negativa: 'usuario_ausente' });
  });
  it('usuário inativo não autoriza', () => {
    expect(autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Administrador', { ativo: false }), contexto: 'INTERNAL' }))
      .toMatchObject({ autorizado: false, negativa: 'usuario_inativo' });
  });
  it('identidade de outra pessoa não autoriza, e o número sai mascarado', () => {
    const a = autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Administrador', { id: 'u-maria' }), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'identidade_de_outra_pessoa' });
    expect(a.motivo).not.toContain(TELEFONE);
    expect(a.motivo).toContain('5562*******77');
  });
  it('contexto EXTERNAL não atende intenção interna', () => {
    expect(autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Administrador'), contexto: 'EXTERNAL', decisao: decisao() }))
      .toMatchObject({ autorizado: false, negativa: 'contexto_externo' });
    expect(autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Administrador'), decisao: decisao() }))
      .toMatchObject({ autorizado: false, negativa: 'contexto_externo' });
  });
  it('decisão que exige humano não é autorizada automaticamente', () => {
    const baixa = decisaoSegura({ intent: 'FINANCE', confidence: 0.4, motivo: 'sinal fraco' }, resolvida);
    expect(autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Administrador'), contexto: 'INTERNAL', decisao: baixa }))
      .toMatchObject({ autorizado: false, negativa: 'revisao_humana' });
  });
  it('papel sem a ação não autoriza', () => {
    const a = autorizar({ ...propor('PURCHASE_REGISTRAR_PEDIDO'), identidade: resolvida, usuario: usuario('Contabilidade'), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'papel_sem_acao' });
    expect(a.motivo).toContain('comprar');
  });
  it('obra fora do escopo do usuário não autoriza', () => {
    const fora = autorizar({ ...propor('WORKSITE_APONTAR_DIARIO', 'OB-SF-CL-01'), identidade: resolvida, usuario: usuario('Gestor de obra', { obras: ['OB-OUTRA'] }), contexto: 'INTERNAL' });
    expect(fora).toMatchObject({ autorizado: false, negativa: 'papel_sem_acao' });
    expect(autorizar({ ...propor('WORKSITE_APONTAR_DIARIO', 'OB-SF-CL-01'), identidade: resolvida, usuario: usuario('Gestor de obra', { obras: ['OB-SF-CL-01'] }), contexto: 'INTERNAL' }).autorizado).toBe(true);
  });
});

describe('escalada de privilégio', () => {
  const ctx = { identidade: resolvida, usuario: usuario('Gestor de obra'), contexto: 'INTERNAL' as const };

  it('agente que não é dono da ação não autoriza, mesmo com o papel certo', () => {
    const { proposta } = propor('FINANCE_LIQUIDAR');
    const a = autorizar({ proposta, agente: 'GENERAL_AGENT', ...ctx, usuario: usuario('Administrador') });
    expect(a).toMatchObject({ autorizado: false, negativa: 'acao_recusada_pelo_catalogo' });
    expect(a.motivo).toContain('não pertence ao agente');
  });
  it('declarar uma permissão mais fraca não rebaixa a exigência da ação', () => {
    const { proposta, agente } = propor('FINANCE_LIQUIDAR');
    const mentirosa: AcaoProposta = { ...proposta, permissao: 'comentar' };
    const a = autorizar({ proposta: mentirosa, agente, ...ctx, usuario: usuario('Administrador') });
    expect(a).toMatchObject({ autorizado: false, negativa: 'acao_recusada_pelo_catalogo' });
    expect(a.acao).toBe('liquidar'); // a exigencia vem do catalogo, nao da proposta
  });
  it('código de ação inventado nunca autoriza', () => {
    const { proposta, agente } = propor('FINANCE_CONSULTA_CAIXA');
    const a = autorizar({ proposta: { ...proposta, codigo: 'FINANCE_PAGAR_TUDO' }, agente, ...ctx, usuario: usuario('Administrador') });
    expect(a).toMatchObject({ autorizado: false, negativa: 'acao_recusada_pelo_catalogo' });
    expect(a.acao).toBeNull();
  });
  it('ação de obra sem escopo não autoriza, nem para o Administrador', () => {
    const { proposta, agente } = propor('WORKSITE_APONTAR_DIARIO');
    const a = autorizar({ proposta: { ...proposta, escopoObra: undefined }, agente, ...ctx, usuario: usuario('Administrador') });
    expect(a).toMatchObject({ autorizado: false, negativa: 'acao_recusada_pelo_catalogo' });
  });
  it('a intenção do roteador não abre porta: só aperta', () => {
    // roteador diz FINANCE com confianca alta, mas a acao proposta e liquidar e o papel nao tem
    const { proposta, agente } = propor('FINANCE_LIQUIDAR');
    const a = autorizar({ proposta, agente, ...ctx, decisao: decisao('FINANCE', 0.99) });
    expect(a).toMatchObject({ autorizado: false, negativa: 'papel_sem_acao' });
    expect(a.acao).toBe('liquidar');
  });
});

describe('permissão null é contrato, nunca permissão artificial', () => {
  const ctx = { identidade: resolvida, usuario: usuario('Contabilidade'), contexto: 'INTERNAL' as const };

  it('ação de ajuda (permissão null) não ganha permissão por declaração na proposta', () => {
    const { proposta, agente } = propor('GENERAL_AJUDA');
    // a proposta MENTE que exige administrar: o catálogo diz null, e é o catálogo que manda
    const a = autorizar({ proposta: { ...proposta, permissao: 'administrar' }, agente, ...ctx });
    expect(a.autorizado).toBe(true);
    expect(a.acao).toBeNull(); // nada de permissão artificial devolvida
    // e a matriz nem é consultada para ação sem permissão: um pode() que estoura não é chamado
    const veredicto = autorizarAcao({ usuario: ctx.usuario, agente, proposta: { ...proposta, permissao: 'administrar' }, identidade: resolvida }, () => { throw new Error('pode() não deveria ser consultado'); });
    expect(veredicto).toMatchObject({ autorizado: true, permissao: null });
  });

  it('declarar null para uma ação que EXIGE permissão é recusado, e a exigência devolvida é a do catálogo', () => {
    const { proposta, agente } = propor('FINANCE_LIQUIDAR');
    const a = autorizar({ proposta: { ...proposta, permissao: null }, agente, ...ctx, usuario: usuario('Administrador') });
    expect(a).toMatchObject({ autorizado: false, negativa: 'acao_recusada_pelo_catalogo', acao: 'liquidar' });
  });

  it('FINANCE_MEUS_PEDIDOS e GENERAL_AJUDA seguem sem permissão no catálogo, e permissaoExigida recusa usá-las como escrita', () => {
    expect(definicaoDaAcao('FINANCE_MEUS_PEDIDOS')?.permissao).toBeNull();
    expect(definicaoDaAcao('GENERAL_AJUDA')?.permissao).toBeNull();
    expect(() => permissaoExigida('GENERAL_AJUDA')).toThrow(/não exige permissão/);
    expect(() => permissaoExigida('INVENTADA')).toThrow(/não está no catálogo/);
    expect(permissaoExigida('FINANCE_REGISTRAR_PREVISAO')).toBe('editar_lancamento');
  });

  it('nenhum cast "as Acao" sobrou no código de produção da Central', () => {
    for (const arq of fs.readdirSync('src/core/central').filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      expect(fs.readFileSync(`src/core/central/${arq}`, 'utf8'), arq).not.toMatch(/\bas Acao\b/);
    }
  });
});

describe('autorização', () => {
  it('autorizado ainda exige confirmação: proposta não é execução', () => {
    const a = autorizar({ ...previsao(), identidade: resolvida, usuario: usuario('Financeiro'), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: true, acao: 'editar_lancamento', exigeConfirmacao: true, exigeHumano: false });
  });
  it('ação de leitura sem permissão especial passa, mas continua exigindo identidade verificada', () => {
    const ajuda = propor('GENERAL_AJUDA');
    expect(autorizar({ ...ajuda, identidade: resolvida, usuario: usuario('Contabilidade'), contexto: 'INTERNAL' })).toMatchObject({ autorizado: true, acao: null, exigeConfirmacao: false });
    expect(autorizar({ ...ajuda, identidade: naoVerificada, usuario: usuario('Contabilidade'), contexto: 'INTERNAL' }).autorizado).toBe(false);
  });
});
