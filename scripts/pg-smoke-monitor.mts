/**
 * Prova do MONITOR da reconciliação e da RECUPERAÇÃO EXATAMENTE UMA VEZ contra um PostgreSQL de verdade
 * (PGlite, em memória, descartável). E10.17 da Frente A.
 *
 *   npx vite-node scripts/pg-smoke-monitor.mts        (imprime JSON; sai com 1 se qualquer prova falhar)
 *
 * ── PARTE A · o monitor sobre a `audit_log` real ─────────────────────────────────────────────────
 *
 * A tabela, os índices e as políticas vêm das migrations (0001, 0003, 0005), extraídos do arquivo, não reescritos.
 * As portas são as de PRODUÇÃO (`portaMonitorRest`): o `fetch` delas cai num tradutor mínimo PostgREST → SQL que
 * executa cada pedido como `service_role` — o papel que a chave de serviço assume. Assim o que se prova é o que o
 * banco aceita para as consultas que o código realmente monta.
 *
 *   A1  persistência da rodada: colunas, origem, entidade e o registro de lista fechada lido de volta
 *   A2  formato compatível com a leitura da auditoria pelo app (`supabase.ts`, mapeamento de `audit_log`)
 *   A3  visibilidade: Administrador vê as linhas na tela de Auditoria; Compras e anon não; o app não grava como monitor
 *   A4  concorrência: dois observadores ao mesmo tempo → duas reivindicações, UMA entrega
 *   A5  deduplicação: a passada seguinte suprime, sem linha nova
 *   A6  falha parcial: canal fora do ar → reivindicação sem entrega → a passada seguinte entrega uma vez
 *   A7  execução interrompida depois de reivindicar → a reivindicação caduca e o alerta sai uma vez
 *   A8  falha ao gravar a rodada não lança (e o observador então vê a ausência)
 *   A9  permissões mínimas: só SELECT + INSERT na tabela e USAGE na sequência bastam ao ciclo inteiro
 *   A10 crescimento: 30 dias de rodadas a cada 10 min — tamanho, plano de consulta, e o efeito na tela de Auditoria
 *   A11 a correção: a consulta oficial da tela (`consultaAuditoria`, supabase-js de verdade → URL → banco, como
 *       Administrador) filtra o monitor no banco, antes do limite; nenhuma linha do monitor é apagada
 *
 * ── PARTE B · recuperação exatamente uma vez (schema real do Lead Engine e do Inbox) ─────────────
 *
 * Migrations 0055, 0056 e 0057; preâmbulo e semente LIDOS de `pg-smoke-formulario.mts` (mesma base, sem cópia).
 * A rodada é a REAL (`rodadaDeReconciliacao` → `gravarSubmissao` → RPC `inbox_ingest`), com o Netlify simulado.
 *
 *   B1  submissão perdida pelo evento é recuperada: 1 evidência, 1 mensagem, 1 conversa
 *   B2  a entregue pelo evento é «já dentro»; a anterior ao marco e o ensaio excluído ficam retidos
 *   B3  o prazo da conversa recuperada conta da submissão ORIGINAL (não é redefinido para agora)
 *   B4  rodadas repetidas e simultâneas: continua exatamente uma vez
 *   B5  duas rodadas ao mesmo tempo sobre uma submissão nova perdida: exatamente uma vez
 *   B6  o monitor lê os resumos reais e avisa a recuperação, sem dado pessoal
 *   B7  correção (E10.19): na corrida entre rodadas a perdedora é CONCORRENTE — nenhuma falha, nenhum alerta falso
 *   B8  classificador (E10.18): na corrida real, a gravação que perde é «concluída por outra rodada»
 *   B9  classificador: conflito com a conversa ainda ausente é «parcial»; a gravação seguinte completa
 *   B10 classificador: falha real da conversa é «erro de persistência», mesmo com a evidência gravada
 *
 * A porta de evidência desta parte traduz a violação de unicidade (23505) em «http 409», como o PostgREST faz; o
 * classificador está ligado à rodada desde a E10.19 (`docs/formulario-site-go3-monitor.md` §8).
 *
 * Tudo fictício, em memória, sem rede. NADA toca produção.
 */
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { rodadaDeReconciliacao, type AmbienteAgendado, type ResumoRodada } from '../src/core/radar/formularioAgendado'
import { gravarSubmissao, prazoDoLead, type PortasGravacao } from '../src/core/radar/formularioGravacao'
import { argsIngest, resultadoIngest } from '../src/core/inbox/ingestaoPorta'
import { registroDoBanco } from '../src/core/radar/formularioPorta'
import { corpoDaSubmissaoNetlify } from '../src/core/radar/formularioTransporte'
import { validarCorpo } from '../src/core/radar/formularioServidor'
import { avaliarRodadas, configParaIntervalo, problemasDeDadoPessoal, registroDaRodada } from '../src/core/radar/formularioMonitor'
import { ENTIDADE, portaMonitorRest } from '../src/core/radar/formularioMonitorPorta'
import { JANELA_REIVINDICACAO_MIN, observar, registrarRodada } from '../src/core/radar/formularioObservador'
import { canalSimulado } from '../src/core/radar/formularioAlertaCanais'
import { classificarAposFalha } from '../src/core/radar/formularioConcorrencia'
import { planoDaReconciliacao } from '../src/core/radar/formularioReconciliacao'
import { PROVIDER_FORMULARIO } from '../src/core/inbox/formularioSite'
import { consultaAuditoria } from '../src/data/supabase'
import { createClient } from '@supabase/supabase-js'
import type { SubmissaoFormulario } from '../src/core/radar/formularioSite'

const MIG = new URL('../supabase/migrations/', import.meta.url)
const mig = (n: string) => fs.readFileSync(new URL(n, MIG), 'utf8')
const extrair = (texto: string, re: RegExp, nome: string): string => {
  const m = re.exec(texto)
  if (m === null) throw new Error(`não achei ${nome} na migration: a prova não roda contra um schema inventado`)
  return m[0]
}

const provas: { id: string; descricao: string; ok: boolean; detalhe?: string }[] = []
const prova = (id: string, descricao: string, ok: boolean, detalhe?: string) => {
  provas.push({ id, descricao, ok, ...(detalhe === undefined ? {} : { detalhe }) })
}

const LIMITES: readonly string[] = Object.freeze([
  'PGlite é PostgreSQL de verdade, mas UMA conexão: «ao mesmo tempo» é intercalação nos pontos de espera (await), não paralelismo de CPU. A corrida que importa aqui (ler → reivindicar → reler) acontece nesses pontos',
  'o tradutor PostgREST → SQL cobre só o que a porta usa (eq, gte, order, select, limit, POST com return=representation); o PostgREST real não é executado',
  'o relógio do banco é controlado pela prova: o default de occurred_at lê o GUC prova.agora (cai em now() sem ele), para simular minutos sem esperar',
  'a parte B roda como dono do banco (RLS e GRANT do Inbox são provados em pg-smoke-inbox.mjs); a parte A exerce RLS e GRANT de verdade',
  'nenhuma chamada de rede, nenhum dado real; o banco morre com o processo',
])

/* ═══════════════════════════════════════════════ PARTE A ═══════════════════════════════════════════════ */

const ORG = '11111111-1111-1111-1111-111111111111'
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const COMPRAS = 'aaaaaaaa-0000-0000-0000-000000000002'

const PRELUDIO_A = `
create schema if not exists auth;
do $p$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $p$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');
create table organization (id uuid primary key, name text not null);
create table profile (id uuid primary key, organization_id uuid not null references organization(id), name text not null, role role_kind not null, active boolean not null default true);
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
create or replace function current_org() returns uuid language sql stable security definer as $f$ select organization_id from profile where id = auth.uid() and active $f$;
create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $f$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles)) $f$;
grant usage on schema public, auth to authenticated, anon, service_role;
`

async function parteA() {
  const db = new PGlite()
  await db.exec(PRELUDIO_A)
  const core = mig('0001_core.sql')
  await db.exec(extrair(core, /create table audit_log \([\s\S]*?\n\);/, 'audit_log (0001)'))
  for (const idx of core.match(/create index on audit_log \([^)]*\);/g) ?? []) await db.exec(idx)
  // O default do instante passa a ler o relógio da prova; sem o GUC, é o now() original.
  await db.exec(`alter table audit_log alter column occurred_at set default coalesce(nullif(current_setting('prova.agora', true), '')::timestamptz, now())`)
  await db.exec('alter table audit_log enable row level security') // 0003: o laço liga RLS em toda tabela de public
  await db.exec(extrair(mig('0003_rls.sql'), /create policy audit_select on audit_log[^;]*;/, 'audit_select (0003)'))
  await db.exec(mig('0005_audit_app_insert.sql'))
  // Os GRANT padrão do Supabase para as tabelas de public.
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;
                 grant usage, select on all sequences in schema public to authenticated, anon, service_role;`)
  await db.exec(`insert into organization values ('${ORG}', 'EIFF');
                 insert into profile values ('${ADMIN}', '${ORG}', 'Admin', 'Administrador', true), ('${COMPRAS}', '${ORG}', 'Compras', 'Compras', true);`)

  /* ── relógio da prova e tradutor PostgREST → SQL como service_role ── */
  let agora = Date.parse('2026-11-20T10:00:00.000Z')
  const agoraIso = () => new Date(agora).toISOString()
  const avancar = (min: number) => { agora += min * 60_000 }
  let pedidosHttp = 0
  const comoTexto = (l: Record<string, unknown>) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))

  /** Executa como o papel do PostgREST: `service_role` (chave de serviço) ou `authenticated` com o usuário do JWT. */
  async function comoPapel<T>(papel: 'service_role' | 'authenticated', uid: string, f: () => Promise<T>): Promise<T> {
    await db.exec(`set prova.agora = '${agoraIso()}'; set test.uid = '${uid}'; set role ${papel}`)
    try { return await f() } finally { await db.exec('reset role') }
  }

  const criarShim = (papel: 'service_role' | 'authenticated', uid = '') => (async (entrada: string | URL, init?: RequestInit) => {
    pedidosHttp += 1
    const comoServico = <T,>(f: () => Promise<T>) => comoPapel(papel, uid, f)
    const u = new URL(String(entrada))
    const tabela = u.pathname.replace(/^\/rest\/v1\//, '')
    const responder = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
    try {
      if ((init?.method ?? 'GET') === 'POST') {
        const corpo = JSON.parse(String(init?.body)) as Record<string, unknown>
        const cols = Object.keys(corpo)
        const params = cols.map((c) => (corpo[c] !== null && typeof corpo[c] === 'object' ? JSON.stringify(corpo[c]) : corpo[c]))
        const devolver = String((init?.headers as Record<string, string> | undefined)?.['prefer'] ?? '').includes('return=representation')
        const r = await comoServico(() => db.query(`insert into ${tabela} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})${devolver ? ' returning *' : ''}`, params))
        return responder(201, devolver ? r.rows.map((l) => comoTexto(l as Record<string, unknown>)) : [])
      }
      const onde: string[] = []
      const params: unknown[] = []
      let ordem = ''
      let selecao = '*'
      let limite = ''
      for (const [k, v] of u.searchParams) {
        if (k === 'order') { const [c, d] = v.split('.'); ordem = ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}` }
        else if (k === 'select') selecao = v
        else if (k === 'limit') limite = ` limit ${Number(v)}`
        else {
          const [op, ...resto] = v.split('.')
          const val = resto.join('.')
          params.push(val)
          if (op === 'eq') onde.push(`${k}::text = $${params.length}`)
          else if (op === 'neq') onde.push(`${k}::text <> $${params.length}`)
          else if (op === 'gte') onde.push(`${k} >= $${params.length}::timestamptz`)
          else throw new Error(`operador não suportado pelo tradutor: ${op}`)
        }
      }
      const r = await comoServico(() => db.query(`select ${selecao} from ${tabela}${onde.length ? ` where ${onde.join(' and ')}` : ''}${ordem}${limite}`, params))
      return responder(200, r.rows.map((l) => comoTexto(l as Record<string, unknown>)))
    } catch (e) {
      const m = String((e as Error).message)
      return responder(/permission denied|row-level security/.test(m) ? 403 : 400, { message: m })
    }
  }) as unknown as typeof fetch
  const fetchShim = criarShim('service_role')

  const porta = portaMonitorRest({ url: 'https://prova.supabase.local', chave: 'chave-de-prova', organizacaoId: ORG }, fetchShim)
  const env = { FORMULARIO_MONITOR: 'ativo', FORMULARIO_INTERVALO_MIN: '10' }
  const contar = async (acao: string) => Number((await db.query(`select count(*)::int n from audit_log where entity_type = '${ENTIDADE}' and action = '${acao}'`)).rows[0]!['n' as never])
  const resumo = (desfecho: ResumoRodada['desfecho'], extra: Partial<ResumoRodada> = {}): ResumoRodada => ({
    desfecho, em: agoraIso(), lidas: 14, elegiveis: 0, jaDentro: 0, processadas: 0, restam: 0, retidas: 14,
    motivosRetencao: { anterior_ao_marco: 11, id_excluido: 3 }, resultados: {}, recuperadas: 0, falhas: 0, duracaoMs: 900, ...extra,
  })
  const observarCom = (canal: ReturnType<typeof canalSimulado>) => observar(env, { fetch: fetchShim, agoraIso, canal, porta })

  // A1 · persistência
  const r1 = await registrarRodada(env, resumo('concluida'), { fetch: fetchShim, porta })
  const linha = (await db.query(`select * from audit_log where entity_type = '${ENTIDADE}' and action = 'rodada'`)).rows[0] as Record<string, any>
  const lidas = await porta.rodadasDesde(new Date(agora - 60_000).toISOString())
  prova('A1', 'a rodada é gravada na audit_log real (entidade, ação, origem) e lida de volta igual ao registro de lista fechada',
    r1 === 'gravada' && linha?.['source'] === 'formulario-monitor' && linha?.['organization_id'] === ORG && linha?.['actor_id'] === null
    && JSON.stringify(lidas[0]) === JSON.stringify(registroDaRodada(resumo('concluida'))),
    JSON.stringify({ r1, source: linha?.['source'], chaves: Object.keys(linha?.['after_data'] ?? {}).length }))

  // A2 · compatível com o mapeamento do app (supabase.ts: id, ts, acao, entidade, entidadeId, depois)
  const doApp = (await db.query(`select * from audit_log order by occurred_at desc limit 500`)).rows.map((l: any) => ({
    id: String(l.id), ts: l.occurred_at, acao: l.action, entidade: l.entity_type, entidadeId: l.entity_id ?? '', depois: l.after_data ?? undefined,
  }))
  prova('A2', 'a linha passa pelo mapeamento de auditoria do app sem campo obrigatório faltando',
    doApp.length === 1 && doApp[0]!.acao === 'rodada' && doApp[0]!.entidade === ENTIDADE && doApp[0]!.ts instanceof Date && /^\d+$/.test(doApp[0]!.id))

  // A3 · quem vê e quem grava
  const veComo = async (uid: string | null, papel: 'authenticated' | 'anon') => {
    await db.exec(`set test.uid = '${uid ?? ''}'; set role ${papel}`)
    try { return Number((await db.query(`select count(*)::int n from audit_log where entity_type = '${ENTIDADE}'`)).rows[0]!['n' as never]) }
    finally { await db.exec('reset role') }
  }
  const admin = await veComo(ADMIN, 'authenticated')
  const compras = await veComo(COMPRAS, 'authenticated')
  const anonimo = await veComo(null, 'anon')
  let appGravaComoMonitor = true
  await db.exec(`set test.uid = '${ADMIN}'; set role authenticated`)
  try {
    await db.query(`insert into audit_log (organization_id, actor_id, action, entity_type, source) values ('${ORG}', '${ADMIN}', 'rodada', '${ENTIDADE}', 'formulario-monitor')`)
  } catch { appGravaComoMonitor = false } finally { await db.exec('reset role') }
  prova('A3', 'Administrador vê as linhas do monitor (tela de Auditoria); Compras e anon não; o app não consegue gravar como monitor',
    admin === 1 && compras === 0 && anonimo === 0 && !appGravaComoMonitor, JSON.stringify({ admin, compras, anonimo, appGravaComoMonitor }))

  // A4 · concorrência: falha de credencial dispara alerta imediato
  avancar(10)
  await registrarRodada(env, resumo('erro_de_leitura', { motivo: 'submissões: http 401' }), { fetch: fetchShim, porta })
  avancar(1)
  const c1 = canalSimulado('c1')
  const c2 = canalSimulado('c2')
  const [o1, o2] = await Promise.all([observarCom(c1), observarCom(c2)])
  prova('A4', 'dois observadores ao mesmo tempo: as duas reivindicações chegam ao banco e só UMA entrega acontece',
    (await contar('alerta')) === 2 && (await contar('alerta_entregue')) === 1 && c1.recebidos.length + c2.recebidos.length === 1 && o1.cedidos + o2.cedidos === 1,
    JSON.stringify({ reivindicacoes: await contar('alerta'), entregas: await contar('alerta_entregue'), c1: c1.recebidos.length, c2: c2.recebidos.length }))

  // A5 · deduplicação
  avancar(10)
  const c3 = canalSimulado('c3')
  const o3 = await observarCom(c3)
  prova('A5', 'a passada seguinte suprime o alerta já entregue: nenhuma linha nova, nenhum aviso',
    o3.suprimidos === 1 && o3.novos === 0 && c3.recebidos.length === 0 && (await contar('alerta')) === 2 && (await contar('alerta_entregue')) === 1,
    JSON.stringify(o3))

  // A6 · canal fora do ar → a passada seguinte entrega
  avancar(10)
  await registrarRodada(env, resumo('concluida', { elegiveis: 1, processadas: 1, falhas: 1 }), { fetch: fetchShim, porta })
  const fora = canalSimulado('fora')
  fora.falhar = true
  avancar(1)
  const o4 = await observarCom(fora)
  const entregasAntes = await contar('alerta_entregue')
  fora.falhar = false
  avancar(10)
  const o5 = await observarCom(fora)
  prova('A6', 'canal fora do ar: a reivindicação fica sem entrega e a passada seguinte entrega uma vez',
    o4.pendentes >= 1 && o4.novos === 0 && o5.novos >= 1 && fora.recebidos.filter((m) => m.tipo === 'FALHA_GRAVACAO').length === 1
    && (await contar('alerta_entregue')) === entregasAntes + o5.novos,
    JSON.stringify({ o4: { novos: o4.novos, pendentes: o4.pendentes }, o5: { novos: o5.novos, tipos: o5.tipos } }))

  // A7 · execução interrompida depois de reivindicar
  avancar(10)
  await registrarRodada(env, resumo('concluida', { elegiveis: 2, processadas: 2, recuperadas: 2 }), { fetch: fetchShim, porta })
  avancar(1)
  const alerta = avaliarRodadas(await porta.rodadasDesde(new Date(agora - 26 * 3_600_000).toISOString()), agoraIso(), configParaIntervalo(10)).find((a) => a.tipo === 'RECUPERACAO')!
  await porta.reivindicarAlerta(alerta) // o observador morreu aqui
  const morto = canalSimulado('apos-queda')
  avancar(1)
  const o6 = await observarCom(morto) // dentro da janela: cede
  avancar(JANELA_REIVINDICACAO_MIN + 5)
  const o7 = await observarCom(morto)
  avancar(10)
  const o8 = await observarCom(morto)
  prova('A7', 'execução interrompida: a reivindicação órfã segura só dentro da janela; depois o alerta sai uma vez e não repete',
    o6.cedidos >= 1 && morto.recebidos.filter((m) => m.tipo === 'RECUPERACAO').length === 1 && o8.novos === 0,
    JSON.stringify({ o6: o6.cedidos, o7: o7.tipos, o8: o8.novos }))

  // A8 · falha ao gravar a rodada
  await db.exec('revoke insert on audit_log from service_role')
  const r8 = await registrarRodada(env, resumo('concluida'), { fetch: fetchShim, porta }).catch(() => 'LANCOU')
  await db.exec('grant insert on audit_log to service_role')
  prova('A8', 'sem permissão de gravar, registrarRodada devolve «falhou» e não lança (a rodada não é afetada)', r8 === 'falhou', String(r8))

  // A9 · permissões mínimas: só SELECT + INSERT + sequência
  await db.exec(`revoke all on audit_log from service_role; revoke all on all sequences in schema public from service_role;
                 grant select, insert on audit_log to service_role; grant usage on all sequences in schema public to service_role;`)
  avancar(10)
  const r9 = await registrarRodada(env, resumo('erro_de_leitura', { motivo: 'CREDENCIAL_INVALIDA: NETLIFY_AUTH_TOKEN' }), { fetch: fetchShim, porta })
  avancar(1)
  const c9 = canalSimulado('minimo')
  const o9 = await observarCom(c9)
  let semUpdate = false
  await db.exec('set role service_role')
  try { await db.query(`update audit_log set reason = 'x' where entity_type = '${ENTIDADE}'`) } catch { semUpdate = true } finally { await db.exec('reset role') }
  prova('A9', 'com só SELECT + INSERT na audit_log e USAGE na sequência, o ciclo inteiro roda; UPDATE nem é concedido',
    r9 === 'gravada' && o9.desfecho === 'concluida' && o9.novos >= 1 && semUpdate, JSON.stringify({ r9, o9: { desfecho: o9.desfecho, novos: o9.novos, tipos: o9.tipos }, semUpdate }))

  // Nenhuma linha do monitor tem dado pessoal
  const todasDoMonitor = (await db.query(`select action, entity_id, after_data from audit_log where entity_type = '${ENTIDADE}'`)).rows
  prova('A-PII', 'nenhuma linha gravada pelo monitor contém dado pessoal ou segredo',
    todasDoMonitor.every((l) => problemasDeDadoPessoal(l).length === 0), `${todasDoMonitor.length} linhas`)

  // A10 · crescimento: 30 dias a cada 10 min (4.320 rodadas) e o efeito na tela de Auditoria
  const tamanho = async () => Number((await db.query(`select pg_total_relation_size('audit_log')::bigint b`)).rows[0]!['b' as never])
  const antes = await tamanho()
  const exemplo = JSON.stringify(registroDaRodada(resumo('concluida')))
  await db.exec(`insert into audit_log (organization_id, occurred_at, action, entity_type, entity_id, after_data, source)
                 select '${ORG}', timestamptz '2026-12-01' + (g * interval '10 minutes'), 'rodada', '${ENTIDADE}', g::text, '${exemplo}'::jsonb, 'formulario-monitor'
                 from generate_series(1, 4320) g`)
  // 300 registros reais do app no meio do período
  await db.exec(`insert into audit_log (organization_id, occurred_at, actor_id, action, entity_type, entity_id, source)
                 select '${ORG}', timestamptz '2026-12-01' + (g * interval '144 minutes'), '${ADMIN}', 'salvar_lancamento', 'lancamento', 'L-' || g, 'app'
                 from generate_series(1, 300) g`)
  const depois = await tamanho()
  const porDia = Math.round((depois - antes) / 30)
  const plano = (await db.query(`explain select after_data from audit_log where organization_id = '${ORG}' and entity_type = '${ENTIDADE}' and action = 'rodada' and occurred_at >= timestamptz '2026-12-29' order by occurred_at asc limit 2000`)).rows.map((l: any) => l['QUERY PLAN']).join(' | ')
  const telaDoApp = (await db.query(`select entity_type from audit_log order by occurred_at desc limit 500`)).rows as { entity_type: string }[]
  const doMonitorNaTela = telaDoApp.filter((l) => l.entity_type === ENTIDADE).length
  const telaFiltrada = (await db.query(`select entity_type from audit_log where entity_type <> '${ENTIDADE}' order by occurred_at desc limit 500`)).rows.length
  // Medição, não aprovação: o objetivo é registrar o tamanho, o plano e o efeito na tela.
  prova('A10', 'crescimento medido (4.320 rodadas em 30 dias) e CONFIRMADO o efeito colateral: a tela de Auditoria (últimas 500) fica tomada pelo monitor',
    depois > antes && doMonitorNaTela > 400,
    JSON.stringify({ bytesPor30dias: depois - antes, bytesPorDia: porDia, bytesPorAno: porDia * 365, plano: plano.slice(0, 160), linhasDoMonitorNasUltimas500: doMonitorNaTela, realVisivelSemFiltro: 500 - doMonitorNaTela, realVisivelComFiltro: telaFiltrada }))

  // A11 · a CORREÇÃO: a consulta oficial da tela (supabase-js de verdade → URL → banco), como Administrador logado
  const clienteApp = createClient('https://prova.supabase.local', 'chave-anon-de-prova', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: criarShim('authenticated', ADMIN) },
  })
  const { data: tela, error: erroTela } = await consultaAuditoria(clienteApp.from('audit_log').select('*'))
  const linhasTela = (tela ?? []) as { entity_type: string }[]
  const monitorNoBanco = Number((await db.query(`select count(*)::int n from audit_log where entity_type = '${ENTIDADE}'`)).rows[0]!['n' as never])
  const monitorAindaLe = (await porta.rodadasDesde('2026-12-29T00:00:00Z')).length
  prova('A11', 'correção: a consulta oficial da tela de Auditoria filtra o monitor NO BANCO, antes do limite — os 300 registros de negócio aparecem, e nenhuma linha do monitor some do banco',
    erroTela === null && linhasTela.length === 300 && linhasTela.every((l) => l.entity_type !== ENTIDADE) && monitorNoBanco > 4320 && monitorAindaLe > 0,
    JSON.stringify({ erro: erroTela?.message ?? null, linhasNaTela: linhasTela.length, doMonitorNaTela: linhasTela.filter((l) => l.entity_type === ENTIDADE).length, linhasDoMonitorNoBanco: monitorNoBanco, monitorLeSuasRodadas: monitorAindaLe }))

  prova('A-HTTP', 'todo acesso ao banco desta parte passou pela porta REST de produção', pedidosHttp > 20, `${pedidosHttp} pedidos`)
  await db.close()
}

/* ═══════════════════════════════════════════════ PARTE B ═══════════════════════════════════════════════ */

/** Preâmbulo e semente do smoke do formulário, LIDOS do arquivo (com as constantes dele resolvidas). */
function baseDoSmokeFormulario(): { preludio: string; semente: string; consts: Record<string, string> } {
  const fonte = fs.readFileSync(new URL('./pg-smoke-formulario.mts', import.meta.url), 'utf8')
  const consts: Record<string, string> = {}
  for (const m of fonte.matchAll(/^const ([A-Z_]+) = '([^']+)';/gm)) consts[m[1]!] = m[2]!
  const bloco = (nome: string) => {
    const m = new RegExp(`const ${nome} = \`([\\s\\S]*?)\`;`).exec(fonte)
    if (m === null) throw new Error(`não achei ${nome} em pg-smoke-formulario.mts`)
    return m[1]!.replace(/\$\{([A-Z_]+)\}/g, (_, k: string) => {
      if (consts[k] === undefined) throw new Error(`constante ${k} não resolvida`)
      return consts[k]!
    })
  }
  return { preludio: bloco('PRELUDIO'), semente: bloco('SEMENTE'), consts }
}

const MARCO = '2026-11-10T01:21:02Z'
const brutaNetlify = (id: string, criadoEm: string, nome: string) => ({
  id, form_name: 'simular-galpao', state: 'verified', created_at: criadoEm, site_url: 'https://eiff.com.br',
  data: {
    nome, email: `${id}@exemplo.invalido`, telefone: '62 90000-0000', empresa: 'Empresa (FICTÍCIO)', cidade: 'Goiânia, GO',
    uso: 'industrial', area: '900', observacao: 'Galpão fictício para a prova.', 'form-name': 'simular-galpao', 'empresa-site': '',
  },
})
const submissaoDe = (bruta: unknown): SubmissaoFormulario => {
  const t = corpoDaSubmissaoNetlify(bruta, { formulariosAceitos: ['simular-galpao', 'iniciar-projeto'] })
  if (!t.ok) throw new Error(`tradução falhou: ${t.motivo}`)
  const v = validarCorpo(t.corpo)
  if (!v.ok) throw new Error(`contrato recusou: ${v.motivo}`)
  return v.submissao
}

async function parteB() {
  const { preludio, semente, consts } = baseDoSmokeFormulario()
  const ORG_B = consts['ORG']!
  const FONTE = consts['FONTE']!
  const db = new PGlite()
  await db.exec(preludio)
  await db.exec(mig('0055_lead_engine_intake.sql'))
  await db.exec(mig('0056_inbox.sql'))
  await db.exec(mig('0057_inbox_octopus_router.sql'))
  await db.exec(semente)

  const uma = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as Record<string, any> | undefined
  const todas = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as Record<string, any>[]
  const conta = async (sql: string, p: unknown[] = []) => Number((await uma(sql, p))!['n'])
  const iso = (v: unknown) => (v === null || v === undefined ? undefined : new Date(v as string).toISOString())
  const prazoDaLinha = (t: Record<string, any>) => ({
    threadId: String(t['id']), aberta: !['RESOLVIDA', 'FECHADA'].includes(String(t['status'])),
    ...(iso(t['sla_first_response_due']) ? { venceEm: iso(t['sla_first_response_due'])! } : {}),
    ...(iso(t['sla_first_response_at']) ? { respondidaEm: iso(t['sla_first_response_at'])! } : {}),
    ...(iso(t['opened_at']) ? { abertaEm: iso(t['opened_at'])! } : {}),
  })

  let falharIngest = false
  /** Portas sobre este banco: as mesmas consultas da porta REST de produção, em SQL. */
  const portas: PortasGravacao = {
    async fonte(id) {
      const f = await uma('select id, code, source_type, active from radar_source where organization_id = $1 and id = $2', [ORG_B, id])
      return f === undefined ? undefined : { id: String(f['id']), codigo: String(f['code'] ?? ''), tipo: String(f['source_type'] ?? ''), ativa: f['active'] === true }
    },
    async prazoDaConversa(provider, ext) {
      const t = await uma(`select t.* from inbox_thread t join inbox_message m on m.thread_id = t.id where m.organization_id = $1 and m.provider = $2 and m.external_message_id = $3`, [ORG_B, provider, ext])
      return t === undefined ? undefined : prazoDaLinha(t)
    },
    async definirPrazo(threadId, vence) {
      const r = await uma('update inbox_thread set sla_first_response_due = $1::timestamptz where organization_id = $2 and id = $3 returning sla_first_response_due', [vence, ORG_B, threadId])
      return r === undefined ? undefined : iso(r['sla_first_response_due'])
    },
    async registrosDaSubmissao(fonteId, ext) {
      return (await todas('select * from radar_source_record where organization_id = $1 and source_id = $2 and external_id = $3', [ORG_B, fonteId, ext])).map(registroDoBanco)
    },
    async conversaExiste(provider, ext) {
      return (await conta('select count(*)::int n from inbox_message where organization_id = $1 and provider = $2 and external_message_id = $3', [ORG_B, provider, ext])) > 0
    },
    async gravarEvidencia(linha) {
      const cols = Object.keys(linha)
      try {
        const r = await uma(`insert into radar_source_record (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
          cols.map((c) => (linha[c] !== null && typeof linha[c] === 'object' ? JSON.stringify(linha[c]) : linha[c])))
        return r === undefined ? '' : String(r['id'])
      } catch (e) {
        // O PostgREST traduz a violação de unicidade (23505) em HTTP 409; a porta REST de produção lança com esse texto.
        if ((e as { code?: string }).code === '23505') throw new Error('postgrest POST radar_source_record http 409')
        throw e
      }
    },
    async ingerir(p) {
      if (falharIngest) throw new Error('rpc inbox_ingest http 503')
      const a = argsIngest(p)
      const r = await uma(`select inbox_ingest($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13::uuid,$14::uuid,$15::jsonb,$16::jsonb) as d`,
        [a['p_organization_id'], a['p_provider'], a['p_channel'], a['p_context'], a['p_identifier'], a['p_display_name'],
          a['p_external_message_id'], a['p_external_conversation_id'], a['p_body'], a['p_content_type'], a['p_occurred_at'],
          a['p_reply_to_external_id'], a['p_central_conversation_id'], a['p_central_message_id'], JSON.stringify(a['p_attachments']), JSON.stringify(a['p_meta'])])
      return resultadoIngest(r!['d'] as Record<string, unknown>)
    },
    async estadoEmLote(fonteId, provider, ids) {
      const evid = await todas('select external_id, payload_fingerprint from radar_source_record where organization_id = $1 and source_id = $2 and external_id = any($3::text[])', [ORG_B, fonteId, ids])
      const msgs = await todas('select external_message_id, thread_id from inbox_message where organization_id = $1 and provider = $2 and external_message_id = any($3::text[])', [ORG_B, provider, ids])
      const threads = msgs.length === 0 ? [] : await todas('select * from inbox_thread where organization_id = $1 and id = any($2::uuid[])', [ORG_B, msgs.map((m) => m['thread_id'])])
      const porThread = new Map(threads.map((t) => [String(t['id']), prazoDaLinha(t)]))
      return {
        evidencias: evid.map((e) => ({ externoId: String(e['external_id']), impressao: String(e['payload_fingerprint']) })),
        conversas: msgs.map((m) => String(m['external_message_id'])),
        prazos: msgs.flatMap((m) => { const p = porThread.get(String(m['thread_id'])); return p === undefined ? [] : [{ ...p, externoId: String(m['external_message_id']) }] }),
      }
    },
  }

  // Submissões fictícias
  const ENTREGUE = brutaNetlify('nf-b-entregue', '2026-11-20T12:00:00.000Z', 'Entregue (FICTÍCIO)')
  const PERDIDA = brutaNetlify('nf-b-perdida', '2026-11-20T12:05:00.000Z', 'Perdida (FICTÍCIO)')
  const HISTORICA = brutaNetlify('nf-b-historica', '2026-10-20T12:00:00.000Z', 'Histórica (FICTÍCIO)')
  const ENSAIO = brutaNetlify('nf-b-ensaio', '2026-11-20T11:00:00.000Z', 'ENSAIO (FICTÍCIO)')
  const NOVA = brutaNetlify('nf-b-nova', '2026-11-20T12:30:00.000Z', 'Nova perdida (FICTÍCIO)')
  let noNetlify: unknown[] = [ENTREGUE, PERDIDA, HISTORICA, ENSAIO]

  // O caminho principal entrega só a ENTREGUE (o evento da PERDIDA «falhou»)
  await gravarSubmissao(submissaoDe(ENTREGUE), FONTE, ORG_B, portas)

  const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)
  const fetchNetlify = (async (url: string) => {
    if (String(url).endsWith('/forms')) return ok([{ id: 'F1', name: 'simular-galpao' }])
    if (String(url).includes('/submissions')) return ok(String(url).includes('page=1') ? noNetlify : [])
    return ok([])
  }) as unknown as typeof fetch
  const env: AmbienteAgendado = {
    FORMULARIO_RECONCILIACAO: 'ativa', EIFF_FORM_MARCO: MARCO, EIFF_FORM_NETLIFY_SITE: 'site-ficticio',
    NETLIFY_AUTH_TOKEN: 'token-de-prova', EIFF_FORM_EXCLUIDOS: 'nf-b-ensaio',
  }
  let relogio = Date.parse('2026-11-20T13:00:00.000Z')
  const rodada = () => rodadaDeReconciliacao(env, {
    fetch: fetchNetlify, agora: () => Date.now(), agoraIso: () => new Date(relogio).toISOString(), log: () => {},
    portas: { portas, fonteId: FONTE, organizacaoId: ORG_B },
  })
  const estado = async (ext: string) => ({
    evidencias: await conta('select count(*)::int n from radar_source_record where external_id = $1', [ext]),
    mensagens: await conta('select count(*)::int n from inbox_message where external_message_id = $1', [ext]),
    conversas: await conta('select count(distinct thread_id)::int n from inbox_message where external_message_id = $1', [ext]),
  })
  const umaVez = (e: { evidencias: number; mensagens: number; conversas: number }) => e.evidencias === 1 && e.mensagens === 1 && e.conversas === 1

  const resumos: ResumoRodada[] = []
  const r1 = await rodada(); resumos.push(r1)
  const ePerdida = await estado('nf-b-perdida')
  prova('B1', 'a submissão perdida pelo evento é recuperada: 1 evidência, 1 mensagem, 1 conversa',
    r1.desfecho === 'concluida' && r1.recuperadas === 1 && umaVez(ePerdida), JSON.stringify({ r1: { lidas: r1.lidas, elegiveis: r1.elegiveis, jaDentro: r1.jaDentro, recuperadas: r1.recuperadas, retidas: r1.retidas, motivos: r1.motivosRetencao }, ePerdida }))

  prova('B2', 'a entregue pelo evento é «já dentro»; a anterior ao marco e o ensaio excluído ficam retidos e fora do banco',
    r1.jaDentro === 1 && r1.motivosRetencao['anterior_ao_marco'] === 1 && r1.motivosRetencao['id_excluido'] === 1
    && umaVez(await estado('nf-b-entregue')) && (await estado('nf-b-historica')).evidencias === 0 && (await estado('nf-b-ensaio')).evidencias === 0)

  const t = await uma(`select t.sla_first_response_due, t.opened_at from inbox_thread t join inbox_message m on m.thread_id = t.id where m.external_message_id = 'nf-b-perdida'`)
  const esperado = prazoDoLead(submissaoDe(PERDIDA))
  prova('B3', 'o prazo da conversa recuperada conta da submissão ORIGINAL, não do instante da recuperação',
    iso(t?.['sla_first_response_due']) === esperado && iso(t?.['opened_at']) === '2026-11-20T12:05:00.000Z',
    JSON.stringify({ prazo: iso(t?.['sla_first_response_due']), esperado, abertaEm: iso(t?.['opened_at']) }))

  relogio += 10 * 60_000
  const [r2, r3] = await Promise.all([rodada(), rodada()]); resumos.push(r2, r3)
  relogio += 10 * 60_000
  const r4 = await rodada(); resumos.push(r4)
  prova('B4', 'rodadas repetidas (duas ao mesmo tempo e mais uma): nada novo, continua exatamente uma vez',
    [r2, r3, r4].every((r) => r.recuperadas === 0 && r.falhas === 0) && umaVez(await estado('nf-b-perdida')) && umaVez(await estado('nf-b-entregue')),
    JSON.stringify([r2, r3, r4].map((r) => ({ jaDentro: r.jaDentro, processadas: r.processadas, recuperadas: r.recuperadas, falhas: r.falhas }))))

  // Uma submissão NOVA perdida, com duas rodadas disparadas juntas (agendador + «Run now»)
  noNetlify = [...noNetlify, NOVA]
  relogio += 10 * 60_000
  const [r5, r6] = await Promise.all([rodada(), rodada()]); resumos.push(r5, r6)
  const eNova = await estado('nf-b-nova')
  prova('B5', 'duas rodadas simultâneas sobre uma submissão nova perdida: exatamente uma evidência, uma mensagem e uma conversa',
    umaVez(eNova) && r5.recuperadas + r6.recuperadas >= 1,
    JSON.stringify({ eNova, r5: { recuperadas: r5.recuperadas, falhas: r5.falhas, resultados: r5.resultados }, r6: { recuperadas: r6.recuperadas, falhas: r6.falhas, resultados: r6.resultados } }))

  // O observador avalia o histórico a cada passada. Logo depois da 1ª rodada, ele vê a recuperação.
  const cfg10 = configParaIntervalo(10)
  const aposR1 = avaliarRodadas([registroDaRodada(r1)], new Date(Date.parse(r1.em) + 60_000).toISOString(), cfg10)
  prova('B6', 'o monitor lê o resumo real da rodada que recuperou: aviso de RECUPERACAO, sem dado pessoal; nenhuma empresa nem oportunidade criada',
    aposR1.some((a) => a.tipo === 'RECUPERACAO') && aposR1.every((a) => problemasDeDadoPessoal(a).length === 0)
    && (await conta('select count(*)::int n from radar_company')) === 0 && (await conta('select count(*)::int n from radar_source_record where entity_id is not null')) === 0,
    JSON.stringify(aposR1.map((a) => `${a.tipo}:${a.severidade}`)))

  // CORREÇÃO (E10.19): a rodada que perde a corrida classifica o conflito pelo banco. Com a vencedora completa, é
  // CONCORRENTE e não conta como falha — o falso aviso de falha de gravação medido na E10.17 não aparece mais.
  const aposCorrida = avaliarRodadas(
    [registroDaRodada(r5), { ...registroDaRodada(r6), em: new Date(Date.parse(r6.em) + 1).toISOString() }],
    new Date(relogio + 60_000).toISOString(), cfg10)
  relogio += 10 * 60_000
  const r7 = await rodada()
  prova('B7', 'correção: duas rodadas simultâneas — a perdedora é CONCORRENTE, nenhuma falha, nenhum alerta de falha de gravação; a seguinte vê tudo «já dentro»',
    umaVez(await estado('nf-b-nova')) && r5.falhas + r6.falhas === 0
    && (r5.resultados['CONCORRENTE'] ?? 0) + (r6.resultados['CONCORRENTE'] ?? 0) === 1
    && !aposCorrida.some((a) => a.tipo === 'FALHA_GRAVACAO') && aposCorrida.some((a) => a.tipo === 'RECUPERACAO')
    && r7.falhas === 0 && r7.recuperadas === 0,
    JSON.stringify({ r5: r5.resultados, r6: r6.resultados, aposCorrida: aposCorrida.map((a) => `${a.tipo}:${a.severidade}`), r7: { jaDentro: r7.jaDentro, falhas: r7.falhas } }))

  /* ── o classificador da falha, sobre o banco real (ligado à rodada na E10.19) ── */
  const itemDe = (bruta: unknown) => planoDaReconciliacao([bruta], { marco: MARCO, formulariosAceitos: ['simular-galpao'] }).enviar[0]!
  const estadoPelasPortas = async (externoId: string) => {
    const prazo = await portas.prazoDaConversa(PROVIDER_FORMULARIO, externoId)
    return {
      registros: await portas.registrosDaSubmissao(FONTE, externoId),
      conversaExiste: await portas.conversaExiste(PROVIDER_FORMULARIO, externoId),
      ...(prazo === undefined ? {} : { prazo }),
    }
  }

  // B8 · corrida real: duas gravações da mesma submissão ao mesmo tempo
  const CORRIDA = brutaNetlify('nf-b-corrida', '2026-11-20T12:40:00.000Z', 'Corrida (FICTÍCIO)')
  const [g1, g2] = await Promise.allSettled([gravarSubmissao(submissaoDe(CORRIDA), FONTE, ORG_B, portas), gravarSubmissao(submissaoDe(CORRIDA), FONTE, ORG_B, portas)])
  const perdeu = [g1, g2].find((g) => g.status === 'rejected') as PromiseRejectedResult | undefined
  const cB8 = perdeu === undefined ? undefined : classificarAposFalha(itemDe(CORRIDA), perdeu.reason, await estadoPelasPortas('nf-b-corrida'))
  prova('B8', 'corrida real: a gravação que perde recebe 409 na evidência, e a leitura do banco a classifica como CONCLUÍDA POR OUTRA RODADA (exatamente uma vez)',
    perdeu !== undefined && cB8?.desfecho === 'CONCLUIDA_POR_OUTRA_RODADA' && umaVez(await estado('nf-b-corrida')),
    JSON.stringify({ perdeu: perdeu === undefined ? null : String((perdeu.reason as Error).message), classificacao: cB8 }))

  // B9 e B10 · gravação parcial: evidência gravada, conversa falhou (erro real), e uma rodada com leitura atrasada colide
  const PARCIAL_B = brutaNetlify('nf-b-parcial', '2026-11-20T12:45:00.000Z', 'Parcial (FICTÍCIO)')
  falharIngest = true
  const gParcial = await gravarSubmissao(submissaoDe(PARCIAL_B), FONTE, ORG_B, portas).then(() => undefined, (e: unknown) => e)
  falharIngest = false
  const cB10 = classificarAposFalha(itemDe(PARCIAL_B), gParcial, await estadoPelasPortas('nf-b-parcial'))
  const leituraAtrasada: PortasGravacao = { ...portas, async registrosDaSubmissao() { return [] }, async conversaExiste() { return false } }
  const gAtrasada = await gravarSubmissao(submissaoDe(PARCIAL_B), FONTE, ORG_B, leituraAtrasada).then(() => undefined, (e: unknown) => e)
  const cB9 = classificarAposFalha(itemDe(PARCIAL_B), gAtrasada, await estadoPelasPortas('nf-b-parcial'))
  prova('B9', 'conflito com a conversa ainda ausente é PARCIAL (não é sucesso nem falha nova): a próxima gravação completa, e fica exatamente uma vez',
    cB9.desfecho === 'PARCIAL' && (await estado('nf-b-parcial')).mensagens === 0
    && (await gravarSubmissao(submissaoDe(PARCIAL_B), FONTE, ORG_B, portas)).resultado === 'COMPLETADO' && umaVez(await estado('nf-b-parcial')),
    JSON.stringify({ conflito: String((gAtrasada as Error | undefined)?.message), classificacao: cB9 }))
  prova('B10', 'a falha real da conversa (503) é ERRO DE PERSISTÊNCIA, mesmo com a evidência no banco: só o 409 da evidência abre a verificação',
    cB10.desfecho === 'ERRO_PERSISTENCIA', JSON.stringify({ erro: String((gParcial as Error | undefined)?.message), classificacao: cB10 }))

  await db.close()
}

async function main() {
  await parteA()
  await parteB()
  const falhas = provas.filter((p) => !p.ok)
  console.log(JSON.stringify({ provas, limites: LIMITES, total: provas.length, falhas: falhas.length }, null, 2))
  process.exit(falhas.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
