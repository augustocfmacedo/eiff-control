// Leitor de extratos OFX (Open Financial Exchange) usados pelos bancos brasileiros.
// Suporta OFX 1.x (SGML, sem tags de fechamento) e OFX 2.x (XML), datas com fuso e valores com virgula.

import type { PlanoConta } from './types';

export interface OfxTransacao {
  fitid: string; // identificador unico do banco (deduplicacao)
  data: string; // yyyy-mm-dd
  valor: number; // positivo = credito, negativo = debito
  tipo: string; // TRNTYPE (CREDIT, DEBIT, PAYMENT, XFER, FEE, INT, ...)
  memo: string;
  documento?: string; // CHECKNUM / REFNUM
}

export interface OfxExtrato {
  banco?: string;
  agencia?: string;
  conta?: string;
  moeda?: string;
  inicio?: string;
  fim?: string;
  saldoFinal?: number;
  dataSaldo?: string;
  transacoes: OfxTransacao[];
}

const data8 = (v?: string): string | undefined => {
  const m = (v ?? '').match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
};

const numero = (v?: string): number => {
  if (!v) return 0;
  let s = v.trim().replace(/\s/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const TIPOS_DEBITO = new Set(['DEBIT', 'PAYMENT', 'FEE', 'SRVCHG', 'CHECK', 'ATM', 'POS', 'DIRECTDEBIT', 'REPEATPMT', 'CASH']);
const TIPOS_CREDITO = new Set(['CREDIT', 'DEP', 'INT', 'DIRECTDEP', 'DIV']);
const MEMO_DEBITO = /\b(enviad[oa]|pagamento|pgto|pag\.|tarifa|tar\.|d[eé]bito|compra|saque|transfer[eê]ncia enviada|ted enviada|doc enviado|boleto pago|iof|juros|encargo|cobran[cç]a|parcela|mensalidade|anuidade|cesta)\b/i;
const MEMO_CREDITO = /\b(recebid[oa]|dep[oó]sito|cr[eé]dito|rejeitad[oa]|estorno|devolu[cç][aã]o|rendimento|resgate|transfer[eê]ncia recebida|ted recebida|doc recebido|liquida[cç][aã]o de cobran[cç]a)\b/i;

/**
 * Sinal do movimento. Alguns bancos (ex.: Banco do Brasil) exportam TRNAMT sempre positivo; nesse caso o
 * sentido vem do TRNTYPE e, se ele for generico, do historico.
 */
export function resolverSinal(valor: number, tipo: string, memo: string): number {
  if (valor < 0) return valor;
  const t = (tipo || '').toUpperCase();
  if (TIPOS_DEBITO.has(t)) return -valor;
  if (MEMO_DEBITO.test(memo) && !MEMO_CREDITO.test(memo)) return -valor;
  if (TIPOS_CREDITO.has(t)) return valor;
  return valor;
}

const limpar = (v: string) =>
  v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();

/** Decodifica o arquivo respeitando o CHARSET do cabecalho (bancos brasileiros usam 1252/ISO-8859-1). */
export function decodificarOfx(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const cabecalho = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  const charset = cabecalho.match(/CHARSET\s*[:=]\s*"?([A-Za-z0-9-]+)/i)?.[1]?.toUpperCase();
  const encoding = cabecalho.match(/ENCODING\s*[:=]\s*"?([A-Za-z0-9-]+)/i)?.[1]?.toUpperCase();
  if (charset === '1252' || charset === 'ISO-8859-1' || charset === 'LATIN1' || encoding === 'USASCII') {
    try { return new TextDecoder('windows-1252').decode(bytes); } catch { /* segue */ }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('windows-1252').decode(bytes); } catch { return new TextDecoder('latin1').decode(bytes); }
  }
}

export function parseOfx(texto: string): OfxExtrato {
  const idx = texto.search(/<OFX>/i);
  const corpo = idx >= 0 ? texto.slice(idx) : texto;
  if (!/<STMTTRN>/i.test(corpo) && !/<STMTRS>/i.test(corpo) && !/<CCSTMTRS>/i.test(corpo)) throw new Error('Arquivo não parece ser um extrato OFX (sem bloco STMTTRN/STMTRS).');
  const re = /<(\/?)([A-Za-z0-9._]+)>([^<]*)/g;
  const ext: OfxExtrato = { transacoes: [] };
  let atual: Partial<OfxTransacao> | null = null;
  let emLedger = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo))) {
    const fecha = m[1] === '/';
    const tag = m[2].toUpperCase();
    const val = limpar(m[3]);
    if (tag === 'STMTTRN') {
      if (!fecha) atual = {};
      else if (atual) { if (atual.fitid && atual.data) ext.transacoes.push({ fitid: atual.fitid, data: atual.data, valor: resolverSinal(atual.valor ?? 0, atual.tipo ?? '', atual.memo ?? ''), tipo: atual.tipo ?? '', memo: atual.memo ?? '', documento: atual.documento }); atual = null; }
      continue;
    }
    if (tag === 'LEDGERBAL') { emLedger = !fecha; continue; }
    if (fecha) continue;
    if (atual) {
      if (tag === 'TRNTYPE') atual.tipo = val;
      else if (tag === 'DTPOSTED') atual.data = data8(val);
      else if (tag === 'TRNAMT') atual.valor = numero(val);
      else if (tag === 'FITID') atual.fitid = val;
      else if (tag === 'CHECKNUM' || tag === 'REFNUM') atual.documento = atual.documento || val || undefined;
      else if (tag === 'MEMO') atual.memo = atual.memo ? `${atual.memo} ${val}`.trim() : val;
      else if (tag === 'NAME' || tag === 'PAYEE') atual.memo = atual.memo ? `${val} ${atual.memo}`.trim() : val;
      continue;
    }
    if (tag === 'BANKID') ext.banco = val;
    else if (tag === 'BRANCHID') ext.agencia = val;
    else if (tag === 'ACCTID') ext.conta = val;
    else if (tag === 'CURDEF') ext.moeda = val;
    else if (tag === 'DTSTART') ext.inicio = data8(val);
    else if (tag === 'DTEND') ext.fim = data8(val);
    else if (tag === 'BALAMT' && emLedger) ext.saldoFinal = numero(val);
    else if (tag === 'DTASOF' && emLedger) ext.dataSaldo = data8(val);
  }
  // SGML sem fechamento de STMTTRN: o ultimo bloco pode ficar aberto
  if (atual && atual.fitid && atual.data) ext.transacoes.push({ fitid: atual.fitid, data: atual.data, valor: resolverSinal(atual.valor ?? 0, atual.tipo ?? '', atual.memo ?? ''), tipo: atual.tipo ?? '', memo: atual.memo ?? '', documento: atual.documento });
  // dedup interna por FITID (alguns bancos repetem)
  const vistos = new Set<string>();
  ext.transacoes = ext.transacoes.filter((t) => (vistos.has(t.fitid) ? false : (vistos.add(t.fitid), true)));
  if (!ext.inicio && ext.transacoes.length) ext.inicio = [...ext.transacoes].map((t) => t.data).sort()[0];
  if (!ext.fim && ext.transacoes.length) ext.fim = [...ext.transacoes].map((t) => t.data).sort().pop();
  return ext;
}

/** Nomes de banco pelo codigo COMPE (BANKID). */
export const BANCOS: Record<string, string> = {
  '001': 'Banco do Brasil', '033': 'Santander', '077': 'Inter', '104': 'Caixa', '208': 'BTG Pactual', '212': 'Original', '237': 'Bradesco',
  '260': 'Nubank', '290': 'PagBank', '336': 'C6', '341': 'Itaú', '403': 'Cora', '422': 'Safra', '461': 'Asaas', '748': 'Sicredi', '756': 'Sicoob',
};

/** Sugere a categoria do plano de contas a partir do historico bancario. */
export function sugerirCategoria(memo: string, entrada: boolean, plano: PlanoConta[]): string {
  const m = memo.toLowerCase();
  const tem = (cat: string) => (plano.some((p) => p.categoria === cat && p.ativa) ? cat : '');
  const regras: [RegExp, string][] = entrada
    ? [
        [/medi[cç][aã]o|boletim|nf ?\d|nota fiscal/, 'Medições de obras'],
        [/sinal|adiant|entrada/, 'Sinais e adiantamentos'],
        [/aporte|s[oó]cio|integraliza/, 'Aportes de sócios'],
        [/empr[eé]stimo|financ|capital de giro|cr[eé]dito liberado/, 'Empréstimos recebidos'],
        [/reembolso|estorno|devolu/, 'Reembolsos'],
        [/rendimento|juros|aplica/, 'Outros recebimentos'],
      ]
    : [
        [/tarifa|tar\b|iof|juros|encargo|pacote|anuidade|manuten[cç][aã]o de conta|cesta/, 'Juros e tarifas bancárias'],
        [/parcela|amortiza|financ|empr[eé]stimo|consórcio/, 'Amortização de dívidas'],
        [/folha|sal[aá]rio|pagamento funcion|adiantamento sal|f[eé]rias|13/, 'Folha e salários'],
        [/inss|fgts|gps|darf|das\b|simples|iss|icms|pis|cofins|irrf|tribut|imposto|gru/, 'Tributos e taxas gerais'],
        [/pr[oó]-?labore|prolabore/, 'Pró-labore'],
        [/energia|enel|cemig|copel|celpe|equatorial|light|neoenergia|saneago|sabesp|copasa|[aá]gua|internet|vivo|claro|tim\b|oi\b|telefon/, 'Energia, água e internet'],
        [/aluguel|condom/, 'Aluguel e condomínio'],
        [/seguro|porto seguro|tokio|allianz|bradesco seg/, 'Seguros'],
        [/contab|advoc|jur[ií]dic|cart[oó]rio/, 'Contabilidade e jurídico'],
        [/combust|posto|ipiranga|shell|petrobras|ped[aá]gio|estacion/, 'Veículos e combustível'],
        [/a[cç]o|perfil|gerdau|arcelor|usiminas|vallourec|belgo|chapas?\b/, 'Aço e perfis'],
        [/telha|chapa|painel|isot[eé]rm/, 'Chapas, telhas e painéis'],
        [/concreto|cimento|brita|areia|funda[cç]/, 'Concreto e fundações'],
        [/parafuso|eletrodo|solda|disco|consum[ií]vel|fixador|chumbador/, 'Componentes e fixadores'],
        [/frete|transport|guindaste|munck|mobiliza|carreto/, 'Transporte e mobilização'],
        [/loca[cç][aã]o|aluguel de|plataforma|andaime|equipamento/, 'Equipamentos e locações'],
        [/art\b|crea|licen|alvar[aá]|projeto/, 'Projetos, ART e licenças'],
        [/software|licen[cç]a|google|microsoft|autodesk|adobe|sistema|hosting|dom[ií]nio/, 'Tecnologia e software'],
        [/marketing|an[uú]ncio|meta ads|google ads|tr[aá]fego/, 'Marketing e tráfego'],
        [/comiss/, 'Comissões'],
        [/viagem|hotel|passagem|di[aá]ria|restaurante|refei/, 'Viagens e representação'],
        [/manuten/, 'Manutenção'],
        [/lucro|dividendo|distribui/, 'Distribuição de lucros'],
      ];
  for (const [re, cat] of regras) if (re.test(m) && tem(cat)) return cat;
  return tem(entrada ? 'Outros recebimentos' : 'Outros pagamentos') || plano.find((p) => p.tipo === (entrada ? 'Entrada' : 'Saída') && p.ativa)?.categoria || '';
}
