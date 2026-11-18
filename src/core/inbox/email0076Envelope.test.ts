// Envelope de aplicação da 0076, ensaios, conferência estrutural e recuperação — provados em PostgreSQL descartável
// (PGlite) partindo do estado de produção depois da 0075 (livro com uma entrega ACCEPTED, como hoje). Nada toca banco real.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { ADM_A, FP, ORG_A, SEMENTE, bancoDoEmail, uuid } from '../../../scripts/lib/emailBanco.mjs'
// @ts-expect-error — script .mjs (sem tipos)
import { envelope, ensaios } from '../../../scripts/email-0076/envelope.mjs'
// @ts-expect-error — script .mjs (sem tipos)
import { conferir } from '../../../scripts/email-0076/conferir.mjs'

type Row = Record<string, unknown>
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<Array<{ rows: Row[] }>> }
const RETRATO = fs.readFileSync(new URL('../../../scripts/email-0076/retrato.sql', import.meta.url), 'utf8')
const retrato = async (db: Banco) => (await db.query(RETRATO)).rows[0]['retrato'] as Row
const j = (r: { rows: Row[] }) => r.rows[0]['j'] as Row

/** Banco no estado de produção de hoje: 0075 aplicada, uma conversa e uma entrega ACCEPTED. */
async function producaoDeHoje(opcoes: { pendente?: boolean } = {}): Promise<Banco> {
  const db = (await bancoDoEmail()) as Banco
  await db.exec(SEMENTE)
  const t = j(await db.query(`select inbox_ingest($1, 'MANUAL', 'PORTAL', 'EXTERNAL', 'lead@exemplo.invalido', 'Lead', 'site.1', null, 'Olá', 'texto', now() - interval '1 hour') j`, [ORG_A]))
  const th = (await db.query('select id, contact_id from inbox_thread where id = $1', [t['thread_id']])).rows[0]
  const c = j(await db.query('select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, 30, 100) j', [ORG_A, th['id'], th['contact_id'], ADM_A, 'Augusto', uuid(1), FP, 'Assunto: x\n\ny']))
  const id = (c['entrega'] as Row)['id']
  if (!opcoes.pendente) {
    await db.query("select inbox_email_delivery_transition($1, 'REQUESTED', $2, null, null, null)", [id, ADM_A])
    await db.query("select inbox_email_delivery_accept($1, $2, now(), 'gm-1', 'gt-1', false)", [id, ADM_A])
  }
  return db
}
const ultimo = (r: Array<{ rows: Row[] }>) => r.at(-1)?.rows[0] ?? {}

describe('envelope da 0076', () => {
  it('o SQL é a migration sem alteração entre os pré e pós-checks, e o hash é estável', () => {
    const a = envelope(); const b = envelope()
    expect(a.shaEnvelope).toBe(b.shaEnvelope)
    expect(a.sql).toContain(fs.readFileSync(new URL('../../../supabase/migrations/0076_inbox_email_switch.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n'))
    expect(a.sql.indexOf('PRE-CHECK')).toBeLessThan(a.sql.indexOf('create table if not exists inbox_email_switch'))
    expect(a.sql.lastIndexOf('POS-CHECK')).toBeGreaterThan(a.sql.indexOf('create table if not exists inbox_email_switch'))
    const e = ensaios()
    expect(e.conclui).not.toMatch(/create table/i)
    expect(e.recusa).not.toMatch(/create table/i)
  })

  it('ensaios no estado de hoje: aprovam os pré-checks e não deixam nada', async () => {
    const db = await producaoDeHoje()
    const r = ultimo(await db.exec(ensaios().conclui))
    expect(r).toMatchObject({ chave_ausente: true })
    expect(Number(r['funcoes_inbox_email'])).toBe(8)
    await expect(db.exec(ensaios().recusa)).rejects.toThrow(/ENSAIO 0076/)
    await db.exec('rollback').catch(() => undefined)
    expect((await db.query("select to_regclass('public.inbox_email_switch') is null as ausente")).rows[0]['ausente']).toBe(true)
  }, 60_000)

  it('aplicação: APLICADA, a conferência estrutural CONFERE, o livro e as conversas ficam idênticos, e não reaplica', async () => {
    const db = await producaoDeHoje()
    const antes = await retrato(db)
    const r = ultimo(await db.exec(envelope().sql))
    expect(r).toMatchObject({ migration_0076: 'APLICADA' })
    expect(Number(r['funcoes'])).toBe(15)
    expect(Number(r['ligadas'])).toBe(0)
    expect(Number(r['chaves'])).toBe(2) // as duas organizações da semente
    const depois = await retrato(db)
    const c = conferir(antes, depois)
    expect(c.problemas).toEqual([])
    expect(c.ok).toBe(true)
    await expect(db.exec(envelope().sql)).rejects.toThrow(/ja parece aplicada/)
  }, 60_000)

  it('pré-check recusa aplicar com envio em curso (entrega READY)', async () => {
    const db = await producaoDeHoje({ pendente: true })
    await expect(db.exec(envelope().sql)).rejects.toThrow(/READY ou REQUESTED/)
    await db.exec('rollback').catch(() => undefined)
    expect((await db.query("select to_regclass('public.inbox_email_switch') is null as ausente")).rows[0]['ausente']).toBe(true)
  }, 60_000)

  it('recuperação: create/transition voltam à 0075; chave, histórico e entregas bloqueadas preservados', async () => {
    const db = await producaoDeHoje()
    await db.exec(envelope().sql)
    // com a chave desligada, uma entrega bloqueada nasce: criar é recusado
    const t = j(await db.query(`select inbox_ingest($1, 'MANUAL', 'PORTAL', 'EXTERNAL', 'b@exemplo.invalido', 'Lead B', 'site.2', null, 'Olá', 'texto', now()) j`, [ORG_A]))
    const th = (await db.query('select id, contact_id from inbox_thread where id = $1', [t['thread_id']])).rows[0]
    const bloq = j(await db.query('select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, 30, 100) j', [ORG_A, th['id'], th['contact_id'], ADM_A, 'Augusto', uuid(2), FP, 'Assunto: x\n\ny']))
    expect(bloq).toMatchObject({ ok: false, erro: 'envio_bloqueado' })
    const eventosAntes = Number((await db.query('select count(*) n from inbox_email_switch_event')).rows[0]['n'])
    const r = ultimo(await db.exec(envelope().recuperacao))
    expect(String(r['recuperacao_0076'])).toMatch(/RECUPERADA/)
    const livre = j(await db.query('select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, 30, 100) j', [ORG_A, th['id'], th['contact_id'], ADM_A, 'Augusto', uuid(3), FP, 'Assunto: x\n\ny']))
    expect(livre).toMatchObject({ ok: true, nova: true }) // sem a chave: volta a depender só das variáveis
    expect(Number((await db.query('select count(*) n from inbox_email_switch_event')).rows[0]['n'])).toBe(eventosAntes)
    expect((await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'inbox_email_delivery_reason_check'")).rows[0]['d']).toMatch(/envio_bloqueado/)
  }, 60_000)
})
