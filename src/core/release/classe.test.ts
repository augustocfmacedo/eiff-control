import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { caminhoCanonico, classeDoArquivo, classeDoConjunto, lerRawZ } from './classe'

const vermelho = (p: string, s?: 'A' | 'M' | 'D' | 'T') => expect(classeDoArquivo(p, s).classe, p).toBe('VERMELHO')
const amarelo = (p: string, s?: 'A' | 'M' | 'D') => expect(classeDoArquivo(p, s).classe, p).toBe('AMARELO')

describe('classe mínima de release (negação por padrão)', () => {
  it('banco, servidor, CI, build, dependências, scripts e configuração são VERMELHOS', () => {
    for (const p of ['supabase/migrations/0077_s3.sql', 'netlify/functions/vibe.ts', 'netlify.toml', '.github/workflows/quality-gate.yml',
      'package.json', 'package-lock.json', 'public/sw.js', 'public/_headers', 'vite.config.ts', 'index.html', 'tsconfig.json', 'eslint.config.js',
      '.gitattributes', '.mcp.json', '.claude/settings.json', 'src/main.tsx', 'src/App.tsx', 'scripts/fin-reset/executar.sql', 'scripts/release-classe.mts',
      'scripts/pg-smoke-views.mjs', 'scripts/gerar-build-sha.mjs'])
      vermelho(p)
  })
  it('src/data e src/core são VERMELHOS (salvo a regra pura da Central Comercial)', () => {
    for (const p of ['src/data/store.ts', 'src/data/clienteServidor.ts', 'src/data/__fixtures__/x.ts', 'src/core/engine.ts', 'src/core/permissoes.ts',
      'src/core/central/permissoes.ts', 'src/core/inbox/servidor.ts', 'src/core/radar/vibeservidor.ts', 'src/core/central/githubAdapter.ts',
      'src/core/inbox/emailMensagem.ts', 'src/core/cfo.ts', 'src/core/widgetCaixa.ts', 'src/core/usuarios.ts', 'src/core/release/classe.ts', 'src/core/x.d.ts'])
      vermelho(p)
    amarelo('src/core/comercial/central.ts')
  })
  it('instruções de agente e documentos operacionais são VERMELHOS em qualquer caixa', () => {
    for (const p of ['CLAUDE.md', 'claude.md', 'Claude.MD', 'CLAUDE.local.md', 'AGENTS.md', 'docs/CLAUDE.md', 'docs/politica-releases.md',
      'docs/Politica-Releases.md', 'docs/formulario-site-go2-go3.md', 'docs/fin-reset-01.md', 'docs/eiff-inbox.md', 'docs/seguranca/s3.md', 'docs/Seguranca/s3.md'])
      vermelho(p)
  })
  it('teste herda a classe do arquivo que testa; apagar teste ou fixture é VERMELHO', () => {
    vermelho('src/core/inbox/ativacao.test.ts')
    vermelho('src/core/engine.test.ts')
    vermelho('src/data/fotos.store.test.ts')
    vermelho('src/core/release/classe.test.ts')
    amarelo('src/core/comercial/central.test.ts')
    vermelho('src/core/comercial/central.test.ts', 'D')
    amarelo('src/core/comercial/__fixtures__/x.json')
    vermelho('src/core/comercial/__fixtures__/x.json', 'D')
    vermelho('src/core/radar/__fixtures__/cd-1.2-snapshot.json')
  })
  it('VERDE só para documentação de leitura; AMARELO para telas e componentes', () => {
    for (const p of ['docs/radar.md', 'README.md', 'docs/propostas/comercial-acesso.md']) expect(classeDoArquivo(p).classe, p).toBe('VERDE')
    for (const p of ['src/screens/comercial/CentralGestao.tsx', 'src/screens/comercial/central.css', 'src/ui/Tabela.tsx', 'src/styles.css', 'docs/propostas/pedido-projeto.proposta.sql']) amarelo(p)
    for (const p of ['src/ui/Paleta.tsx', 'src/screens/Usuarios.tsx', 'src/screens/WidgetsIpad.tsx', 'docs/sub/pasta/x.md']) vermelho(p)
  })
  it('caminho fora do formato canônico, mudança de tipo e caminho desconhecido são VERMELHOS', () => {
    for (const p of ['src\\core\\x.ts', ' docs/a.md', 'docs/a.md\r', 'docs/../CLAUDE.md', 'docs//a.md', '/docs/a.md', 'algo-novo/x.ts']) vermelho(p)
    vermelho('src/screens/A.tsx', 'T')
    expect(caminhoCanonico('docs/radar.md')).toBe(true)
  })
  it('o conjunto vale a maior classe; colisão de caixa na árvore é VERMELHA', () => {
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'src/screens/A.tsx' }]).classe).toBe('AMARELO')
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'supabase/migrations/0078_x.sql' }]).classe).toBe('VERMELHO')
    const col = classeDoConjunto([{ arquivo: 'docs/Radar.md', status: 'A' }], ['docs/radar.md', 'docs/Radar.md'])
    expect(col.classe).toBe('VERMELHO')
    expect(col.colisoes).toEqual(['docs/Radar.md'])
  })
  it('lê --raw -z com acento; falha fechada com formato inesperado; link e submódulo viram T', () => {
    const z = ':100644 100644 aaaa bbbb M\0supabase/migrations/0080_permissão.sql\0:100644 000000 aaaa 0000 D\0docs/a.md\0:000000 120000 0000 cccc A\0src/screens/x.tsx\0'
    const m = lerRawZ(z)
    expect(m).toEqual([{ arquivo: 'supabase/migrations/0080_permissão.sql', status: 'M' }, { arquivo: 'docs/a.md', status: 'D' }, { arquivo: 'src/screens/x.tsx', status: 'T' }])
    expect(() => lerRawZ(':100644 100644 aaaa bbbb R100\0a\0b\0')).toThrow()
    expect(() => lerRawZ('lixo\0x\0')).toThrow()
  })
})

/* ---------- fecho de importação das funções Netlify: nada que roda no servidor pode ser VERDE ou AMARELO ---------- */

const RAIZ = path.resolve(__dirname, '../../..')
const EXT = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts']
function resolver(de: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined
  const base = path.resolve(path.dirname(de), spec)
  for (const e of EXT) { const f = base + e; if (existsSync(f) && !f.endsWith(path.sep) && /\.[cm]?[jt]sx?$/.test(f)) return f }
  return undefined
}
function fecho(entradas: string[]): Set<string> {
  const vistos = new Set<string>(); const fila = [...entradas]
  while (fila.length) {
    const f = fila.pop()!
    if (vistos.has(f)) continue
    vistos.add(f)
    const texto = readFileSync(f, 'utf8')
    for (const m of texto.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const alvo = resolver(f, m[1] ?? m[2]); if (alvo) fila.push(alvo)
    }
  }
  return vistos
}

describe('fecho de importação das funções Netlify', () => {
  it('todo arquivo alcançado por netlify/functions é VERMELHO', () => {
    const dir = path.join(RAIZ, 'netlify', 'functions')
    const entradas = readdirSync(dir).filter((f) => /\.(m?ts)$/.test(f)).map((f) => path.join(dir, f))
    expect(entradas.length).toBeGreaterThan(5)
    const alcancados = [...fecho(entradas)].map((f) => path.relative(RAIZ, f).split(path.sep).join('/'))
    expect(alcancados.length).toBeGreaterThan(entradas.length)
    const permitidos = alcancados.filter((f) => classeDoArquivo(f).classe !== 'VERMELHO')
    expect(permitidos, 'arquivo que roda no servidor classificado como VERDE/AMARELO').toEqual([])
  })
})
