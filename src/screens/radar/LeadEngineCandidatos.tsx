// LE-2E — a aba Candidatos do Command Center: revisao humana do staging do Lead Engine.
//
// Esta tela e PROJECAO + INTENCAO HUMANA. Ela nao decide nada:
//   * o que aparece vem de `filaDeRevisao` / `descobertasSuprimidas` (core LE2-B);
//   * o que acontece vai por `actions.processarCandidatoLeadEngine` (porta unica do store, LE2-C).
// Match, identidade forte, supressao, fingerprint, observacao desatualizada, transicoes e as regras de
// CREATE/ASSOCIATE continuam no core, e sao revalidadas contra o estado atual a cada clique.
//
// Isto e back-office de ENTRADA, nao fila de vendas: nenhum score, nenhuma prioridade comercial, nenhuma
// Commercial Queue. A fila de revisao da importacao CSV (aba "Fila de revisão") e outra coisa e continua separada.
import React from 'react';
import { actions } from '../../data/store';
import { Badge, Empty, Select } from '../../ui/components';
import { Icon } from '../../ui/icons';
import type { CodigoBloqueio, ItemRevisaoLeadEngine, MotivoRecusa } from '../../core/radar/leadEngineReview';
import type { Empresa } from '../../core/radar/types';
import { d } from './comum';

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

const nomeEmpresa = (empresas: Empresa[], id: string) => {
  const e = empresas.find((x) => x.id === id);
  if (!e) return id;
  const local = [e.cidade, e.uf].filter(Boolean).join('/');
  return `${e.nomeFantasia ?? e.razaoSocial}${local ? ` (${local})` : ''}`;
};

export interface LinhaCandidatoProps {
  c: ItemRevisaoLeadEngine;
  empresas: Empresa[];
  podeAgir: boolean;
  /** empresa escolhida na linha; o estado vive no Command Center para estes componentes ficarem puros */
  empresaId: string;
  onSelecionar: (registroFonteId: string, empresaId: string) => void;
  onErro: (m: string) => void;
  onOk: (m: string) => void;
}

/** Uma linha da fila acionavel. Renderizar NAO decide nada: todo efeito sai de um clique explicito. */
export function LinhaCandidato({ c, empresas, podeAgir, empresaId, onSelecionar, onErro, onOk }: LinhaCandidatoProps) {
  const opcoes = empresas
    .filter((e) => e.ativo && !e.mescladaEm)
    .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial))
    .map((e) => ({ value: e.id, label: nomeEmpresa(empresas, e.id) }));
  const emp = c.empresaNormalizada;

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
  return (
    <tr>
      <td>{c.fonteNome}<div className="small muted">{c.fonteTipo} · {c.tipo}</div></td>
      <td className="small">{d(c.recebidoEm)}<div className="muted mono">{c.externoId}</div></td>
      <td className="small">
        <b>{emp?.razaoSocial ?? '—'}</b>
        <div className="muted">{[emp?.cidade, emp?.uf].filter(Boolean).join('/') || '—'}</div>
        <div className="muted">{emp?.cnpj ? `CNPJ ${emp.cnpj}` : emp?.businessId ? `business_id ${emp.businessId}` : 'sem identidade forte'}</div>
      </td>
      <td className="small">
        {c.match
          ? <><b>{nomeEmpresa(empresas, c.match.empresaId)}</b><div><Badge tone={tomMatch}>{c.match.nivel}</Badge> <span className="muted">{c.match.motivo}</span></div></>
          : <span className="muted">nenhum</span>}
      </td>
      <td className="small">
        <Badge tone={c.status === 'PENDING' ? 'warn' : undefined}>{c.status}</Badge>
        {c.bloqueios.length ? <div className="muted">{c.bloqueios.map((b) => ROTULO_BLOQUEIO_LE[b] ?? b).join(' · ')}</div> : null}
      </td>
      <td className="actions" style={{ minWidth: 300 }}>{podeAgir && <>
        <Select value={empresaId} onChange={(v) => onSelecionar(c.registroFonteId, v)} options={opcoes} allowEmpty="— escolha a empresa —" />
        <button className="btn sm primary" disabled={!empresaId} onClick={() => decidir('ASSOCIATE_EXISTING', { empresaId }, 'Associado à empresa.')}>Associar</button>
        <button className="btn sm" onClick={() => decidir('CREATE_COMPANY', {}, 'Empresa criada a partir do candidato.')}>Criar empresa</button>
        <button className="btn sm" onClick={() => decidir('KEEP_REVIEW', {}, 'Mantido em revisão.')}>Manter em revisão</button>
        <button className="btn sm" onClick={() => { const m = window.prompt('Motivo da rejeição:'); if (m && m.trim()) decidir('REJECT', { motivo: m.trim() }, 'Candidato rejeitado.'); }}>Rejeitar</button>
      </>}</td>
    </tr>
  );
}

export interface LeadEngineCandidatosProps {
  candidatos: ItemRevisaoLeadEngine[];
  suprimidos: ItemRevisaoLeadEngine[];
  empresas: Empresa[];
  podeAgir: boolean;
  /** empresa escolhida por candidato (registroFonteId -> empresaId). Estado no Command Center. */
  selecao: Readonly<Record<string, string>>;
  onSelecionar: (registroFonteId: string, empresaId: string) => void;
  onErro: (m: string) => void;
  onOk: (m: string) => void;
}

export default function LeadEngineCandidatos({ candidatos, suprimidos, empresas, podeAgir, selecao, onSelecionar, onErro, onOk }: LeadEngineCandidatosProps) {
  const encerrar = (registroFonteId: string) =>
    executar(
      () => actions.processarCandidatoLeadEngine({ tipo: 'TERMINALIZAR_SUPRIMIDO', registroFonteId }),
      'Descoberta suprimida encerrada.', onOk, onErro,
    );

  return (
    <>
      <div className="card table-wrap" data-tour="lead-engine-candidatos">
        <div className="small muted" style={{ marginBottom: 8 }}>
          Registros recebidos de fontes externas, ainda não promovidos. Nada vira conta comercial sozinho: associe
          a uma empresa existente, crie uma nova (só com CNPJ válido ou business_id), mantenha em revisão ou rejeite.
          Esta fila é de back-office — a ordem é de chegada, não de prioridade comercial.
        </div>
        {!candidatos.length
          ? <Empty icone="aprovacoes" titulo="Nenhum candidato aguardando revisão">Quando uma fonte externa entregar registros, eles aparecem aqui para revisão humana.</Empty>
          : (
            <table>
              <thead><tr><th>Fonte</th><th>Recebido</th><th>Empresa do registro</th><th>Empresa parecida</th><th>Situação</th><th /></tr></thead>
              <tbody>{candidatos.map((c) => <LinhaCandidato key={c.registroFonteId} c={c} empresas={empresas} podeAgir={podeAgir} empresaId={selecao[c.registroFonteId] ?? c.match?.empresaId ?? ''} onSelecionar={onSelecionar} onErro={onErro} onOk={onOk} />)}</tbody>
            </table>
          )}
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
