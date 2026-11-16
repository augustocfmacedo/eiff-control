// Smoke do pedido de projeto (E11.2, preparado na E11.1F) contra um PostgreSQL DE VERDADE (PGlite, em memória).
// NADA TOCA PRODUÇÃO. Fila inteira de migrations + carga inicial + docs/propostas/comercial-acesso.proposta.sql (partes 1 e 2)
// + docs/propostas/pedido-projeto.proposta.sql. Prova: quem cria, quem vê (a Engenharia só o ENCAMINHADO, sem ler o Inbox
// Comercial), escrita só por RPC, lados e responsável técnico, versão, motivos, jornada completa, histórico append-only,
// técnico por construção (chave de contato recusada pelo banco), coerência e isolamento entre organizações.
//
// Como rodar:  node scripts/pg-smoke-pedido-projeto.mjs   (imprime JSON; sai com 1 se qualquer prova falhar)
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..', 'supabase', 'migrations');
const ACESSO = path.join(AQUI, '..', 'docs', 'propostas', 'comercial-acesso.proposta.sql');
const PEDIDO = path.join(AQUI, '..', 'docs', 'propostas', 'pedido-projeto.proposta.sql');
const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] };
const SEMENTE = '0013';

const PRELUDIO = `
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $prel$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('test.uid', true), '')::uuid,
                  nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid) $fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user) $fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
`;

const res = { migrations: {}, provas: {}, diagnostico: {} };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];

const db = new PGlite({ extensions: { pgcrypto } });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
/** roda `fn` como `uid` (papel authenticated) numa transação própria; `manter` confirma (efeito persiste), senão desfaz */
async function como(uid, fn, { manter = false } = {}) {
  await db.exec('begin;');
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
    const valor = await fn();
    await db.exec(manter ? 'commit;' : 'rollback;');
    return { valor, erro: null };
  } catch (e) {
    try { await db.exec('rollback;'); } catch { /* ja desfeita */ }
    return { valor: undefined, erro: so(e) };
  }
}

const P = {
  Administrador: 'dddddddd-0000-4000-8000-000000000001', Diretoria: 'dddddddd-0000-4000-8000-000000000002', Comercial: 'dddddddd-0000-4000-8000-000000000003',
  Engenharia: 'dddddddd-0000-4000-8000-000000000004', Engenharia2: 'dddddddd-0000-4000-8000-000000000005', Financeiro: 'dddddddd-0000-4000-8000-000000000006',
  Contabilidade: 'dddddddd-0000-4000-8000-000000000007', Compras: 'dddddddd-0000-4000-8000-000000000008', 'Gestor de obra': 'dddddddd-0000-4000-8000-000000000009',
  Auditoria: 'dddddddd-0000-4000-8000-00000000000a', Solicitante: 'dddddddd-0000-4000-8000-00000000000b',
};
const papelDe = (k) => (k === 'Engenharia2' ? 'Engenharia' : k);
const transicionar = (uid, id, acao, dados, versao) => como(uid, async () => (await q(`select * from pp_transicionar($1, $2, $3::jsonb, $4)`, [id, acao, JSON.stringify(dados ?? {}), versao]))[0], { manter: true });
const versao = (id) => um(`select version from project_request where id = $1`, [id]);

try {
  await db.exec(PRELUDIO);
  const arquivos = fs.readdirSync(RAIZ).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const feitas = new Set();
  const aplicar = async (arq) => {
    await db.exec('begin;');
    try { await db.exec(fs.readFileSync(path.join(RAIZ, arq), 'utf8')); await db.exec('commit;'); res.migrations[arq.slice(0, 4)] = 'APLICADA'; feitas.add(arq); }
    catch (e) { try { await db.exec('rollback;'); } catch { /* abortada */ } res.migrations[arq.slice(0, 4)] = `ERRO: ${so(e)}`; throw e; }
  };
  for (const arq of arquivos) {
    const n = arq.slice(0, 4);
    for (const antes of ORDEM_CORRIGIDA[n] ?? []) if (!feitas.has(antes)) await aplicar(antes);
    if (!feitas.has(arq)) await aplicar(arq);
    if (n === SEMENTE) { await db.exec('begin;'); await db.exec(fs.readFileSync(path.join(RAIZ, '..', 'seed.sql'), 'utf8')); await db.exec('commit;'); }
  }
  // ordem: comercial-acesso parte 1 → parte 2 → pedido-projeto (a proposta do pedido usa o papel Comercial)
  const [ca1, ca2] = fs.readFileSync(ACESSO, 'utf8').split('-- @@PARTE2@@');
  await db.exec('begin;'); await db.exec(ca1); await db.exec('commit;'); res.migrations.comercial_acesso_1 = 'APLICADA';
  await db.exec('begin;'); await db.exec(ca2); await db.exec('commit;'); res.migrations.comercial_acesso_2 = 'APLICADA';
  const pp = fs.readFileSync(PEDIDO, 'utf8');
  await db.exec('begin;'); await db.exec(pp); await db.exec('commit;'); res.migrations.pedido_projeto = 'APLICADA';
  await db.exec('begin;'); await db.exec(pp); await db.exec('commit;'); res.migrations.pedido_projeto_reaplicacao = 'ok';

  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const org2 = await um(`insert into organization (code, name) values ('OUTRA', 'Outra organização (fictícia)') returning id`);
  for (const [k, id] of Object.entries(P)) await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, $3, $4, $5)`, [id, org, `Perfil ${k}`, `${id.slice(-2)}@exemplo`, papelDe(k)]);
  const emp = await um(`insert into radar_company (organization_id, legal_name, trade_name, active) values ($1, 'Grãos do Vale Armazéns Ltda (fictícia)', 'Grãos do Vale', true) returning id`, [org]);
  await q(`insert into radar_contact (organization_id, company_id, full_name, email, phone, active, status) values ($1, $2, 'Marina Fictícia', 'marina@exemplo', '+5562900000000', true, 'ATIVO')`, [org, emp]);
  const op = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value, probability, owner_id, next_action_at, notes) values ($1, $2, 'Galpão 25 × 80', 'NEED_CONFIRMED', 1400000, 0.3, $3, now() + interval '3 days', 'cliente pediu desconto de 5%') returning id`, [org, emp, P.Comercial]);
  const emp2 = await um(`insert into radar_company (organization_id, legal_name, active) values ($1, 'Outra empresa (fictícia)', true) returning id`, [org]);
  const op2 = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id, next_action_at) values ($1, $2, 'Outra', 'QUALIFIED', 0.1, $3, now() + interval '3 days') returning id`, [org, emp2, P.Comercial]);
  await db.exec('commit;');

  const pedido = { empresaId: emp, oportunidadeId: op, origem: 'SIMULADOR', origemRef: { tipo: 'submissao', id: 'sub-ficticia-1' }, tipoProjeto: 'Galpão',
    terreno: { cidade: 'Rio Verde', uf: 'GO' }, dadosDeclarados: [{ rotulo: 'Medidas', texto: 'vão 25 m × 80 m', fonte: 'SIMULADOR', registradoEm: '2026-11-16T10:00:00Z' }] };

  // A. quem cria
  const criadores = {};
  for (const k of Object.keys(P)) {
    const r = await como(P[k], async () => (await q(`select * from pp_criar($1::jsonb)`, [JSON.stringify(pedido)]))[0]);
    criadores[k] = r.erro ? 'negado' : 'cria';
  }
  const podeCriar = Object.entries(criadores).filter(([, v]) => v === 'cria').map(([k]) => k).sort();
  prova('A só a gestão comercial cria (Administrador, Diretoria, Comercial)', JSON.stringify(podeCriar) === JSON.stringify(['Administrador', 'Comercial', 'Diretoria']), JSON.stringify(criadores));

  const criado = await como(P.Comercial, async () => (await q(`select * from pp_criar($1::jsonb)`, [JSON.stringify(pedido)]))[0], { manter: true });
  const id = criado.valor.id;
  prova('B nasce RASCUNHO com código PP-0001 e evento de criação', criado.valor.status === 'RASCUNHO' && criado.valor.code === 'PP-0001' && (await um(`select count(*)::int from project_request_event where request_id = $1`, [id])) === 1, `${criado.valor.code} ${criado.valor.status}`);

  const conta = async (k) => (await como(P[k], async () => um(`select count(*)::int from project_request`))).valor;
  const contaTec = async (k) => { const r = await como(P[k], async () => um(`select count(*)::int from pp_visao_tecnica()`)); return r.erro ? 'negado' : r.valor; };
  prova('C rascunho: a Engenharia não vê (tabela e visão técnica)', (await conta('Engenharia')) === 0 && (await contaTec('Engenharia')) === 0, `tabela=${await conta('Engenharia')} visão=${await contaTec('Engenharia')}`);

  // D. escrita direta recusada para todos
  const diretas = [];
  for (const k of Object.keys(P)) {
    for (const [nome, sql] of [['insert', `insert into project_request (organization_id, code, company_id, opportunity_id, origin, project_type, commercial_owner_id, created_by) values ('${org}', 'PP-9999', '${emp}', '${op}', 'OUTRO', 'Galpão', '${P[k]}', '${P[k]}')`], ['update', `update project_request set status = 'ENTREGUE' where id = '${id}'`], ['delete', `delete from project_request where id = '${id}'`], ['evento', `update project_request_event set reason = 'x' where request_id = '${id}'`]]) {
      const r = await como(P[k], async () => q(sql));
      if (!r.erro) diretas.push(`${k}:${nome}`);
    }
  }
  prova('D nenhum perfil escreve direto (insert, update, delete, histórico)', diretas.length === 0, diretas.join(', ') || `${Object.keys(P).length} perfis × 4 = negado`);

  // E. envio e visibilidade
  let v = await versao(id);
  const env = await transicionar(P.Comercial, id, 'enviar', {}, v);
  prova('E Comercial envia', !env.erro && env.valor.status === 'SOLICITADO', env.erro ?? env.valor.status);
  const visiveis = {};
  for (const k of Object.keys(P)) visiveis[k] = `${await conta(k)}/${await contaTec(k)}`;
  const esperados = { Administrador: '1/1', Diretoria: '1/1', Comercial: '1/1', Engenharia: '1/1', Engenharia2: '1/1', Financeiro: '0/0', Contabilidade: '0/0', Compras: '0/0', 'Gestor de obra': '0/0', Auditoria: '0/0', Solicitante: '0/0' };
  prova('F encaminhado: Direção, Comercial e Engenharia veem; os demais não (tabela/visão)', JSON.stringify(visiveis) === JSON.stringify(esperados), JSON.stringify(visiveis));

  // G. a visão técnica não tem coluna comercial e traz o nome da empresa
  const colunas = Object.keys((await como(P.Engenharia, async () => (await q(`select * from pp_visao_tecnica()`))[0])).valor ?? {});
  const proibidas = colunas.filter((c) => /value|valor|probab|stage|notes|contact|phone|email|opportunity/i.test(c));
  const linha = (await como(P.Engenharia, async () => (await q(`select * from pp_visao_tecnica()`))[0])).valor;
  prova('G visão técnica: sem coluna comercial; empresa pelo nome', proibidas.length === 0 && linha.company_name === 'Grãos do Vale', `colunas: ${colunas.join(', ')}`);

  // H. lados e responsável técnico
  v = await versao(id);
  const engEnvia = await transicionar(P.Engenharia, id, 'encerrar', { resultado: { tipo: 'NAO_SEGUIU' }, motivo: 'tentativa indevida' }, v);
  const finTriagem = await transicionar(P.Financeiro, id, 'iniciar_triagem', {}, v);
  const triagem = await transicionar(P.Engenharia, id, 'iniciar_triagem', {}, v);
  v = await versao(id);
  const outroAceita = await transicionar(P.Engenharia2, id, 'aceitar', { prazo: '2026-11-30' }, v);
  const versaoVelha = await transicionar(P.Engenharia, id, 'aceitar', { prazo: '2026-11-30' }, v - 1);
  const semMotivo = await transicionar(P.Engenharia, id, 'pedir_dados', { pendencias: ['sondagem'] }, v);
  prova('H Engenharia não faz ação do Comercial; Financeiro não age; só o responsável técnico; versão e motivo conferidos',
    !!engEnvia.erro && !!finTriagem.erro && !triagem.erro && triagem.valor.technical_owner_id === P.Engenharia && !!outroAceita.erro && !!versaoVelha.erro && !!semMotivo.erro,
    [engEnvia.erro, finTriagem.erro, outroAceita.erro, versaoVelha.erro, semMotivo.erro].join(' | '));

  // I. jornada até o fim
  const passos = [
    [P.Engenharia, 'pedir_dados', { motivo: 'Falta a sondagem', pendencias: ['sondagem'] }],
    [P.Engenharia, 'aceitar', { prazo: '2026-11-30' }], // recusa: status DADOS_PENDENTES
    [P.Comercial, 'responder_pendencias', {}],
    [P.Engenharia, 'aceitar', { prazo: '2026-11-30' }],
    [P.Engenharia, 'entregar', { entrega: { resumo: 'Estudo preliminar entregue', anexoIds: [] } }],
    [P.Comercial, 'encerrar', { resultado: { tipo: 'ORCAMENTO_GERADO', orcamentoId: 'ORC-9' } }],
  ];
  const trilha = [];
  for (const [uid, acao, dados] of passos) {
    const r = await transicionar(uid, id, acao, dados, await versao(id));
    trilha.push(`${acao}:${r.erro ? 'recusado' : r.valor.status}`);
  }
  const eventos = await q(`select action, from_status, to_status, reason from project_request_event where request_id = $1 order by occurred_at, id`, [id]);
  prova('I jornada completa até ENCERRADO, com a recusa no meio', trilha.join(' ') === 'pedir_dados:DADOS_PENDENTES aceitar:recusado responder_pendencias:TRIAGEM_TECNICA aceitar:EM_DESENVOLVIMENTO entregar:ENTREGUE encerrar:ENCERRADO', trilha.join(' '));
  prova('J histórico: um evento por ação aceita, de → para, motivo da devolução', eventos.length === 8 && eventos.some((e) => e.action === 'pedir_dados' && e.reason === 'Falta a sondagem' && e.from_status === 'TRIAGEM_TECNICA'), `${eventos.length} eventos`);
  const engEventos = (await como(P.Engenharia, async () => um(`select count(*)::int from project_request_event where request_id = $1`, [id]))).valor;
  const finEventos = (await como(P.Financeiro, async () => um(`select count(*)::int from project_request_event where request_id = $1`, [id]))).valor;
  prova('K histórico visível a quem vê o pedido e a mais ninguém', engEventos === 8 && finEventos === 0, `Engenharia=${engEventos} Financeiro=${finEventos}`);

  // L. técnico por construção e coerência
  const comTelefone = await como(P.Comercial, async () => q(`select * from pp_criar($1::jsonb)`, [JSON.stringify({ ...pedido, dadosDeclarados: [{ rotulo: 'x', telefone: '62 99999-0000' }] })]));
  const oportunidadeAlheia = await como(P.Comercial, async () => q(`select * from pp_criar($1::jsonb)`, [JSON.stringify({ ...pedido, oportunidadeId: op2 })]));
  prova('L chave de contato recusada pelo banco; oportunidade de outra empresa recusada', !!comTelefone.erro && !!oportunidadeAlheia.erro, `${comTelefone.erro} | ${oportunidadeAlheia.erro}`);

  // M. outra organização nunca vê
  const ADM2 = 'dddddddd-0000-4000-8000-0000000000b1';
  await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Admin da outra', 'b1@exemplo', 'Administrador')`, [ADM2, org2]);
  const outra = (await como(ADM2, async () => `${await um(`select count(*)::int from project_request`)}/${await um(`select count(*)::int from pp_visao_tecnica()`)}`)).valor;
  prova('M outra organização não vê nada', outra === '0/0', outra);

  // diagnóstico (D2): a Engenharia ainda lê o Radar enquanto tiver `radar`
  res.diagnostico.engenhariaLeRadar_D2 = { oportunidades: (await como(P.Engenharia, async () => um(`select count(*)::int from radar_opportunity`))).valor, contatos: (await como(P.Engenharia, async () => um(`select count(*)::int from radar_contact`))).valor };
} catch (e) {
  prova('execução', false, so(e));
}

console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);
