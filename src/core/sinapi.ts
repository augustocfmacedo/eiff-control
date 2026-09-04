// Leitura das planilhas de referencia do SINAPI (Caixa) para o catalogo de insumos e composicoes.
// Aceita o formato antigo por UF (SINAPI_Preco_Ref_Insumos_UF_AAAAMM_*.xlsx e
// SINAPI_Custo_Ref_Composicoes_Analitico_UF_AAAAMM_*.xlsx) e o formato unificado a partir de 2025
// (um unico arquivo com abas ISD/ICD, CSD/CCD e Analitico, precos em colunas por UF).
// As celulas chegam como matriz (linhas x colunas) ja lidas pelo SheetJS; nada aqui depende do navegador.

import type { TipoInsumo } from './types';

export type Celula = string | number | boolean | null | undefined;
export interface Planilha {
  arquivo: string; // nome do arquivo de origem
  aba: string;
  linhas: Celula[][];
}

export interface InsumoImportado { codigo: string; descricao: string; unidade: string; tipo: TipoInsumo; preco: number; classe?: string }
export interface ItemImportado { tipo: 'Insumo' | 'Composição'; codigo: string; coeficiente: number }
export interface ComposicaoImportada { codigo: string; descricao: string; unidade: string; grupo: string; itens: ItemImportado[] }
export interface CatalogoImportado {
  referencia: string; // ex.: SINAPI GO 07/2026 não desonerado
  uf?: string;
  competencia?: string; // yyyy-mm
  desonerado: boolean;
  insumos: InsumoImportado[];
  composicoes: ComposicaoImportada[];
  avisos: string[];
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const norm = (v: Celula) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const texto = (v: Celula) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function numero(v: Celula): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  // "1.234,56" -> 1234.56 ; "0,0123" -> 0.0123 ; "1234.56" -> 1234.56
  const semMilhar = /,\d{1,8}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(semMilhar);
  return Number.isFinite(n) ? n : 0;
}
const codigo = (v: Celula) => (typeof v === 'number' ? String(Math.round(v)) : texto(v).replace(/\.0+$/, ''));

/** Tipo do insumo pela classificacao do catalogo ou, na falta dela, pela descricao. */
export function tipoInsumoDe(classe: string, descricao: string): TipoInsumo {
  const c = norm(classe);
  if (/MAO DE OBRA|SALARIO|ENCARGO/.test(c)) return 'Mão de obra';
  if (/EQUIPAMENTO|MAQUINA|FERRAMENTA/.test(c)) return 'Equipamento';
  if (/SERVICO|TRANSPORTE|FRETE/.test(c)) return 'Serviço';
  if (/MATERIAL/.test(c)) return 'Material';
  const d = norm(descricao);
  if (/\b(PEDREIRO|SERVENTE|MONTADOR|SOLDADOR|ENCARREGADO|AJUDANTE|CARPINTEIRO|ARMADOR|PINTOR|ELETRICISTA|ENCANADOR|OPERADOR|MOTORISTA|ENGENHEIRO|MESTRE|TOPOGRAFO|VIGIA|AUXILIAR|TECNICO|SERRALHEIRO|CALDEIREIRO|MECANICO|GESSEIRO|AZULEJISTA|VIDRACEIRO|TELHADISTA|IMPERMEABILIZADOR|LADRILHEIRO|MARCENEIRO|ESTUCADOR|JARDINEIRO|SOLDADOR)\b/.test(d) || /COM ENCARGOS/.test(d)) return 'Mão de obra';
  if (/\b(CHP|CHI)\b|LOCACAO|ALUGUEL|GUINDASTE|CAMINHAO|BETONEIRA|ANDAIME|COMPRESSOR|GERADOR|VIBRADOR|RETROESCAVADEIRA|ESCAVADEIRA|PLATAFORMA/.test(d)) return 'Equipamento';
  if (/TRANSPORTE|FRETE|ENSAIO|LAUDO|PROJETO|CONSULTORIA/.test(d)) return 'Serviço';
  return 'Material';
}

interface Cabecalho { idx: number; cols: string[] }
function cabecalho(linhas: Celula[][]): Cabecalho | null {
  for (let i = 0; i < Math.min(40, linhas.length); i++) {
    const cols = (linhas[i] ?? []).map(norm);
    const preenchidas = cols.filter(Boolean).length;
    if (preenchidas >= 3 && cols.some((c) => /^COD(IGO)?\b|^CODIGO/.test(c))) return { idx: i, cols };
  }
  return null;
}
const achar = (cols: string[], ...padroes: RegExp[]): number => {
  for (const p of padroes) { const i = cols.findIndex((c) => p.test(c)); if (i >= 0) return i; }
  return -1;
};

type TipoAba = 'insumos' | 'analitico' | 'sintetico' | 'outra';
function tipoAba(aba: string, cols: string[]): TipoAba {
  if (achar(cols, /COEFICIENTE/) >= 0 && achar(cols, /TIPO( DO)? ITEM|^TIPO$/) >= 0) return 'analitico';
  const a = norm(aba);
  if (achar(cols, /DESCRICAO DO INSUMO/) >= 0 || /^I[SC]D$|INSUMO/.test(a)) return 'insumos';
  if (achar(cols, /DESCRICAO DA COMPOSICAO/) >= 0 || /^C[SC]D$|SINTETIC|COMPOSIC/.test(a)) return 'sintetico';
  return 'outra';
}

/** Desoneracao pelo nome da aba (ICD/CCD) ou do arquivo (Desonerado / NaoDesonerado). */
function desoneradaDe(p: Planilha): boolean | undefined {
  const a = norm(p.aba);
  if (/^[IC]CD$|COM DESONERACAO|COM_DESONERACAO/.test(a)) return true;
  if (/^[IC]SD$|SEM DESONERACAO|SEM_DESONERACAO/.test(a)) return false;
  const f = norm(p.arquivo);
  if (/NAO ?_?DESONERADO|NAODESONERADO/.test(f)) return false;
  if (/DESONERADO/.test(f)) return true;
  return undefined;
}

/** UFs com coluna de preco no formato unificado. */
export function detectarUfs(planilhas: Planilha[]): string[] {
  const ufs = new Set<string>();
  for (const p of planilhas) {
    const h = cabecalho(p.linhas);
    if (!h) continue;
    for (const c of h.cols) if (UFS.includes(c)) ufs.add(c);
    const m = norm(p.arquivo).match(/_([A-Z]{2})_\d{6}/);
    if (m && UFS.includes(m[1])) ufs.add(m[1]);
  }
  return [...ufs].sort();
}

export function parseSinapi(planilhas: Planilha[], opcoes: { uf?: string; desonerado?: boolean } = {}): CatalogoImportado {
  const avisos: string[] = [];
  const desonerado = opcoes.desonerado ?? false;
  const insumos = new Map<string, InsumoImportado>();
  const composicoes = new Map<string, ComposicaoImportada>();
  let uf = opcoes.uf;
  let competencia: string | undefined;

  for (const p of planilhas) {
    const m = `${p.arquivo} ${p.aba}`.match(/(20\d{2})[-_ ]?(\d{2})(?!\d)/);
    if (m && !competencia) competencia = `${m[1]}-${m[2]}`;
    const des = desoneradaDe(p);
    if (des !== undefined && des !== desonerado) continue; // aba/arquivo da outra desoneracao
    const h = cabecalho(p.linhas);
    if (!h) continue;
    const tipo = tipoAba(p.aba, h.cols);
    if (tipo === 'outra') continue;
    const cols = h.cols;
    const dados = p.linhas.slice(h.idx + 1);

    if (tipo === 'insumos') {
      const iCod = achar(cols, /^CODIGO( DO INSUMO)?$/, /^CODIGO/);
      const iDesc = achar(cols, /DESCRICAO/);
      const iUn = achar(cols, /UNIDADE/);
      const iClasse = achar(cols, /CLASSIFICACAO|CLASSE|GRUPO|CATEGORIA/);
      let iPreco = achar(cols, /PRECO MEDIANO/, /^PRECO/, /CUSTO|VALOR/);
      const iUf = uf ? cols.indexOf(uf) : -1;
      if (iUf >= 0) iPreco = iUf;
      else if (cols.some((c) => UFS.includes(c))) {
        const fm = norm(p.arquivo).match(/_([A-Z]{2})_\d{6}/);
        const escolhida = fm && UFS.includes(fm[1]) ? fm[1] : undefined;
        if (escolhida && cols.includes(escolhida)) { uf = escolhida; iPreco = cols.indexOf(escolhida); }
        else { avisos.push(`Aba ${p.aba}: informe a UF para escolher a coluna de preço.`); continue; }
      } else if (!uf) {
        const fm = norm(p.arquivo).match(/_([A-Z]{2})_\d{6}/);
        if (fm && UFS.includes(fm[1])) uf = fm[1];
      }
      if (iCod < 0 || iDesc < 0 || iPreco < 0) { avisos.push(`Aba ${p.aba}: colunas de código/descrição/preço não reconhecidas.`); continue; }
      for (const l of dados) {
        const cod = codigo(l[iCod]);
        if (!cod || !/^\d+$/.test(cod)) continue;
        const descricao = texto(l[iDesc]);
        const classe = iClasse >= 0 ? texto(l[iClasse]) : '';
        insumos.set(cod, { codigo: cod, descricao, unidade: iUn >= 0 ? texto(l[iUn]) : '', tipo: tipoInsumoDe(classe, descricao), preco: numero(l[iPreco]), classe: classe || undefined });
      }
    } else if (tipo === 'sintetico') {
      const iCod = achar(cols, /CODIGO( DA COMPOSICAO)?$/, /^CODIGO/);
      const iDesc = achar(cols, /DESCRICAO/);
      const iUn = achar(cols, /UNIDADE/);
      const iGrupo = achar(cols, /GRUPO|CLASSE/);
      if (iCod < 0 || iDesc < 0) continue;
      for (const l of dados) {
        const cod = codigo(l[iCod]);
        if (!cod || !/^\d+$/.test(cod)) continue;
        const atual = composicoes.get(cod);
        const base = { codigo: cod, descricao: texto(l[iDesc]), unidade: iUn >= 0 ? texto(l[iUn]) : '', grupo: iGrupo >= 0 ? texto(l[iGrupo]) : '' };
        composicoes.set(cod, atual ? { ...atual, descricao: atual.descricao || base.descricao, unidade: atual.unidade || base.unidade, grupo: atual.grupo || base.grupo } : { ...base, itens: [] });
      }
    } else {
      // analitico: cabecalho da composicao + linhas de itens (insumo ou composicao auxiliar)
      const iCod = achar(cols, /CODIGO DA COMPOSICAO/, /^CODIGO( COMPOSICAO)?$/);
      const iDesc = achar(cols, /DESCRICAO DA COMPOSICAO/, /^DESCRICAO$/);
      const iUn = achar(cols, /^UNIDADE( DA COMPOSICAO)?$/, /^UNIDADE/);
      const iGrupo = achar(cols, /GRUPO|CLASSE/);
      const iTipoItem = achar(cols, /TIPO( DO)? ITEM|^TIPO$/);
      const iCodItem = achar(cols, /CODIGO( DO)? ITEM/);
      const iDescItem = achar(cols, /DESCRICAO( DO)? ITEM/);
      const iUnItem = achar(cols, /UNIDADE( DO)? ITEM/);
      const iCoef = achar(cols, /COEFICIENTE/);
      const iPrecoItem = achar(cols, /PRECO UNITARIO/);
      const iClasseItem = achar(cols, /CLASSIFICACAO( DO)? ITEM|CLASSE( DO)? ITEM/);
      if (iCod < 0 || iTipoItem < 0 || iCodItem < 0 || iCoef < 0) { avisos.push(`Aba ${p.aba}: colunas do analítico não reconhecidas.`); continue; }
      let atual: ComposicaoImportada | undefined;
      for (const l of dados) {
        const cod = codigo(l[iCod]);
        if (cod && /^\d+$/.test(cod)) {
          const desc = iDesc >= 0 ? texto(l[iDesc]) : '';
          const un = iUn >= 0 ? texto(l[iUn]) : '';
          const grupo = iGrupo >= 0 ? texto(l[iGrupo]) : '';
          atual = composicoes.get(cod);
          if (!atual) { atual = { codigo: cod, descricao: desc, unidade: un, grupo, itens: [] }; composicoes.set(cod, atual); }
          else { atual.descricao = atual.descricao || desc; atual.unidade = atual.unidade || un; atual.grupo = atual.grupo || grupo; }
        }
        const codItem = codigo(l[iCodItem]);
        const tipoItem = norm(l[iTipoItem]);
        if (!atual || !codItem || !/^\d+$/.test(codItem) || !tipoItem) continue;
        const ehComp = /COMPOSICAO/.test(tipoItem);
        const coef = numero(l[iCoef]);
        if (!(coef > 0)) continue;
        if (!atual.itens.some((it) => it.codigo === codItem && it.tipo === (ehComp ? 'Composição' : 'Insumo'))) atual.itens.push({ tipo: ehComp ? 'Composição' : 'Insumo', codigo: codItem, coeficiente: coef });
        if (!ehComp && !insumos.has(codItem) && iDescItem >= 0) {
          // insumo conhecido apenas pelo analitico (formato antigo traz o preco unitario na linha)
          const descricao = texto(l[iDescItem]);
          insumos.set(codItem, { codigo: codItem, descricao, unidade: iUnItem >= 0 ? texto(l[iUnItem]) : '', tipo: tipoInsumoDe(iClasseItem >= 0 ? texto(l[iClasseItem]) : '', descricao), preco: iPrecoItem >= 0 ? numero(l[iPrecoItem]) : 0 });
        } else if (ehComp && !composicoes.has(codItem) && iDescItem >= 0) {
          composicoes.set(codItem, { codigo: codItem, descricao: texto(l[iDescItem]), unidade: iUnItem >= 0 ? texto(l[iUnItem]) : '', grupo: '', itens: [] });
        }
      }
    }
  }

  const semItens = [...composicoes.values()].filter((c) => c.itens.length === 0).length;
  if (semItens && composicoes.size) avisos.push(`${semItens} composição(ões) sem itens: inclua a planilha analítica para calcular o custo.`);
  if (!insumos.size && !composicoes.size) avisos.push('Nenhum insumo ou composição reconhecido. Confira se o arquivo é a planilha de referência do SINAPI (xlsx).');
  const mesAno = competencia ? `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}` : '';
  return {
    referencia: ['SINAPI', uf, mesAno, desonerado ? 'desonerado' : 'não desonerado'].filter(Boolean).join(' '),
    uf, competencia, desonerado,
    insumos: [...insumos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })),
    composicoes: [...composicoes.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })),
    avisos,
  };
}

/** Recorta o catalogo para as composicoes escolhidas mais todas as suas dependencias (auxiliares e insumos). */
export function selecionarComDependencias(cat: CatalogoImportado, codigos: string[]): { insumos: InsumoImportado[]; composicoes: ComposicaoImportada[] } {
  const comp = new Map(cat.composicoes.map((c) => [c.codigo, c]));
  const ins = new Map(cat.insumos.map((i) => [i.codigo, i]));
  const compsSel = new Map<string, ComposicaoImportada>();
  const insSel = new Map<string, InsumoImportado>();
  const visita = (cod: string) => {
    if (compsSel.has(cod)) return;
    const c = comp.get(cod);
    if (!c) return;
    compsSel.set(cod, c);
    for (const it of c.itens) {
      if (it.tipo === 'Composição') visita(it.codigo);
      else { const i = ins.get(it.codigo); if (i) insSel.set(i.codigo, i); }
    }
  };
  codigos.forEach(visita);
  return { insumos: [...insSel.values()], composicoes: [...compsSel.values()] };
}
