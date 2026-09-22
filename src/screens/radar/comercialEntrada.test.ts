// Commercial UX 1.0 — UX-5: zona ENTRADA.
//
// O que esta suite prende: os tres conceitos (SINAL NOVO, CONTA ADICIONADA AO RADAR, ENRIQUECIMENTO) sao
// SEPARADOS; `detectadoEm` e `criadoEm` sao as unicas autoridades de recencia; falta de dado NUNCA vira lead; e a
// zona nao ordena, nao pontua e nao preenche a vaga de um conceito com item de outro.
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodigoRazaoCM, CommercialQueueItem, RazaoCM } from '../../core/radar/commercialMachine';
import type { Empresa, Sinal } from '../../core/radar/types';
import {
  JANELA_ENTRADA_UX_DIAS, RAZOES_ENRIQUECIMENTO_UX, dentroDaJanelaUX, destaquesDaEntradaUX, entradaComercialUX,
  entradaVaziaUX, razoesDeEnriquecimentoUX, textoDaRazaoEntradaUX, type FatosEntradaUX,
} from './comercialEntrada';
import ComercialPanorama from './ComercialPanorama';
import { ORCAMENTO_PANORAMA_COMERCIAL } from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const MS_DIA = 86_400_000;
const haDias = (n: number) => new Date(Date.parse(`${HOJE}T00:00:00Z`) - n * MS_DIA).toISOString().slice(0, 10);

const razao = (codigo: CodigoRazaoCM, estado: RazaoCM['estado'] = 'PRINCIPAL'): RazaoCM =>
  ({ codigo, categoria: 'ENRIQUECER', estado, degrau: 1, tier: 5, urgencia: 0, texto: '' } as unknown as RazaoCM);

function item(empresaId: string, principal: CodigoRazaoCM = 'CONTA_PRIORITARIA_NUNCA_ABORDADA', secundarias: CodigoRazaoCM[] = []): CommercialQueueItem {
  return {
    empresaId, posicao: 1, categoria: 'ENRIQUECER', priorityClass: 'A', priorityScore: 0,
    porQueAgora: razao(principal), secundarias: secundarias.map((c) => razao(c, 'PENDENTE')), travas: [],
  } as unknown as CommercialQueueItem;
}
const linha = (empresaId: string, principal?: CodigoRazaoCM, secundarias: CodigoRazaoCM[] = []) => ({ itemId: `${empresaId}:1`, item: item(empresaId, principal, secundarias) });

function empresa(id: string, extra: Partial<Empresa> = {}): Empresa {
  return { id, razaoSocial: `Empresa ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: haDias(365), atualizadoEm: haDias(365), ...extra } as Empresa;
}
function sinal(id: string, empresaId: string, extra: Partial<Sinal> = {}): Sinal {
  return {
    id, empresaId, fonteId: 'f1', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: `Sinal ${id}`, descricao: '',
    eventoEm: haDias(1), detectadoEm: haDias(1), confianca: 0.8, scoreBase: 10, scoreEfetivo: 8, verificado: true, ...extra,
  } as unknown as Sinal;
}
function fatos(extra: Partial<FatosEntradaUX> = {}): FatosEntradaUX {
  return { linhas: [], empresas: [], sinais: [], hoje: HOJE, ...extra };
}

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO_ENTRADA = semComentarios(leia('comercialEntrada.ts'));
const CODIGO_PANORAMA = semComentarios(leia('ComercialPanorama.tsx'));
const CODIGO_HOJE = semComentarios(leia('Hoje.tsx'));

// ---------------------------------------------------------------------------------------------------------------------
// Sinal novo
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — SINAL NOVO: a autoridade da recencia e `detectadoEm`', () => {
  const comEmpresa = (sinais: Sinal[]) => fatos({ linhas: [linha('e1')], empresas: [empresa('e1')], sinais });

  it('detectado hoje entra', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: HOJE })]));
    expect(r.sinais.total).toBe(1);
    expect(r.sinais.destaque?.dias).toBe(0);
  });

  it('detectado ha 7 dias entra (limite da janela)', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: haDias(7) })]));
    expect(r.sinais.total).toBe(1);
    expect(r.sinais.destaque?.dias).toBe(7);
  });

  it('detectado ha 8 dias NAO entra', () => {
    expect(entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: haDias(8) })])).sinais.total).toBe(0);
  });

  it('detectado no futuro NAO entra', () => {
    const amanha = '2026-09-16';
    expect(entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: amanha })])).sinais.total).toBe(0);
  });

  it('`eventoEm` nao define recencia: evento de hoje detectado ha 8 dias fica fora', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: haDias(8), eventoEm: HOJE })]));
    expect(r.sinais.total).toBe(0);
  });

  it('evento antigo detectado hoje ENTRA — e o texto fala de deteccao, nunca de "aconteceu hoje"', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: HOJE, eventoEm: haDias(90) })]));
    expect(r.sinais.total).toBe(1);
    expect(r.sinais.destaque?.detectadoEm).toBe(HOJE);
    expect(CODIGO_PANORAMA).toContain("textoDeteccaoEntrada = (dias: number): string => (dias === 0 ? 'Detectado hoje'");
    expect(CODIGO_PANORAMA).not.toContain('Aconteceu hoje');
  });

  it('sinal de empresa fora da base nao entra', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1'), empresa('e2')], sinais: [sinal('s1', 'e2', { detectadoEm: HOJE })] }));
    expect(r.sinais.total).toBe(0);
  });

  it('verificado e nao verificado entram igual: a zona mostra entrada, nao decide abordagem', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { detectadoEm: haDias(2), verificado: true }), sinal('s2', 'e1', { detectadoEm: haDias(3), verificado: false })]));
    expect(r.sinais.total).toBe(2);
    expect(r.sinais.destaque?.verificado).toBe(true);
    const so = entradaComercialUX(comEmpresa([sinal('s2', 'e1', { detectadoEm: haDias(3), verificado: false })]));
    expect(so.sinais.destaque?.verificado).toBe(false);
  });

  it('sinal nao acionavel/contextual tambem entra (nenhum filtro de acionabilidade)', () => {
    const r = entradaComercialUX(comEmpresa([sinal('s1', 'e1', { tipo: 'HIRING_ENGINEERING', detectadoEm: HOJE, verificado: false })]));
    expect(r.sinais.total).toBe(1);
    expect(CODIGO_ENTRADA).not.toContain('sinalAcionavel');
    expect(CODIGO_ENTRADA).not.toContain('RELEVANCIA');
  });

  it('o destaque e o detectado MAIS RECENTEMENTE — nao o de maior score ou confianca', () => {
    const r = entradaComercialUX(comEmpresa([
      sinal('velho-forte', 'e1', { detectadoEm: haDias(5), scoreEfetivo: 99, confianca: 0.99 }),
      sinal('novo-fraco', 'e1', { detectadoEm: haDias(1), scoreEfetivo: 1, confianca: 0.1 }),
    ]));
    expect(r.sinais.destaque?.sinalId).toBe('novo-fraco');
    for (const proibido of ['scoreEfetivo', 'scoreBase', 'confianca', 'priorityScore']) {
      expect(CODIGO_ENTRADA, `a projecao nao pode usar ${proibido}`).not.toContain(proibido);
    }
  });

  it('empate de data mantem o primeiro encontrado (varredura factual, sem sort)', () => {
    const r = entradaComercialUX(comEmpresa([sinal('a', 'e1', { detectadoEm: haDias(2) }), sinal('b', 'e1', { detectadoEm: haDias(2) })]));
    expect(r.sinais.destaque?.sinalId).toBe('a');
    expect(CODIGO_ENTRADA).not.toContain('.sort(');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Conta adicionada ao Radar
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — CONTA ADICIONADA AO RADAR: a autoridade e `criadoEm`', () => {
  const comConta = (e: Empresa) => fatos({ linhas: [linha(e.id)], empresas: [e] });

  it('criada hoje entra', () => {
    const r = entradaComercialUX(comConta(empresa('e1', { criadoEm: HOJE })));
    expect(r.contas.total).toBe(1);
    expect(r.contas.destaque?.dias).toBe(0);
  });

  it('criada ha 7 dias entra; ha 8 dias nao entra', () => {
    expect(entradaComercialUX(comConta(empresa('e1', { criadoEm: haDias(7) }))).contas.total).toBe(1);
    expect(entradaComercialUX(comConta(empresa('e1', { criadoEm: haDias(8) }))).contas.total).toBe(0);
  });

  it('criada no futuro nao entra', () => {
    expect(entradaComercialUX(comConta(empresa('e1', { criadoEm: '2026-09-20' }))).contas.total).toBe(0);
  });

  it('`atualizadoEm` NAO define conta nova: criada ha 100 dias e atualizada hoje fica fora', () => {
    const r = entradaComercialUX(comConta(empresa('e1', { criadoEm: haDias(100), atualizadoEm: HOJE })));
    expect(r.contas.total).toBe(0);
    expect(CODIGO_ENTRADA).not.toContain('atualizadoEm');
    expect(CODIGO_ENTRADA).not.toContain('ultimoSinalEm');
    expect(CODIGO_ENTRADA).not.toContain('ultimoContatoEm');
  });

  it('criada ha 2 dias entra, e o rotulo e "adicionada ao Radar" — nunca "novo lead"', () => {
    const r = entradaComercialUX(comConta(empresa('e1', { criadoEm: haDias(2) })));
    expect(r.contas.destaque?.dias).toBe(2);
    expect(CODIGO_PANORAMA).toContain("TITULO_CONTA_ENTRADA = 'CONTA ADICIONADA AO RADAR'");
    expect(CODIGO_PANORAMA).toContain('Adicionada ao Radar');
    for (const proibido of ['NOVA EMPRESA', 'Nova empresa', 'novo lead', 'Novo lead', 'NOVO_LEAD']) {
      expect(CODIGO_PANORAMA, `nao pode dizer ${proibido}`).not.toContain(proibido);
      expect(CODIGO_ENTRADA, `nao pode dizer ${proibido}`).not.toContain(proibido);
    }
  });

  it('o destaque e o `criadoEm` mais recente, nunca a de maior classe ou score', () => {
    const fs2 = fatos({
      linhas: [linha('antiga'), linha('recente')],
      empresas: [empresa('antiga', { criadoEm: haDias(6) }), empresa('recente', { criadoEm: haDias(1) })],
    });
    const r = entradaComercialUX(fs2);
    expect(r.contas.total).toBe(2);
    expect(r.contas.destaque?.empresaId).toBe('recente');
  });

  it('conta fora da base nao entra', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1'), empresa('e2', { criadoEm: HOJE })] }));
    expect(r.contas.total).toBe(0);
  });

  it('cidade/UF viajam quando existem, sem inventar quando nao', () => {
    const com = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1', { criadoEm: HOJE, cidade: 'Goiânia', uf: 'GO' })] }));
    expect(com.contas.destaque).toMatchObject({ cidade: 'Goiânia', uf: 'GO' });
    const sem = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1', { criadoEm: HOJE })] }));
    expect(sem.contas.destaque?.cidade).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Enriquecimento
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — ENRIQUECIMENTO vem das razoes da fila', () => {
  it('SEM_DECISOR entra como sem decisor', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SEM_DECISOR')], empresas: [empresa('e1')] }));
    expect(r.enriquecimento).toMatchObject({ total: 1, semDecisor: 1, semCanal: 0 });
    expect(r.enriquecimento.destaque?.semDecisor).toBe(true);
  });

  it('SEM_DECISOR_IDEAL_PARA_SINAL entra como sem decisor', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SEM_DECISOR_IDEAL_PARA_SINAL')], empresas: [empresa('e1')] }));
    expect(r.enriquecimento).toMatchObject({ total: 1, semDecisor: 1, semCanal: 0 });
  });

  it('SEM_CANAL_VALIDO entra como sem canal', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SEM_CANAL_VALIDO')], empresas: [empresa('e1')] }));
    expect(r.enriquecimento).toMatchObject({ total: 1, semDecisor: 0, semCanal: 1 });
  });

  it('razao SECUNDARIA tambem conta', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'CONTA_PRIORITARIA_NUNCA_ABORDADA', ['SEM_CANAL_VALIDO'])], empresas: [empresa('e1')] }));
    expect(r.enriquecimento.total).toBe(1);
    expect(r.enriquecimento.semCanal).toBe(1);
  });

  it('conta sem essas razoes nao entra', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SINAL_ACIONAVEL_NOVO', ['OPORTUNIDADE_PARADA'])], empresas: [empresa('e1')] }));
    expect(r.enriquecimento.total).toBe(0);
    expect(r.enriquecimento.destaque).toBeUndefined();
  });

  it('a mesma conta com os DOIS problemas conta uma vez no total, e os subcontadores sobrepoem', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SEM_DECISOR', ['SEM_CANAL_VALIDO'])], empresas: [empresa('e1')] }));
    expect(r.enriquecimento).toMatchObject({ total: 1, semDecisor: 1, semCanal: 1 });
    expect(r.enriquecimento.destaque?.codigos).toEqual(['SEM_DECISOR', 'SEM_CANAL_VALIDO']);
  });

  it('razao repetida na principal e na secundaria nao duplica', () => {
    expect(razoesDeEnriquecimentoUX(item('e1', 'SEM_DECISOR', ['SEM_DECISOR']))).toEqual(['SEM_DECISOR']);
  });

  it('o destaque e a PRIMEIRA conta elegivel na ordem da base', () => {
    const r = entradaComercialUX(fatos({
      linhas: [linha('sem-pendencia', 'SINAL_ACIONAVEL_NOVO'), linha('primeira', 'SEM_CANAL_VALIDO'), linha('segunda', 'SEM_DECISOR')],
      empresas: [empresa('sem-pendencia'), empresa('primeira'), empresa('segunda')],
    }));
    expect(r.enriquecimento.total).toBe(2);
    expect(r.enriquecimento.destaque?.empresaId).toBe('primeira');
  });

  it('o texto sai do catalogo da fila; nenhum diagnostico novo e escrito', () => {
    expect(textoDaRazaoEntradaUX('SEM_DECISOR')).toBe('Falta um decisor adequado para abordar');
    expect(textoDaRazaoEntradaUX('SEM_CANAL_VALIDO')).toBe('O contato não tem canal válido');
    expect(CODIGO_ENTRADA).toContain('TEXTO_RAZAO_CM[codigo]');
    expect(RAZOES_ENRIQUECIMENTO_UX).toEqual(['SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL', 'SEM_CANAL_VALIDO']);
  });

  it('a projecao nao recalcula contato, decisor nem fit', () => {
    for (const proibido of ['sugerirContatoPrincipal', 'calcularDecisionFit', 'contatoRecomendado', 'contatos', 'decisionFit']) {
      expect(CODIGO_ENTRADA, `a projecao nao pode chamar ${proibido}`).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Separacao conceitual
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — os tres conceitos sao separados', () => {
  it('conta antiga sem decisor e SO enriquecimento: nao e conta nova nem sinal novo', () => {
    const r = entradaComercialUX(fatos({ linhas: [linha('e1', 'SEM_DECISOR')], empresas: [empresa('e1', { criadoEm: haDias(365) })] }));
    expect(r.enriquecimento.total).toBe(1);
    expect(r.contas.total).toBe(0);
    expect(r.sinais.total).toBe(0);
  });

  it('a mesma conta pode aparecer nos tres conceitos — sao fatos diferentes', () => {
    const r = entradaComercialUX(fatos({
      linhas: [linha('e1', 'SEM_DECISOR')],
      empresas: [empresa('e1', { criadoEm: haDias(2) })],
      sinais: [sinal('s1', 'e1', { detectadoEm: HOJE })],
    }));
    expect(r.sinais.total).toBe(1);
    expect(r.contas.total).toBe(1);
    expect(r.enriquecimento.total).toBe(1);
    expect(destaquesDaEntradaUX(r)).toBe(3);
  });

  it('SEM DECISOR != NOVO LEAD: nenhum dos dois modulos usa a palavra lead', () => {
    for (const proibido of ['lead', 'Lead', 'LEAD']) {
      expect(CODIGO_ENTRADA, `a projecao nao pode dizer ${proibido}`).not.toContain(proibido);
      expect(CODIGO_PANORAMA, `a zona nao pode dizer ${proibido}`).not.toContain(proibido);
    }
  });

  it('nenhum estado "quente" ou sintetico foi criado', () => {
    for (const proibido of ['quente', 'temperatura', 'pressao', 'potencial', 'qualidade', 'saude']) {
      expect(CODIGO_ENTRADA, `nao pode existir ${proibido}`).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Orcamento visual
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — no maximo 3 destaques, um por conceito', () => {
  it('muitos sinais continuam rendendo UM destaque', () => {
    const sinais = [1, 2, 3, 4, 5, 6].map((n) => sinal(`s${n}`, 'e1', { detectadoEm: haDias(n % 5) }));
    const r = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1')], sinais }));
    expect(r.sinais.total).toBe(6);
    expect(destaquesDaEntradaUX(r)).toBe(1);
  });

  it('muitos enriquecimentos continuam rendendo UM destaque', () => {
    const linhas = ['a', 'b', 'c', 'd'].map((id) => linha(id, 'SEM_DECISOR'));
    const r = entradaComercialUX(fatos({ linhas, empresas: linhas.map((l) => empresa(l.item.empresaId)) }));
    expect(r.enriquecimento.total).toBe(4);
    expect(destaquesDaEntradaUX(r)).toBe(1);
  });

  it('vaga vazia de um conceito NAO e preenchida por outro', () => {
    const sinais = [1, 2, 3].map((n) => sinal(`s${n}`, 'e1', { detectadoEm: haDias(n) }));
    const linhas = [linha('e1', 'SEM_DECISOR'), linha('e2', 'SEM_CANAL_VALIDO')];
    const r = entradaComercialUX(fatos({ linhas, empresas: [empresa('e1'), empresa('e2')], sinais }));
    expect(r.sinais.total).toBe(3);
    expect(r.contas.total).toBe(0); // nenhuma conta recente
    expect(r.contas.destaque).toBeUndefined();
    expect(destaquesDaEntradaUX(r)).toBe(2); // 1 sinal + 1 enriquecimento, nunca 3 sinais
  });

  it('o teto da zona continua sendo o do orcamento visual', () => {
    expect(ORCAMENTO_PANORAMA_COMERCIAL.entrada).toBe(3);
    const r = entradaComercialUX(fatos({
      linhas: [linha('e1', 'SEM_DECISOR')], empresas: [empresa('e1', { criadoEm: HOJE })], sinais: [sinal('s1', 'e1', { detectadoEm: HOJE })],
    }));
    expect(destaquesDaEntradaUX(r)).toBeLessThanOrEqual(ORCAMENTO_PANORAMA_COMERCIAL.entrada);
  });

  it('a janela e de 7 dias e nao vem de SLA nem de score', () => {
    expect(JANELA_ENTRADA_UX_DIAS).toBe(7);
    expect(dentroDaJanelaUX(haDias(7), HOJE)).toBe(true);
    expect(dentroDaJanelaUX(haDias(8), HOJE)).toBe(false);
    for (const proibido of ['slaEstagioDias', 'HIPOTESE', 'sinalNovoDias']) expect(CODIGO_ENTRADA).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Panorama
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — a zona no Panorama', () => {
  it('a secao existe, com a janela e o resumo numerico dos tres conceitos', () => {
    expect(CODIGO_PANORAMA).toContain('zona-entrada');
    expect(CODIGO_PANORAMA).toContain('>Entrada<');
    expect(CODIGO_PANORAMA).toContain('entrada.sinais.total');
    expect(CODIGO_PANORAMA).toContain('entrada.contas.total');
    expect(CODIGO_PANORAMA).toContain('entrada.enriquecimento.total');
    expect(CODIGO_PANORAMA).toContain('sem decisor');
    expect(CODIGO_PANORAMA).toContain('sem canal');
  });

  it('os tres cards existem com os rotulos contratados', () => {
    expect(CODIGO_PANORAMA).toContain("TITULO_SINAL_ENTRADA = 'SINAL NOVO'");
    expect(CODIGO_PANORAMA).toContain("TITULO_CONTA_ENTRADA = 'CONTA ADICIONADA AO RADAR'");
    expect(CODIGO_PANORAMA).toContain("TITULO_ENRIQUECIMENTO_ENTRADA = 'ENRIQUECIMENTO'");
    expect(CODIGO_PANORAMA).toContain('NOME_SINAL[entrada.sinais.destaque.tipo]');
  });

  it('o status de verificacao e factual', () => {
    expect(CODIGO_PANORAMA).toContain("TEXTO_VERIFICADO_ENTRADA = 'Verificado'");
    expect(CODIGO_PANORAMA).toContain("TEXTO_A_VERIFICAR_ENTRADA = 'A verificar'");
    expect(CODIGO_PANORAMA).toContain('verificado ? TEXTO_VERIFICADO_ENTRADA : TEXTO_A_VERIFICAR_ENTRADA');
  });

  it('os cards linkam a empresa e nao tem CTA comercial', () => {
    const zona = CODIGO_PANORAMA.slice(CODIGO_PANORAMA.indexOf('zona-entrada'), CODIGO_PANORAMA.indexOf('zona-programado'));
    expect(zona).toContain('/radar/empresas/');
    for (const proibido of ['acaoPrincipal', 'ctaCadencia', 'actions.', 'Preparar abordagem', 'Agendar']) {
      expect(zona, `a zona nao pode ter ${proibido}`).not.toContain(proibido);
    }
  });

  it('"Ver inteligência ›" leva a /radar e nenhuma rota nova e criada', () => {
    expect(CODIGO_PANORAMA).toContain("export const ROTA_ENTRADA_PANORAMA = '/radar';");
    expect(CODIGO_PANORAMA).toContain('Ver inteligência ›');
    expect(CODIGO_PANORAMA).not.toContain('/radar/entrada');
  });

  it('empty state exato quando nao ha nada', () => {
    const vazia = entradaComercialUX(fatos({ linhas: [linha('e1')], empresas: [empresa('e1')] }));
    expect(entradaVaziaUX(vazia)).toBe(true);
    expect(CODIGO_PANORAMA).toContain("TEXTO_ENTRADA_VAZIA = 'Nenhuma entrada recente ou pendência de enriquecimento nesta visão.'");
  });

  it('a zona fica depois de Pipeline ativo e antes de Programado', () => {
    expect(CODIGO_PANORAMA.indexOf('zona-pipeline')).toBeLessThan(CODIGO_PANORAMA.indexOf('zona-entrada'));
    expect(CODIGO_PANORAMA.indexOf('zona-entrada')).toBeLessThan(CODIGO_PANORAMA.indexOf('zona-programado'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Zona renderizada: a prova de composicao do orcamento (um destaque por conceito, sem preencher vaga alheia)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — a zona renderizada respeita um destaque por conceito', () => {
  const zonaHtml = (f: FatosEntradaUX) => {
    const entrada = entradaComercialUX(f);
    const html = renderToStaticMarkup(React.createElement(ComercialPanorama, {
      contas: [], nomeEmpresa: (id: string) => `Empresa ${id}`, nomeContato: () => '—', nomeCanal: () => '',
      acaoPrincipal: () => null, ctaCadencia: () => null, onPorQue: () => {}, onVerTodos: () => {},
      pipelineAtivo: [], entrada,
    }));
    return html.slice(html.indexOf('zona-entrada'), html.indexOf('zona-programado'));
  };
  const ocorrencias = (texto: string, alvo: string) => texto.split(alvo).length - 1;

  it('com sinal + enriquecimento e SEM conta, a vaga da conta fica vazia (nunca vira um segundo sinal)', () => {
    const zona = zonaHtml(fatos({
      linhas: [linha('e1', 'SEM_DECISOR'), linha('e2', 'SEM_CANAL_VALIDO')],
      empresas: [empresa('e1'), empresa('e2')],
      sinais: [sinal('s1', 'e1', { detectadoEm: HOJE }), sinal('s2', 'e1', { detectadoEm: haDias(1) }), sinal('s3', 'e2', { detectadoEm: haDias(2) })],
    }));
    expect(ocorrencias(zona, 'SINAL NOVO')).toBe(1);
    expect(ocorrencias(zona, 'CONTA ADICIONADA AO RADAR')).toBe(0);
    expect(ocorrencias(zona, 'ENRIQUECIMENTO')).toBe(1);
  });

  it('com os tres conceitos, aparece exatamente um card de cada', () => {
    const zona = zonaHtml(fatos({
      linhas: [linha('e1', 'SEM_DECISOR', ['SEM_CANAL_VALIDO'])],
      empresas: [empresa('e1', { criadoEm: haDias(2) })],
      sinais: [sinal('s1', 'e1', { detectadoEm: HOJE, verificado: false })],
    }));
    expect(ocorrencias(zona, 'SINAL NOVO')).toBe(1);
    expect(ocorrencias(zona, 'CONTA ADICIONADA AO RADAR')).toBe(1);
    expect(ocorrencias(zona, 'ENRIQUECIMENTO')).toBe(1);
    expect(zona).toContain('Detectado hoje');
    expect(zona).toContain('A verificar');
    expect(zona).toContain('Adicionada ao Radar há 2 dias');
    expect(zona).toContain('SEM DECISOR');
    expect(zona).toContain('SEM CANAL');
    expect(zona).toContain('Falta um decisor adequado para abordar');
  });

  it('zona vazia mostra o empty state e nenhum card', () => {
    const zona = zonaHtml(fatos({ linhas: [linha('e1')], empresas: [empresa('e1')] }));
    expect(zona).toContain('Nenhuma entrada recente ou pendência de enriquecimento nesta visão.');
    expect(ocorrencias(zona, 'SINAL NOVO')).toBe(0);
    expect(ocorrencias(zona, 'CONTA ADICIONADA AO RADAR')).toBe(0);
    expect(ocorrencias(zona, 'ENRIQUECIMENTO')).toBe(0);
  });

  it('o resumo numerico aparece com os tres conceitos separados', () => {
    const zona = zonaHtml(fatos({
      linhas: [linha('e1', 'SEM_DECISOR'), linha('e2', 'SEM_CANAL_VALIDO')],
      empresas: [empresa('e1', { criadoEm: HOJE }), empresa('e2')],
      sinais: [sinal('s1', 'e1', { detectadoEm: HOJE }), sinal('s2', 'e2', { detectadoEm: haDias(3) })],
    }));
    expect(zona).toContain('2 sinal(is) novo(s)');
    expect(zona).toContain('1 conta(s) adicionada(s)');
    expect(zona).toContain('2 para enriquecer');
    expect(zona).toContain('1 sem decisor');
    expect(zona).toContain('1 sem canal');
    expect(zona).toContain('últimos 7 dias');
  });

  it('nenhuma palavra proibida sai na zona renderizada', () => {
    const zona = zonaHtml(fatos({
      linhas: [linha('e1', 'SEM_DECISOR')], empresas: [empresa('e1', { criadoEm: HOJE })], sinais: [sinal('s1', 'e1', { detectadoEm: HOJE })],
    }));
    for (const proibido of [/lead/i, /nova empresa/i, /aconteceu hoje/i, /quente/i, /score/i]) expect(zona).not.toMatch(proibido);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Autoridade e regressao
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-5 — autoridade preservada', () => {
  it('o Hoje projeta a ENTRADA sobre `base`, nunca sobre `visiveis`', () => {
    const inicio = CODIGO_HOJE.indexOf('const entradaUX = useMemo(');
    const bloco = CODIGO_HOJE.slice(inicio, CODIGO_HOJE.indexOf('[base, r.empresas, r.sinais, hoje]', inicio) + 60);
    expect(bloco).toContain('linhas: base.map(');
    expect(bloco).not.toContain('visiveis');
    expect(bloco).toContain('entradaComercialUX(');
  });

  it('nenhuma fila nova e nenhum motor chamado de novo', () => {
    expect((CODIGO_HOJE.match(/construirCommercialQueue\(/g) ?? [])).toHaveLength(1);
    expect(CODIGO_HOJE).not.toContain('filaHoje');
    for (const proibido of ['construirCommercialQueue', 'planosDaFilaCM', 'cadenciasDaFilaCM', 'filaHoje']) {
      expect(CODIGO_ENTRADA, `a projecao nao pode chamar ${proibido}`).not.toContain(proibido);
    }
  });

  it('a projecao e pura: sem React, sem store, sem escrita', () => {
    for (const proibido of ['react', 'actions', '../../data/store', 'useMemo', 'useState']) {
      expect(CODIGO_ENTRADA, `a projecao nao pode importar ${proibido}`).not.toContain(proibido);
    }
  });

  it('UX-3 e UX-4 seguem intactos', () => {
    expect(CODIGO_HOJE).toContain("label: 'Trabalhar a fila'");
    expect(CODIGO_HOJE).toContain('focoInvalidadoUX(contasUX, focoTrabalhoId)');
    expect((CODIGO_HOJE.match(/focoAoEntrarUX\(/g) ?? [])).toHaveLength(1);
    expect(CODIGO_HOJE).toContain('gavetaFailClosed(porQue, idsAutorizados)');
    expect(CODIGO_HOJE).toContain('pipelineAtivoUX(entradas,');
    expect(CODIGO_PANORAMA).toContain('recorteUX(pipelineAtivo, ORCAMENTO_PANORAMA_COMERCIAL.pipeline)');
  });

  it('os arquivos proibidos continuam existindo e fora do escopo deste bloco', () => {
    for (const arquivo of ['src/core/radar/commercialMachine.ts', 'src/core/radar/sinalLeitura.ts', 'src/core/radar/pipeline.ts', 'src/data/store.ts', 'src/App.tsx']) {
      expect(fs.existsSync(path.join(process.cwd(), arquivo)), arquivo).toBe(true);
    }
  });
});
