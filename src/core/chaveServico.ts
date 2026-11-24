// Chave de serviço do Supabase (SÓ SERVIDOR): uma regra única para as funções Netlify montarem os cabeçalhos das
// chamadas privilegiadas, valendo para a chave LEGADA (`service_role`, um JWT) e para a chave NOVA (`sb_secret_…`).
//
// Por que existe (S1/R1, 16/11/2026): a chave nova não é JWT. A documentação da Supabase manda enviá-la SÓ no cabeçalho
// `apikey`; no `Authorization: Bearer` ela é aceita apenas por compatibilidade, e só se for idêntica ao `apikey`.
// O código mandava as duas chaves nos dois cabeçalhos. Aqui:
//   - legada (JWT de papel service_role, ou valor que não é JWT nem `sb_`) → `apikey` + `Authorization: Bearer <chave>`, EXATAMENTE
//                       como antes: nada muda em produção hoje (a chave atual é JWT) nem nos testes (chaves fictícias);
//   - nova (sb_secret) → banco (PostgREST/RPC): só `apikey` (o caminho recomendado);
//                       Auth admin (/auth/v1/admin, convites): `apikey` + `Authorization` IDÊNTICO — o mesmo que o
//                       supabase-js 2.114 faz para o Auth (a regra de compatibilidade documentada);
//   - vazia, `sb_publishable_…`, `sb_temp_…` ou outro `sb_…` desconhecido → ERRO: falha fechada.
//     Uma chave publicável no lugar da de serviço nunca vira chamada «anônima» silenciosa.
//   - JWT legado cujo papel não é `service_role` (a chave `anon` legada colada no lugar errado) ou JWT ilegível → ERRO.
//     O papel é lido do payload SEM verificar a assinatura: isto não autentica nada (quem autentica é a Supabase), só
//     impede que uma chave de outro papel seja tratada como de serviço. Valor que não é JWT nem `sb_…` continua no
//     caminho antigo (é o formato das chaves fictícias dos testes; a Supabase recusa qualquer outro valor com 401).
//     Ressalva A da revisão do PR #95 (24/11/2026).
// O token do USUÁRIO (JWT da sessão) não passa por aqui: as chamadas feitas com o JWT de quem pediu continuam iguais.

export type TipoChaveServico = 'legada' | 'secreta'

/** Chave secreta nova da Supabase. */
const SECRETA = /^sb_secret_[A-Za-z0-9_-]{8,}$/

export class ErroChaveServico extends Error {
  constructor(public readonly motivo: 'ausente' | 'publicavel' | 'papel_nao_servico' | 'formato_desconhecido') {
    super(motivo === 'ausente' ? 'chave de serviço ausente'
      : motivo === 'publicavel' ? 'a chave configurada é PUBLICÁVEL, não de serviço'
        : motivo === 'papel_nao_servico' ? 'a chave legada configurada não tem o papel service_role'
          : 'chave de serviço em formato desconhecido')
    this.name = 'ErroChaveServico'
  }
}

/** JWT compacto: três partes base64url (a assinatura pode ser vazia). */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/

/** Papel declarado no payload de um JWT, sem verificar a assinatura. `null` = payload ilegível. */
function papelDoJwt(jwt: string): string | null | undefined {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as unknown
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
    const papel = (json as Record<string, unknown>).role
    return typeof papel === 'string' ? papel : undefined
  } catch { return null }
}

/** Classifica a chave SEM nunca devolvê-la nem registrá-la. Erro = falha fechada. */
export function tipoChaveServico(chave: string | undefined | null): TipoChaveServico {
  const c = (chave ?? '').trim()
  if (c === '') throw new ErroChaveServico('ausente')
  if (SECRETA.test(c)) return 'secreta'
  if (c.startsWith('sb_publishable_')) throw new ErroChaveServico('publicavel')
  if (c.startsWith('sb_')) throw new ErroChaveServico('formato_desconhecido')
  if (JWT.test(c)) {
    const papel = papelDoJwt(c)
    if (papel === null) throw new ErroChaveServico('formato_desconhecido')
    if (papel !== 'service_role') throw new ErroChaveServico('papel_nao_servico')
  }
  return 'legada'
}

/** A chave é utilizável como chave de serviço? (sem lançar) */
export function chaveServicoValida(chave: string | undefined | null): boolean {
  try { tipoChaveServico(chave); return true } catch { return false }
}

/** Cabeçalhos para o BANCO (PostgREST: tabelas e RPC) com a chave de serviço. */
export function cabecalhosServico(chave: string, extra: Record<string, string> = {}): Record<string, string> {
  const c = chave.trim()
  const tipo = tipoChaveServico(c)
  return tipo === 'legada' ? { apikey: c, authorization: `Bearer ${c}`, ...extra } : { apikey: c, ...extra }
}

/** Cabeçalhos para a API ADMIN do Auth (/auth/v1/admin/*, /auth/v1/invite, /auth/v1/recover) com a chave de serviço. */
export function cabecalhosAuthAdmin(chave: string, extra: Record<string, string> = {}): Record<string, string> {
  const c = chave.trim()
  tipoChaveServico(c)
  return { apikey: c, authorization: `Bearer ${c}`, ...extra }
}

/**
 * `fetch` para o supabase-js do servidor: o SDK põe a chave também no `Authorization` de toda chamada. Com a chave
 * NOVA, tira esse `Authorization` das chamadas ao banco (deixa só o `apikey`, o caminho recomendado) e mantém nas do
 * Auth, como o próprio SDK. Com a chave legada, não mexe em nada.
 */
export function fetchServico(chave: string, base: typeof fetch): typeof fetch {
  const c = chave.trim()
  if (tipoChaveServico(c) === 'legada') return base
  return (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (/\/auth\/v1\//.test(url)) return base(entrada, init)
    const h = new Headers(init?.headers ?? (typeof entrada === 'object' && 'headers' in entrada ? (entrada as Request).headers : undefined))
    if (h.get('authorization') === `Bearer ${c}`) h.delete('authorization')
    return base(entrada, { ...init, headers: h })
  }) as typeof fetch
}
