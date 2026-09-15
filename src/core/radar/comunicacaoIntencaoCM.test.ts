// CM1-D2: a intencao da Maquina Comercial chega intacta ate o ContentSpec — no nucleo, no store (versao padrao e pedido
// da IA) e no servidor (/api/comunicacao com Supabase e LLM simulados). Contexto mudado vira conflito explicito.
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { planoDeAcaoCM, type CommercialActionPlan } from './commercialActionPlan';
import { construirCommercialQueue, type CommercialQueueItem } from './commercialMachine';
import { OBJETIVOS, contextoComunicacaoDe, montarContentSpec, type ContentSpec } from './comunicacao';
import { gerarComunicacaoSincrona } from './comunicacaoGeracao';
import { CONFLITOS_INTENCAO_CM, MENSAGEM_INTENCAO_MUDOU, TEXTO_CONFLITO_INTENCAO_CM, contextoComunicacaoCM, intencaoDoPlanoCM, resolverIntencaoCM, validarFormatoIntencaoCM, type IntencaoComunicacaoCM } from './comunicacaoIntencaoCM';
import type { PortasLlm } from './comunicacaoLlm';
import { hojeDaOrganizacao, tratarGeracaoComunicacao, type DepsServidor } from './comunicacaoServidor';
import { recomendarAcao } from './pipeline';
import { radarVazio, type Atividade, type ComunicacaoRadar, type Contato, type Empresa, type Oportunidade, type RadarDataset, type Sinal, type Supressao, type TarefaRadar } from './types';
import { linhaApp, linhaDb, type ChaveRadar, type HelpersRadar } from '../../data/radar.supabase';
import { actions, getState } from '../../data/store';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures (ficticias, ids UUID para servirem tambem ao servidor)
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const U = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ORG = U(900); const PERFIL = U(901);
const EMP_RESP = U(1); const EMP_SINAL = U(2); const EMP_MAIL = U(3); const EMP_APROV = U(4); const EMP_NEG = U(5);
const C_RESP = U(11); const C_SINAL = U(12); const C_MAIL = U(13); const C_APROV = U(14); const C_NEG = U(15);
const PESOS = [{ chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 }, { chave: 'persona.CEO.media', valor: 85 }];
const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
const emp = (id: string, priorityClass: Empresa['priorityClass'], priorityScore: number): Empresa => ({ id, razaoSocial: `Conta Fictícia ${id.slice(6, 8)}`, cidade: 'Goiânia', uf: 'GO', pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01T00:00:00.000Z', atualizadoEm: '2026-09-01T00:00:00.000Z', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore, priorityClass });
const cont = (id: string, empresaId: string, p: Partial<Contato> = {}): Contato => ({ id, empresaId, nome: 'Pessoa Fictícia', cargo: 'Diretor', persona: 'CEO', email: `p${id.slice(6, 8)}@conta-ficticia.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01T00:00:00.000Z', atualizadoEm: '2026-08-01T00:00:00.000Z', ...p });
const sin = (id: string, empresaId: string, p: Partial<Sinal> = {}): Sinal => ({ id, empresaId, fonteId: U(700), fonteTipo: 'NEWS', tipo: 'NEW_FACTORY', titulo: 'Nova unidade fabril', descricao: 'Anunciou nova unidade fabril', eventoEm: '2026-09-10', detectadoEm: '2026-09-12', confianca: 0.9, scoreBase: 80, scoreEfetivo: 72, verificado: true, criadoEm: ts('2026-09-12'), ...p });
const atv = (id: string, empresaId: string, p: Partial<Atividade> = {}): Atividade => ({ id, empresaId, usuarioId: PERFIL, tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts('2026-09-14'), notas: '', criadoEm: ts('2026-09-14'), ...p });
const supr = (id: string, p: Partial<Supressao> & Pick<Supressao, 'tipo'>): Supressao => ({ id, motivo: 'fictício', criadoPor: PERFIL, criadoEm: ts('2026-09-01'), ...p });
const tarefa = (id: string, empresaId: string, p: Partial<TarefaRadar> = {}): TarefaRadar => ({ id, empresaId, responsavelId: PERFIL, tipo: 'MEETING', prioridade: 'Normal', venceEm: '2026-09-22', status: 'Aberta', descricao: 'reunião marcada', criadoEm: ts('2026-09-14', '10:05'), ...p });
const aprovada = (): ComunicacaoRadar => ({
  id: U(60), empresaId: EMP_APROV, contatoId: C_APROV, canal: 'EMAIL', objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', estado: 'APPROVED', spec: {},
  resultado: { versaoPrincipal: 'texto fictício', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: 'a'.repeat(64),
  versoes: { playbook: '1.2', contentSpec: '3', prompt: '1', provedor: 'deterministico' }, validacao: { ok: true, problemas: [] }, aprovadoEm: ts('2026-09-14'), criadoEm: ts('2026-09-13'), atualizadoEm: ts('2026-09-14'), criadoPor: PERFIL, historico: [],
});

function cenario(): RadarDataset {
  return {
    ...radarVazio(), pesosDecisionFit: PESOS,
    empresas: [emp(EMP_RESP, 'A', 80), emp(EMP_SINAL, 'B', 55), emp(EMP_MAIL, 'A', 72), emp(EMP_APROV, 'A', 70), emp(EMP_NEG, 'B', 50)],
    contatos: [
      cont(C_RESP, EMP_RESP, { whatsapp: '5562911110001' }), cont(C_SINAL, EMP_SINAL), cont(C_MAIL, EMP_MAIL, { telefone: '5562911110002', celular: '5562911110002' }),
      cont(C_APROV, EMP_APROV), cont(C_NEG, EMP_NEG),
    ],
    sinais: [
      sin(U(21), EMP_SINAL),
      sin(U(22), EMP_RESP, { eventoEm: '2024-01-01', detectadoEm: '2024-01-05', criadoEm: ts('2024-01-05') }), // antigo: fora da janela da familia
      sin(U(23), EMP_NEG, { detectadoEm: '2026-09-12' }),
    ],
    atividades: [
      atv(U(31), EMP_RESP, { contatoId: C_RESP, resultado: 'REQUESTED_BUDGET' }),
      atv(U(32), EMP_NEG, { contatoId: C_NEG, resultado: 'NOT_INTERESTED' }),
    ],
    comunicacoes: [aprovada()],
    supressoes: [supr(U(41), { contatoId: C_RESP, tipo: 'invalid_phone' }), supr(U(42), { contatoId: C_MAIL, tipo: 'email_bounced' })],
  };
}
const REMETENTE = { nome: 'Usuário Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' };
const itemDe = (r: RadarDataset, empresaId: string, hoje = HOJE): CommercialQueueItem => construirCommercialQueue(r, hoje).itens.find((i) => i.empresaId === empresaId)!;
const planoDe = (r: RadarDataset, empresaId: string): CommercialActionPlan => planoDeAcaoCM(r, itemDe(r, empresaId));
const intencaoDe = (r: RadarDataset, empresaId: string): IntencaoComunicacaoCM => intencaoDoPlanoCM(planoDe(r, empresaId))!;
function specCM(r: RadarDataset, intencao: IntencaoComunicacaoCM, canal?: IntencaoComunicacaoCM['canal']): ContentSpec {
  const res = resolverIntencaoCM(r, HOJE, intencao, { canal, paraGeracao: true });
  if (!res.ok) throw new Error(res.conflito);
  return montarContentSpec(contextoComunicacaoCM(r, res.item, res.plano, HOJE, { canal: res.canal }), res.canal, REMETENTE, { horaLocal: 10 });
}

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-D2 — núcleo: a intenção do plano chega intacta ao ContentSpec', () => {
  it('6–9 contato, objetivo, playbook e canal do ContentSpec são exatamente os do plano', () => {
    const r = cenario();
    const esperado: Record<string, [string, string, string]> = { [EMP_RESP]: ['REQUEST_PROJECT', 'PROJECT_CAPTURE', 'EMAIL'], [EMP_SINAL]: ['START_DISCOVERY', 'TECHNICAL_DISCOVERY', 'EMAIL'], [EMP_MAIL]: ['START_DISCOVERY', 'TECHNICAL_DISCOVERY', 'WHATSAPP'] };
    for (const empresaId of [EMP_RESP, EMP_SINAL, EMP_MAIL]) {
      const plano = planoDe(r, empresaId);
      const intencao = intencaoDoPlanoCM(plano)!;
      expect(intencao).toMatchObject({ origem: 'SELECAO_ATUAL', empresaId, contatoId: plano.contato!.id, objetivo: plano.comunicacao!.objetivo, playbook: plano.comunicacao!.playbook, canal: plano.comunicacao!.canal, acaoCodigo: plano.acaoCodigo });
      const spec = specCM(r, intencao);
      expect([spec.objetivo, spec.playbook, spec.canal]).toEqual(esperado[empresaId]);
      expect([spec.objetivo, spec.playbook, spec.canal, spec.cta]).toEqual([plano.comunicacao!.objetivo, plano.comunicacao!.playbook, plano.comunicacao!.canal, OBJETIVOS[plano.comunicacao!.objetivo].cta]);
      const res = resolverIntencaoCM(r, HOJE, intencao, { paraGeracao: true });
      expect(res.ok && contextoComunicacaoCM(r, res.item, res.plano, HOJE, { canal: res.canal }).contato?.id).toBe(plano.contato!.id);
    }
  });

  it('10 invalid_phone não reaparece: o contexto antigo recomendaria WhatsApp; a intenção mantém e-mail e recusa telefone', () => {
    const r = cenario();
    expect(contextoComunicacaoDe(r, EMP_RESP, HOJE, { contatoId: C_RESP })!.canal.primario).toBe('WHATSAPP');
    const intencao = intencaoDe(r, EMP_RESP);
    const res = resolverIntencaoCM(r, HOJE, intencao, { paraGeracao: true });
    expect(res.ok).toBe(true);
    const ctx = res.ok ? contextoComunicacaoCM(r, res.item, res.plano, HOJE, { canal: res.canal }) : undefined;
    expect(ctx?.canal).toMatchObject({ primario: 'EMAIL', disponiveis: ['EMAIL'] });
    for (const canal of ['WHATSAPP', 'PHONE'] as const) {
      expect(resolverIntencaoCM(r, HOJE, intencao, { canal, paraGeracao: true })).toEqual({ ok: false, conflito: 'CANAL_NAO_PERMITIDO' });
      expect(resolverIntencaoCM(r, HOJE, { ...intencao, canal }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'CANAL_NAO_PERMITIDO' });
    }
  });

  it('11 email_bounced não reaparece', () => {
    const r = cenario();
    const intencao = intencaoDe(r, EMP_MAIL);
    expect(specCM(r, intencao).canal).toBe('WHATSAPP');
    expect(resolverIntencaoCM(r, HOJE, intencao, { canal: 'EMAIL', paraGeracao: true })).toEqual({ ok: false, conflito: 'CANAL_NAO_PERMITIDO' });
    expect(resolverIntencaoCM(r, HOJE, intencao, { canal: 'PHONE', paraGeracao: true }).ok).toBe(true); // alternativo do proprio plano
  });

  it('o sinal antigo que o contexto antigo citaria não entra: sinal e estratégia vêm do plano', () => {
    const r = cenario();
    expect(contextoComunicacaoDe(r, EMP_RESP, HOJE, { contatoId: C_RESP })!.sinal?.id).toBe(U(22));
    const spec = specCM(r, intencaoDe(r, EMP_RESP));
    expect(spec.sinalId).toBeUndefined();
    expect(spec.allowedClaims.some((c) => c.origem === 'sinal')).toBe(false);
  });

  it('12 empresa suprimida, 13 contato inelegível e 14 contexto alterado geram conflito, nunca outra decisão', () => {
    const base = cenario();
    const intencao = intencaoDe(base, EMP_SINAL);
    expect(resolverIntencaoCM({ ...base, supressoes: [...base.supressoes, supr(U(43), { empresaId: EMP_SINAL, tipo: 'do_not_contact' })] }, HOJE, intencao, { paraGeracao: true })).toEqual({ ok: false, conflito: 'FORA_DA_FILA' });
    expect(resolverIntencaoCM({ ...base, supressoes: [...base.supressoes, supr(U(44), { contatoId: C_SINAL, tipo: 'opt_out' })] }, HOJE, intencao, { paraGeracao: true }).ok).toBe(false);
    const resp = intencaoDe(base, EMP_RESP);
    // resposta tratada por tarefa depois da fila: a acao vira AGENDADO
    expect(resolverIntencaoCM({ ...base, tarefas: [tarefa(U(51), EMP_RESP)] }, HOJE, resp, { paraGeracao: true })).toEqual({ ok: false, conflito: 'ACAO_MUDOU' });
    // mesma acao, mas objetivo/playbook alterados na intencao (ex.: pelo contexto antigo) sao recusados
    expect(resolverIntencaoCM(base, HOJE, { ...resp, objetivo: 'START_DISCOVERY' }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'OBJETIVO_MUDOU' });
    expect(resolverIntencaoCM(base, HOJE, { ...resp, playbook: 'TECHNICAL_DISCOVERY' }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'PLAYBOOK_MUDOU' });
    expect(resolverIntencaoCM(base, HOJE, { ...resp, contatoId: C_SINAL }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'CONTATO_MUDOU' });
    expect(resolverIntencaoCM(base, HOJE, { ...resp, versaoRegrasPlano: 'CM1-B.0' }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'VERSAO_REGRAS_MUDOU' });
  });

  it('15 artefato aprovado: exibe, mas nunca gera outra abordagem', () => {
    const r = cenario();
    const intencao = intencaoDe(r, EMP_APROV);
    expect(intencao).toMatchObject({ origem: 'ARTEFATO_APROVADO', comunicacaoId: U(60), objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', canal: 'EMAIL' });
    expect(resolverIntencaoCM(r, HOJE, intencao, { paraGeracao: true })).toEqual({ ok: false, conflito: 'ARTEFATO_APROVADO' });
    expect(resolverIntencaoCM(r, HOJE, intencao, { paraGeracao: false }).ok).toBe(true);
    expect(resolverIntencaoCM(r, HOJE, { ...intencao, origem: 'SELECAO_ATUAL', comunicacaoId: undefined }, { paraGeracao: true })).toEqual({ ok: false, conflito: 'ORIGEM_MUDOU' });
  });

  it('formato estrito da intenção: chaves e catálogos fechados; todo conflito tem texto', () => {
    const intencao = intencaoDe(cenario(), EMP_RESP);
    expect(validarFormatoIntencaoCM(intencao).ok).toBe(true);
    for (const ruim of [{ ...intencao, extra: 1 }, { ...intencao, objetivo: 'INVENTADO' }, { ...intencao, playbook: 'X' }, { ...intencao, canal: 'FAX' }, { ...intencao, acaoCodigo: 'QUALQUER' }, { ...intencao, origem: 'OUTRA' }, { ...intencao, referencia: { tipo: 'x', id: '1' } }, null, [], 'texto']) {
      expect(validarFormatoIntencaoCM(ruim).ok).toBe(false);
    }
    for (const c of CONFLITOS_INTENCAO_CM) expect(TEXTO_CONFLITO_INTENCAO_CM[c]).toBeTruthy();
  });

  it('D1–D9: nenhuma divergência do pipeline muda contato, objetivo, playbook, canal ou ação vindos da Máquina Comercial', () => {
    const e = (id: string, classe: Empresa['priorityClass'] = 'B') => emp(id, classe, 50);
    const opp = (p: Partial<Oportunidade>): Oportunidade => ({ id: U(80), empresaId: U(70), titulo: 'Galpão fictício', estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: PERFIL, observacoes: '', criadoEm: ts('2026-09-12'), atualizadoEm: ts('2026-09-12'), ...p });
    const r1 = (p: Partial<RadarDataset>): RadarDataset => ({ ...radarVazio(), pesosDecisionFit: PESOS, empresas: [e(U(70))], contatos: [cont(U(71), U(70))], ...p });
    const casos: [string, RadarDataset, boolean][] = [
      ['D1', r1({ oportunidades: [opp({ criadoEm: ts('2026-09-01'), proximaAcao: 'visita', proximaAcaoEm: '2026-09-20' })], atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'REQUESTED_BUDGET' })] }), true],
      ['D2', r1({ sinais: [sin(U(73), U(70), { tipo: 'NEWS' })], atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'REQUESTED_BUDGET' }), atv(U(74), U(70), { tipo: 'NOTE', canal: 'OTHER', ocorreuEm: ts('2026-09-14', '11:00') })] }), true],
      ['D3', r1({ sinais: [sin(U(73), U(70))], atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'NOT_INTERESTED' })] }), false],
      ['D4', { ...r1({ sinais: [sin(U(73), U(70))] }), contatos: [cont(U(71), U(70), { email: undefined, telefone: '5562999999999' })], supressoes: [supr(U(75), { contatoId: U(71), tipo: 'invalid_phone' })] }, false],
      ['D5', r1({ atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'REQUESTED_MEETING' })], tarefas: [tarefa(U(76), U(70), { tipo: 'FOLLOW_UP' })] }), false],
      ['D6', r1({ oportunidades: [opp({ proximaAcao: 'ligar', proximaAcaoEm: '2026-09-05' })] }), true],
      ['D7', r1({ sinais: [sin(U(73), U(70), { tipo: 'NEWS' })], atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'NO_RESPONSE' })] }), false],
      ['D8', r1({ sinais: [sin(U(73), U(70), { tipo: 'NEWS' })], atividades: [atv(U(72), U(70), { contatoId: U(71), resultado: 'NOT_INTERESTED', ocorreuEm: ts('2026-08-26'), criadoEm: ts('2026-08-26') })] }), false],
      ['D9', r1({ sinais: [sin(U(73), U(70), { eventoEm: '2026-08-10', detectadoEm: '2026-08-16' })] }), false],
    ];
    for (const [nome, r, contato] of casos) {
      const item = itemDe(r, U(70));
      const plano = planoDeAcaoCM(r, item);
      const intencao = intencaoDoPlanoCM(plano);
      expect([nome, plano.modo === 'CONTATO']).toEqual([nome, contato]);
      if (intencao) {
        const spec = specCM(r, intencao);
        expect([nome, spec.objetivo, spec.playbook, spec.canal]).toEqual([nome, plano.comunicacao!.objetivo, plano.comunicacao!.playbook, plano.comunicacao!.canal]);
        expect(intencao.acaoCodigo).toBe(item.porQueAgora.codigo);
      } else {
        // a decisao do pipeline/contexto antigo nao vira geracao: uma intencao forjada com ela e recusada
        const ctx = contextoComunicacaoDe(r, U(70), HOJE, { contatoId: U(71) })!;
        const forjada: IntencaoComunicacaoCM = { origem: 'SELECAO_ATUAL', empresaId: U(70), itemId: plano.itemId, contatoId: U(71), objetivo: ctx.objetivo ?? 'FOLLOW_UP', playbook: ctx.playbook ?? 'NO_RESPONSE_FOLLOWUP', canal: ctx.canal.primario ?? 'PHONE', acaoCodigo: plano.acaoCodigo, referencia: plano.referencia, versaoRegrasFila: plano.versaoRegrasFila, versaoRegrasPlano: plano.versaoPlano };
        expect([nome, recomendarAcao(r.empresas[0], r, HOJE).estado !== undefined, resolverIntencaoCM(r, HOJE, forjada, { paraGeracao: true })]).toEqual([nome, true, { ok: false, conflito: 'MODO_NAO_E_CONTATO' }]);
      }
    }
  });

  it('18 fronteira: o módulo da intenção não envia, não chama rede nem entrega e não usa o pipeline antigo para decidir', () => {
    const src = fs.readFileSync('src/core/radar/comunicacaoIntencaoCM.ts', 'utf8').split('\n').filter((l) => !/^(\/\/|\/\*|\*)/.test(l.trim())).join('\n');
    expect(src).not.toMatch(/fetch\(|sendApproved|octadesk|delivery|entrega|recomendarAcao|contextoComunicacaoDe|sinalPrincipal|selecionarPlaybook\(|Date\.now|new Date\(/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CM1-D2 — store: versão padrão e pedido da IA obedecem à mesma intenção', () => {
  beforeEach(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    const ds = getState().ds;
    actions.importarJson(JSON.stringify({ ...ds, params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false }, radar: { ...ds.radar, ...cenario(), fontes: ds.radar.fontes, estrategias: ds.radar.estrategias, regrasPersona: ds.radar.regrasPersona, tiposResposta: ds.radar.tiposResposta } }));
  });
  const radar = () => getState().ds.radar;

  it('16/17 pedido da IA e versão padrão levam o mesmo contato/objetivo/playbook/canal do plano; sem intenção, o legado segue igual', () => {
    const plano = planoDe(radar(), EMP_RESP);
    const intencao = intencaoDoPlanoCM(plano)!;
    const pedido = actions.prepararSpecComunicacaoRadar(EMP_RESP, { canal: 'EMAIL', horaLocal: 10, intencao });
    expect(pedido).toEqual({ empresaId: EMP_RESP, contatoId: C_RESP, canal: 'EMAIL', citarIndicacao: false, horaLocal: 10, intencaoComercial: intencao });
    const c = actions.gerarComunicacaoRadar(EMP_RESP, { canal: 'EMAIL', horaLocal: 10, intencao });
    expect([c.contatoId, c.objetivo, c.playbook, c.canal, c.estado]).toEqual([plano.contato!.id, plano.comunicacao!.objetivo, plano.comunicacao!.playbook, plano.comunicacao!.canal, 'READY_FOR_REVIEW']);
    expect(c.resultado.metadados.origemComercial).toEqual({ itemId: intencao.itemId, acaoCodigo: intencao.acaoCodigo, versaoRegrasFila: intencao.versaoRegrasFila, versaoRegrasPlano: intencao.versaoRegrasPlano });
    expect(c.sinalId).toBeUndefined();
    // legado (Abordagem fora da Hoje): sem intencao, o contexto antigo decide como antes (aqui recomendaria WhatsApp)
    const legado = actions.prepararSpecComunicacaoRadar(EMP_RESP, { horaLocal: 10 });
    expect(legado).not.toHaveProperty('intencaoComercial');
    expect(legado.canal).toBe(contextoComunicacaoDe(radar(), EMP_RESP, HOJE)!.canal.primario);
  });

  it('14 contexto mudado, 12 empresa suprimida e 15 artefato aprovado: o store recusa com mensagem explícita e não grava', () => {
    const intencao = intencaoDe(radar(), EMP_RESP);
    const antes = radar().comunicacoes.length;
    actions.salvarTarefaRadar({ ...actions.novaTarefaRadar(EMP_RESP, { tipo: 'MEETING', descricao: 'reunião marcada', venceEm: '2026-09-22' }) });
    expect(() => actions.gerarComunicacaoRadar(EMP_RESP, { intencao })).toThrow(MENSAGEM_INTENCAO_MUDOU);
    expect(() => actions.prepararSpecComunicacaoRadar(EMP_RESP, { intencao })).toThrow(TEXTO_CONFLITO_INTENCAO_CM.ACAO_MUDOU);
    const aprov = intencaoDe(radar(), EMP_APROV);
    expect(() => actions.gerarComunicacaoRadar(EMP_APROV, { intencao: aprov })).toThrow(TEXTO_CONFLITO_INTENCAO_CM.ARTEFATO_APROVADO);
    expect(() => actions.gerarComunicacaoRadar(EMP_SINAL, { intencao: aprov })).toThrow(MENSAGEM_INTENCAO_MUDOU);
    expect(radar().comunicacoes.length).toBe(antes);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Servidor: tabelas no formato do banco geradas do MESMO dataset (linhaDb), RLS simulada por organizacao, LLM simulado
// ---------------------------------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
const TABELAS: [ChaveRadar, keyof RadarDataset, string][] = [['empresas', 'empresas', 'radar_company'], ['contatos', 'contatos', 'radar_contact'], ['sinais', 'sinais', 'radar_signal'], ['atividades', 'atividades', 'radar_activity'], ['oportunidades', 'oportunidades', 'radar_opportunity'], ['tarefas', 'tarefas', 'radar_task'], ['duplicatas', 'duplicatas', 'radar_possible_duplicate'], ['supressoes', 'supressoes', 'radar_suppression'], ['projetos', 'projetos', 'radar_project'], ['historicoEstagios', 'historicoEstagios', 'radar_opportunity_stage_history']];
// a linha de comunicacao e montada a mao: o mapeador de gravacao exige o ContentSpec completo, que a fixture nao tem
const linhaComunicacao = (c: ComunicacaoRadar): Row => ({ id: c.id, organization_id: ORG, company_id: c.empresaId, contact_id: c.contatoId, signal_id: c.sinalId ?? null, strategy_id: c.estrategiaId ?? null, channel: c.canal, objective: c.objetivo, playbook: c.playbook, state: c.estado, content_spec: c.spec, generated_content: c.resultado, context_hash: c.contextHash, validation: c.validacao, playbook_version: c.versoes.playbook, content_spec_version: c.versoes.contentSpec, prompt_version: c.versoes.prompt, provider: c.versoes.provedor, approved_at: c.aprovadoEm ?? null, created_at: c.criadoEm, updated_at: c.atualizadoEm, created_by: c.criadoPor });
function tabelasDoBanco(r: RadarDataset): Record<string, Row[]> {
  const h = { atorId: PERFIL, perfil: (id?: string) => id ?? null } as unknown as HelpersRadar;
  const ref = (_c: ChaveRadar, id?: string) => id ?? null;
  const out: Record<string, Row[]> = {};
  for (const [chave, campo, tabela] of TABELAS) {
    out[tabela] = (r[campo] as unknown as ({ id: string; criadoEm?: string; atualizadoEm?: string; ativo?: boolean })[]).map((x) => ({ ...linhaDb(chave, x, ref, h), id: x.id, organization_id: ORG, created_at: x.criadoEm, updated_at: x.atualizadoEm, ...(chave === 'empresas' ? { active: x.ativo } : {}) }));
  }
  return { ...out, radar_communication: r.comunicacoes.map(linhaComunicacao), radar_source: [], radar_strategy: [], radar_persona_rule: [], radar_decision_fit_weight: r.pesosDecisionFit.map((p) => ({ key: p.chave, value: p.valor })), company: [{ id: U(950), name: 'EIFF Engenharia', active: true }] };
}
function datasetDoBanco(t: Record<string, Row[]>): RadarDataset {
  const m = <T,>(chave: ChaveRadar, tabela: string) => (t[tabela] ?? []).map((x) => linhaApp(chave, x)) as unknown as T[];
  return { ...radarVazio(), empresas: m('empresas', 'radar_company'), contatos: m('contatos', 'radar_contact'), sinais: m('sinais', 'radar_signal'), atividades: m('atividades', 'radar_activity'), oportunidades: m('oportunidades', 'radar_opportunity'), tarefas: m('tarefas', 'radar_task'), comunicacoes: m('comunicacoes', 'radar_communication'), duplicatas: m('duplicatas', 'radar_possible_duplicate'), supressoes: m('supressoes', 'radar_suppression'), projetos: m('projetos', 'radar_project'), historicoEstagios: m('historicoEstagios', 'radar_opportunity_stage_history'), pesosDecisionFit: (t.radar_decision_fit_weight ?? []).map((x) => ({ chave: String(x.key), valor: Number(x.value) })) };
}
/** Filtro PostgREST minimo: col=eq.x, col=in.(a,b), or=(col.eq.x,col.in.(a,b)). */
function filtrar(rows: Row[], qs: string): Row[] {
  const q = new URLSearchParams(qs);
  const casa = (r: Row, col: string, op: string, val: string) => (op === 'eq' ? String(r[col]) === val : op === 'in' ? val.replace(/^\(|\)$/g, '').split(',').includes(String(r[col])) : true);
  let out = rows;
  for (const [k, v] of q) {
    if (k === 'select' || k === 'limit' || k === 'order') continue;
    if (k === 'or') { const conds = [...v.slice(1, -1).matchAll(/(\w+)\.(eq|in)\.(\([^)]*\)|[^,]+)/g)]; out = out.filter((r) => conds.some(([, col, op, val]) => casa(r, col, op, val))); continue; }
    const m = /^(eq|in)\.(.*)$/.exec(v); if (m) out = out.filter((r) => casa(r, k, m[1], m[2]));
  }
  return out;
}
interface Chamadas { urls: string[]; posts: Row[]; llm: number }
function depsServidor(t: Record<string, Row[]>, specEsperado: () => ContentSpec | undefined, ch: Chamadas): DepsServidor {
  const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchMock = (async (url: string, init?: RequestInit) => {
    ch.urls.push(url);
    if (url.includes('/auth/v1/user')) return j(200, { id: PERFIL });
    const m = /\/rest\/v1\/([a-z_]+)(\?(.*))?$/.exec(url); if (!m) return j(404, {});
    const [, tabela, , qs = ''] = m;
    if (tabela === 'profile') return j(200, [{ name: 'Usuário Fictício', role: 'Administrador', organization_id: ORG }]);
    if (init?.method === 'POST') { const row = JSON.parse(String(init.body)) as Row; ch.posts.push({ tabela, ...row }); return j(201, [{ id: U(999), ...row }]); }
    return j(200, filtrar((t[tabela] ?? []).filter((r) => r.organization_id === undefined || r.organization_id === ORG), qs));
  }) as unknown as typeof fetch;
  const portas: PortasLlm = {
    gerar: async () => { ch.llm++; const r = gerarComunicacaoSincrona(specEsperado()!); return { json: { primary: r.versaoPrincipal, alternatives: r.versoesAlternativas, subject: r.assunto, call_script: r.roteiroLigacao, claims_used: r.claimsUsados }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }; },
    julgar: async () => { ch.llm++; return { json: { verdict: 'PASS', reasons: [] }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }; },
  };
  // 15/09/2026 01:30 UTC ainda e 14/09 em Sao Paulo: o servidor usa o fuso da organizacao; aqui 13:00 UTC = 15/09 nos dois
  return { fetch: fetchMock, supabaseUrl: 'https://supabase.invalid', anon: 'anon', llmDisponivel: true, portas: () => portas, modelo: 'mock', cidadeRemetente: 'Goiânia', agora: () => '2026-09-15T13:00:00.000Z' };
}
const pedidoCM = (intencao: IntencaoComunicacaoCM, extra: Row = {}) => ({ method: 'POST', authorization: 'Bearer jwt-ficticio', body: { empresaId: intencao.empresaId, contatoId: intencao.contatoId, canal: intencao.canal, horaLocal: 10, intencaoComercial: intencao, ...extra } });

describe('CM1-D2 — servidor (/api/comunicacao): Server Truth recalcula a fila e o plano e exige a mesma intenção', () => {
  it('paridade: o dataset que o servidor reconstrói do banco produz o mesmo item e o mesmo plano do cliente', () => {
    const r = cenario();
    const rs = datasetDoBanco(tabelasDoBanco(r));
    for (const empresaId of [EMP_RESP, EMP_SINAL, EMP_MAIL, EMP_APROV, EMP_NEG]) {
      const pc = planoDe(r, empresaId); const ps = planoDe({ ...rs, fontes: r.fontes }, empresaId);
      expect([empresaId, ps.itemId, ps.modo, ps.contato?.id, ps.comunicacao?.objetivo, ps.comunicacao?.playbook, ps.comunicacao?.canal]).toEqual([empresaId, pc.itemId, pc.modo, pc.contato?.id, pc.comunicacao?.objetivo, pc.comunicacao?.playbook, pc.comunicacao?.canal]);
    }
    expect(hojeDaOrganizacao({ agora: () => '2026-09-16T01:30:00.000Z' })).toBe('2026-09-15');
    expect(hojeDaOrganizacao({ agora: () => '2026-09-16T01:30:00.000Z', fusoHorario: 'UTC' })).toBe('2026-09-16');
  });

  it('17 gera com a mesma intenção: linha inserida com contato/objetivo/playbook/canal do plano, hash igual ao local e origem registrada; 18 nada é enviado', async () => {
    const r = cenario();
    const intencao = intencaoDe(r, EMP_RESP);
    const esperado = specCM(r, intencao);
    const ch: Chamadas = { urls: [], posts: [], llm: 0 };
    const res = await tratarGeracaoComunicacao(pedidoCM(intencao), depsServidor(tabelasDoBanco(r), () => esperado, ch));
    expect(res.status).toBe(201);
    expect(ch.posts).toHaveLength(1);
    const row = ch.posts[0];
    expect([row.tabela, row.contact_id, row.objective, row.playbook, row.channel, row.state, row.signal_id]).toEqual(['radar_communication', C_RESP, 'REQUEST_PROJECT', 'PROJECT_CAPTURE', 'EMAIL', 'READY_FOR_REVIEW', null]);
    expect(row.context_hash).toBe(esperado.contextHash);
    expect(((row.generated_content as Row).metadados as Row).origemComercial).toEqual({ itemId: intencao.itemId, acaoCodigo: intencao.acaoCodigo, versaoRegrasFila: intencao.versaoRegrasFila, versaoRegrasPlano: intencao.versaoRegrasPlano });
    // o servidor leu tudo que a fila e o plano precisam, pela RLS do usuario
    for (const t of ['radar_task', 'radar_communication', 'radar_possible_duplicate', 'radar_suppression', 'radar_opportunity']) expect(ch.urls.some((u) => u.includes(`/rest/v1/${t}?`))).toBe(true);
    expect(ch.urls.some((u) => /octadesk|delivery|send/i.test(u))).toBe(false);
  });

  it('14 contexto mudou no banco depois da fila: 409 context_changed com o conflito, sem LLM e sem INSERT', async () => {
    const r = cenario();
    const intencao = intencaoDe(r, EMP_RESP);
    const mudancas: [string, RadarDataset][] = [
      ['ACAO_MUDOU', { ...r, tarefas: [tarefa(U(51), EMP_RESP)] }],
      ['FORA_DA_FILA', { ...r, supressoes: [...r.supressoes, supr(U(52), { empresaId: EMP_RESP, tipo: 'opt_out' })] }],
    ];
    for (const [conflito, mudado] of mudancas) {
      const ch: Chamadas = { urls: [], posts: [], llm: 0 };
      const res = await tratarGeracaoComunicacao(pedidoCM(intencao), depsServidor(tabelasDoBanco(mudado), () => undefined, ch));
      expect([res.status, res.corpo.erro, res.corpo.conflito, res.corpo.mensagem]).toEqual([409, 'context_changed', conflito, MENSAGEM_INTENCAO_MUDOU]);
      expect([ch.llm, ch.posts.length]).toEqual([0, 0]);
    }
    // contato que virou opt-out
    const optOut = { ...r, supressoes: [...r.supressoes, supr(U(53), { contatoId: C_SINAL, tipo: 'opt_out' })] };
    const ch: Chamadas = { urls: [], posts: [], llm: 0 };
    const res = await tratarGeracaoComunicacao(pedidoCM(intencaoDe(r, EMP_SINAL)), depsServidor(tabelasDoBanco(optOut), () => undefined, ch));
    expect([res.status, res.corpo.erro, ch.llm, ch.posts.length]).toEqual([409, 'context_changed', 0, 0]);
  });

  it('10/11 canal suprimido pedido ao servidor e 15 artefato aprovado: recusados sem gerar', async () => {
    const r = cenario();
    const ch: Chamadas = { urls: [], posts: [], llm: 0 };
    const intencao = intencaoDe(r, EMP_RESP);
    const tel = await tratarGeracaoComunicacao(pedidoCM(intencao, { canal: 'WHATSAPP' }), depsServidor(tabelasDoBanco(r), () => undefined, ch));
    expect([tel.status, tel.corpo.conflito]).toEqual([409, 'CANAL_NAO_PERMITIDO']);
    const aprov = await tratarGeracaoComunicacao(pedidoCM(intencaoDe(r, EMP_APROV)), depsServidor(tabelasDoBanco(r), () => undefined, ch));
    expect([aprov.status, aprov.corpo.conflito]).toEqual([409, 'ARTEFATO_APROVADO']);
    expect([ch.llm, ch.posts.length]).toEqual([0, 0]);
  });

  it('contrato: intenção não substitui os ids; sinal/estratégia do cliente e campos extras são recusados (400)', async () => {
    const r = cenario();
    const ch: Chamadas = { urls: [], posts: [], llm: 0 };
    const d = depsServidor(tabelasDoBanco(r), () => undefined, ch);
    const intencao = intencaoDe(r, EMP_RESP);
    for (const body of [{ sinalId: U(21) }, { estrategiaId: U(81) }, { contatoId: C_SINAL }, { intencaoComercial: { ...intencao, spec: {} } }, { intencaoComercial: { ...intencao, objetivo: 'INVENTADO' } }]) {
      const res = await tratarGeracaoComunicacao(pedidoCM(intencao, body), d);
      expect(res.status).toBe(400);
    }
    expect([ch.llm, ch.posts.length]).toEqual([0, 0]);
  });

  it('edição de rascunho da Máquina Comercial revalida pela decisão do rascunho (o contexto antigo divergiria)', async () => {
    const r = cenario();
    const intencao = intencaoDe(r, EMP_RESP);
    const esperado = specCM(r, intencao);
    const ch: Chamadas = { urls: [], posts: [], llm: 0 };
    const t = tabelasDoBanco(r);
    const gerado = await tratarGeracaoComunicacao(pedidoCM(intencao), depsServidor(t, () => esperado, ch));
    const inserida: Row = { ...(gerado.corpo.comunicacao as Row), id: U(998), organization_id: ORG, content_spec: { horaLocal: 10, sourceDisclosure: 'INTERNAL_ONLY' }, playbook_version: esperado.versoes.playbook, content_spec_version: esperado.versoes.contentSpec };
    const texto = String(((inserida.generated_content as Row).versaoPrincipal));
    const comRascunho = { ...t, radar_communication: [...t.radar_communication, inserida] };
    const validar = { method: 'POST', authorization: 'Bearer jwt-ficticio', body: { acao: 'validar_edicao', communicationId: U(998), textoEditado: texto } };
    const ok = await tratarGeracaoComunicacao(validar, depsServidor(comRascunho, () => esperado, ch));
    expect([ok.status, ok.corpo.ok]).toEqual([200, true]);
    // o mesmo rascunho sem a origem comercial cai no caminho antigo, que reconstroi outra decisao (sinal antigo): contexto divergente
    const semOrigem = { ...inserida, generated_content: { ...(inserida.generated_content as Row), metadados: { ...((inserida.generated_content as Row).metadados as Row), origemComercial: undefined } } };
    const legado = await tratarGeracaoComunicacao(validar, depsServidor({ ...t, radar_communication: [...t.radar_communication, semOrigem] }, () => esperado, ch));
    expect([legado.status, legado.corpo.erro]).toEqual([409, 'context_changed']);
  });
});
