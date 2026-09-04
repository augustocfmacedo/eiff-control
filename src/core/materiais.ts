// Lista de materiais (conjuntos/marcas de montagem) por obra e servico, em quilos: a unidade de medida da
// industria de estruturas metalicas. Avanco fisico por peso (liberado, fabricado, expedido, montado) alimenta
// o percentual de execucao dos servicos e a curva S. Importacao de listas exportadas de Tekla/SolidWorks/Excel.

import type { Celula, Planilha } from './sinapi';
import { numero } from './sinapi';
import type { Conjunto, TipoConjunto } from './types';

export const TIPOS_CONJUNTO: TipoConjunto[] = ['Pilar', 'Viga', 'Terça', 'Treliça', 'Contraventamento', 'Chumbador', 'Escada', 'Fechamento', 'Plataforma', 'Outros'];
export type EtapaPeso = 'liberado' | 'fabricado' | 'expedido' | 'montado';

export interface ConjuntoCalc extends Conjunto {
  pesoTotal: number;
  pesoFabricado: number;
  pesoExpedido: number;
  pesoMontado: number;
  pctFabricado: number;
  pctMontado: number;
  situacao: 'Não liberado' | 'Liberado' | 'Em fabricação' | 'Fabricado' | 'Expedido' | 'Montado';
}

export function calcConjunto(c: Conjunto): ConjuntoCalc {
  const pesoTotal = c.quantidade * c.pesoUnitario;
  const pesoFabricado = Math.min(c.fabricadoQtd, c.quantidade) * c.pesoUnitario;
  const pesoExpedido = Math.min(c.expedidoQtd, c.quantidade) * c.pesoUnitario;
  const pesoMontado = Math.min(c.montadoQtd, c.quantidade) * c.pesoUnitario;
  let situacao: ConjuntoCalc['situacao'] = 'Não liberado';
  if (c.montadoQtd >= c.quantidade && c.quantidade > 0) situacao = 'Montado';
  else if (c.expedidoQtd >= c.quantidade && c.quantidade > 0) situacao = 'Expedido';
  else if (c.fabricadoQtd >= c.quantidade && c.quantidade > 0) situacao = 'Fabricado';
  else if (c.fabricadoQtd > 0) situacao = 'Em fabricação';
  else if (c.liberadoEm) situacao = 'Liberado';
  return { ...c, pesoTotal, pesoFabricado, pesoExpedido, pesoMontado, pctFabricado: pesoTotal ? pesoFabricado / pesoTotal : 0, pctMontado: pesoTotal ? pesoMontado / pesoTotal : 0, situacao };
}

export interface ResumoPeso {
  conjuntos: ConjuntoCalc[];
  pecas: number;
  pesoTotal: number;
  pesoLiberado: number;
  pesoFabricado: number;
  pesoExpedido: number;
  pesoMontado: number;
  pctLiberado: number;
  pctFabricado: number;
  pctExpedido: number;
  pctMontado: number;
  emFabrica: number; // fabricado e ainda nao expedido (estoque na fabrica)
  emCanteiro: number; // expedido e ainda nao montado
  porTipo: { tipo: string; pesoTotal: number; pesoMontado: number; pesoFabricado: number }[];
  porServico: { servicoId: string; pesoTotal: number; pesoFabricado: number; pesoMontado: number }[];
}

export function resumoPeso(conjuntos: Conjunto[]): ResumoPeso {
  const calc = conjuntos.map(calcConjunto);
  const soma = (f: (c: ConjuntoCalc) => number, filtro: (c: ConjuntoCalc) => boolean = () => true) => calc.filter(filtro).reduce((a, c) => a + f(c), 0);
  const pesoTotal = soma((c) => c.pesoTotal);
  const pesoLiberado = soma((c) => c.pesoTotal, (c) => !!c.liberadoEm);
  const pesoFabricado = soma((c) => c.pesoFabricado);
  const pesoExpedido = soma((c) => c.pesoExpedido);
  const pesoMontado = soma((c) => c.pesoMontado);
  const grupo = <K extends string>(chave: (c: ConjuntoCalc) => K | undefined) => {
    const m = new Map<K, { pesoTotal: number; pesoFabricado: number; pesoMontado: number }>();
    for (const c of calc) { const k = chave(c); if (!k) continue; const g = m.get(k) ?? { pesoTotal: 0, pesoFabricado: 0, pesoMontado: 0 }; g.pesoTotal += c.pesoTotal; g.pesoFabricado += c.pesoFabricado; g.pesoMontado += c.pesoMontado; m.set(k, g); }
    return m;
  };
  return {
    conjuntos: calc, pecas: calc.reduce((a, c) => a + c.quantidade, 0), pesoTotal, pesoLiberado, pesoFabricado, pesoExpedido, pesoMontado,
    pctLiberado: pesoTotal ? pesoLiberado / pesoTotal : 0, pctFabricado: pesoTotal ? pesoFabricado / pesoTotal : 0, pctExpedido: pesoTotal ? pesoExpedido / pesoTotal : 0, pctMontado: pesoTotal ? pesoMontado / pesoTotal : 0,
    emFabrica: Math.max(0, pesoFabricado - pesoExpedido), emCanteiro: Math.max(0, pesoExpedido - pesoMontado),
    porTipo: [...grupo((c) => c.tipo)].map(([tipo, g]) => ({ tipo, ...g })).sort((a, b) => b.pesoTotal - a.pesoTotal),
    porServico: [...grupo((c) => c.servicoId)].map(([servicoId, g]) => ({ servicoId, ...g })),
  };
}

/** Avanco por peso por servico (para o percentual fisico dos servicos e a curva S). */
export function avancoPorPeso(conjuntos: Conjunto[], codigoObra?: string): Map<string, { pesoTotal: number; pesoFabricado: number; pesoMontado: number }> {
  const r = resumoPeso(conjuntos.filter((c) => !codigoObra || c.codigoObra === codigoObra));
  return new Map(r.porServico.map((s) => [s.servicoId, { pesoTotal: s.pesoTotal, pesoFabricado: s.pesoFabricado, pesoMontado: s.pesoMontado }]));
}

// ---------------------------------------------------------------------------
// Importacao de lista de materiais (Tekla, SolidWorks, Excel): reconhece colunas pelo cabecalho
// ---------------------------------------------------------------------------
export interface ConjuntoImportado { marca: string; descricao: string; perfil?: string; tipo: TipoConjunto; quantidade: number; pesoUnitario: number; revisao?: string }

const norm = (v: Celula) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const achar = (cols: string[], ...padroes: RegExp[]) => { for (const p of padroes) { const i = cols.findIndex((c) => p.test(c)); if (i >= 0) return i; } return -1; };

export function tipoConjuntoDe(texto: string): TipoConjunto {
  const t = norm(texto);
  if (/PILAR|COLUNA|COLUMN/.test(t)) return 'Pilar';
  if (/TERCA|PURLIN/.test(t)) return 'Terça';
  if (/TRELICA|TRUSS|TESOURA/.test(t)) return 'Treliça';
  if (/CONTRAVENT|BRACING|DIAGONAL|MAO FRANCESA/.test(t)) return 'Contraventamento';
  if (/CHUMBADOR|ANCHOR/.test(t)) return 'Chumbador';
  if (/ESCADA|STAIR|GUARDA/.test(t)) return 'Escada';
  if (/FECHAMENTO|PAINEL|TELHA|CLADDING/.test(t)) return 'Fechamento';
  if (/PLATAFORMA|MEZANINO|PLATFORM/.test(t)) return 'Plataforma';
  if (/VIGA|BEAM|GIRDER|VIGOTA/.test(t)) return 'Viga';
  return 'Outros';
}

export function parseListaMateriais(planilhas: Planilha[]): { conjuntos: ConjuntoImportado[]; avisos: string[] } {
  const avisos: string[] = [];
  const conjuntos: ConjuntoImportado[] = [];
  for (const p of planilhas) {
    let h = -1; let cols: string[] = [];
    for (let i = 0; i < Math.min(30, p.linhas.length); i++) {
      const c = (p.linhas[i] ?? []).map(norm);
      if (c.filter(Boolean).length >= 3 && c.some((x) => /MARCA|ASSEMBLY|CONJUNTO|PECA|PART|MARK|POS/.test(x)) && c.some((x) => /PESO|WEIGHT|KG/.test(x))) { h = i; cols = c; break; }
    }
    if (h < 0) continue;
    const iMarca = achar(cols, /^MARCA|ASSEMBLY MARK|^MARK$|CONJUNTO|^POS/, /MARCA|MARK|PECA|PART/);
    const iDesc = achar(cols, /DESCRI|NOME|NAME/, /DENOMINA/);
    const iPerfil = achar(cols, /PERFIL|PROFILE|SECTION|SECAO/);
    const iQtd = achar(cols, /^QTD|QUANT|^QTY|^QUANTITY|^NUMERO|^N\./, /QTD|QTY/);
    const iPesoU = achar(cols, /PESO UNIT|PESO\/PC|UNIT WEIGHT|WEIGHT\/PC|PESO UNITARIO|PESO POR/, /PESO \(KG\)$|^PESO$|WEIGHT$/);
    const iPesoT = achar(cols, /PESO TOTAL|TOTAL WEIGHT|PESO TOT/);
    const iTipo = achar(cols, /TIPO|TYPE|CATEGORIA|CLASSE/);
    const iRev = achar(cols, /REV/);
    if (iMarca < 0 || (iPesoU < 0 && iPesoT < 0)) { avisos.push(`Aba ${p.aba}: não reconheci as colunas de marca e peso.`); continue; }
    for (const l of p.linhas.slice(h + 1)) {
      const marca = String(l[iMarca] ?? '').trim();
      if (!marca || /^TOTAL/i.test(marca)) continue;
      const quantidade = iQtd >= 0 ? numero(l[iQtd]) || 1 : 1;
      let pesoUnitario = iPesoU >= 0 ? numero(l[iPesoU]) : 0;
      const pesoTotal = iPesoT >= 0 ? numero(l[iPesoT]) : 0;
      if (!(pesoUnitario > 0) && pesoTotal > 0 && quantidade > 0) pesoUnitario = pesoTotal / quantidade;
      if (!(pesoUnitario > 0)) continue;
      const descricao = iDesc >= 0 ? String(l[iDesc] ?? '').trim() : '';
      const perfil = iPerfil >= 0 ? String(l[iPerfil] ?? '').trim() : '';
      conjuntos.push({ marca, descricao: descricao || perfil || marca, perfil: perfil || undefined, tipo: tipoConjuntoDe(`${iTipo >= 0 ? String(l[iTipo] ?? '') : ''} ${descricao} ${marca}`), quantidade, pesoUnitario: Math.round(pesoUnitario * 1000) / 1000, revisao: iRev >= 0 ? String(l[iRev] ?? '').trim() || undefined : undefined });
    }
  }
  if (!conjuntos.length && !avisos.length) avisos.push('Nenhuma linha com marca e peso encontrada. A planilha precisa de colunas de marca/conjunto, quantidade e peso.');
  return { conjuntos, avisos };
}
