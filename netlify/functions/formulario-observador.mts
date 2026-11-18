// Observador da reconciliação do formulário do site — quem percebe a rodada que falhou em silêncio ou não rodou.
//
// Roda SEPARADO da rodada (`formulario-reconciliar`), lê o histórico de rodadas que ela grava na `audit_log`,
// e registra os alertas: falha de leitura, falha de gravação com HTTP 200, falhas consecutivas, recuperação
// inesperada e rodada ausente. Toda a decisão mora em src/core/radar/formularioMonitor.ts (puro) e
// src/core/radar/formularioObservador.ts (portas injetadas).
//
// DESLIGADO POR PADRÃO: só age com `FORMULARIO_MONITOR = ativo`. Desligado, não lê nem grava nada.
// Canal: `FORMULARIO_ALERTA_CANAL` = `registro` (padrão: linha `RECONCILIACAO_ALERTA` no log) ou `webhook`
// (soma um POST para `FORMULARIO_ALERTA_WEBHOOK_URL`). Nenhuma URL está configurada; nada sai do log hoje.
//
// Frequência: a cada 10 minutos. Com rodadas a cada 10 min, a ausência passa a contar depois de 25 min sem rodada
// e é vista na passada seguinte do observador (entre 25 e 35 min). Não é garantia: o agendador do Netlify, a rede
// e o próprio observador podem atrasar.
import { canalDoAmbiente } from '../../src/core/radar/formularioAlertaCanais';
import { observar } from '../../src/core/radar/formularioObservador';

const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify(t)); } catch { /* ignore */ } };

export default async (): Promise<Response> => {
  const r = await observar(process.env, {
    fetch,
    agoraIso: () => new Date().toISOString(),
    canal: canalDoAmbiente(process.env, fetch, log),
    log,
  });
  return new Response(JSON.stringify(r), {
    status: r.desfecho === 'concluida' || r.desfecho === 'desligado' ? 200 : 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};

export const config = { schedule: '*/10 * * * *' };
