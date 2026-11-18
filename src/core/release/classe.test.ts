import { describe, expect, it } from 'vitest'
import { classeDoArquivo, classeDoConjunto, lerNameStatusZ } from './classe'

const vermelho = (p: string, s?: 'A' | 'M' | 'D') => expect(classeDoArquivo(p, s).classe, p).toBe('VERMELHO')

describe('classe mínima de release (negação por padrão)', () => {
  it('banco, servidor, CI, build, dependências e configuração são VERMELHOS', () => {
    for (const p of ['supabase/migrations/0077_s3.sql', 'netlify/functions/vibe.ts', 'netlify.toml', '.github/workflows/quality-gate.yml',
      'package.json', 'package-lock.json', 'public/sw.js', 'public/_headers', 'public/_redirects', 'vite.config.ts', 'index.html', 'tsconfig.json',
      'eslint.config.js', '.gitattributes', '.mcp.json', '.claude/settings.json', 'src/main.tsx', 'src/App.tsx'])
      vermelho(p)
  })
  it('src/data inteiro é VERMELHO (persistência, regras de negócio e cliente com chave de serviço)', () => {
    for (const p of ['src/data/supabase.ts', 'src/data/radar.supabase.ts', 'src/data/store.ts', 'src/data/clienteServidor.ts', 'src/data/offline.ts', 'src/data/ambiente.ts'])
      vermelho(p)
  })
  it('scripts e runbooks são VERMELHOS, tenham ou não "produção" no nome', () => {
    for (const p of ['scripts/cno-intake-producao.mts', 'scripts/fin-reset/executar.sql', 'scripts/email-0075/aplicar.mjs', 'scripts/formulario-reconciliar.mts',
      'scripts/db-query.mjs', 'scripts/gerar-build-sha.mjs', 'scripts/pg-smoke-views.mjs', 'scripts/lib/pgliteFila.mjs', 'scripts/vibe.mjs', 'scripts/release-classe.mts'])
      vermelho(p)
  })
  it('exceções nominais em src/core e na documentação: autorização, segredo, envio, dinheiro e a própria política', () => {
    for (const p of ['src/core/permissoes.ts', 'src/core/chaveServico.ts', 'src/core/engine.ts', 'src/core/erroSeguro.ts', 'src/core/inbox/ativacao.ts',
      'src/core/inbox/emailEnvio.ts', 'src/core/central/metaEnvio.ts', 'src/core/radar/canais.ts', 'src/core/radar/formularioAgendado.ts',
      'src/core/radar/formularioGravacao.ts', 'src/core/radar/vibe.ts', 'src/core/radar/comunicacaoServidor.ts', 'src/core/radar/formularioPorta.ts',
      'src/core/radar/comunicacaoLlm.ts', 'src/core/inbox/inteligenciaLlm.ts', 'src/core/release/classe.ts', 'src/core/release/classe.test.ts',
      'src/ui/Paleta.tsx', 'CLAUDE.md', 'docs/politica-releases.md', 'docs/seguranca/s3.md', 'docs/seguranca/s3-0077-retrato.sql'])
      vermelho(p)
  })
  it('VERDE só para documentação; AMARELO para telas, componentes, regra pura, testes e propostas SQL', () => {
    for (const p of ['docs/formulario-site.md', 'README.md', 'docs/propostas/comercial-acesso.md']) expect(classeDoArquivo(p).classe, p).toBe('VERDE')
    for (const p of ['src/screens/comercial/CentralGestao.tsx', 'src/screens/comercial/central.css', 'src/ui/Tabela.tsx', 'src/core/comercial/central.ts',
      'src/core/comercial/central.test.ts', 'src/data/fotos.store.test.ts', 'src/core/__fixtures__/x.json', 'docs/propostas/pedido-projeto.proposta.sql', 'src/styles.css'])
      expect(classeDoArquivo(p).classe, p).toBe('AMARELO')
  })
  it('caminho desconhecido nasce VERMELHO', () => {
    vermelho('docs/propostas/aplicar.mjs')
    vermelho('algo-novo/qualquer.ts')
    vermelho('src/qualquer.tsx')
  })
  it('apagar teste é VERMELHO (pode ser uma guarda); apagar documento é AMARELO', () => {
    vermelho('src/core/central/developmentStatus.test.ts', 'D')
    expect(classeDoArquivo('docs/radar.md', 'D').classe).toBe('AMARELO')
  })
  it('o conjunto vale a maior classe', () => {
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'src/screens/A.tsx' }]).classe).toBe('AMARELO')
    expect(classeDoConjunto([{ arquivo: 'docs/a.md' }, { arquivo: 'supabase/migrations/0078_x.sql' }]).classe).toBe('VERMELHO')
    expect(classeDoConjunto([]).classe).toBe('VERDE')
  })
  it('lê -z com acento, espaço e apagado; renomeação desligada mostra a origem VERMELHA como apagada', () => {
    const z = 'M\0supabase/migrations/0080_permissão.sql\0D\0supabase/migrations/0077_s3.sql\0A\0docs/propostas/0077_s3.sql\0A\0docs/uma pasta/x.md\0'
    const m = lerNameStatusZ(z)
    expect(m.map((x) => x.arquivo)).toEqual(['supabase/migrations/0080_permissão.sql', 'supabase/migrations/0077_s3.sql', 'docs/propostas/0077_s3.sql', 'docs/uma pasta/x.md'])
    const c = classeDoConjunto(m)
    expect(c.classe).toBe('VERMELHO')
    expect(c.arquivos.filter((a) => a.classe === 'VERMELHO').map((a) => a.arquivo)).toEqual(['supabase/migrations/0080_permissão.sql', 'supabase/migrations/0077_s3.sql'])
  })
  it('normaliza barra invertida e espaço/CR nas pontas', () => {
    vermelho('supabase\\migrations\\0077.sql')
    vermelho('supabase/migrations/0077.sql\r')
  })
})
