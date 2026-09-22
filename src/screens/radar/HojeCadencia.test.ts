// CM2-D2 — decisoes de apresentacao do agendamento governado.
// A suite do projeto roda em node e nao renderiza React: o que a tela decide foi extraido para funcoes puras (aqui
// provadas caso a caso, inclusive sobre cadencias e sugestoes REAIS dos motores) e o que so existe no JSX e preso por
// guardas estaticas — nenhuma tarefa nasce fora de actions.criarTarefaDaCadenciaCM, nenhuma reacao olha texto de erro.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE } from '../../core/radar/cadenciaParidadeCM.fixtures';
import { planosDaFilaCM } from '../../core/radar/commercialActionPlan';
import { cadenciasDaFilaCM, type CadenceRecommendationCM } from '../../core/radar/commercialCadence';
import { sugestoesTarefaDaFilaCM, type EstadoSugestaoTarefaCM, type TaskSuggestionCM } from '../../core/radar/commercialCadenceTask';
import { CODIGOS_RECUSA_COMMIT_CM, expectativaDaSugestaoCM, type CodigoRecusaCommitCM } from '../../core/radar/commercialCadenceCommit';
import { construirCommercialQueue } from '../../core/radar/commercialMachine';
import {
  MENSAGEM_AGENDADA_CM, MENSAGEM_SEM_EXPECTATIVA_CM, ROTULO_CTA_CADENCIA, TEXTO_CONFLITO_CADENCIA_CM, TITULO_CONFLITO_CADENCIA_CM,
  MENSAGEM_RESPONSAVEL_VAZIO_CM, abrirAgendamentoCM, campoDaRecusaCadenciaCM, ctaCadenciaCM, edicoesDoFormularioCM, mantemFormularioAbertoCM, reacaoDaRecusaCadenciaCM, validarFormularioAgendamentoCM,
  type CamposAgendamentoCM,
} from './HojeCadencia';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
/** Cadencias e sugestoes reais: a cadeia inteira dos motores, como a Hoje monta. */
function reais(): { cadencia: CadenceRecommendationCM; sugestao: TaskSuggestionCM }[] {
  const saida: { cadencia: CadenceRecommendationCM; sugestao: TaskSuggestionCM }[] = [];
  for (const caso of CASOS) {
    const fila = construirCommercialQueue(caso.ds, HOJE);
    const planos = planosDaFilaCM(caso.ds, fila);
    const cadencias = cadenciasDaFilaCM(caso.ds, fila, planos, HOJE);
    const sugestoes = sugestoesTarefaDaFilaCM(caso.ds, fila, planos, cadencias, HOJE);
    sugestoes.forEach((sugestao, i) => saida.push({ cadencia: cadencias[i], sugestao }));
  }
  return saida;
}
const TODOS = reais();
/** Primeiro par real de que sai expectativa (ciclo D4: proximo toque RECOMENDADO e datado). */
const comExpectativa = TODOS.find((x) => expectativaDaSugestaoCM(x.cadencia, x.sugestao))!;
const sugestaoFalsa = (estado: EstadoSugestaoTarefaCM, tarefa?: TaskSuggestionCM['tarefa']): TaskSuggestionCM => ({
  ...comExpectativa.sugestao, estado, tarefa,
});
const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const FONTE_HOJE = leia('Hoje.tsx');
const FONTE_COMUM = leia('comum.tsx');
/** Corpo do formulario governado, isolado do resto do arquivo compartilhado. */
const FORMULARIO = (() => {
  const i = FONTE_COMUM.indexOf('export function TarefaCadenciaForm');
  const j = FONTE_COMUM.indexOf('\nexport function ', i + 1);
  expect(i, 'TarefaCadenciaForm existe em comum.tsx').toBeGreaterThan(-1);
  return FONTE_COMUM.slice(i, j);
})();

// ---------------------------------------------------------------------------------------------------------------------
// CTA: so nos dois estados que admitem criacao, so com rascunho, so com permissao
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2 · CTA do proximo compromisso', () => {
  it('SUGERIDA com rascunho oferece "Agendar próxima ação"', () => {
    expect(ctaCadenciaCM(sugestaoFalsa('SUGERIDA', comExpectativa.sugestao.tarefa), true)).toBe('Agendar próxima ação');
  });
  it('REQUER_RESPONSAVEL com rascunho oferece "Definir responsável e agendar"', () => {
    expect(ctaCadenciaCM(sugestaoFalsa('REQUER_RESPONSAVEL', comExpectativa.sugestao.tarefa), true)).toBe('Definir responsável e agendar');
  });
  it.each(['COBERTA', 'REQUER_DATA', 'BLOQUEADA', 'NAO_APLICAVEL'] as const)('%s nunca oferece CTA', (estado) => {
    expect(ctaCadenciaCM(sugestaoFalsa(estado, comExpectativa.sugestao.tarefa), true)).toBeUndefined();
  });
  it('sem rascunho de tarefa nao ha CTA, mesmo em SUGERIDA', () => {
    expect(ctaCadenciaCM(sugestaoFalsa('SUGERIDA', undefined), true)).toBeUndefined();
  });
  it('sem permissao de agir nao ha CTA', () => {
    expect(ctaCadenciaCM(sugestaoFalsa('SUGERIDA', comExpectativa.sugestao.tarefa), false)).toBeUndefined();
  });
  it('o catalogo de rotulos cobre exatamente os dois estados que criam tarefa', () => {
    expect(Object.keys(ROTULO_CTA_CADENCIA).sort()).toEqual(['REQUER_RESPONSAVEL', 'SUGERIDA']);
  });
  it('toda sugestao real em outro estado fica sem CTA', () => {
    for (const { sugestao } of TODOS) {
      if (sugestao.estado === 'SUGERIDA' || sugestao.estado === 'REQUER_RESPONSAVEL') continue;
      expect(ctaCadenciaCM(sugestao, true)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Abertura: snapshot do clique, sem remontar chave/ancora/versao na tela
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2 · abertura do formulario', () => {
  it('usa a expectativa do motor, sem reconstruir nada', () => {
    const a = abrirAgendamentoCM(comExpectativa.cadencia, comExpectativa.sugestao);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.expectativa).toEqual(expectativaDaSugestaoCM(comExpectativa.cadencia, comExpectativa.sugestao));
    expect(a.expectativa.chave).toBe(comExpectativa.sugestao.chave);
    expect(a.expectativa.versaoCadencia).toBe(comExpectativa.cadencia.versaoCadencia);
    expect(a.empresaId).toBe(comExpectativa.sugestao.empresaId);
  });
  it('os campos nascem do rascunho do motor', () => {
    const a = abrirAgendamentoCM(comExpectativa.cadencia, comExpectativa.sugestao);
    if (!a.ok) throw new Error('esperava abertura');
    const t = comExpectativa.sugestao.tarefa!;
    expect(a.campos.venceEm).toBe(t.venceEm);
    expect(a.campos.descricao).toBe(t.descricaoBase);
    expect(a.campos.contatoId).toBe(t.contatoId ?? '');
  });
  it('responsavel nunca e inventado: vem do rascunho ou fica vazio', () => {
    for (const { cadencia, sugestao } of TODOS) {
      const a = abrirAgendamentoCM(cadencia, sugestao);
      if (!a.ok) continue;
      expect(a.campos.responsavelId).toBe(sugestao.tarefa?.responsavelId ?? '');
    }
    // REQUER_RESPONSAVEL: o campo nasce vazio, sem padrao e sem cair no usuario da sessao
    const semDono = { ...comExpectativa.sugestao, estado: 'REQUER_RESPONSAVEL' as const, tarefa: { ...comExpectativa.sugestao.tarefa!, responsavelId: undefined } };
    const a = abrirAgendamentoCM(comExpectativa.cadencia, semDono);
    if (!a.ok) throw new Error('esperava abertura');
    expect(a.campos.responsavelId).toBe('');
  });
  it('contato so e editavel quando a sugestao nao define contato', () => {
    for (const { cadencia, sugestao } of TODOS) {
      const a = abrirAgendamentoCM(cadencia, sugestao);
      if (!a.ok) continue;
      expect(a.campos.contatoEditavel).toBe(!sugestao.tarefa?.contatoId);
    }
    const comContato = { ...comExpectativa.sugestao, tarefa: { ...comExpectativa.sugestao.tarefa!, contatoId: 'c-x' } };
    const a = abrirAgendamentoCM(comExpectativa.cadencia, comContato);
    if (!a.ok) throw new Error('esperava abertura');
    expect(a.campos.contatoEditavel).toBe(false);
    expect(a.campos.contatoId).toBe('c-x');
  });
  it('falha fechada: sem chave, sem rascunho ou sem toque recomendado o formulario nao abre', () => {
    const { cadencia, sugestao } = comExpectativa;
    expect(abrirAgendamentoCM(cadencia, { ...sugestao, chave: undefined }).ok).toBe(false);
    expect(abrirAgendamentoCM(cadencia, { ...sugestao, tarefa: undefined }).ok).toBe(false);
    expect(abrirAgendamentoCM({ ...cadencia, proximoToque: undefined }, sugestao).ok).toBe(false);
    expect(abrirAgendamentoCM({ ...cadencia, proximoToque: { ...cadencia.proximoToque!, natureza: 'FIRME' } }, sugestao).ok).toBe(false);
  });
  it('toda sugestao real sem expectativa e recusada na abertura', () => {
    for (const { cadencia, sugestao } of TODOS) {
      const temExpectativa = !!expectativaDaSugestaoCM(cadencia, sugestao);
      expect(abrirAgendamentoCM(cadencia, sugestao).ok).toBe(temExpectativa);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Edicoes humanas: so os quatro campos do contrato
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2 · edicoes enviadas a fronteira', () => {
  const campos: CamposAgendamentoCM = { venceEm: '2026-09-30', descricao: 'Retomar conversa', responsavelId: 'u1', contatoId: 'c1', contatoEditavel: true };
  it('leva exatamente venceEm, descricao, responsavelId e contatoId', () => {
    expect(Object.keys(edicoesDoFormularioCM(campos)).sort()).toEqual(['contatoId', 'descricao', 'responsavelId', 'venceEm']);
  });
  it('nao inventa tipo, prioridade nem oportunidade', () => {
    const e = edicoesDoFormularioCM(campos) as Record<string, unknown>;
    for (const proibido of ['tipo', 'prioridade', 'oportunidadeId', 'id', 'empresaId', 'status']) expect(e[proibido]).toBeUndefined();
  });
  it('vazio vira ausente (nunca string vazia) para responsavel e contato', () => {
    const e = edicoesDoFormularioCM({ ...campos, responsavelId: '', contatoId: '' });
    expect(e.responsavelId).toBeUndefined();
    expect(e.contatoId).toBeUndefined();
  });
  it('preserva o que o humano digitou, sem normalizar por conta propria', () => {
    const e = edicoesDoFormularioCM({ ...campos, descricao: '  espaco  ', venceEm: '2026-01-02' });
    expect(e.descricao).toBe('  espaco  ');
    expect(e.venceEm).toBe('2026-01-02');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Reacao a recusa: sempre pelo CODIGO
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2 · reacao as recusas da fronteira', () => {
  it('todo codigo do catalogo tem reacao definida', () => {
    for (const c of CODIGOS_RECUSA_COMMIT_CM) expect(reacaoDaRecusaCadenciaCM(c)).toBeTruthy();
  });
  it('JA_COBERTA vira conflito de compromisso ja agendado', () => {
    expect(reacaoDaRecusaCadenciaCM('JA_COBERTA')).toBe('JA_COBERTA');
    expect(TITULO_CONFLITO_CADENCIA_CM.JA_COBERTA).toBe('Esta ação já foi agendada.');
    expect(TEXTO_CONFLITO_CADENCIA_CM.JA_COBERTA).toBe('Já existe uma tarefa aberta cobrindo este ciclo.');
  });
  it('CONTEXTO_MUDOU e EXPECTATIVA_INCOERENTE mandam revisar a conta', () => {
    expect(reacaoDaRecusaCadenciaCM('CONTEXTO_MUDOU')).toBe('CONTEXTO');
    expect(reacaoDaRecusaCadenciaCM('EXPECTATIVA_INCOERENTE')).toBe('CONTEXTO');
    expect(TITULO_CONFLITO_CADENCIA_CM.CONTEXTO).toBe('A situação desta conta mudou.');
    expect(TEXTO_CONFLITO_CADENCIA_CM.CONTEXTO).toContain('recalculou esta conta desde que o formulário foi aberto');
  });
  it('VERSAO_DIVERGENTE pede reabrir a recomendacao', () => {
    expect(reacaoDaRecusaCadenciaCM('VERSAO_DIVERGENTE')).toBe('VERSAO');
    expect(TEXTO_CONFLITO_CADENCIA_CM.VERSAO).toContain('Reabra a recomendação antes de agendar');
  });
  it('REQUER_DATA e BLOQUEADA sao defensivos e mostram pendencias', () => {
    expect(reacaoDaRecusaCadenciaCM('REQUER_DATA')).toBe('PENDENCIA');
    expect(reacaoDaRecusaCadenciaCM('BLOQUEADA')).toBe('PENDENCIA');
  });
  it.each(['RESPONSAVEL_NECESSARIO', 'DATA_INVALIDA', 'DATA_NO_PASSADO', 'DESCRICAO_VAZIA', 'CONTATO_INVALIDO', 'CANAL_INDISPONIVEL'] as const)('%s mantem o formulario aberto para correcao', (codigo) => {
    expect(reacaoDaRecusaCadenciaCM(codigo)).toBe('CAMPO');
    expect(mantemFormularioAbertoCM(codigo)).toBe(true);
  });
  it.each(['JA_COBERTA', 'CONTEXTO_MUDOU', 'VERSAO_DIVERGENTE', 'EXPECTATIVA_INCOERENTE', 'REQUER_DATA', 'BLOQUEADA'] as const)('%s fecha o formulario e vira conflito', (codigo) => {
    expect(mantemFormularioAbertoCM(codigo)).toBe(false);
  });
  it('cada recusa corrigivel aponta o campo certo; as demais nao apontam campo', () => {
    const esperado: Partial<Record<CodigoRecusaCommitCM, string>> = {
      DATA_INVALIDA: 'venceEm', DATA_NO_PASSADO: 'venceEm', RESPONSAVEL_NECESSARIO: 'responsavelId',
      CONTATO_INVALIDO: 'contatoId', CANAL_INDISPONIVEL: 'contatoId', DESCRICAO_VAZIA: 'descricao',
    };
    for (const c of CODIGOS_RECUSA_COMMIT_CM) expect(campoDaRecusaCadenciaCM(c)).toBe(esperado[c]);
  });
  it('a mensagem de sucesso e a de recomendacao vencida sao as combinadas', () => {
    expect(MENSAGEM_AGENDADA_CM).toBe('Próxima ação agendada.');
    expect(MENSAGEM_SEM_EXPECTATIVA_CM).toContain('Veja a fila atualizada');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guardas estaticas: o que so existe no JSX
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2 · guardas da tela', () => {
  it('o formulario governado grava exclusivamente pela fronteira', () => {
    expect(FORMULARIO.match(/actions\.criarTarefaDaCadenciaCM\(/g)).toHaveLength(1);
    for (const proibido of ['salvarTarefaRadar', 'novaTarefaRadar', 'concluirTarefaRadar', 'registrarAtividadeRadar', 'persistir']) {
      expect(FORMULARIO, `o formulario governado nao pode chamar ${proibido}`).not.toContain(proibido);
    }
  });
  it('o formulario governado nao decide identidade, tipo, prioridade nem canal', () => {
    for (const proibido of ['TIPOS_TAREFA', 'CANAIS', 'novoId', 'crypto.randomUUID', 'Math.random']) {
      expect(FORMULARIO, `o formulario governado nao pode conter ${proibido}`).not.toContain(proibido);
    }
    // "prioridade" so pode aparecer como texto explicativo ao humano, nunca como campo que o formulario decide
    expect(FORMULARIO).not.toMatch(/prioridade\s*[:=]/);
  });
  it('a reacao ao erro nunca le o texto da mensagem', () => {
    for (const fonte of [FONTE_HOJE, FORMULARIO]) {
      expect(fonte).not.toMatch(/message\s*\.\s*includes/);
      expect(fonte).not.toMatch(/message\s*\.\s*(startsWith|match|indexOf)/);
    }
    expect(FORMULARIO).toContain('e instanceof RegraCadenciaCommitError');
    expect(FORMULARIO).toContain('reacaoDaRecusaCadenciaCM(e.codigo)');
  });
  it('a tarefa ja existente e aberta pelo id exato da recusa, so por clique', () => {
    expect(FORMULARIO).toContain('ds.radar.tarefas.find((t) => t.id === e.tarefaId)');
    expect(FORMULARIO).toContain('onClick={() => onAbrirTarefa(');
  });
  it('a Hoje abre o formulario pelo snapshot do clique e nao monta expectativa', () => {
    expect(FONTE_HOJE).toContain('abrirAgendamentoCM(cadencia, sugestao)');
    expect(FONTE_HOJE).not.toContain('chaveCadenciaCM');
    expect(FONTE_HOJE).not.toContain('expectativaDaSugestaoCM');
    expect(FONTE_HOJE).toMatch(/if \(!abertura\.ok\)/);
  });
  it('a Hoje nao cria tarefa a partir da cadencia por outro caminho', () => {
    // UX-2.1: a apresentacao da cadencia mora no bloco compartilhado (ComercialFoco); o CTA continua sendo montado
    // na Hoje, com a mesma autoridade, e o bloco so recebe o no pronto.
    const foco = leia('ComercialFoco.tsx');
    for (const proibido of ['novaTarefa(', 'salvarTarefaRadar', 'actions.', 'criarTarefaDaCadenciaCM']) expect(foco).not.toContain(proibido);
    const i = FONTE_HOJE.indexOf('function ctaCadenciaDe');
    const cta = FONTE_HOJE.slice(i, FONTE_HOJE.indexOf('\n  }', i));
    for (const proibido of ['novaTarefa(', 'salvarTarefaRadar', 'actions.']) expect(cta).not.toContain(proibido);
    expect(cta).toContain('abrirAgendamento(l.cadencia, l.sugestao)');
    expect(cta, 'o CTA respeita a permissao do papel').toContain('ctaCadenciaCM(l.sugestao, podeAgir)');
  });
  it('o TarefaForm legado segue intacto', () => {
    const i = FONTE_COMUM.indexOf('export function TarefaForm');
    const legado = FONTE_COMUM.slice(i, FONTE_COMUM.indexOf('\n// ---', i + 1)); // para antes do cabecalho do CM2-D2
    expect(legado).toContain('actions.salvarTarefaRadar(t)');
    expect(legado).toContain('TIPOS_TAREFA');
    expect(legado).not.toContain('criarTarefaDaCadenciaCM');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CM2-D2.1 — responsavel vazio e decisao do humano, nunca "nao editado"
// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-D2.1 · guarda do responsavel vazio', () => {
  const base: CamposAgendamentoCM = { venceEm: '2026-09-30', descricao: 'Retomar conversa', responsavelId: 'u1', contatoId: '', contatoEditavel: true };
  it('campo vazio bloqueia com mensagem no responsavel', () => {
    expect(validarFormularioAgendamentoCM({ ...base, responsavelId: '' })).toEqual({ campo: 'responsavelId', mensagem: MENSAGEM_RESPONSAVEL_VAZIO_CM });
    expect(MENSAGEM_RESPONSAVEL_VAZIO_CM).toBe('Informe quem será responsável pela tarefa.');
  });
  it('so espaco em branco tambem e vazio', () => {
    expect(validarFormularioAgendamentoCM({ ...base, responsavelId: '   ' })?.campo).toBe('responsavelId');
  });
  it('campo preenchido libera o caminho da fronteira', () => {
    expect(validarFormularioAgendamentoCM(base)).toBeUndefined();
  });
  it('sugestao sem responsavel abre vazia e ja nasce bloqueada ate o humano escolher', () => {
    const semDono = { ...comExpectativa.sugestao, estado: 'REQUER_RESPONSAVEL' as const, tarefa: { ...comExpectativa.sugestao.tarefa!, responsavelId: undefined } };
    const a = abrirAgendamentoCM(comExpectativa.cadencia, semDono);
    if (!a.ok) throw new Error('esperava abertura');
    expect(a.campos.responsavelId).toBe('');
    expect(validarFormularioAgendamentoCM(a.campos)?.campo).toBe('responsavelId');
  });
  it('sugestao com responsavel: limpar o campo bloqueia em vez de reaproveitar o do motor', () => {
    const a = abrirAgendamentoCM(comExpectativa.cadencia, comExpectativa.sugestao);
    if (!a.ok) throw new Error('esperava abertura');
    expect(a.campos.responsavelId).toBe(comExpectativa.sugestao.tarefa!.responsavelId);
    expect(validarFormularioAgendamentoCM(a.campos)).toBeUndefined();
    expect(validarFormularioAgendamentoCM({ ...a.campos, responsavelId: '' })?.campo).toBe('responsavelId');
  });
  it('a guarda nao valida dominio: data, contato, descricao e oportunidade seguem com o CM2-E', () => {
    expect(validarFormularioAgendamentoCM({ ...base, venceEm: '2020-01-01' })).toBeUndefined();
    expect(validarFormularioAgendamentoCM({ ...base, descricao: '' })).toBeUndefined();
    expect(validarFormularioAgendamentoCM({ ...base, contatoId: 'c-inexistente' })).toBeUndefined();
    expect(validarFormularioAgendamentoCM({ ...base, responsavelId: 'u-inexistente' })).toBeUndefined();
  });
  it('o contrato do CM2-E nao mudou: vazio continua virando ausente nas edicoes', () => {
    expect(edicoesDoFormularioCM({ ...base, responsavelId: '' }).responsavelId).toBeUndefined();
  });
  it('o Save confere o responsavel ANTES de chamar a fronteira e retorna sem gravar', () => {
    const i = FORMULARIO.indexOf('validarFormularioAgendamentoCM(campos)');
    const j = FORMULARIO.indexOf('actions.criarTarefaDaCadenciaCM(');
    expect(i, 'a guarda existe no Save').toBeGreaterThan(-1);
    expect(i, 'a guarda vem antes da fronteira').toBeLessThan(j);
    expect(FORMULARIO).toMatch(/if \(pendente\) \{ setErro\(pendente\); return; \}/);
  });
  it('o formulario nunca cai no usuario da sessao', () => {
    // "usuarios" (a lista de opcoes) pode aparecer; o usuario da sessao, nunca
    expect(FORMULARIO).not.toMatch(/usuario(?!s)/);
    expect(FORMULARIO).not.toContain('salvarTarefaRadar');
  });
  it('o CTA manual do CM1-C tem rotulo proprio e o "Agendar próxima ação" fica so na cadencia', () => {
    expect(FONTE_HOJE).toContain("botao('Criar tarefa manual'");
    expect(FONTE_HOJE.match(/'Agendar próxima ação'/g) ?? []).toHaveLength(0);
    expect(FONTE_HOJE).toContain('novaTarefa({ tipo: plano.tipoTarefa, oportunidadeId, descricao: plano.explicacao.modo })');
  });
});
