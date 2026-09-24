// LE-3A — contrato da fonte oficial do CNO (Cadastro Nacional de Obras) dos Dados Abertos da Receita Federal.
//
// Este modulo e PURO: sem rede, sem fs, sem React, sem store, sem Supabase e sem variavel de ambiente. Ele so sabe
// transformar LINHAS de CSV oficiais em observacoes canonicas e projetar essas observacoes no payload que o
// intake do LE-1 consome. Quem baixa e le o snapshot e `scripts/cno.mts`, fora do core.
//
// FONTE (auditada em 23/09/2026, nao presumida):
//   landing  https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-de-obras-cno
//   dados    https://arquivos.receitafederal.gov.br/index.php/s/PC6732BXG9B98W3  -> cno.zip
//   dicionario https://arquivos.receitafederal.gov.br/index.php/s/XEa8aE7wJdMGzkE -> cno-metadados.pdf
// O artefato vivo VENCE a documentacao, e nesta fonte eles divergem em quatro pontos reais:
//   1. os arquivos sao minusculos (`cno.csv`), nao `CNO.CSV`;
//   2. o separador e VIRGULA, nao ponto-e-virgula;
//   3. o encoding e ISO-8859-1, nao UTF-8, e nao ha BOM;
//   4. Categoria/Destinacao/Tipo de obra/Tipo de Area vem como TEXTO ("Obra Nova"), embora o dicionario os
//      descreva como codigos ("0 - Obra Nova"). Aqui vale o texto.
// Alem disso o cabecalho oficial tem acentuacao INCONSISTENTE ("Código do Pais", "Nome do pais",
// "Data de inicio da responsabilidade", "Qualificação do responsavel"): copiar exatamente, nao "corrigir".
//
// O que este modulo NAO faz: nao cria empresa, nao pontua, nao filtra por regiao/porte/area e nao decide nada
// comercial. Descoberta real e politica de selecao sao gates proprios.
import type { PedidoIntake } from './leadEngineIntake';
import { normalizarCnpj } from './normalizar';

// ---------------------------------------------------------------------------------------------------------
// 1. Distribuicao

/** A Receita publica SNAPSHOT completo em ZIP unico. Nao ha endpoint incremental nem API de consulta. */
export const MODO_FONTE_CNO = 'SNAPSHOT' as const;

/** Host unico autorizado para o artefato. O reader e fail-closed: qualquer outro host e recusado. */
export const HOST_OFICIAL_CNO = 'arquivos.receitafederal.gov.br';

/** Encoding real do CSV. Declarado aqui porque o core nao decodifica bytes: quem le o arquivo e que aplica. */
export const ENCODING_CNO = 'latin1' as const;

/** Nomes reais dos membros do cno.zip, em minusculo, como o artefato entrega. */
export const ARQUIVOS_CNO = ['cno.csv', 'cno_cnaes.csv', 'cno_vinculos.csv', 'cno_areas.csv', 'cno_totais.csv'] as const;
export type ArquivoCno = (typeof ARQUIVOS_CNO)[number];

// ---------------------------------------------------------------------------------------------------------
// 2. Cabecalhos oficiais — copiados do artefato, com a acentuacao que ele realmente usa

export const CABECALHO_CNO = [
  'CNO', 'Código do Pais', 'Nome do pais', 'Data de início', 'Data de inicio da responsabilidade',
  'Data de registro', 'CNO vinculado', 'CEP', 'NI do responsável', 'Qualificação do responsavel', 'Nome',
  'Código do municipio', 'Nome do município', 'Tipo de logradouro', 'Logradouro', 'Número do logradouro',
  'Bairro', 'Estado', 'Caixa Postal', 'Complemento', 'Unidade de medida', 'Área total', 'Situação',
  'Data da situação', 'Nome empresarial', 'Código de localização',
] as const;

export const CABECALHO_CNO_AREAS = ['CNO', 'Categoria', 'Destinação', 'Tipo de obra', 'Tipo de Área', 'Tipo de Área Complementar', 'Metragem'] as const;
export const CABECALHO_CNO_CNAES = ['CNO', 'CNAE', 'Data de registro'] as const;
export const CABECALHO_CNO_VINCULOS = ['CNO', 'Data de início', 'Data de fim', 'Data de registro', 'Qualificação do contribuinte', 'NI do responsável'] as const;
export const CABECALHO_CNO_TOTAIS = ['Total de obras', 'Total de cnaes', 'Total de áreas', 'Total de vínculos'] as const;

export const CABECALHOS_CNO: Record<ArquivoCno, readonly string[]> = {
  'cno.csv': CABECALHO_CNO,
  'cno_areas.csv': CABECALHO_CNO_AREAS,
  'cno_cnaes.csv': CABECALHO_CNO_CNAES,
  'cno_vinculos.csv': CABECALHO_CNO_VINCULOS,
  'cno_totais.csv': CABECALHO_CNO_TOTAIS,
};

// ---------------------------------------------------------------------------------------------------------
// 3. Tabelas de codigo do dicionario oficial (cno-metadados.pdf)

export const SITUACAO_CNO: Record<string, string> = { '01': 'NULA', '02': 'ATIVA', '03': 'SUSPENSA', '14': 'PARALISADA', '15': 'ENCERRADA' };

export const QUALIFICACAO_CNO: Record<string, string> = {
  '0053': 'Pessoa Jurídica Construtora', '0057': 'Dono da Obra', '0064': 'Incorporador de Construção Civil',
  '0070': 'Proprietário do Imóvel', '0109': 'Consórcio', '0110': 'Construção em nome coletivo',
  '0111': 'Sociedade Líder de Consórcio',
};

export const CATEGORIAS_AREA = ['Obra Nova', 'Acréscimo', 'Reforma', 'Demolição', 'Existente'] as const;
export const DESTINACOES_AREA = [
  'Residencial unifamiliar', 'Residencial multifamiliar', 'Comercial salas e lojas', 'Edifício de Garagens',
  'Galpão industrial', 'Casa popular', 'Conjunto habitacional popular',
] as const;
/** "Tipo de obra" do CNO_AREAS e o METODO CONSTRUTIVO, nao a natureza da obra. Confundir os dois inverte a leitura. */
export const TIPOS_CONSTRUTIVOS = ['Alvenaria', 'Madeira', 'Mista'] as const;
export const TIPOS_AREA = ['Principal', 'Complementar'] as const;

// ---------------------------------------------------------------------------------------------------------
// 4. Leitura de CSV (virgula, aspas duplas, aspas escapadas por duplicacao)

/** Quebra UMA linha do CSV oficial em campos. Preserva string vazia; nao interpreta tipos. */
export function camposCsvCno(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentro) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; } else dentro = false;
      } else atual += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual);
  return campos;
}

/** Le a linha de cabecalho. Remove BOM se existir (o artefato atual nao tem, mas o contrato nao depende disso). */
export const cabecalhoCsvCno = (linha: string): string[] => camposCsvCno(linha.replace(/^\uFEFF/, ''));

export interface ConferenciaCabecalho {
  ok: boolean;
  faltando: string[];
  inesperados: string[];
}

/** Cabecalho desconhecido NUNCA passa em silencio: ou bate, ou sai diagnostico nomeando a diferenca. */
export function conferirCabecalho(lidos: string[], esperados: readonly string[]): ConferenciaCabecalho {
  const faltando = esperados.filter((e) => !lidos.includes(e));
  const inesperados = lidos.filter((l) => !esperados.includes(l));
  return { ok: !faltando.length && !inesperados.length, faltando, inesperados };
}

/** Mapa nome-da-coluna -> indice. Deixa o parser imune a reordenacao de colunas no snapshot. */
export function indicesDe(cabecalho: string[]): Record<string, number> {
  const ix: Record<string, number> = {};
  cabecalho.forEach((nome, i) => { if (ix[nome] === undefined) ix[nome] = i; });
  return ix;
}

/** A celula como a fonte entregou: texto, sem tipo e sem juizo. Chave = nome REAL da coluna. */
export type LinhaBruta = Record<string, string>;

/**
 * A linha inteira como objeto, ANTES de qualquer normalizacao. Preserva nome real da coluna, valor textual,
 * string vazia, o literal "null", codigo original, data como texto e coluna que a EIFF ainda nao usa.
 * Celula alem do cabecalho e preservada sob `#<indice>`: sobra de parsing tambem e evidencia.
 */
export function linhaComoObjeto(cabecalho: string[], campos: string[]): LinhaBruta {
  const bruta: LinhaBruta = {};
  cabecalho.forEach((nome, i) => { if (bruta[nome] === undefined) bruta[nome] = campos[i] ?? ''; });
  for (let i = cabecalho.length; i < campos.length; i++) bruta[`#${i}`] = campos[i];
  return bruta;
}

// ---------------------------------------------------------------------------------------------------------
// 5. Normalizacao de valor
//
// O campo "Nome" traz a string LITERAL `null` em ~8% das linhas do snapshot real (3.653 de 44.254 na amostra
// auditada). Tratar como texto valido colocaria "null" como nome de obra no Radar.

export function textoCno(v?: string): string | undefined {
  const t = (v ?? '').trim();
  if (!t || t.toLowerCase() === 'null') return undefined;
  return t;
}

export function numeroCno(v?: string): number | undefined {
  const t = textoCno(v);
  if (t === undefined) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** So aceita o formato oficial AAAA-MM-DD. Data fora do formato vira ausencia, nunca palpite. */
export function dataCno(v?: string): string | undefined {
  const t = textoCno(v);
  return t !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined;
}

/** O numero do CNO tem 12 digitos, com zeros a esquerda significativos: e string, nunca numero. */
export function cnoNormalizado(v?: string): string | undefined {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length === 12 ? d : undefined;
}

/**
 * Identidade forte do responsavel. O dicionario garante: "NI do responsavel ... Se for CPF o campo vira em
 * branco". A amostra real confirma — 9.178 linhas com NI, TODAS com 14 digitos e digito verificador valido,
 * e 35.076 sem NI, TODAS tambem sem nome empresarial. Reaproveita `normalizarCnpj`, o validador unico do
 * Radar: nao existe segundo validador de CNPJ no sistema.
 */
export const cnpjDoResponsavel = (ni?: string): string | undefined => normalizarCnpj(textoCno(ni));

// ---------------------------------------------------------------------------------------------------------
// 6. Tipos canonicos

export interface CnoAreaCanonica {
  categoria?: string;
  destinacao?: string;
  /** metodo construtivo (Alvenaria/Madeira/Mista), do campo oficial "Tipo de obra" */
  tipoConstrutivo?: string;
  tipoArea?: string;
  tipoAreaComplementar?: string;
  metragem?: number;
}

export interface CnoCnaeCanonico { cnae: string; dataRegistro?: string }

export interface CnoVinculoCanonico {
  inicio?: string;
  fim?: string;
  dataRegistro?: string;
  qualificacao?: string;
  qualificacaoNome?: string;
  cnpjResponsavel?: string;
}

/** A ponte: CSV oficial -> CnoObservacaoCanonica -> adapterCNO -> PedidoIntake. */
export interface CnoObservacaoCanonica {
  cno: string;

  dataInicio?: string;
  dataInicioResponsabilidade?: string;
  dataRegistro?: string;
  dataSituacao?: string;

  cnoVinculado?: string;

  /** so CNPJ valido; CPF/NI ausente fica undefined e NUNCA e inventado */
  cnpjResponsavel?: string;
  /** razao social da PJ responsavel, do campo oficial "Nome empresarial" */
  nomeResponsavel?: string;
  qualificacaoResponsavel?: string;
  qualificacaoResponsavelNome?: string;

  /** nome DA OBRA, do campo oficial "Nome". Nunca e razao social. */
  nomeObra?: string;

  municipio?: string;
  /** codigo TOM da Receita (4 digitos), nao IBGE */
  codigoMunicipioTom?: string;
  uf?: string;
  cep?: string;
  endereco?: string;
  bairro?: string;
  complemento?: string;
  /** "Código de localização": plus code (Open Location Code) quando preenchido */
  localizacao?: string;

  areaTotal?: number;
  unidadeMedida?: string;

  situacao?: string;
  situacaoNome?: string;

  areas: CnoAreaCanonica[];
  cnaes: CnoCnaeCanonico[];
  vinculos: CnoVinculoCanonico[];
}

export interface CnoTotais { obras?: number; cnaes?: number; areas?: number; vinculos?: number }

// ---------------------------------------------------------------------------------------------------------
// 7. Parsers de linha

const juntarEndereco = (tipo?: string, via?: string, numero?: string): string | undefined => {
  const partes = [tipo, via, numero].filter((p): p is string => !!p);
  return partes.length ? partes.join(' ') : undefined;
};

/** Uma linha de cno.csv vira a observacao SEM os joins. Linha sem CNO valido e descartada com diagnostico. */
export function obraDeLinha(campos: string[], ix: Record<string, number>): CnoObservacaoCanonica | undefined {
  const v = (nome: string) => campos[ix[nome]];
  const cno = cnoNormalizado(v('CNO'));
  if (!cno) return undefined;
  const situacao = textoCno(v('Situação'));
  const qualificacao = textoCno(v('Qualificação do responsavel'));
  return {
    cno,
    dataInicio: dataCno(v('Data de início')),
    dataInicioResponsabilidade: dataCno(v('Data de inicio da responsabilidade')),
    dataRegistro: dataCno(v('Data de registro')),
    dataSituacao: dataCno(v('Data da situação')),
    cnoVinculado: cnoNormalizado(v('CNO vinculado')),
    cnpjResponsavel: cnpjDoResponsavel(v('NI do responsável')),
    nomeResponsavel: textoCno(v('Nome empresarial')),
    qualificacaoResponsavel: qualificacao,
    qualificacaoResponsavelNome: qualificacao ? QUALIFICACAO_CNO[qualificacao] : undefined,
    nomeObra: textoCno(v('Nome')),
    municipio: textoCno(v('Nome do município')),
    codigoMunicipioTom: textoCno(v('Código do municipio')),
    uf: textoCno(v('Estado')),
    cep: textoCno(v('CEP')),
    endereco: juntarEndereco(textoCno(v('Tipo de logradouro')), textoCno(v('Logradouro')), textoCno(v('Número do logradouro'))),
    bairro: textoCno(v('Bairro')),
    complemento: textoCno(v('Complemento')),
    localizacao: textoCno(v('Código de localização')),
    areaTotal: numeroCno(v('Área total')),
    unidadeMedida: textoCno(v('Unidade de medida')),
    situacao,
    situacaoNome: situacao ? SITUACAO_CNO[situacao] : undefined,
    areas: [],
    cnaes: [],
    vinculos: [],
  };
}

export function areaDeLinha(campos: string[], ix: Record<string, number>): { cno: string; area: CnoAreaCanonica } | undefined {
  const v = (nome: string) => campos[ix[nome]];
  const cno = cnoNormalizado(v('CNO'));
  if (!cno) return undefined;
  return {
    cno,
    area: {
      categoria: textoCno(v('Categoria')),
      destinacao: textoCno(v('Destinação')),
      tipoConstrutivo: textoCno(v('Tipo de obra')),
      tipoArea: textoCno(v('Tipo de Área')),
      tipoAreaComplementar: textoCno(v('Tipo de Área Complementar')),
      metragem: numeroCno(v('Metragem')),
    },
  };
}

export function cnaeDeLinha(campos: string[], ix: Record<string, number>): { cno: string; cnae: CnoCnaeCanonico } | undefined {
  const v = (nome: string) => campos[ix[nome]];
  const cno = cnoNormalizado(v('CNO'));
  const cnae = textoCno(v('CNAE'));
  if (!cno || !cnae) return undefined;
  return { cno, cnae: { cnae, dataRegistro: dataCno(v('Data de registro')) } };
}

export function vinculoDeLinha(campos: string[], ix: Record<string, number>): { cno: string; vinculo: CnoVinculoCanonico } | undefined {
  const v = (nome: string) => campos[ix[nome]];
  const cno = cnoNormalizado(v('CNO'));
  if (!cno) return undefined;
  const qualificacao = textoCno(v('Qualificação do contribuinte'));
  return {
    cno,
    vinculo: {
      inicio: dataCno(v('Data de início')),
      fim: dataCno(v('Data de fim')),
      dataRegistro: dataCno(v('Data de registro')),
      qualificacao,
      qualificacaoNome: qualificacao ? QUALIFICACAO_CNO[qualificacao] : undefined,
      cnpjResponsavel: cnpjDoResponsavel(v('NI do responsável')),
    },
  };
}

export function totaisDeLinha(campos: string[], ix: Record<string, number>): CnoTotais {
  const v = (nome: string) => campos[ix[nome]];
  return {
    obras: numeroCno(v('Total de obras')),
    cnaes: numeroCno(v('Total de cnaes')),
    areas: numeroCno(v('Total de áreas')),
    vinculos: numeroCno(v('Total de vínculos')),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 8. Join por CNO

export const TIPOS_DIAGNOSTICO_CNO = ['AREA_ORFA', 'CNAE_ORFAO', 'VINCULO_ORFAO'] as const;
export type TipoDiagnosticoCno = (typeof TIPOS_DIAGNOSTICO_CNO)[number];
export interface DiagnosticoCno { tipo: TipoDiagnosticoCno; cno: string }

const cmp = (a?: string | number, b?: string | number): number => {
  const x = a === undefined ? '' : String(a);
  const y = b === undefined ? '' : String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

const ordenarAreas = (a: CnoAreaCanonica, b: CnoAreaCanonica): number =>
  cmp(a.tipoArea, b.tipoArea) || cmp(a.categoria, b.categoria) || cmp(a.destinacao, b.destinacao)
  || cmp(a.tipoAreaComplementar, b.tipoAreaComplementar) || cmp(a.tipoConstrutivo, b.tipoConstrutivo)
  || cmp(a.metragem, b.metragem);

/**
 * Junta os quatro arquivos pela chave CNO. Area/CNAE/vinculo cujo CNO nao existe em cno.csv NAO e descartado
 * em silencio: vira diagnostico. A ordem de saida e deterministica (por CNO e, dentro, por chave da linha)
 * porque o fingerprint do LE-1 e calculado sobre este payload.
 */
export function juntarCno(entrada: {
  obras: CnoObservacaoCanonica[];
  areas?: { cno: string; area: CnoAreaCanonica }[];
  cnaes?: { cno: string; cnae: CnoCnaeCanonico }[];
  vinculos?: { cno: string; vinculo: CnoVinculoCanonico }[];
}): { observacoes: CnoObservacaoCanonica[]; diagnosticos: DiagnosticoCno[] } {
  const porCno = new Map<string, CnoObservacaoCanonica>();
  for (const o of entrada.obras) porCno.set(o.cno, { ...o, areas: [], cnaes: [], vinculos: [] });
  const diagnosticos: DiagnosticoCno[] = [];

  for (const a of entrada.areas ?? []) {
    const alvo = porCno.get(a.cno);
    if (!alvo) { diagnosticos.push({ tipo: 'AREA_ORFA', cno: a.cno }); continue; }
    alvo.areas.push(a.area);
  }
  for (const c of entrada.cnaes ?? []) {
    const alvo = porCno.get(c.cno);
    if (!alvo) { diagnosticos.push({ tipo: 'CNAE_ORFAO', cno: c.cno }); continue; }
    alvo.cnaes.push(c.cnae);
  }
  for (const v of entrada.vinculos ?? []) {
    const alvo = porCno.get(v.cno);
    if (!alvo) { diagnosticos.push({ tipo: 'VINCULO_ORFAO', cno: v.cno }); continue; }
    alvo.vinculos.push(v.vinculo);
  }

  const observacoes = [...porCno.values()].sort((a, b) => cmp(a.cno, b.cno));
  for (const o of observacoes) {
    o.areas.sort(ordenarAreas);
    o.cnaes.sort((a, b) => cmp(a.cnae, b.cnae) || cmp(a.dataRegistro, b.dataRegistro));
    o.vinculos.sort((a, b) => cmp(a.inicio, b.inicio) || cmp(a.qualificacao, b.qualificacao) || cmp(a.cnpjResponsavel, b.cnpjResponsavel));
  }
  return { observacoes, diagnosticos };
}

// ---------------------------------------------------------------------------------------------------------
// 9. Politica de sinal — estrutural, nunca por regex no texto
//
// A Categoria oficial do CNO_AREAS ja diz a natureza da obra. Demolicao e Existente NAO sao obra nova e nao
// viram sinal: preferimos nenhum sinal a um sinal errado. O bruto continua preservado de qualquer forma.

export type SinalCno = 'CNO_NEW' | 'CNO_EXPANSION' | 'NENHUM';

export const SINAL_POR_CATEGORIA: Record<string, SinalCno> = {
  'Obra Nova': 'CNO_NEW',
  'Acréscimo': 'CNO_EXPANSION',
  'Reforma': 'CNO_EXPANSION',
  'Demolição': 'NENHUM',
  'Existente': 'NENHUM',
};

/**
 * Um CNO costuma ter varias areas (36.852 de ~90 mil CNOs na amostra real). Precedencia declarada:
 * qualquer area "Obra Nova" vence; senao Acrescimo/Reforma viram expansao; senao nao ha sinal.
 * Sem areas ou com categoria desconhecida tambem nao ha sinal — ausencia de evidencia nao vira evidencia.
 */
export function sinalCno(obs: Pick<CnoObservacaoCanonica, 'areas'>): SinalCno {
  let expansao = false;
  for (const a of obs.areas) {
    const s = a.categoria ? SINAL_POR_CATEGORIA[a.categoria] : undefined;
    if (s === 'CNO_NEW') return 'CNO_NEW';
    if (s === 'CNO_EXPANSION') expansao = true;
  }
  return expansao ? 'CNO_EXPANSION' : 'NENHUM';
}

// ---------------------------------------------------------------------------------------------------------
// 10. Data do evento
//
// O adapter antigo caia em `new Date()` quando faltava data. Para dado historico do CNO isso seria inventar um
// evento de hoje para uma obra de 1992. Aqui a precedencia e explicita e a ausencia e nomeada.

export const ORIGENS_DATA_EVENTO_CNO = ['dataInicio', 'dataRegistro', 'dataSituacao'] as const;
export type OrigemDataEventoCno = (typeof ORIGENS_DATA_EVENTO_CNO)[number];
export const SEM_EVENTO_DATADO = 'SEM_EVENTO_DATADO';

export function dataEventoCno(obs: CnoObservacaoCanonica): { data: string; origem: OrigemDataEventoCno } | undefined {
  for (const origem of ORIGENS_DATA_EVENTO_CNO) {
    const data = obs[origem];
    if (data) return { data, origem };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// 11. Projecao para o intake do LE-1

/** Identidade externa do objeto no CNO: o numero do CNO. Nunca CNPJ, nome da obra, hash ou posicao no arquivo. */
export const externoIdCno = (obs: { cno: string }): string => obs.cno;

/**
 * Payload canonico gravado como evidencia bruta em `RegistroFonte.payload` e consumido por `adapterCNO`.
 * As chaves sao estaveis porque o fingerprint do LE-1 e o sha256 deste objeto: mudar chave e mudar impressao.
 * `tipoSinal` vai explicito para o adapter nao precisar adivinhar pelo texto.
 */
export function payloadCno(obs: CnoObservacaoCanonica): Record<string, unknown> {
  const evento = dataEventoCno(obs);
  return {
    fonte: 'CNO',
    cno: obs.cno,
    nomeObra: obs.nomeObra,
    cnpjResponsavel: obs.cnpjResponsavel,
    nomeResponsavel: obs.nomeResponsavel,
    qualificacaoResponsavel: obs.qualificacaoResponsavel,
    qualificacaoResponsavelNome: obs.qualificacaoResponsavelNome,
    municipio: obs.municipio,
    codigoMunicipioTom: obs.codigoMunicipioTom,
    uf: obs.uf,
    cep: obs.cep,
    endereco: obs.endereco,
    bairro: obs.bairro,
    complemento: obs.complemento,
    localizacao: obs.localizacao,
    areaTotal: obs.areaTotal,
    unidadeMedida: obs.unidadeMedida,
    situacao: obs.situacao,
    situacaoNome: obs.situacaoNome,
    dataInicio: obs.dataInicio,
    dataInicioResponsabilidade: obs.dataInicioResponsabilidade,
    dataRegistro: obs.dataRegistro,
    dataSituacao: obs.dataSituacao,
    cnoVinculado: obs.cnoVinculado,
    tipoSinal: sinalCno(obs),
    dataEvento: evento?.data,
    origemDataEvento: evento?.origem ?? SEM_EVENTO_DATADO,
    areas: obs.areas,
    cnaes: obs.cnaes,
    vinculos: obs.vinculos,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 12. Evidencia bruta ao lado da projecao canonica
//
// LE3-A1. A versao anterior mandava SO `payloadCno(obs)` para o intake, e isso perdia a origem: o "null"
// literal sumia, o NI com pontuacao sumia, e coluna que a EIFF ainda nao usa sumia. Normalizacao e uma LEITURA
// do dado, nao o dado. `RegistroFonte.payload` passa a carregar as duas coisas, e a evidencia e a que o trigger
// `radar_source_record_evidencia` torna imutavel no banco.

export interface CnoSourceEvidence {
  obra: LinhaBruta;
  areas: LinhaBruta[];
  cnaes: LinhaBruta[];
  vinculos: LinhaBruta[];
}

/** Uma observacao completa: a evidencia como veio e a projecao canonica, ligadas pelo mesmo CNO. */
export interface CnoObservacao {
  cno: string;
  evidence: CnoSourceEvidence;
  canonical: CnoObservacaoCanonica;
}

export interface LinhaLida<T> { cno: string; bruta: LinhaBruta; canonica: T }

const lerPar = <T extends object>(
  cabecalho: string[], campos: string[],
  parse: () => { cno: string; canonica: T } | undefined,
): LinhaLida<T> | undefined => {
  const p = parse();
  return p && { cno: p.cno, bruta: linhaComoObjeto(cabecalho, campos), canonica: p.canonica };
};

export const lerObraCno = (cabecalho: string[], ix: Record<string, number>, campos: string[]): LinhaLida<CnoObservacaoCanonica> | undefined =>
  lerPar(cabecalho, campos, () => { const c = obraDeLinha(campos, ix); return c && { cno: c.cno, canonica: c }; });

export const lerAreaCno = (cabecalho: string[], ix: Record<string, number>, campos: string[]): LinhaLida<CnoAreaCanonica> | undefined =>
  lerPar(cabecalho, campos, () => { const a = areaDeLinha(campos, ix); return a && { cno: a.cno, canonica: a.area }; });

export const lerCnaeCno = (cabecalho: string[], ix: Record<string, number>, campos: string[]): LinhaLida<CnoCnaeCanonico> | undefined =>
  lerPar(cabecalho, campos, () => { const c = cnaeDeLinha(campos, ix); return c && { cno: c.cno, canonica: c.cnae }; });

export const lerVinculoCno = (cabecalho: string[], ix: Record<string, number>, campos: string[]): LinhaLida<CnoVinculoCanonico> | undefined =>
  lerPar(cabecalho, campos, () => { const v = vinculoDeLinha(campos, ix); return v && { cno: v.cno, canonica: v.vinculo }; });

/**
 * Junta os quatro arquivos preservando os DOIS lados. A ordenacao e feita sobre os pares, entao a linha bruta
 * de indice `i` continua sendo a origem da linha canonica de indice `i` — a ordem deterministica vale para a
 * evidencia tambem, e e por isso que o fingerprint nao depende da ordem de leitura do arquivo.
 */
export function juntarObservacoesCno(entrada: {
  obras: LinhaLida<CnoObservacaoCanonica>[];
  areas?: LinhaLida<CnoAreaCanonica>[];
  cnaes?: LinhaLida<CnoCnaeCanonico>[];
  vinculos?: LinhaLida<CnoVinculoCanonico>[];
}): { observacoes: CnoObservacao[]; diagnosticos: DiagnosticoCno[] } {
  const porCno = new Map<string, { obra: LinhaLida<CnoObservacaoCanonica>; areas: LinhaLida<CnoAreaCanonica>[]; cnaes: LinhaLida<CnoCnaeCanonico>[]; vinculos: LinhaLida<CnoVinculoCanonico>[] }>();
  for (const o of entrada.obras) porCno.set(o.cno, { obra: o, areas: [], cnaes: [], vinculos: [] });
  const diagnosticos: DiagnosticoCno[] = [];

  const anexar = <T>(linhas: LinhaLida<T>[] | undefined, campo: 'areas' | 'cnaes' | 'vinculos', orfao: TipoDiagnosticoCno) => {
    for (const l of linhas ?? []) {
      const alvo = porCno.get(l.cno);
      if (!alvo) { diagnosticos.push({ tipo: orfao, cno: l.cno }); continue; }
      (alvo[campo] as LinhaLida<T>[]).push(l);
    }
  };
  anexar(entrada.areas, 'areas', 'AREA_ORFA');
  anexar(entrada.cnaes, 'cnaes', 'CNAE_ORFAO');
  anexar(entrada.vinculos, 'vinculos', 'VINCULO_ORFAO');

  const observacoes = [...porCno.values()]
    .sort((a, b) => cmp(a.obra.cno, b.obra.cno))
    .map(({ obra, areas, cnaes, vinculos }) => {
      areas.sort((a, b) => ordenarAreas(a.canonica, b.canonica));
      cnaes.sort((a, b) => cmp(a.canonica.cnae, b.canonica.cnae) || cmp(a.canonica.dataRegistro, b.canonica.dataRegistro));
      vinculos.sort((a, b) => cmp(a.canonica.inicio, b.canonica.inicio) || cmp(a.canonica.qualificacao, b.canonica.qualificacao) || cmp(a.canonica.cnpjResponsavel, b.canonica.cnpjResponsavel));
      return {
        cno: obra.cno,
        evidence: { obra: obra.bruta, areas: areas.map((a) => a.bruta), cnaes: cnaes.map((c) => c.bruta), vinculos: vinculos.map((v) => v.bruta) },
        canonical: { ...obra.canonica, areas: areas.map((a) => a.canonica), cnaes: cnaes.map((c) => c.canonica), vinculos: vinculos.map((v) => v.canonica) },
      };
    });
  return { observacoes, diagnosticos };
}

// ---------------------------------------------------------------------------------------------------------
// 13. Envelope do intake

/** Versao do envelope. O adapter so aceita `canonical` aninhado sob este schema — sem heuristica ambigua. */
export const SCHEMA_CNO = 'CNO_OPEN_DATA_V1' as const;

export interface EnvelopeCno {
  schema: typeof SCHEMA_CNO;
  evidence: CnoSourceEvidence;
  canonical: Record<string, unknown>;
}

/**
 * O que vai em `RegistroFonte.payload`, e portanto o que o fingerprint do LE-1 mede.
 *
 * Deliberadamente NAO entra aqui nada de proveniencia do snapshot — `ETag`, `Last-Modified`, quando baixamos,
 * caminho temporario, posicao no ZIP. Qualquer um desses faria o MESMO CNO, com os MESMOS dados, gerar
 * impressao nova a cada leitura, destruindo a idempotencia que o LE-1 existe para garantir. Proveniencia de
 * snapshot pertence ao log do leitor, nao a observacao.
 */
export function envelopeCno(o: CnoObservacao): EnvelopeCno {
  return { schema: SCHEMA_CNO, evidence: o.evidence, canonical: payloadCno(o.canonical) };
}

// ---------------------------------------------------------------------------------------------------------
// 14. Contexto CNO para APRESENTACAO na revisao (LE3-D.1)
//
// A tela de candidatos nao pode interpretar payload bruto em React nem recalcular regra. Esta projecao le o
// `canonical` do envelope e devolve so o que a revisao comercial precisa ler. Nada aqui decide nada.

export interface ContextoCnoRevisao {
  cno: string;
  nomeObra?: string;
  municipio?: string;
  uf?: string;
  endereco?: string;
  bairro?: string;
  areaM2?: number;
  unidadeMedida?: string;
  situacao?: string;
  situacaoNome?: string;
  /** data OFICIAL do evento no CNO (precedencia do §34.7) — NUNCA a data em que a EIFF descobriu */
  dataEventoCno?: string;
  origemDataEvento?: string;
  categorias: string[];
  destinacoes: string[];
  tipoSinal: SinalCno;
  cnpjResponsavel?: string;
  nomeResponsavel?: string;
  qualificacaoResponsavel?: string;
  qualificacaoResponsavelNome?: string;
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).categoria ?? (x as Record<string, unknown>).destinacao ?? '') : String(x ?? ''))).filter(Boolean))].sort() : []);

/** Le o envelope `CNO_OPEN_DATA_V1` e projeta o contexto de revisao. Payload que nao e desse schema -> undefined. */
export function contextoCnoDoPayload(payload: unknown): ContextoCnoRevisao | undefined {
  const env = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
  if (!env || env.schema !== SCHEMA_CNO) return undefined;
  const c = env.canonical && typeof env.canonical === 'object' ? (env.canonical as Record<string, unknown>) : undefined;
  if (!c || typeof c.cno !== 'string') return undefined;
  const s = (k: string): string | undefined => (typeof c[k] === 'string' && (c[k] as string).trim() ? (c[k] as string) : undefined);
  const areas = Array.isArray(c.areas) ? (c.areas as Record<string, unknown>[]) : [];
  const tipoSinal = (['CNO_NEW', 'CNO_EXPANSION', 'NENHUM'] as const).find((x) => x === c.tipoSinal) ?? 'NENHUM';
  const unidade = s('unidadeMedida');
  return {
    cno: c.cno,
    nomeObra: s('nomeObra'),
    municipio: s('municipio'),
    uf: s('uf'),
    endereco: s('endereco'),
    bairro: s('bairro'),
    areaM2: typeof c.areaTotal === 'number' && (unidade ?? '').toLowerCase() === 'm2' ? (c.areaTotal as number) : undefined,
    unidadeMedida: unidade,
    situacao: s('situacao'),
    situacaoNome: s('situacaoNome'),
    dataEventoCno: s('dataEvento'),
    origemDataEvento: s('origemDataEvento'),
    categorias: lista(areas.map((a) => a.categoria)),
    destinacoes: lista(areas.map((a) => a.destinacao)),
    tipoSinal,
    cnpjResponsavel: s('cnpjResponsavel'),
    nomeResponsavel: s('nomeResponsavel'),
    qualificacaoResponsavel: s('qualificacaoResponsavel'),
    qualificacaoResponsavelNome: s('qualificacaoResponsavelNome'),
  };
}

/** A observacao vira pedido de intake. `tipo` e `projeto`: uma obra e um projeto, nunca uma empresa por si so. */
export function pedidoIntakeCno(o: CnoObservacao, fonteId: string, recebidoEm: string): PedidoIntake {
  return { fonteId, tipo: 'projeto', externoId: externoIdCno(o), payload: envelopeCno(o), recebidoEm };
}
