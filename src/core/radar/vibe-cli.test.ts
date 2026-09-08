import { describe, expect, it } from 'vitest';
import { BUDGET_PADRAO, PAGE_SIZE_MAX, POOL_JOB_LEVEL, RESERVA_PADRAO, budgetGuard, cursorDe, dentroDoCache, escolherPorEmpresa, estimar, filtrarJaProcessados, filtrosDecisores, filtrosPool, filtrosValidados, linhasParaEnriquecer, normalizarEnriquecimento, paginar, payloadEnriquecimento, registroConsumo, tamanhoPagina } from '../../../scripts/vibe-core.mjs';

const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');

describe('vibe-core: pagina, paginacao e uma pessoa por empresa', () => {
  it('page_size nunca passa de 100', () => {
    expect(PAGE_SIZE_MAX).toBe(100);
    expect(tamanhoPagina(112)).toBe(100); expect(tamanhoPagina(500)).toBe(100); expect(tamanhoPagina(0)).toBe(1); expect(tamanhoPagina(20)).toBe(20);
  });
  it('escolhe no maximo 1 pessoa por empresa valida', () => {
    const esc = new Map();
    const n = escolherPorEmpresa([{ prospect_id: P(1), business_id: B(1) }, { prospect_id: P(2), business_id: B(1) }, { prospect_id: P(3), business_id: B(9) }, { prospect_id: P(4), business_id: B(2).toUpperCase() }], [B(1), B(2)], esc, 10, { prioridade: 'engenharia' });
    expect(n).toBe(2); expect([...esc.keys()]).toEqual([B(1), B(2)]); expect(esc.get(B(1)).prospect_id).toBe(P(1)); expect(esc.get(B(2)).prioridade).toBe('engenharia');
  });
  it('pagina ate conseguir empresas distintas, respeitando 100 por pagina e o cursor', async () => {
    const chamadas: { page_size: number; next_cursor?: string }[] = [];
    // 3 paginas: a primeira so tem prospects da mesma empresa; a segunda traz mais; a terceira nao tem cursor
    const paginas = [
      { data: Array.from({ length: 100 }, (_, i) => ({ prospect_id: P(100 + i), business_id: B(1) })), page: { next_cursor: 'c2' }, response_context: { correlation_id: 'x1' } },
      { data: [{ prospect_id: P(300), business_id: B(2) }, { prospect_id: P(301), business_id: B(3) }], page: { next_cursor: 'c3' }, response_context: { correlation_id: 'x2' } },
      { data: [{ prospect_id: P(400), business_id: B(4) }], page: { next_cursor: null } },
    ];
    let i = 0;
    const esc = new Map();
    const r = await paginar(async (p) => { chamadas.push(p); return paginas[i++]; }, { businessIds: [B(1), B(2), B(3), B(4)], escolhidos: esc, max: 56 });
    expect(chamadas[0].page_size).toBe(100);
    expect(chamadas[1].next_cursor).toBe('c2');
    expect(r.paginas).toBe(3); // segunda pagina menor mas com cursor: segue; terceira sem cursor e menor: fim
    expect(r.motivo).toBe('fim_sem_cursor');
    expect(esc.size).toBe(4); expect(r.devolvidos).toBe(103); expect(r.correlacoes).toEqual(['x1', 'x2']);
    // para quando atinge max
    const esc2 = new Map(); i = 0;
    await paginar(async () => paginas[i++], { businessIds: [B(1), B(2)], escolhidos: esc2, max: 1 });
    expect(esc2.size).toBe(1);
    // respeita maxPaginas (mesma pagina repetida: ids ja vistos -> para sem progresso na 2a)
    const esc3 = new Map(); i = 0;
    const r3 = await paginar(async () => ({ ...paginas[0], page: { next_cursor: 'sempre' } }), { businessIds: [B(1), B(2)], escolhidos: esc3, max: 2, maxPaginas: 3 });
    expect(r3.paginas).toBe(2); expect(r3.motivo).toBe('sem_novos_ids');
  });
  it('API sem cursor: pagina por page numerica, nunca repete a page 1, e para no fim', async () => {
    const chamadas: { page_size: number; page?: number; next_cursor?: string }[] = [];
    let n = 0;
    const esc = new Map();
    // pagina 1 cheia (sem cursor): segue para page=2; pagina 2 completa o maximo
    const r = await paginar(async (p) => { chamadas.push(p); n++; return n === 1 ? { data: Array.from({ length: p.page_size }, (_, i) => ({ prospect_id: P(i), business_id: B(i) })) } : { data: [{ prospect_id: P(50), business_id: B(50) }] }; }, { businessIds: [B(0), B(1), B(2), B(3), B(50)], escolhidos: esc, max: 5 });
    expect(chamadas.map((c) => c.page)).toEqual([1, 2]); expect(chamadas.every((c) => !c.next_cursor)).toBe(true);
    expect(r.motivo).toBe('max_atingido'); expect(esc.size).toBe(5);
    // pagina vazia encerra
    const esc2 = new Map();
    expect((await paginar(async () => ({ data: [] }), { businessIds: [B(1)], escolhidos: esc2, max: 5 })).motivo).toBe('pagina_vazia');
    // cap global e orcamento interrompem antes de pedir mais
    const esc3 = new Map();
    const r3 = await paginar(async (p) => ({ data: Array.from({ length: p.page_size }, (_, i) => ({ prospect_id: P(100 + i), business_id: B(100 + i) })), next_cursor: 'c' }), { businessIds: Array.from({ length: 50 }, (_, i) => B(100 + i)), escolhidos: esc3, max: 50, cap: 7 });
    expect(r3.devolvidos).toBe(7); expect(r3.motivo).toBe('cap_atingido');
    const esc4 = new Map();
    const r4 = await paginar(async (p) => ({ data: Array.from({ length: p.page_size }, (_, i) => ({ prospect_id: P(200 + i), business_id: B(200 + i) })), next_cursor: 'c' }), { businessIds: Array.from({ length: 50 }, (_, i) => B(200 + i)), escolhidos: esc4, max: 50, orcamento: 5 });
    expect(r4.devolvidos).toBe(5); expect(r4.motivo).toBe('orcamento_atingido');
  });
  it('catalogo validado e pool de descoberta', () => {
    expect(filtrosPool([B(1)], null)).toMatchObject({ erro: 'catalogo_nao_validado' });
    const pool = filtrosPool([B(1)], { job_level: POOL_JOB_LEVEL, job_department: ['engineering'] }, true) as { filtros: Record<string, unknown> };
    expect(pool.filtros).toMatchObject({ job_level: { values: POOL_JOB_LEVEL }, job_department: { values: ['engineering'] }, has_contact_details: { value: 'email' } });
    expect(filtrosValidados({ job_level: ['cxo', 'director'] }, { job_level: ['director'] }).rejeitados).toEqual(['cxo']);
    expect(cursorDe({ pagination: { next_cursor: 'p' } })).toBe('p');
  });
  it('filtro somente com e-mail e opcional', () => {
    const tier = { filtros: { job_department: { values: ['engineering'] } } };
    expect(filtrosDecisores(tier, [B(1)], true)).toEqual({ business_id: { values: [B(1)] }, job_department: { values: ['engineering'] }, has_contact_details: { value: 'email' } });
    expect(filtrosDecisores(tier, [B(1)])).not.toHaveProperty('has_contact_details');
  });
});

describe('vibe-core: contrato do enriquecimento', () => {
  it('payload usa prospect_id como string ou lista de ate 50', () => {
    expect(payloadEnriquecimento([P(1)])).toEqual({ prospect_id: P(1), parameters: { contact_types: ['email'] } });
    expect(payloadEnriquecimento([P(1), P(2), P(1).toUpperCase()], ['email', 'phone']).prospect_id).toEqual([P(1), P(2)]);
    expect(() => payloadEnriquecimento(Array.from({ length: 51 }, (_, i) => P(i)))).toThrow(/50/);
    expect(() => payloadEnriquecimento(['abc'])).toThrow(/válido/);
  });
  it('normaliza prospect_id/entity_id no item ou em data', () => {
    const r = normalizarEnriquecimento({ data: [
      { prospect_id: P(1), professional_email: 'a@x.com', professional_email_status: 'valid' },
      { entity_id: P(2), data: { professional_email: 'b@x.com' } },
      { data: { prospect_id: P(3).toUpperCase(), mobile_phone: '+55' } },
      { data: { entity_id: P(4), professional_email_status: 'catch_all' } },
      { data: { nada: true } },
    ] });
    expect(r.map((x) => x.prospect_id)).toEqual([P(1), P(2), P(3), P(4)]);
    expect(r[1].professional_email).toBe('b@x.com'); expect(r[2].mobile_phone).toBe('+55'); expect(r[3].professional_email_status).toBe('catch_all');
    expect(normalizarEnriquecimento([{ prospect_id: P(9) }])).toHaveLength(1);
    expect(normalizarEnriquecimento(undefined)).toEqual([]);
  });
});

describe('vibe-core: estimativa, budget guard, idempotencia e log', () => {
  it('estimativa separa descoberta, e-mail, telefone, perfil (so se pedido) e reserva', () => {
    const e = estimar({ decisores: 56, cobertura: 300 });
    expect(e).toMatchObject({ busca: 112, email: 112, telefone: 0, perfil: 0, subtotal: 224, reserva: RESERVA_PADRAO, total: 244, natureza: 'estimativa' });
    expect(e.maximoProjetado).toBe(Math.min(56 * 2 * 5, 300) + 112);
    expect(estimar({ decisores: 10, cobertura: 5, email: false }).subtotal).toBe(5);
    expect(estimar({ decisores: 10, cobertura: 50, perfil: true }).perfil).toBe(10);
    expect(estimar({ decisores: 10, cobertura: 50, telefone: true }).telefone).toBe(30); // 5 - 2 ja contados no e-mail
  });
  it('budget guard usa o menor entre budget e disponiveis - reserve e nao inicia lote parcial', () => {
    expect(BUDGET_PADRAO).toBe(180); expect(RESERVA_PADRAO).toBe(20);
    expect(budgetGuard({ custoMaximo: 150, disponiveis: 1000 }).ok).toBe(true);
    expect(budgetGuard({ custoMaximo: 181, disponiveis: 1000 }).ok).toBe(false);
    expect(budgetGuard({ custoMaximo: 100, disponiveis: 110 })).toMatchObject({ ok: false, limite: 90 });
    expect(budgetGuard({ custoMaximo: 90, disponiveis: 110 }).ok).toBe(true);
    expect(budgetGuard({ custoMaximo: 50, disponiveis: 60, reserve: 5, budget: 55 }).limite).toBe(55);
  });
  it('idempotencia: exclui ja processados e nao paga de novo por e-mail valido', () => {
    expect(filtrarJaProcessados([{ prospect_id: P(1) }, { prospect_id: P(2).toUpperCase() }, { prospect_id: P(3) }], [P(2)]).map((p) => p.prospect_id)).toEqual([P(1), P(3)]);
    const linhas = [{ prospect_id: P(1), email: 'a@x.com', status_email: 'valid', verificado_em: '2026-09-01' }, { prospect_id: P(2), email: 'b@x.com', status_email: 'invalid' }, { prospect_id: P(3), email: '' }, { prospect_id: 'zzz', email: '' }, { prospect_id: P(4), email: 'c@x.com', status_email: 'valid', verificado_em: '2026-01-01' }];
    expect(linhasParaEnriquecer(linhas, { hoje: '2026-09-08' }).map((l) => l.prospect_id)).toEqual([P(2), P(3), P(4)]); // P(4): valido mas fora do cache de 90 dias
    expect(linhasParaEnriquecer(linhas, { hoje: '2026-09-08', cacheDias: 400 }).map((l) => l.prospect_id)).toEqual([P(2), P(3)]);
    expect(dentroDoCache({ email: 'a@x.com', status_email: 'valid', verificado_em: '2026-09-01' }, '2026-09-08')).toBe(true);
    expect(linhasParaEnriquecer(linhas, { force: true })).toHaveLength(4);
  });
  it('log de consumo sem chave, e-mail completo nem telefone', () => {
    const r = registroConsumo({ operation: 'enriquecer', records_requested: 2, records_returned: 2, credits_before: 100, credits_after: 96, estimated_credits: 4, correlation_id: 'abc', detalhe: 'api_key=CHAVEFICTICIAQWERTYUIOPASDFGHJKLZXCVB roberto@acme.com.br +55 62 99999-0001' });
    expect(r.actual_credit_delta).toBe(4);
    expect(String(r.detalhe)).not.toContain('QWERTYUIOPASDFGHJKLZXCVB'); expect(String(r.detalhe)).not.toContain('roberto@'); expect(String(r.detalhe)).not.toContain('99999');
    expect(String(r.detalhe)).toContain('r***@acme.com.br');
  });
});
