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
import type { McFonte } from './workItem';

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

export const NOS: NoMapa[] = [...CAMADAS.map(noDaCamada), ...NOS_DESENVOLVIMENTO, ...NOS_COMERCIAL];

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
