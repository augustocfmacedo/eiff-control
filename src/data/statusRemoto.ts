// Cliente do `/api/development-status` — polling conservador, cancelável e que nunca perde o último dado.
//
// O NAVEGADOR NÃO CONHECE O GITHUB. Ele chama exclusivamente o endpoint interno; nenhuma peça da interface
// fala com a API do GitHub nem conhece o token de leitura — que existe só na função Netlify. Um teste varre
// `src/` para garantir isso, inclusive contra menção do nome da variável.
//
// Regras deste cliente:
//   - intervalo de 60 s (GitHub não é heartbeat de worker; 1, 2 ou 5 s seria pressão inútil sobre a API);
//   - uma chamada por vez: nunca há duas em voo (guarda explícita);
//   - AbortController em toda chamada e cancelamento no unmount;
//   - erro aumenta o intervalo (backoff) até um teto, e o último dado válido CONTINUA na tela, marcado;
//   - em modo local (sem Supabase) nem chega a chamar: devolve a fonte como não configurada.
import { useCallback, useEffect, useState } from 'react';
import { tokenSessao } from './supabase';
import type { DevelopmentStatusResposta } from '../core/central/statusServidor';

/** Intervalo normal entre leituras. Conservador de propósito. */
export const INTERVALO_STATUS_MS = 60_000;
/** Depois de uma falha, o intervalo dobra a cada tentativa até este teto. */
export const INTERVALO_MAXIMO_MS = 300_000;
export const CAMINHO_STATUS = '/api/development-status';

export const CODIGOS_CLIENTE = ['SEM_SESSAO', 'NAO_AUTORIZADO', 'REDE', 'RESPOSTA_INVALIDA', 'SERVIDOR'] as const;
export type CodigoCliente = (typeof CODIGOS_CLIENTE)[number];

export const TEXTO_CODIGO_CLIENTE: Readonly<Record<CodigoCliente, string>> = {
  SEM_SESSAO: 'Sem sessão no Supabase: o estado ao vivo não está disponível neste modo.',
  NAO_AUTORIZADO: 'Seu perfil não tem permissão para ver o estado da construção.',
  REDE: 'Não foi possível falar com o servidor.',
  RESPOSTA_INVALIDA: 'O servidor respondeu num formato inesperado.',
  SERVIDOR: 'O servidor não conseguiu responder agora.',
};

export interface EstadoStatusRemoto {
  /** último dado VÁLIDO; permanece na tela mesmo quando a leitura seguinte falha */
  dados: DevelopmentStatusResposta | null;
  /** quando o último dado válido chegou */
  recebidoEm: string | null;
  carregando: boolean;
  erro: CodigoCliente | null;
  /** quantas falhas seguidas — alimenta o backoff e a mensagem */
  falhasSeguidas: number;
}

const ehResposta = (x: unknown): x is DevelopmentStatusResposta => {
  const o = x as Partial<DevelopmentStatusResposta> | null;
  return !!o && typeof o === 'object' && typeof o.observadoEm === 'string' && Array.isArray(o.workItems) && !!o.fontes;
};

/** Uma leitura. Exportada para teste: recebe o token e o `fetch`, e não depende de React. */
export async function lerStatusRemoto(
  token: string | null,
  f: typeof fetch,
  sinal?: AbortSignal,
): Promise<{ dados: DevelopmentStatusResposta } | { erro: CodigoCliente }> {
  if (!token) return { erro: 'SEM_SESSAO' };
  let r: Response;
  try {
    r = await f(CAMINHO_STATUS, { headers: { authorization: `Bearer ${token}` }, signal: sinal });
  } catch {
    return { erro: 'REDE' };
  }
  if (r.status === 401 || r.status === 403) return { erro: 'NAO_AUTORIZADO' };
  if (!r.ok) return { erro: 'SERVIDOR' };
  const corpo = await r.json().catch(() => null);
  if (!ehResposta(corpo)) return { erro: 'RESPOSTA_INVALIDA' };
  return { dados: corpo };
}

/** Intervalo da próxima leitura: normal quando deu certo, dobrando a cada falha até o teto. */
export const proximoIntervalo = (falhasSeguidas: number): number =>
  Math.min(INTERVALO_MAXIMO_MS, INTERVALO_STATUS_MS * Math.max(1, 2 ** falhasSeguidas));

/**
 * Hook do painel. `ativo = false` desliga o polling inteiro (tela sem permissão, modo campo, impressão).
 */
export function useStatusRemoto(ativo: boolean): EstadoStatusRemoto & { recarregar: () => void } {
  const [estado, setEstado] = useState<EstadoStatusRemoto>({ dados: null, recebidoEm: null, carregando: false, erro: null, falhasSeguidas: 0 });
  const [recarga, setRecarga] = useState(0);
  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    if (!ativo) return;
    // Estado do CICLO vive dentro do efeito, não em refs: cada montagem tem o seu. Com refs
    // compartilhadas, a remontagem do StrictMode deixava `emVoo` travado e o painel ficava em "Lendo…"
    // para sempre — defeito encontrado ao renderizar a tela de verdade.
    let cancelado = false;
    let emVoo = false;
    let falhas = 0;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;

    const ciclo = async (): Promise<void> => {
      if (cancelado || emVoo) return; // nunca duas chamadas sobrepostas
      emVoo = true;
      setEstado((e) => ({ ...e, carregando: true }));
      ctrl = new AbortController();
      let token: string | null;
      try { token = await tokenSessao(); } catch { token = null; }
      const r = await lerStatusRemoto(token, fetch, ctrl.signal);
      emVoo = false;
      if (cancelado) return;

      falhas = 'dados' in r ? 0 : falhas + 1;
      setEstado((e) => ('dados' in r
        ? { dados: r.dados, recebidoEm: new Date().toISOString(), carregando: false, erro: null, falhasSeguidas: 0 }
        // o último dado válido CONTINUA: falha não apaga o que já se sabia
        : { ...e, carregando: false, erro: r.erro, falhasSeguidas: falhas }));

      timer = window.setTimeout(() => { void ciclo(); }, proximoIntervalo(falhas));
    };

    void ciclo();
    return () => {
      cancelado = true;
      ctrl?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [ativo, recarga]);

  return { ...estado, recarregar };
}
