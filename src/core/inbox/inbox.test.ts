// EIFF Inbox — regras do dominio puro: maquina de estados, roteamento, politica de nivel, SLA, visibilidade, caixas,
// gateway idempotente e fronteiras fail-closed. Nenhuma rede, nenhuma IA, nenhum efeito externo.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATRIZ, pode } from '../permissoes';
import type { Usuario } from '../types';
import {
  CONFIGURACAO_PADRAO, EXECUCAO_FACTORY_RESERVADA, EXECUCAO_MANUAL, FACTORY_INDISPONIVEL, PROVEDOR_MANUAL, SEM_INTELIGENCIA, SETORES_PADRAO, STATUS_THREAD, TRANSICOES_THREAD,
  aoReceberMensagem, aoResponder, aplicarStatus, caixasVirtuais, classificacaoAuditavel, deEventoCentral, escalacoesPendentes, estadoSla, identificadorMascarado, inboxVazio,
  nivelMaisRestritivo, nivelPara, ordenarParaTrabalho, provedorExecucao, receberMensagem, resumoExecutivo, rotear, seedInbox, statusAposAtribuicao, threadVisivel,
  threadsDaCaixa, triagemHumana, validarTransicao, visibilidadeDe, classificarSeguro, eventoDaTransicao, normalizarIdentificador, podeAtribuir, podeMudarStatus, recorteDe, threadDoContato,
  type Classificacao, type InboxJob, type InboxThread, type IntelligenceProvider, type MensagemRecebida, type Relogio,
} from './index';

const AGORA = '2026-09-23T12:00:00.000Z';
const usuario = (id: string, papel: Usuario['papel']): Usuario => ({ id, nome: id, email: `${id}@x`, papel, obras: '*', ativo: true });
const thread = (p: Partial<InboxThread> = {}): InboxThread => ({
  id: 'THR-1', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-1', assunto: 'teste', status: 'NOVA', prioridade: 'Normal', nivel: 'C', participantes: [], labels: [],
  abertaEm: '2026-09-23T10:00:00.000Z', ultimaMensagemEm: '2026-09-23T10:00:00.000Z', origem: 'MANUAL', ...p,
});
const classif = (p: Partial<Classificacao> = {}): Classificacao => ({ intencao: 'consultar_pagamento', assunto: 'NF', entidades: [], prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', confianca: 0.9, sinais: ['x'], evidencias: [], provedor: 'HUMANO', versao: 't', em: AGORA, ...p });
function relogio(): Relogio { let n = 0; return { agora: AGORA, novoId: (p) => `${p}-T${String(++n).padStart(3, '0')}` }; }
const recebida = (p: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ canal: 'WHATSAPP', provider: 'META_CLOUD', contexto: 'EXTERNAL', identidade: { canal: 'WHATSAPP', identificador: '5562900000001', nomeInformado: 'Zé', verificada: false }, externalMessageId: 'wamid.1', texto: 'olá', tipo: 'texto', em: AGORA, ...p });

describe('máquina de estados da thread', () => {
  it('todo estado tem transições e só FECHADA é terminal (e ainda reabre)', () => {
    for (const s of STATUS_THREAD) expect(TRANSICOES_THREAD[s].length, s).toBeGreaterThan(0);
    expect(TRANSICOES_THREAD.FECHADA).toEqual(['EM_ATENDIMENTO']);
  });
  it('NOVA não vai direto para EM_ATENDIMENTO nem para espera; ATRIBUIDA exige responsável', () => {
    expect(validarTransicao(thread(), 'EM_ATENDIMENTO').ok).toBe(false);
    expect(validarTransicao(thread(), 'AGUARDANDO_CONTATO').ok).toBe(false);
    expect(validarTransicao(thread(), 'ATRIBUIDA').ok).toBe(false);
    expect(validarTransicao(thread({ responsavelId: 'u1' }), 'ATRIBUIDA').ok).toBe(true);
  });
  it('espera exige responsável; resolver exige responsável salvo nível A', () => {
    expect(validarTransicao(thread({ status: 'EM_ATENDIMENTO' }), 'AGUARDANDO_CONTATO').motivo).toMatch(/responsável/);
    expect(validarTransicao(thread({ status: 'TRIADA' }), 'RESOLVIDA').ok).toBe(false);
    expect(validarTransicao(thread({ status: 'TRIADA', nivel: 'A' }), 'RESOLVIDA').ok).toBe(true);
  });
  it('reabrir e fechar sem resolver exigem motivo', () => {
    expect(validarTransicao(thread({ status: 'RESOLVIDA' }), 'EM_ATENDIMENTO').ok).toBe(false);
    expect(validarTransicao(thread({ status: 'RESOLVIDA' }), 'EM_ATENDIMENTO', { motivo: 'cliente voltou' }).ok).toBe(true);
    expect(validarTransicao(thread({ status: 'EM_ATENDIMENTO', responsavelId: 'u1' }), 'FECHADA').ok).toBe(false);
    expect(validarTransicao(thread({ status: 'RESOLVIDA' }), 'FECHADA').ok).toBe(true);
  });
  it('aplicarStatus mantém marcas de tempo coerentes', () => {
    const r = aplicarStatus(thread({ status: 'EM_ATENDIMENTO', responsavelId: 'u1' }), 'RESOLVIDA', AGORA);
    expect(r.resolvidaEm).toBe(AGORA); expect(r.resolvidaPor).toBe('humano');
    const f = aplicarStatus(r, 'FECHADA', AGORA); expect(f.fechadaEm).toBe(AGORA);
    const re = aplicarStatus(f, 'EM_ATENDIMENTO', AGORA); expect(re.resolvidaEm).toBeUndefined(); expect(re.fechadaEm).toBeUndefined(); expect(re.resolvidaPor).toBeUndefined();
    expect(aplicarStatus(thread({ status: 'TRIADA', nivel: 'A' }), 'RESOLVIDA', AGORA).resolvidaPor).toBe('ia');
  });
  it('status deriva da atribuição sem regredir quem já atende', () => {
    expect(statusAposAtribuicao(thread(), 'FINANCEIRO', undefined)).toBe('TRIADA');
    expect(statusAposAtribuicao(thread(), 'FINANCEIRO', 'u1')).toBe('ATRIBUIDA');
    expect(statusAposAtribuicao(thread({ status: 'ATRIBUIDA', responsavelId: 'u1' }), 'FINANCEIRO', undefined)).toBe('TRIADA');
    expect(statusAposAtribuicao(thread({ status: 'EM_ATENDIMENTO', responsavelId: 'u1' }), 'OBRAS', 'u2')).toBe('EM_ATENDIMENTO');
  });
  it('mensagem do contato reabre o que esperava por ele; resposta da EIFF cumpre o SLA', () => {
    expect(aoReceberMensagem(thread({ status: 'AGUARDANDO_CONTATO', responsavelId: 'u1' }), AGORA).status).toBe('EM_ATENDIMENTO');
    expect(aoReceberMensagem(thread({ status: 'FECHADA' }), AGORA).status).toBe('EM_ATENDIMENTO');
    expect(aoReceberMensagem(thread({ status: 'EM_ATENDIMENTO' }), AGORA).status).toBe('EM_ATENDIMENTO');
    const r = aoResponder(thread({ status: 'ATRIBUIDA', responsavelId: 'u1', sla: { primeiraRespostaAte: '2026-09-24T10:00:00.000Z' } }), AGORA);
    expect(r.status).toBe('EM_ATENDIMENTO'); expect(r.sla?.primeiraRespostaEm).toBe(AGORA);
  });
});

describe('roteamento e política IA + humano', () => {
  const setores = SETORES_PADRAO.map((s) => (s.codigo === 'FINANCEIRO' ? { ...s, responsavelPadraoId: 'u-fin' } : s));
  it('a primeira regra por ordem decide setor, responsável padrão e nível, com motivos', () => {
    const d = rotear({ thread: thread(), classificacao: classif(), setores, config: CONFIGURACAO_PADRAO });
    expect(d.setorCodigo).toBe('FINANCEIRO'); expect(d.responsavelId).toBe('u-fin'); expect(d.nivel).toBe('B'); expect(d.regraRoteamentoId).toBe('ROT-02'); expect(d.fallback).toBe(false);
    expect(d.motivos.join(' ')).toMatch(/ROT-02/); expect(d.motivos.join(' ')).toMatch(/responsável padrão/);
  });
  it('sem regra e sem recomendação cai no fallback; setor sem responsável fica não atribuído', () => {
    const d = rotear({ thread: thread(), classificacao: classif({ intencao: 'nada_a_ver' }), setores, config: CONFIGURACAO_PADRAO });
    expect(d.setorCodigo).toBe(CONFIGURACAO_PADRAO.setorFallback); expect(d.fallback).toBe(true); expect(d.responsavelId).toBeUndefined();
  });
  it('recomendação da classificação vale quando nenhuma regra casa, mas nunca sobre uma regra', () => {
    const d = rotear({ thread: thread(), classificacao: classif({ intencao: 'nada', setorRecomendado: 'OBRAS' }), setores, config: CONFIGURACAO_PADRAO });
    expect(d.setorCodigo).toBe('OBRAS');
    const e = rotear({ thread: thread(), classificacao: classif({ intencao: 'juridico', setorRecomendado: 'OBRAS' }), setores, config: CONFIGURACAO_PADRAO });
    expect(e.setorCodigo).toBe('JURIDICO'); expect(e.nivel).toBe('C'); expect(e.prioridade).toBe('Alta');
  });
  it('prioridade só sobe (regra e classificação), nunca desce', () => {
    const d = rotear({ thread: thread({ prioridade: 'Urgente' }), classificacao: classif({ prioridadeRecomendada: 'Baixa' }), setores, config: CONFIGURACAO_PADRAO });
    expect(d.prioridade).toBe('Urgente');
  });
  it('sem classificação o nível é C; sem regra é o padrão; A nunca vem por conveniência', () => {
    expect(nivelPara(CONFIGURACAO_PADRAO, undefined, 'OBRAS', undefined).nivel).toBe('C');
    expect(nivelPara(CONFIGURACAO_PADRAO, classif({ intencao: 'qualquer' }), 'OBRAS', undefined).nivel).toBe(CONFIGURACAO_PADRAO.nivelPadrao);
    expect(nivelPara(CONFIGURACAO_PADRAO, classif({ intencao: 'consultar_endereco' }), 'OBRAS', undefined).nivel).toBe('A');
    expect(nivelMaisRestritivo('A', 'C')).toBe('C'); expect(nivelMaisRestritivo('B', 'A')).toBe('B');
  });
  it('regra de roteamento que aponta para setor inativo é ignorada', () => {
    const inativos = setores.map((s) => (s.codigo === 'FINANCEIRO' ? { ...s, ativo: false } : s));
    const d = rotear({ thread: thread(), classificacao: classif(), setores: inativos, config: CONFIGURACAO_PADRAO });
    expect(d.setorCodigo).not.toBe('FINANCEIRO');
  });
});

describe('SLA, escalação e ordem de trabalho', () => {
  const sla = (ate: string, em?: string) => ({ primeiraRespostaAte: ate, primeiraRespostaEm: em });
  it('estado do SLA: no prazo, vencendo (<25% restante), vencido, cumprido', () => {
    expect(estadoSla(thread({ sla: sla('2026-09-24T10:00:00.000Z') }), AGORA)).toBe('no_prazo');
    expect(estadoSla(thread({ sla: sla('2026-09-23T12:30:00.000Z') }), AGORA)).toBe('vencendo');
    expect(estadoSla(thread({ sla: sla('2026-09-23T11:00:00.000Z') }), AGORA)).toBe('vencido');
    expect(estadoSla(thread({ sla: sla('2026-09-23T11:00:00.000Z', '2026-09-23T10:30:00.000Z') }), AGORA)).toBe('cumprido');
    expect(estadoSla(thread(), AGORA)).toBe('sem_sla');
  });
  it('vencido sem resposta escala para o setor de escalação, exceto se já está nele', () => {
    const ts = [thread({ id: 'a', setorCodigo: 'OBRAS', sla: sla('2026-09-23T11:00:00.000Z') }), thread({ id: 'b', setorCodigo: 'DIRETORIA', sla: sla('2026-09-23T11:00:00.000Z') }), thread({ id: 'c', sla: sla('2026-09-24T11:00:00.000Z') })];
    expect(escalacoesPendentes(ts, CONFIGURACAO_PADRAO, AGORA).map((e) => e.threadId)).toEqual(['a']);
  });
  it('ordem de trabalho: vencido > prioridade > mais antiga; nunca filtra', () => {
    const ts = [
      thread({ id: 'normal-nova', ultimaMensagemEm: '2026-09-23T11:00:00.000Z' }),
      thread({ id: 'urgente', prioridade: 'Urgente', ultimaMensagemEm: '2026-09-23T11:30:00.000Z' }),
      thread({ id: 'vencida', sla: sla('2026-09-23T09:00:00.000Z'), ultimaMensagemEm: '2026-09-23T11:45:00.000Z' }),
      thread({ id: 'normal-antiga', ultimaMensagemEm: '2026-09-23T08:00:00.000Z' }),
    ];
    expect(ordenarParaTrabalho(ts, AGORA).map((t) => t.id)).toEqual(['vencida', 'urgente', 'normal-antiga', 'normal-nova']);
  });
});

describe('visibilidade e caixas virtuais', () => {
  const ds = seedInbox(AGORA);
  it('Administrador e Diretoria veem tudo; atendente vê só o setor, o que é dele e o que ainda não tem setor', () => {
    const dir = visibilidadeDe(usuario('u-augusto', 'Diretoria'), ds.membros); expect(dir.transversal).toBe(true);
    const fin = visibilidadeDe(usuario('u-fin', 'Financeiro'), ds.membros); expect(fin.transversal).toBe(false); expect(fin.setores).toContain('FINANCEIRO'); expect(fin.gestorDe).toContain('FINANCEIRO');
    const daObra = ds.threads.find((t) => t.setorCodigo === 'OBRAS')!;
    expect(threadVisivel(daObra, 'u-fin', fin)).toBe(false);
    expect(threadVisivel({ ...daObra, responsavelId: 'u-fin' }, 'u-fin', fin)).toBe(true);
    expect(threadVisivel({ ...daObra, setorCodigo: undefined }, 'u-fin', fin)).toBe(true);
  });
  it('a permissão da matriz é o portão; a visibilidade é recorte dentro dela', () => {
    expect(MATRIZ.inbox).toContain('Financeiro'); expect(MATRIZ.inbox).not.toContain('Auditoria');
    expect(pode(usuario('x', 'Auditoria'), 'inbox')).toBe(false);
    expect(pode(usuario('x', 'Financeiro'), 'inbox_config')).toBe(false);
    expect(pode(usuario('x', 'Diretoria'), 'inbox_config')).toBe(true);
  });
  it('caixas: precisa de mim, minha, não atribuídos, urgentes, aguardando, automatizados, concluídos, factory e uma por setor', () => {
    const caixas = caixasVirtuais(ds, usuario('u-fin', 'Financeiro'));
    const q = (id: string) => caixas.find((c) => c.id === id)!.quantidade;
    expect(q('minha')).toBe(1); // THR-00001 (ATRIBUIDA); THR-00008 esta RESOLVIDA
    expect(q('precisa_de_mim')).toBe(1);
    expect(q('nao_atribuidos')).toBeGreaterThanOrEqual(1); // THR-00007 sem setor e visivel
    expect(q('automatizados')).toBe(0); // THR-00009 e de FORNECEDORES: fora da visibilidade do Financeiro
    expect(caixas.some((c) => c.id === 'setor:FINANCEIRO')).toBe(true);
    expect(caixas.some((c) => c.id === 'setor:OBRAS')).toBe(false);
    const todas = caixasVirtuais(ds, usuario('u-augusto', 'Diretoria'));
    expect(todas.find((c) => c.id === 'automatizados')!.quantidade).toBe(1);
    expect(todas.find((c) => c.id === 'factory')!.quantidade).toBe(1);
    expect(todas.find((c) => c.id === 'urgentes')!.quantidade).toBe(1);
    expect(todas.find((c) => c.id === 'nao_atribuidos')!.quantidade).toBe(2); // THR-00007 (NOVA) e THR-00010 (JURIDICO sem responsavel)
  });
  it('"precisa de mim" inclui aprovação pendente do meu papel mesmo sem ser o responsável', () => {
    const dir = threadsDaCaixa(ds, usuario('u-augusto', 'Diretoria'), 'precisa_de_mim').map((t) => t.id);
    expect(dir).toContain('THR-00003'); // ACT-00002 aguarda Diretoria
    expect(dir).toContain('THR-00004'); // responsavel u-augusto, ATRIBUIDA
  });
  it('resumo executivo bate com as caixas', () => {
    const r = resumoExecutivo(ds, usuario('u-augusto', 'Diretoria'), AGORA);
    expect(r.urgente).toBe(1); expect(r.iaResolveu).toBe(1); expect(r.aguardandoContato).toBe(1); expect(r.slaVencido).toBe(1); // THR-00010: Alta, 4 h, aberta ha 6 h
    expect(r.precisaDeMim).toBe(2);
  });
});

describe('gateway de entrada (idempotente) e fronteiras', () => {
  it('abre contato desconhecido e thread NOVA; reenvio do provider não duplica nada', () => {
    const r1 = receberMensagem(inboxVazio(), recebida(), relogio());
    expect(r1.novaThread && r1.novoContato && !r1.duplicada).toBe(true);
    expect(r1.contato?.tipoRelacao).toBe('desconhecido'); expect(r1.thread?.status).toBe('NOVA'); expect(r1.thread?.nivel).toBe('C');
    expect(r1.ds.eventos.map((e) => e.tipo)).toEqual(['THREAD_CREATED', 'MESSAGE_RECEIVED']);
    const r2 = receberMensagem(r1.ds, recebida(), relogio());
    expect(r2.duplicada).toBe(true); expect(r2.ds).toBe(r1.ds);
  });
  it('segunda mensagem do mesmo contato entra na mesma thread; contexto INTERNAL cria contato colaborador', () => {
    const r1 = receberMensagem(inboxVazio(), recebida(), relogio());
    const r2 = receberMensagem(r1.ds, recebida({ externalMessageId: 'wamid.2', texto: 'outra' }), relogio());
    expect(r2.novaThread).toBe(false); expect(r2.thread?.id).toBe(r1.thread?.id); expect(r2.ds.mensagens).toHaveLength(2);
    const i = receberMensagem(inboxVazio(), recebida({ contexto: 'INTERNAL' }), relogio());
    expect(i.contato?.tipoRelacao).toBe('colaborador');
  });
  it('mensagem em thread FECHADA reabre e registra o evento de status', () => {
    const r1 = receberMensagem(inboxVazio(), recebida(), relogio());
    const fechada = { ...r1.ds, threads: r1.ds.threads.map((t) => ({ ...t, status: 'FECHADA' as const })) };
    const r2 = receberMensagem(fechada, recebida({ externalMessageId: 'wamid.3' }), relogio());
    expect(r2.thread?.status).toBe('EM_ATENDIMENTO'); expect(r2.reaberta).toBe(true); expect(r2.ds.eventos.some((e) => e.tipo === 'THREAD_REOPENED' && e.depois === 'EM_ATENDIMENTO')).toBe(true);
  });
  it('evento da EIFF Central vira entrada do Inbox; sem contexto, telefone ou id externo é recusado', () => {
    const base = { provider: 'META_CLOUD' as const, externalConversationId: 'c1', externalMessageId: 'm1', direction: 'inbound' as const, eventType: 'MESSAGE_RECEIVED' as const, occurredAt: AGORA, contactPhone: '5562900000001', contexto: 'EXTERNAL' as const };
    const ok = deEventoCentral(base, 'texto'); expect('erro' in ok).toBe(false);
    expect('erro' in deEventoCentral({ ...base, contexto: undefined }, 'x')).toBe(true);
    expect('erro' in deEventoCentral({ ...base, contactPhone: undefined }, 'x')).toBe(true);
    expect('erro' in deEventoCentral({ ...base, externalMessageId: undefined }, 'x')).toBe(true);
    expect('erro' in deEventoCentral({ ...base, eventType: 'MESSAGE_DELIVERED' }, 'x')).toBe(true);
  });
  it('canal MANUAL só registra; inteligência ausente não inventa; Factory reservada recusa', async () => {
    const env = await PROVEDOR_MANUAL.enviar({ thread: thread(), contato: seedInbox(AGORA).contatos[0], texto: 'oi' });
    expect(env.entrega).toBe('registrada'); expect(env.externalMessageId).toBeUndefined();
    const ia = await SEM_INTELIGENCIA.analisar({ thread: thread(), mensagem: seedInbox(AGORA).mensagens[0], historico: [], organizacaoId: 'org', contexto: 'EXTERNAL', setoresDisponiveis: [] });
    expect(ia.ok).toBe(false);
    const job: InboxJob = { id: 'J', threadId: 'T', acaoId: 'A', titulo: 't', objetivo: 'o', contexto: [], criteriosAceite: [], provider: 'FACTORY', estado: 'RASCUNHO', criadoEm: AGORA, criadoPor: 'u' };
    const f = await EXECUCAO_FACTORY_RESERVADA.execute(job); expect(f.estado).toBe('RASCUNHO'); expect(f.motivo).toBe(FACTORY_INDISPONIVEL); expect(f.referenciaExterna).toBeUndefined();
    const m = await EXECUCAO_MANUAL.execute({ ...job, provider: 'MANUAL' }); expect(m.estado).toBe('ENVIADO');
    expect(provedorExecucao('FACTORY')).toBe(EXECUCAO_FACTORY_RESERVADA);
  });
  it('triagem humana produz classificação auditável; raciocínio longo é recusado', () => {
    const c = triagemHumana({ intencao: 'x', assunto: 'y', prioridade: 'Alta', nivel: 'C' }, AGORA);
    expect(c.provedor).toBe('HUMANO'); expect(c.confianca).toBe(1); expect(classificacaoAuditavel(c).ok).toBe(true);
    expect(classificacaoAuditavel({ ...c, sinais: ['a'.repeat(201)] }).ok).toBe(false);
    expect(classificacaoAuditavel({ ...c, evidencias: [{ mensagemId: 'm', trecho: 'b'.repeat(301) }] }).ok).toBe(false);
    expect(classificacaoAuditavel({ ...c, intencao: '' }).ok).toBe(false);
  });
});

describe('quem pode agir (recorte dentro da permissão)', () => {
  const ds = seedInbox(AGORA);
  const rec = (id: string, papel: Usuario['papel']) => recorteDe(usuario(id, papel), ds.membros);
  it('transversal muda tudo; responsável e gestor do setor mudam a sua; atendente de outro setor não', () => {
    const t = ds.threads.find((x) => x.id === 'THR-00001')!; // FINANCEIRO, responsavel u-fin
    expect(podeMudarStatus(rec('u-augusto', 'Diretoria'), t, 'AGUARDANDO_CONTATO').ok).toBe(true);
    expect(podeMudarStatus(rec('u-fin', 'Financeiro'), t, 'AGUARDANDO_CONTATO').ok).toBe(true);
    expect(podeMudarStatus(rec('u-contab', 'Contabilidade'), t, 'AGUARDANDO_CONTATO').ok).toBe(false); // atendente do setor, nao responsavel
    expect(podeMudarStatus(rec('u-obra', 'Gestor de obra'), t, 'AGUARDANDO_CONTATO').ok).toBe(false);
  });
  it('conversa sem responsável: quem a enxerga assume ou tria; transferir para outra pessoa exige gestor/responsável', () => {
    const t = ds.threads.find((x) => x.id === 'THR-00007')!; // NOVA, sem setor
    expect(podeAtribuir(rec('u-contab', 'Contabilidade'), t, { responsavelId: 'u-contab' }).ok).toBe(true);
    expect(podeAtribuir(rec('u-contab', 'Contabilidade'), t, { setorCodigo: 'OBRAS' }).ok).toBe(true); // triagem de conversa sem setor
    const t10 = ds.threads.find((x) => x.id === 'THR-00010')!; // JURIDICO, sem responsavel
    expect(podeAtribuir(rec('u-contab', 'Contabilidade'), t10, { responsavelId: 'u-obra' }).ok).toBe(false);
    expect(podeAtribuir(rec('u-fin', 'Financeiro'), ds.threads.find((x) => x.id === 'THR-00001')!, { responsavelId: 'u-contab' }).ok).toBe(true); // gestor do setor
  });
  it('a transição gera o evento certo', () => {
    expect(eventoDaTransicao('EM_ATENDIMENTO', 'RESOLVIDA')).toBe('RESOLVED');
    expect(eventoDaTransicao('RESOLVIDA', 'FECHADA')).toBe('CLOSED');
    expect(eventoDaTransicao('FECHADA', 'EM_ATENDIMENTO')).toBe('THREAD_REOPENED');
    expect(eventoDaTransicao('ATRIBUIDA', 'AGUARDANDO_CONTATO')).toBe('STATUS_CHANGED');
  });
});

describe('resolução de thread e fallback sem IA', () => {
  it('mesma identidade + canal + contexto + thread não fechada reutiliza; fechada reabre; contexto diferente cria', () => {
    const ds = seedInbox(AGORA);
    const t = threadDoContato(ds.threads, 'CTI-00003', 'WHATSAPP', 'EXTERNAL'); expect(t?.id).toBe('THR-00003');
    expect(threadDoContato(ds.threads, 'CTI-00003', 'EMAIL', 'EXTERNAL')?.id).toBe('THR-00008'); // RESOLVIDA (nao fechada) reusa
    expect(threadDoContato(ds.threads, 'CTI-00003', 'WHATSAPP', 'INTERNAL')).toBeUndefined();
    expect(normalizarIdentificador('WHATSAPP', '+55 (62) 90000-0101')).toBe('5562900000101');
    expect(normalizarIdentificador('EMAIL', ' Renata.Campos@Horizontenorte.exemplo ')).toBe('renata.campos@horizontenorte.exemplo');
    const r = receberMensagem(ds, recebida({ identidade: { canal: 'WHATSAPP', identificador: '+55 62 90000-0103', verificada: false }, externalMessageId: 'wamid.novo' }), relogio());
    expect(r.novoContato).toBe(false); expect(r.thread?.id).toBe('THR-00003');
  });
  it('inteligência indisponível, quebrada ou não auditável nunca lança: a mensagem já está persistida e a thread fica NOVA', async () => {
    const ds = seedInbox(AGORA);
    const entrada = { thread: ds.threads[6], mensagem: ds.mensagens.find((m) => m.threadId === 'THR-00007')!, historico: [], organizacaoId: 'org', contexto: 'EXTERNAL' as const, setoresDisponiveis: [] };
    expect((await classificarSeguro(undefined, entrada, AGORA)).ok).toBe(false);
    expect((await classificarSeguro(SEM_INTELIGENCIA, entrada, AGORA)).ok).toBe(false);
    const quebrada: IntelligenceProvider = { codigo: 'LLM', async analisar() { throw new Error('timeout'); } };
    const q = await classificarSeguro(quebrada, entrada, AGORA); expect(q.ok).toBe(false); expect(!q.ok && q.motivo).toMatch(/timeout/);
    const tagarela: IntelligenceProvider = { codigo: 'LLM', async analisar() { return { ok: true, resultado: { intencao: 'x', assunto: 'y', entidades: [], prioridade: 'Normal', confianca: 0.9, sinais: ['z'.repeat(500)], provedor: 'LLM', versao: 'v' } }; } };
    const tg = await classificarSeguro(tagarela, entrada, AGORA); expect(tg.ok).toBe(false); expect(!tg.ok && tg.motivo).toMatch(/raciocínio/);
    const boa: IntelligenceProvider = { codigo: 'LLM', async analisar() { return { ok: true, resultado: { intencao: 'solicitar_orcamento', assunto: 'Mezanino', entidades: [], resumo: 'pede mezanino', prioridade: 'Normal', nivel: 'B', setorRecomendado: 'COMERCIAL', confianca: 0.8, sinais: ['pede prazo'], motivoOperacional: 'pedido comercial', provedor: 'LLM', versao: 'v1', modelo: 'm' } }; } };
    const ok = await classificarSeguro(boa, entrada, AGORA);
    expect(ok.ok && ok.classificacao.provedor).toBe('LLM'); expect(ok.ok && ok.classificacao.evidencias[0]?.mensagemId).toBe(entrada.mensagem.id); expect(ok.ok && ok.resumo).toBe('pede mezanino');
  });
});

describe('seed e higiene', () => {
  const ds = seedInbox(AGORA);
  it('seed íntegro: referências fecham, ids únicos, telefone mascarado em qualquer saída', () => {
    const ids = [...ds.contatos, ...ds.threads, ...ds.mensagens, ...ds.eventos, ...ds.atribuicoes, ...ds.acoes, ...ds.jobs, ...ds.equipes, ...ds.membros].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ds.threads) { expect(ds.contatos.some((c) => c.id === t.contatoId), t.id).toBe(true); if (t.setorCodigo) expect(ds.setores.some((s) => s.codigo === t.setorCodigo), t.id).toBe(true); }
    for (const m of ds.mensagens) expect(ds.threads.some((t) => t.id === m.threadId), m.id).toBe(true);
    for (const a of ds.acoes) expect(ds.threads.some((t) => t.id === a.threadId), a.id).toBe(true);
    for (const j of ds.jobs) expect(ds.acoes.some((a) => a.id === j.acaoId), j.id).toBe(true);
    for (const c of ds.contatos) for (const i of c.identidades) { const m = identificadorMascarado(i); if (i.canal === 'WHATSAPP') expect(m).toMatch(/\*{3,}/); expect(m).not.toBe(i.identificador === m ? '' : i.identificador); }
    expect(ds.origem).toBe('seed');
  });
  it('o seed não afirma envio: toda saída está apenas registrada e nenhum job foi à Factory', () => {
    for (const m of ds.mensagens.filter((m) => m.direcao === 'outbound')) expect(m.entrega).toBe('registrada');
    // evento nunca carrega corpo de mensagem nem telefone inteiro (regra espelhada no CHECK da 0056)
    for (const e of ds.eventos) { expect(e.detalhe.length).toBeLessThanOrEqual(500); expect(e.detalhe).not.toMatch(/[0-9]{9,}/); }
    for (const j of ds.jobs) { expect(j.provider).toBe('MANUAL'); expect(j.referenciaExterna).toBeUndefined(); }
  });
  it('o domínio é puro: nada de React, fetch, Supabase, GSAP ou Factory/Mission Control no core do Inbox', () => {
    const dir = path.join(process.cwd(), 'src/core/inbox');
    // ingestaoPorta.ts e a UNICA excecao declarada: porta server-side (fetch injetado, chave do ambiente), como vibeServidor
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts') && x !== 'ingestaoPorta.ts')) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const proibido of ["from 'react'", 'fetch(', 'supabase', 'gsap', '../central/', 'eiff-dev-factory', 'githubAdapter', 'localStorage', 'import.meta.env']) expect(s, `${f} contém ${proibido}`).not.toContain(proibido);
    }
  });
  it('o navegador nunca chama IA ou canal real pelo Inbox: a tela só usa actions do store', () => {
    const tela = fs.readFileSync(path.join(process.cwd(), 'src/screens/Inbox.tsx'), 'utf8');
    for (const proibido of ['fetch(', '/api/', 'anthropic', 'META_WHATSAPP', 'OCTADESK']) expect(tela).not.toContain(proibido);
  });
});
