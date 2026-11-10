// EIFF Inbox — caminho REAL do app até o banco para as alterações de conversa feitas por PESSOA.
//
// Por que existe (incidente do GO-1 do formulário do site, 10/11/2026): em produção, registrar um rascunho na conversa
// devolveu «permission denied for table inbox_thread» e nada foi gravado. O banco concede UPDATE em `inbox_thread` por
// COLUNA (0056 + 0057); o app mandava, no mesmo comando, seis colunas que só existem na criação (canal, provider,
// contexto, contato, abertura e origem) — e o PostgreSQL recusa o comando INTEIRO quando uma única coluna não tem
// privilégio. Nenhum teste via isso: a suíte provava o que o adapter MANDA com helpers falsos, e a prova de banco
// (scripts/pg-smoke-inbox.mjs) atualizava a conversa com SQL próprio, nunca com o comando que o app monta.
//
// Aqui as duas metades se encontram: as AÇÕES do store de produção (inboxResponder, inboxRegistrarContato,
// inboxMudarStatus…) produzem o estado; o `persistirInbox` de produção monta os comandos; e quem os executa é um
// PostgreSQL de verdade (PGlite) com a FILA INTEIRA de migrations, como usuário `authenticated` com auth.uid() — os
// privilégios de coluna, a RLS e os gatilhos de autoridade de produção. O que vale é o que se LÊ de volta do banco.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { bancoComFila } from '../../scripts/lib/pgliteFila.mjs';
import { COLUNAS_MUTAVEIS_DA_CONVERSA, COLUNAS_SO_DA_CRIACAO_DA_CONVERSA, carregarInbox, persistirInbox, type HelpersInbox } from './inbox.supabase';
import { actions, getState } from './store';
import { situacaoPrimeiraResposta, type InboxDataset, type InboxThread } from '../core/inbox';
import type { Dataset } from '../core/types';

type Row = Record<string, unknown>;
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[]; affectedRows?: number }>; exec: (sql: string) => Promise<unknown> }
const ADM = 'aaaaaaaa-0000-4000-8000-000000000001'; // Administrador: transversal (como o operador do ensaio em produção)
const ENG = 'aaaaaaaa-0000-4000-8000-000000000002'; // Engenharia: só enxerga o que é dele (RLS por responsável)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let db: Banco;
let org = '';
/** tabela → coluna → é array do PostgreSQL (uuid[], text[])? jsonb vai como texto JSON, array vai como array */
const ehArray = new Map<string, Set<string>>();
/** tabela → colunas em que `authenticated` pode dar UPDATE (privilégio efetivo, lido do banco) */
const podeAtualizar = new Map<string, Set<string>>();
const atualizacoes: { tabela: string; colunas: string[]; linhas: number }[] = [];
const T: Record<'rascunho' | 'atrasada' | 'doEngenheiro', string> = { rascunho: '', atrasada: '', doEngenheiro: '' };

const normal = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
const param = (tabela: string, coluna: string, v: unknown) => (v !== null && typeof v === 'object' && !ehArray.get(tabela)?.has(coluna) ? JSON.stringify(v) : v);

/** Os helpers de produção (src/data/supabase.ts → persistirInbox) sobre o PGlite. `atualizar` é UPDATE por id SEM retorno. */
function helpers(uid: string): HelpersInbox {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows.map(normal);
  const inserirUm = async (tabela: string, r: Row) => {
    const cols = Object.keys(r);
    return (await q(`insert into ${tabela} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((c) => param(tabela, c, r[c]))))[0]!;
  };
  return {
    sel: (tabela, ordem, comId = true) => q(`select * from ${tabela} order by ${ordem}${comId ? ', id' : ''}`),
    inserir: async (tabela, rows) => { const out: Row[] = []; for (const r of rows) out.push(await inserirUm(tabela, r)); return out; },
    atualizar: async (tabela, id, row) => {
      const cols = Object.keys(row);
      const r = await db.query(`update ${tabela} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} where id = $${cols.length + 1}`, [...cols.map((c) => param(tabela, c, row[c])), id]);
      atualizacoes.push({ tabela, colunas: cols, linhas: r.affectedRows ?? 0 });
    },
    gravarComposta: async (tabela, chave, row) => {
      const cols = Object.keys(row); const ks = Object.keys(chave);
      const r = await db.query(`update ${tabela} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} where ${ks.map((k, i) => `${k} = $${cols.length + i + 1}`).join(' and ')}`, [...cols.map((c) => param(tabela, c, row[c])), ...ks.map((k) => chave[k])]);
      atualizacoes.push({ tabela, colunas: cols, linhas: r.affectedRows ?? 0 });
      if (!r.affectedRows) await inserirUm(tabela, { ...row, ...chave });
    },
    apagar: async (tabela, id) => { await q(`delete from ${tabela} where id = $1`, [id]); },
    rpc: async (nome, args) => { const ks = Object.keys(args); return (await q(`select ${nome}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, ks.map((k) => args[k])))[0]?.r as Row; },
    orgId: org, atorId: uid,
    uuid: (v) => (v && UUID.test(v) ? v : null),
    perfil: (v) => (v && UUID.test(v) ? v : null),
    obra: () => null, obraCodigo: () => undefined,
  };
}
const como = async <R>(uid: string, fn: () => Promise<R>): Promise<R> => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`); }
};
/** SQL cru como o usuário; devolve a mensagem do erro (ou undefined) e as linhas afetadas. */
const sqlComo = async (uid: string, sql: string, p: unknown[] = []): Promise<{ erro?: string; linhas: number }> =>
  como(uid, async () => { try { const r = await db.query(sql, p); return { linhas: r.affectedRows ?? 0 }; } catch (e) { return { erro: String((e as Error).message), linhas: 0 }; } });
const umaLinha = async (sql: string, p: unknown[] = []) => normal((await db.query(sql, p)).rows[0] ?? {});

/** Põe no store (modo local) o Inbox que o usuário LÊ do banco, e entra como esse usuário: o ponto de partida de uma sessão do app. */
async function abrirSessao(uid: string): Promise<InboxDataset> {
  const inbox = await como(uid, () => carregarInbox(helpers(uid)));
  actions.trocarUsuario('u-admin');
  const ds = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
  const modelo = ds.usuarios.find((u) => u.id === 'u-admin')!;
  ds.usuarios = [...ds.usuarios.filter((u) => u.id !== ADM && u.id !== ENG), { ...modelo, id: ADM, nome: 'Adm' }, { ...modelo, id: ENG, nome: 'Engenheiro', papel: 'Engenharia' }];
  ds.inbox = inbox;
  actions.importarJson(JSON.stringify(ds));
  actions.trocarUsuario(uid);
  expect(getState().usuario.id).toBe(uid);
  return getState().ds.inbox!;
}
/** Uma interação completa do app: carrega do banco, executa a ação de produção, persiste a diferença e RELÊ do banco. */
async function noApp(uid: string, acao: () => unknown | Promise<unknown>): Promise<InboxDataset> {
  const antes = await abrirSessao(uid);
  await acao();
  const depois = getState().ds.inbox!;
  atualizacoes.length = 0;
  await como(uid, () => persistirInbox(helpers(uid), antes, depois));
  return como(uid, () => carregarInbox(helpers(uid)));
}
const conversa = (i: InboxDataset, id: string): InboxThread => i.threads.find((t) => t.id === id)!;
const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** Conversa do portal criada pelo SERVIDOR (como o formulário do site), com prazo de 30 min e responsável. */
async function conversaDoPortal(sufixo: string, abertaHaMin: number, responsavel: string): Promise<string> {
  const r = await umaLinha(
    `select inbox_ingest($1::uuid, 'MANUAL', 'PORTAL', 'EXTERNAL', $2, $3, $4, null, $5, 'texto', $6::timestamptz) as d`,
    [org, `teste-${sufixo}@exemplo.invalido`, `Visitante ${sufixo} (fictício)`, `sub-${sufixo}`, `Solicitação fictícia ${sufixo}`, minutosAtras(abertaHaMin)]);
  const id = (r.d as Row).thread_id as string;
  await db.query(`update inbox_thread set sla_first_response_due = opened_at + interval '30 minutes' where id = $1`, [id]);
  const a = await como(ADM, () => umaLinha(`select inbox_assign_thread($1::uuid, 'COMERCIAL', null, $2::uuid, 'teste', 'manual') as d`, [id, responsavel]));
  expect((a.d as Row).ok).toBe(true);
  return id;
}

beforeAll(async () => {
  const comoPostgrest = (v: string) => v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'); // timestamptz como o PostgREST entrega
  ({ db } = await bancoComFila(path.resolve('.'), { parsers: { 1184: comoPostgrest } }));
  org = (await db.query(`select id from organization where code = 'EIFF'`)).rows[0]!.id as string;
  await db.query(`insert into profile (id, organization_id, name, email, role, active) values ($1, $3, 'Adm', 'adm@t', 'Administrador', true), ($2, $3, 'Engenheiro', 'eng@t', 'Engenharia', true)`, [ADM, ENG, org]);
  for (const c of (await db.query(`select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public' and table_name like 'inbox_%'`)).rows) {
    if (String(c.udt_name).startsWith('_')) ehArray.set(c.table_name as string, (ehArray.get(c.table_name as string) ?? new Set()).add(c.column_name as string));
  }
  for (const c of (await db.query(`select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and table_name like 'inbox_%' and grantee = 'authenticated' and privilege_type = 'UPDATE'`)).rows) {
    podeAtualizar.set(c.table_name as string, (podeAtualizar.get(c.table_name as string) ?? new Set()).add(c.column_name as string));
  }
  T.rascunho = await conversaDoPortal('a', 10, ADM);
  T.atrasada = await conversaDoPortal('b', 120, ADM);
  T.doEngenheiro = await conversaDoPortal('c', 10, ENG);
}, 180_000);

describe('contrato de colunas: o que o app manda no UPDATE × o que o banco concede', () => {
  it('o banco concede UPDATE em inbox_thread exatamente nas colunas mutáveis que o app declara', () => {
    expect([...podeAtualizar.get('inbox_thread')!].sort()).toEqual([...COLUNAS_MUTAVEIS_DA_CONVERSA].sort());
  });

  it('as colunas só da criação não têm UPDATE concedido, e as governadas (setor, equipe, responsável) também não', () => {
    const concedidas = podeAtualizar.get('inbox_thread')!;
    for (const c of [...COLUNAS_SO_DA_CRIACAO_DA_CONVERSA, 'sector_id', 'team_id', 'assignee_id']) expect(concedidas.has(c), c).toBe(false);
  });

  it('REPRODUÇÃO do incidente: incluir qualquer coluna só da criação faz o banco recusar o comando inteiro', async () => {
    for (const c of COLUNAS_SO_DA_CRIACAO_DA_CONVERSA) {
      const r = await sqlComo(ADM, `update inbox_thread set status = status, ${c} = ${c} where id = $1`, [T.rascunho]);
      expect(r.erro, c).toMatch(/permission denied for table inbox_thread/);
    }
    const ok = await sqlComo(ADM, `update inbox_thread set status = status where id = $1`, [T.rascunho]);
    expect(ok).toEqual({ linhas: 1 });
  });

  it('nas migrations, a única tabela do Inbox com UPDATE por coluna para o app é inbox_thread (uma nova exige revisar o adapter)', () => {
    const pasta = path.resolve('supabase', 'migrations');
    const sql = fs.readdirSync(pasta).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => fs.readFileSync(path.join(pasta, f), 'utf8')).join('\n');
    const comColuna = [...sql.matchAll(/grant\s+update\s*\(([^)]*)\)\s*on\s+(inbox_\w+)\s+to\s+authenticated/gi)];
    expect(new Set(comColuna.map((m) => m[2]))).toEqual(new Set(['inbox_thread']));
    const declaradas = comColuna.flatMap((m) => m[1]!.split(',').map((c) => c.trim()).filter(Boolean));
    expect([...new Set(declaradas)].sort()).toEqual([...COLUNAS_MUTAVEIS_DA_CONVERSA].sort());
    // as demais tabelas que o app atualiza têm UPDATE de tabela inteira: tudo o que o adapter mandar está concedido
    for (const t of ['inbox_action', 'inbox_job', 'inbox_contact', 'inbox_contact_identity', 'inbox_sector', 'inbox_team', 'inbox_member', 'inbox_config']) {
      expect(podeAtualizar.get(t)?.size ?? 0, t).toBeGreaterThan(0);
    }
  });
});

describe('alterações de conversa feitas por pessoa chegam ao banco (privilégios, RLS e gatilhos de produção)', () => {
  it('rascunho de resposta: mensagem e eventos gravados, conversa em atendimento, e o SLA NÃO é cumprido', async () => {
    const antes = await umaLinha(`select sla_first_response_due, opened_at, channel, provider, context, contact_id, origin from inbox_thread where id = $1`, [T.rascunho]);
    const lido = await noApp(ADM, () => actions.inboxResponder(T.rascunho, 'Rascunho de teste: ainda não falei com ninguém.'));
    const u = atualizacoes.filter((a) => a.tabela === 'inbox_thread');
    expect(u).toHaveLength(1);
    expect(u[0]!.linhas).toBe(1);
    expect([...u[0]!.colunas].sort()).toEqual([...COLUNAS_MUTAVEIS_DA_CONVERSA].sort());

    const t = conversa(lido, T.rascunho);
    expect(t.status).toBe('EM_ATENDIMENTO');
    expect(t.sla?.primeiraRespostaEm).toBeUndefined();
    expect(situacaoPrimeiraResposta(t)).toBe('aguardando');
    expect(t.participantes).toContain(ADM);
    const msgs = lido.mensagens.filter((m) => m.threadId === T.rascunho);
    expect(msgs.map((m) => [m.direcao, m.entrega ?? null])).toEqual([['inbound', null], ['outbound', 'registrada']]);
    expect(lido.eventos.filter((e) => e.threadId === T.rascunho).map((e) => e.tipo)).toEqual(expect.arrayContaining(['MESSAGE_REGISTERED', 'STATUS_CHANGED']));

    const depois = await umaLinha(`select sla_first_response_due, sla_first_response_at, opened_at, channel, provider, context, contact_id, origin, status from inbox_thread where id = $1`, [T.rascunho]);
    expect(depois).toMatchObject({ ...antes, sla_first_response_at: null, status: 'EM_ATENDIMENTO' }); // prazo e colunas da criação intactos
  });

  it('contato realizado: cumpre a primeira resposta com o horário DECLARADO; o registro fica com o relógio do banco', async () => {
    const declarado = minutosAtras(3);
    const prazo = (await umaLinha(`select sla_first_response_due as d from inbox_thread where id = $1`, [T.rascunho])).d;
    const lido = await noApp(ADM, () => actions.inboxRegistrarContato(T.rascunho, { resultado: 'realizado', meio: 'email', em: declarado, resumo: 'E-mail enviado ao visitante fictício confirmando o recebimento.' }));
    expect(atualizacoes.filter((a) => a.tabela === 'inbox_thread').map((a) => a.linhas)).toEqual([1]);

    const t = conversa(lido, T.rascunho);
    expect(Date.parse(t.sla!.primeiraRespostaEm!)).toBe(Date.parse(declarado));
    expect(t.sla!.primeiraRespostaAte).toBe(prazo); // o prazo original não é recalculado
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_no_prazo');
    // a lista vem por instante DECLARADO: o contato (3 min atrás) fica antes do rascunho (agora há pouco)
    const m = lido.mensagens.find((x) => x.threadId === T.rascunho && x.meta?.['contato'] === 'realizado')!;
    expect(m.entrega).toBe('entregue');
    expect(m.meta).toMatchObject({ contato: 'realizado', contatoMeio: 'email' });
    expect(m.autor).toMatchObject({ tipo: 'usuario', id: ADM });
    // horário real do contato × horário em que o registro entrou no banco: dois instantes, nunca confundidos
    expect(Date.parse(m.em)).toBe(Date.parse(declarado));
    expect(Date.parse(m.registradaEm!)).toBeGreaterThan(Date.parse(declarado) + 60_000);
    expect(lido.eventos.some((e) => e.threadId === T.rascunho && e.tipo === 'MESSAGE_REGISTERED' && /contato realizado por/.test(e.detalhe) && /dentro do prazo/.test(e.detalhe))).toBe(true);
  });

  it('um segundo contato não mexe na primeira resposta já registrada', async () => {
    const primeira = (await umaLinha(`select sla_first_response_at as d from inbox_thread where id = $1`, [T.rascunho])).d;
    const lido = await noApp(ADM, () => actions.inboxRegistrarContato(T.rascunho, { resultado: 'realizado', meio: 'telefone', em: minutosAtras(1), resumo: 'Liguei em seguida para combinar a visita técnica.' }));
    expect(conversa(lido, T.rascunho).sla!.primeiraRespostaEm).toBe(primeira);
    expect(lido.mensagens.filter((m) => m.threadId === T.rascunho)).toHaveLength(4);
  });

  it('alteração de status: grava o estado e o evento', async () => {
    const lido = await noApp(ADM, () => actions.inboxMudarStatus(T.rascunho, 'AGUARDANDO_CONTATO'));
    expect(atualizacoes.filter((a) => a.tabela === 'inbox_thread').map((a) => a.linhas)).toEqual([1]);
    expect(conversa(lido, T.rascunho).status).toBe('AGUARDANDO_CONTATO');
    expect((await umaLinha(`select status from inbox_thread where id = $1`, [T.rascunho])).status).toBe('AGUARDANDO_CONTATO');
    expect(lido.eventos.filter((e) => e.threadId === T.rascunho && e.depois === 'AGUARDANDO_CONTATO')).toHaveLength(1);
  });

  it('nota interna e prioridade também persistem', async () => {
    let lido = await noApp(ADM, () => actions.inboxAnotar(T.rascunho, 'Nota interna de teste.'));
    expect(lido.mensagens.filter((m) => m.threadId === T.rascunho && m.direcao === 'interna')).toHaveLength(1);
    lido = await noApp(ADM, () => actions.inboxMudarPrioridade(T.rascunho, 'Alta', 'teste'));
    expect(conversa(lido, T.rascunho).prioridade).toBe('Alta');
  });

  it('contato depois do vencimento: registrado, e continua reconhecido como FORA do prazo', async () => {
    const prazo = (await umaLinha(`select sla_first_response_due as d from inbox_thread where id = $1`, [T.atrasada])).d as string;
    expect(Date.parse(prazo)).toBeLessThan(Date.now()); // aberta há 2 h, prazo de 30 min
    const declarado = minutosAtras(5);
    const lido = await noApp(ADM, () => actions.inboxRegistrarContato(T.atrasada, { resultado: 'realizado', meio: 'telefone', em: declarado, resumo: 'Falei com o visitante fictício, com atraso.' }));
    const t = conversa(lido, T.atrasada);
    expect(Date.parse(t.sla!.primeiraRespostaEm!)).toBe(Date.parse(declarado));
    expect(t.sla!.primeiraRespostaAte).toBe(prazo);
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_fora_do_prazo');
  });

  it('tentativa sem sucesso: vira nota marcada e não cumpre o SLA', async () => {
    const lido = await noApp(ENG, () => actions.inboxRegistrarContato(T.doEngenheiro, { resultado: 'tentativa', meio: 'telefone', em: minutosAtras(2), resumo: 'Liguei duas vezes, ninguém atendeu.' }));
    const t = conversa(lido, T.doEngenheiro);
    expect(t.sla?.primeiraRespostaEm).toBeUndefined();
    expect(lido.mensagens.find((m) => m.threadId === T.doEngenheiro && m.meta?.['contato'] === 'tentativa')).toMatchObject({ direcao: 'interna', tipo: 'nota' });
  });
});

describe('RLS e gatilhos de autoridade continuam valendo', () => {
  it('o responsável que não é transversal grava na conversa DELE (rascunho e contato)', async () => {
    let lido = await noApp(ENG, () => actions.inboxResponder(T.doEngenheiro, 'Rascunho do engenheiro.'));
    expect(atualizacoes.filter((a) => a.tabela === 'inbox_thread').map((a) => a.linhas)).toEqual([1]);
    expect(conversa(lido, T.doEngenheiro).status).toBe('EM_ATENDIMENTO');
    lido = await noApp(ENG, () => actions.inboxRegistrarContato(T.doEngenheiro, { resultado: 'realizado', meio: 'whatsapp_externo', em: minutosAtras(1), resumo: 'Conversei com o visitante fictício pelo WhatsApp.' }));
    expect(situacaoPrimeiraResposta(conversa(lido, T.doEngenheiro))).toBe('respondida_no_prazo');
  });

  it('quem não é responsável nem transversal não enxerga nem altera a conversa dos outros', async () => {
    const visiveis = await como(ENG, () => carregarInbox(helpers(ENG)));
    expect(visiveis.threads.map((t) => t.id)).toEqual([T.doEngenheiro]);
    const r = await sqlComo(ENG, `update inbox_thread set status = 'RESOLVIDA', resolved_at = now() where id = $1`, [T.atrasada]);
    expect(r).toEqual({ linhas: 0 }); // a RLS filtra em silêncio
    expect((await umaLinha(`select status from inbox_thread where id = $1`, [T.atrasada])).status).not.toBe('RESOLVIDA');
  });

  it('setor e responsável continuam fora do alcance do UPDATE direto, mesmo para o Administrador', async () => {
    const r = await sqlComo(ADM, `update inbox_thread set assignee_id = $2 where id = $1`, [T.rascunho, ENG]);
    expect(r.erro).toMatch(/permission denied for table inbox_thread/);
  });

  it('em nenhuma gravação desta suíte o app mandou UPDATE em coluna sem privilégio', async () => {
    const lido = await noApp(ADM, () => actions.inboxMudarStatus(T.atrasada, 'RESOLVIDA'));
    expect(conversa(lido, T.atrasada).status).toBe('RESOLVIDA');
    expect(atualizacoes.length).toBeGreaterThan(0);
    for (const a of atualizacoes) for (const c of a.colunas) expect(podeAtualizar.get(a.tabela)?.has(c), `${a.tabela}.${c}`).toBe(true);
  });
});
