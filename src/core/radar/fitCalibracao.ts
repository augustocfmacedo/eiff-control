// CALIBRATION PILOT 02: FIT com os dados que realmente existem no lote Vibe. Tudo aqui e SIMULACAO PURA e
// HIPOTESE DE CALIBRACAO: nada altera regras, empresas ou sinais. O setor original nunca e sobrescrito: a categoria
// canonica e derivada com o motivo. Dados ausentes rendem 0 pontos (nada e inventado). Sinais/timing nao entram no FIT.
import type { Empresa } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Normalizacao de faixas (o Vibe entrega "[501-1000]", "[75M-200M]"; as regras atuais esperam "501-1000")
// ---------------------------------------------------------------------------------------------------------------------
export const faixaSemColchetes = (v?: string) => (v ?? '').trim().replace(/^\[|\]$/g, '');
/** Limite superior da faixa de funcionarios (ou inferior quando "10001+"). */
export function funcionariosDe(faixa?: string): number | undefined { const f = faixaSemColchetes(faixa); const ns = (f.match(/\d+/g) ?? []).map(Number); if (!ns.length) return undefined; return ns[ns.length - 1]; }
/** Limite superior da faixa de receita em milhoes (M) — "1B-10B" vira 10000. */
export function receitaMilhoesDe(faixa?: string): number | undefined {
  const f = faixaSemColchetes(faixa).toUpperCase(); const partes = f.match(/(\d+(?:\.\d+)?)\s*([MB])/g); if (!partes?.length) return undefined;
  const ultimo = partes[partes.length - 1]; const n = parseFloat(ultimo); return ultimo.endsWith('B') ? n * 1000 : n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Categoria canonica de setor (derivada; valor bruto preservado)
// ---------------------------------------------------------------------------------------------------------------------
export type CategoriaSetor = 'ALIMENTOS_BEBIDAS' | 'BIOENERGIA_USINAS' | 'INDUSTRIA' | 'QUIMICA_FERTILIZANTES' | 'LOGISTICA_DISTRIBUICAO' | 'COOPERATIVA' | 'SEMENTES' | 'DISTRIBUICAO_INSUMOS_AGRO' | 'VAREJO_ATACADO' | 'MAQUINAS_EQUIPAMENTOS' | 'PRODUCAO_AGRICOLA' | 'HOLDING_DIVERSIFICADO' | 'SERVICOS_CONSULTORIA' | 'ASSOCIACAO_ENTIDADE' | 'MINERACAO' | 'CONSTRUCAO_ENGENHARIA' | 'FARMACEUTICA' | 'OUTROS';
export const CATEGORIAS_SETOR: CategoriaSetor[] = ['ALIMENTOS_BEBIDAS', 'BIOENERGIA_USINAS', 'INDUSTRIA', 'QUIMICA_FERTILIZANTES', 'LOGISTICA_DISTRIBUICAO', 'COOPERATIVA', 'SEMENTES', 'DISTRIBUICAO_INSUMOS_AGRO', 'VAREJO_ATACADO', 'MAQUINAS_EQUIPAMENTOS', 'PRODUCAO_AGRICOLA', 'HOLDING_DIVERSIFICADO', 'SERVICOS_CONSULTORIA', 'ASSOCIACAO_ENTIDADE', 'MINERACAO', 'CONSTRUCAO_ENGENHARIA', 'FARMACEUTICA', 'OUTROS'];
export interface EntradaSetor { nome?: string; setor?: string; naics?: string; naicsDescricao?: string; sic?: string; sicDescricao?: string; descricao?: string }
export interface ClassificacaoSetor { categoria: CategoriaSetor; motivo: string; evidencia: 'nome' | 'descricao' | 'naics' | 'sic' | 'padrao'; original: { setor?: string; naics?: string; sic?: string } }

const norm = (s?: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
type Regra = [RegExp, CategoriaSetor, string];
/**
 * Regras no NOME da empresa, em ordem de prioridade (entidade > cooperativa > usina > alimentos > atacado > maquinas > logistica ...).
 * O nome e a evidencia mais confiavel; "Fundacao MT", "Cooperativa COMIGO", "Sementes Talisma" resolvem aqui.
 */
const REGRAS_NOME: Regra[] = [
  [/\b(associacao|confederacao|federacao|sindicato|instituto|fundacao|embrapa|sistema famasul)\b/, 'ASSOCIACAO_ENTIDADE', 'entidade/associação/pesquisa'],
  [/\b(cooperativa|copasul|comigo)\b/, 'COOPERATIVA', 'cooperativa'],
  [/\b(acucar|etanol|alcool|bioenergia|biorrefinaria|usina)\b/, 'BIOENERGIA_USINAS', 'usina/bioenergia'],
  [/\b(alimentos|frigorific\w*|biscoit\w*|frango|carnes?|foods?|beef|laticinios)\b/, 'ALIMENTOS_BEBIDAS', 'alimentos/bebidas'],
  [/\b(atacad\w*|supermercad\w*|atacarejo)\b/, 'VAREJO_ATACADO', 'atacado/varejo'],
  [/\b(maquinas agricolas|john deere|case ih|veiculos|caminhoes|implementos)\b/, 'MAQUINAS_EQUIPAMENTOS', 'concessionária/máquinas'],
  [/\b(transportes?|logistica|distribuidora|cargas)\b/, 'LOGISTICA_DISTRIBUICAO', 'transporte/logística/distribuidora'],
  [/\b(holding)\b/, 'HOLDING_DIVERSIFICADO', 'holding diversificada'],
  [/\b(comercial agricola|agromercantil|agrovenci|insumos)\b/, 'DISTRIBUICAO_INSUMOS_AGRO', 'revenda/distribuição de insumos'],
  [/\b(sementes?|genetica)\b/, 'SEMENTES', 'sementes/beneficiamento'],
  [/\b(consultoria|classific\w*)\b/, 'SERVICOS_CONSULTORIA', 'consultoria/serviços'],
  [/\b(nutricao vegetal|quimica|fertiliz\w*)\b/, 'QUIMICA_FERTILIZANTES', 'fertilizantes/nutrição/química'],
  [/\b(fazendas?|agropecuaria)\b/, 'PRODUCAO_AGRICOLA', 'produção agrícola/pecuária'],
  [/\b(industria|fabrica)\b/, 'INDUSTRIA', 'indústria'],
  [/\b(mineracao|mining|minerio)\b/, 'MINERACAO', 'mineração'],
  [/\b(construcao|engenharia|construtora)\b/, 'CONSTRUCAO_ENGENHARIA', 'construção/engenharia'],
  [/\b(farmac\w*|pharma\w*)\b/, 'FARMACEUTICA', 'farmacêutica'],
];
/**
 * Regras na DESCRICAO (portugues sem acento ou ingles). Termos ambiguos ficaram de fora de proposito: "fundacao" (da empresa),
 * "alimentos" (producao de alimentos = agricultura), "talentos". A ordem resolve empates: revenda antes de sementes/quimica/servicos.
 */
const REGRAS_DESCRICAO: Regra[] = [
  [/\b(associacao|confederacao|federacao|sindicato)\b/, 'ASSOCIACAO_ENTIDADE', 'entidade/associação'],
  [/\b(cooperativa)\b/, 'COOPERATIVA', 'cooperativa'],
  [/\b(acucar|etanol|alcool|bioenergia|biorrefinaria|sucroenergetic\w*|usina|cogeracao)\b/, 'BIOENERGIA_USINAS', 'usina/bioenergia'],
  [/\b(frigorific\w*|biscoit\w*|frango|carnes?|torrado|atomatados|condimentos|nutricao animal|racao|racoes|derivados de milho|corn derivatives|industria de alimentos|laticinios|bebidas)\b/, 'ALIMENTOS_BEBIDAS', 'alimentos/bebidas'],
  [/\b(atacad\w*|supermercad\w*|atacarejo)\b/, 'VAREJO_ATACADO', 'atacado/varejo'],
  [/\b(concessionari\w*|dealer|maquinas agricolas|john deere|case ih|caminhoes|irrigacao)\b/, 'MAQUINAS_EQUIPAMENTOS', 'concessionária/máquinas'],
  [/\b(transporte\w*|frete|logistic\w*|transportando|distribuicao urbana|transferencias de produtos)\b/, 'LOGISTICA_DISTRIBUICAO', 'transporte/logística'],
  [/\b(holding)\b/, 'HOLDING_DIVERSIFICADO', 'holding diversificada'],
  [/\b(distribuidor\w*|revend\w*|insumos|fornecimento de (fertilizantes|defensivos|insumos)|defensivos|comercial agricola|comercializ\w* (de )?insumos|rede de acesso ao mercado|solucoes agricolas|parceiro do produtor|lojas)\b/, 'DISTRIBUICAO_INSUMOS_AGRO', 'revenda/distribuição de insumos'],
  [/\b(sementes?|germoplasma|beneficiamento)\b/, 'SEMENTES', 'sementes/beneficiamento'],
  [/\b(consultoria|assistencia tecnica|recrut\w*|programa de aplicacoes|aplicacao de produtos)\b/, 'SERVICOS_CONSULTORIA', 'consultoria/serviços'],
  [/\b(fertiliz\w*|nutricao (vegetal|de plantas)|fitossanit\w*|quimic\w*|plant protection|nutrition|algas)\b/, 'QUIMICA_FERTILIZANTES', 'fertilizantes/nutrição/química'],
  [/\b(fazenda\w*|produtora de graos|producao de graos|plantio|agropecuari\w*|pecuaria|graos|soja|algodao|milho|terras agricolas|feedlot\w*|cattle)\b/, 'PRODUCAO_AGRICOLA', 'produção agrícola/pecuária'],
  [/\b(fabricante|fabrica|industria|manufactur\w*|higiene e limpeza)\b/, 'INDUSTRIA', 'indústria'],
  [/\b(mineracao|mining|minerio)\b/, 'MINERACAO', 'mineração'],
  [/\b(construcao|engenharia|construction)\b/, 'CONSTRUCAO_ENGENHARIA', 'construção/engenharia'],
  [/\b(farmac\w*|pharma\w*|medicamentos?)\b/, 'FARMACEUTICA', 'farmacêutica'],
];
const REGRAS_NAICS: Regra[] = [
  [/food manufacturing|bottled and canned|food preparations/, 'ALIMENTOS_BEBIDAS', 'NAICS/SIC de alimentos'],
  [/transportation|warehousing|trucking|freight/, 'LOGISTICA_DISTRIBUICAO', 'NAICS/SIC de transporte e armazenagem'],
  [/grocery|wholesale/, 'VAREJO_ATACADO', 'NAICS/SIC de atacado'],
  [/manufacturing/, 'INDUSTRIA', 'NAICS/SIC de manufatura'],
  [/cattle|ranching|farm|crop|agriculture/, 'PRODUCAO_AGRICOLA', 'NAICS/SIC de produção agrícola'],
];

/** Classifica de forma deterministica: nome, depois descricao, depois NAICS/SIC; sem evidencia = OUTROS. O original nunca muda. */
export function classificarSetor(x: EntradaSetor): ClassificacaoSetor {
  const original = { setor: x.setor, naics: x.naics ? `${x.naics} ${x.naicsDescricao ?? ''}`.trim() : x.naicsDescricao, sic: x.sic ? `${x.sic} ${x.sicDescricao ?? ''}`.trim() : x.sicDescricao };
  const nome = norm(x.nome); const desc = norm(x.descricao);
  for (const [re, categoria, rotulo] of REGRAS_NOME) { const m = nome.match(re); if (m) return { categoria, motivo: `nome contém "${m[0]}" (${rotulo})`, evidencia: 'nome', original }; }
  for (const [re, categoria, rotulo] of REGRAS_DESCRICAO) { const m = desc.match(re); if (m) return { categoria, motivo: `descrição contém "${m[0]}" (${rotulo})`, evidencia: 'descricao', original }; }
  const codigo = norm(`${x.naicsDescricao ?? ''} ${x.sicDescricao ?? ''} ${x.setor ?? ''}`);
  for (const [re, categoria, rotulo] of REGRAS_NAICS) { const m = codigo.match(re); if (m) return { categoria, motivo: `${rotulo}: "${m[0]}" (sem evidência no nome/descrição)`, evidencia: x.naicsDescricao || x.setor ? 'naics' : 'sic', original }; }
  return { categoria: 'OUTROS', motivo: 'sem evidência de setor', evidencia: 'padrao', original };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cenarios de FIT — HIPOTESE DE CALIBRACAO (soma dos pesos = 100)
// ---------------------------------------------------------------------------------------------------------------------
export type NomeCenarioFit = 'CONSERVADOR' | 'BALANCEADO' | 'AGRESSIVO';
export interface CenarioFit {
  nome: NomeCenarioFit;
  pesos: { geografia: number; setor: number; funcionarios: number; receita: number; porteIndustrial: number };
  afinidade: Record<CategoriaSetor, number>; // 0-1: relevancia comercial da categoria para estrutura metalica/galpao/fabrica
  geografia: { principal: string[]; fatorPrincipal: number; alvo: string[]; fatorAlvo: number };
}
const AF = (o: Partial<Record<CategoriaSetor, number>>, padrao: number): Record<CategoriaSetor, number> => Object.fromEntries(CATEGORIAS_SETOR.map((c) => [c, o[c] ?? padrao])) as Record<CategoriaSetor, number>;
const UFS_ALVO = ['GO', 'DF', 'MG', 'SP', 'TO', 'MT', 'MS', 'BA'];
export const CENARIOS_FIT: Record<NomeCenarioFit, CenarioFit> = {
  CONSERVADOR: { nome: 'CONSERVADOR', pesos: { geografia: 15, setor: 40, funcionarios: 20, receita: 15, porteIndustrial: 10 }, geografia: { principal: ['GO'], fatorPrincipal: 1, alvo: UFS_ALVO, fatorAlvo: 0.85 },
    afinidade: AF({ ALIMENTOS_BEBIDAS: 1, BIOENERGIA_USINAS: 1, INDUSTRIA: 1, QUIMICA_FERTILIZANTES: 0.9, LOGISTICA_DISTRIBUICAO: 0.8, COOPERATIVA: 0.8, SEMENTES: 0.7, DISTRIBUICAO_INSUMOS_AGRO: 0.6, VAREJO_ATACADO: 0.5, MAQUINAS_EQUIPAMENTOS: 0.5, PRODUCAO_AGRICOLA: 0.4, HOLDING_DIVERSIFICADO: 0.4, MINERACAO: 0.8, CONSTRUCAO_ENGENHARIA: 0.6, FARMACEUTICA: 0.7, SERVICOS_CONSULTORIA: 0.1, ASSOCIACAO_ENTIDADE: 0 }, 0.2) },
  BALANCEADO: { nome: 'BALANCEADO', pesos: { geografia: 15, setor: 35, funcionarios: 25, receita: 20, porteIndustrial: 5 }, geografia: { principal: ['GO'], fatorPrincipal: 1, alvo: UFS_ALVO, fatorAlvo: 0.85 },
    afinidade: AF({ ALIMENTOS_BEBIDAS: 1, BIOENERGIA_USINAS: 1, INDUSTRIA: 1, QUIMICA_FERTILIZANTES: 1, LOGISTICA_DISTRIBUICAO: 0.9, COOPERATIVA: 0.9, SEMENTES: 0.85, DISTRIBUICAO_INSUMOS_AGRO: 0.8, VAREJO_ATACADO: 0.7, MAQUINAS_EQUIPAMENTOS: 0.6, PRODUCAO_AGRICOLA: 0.6, HOLDING_DIVERSIFICADO: 0.5, MINERACAO: 0.9, CONSTRUCAO_ENGENHARIA: 0.7, FARMACEUTICA: 0.8, SERVICOS_CONSULTORIA: 0.2, ASSOCIACAO_ENTIDADE: 0.1 }, 0.3) },
  AGRESSIVO: { nome: 'AGRESSIVO', pesos: { geografia: 10, setor: 30, funcionarios: 30, receita: 25, porteIndustrial: 5 }, geografia: { principal: ['GO'], fatorPrincipal: 1, alvo: UFS_ALVO, fatorAlvo: 1 },
    afinidade: AF({ ALIMENTOS_BEBIDAS: 1, BIOENERGIA_USINAS: 1, INDUSTRIA: 1, QUIMICA_FERTILIZANTES: 1, LOGISTICA_DISTRIBUICAO: 1, COOPERATIVA: 1, SEMENTES: 1, DISTRIBUICAO_INSUMOS_AGRO: 0.9, VAREJO_ATACADO: 0.8, MAQUINAS_EQUIPAMENTOS: 0.8, PRODUCAO_AGRICOLA: 0.8, HOLDING_DIVERSIFICADO: 0.6, MINERACAO: 1, CONSTRUCAO_ENGENHARIA: 0.8, FARMACEUTICA: 0.9, SERVICOS_CONSULTORIA: 0.3, ASSOCIACAO_ENTIDADE: 0.2 }, 0.4) },
};
/** Fator por faixa de funcionarios (limite superior) e por receita (milhoes). Ausente = 0. */
export const fatorFuncionarios = (n?: number) => (n === undefined ? 0 : n <= 10 ? 0 : n <= 50 ? 0.2 : n <= 200 ? 0.5 : n <= 500 ? 0.7 : n <= 1000 ? 0.85 : 1);
export const fatorReceita = (m?: number) => (m === undefined ? 0 : m <= 10 ? 0.2 : m <= 25 ? 0.4 : m <= 75 ? 0.6 : m <= 200 ? 0.8 : m <= 500 ? 0.95 : 1);

export interface FatorFit { componente: 'geografia' | 'setor' | 'funcionarios' | 'receita' | 'porteIndustrial'; peso: number; fator: number; pontos: number; motivo: string }
export interface ResultadoFit { score: number; categoria: CategoriaSetor; classificacao: ClassificacaoSetor; fatores: FatorFit[]; ausentes: string[] }

/** FIT calibrado (0-100) so com dados presentes. `extra` traz NAICS/SIC/descricao do registro bruto quando houver. */
export function fitCalibrado(e: Pick<Empresa, 'razaoSocial' | 'nomeFantasia' | 'uf' | 'setor' | 'faixaFuncionarios' | 'faixaReceita'>, cenario: CenarioFit, extra: Partial<EntradaSetor> = {}): ResultadoFit {
  const cls = classificarSetor({ nome: e.nomeFantasia ?? e.razaoSocial, setor: e.setor, ...extra });
  const fatores: FatorFit[] = []; const ausentes: string[] = [];
  const add = (componente: FatorFit['componente'], fator: number, motivo: string) => { const peso = cenario.pesos[componente]; fatores.push({ componente, peso, fator, pontos: Math.round(peso * fator * 10) / 10, motivo }); };
  if (!e.uf) { ausentes.push('uf'); add('geografia', 0, 'UF ausente'); }
  else if (cenario.geografia.principal.includes(e.uf)) add('geografia', cenario.geografia.fatorPrincipal, `UF ${e.uf}: base da EIFF`);
  else if (cenario.geografia.alvo.includes(e.uf)) add('geografia', cenario.geografia.fatorAlvo, `UF ${e.uf}: área de atuação`);
  else add('geografia', 0, `UF ${e.uf} fora da área de atuação`);
  const af = cenario.afinidade[cls.categoria];
  add('setor', af, `${cls.categoria} (${cls.motivo})`);
  const nf = funcionariosDe(e.faixaFuncionarios);
  if (nf === undefined) { ausentes.push('faixaFuncionarios'); add('funcionarios', 0, 'faixa de funcionários ausente'); } else add('funcionarios', fatorFuncionarios(nf), `faixa ${faixaSemColchetes(e.faixaFuncionarios)}`);
  const rm = receitaMilhoesDe(e.faixaReceita);
  if (rm === undefined) { ausentes.push('faixaReceita'); add('receita', 0, 'faixa de receita ausente'); } else add('receita', fatorReceita(rm), `faixa ${faixaSemColchetes(e.faixaReceita)}`);
  const porte = nf !== undefined && af >= 0.8 ? (nf > 500 ? 1 : nf > 200 ? 0.5 : 0) : 0;
  add('porteIndustrial', porte, porte ? `≥ ${nf! > 500 ? 501 : 201} funcionários em setor físico-intensivo` : nf === undefined ? 'sem faixa de funcionários' : 'porte ou setor não caracterizam operação física de grande escala');
  const score = Math.max(0, Math.min(100, Math.round(fatores.reduce((s, f) => s + f.pontos, 0) * 10) / 10));
  return { score, categoria: cls.categoria, classificacao: cls, fatores, ausentes };
}

/** Estatisticas simples para os relatorios. */
export function distribuicao(valores: number[]): { n: number; min: number; max: number; media: number; mediana: number; p25: number; p75: number; faixas: Record<string, number> } {
  const s = [...valores].sort((a, b) => a - b); const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : 0);
  const faixas: Record<string, number> = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
  for (const v of s) faixas[v < 20 ? '0-19' : v < 40 ? '20-39' : v < 60 ? '40-59' : v < 80 ? '60-79' : '80-100']++;
  return { n: s.length, min: s[0] ?? 0, max: s[s.length - 1] ?? 0, media: s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 0, mediana: q(0.5), p25: q(0.25), p75: q(0.75), faixas };
}
