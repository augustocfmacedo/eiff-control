// ver_central (Wave 03, D6): a permissao da EIFF Central no EIFF Control. Regressao papel a papel e prova de que a
// introducao dela nao mexeu em nenhuma outra acao da MATRIZ.
import { describe, expect, it } from 'vitest';
import type { Papel, Usuario } from '../core/types';
import { MATRIZ, pode } from './store';

const PAPEIS: Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria'];
const usuario = (papel: Papel): Usuario => ({ id: `u-${papel}`, nome: papel, email: 't@eiff.com.br', papel, obras: '*', ativo: true });

describe('ver_central', () => {
  it('Administrador, Diretoria e Financeiro têm ver_central; os outros cinco papéis não', () => {
    const esperado: Record<Papel, boolean> = {
      Administrador: true, Diretoria: true, Financeiro: true,
      'Gestor de obra': false, Engenharia: false, Compras: false, Contabilidade: false, Auditoria: false,
    };
    for (const p of PAPEIS) expect(pode(usuario(p), 'ver_central'), p).toBe(esperado[p]);
    expect(MATRIZ.ver_central).toEqual(['Administrador', 'Diretoria', 'Financeiro']);
  });

  it('é a mesma fronteira da RLS de central_conversation para o contexto INTERNAL (has_role Administrador, Diretoria, Financeiro)', () => {
    // a migration 0050 e a fonte: quem ve a conversa INTERNAL no banco e quem tem ver_central no app
    expect([...MATRIZ.ver_central].sort()).toEqual(['Administrador', 'Diretoria', 'Financeiro'].sort());
  });

  it('ver_central não é ver_mission_control nem ver_auditoria: cada uma alcança um conjunto diferente', () => {
    expect(pode(usuario('Financeiro'), 'ver_central')).toBe(true);
    expect(pode(usuario('Financeiro'), 'ver_mission_control')).toBe(false);
    expect(pode(usuario('Auditoria'), 'ver_auditoria')).toBe(true);
    expect(pode(usuario('Auditoria'), 'ver_central')).toBe(false);
  });

  it('nenhuma outra ação da MATRIZ mudou ao introduzir ver_central (snapshot das demais)', () => {
    const { ver_central: _nova, ...demais } = MATRIZ;
    void _nova;
    expect(demais).toMatchInlineSnapshot(`
      {
        "administrar": [
          "Administrador",
        ],
        "aprovar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Gestor de obra",
        ],
        "comentar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Gestor de obra",
          "Engenharia",
          "Compras",
          "Contabilidade",
        ],
        "comprar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Compras",
          "Gestor de obra",
          "Engenharia",
        ],
        "conciliar": [
          "Administrador",
          "Financeiro",
        ],
        "editar_cadastros": [
          "Administrador",
          "Financeiro",
        ],
        "editar_etc": [
          "Administrador",
          "Diretoria",
          "Gestor de obra",
          "Engenharia",
          "Financeiro",
        ],
        "editar_lancamento": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Gestor de obra",
          "Engenharia",
          "Compras",
        ],
        "editar_obra": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Gestor de obra",
        ],
        "editar_parametros": [
          "Administrador",
          "Financeiro",
          "Diretoria",
        ],
        "exportar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Contabilidade",
          "Auditoria",
        ],
        "fechar_periodo": [
          "Administrador",
          "Financeiro",
        ],
        "liquidar": [
          "Administrador",
          "Financeiro",
        ],
        "orcar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Engenharia",
          "Compras",
          "Gestor de obra",
        ],
        "radar": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Compras",
          "Gestor de obra",
          "Engenharia",
        ],
        "radar_config": [
          "Administrador",
          "Diretoria",
        ],
        "reabrir_periodo": [
          "Administrador",
          "Diretoria",
        ],
        "ver_auditoria": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Contabilidade",
          "Auditoria",
        ],
        "ver_bancos": [
          "Administrador",
          "Diretoria",
          "Financeiro",
          "Contabilidade",
          "Auditoria",
        ],
        "ver_mission_control": [
          "Administrador",
          "Diretoria",
        ],
      }
    `);
  });
});
