// /api/formulario-site — a submissão do formulário publicado em eiff.com.br entra no EIFF Controle.
//
// O que ela faz: autentica, traduz a submissão do Netlify, decide pelo core (`planejarGravacao`) e GRAVA —
// evidência no Lead Engine (radar_source_record, PENDING, sem entidade) e conversa no EIFF Inbox (visível na
// hora, sem exigir empresa nem CNPJ). Só devolve sucesso do que o banco confirmou.
//
// O que ela NÃO faz: não promove empresa, não cria contato do Radar, não cria oportunidade, não envia nada,
// não chama o motor estrutural. A decisão comercial segue humana, na aba Candidatos.
//
// Transporte (verificado em 09/11/2026): a notificação nativa do Netlify Forms NÃO aceita cabeçalho próprio,
// então quem chama aqui é uma função server-side do próprio site (evento formSubmitted / submission-created),
// que acrescenta `x-eiff-form-secret`. O reconciliador (scripts/formulario-reconciliar.mts) usa o MESMO
// endpoint com o mesmo segredo — e é ele a garantia de que nada se perde, porque o evento do Netlify não
// tem reenvio automático.
//
// Segredos só no painel do Netlify: EIFF_FORM_SECRET, SUPABASE_SERVICE_ROLE_KEY. Nunca VITE_, nunca em log.
import { autorizar, validarCorpo } from '../../src/core/radar/formularioServidor';
import { corpoDaSubmissaoNetlify } from '../../src/core/radar/formularioTransporte';
import { gravarSubmissao, ErroDeGravacao } from '../../src/core/radar/formularioGravacao';
import { configPortaFormulario, portasFormularioRest } from '../../src/core/radar/formularioPorta';
import { FORMULARIOS } from '../../src/core/radar/formularioSite';
import { montarPortasInbox } from '../../src/core/inbox/ativacao';

/** Só os formulários que o Radar conhece entram no CRM: o catálogo é um só. */
const FORMULARIOS_ACEITOS = FORMULARIOS;

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
// Log sem payload: identificador, impressão e resultado. O conteúdo do lead vive no banco, não no log.
const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify({ evento: 'formulario_site', ...t })); } catch { /* ignore */ } };

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_suportado' }, 405);

  const cabecalhos: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => { cabecalhos[k.toLowerCase()] = v; });

  const auth = autorizar(cabecalhos, process.env.EIFF_FORM_SECRET);
  if (!auth.ok) {
    // 401 nos dois casos: quem chama não precisa saber se o segredo existe no servidor.
    log({ resultado: 'recusado', motivo: auth.motivo });
    return json({ erro: 'nao_autorizado' }, 401);
  }

  let bruto: unknown;
  try { bruto = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }

  const traduzido = corpoDaSubmissaoNetlify(bruto, { formulariosAceitos: FORMULARIOS_ACEITOS });
  if (!traduzido.ok) {
    // Submissão que não vira lead (spam, honeypot, formulário de outra coisa) é IGNORADA com 200:
    // devolver erro faria o remetente insistir num caso que nunca vai mudar.
    log({ resultado: 'ignorada', motivo: traduzido.motivo });
    return json({ resultado: 'IGNORADA', motivo: traduzido.motivo });
  }

  const corpo = validarCorpo(traduzido.corpo);
  if (!corpo.ok) {
    log({ resultado: 'invalido', motivo: corpo.motivo, campo: corpo.detalhe ?? null });
    return json({ erro: corpo.motivo, campo: corpo.detalhe ?? null }, 400);
  }

  // Ligação com o banco: a mesma configuração do Inbox (organização + chave de serviço) mais a fonte WEBSITE.
  const cfg = configPortaFormulario(process.env);
  if ('motivo' in cfg) {
    log({ resultado: 'nao_configurada', motivo: cfg.motivo });
    return json({ erro: 'integracao_nao_configurada', motivo: cfg.motivo }, 503);
  }
  // A conversa continua sendo gravada pela porta do Inbox (RPC inbox_ingest) e roteada pelo Octopus Router —
  // os mesmos que a EIFF Central usa, com os mesmos kill switches. Sem segundo mecanismo.
  const inbox = montarPortasInbox(process.env, { fetch, log });
  if (!inbox.ligado) {
    log({ resultado: 'nao_configurada', motivo: `inbox: ${inbox.motivo}` });
    return json({ erro: 'integracao_nao_configurada', motivo: `inbox: ${inbox.motivo}` }, 503);
  }

  const portas = {
    ...portasFormularioRest(cfg, fetch, log),
    ingerir: inbox.portas.ingerir,
    ...(inbox.portas.rotear !== undefined ? { rotear: inbox.portas.rotear } : {}),
  };

  try {
    const r = await gravarSubmissao(corpo.submissao, cfg.fonteId, cfg.organizacaoId, portas);
    log({
      resultado: r.resultado, externoId: r.externoId, impressao: r.payloadFingerprint.slice(0, 16),
      passos: r.passos, registro: r.registroFonteId, thread: r.threadId ?? null,
      contato: r.contatoId ?? null, completado: r.contatoCompletado?.campos ?? [], roteada: r.roteada?.aplicado ?? null,
    });
    return json({
      resultado: r.resultado, externoId: r.externoId, passos: r.passos,
      registroFonteId: r.registroFonteId, threadId: r.threadId ?? null, novaConversa: r.novaConversa,
    });
  } catch (e) {
    // Gravação exigida que não foi confirmada: 5xx, nada de sucesso. Quem chamou reenvia e o plano COMPLETA
    // o que faltou — e, se ninguém reenviar, o reconciliador traz a submissão de volta sem duplicar.
    const etapa = e instanceof ErroDeGravacao ? e.etapa : 'desconhecida';
    log({ resultado: 'falhou', etapa, motivo: (e as Error).message ?? 'erro' });
    return json({ erro: 'gravacao_falhou', etapa }, 502);
  }
};

export const config = { path: '/api/formulario-site' };
