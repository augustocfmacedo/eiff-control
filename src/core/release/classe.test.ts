import { describe, expect, it } from 'vitest'
import { classeDoArquivo, classeDoConjunto } from './classe'

describe('classe mínima de release por arquivo', () => {
  it('banco, servidor, CI, dependências e permissões são sempre VERMELHOS', () => {
    for (const p of ['supabase/migrations/0077_s3.sql', 'netlify/functions/vibe.ts', 'netlify.toml', '.github/workflows/quality-gate.yml',
      'package.json', 'package-lock.json', 'src/core/permissoes.ts', 'src/core/chaveServico.ts', 'src/data/supabase.ts',
      'src/data/radar.supabase.ts', 'src/core/radar/comunicacaoServidor.ts', 'src/core/radar/formularioPorta.ts', 'scripts/cno-intake-producao.mts',
      'public/sw.js', 'docs/seguranca/s3-0077-retrato.sql', 'src/data/offline.ts'])
      expect(classeDoArquivo(p).classe, p).toBe('VERMELHO')
  })
  it('documentação, testes e propostas não aplicadas são VERDES', () => {
    for (const p of ['docs/politica-releases.md', 'CLAUDE.md', 'src/core/comercial/central.test.ts', 'src/core/__fixtures__/x.json', 'docs/propostas/pedido-projeto.proposta.sql'])
      expect(classeDoArquivo(p).classe, p).toBe('VERDE')
  })
  it('código do app é AMARELO por padrão', () => {
    expect(classeDoArquivo('src/screens/comercial/CentralGestao.tsx').classe).toBe('AMARELO')
    expect(classeDoArquivo('src/core/comercial/central.ts').classe).toBe('AMARELO')
  })
  it('o conjunto vale a maior classe: um arquivo vermelho torna a publicação inteira vermelha', () => {
    expect(classeDoConjunto(['docs/a.md', 'src/screens/A.tsx']).classe).toBe('AMARELO')
    expect(classeDoConjunto(['docs/a.md', 'src/screens/A.tsx', 'supabase/migrations/0078_x.sql']).classe).toBe('VERMELHO')
    expect(classeDoConjunto([]).classe).toBe('VERDE')
  })
  it('normaliza barra invertida do Windows', () => {
    expect(classeDoArquivo('supabase\\migrations\\0077.sql').classe).toBe('VERMELHO')
  })
})
