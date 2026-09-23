/**
 * LE-3D — runner operacional do intake do CNO no Lead Engine. Server-side, fora do app.
 *
 *   npx vite-node scripts/cno-intake-producao.mts -- --manifest dados/cno/pilot-manifest-v1.json --snapshot dados/cno/cno.zip --perfil <uuid>
 *
 * Sem flags de execucao: SIMULACAO — reconstroi as observacoes do snapshot, confere o manifest, reavalia a
 * politica piloto, consulta a producao SOMENTE LEITURA, planeja os RegistroFonte PENDING e grava o SQL do lote
 * num arquivo local. Nada e escrito no banco.
 *
 * Escrever exige, ao mesmo tempo, `--executar` e `--confirmar CNO_PILOT_V1`. `--executar` sozinho e RECUSADO.
 *
 * O que este runner NUNCA faz: chamar `ingerirRegistrosRadar` (cria Empresa/Projeto/Sinal direto, pulando a
 * revisao humana) ou `processarCandidatoLeadEngine` (a decisao e humana, na aba Candidatos). Ele termina em
 * `radar_source_record` com `intake_status = PENDING`. Segue o padrao de seguranca de
 * `scripts/radar-importar-producao.mts`: perfil -> organizacao -> papel, SQL numa transacao, dry-run por padrao.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerAreaCno, lerCnaeCno, lerObraCno, lerVinculoCno, pedidoIntakeCno, type CnoObservacao } from '../src/core/radar/cnoDadosAbertos';
import { juntarOrdenadoCno } from '../src/core/radar/cnoStreamJoin';
import { avaliarPiloto, politicaPiloto } from '../src/core/radar/cnoPilot';
import { validarIntake, type PedidoIntake } from '../src/core/radar/leadEngineIntake';
import { filaDeRevisao } from '../src/core/radar/leadEngineReview';
import { PAPEIS_RADAR } from '../src/core/radar/comunicacaoLlm';
import {
  aplicarPlanoEmMemoria, conferirManifest, modoExecucao, planejarBatchIntake, resolverFonteCno, resumoDoPlano,
} from '../src/core/radar/leadEngineBatchIntake';
import type { Fonte, RadarDataset, RegistroFonte } from '../src/core/radar/types';
import { linhaApp, linhaDb, tabelaDe, type ChaveRadar, type HelpersRadar } from '../src/data/radar.supabase';
import { fluxoLido, membroDe, membrosLocais } from './lib/cnoZip.mts';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2).filter((a) => a !== '--');
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const falhar = (m: string): never => { console.error(`BLOQUEADO: ${m}`); process.exit(1); };

const manifestArq = arg('manifest', 'dados/cno/pilot-manifest-v1.json');
const snapshotArq = arg('snapshot', 'dados/cno/cno.zip');
const perfilId = arg('perfil');
const sqlSaida = arg('sql', path.join('scratch', 'cno-pilot-intake.sql'));
const modo = modoExecucao({ executar: flag('executar'), confirmar: arg('confirmar') || undefined });

if (!UUID.test(perfilId)) falhar('informe --perfil <uuid do profile autorizado>. Nao invente UUID.');
if (!fs.existsSync(manifestArq)) falhar(`manifest nao encontrado: ${manifestArq}`);
if (!fs.existsSync(snapshotArq)) falhar(`snapshot nao encontrado: ${snapshotArq}`);
if (modo === 'RECUSADO') falhar('--executar sem --confirmar CNO_PILOT_V1 e recusado. Nao ha modo intermediario.');

console.log(`=== LE-3D · intake do CNO no Lead Engine · modo ${modo} ===`);

// ---------------------------------------------------------------------------------------------- Supabase CLI (SQL)
function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `cno-q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const i = saida.indexOf('{');
  if (r.status !== 0 || i < 0) falhar(`${rotulo}: ${saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 600)}`);
  const j = JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[]; error?: unknown };
  if (j.error) falhar(`${rotulo}: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.rows ?? [];
}

// ---------------------------------------------------------------------------------------------- 1) manifest (nao e payload)
interface Manifest { resumo: { dataReferencia: string; versaoPolitica: string; totalElegiveis: number; batchSize: number; fingerprints: string[] }; lote: { cno: string; payloadFingerprint: string }[] }
const manifest = JSON.parse(fs.readFileSync(manifestArq, 'utf8')) as Manifest;
const esperados = manifest.lote.map((e) => ({ cno: e.cno, payloadFingerprint: e.payloadFingerprint }));
console.log(`1) manifest: ${esperados.length} entradas · politica ${manifest.resumo.versaoPolitica} · referencia ${manifest.resumo.dataReferencia}`);
if (esperados.length !== manifest.resumo.batchSize) falhar('manifest inconsistente: lote != batchSize');

// ---------------------------------------------------------------------------------------------- 2) perfil, organizacao e fonte CNO (READ-ONLY)
console.log('2) producao, somente leitura: perfil → organizacao → papel → fonte CNO…');
const [perfil] = sql(`select p.id, p.organization_id, p.role, p.active from profile p where p.id = '${perfilId}'`, 'perfil');
if (!perfil) falhar('perfil nao encontrado');
if (perfil.active !== true) falhar('perfil inativo');
if (!(PAPEIS_RADAR as readonly string[]).includes(String(perfil.role))) falhar(`papel ${String(perfil.role)} sem permissao Radar`);
const orgId = String(perfil.organization_id);
if (!UUID.test(orgId)) falhar('perfil sem organizacao');
console.log(`   perfil OK · papel ${String(perfil.role)} · organizacao ${orgId}`);

const fontesDb = sql(`select id, code, active from radar_source where organization_id = '${orgId}'`, 'fontes');
const fonte = resolverFonteCno(fontesDb.map((f) => ({ id: String(f.id), codigo: String(f.code), ativo: f.active === true })));
if (!fonte.ok) falhar(`CNO_SOURCE = BLOCKED (${fonte.motivo})`);
console.log(`   fonte CNO resolvida no banco: ${fonte.fonteId}`);

// ---------------------------------------------------------------------------------------------- 3) reconstruir as observacoes do snapshot
console.log('3) reconstruindo as observacoes completas a partir do snapshot (streaming join)…');
const alvo = new Set(esperados.map((e) => e.cno));
const encontradas = new Map<string, CnoObservacao>();
{
  const membros = await membrosLocais(snapshotArq);
  const c = { obras: { linhas: 0 }, areas: { linhas: 0 }, cnaes: { linhas: 0 }, vinculos: { linhas: 0 } };
  const t0 = Date.now();
  for await (const ev of juntarOrdenadoCno({
    obras: fluxoLido(snapshotArq, membroDe(membros, 'cno.csv'), lerObraCno, c.obras),
    areas: fluxoLido(snapshotArq, membroDe(membros, 'cno_areas.csv'), lerAreaCno, c.areas),
    cnaes: fluxoLido(snapshotArq, membroDe(membros, 'cno_cnaes.csv'), lerCnaeCno, c.cnaes),
    vinculos: fluxoLido(snapshotArq, membroDe(membros, 'cno_vinculos.csv'), lerVinculoCno, c.vinculos),
  })) {
    if (ev.tipo === 'observacao' && alvo.has(ev.observacao.cno)) encontradas.set(ev.observacao.cno, ev.observacao);
  }
  console.log(`   ${encontradas.size}/${alvo.size} encontradas em ${((Date.now() - t0) / 1000).toFixed(0)} s (${c.obras.linhas.toLocaleString('pt-BR')} obras lidas)`);
}

// ---------------------------------------------------------------------------------------------- 4) pedidos, fingerprint e politica
const batchRecebidoEm = new Date().toISOString(); // fora da identidade e fora do fingerprint
const politica = politicaPiloto(manifest.resumo.dataReferencia);
const pedidos: PedidoIntake[] = [];
const conferidos: { cno: string; payloadFingerprint: string; elegivel: boolean }[] = [];
for (const e of esperados) {
  const obs = encontradas.get(e.cno);
  if (!obs) continue;
  const pedido = pedidoIntakeCno(obs, fonte.fonteId, batchRecebidoEm);
  const v = validarIntake(pedido);
  if (!v.ok) falhar(`pedido invalido para ${e.cno}: ${v.motivos.join(', ')}`);
  conferidos.push({ cno: e.cno, payloadFingerprint: v.payloadFingerprint, elegivel: avaliarPiloto(obs, politica).resultado.elegivel });
  pedidos.push(pedido);
}
const conf = conferirManifest({ esperados, encontrados: conferidos });
console.log(`4) MANIFEST_ENTRIES = ${conf.manifestEntries} · SNAPSHOT_MATCH = ${conf.snapshotMatch}/${conf.manifestEntries} · FINGERPRINT_MATCH = ${conf.fingerprintMatch}/${conf.manifestEntries} · POLICY_MATCH = ${conf.policyMatch}/${conf.manifestEntries}`);
if (!conf.ok) falhar(`BATCH = BLOCKED · faltantes ${conf.faltantes.length} · fingerprint divergente ${conf.fingerprintDivergente.length} · politica divergente ${conf.politicaDivergente.length}`);

// ---------------------------------------------------------------------------------------------- 5) estado real (READ-ONLY) e plano
const externos = esperados.map((e) => `'${e.cno}'`).join(', ');
const linhasDb = sql(`select * from radar_source_record where organization_id = '${orgId}' and source_id = '${fonte.fonteId}' and external_id in (${externos})`, 'registros existentes');
const existentes = linhasDb.map((row) => linhaApp('registrosFonte', row) as RegistroFonte);
console.log(`5) producao: ${existentes.length} registro(s) existente(s) para esses CNOs nessa fonte`);

const plano = planejarBatchIntake(pedidos, existentes, () => randomUUID());
const r1 = resumoDoPlano(plano);
console.log(`   plano: NOVO_REGISTRO ${r1.NOVO_REGISTRO} · NOVA_OBSERVACAO ${r1.NOVA_OBSERVACAO} · IDEMPOTENT_NOOP ${r1.IDEMPOTENT_NOOP} · INVALIDO ${r1.INVALIDO} · WOULD_INSERT ${r1.WOULD_INSERT}`);
const efeitos = { WOULD_CREATE_EMPRESA: 0, WOULD_CREATE_PROJETO: 0, WOULD_CREATE_SINAL: 0, WOULD_CREATE_OPORTUNIDADE: 0, WOULD_CREATE_TAREFA: 0, WOULD_CREATE_ATIVIDADE: 0, WOULD_CREATE_COMUNICACAO: 0 };
console.log('   efeitos colaterais planejados:', JSON.stringify(efeitos));

// ---------------------------------------------------------------------------------------------- 6) segunda passagem e alteracao (em memoria)
const radarMinimo = (registros: RegistroFonte[]): RadarDataset => ({
  fontes: [{ id: fonte.fonteId, codigo: 'CNO', nome: 'CNO', tipo: 'CNO', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: batchRecebidoEm } as Fonte],
  empresas: [], contatos: [], projetos: [], sinais: [], oportunidades: [], historicoEstagios: [], atividades: [], tarefas: [],
  tiposResposta: [], estrategias: [], experimentos: [], regrasScore: [], regrasPersona: [], pesosDecisionFit: [], snapshotsScore: [],
  importacoes: [], importacaoLinhas: [], importacaoErros: [], duplicatas: [], supressoes: [], registrosFonte: registros, comunicacoes: [],
  configScore: undefined as never, operacoesVibe: [],
} as unknown as RadarDataset);
const depois = aplicarPlanoEmMemoria(radarMinimo(existentes), plano);
const r2 = resumoDoPlano(planejarBatchIntake(pedidos, depois.registrosFonte, () => randomUUID()));
console.log(`6) segunda simulacao (plano aplicado em memoria): NOVO ${r2.NOVO_REGISTRO} · NOVA_OBS ${r2.NOVA_OBSERVACAO} · NOOP ${r2.IDEMPOTENT_NOOP}`);
const alterado = pedidos.map((p, i) => (i === 0 ? { ...p, payload: { ...(p.payload as Record<string, unknown>), evidence: { ...(p.payload as { evidence: Record<string, unknown> }).evidence, obra: { ...((p.payload as { evidence: { obra: Record<string, string> } }).evidence.obra), 'Situação': '15' } } } } : p));
const r3 = resumoDoPlano(planejarBatchIntake(alterado, depois.registrosFonte, () => randomUUID()));
console.log(`   com 1 observacao alterada (Situacao da 1a): NOVO ${r3.NOVO_REGISTRO} · NOVA_OBS ${r3.NOVA_OBSERVACAO} · NOOP ${r3.IDEMPOTENT_NOOP}`);
const fila = filaDeRevisao(depois);
console.log(`   filaDeRevisao com o plano aplicado: ${fila.length} candidato(s) PENDING · promocao continua humana (processarCandidatoLeadEngine NAO e chamado aqui)`);

// ---------------------------------------------------------------------------------------------- 7) SQL do lote (so radar_source_record)
const uuidDe = (id: string) => (UUID.test(id) ? id : falhar(`id nao canonico: ${id}`));
const ref = (chave: ChaveRadar, id?: string) => (chave === 'fontes' ? fonte.fonteId : id && UUID.test(id) ? id : null);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const tabela = tabelaDe('registrosFonte');
if (tabela !== 'radar_source_record') falhar(`tabela inesperada: ${tabela}`);
const inserts = plano.registros.map((reg) => {
  const row = { id: uuidDe(reg.id), organization_id: orgId, ...linhaDb('registrosFonte', reg, ref, h) };
  const cols = Object.keys(row);
  return `insert into ${tabela} (${cols.join(', ')}) values (${cols.map((c) => lit((row as Record<string, unknown>)[c])).join(', ')});`;
});
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...inserts, 'commit;'].join('\n');
// guarda: o SQL so pode tocar radar_source_record, e so com INSERT
const tabelasTocadas = [...script.matchAll(/\b(insert into|update|delete from)\s+([a-z_]+)/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`);
if (tabelasTocadas.some((t) => t !== 'insert into radar_source_record')) falhar(`SQL tocaria alem de radar_source_record: ${[...new Set(tabelasTocadas)].join(', ')}`);
if (/on conflict/i.test(script)) falhar('SQL nao pode esconder conflito com ON CONFLICT');
fs.mkdirSync(path.dirname(sqlSaida), { recursive: true });
fs.writeFileSync(sqlSaida, script);
console.log(`7) SQL do lote: ${inserts.length} insert(s) em radar_source_record, numa transacao, em ${sqlSaida}`);

if (modo !== 'ESCRITA') {
  console.log('\nSIMULACAO concluida. Nada foi gravado em producao.');
  console.log('Escrever exige --executar E --confirmar CNO_PILOT_V1 ao mesmo tempo.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------- 8) escrita (so com as duas flags)
aplicarEmProducao(script);

function aplicarEmProducao(scriptSql: string): void {
  console.log('\n8) aplicando o lote em producao numa unica transacao…');
  sql(scriptSql, 'aplicacao do lote');
  const [depoisDb] = sql(`select count(*) as n from radar_source_record where organization_id = '${orgId}' and source_id = '${fonte.fonteId}' and external_id in (${externos})`, 'conferencia');
  console.log(`   registros CNO desses external_id apos a carga: ${String(depoisDb?.n)}`);
}
