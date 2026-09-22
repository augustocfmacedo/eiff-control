// Commercial UX 1.0 — UX-5: projecao PURA da zona ENTRADA do Panorama.
//
// A zona responde tres perguntas DIFERENTES, e a separacao entre elas e o contrato mais importante deste modulo:
//   1. SINAL NOVO             — o que acabou de entrar no Radar (informacao nova sobre uma conta que ja existe);
//   2. CONTA ADICIONADA       — que conta passou a existir NO RADAR ha pouco tempo (nao "empresa nova no mercado");
//   3. ENRIQUECIMENTO         — o que ja existe mas esta sem o dado necessario para abordar.
//
// Regra conceitual: SEM DECISOR != NOVO LEAD e SEM CANAL != NOVO LEAD. Falta de dado e ENRIQUECIMENTO, nunca
// entrada nova. Nenhum texto deste modulo (ou da zona) chama isso de lead.
//
// Nada aqui decide negocio: sem score, sem ranking, sem prioridade, sem categoria nova, sem fila nova. A janela de
// 7 dias e recorte de APRESENTACAO — nao e SLA, nao e urgencia e nao muda a ordem do CM1-A.
//
// Autoridades respeitadas:
//   - recencia do sinal  = `Sinal.detectadoEm` (quando o Radar soube), NUNCA `eventoEm` (quando aconteceu);
//   - recencia da conta  = `Empresa.criadoEm` (quando entrou no Radar), NUNCA `atualizadoEm`;
//   - enriquecimento     = razoes que a Commercial Queue ja produziu (`porQueAgora` + `secundarias`), nunca uma
//     inspecao propria de contatos ou canais.
//
// Contrato de design: docs/commercial-ux-1.0-decisao.md.
import { TEXTO_RAZAO_CM, type CodigoRazaoCM, type CommercialQueueItem } from '../../core/radar/commercialMachine';
import { diasEntre } from '../../core/radar/score';
import type { Empresa, Sinal, TipoSinal } from '../../core/radar/types';

/** Recorte visual da zona: o que entrou nos ultimos 7 dias. Nao e prioridade nem SLA. */
export const JANELA_ENTRADA_UX_DIAS = 7;

/** Razoes de enriquecimento, exatamente como a Commercial Queue as nomeia. Nenhum diagnostico novo. */
export const RAZOES_SEM_DECISOR_UX: readonly CodigoRazaoCM[] = ['SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL'];
export const RAZOES_SEM_CANAL_UX: readonly CodigoRazaoCM[] = ['SEM_CANAL_VALIDO'];
export const RAZOES_ENRIQUECIMENTO_UX: readonly CodigoRazaoCM[] = [...RAZOES_SEM_DECISOR_UX, ...RAZOES_SEM_CANAL_UX];

export interface SinalEntradaUX {
  sinalId: string;
  empresaId: string;
  titulo: string;
  tipo: TipoSinal;
  /** Quando o Radar soube. O texto fala de deteccao, nunca de "aconteceu hoje". */
  detectadoEm: string;
  dias: number;
  verificado: boolean;
}

export interface ContaEntradaUX {
  empresaId: string;
  /** Quando a conta foi adicionada AO RADAR. Nao diz nada sobre a idade da empresa. */
  criadoEm: string;
  dias: number;
  cidade?: string;
  uf?: string;
}

export interface EnriquecimentoEntradaUX {
  itemId: string;
  empresaId: string;
  /** Codigos da propria fila; o texto sai de `TEXTO_RAZAO_CM`. */
  codigos: CodigoRazaoCM[];
  semDecisor: boolean;
  semCanal: boolean;
}

export interface EntradaComercialUX {
  janelaDias: number;
  sinais: { total: number; destaque?: SinalEntradaUX };
  contas: { total: number; destaque?: ContaEntradaUX };
  enriquecimento: { total: number; semDecisor: number; semCanal: number; destaque?: EnriquecimentoEntradaUX };
}

/** Entrada do projetor: as linhas da `base` (ordem CM1-A) e os fatos brutos necessarios. */
export interface FatosEntradaUX {
  /** Item da fila + identidade da linha, na ordem da `base`. */
  linhas: readonly { itemId: string; item: CommercialQueueItem }[];
  empresas: readonly Empresa[];
  sinais: readonly Sinal[];
  /** Data-base do sistema (`ds.params.dataBase`), nunca o relogio. */
  hoje: string;
}

const dia = (v: string) => v.slice(0, 10);

/**
 * Dentro da janela: `0 <= dias <= 7`. Data no futuro nao e "novidade" — `diasEntre` satura em 0, entao a
 * comparacao textual descarta explicitamente o que ainda nao aconteceu.
 */
export function dentroDaJanelaUX(data: string, hoje: string, janela = JANELA_ENTRADA_UX_DIAS): boolean {
  const d = dia(data);
  const h = dia(hoje);
  if (d > h) return false; // futuro nunca conta como entrada
  return diasEntre(d, h) <= janela;
}

/** Texto da razao, direto do catalogo da fila. A zona nunca escreve diagnostico proprio. */
export const textoDaRazaoEntradaUX = (codigo: CodigoRazaoCM): string => TEXTO_RAZAO_CM[codigo];

/** Razoes de enriquecimento presentes no item: a principal e as secundarias contam igual. */
export function razoesDeEnriquecimentoUX(item: CommercialQueueItem): CodigoRazaoCM[] {
  const todas = [item.porQueAgora, ...item.secundarias].map((r) => r.codigo);
  const vistas = new Set<CodigoRazaoCM>();
  const saida: CodigoRazaoCM[] = [];
  for (const c of todas) {
    if (!RAZOES_ENRIQUECIMENTO_UX.includes(c) || vistas.has(c)) continue;
    vistas.add(c);
    saida.push(c);
  }
  return saida;
}

/**
 * Projeta a zona. Cada conceito e contado e destacado SEPARADAMENTE — uma mesma empresa pode aparecer nos tres,
 * porque sao fatos diferentes, e um conceito vazio NUNCA e preenchido com item de outro.
 */
export function entradaComercialUX(fatos: FatosEntradaUX): EntradaComercialUX {
  const hoje = dia(fatos.hoje);
  const empresasDaBase = new Set(fatos.linhas.map((l) => l.item.empresaId));

  // 1) SINAL NOVO — recencia por `detectadoEm`; acionavel/verificado NAO filtram (a zona mostra entrada de
  // informacao, nao decide abordagem). Destaque = o detectado mais recentemente (cronologia, nao prioridade).
  let sinaisTotal = 0;
  let destaqueSinal: SinalEntradaUX | undefined;
  for (const s of fatos.sinais) {
    if (!empresasDaBase.has(s.empresaId)) continue;
    if (!dentroDaJanelaUX(s.detectadoEm, hoje)) continue;
    sinaisTotal++;
    if (!destaqueSinal || dia(s.detectadoEm) > destaqueSinal.detectadoEm) {
      destaqueSinal = {
        sinalId: s.id, empresaId: s.empresaId, titulo: s.titulo, tipo: s.tipo,
        detectadoEm: dia(s.detectadoEm), dias: diasEntre(dia(s.detectadoEm), hoje), verificado: s.verificado,
      };
    }
  }

  // 2) CONTA ADICIONADA AO RADAR — `criadoEm` e a unica autoridade; `atualizadoEm` nao participa.
  let contasTotal = 0;
  let destaqueConta: ContaEntradaUX | undefined;
  for (const e of fatos.empresas) {
    if (!empresasDaBase.has(e.id)) continue;
    if (!dentroDaJanelaUX(e.criadoEm, hoje)) continue;
    contasTotal++;
    if (!destaqueConta || dia(e.criadoEm) > destaqueConta.criadoEm) {
      destaqueConta = {
        empresaId: e.id, criadoEm: dia(e.criadoEm), dias: diasEntre(dia(e.criadoEm), hoje),
        ...(e.cidade ? { cidade: e.cidade } : {}), ...(e.uf ? { uf: e.uf } : {}),
      };
    }
  }

  // 3) ENRIQUECIMENTO — so razoes que a fila ja produziu. Conta unica por conta; os subcontadores podem sobrepor.
  // Destaque = a PRIMEIRA conta elegivel na ordem da base (CM1-A), sem ordenacao propria.
  let enriquecimentoTotal = 0;
  let semDecisor = 0;
  let semCanal = 0;
  let destaqueEnriquecimento: EnriquecimentoEntradaUX | undefined;
  for (const { itemId, item } of fatos.linhas) {
    const codigos = razoesDeEnriquecimentoUX(item);
    if (!codigos.length) continue;
    const temSemDecisor = codigos.some((c) => RAZOES_SEM_DECISOR_UX.includes(c));
    const temSemCanal = codigos.some((c) => RAZOES_SEM_CANAL_UX.includes(c));
    enriquecimentoTotal++; // a conta com dois problemas conta UMA vez
    if (temSemDecisor) semDecisor++;
    if (temSemCanal) semCanal++;
    if (!destaqueEnriquecimento) destaqueEnriquecimento = { itemId, empresaId: item.empresaId, codigos, semDecisor: temSemDecisor, semCanal: temSemCanal };
  }

  return {
    janelaDias: JANELA_ENTRADA_UX_DIAS,
    sinais: { total: sinaisTotal, ...(destaqueSinal ? { destaque: destaqueSinal } : {}) },
    contas: { total: contasTotal, ...(destaqueConta ? { destaque: destaqueConta } : {}) },
    enriquecimento: { total: enriquecimentoTotal, semDecisor, semCanal, ...(destaqueEnriquecimento ? { destaque: destaqueEnriquecimento } : {}) },
  };
}

/** Quantos destaques a zona vai mostrar: um por conceito, no maximo. Nunca preenche vaga de outro conceito. */
export const destaquesDaEntradaUX = (e: EntradaComercialUX): number => [e.sinais.destaque, e.contas.destaque, e.enriquecimento.destaque].filter(Boolean).length;

/** Zona vazia: nada entrou na janela e nao ha pendencia de enriquecimento nesta visao. */
export const entradaVaziaUX = (e: EntradaComercialUX): boolean => e.sinais.total === 0 && e.contas.total === 0 && e.enriquecimento.total === 0;
