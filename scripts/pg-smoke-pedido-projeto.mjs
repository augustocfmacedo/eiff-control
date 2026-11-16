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
/** roda `fn` como `uid` (papel authenticated) numa transação própria; `manter` confirma, senão desfaz */
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
let intencoes = 0;
const int = () => `int-${++intencoes}`;
const criar = (uid, p, intencao = int()) => como(uid, async () => (await q(`select * from pp_criar($1::jsonb, $2)`, [JSON.stringify(p), intencao]))[0], { manter: true });
const agir = (uid, id, acao, dados, versao, intencao = int()) => como(uid, async () => (await q(`select * from pp_transicionar($1, $2, $3::jsonb, $4, $5)`, [id, acao, JSON.stringify(dados ?? {}), versao, intencao]))[0], { manter: true });
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
  const opGanha = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id) values ($1, $2, 'Já ganha', 'NURTURE', 0, $3) returning id`, [org, emp, P.Comercial]);
  const orc = await um(`insert into estimate (organization_id, code, title) values ($1, 'ORC-T1', 'Orçamento técnico fictício') returning id`, [org]);
  await db.exec('commit;');
  const estagioAntes = await um(`select stage from radar_opportunity where id = $1`, [op]);

  const pedido = { empresaId: emp, oportunidadeId: op, origemLead: 'SIMULADOR', tipo: 'Estudo preliminar', prioridade: 'Alta', prazoSolicitado: '2026-11-30', responsavelComercialId: P.Comercial,
    dados: { cidade: 'Rio Verde', uf: 'GO', comprimentoM: 80, larguraM: 25, alturaM: 10 }, documentos: { arquitetura: 'pendente' } };

  // A. quem abre
  const criadores = {};
  for (const k of Object.keys(P)) { const r = await como(P[k], async () => (await q(`select * from pp_criar($1::jsonb, $2)`, [JSON.stringify(pedido), int()]))[0]); criadores[k] = r.erro ? 'negado' : 'abre'; }
  const abrem = Object.entries(criadores).filter(([, v]) => v === 'abre').map(([k]) => k).sort();
  prova('A só a gestão comercial abre (Administrador, Diretoria, Comercial)', JSON.stringify(abrem) === JSON.stringify(['Administrador', 'Comercial', 'Diretoria']), JSON.stringify(criadores));

  // B. idempotência na criação
  const c1 = await criar(P.Comercial, pedido, 'abrir-1');
  const c2 = await criar(P.Comercial, pedido, 'abrir-1');
  const id = c1.valor.id;
  prova('B nasce SOLICITADO (SP-0001, versão 1); a mesma intenção devolve a mesma solicitação', c1.valor.status === 'SOLICITADO' && c1.valor.code === 'SP-0001' && c2.valor?.id === id && (await um(`select count(*)::int from project_request`)) === 1, `${c1.valor.code} ${c1.valor.status} · repetida=${c2.valor?.id === id}`);

  // C. duplicidade e versão
  const dup = await criar(P.Comercial, pedido);
  const outroTipo = await criar(P.Comercial, { ...pedido, tipo: 'Análise técnica' });
  prova('C uma aberta por oportunidade e tipo; outro tipo convive', !!dup.erro && !outroTipo.erro, `${dup.erro} | outro tipo: ${outroTipo.valor?.code}`);

  // D. escrita direta recusada
  const diretas = [];
  for (const k of Object.keys(P)) {
    for (const [nome, sql] of [['insert', `insert into project_request (organization_id, code, company_id, opportunity_id, lead_origin, request_type, priority, commercial_owner_id, created_by) values ('${org}', 'SP-9999', '${emp}', '${op2}', 'OUTRO', 'Estudo preliminar', 'Normal', '${P[k]}', '${P[k]}')`], ['update', `update project_request set status = 'ENTREGUE' where id = '${id}'`], ['delete', `delete from project_request where id = '${id}'`], ['evento', `update project_request_event set reason = 'x' where request_id = '${id}'`]]) {
      const r = await como(P[k], async () => q(sql));
      if (!r.erro && (nome !== 'update' || (await um(`select status from project_request where id = $1`, [id])) === 'ENTREGUE')) diretas.push(`${k}:${nome}`);
    }
  }
  prova('D nenhum perfil escreve direto (insert, update, delete, histórico)', diretas.length === 0, diretas.join(', ') || `${Object.keys(P).length} perfis × 4 = negado`);

  // E. visibilidade: tabela só para a gestão; Engenharia pela visão técnica; demais nada
  const vis = {};
  for (const k of Object.keys(P)) {
    const t = await como(P[k], async () => um(`select count(*)::int from project_request`));
    const v = await como(P[k], async () => um(`select count(*)::int from pp_visao_tecnica()`));
    vis[k] = `${t.erro ? 'x' : t.valor}/${v.erro ? 'x' : v.valor}`;
  }
  const esp = { Administrador: '2/2', Diretoria: '2/2', Comercial: '2/2', Engenharia: '0/2', Engenharia2: '0/2', Financeiro: '0/0', Contabilidade: '0/0', Compras: '0/0', 'Gestor de obra': '0/0', Auditoria: '0/0', Solicitante: '0/0' };
  prova('E tabela só para a gestão; Engenharia só pela visão técnica; demais nada (tabela/visão)', JSON.stringify(vis) === JSON.stringify(esp), JSON.stringify(vis));

  // F. visão técnica sem oportunidade, vínculos ou colunas comerciais
  const linha = (await como(P.Engenharia, async () => (await q(`select * from pp_visao_tecnica() where id = $1`, [id]))[0])).valor;
  const proibidas = Object.keys(linha).filter((c) => /opportunity|thread|submission|source_record|estimate|value|valor|probab|stage|notes|contact|phone|email/i.test(c));
  prova('F visão técnica: sem oportunidade, sem vínculos, sem coluna comercial; empresa pelo nome', proibidas.length === 0 && linha.company_name === 'Grãos do Vale', `colunas: ${Object.keys(linha).join(', ')}`);

  // G. lados, responsável técnico, versão, motivo
  let v = await versao(id);
  const engEdita = await agir(P.Engenharia, id, 'editar_dados', { dados: { cidade: 'X', uf: 'GO', larguraM: 30 } }, v);
  const finTriagem = await agir(P.Financeiro, id, 'iniciar_triagem', {}, v);
  const tri = await agir(P.Engenharia, id, 'iniciar_triagem', { equipeTecnica: 'Engenharia estrutural' }, v);
  v = await versao(id);
  const outro = await agir(P.Engenharia2, id, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }, v);
  const velha = await agir(P.Engenharia, id, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }, v - 1);
  const semMotivo = await agir(P.Engenharia, id, 'pedir_dados', { pendencias: ['sondagem'] }, v);
  prova('G Engenharia não faz ação do Comercial; Financeiro não age; só o responsável técnico; versão e motivo',
    !!engEdita.erro && !!finTriagem.erro && !tri.erro && tri.valor.technical_owner_id === P.Engenharia && !!outro.erro && !!velha.erro && !!semMotivo.erro,
    [engEdita.erro, finTriagem.erro, outro.erro, velha.erro, semMotivo.erro].join(' | '));

  // H. idempotência na ação
  v = await versao(id);
  const t1 = await agir(P.Engenharia, id, 'registrar_triagem', { validar: ['cidade', 'larguraM'], nota: 'conferido' }, v, 'triagem-1');
  const t2 = await agir(P.Engenharia, id, 'registrar_triagem', { validar: ['cidade', 'larguraM'], nota: 'conferido' }, v, 'triagem-1');
  const nEv = await um(`select count(*)::int from project_request_event where request_id = $1 and intent = 'triagem-1'`, [id]);
  prova('H a mesma intenção não aplica a ação duas vezes; dado validado com autor', !t1.erro && !t2.erro && t2.valor.version === t1.valor.version && nEv === 1 && t1.valor.technical_data.larguraM.situacao === 'validado' && t1.valor.technical_data.alturaM.situacao === 'declarado', `versão ${t1.valor?.version}/${t2.valor?.version}, eventos ${nEv}`);

  // I. ciclo completo
  const passos = [
    [P.Engenharia, 'pedir_dados', { motivo: 'Falta a arquitetura', pendencias: ['Planta de arquitetura'] }],
    [P.Engenharia, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }], // recusado: DADOS_PENDENTES
    [P.Comercial, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'recebido', referencia: 'arq-r01.pdf' } }],
    [P.Comercial, 'responder_pendencias', { resposta: 'Arquitetura recebida' }],
    [P.Engenharia, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'validado' } }],
    [P.Engenharia, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }],
    [P.Engenharia, 'registrar_andamento', { nota: 'Pórticos pré-dimensionados' }],
    [P.Engenharia, 'entregar', { entrega: { resumo: 'Estudo preliminar entregue', resultados: 'Pórticos a cada 6 m', referencias: ['estudo.pdf'] } }],
    [P.Comercial, 'encerrar', orc ? { resultado: { tipo: 'ORCAMENTO_VINCULADO', orcamentoId: orc } } : { resultado: { tipo: 'SEGUE_PARA_ORCAMENTO' } }],
  ];
  const trilha = [];
  for (const [uid, acao, dados] of passos) { const r = await agir(uid, id, acao, dados, await versao(id)); trilha.push(`${acao}:${r.erro ? 'recusado' : r.valor.status}`); }
  prova('I ciclo completo até ENCERRADO, com devolução e a recusa no meio', trilha.join(' ') === 'pedir_dados:DADOS_PENDENTES assumir_desenvolvimento:recusado atualizar_documento:DADOS_PENDENTES responder_pendencias:TRIAGEM_TECNICA atualizar_documento:TRIAGEM_TECNICA assumir_desenvolvimento:EM_DESENVOLVIMENTO registrar_andamento:EM_DESENVOLVIMENTO entregar:ENTREGUE encerrar:ENCERRADO', trilha.join(' '));
  const final = await agir(P.Administrador, id, 'cancelar', { motivo: 'tentativa depois de encerrada' }, await versao(id));
  prova('J estado final não admite alteração', !!final.erro, final.erro ?? 'alterou');
  const eventos = await q(`select action, from_status, to_status, reason, intent from project_request_event where request_id = $1 order by occurred_at, id`, [id]);
  prova('K histórico: um evento por ação aceita, com de → para, motivo e intenção', eventos.length === 11 && eventos.every((e) => e.intent) && eventos.some((e) => e.action === 'pedir_dados' && e.reason === 'Falta a arquitetura' && e.from_status === 'TRIAGEM_TECNICA'), `${eventos.length} eventos`);
  const estagioDepois = await um(`select stage from radar_opportunity where id = $1`, [op]);
  prova('L o estágio da oportunidade no Radar não mudou', estagioDepois === estagioAntes, `${estagioAntes} → ${estagioDepois}`);

  // M. vínculos por id, técnico por construção
  const alheia = await criar(P.Comercial, { ...pedido, oportunidadeId: op2 });
  const inativa = await criar(P.Comercial, { ...pedido, oportunidadeId: opGanha, tipo: 'Projeto executivo' });
  const threadFalsa = await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo', vinculos: { inboxThreadId: '00000000-0000-4000-8000-000000000000' } });
  const subFalsa = await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo', vinculos: { submissaoId: 'sub-inexistente' } });
  const telefone = await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo', documentos: { arquitetura: 'pendente' }, dados: { ...pedido.dados }, extra: 1 });
  const naoCatalogo = (await como(P.Comercial, async () => (await q(`select technical_data from pp_criar($1::jsonb, $2)`, [JSON.stringify({ ...pedido, tipo: 'Apoio ao orçamento técnico', dados: { ...pedido.dados, telefone: '62 99999-0000' } }), int()]))[0])).valor;
  prova('M vínculos conferidos por id (outra empresa, oportunidade inativa, conversa e submissão inexistentes recusadas); chave fora do catálogo descartada',
    !!alheia.erro && !!inativa.erro && !!threadFalsa.erro && !!subFalsa.erro && !telefone.erro && naoCatalogo && !('telefone' in naoCatalogo),
    [alheia.erro, inativa.erro, threadFalsa.erro, subFalsa.erro].join(' | '));

  // N. outra organização
  const ADM2 = 'dddddddd-0000-4000-8000-0000000000b1';
  await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Admin da outra', 'b1@exemplo', 'Administrador')`, [ADM2, org2]);
  const outra = (await como(ADM2, async () => `${await um(`select count(*)::int from project_request`)}/${await um(`select count(*)::int from pp_visao_tecnica()`)}/${await um(`select count(*)::int from project_request_event`)}`)).valor;
  const outraAge = await agir(ADM2, outroTipo.valor.id, 'cancelar', { motivo: 'tentativa de outra organização' }, 1);
  prova('N outra organização não vê nem altera nada', outra === '0/0/0' && !!outraAge.erro, `${outra} · ${outraAge.erro}`);

  res.diagnostico.engenhariaLeRadar_D2 = { oportunidades: (await como(P.Engenharia, async () => um(`select count(*)::int from radar_opportunity`))).valor };
} catch (e) {
  prova('execução', false, so(e));
}

console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);
