// LE-2E — a aba Candidatos do Command Center.
//
// A suite e `.test.ts` (nao `.tsx`) de propósito: o vitest deste repositorio inclui apenas `src/**/*.test.ts`,
// entao um arquivo `.test.tsx` NUNCA rodaria. O padrao ja usado pela Commercial UX vale aqui: render em memoria
// com `renderToStaticMarkup`, invocacao de handler percorrendo a arvore React (sem DOM) e guardas estaticas.
//
// O que se prova: a tela PROJETA e coleta INTENCAO. Ela nao decide — o comando sai pela porta unica do store e
// o core revalida. Nenhuma regra do Lead Engine e reimplementada aqui.
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LeadEngineCandidatos, {
  LinhaCandidato, ROTULO_BLOQUEIO_LE, TEXTO_RECUSA_LEAD_ENGINE, mensagemRecusaLeadEngine,
  type LeadEngineCandidatosProps,
} from './LeadEngineCandidatos';
import { descobertasSuprimidas, filaDeRevisao } from '../../core/radar/leadEngineReview';
import { FILTRO_VAZIO, contadoresRevisao } from '../../core/radar/leadEngineRevisao';
import { payloadFingerprint } from '../../core/radar/leadEngineIntake';
import { actions } from '../../data/store';
import { radarVazio, type Empresa, type Fonte, type RadarDataset, type RegistroFonte, type Supressao } from '../../core/radar/types';

// ---------------------------------------------------------------------------------------------------------
// Fixtures (o LE-3 nao existe: o cenario e montado como dataset, nunca por uma action de descoberta)
// ---------------------------------------------------------------------------------------------------------
const CNPJ = '11222333000181';
const FONTE_CNO: Fonte = { id: 'FONTE-CNO', codigo: 'CNO', nome: 'Cadastro Nacional de Obras', tipo: 'CNO', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: '2026-01-01' };

const obra = (p: Record<string, unknown> = {}) => ({
  cno: 'obra-1', nomeResponsavel: 'Construtora Fictícia Alfa Ltda', cnpjResponsavel: CNPJ,
  municipio: 'Anápolis', uf: 'GO', dataInicio: '2026-09-01', nomeObra: 'Galpão Alfa', areaTotal: 4200, ...p,
});

const reg = (p: Partial<RegistroFonte> & { id: string }): RegistroFonte => {
  const payload = p.payload ?? obra();
  return {
    fonteId: FONTE_CNO.id, tipo: 'projeto', externoId: 'obra-1', recebidoEm: '2026-09-20T10:00:00.000Z',
    statusIntake: 'PENDING', ...p, payload, payloadFingerprint: p.payloadFingerprint ?? payloadFingerprint(payload),
  };
};

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-01-01',
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});

const sup = (empresaId: string): Supressao => ({ id: `SUP-${empresaId}`, empresaId, tipo: 'do_not_contact', motivo: 'pedido do cliente', criadoPor: 'u-1', criadoEm: '2026-08-01' });

const ds = (p: Partial<RadarDataset> = {}): RadarDataset => ({ ...radarVazio(), fontes: [FONTE_CNO], ...p });

const HOJE = '2026-09-20';
const props = (r: RadarDataset, podeAgir = true): LeadEngineCandidatosProps => ({
  candidatos: filaDeRevisao(r), visiveis: filaDeRevisao(r), suprimidos: descobertasSuprimidas(r), empresas: r.empresas,
  podeAgir, hoje: HOJE, filtro: FILTRO_VAZIO, contadores: contadoresRevisao(filaDeRevisao(r), HOJE),
  selecao: {}, abertos: {}, onAbrir: () => {}, onFiltro: () => {}, onSelecionar: () => {}, onErro: () => {}, onOk: () => {},
});

const html = (p: LeadEngineCandidatosProps) => renderToStaticMarkup(React.createElement(LeadEngineCandidatos, p));

// ---------------------------------------------------------------------------------------------------------
// Walker: percorre a arvore React e devolve os botoes, sem DOM
// ---------------------------------------------------------------------------------------------------------
function texto(no: unknown): string {
  if (no === null || no === undefined || typeof no === 'boolean') return '';
  if (typeof no === 'string' || typeof no === 'number') return String(no);
  if (Array.isArray(no)) return no.map(texto).join('');
  const e = no as { props?: { children?: unknown } };
  return e.props ? texto(e.props.children) : '';
}

interface BotaoAchado { rotulo: string; onClick?: () => void; disabled?: boolean }

function botoesDe(arvore: unknown): BotaoAchado[] {
  const achados: BotaoAchado[] = [];
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) { no.forEach(visitar); return; }
    if (!no || typeof no !== 'object') return;
    const e = no as { type?: unknown; props?: Record<string, unknown> };
    if (!e.props) return;
    if (e.type === 'button') achados.push({ rotulo: texto(e).trim(), onClick: e.props.onClick as (() => void) | undefined, disabled: e.props.disabled as boolean | undefined });
    visitar(e.props.children);
  };
  visitar(arvore);
  return achados;
}

/** Botoes de UMA linha da fila. LinhaCandidato e PURO (sem hooks), entao da para chama-lo como funcao de render. */
const botoesDaLinha = (r: RadarDataset, podeAgir = true) =>
  botoesDe((LinhaCandidato as (p: never) => unknown)({ c: filaDeRevisao(r)[0], empresas: r.empresas, podeAgir, hoje: HOJE, empresaId: filaDeRevisao(r)[0].match?.empresaId ?? '', aberto: false, onAbrir: () => {}, onSelecionar: () => {}, onErro: () => {}, onOk: () => {} } as never));

/** As quatro DECISOES do LE-2. 'Detalhes' e 'Buscar decisores' sao leitura/handoff, nao decisao. */
const DECISOES = ['Associar', 'Criar empresa', 'Manter em revisão', 'Rejeitar'];
const decisoes = (botoes: BotaoAchado[]) => botoes.filter((b) => DECISOES.includes(b.rotulo)).map((b) => b.rotulo);

const botoesDaTela = (p: LeadEngineCandidatosProps) => botoesDe((LeadEngineCandidatos as (x: LeadEngineCandidatosProps) => unknown)(p));

const clicar = (botoes: BotaoAchado[], rotulo: string) => {
  const alvo = botoes.find((b) => b.rotulo.includes(rotulo));
  if (!alvo) throw new Error(`botao nao encontrado: ${rotulo} (achei: ${botoes.map((b) => b.rotulo).join(' | ')})`);
  alvo.onClick?.();
  return alvo;
};

const CODIGO_UI = readFileSync('src/screens/radar/LeadEngineCandidatos.tsx', 'utf8');
const CODIGO_CC = readFileSync('src/screens/radar/CommandCenter.tsx', 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const UI = semComentarios(CODIGO_UI);

// ambiente do vitest e 'node': o window nao existe. A tela usa window.prompt (padrao do Command Center),
// entao o teste fornece um minimo para poder exercitar o caminho de rejeicao.
if (typeof globalThis.window === 'undefined') (globalThis as { window?: unknown }).window = { prompt: () => null };

afterEach(() => { vi.restoreAllMocks(); });

const espiar = () => vi.spyOn(actions, 'processarCandidatoLeadEngine').mockImplementation((() => ({ radar: radarVazio(), status: 'RESOLVED', sinalIds: [], empresaCriada: false })) as never);

// ---------------------------------------------------------------------------------------------------------
describe('LE-2E · abas do Command Center', () => {
  it('1-3 · a aba Candidatos existe e NÃO se confunde com a fila de revisão da importação', () => {
    expect(CODIGO_CC).toContain("{ id: 'candidatos', label: `Candidatos (${candidatosLE.length})` }");
    expect(CODIGO_CC).toContain("{ id: 'revisao', label: `Fila de revisão (${res.revisoesPendentes})` }");
    expect(CODIGO_CC).toContain("| 'candidatos' |");
    // a metrica antiga continua sendo a da importacao CSV, intocada
    expect(CODIGO_CC).toContain('res.revisoesPendentes');
  });

  it('4 · o contador da aba usa filaDeRevisao, não a fila do CSV', () => {
    expect(CODIGO_CC).toContain('const candidatosLE = filaDeRevisao(r);');
    expect(CODIGO_CC).toContain('const suprimidosLE = descobertasSuprimidas(r);');
    const r = ds({ registrosFonte: [reg({ id: 'SR-1' }), reg({ id: 'SR-2', externoId: 'obra-2', statusIntake: 'REVIEW' })] });
    expect(filaDeRevisao(r)).toHaveLength(2);
  });
});

describe('LE-2E · o que aparece', () => {
  it('5-8 · PENDING e REVIEW aparecem; RESOLVED e REJECTED não', () => {
    const r = ds({ registrosFonte: [
      reg({ id: 'SR-p' }),
      reg({ id: 'SR-v', externoId: 'obra-2', statusIntake: 'REVIEW' }),
      reg({ id: 'SR-r', externoId: 'obra-3', statusIntake: 'RESOLVED', entidadeId: 'EMP-1' }),
      reg({ id: 'SR-x', externoId: 'obra-4', statusIntake: 'REJECTED' }),
    ] });
    const saida = html(props(r));
    expect(saida).toContain('PENDING');
    expect(saida).toContain('REVIEW');
    expect(saida).not.toContain('RESOLVED');
    expect(saida).not.toContain('REJECTED');
  });

  it('9-10 · suprimido sai da fila acionável e aparece na seção auditável', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ, razaoSocial: 'Alfa Suprimida' })], supressoes: [sup('EMP-1')], registrosFonte: [reg({ id: 'SR-1' })] });
    const p = props(r);
    expect(p.candidatos).toEqual([]);
    expect(p.suprimidos).toHaveLength(1);
    const saida = html(p);
    expect(saida).toContain('Nenhum candidato aguardando revisão');
    expect(saida).toContain('Descobertas suprimidas (1)');
    expect(saida).toContain('Alfa Suprimida');
    expect(saida).toContain('SUPRIMIDO');
  });

  it('11-17 · a linha mostra fonte, tipo, recebimento, empresa do registro, match e bloqueios legíveis', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ, razaoSocial: 'Alfa Existente', cidade: 'Anápolis', uf: 'GO' })], registrosFonte: [reg({ id: 'SR-1' })] });
    const saida = html(props(r));
    expect(saida).toContain('Cadastro Nacional de Obras'); // fonte
    expect(saida).toContain('CNO');                        // tipo da fonte
    expect(saida).toContain('projeto');                    // tipo do registro
    expect(saida).toContain('20/09/2026');                 // recebidoEm formatado
    expect(saida).toContain('obra-1');                     // identidade externa
    expect(saida).toContain('Construtora Fictícia Alfa Ltda'); // empresa normalizada
    expect(saida).toContain('Anápolis/GO');
    expect(saida).toContain('CNPJ 11.222.333/0001-81'); // formatado para leitura humana
    expect(saida).toContain('Alfa Existente');             // match
    expect(saida).toContain('certo');                      // nivel
    expect(saida).toContain('CNPJ igual');                 // motivo
  });

  it('17b · bloqueio aparece traduzido, não como código cru', () => {
    const r = ds({ registrosFonte: [reg({ id: 'SR-1', payload: obra({ cnpjResponsavel: undefined }) })] });
    const saida = html(props(r));
    expect(saida).toContain('sem CNPJ ou business_id');
    expect(saida).not.toContain('SEM_IDENTIDADE_FORTE');
    expect(Object.keys(ROTULO_BLOQUEIO_LE)).toHaveLength(9);
  });

  it('11b · estado vazio não afirma que não existem leads', () => {
    const saida = html(props(ds()));
    expect(saida).toContain('Nenhum candidato aguardando revisão');
    expect(saida).not.toContain('Nenhum lead');
  });
});

describe('LE-2E · permissão', () => {
  it('18 · sem permissão não há botão de ação nenhum', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], supressoes: [], registrosFonte: [reg({ id: 'SR-1' })] });
    expect(decisoes(botoesDaLinha(r, false))).toEqual([]);
    expect(botoesDaLinha(r, false).map((b) => b.rotulo)).toEqual(['Detalhes']); // leitura continua permitida
    const supr = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], supressoes: [sup('EMP-1')], registrosFonte: [reg({ id: 'SR-1' })] });
    expect(botoesDaTela(props(supr, false)).filter((b) => b.rotulo.includes('Encerrar'))).toEqual([]);
  });

  it('19 · com permissão aparecem as quatro decisões', () => {
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    expect(decisoes(botoesDaLinha(r))).toEqual(['Associar', 'Criar empresa', 'Manter em revisão', 'Rejeitar']);
  });
});

describe('LE-2E · comandos enviados', () => {
  const cenario = () => ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });

  it('20 · ASSOCIATE envia o fingerprint que veio do item, com a empresa sugerida pré-selecionada', () => {
    const spy = espiar();
    const r = cenario();
    clicar(botoesDaLinha(r), 'Associar');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual({
      tipo: 'DECISAO',
      pedido: { registroFonteId: 'SR-1', payloadFingerprintEsperado: filaDeRevisao(r)[0].payloadFingerprint, decisao: 'ASSOCIATE_EXISTING', empresaId: 'EMP-1' },
    });
  });

  it('21 · CREATE envia o comando correto', () => {
    const spy = espiar();
    clicar(botoesDaLinha(cenario()), 'Criar empresa');
    expect(spy.mock.calls[0][0]).toMatchObject({ tipo: 'DECISAO', pedido: { decisao: 'CREATE_COMPANY' } });
  });

  it('22 · KEEP_REVIEW envia o comando correto', () => {
    const spy = espiar();
    clicar(botoesDaLinha(cenario()), 'Manter em revisão');
    expect(spy.mock.calls[0][0]).toMatchObject({ tipo: 'DECISAO', pedido: { decisao: 'KEEP_REVIEW' } });
  });

  it('23 · REJECT sem motivo NÃO chama a action', () => {
    const spy = espiar();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('   ');
    clicar(botoesDaLinha(cenario()), 'Rejeitar');
    expect(prompt).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    prompt.mockReturnValue(null);
    clicar(botoesDaLinha(cenario()), 'Rejeitar');
    expect(spy).not.toHaveBeenCalled();
  });

  it('24 · REJECT com motivo envia o motivo aparado', () => {
    const spy = espiar();
    vi.spyOn(window, 'prompt').mockReturnValue('  fora do perfil  ');
    clicar(botoesDaLinha(cenario()), 'Rejeitar');
    expect(spy.mock.calls[0][0]).toMatchObject({ tipo: 'DECISAO', pedido: { decisao: 'REJECT', motivo: 'fora do perfil' } });
  });

  it('25-26 · suprimido só oferece encerrar, e chama a porta única do store', () => {
    const spy = espiar();
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], supressoes: [sup('EMP-1')], registrosFonte: [reg({ id: 'SR-1' })] });
    const botoes = botoesDaTela(props(r));
    expect(botoes.map((b) => b.rotulo)).toEqual(['Encerrar descoberta']);
    clicar(botoes, 'Encerrar descoberta');
    expect(spy.mock.calls[0][0]).toEqual({ tipo: 'TERMINALIZAR_SUPRIMIDO', registroFonteId: 'SR-1' });
  });
});

describe('LE-2E · a tela não é autoridade', () => {
  it('27-28 · a UI nunca chama o core direto', () => {
    for (const proibido of ['aplicarDecisao', 'terminalizarSuprimido(', 'validarDecisao', 'analisarCandidato', 'transicaoPermitida']) {
      expect(UI).not.toContain(proibido);
    }
    expect(UI).toContain('actions.processarCandidatoLeadEngine');
  });

  it('29 · a UI não fala com Supabase nem persistência', () => {
    for (const proibido of ['supabase', 'persistirRadar', 'rpc(', 'fetch(']) expect(UI).not.toContain(proibido);
  });

  it('30 · a UI não recalcula fingerprint nem manda payload bruto', () => {
    expect(UI).not.toContain('payloadFingerprint(');
    expect(UI).toContain('payloadFingerprintEsperado: c.payloadFingerprint');
    expect(UI).not.toContain('payload:');
  });

  it('31-32 · nenhuma Commercial Queue, nenhuma prioridade ou score', () => {
    for (const proibido of ['priorityScore', 'priorityClass', 'construirCommercialQueue', 'CommercialQueue', 'fitScore', 'cadencia', 'recomendarAcao', 'filaHoje']) {
      expect(UI).not.toContain(proibido);
    }
  });

  it('nenhuma regra do Lead Engine é reimplementada na tela', () => {
    for (const proibido of ['encontrarEmpresa', 'identidadeForte', 'do_not_contact', 'opt_out', 'normalizarCnpj', 'payloadFingerprint(', 'transicaoPermitida']) {
      expect(UI).not.toContain(proibido);
    }
  });

  it('não incorpora resolução de duplicata', () => {
    for (const proibido of ['resolverDuplicataRadar', 'PossivelDuplicata', 'mesclar']) expect(UI).not.toContain(proibido);
  });

  it('38 · não mantém cópia paralela da fila em estado local', () => {
    // o unico useState da tela e a empresa escolhida na linha; a fila vem por prop, do store
    expect([...UI.matchAll(/useState/g)]).toHaveLength(0); // a tela nao guarda nada: recebe por prop e devolve intencao
    expect(UI).toContain('visiveis.map((c) =>'); // a fila filtrada tambem vem por prop (core filtrarRevisao), nunca filtrada aqui
    expect(UI).not.toContain('.filter((c)');
  });

  it('39-40 · a tela não cria oportunidade, tarefa, atividade nem comunicação', () => {
    for (const proibido of ['Oportunidade', 'oportunidade', 'TarefaRadar', 'criarTarefa', 'Atividade', 'Comunicacao', 'comunicacao']) {
      expect(UI).not.toContain(proibido);
    }
    // e a unica action que ela chama e a porta do Lead Engine
    const chamadas = [...UI.matchAll(/actions\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(chamadas)]).toEqual(['processarCandidatoLeadEngine']);
  });
});

describe('LE-2E · mensagens humanas', () => {
  const erro = (motivos: string[]) => Object.assign(new Error('O Lead Engine recusou esta operação: ' + motivos.join(', ') + '.'), { motivos, registroFonteId: 'SR-1', operacao: 'DECISAO' });

  it('33-37 · cada motivo vira uma frase que diz o que fazer', () => {
    expect(mensagemRecusaLeadEngine(erro(['CONTEXTO_MUDOU']))).toBe('Este candidato mudou desde que você abriu a tela. Revise os dados novamente.');
    expect(mensagemRecusaLeadEngine(erro(['OBSERVACAO_DESATUALIZADA']))).toBe('Existe uma observação mais recente deste registro.');
    expect(mensagemRecusaLeadEngine(erro(['JA_EXISTE_EMPRESA']))).toBe('Já existe uma empresa compatível. Associe o candidato à empresa existente.');
    expect(mensagemRecusaLeadEngine(erro(['SUPRIMIDO']))).toBe('Esta conta está marcada como não contatar.');
    expect(mensagemRecusaLeadEngine(erro(['SEM_IDENTIDADE_FORTE']))).toBe('Não há identidade suficiente para criar uma nova empresa.');
    expect(mensagemRecusaLeadEngine(erro(['STATUS_TERMINAL']))).toBe('Este candidato já foi processado. Atualize a tela.');
  });

  it('nenhuma frase humana devolve código técnico cru', () => {
    for (const [codigo, frase] of Object.entries(TEXTO_RECUSA_LEAD_ENGINE)) {
      expect(frase, codigo).not.toContain('_');
      expect(frase!.length, codigo).toBeGreaterThan(20);
    }
  });

  it('motivos repetidos não repetem a frase, e vários motivos somam', () => {
    expect(mensagemRecusaLeadEngine(erro(['TRANSICAO_INVALIDA', 'STATUS_TERMINAL']))).toBe('Este candidato já foi processado. Atualize a tela.');
    expect(mensagemRecusaLeadEngine(erro(['SUPRIMIDO', 'SEM_IDENTIDADE_FORTE']))).toContain('não contatar');
    expect(mensagemRecusaLeadEngine(erro(['SUPRIMIDO', 'SEM_IDENTIDADE_FORTE']))).toContain('identidade suficiente');
  });

  it('código sem tradução cai numa mensagem segura, com o código em detalhe', () => {
    expect(mensagemRecusaLeadEngine(erro(['ALGO_NOVO']))).toBe('Não foi possível concluir esta operação. (ALGO_NOVO)');
  });

  it('erro sem motivos tipados não quebra a tela', () => {
    expect(mensagemRecusaLeadEngine(new Error('falha qualquer'))).toBe('falha qualquer');
    expect(mensagemRecusaLeadEngine(undefined)).toBe('Não foi possível concluir esta operação.');
  });

  it('a recusa vira toast: a tela não tenta outra ação sozinha', () => {
    const avisos: string[] = [];
    vi.spyOn(actions, 'processarCandidatoLeadEngine').mockImplementation((() => { throw erro(['JA_EXISTE_EMPRESA']); }) as never);
    const r = ds({ empresas: [emp('EMP-1', { cnpj: CNPJ })], registrosFonte: [reg({ id: 'SR-1' })] });
    const botoes = botoesDe((LinhaCandidato as (p: never) => unknown)({ c: filaDeRevisao(r)[0], empresas: r.empresas, podeAgir: true, empresaId: 'EMP-1', onSelecionar: () => {}, onErro: (m: string) => avisos.push(m), onOk: () => {} } as never));
    clicar(botoes, 'Criar empresa');
    expect(avisos).toEqual(['Já existe uma empresa compatível. Associe o candidato à empresa existente.']);
    // uma chamada só: nenhuma tentativa automática de outra decisão
    expect(actions.processarCandidatoLeadEngine).toHaveBeenCalledTimes(1);
  });
});
