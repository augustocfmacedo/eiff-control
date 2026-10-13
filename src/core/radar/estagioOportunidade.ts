// CD-D3 / E0 — transição canônica de estágio da oportunidade (docs/commercial-director-1.0.md §19.6).
//
// Uma única definição do que acontece quando a oportunidade muda de estágio: quem valida (`motivosRecusaTransicao`) e
// o que muda (`aplicarTransicao`). O store (`mudarEstagioRadar` e a criação em `salvarOportunidadeRadar`) só chama
// estas funções; a edição comum (`salvarOportunidadeRadar` sem mudar estágio) nunca grava estágio, data de fechamento
// nem motivo de fechamento, e em oportunidade ganha não altera valor, empresa, responsável nem a data de fechamento.
// Base do realizado comercial da CD-D3: o instante do ganho (`fechadoEm`) e o valor fechado não podem mudar por fora.
import { ESTAGIOS, ESTAGIOS_FECHADOS, type Estagio, type Oportunidade } from './types';
import { PROBABILIDADE_ESTAGIO } from './padroes';

export interface DadosTransicao {
  motivo?: string;
  proximaAcao?: string;
  proximaAcaoEm?: string;
  valorEstimado?: number;
}

const fechado = (e: Estagio) => ESTAGIOS_FECHADOS.includes(e);

/** Campos que, numa oportunidade GANHA, só mudam reabrindo-a com motivo. */
export const CAMPOS_TRAVADOS_GANHO = ['valorEstimado', 'empresaId', 'responsavelId', 'fechadoEm'] as const;
const ROTULO_CAMPO: Record<(typeof CAMPOS_TRAVADOS_GANHO)[number], string> = {
  valorEstimado: 'o valor', empresaId: 'a empresa', responsavelId: 'o responsável', fechadoEm: 'a data de fechamento',
};

/**
 * Motivos para recusar a transição de `atual` (ausente = criação) para `para`; lista vazia = pode.
 * WON → WON não é transição nova; fechar (ganho ou perda) e reabrir um ganho exigem motivo.
 */
export function motivosRecusaTransicao(atual: Pick<Oportunidade, 'estagio'> | undefined, para: Estagio, dados: DadosTransicao = {}): string[] {
  if (!ESTAGIOS.includes(para)) return ['Estágio inválido.'];
  if (atual && atual.estagio === para) {
    return [para === 'WON' ? 'A oportunidade já está ganha: marcar como ganha de novo não é uma nova transição.' : 'A oportunidade já está nesse estágio.'];
  }
  const motivo = dados.motivo?.trim();
  if (fechado(para) && !motivo) return [`Informe o motivo para marcar como ${para === 'WON' ? 'ganha' : 'perdida'}.`];
  if (atual?.estagio === 'WON' && !motivo) return ['Informe o motivo para reabrir uma oportunidade ganha.'];
  return [];
}

/**
 * Aplica a transição (já validada). Fechar grava o instante e o motivo e encerra a próxima ação; reabrir limpa o
 * instante de fechamento. O valor informado na transição prevalece (é o valor fechado, quando o destino é WON).
 */
export function aplicarTransicao(atual: Oportunidade, para: Estagio, dados: DadosTransicao, agora: string): Oportunidade {
  const fecha = fechado(para);
  return {
    ...atual,
    estagio: para,
    probabilidade: PROBABILIDADE_ESTAGIO[para],
    valorEstimado: dados.valorEstimado ?? atual.valorEstimado,
    proximaAcao: fecha ? undefined : dados.proximaAcao ?? atual.proximaAcao,
    proximaAcaoEm: fecha ? undefined : dados.proximaAcaoEm ?? atual.proximaAcaoEm,
    motivoFechamento: fecha ? dados.motivo?.trim() : atual.motivoFechamento,
    fechadoEm: fecha ? agora : undefined,
    atualizadoEm: agora,
  };
}

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Motivos para recusar uma edição SEM mudança de estágio; lista vazia = pode. Oportunidade ganha não muda valor,
 * empresa, responsável nem data de fechamento (corrigir = reabrir com motivo); oportunidade fechada não tem próxima ação.
 */
export function motivosRecusaEdicao(atual: Oportunidade, novo: Pick<Oportunidade, (typeof CAMPOS_TRAVADOS_GANHO)[number] | 'proximaAcao' | 'proximaAcaoEm'>): string[] {
  const motivos: string[] = [];
  if (atual.estagio === 'WON') {
    for (const c of CAMPOS_TRAVADOS_GANHO) {
      if (!igual(atual[c], novo[c])) motivos.push(`Oportunidade ganha: ${ROTULO_CAMPO[c]} não pode ser alterad${c === 'fechadoEm' ? 'a' : 'o'} — reabra a oportunidade com motivo para corrigir.`);
    }
  }
  if (fechado(atual.estagio) && (novo.proximaAcao?.trim() || novo.proximaAcaoEm)) motivos.push('Oportunidade fechada não tem próxima ação.');
  return motivos;
}

/**
 * A edição comum nunca grava o que é da transição: estágio, instante e motivo de fechamento vêm do registro atual
 * (ou, na mudança de estágio, de `aplicarTransicao`). `id` e criação também não vêm do formulário.
 */
export function camposEditaveis(atual: Oportunidade, edicao: Oportunidade): Oportunidade {
  return { ...edicao, id: atual.id, criadoEm: atual.criadoEm, estagio: atual.estagio, fechadoEm: atual.fechadoEm, motivoFechamento: atual.motivoFechamento };
}
