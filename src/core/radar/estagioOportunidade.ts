// CD-D3 / E0 — transição canônica de estágio da oportunidade (docs/commercial-director-1.0.md §19.6).
//
// Uma única definição do que acontece quando a oportunidade muda de estágio: quem valida (`motivosRecusaTransicao`) e
// o que muda (`aplicarTransicao`). O store (`mudarEstagioRadar` e a criação em `salvarOportunidadeRadar`) só chama
// estas funções; a edição comum (`salvarOportunidadeRadar` sem mudar estágio) nunca grava estágio, data de fechamento
// nem motivo de fechamento, e em oportunidade ganha não altera valor, empresa, responsável nem a data de fechamento.
// Base do realizado comercial da CD-D3: o instante do ganho (`fechadoEm`) e o valor fechado não podem mudar por fora.
// CD-D3/E3: o valor fechado CONFIRMADO é `valorFechado`, informado só ao marcar WON (vazio = ganho sem valor,
// sinalizado); o valor estimado nunca vira valor de venda. O banco (0070) grava o GANHO/ESTORNO no livro de desfechos.
import { ESTAGIOS, ESTAGIOS_FECHADOS, type Estagio, type Oportunidade } from './types';
import { PROBABILIDADE_ESTAGIO } from './padroes';
import { VALOR_MAXIMO_META, ateDuasCasas, lerValor } from './metaComercial';

export interface DadosTransicao {
  motivo?: string;
  proximaAcao?: string;
  proximaAcaoEm?: string;
  valorEstimado?: number;
  /** CD-D3/E3: valor fechado confirmado, só ao marcar WON; ausente = ganho sem valor (sinalizado e complementável) */
  valorFechado?: number;
}

const fechado = (e: Estagio) => ESTAGIOS_FECHADOS.includes(e);

/** Campos que, numa oportunidade GANHA, só mudam reabrindo-a com motivo. */
export const CAMPOS_TRAVADOS_GANHO = ['valorEstimado', 'valorFechado', 'empresaId', 'responsavelId', 'fechadoEm'] as const;
const ROTULO_CAMPO: Record<(typeof CAMPOS_TRAVADOS_GANHO)[number], string> = {
  valorEstimado: 'o valor', valorFechado: 'o valor fechado', empresaId: 'a empresa', responsavelId: 'o responsável', fechadoEm: 'a data de fechamento',
};

/**
 * Motivos para recusar a transição de `atual` (ausente = criação) para `para`; lista vazia = pode.
 * WON → WON não é transição nova; fechar (ganho ou perda) e reabrir um ganho exigem motivo.
 */
export function motivosRecusaTransicao(atual: (Pick<Oportunidade, 'estagio'> & Partial<Pick<Oportunidade, 'motivoEstagio'>>) | undefined, para: Estagio, dados: DadosTransicao = {}): string[] {
  if (!ESTAGIOS.includes(para)) return ['Estágio inválido.'];
  if (atual && atual.estagio === para) {
    return [para === 'WON' ? 'A oportunidade já está ganha: marcar como ganha de novo não é uma nova transição.' : 'A oportunidade já está nesse estágio.'];
  }
  const motivo = dados.motivo?.trim();
  if (fechado(para) && !motivo) return [`Informe o motivo para marcar como ${para === 'WON' ? 'ganha' : 'perdida'}.`];
  if (atual?.estagio === 'WON' && !motivo) return ['Informe o motivo para reabrir uma oportunidade ganha.'];
  // CD-D3/E3: entrar ou sair de WON vira evento do livro de desfechos; o banco (0070) exige um motivo NOVO de 3 a 500
  if (para === 'WON' || atual?.estagio === 'WON') {
    if ((motivo ?? '').length < 3 || (motivo ?? '').length > 500) return ['O motivo precisa ter de 3 a 500 caracteres.'];
    if (atual?.motivoEstagio?.trim() === motivo) return ['Informe o motivo desta mudança de estágio: ele é igual ao da mudança anterior.'];
  }
  if (dados.valorFechado !== undefined) {
    if (para !== 'WON') return ['O valor fechado só é informado ao marcar como ganha.'];
    const l = lerValor(dados.valorFechado);
    if (l.estado !== 'VALIDO' || l.centavos <= 0 || !ateDuasCasas(dados.valorFechado)) return ['Valor fechado: informe um valor positivo em reais, com no máximo 2 casas (ou deixe vazio para registrar o ganho sem valor).'];
    if (l.centavos > VALOR_MAXIMO_META * 100) return ['Valor fechado acima do máximo (R$ 1.000.000.000.000,00).'];
  }
  return [];
}

/**
 * Aplica a transição (já validada). Fechar grava o instante e o motivo e encerra a próxima ação; reabrir limpa o
 * instante de fechamento. O valor estimado informado na transição prevalece; o valor FECHADO só existe no destino WON
 * (`dados.valorFechado`, vazio = ganho sem valor) e some ao sair de WON (a história fica no livro de desfechos).
 */
export function aplicarTransicao(atual: Oportunidade, para: Estagio, dados: DadosTransicao, agora: string): Oportunidade {
  const fecha = fechado(para);
  return {
    ...atual,
    estagio: para,
    probabilidade: PROBABILIDADE_ESTAGIO[para],
    valorEstimado: dados.valorEstimado ?? atual.valorEstimado,
    valorFechado: para === 'WON' ? dados.valorFechado : undefined,
    motivoEstagio: dados.motivo?.trim() || undefined,
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
 * A edição comum nunca grava o que é da transição: estágio, instante, motivo de fechamento e valor fechado vêm do registro atual
 * (ou, na mudança de estágio, de `aplicarTransicao`). `id` e criação também não vêm do formulário.
 */
export function camposEditaveis(atual: Oportunidade, edicao: Oportunidade): Oportunidade {
  return { ...edicao, id: atual.id, criadoEm: atual.criadoEm, estagio: atual.estagio, fechadoEm: atual.fechadoEm, motivoFechamento: atual.motivoFechamento, valorFechado: atual.valorFechado, motivoEstagio: atual.motivoEstagio };
}
