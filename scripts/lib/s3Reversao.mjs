// Reversão da 0077 (Segurança S3) gerada do RETRATO tirado imediatamente antes da aplicação
// (docs/seguranca/s3-0077-retrato.sql, versão 2).
//
// Por que gerada e não escrita à mão: a 0077 mexe em toda função e relação do dono nos schemas public e mart; a lista
// exata e os privilégios de cada uma são os do banco no dia. A reversão devolve o retrato para os papéis que a 0077 toca
// (PUBLIC, anon, authenticated, service_role) e o privilégio padrão do dono. O dono não é tocado.
//
// Guardas (R3 e R6 da revisão independente). Falha FECHADA, com mensagem, quando o retrato:
//   * não é da versão 2, tem mais de `idadeMaximaHoras` (24 h) ou é do futuro;
//   * não tem exatamente as 25 views da S3;
//   * é ANTERIOR à C1: alguma view com item para anon ou PUBLIC, ou authenticated com algo além de SELECT — a reversão
//     reabriria o que a contenção fechou;
//   * é POSTERIOR à 0077: alguma view já com security_invoker;
//   * tem concessão a PUBLIC/anon/authenticated/service_role feita por OUTRO papel (a reversão, executada pelo dono, não
//     reproduziria o concedente — em vez de ficar só "equivalente", recusa);
//   * tem nome de relação ou assinatura de função sem schema, fora de public/mart.
// O SQL gerado também se protege na EXECUÇÃO: roda com search_path = pg_catalog (nada depende de quem executa), confere
// antes que o papel é o do retrato, que as 25 views existem com security_invoker (estado pós-0077) e que todo objeto do
// retrato existe; e confere no fim o invariante da C1 (nenhuma view de public/mart com privilégio de anon ou PUBLIC e
// authenticated só com SELECT). Qualquer divergência levanta erro e a transação inteira é desfeita.
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
export const RETRATO_SQL = fs.readFileSync(path.join(AQUI, '..', '..', 'docs', 'seguranca', 's3-0077-retrato.sql'), 'utf8');

export const VIEWS_S3 = [
  'mart.aging', 'mart.cash_weekly', 'mart.dre_monthly', 'mart.project_360',
  'public.v_aging', 'public.v_composition_cost', 'public.v_dre_monthly', 'public.v_financial_entry_calc',
  'public.v_heat_traceability', 'public.v_opening_balance', 'public.v_parameter', 'public.v_project_360',
  'public.v_purchase_order', 'public.v_radar_company_queue', 'public.v_radar_contact_coverage', 'public.v_radar_pipeline',
  'public.v_service_billing', 'public.v_service_cost', 'public.v_service_labor', 'public.v_service_progress',
  'public.v_service_weight', 'public.v_station_productivity', 'public.v_steel_cost_by_service', 'public.v_stock_position',
  'public.v_training_progress'];

const PAPEIS = new Set(['', 'anon', 'authenticated', 'service_role']); // '' = PUBLIC
const LETRAS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE', U: 'USAGE' };
const OBJ = { r: 'tables', S: 'sequences', f: 'functions' };
const papelSql = (p) => (p === '' ? 'public' : `"${p}"`);
const sqlTexto = (s) => `'${String(s).replace(/'/g, "''")}'`;
const IDENT = '(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)';
const NOME_QUALIFICADO = new RegExp(`^(${IDENT})\\.${IDENT}$`);
const ASSINATURA_QUALIFICADA = new RegExp(`^(${IDENT})\\.${IDENT}\\(.*\\)$`);
const semAspas = (s) => s.replace(/^"(.*)"$/, '$1').replace(/""/g, '"');

class RetratoRecusado extends Error {}

/** "anon=arwd/postgres" → { papel, letras, privilegios, concedente }; papéis fora dos quatro devolvem null (não tocados) */
export function lerItemAcl(item) {
  const m = /^("(?:[^"]|"")*"|[^=]*)=([A-Za-z*]*)\/(.+)$/.exec(item);
  if (!m) throw new RetratoRecusado(`item de ACL não reconhecido: ${item}`);
  const papel = semAspas(m[1]);
  if (!PAPEIS.has(papel)) return null;
  if (m[2].includes('*')) throw new RetratoRecusado(`opção de concessão não suportada na reversão: ${item}`);
  const privilegios = [...m[2]].map((l) => { if (!LETRAS[l]) throw new RetratoRecusado(`privilégio desconhecido '${l}' em ${item}`); return LETRAS[l]; });
  return { papel, letras: m[2], privilegios, concedente: semAspas(m[3]) };
}

/** concessões de uma ACL; `null` = ACL padrão do PostgreSQL (função: PUBLIC executa; relação: só o dono) */
function concessoes(acl, tipo, dono, onde) {
  if (acl === null || acl === undefined) return tipo === 'funcao' ? [{ papel: '', privilegios: ['EXECUTE'], concedente: dono }] : [];
  const itens = acl.map(lerItemAcl).filter(Boolean);
  for (const i of itens) {
    if (i.concedente !== dono) throw new RetratoRecusado(`${onde}: concessão a ${i.papel || 'PUBLIC'} feita por ${i.concedente}, não pelo dono ${dono}; a reversão não reproduziria o concedente`);
  }
  return itens;
}

function restaurar(alvo, acl, tipo, dono) {
  const linhas = [`revoke all on ${alvo} from public, anon, authenticated, service_role;`];
  for (const { papel, privilegios } of concessoes(acl, tipo, dono, alvo)) {
    if (privilegios.length) linhas.push(`grant ${privilegios.join(', ')} on ${alvo} to ${papelSql(papel)};`);
  }
  return linhas;
}

/** confere o retrato e devolve a lista de motivos de recusa (vazia = utilizável) */
export function conferirRetrato(r, { agora = new Date(), idadeMaximaHoras = 24 } = {}) {
  const motivos = [];
  if (!r || typeof r !== 'object') return ['retrato vazio ou ilegível'];
  if (r.versao_retrato !== 2) motivos.push(`versão do retrato ${r.versao_retrato ?? '(ausente)'}: esperado 2 (docs/seguranca/s3-0077-retrato.sql atual)`);
  if (!Array.isArray(r.views) || !Array.isArray(r.funcoes) || !Array.isArray(r.relacoes) || !Array.isArray(r.padrao)) {
    return [...motivos, 'estrutura inválida: esperado o JSON de docs/seguranca/s3-0077-retrato.sql'];
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(r.papel ?? '')) motivos.push(`papel do retrato inválido: ${r.papel}`);
  const tirado = Date.parse(r.tirado_em ?? '');
  if (Number.isNaN(tirado)) motivos.push('retrato sem data (tirado_em)');
  else {
    const horas = (agora.getTime() - tirado) / 3_600_000;
    if (horas > idadeMaximaHoras) motivos.push(`retrato antigo: ${horas.toFixed(1)} h (máximo ${idadeMaximaHoras} h); tirar de novo imediatamente antes da 0077`);
    if (horas < -0.1) motivos.push('retrato com data no futuro');
  }
  const nomes = r.views.map((v) => v.nome).sort();
  const esperadas = [...VIEWS_S3].sort();
  if (JSON.stringify(nomes) !== JSON.stringify(esperadas)) {
    motivos.push(`views do retrato diferentes das 25 da S3: faltam [${esperadas.filter((x) => !nomes.includes(x)).join(', ')}], sobram [${nomes.filter((x) => !esperadas.includes(x)).join(', ')}]`);
  }
  for (const v of r.views) {
    if ((v.opcoes ?? []).some((o) => /^security_invoker=(true|on|1)$/.test(o))) motivos.push(`${v.nome} já tem security_invoker: retrato tirado DEPOIS da 0077`);
    for (const item of v.acl ?? []) {
      let i; try { i = lerItemAcl(item); } catch (e) { motivos.push(`${v.nome}: ${e.message}`); continue; }
      if (!i) continue;
      if (i.papel === 'anon' || i.papel === '') motivos.push(`${v.nome}: ${i.papel || 'PUBLIC'} com ${i.letras} — retrato ANTERIOR à C1 (a reversão reabriria a view)`);
      if (i.papel === 'authenticated' && i.letras.replace(/r/g, '') !== '') motivos.push(`${v.nome}: authenticated com escrita (${i.letras}) — retrato ANTERIOR à C1`);
    }
  }
  for (const x of [...r.views, ...r.relacoes]) {
    const m = NOME_QUALIFICADO.exec(x.nome ?? '');
    if (!m || !['public', 'mart'].includes(semAspas(m[1]))) motivos.push(`nome sem schema ou fora de public/mart: ${x.nome}`);
  }
  for (const f of r.funcoes) {
    const m = ASSINATURA_QUALIFICADA.exec(f.assinatura ?? '');
    if (!m || !['public', 'mart'].includes(semAspas(m[1]))) motivos.push(`assinatura sem schema (retrato tirado sem search_path = pg_catalog?): ${f.assinatura}`);
  }
  // concedente e itens ilegíveis
  try {
    for (const v of r.views) concessoes(v.acl, 'relacao', r.papel, v.nome);
    for (const x of r.relacoes) concessoes(x.acl, 'relacao', r.papel, x.nome);
    for (const f of r.funcoes) concessoes(f.acl, 'funcao', r.papel, f.assinatura);
    for (const d of r.padrao) { concessoes(d.acl, 'padrao', r.papel, `padrão ${d.schema ?? 'global'}/${d.tipo}`); if (!OBJ[d.tipo] && (d.acl ?? []).some((i) => lerItemAcl(i))) motivos.push(`tipo de privilégio padrão não suportado: ${d.tipo}`); }
  } catch (e) { motivos.push(e.message); }
  return motivos;
}

/** devolve o SQL da reversão (uma transação) a partir do retrato; lança erro se o retrato for recusado */
export function gerarReversao(retrato, opcoes = {}) {
  const r = typeof retrato === 'string' ? JSON.parse(retrato) : retrato;
  const motivos = conferirRetrato(r, opcoes);
  if (motivos.length) throw new RetratoRecusado(`retrato recusado; nenhuma reversão gerada:\n - ${motivos.join('\n - ')}`);
  const dono = r.papel;
  const objetosRel = [...r.views.map((v) => v.nome), ...r.relacoes.map((x) => x.nome)];
  const objetosFn = r.funcoes.map((f) => f.assinatura);
  const lista = (xs) => `array[${xs.map(sqlTexto).join(', ')}]::text[]`;
  const sql = [
    `-- Reversão da 0077 gerada do retrato de ${r.tirado_em} (papel ${dono}, banco ${r.banco ?? '?'}) por scripts/s3-0077-reversao.mjs.`,
    '-- Volta ao estado do retrato (pós-C1). Executar só com autorização; qualquer guarda que falhe desfaz tudo.',
    'begin;',
    'set local search_path = pg_catalog;',
    "set local lock_timeout = '5s';",
    'do $pre$',
    'declare faltam text[];',
    'begin',
    `  if current_user <> ${sqlTexto(dono)} then raise exception 'S3/reversão: executar como % (atual: %)', ${sqlTexto(dono)}, current_user; end if;`,
    `  select array_agg(x) into faltam from unnest(${lista(VIEWS_S3)}) x where to_regclass(x) is null`,
    "    or not coalesce((select c.reloptions && array['security_invoker=true','security_invoker=on','security_invoker=1'] from pg_class c where c.oid = to_regclass(x)), false);",
    "  if faltam is not null then raise exception 'S3/reversão: estado inesperado (a 0077 não está aplicada nestas views): %', faltam; end if;",
    `  select array_agg(x) into faltam from unnest(${lista(objetosRel)}) x where to_regclass(x) is null;`,
    "  if faltam is not null then raise exception 'S3/reversão: relações do retrato ausentes (houve mudança depois do retrato): %', faltam; end if;",
    `  select array_agg(x) into faltam from unnest(${lista(objetosFn)}) x where to_regprocedure(x) is null;`,
    "  if faltam is not null then raise exception 'S3/reversão: funções do retrato ausentes (houve mudança depois do retrato): %', faltam; end if;",
    'end $pre$;',
  ];
  for (const v of r.views) {
    sql.push(`alter view ${v.nome} reset (security_invoker);`);
    sql.push(...restaurar(`table ${v.nome}`, v.acl, 'relacao', dono));
  }
  for (const x of r.relacoes) sql.push(...restaurar(`${x.tipo === 'S' ? 'sequence' : 'table'} ${x.nome}`, x.acl, 'relacao', dono));
  for (const f of r.funcoes) sql.push(...restaurar(`function ${f.assinatura}`, f.acl, 'funcao', dono));
  // privilégio padrão: os escopos que a 0077 toca (global de funções e public) e qualquer outro do retrato voltam ao retrato
  const escopos = new Map([['|f', null], ['public|r', null], ['public|S', null], ['public|f', null]]);
  for (const d of r.padrao) escopos.set(`${d.schema ?? ''}|${d.tipo}`, d);
  for (const [chave, d] of escopos) {
    const [schema, tipo] = chave.split('|');
    if (!OBJ[tipo]) continue;
    const em = schema ? ` in schema "${schema}"` : '';
    sql.push(`alter default privileges for role "${dono}"${em} revoke all on ${OBJ[tipo]} from public, anon, authenticated, service_role;`);
    const itens = d ? concessoes(d.acl, 'padrao', dono, chave) : (schema === '' && tipo === 'f' ? [{ papel: '', privilegios: ['EXECUTE'] }] : []);
    for (const c of itens) if (c.privilegios.length) sql.push(`alter default privileges for role "${dono}"${em} grant ${c.privilegios.join(', ')} on ${OBJ[tipo]} to ${papelSql(c.papel)};`);
  }
  sql.push(
    'do $c1$',
    'declare ruins text[];',
    'begin',
    "  select array_agg(distinct n.nspname || '.' || c.relname || ' ' || papel || ' ' || pv) into ruins",
    '  from pg_class c join pg_namespace n on n.oid = c.relnamespace',
    "  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pv cross join unnest(array['anon','authenticated']) papel",
    "  where c.relkind = 'v' and n.nspname in ('public', 'mart')",
    "    and ((papel = 'anon' and has_table_privilege('anon', c.oid, pv)) or (papel = 'authenticated' and pv <> 'SELECT' and has_table_privilege('authenticated', c.oid, pv)));",
    "  if ruins is not null then raise exception 'S3/reversão: o resultado reabriria o que a C1 fechou: %', ruins; end if;",
    "  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where c.relkind = 'v' and n.nspname in ('public', 'mart') and a.grantee = 0) then",
    "    raise exception 'S3/reversão: o resultado daria privilégio a PUBLIC numa view (C1)'; end if;",
    'end $c1$;',
    'commit;',
  );
  return sql.join('\n') + '\n';
}

export { RetratoRecusado };
