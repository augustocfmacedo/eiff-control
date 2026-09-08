// Consistencia codigo x banco das regras de persona (Decision Maker Production Alignment 01).
import { describe, expect, it } from 'vitest';
import { REGRAS_PERSONA_PADRAO } from './padroes';
import { CALIBRACAO_01_PERSONA, chaveRegraPersona, compararRegrasPersona, diferencasSaoDaCalibracao01 } from './personaRegras';
import type { RegraPersona } from './types';

/** As 16 regras como estavam em producao antes da Calibration 01 (prioridades 1..16, sem a regra industrial, logistica sem warehouse). */
const antigas16 = (): RegraPersona[] => REGRAS_PERSONA_PADRAO.filter((g) => chaveRegraPersona(g) !== CALIBRACAO_01_PERSONA.novaRegra).map((g, i) => ({ ...g, id: `db-${i + 1}`, prioridade: i + 1, termos: chaveRegraPersona(g) === CALIBRACAO_01_PERSONA.logistica ? g.termos.filter((t) => !CALIBRACAO_01_PERSONA.termosLogistica.includes(t)) : g.termos }));

describe('regras de persona: codigo x producao', () => {
  it('padrao do codigo tem 17 regras, a lideranca industrial na posicao 9 (antes de compras/supply chain) e logistica com warehouse/almoxarifado', () => {
    expect(REGRAS_PERSONA_PADRAO).toHaveLength(17);
    const nova = REGRAS_PERSONA_PADRAO.find((g) => chaveRegraPersona(g) === CALIBRACAO_01_PERSONA.novaRegra)!;
    expect(nova).toMatchObject({ persona: 'MANUFACTURING', campo: 'cargo', prioridade: 9 });
    for (const t of ['gerente industrial', 'gerente de producao', 'gerente fabril', 'gerente de fabrica', 'gerente de planta', 'plant manager', 'production manager', 'manufacturing manager', 'coordenador industrial', 'supervisor industrial', 'encarregado industrial']) expect(nova.termos).toContain(t);
    expect(nova.prioridade).toBeLessThan(REGRAS_PERSONA_PADRAO.find((g) => g.persona === 'PROCUREMENT')!.prioridade);
    expect(nova.prioridade).toBeLessThan(REGRAS_PERSONA_PADRAO.find((g) => g.persona === 'SUPPLY_CHAIN')!.prioridade);
    expect(REGRAS_PERSONA_PADRAO.find((g) => chaveRegraPersona(g) === CALIBRACAO_01_PERSONA.logistica)!.termos).toEqual(expect.arrayContaining(CALIBRACAO_01_PERSONA.termosLogistica));
    expect(REGRAS_PERSONA_PADRAO.map((g) => g.prioridade)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });
  it('padrao x padrao: alinhado; 16 antigas x padrao: exatamente as diferencas da Calibration 01', () => {
    expect(compararRegrasPersona(REGRAS_PERSONA_PADRAO.map((g, i) => ({ ...g, id: `db-${i}` })), REGRAS_PERSONA_PADRAO)).toEqual({ alinhado: true, diferencas: [] });
    const cmp = compararRegrasPersona(antigas16(), REGRAS_PERSONA_PADRAO);
    expect(cmp.alinhado).toBe(false);
    expect(cmp.diferencas.filter((d) => d.tipo === 'inserir').map((d) => d.chave)).toEqual([CALIBRACAO_01_PERSONA.novaRegra]);
    expect(cmp.diferencas.filter((d) => d.tipo === 'remover')).toHaveLength(0);
    const atualizar = cmp.diferencas.filter((d) => d.tipo === 'atualizar');
    expect(atualizar).toHaveLength(8); // 8 regras a partir da posicao 9 deslocam +1 (a logistica tambem ganha termos)
    expect(atualizar.find((d) => d.chave === CALIBRACAO_01_PERSONA.logistica)!.campos).toEqual(['termos', 'prioridade']);
    expect(diferencasSaoDaCalibracao01(cmp.diferencas)).toEqual({ ok: true, foraDoEscopo: [] });
  });
  it('qualquer outra divergencia (termo diferente, regra extra, regra faltando) e fora do escopo e deve parar o alinhamento', () => {
    const comTermoTrocado = antigas16().map((g) => (g.persona === 'CEO' ? { ...g, termos: [...g.termos, 'diretor presidente'] } : g));
    expect(diferencasSaoDaCalibracao01(compararRegrasPersona(comTermoTrocado, REGRAS_PERSONA_PADRAO).diferencas).ok).toBe(false);
    const comExtra = [...antigas16(), { id: 'x', persona: 'OTHER', campo: 'cargo', termos: ['consultor'], prioridade: 17, ativo: true } as RegraPersona];
    expect(diferencasSaoDaCalibracao01(compararRegrasPersona(comExtra, REGRAS_PERSONA_PADRAO).diferencas).foraDoEscopo.map((d) => d.tipo)).toEqual(['remover']);
    const semOwner = antigas16().filter((g) => g.persona !== 'OWNER');
    expect(diferencasSaoDaCalibracao01(compararRegrasPersona(semOwner, REGRAS_PERSONA_PADRAO).diferencas).ok).toBe(false);
  });
});
