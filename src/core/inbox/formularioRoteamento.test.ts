/**
 * O lead do site chega ao COMERCIAL com responsável e prazo — qualquer que
 * seja a redação.
 *
 * O texto da conversa é o MESMO que a produção monta (`resumoParaOInbox` +
 * `textoDaMensagem`) e a decisão é a do Octopus Router de verdade
 * (`decidirRoteamento`), com as regras padrão do Inbox — as que a produção
 * tem — mais a regra do formulário.
 */
import { describe, expect, it } from 'vitest'
import { REGRA_ROTEAMENTO_DO_SITE, textoDaMensagem } from './formularioSite'
import { decidirRoteamento, type EntradaRoteador } from './roteador'
import { CONFIGURACAO_PADRAO, inboxVazio } from './index'
import type { ContatoInbox, InboxMessage, InboxThread, Setor } from './tipos'
import { resumoParaOInbox } from '../radar/formularioGravacao'
import type { SubmissaoFormulario } from '../radar/formularioSite'

const ATENDENTE = 'u-atendente'
const EM = '2026-11-09T14:00:00.000Z'
const pessoa = { nome: 'Ana Lima (FICTÍCIO)', email: 'ana@exemplo.invalido', telefone: '(62) 90000-0000', cidade: 'Goiânia, GO', empresa: 'Exemplo Ltda' }

/** Redações que o catálogo de palavras, sozinho, mandaria para outros setores. */
const CASOS: Record<string, { formulario: string; campos: Record<string, string> }> = {
  'simulador completo': { formulario: 'simular-galpao', campos: { ...pessoa, uso: 'Logística e armazenagem', area: '1200', vao: '20', comprimento: '60', peDireito: '8', prazo: 'Até 6 meses', resumo: 'Galpão logístico 20 x 60 m' } },
  'entrega, prazo e pagamento na observação': { formulario: 'simular-galpao', campos: { ...pessoa, uso: 'Agro', area: '2000', observacao: 'Preciso da entrega até março; qual o prazo e a forma de pagamento, boleto ou pix?' } },
  'cotação com fornecedores': { formulario: 'simular-galpao', campos: { ...pessoa, uso: 'Comercial', area: '500', observacao: 'Estou em cotação com três fornecedores de aço e chapa.' } },
  'pede projeto, cálculo e desenho': { formulario: 'iniciar-projeto', campos: { ...pessoa, mensagem: 'Preciso de projeto, cálculo e desenho com ART.' } },
  'mensagem vaga': { formulario: 'iniciar-projeto', campos: { nome: 'Lia (FICTÍCIO)', email: 'lia@exemplo.invalido', mensagem: 'Olá, podem me ligar?' } },
}

function entrada(caso: keyof typeof CASOS, o: { regraDoSite: boolean; responsavelPadrao: boolean; canal?: InboxThread['canal'] }): EntradaRoteador {
  const { formulario, campos } = CASOS[caso]!
  const s: SubmissaoFormulario = { id: 'ensaio', formulario, recebidoEm: EM, campos }
  const texto = textoDaMensagem(resumoParaOInbox(s))
  const setores: Setor[] = ['COMERCIAL', 'ADMINISTRATIVO', 'DIRETORIA', 'JURIDICO', 'FINANCEIRO', 'OBRAS', 'COMPRAS', 'ENGENHARIA', 'POS_VENDA', 'FORNECEDORES']
    .map((codigo, ordem) => ({ codigo, nome: codigo, ativo: true, ordem, ...(codigo === 'COMERCIAL' && o.responsavelPadrao ? { responsavelPadraoId: ATENDENTE } : {}) }))
  const canal = o.canal ?? 'PORTAL'
  // o contato já foi completado como `lead` quando o roteador roda (passo 3 antes do passo 4 da gravação)
  const contato = { id: 'c1', nome: campos['nome'], tipoRelacao: 'lead', obras: [], criadoEm: EM, identidades: [{ canal, identificador: campos['email'], verificada: false }] } as unknown as ContatoInbox
  const thread = { id: 't1', canal, provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'c1', assunto: '', status: 'NOVA', prioridade: 'Normal', nivel: 'C', abertaEm: EM, atualizadaEm: EM, ultimaMensagemEm: EM, labels: [], participantes: [] } as unknown as InboxThread
  const mensagem = { id: 'm1', threadId: 't1', direcao: 'inbound', tipo: 'texto', texto, anexos: [], em: EM } as unknown as InboxMessage
  const regrasRoteamento = o.regraDoSite ? [REGRA_ROTEAMENTO_DO_SITE, ...CONFIGURACAO_PADRAO.regrasRoteamento] : CONFIGURACAO_PADRAO.regrasRoteamento
  return {
    // sem membro de setor: como a produção fica com um único Administrador e só o responsável padrão
    inbox: { ...inboxVazio(), setores, contatos: [contato], threads: [thread], mensagens: [mensagem], configuracao: { ...CONFIGURACAO_PADRAO, regrasRoteamento } },
    thread, mensagem, obras: [], usuarios: [{ id: ATENDENTE, ativo: true, papel: 'Administrador' }], agora: EM,
  }
}

describe('roteamento do lead do site', () => {
  it.each(Object.keys(CASOS))('com a regra do site e responsável padrão: «%s» → COMERCIAL, com pessoa e prazo', (caso) => {
    const d = decidirRoteamento(entrada(caso, { regraDoSite: true, responsavelPadrao: true }))
    expect(d.setorCodigo).toBe('COMERCIAL')
    expect(d.banda).toBe('HIGH')
    expect(d.aplicacao).toBe('ATRIBUIR_PESSOA')
    expect(d.responsavelId).toBe(ATENDENTE)
    expect(d.fallback).toBe(false)
    // prazo de primeira resposta: nunca além do SLA da prioridade Normal (24 h); urgência no texto só encurta
    const horas = (Date.parse(d.slaAte) - Date.parse(EM)) / 3_600_000
    expect(horas).toBeGreaterThan(0)
    expect(horas).toBeLessThanOrEqual(CONFIGURACAO_PADRAO.slaHorasPorPrioridade.Normal)
  })

  it('o responsável padrão do setor basta: não é preciso ser membro nem ter equipe', () => {
    const e = entrada('simulador completo', { regraDoSite: true, responsavelPadrao: true })
    expect(e.inbox.membros).toHaveLength(0)
    expect(e.inbox.equipes).toHaveLength(0)
    expect(decidirRoteamento(e).responsavelId).toBe(ATENDENTE)
  })

  it('sem responsável padrão a conversa fica só no setor — é o estado que a ativação tem de corrigir', () => {
    const d = decidirRoteamento(entrada('simulador completo', { regraDoSite: true, responsavelPadrao: false }))
    expect(d.setorCodigo).toBe('COMERCIAL')
    expect(d.aplicacao).toBe('ATRIBUIR_SETOR')
    expect(d.responsavelId).toBeUndefined()
  })

  it('a regra é necessária: sem ela, uma redação vaga sai do COMERCIAL pelas palavras do texto', () => {
    const d = decidirRoteamento(entrada('mensagem vaga', { regraDoSite: false, responsavelPadrao: true }))
    expect(d.setorCodigo).not.toBe('COMERCIAL')
  })

  it('a regra casa pelo canal do formulário: a mesma redação pelo WhatsApp segue as regras por intenção', () => {
    const d = decidirRoteamento(entrada('pede projeto, cálculo e desenho', { regraDoSite: true, responsavelPadrao: true, canal: 'WHATSAPP' }))
    expect(d.setorCodigo).toBe('ENGENHARIA')
  })

  it('a regra não fixa pessoa nem prioridade, e vem antes das regras por intenção', () => {
    expect(REGRA_ROTEAMENTO_DO_SITE.destino).toEqual({ setorCodigo: 'COMERCIAL' })
    expect(REGRA_ROTEAMENTO_DO_SITE.condicao).toEqual({ contexto: 'EXTERNAL', canais: ['PORTAL'] })
    expect(Math.min(...CONFIGURACAO_PADRAO.regrasRoteamento.map((r) => r.ordem))).toBeGreaterThan(REGRA_ROTEAMENTO_DO_SITE.ordem)
  })
})
