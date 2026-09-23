/**
 * LE-3A — leitor do snapshot oficial do CNO. Toda a REDE e todo o DISCO ficam aqui; o core
 * (`src/core/radar/cnoDadosAbertos.ts`) continua puro e so recebe linhas ja lidas.
 *
 *   npx vite-node scripts/cno.mts -- probe
 *   npx vite-node scripts/cno.mts -- amostra --limite 20
 *   npx vite-node scripts/cno.mts -- amostra --arquivo D:/tmp/cno.zip --limite 20
 *   npx vite-node scripts/cno.mts -- validar --arquivo D:/tmp/cno.zip
 *   npx vite-node scripts/cno.mts -- baixar --destino D:/tmp
 *
 * Regras deste leitor:
 *  - host unico permitido (fail closed): nenhuma URL de terceiro, nenhum host vindo por argumento;
 *  - sem credencial, sem cookie, sem e-CAC, sem gov.br — a fonte e publica;
 *  - streaming sempre: o snapshot tem ~315 MiB comprimidos e ~1,4 GiB de CSV. Nada de ler tudo na memoria;
 *  - NAO persiste nada no Radar nem no Supabase. O maximo que produz e observacao canonica na tela;
 *  - CPF nunca e reconstruido e CNPJ sai mascarado.
 */
import { createWriteStream, createReadStream, statSync, unlinkSync } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ARQUIVOS_CNO, CABECALHOS_CNO, ENCODING_CNO, HOST_OFICIAL_CNO, MODO_FONTE_CNO,
  cabecalhoCsvCno, camposCsvCno, conferirCabecalho, dataEventoCno, indicesDe, juntarObservacoesCno,
  lerAreaCno, lerCnaeCno, lerObraCno, lerVinculoCno, pedidoIntakeCno, sinalCno, totaisDeLinha,
  type ArquivoCno, type CnoObservacao,
} from '../src/core/radar/cnoDadosAbertos';

// --------------------------------------------------------------------------------------------------- fonte
/** Links oficiais do conjunto "Cadastro Nacional de Obras - CNO" no dados.gov.br (auditados em 23/09/2026). */
const URL_DADOS = `https://${HOST_OFICIAL_CNO}/index.php/s/PC6732BXG9B98W3/download`;
const URL_DICIONARIO = `https://${HOST_OFICIAL_CNO}/index.php/s/XEa8aE7wJdMGzkE/download`;
const LANDING = 'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-de-obras-cno';

const UA = 'EIFF-Control/LE3 (+https://eiffcontrol.com.br; augusto@eiff.com.br)';
const TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

/** Fail closed: so o host oficial. Nao existe argumento que troque isso. */
function exigirHostOficial(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`protocolo recusado: ${u.protocol}`);
  if (u.hostname !== HOST_OFICIAL_CNO) throw new Error(`host recusado: ${u.hostname} (unico permitido: ${HOST_OFICIAL_CNO})`);
  return u;
}

async function buscar(url: string, cabecalhos: Record<string, string> = {}, metodo = 'GET'): Promise<Response> {
  let alvo = url;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    exigirHostOficial(alvo);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(alvo, { method: metodo, headers: { 'User-Agent': UA, ...cabecalhos }, redirect: 'manual', signal: ac.signal });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        alvo = new URL(r.headers.get('location')!, alvo).toString();
        continue;
      }
      if (r.status >= 400) throw new Error(`HTTP ${r.status} em ${new URL(alvo).pathname}`);
      return r;
    } finally { clearTimeout(t); }
  }
  throw new Error(`redirecionamentos demais (>${MAX_REDIRECTS})`);
}

const faixa = async (url: string, inicio: number, fim: number): Promise<Buffer> => {
  const r = await buscar(url, { Range: `bytes=${inicio}-${fim}` });
  if (r.status !== 206) throw new Error(`servidor nao honrou Range (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer());
};

// ------------------------------------------------------------------------------------------------ zip
interface MembroZip { nome: string; bruto: number; comprimido: number; offLocal: number; metodo: number }

/** Le so o diretorio central (fim do arquivo). Evita baixar 315 MiB para saber o que ha dentro. */
async function membrosRemotos(url: string, total: number): Promise<MembroZip[]> {
  const JANELA = Math.min(96 * 1024, total);
  const cauda = await faixa(url, total - JANELA, total - 1);
  const base = total - JANELA;
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) if (cauda.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD do ZIP nao encontrado');
  let entradas = cauda.readUInt16LE(eocd + 10);
  let tamanhoCd = cauda.readUInt32LE(eocd + 12);
  let offsetCd = cauda.readUInt32LE(eocd + 16);
  if (offsetCd === 0xffffffff || entradas === 0xffff || tamanhoCd === 0xffffffff) {
    let loc = -1;
    for (let i = eocd; i >= 0; i--) if (cauda.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
    if (loc < 0) throw new Error('ZIP64 sem locator');
    const off64 = Number(cauda.readBigUInt64LE(loc + 8));
    const b = await faixa(url, off64, off64 + 55);
    entradas = Number(b.readBigUInt64LE(32));
    tamanhoCd = Number(b.readBigUInt64LE(40));
    offsetCd = Number(b.readBigUInt64LE(48));
  }
  const cd = offsetCd >= base ? cauda.subarray(offsetCd - base, offsetCd - base + tamanhoCd) : await faixa(url, offsetCd, offsetCd + tamanhoCd - 1);
  return lerDiretorioCentral(cd);
}

function lerDiretorioCentral(cd: Buffer): MembroZip[] {
  const membros: MembroZip[] = [];
  let p = 0;
  while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const metodo = cd.readUInt16LE(p + 10);
    let comprimido = cd.readUInt32LE(p + 20);
    let bruto = cd.readUInt32LE(p + 24);
    const nLen = cd.readUInt16LE(p + 28), eLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
    let offLocal = cd.readUInt32LE(p + 42);
    const nome = cd.toString('utf8', p + 46, p + 46 + nLen);
    let e = p + 46 + nLen;
    const fimExtra = e + eLen;
    while (e + 4 <= fimExtra) {
      const id = cd.readUInt16LE(e), sz = cd.readUInt16LE(e + 2);
      let q = e + 4;
      if (id === 0x0001) {
        if (bruto === 0xffffffff) { bruto = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (comprimido === 0xffffffff) { comprimido = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (offLocal === 0xffffffff) { offLocal = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + sz;
    }
    membros.push({ nome, metodo, bruto, comprimido, offLocal });
    p += 46 + nLen + eLen + cLen;
  }
  return membros;
}

async function membrosLocais(caminho: string): Promise<MembroZip[]> {
  const total = statSync(caminho).size;
  const JANELA = Math.min(96 * 1024, total);
  const cauda = await lerPedaco(caminho, total - JANELA, total - 1);
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) if (cauda.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD do ZIP nao encontrado');
  const tamanhoCd = cauda.readUInt32LE(eocd + 12);
  const offsetCd = cauda.readUInt32LE(eocd + 16);
  return lerDiretorioCentral(await lerPedaco(caminho, offsetCd, offsetCd + tamanhoCd - 1));
}

/** Leitura por faixa no disco: stream com start/end, nunca readFile do arquivo inteiro. */
function lerPedaco(caminho: string, inicio: number, fim: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    createReadStream(caminho, { start: inicio, end: fim })
      .on('data', (d) => partes.push(d as Buffer))
      .on('end', () => resolve(Buffer.concat(partes)))
      .on('error', reject);
  });
}

const inicioDosDados = (cab: Buffer, off: number) => off + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);

/**
 * Entrega as linhas de um membro do ZIP, uma a uma, decodificando em latin1. Para com `limite` linhas — e por
 * isso a amostra remota so precisa dos primeiros KB do membro, nunca do arquivo todo.
 */
async function* linhasDoMembro(origem: { url: string } | { arquivo: string }, m: MembroZip, limite: number): AsyncGenerator<string> {
  const remoto = 'url' in origem;
  const cab = remoto ? await faixa(origem.url, m.offLocal, m.offLocal + 29) : await lerPedaco(origem.arquivo, m.offLocal, m.offLocal + 29);
  const ini = inicioDosDados(cab, m.offLocal);
  // heuristica de leitura: o suficiente para `limite` linhas, com teto; o resto do membro nunca e tocado
  const pedaco = Math.min(m.comprimido, Math.max(64 * 1024, limite * 512));
  const fim = ini + pedaco - 1;

  const entrada = remoto
    ? Readable.from([await faixa(origem.url, ini, fim)])
    : createReadStream(origem.arquivo, { start: ini, end: fim });

  const inflate = createInflateRaw();
  entrada.pipe(inflate);
  let resto = '';
  let saiu = 0;
  try {
    for await (const pedacoBin of inflate) {
      resto += (pedacoBin as Buffer).toString(ENCODING_CNO);
      const partes = resto.split('\n');
      resto = partes.pop() ?? '';
      for (const l of partes) {
        if (!l.trim()) continue;
        yield l.replace(/\r$/, '');
        if (++saiu >= limite) return;
      }
    }
  } catch { /* fim do pedaco no meio do fluxo deflate: esperado quando so lemos o prefixo */ }
  if (resto.trim() && saiu < limite) yield resto.replace(/\r$/, '');
}

// ------------------------------------------------------------------------------------------------ saida
const mascararCnpj = (c?: string) => (c ? `${c.slice(0, 2)}.***.***/${c.slice(8, 12)}-**` : '—');
const mib = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MiB';

// ------------------------------------------------------------------------------------------------ comandos
async function probe(): Promise<void> {
  console.log('fonte oficial  :', LANDING);
  console.log('modo           :', MODO_FONTE_CNO, '(snapshot completo; nao ha endpoint incremental)');
  console.log('host permitido :', HOST_OFICIAL_CNO, '(fail closed)\n');

  for (const [rotulo, url] of [['dados (ZIP)', URL_DADOS], ['dicionario (PDF)', URL_DICIONARIO]] as const) {
    const r = await buscar(url, {}, 'HEAD');
    console.log(`--- ${rotulo}`);
    console.log('    content-type  :', r.headers.get('content-type'));
    console.log('    content-length:', r.headers.get('content-length'), `(${mib(Number(r.headers.get('content-length')))})`);
    console.log('    last-modified :', r.headers.get('last-modified'));
    console.log('    etag          :', r.headers.get('etag'));
    console.log('    nome          :', /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? '—');
  }

  const cabZip = await buscar(URL_DADOS, {}, 'HEAD');
  const total = Number(cabZip.headers.get('content-length'));
  const membros = await membrosRemotos(URL_DADOS, total);
  console.log('\n--- membros do ZIP (lidos pelo diretorio central, sem baixar o arquivo)');
  let brutoTotal = 0;
  for (const m of membros) {
    brutoTotal += m.bruto;
    const conhecido = (ARQUIVOS_CNO as readonly string[]).includes(m.nome) ? '' : '   <-- NAO DECLARADO NO CONTRATO';
    console.log(`    ${m.nome.padEnd(20)} ${mib(m.bruto).padStart(10)} bruto   ${mib(m.comprimido).padStart(10)} comprimido${conhecido}`);
  }
  console.log(`    ${'TOTAL'.padEnd(20)} ${mib(brutoTotal).padStart(10)} bruto`);
  const faltando = (ARQUIVOS_CNO as readonly string[]).filter((a) => !membros.some((m) => m.nome === a));
  console.log('\n    arquivos do contrato ausentes:', faltando.length ? faltando.join(', ') : 'nenhum');
}

async function cabecalhosReais(origem: { url: string } | { arquivo: string }, membros: MembroZip[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const m of membros) {
    for await (const l of linhasDoMembro(origem, m, 1)) { out.set(m.nome, cabecalhoCsvCno(l)); break; }
  }
  return out;
}

async function validar(arquivo?: string): Promise<void> {
  const origem = arquivo ? { arquivo } : { url: URL_DADOS };
  const membros = arquivo
    ? await membrosLocais(arquivo)
    : await membrosRemotos(URL_DADOS, Number((await buscar(URL_DADOS, {}, 'HEAD')).headers.get('content-length')));

  console.log('origem:', arquivo ?? URL_DADOS, '\n');
  let ok = true;
  const cabs = await cabecalhosReais(origem, membros);
  for (const nome of ARQUIVOS_CNO) {
    const lido = cabs.get(nome);
    if (!lido) { console.log(`  ${nome.padEnd(20)} AUSENTE`); ok = false; continue; }
    const c = conferirCabecalho(lido, CABECALHOS_CNO[nome as ArquivoCno]);
    console.log(`  ${nome.padEnd(20)} ${c.ok ? 'cabecalho OK' : 'DIVERGENTE'}`
      + (c.faltando.length ? `  faltando: ${c.faltando.join(', ')}` : '')
      + (c.inesperados.length ? `  inesperados: ${c.inesperados.join(', ')}` : ''));
    if (!c.ok) ok = false;
  }
  const totaisM = membros.find((m) => m.nome === 'cno_totais.csv');
  if (totaisM) {
    const linhas: string[] = [];
    for await (const l of linhasDoMembro(origem, totaisM, 2)) linhas.push(l);
    if (linhas.length > 1) {
      const t = totaisDeLinha(camposCsvCno(linhas[1]), indicesDe(cabecalhoCsvCno(linhas[0])));
      console.log('\n  totais declarados pela fonte:', JSON.stringify(t));
    }
  }
  console.log('\nCNO_SNAPSHOT_VALIDACAO =', ok ? 'PASS' : 'BLOCKED');
  if (!ok) process.exitCode = 1;
}

async function amostra(limite: number, arquivo?: string): Promise<void> {
  const origem = arquivo ? { arquivo } : { url: URL_DADOS };
  const membros = arquivo
    ? await membrosLocais(arquivo)
    : await membrosRemotos(URL_DADOS, Number((await buscar(URL_DADOS, {}, 'HEAD')).headers.get('content-length')));
  const membro = (n: string) => membros.find((m) => m.nome === n)!;

  const ler = async <T>(nome: string, n: number, fn: (cab: string[], ix: Record<string, number>, campos: string[]) => T | undefined): Promise<T[]> => {
    let cab: string[] | undefined;
    let ix: Record<string, number> | undefined;
    const out: T[] = [];
    for await (const l of linhasDoMembro(origem, membro(nome), n + 1)) {
      if (!cab || !ix) { cab = cabecalhoCsvCno(l); ix = indicesDe(cab); continue; }
      const v = fn(cab, ix, camposCsvCno(l));
      if (v !== undefined) out.push(v);
    }
    return out;
  };

  // as areas/cnaes/vinculos vem do inicio do arquivo, que e ordenado por CNO como o cno.csv: a amostra casa
  const obras = await ler('cno.csv', limite, lerObraCno);
  const areas = await ler('cno_areas.csv', limite * 4, lerAreaCno);
  const cnaes = await ler('cno_cnaes.csv', limite * 4, lerCnaeCno);
  const vinculos = await ler('cno_vinculos.csv', limite * 4, lerVinculoCno);

  const { observacoes, diagnosticos } = juntarObservacoesCno({ obras, areas, cnaes, vinculos });
  // Os orfaos aqui sao artefato da AMOSTRA, nao defeito da fonte: lemos mais linhas de areas/cnaes/vinculos do
  // que de obras, entao sobram filhos cujo pai ficou fora da janela. Num snapshot inteiro isso seria defeito.
  console.log(`amostra: ${observacoes.length} observacoes (evidencia + canonica)`);
  console.log(`orfaos fora da janela da amostra: ${diagnosticos.length} (esperado: a janela de filhos e maior que a de obras)\n`);

  for (const o of observacoes.slice(0, limite)) mostrar(o);

  const comSinal = observacoes.filter((o) => sinalCno(o.canonical) !== 'NENHUM').length;
  const comPj = observacoes.filter((o) => o.canonical.cnpjResponsavel).length;
  console.log(`\nresumo da amostra: ${comSinal}/${observacoes.length} com sinal, ${comPj}/${observacoes.length} com PJ identificavel`);
  console.log('PERSISTENCIA = NENHUMA (nada foi gravado no Radar nem no Supabase)');
}

function mostrar(obs: CnoObservacao): void {
  const o = obs.canonical;
  const ev = dataEventoCno(o);
  // Privacidade: sem PJ identificada o responsavel e pessoa fisica, e o campo "Nome" costuma trazer o nome
  // dela. O dado e publico, mas este relatorio nao precisa reproduzi-lo — o CNO ja identifica a obra.
  const obra = o.nomeResponsavel ? (o.nomeObra ?? '—') : '(omitido: responsavel pessoa fisica)';
  console.log(`CNO ${o.cno}  ${o.municipio ?? '—'}/${o.uf ?? '—'}  situacao ${o.situacao ?? '—'} ${o.situacaoNome ?? ''}`);
  console.log(`   obra       : ${obra}`);
  console.log(`   responsavel: ${o.nomeResponsavel ? `PJ ${mascararCnpj(o.cnpjResponsavel)}` : 'pessoa fisica (sem NI, sem PJ)'}  qualif. ${o.qualificacaoResponsavelNome ?? o.qualificacaoResponsavel ?? '—'}`);
  console.log(`   area total : ${o.areaTotal ?? '—'} ${o.unidadeMedida ?? ''}   areas: ${o.areas.length}  cnaes: ${o.cnaes.length}  vinculos: ${o.vinculos.length}`);
  console.log(`   categorias : ${[...new Set(o.areas.map((a) => a.categoria).filter(Boolean))].join(', ') || '—'}`);
  console.log(`   destinacoes: ${[...new Set(o.areas.map((a) => a.destinacao).filter(Boolean))].join(', ') || '—'}`);
  console.log(`   sinal      : ${sinalCno(o)}   evento: ${ev ? `${ev.data} (${ev.origem})` : 'SEM_EVENTO_DATADO'}`);
  // A evidencia bruta NAO e impressa: preservar nao e logar. So a contagem de linhas preservadas.
  const e = obs.evidence;
  console.log(`   evidencia  : obra=1 areas=${e.areas.length} cnaes=${e.cnaes.length} vinculos=${e.vinculos.length} (conteudo nao impresso)`);
  const p = pedidoIntakeCno(obs, 'FONTE-CNO', new Date().toISOString());
  console.log(`   intake     : tipo=${p.tipo} externoId=${p.externoId} schema=${(p.payload as { schema: string }).schema}`);
  console.log('');
}

async function baixar(destino: string): Promise<void> {
  const alvo = `${destino.replace(/[\\/]+$/, '')}/cno.zip`;
  const parcial = `${alvo}.parcial`;
  console.log('baixando', URL_DADOS, '->', alvo);
  try {
    const r = await buscar(URL_DADOS);
    if (!r.body) throw new Error('resposta sem corpo');
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(parcial));
    const { renameSync } = await import('node:fs');
    renameSync(parcial, alvo);
    console.log('pronto:', alvo, mib(statSync(alvo).size));
  } catch (e) {
    try { unlinkSync(parcial); } catch { /* nada a limpar */ }
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ cli
const argv = process.argv.slice(2).filter((a) => a !== '--');
const comando = argv[0];
const opcao = (nome: string): string | undefined => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

try {
  if (comando === 'probe') await probe();
  else if (comando === 'validar') await validar(opcao('arquivo'));
  else if (comando === 'amostra') await amostra(Number(opcao('limite') ?? 10), opcao('arquivo'));
  else if (comando === 'baixar') await baixar(opcao('destino') ?? '.');
  else {
    console.log('uso: npx vite-node scripts/cno.mts -- <probe | validar | amostra | baixar> [--arquivo <cno.zip>] [--limite N] [--destino <dir>]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('FALHA:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
