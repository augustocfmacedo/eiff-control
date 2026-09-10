// Ponte de permissoes da Central: a autorizacao e a MATRIZ do EIFF Control, nunca uma segunda ACL.
import { describe, expect, it } from 'vitest';
import { ACAO_POR_INTENCAO, acaoDaIntencao, autorizar } from './permissoes';
import { INTENCOES_INTERNAS, PERMISSAO_POR_INTENCAO, decisaoSegura, type IdentidadeResolvida, type InternalIntent, type OrchestratorDecision, type WhatsappIdentity } from './tipos';
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

describe('a matriz é a do EIFF Control', () => {
  it('toda intenção mapeia para uma Acao que existe de verdade no store', () => {
    const eu = getState().usuario;
    for (const i of INTENCOES_INTERNAS) {
      const acao = acaoDaIntencao(i);
      expect(acao).toBeTruthy();
      // pode() estoura se a acao nao existir na MATRIZ: e esta a prova de que a acao e real
      expect(() => pode(eu, acao), i).not.toThrow();
    }
  });
  it('o espelho tipado e a tabela do contrato não andam sozinhos', () => {
    for (const i of INTENCOES_INTERNAS) expect(ACAO_POR_INTENCAO[i], i).toBe(PERMISSAO_POR_INTENCAO[i]);
    expect(Object.keys(ACAO_POR_INTENCAO).sort()).toEqual([...INTENCOES_INTERNAS].sort());
  });
  it('a resposta da ponte é a mesma de pode(): nenhuma regra nova', () => {
    for (const papel of ['Administrador', 'Financeiro', 'Compras', 'Contabilidade', 'Auditoria', 'Engenharia'] as Papel[]) {
      for (const i of INTENCOES_INTERNAS) {
        const a = autorizar({ decisao: decisao(i), identidade: resolvida, usuario: usuario(papel), contexto: 'INTERNAL' });
        expect(a.autorizado, `${papel}/${i}`).toBe(pode(usuario(papel), acaoDaIntencao(i)));
      }
    }
  });
});

describe('recusas', () => {
  it('identidade não verificada nunca autoriza', () => {
    const a = autorizar({ decisao: decisaoSegura({ intent: 'FINANCE', confidence: 0.99, motivo: 'x' }, naoVerificada), identidade: naoVerificada, usuario: usuario('Administrador'), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'identidade_nao_verificada', exigeHumano: true });
  });
  it('número verificado sem usuário do Control não autoriza', () => {
    expect(autorizar({ decisao: decisao(), identidade: resolvida, contexto: 'INTERNAL' })).toMatchObject({ autorizado: false, negativa: 'usuario_ausente' });
  });
  it('usuário inativo não autoriza', () => {
    expect(autorizar({ decisao: decisao(), identidade: resolvida, usuario: usuario('Administrador', { ativo: false }), contexto: 'INTERNAL' }))
      .toMatchObject({ autorizado: false, negativa: 'usuario_inativo' });
  });
  it('identidade de outra pessoa não autoriza, e o número sai mascarado', () => {
    const a = autorizar({ decisao: decisao(), identidade: resolvida, usuario: usuario('Administrador', { id: 'u-maria' }), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'identidade_de_outra_pessoa' });
    expect(a.motivo).not.toContain(TELEFONE);
    expect(a.motivo).toContain('5562*******77');
  });
  it('contexto EXTERNAL não atende intenção interna', () => {
    expect(autorizar({ decisao: decisao(), identidade: resolvida, usuario: usuario('Administrador'), contexto: 'EXTERNAL' }))
      .toMatchObject({ autorizado: false, negativa: 'contexto_externo' });
    expect(autorizar({ decisao: decisao(), identidade: resolvida, usuario: usuario('Administrador') }))
      .toMatchObject({ autorizado: false, negativa: 'contexto_externo' });
  });
  it('decisão que exige humano não é autorizada automaticamente', () => {
    const baixa = decisaoSegura({ intent: 'FINANCE', confidence: 0.4, motivo: 'sinal fraco' }, resolvida);
    expect(autorizar({ decisao: baixa, identidade: resolvida, usuario: usuario('Administrador'), contexto: 'INTERNAL' }))
      .toMatchObject({ autorizado: false, negativa: 'revisao_humana' });
  });
  it('papel sem a ação não autoriza', () => {
    const a = autorizar({ decisao: decisao('PURCHASE'), identidade: resolvida, usuario: usuario('Contabilidade'), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'papel_sem_acao' });
    expect(a.motivo).toContain('comprar');
  });
  it('obra fora do escopo do usuário não autoriza', () => {
    const a = autorizar({ decisao: decisao('WORKSITE'), identidade: resolvida, usuario: usuario('Gestor de obra', { obras: ['OB-OUTRA'] }), contexto: 'INTERNAL', codigoObra: 'OB-SF-CL-01' });
    expect(a).toMatchObject({ autorizado: false, negativa: 'papel_sem_acao' });
    expect(autorizar({ decisao: decisao('WORKSITE'), identidade: resolvida, usuario: usuario('Gestor de obra', { obras: ['OB-SF-CL-01'] }), contexto: 'INTERNAL', codigoObra: 'OB-SF-CL-01' }).autorizado).toBe(true);
  });
});

describe('autorização', () => {
  it('autorizado ainda exige confirmação: proposta não é execução', () => {
    const a = autorizar({ decisao: decisao(), identidade: resolvida, usuario: usuario('Financeiro'), contexto: 'INTERNAL' });
    expect(a).toMatchObject({ autorizado: true, acao: 'editar_lancamento', exigeConfirmacao: true, exigeHumano: false });
  });
});
