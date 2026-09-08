#!/usr/bin/env node
// Cliente server-side da Data API do Vibe Prospecting (Explorium AgentSource API v2, https://api.explorium.ai).
// A chave vem SOMENTE da variavel de ambiente VIBE_API_KEY (ou de .env.local / .env, ignorados pelo git).
// Nunca imprime a chave, nunca a grava; log de consumo em dados/vibe/consumo.log sem dados pessoais.
//
// Comandos (nenhum consome creditos sem --executar):
//   node scripts/vibe.mjs creditos
//   node scripts/vibe.mjs validar-contrato                         # creditos + stats gratis + preview de 1 + delta de creditos
//   node scripts/vibe.mjs testar-email --prospect-id <id> [--executar]   # 2 creditos, so com --executar
//   node scripts/vibe.mjs autocomplete <campo> <texto>
//   node scripts/vibe.mjs match --entrada <csv> [--executar] [--budget 180] [--reserve 20]
//   node scripts/vibe.mjs decisores --lista <csv com business_id> [--max 56] [--amostra 5] [--somente-com-email]
//                                    [--budget 180] [--reserve 20] [--paginas 5] [--saida dados/vibe/decisores.csv] [--executar]
//   node scripts/vibe.mjs enriquecer [--entrada dados/vibe/decisores.csv] [--telefone] [--force=sim] [--budget] [--reserve] [--executar]
import fs from 'node:fs';
import path from 'node:path';
import { BUDGET_PADRAO, CUSTO, LOTE_ENRIQUECIMENTO_MAX, POOL_JOB_DEPARTMENT, POOL_JOB_LEVEL, RESERVA_PADRAO, budgetGuard, estimar, filtrarJaProcessados, filtrosDecisores, filtrosPool, filtrosValidados, linhasParaEnriquecer, mascararChaves, mascararEmail, normalizarEnriquecimento, paginar, payloadEnriquecimento, registroConsumo } from './vibe-core.mjs';

const BASE = process.env.VIBE_API_BASE || 'https://api.explorium.ai';
const PASTA = path.join(process.cwd(), 'dados', 'vibe');
const LOG = path.join(PASTA, 'consumo.log');

// Prioridade de decisores (mesma ordem de src/core/radar/vibe.ts)
const PRIORIDADE = [
  { nome: 'engenharia', filtros: { job_department: { values: ['engineering'] }, job_level: { values: ['director', 'manager'] } } },
  { nome: 'direção industrial', filtros: { job_title: { values: ['diretor industrial', 'industrial director', 'plant director', 'diretor de produção', 'diretor fabril'], include_related_job_titles: true } } },
  { nome: 'expansão', filtros: { job_title: { values: ['diretor de expansão', 'expansion director', 'gerente de expansão', 'head of expansion'], include_related_job_titles: true } } },
  { nome: 'operações', filtros: { job_department: { values: ['operations'] }, job_level: { values: ['director', 'manager'] } } },
  { nome: 'facilities', filtros: { job_title: { values: ['facilities', 'gerente de facilities', 'infraestrutura', 'manutenção predial'], include_related_job_titles: true } } },
  { nome: 'COO', filtros: { job_title: { values: ['COO', 'chief operating officer', 'diretor de operações'], include_related_job_titles: false } } },
  { nome: 'proprietário', filtros: { job_level: { values: ['owner', 'partner'] } } },
  { nome: 'presidente', filtros: { job_title: { values: ['presidente', 'president'], include_related_job_titles: false } } },
  { nome: 'CEO', filtros: { job_title: { values: ['CEO', 'chief executive officer', 'diretor geral'], include_related_job_titles: false } } },
  { nome: 'supply chain', filtros: { job_title: { values: ['supply chain'], include_related_job_titles: true } } },
  { nome: 'logística', filtros: { job_title: { values: ['logística', 'logistics'], include_related_job_titles: true } } },
  { nome: 'compras e suprimentos', filtros: { job_title: { values: ['compras', 'suprimentos', 'procurement', 'purchasing'], include_related_job_titles: true } } },
];

// ---------------------------------------------------------------------------
// Ambiente e chave (nunca exibida)
// ---------------------------------------------------------------------------
function carregarEnv() {
  for (const arquivo of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), arquivo);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
carregarEnv();
function chave() {
  const k = (process.env.VIBE_API_KEY ?? '').trim();
  if (!k) { console.error('VIBE_API_KEY ausente. Defina no ambiente ou em .env.local (ignorado pelo git).'); process.exit(2); }
  if (k.length < 16) { console.error('VIBE_API_KEY parece inválida (muito curta).'); process.exit(2); }
  return k;
}

let ultimaCorrelacao = null;
async function api(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: { accept: 'application/json', 'content-type': 'application/json', api_key: chave() }, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let json; try { json = JSON.parse(texto); } catch { json = { raw: texto.slice(0, 300) }; }
  ultimaCorrelacao = json?.response_context?.correlation_id ?? r.headers.get('x-correlation-id') ?? ultimaCorrelacao;
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> HTTP ${r.status}: ${mascararChaves(JSON.stringify(json).slice(0, 400))}`);
  return json;
}
const creditosAgora = async () => { const c = await api('GET', '/v2/credits'); return { disponiveis: Number(c.remaining_credits), alocados: Number(c.allocated_credits), conta: c.account_type }; };

function logar(reg) { fs.mkdirSync(PASTA, { recursive: true }); fs.appendFileSync(LOG, `${JSON.stringify(registroConsumo(reg))}\n`); }

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const primeira = t.split('\n').find((l) => l.trim()) ?? '';
  const sep = [';', '\t', ',', '|'].map((s) => ({ s, n: primeira.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; continue; }
    if (ch === '"') { aspas = true; continue; }
    if (ch === sep) { linha.push(campo); campo = ''; continue; }
    if (ch === '\n') { linha.push(campo); if (linha.some((c) => c.trim())) linhas.push(linha.map((c) => c.trim())); linha = []; campo = ''; continue; }
    campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); if (linha.some((c) => c.trim())) linhas.push(linha.map((c) => c.trim())); }
  const cab = (linhas.shift() ?? []).map((c) => c.trim());
  return linhas.map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i] ?? ''])));
}
const chaveCol = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '');
const col = (row, ...nomes) => { for (const k of Object.keys(row)) if (nomes.includes(chaveCol(k))) return row[k]; return ''; };
function escreverCsv(arquivo, linhas, colunas) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const esc = (v) => { const s = v === undefined || v === null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  fs.writeFileSync(arquivo, `﻿${colunas.join(';')}\n${linhas.map((l) => colunas.map((c) => esc(l[c])).join(';')).join('\n')}\n`, 'utf8');
}
const lerCsvSeExiste = (arquivo) => (fs.existsSync(arquivo) ? lerCsv(fs.readFileSync(arquivo, 'utf8')) : []);

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i >= 0 ? process.argv[i + 1] ?? padrao : padrao; };
const flag = (nome) => process.argv.includes(`--${nome}`);
const opcoesOrcamento = () => ({ budget: Number(arg('budget', BUDGET_PADRAO)), reserve: Number(arg('reserve', RESERVA_PADRAO)) });

/** Guarda de orcamento: consulta creditos e bloqueia antes de qualquer chamada paga. */
async function guardar(operacao, custoMaximo) {
  const { budget, reserve } = opcoesOrcamento();
  const c = await creditosAgora();
  const g = budgetGuard({ custoMaximo, disponiveis: c.disponiveis, budget, reserve });
  console.log(`Orçamento: ${g.motivo}.`);
  if (!g.ok) { logar({ operation: operacao, credits_before: c.disponiveis, credits_after: c.disponiveis, estimated_credits: custoMaximo, status: 'bloqueado_orcamento', detalhe: g.motivo }); console.error('Operação não iniciada: orçamento insuficiente. Nenhum lote parcial foi executado.'); process.exit(3); }
  return c;
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------
async function creditos() { const c = await creditosAgora(); console.log(`Créditos: ${c.disponiveis} disponíveis de ${c.alocados} (conta ${c.conta ?? '?'})`); return c; }

async function validarContrato() {
  console.log(`Base: ${BASE} · chave: presente (${chave().length} caracteres, não exibida)`);
  const antes = await creditosAgora();
  console.log(`Créditos antes: ${antes.disponiveis} de ${antes.alocados} (${antes.conta ?? '?'})`);
  const s = await api('POST', '/v2/prospects/stats', { filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] } } });
  console.log(`Stats (grátis): ${s.total_results ?? '?'} prospects de engenharia no Brasil · correlation_id ${s.response_context?.correlation_id ?? '—'}`);
  const p = await api('POST', '/v2/prospects', { mode: 'preview', page_size: 1, page: 1, filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] }, job_level: { values: ['director'] } } });
  const d = p.data?.[0];
  console.log(`Preview (1 registro, sem mode full): ${d ? JSON.stringify({ prospect_id: d.prospect_id, business_id: d.business_id, job_title: d.job_title, company_name: d.company_name, job_level_main: d.job_level_main, job_department_main: d.job_department_main }) : 'sem dados'} · correlation_id ${p.response_context?.correlation_id ?? '—'}`);
  const depois = await creditosAgora();
  console.log(`Créditos depois: ${depois.disponiveis} · delta: ${antes.disponiveis - depois.disponiveis}`);
  logar({ operation: 'validar-contrato', records_requested: 1, records_returned: p.data?.length ?? 0, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: 0, correlation_id: p.response_context?.correlation_id ?? null, status: 'ok' });
}

async function testarEmail() {
  const pid = String(arg('prospect-id', '')).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(pid)) throw new Error('Informe --prospect-id com 40 caracteres hexadecimais.');
  console.log(`Teste de e-mail para prospect ${pid.slice(0, 8)}…: poderá consumir ${CUSTO.email} créditos (e-mail apenas).`);
  if (!flag('executar')) { console.log('Nada executado. Repita com --executar para confirmar.'); return; }
  const antes = await guardar('testar-email', CUSTO.email);
  const r = await api('POST', '/v2/prospects/contact_information/enrich', payloadEnriquecimento([pid], ['email']));
  const n = normalizarEnriquecimento(r);
  const depois = await creditosAgora();
  console.log(`Resultado: ${n.length ? `${mascararEmail(n[0].professional_email)} (${n[0].professional_email_status ?? 'sem status'})` : 'sem retorno'} · correlation_id ${r.response_context?.correlation_id ?? '—'} · créditos ${antes.disponiveis} → ${depois.disponiveis} (delta ${antes.disponiveis - depois.disponiveis})`);
  logar({ operation: 'testar-email', records_requested: 1, records_returned: n.length, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: CUSTO.email, correlation_id: r.response_context?.correlation_id ?? null, status: 'ok' });
}

async function autocomplete(campo, texto) {
  const r = await api('GET', `/v2/autocomplete?field=${encodeURIComponent(campo)}&query=${encodeURIComponent(texto ?? '')}`);
  console.log(JSON.stringify(r, null, 2).slice(0, 3000));
}

async function match() {
  const entrada = arg('entrada'); if (!entrada) throw new Error('Informe --entrada <csv com nome/dominio>');
  const linhas = lerCsv(fs.readFileSync(entrada, 'utf8'));
  const itens = linhas.map((l) => ({ id: col(l, 'id', 'empresaid', 'idexterno', 'ideiff'), name: col(l, 'razaosocial', 'empresa', 'nome', 'name', 'companyname'), domain: col(l, 'dominio', 'domain', 'site', 'website').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] })).filter((x) => x.name || x.domain);
  console.log(`${itens.length} empresa(s) para casar · custo estimado: ${itens.length * CUSTO.match} crédito(s) (${CUSTO.match} por empresa; estimativa)`);
  if (!flag('executar')) { console.log('Rode com --executar para consumir os créditos.'); return; }
  const antes = await guardar('match', itens.length * CUSTO.match);
  const saida = [];
  for (let i = 0; i < itens.length; i += 50) {
    const lote = itens.slice(i, i + 50);
    const r = await api('POST', '/v2/businesses/match', { businesses_to_match: lote.map(({ name, domain }) => ({ name: name || undefined, domain: domain || undefined })) });
    (r.matched_businesses ?? []).forEach((m, j) => saida.push({ id_eiff: lote[j].id, nome: lote[j].name, dominio: lote[j].domain, business_id: m.business_id ?? '' }));
  }
  const depois = await creditosAgora();
  const arq = arg('saida', path.join(PASTA, 'empresas-match.csv'));
  escreverCsv(arq, saida, ['id_eiff', 'nome', 'dominio', 'business_id']);
  console.log(`Gravado ${arq} (${saida.filter((s) => s.business_id).length} com business_id) · créditos ${antes.disponiveis} → ${depois.disponiveis}`);
  logar({ operation: 'match', records_requested: itens.length, records_returned: saida.filter((s) => s.business_id).length, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: itens.length * CUSTO.match, correlation_id: ultimaCorrelacao, status: 'ok' });
}

const CATALOGO = path.join(PASTA, 'filtros-validados.json');
const lerCatalogo = () => (fs.existsSync(CATALOGO) ? JSON.parse(fs.readFileSync(CATALOGO, 'utf8')) : null);
const listaAutocomplete = (r) => { const l = r?.data ?? r?.results ?? r?.suggestions ?? (Array.isArray(r) ? r : []); return l.map((x) => String(x?.value ?? x?.label ?? x?.name ?? x).toLowerCase()); };

/** Valida pelo autocomplete (sem créditos) os valores de job_level, job_department e os títulos usados; grava o catálogo local. */
async function validarFiltros() {
  const antes = await creditosAgora();
  const valida = async (campo, lista) => {
    const ok = []; const nao = [];
    for (const v of lista) { const l = listaAutocomplete(await api('GET', `/v2/autocomplete?field=${encodeURIComponent(campo)}&query=${encodeURIComponent(v)}`)); if (l.includes(v.toLowerCase())) ok.push(v); else nao.push(`${v} (sugestões: ${l.slice(0, 5).join(', ') || 'nenhuma'})`); }
    return { ok, nao };
  };
  const jl = await valida('job_level', POOL_JOB_LEVEL);
  const jd = await valida('job_department', POOL_JOB_DEPARTMENT);
  const titulos = {};
  for (const p of PRIORIDADE) if (p.filtros.job_title) titulos[p.nome] = await valida('job_title', p.filtros.job_title.values);
  const depois = await creditosAgora();
  const catalogo = { job_level: jl.ok, job_department: jd.ok, job_title: Object.values(titulos).flatMap((t) => t.ok), validado_em: new Date().toISOString() };
  fs.mkdirSync(PASTA, { recursive: true }); fs.writeFileSync(CATALOGO, JSON.stringify(catalogo, null, 2));
  console.log(`job_level confirmados: ${jl.ok.join(', ') || 'nenhum'}`); if (jl.nao.length) console.log(`  não confirmados: ${jl.nao.join(' | ')}`);
  console.log(`job_department confirmados: ${jd.ok.join(', ') || 'nenhum'}`); if (jd.nao.length) console.log(`  não confirmados: ${jd.nao.join(' | ')}`);
  for (const [g, t] of Object.entries(titulos)) console.log(`título ${g}: ${t.ok.length}/${t.ok.length + t.nao.length} confirmado(s)${t.nao.length ? ' · não confirmados: ' + t.nao.join(' | ') : ''}`);
  console.log(`Catálogo gravado em ${CATALOGO} · créditos ${antes.disponiveis} → ${depois.disponiveis} (delta ${antes.disponiveis - depois.disponiveis}; esperado 0) · correlation_id ${ultimaCorrelacao ?? '—'}`);
  logar({ operation: 'validar-filtros', records_requested: POOL_JOB_LEVEL.length + POOL_JOB_DEPARTMENT.length, records_returned: jl.ok.length + jd.ok.length, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: 0, correlation_id: ultimaCorrelacao, status: 'ok' });
}

async function decisores() {
  const lista = arg('lista'); if (!lista) throw new Error('Informe --lista <csv com business_id>');
  const max = Number(arg('max', '56')); const amostra = Math.min(10, Number(arg('amostra', '5'))); const paginasMax = Number(arg('paginas', '5'));
  const somenteComEmail = flag('somente-com-email');
  const linhas = lerCsv(fs.readFileSync(lista, 'utf8'));
  const empresas = new Map();
  for (const l of linhas) { const bid = col(l, 'businessid', 'idexplorium').toLowerCase(); if (/^[a-f0-9]{32}$/.test(bid)) empresas.set(bid, { business_id: bid, nome: col(l, 'razaosocial', 'empresa', 'nome', 'name', 'companyname'), id_eiff: col(l, 'ideiff', 'empresaid', 'idexterno', 'id') }); }
  if (!empresas.size) throw new Error('A lista não tem a coluna business_id (32 caracteres hexadecimais).');
  const ids = [...empresas.keys()];
  const arqSaida = arg('saida', path.join(PASTA, 'decisores.csv'));
  const jaProcessados = lerCsvSeExiste(arqSaida).map((l) => l.prospect_id).filter(Boolean);
  const escolhidos = new Map(lerCsvSeExiste(arqSaida).filter((l) => /^[a-f0-9]{32}$/i.test(l.business_id ?? '')).map((l) => [l.business_id.toLowerCase(), l]));
  console.log(`${empresas.size} empresa(s) com business_id · alvo até ${max} decisores (1 por empresa) · ${somenteComEmail ? 'somente com e-mail disponível' : 'com ou sem e-mail'} · ${escolhidos.size} já no CSV de saída (idempotência).`);
  // cobertura (gratis)
  const cobertura = [];
  for (const p of PRIORIDADE) { const s = await api('POST', '/v2/prospects/stats', { filters: filtrosDecisores(p, ids, somenteComEmail) }); cobertura.push({ nome: p.nome, total: Number(s.total_results ?? 0) }); }
  console.log('Cobertura por prioridade (estatística, sem créditos):');
  for (const c of cobertura) console.log(`  ${c.nome.padEnd(24)} ${c.total}`);
  const coberturaTotal = cobertura.reduce((s, c) => s + c.total, 0);
  const i0 = cobertura.findIndex((c) => c.total > 0);
  if (i0 >= 0 && amostra > 0) {
    const pv = await api('POST', '/v2/prospects', { mode: 'preview', page_size: amostra, page: 1, filters: filtrosDecisores(PRIORIDADE[i0], ids, somenteComEmail) });
    console.log(`Amostra (${PRIORIDADE[i0].nome}, preview, ${pv.data?.length ?? 0} registros):`);
    for (const d of pv.data ?? []) console.log(`  ${JSON.stringify({ prospect_id: d.prospect_id, business_id: d.business_id, nome: d.full_name ?? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(), cargo: d.job_title, nivel: d.job_level_main, departamento: d.job_department_main, empresa: d.company_name })}`);
  }
  const faltamDecisores = Math.max(0, max - escolhidos.size);
  const e = estimar({ decisores: faltamDecisores, cobertura: coberturaTotal, email: true, telefone: false, perfil: false, paginasMax, reserva: opcoesOrcamento().reserve });
  console.log(`Estimativa (não é valor exato): descoberta provável ${e.busca} (máximo ${e.buscaMaxima} se paginar até ${paginasMax} páginas) · e-mail depois ${e.email} · telefone 0 · perfil 0 (não chamado) · reserva ${e.reserva} · total provável ${e.total}.`);
  if (!flag('executar')) { console.log('Nada foi buscado em modo full. Repita com --executar para a descoberta (o e-mail é um passo separado: "enriquecer").'); return; }
  if (!faltamDecisores) { console.log('Nada a buscar: o CSV de saída já tem o máximo pedido.'); return; }
  const catalogo = lerCatalogo();
  const pool = filtrosPool(ids, catalogo, somenteComEmail);
  if (pool.erro) throw new Error(`Catálogo de filtros não validado (${pool.rejeitados.join(', ') || 'catálogo ausente'}). Rode "node scripts/vibe.mjs validar-filtros" antes de qualquer chamada paga.`);
  const cap = Number(arg('cap', String(Math.min(e.buscaMaxima, max * 2)))); // teto global de registros pagos
  const orcamentoBusca = Math.min(e.buscaMaxima, cap * CUSTO.buscaFull);
  const antes = await guardar('decisores', orcamentoBusca);
  let devolvidos = 0; const correlacoes = [];
  // 1) DISCOVERY_POOL: uma busca ampla (job_level + job_department validados), classificada localmente; teto global de registros pagos
  const r0 = await paginar((pg) => api('POST', '/v2/prospects', { mode: 'full', ...pg, filters: pool.filtros }).then((res) => ({ ...res, data: filtrarJaProcessados(res.data ?? [], jaProcessados) })), { businessIds: ids, escolhidos, max, maxPaginas: paginasMax, extra: { prioridade: 'DISCOVERY_POOL' }, cap, orcamento: orcamentoBusca });
  devolvidos += r0.devolvidos; correlacoes.push(...r0.correlacoes);
  console.log(`  DISCOVERY_POOL: ${r0.devolvidos} devolvidos em ${r0.paginas} página(s) · ${escolhidos.size} escolhidos · parada: ${r0.motivo}`);
  // 2) tiers específicos apenas como fallback para empresas sem candidato, dentro do mesmo teto global
  for (const [i, p] of PRIORIDADE.entries()) {
    if (escolhidos.size >= max || !cobertura[i].total || devolvidos >= cap) continue;
    const faltam = ids.filter((b) => !escolhidos.has(b));
    if (!faltam.length) break;
    const v = filtrosValidados({ job_level: p.filtros.job_level?.values, job_department: p.filtros.job_department?.values, job_title: p.filtros.job_title?.values }, catalogo);
    if (v.rejeitados.length) { console.log(`  ${p.nome}: pulado (valores não confirmados no catálogo: ${v.rejeitados.join(', ')})`); continue; }
    const r = await paginar((pg) => api('POST', '/v2/prospects', { mode: 'full', ...pg, filters: filtrosDecisores(p, faltam, somenteComEmail) }).then((res) => ({ ...res, data: filtrarJaProcessados(res.data ?? [], jaProcessados) })), { businessIds: faltam, escolhidos, max, maxPaginas: paginasMax, extra: { prioridade: p.nome }, cap: cap - devolvidos, orcamento: orcamentoBusca - devolvidos * CUSTO.buscaFull });
    devolvidos += r.devolvidos; correlacoes.push(...r.correlacoes);
    console.log(`  ${p.nome}: ${r.devolvidos} devolvidos em ${r.paginas} página(s) · ${escolhidos.size} escolhidos · parada: ${r.motivo}`);
  }
  const depois = await creditosAgora();
  const saida = [...escolhidos.values()].map((d) => ({ business_id: d.business_id, prospect_id: d.prospect_id, id_eiff: d.id_eiff ?? empresas.get(d.business_id)?.id_eiff ?? '', empresa: d.empresa ?? d.company_name ?? empresas.get(d.business_id)?.nome ?? '', nome: d.nome ?? d.full_name ?? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(), cargo: d.cargo ?? d.job_title ?? '', departamento: d.departamento ?? d.job_department_main ?? '', senioridade: d.senioridade ?? d.job_level_main ?? '', linkedin: d.linkedin ?? d.linkedin_url_array?.[0] ?? '', cidade: d.cidade ?? d.city ?? '', uf: d.uf ?? d.region_name ?? '', prioridade: d.prioridade ?? '', email: d.email ?? '', status_email: d.status_email ?? '', fonte: 'VIBE' }));
  escreverCsv(arqSaida, saida, ['business_id', 'prospect_id', 'id_eiff', 'empresa', 'nome', 'cargo', 'departamento', 'senioridade', 'linkedin', 'cidade', 'uf', 'prioridade', 'email', 'status_email', 'fonte']);
  console.log(`Gravado ${arqSaida}: ${saida.length} decisor(es) · créditos ${antes.disponiveis} → ${depois.disponiveis} (delta ${antes.disponiveis - depois.disponiveis}; estimado ${e.busca}) · correlation_ids ${correlacoes.slice(-3).join(', ') || '—'}`);
  logar({ operation: 'decisores', records_requested: max, records_returned: devolvidos, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: e.busca, correlation_id: correlacoes.at(-1) ?? null, status: 'ok', detalhe: `${saida.length} escolhidos${somenteComEmail ? ', somente com e-mail' : ''}` });
}

async function enriquecer() {
  const entrada = arg('entrada', path.join(PASTA, 'decisores.csv'));
  const linhas = lerCsv(fs.readFileSync(entrada, 'utf8'));
  const force = arg('force', '') === 'sim';
  if (flag('force') && !force) throw new Error('--force exige confirmação explícita: use --force sim --justificativa "motivo".');
  if (force && !arg('justificativa', '')) throw new Error('--force sim exige --justificativa "motivo" (fica no log de consumo).');
  const cacheDias = Number(arg('cache-dias', '90'));
  const alvo = linhasParaEnriquecer(linhas, { force, cacheDias });
  const telefone = flag('telefone');
  const custo = alvo.length * (telefone ? CUSTO.telefone : CUSTO.email);
  console.log(`${alvo.length} contato(s) a enriquecer (${linhas.length - alvo.length} já com e-mail válido dentro do cache de ${cacheDias} dias, não pagos de novo${force ? '; --force sim: ' + arg('justificativa', '') : ''}) · ${telefone ? 'e-mail + telefone' : 'e-mail apenas'} · custo estimado ${custo} créditos.`);
  if (!alvo.length) return;
  if (!flag('executar')) { console.log('Nada executado. Repita com --executar.'); return; }
  const antes = await guardar('enriquecer', custo);
  const porId = new Map(linhas.map((l) => [String(l.prospect_id).toLowerCase(), l]));
  let retornados = 0; let correlacao = null;
  for (let i = 0; i < alvo.length; i += LOTE_ENRIQUECIMENTO_MAX) {
    const lote = alvo.slice(i, i + LOTE_ENRIQUECIMENTO_MAX).map((l) => l.prospect_id);
    const r = await api('POST', '/v2/prospects/contact_information/enrich', payloadEnriquecimento(lote, telefone ? ['email', 'phone'] : ['email']));
    correlacao = r.response_context?.correlation_id ?? correlacao;
    for (const d of normalizarEnriquecimento(r)) { const l = porId.get(d.prospect_id); if (!l) continue; retornados++; if (d.professional_email) { l.email = d.professional_email; l.status_email = d.professional_email_status ?? ''; l.verificado_em = new Date().toISOString().slice(0, 10); } if (telefone && d.mobile_phone) l.celular = d.mobile_phone; }
  }
  const depois = await creditosAgora();
  const arq = arg('saida', entrada.replace(/\.csv$/i, '') + '-enriquecido.csv');
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)).concat(['email', 'status_email', 'verificado_em', ...(telefone ? ['celular'] : [])]))];
  escreverCsv(arq, linhas, colunas);
  console.log(`Gravado ${arq}: ${linhas.filter((l) => l.email).length} com e-mail · créditos ${antes.disponiveis} → ${depois.disponiveis} (delta ${antes.disponiveis - depois.disponiveis}; estimado ${custo}) · correlation_id ${correlacao ?? '—'}`);
  logar({ operation: 'enriquecer', records_requested: alvo.length, records_returned: retornados, credits_before: antes.disponiveis, credits_after: depois.disponiveis, estimated_credits: custo, correlation_id: correlacao, status: 'ok', detalhe: (telefone ? 'email+phone' : 'email') + (force ? '; force: ' + arg('justificativa', '') : '') });
}

const cmd = process.argv[2];
const run = { creditos, 'validar-contrato': validarContrato, 'validar-filtros': validarFiltros, teste: validarContrato, 'testar-email': testarEmail, autocomplete: () => autocomplete(process.argv[3], process.argv[4]), match, decisores, enriquecer }[cmd];
if (!run) { console.log('Comandos: creditos | validar-contrato | validar-filtros | testar-email --prospect-id <id> [--executar] | autocomplete <campo> <texto> | match --entrada <csv> [--executar] | decisores --lista <csv> [--max 56] [--amostra 5] [--somente-com-email] [--budget 180] [--reserve 20] [--cap N] [--executar] | enriquecer [--entrada <csv>] [--telefone] [--cache-dias 90] [--force sim --justificativa "motivo"] [--executar]'); process.exit(1); }
run().catch((e) => { console.error(`Erro: ${mascararChaves(e.message)}`); process.exit(1); });
