// Regressão da conferência pós-aplicação da migration 0075 (falso positivo de 13/11/2026: o script comparava só
// objetos que já existiam, e o trigger e a função NOVOS apareciam como «mudança esperada que não ocorreu»).
// Retratos fictícios com a mesma forma do `scripts/email-0075/retrato.sql`; nenhum dado de produção.
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs (sem tipos)
import { ESPERADO_0075, classificar, conferir } from '../../../scripts/email-0075/conferir.mjs'

const CHECK_ANTIGO = "CHECK ((provider = ANY (ARRAY['MANUAL'::text, 'OCTADESK'::text, 'META_CLOUD'::text])))"
const CHECK_NOVO = "CHECK ((provider = ANY (ARRAY['MANUAL'::text, 'OCTADESK'::text, 'META_CLOUD'::text, 'GOOGLE_WORKSPACE'::text])))"
const TRIGGER = 'CREATE TRIGGER inbox_message_email_governada BEFORE INSERT OR UPDATE ON public.inbox_message FOR EACH ROW EXECUTE FUNCTION inbox_email_mensagem_governada()'

type Retrato = Record<string, unknown> & { constraints: Record<string, string>; triggers: Record<string, string>; funcoes_de_trigger: Record<string, string>; politicas: Record<string, string>; dados: Record<string, unknown>; ja_existe_0075: Record<string, unknown> }
function antes(): Retrato {
  return {
    colunas: { 'inbox_message.provider': 'text|NO|' },
    constraints: { 'inbox_message.inbox_message_provider_check': CHECK_ANTIGO, 'inbox_message.inbox_message_body_check': 'CHECK ((length(body) <= 20000))' },
    triggers: { 'inbox_message.inbox_message_touch': 'CREATE TRIGGER inbox_message_touch …' },
    indices: { inbox_message_pkey: 'CREATE UNIQUE INDEX …' },
    politicas: { 'inbox_message.inbox_message_select': 'SELECT | authenticated | …' },
    rls: { inbox_message: true },
    funcoes: { 'inbox_ingest(…)': 'aaaa' },
    funcoes_de_trigger: { touch_updated_at: 'bbbb' },
    dados: { inbox_thread: 2, inbox_message: 5, inbox_contact: 2, inbox_contact_identity: 2, inbox_thread_event: 18, profile: 3, organization: 1, impressao_mensagens: 'm1', impressao_conversas: 'c1', inbox_message_por_provider: { MANUAL: 3, META_CLOUD: 2 }, inbox_message_por_entrega: { null: 3, entregue: 1, registrada: 1 } },
    ja_existe_0075: { inbox_email_delivery: false, inbox_email_delivery_event: false, funcoes: 0 },
  }
}
function depois(): Retrato {
  const r = structuredClone(antes())
  r.constraints['inbox_message.inbox_message_provider_check'] = CHECK_NOVO
  r.triggers['inbox_message.inbox_message_email_governada'] = TRIGGER
  r.funcoes_de_trigger['inbox_email_mensagem_governada'] = 'cccc'
  r.ja_existe_0075 = { inbox_email_delivery: true, inbox_email_delivery_event: true, funcoes: 8 }
  return r
}

describe('conferência pós-aplicação da 0075', () => {
  it('REGRESSÃO de 13/11: uma alteração e dois objetos novos é exatamente o previsto, não divergência', () => {
    const r = conferir(antes(), depois())
    expect(r.problemas).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.alterados).toEqual(ESPERADO_0075.alterados)
    expect(r.novos).toEqual([...ESPERADO_0075.novos].sort())
    expect(r.removidos).toEqual([])
  })
  it('a lógica antiga (só objetos que já existiam) dá a contagem que causou o falso positivo; a nova separa os novos', () => {
    const c = classificar(antes(), depois())
    // o script antigo via só isto e esperava três itens aqui
    expect(c.alterados).toHaveLength(1)
    expect(c.novos).toHaveLength(2)
  })
  it('alteração em outro objeto existente é divergência', () => {
    const d = depois(); d.constraints['inbox_message.inbox_message_body_check'] = 'CHECK ((length(body) <= 5))'
    expect(conferir(antes(), d)).toMatchObject({ ok: false, problemas: ['alteração inesperada: constraints:inbox_message.inbox_message_body_check'] })
  })
  it('política RLS alterada é divergência', () => {
    const d = depois(); d.politicas['inbox_message.inbox_message_select'] = 'SELECT | public | true'
    expect(conferir(antes(), d).problemas).toContain('alteração inesperada: politicas:inbox_message.inbox_message_select')
  })
  it('objeto removido é divergência', () => {
    const d = depois(); delete d.triggers['inbox_message.inbox_message_touch']
    expect(conferir(antes(), d).problemas).toEqual(['objeto removido: triggers:inbox_message.inbox_message_touch'])
  })
  it('objeto novo esperado ausente é divergência (o trigger de proteção não pode faltar)', () => {
    const d = depois(); delete d.triggers['inbox_message.inbox_message_email_governada']
    expect(conferir(antes(), d).problemas).toEqual(['objeto novo esperado ausente: triggers:inbox_message.inbox_message_email_governada'])
  })
  it('objeto novo não previsto é divergência', () => {
    const d = depois(); d.triggers['inbox_message.outro'] = 'CREATE TRIGGER outro …'
    expect(conferir(antes(), d).problemas).toEqual(['objeto novo inesperado: triggers:inbox_message.outro'])
  })
  it('a constraint de provider sem mudar é divergência', () => {
    const d = depois(); d.constraints['inbox_message.inbox_message_provider_check'] = CHECK_ANTIGO
    expect(conferir(antes(), d).problemas).toEqual(['alteração esperada não ocorreu: constraints:inbox_message.inbox_message_provider_check'])
  })
  it('qualquer mudança nos dados preexistentes é divergência', () => {
    const d = depois(); d.dados.impressao_mensagens = 'm2'; d.dados.inbox_message = 6
    const r = conferir(antes(), d)
    expect(r.ok).toBe(false)
    expect(r.problemas).toEqual(['dado preexistente mudou: inbox_message', 'dado preexistente mudou: impressao_mensagens'])
  })
  it('livro ausente ou número de funções diferente é divergência', () => {
    const d = depois(); d.ja_existe_0075 = { inbox_email_delivery: true, inbox_email_delivery_event: false, funcoes: 7 }
    expect(conferir(antes(), d).problemas).toEqual(['livro de entregas ausente', 'funções inbox_email_*: 7 (esperado 8)'])
  })
  it('banco sem mudança nenhuma (migration não aplicada) não confere', () => {
    expect(conferir(antes(), antes()).ok).toBe(false)
  })
})
