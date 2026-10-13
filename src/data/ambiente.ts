// Configuracao publica do Supabase do APLICATIVO (URL e chave anonima, substituidas pelo Vite no build). Importado SO pela
// entrada do app (main.tsx), antes de qualquer outro modulo: assim src/data/supabase.ts nao le import.meta.env e pode ser
// reaproveitado pelas funcoes do servidor (que nunca podem alcancar import.meta.env — guarda em developmentStatus.test.ts).
// Sem este modulo (testes, servidor) o app fica em modo local.
(globalThis as { __EIFF_SUPABASE__?: { url?: string; chave?: string } }).__EIFF_SUPABASE__ = {
  url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  chave: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
};
