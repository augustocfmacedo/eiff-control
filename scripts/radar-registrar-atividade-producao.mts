// Registra em producao atividades do Radar (nota/ligacao/etc.) e, opcionalmente, a proxima tarefa manual, com a mesma
// validacao do store (empresa, contato da empresa, tipo/canal/resultado validos, estrategia por codigo) e o motor de score
// oficial (recalculo da empresa; snapshot so se o score mudar). Simula, mostra o diff, grava numa transacao, valida contagens.
// Nao cria oportunidade, nao envia mensagem, nao chama fontes externas.
// Uso: npx vite-node scripts/radar-registrar-atividade-producao.mts -- --perfil <uuid> --spec <json> [--executar] [--saida <json>]
// spec: { registros: [{ empresaId, contatoId?, tipo, canal, estrategiaCodigo?, resultado?, notas, conteudoBruto?, conteudoBrutoArquivo?, ocorreuEm?, tarefa?: { tipo, prioridade, venceEm, descricao } }] }
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarIds, recalcularEmpresas } from '../src/core/radar/importacao';
import { filaHoje, recomendarAcao } from '../src/core/radar/pipeline';
import { CANAIS, TIPOS_ATIVIDADE, TIPOS_TAREFA, radarVazio, type Atividade, type Canal, type CodigoResposta, type Empresa, type Fonte, type RadarDataset, type RegraScore, type Sinal, type TarefaRadar, type TipoAtividade, type TipoTarefa } from '../src/core/radar/types';
import { linhaApp, linhaDb, type ChaveRadar, type HelpersRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const perfilId = arg('perfil'); if (!UUID.test(perfilId)) { console.error('Informe --perfil <uuid>'); process.exit(2); }
const specArq = arg('spec'); if (!specArq || !fs.existsSync(specArq)) { console.error('Informe --spec <json>'); process.exit(2); }
const falhar = (m: string): never => { console.error(`PARADO: ${m}`); process.exit(1); };
function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-atv-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`); fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 }); fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; const i = saida.indexOf('{'); if (r.status !== 0 || i < 0) falhar(`${rotulo}: ${saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 600)}`);
  const j = JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[]; error?: unknown }; if (j.error) falhar(`${rotulo}: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.rows ?? [];
}
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const ag = (t: string, ordem = 'created_at') => `(select json_agg(x order by x.${ordem}) from ${t} x where x.organization_id = (select organization_id from profile where id = '${perfilId}'))`;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;

interface Spec { registros: { empresaId: string; contatoId?: string; tipo: TipoAtividade; canal: Canal; estrategiaCodigo?: string; resultado?: CodigoResposta; notas: string; conteudoBruto?: string; conteudoBrutoArquivo?: string; ocorreuEm?: string; tarefa?: { tipo: TipoTarefa; prioridade: TarefaRadar['prioridade']; venceEm: string; descricao: string } }[] }
const spec = JSON.parse(fs.readFileSync(specArq, 'utf8')) as Spec;

// ---------------------------------------------------------------------------------------------- 1) producao
console.log('1) Lendo produção (somente leitura)…');
const carregar = () => {
  const [cfg] = sql(`select (select organization_id from profile where id = '${perfilId}') as org_id, ${ag('radar_source')} as fontes, ${ag('radar_score_rule', 'priority')} as regras_score, ${ag('radar_persona_rule', 'priority')} as regras_persona, ${ag('radar_strategy', 'sort_order')} as estrategias,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score, (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  (select json_agg(json_build_object('code', code, 'name', name, 'sentiment', sentiment, 'active', active)) from radar_response_type) as tipos_resposta,
  ${ag('radar_company')} as empresas, ${ag('radar_contact')} as contatos, ${ag('radar_signal', 'detected_at')} as sinais, ${ag('radar_score_snapshot', 'scored_at')} as snapshots,
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades, ${ag('radar_source_record', 'received_at')} as registros,
  (select count(*) from radar_vibe_operation) as ops_vibe;`, 'leitura');
  const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
  const r: RadarDataset = {
    ...radarVazio(), fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m<RegraScore>('regrasScore', cfg.regras_score), regrasPersona: m('regrasPersona', cfg.regras_persona), estrategias: m('estrategias', cfg.estrategias),
    configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
    tiposResposta: lista(cfg.tipos_resposta).map((x) => ({ codigo: String(x.code) as CodigoResposta, nome: String(x.name), sentimento: x.sentiment as never, ativo: !!x.active })),
    empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m<Sinal>('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
    supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades), registrosFonte: m('registrosFonte', cfg.registros), // registros brutos: o FIT (setor por NAICS/descricao) depende deles
  };
  return { r, orgId: String(cfg.org_id ?? ''), opsVibe: Number(cfg.ops_vibe ?? 0) };
};
const { r: r0, orgId, opsVibe: opsAntes } = carregar();
if (!UUID.test(orgId)) falhar('perfil sem organização');
const hoje = new Date().toISOString().slice(0, 10); const agora = new Date().toISOString();
const nome = (e: Empresa) => e.nomeFantasia ?? e.razaoSocial;
console.log(`   ${r0.empresas.length} empresas · ${r0.contatos.length} contatos · ${r0.atividades.length} atividades · ${r0.tarefas.length} tarefas · ${r0.oportunidades.length} oportunidades · ${r0.estrategias.length} estratégias · ${opsAntes} operações Vibe`);

// ---------------------------------------------------------------------------------------------- 2) validacao (mesmas regras do store) e montagem
let r1: RadarDataset = r0;
const ids = criarIds(r0, { hoje, agora, usuarioId: perfilId });
const novasAtividades: Atividade[] = []; const novasTarefas: TarefaRadar[] = [];
for (const s of spec.registros) {
  const e = r0.empresas.find((x) => x.id === s.empresaId) ?? falhar(`empresa ${s.empresaId} não encontrada`);
  if (!TIPOS_ATIVIDADE.includes(s.tipo) || !CANAIS.includes(s.canal)) falhar(`tipo/canal inválido em ${nome(e)}`);
  if (s.resultado && !r0.tiposResposta.some((t) => t.codigo === s.resultado && t.ativo)) falhar(`resultado inválido em ${nome(e)}`);
  if (s.contatoId && !r0.contatos.some((c) => c.id === s.contatoId && c.empresaId === e.id)) falhar(`contato ${s.contatoId} não pertence a ${nome(e)}`);
  if (s.contatoId && r0.supressoes.some((x) => x.contatoId === s.contatoId && (x.tipo === 'do_not_contact' || x.tipo === 'opt_out'))) falhar(`contato suprimido em ${nome(e)}`);
  const estr = s.estrategiaCodigo ? (r0.estrategias.find((x) => x.codigo === s.estrategiaCodigo && x.ativo) ?? falhar(`estratégia ${s.estrategiaCodigo} não existe/inativa`)) : undefined;
  if (!s.notas?.trim()) falhar(`nota vazia em ${nome(e)}`);
  const bruto = s.conteudoBruto ?? (s.conteudoBrutoArquivo ? fs.readFileSync(path.resolve(path.dirname(specArq), s.conteudoBrutoArquivo), 'utf8') : undefined);
  const a: Atividade = { id: ids.novo('ATV'), empresaId: e.id, contatoId: s.contatoId, usuarioId: perfilId, tipo: s.tipo, canal: s.canal, estrategiaId: estr?.id, ocorreuEm: s.ocorreuEm ?? agora, resultado: s.resultado, notas: s.notas.trim(), conteudoBruto: bruto, criadoEm: agora };
  novasAtividades.push(a);
  if (s.tarefa) {
    if (!TIPOS_TAREFA.includes(s.tarefa.tipo) || !s.tarefa.descricao?.trim() || !s.tarefa.venceEm) falhar(`tarefa inválida em ${nome(e)}`);
    novasTarefas.push({ id: ids.novo('TSK'), empresaId: e.id, contatoId: s.contatoId, responsavelId: perfilId, tipo: s.tarefa.tipo, prioridade: s.tarefa.prioridade, venceEm: s.tarefa.venceEm, status: 'Aberta', descricao: s.tarefa.descricao.trim(), criadoEm: agora });
  }
}
r1 = { ...r0, atividades: [...r0.atividades, ...novasAtividades], tarefas: [...r0.tarefas, ...novasTarefas] };
const afetadas = [...new Set(novasAtividades.map((a) => a.empresaId))];
const r2 = recalcularEmpresas(r1, afetadas, ids);
const novosSnaps = r2.snapshotsScore.filter((s) => !r0.snapshotsScore.some((x) => x.id === s.id));
const foto = (r: RadarDataset, e: Empresa) => { const fila = filaHoje(r, hoje); const pos = fila.findIndex((i) => i.empresa.id === e.id); return { priority: e.priorityScore, classe: e.priorityClass, timing: e.timingScore, relationship: e.relationshipScore, intent: e.intentScore, crm: recomendarAcao(e, r, hoje).estado, fila: pos >= 0 ? pos + 1 : null, proximaAcao: fila[pos]?.proximaAcaoEm ?? null }; };
const saida: Record<string, unknown> = {
  antes: { atividades: r0.atividades.length, tarefas: r0.tarefas.length, oportunidades: r0.oportunidades.length, opsVibe: opsAntes },
  registros: novasAtividades.map((a) => ({ empresa: nome(r0.empresas.find((e) => e.id === a.empresaId)!), contato: r0.contatos.find((c) => c.id === a.contatoId)?.nome ?? null, tipo: a.tipo, canal: a.canal, estrategia: r0.estrategias.find((x) => x.id === a.estrategiaId)?.codigo ?? null, resultado: a.resultado ?? null, notas: a.notas, conteudoBrutoChars: a.conteudoBruto?.length ?? 0 })),
  tarefas: novasTarefas.map((t) => ({ empresa: nome(r0.empresas.find((e) => e.id === t.empresaId)!), tipo: t.tipo, prioridade: t.prioridade, venceEm: t.venceEm, descricao: t.descricao.slice(0, 160) + '…' })),
  empresasAntesDepois: afetadas.map((id) => ({ empresa: nome(r0.empresas.find((e) => e.id === id)!), antes: foto(r0, r0.empresas.find((e) => e.id === id)!), depois: foto(r2, r2.empresas.find((e) => e.id === id)!) })),
  scoreMudou: afetadas.filter((id) => { const a = r0.empresas.find((e) => e.id === id)!; const d = r2.empresas.find((e) => e.id === id)!; return a.priorityScore !== d.priorityScore || a.priorityClass !== d.priorityClass; }).length,
  snapshotsNovos: novosSnaps.length,
};

// ---------------------------------------------------------------------------------------------- 3) SQL
const mapa = new Map<string, string>();
const uuidDe = (id?: string) => (!id ? null : UUID.test(id) ? id : (mapa.get(id) ?? (mapa.set(id, randomUUID()), mapa.get(id)!)));
const ref = (_c: ChaveRadar, id?: string) => uuidDe(id);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const ins = (tabela: string, row: Record<string, unknown>) => { const cols = Object.keys(row); return `insert into ${tabela} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`; };
const stmts: string[] = [];
for (const a of novasAtividades) stmts.push(ins('radar_activity', { id: uuidDe(a.id), organization_id: orgId, ...linhaDb('atividades', a, ref, h) }));
for (const t of novasTarefas) stmts.push(ins('radar_task', { id: uuidDe(t.id), organization_id: orgId, ...linhaDb('tarefas', t, ref, h) }));
const colsE = ['fit_score', 'intent_score', 'timing_score', 'relationship_score', 'data_quality_score', 'priority_score', 'priority_class', 'last_signal_at', 'last_contact_at', 'next_action_at'];
for (const id of afetadas) { const a = r0.empresas.find((e) => e.id === id)!; const d = r2.empresas.find((e) => e.id === id)!; const ra = linhaDb('empresas', a, ref, h) as Record<string, unknown>; const rd = linhaDb('empresas', d, ref, h) as Record<string, unknown>; if (colsE.every((c) => JSON.stringify(ra[c]) === JSON.stringify(rd[c]))) continue; stmts.push(`update radar_company set ${colsE.map((c) => `${c} = ${lit(rd[c])}`).join(', ')}, updated_at = now(), updated_by = ${lit(perfilId)} where id = ${lit(id)} and organization_id = ${lit(orgId)};`); }
for (const sn of novosSnaps) stmts.push(ins('radar_score_snapshot', { id: uuidDe(sn.id), organization_id: orgId, ...linhaDb('snapshotsScore', sn, ref, h) }));
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...stmts, 'commit;'].join('\n');
const arqSql = path.join(os.tmpdir(), `radar-atividade-${Date.now()}.sql`); fs.writeFileSync(arqSql, script);
saida.diffEsperado = { atividades: novasAtividades.length, tarefas: novasTarefas.length, empresasAtualizadas: stmts.filter((s) => s.startsWith('update radar_company')).length, snapshots: novosSnaps.length, comandosSql: stmts.length, arquivoSql: arqSql };
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'radar-atividade.json')), JSON.stringify(saida, null, 1));
console.log('2) ' + JSON.stringify(saida.registros, null, 0).slice(0, 1200));
console.log('3) empresas: ' + JSON.stringify(saida.empresasAntesDepois));
console.log('diff esperado: ' + JSON.stringify(saida.diffEsperado));
if (!flag('executar')) { console.log('\nSimulação concluída. Nada gravado.'); process.exit(0); }

// ---------------------------------------------------------------------------------------------- 4) aplicar e validar
console.log('4) Aplicando em produção (uma transação)…');
sql(script, 'aplicação');
const { r: r3, opsVibe: opsDepois } = carregar();
saida.depois = { atividades: r3.atividades.length, tarefas: r3.tarefas.length, oportunidades: r3.oportunidades.length, opsVibe: opsDepois, snapshots: r3.snapshotsScore.length, contatos: r3.contatos.length, empresas: r3.empresas.length };
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'radar-atividade.json')), JSON.stringify(saida, null, 1));
console.log('5) Validação: ' + JSON.stringify(saida.depois));
if (r3.atividades.length !== r0.atividades.length + novasAtividades.length || r3.tarefas.length !== r0.tarefas.length + novasTarefas.length || r3.oportunidades.length !== r0.oportunidades.length || opsDepois !== opsAntes || r3.contatos.length !== r0.contatos.length) { console.error('APLICADO, mas as contagens divergem do esperado.'); process.exit(1); }
console.log('\nAplicado e validado.');
