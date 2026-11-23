# Segurança — credenciais privilegiadas em deploys não produtivos do CRM

Registro específico vinculado à issue #99, criado em 23/11/2026 por decisão da Direção. Não altera o escopo da #99.

**Situação:** **plano para aprovação.** Nesta etapa a Direção autorizou só leitura, análise e documentação, e nada foi
executado. Os valores das variáveis não foram lidos, impressos nem gravados em lugar nenhum: o inventário registrou só
nomes, contextos, se o valor está vazio e as datas.

## 1. Resumo executivo

- **O que é.** Durante cerca de dois meses, os deploys de preview do CRM rodaram com a **chave de serviço do banco de
  produção** (`SUPABASE_SERVICE_ROLE_KEY`) e com as demais chaves privilegiadas. Cada deploy guarda as variáveis do
  momento em que foi construído e continua acessível em endereço público.
- **O que já mudou.** Os valores fora de production foram **esvaziados entre 16/11 e 17/11/2026**. Os previews
  construídos desde 17/11 01:27 UTC já nascem **sem** a chave de serviço, comprovado em execução. O texto da #99 (18/11)
  descreve a existência das variáveis nesses contextos, mas elas já estavam vazias.
- **O que continua exposto.** **73 deploys de preview com a chave de serviço, ainda no ar**, construídos de 14/10 a
  16/11 para 37 PRs. Outros 110 previews anteriores a 14/10 não puderam ser medidos e devem ser tratados como expostos.
- **Comprometimento.** **Nenhuma evidência de uso indevido** nas fontes que pudemos ler. É **exposição potencial, não
  comprometimento comprovado**. A ausência de evidência é limitada: os logs do Supabase e das funções do Netlify não
  foram lidos (seção 4).
- **Gravidade proposta:** **ALTA.** A chave dá acesso total ao banco de produção e ignora RLS. A probabilidade de uso
  indevido é baixa: o repositório só recebe código do dono, os PRs de fork exigem aprovação e não há sinal de uso.
- **Recomendação:**
  1. apagar os previews antigos;
  2. manter os novos previews sem segredo;
  3. **rotacionar a chave de serviço** numa janela própria;
  4. rotacionar as chaves de terceiros de baixo custo.

  Cada passo depende de autorização da Direção (seção 9).

## 2. Estado atual e evidências (leitura de 23/11/2026)

### 2.1 Projeto Netlify `eiff-control`

| Item | Valor |
|---|---|
| Repositório | `augustocfmacedo/eiff-control`, **público** |
| Autores de PR na história | só o dono. **Nenhum PR de fork** em 300 PRs |
| Deploy previews | **ligados** (`skip_prs` nulo) |
| Branch deploys | só `main` (`allowed_branches = [main]`), sem branch deploy de outra branch |
| PR de fork | `untrusted_flow = review`: o deploy de fork exige aprovação |
| Senha nos previews | **nenhuma** (`has_password = false`) |
| Logs de build | `private_logs` nulo, então podem ser públicos num repositório público. O Netlify mascara variáveis marcadas como segredo |
| Retenção de deploys | **90 dias**: deploys mais antigos que isso são apagados pela plataforma |
| Publicado | `6aff669c` (`213887d`), travado |

### 2.2 Variáveis privilegiadas por contexto

Nenhum valor foi lido. "Vazio" quer dizer que o contexto existe, mas sem valor.

| Variável | Segredo | Production | Deploy-preview / branch-deploy / dev | Última alteração |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | sim | com valor | **vazio** (provado em execução, 2.3) | 17/11 00:32 UTC |
| `VIBE_API_KEY` | sim | com valor | vazio | 17/11 00:21 UTC |
| `GITHUB_READ_TOKEN` | sim | com valor | vazio | 16/11 23:54 UTC |
| `GOOGLE_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | sim | com valor | vazio | 16/11 16:01–16:02 UTC |
| `EIFF_FORM_SECRET` (vaga A) | sim | com valor | vazio | 10/11 16:55 UTC |
| `EIFF_FORM_SECRET_B` (vaga B) | sim | só production | — | 19/11 21:13 UTC |
| `ANTHROPIC_API_KEY` | sim | a API devolve vazio **também** em production. Não conclusivo: não se sabe se a chave está ausente ou mascarada | vazio | 04/09 |
| `EIFF_INBOX_*`, `EIFF_FORM_SOURCE_ID` | não | só production | — | — |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | não | todos os contextos | idem | públicos por desenho |

As datas são da última alteração de cada variável. A coincidência com 2.3 mostra que o esvaziamento dos contextos não
produtivos ocorreu nessas datas. **Não está registrado quem o fez**: o log de auditoria da conta Netlify não foi lido.

### 2.3 Deploys ainda acessíveis e quais carregam a chave

O inventário cobriu **414 deploys** no ar (229 de preview e 185 de production), de 11/09 a 19/11.

**Como foi medido:** um GET **sem credencial** em `/api/widget-caixa` no endereço permanente de cada deploy. Essa função
responde `501 nao_configurado` quando o deploy **não** tem `SUPABASE_SERVICE_ROLE_KEY`, e `401 token_ausente` quando tem.
A sonda não envia token nem corpo e não grava nada.

| Grupo | Deploys | Período | Chave de serviço |
|---|---|---|---|
| Preview **com** a chave | **73** (37 PRs) | 14/10 03:24 → 16/11 23:34 | **sim** |
| Preview **sem** a chave | 46 | 17/11 01:27 → 19/11 16:12 | não |
| Preview sem a função do widget | 110 | 11/09 → 14/10 00:56 | **não medido**: tratar como exposto |
| Production com a chave | 39, entre eles o publicado | 14/10 → 19/11 | sim, legítimo; 22 nunca publicados |
| Production sem a função do widget | 146 | antes de 14/10 | não medido; legítimo |

Os deploys de production têm a chave por desenho. O ponto de atenção é outro: os endereços permanentes deles continuam
executando **versões antigas** das funções, inclusive anteriores a correções de segurança, como as do PR #76.

**Vazamento em arquivo público:** os arquivos `.js` públicos dos deploys com a chave foram varridos em busca da
assinatura de um JWT `service_role`. Resultado em 2.4.

### 2.4 Busca da chave nos arquivos públicos

Foram varridos os `.js` públicos dos 73 previews com a chave e dos 3 deploys de production mais recentes. A busca
procurou o papel `service_role` em base64url nos três alinhamentos e decodificou todo JWT encontrado. Resultado:
**nenhuma assinatura de chave de serviço em nenhum dos 76 deploys** (de 49 a 52 arquivos por deploy). As variáveis sem prefixo `VITE_` não entram no pacote do navegador. O Netlify também marca essas
variáveis como segredo e tem varredura de segredos no build.

## 3. Avaliação de risco

**Acesso ao banco de produção.** A chave de serviço ignora RLS e lê e grava tudo. Nos previews antigos ela fica dentro
das funções e não é devolvida por nenhuma delas. Explorar isso exige uma das duas condições:
- **(a)** uma função antiga que use a chave sem autenticar antes. As funções atuais autenticam antes: JWT, token do
  widget, segredo do formulário ou assinatura da Meta. Nas versões antigas e no código de PRs não revisados, isso não foi
  auditado item a item;
- **(b)** vazamento do valor. Nenhum foi encontrado nos arquivos públicos (2.4), e os logs de build mascaram segredos.

**Probabilidade:**
- baixa para código malicioso: só o dono faz push, nunca houve PR de fork e fork exige aprovação;
- moderada para defeito em código antigo: 73 versões de funções com a chave seguem acessíveis em endereços estáveis.

**Serviços externos:**

| Chave | O que um terceiro faria com ela | Sinal de uso lido |
|---|---|---|
| `VIBE_API_KEY` | consumo de créditos pagos | **nenhuma** operação no ledger `radar_vibe_operation` |
| Google OAuth (refresh token) | enviar e-mail como a conta comercial | não lido. Conferir na conta Google (seção 4) |
| `ANTHROPIC_API_KEY` | consumo de tokens | não lido. Conferir no console da Anthropic |
| `GITHUB_READ_TOKEN` | leitura do repositório, que já é público | baixo impacto |
| `EIFF_FORM_SECRET` (vaga A) | enviar lead falso ao CRM | sai na J6 (P1) |

## 4. Exposição potencial × comprometimento comprovado

**Lido, sem sinal de uso indevido:**
- nenhum usuário do Auth criado desde 14/10;
- só 3 perfis (2 Administradores e 1 Solicitante);
- os tokens de widget foram criados em 14/10, na implantação conhecida;
- a auditoria desde 14/10 tem só as fontes esperadas (`app` 335, `db` 762, `rpc` 2), e nenhuma de `usuarios`;
- o ledger da Vibe está vazio;
- não apareceu nenhuma assinatura de chave nos arquivos públicos.

**Não lido** (exigiria credencial de gerenciamento ou painéis de terceiros):
- logs da API do Supabase, por endereço de origem;
- logs das funções dos deploys de preview no Netlify;
- log de auditoria da conta Netlify;
- uso das chaves nos painéis da Anthropic, da Google e da Vibe.

**Conclusão:** exposição potencial, **sem comprometimento comprovado**. Se a leitura de qualquer uma dessas fontes
mostrar uso indevido, isso vira **incidente de segurança** e a rotação passa a ser imediata.

## 5. Alternativas de contenção

| # | Alternativa | Efeito | Custo / dependência | Reversível |
|---|---|---|---|---|
| A | Restringir as credenciais a production | **já está em vigor** desde 17/11 para os novos deploys. Falta só remover os contextos vazios, o que é limpeza | nenhum | sim |
| B | Desligar os previews do CRM (`skip_prs`) | nenhum preview novo é construído | perde a revisão visual dos PRs. Os previews atuais já nascem sem segredo, então o ganho é pequeno | sim |
| C | Apagar os previews antigos | remove as 73 cópias com a chave e as 110 não medidas | os links de revisão dos PRs antigos quebram; nada operacional depende deles | **não** |
| C2 | Apagar os deploys de production antigos | remove versões antigas das funções com a chave | **perde alvos de retorno**. Manter no mínimo o publicado `6aff669c` e os retornos `6afda676` e `6afdd7da` | não |
| D | Credenciais separadas para teste | previews com um banco de teste e uma chave própria | exige um projeto Supabase de staging; fora do escopo atual | sim |
| E | Rotacionar as chaves possivelmente expostas | invalida qualquer cópia, inclusive em deploys apagados ou em cache | janela própria (seção 6); afeta todas as funções com chave de serviço | parcialmente |
| F | Esperar a retenção de 90 dias | os previews com a chave somem sozinhos até ~14/02/2027 | o risco continua por cerca de 80 dias | — |

**Apagar deploys não substitui a rotação.** Só a rotação garante que nenhuma cópia, inclusive fora do Netlify, continue
valendo.

## 6. Dependências: o que pode parar

**`SUPABASE_SERVICE_ROLE_KEY`** é usada por `usuarios`, `widget-caixa`, `vibe`, `email-comercial`,
`diretor-financeiro` (veredito), `channel-octadesk`, pelo formulário do site e a ingestão do Inbox, e pelos scripts
locais (`.env.local`).

**Rotação da chave de serviço.** Há dois caminhos:
- **(i) Chaves novas do Supabase** (`sb_secret_…`), recomendado. Cria-se uma chave secreta nova, ela substitui a antiga
  no Netlify, publica-se e só então se **revoga** a chave legada. **Não mexe** na chave pública (`anon`) nem nas sessões
  dos usuários. Pré-condição: conferir se o SDK e as chamadas REST das funções aceitam o formato novo. Isso não foi
  testado.
- **(ii) Trocar o segredo JWT do projeto.** Invalida também a chave `anon` e **todas as sessões**: exige trocar
  `VITE_SUPABASE_ANON_KEY`, reconstruir e publicar o app, e todos fazem login de novo. O widget do iPad continua, porque
  o token dele é do banco. **Não recomendado.**

**Demais chaves:**

| Chave | Efeito da rotação |
|---|---|
| Google OAuth | `email-comercial` para até nova autorização |
| Anthropic | Assistente, Comunicação e Diretor Financeiro caem para o modo determinístico até a chave nova |
| Vibe | aba Vibe indisponível até a chave nova |
| GitHub | `development-status` para até o token novo |

**Formulário do site:** **não tocar na vaga A** até a J6 do P1, porque ela é o retorno do site `6afda685`. A vaga B
(production) não é afetada por nenhuma das ações acima.

**Recebimento de leads:** depende de `/api/formulario-site` no deploy publicado. Apagar previews e deploys antigos de
production não o afeta. A rotação da chave de serviço o interrompe **entre** a troca e a publicação do deploy novo:
minutos, dentro da janela.

## 7. Sequência recomendada

**Fase 0 — leitura de confirmação, sem efeito.**
- ler os logs e painéis listados na seção 4;
- se houver uso indevido, **parar e tratar como incidente**: rotação imediata, fora desta sequência.

**Fase 1 — apagar os previews antigos (C).** Baixo risco operacional.
- Pré-condições:
  - nenhuma janela crítica aberta no CRM;
  - lista fechada dos IDs, gerada no dia, com os previews anteriores a 17/11 01:27 UTC;
  - o publicado e os retornos ficam **fora** da lista.
- Parada: qualquer ID que não seja `deploy-preview` aborta a fase.
- Validação:
  - o publicado continua `6aff669c` e travado;
  - as rotas públicas respondem os códigos de sempre;
  - os endereços apagados respondem 404.
- Retorno: **não há**, porque apagar é irreversível. Por isso a lista é fechada e conferida antes.

**Fase 2 — limpeza de configuração (A, e B se a Direção quiser).**
- remover os contextos vazios das variáveis privilegiadas;
- decidir se os previews ficam ligados;
- retorno: recriar o contexto vazio ou religar.

**Fase 3 — rotação da chave de serviço (E, caminho i), em janela própria.**
- Pré-condições:
  - teste do formato novo em PostgreSQL ou deploy descartável;
  - aviso à Frente A, por causa do formulário;
  - publicado conhecido e trava ligada.
- Passos:
  1. criar a chave nova no Supabase;
  2. gravar no Netlify, **só em production**;
  3. construir e publicar a `main` sob `PRODUCTION AUTORIZADA`;
  4. validar;
  5. revogar a chave legada.
- Validação, só por leitura e sem gravar:
  - `/api/widget-caixa` sem token responde 401;
  - Usuários lista;
  - formulário: POST sem segredo responde 401;
  - telas do app iguais.
- Parada: qualquer 5xx nas funções antes de revogar. Retorno: republicar o deploy anterior, porque a chave legada ainda
  vale até a revogação.

**Fase 4 — chaves de terceiros.** Anthropic, Vibe, GitHub e Google OAuth, uma por vez, cada uma com o seu teste.

**Fase 5 (opcional) — deploys de production antigos (C2).** Só depois da rotação, que já os neutraliza, e mantendo os
retornos.

## 8. Risco residual depois da contenção

- **Depois das fases 1 e 2:** sem cópia da chave em deploy não produtivo. Restam as cópias legítimas em production e
  qualquer cópia fora do Netlify, só eliminável pela rotação.
- **Depois da fase 3:** nenhuma cópia antiga da chave de serviço vale.
- **Permanente:**
  - os deploys de production publicados mantêm versões antigas das funções em endereço permanente, até a retenção de 90
    dias ou a fase 5;
  - o repositório é público, então código em PR é visível. Previews sem segredo não dão acesso ao banco, mas a regra
    "segredo só em production" precisa ser mantida;
  - sugestão de controle: uma checagem periódica do mesmo GET da seção 2.3 no preview mais recente.

## 9. Decisões que dependem da Direção

| # | Decisão | Proposta |
|---|---|---|
| D1 | Autorizar a fase 0, leitura dos logs e painéis de terceiros | sim, sem efeito |
| D2 | Autorizar a fase 1: apagar os previews do CRM anteriores a 17/11 01:27 UTC | sim |
| D3 | Previews do CRM: manter ligados (sem segredo) ou desligar | manter, com a checagem periódica |
| D4 | Autorizar a fase 3: rotação da chave de serviço pelo caminho (i), em janela própria | sim, depois do teste do formato |
| D5 | Rotação das chaves de terceiros (fase 4) | sim, de baixo custo |
| D6 | Apagar deploys antigos de production (fase 5) | opcional, depois da fase 3 |
| D7 | Vaga A do formulário | **não tocar** antes da J6 do P1 |

Nenhuma dessas ações está autorizada por este documento.
