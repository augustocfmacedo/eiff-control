#!/usr/bin/env node
// E-mail comercial — CONSENTIMENTO OAuth da caixa remetente (etapa E5; docs/email-comercial-e0.md §2).
//
// QUEM RODA: só o administrador do Google Workspace, no PRÓPRIO computador e no próprio terminal.
// O assistente NUNCA roda este script: ele exige terminal interativo e recusa qualquer outra forma de execução.
//
// O QUE FAZ: abre um servidor só nesta máquina (127.0.0.1), mostra o endereço de consentimento do Google, recebe o
// retorno, troca o código pelo TOKEN DE ATUALIZAÇÃO e o entrega a você — por padrão na área de transferência, sem
// imprimir. Pede UM escopo: enviar e-mail. Se o Google conceder qualquer outra coisa, recusa.
//
// O QUE NÃO FAZ: não envia e-mail, não grava nada em disco, não lê variável de ambiente, não fala com o Netlify nem com
// o Supabase, não guarda o segredo do cliente nem o token depois de terminar.
//
// COMO RODAR (depois de criar o cliente OAuth do tipo «App para computador»):
//     node scripts/email-oauth-consentimento.mjs
//     node scripts/email-oauth-consentimento.mjs --mostrar     (imprime o token em vez de copiar)
//     node scripts/email-oauth-consentimento.mjs --conta outra@eiff.com.br
import http from 'node:http';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { ESCOPO, HOST_LOOPBACK, REMETENTE_PADRAO, TOKEN_URL, conferirTroca, corpoDaTroca, lerRetorno, novoDesafio, pareceClientId, resumoDoSegredo, urlDeConsentimento } from './lib/emailOauth.mjs';

const ESPERA_MS = 5 * 60_000;
const args = process.argv.slice(2);
const mostrar = args.includes('--mostrar');
const conta = args.includes('--conta') ? args[args.indexOf('--conta') + 1] : REMETENTE_PADRAO;
const sair = (msg, codigo = 1) => { console.error(`\n${msg}\n`); process.exit(codigo); };

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  sair('Este script só roda em terminal interativo, pela pessoa que administra o Google Workspace.\nEle não deve ser executado por automação nem pelo assistente.');
}
if (args.includes('--ajuda') || args.includes('--help')) {
  sair('Uso: node scripts/email-oauth-consentimento.mjs [--mostrar] [--conta endereco@eiff.com.br]\nRoteiro completo: docs/email-comercial-e0.md, seção 2.', 0);
}

function perguntar(texto, oculto = false) {
  return new Promise((resolver) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // entrada oculta: o que é digitado ou colado não aparece na tela nem no histórico do terminal
    if (oculto) rl._writeToOutput = (s) => { if (s.includes(texto)) process.stdout.write(texto); };
    rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write('\n'); resolver(r.trim()); });
  });
}

function copiar(texto) {
  const cmd = process.platform === 'win32' ? ['clip', []] : process.platform === 'darwin' ? ['pbcopy', []] : ['xclip', ['-selection', 'clipboard']];
  const r = spawnSync(cmd[0], cmd[1], { input: texto });
  return r.status === 0;
}

console.log('\nEIFF Control — consentimento OAuth do e-mail comercial');
console.log('─────────────────────────────────────────────────────');
console.log(`Conta que vai consentir : ${conta}`);
console.log(`Permissão pedida        : ${ESCOPO}  (só enviar)`);
console.log('Nada é gravado em disco. Nenhum e-mail é enviado.\n');

const clientId = await perguntar('ID do cliente OAuth (termina em .apps.googleusercontent.com): ');
if (!pareceClientId(clientId)) sair('Isso não parece um ID de cliente OAuth do Google. Nada foi feito.');
const clientSecret = await perguntar('Segredo do cliente (a digitação fica oculta): ', true);
if (clientSecret.length < 10) sair('Segredo do cliente vazio ou curto demais. Nada foi feito.');

const { verificador, desafio, state } = novoDesafio();
let concluido = false;

const servidor = http.createServer(async (req, res) => {
  const pagina = (titulo, texto) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(`<!doctype html><meta charset="utf-8"><title>EIFF Control</title><body style="font-family:sans-serif;max-width:560px;margin:60px auto"><h2>${titulo}</h2><p>${texto}</p><p>Pode fechar esta aba e voltar ao terminal.</p></body>`); };
  const retorno = lerRetorno(req.url ?? '/', state);
  if (!retorno.ok && retorno.ignorar) { res.writeHead(404); res.end(); return; }
  if (concluido) { pagina('Já concluído', 'Este pedido de consentimento já foi usado.'); return; }
  concluido = true;
  if (!retorno.ok) { pagina('Consentimento não concluído', retorno.motivo); servidor.close(); sair(`Consentimento não concluído: ${retorno.motivo}.`); return; }

  let status = 0; let corpo = null;
  try {
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpoDaTroca({ clientId, clientSecret, codigo: retorno.codigo, verificador, porta: servidor.address().port }) });
    status = r.status; corpo = await r.json().catch(() => null);
  } catch { pagina('Falha de rede', 'Não foi possível falar com o Google.'); servidor.close(); sair('Falha de rede ao trocar o código. Nada foi obtido; rode de novo.'); return; }

  const troca = conferirTroca(status, corpo);
  if (!troca.ok) { pagina('Consentimento recusado pelo script', troca.motivo); servidor.close(); sair(`Não concluído: ${troca.motivo}.`); return; }
  pagina('Consentimento concluído', 'O token de atualização foi entregue no terminal.');
  servidor.close();

  console.log('\nConsentimento concluído. Escopo concedido: só envio.');
  console.log(`Token de atualização: ${resumoDoSegredo(troca.refreshToken)}`);
  if (mostrar) {
    console.log('\n──── token de atualização (copie agora; não será mostrado de novo) ────');
    console.log(troca.refreshToken);
    console.log('───────────────────────────────────────────────────────────────────────');
  } else if (copiar(troca.refreshToken)) {
    console.log('\nO token está na ÁREA DE TRANSFERÊNCIA (não foi impresso).');
    console.log('Cole agora no painel do Netlify, em GOOGLE_OAUTH_REFRESH_TOKEN (escopo Functions).');
    await perguntar('Depois de colar no Netlify, tecle Enter para limpar a área de transferência… ');
    copiar(' ');
    console.log('Área de transferência limpa.');
  } else {
    console.log('\nNão foi possível copiar para a área de transferência. Rode de novo com --mostrar.');
    process.exit(1);
  }
  console.log('\nPróximos passos (docs/email-comercial-e0.md, seção 2.5):');
  console.log('  1. No Netlify: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN.');
  console.log('  2. EIFF_EMAIL_SEND_MODE continua "disabled" até a autorização do canário.');
  console.log('  3. Feche este terminal: o histórico de rolagem pode conter o que foi mostrado.\n');
  process.exit(0);
});

servidor.listen(0, HOST_LOOPBACK, () => {
  const porta = servidor.address().port;
  console.log('\n1. Saia de outras contas Google no navegador (ou use uma janela anônima).');
  console.log(`2. Entre como ${conta} e abra este endereço:\n`);
  console.log(urlDeConsentimento({ clientId, porta, desafio, state, conta }));
  console.log('\n3. A tela do Google deve mostrar UMA permissão: enviar e-mails em seu nome.');
  console.log('   Se mostrar qualquer outra, clique em Cancelar.\n');
  console.log(`Aguardando o retorno em http://${HOST_LOOPBACK}:${porta} por até 5 minutos…`);
});
setTimeout(() => { if (!concluido) { servidor.close(); sair('Tempo esgotado sem retorno do Google. Nada foi obtido.'); } }, ESPERA_MS).unref();
