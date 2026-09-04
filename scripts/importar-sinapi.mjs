// Importa a planilha de referencia do SINAPI (Caixa, formato unificado 2025+ ou antigo por UF) para o catalogo
// do EIFF Control, gerando uma migration SQL idempotente (insumos com preco da UF, composicoes escolhidas e seus itens).
// Usa o mesmo leitor da tela "Importar SINAPI" (src/core/sinapi.ts), compilado na hora com o esbuild do Vite.
//
// Uso: node scripts/importar-sinapi.mjs --arquivo "<pasta ou .xlsx>" --uf GO --saida 0019_sinapi_go_202607
//      [--grupos "regex de grupos"] [--composicoes 96528,92915,...] [--desonerado] [--todos-insumos]
// Sem --grupos/--composicoes importa apenas os insumos. Composicoes auxiliares e insumos das escolhidas entram sempre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { build } from 'esbuild';

XLSX.set_fs(fs);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);

export async function carregarLeitor() {
  const out = path.join(os.tmpdir(), `eiff-sinapi-${Date.now()}.mjs`);
  await build({ entryPoints: [path.join(root, 'src', 'core', 'sinapi.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  const mod = await import(pathToFileURL(out).href);
  fs.rmSync(out, { force: true });
  return mod;
}

export function lerPlanilhas(caminho) {
  const arquivos = fs.statSync(caminho).isDirectory() ? fs.readdirSync(caminho).filter((f) => /\.xlsx?$/i.test(f)).map((f) => path.join(caminho, f)) : [caminho];
  const planilhas = [];
  for (const f of arquivos) {
    if (!/refer|insumo|composi|analit/i.test(path.basename(f)) && arquivos.length > 1) continue; // ignora relatorios auxiliares (manutencoes, familias, mao de obra)
    const wb = XLSX.readFile(f, { cellDates: false });
    for (const aba of wb.SheetNames) planilhas.push({ arquivo: path.basename(f), aba, linhas: XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) });
  }
  return planilhas;
}

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const ORG = "(select id from organization where code = 'EIFF')";

/** Gera o SQL do catalogo: insumos (todos ou so os usados), composicoes escolhidas + dependencias, itens. */
export function gerarSql({ cat, composicoes, todosInsumos, selecionarComDependencias, comentario }) {
  const sel = selecionarComDependencias(cat, composicoes);
  const insumos = todosInsumos ? cat.insumos : sel.insumos;
  const data = cat.competencia ? `${cat.competencia}-01` : new Date().toISOString().slice(0, 10);
  const lote = (arr, n, fn) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(fn(arr.slice(i, i + n))); return out.join('\n'); };
  let sql = `-- ${comentario}\n-- Referencia: ${cat.referencia}. ${insumos.length} insumos, ${sel.composicoes.length} composicoes, ${sel.composicoes.reduce((a, c) => a + c.itens.length, 0)} itens. Idempotente.\n`;
  sql += '\n-- insumos (preco da UF; sem coleta na UF, preco atribuido de SP como faz o SINAPI)\n';
  sql += lote(insumos, 500, (ls) => `insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, active) values\n${ls.map((i) => `(${ORG}, 'SINAPI', ${q(i.codigo)}, ${q(i.descricao)}, ${q(i.unidade || 'un')}, ${q(i.tipo)}, ${i.preco}, '${data}', ${q(i.precoAtribuido ? `${cat.referencia} (preço atribuído ${i.precoAtribuido})` : cat.referencia)}, ${q(i.classe)}, true)`).join(',\n')}\non conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, class_name = excluded.class_name;`);
  sql += '\n\n-- composicoes\n';
  sql += lote(sel.composicoes, 500, (ls) => `insert into catalog_composition (organization_id, source, code, description, unit, group_name, active) values\n${ls.map((c) => `(${ORG}, 'SINAPI', ${q(c.codigo)}, ${q(c.descricao)}, ${q(c.unidade || 'un')}, ${q(c.grupo)}, true)`).join(',\n')}\non conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name;`);
  sql += '\n\n-- itens das composicoes (regravados)\n';
  sql += lote(sel.composicoes, 500, (ls) => `delete from catalog_composition_item where composition_id in (select id from catalog_composition where organization_id = ${ORG} and source = 'SINAPI' and code in (${ls.map((c) => q(c.codigo)).join(',')}));`);
  const itens = sel.composicoes.flatMap((c) => c.itens.map((it, i) => ({ comp: c.codigo, ordem: i + 1, tipo: it.tipo === 'Insumo' ? 'I' : 'C', ref: it.codigo, coef: it.coeficiente })));
  sql += '\n' + lote(itens, 1000, (ls) => `insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef
from (values\n${ls.map((v) => `(${q(v.comp)}, ${v.ordem}, ${q(v.tipo)}, ${q(v.ref)}, ${v.coef})`).join(',\n')}) as v(comp, ordem, tipo, ref, coef)
join catalog_composition c on c.organization_id = ${ORG} and c.source = 'SINAPI' and c.code = v.comp
left join catalog_input i on v.tipo = 'I' and i.organization_id = ${ORG} and i.source = 'SINAPI' and i.code = v.ref
left join catalog_composition cc on v.tipo = 'C' and cc.organization_id = ${ORG} and cc.source = 'SINAPI' and cc.code = v.ref
where i.id is not null or cc.id is not null;`);
  return { sql, insumos: insumos.length, composicoes: sel.composicoes.length, itens: itens.length };
}

async function main() {
  const arquivo = arg('arquivo');
  const saida = arg('saida');
  if (!arquivo || !saida) { console.error('uso: --arquivo <pasta|xlsx> --saida <nome da migration> [--uf GO] [--grupos regex] [--composicoes a,b] [--desonerado] [--todos-insumos]'); process.exit(1); }
  const { parseSinapi, selecionarComDependencias } = await carregarLeitor();
  const cat = parseSinapi(lerPlanilhas(arquivo), { uf: arg('uf', 'GO'), desonerado: flag('desonerado') });
  console.log(cat.referencia, '| insumos', cat.insumos.length, '| composicoes', cat.composicoes.length, cat.avisos.length ? '| ' + cat.avisos.join(' ') : '');
  const grupos = arg('grupos') ? new RegExp(arg('grupos'), 'i') : null;
  const codigos = new Set((arg('composicoes', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const c of cat.composicoes) if (grupos && grupos.test(c.grupo)) codigos.add(c.codigo);
  const r = gerarSql({ cat, composicoes: [...codigos], todosInsumos: flag('todos-insumos'), selecionarComDependencias, comentario: `Catalogo SINAPI importado por scripts/importar-sinapi.mjs de ${path.basename(arquivo)}` });
  const out = path.join(root, 'supabase', 'migrations', `${saida}.sql`);
  fs.writeFileSync(out, r.sql);
  console.log(`gerado ${path.relative(root, out)}: ${r.insumos} insumos, ${r.composicoes} composicoes, ${r.itens} itens (${(r.sql.length / 1e6).toFixed(1)} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
