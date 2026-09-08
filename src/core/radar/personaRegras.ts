// Consistencia entre as regras de persona do codigo (REGRAS_PERSONA_PADRAO) e as gravadas em producao (radar_persona_rule).
// Puro: usado pelo script de alinhamento e pelo teste que impede codigo e banco de divergirem em silencio.
import type { RegraPersona } from './types';

export interface DiferencaRegra { chave: string; tipo: 'inserir' | 'atualizar' | 'remover'; campos?: string[]; de?: Partial<RegraPersona>; para?: Partial<RegraPersona>; regra?: RegraPersona; id?: string }
/** Chave estavel de uma regra (persona + campo + primeiro termo): identifica a mesma regra mesmo com termos/prioridade diferentes. */
export const chaveRegraPersona = (g: Pick<RegraPersona, 'persona' | 'campo' | 'termos'>) => `${g.persona}|${g.campo}|${(g.termos[0] ?? '').toLowerCase()}`;
const iguais = (a?: string[], b?: string[]) => JSON.stringify((a ?? []).map((t) => t.toLowerCase())) === JSON.stringify((b ?? []).map((t) => t.toLowerCase()));

/** Diferencas entre as regras atuais (banco) e o padrao do codigo: o que inserir, atualizar (termos/excluir/prioridade/ativo) ou remover. */
export function compararRegrasPersona(atuais: RegraPersona[], padrao: RegraPersona[]): { alinhado: boolean; diferencas: DiferencaRegra[] } {
  const diferencas: DiferencaRegra[] = [];
  const porChave = new Map(atuais.map((g) => [chaveRegraPersona(g), g]));
  for (const p of padrao) {
    const a = porChave.get(chaveRegraPersona(p));
    if (!a) { diferencas.push({ chave: chaveRegraPersona(p), tipo: 'inserir', regra: p }); continue; }
    const campos: string[] = [];
    if (!iguais(a.termos, p.termos)) campos.push('termos');
    if (!iguais(a.excluir, p.excluir)) campos.push('excluir');
    if (a.prioridade !== p.prioridade) campos.push('prioridade');
    if (a.ativo !== p.ativo) campos.push('ativo');
    if (campos.length) diferencas.push({ chave: chaveRegraPersona(p), tipo: 'atualizar', campos, id: a.id, de: { termos: a.termos, excluir: a.excluir, prioridade: a.prioridade, ativo: a.ativo }, para: { termos: p.termos, excluir: p.excluir, prioridade: p.prioridade, ativo: p.ativo } });
  }
  const chavesPadrao = new Set(padrao.map(chaveRegraPersona));
  for (const a of atuais) if (!chavesPadrao.has(chaveRegraPersona(a))) diferencas.push({ chave: chaveRegraPersona(a), tipo: 'remover', id: a.id, regra: a });
  return { alinhado: diferencas.length === 0, diferencas };
}

/** Mudancas aprovadas na Decision Maker Calibration 01 (commit ced0d18). Qualquer outra diferenca deve PARAR o alinhamento. */
export const CALIBRACAO_01_PERSONA = {
  novaRegra: 'MANUFACTURING|cargo|gerente industrial',
  logistica: 'LOGISTICS|ambos|logistica',
  termosLogistica: ['warehouse', 'almoxarifado'],
  prioridadeNova: 9,
};
/** Diz se TODAS as diferencas encontradas sao explicadas pela Calibration 01 (regra nova, termos da logistica, prioridades deslocadas em +1 a partir da posicao 9). */
export function diferencasSaoDaCalibracao01(diferencas: DiferencaRegra[]): { ok: boolean; foraDoEscopo: DiferencaRegra[] } {
  const fora = diferencas.filter((d) => {
    if (d.tipo === 'inserir') return d.chave !== CALIBRACAO_01_PERSONA.novaRegra;
    if (d.tipo === 'remover') return true;
    const campos = d.campos ?? [];
    const soPrioridade = campos.every((c) => c === 'prioridade') && (d.para?.prioridade ?? 0) === (d.de?.prioridade ?? 0) + 1 && (d.de?.prioridade ?? 0) >= CALIBRACAO_01_PERSONA.prioridadeNova;
    if (d.chave === CALIBRACAO_01_PERSONA.logistica) {
      const extras = (d.para?.termos ?? []).filter((t) => !(d.de?.termos ?? []).includes(t));
      const soTermosAprovados = campos.every((c) => c === 'termos' || c === 'prioridade') && extras.every((t) => CALIBRACAO_01_PERSONA.termosLogistica.includes(t)) && (d.de?.termos ?? []).every((t) => (d.para?.termos ?? []).includes(t));
      return !soTermosAprovados;
    }
    return !soPrioridade;
  });
  return { ok: fora.length === 0, foraDoEscopo: fora };
}
