// Conferência estrutural da migration 0075: compara dois retratos (`retrato.sql`, antes e depois da aplicação) e diz
// se o banco mudou EXATAMENTE como o roteiro prevê. Só lê arquivos locais; não fala com banco nenhum.
//
//   node scripts/email-0075/conferir.mjs <retrato-antes.json> <retrato-depois.json>
//
// Correção de 13/11/2026: o script usado na aplicação comparava só objetos que JÁ existiam antes e, por isso, contou
// como «faltando» o trigger e a função novos — falso positivo registrado em docs/email-comercial-0075-preflight.md §9.
// Aqui cada objeto é classificado em ALTERADO (existia e mudou), NOVO (não existia) ou REMOVIDO (existia e sumiu), e o
// esperado é declarado separadamente para alterados e novos.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Seções estruturais do retrato. */
export const SECOES = ['colunas', 'constraints', 'triggers', 'indices', 'politicas', 'rls', 'funcoes', 'funcoes_de_trigger'];

/** Dados do Inbox que a 0075 NÃO pode mudar. */
export const DADOS_PRESERVADOS = [
  'inbox_thread', 'inbox_message', 'inbox_contact', 'inbox_contact_identity', 'inbox_thread_event', 'profile', 'organization',
  'impressao_mensagens', 'impressao_conversas', 'inbox_message_por_provider', 'inbox_message_por_entrega',
];

/**
 * O que a 0075 muda no ESCOPO do retrato (as sete tabelas do Inbox, perfil e organização). As tabelas novas do livro
 * ficam fora desse escopo e são conferidas por `ja_existe_0075`.
 */
export const ESPERADO_0075 = Object.freeze({
  alterados: ['constraints:inbox_message.inbox_message_provider_check'],
  novos: ['funcoes_de_trigger:inbox_email_mensagem_governada', 'triggers:inbox_message.inbox_message_email_governada'],
});

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ordenado = (xs) => [...xs].sort();

/** Classifica cada diferença estrutural entre dois retratos. */
export function classificar(antes, depois) {
  const alterados = []; const novos = []; const removidos = [];
  for (const s of SECOES) {
    const a = antes[s] ?? {}; const d = depois[s] ?? {};
    for (const k of Object.keys(a)) {
      if (!(k in d)) removidos.push(`${s}:${k}`);
      else if (!igual(a[k], d[k])) alterados.push(`${s}:${k}`);
    }
    for (const k of Object.keys(d)) if (!(k in a)) novos.push(`${s}:${k}`);
  }
  return { alterados: ordenado(alterados), novos: ordenado(novos), removidos: ordenado(removidos) };
}

/** Veredito: o banco mudou exatamente como o esperado, sem tocar nos dados e com o livro presente. */
export function conferir(antes, depois, esperado = ESPERADO_0075) {
  const c = classificar(antes, depois);
  const problemas = [];
  const falta = (lista, alvo) => alvo.filter((x) => !lista.includes(x));
  const sobra = (lista, alvo) => lista.filter((x) => !alvo.includes(x));
  for (const x of falta(c.alterados, esperado.alterados)) problemas.push(`alteração esperada não ocorreu: ${x}`);
  for (const x of sobra(c.alterados, esperado.alterados)) problemas.push(`alteração inesperada: ${x}`);
  for (const x of falta(c.novos, esperado.novos)) problemas.push(`objeto novo esperado ausente: ${x}`);
  for (const x of sobra(c.novos, esperado.novos)) problemas.push(`objeto novo inesperado: ${x}`);
  for (const x of c.removidos) problemas.push(`objeto removido: ${x}`);
  const dados = {};
  for (const k of DADOS_PRESERVADOS) {
    const a = antes.dados?.[k]; const d = depois.dados?.[k];
    if (!igual(a, d)) dados[k] = { antes: a, depois: d };
  }
  for (const k of Object.keys(dados)) problemas.push(`dado preexistente mudou: ${k}`);
  const j = depois.ja_existe_0075 ?? {};
  if (!j.inbox_email_delivery || !j.inbox_email_delivery_event) problemas.push('livro de entregas ausente');
  if (j.funcoes !== 8) problemas.push(`funções inbox_email_*: ${j.funcoes ?? 'ausente'} (esperado 8)`);
  return { ok: problemas.length === 0, ...c, dados_alterados: dados, problemas };
}

const lerRetrato = (arquivo) => {
  const t = fs.readFileSync(arquivo, 'utf8');
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  // aceita o retrato puro ou a saída do `supabase db query` ({ rows: [{ retrato }] })
  const r = j.rows?.[0]?.retrato ?? j;
  return typeof r === 'string' ? JSON.parse(r) : r;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [a, d] = process.argv.slice(2);
  if (!a || !d) { console.error('uso: node scripts/email-0075/conferir.mjs <retrato-antes.json> <retrato-depois.json>'); process.exit(2); }
  const r = conferir(lerRetrato(a), lerRetrato(d));
  console.log(JSON.stringify(r, null, 1));
  console.log(r.ok ? 'CONFERE: o banco mudou exatamente como previsto.' : 'DIVERGE: ver «problemas».');
  process.exit(r.ok ? 0 : 1);
}
