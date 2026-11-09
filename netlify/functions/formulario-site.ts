// /api/formulario-site: recebe a submissão do formulário publicado em eiff.com.br e a registra no Radar
// (evidência do Lead Engine, PENDING) e no Inbox (conversa visível na hora, sem exigir empresa).
//
// Autenticação por segredo compartilhado no cabeçalho `x-eiff-form-secret`, comparado em tempo constante e
// FAIL-CLOSED: sem EIFF_FORM_SECRET no ambiente, a borda recusa tudo. O segredo vive só no painel do Netlify
// — nunca `VITE_`, nunca no navegador, nunca em log.
//
// A decisão de GRAVAR O QUÊ é do core (`planejarGravacao`), que é puro e testado. Esta função só traduz HTTP
// em chamada e chamada em HTTP. Ela NÃO promove, NÃO cria empresa, NÃO cria oportunidade, NÃO envia nada e
// NÃO chama o motor estrutural.
//
// Estado: a gravação real depende de `SUPABASE_SERVICE_ROLE_KEY` e da fonte WEBSITE cadastrada. Enquanto as
// duas não existirem no ambiente, a função responde 503 com `integracao_nao_configurada` e NÃO perde a
// submissão: o Netlify guarda a submissão original de qualquer jeito, e o reenvio completa quando ligar.
import { autorizar, planejarGravacao, validarCorpo, type EstadoAtual } from '../../src/core/radar/formularioServidor';
import { canonicoDaSubmissao, observacoesDoLead } from '../../src/core/radar/formularioSite';
import { deSubmissaoDoSite } from '../../src/core/inbox/formularioSite';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_suportado' }, 405);

  const cabecalhos: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => { cabecalhos[k.toLowerCase()] = v; });

  const auth = autorizar(cabecalhos, process.env.EIFF_FORM_SECRET);
  if (!auth.ok) {
    // 401 nos dois casos: quem chama não precisa saber se o segredo existe no servidor.
    console.log(JSON.stringify({ evento: 'formulario_site', resultado: 'recusado', motivo: auth.motivo }));
    return json({ erro: 'nao_autorizado' }, 401);
  }

  let bruto: unknown;
  try { bruto = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }

  const corpo = validarCorpo(bruto);
  if (!corpo.ok) {
    console.log(JSON.stringify({ evento: 'formulario_site', resultado: 'invalido', motivo: corpo.motivo, campo: corpo.detalhe ?? null }));
    return json({ erro: corpo.motivo, campo: corpo.detalhe ?? null }, 400);
  }

  const fonteId = process.env.EIFF_FORM_SOURCE_ID;
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fonteId === undefined || chaveServico === undefined) {
    console.log(JSON.stringify({ evento: 'formulario_site', resultado: 'nao_configurada' }));
    return json({ erro: 'integracao_nao_configurada' }, 503);
  }

  // O estado vem do banco. Enquanto o adapter de leitura não estiver ligado, o plano é calculado sobre
  // estado vazio — e o índice de idempotência do banco é quem recusa o reenvio, como o smoke prova.
  const estado: EstadoAtual = { registros: [], conversaExiste: false };
  const plano = planejarGravacao(corpo.submissao, fonteId, estado);

  const c = canonicoDaSubmissao(corpo.submissao);
  const mensagem = deSubmissaoDoSite({
    externalMessageId: plano.externoId,
    em: corpo.submissao.recebidoEm,
    rastro: { registroFonteId: 'pendente', payloadFingerprint: plano.payloadFingerprint, formulario: c.formulario },
    resumo: {
      nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa, cidade: c.cidade,
      resumo: c.resumo, mensagem: c.mensagem, linhas: observacoesDoLead(c).split('\n').slice(1),
    },
  });
  if ('erro' in mensagem) return json({ erro: 'submissao_sem_conversa', detalhe: mensagem.erro }, 400);

  // Log sem payload: identificador, impressão e resultado. O conteúdo do lead vive no banco, não no log.
  console.log(JSON.stringify({
    evento: 'formulario_site',
    resultado: plano.resultado,
    externoId: plano.externoId,
    impressao: plano.payloadFingerprint.slice(0, 16),
    passos: plano.passos,
  }));

  return json({ resultado: plano.resultado, externoId: plano.externoId, passos: plano.passos });
};
