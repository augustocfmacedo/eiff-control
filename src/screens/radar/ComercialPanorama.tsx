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
import { Badge, type Tone } from '../../ui/components';
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
}

export default function ComercialPanorama({ contas, nomeEmpresa, nomeContato, nomeCanal, acaoPrincipal, ctaCadencia, onPorQue, onVerTodos }: ComercialPanoramaProps) {
  const { resumo, agora, programado, risco, espera } = zonasDoPanoramaUX(contas);
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
        <section className="card" aria-labelledby="zona-agora">
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
          <button className="btn sm" onClick={() => onPorQue(c)}>Por quê ›</button>
        </div>
      </article>
    );
  }
}
