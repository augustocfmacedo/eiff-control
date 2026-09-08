// Motor de score do Radar: regras configuraveis (tabela score_rules) avaliadas por dimensao, com decaimento no tempo e
// explicabilidade (cada fator diz quanto contribuiu e por que). Nada de pesos fixos: tudo vem de regrasScore/configScore.
import { CONFIG_SCORE_PADRAO } from './padroes';
import { fatorComponenteFit, type EntradaSetor } from './fitCalibracao';
import type { Atividade, ClassePrioridade, ConfigScore, Contato, Dimensao, Empresa, ExplicacaoScore, FatorScore, Projeto, RegraScore, Sinal } from './types';
import { DIMENSOES } from './types';

export interface ContextoEmpresa { empresa: Empresa; contatos: Contato[]; sinais: Sinal[]; atividades: Atividade[]; projetos: Projeto[]; bruto?: EntradaSetor }

const MS_DIA = 86400000;
export const diasEntre = (de: string, ate: string) => Math.max(0, Math.floor((new Date(ate).getTime() - new Date(de).getTime()) / MS_DIA));
/** Decaimento linear ate zero em `dias`; sem decaimento retorna 1. */
export const fatorDecaimento = (dataEvento: string, hoje: string, dias?: number) => (dias && dias > 0 ? Math.max(0, 1 - diasEntre(dataEvento, hoje) / dias) : 1);
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const fmtData = (s: string) => s.slice(0, 10).split('-').reverse().join('/');

export function configDe(config: ConfigScore[]): { pesos: Record<Dimensao, number>; classes: { classe: ClassePrioridade; minimo: number }[] } {
  const v = (chave: string) => config.find((c) => c.chave === chave)?.valor ?? CONFIG_SCORE_PADRAO.find((c) => c.chave === chave)?.valor ?? 0;
  const pesos = Object.fromEntries(DIMENSOES.map((d) => [d, v(`peso.${d}`)])) as Record<Dimensao, number>;
  const classes = (['A+', 'A', 'B', 'C'] as ClassePrioridade[]).map((classe) => ({ classe, minimo: v(`classe.${classe}`) })).sort((a, b) => b.minimo - a.minimo);
  return { pesos, classes };
}

export const classificar = (total: number, config: ConfigScore[]): ClassePrioridade => configDe(config).classes.find((c) => total >= c.minimo)?.classe ?? 'D';

/** Avalia uma regra no contexto: retorna o fator (0-1 ou >1 para varios) e o motivo, ou undefined se nao se aplica. */
function avaliar(r: RegraScore, ctx: ContextoEmpresa, hoje: string): { fator: number; motivo: string } | undefined {
  const c = r.condicao;
  const e = ctx.empresa;
  switch (c.tipo) {
    case 'sinal': {
      const sinais = ctx.sinais.filter((s) => s.tipo === c.tipoSinal && (!c.confiancaMinima || s.confianca >= c.confiancaMinima) && (!c.somenteVerificado || s.verificado));
      if (!sinais.length) return undefined;
      // o sinal mais valioso apos decaimento e confianca
      const melhor = sinais.map((s) => ({ s, f: fatorDecaimento(s.eventoEm, hoje, r.decaimento ? r.decaimentoDias : undefined) * s.confianca })).sort((a, b) => b.f - a.f)[0];
      if (melhor.f <= 0) return undefined;
      return { fator: melhor.f, motivo: `${melhor.s.titulo} em ${fmtData(melhor.s.eventoEm)}${r.decaimento ? ` (${Math.round(melhor.f * 100)}% após ${diasEntre(melhor.s.eventoEm, hoje)} dias)` : ''}${sinais.length > 1 ? `, +${sinais.length - 1} sinal(is)` : ''}` };
    }
    case 'campo': {
      const v = e[c.campo] as unknown;
      const ok = c.op === 'existe' ? v !== undefined && v !== null && v !== '' && v !== 0
        : c.op === 'eq' ? v === c.valor
        : c.op === 'in' ? Array.isArray(c.valor) && c.valor.map((x) => String(x).toLowerCase()).includes(String(v ?? '').toLowerCase())
        : c.op === 'contem' ? String(v ?? '').toLowerCase().includes(String(c.valor ?? '').toLowerCase())
        : c.op === 'prefixo' ? String(v ?? '').startsWith(String(c.valor ?? ''))
        : c.op === 'gte' ? Number(v) >= Number(c.valor)
        : c.op === 'lte' ? v !== undefined && Number(v) <= Number(c.valor)
        : false;
      return ok ? { fator: 1, motivo: `${String(c.campo)} = ${String(v)}` } : undefined;
    }
    case 'contato': {
      const canal = (x: typeof ctx.contatos[number]) => (!!x.email && x.statusEmail !== 'invalido' && x.statusEmail !== 'devolvido') || ((!!x.telefone || !!x.celular || !!x.whatsapp) && x.statusTelefone !== 'invalido');
      const cs = ctx.contatos.filter((x) => x.ativo && (!x.situacao || x.situacao === 'ATIVO') && (!c.decisor || x.decisor) && (!c.comEmail || !!x.email) && (!c.comTelefone || !!(x.telefone || x.celular || x.whatsapp)) && (!c.comCanal || canal(x)) && (!c.verificado || !!x.verificadoEm) && (!c.fitMinimo || (x.decisionFitScore ?? 0) >= c.fitMinimo)).sort((a, b) => (b.decisionFitScore ?? 0) - (a.decisionFitScore ?? 0));
      if (!cs.length) return undefined;
      return { fator: 1, motivo: `${cs[0].nome}${cs[0].cargo ? ` (${cs[0].cargo})` : ''}${cs.length > 1 ? ` e mais ${cs.length - 1}` : ''}` };
    }
    case 'sinalQualquer': {
      const ss = ctx.sinais.filter((s) => !c.diasMax || diasEntre(s.eventoEm, hoje) <= c.diasMax).sort((a, b) => (a.eventoEm < b.eventoEm ? 1 : -1));
      if (!ss.length) return undefined;
      return { fator: 1, motivo: `${ss[0].titulo} em ${fmtData(ss[0].eventoEm)}${ss.length > 1 ? `, +${ss.length - 1}` : ''}` };
    }
    case 'resposta': {
      const as = ctx.atividades.filter((a) => a.resultado && c.codigos.includes(a.resultado)).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1));
      if (!as.length) return undefined;
      const f = fatorDecaimento(as[0].ocorreuEm, hoje, r.decaimento ? r.decaimentoDias : undefined);
      if (f <= 0) return undefined;
      return { fator: f, motivo: `${as[0].resultado} em ${fmtData(as[0].ocorreuEm)}${r.decaimento ? ` (${Math.round(f * 100)}%)` : ''}` };
    }
    case 'atividade': {
      const as = ctx.atividades.filter((a) => c.tipos.includes(a.tipo)).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1));
      if (!as.length) return undefined;
      const f = fatorDecaimento(as[0].ocorreuEm, hoje, r.decaimento ? r.decaimentoDias : undefined);
      if (f <= 0) return undefined;
      return { fator: f, motivo: `${as[0].tipo} em ${fmtData(as[0].ocorreuEm)}` };
    }
    case 'projeto': {
      const ps = ctx.projetos.filter((p) => (!c.estagios || (p.estagio && c.estagios.includes(p.estagio))) && (!c.valorMinimo || (p.valorEstimado ?? 0) >= c.valorMinimo) && (!c.inicioEmMeses || (p.inicioPrevisto && diasEntre(hoje, p.inicioPrevisto) <= c.inicioEmMeses * 30 && p.inicioPrevisto >= hoje.slice(0, 10))));
      if (!ps.length) return undefined;
      return { fator: 1, motivo: `${ps[0].nome}${ps[0].inicioPrevisto ? `, início ${fmtData(ps[0].inicioPrevisto)}` : ''}` };
    }
    case 'fitCalibrado': {
      const f = fatorComponenteFit(e, c.componente, ctx.bruto);
      if (f.fator <= 0) return undefined;
      return { fator: f.fator, motivo: f.motivo };
    }
    case 'completude': {
      const preenchidos = c.campos.filter((k) => { const v = e[k] as unknown; return v !== undefined && v !== null && v !== '' && v !== 0; });
      if (!preenchidos.length) return undefined;
      return { fator: preenchidos.length / c.campos.length, motivo: `${preenchidos.length} de ${c.campos.length} campos preenchidos` };
    }
    default: return undefined;
  }
}

/** Calcula o score da empresa com explicacao completa. `hoje` em ISO (data-base). */
export function calcularScore(ctx: ContextoEmpresa, regras: RegraScore[], config: ConfigScore[], hoje: string): ExplicacaoScore {
  const { pesos, classes } = configDe(config);
  const somaPesos = DIMENSOES.reduce((s, d) => s + pesos[d], 0) || 1;
  const dimensoes = DIMENSOES.map((dimensao) => {
    const fatores: FatorScore[] = [];
    for (const r of regras.filter((x) => x.ativo && x.dimensao === dimensao).sort((a, b) => a.prioridade - b.prioridade)) {
      const av = avaliar(r, ctx, hoje);
      if (!av) continue;
      const pontos = Math.round(r.peso * av.fator * 10) / 10;
      if (pontos === 0) continue;
      fatores.push({ regraId: r.id, regra: r.nome, pontos, base: r.peso, fator: Math.round(av.fator * 100) / 100, motivo: av.motivo });
    }
    const score = clamp(fatores.reduce((s, f) => s + f.pontos, 0));
    return { dimensao, score: Math.round(score * 10) / 10, peso: pesos[dimensao] / somaPesos, fatores };
  });
  const total = Math.round(dimensoes.reduce((s, d) => s + d.score * d.peso, 0) * 10) / 10;
  const classe = classes.find((c) => total >= c.minimo)?.classe ?? 'D';
  return { total, classe, dimensoes, calculadoEm: hoje };
}

/** Motivo curto da prioridade: os dois fatores positivos mais fortes ponderados pela dimensao. */
export function motivoPrioridade(x: ExplicacaoScore): string {
  const fs = x.dimensoes.flatMap((d) => d.fatores.map((f) => ({ ...f, valor: f.pontos * d.peso, dimensao: d.dimensao })));
  const top = fs.filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 2);
  if (!top.length) return 'Sem fatores positivos: qualifique a empresa';
  return top.map((f) => f.regra).join(' · ');
}

export const aplicarNaEmpresa = (e: Empresa, x: ExplicacaoScore): Empresa => {
  const d = (dim: Dimensao) => x.dimensoes.find((k) => k.dimensao === dim)?.score ?? 0;
  return { ...e, fitScore: d('FIT'), timingScore: d('TIMING'), intentScore: d('INTENT'), relationshipScore: d('RELATIONSHIP'), dataQualityScore: d('DATA_QUALITY'), priorityScore: x.total, priorityClass: x.classe };
};

/** Peso base de um tipo de sinal, pela regra ativa que o usa (para signal.base_score). */
export const pesoBaseSinal = (tipo: string, regras: RegraScore[]) => regras.filter((r) => r.ativo && r.condicao.tipo === 'sinal' && r.condicao.tipoSinal === tipo).reduce((m, r) => Math.max(m, r.peso), 0) || 10;
