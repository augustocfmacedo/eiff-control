// CD-D3/E5 — definir/revisar/retirar a meta comercial com CONFIRMAÇÃO do banco antes de dizer "salvo".
//
// A regra é toda da ação canônica `actions.definirMetaComercialRadar` (E2: papel, mês corrente/futuro, valor, motivo,
// versão nova) e, no banco, da RPC radar_definir_meta_comercial chamada pela sincronização. Este orquestrador só:
//   1. recusa começar com alterações ainda não sincronizadas (para que uma falha descarte SÓ esta meta);
//   2. chama a ação canônica;
//   3. no modo remoto, espera a sincronização terminar e, com sucesso, RECARREGA do banco e devolve a versão persistida
//      (número do banco), conferindo valor e motivo; com recusa do banco, recarrega (a versão local some) e devolve erro;
//      sem rede, devolve "pendente" — guardada no aparelho, ainda NÃO confirmada.
// Nunca devolve sucesso sem a versão ter voltado do banco. Portas injetadas para o teste.
import { lerValor, type VersaoMetaComercial } from '../core/radar/metaComercial';

export type ResultadoMetaConfirmada =
  | { ok: true; versao: VersaoMetaComercial; mudou: boolean }
  | { ok: false; estado: 'recusada' | 'nao_confirmada' | 'pendente'; mensagem: string };

export interface SyncMeta { status: 'ok' | 'enviando' | 'erro' | 'local' | 'pendente'; msg?: string }

export interface PortasMetaConfirmada {
  remoto: boolean;
  syncAtual(): SyncMeta;
  /** a ação canônica (lança RegraDeNegocioError na recusa) */
  definir(): VersaoMetaComercial;
  /** espera a fila de sincronização esvaziar e devolve o status final */
  aguardarSincronizacao(): Promise<SyncMeta>;
  recarregar(): Promise<void>;
  /** versões do mês como estão no estado atual do app */
  versoesDoMes(): VersaoMetaComercial[];
}

const mesmoValor = (a: VersaoMetaComercial['valor'], b: VersaoMetaComercial['valor']) => {
  const la = lerValor(a); const lb = lerValor(b);
  return la.estado === lb.estado && (la.estado !== 'VALIDO' || (lb.estado === 'VALIDO' && la.centavos === lb.centavos));
};
const ultimaVersao = (vs: VersaoMetaComercial[]) => vs.reduce<VersaoMetaComercial | undefined>((u, v) => (!u || v.versao > u.versao ? v : u), undefined);

export async function definirMetaConfirmada(p: PortasMetaConfirmada): Promise<ResultadoMetaConfirmada> {
  if (p.remoto) {
    const s0 = p.syncAtual().status === 'enviando' ? await p.aguardarSincronizacao() : p.syncAtual();
    if (s0.status === 'erro' || s0.status === 'pendente')
      return { ok: false, estado: 'recusada', mensagem: 'Há alterações ainda não confirmadas no banco. Resolva a sincronização antes de mudar a meta.' };
  }
  const antes = p.versoesDoMes().length;
  let local: VersaoMetaComercial;
  try { local = p.definir(); } catch (e) { return { ok: false, estado: 'recusada', mensagem: (e as Error).message }; }
  const mudou = p.versoesDoMes().length > antes;
  if (!p.remoto || !mudou) return { ok: true, versao: local, mudou };

  const s = await p.aguardarSincronizacao();
  if (s.status === 'pendente') return { ok: false, estado: 'pendente', mensagem: 'Sem conexão: a meta ficou guardada neste aparelho e ainda NÃO foi confirmada no banco.' };
  if (s.status !== 'ok') {
    // o banco recusou: volta ao que está gravado (só esta meta estava pendente, garantido no passo 1)
    try { await p.recarregar(); } catch { /* a mensagem abaixo já diz que nada foi confirmado */ }
    return { ok: false, estado: 'nao_confirmada', mensagem: `O banco não confirmou a meta; nada foi gravado.${s.msg ? ` ${s.msg}` : ''}` };
  }
  try { await p.recarregar(); } catch (e) { return { ok: false, estado: 'nao_confirmada', mensagem: `A meta foi enviada, mas não deu para reler o banco: ${(e as Error).message}` }; }
  const persistida = ultimaVersao(p.versoesDoMes());
  if (!persistida || !mesmoValor(persistida.valor, local.valor) || persistida.motivo.trim() !== local.motivo.trim())
    return { ok: false, estado: 'nao_confirmada', mensagem: 'O banco não devolveu a versão gravada. Recarregue a tela antes de tentar de novo.' };
  return { ok: true, versao: persistida, mudou: true };
}
