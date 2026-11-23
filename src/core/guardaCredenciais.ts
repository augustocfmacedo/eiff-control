// Guarda de credenciais por contexto do Netlify (D3 do plano de credenciais dos previews, docs/seguranca/credenciais-previews.md).
// Regra: credencial privilegiada só existe em production. Um build de deploy-preview, branch-deploy ou dev que enxergue
// qualquer uma delas com valor é RECUSADO antes de construir, e o preview não é publicado.
// Função pura: recebe o ambiente e devolve o veredito; nunca devolve, registra ou compara valores, só NOMES.
// Limite conhecido: o build só enxerga variáveis com escopo "builds". As de escopo só "functions" (Google OAuth,
// GitHub, segredos do formulário) não aparecem aqui; para elas vale a sonda pós-deploy descrita no plano.

export const CREDENCIAIS_PRIVILEGIADAS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'VIBE_API_KEY',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN',
  'GITHUB_READ_TOKEN',
  'EIFF_FORM_SECRET',
  'EIFF_FORM_SECRET_B',
  'NETLIFY_AUTH_TOKEN',
  'META_WHATSAPP_ACCESS_TOKEN',
  'META_WHATSAPP_APP_SECRET',
  'OCTADESK_API_KEY',
] as const

export type VeredictoGuarda =
  | { ok: true; contexto: string; motivo: 'production' | 'sem_credenciais' }
  | { ok: false; contexto: string; presentes: string[] }

export function avaliarCredenciaisDoContexto(env: Record<string, string | undefined>): VeredictoGuarda {
  const contexto = (env.CONTEXT ?? '').trim() || 'desconhecido'
  if (contexto === 'production') return { ok: true, contexto, motivo: 'production' }
  const presentes = CREDENCIAIS_PRIVILEGIADAS.filter((k) => (env[k] ?? '').trim() !== '')
  return presentes.length ? { ok: false, contexto, presentes: [...presentes] } : { ok: true, contexto, motivo: 'sem_credenciais' }
}

export function mensagemGuarda(v: VeredictoGuarda): string {
  if (v.ok) return `guarda de credenciais: contexto ${v.contexto}: ${v.motivo === 'production' ? 'production, sem restrição' : 'nenhuma credencial privilegiada visível'}`
  return `guarda de credenciais: BUILD RECUSADO no contexto ${v.contexto}: credencial privilegiada com valor fora de production (${v.presentes.join(', ')}). ` +
    'Restrinja a variável ao contexto production no painel do Netlify. Nenhum valor foi lido nem impresso.'
}
