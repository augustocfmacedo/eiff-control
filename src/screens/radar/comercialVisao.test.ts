// Commercial UX 1.0 — UX-0: prova da projecao pura de apresentacao.
//
// Os cenarios vem dos MOTORES REAIS (fila CM1-A -> plano CM1-B -> cadencia CM2-B -> sugestao CM2-C) sobre as fixtures
// congeladas do CM2-A, para a projecao ser provada contra o que o sistema realmente produz — nunca contra um retrato
// inventado. Rodar os motores aqui e legitimo; o modulo de producao continua proibido de faze-lo (guardas no fim).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE, conta, tar } from '../../core/radar/cadenciaParidadeCM.fixtures';
import { planosDaFilaCM } from '../../core/radar/commercialActionPlan';
import { cadenciasDaFilaCM } from '../../core/radar/commercialCadence';
import { sugestoesTarefaDaFilaCM } from '../../core/radar/commercialCadenceTask';
import { TEXTO_RAZAO_CM, construirCommercialQueue } from '../../core/radar/commercialMachine';
import type { RadarDataset } from '../../core/radar/types';
import {
  HORIZONTES_EXECUCAO_UX, ORCAMENTO_PANORAMA_COMERCIAL, SEVERIDADES_EM_RISCO_UX, contaEmRiscoUX, contasDoHorizonteUX, contasEmRiscoUX,
  excecoesDaContaUX, horizonteDaCadenciaUX, recorteUX, resumoComercialUX, resumoEsperaUX, visaoComercialUX,
  type ContaComercialUX, type EntradaContaComercialUX,
} from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio: a cadeia inteira, como a tela monta
// ---------------------------------------------------------------------------------------------------------------------
function entradas(ds: RadarDataset, hoje = HOJE): EntradaContaComercialUX[] {
  const fila = construirCommercialQueue(ds, hoje);
  const planos = planosDaFilaCM(ds, fila);
  const cadencias = cadenciasDaFilaCM(ds, fila, planos, hoje);
  const sugestoes = sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, hoje);
  return fila.itens.map((item, i) => ({ item, plano: planos[i], cadencia: cadencias[i], sugestao: sugestoes[i] }));
}
const doCaso = (id: string) => entradas(CASOS.find((c) => c.id === id)!.ds);
const umaDoCaso = (id: string) => doCaso(id)[0];
/** Todas as contas de todas as fixtures, na ordem em que os motores as devolvem. */
const TODAS: EntradaContaComercialUX[] = CASOS.flatMap((c) => entradas(c.ds));

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const FONTE = leia('comercialVisao.ts');
/** So o codigo: as guardas por substring nao podem casar com a prosa dos comentarios (que cita o que e proibido). */
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO = semComentarios(FONTE);

// ---------------------------------------------------------------------------------------------------------------------
// Eixo A — horizonte de execucao (casos 1 a 9)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · horizonte de execucao', () => {
  it('1. DEVIDA vira AGORA', () => {
    const e = umaDoCaso('01');
    expect(e.cadencia.estado).toBe('DEVIDA');
    expect(horizonteDaCadenciaUX(e.cadencia)).toBe('AGORA');
  });
  it('2. DEVIDA com data continua AGORA (pendencia ou compromisso nao rebaixam o que o motor declarou devido)', () => {
    // tarefa aberta vencida: razao TAREFA_VENCIDA, estado DEVIDA com toque FIRME datado
    const ds = conta('venc', { tarefas: [tar('t1', 'venc', '2026-09-10')] });
    const e = entradas(ds)[0];
    expect(e.cadencia.estado).toBe('DEVIDA');
    expect(e.cadencia.proximoToque?.em).toBeTruthy();
    expect(horizonteDaCadenciaUX(e.cadencia)).toBe('AGORA');
    expect(contaComercial(e).horizonte).toBe('AGORA');
  });
  it('3. AGUARDANDO com data vira PROGRAMADO', () => {
    for (const id of ['02', '06b']) {
      const e = umaDoCaso(id);
      expect(e.cadencia.estado).toBe('AGUARDANDO');
      expect(e.cadencia.proximoToque?.em).toBeTruthy();
      expect(horizonteDaCadenciaUX(e.cadencia)).toBe('PROGRAMADO');
    }
  });
  it('4. SUGERIR_PROXIMO_PASSO com data RECOMENDADA vira PROGRAMADO', () => {
    const e = umaDoCaso('05b');
    expect(e.cadencia.estado).toBe('SUGERIR_PROXIMO_PASSO');
    expect(e.cadencia.proximoToque?.natureza).toBe('RECOMENDADA');
    expect(horizonteDaCadenciaUX(e.cadencia)).toBe('PROGRAMADO');
  });
  it('5. PAUSADA aguardando FATO_NOVO vira AGUARDANDO', () => {
    const e = umaDoCaso('06');
    expect(e.cadencia.estado).toBe('PAUSADA');
    expect(e.cadencia.retomaCom).toBe('FATO_NOVO');
    expect(contaComercial(e)).toMatchObject({ horizonte: 'AGUARDANDO', espera: { retomaCom: 'FATO_NOVO' } });
  });
  it('6. PAUSADA aguardando DADO vira AGUARDANDO', () => {
    const e = umaDoCaso('13');
    expect(e.cadencia.retomaCom).toBe('DADO');
    expect(contaComercial(e)).toMatchObject({ horizonte: 'AGUARDANDO', espera: { retomaCom: 'DADO' } });
  });
  it('7. PAUSADA aguardando DECISAO_HUMANA vira AGUARDANDO', () => {
    const e = umaDoCaso('25');
    expect(e.cadencia.retomaCom).toBe('DECISAO_HUMANA');
    expect(contaComercial(e)).toMatchObject({ horizonte: 'AGUARDANDO', espera: { retomaCom: 'DECISAO_HUMANA' } });
  });
  it('8. ENCERRADA fica SEM_DESTAQUE', () => {
    const e = umaDoCaso('04');
    expect(e.cadencia.estado).toBe('ENCERRADA');
    expect(horizonteDaCadenciaUX(e.cadencia)).toBe('SEM_DESTAQUE');
  });
  it('9. NAO_APLICAVEL fica SEM_DESTAQUE, mesmo com toque secundario datado', () => {
    const e = umaDoCaso('28');
    expect(e.cadencia.estado).toBe('NAO_APLICAVEL');
    expect(e.cadencia.proximoToque?.em).toBeTruthy();
    expect(horizonteDaCadenciaUX(e.cadencia)).toBe('SEM_DESTAQUE');
  });
  it('todo estado real cai em exatamente um horizonte, e SEM_DESTAQUE nao esconde trabalho devido', () => {
    for (const e of TODAS) {
      const h = horizonteDaCadenciaUX(e.cadencia);
      expect(HORIZONTES_EXECUCAO_UX).toContain(h);
      if (e.cadencia.estado === 'DEVIDA') expect(h).toBe('AGORA');
      if (h === 'SEM_DESTAQUE') expect(['ENCERRADA', 'NAO_APLICAVEL']).toContain(e.cadencia.estado);
    }
  });
  it('toque sem data nao promove a conta a PROGRAMADO (so data destaca o futuro)', () => {
    const e = umaDoCaso('06');
    const semData = { ...e.cadencia, proximoToque: { natureza: 'IMEDIATA' as const, origem: { tipo: 'empresa' as const, id: e.item.empresaId } } };
    expect(horizonteDaCadenciaUX(semData)).toBe('AGUARDANDO');
    expect(contaComercial({ ...e, cadencia: semData })).toMatchObject({ horizonte: 'AGUARDANDO', proximoToque: { natureza: 'IMEDIATA' } });
  });
  it('espera sem motivo informado nao inventa rotulo', () => {
    const e = umaDoCaso('06');
    const semMotivo = contaComercial({ ...e, cadencia: { ...e.cadencia, retomaCom: undefined } });
    expect(semMotivo.horizonte).toBe('AGUARDANDO');
    expect(semMotivo.espera).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Autoridade preservada (casos 10 a 15)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · autoridade preservada', () => {
  it('10 e 11. motivo e o codigo do CM1-A com o texto da tabela existente', () => {
    for (const e of TODAS) {
      const c = contaComercial(e);
      expect(c.motivo.codigo).toBe(e.item.porQueAgora.codigo);
      expect(c.motivo.texto).toBe(TEXTO_RAZAO_CM[e.item.porQueAgora.codigo]);
    }
  });
  it('fatos temporais do motivo vem do item, sem recomposicao', () => {
    for (const e of TODAS) {
      const c = contaComercial(e); const p = e.item.porQueAgora;
      expect(c.motivo.dias).toBe(p.dias ?? undefined);
      expect(c.motivo.em).toBe(p.em ?? undefined);
      expect(c.motivo.venceEm).toBe(p.venceEm ?? undefined);
    }
  });
  it('12. contato e o do plano; a projecao nunca troca por outro melhor', () => {
    for (const e of TODAS) {
      const c = contaComercial(e);
      expect(c.contato?.id).toBe(e.plano.contato?.id);
    }
    // conta com contato de referencia no item, mas plano sem contato: a projecao nao promove o contato do item
    const semPlano = TODAS.find((e) => !e.plano.contato && !!e.item.contato);
    if (semPlano) expect(contaComercial(semPlano).contato).toBeUndefined();
  });
  it('13. canal nunca e inventado: so o canal decidido pelo plano', () => {
    for (const e of TODAS) {
      const c = contaComercial(e);
      expect(c.contato?.canal).toBe(e.plano.comunicacao?.canal ?? undefined);
      if (e.plano.modo !== 'CONTATO') expect(c.contato?.canal).toBeUndefined();
    }
  });
  it('13b. plano com contato e sem comunicacao nao ganha canal por fallback', () => {
    const e = TODAS.find((x) => !!x.plano.contato)!;
    const c = contaComercial({ ...e, plano: { ...e.plano, comunicacao: undefined } });
    expect(c.contato?.id).toBe(e.plano.contato!.id);
    expect(c.contato?.canal).toBeUndefined();
    // e a projecao nem conhece as listas de canal do plano/contato
    for (const proibido of ['canaisAcionaveis', 'canaisAlternativos', 'canaisDescartados']) expect(CODIGO).not.toContain(proibido);
  });
  it('14. modo e copiado do plano', () => {
    for (const e of TODAS) expect(contaComercial(e).modo).toBe(e.plano.modo);
  });
  it('15. a natureza RECOMENDADA continua RECOMENDADA (data recomendada nao vira compromisso)', () => {
    const e = umaDoCaso('05b');
    const c = contaComercial(e);
    expect(c.proximoToque).toEqual({ natureza: 'RECOMENDADA', em: e.cadencia.proximoToque!.em });
    for (const x of TODAS) expect(contaComercial(x).proximoToque?.natureza).toBe(x.cadencia.proximoToque?.natureza);
  });
  it('estado da sugestao e copiado do CM2-C', () => {
    for (const e of TODAS) expect(contaComercial(e).sugestao.estado).toBe(e.sugestao.estado);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Ordem (casos 16 a 18)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · ordem', () => {
  const muitas = visaoComercialUX(TODAS);
  it('a projecao preserva a ordem de entrada item a item', () => {
    expect(muitas.map((c) => c.itemId)).toEqual(TODAS.map((e) => e.cadencia.itemId));
    expect(muitas.map((c) => c.posicao)).toEqual(TODAS.map((e) => e.item.posicao));
  });
  it('16 e 17. recortes por horizonte preservam a ordem (AGORA e PROGRAMADO)', () => {
    for (const h of ['AGORA', 'PROGRAMADO'] as const) {
      const filtradas = contasDoHorizonteUX(muitas, h);
      expect(filtradas).toEqual(muitas.filter((c) => c.horizonte === h));
      const indices = filtradas.map((c) => muitas.indexOf(c));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });
  it('em risco tambem preserva a ordem', () => {
    const risco = contasEmRiscoUX(muitas);
    const indices = risco.map((c) => muitas.indexOf(c));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
  it('18. o modulo nao contem nenhuma ordenacao', () => {
    expect(FONTE).not.toMatch(/\.sort\(|localeCompare|\.reverse\(/);
  });
  it('recorte corta pelo teto sem reordenar e devolve quantos ficaram de fora', () => {
    const r = recorteUX(muitas, ORCAMENTO_PANORAMA_COMERCIAL.agora);
    expect(r.visiveis).toEqual(muitas.slice(0, 3));
    expect(r.ocultos).toBe(muitas.length - r.visiveis.length);
    expect(recorteUX([], 3)).toEqual({ visiveis: [], ocultos: 0 });
    expect(recorteUX(muitas.slice(0, 2), 3)).toEqual({ visiveis: muitas.slice(0, 2), ocultos: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Eixo B — excecoes (casos 19 a 23)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · excecoes', () => {
  it('19 e 20. oportunidade parada e parada critica viram excecao sustentada pelo CM1-A', () => {
    const comRazao = TODAS.filter((e) => [e.item.porQueAgora, ...e.item.secundarias].some((r) => r.codigo === 'OPORTUNIDADE_PARADA' || r.codigo === 'OPORTUNIDADE_PARADA_CRITICA'));
    const tipos = new Set<string>();
    for (const e of comRazao) {
      const ex = excecoesDaContaUX(e.item, e.plano);
      for (const r of [e.item.porQueAgora, ...e.item.secundarias]) {
        if (r.codigo === 'OPORTUNIDADE_PARADA' || r.codigo === 'OPORTUNIDADE_PARADA_CRITICA') {
          const achada = ex.find((x) => x.codigo === r.codigo);
          expect(achada, `excecao ${r.codigo}`).toBeTruthy();
          expect(achada!.bloqueante).toBe(false);
          tipos.add(`${achada!.tipo}:${achada!.severidade}`);
        }
      }
    }
    expect(comRazao.length, 'as fixtures trazem parada real').toBeGreaterThan(0);
    // as duas razoes existem nas fixtures do CM2-A e mapeiam severidades diferentes
    expect(tipos).toContain('OPORTUNIDADE_PARADA:ATENCAO');
    expect(tipos).toContain('OPORTUNIDADE_PARADA_CRITICA:RISCO');
    // so a critica entra no contador EM RISCO; a parada simples fica na lista
    expect(SEVERIDADES_EM_RISCO_UX).toEqual(['BLOQUEIO', 'RISCO']);
  });
  it('21. trava explicita aparece como excecao, com o bloqueante que o CM1-A declarou', () => {
    const comTrava = TODAS.filter((e) => e.item.travas.length);
    expect(comTrava.length).toBeGreaterThan(0);
    for (const e of comTrava) {
      const ex = excecoesDaContaUX(e.item, e.plano);
      for (const t of e.item.travas) {
        const achada = ex.find((x) => x.tipo === 'TRAVA' && x.codigo === t.codigo);
        expect(achada, `trava ${t.codigo}`).toBeTruthy();
        expect(achada!.bloqueante).toBe(t.bloqueante && t.bloqueia.length > 0);
        expect(achada!.severidade).toBe(achada!.bloqueante ? 'BLOQUEIO' : 'ATENCAO');
      }
    }
  });
  it('bloqueio do plano aparece como excecao bloqueante', () => {
    const comBloqueio = TODAS.filter((e) => e.plano.bloqueios.length);
    expect(comBloqueio.length).toBeGreaterThan(0);
    for (const e of comBloqueio) {
      const ex = excecoesDaContaUX(e.item, e.plano);
      for (const b of e.plano.bloqueios) {
        const achada = ex.find((x) => x.tipo === 'BLOQUEIO_PLANO' && x.codigo === b.codigo);
        expect(achada, `bloqueio ${b.codigo}`).toBeTruthy();
        expect(achada!.severidade).toBe('BLOQUEIO');
        expect(achada!.bloqueante).toBe(true);
      }
    }
  });
  it('22. conta com duas excecoes conta uma unica vez em risco', () => {
    const base = TODAS.find((e) => e.item.travas.some((t) => t.bloqueante && t.bloqueia.length))!;
    const c = contaComercial(base);
    const duplicada: ContaComercialUX = { ...c, excecoes: [...c.excecoes, { tipo: 'OPORTUNIDADE_PARADA_CRITICA', codigo: 'OPORTUNIDADE_PARADA_CRITICA', severidade: 'RISCO', bloqueante: false }] };
    expect(duplicada.excecoes.length).toBeGreaterThan(1);
    expect(contaEmRiscoUX(duplicada)).toBe(true);
    expect(resumoComercialUX([duplicada]).emRisco).toBe(1);
  });
  it('23. conta sem trava, bloqueio ou razao de risco nao entra em risco', () => {
    const limpa = TODAS.find((e) => !e.item.travas.length && !e.plano.bloqueios.length
      && ![e.item.porQueAgora, ...e.item.secundarias].some((r) => r.codigo.startsWith('OPORTUNIDADE_PARADA')))!;
    const c = contaComercial(limpa);
    expect(c.excecoes).toEqual([]);
    expect(contaEmRiscoUX(c)).toBe(false);
  });
  it('excecao duplicada exata aparece uma vez so', () => {
    const e = TODAS.find((x) => x.item.travas.length)!;
    const item = { ...e.item, travas: [...e.item.travas, ...e.item.travas] };
    expect(excecoesDaContaUX(item, e.plano)).toEqual(excecoesDaContaUX(e.item, e.plano));
  });
  it('nenhuma excecao nasce de score, valor ou tempo arbitrario', () => {
    expect(CODIGO).not.toMatch(/priorityScore|priorityClass|valorPonderado|urgencia|dias\s*>|>\s*\d+\s*\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Resumos (casos 24 e 25)
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · resumos', () => {
  const contas = visaoComercialUX(TODAS);
  it('24. contadores batem com as linhas projetadas', () => {
    const r = resumoComercialUX(contas);
    expect(r.agora).toBe(contasDoHorizonteUX(contas, 'AGORA').length);
    expect(r.aguardando).toBe(contasDoHorizonteUX(contas, 'AGUARDANDO').length);
    expect(r.programado).toBe(contasDoHorizonteUX(contas, 'PROGRAMADO').length);
    expect(r.semDestaque).toBe(contasDoHorizonteUX(contas, 'SEM_DESTAQUE').length);
    expect(r.emRisco).toBe(contasEmRiscoUX(contas).length);
    expect(r.agora + r.aguardando + r.programado + r.semDestaque).toBe(contas.length);
    expect(r.total).toBe(contas.length);
    expect(resumoComercialUX([])).toEqual({ agora: 0, aguardando: 0, programado: 0, semDestaque: 0, emRisco: 0, total: 0 });
  });
  it('25. a espera e agregada por retomaCom, sem lista e sem rotulo novo', () => {
    const espera = resumoEsperaUX(contas);
    const esperando = contasDoHorizonteUX(contas, 'AGUARDANDO');
    expect(espera.reduce((s, e) => s + e.contas, 0)).toBe(esperando.length);
    for (const e of espera) {
      if (e.retomaCom) expect(e.contas).toBe(esperando.filter((c) => c.espera?.retomaCom === e.retomaCom).length);
      else expect(e.contas).toBe(esperando.filter((c) => !c.espera?.retomaCom).length);
    }
    expect(espera.map((e) => e.retomaCom).filter(Boolean)).toEqual(['FATO_NOVO', 'DADO', 'DECISAO_HUMANA'].filter((m) => espera.some((e) => e.retomaCom === m)));
    expect(resumoEsperaUX([])).toEqual([]);
  });
  it('o orcamento visual e um contrato de apresentacao, nao regra comercial', () => {
    expect(ORCAMENTO_PANORAMA_COMERCIAL).toEqual({ agora: 3, pipeline: 3, risco: 3, entrada: 3, programado: 3 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Pureza (casos 26 a 30) e escopo do bloco
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-0 · pureza e escopo', () => {
  it.each(['react', 'useStore', '../../data/store', 'supabase', 'fetch(', 'localStorage', 'window.', 'document.', '../../ui/'])('26 e 27. nao depende de %s', (proibido) => {
    expect(CODIGO).not.toContain(proibido);
  });
  it('28 e 29. nao chama motor nem autoridade antiga', () => {
    for (const proibido of ['construirCommercialQueue(', 'planosDaFilaCM(', 'cadenciasDaFilaCM(', 'sugestoesTarefaDaFilaCM(', 'filaHoje', 'recomendarAcao', 'resumoRadar']) {
      expect(CODIGO, `nao pode chamar ${proibido}`).not.toContain(proibido);
    }
  });
  it('30. nao tem score, ranking nem peso proprio', () => {
    for (const proibido of ['score', 'peso', 'ranking', 'pontu', 'Math.max(...', 'pressao']) {
      expect(CODIGO.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
  it('nao antecipa PIPELINE nem ENTRADA com implementacao morta ou dado inventado', () => {
    expect(CODIGO).not.toMatch(/function .*pipelineAtivo|function .*entradaUX|PIPELINE_ATIVO|contasDaEntrada/);
    expect(CODIGO).not.toMatch(/\b(TODO|FIXME|stub|mock|placeholder)\b/i);
  });
  it('a projecao e determinista: mesma entrada, mesma saida', () => {
    expect(visaoComercialUX(TODAS)).toEqual(visaoComercialUX(TODAS));
    expect(CODIGO).not.toMatch(/Date\.now|new Date\(|Math\.random/);
  });
  it('nenhum contrato de botao nasceu aqui (CTA continua na Hoje)', () => {
    for (const proibido of ['cta', 'botao', 'acoes(', 'onClick', 'rotulo']) expect(CODIGO.toLowerCase()).not.toContain(proibido.toLowerCase());
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Atalho local: projeta uma entrada (o teste usa muito)
// ---------------------------------------------------------------------------------------------------------------------
function contaComercial(e: EntradaContaComercialUX): ContaComercialUX {
  return visaoComercialUX([e])[0];
}
