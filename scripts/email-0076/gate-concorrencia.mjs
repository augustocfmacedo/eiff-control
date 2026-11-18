// GATE DE CONCORRENCIA REAL da 0076 — sessoes independentes num PostgreSQL 17 DESCARTAVEL (nunca producao).
// O PGlite tem uma conexao so; aqui cada cenario abre DUAS (ou mais) sessoes psql de verdade e mede quem espera quem.
//
// Pre-requisito (fora do repositorio, com autorizacao): binarios do PostgreSQL 17.6 e um cluster temporario, p.ex.
//   initdb -D %TEMP%\eiff-pg-0076 -U postgres -A trust
//   pg_ctl -D %TEMP%\eiff-pg-0076 -o "-p 55432 -c listen_addresses=127.0.0.1" start
// Uso:
//   node scripts/email-0076/gate-concorrencia.mjs --psql "C:\...\bin\psql.exe" --porta 55432
// O script cria o banco `gate_0076`, aplica preludio + 0056 + 0057 + 0075 + 0076 + semente, roda os cenarios e APAGA o
// banco no fim. Recusa qualquer host que nao seja 127.0.0.1/localhost.
//
// Cenarios (cada um repetido --rodadas vezes, padrao 10):
//   C1 desligar ESPERA a criacao aberta (FOR SHARE x FOR UPDATE) e, depois, a transicao da entrega criada e barrada;
//   C2 criacao iniciada DURANTE o desligamento espera e sai `envio_bloqueado` (nunca cria com a chave ja desligada);
//   C3 transicao para REQUESTED durante o desligamento espera e vira FAILED `envio_bloqueado`;
//   C4 mesma intencao em duas sessoes: uma entrega so (idempotencia sob corrida);
//   C5 rajada: 8 criacoes em conversas diferentes + um desligamento no meio: nenhuma entrega nasce DEPOIS do commit do
//      desligamento, e toda criada antes e barrada na transicao.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRELUDIO, SEMENTE, SQL_0056, SQL_0057, SQL_0075, SQL_0076, ADM_A, DIR_A, ORG_A, FP, uuid } from '../lib/emailBanco.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const PSQL = arg('psql', 'psql');
const HOST = arg('host', '127.0.0.1');
const PORTA = arg('porta', '55432');
const RODADAS = Number(arg('rodadas', '10'));
if (!['127.0.0.1', 'localhost'].includes(HOST)) { console.error('Recusado: o gate so roda em banco local descartavel.'); process.exit(2); }
const BASE = ['-h', HOST, '-p', PORTA, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'];

const sync = (db, sql) => { const r = spawnSync(PSQL, [...BASE, '-d', db, '-c', sql], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout.trim(); };
const arquivo = (db, sql) => { const f = path.join(os.tmpdir(), `gate0076-${process.pid}-${Math.random().toString(36).slice(2)}.sql`); fs.writeFileSync(f, sql); try { const r = spawnSync(PSQL, [...BASE, '-d', db, '-f', f], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout.trim(); } finally { fs.rmSync(f, { force: true }); } };
/** Sessao assincrona: devolve { saida, inicio, fim } (ms). */
const sessao = (sql) => new Promise((ok, falha) => {
  const inicio = Date.now(); const p = spawn(PSQL, [...BASE, '-d', 'gate_0076', '-c', sql]); let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? ok({ saida: out.trim(), inicio, fim: Date.now() }) : falha(new Error(err || out))));
});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const res = { cenarios: {}, falhas: 0 };
const marcar = (k, cond, det) => { res.cenarios[k] = (res.cenarios[k] ?? []); res.cenarios[k].push(cond ? 'ok' : `FALHOU ${det}`); if (!cond) res.falhas++; };

let nConv = 0;
const conversa = () => { nConv++; const j = JSON.parse(sync('gate_0076', `select inbox_ingest('${ORG_A}', 'MANUAL', 'PORTAL', 'EXTERNAL', 'g${nConv}@exemplo.invalido', 'Lead', 'site.${nConv}', null, 'Olá', 'texto', now())`)); return JSON.parse(sync('gate_0076', `select row_to_json(t) from (select id, contact_id from inbox_thread where id = '${j.thread_id}') t`)); };
const sqlCriar = (t, chave) => `select inbox_email_delivery_create('${ORG_A}', '${t.id}', '${t.contact_id}', '${ADM_A}', 'Augusto', '${chave}', '${FP}', 'Assunto: x\n\ny', 1000, 1000)`;
const ligar = () => sync('gate_0076', `begin; set local role authenticated; select set_config('test.uid', '${ADM_A}', true); select inbox_email_switch_set(true, 'gate: ligar'); commit;`);
const desligarSql = `select inbox_email_switch_desligar_sistema('${ORG_A}', 'gate: desligar')`;
let nChave = 100000;

async function main() {
  sync('postgres', 'drop database if exists gate_0076'); sync('postgres', 'create database gate_0076');
  try {
    arquivo('gate_0076', [PRELUDIO, SQL_0056, SQL_0057, SQL_0075, SEMENTE, SQL_0076].join('\n;\n'));
    res.versao = sync('gate_0076', 'show server_version');
    for (let i = 0; i < RODADAS; i++) {
      // C1
      ligar(); const t1 = conversa(); const k1 = uuid(++nChave);
      const s1 = sessao(`begin; ${sqlCriar(t1, k1)}; select pg_sleep(1.5); commit;`);
      await espera(400);
      const s2 = sessao(`${desligarSql};`);
      const [r1, r2] = await Promise.all([s1, s2]);
      const e1 = JSON.parse(sync('gate_0076', `select row_to_json(d) from (select id from inbox_email_delivery where idempotency_key = '${k1}') d`));
      const tr = JSON.parse(sync('gate_0076', `select inbox_email_delivery_transition('${e1.id}', 'REQUESTED', '${ADM_A}', null, null, null)`));
      marcar('C1', r2.fim >= r1.fim - 50 && tr.erro === 'envio_bloqueado', `desligar terminou ${r1.fim - r2.fim} ms antes da criacao; transicao ${JSON.stringify(tr)}`);
      // C2
      ligar(); const t2 = conversa();
      const d2 = sessao(`begin; ${desligarSql}; select pg_sleep(1.5); commit;`);
      await espera(400);
      const c2 = sessao(`${sqlCriar(t2, uuid(++nChave))};`);
      const [rd2, rc2] = await Promise.all([d2, c2]);
      marcar('C2', rc2.fim >= rd2.fim - 50 && /envio_bloqueado/.test(rc2.saida), `criacao: ${rc2.saida}`);
      // C3
      ligar(); const t3 = conversa(); const c3 = JSON.parse(sync('gate_0076', sqlCriar(t3, uuid(++nChave))));
      const d3 = sessao(`begin; ${desligarSql}; select pg_sleep(1.5); commit;`);
      await espera(400);
      const tr3 = sessao(`select inbox_email_delivery_transition('${c3.entrega.id}', 'REQUESTED', '${ADM_A}', null, null, null);`);
      const [rd3, rt3] = await Promise.all([d3, tr3]);
      const st3 = sync('gate_0076', `select status || '/' || coalesce(reason, '') from inbox_email_delivery where id = '${c3.entrega.id}'`);
      marcar('C3', rt3.fim >= rd3.fim - 50 && st3 === 'FAILED/envio_bloqueado', `estado ${st3}`);
      // C4
      ligar(); const t4 = conversa(); const k4 = uuid(++nChave);
      const [a4, b4] = await Promise.all([sessao(`${sqlCriar(t4, k4)};`), sessao(`${sqlCriar(t4, k4)};`)]);
      const n4 = sync('gate_0076', `select count(*) from inbox_email_delivery where idempotency_key = '${k4}'`);
      const novas = [a4, b4].filter((x) => /"nova": true/.test(x.saida)).length;
      marcar('C4', n4 === '1' && novas === 1, `entregas ${n4}, novas ${novas}`);
      // C5
      ligar(); const ts = Array.from({ length: 8 }, () => conversa());
      const ini = Date.now();
      const criacoes = ts.map((t, k) => espera(k * 60).then(() => sessao(`${sqlCriar(t, uuid(++nChave))};`)));
      await espera(200);
      const off = await sessao(`${desligarSql};`);
      const rs = await Promise.all(criacoes);
      const criadas = rs.filter((x) => /"ok": true/.test(x.saida));
      const depoisDoOff = rs.filter((x) => /"ok": true/.test(x.saida) && x.inicio > off.fim + 50);
      let barradas = 0;
      for (const x of criadas) { const id = JSON.parse(x.saida).entrega.id; const tr5 = JSON.parse(sync('gate_0076', `select inbox_email_delivery_transition('${id}', 'REQUESTED', '${ADM_A}', null, null, null)`)); if (tr5.erro === 'envio_bloqueado') barradas++; }
      marcar('C5', depoisDoOff.length === 0 && barradas === criadas.length, `criadas ${criadas.length} (depois do off: ${depoisDoOff.length}), barradas ${barradas}; ${Date.now() - ini} ms`);
    }
  } finally {
    sync('postgres', 'drop database if exists gate_0076');
  }
  res.resumo = res.falhas === 0 ? `PASS: ${RODADAS} rodadas x 5 cenarios` : `FALHOU: ${res.falhas}`;
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
