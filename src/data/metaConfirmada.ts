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
 * Versão de meta criada no app e ainda não confirmada: leva o identificador ESTÁVEL da intenção (gerado antes do
 * primeiro envio) e a versão vigente em que a decisão se baseou. O banco (0074) reconhece a intenção: reenvio devolve o
 * resultado original, conteúdo diferente é recusado e decisão sobre versão desatualizada também.
 */
export type VersaoMetaLocal = VersaoMetaComercial & { intencao?: string; versaoBase?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hash determinístico de 128 bits (cyrb128) em formato de UUID — só para dar identidade estável a registro legado. */
function uuidDeterministico(texto: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < texto.length; i++) {
    const k = texto.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A versão de meta pronta para a RPC por intenção (0074). Nunca vai pela RPC antiga da 0068:
 *  * com `intencao` e `versaoBase` válidos → como está;
 *  * só um dos dois, ou inválido → ERRO (intenção incompleta não é enviada);
 *  * registro LEGADO (criado antes desta entrega, guardado offline, sem nenhum dos dois) → ganha uma intenção
 *    DETERMINÍSTICA (derivada do próprio registro: o reenvio é sempre a mesma intenção) e a versão base de quando foi
 *    criado (`versao - 1`): se outra sessão mudou a meta depois, a pré-condição recusa — nunca restaura um valor antigo.
 */
export function comIntencao(m: VersaoMetaLocal): VersaoMetaLocal & { intencao: string; versaoBase: number } {
  const temI = m.intencao !== undefined; const temB = m.versaoBase !== undefined;
  if (temI || temB) {
    if (!temI || !temB || !UUID.test(String(m.intencao)) || !Number.isInteger(m.versaoBase) || (m.versaoBase as number) < 0)
      throw new Error('meta comercial: intenção incompleta (sem identificador ou versão base); nada foi enviado.');
    return m as VersaoMetaLocal & { intencao: string; versaoBase: number };
  }
  const base = m.versao - 1;
  if (!Number.isInteger(base) || base < 0) throw new Error('meta comercial: registro antigo sem versão válida; nada foi enviado.');
  const chave = ['legado', m.id, m.mes, m.versao, m.valor === null || m.valor === undefined || m.valor === '' ? 'retirada' : String(Number(m.valor)), m.motivo.trim(), m.definidaPor, m.definidaEm].join('|');
  return { ...m, intencao: uuidDeterministico(chave), versaoBase: base };
}

/** Erro da RPC com o SQLSTATE (o PostgREST devolve `code`). */
export interface ErroRpc { message?: string; code?: string }
/**
 * Recusa DEFINITIVA do banco a uma intenção de meta (pode sair do diário): regra de negócio (23514), mesmo id com outro
 * conteúdo (23505), decisão sobre versão desatualizada (40001) e falta de permissão do papel (42501 "sem permissão").
 * Todo o resto — rede, sessão expirada/não autenticada, perfil, erro desconhecido, resposta sem código — é TRANSITÓRIO ou
 * INDETERMINADO: a intenção fica no diário para a próxima tentativa (a RPC é idempotente, reenviar é seguro).
 */
export function recusaDefinitivaMeta(e: unknown): boolean {
  const { code, message } = (e ?? {}) as ErroRpc;
  const msg = String(message ?? '');
  if (!/^meta comercial:/.test(msg.replace(/^rpc [a-z_]+: /, ''))) return false;
  return code === '23514' || code === '23505' || code === '40001' || (code === '42501' && /sem permissão/.test(msg));
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
  if (p.remoto) {
    // a decisão parte da versão vigente que o app mostra; se o banco já está em outra, nem envia (a 0074 recusaria)
    const noBanco = base.reduce((m, v) => Math.max(m, v.versao), 0);
    const noApp = p.versoesDoMes().reduce((m, v) => Math.max(m, v.versao), 0);
    if (noBanco !== noApp) {
      if (p.syncAtual().status === 'ok') { try { await p.recarregar(); } catch { /* a mensagem já pede conferência */ } }
      return { ok: false, estado: 'desatualizada', mensagem: `A meta mudou em outra sessão: no banco está ${rotulo(ultima(base))}. Confira e tente de novo.` };
    }
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
