// Executada pelo Netlify ANTES do build nos contextos nao produtivos (netlify.toml, D3 de docs/seguranca/credenciais-previews.md).
// Sai com 1 se houver credencial privilegiada com valor fora de production: o build falha e o preview nao e publicado.
// So imprime NOMES. Sem dependencias (roda antes do npm run build). A lista e a regra espelham src/core/guardaCredenciais.ts
// (o teste guardaCredenciais.test.ts confere que as duas listas sao iguais).
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
]
const contexto = (process.env.CONTEXT ?? '').trim() || 'desconhecido'
if (contexto === 'production') {
  console.log('guarda de credenciais: contexto production, sem restricao')
} else {
  const presentes = CREDENCIAIS_PRIVILEGIADAS.filter((k) => (process.env[k] ?? '').trim() !== '')
  if (presentes.length) {
    console.log(`guarda de credenciais: BUILD RECUSADO no contexto ${contexto}: credencial privilegiada com valor fora de production (${presentes.join(', ')}). Restrinja a variavel ao contexto production no painel do Netlify. Nenhum valor foi lido nem impresso.`)
    process.exit(1)
  }
  console.log(`guarda de credenciais: contexto ${contexto}: nenhuma credencial privilegiada visivel`)
}
