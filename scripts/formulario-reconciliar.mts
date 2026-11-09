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
 */
import fs from 'node:fs';
import {
  planoDaReconciliacao, relatorioDaReconciliacao, type RespostaDaBorda,
} from '../src/core/radar/formularioReconciliacao';
import { CABECALHO_SEGREDO } from '../src/core/radar/formularioServidor';
import { FORMULARIOS } from '../src/core/radar/formularioSite';

const args = process.argv.slice(2).filter((a) => a !== '--');
const arg = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? d : d; };
const flag = (n: string) => args.includes(`--${n}`);
const falhar = (m: string): never => { console.error(`BLOQUEADO: ${m}`); process.exit(1); };

const API = 'https://api.netlify.com/api/v1';
const CONFIRMACAO = 'FORMULARIO_SITE_V1';

const siteId = arg('site');
const arquivo = arg('arquivo');
const marco = arg('marco');
const endpoint = arg('endpoint', 'https://eiffcontrol.com.br/api/formulario-site');
const excluidos = arg('excluidos').split(',').map((x) => x.trim()).filter((x) => x !== '');
const porPagina = Number(arg('por-pagina', '100'));
const incluirAnteriores = flag('incluir-anteriores');
const executar = flag('executar');
const confirmado = arg('confirmar') === CONFIRMACAO;

if (marco === '' || Number.isNaN(Date.parse(marco))) falhar('informe --marco <instante ISO> (a partir de quando a reconciliação pode reenviar).');
if (siteId === '' && arquivo === '') falhar('informe --site <site_id do Netlify> ou --arquivo <json com as submissões>.');
if (executar && !confirmado) falhar(`--executar sem --confirmar ${CONFIRMACAO} é recusado. Não há modo intermediário.`);
if (incluirAnteriores && !executar) console.log('AVISO: --incluir-anteriores só tem efeito com --executar.');

const modo = executar && confirmado ? 'EXECUÇÃO' : 'SIMULAÇÃO';
console.log(`=== reconciliação do formulário do site · modo ${modo} ===`);
if (incluirAnteriores && executar) {
  console.log('ATENÇÃO: --incluir-anteriores libera submissões REAIS de antes do marco. Isso é processamento de lead real.');
}

/* ------------------------------------------------------------------ 1 · leitura das submissões */

async function daApi(): Promise<unknown[]> {
  const token = (process.env.NETLIFY_AUTH_TOKEN ?? '').trim();
  if (token === '') falhar('sem NETLIFY_AUTH_TOKEN no ambiente (personal access token, só leitura de submissões).');
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
  : await daApi();

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

if (modo === 'SIMULAÇÃO') {
  console.log('\nSIMULAÇÃO: nada foi enviado. Para reenviar, repita com --executar --confirmar ' + CONFIRMACAO);
  process.exit(0);
}

/* ------------------------------------------------------------------ 3 · reenvio pelo MESMO endpoint */

const segredo = (process.env.EIFF_FORM_SECRET ?? '').trim();
if (segredo === '') falhar('sem EIFF_FORM_SECRET no ambiente (o mesmo segredo que a borda exige).');

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
    respostas.push({ id: i.id, status: 0, motivo: (e as Error).message });
    console.log(`  ${i.id} → falha de rede: ${(e as Error).message}`);
  }
}

const rel = relatorioDaReconciliacao(respostas);
console.log(`\n${JSON.stringify(rel, null, 2)}`);
// Falha não é erro fatal: a submissão fica guardada no Netlify e a próxima rodada a traz. Mas o código de
// saída avisa, para a reconciliação agendada não falhar em silêncio.
process.exit(rel.falhas.length === 0 ? 0 : 1);
