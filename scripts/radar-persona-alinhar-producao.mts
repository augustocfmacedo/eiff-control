// DECISION MAKER PRODUCTION ALIGNMENT 01: espelha em producao SOMENTE as regras de persona aprovadas na Calibration 01
// (commit ced0d18), recalcula persona/decision fit dos contatos existentes e as empresas afetadas, tudo auditavel:
// simulacao -> diff esperado -> transacao unica (rollback em erro) -> validacao de contagens. Idempotente: sem diferenca, nada grava.
// Nao chama Explorium, nao importa contatos, nao cria oportunidades. Ao final reproduz em memoria (regras COMO PRODUCAO)
// os candidatos reais do preview (Marcelo/Lineker) sem chamar o Vibe.
// Uso: npx vite-node scripts/radar-persona-alinhar-producao.mts -- --perfil <uuid> [--executar] [--saida <json>] [--sql <arquivo>]
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarDecisor } from '../src/core/radar/buscaDecisor';
import { coberturaEmpresa } from '../src/core/radar/cobertura';
import { enriquecerContato, sugerirContatoPrincipal } from '../src/core/radar/contatos';
import { criarIds, recalcularEmpresas } from '../src/core/radar/importacao';
import { REGRAS_PERSONA_PADRAO } from '../src/core/radar/padroes';
import { compararRegrasPersona, diferencasSaoDaCalibracao01 } from '../src/core/radar/personaRegras';
import { recomendarAcao } from '../src/core/radar/pipeline';
import { radarVazio, type Contato, type Empresa, type Fonte, type RadarDataset, type RegraPersona, type RegraScore, type Sinal } from '../src/core/radar/types';
import { linhaApp, linhaDb, type ChaveRadar, type HelpersRadar } from '../src/data/radar.supabase';

const PROJETO = 'dduobppgomqyagjviwpx';
const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const perfilId = arg('perfil'); if (!UUID.test(perfilId)) { console.error('Informe --perfil <uuid>'); process.exit(2); }
const falhar = (m: string): never => { console.error(`PARADO: ${m}`); process.exit(1); };
function sql(texto: string, rotulo: string): Record<string, unknown>[] {
  const arq = path.join(os.tmpdir(), `radar-p-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`); fs.writeFileSync(arq, texto);
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', PROJETO, '-f', arq], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 }); fs.unlinkSync(arq);
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`; const i = saida.indexOf('{'); if (r.status !== 0 || i < 0) falhar(`${rotulo}: ${saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 600)}`);
  const j = JSON.parse(saida.slice(i, saida.lastIndexOf('}') + 1)) as { rows?: Record<string, unknown>[]; error?: unknown }; if (j.error) falhar(`${rotulo}: ${JSON.stringify(j.error).slice(0, 400)}`);
  return j.rows ?? [];
}
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const ag = (t: string, ordem = 'created_at') => `(select json_agg(x order by x.${ordem}) from ${t} x where x.organization_id = (select organization_id from profile where id = '${perfilId}'))`;
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : Array.isArray(v) ? `array[${v.map((x) => lit(x)).join(', ')}]::text[]` : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------------------------- 1) producao
console.log('1) Lendo produção (somente leitura)…');
const carregar = () => {
  const [cfg] = sql(`select (select organization_id from profile where id = '${perfilId}') as org_id, ${ag('radar_source')} as fontes, ${ag('radar_score_rule', 'priority')} as regras_score, ${ag('radar_persona_rule', 'priority')} as regras_persona,
  (select json_agg(json_build_object('key', key, 'value', value)) from radar_score_setting) as config_score, (select json_agg(json_build_object('key', key, 'value', value)) from radar_decision_fit_weight) as pesos_fit,
  ${ag('radar_company')} as empresas, ${ag('radar_contact')} as contatos, ${ag('radar_signal', 'detected_at')} as sinais, ${ag('radar_score_snapshot', 'scored_at')} as snapshots,
  ${ag('radar_suppression')} as supressoes, ${ag('radar_project', 'name')} as projetos, ${ag('radar_task', 'due_at')} as tarefas, ${ag('radar_opportunity')} as oportunidades, ${ag('radar_activity', 'occurred_at')} as atividades, ${ag('radar_source_record', 'received_at')} as registros,
  (select count(*) from radar_vibe_operation) as operacoes_vibe;`, 'leitura');
  const m = <T,>(chave: ChaveRadar, v: unknown) => lista(v).map((x) => linhaApp(chave, x)) as unknown as T[];
  const r: RadarDataset = {
    ...radarVazio(), fontes: m<Fonte>('fontes', cfg.fontes), regrasScore: m<RegraScore>('regrasScore', cfg.regras_score), regrasPersona: m<RegraPersona>('regrasPersona', cfg.regras_persona),
    configScore: lista(cfg.config_score).map((x) => ({ chave: String(x.key), valor: Number(x.value) })), pesosDecisionFit: lista(cfg.pesos_fit).map((x) => ({ chave: String(x.key), valor: Number(x.value) })),
    empresas: m('empresas', cfg.empresas), contatos: m('contatos', cfg.contatos), sinais: m<Sinal>('sinais', cfg.sinais), snapshotsScore: m('snapshotsScore', cfg.snapshots),
    supressoes: m('supressoes', cfg.supressoes), projetos: m('projetos', cfg.projetos), tarefas: m('tarefas', cfg.tarefas), oportunidades: m('oportunidades', cfg.oportunidades), atividades: m('atividades', cfg.atividades), registrosFonte: m('registrosFonte', cfg.registros),
  };
  return { r, orgId: String(cfg.org_id ?? ''), operacoesVibe: Number(cfg.operacoes_vibe ?? 0) };
};
const { r: r0, orgId, operacoesVibe: opsAntes } = carregar();
if (!UUID.test(orgId)) falhar('perfil sem organização');
const hoje = new Date().toISOString().slice(0, 10); const agora = new Date().toISOString();
const nome = (e: { nomeFantasia?: string; razaoSocial: string }) => e.nomeFantasia ?? e.razaoSocial;
console.log(`   ${r0.regrasPersona.length} regras de persona · ${r0.contatos.length} contatos · ${r0.empresas.length} empresas · ${r0.sinais.length} sinais · ${r0.snapshotsScore.length} snapshots · ${r0.oportunidades.length} oportunidades · ${opsAntes} operações Vibe`);
const saida: Record<string, unknown> = { antes: { regrasPersona: r0.regrasPersona.length, contatos: r0.contatos.length, empresas: r0.empresas.length, sinais: r0.sinais.length, snapshots: r0.snapshotsScore.length, oportunidades: r0.oportunidades.length, operacoesVibe: opsAntes } };
saida.regrasProducaoAntes = r0.regrasPersona.map((g) => ({ prioridade: g.prioridade, persona: g.persona, campo: g.campo, termos: g.termos, excluir: g.excluir ?? null, ativo: g.ativo }));

// ---------------------------------------------------------------------------------------------- 2) diff das regras (so Calibration 01)
const cmp = compararRegrasPersona(r0.regrasPersona, REGRAS_PERSONA_PADRAO);
saida.diffRegras = cmp.diferencas;
const escopo = diferencasSaoDaCalibracao01(cmp.diferencas);
if (!escopo.ok) falhar(`divergência fora da Calibration 01 em radar_persona_rule: ${JSON.stringify(escopo.foraDoEscopo).slice(0, 800)}`);
console.log(`2) Regras: ${cmp.alinhado ? 'já alinhadas' : `${cmp.diferencas.filter((d) => d.tipo === 'inserir').length} a inserir, ${cmp.diferencas.filter((d) => d.tipo === 'atualizar').length} a atualizar`} (todas dentro da Calibration 01)`);

// regras como ficarao (padrao do codigo, com os ids de producao quando existem)
const idNovo = new Map<string, string>();
const regrasNovas: RegraPersona[] = REGRAS_PERSONA_PADRAO.map((p) => { const a = r0.regrasPersona.find((g) => g.persona === p.persona && g.campo === p.campo && (g.termos[0] ?? '').toLowerCase() === (p.termos[0] ?? '').toLowerCase()); const id = a?.id ?? (idNovo.get(p.id) ?? (idNovo.set(p.id, randomUUID()), idNovo.get(p.id)!)); return { ...p, id }; });

// ---------------------------------------------------------------------------------------------- 3) recalculo dos contatos em memoria
const r1: RadarDataset = { ...r0, regrasPersona: regrasNovas };
const porEmpresa = new Map(r0.empresas.map((e) => [e.id, e]));
const contatosDepois = r0.contatos.map((c) => enriquecerContato(c, porEmpresa.get(c.empresaId), r1, hoje));
const CAMPOS_CONTATO: (keyof Contato)[] = ['persona', 'senioridade', 'decisionFitScore', 'decisor', 'poderDecisao', 'qualidade'];
const mudancasContato = contatosDepois.map((d) => { const a = r0.contatos.find((x) => x.id === d.id)!; const campos = CAMPOS_CONTATO.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null)); return { a, d, campos }; }).filter((x) => x.campos.length);
saida.contatosAntesDepois = mudancasContato.map(({ a, d, campos }) => ({ contato: a.nome, empresa: nome(porEmpresa.get(a.empresaId)!), cargo: a.cargo, departamento: a.departamento ?? null, campos, antes: Object.fromEntries(campos.map((k) => [k, a[k] ?? null])), depois: Object.fromEntries(campos.map((k) => [k, d[k] ?? null])) }));
// invariantes: dados brutos intocados
for (const { a, d } of mudancasContato) for (const k of ['fonteExternaId', 'email', 'telefone', 'celular', 'whatsapp', 'linkedin', 'cargo', 'departamento', 'nome'] as (keyof Contato)[]) if ((a[k] ?? null) !== (d[k] ?? null)) falhar(`o recálculo alteraria ${k} de ${a.nome}`);
const r2a: RadarDataset = { ...r1, contatos: contatosDepois };

// ---------------------------------------------------------------------------------------------- 4) empresas afetadas
const foto = (r: RadarDataset, e: Empresa) => { const s = sugerirContatoPrincipal(e, r.contatos, r); return { fit: e.fitScore, timing: e.timingScore, intent: e.intentScore, relationship: e.relationshipScore, dataQuality: e.dataQualityScore, priority: e.priorityScore, classe: e.priorityClass, cobertura: coberturaEmpresa(e, r).nivel, contato: s ? `${s.contato.nome} (${s.fit.score})` : null, crm: recomendarAcao(e, r, hoje).estado }; };
const empresasAfetadasIds = [...new Set(mudancasContato.map((x) => x.a.empresaId))];
const ids = criarIds(r2a, { hoje, agora, usuarioId: perfilId });
const r2 = recalcularEmpresas(r2a, empresasAfetadasIds, ids);
const novosSnaps = r2.snapshotsScore.filter((s) => !r0.snapshotsScore.some((x) => x.id === s.id));
const colsE = ['fit_score', 'intent_score', 'timing_score', 'relationship_score', 'data_quality_score', 'priority_score', 'priority_class', 'last_signal_at', 'next_action_at'];
const mapa = new Map<string, string>();
const uuidDe = (id?: string) => (!id ? null : UUID.test(id) ? id : (mapa.get(id) ?? (mapa.set(id, randomUUID()), mapa.get(id)!)));
const ref = (_c: ChaveRadar, id?: string) => uuidDe(id);
const h = { orgId, atorId: perfilId, uuid: (v?: string) => (v && UUID.test(v) ? v : null), perfil: (id?: string) => (id && UUID.test(id) ? id : null) } as unknown as HelpersRadar;
const rowE = (e: Empresa) => linhaDb('empresas', e, ref, h) as Record<string, unknown>;
const empresasMudadas = empresasAfetadasIds.map((id) => ({ a: porEmpresa.get(id)!, d: r2.empresas.find((e) => e.id === id)! })).filter(({ a, d }) => colsE.some((c) => JSON.stringify(rowE(a)[c]) !== JSON.stringify(rowE(d)[c])));
saida.empresasAntesDepois = empresasAfetadasIds.map((id) => { const a = porEmpresa.get(id)!; const d = r2.empresas.find((e) => e.id === id)!; return { empresa: nome(a), antes: foto(r0, a), depois: foto(r2, d), scoreMudou: empresasMudadas.some((x) => x.a.id === id) }; });

// ---------------------------------------------------------------------------------------------- 5) validacoes Agro/Fiagril + reproducao do preview (em memoria, regras como producao)
const agro = r2.empresas.find((e) => e.id === '0302b534-93fe-474c-92fa-ecd7ed65d018'); const fia = r2.empresas.find((e) => e.id === '2030f4ed-836a-4199-93c6-8293d617805d');
if (!agro || !fia) falhar('Agro Amazônia/Fiagril não encontradas');
const fitDe = (e: Empresa, n: RegExp) => { const c = r2.contatos.find((x) => x.empresaId === e.id && n.test(x.nome)); return c ? { nome: c.nome, persona: c.persona, fit: c.decisionFitScore } : null; };
saida.validacaoContas = { agro: fitDe(agro, /motta/i), fiagril: fitDe(fia, /mazzardo/i) };
if (saida.validacaoContas && (fitDe(agro, /motta/i)?.fit !== 55 || fitDe(fia, /mazzardo/i)?.fit !== 55)) falhar('decision fit de Roberto Motta/Henrique Mazzardo diferente de 55 após o recálculo');
const P = (n: number) => n.toString(16).padStart(40, '0');
const previa = buscarDecisor(agro, [
  { prospect_id: P(1), business_id: agro.businessId, full_name: 'Marcelo Gomes', job_title: 'Gerente industrial / supply chain of fertilizer', city: 'Patos de Minas' },
  { prospect_id: P(2), business_id: agro.businessId, full_name: 'Líneker Silva', job_title: 'Gerente industrial', job_department_main: 'Operations', job_level_main: 'manager', city: 'Ibiá' },
], r2, hoje);
saida.reproducaoPreview = { atual: previa.atual ? { nome: previa.atual.contato.nome, fit: previa.atual.fit } : null, candidatos: previa.candidatos.map((c) => ({ nome: c.nome, persona: c.persona, senioridade: c.senioridade, fit: c.fit, razoes: c.razoes, melhor: c.melhorQueAtual })), recomendacao: previa.recomendacao, motivo: previa.motivo };
const marcelo = previa.candidatos.find((c) => /marcelo/i.test(c.nome)); const lineker = previa.candidatos.find((c) => /neker/i.test(c.nome));
if (!(marcelo?.persona === 'MANUFACTURING' && marcelo.senioridade === 'Gerente' && marcelo.fit === 55 && lineker?.persona === 'MANUFACTURING' && lineker.senioridade === 'Gerente' && lineker.fit === 61)) falhar(`reprodução do preview divergiu da Calibration 01: ${JSON.stringify(saida.reproducaoPreview)}`);

// ---------------------------------------------------------------------------------------------- 6) SQL
const stmts: string[] = [];
for (const d of cmp.diferencas) {
  if (d.tipo === 'inserir') { const g = regrasNovas.find((x) => x.persona === d.regra!.persona && x.campo === d.regra!.campo && x.termos[0] === d.regra!.termos[0])!; stmts.push(`insert into radar_persona_rule (id, organization_id, persona, field, terms, exclude_terms, priority, active) values (${lit(g.id)}, ${lit(orgId)}, ${lit(g.persona)}, ${lit(g.campo)}, ${lit(g.termos)}, ${lit(g.excluir ?? null)}, ${lit(g.prioridade)}, true);`); }
  if (d.tipo === 'atualizar') { const sets: string[] = []; if (d.campos!.includes('termos')) sets.push(`terms = ${lit(d.para!.termos)}`); if (d.campos!.includes('excluir')) sets.push(`exclude_terms = ${lit(d.para!.excluir ?? null)}`); if (d.campos!.includes('prioridade')) sets.push(`priority = ${lit(d.para!.prioridade)}`); if (d.campos!.includes('ativo')) sets.push(`active = ${lit(d.para!.ativo)}`); stmts.push(`update radar_persona_rule set ${sets.join(', ')} where id = ${lit(d.id)} and organization_id = ${lit(orgId)};`); }
}
// prioridades deslocadas: atualizar do maior para o menor evita colisao caso exista indice unico
stmts.sort((a, b) => (a.startsWith('update') && b.startsWith('update') ? (Number(/priority = (\d+)/.exec(b)?.[1] ?? 0) - Number(/priority = (\d+)/.exec(a)?.[1] ?? 0)) : a.startsWith('insert') ? 1 : -1));
const colContato: Record<string, string> = { persona: 'persona', senioridade: 'seniority', decisionFitScore: 'decision_fit_score', decisor: 'is_decision_maker', poderDecisao: 'decision_power', qualidade: 'contact_quality' };
for (const { a, d, campos } of mudancasContato) stmts.push(`update radar_contact set ${campos.map((k) => `${colContato[k]} = ${lit(d[k] ?? null)}`).join(', ')}, updated_at = now() where id = ${lit(a.id)} and organization_id = ${lit(orgId)} and decision_fit_score = ${lit(a.decisionFitScore ?? 0)};`);
for (const { d } of empresasMudadas) { const row = rowE(d); stmts.push(`update radar_company set ${colsE.map((c) => `${c} = ${lit(row[c])}`).join(', ')}, updated_at = now(), updated_by = ${lit(perfilId)} where id = ${lit(d.id)} and organization_id = ${lit(orgId)};`); }
const ins = (tabela: string, row: Record<string, unknown>) => { const cols = Object.keys(row); return `insert into ${tabela} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`; };
for (const sn of novosSnaps) stmts.push(ins('radar_score_snapshot', { id: uuidDe(sn.id), organization_id: orgId, ...linhaDb('snapshotsScore', sn, ref, h) }));
const script = ['begin;', `select set_config('request.jwt.claim.sub', '${perfilId}', true);`, ...stmts, 'commit;'].join('\n');
const arqSql = arg('sql', path.join(os.tmpdir(), `radar-persona-${Date.now()}.sql`)); fs.writeFileSync(arqSql, script);
saida.diffEsperado = { regrasInseridas: cmp.diferencas.filter((d) => d.tipo === 'inserir').length, regrasAtualizadas: cmp.diferencas.filter((d) => d.tipo === 'atualizar').length, contatosAtualizados: mudancasContato.length, empresasRecalculadas: empresasAfetadasIds.length, empresasComScoreAlterado: empresasMudadas.length, snapshotsInseridos: novosSnaps.length, comandosSql: stmts.length, arquivoSql: arqSql };
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'persona-alinhar.json')), JSON.stringify(saida, null, 1));
console.log('3) Contatos que mudam: ' + (mudancasContato.length ? mudancasContato.map(({ a, d }) => `${a.nome} ${a.persona}/${a.decisionFitScore}→${d.persona}/${d.decisionFitScore}${a.decisor !== d.decisor ? ` decisor ${a.decisor}→${d.decisor}` : ''}`).join(' | ') : 'nenhum'));
console.log('4) Empresas afetadas: ' + (empresasAfetadasIds.length ? (saida.empresasAntesDepois as { empresa: string; antes: { priority: number; classe: string; crm: string }; depois: { priority: number; classe: string; crm: string }; scoreMudou: boolean }[]).map((x) => `${x.empresa} ${x.antes.priority}/${x.antes.classe}/${x.antes.crm} → ${x.depois.priority}/${x.depois.classe}/${x.depois.crm}${x.scoreMudou ? '' : ' (sem mudança de score)'}`).join(' | ') : 'nenhuma'));
console.log('5) Agro/Fiagril: ' + JSON.stringify(saida.validacaoContas) + ' · preview em memória: ' + previa.candidatos.map((c) => `${c.nome} ${c.persona}/${c.senioridade}/${c.fit}`).join(', ') + ` · ${previa.recomendacao}`);
console.log('diff esperado: ' + JSON.stringify(saida.diffEsperado));
if (!stmts.length) { console.log('\nNada a gravar: produção já alinhada.'); process.exit(0); }
if (!flag('executar')) { console.log('\nSimulação concluída. Nada gravado.'); process.exit(0); }

// ---------------------------------------------------------------------------------------------- 7) aplicar e validar
console.log('7) Aplicando em produção (uma transação)…');
sql(script, 'aplicação');
const falharPos = (m: string): never => { console.error(`APLICADO (transação confirmada), mas a validação posterior divergiu: ${m}.`); process.exit(1); };
const { r: r3, operacoesVibe: opsDepois } = carregar();
const cmp2 = compararRegrasPersona(r3.regrasPersona, REGRAS_PERSONA_PADRAO);
saida.depois = { regrasPersona: r3.regrasPersona.length, regrasAlinhadas: cmp2.alinhado, contatos: r3.contatos.length, empresas: r3.empresas.length, sinais: r3.sinais.length, snapshots: r3.snapshotsScore.length, oportunidades: r3.oportunidades.length, operacoesVibe: opsDepois, contatosConferidos: mudancasContato.every(({ a, d }) => { const g = r3.contatos.find((x) => x.id === a.id)!; return g.decisionFitScore === d.decisionFitScore && g.persona === d.persona && g.decisor === d.decisor; }) };
fs.writeFileSync(arg('saida', path.join(os.tmpdir(), 'persona-alinhar.json')), JSON.stringify(saida, null, 1));
console.log('8) Validação: ' + JSON.stringify(saida.depois));
if (!cmp2.alinhado) falharPos(`regras ainda divergem: ${JSON.stringify(cmp2.diferencas).slice(0, 400)}`);
if (r3.contatos.length !== r0.contatos.length || r3.empresas.length !== r0.empresas.length || r3.sinais.length !== r0.sinais.length || r3.oportunidades.length !== 0 || opsDepois !== opsAntes) falharPos('contagens mudaram');
if (r3.snapshotsScore.length !== r0.snapshotsScore.length + novosSnaps.length) falharPos('snapshots divergem');
if (!(saida.depois as { contatosConferidos: boolean }).contatosConferidos) falharPos('contatos não ficaram como o esperado');
console.log('\nAplicado e validado.');
