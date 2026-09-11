// Pre-Merge Gate 02 — achados do review externo do SHA f4c142f.
//
// As migrations NAO sao aplicadas aqui (a suite nao tem Postgres), entao a garantia e ESTATICA sobre o SQL: cada
// teste prende a clausula exata que fecha o buraco e falha se alguem a remover. Onde da para provar de verdade em
// TypeScript (hash do codigo, teto do corpo do webhook), o teste executa o codigo.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITE_CORPO_WEBHOOK, tratarWebhookMeta, type ConfigMeta, type DepsMeta } from './metaServidor';
import { abrirDesafioVerificacao, codigoParaVerificacao, desafioPersistivel, hashCodigoVerificacao } from './identidade';

const ler = (f: string) => fs.readFileSync(f, 'utf8');
const M49 = () => ler('supabase/migrations/0049_whatsapp_identity.sql');
const M50 = () => ler('supabase/migrations/0050_central_conversation.sql');
const ORG = 'org-eiff';
const TELEFONE = '5562988887777';
const APP_SECRET = 'app-secret-longo-o-suficiente-para-hmac';

const assinar = async (corpo: string) => {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const a = await crypto.subtle.sign('HMAC', k, enc.encode(corpo));
  return `sha256=${[...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};
function deps(): DepsMeta {
  const meta: ConfigMeta = { accessToken: 'EAAtoken', phoneNumberId: 'pn-1', wabaId: 'waba-1', verifyToken: 'verifica-me', appSecret: APP_SECRET };
  const fetchMock = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  return { fetch: fetchMock, meta, numeros: { interno: 'pn-1' }, agora: () => '2026-09-10T12:00:00.000Z' };
}

// ---------------------------------------------------------------------------
// 1) RLS dos filhos de central_conversation
// ---------------------------------------------------------------------------
describe('gate 02: os filhos da conversa herdam a visibilidade do pai', () => {
  it('mensagem e evento passam pela RLS da conversa, em vez de olhar só a organização', () => {
    const s = M50();
    expect(s).toMatch(/create policy cm_select on central_message[\s\S]*?exists \(select 1 from central_conversation c where c\.id = central_message\.conversation_id\)/);
    expect(s).toMatch(/create policy ce_select on central_event[\s\S]*?exists \(select 1 from central_conversation c where c\.id = central_event\.conversation_id\)/);
    // e nenhuma das duas pode voltar a ser "só organização" (era exatamente esse o furo)
    expect(s).not.toMatch(/create policy cm_select on central_message for select using \(organization_id = current_org\(\)\);/);
    expect(s).not.toMatch(/create policy ce_select on central_event for select using \(organization_id = current_org\(\)\);/);
  });

  it('a regra herdada é a da conversa: EXTERNAL como antes, INTERNAL só para a Diretoria ou quem assumiu', () => {
    const politica = /create policy cc_select on central_conversation for select using \(([\s\S]*?)\);/.exec(M50())?.[1] ?? '';
    expect(politica).toMatch(/organization_id = current_org\(\)/);
    expect(politica).toMatch(/context = 'EXTERNAL'/);
    expect(politica).toMatch(/has_role\('Administrador', 'Diretoria', 'Financeiro'\)/);
    expect(politica).toMatch(/human_owner_id = auth\.uid\(\)/);
  });

  it('não há recursão de RLS: a política da conversa não olha para mensagem nem para evento', () => {
    const politica = /create policy cc_select on central_conversation for select using \(([\s\S]*?)\);/.exec(M50())?.[1] ?? '';
    expect(politica).not.toMatch(/central_message|central_event/);
  });

  it('a escrita continua server-only nas três tabelas', () => {
    const s = M50();
    for (const t of ['central_conversation', 'central_message', 'central_event']) {
      expect(s, t).toMatch(new RegExp(`revoke all on ${t} from authenticated;`));
      expect(s, t).toMatch(new RegExp(`grant select on ${t} to authenticated;`));
      expect(s, t).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]*on ${t} to authenticated`));
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Coerencia cross-tenant das FKs
// ---------------------------------------------------------------------------
describe('gate 02: nenhuma referência cross-tenant é persistida', () => {
  it('0049: a RPC de pedido exige que o colaborador seja da MESMA organização', () => {
    const s = M49();
    expect(s).toMatch(/p_worker_id is not null and not exists \(select 1 from worker where id = p_worker_id and organization_id = v_org\)/);
    expect(s).toMatch(/colaborador_de_outra_organizacao/);
    // a checagem do perfil virou positiva (existe NA organização) em vez de negativa
    expect(s).toMatch(/not exists \(select 1 from profile where id = v_alvo and organization_id = v_org\)/);
  });

  it('0049: o banco recusa pessoa de outra organização mesmo via service_role com parâmetro errado', () => {
    const s = M49();
    expect(s).toMatch(/create trigger whatsapp_identity_coerencia before insert or update on whatsapp_identity/);
    for (const col of ['profile_id', 'worker_id', 'requested_by']) {
      expect(s, col).toMatch(new RegExp(`new\\.${col} is not null and not exists`));
    }
  });

  it('0050: identidade, dono humano e ator do evento são da organização da própria linha', () => {
    const s = M50();
    expect(s).toMatch(/create trigger central_conversation_coerencia before insert or update on central_conversation/);
    expect(s).toMatch(/whatsapp_identity i where i\.id = new\.identity_id[\s\S]*?i\.organization_id = new\.organization_id/);
    expect(s).toMatch(/profile p where p\.id = new\.human_owner_id and p\.organization_id = new\.organization_id/);
    expect(s).toMatch(/create trigger central_event_ator before insert on central_event/);
  });
});

// ---------------------------------------------------------------------------
// 3) Verificacao atomica do codigo
// ---------------------------------------------------------------------------
describe('gate 02: promover para VERIFIED exige prova do código', () => {
  it('existe porta atômica, server-only, que compara o hash sob row lock', () => {
    const s = M49();
    expect(s).toMatch(/create or replace function whatsapp_identity_verify\(/);
    expect(s).toMatch(/revoke execute on function whatsapp_identity_verify\(uuid, uuid, text, integer\) from public, anon, authenticated;/);
    expect(s).toMatch(/grant execute on function whatsapp_identity_verify\(uuid, uuid, text, integer\) to service_role;/);
    const corpo = s.slice(s.indexOf('function whatsapp_identity_verify'));
    expect(corpo).toMatch(/for update/);
    expect(corpo).toMatch(/v_i\.verification_code_hash = p_code_hash/);
    expect(corpo).toMatch(/verification_attempts = verification_attempts \+ 1/);
    expect(corpo).toMatch(/verification_attempts >= least\(greatest\(coalesce\(p_max_attempts, WHATSAPP_MAX\), 1\), WHATSAPP_MAX\)/);
    expect(corpo).toMatch(/codigo_expirado/);
    expect(corpo).toMatch(/status = 'VERIFIED'/);
    expect(corpo).toMatch(/verification_code_hash = null/);
  });

  it('código errado não revela nada além de "não confere"', () => {
    const s = M49();
    const corpo = s.slice(s.indexOf('function whatsapp_identity_verify'));
    expect(corpo).toMatch(/'codigo_nao_confere'/);
    expect(corpo).not.toMatch(/left\(p_code_hash|substring\(p_code_hash|position\(/);
  });

  it('whatsapp_identity_transition não promove mais para VERIFIED: só revoga', () => {
    const s = M49();
    const corpo = s.slice(s.indexOf('function whatsapp_identity_transition'), s.indexOf('function whatsapp_identity_verify'));
    expect(corpo).toMatch(/p_to_status <> 'REVOKED'/);
    expect(corpo).not.toMatch(/status = 'VERIFIED'/);
    expect(corpo).not.toMatch(/p_to_status in \('VERIFIED', 'REVOKED'\)/);
  });

  it('o plaintext do código nunca vai ao banco: só o SHA-256, no formato que a coluna exige', () => {
    const h = hashCodigoVerificacao('123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(M49()).toMatch(/verification_code_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    // digitado com separadores é o mesmo código; outro código é outro hash
    expect(codigoParaVerificacao('12 34-56')).toBe(h);
    expect(codigoParaVerificacao('654321')).not.toBe(h);
  });

  it('o que se persiste do desafio não carrega o código', () => {
    const desafio = abrirDesafioVerificacao(
      { id: 'i1', organizationId: ORG, telefoneNormalizado: TELEFONE, contexto: 'INTERNAL', situacao: 'PENDING', criadoEm: '2026-09-10T12:00:00.000Z' },
      '2026-09-10T12:00:00.000Z',
    );
    const persistivel = desafioPersistivel(desafio);
    expect(JSON.stringify(persistivel)).not.toContain(desafio.codigo);
    expect(persistivel.codeHash).toBe(hashCodigoVerificacao(desafio.codigo));
    expect(persistivel.identidadeId).toBe('i1');
  });
});

// ---------------------------------------------------------------------------
// 4) Corpo do webhook
// ---------------------------------------------------------------------------
describe('gate 02: teto do corpo do webhook', () => {
  it('Content-Length acima do teto é recusado ANTES de ler o corpo', () => {
    const fonte = ler('netlify/functions/channel-meta-webhook.ts');
    const guarda = fonte.indexOf('content-length');
    const leitura = fonte.indexOf('await req.text()');
    expect(guarda).toBeGreaterThan(-1);
    expect(leitura).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(leitura); // se vier depois, não guarda nada
    expect(fonte).toMatch(/declarado > LIMITE_CORPO_WEBHOOK/);
    expect(fonte).toMatch(/413/);
    // o header é do cliente: fica registrado que ele não é a defesa completa
    expect(fonte).toMatch(/RATE_LIMIT_EDGE/);
  });

  it('o teto sobre o corpo REAL continua no handler, mesmo com assinatura válida', async () => {
    const gigante = 'x'.repeat(LIMITE_CORPO_WEBHOOK + 1);
    const r = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: gigante, assinatura: await assinar(gigante) }, deps());
    expect(r.status).toBe(413);
    expect(r.eventos).toBeUndefined();
  });

  it('corpo dentro do teto segue o caminho normal', async () => {
    const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'pn-1' }, messages: [{ id: 'wamid.1', from: TELEFONE, timestamp: '1789000000', type: 'text' }] } }] }] });
    const r = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo, assinatura: await assinar(corpo) }, deps());
    expect(r.status).toBe(200);
    expect(r.eventos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pre-Merge Gate 03 — o que so a EXECUCAO REAL das migrations pegou
// As migrations foram aplicadas num PostgreSQL descartavel (PGlite, Postgres em WASM) dentro de
// BEGIN ... ROLLBACK, com dez smoke tests. Os testes abaixo prendem, na suite do dia a dia, o que aquela
// execucao provou — para a regressao nao depender de alguem lembrar de rodar o harness.
// ---------------------------------------------------------------------------
describe('gate 03: delimitadores e curto-circuito do PL/pgSQL', () => {
  it('toda função tem dollar quote válido e pareado, nas três migrations', () => {
    for (const arq of ['0049_whatsapp_identity.sql', '0050_central_conversation.sql', '0051_central_meta_delivery.sql']) {
      const s = ler(`supabase/migrations/${arq}`);
      // "as $" ou "end $;" com UM cifrão é delimitador inválido — o Postgres recusa o arquivo inteiro
      expect(s, arq).not.toMatch(/\bas \$(?!\$)/);
      expect(s, arq).not.toMatch(/\bend \$;/);
      // e todo $$ aberto é fechado
      expect((s.match(/\$\$/g) ?? []).length % 2, `${arq}: $$ ímpar`).toBe(0);
    }
  });

  it('central_coerencia não lê new.message_id fora de central_event', () => {
    const s = ler('supabase/migrations/0050_central_conversation.sql');
    const corpo = s.slice(s.indexOf('function central_coerencia'), s.indexOf('drop trigger if exists central_message_coerencia'));
    // a função é trigger das DUAS tabelas e central_message não tem a coluna: num único "and" o SQL pode
    // avaliar o lado direito mesmo com o esquerdo falso e estourar. Por isso o IF é aninhado.
    expect(corpo).not.toMatch(/tg_table_name = 'central_event' and new\.message_id/);
    expect(corpo).toMatch(/if tg_table_name = 'central_event' then\s*\n\s*if new\.message_id is not null then/);
  });
});

describe('gate 03: binding conversa ↔ identidade', () => {
  it('a identidade tem de bater em organização, contexto E telefone', () => {
    const s = ler('supabase/migrations/0050_central_conversation.sql');
    const corpo = s.slice(s.indexOf('function central_conversation_coerencia'), s.indexOf('drop trigger if exists central_conversation_coerencia'));
    expect(corpo).toMatch(/i\.organization_id = new\.organization_id/);
    expect(corpo).toMatch(/i\.context = new\.context/);
    expect(corpo).toMatch(/i\.phone_e164 = new\.phone_e164/);
    // só organização deixaria associar uma identidade VERIFIED válida à conversa de outra pessoa da mesma empresa
    expect(corpo).toMatch(/não corresponde a esta conversa/);
  });
});

describe('gate 03: teto de tentativas é do banco', () => {
  it('p_max_attempts pode apertar, nunca afrouxar', () => {
    const s = ler('supabase/migrations/0049_whatsapp_identity.sql');
    const corpo = s.slice(s.indexOf('function whatsapp_identity_verify'));
    expect(corpo).toMatch(/WHATSAPP_MAX constant integer := 5;/);
    expect(corpo).toMatch(/least\(greatest\(coalesce\(p_max_attempts, WHATSAPP_MAX\), 1\), WHATSAPP_MAX\)/);
    // o caller não consegue mais subir o limite: 999 continua sendo 5
    expect(corpo).not.toMatch(/>= greatest\(p_max_attempts, 1\)/);
    // a RPC antiga de tentativa tem o mesmo teto
    const attempt = s.slice(s.indexOf('function whatsapp_identity_attempt'), s.indexOf('function whatsapp_identity_transition'));
    expect(attempt).toMatch(/least\(greatest\(coalesce\(p_max, 5\), 1\), 5\)/);
  });

  it('o teto do banco é o mesmo do core', async () => {
    const { MAX_TENTATIVAS_CODIGO } = await import('./identidade');
    expect(MAX_TENTATIVAS_CODIGO).toBe(5);
    expect(ler('supabase/migrations/0049_whatsapp_identity.sql')).toMatch(/WHATSAPP_MAX constant integer := 5;/);
  });
});

describe('gate 03: coerência da identidade cobre todas as FKs de profile', () => {
  it('profile_id, worker_id, requested_by e last_actor_id são da organização da linha', () => {
    const s = ler('supabase/migrations/0049_whatsapp_identity.sql');
    const corpo = s.slice(s.indexOf('function whatsapp_identity_coerencia'), s.indexOf('drop trigger if exists whatsapp_identity_coerencia'));
    for (const col of ['profile_id', 'worker_id', 'requested_by', 'last_actor_id']) {
      expect(corpo, col).toMatch(new RegExp(`new\\.${col} is not null and not exists`));
    }
  });
});
