/**
 * LE-3A — leitor do snapshot oficial do CNO. Toda a REDE e todo o DISCO ficam aqui; o core
 * (`src/core/radar/cnoDadosAbertos.ts`) continua puro e so recebe linhas ja lidas.
 *
 *   npx vite-node scripts/cno.mts -- probe
 *   npx vite-node scripts/cno.mts -- amostra --limite 20
 *   npx vite-node scripts/cno.mts -- amostra --arquivo D:/tmp/cno.zip --limite 20
 *   npx vite-node scripts/cno.mts -- validar --arquivo D:/tmp/cno.zip
 *   npx vite-node scripts/cno.mts -- baixar --destino dados/cno
 *   npx vite-node scripts/cno.mts -- ordenacao --arquivo dados/cno/cno.zip
 *   npx vite-node scripts/cno.mts -- perfil --arquivo dados/cno/cno.zip --saida dados/cno/perfil.json
 *   npx vite-node scripts/cno.mts -- simular --perfil dados/cno/perfil.json
 *   npx vite-node scripts/cno.mts -- piloto --arquivo dados/cno/cno.zip --data 2026-09-23 --limite 50
 *
 * Regras deste leitor:
 *  - host unico permitido (fail closed): nenhuma URL de terceiro, nenhum host vindo por argumento;
 *  - sem credencial, sem cookie, sem e-CAC, sem gov.br — a fonte e publica;
 *  - streaming sempre: o snapshot tem ~315 MiB comprimidos e ~1,4 GiB de CSV. Nada de ler tudo na memoria;
 *  - NAO persiste nada no Radar nem no Supabase. O maximo que produz e observacao canonica na tela;
 *  - CPF nunca e reconstruido e CNPJ sai mascarado.
 */
import { createWriteStream, createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ARQUIVOS_CNO, CABECALHOS_CNO, ENCODING_CNO, HOST_OFICIAL_CNO, MODO_FONTE_CNO,
  cabecalhoCsvCno, camposCsvCno, conferirCabecalho, dataEventoCno, indicesDe, juntarObservacoesCno,
  lerAreaCno, lerCnaeCno, lerObraCno, lerVinculoCno, pedidoIntakeCno, sinalCno, totaisDeLinha,
  type ArquivoCno, type CnoObservacao, type LinhaLida,
} from '../src/core/radar/cnoDadosAbertos';
import { juntarOrdenadoCno, verificarOrdenacao } from '../src/core/radar/cnoStreamJoin';
import { PerfilCno, faixaArea, faixaIdade, type ResumoPerfil } from '../src/core/radar/cnoPerfil';
import { diasEntre } from '../src/core/radar/cnoDiscoveryPolicy';
import { CNO_PILOT_POLICY_V1, CNO_PILOT_POLICY_VERSION, avaliarPiloto, manifestosIguais, metricasLote, montarManifest, politicaPiloto, simularCap, type EntradaManifest, type ManifestPiloto } from '../src/core/radar/cnoPilot';

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
interface MembroZip { nome: string; bruto: number; comprimido: number; offLocal: number; metodo: number; modificadoEm?: string }

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
    const modTime = cd.readUInt16LE(p + 12), modDate = cd.readUInt16LE(p + 14);
    const modificadoEm = `${((modDate >> 9) & 0x7f) + 1980}-${String((modDate >> 5) & 0x0f).padStart(2, '0')}-${String(modDate & 0x1f).padStart(2, '0')}`;
    void modTime;
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
    membros.push({ nome, metodo, bruto, comprimido, offLocal, modificadoEm });
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


// ------------------------------------------------------------------------------------------ LE-3B: snapshot local completo
/**
 * Todas as linhas de um membro do ZIP LOCAL, em streaming: stream de disco com start/end -> inflateRaw -> split
 * por '\n' em latin1 (1 byte = 1 char, entao cortar por byte e seguro). Memoria = um pedaco de cada vez.
 */
async function* linhasCompletas(arquivo: string, m: MembroZip): AsyncGenerator<string> {
  const cab = await lerPedaco(arquivo, m.offLocal, m.offLocal + 29);
  const ini = inicioDosDados(cab, m.offLocal);
  const entrada = createReadStream(arquivo, { start: ini, end: ini + m.comprimido - 1, highWaterMark: 1 << 20 });
  const inflate = createInflateRaw({ chunkSize: 1 << 20 });
  entrada.pipe(inflate);
  let resto = '';
  for await (const pedaco of inflate) {
    resto += (pedaco as Buffer).toString(ENCODING_CNO);
    let i = 0;
    let q: number;
    while ((q = resto.indexOf('\n', i)) >= 0) {
      const l = resto.slice(i, q);
      i = q + 1;
      if (l.length) yield l.endsWith('\r') ? l.slice(0, -1) : l;
    }
    resto = resto.slice(i);
  }
  if (resto.trim()) yield resto.endsWith('\r') ? resto.slice(0, -1) : resto;
}

/** Linhas lidas (bruta + canonica) de um membro; a primeira linha e o cabecalho e e conferida contra o contrato. */
async function* fluxoLido<T>(arquivo: string, m: MembroZip, ler: (cab: string[], ix: Record<string, number>, campos: string[]) => LinhaLida<T> | undefined, contagem: { linhas: number }): AsyncGenerator<LinhaLida<T>> {
  let cab: string[] | undefined;
  let ix: Record<string, number> | undefined;
  for await (const l of linhasCompletas(arquivo, m)) {
    if (!cab || !ix) {
      cab = cabecalhoCsvCno(l);
      const c = conferirCabecalho(cab, CABECALHOS_CNO[m.nome as ArquivoCno]);
      if (!c.ok) throw new Error(`${m.nome}: cabecalho divergente do contrato (faltando: ${c.faltando.join(', ') || '—'}; inesperados: ${c.inesperados.join(', ') || '—'})`);
      ix = indicesDe(cab);
      continue;
    }
    contagem.linhas++;
    const v = ler(cab, ix, camposCsvCno(l));
    if (v) yield v;
  }
}

const membroDe = (membros: MembroZip[], nome: ArquivoCno): MembroZip => {
  const m = membros.find((x) => x.nome === nome);
  if (!m) throw new Error(`membro ausente no ZIP: ${nome}`);
  return m;
};

const exigirArquivo = (arquivo?: string): string => {
  if (!arquivo) throw new Error('informe --arquivo <cno.zip> (baixe uma vez com `baixar --destino <dir>`; nao baixe 315 MiB a cada analise)');
  if (!existsSync(arquivo)) throw new Error(`arquivo nao encontrado: ${arquivo}`);
  return arquivo;
};

async function ordenacao(arquivoOpt?: string): Promise<void> {
  const arquivo = exigirArquivo(arquivoOpt);
  const membros = await membrosLocais(arquivo);
  console.log('arquivo:', arquivo, '\n');
  let todos = true;
  const t0 = Date.now();
  for (const nome of ['cno.csv', 'cno_areas.csv', 'cno_cnaes.csv', 'cno_vinculos.csv'] as const) {
    const m = membroDe(membros, nome);
    const contagem = { linhas: 0 };
    const chaves = (async function* () {
      for await (const l of linhasCompletas(arquivo, m)) {
        if (contagem.linhas === 0 && l.startsWith('"CNO"')) { contagem.linhas = 1; continue; }
        contagem.linhas++;
        // so a chave: primeira celula, sem aspas (o CNO vem sem aspas no artefato)
        const fim = l.indexOf(',');
        yield { cno: fim >= 0 ? l.slice(0, fim) : l };
      }
    })();
    const r = await verificarOrdenacao(chaves, nome);
    todos &&= r.ordenado;
    console.log(`  ${nome.padEnd(20)} SORTED_ASC = ${r.ordenado ? 'YES' : 'NO '}   linhas=${(contagem.linhas - 1).toLocaleString('pt-BR')}` + (r.quebra ? `   quebra na linha ${r.quebra.linha}: ${r.quebra.anterior} -> ${r.quebra.atual}` : ''));
  }
  console.log(`\nSTREAMING_MERGE_JOIN = ${todos ? 'VIAVEL' : 'BLOCKED'}   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!todos) process.exitCode = 1;
}

async function perfil(arquivoOpt?: string, saida?: string, referenciaOpt?: string): Promise<ResumoPerfil> {
  const arquivo = exigirArquivo(arquivoOpt);
  const membros = await membrosLocais(arquivo);
  const referencia = referenciaOpt ?? membroDe(membros, 'cno.csv').modificadoEm ?? new Date().toISOString().slice(0, 10);
  console.log('arquivo   :', arquivo);
  console.log('referencia:', referencia, referenciaOpt ? '(informada)' : '(data do membro cno.csv dentro do ZIP)');
  console.log('');

  const contagens = { obras: { linhas: 0 }, areas: { linhas: 0 }, cnaes: { linhas: 0 }, vinculos: { linhas: 0 } };
  const acumulador = new PerfilCno(referencia);
  const diag: Record<string, number> = {};
  let observacoes = 0;
  let rssMax = process.memoryUsage().rss;
  const t0 = Date.now();

  const eventos = juntarOrdenadoCno({
    obras: fluxoLido(arquivo, membroDe(membros, 'cno.csv'), lerObraCno, contagens.obras),
    areas: fluxoLido(arquivo, membroDe(membros, 'cno_areas.csv'), lerAreaCno, contagens.areas),
    cnaes: fluxoLido(arquivo, membroDe(membros, 'cno_cnaes.csv'), lerCnaeCno, contagens.cnaes),
    vinculos: fluxoLido(arquivo, membroDe(membros, 'cno_vinculos.csv'), lerVinculoCno, contagens.vinculos),
  });
  for await (const ev of eventos) {
    if (ev.tipo === 'diagnostico') { diag[ev.diagnostico.tipo] = (diag[ev.diagnostico.tipo] ?? 0) + 1; continue; }
    acumulador.adicionar(ev.observacao);
    observacoes++;
    if (observacoes % 100_000 === 0) {
      const rss = process.memoryUsage().rss;
      if (rss > rssMax) rssMax = rss;
      process.stdout.write(`\r  ${observacoes.toLocaleString('pt-BR')} CNOs · ${((Date.now() - t0) / 1000).toFixed(0)} s · RSS ${mib(rss)}      `);
    }
  }
  const segundos = (Date.now() - t0) / 1000;
  rssMax = Math.max(rssMax, process.memoryUsage().rss);
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  const r = acumulador.resumo();
  const desempenho = {
    segundos: Math.round(segundos * 10) / 10,
    cnosPorSegundo: Math.round(observacoes / segundos),
    rssMaxMiB: Math.round(rssMax / 1024 / 1024),
    linhas: { obras: contagens.obras.linhas, areas: contagens.areas.linhas, cnaes: contagens.cnaes.linhas, vinculos: contagens.vinculos.linhas },
    diagnosticos: diag,
  };
  imprimirPerfil(r, desempenho);

  if (saida) {
    mkdirSync(dirname(saida), { recursive: true });
    writeFileSync(saida, JSON.stringify({ geradoEm: new Date().toISOString(), snapshot: { arquivo, membros: membros.map((m) => ({ nome: m.nome, bruto: m.bruto, modificadoEm: m.modificadoEm })) }, desempenho, perfil: r }, null, 2));
    console.log('\nresumo agregado salvo em', saida, '(so agregados; sem payload, sem dado pessoal)');
  }
  return r;
}

const n = (v: number) => v.toLocaleString('pt-BR');
const pctDe = (v: number, total: number) => (total ? `${((100 * v) / total).toFixed(1)}%` : '—');
const lista = (l: [string, number][], total: number, limite = 12) => l.slice(0, limite).map(([k, v]) => `      ${k.padEnd(34)} ${n(v).padStart(11)}  ${pctDe(v, total).padStart(6)}`).join('\n');

function imprimirPerfil(r: ResumoPerfil, d: { segundos: number; cnosPorSegundo: number; rssMaxMiB: number; linhas: Record<string, number>; diagnosticos: Record<string, number> }): void {
  console.log('=== UNIVERSO CNO (snapshot completo, somente leitura) ===');
  console.log(`  total CNOs          ${n(r.total)}`);
  console.log(`  com PJ              ${n(r.pj)}  (${pctDe(r.pj, r.total)})   sem PJ ${n(r.semPj)}`);
  console.log(`  com CNPJ valido     ${n(r.cnpjValido)}`);
  console.log(`  linhas lidas        obras=${n(d.linhas.obras)} areas=${n(d.linhas.areas)} cnaes=${n(d.linhas.cnaes)} vinculos=${n(d.linhas.vinculos)}`);
  console.log(`  diagnosticos        ${JSON.stringify(d.diagnosticos)}`);
  console.log(`  desempenho          ${d.segundos} s · ${n(d.cnosPorSegundo)} CNOs/s · RSS max ${d.rssMaxMiB} MiB`);
  console.log('\n  por situacao\n' + lista(r.porSituacao, r.total));
  console.log('\n  por UF (top 12)\n' + lista(r.porUf, r.total));
  console.log('\n  por categoria (obras que tem a categoria)\n' + lista(r.porCategoria, r.total));
  console.log('\n  por destinacao\n' + lista(r.porDestinacao, r.total));
  console.log('\n  por tipo construtivo\n' + lista(r.porTipoConstrutivo, r.total));
  console.log('\n  por qualificacao do responsavel\n' + lista(r.porQualificacao, r.total));
  console.log('\n  por sinal\n' + lista(r.porSinal, r.total));
  console.log(`\n  por idade do evento (referencia ${r.referencia})\n` + lista(r.porIdade, r.total));
  console.log('\n  por area total (m2; outra unidade = sem area)\n' + lista(r.porArea, r.total));
  console.log('\n  intersecoes (Brasil)\n' + lista(r.intersecoes, r.total, 20));
  console.log('\n=== GOIAS (relatorio, nao regra) ===');
  console.log(`  total ${n(r.goias.total)} · PJ ${n(r.goias.pj)} · PJ+sinal ${n(r.goias.sinal)} · PJ+sinal<=365d ${n(r.goias.sinalRecente365)}`);
  console.log('  por destinacao\n' + lista(r.goias.porDestinacao, r.goias.total));
  console.log('  por area\n' + lista(r.goias.porArea, r.goias.total));
  console.log('  top municipios\n' + lista(r.goias.topMunicipios, r.goias.total, 15));
  imprimirCenarios(r);
}

function imprimirCenarios(r: ResumoPerfil): void {
  console.log('\n=== CENARIOS (hipoteses para medir; nenhum e "o correto") ===');
  for (const c of r.cenarios) {
    console.log(`  ${c.id} · ${c.nome}`);
    console.log(`      Brasil ${n(c.total).padStart(9)}   GO ${n(c.go).padStart(7)}   CNO_NEW ${n(c.porSinal.find((x) => x[0] === 'CNO_NEW')?.[1] ?? 0)}   CNO_EXPANSION ${n(c.porSinal.find((x) => x[0] === 'CNO_EXPANSION')?.[1] ?? 0)}   area p50 ${c.area.p50 ?? '—'} m2 · p90 ${c.area.p90 ?? '—'} m2`);
    console.log(`      top UFs: ${c.porUf.slice(0, 8).map(([u, v]) => `${u} ${n(v)}`).join(' · ')}`);
  }
  console.log('\n=== SENSIBILIDADE: PJ + CNPJ valido + sinal · linhas = janela (dias) · colunas = area minima (m2) ===');
  const cab = '            ' + r.sensibilidade.areas.map((a) => String(a).padStart(9)).join('');
  for (const [rotulo, matriz] of [['Brasil', r.sensibilidade.brasil], ['GO', r.sensibilidade.go]] as const) {
    console.log(`  ${rotulo}\n${cab}`);
    matriz.forEach((linha, i) => console.log(`   ${String(r.sensibilidade.janelas[i]).padStart(5)} d  ` + linha.map((v) => n(v).padStart(9)).join('')));
  }
  console.log('\n=== TAMANHO DO ENVELOPE (bytes, so obras com PJ) ===');
  const p = r.payload;
  console.log(`  n ${n(p.n)} · p50 ${p.p50} · p90 ${p.p90} · p95 ${p.p95} · p99 ${p.p99} · max ${p.max} · media ${p.media}`);
  console.log(`  >100 KB: ${p.acima100k} · >500 KB: ${p.acima500k} · >1 MB: ${p.acima1m}`);
  console.log(`  maiores: ${p.maiores.map((m) => `${m.cno} (${n(m.bytes)} B)`).join(' · ')}`);
  console.log('\n=== DUPLICIDADE POR CNPJ RESPONSAVEL ===');
  const q = r.responsaveis;
  console.log(`  CNPJs unicos ${n(q.cnpjsUnicos)} · obras com CNPJ ${n(q.obrasComCnpj)} · media ${q.mediaObrasPorCnpj} · mediana ${q.medianaObrasPorCnpj} · p90 ${q.p90} · p99 ${q.p99} · max ${q.maximo}`);
  console.log('  distribuicao: ' + q.distribuicao.map(([k, v]) => `${k} obra(s): ${n(v)}`).join(' · '));
  console.log('\nPERSISTENCIA = NENHUMA · POLITICA ADOTADA = NENHUMA');
}

async function simular(perfilJson?: string, arquivoOpt?: string, referenciaOpt?: string): Promise<void> {
  if (perfilJson) {
    const salvo = JSON.parse(readFileSync(perfilJson, 'utf8')) as { perfil: ResumoPerfil };
    console.log('perfil lido de', perfilJson, '(referencia', salvo.perfil.referencia + ')');
    imprimirCenarios(salvo.perfil);
    return;
  }
  await perfil(arquivoOpt, undefined, referenciaOpt);
}


// ------------------------------------------------------------------------------------------ LE-3C: dry-run do piloto
interface DryRun { manifest: ManifestPiloto; recusas: Record<string, number>; elegiveis: EntradaManifest[]; dist: Record<string, [string, number][]>; segundos: number }

async function dryRunPiloto(arquivo: string, dataReferencia: string, limite: number, snapshot: ManifestPiloto['snapshot']): Promise<DryRun> {
  const membros = await membrosLocais(arquivo);
  const politica = politicaPiloto(dataReferencia);
  const contagens = { obras: { linhas: 0 }, areas: { linhas: 0 }, cnaes: { linhas: 0 }, vinculos: { linhas: 0 } };
  const recusas: Record<string, number> = {};
  const elegiveis: EntradaManifest[] = [];
  const dist = { sinal: {} as Record<string, number>, destinacao: {} as Record<string, number>, municipio: {} as Record<string, number>, area: {} as Record<string, number>, qualificacao: {} as Record<string, number>, idade: {} as Record<string, number> };
  const mais = (c: Record<string, number>, k: string) => { c[k] = (c[k] ?? 0) + 1; };
  let analisado = 0;
  const t0 = Date.now();

  const eventos = juntarOrdenadoCno({
    obras: fluxoLido(arquivo, membroDe(membros, 'cno.csv'), lerObraCno, contagens.obras),
    areas: fluxoLido(arquivo, membroDe(membros, 'cno_areas.csv'), lerAreaCno, contagens.areas),
    cnaes: fluxoLido(arquivo, membroDe(membros, 'cno_cnaes.csv'), lerCnaeCno, contagens.cnaes),
    vinculos: fluxoLido(arquivo, membroDe(membros, 'cno_vinculos.csv'), lerVinculoCno, contagens.vinculos),
  });
  for await (const ev of eventos) {
    if (ev.tipo !== 'observacao') continue;
    analisado++;
    const { resultado, entrada } = avaliarPiloto(ev.observacao, politica);
    if (!entrada) { for (const m of resultado.motivosRecusa) mais(recusas, m); continue; }
    elegiveis.push(entrada);
    mais(dist.sinal, entrada.tipoSinal);
    for (const d of entrada.destinacoes.length ? entrada.destinacoes : ['—']) mais(dist.destinacao, d);
    mais(dist.municipio, entrada.municipio ?? '—');
    mais(dist.area, faixaArea(entrada.areaTotal));
    mais(dist.qualificacao, entrada.qualificacaoResponsavelNome ?? entrada.qualificacaoResponsavel ?? '—');
    mais(dist.idade, faixaIdade(diasEntre(entrada.eventoEm, dataReferencia)));
  }
  const ordenar = (c: Record<string, number>): [string, number][] => Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const manifest = montarManifest({ dataReferencia, snapshot, totalAnalisado: analisado, elegiveis, limite });
  return { manifest, recusas, elegiveis, dist: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, ordenar(v)])), segundos: (Date.now() - t0) / 1000 };
}

/** Descritor do snapshot para AUDITORIA do lote: tamanho local + (se a rede permitir) ETag/Last-Modified oficiais. */
async function descritorDoSnapshot(arquivo: string): Promise<ManifestPiloto['snapshot']> {
  const contentLength = statSync(arquivo).size;
  try {
    const r = await buscar(URL_DADOS, {}, 'HEAD');
    const remoto = Number(r.headers.get('content-length'));
    return { arquivo, contentLength, etag: r.headers.get('etag') ?? undefined, lastModified: r.headers.get('last-modified') ?? undefined, ...(remoto !== contentLength ? { aviso: `tamanho local difere do remoto (${remoto})` } : {}) } as ManifestPiloto['snapshot'];
  } catch {
    return { arquivo, contentLength };
  }
}

async function piloto(arquivoOpt?: string, dataReferencia?: string, limiteOpt?: string, saida = 'dados/cno/pilot-manifest-v1.json'): Promise<void> {
  const arquivo = exigirArquivo(arquivoOpt);
  if (!dataReferencia) throw new Error('informe --data AAAA-MM-DD: a data de referencia e explicita, nunca o relogio');
  const limite = Number(limiteOpt ?? 50);
  const snapshot = await descritorDoSnapshot(arquivo);
  const politica = politicaPiloto(dataReferencia);

  console.log('=== LE-3C · DRY-RUN DA POLITICA PILOTO (nada e persistido) ===');
  console.log('politica  :', CNO_PILOT_POLICY_VERSION, JSON.stringify(politica));
  console.log('referencia:', dataReferencia, '→ eventoDepoisDe', politica.eventoDepoisDe, `(${CNO_PILOT_POLICY_V1.janelaDias} dias)`);
  console.log('snapshot  :', JSON.stringify(snapshot));
  console.log('');

  // duas execucoes sobre o mesmo snapshot: o lote tem de ser identico
  const r1 = await dryRunPiloto(arquivo, dataReferencia, limite, snapshot);
  process.stdout.write(`  execucao 1: ${r1.segundos.toFixed(0)} s · elegiveis ${r1.manifest.totalElegivel}\n`);
  const r2 = await dryRunPiloto(arquivo, dataReferencia, limite, snapshot);
  process.stdout.write(`  execucao 2: ${r2.segundos.toFixed(0)} s · elegiveis ${r2.manifest.totalElegivel}\n`);
  const deterministico = manifestosIguais(r1.manifest, r2.manifest);
  console.log(`  PILOT_MANIFEST_DETERMINISTIC = ${deterministico ? 'YES' : 'NO'}\n`);

  const m = r1.manifest;
  console.log(`TOTAL_ANALISADO ${n(m.totalAnalisado)} · TOTAL_ELEGIVEL ${n(m.totalElegivel)} · TOTAL_RECUSADO ${n(m.totalRecusado)}`);
  console.log('\n  elegiveis por sinal      :', r1.dist.sinal.map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  elegiveis por destinacao :', r1.dist.destinacao.map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  elegiveis por municipio  :', r1.dist.municipio.slice(0, 15).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  elegiveis por area       :', r1.dist.area.map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  elegiveis por qualif.    :', r1.dist.qualificacao.map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  elegiveis por idade      :', r1.dist.idade.map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  motivos de recusa        :', Object.entries(r1.recusas).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${n(v)}`).join(' · '));

  const met = metricasLote(m.lote);
  console.log(`\n=== LOTE (${met.tamanho} de ${m.totalElegivel}; ordem: evento DESC, CNO ASC — controle, nao prioridade) ===`);
  console.log(`  sinal ${met.porSinal.map(([k, v]) => `${k} ${v}`).join(' · ')} · area p50 ${met.areaP50 ?? '—'} m2 · p90 ${met.areaP90 ?? '—'} m2`);
  console.log(`  CNPJs unicos ${met.cnpjsUnicos} · maior ocupacao ${met.maiorOcupacao} vagas · CNPJs com >1 vaga ${met.cnpjsComMaisDeUmaVaga}`);
  console.log(`  municipios: ${met.municipios.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  destinacoes: ${met.destinacoes.map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  console.log('\n=== CAP POR EMPRESA — simulado, NAO aplicado ===');
  const caps = [null, 5, 3, 1].map((cap) => simularCap(r1.elegiveis, cap, limite));
  for (const c of caps) console.log(`  cap ${c.cap === null ? 'nenhum' : String(c.cap).padStart(6)} → lote ${String(c.lote).padStart(3)} · empresas unicas ${String(c.empresasUnicasNoLote).padStart(3)} · CNOs fora pelo cap ${String(c.cnosExcluidosPeloCap).padStart(4)} · maior ocupacao ${c.maiorOcupacaoNoLote}`);

  console.log('\n=== PRE-VISUALIZACAO DOS ' + m.lote.length + ' (so PJ; sem evidence, sem endereco) ===');
  console.log('  ' + ['#', 'CNO', 'evento', 'municipio', 'tipo', 'm2', 'destinacao', 'razao social da PJ'].map((h, i) => h.padEnd([3, 13, 11, 22, 14, 8, 26, 40][i])).join(''));
  m.lote.forEach((e, i) => console.log('  ' + [
    String(i + 1), e.cno, e.eventoEm, (e.municipio ?? '—').slice(0, 21), e.tipoSinal, String(e.areaTotal ?? '—'), (e.destinacoes.join(', ') || '—').slice(0, 25), e.nomeResponsavel.slice(0, 40),
  ].map((v, j) => v.padEnd([3, 13, 11, 22, 14, 8, 26, 40][j])).join('')));

  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, JSON.stringify({
    geradoEm: new Date().toISOString(),
    resumo: { policy: m.politica, versaoPolitica: m.versaoPolitica, dataReferencia: m.dataReferencia, snapshot: m.snapshot, totalAnalisado: m.totalAnalisado, totalElegiveis: m.totalElegivel, totalRecusado: m.totalRecusado, batchSize: m.batchSize, deterministico, fingerprints: m.fingerprints },
    distribuicoesElegiveis: r1.dist,
    motivosRecusa: r1.recusas,
    metricasLote: met,
    simulacaoCap: caps,
    lote: m.lote,
  }, null, 2));
  console.log(`\nmanifest salvo em ${saida} (local, gitignored; sem evidence, sem dado de PF)`);
  console.log('PERSISTENCIA = NENHUMA · INGESTAO = NENHUMA');
  if (!deterministico) process.exitCode = 1;
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
  else if (comando === 'ordenacao') await ordenacao(opcao('arquivo'));
  else if (comando === 'perfil') await perfil(opcao('arquivo'), opcao('saida'), opcao('referencia'));
  else if (comando === 'simular') await simular(opcao('perfil'), opcao('arquivo'), opcao('referencia'));
  else if (comando === 'piloto') await piloto(opcao('arquivo'), opcao('data'), opcao('limite'), opcao('saida'));
  else {
    console.log('uso: npx vite-node scripts/cno.mts -- <probe | validar | amostra | baixar | ordenacao | perfil | simular | piloto> [--arquivo <cno.zip>] [--limite N] [--destino <dir>] [--saida <perfil.json>] [--perfil <perfil.json>] [--referencia AAAA-MM-DD]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('FALHA:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
