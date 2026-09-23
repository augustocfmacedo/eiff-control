// LE-3B — merge join em streaming dos quatro arquivos do CNO, ordenados por CNO.
//
// Puro: opera sobre iteraveis (sincronos ou assincronos) de linhas ja lidas; quem abre arquivo e o script.
// A memoria e proporcional ao MAIOR CNO individual (uma obra + suas areas/CNAEs/vinculos), nunca aos 3,6
// milhoes: cada grupo e emitido e descartado antes do proximo. Nao existe Map de obras aqui.
//
// O join DEPENDE de ordenacao ascendente por CNO em todos os fluxos. Isso nao e presumido: `verificarOrdenacao`
// prova sobre o arquivo inteiro, e o proprio join falha fechado (`ErroOrdenacaoCno`) na primeira quebra.
import {
  juntarObservacoesCno,
  type CnoAreaCanonica, type CnoCnaeCanonico, type CnoObservacao, type CnoObservacaoCanonica,
  type CnoVinculoCanonico, type DiagnosticoCno, type LinhaLida,
} from './cnoDadosAbertos';

export type Fluxo<T> = AsyncIterable<T> | Iterable<T>;

export class ErroOrdenacaoCno extends Error {
  constructor(public readonly fluxo: string, public readonly anterior: string, public readonly atual: string, public readonly linha: number) {
    super(`${fluxo}: CNO ${atual} depois de ${anterior} (linha ${linha}) — o fluxo nao esta ordenado`);
  }
}

/** Iterador com "espiar": ve o proximo sem consumir. E o que permite alinhar quatro fluxos por chave. */
class Espiador<T> {
  private it: AsyncIterator<T> | Iterator<T>;
  private guardado: IteratorResult<T> | undefined;
  constructor(fluxo: Fluxo<T>) {
    this.it = Symbol.asyncIterator in fluxo ? (fluxo as AsyncIterable<T>)[Symbol.asyncIterator]() : (fluxo as Iterable<T>)[Symbol.iterator]();
  }
  async espiar(): Promise<T | undefined> {
    if (!this.guardado) this.guardado = await this.it.next();
    return this.guardado.done ? undefined : this.guardado.value;
  }
  async consumir(): Promise<T | undefined> {
    const v = await this.espiar();
    this.guardado = undefined;
    return v;
  }
}

/** Guarda de ordenacao por fluxo: compara cada chave com a anterior e falha na primeira quebra. */
class GuardaOrdem {
  private anterior: string | undefined;
  private linha = 0;
  constructor(private readonly nome: string) {}
  conferir(cno: string): void {
    this.linha++;
    if (this.anterior !== undefined && cno < this.anterior) throw new ErroOrdenacaoCno(this.nome, this.anterior, cno, this.linha);
    this.anterior = cno;
  }
  get linhas(): number { return this.linha; }
}

export interface ResultadoOrdenacao {
  ordenado: boolean;
  linhas: number;
  /** so quando nao ordenado: onde quebrou */
  quebra?: { linha: number; anterior: string; atual: string };
}

/** Prova de monotonicidade sobre o fluxo inteiro. Nao guarda nada alem da chave anterior. */
export async function verificarOrdenacao(fluxo: Fluxo<{ cno: string }>, nome = 'fluxo'): Promise<ResultadoOrdenacao> {
  const g = new GuardaOrdem(nome);
  try {
    for await (const l of fluxo as AsyncIterable<{ cno: string }>) g.conferir(l.cno);
    return { ordenado: true, linhas: g.linhas };
  } catch (e) {
    if (e instanceof ErroOrdenacaoCno) return { ordenado: false, linhas: e.linha, quebra: { linha: e.linha, anterior: e.anterior, atual: e.atual } };
    throw e;
  }
}

export type DiagnosticoJoin = DiagnosticoCno | { tipo: 'CNO_DUPLICADO'; cno: string };

export type EventoJoin =
  | { tipo: 'observacao'; observacao: CnoObservacao }
  | { tipo: 'diagnostico'; diagnostico: DiagnosticoJoin };

export interface FontesJoin {
  obras: Fluxo<LinhaLida<CnoObservacaoCanonica>>;
  areas?: Fluxo<LinhaLida<CnoAreaCanonica>>;
  cnaes?: Fluxo<LinhaLida<CnoCnaeCanonico>>;
  vinculos?: Fluxo<LinhaLida<CnoVinculoCanonico>>;
}

/**
 * Para cada obra (na ordem do arquivo), puxa dos fluxos filhos tudo que tem o MESMO CNO, emite a observacao
 * completa e segue. Filho com CNO menor que a obra corrente ja perdeu o pai: vira diagnostico de orfao.
 * Ao fim das obras, o que sobrar nos filhos tambem e orfao. Obra repetida vira `CNO_DUPLICADO` e sai sem
 * filhos (eles ja foram entregues a primeira).
 */
export async function* juntarOrdenadoCno(fontes: FontesJoin): AsyncGenerator<EventoJoin> {
  const obras = new Espiador(fontes.obras);
  const filhos = {
    areas: { esp: new Espiador(fontes.areas ?? []), guarda: new GuardaOrdem('cno_areas.csv'), orfao: 'AREA_ORFA' as const },
    cnaes: { esp: new Espiador(fontes.cnaes ?? []), guarda: new GuardaOrdem('cno_cnaes.csv'), orfao: 'CNAE_ORFAO' as const },
    vinculos: { esp: new Espiador(fontes.vinculos ?? []), guarda: new GuardaOrdem('cno_vinculos.csv'), orfao: 'VINCULO_ORFAO' as const },
  };
  const guardaObras = new GuardaOrdem('cno.csv');

  // colhe de um filho: orfaos (chave < alvo) viram diagnostico; iguais entram no grupo; maiores ficam espiados
  async function* colher<T>(f: { esp: Espiador<LinhaLida<T>>; guarda: GuardaOrdem; orfao: DiagnosticoCno['tipo'] }, alvo: string | undefined, grupo: LinhaLida<T>[]): AsyncGenerator<EventoJoin> {
    for (;;) {
      const p = await f.esp.espiar();
      if (!p) return;
      if (alvo !== undefined && p.cno > alvo) return;
      await f.esp.consumir();
      f.guarda.conferir(p.cno);
      if (alvo !== undefined && p.cno === alvo) grupo.push(p);
      else yield { tipo: 'diagnostico', diagnostico: { tipo: f.orfao, cno: p.cno } };
    }
  }

  let anteriorCno: string | undefined;
  for (;;) {
    const obra = await obras.consumir();
    if (!obra) break;
    guardaObras.conferir(obra.cno);

    if (obra.cno === anteriorCno) {
      yield { tipo: 'diagnostico', diagnostico: { tipo: 'CNO_DUPLICADO', cno: obra.cno } };
      yield { tipo: 'observacao', observacao: juntarObservacoesCno({ obras: [obra] }).observacoes[0] };
      continue;
    }
    anteriorCno = obra.cno;

    const areas: LinhaLida<CnoAreaCanonica>[] = [];
    const cnaes: LinhaLida<CnoCnaeCanonico>[] = [];
    const vinculos: LinhaLida<CnoVinculoCanonico>[] = [];
    yield* colher(filhos.areas, obra.cno, areas);
    yield* colher(filhos.cnaes, obra.cno, cnaes);
    yield* colher(filhos.vinculos, obra.cno, vinculos);

    yield { tipo: 'observacao', observacao: juntarObservacoesCno({ obras: [obra], areas, cnaes, vinculos }).observacoes[0] };
  }

  // fim das obras: todo filho restante e orfao
  yield* colher(filhos.areas, undefined, []);
  yield* colher(filhos.cnaes, undefined, []);
  yield* colher(filhos.vinculos, undefined, []);
}
