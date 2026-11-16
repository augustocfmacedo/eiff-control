/**
 * D1 do GO-3 — teste de ALCANCE de um token do Netlify, antes de instalá-lo. SÓ LEITURA.
 *
 *   NETLIFY_TOKEN_EM_TESTE=<token> npx vite-node scripts/netlify-alcance-token.mts -- --site <site_id do eiff-site>
 *
 * Responde, para o token da conta técnica candidata (Reviewer, Internal Builder ou Developer, restrita ao projeto):
 *
 *   1. quem é o usuário do token (só o id e se o e-mail é o da conta técnica esperada, nunca o e-mail inteiro)
 *   2. quantos projetos (sites) o token enxerga — o esperado é UM, o eiff-site
 *   3. se lista os formulários do eiff-site
 *   4. se lê submissões pela API (só a CONTAGEM de uma página de 1; nenhum conteúdo de submissão é impresso)
 *   5. o papel do usuário no time, se a API devolver para esse token (membros só aparecem para quem pode vê-los)
 *
 * NÃO faz nenhuma escrita, nem «teste de escrita». O que o papel pode alterar (configuração, variáveis, publicar) é
 * conferido na tela de membros pelo Owner, contra a tabela de papéis do Netlify — nunca tentando escrever.
 *
 * O token vem SÓ do ambiente desta sessão (`NETLIFY_TOKEN_EM_TESTE`), nunca de argumento, arquivo ou repositório, e
 * nunca é impresso. Use um terminal próprio e apague a variável depois.
 */
import { validarCredencial, descricaoSegura } from '../src/core/erroSeguro'

const API = 'https://api.netlify.com/api/v1'
const args = process.argv.slice(2).filter((a) => a !== '--')
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? '' : '' }
const site = arg('site')
const contaTecnica = arg('conta-tecnica').toLowerCase()
if (site === '') { console.error('informe --site <site_id do eiff-site>'); process.exit(2) }

const cred = validarCredencial(process.env['NETLIFY_TOKEN_EM_TESTE'])
if (!cred.ok) { console.error(`BLOQUEADO: ${cred.codigo}: NETLIFY_TOKEN_EM_TESTE`); process.exit(2) }
const cab = { authorization: `Bearer ${cred.valor}`, 'user-agent': 'eiff-control-alcance-token' }

async function ler(caminho: string): Promise<{ status: number; corpo: unknown }> {
  try {
    const r = await fetch(`${API}${caminho}`, { headers: cab })
    return { status: r.status, corpo: r.ok ? await r.json().catch(() => null) : null }
  } catch (e) {
    return { status: 0, corpo: descricaoSegura(e) }
  }
}

const resultado: Record<string, unknown> = {}
const usuario = await ler('/user')
const u = usuario.corpo as Record<string, unknown> | null
resultado['1_usuario'] = usuario.status === 200
  ? { id: String(u?.['id'] ?? ''), ehAContaTecnica: contaTecnica === '' ? 'informe --conta-tecnica para conferir' : String(u?.['email'] ?? '').toLowerCase() === contaTecnica }
  : { http: usuario.status }

const sites = await ler('/sites?per_page=100')
const lista = Array.isArray(sites.corpo) ? (sites.corpo as Record<string, unknown>[]) : []
resultado['2_projetos_visiveis'] = { http: sites.status, quantos: lista.length, soOEiffSite: lista.length === 1 && String(lista[0]?.['id']) === site, incluiOEiffSite: lista.some((s) => String(s['id']) === site) }

const forms = await ler(`/sites/${encodeURIComponent(site)}/forms`)
const fl = Array.isArray(forms.corpo) ? (forms.corpo as Record<string, unknown>[]) : []
resultado['3_formularios'] = { http: forms.status, nomes: fl.map((f) => String(f['name'] ?? '')) }

const alvo = fl.find((f) => String(f['name']) === 'simular-galpao') ?? fl[0]
if (alvo !== undefined) {
  const subs = await ler(`/forms/${encodeURIComponent(String(alvo['id']))}/submissions?per_page=1`)
  resultado['4_le_submissoes'] = { http: subs.status, formulario: String(alvo['name'] ?? ''), linhasNaPagina: Array.isArray(subs.corpo) ? (subs.corpo as unknown[]).length : 0 }
} else {
  resultado['4_le_submissoes'] = { http: null, motivo: 'nenhum formulário visível' }
}

const contaId = String(lista.find((s) => String(s['id']) === site)?.['account_id'] ?? '')
if (contaId !== '' && u !== null) {
  const membros = await ler(`/${encodeURIComponent(contaId)}/members`)
  const eu = Array.isArray(membros.corpo) ? (membros.corpo as Record<string, unknown>[]).find((m) => String(m['id']) === String(u['id'])) : undefined
  resultado['5_papel_no_time'] = membros.status === 200 ? { papel: String(eu?.['role'] ?? 'não listado') } : { http: membros.status, nota: 'a API não mostra membros para este token; conferir na tela do Owner' }
}

const veredito = resultado['4_le_submissoes'] as { http: number | null } | undefined
console.log(JSON.stringify({
  resultado,
  veredito: {
    leSubmissoes: veredito?.http === 200,
    restritoAoEiffSite: (resultado['2_projetos_visiveis'] as { soOEiffSite: boolean }).soOEiffSite,
    lembrete: 'o que o papel pode ALTERAR é conferido na tela de membros (Owner), não por tentativa de escrita',
  },
}, null, 2))
