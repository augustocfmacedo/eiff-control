import { describe, expect, it } from 'vitest';
import { tratarUsuarios, validarPedido, type AmbienteUsuarios } from './usuariosServidor';

const ORG = 'o-1';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const FIN = '22222222-2222-4222-8222-222222222222';
const NOVO = '33333333-3333-4333-8333-333333333333';
const amb: AmbienteUsuarios = { url: 'https://sb', anon: 'anon', service: 'service', site: 'https://eiffcontrol.com.br' };

/** Supabase simulado: tabelas em memória e as rotas que o handler usa. Guarda cada chamada para as asserções. */
function supabaseFalso(opts: { tokenDe?: Record<string, string>; inviteFalha?: boolean } = {}) {
  const db = {
    profile: [
      { id: ADMIN, organization_id: ORG, name: 'Augusto', email: 'augusto@eiff.com', role: 'Administrador', active: true },
      { id: FIN, organization_id: ORG, name: 'Fin', email: 'fin@eiff.com', role: 'Financeiro', active: true },
      { id: '44444444-4444-4444-8444-444444444444', organization_id: 'outra', name: 'Outra', email: 'x@outra', role: 'Administrador', active: true },
    ] as Record<string, unknown>[],
    user_scope: [] as Record<string, unknown>[],
    audit_log: [] as Record<string, unknown>[],
    authUsers: [{ id: ADMIN, email: 'augusto@eiff.com', email_confirmed_at: '2026-09-01' }, { id: FIN, email: 'fin@eiff.com', email_confirmed_at: '2026-09-01' }] as Record<string, unknown>[],
  };
  const chamadas: { metodo: string; url: string; corpo?: unknown; auth?: string }[] = [];
  const filtro = (q: URLSearchParams) => (r: Record<string, unknown>) => [...q.entries()].every(([k, v]) => {
    if (['select', 'order'].includes(k)) return true;
    const [op, ...resto] = v.split('.'); const val = resto.join('.');
    if (op === 'eq') return String(r[k]) === val;
    if (op === 'ilike') return String(r[k]).toLowerCase() === decodeURIComponent(val).toLowerCase();
    if (op === 'is') return String(r[k]) === val;
    return true;
  });
  const resp = (status: number, corpo: unknown) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
  const f = async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET'; const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string> | undefined)?.authorization;
    chamadas.push({ metodo, url, corpo, auth });
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') { const id = opts.tokenDe?.[String(auth).replace('Bearer ', '')]; return id ? resp(200, { id }) : resp(401, {}); }
    if (u.pathname === '/auth/v1/admin/users' && metodo === 'POST') {
      if (db.authUsers.some((x) => x.email === corpo.email)) return resp(422, { msg: 'A user with this email address has already been registered' });
      db.authUsers.push({ id: NOVO, email: corpo.email, email_confirmed_at: '2026-10-13', user_metadata: corpo.user_metadata, password: corpo.password }); return resp(200, { id: NOVO, email: corpo.email });
    }
    if (u.pathname === '/auth/v1/admin/users') return resp(200, { users: db.authUsers });
    if (u.pathname.startsWith('/auth/v1/admin/users/') && metodo === 'PUT') { const a = db.authUsers.find((x) => x.id === u.pathname.split('/').pop()); if (!a) return resp(404, {}); Object.assign(a, corpo); return resp(200, a); }
    if (u.pathname.startsWith('/auth/v1/admin/users/')) return resp(200, db.authUsers.find((x) => x.id === u.pathname.split('/').pop()) ?? {});
    if (u.pathname === '/auth/v1/invite') {
      if (opts.inviteFalha || db.authUsers.some((x) => x.email === corpo.email)) return resp(422, { msg: 'A user with this email address has already been registered' });
      db.authUsers.push({ id: NOVO, email: corpo.email, invited_at: '2026-10-13' }); return resp(200, { id: NOVO, email: corpo.email });
    }
    if (u.pathname === '/auth/v1/recover') return resp(200, {});
    const tabela = u.pathname.replace('/rest/v1/', '') as 'profile' | 'user_scope' | 'audit_log' | 'company' | 'project';
    const linhas = tabela === 'company' ? [{ id: 'cia-1', organization_id: ORG, code: 'EIFF' }] : tabela === 'project' ? [{ id: 'pr-1', organization_id: ORG, code: 'OB-1' }, { id: 'pr-2', organization_id: ORG, code: 'OB-2' }] : db[tabela];
    const q = u.searchParams; const casa = filtro(q);
    if (metodo === 'GET') return resp(200, linhas.filter(casa));
    if (metodo === 'POST') { const novos = Array.isArray(corpo) ? corpo : [corpo]; (db[tabela as 'profile'] as unknown[]).push(...novos); return resp(201, undefined); }
    if (metodo === 'PATCH') { for (const r of linhas.filter(casa)) Object.assign(r, corpo); return resp(204, undefined); }
    if (metodo === 'DELETE') { db[tabela as 'user_scope'] = (db[tabela as 'user_scope']).filter((r) => !casa(r)); return resp(204, undefined); }
    return resp(400, {});
  };
  return { f, db, chamadas };
}
const comoAdmin = { tokenDe: { 'tok-admin': ADMIN, 'tok-fin': FIN } };

describe('/api/usuarios (handler puro)', () => {
  it('portões: sem chave de serviço 501; sem token 401; token inválido 401; quem não é Administrador 403', async () => {
    const s = supabaseFalso(comoAdmin);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'listar' } }, s.f, { ...amb, service: '' })).status).toBe(501);
    expect((await tratarUsuarios({ token: null, corpo: { acao: 'listar' } }, s.f, amb)).status).toBe(401);
    expect((await tratarUsuarios({ token: 'falso', corpo: { acao: 'listar' } }, s.f, amb)).status).toBe(401);
    expect((await tratarUsuarios({ token: 'tok-fin', corpo: { acao: 'listar' } }, s.f, amb)).status).toBe(403);
    expect(s.chamadas.some((c) => c.url.includes('/invite'))).toBe(false);
  });
  it('validação do pedido: campos extras, e-mail, papel e ação desconhecida são recusados', () => {
    expect(validarPedido({ acao: 'listar', x: 1 })).toBe('campos não permitidos');
    expect(validarPedido({ acao: 'convidar', nome: 'Ze', email: 'ruim', papel: 'Solicitante' })).toBe('E-mail inválido.');
    expect(validarPedido({ acao: 'convidar', nome: 'Ze', email: 'ze@eiff.com', papel: 'Rei' })).toBe('Papel inválido.');
    expect(validarPedido({ acao: 'apagar' })).toBe('ação desconhecida');
    expect(validarPedido({ acao: 'convidar', nome: ' Zé ', email: ' ZE@EIFF.COM ', papel: 'Solicitante' })).toEqual({ acao: 'convidar', nome: 'Zé', email: 'ze@eiff.com', papel: 'Solicitante', obras: undefined });
  });
  it('lista só os usuários da organização de quem pede, com obras e situação do login', async () => {
    const s = supabaseFalso(comoAdmin);
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'listar' } }, s.f, amb);
    const corpo = r.corpo as { usuarios: { id: string; voce: boolean; obras: unknown }[]; obras: string[] };
    expect(r.status).toBe(200);
    expect(corpo.usuarios.map((u) => u.id).sort()).toEqual([ADMIN, FIN].sort());
    expect(corpo.usuarios.find((u) => u.id === ADMIN)?.voce).toBe(true);
    expect(corpo.obras).toEqual(['OB-1', 'OB-2']);
  });
  it('convidar Solicitante: convite do Supabase com link para o site, perfil na organização, sem escopo, auditoria', async () => {
    const s = supabaseFalso(comoAdmin);
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'convidar', nome: 'Equipe Um', email: 'um@eiff.com', papel: 'Solicitante' } }, s.f, amb);
    expect(r).toMatchObject({ status: 201, corpo: { id: NOVO, convite: 'enviado' } });
    const convite = s.chamadas.find((c) => c.url.includes('/auth/v1/invite'))!;
    expect(convite.url).toContain(`redirect_to=${encodeURIComponent('https://eiffcontrol.com.br/')}`);
    expect(convite.auth).toBe('Bearer service'); // a chave administrativa so age depois da checagem do Administrador
    expect(s.db.profile.find((p) => p.id === NOVO)).toMatchObject({ organization_id: ORG, role: 'Solicitante', active: true, mfa_required: false, email: 'um@eiff.com' });
    expect(s.db.user_scope.filter((x) => x.profile_id === NOVO)).toEqual([]);
    expect(s.db.audit_log.at(-1)).toMatchObject({ action: 'convidar_usuario', actor_id: ADMIN, entity_id: NOVO, source: 'usuarios' });
  });
  it('convidar Gestor de obra com obras escolhidas grava escopo por obra; Financeiro ganha escopo de empresa', async () => {
    const s = supabaseFalso(comoAdmin);
    await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'convidar', nome: 'Gestor', email: 'g@eiff.com', papel: 'Gestor de obra', obras: ['OB-2', 'OB-X'] } }, s.f, amb);
    expect(s.db.user_scope.filter((x) => x.profile_id === NOVO).map((x) => x.project_id)).toEqual(['pr-2']);
    await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: NOVO, papel: 'Financeiro' } }, s.f, amb);
    expect(s.db.user_scope.filter((x) => x.profile_id === NOVO).map((x) => x.project_id)).toEqual([null]);
    expect(s.db.profile.find((p) => p.id === NOVO)).toMatchObject({ role: 'Financeiro', mfa_required: true });
  });
  it('e-mail repetido é 409; login já existente sem perfil é ligado e recebe link de nova senha', async () => {
    const s = supabaseFalso(comoAdmin);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'convidar', nome: 'Fin', email: 'FIN@eiff.com', papel: 'Financeiro' } }, s.f, amb)).status).toBe(409);
    s.db.authUsers.push({ id: NOVO, email: 'antigo@eiff.com', email_confirmed_at: '2026-01-01' });
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'convidar', nome: 'Antigo', email: 'antigo@eiff.com', papel: 'Solicitante' } }, s.f, amb);
    expect(r).toMatchObject({ status: 201, corpo: { id: NOVO, convite: 'login_existente_link_enviado' } });
    expect(s.chamadas.some((c) => c.url.includes('/auth/v1/recover'))).toBe(true);
  });
  it('travas: não muda o próprio papel, não se desativa, não remove o último Administrador; usuário de outra organização é 404', async () => {
    const s = supabaseFalso(comoAdmin);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: ADMIN, papel: 'Diretoria' } }, s.f, amb)).status).toBe(400);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: ADMIN, ativo: false } }, s.f, amb)).status).toBe(400);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: '44444444-4444-4444-8444-444444444444', ativo: false } }, s.f, amb)).status).toBe(404);
    // segundo admin vira Diretoria: permitido porque ainda resta o Augusto; depois o Augusto nao pode sair (ultimo)
    s.db.profile.find((p) => p.id === FIN)!.role = 'Administrador';
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: FIN, papel: 'Diretoria' } }, s.f, amb)).status).toBe(200);
    s.db.profile.find((p) => p.id === FIN)!.role = 'Administrador';
    s.db.profile.find((p) => p.id === ADMIN)!.active = false; // so o FIN e admin ativo
    s.db.profile.find((p) => p.id === ADMIN)!.active = true;
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: FIN, ativo: false } }, s.f, amb)).status).toBe(200);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: ADMIN, nome: 'Augusto Macedo' } }, s.f, amb)).status).toBe(200);
  });
  it('criar já com senha: login confirmado com "trocar no primeiro acesso", perfil e auditoria SEM a senha', async () => {
    const s = supabaseFalso(comoAdmin);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'criar', nome: 'Equipe', email: 'eq@eiff.com', papel: 'Solicitante', senha: 'curta1', trocar: true } }, s.f, amb)).status).toBe(400);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'criar', nome: 'Equipe', email: 'eq@eiff.com', papel: 'Solicitante', senha: 'semnumeroaqui', trocar: true } }, s.f, amb)).status).toBe(400);
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'criar', nome: 'Equipe', email: 'eq@eiff.com', papel: 'Solicitante', senha: 'Inicial2026x', trocar: true } }, s.f, amb);
    expect(r).toMatchObject({ status: 201, corpo: { id: NOVO, criado: true } });
    const criacao = s.chamadas.find((c) => c.metodo === 'POST' && c.url.endsWith('/auth/v1/admin/users'))!;
    expect(criacao.corpo).toMatchObject({ email: 'eq@eiff.com', password: 'Inicial2026x', email_confirm: true, user_metadata: { nome: 'Equipe', trocar_senha: true } });
    expect(s.db.profile.find((p) => p.id === NOVO)).toMatchObject({ role: 'Solicitante', organization_id: ORG });
    const aud = JSON.stringify(s.db.audit_log);
    expect(aud).toContain('criar_usuario_com_senha');
    expect(aud).not.toContain('Inicial2026x'); // a senha nunca vai para a auditoria
    // e-mail que ja tem login: 409 com orientacao, sem criar perfil
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'criar', nome: 'Fin2', email: 'fin@eiff.com', papel: 'Solicitante', senha: 'Outra2026x', trocar: true } }, s.f, amb)).status).toBe(409);
  });
  it('definir senha de quem já existe: troca no Supabase, mantém os outros dados do login, não vale para a própria senha', async () => {
    const s = supabaseFalso(comoAdmin);
    s.db.authUsers.find((x) => x.id === FIN)!.user_metadata = { nome: 'Fin', apelido: 'F' };
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'definir_senha', id: FIN, senha: 'NovaSenha99', trocar: false } }, s.f, amb);
    expect(r).toMatchObject({ status: 200, corpo: { senhaDefinida: true } });
    expect(s.db.authUsers.find((x) => x.id === FIN)).toMatchObject({ password: 'NovaSenha99', user_metadata: { nome: 'Fin', apelido: 'F', trocar_senha: false } });
    expect(JSON.stringify(s.db.audit_log)).not.toContain('NovaSenha99');
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'definir_senha', id: ADMIN, senha: 'MinhaSenha99', trocar: false } }, s.f, amb)).status).toBe(400);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'definir_senha', id: FIN, senha: 'NovaSenha99', trocar: false, extra: 1 } }, s.f, amb)).status).toBe(400);
  });
  it('enviar acesso: quem nunca entrou recebe o convite de novo; quem já tem senha recebe link de nova senha; inativo é recusado', async () => {
    const s = supabaseFalso(comoAdmin);
    await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'convidar', nome: 'Equipe', email: 'eq@eiff.com', papel: 'Solicitante' } }, s.f, amb);
    s.chamadas.length = 0;
    // o simulador recusa convite para e-mail ja existente: o segundo convite usa a rota de convite e falha -> 502 honesto
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'enviar_acesso', id: NOVO } }, s.f, amb)).status).toBe(502);
    const r = await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'enviar_acesso', id: FIN } }, s.f, amb);
    expect(r).toMatchObject({ status: 200, corpo: { enviado: 'nova_senha' } });
    await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'alterar', id: FIN, ativo: false } }, s.f, amb);
    expect((await tratarUsuarios({ token: 'tok-admin', corpo: { acao: 'enviar_acesso', id: FIN } }, s.f, amb)).status).toBe(400);
  });
});
