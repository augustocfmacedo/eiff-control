#!/usr/bin/env node
// Cliente server-side da Data API do Vibe Prospecting (Explorium AgentSource API, https://api.explorium.ai).
// A chave vem SOMENTE da variavel de ambiente VIBE_API_KEY (ou de .env.local / .env, que nao sao versionados).
// Nunca imprime a chave, nunca a grava em arquivo, nunca roda no navegador.
//
// Uso:
//   node scripts/vibe.mjs teste                                   # creditos + estatistica gratuita + 1 registro em preview
//   node scripts/vibe.mjs creditos                                # saldo de creditos
//   node scripts/vibe.mjs autocomplete <campo> <texto>            # valores validos (job_department, job_level, ...)
//   node scripts/vibe.mjs match --entrada dados/vibe/empresas.csv # resolve business_id por nome/dominio (1 credito por empresa)
//   node scripts/vibe.mjs decisores --lista <csv> [--max 56] [--amostra 5] [--executar] [--saida dados/vibe/decisores.csv]
//       csv da lista exportada do Vibe (precisa da coluna business_id; prospect_id opcional). Sem --executar so mostra
//       a amostra (modo preview, sem consumo relevante) e a estimativa de creditos.
//   node scripts/vibe.mjs enriquecer --entrada dados/vibe/decisores.csv [--telefone] [--executar]
//       enriquece e-mail profissional (2 creditos/registro; telefone 5) preservando business_id e prospect_id.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VIBE_API_BASE || 'https://api.explorium.ai';
const PASTA_SAIDA = path.join(process.cwd(), 'dados', 'vibe');

// ---------------------------------------------------------------------------
// Chave: variavel de ambiente > .env.local > .env (arquivos ignorados pelo git). Nunca logada.
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
  if (!k) {
    console.error('VIBE_API_KEY ausente. Crie o arquivo .env.local (ignorado pelo git) com a linha VIBE_API_KEY=<sua chave do painel Data API do Vibe Prospecting> e rode de novo.');
    process.exit(2);
  }
  if (k.length < 16) { console.error('VIBE_API_KEY parece inválida (muito curta).'); process.exit(2); }
  return k;
}

const mascarar = (s) => (typeof s === 'string' ? s.replace(/[A-Za-z0-9_-]{24,}/g, (m) => `${m.slice(0, 4)}…(${m.length} caracteres)`) : s);

async function api(metodo, caminho, corpo) {
  const k = chave();
  const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: { accept: 'application/json', 'content-type': 'application/json', api_key: k }, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let json; try { json = JSON.parse(texto); } catch { json = { raw: texto.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> HTTP ${r.status}: ${mascarar(JSON.stringify(json).slice(0, 400))}`);
  return json;
}

// ---------------------------------------------------------------------------
// CSV utilitario (mesma logica de src/core/radar/csv.ts, sem dependencia do app)
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

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i >= 0 ? process.argv[i + 1] ?? padrao : padrao; };
const flag = (nome) => process.argv.includes(`--${nome}`);

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------
async function creditos() {
  const c = await api('GET', '/v2/credits');
  console.log(`Créditos: ${c.remaining_credits} disponíveis de ${c.allocated_credits} (conta ${c.account_type ?? '?'})`);
  return c;
}

async function teste() {
  console.log(`Base: ${BASE} · chave: presente (${chave().length} caracteres, não exibida)`);
  const c = await creditos();
  // estatistica gratuita: quantos prospects de engenharia no Brasil
  const s = await api('POST', '/v2/prospects/stats', { filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] } } });
  console.log(`Estatística (grátis): ${s.total_results ?? '?'} prospects de engenharia em empresas do Brasil`);
  // 1 registro em modo preview (campos limitados, sem consumo relevante)
  const p = await api('POST', '/v2/prospects', { mode: 'preview', page_size: 1, page: 1, filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] }, job_level: { values: ['director'] } } });
  const d = p.data?.[0];
  console.log(`Preview (1 registro): ${d ? JSON.stringify({ prospect_id: d.prospect_id, business_id: d.business_id, job_title: d.job_title, company_name: d.company_name, job_level_main: d.job_level_main, job_department_main: d.job_department_main }) : 'sem dados'}`);
  const c2 = await api('GET', '/v2/credits');
  console.log(`Créditos após o teste: ${c2.remaining_credits} (consumo do teste: ${c.remaining_credits - c2.remaining_credits})`);
}

async function autocomplete(campo, texto) {
  const r = await api('GET', `/v2/autocomplete?field=${encodeURIComponent(campo)}&query=${encodeURIComponent(texto ?? '')}`);
  console.log(JSON.stringify(r, null, 2).slice(0, 3000));
}

async function match() {
  const entrada = arg('entrada'); if (!entrada) throw new Error('Informe --entrada <csv com nome/dominio>');
  const linhas = lerCsv(fs.readFileSync(entrada, 'utf8'));
  const itens = linhas.map((l) => ({ id: col(l, 'id', 'empresaid', 'idexterno'), name: col(l, 'razaosocial', 'empresa', 'nome', 'name', 'companyname'), domain: col(l, 'dominio', 'domain', 'site', 'website').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] })).filter((x) => x.name || x.domain);
  console.log(`${itens.length} empresa(s) para casar · custo estimado: ${itens.length} crédito(s) (1 por empresa)`);
  if (!flag('executar')) { console.log('Rode com --executar para consumir os créditos.'); return; }
  const saida = [];
  for (let i = 0; i < itens.length; i += 50) {
    const lote = itens.slice(i, i + 50);
    const r = await api('POST', '/v2/businesses/match', { businesses_to_match: lote.map(({ name, domain }) => ({ name: name || undefined, domain: domain || undefined })) });
    (r.matched_businesses ?? []).forEach((m, j) => saida.push({ id_eiff: lote[j].id, nome: lote[j].name, dominio: lote[j].domain, business_id: m.business_id ?? '', match_input: JSON.stringify(m.input ?? {}) }));
    console.log(`lote ${i / 50 + 1}: ${r.total_matches ?? '?'} casadas`);
  }
  const arq = arg('saida', path.join(PASTA_SAIDA, 'empresas-match.csv'));
  escreverCsv(arq, saida, ['id_eiff', 'nome', 'dominio', 'business_id', 'match_input']);
  console.log(`Gravado ${arq} (${saida.filter((s) => s.business_id).length} com business_id)`);
}

// Prioridade de decisores para estrutura metalica (do mais ao menos relevante). Cada nivel e um filtro da API.
const PRIORIDADE = [
  { nome: 'engenharia', filtros: { job_department: { values: ['engineering'] }, job_level: { values: ['cxo', 'vp', 'director', 'manager'] } } },
  { nome: 'direção industrial', filtros: { job_title: { values: ['diretor industrial', 'industrial director', 'plant director', 'diretor de produção', 'diretor fabril'], include_related_job_titles: true } } },
  { nome: 'expansão', filtros: { job_title: { values: ['diretor de expansão', 'expansion director', 'gerente de expansão', 'head of expansion', 'novos negócios'], include_related_job_titles: true } } },
  { nome: 'operações', filtros: { job_department: { values: ['operations'] }, job_level: { values: ['cxo', 'vp', 'director', 'manager'] } } },
  { nome: 'facilities', filtros: { job_title: { values: ['facilities', 'gerente de facilities', 'infraestrutura', 'manutenção predial'], include_related_job_titles: true } } },
  { nome: 'COO', filtros: { job_title: { values: ['COO', 'chief operating officer', 'diretor de operações'], include_related_job_titles: false } } },
  { nome: 'proprietário', filtros: { job_level: { values: ['owner', 'partner'] } } },
  { nome: 'presidente', filtros: { job_title: { values: ['presidente', 'president'], include_related_job_titles: false } } },
  { nome: 'CEO', filtros: { job_title: { values: ['CEO', 'chief executive officer', 'diretor geral'], include_related_job_titles: false } } },
  { nome: 'supply chain', filtros: { job_title: { values: ['supply chain'], include_related_job_titles: true } } },
  { nome: 'logística', filtros: { job_title: { values: ['logística', 'logistics'], include_related_job_titles: true } } },
  { nome: 'compras e suprimentos', filtros: { job_title: { values: ['compras', 'suprimentos', 'procurement', 'purchasing'], include_related_job_titles: true } } },
];

async function decisores() {
  const lista = arg('lista'); if (!lista) throw new Error('Informe --lista <csv exportado do Vibe com business_id>');
  const max = Number(arg('max', '56')); const amostra = Number(arg('amostra', '5'));
  const linhas = lerCsv(fs.readFileSync(lista, 'utf8'));
  const empresas = new Map();
  for (const l of linhas) { const bid = col(l, 'businessid', 'business_id'.replace('_', ''), 'idexplorium'); if (/^[a-f0-9]{32}$/i.test(bid)) empresas.set(bid.toLowerCase(), { business_id: bid.toLowerCase(), nome: col(l, 'razaosocial', 'empresa', 'nome', 'name', 'companyname'), id_eiff: col(l, 'ideiff', 'empresaid', 'idexterno', 'id'), prospect_id: col(l, 'prospectid') }); }
  if (!empresas.size) throw new Error('A lista não tem a coluna business_id (32 caracteres hexadecimais). Exporte a lista do Vibe com os identificadores.');
  const ids = [...empresas.keys()];
  console.log(`${empresas.size} empresa(s) com business_id na lista "${path.basename(lista)}"; alvo: até ${max} decisores, 1 por empresa, na ordem de prioridade.`);
  // 1) estatisticas gratuitas por nivel de prioridade
  const cobertura = [];
  for (const p of PRIORIDADE) {
    const s = await api('POST', '/v2/prospects/stats', { filters: { business_id: { values: ids }, ...p.filtros } });
    cobertura.push({ nome: p.nome, total: Number(s.total_results ?? 0) });
  }
  console.log('Cobertura por prioridade (estatística, sem créditos):');
  for (const c of cobertura) console.log(`  ${c.nome.padEnd(24)} ${c.total}`);
  // 2) amostra em preview (campos limitados, sem consumo relevante)
  const primeiraComDados = PRIORIDADE.find((p, i) => cobertura[i].total > 0);
  if (primeiraComDados) {
    const pv = await api('POST', '/v2/prospects', { mode: 'preview', page_size: amostra, page: 1, filters: { business_id: { values: ids }, ...primeiraComDados.filtros } });
    console.log(`Amostra (${primeiraComDados.nome}, preview):`);
    for (const d of pv.data ?? []) console.log(`  ${JSON.stringify({ prospect_id: d.prospect_id, business_id: d.business_id, nome: d.full_name ?? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(), cargo: d.job_title, nivel: d.job_level_main, departamento: d.job_department_main, empresa: d.company_name })}`);
  }
  // 3) estimativa: buscar em modo full ~1 credito/registro (buscamos ate 2x o necessario para escolher 1 por empresa),
  //    e-mail 2 creditos/registro selecionado, perfil ~1 credito/registro
  const buscar = Math.min(max * 2, cobertura.reduce((s, c) => s + c.total, 0));
  console.log(`Estimativa: busca ${buscar} registro(s) ≈ ${buscar} crédito(s); e-mail profissional de até ${max} ≈ ${max * 2}; perfil ≈ ${max}. Total ≈ ${buscar + max * 3} créditos (telefone não incluído).`);
  if (!flag('executar')) { console.log('Rode com --executar para buscar os decisores (sem enriquecer). Depois use "enriquecer" para os e-mails.'); return; }
  // 4) execucao: percorre prioridades, 1 decisor por empresa, ate max
  const escolhidos = new Map();
  for (const [i, p] of PRIORIDADE.entries()) {
    if (escolhidos.size >= max || !cobertura[i].total) continue;
    const faltam = ids.filter((b) => !escolhidos.has(b));
    if (!faltam.length) break;
    const r = await api('POST', '/v2/prospects', { mode: 'full', page_size: Math.min(500, Math.max(10, (max - escolhidos.size) * 2)), page: 1, filters: { business_id: { values: faltam }, ...p.filtros } });
    for (const d of r.data ?? []) {
      const bid = (d.business_id ?? '').toLowerCase();
      if (!bid || escolhidos.has(bid) || !empresas.has(bid) || escolhidos.size >= max) continue;
      escolhidos.set(bid, { business_id: bid, prospect_id: d.prospect_id, id_eiff: empresas.get(bid).id_eiff, empresa: d.company_name ?? empresas.get(bid).nome, nome: d.full_name ?? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(), cargo: d.job_title ?? '', departamento: d.job_department_main ?? '', senioridade: d.job_level_main ?? '', linkedin: d.linkedin ?? d.linkedin_url_array?.[0] ?? '', cidade: d.city ?? '', uf: d.region_name ?? '', prioridade: p.nome, email: '', status_email: '', fonte: 'VIBE' });
    }
    console.log(`  ${p.nome}: ${escolhidos.size} decisor(es) acumulados`);
  }
  const arq = arg('saida', path.join(PASTA_SAIDA, 'decisores.csv'));
  escreverCsv(arq, [...escolhidos.values()], ['business_id', 'prospect_id', 'id_eiff', 'empresa', 'nome', 'cargo', 'departamento', 'senioridade', 'linkedin', 'cidade', 'uf', 'prioridade', 'email', 'status_email', 'fonte']);
  console.log(`Gravado ${arq}: ${escolhidos.size} decisor(es) de ${empresas.size} empresas. Empresas sem decisor encontrado: ${empresas.size - escolhidos.size}.`);
  await creditos();
}

async function enriquecer() {
  const entrada = arg('entrada', path.join(PASTA_SAIDA, 'decisores.csv'));
  const linhas = lerCsv(fs.readFileSync(entrada, 'utf8'));
  const alvo = linhas.filter((l) => /^[a-f0-9]{40}$/i.test(col(l, 'prospectid')) && !col(l, 'email'));
  const tipos = flag('telefone') ? ['email', 'phone'] : ['email'];
  const custo = alvo.length * (flag('telefone') ? 5 : 2);
  console.log(`${alvo.length} contato(s) sem e-mail · enriquecimento ${tipos.join('+')} ≈ ${custo} créditos`);
  if (!flag('executar')) { console.log('Rode com --executar para consumir os créditos.'); return; }
  const porId = new Map(linhas.map((l) => [col(l, 'prospectid').toLowerCase(), l]));
  for (let i = 0; i < alvo.length; i += 50) {
    const lote = alvo.slice(i, i + 50).map((l) => col(l, 'prospectid').toLowerCase());
    const r = await api('POST', '/v2/prospects/contact_information/enrich', { prospect_ids: lote, parameters: { contact_types: tipos } });
    for (const d of r.data ?? []) {
      const l = porId.get((d.prospect_id ?? '').toLowerCase()); if (!l) continue;
      l.email = d.professional_email ?? d.data?.professional_email ?? ''; l.status_email = d.professional_email_status ?? d.data?.professional_email_status ?? '';
      if (flag('telefone')) l.celular = d.mobile_phone ?? d.data?.mobile_phone ?? '';
    }
    console.log(`lote ${i / 50 + 1}: ${r.data?.length ?? 0} retornados`);
  }
  const arq = arg('saida', entrada.replace(/\.csv$/i, '') + '-enriquecido.csv');
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)).concat(['email', 'status_email', ...(flag('telefone') ? ['celular'] : [])]))];
  escreverCsv(arq, linhas, colunas);
  console.log(`Gravado ${arq}: ${linhas.filter((l) => l.email).length} com e-mail. Importe no EIFF Radar (Contatos) — as colunas business_id/prospect_id e id_eiff preservam a associação.`);
  await creditos();
}

const cmd = process.argv[2];
const run = { teste, creditos, autocomplete: () => autocomplete(process.argv[3], process.argv[4]), match, decisores, enriquecer }[cmd];
if (!run) { console.log('Comandos: teste | creditos | autocomplete <campo> <texto> | match --entrada <csv> [--executar] | decisores --lista <csv> [--max 56] [--amostra 5] [--executar] | enriquecer --entrada <csv> [--telefone] [--executar]'); process.exit(1); }
run().catch((e) => { console.error(`Erro: ${mascarar(e.message)}`); process.exit(1); });
