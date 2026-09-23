/**
 * Helpers de ZIP/streaming do snapshot LOCAL do CNO, compartilhados por `scripts/cno.mts` e
 * `scripts/cno-intake-producao.mts`. So disco; nada de rede, nada de Radar, nada de Supabase.
 * Leitura sempre por faixa e em streaming: o ZIP tem ~315 MiB e o CSV cru ~1,4 GiB.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import {
  CABECALHOS_CNO, ENCODING_CNO, cabecalhoCsvCno, camposCsvCno, conferirCabecalho, indicesDe,
  type ArquivoCno, type LinhaLida,
} from '../../src/core/radar/cnoDadosAbertos';

export interface MembroZip { nome: string; bruto: number; comprimido: number; offLocal: number; metodo: number; modificadoEm?: string }

export function lerDiretorioCentral(cd: Buffer): MembroZip[] {
  const membros: MembroZip[] = [];
  let p = 0;
  while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const metodo = cd.readUInt16LE(p + 10);
    const modDate = cd.readUInt16LE(p + 14);
    const modificadoEm = `${((modDate >> 9) & 0x7f) + 1980}-${String((modDate >> 5) & 0x0f).padStart(2, '0')}-${String(modDate & 0x1f).padStart(2, '0')}`;
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

/** Leitura por faixa no disco: stream com start/end, nunca readFile do arquivo inteiro. */
export function lerPedaco(caminho: string, inicio: number, fim: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    createReadStream(caminho, { start: inicio, end: fim })
      .on('data', (d) => partes.push(d as Buffer))
      .on('end', () => resolve(Buffer.concat(partes)))
      .on('error', reject);
  });
}

export async function membrosLocais(caminho: string): Promise<MembroZip[]> {
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

export const inicioDosDados = (cab: Buffer, off: number): number => off + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);

/**
 * Todas as linhas de um membro do ZIP LOCAL, em streaming: stream de disco com start/end -> inflateRaw -> split
 * por '\n' em latin1 (1 byte = 1 char, entao cortar por byte e seguro). Memoria = um pedaco de cada vez.
 */
export async function* linhasCompletas(arquivo: string, m: MembroZip): AsyncGenerator<string> {
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
export async function* fluxoLido<T>(arquivo: string, m: MembroZip, ler: (cab: string[], ix: Record<string, number>, campos: string[]) => LinhaLida<T> | undefined, contagem: { linhas: number }): AsyncGenerator<LinhaLida<T>> {
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

export const membroDe = (membros: MembroZip[], nome: ArquivoCno): MembroZip => {
  const m = membros.find((x) => x.nome === nome);
  if (!m) throw new Error(`membro ausente no ZIP: ${nome}`);
  return m;
};

export const exigirArquivo = (arquivo?: string): string => {
  if (!arquivo) throw new Error('informe --arquivo <cno.zip> (baixe uma vez com `baixar --destino <dir>`; nao baixe 315 MiB a cada analise)');
  if (!existsSync(arquivo)) throw new Error(`arquivo nao encontrado: ${arquivo}`);
  return arquivo;
};
