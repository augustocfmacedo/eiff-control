// EIFF Central — Wave 03 F2-WEBHOOK: contexto do servidor e fail-closed em cada variavel.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerAllowlist, lerEngineSha, resolverContextoCentral } from './contextoServidor';
import { FLOW_VERSION, type VariaveisCentralServidor } from './servidorContratos';

const ORG = '0F1E2D3C-4B5A-4978-8765-43210FEDCBA9';
const completo = (): VariaveisCentralServidor => ({
  CENTRAL_ALPHA_MODE: 'on',
  EIFF_CENTRAL_PHONE_NUMBER_ID: 'pn-interno-1',
  EIFF_COMMERCIAL_PHONE_NUMBER_ID: 'pn-externo-2',
  EIFF_CENTRAL_ORGANIZATION_ID: ORG,
  CENTRAL_ALPHA_NUMBERS: '5562988887777, +55 (62) 97777-6666',
  COMMIT_REF: 'ABCDEF1234567',
});

describe('resolverContextoCentral — fail-closed', () => {
  it('sem CENTRAL_ALPHA_MODE (padrão) fica off, não pronto, motivo modo_off — mesmo com tudo o mais configurado', () => {
    const c = resolverContextoCentral({ ...completo(), CENTRAL_ALPHA_MODE: undefined });
    expect(c).toMatchObject({ modo: 'off', pronto: false, motivo: 'modo_off' });
    expect(c.organizationId).toBeUndefined();
  });
  it('qualquer valor diferente de "on" é off (ON, true, 1, canary, vazio)', () => {
    for (const v of ['ON', 'true', '1', 'canary', '', '  ']) {
      const c = resolverContextoCentral({ ...completo(), CENTRAL_ALPHA_MODE: v });
      expect(c, v).toMatchObject({ modo: 'off', pronto: false, motivo: 'modo_off' });
    }
  });
  it('organização ausente → organizacao_ausente; não uuid → organizacao_invalida', () => {
    expect(resolverContextoCentral({ ...completo(), EIFF_CENTRAL_ORGANIZATION_ID: undefined })).toMatchObject({ modo: 'on', pronto: false, motivo: 'organizacao_ausente' });
    expect(resolverContextoCentral({ ...completo(), EIFF_CENTRAL_ORGANIZATION_ID: '   ' })).toMatchObject({ pronto: false, motivo: 'organizacao_ausente' });
    for (const v of ['org-eiff', '12345', 'zzzzzzzz-0000-0000-0000-000000000000', `${ORG}x`]) {
      expect(resolverContextoCentral({ ...completo(), EIFF_CENTRAL_ORGANIZATION_ID: v }), v).toMatchObject({ pronto: false, motivo: 'organizacao_invalida' });
    }
  });
  it('sem o número INTERNAL → numeros_ausentes (o EXTERNAL sozinho não abre o Alpha)', () => {
    const c = resolverContextoCentral({ ...completo(), EIFF_CENTRAL_PHONE_NUMBER_ID: '' });
    expect(c).toMatchObject({ pronto: false, motivo: 'numeros_ausentes' });
    expect(c.numeros).toEqual({ interno: undefined, externo: 'pn-externo-2' });
  });
  it('allowlist ausente, vazia ou só com números inválidos → allowlist_vazia', () => {
    for (const v of [undefined, '', ' , ; ', 'abc', '123', '5562', '+1 555 0100']) {
      expect(resolverContextoCentral({ ...completo(), CENTRAL_ALPHA_NUMBERS: v }), String(v)).toMatchObject({ pronto: false, motivo: 'allowlist_vazia' });
    }
  });
  it('a ordem dos motivos é fixa: modo, organização, números, allowlist', () => {
    expect(resolverContextoCentral({})).toMatchObject({ motivo: 'modo_off' });
    expect(resolverContextoCentral({ CENTRAL_ALPHA_MODE: 'on' })).toMatchObject({ motivo: 'organizacao_ausente' });
    expect(resolverContextoCentral({ CENTRAL_ALPHA_MODE: 'on', EIFF_CENTRAL_ORGANIZATION_ID: ORG })).toMatchObject({ motivo: 'numeros_ausentes' });
    expect(resolverContextoCentral({ CENTRAL_ALPHA_MODE: 'on', EIFF_CENTRAL_ORGANIZATION_ID: ORG, EIFF_CENTRAL_PHONE_NUMBER_ID: 'pn' })).toMatchObject({ motivo: 'allowlist_vazia' });
  });
});

describe('resolverContextoCentral — pronto', () => {
  it('"on" completo fica pronto, com organização em minúsculas, números, allowlist normalizada, engineSha e flowVersion', () => {
    const c = resolverContextoCentral(completo());
    expect(c.pronto).toBe(true);
    expect(c.motivo).toBeUndefined();
    expect(c.modo).toBe('on');
    expect(c.organizationId).toBe(ORG.toLowerCase());
    expect(c.numeros).toEqual({ interno: 'pn-interno-1', externo: 'pn-externo-2' });
    expect([...c.numerosPermitidos]).toEqual(['5562988887777', '5562977776666']);
    expect(c.engineSha).toBe('abcdef1234567');
    expect(c.flowVersion).toBe(FLOW_VERSION);
  });
  it('a allowlist aceita vírgula, ponto e vírgula, quebra de linha e formatos brasileiros; descarta inválidos em silêncio e deduplica', () => {
    const lista = lerAllowlist('62 98888-7777;\n+55 62 97777-6666,abc,5562988887777 , 000, 556299999999');
    expect([...lista]).toEqual(['5562988887777', '5562977776666', '556299999999']);
  });
  it('COMMIT_REF inválido (curto, com caractere fora de hex, vazio) vira undefined; válido vira minúsculo', () => {
    for (const v of [undefined, '', 'abc12', 'main', 'g1234567', 'deploy-preview-12', `${'a'.repeat(65)}`]) expect(lerEngineSha(v), String(v)).toBeUndefined();
    expect(lerEngineSha('ABC1234')).toBe('abc1234');
    expect(lerEngineSha(` ${'f'.repeat(40)} `)).toBe('f'.repeat(40));
    expect(resolverContextoCentral({ ...completo(), COMMIT_REF: 'deploy-preview' }).engineSha).toBeUndefined();
  });
  it('o módulo é puro: não lê o ambiente nem importa cliente de banco', () => {
    const fonte = fs.readFileSync('src/core/central/contextoServidor.ts', 'utf8');
    expect(fonte).not.toMatch(/process\.env/);
    expect(fonte).not.toMatch(/@supabase|fetch\(/);
  });
});
