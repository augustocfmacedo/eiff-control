// Commercial UX 1.0 — UX-3: Modo Foco (trabalhar a fila uma conta por vez).
//
// Camada OPERACIONAL compacta: responde quem e a conta, o que aconteceu, com quem falar, por qual canal, qual o
// objetivo, o que fazer agora e quem vem depois. Nada aqui decide negocio.
//
// Regra central: AÇÃO != PRÓXIMA CONTA. Executar um CTA nunca avanca, nunca escolhe outra conta e nunca pula a
// fila; avancar e sempre clique explicito do usuario. Por isso este modulo nao tem nenhum caminho que troque o foco
// como efeito de uma acao comercial: as unicas funcoes que produzem um novo `itemId` de foco sao a entrada explicita
// (`focoAoEntrarUX`), os vizinhos (`anteriorUX`/`proximaUX`), o clique em "Depois desta" e o botao explicito da
// conta indisponivel.
//
// Fila: a ordem e a do CM1-A, ja projetada pelo UX-0. Este modulo NAO ordena, NAO filtra, NAO pontua e NAO
// recomputa fila — so navega no array que recebe. A fonte e a `base` do Hoje (filtros globais), nunca `visiveis`
// (que ainda carrega o filtro de categoria da Fila completa).
//
// Acoes: os descritores vem prontos do Hoje (autoridade unica do `switch (plano.modo)`); aqui so se escolhe
// principal + ate uma secundaria e se renderiza.
import React from 'react';
import type { Canal } from '../../core/radar';
import { Badge, Empty, Link } from '../../ui/components';
import { motivoDaContaUX } from './ComercialPanorama';
import type { ContaComercialUX, HorizonteExecucaoUX } from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------------------------------------------------
/** Descritor de acao produzido pelo Hoje (`acoesDoItem`). O Modo Foco apresenta; nunca cria acao nova. */
export interface AcaoFocoUX {
  id: string;
  rotulo: string;
  primario?: boolean;
  to?: string;
  onClick?: () => void;
}

/** Quantas contas o bloco "Depois desta" mostra — sao simplesmente as proximas da fila, sem ranking. */
export const MAXIMO_DEPOIS_DESTA_UX = 4;

/**
 * Identidade do foco. `id` e o `itemId` (nunca o indice). `perdido` guarda a conta que saiu da base: enquanto
 * estiver preenchido, a tela fica no estado neutro — nem escolhe outra, nem reassume a antiga se ela voltar.
 */
export interface FocoTrabalhoUX {
  id: string | null;
  perdido: string | null;
}

export type EstadoModoFocoUX =
  | { tipo: 'VAZIO' }
  | { tipo: 'INDISPONIVEL'; perdeuConta: boolean }
  | {
      tipo: 'CONTA';
      conta: ContaComercialUX;
      indice: number;
      total: number;
      anterior?: ContaComercialUX;
      proxima?: ContaComercialUX;
      proximas: readonly ContaComercialUX[];
    };

const TEXTO_HORIZONTE: Readonly<Record<HorizonteExecucaoUX, string>> = {
  AGORA: 'Agora',
  AGUARDANDO: 'Aguardando',
  PROGRAMADO: 'Programado',
  SEM_DESTAQUE: '',
};
const TOM_HORIZONTE: Readonly<Record<HorizonteExecucaoUX, 'bad' | 'warn' | 'info' | undefined>> = {
  AGORA: 'bad',
  AGUARDANDO: 'warn',
  PROGRAMADO: 'info',
  SEM_DESTAQUE: undefined,
};

// ---------------------------------------------------------------------------------------------------------------------
// Navegacao pura (a ordem recebida e a ordem do CM1-A: nada reordena aqui)
// ---------------------------------------------------------------------------------------------------------------------
/** Posicao do foco na fila; -1 quando a conta nao esta mais nela. */
export function indiceDoFocoUX(contas: readonly ContaComercialUX[], focoId: string | null): number {
  if (!focoId) return -1;
  return contas.findIndex((c) => c.itemId === focoId);
}

/** A conta em foco saiu da base? Usado so para INVALIDAR o foco — nunca para escolher outra. */
export function focoInvalidadoUX(contas: readonly ContaComercialUX[], focoId: string | null): boolean {
  return !!focoId && indiceDoFocoUX(contas, focoId) < 0;
}

/**
 * Entrada EXPLICITA no Modo Foco (clique na aba), e so ela:
 * - foco valido continua;
 * - sem foco valido, seleciona a primeira da fila.
 * Nunca chamar isto de dentro de um efeito continuo: viraria autoavanco.
 */
export function focoAoEntrarUX(contas: readonly ContaComercialUX[], focoAtual: string | null): string | null {
  if (focoAtual && indiceDoFocoUX(contas, focoAtual) >= 0) return focoAtual;
  return contas[0]?.itemId ?? null;
}

/** Vizinho anterior; `undefined` no primeiro item (a fila nunca faz loop). */
export function anteriorUX(contas: readonly ContaComercialUX[], indice: number): ContaComercialUX | undefined {
  return indice > 0 ? contas[indice - 1] : undefined;
}

/** Proximo vizinho; `undefined` no ultimo item (a fila nunca faz loop). */
export function proximaUX(contas: readonly ContaComercialUX[], indice: number): ContaComercialUX | undefined {
  return indice >= 0 && indice + 1 < contas.length ? contas[indice + 1] : undefined;
}

/** "Depois desta": as proximas contas NA ORDEM da fila. Sem sort, sem score, sem filtro. */
export function proximasContasUX(contas: readonly ContaComercialUX[], indice: number, maximo = MAXIMO_DEPOIS_DESTA_UX): readonly ContaComercialUX[] {
  if (indice < 0) return [];
  return contas.slice(indice + 1, indice + 1 + maximo);
}

/** Estado da tela a partir da fila e do foco. Nenhuma regra de negocio: so apresentacao. */
export function estadoModoFocoUX(contas: readonly ContaComercialUX[], foco: FocoTrabalhoUX): EstadoModoFocoUX {
  if (!contas.length) return { tipo: 'VAZIO' };
  const indice = indiceDoFocoUX(contas, foco.id);
  if (indice < 0) return { tipo: 'INDISPONIVEL', perdeuConta: !!foco.perdido };
  const conta = contas[indice];
  return {
    tipo: 'CONTA',
    conta,
    indice,
    total: contas.length,
    ...(anteriorUX(contas, indice) ? { anterior: anteriorUX(contas, indice) } : {}),
    ...(proximaUX(contas, indice) ? { proxima: proximaUX(contas, indice) } : {}),
    proximas: proximasContasUX(contas, indice),
  };
}

/**
 * Uma acao principal + ate uma secundaria, tiradas dos MESMOS descritores do Hoje:
 * principal = o marcado como primario, senao o primeiro; secundaria = o primeiro diferente da principal.
 * A ordem existente e preservada e nenhum handler novo e criado.
 */
export function acoesDoFocoUX(descritores: readonly AcaoFocoUX[]): { principal?: AcaoFocoUX; secundaria?: AcaoFocoUX } {
  const principal = descritores.find((a) => a.primario) ?? descritores[0];
  if (!principal) return {};
  const secundaria = descritores.find((a) => a !== principal);
  return { principal, ...(secundaria ? { secundaria } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------------------------------------------------
export interface ComercialModoFocoProps {
  /** Fila na ordem do CM1-A (a `base` do Hoje projetada pelo UX-0). */
  contas: readonly ContaComercialUX[];
  foco: FocoTrabalhoUX;
  nomeEmpresa: (empresaId: string) => string;
  nomeContato: (contatoId: string) => string;
  nomeCanal: (canal?: Canal) => string;
  /** Classe de prioridade do CM1-A, quando existir. */
  classeDaConta: (itemId: string) => string | undefined;
  /** Objetivo ja resolvido pelo Hoje: catalogo OBJETIVOS no plano de comunicacao, senao a explicacao do modo. */
  objetivoDaConta: (itemId: string) => string;
  /** Descritores do Hoje, ja filtrados por permissao. */
  acoes: (itemId: string) => readonly AcaoFocoUX[];
  /** CTA governado da cadencia (CM2-C -> CM2-E), montado pelo Hoje. */
  ctaCadencia: (itemId: string) => React.ReactNode;
  /** Troca explicita de foco (navegacao, "Depois desta"). Nunca chamado por acao comercial. */
  onFoco: (itemId: string) => void;
  onPorQue: (itemId: string) => void;
  onPanorama: () => void;
  /** Unico caminho que sai do estado de conta indisponivel, e so por clique. */
  onPrimeiraDisponivel: () => void;
}

export default function ComercialModoFoco(p: ComercialModoFocoProps) {
  const estado = estadoModoFocoUX(p.contas, p.foco);

  if (estado.tipo === 'VAZIO') {
    return (
      <Empty icone="hoje" titulo="Nenhuma conta nesta visão da fila" acao={<button className="btn" onClick={p.onPanorama}>Voltar ao Panorama</button>}>
        Ajuste os filtros acima ou volte ao Panorama: a fila é montada pela Máquina Comercial a partir do que acontece no Radar.
      </Empty>
    );
  }

  if (estado.tipo === 'INDISPONIVEL') {
    return (
      <Empty
        icone="hoje"
        titulo={estado.perdeuConta ? 'Esta conta não está mais nesta visão da fila' : 'Nenhuma conta em foco'}
        acao={
          <>
            <button className="btn primary" onClick={p.onPrimeiraDisponivel}>Ir para a primeira conta disponível</button>
            <button className="btn" onClick={p.onPanorama}>Voltar ao Panorama</button>
          </>
        }
      >
        {estado.perdeuConta
          ? 'A fila mudou e esta conta saiu desta visão. Nenhuma outra foi escolhida no lugar: a próxima conta é sempre uma escolha sua.'
          : 'Escolha por onde começar.'}
      </Empty>
    );
  }

  const { conta, indice, total, anterior, proxima, proximas } = estado;
  const { principal, secundaria } = acoesDoFocoUX(p.acoes(conta.itemId));
  const classe = p.classeDaConta(conta.itemId);
  const horizonte = TEXTO_HORIZONTE[conta.horizonte];

  const botao = (a: AcaoFocoUX, primario: boolean) =>
    a.to
      ? <Link key={a.id} to={a.to} className={`btn${primario ? ' primary' : ''}`}>{a.rotulo}</Link>
      : <button key={a.id} className={`btn${primario ? ' primary' : ''}`} onClick={a.onClick}>{a.rotulo}</button>;

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 16, alignItems: 'start' }}>
      <article className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="small muted">{indice + 1} de {total}</span>
          {horizonte && <Badge tone={TOM_HORIZONTE[conta.horizonte]}>{horizonte}</Badge>}
        </div>
        <h2 style={{ margin: '4px 0 0' }}>{p.nomeEmpresa(conta.empresaId)}</h2>
        {classe && <div className="small muted">classe {classe}</div>}

        <p style={{ margin: '12px 0 0' }}>{motivoDaContaUX(conta)}</p>

        <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '12px 0 0' }}>
          <dt className="muted">Com quem</dt>
          <dd style={{ margin: 0 }}>{conta.contato ? p.nomeContato(conta.contato.id) : <span className="muted">sem contato definido para este passo</span>}</dd>
          <dt className="muted">Canal</dt>
          <dd style={{ margin: 0 }}>{conta.contato?.canal ? p.nomeCanal(conta.contato.canal) : <span className="muted">—</span>}</dd>
          <dt className="muted">Objetivo</dt>
          <dd style={{ margin: 0 }}>{p.objetivoDaConta(conta.itemId) || <span className="muted">—</span>}</dd>
        </dl>

        <div className="actions" style={{ marginTop: 14 }}>
          {principal && botao(principal, true)}
          {secundaria && botao(secundaria, false)}
          {p.ctaCadencia(conta.itemId)}
          <button className="btn" onClick={() => p.onPorQue(conta.itemId)}>Por quê ›</button>
        </div>

        {/* navegacao: SO aqui o foco muda, e so por clique */}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
          <button className="btn sm" disabled={!anterior} onClick={() => anterior && p.onFoco(anterior.itemId)}>← Anterior</button>
          <button className="btn sm" disabled={!proxima} onClick={() => proxima && p.onFoco(proxima.itemId)}>Próxima conta →</button>
        </div>
      </article>

      <aside className="card">
        <h3 style={{ marginTop: 0 }}>Depois desta</h3>
        {proximas.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Esta é a última conta da fila com os filtros atuais.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {proximas.map((c, i) => (
              <li key={c.itemId}>
                <button className="btn sm" style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => p.onFoco(c.itemId)}>
                  <span className="muted">{indice + 2 + i}.</span>&nbsp;{p.nomeEmpresa(c.empresaId)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Na ordem da fila. Clicar só troca o foco.</p>
      </aside>
    </div>
  );
}
