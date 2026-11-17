// Reversão da 0077 (Segurança S3) gerada do RETRATO tirado antes da aplicação (docs/seguranca/s3-0077-retrato.sql).
//
// Por que gerada e não escrita à mão: a 0077 mexe em toda função e relação do dono no schema public; a lista exata e os
// privilégios de cada uma são os do banco no dia. A reversão devolve EXATAMENTE o retrato para os papéis que a 0077 toca
// (PUBLIC, anon, authenticated, service_role) — no banco de produção, o estado pós-C1, nunca o anterior à C1 (as views
// continuam sem anon porque o retrato já foi tirado sem). O dono não é tocado. Funções/relações criadas DEPOIS do retrato
// ficam como estão (a reversão só cita o que o retrato conhece). Falha fechada: item de ACL não reconhecido, privilégio com
// opção de concessão ou papel fora dos quatro aborta a geração.
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
export const RETRATO_SQL = fs.readFileSync(path.join(AQUI, '..', '..', 'docs', 'seguranca', 's3-0077-retrato.sql'), 'utf8');

const PAPEIS = new Set(['', 'anon', 'authenticated', 'service_role']); // '' = PUBLIC
const LETRAS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE', U: 'USAGE' };
const papelSql = (p) => (p === '' ? 'public' : `"${p}"`);

/** "anon=arwd/postgres" → { papel: 'anon', privilegios: ['SELECT', ...] }; papéis fora dos quatro devolvem null (não tocados) */
export function lerItemAcl(item) {
  const m = /^("?)([^=]*)\1=([A-Za-z*]*)\/(.+)$/.exec(item);
  if (!m) throw new Error(`item de ACL não reconhecido: ${item}`);
  const papel = m[2];
  if (!PAPEIS.has(papel)) return null;
  if (m[3].includes('*')) throw new Error(`opção de concessão não suportada na reversão: ${item}`);
  return { papel, privilegios: [...m[3]].map((l) => { if (!LETRAS[l]) throw new Error(`privilégio desconhecido '${l}' em ${item}`); return LETRAS[l]; }) };
}

/** concessões de uma ACL; `null` = ACL padrão do PostgreSQL (função: PUBLIC executa; relação: só o dono) */
function concessoes(acl, tipo) {
  if (acl === null) return tipo === 'funcao' ? [{ papel: '', privilegios: ['EXECUTE'] }] : [];
  return acl.map(lerItemAcl).filter(Boolean);
}

function restaurar(alvo, acl, tipo) {
  const linhas = [`revoke all on ${alvo} from public, anon, authenticated, service_role;`];
  for (const { papel, privilegios } of concessoes(acl, tipo)) {
    if (privilegios.length) linhas.push(`grant ${privilegios.join(', ')} on ${alvo} to ${papelSql(papel)};`);
  }
  return linhas;
}

const OBJ = { r: 'tables', S: 'sequences', f: 'functions' };

/** devolve o SQL da reversão (uma transação) a partir do retrato */
export function gerarReversao(retrato) {
  const r = typeof retrato === 'string' ? JSON.parse(retrato) : retrato;
  if (!r || !Array.isArray(r.views) || !Array.isArray(r.funcoes) || !Array.isArray(r.relacoes) || !Array.isArray(r.padrao)) {
    throw new Error('retrato inválido: esperado o JSON de docs/seguranca/s3-0077-retrato.sql');
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(r.papel ?? '')) throw new Error(`papel do retrato inválido: ${r.papel}`);
  const sql = ['-- Reversão da 0077 gerada do retrato (scripts/s3-0077-reversao.mjs). Volta ao estado do retrato.', 'begin;'];
  for (const v of r.views) {
    const invoker = (v.opcoes ?? []).some((o) => /^security_invoker=(true|on|1)$/.test(o));
    if (!invoker) sql.push(`alter view ${v.nome} reset (security_invoker);`);
    sql.push(...restaurar(`table ${v.nome}`, v.acl, 'relacao'));
  }
  for (const x of r.relacoes) sql.push(...restaurar(`${x.tipo === 'S' ? 'sequence' : 'table'} ${x.nome}`, x.acl, 'relacao'));
  for (const f of r.funcoes) sql.push(...restaurar(`function ${f.assinatura}`, f.acl, 'funcao'));
  // privilégio padrão: a 0077 tira anon do schema public e o EXECUTE global de PUBLIC; devolve o que o retrato tinha
  for (const d of r.padrao) {
    const em = d.schema ? ` in schema ${d.schema}` : '';
    for (const c of concessoes(d.acl, 'padrao')) {
      if (!OBJ[d.tipo]) throw new Error(`tipo de privilégio padrão não suportado: ${d.tipo}`);
      if (c.privilegios.length) sql.push(`alter default privileges for role "${r.papel}"${em} grant ${c.privilegios.join(', ')} on ${OBJ[d.tipo]} to ${papelSql(c.papel)};`);
    }
  }
  if (!r.padrao.some((d) => !d.schema && d.tipo === 'f')) {
    // sem linha global de funções no retrato = padrão do PostgreSQL (PUBLIC executa)
    sql.push(`alter default privileges for role "${r.papel}" grant execute on functions to public;`);
  }
  sql.push('commit;');
  return sql.join('\n') + '\n';
}
