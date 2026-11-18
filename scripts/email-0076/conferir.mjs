// Conferência estrutural da migration 0076: compara dois retratos (`retrato.sql`, antes e depois) e diz se o banco
// mudou EXATAMENTE como o roteiro prevê. Só lê arquivos locais; não fala com banco nenhum.
//
//   node scripts/email-0076/conferir.mjs <retrato-antes.json> <retrato-depois.json>
//
// Mesma classificação da 0075 (alterado / novo / removido, scripts/email-0075/conferir.mjs). Os NOVOS são aceitos por
// pertencerem à chave (tabelas inbox_email_switch*, funções novas da lista) e os ESSENCIAIS têm de estar presentes.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECOES = ['colunas', 'constraints', 'triggers', 'indices', 'politicas', 'rls', 'funcoes', 'funcoes_de_trigger', 'privilegios'];

/** Dados que a 0076 NÃO pode mudar (o livro, as mensagens e as conversas). */
export const DADOS_PRESERVADOS = [
  'entregas', 'eventos_entrega', 'entregas_por_estado', 'impressao_livro', 'impressao_eventos_entrega',
  'inbox_thread', 'inbox_message', 'impressao_mensagens', 'impressao_conversas', 'organization', 'profile',
];

const CRIAR = 'inbox_email_delivery_create(p_organization_id uuid, p_thread_id uuid, p_contact_id uuid, p_requested_by uuid, p_requester_name text, p_idempotency_key uuid, p_fingerprint text, p_body text, p_limit_user integer, p_limit_org integer)';
const TRANSICIONAR = 'inbox_email_delivery_transition(p_delivery_id uuid, p_to text, p_actor uuid, p_reason text, p_provider_message_id text, p_provider_thread_id text)';

/** Funções que a 0076 cria (todas com prefixo inbox_email_). */
export const FUNCOES_NOVAS = [
  'inbox_email_envio_liberado', 'inbox_email_switch_guarda', 'inbox_email_switch_pre', 'inbox_email_switch_evento_guarda',
  'inbox_email_switch_sem_truncate', 'inbox_email_switch_set', 'inbox_email_switch_desligar_sistema',
];

export const ESPERADO_0076 = Object.freeze({
  alterados: [
    'constraints:inbox_email_delivery.inbox_email_delivery_reason_check',
    `funcoes:${CRIAR}`,
    `funcoes:${TRANSICIONAR}`,
  ],
  /** Novos que TÊM de aparecer. */
  essenciais: [
    'rls:inbox_email_switch', 'rls:inbox_email_switch_event',
    'politicas:inbox_email_switch.inbox_email_switch_select', 'politicas:inbox_email_switch_event.inbox_email_switch_event_select',
    'triggers:inbox_email_switch.inbox_email_switch_pre', 'triggers:inbox_email_switch.inbox_email_switch_evento',
    'triggers:inbox_email_switch_event.inbox_email_switch_event_guarda',
    'triggers:inbox_email_switch.inbox_email_switch_no_truncate', 'triggers:inbox_email_switch_event.inbox_email_switch_event_no_truncate',
    'funcoes:inbox_email_switch_set(p_enabled boolean, p_reason text)',
    'funcoes:inbox_email_switch_desligar_sistema(p_organization_id uuid, p_reason text)',
    'funcoes:inbox_email_envio_liberado(p_organization_id uuid)',
  ],
  /** Privilégios exatos depois da 0076 (quem executa cada função). */
  privilegios: {
    [CRIAR]: 'service_role',
    [TRANSICIONAR]: 'service_role',
    'inbox_email_envio_liberado(p_organization_id uuid)': '',
    'inbox_email_switch_set(p_enabled boolean, p_reason text)': 'authenticated',
    'inbox_email_switch_guarda()': '', 'inbox_email_switch_pre()': '', 'inbox_email_switch_evento_guarda()': '', 'inbox_email_switch_sem_truncate()': '',
    'inbox_email_switch_desligar_sistema(p_organization_id uuid, p_reason text)': 'service_role',
  },
});

/** Um objeto novo pertence à 0076? (tabelas da chave ou funções da lista) */
export function novoDaChave(item) {
  if (/inbox_email_switch/.test(item)) return true
  const nome = item.replace(/^\w+:/, '').replace(/\(.*$/, '')
  return FUNCOES_NOVAS.includes(nome)
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ordenado = (xs) => [...xs].sort();

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

export function conferir(antes, depois, esperado = ESPERADO_0076) {
  const c = classificar(antes, depois);
  const problemas = [];
  // privilégios de funções que já existiam e não mudaram não aparecem como alteração; os da chave são conferidos abaixo
  const alteradosEstruturais = c.alterados.filter((x) => !x.startsWith('privilegios:'));
  for (const x of esperado.alterados) if (!alteradosEstruturais.includes(x)) problemas.push(`alteração esperada não ocorreu: ${x}`);
  for (const x of alteradosEstruturais) if (!esperado.alterados.includes(x)) problemas.push(`alteração inesperada: ${x}`);
  for (const x of c.alterados.filter((y) => y.startsWith('privilegios:'))) problemas.push(`privilégio de função existente mudou: ${x}`);
  for (const x of c.novos) if (!novoDaChave(x)) problemas.push(`objeto novo fora da chave: ${x}`);
  for (const x of esperado.essenciais) if (!c.novos.includes(x)) problemas.push(`objeto novo essencial ausente: ${x}`);
  for (const x of c.removidos) problemas.push(`objeto removido: ${x}`);
  for (const [f, quem] of Object.entries(esperado.privilegios)) {
    const real = depois.privilegios?.[f];
    if (real !== quem) problemas.push(`privilégio de ${f}: «${real ?? 'ausente'}» (esperado «${quem}»)`);
  }
  const dados = {};
  for (const k of DADOS_PRESERVADOS) {
    const a = antes.dados?.[k]; const d = depois.dados?.[k];
    if (!igual(a, d)) dados[k] = { antes: a, depois: d };
  }
  for (const k of Object.keys(dados)) problemas.push(`dado preexistente mudou: ${k}`);
  const j = depois.ja_existe_0076 ?? {};
  if (!j.inbox_email_switch || !j.inbox_email_switch_event) problemas.push('tabelas da chave ausentes');
  if (j.funcoes_inbox_email !== 15) problemas.push(`funções inbox_email_*: ${j.funcoes_inbox_email ?? 'ausente'} (esperado 15)`);
  if (antes.ja_existe_0076?.inbox_email_switch) problemas.push('o retrato «antes» já tinha a chave: não é o retrato de antes da 0076');
  return { ok: problemas.length === 0, ...c, dados_alterados: dados, problemas };
}

export const lerRetrato = (arquivo) => {
  const t = fs.readFileSync(arquivo, 'utf8');
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  const r = j.rows?.[0]?.retrato ?? j;
  return typeof r === 'string' ? JSON.parse(r) : r;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [a, d] = process.argv.slice(2);
  if (!a || !d) { console.error('uso: node scripts/email-0076/conferir.mjs <retrato-antes.json> <retrato-depois.json>'); process.exit(2); }
  const r = conferir(lerRetrato(a), lerRetrato(d));
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? 'CONFERE' : 'NÃO CONFERE');
  process.exit(r.ok ? 0 : 1);
}
