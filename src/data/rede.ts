// Classificacao de falhas de sincronizacao: erro de rede (fica pendente e tenta de novo sozinho) x erro de regra/conflito
// (mostra ao usuario). Funcao pura para ser testada sem navegador.
export function ehErroDeRede(e: unknown, onLine: boolean | undefined = typeof navigator !== 'undefined' ? navigator.onLine : undefined): boolean {
  if (onLine === false) return true;
  const m = String((e as { message?: unknown })?.message ?? e ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|err_connection|timeout|timed out|ECONNRESET|ENOTFOUND|AbortError/i.test(m);
}
