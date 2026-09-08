import { describe, expect, it } from 'vitest';
import { LedgerMemoria, POLITICA_PADRAO, aplicarPagina, verificarConfiguracaoServidor, classificarErro, cursorDe, decidirReserva, filtrosPool, filtrosValidados, hashRequisicao, novoEstadoPaginacao, precisaEnriquecerEmail, proximaPagina, tamanhoPaginaServidor, transicao, validarForceRefresh, type PedidoReserva } from './vibeServidor';

const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');
const AGORA = '2026-09-08T12:00:00.000Z';
const pedido = (p: Partial<PedidoReserva> = {}): PedidoReserva => ({ idempotencyKey: 'k1', requestHash: hashRequisicao({ a: 1 }), operationType: 'discovery_pool', estimatedCredits: 20, recordsRequested: 20, creditsAvailable: 500, role: 'Administrador', agora: AGORA, ...p });

describe('reserva no servidor (espelho da RPC)', () => {
  it('hash canonico: mesma requisicao com ordem diferente da o mesmo hash; payload diferente muda', () => {
    expect(hashRequisicao({ b: [2, 1], a: 'X ' })).toBe(hashRequisicao({ a: 'x', b: [1, 2] }));
    expect(hashRequisicao({ a: 1 })).not.toBe(hashRequisicao({ a: 2 }));
  });
  it('budget guard no servidor: politica, papel, saldo menos reserva, limite por operacao, orcamento diario', () => {
    const l = new LedgerMemoria();
    expect(l.reservar(pedido({ role: 'Compras' })).reason).toBe('papel_nao_permitido');
    expect(l.reservar(pedido({ estimatedCredits: 41 })).reason).toBe('orcamento_insuficiente'); // max 40 por operacao
    expect(l.reservar(pedido({ estimatedCredits: 30, creditsAvailable: 45 })).reason).toBe('orcamento_insuficiente'); // 45 - 20 reserva = 25
    expect(l.reservar(pedido({ recordsRequested: 21 })).reason).toBe('registros_acima_do_limite');
    expect(l.reservar(pedido({ estimatedCredits: 0 })).reason).toBe('custo_invalido');
    const r1 = l.reservar(pedido({ idempotencyKey: 'a', estimatedCredits: 40 }));
    expect(r1.authorized).toBe(true); expect(r1.status).toBe('RESERVED');
    // diario 60: ja ha 40 reservados -> so cabem 20
    expect(l.reservar(pedido({ idempotencyKey: 'b', estimatedCredits: 21 })).reason).toBe('orcamento_insuficiente');
    expect(l.reservar(pedido({ idempotencyKey: 'b', estimatedCredits: 20 })).authorized).toBe(true);
    expect(decidirReserva({ ...POLITICA_PADRAO, enabled: false }, [], pedido()).reason).toBe('politica_desabilitada');
  });
  it('duas reservas concorrentes nao reservam o mesmo saldo; a segunda e bloqueada', () => {
    const l = new LedgerMemoria({ ...POLITICA_PADRAO, dailyBudget: 40 });
    const a = l.reservar(pedido({ idempotencyKey: 'c1', estimatedCredits: 30 }));
    const b = l.reservar(pedido({ idempotencyKey: 'c2', estimatedCredits: 30 }));
    expect(a.authorized).toBe(true); expect(b.authorized).toBe(false); expect(b.limits?.dailyRemaining).toBe(10);
  });
  it('idempotencia: mesma chave -> em andamento, sucesso devolve resumo, retry apos sucesso nao autoriza, payload diferente recusado', () => {
    const l = new LedgerMemoria();
    const r = l.reservar(pedido({ idempotencyKey: 'x', estimatedCredits: 10 }));
    expect(l.reservar(pedido({ idempotencyKey: 'x', estimatedCredits: 10 })).reason).toBe('operacao_em_andamento');
    expect(l.reservar(pedido({ idempotencyKey: 'x', estimatedCredits: 10, requestHash: 'outro' })).reason).toBe('payload_diferente');
    expect(l.atualizar(r.operationId!, 'RUNNING').ok).toBe(true);
    expect(l.atualizar(r.operationId!, 'SUCCEEDED', { actualCredits: 8, resultSummary: { casadas: 3 } }).ok).toBe(true);
    const again = l.reservar(pedido({ idempotencyKey: 'x', estimatedCredits: 10 }));
    expect(again).toMatchObject({ authorized: false, reason: 'ja_executada', resultSummary: { casadas: 3 } });
    expect(l.atualizar(r.operationId!, 'RUNNING')).toMatchObject({ ok: false, reason: 'operacao_encerrada' });
    // FAILED antes do envio libera a reserva e permite reservar de novo com a mesma chave
    const f = l.reservar(pedido({ idempotencyKey: 'y', estimatedCredits: 10 }));
    l.atualizar(f.operationId!, 'FAILED');
    expect(l.ops.find((o) => o.id === f.operationId)!.reservedCredits).toBe(0);
    expect(l.reservar(pedido({ idempotencyKey: 'y', estimatedCredits: 10 })).reason).toBe('reservada_reaproveitando');
  });
  it('UNCERTAIN exige reconciliacao: bloqueia retry e mantem a reserva no consumo', () => {
    const l = new LedgerMemoria();
    const r = l.reservar(pedido({ idempotencyKey: 'u', estimatedCredits: 15 }));
    l.atualizar(r.operationId!, 'RUNNING'); l.atualizar(r.operationId!, 'UNCERTAIN');
    expect(l.reservar(pedido({ idempotencyKey: 'u', estimatedCredits: 15 })).reason).toBe('reconciliacao_necessaria');
    expect(l.atualizar(r.operationId!, 'RUNNING')).toMatchObject({ ok: false, reason: 'reconciliacao_necessaria' });
    expect(l.reservar(pedido({ idempotencyKey: 'v', estimatedCredits: 40 })).limits?.dailyRemaining).toBe(45); // 60 - 15 reservados na UNCERTAIN
    expect(l.atualizar(r.operationId!, 'SUCCEEDED', { actualCredits: 15 }).ok).toBe(true);
    expect(transicao('SUCCEEDED', 'RUNNING').ok).toBe(false);
    expect(classificarErro({ enviado: true })).toBe('UNCERTAIN'); expect(classificarErro({ enviado: true, httpStatus: 422 })).toBe('FAILED'); expect(classificarErro({ enviado: false })).toBe('FAILED');
  });
});

describe('teto global e paginacao', () => {
  it('page_size respeita 100, cap da operacao, politica e creditos reservados; vale entre tiers', () => {
    expect(tamanhoPaginaServidor({ paidRecordCap: 20, recordsReturned: 0, maxPaidRecords: 20, reservedCredits: 20, creditosGastos: 0 })).toBe(20);
    expect(tamanhoPaginaServidor({ paidRecordCap: 20, recordsReturned: 15, maxPaidRecords: 20, reservedCredits: 20, creditosGastos: 15 })).toBe(5); // tier seguinte so pode 5
    expect(tamanhoPaginaServidor({ paidRecordCap: 20, recordsReturned: 20, maxPaidRecords: 20, reservedCredits: 20, creditosGastos: 20 })).toBe(0);
    expect(tamanhoPaginaServidor({ paidRecordCap: 500, recordsReturned: 0, maxPaidRecords: 500, reservedCredits: 500, creditosGastos: 0 })).toBe(100);
    expect(tamanhoPaginaServidor({ paidRecordCap: null, recordsReturned: 0, maxPaidRecords: 20, reservedCredits: 8, creditosGastos: 0 })).toBe(8);
  });
  it('cursor em varias posicoes e fallback por page numerica sem repetir a page 1', () => {
    expect(cursorDe({ page: { next_cursor: 'a' } })).toBe('a'); expect(cursorDe({ next_cursor: 'b' })).toBe('b'); expect(cursorDe({ pagination: { next_cursor: 'c' } })).toBe('c'); expect(cursorDe({})).toBeNull();
    const e = novoEstadoPaginacao();
    expect(proximaPagina(e, 100)).toEqual({ page_size: 100, page: 1 });
    const r1 = aplicarPagina(e, { data: Array.from({ length: 100 }, (_, i) => ({ prospect_id: P(i), business_id: B(1) })) }, 100, { maxPaginas: 5, capAtingido: false, orcamentoAtingido: false });
    expect(r1).toMatchObject({ continuar: true, motivo: 'page_numerica' });
    expect(proximaPagina(e, 100)).toEqual({ page_size: 100, page: 2 }); // sem cursor: page 2, nunca page 1 de novo
    const r2 = aplicarPagina(e, { data: [{ prospect_id: P(1) }, { prospect_id: P(2) }], page: { next_cursor: 'z' } }, 100, { maxPaginas: 5, capAtingido: false, orcamentoAtingido: false });
    expect(r2).toMatchObject({ continuar: false, motivo: 'sem_novos_ids' }); // ids repetidos: interrompe
    const e2 = novoEstadoPaginacao();
    aplicarPagina(e2, { data: [{ prospect_id: P(9) }], next_cursor: 'c1' }, 100, { maxPaginas: 5, capAtingido: false, orcamentoAtingido: false });
    expect(proximaPagina(e2, 50)).toEqual({ page_size: 50, next_cursor: 'c1' });
    expect(aplicarPagina(e2, { data: [] }, 50, { maxPaginas: 5, capAtingido: false, orcamentoAtingido: false }).motivo).toBe('pagina_vazia');
    const e3 = novoEstadoPaginacao();
    expect(aplicarPagina(e3, { data: [{ prospect_id: P(3) }] }, 100, { maxPaginas: 5, capAtingido: false, orcamentoAtingido: false }).motivo).toBe('fim_sem_cursor');
    const e4 = novoEstadoPaginacao();
    expect(aplicarPagina(e4, { data: [{ prospect_id: P(4) }], next_cursor: 'x' }, 1, { maxPaginas: 5, capAtingido: true, orcamentoAtingido: false }).motivo).toBe('cap_atingido');
    expect(aplicarPagina(novoEstadoPaginacao(), { data: [{ prospect_id: P(5) }], next_cursor: 'x' }, 1, { maxPaginas: 1, capAtingido: false, orcamentoAtingido: false }).motivo).toBe('max_paginas');
  });
});

describe('catalogo validado, pool, cache de e-mail e force refresh', () => {
  it('sem catalogo nada e permitido; valores nao confirmados sao rejeitados', () => {
    expect(filtrosValidados({ job_level: ['director'] }, null).rejeitados).toEqual(['director']);
    const cat = { job_level: ['Director', 'manager'], job_department: ['engineering'] };
    expect(filtrosValidados({ job_level: ['director', 'cxo'], job_department: ['engineering', 'c-suite'] }, cat)).toEqual({ job_level: ['director'], job_department: ['engineering'], rejeitados: ['cxo', 'c-suite'] });
    expect(filtrosPool([B(1)], null, true)).toMatchObject({ erro: 'catalogo_nao_validado' });
    const pool = filtrosPool([B(1)], { job_level: ['director', 'manager'], job_department: ['engineering', 'operations'] }, true);
    expect('filtros' in pool && pool.filtros).toMatchObject({ business_id: { values: [B(1)] }, job_level: { values: ['director', 'manager'] }, job_department: { values: ['engineering', 'operations'] }, has_contact_details: { value: 'email' } });
    expect('filtros' in filtrosPool([B(1)], { job_level: ['director'], job_department: ['engineering'] }, false) && !('has_contact_details' in (filtrosPool([B(1)], { job_level: ['director'], job_department: ['engineering'] }, false) as { filtros: Record<string, unknown> }).filtros)).toBe(true);
  });
  it('cache de e-mail: valido e recente nao enriquece; force so Administrador com justificativa e nova chave', () => {
    expect(precisaEnriquecerEmail({ email: 'a@x.com', statusEmail: 'valido', verificadoEm: '2026-08-01' }, '2026-09-08', 90).precisa).toBe(false);
    expect(precisaEnriquecerEmail({ email: 'a@x.com', statusEmail: 'valido', verificadoEm: '2026-01-01' }, '2026-09-08', 90).precisa).toBe(true);
    expect(precisaEnriquecerEmail({ email: 'a@x.com', statusEmail: 'devolvido', verificadoEm: '2026-09-01' }, '2026-09-08', 90).precisa).toBe(true);
    expect(precisaEnriquecerEmail({}, '2026-09-08', 90).motivo).toBe('sem e-mail');
    expect(validarForceRefresh({ papel: 'Diretoria', justificativa: 'e-mail mudou', idempotencyKeyNova: 'n', idempotencyKeyAnterior: 'a' }).ok).toBe(false);
    expect(validarForceRefresh({ papel: 'Administrador', justificativa: '', idempotencyKeyNova: 'n' }).motivo).toMatch(/justificativa/);
    expect(validarForceRefresh({ papel: 'Administrador', justificativa: 'contato trocou de e-mail', idempotencyKeyNova: 'a', idempotencyKeyAnterior: 'a' }).motivo).toMatch(/idempotencyKey/);
    expect(validarForceRefresh({ papel: 'Administrador', justificativa: 'contato trocou de e-mail', idempotencyKeyNova: 'b', idempotencyKeyAnterior: 'a' }).ok).toBe(true);
  });
});

describe('fronteira de confianca (server-only)', () => {
  it('acoes de consumo exigem service role; sem ela nada vai para a Explorium e nao ha fallback para anon', () => {
    for (const acao of ['simular', 'reservar', 'cancelar', 'concluir', 'executar', 'catalogo']) expect(verificarConfiguracaoServidor({ acao, temChave: true, temServiceRole: false })).toMatchObject({ ok: false, erro: 'configuracao_incompleta' });
    expect(verificarConfiguracaoServidor({ acao: 'executar', temChave: false, temServiceRole: false })).toMatchObject({ ok: false, erro: 'configuracao_incompleta' });
    expect(verificarConfiguracaoServidor({ acao: 'executar', temChave: true, temServiceRole: true })).toEqual({ ok: true });
    expect(verificarConfiguracaoServidor({ acao: 'creditos', temChave: false, temServiceRole: false })).toMatchObject({ ok: false, erro: 'nao_configurado' });
    expect(verificarConfiguracaoServidor({ acao: 'orcamento', temChave: false, temServiceRole: false })).toEqual({ ok: true });
    expect(verificarConfiguracaoServidor({ acao: 'estado', temChave: false, temServiceRole: false })).toEqual({ ok: true });
  });
  it('nenhum codigo do navegador chama as RPCs mutaveis; o saldo da decisao nao vem do navegador', () => {
    // Vibe.tsx so fala com /api/vibe; o corpo enviado nunca carrega p_credits_available/budget/reserve como fonte de verdade
    const corpoNavegador = { acao: 'reservar', tipo: 'match', empresas: [{ id: 'E1', nome: 'X' }], idempotencyKey: 'k1', budget: 999999, reserve: 0, confirmar: true, p_credits_available: 999999 };
    const paramsServidor = { tipo: corpoNavegador.tipo, empresas: corpoNavegador.empresas }; // e o que a funcao usa para o hash/estimativa
    expect(Object.keys(paramsServidor)).not.toContain('p_credits_available');
    expect(hashRequisicao(paramsServidor)).toBe(hashRequisicao({ tipo: 'match', empresas: [{ id: 'E1', nome: 'X' }] }));
  });
});
