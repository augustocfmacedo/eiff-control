# Implantação no Supabase

Projeto: `https://dduobppgomqyagjviwpx.supabase.co`

## 1. Criar o banco (uma vez)

1. No painel do Supabase abra **SQL Editor › New query**.
2. Cole todo o conteúdo de `supabase/deploy.sql` e clique em **Run**. O arquivo contém o schema, as views de KPI, as
   políticas de segurança e a carga inicial migrada da planilha. Ele é idempotente na carga, mas o schema só pode ser
   executado uma vez; se precisar recriar, apague o projeto ou as tabelas antes.
3. Confira em **Table Editor** que existem 43 linhas em `chart_account`, 1 em `project` e 41 em `financial_entry`.

Para regenerar `deploy.sql` depois de alterar migrations ou a planilha:

```bash
npm run migrate:planilha
node scripts/build-deploy-sql.mjs
```

## 2. Criar os usuários

1. **Authentication › Users › Add user**: crie cada pessoa com e-mail e senha inicial (marque "Auto confirm").
2. Edite `supabase/seed_profiles.sql` com a lista real de nomes, e-mails e papéis (DEC-02) e execute no SQL Editor.
   Esse passo liga cada login a um papel e ao escopo de empresa/obra usado pelas políticas de segurança.
3. Para Administrador, Diretoria e Financeiro habilite MFA em **Authentication › Providers › Multi-factor**.

## 3. Conectar o aplicativo

1. **Project Settings › API**: copie a **anon public key** para `VITE_SUPABASE_ANON_KEY` no arquivo `.env`.
   A chave anônima é pública por desenho; a segurança vem das políticas RLS. Nunca coloque a `service_role` no app.
2. Rode `npm run dev` e faça login. O seletor de usuário some; o nome e o papel vêm da sessão.
3. O topo da tela mostra o estado da sincronização. Em caso de erro, os dados ficam na tela e o botão
   **Tentar de novo** reenvia as alterações pendentes.

## 4. Publicar para a equipe

Opção simples: `npm run build` gera a pasta `dist/`, que pode ser hospedada no Vercel, Netlify ou Cloudflare Pages
com as duas variáveis de ambiente configuradas no painel do provedor. Em **Authentication › URL Configuration** informe a
URL pública como Site URL.

## 5. Backup e operação

- Plano Free: sem backup automático; exporte periodicamente por **Database › Backups** ou pelo botão Exportar JSON do app.
- Plano Pro: backups diários com retenção de 7 dias e restauração pelo painel.
- `audit_log` guarda toda alteração com antes/depois, feita pelo app ou por trigger.
- Power BI: crie um usuário de leitura no banco e dê acesso apenas ao schema `mart` (instruções no fim de `0003_rls.sql`).

## O que muda em relação ao modo local

| | Local | Supabase |
| --- | --- | --- |
| Onde ficam os dados | navegador de uma pessoa | PostgreSQL na nuvem, compartilhado |
| Login | seletor de usuário demonstrativo | e-mail e senha, MFA opcional |
| Permissões | aplicadas só na tela | aplicadas também no banco por RLS |
| Regras críticas | camada de dados do app | app + triggers e funções do banco |
| Backup | Exportar JSON manual | automático no plano Pro, mais export |
