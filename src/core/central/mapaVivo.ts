// Mapa Vivo — MODELO do grafo do Mission Control. Sem UI nesta wave (MC-LIVE-0): so o domnio.
//
// O que este modulo acrescenta ao Mission Control: ate aqui a arquitetura era uma LISTA (`CAMADAS`), e
// lista nao representa dependencia. Aqui a arquitetura vira GRAFO explicito: nos com papel e fonte de
// estado, e arestas com tipo. E isto que permite desenhar, na MC-LIVE-4:
//
//     EIFF Inbox -> Architect -> Dispatcher -> Factory -> W1/W2/W3 -> CI -> PR -> Aprovacao -> Producao
//
// sem que o desenho precise de manutencao manual: cada no declara de ONDE vem o seu estado (gates do
// repositorio, Factory, GitHub ou Maquina Comercial), e o estado vivo entra por normalizacao
// (src/core/central/workItem.ts). O desenho e uma projecao, nao um quadro que alguem atualiza.
//
// MIRO: este modelo NAO importa, NAO sincroniza e NAO reproduz quadro do Miro. O Miro nao e fonte de
// verdade nem dependencia; o objetivo e tornar desnecessario manter quadro paralelo.
//
// PUREZA: zero fetch, zero store, zero React. So dado e funcao total.
import { CAMADAS, GATES, type CamadaArquitetura } from './missionControl';
import type { McAtor, McFonte, MissionControlWorkItem } from './workItem';

export const DOMINIOS_MAPA = ['CENTRAL', 'DESENVOLVIMENTO', 'COMERCIAL'] as const;
export type DominioMapa = (typeof DOMINIOS_MAPA)[number];

export const ROTULO_DOMINIO: Readonly<Record<DominioMapa, string>> = {
  CENTRAL: 'EIFF Central',
  DESENVOLVIMENTO: 'Arquitetura e fábrica',
  COMERCIAL: 'Máquina Comercial',
};

/**
 * Tipos de aresta. Sao semanticamente diferentes e a tela precisa distinguir:
 *   fluxo       — A entrega para B no caminho normal (seta cheia).
 *   dependencia — B nao funciona sem A, mas A nao "passa" nada (seta tracejada).
 *   observa     — A apenas LE B. E a aresta do Mission Control: observar nunca e autoridade.
 *   evidencia   — A prova o estado de B (gate -> componente).
 */
export const TIPOS_ARESTA = ['fluxo', 'dependencia', 'observa', 'evidencia'] as const;
export type TipoAresta = (typeof TIPOS_ARESTA)[number];

export interface NoMapa {
  id: string;
  titulo: string;
  dominio: DominioMapa;
  papel: string;
  /** quando o no E uma camada da Central, o id da camada (a lista continua sendo a autoridade) */
  camadaId?: string;
  /** gates que dao o estado DE DESENHO do no (prontidao por evidencia no repositorio) */
  gates: string[];
  /** de onde vem o estado VIVO do no; sem fonte, o no so tem estado de desenho */
  fonte?: McFonte;
}

export interface ArestaMapa {
  de: string;
  para: string;
  tipo: TipoAresta;
  rotulo?: string;
}

// ------------------------------------------------------------------------------------------- nos

/** Os nos da Central sao derivados de CAMADAS: a lista continua sendo a autoridade, sem copia. */
const noDaCamada = (c: CamadaArquitetura): NoMapa => ({
  id: c.id,
  titulo: c.titulo,
  dominio: 'CENTRAL',
  papel: c.papel,
  camadaId: c.id,
  gates: c.gates,
});

/**
 * Nos do ciclo de desenvolvimento. Nao ha gate de Mission Control para "Dispatcher" ou "Worker" — eles
 * nao sao construcao da Central, sao a fabrica observada. Por isso `gates: []` e `fonte` preenchida: o
 * estado destes nos vem da Factory e do GitHub, nunca de curadoria.
 */
const NOS_DESENVOLVIMENTO: NoMapa[] = [
  { id: 'DEMANDA', titulo: 'Demanda', dominio: 'DESENVOLVIMENTO', papel: 'Necessidade registrada como issue no GitHub da fábrica (BACKLOG). A issue é a entidade canônica.', gates: [], fonte: 'GITHUB' },
  { id: 'ARCHITECT', titulo: 'Architect', dominio: 'DESENVOLVIMENTO', papel: 'Escreve o contrato, classifica risco e aprova a spec. Nunca escreve código nem faz merge.', gates: [], fonte: 'FACTORY' },
  { id: 'DISPATCHER', titulo: 'Dispatcher', dominio: 'DESENVOLVIMENTO', papel: 'Fila, leases, admissão, budget. Decide quando, nunca o quê.', gates: [], fonte: 'FACTORY' },
  { id: 'WORKER', titulo: 'Workers', dominio: 'DESENVOLVIMENTO', papel: 'Container efêmero: um job, código, testes, relatório. Não faz push nem abre PR.', gates: [], fonte: 'FACTORY' },
  { id: 'CI', titulo: 'Quality Gate (CI)', dominio: 'DESENVOLVIMENTO', papel: 'Testes, lint e build no head_sha. Evidência mecânica, não promessa.', gates: [], fonte: 'GITHUB' },
  { id: 'PR', titulo: 'Pull request', dominio: 'DESENVOLVIMENTO', papel: 'Branch publicada e revisão com evidência conferida.', gates: [], fonte: 'GITHUB' },
  { id: 'APROVACAO', titulo: 'Aprovação', dominio: 'DESENVOLVIMENTO', papel: 'GREEN: Architect. AMBER: Architect com justificativa. RED: Augusto. `main` é sempre humano.', gates: [], fonte: 'FACTORY' },
  { id: 'PRODUCAO', titulo: 'Produção', dominio: 'DESENVOLVIMENTO', papel: 'EIFF Control no ar. A fábrica nunca toca produção, banco ou segredo operacional.', gates: [], fonte: 'GITHUB' },
  { id: 'MISSION_CONTROL', titulo: 'Mission Control', dominio: 'DESENVOLVIMENTO', papel: 'Observa e projeta. Não escreve em nenhuma fonte.', gates: ['MISSION_CONTROL_LIVE', 'DEVELOPMENT_STATUS_ENDPOINT', 'GITHUB_ADAPTER_READONLY', 'FACTORY_ADAPTER_READONLY', 'WORK_ITEM_CORRELACAO', 'MAPA_VIVO', 'EXECUCAO_LIVE', 'MC_REALTIME', 'MC_DEGRADACAO', 'OBSERVABILIDADE'] },
];

const NOS_COMERCIAL: NoMapa[] = [
  { id: 'RADAR', titulo: 'Radar', dominio: 'COMERCIAL', papel: 'Empresas, contatos, sinais e score. Fonte de verdade em radar_*.', gates: [], fonte: 'COMMERCIAL' },
  { id: 'COMMERCIAL_QUEUE', titulo: 'Commercial Queue', dominio: 'COMERCIAL', papel: 'Fila derivada por regra pura. A ordem é dela, e o Mission Control não a altera.', gates: [], fonte: 'COMMERCIAL' },
];

/**
 * EIFF Inbox (PR #13, main 7e0aa61): no da Central que NAO e camada. Sem gate no catalogo e sem fonte viva na
 * resposta do endpoint — so estado de desenho. As duas arestas abaixo tem evidencia em codigo:
 * o webhook da Central entrega ChannelInboundEvent[] a `ingerirEventosCentral` (fronteiras.deEventoCentral) e a
 * RLS do Inbox espelha a MATRIZ do Control (`inbox_role` em 0056). Nada alem disso foi desenhado.
 */
const NOS_INBOX: NoMapa[] = [
  { id: 'INBOX', titulo: 'EIFF Inbox', dominio: 'CENTRAL', papel: 'Central de comunicação e atendimento: a thread é a unidade; recebe da EIFF Central, roteia por regras em dados e não envia nada (canal MANUAL).', gates: [] },
];

export const NOS: NoMapa[] = [...CAMADAS.map(noDaCamada), ...NOS_INBOX, ...NOS_DESENVOLVIMENTO, ...NOS_COMERCIAL];

export const noPorId = (id: string): NoMapa | undefined => NOS.find((n) => n.id === id);

// --------------------------------------------------------------------------------------- arestas

export const ARESTAS: ArestaMapa[] = [
  // --------------------------------------------------------------- EIFF Central (runtime da conversa)
  { de: 'META', para: 'WEBHOOK', tipo: 'fluxo', rotulo: 'evento assinado' },
  { de: 'WEBHOOK', para: 'IDENTIDADE', tipo: 'fluxo', rotulo: 'evento normalizado' },
  { de: 'IDENTIDADE', para: 'CONVERSA', tipo: 'fluxo', rotulo: 'pessoa e contexto' },
  { de: 'CONVERSA', para: 'ORQUESTRADOR', tipo: 'fluxo', rotulo: 'mensagem' },
  { de: 'ORQUESTRADOR', para: 'AGENTES', tipo: 'fluxo', rotulo: 'intenção e ação exigida' },
  { de: 'AGENTES', para: 'CONTROL', tipo: 'fluxo', rotulo: 'proposta (nunca escrita)' },
  { de: 'ORQUESTRADOR', para: 'CONTROL', tipo: 'dependencia', rotulo: 'matriz de permissões' },
  { de: 'CONTROL', para: 'AUDITORIA', tipo: 'fluxo', rotulo: 'ator, antes e depois' },
  { de: 'IDENTIDADE', para: 'CONTROL', tipo: 'dependencia', rotulo: 'papel e organização vêm do banco' },
  { de: 'AUDITORIA', para: 'META', tipo: 'observa', rotulo: 'saúde do canal' },
  // EIFF Inbox — só as duas relações provadas em código (ver NOS_INBOX)
  { de: 'WEBHOOK', para: 'INBOX', tipo: 'fluxo', rotulo: 'ChannelInboundEvent + conteúdo → inbox_ingest' },
  { de: 'CONTROL', para: 'INBOX', tipo: 'dependencia', rotulo: 'RLS espelha a matriz de permissões (inbox_role)' },

  // ------------------------------------------------------- ciclo de desenvolvimento (demanda -> prod)
  { de: 'DEMANDA', para: 'ARCHITECT', tipo: 'fluxo', rotulo: 'BACKLOG' },
  { de: 'ARCHITECT', para: 'DISPATCHER', tipo: 'fluxo', rotulo: 'ARCH_APPROVED' },
  { de: 'DISPATCHER', para: 'WORKER', tipo: 'fluxo', rotulo: 'lease (READY → CLAIMED)' },
  { de: 'WORKER', para: 'PR', tipo: 'fluxo', rotulo: 'relatório verde → push e PR' },
  { de: 'PR', para: 'CI', tipo: 'fluxo', rotulo: 'check run no head_sha' },
  { de: 'CI', para: 'APROVACAO', tipo: 'fluxo', rotulo: 'CI verde → ARCH_REVIEW' },
  { de: 'APROVACAO', para: 'PRODUCAO', tipo: 'fluxo', rotulo: 'merge humano em main' },
  { de: 'ARCHITECT', para: 'APROVACAO', tipo: 'dependencia', rotulo: 'decisão com evidência conferida' },
  { de: 'MISSION_CONTROL', para: 'DISPATCHER', tipo: 'observa', rotulo: '/api/factory/status (read-only)' },
  { de: 'MISSION_CONTROL', para: 'WORKER', tipo: 'observa', rotulo: 'estado operacional' },
  { de: 'MISSION_CONTROL', para: 'CI', tipo: 'observa', rotulo: 'check runs' },
  { de: 'MISSION_CONTROL', para: 'PR', tipo: 'observa', rotulo: 'PRs abertos' },
  { de: 'MISSION_CONTROL', para: 'DEMANDA', tipo: 'observa', rotulo: 'issues desde BACKLOG' },
  { de: 'PRODUCAO', para: 'CONTROL', tipo: 'dependencia', rotulo: 'é o EIFF Control no ar' },

  // ----------------------------------------------------------------------------- Máquina Comercial
  { de: 'RADAR', para: 'COMMERCIAL_QUEUE', tipo: 'fluxo', rotulo: 'projeção pura' },
  { de: 'MISSION_CONTROL', para: 'COMMERCIAL_QUEUE', tipo: 'observa', rotulo: 'só conta; não reordena' },

  // ---------------------------------------------------------------------------- evidência dos gates
  { de: 'AUDITORIA', para: 'MISSION_CONTROL', tipo: 'evidencia', rotulo: 'prontidão por gate' },
];

// ------------------------------------------------------------------------------------- consultas

export const arestasDe = (id: string): ArestaMapa[] => ARESTAS.filter((a) => a.de === id);
export const arestasPara = (id: string): ArestaMapa[] => ARESTAS.filter((a) => a.para === id);

/** Dependencias diretas de um no: quem precisa estar de pe antes dele (fluxo e dependencia). */
export const dependenciasDe = (id: string): string[] =>
  arestasPara(id).filter((a) => a.tipo === 'fluxo' || a.tipo === 'dependencia').map((a) => a.de);

/**
 * Ciclos entre nos considerando SO as arestas que implicam ordem (fluxo e dependencia).
 * `observa` e `evidencia` podem apontar para tras de proposito — observar nao cria ordem.
 * Devolve os nos envolvidos em ciclo; vazio significa grafo acclico.
 */
export function ciclosDoMapa(): string[] {
  const adj = new Map<string, string[]>();
  for (const n of NOS) adj.set(n.id, []);
  for (const a of ARESTAS) {
    if (a.tipo !== 'fluxo' && a.tipo !== 'dependencia') continue;
    adj.get(a.de)?.push(a.para);
  }
  const estado = new Map<string, 0 | 1 | 2>();
  const emCiclo = new Set<string>();
  const visitar = (id: string, pilha: string[]): void => {
    estado.set(id, 1);
    for (const p of adj.get(id) ?? []) {
      if (estado.get(p) === 1) { for (const x of [...pilha.slice(pilha.indexOf(p)), id]) emCiclo.add(x); continue; }
      if (!estado.get(p)) visitar(p, [...pilha, id]);
    }
    estado.set(id, 2);
  };
  for (const n of NOS) if (!estado.get(n.id)) visitar(n.id, []);
  return [...emCiclo];
}

/** Gates citados por nos do mapa que nao existem no catalogo. Vazio e a condicao saudavel. */
export const gatesDesconhecidosNoMapa = (): string[] => {
  const conhecidos = new Set(GATES.map((g) => g.id));
  return [...new Set(NOS.flatMap((n) => n.gates).filter((g) => !conhecidos.has(g)))];
};

// ------------------------------------------------------------------- estado vivo por no (MC-CONSTRUCTION-1)

/**
 * Quais itens vivos "estao" em cada no. A regra usa SO dado normalizado que ja existe no item:
 *   - nos da fabrica: `responsavel.tipo` (quem esta com a bola, derivado de ATOR_POR_ESTADO_FACTORY);
 *   - PR: `source = 'GITHUB'`; DEMANDA: `source = 'ARCHITECTURE'` (issue sem estado de job).
 * Nenhum titulo e lido, nada e inferido: no fora desta tabela nao tem item vivo — e a tela diz isso.
 */
export const ATORES_DO_NO: Readonly<Record<string, readonly McAtor[]>> = {
  ARCHITECT: ['ARCHITECT'],
  DISPATCHER: ['DISPATCHER'],
  WORKER: ['WORKER', 'SUPERVISOR'],
  APROVACAO: ['HUMAN', 'INTEGRATOR'],
};

export const FONTE_DO_NO: Readonly<Record<string, McFonte>> = { PR: 'GITHUB', DEMANDA: 'ARCHITECTURE' };

export function itensDoNo(id: string, itens: readonly MissionControlWorkItem[]): MissionControlWorkItem[] {
  const atores = ATORES_DO_NO[id];
  if (atores) return itens.filter((i) => i.source === 'FACTORY' && !!i.responsavel && atores.includes(i.responsavel.tipo));
  const fonte = FONTE_DO_NO[id];
  if (fonte) return itens.filter((i) => i.source === fonte);
  return [];
}

/** O no tem como receber item vivo pela regra acima. Falso = so estado de desenho (gates) ou nenhum. */
export const noRecebeItensVivos = (id: string): boolean => id in ATORES_DO_NO || id in FONTE_DO_NO;

// ------------------------------------------------------------------------------- layout deterministico

export interface PosicaoNo { id: string; dominio: DominioMapa; coluna: number; linha: number; x: number; y: number }
export interface LayoutMapa {
  nos: PosicaoNo[];
  /** faixas horizontais, uma por dominio, na ordem de DOMINIOS_MAPA */
  faixas: { dominio: DominioMapa; y: number; altura: number }[];
  largura: number;
  altura: number;
  largNo: number;
  altNo: number;
}

/**
 * Camada de cada no = caminho mais longo a partir das fontes, contando so arestas que implicam ordem
 * (fluxo e dependencia). O grafo e aciclico nessas arestas (invariante testada), entao o calculo termina.
 */
export function camadasDoMapa(): Map<string, number> {
  const entrada = new Map<string, string[]>();
  for (const n of NOS) entrada.set(n.id, []);
  for (const a of ARESTAS) if (a.tipo === 'fluxo' || a.tipo === 'dependencia') entrada.get(a.para)?.push(a.de);
  const memo = new Map<string, number>();
  const camada = (id: string, pilha: Set<string>): number => {
    const m = memo.get(id);
    if (m !== undefined) return m;
    if (pilha.has(id)) return 0; // defesa: ciclo nunca deveria existir aqui
    pilha.add(id);
    const pais = entrada.get(id) ?? [];
    const v = pais.length === 0 ? 0 : 1 + Math.max(...pais.map((p) => camada(p, pilha)));
    pilha.delete(id);
    memo.set(id, v);
    return v;
  };
  for (const n of NOS) camada(n.id, new Set());
  return memo;
}

/**
 * Posicoes em pixels, uma faixa por dominio, colunas compactadas dentro da faixa (ranking denso das camadas
 * globais presentes no dominio). Mesma entrada, mesma saida: a tela nao treme entre renders.
 */
export function layoutDoMapa(opts: { largNo?: number; altNo?: number; gapX?: number; gapY?: number; margem?: number; faixaTitulo?: number } = {}): LayoutMapa {
  const largNo = opts.largNo ?? 172;
  const altNo = opts.altNo ?? 62;
  const gapX = opts.gapX ?? 44;
  const gapY = opts.gapY ?? 12;
  const margem = opts.margem ?? 16;
  const faixaTitulo = opts.faixaTitulo ?? 26;
  const camadas = camadasDoMapa();
  const nos: PosicaoNo[] = [];
  const faixas: LayoutMapa['faixas'] = [];
  let y = margem;
  let maxColuna = 0;
  for (const dominio of DOMINIOS_MAPA) {
    const doDominio = NOS.filter((n) => n.dominio === dominio);
    if (doDominio.length === 0) continue;
    // coluna = posicao da camada global entre as camadas DISTINTAS do dominio (ranking denso): a ordem entre
    // os nos do dominio e preservada e nenhuma coluna fica vazia por causa de uma dependencia de outro dominio
    const distintas = [...new Set(doDominio.map((n) => camadas.get(n.id) ?? 0))].sort((a, b) => a - b);
    const porColuna = new Map<number, number>();
    const inicio = y + faixaTitulo;
    let linhas = 0;
    for (const n of doDominio) {
      const coluna = distintas.indexOf(camadas.get(n.id) ?? 0);
      const linha = porColuna.get(coluna) ?? 0;
      porColuna.set(coluna, linha + 1);
      linhas = Math.max(linhas, linha + 1);
      maxColuna = Math.max(maxColuna, coluna);
      nos.push({ id: n.id, dominio, coluna, linha, x: margem + coluna * (largNo + gapX), y: inicio + linha * (altNo + gapY) });
    }
    const altura = faixaTitulo + linhas * (altNo + gapY) - gapY + margem;
    faixas.push({ dominio, y, altura });
    y += altura + margem;
  }
  return { nos, faixas, largura: margem * 2 + (maxColuna + 1) * (largNo + gapX) - gapX, altura: y, largNo, altNo };
}
