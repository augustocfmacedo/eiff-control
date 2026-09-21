// CM2-A — Congelamento do contrato temporal e da paridade com o CM1-A.1.
//
// Este arquivo NAO testa um Cadence Engine (ele ainda nao existe). Ele caracteriza o que o CM1-A.1 faz hoje em 28 casos
// temporais (mais variantes) e fixa, como dado, o comportamento que o futuro CM2 devera respeitar. Quando o CM2-B nascer,
// os campos `cm2` destas fixtures viram expectativa executavel; se o motor da fila mudar, os campos `cm1` quebram aqui.
// Contrato: docs/commercial-machine-cm2.md. Fixtures (sem alteracao de expectativa): cadenciaParidadeCM.fixtures.ts. Nenhum
// nome de conta real.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVISOS_PREVISTOS, CASOS, ESTADOS_TEMPORAIS, H, HOJE, OBRIGATORIOS, maxDia, somarDias, type Caso, type EstadoTemporal, type RetomaCom } from './cadenciaParidadeCM.fixtures';
import { CODIGOS_RAZAO_CM, HIPOTESE_COMMERCIAL_MACHINE, VERSAO_REGRAS_CM, construirCommercialQueue, type CodigoRazaoCM, type CommercialQueue } from './commercialMachine';
import { HIPOTESE_RECENCIA_FALLBACK_DIAS, JANELAS_FAMILIA } from './sinalLeitura';
import { estagioAtivo, type RadarDataset } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Contrato temporal do CM2 (dado congelado; a implementacao vira no CM2-B)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Estado temporal por razao principal do CM1-A. O motivo operacional continua sendo o proprio codigo do CM1-A
 * (o CM2 nao cria segunda taxonomia comercial). `lacunaD4`: a razao pode virar SUGERIR_PROXIMO_PASSO quando ha ancora real.
 */
const CONTRATO_TEMPORAL: Readonly<Record<CodigoRazaoCM, { estado: EstadoTemporal; retomaCom?: RetomaCom; lacunaD4?: true }>> = {
  RESPOSTA_NAO_TRATADA: { estado: 'DEVIDA' },
  TAREFA_VENCIDA: { estado: 'DEVIDA' },
  OPORTUNIDADE_ACAO_VENCIDA: { estado: 'DEVIDA' },
  SINAL_ACIONAVEL_NOVO: { estado: 'DEVIDA' },
  OPORTUNIDADE_PARADA_CRITICA: { estado: 'DEVIDA' },
  OPORTUNIDADE_SEM_PROXIMA_ACAO: { estado: 'SUGERIR_PROXIMO_PASSO' },
  OPORTUNIDADE_PARADA: { estado: 'DEVIDA' },
  PROXIMA_ACAO_HOJE: { estado: 'DEVIDA' },
  COMUNICACAO_APROVADA_NAO_ENVIADA: { estado: 'DEVIDA' },
  FOLLOW_UP_SEM_RESPOSTA: { estado: 'DEVIDA' },
  TENTATIVA_CONTATO_INVALIDO: { estado: 'DEVIDA' },
  COMUNICACAO_PARA_REVISAO: { estado: 'DEVIDA' },
  TRAVA_PARA_RESOLVER: { estado: 'PAUSADA', retomaCom: 'DECISAO_HUMANA' },
  INCONSISTENCIA_PARA_REVISAR: { estado: 'NAO_APLICAVEL' },
  CONTA_PRIORITARIA_NUNCA_ABORDADA: { estado: 'DEVIDA' },
  SINAL_NAO_VERIFICADO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR_IDEAL_PARA_SINAL: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_CANAL_VALIDO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  RESULTADO_NEGATIVO_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  TENTATIVAS_ESGOTADAS: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_EM_NURTURE: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  CLIENTE_GANHO: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  SEM_TIMING_ATUAL: { estado: 'NAO_APLICAVEL', lacunaD4: true },
  PROXIMA_ACAO_AGENDADA: { estado: 'AGUARDANDO', retomaCom: 'DATA' },
  FOLLOW_UP_EM_INTERVALO: { estado: 'AGUARDANDO', retomaCom: 'DATA' },
};


// Agenda na regra do CM1-A (passo 10), recalculada aqui so para congelar o fato na fixture.
const temAgendaDe = (r: RadarDataset, empresaId: string) =>
  r.tarefas.some((t) => t.empresaId === empresaId && t.status === 'Aberta' && t.venceEm.slice(0, 10) >= HOJE)
  || r.oportunidades.some((o) => o.empresaId === empresaId && estagioAtivo(o.estagio) && !!o.proximaAcaoEm && o.proximaAcaoEm.slice(0, 10) >= HOJE);

const filaDe = (c: Caso): CommercialQueue => construirCommercialQueue(c.ds, HOJE);

// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-A — hipoteses temporais do CM1-A.1 congeladas', () => {
  it('versao e valores das hipoteses nao mudaram (mudar exige nova versao e recalibracao aprovada)', () => {
    expect(VERSAO_REGRAS_CM).toBe('CM1-A.1');
    expect(HIPOTESE_COMMERCIAL_MACHINE).toEqual({
      slaEstagioDias: { DETECTED: 14, RESEARCHING: 10, QUALIFIED: 7, DECISION_MAKER_FOUND: 5, CONTACT_STARTED: 5, ENGAGED: 7, NEED_CONFIRMED: 7, PROJECT_RECEIVED: 3, ENGINEERING: 10, PRICING: 7, PROPOSAL_SENT: 5, NEGOTIATION: 5 },
      multiplicadorParadaCritica: 2, intervaloFollowUpDias: 4, limiteTentativasSemResposta: 5, sinalNovoDias: 7, fitAdequadoPadrao: 40,
    });
    expect(JANELAS_FAMILIA).toEqual({ LONG_CYCLE: 540, MEDIUM_CYCLE: 270, SHORT_CYCLE: 120 });
    expect(HIPOTESE_RECENCIA_FALLBACK_DIAS).toBe(120);
  });
});

describe('CM2-A — paridade CM1-A.1 nos casos temporais', () => {
  it('cobre os 28 casos obrigatorios, sem id repetido', () => {
    const ids = CASOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of OBRIGATORIOS) expect(ids, `caso ${id}`).toContain(id);
  });

  for (const c of CASOS) {
    it(`${c.id} — ${c.titulo}`, () => {
      const q = filaDe(c);
      const item = q.itens.find((i) => i.empresaId === c.empresaId);
      if (c.foraDaFila) {
        expect(item).toBeUndefined();
        expect(q.foraDaFila).toContainEqual({ empresaId: c.empresaId, motivo: c.foraDaFila });
        return;
      }
      const e = c.cm1!;
      expect(item, 'conta na fila').toBeDefined();
      const p = item!.porQueAgora;
      expect(item!.categoria).toBe(e.categoria);
      expect(p.codigo).toBe(e.codigo);
      expect(p.venceEm).toBe(e.venceEm);
      expect(item!.contato?.id).toBe(e.contatoId);
      expect(temAgendaDe(c.ds, c.empresaId), 'agenda').toBe(e.temAgenda);
      expect(item!.secundarias.map((s) => `${s.codigo}:${s.estado}${s.venceEm ? `@${s.venceEm}` : ''}`)).toEqual(e.secundarias);
      expect(item!.travas.map((t) => `${t.codigo}:${t.bloqueante}`)).toEqual(e.travas ?? []);
      if (e.semRespostaSeguidas !== undefined) expect(item!.historico.semRespostaSeguidas).toBe(e.semRespostaSeguidas);
      if (e.acaoBloqueada) expect(p.acaoBloqueada).toBe(e.acaoBloqueada);
      if ('responsavelId' in e) expect(item!.responsavelId).toBe(e.responsavelId);
    });
  }
});

describe('CM2-A — contrato temporal que o CM2 devera respeitar', () => {
  it('toda razao do CM1-A tem estado temporal e todo estado usado existe', () => {
    expect(Object.keys(CONTRATO_TEMPORAL).sort()).toEqual([...CODIGOS_RAZAO_CM].sort());
    for (const r of Object.values(CONTRATO_TEMPORAL)) expect(ESTADOS_TEMPORAIS).toContain(r.estado);
  });

  it('o estado temporal nao duplica a taxonomia comercial: nenhum estado tem nome de razao do CM1-A', () => {
    for (const e of ESTADOS_TEMPORAIS) expect(CODIGOS_RAZAO_CM as readonly string[]).not.toContain(e);
  });

  for (const c of CASOS) {
    it(`${c.id} — expectativa CM2 coerente com o CM1-A`, () => {
      if (!c.cm1) { expect(c.cm2, 'fora da fila nao tem cadencia operacional').toBeNull(); return; }
      const cm2 = c.cm2!;
      const q = filaDe(c);
      const item = q.itens.find((i) => i.empresaId === c.empresaId)!;
      const regra = CONTRATO_TEMPORAL[item.porQueAgora.codigo];

      // estado vem da razao principal; SUGERIR_PROXIMO_PASSO so onde o contrato admite lacuna D4
      if (cm2.estado === 'SUGERIR_PROXIMO_PASSO' && regra.lacunaD4) expect(regra.estado).toBe('NAO_APLICAVEL');
      else expect(cm2.estado).toBe(regra.estado);
      expect(cm2.retomaCom).toBe(regra.retomaCom);

      const t = cm2.proximoToque;
      // data RECOMENDADA so em SUGERIR_PROXIMO_PASSO, sempre com ancora real e nunca antes de hoje
      if (t?.natureza === 'RECOMENDADA') {
        expect(cm2.estado).toBe('SUGERIR_PROXIMO_PASSO');
        expect(t.ancora).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(t.em! >= HOJE).toBe(true);
        expect(cm2.sugestao).toBe('RECOMENDAR_DATA');
      }
      if (cm2.estado === 'SUGERIR_PROXIMO_PASSO') expect(t?.natureza).toBe('RECOMENDADA');
      // FIRME e BASE_CM1 repetem uma data que o CM1-A ja produziu (principal ou secundaria): nunca uma segunda verdade
      if (t?.natureza === 'FIRME' || t?.natureza === 'BASE_CM1') {
        const datas = [item.porQueAgora.venceEm, ...item.secundarias.map((s) => s.venceEm)].filter(Boolean);
        expect(datas).toContain(t.em);
        if (item.porQueAgora.venceEm) expect(t.em).toBe(item.porQueAgora.venceEm);
      }
      if (t?.natureza === 'BASE_CM1') expect(item.porQueAgora.codigo).toBe('FOLLOW_UP_EM_INTERVALO');
      if (cm2.estado === 'AGUARDANDO') expect(t && t.em! > HOJE).toBe(true);
      // IMEDIATA nao carrega data; PEDIR_DATA nunca inventa horizonte
      if (t?.natureza === 'IMEDIATA') expect(t.em).toBeUndefined();
      if (cm2.sugestao === 'PEDIR_DATA') expect(t?.em).toBeUndefined();
      // pausa e encerramento nao tem proximo toque
      if (cm2.estado === 'PAUSADA' || cm2.estado === 'ENCERRADA') expect(t).toBeUndefined();
      for (const a of cm2.avisos ?? []) expect(AVISOS_PREVISTOS).toContain(a);
    });
  }

  it('a lacuna D4 reaproveita hipoteses do CM1-A (intervalo sem oportunidade, SLA com oportunidade)', () => {
    const semOpp = CASOS.find((c) => c.id === '05b')!.cm2!.proximoToque!;
    expect(semOpp.em).toBe(maxDia(somarDias(semOpp.ancora!, H.intervaloFollowUpDias), HOJE));
    const comOpp = CASOS.find((c) => c.id === '17b')!.cm2!.proximoToque!;
    expect(comOpp.em).toBe(maxDia(somarDias(comOpp.ancora!, H.slaEstagioDias.ENGAGED), HOJE));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guarda para o futuro modulo de producao do CM2 (commercialCadence*.ts). Hoje nenhum existe: a guarda roda vazia e o
// autoteste prova que ela pega as violacoes quando o CM2-B nascer.
// ---------------------------------------------------------------------------------------------------------------------
const NUMEROS_TEMPORAIS = new Set<number>([
  ...Object.values(H.slaEstagioDias), H.intervaloFollowUpDias, H.limiteTentativasSemResposta, H.sinalNovoDias,
  ...Object.values(JANELAS_FAMILIA), HIPOTESE_RECENCIA_FALLBACK_DIAS, 180, 14,
]);
const IMPORTS_PROIBIDOS = [/\brecomendarAcao\b/, /\bfilaHoje\b/, /\blerEmpresa\b/, /\brecomendarCanal\b/, /from\s+['"][./]*data\//, /supabase/i, /\bfetch\s*\(/, /from\s+['"]\.\/(canais|comunicacaoServidor)['"]/];

function violacoesDeCadencia(fonte: string): string[] {
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const semStrings = semComentarios.replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""').replace(/\.slice\(0,\s*10\)/g, '');
  const out: string[] = [];
  for (const m of semStrings.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)) if (NUMEROS_TEMPORAIS.has(Number(m[1]))) out.push(`literal temporal ${m[1]}`);
  for (const re of IMPORTS_PROIBIDOS) if (re.test(semComentarios)) out.push(`uso proibido ${re}`);
  return out;
}

describe('CM2-A — guarda de numeros temporais para o CM2-B', () => {
  it('autoteste: a guarda pega literal de politica e dependencia proibida, e aceita importacao da hipotese', () => {
    expect(violacoesDeCadencia('const intervalo = 4;')).toEqual(['literal temporal 4']);
    expect(violacoesDeCadencia('if (dias > 14) {}')).toEqual(['literal temporal 14']);
    expect(violacoesDeCadencia("import { recomendarAcao } from './pipeline';").length).toBe(1);
    expect(violacoesDeCadencia("import { recomendarCanal } from './comunicacao';").length).toBe(1);
    expect(violacoesDeCadencia("import { HIPOTESE_COMMERCIAL_MACHINE as H } from './commercialMachine';\nconst d = H.intervaloFollowUpDias; const dia = v.slice(0, 10); const x = a[0] + 1;")).toEqual([]);
    expect(violacoesDeCadencia("// comentario com 4 dias\nconst texto = 'espera 4 dias';")).toEqual([]);
  });

  it('nenhum modulo de producao commercialCadence*.ts usa literal temporal nem autoridade legada', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const arquivos = fs.readdirSync(dir).filter((f) => /^commercialCadence.*\.ts$/.test(f) && !f.endsWith('.test.ts'));
    for (const f of arquivos) expect(violacoesDeCadencia(fs.readFileSync(path.join(dir, f), 'utf8')), f).toEqual([]);
  });
});
