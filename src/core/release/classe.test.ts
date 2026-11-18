import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { caminhoCanonico, classeDoArquivo, classeDoConjunto, docsCitadosEm, importsRelativos, lerRawZ, testeComImportOpaco } from './classe'

const RAIZ = path.resolve(__dirname, '../../..')
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
  it('teste de tela VERMELHA (pela extensão .ts ou .tsx) ou que importa arquivo VERMELHO é VERMELHO', () => {
    for (const p of ['src/ui/Paleta.test.ts', 'src/screens/Usuarios.test.ts', 'src/screens/WidgetsIpad.test.ts', 'src/screens/usuariosSenha.test.ts']) vermelho(p)
    const c = classeDoConjunto([{ arquivo: 'src/ui/x.test.ts' }], { importsDosTestes: { 'src/ui/x.test.ts': ['src/ui/x.ts', 'src/core/permissoes.ts'] } })
    expect(c.classe).toBe('VERMELHO')
    expect(classeDoConjunto([{ arquivo: 'src/ui/x.test.ts' }], { importsDosTestes: { 'src/ui/x.test.ts': ['src/ui/x.ts'] } }).classe).toBe('AMARELO')
  })
  it('documento citado pelas instruções dos agentes é VERMELHO', () => {
    const citados = docsCitadosEm('Regras em `docs/commercial-director-1.0.md` §19.3 e docs/vibe.md.')
    expect(citados).toEqual(['docs/commercial-director-1.0.md', 'docs/vibe.md'])
    expect(classeDoConjunto([{ arquivo: 'docs/vibe.md' }], { docsCitados: citados }).classe).toBe('VERMELHO')
    expect(classeDoConjunto([{ arquivo: 'docs/outro.md' }], { docsCitados: citados }).classe).toBe('VERDE')
    // o CLAUDE.md real cita dezenas de docs: todos ficam VERMELHOS
    const real = docsCitadosEm(readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8'))
    expect(real).toContain('docs/lead-engine-1.0.md')
    expect(classeDoConjunto(real.map((arquivo) => ({ arquivo })), { docsCitados: real }).arquivos.every((a) => a.classe === 'VERMELHO')).toBe(true)
  })
  it('caminho fora do formato canônico, mudança de tipo e caminho desconhecido são VERMELHOS', () => {
    for (const p of ['src\\core\\x.ts', ' docs/a.md', 'docs/a.md\r', 'docs/../CLAUDE.md', 'docs//a.md', '/docs/a.md', 'algo-novo/x.ts']) vermelho(p)
    vermelho('src/screens/A.tsx', 'T')
    expect(caminhoCanonico('docs/radar.md')).toBe(true)
  })
  it('o conjunto vale a maior classe; colisão de caixa na árvore é VERMELHA', () => {
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'src/screens/A.tsx' }]).classe).toBe('AMARELO')
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'supabase/migrations/0078_x.sql' }]).classe).toBe('VERMELHO')
    const col = classeDoConjunto([{ arquivo: 'docs/Radar.md', status: 'A' }], { arvore: ['docs/radar.md', 'docs/Radar.md'] })
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

/* ---------- fecho de importação das funções Netlify, pelo MESMO bundler do netlify.toml (esbuild) ---------- */

describe('fecho de importação das funções Netlify', () => {
  it('todo arquivo empacotado em alguma função é VERMELHO; sem require nem import dinâmico não literal', async () => {
    const { build } = await import('esbuild')
    const dir = path.join(RAIZ, 'netlify', 'functions')
    const entradas = readdirSync(dir).filter((f) => /\.(m?ts)$/.test(f)).map((f) => path.join(dir, f))
    expect(entradas.length).toBeGreaterThan(5)
    const r = await build({ entryPoints: entradas, bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true, write: false, outdir: 'x', logLevel: 'silent' })
    const alcancados = Object.keys(r.metafile.inputs).map((f) => f.split(path.sep).join('/'))
    expect(alcancados.length).toBeGreaterThan(entradas.length)
    expect(alcancados.filter((f) => classeDoArquivo(f).classe !== 'VERMELHO'), 'arquivo que roda no servidor classificado como VERDE/AMARELO').toEqual([])
    // formas que fogem de qualquer fecho estático
    const suspeitos = alcancados.filter((f) => /\.(m?[jt]sx?)$/.test(f)).filter((f) => {
      const t = readFileSync(path.join(RAIZ, f), 'utf8')
      return /\brequire\s*\(|createRequire\s*\(|import\s*\(\s*[^'"\s)]/.test(t)
    })
    expect(suspeitos, 'require, createRequire ou import() não literal no código do servidor').toEqual([])
  }, 60_000)
})

describe('testes com import opaco e união base + candidato', () => {
  it('mock, import dinâmico não literal, require e especificador absoluto ou de alias tornam o teste VERMELHO', () => {
    for (const t of ["await vi.importActual('../core/permissoes')", "vi.mock('../x')", 'await import(`../core/${n}`)', "const x = require('../y')",
      "import { MATRIZ } from '/src/core/permissoes'", "import a from '@/core/x'"])
      expect(testeComImportOpaco(t), t).toBe(true)
    expect(testeComImportOpaco("import { describe } from 'vitest'\nimport { a } from './a'\nimport fs from 'node:fs'")).toBe(false)
    const c = classeDoConjunto([{ arquivo: 'src/screens/x.test.ts' }], { testesSuspeitos: ['src/screens/x.test.ts'] })
    expect(c.classe).toBe('VERMELHO')
  })
  it('importsRelativos lê os especificadores relativos', () => {
    expect(importsRelativos("import { a } from './a'\nimport '../b.js'\nconst c = await import('../../c')\nimport d from 'vitest'")).toEqual(['./a', '../b.js', '../../c'])
  })
})
