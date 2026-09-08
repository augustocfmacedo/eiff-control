// PRODUCTION CALIBRATION 01: aplica em producao, com simulacao previa e diff esperado, numa unica transacao:
//  1) fonte OFFICIAL_COMPANY_SOURCE (0,95) e atualizacao dos 2 sinais reais (source_id, confidence 0,95 x 0,95 = 0,9025,
//     gravada como 0,903 porque radar_signal.confidence e numeric(4,3); effective_score = base x confianca gravada);
//  2) decaimento por familia nas regras de sinal (540/270/120); tipos sem familia mantidos;
//  3) regras FIT antigas desativadas e 5 regras 'fitCalibrado' inseridas (15/35/25/20/5);
//  4) recalculo das 91 empresas com o motor atual (codigo) e snapshots novos (os anteriores ficam).
// Sem --executar: so simula (Fase B/C/D/E) e grava o SQL. Nada e chamado fora do banco.
// Uso: npx vite-node scripts/radar-calibracao-aplicar.mts -- --perfil <uuid> [--executar] [--saida <json>] [--sql <arquivo>]
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confiancaEfetiva } from '../src/core/radar/calibracao';
import { coberturaEmpresa } from '../src/core/radar/cobertura';
import { CENARIOS_FIT, SEM_GATE, classificarSetor, distribuicao, fitCalibrado } from '../src/core/radar/fitCalibracao';
import { criarIds, recalcularEmpresas } from '../src/core/radar/importacao';
import { normalizarNome } from '../src/core/radar/normalizar';
import { contextoEmpresa, filaHoje, recomendarAcao } from '../src/core/radar/pipeline';
import { calcularScore } from '../src/core/radar/score';
import { janelaPorTipo, leituraDe } from '../src/core/radar/sinalLeitura';
import { EMPRESAS_SIGNAL_PILOT, visaoSignalPilot } from '../src/core/radar/signalPilot';
import { radarVazio, type Fonte, type RadarDataset, type RegraScore, type Sinal, type TipoSinal } from '../src/core/radar/types';
import { linhaApp, linhaDb, type ChaveRadar, type HelpersRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const perfilId = arg('perfil'); if (!UUID.test(perfilId)) { console.error('Informe --perfil <uuid>'); process.exit(2); }
const falhar = (m: string): never => { console.error(`PARADO: ${m}`); process.exit(1); };
function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-a-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`); fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 }); fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; const i = saida.indexOf('{'); if (r.status !== 0 || i < 0) falhar(`${rotulo}: ${saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 600)}`);
  const j = JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[]; error?: unknown }; if (j.error) falhar(`${rotulo}: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.rows ?? [];
}
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const ag = (t: string, ordem = 'created_at') => `(select json_agg(x order by x.${ordem}) from ${t} x where x.organization_id = (select organization_id from profile where id = '${perfilId}'))`;

// ---------------------------------------------------------------------------------------------- 1) producao
console.log('1) Lendo produção (somente leitura)…');
const [cfg] = sql(`select (select organization_id from profile where id = '${perfilId}') as org_id, ${ag('radar_source')} as fontes, ${ag('radar_score_rule', 'priority')} as regras_score, ${ag('radar_persona_rule', 'priority')} as regras_persona,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score, (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  (select json_agg(json_build_object('code', code, 'name', name, 'sentiment', sentiment, 'active', active)) from radar_response_type) as tipos_resposta,
  ${ag('radar_company')} as empresas, ${ag('radar_contact')} as contatos, ${ag('radar_signal', 'detected_at')} as sinais, ${ag('radar_score_snapshot', 'scored_at')} as snapshots,
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades, ${ag('radar_source_record', 'received_at')} as registros;`, 'leitura');
const orgId = String(cfg.org_id ?? ''); if (!UUID.test(orgId)) falhar('perfil sem organização');
const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
const r0: RadarDataset = {
  ...radarVazio(), fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m<RegraScore>('regrasScore', cfg.regras_score), regrasPersona: m('regrasPersona', cfg.regras_persona),
  configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  tiposResposta: lista(cfg.tipos_resposta).map((x) => ({ codigo: String(x.code), nome: String(x.name), sentimento: x.sentiment as never, ativo: !!x.active })),
  empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m<Sinal>('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
  supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades), registrosFonte: m('registrosFonte', cfg.registros),
};
const hoje = new Date().toISOString().slice(0, 10); const agora = new Date().toISOString();
const empresas = r0.empresas.filter((e) => e.ativo && !e.mescladaEm);
const nome = (e: { nomeFantasia?: string; razaoSocial: string }) => e.nomeFantasia ?? e.razaoSocial;
const brutoDe = (id: string) => { const p = (r0.registrosFonte.filter((x) => x.tipo === 'empresa' && x.entidadeId === id).at(-1)?.payload ?? {}) as Record<string, string>; return { naics: p.business_naics, naicsDescricao: p.business_naics_description, sic: p.business_sic_code, sicDescricao: p.business_sic_code_description, descricao: p.business_business_description }; };
console.log(`   ${empresas.length} empresas · ${r0.contatos.length} contatos · ${r0.sinais.length} sinais · ${r0.snapshotsScore.length} snapshots · ${r0.regrasScore.length} regras · fontes ${r0.fontes.map((f) => `${f.codigo} ${f.confiabilidade}`).join(', ')}`);
if (r0.fontes.some((f) => f.codigo === 'OFFICIAL_COMPANY_SOURCE')) falhar('OFFICIAL_COMPANY_SOURCE já existe: calibração já aplicada?');
if (r0.regrasScore.some((g) => g.condicao.tipo === 'fitCalibrado')) falhar('regras fitCalibrado já existem: calibração já aplicada?');

// ---------------------------------------------------------------------------------------------- 2) Fases B/C/D: classificacao e gate
const saida: Record<string, unknown> = {};
const cls = empresas.map((e) => { const b = brutoDe(e.id); const c = classificarSetor({ nome: nome(e), setor: e.setor, ...b }); return { empresa: nome(e), setorOriginal: e.setor, naics: c.original.naics, sic: c.original.sic, descricao: (b.descricao ?? '').replace(/\s+/g, ' ').slice(0, 140), categoria: c.categoria, evidencia: c.evidencia, motivo: c.motivo, confianca: c.confianca, conflito: c.conflito ?? null, afinidade: CENARIOS_FIT.BALANCEADO.afinidade[c.categoria], revisao: c.revisao }; });
saida.classificacao = cls;
saida.totais = { HIGH: cls.filter((x) => x.confianca === 'HIGH').length, MEDIUM: cls.filter((x) => x.confianca === 'MEDIUM').length, LOW: cls.filter((x) => x.confianca === 'LOW').length, REVIEW_REQUIRED: cls.filter((x) => x.revisao).length };
const pilotNomes = EMPRESAS_SIGNAL_PILOT.map((n) => normalizarNome(n) ?? '');
const ehPilot = (n: string) => pilotNomes.some((p) => (normalizarNome(n) ?? '').startsWith(p));
saida.revisaoEspecial = cls.filter((x) => ehPilot(x.empresa) || x.revisao);
const semGate = empresas.map((e) => ({ e, s: fitCalibrado(e, CENARIOS_FIT.BALANCEADO, brutoDe(e.id), SEM_GATE).score }));
const comGate = empresas.map((e) => ({ e, s: fitCalibrado(e, CENARIOS_FIT.BALANCEADO, brutoDe(e.id)).score }));
const top20 = (xs: { e: typeof empresas[number]; s: number }[]) => [...xs].sort((a, b) => b.s - a.s || nome(a.e).localeCompare(nome(b.e))).slice(0, 20).map((x) => `${nome(x.e)} ${x.s}`);
const difs = empresas.map((e, i) => ({ empresa: nome(e), semGate: semGate[i].s, comGate: comGate[i].s, dif: Math.round((comGate[i].s - semGate[i].s) * 10) / 10 })).sort((a, b) => a.dif - b.dif);
saida.gate = { semGate: distribuicao(semGate.map((x) => x.s)), comGate: distribuicao(comGate.map((x) => x.s)), top20SemGate: top20(semGate), top20ComGate: top20(comGate), maioresDiferencas: difs.filter((d) => d.dif !== 0).slice(0, 15), pilot: EMPRESAS_SIGNAL_PILOT.map((n) => difs.find((d) => (normalizarNome(d.empresa) ?? '').startsWith(normalizarNome(n) ?? '')) ?? { empresa: n, nota: 'não encontrada' }) };

// ---------------------------------------------------------------------------------------------- 3) alteracoes em memoria (fonte, sinais, regras)
const novaFonte: Fonte = { id: 'FONTE-OFICIAL-NOVA', codigo: 'OFFICIAL_COMPANY_SOURCE', nome: 'Comunicado oficial da empresa', tipo: 'WEBSITE', descricao: 'Comunicados, releases e páginas institucionais publicados pela própria empresa', confiabilidade: 0.95, ativo: true, criadoEm: agora };
const site = r0.fontes.find((f) => f.codigo === 'WEBSITE') ?? falhar('fonte WEBSITE não existe');
const sinaisAlvo = r0.sinais.filter((s) => s.fonteId === site.id && /agro amaz|fiagril/i.test(nome(r0.empresas.find((e) => e.id === s.empresaId)!)));
if (sinaisAlvo.length !== 2) falhar(`esperava 2 sinais reais em Site da empresa, achei ${sinaisAlvo.length}`);
const CONF_OFICIAL = confiancaEfetiva(0.95, novaFonte.confiabilidade); // 0,9025 -> 0,903 (3 casas, como a coluna e o motor)
const sinaisNovos = r0.sinais.map((s) => (sinaisAlvo.some((x) => x.id === s.id) ? { ...s, fonteId: novaFonte.id, confianca: CONF_OFICIAL, scoreEfetivo: Math.round(s.scoreBase * CONF_OFICIAL * 10) / 10 } : s));
const DECAY: Partial<Record<TipoSinal, number>> = Object.fromEntries((Object.keys(r0.regrasScore.length ? {} : {}) as string[]).map((k) => [k, 0]));
const familias: TipoSinal[] = ['NEW_FACTORY', 'NEW_DC', 'WAREHOUSE', 'CNO_NEW', 'CNO_EXPANSION', 'LAND_PURCHASE', 'EXPANSION', 'PROJECT_IDENTIFIED', 'INVESTMENT', 'PUBLIC_PLAN', 'PUBLIC_TENDER', 'PARTNER_REFERRAL', 'HIRING_ENGINEERING', 'HIRING_OPERATIONS', 'NEWS', 'WEBSITE_CHANGE'];
for (const t of familias) DECAY[t] = janelaPorTipo(t);
const regrasFitAntigas = r0.regrasScore.filter((g) => g.dimensao === 'FIT');
const mantidos: string[] = [];
const regrasNovas: RegraScore[] = r0.regrasScore.map((g) => {
  if (g.dimensao === 'FIT') return { ...g, ativo: false };
  if (g.condicao.tipo === 'sinal') { const d = DECAY[g.condicao.tipoSinal]; if (d === undefined) { mantidos.push(`${g.condicao.tipoSinal} ${g.decaimentoDias ?? '∞'} d`); return g; } return d === g.decaimentoDias ? g : { ...g, decaimento: true, decaimentoDias: d }; }
  return g;
});
const prioridadeBase = Math.max(0, ...r0.regrasScore.map((g) => g.prioridade)) + 1;
const fitRegras: RegraScore[] = ([['FIT · Geografia', 'geografia', 15], ['FIT · Setor (categoria canônica com gate de confiança)', 'setor', 35], ['FIT · Porte por funcionários', 'funcionarios', 25], ['FIT · Faixa de receita', 'receita', 20], ['FIT · Porte industrial', 'porteIndustrial', 5]] as const).map(([n, comp, peso], i) => ({ id: `RS-FIT-NOVA-${i + 1}`, nome: n, dimensao: 'FIT', condicao: { tipo: 'fitCalibrado', componente: comp }, peso, decaimento: false, ativo: true, prioridade: prioridadeBase + i }));
const r1: RadarDataset = { ...r0, fontes: [...r0.fontes, novaFonte], sinais: sinaisNovos, regrasScore: [...regrasNovas, ...fitRegras] };

// ---------------------------------------------------------------------------------------------- 4) recalculo em memoria
const ids = criarIds(r1, { hoje, agora, usuarioId: perfilId });
const r2 = recalcularEmpresas(r1, empresas.map((e) => e.id), ids);
const novosSnaps = r2.snapshotsScore.filter((s) => !r0.snapshotsScore.some((x) => x.id === s.id));
const dep = r2.empresas.filter((e) => e.ativo && !e.mescladaEm);
const foto = (r: RadarDataset, e: typeof dep[number]) => { const l = visaoSignalPilot(r, hoje, [e.razaoSocial])[0]; const rec = recomendarAcao(e, r, hoje); const fila = filaHoje(r, hoje); const pos = fila.findIndex((i) => i.empresa.id === e.id); return { fit: e.fitScore, timing: e.timingScore, intent: e.intentScore, relationship: e.relationshipScore, dataQuality: e.dataQualityScore, priority: e.priorityScore, classe: e.priorityClass, decisionFit: l.decisionFit ?? null, contato: l.contato ?? null, cobertura: coberturaEmpresa(e, r).nivel, matriz: l.matriz ? `${l.matriz.acao} (${l.matriz.conta})` : null, analista: l.leitura?.acaoRecomendada ?? null, crm: rec.estado, conflito: l.conflito ?? null, whyNow: l.whyNow, fila: pos >= 0 ? pos + 1 : null }; };
saida.pilotAntesDepois = EMPRESAS_SIGNAL_PILOT.map((n) => { const alvo = normalizarNome(n) ?? ''; const a = empresas.find((e) => (normalizarNome(e.razaoSocial) ?? '').startsWith(alvo)); const d = a ? dep.find((e) => e.id === a.id)! : undefined; return a && d ? { empresa: nome(a), antes: foto(r0, a), depois: foto(r2, d) } : { empresa: n, nota: 'não encontrada' }; });
saida.distribuicoes = { fitAntes: distribuicao(empresas.map((e) => e.fitScore)), fitDepois: distribuicao(dep.map((e) => e.fitScore)), priorityAntes: distribuicao(empresas.map((e) => e.priorityScore)), priorityDepois: distribuicao(dep.map((e) => e.priorityScore)), classesAntes: empresas.reduce<Record<string, number>>((a, e) => { a[e.priorityClass] = (a[e.priorityClass] ?? 0) + 1; return a; }, {}), classesDepois: dep.reduce<Record<string, number>>((a, e) => { a[e.priorityClass] = (a[e.priorityClass] ?? 0) + 1; return a; }, {}), top20Priority: [...dep].sort((a, b) => b.priorityScore - a.priorityScore || nome(a).localeCompare(nome(b))).slice(0, 20).map((e) => `${nome(e)} ${e.priorityScore} ${e.priorityClass} (FIT ${e.fitScore})`), top20Fit: [...dep].sort((a, b) => b.fitScore - a.fitScore || nome(a).localeCompare(nome(b))).slice(0, 20).map((e) => `${nome(e)} ${e.fitScore}`) };
saida.sinaisReais = sinaisAlvo.map((s) => { const n = r2.sinais.find((x) => x.id === s.id)!; const x = calcularScore(contextoEmpresa(r2, s.empresaId)!, r2.regrasScore, r2.configScore, hoje); return { empresa: nome(r0.empresas.find((e) => e.id === s.empresaId)!), id: s.id, antes: { fonte: site.codigo, confianca: s.confianca, effective: s.scoreEfetivo }, depois: { fonte: novaFonte.codigo, confianca: n.confianca, effective: n.scoreEfetivo, base: n.scoreBase, verificado: n.verificado, url: n.url, leitura: leituraDe(n), payloadIgual: JSON.stringify(n.payload) === JSON.stringify(s.payload) }, timingDepois: x.dimensoes.find((d) => d.dimensao === 'TIMING')!.fatores.map((f) => f.motivo).join(' | ') }; });
saida.decay = { aplicado: DECAY, mantidos };
saida.semSnapshotNovo = dep.filter((e) => !novosSnaps.some((s) => s.empresaId === e.id)).map((e) => { const a = empresas.find((z) => z.id === e.id)!; return `${nome(e)}: FIT ${a.fitScore} → ${e.fitScore}, Priority ${a.priorityScore} → ${e.priorityScore} (total e classe iguais: regra do motor não grava snapshot)`; });
// ---------------------------------------------------------------------------------------------- 5) Fase E: go/no-go
const checks = {
  nenhumLowInfluenciaSetor: cls.filter((x) => x.confianca === 'LOW').every((x) => { const e = empresas.find((z) => nome(z) === x.empresa)!; return calcularScore(contextoEmpresa(r2, e.id)!, r2.regrasScore, r2.configScore, hoje).dimensoes.find((d) => d.dimensao === 'FIT')!.fatores.every((f) => !f.regra.includes('Setor')); }),
  originaisPreservados: dep.every((e) => { const a = empresas.find((z) => z.id === e.id)!; return a.setor === e.setor && a.faixaFuncionarios === e.faixaFuncionarios && a.faixaReceita === e.faixaReceita && a.razaoSocial === e.razaoSocial; }),
  pilotCoerente: (saida.revisaoEspecial as { empresa: string; confianca: string; revisao: boolean }[]).filter((x) => ehPilot(x.empresa)).every((x) => x.confianca !== 'LOW' || x.revisao),
  sinais2: sinaisAlvo.length === 2, oportunidades: r2.oportunidades.length === 0, snapshotsPreservados: r0.snapshotsScore.every((s) => r2.snapshotsScore.some((x) => x.id === s.id)), pesosGlobaisIntactos: JSON.stringify(r2.configScore) === JSON.stringify(r0.configScore),
};
saida.goNoGo = { ...checks, go: Object.values(checks).every(Boolean) };

// ---------------------------------------------------------------------------------------------- 6) SQL
const mapa = new Map<string, string>();
const uuidDe = (id?: string) => (!id ? null : UUID.test(id) ? id : (mapa.get(id) ?? (mapa.set(id, randomUUID()), mapa.get(id)!)));
const ref = (_c: ChaveRadar, id?: string) => uuidDe(id);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const ins = (tabela: string, row: Record<string, unknown>) => { const cols = Object.keys(row); return `insert into ${tabela} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`; };
const stmts: string[] = [];
const fonteUuid = uuidDe(novaFonte.id)!;
stmts.push(ins('radar_source', { id: fonteUuid, organization_id: orgId, ...linhaDb('fontes', novaFonte, ref, h) }));
for (const s of sinaisAlvo) { const n = r2.sinais.find((x) => x.id === s.id)!; stmts.push(`update radar_signal set source_id = ${lit(fonteUuid)}, confidence = ${lit(CONF_OFICIAL)}, effective_score = ${lit(n.scoreEfetivo)} where id = ${lit(s.id)} and organization_id = ${lit(orgId)} and confidence = ${lit(s.confianca)};`); }
for (const g of regrasFitAntigas) stmts.push(`update radar_score_rule set active = false where id = ${lit(g.id)} and organization_id = ${lit(orgId)};`);
for (const g of regrasNovas) { const o = r0.regrasScore.find((x) => x.id === g.id)!; if (o.decaimentoDias !== g.decaimentoDias) stmts.push(`update radar_score_rule set decay_enabled = true, decay_days = ${lit(g.decaimentoDias)} where id = ${lit(g.id)} and organization_id = ${lit(orgId)};`); }
for (const g of fitRegras) stmts.push(ins('radar_score_rule', { id: uuidDe(g.id), organization_id: orgId, ...linhaDb('regrasScore', g, ref, h) }));
const colsE = ['fit_score', 'intent_score', 'timing_score', 'relationship_score', 'data_quality_score', 'priority_score', 'priority_class', 'last_signal_at', 'next_action_at'];
let empresasAlteradas = 0;
for (const e of dep) { const a = empresas.find((z) => z.id === e.id)!; if (colsE.every((c) => JSON.stringify((linhaDb('empresas', e, ref, h) as Record<string, unknown>)[c]) === JSON.stringify((linhaDb('empresas', a, ref, h) as Record<string, unknown>)[c]))) continue; const row = linhaDb('empresas', e, ref, h) as Record<string, unknown>; stmts.push(`update radar_company set ${colsE.map((c) => `${c} = ${lit(row[c])}`).join(', ')}, updated_at = now(), updated_by = ${lit(perfilId)} where id = ${lit(e.id)} and organization_id = ${lit(orgId)};`); empresasAlteradas++; }
for (const sn of novosSnaps) stmts.push(ins('radar_score_snapshot', { id: uuidDe(sn.id), organization_id: orgId, ...linhaDb('snapshotsScore', sn, ref, h) }));
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...stmts, 'commit;'].join('\n');
const arqSql = arg('sql', path.join(os.tmpdir(), `radar-calibracao-${Date.now()}.sql`)); fs.writeFileSync(arqSql, script);
saida.diffEsperado = { fonteNova: 1, sinaisAtualizados: sinaisAlvo.length, regrasFitDesativadas: regrasFitAntigas.length, regrasDecayAtualizadas: regrasNovas.filter((g) => r0.regrasScore.find((x) => x.id === g.id)!.decaimentoDias !== g.decaimentoDias).length, regrasFitInseridas: fitRegras.length, empresasAtualizadas: empresasAlteradas, snapshotsInseridos: novosSnaps.length, snapshotsAntes: r0.snapshotsScore.length, comandosSql: stmts.length, arquivoSql: arqSql };
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'calibracao-aplicar.json')), JSON.stringify(saida, null, 1));
console.log('go/no-go: ' + JSON.stringify(saida.goNoGo)); console.log('diff esperado: ' + JSON.stringify(saida.diffEsperado));
if (!flag('executar')) { console.log('\nSimulação concluída. Nada gravado.'); process.exit(0); }
if (!(saida.goNoGo as { go: boolean }).go) falhar('condições de GO não atendidas; nada gravado.');

// ---------------------------------------------------------------------------------------------- 7) aplicar e validar
console.log('7) Aplicando em produção (uma transação)…');
sql(script, 'aplicação');
const falharPos = (m: string): never => { console.error(`APLICADO (transação confirmada), mas a validação posterior divergiu: ${m}. Conferir manualmente antes de qualquer nova execução.`); process.exit(1); };
const [v] = sql(`select (select count(*) from radar_source where organization_id = '${orgId}' and code = 'OFFICIAL_COMPANY_SOURCE' and reliability = 0.95 and active) as fonte_oficial,
  (select reliability from radar_source where organization_id = '${orgId}' and code = 'WEBSITE') as site_reliability,
  (select json_agg(json_build_object('empresa', c.legal_name, 'fonte', s2.code, 'confidence', s.confidence, 'effective', s.effective_score, 'base', s.base_score, 'verified', s.verified, 'url', s.original_url, 'relevancia', s.raw_payload->'leitura'->>'relevanciaEstrutural', 'bruto_ok', (s.raw_payload ? 'bruto'), 'timing', c.timing_score) order by c.legal_name) from radar_signal s join radar_company c on c.id = s.company_id join radar_source s2 on s2.id = s.source_id where s.organization_id = '${orgId}') as sinais,
  (select count(*) from radar_score_rule where organization_id = '${orgId}' and dimension = 'FIT' and active) as regras_fit_ativas, (select count(*) from radar_score_rule where organization_id = '${orgId}' and dimension = 'FIT' and not active) as regras_fit_inativas,
  (select json_object_agg(signal_type, decay_days) from radar_score_rule where organization_id = '${orgId}' and signal_type is not null) as decay,
  (select count(*) from radar_score_snapshot where organization_id = '${orgId}') as snapshots, (select count(*) from radar_opportunity) as oportunidades,
  (select json_build_object('min', min(fit_score), 'max', max(fit_score), 'avg', round(avg(fit_score), 1)) from radar_company where organization_id = '${orgId}' and active) as fit,
  (select json_object_agg(priority_class, n) from (select priority_class, count(*) n from radar_company where organization_id = '${orgId}' and active group by 1) x) as classes,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score;`, 'validação');
console.log('8) Validação no banco: ' + JSON.stringify(v));
if (Number(v.snapshots) !== r0.snapshotsScore.length + novosSnaps.length) falharPos(`snapshots: esperado ${r0.snapshotsScore.length + novosSnaps.length}, obtido ${String(v.snapshots)}`);
if (Number(v.fonte_oficial) !== 1 || Number(v.regras_fit_ativas) !== 5 || Number(v.oportunidades) !== 0) falharPos('contagens pós-aplicação divergem do esperado');
const sv = lista(v.sinais); if (sv.length !== 2 || !sv.every((x) => x.fonte === 'OFFICIAL_COMPANY_SOURCE' && Number(x.confidence) === CONF_OFICIAL && x.verified === true && x.bruto_ok === true && x.relevancia === 'DIRECT')) falharPos('os 2 sinais não ficaram como esperado');
if (JSON.stringify(lista(v.config_score).map((x) => [String(x.key), Number(x.value)]).sort()) !== JSON.stringify(r0.configScore.map((x) => [x.chave, x.valor]).sort())) falharPos('pesos/cortes globais mudaram');
console.log('\nAplicado e validado.');
