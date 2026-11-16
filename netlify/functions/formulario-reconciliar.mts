// Reconciliação do formulário do site — a rede de segurança, a cada 10 minutos.
//
// O evento de submissão do Netlify NÃO tem reenvio automático: se a função do site falhar, a submissão fica só
// no painel de formulários e nada chega ao CRM, sem erro visível. Esta função agendada lê a API oficial de
// submissões verificadas e grava o que ainda não entrou, pelo MESMO caminho de escrita do webhook e com a mesma
// chave de idempotência (o id da submissão). Sem submissão nova, não escreve nada.
//
// Toda a decisão mora em src/core/radar/formularioAgendado.ts, com `fetch`, ambiente e relógio injetados; aqui
// ficam só o ambiente real e o horário. `*/10 * * * *` (UTC) só vale em deploy publicado; era `@hourly` até a
// E10.17 (decisão D2). O limite de 30 s por execução fica muito abaixo do intervalo, então duas rodadas não se
// sobrepõem pelo agendador; uma execução manual («Run now») simultânea não duplica nada (índice único da
// evidência e da mensagem).
//
// DESLIGADA POR PADRÃO, em duas chaves: `FORMULARIO_RECONCILIACAO` tem de valer exatamente `ativa`, e
// `EIFF_FORM_MARCO` tem de trazer o instante da ativação — sem marco a rodada não começa, porque um marco
// padrão errado processaria lead real. Submissão anterior ao marco é SEMPRE retida: esta função não tem como
// liberá-la (só o script, com duas confirmações explícitas).
//
// Limite de 30 s da plataforma: a rodada para no teto do lote ou no tempo restante e devolve `restam`. O que
// ficou de fora volta na próxima rodada, e entrar duas vezes não duplica nada.
//
// Log: uma linha `RECONCILIACAO_AGENDADA` com números, motivos e instantes. Nunca conteúdo de lead, nunca
// segredo. Segredos só no painel do Netlify: NETLIFY_AUTH_TOKEN (leitura de submissões), SUPABASE_SERVICE_ROLE_KEY.
import { corpoDaResposta, rodadaDeReconciliacao } from '../../src/core/radar/formularioAgendado';
import { registrarRodada } from '../../src/core/radar/formularioObservador';

const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify(t)); } catch { /* ignore */ } };

export default async (): Promise<Response> => {
  const r = await rodadaDeReconciliacao(process.env, {
    fetch,
    agora: () => Date.now(),
    agoraIso: () => new Date().toISOString(),
    log,
  });
  // Monitor (desligado por padrão, `FORMULARIO_MONITOR = ativo`): guarda o registro da rodada para o observador.
  // Nunca lança e nunca muda a resposta da rodada.
  await registrarRodada(process.env, r, { fetch, log });
  return new Response(JSON.stringify(corpoDaResposta(r)), {
    // A plataforma não usa o corpo; ele existe para o «Run now» do painel e para `functions:invoke`.
    status: r.desfecho === 'concluida' || r.desfecho === 'desligada' ? 200 : 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};

export const config = { schedule: '*/10 * * * *' };
