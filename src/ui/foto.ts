// Foto de campo: reduz a imagem da camera (lado maior <= 1280 px) e devolve um JPEG em data URL, pequeno o bastante para
// ir na linha do banco e na fila offline. Corrige orientacao pelo proprio navegador (createImageBitmap com imageOrientation).
export const FOTO_LADO_MAX = 1280;
export const FOTO_QUALIDADE = 0.72;
export const FOTO_BYTES_MAX = 800_000;

export async function comprimirFoto(arquivo: Blob, ladoMax = FOTO_LADO_MAX, qualidade = FOTO_QUALIDADE): Promise<string> {
  const bitmap = await criarBitmap(arquivo);
  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * escala)); canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Não foi possível processar a foto neste navegador.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();
  let q = qualidade; let saida = canvas.toDataURL('image/jpeg', q);
  while (saida.length > FOTO_BYTES_MAX && q > 0.35) { q -= 0.1; saida = canvas.toDataURL('image/jpeg', q); }
  if (saida.length > FOTO_BYTES_MAX) throw new Error('Foto grande demais mesmo comprimida: tente enquadrar mais de perto.');
  return saida;
}

async function criarBitmap(arquivo: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(arquivo, { imageOrientation: 'from-image' } as ImageBitmapOptions); } catch { /* cai no <img> */ } }
  const url = URL.createObjectURL(arquivo);
  try { return await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = url; }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
