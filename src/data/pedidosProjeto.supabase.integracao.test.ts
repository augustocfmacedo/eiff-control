// E11.2C — o ADAPTADOR SUPABASE de solicitações de projeto contra um PostgreSQL DESCARTÁVEL (PGlite) com a FILA INTEIRA de
// migrations + docs/propostas/comercial-acesso.proposta.sql (partes 1 e 2) + docs/propostas/pedido-projeto.proposta.sql.
// Cada chamada roda como um usuário de verdade (papel authenticated + auth.uid()), com a RLS e as funções das propostas:
// o teste não contorna o banco. Dados FICTÍCIOS. Nada toca produção.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { bancoComFila } from '../../scripts/lib/pgliteFila.mjs';
import { CAMPOS_PROIBIDOS_PEDIDO, ErroPedido, type DadosAcao, type EntradaPedido } from '../core/comercial/pedidoProjeto';
import { repositorioSupabase, type ClientePedidos } from './pedidosProjeto.supabase';

type Row = Record<string, unknown>;
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<unknown>; dumpDataDir?: () => Promise<Blob | File> }
const RAIZ = path.resolve('.');
const U = {
  adm: 'eeeeeeee-0000-4000-8000-000000000001', dir: 'eeeeeeee-0000-4000-8000-000000000002', com: 'eeeeeeee-0000-4000-8000-000000000003',
  eng: 'eeeeeeee-0000-4000-8000-000000000004', eng2: 'eeeeeeee-0000-4000-8000-000000000005', fin: 'eeeeeeee-0000-4000-8000-000000000006',
  contab: 'eeeeeeee-0000-4000-8000-000000000007', sol: 'eeeeeeee-0000-4000-8000-000000000008', adm2: 'eeeeeeee-0000-4000-8000-0000000000b1',
};
const TIPOS: Record<string, string> = { p: 'jsonb', p_intencao: 'text', p_id: 'uuid', p_acao: 'text', p_dados: 'jsonb', p_versao: 'integer', p_tipo: 'text', p_extensao: 'text', p_caminho: 'text', p_nome: 'text', p_mime: 'text', p_tamanho: 'bigint', p_arquivo: 'uuid', p_motivo: 'text' };
let db: Banco;
let org = '', org2 = '', emp = '', op = '', emp2 = '', op2 = '', opInativa = '', orc = '';
let id = ''; // a solicitação do ciclo completo (usada também pelos testes adversariais)
const normal = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

/** cliente com a MESMA forma do supabase-js (rpc → { data, error }), executando como o usuário `uid` numa transação */
function cliente(uid: string, banco: () => Banco = () => db): ClientePedidos {
  const comoUsuario = async <T>(fn: (b: Banco) => Promise<T>) => {
    const b = banco();
    await b.exec('begin;');
    try {
      await b.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
      const v = await fn(b);
      await b.exec('commit;');
      return { v, erro: null as { message: string; code?: string } | null };
    } catch (e) {
      try { await b.exec('rollback;'); } catch { /* já desfeita */ }
      const err = e as { message?: string; code?: string };
      return { v: undefined as T | undefined, erro: { message: String(err.message ?? e), code: err.code } };
    }
  };
  return {
    async rpc(nome, args) {
      const ks = Object.keys(args);
      const sql = `select ${nome}(${ks.map((k, i) => `${k} => $${i + 1}::${TIPOS[k] ?? 'text'}`).join(', ')}) as r`;
      const valores = ks.map((k) => (TIPOS[k] === 'jsonb' ? JSON.stringify(args[k]) : args[k]));
      const { v, erro } = await comoUsuario((b) => b.query(sql, valores));
      return { data: v ? normal(v.rows[0]?.r) : null, error: erro };
    },
    async enviarArquivo(bucket, caminho, _conteudo, mime) {
      const { erro } = await comoUsuario((b) => b.query(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)`, [bucket, caminho, JSON.stringify({ mimetype: mime })]));
      return { error: erro };
    },
  };
}
const repo = (uid: string) => repositorioSupabase(cliente(uid));
let nInt = 0;
const int = () => `int-${++nInt}`;
const erroDe = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ErroPedido ? e.codigo : `ERRO: ${(e as Error).message.slice(0, 80)}`; } };
const direto = async (uid: string, sql: string, p: unknown[] = []) => {
  await db.exec('begin;');
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
    const r = await db.query(sql, p);
    await db.exec('rollback;');
    return { linhas: r.rows.length, r: r.rows, erro: null as string | null };
  } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return { linhas: 0, r: [] as Row[], erro: String((e as Error).message) }; }
};
const entrada = (extra: Partial<EntradaPedido> = {}): EntradaPedido => ({
  empresaId: emp, oportunidadeId: op, origemLead: 'SIMULADOR', tipo: 'Anteprojeto estrutural', prioridade: 'Alta', prazoSolicitado: '2026-11-30',
  responsavelComercialId: U.com, dados: { cidade: 'Anápolis', uf: 'GO', comprimentoM: 60, larguraM: 24, alturaM: 9, observacoes: 'Ponte rolante de 10 t declarada pelo cliente' },
  documentos: { arquitetura: 'pendente', sondagem: 'recebido' }, ...extra,
});
const agir = async (uid: string, id: string, acao: Parameters<ReturnType<typeof repo>['agir']>[1], d: Omit<DadosAcao, 'versao'> = {}, intencao = int()) => {
  const atual = await repo(U.adm).obter(id);
  return repo(uid).agir(id, acao, { ...d, versao: atual!.versao }, intencao);
};

async function aplicarPropostas(b: Banco) {
  const [ca1, ca2] = fs.readFileSync(path.join(RAIZ, 'docs/propostas/comercial-acesso.proposta.sql'), 'utf8').split('-- @@PARTE2@@');
  for (const sql of [ca1, ca2, fs.readFileSync(path.join(RAIZ, 'docs/propostas/pedido-projeto.proposta.sql'), 'utf8')]) { await b.exec('begin;'); await b.exec(sql); await b.exec('commit;'); }
}

beforeAll(async () => {
  ({ db } = await bancoComFila(RAIZ));
  await aplicarPropostas(db);
  await aplicarPropostas(db); // reaplicar é inofensivo
  org = (await db.query(`select id from organization where code = 'EIFF'`)).rows[0].id as string;
  org2 = (await db.query(`insert into organization (code, name) values ('OUTRA', 'Outra (fictícia)') returning id`)).rows[0].id as string;
  const papeis: [string, string][] = [[U.adm, 'Administrador'], [U.dir, 'Diretoria'], [U.com, 'Comercial'], [U.eng, 'Engenharia'], [U.eng2, 'Engenharia'], [U.fin, 'Financeiro'], [U.contab, 'Contabilidade'], [U.sol, 'Solicitante']];
  for (const [id, papel] of papeis) await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, $3, $4, $5)`, [id, org, `Perfil ${papel}`, `${id.slice(-3)}@exemplo`, papel]);
  await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Adm da outra', 'b1@exemplo', 'Administrador')`, [U.adm2, org2]);
  emp = (await db.query(`insert into radar_company (organization_id, legal_name, trade_name, active) values ($1, 'Metalforte Implementos Ltda (fictícia)', 'Metalforte', true) returning id`, [org])).rows[0].id as string;
  await db.query(`insert into radar_contact (organization_id, company_id, full_name, email, phone, active, status) values ($1, $2, 'Contato Fictício Particular', 'particular@exemplo', '+5562900000000', true, 'ATIVO')`, [org, emp]);
  op = (await db.query(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value, probability, owner_id, next_action_at, notes) values ($1, $2, 'Galpão com ponte rolante (fictício)', 'NEED_CONFIRMED', 980000, 0.4, $3, now() + interval '3 days', 'cliente pediu desconto de 7%') returning id`, [org, emp, U.com])).rows[0].id as string;
  emp2 = (await db.query(`insert into radar_company (organization_id, legal_name, active) values ($1, 'Outra empresa (fictícia)', true) returning id`, [org])).rows[0].id as string;
  op2 = (await db.query(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id, next_action_at) values ($1, $2, 'Outra', 'QUALIFIED', 0.1, $3, now() + interval '3 days') returning id`, [org, emp2, U.com])).rows[0].id as string;
  opInativa = (await db.query(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id) values ($1, $2, 'Nutrição', 'NURTURE', 0, $3) returning id`, [org, emp, U.com])).rows[0].id as string;
  orc = (await db.query(`insert into estimate (organization_id, code, title) values ($1, 'ORC-T1', 'Orçamento técnico fictício') returning id`, [org])).rows[0].id as string;
}, 180_000);

describe('E11.2C · persistência das solicitações de projeto (adaptador Supabase sobre PostgreSQL descartável)', () => {

  it('1 · ciclo completo Comercial → Engenharia → Comercial, persistido, com histórico completo', async () => {
    const criada = await repo(U.com).criar(entrada(), 'abrir-1');
    id = criada.id;
    expect(criada).toMatchObject({ codigo: 'SP-0001', versaoTipo: 1, situacao: 'SOLICITADO', oportunidadeId: op, empresaNome: 'Metalforte' });
    expect(criada.dados.larguraM).toEqual({ dado: 24, situacao: 'declarado' });
    // aparece na fila de triagem da Engenharia autorizada
    expect((await repo(U.eng).listar()).map((p) => p.id)).toEqual([id]);
    // atribuída a um responsável e triada
    await agir(U.dir, id, 'atribuir', { responsavelTecnicoId: U.eng, equipeTecnica: 'Engenharia estrutural' });
    await agir(U.eng, id, 'iniciar_triagem');
    await agir(U.eng, id, 'registrar_triagem', { validar: ['cidade', 'uf', 'larguraM'], nota: 'Vão conferido no croqui' });
    // recebe pendências e volta ao Comercial
    let p = await agir(U.eng, id, 'pedir_dados', { motivo: 'Falta a arquitetura e a cota do trilho', pendencias: ['Planta de arquitetura', 'Cota do trilho da ponte rolante'] });
    expect(p.situacao).toBe('DADOS_PENDENTES');
    // Comercial complementa e devolve à Engenharia
    await agir(U.com, id, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'recebido', referencia: 'arquitetura-r01.pdf' } });
    p = await agir(U.com, id, 'responder_pendencias', { resposta: 'Arquitetura r01 enviada; trilho a 7 m' });
    expect(p.situacao).toBe('TRIAGEM_TECNICA');
    expect(p.pendencias.every((x) => !x.aberta && x.resposta)).toBe(true);
    // desenvolvida e entregue
    await agir(U.eng, id, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'validado' } });
    await agir(U.eng, id, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-28' });
    await agir(U.eng, id, 'registrar_andamento', { nota: 'Pórticos pré-dimensionados' });
    p = await agir(U.eng, id, 'entregar', { entrega: { resumo: 'Anteprojeto estrutural entregue', resultados: 'Pórticos de alma cheia a cada 6 m', referencias: ['anteprojeto-r00.pdf'] } });
    expect(p.situacao).toBe('ENTREGUE');
    // encerrada pelo Comercial, com o orçamento técnico vinculado
    p = await agir(U.com, id, 'encerrar', { resultado: { tipo: 'ORCAMENTO_VINCULADO', orcamentoId: orc } });
    expect(p).toMatchObject({ situacao: 'ENCERRADO', vinculos: { orcamentoId: orc }, responsavelTecnicoId: U.eng, prazoEntrega: '2026-11-28' });
    expect(p.dados.larguraM).toMatchObject({ situacao: 'validado', validadoPor: U.eng });
    const ev = await repo(U.com).eventos(id);
    expect(ev.map((e) => e.acao)).toEqual(['criar', 'atribuir', 'iniciar_triagem', 'registrar_triagem', 'pedir_dados', 'atualizar_documento', 'responder_pendencias', 'atualizar_documento', 'assumir_desenvolvimento', 'registrar_andamento', 'entregar', 'encerrar']);
    expect(ev.find((e) => e.acao === 'pedir_dados')).toMatchObject({ de: 'TRIAGEM_TECNICA', para: 'DADOS_PENDENTES', por: U.eng, papel: 'Engenharia', motivo: 'Falta a arquitetura e a cota do trilho' });
    expect(ev.every((e) => e.intencao)).toBe(true);
    // o estágio da oportunidade no Radar NÃO mudou
    expect((await db.query(`select stage from radar_opportunity where id = $1`, [op])).rows[0].stage).toBe('NEED_CONFIRMED');
    // estado final não admite alteração
    expect(await erroDe(agir(U.adm, id, 'cancelar', { motivo: 'tentativa depois de encerrada' }))).toBe('ESTADO_FINAL');
  });

  it('2 · persistência após reinicialização do adaptador E do banco (dump do diretório de dados → novo PGlite)', async () => {
    const novoAdaptador = repositorioSupabase(cliente(U.com)); // nenhum estado em memória no adaptador
    expect((await novoAdaptador.obter(id))?.situacao).toBe('ENCERRADO');
    expect(await novoAdaptador.eventos(id)).toHaveLength(12);
    if (!db.dumpDataDir) return;
    const copia = await db.dumpDataDir();
    const db2 = new PGlite({ loadDataDir: copia, extensions: { pgcrypto } }) as unknown as Banco;
    const depois = repositorioSupabase(cliente(U.com, () => db2));
    expect((await depois.obter(id))?.situacao).toBe('ENCERRADO');
    expect((await depois.eventos(id)).map((e) => e.acao)).toEqual((await novoAdaptador.eventos(id)).map((e) => e.acao));
    expect((await repositorioSupabase(cliente(U.eng, () => db2)).listar()).some((p) => p.id === id)).toBe(true);
  }, 120_000);

  it('3 · isolamento por organização e por perfil (API e consulta direta)', async () => {
    for (const uid of [U.adm2, U.fin, U.contab, U.sol]) {
      expect(await repo(uid).listar(), uid).toEqual([]);
      expect(await repo(uid).obter(id), uid).toBeUndefined();
      expect(await repo(uid).eventos(id), uid).toEqual([]);
    }
    expect(await erroDe(repo(U.adm2).criar(entrada({ tipo: 'Projeto executivo' }), int()))).not.toBe('OK');
    for (const uid of [U.fin, U.contab, U.sol]) expect(await erroDe(repo(uid).criar(entrada({ tipo: 'Projeto executivo' }), int())), uid).toBe('SEM_PERMISSAO');
    // consulta direta às tabelas: Engenharia, Financeiro e outra organização não leem nada; a gestão lê (auditoria)
    for (const t of ['project_request', 'project_request_field', 'project_request_document', 'project_request_pending', 'project_request_event', 'project_request_file']) {
      for (const uid of [U.eng, U.fin, U.adm2, U.sol]) expect((await direto(uid, `select * from ${t}`)).linhas, `${uid} ${t}`).toBe(0);
    }
    expect((await direto(U.dir, `select * from project_request`)).linhas).toBeGreaterThan(0);
    // escrita direta recusada para todos, inclusive a gestão
    for (const uid of [U.adm, U.com, U.eng]) {
      expect((await direto(uid, `update project_request set status = 'ENTREGUE' where id = $1`, [id])).erro, uid).toMatch(/permission denied/);
      expect((await direto(uid, `insert into project_request_event (organization_id, request_id, action, to_status, actor_id, actor_role, intent) values ($1, $2, 'x', 'ENTREGUE', $3, 'x', 'forjada')`, [org, id, uid])).erro, uid).toMatch(/permission denied/);
    }
  });

  it('4 · Engenharia não recebe dados comerciais no payload da API', async () => {
    const p2 = await repo(U.com).criar(entrada({ tipo: 'Análise técnica' }), int());
    const visto = await repo(U.eng).obter(p2.id);
    expect(visto).toBeDefined();
    expect('oportunidadeId' in visto!).toBe(false);
    expect('vinculos' in visto!).toBe(false);
    const chaves = new Set<string>();
    const visitar = (x: unknown) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { chaves.add(k); visitar(v); } };
    visitar(await repo(U.eng).listar()); visitar(await repo(U.eng).eventos(p2.id));
    for (const c of CAMPOS_PROIBIDOS_PEDIDO) expect(chaves.has(c), c).toBe(false);
    const texto = JSON.stringify(await repo(U.eng).listar());
    for (const s of ['Galpão com ponte rolante', '980000', 'desconto de 7%', 'Contato Fictício Particular', 'particular@exemplo', '+5562900000000', op]) expect(texto.includes(s), s).toBe(false);
    // a gestão comercial recebe a oportunidade
    expect((await repo(U.com).obter(p2.id))?.oportunidadeId).toBe(op);
    await agir(U.com, p2.id, 'cancelar', { motivo: 'limpeza do teste' });
  });

  it('5 · triagem compartilhada, atribuição individual e só o responsável age', async () => {
    const p = await repo(U.com).criar(entrada({ tipo: 'Estudo preliminar' }), int());
    expect((await repo(U.eng).listar()).some((x) => x.id === p.id)).toBe(true);
    expect((await repo(U.eng2).listar()).some((x) => x.id === p.id)).toBe(true);
    await agir(U.eng, p.id, 'iniciar_triagem');
    expect(await repo(U.eng2).obter(p.id)).toBeUndefined();
    expect(await repo(U.eng2).eventos(p.id)).toEqual([]);
    expect(await erroDe(agir(U.eng2, p.id, 'registrar_triagem', { nota: 'tentativa' }))).toBe('SEM_PERMISSAO');
    await agir(U.dir, p.id, 'atribuir', { responsavelTecnicoId: U.eng2 });
    expect(await repo(U.eng).obter(p.id)).toBeUndefined();
    expect((await repo(U.eng2).obter(p.id))?.responsavelTecnicoId).toBe(U.eng2);
    expect(await erroDe(agir(U.eng, p.id, 'registrar_triagem', { nota: 'não é mais dele' }))).toBe('SEM_PERMISSAO'); // reatribuída: sumiu da vista do ENG
    expect(await erroDe(agir(U.eng2, p.id, 'atualizar_documento', { documento: { tipo: 'sondagem', situacao: 'recebido' } }))).toBe('SEM_PERMISSAO'); // receber documento é do Comercial
    await agir(U.com, p.id, 'cancelar', { motivo: 'limpeza do teste' });
  });

  it('6 · concorrência, versão e idempotência por intenção', async () => {
    const a = await repo(U.com).criar(entrada({ tipo: 'Estudo preliminar' }), 'clique-duplo');
    const b = await repo(U.com).criar(entrada({ tipo: 'Estudo preliminar' }), 'clique-duplo');
    expect(b.id).toBe(a.id);
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Estudo preliminar' }), int()))).toBe('DUPLICADA');
    // dois usuários agindo sobre a MESMA versão: o primeiro passa, o segundo recebe conflito
    const v = (await repo(U.adm).obter(a.id))!.versao;
    const [r1, r2] = await Promise.all([
      repo(U.eng).agir(a.id, 'iniciar_triagem', { versao: v }, int()).then(() => 'OK', (e) => (e as ErroPedido).codigo),
      repo(U.dir).agir(a.id, 'atribuir', { versao: v, equipeTecnica: 'Projetos e detalhamento' }, int()).then(() => 'OK', (e) => (e as ErroPedido).codigo),
    ]);
    expect([r1, r2].sort()).toEqual(['OK', 'VERSAO_DESATUALIZADA']);
    // repetir a mesma intenção não aplica duas vezes
    const v2 = (await repo(U.adm).obter(a.id))!.versao;
    const n1 = await repo(U.dir).agir(a.id, 'atribuir', { versao: v2, equipeTecnica: 'Orçamento técnico' }, 'reenvio-1');
    const n2 = await repo(U.dir).agir(a.id, 'atribuir', { versao: v2, equipeTecnica: 'Orçamento técnico' }, 'reenvio-1');
    expect(n2.versao).toBe(n1.versao);
    expect((await repo(U.dir).eventos(a.id)).filter((e) => e.intencao === 'reenvio-1')).toHaveLength(1);
    // versões por oportunidade e tipo
    await agir(U.com, a.id, 'cancelar', { motivo: 'refazer com escopo novo' });
    expect((await repo(U.com).criar(entrada({ tipo: 'Estudo preliminar' }), int())).versaoTipo).toBe(3);
  });

  it('7 · histórico imutável para os papéis da aplicação; UPDATE/DELETE comum do dono também barrado pelo gatilho (não absoluto: o dono pode desligar gatilhos)', async () => {
    await expect(db.query(`update project_request_event set reason = 'adulterado' where request_id = $1`, [id])).rejects.toThrow(/imutáveis/);
    await expect(db.query(`delete from project_request_event where request_id = $1`, [id])).rejects.toThrow(/imutáveis/);
    await expect(db.query(`delete from project_request where id = $1`, [id])).rejects.toThrow(/imutáveis/);
  });

  it('8 · falha no meio da operação desfaz tudo (atomicidade)', async () => {
    const p = await repo(U.com).criar(entrada({ tipo: 'Projeto executivo' }), int());
    await agir(U.eng, p.id, 'iniciar_triagem');
    await agir(U.eng, p.id, 'assumir_desenvolvimento', { prazoEntrega: '2026-12-01' });
    const antes = await repo(U.adm).obter(p.id);
    const eventosAntes = (await repo(U.adm).eventos(p.id)).length;
    // falha forçada DEPOIS do update da solicitação (no insert do evento): a transação inteira volta
    await db.exec(`create or replace function teste_falha() returns trigger language plpgsql as $$ begin if new.action = 'registrar_andamento' then raise exception 'falha simulada'; end if; return new; end $$;
      create trigger teste_falha before insert on project_request_event for each row execute function teste_falha();`);
    expect(await erroDe(agir(U.eng, p.id, 'registrar_andamento', { nota: 'vai falhar' }))).toMatch(/falha simulada/);
    await db.exec(`drop trigger teste_falha on project_request_event; drop function teste_falha();`);
    const depois = await repo(U.adm).obter(p.id);
    expect(depois?.versao).toBe(antes?.versao);
    expect((await repo(U.adm).eventos(p.id)).length).toBe(eventosAntes);
    await agir(U.com, p.id, 'cancelar', { motivo: 'limpeza do teste' });
  });

  it('9 · vínculos oficiais só por id e regras de entrada', async () => {
    expect(await erroDe(repo(U.com).criar(entrada({ oportunidadeId: op2, tipo: 'Projeto executivo' }), int()))).toBe('VINCULO_INVALIDO');
    expect(await erroDe(repo(U.com).criar(entrada({ oportunidadeId: opInativa, tipo: 'Projeto executivo' }), int()))).toBe('VINCULO_INVALIDO');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', vinculos: { inboxThreadId: '00000000-0000-4000-8000-000000000000' } }), int()))).toBe('VINCULO_INVALIDO');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', vinculos: { submissaoId: 'sub-inexistente' } }), int()))).toBe('VINCULO_INVALIDO');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', vinculos: { submissaoId: '6af379040c7080bc34020601' } }), int()))).toBe('ENSAIO');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', vinculos: { orcamentoId: orc } }), int()))).toBe('DADOS_INCOMPLETOS');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', dados: { cidade: 'Goiânia', uf: 'GO' } }), int()))).toBe('DADOS_INCOMPLETOS');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Projeto executivo', dados: { cidade: 'Goiânia', uf: 'GO', larguraM: -3 } }), int()))).toBe('DADOS_INCOMPLETOS');
    // nenhuma empresa ou oportunidade foi criada pelas tentativas
    expect((await db.query(`select count(*)::int as n from radar_company`)).rows[0].n).toBe(2);
  });

  it('10 · pendências: quem pediu, quem responde (responsável comercial), resposta e resolução', async () => {
    const pend = await db.query(`select description, requested_by, answer_owner_id, answer, resolved_by, status from project_request_pending where request_id = $1 order by opened_at`, [id]);
    expect(pend.rows).toHaveLength(2);
    for (const x of pend.rows) expect(x).toMatchObject({ requested_by: U.eng, answer_owner_id: U.com, resolved_by: U.com, status: 'respondida', answer: 'Arquivo r01 enviada; trilho a 7 m'.replace('Arquivo', 'Arquitetura') });
  });

  it('11 · documentos: versões, permissões, tipo e tamanho, remoção lógica', async () => {
    const p = await repo(U.com).criar(entrada({ tipo: 'Projeto executivo' }), int());
    const arq = (nome: string, tamanho = 1024, mime = 'application/pdf', extensao = 'pdf') => ({ nome, mime, extensao, conteudo: new Uint8Array([1, 2, 3]), tamanho });
    const v1 = await repo(U.com).anexar(p.id, 'arquitetura', arq('arquitetura-r01.pdf'), int());
    const v2 = await repo(U.com).anexar(p.id, 'arquitetura', arq('arquitetura-r02.pdf'), int());
    expect([v1.versao, v2.versao]).toEqual([1, 2]);
    expect(v1.caminho.startsWith(`${org}/${p.id}/`)).toBe(true);
    // a Engenharia (fila de triagem, sem responsável) anexa documento técnico; o entregável é do responsável
    expect(await erroDe(repo(U.eng).anexar(p.id, 'entregavel', arq('entrega.pdf'), int()))).toBe('SEM_PERMISSAO');
    await agir(U.eng, p.id, 'iniciar_triagem');
    expect((await repo(U.eng).anexar(p.id, 'entregavel', arq('entrega.pdf'), int())).versao).toBe(1);
    // outro engenheiro, outra organização e o Financeiro não anexam nem leem
    for (const uid of [U.eng2, U.adm2, U.fin]) {
      expect(await erroDe(repo(uid).anexar(p.id, 'complementar', arq('x.pdf'), int())), uid).toBe('SEM_PERMISSAO');
      expect(await repo(uid).arquivos(p.id), uid).toEqual([]);
      expect((await direto(uid, `select * from storage.objects where bucket_id = 'projetos-tecnicos'`)).linhas, uid).toBe(0);
    }
    // tipo e tamanho
    expect(await erroDe(repo(U.com).anexar(p.id, 'complementar', arq('virus.exe', 10, 'application/x-msdownload', 'exe'), int()))).toBe('DADOS_INCOMPLETOS');
    expect(await erroDe(repo(U.com).anexar(p.id, 'complementar', arq('grande.pdf', 30 * 1024 * 1024), int()))).not.toBe('OK');
    // remoção lógica: exige motivo; o arquivo e a versão ficam
    expect(await erroDe(repo(U.com).removerArquivo((await repo(U.com).arquivos(p.id))[0].id, '', int()))).toBe('MOTIVO_OBRIGATORIO');
    await repo(U.com).removerArquivo((await repo(U.com).arquivos(p.id)).find((a) => a.versao === 1 && a.tipo === 'arquitetura')!.id, 'Substituída pela revisão r02', int());
    const lista = await repo(U.com).arquivos(p.id);
    expect(lista).toHaveLength(3);
    expect(lista.find((a) => a.tipo === 'arquitetura' && a.versao === 1)).toMatchObject({ motivoRemocao: 'Substituída pela revisão r02' });
    await expect(db.query(`update project_request_file set file_name = 'trocado' where request_id = $1`, [p.id])).rejects.toThrow(/imutável/);
    // bucket próprio, nunca o financeiro
    expect((await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'anexos-financeiros'`)).rows[0].n).toBe(0);
  });
});

describe('E11.2C · revisão de segurança: testes adversariais (PGlite)', () => {
  let opAdv = '';
  beforeAll(async () => {
    // oportunidade própria: os cenários abaixo não esbarram nas solicitações abertas dos testes anteriores
    opAdv = (await db.query(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id, next_action_at) values ($1, $2, 'Adversarial (fictícia)', 'QUALIFIED', 0.2, $3, now() + interval '3 days') returning id`, [org, emp, U.com])).rows[0].id as string;
  });
  const comoAnon = async (sql: string) => {
    await db.exec('begin;');
    try { await db.exec(`set local role anon;`); await db.query(sql); await db.exec('rollback;'); return 'executou'; }
    catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return String((e as Error).message); }
  };

  it('A · catálogo: toda função SECURITY DEFINER da proposta tem search_path fixo; anon não executa nenhuma pp_*', async () => {
    const funcs = (await db.query(`select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as autenticado
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'pp\\_%' or p.proname like 'project\\_request%')`)).rows;
    expect(funcs.length).toBeGreaterThan(20);
    const definerSemPath = funcs.filter((f) => f.prosecdef && !(f.proconfig as string[] | null)?.some((c) => c.startsWith('search_path=')));
    expect(definerSemPath.map((f) => f.proname)).toEqual([]);
    expect(funcs.filter((f) => f.anon).map((f) => f.proname)).toEqual([]);
    // internas: nem authenticated executa
    for (const nome of ['pp_json', 'pp_eu', 'pp_texto', 'pp_dados', 'pp_conferir_dados', 'project_request_coerencia', 'project_request_imutavel'])
      expect(funcs.find((f) => f.proname === nome)?.autenticado, nome).toBe(false);
  });

  it('B · a projeção interna não pode ser usada para ler outra solicitação (linha montada pelo chamador)', async () => {
    const r = await direto(U.eng2, `select pp_json(row(r.*)::project_request, false) from project_request r limit 1`);
    // mesmo que o chamador tente, nem chega a ler: sem EXECUTE (e sem SELECT na tabela)
    expect(r.erro).toMatch(/permission denied/);
    const forjada = await direto(U.eng2, `select pp_json(row($1::uuid, $2::uuid, 'SP-X', 1, $3::uuid, $4::uuid, null, null, null, null, 'OUTRO', 'Estudo preliminar', 'Normal', null, $5::uuid, null, null, null, 'SOLICITADO', null, null, null, 1, now(), $5::uuid, now())::project_request, false)`, [id, org, emp, op, U.com]);
    expect(forjada.erro).toMatch(/permission denied/);
  });

  it('C · anon não lê tabela nem chama função', async () => {
    expect(await comoAnon(`select * from project_request`)).toMatch(/permission denied/);
    expect(await comoAnon(`select pp_listar()`)).toMatch(/permission denied/);
    expect(await comoAnon(`select pp_criar('{}'::jsonb, 'x')`)).toMatch(/permission denied/);
  });

  it('D · TRUNCATE: sem privilégio para authenticated; o gatilho de instrução barra quem tiver o privilégio (não absoluto para o dono)', async () => {
    expect((await direto(U.adm, `truncate project_request_event`)).erro).toMatch(/permission denied/);
    await expect(db.query(`truncate project_request_event cascade`)).rejects.toThrow(/imutáveis/);
    await expect(db.query(`truncate project_request_file cascade`)).rejects.toThrow(/imutáveis/);
  });

  it('E · Engenharia responsável vê o encerramento sem orçamento e sem o motivo comercial', async () => {
    const p = await repo(U.com).criar(entrada({ tipo: 'Projeto executivo', oportunidadeId: opAdv }), int());
    await agir(U.eng, p.id, 'iniciar_triagem');
    await agir(U.com, p.id, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'nao_necessario' } }).catch(() => undefined);
    await agir(U.eng, p.id, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'nao_necessario' } });
    await agir(U.eng, p.id, 'assumir_desenvolvimento', { prazoEntrega: '2026-12-01' });
    await agir(U.eng, p.id, 'entregar', { entrega: { resumo: 'Projeto executivo entregue', resultados: 'Pranchas e memorial' } });
    await agir(U.com, p.id, 'encerrar', { resultado: { tipo: 'NAO_SEGUIU' }, motivo: 'Cliente achou caro e fechou com a concorrência' });
    const tec = await repo(U.eng).obter(p.id);
    expect(tec?.situacao).toBe('ENCERRADO');
    expect(tec?.resultado).toEqual({ tipo: 'NAO_SEGUIU' });
    expect(tec?.motivo).toBeUndefined();
    const evs = await repo(U.eng).eventos(p.id);
    expect(JSON.stringify(evs).includes('concorrência')).toBe(false);
    expect(JSON.stringify(tec).includes('concorrência')).toBe(false);
    // a gestão vê o motivo
    expect((await repo(U.com).obter(p.id))?.motivo).toBe('Cliente achou caro e fechou com a concorrência');
    // e com orçamento vinculado, a Engenharia não recebe o id do orçamento
    const p2 = await repo(U.com).criar(entrada({ tipo: 'Projeto executivo', oportunidadeId: opAdv }), int());
    await agir(U.eng, p2.id, 'iniciar_triagem');
    await agir(U.eng, p2.id, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'nao_necessario' } });
    await agir(U.eng, p2.id, 'assumir_desenvolvimento', { prazoEntrega: '2026-12-01' });
    await agir(U.eng, p2.id, 'entregar', { entrega: { resumo: 'Projeto executivo entregue', resultados: 'Pranchas e memorial' } });
    await agir(U.com, p2.id, 'encerrar', { resultado: { tipo: 'ORCAMENTO_VINCULADO', orcamentoId: orc } });
    expect(JSON.stringify(await repo(U.eng).obter(p2.id)).includes(orc)).toBe(false);
    expect(JSON.stringify(await repo(U.eng).eventos(p2.id)).includes(orc)).toBe(false);
  });

  it('F · responsável comercial tem de ser da gestão; textos com limite; ação desconhecida recusada', async () => {
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Estudo preliminar', oportunidadeId: opAdv, responsavelComercialId: U.eng }), int()))).toBe('VINCULO_INVALIDO');
    expect(await erroDe(repo(U.com).criar(entrada({ tipo: 'Estudo preliminar', oportunidadeId: opAdv, dados: { cidade: 'Goiânia', uf: 'GO', observacoes: 'x'.repeat(2500) } }), int()))).toBe('DADOS_INCOMPLETOS');
    const atual = (await repo(U.com).listar()).find((p) => p.situacao === 'SOLICITADO');
    if (atual) expect(await erroDe(repo(U.com).agir(atual.id, 'drop table' as never, { versao: atual.versao }, int()))).toBe('TRANSICAO_INVALIDA');
  });

  it('G · arquivo: tipo/tamanho declarados conferidos contra o objeto; caminho de outra solicitação recusado', async () => {
    const p = (await repo(U.com).listar()).find((x) => x.situacao === 'SOLICITADO')!;
    const outra = (await repo(U.com).criar(entrada({ tipo: 'Apoio ao orçamento técnico' }), int()));
    const caminho = (await cliente(U.com).rpc('pp_doc_preparar', { p_id: p.id, p_tipo: 'arquitetura', p_extensao: 'pdf' })).data as string;
    // o objeto que subiu é um executável, embora declarado PDF
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('projetos-tecnicos', $1, $2::jsonb)`, [caminho, JSON.stringify({ mimetype: 'application/x-msdownload', size: 4096 })]);
    const r1 = await cliente(U.com).rpc('pp_doc_registrar', { p_id: p.id, p_tipo: 'arquitetura', p_caminho: caminho, p_nome: 'fake.pdf', p_mime: 'application/pdf', p_tamanho: 4096, p_intencao: int() });
    expect(r1.error?.message).toMatch(/tipo declarado difere/);
    const caminho2 = (await cliente(U.com).rpc('pp_doc_preparar', { p_id: p.id, p_tipo: 'arquitetura', p_extensao: 'pdf' })).data as string;
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('projetos-tecnicos', $1, $2::jsonb)`, [caminho2, JSON.stringify({ mimetype: 'application/pdf', size: 99999999 })]);
    const r2 = await cliente(U.com).rpc('pp_doc_registrar', { p_id: p.id, p_tipo: 'arquitetura', p_caminho: caminho2, p_nome: 'a.pdf', p_mime: 'application/pdf', p_tamanho: 1000, p_intencao: int() });
    expect(r2.error?.message).toMatch(/tamanho declarado difere/);
    // caminho válido de UMA solicitação registrado em OUTRA
    const r3 = await cliente(U.com).rpc('pp_doc_registrar', { p_id: outra.id, p_tipo: 'arquitetura', p_caminho: caminho2, p_nome: 'a.pdf', p_mime: 'application/pdf', p_tamanho: 99999999, p_intencao: int() });
    expect(r3.error?.message).toMatch(/fora da pasta|VINCULO_INVALIDO/);
    // gravar objeto na pasta de OUTRA organização
    expect((await direto(U.com, `insert into storage.objects (bucket_id, name) values ('projetos-tecnicos', $1)`, [`${org2}/${p.id}/x.pdf`])).erro).toMatch(/row-level security|permission/);
  });

  it('H · corrida de duas criações com a mesma intenção: o adaptador devolve a original, sem duplicar', async () => {
    let n = 0;
    const base = cliente(U.com);
    const comCorrida: ClientePedidos = {
      enviarArquivo: base.enviarArquivo,
      async rpc(nome, args) {
        // a 1ª chamada simula a perdedora da corrida: a vencedora já gravou e o índice único da intenção recusou esta
        if (nome === 'pp_criar' && n++ === 0) {
          await base.rpc(nome, args);
          return { data: null, error: { message: 'duplicate key value violates unique constraint "project_request_event_intencao_uk"', code: '23505' } };
        }
        return base.rpc(nome, args);
      },
    };
    const r = await repositorioSupabase(comCorrida).criar(entrada({ tipo: 'Análise técnica' }), 'corrida-1');
    const todas = (await repo(U.com).listar()).filter((p) => p.tipo === 'Análise técnica' && p.situacao === 'SOLICITADO');
    expect(todas.map((p) => p.id)).toEqual([r.id]);
  });
});

describe('E11.2D · privilégios efetivos das funções e tabelas da proposta (PGlite)', () => {
  const INTERNAS = ['pp_json', 'pp_eu', 'pp_texto', 'pp_dados', 'pp_conferir_dados', 'pp_engenharia_role', 'pp_engenharia_ve', 'project_request_coerencia', 'project_request_imutavel', 'project_request_field_delete', 'project_request_file_update'];
  const POLITICAS = ['pp_gestao_role', 'pp_ve_pedido', 'pp_pode_anexar', 'pp_pedido_do_caminho'];
  const API = ['pp_criar', 'pp_transicionar', 'pp_listar', 'pp_obter', 'pp_eventos', 'pp_arquivos', 'pp_doc_preparar', 'pp_doc_registrar', 'pp_doc_remover'];
  let funcs: Row[] = [];
  beforeAll(async () => {
    // um papel de login que HERDA de authenticated e de anon: privilégio por herança também tem de ser negado
    await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'papel_herdeiro') then create role papel_herdeiro nologin inherit; end if; end $$;
      grant authenticated to papel_herdeiro; grant anon to papel_herdeiro;`);
    funcs = (await db.query(`select p.proname, p.oid::regprocedure::text as assinatura, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as dono,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_executa,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as autenticado,
        has_function_privilege('papel_herdeiro', p.oid, 'execute') as herdeiro
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'pp\\_%' or p.proname like 'project\\_request%')`)).rows;
  });
  const linha = (nome: string) => funcs.find((f) => f.proname === nome)!;

  it('nenhuma função da proposta concede EXECUTE a PUBLIC; nenhuma sobrecarga; todas inventariadas nos três grupos', () => {
    expect(funcs.filter((f) => f.public_executa).map((f) => f.assinatura)).toEqual([]);
    const nomes = funcs.map((f) => f.proname as string);
    expect(nomes.length).toBe(new Set(nomes).size); // uma assinatura por nome
    expect([...nomes].sort()).toEqual([...INTERNAS, ...POLITICAS, ...API].sort());
  });

  it('internas: ninguém executa (nem por herança); políticas e API: só authenticated (e herdeiros dele), nunca anon', () => {
    for (const n of INTERNAS) expect([linha(n).anon, linha(n).autenticado, linha(n).herdeiro], n).toEqual([false, false, false]);
    for (const n of [...POLITICAS, ...API]) expect([linha(n).anon, linha(n).autenticado, linha(n).herdeiro], n).toEqual([false, true, true]);
  });

  it('as 17 SECURITY DEFINER: search_path fixo e o mesmo dono das tabelas', async () => {
    const definers = funcs.filter((f) => f.prosecdef);
    expect(definers).toHaveLength(17);
    for (const f of definers) expect((f.proconfig as string[]).includes('search_path=public, pg_temp'), f.assinatura as string).toBe(true);
    const donoTabela = (await db.query(`select pg_get_userbyid(relowner) as d from pg_class where relname = 'project_request'`)).rows[0].d;
    expect(new Set(definers.map((f) => f.dono))).toEqual(new Set([donoTabela]));
  });

  it('pp_json chamada diretamente: negada para authenticated e para anon (chamada forjada não devolve a visão comercial)', async () => {
    const forjar = `select pp_json(row($1::uuid, $2::uuid, 'SP-X', 1, $3::uuid, $4::uuid, null, null, null, null, 'OUTRO', 'Estudo preliminar', 'Normal', null, $5::uuid, null, null, null, 'SOLICITADO', null, null, null, 1, now(), $5::uuid, now())::project_request, false) as r`;
    const params = [id, org, emp, op, U.com];
    const comoAutenticado = await direto(U.eng2, forjar, params);
    expect(comoAutenticado.erro).toMatch(/permission denied/);
    await db.exec('begin;');
    let comoAnon: string;
    try { await db.exec('set local role anon;'); await db.query(forjar, params); comoAnon = 'executou'; } catch (e) { comoAnon = String((e as Error).message); }
    await db.exec('rollback;');
    expect(comoAnon).toMatch(/permission denied/);
  });

  it('TRUNCATE: nenhum papel da aplicação nem o service_role tem o privilégio nas tabelas da proposta', async () => {
    for (const t of ['project_request', 'project_request_field', 'project_request_document', 'project_request_file', 'project_request_pending', 'project_request_event'])
      for (const papel of ['anon', 'authenticated', 'service_role', 'papel_herdeiro'])
        expect((await db.query(`select has_table_privilege($1, $2, 'TRUNCATE') as ok`, [papel, t])).rows[0].ok, `${papel} ${t}`).toBe(false);
  });
});
