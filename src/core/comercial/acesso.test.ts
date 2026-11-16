// E11.1E — isolamento da Central de Gestão Comercial: quem vê o quê, acesso direto por URL e a projeção técnica da
// Engenharia (nenhum valor, negociação ou contato do cliente atravessa). Dados FICTÍCIOS (exemplo do Inbox + demonstração).
import { describe, expect, it } from 'vitest'
import { MATRIZ, pode } from '../permissoes'
import { seedInbox } from '../inbox/seed'
import type { Papel, Usuario } from '../types'
import { PAPEIS } from '../usuarios'
import { MATRIZ_CENTRAL, areaNoEscopo, dossieNoEscopo, escopoCentral, solicitacoesTecnicas, CLIENTE_SEM_EMPRESA } from './acesso'
import { retratoCentral, type FontesCentral } from './central'
import { demonstracaoCentral } from './demonstracao'

const AGORA = '2026-11-16T15:00:00.000Z'
const HOJE = '2026-11-16'
const u = (papel: Papel, ativo = true): Usuario => ({ id: `u-${papel}`, nome: papel, email: `${papel}@exemplo`, papel, ativo, obras: '*' } as Usuario)

describe('Matriz de acesso da Central', () => {
  it('cada papel existente cai no nível previsto pela matriz documentada', () => {
    for (const papel of PAPEIS) {
      const linha = MATRIZ_CENTRAL.find((l) => l.papel === papel)
      expect(linha, `papel ${papel} sem linha na MATRIZ_CENTRAL`).toBeDefined()
      expect(linha!.vigente).toBe(true)
      expect(escopoCentral(u(papel)).nivel, papel).toBe(linha!.nivel)
    }
  })

  it('integral só para Administrador e Diretoria; técnico só para a Engenharia; o resto sem acesso', () => {
    expect(PAPEIS.filter((p) => escopoCentral(u(p)).nivel === 'integral')).toEqual(['Administrador', 'Diretoria'])
    expect(PAPEIS.filter((p) => escopoCentral(u(p)).nivel === 'tecnico')).toEqual(['Engenharia'])
    for (const p of ['Financeiro', 'Contabilidade', 'Compras', 'Gestor de obra', 'Auditoria', 'Solicitante'] as Papel[]) expect(escopoCentral(u(p)).nivel).toBe('sem_acesso')
  })

  it('o papel Comercial está só PROPOSTO: não existe em PAPEIS nem na MATRIZ até a migration de enum', () => {
    expect((PAPEIS as string[]).includes('Comercial')).toBe(false)
    expect(MATRIZ_CENTRAL.find((l) => l.papel === 'Comercial')).toMatchObject({ vigente: false, nivel: 'integral' })
    for (const lista of Object.values(MATRIZ)) expect((lista as string[]).includes('Comercial')).toBe(false)
  })

  it('a Central não herda `radar`: Financeiro, Compras e Gestor de obra têm Radar mas não a Central', () => {
    for (const p of ['Financeiro', 'Compras', 'Gestor de obra'] as Papel[]) {
      expect(pode(u(p), 'radar')).toBe(true)
      expect(escopoCentral(u(p)).nivel).toBe('sem_acesso')
    }
  })

  it('perfil inativo nunca entra, qualquer que seja o papel', () => {
    for (const p of PAPEIS) expect(escopoCentral(u(p, false)).nivel).toBe('sem_acesso')
  })

  it('só a visão integral liga dossiê, valores, contatos e demonstração', () => {
    const e = escopoCentral(u('Engenharia'))
    expect(e).toMatchObject({ dossie: false, valores: false, contatos: false, demonstracao: false, areas: ['projetos'] })
    expect(escopoCentral(u('Diretoria'))).toMatchObject({ dossie: true, valores: true, contatos: true, demonstracao: true })
  })
})

describe('Acesso direto por URL', () => {
  it('área fora do escopo é rebaixada à permitida; sem acesso não abre área nenhuma', () => {
    const eng = escopoCentral(u('Engenharia'))
    for (const a of ['visao', 'leads', 'retornos', 'propostas', 'pipeline', 'qualquer', null]) expect(areaNoEscopo(eng, a)).toBe('projetos')
    expect(areaNoEscopo(escopoCentral(u('Diretoria')), 'pipeline')).toBe('pipeline')
    expect(areaNoEscopo(escopoCentral(u('Contabilidade')), 'projetos')).toBeUndefined()
  })

  it('dossiê pela URL só abre na visão integral', () => {
    expect(dossieNoEscopo(escopoCentral(u('Engenharia')), 'empresa:demo-barros')).toBeUndefined()
    expect(dossieNoEscopo(escopoCentral(u('Contabilidade')), 'contato:CTI-00010')).toBeUndefined()
    expect(dossieNoEscopo(escopoCentral(u('Diretoria')), 'empresa:demo-barros')).toBe('empresa:demo-barros')
  })
})

describe('Projeção técnica da Engenharia', () => {
  const inbox = demonstracaoCentral(HOJE, seedInbox(AGORA)).inbox!
  const demo = demonstracaoCentral(HOJE, inbox)
  const fontes: FontesCentral = { inbox, radar: demo.radar, orcamentos: demo.orcamentos, catalogo: { insumos: [], composicoes: [] }, usuarios: [{ id: 'u-augusto', nome: 'Augusto Macedo', ativo: true }] }
  const retrato = retratoCentral(fontes, { usuario: { id: 'u-augusto', papel: 'Diretoria' }, agoraIso: AGORA, hoje: HOJE, veInbox: true })
  const tecnicas = solicitacoesTecnicas(retrato.solicitacoes)
  const texto = JSON.stringify(tecnicas)

  it('há pedidos das três fontes para a prova não passar vazia', () => {
    expect(new Set(tecnicas.map((t) => t.origem))).toEqual(new Set(['simulador_site', 'oportunidade', 'atividade']))
  })

  it('nenhum nome, telefone ou e-mail de pessoa do cliente (Inbox e Radar)', () => {
    const sensiveis = [
      ...inbox.contatos.flatMap((c) => [c.nome, ...(c.identidades ?? []).flatMap((i) => [i.identificador, i.nomeInformado])]),
      ...demo.radar.contatos.flatMap((c) => [c.nome, c.email, c.telefone, c.celular, c.linkedin]),
    ].filter((x): x is string => typeof x === 'string' && x.trim().length > 3)
    expect(sensiveis.length).toBeGreaterThan(0)
    for (const s of sensiveis) expect(texto.includes(s), `vazou «${s}»`).toBe(false)
  })

  it('nenhum valor, probabilidade, observação comercial, nota de atividade, dossiê ou link', () => {
    for (const o of demo.radar.oportunidades) {
      if (o.observacoes) expect(texto.includes(o.observacoes), `observação da ${o.id}`).toBe(false)
      if (o.valorEstimado) expect(texto.includes(String(o.valorEstimado))).toBe(false)
    }
    for (const a of demo.radar.atividades) if (a.notas && a.notas.length > 3) expect(texto.includes(a.notas), `nota da ${a.id}`).toBe(false)
    for (const t of tecnicas) for (const k of ['dossie', 'link', 'escopo', 'valor', 'probabilidade', 'contato']) expect(k in t, `${t.id}.${k}`).toBe(false)
  })

  it('cliente é a empresa, nunca a pessoa; sem empresa informada fica explícito', () => {
    for (const t of tecnicas) expect(t.cliente.length).toBeGreaterThan(0)
    const doSite = tecnicas.filter((t) => t.origem === 'simulador_site')
    expect(doSite.length).toBeGreaterThan(0)
    for (const t of doSite) {
      const original = retrato.solicitacoes.find((s) => s.id === t.id)!
      expect(t.cliente).toBe(original.empresaCliente ?? CLIENTE_SEM_EMPRESA)
    }
  })

  it('os dados técnicos declarados continuam inteiros (a projeção corta o comercial, não o técnico)', () => {
    for (const s of retrato.solicitacoes) {
      const t = tecnicas.find((x) => x.id === s.id)!
      for (const d of s.dadosTecnicos) expect(t.dadosTecnicos).toContain(d)
    }
  })
})
