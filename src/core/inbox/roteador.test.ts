// EIFF Inbox — Octopus Router (fase 3): o pipeline deterministico, a confianca, a politica de automacao, a reavaliacao
// e o override humano. Tudo puro: nenhum teste aqui toca store, banco ou IA real.
import { describe, expect, it } from 'vitest';
import {
  AUTO_ROTEAMENTO_PADRAO, CATALOGO_INTENCOES, CONFIGURACAO_PADRAO, VERSAO_OCTOPUS, alvoDaDecisao, analisarMensagem, bandaDe, cadeiaEscalacao, decidirAutomacao, decidirRoteamento,
  detectarEntidades, detectarIntencao, modoMaisRestritivo, reavaliar, resumoParaHumano, seedInbox,
  type Classificacao, type DecisaoOctopus, type EntradaRoteador, type InboxDataset, type InboxMessage, type InboxThread,
} from './index';

const AGORA = '2026-09-23T12:00:00.000Z';
const OBRA = 'OB-SF-CL-01';
const usuarios = ['u-augusto', 'u-admin', 'u-fin', 'u-obra', 'u-eng', 'u-compras', 'u-contab', 'u-audit'].map((id) => ({ id, ativo: true }));
const obras = [{ codigo: OBRA, nome: 'Smart Fit - Avenida César Lattes', responsavelId: 'u-obra', emExecucao: true }];

function threadDe(inbox: InboxDataset, contatoId: string, texto: string, extra: Partial<InboxThread> = {}): { inbox: InboxDataset; thread: InboxThread; mensagem: InboxMessage } {
  const thread: InboxThread = { id: 'THR-T', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId, assunto: texto.slice(0, 80), status: 'NOVA', prioridade: 'Normal', nivel: 'C', participantes: [], labels: [], abertaEm: AGORA, ultimaMensagemEm: AGORA, ultimaInboundEm: AGORA, origem: 'MANUAL', ...extra };
  const mensagem: InboxMessage = { id: 'MSG-T', threadId: thread.id, provider: 'MANUAL', direcao: 'inbound', tipo: 'texto', autor: { tipo: 'contato', id: contatoId, nome: 'x' }, texto, anexos: [], em: AGORA };
  return { inbox: { ...inbox, threads: [...inbox.threads, thread], mensagens: [...inbox.mensagens, mensagem] }, thread, mensagem };
}
const rotear = (inbox: InboxDataset, contatoId: string, texto: string, extra: Partial<InboxThread> = {}, ia?: Classificacao): DecisaoOctopus => {
  const t = threadDe(inbox, contatoId, texto, extra);
  const e: EntradaRoteador = { inbox: t.inbox, thread: t.thread, mensagem: t.mensagem, obras, usuarios, classificacaoIa: ia, agora: AGORA };
  return decidirRoteamento(e);
};
const semRegras = (inbox: InboxDataset): InboxDataset => ({ ...inbox, configuracao: { ...inbox.configuracao, regrasRoteamento: [] } });
const ia = (parcial: Partial<Classificacao>): Classificacao => ({ intencao: 'x', assunto: 'x', entidades: [], prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', confianca: 0.9, sinais: [], evidencias: [], provedor: 'LLM', versao: 't', em: AGORA, ...parcial });

describe('Octopus Router — roteamento deterministico', () => {
  const seed = seedInbox(AGORA);

  it('fornecedor + pagamento → Financeiro, pessoa atribuída, decisão auditável com sinais e versão', () => {
    const d = rotear(seed, 'CTI-00008', 'Bom dia, a NF 1201 já foi paga? Está vencida desde 10/09.');
    expect(d.setorCodigo).toBe('FINANCEIRO'); expect(d.intencao).toBe('consultar_pagamento');
    expect(d.aplicacao).toBe('ATRIBUIR_PESSOA'); expect(d.responsavelId).toBe('u-fin'); expect(d.banda).toBe('HIGH');
    expect(d.versao).toBe(VERSAO_OCTOPUS); expect(d.origem).toBe('DETERMINISTICO'); expect(d.mensagemId).toBe('MSG-T');
    expect(d.sinais.map((s) => s.codigo)).toContain('regra_explicita');
    expect(d.entidades).toEqual(expect.arrayContaining([{ tipo: 'nota_fiscal', valor: 'NF 1201', mensagemId: 'MSG-T' }, { tipo: 'data', valor: '10/09', mensagemId: 'MSG-T' }]));
    expect(d.motivoOperacional.length).toBeLessThanOrEqual(300); for (const s of d.sinais) expect(s.descricao.length).toBeLessThanOrEqual(200);
    expect(d.slaAte > AGORA).toBe(true); expect(d.escalacao[0]).toBe('responsável u-fin'); expect(d.escalacao.at(-1)).toBe('setor de escalação DIRETORIA');
  });

  it('cliente + logística → Obras (regra explícita), equipe única do setor e responsável da obra', () => {
    const d = rotear(seed, 'CTI-00003', 'A carreta com as vigas chega amanhã? Precisamos liberar a descarga na obra.');
    expect(d.setorCodigo).toBe('OBRAS'); expect(d.intencao).toBe('logistica_entrega'); expect(d.equipeId).toBe('EQP-00003');
    expect(d.responsavelId).toBe('u-obra'); expect(d.aplicacao).toBe('ATRIBUIR_PESSOA');
    expect(d.sinais.some((s) => s.codigo === 'obra')).toBe(true);
  });

  it('memória operacional: sem regra, a conversa anterior do contato com a mesma intenção puxa o setor (sinal, não regra)', () => {
    const base = semRegras(seed);
    // CTI-00003 ja teve THR-00003 (revisao_projeto → ENGENHARIA); nova mensagem com a mesma intencao
    const d = rotear(base, 'CTI-00003', 'Podem revisar o projeto da cobertura? Precisamos do desenho até quinta.');
    expect(d.setorCodigo).toBe('ENGENHARIA'); expect(d.sinais.map((s) => s.codigo)).toContain('historico_mesmo_setor');
    // com uma regra explicita apontando para outro setor, a regra vence a memoria
    const comRegra: InboxDataset = { ...base, configuracao: { ...base.configuracao, regrasRoteamento: [{ id: 'X', ordem: 1, condicao: { intencoes: ['revisao_projeto'] }, destino: { setorCodigo: 'COMERCIAL' }, motivo: 'teste', ativa: true }] } };
    expect(rotear(comRegra, 'CTI-00003', 'Podem revisar o projeto da cobertura? Precisamos do desenho até quinta.').setorCodigo).toBe('COMERCIAL');
  });

  it('regra explícita vence a sugestão da IA, e a IA fica registrada como vencida', () => {
    const d = rotear(seed, 'CTI-00008', 'A NF 77 está liberada para pagamento?', {}, ia({ intencao: 'consultar_pagamento', setorRecomendado: 'COMPRAS', confianca: 0.99 }));
    expect(d.setorCodigo).toBe('FINANCEIRO'); expect(d.origem).toBe('HIBRIDO');
    expect(d.sinais.map((s) => s.codigo)).toContain('ia_vencida_pela_regra');
  });

  it('baixa confiança → TRIAGEM (Não atribuídos): sugere, não aplica', () => {
    const d = rotear(semRegras(seed), 'CTI-00007', 'oi tudo bem');
    expect(d.banda).toBe('LOW'); expect(d.aplicacao).toBe('TRIAGEM'); expect(alvoDaDecisao(d)).toBeUndefined();
    expect(d.intencao).toBe('indefinida'); expect(d.fallback).toBe(true); expect(d.setorCodigo).toBe('ADMINISTRATIVO');
    expect(d.automacao.modo).toBe('HUMAN');
    expect(d.motivoOperacional).toMatch(/decisão humana/);
  });

  it('confiança média → só setor/equipe, sem pessoa', () => {
    // sem regras e sem historico, o catalogo decide (piso 0,7): fornecedor desconhecido pedindo endereco
    const d = rotear(semRegras(seed), 'CTI-00007', 'Qual o endereço da fábrica para entregar o material?');
    expect(d.banda).toBe('MEDIUM'); expect(d.aplicacao).toBe('ATRIBUIR_SETOR');
    expect(alvoDaDecisao(d)?.responsavelId).toBeUndefined(); expect(alvoDaDecisao(d)?.setorCodigo).toBeDefined();
  });

  it('IA refina: concordância sobe a confiança; IA sozinha nunca passa de 85% e só decide setor quando nada mais decide', () => {
    const base = semRegras(seed);
    const sem = rotear(base, 'CTI-00007', 'Qual o endereço da fábrica?');
    const com = rotear(base, 'CTI-00007', 'Qual o endereço da fábrica?', {}, ia({ intencao: 'consultar_endereco', setorRecomendado: 'ADMINISTRATIVO' }));
    expect(com.confianca).toBeGreaterThan(sem.confianca); expect(com.origem).toBe('HIBRIDO');
    const soIa = rotear(base, 'CTI-00007', 'zzz', {}, ia({ intencao: 'consultar_horario', setorRecomendado: 'ADMINISTRATIVO', confianca: 0.99 }));
    expect(soIa.origem).toBe('IA'); expect(soIa.confianca).toBeLessThanOrEqual(0.85); expect(soIa.setorCodigo).toBe('ADMINISTRATIVO');
  });

  it('setor inválido/inativo nunca é escolhido: regra para setor inativo é ignorada e IA para setor inexistente cai no fallback', () => {
    const inativo: InboxDataset = { ...semRegras(seed), setores: seed.setores.map((s) => (s.codigo === 'FINANCEIRO' ? { ...s, ativo: false } : s)), configuracao: { ...seed.configuracao, regrasRoteamento: [{ id: 'X', ordem: 1, condicao: { intencoes: ['consultar_pagamento'] }, destino: { setorCodigo: 'FINANCEIRO' }, motivo: 't', ativa: true }] } };
    const d = rotear(inativo, 'CTI-00008', 'A NF 10 foi paga?', {}, ia({ intencao: 'consultar_pagamento', setorRecomendado: 'INEXISTENTE' }));
    expect(d.setorCodigo).not.toBe('FINANCEIRO'); expect(d.setorCodigo).not.toBe('INEXISTENTE');
    expect(seedInbox(AGORA).setores.some((s) => s.codigo === d.setorCodigo && s.ativo)).toBe(true);
  });

  it('equipe pertence ao setor e responsável fica no contexto permitido (membro ativo do setor ou padrão)', () => {
    // regra manda para COMPRAS com equipe de OBRAS e responsavel de fora do setor: ambos ignorados
    const cfg: InboxDataset = { ...seed, configuracao: { ...seed.configuracao, regrasRoteamento: [{ id: 'X', ordem: 1, condicao: { intencoes: ['compra_insumo'] }, destino: { setorCodigo: 'COMPRAS', equipeId: 'EQP-00003', responsavelId: 'u-fin' }, motivo: 't', ativa: true }] } };
    const d = rotear(cfg, 'CTI-00001', 'Temos disponibilidade de chapa 3/8 para fornecimento imediato do pedido 55.');
    expect(d.setorCodigo).toBe('COMPRAS'); expect(d.equipeId).toBeUndefined(); expect(d.responsavelId).toBe('u-compras');
    expect(d.sinais.map((s) => s.codigo)).toContain('responsavel_da_regra_invalido');
    // usuario inativo nunca e escolhido
    const t = threadDe(cfg, 'CTI-00001', 'Temos disponibilidade de chapa 3/8 para fornecimento imediato.');
    const d2 = decidirRoteamento({ inbox: t.inbox, thread: t.thread, mensagem: t.mensagem, obras, usuarios: usuarios.map((u) => (u.id === 'u-compras' ? { ...u, ativo: false } : u)), agora: AGORA });
    expect(d2.responsavelId).toBeUndefined(); expect(d2.aplicacao).toBe('ATRIBUIR_SETOR');
  });

  it('prioridade só sobe: jurídico/urgência/reaberta/IA elevam; nunca rebaixa a da thread', () => {
    const d = rotear(seed, 'CTI-00009', 'Encaminhamos notificação extrajudicial sobre o reajuste. Urgente.');
    expect(d.prioridade).toBe('Alta'); expect(d.urgente).toBe(true); expect(d.setorCodigo).toBe('JURIDICO'); expect(d.automacao.modo).toBe('HUMAN'); expect(d.automacao.risco).toBe('ALTO');
    const alta = rotear(seed, 'CTI-00008', 'Qual o endereço?', { prioridade: 'Urgente' });
    expect(alta.prioridade).toBe('Urgente');
    const reab = rotear(seed, 'CTI-00008', 'Qual o endereço?', { status: 'EM_ATENDIMENTO', resolvidaEm: AGORA });
    expect(reab.prioridade).toBe('Alta'); expect(reab.sinais.map((s) => s.codigo)).toContain('reaberta');
  });

  it('bandas vêm dos limiares configurados; mudar os cortes muda a aplicação sem mudar a decisão', () => {
    expect(bandaDe(0.9, AUTO_ROTEAMENTO_PADRAO)).toBe('HIGH'); expect(bandaDe(0.7, AUTO_ROTEAMENTO_PADRAO)).toBe('MEDIUM'); expect(bandaDe(0.5, AUTO_ROTEAMENTO_PADRAO)).toBe('LOW');
    const rigido: InboxDataset = { ...seed, configuracao: { ...seed.configuracao, autoRoteamento: { ...AUTO_ROTEAMENTO_PADRAO, confiancaAtribuirPessoa: 0.99 } } };
    const d = rotear(rigido, 'CTI-00008', 'A NF 1201 já foi paga?');
    expect(d.setorCodigo).toBe('FINANCEIRO'); expect(d.aplicacao).toBe('ATRIBUIR_SETOR'); expect(d.responsavelId).toBeUndefined();
  });

  it('a decisão não guarda raciocínio: sinais curtos, no máximo 24, motivo em uma frase', () => {
    const d = rotear(seed, 'CTI-00003', 'A carreta chega amanhã com as vigas do projeto R02, precisamos revisar o cronograma e o pagamento da NF 5.');
    expect(d.sinais.length).toBeLessThanOrEqual(24); expect(d.motivoOperacional.split('\n')).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/[0-9]{9,}/);
  });
});

describe('Octopus Router — passos isolados', () => {
  it('analisarMensagem e detectarIntencao: catálogo, empate e IA desempata só com confiança ≥ 0,8', () => {
    const a = analisarMensagem({ texto: 'URGENTE: o pagamento da NF 9 e a entrega da carga', anexos: [] }, 'x');
    expect(a.urgente).toBe(true);
    const i = detectarIntencao(a);
    expect(['consultar_pagamento', 'logistica_entrega']).toContain(i.intencao); expect(i.sinais.map((s) => s.codigo)).toContain('intencao_ambigua');
    const desempate = detectarIntencao(a, ia({ intencao: i.intencao === 'consultar_pagamento' ? 'logistica_entrega' : 'consultar_pagamento', confianca: 0.9 }));
    expect(desempate.intencao).not.toBe(i.intencao); expect(desempate.origem).toBe('catalogo+ia');
    const fraca = detectarIntencao(a, ia({ intencao: i.intencao === 'consultar_pagamento' ? 'logistica_entrega' : 'consultar_pagamento', confianca: 0.6 }));
    expect(fraca.intencao).toBe(i.intencao);
    expect(CATALOGO_INTENCOES.every((c) => c.palavras.length > 0 && c.setorPadrao)).toBe(true);
  });
  it('detectarEntidades: NF, pedido, medição, valor, data, obra por código e por nome; IA acrescenta sem duplicar', () => {
    const e = detectarEntidades('NF 583 do pedido 12, medição 03, R$ 1.250,00 até 30/09 na Smart Fit (OB-SF-CL-01)', 'M', obras, ia({ entidades: [{ tipo: 'nota_fiscal', valor: 'nf 583' }, { tipo: 'pessoa', valor: 'Renata' }] }));
    const por = (t: string) => e.filter((x) => x.tipo === t).map((x) => x.valor);
    expect(por('nota_fiscal')).toEqual(['NF 583']); expect(por('pedido')).toEqual(['pedido 12']); expect(por('medicao')).toEqual(['medição 03']);
    expect(por('valor')).toEqual(['R$ 1.250,00']); expect(por('data')).toEqual(['30/09']); expect(por('obra')).toEqual([OBRA]); expect(por('pessoa')).toEqual(['Renata']);
  });
  it('cadeia de escalação: pessoa → equipe → gestor → setor → escalação; no setor de escalação a cadeia termina nele', () => {
    const seed = seedInbox(AGORA);
    const c = cadeiaEscalacao('OBRAS', 'EQP-00003', 'u-eng', { membros: seed.membros, equipesAtivas: seed.equipes, config: seed.configuracao });
    expect(c).toEqual(['responsável u-eng', 'equipe Canteiro Smart Fit', 'gestor de OBRAS (u-obra)', 'setor OBRAS', 'setor de escalação DIRETORIA']);
    expect(cadeiaEscalacao('DIRETORIA', undefined, undefined, { membros: seed.membros, equipesAtivas: seed.equipes, config: seed.configuracao }).at(-1)).toBe('setor DIRETORIA');
  });
  it('resumo para humano: quem, o quê, por que aqui, automação, prioridade — sem telefone', () => {
    const seed = seedInbox(AGORA);
    const d = rotear(seed, 'CTI-00001', 'A NF 583 já está liberada?');
    const r = resumoParaHumano(d, seed.contatos.find((c) => c.id === 'CTI-00001'), 'Financeiro');
    expect(r).toMatch(/Paulo Nogueira/); expect(r).toMatch(/Financeiro/); expect(r).toMatch(/automação/); expect(r).not.toMatch(/[0-9]{9,}/);
  });
});

describe('Octopus Router — política de automação (AUTO / APPROVAL / HUMAN)', () => {
  const regras = CONFIGURACAO_PADRAO.regrasAutomacao;
  const base = { regras, contexto: 'EXTERNAL' as const, confianca: 0.9, confiancaMinima: 0.6, modoPadrao: 'APPROVAL' as const, contato: { tipoRelacao: 'fornecedor' as const, identidades: [] } };
  it('regra decide o modo (AUT-01 humano, AUT-02 auto, AUT-03 aprovação) com risco, motivo e ações permitidas', () => {
    expect(decidirAutomacao({ ...base, intencao: 'juridico', nivel: 'A' })).toMatchObject({ modo: 'HUMAN', risco: 'ALTO', regraId: 'AUT-01', acoesPermitidas: ['consultar_sistema'] });
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'C' })).toMatchObject({ modo: 'AUTO', regraId: 'AUT-02', acoesPermitidas: ['responder', 'consultar_sistema'] });
    expect(decidirAutomacao({ ...base, intencao: 'consultar_pagamento', nivel: 'A' })).toMatchObject({ modo: 'APPROVAL', regraId: 'AUT-03', risco: 'MEDIO' });
  });
  it('sem regra o nível decide (A→AUTO, B→APPROVAL, C→HUMAN); intenção indefinida usa o padrão apertado pelo nível', () => {
    expect(decidirAutomacao({ ...base, intencao: 'apontamento_campo', nivel: 'A' }).modo).toBe('AUTO');
    expect(decidirAutomacao({ ...base, intencao: 'apontamento_campo', nivel: 'B' }).modo).toBe('APPROVAL');
    expect(decidirAutomacao({ ...base, intencao: 'apontamento_campo', nivel: 'C' }).modo).toBe('HUMAN');
    expect(decidirAutomacao({ ...base, intencao: 'indefinida', nivel: 'A', modoPadrao: 'APPROVAL' }).modo).toBe('APPROVAL');
  });
  it('guardas só apertam: risco alto, confiança baixa, contato desconhecido e interno não verificado', () => {
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'A', riscoBase: 'ALTO' }).modo).toBe('HUMAN');
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'A', confianca: 0.5 })).toMatchObject({ modo: 'HUMAN' });
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'A', contato: { tipoRelacao: 'desconhecido', identidades: [] } }).modo).toBe('APPROVAL');
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'A', contexto: 'INTERNAL', contato: { tipoRelacao: 'colaborador', identidades: [{ canal: 'WHATSAPP', identificador: '1', verificada: false }] } }).modo).toBe('APPROVAL');
    expect(decidirAutomacao({ ...base, intencao: 'consultar_endereco', nivel: 'A', contexto: 'INTERNAL', contato: { tipoRelacao: 'colaborador', identidades: [{ canal: 'WHATSAPP', identificador: '1', verificada: true }] } }).modo).toBe('AUTO');
    expect(modoMaisRestritivo('AUTO', 'HUMAN')).toBe('HUMAN'); expect(modoMaisRestritivo('APPROVAL', 'AUTO')).toBe('APPROVAL');
  });
});

describe('Octopus Router — reavaliação e override humano', () => {
  const seed = seedInbox(AGORA);
  const auto = { ...AUTO_ROTEAMENTO_PADRAO, transferenciaAutomatica: true, confiancaTransferir: 0.85 };
  const nova = (setor: string, conf: number, aplicacao: DecisaoOctopus['aplicacao'] = 'ATRIBUIR_SETOR'): DecisaoOctopus => ({ ...rotear(seed, 'CTI-00001', 'x'), setorCodigo: setor, confianca: conf, aplicacao, em: AGORA });
  const t1 = seed.threads.find((t) => t.id === 'THR-00001')!; // FINANCEIRO, responsavel u-fin
  it('mesmo setor mantém; setor diferente com pessoa atendendo recomenda (não move); sem pessoa e confiança alta transfere sozinho só com a opção ligada', () => {
    expect(reavaliar(t1, nova('FINANCEIRO', 0.95), auto).veredicto).toBe('KEEP');
    expect(reavaliar(t1, nova('OBRAS', 0.95), auto).veredicto).toBe('RECOMMEND_TRANSFER');
    const semPessoa = { ...t1, responsavelId: undefined };
    expect(reavaliar(semPessoa, nova('OBRAS', 0.95), auto).veredicto).toBe('AUTO_TRANSFER');
    expect(reavaliar(semPessoa, nova('OBRAS', 0.95), AUTO_ROTEAMENTO_PADRAO).veredicto).toBe('RECOMMEND_TRANSFER');
    expect(reavaliar(semPessoa, nova('OBRAS', 0.7), auto).veredicto).toBe('RECOMMEND_TRANSFER');
    expect(reavaliar(semPessoa, nova('OBRAS', 0.5, 'TRIAGEM'), auto).veredicto).toBe('KEEP');
  });
  it('override humano registrado nunca é sobrescrito pela reavaliação', () => {
    const comOverride: InboxThread = { ...t1, responsavelId: undefined, roteamento: { ...nova('FINANCEIRO', 0.9), override: { por: 'u-fin', em: AGORA, de: { setorCodigo: 'OBRAS' }, para: { setorCodigo: 'FINANCEIRO' }, motivo: 'é conosco' } } };
    const r = reavaliar(comOverride, nova('OBRAS', 0.99), auto);
    expect(r.veredicto).toBe('KEEP'); expect(r.motivo).toMatch(/override humano de u-fin/);
    // e a decisao nova carrega o override adiante
    const t = threadDe(seed, 'CTI-00001', 'entrega da carga', { roteamento: comOverride.roteamento });
    expect(decidirRoteamento({ inbox: t.inbox, thread: t.thread, mensagem: t.mensagem, obras, usuarios, agora: AGORA }).override?.por).toBe('u-fin');
  });
});
