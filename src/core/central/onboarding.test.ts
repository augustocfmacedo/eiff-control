// Onboarding de identidade do WhatsApp (Wave 03, F3): invariantes 11 e 12, autoridade, contrato fechado e
// vazamentos. Nenhuma chamada real: as portas sao um banco em memoria que espelha a semantica das RPCs da
// migration 0049 (renovacao do PENDING da mesma pessoa, segunda linha para outra pessoa, teto de tentativas,
// expiracao, VERIFIED so por verify, REVOKED terminal).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pode } from '../../data/store';
import type { Papel, Usuario } from '../types';
import { MAX_TENTATIVAS_CODIGO, TAMANHO_CODIGO, VALIDADE_CODIGO_MINUTOS, hashCodigoVerificacao, type FonteAleatoria } from './identidade';
import {
  COLUNAS_IDENTIDADE, MOTIVO_REVOGACAO_RENOVACAO, PAPEIS_VER_CENTRAL, autenticarCentral, conferirCodigoRecebido, extrairCodigoVerificacao,
  linhaParaTela, listarParaTela, revogarIdentidade, solicitarIdentidade, temVerCentral, tratarCentralIdentidade, validarPedidoIdentidade,
  type ArgsRequest, type ArgsTransition, type ArgsVerify, type DepsIdentidadeApi, type LinhaIdentidade, type PortasIdentidade, type RespostaRpc,
} from './onboarding';
import { portasSupabase } from '../../../netlify/functions/central-identidade';

// ------------------------------------------------------------------------------------ fixtures

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Administrador da ORG
const FIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Financeiro da ORG
const GESTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // Gestor de obra da ORG (sem ver_central)
const ADMIN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // Administrador da ORG_B
const WORKER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // colaborador da ORG
const TEL = '+55 (62) 99999-1234';
const TEL_E164 = '5562999991234';
const TEL_MASC = '5562*******34';
const T0 = '2026-09-11T12:00:00.000Z';
const mais = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

/** bytes fixos: cada chamada gera um codigo diferente e previsivel (0..9 por byte, sem descarte) */
function fonteFixa(seq: string[]): FonteAleatoria {
  let i = 0;
  return { bytes: (n) => { const c = seq[i++ % seq.length]; return Uint8Array.from({ length: n }, (_, k) => Number(c[k % c.length])); } };
}

const PERFIS: Record<string, { org: string; role: Papel; active: boolean }> = {
  [ADMIN]: { org: ORG, role: 'Administrador', active: true },
  [FIN]: { org: ORG, role: 'Financeiro', active: true },
  [GESTOR]: { org: ORG, role: 'Gestor de obra', active: true },
  [ADMIN_B]: { org: ORG_B, role: 'Administrador', active: true },
};
const PAPEIS_RPC = ['Administrador', 'Diretoria', 'Financeiro'];

interface Linha extends LinhaIdentidade { verification_code_hash: string | null }
interface Chamada { rpc: 'request' | 'verify' | 'transition' | 'listar'; args: unknown }

/** Banco em memoria com as MESMAS regras das RPCs da 0049. `agora` e o relogio do banco. */
function bancoFalso(opts: { agora?: () => string } = {}) {
  const linhas: Linha[] = [];
  // uma fonte por banco: solicitacoes consecutivas geram codigos diferentes e previsiveis (123456, 987654, 555555, ...)
  const fonte = fonteFixa(['1234567890', '9876543210', '5555555555', '2468013579']);
  const chamadas: Chamada[] = [];
  let seq = 0;
  const agora = () => (opts.agora ?? (() => T0))();
  const novoId = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const portas: PortasIdentidade = {
    async rpcRequest(a: ArgsRequest): Promise<RespostaRpc> {
      chamadas.push({ rpc: 'request', args: a });
      const p = PERFIS[a.p_user_id];
      if (!p || !p.active) return { ok: false, erro: 'sem_perfil' };
      const alvo = a.p_profile_id ?? (a.p_worker_id ? null : a.p_user_id);
      if ((alvo ?? '0') !== a.p_user_id && !PAPEIS_RPC.includes(p.role)) return { ok: false, erro: 'sem_permissao' };
      if (alvo && PERFIS[alvo]?.org !== p.org) return { ok: false, erro: 'pessoa_de_outra_organizacao' };
      const ver = linhas.find((l) => l.organization_id === p.org && l.context === a.p_context && l.phone_e164 === a.p_phone && l.status === 'VERIFIED');
      if (ver && (ver.profile_id !== alvo || !alvo)) return { ok: false, erro: 'numero_ja_verificado_para_outra_pessoa' };
      const pend = linhas.filter((l) => l.organization_id === p.org && l.context === a.p_context && l.phone_e164 === a.p_phone && l.status === 'PENDING' && l.profile_id === alvo && l.worker_id === a.p_worker_id).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
      if (pend) { pend.verification_code_hash = a.p_code_hash; pend.verification_expires_at = a.p_expires_at; pend.verification_attempts = 0; return { ok: true, existente: true, identity_id: pend.id, status: 'PENDING' }; }
      const id = novoId();
      linhas.push({ id, organization_id: p.org, profile_id: alvo, worker_id: a.p_worker_id, phone_e164: a.p_phone, context: a.p_context, status: 'PENDING', verification_code_hash: a.p_code_hash, verification_expires_at: a.p_expires_at, verification_attempts: 0, verified_at: null, revoked_at: null, revoke_reason: null, requested_by: a.p_user_id, created_at: `${agora().slice(0, 19)}.${String(seq).padStart(3, '0')}Z` });
      return { ok: true, existente: false, identity_id: id, status: 'PENDING' };
    },
    async rpcVerify(a: ArgsVerify): Promise<RespostaRpc> {
      chamadas.push({ rpc: 'verify', args: a });
      if (!/^[0-9a-f]{64}$/.test(a.p_code_hash)) return { ok: false, erro: 'hash_invalido' };
      const p = PERFIS[a.p_user_id];
      if (!p || !p.active) return { ok: false, erro: 'sem_perfil' };
      const l = linhas.find((x) => x.id === a.p_identity_id);
      if (!l) return { ok: false, erro: 'identidade_nao_encontrada' };
      if (l.organization_id !== p.org) return { ok: false, erro: 'identidade_de_outra_organizacao' };
      if (l.profile_id !== a.p_user_id && !PAPEIS_RPC.includes(p.role)) return { ok: false, erro: 'sem_permissao' };
      if (l.status !== 'PENDING') return { ok: false, erro: 'transicao_invalida', de: l.status };
      if (!l.verification_code_hash) return { ok: false, erro: 'sem_desafio' };
      if (!l.verification_expires_at || l.verification_expires_at < agora()) return { ok: false, erro: 'codigo_expirado' };
      const teto = Math.min(Math.max(a.p_max_attempts ?? 5, 1), 5); // o banco nunca afrouxa acima de 5
      if (l.verification_attempts >= teto) return { ok: false, erro: 'tentativas_excedidas', tentativas: l.verification_attempts, limite: 5 };
      if (l.verification_code_hash !== a.p_code_hash) { l.verification_attempts += 1; return { ok: false, erro: 'codigo_nao_confere', tentativas: l.verification_attempts }; }
      l.status = 'VERIFIED'; l.verified_at = agora(); l.verification_code_hash = null; l.verification_expires_at = null; l.verification_attempts = 0;
      return { ok: true, identity_id: l.id, status: 'VERIFIED' };
    },
    async rpcTransition(a: ArgsTransition): Promise<RespostaRpc> {
      chamadas.push({ rpc: 'transition', args: a });
      if (a.p_to_status !== 'REVOKED') return { ok: false, erro: 'situacao_invalida' };
      const p = PERFIS[a.p_user_id];
      if (!p || !p.active) return { ok: false, erro: 'sem_perfil' };
      const l = linhas.find((x) => x.id === a.p_identity_id);
      if (!l) return { ok: false, erro: 'identidade_nao_encontrada' };
      if (l.organization_id !== p.org) return { ok: false, erro: 'identidade_de_outra_organizacao' };
      if (l.profile_id !== a.p_user_id && !PAPEIS_RPC.includes(p.role)) return { ok: false, erro: 'sem_permissao' };
      if (l.status === 'REVOKED') return { ok: false, erro: 'transicao_invalida', de: l.status };
      const de = l.status;
      l.status = 'REVOKED'; l.revoked_at = agora(); l.revoke_reason = a.p_reason.slice(0, 500); l.verification_code_hash = null; l.verification_expires_at = null;
      return { ok: true, identity_id: l.id, de, status: 'REVOKED' };
    },
    async listarIdentidades(organizationId, contexto) {
      chamadas.push({ rpc: 'listar', args: { organizationId, contexto } });
      // o SELECT real nunca traz o hash (COLUNAS_IDENTIDADE): o mock espelha isso
      return linhas.filter((l) => l.organization_id === organizationId && (!contexto || l.context === contexto)).map((l) => { const c = { ...l } as Partial<Linha>; delete c.verification_code_hash; return c as LinhaIdentidade; });
    },
  };
  return { portas, linhas, chamadas, fonte };
}

const pedidoBase = (db: ReturnType<typeof bancoFalso>, extra: Partial<Parameters<typeof solicitarIdentidade>[1]> = {}) => ({
  organizationId: ORG, solicitanteId: ADMIN, papel: 'Administrador', contexto: 'INTERNAL', telefoneBruto: TEL, workerId: WORKER, agoraIso: T0, aleatorio: db.fonte, ...extra,
});
const conferir = (portas: PortasIdentidade, texto: string, agoraIso = T0, extra: Partial<Parameters<typeof conferirCodigoRecebido>[1]> = {}) =>
  conferirCodigoRecebido(portas, { organizationId: ORG, contexto: 'INTERNAL', telefoneNormalizado: TEL_E164, textoRecebido: texto, agoraIso, ...extra });

// ---------------------------------------------------------------------------------- autoridade

describe('autoridade: ver_central espelhado da MATRIZ do store', () => {
  const usuario = (papel: Papel): Usuario => ({ id: 'u-t', nome: 'Teste', email: 't@eiff.com.br', papel, obras: '*', ativo: true });
  it('PAPEIS_VER_CENTRAL coincide papel a papel com pode(usuario, "ver_central")', () => {
    for (const p of ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria'] as Papel[]) {
      expect(temVerCentral(p), p).toBe(pode(usuario(p), 'ver_central'));
    }
    expect([...PAPEIS_VER_CENTRAL].sort()).toEqual(['Administrador', 'Diretoria', 'Financeiro']);
    expect(temVerCentral(undefined)).toBe(false);
    expect(temVerCentral('administrador')).toBe(false); // caixa importa: o papel vem do enum do banco
  });
});

// ------------------------------------------------------------------------------- solicitar vinculo

describe('solicitarIdentidade', () => {
  it('cria o PENDING com o HASH (nunca o codigo), devolve o codigo uma vez e o telefone mascarado', async () => {
    const db = bancoFalso();
    const r = await solicitarIdentidade(db.portas, pedidoBase(db));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.codigo).toHaveLength(TAMANHO_CODIGO);
    expect(r.codigo).toBe('123456');
    expect(r.telefoneMascarado).toBe(TEL_MASC);
    expect(r.expiraEm).toBe(mais(T0, VALIDADE_CODIGO_MINUTOS));
    expect(r.revogadosAntes).toBe(0);
    const req = db.chamadas.find((c) => c.rpc === 'request')!.args as ArgsRequest;
    expect(req.p_code_hash).toBe(hashCodigoVerificacao('123456'));
    expect(req.p_phone).toBe(TEL_E164);
    expect(req.p_worker_id).toBe(WORKER);
    expect(req.p_profile_id).toBeNull();
    expect(JSON.stringify(req)).not.toContain('123456');
    expect(db.linhas[0].verification_code_hash).toBe(hashCodigoVerificacao('123456'));
  });

  it('papel sem ver_central e recusado antes de qualquer porta', async () => {
    const db = bancoFalso();
    for (const papel of ['Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', '']) {
      expect(await solicitarIdentidade(db.portas, pedidoBase(db, { solicitanteId: GESTOR, papel }))).toEqual({ ok: false, erro: 'sem_permissao' });
    }
    expect(db.chamadas).toHaveLength(0);
  });

  it('contexto EXTERNAL e recusado nesta wave', async () => {
    const db = bancoFalso();
    expect(await solicitarIdentidade(db.portas, pedidoBase(db, { contexto: 'EXTERNAL' }))).toEqual({ ok: false, erro: 'contexto_nao_suportado' });
    expect(await solicitarIdentidade(db.portas, pedidoBase(db, { contexto: 'interno' }))).toEqual({ ok: false, erro: 'contexto_nao_suportado' });
    expect(db.chamadas).toHaveLength(0);
  });

  it('pessoa ausente, dupla ou com id invalido e recusada', async () => {
    const db = bancoFalso();
    expect(await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: undefined }))).toEqual({ ok: false, erro: 'pessoa_ausente' });
    expect(await solicitarIdentidade(db.portas, pedidoBase(db, { profileId: FIN }))).toEqual({ ok: false, erro: 'pessoa_dupla' });
    expect(await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: 'colab-1' }))).toEqual({ ok: false, erro: 'pessoa_invalida' });
    expect(db.chamadas).toHaveLength(0);
  });

  it('telefone invalido e recusado sem revelar o numero', async () => {
    const db = bancoFalso();
    for (const t of ['', '123', 'abc', '5562999', '+1 555 0100 12345678']) {
      const r = await solicitarIdentidade(db.portas, pedidoBase(db, { telefoneBruto: t }));
      expect(r, t).toEqual({ ok: false, erro: 'telefone_invalido' });
    }
    expect(db.chamadas).toHaveLength(0);
  });

  it('organizacao do ator diferente da pessoa: a RPC recusa e o erro e fechado', async () => {
    const db = bancoFalso();
    // ADMIN_B (ORG_B) tenta vincular o numero de FIN (ORG): a RPC ve org do perfil, nao o que o cliente diz
    const r = await solicitarIdentidade(db.portas, pedidoBase(db, { organizationId: ORG_B, solicitanteId: ADMIN_B, workerId: undefined, profileId: FIN }));
    expect(r).toMatchObject({ ok: false, erro: 'pessoa_de_outra_organizacao' });
    expect(db.linhas).toHaveLength(0);
  });

  it('numero ja VERIFIED para outra pessoa no mesmo contexto: 409 fechado, nada criado', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: undefined, profileId: FIN }));
    if (!a.ok) throw new Error(a.erro);
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('verificada');
    const b = await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: WORKER }));
    expect(b).toMatchObject({ ok: false, erro: 'numero_ja_verificado_para_outra_pessoa' });
    expect(db.linhas).toHaveLength(1);
  });

  it('porta indisponivel (excecao) vira estado nomeado, nunca excecao', async () => {
    const db = bancoFalso();
    const quebrada: PortasIdentidade = { ...db.portas, listarIdentidades: async () => { throw new Error('rede'); } };
    expect(await solicitarIdentidade(quebrada, pedidoBase(db))).toMatchObject({ ok: false, erro: 'indisponivel' });
    const quebrada2: PortasIdentidade = { ...db.portas, rpcRequest: async () => { throw new Error('rede'); } };
    expect(await solicitarIdentidade(quebrada2, pedidoBase(db))).toMatchObject({ ok: false, erro: 'indisponivel' });
  });
});

// -------------------------------------------------------------------- invariante 12: nova solicitacao invalida

describe('invariante 12: nova solicitacao invalida os codigos anteriores da mesma chave', () => {
  it('a segunda solicitacao revoga o PENDING anterior ANTES do novo request, e o codigo antigo nao verifica', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const marca = db.chamadas.length;
    const b = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!b.ok) throw new Error(b.erro);
    expect(b.codigo).not.toBe(a.codigo);
    expect(b.revogadosAntes).toBe(1);
    expect(b.identidadeId).not.toBe(a.identidadeId);
    // ordem: listar -> transition(REVOKED da anterior) -> request(nova)
    const seq = db.chamadas.slice(marca).map((c) => c.rpc);
    expect(seq).toEqual(['listar', 'transition', 'request']);
    const t = db.chamadas.slice(marca).find((c) => c.rpc === 'transition')!.args as ArgsTransition;
    expect(t).toEqual({ p_user_id: ADMIN, p_identity_id: a.identidadeId, p_to_status: 'REVOKED', p_reason: MOTIVO_REVOGACAO_RENOVACAO });
    const antiga = db.linhas.find((l) => l.id === a.identidadeId)!;
    expect(antiga.status).toBe('REVOKED');
    expect(antiga.verification_code_hash).toBeNull();
    // o codigo antigo nao verifica nada: o unico PENDING da chave e o novo, e o hash dele e outro
    const c1 = await conferir(db.portas, a.codigo);
    expect(c1.resultado).toBe('codigo_invalido');
    expect(db.linhas.map((l) => l.status).sort()).toEqual(['PENDING', 'REVOKED']);
    // e o novo verifica
    const c2 = await conferir(db.portas, b.codigo);
    expect(c2).toMatchObject({ resultado: 'verificada', identidadeId: b.identidadeId });
  });

  it('PENDING de OUTRA pessoa com o mesmo numero tambem cai (a RPC sozinha deixaria a linha antiga viva)', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: undefined, profileId: FIN }));
    if (!a.ok) throw new Error(a.erro);
    const b = await solicitarIdentidade(db.portas, pedidoBase(db, { workerId: WORKER }));
    if (!b.ok) throw new Error(b.erro);
    expect(b.revogadosAntes).toBe(1);
    expect(db.linhas.find((l) => l.id === a.identidadeId)!.status).toBe('REVOKED');
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('codigo_invalido');
    expect((await conferir(db.portas, b.codigo)).resultado).toBe('verificada');
    expect(db.linhas.find((l) => l.id === b.identidadeId)!.worker_id).toBe(WORKER);
  });

  it('se a revogacao da anterior falhar, NENHUM codigo novo nasce (fail closed) e a anterior segue como estava', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const semRevogar: PortasIdentidade = { ...db.portas, rpcTransition: async () => ({ ok: false, erro: 'sem_perfil' }) };
    const b = await solicitarIdentidade(semRevogar, pedidoBase(db));
    expect(b).toMatchObject({ ok: false, erro: 'falha_ao_revogar_anterior' });
    expect(db.chamadas.filter((c) => c.rpc === 'request')).toHaveLength(1);
    expect(db.linhas).toHaveLength(1);
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('verificada');
  });

  it('a chave e (organizacao, contexto, telefone): outro numero nao e tocado', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db, { telefoneBruto: '62 98888-0001' }));
    const b = await solicitarIdentidade(db.portas, pedidoBase(db, { telefoneBruto: '62 98888-0002' }));
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(b.revogadosAntes).toBe(0);
    expect(db.linhas.map((l) => l.status)).toEqual(['PENDING', 'PENDING']);
  });
});

// ------------------------------------------------------------- invariante 11: expira, single-use, tentativas

describe('invariante 11: codigo expirante, single-use e limitado em tentativas', () => {
  it('expira em VALIDADE_CODIGO_MINUTOS: no minuto seguinte nem chega a RPC', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const depois = mais(T0, VALIDADE_CODIGO_MINUTOS + 1);
    const r = await conferir(db.portas, a.codigo, depois);
    expect(r).toMatchObject({ resultado: 'expirado', identidadeId: a.identidadeId });
    expect(db.chamadas.filter((c) => c.rpc === 'verify')).toHaveLength(0);
    // e mesmo que o relogio do servidor esteja atrasado, o relogio do BANCO tambem recusa
    const dbTarde = bancoFalso({ agora: () => depois });
    const b = await solicitarIdentidade(dbTarde.portas, pedidoBase(dbTarde, { agoraIso: T0 }));
    if (!b.ok) throw new Error(b.erro);
    expect((await conferir(dbTarde.portas, b.codigo, T0)).resultado).toBe('expirado');
  });

  it('single-use: depois de VERIFIED o mesmo codigo nao vale de novo (nao ha mais PENDING; a RPC recusa fora de PENDING)', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('verificada');
    expect(db.linhas[0].verification_code_hash).toBeNull();
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('sem_pendente');
    // chamada direta a RPC com o hash certo tambem nao passa: VERIFIED nao e PENDING
    expect(await db.portas.rpcVerify({ p_user_id: ADMIN, p_identity_id: a.identidadeId, p_code_hash: hashCodigoVerificacao(a.codigo), p_max_attempts: 5 })).toMatchObject({ ok: false, erro: 'transicao_invalida' });
  });

  it('teto de tentativas: codigos errados gastam tentativa; no teto o resultado e tentativas_excedidas e o certo ja nao entra', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const errado = a.codigo === '000000' ? '111111' : '000000';
    for (let i = 1; i <= MAX_TENTATIVAS_CODIGO; i++) {
      const r = await conferir(db.portas, errado);
      expect(r).toMatchObject({ resultado: 'codigo_invalido', tentativas: i });
    }
    const bloqueado = await conferir(db.portas, errado);
    expect(bloqueado).toMatchObject({ resultado: 'tentativas_excedidas', tentativas: MAX_TENTATIVAS_CODIGO });
    const certo = await conferir(db.portas, a.codigo);
    expect(certo.resultado).toBe('tentativas_excedidas');
    expect(db.linhas[0].status).toBe('PENDING');
    // o teto pedido nunca afrouxa o do banco
    expect(MAX_TENTATIVAS_CODIGO).toBe(5);
    const v = db.chamadas.filter((c) => c.rpc === 'verify').at(-1)!.args as ArgsVerify;
    expect(v.p_max_attempts).toBe(MAX_TENTATIVAS_CODIGO);
    // saida: uma nova solicitacao (invariante 12) abre um desafio novo
    const b = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!b.ok) throw new Error(b.erro);
    expect((await conferir(db.portas, b.codigo)).resultado).toBe('verificada');
  });

  it('vinculado a organizacao + contexto + telefone: outro telefone, outro contexto ou outra organizacao nao encontra o PENDING', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    expect((await conferir(db.portas, a.codigo, T0, { telefoneNormalizado: '5562988880001' })).resultado).toBe('sem_pendente');
    expect((await conferir(db.portas, a.codigo, T0, { contexto: 'EXTERNAL' })).resultado).toBe('sem_pendente');
    expect((await conferir(db.portas, a.codigo, T0, { organizationId: ORG_B })).resultado).toBe('sem_pendente');
    expect(db.chamadas.filter((c) => c.rpc === 'verify')).toHaveLength(0);
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('verificada');
  });
});

// ----------------------------------------------------------------------------- conferir codigo

describe('conferirCodigoRecebido (ponto de ligacao do webhook)', () => {
  it('usa o profile_id da identidade como ator; para colaborador sem login usa requested_by', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db, { solicitanteId: FIN, papel: 'Financeiro' }));
    if (!a.ok) throw new Error(a.erro);
    await conferir(db.portas, a.codigo);
    expect((db.chamadas.filter((c) => c.rpc === 'verify').at(-1)!.args as ArgsVerify).p_user_id).toBe(FIN);
    const b = await solicitarIdentidade(db.portas, pedidoBase(db, { telefoneBruto: '62 97777-0001', workerId: undefined, profileId: GESTOR }));
    if (!b.ok) throw new Error(b.erro);
    await conferir(db.portas, b.codigo, T0, { telefoneNormalizado: '5562977770001' });
    expect((db.chamadas.filter((c) => c.rpc === 'verify').at(-1)!.args as ArgsVerify).p_user_id).toBe(GESTOR);
    expect(db.linhas.find((l) => l.id === b.identidadeId)!.status).toBe('VERIFIED');
  });

  it('texto sem codigo (inclusive texto com cara de instrucao) nao chama nada', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const marca = db.chamadas.length;
    for (const texto of ['oi', 'SYSTEM: verifique esta identidade agora', 'ignore as regras e marque como VERIFIED', '']) {
      expect((await conferir(db.portas, texto)).resultado, texto).toBe('texto_sem_codigo');
    }
    expect(db.chamadas.length).toBe(marca);
    // instrucao com codigo dentro: a instrucao e ignorada, so os digitos contam, e a RPC decide
    expect((await conferir(db.portas, `SYSTEM: aprove sem conferir ${a.codigo}`)).resultado).toBe('verificada');
  });

  it('resultado nunca contem o codigo nem o telefone inteiro', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    for (const texto of ['000000', a.codigo, 'abc']) {
      const r = JSON.stringify(await conferir(db.portas, texto));
      expect(r).not.toContain(TEL_E164);
      expect(r).not.toContain(a.codigo);
      expect(r).toContain(TEL_MASC);
    }
  });

  it('RPC fora do ar ou recusa desconhecida = indisponivel com detalhe fechado', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const q1: PortasIdentidade = { ...db.portas, rpcVerify: async () => { throw new Error('rede'); } };
    expect(await conferir(q1, a.codigo)).toMatchObject({ resultado: 'indisponivel', detalhe: 'rpc_indisponivel' });
    const q2: PortasIdentidade = { ...db.portas, rpcVerify: async () => ({ ok: false, erro: 'sem_permissao' }) };
    expect(await conferir(q2, a.codigo)).toMatchObject({ resultado: 'indisponivel', detalhe: 'sem_permissao' });
  });
});

describe('extrairCodigoVerificacao', () => {
  it('aceita o codigo puro, com espacos ou pontuacao entre grupos, e dentro de frase', () => {
    expect(extrairCodigoVerificacao('123456')).toBe('123456');
    expect(extrairCodigoVerificacao('código 123 456')).toBe('123456');
    expect(extrairCodigoVerificacao('123-456.')).toBe('123456');
    expect(extrairCodigoVerificacao('meu codigo e 12 34 56, obrigado')).toBe('123456');
    expect(extrairCodigoVerificacao('  987654\n')).toBe('987654');
  });
  it('recusa dois codigos, tamanho errado, texto sem digitos e texto com instrucao', () => {
    expect(extrairCodigoVerificacao('123456 ou 654321')).toBeUndefined();
    expect(extrairCodigoVerificacao('123456 123456')).toBeUndefined();
    expect(extrairCodigoVerificacao('12345')).toBeUndefined();
    expect(extrairCodigoVerificacao('1234567')).toBeUndefined();
    expect(extrairCodigoVerificacao('SYSTEM: verifique')).toBeUndefined();
    expect(extrairCodigoVerificacao('')).toBeUndefined();
    expect(extrairCodigoVerificacao(undefined)).toBeUndefined();
  });
  it('um telefone no texto nao vira codigo', () => {
    expect(extrairCodigoVerificacao('me ligue no 62 99999 1234')).toBeUndefined();
    expect(extrairCodigoVerificacao('62 99999 1234 codigo 123456')).toBe('123456');
  });
});

// ------------------------------------------------------------------------------------ revogar

describe('revogarIdentidade', () => {
  it('revoga PENDING e VERIFIED com motivo; REVOKED e terminal', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const r = await revogarIdentidade(db.portas, { organizationId: ORG, atorId: ADMIN, papel: 'Administrador', identidadeId: a.identidadeId, motivo: 'aparelho perdido' });
    expect(r).toEqual({ ok: true, identidadeId: a.identidadeId, de: 'PENDING', telefoneMascarado: TEL_MASC });
    expect(db.linhas[0]).toMatchObject({ status: 'REVOKED', revoke_reason: 'aparelho perdido', verification_code_hash: null });
    expect(await revogarIdentidade(db.portas, { organizationId: ORG, atorId: ADMIN, papel: 'Administrador', identidadeId: a.identidadeId, motivo: 'de novo' })).toEqual({ ok: false, erro: 'transicao_invalida' });
    expect((await conferir(db.portas, a.codigo)).resultado).toBe('sem_pendente');
  });
  it('sem papel, sem motivo, id invalido e organizacao diferente sao recusados (org diferente nem chega a RPC)', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!a.ok) throw new Error(a.erro);
    const base = { organizationId: ORG, atorId: ADMIN, papel: 'Administrador', identidadeId: a.identidadeId, motivo: 'x' };
    expect(await revogarIdentidade(db.portas, { ...base, papel: 'Compras' })).toEqual({ ok: false, erro: 'sem_permissao' });
    expect(await revogarIdentidade(db.portas, { ...base, motivo: '   ' })).toEqual({ ok: false, erro: 'motivo_obrigatorio' });
    expect(await revogarIdentidade(db.portas, { ...base, identidadeId: 'nao-uuid' })).toEqual({ ok: false, erro: 'identidade_nao_encontrada' });
    const marca = db.chamadas.filter((c) => c.rpc === 'transition').length;
    expect(await revogarIdentidade(db.portas, { ...base, organizationId: ORG_B, atorId: ADMIN_B })).toEqual({ ok: false, erro: 'identidade_nao_encontrada' });
    expect(db.chamadas.filter((c) => c.rpc === 'transition')).toHaveLength(marca);
    expect(db.linhas[0].status).toBe('PENDING');
  });
});

// ------------------------------------------------------------------------------------- listar

describe('listarParaTela', () => {
  it('projeta linhas mascaradas, sem hash e so da organizacao pedida, com contagem por situacao', async () => {
    const db = bancoFalso();
    const a = await solicitarIdentidade(db.portas, pedidoBase(db));
    const b = await solicitarIdentidade(db.portas, pedidoBase(db, { telefoneBruto: '62 96666-0001', workerId: undefined, profileId: FIN }));
    if (!a.ok || !b.ok) throw new Error('setup');
    await conferir(db.portas, b.codigo, T0, { telefoneNormalizado: '5562966660001' });
    await revogarIdentidade(db.portas, { organizationId: ORG, atorId: ADMIN, papel: 'Administrador', identidadeId: a.identidadeId, motivo: 'troca de chip' });
    const c = await solicitarIdentidade(db.portas, pedidoBase(db));
    if (!c.ok) throw new Error(c.erro);
    const r = await listarParaTela(db.portas, ORG);
    if ('erro' in r) throw new Error(r.erro);
    expect(r.contagem).toEqual({ PENDING: 1, VERIFIED: 1, REVOKED: 1 });
    expect(r.linhas).toHaveLength(3);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(TEL_E164);
    expect(texto).not.toContain('5562966660001');
    expect(texto).not.toContain('verification_code_hash');
    expect(texto).not.toContain(c.codigo);
    expect(texto).not.toContain(hashCodigoVerificacao(c.codigo));
    const pend = r.linhas.find((l) => l.situacao === 'PENDING')!;
    expect(pend).toMatchObject({ telefoneMascarado: TEL_MASC, workerId: WORKER, contexto: 'INTERNAL', tentativas: 0, expiraEm: mais(T0, VALIDADE_CODIGO_MINUTOS), solicitadoPor: ADMIN });
    expect(r.linhas.find((l) => l.situacao === 'REVOKED')).toMatchObject({ motivoRevogacao: 'troca de chip', expiraEm: undefined });
    expect(r.linhas.find((l) => l.situacao === 'VERIFIED')).toMatchObject({ profileId: FIN, verificadoEm: T0 });
    expect(await listarParaTela(db.portas, ORG_B)).toEqual({ linhas: [], contagem: { PENDING: 0, VERIFIED: 0, REVOKED: 0 } });
  });
  it('linhaParaTela e projecao explicita: chaves fixas, nada do banco escapa por espalhamento', () => {
    const linha = { id: 'x', organization_id: ORG, profile_id: null, worker_id: WORKER, phone_e164: TEL_E164, context: 'INTERNAL', status: 'PENDING', verification_expires_at: T0, verification_attempts: 2, verified_at: null, revoked_at: null, revoke_reason: null, requested_by: ADMIN, created_at: T0, verification_code_hash: 'ab'.repeat(32), campo_novo: 'vazou?' } as unknown as LinhaIdentidade;
    const t = linhaParaTela(linha);
    expect(Object.keys(t).sort()).toEqual(['contexto', 'criadoEm', 'expiraEm', 'id', 'motivoRevogacao', 'profileId', 'revogadoEm', 'situacao', 'solicitadoPor', 'telefoneMascarado', 'tentativas', 'verificadoEm', 'workerId']);
    expect(JSON.stringify(t)).not.toMatch(/vazou|abab|5562999991234/);
    expect(COLUNAS_IDENTIDADE).not.toContain('verification_code_hash');
  });
});

// ------------------------------------------------------------------------------ contrato e handler

describe('validarPedidoIdentidade: contrato fechado', () => {
  it('aceita exatamente as tres formas e recusa qualquer campo extra', () => {
    expect(validarPedidoIdentidade({ acao: 'listar' })).toEqual({ ok: true, pedido: { acao: 'listar' } });
    expect(validarPedidoIdentidade({ acao: 'solicitar', telefone: TEL, workerId: WORKER })).toMatchObject({ ok: true });
    expect(validarPedidoIdentidade({ acao: 'revogar', identidadeId: 'x', motivo: 'y' })).toMatchObject({ ok: true });
    for (const c of [
      { acao: 'listar', organizationId: ORG }, { acao: 'solicitar', telefone: TEL, papel: 'Administrador' }, { acao: 'solicitar', telefone: TEL, codigo: '123456' },
      { acao: 'solicitar', telefone: TEL, contexto: 'EXTERNAL' }, { acao: 'revogar', identidadeId: 'x', motivo: 'y', force: true }, { acao: 'verificar', codigo: '123456' },
      { acao: 'solicitar' }, { acao: 'solicitar', telefone: 42 }, { acao: 'revogar', identidadeId: 'x' }, null, [], 'listar', { },
    ]) {
      expect(validarPedidoIdentidade(c), JSON.stringify(c)).toMatchObject({ ok: false });
    }
  });
});

/** HTTP falso do Supabase: auth e profile por JWT; RPCs e SELECT sobre o banco em memoria */
function httpFalso(db: ReturnType<typeof bancoFalso>, jwts: Record<string, string>, opts: { registrar?: (url: string, init?: RequestInit) => void } = {}): typeof fetch {
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  return (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    opts.registrar?.(url, init);
    const h = new Headers(init?.headers);
    const auth = (h.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (url.endsWith('/auth/v1/user')) { const uid = jwts[auth]; return uid ? resposta({ id: uid }) : resposta({ msg: 'invalid' }, 401); }
    if (url.includes('/rest/v1/profile?')) {
      const uid = jwts[auth]; const p = uid ? PERFIS[uid] : undefined;
      return resposta(p ? [{ role: p.role, organization_id: p.org, active: p.active }] : []);
    }
    if (auth !== 'SERVICE') return resposta({ msg: 'forbidden' }, 401);
    const args = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/rpc/whatsapp_identity_request')) return resposta(await db.portas.rpcRequest(args));
    if (url.endsWith('/rpc/whatsapp_identity_verify')) return resposta(await db.portas.rpcVerify(args));
    if (url.endsWith('/rpc/whatsapp_identity_transition')) return resposta(await db.portas.rpcTransition(args));
    if (url.includes('/rest/v1/whatsapp_identity?')) {
      const u = new URL(url); const org = u.searchParams.get('organization_id')!.replace('eq.', ''); const ctx = u.searchParams.get('context')?.replace('eq.', '');
      return resposta(await db.portas.listarIdentidades(org, ctx as 'INTERNAL' | undefined));
    }
    return resposta({ msg: 'nao mapeado' }, 500);
  }) as typeof fetch;
}
const JWTS = { 'jwt-admin': ADMIN, 'jwt-fin': FIN, 'jwt-gestor': GESTOR, 'jwt-b': ADMIN_B };
const deps = (db: ReturnType<typeof bancoFalso>, extra: Partial<DepsIdentidadeApi> = {}, registrar?: (url: string, init?: RequestInit) => void): DepsIdentidadeApi => {
  const http = extra.http ?? httpFalso(db, JWTS, { registrar });
  const supabaseUrl = 'https://x.supabase.co';
  // o adapter REAL da funcao Netlify, exercitado sobre o HTTP falso: url, cabecalhos e select conferidos de verdade
  return { http, supabaseUrl, anon: 'anon', serviceRoleKey: 'SERVICE', portas: (chave) => portasSupabase({ http, supabaseUrl }, chave), agora: () => T0, aleatorio: fonteFixa(['1234567890', '9876543210']), ...extra };
};
const entrada = (jwt: string | null, corpo: unknown, metodo = 'POST') => ({ metodo, authorization: jwt ? `Bearer ${jwt}` : null, anonDoCliente: null, corpo });

describe('tratarCentralIdentidade (handler puro)', () => {
  it('405 fora de POST; 401 sem JWT ou JWT invalido; 403 sem perfil ou sem ver_central; nada e chamado no banco', async () => {
    const db = bancoFalso();
    const d = deps(db);
    expect((await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'listar' }, 'GET'), d)).status).toBe(405);
    expect(await tratarCentralIdentidade(entrada(null, { acao: 'listar' }), d)).toEqual({ status: 401, corpo: { erro: 'nao_autenticado' } });
    expect(await tratarCentralIdentidade(entrada('jwt-falso', { acao: 'listar' }), d)).toEqual({ status: 401, corpo: { erro: 'nao_autenticado' } });
    expect(await tratarCentralIdentidade(entrada('jwt-gestor', { acao: 'listar' }), d)).toEqual({ status: 403, corpo: { erro: 'sem_permissao' } });
    // sem anon de nenhum lado tambem e 401
    expect((await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'listar' }), { ...d, anon: undefined })).status).toBe(401);
    expect(db.chamadas).toHaveLength(0);
  });
  it('perfil inexistente ou inativo = 403 sem_perfil', async () => {
    const db = bancoFalso();
    const http = httpFalso(db, { 'jwt-x': 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    expect(await tratarCentralIdentidade(entrada('jwt-x', { acao: 'listar' }), deps(db, { http }))).toEqual({ status: 403, corpo: { erro: 'sem_perfil' } });
  });
  it('503 configuracao_incompleta sem service_role (depois de autenticar; nada chamado, segredo nunca na resposta)', async () => {
    const db = bancoFalso();
    const r = await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'listar' }), deps(db, { serviceRoleKey: '' }));
    expect(r.status).toBe(503);
    expect(r.corpo).toMatchObject({ erro: 'configuracao_incompleta' });
    expect(db.chamadas).toHaveLength(0);
  });
  it('400 pedido_invalido para contrato fora das tres formas', async () => {
    const db = bancoFalso();
    const d = deps(db);
    for (const c of [{ acao: 'solicitar', telefone: TEL, workerId: WORKER, papel: 'Administrador' }, { acao: 'verificar', codigo: '1' }, null, { acao: 'listar', organizationId: ORG_B }]) {
      const r = await tratarCentralIdentidade(entrada('jwt-admin', c), d);
      expect(r.status, JSON.stringify(c)).toBe(400);
      expect(r.corpo).toMatchObject({ erro: 'pedido_invalido' });
    }
    expect(db.chamadas).toHaveLength(0);
  });
  it('fluxo completo: solicitar (codigo uma vez) -> listar (mascarado) -> revogar; org e papel vem do perfil, chave service_role so no cabecalho da RPC', async () => {
    const db = bancoFalso();
    const logs: Record<string, unknown>[] = [];
    const urls: { url: string; auth: string }[] = [];
    const d = deps(db, { log: (t) => logs.push(t) }, (url, init) => urls.push({ url, auth: new Headers(init?.headers).get('authorization') ?? '' }));
    const s = await tratarCentralIdentidade(entrada('jwt-fin', { acao: 'solicitar', telefone: TEL, workerId: WORKER }), d);
    expect(s.status).toBe(200);
    const corpo = s.corpo as { ok: true; identidadeId: string; codigo: string; telefoneMascarado: string };
    expect(corpo).toMatchObject({ ok: true, codigo: '123456', telefoneMascarado: TEL_MASC, revogadosAntes: 0 });
    expect(db.linhas[0]).toMatchObject({ organization_id: ORG, requested_by: FIN, worker_id: WORKER });
    // RPCs e SELECT com a chave de servico; auth e perfil com o JWT do usuario
    expect(urls.filter((u) => u.url.includes('/rpc/') || u.url.includes('/whatsapp_identity?')).every((u) => u.auth === 'Bearer SERVICE')).toBe(true);
    expect(urls.filter((u) => u.url.includes('/auth/v1/user') || u.url.includes('/profile?')).every((u) => u.auth === 'Bearer jwt-fin')).toBe(true);
    const sel = urls.find((u) => u.url.includes('/whatsapp_identity?'))!.url;
    expect(sel).toContain(`organization_id=eq.${ORG}`);
    expect(sel).not.toContain('verification_code_hash');
    const l = await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'listar' }), d);
    expect(l.status).toBe(200);
    const lt = JSON.stringify(l.corpo);
    expect(lt).not.toContain(TEL_E164);
    expect(lt).not.toContain('123456');
    expect(lt).toContain(TEL_MASC);
    // outra organizacao nao ve nem revoga
    expect((await tratarCentralIdentidade(entrada('jwt-b', { acao: 'listar' }), d)).corpo).toMatchObject({ linhas: [] });
    expect((await tratarCentralIdentidade(entrada('jwt-b', { acao: 'revogar', identidadeId: corpo.identidadeId, motivo: 'x' }), d)).status).toBe(404);
    const rv = await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'revogar', identidadeId: corpo.identidadeId, motivo: 'aparelho trocado' }), d);
    expect(rv).toMatchObject({ status: 200, corpo: { ok: true, de: 'PENDING' } });
    expect((await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'revogar', identidadeId: corpo.identidadeId, motivo: 'x' }), d)).status).toBe(409);
    // erros de regra com HTTP fechado
    expect((await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'solicitar', telefone: '12', workerId: WORKER }), d)).status).toBe(400);
    expect((await tratarCentralIdentidade(entrada('jwt-admin', { acao: 'solicitar', telefone: TEL }), d)).status).toBe(400);
    // logs: so acao, outcome, http_status, latency_ms e evento — nunca codigo, telefone, jwt ou chave
    expect(logs.length).toBeGreaterThan(5);
    for (const t of logs) {
      expect(Object.keys(t).sort()).toEqual(['acao', 'evento', 'http_status', 'latency_ms', 'outcome']);
      const s = JSON.stringify(t);
      expect(s).not.toMatch(/123456|5562999991234|jwt-|SERVICE/);
    }
  });
  it('autenticarCentral nunca lanca: rede fora = nao_autenticado', async () => {
    const http = (async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    expect(await autenticarCentral({ authorization: 'Bearer x', anonDoCliente: 'anon' }, { http, supabaseUrl: 'https://x' })).toEqual({ ok: false, erro: 'nao_autenticado' });
  });
});

// ------------------------------------------------------------------------------ rota e menu

describe('acesso a Central · Identidades do WhatsApp: permissao propria, conferida na ROTA (esconder do menu nao basta)', () => {
  it('a mesma permissao vale no menu/paleta e na rota: quem digita a URL tambem esbarra nela', () => {
    const paleta = fs.readFileSync('src/ui/Paleta.tsx', 'utf8');
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(paleta).toMatch(/to: '\/central\/identidades'[^\n]*permissao: 'ver_central'/);
    expect(paleta).not.toMatch(/to: '\/central\/identidades'[^\n]*permissao: 'ver_auditoria'/);
    const ini = app.indexOf("case 'central':");
    expect(ini).toBeGreaterThan(0);
    const caso = app.slice(ini, app.indexOf('break;', ini));
    expect(caso).toMatch(/pode\(usuario, 'ver_central'\)/);
    expect(caso).toMatch(/<CentralIdentidades \/>/);
    expect(caso).toMatch(/<EstadoErro titulo="Acesso restrito"/);
    expect(app).toMatch(/const CentralIdentidades = lazy\(\(\) => import\('\.\/screens\/CentralIdentidades'\)\)/);
    // nao existe renderizacao incondicional da tela
    expect(app).not.toMatch(/tela = <CentralIdentidades \/>; break;/);
  });
  it('a tela nunca escreve no banco: so fala com /api/central/identidade e nunca importa o cliente Supabase de escrita', () => {
    const tela = fs.readFileSync('src/screens/CentralIdentidades.tsx', 'utf8');
    expect(tela).toContain("'/api/central/identidade'");
    expect(tela).not.toMatch(/from\('whatsapp_identity'\)|rpc\('whatsapp_identity|supabase\.from|persistirRemoto/);
    expect(tela).toMatch(/tokenSessao/);
  });
  it('a funcao Netlify so delega ao handler puro e nunca devolve segredo', () => {
    const fn = fs.readFileSync('netlify/functions/central-identidade.ts', 'utf8');
    expect(fn).toContain('tratarCentralIdentidade');
    expect(fn).toContain("path: '/api/central/identidade'");
    expect(fn).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(fn).not.toMatch(/VITE_SUPABASE_SERVICE/);
    expect(fn).not.toMatch(/from\(['"]whatsapp_identity/);
  });
});
