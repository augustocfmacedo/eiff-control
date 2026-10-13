// Gestao de usuarios (tela Cadastros › Usuarios, funcao /api/usuarios). Handler PURO e testavel: rede injetada (fetch) e
// ambiente injetado. Criar login exige a chave service_role do Supabase, que so existe no servidor (Netlify, nunca VITE_):
// por isso o fluxo e JWT do usuario -> perfil ATIVO e Administrador -> so entao a chave administrativa age, sempre presa a
// organizacao de quem pede. A senha nunca passa por aqui: o convite e o "reenviar acesso" mandam um e-mail do Supabase com
// link para a propria pessoa criar a senha (tela DefinirSenha no app). Toda mudanca grava audit_log (source 'usuarios').
import type { Papel } from './types';
import { PAPEIS, PAPEIS_COM_OBRAS, type UsuarioLista } from './usuarios';

export { PAPEIS, PAPEIS_COM_OBRAS, type UsuarioLista };
/** papeis que enxergam todas as obras pelo proprio papel (can_access_project) e os que precisam de escopo de empresa */
const ESCOPO_EMPRESA: Papel[] = ['Financeiro', 'Contabilidade', 'Auditoria', 'Compras'];
const MFA: Papel[] = ['Administrador', 'Diretoria', 'Financeiro'];

export interface AmbienteUsuarios { url: string; anon: string; service: string; site: string }
export type PedidoUsuarios =
  | { acao: 'listar' }
  | { acao: 'convidar'; nome: string; email: string; papel: Papel; obras?: string[] }
  | { acao: 'alterar'; id: string; nome?: string; papel?: Papel; ativo?: boolean; obras?: string[] }
  | { acao: 'enviar_acesso'; id: string }
  // criar ja com senha (o Administrador entrega a senha inicial) e definir senha de quem ja existe; `trocar` = a pessoa cria a
  // propria senha no primeiro acesso (user_metadata.trocar_senha, lido pelo app). A senha nunca e gravada em tabela nem log.
  | { acao: 'criar'; nome: string; email: string; papel: Papel; obras?: string[]; senha: string; trocar: boolean }
  | { acao: 'definir_senha'; id: string; senha: string; trocar: boolean };
export interface Resposta { status: number; corpo: unknown }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
const ok = (corpo: unknown, status = 200): Resposta => ({ status, corpo });
const erro = (status: number, codigo: string, mensagem: string): Resposta => ({ status, corpo: { erro: codigo, mensagem } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida o corpo: so os campos de cada acao, nos tipos certos (qualquer outro campo e 400). */
export function validarPedido(c: unknown): PedidoUsuarios | string {
  if (!c || typeof c !== 'object') return 'corpo inválido';
  const o = c as Row; const acao = o.acao;
  const so = (permitidos: string[]) => Object.keys(o).every((k) => permitidos.includes(k));
  const obrasOk = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= 100 && x.every((v) => typeof v === 'string' && v.length <= 40));
  if (acao === 'listar') return so(['acao']) ? { acao } : 'campos não permitidos';
  if (acao === 'convidar') {
    if (!so(['acao', 'nome', 'email', 'papel', 'obras'])) return 'campos não permitidos';
    const nome = typeof o.nome === 'string' ? o.nome.trim() : ''; const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
    if (nome.length < 2 || nome.length > 120) return 'Informe o nome (2 a 120 letras).';
    if (!EMAIL.test(email) || email.length > 200) return 'E-mail inválido.';
    if (!PAPEIS.includes(o.papel as Papel)) return 'Papel inválido.';
    if (!obrasOk(o.obras)) return 'Obras inválidas.';
    return { acao, nome, email, papel: o.papel as Papel, obras: o.obras as string[] | undefined };
  }
  if (acao === 'alterar') {
    if (!so(['acao', 'id', 'nome', 'papel', 'ativo', 'obras'])) return 'campos não permitidos';
    if (typeof o.id !== 'string' || !UUID.test(o.id)) return 'Usuário inválido.';
    if (o.nome !== undefined && (typeof o.nome !== 'string' || o.nome.trim().length < 2 || o.nome.length > 120)) return 'Nome inválido.';
    if (o.papel !== undefined && !PAPEIS.includes(o.papel as Papel)) return 'Papel inválido.';
    if (o.ativo !== undefined && typeof o.ativo !== 'boolean') return 'Situação inválida.';
    if (!obrasOk(o.obras)) return 'Obras inválidas.';
    return { acao, id: o.id, nome: typeof o.nome === 'string' ? o.nome.trim() : undefined, papel: o.papel as Papel | undefined, ativo: o.ativo as boolean | undefined, obras: o.obras as string[] | undefined };
  }
  const senhaOk = (x: unknown) => typeof x === 'string' && x.length >= 8 && x.length <= 72 && /[A-Za-z]/.test(x) && /\d/.test(x);
  if (acao === 'criar') {
    if (!so(['acao', 'nome', 'email', 'papel', 'obras', 'senha', 'trocar'])) return 'campos não permitidos';
    const base = validarPedido({ acao: 'convidar', nome: o.nome, email: o.email, papel: o.papel, ...(o.obras !== undefined ? { obras: o.obras } : {}) });
    if (typeof base === 'string') return base;
    if (!senhaOk(o.senha)) return 'Senha fraca: use de 8 a 72 caracteres, com letras e números.';
    if (typeof o.trocar !== 'boolean') return 'Informe se a pessoa troca a senha no primeiro acesso.';
    return { ...base, acao: 'criar', senha: o.senha as string, trocar: o.trocar } as PedidoUsuarios;
  }
  if (acao === 'definir_senha') {
    if (!so(['acao', 'id', 'senha', 'trocar'])) return 'campos não permitidos';
    if (typeof o.id !== 'string' || !UUID.test(o.id)) return 'Usuário inválido.';
    if (!senhaOk(o.senha)) return 'Senha fraca: use de 8 a 72 caracteres, com letras e números.';
    if (typeof o.trocar !== 'boolean') return 'Informe se a pessoa troca a senha no primeiro acesso.';
    return { acao, id: o.id, senha: o.senha as string, trocar: o.trocar };
  }
  if (acao === 'enviar_acesso') {
    if (!so(['acao', 'id'])) return 'campos não permitidos';
    if (typeof o.id !== 'string' || !UUID.test(o.id)) return 'Usuário inválido.';
    return { acao, id: o.id };
  }
  return 'ação desconhecida';
}

/** Cliente minimo do Supabase com a chave de servico (PostgREST + Auth admin). */
function cliente(f: Fetch, amb: AmbienteUsuarios) {
  const h = { apikey: amb.service, authorization: `Bearer ${amb.service}`, 'content-type': 'application/json' };
  const rest = async (caminho: string, init: RequestInit = {}) => {
    const r = await f(`${amb.url}/rest/v1/${caminho}`, { ...init, headers: { ...h, prefer: 'return=representation', ...(init.headers ?? {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`rest ${caminho.split('?')[0]}: ${r.status} ${t.slice(0, 200)}`);
    return (t ? JSON.parse(t) : []) as Row[];
  };
  const auth = async (caminho: string, init: RequestInit = {}) => {
    const r = await f(`${amb.url}/auth/v1/${caminho}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } });
    const t = await r.text();
    return { ok: r.ok, status: r.status, dados: (t ? JSON.parse(t) : {}) as Row };
  };
  return { rest, auth };
}

export async function tratarUsuarios(req: { token: string | null; corpo: unknown }, f: Fetch, amb: AmbienteUsuarios): Promise<Resposta> {
  if (!amb.service) return erro(501, 'nao_configurado', 'A chave SUPABASE_SERVICE_ROLE_KEY não está configurada no Netlify.');
  if (!req.token) return erro(401, 'nao_autenticado', 'Sessão expirada. Entre de novo.');
  // 1) quem chama: JWT valido -> perfil ativo Administrador (lido com a chave de servico, nunca do cliente)
  const u = await f(`${amb.url}/auth/v1/user`, { headers: { apikey: amb.anon, authorization: `Bearer ${req.token}` } });
  if (!u.ok) return erro(401, 'nao_autenticado', 'Sessão expirada. Entre de novo.');
  const eu = (await u.json()) as { id?: string };
  if (!eu.id) return erro(401, 'nao_autenticado', 'Sessão inválida.');
  const sb = cliente(f, amb);
  const [ator] = await sb.rest(`profile?id=eq.${eu.id}&select=id,organization_id,name,role,active`);
  if (!ator || !ator.active || ator.role !== 'Administrador') return erro(403, 'sem_permissao', 'Só o Administrador gerencia usuários.');
  const org = String(ator.organization_id);
  const p = validarPedido(req.corpo);
  if (typeof p === 'string') return erro(400, 'pedido_invalido', p);

  const auditar = (acao: string, id: string, antes: unknown, depois: unknown) =>
    sb.rest('audit_log', { method: 'POST', body: JSON.stringify({ organization_id: org, actor_id: eu.id, action: acao, entity_type: 'profile', entity_id: id, before_data: antes ?? null, after_data: depois ?? null, source: 'usuarios' }), headers: { prefer: 'return=minimal' } });
  const projetos = async () => (await sb.rest(`project?organization_id=eq.${org}&select=id,code`)).map((x) => ({ id: String(x.id), code: String(x.code) }));
  const empresa = async () => String((await sb.rest(`company?organization_id=eq.${org}&select=id,code&order=code`))[0]?.id ?? '');
  /** escopo do papel: empresa inteira (Financeiro...), obras escolhidas (Gestor/Engenharia; vazio = todas) ou nenhum */
  const gravarEscopo = async (id: string, papel: Papel, obras: string[] | undefined) => {
    await sb.rest(`user_scope?profile_id=eq.${id}&organization_id=eq.${org}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
    const cia = await empresa();
    if (!cia) return;
    if (ESCOPO_EMPRESA.includes(papel) || (PAPEIS_COM_OBRAS.includes(papel) && !obras?.length)) {
      await sb.rest('user_scope', { method: 'POST', body: JSON.stringify({ organization_id: org, profile_id: id, company_id: cia, project_id: null }), headers: { prefer: 'return=minimal' } });
    } else if (PAPEIS_COM_OBRAS.includes(papel)) {
      const mapa = new Map((await projetos()).map((x) => [x.code, x.id]));
      const linhas = obras!.map((c) => mapa.get(c)).filter(Boolean).map((pid) => ({ organization_id: org, profile_id: id, company_id: cia, project_id: pid }));
      if (linhas.length) await sb.rest('user_scope', { method: 'POST', body: JSON.stringify(linhas), headers: { prefer: 'return=minimal' } });
    }
  };
  const perfilDaOrg = async (id: string) => (await sb.rest(`profile?id=eq.${id}&organization_id=eq.${org}&select=id,name,email,role,active,mfa_required`))[0];
  const redirect = encodeURIComponent(`${amb.site.replace(/\/$/, '')}/`);

  if (p.acao === 'listar') {
    const [perfis, escopos, obras, usuariosAuth] = await Promise.all([
      sb.rest(`profile?organization_id=eq.${org}&select=id,name,email,role,active&order=name`),
      sb.rest(`user_scope?organization_id=eq.${org}&select=profile_id,project_id`),
      projetos(),
      sb.auth('admin/users?per_page=1000'),
    ]);
    const codigo = new Map(obras.map((x) => [x.id, x.code]));
    const porId = new Map(((usuariosAuth.dados.users as Row[] | undefined) ?? []).map((x) => [String(x.id), x]));
    const lista: UsuarioLista[] = perfis.map((x) => {
      const meus = escopos.filter((s) => s.profile_id === x.id);
      const papel = x.role as Papel;
      const todas = !PAPEIS_COM_OBRAS.includes(papel) || !meus.length || meus.some((s) => !s.project_id);
      const a = porId.get(String(x.id));
      return { id: String(x.id), nome: String(x.name), email: String(x.email), papel, ativo: !!x.active, obras: todas ? '*' : meus.map((s) => codigo.get(String(s.project_id)) ?? '').filter(Boolean),
        convidadoEm: (a?.invited_at as string | undefined) ?? undefined, confirmadoEm: (a?.email_confirmed_at as string | undefined) ?? undefined, ultimoAcesso: (a?.last_sign_in_at as string | undefined) ?? undefined, voce: x.id === eu.id };
    });
    return ok({ usuarios: lista, obras: obras.map((x) => x.code).sort() });
  }

  if (p.acao === 'convidar') {
    const jaPerfil = await sb.rest(`profile?organization_id=eq.${org}&email=ilike.${encodeURIComponent(p.email)}&select=id`);
    if (jaPerfil.length) return erro(409, 'ja_existe', 'Já existe um usuário com este e-mail.');
    // convite do Supabase: cria o login sem senha e manda o e-mail com o link para a pessoa criar a propria senha
    const conv = await sb.auth(`invite?redirect_to=${redirect}`, { method: 'POST', body: JSON.stringify({ email: p.email, data: { nome: p.nome } }) });
    let id = conv.ok ? String(conv.dados.id ?? '') : '';
    let convidado = conv.ok;
    if (!conv.ok) {
      // login ja existe no Supabase (sem perfil nesta organizacao): liga o perfil ao login existente e manda link de acesso
      const todos = await sb.auth('admin/users?per_page=1000');
      const achado = ((todos.dados.users as Row[] | undefined) ?? []).find((x) => String(x.email ?? '').toLowerCase() === p.email);
      if (!achado) return erro(502, 'convite_falhou', `O Supabase recusou o convite: ${String(conv.dados.msg ?? conv.dados.message ?? conv.status)}`);
      const outro = await sb.rest(`profile?id=eq.${achado.id}&select=id,organization_id`);
      if (outro.length) return erro(409, 'ja_existe', 'Este e-mail já está ligado a outro perfil.');
      id = String(achado.id); convidado = false;
    }
    if (!UUID.test(id)) return erro(502, 'convite_falhou', 'O Supabase não devolveu o usuário convidado.');
    const perfil = { id, organization_id: org, name: p.nome, email: p.email, role: p.papel, active: true, mfa_required: MFA.includes(p.papel) };
    await sb.rest('profile', { method: 'POST', body: JSON.stringify(perfil), headers: { prefer: 'return=minimal' } });
    await gravarEscopo(id, p.papel, p.obras);
    if (!convidado) await sb.auth(`recover?redirect_to=${redirect}`, { method: 'POST', body: JSON.stringify({ email: p.email }) });
    await auditar('convidar_usuario', id, null, { nome: p.nome, email: p.email, papel: p.papel, obras: p.obras ?? null });
    return ok({ id, convite: convidado ? 'enviado' : 'login_existente_link_enviado' }, 201);
  }

  if (p.acao === 'alterar') {
    const antes = await perfilDaOrg(p.id);
    if (!antes) return erro(404, 'nao_encontrado', 'Usuário não encontrado.');
    const proprio = p.id === eu.id;
    if (proprio && p.papel && p.papel !== antes.role) return erro(400, 'proprio_papel', 'Você não pode mudar o seu próprio papel.');
    if (proprio && p.ativo === false) return erro(400, 'proprio_ativo', 'Você não pode desativar o seu próprio acesso.');
    const deixaDeSerAdmin = antes.role === 'Administrador' && antes.active && ((p.papel && p.papel !== 'Administrador') || p.ativo === false);
    if (deixaDeSerAdmin) {
      const admins = await sb.rest(`profile?organization_id=eq.${org}&role=eq.Administrador&active=is.true&select=id`);
      if (admins.length <= 1) return erro(400, 'ultimo_admin', 'Este é o último Administrador ativo: mantenha ao menos um.');
    }
    const papel = (p.papel ?? antes.role) as Papel;
    const muda: Row = {};
    if (p.nome && p.nome !== antes.name) muda.name = p.nome;
    if (p.papel && p.papel !== antes.role) { muda.role = p.papel; muda.mfa_required = MFA.includes(p.papel); }
    if (p.ativo !== undefined && p.ativo !== antes.active) muda.active = p.ativo;
    if (Object.keys(muda).length) await sb.rest(`profile?id=eq.${p.id}&organization_id=eq.${org}`, { method: 'PATCH', body: JSON.stringify(muda), headers: { prefer: 'return=minimal' } });
    if (p.papel !== undefined || p.obras !== undefined) await gravarEscopo(p.id, papel, p.obras);
    await auditar('alterar_usuario', p.id, { nome: antes.name, papel: antes.role, ativo: antes.active }, { ...muda, obras: p.obras ?? undefined });
    return ok({ id: p.id, alterado: Object.keys(muda) });
  }

  if (p.acao === 'criar') {
    const jaPerfil = await sb.rest(`profile?organization_id=eq.${org}&email=ilike.${encodeURIComponent(p.email)}&select=id`);
    if (jaPerfil.length) return erro(409, 'ja_existe', 'Já existe um usuário com este e-mail.');
    // login ja confirmado (sem e-mail de confirmacao): o Administrador entrega e-mail e senha a pessoa
    const c = await sb.auth('admin/users', { method: 'POST', body: JSON.stringify({ email: p.email, password: p.senha, email_confirm: true, user_metadata: { nome: p.nome, trocar_senha: p.trocar } }) });
    if (!c.ok) {
      const msg = String(c.dados.msg ?? c.dados.message ?? c.dados.error_description ?? c.status);
      if (/already|registered|exists/i.test(msg)) return erro(409, 'login_existe', 'Já existe um login com este e-mail no Supabase. Use "Convidar" (liga o login existente) ou peça para a pessoa usar "Esqueci minha senha".');
      if (/password/i.test(msg)) return erro(400, 'senha_recusada', 'O Supabase recusou a senha: use uma senha mais forte.');
      return erro(502, 'criacao_falhou', `O Supabase recusou a criação: ${msg}`);
    }
    const id = String(c.dados.id ?? '');
    if (!UUID.test(id)) return erro(502, 'criacao_falhou', 'O Supabase não devolveu o usuário criado.');
    await sb.rest('profile', { method: 'POST', body: JSON.stringify({ id, organization_id: org, name: p.nome, email: p.email, role: p.papel, active: true, mfa_required: MFA.includes(p.papel) }), headers: { prefer: 'return=minimal' } });
    await gravarEscopo(id, p.papel, p.obras);
    await auditar('criar_usuario_com_senha', id, null, { nome: p.nome, email: p.email, papel: p.papel, obras: p.obras ?? null, trocarNoPrimeiroAcesso: p.trocar });
    return ok({ id, criado: true }, 201);
  }

  if (p.acao === 'definir_senha') {
    const alvo = await perfilDaOrg(p.id);
    if (!alvo) return erro(404, 'nao_encontrado', 'Usuário não encontrado.');
    if (p.id === eu.id) return erro(400, 'propria_senha', 'Para trocar a sua própria senha, use "Esqueci minha senha" na tela de entrada.');
    const a = await sb.auth(`admin/users/${p.id}`);
    const meta = { ...((a.dados.user_metadata as Row | undefined) ?? {}), trocar_senha: p.trocar };
    const r = await sb.auth(`admin/users/${p.id}`, { method: 'PUT', body: JSON.stringify({ password: p.senha, email_confirm: true, user_metadata: meta }) });
    if (!r.ok) return erro(/password/i.test(String(r.dados.msg ?? r.dados.message ?? '')) ? 400 : 502, 'senha_recusada', `O Supabase recusou a senha: ${String(r.dados.msg ?? r.dados.message ?? r.status)}`);
    await auditar('definir_senha_usuario', p.id, null, { trocarNoPrimeiroAcesso: p.trocar });
    return ok({ id: p.id, senhaDefinida: true });
  }

  // enviar_acesso: quem nunca entrou recebe o convite de novo; quem ja tem senha recebe o link de "criar nova senha"
  const alvo = await perfilDaOrg(p.id);
  if (!alvo) return erro(404, 'nao_encontrado', 'Usuário não encontrado.');
  if (!alvo.active) return erro(400, 'inativo', 'Reative o usuário antes de enviar o acesso.');
  const a = await sb.auth(`admin/users/${p.id}`);
  const confirmado = !!a.dados.email_confirmed_at;
  const r = confirmado
    ? await sb.auth(`recover?redirect_to=${redirect}`, { method: 'POST', body: JSON.stringify({ email: alvo.email }) })
    : await sb.auth(`invite?redirect_to=${redirect}`, { method: 'POST', body: JSON.stringify({ email: alvo.email, data: { nome: alvo.name } }) });
  if (!r.ok) return erro(502, 'envio_falhou', `O Supabase recusou o envio: ${String(r.dados.msg ?? r.dados.message ?? r.status)}`);
  await auditar('enviar_acesso_usuario', p.id, null, { tipo: confirmado ? 'nova_senha' : 'convite' });
  return ok({ id: p.id, enviado: confirmado ? 'nova_senha' : 'convite' });
}
