// CM2-E — Porta governada: revalidacao pura da criacao da tarefa de cadencia.
// Prova a ORDEM do contrato (expectativa -> cobertura historica -> recalculo -> comparacao de contexto -> edicoes ->
// segunda cobertura -> autorizacao) e, em especial, que o duplo clique devolve JA_COBERTA mesmo quando a sugestao
// original ja sumiu da fila — e que CONTEXTO_MUDOU fica reservado a mudanca real de contexto.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE, type Caso } from './cadenciaParidadeCM.fixtures';
import { VERSAO_REGRAS_PLANO_CM, planosDaFilaCM } from './commercialActionPlan';
import { VERSAO_REGRAS_CADENCIA_CM, cadenciasDaFilaCM } from './commercialCadence';
import { sugestoesTarefaDaFilaCM } from './commercialCadenceTask';
import {
  CODIGOS_RECUSA_COMMIT_CM, TEXTO_RECUSA_COMMIT_CM, expectativaDaSugestaoCM, revalidarCriacaoTarefaCadenciaCM, tarefaQueCobreCicloCM,
  type EdicoesHumanasCadenciaCM, type ExpectativaCriacaoCadenciaCM, type VeredictoCommitCadenciaCM,
} from './commercialCadenceCommit';
import { VERSAO_REGRAS_CM, construirCommercialQueue } from './commercialMachine';
import { type RadarDataset, type Sinal, type Supressao, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
const USUARIOS = ['u1', 'u9'];
const caso = (id: string): Caso => CASOS.find((c) => c.id === id)!;
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;

/** Expectativa exatamente como a tela a montaria a partir do que o humano viu. */
function expectativaDe(ds: RadarDataset, empresaId: string, hoje = HOJE): ExpectativaCriacaoCadenciaCM {
  const fila = construirCommercialQueue(ds, hoje);
  const planos = planosDaFilaCM(ds, fila);
  const cadencias = cadenciasDaFilaCM(ds, fila, planos, hoje);
  const sugestoes = sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, hoje);
  const i = fila.itens.findIndex((it) => it.empresaId === empresaId);
  return expectativaDaSugestaoCM(cadencias[i], sugestoes[i])!;
}
const revalidar = (ds: RadarDataset, e: ExpectativaCriacaoCadenciaCM, edicoes: EdicoesHumanasCadenciaCM = {}, hoje = HOJE) =>
  revalidarCriacaoTarefaCadenciaCM(ds, hoje, e, edicoes, { usuariosValidos: USUARIOS });
const ok = (v: VeredictoCommitCadenciaCM) => { expect(v.ok, v.ok ? '' : `${v.codigo}${v.detalhe ? ` (${v.detalhe})` : ''}`).toBe(true); return v as Extract<VeredictoCommitCadenciaCM, { ok: true }>; };

/** Materializa a tarefa autorizada no dataset, como o store faria depois do veredicto. */
function aplicar(ds: RadarDataset, v: Extract<VeredictoCommitCadenciaCM, { ok: true }>, id = 'TSK-nova', criadoEm = ts(HOJE, '12:00')): RadarDataset {
  const t: TarefaRadar = { ...v.tarefa, id, prioridade: 'Normal', status: 'Aberta', criadoEm };
  return { ...ds, tarefas: [...ds.tarefas, t] };
}
const tarefa = (id: string, empresaId: string, p: Partial<TarefaRadar>): TarefaRadar => ({ id, empresaId, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: '2026-09-25', status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-14'), ...p });
const sinalNovo = (empresaId: string): Sinal => ({
  id: 's-novo', empresaId, fonteId: 'f-news', fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade', descricao: 'Nova unidade anunciada',
  eventoEm: '2026-09-10', detectadoEm: '2026-09-14', confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-14'),
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

// Os dois ciclos reais que geram sugestao: sem oportunidade (05b) e com oportunidade (17b).
const semOportunidade = () => caso('05b').ds;
const comOportunidade = () => caso('17b').ds;

// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-E — FASE 1: a expectativa e validada e falha fechada', () => {
  it('versoes diferentes das vigentes recusam antes de qualquer calculo', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    for (const alterada of [{ ...e, versaoCadencia: 'CM2-B.0' }, { ...e, versaoRegrasFila: 'CM1-A.0' }, { ...e, versaoPlano: 'CM1-B.0' }]) {
      expect(revalidar(ds, alterada)).toMatchObject({ ok: false, codigo: 'VERSAO_DIVERGENTE' });
    }
    expect(e.versaoCadencia).toBe(VERSAO_REGRAS_CADENCIA_CM);
    expect([e.versaoRegrasFila, e.versaoPlano]).toEqual([VERSAO_REGRAS_CM, VERSAO_REGRAS_PLANO_CM]);
  });

  it('expectativa adulterada ou incoerente nunca cria tarefa', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const casos: [string, ExpectativaCriacaoCadenciaCM][] = [
      ['chave que não corresponde aos campos', { ...e, chave: `${e.chave}:x` }],
      ['contato trocado sem recalcular a chave', { ...e, contatoId: 'c-outro' }],
      ['oportunidade injetada sem recalcular a chave', { ...e, oportunidadeId: 'o-falsa' }],
      ['motivo fora do catálogo', { ...e, motivo: 'MOTIVO_INEXISTENTE' as ExpectativaCriacaoCadenciaCM['motivo'] }],
      ['tipo fora do catálogo', { ...e, tipoTarefa: 'TIPO_INEXISTENTE' as ExpectativaCriacaoCadenciaCM['tipoTarefa'] }],
      ['âncora no futuro', { ...e, ancora: { ...e.ancora, em: '2026-09-20' } }],
      ['âncora sem id', { ...e, ancora: { ...e.ancora, id: ' ' } }],
      ['data recomendada inválida', { ...e, dataRecomendada: '2026-13-40' }],
      ['empresa inexistente', { ...e, empresaId: 'empresa-fantasma' }],
      ['itemId vazio', { ...e, itemId: '' }],
    ];
    for (const [nome, expectativa] of casos) expect(revalidar(ds, expectativa), nome).toMatchObject({ ok: false, codigo: 'EXPECTATIVA_INCOERENTE' });
  });
});

describe('CM2-E — FASE 2: cobertura do ciclo historico vem antes da fila atual', () => {
  it('duplo clique: a mesma expectativa devolve JA_COBERTA com a tarefa criada, mesmo sem a sugestao existir mais', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const primeira = ok(revalidar(ds, e));
    const depois = aplicar(ds, primeira, 'TSK-1');

    // a fila mudou: a conta virou compromisso agendado e a sugestao original nao existe mais
    const fila = construirCommercialQueue(depois, HOJE);
    const planos = planosDaFilaCM(depois, fila);
    const cadencias = cadenciasDaFilaCM(depois, fila, planos, HOJE);
    const sugestoes = sugestoesTarefaDaFilaCM(depois, fila, planos, cadencias, HOJE);
    const item = fila.itens.find((i) => i.empresaId === 'posdepois')!;
    expect(item.porQueAgora.codigo).toBe('PROXIMA_ACAO_HOJE'); // a data recomendada era hoje: o compromisso vence hoje
    expect(sugestoes.some((s) => s.chave === e.chave)).toBe(false);

    const segunda = revalidar(depois, e);
    expect(segunda).toEqual({ ok: false, codigo: 'JA_COBERTA', tarefaId: 'TSK-1' });
  });

  it('duplo clique com oportunidade: cobre pela mesma oportunidade', () => {
    const ds = comOportunidade(); const e = expectativaDe(ds, 'oppsem');
    const depois = aplicar(ds, ok(revalidar(ds, e)), 'TSK-opp');
    expect(revalidar(depois, e)).toEqual({ ok: false, codigo: 'JA_COBERTA', tarefaId: 'TSK-opp' });
  });

  it('dataset velho: tarefa criada em outra aba, com outro contato, cobre o ciclo sem contato definido', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(e.contatoId).toBeUndefined();
    const outraAba = { ...ds, tarefas: [...ds.tarefas, tarefa('TSK-2', 'posdepois', { contatoId: 'c-posdepois', tipo: 'CALL', criadoEm: ts('2026-09-15', '08:00') })] };
    expect(revalidar(outraAba, e)).toEqual({ ok: false, codigo: 'JA_COBERTA', tarefaId: 'TSK-2' });
  });

  it('tarefa anterior a ancora nao e cobertura historica', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(tarefaQueCobreCicloCM({ ...ds, tarefas: [...ds.tarefas, tarefa('TSK-velha', 'posdepois', { criadoEm: ts('2026-09-09') })] },
      { empresaId: 'posdepois', tipoTarefa: e.tipoTarefa, desdeDia: e.ancora.em })).toBeUndefined();
  });
});

describe('CM2-E — FASE 3/4: contexto atual', () => {
  it('sinal novo muda a razao principal: sem cobertura, o resultado e CONTEXTO_MUDOU', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const comSinal = { ...ds, sinais: [...ds.sinais, sinalNovo('posdepois')] };
    expect(construirCommercialQueue(comSinal, HOJE).itens[0].porQueAgora.codigo).toBe('SINAL_ACIONAVEL_NOVO');
    expect(tarefaQueCobreCicloCM(comSinal, { empresaId: 'posdepois', tipoTarefa: e.tipoTarefa, desdeDia: e.ancora.em })).toBeUndefined();
    expect(revalidar(comSinal, e)).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
  });

  it('GUARDA 1: recomendacao diferente da que o humano viu recusa, mesmo com a chave igual', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(revalidar(ds, { ...e, dataRecomendada: '2026-09-30' })).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
    // a mesma expectativa lida noutro dia tem outra recomendacao: nao substituir silenciosamente
    const outroDia = expectativaDe(ds, 'posdepois', '2026-09-11');
    expect(outroDia.dataRecomendada).not.toBe(e.dataRecomendada);
    expect(revalidar(ds, outroDia, {}, HOJE)).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
  });

  it('GUARDA 2: itemId ou tipo divergentes recusam mesmo com chave coerente', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(revalidar(ds, { ...e, itemId: `${e.itemId}:x` })).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
    expect(revalidar(ds, { ...e, tipoTarefa: 'RESEARCH' })).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
  });

  it('conta que saiu da fila recusa por contexto', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const supressao: Supressao = { id: 'sup-1', empresaId: 'posdepois', tipo: 'do_not_contact', motivo: 'pediu', criadoPor: 'u1', criadoEm: ts('2026-09-15', '09:00') };
    const suprimida = { ...ds, supressoes: [...ds.supressoes, supressao] };
    expect(construirCommercialQueue(suprimida, HOJE).itens).toHaveLength(0);
    expect(revalidar(suprimida, e)).toMatchObject({ ok: false, codigo: 'CONTEXTO_MUDOU' });
  });
});

describe('CM2-E — FASE 5: edicoes humanas', () => {
  it('sem edicoes, autoriza exatamente o que a sugestao atual propoe', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const v = ok(revalidar(ds, e));
    expect(v.tarefa).toEqual({ empresaId: 'posdepois', tipo: 'FOLLOW_UP', venceEm: e.dataRecomendada, descricao: 'Conta relevante sem momento comercial atual', responsavelId: 'u1', contatoId: undefined, oportunidadeId: undefined });
    expect(v.origem).toMatchObject({ chave: e.chave, itemId: e.itemId, motivo: 'SEM_TIMING_ATUAL', dataRecomendada: e.dataRecomendada, dataEditada: false, descricaoEditada: false, contatoEditado: false, versaoCadencia: VERSAO_REGRAS_CADENCIA_CM });
    expect(Object.keys(v.tarefa)).not.toContain('id');
  });

  it('data, descricao, responsavel e contato podem mudar; tipo e oportunidade nao aparecem nas edicoes', () => {
    const ds = comOportunidade(); const e = expectativaDe(ds, 'oppsem');
    const v = ok(revalidar(ds, e, { venceEm: '2026-09-29', descricao: '  Ligar para fechar a próxima etapa  ', responsavelId: 'u9', contatoId: 'c-oppsem' }));
    expect(v.tarefa).toMatchObject({ tipo: e.tipoTarefa, oportunidadeId: 'o1', venceEm: '2026-09-29', descricao: 'Ligar para fechar a próxima etapa', responsavelId: 'u9', contatoId: 'c-oppsem' });
    expect(v.origem).toMatchObject({ dataEditada: true, descricaoEditada: true, contatoEditado: true });
  });

  it('recusa data invalida, data no passado e descricao vazia', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(revalidar(ds, e, { venceEm: '2026-02-31' })).toMatchObject({ ok: false, codigo: 'DATA_INVALIDA' });
    expect(revalidar(ds, e, { venceEm: '2026-09-14' })).toMatchObject({ ok: false, codigo: 'DATA_NO_PASSADO' });
    expect(revalidar(ds, e, { descricao: '   ' })).toMatchObject({ ok: false, codigo: 'DESCRICAO_VAZIA' });
    expect(revalidar(ds, e, { venceEm: HOJE })).toMatchObject({ ok: true });
  });

  it('responsavel: nunca um padrao; ausente ou desconhecido recusa', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(revalidar(ds, e, { responsavelId: 'u-fantasma' })).toMatchObject({ ok: false, codigo: 'RESPONSAVEL_NECESSARIO' });
    const semDono = { ...ds, atividades: ds.atividades.map((a) => ({ ...a, usuarioId: '' })) };
    const eSemDono = expectativaDe(semDono, 'posdepois');
    expect(revalidar(semDono, eSemDono)).toMatchObject({ ok: false, codigo: 'RESPONSAVEL_NECESSARIO' });
    expect(ok(revalidar(semDono, eSemDono, { responsavelId: 'u9' })).tarefa.responsavelId).toBe('u9');
  });

  it('contato: inexistente, de outra empresa ou inelegivel recusam; nunca troca sozinho', () => {
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    expect(revalidar(ds, e, { contatoId: 'c-fantasma' })).toMatchObject({ ok: false, codigo: 'CONTATO_INVALIDO' });
    const deOutra = { ...ds, contatos: [...ds.contatos, { ...ds.contatos[0], id: 'c-alheio', empresaId: 'outra' }] };
    expect(revalidar(deOutra, e, { contatoId: 'c-alheio' })).toMatchObject({ ok: false, codigo: 'CONTATO_INVALIDO' });
    const suprimido: Supressao = { id: 'sup-c', contatoId: 'c-posdepois', tipo: 'opt_out', motivo: 'pediu', criadoPor: 'u1', criadoEm: ts('2026-09-15', '09:00') };
    const v = revalidar({ ...ds, supressoes: [...ds.supressoes, suprimido] }, e, { contatoId: 'c-posdepois' });
    expect(v).toMatchObject({ ok: false });
    expect(v.ok ? '' : v.codigo).toMatch(/CONTATO_INVALIDO|CONTEXTO_MUDOU/);
  });

  it('tipo com canal obrigatorio exige contato com aquele canal acionavel', () => {
    const ds = comOportunidade(); const e = expectativaDe(ds, 'oppsem');
    // o contato da conta so tem e-mail: uma tarefa CALL nao pode ser autorizada por ele
    const semTelefone = revalidarCriacaoTarefaCadenciaCM(ds, HOJE, { ...e, tipoTarefa: e.tipoTarefa }, { contatoId: 'c-oppsem' }, { usuariosValidos: USUARIOS });
    expect(semTelefone).toMatchObject({ ok: true }); // FOLLOW_UP nao exige canal
    const supressao: Supressao = { id: 'sup-mail', contatoId: 'c-oppsem', tipo: 'email_bounced', motivo: 'bounce', criadoPor: 'u1', criadoEm: ts('2026-09-15', '09:00') };
    const semCanal = { ...ds, supressoes: [...ds.supressoes, supressao] };
    const eSemCanal = expectativaDe(semCanal, 'oppsem');
    expect(revalidar(semCanal, eSemCanal, { contatoId: 'c-oppsem' })).toMatchObject({ ok: true }); // continua FOLLOW_UP
  });
});

describe('CM2-E — pureza, textos e ordem', () => {
  it('nao altera o dataset e e deterministica', () => {
    const ds = deepFreeze(structuredClone(semOportunidade()));
    const e = expectativaDe(ds, 'posdepois');
    const antes = JSON.stringify(ds);
    const a = revalidar(ds, e); const b = revalidar(ds, e);
    expect(a).toEqual(b);
    expect(JSON.stringify(ds)).toBe(antes);
  });

  it('a cobertura historica e avaliada antes do recalculo: cobertura vence contexto mudado', () => {
    // ha tarefa cobrindo E sinal novo mudando a razao: o resultado tem de ser JA_COBERTA, nao CONTEXTO_MUDOU
    const ds = semOportunidade(); const e = expectativaDe(ds, 'posdepois');
    const ambos = { ...ds, sinais: [...ds.sinais, sinalNovo('posdepois')], tarefas: [...ds.tarefas, tarefa('TSK-3', 'posdepois', { criadoEm: ts('2026-09-15', '08:00') })] };
    expect(revalidar(ambos, e)).toEqual({ ok: false, codigo: 'JA_COBERTA', tarefaId: 'TSK-3' });
  });

  it('todo codigo de recusa tem texto pt-BR', () => {
    for (const c of CODIGOS_RECUSA_COMMIT_CM) expect(TEXTO_RECUSA_COMMIT_CM[c]).toMatch(/\S/);
    expect(Object.keys(TEXTO_RECUSA_COMMIT_CM).sort()).toEqual([...CODIGOS_RECUSA_COMMIT_CM].sort());
  });

  it('expectativaDaSugestaoCM so existe com sugestao datada e recomendada', () => {
    const ds = caso('02').ds; // AGUARDANDO: nao ha sugestao de compromisso
    const fila = construirCommercialQueue(ds, HOJE);
    const planos = planosDaFilaCM(ds, fila);
    const cadencias = cadenciasDaFilaCM(ds, fila, planos, HOJE);
    const sugestoes = sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, HOJE);
    expect(expectativaDaSugestaoCM(cadencias[0], sugestoes[0])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guarda do modulo de producao: projecao pura, sem escrita e sem id
// ---------------------------------------------------------------------------------------------------------------------
const FONTES_PERMITIDAS = new Set(['./commercialActionPlan', './commercialCadence', './commercialCadenceTask', './commercialMachine', './contatos', './types']);
const PROIBIDOS = [/\bstore\b/, /\bactions\b/, /supabase/i, /netlify/i, /\bfetch\s*\(/, /localStorage/, /\bids\.novo\b/, /randomUUID|crypto/, /Date\.now|new Date\(\)/, /migration/i, /\bcommit\s*\(/, /\bregistrar\s*\(/, /\brecomendarAcao\b/, /\bfilaHoje\b/, /pipeline/];

function violacoes(fonte: string): string[] {
  const out: string[] = [];
  for (const m of fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!FONTES_PERMITIDAS.has(m[1])) out.push(`import proibido ${m[1]}`);
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const semStrings = codigo.replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  for (const re of PROIBIDOS) if (re.test(semStrings)) out.push(`uso proibido ${re}`);
  for (const m of semStrings.replace(/\.slice\(0,\s*10\)/g, '').matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g)) if (m[1] !== '0' && m[1] !== '1') out.push(`literal numerico ${m[1]}`);
  return out;
}

describe('CM2-E — guarda do modulo', () => {
  it('autoteste da guarda', () => {
    expect(violacoes("import { actions } from '../../data/store';")).toEqual(['import proibido ../../data/store', 'uso proibido /\\bactions\\b/']);
    expect(violacoes('const id = crypto.randomUUID();')).toEqual(['uso proibido /randomUUID|crypto/']);
    expect(violacoes('const venceEm = somar(ancora, 4);')).toEqual(['literal numerico 4']);
    expect(violacoes("import { contatoElegivel } from './contatos';\nconst d = v.slice(0, 10);")).toEqual([]);
  });

  it('commercialCadenceCommit.ts nao escreve, nao gera id e nao usa numero de politica', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const fonte = fs.readFileSync(path.join(dir, 'commercialCadenceCommit.ts'), 'utf8');
    expect(violacoes(fonte)).toEqual([]);
    expect(fonte).toMatch(/D-E1/);
  });
});
