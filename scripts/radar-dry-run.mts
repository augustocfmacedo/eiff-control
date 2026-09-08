// Dry run da importacao de decisores (contatos) do EIFF Radar, sem gravar nada e sem chamar a Explorium.
// Uso: npx vite-node scripts/radar-dry-run.mts -- --contatos dados/vibe/decisores.csv [--empresas dados/vibe/empresas.csv] [--total 91] [--detalhes]
// --empresas: lista de empresas (ex.: exportacao do Vibe com business_id) carregada num Radar vazio para a associacao.
// Sem --empresas, a associacao e feita contra um Radar vazio (tudo cai em "nao encontrada").
import fs from 'node:fs';
import { PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO } from '../src/core/radar/padroes';
import { normalizarEmpresasCsv } from '../src/core/radar/csv';
import { upsertEmpresa, type Ids } from '../src/core/radar/ingestao';
import { dryRunContatosCsv, relatorioDryRun } from '../src/core/radar/dryrun';
import { radarVazio, type RadarDataset } from '../src/core/radar/types';

const args = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const contatosArq = arg('contatos'); if (!contatosArq) { console.error('Informe --contatos <csv>.'); process.exit(2); }
const hoje = new Date().toISOString().slice(0, 10);
let seq = 0;
const ids: Ids = { novo: (p) => `${p}-${String(++seq).padStart(5, '0')}`, hoje, agora: new Date().toISOString(), usuarioId: 'cli' };
let r: RadarDataset = { ...radarVazio(), regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
const ler = (p: string) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
if (arg('empresas')) {
  const { empresas, colunas } = normalizarEmpresasCsv(ler(arg('empresas')));
  let importadas = 0; let comBid = 0; let dups = 0;
  for (const e of empresas) { if (!e.razaoSocial) continue; const up = upsertEmpresa(r, { businessId: e.businessId, cnpj: e.cnpj, razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia, dominio: e.dominio, site: e.site, linkedin: e.linkedin, setor: e.setor, cidade: e.cidade, uf: e.uf, pais: e.pais, faixaFuncionarios: e.faixaFuncionarios, faixaReceita: e.faixaReceita, capitalSocial: e.capitalSocial, externoId: e.fonteExternaId }, 'CSV', ids); r = up.radar; if (up.resultado === 'importada') importadas++; if (up.resultado === 'duplicata_possivel') dups++; if (e.businessId) comBid++; }
  console.log(`Empresas: ${empresas.length} linha(s) → ${importadas} carregadas no Radar simulado (${comBid} com business_id, ${dups} possível(is) duplicata(s)) · colunas: ${colunas.filter(Boolean).join(', ')}`);
}
const d = dryRunContatosCsv(ler(contatosArq), r, hoje, arg('total') ? Number(arg('total')) : undefined);
console.log(`\nDRY RUN — ${contatosArq}`);
console.log(`colunas reconhecidas: ${d.colunas.map((c) => `${c.coluna}${c.campo ? ` → ${c.campo}` : ' (ignorada)'}`).join(' | ')}\n`);
for (const l of relatorioDryRun(d)) console.log(`- ${l}`);
if (flag('detalhes')) { console.log(''); for (const x of d.detalhes) console.log(`${String(x.numero).padStart(3)} ${x.status.padEnd(17)} ${x.nome.padEnd(28)} ${x.empresa.padEnd(30)} ${x.associacao.padEnd(34)} ${x.persona ?? '—'} · ${x.senioridade ?? '—'} · fit ${x.decisionFit ?? '—'} · qual ${x.qualidade ?? '—'} · e-mail ${x.emailValido ? 'ok' : '—'}${x.mensagem ? ` · ${x.mensagem}` : ''}`); }
if (flag('detalhes')) {
  console.log('\nContato principal sugerido por empresa (decision fit):');
  for (const p of d.principaisSugeridos) console.log(`  ${String(p.fit).padStart(3)}  ${p.empresa.padEnd(40)} ${p.contato.padEnd(28)} ${(p.cargo ?? '—').padEnd(36)} ${p.persona ?? '—'} · ${p.motivo} · e-mail ${p.emailValido ? 'ok' : '—'}`);
  console.log(`\nEmpresas ainda sem decisor (${d.empresasSemDecisor.length}):`);
  console.log('  ' + d.empresasSemDecisor.map((e) => e.nome).join(' · '));
}
console.log('\nNada foi gravado. Nenhuma chamada à Explorium.');
