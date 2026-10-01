-- FIN-RESET-01 · EXECUÇÃO (ESCREVE EM PRODUÇÃO). Só rodar depois da frase exata do Augusto: RESET FINANCEIRO AUTORIZADO.
--
-- Pré-requisitos (ver docs/fin-reset-01.md): app com o hotfix de identidade publicado; 0061 aplicada; navegador do
-- Augusto sem pendência de sincronização e com todas as abas do EIFF Control fechadas; esperado.sql rodado de novo e
-- IGUAL ao p_esperado abaixo (se mudou, atualizar aqui e reaprovar).
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/fin-reset/executar.sql
--
-- Uma chamada, uma transação: qualquer divergência da lista fechada ou pós-condição falhando = RAISE e nada é gravado.
-- p_esperado = retrato de produção em 01/10/2026 (precheck): 441 transações ativas (277 CTA-001 + 164 CTA-002),
-- 44 lançamentos gerados do extrato (43 'extrato' + REC-0060 'ofx'; PAG-0056 incluído — Realizado sem liquidação),
-- 0 títulos pré-existentes conciliados, 8 conciliações, 43 liquidações = 79.057,75.
begin;
select fin_reset_extrato(
  (select id from organization where code = 'EIFF'),
  'FIN-RESET-01',
  'Recomeçar a conciliação bancária do zero: os OFX serão baixados de novo e importados manualmente, cada um na conta certa (decisão do Augusto em 01/10/2026).',
  (select p.id from profile p join organization o on o.id = p.organization_id where o.code = 'EIFF' and p.email = 'augusto@eiff.com.br'),
  '{"transacoes": 441,
    "transacoes_md5": "291a38687df69b0efcc894162d7a62d6",
    "derivados": ["PAG-0043","PAG-0044","PAG-0045","PAG-0046","PAG-0047","PAG-0048","PAG-0049","PAG-0050","PAG-0051","PAG-0052","PAG-0053","PAG-0054","PAG-0055","PAG-0056","PAG-0061","PAG-0062","PAG-0063","PAG-0064","PAG-0065","PAG-0066","PAG-0067","PAG-0068","PAG-0069","PAG-0070","PAG-0071","PAG-0072","PAG-0073","PAG-0074","PAG-0075","PAG-0076","PAG-0077","PAG-0078","PAG-0079","PAG-0080","PAG-0081","PAG-0082","PAG-0083","PAG-0084","PAG-0085","PAG-0086","PAG-0087","PAG-0088","PAG-0089","REC-0060"],
    "manter": [],
    "preexistentes": [],
    "conciliacoes": 8,
    "liquidacoes": 43,
    "liquidacoes_valor": 79057.75}'::jsonb
) as resultado;
commit;
