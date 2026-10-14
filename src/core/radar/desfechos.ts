// CD-D3/E3 — livro imutável de desfechos no app (docs/commercial-director-1.0.md §19.9).
//
// No banco (migration 0070) quem escreve o livro é o próprio PostgreSQL: o gatilho de radar_opportunity grava GANHO ao
// entrar em WON e ESTORNO_GANHO ao sair, na mesma transação da mudança de estágio; o COMPLEMENTO_VALOR só nasce pela
// RPC radar_complementar_valor_ganho. No modo REMOTO o app só LÊ o livro (carga) e pede o complemento; nunca fabrica
// ganho nem estorno. Este módulo é o ESPELHO das mesmas regras para o modo local (demonstração, testes) e a validação de
// UX do complemento antes de chamar a RPC — mudou a regra, muda aqui, na 0070 e nos testes (desfechos.test.ts e
// scripts/pg-smoke-desfechos.mjs). O formato é exatamente o `EventoDesfecho` que o motor E1 (metaComercial.ts) lê.
import type { Oportunidade } from './types';
import { MOTIVO_META_MAX, MOTIVO_META_MIN, VALOR_MAXIMO_META, ateDuasCasas, centavosDoGanho, instanteEmMs, lerLivroDesfechos, lerValor, type EventoDesfecho } from './metaComercial';

const ordenados = (livro: readonly EventoDesfecho[]) => [...livro].sort((a, b) => (instanteEmMs(a.ocorridoEm) ?? 0) - (instanteEmMs(b.ocorridoEm) ?? 0));

/** O ganho vigente (não estornado) da oportunidade, o mais recente — o mesmo critério do gatilho. */
export function ganhoVigente(livro: readonly EventoDesfecho[], oportunidadeId: string): EventoDesfecho | undefined {
  const estornados = new Set(livro.filter((e) => e.tipo === 'ESTORNO_GANHO' && e.oportunidadeId === oportunidadeId).map((e) => e.ganhoId));
  return ordenados(livro).filter((e) => e.tipo === 'GANHO' && e.oportunidadeId === oportunidadeId && !estornados.has(e.id)).pop();
}

/** Instante estritamente depois do último evento da oportunidade (o banco usa clock_timestamp, que nunca empata). */
function instanteDepois(livro: readonly EventoDesfecho[], oportunidadeId: string, agora: string): string {
  const ultimo = Math.max(-Infinity, ...livro.filter((e) => e.oportunidadeId === oportunidadeId).map((e) => instanteEmMs(e.ocorridoEm) ?? -Infinity));
  const ms = instanteEmMs(agora);
  if (ms === undefined) throw new Error('instante inválido para o desfecho');
  return ms > ultimo ? agora : new Date(ultimo + 1).toISOString();
}

export interface ContextoDesfecho { agora: string; atorId: string; donoContaId?: string; novoId: () => string }

/**
 * Espelho do gatilho radar_opportunity_desfecho: criação já ganha ou entrada em WON = GANHO (valor fechado confirmado
 * quando houver; nunca o estimado); saída de WON = ESTORNO do ganho vigente (sem ganho no livro — ganho anterior ao
 * livro — não fabrica estorno). WON → WON e qualquer transição entre estágios abertos não gravam nada.
 */
export function eventosDaTransicao(antes: Pick<Oportunidade, 'estagio'> | undefined, depois: Oportunidade, livro: readonly EventoDesfecho[], ctx: ContextoDesfecho): EventoDesfecho[] {
  if (antes && antes.estagio === depois.estagio) return [];
  const novos: EventoDesfecho[] = [];
  if (antes?.estagio === 'WON') {
    const g = ganhoVigente(livro, depois.id);
    if (g) {
      novos.push({ id: ctx.novoId(), tipo: 'ESTORNO_GANHO', oportunidadeId: depois.id, empresaId: g.empresaId, ocorridoEm: instanteDepois(livro, depois.id, ctx.agora), ganhoId: g.id,
        ...(g.responsavelId ? { responsavelId: g.responsavelId } : {}), ...(g.donoContaId ? { donoContaId: g.donoContaId } : {}),
        ...(depois.motivoEstagio ? { motivo: depois.motivoEstagio } : {}), registradoPor: ctx.atorId });
    }
  }
  if (depois.estagio === 'WON') {
    const todos = [...livro, ...novos];
    if (ganhoVigente(todos, depois.id)) throw new Error('A oportunidade já tem um ganho vigente: reabra antes de ganhar de novo.');
    novos.push({ id: ctx.novoId(), tipo: 'GANHO', oportunidadeId: depois.id, empresaId: depois.empresaId, ocorridoEm: instanteDepois(todos, depois.id, ctx.agora),
      ...(depois.valorFechado !== undefined ? { valor: depois.valorFechado } : {}),
      ...(depois.responsavelId ? { responsavelId: depois.responsavelId } : {}), ...(ctx.donoContaId ? { donoContaId: ctx.donoContaId } : {}),
      ...(depois.motivoEstagio ? { motivo: depois.motivoEstagio } : {}), registradoPor: ctx.atorId });
  }
  return novos;
}

/** Motivos para recusar o complemento de valor (as mesmas regras da RPC radar_complementar_valor_ganho); vazio = pode. */
export function motivosRecusaComplemento(livro: readonly EventoDesfecho[], ganhoId: string, valor: number | undefined, motivo: string | undefined): string[] {
  const g = livro.find((e) => e.id === ganhoId && e.tipo === 'GANHO');
  if (!g) return ['Ganho não encontrado no livro de desfechos.'];
  const motivos: string[] = [];
  if (lerValor(g.valor).estado === 'VALIDO') motivos.push('O ganho já tem valor confirmado.');
  if (livro.some((e) => e.tipo === 'COMPLEMENTO_VALOR' && e.ganhoId === ganhoId)) motivos.push('O ganho já foi complementado.');
  const l = lerValor(valor);
  if (l.estado !== 'VALIDO' || l.centavos <= 0 || !ateDuasCasas(valor)) motivos.push('Informe um valor positivo em reais, com no máximo 2 casas.');
  else if (l.centavos > VALOR_MAXIMO_META * 100) motivos.push('Valor acima do máximo (R$ 1.000.000.000.000,00).');
  const m = motivo?.trim() ?? '';
  if (m.length < MOTIVO_META_MIN || m.length > MOTIVO_META_MAX) motivos.push(`Informe o motivo (${MOTIVO_META_MIN} a ${MOTIVO_META_MAX} caracteres).`);
  return motivos;
}

/** O COMPLEMENTO_VALOR (já validado) que completa o ganho; herda empresa, responsável e dono do ganho. */
export function complementoDoGanho(livro: readonly EventoDesfecho[], ganhoId: string, valor: number, motivo: string, ctx: Omit<ContextoDesfecho, 'donoContaId'>): EventoDesfecho {
  const g = livro.find((e) => e.id === ganhoId && e.tipo === 'GANHO');
  if (!g) throw new Error('Ganho não encontrado no livro de desfechos.');
  return { id: ctx.novoId(), tipo: 'COMPLEMENTO_VALOR', oportunidadeId: g.oportunidadeId, empresaId: g.empresaId, ocorridoEm: instanteDepois(livro, g.oportunidadeId, ctx.agora), valor, ganhoId: g.id,
    ...(g.responsavelId ? { responsavelId: g.responsavelId } : {}), ...(g.donoContaId ? { donoContaId: g.donoContaId } : {}), motivo: motivo.trim(), registradoPor: ctx.atorId };
}

export interface GanhoDaOportunidade { ganhoId: string; ocorridoEm: string; valor?: number; semValor: boolean; complementoId?: string; estornoId?: string; vigente: boolean }

/** Os ganhos de uma oportunidade lidos pelo MESMO motor da meta (E1): valor efetivo, sem valor, complementado, estornado. */
export function ganhosDaOportunidade(livro: readonly EventoDesfecho[], oportunidadeId: string): GanhoDaOportunidade[] {
  const { ganhos } = lerLivroDesfechos(livro.filter((e) => e.oportunidadeId === oportunidadeId));
  return ganhos.map((g) => {
    const centavos = centavosDoGanho(g);
    return { ganhoId: g.id, ocorridoEm: g.ocorridoEm, ...(centavos !== undefined ? { valor: centavos / 100 } : {}), semValor: centavos === undefined, ...(g.complemento ? { complementoId: g.complemento.id } : {}), ...(g.estornadoPor ? { estornoId: g.estornadoPor } : {}), vigente: !g.estornadoPor };
  });
}
