// Smoke test da migration 0076 (CHAVE CENTRAL do e-mail comercial) contra um PostgreSQL DE VERDADE
// (PGlite, em memoria, ROLLBACK ao final). Banco DESCARTAVEL: nada aqui toca producao.
//
// Prova o que o BANCO faz com a chave: sem linha = bloqueado; a semente nasce desligada e nao sobrescreve; so
// Administrador liga, Diretoria so desliga, motivo obrigatorio, historico imutavel; criacao e ida a REQUESTED
// barradas com a chave desligada (READY vira FAILED `envio_bloqueado` e a conversa fica livre); aceite, FAILED,
// UNKNOWN e reconciliacao continuam permitidos; ligar com UNKNOWN pendente e recusado; a emergencia so desliga.
// Concorrencia entre sessoes independentes NAO roda no PGlite (uma conexao): a prova estrutural (modos de trava) esta
// aqui; a prova com duas sessoes e o gate de scripts/email-0076/gate-concorrencia.mjs, em PostgreSQL 17 descartavel.
//
// Como rodar:  npm run smoke:email-chave      (imprime JSON; sai com 1 se qualquer prova falhar)

import { ADM_A, ADM_B, DIR_A, ENG_A, FIN_A, FP, FP2, INA_A, ORG_A, ORG_B, SEMENTE, SQL_0076, bancoDoEmail, uuid } from './lib/emailBanco.mjs';

let db;
const res = { migration: '', smoke: {}, rollback: '' };
let falhas = 0;
const ok = (k, cond, detalhe = '') => { res.smoke[k] = cond ? `PASS${detalhe ? ' — ' + detalhe : ''}` : `FALHOU${detalhe ? ' — ' + detalhe : ''}`; if (!cond) falhas++; };
const j = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let sp = 0;
async function deveFalhar(sql, params = []) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try { await db.query(sql, params); await db.exec('release savepoint ' + nome); return null; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); return String(e.message); }
}
/** Executa como `authenticated` com o uid dado (null = sem usuario). Erro volta como string. */
async function comoUsuario(uid, sql, params = []) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  await db.exec(`set local role authenticated; set local test.uid = '${uid ?? ''}';`);
  try { const r = await db.query(sql, params); await db.exec("reset role; set local test.uid = '';"); await db.exec('release savepoint ' + nome); return { r }; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); await db.exec("reset role; set local test.uid = '';").catch(() => {}); return { erro: String(e.message) }; }
}
const chave = async (uid, ligar, motivo = 'motivo de teste') => { const x = await comoUsuario(uid, 'select inbox_email_switch_set($1, $2) j', [ligar, motivo]); return x.erro ? { erro: x.erro } : j(x.r); };
const estado = async (org = ORG_A) => um('select enabled, version, reason, changed_by, changed_by_kind from inbox_email_switch where organization_id = $1', [org]);
const eventos = async (org = ORG_A) => (await db.query('select from_enabled, to_enabled, version, reason, actor_id, actor_kind, actor_role, pending_ready, pending_requested, pending_unknown from inbox_email_switch_event where organization_id = $1 order by occurred_at, version', [org])).rows;

let nLead = 0;
async function conversa(org = ORG_A) {
  nLead += 1;
  const r = j(await db.query(`select inbox_ingest($1, 'MANUAL', 'PORTAL', 'EXTERNAL', $2, 'Lead Ficticio', $3, null, 'Solicito contato sobre um galpão.', 'texto', now() - interval '10 minutes') j`,
    [org, `lead${nLead}@exemplo.invalido`, `site.exemplo.${nLead}`]));
  return um('select id, contact_id, status, sla_first_response_at from inbox_thread where id = $1', [r.thread_id]);
}
const criar = (t, p = {}) => db.query(`select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) j`,
  [p.org ?? ORG_A, t.id, t.contact_id, p.por ?? ADM_A, 'Augusto Macedo', p.chave ?? uuid(++sp + 5000), p.fp ?? FP, 'Assunto: Proposta\n\nOlá.\n\nAugusto Macedo\nEIFF', 30, 100]).then(j);
const transicionar = (id, para, p = {}) => db.query('select inbox_email_delivery_transition($1, $2, $3, $4, $5, $6) j', [id, para, p.ator === undefined ? ADM_A : p.ator, p.motivo ?? null, p.pm ?? null, null]).then(j);
const aceitar = (id, p = {}) => db.query('select inbox_email_delivery_accept($1, $2, $3::timestamptz, $4, $5, $6) j', [id, ADM_A, new Date().toISOString(), p.pm === undefined ? 'gm-1' : p.pm, 'gt-1', p.reconciliada ?? false]).then(j);
const entrega = (id) => um('select status, reason, finished_at, message_id from inbox_email_delivery where id = $1', [id]);
const contagens = async () => JSON.stringify(await um('select (select count(*)::int from inbox_email_delivery) d, (select count(*)::int from inbox_email_delivery_event) e, (select count(*)::int from inbox_message) m, (select count(*)::int from inbox_thread_event) te'));

async function main() {
  try {
    db = await bancoDoEmail({ com0076: true });
    res.migration = 'APLICADAS sem erro (0056 + 0057 + 0075 + 0076, 0075 e 0076 duas vezes)';
    await db.exec('begin');
    await db.exec(SEMENTE); // organizacoes criadas DEPOIS da 0076: ainda sem linha da chave

    // A) sem linha = bloqueado: criar e recusado e nada nasce
    const tA = await conversa();
    const antesA = await contagens();
    const a = await criar(tA);
    ok('A', a.ok === false && a.erro === 'envio_bloqueado' && (await estado()) === undefined && (await contagens()) === antesA,
      'organização sem linha da chave: criação recusada (envio_bloqueado), nenhuma linha criada');

    // B) semente: reaplicar a 0076 cria a linha DESLIGADA de cada organizacao com evento de origem; reaplicar de novo
    //    nao duplica nem sobrescreve
    await db.exec(SQL_0076);
    const eB1 = await estado(); const evB1 = await eventos();
    await db.exec(SQL_0076);
    const evB2 = await eventos();
    ok('B', eB1?.enabled === false && Number(eB1.version) === 1 && evB1.length === 1 && evB1[0].to_enabled === false && evB1[0].from_enabled === null
      && evB1[0].actor_kind === 'SYSTEM' && evB1[0].actor_role === 'migration 0076' && evB2.length === 1 && (await estado(ORG_B))?.enabled === false,
    'linha semeada desligada (versão 1, evento SYSTEM «migration 0076»); reaplicar não duplica');

    // C) quem liga e desliga
    const semUid = await chave(null, true);
    const fin = await chave(FIN_A, true); const eng = await chave(ENG_A, false); const ina = await chave(INA_A, true);
    const dirLiga = await chave(DIR_A, true);
    const semMotivo = await chave(ADM_A, true, '  ');
    const liga = await chave(ADM_A, true, 'liberação do canário 2');
    const repete = await chave(ADM_A, true, 'de novo');
    const evC = await eventos();
    const dirDesliga = await chave(DIR_A, false, 'pausa da Diretoria');
    const evC2 = await eventos();
    const bIntacta = await estado(ORG_B);
    ok('C', semUid.ok === false && semUid.erro === 'nao_autenticado' && fin.erro === 'sem_permissao' && eng.erro === 'sem_permissao' && ina.erro === 'sem_permissao'
      && dirLiga.erro === 'sem_permissao' && semMotivo.erro === 'motivo_obrigatorio' && liga.ok && liga.mudou && liga.enabled && Number(liga.version) === 2
      && repete.ok && repete.mudou === false && evC.length === 2 && evC[1].actor_id === ADM_A && evC[1].actor_role === 'Administrador' && evC[1].to_enabled === true && evC[1].reason === 'liberação do canário 2'
      && dirDesliga.ok && dirDesliga.enabled === false && evC2.length === 3 && evC2[2].actor_role === 'Diretoria' && bIntacta.enabled === false,
    'sem usuário, Financeiro, Engenharia, inativo e Diretoria-ligando recusados; motivo obrigatório; Administrador liga; repetir não gera evento; Diretoria desliga; outra organização intacta');

    // D) ligada: o caminho normal continua inteiro (criar -> REQUESTED -> aceite)
    await chave(ADM_A, true, 'ligar para D');
    const tD = await conversa();
    const d1 = await criar(tD); const d2 = await transicionar(d1.entrega?.id, 'REQUESTED'); const d3 = await aceitar(d1.entrega?.id);
    ok('D', d1.ok && d2.ok && d3.ok && (await entrega(d1.entrega.id)).status === 'ACCEPTED', 'chave ligada: criar, REQUESTED e aceite como na 0075');

    // E) desligar ENTRE criar e REQUESTED: a entrega vira FAILED envio_bloqueado, a conversa fica livre
    const tE = await conversa();
    const e1 = await criar(tE, { chave: uuid(7001) });
    const offE = await chave(ADM_A, false, 'desligamento de teste');
    const evE = (await eventos()).at(-1);
    const e2 = await transicionar(e1.entrega.id, 'REQUESTED');
    const dE = await entrega(e1.entrega.id);
    const mE = await um('select delivery_state, meta from inbox_message where id = $1', [dE.message_id]);
    const teE = await um("select detail from inbox_thread_event where thread_id = $1 and message_id = $2 order by occurred_at desc limit 1", [tE.id, dE.message_id]);
    const evDel = (await db.query('select from_status, to_status, reason from inbox_email_delivery_event where delivery_id = $1 order by occurred_at', [e1.entrega.id])).rows;
    const tE2 = await um('select sla_first_response_at from inbox_thread where id = $1', [tE.id]);
    const novaOff = await criar(tE, { chave: uuid(7002) });
    await chave(ADM_A, true, 'religar para E');
    const novaOn = await criar(tE, { chave: uuid(7003) });
    ok('E', e1.ok && offE.ok && offE.em_curso.ready >= 1 && evE.pending_ready >= 1 && e2.ok === false && e2.erro === 'envio_bloqueado' && dE.status === 'FAILED' && dE.reason === 'envio_bloqueado' && dE.finished_at
      && mE.delivery_state === 'falhou' && mE.meta.entregaEstado === 'FAILED' && /bloqueado pela chave central/.test(teE.detail) && evDel.at(-1).to_status === 'FAILED' && evDel.at(-1).reason === 'envio_bloqueado'
      && tE2.sla_first_response_at === null && novaOff.ok === false && novaOff.erro === 'envio_bloqueado' && novaOn.ok && novaOn.nova,
    `READY barrada na transição: FAILED envio_bloqueado, mensagem «falhou», histórico e conversa sem resposta; o desligamento registrou ${evE.pending_ready} READY em curso; religada, nova intenção cria`);
    // limpa a entrega de E (READY) para nao pesar nas proximas provas
    await transicionar(novaOn.entrega.id, 'FAILED', { motivo: 'mensagem_invalida' });

    // F) REQUESTED ANTES do desligamento: a chave NAO desfaz; registrar o desfecho continua permitido
    const tF = await conversa();
    const f1 = await criar(tF); await transicionar(f1.entrega.id, 'REQUESTED');
    const tF2 = await conversa();
    const f2 = await criar(tF2); await transicionar(f2.entrega.id, 'REQUESTED');
    const offF = await chave(DIR_A, false, 'desligar com envios em curso');
    const evF = (await eventos()).at(-1);
    const rep = await transicionar(f1.entrega.id, 'REQUESTED');
    const fAceite = await aceitar(f1.entrega.id);
    const fUnk = await transicionar(f2.entrega.id, 'UNKNOWN', { motivo: 'resultado_desconhecido' });
    const tF1 = await um('select sla_first_response_at from inbox_thread where id = $1', [tF.id]);
    ok('F', offF.ok && offF.em_curso.requested === 2 && evF.pending_requested === 2 && rep.ok === false && rep.erro === 'envio_bloqueado' && rep.status === 'REQUESTED'
      && fAceite.ok && (await entrega(f1.entrega.id)).status === 'ACCEPTED' && tF1.sla_first_response_at !== null && fUnk.ok && (await entrega(f2.entrega.id)).status === 'UNKNOWN',
    'duas entregas REQUESTED no desligamento ficam registradas no evento; repetir REQUESTED é recusado sem mudar nada; aceite e UNKNOWN continuam permitidos com a chave desligada');

    // G) ligar com UNKNOWN pendente e recusado; reconciliado, liga
    const gRecusa = await chave(ADM_A, true, 'religar com pendência');
    const gRec = await aceitar(f2.entrega.id, { pm: null, reconciliada: true });
    const gLiga = await chave(ADM_A, true, 'religar depois de reconciliar');
    ok('G', gRecusa.ok === false && gRecusa.erro === 'reconciliar_pendentes' && (await estado()).enabled === true && gRec.ok && gLiga.ok && gLiga.enabled,
      'UNKNOWN pendente impede ligar; a reconciliação funciona com a chave desligada; reconciliado, liga');
    // obs.: entre gRecusa e gLiga a chave estava DESLIGADA; o estado lido acima e depois de gLiga

    // H) idempotencia com a chave desligada: a mesma intencao devolve a entrega existente (nada novo, nada enviado)
    const tH = await conversa();
    const hChave = uuid(8001);
    const h1 = await criar(tH, { chave: hChave });
    await chave(ADM_A, false, 'desligar para H');
    const h2 = await transicionar(h1.entrega.id, 'REQUESTED');
    const antesH = await contagens();
    const h3 = await criar(tH, { chave: hChave });
    const h4 = await criar(tH, { chave: hChave, fp: FP2 });
    ok('H', h2.erro === 'envio_bloqueado' && h3.ok && h3.nova === false && h3.entrega.status === 'FAILED' && h3.entrega.reason === 'envio_bloqueado' && h4.ok === false && h4.erro === 'intencao_reutilizada' && (await contagens()) === antesH,
      'repetir a intenção bloqueada devolve a mesma entrega FAILED (nada novo); outro conteúdo com a mesma intenção segue recusado');

    // I) imutabilidade: a chave so muda pelas funcoes; o historico nunca muda
    const iUpd = await deveFalhar("update inbox_email_switch set enabled = true where organization_id = $1", [ORG_A]);
    const iIns = await deveFalhar("insert into inbox_email_switch (organization_id, enabled, reason, changed_by_kind) values (gen_random_uuid(), true, 'x x x', 'SYSTEM')");
    const iDel = await deveFalhar('delete from inbox_email_switch where organization_id = $1', [ORG_A]);
    const iTrS = await deveFalhar('truncate inbox_email_switch_event');
    const iTr = await deveFalhar('truncate inbox_email_switch');
    const iEvU = await deveFalhar("update inbox_email_switch_event set reason = 'adulterado'");
    const iEvD = await deveFalhar('delete from inbox_email_switch_event');
    const iEvI = await deveFalhar("insert into inbox_email_switch_event (organization_id, to_enabled, version, reason, actor_kind) values ($1, true, 99, 'forjado', 'SYSTEM')", [ORG_A]);
    ok('I', [iUpd, iIns, iDel, iTrS, iTr, iEvU, iEvD, iEvI].every((x) => typeof x === 'string') && (await estado()).enabled === false,
      'UPDATE/INSERT/DELETE/TRUNCATE diretos na chave e no histórico recusados (até para o dono do banco, sem a função)');

    // J) o navegador so le: Administrador e Diretoria veem a propria organizacao; demais nao veem; ninguem escreve
    const jAdm = await comoUsuario(ADM_A, 'select count(*)::int n from inbox_email_switch');
    const jAdmEv = await comoUsuario(ADM_A, 'select count(*)::int n from inbox_email_switch_event');
    const jFin = await comoUsuario(FIN_A, 'select count(*)::int n from inbox_email_switch');
    const jB = await comoUsuario(ADM_B, 'select organization_id from inbox_email_switch');
    const jW = await comoUsuario(ADM_A, 'update inbox_email_switch set enabled = true');
    const jCria = await comoUsuario(ADM_A, 'select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [ORG_A, tH.id, tH.contact_id, ADM_A, 'x', uuid(9001), FP, 'x', 30, 100]);
    const jTrans = await comoUsuario(ADM_A, "select inbox_email_delivery_transition($1, 'REQUESTED', $2, null, null, null)", [h1.entrega.id, ADM_A]);
    const jLib = await comoUsuario(ADM_A, 'select inbox_email_envio_liberado($1)', [ORG_A]);
    const jEmerg = await comoUsuario(ADM_A, "select inbox_email_switch_desligar_sistema($1, 'x x x')", [ORG_A]);
    ok('J', jAdm.r?.rows[0].n === 1 && jAdmEv.r?.rows[0].n >= 1 && jFin.r?.rows[0].n === 0 && jB.r?.rows.length === 1 && jB.r.rows[0].organization_id === ORG_B
      && typeof jW.erro === 'string' && typeof jCria.erro === 'string' && typeof jTrans.erro === 'string' && typeof jLib.erro === 'string' && typeof jEmerg.erro === 'string',
    'Administrador/Diretoria leem só a própria organização; Financeiro não vê; UPDATE direto, RPCs do livro, leitura interna da chave e emergência negados ao navegador');

    // K) emergencia (dono do banco / chave de servico): so desliga, ator SYSTEM, motivo obrigatorio
    await chave(ADM_A, true, 'ligar para K');
    const kSem = j(await db.query("select inbox_email_switch_desligar_sistema($1, '') j", [ORG_A]));
    const k1 = j(await db.query("select inbox_email_switch_desligar_sistema($1, 'emergência: suspeita de vazamento') j", [ORG_A]));
    const evK = (await eventos()).at(-1);
    const k2 = j(await db.query("select inbox_email_switch_desligar_sistema($1, 'de novo') j", [ORG_A]));
    const kNova = j(await db.query("select inbox_email_switch_desligar_sistema($1, 'organização sem linha') j", ['33333333-3333-3333-3333-333333333333']));
    ok('K', kSem.ok === false && kSem.erro === 'motivo_obrigatorio' && k1.ok && k1.enabled === false && evK.actor_kind === 'SYSTEM' && evK.actor_id === null && evK.to_enabled === false
      && k2.ok && k2.enabled === false && (await eventos()).at(-1).version === evK.version && kNova.ok === false && kNova.erro === 'organizacao_nao_encontrada',
    'emergência desliga com ator SYSTEM e motivo; repetir não gera evento; organização inexistente recusada');

    // L) modos de trava (prova ESTRUTURAL de concorrencia; a prova com duas sessoes e o gate em PostgreSQL real):
    //    a leitura da chave segura FOR SHARE dentro da transacao da criacao; o desligamento pede FOR UPDATE na mesma linha
    const lLiga = await chave(ADM_A, true, 'ligar para L');
    const tL = await conversa();
    await db.exec('savepoint lck');
    const lCria = await criar(tL, { chave: uuid(9101) });
    const travas = (await db.query("select l.mode from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'inbox_email_switch'")).rows.map((r) => r.mode);
    await db.exec('rollback to savepoint lck');
    const fonte = (await um("select prosrc from pg_proc where proname = 'inbox_email_envio_liberado'")).prosrc;
    const fonteSet = (await um("select prosrc from pg_proc where proname = 'inbox_email_switch_set'")).prosrc;
    ok('L', lLiga.ok && lCria.ok && /for share/i.test(fonte) && /for update/i.test(fonteSet) && travas.includes('RowShareLock'),
      `leitura da chave com FOR SHARE (travas da criação: ${travas.join(', ') || 'nenhuma'}); mudança com FOR UPDATE`);

    // M) livro preexistente: a 0076 nao mexe em entregas existentes nem no CHECK alem do motivo novo
    const mChk = (await um("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'inbox_email_delivery_reason_check'")).d;
    const mN = (await um("select count(*)::int n from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'inbox_email_delivery' and pg_get_constraintdef(c.oid) like '%declarado_encontrado%'")).n;
    ok('M', /envio_bloqueado/.test(mChk) && /declarado_encontrado/.test(mChk) && mN === 1, 'um único CHECK de motivo, com o catálogo da 0075 mais envio_bloqueado');
  } catch (e) {
    ok('ERRO', false, String(e?.stack ?? e));
  } finally {
    try { await db?.exec('rollback'); res.rollback = 'ok'; } catch (e) { res.rollback = 'falhou: ' + e.message; falhas++; }
  }
  res.resumo = falhas === 0 ? `PASS: ${Object.keys(res.smoke).length} provas` : `FALHOU: ${falhas}`;
  console.log(JSON.stringify(res, null, 2));
  process.exit(falhas === 0 ? 0 : 1);
}
main();
