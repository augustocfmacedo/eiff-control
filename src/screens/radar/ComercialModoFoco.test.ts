// Commercial UX 1.0 — UX-3: Modo Foco.
//
// A regra que esta suite existe para prender: AÇÃO != PRÓXIMA CONTA. Nenhum caminho que execute um CTA comercial
// pode trocar o foco, e nenhuma conta e escolhida automaticamente quando a que estava em foco sai da fila.
// As provas sao de tres tipos: funcoes puras de navegacao, render em memoria (`renderToStaticMarkup`, sem DOM) e
// guardas estaticas sobre o codigo do Hoje (a autoridade das acoes e da fila continua la).
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE } from '../../core/radar/cadenciaParidadeCM.fixtures';
import { planosDaFilaCM } from '../../core/radar/commercialActionPlan';
import { cadenciasDaFilaCM } from '../../core/radar/commercialCadence';
import { sugestoesTarefaDaFilaCM } from '../../core/radar/commercialCadenceTask';
import { construirCommercialQueue } from '../../core/radar/commercialMachine';
import type { RadarDataset } from '../../core/radar/types';
import ComercialModoFoco, {
  MAXIMO_DEPOIS_DESTA_UX, acoesDoFocoUX, anteriorUX, estadoModoFocoUX, focoAoEntrarUX, focoInvalidadoUX,
  indiceDoFocoUX, proximaUX, proximasContasUX, type AcaoFocoUX, type ComercialModoFocoProps, type FocoTrabalhoUX,
} from './ComercialModoFoco';
import { visaoComercialUX, type ContaComercialUX } from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
/** Conta sintetica: so view-model do UX-0, para exercitar navegacao com uma fila de tamanho controlado. */
function conta(n: number, extra: Partial<ContaComercialUX> = {}): ContaComercialUX {
  return {
    itemId: `item-${n}`, empresaId: `empresa-${n}`, posicao: n, horizonte: 'AGORA',
    motivo: { codigo: 'SINAL_ACIONAVEL_NOVO', texto: `motivo ${n}` }, modo: 'CONTATO',
    sugestao: { estado: 'NAO_APLICAVEL' }, excecoes: [], ...extra,
  };
}
const FILA6 = [1, 2, 3, 4, 5, 6].map((n) => conta(n));
const sem = (contas: readonly ContaComercialUX[], id: string) => contas.filter((c) => c.itemId !== id);

function contasReais(ds: RadarDataset): ContaComercialUX[] {
  const fila = construirCommercialQueue(ds, HOJE);
  const planos = planosDaFilaCM(ds, fila);
  const cadencias = cadenciasDaFilaCM(ds, fila, planos, HOJE);
  const sugestoes = sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, HOJE);
  return visaoComercialUX(fila.itens.map((item, i) => ({ item, plano: planos[i], cadencia: cadencias[i], sugestao: sugestoes[i] })));
}
const REAIS = CASOS.flatMap((c) => contasReais(c.ds));
const REAL_COM_CONTATO = REAIS.find((c) => !!c.contato)!;

const DESCRITORES: AcaoFocoUX[] = [
  { id: 'Registrar atividade', rotulo: 'Registrar atividade', onClick: () => {} },
  { id: 'Preparar abordagem', rotulo: 'Preparar abordagem', primario: true, onClick: () => {} },
  { id: 'Agendar tarefa', rotulo: 'Agendar tarefa', onClick: () => {} },
];

function props(contas: readonly ContaComercialUX[], foco: FocoTrabalhoUX, extra: Partial<ComercialModoFocoProps> = {}): ComercialModoFocoProps {
  return {
    contas, foco,
    nomeEmpresa: (id) => `Empresa ${id}`,
    nomeContato: (id) => `Contato ${id}`,
    nomeCanal: (canal) => (canal ? `canal ${canal}` : ''),
    classeDaConta: () => 'A',
    objetivoDaConta: () => 'Obter indicação',
    acoes: () => DESCRITORES,
    ctaCadencia: () => null,
    onFoco: () => { throw new Error('foco nao muda sozinho'); },
    onPorQue: () => {},
    onPanorama: () => {},
    onPrimeiraDisponivel: () => { throw new Error('so por clique'); },
    ...extra,
  };
}
const html = (p: ComercialModoFocoProps) => renderToStaticMarkup(React.createElement(ComercialModoFoco, p));

/** Texto plano de um no da arvore React (para achar o botao pelo rotulo, sem DOM). */
function texto(no: unknown): string {
  if (no === null || no === undefined || typeof no === 'boolean') return '';
  if (typeof no === 'string' || typeof no === 'number') return String(no);
  if (Array.isArray(no)) return no.map(texto).join('');
  const e = no as { props?: { children?: unknown } };
  return e.props ? texto(e.props.children) : '';
}
/** Percorre a arvore renderizada e devolve os <button>/<a> com seus props (onClick, disabled, href). */
function botoes(p: ComercialModoFocoProps): { rotulo: string; onClick?: () => void; disabled?: boolean }[] {
  const achados: { rotulo: string; onClick?: () => void; disabled?: boolean }[] = [];
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) { no.forEach(visitar); return; }
    if (!no || typeof no !== 'object') return;
    const e = no as { type?: unknown; props?: Record<string, unknown> };
    if (!e.props) return;
    if (e.type === 'button' || e.type === 'a') {
      achados.push({ rotulo: texto(e).trim(), onClick: e.props.onClick as (() => void) | undefined, disabled: e.props.disabled as boolean | undefined });
    }
    visitar(e.props.children);
  };
  visitar((ComercialModoFoco as (props: ComercialModoFocoProps) => unknown)(p));
  return achados;
}
const clicar = (p: ComercialModoFocoProps, rotulo: string) => {
  const alvo = botoes(p).find((b) => b.rotulo.includes(rotulo));
  if (!alvo) throw new Error(`botao nao encontrado: ${rotulo}`);
  alvo.onClick?.();
  return alvo;
};
/** Descritores com espiao: registram se a acao comercial foi executada. */
function descritoresEspiao() {
  const executadas: string[] = [];
  const lista: AcaoFocoUX[] = DESCRITORES.map((a) => ({ ...a, onClick: () => executadas.push(a.id) }));
  return { lista, executadas };
}

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO_FOCO = semComentarios(leia('ComercialModoFoco.tsx'));
const CODIGO_HOJE = semComentarios(leia('Hoje.tsx'));
/** Trecho do Hoje que monta o Modo Foco (props do componente). */
const BLOCO_FOCO_NO_HOJE = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('<ComercialModoFoco'), CODIGO_HOJE.indexOf('</div>', CODIGO_HOJE.indexOf('<ComercialModoFoco')));

// ---------------------------------------------------------------------------------------------------------------------
// Entrada e abas
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — entrada no Modo Foco', () => {
  it('a aba existe, na ordem pedida, e o Panorama continua sendo o default', () => {
    expect(CODIGO_HOJE).toContain("label: 'Trabalhar a fila'");
    const abas = ['Panorama', 'Trabalhar a fila', 'Fila completa'].map((r) => CODIGO_HOJE.indexOf(r));
    expect(abas[0]).toBeLessThan(abas[1]);
    expect(abas[1]).toBeLessThan(abas[2]);
    expect(CODIGO_HOJE).toContain("useState<VisaoComercial>('panorama')");
    expect(CODIGO_HOJE).not.toContain("useState<VisaoComercial>('foco')");
  });

  it('entrada sem foco valido seleciona a primeira da fila', () => {
    expect(focoAoEntrarUX(FILA6, null)).toBe('item-1');
    expect(focoAoEntrarUX(FILA6, 'item-inexistente')).toBe('item-1');
  });

  it('entrada com foco valido preserva o foco', () => {
    expect(focoAoEntrarUX(FILA6, 'item-4')).toBe('item-4');
  });

  it('fila vazia na entrada nao inventa foco', () => {
    expect(focoAoEntrarUX([], null)).toBeNull();
  });

  it('a selecao da primeira so acontece na troca EXPLICITA de visao, nunca num efeito continuo', () => {
    expect(CODIGO_HOJE).toContain('const trocarVisao = (v: VisaoComercial) => {');
    const chamadas = CODIGO_HOJE.match(/focoAoEntrarUX\(/g) ?? [];
    expect(chamadas).toHaveLength(1);
    const efeitos = CODIGO_HOJE.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const e of efeitos) expect(e).not.toContain('focoAoEntrarUX');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fonte da fila
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — fonte da fila', () => {
  it('o Hoje passa ao Modo Foco as contas de `base` (contasUX), nao `visiveis`', () => {
    expect(BLOCO_FOCO_NO_HOJE).toContain('contas={contasUX}');
    expect(BLOCO_FOCO_NO_HOJE).not.toContain('visiveis');
    expect(CODIGO_HOJE).toContain('visaoComercialUX(base.map(');
  });

  it('o componente nao conhece `visiveis` nem o filtro de categoria', () => {
    expect(CODIGO_FOCO).not.toContain('visiveis');
    expect(CODIGO_FOCO).not.toContain('categoria');
  });

  it('o filtro de categoria continua pertencendo a Fila completa', () => {
    expect(CODIGO_HOJE).toContain('const visiveis = categoria === ');
    const trechoFoco = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf("visao === 'foco'"), CODIGO_HOJE.indexOf('<KpiStrip'));
    expect(trechoFoco).not.toContain('setCategoria');
  });

  it('nenhuma fila nova e construida no Modo Foco', () => {
    for (const proibido of ['construirCommercialQueue', 'filaHoje', 'planosDaFilaCM', 'cadenciasDaFilaCM']) expect(CODIGO_FOCO).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Ordem e navegacao
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — ordem da fila e navegacao explicita', () => {
  it('a primeira conta e base[0] e a ordem recebida e preservada', () => {
    const e = estadoModoFocoUX(FILA6, { id: 'item-1', perdido: null });
    expect(e.tipo === 'CONTA' && e.indice).toBe(0);
    expect(e.tipo === 'CONTA' && e.conta.itemId).toBe('item-1');
    expect(e.tipo === 'CONTA' && e.total).toBe(6);
  });

  it('proxima = base[indice + 1] e anterior = base[indice - 1]', () => {
    expect(proximaUX(FILA6, 2)?.itemId).toBe('item-4');
    expect(anteriorUX(FILA6, 2)?.itemId).toBe('item-2');
  });

  it('o ultimo nao volta para o primeiro e o primeiro nao vai para o ultimo (sem loop)', () => {
    expect(proximaUX(FILA6, FILA6.length - 1)).toBeUndefined();
    expect(anteriorUX(FILA6, 0)).toBeUndefined();
    const ultimo = estadoModoFocoUX(FILA6, { id: 'item-6', perdido: null });
    expect(ultimo.tipo === 'CONTA' && ultimo.proxima).toBeUndefined();
    const primeiro = estadoModoFocoUX(FILA6, { id: 'item-1', perdido: null });
    expect(primeiro.tipo === 'CONTA' && primeiro.anterior).toBeUndefined();
  });

  it('nos extremos os botoes ficam desabilitados, em vez de dar a volta', () => {
    const noPrimeiro = html(props(FILA6, { id: 'item-1', perdido: null }));
    expect(noPrimeiro).toMatch(/<button[^>]*disabled[^>]*>← Anterior<\/button>/);
    expect(noPrimeiro).not.toMatch(/<button[^>]*disabled[^>]*>Próxima conta →<\/button>/);
    const noUltimo = html(props(FILA6, { id: 'item-6', perdido: null }));
    expect(noUltimo).toMatch(/<button[^>]*disabled[^>]*>Próxima conta →<\/button>/);
  });

  it('o indice e derivado do itemId; a identidade persistida nunca e a posicao', () => {
    expect(indiceDoFocoUX(FILA6, 'item-5')).toBe(4);
    expect(indiceDoFocoUX(FILA6, null)).toBe(-1);
    expect(CODIGO_HOJE).toContain('const [focoTrabalhoId, setFocoTrabalhoId] = useState<string | null>(null);');
    expect(CODIGO_HOJE).not.toContain('useState<number>(0)');
    expect(CODIGO_FOCO).toContain('c.itemId === focoId');
  });

  it('remover uma conta ANTES do foco nao muda a conta em foco (identidade, nao posicao)', () => {
    const menor = sem(FILA6, 'item-2');
    const e = estadoModoFocoUX(menor, { id: 'item-4', perdido: null });
    expect(e.tipo === 'CONTA' && e.conta.itemId).toBe('item-4');
    expect(e.tipo === 'CONTA' && e.indice).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Card compacto
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — card compacto', () => {
  const p = props([REAL_COM_CONTATO, ...FILA6], { id: REAL_COM_CONTATO.itemId, perdido: null });
  const saida = html(p);

  it('mostra posicao, empresa e classe', () => {
    expect(saida).toContain('1 de 7');
    expect(saida).toContain(`Empresa ${REAL_COM_CONTATO.empresaId}`);
    expect(saida).toContain('classe A');
  });

  it('mostra o fato do motor (motivoDaContaUX), sem narrativa nova', () => {
    expect(saida).toContain(REAL_COM_CONTATO.motivo.texto);
    expect(CODIGO_FOCO).toContain('motivoDaContaUX');
  });

  it('mostra contato, canal e objetivo vindos do plano', () => {
    expect(saida).toContain(`Contato ${REAL_COM_CONTATO.contato!.id}`);
    expect(saida).toContain('Obter indicação');
    if (REAL_COM_CONTATO.contato?.canal) expect(saida).toContain(`canal ${REAL_COM_CONTATO.contato.canal}`);
  });

  it('sem contato no plano, diz que nao ha — nunca escolhe outro contato', () => {
    const semContato = html(props(FILA6, { id: 'item-1', perdido: null }));
    expect(semContato).toContain('sem contato definido para este passo');
    expect(CODIGO_FOCO).not.toContain('contatos.find');
    expect(CODIGO_FOCO).not.toContain('?? contatos');
  });

  it('mostra o horizonte do UX-0 e nao cria urgencia nova', () => {
    expect(saida).toContain('Agora');
    expect(CODIGO_FOCO).not.toContain('urgente');
    expect(CODIGO_FOCO).not.toContain('score');
  });
});

describe('UX-3 — campos proibidos na primeira camada', () => {
  const saida = html(props([REAL_COM_CONTATO], { id: REAL_COM_CONTATO.itemId, perdido: null }));
  it.each([
    ['score', /score/i],
    ['decision fit', /decision fit|fit\s*\d/i],
    ['playbook', /playbook/i],
    ['versao de regra', /CM1-|CM2-|versão de regras|versao de regras/i],
    ['chave tecnica', /chaveQueDecide|itemId|payload/i],
  ])('nao expoe %s', (_nome, re) => {
    expect(saida).not.toMatch(re);
  });

  it('o codigo do componente nao renderiza metadados tecnicos', () => {
    for (const proibido of ['PLAYBOOKS', 'VERSAO_REGRAS', 'decisionFit', 'chaveQueDecideCM', 'historico', 'tentativas']) {
      expect(CODIGO_FOCO).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acoes
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — acoes vem dos descritores do Hoje', () => {
  it('principal = o descritor primario; secundaria = o primeiro diferente dela, na ordem existente', () => {
    const { principal, secundaria } = acoesDoFocoUX(DESCRITORES);
    expect(principal?.id).toBe('Preparar abordagem');
    expect(secundaria?.id).toBe('Registrar atividade');
  });

  it('sem primario marcado, a principal e a primeira da lista', () => {
    const lista: AcaoFocoUX[] = [{ id: 'a', rotulo: 'A' }, { id: 'b', rotulo: 'B' }];
    expect(acoesDoFocoUX(lista).principal?.id).toBe('a');
    expect(acoesDoFocoUX(lista).secundaria?.id).toBe('b');
  });

  it('um unico descritor nao produz secundaria; lista vazia nao produz nenhuma', () => {
    expect(acoesDoFocoUX([{ id: 'a', rotulo: 'A' }]).secundaria).toBeUndefined();
    expect(acoesDoFocoUX([])).toEqual({});
  });

  it('no maximo duas acoes aparecem, mesmo com tres descritores', () => {
    const saida = html(props(FILA6, { id: 'item-1', perdido: null }));
    expect(saida).toContain('Preparar abordagem');
    expect(saida).toContain('Registrar atividade');
    expect(saida).not.toContain('Agendar tarefa');
  });

  it('nenhuma acao sintetica: o componente so renderiza rotulos recebidos', () => {
    expect(CODIGO_FOCO).not.toContain('setAbordagem');
    expect(CODIGO_FOCO).not.toContain('setAtividade');
    expect(CODIGO_FOCO).not.toContain('actions.');
    expect(CODIGO_FOCO).not.toContain('novaTarefa');
  });

  it('o `switch (plano.modo)` continua existindo SO no Hoje', () => {
    expect(CODIGO_FOCO).not.toMatch(/switch\s*\(\s*\w*\.?modo\s*\)/);
    expect(CODIGO_FOCO).not.toContain('plano.modo');
    expect((CODIGO_HOJE.match(/switch \(plano\.modo\)/g) ?? [])).toHaveLength(1);
  });

  it('a Fila completa continua mostrando todas as acoes', () => {
    expect(CODIGO_HOJE).toContain('acoes={acoes(foco)}');
    expect(CODIGO_HOJE).toContain('opcoes.primeira ? [disponiveis.find((a) => a.primario) ?? disponiveis[0]].filter');
  });

  it('o Hoje passa ao foco os MESMOS descritores filtrados por permissao', () => {
    expect(CODIGO_HOJE).toContain('function acoesDisponiveis(linha: Linha): AcaoItemUX[] {');
    expect(CODIGO_HOJE).toContain('acoesDoItem(linha).filter((a) => !!a.to || podeAgir)');
    expect(BLOCO_FOCO_NO_HOJE).toContain('acoesDisponiveis(l)');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Cadencia e Por que
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — cadencia e explicacao reutilizam as autoridades existentes', () => {
  it('o CTA de cadencia vem pronto do Hoje (CM2-C -> CM2-E), sem persistencia direta', () => {
    expect(BLOCO_FOCO_NO_HOJE).toContain('ctaCadenciaDe(l)');
    expect(CODIGO_FOCO).not.toContain('ctaCadenciaCM');
    expect(CODIGO_FOCO).not.toContain('criarTarefaDaCadenciaCM');
    expect(CODIGO_FOCO).not.toContain('salvarTarefaRadar');
    expect(CODIGO_HOJE).toContain('abrirAgendamentoCM(cadencia, sugestao)');
  });

  it('o CTA recebido e renderizado como veio', () => {
    const cta = React.createElement('button', null, 'Agendar próxima ação');
    const saida = html(props(FILA6, { id: 'item-1', perdido: null }, { ctaCadencia: () => cta }));
    expect(saida).toContain('Agendar próxima ação');
  });

  it('"Por quê ›" usa a gaveta do UX-2.1, sem criar segunda explicacao', () => {
    let pedido: string | null = null;
    const saida = html(props(FILA6, { id: 'item-3', perdido: null }, { onPorQue: (id) => { pedido = id; } }));
    expect(saida).toContain('Por quê ›');
    expect(BLOCO_FOCO_NO_HOJE).toContain('onPorQue={setPorQue}');
    expect(CODIGO_FOCO).not.toContain('Modal');
    expect(CODIGO_FOCO).not.toContain('ComercialFoco');
    expect(pedido).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Depois desta
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — "Depois desta"', () => {
  it('mostra no maximo 4 contas, exatamente slice(indice + 1, indice + 5)', () => {
    expect(MAXIMO_DEPOIS_DESTA_UX).toBe(4);
    const proximas = proximasContasUX(FILA6, 0);
    expect(proximas.map((c) => c.itemId)).toEqual(['item-2', 'item-3', 'item-4', 'item-5']);
    expect(proximas).toHaveLength(4);
  });

  it('preserva a ordem da fila e nao ordena por nada', () => {
    expect(proximasContasUX(FILA6, 1).map((c) => c.posicao)).toEqual([3, 4, 5, 6]);
    expect(CODIGO_FOCO).not.toContain('.sort(');
    expect(CODIGO_FOCO).not.toContain('reverse()');
  });

  it('perto do fim mostra menos de 4, e no ultimo nao mostra nenhuma', () => {
    expect(proximasContasUX(FILA6, 4).map((c) => c.itemId)).toEqual(['item-6']);
    expect(proximasContasUX(FILA6, 5)).toEqual([]);
    expect(html(props(FILA6, { id: 'item-6', perdido: null }))).toContain('Esta é a última conta da fila');
  });

  it('cada item e clicavel e o clique SO troca o foco', () => {
    const cliques: string[] = [];
    const p = props(FILA6, { id: 'item-1', perdido: null }, { onFoco: (id) => cliques.push(id) });
    const saida = html(p);
    expect(saida).toContain('Empresa empresa-2');
    expect(saida).toContain('Empresa empresa-5');
    expect(saida).not.toContain('Empresa empresa-6');
    // o clique renderizado chama apenas onFoco: nenhum CTA comercial e ligado ali
    const lista = saida.slice(saida.indexOf('Depois desta'));
    for (const rotulo of ['Preparar abordagem', 'Registrar atividade', 'Por quê']) expect(lista).not.toContain(rotulo);
    expect(cliques).toEqual([]);
  });

  it('o bloco nao se chama "recomendadas" nem promete ranking', () => {
    const saida = html(props(FILA6, { id: 'item-1', perdido: null }));
    expect(saida).toContain('Depois desta');
    expect(saida).not.toMatch(/recomendad/i);
    expect(saida).toContain('Na ordem da fila');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Conta que sai da base
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — a conta saiu da fila', () => {
  it('nao ha auto-fallback em lugar nenhum', () => {
    expect(CODIGO_FOCO).not.toMatch(/\?\?\s*contas\[0\]/);
    expect(CODIGO_HOJE).not.toMatch(/\?\?\s*base\[0\]/);
    expect(CODIGO_HOJE).not.toMatch(/\?\?\s*contasUX\[0\]/);
    expect(CODIGO_FOCO).not.toContain('contas.find(');
  });

  it('o efeito do Hoje so INVALIDA o foco; nunca seleciona outra conta', () => {
    const efeito = (CODIGO_HOJE.match(/useEffect\(\(\) => \{[^]*?focoInvalidadoUX[^]*?\}, \[[^\]]*\]\);/) ?? [''])[0];
    expect(efeito).toContain('focoInvalidadoUX(contasUX, focoTrabalhoId)');
    expect(efeito).toContain('setFocoPerdido(focoTrabalhoId); setFocoTrabalhoId(null);');
    expect(efeito).not.toContain('contasUX[0]');
    expect(efeito).not.toContain('focoAoEntrarUX');
  });

  it('estado neutro quando a conta saiu, com as duas saidas explicitas', () => {
    const saida = html(props(sem(FILA6, 'item-3'), { id: null, perdido: 'item-3' }));
    expect(saida).toContain('Esta conta não está mais nesta visão da fila');
    expect(saida).toContain('Ir para a primeira conta disponível');
    expect(saida).toContain('Voltar ao Panorama');
    expect(saida).not.toContain('Empresa empresa-1');
  });

  it('a conta que volta para a fila NAO reassume o foco sozinha', () => {
    const e = estadoModoFocoUX(FILA6, { id: null, perdido: 'item-3' });
    expect(e.tipo).toBe('INDISPONIVEL');
  });

  it('so o clique explicito escolhe a primeira disponivel', () => {
    expect(CODIGO_HOJE).toContain('const irParaPrimeiraDisponivel = () => { const c = contasUX[0]; if (c) { setFocoTrabalhoId(c.itemId); setFocoPerdido(null); } };');
    expect(BLOCO_FOCO_NO_HOJE).toContain('onPrimeiraDisponivel={irParaPrimeiraDisponivel}');
  });

  it('fila vazia mostra o empty state, e nao o estado de conta indisponivel', () => {
    const saida = html(props([], { id: null, perdido: 'item-3' }));
    expect(saida).toContain('Nenhuma conta nesta visão da fila');
    expect(saida).toContain('Voltar ao Panorama');
    expect(saida).not.toContain('Ir para a primeira conta disponível');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Teste operacional critico: AÇÃO != PRÓXIMA CONTA
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — zero autoavanco (sequencia operacional completa)', () => {
  /** Espelha exatamente o que o Hoje faz: entrada explicita, efeito de invalidacao e cliques. */
  function bancada(inicial: readonly ContaComercialUX[]) {
    let contas = [...inicial];
    let id: string | null = null;
    let perdido: string | null = null;
    const efeito = () => { if (focoInvalidadoUX(contas, id)) { perdido = id; id = null; } };
    return {
      entrar: () => { id = focoAoEntrarUX(contas, id); perdido = null; efeito(); },
      estado: () => estadoModoFocoUX(contas, { id, perdido }),
      foco: () => id,
      proxima: () => { const e = estadoModoFocoUX(contas, { id, perdido }); if (e.tipo === 'CONTA' && e.proxima) id = e.proxima.itemId; efeito(); },
      anterior: () => { const e = estadoModoFocoUX(contas, { id, perdido }); if (e.tipo === 'CONTA' && e.anterior) id = e.anterior.itemId; efeito(); },
      /** acao comercial: executa o descritor e recomputa a fila — exatamente como um re-render do Hoje */
      agir: (novaFila?: readonly ContaComercialUX[]) => { acoesDoFocoUX(DESCRITORES).principal?.onClick?.(); if (novaFila) contas = [...novaFila]; efeito(); },
      primeiraDisponivel: () => { const c = contas[0]; if (c) { id = c.itemId; perdido = null; } },
    };
  }

  it('acao nao avanca, conta que some nao elege sucessora e so o clique explicito muda o foco', () => {
    const b = bancada(FILA6);

    // 1-2. entrar e registrar o itemId
    b.entrar();
    expect(b.foco()).toBe('item-1');

    // 3-4. proxima conta: muda o foco e nao toca em dado comercial
    const antes = JSON.stringify(FILA6);
    b.proxima();
    expect(b.foco()).toBe('item-2');
    expect(JSON.stringify(FILA6)).toBe(antes);

    // 5. voltar
    b.anterior();
    expect(b.foco()).toBe('item-1');

    // 6-7. acao que NAO remove a conta: foco permanece
    b.agir();
    expect(b.foco()).toBe('item-1');
    const e1 = b.estado();
    expect(e1.tipo === 'CONTA' && e1.conta.itemId).toBe('item-1');

    // 8-9. acao que REMOVE a conta da base: nenhuma outra e selecionada
    b.agir(sem(FILA6, 'item-1'));
    expect(b.foco()).toBeNull();
    expect(b.estado().tipo).toBe('INDISPONIVEL');

    // 10-11. so o clique explicito escolhe a primeira disponivel
    b.primeiraDisponivel();
    expect(b.foco()).toBe('item-2');
    const e2 = b.estado();
    expect(e2.tipo === 'CONTA' && e2.conta.itemId).toBe('item-2');
  });

  it('clicar "Próxima conta" troca o foco e NAO executa nenhuma acao comercial', () => {
    const espiao = descritoresEspiao();
    const focos: string[] = [];
    const p = props(FILA6, { id: 'item-2', perdido: null }, { acoes: () => espiao.lista, onFoco: (id) => focos.push(id) });
    clicar(p, 'Próxima conta');
    expect(focos).toEqual(['item-3']);
    expect(espiao.executadas).toEqual([]);
  });

  it('clicar "← Anterior" troca o foco e NAO executa nenhuma acao comercial', () => {
    const espiao = descritoresEspiao();
    const focos: string[] = [];
    const p = props(FILA6, { id: 'item-2', perdido: null }, { acoes: () => espiao.lista, onFoco: (id) => focos.push(id) });
    clicar(p, '← Anterior');
    expect(focos).toEqual(['item-1']);
    expect(espiao.executadas).toEqual([]);
  });

  it('executar a acao principal NAO troca o foco', () => {
    const espiao = descritoresEspiao();
    const focos: string[] = [];
    const p = props(FILA6, { id: 'item-2', perdido: null }, { acoes: () => espiao.lista, onFoco: (id) => focos.push(id) });
    clicar(p, 'Preparar abordagem');
    expect(espiao.executadas).toEqual(['Preparar abordagem']);
    expect(focos).toEqual([]);
  });

  it('executar a acao secundaria NAO troca o foco', () => {
    const espiao = descritoresEspiao();
    const focos: string[] = [];
    const p = props(FILA6, { id: 'item-2', perdido: null }, { acoes: () => espiao.lista, onFoco: (id) => focos.push(id) });
    clicar(p, 'Registrar atividade');
    expect(espiao.executadas).toEqual(['Registrar atividade']);
    expect(focos).toEqual([]);
  });

  it('clicar em "Depois desta" so troca o foco: nenhuma acao comercial e nenhum "Por quê"', () => {
    const espiao = descritoresEspiao();
    const focos: string[] = [];
    const porQues: string[] = [];
    const p = props(FILA6, { id: 'item-1', perdido: null }, { acoes: () => espiao.lista, onFoco: (id) => focos.push(id), onPorQue: (id) => porQues.push(id) });
    clicar(p, 'Empresa empresa-4');
    expect(focos).toEqual(['item-4']);
    expect(espiao.executadas).toEqual([]);
    expect(porQues).toEqual([]);
  });

  it('"Por quê ›" abre a gaveta do item em foco e nao mexe no foco', () => {
    const focos: string[] = [];
    const porQues: string[] = [];
    const p = props(FILA6, { id: 'item-3', perdido: null }, { onFoco: (id) => focos.push(id), onPorQue: (id) => porQues.push(id) });
    clicar(p, 'Por quê');
    expect(porQues).toEqual(['item-3']);
    expect(focos).toEqual([]);
  });

  it('percorrer a fila inteira para no ultimo item, sem dar a volta', () => {
    const b = bancada(FILA6);
    b.entrar();
    for (let i = 0; i < 20; i++) b.proxima();
    expect(b.foco()).toBe('item-6');
  });

  it('trocar de visao nao executa acao nem marca a conta', () => {
    expect(CODIGO_HOJE).toContain("if (v === 'foco') { setFocoTrabalhoId(focoAoEntrarUX(contasUX, focoTrabalhoId)); setFocoPerdido(null); }");
    const trocar = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('const trocarVisao'), CODIGO_HOJE.indexOf('const foco3'));
    for (const proibido of ['actions.', 'setAbordagem', 'setAtividade', 'setTarefa', 'setConcluir', 'setAgendar']) expect(trocar).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Regressao
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-3 — regressao das visoes existentes', () => {
  it('Panorama e Fila completa continuam montados como antes', () => {
    expect(CODIGO_HOJE).toContain('<ComercialPanorama');
    expect(CODIGO_HOJE).toContain('<ComercialFoco linha={foco}');
    expect(CODIGO_HOJE).toContain('modo="OPERACIONAL"');
    expect(CODIGO_HOJE).toContain('modo="EXPLICACAO"');
  });

  it('a gaveta UX-2.1 continua fail-closed e read-only', () => {
    expect(CODIGO_HOJE).toContain('gavetaFailClosed(porQue, idsAutorizados)');
    const gaveta = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('{linhaDaGaveta && ('));
    expect(gaveta).not.toContain('acoes={');
    expect(gaveta).not.toContain('ctaCadencia={');
  });

  it('o Modo Foco nao reusa a apresentacao completa do ComercialFoco', () => {
    expect(CODIGO_FOCO).not.toContain("from './ComercialFoco'");
  });

  it('nenhum motor foi tocado pelo componente novo', () => {
    for (const proibido of ['../../data/store', 'core/radar/commercialMachine', 'core/radar/commercialCadence']) {
      expect(CODIGO_FOCO).not.toContain(proibido);
    }
  });
});
