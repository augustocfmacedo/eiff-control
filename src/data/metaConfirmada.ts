// CD-D3/E5 — definir/revisar/retirar a meta comercial com CONFIRMAÇÃO do banco antes de dizer "salvo".
//
// A regra é toda da ação canônica `actions.definirMetaComercialRadar` (E2: papel, mês corrente/futuro, valor, motivo,
// versão nova) e, no banco, da RPC radar_definir_meta_comercial chamada pela sincronização. Este orquestrador só decide o
// que pode ser AFIRMADO à pessoa, e a prova é sempre a LEITURA das versões persistidas do mês — nunca o status genérico da
// fila de sincronização (a fila é global: outra operação pode falhar depois de a meta ter sido gravada, ou a meta pode não
// ter sido enviada mesmo com a fila "ok"):
//   * confirmada   — a versão pedida (valor e motivo) aparece entre as versões persistidas criadas depois do começo;
//   * nao_gravada  — a leitura do banco, depois da sincronização, mostra que a versão NÃO existe (comprovado);
//   * desatualizada — o cache dizia "mesmo valor", mas o banco tem outra meta vigente (outra sessão mudou): nada é
//                     afirmado como confirmado; a tela recarrega e pede revisão;
//   * pendente     — sem rede: guardada no aparelho, ainda não enviada;
//   * indeterminado — não deu para ler o banco: pedir recarga/conferência, nunca "nada foi gravado".
// A recarga completa só acontece com a fila "ok" (não descarta alteração de outra tela que falhou e ainda pode ser
// reenviada). Portas injetadas para o teste.
import { lerValor, type VersaoMetaComercial } from '../core/radar/metaComercial';

export type ResultadoMetaConfirmada =
  | { ok: true; versao: VersaoMetaComercial; mudou: boolean; aviso?: string }
  | { ok: false; estado: 'recusada' | 'nao_gravada' | 'desatualizada' | 'pendente' | 'indeterminado'; mensagem: string };

export interface SyncMeta { status: 'ok' | 'enviando' | 'erro' | 'local' | 'pendente'; msg?: string }

export interface PortasMetaConfirmada {
  remoto: boolean;
  syncAtual(): SyncMeta;
  /** a ação canônica (lança RegraDeNegocioError na recusa) */
  definir(): VersaoMetaComercial;
  /** espera a fila de sincronização esvaziar e devolve o status final (só informativo: não prova nada da meta) */
  aguardarSincronizacao(): Promise<SyncMeta>;
  /** recarga completa do app (só chamada com a fila "ok") */
  recarregar(): Promise<void>;
  /** versões do mês como estão no estado atual do app (cache) */
  versoesDoMes(): VersaoMetaComercial[];
  /** leitura direta das versões PERSISTIDAS do mês no banco (somente leitura; a prova) */
  lerPersistidas(): Promise<VersaoMetaComercial[]>;
}

/**
 * A base sincronizada com uma versão de meta que o banco ACEITOU: daí em diante ela não é "nova" para `persistirMetas`
 * e nunca é reenviada na retomada (Tentar de novo, pendência offline). Só a lista de metas muda; o resto da base continua
 * como estava, e as alterações dos outros módulos seguem pendentes. Pura; devolve a mesma base se a versão já estiver lá.
 */
export function comMetaGravada<T extends { radar: { metasComerciais?: VersaoMetaComercial[] } }>(base: T, m: VersaoMetaComercial): T {
  const metas = base.radar.metasComerciais ?? [];
  if (metas.some((x) => x.id === m.id)) return base;
  return { ...base, radar: { ...base.radar, metasComerciais: [...metas, m] } };
}

const centavos = (v: VersaoMetaComercial['valor']) => { const l = lerValor(v); return l.estado === 'VALIDO' ? l.centavos : l.estado === 'AUSENTE' ? null : NaN; };
const mesmoValor = (a: VersaoMetaComercial['valor'], b: VersaoMetaComercial['valor']) => Object.is(centavos(a), centavos(b));
const ultima = (vs: readonly VersaoMetaComercial[]) => vs.reduce<VersaoMetaComercial | undefined>((u, v) => (!u || v.versao > u.versao ? v : u), undefined);
const rotulo = (v?: VersaoMetaComercial) => (!v ? 'nenhuma meta' : centavos(v.valor) === null ? `meta retirada (versão ${v.versao})` : `R$ ${(centavos(v.valor) as number / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (versão ${v.versao})`);
const erro = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];

export async function definirMetaConfirmada(p: PortasMetaConfirmada): Promise<ResultadoMetaConfirmada> {
  let base: VersaoMetaComercial[] = [];
  if (p.remoto) {
    const s0 = p.syncAtual().status === 'enviando' ? await p.aguardarSincronizacao() : p.syncAtual();
    if (s0.status === 'erro' || s0.status === 'pendente')
      return { ok: false, estado: 'recusada', mensagem: 'Há alterações ainda não confirmadas no banco. Resolva a sincronização antes de mudar a meta.' };
    // retrato do que já está gravado ANTES do pedido: a confirmação procura só versões novas a partir dele
    try { base = await p.lerPersistidas(); } catch (e) { return { ok: false, estado: 'recusada', mensagem: `Não deu para conferir as metas no banco agora; nada foi enviado. ${erro(e)}` }; }
  }
  const antes = p.versoesDoMes().length;
  let local: VersaoMetaComercial;
  try { local = p.definir(); } catch (e) { return { ok: false, estado: 'recusada', mensagem: erro(e) }; }
  const mudou = p.versoesDoMes().length > antes;
  if (!p.remoto) return { ok: true, versao: local, mudou };

  if (!mudou) {
    // E2: mesmo valor da vigente não cria versão — mas "vigente" aqui é o cache; a confirmação é a do banco
    const vigente = ultima(base);
    if (vigente && mesmoValor(vigente.valor, local.valor)) return { ok: true, versao: vigente, mudou: false };
    if (p.syncAtual().status === 'ok') { try { await p.recarregar(); } catch { /* a mensagem abaixo já pede recarga */ } }
    return { ok: false, estado: 'desatualizada', mensagem: `A meta mudou em outra sessão: no banco está ${rotulo(vigente)}. Confira e tente de novo.` };
  }

  const s = await p.aguardarSincronizacao();
  if (s.status === 'pendente') return { ok: false, estado: 'pendente', mensagem: 'Sem conexão: a meta ficou guardada neste aparelho e ainda NÃO foi confirmada no banco.' };
  let persistidas: VersaoMetaComercial[];
  try { persistidas = await p.lerPersistidas(); } catch (e) {
    return { ok: false, estado: 'indeterminado', mensagem: `Não deu para conferir no banco se a meta foi gravada (${erro(e)}). Recarregue a tela e confira antes de tentar de novo.` };
  }
  const maxBase = base.reduce((m, v) => Math.max(m, v.versao), 0);
  const novas = persistidas.filter((v) => v.versao > maxBase);
  const minha = novas.filter((v) => mesmoValor(v.valor, local.valor) && v.motivo.trim() === local.motivo.trim()).sort((a, b) => b.versao - a.versao)[0];
  if (minha) {
    if (s.status === 'ok') { try { await p.recarregar(); } catch { /* a versão já foi conferida no banco */ } }
    const depois = ultima(persistidas);
    const aviso = [
      s.status !== 'ok' ? `Outra alteração não foi sincronizada (${s.msg ?? 'erro'}); a meta está gravada.` : '',
      depois && depois.versao > minha.versao ? `Outra sessão já mudou a meta depois: vale ${rotulo(depois)}.` : '',
    ].filter(Boolean).join(' ');
    return { ok: true, versao: minha, mudou: true, ...(aviso ? { aviso } : {}) };
  }
  // comprovado pela leitura: a versão pedida não está no banco
  if (s.status === 'ok') { try { await p.recarregar(); } catch { /* o resultado já foi conferido */ } }
  const outra = novas.length ? ` No banco, outra sessão gravou ${rotulo(ultima(novas))}.` : '';
  return { ok: false, estado: 'nao_gravada', mensagem: `Conferido no banco: a meta NÃO foi gravada.${outra}${s.status === 'erro' && s.msg ? ` Erro da sincronização: ${s.msg}` : ''}` };
}
