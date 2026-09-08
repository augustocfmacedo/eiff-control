// CALIBRATION PILOT 02: auditoria e simulacao de FIT sobre as 91 empresas em PRODUCAO. Somente leitura; nada e gravado.
// Uso: npx vite-node scripts/radar-calibracao-fit.mts -- --perfil <uuid>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JANELAS_FAMILIA_HIPOTESE, JANELAS_FAMILIA_MODERADA, simularCenario, type Cenario, type ResultadoCenario } from '../src/core/radar/calibracao';
import { CENARIOS_FIT, classificarSetor, distribuicao, fitCalibrado, type NomeCenarioFit } from '../src/core/radar/fitCalibracao';
import { normalizarNome } from '../src/core/radar/normalizar';
import { contextoEmpresa } from '../src/core/radar/pipeline';
import { calcularScore, classificar, configDe } from '../src/core/radar/score';
import { EMPRESAS_SIGNAL_PILOT } from '../src/core/radar/signalPilot';
import { DIMENSOES, radarVazio, type Empresa, type Fonte, type RadarDataset } from '../src/core/radar/types';
import { linhaApp, type ChaveRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const perfilId = arg('perfil'); if (!perfilId) { console.error('Informe --perfil <uuid>'); process.exit(2); }
function sql(texto: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-f-${Date.now()}.sql`); fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 }); fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; const i = saida.indexOf('{'); if (r.status !== 0 || i < 0) { console.error(saida.slice(0, 500)); process.exit(1); }
  return (JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[] }).rows ?? [];
}
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const ag = (t: string, ordem = 'created_at') => `(select json_agg(x order by x.${ordem}) from ${t} x where x.organization_id = (select organization_id from profile where id = '${perfilId}'))`;
const [cfg] = sql(`select ${ag('radar_source')} as fontes, ${ag('radar_score_rule', 'priority')} as regras_score, ${ag('radar_persona_rule', 'priority')} as regras_persona,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score, (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  (select json_agg(json_build_object('code', code, 'name', name, 'sentiment', sentiment, 'active', active)) from radar_response_type) as tipos_resposta,
  ${ag('radar_company')} as empresas, ${ag('radar_contact')} as contatos, ${ag('radar_signal', 'detected_at')} as sinais, ${ag('radar_score_snapshot', 'scored_at')} as snapshots,
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades,
  (select json_agg(json_build_object('entity_id', entity_id, 'payload', payload)) from radar_source_record where record_type = 'empresa' and external_id ~ '^[a-f0-9]{32}$') as brutos;`);
const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
const r: RadarDataset = {
  ...radarVazio(), fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m('regrasScore', cfg.regras_score), regrasPersona: m('regrasPersona', cfg.regras_persona),
  configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  tiposResposta: lista(cfg.tipos_resposta).map((x) => ({ codigo: String(x.code), nome: String(x.name), sentimento: x.sentiment as never, ativo: !!x.active })),
  empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
  supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades),
};
const brutos = new Map(lista(cfg.brutos).map((x) => [String(x.entity_id), (x.payload ?? {}) as Record<string, string>]));
const extraDe = (e: Empresa) => { const p = brutos.get(e.id) ?? {}; return { naics: p.business_naics, naicsDescricao: p.business_naics_description, sic: p.business_sic_code, sicDescricao: p.business_sic_code_description, descricao: p.business_business_description }; };
const hoje = new Date().toISOString().slice(0, 10);
const empresas = r.empresas.filter((e) => e.ativo && !e.mescladaEm && e.businessId);
const nome = (e: Empresa) => e.nomeFantasia ?? e.razaoSocial;
const pct = (n: number) => `${Math.round((n / empresas.length) * 1000) / 10}%`;
const saida: Record<string, unknown> = {};

// 2) auditoria das regras FIT
const regrasFit = r.regrasScore.filter((g) => g.ativo && g.dimensao === 'FIT');
const audit = regrasFit.map((g) => ({ id: g.id, nome: g.nome, condicao: JSON.stringify(g.condicao), peso: g.peso, disparos: 0, pontos: 0 }));
for (const e of empresas) { const x = calcularScore(contextoEmpresa(r, e.id)!, r.regrasScore, r.configScore, hoje); for (const f of x.dimensoes.find((d) => d.dimensao === 'FIT')!.fatores) { const a = audit.find((y) => y.id === f.regraId); if (a) { a.disparos++; a.pontos += f.pontos; } } }
saida.regrasFit = audit.map((a) => ({ ...a, pct: pct(a.disparos), contribuicaoMedia: a.disparos ? Math.round((a.pontos / a.disparos) * 10) / 10 : 0, situacao: a.disparos === 0 ? 'morta (dado ausente ou formato incompatível)' : a.disparos === empresas.length ? 'dispara para todas (não discrimina)' : 'útil' }));

// 3) distribuicao atual
saida.fitAtual = distribuicao(empresas.map((e) => e.fitScore));
saida.classesAtual = empresas.reduce<Record<string, number>>((acc, e) => { acc[e.priorityClass] = (acc[e.priorityClass] ?? 0) + 1; return acc; }, {});

// 4) classificacao de setor
const cls = empresas.map((e) => ({ e, c: classificarSetor({ nome: nome(e), setor: e.setor, ...extraDe(e) }) }));
saida.categorias = cls.reduce<Record<string, number>>((acc, x) => { acc[x.c.categoria] = (acc[x.c.categoria] ?? 0) + 1; return acc; }, {});
saida.evidencias = cls.reduce<Record<string, number>>((acc, x) => { acc[x.c.evidencia] = (acc[x.c.evidencia] ?? 0) + 1; return acc; }, {});
saida.classificacaoTodas = cls.map((x) => ({ empresa: nome(x.e), setorOriginal: x.e.setor, sic: x.c.original.sic, categoria: x.c.categoria, motivo: x.c.motivo }));

// 5-7) cenarios de FIT
const { pesos, classes } = configDe(r.configScore);
const somaPesos = DIMENSOES.reduce((s, d) => s + pesos[d], 0) || 1;
const totalCom = (e: Empresa, fit: number) => Math.round(((fit * pesos.FIT + e.timingScore * pesos.TIMING + e.intentScore * pesos.INTENT + e.relationshipScore * pesos.RELATIONSHIP + e.dataQualityScore * pesos.DATA_QUALITY) / somaPesos) * 10) / 10;
const porCenario: Record<string, unknown> = {};
const fitDe: Record<NomeCenarioFit, Map<string, number>> = { CONSERVADOR: new Map(), BALANCEADO: new Map(), AGRESSIVO: new Map() };
for (const cen of Object.values(CENARIOS_FIT)) {
  const linhas = empresas.map((e) => { const f = fitCalibrado(e, cen, extraDe(e)); fitDe[cen.nome].set(e.id, f.score); const total = totalCom(e, f.score); return { empresa: nome(e), categoria: f.categoria, fitAtual: e.fitScore, fit: f.score, delta: Math.round((f.score - e.fitScore) * 10) / 10, priorityAtual: e.priorityScore, priority: total, classeAtual: e.priorityClass, classe: classificar(total, r.configScore), fatores: f.fatores.map((x) => `${x.componente} ${x.pontos} (${x.motivo})`).join(' · ') }; });
  const ordenadas = [...linhas].sort((a, b) => b.fit - a.fit || a.empresa.localeCompare(b.empresa));
  porCenario[cen.nome] = {
    pesos: cen.pesos, fit: distribuicao(linhas.map((l) => l.fit)), priority: distribuicao(linhas.map((l) => l.priority)),
    classes: linhas.reduce<Record<string, number>>((acc, l) => { acc[l.classe] = (acc[l.classe] ?? 0) + 1; return acc; }, {}),
    top20: ordenadas.slice(0, 20).map((l) => `${l.empresa} · ${l.categoria} · FIT ${l.fit} (antes ${l.fitAtual}) · priority ${l.priority} ${l.classe}`),
    maisSobem: [...linhas].sort((a, b) => b.delta - a.delta).slice(0, 8).map((l) => `${l.empresa} +${l.delta} (${l.categoria})`),
    maisCaem: [...linhas].sort((a, b) => a.delta - b.delta).slice(0, 8).map((l) => `${l.empresa} ${l.delta} (${l.categoria})`),
    pilot: EMPRESAS_SIGNAL_PILOT.map((n) => { const alvo = normalizarNome(n) ?? ''; const l = linhas.find((x) => (normalizarNome(x.empresa) ?? '').startsWith(alvo)); return l ? `${l.empresa}: FIT ${l.fitAtual} → ${l.fit} · priority ${l.priorityAtual} → ${l.priority} · ${l.classeAtual} → ${l.classe} · ${l.fatores}` : `${n}: não encontrada`; }),
  };
}
saida.cenarios = porCenario;

// 8) combinado para as contas com sinal real (e as 10 do pilot) com FIT BALANCEADO + fonte 0.95 + decay por familia + recencia por familia + CRM simulado
const cenariosComb: Cenario[] = [
  { nome: 'atual' },
  { nome: 'FIT balanceado' , fit: (e) => fitDe.BALANCEADO.get(e.id) ?? e.fitScore },
  { nome: 'FIT bal + fonte 0,95 + decay 540/270/120 + recência por família', fit: (e) => fitDe.BALANCEADO.get(e.id) ?? e.fitScore, confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_HIPOTESE, recenciaPorFamilia: JANELAS_FAMILIA_HIPOTESE },
  { nome: 'FIT bal + fonte 0,95 + decay 365/180/90 + recência por família', fit: (e) => fitDe.BALANCEADO.get(e.id) ?? e.fitScore, confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_MODERADA, recenciaPorFamilia: JANELAS_FAMILIA_MODERADA },
  { nome: 'FIT agressivo + fonte 0,95 + decay 540/270/120 + recência por família', fit: (e) => fitDe.AGRESSIVO.get(e.id) ?? e.fitScore, confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_HIPOTESE, recenciaPorFamilia: JANELAS_FAMILIA_HIPOTESE },
];
const fmt = (x: ResultadoCenario) => ({ cenario: x.cenario, fit: x.fit, timing: x.timing, intent: x.intent, relationship: x.relationship, dataQuality: x.dataQuality, priority: x.priorityScore, classe: x.priorityClass, decisionFit: x.decisionFit ?? null, confEfetiva: x.confiancaEfetiva, effScore: x.effectiveScore, decay: x.fatorDecay, matriz: `${x.matriz} (${x.conta})`, analista: x.analista ?? '—', crmAtual: x.crmAtual, crmSimulado: x.crmSimulado, conflito: x.conflito });
saida.combinado = Object.fromEntries(EMPRESAS_SIGNAL_PILOT.map((n) => { const alvo = normalizarNome(n) ?? ''; const e = empresas.find((x) => (normalizarNome(x.razaoSocial) ?? '').startsWith(alvo)); return [n, e ? cenariosComb.map((c) => fmt(simularCenario(r, e.id, hoje, c)!)) : 'não encontrada']; }));
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'calibracao-fit.json')), JSON.stringify(saida, null, 1));
console.log(JSON.stringify(saida));
