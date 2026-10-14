// CD-D3/E3 — caminho REAL do app até o livro de desfechos: o mesmo `carregarRadar`/`persistirRadar` de produção, com os
// helpers apontando para um PostgreSQL descartável (PGlite) com a FILA INTEIRA de migrations (0001..0070) e executando
// como um usuário de verdade (papel authenticated + auth.uid(), com a RLS de produção). Reproduz o modo remoto: o app
// muda o estágio pela transição canônica (E0) e NÃO fabrica evento; o gatilho do banco grava; a recarga traz o livro;
// o motor E1 apura a meta com o que veio do banco.
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { bancoComFila } from '../../scripts/lib/pgliteFila.mjs';
import { carregarRadar, persistirRadar, type HelpersRadar } from './radar.supabase';
import { aplicarTransicao, apurarMetaComercial, complementoDoGanho, type Oportunidade, type RadarDataset } from '../core/radar';

type Row = Record<string, unknown>;
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<unknown> }
const ADM = 'dddddddd-0000-4000-8000-000000000001';
const DONO = 'dddddddd-0000-4000-8000-000000000002';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let db: Banco;
let org = '';
let empresa = '';
const gravacoes: { tabela: string; colunas: string[] }[] = [];

/** valores como o PostgREST entrega: instantes em ISO com fuso, números de precisão como texto */
const normal = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v]));
const param = (v: unknown) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

/** HelpersRadar de produção, sobre o PGlite, como o usuário ADM (papel authenticated) */
function helpers(): HelpersRadar {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p.map(param))).rows.map(normal);
  return {
    sel: (tabela, ordem, comId = true) => q(`select * from ${tabela} order by ${ordem}${comId ? ', id' : ''}`),
    gravar: async (tabela, filtro, row, extra) => {
      if (filtro.id) {
        const cols = Object.keys(row);
        gravacoes.push({ tabela, colunas: cols });
        const r = await q(`update ${tabela} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} where id = $${cols.length + 1} returning id`, [...cols.map((c) => row[c]), filtro.id]);
        if (!r.length) throw new Error(`update sem linha em ${tabela} (RLS?)`);
        return r[0];
      }
      const todos = { ...row, ...(extra ?? {}) };
      const cols = Object.keys(todos);
      gravacoes.push({ tabela, colunas: cols });
      return (await q(`insert into ${tabela} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((c) => todos[c])))[0];
    },
    gravarComposta: async () => { throw new Error('não usado neste teste'); },
    inserir: async (tabela, rows) => { const out: Row[] = []; for (const r of rows) { const cols = Object.keys(r); out.push((await q(`insert into ${tabela} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((c) => r[c])))[0]); } return out; },
    apagar: async (tabela, id) => { await q(`delete from ${tabela} where id = $1`, [id]); },
    orgId: org, atorId: ADM,
    uuid: (v) => (v && UUID.test(v) ? v : null),
    perfil: (v) => (v && UUID.test(v) ? v : null),
    rpc: async (nome, args) => { const ks = Object.keys(args); return (await q(`select ${nome}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, ks.map((k) => args[k])))[0]?.r; },
    motivoDono: () => undefined,
  };
}
const comoAdm = async <T>(fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${ADM}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`); }
};
const carregar = () => comoAdm(() => carregarRadar(helpers()));
const persistir = (antes: RadarDataset, depois: RadarDataset) => comoAdm(() => persistirRadar(helpers(), antes, depois));
const trocar = (r: RadarDataset, o: Oportunidade): RadarDataset => ({ ...r, oportunidades: r.oportunidades.some((x) => x.id === o.id) ? r.oportunidades.map((x) => (x.id === o.id ? o : x)) : [...r.oportunidades, o] });
const agora = () => new Date().toISOString();

beforeAll(async () => {
  ({ db } = await bancoComFila(path.resolve('.')));
  org = (await db.query(`select id from organization where code = 'EIFF'`)).rows[0].id as string;
  await db.query(`insert into profile (id, organization_id, name, email, role, active) values ($1, $3, 'Adm', 'adm@t', 'Administrador', true), ($2, $3, 'Dono', 'dono@t', 'Diretoria', true)`, [ADM, DONO, org]);
  empresa = (await db.query(`insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1, 'Conta Integração', $2) returning id`, [org, DONO])).rows[0].id as string;
}, 120_000);

describe('E3 · app → banco → app (modo remoto, RLS de produção)', () => {
  it('ganho pelo app vira GANHO do gatilho; edição de ganha não duplica; reabrir estorna; o motor apura o que veio do banco', async () => {
    // 1. oportunidade nova pelo app (id local → uuid do banco)
    let r = await carregar();
    expect(r.desfechos).toEqual([]);
    const nova: Oportunidade = { id: 'OPP-LOCAL-1', empresaId: empresa, titulo: 'Galpão integração', estagio: 'NEGOTIATION', valorEstimado: 500000, probabilidade: 0.8, responsavelId: ADM, proximaAcao: 'Ligar', proximaAcaoEm: '2026-10-20', observacoes: '', criadoEm: agora(), atualizadoEm: agora() };
    await persistir(r, trocar(r, nova));
    r = await carregar();
    const o = r.oportunidades.find((x) => x.titulo === 'Galpão integração')!;
    expect(o.id).toMatch(UUID);

    // 2. marcar como ganha com valor fechado: o app NÃO fabrica evento (remoto); o UPDATE dispara o gatilho
    const ganha = aplicarTransicao(o, 'WON', { motivo: 'contrato assinado', valorFechado: 1250000.5 }, agora());
    gravacoes.length = 0;
    await persistir(r, trocar(r, ganha));
    expect(gravacoes.find((g) => g.tabela === 'radar_opportunity')?.colunas).toContain('won_amount');
    expect(gravacoes.some((g) => g.tabela === 'radar_commercial_outcome')).toBe(false); // o app nunca escreve o livro
    r = await carregar();
    expect(r.desfechos!.map((e) => [e.tipo, e.valor, e.responsavelId, e.donoContaId, e.registradoPor, e.motivo])).toEqual([['GANHO', '1250000.50', ADM, DONO, ADM, 'contrato assinado']]);
    expect(r.oportunidades.find((x) => x.id === o.id)?.valorFechado).toBe(1250000.5);

    // 3. editar a ganha pelo app (linha inteira, como a persistência envia) passa pela trava e não duplica
    const g = r.oportunidades.find((x) => x.id === o.id)!;
    await persistir(r, trocar(r, { ...g, observacoes: 'assinada na visita', atualizadoEm: agora() }));
    r = await carregar();
    expect(r.desfechos!.length).toBe(1);

    // 4. reabrir pelo app: ESTORNO citando o ganho; o valor fechado some da oportunidade
    const reaberta = aplicarTransicao(r.oportunidades.find((x) => x.id === o.id)!, 'NEGOTIATION', { motivo: 'cliente pediu revisão', proximaAcao: 'Rever escopo', proximaAcaoEm: '2026-11-10' }, agora());
    await persistir(r, trocar(r, reaberta));
    r = await carregar();
    const [gan, est] = r.desfechos!;
    expect([est.tipo, est.ganhoId]).toEqual(['ESTORNO_GANHO', gan.id]);
    expect(r.oportunidades.find((x) => x.id === o.id)?.valorFechado).toBeUndefined();

    // 5. o motor E1 lê o livro do banco como veio (instante com fuso, valor em texto)
    const mes = gan.ocorridoEm.slice(0, 7);
    const ap = apurarMetaComercial({ metas: [], eventos: r.desfechos!, mes, agora: new Date(Date.now() + 1000).toISOString() });
    expect(ap.inconsistencias.eventos).toEqual([]);
    expect(ap.ganhos.map((x) => [x.id, x.centavosNoGanho, x.estornadoPor])).toEqual([[gan.id, 125000050, est.id]]);
  });

  it('ganho sem valor + complemento pela RPC governada (o app chama a RPC; o banco audita e grava)', async () => {
    let r = await carregar();
    const nova: Oportunidade = { id: 'OPP-LOCAL-2', empresaId: empresa, titulo: 'Sem valor integração', estagio: 'NEGOTIATION', valorEstimado: 300000, probabilidade: 0.8, responsavelId: ADM, proximaAcao: 'Ligar', proximaAcaoEm: '2026-10-20', observacoes: '', criadoEm: agora(), atualizadoEm: agora() };
    await persistir(r, trocar(r, nova));
    r = await carregar();
    const o = r.oportunidades.find((x) => x.titulo === 'Sem valor integração')!;
    await persistir(r, trocar(r, aplicarTransicao(o, 'WON', { motivo: 'ganho sem valor' }, agora())));
    r = await carregar();
    const ganho = r.desfechos!.find((e) => e.oportunidadeId === o.id && e.tipo === 'GANHO')!;
    expect('valor' in ganho).toBe(false);
    const c = complementoDoGanho(r.desfechos!, ganho.id, 450000.75, 'valor da NF', { agora: agora(), atorId: ADM, novoId: () => 'DSF-LOCAL-1' });
    await persistir(r, { ...r, desfechos: [...r.desfechos!, c] });
    r = await carregar();
    expect(r.desfechos!.filter((e) => e.oportunidadeId === o.id).map((e) => [e.tipo, e.valor, e.ganhoId ?? null, e.motivo])).toEqual([['GANHO', undefined, null, 'ganho sem valor'], ['COMPLEMENTO_VALOR', '450000.75', ganho.id, 'valor da NF']]);
    const aud = (await db.query(`select count(*)::int n from audit_log where action = 'radar_complementar_valor_ganho'`)).rows[0].n;
    expect(aud).toBe(1);
  });

  it('código publicado antes da 0070 (livro indisponível): a oportunidade é gravada sem a coluna won_amount', async () => {
    const r = await carregar();
    const o = r.oportunidades[0];
    gravacoes.length = 0;
    const semLivro: RadarDataset = { ...r, desfechos: undefined };
    await persistir({ ...r, desfechos: undefined }, trocar(semLivro, { ...o, titulo: `${o.titulo} (sem livro)` }));
    expect(gravacoes.find((g) => g.tabela === 'radar_opportunity')?.colunas).not.toContain('won_amount');
  });
});
