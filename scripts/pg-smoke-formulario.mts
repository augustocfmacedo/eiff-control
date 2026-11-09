/**
 * Prova do formulário do site contra um PostgreSQL DE VERDADE (PGlite, em memória, ROLLBACK ao final).
 *
 *   npx vite-node scripts/pg-smoke-formulario.mts        (imprime JSON; sai com 1 se qualquer prova falhar)
 *
 * ── POR QUE ESTA PROVA EXISTE, E POR QUE É .mts ──────────────────────────────────────────────────
 *
 * A suíte vitest prova o que o CORE decide e o que as portas MANDAM, com fetch falso. Não prova o que o
 * BANCO aceita. E o ponto frágil desta integração é de banco: a submissão vira DUAS gravações em subsistemas
 * diferentes (evidência no Lead Engine, conversa no Inbox) e NÃO HÁ TRANSAÇÃO que cubra as duas.
 *
 * Então aqui o banco é real e o CÓDIGO também: as portas desta prova usam `linhaDeEvidencia` e `argsIngest`,
 * as MESMAS funções que a produção usa, e a leitura de volta é `carregarInbox` — a camada de dados da
 * interface. Um nome de coluna trocado ou um parâmetro renomeado quebra aqui, não em produção. Por isso é
 * `.mts` (vite-node) e não `.mjs`: para importar o código de verdade em vez de reescrever SQL parecido.
 *
 * ── O QUE SE PROVA ───────────────────────────────────────────────────────────────────────────────
 *
 *   A  a submissão entra: evidência PENDING sem entidade + conversa + mensagem + eventos
 *   B  SEM empresa e SEM CNPJ: nenhuma conta comercial nasce, e a conversa existe de todo modo
 *   C  o contato deixa de ser «não identificado»: nome, empresa, relação lead e o telefone
 *   D  a interface LÊ a conversa: `carregarInbox` devolve a thread, o texto e o contato
 *   E  prazo de primeira resposta gravado pela configuração do Inbox
 *   F  o Octopus Router manda para o COMERCIAL — o roteador que já existia, no banco
 *   G  RECUPERAÇÃO 1: endpoint indisponível (nada gravado) → reconciliação grava do zero
 *   H  RECUPERAÇÃO 2: morreu entre as duas gravações → o reenvio COMPLETA só a conversa
 *   I  RECUPERAÇÃO 3: reenvio duplicado → IDEMPOTENTE, nada novo
 *   J  RECUPERAÇÃO 4: falha de rede DEPOIS de gravar → o reenvio não duplica
 *   K  RECUPERAÇÃO 5: nova versão da mesma submissão → nasce ao lado, conversa intacta
 *   L  a evidência é imutável: editar o payload é recusado pelo trigger
 *   M  promover exige entidade: RESOLVED sem entity_id é recusado pelo CHECK
 *   N  o telefone que já é de outro contato NÃO troca de dono
 *   P  identidade estável: evento e API oficial do Netlify dão o MESMO candidato, e o MESMO id nas duas gravações
 *   O  estado final conferido linha por linha
 *
 * O @electric-sql/pglite é devDependency FIXADA. O banco é em memória, roda dentro de BEGIN ... ROLLBACK e
 * morre com o processo. NADA toca produção e NÃO há conexão de rede.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  ErroDeConfiguracao, ErroDeGravacao, ROTULO_LEITURA_DA_PAGINA, gravarSubmissao, linhaDeEvidencia, prazoDoLead, type PortasGravacao,
} from '../src/core/radar/formularioGravacao';
import { argsIngest, resultadoIngest } from '../src/core/inbox/ingestaoPorta';
import { registroDoBanco } from '../src/core/radar/formularioPorta';
import { dadosDoContato } from '../src/core/inbox/formularioSite';
import { corpoDaSubmissaoNetlify } from '../src/core/radar/formularioTransporte';
import { planoDaReconciliacao } from '../src/core/radar/formularioReconciliacao';
import { validarCorpo } from '../src/core/radar/formularioServidor';
import { carregarInbox } from '../src/data/inbox.supabase';
import { decidirRoteamento } from '../src/core/inbox/roteador';
import type { SubmissaoFormulario } from '../src/core/radar/formularioSite';
import type { InboxDataset } from '../src/core/inbox';

const RAIZ = new URL('../supabase/migrations/', import.meta.url);
const sqlArquivo = (n: string) => fs.readFileSync(new URL(n, RAIZ), 'utf8');

const ORG = '11111111-1111-1111-1111-111111111111';
const FONTE = '22222222-2222-2222-2222-222222222222';
const ATENDENTE = 'aaaaaaaa-0000-0000-0000-000000000001';
// Fontes que NÃO são a do formulário do site: mesmo tipo com outro código (existe em produção), outro tipo,
// inativa, de outra organização e inexistente.
const OUTRA_ORG = '11111111-1111-1111-1111-999999999999';
const FONTE_OFICIAL = '22222222-2222-2222-2222-000000000002';
const FONTE_CNO = '22222222-2222-2222-2222-000000000003';
const FONTE_INATIVA = '22222222-2222-2222-2222-000000000004';
const FONTE_DE_OUTRA_ORG = '22222222-2222-2222-2222-000000000005';
const FONTE_INEXISTENTE = '22222222-2222-2222-2222-00000000dead';
const SETOR_COMERCIAL = 'cccccccc-0000-0000-0000-000000000001';

/** Só o que a 0055 e a 0056 assumem do resto do schema. Não é o banco real: isso é do pg-preflight. */
const PRELUDIO = `
create schema if not exists auth;
do $p$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $p$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');
create table organization (id uuid primary key, name text not null);
create table profile (id uuid primary key, organization_id uuid not null references organization(id), name text not null, email text not null, role role_kind not null, active boolean not null default true);
create table company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text);
create table project (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), code text not null);
create table worker (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null);
create table radar_company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), legal_name text, created_at timestamptz not null default now());
create table radar_opportunity (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id));
create table radar_contact (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), full_name text);
create table radar_source (id uuid primary key, organization_id uuid not null references organization(id), code text, source_type text not null default 'WEBSITE', active boolean not null default true);
create table radar_source_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_id uuid not null references radar_source(id),
  record_type text not null check (record_type in ('empresa','contato','projeto','sinal')),
  external_id text,
  payload jsonb not null,
  entity_id uuid,
  received_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
create or replace function current_org() returns uuid language sql stable security definer as $f$ select organization_id from profile where id = auth.uid() and active $f$;
create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $f$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles)) $f$;
create or replace function touch_updated_at() returns trigger language plpgsql as $f$
begin new.updated_at := now(); new.version := coalesce(old.version, 0) + 1; return new; end $f$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select on profile to authenticated;
`;

const SEMENTE = `
insert into organization (id, name) values ('${ORG}', 'EIFF');
insert into profile (id, organization_id, name, email, role) values ('${ATENDENTE}', '${ORG}', 'Comercial', 'c@eiff', 'Diretoria');
insert into organization (id, name) values ('${OUTRA_ORG}', 'Outra organização');
insert into radar_source (id, organization_id, code, source_type, active) values
  ('${FONTE}', '${ORG}', 'WEBSITE', 'WEBSITE', true),
  ('${FONTE_OFICIAL}', '${ORG}', 'OFFICIAL_COMPANY_SOURCE', 'WEBSITE', true),
  ('${FONTE_CNO}', '${ORG}', 'CNO', 'CNO', true),
  ('${FONTE_INATIVA}', '${ORG}', 'WEBSITE_ANTIGA', 'WEBSITE', false),
  ('${FONTE_DE_OUTRA_ORG}', '${OUTRA_ORG}', 'WEBSITE', 'WEBSITE', true);
insert into inbox_sector (id, organization_id, code, name, sort_order, default_assignee_id) values
  ('${SETOR_COMERCIAL}', '${ORG}', 'COMERCIAL', 'Comercial', 1, '${ATENDENTE}'),
  ('cccccccc-0000-0000-0000-000000000002', '${ORG}', 'ADMINISTRATIVO', 'Administrativo', 2, null);
insert into inbox_member (organization_id, profile_id, sector_id, member_role) values ('${ORG}', '${ATENDENTE}', '${SETOR_COMERCIAL}', 'gestor');
insert into inbox_config (organization_id) values ('${ORG}');
`;

/* ------------------------------------------------------------------ a submissão fictícia */

const BRUTA_NETLIFY = {
  payload: {
    // A forma REAL do evento, com os campos que a plataforma manda ao lado dos nossos: `number`, `form_id`,
    // `site_url`, `state`, `human_fields` e `ordered_human_fields` existem de verdade no corpo e NÃO entram
    // na identidade nem na impressão. É o que faz o evento e a API oficial (que devolve mais campos ainda)
    // produzirem o MESMO candidato — provado em P.
    id: 'nf-prova-0001',
    number: 41,
    form_id: 'fid-prova-0001',
    form_name: 'simular-galpao',
    site_url: 'https://eiff.com.br',
    state: 'verified',
    created_at: '2026-11-09T14:00:00.000Z',
    email: 'ana@exemplo.invalido',
    name: 'Ana Lima (FICTÍCIO)',
    human_fields: { Nome: 'Ana Lima (FICTÍCIO)', 'E-mail': 'ana@exemplo.invalido' },
    ordered_human_fields: [{ title: 'Nome', name: 'nome', value: 'Ana Lima (FICTÍCIO)' }],
    data: {
      nome: 'Ana Lima (FICTÍCIO)', email: 'ana@exemplo.invalido', telefone: '62 90000-0000',
      empresa: 'Lima Indústria (FICTÍCIO)', cidade: 'Goiânia, GO', uso: 'industrial',
      area: '900', vao: '20', comprimento: '45', peDireito: '8',
      observacao: 'Preciso de um galpão para a fábrica. Qual o prazo?',
      resumo: 'Industrial · 900 m² · vão 20 m', prazo: '3 a 6 meses',
      leitura: '[especial] Vão de 20 m acima do já projetado. É possível, mas exige estudo estrutural específico.',
      'form-name': 'simular-galpao', 'empresa-site': '', ip: '200.0.0.1', user_agent: 'Mozilla',
    },
  },
};

const submissaoDe = (bruta: unknown): SubmissaoFormulario => {
  const t = corpoDaSubmissaoNetlify(bruta, { formulariosAceitos: ['simular-galpao', 'iniciar-projeto'] });
  if (!t.ok) throw new Error(`tradução falhou: ${t.motivo}`);
  const v = validarCorpo(t.corpo);
  if (!v.ok) throw new Error(`contrato recusou: ${v.motivo}`);
  return v.submissao;
};

/**
 * O QUE ESTA PROVA NÃO PROVA. Declarado, porque uma prova que finge alcance é pior do que uma ausente.
 *
 * O harness roda como DONO do banco: privilégio de coluna/tabela e RLS não se aplicam a ele, então nada aqui
 * demonstra que `authenticated` não apaga a evidência nem que o recorte por setor funciona. Isso é provado
 * onde o arranjo permite: `pg-smoke-inbox.mjs` (provas A–R, com papéis e auth.uid por GUC) e o preflight da
 * fila inteira de migrations. E o transporte HTTP (PostgREST, cabeçalhos, segredo) é provado pela suíte vitest
 * com fetch falso — aqui as portas falam SQL direto, de propósito, para medir o que o BANCO aceita.
 */
const LIMITES: readonly string[] = Object.freeze([
  'roda como dono: GRANT e RLS não são exercidos (ver pg-smoke-inbox.mjs e o preflight)',
  'as portas falam SQL direto: o transporte HTTP/PostgREST é provado na suíte vitest',
  'nenhuma chamada de rede e nenhum dado real: a submissão é fictícia e tudo termina em ROLLBACK',
]);

/* ------------------------------------------------------------------ provas */

const provas: { id: string; descricao: string; ok: boolean; detalhe?: string }[] = [];
const prova = (id: string, descricao: string, ok: boolean, detalhe?: string) => {
  provas.push({ id, descricao, ok, ...(detalhe === undefined ? {} : { detalhe }) });
};

async function main() {
  const db = new PGlite();
  await db.exec(PRELUDIO);
  await db.exec(sqlArquivo('0055_lead_engine_intake.sql'));
  await db.exec(sqlArquivo('0056_inbox.sql'));
  await db.exec(sqlArquivo('0057_inbox_octopus_router.sql'));
  await db.exec('begin');
  await db.exec(SEMENTE);

  const uma = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Record<string, any> | undefined;
  const todas = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];
  const conta = async (tabela: string, onde = 'true', params: unknown[] = []) =>
    Number((await uma(`select count(*)::int as n from ${tabela} where ${onde}`, params))!['n']);

  /** Cada recusa num SAVEPOINT: no Postgres um comando que falha aborta a transação inteira. */
  async function recusa(sql: string, params: unknown[], id: string, descricao: string) {
    await db.exec('savepoint s');
    try {
      await db.query(sql, params);
      await db.exec('rollback to savepoint s');
      prova(id, descricao, false, 'o banco ACEITOU o que deveria recusar');
    } catch (e) {
      await db.exec('rollback to savepoint s');
      prova(id, descricao, true, String((e as Error).message).split('\n')[0]!.slice(0, 160));
    }
  }

  /* ---------------- as portas: MESMAS funções da produção, sobre este banco ---------------- */

  const colunas = (linha: Record<string, unknown>) => {
    const chaves = Object.keys(linha);
    return {
      lista: chaves.join(', '),
      valores: chaves.map((_, i) => `$${i + 1}`).join(', '),
      params: chaves.map((k) => {
        const v = linha[k];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      }),
    };
  };

  /** Ponte do `sel` do adapter da interface sobre este banco. */
  // O PostgREST entrega instantes como TEXTO; o PGlite entrega `Date`. A ponte converte, para a camada da
  // interface receber aqui o mesmo que recebe em produção (o roteador ordena mensagens comparando texto, e
  // isso só aparece quando a conversa tem mais de uma mensagem — prova T2).
  const comoPostgrest = (linha: Record<string, any>) => Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
  const sel = async (tabela: string, ordem: string) => (await todas(`select * from ${tabela} order by ${ordem}`)).map(comoPostgrest);
  const lerPelaInterface = (): Promise<InboxDataset> => carregarInbox({ sel, orgId: ORG, obraCodigo: () => undefined });

  let falharIngest = false;
  let falharPrazo = false;
  const iso = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : new Date(v as string).toISOString());
  const portas = (): PortasGravacao => ({
    async fonte(fonteId) {
      const f = await uma('select id, code, source_type, active from radar_source where organization_id = $1 and id = $2', [ORG, fonteId]);
      return f === undefined ? undefined : { id: String(f['id']), codigo: String(f['code'] ?? ''), tipo: String(f['source_type'] ?? ''), ativa: f['active'] === true };
    },
    async prazoDaConversa(provider, externalMessageId) {
      const t = await uma(
        `select t.id, t.status, t.opened_at, t.sla_first_response_due, t.sla_first_response_at from inbox_thread t
           join inbox_message m on m.thread_id = t.id
          where m.organization_id = $1 and m.provider = $2 and m.external_message_id = $3`, [ORG, provider, externalMessageId]);
      if (t === undefined) return undefined;
      const vence = iso(t['sla_first_response_due']); const respondida = iso(t['sla_first_response_at']); const aberta = iso(t['opened_at']);
      return {
        threadId: String(t['id']), aberta: !['RESOLVIDA', 'FECHADA'].includes(String(t['status'])),
        ...(vence !== undefined ? { venceEm: vence } : {}), ...(respondida !== undefined ? { respondidaEm: respondida } : {}), ...(aberta !== undefined ? { abertaEm: aberta } : {}),
      };
    },
    async definirPrazo(threadId, venceEmIso) {
      if (falharPrazo) throw new Error('postgrest PATCH inbox_thread http 503');
      const r = await uma('update inbox_thread set sla_first_response_due = $1::timestamptz where organization_id = $2 and id = $3 returning sla_first_response_due', [venceEmIso, ORG, threadId]);
      return r === undefined ? undefined : iso(r['sla_first_response_due']);
    },
    async registrosDaSubmissao(fonteId, externoId) {
      const linhas = await todas('select * from radar_source_record where organization_id = $1 and source_id = $2 and external_id = $3', [ORG, fonteId, externoId]);
      return linhas.map(registroDoBanco);
    },
    async conversaExiste(provider, externalMessageId) {
      return (await conta('inbox_message', 'organization_id = $1 and provider = $2 and external_message_id = $3', [ORG, provider, externalMessageId])) > 0;
    },
    async gravarEvidencia(linha) {
      const c = colunas(linha);
      const r = await uma(`insert into radar_source_record (${c.lista}) values (${c.valores}) returning id`, c.params);
      return r === undefined ? '' : String(r['id']);
    },
    async ingerir(p) {
      if (falharIngest) throw new Error('rpc inbox_ingest http 503');
      const a = argsIngest(p);
      const r = await uma(
        `select inbox_ingest($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13::uuid,$14::uuid,$15::jsonb,$16::jsonb) as d`,
        [a['p_organization_id'], a['p_provider'], a['p_channel'], a['p_context'], a['p_identifier'], a['p_display_name'],
          a['p_external_message_id'], a['p_external_conversation_id'], a['p_body'], a['p_content_type'], a['p_occurred_at'],
          a['p_reply_to_external_id'], a['p_central_conversation_id'], a['p_central_message_id'],
          JSON.stringify(a['p_attachments']), JSON.stringify(a['p_meta'])],
      );
      return resultadoIngest(r!['d'] as Record<string, unknown>);
    },
    async contatoDaIdentidade(canal, identificador) {
      const r = await uma('select contact_id from inbox_contact_identity where organization_id = $1 and channel = $2 and identifier = $3', [ORG, canal, identificador]);
      return r === undefined ? undefined : String(r['contact_id']);
    },
    async completarContato(contatoId, dados) {
      const c = await uma('select name, company_name, relation_kind from inbox_contact where organization_id = $1 and id = $2', [ORG, contatoId]);
      if (c === undefined) return { campos: [], identidades: 0 };
      const mudar: Record<string, unknown> = {};
      if ((String(c['name'] ?? '').trim() === '' || c['name'] === 'Contato não identificado') && dados.nome !== undefined) mudar['name'] = dados.nome;
      if (c['company_name'] === null && dados.empresaNome !== undefined) mudar['company_name'] = dados.empresaNome;
      if (c['relation_kind'] === 'desconhecido') mudar['relation_kind'] = dados.relacaoSeDesconhecido;
      const chaves = Object.keys(mudar);
      if (chaves.length > 0) {
        await db.query(
          `update inbox_contact set ${chaves.map((k, i) => `${k} = $${i + 1}`).join(', ')} where organization_id = $${chaves.length + 1} and id = $${chaves.length + 2}`,
          [...chaves.map((k) => mudar[k]), ORG, contatoId],
        );
      }
      let identidades = 0;
      for (const i of dados.identidades) {
        const r = await uma(
          `insert into inbox_contact_identity (organization_id, contact_id, channel, identifier, display_name, verified)
           values ($1,$2,$3,$4,$5,false) on conflict (organization_id, channel, identifier) do nothing returning id`,
          [ORG, contatoId, i.canal, i.identificador, i.nomeInformado ?? null],
        );
        if (r !== undefined) identidades += 1;
      }
      return { campos: chaves, identidades };
    },
    /** O Octopus Router de verdade: decide sobre o dataset lido pela camada da interface e aplica pela RPC. */
    async rotear(threadId, messageId) {
      const ds = await lerPelaInterface();
      const thread = ds.threads.find((t) => t.id === threadId);
      const mensagem = ds.mensagens.find((m) => m.id === messageId);
      if (thread === undefined || mensagem === undefined) return { ok: false, aplicado: false, classificado: false, motivo: 'contexto indisponível' };
      const decisao = decidirRoteamento({
        inbox: ds, thread, mensagem, obras: [],
        usuarios: [{ id: ATENDENTE, ativo: true, papel: 'Diretoria' }],
        agora: new Date().toISOString(),
      });
      const r = await uma(
        `select inbox_apply_routing($1::uuid,$2::uuid,$3::uuid,$4::jsonb,null,null,$5,null,$6::uuid,$7,$8,$9) as d`,
        [ORG, threadId, messageId, JSON.stringify(decisao), decisao.setorCodigo ?? null,
          decisao.aplicacao === 'ATRIBUIR_PESSOA' ? decisao.responsavelId ?? null : null,
          decisao.prioridade, decisao.nivel, decisao.aplicacao !== 'TRIAGEM'],
      );
      const d = r!['d'] as Record<string, unknown>;
      return { ok: d['ok'] === true, aplicado: d['aplicado'] === true, classificado: false, ...(typeof d['erro'] === 'string' ? { motivo: d['erro'] } : {}) };
    },
  });

  const gravar = (s: SubmissaoFormulario) => gravarSubmissao(s, FONTE, ORG, portas());
  const SUB = submissaoDe(BRUTA_NETLIFY);

  /* ---------------- A · a submissão entra ---------------- */

  const r1 = await gravar(SUB);
  const evidencia = (await todas('select * from radar_source_record'))[0]!;
  prova('A', 'submissão entra: evidência PENDING sem entidade + conversa + mensagem',
    r1.resultado === 'REGISTRADO' && evidencia['intake_status'] === 'PENDING' && evidencia['entity_id'] === null
    && (await conta('inbox_thread')) === 1 && (await conta('inbox_message')) === 1,
    `resultado=${r1.resultado} status=${evidencia['intake_status']} entidade=${evidencia['entity_id']}`);

  prova('A2', 'a impressão gravada é a que o core calculou, e o instante é o da submissão',
    evidencia['payload_fingerprint'] === r1.payloadFingerprint
    && new Date(String(evidencia['received_at'])).toISOString() === SUB.recebidoEm,
    `impressão=${String(evidencia['payload_fingerprint']).slice(0, 16)}`);

  const msg = (await todas('select * from inbox_message'))[0]!;
  prova('A3', 'a mensagem aponta para a evidência real (rastro conferido por join)',
    msg['meta']?.registroFonteId === String(evidencia['id']) && msg['meta']?.payloadFingerprint === r1.payloadFingerprint,
    `meta.registroFonteId=${msg['meta']?.registroFonteId}`);

  prova('A4', 'os eventos da conversa foram registrados (abertura + mensagem)',
    (await conta('inbox_thread_event')) >= 2,
    `eventos=${await conta('inbox_thread_event')}`);

  /* ---------------- B · sem empresa e sem CNPJ ---------------- */

  prova('B', 'NENHUMA conta comercial nasce: sem empresa, sem contato do Radar, sem entidade ligada',
    (await conta('radar_company')) === 0 && (await conta('radar_contact')) === 0
    && (await conta('radar_source_record', 'entity_id is not null')) === 0);

  prova('B2', 'e a submissão não trazia CNPJ nenhum',
    JSON.stringify(evidencia['payload']).includes('"cnpj"') === false || (evidencia['payload'] as any).canonical.cnpj === undefined,
    'o formulário não pede CNPJ');

  /* ---------------- C · o contato do atendente ---------------- */

  const contato = (await todas('select * from inbox_contact'))[0]!;
  const identidades = await todas('select channel, identifier, verified from inbox_contact_identity order by channel');
  prova('C', 'o contato deixa de ser «não identificado»: nome, empresa e relação lead',
    contato['name'] === 'Ana Lima (FICTÍCIO)' && contato['company_name'] === 'Lima Indústria (FICTÍCIO)' && contato['relation_kind'] === 'lead',
    `${contato['name']} · ${contato['company_name']} · ${contato['relation_kind']}`);

  prova('C2', 'o telefone entra como segunda identidade, NÃO verificada',
    identidades.length === 2 && identidades.some((i) => i['channel'] === 'WHATSAPP' && i['identifier'] === '5562900000000')
    && identidades.every((i) => i['verified'] === false),
    identidades.map((i) => `${i['channel']}:${i['identifier']}`).join(' · '));

  /* ---------------- D · a interface lê ---------------- */

  const ds = await lerPelaInterface();
  const thread = ds.threads[0]!;
  const texto = ds.mensagens[0]!.texto;
  prova('D', 'a camada de dados da INTERFACE devolve a conversa, o contato e o texto',
    ds.threads.length === 1 && ds.contatos.length === 1 && ds.mensagens.length === 1
    && thread.canal === 'PORTAL' && thread.contexto === 'EXTERNAL' && ds.contatos[0]!.nome === 'Ana Lima (FICTÍCIO)',
    `thread=${thread.id} status=${thread.status} canal=${thread.canal}`);

  const dadosUteis = ['Ana Lima', '900 m²', 'vão 20 m', 'Goiânia/GO', 'ana@exemplo.invalido', '62 90000-0000', '3 a 6 meses'];
  const faltando = dadosUteis.filter((d) => !texto.includes(d));
  prova('D2', 'e o texto da conversa traz nome, medidas, lugar, contato e prazo', faltando.length === 0,
    faltando.length === 0 ? `${texto.length} caracteres` : `faltando: ${faltando.join(', ')}`);

  prova('D3', 'o contato lido pela interface já tem as duas identidades',
    ds.contatos[0]!.identidades.length === 2 && ds.contatos[0]!.tipoRelacao === 'lead',
    ds.contatos[0]!.identidades.map((i) => i.canal).join('+'));

  prova('D4', 'o texto diz DE ONDE veio e rótula a leitura técnica da página como evidência',
    texto.includes('Origem: formulário "simular-galpao" do site (eiff.com.br).')
    && texto.includes(ROTULO_LEITURA_DA_PAGINA)
    && texto.includes('exige estudo estrutural específico')
    && texto.includes('não é orientação de engenharia da EIFF'),
    'a leitura do site vai palavra por palavra, com a fala identificada antes do conteúdo');

  /* ---------------- E · prazo de primeira resposta ---------------- */

  const threadLinha = (await todas('select * from inbox_thread'))[0]!;
  // A submissão chega segunda 09/11/2026 às 11:00 em São Paulo: 30 minutos ÚTEIS → 11:30 (14:30 UTC).
  // A RPC cria a conversa com as 24 h corridas da configuração; quem deixa 30 min úteis é o passo do prazo.
  prova('E', 'prazo de primeira resposta do lead do site: 30 minutos ÚTEIS a partir da submissão original',
    iso(threadLinha['sla_first_response_due']) === prazoDoLead(SUB) && prazoDoLead(SUB) === '2026-11-09T14:30:00.000Z'
    && r1.prazo.ajustado && r1.prazo.venceEm === prazoDoLead(SUB),
    `vence em ${iso(threadLinha['sla_first_response_due'])} (submissão ${SUB.recebidoEm})`);

  prova('E2', 'e a conversa tem RESPONSÁVEL, não fica só no setor',
    threadLinha['assignee_id'] !== null && String(threadLinha['assignee_id']) === ATENDENTE,
    `responsável=${threadLinha['assignee_id'] ?? '—'} status=${threadLinha['status']}`);

  /* ---------------- F · o roteador que já existia ---------------- */

  const setorDaThread = await uma('select s.code, t.assignee_id, t.status from inbox_thread t left join inbox_sector s on s.id = t.sector_id');
  prova('F', 'o Octopus Router manda a solicitação para o COMERCIAL',
    setorDaThread!['code'] === 'COMERCIAL',
    `setor=${setorDaThread!['code']} responsável=${setorDaThread!['assignee_id'] ?? '—'} status=${setorDaThread!['status']}`);

  prova('F2', 'e a decisão ficou registrada na thread (routing), para auditoria',
    threadLinha['routing'] !== null && typeof (threadLinha['routing'] as any)?.versao === 'string',
    `versão=${(threadLinha['routing'] as any)?.versao}`);

  /* ---------------- I e J · reenvio ---------------- */

  const antesDoReenvio = { ev: await conta('radar_source_record'), msg: await conta('inbox_message'), thr: await conta('inbox_thread'), ct: await conta('inbox_contact') };
  const r2 = await gravar(SUB);
  prova('I', 'RECUPERAÇÃO 3 · reenvio duplicado é IDEMPOTENTE: nada novo',
    r2.resultado === 'IDEMPOTENTE'
    && (await conta('radar_source_record')) === antesDoReenvio.ev
    && (await conta('inbox_message')) === antesDoReenvio.msg
    && (await conta('inbox_thread')) === antesDoReenvio.thr
    && (await conta('inbox_contact')) === antesDoReenvio.ct,
    `resultado=${r2.resultado}`);

  const r3 = await gravar(SUB);
  const r4 = await gravar(SUB);
  prova('J', 'RECUPERAÇÃO 4 · falha de rede depois de gravar: reenviar 3 vezes não duplica',
    r3.resultado === 'IDEMPOTENTE' && r4.resultado === 'IDEMPOTENTE'
    && (await conta('radar_source_record')) === antesDoReenvio.ev && (await conta('inbox_message')) === antesDoReenvio.msg);

  /* ---------------- P · a identidade é estável entre os DOIS caminhos de entrada ---------------- */

  // O evento do site entrega `{ payload: ... }`; a API oficial de submissões (que o reconciliador lê) entrega
  // o objeto cru, com MAIS campos. Se os dois não produzirem a mesma identidade e a mesma impressão, a
  // idempotência não vale nada e reconciliar duplicaria tudo.
  const PELA_API = submissaoDe({
    ...BRUTA_NETLIFY.payload, number: 41, title: null, summary: 'resumo que a plataforma monta',
    body: 'corpo que a plataforma monta', first_name: 'Ana', last_name: 'Lima', company: 'Lima Indústria (FICTÍCIO)',
  });
  const rP = await gravar(PELA_API);
  prova('P', 'evento e API oficial do Netlify produzem o MESMO candidato: identidade e impressão iguais',
    PELA_API.id === SUB.id && rP.payloadFingerprint === r1.payloadFingerprint && rP.resultado === 'IDEMPOTENTE'
    && (await conta('radar_source_record', "external_id = 'nf-prova-0001'")) === 1,
    `id=${PELA_API.id} resultado=${rP.resultado}`);

  prova('P2', 'e o MESMO id da submissão chega às DUAS gravações, de ponta a ponta',
    String(evidencia['external_id']) === 'nf-prova-0001'
    && String(msg['external_message_id']) === 'nf-prova-0001'
    && String(evidencia['external_id']) === String(msg['external_message_id'])
    && rP.externoId === String(evidencia['external_id']),
    `evidência.external_id = mensagem.external_message_id = ${evidencia['external_id']}`);

  /* ---------------- H · morreu entre as duas gravações ---------------- */

  const OUTRA = submissaoDe({ ...BRUTA_NETLIFY.payload, id: 'nf-prova-0002', data: { ...BRUTA_NETLIFY.payload.data, nome: 'Bruno Dias (FICTÍCIO)', email: 'bruno@exemplo.invalido' } });
  falharIngest = true;
  let morreu = false;
  try { await gravar(OUTRA); } catch { morreu = true; }
  falharIngest = false;
  const evidenciaOrfa = await conta('radar_source_record', "external_id = 'nf-prova-0002'");
  const conversaOrfa = await conta('inbox_message', "external_message_id = 'nf-prova-0002'");
  prova('H', 'RECUPERAÇÃO 2a · a falha entre as duas deixa a evidência salva e NENHUMA conversa',
    morreu && evidenciaOrfa === 1 && conversaOrfa === 0,
    `erro=${morreu} evidência=${evidenciaOrfa} conversa=${conversaOrfa}`);

  const r5 = await gravar(OUTRA);
  prova('H2', 'RECUPERAÇÃO 2b · o reenvio COMPLETA só a conversa, sem segunda evidência',
    r5.resultado === 'COMPLETADO'
    && (await conta('radar_source_record', "external_id = 'nf-prova-0002'")) === 1
    && (await conta('inbox_message', "external_message_id = 'nf-prova-0002'")) === 1,
    `resultado=${r5.resultado} passos=${r5.passos.join('+')}`);

  prova('H3', 'e a conversa completada aponta para a evidência que já existia',
    r5.registroFonteId === String((await uma("select id from radar_source_record where external_id = 'nf-prova-0002'"))!['id']));

  /* ---------------- G · endpoint indisponível, recuperado pela reconciliação ---------------- */

  const PERDIDA = { ...BRUTA_NETLIFY.payload, id: 'nf-prova-0003', created_at: '2026-11-11T09:00:00.000Z', data: { ...BRUTA_NETLIFY.payload.data, nome: 'Carla Reis (FICTÍCIO)', email: 'carla@exemplo.invalido' } };
  const nadaChegou = (await conta('radar_source_record', "external_id = 'nf-prova-0003'")) === 0;
  // A reconciliação lê a submissão guardada no Netlify e a manda pelo MESMO caminho.
  const plano = planoDaReconciliacao([PERDIDA], { marco: '2026-11-10T00:00:00.000Z', formulariosAceitos: ['simular-galpao'] });
  const r6 = await gravar(plano.enviar[0]!.submissao);
  prova('G', 'RECUPERAÇÃO 1 · endpoint indisponível (nada gravado) → a reconciliação grava do zero',
    nadaChegou && plano.enviar.length === 1 && r6.resultado === 'REGISTRADO'
    && (await conta('inbox_message', "external_message_id = 'nf-prova-0003'")) === 1,
    `resultado=${r6.resultado}`);

  prova('G2', 'e a identidade que a reconciliação calculou é a que o banco guardou',
    plano.enviar[0]!.externoId === String((await uma("select external_id from radar_source_record where external_id = 'nf-prova-0003'"))!['external_id'])
    && plano.enviar[0]!.payloadFingerprint === String((await uma("select payload_fingerprint from radar_source_record where external_id = 'nf-prova-0003'"))!['payload_fingerprint']));

  /* ---------------- K · nova versão da mesma submissão ---------------- */

  const NOVA_VERSAO = submissaoDe({ ...BRUTA_NETLIFY.payload, data: { ...BRUTA_NETLIFY.payload.data, area: '1200' } });
  const r7 = await gravar(NOVA_VERSAO);
  prova('K', 'RECUPERAÇÃO 5 · nova versão nasce AO LADO, sem sobrescrever e sem repetir a conversa',
    r7.resultado === 'NOVA_OBSERVACAO'
    && (await conta('radar_source_record', "external_id = 'nf-prova-0001'")) === 2
    && (await conta('inbox_message', "external_message_id = 'nf-prova-0001'")) === 1,
    `observações=${await conta('radar_source_record', "external_id = 'nf-prova-0001'")}`);

  prova('K2', 'e a observação anterior continua intacta, com a impressão antiga',
    (await conta('radar_source_record', 'external_id = $1 and payload_fingerprint = $2', ['nf-prova-0001', r1.payloadFingerprint])) === 1);

  /* ---------------- L e M · o que o banco recusa ---------------- */

  await recusa(`update radar_source_record set payload = '{"adulterado":true}'::jsonb where id = $1`, [evidencia['id']],
    'L', 'editar o payload da evidência é recusado pelo trigger');

  await recusa(`update radar_source_record set intake_status = 'RESOLVED' where id = $1`, [evidencia['id']],
    'M', 'RESOLVED sem entity_id é recusado pelo CHECK: promover exige entidade');

  /* ---------------- N · o telefone de outro contato ---------------- */

  const outroContato = String((await uma(`insert into inbox_contact (organization_id, name, relation_kind) values ($1, 'Cliente antigo', 'cliente') returning id`, [ORG]))!['id']);
  await db.query(`insert into inbox_contact_identity (organization_id, contact_id, channel, identifier, verified) values ($1,$2,'WHATSAPP','5562911112222',true)`, [ORG, outroContato]);
  const COM_TELEFONE_DE_OUTRO = submissaoDe({ ...BRUTA_NETLIFY.payload, id: 'nf-prova-0004', data: { ...BRUTA_NETLIFY.payload.data, email: 'dora@exemplo.invalido', telefone: '62 91111-2222' } });
  const r8 = await gravar(COM_TELEFONE_DE_OUTRO);
  const donoDoNumero = await uma(`select contact_id, verified from inbox_contact_identity where identifier = '5562911112222'`);
  prova('N', 'telefone que já é de outro contato NÃO troca de dono — e a submissão entra do mesmo jeito',
    r8.resultado === 'REGISTRADO' && String(donoDoNumero!['contact_id']) === outroContato && donoDoNumero!['verified'] === true
    && (await conta('inbox_contact_identity', "identifier = '5562911112222'")) === 1,
    `dono preservado=${String(donoDoNumero!['contact_id']) === outroContato}`);

  /* ---------------- O · estado final ---------------- */

  const final = {
    evidencias: await conta('radar_source_record'),
    pendentes: await conta('radar_source_record', "intake_status = 'PENDING'"),
    comEntidade: await conta('radar_source_record', 'entity_id is not null'),
    threads: await conta('inbox_thread'),
    mensagens: await conta('inbox_message'),
    contatos: await conta('inbox_contact'),
    empresasRadar: await conta('radar_company'),
  };
  prova('O', 'estado final: 5 evidências PENDING, 4 conversas, nenhuma conta comercial',
    final.evidencias === 5 && final.pendentes === 5 && final.comEntidade === 0
    && final.threads === 4 && final.mensagens === 4 && final.empresasRadar === 0,
    JSON.stringify(final));

  /* ---------------- Q · a fonte configurada tem de ser a do formulário do site ---------------- */

  const antes = { ev: await conta('radar_source_record'), th: await conta('inbox_thread'), msg: await conta('inbox_message'), ct: await conta('inbox_contact') };
  const NOVA = (id: string, email: string, criadoEm = '2026-11-12T13:00:00.000Z') =>
    submissaoDe({ ...BRUTA_NETLIFY.payload, id, created_at: criadoEm, data: { ...BRUTA_NETLIFY.payload.data, email, telefone: '' } });
  const fontesErradas: [string, string, string][] = [
    ['WEBSITE de outro código', FONTE_OFICIAL, 'fonte_nao_canonica'],
    ['de outro tipo', FONTE_CNO, 'fonte_nao_website'],
    ['inativa, de outro código', FONTE_INATIVA, 'fonte_nao_canonica'],
    ['de outra organização', FONTE_DE_OUTRA_ORG, 'fonte_inexistente'],
    ['inexistente', FONTE_INEXISTENTE, 'fonte_inexistente'],
  ];
  const motivos: string[] = [];
  for (const [, fonteId] of fontesErradas) {
    const e = await gravarSubmissao(NOVA('nf-prova-fonte', 'fonte@exemplo.invalido'), fonteId, ORG, portas()).catch((x: unknown) => x);
    motivos.push(e instanceof ErroDeConfiguracao ? e.motivo : `SEM ERRO DE CONFIGURAÇÃO: ${String(e)}`);
  }
  // a PRÓPRIA fonte do site, desativada: o código é único por organização, então «inativa» é ela mesma desligada
  await db.query('update radar_source set active = false where id = $1', [FONTE]);
  const eInativa = await gravarSubmissao(NOVA('nf-prova-fonte', 'fonte@exemplo.invalido'), FONTE, ORG, portas()).catch((x: unknown) => x);
  motivos.push(eInativa instanceof ErroDeConfiguracao ? eInativa.motivo : `SEM ERRO DE CONFIGURAÇÃO: ${String(eInativa)}`);
  await db.query('update radar_source set active = true where id = $1', [FONTE]);
  const depois = { ev: await conta('radar_source_record'), th: await conta('inbox_thread'), msg: await conta('inbox_message'), ct: await conta('inbox_contact') };
  prova('Q', 'fonte errada (WEBSITE de outro código, outro tipo, outra organização, inexistente, e a do site desativada) → erro de configuração e ZERO escrita',
    JSON.stringify(motivos) === JSON.stringify([...fontesErradas.map((f) => f[2]), 'fonte_inativa']) && JSON.stringify(antes) === JSON.stringify(depois),
    `${motivos.join(' · ')} · antes=${JSON.stringify(antes)} depois=${JSON.stringify(depois)}`);

  /* ---------------- R · os outros canais continuam com o SLA da configuração ---------------- */

  const cfgAntes = (await uma('select sla_hours from inbox_config where organization_id = $1', [ORG]))!['sla_hours'];
  const zap = await uma(
    `select inbox_ingest($1::uuid,'META_CLOUD','WHATSAPP','EXTERNAL','5562988887777','Contato de WhatsApp (FICTÍCIO)','wamid.prova-0001',null,
       'Bom dia, preciso de um orçamento.','texto','2026-11-12T13:00:00.000Z'::timestamptz,null,null,null,'[]'::jsonb,'{}'::jsonb) as d`, [ORG]);
  const threadZap = await uma('select opened_at, sla_first_response_due from inbox_thread where id = $1', [(zap!['d'] as Record<string, unknown>)['thread_id']]);
  const horasZap = (new Date(threadZap!['sla_first_response_due']).getTime() - new Date(threadZap!['opened_at']).getTime()) / 3_600_000;
  const cfgDepois = (await uma('select sla_hours from inbox_config where organization_id = $1', [ORG]))!['sla_hours'];
  prova('R', 'outro canal (WhatsApp) continua com as 24 h corridas, e a configuração global de SLA não foi tocada',
    horasZap === 24 && JSON.stringify(cfgAntes) === JSON.stringify(cfgDepois) && Number((cfgDepois as Record<string, number>)['Normal']) === 24,
    `WhatsApp: ${horasZap} h · sla_hours=${JSON.stringify(cfgDepois)}`);

  /* ---------------- S · falha no ajuste do prazo: sem falso sucesso, e o reenvio conserta ---------------- */

  const COM_FALHA = NOVA('nf-prova-prazo', 'prazo@exemplo.invalido');
  falharPrazo = true;
  const tentativa = await gravar(COM_FALHA).catch((x: unknown) => x);
  falharPrazo = false;
  const parcial = await portas().prazoDaConversa('MANUAL', 'nf-prova-prazo');
  const semSucesso = tentativa instanceof ErroDeGravacao && tentativa.etapa === 'prazo';
  const ficouErrado = parcial !== undefined && parcial.venceEm !== prazoDoLead(COM_FALHA);
  prova('S', 'falha ao gravar o prazo → ERRO na etapa «prazo» (a borda responde 502), nunca sucesso com prazo errado',
    semSucesso && ficouErrado,
    `erro=${tentativa instanceof Error ? tentativa.message : String(tentativa)} · prazo que ficou=${parcial?.venceEm}`);

  const contagem = async () => ({
    ev: await conta('radar_source_record', "external_id = 'nf-prova-prazo'"),
    msg: await conta('inbox_message', "external_message_id = 'nf-prova-prazo'"),
    th: await conta('inbox_thread'),
  });
  const antesDoReenvioPrazo = await contagem();
  const reenvio = await gravar(COM_FALHA);
  const consertado = await portas().prazoDaConversa('MANUAL', 'nf-prova-prazo');
  const depoisDoReenvioPrazo = await contagem();
  prova('S2', 'o reenvio conserta o prazo: IDEMPOTENTE, mesma evidência, mesma conversa, vencimento certo',
    reenvio.resultado === 'IDEMPOTENTE' && reenvio.prazo.ajustado && consertado?.venceEm === prazoDoLead(COM_FALHA)
    && JSON.stringify(antesDoReenvioPrazo) === JSON.stringify(depoisDoReenvioPrazo) && antesDoReenvioPrazo.ev === 1 && antesDoReenvioPrazo.msg === 1,
    `resultado=${reenvio.resultado} · vence em ${consertado?.venceEm} · ${JSON.stringify(depoisDoReenvioPrazo)}`);

  const terceiro = await gravar(COM_FALHA);
  prova('S3', 'e um terceiro envio não escreve mais nada no prazo',
    terceiro.resultado === 'IDEMPOTENTE' && !terceiro.prazo.ajustado && terceiro.prazo.motivo === 'prazo_correto');

  /* ---------------- T · sexta à noite, feriado e a segunda solicitação da mesma pessoa ---------------- */

  const SEXTA = NOVA('nf-prova-sexta', 'sexta@exemplo.invalido', '2026-11-13T22:00:00.000Z');   // sexta 19:00 em São Paulo
  const FERIADO = NOVA('nf-prova-feriado', 'feriado@exemplo.invalido', '2026-11-20T13:00:00.000Z'); // sexta 20/11, Consciência Negra
  const rSexta = await gravar(SEXTA);
  const rFeriado = await gravar(FERIADO);
  prova('T', 'sexta à noite e feriado: o prazo vence às 08:30 da segunda seguinte (horário de São Paulo)',
    rSexta.prazo.venceEm === '2026-11-16T11:30:00.000Z' && rFeriado.prazo.venceEm === '2026-11-23T11:30:00.000Z',
    `sexta → ${rSexta.prazo.venceEm} · feriado → ${rFeriado.prazo.venceEm}`);

  const SEGUNDA_SOLICITACAO = NOVA('nf-prova-sexta-2', 'sexta@exemplo.invalido', '2026-11-14T15:00:00.000Z');
  const threadsAntes = await conta('inbox_thread');
  const rSegunda = await gravar(SEGUNDA_SOLICITACAO);
  prova('T2', 'segunda solicitação da mesma pessoa, sem resposta à primeira: mesma conversa, e vale o prazo mais curto',
    rSegunda.resultado === 'REGISTRADO' && (await conta('inbox_thread')) === threadsAntes
    && rSegunda.prazo.venceEm === '2026-11-16T11:30:00.000Z' && !rSegunda.prazo.ajustado
    && (await conta('inbox_message', "external_message_id in ('nf-prova-sexta','nf-prova-sexta-2')")) === 2,
    `conversas=${await conta('inbox_thread')} (antes ${threadsAntes}) · prazo=${rSegunda.prazo.venceEm} (${rSegunda.prazo.motivo})`);

  /* ---------------- V · a consulta de conferência do ensaio ---------------- */

  // O MESMO arquivo que a pessoa roda em produção depois do ensaio, aqui apontado para o lead da prova A.
  const sqlConferencia = fs.readFileSync('scripts/formulario-ensaio-conferencia.sql', 'utf8').replace('ensaio-ficticio@exemplo.invalido', 'ana@exemplo.invalido');
  const conf = (await uma(sqlConferencia))!['ensaio'] as Record<string, any>;
  const cv = conf['conversa']?.[0]; const ct = conf['contato']?.[0]; const evs = conf['evidencias'] ?? [];
  prova('V', 'a consulta de conferência do ensaio roda neste schema e acha o lead pelo e-mail: evidência vinculada, COMERCIAL, responsável e prazo',
    Array.isArray(conf['mensagens']) && conf['mensagens'].length >= 1 && evs.length >= 1
    && evs.every((e: Record<string, any>) => e['status'] === 'PENDING' && e['entidade'] === null && e['fonte_codigo'] === 'WEBSITE')
    && evs.some((e: Record<string, any>) => e['mesma_da_mensagem'] === true)
    && cv?.['setor'] === 'COMERCIAL' && cv?.['responsavel'] !== null && Number(cv?.['minutos_corridos_ate_o_prazo']) === 30
    && ct?.['relacao'] === 'lead' && conf['empresas_criadas_desde_o_ensaio'] === 0,
    JSON.stringify({ conversa: cv, contato: ct, evidencias: evs.length, mensagens: conf['mensagens']?.length }).slice(0, 400));

  prova('U', 'ao final de tudo: nenhuma empresa do Radar e nenhuma evidência com entidade',
    (await conta('radar_company')) === 0 && (await conta('radar_source_record', 'entity_id is not null')) === 0);

  await db.exec('rollback');
  await db.close();

  const falhas = provas.filter((p) => !p.ok);
  console.log(JSON.stringify({ provas, limites: LIMITES, total: provas.length, falhas: falhas.length }, null, 2));
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
