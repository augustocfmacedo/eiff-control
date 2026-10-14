// Documentos dos pedidos de pagamento (0073): nota fiscal e boleto (quem pediu ou o Financeiro), comprovante (quem paga).
// Regras puras, espelho das funções anexo_pode_ver / anexo_pode_anexar / anexo_remover do banco — o banco é quem garante.
import type { AnexoLancamento, Dataset, Lancamento, Papel, TipoAnexo, Usuario } from './types';

export const TIPOS_ANEXO: { id: TipoAnexo; rotulo: string }[] = [
  { id: 'NOTA_FISCAL', rotulo: 'Nota fiscal' },
  { id: 'BOLETO', rotulo: 'Boleto' },
  { id: 'COMPROVANTE', rotulo: 'Comprovante de pagamento' },
  { id: 'OUTRO', rotulo: 'Outro documento' },
];
export const ROTULO_ANEXO = Object.fromEntries(TIPOS_ANEXO.map((t) => [t.id, t.rotulo])) as Record<TipoAnexo, string>;
export const MIMES_ANEXO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;

const PAPEIS_PAGAM: readonly Papel[] = ['Administrador', 'Diretoria', 'Financeiro'];
const PAPEIS_VEEM: readonly Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'];
const ehAutor = (u: Usuario, l: Lancamento) => l.criadoPor === u.nome;

/** Anexos ativos do lançamento, na ordem de envio. */
export const anexosDe = (ds: Dataset, id: string): AnexoLancamento[] => (ds.anexosLancamento ?? []).filter((a) => a.lancamentoId === id && !a.removidoEm).sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));

export const podeVerAnexos = (u: Usuario, l: Lancamento) => u.ativo && (PAPEIS_VEEM.includes(u.papel) || ehAutor(u, l));
/** Tipos que a pessoa pode anexar a este lançamento (vazio = nenhum). Comprovante é de quem paga. */
export function tiposQuePodeAnexar(u: Usuario, l: Lancamento): TipoAnexo[] {
  if (!u.ativo || l.status === 'Cancelado' || l.excluidoEm) return [];
  if (PAPEIS_PAGAM.includes(u.papel)) return TIPOS_ANEXO.map((t) => t.id);
  return ehAutor(u, l) ? ['NOTA_FISCAL', 'BOLETO', 'OUTRO'] : [];
}
export const podeRemoverAnexo = (u: Usuario, a: AnexoLancamento, l: Lancamento) => !a.removidoEm && (PAPEIS_PAGAM.includes(u.papel) || ((a.enviadoPorId ? a.enviadoPorId === u.id : a.enviadoPor === u.nome) && l.status !== 'Realizado'));

/** Erro do arquivo antes de enviar (null = ok). */
export function validarArquivoAnexo(f: { name: string; type: string; size: number }): string | null {
  if (!f.size) return 'Arquivo vazio.';
  if (f.size > TAMANHO_MAX_ANEXO) return `Arquivo com ${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB: o limite é 10 MB.`;
  const tipo = mimeDoArquivo(f);
  if (!tipo) return 'Envie PDF ou imagem (JPG, PNG, WEBP ou HEIC).';
  return null;
}
/** Tipo do arquivo pelo navegador ou, se vier vazio (comum no iPhone), pela extensão. */
export function mimeDoArquivo(f: { name: string; type: string }): (typeof MIMES_ANEXO)[number] | null {
  if ((MIMES_ANEXO as readonly string[]).includes(f.type)) return f.type as (typeof MIMES_ANEXO)[number];
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  const porExt: Record<string, (typeof MIMES_ANEXO)[number]> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
  return porExt[ext] ?? null;
}
export const extensaoDoMime = (m: string) => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[m] ?? 'bin';
export const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** O que falta no pedido: para a equipe (NF/boleto) e para quem paga (comprovante depois do pagamento). */
export function pendenciasDocumentos(ds: Dataset, l: Lancamento): string[] {
  const tipos = new Set(anexosDe(ds, l.id).map((a) => a.tipo));
  const p: string[] = [];
  if (l.status === 'Realizado' && !tipos.has('COMPROVANTE')) p.push('comprovante de pagamento');
  if (l.formaPagamento === 'Boleto' && !tipos.has('BOLETO') && l.status !== 'Realizado') p.push('boleto');
  return p;
}
