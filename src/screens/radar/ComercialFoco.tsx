// Commercial UX 1.0 — apresentacao COMPARTILHADA da conta em foco (fila completa) e da explicacao (gaveta `Por quê ›`).
//
// Uma unica apresentacao para as duas superficies, com um modo explicito — nunca um booleano obscuro:
//   OPERACIONAL (fila completa): tudo o que existe hoje, inclusive os CTAs e o CTA governado da cadencia.
//   EXPLICACAO  (gaveta):        os MESMOS campos, em leitura pura. Nenhum no de acao e renderizado, mesmo que o
//                               chamador passe um: a superficie de explicacao nunca vira uma terceira superficie
//                               operacional (UX-2.1). Score continua visivel como informacao, sem abrir modal.
//
// Este componente nao decide nada: recebe fila/plano/cadencia/sugestao ja calculados e os nos de acao prontos.
import React, { useMemo } from 'react';
import {
  NOME_CANAL, NOME_CATEGORIA_CM, NOME_ESTAGIO, NOME_PERSONA, NOME_TIPO_ATIVIDADE, NOME_TIPO_TAREFA, OBJETIVOS, PLAYBOOKS,
  TEXTO_AVISO_CADENCIA_CM, TEXTO_AVISO_TAREFA_CM, TEXTO_BLOQUEIO_PLANO_CM, TEXTO_COBERTURA_TAREFA_CM, TEXTO_ESTADO_CADENCIA_CM,
  TEXTO_NATUREZA_TOQUE_CM, TEXTO_PENDENCIA_TAREFA_CM, TEXTO_RAZAO_CM, TEXTO_RETOMADA_CADENCIA_CM, TEXTO_TRAVA_CM,
  chaveQueDecideCM,
  type CadenceRecommendationCM, type CategoriaCommercialQueue, type ChaveOrdemCM, type CommercialActionPlan, type CommercialQueueItem,
  type Empresa, type EstadoSugestaoTarefaCM, type ModoPlanoCM, type OrigemResponsavelCM, type RadarDataset, type RazaoCM, type TaskSuggestionCM,
} from '../../core/radar';
import { Badge, Link, type Tone } from '../../ui/components';
import { RESPOSTA_NOME, ScorePill, d, nomeUsuario } from './comum';

// ---------------------------------------------------------------------------------------------------------------------
// Modo de apresentacao
// ---------------------------------------------------------------------------------------------------------------------
export const MODOS_BLOCO_FOCO = ['OPERACIONAL', 'EXPLICACAO'] as const;
export type ModoBlocoFoco = (typeof MODOS_BLOCO_FOCO)[number];
export const ehOperacional = (modo: ModoBlocoFoco) => modo === 'OPERACIONAL';
/** So a fila completa abre a explicacao do score: a gaveta mostra o numero, mas nao ramifica em outro modal. */
export const abreScore = (modo: ModoBlocoFoco, onScore?: (e: Empresa) => void) => ehOperacional(modo) && !!onScore;
/**
 * Fail-closed da gaveta: o id so continua valido enquanto pertencer a colecao autorizada (a visao filtrada de onde ela
 * foi aberta). Sumiu -> null. Nunca troca de conta, nunca cai em indice e, como o estado e limpo, nao reabre sozinha
 * quando o filtro volta: e preciso um novo clique.
 */
export const gavetaFailClosed = (porQue: string | null, idsAutorizados: readonly string[]): string | null =>
  (porQue && idsAutorizados.includes(porQue) ? porQue : null);

export interface LinhaFocoCM {
  id: string;
  item: CommercialQueueItem;
  plano: CommercialActionPlan;
  cadencia: CadenceRecommendationCM;
  sugestao: TaskSuggestionCM;
  empresa?: Empresa;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rotulos de apresentacao (nenhuma regra: so nomes para codigos que o motor ja devolve)
// ---------------------------------------------------------------------------------------------------------------------
export const NOME_MODO: Record<ModoPlanoCM, string> = { CONTATO: 'Contato', ACAO_INTERNA: 'Ação interna', REVISAR: 'Revisar', ENRIQUECER: 'Enriquecer', AGUARDAR: 'Aguardar' };
export const TOM_MODO: Record<ModoPlanoCM, Tone> = { CONTATO: 'ok', ACAO_INTERNA: 'info', REVISAR: 'warn', ENRIQUECER: 'info', AGUARDAR: 'muted' };
export const TOM_CATEGORIA: Record<CategoriaCommercialQueue, Tone> = { AGIR_AGORA: 'bad', AVANCAR_OPORTUNIDADE: 'warn', FOLLOW_UP: 'info', REVISAR: 'warn', PROSPECTAR: 'ok', ENRIQUECER: 'info', NURTURE: 'muted', AGENDADO: 'muted' };
const NOME_CHAVE_ORDEM: Record<ChaveOrdemCM | 'EMPATE', string> = {
  degrau: 'precedência da categoria', tier: 'prioridade da ação dentro da categoria', urgencia: 'urgência (dias do fato)', classe: 'classe da conta no Radar',
  priorityScore: 'score do Radar (desempate)', valorPonderado: 'valor ponderado da oportunidade', venceEm: 'prazo mais próximo', empresaId: 'desempate estável', EMPATE: 'empate em todas as chaves',
};
const NOME_ESTADO_RAZAO: Record<RazaoCM['estado'], string> = { PRINCIPAL: 'Principal', PENDENTE: 'Pendente', BLOQUEADA: 'Bloqueada', ADIADA: 'Adiada: já existe ação agendada' };
const NOME_ORIGEM_RESPONSAVEL: Record<OrigemResponsavelCM, string> = { TAREFA: 'pela tarefa', OPORTUNIDADE: 'pela oportunidade', ATIVIDADE: 'pela última atividade', COMUNICACAO: 'pela abordagem', NENHUMA: '' };
const CABECALHO_SUGESTAO: Record<EstadoSugestaoTarefaCM, string> = {
  SUGERIDA: 'Próximo compromisso sugerido',
  COBERTA: 'Este ciclo já possui compromisso registrado.',
  REQUER_DATA: 'Falta definir a data antes de agendar.',
  REQUER_RESPONSAVEL: 'Falta definir quem será responsável pelo próximo compromisso.',
  BLOQUEADA: 'O próximo compromisso não pode ser preparado ainda.',
  NAO_APLICAVEL: 'Nenhum novo compromisso precisa ser criado agora.',
};
export const nomeEmpresaCM = (e?: Empresa) => (e ? e.nomeFantasia ?? e.razaoSocial : '—');
const dias = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;

export interface ComercialFocoProps {
  linha: LinhaFocoCM;
  seguinte?: LinhaFocoCM;
  posicao: number;
  total: number;
  modo: ModoBlocoFoco;
  radar: RadarDataset;
  usuarios: { id: string; nome: string }[];
  /** Nos de acao montados pela Hoje (autoridade unica). Em EXPLICACAO sao IGNORADOS por contrato. */
  acoes?: React.ReactNode;
  ctaCadencia?: React.ReactNode;
  /** Mensagem de papel sem permissao: so faz sentido onde ha acao. */
  semPermissao?: boolean;
  /** Abre a explicacao do score (fila completa). Em EXPLICACAO o score fica informativo, sem clique. */
  onScore?: (e: Empresa) => void;
}

export default function ComercialFoco({ linha, seguinte, posicao, total, modo, radar, usuarios, acoes, ctaCadencia, semPermissao, onScore }: ComercialFocoProps) {
  const operacional = ehOperacional(modo);
  const { item, plano, empresa } = linha;
  const contatoPorId = useMemo(() => new Map(radar.contatos.map((c) => [c.id, c])), [radar.contatos]);
  const p = item.porQueAgora;
  const oportunidade = item.oportunidadeId ? radar.oportunidades.find((o) => o.id === item.oportunidadeId) : undefined;
  const pessoa = plano.contato ? contatoPorId.get(plano.contato.id) : undefined;
  const referencia = item.contato ? contatoPorId.get(item.contato.id) : undefined;
  const primeiro = posicao === 1;
  const chave = seguinte ? chaveQueDecideCM(item, seguinte.item) : undefined;
  const bloqueiosTrava = item.travas.filter((t) => t.bloqueante && t.bloqueia.length);
  const pendenciasTrava = item.travas.filter((t) => !(t.bloqueante && t.bloqueia.length));
  // agrupamento visual: adiadas e razoes de espera (agendado/nutrir) sao informacao; o resto e pendencia ou bloqueio
  const informativa = (s: RazaoCM) => s.estado === 'ADIADA' || (s.estado === 'PENDENTE' && (s.categoria === 'AGENDADO' || s.categoria === 'NURTURE'));
  const adiadas = item.secundarias.filter(informativa);
  const pendentes = item.secundarias.filter((s) => !informativa(s));
  const h = plano.historico;
  return (
    <section className={operacional ? 'card' : ''} aria-labelledby="hoje-foco">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 id="hoje-foco" style={{ margin: 0 }}>{primeiro ? 'Próxima ação' : 'Em foco'}</h2>
        <span className="small muted">{posicao}º de {total} nesta visão · posição {item.posicao} na fila completa</span>
        <span className="spacer" />
        <Badge tone={TOM_CATEGORIA[item.categoria]}>{NOME_CATEGORIA_CM[item.categoria]}</Badge>
        <Badge tone={TOM_MODO[plano.modo]}>{`Modo: ${NOME_MODO[plano.modo]}`}</Badge>
      </div>

      <div className="grid cols-3" style={{ marginTop: 12, gap: 16 }}>
        <div>
          <h3>Conta</h3>
          {/* EXPLICACAO: o score continua visivel, mas sem abrir a explicacao do score (a gaveta nao ramifica) */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>{empresa && (abreScore(modo, onScore) ? <ScorePill e={empresa} onClick={() => onScore!(empresa)} /> : <ScorePill e={empresa} />)}<Link to={`/radar/empresas/${item.empresaId}`}><b>{nomeEmpresaCM(empresa)}</b></Link></div>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Classe</dt><dd>{item.priorityClass} <span className="small muted">· score do Radar {Math.round(item.priorityScore)} (informativo)</span></dd>
            <dt>Local</dt><dd>{[empresa?.cidade, empresa?.uf].filter(Boolean).join('/') || '—'}</dd>
            <dt>Oportunidade</dt><dd>{oportunidade ? `${oportunidade.titulo} · ${NOME_ESTAGIO[oportunidade.estagio]}` : '—'}</dd>
            <dt>Responsável</dt><dd>{item.responsavelId ? `${nomeUsuario(usuarios, item.responsavelId)} ${NOME_ORIGEM_RESPONSAVEL[item.origemResponsavel]}` : <span className="muted">sem responsável</span>}</dd>
          </dl>
        </div>

        <div>
          <h3>Por que agora</h3>
          <p style={{ margin: 0 }}><b>{TEXTO_RAZAO_CM[p.codigo]}</b></p>
          {p.trava && <p className="small" style={{ margin: '4px 0 0' }}>{TEXTO_TRAVA_CM[p.trava]}{p.acaoBloqueada ? ` · segura: ${TEXTO_RAZAO_CM[p.acaoBloqueada].toLowerCase()}` : ''}</p>}
          <dl className="kv" style={{ marginTop: 8 }}>
            {p.em && <><dt>Fato</dt><dd>{d(p.em)}{p.dias != null && p.categoria !== 'AGENDADO' ? ` · há ${dias(p.dias)}` : ''}</dd></>}
            {p.resultado && <><dt>Resultado</dt><dd>{RESPOSTA_NOME(p.resultado, radar.tiposResposta)}</dd></>}
            <dt>Prazo</dt><dd>{p.venceEm ? `${d(p.venceEm)}${p.categoria === 'AGENDADO' && p.dias != null ? ` · faltam ${dias(p.dias)}` : ''}` : '—'}</dd>
          </dl>
          <p className="small muted" style={{ marginTop: 8 }}>{seguinte && chave ? <>Acima de <b>{nomeEmpresaCM(seguinte.empresa)}</b> por: {NOME_CHAVE_ORDEM[chave]}.</> : 'Última conta desta visão.'}</p>
        </div>

        <div>
          <h3>Ação</h3>
          <p style={{ margin: 0 }}><b>{plano.explicacao.modo}</b></p>
          {plano.modo === 'AGUARDAR' && <p style={{ margin: '6px 0 0' }}>{plano.aguardarAte ? <>Retomar em <b>{d(plano.aguardarAte)}</b></> : 'Sem abordagem imediata.'}</p>}
          {/* EXPLICACAO nunca renderiza no de acao, mesmo que o chamador passe um */}
          {operacional && <div className="actions" style={{ marginTop: 10 }}>{acoes}</div>}
          {operacional && semPermissao && <p className="small muted" style={{ marginTop: 6 }}>Seu papel não permite registrar ações do Radar.</p>}
          {!operacional && <p className="small muted" style={{ marginTop: 10 }}>Explicação apenas: as ações ficam na fila completa.</p>}
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 16, gap: 16 }}>
        <div>
          <h3>Pessoa</h3>
          {plano.contato && pessoa ? (
            <dl className="kv">
              <dt>Nome</dt><dd><b>{pessoa.nome}</b></dd>
              <dt>Cargo</dt><dd>{pessoa.cargo ?? '—'}</dd>
              <dt>Persona</dt><dd>{NOME_PERSONA[plano.contato.persona]}</dd>
              <dt>Decision fit</dt><dd>{plano.contato.fit}</dd>
              <dt>Por que ela</dt><dd>{plano.contato.motivo}</dd>
              <dt>Canais válidos</dt><dd>{plano.contato.canaisAcionaveis.map((c) => NOME_CANAL[c]).join(', ')}</dd>
            </dl>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Este modo não aborda ninguém.{referencia && item.contato ? <> Contato de referência da conta: <b>{referencia.nome}</b> (decision fit {item.contato.fit}{item.contato.canais.length ? `, ${item.contato.canais.map((c) => NOME_CANAL[c]).join(', ')}` : ', sem canal válido'}).</> : ' A conta não tem contato elegível.'}</p>
          )}
        </div>

        <div>
          <h3>Plano de contato</h3>
          {plano.modo === 'CONTATO' && plano.comunicacao ? (
            <dl className="kv">
              <dt>Objetivo</dt><dd>{OBJETIVOS[plano.comunicacao.objetivo].nome}</dd>
              <dt>Playbook</dt><dd>{PLAYBOOKS[plano.comunicacao.playbook].nome}</dd>
              <dt>Canal</dt><dd><b>{NOME_CANAL[plano.comunicacao.canal]}</b>{plano.comunicacao.canaisAlternativos.length ? ` · alternativo: ${plano.comunicacao.canaisAlternativos.map((c) => NOME_CANAL[c]).join(', ')}` : ''}</dd>
              <dt>CTA</dt><dd>“{plano.comunicacao.cta}”</dd>
              <dt>Por que este objetivo</dt><dd>{plano.comunicacao.motivoSelecao}</dd>
              <dt>Por que este canal</dt><dd>{plano.comunicacao.motivoCanal}{plano.comunicacao.canaisDescartados.length ? ` · descartados por não serem acionáveis: ${plano.comunicacao.canaisDescartados.map((c) => NOME_CANAL[c.canal]).join(', ')}` : ''}</dd>
              {plano.comunicacao.origem === 'ARTEFATO_APROVADO' && <><dt>Origem</dt><dd>Abordagem já aprovada na revisão humana. O envio é manual e deve ser registrado como atividade.</dd></>}
            </dl>
          ) : <p className="small muted" style={{ margin: 0 }}>Sem plano de contato: o modo é {NOME_MODO[plano.modo].toLowerCase()}.</p>}
        </div>

        <div>
          <h3>Histórico</h3>
          <dl className="kv">
            <dt>Última interação</dt><dd>{h.ultimaInteracao ? `${d(h.ultimaInteracao.em)} · ${NOME_TIPO_ATIVIDADE[h.ultimaInteracao.tipo]} · ${NOME_CANAL[h.ultimaInteracao.canal]}${h.ultimaInteracao.contatoId ? ` · ${contatoPorId.get(h.ultimaInteracao.contatoId)?.nome ?? ''}` : ''}` : 'nenhuma'}</dd>
            <dt>Último resultado</dt><dd>{h.ultimoResultado ? `${RESPOSTA_NOME(h.ultimoResultado.resultado, radar.tiposResposta)} · ${d(h.ultimoResultado.em)}` : '—'}</dd>
            <dt>Tentativas</dt><dd>{h.tentativas} · sem resposta seguidas: {h.semRespostaSeguidas}</dd>
            <dt>Houve resposta</dt><dd>{h.houveResposta ? 'sim' : 'não'}</dd>
            <dt>Abordagens</dt><dd>{h.comunicacoesEmRevisao.length} em revisão · {h.comunicacoesAprovadasNaoEnviadas.length} aprovada(s) não enviada(s)</dd>
          </dl>
        </div>
      </div>

      {blocoCadencia()}

      <div style={{ marginTop: 16 }}>
        <h3>Travas e pendências</h3>
        {!plano.bloqueios.length && !item.travas.length && !item.secundarias.length ? <p className="small muted" style={{ margin: 0 }}>Nenhuma trava ou pendência.</p> : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {plano.bloqueios.map((b, k) => <li key={`b${k}`}><Badge tone="bad">Bloqueio</Badge> {TEXTO_BLOQUEIO_PLANO_CM[b.codigo]}</li>)}
            {bloqueiosTrava.map((t, k) => <li key={`tb${k}`}><Badge tone="bad">Bloqueio</Badge> {TEXTO_TRAVA_CM[t.codigo]} · segura: {t.bloqueia.map((c) => TEXTO_RAZAO_CM[c].toLowerCase()).join('; ')}</li>)}
            {pendenciasTrava.map((t, k) => <li key={`tp${k}`}><Badge tone="warn">Pendência</Badge> {TEXTO_TRAVA_CM[t.codigo]}</li>)}
            {pendentes.map((s, k) => <li key={`s${k}`}><Badge tone={s.estado === 'BLOQUEADA' ? 'bad' : 'warn'}>{NOME_ESTADO_RAZAO[s.estado]}</Badge> {TEXTO_RAZAO_CM[s.codigo]} <span className="muted">· {NOME_CATEGORIA_CM[s.categoria]}{s.venceEm ? ` · prazo ${d(s.venceEm)}` : ''}</span></li>)}
            {adiadas.map((s, k) => <li key={`a${k}`}><Badge tone="info">Informação</Badge> {TEXTO_RAZAO_CM[s.codigo]} <span className="muted">· {s.estado === 'ADIADA' ? NOME_ESTADO_RAZAO.ADIADA.toLowerCase() : NOME_CATEGORIA_CM[s.categoria]}{s.venceEm ? ` · prazo ${d(s.venceEm)}` : ''}</span></li>)}
          </ul>
        )}
      </div>
    </section>
  );

  // -------------------------------------------------------------------------------------------------------------------
  // Cadencia (CM2-B) e sugestao de compromisso (CM2-C): sempre completas. O CTA governado so existe em OPERACIONAL.
  // -------------------------------------------------------------------------------------------------------------------
  function blocoCadencia(): React.ReactNode {
    const c = linha.cadencia; const s = linha.sugestao;
    const t = c.proximoToque;
    const sugerida = s.tarefa;
    const oportunidadeSugerida = sugerida?.oportunidadeId ? radar.oportunidades.find((o) => o.id === sugerida.oportunidadeId) : undefined;
    const contatoSugerido = sugerida?.contatoId ? contatoPorId.get(sugerida.contatoId) : undefined;
    const tarefaCobertura = s.cobertura ? radar.tarefas.find((x) => x.id === s.cobertura!.tarefaId) : undefined;
    const lista = { margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 } as const;
    return (
      <div className="grid cols-2" style={{ marginTop: 16, gap: 16 }}>
        <div>
          <h3>Cadência</h3>
          <p style={{ margin: 0 }}><b>{TEXTO_ESTADO_CADENCIA_CM[c.estado]}</b></p>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Motivo</dt><dd>{TEXTO_RAZAO_CM[c.motivo]}</dd>
            {t && t.natureza === 'RECOMENDADA' && t.em && (
              <><dt>Próximo toque recomendado</dt><dd><b>{d(t.em)}</b><div className="small muted">Ainda não é um compromisso agendado.{t.ancoraEm ? ` Contado a partir do último movimento real em ${d(t.ancoraEm)}.` : ''}</div></dd></>
            )}
            {t && t.natureza !== 'RECOMENDADA' && (
              <><dt>Próximo toque</dt><dd>{t.em ? <><b>{d(t.em)}</b> — {TEXTO_NATUREZA_TOQUE_CM[t.natureza]}</> : <b>{TEXTO_NATUREZA_TOQUE_CM[t.natureza]}</b>}</dd></>
            )}
            {c.tentativa && <><dt>Tentativas sem resposta</dt><dd>{c.tentativa.semRespostaSeguidas} de {c.tentativa.limite}{c.tentativa.doContato != null ? ` · neste contato: ${c.tentativa.doContato}` : ''}</dd></>}
            {c.retomaCom && <><dt>Retomada</dt><dd>{TEXTO_RETOMADA_CADENCIA_CM[c.retomaCom]}</dd></>}
          </dl>
          {c.avisos.length > 0 && (
            <ul className="small" style={lista} aria-label="Avisos da cadência">
              {c.avisos.map((a) => <li key={a}><Badge tone="info">Aviso</Badge> {TEXTO_AVISO_CADENCIA_CM[a]}</li>)}
            </ul>
          )}
        </div>

        <div>
          <h3>Próximo compromisso</h3>
          {s.estado === 'NAO_APLICAVEL'
            ? <p className="small muted" style={{ margin: 0 }}>{CABECALHO_SUGESTAO.NAO_APLICAVEL}{c.estado !== 'DEVIDA' ? ` ${s.explicacao.porQue}.` : ''}</p>
            : <p style={{ margin: 0 }}><b>{CABECALHO_SUGESTAO[s.estado]}</b></p>}
          {sugerida && (s.estado === 'SUGERIDA' || s.estado === 'REQUER_RESPONSAVEL') && (
            <>
              <p className="small" style={{ margin: '6px 0 0' }}><Badge tone="info">Sugestão</Badge> ainda não existe tarefa: nada foi agendado.</p>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>Tipo</dt><dd>{NOME_TIPO_TAREFA[sugerida.tipo] ?? sugerida.tipo}</dd>
                <dt>Data</dt><dd>{d(sugerida.venceEm)}{t?.natureza === 'RECOMENDADA' ? <span className="small muted"> · {TEXTO_NATUREZA_TOQUE_CM.RECOMENDADA}</span> : null}</dd>
                {sugerida.oportunidadeId && <><dt>Oportunidade</dt><dd>{oportunidadeSugerida ? `${oportunidadeSugerida.titulo} · ${NOME_ESTAGIO[oportunidadeSugerida.estagio]}` : '—'}</dd></>}
                <dt>Responsável</dt><dd>{sugerida.responsavelId ? nomeUsuario(usuarios, sugerida.responsavelId) : <span className="muted">a definir</span>}</dd>
                <dt>Contato</dt><dd>{sugerida.contatoId ? contatoSugerido?.nome ?? '—' : 'a definir no agendamento'}</dd>
                <dt>Descrição</dt><dd>{sugerida.descricaoBase}</dd>
              </dl>
              {/* o agendamento governado e acao: existe na fila completa, nunca na explicacao */}
              {operacional && ctaCadencia && (
                <div style={{ marginTop: 10 }}>
                  {ctaCadencia}
                  <p className="small muted" style={{ margin: '6px 0 0' }}>A recomendação é revalidada no momento de agendar: nada é criado sem passar pela Máquina Comercial.</p>
                </div>
              )}
            </>
          )}
          {s.estado === 'COBERTA' && s.cobertura && (
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Por quê</dt><dd>{TEXTO_COBERTURA_TAREFA_CM[s.cobertura.motivo]}</dd>
              {tarefaCobertura && <><dt>Tarefa</dt><dd>{tarefaCobertura.descricao}</dd><dt>Prazo</dt><dd>{d(tarefaCobertura.venceEm)}</dd><dt>Responsável</dt><dd>{nomeUsuario(usuarios, tarefaCobertura.responsavelId)}</dd></>}
            </dl>
          )}
          {(s.estado === 'REQUER_DATA' || s.estado === 'BLOQUEADA') && s.pendencias.length > 0 && (
            <ul className="small" style={lista} aria-label="Pendências do próximo compromisso">
              {s.pendencias.map((x) => <li key={x}><Badge tone="warn">Pendência</Badge> {TEXTO_PENDENCIA_TAREFA_CM[x]}</li>)}
            </ul>
          )}
          {s.avisos.length > 0 && (
            <ul className="small" style={lista} aria-label="Informações do próximo compromisso">
              {s.avisos.map((a) => <li key={a}><Badge tone="info">Informação</Badge> {TEXTO_AVISO_TAREFA_CM[a]}</li>)}
            </ul>
          )}
        </div>
      </div>
    );
  }
}
