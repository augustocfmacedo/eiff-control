// Commercial UX 1.0 — UX-1: Panorama operacional.
//
// Apresenta o que o UX-0 ja projetou: quatro zonas com teto de itens e contadores objetivos. NAO classifica, NAO
// reordena, NAO decide CTA e NAO grava: recebe o view-model pronto (ContaComercialUX) e recebe do Hoje os nos de acao,
// para o `switch (plano.modo)` continuar existindo num unico lugar. Zero indicador sintetico.
//
// Risco e eixo SOBREPOSTO: a mesma conta aparece em AGORA (ou PROGRAMADO) e em RISCO. Isso e correto.
// Contrato de design: docs/commercial-ux-1.0-decisao.md.
import React from 'react';
import { TEXTO_BLOQUEIO_PLANO_CM, type CodigoBloqueioPlanoCM } from '../../core/radar/commercialActionPlan';
import type { NaturezaToqueCM, RetomadaCadenciaCM } from '../../core/radar/commercialCadence';
import { TEXTO_RAZAO_CM, TEXTO_TRAVA_CM, type CodigoRazaoCM, type CodigoTravaCM } from '../../core/radar/commercialMachine';
import { NOME_ESTAGIO, NOME_SINAL } from '../../core/radar/padroes';
import { Badge, Link, money, type Tone } from '../../ui/components';
import type { EstadoPipelineUX, OportunidadePipelineUX } from './comercialPipeline';
import { entradaVaziaUX, textoDaRazaoEntradaUX, type EntradaComercialUX } from './comercialEntrada';
import { EVENTOS_COMERCIAIS_UX } from './comercialTelemetria';
import {
  ORCAMENTO_PANORAMA_COMERCIAL, contasDoHorizonteUX, contasEmRiscoUX, recorteUX, resumoComercialUX, resumoEsperaUX,
  type ContaComercialUX, type EsperaComercialUX, type ExcecaoComercialUX, type RecorteUX, type ResumoComercialUX, type SeveridadeExcecaoUX,
} from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Rotulos (nenhuma regra: so nomes para o que o motor ja decidiu)
// ---------------------------------------------------------------------------------------------------------------------
/** A natureza da data continua visivel: RECOMENDADA nunca pode parecer compromisso confirmado. */
export const TEXTO_NATUREZA_PANORAMA: Readonly<Record<NaturezaToqueCM, string>> = {
  FIRME: 'compromisso marcado',
  BASE_CM1: 'intervalo da cadência',
  RECOMENDADA: 'data recomendada · ainda não é compromisso',
  IMEDIATA: 'agora',
};
export const TEXTO_ESPERA_PANORAMA: Readonly<Record<RetomadaCadenciaCM, string>> = {
  DATA: 'data definida',
  FATO_NOVO: 'fato novo',
  DADO: 'dado que falta',
  DECISAO_HUMANA: 'decisão humana',
};
export const TEXTO_ESPERA_SEM_MOTIVO_PANORAMA = 'sem motivo informado';

/** UX-4: os dois unicos estados do pipeline. Nao existe rotulo positivo ("em movimento", "saudavel"): sem contrato, sem badge. */
export const TEXTO_ESTADO_PIPELINE: Readonly<Record<EstadoPipelineUX, string>> = { PARADA: 'PARADA', EM_RISCO: 'EM RISCO' };
export const TOM_ESTADO_PIPELINE: Readonly<Record<EstadoPipelineUX, Tone>> = { PARADA: 'warn', EM_RISCO: 'bad' };
export const TEXTO_SEM_VALOR_PIPELINE = 'valor não informado';
/** A inteligencia de pipeline ja existe no Command Center; o Panorama nao cria rota nova. */
export const ROTA_PIPELINE_PANORAMA = '/radar';

/** UX-5: a inteligencia ampla (sinais, contas, enriquecimento) ja vive no Command Center; nenhuma rota nova. */
export const ROTA_ENTRADA_PANORAMA = '/radar';
export const EVENTO_PIPELINE_PANORAMA = EVENTOS_COMERCIAIS_UX.pipelineAbrir;
export const EVENTO_ENTRADA_PANORAMA = EVENTOS_COMERCIAIS_UX.entradaInteligencia;
/** Rotulos da zona ENTRADA. "Conta adicionada ao Radar" e deliberado: nunca "empresa nova", nunca "lead". */
export const TITULO_SINAL_ENTRADA = 'SINAL NOVO';
export const TITULO_CONTA_ENTRADA = 'CONTA ADICIONADA AO RADAR';
export const TITULO_ENRIQUECIMENTO_ENTRADA = 'ENRIQUECIMENTO';
export const TEXTO_VERIFICADO_ENTRADA = 'Verificado';
export const TEXTO_A_VERIFICAR_ENTRADA = 'A verificar';
export const TEXTO_ENTRADA_VAZIA = 'Nenhuma entrada recente ou pendência de enriquecimento nesta visão.';
/** Fato temporal em linguagem de DETECCAO: o evento pode ser antigo; o que e recente e o Radar ter sabido. */
export const textoDeteccaoEntrada = (dias: number): string => (dias === 0 ? 'Detectado hoje' : `Detectado há ${dias} dia${dias === 1 ? '' : 's'}`);
export const textoAdicaoEntrada = (dias: number): string => (dias === 0 ? 'Adicionada ao Radar hoje' : `Adicionada ao Radar há ${dias} dia${dias === 1 ? '' : 's'}`);
const TOM_SEVERIDADE: Readonly<Record<SeveridadeExcecaoUX, Tone>> = { BLOQUEIO: 'bad', RISCO: 'bad', ATENCAO: 'warn' };
const NOME_SEVERIDADE: Readonly<Record<SeveridadeExcecaoUX, string>> = { BLOQUEIO: 'Bloqueio', RISCO: 'Risco', ATENCAO: 'Atenção' };
const ORDEM_SEVERIDADE: Readonly<Record<SeveridadeExcecaoUX, number>> = { BLOQUEIO: 0, RISCO: 1, ATENCAO: 2 };
const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/** Texto da excecao pela tabela da autoridade que a produziu; nenhum texto novo nasce aqui. */
export function textoDaExcecaoUX(e: ExcecaoComercialUX): string {
  if (e.tipo === 'TRAVA') return TEXTO_TRAVA_CM[e.codigo as CodigoTravaCM];
  if (e.tipo === 'BLOQUEIO_PLANO') return TEXTO_BLOQUEIO_PLANO_CM[e.codigo as CodigoBloqueioPlanoCM];
  return TEXTO_RAZAO_CM[e.codigo as CodigoRazaoCM];
}

/** A excecao que a conta mostra primeiro: a mais severa, mantendo a ordem de origem no empate (nao reordena a lista). */
export function excecaoPrincipalUX(conta: ContaComercialUX): ExcecaoComercialUX | undefined {
  let melhor: ExcecaoComercialUX | undefined;
  for (const e of conta.excecoes) if (!melhor || ORDEM_SEVERIDADE[e.severidade] < ORDEM_SEVERIDADE[melhor.severidade]) melhor = e;
  return melhor;
}

// ---------------------------------------------------------------------------------------------------------------------
// Zonas: composicao dos recortes do UX-0 (nenhuma classificacao nova)
// ---------------------------------------------------------------------------------------------------------------------
export interface ZonasPanoramaUX {
  resumo: ResumoComercialUX;
  agora: RecorteUX<ContaComercialUX>;
  programado: RecorteUX<ContaComercialUX>;
  risco: RecorteUX<ContaComercialUX>;
  /** AGUARDANDO e resumo por motivo, nunca lista. */
  espera: EsperaComercialUX[];
}

export function zonasDoPanoramaUX(contas: readonly ContaComercialUX[]): ZonasPanoramaUX {
  return {
    resumo: resumoComercialUX(contas),
    agora: recorteUX(contasDoHorizonteUX(contas, 'AGORA'), ORCAMENTO_PANORAMA_COMERCIAL.agora),
    programado: recorteUX(contasDoHorizonteUX(contas, 'PROGRAMADO'), ORCAMENTO_PANORAMA_COMERCIAL.programado),
    risco: recorteUX(contasEmRiscoUX(contas), ORCAMENTO_PANORAMA_COMERCIAL.risco),
    espera: resumoEsperaUX(contas),
  };
}

/** Motivo em linguagem de gente: o texto da razao do CM1-A + o fato temporal que o item ja trazia. */
export function motivoDaContaUX(conta: ContaComercialUX): string {
  const { texto, dias, venceEm } = conta.motivo;
  if (dias != null && dias > 0) return `${texto} · há ${dias} dia${dias === 1 ? '' : 's'}`;
  if (venceEm) return `${texto} · prazo ${ddmm(venceEm)}`;
  return texto;
}

// ---------------------------------------------------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------------------------------------------------
export interface ComercialPanoramaProps {
  /** View-model do UX-0, ja na ordem do CM1-A. */
  contas: readonly ContaComercialUX[];
  nomeEmpresa: (empresaId: string) => string;
  nomeContato: (contatoId: string) => string;
  nomeCanal: (canal: NonNullable<ContaComercialUX['contato']>['canal']) => string;
  /** Acao principal do item, montada pela autoridade unica que vive na Hoje. */
  acaoPrincipal: (conta: ContaComercialUX) => React.ReactNode;
  /** CTA governado da cadencia (CM2-C -> CM2-E), tambem montado na Hoje. */
  ctaCadencia: (conta: ContaComercialUX) => React.ReactNode;
  /** Abre a gaveta `Por quê ›` (UX-2) com a explicabilidade inteira da conta. */
  onPorQue: (conta: ContaComercialUX) => void;
  onVerTodos: () => void;
  /** UX-6: nome do evento de interface para a telemetria local do Hoje. Nunca recebe id ou dado comercial. */
  onEvento?: (evento: string) => void;
  /** UX-4: oportunidades de referencia ja projetadas (ordem do CM1-A). O Panorama nao le dataset. */
  pipelineAtivo: readonly OportunidadePipelineUX[];
  /** UX-5: view-model da zona ENTRADA, ja projetado. O Panorama nao calcula recencia nem escolhe sinal/conta. */
  entrada: EntradaComercialUX;
}

export default function ComercialPanorama({ contas, nomeEmpresa, nomeContato, nomeCanal, acaoPrincipal, ctaCadencia, onPorQue, onVerTodos, pipelineAtivo, entrada, onEvento }: ComercialPanoramaProps) {
  const { resumo, agora, programado, risco, espera } = zonasDoPanoramaUX(contas);
  const pipeline = recorteUX(pipelineAtivo, ORCAMENTO_PANORAMA_COMERCIAL.pipeline);
  const verTodos = (n: number, rotulo = 'Ver todos') => n > 0 ? <button className="btn sm" onClick={onVerTodos}>{`${rotulo} (${n}) ›`}</button> : null;

  return (
    <div className="panorama">
      <div className="strip" aria-label="Situação da carteira">
        <div><div className="small muted">AGORA</div><b style={{ fontSize: 'var(--text-xl)' }}>{resumo.agora}</b><div className="small muted">exigem ação</div></div>
        <div><div className="small muted">AGUARDANDO</div><b style={{ fontSize: 'var(--text-xl)' }}>{resumo.aguardando}</b><div className="small muted">esperam alguém ou algum fato</div></div>
        <div><div className="small muted">PROGRAMADAS</div><b style={{ fontSize: 'var(--text-xl)' }}>{resumo.programado}</b><div className="small muted">com data à frente</div></div>
        <div><div className="small muted">EM RISCO</div><b style={{ fontSize: 'var(--text-xl)' }}>{resumo.emRisco}</b><div className="small muted">travas e negócios parados</div></div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14, gap: 14, alignItems: 'start' }}>
        <section className="card" aria-labelledby="zona-agora" data-tour="comercial-agora">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <h2 id="zona-agora" style={{ margin: 0 }}>Agora</h2>
            <span className="small muted">{resumo.agora === 0 ? 'nada exige ação neste instante' : `${resumo.agora} conta(s)`}</span>
            <span className="spacer" />
            {verTodos(agora.ocultos, 'Ver mais')}
          </div>
          {!agora.visiveis.length
            ? <p className="small muted" style={{ margin: '10px 0 0' }}>Nenhuma conta exige ação agora. O que está em espera ou programado aparece nas outras zonas.</p>
            : <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{agora.visiveis.map((c) => cartao(c))}</div>}
        </section>

        <div style={{ display: 'grid', gap: 14 }}>
          <section className="card" aria-labelledby="zona-risco">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h2 id="zona-risco" style={{ margin: 0 }}>Risco e travas</h2>
              <span className="small muted">{resumo.emRisco === 0 ? 'nenhuma exceção' : `${resumo.emRisco} conta(s)`}</span>
              <span className="spacer" />
              {verTodos(risco.ocultos, 'Ver mais')}
            </div>
            {!risco.visiveis.length
              ? <p className="small muted" style={{ margin: '10px 0 0' }}>Nenhuma trava, bloqueio ou negócio parado.</p>
              : <ul className="small" style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {risco.visiveis.map((c) => {
                  const e = excecaoPrincipalUX(c)!;
                  return (
                    <li key={c.itemId}>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <Badge tone={TOM_SEVERIDADE[e.severidade]}>{NOME_SEVERIDADE[e.severidade]}</Badge>
                        <b>{nomeEmpresa(c.empresaId)}</b>
                        {c.excecoes.length > 1 && <span className="muted">+{c.excecoes.length - 1}</span>}
                      </div>
                      <div className="muted">{textoDaExcecaoUX(e)}</div>
                      <button className="btn sm" style={{ marginTop: 4 }} onClick={() => onPorQue(c)}>Por quê ›</button>
                    </li>
                  );
                })}
              </ul>}
          </section>

          <section className="card" aria-labelledby="zona-aguardando">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h2 id="zona-aguardando" style={{ margin: 0 }}>Aguardando</h2>
              <span className="small muted">{resumo.aguardando === 0 ? 'ninguém em espera' : `${resumo.aguardando} conta(s)`}</span>
              <span className="spacer" />
              {verTodos(resumo.aguardando, 'Ver todas')}
            </div>
            {!espera.length
              ? <p className="small muted" style={{ margin: '10px 0 0' }}>Nenhuma conta esperando alguém ou algum fato.</p>
              : <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {espera.map((e) => <Badge key={e.retomaCom ?? 'sem-motivo'} tone="muted">{`${e.contas} · ${e.retomaCom ? TEXTO_ESPERA_PANORAMA[e.retomaCom] : TEXTO_ESPERA_SEM_MOTIVO_PANORAMA}`}</Badge>)}
              </div>}
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="zona-pipeline" data-tour="comercial-pipeline" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <h2 id="zona-pipeline" style={{ margin: 0 }}>Pipeline ativo</h2>
          <span className="small muted">{pipelineAtivo.length === 0 ? 'nenhuma oportunidade ativa nesta visão' : `${pipelineAtivo.length} oportunidade(s) nesta visão`}</span>
          <span className="spacer" />
          <Link to={ROTA_PIPELINE_PANORAMA} className="btn sm" onClick={() => onEvento?.(EVENTO_PIPELINE_PANORAMA)}>Ver pipeline ›</Link>
        </div>
        {!pipeline.visiveis.length
          ? <p className="small muted" style={{ margin: '10px 0 0' }}>Nenhuma oportunidade ativa nesta visão.</p>
          : <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {pipeline.visiveis.map((o) => (
              <li key={o.oportunidadeId} className="pipeline-item">
                {o.estado && <Badge tone={TOM_ESTADO_PIPELINE[o.estado]}>{TEXTO_ESTADO_PIPELINE[o.estado]}</Badge>}
                <b>{nomeEmpresa(o.empresaId)}</b>
                <Link to={`/radar/empresas/${o.empresaId}?aba=oportunidades`}>{o.titulo}</Link>
                <span className="small muted">{NOME_ESTAGIO[o.estagio]}</span>
                <span className="small muted">{o.valorEstimado === undefined ? TEXTO_SEM_VALOR_PIPELINE : money(o.valorEstimado)}</span>
                <span className="spacer" />
                {o.ultimoMovimentoEm && <span className="small muted">Último movimento {ddmm(o.ultimoMovimentoEm)}{o.diasSemMovimento === undefined ? '' : ` · há ${o.diasSemMovimento} dia${o.diasSemMovimento === 1 ? '' : 's'}`}</span>}
              </li>
            ))}
          </ul>}
        {pipeline.ocultos > 0 && <div className="small muted" style={{ marginTop: 8 }}>{`+${pipeline.ocultos} oportunidade(s) nesta visão · veja em Ver pipeline`}</div>}
      </section>

      <section className="card" aria-labelledby="zona-entrada" data-tour="comercial-entrada" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <h2 id="zona-entrada" style={{ margin: 0 }}>Entrada</h2>
          <span className="small muted">{`últimos ${entrada.janelaDias} dias`}</span>
          <span className="spacer" />
          <Link to={ROTA_ENTRADA_PANORAMA} className="btn sm" onClick={() => onEvento?.(EVENTO_ENTRADA_PANORAMA)}>Ver inteligência ›</Link>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {`${entrada.sinais.total} sinal(is) novo(s) · ${entrada.contas.total} conta(s) adicionada(s) · ${entrada.enriquecimento.total} para enriquecer`}
          {entrada.enriquecimento.total > 0 && ` (${entrada.enriquecimento.semDecisor} sem decisor · ${entrada.enriquecimento.semCanal} sem canal)`}
        </div>
        {entradaVaziaUX(entrada)
          ? <p className="small muted" style={{ margin: '10px 0 0' }}>{TEXTO_ENTRADA_VAZIA}</p>
          : <div className="grid cols-3 entrada-cards" style={{ gap: 10, marginTop: 10, alignItems: 'start' }}>
            {entrada.sinais.destaque && (
              <article className="card" style={{ padding: 12 }}>
                <div className="small muted">{TITULO_SINAL_ENTRADA}</div>
                <Link to={`/radar/empresas/${entrada.sinais.destaque.empresaId}`}><b>{nomeEmpresa(entrada.sinais.destaque.empresaId)}</b></Link>
                <p style={{ margin: '4px 0 0' }}>{entrada.sinais.destaque.titulo}</p>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {NOME_SINAL[entrada.sinais.destaque.tipo]} · {textoDeteccaoEntrada(entrada.sinais.destaque.dias)} · {entrada.sinais.destaque.verificado ? TEXTO_VERIFICADO_ENTRADA : TEXTO_A_VERIFICAR_ENTRADA}
                </p>
              </article>
            )}
            {entrada.contas.destaque && (
              <article className="card" style={{ padding: 12 }}>
                <div className="small muted">{TITULO_CONTA_ENTRADA}</div>
                <Link to={`/radar/empresas/${entrada.contas.destaque.empresaId}`}><b>{nomeEmpresa(entrada.contas.destaque.empresaId)}</b></Link>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {textoAdicaoEntrada(entrada.contas.destaque.dias)}
                  {entrada.contas.destaque.cidade ? ` · ${entrada.contas.destaque.cidade}${entrada.contas.destaque.uf ? `/${entrada.contas.destaque.uf}` : ''}` : ''}
                </p>
              </article>
            )}
            {entrada.enriquecimento.destaque && (
              <article className="card" style={{ padding: 12 }}>
                <div className="small muted">{TITULO_ENRIQUECIMENTO_ENTRADA}</div>
                <Link to={`/radar/empresas/${entrada.enriquecimento.destaque.empresaId}`}><b>{nomeEmpresa(entrada.enriquecimento.destaque.empresaId)}</b></Link>
                <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {entrada.enriquecimento.destaque.semDecisor && <Badge tone="muted">SEM DECISOR</Badge>}
                  {entrada.enriquecimento.destaque.semCanal && <Badge tone="muted">SEM CANAL</Badge>}
                </div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>{textoDaRazaoEntradaUX(entrada.enriquecimento.destaque.codigos[0])}</p>
              </article>
            )}
          </div>}
      </section>

      <section className="card" aria-labelledby="zona-programado" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <h2 id="zona-programado" style={{ margin: 0 }}>Programado</h2>
          <span className="small muted">{resumo.programado === 0 ? 'nada com data à frente' : `${resumo.programado} conta(s)`}</span>
          <span className="spacer" />
          {verTodos(programado.ocultos, 'Ver mais')}
        </div>
        {!programado.visiveis.length
          ? <p className="small muted" style={{ margin: '10px 0 0' }}>Nenhuma conta com data à frente.</p>
          : <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {programado.visiveis.map((c) => (
              <li key={c.itemId} className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{c.proximoToque?.em ? ddmm(c.proximoToque.em) : '—'}</b>
                <b>{nomeEmpresa(c.empresaId)}</b>
                <span className="small muted">{c.motivo.texto}</span>
                {c.proximoToque && <span className="small muted">· {TEXTO_NATUREZA_PANORAMA[c.proximoToque.natureza]}</span>}
                <span className="spacer" />
                {ctaCadencia(c)}
                <button className="btn sm" onClick={() => onPorQue(c)}>Por quê ›</button>
              </li>
            ))}
          </ul>}
      </section>
    </div>
  );

  /** Cartao da zona AGORA: empresa, motivo humano, pessoa, canal, acao principal e o caminho para o detalhe. */
  function cartao(c: ContaComercialUX): React.ReactNode {
    return (
      <article key={c.itemId} className="card" style={{ padding: 14 }}>
        <b>{nomeEmpresa(c.empresaId)}</b>
        <p style={{ margin: '6px 0 0' }}>{motivoDaContaUX(c)}</p>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {c.contato ? <>{nomeContato(c.contato.id)}{c.contato.canal ? ` · ${nomeCanal(c.contato.canal)}` : ''}</> : 'sem contato definido para este passo'}
        </p>
        <div className="actions" style={{ marginTop: 10 }}>
          {acaoPrincipal(c)}
          <button className="btn sm" data-tour="comercial-porque" onClick={() => onPorQue(c)} aria-label={`Por quê ${nomeEmpresa(c.empresaId)} está na fila`}>Por quê ›</button>
        </div>
      </article>
    );
  }
}
