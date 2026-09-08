// Carga controlada do EIFF Radar em PRODUCAO a partir dos CSVs originais, usando o MESMO codigo do app
// (normalizacao, associacao, enriquecimento, score) e o MESMO mapeamento de colunas da persistencia (radar.supabase.ts).
// A escrita e feita por SQL gerado e aplicado pelo Supabase CLI (login do usuario), numa unica transacao.
// Nada e chamado na Explorium. Nao le nem escreve localStorage/demo.
//
// Uso: npx vite-node scripts/radar-importar-producao.mts -- --empresas <csv> --contatos <csv> --perfil <uuid> [--fonte VIBE] [--executar]
//   --dataset-empresas <nome> --dataset-contatos <nome>   nomes registrados nos jobs (lineage)
//   --esperado esperado.json                              numeros estruturais esperados; divergencia interrompe antes de gravar
// Sem --executar: simula tudo, valida e grava o SQL no arquivo indicado por --sql (padrao: scratch), sem aplicar.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coberturaEmpresa, cortesCobertura, metricasEmail } from '../src/core/radar/cobertura';
import { criarIds, importarCsv, recalcularEmpresas } from '../src/core/radar/importacao';
import { mediana } from '../src/core/radar/cobertura';
import { radarVazio, type Fonte, type RadarDataset } from '../src/core/radar/types';
import { linhaApp, linhaDb, tabelaDe, type ChaveRadar } from '../src/data/radar.supabase';
import type { HelpersRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ler = (p: string) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const falhar = (m: string): never => { console.error(`ERRO: ${m}`); process.exit(1); };

const empresasArq = arg('empresas'); const contatosArq = arg('contatos'); const perfilId = arg('perfil');
if (!empresasArq || !contatosArq || !UUID.test(perfilId)) falhar('Informe --empresas <csv> --contatos <csv> --perfil <uuid do profile>.');
const scratch = arg('sql', path.join(os.tmpdir(), `radar-carga-${Date.now()}.sql`));

// ---------------------------------------------------------------------------------------------- Supabase CLI (SQL)
function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
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

// ---------------------------------------------------------------------------------------------- 1) estado atual de producao
console.log('1) Lendo configuração e estado atual do Radar em produção (somente leitura)…');
const [cfg] = sql(`select
  (select organization_id from profile where id = '${perfilId}') as org_id,
  (select json_agg(s) from radar_source s) as fontes,
  (select json_agg(r order by r.priority) from radar_score_rule r) as regras_score,
  (select json_agg(p order by p.priority) from radar_persona_rule p) as regras_persona,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  (select json_agg(c) from radar_company c) as empresas,
  (select json_agg(c) from radar_contact c) as contatos,
  (select json_agg(s) from radar_suppression s) as supressoes,
  (select json_agg(p) from radar_project p) as projetos,
  (select count(*) from radar_import_job) as jobs, (select count(*) from radar_opportunity) as oportunidades;`, 'leitura da configuração');
const orgId = String(cfg.org_id ?? '');
if (!UUID.test(orgId)) falhar('perfil sem organização ativa');
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const r0: RadarDataset = {
  ...radarVazio(),
  fontes: lista(cfg.fontes).map((x) => linhaApp('fontes', x) as Fonte),
  regrasScore: lista(cfg.regras_score).map((x) => linhaApp('regrasScore', x)) as RadarDataset['regrasScore'],
  regrasPersona: lista(cfg.regras_persona).map((x) => linhaApp('regrasPersona', x)) as RadarDataset['regrasPersona'],
  configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  empresas: lista(cfg.empresas).map((x) => linhaApp('empresas', x)) as RadarDataset['empresas'],
  contatos: lista(cfg.contatos).map((x) => linhaApp('contatos', x)) as RadarDataset['contatos'],
  supressoes: lista(cfg.supressoes).map((x) => linhaApp('supressoes', x)) as RadarDataset['supressoes'],
  projetos: lista(cfg.projetos).map((x) => linhaApp('projetos', x)) as RadarDataset['projetos'],
};
const fonte = r0.fontes.find((f) => f.codigo === arg('fonte', 'VIBE')) ?? falhar(`fonte ${arg('fonte', 'VIBE')} não existe em produção`);
console.log(`   organização ${orgId} · fonte ${fonte.codigo} (${fonte.id}) · empresas existentes ${r0.empresas.length} · contatos existentes ${r0.contatos.length} · regras de score ${r0.regrasScore.length} · regras de persona ${r0.regrasPersona.length} · pesos ${r0.pesosDecisionFit.length} · config ${r0.configScore.length} · jobs ${String(cfg.jobs)} · oportunidades ${String(cfg.oportunidades)}`);
if (!r0.regrasScore.length || !r0.regrasPersona.length || !r0.pesosDecisionFit.length) falhar('configuração do Radar ausente em produção (abra o app uma vez para semear os padrões)');
const cortes = cortesCobertura(r0);
console.log(`   cortes de cobertura em produção: fit.ideal ${cortes.ideal} · fit.usavel ${cortes.usavel}`);

// ---------------------------------------------------------------------------------------------- 2) importacao em memoria (codigo do app)
const hoje = new Date().toISOString().slice(0, 10); const agora = new Date().toISOString();
const ids = criarIds(r0, { hoje, agora, usuarioId: perfilId });
console.log('2) Importando em memória com o código do app: empresas → contatos → recálculo…');
const e1 = importarCsv(r0, ler(empresasArq), { tipo: 'empresas', fonte, arquivo: arg('dataset-empresas', path.basename(empresasArq)), usuarioId: perfilId, agora }, ids);
let r = recalcularEmpresas(e1.radar, e1.afetadas, ids);
const e2 = importarCsv(r, ler(contatosArq), { tipo: 'contatos', fonte, arquivo: arg('dataset-contatos', path.basename(contatosArq)), usuarioId: perfilId, agora }, ids);
r = recalcularEmpresas(e2.radar, r.empresas.filter((e) => e.ativo && !e.mescladaEm).map((e) => e.id), ids);
const j1 = e1.job; const j2 = e2.job;
console.log(`   empresas: ${j1.total} linhas → ${j1.importados} novas, ${j1.atualizados} atualizadas, ${j1.duplicados} possíveis duplicatas, ${j1.erros} erros, ${j1.revisao ?? 0} revisão`);
console.log(`   contatos: ${j2.total} linhas → ${j2.importados} novos, ${j2.atualizados} atualizados, ${j2.erros} erros, ${j2.revisao ?? 0} revisão/ambiguidades`);

// ---------------------------------------------------------------------------------------------- 3) validacao estrutural antes de gravar
const novasEmpresas = r.empresas.filter((e) => !r0.empresas.some((x) => x.id === e.id));
const novosContatos = r.contatos.filter((c) => !r0.contatos.some((x) => x.id === c.id));
const ufs = novasEmpresas.reduce<Record<string, number>>((m, e) => { m[e.uf ?? '?'] = (m[e.uf ?? '?'] ?? 0) + 1; return m; }, {});
const paises = [...new Set(novasEmpresas.map((e) => e.pais))];
const cob = novasEmpresas.map((e) => coberturaEmpresa(e, r).nivel);
const contagem = (n: string) => cob.filter((x) => x === n).length;
const email = metricasEmail(novosContatos);
const fits = novosContatos.map((c) => c.decisionFitScore ?? 0);
const fitMedio = fits.length ? Math.round((fits.reduce((s, x) => s + x, 0) / fits.length) * 10) / 10 : null;
const obtido = {
  empresas: novasEmpresas.length, contatos: novosContatos.length, empresas_com_business_id: novasEmpresas.filter((e) => e.businessId).length, contatos_com_prospect_id: novosContatos.filter((c) => /^[a-f0-9]{40}$/i.test(c.fonteExternaId ?? '')).length,
  erros: j1.erros + j2.erros, ambiguidades: (j1.revisao ?? 0) + (j2.revisao ?? 0), duplicatas_possiveis: j1.duplicados + j2.duplicados,
  paises, ufs,
  contact_covered: cob.filter((x) => x !== 'NO_CONTACT').length, ideal: contagem('IDEAL_DECISION_MAKER'), usable: contagem('USABLE_CONTACT'), needs_better: contagem('NEEDS_BETTER_DECISION_MAKER'), no_contact: contagem('NO_CONTACT'),
  email_available: email.disponiveis, email_valid: email.validos, email_catch_all: email.catchAll, email_invalid: email.invalidos,
  fit_medio: fitMedio, fit_mediana: mediana(fits), oportunidades: r.oportunidades.length,
};
console.log('3) Validação estrutural (em memória, antes de gravar):');
console.log('   ' + JSON.stringify(obtido));
const esperadoArq = arg('esperado');
if (esperadoArq) {
  const esperado = JSON.parse(ler(esperadoArq)) as Record<string, unknown>;
  const divergencias: string[] = [];
  const canon = (v: unknown): string => JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v);
  for (const [k, v] of Object.entries(esperado)) { const o = (obtido as Record<string, unknown>)[k]; if (canon(o) !== canon(v)) divergencias.push(`${k}: esperado ${JSON.stringify(v)}, obtido ${JSON.stringify(o)}`); }
  if (divergencias.length) { console.error('   DIVERGÊNCIAS:\n   - ' + divergencias.join('\n   - ')); falhar('números estruturais divergem do esperado; nada foi gravado.'); }
  console.log(`   ${Object.keys(esperado).length} número(s) esperado(s) conferido(s): OK`);
}

// ---------------------------------------------------------------------------------------------- 4) SQL (mesmo mapeamento da persistencia do app)
const mapa = new Map<string, string>();
const uuidDe = (id?: string) => (!id ? null : UUID.test(id) ? id : (mapa.get(id) ?? (mapa.set(id, randomUUID()), mapa.get(id)!)));
const ref = (_chave: ChaveRadar, id?: string) => uuidDe(id);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const inserts: string[] = [];
const novos = <T extends { id: string }>(chave: ChaveRadar, lista: T[], extra: (o: T) => Record<string, unknown> = () => ({})) => {
  const antes = new Set(((r0 as unknown as Record<string, { id: string }[]>)[chave] ?? []).map((x) => x.id));
  const linhas = lista.filter((x) => !antes.has(x.id));
  for (const o of linhas) {
    const row = { id: uuidDe(o.id), organization_id: orgId, ...extra(o), ...linhaDb(chave, o, ref, h) };
    const cols = Object.keys(row);
    inserts.push(`insert into ${tabelaDe(chave)} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`);
  }
  return linhas.length;
};
// ordem por dependencia: jobs -> empresas -> contatos -> linhas/erros -> duplicatas -> registros brutos -> snapshots
// (empresas nao gravam merged_into porque nenhuma foi mesclada; ref('empresas') ja resolve ids novos)
const n = {
  jobs: novos('importacoes', r.importacoes),
  empresas: novos('empresas', r.empresas, () => ({ created_by: perfilId })),
  contatos: novos('contatos', r.contatos),
  linhas: novos('importacaoLinhas', r.importacaoLinhas),
  erros: novos('importacaoErros', r.importacaoErros),
  duplicatas: novos('duplicatas', r.duplicatas),
  registros: novos('registrosFonte', r.registrosFonte),
  snapshots: novos('snapshotsScore', r.snapshotsScore),
};
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...inserts, 'commit;'].join('\n');
fs.writeFileSync(scratch, script);
console.log(`4) SQL gerado: ${inserts.length} inserts (${JSON.stringify(n)}) em ${scratch}`);

if (!flag('executar')) { console.log('\nSimulação concluída. Nada foi gravado em produção. Repita com --executar para aplicar.'); process.exit(0); }

// ---------------------------------------------------------------------------------------------- 5) aplicar em uma transacao e conferir
console.log('5) Aplicando em produção (uma transação)…');
sql(script, 'carga em produção');
const [v] = sql(`select
  (select count(*) from radar_company where organization_id = '${orgId}' and active) as empresas,
  (select count(*) from radar_company where organization_id = '${orgId}' and explorium_business_id is not null) as empresas_com_business_id,
  (select json_object_agg(coalesce(state, '?'), n) from (select state, count(*) n from radar_company where organization_id = '${orgId}' group by state) s) as ufs,
  (select json_agg(distinct country) from radar_company where organization_id = '${orgId}') as paises,
  (select count(*) from radar_contact where organization_id = '${orgId}') as contatos,
  (select count(*) from radar_contact where organization_id = '${orgId}' and source_external_id ~ '^[a-f0-9]{40}$') as contatos_com_prospect_id,
  (select json_object_agg(coalesce(professional_email_status, 'vazio'), n) from (select professional_email_status, count(*) n from radar_contact where organization_id = '${orgId}' and email is not null group by 1) s) as status_email,
  (select count(*) from radar_contact where organization_id = '${orgId}' and decision_fit_score >= ${cortes.ideal}) as contatos_fit_ideal,
  (select count(*) from radar_contact where organization_id = '${orgId}' and decision_fit_score >= ${cortes.usavel} and decision_fit_score < ${cortes.ideal}) as contatos_fit_usavel,
  (select count(*) from radar_contact where organization_id = '${orgId}' and decision_fit_score < ${cortes.usavel}) as contatos_fit_baixo,
  (select round(avg(decision_fit_score), 1) from radar_contact where organization_id = '${orgId}') as fit_medio,
  (select percentile_cont(0.5) within group (order by decision_fit_score) from radar_contact where organization_id = '${orgId}') as fit_mediana,
  (select count(*) from radar_import_job where organization_id = '${orgId}') as jobs,
  (select count(*) from radar_import_row where organization_id = '${orgId}') as linhas,
  (select count(*) from radar_import_error where organization_id = '${orgId}') as erros,
  (select count(*) from radar_source_record where organization_id = '${orgId}') as registros,
  (select count(*) from radar_possible_duplicate where organization_id = '${orgId}' and status = 'pendente') as duplicatas_pendentes,
  (select count(*) from radar_score_snapshot where organization_id = '${orgId}') as snapshots,
  (select count(*) from radar_opportunity where organization_id = '${orgId}') as oportunidades;`, 'conferência pós-carga');
console.log('6) Conferência no banco após a carga:');
console.log('   ' + JSON.stringify(v));
console.log('\nCarga concluída. Nenhuma chamada à Explorium.');
