// Lead Engine LE-2B — nucleo de revisao, decisao e promocao humana.
// Nomes ficticios. Nenhuma rede, nenhum React, nenhuma escrita fora do RadarDataset em memoria.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_BLOQUEIO, DECISOES_LEAD_ENGINE, MOTIVOS_RECUSA, MOTIVO_SUPRIMIDO, analisarCandidato, aplicarDecisao,
  descobertasSuprimidas, empresaSuprimidaNoRadar, filaDeRevisao, identidadeForte, observacaoMaisRecente,
  terminalizarSuprimido, transicaoPermitida, validarDecisao,
  type ContextoDecisao, type DecisaoLeadEngine, type PedidoDecisao,
} from './leadEngineReview';
import { payloadFingerprint } from './leadEngineIntake';
import { radarVazio, type Empresa, type Fonte, type RadarDataset, type RegistroFonte, type StatusIntake, type Supressao, type TipoRegistroFonte } from './types';

// ---------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------
const AGORA = '2026-09-23T12:00:00.000Z';
const CNPJ = '11222333000181'; // digito verificador valido
const BUSINESS = 'a'.repeat(32);

const FONTE_CNO: Fonte = { id: 'FONTE-CNO', codigo: 'CNO', nome: 'Cadastro Nacional de Obras', tipo: 'CNO', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: '2026-01-01' };
const FONTE_PARTNER: Fonte = { id: 'FONTE-PARTNER', codigo: 'PARTNER', nome: 'Parceiros', tipo: 'PARTNER', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: '2026-01-01' };

const obra = (p: Record<string, unknown> = {}) => ({
  cno: 'obra-1', nomeResponsavel: 'Construtora Fictícia Alfa Ltda', cnpjResponsavel: CNPJ,
  municipio: 'Anápolis', uf: 'GO', dataInicio: '2026-09-01', nomeObra: 'Galpão Alfa', areaTotal: 4200, ...p,
});

const reg = (p: Partial<RegistroFonte> & { id: string }): RegistroFonte => {
  const payload = p.payload ?? obra();
  return {
    fonteId: FONTE_CNO.id, tipo: 'projeto' as TipoRegistroFonte, externoId: 'obra-1', recebidoEm: AGORA,
    statusIntake: 'PENDING', ...p, payload, payloadFingerprint: p.payloadFingerprint ?? payloadFingerprint(payload),
  };
};

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-01-01',
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});

const sup = (empresaId: string, tipo: Supressao['tipo'] = 'do_not_contact'): Supressao =>
  ({ id: `SUP-${empresaId}`, empresaId, tipo, motivo: 'pedido do cliente', criadoPor: 'U-1', criadoEm: '2026-08-01' });

const ds = (p: Partial<RadarDataset> = {}): RadarDataset => ({ ...radarVazio(), fontes: [FONTE_CNO, FONTE_PARTNER], ...p });

let seq = 0;
const ctx = (): ContextoDecisao => ({ novo: (pref) => `${pref}-${String(++seq).padStart(5, '0')}`, hoje: '2026-09-23', agora: AGORA, usuarioId: 'U-1' });

const pedido = (p: Partial<PedidoDecisao> & { registroFonteId: string; decisao: DecisaoLeadEngine }): PedidoDecisao =>
  ({ payloadFingerprintEsperado: payloadFingerprint(obra()), ...p });

const CODIGO = readFileSync('src/core/radar/leadEngineReview.ts', 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const FONTE_TS = semComentarios(CODIGO);

// ---------------------------------------------------------------------------------------------------------
// Fila e projecao (1-8)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · fila de revisao', () => {
  it('1-4 · so PENDING e REVIEW entram; RESOLVED e REJECTED ficam fora', () => {
    const r = ds({ registrosFonte: [
      reg({ id: 'SR-p', statusIntake: 'PENDING' }),
      reg({ id: 'SR-v', statusIntake: 'REVIEW', externoId: 'obra-2' }),
      reg({ id: 'SR-r', statusIntake: 'RESOLVED', externoId: 'obra-3', entidadeId: 'EMP-1' }),
      reg({ id: 'SR-x', statusIntake: 'REJECTED', externoId: 'obra-4' }),
    ] });
    expect(filaDeRevisao(r).map((i) => i.registroFonteId)).toEqual(['SR-p', 'SR-v']);
  });

  it('5 · ordem cronologica: o mais antigo primeiro', () => {
    const r = ds({ registrosFonte: [
      reg({ id: 'SR-b', recebidoEm: '2026-09-23T12:00:00.000Z', externoId: 'obra-b' }),
      reg({ id: 'SR-a', recebidoEm: '2026-09-20T12:00:00.000Z', externoId: 'obra-a' }),
    ] });
    expect(filaDeRevisao(r).map((i) => i.registroFonteId)).toEqual(['SR-a', 'SR-b']);
  });

  it('6 · empate desempata pelo id do registro, de forma deterministica', () => {
    const r = ds({ registrosFonte: [
      reg({ id: 'SR-z', externoId: 'obra-z' }),
      reg({ id: 'SR-a', externoId: 'obra-a' }),
    ] });
    expect(filaDeRevisao(r).map((i) => i.registroFonteId)).toEqual(['SR-a', 'SR-z']);
    // e a ordem nao depende da ordem de entrada
    const invertido = ds({ registrosFonte: [reg({ id: 'SR-a', externoId: 'obra-a' }), reg({ id: 'SR-z', externoId: 'obra-z' })] });
    expect(filaDeRevisao(invertido).map((i) => i.registroFonteId)).toEqual(['SR-a', 'SR-z']);
  });

  it('7 · nenhum score ou prioridade comercial entra na fila', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' })] });
    const item = filaDeRevisao(r)[0];
    expect(Object.keys(item)).not.toContain('priorityScore');
    expect(Object.keys(item)).not.toContain('priorityClass');
    for (const proibido of ['priorityScore', 'priorityClass', 'fitScore', 'CommercialQueue', 'construirCommercialQueue', 'recomendarAcao', 'cadencia']) {
      expect(FONTE_TS).not.toContain(proibido);
    }
  });

  it('8 · candidato de conta suprimida sai da fila acionavel, mas continua auditavel', () => {
    const r = ds({
      empresas: [emp('EMP-1', { cnpj: CNPJ })],
      supressoes: [sup('EMP-1')],
      registrosFonte: [reg({ id: 'SR-1' })],
    });
    expect(filaDeRevisao(r)).toEqual([]);
    const auditavel = descobertasSuprimidas(r);
    expect(auditavel.map((i) => i.registroFonteId)).toEqual(['SR-1']);
    expect(auditavel[0].bloqueios).toContain('SUPRIMIDO');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Identidade (9-15)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · identidade', () => {
  it('9 · CNPJ valido e identidade forte', () => {
    expect(identidadeForte({ razaoSocial: 'X', cnpj: CNPJ })).toBe(true);
    expect(identidadeForte({ razaoSocial: 'X', cnpj: '11111111111111' })).toBe(false); // repetido: invalido
  });

  it('10 · businessId de 32 hex e identidade forte', () => {
    expect(identidadeForte({ razaoSocial: 'X', businessId: BUSINESS })).toBe(true);
    expect(identidadeForte({ razaoSocial: 'X', businessId: 'curto' })).toBe(false);
  });

  it('11 · nome, cidade, UF e dominio NAO sao identidade forte', () => {
    expect(identidadeForte({ razaoSocial: 'Construtora Fictícia', cidade: 'Anápolis', uf: 'GO', dominio: 'alfa.invalid' })).toBe(false);
    expect(identidadeForte(undefined)).toBe(false);
  });

  it('12 · encontrarEmpresa e a autoridade: nao ha matcher nem limiar proprio', () => {
    const imports = [...CODIGO.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toContain('./normalizar');
    expect(FONTE_TS).toContain('encontrarEmpresa(');
    for (const proibido of ['similaridade(', 'limiar', 'LIMIAR', 'function matchEmpresa', 'leadMatcher', 'candidateMatcher']) {
      expect(FONTE_TS).not.toContain(proibido);
    }
  });

  it('13 · match certo (CNPJ igual)', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    expect(analisarCandidato(r, 'SR-1')!.match).toMatchObject({ empresaId: 'EMP-1', nivel: 'certo' });
  });

  it('14 · match provavel (razao social + local)', () => {
    const r = ds({
      empresas: [emp('EMP-1', { razaoSocial: 'Construtora Fictícia Alfa Ltda', cidade: 'Anápolis', uf: 'GO' })],
      registrosFonte: [reg({ id: 'SR-1', payload: obra({ cnpjResponsavel: undefined }) })],
    });
    expect(analisarCandidato(r, 'SR-1')!.match).toMatchObject({ empresaId: 'EMP-1', nivel: 'provavel' });
  });

  it('15 · match possivel (mesmo nome, outra localizacao)', () => {
    const r = ds({
      empresas: [emp('EMP-1', { razaoSocial: 'Construtora Fictícia Alfa Ltda', cidade: 'Goiânia', uf: 'SP' })],
      registrosFonte: [reg({ id: 'SR-1', payload: obra({ cnpjResponsavel: undefined }) })],
    });
    expect(analisarCandidato(r, 'SR-1')!.match).toMatchObject({ empresaId: 'EMP-1', nivel: 'possivel' });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Contexto (16-20)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · contexto e frescor da decisao', () => {
  it('16 · fingerprint igual permite seguir', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    const v = validarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }));
    expect(v.ok).toBe(true);
  });

  it('17 · fingerprint divergente -> CONTEXTO_MUDOU', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    const v = validarDecisao(r, { registroFonteId: 'SR-1', payloadFingerprintEsperado: 'z'.repeat(64), decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('CONTEXTO_MUDOU');
  });

  it('18 · evidencia bruta alterada -> EVIDENCIA_ALTERADA', () => {
    // impressao gravada nao corresponde ao payload de hoje: alguem mexeu no bruto
    const r = ds({ registrosFonte: [reg({ id: 'SR-1', payloadFingerprint: 'f'.repeat(64) })] });
    expect(analisarCandidato(r, 'SR-1')!.bloqueios).toContain('EVIDENCIA_ALTERADA');
    const v = validarDecisao(r, { registroFonteId: 'SR-1', payloadFingerprintEsperado: 'f'.repeat(64), decisao: 'KEEP_REVIEW' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('EVIDENCIA_ALTERADA');
  });

  it('19 · externoId do adapter divergente -> IDENTIDADE_EXTERNA_DIVERGENTE', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1', externoId: 'outro-id' })] });
    expect(analisarCandidato(r, 'SR-1')!.bloqueios).toContain('IDENTIDADE_EXTERNA_DIVERGENTE');
  });

  it('20 · observacao mais nova aberta -> OBSERVACAO_DESATUALIZADA, e a nova nao e tocada', () => {
    const nova = obra({ areaTotal: 5000 });
    const r = ds({
      empresas: [emp('EMP-1', { cnpj: CNPJ })],
      registrosFonte: [
        reg({ id: 'SR-velha', recebidoEm: '2026-09-20T12:00:00.000Z' }),
        reg({ id: 'SR-nova', recebidoEm: '2026-09-23T12:00:00.000Z', payload: nova }),
      ],
    });
    const a = analisarCandidato(r, 'SR-velha')!;
    expect(a.bloqueios).toContain('OBSERVACAO_DESATUALIZADA');
    expect(observacaoMaisRecente(r, a.registro)!.registroFonteId).toBe('SR-nova');
    const v = validarDecisao(r, pedido({ registroFonteId: 'SR-velha', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('OBSERVACAO_DESATUALIZADA');
    // a observacao mais nova continua intacta
    expect(r.registrosFonte.find((x) => x.id === 'SR-nova')!.statusIntake).toBe('PENDING');
  });
});

// ---------------------------------------------------------------------------------------------------------
// ASSOCIATE_EXISTING (21-25)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · associar a empresa existente', () => {
  const comEmpresa = (p: Partial<Empresa>) => ds({ empresas: [emp('EMP-1', { cnpj: CNPJ, ...p })], registrosFonte: [reg({ id: 'SR-1' })] });
  const associar = (r: RadarDataset, empresaId = 'EMP-1') => validarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId }));

  it('21 · empresa valida e permitida', () => { expect(associar(comEmpresa({})).ok).toBe(true); });

  it('22 · empresa inexistente -> EMPRESA_NAO_ENCONTRADA', () => {
    const v = associar(comEmpresa({}), 'EMP-404');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('EMPRESA_NAO_ENCONTRADA');
  });

  it('23 · empresa inativa -> EMPRESA_INATIVA', () => {
    const v = associar(comEmpresa({ ativo: false }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('EMPRESA_INATIVA');
  });

  it('24 · empresa mesclada -> EMPRESA_MESCLADA', () => {
    const v = associar(comEmpresa({ mescladaEm: 'EMP-9' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('EMPRESA_MESCLADA');
  });

  it('25 · empresa suprimida -> SUPRIMIDO, sem fallback para outra empresa', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ }), emp('EMP-2')], supressoes: [sup('EMP-1')], registrosFonte: [reg({ id: 'SR-1' })] });
    const v = associar(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('SUPRIMIDO');
  });

  it('50 · associar liga o entidadeId ao registro', () => {
    const r = comEmpresa({});
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const registro = x.resultado.radar.registrosFonte.find((y) => y.id === 'SR-1')!;
    expect(registro.statusIntake).toBe('RESOLVED');
    expect(x.resultado.empresaId).toBe('EMP-1');
    expect(registro.entidadeId).toBe(x.resultado.projetoId); // tipo projeto: a entidade principal e o projeto
    expect(x.resultado.empresaCriada).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CREATE_COMPANY (26-30)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · criar empresa nova', () => {
  const criar = (r: RadarDataset) => validarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' }));

  it('26 · identidade forte e sem match: permitido', () => {
    expect(criar(ds({ registrosFonte: [reg({ id: 'SR-1' })] })).ok).toBe(true);
  });

  it('27 · sem identidade forte -> SEM_IDENTIDADE_FORTE', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1', payload: obra({ cnpjResponsavel: undefined }) })] });
    const v = validarDecisao(r, { registroFonteId: 'SR-1', payloadFingerprintEsperado: payloadFingerprint(obra({ cnpjResponsavel: undefined })), decisao: 'CREATE_COMPANY' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('SEM_IDENTIDADE_FORTE');
  });

  it('28 · match certo -> JA_EXISTE_EMPRESA', () => {
    const v = criar(ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('JA_EXISTE_EMPRESA');
  });

  it('29 · match provavel -> JA_EXISTE_EMPRESA', () => {
    // empresa com a mesma razao social e local, e o candidato com businessId forte (sem CNPJ, para o match cair em provavel)
    const payload = obra({ cnpjResponsavel: undefined });
    const r = ds({ empresas: [emp('EMP-1', { razaoSocial: 'Construtora Fictícia Alfa Ltda', cidade: 'Anápolis', uf: 'GO' })], registrosFonte: [reg({ id: 'SR-1', payload })] });
    const a = analisarCandidato(r, 'SR-1')!;
    expect(a.match!.nivel).toBe('provavel');
    const v = validarDecisao(r, { registroFonteId: 'SR-1', payloadFingerprintEsperado: payloadFingerprint(payload), decisao: 'CREATE_COMPANY' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('JA_EXISTE_EMPRESA');
  });

  it('30 · match possivel preserva o fluxo canonico: nova empresa + PossivelDuplicata pendente', () => {
    const r = ds({ empresas: [emp('EMP-1', { razaoSocial: 'Construtora Fictícia Alfa Ltda', cidade: 'Goiânia', uf: 'SP' })], registrosFonte: [reg({ id: 'SR-1' })] });
    expect(analisarCandidato(r, 'SR-1')!.match!.nivel).toBe('possivel');
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.empresaCriada).toBe(true);
    expect(x.resultado.radar.empresas).toHaveLength(2);
    expect(x.resultado.radar.duplicatas.filter((d) => d.status === 'pendente')).toHaveLength(1);
  });

  it('51 · create cria a empresa quando permitido', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' })] });
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'CREATE_COMPANY' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.empresaCriada).toBe(true);
    expect(x.resultado.radar.empresas).toHaveLength(1);
    expect(x.resultado.radar.empresas[0].cnpj).toBe(CNPJ);
  });
});

// ---------------------------------------------------------------------------------------------------------
// KEEP_REVIEW e REJECT (31-34)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · manter em revisao e rejeitar', () => {
  it('31 · KEEP_REVIEW leva PENDING para REVIEW', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' })] });
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'KEEP_REVIEW' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.status).toBe('REVIEW');
    expect(x.resultado.radar.registrosFonte[0].statusIntake).toBe('REVIEW');
  });

  it('32 · KEEP_REVIEW em REVIEW e idempotente', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1', statusIntake: 'REVIEW' })] });
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'KEEP_REVIEW' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar).toBe(r); // nada foi reescrito
  });

  it('33 · REJECT exige motivo', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' })] });
    const v = validarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'REJECT' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivos).toContain('MOTIVO_OBRIGATORIO');
  });

  it('34 · REJECT grava ator, data e motivo', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' })] });
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'REJECT', motivo: '  fora do perfil  ' }), ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const reg1 = x.resultado.radar.registrosFonte[0];
    expect(reg1.statusIntake).toBe('REJECTED');
    expect(reg1.motivoDecisao).toBe('fora do perfil');
    expect(reg1.decididoEm).toBe(AGORA);
    expect(reg1.decididoPor).toBe('U-1');
    expect(reg1.payload).toEqual(obra()); // bruto preservado
  });
});

// ---------------------------------------------------------------------------------------------------------
// Supressao (35-41)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · supressao vence redescoberta (D-12)', () => {
  const suprimido = () => ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], supressoes: [sup('EMP-1')], registrosFonte: [reg({ id: 'SR-1' })] });

  it('35 · redescoberta suprimida nao promove, por nenhuma decisao', () => {
    const r = suprimido();
    for (const decisao of ['ASSOCIATE_EXISTING', 'CREATE_COMPANY', 'KEEP_REVIEW'] as DecisaoLeadEngine[]) {
      const v = validarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao, empresaId: 'EMP-1' }));
      expect(v.ok, decisao).toBe(false);
      if (!v.ok) expect(v.motivos, decisao).toContain('SUPRIMIDO');
    }
  });

  it('36-37 · pode ser terminalizada em REJECTED com motivo SUPRIMIDO', () => {
    const x = terminalizarSuprimido(suprimido(), 'SR-1', ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const reg1 = x.resultado.radar.registrosFonte[0];
    expect(reg1.statusIntake).toBe('REJECTED');
    expect(reg1.motivoDecisao).toBe(MOTIVO_SUPRIMIDO);
    expect(MOTIVO_SUPRIMIDO).toBe('SUPRIMIDO');
    expect(reg1.decididoEm).toBe(AGORA);
    expect(reg1.decididoPor).toBe('U-1');
  });

  it('38-40 · terminalizar nao cria Empresa, Projeto nem Sinal', () => {
    const r = suprimido();
    const x = terminalizarSuprimido(r, 'SR-1', ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.empresas).toHaveLength(1); // a que ja existia
    expect(x.resultado.radar.projetos).toEqual([]);
    expect(x.resultado.radar.sinais).toEqual([]);
    expect(x.resultado.sinalIds).toEqual([]);
    expect(x.resultado.empresaCriada).toBe(false);
  });

  it('41 · a supressao existente permanece intacta e a conta nao e reativada', () => {
    const r = suprimido();
    const x = terminalizarSuprimido(r, 'SR-1', ctx());
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.supressoes).toEqual(r.supressoes);
    expect(empresaSuprimidaNoRadar('EMP-1', x.resultado.radar)).toBe(true);
    expect(x.resultado.radar.empresas[0].ativo).toBe(true); // nada de mexer no cadastro
  });

  it('terminalizar so vale para suprimido: candidato normal e recusado', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    const x = terminalizarSuprimido(r, 'SR-1', ctx());
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.motivos).toContain('NAO_SUPRIMIDO');
  });

  it('opt_out tambem suprime; email_bounced (nivel contato) nao', () => {
    const base = { empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] };
    expect(filaDeRevisao(ds({ ...base, supressoes: [sup('EMP-1', 'opt_out')] }))).toEqual([]);
    expect(filaDeRevisao(ds({ ...base, supressoes: [sup('EMP-1', 'email_bounced')] }))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Maquina de estados (42-49)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · maquina de transicao e autoridade', () => {
  it('42-46 · transicoes permitidas', () => {
    expect(transicaoPermitida('PENDING', 'REVIEW')).toBe(true);
    expect(transicaoPermitida('PENDING', 'RESOLVED')).toBe(true);
    expect(transicaoPermitida('PENDING', 'REJECTED')).toBe(true);
    expect(transicaoPermitida('REVIEW', 'RESOLVED')).toBe(true);
    expect(transicaoPermitida('REVIEW', 'REJECTED')).toBe(true);
  });

  it('47-48 · terminal e terminal: RESOLVED e REJECTED nao vao para lugar nenhum', () => {
    for (const para of ['PENDING', 'REVIEW', 'RESOLVED', 'REJECTED'] as StatusIntake[]) {
      expect(transicaoPermitida('RESOLVED', para), `RESOLVED -> ${para}`).toBe(false);
      expect(transicaoPermitida('REJECTED', para), `REJECTED -> ${para}`).toBe(false);
    }
  });

  it('49 · REVIEW nunca regride para PENDING', () => {
    expect(transicaoPermitida('REVIEW', 'PENDING')).toBe(false);
    expect(transicaoPermitida('PENDING', 'PENDING')).toBe(false);
  });

  it('a decisao sobre registro terminal falha fechada', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1', statusIntake: 'RESOLVED', entidadeId: 'EMP-1' })] });
    const x = aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), ctx());
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.motivos).toContain('STATUS_TERMINAL');
  });

  it('toda mutacao de statusIntake passa por transicaoPermitida', () => {
    // a unica funcao que escreve statusIntake e `transicionar`, e ela consulta a maquina antes
    const corpo = FONTE_TS.slice(FONTE_TS.indexOf('function transicionar'), FONTE_TS.indexOf('export function terminalizarSuprimido'));
    expect(corpo).toContain('transicaoPermitida(de, para)');
    expect(corpo).toContain("motivos: ['TRANSICAO_INVALIDA']");
    // e nenhuma outra parte do modulo escreve o campo direto
    const fora = FONTE_TS.split('function transicionar')[0] + FONTE_TS.slice(FONTE_TS.indexOf('export function terminalizarSuprimido'));
    expect(fora).not.toContain('statusIntake:');
  });

  it('BLOQUEIO_DURO (codigo morto do modulo orfao) nao foi trazido', () => {
    expect(CODIGO).not.toContain('BLOQUEIO_DURO');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Promocao (52-58)
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · promocao', () => {
  const promover = () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    return aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), ctx());
  };

  it('52 · projeto entra pelo upsertProjeto, ligado a empresa raiz', () => {
    const x = promover();
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.projetos).toHaveLength(1);
    expect(x.resultado.radar.projetos[0].empresaId).toBe('EMP-1');
    expect(x.resultado.radar.projetos[0].nome).toBe('Galpão Alfa');
    expect(x.resultado.projetoId).toBe(x.resultado.radar.projetos[0].id);
  });

  it('53 · sinal entra pelo registrarSinalNormalizado, com a confiabilidade da fonte aplicada', () => {
    const x = promover();
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.sinais).toHaveLength(1);
    const sinal = x.resultado.radar.sinais[0];
    expect(sinal.empresaId).toBe('EMP-1');
    expect(sinal.fonteId).toBe(FONTE_CNO.id);
    expect(sinal.confianca).toBeCloseTo(0.9 * 0.9, 5); // confianca do adapter x confiabilidade da fonte
    expect(x.resultado.sinalIds).toEqual([sinal.id]);
  });

  it('54 · a linhagem do sinal e o payload BRUTO do RegistroFonte', () => {
    const x = promover();
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.sinais[0].payload).toEqual(obra());
    // Os adapters de hoje ecoam `payload: bruto`, entao uma asserção de valor nao distingue as duas origens.
    // A garantia real e estrutural: a promocao le o bruto do proprio RegistroFonte, nunca o eco do adapter.
    const corpo = FONTE_TS.slice(FONTE_TS.indexOf('export function aplicarDecisao'));
    expect(corpo).toContain('payload: bruto.payload');
    expect(corpo).not.toContain('payload: normalizado.payload');
  });

  it('55-58 · promocao nao cria oportunidade, tarefa, atividade nem comunicacao', () => {
    const x = promover();
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.oportunidades).toEqual([]);
    expect(x.resultado.radar.tarefas).toEqual([]);
    expect(x.resultado.radar.atividades).toEqual([]);
    expect(x.resultado.radar.comunicacoes).toEqual([]);
    for (const proibido of ['oportunidades:', 'tarefas:', 'atividades:', 'comunicacoes:', 'Oportunidade', 'TarefaRadar']) {
      expect(FONTE_TS).not.toContain(proibido);
    }
  });

  it('nenhum segundo RegistroFonte e criado, e ingerirRegistro nunca e usado', () => {
    const x = promover();
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.resultado.radar.registrosFonte).toHaveLength(1);
    expect(FONTE_TS).not.toContain('ingerirRegistro');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Fronteiras do modulo
// ---------------------------------------------------------------------------------------------------------
describe('LE-2B · o nucleo e puro', () => {
  it('nao fala com rede, banco, store nem React', () => {
    for (const proibido of ['fetch(', 'supabase', "from '../../data", 'react', 'useState', 'actions.', 'window.', 'localStorage']) {
      expect(FONTE_TS).not.toContain(proibido);
    }
  });

  it('importa apenas core do Radar', () => {
    const imports = [...CODIGO.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./adapters', './adapters', './ingestao', './leadEngineIntake', './normalizar', './types']);
  });

  it('os catalogos estao completos e fechados', () => {
    expect(DECISOES_LEAD_ENGINE).toEqual(['ASSOCIATE_EXISTING', 'CREATE_COMPANY', 'KEEP_REVIEW', 'REJECT']);
    expect(CODIGOS_BLOQUEIO).toContain('SUPRIMIDO');
    expect(MOTIVOS_RECUSA).toContain('TRANSICAO_INVALIDA');
    expect(MOTIVOS_RECUSA).toContain('NAO_SUPRIMIDO');
  });

  it('o barril exporta os dois modulos do Lead Engine', () => {
    const barril = readFileSync('src/core/radar/index.ts', 'utf8');
    expect(barril).toContain("export * from './leadEngineIntake';");
    expect(barril).toContain("export * from './leadEngineReview';");
  });

  it('aplicarDecisao nao muta o dataset recebido', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    const antes = JSON.stringify(r);
    aplicarDecisao(r, pedido({ registroFonteId: 'SR-1', decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' }), ctx());
    expect(JSON.stringify(r)).toBe(antes);
  });
});
