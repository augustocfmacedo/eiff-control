// Validacao estrutural dos CSVs exportados do Vibe (Full Dataset) antes do dry run. So le arquivos; nada e gravado.
// Uso: npx vite-node scripts/radar-validar-csv.mts -- --empresas <csv> --contatos <csv>
import fs from 'node:fs';
import { lerCsv } from '../src/core/radar/csv';

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ler = (p: string) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const BID = /^[a-f0-9]{32}$/i; const PID = /^[a-f0-9]{40}$/i;
const tabela = (texto: string) => { const { cabecalho, linhas, separador } = lerCsv(texto); const col = (l: string[], nome: string) => { const j = cabecalho.indexOf(nome); return j >= 0 ? (l[j] ?? '').trim() : ''; }; return { cabecalho, linhas, separador, col }; };
const contar = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const dup = (xs: string[]) => [...contar(xs.filter(Boolean)).entries()].filter(([, n]) => n > 1);
const preenchidos = (t: ReturnType<typeof tabela>) => t.cabecalho.map((c) => `${c}${t.linhas.filter((l) => t.col(l, c)).length === t.linhas.length ? '' : ` (${t.linhas.filter((l) => t.col(l, c)).length}/${t.linhas.length})`}`).join(', ');

const E = tabela(ler(arg('empresas')!));
const bids = E.linhas.map((l) => E.col(l, 'business_id').toLowerCase());
console.log(`== empresas.csv (separador "${E.separador}")`);
console.log(`linhas de dados: ${E.linhas.length}`);
console.log(`business_id presente: ${bids.filter(Boolean).length} · válidos (32 hex): ${bids.filter((b) => BID.test(b)).length} · únicos: ${new Set(bids.filter(Boolean)).size}`);
console.log(`duplicatas de business_id: ${dup(bids).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhuma'}`);
const nomes = E.linhas.map((l) => E.col(l, 'business_name').toLowerCase()); const doms = E.linhas.map((l) => E.col(l, 'business_domain').toLowerCase());
console.log(`duplicatas de nome: ${dup(nomes).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhuma'} · duplicatas de domínio: ${dup(doms).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhuma'}`);
console.log(`campos disponíveis (preenchimento quando parcial): ${preenchidos(E)}`);
console.log(`linhas com colunas a mais/menos que o cabeçalho: ${E.linhas.filter((l) => l.length !== E.cabecalho.length).length}`);

const C = tabela(ler(arg('contatos')!));
const pids = C.linhas.map((l) => C.col(l, 'prospect_id').toLowerCase()); const cb = C.linhas.map((l) => C.col(l, 'business_id').toLowerCase());
const emails = C.linhas.map((l) => C.col(l, 'contact_professional_email')); const status = C.linhas.map((l) => C.col(l, 'contact_professional_email_status').toLowerCase() || '(vazio)');
console.log(`\n== decisores.csv (separador "${C.separador}")`);
console.log(`linhas de dados: ${C.linhas.length}`);
console.log(`prospect_id presente: ${pids.filter(Boolean).length} · válidos (40 hex): ${pids.filter((p) => PID.test(p)).length} · únicos: ${new Set(pids.filter(Boolean)).size}`);
console.log(`business_id presente: ${cb.filter(Boolean).length} · válidos: ${cb.filter((b) => BID.test(b)).length} · empresas únicas: ${new Set(cb.filter(Boolean)).size}`);
console.log(`e-mails presentes: ${emails.filter(Boolean).length} · status: ${[...contar(status).entries()].map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`duplicatas de prospect_id: ${dup(pids).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhuma'} · nomes repetidos: ${dup(C.linhas.map((l) => C.col(l, 'prospect_full_name').toLowerCase())).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhum'} · e-mails repetidos: ${dup(emails.map((e) => e.toLowerCase())).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nenhum'}`);
console.log(`campos disponíveis (preenchimento quando parcial): ${preenchidos(C)}`);
console.log(`linhas com colunas a mais/menos que o cabeçalho: ${C.linhas.filter((l) => l.length !== C.cabecalho.length).length}`);
const setE = new Set(bids.filter(Boolean));
const relacionados = cb.filter((b) => setE.has(b));
console.log(`\n== cruzamento: business_id dos decisores presentes nas 91 empresas: ${relacionados.length} de ${cb.filter(Boolean).length} (${new Set(relacionados).size} empresa(s) distinta(s)); ausentes: ${cb.filter((b) => b && !setE.has(b)).join(', ') || 'nenhum'}`);
console.log('\nNada foi gravado. Nenhuma chamada à Explorium.');
