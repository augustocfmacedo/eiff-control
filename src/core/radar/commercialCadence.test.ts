// CM2-B — Cadence Engine puro. Compara o motor real com as expectativas congeladas no CM2-A (fixtures compartilhadas)
// e prova as propriedades do contrato: read-only, deterministico, sem data inventada, sem numero de politica copiado.
// O mapa razao -> estado do motor NAO e importado pela paridade: o contrato independente continua la.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE, type Caso } from './cadenciaParidadeCM.fixtures';
import { VERSAO_REGRAS_PLANO_CM, planosDaFilaCM, type CommercialActionPlan } from './commercialActionPlan';
import {
  CODIGOS_AVISO_CADENCIA_CM, ESTADOS_CADENCIA_CM, NATUREZAS_TOQUE_CM, REGRA_TEMPORAL_CM, RETOMADAS_CADENCIA_CM, TEXTO_AVISO_CADENCIA_CM,
  TEXTO_ESTADO_CADENCIA_CM, TEXTO_NATUREZA_TOQUE_CM, TEXTO_RETOMADA_CADENCIA_CM, VERSAO_REGRAS_CADENCIA_CM, cadenciaDaContaCM, cadenciasDaFilaCM,
  type CadenceRecommendationCM,
} from './commercialCadence';
import { CODIGOS_RAZAO_CM, HIPOTESE_COMMERCIAL_MACHINE, VERSAO_REGRAS_CM, construirCommercialQueue, type CodigoRazaoCM, type CommercialQueue, type CommercialQueueItem } from './commercialMachine';
import { radarVazio, type Atividade, type Contato, type Empresa, type RadarDataset, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
interface Execucao { fila: CommercialQueue; planos: CommercialActionPlan[]; cadencias: CadenceRecommendationCM[] }
const executar = (ds: RadarDataset, hoje = HOJE): Execucao => {
  const fila = construirCommercialQueue(ds, hoje);
  const planos = planosDaFilaCM(ds, fila);
  return { fila, planos, cadencias: cadenciasDaFilaCM(ds, fila, planos, hoje) };
};
const caso = (id: string): Caso => CASOS.find((c) => c.id === id)!;
const cadenciaDe = (c: Caso, hoje = HOJE) => executar(c.ds, hoje).cadencias.find((x) => x.empresaId === c.empresaId);
const itemDe = (c: Caso, hoje = HOJE) => construirCommercialQueue(c.ds, hoje).itens.find((i) => i.empresaId === c.empresaId)!;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}
const COLECOES = ['empresas', 'contatos', 'atividades', 'tarefas', 'sinais', 'oportunidades', 'comunicacoes', 'duplicatas', 'supressoes', 'historicoEstagios', 'projetos', 'pesosDecisionFit'] as const;
function permutar(r: RadarDataset, f: <T>(xs: T[]) => T[]): RadarDataset {
  const out = { ...r } as RadarDataset;
  for (const k of COLECOES) (out as unknown as Record<string, unknown[]>)[k] = f([...(r[k] as unknown[])]);
  return out;
}
const embaralhar = (seed: number) => <T,>(xs: T[]): T[] => { let s = seed; const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Conta minima fora das fixtures (casos de borda do motor)
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
const conta = (id: string, p: Partial<RadarDataset>, priorityClass: Empresa['priorityClass'] = 'A'): RadarDataset => ({
  ...radarVazio(), pesosDecisionFit: [{ chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 }, { chave: 'persona.CEO.media', valor: 85 }],
  ...p,
  empresas: [{ id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 70, priorityClass } as Empresa],
  contatos: [{ id: `c-${id}`, empresaId: id, nome: `Pessoa ${id}`, persona: 'CEO', email: `c@${id}.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01' } as Contato],
});
const atv = (id: string, empresaId: string, dia: string, p: Partial<Atividade> = {}): Atividade => ({ id, empresaId, contatoId: `c-${empresaId}`, usuarioId: 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts(dia), notas: '', criadoEm: ts(dia), ...p });
const tarefaConcluida = (id: string, empresaId: string, criadoEm: string, concluidaEm?: string): TarefaRadar => ({ id, empresaId, contatoId: `c-${empresaId}`, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: dia(criadoEm), status: 'Concluída', descricao: 'tratar', criadoEm, concluidaEm });
const dia = (v: string) => v.slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-B — motor contra o contrato congelado do CM2-A (28 casos + variantes)', () => {
  for (const c of CASOS) {
    it(`${c.id} — ${c.titulo}`, () => {
      const { fila, cadencias } = executar(c.ds);
      const rec = cadencias.find((x) => x.empresaId === c.empresaId);
      if (!c.cm2) { expect(rec).toBeUndefined(); expect(fila.foraDaFila.map((f) => f.empresaId)).toContain(c.empresaId); return; }
      const item = fila.itens.find((i) => i.empresaId === c.empresaId)!;
      expect(rec).toBeDefined();
      expect(rec!.estado).toBe(c.cm2.estado);
      expect(rec!.motivo).toBe(item.porQueAgora.codigo);
      expect(rec!.motivo).toBe(c.cm1!.codigo);
      expect(rec!.retomaCom).toBe(c.cm2.retomaCom);
      expect(rec!.proximoToque?.natureza).toBe(c.cm2.proximoToque?.natureza);
      expect(rec!.proximoToque?.em).toBe(c.cm2.proximoToque?.em);
      expect(rec!.proximoToque?.ancoraEm).toBe(c.cm2.proximoToque?.ancora);
      // PEDIR_DATA do contrato vira o aviso DATA_DO_CLIENTE_NECESSARIA (a sugestao em si e do CM2-C)
      const esperados = [...(c.cm2.avisos ?? []), ...(c.cm2.sugestao === 'PEDIR_DATA' ? ['DATA_DO_CLIENTE_NECESSARIA'] : [])].sort();
      expect([...rec!.avisos].sort()).toEqual(esperados);
    });
  }

  it('cobre todos os casos das fixtures', () => {
    const avaliados = CASOS.filter((c) => c.cm2).length;
    expect(avaliados + CASOS.filter((c) => !c.cm2).length).toBe(CASOS.length);
    expect(CASOS.length).toBeGreaterThanOrEqual(28);
  });
});

describe('CM2-B — natureza do proximo toque', () => {
  it('FIRME aponta para compromisso real existente e repete a data dele', () => {
    for (const c of CASOS) {
      const rec = cadenciaDe(c);
      if (rec?.proximoToque?.natureza !== 'FIRME') continue;
      const { origem, em } = rec.proximoToque;
      if (origem.tipo === 'tarefa') expect(dia(c.ds.tarefas.find((t) => t.id === origem.id && t.status === 'Aberta')!.venceEm)).toBe(em);
      else { expect(origem.tipo).toBe('oportunidade'); expect(dia(c.ds.oportunidades.find((o) => o.id === origem.id)!.proximaAcaoEm!)).toBe(em); }
    }
  });

  it('BASE_CM1 usa exatamente porQueAgora.venceEm do CM1-A, nunca recalcula a partir da atividade', () => {
    const c = caso('02');
    const item = itemDe(c);
    expect(cadenciaDe(c)!.proximoToque).toEqual({ natureza: 'BASE_CM1', em: item.porQueAgora.venceEm, origem: item.porQueAgora.referencia });
    // item com prazo diferente do que a conta daria: o motor tem de seguir o CM1-A
    const alterado: CommercialQueueItem = { ...item, porQueAgora: { ...item.porQueAgora, venceEm: '2026-09-30' } };
    const fila = construirCommercialQueue(c.ds, HOJE);
    const plano = planosDaFilaCM(c.ds, fila).find((p) => p.empresaId === c.empresaId)!;
    expect(cadenciaDaContaCM(c.ds, alterado, plano, HOJE).proximoToque?.em).toBe('2026-09-30');
  });

  it('IMEDIATA nunca fabrica data; RECOMENDADA nunca fica no passado', () => {
    for (const c of CASOS) {
      const t = cadenciaDe(c)?.proximoToque;
      if (t?.natureza === 'IMEDIATA') expect(t.em).toBeUndefined();
      if (t?.natureza === 'RECOMENDADA') expect(t.em! >= HOJE).toBe(true);
    }
  });

  it('hoje diferente nao muda datas firmes nem a data do intervalo', () => {
    expect(cadenciaDe(caso('15'), '2026-09-17')!.proximoToque).toEqual(cadenciaDe(caso('15'))!.proximoToque);
    expect(cadenciaDe(caso('17'), '2026-09-18')!.proximoToque).toEqual(cadenciaDe(caso('17'))!.proximoToque);
    expect(cadenciaDe(caso('02'), '2026-09-16')!.proximoToque).toEqual(cadenciaDe(caso('02'))!.proximoToque);
  });
});

describe('CM2-B — lacuna D4', () => {
  it('com oportunidade ativa: ultimo movimento do CM1-A + SLA do estagio', () => {
    const rec = cadenciaDe(caso('17b'))!;
    expect(rec.estado).toBe('SUGERIR_PROXIMO_PASSO');
    expect(rec.proximoToque).toMatchObject({ natureza: 'RECOMENDADA', ancoraEm: '2026-09-12', origem: { tipo: 'oportunidade', id: 'o1' } });
    const sla = HIPOTESE_COMMERCIAL_MACHINE.slaEstagioDias.ENGAGED;
    expect(rec.proximoToque!.em).toBe(new Date(Date.parse('2026-09-12T00:00:00Z') + sla * 86_400_000).toISOString().slice(0, 10));
  });

  it('sem oportunidade: ancora real (conclusao do tratamento) + intervalo do CM1-A, com piso em hoje', () => {
    const rec = cadenciaDe(caso('05b'))!;
    expect(rec.estado).toBe('SUGERIR_PROXIMO_PASSO');
    expect(rec.proximoToque).toMatchObject({ natureza: 'RECOMENDADA', ancoraEm: '2026-09-10', origem: { tipo: 'tarefa', id: 't1' }, em: HOJE });
    // mais cedo no calendario o piso nao atua: vale ancora + intervalo
    const cedo = cadenciaDe(caso('05b'), '2026-09-11')!;
    expect(cedo.proximoToque!.em).toBe(new Date(Date.parse('2026-09-10T00:00:00Z') + HIPOTESE_COMMERCIAL_MACHINE.intervaloFollowUpDias * 86_400_000).toISOString().slice(0, 10));
  });

  it('sem ancora confiavel nao ha data: decisao humana', () => {
    // atividade com data futura (registro errado) e tratamento concluido sem data de conclusao
    const ds = conta('semancora', { atividades: [atv('a1', 'semancora', '2026-09-20', { resultado: 'POSITIVE', criadoEm: ts('2026-09-14') })], tarefas: [tarefaConcluida('t1', 'semancora', ts('2026-09-14', '11:00'))] });
    const item = construirCommercialQueue(ds, HOJE).itens[0];
    expect(item.porQueAgora.codigo).toBe('SEM_TIMING_ATUAL');
    const rec = executar(ds).cadencias[0];
    expect(rec.estado).toBe('SUGERIR_PROXIMO_PASSO');
    expect(rec.proximoToque).toBeUndefined();
    expect(rec.avisos).toContain('ANCORA_TEMPORAL_AUSENTE');
  });

  it('SEM_TIMING_ATUAL sem conversa acionavel continua NAO_APLICAVEL (sem lacuna, sem data)', () => {
    const ds = conta('fria', {}, 'B');
    const rec = executar(ds).cadencias[0];
    expect(rec.motivo).toBe('SEM_TIMING_ATUAL');
    expect(rec.estado).toBe('NAO_APLICAVEL');
    expect(rec.proximoToque).toBeUndefined();
    expect(rec.avisos).toEqual([]);
  });

  for (const [resultado, id] of [['CALL_BACK', '08'], ['FUTURE_PROJECT', '09']] as const) {
    it(`${resultado} sem data: pede a data do cliente e nunca aplica D4`, () => {
      const pendente = cadenciaDe(caso(id))!;
      expect(pendente.estado).toBe('DEVIDA');
      expect(pendente.proximoToque).toEqual({ natureza: 'IMEDIATA', origem: itemDe(caso(id)).porQueAgora.referencia });
      expect(pendente.avisos).toContain('DATA_DO_CLIENTE_NECESSARIA');
      // tratado e esquecido: continua sem data inventada
      const ds = conta('tratado', { atividades: [atv('a1', 'tratado', '2026-09-08', { resultado })], tarefas: [tarefaConcluida('t1', 'tratado', ts('2026-09-08', '11:00'), ts('2026-09-09'))] });
      const rec = executar(ds).cadencias[0];
      expect(rec.motivo).toBe('SEM_TIMING_ATUAL');
      expect(rec.estado).toBe('SUGERIR_PROXIMO_PASSO');
      expect(rec.proximoToque).toBeUndefined();
      expect(rec.avisos).toEqual(['DATA_DO_CLIENTE_NECESSARIA']);
    });
  }
});

describe('CM2-B — autoridade do CM1-A preservada', () => {
  it('sinal novo fura o intervalo porque o CM1-A ja furou: DEVIDA com o motivo do sinal', () => {
    const rec = cadenciaDe(caso('23'))!;
    expect(rec).toMatchObject({ estado: 'DEVIDA', motivo: 'SINAL_ACIONAVEL_NOVO', proximoToque: { natureza: 'IMEDIATA' } });
    expect(itemDe(caso('23')).secundarias.some((s) => s.codigo === 'FOLLOW_UP_EM_INTERVALO')).toBe(true);
  });

  it('negativa continua pausada, esgotada continua encerrada, tarefa futura continua aguardando', () => {
    expect(cadenciaDe(caso('06'))).toMatchObject({ estado: 'PAUSADA', retomaCom: 'FATO_NOVO' });
    expect(cadenciaDe(caso('06'))!.proximoToque).toBeUndefined();
    expect(cadenciaDe(caso('04'))).toMatchObject({ estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' });
    expect(cadenciaDe(caso('04'))!.tentativa).toEqual({ semRespostaSeguidas: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta, limite: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta, doContato: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta });
    expect(cadenciaDe(caso('15'))).toMatchObject({ estado: 'AGUARDANDO', retomaCom: 'DATA', proximoToque: { natureza: 'FIRME', em: '2026-09-20' } });
  });

  it('tentativa espelha a contagem do CM1-A, inclusive as dividas (sem corrigir)', () => {
    expect(cadenciaDe(caso('07b'))!.tentativa).toMatchObject({ semRespostaSeguidas: 0 });
    expect(cadenciaDe(caso('14'))!.tentativa).toEqual({ semRespostaSeguidas: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta, limite: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta, doContato: 1 });
    expect(cadenciaDe(caso('05'))!.tentativa).toBeUndefined();
  });

  it('contas fora da fila nao recebem cadencia', () => {
    for (const id of ['01b', '24']) {
      const { fila, cadencias } = executar(caso(id).ds);
      expect(cadencias).toHaveLength(fila.itens.length);
      const fora = new Set(fila.foraDaFila.map((f) => f.empresaId));
      expect(cadencias.some((x) => fora.has(x.empresaId))).toBe(false);
    }
  });

  it('o motor nao altera fila nem plano (entradas congeladas e intactas)', () => {
    for (const c of CASOS) {
      const fila = construirCommercialQueue(c.ds, HOJE);
      const planos = planosDaFilaCM(c.ds, fila);
      const antes = JSON.stringify({ fila, planos, ds: c.ds });
      deepFreeze(fila); deepFreeze(planos); deepFreeze(c.ds);
      cadenciasDaFilaCM(c.ds, fila, planos, HOJE);
      expect(JSON.stringify({ fila, planos, ds: c.ds })).toBe(antes);
      expect(JSON.stringify(construirCommercialQueue(c.ds, HOJE))).toBe(JSON.stringify(fila));
    }
  });

  it('entradas incoerentes sao recusadas', () => {
    const c = caso('02');
    const { fila, planos } = executar(c.ds);
    expect(() => cadenciasDaFilaCM(c.ds, fila, planos, '2026-09-16')).toThrow('cadencia_hoje_divergente_da_fila');
    expect(() => cadenciasDaFilaCM(c.ds, fila, [], HOJE)).toThrow('cadencia_plano_ausente');
    const outro = executar(caso('03').ds);
    expect(() => cadenciaDaContaCM(c.ds, fila.itens[0], outro.planos[0], HOJE)).toThrow('cadencia_plano_incompativel');
  });
});

describe('CM2-B — mapa, determinismo e textos', () => {
  it('mapa razao -> estado e exaustivo; razao nova sem regra quebra', () => {
    expect(Object.keys(REGRA_TEMPORAL_CM).sort()).toEqual([...CODIGOS_RAZAO_CM].sort());
    for (const r of Object.values(REGRA_TEMPORAL_CM)) expect(ESTADOS_CADENCIA_CM).toContain(r.estado);
    const c = caso('02');
    const { fila, planos } = executar(c.ds);
    const novo = { ...fila.itens[0], porQueAgora: { ...fila.itens[0].porQueAgora, codigo: 'RAZAO_NOVA' as CodigoRazaoCM } };
    expect(() => cadenciaDaContaCM(c.ds, novo, { ...planos[0], itemId: [novo.empresaId, 'RAZAO_NOVA', ...planos[0].itemId.split(':').slice(2)].join(':') }, HOJE)).toThrow('cadencia_razao_sem_regra');
  });

  it('estados temporais nao repetem nomes de razao do CM1-A', () => {
    for (const e of ESTADOS_CADENCIA_CM) expect(CODIGOS_RAZAO_CM as readonly string[]).not.toContain(e);
  });

  it('permutacao das colecoes nao muda a recomendacao', () => {
    for (const c of CASOS) {
      const base = executar(c.ds).cadencias;
      expect(executar(permutar(c.ds, (xs) => [...xs].reverse())).cadencias).toEqual(base);
      expect(executar(permutar(c.ds, embaralhar(17))).cadencias).toEqual(base);
    }
  });

  it('mesma entrada, mesmo resultado; funciona com tudo congelado', () => {
    for (const c of CASOS) {
      const a = executar(c.ds).cadencias;
      const ds = deepFreeze(structuredClone(c.ds));
      expect(executar(ds).cadencias).toEqual(a);
      expect(executar(ds).cadencias).toEqual(a);
    }
  });

  it('cadenciaDaContaCM e cadenciasDaFilaCM concordam', () => {
    for (const c of CASOS) {
      const { fila, planos, cadencias } = executar(c.ds);
      fila.itens.forEach((item, i) => expect(cadenciaDaContaCM(c.ds, item, planos[i], HOJE)).toEqual(cadencias[i]));
    }
  });

  it('versoes presentes e separadas', () => {
    expect(VERSAO_REGRAS_CADENCIA_CM).toBe('CM2-B.1');
    expect(VERSAO_REGRAS_CADENCIA_CM).not.toContain('CM1');
    for (const c of CASOS) for (const r of executar(c.ds).cadencias) expect([r.versaoCadencia, r.versaoRegrasFila, r.versaoPlano]).toEqual([VERSAO_REGRAS_CADENCIA_CM, VERSAO_REGRAS_CM, VERSAO_REGRAS_PLANO_CM]);
  });

  it('todo estado, retomada, natureza e aviso tem texto pt-BR; toda recomendacao se explica', () => {
    for (const k of ESTADOS_CADENCIA_CM) expect(TEXTO_ESTADO_CADENCIA_CM[k]).toMatch(/\S/);
    for (const k of RETOMADAS_CADENCIA_CM) expect(TEXTO_RETOMADA_CADENCIA_CM[k]).toMatch(/\S/);
    for (const k of NATUREZAS_TOQUE_CM) expect(TEXTO_NATUREZA_TOQUE_CM[k]).toMatch(/\S/);
    for (const k of CODIGOS_AVISO_CADENCIA_CM) expect(TEXTO_AVISO_CADENCIA_CM[k]).toMatch(/\S/);
    const acento = /[ãáâéêíóôõúç]/i;
    expect(Object.values(TEXTO_AVISO_CADENCIA_CM).some((t) => acento.test(t))).toBe(true);
    for (const c of CASOS) for (const r of executar(c.ds).cadencias) {
      expect(r.explicacao.titulo).toBe(TEXTO_ESTADO_CADENCIA_CM[r.estado]);
      expect(r.explicacao.porQue).toMatch(/\S/);
      for (const a of r.avisos) expect(r.explicacao.fatos).toContain(TEXTO_AVISO_CADENCIA_CM[a]);
      if (r.proximoToque) expect(r.explicacao.fatos.some((f) => f.startsWith('Próximo toque'))).toBe(true);
    }
  });

  it('aviso nao muda estado: estado e sempre o do mapa (ou a lacuna D4)', () => {
    for (const c of CASOS) for (const r of executar(c.ds).cadencias) {
      const regra = REGRA_TEMPORAL_CM[r.motivo];
      if (r.estado !== regra.estado) expect([r.motivo, r.estado]).toEqual(['SEM_TIMING_ATUAL', 'SUGERIR_PROXIMO_PASSO']);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guarda forte do modulo de producao
// ---------------------------------------------------------------------------------------------------------------------
const FONTES_PERMITIDAS = new Set(['./commercialActionPlan', './commercialMachine', './comunicacao', './contatos', './types']);
const IDENTIFICADORES_PROIBIDOS = [/\brecomendarAcao\b/, /\bfilaHoje\b/, /\blerEmpresa\b/, /\brecomendarCanal\b/, /\bcanaisDoContato\b/, /\bfetch\s*\(/, /supabase/i, /\bReact\b/, /\bactions\./, /\blocalStorage\b/];

function violacoesDoModulo(fonte: string): string[] {
  const out: string[] = [];
  for (const m of fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!FONTES_PERMITIDAS.has(m[1])) out.push(`import proibido ${m[1]}`);
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const re of IDENTIFICADORES_PROIBIDOS) if (re.test(codigo)) out.push(`uso proibido ${re}`);
  const semLiterais = codigo
    .replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\.slice\(0,\s*10\)/g, '')
    .replace(/^const MS_POR_DIA = 86_400_000;$/m, '');
  for (const m of semLiterais.matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g)) if (m[1] !== '0' && m[1] !== '1') out.push(`literal numerico ${m[1]}`);
  if (/\/[^/\n]*\\d\{\d+\}/.test(codigo)) out.push('regex com quantificador numerico');
  return out;
}

describe('CM2-B — guarda de dependencias e de numeros de politica', () => {
  it('autoteste: pega literal de politica, import legado e fonte fora da lista', () => {
    expect(violacoesDoModulo('const x = addDays(d, 4);')).toEqual(['literal numerico 4']);
    expect(violacoesDoModulo('if (tentativas >= 5) {}')).toEqual(['literal numerico 5']);
    expect(violacoesDoModulo("import { recomendarAcao } from './pipeline';")).toEqual(['import proibido ./pipeline', 'uso proibido /\\brecomendarAcao\\b/']);
    expect(violacoesDoModulo("import { x } from '../../data/store';").length).toBe(1);
    expect(violacoesDoModulo("import { HIPOTESE_COMMERCIAL_MACHINE as H } from './commercialMachine';\nconst d = H.intervaloFollowUpDias; const v = s.slice(0, 10); const u = xs[xs.length - 1];")).toEqual([]);
  });

  it('commercialCadence.ts respeita a guarda', () => {
    const arquivo = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'commercialCadence.ts');
    expect(violacoesDoModulo(fs.readFileSync(arquivo, 'utf8'))).toEqual([]);
  });
});
