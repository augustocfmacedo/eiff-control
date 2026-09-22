// Commercial UX 1.0 — UX-2.1: a explicacao e read-only DE VERDADE.
//
// Aqui a prova e de COMPOSICAO, nao de substring: o componente compartilhado e renderizado em memoria
// (`renderToStaticMarkup`, sem DOM) nos dois modos, com nos de acao "envenenados" — se o modo EXPLICACAO deixasse
// qualquer um passar, o HTML os conteria e o teste cairia. Os dados vem dos motores reais (fixtures do CM2-A).
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE } from '../../core/radar/cadenciaParidadeCM.fixtures';
import { itemIdCM, planosDaFilaCM } from '../../core/radar/commercialActionPlan';
import { cadenciasDaFilaCM } from '../../core/radar/commercialCadence';
import { sugestoesTarefaDaFilaCM } from '../../core/radar/commercialCadenceTask';
import { construirCommercialQueue } from '../../core/radar/commercialMachine';
import type { RadarDataset } from '../../core/radar/types';
import ComercialFoco, { MODOS_BLOCO_FOCO, abreScore, ehOperacional, gavetaFailClosed, type LinhaFocoCM, type ModoBlocoFoco } from './ComercialFoco';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio: linhas reais + render em memoria
// ---------------------------------------------------------------------------------------------------------------------
const USUARIOS = [{ id: 'u1', nome: 'Vendedor Piloto' }, { id: 'u9', nome: 'Outro' }];
function linhasDoCaso(ds: RadarDataset): LinhaFocoCM[] {
  const fila = construirCommercialQueue(ds, HOJE);
  const planos = planosDaFilaCM(ds, fila);
  const cadencias = cadenciasDaFilaCM(ds, fila, planos, HOJE);
  const sugestoes = sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, HOJE);
  return fila.itens.map((item, i) => ({ id: itemIdCM(item), item, plano: planos[i], cadencia: cadencias[i], sugestao: sugestoes[i], empresa: ds.empresas.find((e) => e.id === item.empresaId) }));
}
const TODAS = CASOS.flatMap((c) => linhasDoCaso(c.ds).map((linha) => ({ linha, ds: c.ds, caso: c.id })));
/** Uma conta com sugestao datada (tem CTA de cadencia na fila completa) e uma com CONTATO (tem CTAs de acao). */
const comSugestao = TODAS.find((x) => x.linha.sugestao.estado === 'SUGERIDA')!;
const comContato = TODAS.find((x) => x.linha.plano.modo === 'CONTATO')!;

/** Rotulos operacionais que NUNCA podem aparecer na superficie de explicacao. */
const ROTULOS_OPERACIONAIS = [
  'Preparar abordagem', 'Abrir abordagem aprovada', 'Registrar atividade', 'Concluir esta tarefa', 'Agendar tarefa',
  'Criar tarefa manual', 'Revisar abordagem', 'Resolver duplicata', 'Definir responsável da oportunidade', 'Revisar tarefa',
  'Verificar sinal', 'Completar canal do contato', 'Validar ou trocar contato', 'Buscar decisor nos contatos',
  'Agendar pesquisa', 'Agendar próxima ação',
];
const acoesEnvenenadas = React.createElement(React.Fragment, null, ...ROTULOS_OPERACIONAIS.map((r, i) => React.createElement('button', { key: i }, r)));
const ctaEnvenenado = React.createElement('button', null, 'Agendar próxima ação');

function html(alvo: { linha: LinhaFocoCM; ds: RadarDataset }, modo: ModoBlocoFoco, extras: Record<string, unknown> = {}) {
  return renderToStaticMarkup(React.createElement(ComercialFoco, {
    linha: alvo.linha, posicao: 1, total: 3, modo, radar: alvo.ds, usuarios: USUARIOS,
    acoes: acoesEnvenenadas, ctaCadencia: ctaEnvenenado, semPermissao: false,
    onScore: () => { throw new Error('a explicacao nao abre o score'); },
    ...extras,
  }));
}

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO_FOCO = semComentarios(leia('ComercialFoco.tsx'));
const CODIGO_HOJE = semComentarios(leia('Hoje.tsx'));

// ---------------------------------------------------------------------------------------------------------------------
// Read-only real (composicao)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-2.1 · explicacao read-only', () => {
  it('1 e 10. EXPLICACAO nao renderiza NENHUM no de acao, mesmo recebendo todos', () => {
    const saida = html(comContato, 'EXPLICACAO');
    for (const rotulo of ROTULOS_OPERACIONAIS) expect(saida, `vazou: ${rotulo}`).not.toContain(rotulo);
    expect(saida).not.toContain('<button');
    expect(saida).not.toContain('class="actions"');
  });
  it('2. OPERACIONAL continua renderizando os nos de acao recebidos', () => {
    const saida = html(comContato, 'OPERACIONAL');
    for (const rotulo of ROTULOS_OPERACIONAIS) expect(saida, `sumiu: ${rotulo}`).toContain(rotulo);
    expect(saida).toContain('class="actions"');
  });
  it('3. EXPLICACAO nao renderiza o CTA governado da cadencia', () => {
    const saida = html(comSugestao, 'EXPLICACAO');
    expect(saida).not.toContain('Agendar próxima ação');
    expect(saida).not.toContain('A recomendação é revalidada no momento de agendar');
  });
  it('4. OPERACIONAL renderiza o CTA governado da cadencia', () => {
    const saida = html(comSugestao, 'OPERACIONAL');
    expect(saida).toContain('Agendar próxima ação');
    expect(saida).toContain('A recomendação é revalidada no momento de agendar');
  });
  it('em EXPLICACAO nenhuma conta real renderiza botao, seja qual for o modo do plano', () => {
    for (const alvo of TODAS) expect(html(alvo, 'EXPLICACAO'), alvo.caso).not.toContain('<button');
  });
  it('5. a secao Acao continua explicando (texto), sem executar', () => {
    const saida = html(comContato, 'EXPLICACAO');
    expect(saida).toContain('Ação');
    expect(saida).toContain(comContato.linha.plano.explicacao.modo);
    expect(saida).toContain('Explicação apenas: as ações ficam na fila completa.');
  });
  it('aguardarAte continua explicado em EXPLICACAO quando o plano manda aguardar', () => {
    const aguardar = TODAS.find((x) => x.linha.plano.modo === 'AGUARDAR' && !!x.linha.plano.aguardarAte);
    if (!aguardar) return;
    expect(html(aguardar, 'EXPLICACAO')).toContain('Retomar em');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Explicabilidade completa nos dois modos
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-2.1 · explicabilidade preservada', () => {
  it('6 e 7. cadencia e sugestao continuam completas na explicacao', () => {
    const saida = html(comSugestao, 'EXPLICACAO');
    for (const parte of ['Cadência', 'Motivo', 'Próximo compromisso', 'Tipo', 'Data', 'Responsável', 'Contato', 'Descrição', 'ainda não existe tarefa']) {
      expect(saida, `faltou: ${parte}`).toContain(parte);
    }
    if (comSugestao.linha.cadencia.proximoToque?.natureza === 'RECOMENDADA') {
      expect(saida).toContain('Ainda não é um compromisso agendado');
      if (comSugestao.linha.cadencia.proximoToque.ancoraEm) expect(saida).toContain('Contado a partir do último movimento real');
    }
  });
  it('os mesmos campos aparecem nos dois modos (a diferenca e so a acao)', () => {
    const campos = ['Conta', 'Por que agora', 'Pessoa', 'Plano de contato', 'Histórico', 'Travas e pendências', 'Classe', 'Local', 'Oportunidade', 'Prazo', 'Tentativas'];
    const explica = html(comContato, 'EXPLICACAO'); const opera = html(comContato, 'OPERACIONAL');
    for (const c of campos) { expect(explica, c).toContain(c); expect(opera, c).toContain(c); }
    expect(explica).toContain('nesta visão · posição');
    expect(explica).toContain('decision fit'.replace('decision', 'Decision').replace('Decision fit', 'Decision fit'));
  });
  it('8 e 9. o score aparece como informacao e a gaveta nao abre a explicacao do score', () => {
    const saida = html(comContato, 'EXPLICACAO');
    expect(saida).toContain('score do Radar');
    expect(saida).toContain('score-pill');
    expect(abreScore('EXPLICACAO', () => undefined)).toBe(false);
    expect(abreScore('OPERACIONAL', () => undefined)).toBe(true);
    expect(abreScore('OPERACIONAL', undefined)).toBe(false);
    // o JSX consulta o predicado (nao ha segundo caminho para o clique)
    expect(CODIGO_FOCO).toContain('abreScore(modo, onScore)');
    expect(CODIGO_FOCO.match(/onClick/g) ?? []).toHaveLength(1);
  });
  it('o modo e explicito, nunca um booleano obscuro', () => {
    expect(MODOS_BLOCO_FOCO).toEqual(['OPERACIONAL', 'EXPLICACAO']);
    expect(ehOperacional('OPERACIONAL')).toBe(true);
    expect(ehOperacional('EXPLICACAO')).toBe(false);
    expect(CODIGO_FOCO).not.toContain('naGaveta');
    expect(CODIGO_HOJE).toContain('modo="OPERACIONAL"');
    expect(CODIGO_HOJE).toContain('modo="EXPLICACAO"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fail-closed da gaveta
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-2.1 · fail-closed', () => {
  const ids = ['a', 'b', 'c'];
  it('11. a gaveta vive presa ao itemId', () => {
    expect(gavetaFailClosed('b', ids)).toBe('b');
  });
  it('12. item fora da colecao autorizada limpa o estado', () => {
    expect(gavetaFailClosed('b', ['a', 'c'])).toBeNull();
    expect(gavetaFailClosed('b', [])).toBeNull();
  });
  it('13 e 14. nunca cai em outra conta nem em indice', () => {
    expect(gavetaFailClosed('z', ids)).toBeNull();
    expect(gavetaFailClosed('z', ids)).not.toBe('a');
    expect(gavetaFailClosed(null, ids)).toBeNull();
  });
  it('a gaveta nao reabre sozinha: fechada, o id de volta na colecao nao a traz', () => {
    const fechada = gavetaFailClosed('b', ['a', 'c']);   // sumiu -> fecha
    expect(gavetaFailClosed(fechada, ids)).toBeNull();   // voltou -> continua fechada
  });
  it('15 a 17. a colecao autorizada e a visao filtrada (busca, classe e "só as minhas")', () => {
    expect(CODIGO_HOJE).toContain('const idsAutorizados = useMemo(() => base.map((l) => l.id), [base]);');
    expect(CODIGO_HOJE).toContain('const idDaGaveta = gavetaFailClosed(porQue, idsAutorizados);');
    expect(CODIGO_HOJE).toContain('useEffect(() => { if (porQue && !idDaGaveta) setPorQue(null); }, [porQue, idDaGaveta]);');
    // `base` e exatamente o resultado dos tres filtros
    expect(CODIGO_HOJE).toMatch(/const base = linhas\.filter/);
    expect(CODIGO_HOJE).toContain('!somenteMinhas ||');
    expect(CODIGO_HOJE).toContain('!classe ||');
    expect(CODIGO_HOJE).toContain('!termo ||');
  });
  it('18. fechar manualmente continua existindo', () => {
    expect(CODIGO_HOJE).toContain('onClose={() => setPorQue(null)}');
    expect(CODIGO_HOJE).toContain('>Fechar</button>');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Regressao: fila completa e autoridade
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-2.1 · regressao', () => {
  it('19 e 20. "Abrir na fila completa" foca a mesma conta e preserva os filtros', () => {
    expect(CODIGO_HOJE).toContain('const verNaFila = (itemId: string) => {');
    expect(CODIGO_HOJE).toContain('setFocoId(itemId)');
    expect(CODIGO_HOJE).toContain("setVisao('fila')");
    // so a categoria e relaxada, e apenas quando esconderia a conta; os demais filtros nao sao tocados
    expect(CODIGO_HOJE).toContain("if (linha && categoria !== 'TODAS' && linha.item.categoria !== categoria) setCategoria('TODAS');");
    const corpo = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('const verNaFila'), CODIGO_HOJE.indexOf('const idsAutorizados'));
    for (const proibido of ['setSomenteMinhas(', 'setClasse(', 'setBusca(']) expect(corpo, `verNaFila nao pode mexer em ${proibido}`).not.toContain(proibido);
  });
  it('22. a fila completa continua com todos os CTAs', () => {
    expect(CODIGO_HOJE.match(/switch \(plano\.modo\)/g)).toHaveLength(1);
    for (const rotulo of ROTULOS_OPERACIONAIS.filter((x) => x !== 'Agendar próxima ação')) {
      expect(CODIGO_HOJE, `a fila perdeu ${rotulo}`).toContain(`'${rotulo}'`);
    }
    expect(CODIGO_HOJE).toContain('ctaCadenciaCM(l.sugestao, podeAgir)');
    expect(CODIGO_HOJE).toContain('acoes={acoes(foco)}');
    expect(CODIGO_HOJE).toContain('ctaCadencia={ctaCadenciaDe(foco)}');
  });
  it('a gaveta nao recebe no de acao nenhum', () => {
    const i = CODIGO_HOJE.indexOf('{linhaDaGaveta && (');
    const gaveta = CODIGO_HOJE.slice(i, CODIGO_HOJE.indexOf('{el}', i));
    expect(gaveta).toContain('modo="EXPLICACAO"');
    for (const proibido of ['acoes=', 'ctaCadencia=', 'onScore=']) expect(gaveta, `a gaveta nao pode passar ${proibido}`).not.toContain(proibido);
  });
  it('23. o bloco compartilhado nao toca motor nem store', () => {
    for (const proibido of ['construirCommercialQueue', 'planosDaFilaCM', 'cadenciasDaFilaCM', 'sugestoesTarefaDaFilaCM', 'useStore', 'actions.', '../../data/store', 'filaHoje']) {
      expect(CODIGO_FOCO, `nao pode usar ${proibido}`).not.toContain(proibido);
    }
  });
  it('24. uma unica apresentacao: a fila e a gaveta usam o MESMO componente', () => {
    expect(CODIGO_HOJE.match(/<ComercialFoco/g)).toHaveLength(2);
    expect(CODIGO_HOJE).not.toContain('function blocoFoco');
    expect(CODIGO_HOJE).not.toContain('function blocoCadencia');
  });
});
