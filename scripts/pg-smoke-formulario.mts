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
 *   O  estado final conferido linha por linha
 *
 * O @electric-sql/pglite é devDependency FIXADA. O banco é em memória, roda dentro de BEGIN ... ROLLBACK e
 * morre com o processo. NADA toca produção e NÃO há conexão de rede.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { gravarSubmissao, linhaDeEvidencia, type PortasGravacao } from '../src/core/radar/formularioGravacao';
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
create table radar_company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), legal_name text);
create table radar_contact (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), full_name text);
create table radar_source (id uuid primary key, organization_id uuid not null references organization(id), code text);
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
insert into radar_source (id, organization_id, code) values ('${FONTE}', '${ORG}', 'WEBSITE');
insert into inbox_sector (id, organization_id, code, name, sort_order, default_assignee_id) values
  ('${SETOR_COMERCIAL}', '${ORG}', 'COMERCIAL', 'Comercial', 1, '${ATENDENTE}'),
  ('cccccccc-0000-0000-0000-000000000002', '${ORG}', 'ADMINISTRATIVO', 'Administrativo', 2, null);
insert into inbox_member (organization_id, profile_id, sector_id, member_role) values ('${ORG}', '${ATENDENTE}', '${SETOR_COMERCIAL}', 'gestor');
insert into inbox_config (organization_id) values ('${ORG}');
`;

/* ------------------------------------------------------------------ a submissão fictícia */

const BRUTA_NETLIFY = {
  payload: {
    id: 'nf-prova-0001',
    form_name: 'simular-galpao',
    created_at: '2026-11-09T14:00:00.000Z',
    data: {
      nome: 'Ana Lima (FICTÍCIO)', email: 'ana@exemplo.invalido', telefone: '62 90000-0000',
      empresa: 'Lima Indústria (FICTÍCIO)', cidade: 'Goiânia, GO', uso: 'industrial',
      area: '900', vao: '20', comprimento: '45', peDireito: '8',
      observacao: 'Preciso de um galpão para a fábrica. Qual o prazo?',
      resumo: 'Industrial · 900 m² · vão 20 m', prazo: '3 a 6 meses',
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
  const sel = async (tabela: string, ordem: string) => todas(`select * from ${tabela} order by ${ordem}`);
  const lerPelaInterface = (): Promise<InboxDataset> => carregarInbox({ sel, orgId: ORG, obraCodigo: () => undefined });

  let falharIngest = false;
  const portas = (): PortasGravacao => ({
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

  /* ---------------- E · prazo de primeira resposta ---------------- */

  const threadLinha = (await todas('select * from inbox_thread'))[0]!;
  prova('E', 'prazo de primeira resposta gravado pela configuração do Inbox',
    threadLinha['sla_first_response_due'] !== null,
    `vence em ${threadLinha['sla_first_response_due']}`);

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

  await db.exec('rollback');
  await db.close();

  const falhas = provas.filter((p) => !p.ok);
  console.log(JSON.stringify({ provas, limites: LIMITES, total: provas.length, falhas: falhas.length }, null, 2));
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
