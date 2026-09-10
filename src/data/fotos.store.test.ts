// Fotos de campo no store (modo local): registro com validacao, auditoria, exclusao so por quem tirou ou quem edita a obra.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('fotos de campo', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  it('registra a foto ligada ao item, com autor e data, e grava auditoria; recusa data URL inválida e foto grande', () => {
    const obra = getState().ds.obras[0].codigo;
    const antes = (getState().ds.fotos ?? []).length; const aud = getState().ds.auditoria.length;
    const f = actions.registrarFoto({ codigoObra: obra, referenciaTipo: 'ordem', referenciaId: 'ORD-1', dataUrl: PNG, nota: 'teste' });
    expect(f.id).toMatch(/^FOTO-/); expect(f.tomadaPor).toBe('u-admin'); expect(f.tomadaEm).toBeTruthy();
    expect(getState().ds.fotos).toHaveLength(antes + 1); expect(getState().ds.auditoria.length).toBe(aud + 1);
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'registrar_foto', entidade: 'ordem', entidadeId: 'ORD-1' });
    expect(() => actions.registrarFoto({ codigoObra: obra, referenciaTipo: 'ordem', referenciaId: 'ORD-1', dataUrl: 'http://x/y.jpg' })).toThrow(RegraDeNegocioError);
    expect(() => actions.registrarFoto({ codigoObra: obra, referenciaTipo: 'ordem', referenciaId: 'ORD-1', dataUrl: `data:image/jpeg;base64,${'A'.repeat(900_000)}` })).toThrow(/grande demais/);
  });
  it('exclusão: o autor exclui; outro usuário sem edição da obra não; a auditoria registra', () => {
    const f = actions.registrarFoto({ codigoObra: '', referenciaTipo: 'tarefa', referenciaId: 'T-1', dataUrl: PNG });
    actions.trocarUsuario('u-audit');
    expect(() => actions.excluirFoto(f.id)).toThrow(RegraDeNegocioError);
    actions.trocarUsuario('u-admin');
    actions.excluirFoto(f.id);
    expect(getState().ds.fotos.some((x) => x.id === f.id)).toBe(false);
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'excluir_foto', entidadeId: 'T-1' });
    expect(() => actions.excluirFoto(f.id)).toThrow(/não encontrada/);
  });
});
