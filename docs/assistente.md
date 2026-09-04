# Assistente com IA e e-books

## O que é

- **Assistente** (botão flutuante no canto inferior direito): chat que responde como fazer algo no sistema, o que uma regra
  significa e o que fazer a seguir, citando a tela e a lição. Usa o conhecimento em `src/core/assistente.ts`
  (regras, lições, processos, rotinas e setores). Sem a IA configurada, responde pesquisando o manual localmente.
- **E-books** (Capacitação › E-books): manual por setor e manual completo, gerados na hora a partir do mesmo conteúdo
  (`src/core/ebook.ts`). Abrir e usar "Imprimir › Salvar como PDF" para distribuir.

## Ligar a IA no Netlify (feito pelo administrador)

1. Crie uma chave em https://console.anthropic.com (Settings › API keys).
2. No Netlify: Site configuration › Environment variables › Add a variable:
   - `ANTHROPIC_API_KEY` = a chave (marque como *secret*).
   - `ANTHROPIC_MODEL` (opcional) = modelo; padrão `claude-sonnet-5`.
   - `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são opcionais: sem elas a função usa o projeto fixo da EIFF e a chave
     pública que o próprio app envia (o site é publicado já compilado, então essas variáveis normalmente não estão no Netlify).
3. Publique de novo (`npx netlify deploy --prod --dir dist` ou push). A função fica em `/api/assistente`.
4. Abra o sistema, clique no assistente e pergunte algo: a etiqueta muda de "manual local" para "IA".

A chave nunca vai para o navegador: a função `netlify/functions/assistente.ts` roda no servidor, valida o token do
usuário no Supabase Auth (só usuários logados usam a IA) e lê o papel real do perfil. O conhecimento do sistema é enviado
com cache de prompt para reduzir custo. Cada resposta usa até 1.024 tokens.

## Manter o conteúdo

O assistente e os e-books leem `src/core/capacitacao.ts` (lições, trilhas, processos, rotinas) e `src/core/ebook.ts`
(introduções, conceitos e perguntas por setor). Ao mudar uma regra de negócio no `store.ts`, revise a lição e o setor
correspondentes; os testes `capacitacao.test.ts` e `ebook.test.ts` garantem rotas válidas e cobertura, não o texto.
