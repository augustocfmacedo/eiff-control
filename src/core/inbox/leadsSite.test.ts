// Leads do site: a projeção comercial sobre as conversas do Inbox. O que estes testes prendem:
//  1. a leitura do texto é a INVERSA da escrita real (resumoParaOInbox → textoDaMensagem → lerSolicitacao);
//  2. a tela não tem cadastro próprio: lead = conversa PORTAL/EXTERNAL, com a visibilidade do Inbox;
//  3. o SLA mostrado é o do Inbox (estadoSla/situacaoPrimeiraResposta) e só contato realizado conta como resposta;
//  4. filtros, contagens, histórico, próxima ação, atalhos de contato e o rascunho de e-mail.
import { describe, expect, it } from 'vitest'
import { resumoParaOInbox, ROTULO_LEITURA_DA_PAGINA } from '../radar/formularioGravacao'
import type { SubmissaoFormulario } from '../radar/formularioSite'
import type { Usuario } from '../types'
import { corpoComAssinatura } from './emailMensagem'
import { textoDaMensagem } from './formularioSite'
import {
  FILTROS_LEAD, MARCA_RASCUNHO_EMAIL, NOME_NAO_IDENTIFICADO, PRAZO_LEAD_DO_SITE_MIN, contarPorFiltro, ehLeadDoSite, filtrarLeads, formulariosPresentes, historicoDoLead, identificarContato, leadDoSite, leadsDoSite,
  lerSolicitacao, linksDeContato, proximaAcao, resumoLeads, sugestaoDeEmail, textoDoRascunhoDeEmail, validarRascunhoDeEmail,
} from './leadsSite'
import { estadoSla } from './roteamento'
import { situacaoPrimeiraResposta } from './primeiraResposta'
import { seedInbox } from './seed'
import type { InboxMessage, InboxThread } from './tipos'

// Quarta-feira, 15h de Brasília: dentro do expediente, sem feriado por perto.
const AGORA = '2026-11-11T18:00:00.000Z'
const usuario = (id: string, papel: Usuario['papel']): Usuario => ({ id, nome: id, email: `${id}@x`, papel, obras: '*', ativo: true })
const ADMIN = usuario('u-admin', 'Administrador')
const AUGUSTO = usuario('u-augusto', 'Diretoria')

const SUB: SubmissaoFormulario = {
  id: 'nf-1', formulario: 'simular-galpao', recebidoEm: '2026-11-11T17:50:00.000Z',
  campos: {
    nome: 'Ana Lima (FICTÍCIO)', email: 'Ana@Exemplo.com.br', telefone: '62 90000-0000', empresa: 'Lima Indústria', cidade: 'Goiânia, GO',
    uso: 'industrial', area: '900', vao: '20', comprimento: '45', peDireito: '8', prazo: 'Até 6 meses', escopo: 'Estrutura e cobertura',
    observacao: 'Preciso de um galpão para a fábrica.\nPodem me ligar à tarde?', resumo: 'Industrial · 900 m² · vão 20 m',
    leitura: 'Vão de 20 m dentro do que já foi executado.',
  },
}

describe('lerSolicitacao: a leitura é a inversa da escrita real', () => {
  const resumo = resumoParaOInbox(SUB)
  const texto = textoDaMensagem(resumo)
  const s = lerSolicitacao(texto)

  it('recupera o que a pessoa escreveu, inclusive em mais de uma linha', () => {
    expect(s.mensagem).toBe(resumo.mensagem)
    expect(s.mensagem).toContain('Podem me ligar à tarde?')
  })
  it('recupera a configuração e cada linha de detalhe que a gravação escreveu', () => {
    expect(s.configuracao).toBe(resumo.resumo)
    for (const l of resumo.linhas ?? []) {
      if (l.startsWith('Medidas:')) expect(`Medidas: ${s.medidas}`).toBe(l)
      if (l.startsWith('Prazo informado:')) expect(`Prazo informado: ${s.prazo}`).toBe(l)
      if (l.startsWith('Escopo:')) expect(`Escopo: ${s.escopo}`).toBe(l)
      if (l.startsWith('Especificação:')) expect(`Especificação: ${s.especificacao}`).toBe(l)
    }
    expect(s.medidas).toContain('vão 20 m')
    expect(s.prazo).toBe('Até 6 meses')
  })
  it('separa o texto automático da página, que não é orientação de engenharia', () => {
    expect(s.leituraDaPagina).toEqual(['Vão de 20 m dentro do que já foi executado.'])
    expect(texto).toContain(ROTULO_LEITURA_DA_PAGINA)
    expect(s.mensagem).not.toContain('dentro do que já foi executado')
  })
  it('lê o formulário de origem, o contato e os canais', () => {
    expect(s.formulario).toBe('simular-galpao')
    expect(s.contato).toEqual([resumo.nome, resumo.empresa, resumo.cidade])
    expect(s.canais).toEqual([resumo.email, resumo.telefone])
  })
  it('submissão mínima (só e-mail) não inventa campo', () => {
    const m = lerSolicitacao(textoDaMensagem(resumoParaOInbox({ id: 'x', formulario: 'iniciar-projeto', recebidoEm: SUB.recebidoEm, campos: { email: 'a@b.com' } })))
    expect(m.formulario).toBe('iniciar-projeto')
    expect(m.mensagem).toBeUndefined()
    expect(m.configuracao).toBeUndefined()
    expect(m.canais).toEqual(['a@b.com'])
  })
  it('texto que não veio do formulário vira mensagem livre, sem perder nada', () => {
    const m = lerSolicitacao('Bom dia, ainda aguardo o retorno.\nObrigado.')
    expect(m.mensagem).toBe('Bom dia, ainda aguardo o retorno.\nObrigado.')
    expect(m.contato).toEqual([])
  })
})

describe('leadsDoSite: projeção sobre as conversas do Inbox', () => {
  const ds = seedInbox(AGORA)
  const leads = leadsDoSite(ds, ADMIN, AGORA)

  it('lead do site é a conversa PORTAL + EXTERNAL — nenhuma outra entra', () => {
    expect(leads.length).toBe(ds.threads.filter(ehLeadDoSite).length)
    expect(leads.length).toBe(4)
    expect(leads.every((l) => l.thread.canal === 'PORTAL' && l.thread.contexto === 'EXTERNAL' && l.thread.setorCodigo === 'COMERCIAL')).toBe(true)
    expect(ehLeadDoSite({ canal: 'EMAIL', contexto: 'EXTERNAL' })).toBe(false)
    expect(ehLeadDoSite({ canal: 'PORTAL', contexto: 'INTERNAL' })).toBe(false)
  })
  it('não duplica cadastro: thread e contato são os MESMOS objetos do Inbox', () => {
    for (const l of leads) {
      expect(ds.threads).toContain(l.thread)
      expect(ds.contatos).toContain(l.contato)
    }
  })
  it('usa a visibilidade do Inbox: quem não é do Comercial nem transversal não vê', () => {
    expect(leadsDoSite(ds, usuario('u-fin', 'Financeiro'), AGORA)).toEqual([])
    expect(leadsDoSite(ds, AUGUSTO, AGORA).length).toBe(4)
  })
  it('traz nome, empresa, cidade, e-mail, telefone, formulário e data de recebimento', () => {
    const l = leads.find((x) => x.thread.id === 'THR-00011')!
    expect(l).toMatchObject({ nome: 'Marina Teixeira', empresa: 'Grãos do Vale Armazéns', cidade: 'Rio Verde/GO', email: 'marina@graosdovale.exemplo', telefone: '(64) 90000-0111', telefoneE164: '5564900000111', formulario: 'simular-galpao' })
    expect(l.recebidoEm).toBe(l.thread.abertaEm)
    expect(l.solicitacao.medidas).toBe('vão 25 m · comprimento 80 m · pé-direito 10 m')
    expect(l.solicitacao.prazo).toBe('Até 6 meses')
    expect(l.solicitacao.leituraDaPagina.length).toBe(1)
  })
  it('lead sem empresa (duas partes na linha): nem empresa nem cidade são deduzidas', () => {
    const l = leads.find((x) => x.thread.id === 'THR-00014')!
    expect(l.nome).toBe('Caio Mendonça')
    expect(l.empresa).toBeUndefined()
    expect(l.cidade).toBeUndefined()
    expect(l.formulario).toBe('iniciar-projeto')
    // nada se perde: a linha inteira continua na solicitação e no histórico
    expect(l.solicitacao.contato).toEqual(['Caio Mendonça', 'Goiânia/GO'])
  })
  it('o SLA é o do Inbox, nunca recalculado aqui', () => {
    for (const l of leads) {
      expect(l.sla).toBe(estadoSla(l.thread, AGORA))
      expect(l.situacao).toBe(situacaoPrimeiraResposta(l.thread))
      expect(l.prazoAte).toBe(l.thread.sla?.primeiraRespostaAte)
    }
    expect(PRAZO_LEAD_DO_SITE_MIN).toBe(30)
  })
  it('as quatro leituras do exemplo: no prazo, vencido, respondido no prazo e fora do prazo', () => {
    const por = Object.fromEntries(leads.map((l) => [l.thread.id, l]))
    expect(por['THR-00011'].sla).toBe('no_prazo')
    expect(por['THR-00012'].sla).toBe('vencido')
    expect(por['THR-00013'].situacao).toBe('respondida_no_prazo')
    expect(por['THR-00014'].situacao).toBe('respondida_fora_do_prazo')
  })
  it('tentativa e rascunho são contados à parte e NÃO viram primeira resposta', () => {
    const tentou = leads.find((x) => x.thread.id === 'THR-00012')!
    expect(tentou.tentativas).toBe(1)
    expect(tentou.contatosRealizados).toBe(0)
    expect(tentou.primeiraRespostaEm).toBeUndefined()
    const respondido = leads.find((x) => x.thread.id === 'THR-00013')!
    expect(respondido).toMatchObject({ contatosRealizados: 1, rascunhos: 1 })
  })
  it('a ordem é a de trabalho: prazo vencido primeiro, e quem aguarda o primeiro contato antes de quem já foi atendido', () => {
    expect(leads.map((l) => l.thread.id)).toEqual(['THR-00012', 'THR-00011', 'THR-00014', 'THR-00013'])
  })
  it('duas submissões do mesmo e-mail na mesma conversa: mostra a mais recente e conta as duas', () => {
    const t = ds.threads.find((x) => x.id === 'THR-00011')!
    const segunda: InboxMessage = { id: 'MSG-X', threadId: t.id, provider: 'MANUAL', direcao: 'inbound', tipo: 'texto', autor: { tipo: 'contato', nome: 'Marina Teixeira' }, anexos: [], em: AGORA, meta: { formulario: 'iniciar-projeto' },
      texto: textoDaMensagem({ mensagem: 'Mudamos o vão para 30 m.', resumo: 'Galpão 30 x 80 m', nome: 'Marina Teixeira', email: 'marina@graosdovale.exemplo', linhas: ['Origem: formulário "iniciar-projeto" do site (eiff.com.br).'] }) }
    const l = leadDoSite(t, ds.contatos.find((c) => c.id === t.contatoId), [...ds.mensagens, segunda], AGORA)
    expect(l.solicitacoes).toBe(2)
    expect(l.formulario).toBe('iniciar-projeto')
    expect(l.solicitacao.configuracao).toBe('Galpão 30 x 80 m')
    expect(l.recebidoEm).toBe(AGORA)
  })
})

describe('identificarContato: empresa e cidade sem dedução', () => {
  const contato = (p: { nome?: string; empresa?: string; informado?: string } = {}) => ({
    nome: p.nome ?? NOME_NAO_IDENTIFICADO, empresaNome: p.empresa,
    identidades: [{ canal: 'PORTAL' as const, identificador: 'a@b.com', verificada: false, ...(p.informado !== undefined ? { nomeInformado: p.informado } : {}) }],
  })
  const ANA = contato({ nome: 'Ana Lima', informado: 'Ana Lima' })

  it('três partes começando pelo nome conhecido: nome, empresa e cidade pela ordem', () => {
    expect(identificarContato(['Ana Lima', 'Lima Indústria', 'Goiânia/GO'], ANA)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
  })
  it('três partes sem nenhum nome conhecido (contato ainda não completado): vale a ordem', () => {
    expect(identificarContato(['Ana Lima', 'Lima Indústria', 'Goiânia/GO'], contato())).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
    expect(identificarContato(['Ana Lima', 'Lima Indústria', 'Goiânia/GO'], undefined)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
  })
  it('três partes, mas a 1ª não é o nome conhecido: não se rotula', () => {
    expect(identificarContato(['Outra Pessoa', 'Lima Indústria', 'Goiânia/GO'], ANA)).toEqual({ nome: 'Ana Lima' })
  })
  it('nome + empresa (duas partes): a 2ª NÃO vira cidade', () => {
    const r = identificarContato(['Ana Lima', 'Lima Indústria'], ANA)
    expect(r).toEqual({ nome: 'Ana Lima' })
  })
  it('nome + cidade (duas partes): a 2ª NÃO vira empresa', () => {
    const r = identificarContato(['Ana Lima', 'Goiânia/GO'], ANA)
    expect(r.empresa).toBeUndefined()
    expect(r.cidade).toBeUndefined()
  })
  it('as duas leituras de duas partes dão o MESMO resultado: é a prova de que nada é adivinhado', () => {
    expect(identificarContato(['Ana Lima', 'Goiânia'], ANA)).toEqual(identificarContato(['Ana Lima', 'Goiânia Estruturas'], ANA))
  })
  it('empresa + cidade (sem nome): nada é rotulado, e o nome não é inventado', () => {
    expect(identificarContato(['Lima Indústria', 'Goiânia/GO'], contato())).toEqual({ nome: NOME_NAO_IDENTIFICADO })
  })
  it('uma parte só: pode ser nome, empresa ou cidade — nenhuma é escolhida', () => {
    expect(identificarContato(['Goiânia/GO'], contato())).toEqual({ nome: NOME_NAO_IDENTIFICADO })
    expect(identificarContato(['Ana Lima'], ANA)).toEqual({ nome: 'Ana Lima' })
  })
  it('linha vazia: só as fontes rotuladas', () => {
    expect(identificarContato([], contato())).toEqual({ nome: NOME_NAO_IDENTIFICADO })
    expect(identificarContato([], contato({ nome: 'Ana Lima', empresa: 'Lima Indústria' }))).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria' })
  })
  it('a empresa do contato do Inbox é fonte rotulada: vale com qualquer linha, e a cidade segue não informada', () => {
    const comEmpresa = contato({ nome: 'Ana Lima', empresa: 'Lima Indústria', informado: 'Ana Lima' })
    expect(identificarContato(['Ana Lima', 'Goiânia/GO'], comEmpresa)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria' })
    expect(identificarContato(['Ana Lima', 'Lima Indústria'], comEmpresa)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria' })
  })
  it('três partes com empresa diferente da do cadastro: prevalece a do Inbox, a cidade é a 3ª', () => {
    const comEmpresa = contato({ nome: 'Ana Lima', empresa: 'Lima Indústria', informado: 'Ana Lima' })
    expect(identificarContato(['Ana Lima', 'Outra Razão Social', 'Goiânia/GO'], comEmpresa)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
  })
  it('contato antigo com outro nome: o nome informado no formulário identifica a 1ª parte', () => {
    const antigo = contato({ nome: 'Ana L. (cliente)', informado: 'Ana Lima' })
    expect(identificarContato(['Ana Lima', 'Lima Indústria', 'Goiânia/GO'], antigo)).toEqual({ nome: 'Ana L. (cliente)', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
  })
  it('mais de três partes (algum campo tinha o separador): não se rotula', () => {
    expect(identificarContato(['Ana Lima', 'Lima', 'Indústria', 'Goiânia/GO'], ANA)).toEqual({ nome: 'Ana Lima' })
  })
  it('nome ou empresa conhecidos contendo o separador: a linha não é confiável', () => {
    const comSeparador = contato({ nome: 'Ana · Lima', informado: 'Ana · Lima' })
    expect(identificarContato(['Ana', 'Lima', 'Goiânia/GO'], comSeparador)).toEqual({ nome: 'Ana · Lima' })
    expect(identificarContato(['Ana Lima', 'Lima', 'Indústria'], contato({ nome: 'Ana Lima', empresa: 'Lima · Indústria' }))).toEqual({ nome: 'Ana Lima', empresa: 'Lima · Indústria' })
  })
  it('espaços em volta e partes vazias não mudam a leitura', () => {
    expect(identificarContato([' Ana Lima ', '', ' Lima Indústria ', 'Goiânia/GO '], ANA)).toEqual({ nome: 'Ana Lima', empresa: 'Lima Indústria', cidade: 'Goiânia/GO' })
  })
  it('ida e volta com a gravação real: os três campos preenchidos são lidos; sem empresa, a cidade não é deduzida', () => {
    const tres = lerSolicitacao(textoDaMensagem(resumoParaOInbox(SUB)))
    expect(identificarContato(tres.contato, contato({ nome: 'Ana Lima (FICTÍCIO)', informado: 'Ana Lima (FICTÍCIO)' }))).toEqual({ nome: 'Ana Lima (FICTÍCIO)', empresa: 'Lima Indústria', cidade: tres.contato[2] })
    const semEmpresa = Object.fromEntries(Object.entries(SUB.campos).filter(([k]) => k !== 'empresa'))
    const dois = lerSolicitacao(textoDaMensagem(resumoParaOInbox({ ...SUB, campos: semEmpresa })))
    expect(dois.contato.length).toBe(2)
    expect(identificarContato(dois.contato, contato({ nome: 'Ana Lima (FICTÍCIO)', informado: 'Ana Lima (FICTÍCIO)' }))).toEqual({ nome: 'Ana Lima (FICTÍCIO)' })
  })
})

describe('filtros operacionais e indicadores', () => {
  const ds = seedInbox(AGORA)
  const leads = leadsDoSite(ds, AUGUSTO, AGORA)
  const ids = (f: Parameters<typeof filtrarLeads>[1]) => filtrarLeads(leads, f).map((l) => l.thread.id).sort()

  it('cada filtro mostra o que o nome diz', () => {
    expect(ids({ filtro: 'aguardando', usuarioId: AUGUSTO.id })).toEqual(['THR-00011', 'THR-00012'])
    expect(ids({ filtro: 'atrasados', usuarioId: AUGUSTO.id })).toEqual(['THR-00012'])
    expect(ids({ filtro: 'respondidos', usuarioId: AUGUSTO.id })).toEqual(['THR-00013', 'THR-00014'])
    expect(ids({ filtro: 'meus', usuarioId: AUGUSTO.id }).length).toBe(4)
    expect(ids({ filtro: 'meus', usuarioId: 'outra-pessoa' })).toEqual([])
    expect(ids({ filtro: 'sem_responsavel', usuarioId: AUGUSTO.id })).toEqual([])
    expect(ids({ filtro: 'encerrados', usuarioId: AUGUSTO.id })).toEqual([])
    expect(ids({ filtro: 'todos', usuarioId: AUGUSTO.id }).length).toBe(4)
  })
  it('filtrar não reordena', () => {
    const todos = filtrarLeads(leads, { filtro: 'todos', usuarioId: AUGUSTO.id })
    expect(todos.map((l) => l.thread.id)).toEqual(leads.map((l) => l.thread.id))
  })
  it('a contagem ao lado do filtro é a do próprio filtro', () => {
    const c = contarPorFiltro(leads, AUGUSTO.id)
    for (const f of FILTROS_LEAD) expect(c[f]).toBe(filtrarLeads(leads, { filtro: f, usuarioId: AUGUSTO.id }).length)
  })
  it('filtra por formulário de origem', () => {
    expect(formulariosPresentes(leads)).toEqual(['iniciar-projeto', 'simular-galpao'])
    expect(ids({ filtro: 'todos', usuarioId: AUGUSTO.id, formulario: 'iniciar-projeto' })).toEqual(['THR-00014'])
  })
  it('busca por nome, empresa, cidade, e-mail e telefone, sem acento', () => {
    const busca = (q: string) => ids({ filtro: 'todos', usuarioId: AUGUSTO.id, busca: q })
    expect(busca('rogerio')).toEqual(['THR-00012'])
    expect(busca('GRAOS DO VALE')).toEqual(['THR-00011'])
    expect(busca('anapolis')).toEqual(['THR-00012'])
    expect(busca('helena@barroslog')).toEqual(['THR-00013'])
    expect(busca('90000-0114')).toEqual(['THR-00014'])
    expect(busca('ponte rolante')).toEqual(['THR-00012'])
    expect(busca('nada que exista')).toEqual([])
    expect(busca('centro de distribuição')).toEqual(['THR-00013'])
  })
  it('resumo: os números dos indicadores', () => {
    expect(resumoLeads(leads)).toEqual({ abertos: 4, aguardando: 2, atrasados: 1, vencendo: 0, respondidosNoPrazo: 1, respondidosForaDoPrazo: 1, encerradosSemResposta: 0, semResponsavel: 0 })
  })
  it('conversa encerrada sem contato realizado aparece como encerrada sem resposta, nunca como atendida', () => {
    const fechada: InboxThread = { ...leads.find((l) => l.thread.id === 'THR-00012')!.thread, status: 'FECHADA' }
    const l = leadDoSite(fechada, undefined, ds.mensagens, AGORA)
    expect(l.situacao).toBe('encerrada_sem_resposta')
    expect(resumoLeads([l]).encerradosSemResposta).toBe(1)
    expect(proximaAcao(l).codigo).toBe('nenhuma')
  })
})

describe('próxima ação e histórico', () => {
  const ds = seedInbox(AGORA)
  const leads = leadsDoSite(ds, AUGUSTO, AGORA)
  const lead = (id: string) => leads.find((l) => l.thread.id === id)!

  it('diz o que fazer agora em cada situação', () => {
    expect(proximaAcao(lead('THR-00011'))).toMatchObject({ codigo: 'primeiro_contato', urgente: false })
    expect(proximaAcao(lead('THR-00012'))).toMatchObject({ codigo: 'primeiro_contato_vencido', urgente: true })
    expect(proximaAcao(lead('THR-00012')).texto).toContain('1 tentativa sem sucesso')
    expect(proximaAcao(lead('THR-00013')).codigo).toBe('aguardar_cliente')
    expect(proximaAcao(lead('THR-00014')).codigo).toBe('dar_sequencia')
    const semDono = leadDoSite({ ...lead('THR-00011').thread, responsavelId: undefined }, undefined, ds.mensagens, AGORA)
    expect(proximaAcao(semDono).codigo).toBe('assumir')
  })
  it('o histórico separa solicitação, tentativa, contato realizado, rascunho e movimentos', () => {
    const h13 = historicoDoLead('THR-00013', ds.mensagens, ds.eventos)
    expect(h13.map((i) => i.tipo)).toEqual(expect.arrayContaining(['solicitacao', 'contato_realizado', 'rascunho', 'movimento']))
    expect(historicoDoLead('THR-00012', ds.mensagens, ds.eventos).find((i) => i.tipo === 'tentativa')).toMatchObject({ meio: 'telefone', cumpreSla: false })
  })
  it('só contato realizado cumpre o SLA; rascunho, nota, tentativa e movimento não', () => {
    for (const t of ['THR-00011', 'THR-00012', 'THR-00013', 'THR-00014']) {
      for (const i of historicoDoLead(t, ds.mensagens, ds.eventos)) expect(i.cumpreSla).toBe(i.tipo === 'contato_realizado' || i.tipo === 'resposta_enviada')
    }
    expect(historicoDoLead('THR-00013', ds.mensagens, ds.eventos).find((i) => i.tipo === 'rascunho')?.texto).toContain(MARCA_RASCUNHO_EMAIL)
  })
  it('do mais recente para o mais antigo, e só da conversa pedida', () => {
    const h = historicoDoLead('THR-00013', ds.mensagens, ds.eventos)
    for (let i = 1; i < h.length; i += 1) expect(Date.parse(h[i - 1].em)).toBeGreaterThanOrEqual(Date.parse(h[i].em))
    expect(h[h.length - 1].tipo === 'solicitacao' || h[h.length - 1].tipo === 'movimento').toBe(true)
    expect(historicoDoLead('THR-NAO-EXISTE', ds.mensagens, ds.eventos)).toEqual([])
  })
  it('contato declarado depois guarda o instante do fato e o do registro', () => {
    const c = historicoDoLead('THR-00013', ds.mensagens, ds.eventos).find((i) => i.tipo === 'contato_realizado')!
    expect(c.registradoEm).toBeDefined()
    expect(Date.parse(c.registradoEm!)).toBeGreaterThan(Date.parse(c.em))
  })
})

describe('meios de contato e rascunho de e-mail', () => {
  const ds = seedInbox(AGORA)
  const l = leadsDoSite(ds, AUGUSTO, AGORA).find((x) => x.thread.id === 'THR-00011')!

  it('monta tel:, WhatsApp e mailto: a partir do lead', () => {
    expect(linksDeContato(l)).toEqual({ telefone: 'tel:+5564900000111', whatsapp: 'https://wa.me/5564900000111', email: 'mailto:marina@graosdovale.exemplo' })
  })
  it('mailto leva assunto e corpo codificados', () => {
    const m = linksDeContato(l, { assunto: 'Olá & bem-vinda', corpo: 'linha 1\nlinha 2' }).email!
    expect(m).toBe('mailto:marina@graosdovale.exemplo?subject=Ol%C3%A1%20%26%20bem-vinda&body=linha%201%0Alinha%202')
  })
  it('telefone inválido não vira atalho', () => {
    expect(linksDeContato({ email: undefined, telefoneE164: undefined })).toEqual({})
    const semFone = leadDoSite(l.thread, { ...l.contato!, identidades: l.contato!.identidades.filter((i) => i.canal === 'PORTAL') },
      [{ ...ds.mensagens.find((m) => m.threadId === l.thread.id)!, texto: textoDaMensagem({ nome: 'Marina Teixeira', email: 'marina@graosdovale.exemplo', telefone: '123' }) }], AGORA)
    expect(semFone.telefone).toBe('123')
    expect(semFone.telefoneE164).toBeUndefined()
    expect(linksDeContato(semFone).telefone).toBeUndefined()
  })
  it('a sugestão de e-mail cumprimenta pelo primeiro nome e cita o pedido, sem prometer nada', () => {
    const s = sugestaoDeEmail(l)
    expect(s.corpo.startsWith('Olá, Marina.')).toBe(true)
    expect(s.corpo).toContain('Galpão de armazenagem 25 x 80 m')
    // quem assina é corpoComAssinatura (a mesma do envio pelo servidor): a sugestão não assina, para não duplicar
    expect(s.corpo).not.toMatch(/EIFF|Atenciosamente/)
    expect(corpoComAssinatura(s.corpo, 'Augusto Macedo').endsWith('\n\nAugusto Macedo\nEIFF')).toBe(true)
    expect(s.corpo).not.toMatch(/R\$|prazo de|garant/i)
  })
  it('valida o rascunho e escreve o texto que vai para a conversa dizendo que NÃO foi enviado', () => {
    expect(validarRascunhoDeEmail({ para: '', assunto: '', corpo: ' ' }).length).toBe(3)
    const r = { para: l.email!, assunto: ' Proposta ', corpo: ' Olá. ' }
    expect(validarRascunhoDeEmail(r)).toEqual([])
    expect(textoDoRascunhoDeEmail(r)).toBe(`${MARCA_RASCUNHO_EMAIL}\nPara: marina@graosdovale.exemplo\nAssunto: Proposta\n\nOlá.`)
  })
})

describe('histórico: o e-mail comercial aparece com o que ele é', () => {
  const base: Omit<InboxMessage, 'id'> = { threadId: 'T', provider: 'GOOGLE_WORKSPACE', direcao: 'outbound', tipo: 'texto', autor: { tipo: 'usuario', nome: 'Ana' }, texto: 'Assunto: x', anexos: [], em: '2026-11-11T18:00:00.000Z' }
  const item = (entrega: InboxMessage['entrega'], estado: string) => historicoDoLead('T', [{ ...base, id: 'm', entrega, meta: { entregaId: 'e', entregaEstado: estado } }], [])[0]
  it('enviado conta como resposta; preparado é rascunho; falha e sem confirmação têm nome próprio e não contam', () => {
    expect(item('enviada', 'ACCEPTED')).toMatchObject({ tipo: 'resposta_enviada', cumpreSla: true })
    expect(item('registrada', 'READY')).toMatchObject({ tipo: 'rascunho', cumpreSla: false })
    expect(item('falhou', 'FAILED')).toMatchObject({ tipo: 'email_nao_enviado', cumpreSla: false })
    expect(item('registrada', 'UNKNOWN')).toMatchObject({ tipo: 'email_sem_confirmacao', cumpreSla: false })
    expect(item('registrada', 'REQUESTED')).toMatchObject({ tipo: 'email_sem_confirmacao', cumpreSla: false })
  })
})
