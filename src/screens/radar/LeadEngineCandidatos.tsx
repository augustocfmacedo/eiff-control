// LE-2E / LE3-D.1 — a aba Candidatos do Command Center: revisao humana do staging do Lead Engine.
//
// Esta tela e PROJECAO + INTENCAO HUMANA. Ela nao decide nada:
//   * o que aparece vem de `filaDeRevisao` / `descobertasSuprimidas` (core LE2-B), com a projecao de
//     apresentacao do LE3-D.1 (obra, sinal, contexto CNO) — a tela NAO le payload bruto nem recalcula regra;
//   * filtros e contadores vem de `leadEngineRevisao` (core) e sao de REVISAO, nao Commercial Queue;
//   * o que acontece vai por `actions.processarCandidatoLeadEngine` (porta unica do store, LE2-C).
// Match, identidade forte, supressao, fingerprint, observacao desatualizada, transicoes e as regras de
// CREATE/ASSOCIATE continuam no core, e sao revalidadas contra o estado atual a cada clique.
//
// Isto e back-office de ENTRADA, nao fila de vendas: nenhum score, nenhuma prioridade comercial, nenhuma
// Commercial Queue. A ordem e a de chegada. "Buscar decisores" nunca consome credito daqui: e um handoff.
import React from 'react';
import { actions } from '../../data/store';
import { Badge, Empty, Link, Select } from '../../ui/components';
import { Icon } from '../../ui/icons';
import type { CodigoBloqueio, ItemRevisaoLeadEngine, MotivoRecusa } from '../../core/radar/leadEngineReview';
import { JANELAS_DESCOBERTA, descobertoHoje, handoffDecisores, type ContadoresRevisao, type FiltroRevisao, type JanelaDescoberta, type MetricasPiloto } from '../../core/radar/leadEngineRevisao';
import type { Empresa } from '../../core/radar/types';
import { d, dh } from './comum';

/**
 * Traducao de APRESENTACAO dos codigos do core. Nao muda regra nenhuma: so troca o codigo tecnico por uma frase
 * que diz o que a pessoa deve fazer. Codigo sem tradução cai na mensagem generica, com o codigo em detalhe.
 */
export const TEXTO_RECUSA_LEAD_ENGINE: Partial<Record<MotivoRecusa, string>> = {
  CONTEXTO_MUDOU: 'Este candidato mudou desde que você abriu a tela. Revise os dados novamente.',
  OBSERVACAO_DESATUALIZADA: 'Existe uma observação mais recente deste registro.',
  JA_EXISTE_EMPRESA: 'Já existe uma empresa compatível. Associe o candidato à empresa existente.',
  SEM_IDENTIDADE_FORTE: 'Não há identidade suficiente para criar uma nova empresa.',
  SUPRIMIDO: 'Esta conta está marcada como não contatar.',
  EMPRESA_INATIVA: 'A empresa escolhida está inativa.',
  EMPRESA_MESCLADA: 'A empresa escolhida foi mesclada a outro cadastro.',
  EMPRESA_NAO_ENCONTRADA: 'A empresa escolhida não existe mais.',
  EMPRESA_OBRIGATORIA: 'Escolha a empresa para associar.',
  TRANSICAO_INVALIDA: 'Este candidato já foi processado. Atualize a tela.',
  STATUS_TERMINAL: 'Este candidato já foi processado. Atualize a tela.',
  EVIDENCIA_ALTERADA: 'A evidência original deste registro não confere. Promoção bloqueada.',
  IDENTIDADE_EXTERNA_DIVERGENTE: 'A identidade externa do registro não confere com a da fonte.',
  MOTIVO_OBRIGATORIO: 'Informe o motivo da rejeição.',
  SEM_EMPRESA_NORMALIZADA: 'A fonte não trouxe dados de empresa suficientes.',
  SEM_ADAPTER: 'Esta fonte ainda não tem leitor: o candidato não pode ser promovido.',
  TIPO_SEM_PROMOCAO_AUTOMATICA: 'Promoção de contato ainda não está habilitada.',
  REGISTRO_AUSENTE: 'Este candidato não está mais na base. Atualize a tela.',
  REGISTRO_NAO_GERENCIADO: 'Este registro não é gerenciado pelo Lead Engine.',
  NAO_SUPRIMIDO: 'Este candidato não está suprimido.',
};

const GENERICA = 'Não foi possível concluir esta operação.';

/**
 * Executa a acao e traduz a recusa. NAO usa o helper `tentar` de propósito: ele entrega só `e.message` ao
 * onErro, e perderíamos os `motivos` TIPADOS que o LE2-C criou justamente para a tela não fazer parsing de
 * texto. O feedback continua indo para o mesmo toast.
 */
function executar(fn: () => void, ok: string, onOk: (m: string) => void, onErro: (m: string) => void) {
  try {
    fn();
    onOk(ok);
  } catch (e) {
    onErro(mensagemRecusaLeadEngine(e));
  }
}

/** Erro do store -> frase humana. Nunca tenta outra ação a partir do código: só explica. */
export function mensagemRecusaLeadEngine(e: unknown): string {
  const motivos = (e as { motivos?: readonly MotivoRecusa[] })?.motivos;
  if (!motivos?.length) return (e as Error)?.message || GENERICA;
  const frases = motivos.map((m) => TEXTO_RECUSA_LEAD_ENGINE[m] ?? `${GENERICA} (${m})`);
  return [...new Set(frases)].join(' ');
}

export const ROTULO_BLOQUEIO_LE: Record<CodigoBloqueio, string> = {
  FONTE_DESCONHECIDA: 'fonte desconhecida',
  SEM_ADAPTER: 'fonte sem leitor',
  EVIDENCIA_ALTERADA: 'evidência alterada',
  IDENTIDADE_EXTERNA_DIVERGENTE: 'identidade externa divergente',
  SEM_EMPRESA_NORMALIZADA: 'sem dados de empresa',
  SEM_IDENTIDADE_FORTE: 'sem CNPJ ou business_id',
  SUPRIMIDO: 'conta marcada como não contatar',
  OBSERVACAO_DESATUALIZADA: 'há observação mais recente',
  TIPO_SEM_PROMOCAO_AUTOMATICA: 'contato não é promovido nesta fase',
};

export const ROTULO_SINAL_CNO: Record<string, string> = { CNO_NEW: 'Obra nova', CNO_EXPANSION: 'Expansão', NENHUM: 'sem sinal' };
export const ROTULO_JANELA: Record<JanelaDescoberta, string> = { hoje: 'Descobertos hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Janela de 90 dias', todos: 'Todos' };

const nomeEmpresa = (empresas: Empresa[], id: string) => {
  const e = empresas.find((x) => x.id === id);
  if (!e) return id;
  const local = [e.cidade, e.uf].filter(Boolean).join('/');
  return `${e.nomeFantasia ?? e.razaoSocial}${local ? ` (${local})` : ''}`;
};

const m2 = (v?: number) => (v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m²`);
const cnpjFmt = (c?: string) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? '—');

export interface LinhaCandidatoProps {
  c: ItemRevisaoLeadEngine;
  empresas: Empresa[];
  podeAgir: boolean;
  /** data local da operacao (AAAA-MM-DD): "Novo hoje" compara com ela, nunca com a data oficial do CNO */
  hoje: string;
  /** empresa escolhida na linha; o estado vive no Command Center para estes componentes ficarem puros */
  empresaId: string;
  /** cartao aberto ou fechado; estado no Command Center */
  aberto: boolean;
  onAbrir: (registroFonteId: string) => void;
  onSelecionar: (registroFonteId: string, empresaId: string) => void;
  onErro: (m: string) => void;
  onOk: (m: string) => void;
}

/** Um cartao da fila acionavel. Renderizar NAO decide nada: todo efeito sai de um clique explicito. */
export function LinhaCandidato({ c, empresas, podeAgir, hoje, empresaId, aberto, onAbrir, onSelecionar, onErro, onOk }: LinhaCandidatoProps) {
  const opcoes = empresas
    .filter((e) => e.ativo && !e.mescladaEm)
    .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial))
    .map((e) => ({ value: e.id, label: nomeEmpresa(empresas, e.id) }));
  const emp = c.empresaNormalizada;
  const obra = c.contextoCno;
  const projeto = c.projetoNormalizado;
  const sinal = c.sinaisNormalizados?.[0];
  const novoHoje = descobertoHoje(c, hoje);
  const handoff = handoffDecisores(c);

  // o fingerprint vai SEMPRE o que veio do item projetado: a tela nunca recalcula nem manda payload bruto
  const decidir = (decisao: 'ASSOCIATE_EXISTING' | 'CREATE_COMPANY' | 'KEEP_REVIEW' | 'REJECT', extra: { empresaId?: string; motivo?: string }, ok: string) =>
    executar(
      () => actions.processarCandidatoLeadEngine({
        tipo: 'DECISAO',
        pedido: { registroFonteId: c.registroFonteId, payloadFingerprintEsperado: c.payloadFingerprint, decisao, ...extra },
      }),
      ok, onOk, onErro,
    );

  const tomMatch = c.match?.nivel === 'certo' ? 'ok' : c.match?.nivel === 'provavel' ? undefined : 'warn';
  const titulo = obra?.nomeObra ?? projeto?.nome ?? emp?.razaoSocial ?? c.externoId;
  const local = [obra?.municipio ?? projeto?.cidade ?? emp?.cidade, obra?.uf ?? projeto?.uf ?? emp?.uf].filter(Boolean).join('/');

  return (
    <div className="card" data-candidato={c.registroFonteId} style={{ padding: 12, marginBottom: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {novoHoje && <Badge tone="ok">Novo hoje</Badge>}
            {obra && <Badge tone={obra.tipoSinal === 'CNO_NEW' ? 'ok' : obra.tipoSinal === 'CNO_EXPANSION' ? undefined : 'warn'}>{ROTULO_SINAL_CNO[obra.tipoSinal]}</Badge>}
            <Badge tone={c.status === 'PENDING' ? 'warn' : undefined}>{c.status}</Badge>
            <b>{titulo}</b>
            <span className="muted small">{local || '—'}{obra?.areaM2 !== undefined ? ` · ${m2(obra.areaM2)}` : ''}</span>
          </div>
          <div className="small" style={{ marginTop: 2 }}>
            Responsável: <b>{obra?.nomeResponsavel ?? emp?.razaoSocial ?? '—'}</b>
            <span className="muted">{emp?.cnpj ? ` · CNPJ ${cnpjFmt(emp.cnpj)}` : emp?.businessId ? ` · business_id ${emp.businessId}` : ' · sem identidade forte'}</span>
            {c.match
              ? <span className="small"> · parecida: <b>{nomeEmpresa(empresas, c.match.empresaId)}</b> <Badge tone={tomMatch}>{c.match.nivel}</Badge> <span className="muted">{c.match.motivo}</span></span>
              : <span className="muted small"> · nenhuma empresa parecida</span>}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {c.fonteNome} · {c.tipo} · {c.externoId}
            {' · descoberto pelo EIFF em '}{dh(c.recebidoEm)}
            {obra?.dataEventoCno ? <> · <span>registro/evento CNO: {d(obra.dataEventoCno)}</span></> : null}
          </div>
          {c.bloqueios.length ? <div className="small muted">{c.bloqueios.map((b) => ROTULO_BLOQUEIO_LE[b] ?? b).join(' · ')}</div> : null}
        </div>
        <button className="btn sm" onClick={() => onAbrir(c.registroFonteId)} aria-expanded={aberto}>{aberto ? 'Fechar' : 'Detalhes'}</button>
      </div>

      {aberto && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
          <div>
            <h4 style={{ margin: '0 0 4px' }}>Obra</h4>
            <div className="small">
              <div><b>{obra?.nomeObra ?? projeto?.nome ?? '—'}</b></div>
              {obra && <div className="muted mono">CNO {obra.cno}</div>}
              <div>{local || '—'}</div>
              {(obra?.endereco || projeto?.endereco) && <div className="muted">{obra?.endereco ?? projeto?.endereco}{obra?.bairro ? ` · ${obra.bairro}` : ''}</div>}
              <div>Área: {m2(obra?.areaM2 ?? projeto?.areaM2)}{obra?.unidadeMedida && obra.unidadeMedida !== 'm2' ? ` (unidade da fonte: ${obra.unidadeMedida})` : ''}</div>
              {obra && <div>Situação: {obra.situacaoNome ?? obra.situacao ?? '—'}</div>}
              {obra && <div>Data oficial do evento: {obra.dataEventoCno ? `${d(obra.dataEventoCno)} (${obra.origemDataEvento ?? ''})` : 'sem data oficial'}</div>}
              {obra && <div>Categoria: {obra.categorias.join(', ') || '—'}</div>}
              {obra && <div>Destinação: {obra.destinacoes.join(', ') || '—'}</div>}
              {sinal && <div>Sinal: {ROTULO_SINAL_CNO[sinal.tipo] ?? sinal.tipo} — {sinal.titulo}</div>}
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 4px' }}>Responsável</h4>
            <div className="small">
              <div><b>{obra?.nomeResponsavel ?? emp?.razaoSocial ?? '—'}</b></div>
              <div className="mono">{emp?.cnpj ? `CNPJ ${cnpjFmt(emp.cnpj)}` : emp?.businessId ? `business_id ${emp.businessId}` : 'sem identidade forte'}</div>
              {obra?.qualificacaoResponsavelNome && <div className="muted">{obra.qualificacaoResponsavelNome}{obra.qualificacaoResponsavel ? ` (${obra.qualificacaoResponsavel})` : ''}</div>}
              <div style={{ marginTop: 6 }}>
                Empresa parecida no Radar:{' '}
                {c.match
                  ? <><b>{nomeEmpresa(empresas, c.match.empresaId)}</b> <Badge tone={tomMatch}>{c.match.nivel}</Badge> <span className="muted">{c.match.motivo}</span></>
                  : <span className="muted">nenhuma</span>}
              </div>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 4px' }}>Origem</h4>
            <div className="small">
              <div>Descoberto pelo EIFF em: <b>{dh(c.recebidoEm)}</b></div>
              <div>Data oficial no CNO: <b>{obra?.dataEventoCno ? d(obra.dataEventoCno) : '—'}</b></div>
              <div className="muted">Fonte: {c.fonteNome} · registro {c.tipo}</div>
            </div>
            <div style={{ marginTop: 8 }}>
              {handoff.tipo === 'EMPRESA_EXISTENTE'
                ? <Link to={handoff.rota} className="btn sm">Buscar decisores (empresa existente)</Link>
                : <button className="btn sm" onClick={() => onErro(handoff.motivo)} title={handoff.motivo}>Buscar decisores</button>}
              <div className="small muted" style={{ marginTop: 4 }}>Nunca consome créditos daqui: a busca acontece na página da empresa.</div>
            </div>
          </div>
        </div>
      )}

      {podeAgir && (
        <div className="row actions" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select value={empresaId} onChange={(v) => onSelecionar(c.registroFonteId, v)} options={opcoes} allowEmpty="— escolha a empresa —" />
          <button className="btn sm primary" disabled={!empresaId} onClick={() => decidir('ASSOCIATE_EXISTING', { empresaId }, 'Associado à empresa.')}>Associar</button>
          <button className="btn sm" onClick={() => decidir('CREATE_COMPANY', {}, 'Empresa criada a partir do candidato.')}>Criar empresa</button>
          <button className="btn sm" onClick={() => decidir('KEEP_REVIEW', {}, 'Mantido em revisão.')}>Manter em revisão</button>
          <button className="btn sm" onClick={() => { const m = window.prompt('Motivo da rejeição:'); if (m && m.trim()) decidir('REJECT', { motivo: m.trim() }, 'Candidato rejeitado.'); }}>Rejeitar</button>
        </div>
      )}
    </div>
  );
}

export interface FiltrosCandidatosProps {
  filtro: FiltroRevisao;
  contadores: ContadoresRevisao;
  onFiltro: (f: FiltroRevisao) => void;
}

/** Filtros de REVISAO. Nao ordenam, nao pontuam: so recortam a fila de chegada. */
export function FiltrosCandidatos({ filtro, contadores, onFiltro }: FiltrosCandidatosProps) {
  const j = filtro.janela ?? 'todos';
  const contagemJanela: Record<JanelaDescoberta, number> = { hoje: contadores.hoje, '7d': contadores['7d'], '30d': contadores['30d'], '90d': contadores['90d'], todos: contadores.total };
  return (
    <div className="row" data-tour="lead-engine-filtros" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
      {JANELAS_DESCOBERTA.map((k) => (
        <button key={k} className={`btn sm${j === k ? ' primary' : ''}`} onClick={() => onFiltro({ ...filtro, janela: k })}>{ROTULO_JANELA[k]} ({contagemJanela[k]})</button>
      ))}
      <Select value={filtro.municipio ?? ''} onChange={(v) => onFiltro({ ...filtro, municipio: v || undefined })} options={contadores.municipios.map(([m, n]) => ({ value: m, label: `${m} (${n})` }))} allowEmpty="— município —" />
      <Select value={filtro.tipoSinal ?? ''} onChange={(v) => onFiltro({ ...filtro, tipoSinal: (v || undefined) as FiltroRevisao['tipoSinal'] })} options={[{ value: 'CNO_NEW', label: `Obra nova (${contadores.cnoNew})` }, { value: 'CNO_EXPANSION', label: `Expansão (${contadores.cnoExpansion})` }]} allowEmpty="— sinal —" />
      <Select value={filtro.areaMinimaM2 === undefined ? '' : String(filtro.areaMinimaM2)} onChange={(v) => onFiltro({ ...filtro, areaMinimaM2: v ? Number(v) : undefined })} options={[1000, 2000, 5000, 10000].map((a) => ({ value: String(a), label: `≥ ${a.toLocaleString('pt-BR')} m²` }))} allowEmpty="— área —" />
      <Select value={filtro.status ?? ''} onChange={(v) => onFiltro({ ...filtro, status: (v || undefined) as FiltroRevisao['status'] })} options={[{ value: 'PENDING', label: `PENDING (${contadores.pending})` }, { value: 'REVIEW', label: `REVIEW (${contadores.review})` }]} allowEmpty="— status —" />
    </div>
  );
}

const lista = (l: [string, number][], limite = 6) => l.slice(0, limite).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';

/** Metricas de conversao do piloto. Medem a politica; nao criam prioridade. */
export function MetricasPilotoCno({ m }: { m: MetricasPiloto }) {
  return (
    <div className="card" data-tour="lead-engine-metricas" style={{ padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Piloto CNO — conversão</h3>
      <div className="small">
        <div>Descobertos <b>{m.descobertos}</b> · novos hoje <b>{m.novosHoje}</b> · pendentes {m.pendentes} · em revisão {m.emRevisao}</div>
        <div>Promovidos <b>{m.promovidos}</b> (associados {m.associados} · empresas criadas {m.empresasCriadas}) · rejeitados {m.rejeitados}{m.motivosRejeicao.length ? ` — ${lista(m.motivosRejeicao, 4)}` : ''}</div>
        <div className="muted">Sinal: {lista(m.porSinal)} · Área: {lista(m.porFaixaArea)}</div>
        <div className="muted">Município: {lista(m.porMunicipio)} · Destinação: {lista(m.porDestinacao)}</div>
        <div className="muted">Qualificação: {lista(m.porQualificacao)}</div>
      </div>
    </div>
  );
}

export interface LeadEngineCandidatosProps {
  candidatos: ItemRevisaoLeadEngine[];
  /** candidatos ja filtrados (core `filtrarRevisao`); a fila completa continua em `candidatos` */
  visiveis: ItemRevisaoLeadEngine[];
  suprimidos: ItemRevisaoLeadEngine[];
  empresas: Empresa[];
  podeAgir: boolean;
  hoje: string;
  filtro: FiltroRevisao;
  contadores: ContadoresRevisao;
  metricas?: MetricasPiloto;
  /** empresa escolhida por candidato (registroFonteId -> empresaId). Estado no Command Center. */
  selecao: Readonly<Record<string, string>>;
  abertos: Readonly<Record<string, boolean>>;
  onAbrir: (registroFonteId: string) => void;
  onFiltro: (f: FiltroRevisao) => void;
  onSelecionar: (registroFonteId: string, empresaId: string) => void;
  onErro: (m: string) => void;
  onOk: (m: string) => void;
}

export default function LeadEngineCandidatos({ candidatos, visiveis, suprimidos, empresas, podeAgir, hoje, filtro, contadores, metricas, selecao, abertos, onAbrir, onFiltro, onSelecionar, onErro, onOk }: LeadEngineCandidatosProps) {
  const encerrar = (registroFonteId: string) =>
    executar(
      () => actions.processarCandidatoLeadEngine({ tipo: 'TERMINALIZAR_SUPRIMIDO', registroFonteId }),
      'Descoberta suprimida encerrada.', onOk, onErro,
    );

  return (
    <>
      {metricas && <MetricasPilotoCno m={metricas} />}

      <div className="card" data-tour="lead-engine-candidatos" style={{ padding: 12 }}>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Registros recebidos de fontes externas, ainda não promovidos. Nada vira conta comercial sozinho: associe
          a uma empresa existente, crie uma nova (só com CNPJ válido ou business_id), mantenha em revisão ou rejeite.
          Esta fila é de back-office — a ordem é de chegada, não de prioridade comercial. "Novo hoje" é a data em que
          o EIFF descobriu; a data oficial do CNO aparece separada.
        </div>
        <FiltrosCandidatos filtro={filtro} contadores={contadores} onFiltro={onFiltro} />
        {!candidatos.length
          ? <Empty icone="aprovacoes" titulo="Nenhum candidato aguardando revisão">Quando uma fonte externa entregar registros, eles aparecem aqui para revisão humana.</Empty>
          : !visiveis.length
            ? <p className="small muted">Nenhum candidato neste recorte ({candidatos.length} na fila).</p>
            : visiveis.map((c) => (
              <LinhaCandidato key={c.registroFonteId} c={c} empresas={empresas} podeAgir={podeAgir} hoje={hoje} empresaId={selecao[c.registroFonteId] ?? c.match?.empresaId ?? ''} aberto={!!abertos[c.registroFonteId]} onAbrir={onAbrir} onSelecionar={onSelecionar} onErro={onErro} onOk={onOk} />
            ))}
      </div>

      <div className="card table-wrap" data-tour="lead-engine-suprimidos">
        <h3>Descobertas suprimidas ({suprimidos.length})</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Registros de contas marcadas como não contatar. A descoberta aconteceu e fica aqui para auditoria, mas
          não promove nada. A gestão das supressões continua na aba <b>Não contatar</b>.
        </div>
        {!suprimidos.length
          ? <p className="small muted">Nenhuma.</p>
          : (
            <table>
              <thead><tr><th>Fonte</th><th>Recebido</th><th>Empresa do registro</th><th>Conta suprimida</th><th /></tr></thead>
              <tbody>{suprimidos.map((c) => (
                <tr key={c.registroFonteId}>
                  <td>{c.fonteNome}<div className="small muted">{c.fonteTipo} · {c.tipo}</div></td>
                  <td className="small">{d(c.recebidoEm)}<div className="muted mono">{c.externoId}</div></td>
                  <td className="small">{c.empresaNormalizada?.razaoSocial ?? '—'}</td>
                  <td className="small">{c.match ? nomeEmpresa(empresas, c.match.empresaId) : '—'} <Badge tone="bad">SUPRIMIDO</Badge></td>
                  <td className="actions">{podeAgir && (
                    <button className="btn sm" onClick={() => encerrar(c.registroFonteId)}><Icon name="checks" size={14} /> Encerrar descoberta</button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div>
    </>
  );
}
