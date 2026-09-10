// Identidade da Central: chave (organizacao, contexto, telefone), ciclo PENDING -> VERIFIED -> REVOKED e codigo de
// verificacao de vida curta. Nada de rede, nada de IA, nada de banco.
import { describe, expect, it } from 'vitest';
import {
  MAX_TENTATIVAS_CODIGO, TRANSICOES_IDENTIDADE, abrirDesafioVerificacao, comparacaoConstante, concluirVerificacao,
  conferirCodigoVerificacao, conflitoDeVerificacao, descreverDesafio, descreverIdentidade, gerarCodigoVerificacao,
  identidadesDaPessoa, resolverIdentidadeCentral, revogarIdentidade, telefoneCentral, transicaoPermitida,
  transicionarIdentidade, type FonteAleatoria, type WhatsappIdentity,
} from './identidade';

const TELEFONE = '5562988887777';
const OUTRO = '5562911112222';
const AGORA = '2026-09-10T12:00:00.000Z';
const base: WhatsappIdentity = {
  id: 'i1', organizationId: 'org-1', usuarioId: 'u-augusto', telefoneNormalizado: TELEFONE,
  contexto: 'INTERNAL', situacao: 'VERIFIED', criadoEm: '2026-09-01T00:00:00.000Z',
};
/** Fonte deterministica: devolve sempre a mesma sequencia, para o teste conferir o codigo gerado. */
const fonteFixa = (valores: number[]): FonteAleatoria => ({ bytes: (n) => Uint8Array.from(Array.from({ length: n }, (_, i) => valores[i % valores.length])) });

describe('telefone da Central', () => {
  it('normaliza pela regra única do canal e recusa o que não é E.164', () => {
    expect(telefoneCentral('+55 (62) 98888-7777').telefone).toBe(TELEFONE);
    expect(telefoneCentral('62 98888-7777').telefone).toBe(TELEFONE); // sem DDI vira BR
    expect(telefoneCentral('123').ok).toBe(false);
    expect(telefoneCentral(undefined).motivo).toBe('telefone ausente');
    // o motivo nunca traz o número inteiro
    expect(telefoneCentral('+55 62 98888-7777').motivo).not.toContain(TELEFONE);
  });
});

describe('resolução por (organização, contexto, telefone)', () => {
  it('identidade de outra organização NUNCA resolve', () => {
    expect(resolverIdentidadeCentral(TELEFONE, [base], { organizationId: 'org-1', contexto: 'INTERNAL' }).verificada).toBe(true);
    const outra = resolverIdentidadeCentral(TELEFONE, [base], { organizationId: 'org-2', contexto: 'INTERNAL' });
    expect(outra).toMatchObject({ conhecida: false, verificada: false });
  });
  it('identidade de outro contexto NUNCA resolve, e contexto indefinido também não', () => {
    expect(resolverIdentidadeCentral(TELEFONE, [base], { organizationId: 'org-1', contexto: 'EXTERNAL' }).conhecida).toBe(false);
    const indefinido = resolverIdentidadeCentral(TELEFONE, [base], { organizationId: 'org-1' });
    expect(indefinido.verificada).toBe(false);
    expect(indefinido.motivo).toMatch(/não confiável/);
  });
  it('aceita o telefone em qualquer formato e recusa o inválido, sem vazar o número', () => {
    expect(resolverIdentidadeCentral('+55 62 98888-7777', [base], { organizationId: 'org-1', contexto: 'INTERNAL' }).verificada).toBe(true);
    const ruim = resolverIdentidadeCentral('123', [base], { organizationId: 'org-1', contexto: 'INTERNAL' });
    expect(ruim).toMatchObject({ conhecida: false, verificada: false });
    expect(ruim.motivo).not.toContain('123');
  });
  it('uma pessoa pode ter vários números', () => {
    const segundo: WhatsappIdentity = { ...base, id: 'i2', telefoneNormalizado: OUTRO };
    expect(identidadesDaPessoa([base, segundo], { organizationId: 'org-1', usuarioId: 'u-augusto' })).toHaveLength(2);
    for (const t of [TELEFONE, OUTRO]) {
      expect(resolverIdentidadeCentral(t, [base, segundo], { organizationId: 'org-1', contexto: 'INTERNAL' }).verificada).toBe(true);
    }
  });
});

describe('ciclo de vida da identidade', () => {
  it('só as transições da tabela são permitidas; REVOKED é terminal', () => {
    expect(TRANSICOES_IDENTIDADE.REVOKED).toEqual([]);
    expect(transicaoPermitida('PENDING', 'VERIFIED')).toBe(true);
    expect(transicaoPermitida('PENDING', 'REVOKED')).toBe(true);
    expect(transicaoPermitida('VERIFIED', 'PENDING')).toBe(false);
    expect(transicaoPermitida('REVOKED', 'VERIFIED')).toBe(false);
    const pendente: WhatsappIdentity = { ...base, situacao: 'PENDING' };
    expect(transicionarIdentidade(pendente, 'VERIFIED', AGORA)).toMatchObject({ ok: true });
    expect(transicionarIdentidade(pendente, 'VERIFIED', AGORA).identidade?.verificadoEm).toBe(AGORA);
    expect(transicionarIdentidade({ ...base, situacao: 'REVOKED' }, 'VERIFIED', AGORA)).toMatchObject({ ok: false });
    expect(transicionarIdentidade(base, 'VERIFIED', AGORA).motivo).toMatch(/já está/);
    expect(revogarIdentidade(base, AGORA).identidade).toMatchObject({ situacao: 'REVOKED', revogadoEm: AGORA });
    // pura: a identidade recebida não muda
    expect(pendente.situacao).toBe('PENDING');
  });
  it('o mesmo número não fica VERIFIED para duas pessoas no mesmo contexto', () => {
    const dela: WhatsappIdentity = { ...base, id: 'i9', usuarioId: 'u-maria' };
    const minha: WhatsappIdentity = { ...base, id: 'i1', situacao: 'PENDING' };
    expect(conflitoDeVerificacao({ ...minha, situacao: 'VERIFIED' }, [dela])?.id).toBe('i9');
    expect(transicionarIdentidade(minha, 'VERIFIED', AGORA, [dela])).toMatchObject({ ok: false });
    expect(transicionarIdentidade(minha, 'VERIFIED', AGORA, [dela]).motivo).not.toContain(TELEFONE);
    // no OUTRO contexto o mesmo número pode pertencer a outra pessoa (contextos não se misturam)
    expect(conflitoDeVerificacao({ ...minha, situacao: 'VERIFIED' }, [{ ...dela, contexto: 'EXTERNAL' }])).toBeUndefined();
    // a própria pessoa reverificando o próprio número não é conflito
    expect(conflitoDeVerificacao({ ...minha, situacao: 'VERIFIED' }, [{ ...base, id: 'i7' }])).toBeUndefined();
  });
});

describe('código de verificação', () => {
  it('só dígitos, tamanho pedido e sem viés de módulo (bytes ≥ 250 descartados)', () => {
    expect(gerarCodigoVerificacao(6, fonteFixa([1, 2, 3, 4, 5, 6]))).toBe('123456');
    expect(gerarCodigoVerificacao(4, fonteFixa([250, 255, 7, 8, 9, 10]))).toBe('7890');
    expect(gerarCodigoVerificacao(6, fonteFixa([13, 27, 41, 59, 66, 78]))).toMatch(/^\d{6}$/);
  });
  it('comparação de tempo constante decide certo, inclusive com tamanhos diferentes', () => {
    expect(comparacaoConstante('123456', '123456')).toBe(true);
    expect(comparacaoConstante('123456', '123457')).toBe(false);
    expect(comparacaoConstante('123456', '12345')).toBe(false);
    expect(comparacaoConstante('', '')).toBe(true);
  });
  it('confere código certo, errado, expirado e bloqueado por tentativas', () => {
    const pendente: WhatsappIdentity = { ...base, situacao: 'PENDING' };
    const desafio = abrirDesafioVerificacao(pendente, AGORA, { fonte: fonteFixa([1, 2, 3, 4, 5, 6]) });
    expect(desafio.expiraEm).toBe('2026-09-10T12:10:00.000Z');
    expect(conferirCodigoVerificacao(desafio, '123456', AGORA)).toMatchObject({ ok: true });
    expect(conferirCodigoVerificacao(desafio, '12 34 56', AGORA).ok).toBe(true); // dígitos separados valem
    expect(conferirCodigoVerificacao(desafio, '999999', AGORA)).toMatchObject({ ok: false, motivo: 'código não confere' });
    expect(conferirCodigoVerificacao(desafio, '123456', '2026-09-10T12:11:00.000Z').motivo).toMatch(/expirado/);
    expect(conferirCodigoVerificacao({ ...desafio, tentativas: MAX_TENTATIVAS_CODIGO }, '123456', AGORA).motivo).toMatch(/tentativas/);
    // toda tentativa é contada, mesmo a errada
    expect(conferirCodigoVerificacao(desafio, '999999', AGORA).desafio.tentativas).toBe(1);
  });
  it('a verificação completa exige o desafio DESTA identidade e leva PENDING → VERIFIED', () => {
    const pendente: WhatsappIdentity = { ...base, situacao: 'PENDING' };
    const desafio = abrirDesafioVerificacao(pendente, AGORA, { fonte: fonteFixa([1, 2, 3, 4, 5, 6]) });
    const ok = concluirVerificacao(pendente, desafio, '123456', AGORA);
    expect(ok.ok).toBe(true);
    expect(ok.identidade).toMatchObject({ situacao: 'VERIFIED', verificadoEm: AGORA });
    // desafio de outra identidade não vale, nem com o código certo
    const outraPessoa: WhatsappIdentity = { ...pendente, id: 'i2', usuarioId: 'u-maria' };
    expect(concluirVerificacao(outraPessoa, desafio, '123456', AGORA)).toMatchObject({ ok: false, motivo: 'desafio não pertence a esta identidade' });
    // código certo mas número já verificado para outra pessoa: não verifica
    expect(concluirVerificacao(pendente, desafio, '123456', AGORA, [{ ...base, id: 'i9', usuarioId: 'u-maria' }]).ok).toBe(false);
  });
  it('o código NUNCA aparece em texto de saída e o telefone sai mascarado', () => {
    const desafio = abrirDesafioVerificacao({ ...base, situacao: 'PENDING' }, AGORA, { fonte: fonteFixa([1, 2, 3, 4, 5, 6]) });
    const textos = [
      descreverDesafio(desafio), descreverIdentidade(base),
      conferirCodigoVerificacao(desafio, '999999', AGORA).motivo,
      concluirVerificacao({ ...base, situacao: 'PENDING' }, desafio, '123456', AGORA).motivo,
      transicionarIdentidade({ ...base, situacao: 'PENDING' }, 'VERIFIED', AGORA, [{ ...base, id: 'i9', usuarioId: 'u-maria' }]).motivo,
    ];
    for (const t of textos) {
      expect(t, t).not.toContain('123456');
      expect(t, t).not.toContain(TELEFONE);
    }
    expect(descreverDesafio(desafio)).toContain('5562*******77');
  });
});
