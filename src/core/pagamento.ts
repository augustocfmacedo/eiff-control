// Forma e dados de pagamento do lançamento (pedido do Augusto em 14/10/2026): quem pede um pagamento ao Diretor Financeiro
// escolhe COMO pagar (PIX, boleto, transferência, cartão, dinheiro) e informa os dados; eles viajam no próprio título
// (financial_entry.payment_method / payment_details, migration 0072) e aparecem no detalhe em Lançamentos e Contas a pagar.
// Regras puras: normalizar (só os campos da forma, sem espaços, dígitos onde é número), validar e resumir. O banco repete o
// mínimo (forma do catálogo, objeto pequeno, campos obrigatórios por forma) na porta do Solicitante.
import { cnpjValido } from './radar/normalizar';

export const FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];
export const TIPOS_CHAVE_PIX = ['CPF', 'CNPJ', 'E-mail', 'Telefone', 'Aleatória'] as const;
export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];
export const TIPOS_CONTA = ['Corrente', 'Poupança'] as const;

export interface DadosPagamento {
  pixTipo?: TipoChavePix;
  pixChave?: string;
  boletoLinha?: string; // linha digitável ou código de barras, só dígitos
  banco?: string;
  agencia?: string;
  conta?: string;
  tipoConta?: (typeof TIPOS_CONTA)[number];
  favorecido?: string; // titular da conta / beneficiário
  documentoFavorecido?: string; // CPF ou CNPJ do favorecido, só dígitos
  observacao?: string;
}

const digitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const texto = (s?: string, n = 120) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { const s = d.slice(0, n).split('').reduce((a, c, i) => a + Number(c) * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
const documentoValido = (d: string) => (d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) && !/^(\d)\1{13}$/.test(d) : false);

export const ehFormaPagamento = (v: unknown): v is FormaPagamento => typeof v === 'string' && (FORMAS_PAGAMENTO as readonly string[]).includes(v);

/** Só os campos da forma escolhida, limpos (o que sobra de outra forma é descartado). */
export function normalizarDadosPagamento(forma: FormaPagamento, d: DadosPagamento = {}): DadosPagamento {
  const obs = texto(d.observacao, 300);
  const comObs = (x: DadosPagamento): DadosPagamento => (obs ? { ...x, observacao: obs } : x);
  if (forma === 'PIX') {
    const tipo = d.pixTipo;
    const bruto = (d.pixChave ?? '').trim();
    // telefone: DDD + número (10 ou 11 dígitos) ganha o +55; com o 55 já digitado (12 ou 13) fica como está
    const tel = (n: string) => (n ? `+${n.length === 10 || n.length === 11 ? `55${n}` : n}` : '');
    const chave = tipo === 'CPF' || tipo === 'CNPJ' ? digitos(bruto) : tipo === 'Telefone' ? tel(digitos(bruto)) : bruto.toLowerCase();
    return comObs({ pixTipo: tipo, pixChave: chave, ...(texto(d.favorecido) ? { favorecido: texto(d.favorecido) } : {}) });
  }
  if (forma === 'Boleto') return comObs({ boletoLinha: digitos(d.boletoLinha), ...(texto(d.favorecido) ? { favorecido: texto(d.favorecido) } : {}) });
  if (forma === 'Transferência') {
    return comObs({ banco: texto(d.banco, 60), agencia: texto(d.agencia, 12), conta: texto(d.conta, 20), tipoConta: d.tipoConta === 'Poupança' ? 'Poupança' : 'Corrente', favorecido: texto(d.favorecido), documentoFavorecido: digitos(d.documentoFavorecido) });
  }
  return comObs({});
}

/** Erros dos dados para a forma (lista vazia = ok). Recebe os dados JÁ normalizados ou não (normaliza antes de validar). */
export function validarDadosPagamento(forma: FormaPagamento | undefined, dados?: DadosPagamento): string[] {
  if (!forma) return [];
  if (!ehFormaPagamento(forma)) return ['Forma de pagamento inválida.'];
  const d = normalizarDadosPagamento(forma, dados);
  const erros: string[] = [];
  if (forma === 'PIX') {
    const c = d.pixChave ?? '';
    if (!d.pixTipo || !(TIPOS_CHAVE_PIX as readonly string[]).includes(d.pixTipo)) erros.push('Pagamento: escolha o tipo da chave PIX.');
    else if (!c) erros.push('Pagamento: informe a chave PIX.');
    else if (d.pixTipo === 'CPF' && !cpfValido(c)) erros.push('Pagamento: chave PIX CPF inválida.');
    else if (d.pixTipo === 'CNPJ' && !(c.length === 14 && cnpjValido(c))) erros.push('Pagamento: chave PIX CNPJ inválida.');
    else if (d.pixTipo === 'E-mail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) erros.push('Pagamento: chave PIX e-mail inválida.');
    else if (d.pixTipo === 'Telefone' && !/^\+55\d{10,11}$/.test(c)) erros.push('Pagamento: chave PIX telefone inválida (DDD + número).');
    else if (d.pixTipo === 'Aleatória' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c)) erros.push('Pagamento: chave PIX aleatória inválida (formato 0000…-…).');
  } else if (forma === 'Boleto') {
    const n = (d.boletoLinha ?? '').length;
    if (!n) erros.push('Pagamento: informe a linha digitável do boleto.');
    else if (![44, 47, 48].includes(n)) erros.push(`Pagamento: linha digitável do boleto com ${n} dígitos (esperado 47, 48 ou código de barras com 44).`);
  } else if (forma === 'Transferência') {
    if (!d.banco) erros.push('Pagamento: informe o banco.');
    if (!d.agencia) erros.push('Pagamento: informe a agência.');
    if (!d.conta) erros.push('Pagamento: informe a conta.');
    if (!d.favorecido) erros.push('Pagamento: informe o favorecido (titular da conta).');
    if (!d.documentoFavorecido) erros.push('Pagamento: informe o CPF ou CNPJ do favorecido.');
    else if (!documentoValido(d.documentoFavorecido)) erros.push('Pagamento: CPF/CNPJ do favorecido inválido.');
  }
  return erros;
}

const fmtDoc = (d: string) => (d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d);
/** Linha digitável em blocos de 5 para leitura (só exibição; copiar usa só dígitos). */
export const linhaEmBlocos = (l: string) => l.replace(/(\d{5})(?=\d)/g, '$1 ');

/** Linhas "rótulo: valor" para exibir/copiar; `copiar` é o valor a copiar (chave PIX, linha do boleto). */
export function linhasPagamento(forma: FormaPagamento, dados?: DadosPagamento): { rotulo: string; valor: string; copiar?: string }[] {
  const d = normalizarDadosPagamento(forma, dados);
  const l: { rotulo: string; valor: string; copiar?: string }[] = [{ rotulo: 'Forma', valor: forma }];
  if (forma === 'PIX') {
    const chave = d.pixTipo === 'CPF' || d.pixTipo === 'CNPJ' ? fmtDoc(d.pixChave ?? '') : d.pixChave ?? '';
    l.push({ rotulo: `Chave PIX (${d.pixTipo ?? '—'})`, valor: chave, copiar: d.pixChave });
    if (d.favorecido) l.push({ rotulo: 'Favorecido', valor: d.favorecido });
  } else if (forma === 'Boleto') {
    l.push({ rotulo: 'Linha digitável', valor: linhaEmBlocos(d.boletoLinha ?? ''), copiar: d.boletoLinha });
    if (d.favorecido) l.push({ rotulo: 'Beneficiário', valor: d.favorecido });
  } else if (forma === 'Transferência') {
    l.push({ rotulo: 'Banco', valor: d.banco ?? '' }, { rotulo: 'Agência', valor: d.agencia ?? '', copiar: d.agencia }, { rotulo: `Conta ${(d.tipoConta ?? 'Corrente').toLowerCase()}`, valor: d.conta ?? '', copiar: d.conta });
    l.push({ rotulo: 'Favorecido', valor: d.favorecido ?? '' }, { rotulo: 'CPF/CNPJ', valor: fmtDoc(d.documentoFavorecido ?? ''), copiar: d.documentoFavorecido });
  }
  if (d.observacao) l.push({ rotulo: 'Observação', valor: d.observacao });
  return l;
}

/** Uma linha curta: "PIX · CNPJ 12.345.678/0001-90", "Boleto · 2379…", "Transferência · Itaú ag 1234 cc 5678-9". */
export function resumoPagamento(forma?: FormaPagamento, dados?: DadosPagamento): string {
  if (!forma) return '';
  const d = normalizarDadosPagamento(forma, dados);
  if (forma === 'PIX') return `PIX · ${d.pixTipo ?? ''} ${d.pixTipo === 'CPF' || d.pixTipo === 'CNPJ' ? fmtDoc(d.pixChave ?? '') : d.pixChave ?? ''}`.trim();
  if (forma === 'Boleto') return `Boleto · ${(d.boletoLinha ?? '').slice(0, 5)}…${(d.boletoLinha ?? '').slice(-4)}`;
  if (forma === 'Transferência') return `Transferência · ${d.banco} ag ${d.agencia} ${d.tipoConta === 'Poupança' ? 'cp' : 'cc'} ${d.conta}`;
  return forma;
}
