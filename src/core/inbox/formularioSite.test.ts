/**
 * O formulário do site como mensagem do Inbox.
 *
 * O ponto destes testes: uma submissão válida vira conversa visível SEM
 * empresa cadastrada — e `receberMensagem` deduplica o reenvio pela mesma
 * chave que a borda usa.
 */
import { describe, expect, it } from 'vitest'
import {
  CANAL_FORMULARIO, PROVIDER_FORMULARIO, completarContato, dadosDoContato, deSubmissaoDoSite, identidadeDaSubmissao,
  textoDaMensagem, type PedidoDeMensagem,
} from './formularioSite'
import { receberMensagem } from './fronteiras'
import { CANAIS_INBOX } from './tipos'
import { inboxVazio, type InboxDataset } from './tipos'

const PEDIDO: PedidoDeMensagem = {
  externalMessageId: 'nf-777',
  em: '2026-11-09T14:00:00.000Z',
  rastro: { registroFonteId: 'RF-1', payloadFingerprint: 'abc123', formulario: 'simular-galpao' },
  resumo: {
    nome: 'Ana Lima',
    email: 'Ana@Exemplo.com.BR',
    telefone: '62 90000-0000',
    empresa: 'Lima Indústria',
    cidade: 'Goiânia',
    resumo: 'Industrial · 900 m² · vão 20 m',
    mensagem: 'Preciso de um galpão para a fábrica.',
    linhas: ['Prazo informado: 3 a 6 meses'],
  },
}

const vazio = (): InboxDataset => inboxVazio()

const relogio = (() => {
  let n = 0
  return { agora: '2026-11-09T14:00:01.000Z', novoId: (p: string) => `${p}-${String(++n).padStart(3, '0')}` }
})()

describe('inbox · o canal já existia', () => {
  it('PORTAL está no catálogo, e o provider é MANUAL', () => {
    expect(CANAIS_INBOX).toContain(CANAL_FORMULARIO)
    expect(CANAL_FORMULARIO).toBe('PORTAL')
    expect(PROVIDER_FORMULARIO).toBe('MANUAL')
  })
})

describe('inbox · a identidade é o e-mail', () => {
  it('normalizado para minúsculas, com o nome informado junto', () => {
    const i = identidadeDaSubmissao(PEDIDO.resumo)!
    expect(i.identificador).toBe('ana@exemplo.com.br')
    expect(i.nomeInformado).toBe('Ana Lima')
    /* preencher formulário não prova identidade */
    expect(i.verificada).toBe(false)
  })

  it('sem e-mail não há identidade', () => {
    expect(identidadeDaSubmissao({ nome: 'Ana' })).toBeUndefined()
    expect(identidadeDaSubmissao({ nome: 'Ana', email: '  ' })).toBeUndefined()
  })
})

describe('inbox · o texto mostra o que a pessoa escreveu', () => {
  it('a mensagem dela vem primeiro, destacada do que a página montou', () => {
    const t = textoDaMensagem(PEDIDO.resumo)
    expect(t.startsWith('Preciso de um galpão para a fábrica.')).toBe(true)
    expect(t).toContain('Configuração: Industrial · 900 m² · vão 20 m')
    expect(t).toContain('Prazo informado: 3 a 6 meses')
    expect(t).toContain('Ana Lima · Lima Indústria · Goiânia')
    expect(t).toContain('62 90000-0000')
  })

  it('e não inventa texto quando não há', () => {
    expect(textoDaMensagem({ email: 'a@b.com' })).toBe('a@b.com')
    expect(textoDaMensagem({})).toBe('')
  })
})

describe('inbox · a submissão vira mensagem', () => {
  it('com canal, contexto e rastro', () => {
    const m = deSubmissaoDoSite(PEDIDO)
    expect('erro' in m).toBe(false)
    if ('erro' in m) return
    expect(m.canal).toBe('PORTAL')
    expect(m.contexto).toBe('EXTERNAL')
    expect(m.externalMessageId).toBe('nf-777')
    expect(m.em).toBe(PEDIDO.em)
    expect(m.meta?.['registroFonteId']).toBe('RF-1')
    expect(m.meta?.['payloadFingerprint']).toBe('abc123')
  })

  it('recusa com motivo quando falta e-mail, id ou conteúdo', () => {
    expect(deSubmissaoDoSite({ ...PEDIDO, resumo: { nome: 'A' } })).toEqual({ erro: expect.stringContaining('sem e-mail') })
    expect(deSubmissaoDoSite({ ...PEDIDO, externalMessageId: ' ' })).toEqual({ erro: expect.stringContaining('sem chave de deduplicação') })
  })

  it('e o meta não leva o payload nem segredo', () => {
    const m = deSubmissaoDoSite(PEDIDO)
    if ('erro' in m) throw new Error('setup')
    const chaves = Object.keys(m.meta ?? {})
    expect(chaves.sort()).toEqual(['formulario', 'payloadFingerprint', 'registroFonteId'])
    expect(JSON.stringify(m.meta)).not.toMatch(/token|secret|senha|authorization/i)
  })
})

describe('inbox · o contato não fica «não identificado» quando o dado existe', () => {
  it('nome, empresa, relação lead e o telefone como segunda identidade', () => {
    const d = dadosDoContato(PEDIDO.resumo)
    expect(d.nome).toBe('Ana Lima')
    expect(d.empresaNome).toBe('Lima Indústria')
    expect(d.relacaoSeDesconhecido).toBe('lead')
    /* E.164 sem «+», como o Inbox normaliza o canal WHATSAPP */
    expect(d.identidades).toEqual([{ canal: 'WHATSAPP', identificador: '5562900000000', nomeInformado: 'Ana Lima', verificada: false }])
  })

  it('telefone impossível não vira identidade', () => {
    expect(dadosDoContato({ email: 'a@b.com', telefone: '123' }).identidades).toEqual([])
    expect(dadosDoContato({ email: 'a@b.com' }).identidades).toEqual([])
  })

  it('completa o contato recém-criado pela ingestão', () => {
    const base = { id: 'CTI-1', nome: 'Contato não identificado', tipoRelacao: 'desconhecido' as const, identidades: [identidadeDaSubmissao(PEDIDO.resumo)!], obras: [], criadoEm: '2026-11-09T14:00:00.000Z' }
    const c = completarContato(base, dadosDoContato(PEDIDO.resumo))
    expect(c.nome).toBe('Ana Lima')
    expect(c.empresaNome).toBe('Lima Indústria')
    expect(c.tipoRelacao).toBe('lead')
    expect(c.identidades.map((i) => i.canal)).toEqual(['PORTAL', 'WHATSAPP'])
  })

  it('e NUNCA sobrescreve o que já se sabia', () => {
    const base = { id: 'CTI-1', nome: 'Ana Souza', empresaNome: 'Outra S.A.', tipoRelacao: 'cliente' as const, identidades: [], obras: [], criadoEm: '2026-11-09T14:00:00.000Z' }
    const c = completarContato(base, dadosDoContato(PEDIDO.resumo))
    expect(c.nome).toBe('Ana Souza')
    expect(c.empresaNome).toBe('Outra S.A.')
    expect(c.tipoRelacao).toBe('cliente')
  })

  it('aplicar duas vezes não duplica identidade', () => {
    const base = { id: 'CTI-1', nome: 'Contato não identificado', tipoRelacao: 'desconhecido' as const, identidades: [], obras: [], criadoEm: '2026-11-09T14:00:00.000Z' }
    const d = dadosDoContato(PEDIDO.resumo)
    const uma = completarContato(base, d)
    const duas = completarContato(uma, d)
    expect(duas.identidades.length).toBe(1)
  })
})

describe('inbox · visível SEM empresa cadastrada', () => {
  it('a primeira submissão cria thread e contato desconhecido', () => {
    const m = deSubmissaoDoSite(PEDIDO)
    if ('erro' in m) throw new Error('setup')
    const r = receberMensagem(vazio(), m, relogio)
    expect(r.duplicada).toBe(false)
    expect(r.novaThread).toBe(true)
    expect(r.novoContato).toBe(true)
    expect(r.ds.threads.length).toBe(1)
    expect(r.ds.mensagens.length).toBe(1)
    /* nenhuma empresa é exigida em lugar nenhum do caminho */
    expect(r.ds.contatos[0]!.tipoRelacao).toBe('desconhecido')
    expect(r.ds.contatos[0]!.nome).toBe('Ana Lima')
  })

  it('o reenvio da MESMA submissão é duplicado e não cria nada', () => {
    const m = deSubmissaoDoSite(PEDIDO)
    if ('erro' in m) throw new Error('setup')
    const um = receberMensagem(vazio(), m, relogio)
    const dois = receberMensagem(um.ds, m, relogio)
    expect(dois.duplicada).toBe(true)
    expect(dois.ds.threads.length).toBe(1)
    expect(dois.ds.mensagens.length).toBe(1)
    expect(dois.motivo).toMatch(/reenvia até receber confirmação/)
  })

  it('outra submissão do mesmo e-mail cai na MESMA conversa', () => {
    const m1 = deSubmissaoDoSite(PEDIDO)
    const m2 = deSubmissaoDoSite({ ...PEDIDO, externalMessageId: 'nf-778', rastro: { ...PEDIDO.rastro, registroFonteId: 'RF-2' } })
    if ('erro' in m1 || 'erro' in m2) throw new Error('setup')
    const um = receberMensagem(vazio(), m1, relogio)
    const dois = receberMensagem(um.ds, m2, relogio)
    expect(dois.duplicada).toBe(false)
    expect(dois.novaThread).toBe(false)
    expect(dois.ds.threads.length).toBe(1)
    expect(dois.ds.mensagens.length).toBe(2)
  })
})
