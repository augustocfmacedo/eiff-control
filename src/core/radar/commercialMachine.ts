import { estagioAtivo, type Empresa, type RadarDataset } from './types';

export const CATEGORIAS_COMMERCIAL_QUEUE = [
  'AGIR_AGORA',
  'PROSPECTAR',
  'FOLLOW_UP',
  'ENRIQUECER',
  'AVANCAR_OPORTUNIDADE',
  'REVISAR',
  'NURTURE',
] as const;

export type CategoriaCommercialQueue = (typeof CATEGORIAS_COMMERCIAL_QUEUE)[number];

export type CodigoRazaoCommercial =
  | 'TAREFA_VENCIDA'
  | 'RESPOSTA_RECEBIDA'
  | 'SINAL_QUENTE'
  | 'ENTREGA_INCERTA'
  | 'RASCUNHO_PARA_REVISAO'
  | 'DUPLICATA_PENDENTE'
  | 'OPORTUNIDADE_SEM_PROXIMA_ACAO'
  | 'OPORTUNIDADE_PARADA'
  | 'FOLLOW_UP_VENCENDO'
  | 'SEM_DECISOR'
  | 'SEM_CANAL_VALIDO'
  | 'CONTA_PRIORITARIA_SEM_CONTATO'
  | 'SEM_TIMING_ATUAL';

export interface RazaoCommercial {
  codigo: CodigoRazaoCommercial;
  peso: number;
  referenciaId?: string;
  em?: string;
}

export interface CommercialQueueItem {
  empresaId: string;
  categoria: CategoriaCommercialQueue;
  prioridade: number;
  priorityScore: number;
  priorityClass: Empresa['priorityClass'];
  proximaAcao?: string;
  proximaAcaoEm?: string;
  contatoId?: string;
  oportunidadeId?: string;
  sinalId?: string;
  razoes: RazaoCommercial[];
}

export interface CommercialQueue {
  geradaEm: string;
  itens: CommercialQueueItem[];
  porCategoria: Record<CategoriaCommercialQueue, number>;
}

const MS_DIA = 86_400_000;
const parse = (v?: string) => (v ? Date.parse(v) : Number.NaN);
const diasDesde = (data: string | undefined, hojeMs: number) => Number.isFinite(parse(data)) ? Math.floor((hojeMs - parse(data)) / MS_DIA) : Number.POSITIVE_INFINITY;
const vencida = (data: string | undefined, hojeMs: number) => Number.isFinite(parse(data)) && parse(data) < hojeMs;
const ateDias = (data: string | undefined, hojeMs: number, dias: number) => Number.isFinite(parse(data)) && parse(data) <= hojeMs + dias * MS_DIA;

function temCanalValido(ds: RadarDataset, empresaId: string) {
  const suprimidos = new Set(ds.supressoes.filter(s => s.contatoId && ['do_not_contact', 'opt_out'].includes(s.tipo)).map(s => s.contatoId));
  return ds.contatos.some(c => c.empresaId === empresaId && c.ativo && !suprimidos.has(c.id) && (
    (!!c.email && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido') ||
    (!!(c.whatsapp || c.celular || c.telefone) && c.statusTelefone !== 'invalido') ||
    !!c.linkedin
  ));
}

function melhorContato(ds: RadarDataset, empresaId: string) {
  const bloqueados = new Set(ds.supressoes.filter(s => s.contatoId && ['do_not_contact', 'opt_out'].includes(s.tipo)).map(s => s.contatoId));
  return ds.contatos
    .filter(c => c.empresaId === empresaId && c.ativo && !bloqueados.has(c.id))
    .sort((a, b) => (b.decisionFitScore ?? 0) - (a.decisionFitScore ?? 0) || Number(b.decisor) - Number(a.decisor) || b.qualidade - a.qualidade || a.id.localeCompare(b.id))[0];
}

function scoreRazoes(razoes: RazaoCommercial[], empresa: Empresa) {
  const soma = razoes.reduce((total, r) => total + r.peso, 0);
  return Math.round((soma + empresa.priorityScore * 0.35) * 100) / 100;
}

function categoriaDe(razoes: RazaoCommercial[], temOportunidadeAtiva: boolean, prioridadeAlta: boolean): CategoriaCommercialQueue {
  const codigos = new Set(razoes.map(r => r.codigo));
  if (codigos.has('ENTREGA_INCERTA') || codigos.has('RASCUNHO_PARA_REVISAO') || codigos.has('DUPLICATA_PENDENTE')) return 'REVISAR';
  if (codigos.has('TAREFA_VENCIDA') || codigos.has('RESPOSTA_RECEBIDA') || codigos.has('SINAL_QUENTE')) return 'AGIR_AGORA';
  if (temOportunidadeAtiva && (codigos.has('OPORTUNIDADE_SEM_PROXIMA_ACAO') || codigos.has('OPORTUNIDADE_PARADA'))) return 'AVANCAR_OPORTUNIDADE';
  if (codigos.has('FOLLOW_UP_VENCENDO')) return 'FOLLOW_UP';
  if (codigos.has('SEM_DECISOR') || codigos.has('SEM_CANAL_VALIDO')) return 'ENRIQUECER';
  if (prioridadeAlta && codigos.has('CONTA_PRIORITARIA_SEM_CONTATO')) return 'PROSPECTAR';
  return 'NURTURE';
}

export function construirCommercialQueue(ds: RadarDataset, hoje: string): CommercialQueue {
  const hojeMs = parse(hoje);
  if (!Number.isFinite(hojeMs)) throw new Error('commercial_queue_data_invalida');

  const itens = ds.empresas
    .filter(e => e.ativo && !e.mescladaEm)
    .map<CommercialQueueItem>(empresa => {
      const razoes: RazaoCommercial[] = [];
      const tarefas = ds.tarefas.filter(t => t.empresaId === empresa.id && t.status === 'Aberta');
      const atividades = ds.atividades.filter(a => a.empresaId === empresa.id).sort((a, b) => parse(b.ocorreuEm) - parse(a.ocorreuEm));
      const oportunidades = ds.oportunidades.filter(o => o.empresaId === empresa.id && estagioAtivo(o.estagio));
      const sinais = ds.sinais.filter(s => s.empresaId === empresa.id && s.verificado).sort((a, b) => parse(b.eventoEm) - parse(a.eventoEm));
      const comunicacoes = ds.comunicacoes.filter(c => c.empresaId === empresa.id);
      const duplicata = ds.duplicatas.find(d => d.empresaId === empresa.id && d.status === 'pendente');
      const melhor = melhorContato(ds, empresa.id);

      const tarefaVencida = tarefas.find(t => vencida(t.venceEm, hojeMs));
      if (tarefaVencida) razoes.push({ codigo: 'TAREFA_VENCIDA', peso: 100, referenciaId: tarefaVencida.id, em: tarefaVencida.venceEm });
      else {
        const tarefaProxima = tarefas.find(t => ateDias(t.venceEm, hojeMs, 2));
        if (tarefaProxima) razoes.push({ codigo: 'FOLLOW_UP_VENCENDO', peso: 55, referenciaId: tarefaProxima.id, em: tarefaProxima.venceEm });
      }

      const ultimaAtividade = atividades[0];
      if (ultimaAtividade?.resultado && ['REFERRED_TO_OTHER_PERSON', 'DECISION_MAKER_REACHED', 'ACTIVE_PROJECT', 'REQUESTED_PRESENTATION', 'REQUESTED_MEETING', 'REQUESTED_BUDGET', 'REQUESTED_TECHNICAL_ANALYSIS', 'CALL_BACK', 'POSITIVE'].includes(ultimaAtividade.resultado) && diasDesde(ultimaAtividade.ocorreuEm, hojeMs) <= 3) {
        razoes.push({ codigo: 'RESPOSTA_RECEBIDA', peso: 95, referenciaId: ultimaAtividade.id, em: ultimaAtividade.ocorreuEm });
      }

      const sinalQuente = sinais.find(s => diasDesde(s.eventoEm, hojeMs) <= 14 && s.scoreEfetivo >= 60);
      if (sinalQuente) razoes.push({ codigo: 'SINAL_QUENTE', peso: 80, referenciaId: sinalQuente.id, em: sinalQuente.eventoEm });

      const entregaIncerta = comunicacoes.find(c => c.estado === 'APPROVED' && c.resultado?.metadados?.deliveryStatus === 'UNKNOWN');
      if (entregaIncerta) razoes.push({ codigo: 'ENTREGA_INCERTA', peso: 120, referenciaId: entregaIncerta.id });
      const revisao = comunicacoes.find(c => c.estado === 'READY_FOR_REVIEW');
      if (revisao) razoes.push({ codigo: 'RASCUNHO_PARA_REVISAO', peso: 85, referenciaId: revisao.id });
      if (duplicata) razoes.push({ codigo: 'DUPLICATA_PENDENTE', peso: 90, referenciaId: duplicata.id });

      const oportunidadeSemAcao = oportunidades.find(o => !o.proximaAcao || !o.proximaAcaoEm);
      if (oportunidadeSemAcao) razoes.push({ codigo: 'OPORTUNIDADE_SEM_PROXIMA_ACAO', peso: 75, referenciaId: oportunidadeSemAcao.id });
      const oportunidadeParada = oportunidades.find(o => diasDesde(o.atualizadoEm, hojeMs) >= 10);
      if (oportunidadeParada) razoes.push({ codigo: 'OPORTUNIDADE_PARADA', peso: 65, referenciaId: oportunidadeParada.id, em: oportunidadeParada.atualizadoEm });

      const temDecisor = ds.contatos.some(c => c.empresaId === empresa.id && c.ativo && (c.decisor || (c.decisionFitScore ?? 0) >= 70));
      if (!temDecisor) razoes.push({ codigo: 'SEM_DECISOR', peso: 35 });
      if (!temCanalValido(ds, empresa.id)) razoes.push({ codigo: 'SEM_CANAL_VALIDO', peso: 30 });

      const prioridadeAlta = empresa.priorityClass === 'A+' || empresa.priorityClass === 'A';
      if (prioridadeAlta && atividades.length === 0 && oportunidades.length === 0) razoes.push({ codigo: 'CONTA_PRIORITARIA_SEM_CONTATO', peso: 50 });
      if (!razoes.length || (!prioridadeAlta && oportunidades.length === 0 && !sinalQuente)) razoes.push({ codigo: 'SEM_TIMING_ATUAL', peso: 5 });

      const categoria = categoriaDe(razoes, oportunidades.length > 0, prioridadeAlta);
      const oportunidade = oportunidades.sort((a, b) => parse(b.atualizadoEm) - parse(a.atualizadoEm))[0];
      const tarefa = tarefas.sort((a, b) => parse(a.venceEm) - parse(b.venceEm))[0];

      return {
        empresaId: empresa.id,
        categoria,
        prioridade: scoreRazoes(razoes, empresa),
        priorityScore: empresa.priorityScore,
        priorityClass: empresa.priorityClass,
        proximaAcao: tarefa?.descricao ?? oportunidade?.proximaAcao,
        proximaAcaoEm: tarefa?.venceEm ?? oportunidade?.proximaAcaoEm,
        contatoId: melhor?.id,
        oportunidadeId: oportunidade?.id,
        sinalId: sinalQuente?.id,
        razoes: razoes.sort((a, b) => b.peso - a.peso || a.codigo.localeCompare(b.codigo)),
      };
    })
    .sort((a, b) => b.prioridade - a.prioridade || b.priorityScore - a.priorityScore || a.empresaId.localeCompare(b.empresaId));

  const porCategoria = Object.fromEntries(CATEGORIAS_COMMERCIAL_QUEUE.map(c => [c, itens.filter(i => i.categoria === c).length])) as Record<CategoriaCommercialQueue, number>;
  return { geradaEm: hoje, itens, porCategoria };
}
