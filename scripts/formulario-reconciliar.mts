/**
 * RECONCILIADOR do formulário do site. Server-side, fora do app.
 *
 *   npx vite-node scripts/formulario-reconciliar.mts -- --site <site_id> --marco 2026-11-10T00:00:00Z
 *   npx vite-node scripts/formulario-reconciliar.mts -- --arquivo scratch/submissoes.json --marco ...
 *
 * Sem flags de execução: SIMULAÇÃO. Lê as submissões (API oficial do Netlify ou um arquivo JSON), traduz,
 * calcula a MESMA identidade e a MESMA impressão que a borda calcularia, e imprime o plano. Nada é enviado.
 *
 * Enviar exige, ao mesmo tempo, `--executar` e `--confirmar FORMULARIO_SITE_V1`. `--executar` sozinho é
 * RECUSADO — mesmo padrão do runner do CNO.
 *
 * Por que ele existe: o evento `formSubmitted` do Netlify não tem reenvio automático (a documentação diz que
 * o retorno da função não é usado pela plataforma). Então a única garantia de que uma submissão válida não
 * desaparece é esta: a submissão fica guardada no Netlify e volta por aqui, pelo MESMO endpoint, com a mesma
 * chave de idempotência. Reconciliar não duplica nada — o plano da borda devolve COMPLETADO ou IDEMPOTENTE.
 *
 * O QUE ELE NUNCA FAZ: processar submissão anterior ao marco sem `--incluir-anteriores`. As submissões reais
 * guardadas de antes da integração são decisão comercial com autorização própria.
 *
 * Tokens: NETLIFY_AUTH_TOKEN (PAT, só para ler submissões) e EIFF_FORM_SECRET (o mesmo segredo da borda).
 * Nunca em arquivo versionado, nunca impressos.
 *
 * ── COMO ELE OPERA (decidido no preflight de 09/11/2026) ─────────────────────────────────────────
 *
 * FREQUÊNCIA. De hora em hora, no modo execução, com o marco da ativação. É a cadência que casa com o
 * prazo de primeira resposta do Inbox (1 dia): uma submissão perdida pelo evento volta em até 60 min e
 * ainda sobra dia para responder. Mais frequente não melhora nada — o evento entrega em segundos quando
 * entrega — e menos frequente come o prazo. Rodar de hora em hora não custa nada quando nada falhou: sem
 * submissão nova, o plano devolve lista vazia e o processo termina sem escrever no banco.
 *
 * REGISTRO. Toda rodada imprime UMA linha legível por máquina, `RECONCILIACAO_RESUMO { … }`, com lidas,
 * recuperadas, retidas e falhas — nos dois modos. É o que vai para o log do agendador.
 *
 * ALERTA. Não existe notificação automática, porque nenhum canal de saída está autorizado nesta fase
 * (nem no Inbox, nem na EIFF Central). O alerta é o CÓDIGO DE SAÍDA, que faz o job do agendador falhar:
 *
 *     0  nada a fazer, ou tudo recuperado sem erro
 *     1  alguma submissão NÃO entrou (a próxima rodada tenta de novo; se repetir, é defeito)
 *     2  BLOQUEADO antes de ler qualquer coisa (falta token, marco, confirmação: erro de operação)
 *
 * A regra de atenção humana: `falhas > 0` em duas rodadas seguidas, ou `recuperadas > 0` com frequência —
 * recuperar é normal uma vez, rotina significa que o evento do site está falhando e é lá que se olha.
 *
 * MARCO INICIAL. O instante em que a integração entra no ar, informado em `--marco`. Antes dele a
 * reconciliação RETÉM: as submissões reais guardadas no painel são decisão comercial, com autorização
 * própria, e liberá-las exige `--incluir-anteriores` MAIS `--confirmar-anteriores`.
 */
import fs from 'node:fs';
import {
  planoDaReconciliacao, relatorioDaReconciliacao, type RespostaDaBorda,
} from '../src/core/radar/formularioReconciliacao';
import { CABECALHO_SEGREDO } from '../src/core/radar/formularioServidor';
import { FORMULARIOS } from '../src/core/radar/formularioSite';
import { classificarErro, textoDoErro, validarCredencial } from '../src/core/erroSeguro';

const args = process.argv.slice(2).filter((a) => a !== '--');
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
/** Bloqueio é erro de operação, não de entrega: sai com 2 para o agendador distinguir. */
const falhar = (m: string): never => { console.error(`BLOQUEADO: ${m}`); process.exit(2); };

const API = 'https://api.netlify.com/api/v1';
/** O que fazer com cada recusa de credencial. Nunca cita o valor. */
const DICA_DA_CREDENCIAL = {
  CREDENCIAL_AUSENTE: 'Defina a variável de ambiente nesta sessão.',
  CREDENCIAL_INVALIDA: 'O valor tem caractere que o HTTP não aceita em cabeçalho (controle ou fora do Latin-1): cole de novo, sem Ctrl+V em prompt oculto.',
} as const;
const CONFIRMACAO = 'FORMULARIO_SITE_V1';
/** Processar submissão anterior ao marco é processar lead REAL: porta própria, separada da porta de reenvio. */
const CONFIRMACAO_ANTERIORES = 'LEADS_REAIS_ANTES_DO_MARCO';

const siteId = arg('site');
const arquivo = arg('arquivo');
const marco = arg('marco');
const endpoint = arg('endpoint', 'https://eiffcontrol.com.br/api/formulario-site');
const excluidos = arg('excluidos').split(',').map((x) => x.trim()).filter((x) => x !== '');
const porPagina = Number(arg('por-pagina', '100'));
const incluirAnteriores = flag('incluir-anteriores');
const anterioresConfirmados = arg('confirmar-anteriores') === CONFIRMACAO_ANTERIORES;
const executar = flag('executar');
const confirmado = arg('confirmar') === CONFIRMACAO;

if (marco === '' || Number.isNaN(Date.parse(marco))) falhar('informe --marco <instante ISO> (a partir de quando a reconciliação pode reenviar).');
if (siteId === '' && arquivo === '') falhar('informe --site <site_id do Netlify> ou --arquivo <json com as submissões>.');
if (executar && !confirmado) falhar(`--executar sem --confirmar ${CONFIRMACAO} é recusado. Não há modo intermediário.`);
if (incluirAnteriores && !anterioresConfirmados) {
  falhar(`--incluir-anteriores sem --confirmar-anteriores ${CONFIRMACAO_ANTERIORES} é recusado: `
    + 'as submissões de antes do marco são leads REAIS e liberá-las é decisão comercial, não rotina.');
}
if (incluirAnteriores && !executar) console.log('AVISO: --incluir-anteriores só tem efeito com --executar.');

const modo = executar && confirmado ? 'EXECUÇÃO' : 'SIMULAÇÃO';
console.log(`=== reconciliação do formulário do site · modo ${modo} ===`);
if (incluirAnteriores && executar) {
  console.log('ATENÇÃO: --incluir-anteriores libera submissões REAIS de antes do marco. Isso é processamento de lead real.');
}

/* ------------------------------------------------------------------ 1 · leitura das submissões */

async function daApi(): Promise<unknown[]> {
  // Conferida ANTES de montar o cabeçalho: ausente ou com caractere que o HTTP não aceita, nada é enviado.
  const credencial = validarCredencial(process.env.NETLIFY_AUTH_TOKEN);
  if (!credencial.ok) falhar(`${credencial.codigo}: NETLIFY_AUTH_TOKEN (token de leitura das submissões). ${DICA_DA_CREDENCIAL[credencial.codigo]}`);
  const token = (credencial as { valor: string }).valor;
  const cab = { authorization: `Bearer ${token}`, 'user-agent': 'eiff-control-reconciliador' };
  const formularios = await fetch(`${API}/sites/${encodeURIComponent(siteId)}/forms`, { headers: cab })
    .then(async (r) => (r.ok ? (await r.json()) as Record<string, unknown>[] : falhar(`API do Netlify recusou a lista de formulários: http ${r.status}`)));
  const alvos = formularios.filter((f) => (FORMULARIOS as readonly string[]).includes(String(f['name'] ?? '')));
  if (alvos.length === 0) falhar(`nenhum formulário ${FORMULARIOS.join('/')} neste site. Confira --site.`);
  const tudo: unknown[] = [];
  for (const f of alvos) {
    for (let pagina = 1; ; pagina += 1) {
      const url = `${API}/forms/${encodeURIComponent(String(f['id']))}/submissions?page=${pagina}&per_page=${porPagina}`;
      const lote = await fetch(url, { headers: cab })
        .then(async (r) => (r.ok ? (await r.json()) as unknown[] : falhar(`API do Netlify recusou as submissões: http ${r.status}`)));
      tudo.push(...lote);
      console.log(`  ${f['name']}: página ${pagina} → ${lote.length} submissões`);
      if (lote.length < porPagina) break;
    }
  }
  return tudo;
}

const brutas: unknown[] = arquivo !== ''
  ? (() => {
    const d = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as unknown;
    return Array.isArray(d) ? d : [d];
  })()
  // Exceção na leitura nunca chega ao topo: lá o Node imprimiria a mensagem bruta, que pode conter o cabeçalho.
  : await daApi().catch((e: unknown) => falhar(`FALHA_LEITURA: ${textoDoErro(classificarErro(e))}`));

/* ------------------------------------------------------------------ 2 · o plano (puro) */

const plano = planoDaReconciliacao(brutas, {
  marco, excluidos, incluirAnteriores, formulariosAceitos: FORMULARIOS,
});

console.log(`\nlidas: ${plano.lidas} · a reenviar: ${plano.enviar.length} · retidas: ${plano.retidas.length}`);
const porMotivo = new Map<string, number>();
for (const r of plano.retidas) porMotivo.set(r.motivo, (porMotivo.get(r.motivo) ?? 0) + 1);
for (const [m, n] of porMotivo) console.log(`  retidas · ${m}: ${n}`);
for (const i of plano.enviar) {
  console.log(`  ${i.criadoEm} · ${i.formulario} · id ${i.id} · externo ${i.externoId} · impressão ${i.payloadFingerprint.slice(0, 16)}`);
}

/** A linha que o agendador lê. Sem conteúdo de lead: só contagens, motivos e o modo. */
const resumo = (extra: Record<string, unknown> = {}) => {
  const motivos: Record<string, number> = {};
  for (const [m, n] of porMotivo) motivos[m] = n;
  console.log(`RECONCILIACAO_RESUMO ${JSON.stringify({
    modo, marco, lidas: plano.lidas, aReenviar: plano.enviar.length, retidas: plano.retidas.length, motivos, ...extra,
  })}`);
};

if (modo === 'SIMULAÇÃO') {
  resumo({ recuperadas: 0, falhas: 0 });
  console.log('\nSIMULAÇÃO: nada foi enviado. Para reenviar, repita com --executar --confirmar ' + CONFIRMACAO);
  process.exit(0);
}

/* ------------------------------------------------------------------ 3 · reenvio pelo MESMO endpoint */

// O segredo vira cabeçalho: conferido ANTES de qualquer envio. Valor com caractere de controle (o `^V` de um
// Ctrl+V num prompt, por exemplo) faria o Node falhar com «fetch failed» sem sair da máquina — foi o que
// aconteceu duas vezes em 10/11/2026. Aqui ele é recusado com o código, sem tocar a rede.
const credencialDoSegredo = validarCredencial(process.env.EIFF_FORM_SECRET);
if (!credencialDoSegredo.ok) falhar(`${credencialDoSegredo.codigo}: EIFF_FORM_SECRET (o mesmo segredo que a borda exige). ${DICA_DA_CREDENCIAL[credencialDoSegredo.codigo]}`);
const segredo = (credencialDoSegredo as { valor: string }).valor;

const respostas: RespostaDaBorda[] = [];
for (const i of plano.enviar) {
  // O corpo é a submissão do Netlify como a borda a espera: uma só tradução, a do transporte.
  const corpo = JSON.stringify({ id: i.id, form_name: i.formulario, created_at: i.criadoEm, data: i.submissao.campos });
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', [CABECALHO_SEGREDO]: segredo }, body: corpo });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const resposta: RespostaDaBorda = {
      id: i.id, status: r.status,
      ...(typeof d['resultado'] === 'string' ? { resultado: d['resultado'] } : {}),
      ...(typeof d['erro'] === 'string' ? { motivo: d['erro'] } : {}),
    };
    respostas.push(resposta);
    console.log(`  ${i.id} → ${r.status} ${resposta.resultado ?? resposta.motivo ?? ''}`);
  } catch (e) {
    // Só o código. A mensagem bruta NUNCA é impressa: em alguns erros de cabeçalho o Node põe o valor nela.
    const motivo = textoDoErro(classificarErro(e));
    respostas.push({ id: i.id, status: 0, motivo });
    console.log(`  ${i.id} → falha de transporte: ${motivo}`);
  }
}

const rel = relatorioDaReconciliacao(respostas);
const recuperadas = rel.registradas + rel.completadas + rel.novasObservacoes;
console.log(`\n${JSON.stringify(rel, null, 2)}`);
// Falha não é erro fatal: a submissão fica guardada no Netlify e a próxima rodada a traz. Mas o código de
// saída avisa, para a reconciliação agendada não falhar em silêncio.
resumo({ recuperadas, falhas: rel.falhas.length });
process.exit(rel.falhas.length === 0 ? 0 : 1);
