// Registro de UM sinal real em PRODUCAO usando a logica oficial do app (registrarSinalNormalizado + recalcularEmpresas):
// le o Radar de producao, localiza a empresa (para se houver ambiguidade), mostra ANTES, registra em memoria, mostra DEPOIS
// e gera SQL (insert do sinal e do snapshot, update dos scores da empresa) aplicado pelo Supabase CLI numa transacao.
// Nenhuma pesquisa, nenhuma chamada externa. Sem --executar: so simula. Sem original_url: recusa gravar.
//
// Uso: npx vite-node scripts/radar-registrar-sinal-producao.mts -- --sinal <json> --perfil <uuid> [--executar]
// JSON: { empresa, tipo, titulo, descricao, eventoEm, fonte (codigo), confianca, verificado, url, bruto, leitura: { relevanciaEstrutural, oQueAconteceu, porQueImporta, acaoRecomendada } }
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarIds, recalcularEmpresas } from '../src/core/radar/importacao';
import { registrarSinalNormalizado } from '../src/core/radar/ingestao';
import { normalizarNome } from '../src/core/radar/normalizar';
import { filaHoje } from '../src/core/radar/pipeline';
import { payloadComLeitura, visaoSignalPilot, type LeituraSinal } from '../src/core/radar/signalPilot';
import { TIPOS_SINAL, radarVazio, type Fonte, type RadarDataset, type TipoSinal } from '../src/core/radar/types';
import { linhaApp, linhaDb, type ChaveRadar, type HelpersRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const falhar = (m: string): never => { console.error(`PARADO: ${m}`); process.exit(1); };

interface SinalJson { empresa: string; tipo: TipoSinal; titulo: string; descricao: string; eventoEm: string; fonte: string; confianca: number; verificado: boolean; url?: string; bruto?: unknown; leitura?: LeituraSinal }
const perfilId = arg('perfil'); const sinalArq = arg('sinal');
if (!sinalArq || !UUID.test(perfilId)) falhar('Informe --sinal <json> --perfil <uuid>.');
const sinal = JSON.parse(fs.readFileSync(sinalArq, 'utf8').replace(/^﻿/, '')) as SinalJson;
if (!TIPOS_SINAL.includes(sinal.tipo)) falhar(`tipo de sinal inválido: ${sinal.tipo}`);
if (!sinal.titulo?.trim() || !sinal.eventoEm || !sinal.fonte) falhar('JSON incompleto: título, eventoEm e fonte são obrigatórios.');

function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-s-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; const i = saida.indexOf('{');
  if (r.status !== 0 || i < 0) falhar(`${rotulo}: ${saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 600)}`);
  const j = JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[]; error?: unknown };
  if (j.error) falhar(`${rotulo}: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.rows ?? [];
}
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const ag = (t: string, ordem = 'created_at') => `(select json_agg(x order by x.${ordem}) from ${t} x where x.organization_id = (select organization_id from profile where id = '${perfilId}'))`;

// ---------------------------------------------------------------------------------------------- 1) Radar de producao
console.log('1) Lendo o Radar de produção (somente leitura)…');
const [cfg] = sql(`select (select organization_id from profile where id = '${perfilId}') as org_id,
  ${ag('radar_source')} as fontes, ${ag('radar_score_rule', 'priority')} as regras_score, ${ag('radar_persona_rule', 'priority')} as regras_persona,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score, (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  (select json_agg(json_build_object('code', code, 'name', name, 'sentiment', sentiment, 'active', active)) from radar_response_type) as tipos_resposta,
  ${ag('radar_company')} as empresas, ${ag('radar_contact')} as contatos, ${ag('radar_signal', 'detected_at')} as sinais, ${ag('radar_score_snapshot', 'scored_at')} as snapshots,
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades,
  (select count(*) from radar_opportunity) as n_oportunidades;`, 'leitura');
const orgId = String(cfg.org_id ?? ''); if (!UUID.test(orgId)) falhar('perfil sem organização');
const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
const r0: RadarDataset = {
  ...radarVazio(),
  fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m('regrasScore', cfg.regras_score), regrasPersona: m('regrasPersona', cfg.regras_persona),
  configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  tiposResposta: lista(cfg.tipos_resposta).map((x) => ({ codigo: String(x.code), nome: String(x.name), sentimento: x.sentiment as never, ativo: !!x.active })),
  empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
  supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades),
};
console.log(`   empresas ${r0.empresas.length} · contatos ${r0.contatos.length} · sinais ${r0.sinais.length} · snapshots ${r0.snapshotsScore.length} · oportunidades ${String(cfg.n_oportunidades)}`);

// ---------------------------------------------------------------------------------------------- 2) empresa (sem ambiguidade)
const alvo = normalizarNome(sinal.empresa) ?? sinal.empresa.toLowerCase();
const ativas = r0.empresas.filter((e) => e.ativo && !e.mescladaEm);
let candidatas = ativas.filter((e) => normalizarNome(e.razaoSocial) === alvo || (e.nomeFantasia && normalizarNome(e.nomeFantasia) === alvo));
if (!candidatas.length) candidatas = ativas.filter((e) => (normalizarNome(e.razaoSocial) ?? '').startsWith(alvo));
if (candidatas.length !== 1) falhar(`empresa "${sinal.empresa}": ${candidatas.length} candidata(s) (${candidatas.map((e) => e.razaoSocial).join(' | ') || 'nenhuma'}). Ambiguidade ou ausência: nada gravado.`);
const empresa = candidatas[0];
const fonte = r0.fontes.find((f) => f.codigo === sinal.fonte) ?? falhar(`fonte ${sinal.fonte} não existe em produção`);
const hoje = new Date().toISOString().slice(0, 10); const agora = new Date().toISOString();
const foto = (r: RadarDataset) => {
  const e = r.empresas.find((x) => x.id === empresa.id)!;
  const l = visaoSignalPilot(r, hoje, [e.razaoSocial])[0];
  const fila = filaHoje(r, hoje); const pos = fila.findIndex((i) => i.empresa.id === e.id);
  return { priorityScore: e.priorityScore, priorityClass: e.priorityClass, timing: e.timingScore, intent: e.intentScore, decisionFit: l.decisionFit ?? null, contato: l.contato ?? null, signalCount: l.signalCount, strongestSignal: l.strongestSignal ?? '—', whyNow: l.whyNow, recommendedAction: l.recommendedAction, origemAcao: l.origemAcao ?? null, estadoCrm: l.estadoCrm ?? null, posicaoHoje: pos >= 0 ? `${pos + 1} de ${fila.length}` : `fora da fila (${fila.length} na fila)`, ultimoSinalEm: e.ultimoSinalEm ?? null };
};
console.log(`2) Empresa: ${empresa.razaoSocial} · company_id ${empresa.id} · fonte ${fonte.codigo} (confiabilidade ${fonte.confiabilidade})`);
const antes = foto(r0);
console.log('   ANTES: ' + JSON.stringify(antes));

// ---------------------------------------------------------------------------------------------- 3) registrar em memoria (logica oficial)
const ids = criarIds(r0, { hoje, agora, usuarioId: perfilId });
const res = registrarSinalNormalizado(r0, empresa.id, { tipo: sinal.tipo, titulo: sinal.titulo.trim(), descricao: sinal.descricao, eventoEm: sinal.eventoEm, confianca: sinal.confianca ?? 1, url: sinal.url?.trim() || undefined }, { id: fonte.id, tipo: fonte.tipo, confiabilidade: fonte.confiabilidade }, ids, { payload: payloadComLeitura(sinal.bruto, sinal.leitura), verificado: sinal.verificado });
if (res.resultado === 'ignorada') falhar('este sinal já está registrado (mesmo tipo, título e data na mesma fonte).');
const r1 = recalcularEmpresas(res.radar, [empresa.id], ids);
const s = res.sinal;
const depois = foto(r1);
const novoSnap = r1.snapshotsScore.filter((x) => !r0.snapshotsScore.some((y) => y.id === x.id));
console.log(`3) Sinal em memória: id provisório ${s.id} · confiança informada ${sinal.confianca} · efetiva ${s.confianca} · base_score ${s.scoreBase} · effective_score ${s.scoreEfetivo} · detected_at ${s.detectadoEm} · verified ${s.verificado} · url ${s.url ?? 'PENDENTE'}`);
console.log('   DEPOIS: ' + JSON.stringify(depois));
console.log(`   snapshot novo: ${novoSnap.length} (${novoSnap.map((x) => `${x.classe} ${x.total}`).join(', ') || 'nenhum: score/classe não mudaram o suficiente'})`);

if (!sinal.url?.trim()) { console.log('\nPARADO: original_url ausente. Nada gravado. Forneça a URL oficial validada e repita.'); process.exit(2); }

// ---------------------------------------------------------------------------------------------- 4) SQL
const mapa = new Map<string, string>();
const uuidDe = (id?: string) => (!id ? null : UUID.test(id) ? id : (mapa.get(id) ?? (mapa.set(id, randomUUID()), mapa.get(id)!)));
const ref = (_c: ChaveRadar, id?: string) => uuidDe(id);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const ins = (tabela: string, row: Record<string, unknown>) => { const cols = Object.keys(row); return `insert into ${tabela} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`; };
const sinalId = uuidDe(s.id)!;
const stmts = [`insert into radar_signal (id, organization_id, ${Object.keys(linhaDb('sinais', s, ref, h)).join(', ')}) values (${lit(sinalId)}, ${lit(orgId)}, ${Object.values(linhaDb('sinais', s, ref, h)).map(lit).join(', ')});`];
for (const sn of novoSnap) stmts.push(ins('radar_score_snapshot', { id: uuidDe(sn.id), organization_id: orgId, ...linhaDb('snapshotsScore', sn, ref, h) }));
const e1 = r1.empresas.find((x) => x.id === empresa.id)!;
const rowE = linhaDb('empresas', e1, ref, h) as Record<string, unknown>;
const colsE = ['fit_score', 'intent_score', 'timing_score', 'relationship_score', 'data_quality_score', 'priority_score', 'priority_class', 'last_signal_at', 'last_contact_at', 'next_action_at'];
stmts.push(`update radar_company set ${colsE.map((c) => `${c} = ${lit(rowE[c])}`).join(', ')}, updated_at = now(), updated_by = ${lit(perfilId)} where id = ${lit(empresa.id)} and organization_id = ${lit(orgId)};`);
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...stmts, 'commit;'].join('\n');
const arqSql = arg('sql', path.join(os.tmpdir(), `radar-sinal-${Date.now()}.sql`));
fs.writeFileSync(arqSql, script);
console.log(`4) SQL gerado (${stmts.length} comandos) em ${arqSql} · signal_id ${sinalId}`);
if (!flag('executar')) { console.log('\nSimulação concluída. Nada foi gravado. Repita com --executar para aplicar.'); process.exit(0); }

// ---------------------------------------------------------------------------------------------- 5) aplicar e conferir
console.log('5) Aplicando em produção (uma transação)…');
sql(script, 'gravação do sinal');
const [v] = sql(`select (select count(*) from radar_signal where organization_id = '${orgId}') as sinais_total,
  (select json_agg(json_build_object('id', id, 'company_id', company_id, 'signal_type', signal_type, 'title', title, 'event_at', event_at, 'detected_at', detected_at, 'source_id', source_id, 'original_url', original_url, 'confidence', confidence, 'base_score', base_score, 'effective_score', effective_score, 'verified', verified, 'raw_payload', raw_payload)) from radar_signal where id = '${sinalId}') as sinal,
  (select json_build_object('priority_score', priority_score, 'priority_class', priority_class, 'timing_score', timing_score, 'intent_score', intent_score, 'last_signal_at', last_signal_at) from radar_company where id = '${empresa.id}') as empresa,
  (select count(*) from radar_score_snapshot where company_id = '${empresa.id}') as snapshots_empresa,
  (select count(*) from radar_opportunity where organization_id = '${orgId}') as oportunidades;`, 'conferência');
console.log('6) Conferência no banco: ' + JSON.stringify(v));
console.log('\nConcluído. Nenhuma chamada externa.');
