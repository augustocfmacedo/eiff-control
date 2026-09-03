# Publicação automática (GitHub → Netlify)

Objetivo: cada alteração no código vai ao ar em `https://eiffcontrol.com.br` sem rodar `netlify deploy` na mão.

## Uma vez só

1. **Criar o repositório no GitHub**: em `https://github.com/new`, nome `eiff-control`, privado. Não marque README nem .gitignore.
2. **Enviar o código** (o repositório local já está pronto com o primeiro commit). No PowerShell, na pasta do projeto, troque `SEU-USUARIO` pelo seu usuário do GitHub:

   ```bash
   git remote add origin https://github.com/SEU-USUARIO/eiff-control.git
   git push -u origin main
   ```

   O Windows vai abrir a janela de login do GitHub na primeira vez.
3. **Conectar o Netlify ao repositório**: no painel do site `eiff-control`, em **Site configuration › Build & deploy › Continuous deployment › Link repository**, escolha GitHub, autorize e selecione `eiff-control`. Branch `main`. O comando de build e a pasta já vêm do `netlify.toml`.
4. **Variáveis de ambiente**: em **Site configuration › Environment variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os mesmos valores do seu `.env`. O `.env` não vai para o GitHub.
5. Clique em **Trigger deploy**. Em 1 a 2 minutos o site novo está no ar.

## Depois disso

- Quando eu terminar uma melhoria, faço o commit e o push; o Netlify publica sozinho e você recebe e-mail se o build falhar.
- O histórico de versões fica no GitHub e no painel Deploys do Netlify, onde é possível voltar a uma versão anterior com um clique.
- Migrations do banco continuam sendo aplicadas por mim pela CLI do Supabase; elas ficam versionadas no mesmo repositório em `supabase/migrations`.
