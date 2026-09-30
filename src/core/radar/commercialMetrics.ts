// EIFF — medidas comerciais DESCRITIVAS: o contrato neutro de uma medida.
//
// Decisão D-2 (docs/commercial-director-1.0.md): uma métrica comercial = uma definição canônica. O Commercial Director
// (CD-1+) compõe estas medidas; o futuro CM4 (Measurement & Learning) consome as MESMAS definições e só cria métricas
// próprias de experimento/aprendizado — nunca redefine a mesma medida com outra fórmula.
//
// Uma medida nunca usa 0 para dizer "não sei": ausência de dado é `DADO_INSUFICIENTE` com motivo; medida que não se
// aplica ao caso é `NAO_APLICAVEL`. Taxa só existe quando numerador e denominador são defensáveis.
//
// Puro: sem relógio, sem rede, sem persistência.

export const ESTADOS_MEDIDA = ['DISPONIVEL', 'DADO_INSUFICIENTE', 'NAO_APLICAVEL'] as const;
export type EstadoMedida = (typeof ESTADOS_MEDIDA)[number];

export const UNIDADES_MEDIDA = ['CONTAS', 'CONTATOS', 'OPORTUNIDADES', 'REGISTROS_ESTAGIO', 'ATIVIDADES', 'TAREFAS', 'COMUNICACOES', 'CANDIDATOS', 'FONTES', 'THREADS', 'DUPLICATAS', 'SUPRESSOES', 'SINAIS', 'BRL', 'RAZAO'] as const;
export type UnidadeMedida = (typeof UNIDADES_MEDIDA)[number];

/** A autoridade que DEFINE o número. A medida nunca recalcula regra de outra autoridade: chama a função dela. */
export const AUTORIDADES_MEDIDA = ['RADAR', 'COMMERCIAL_QUEUE', 'ACTION_PLAN', 'CADENCIA', 'CONTATOS', 'COBERTURA', 'HISTORICO_CONTATO', 'COMUNICACAO', 'LEAD_ENGINE', 'INBOX'] as const;
export type AutoridadeMedida = (typeof AUTORIDADES_MEDIDA)[number];

export interface MedidaComercial {
  /** identificador estável, ex.: 'decisores.comDecisorMarcado' */
  id: string;
  /** o que é contado, em uma frase — distingue conceitos parecidos (ex.: "decisor marcado" ≠ "contato elegível") */
  descricao: string;
  estado: EstadoMedida;
  /** só em DISPONIVEL */
  valor?: number;
  /** o universo ou denominador da medida, quando existe */
  base?: number;
  unidade: UnidadeMedida;
  autoridade: AutoridadeMedida;
  /** só em DADO_INSUFICIENTE / NAO_APLICAVEL */
  motivoInsuficiencia?: string;
}

interface Def { id: string; descricao: string; unidade: UnidadeMedida; autoridade: AutoridadeMedida }

export const disponivel = (d: Def, valor: number, base?: number): MedidaComercial =>
  ({ ...d, estado: 'DISPONIVEL', valor, ...(base === undefined ? {} : { base }) });

export const insuficiente = (d: Def, motivo: string, base?: number): MedidaComercial =>
  ({ ...d, estado: 'DADO_INSUFICIENTE', motivoInsuficiencia: motivo, ...(base === undefined ? {} : { base }) });

export const naoAplicavel = (d: Def, motivo: string): MedidaComercial => ({ ...d, estado: 'NAO_APLICAVEL', motivoInsuficiencia: motivo });

/**
 * Amostra mínima para publicar uma TAXA. Decisão D-4 ainda ABERTA: enquanto for `undefined`, nenhuma taxa é
 * publicada — toda razão sai DADO_INSUFICIENTE, mesmo com denominador positivo. Definir o valor é decisão humana.
 */
export const AMOSTRA_MINIMA_TAXA: number | undefined = undefined;

/** Taxa numerador ÷ denominador (unidade RAZAO, valor entre 0 e 1). Sem amostra defensável, DADO_INSUFICIENTE. */
export function taxa(d: Omit<Def, 'unidade'>, numerador: number, denominador: number, amostraMinima: number | undefined = AMOSTRA_MINIMA_TAXA): MedidaComercial {
  const def: Def = { ...d, unidade: 'RAZAO' };
  if (denominador <= 0) return insuficiente(def, 'sem amostra: o denominador é zero', denominador);
  if (amostraMinima === undefined) return insuficiente(def, 'amostra mínima para publicar taxa ainda não definida (decisão D-4)', denominador);
  if (denominador < amostraMinima) return insuficiente(def, `amostra abaixo da mínima (${denominador} < ${amostraMinima})`, denominador);
  return disponivel(def, numerador / denominador, denominador);
}
