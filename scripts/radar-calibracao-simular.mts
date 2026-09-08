// CALIBRATION PILOT 01: simulacoes SOMENTE LEITURA sobre o Radar de producao. Nada e gravado, nada e chamado fora do banco.
// Uso: npx vite-node scripts/radar-calibracao-simular.mts -- --perfil <uuid> --empresas "Agro Amazônia,Fiagril"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CENARIOS_COMBINADOS, CENARIOS_FONTE, CENARIOS_JANELA, simularCenario, type ResultadoCenario } from '../src/core/radar/calibracao';
import { normalizarNome } from '../src/core/radar/normalizar';
import { filaHoje } from '../src/core/radar/pipeline';
import { radarVazio, type Fonte, type RadarDataset } from '../src/core/radar/types';
import { linhaApp, type ChaveRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const perfilId = arg('perfil'); const nomes = arg('empresas').split(',').map((s) => s.trim()).filter(Boolean);
if (!perfilId || !nomes.length) { console.error('Informe --perfil <uuid> --empresas "A,B"'); process.exit(2); }

function sql(texto: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-c-${Date.now()}.sql`); fs.writeFileSync(arq, texto);
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
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades;`);
const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
const r: RadarDataset = {
  ...radarVazio(), fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m('regrasScore', cfg.regras_score), regrasPersona: m('regrasPersona', cfg.regras_persona),
  configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
  tiposResposta: lista(cfg.tipos_resposta).map((x) => ({ codigo: String(x.code), nome: String(x.name), sentimento: x.sentiment as never, ativo: !!x.active })),
  empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
  supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades),
};
const hoje = new Date().toISOString().slice(0, 10);
console.log(`Radar de produção (leitura): ${r.empresas.length} empresas · ${r.sinais.length} sinais · fontes: ${r.fontes.map((f) => `${f.codigo} ${f.confiabilidade}`).join(', ')}`);
console.log(`Regras de sinal (peso / janela de decaimento): ${r.regrasScore.filter((g) => g.condicao.tipo === 'sinal').map((g) => `${g.tipoSinal} ${g.peso}/${g.decaimentoDias ?? '∞'}`).join(' · ')}`);
console.log(`Cortes: fit.ideal ${r.pesosDecisionFit.find((p) => p.chave === 'fit.ideal')?.valor} · fit.adequado ${r.pesosDecisionFit.find((p) => p.chave === 'fit.adequado')?.valor ?? '40 (padrão do código)'}`);
const linha = (x: ResultadoCenario) => `${x.cenario.padEnd(40)} conf ${x.confiancaInformada}→${x.confiancaEfetiva}  eff ${String(x.effectiveScore).padStart(5)}  decay ${x.fatorDecay} (${x.janelaAplicada ?? '∞'} d)  timing ${String(x.timing).padStart(5)}  intent ${x.intent}  priority ${String(x.priorityScore).padStart(5)} ${x.priorityClass}  matriz ${x.matriz} (${x.conta})  CRM ${x.crmAtual} → sim ${x.crmSimulado}  analista ${x.analista ?? '—'}  ${x.conflito}`;
const fila = filaHoje(r, hoje);
for (const nome of nomes) {
  const alvo = normalizarNome(nome) ?? nome.toLowerCase();
  const e = r.empresas.find((x) => normalizarNome(x.razaoSocial) === alvo) ?? r.empresas.find((x) => (normalizarNome(x.razaoSocial) ?? '').startsWith(alvo));
  if (!e) { console.log(`\n== ${nome}: não encontrada`); continue; }
  const pos = fila.findIndex((i) => i.empresa.id === e.id);
  console.log(`\n== ${e.razaoSocial} (${e.id}) · fila Hoje ${pos + 1} de ${fila.length}`);
  for (const [titulo, cenarios] of [['1) credibilidade da fonte (decaimento atual)', CENARIOS_FONTE], ['2) janela de decaimento (fonte atual)', CENARIOS_JANELA], ['6) cenários combinados', CENARIOS_COMBINADOS]] as const) {
    console.log(`  ${titulo}`);
    for (const c of cenarios) { const x = simularCenario(r, e.id, hoje, c); if (x) console.log('   ' + linha(x)); }
  }
}
console.log('\nNada foi gravado.');
