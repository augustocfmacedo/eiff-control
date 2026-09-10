// Assistente contextual: sugestoes acionaveis por tela, derivadas dos mesmos calculos do motor (nada novo e calculado aqui).
// Cada regra diz o que esta pendente, quantos, e leva para onde se resolve. Funcao pura; a tela so apresenta e permite dispensar.
import { calcLancamentos, calcTransacoes, carteiraObras, dashboard } from './engine';
import { resumoProducao } from './obras';
import { filaHoje } from './radar/pipeline';
import type { Dataset, Usuario } from './types';

export interface Sugestao { id: string; tom: 'info' | 'warn' | 'bad'; texto: string; detalhe?: string; acao?: { rotulo: string; to: string } }

const diasEntre = (a: string, b: string) => Math.round((new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000);
const n = (v: number, um: string, varios: string) => `${v.toLocaleString('pt-BR')} ${v === 1 ? um : varios}`;

export function sugestoesPara(rota: string, ds: Dataset, usuario: Usuario, hoje = ds.params.dataBase): Sugestao[] {
  const partes = rota.split('/').filter(Boolean); const raiz = partes[0] ?? ''; const out: Sugestao[] = [];
  const lancs = () => calcLancamentos(ds).filter((l) => l.oficial && l.status !== 'Cancelado');
  if (raiz === '') {
    const d = dashboard(ds);
    if (d.realizadosSemConciliacao > 0) out.push({ id: 'sem-conciliacao', tom: 'warn', texto: `${n(d.realizadosSemConciliacao, 'lançamento realizado', 'lançamentos realizados')} sem conciliação com o extrato.`, acao: { rotulo: 'Conciliar', to: '/conciliacao' } });
    if (d.aprovacoesSlaVencido > 0) out.push({ id: 'sla-aprovacoes', tom: 'bad', texto: `${n(d.aprovacoesSlaVencido, 'aprovação', 'aprovações')} com SLA vencido.`, acao: { rotulo: 'Ver aprovações', to: '/aprovacoes' } });
    const semDatas = carteiraObras(ds).filter((o) => o.ativa && o.servicos.length > 0 && o.servicos.every((s) => !s.inicioPrevisto));
    if (semDatas.length) out.push({ id: 'obras-sem-cronograma', tom: 'info', texto: `${n(semDatas.length, 'obra ativa', 'obras ativas')} sem datas previstas nos serviços: o cronograma visual fica vazio.`, detalhe: semDatas.map((o) => o.obra.codigo).join(', '), acao: { rotulo: 'Abrir obra', to: `/obras/${semDatas[0].obra.codigo}` } });
  }
  if (raiz === 'lancamentos' || raiz === 'pagar' || raiz === 'receber') {
    const ls = lancs();
    const semObra = ls.filter((l) => l.tipo === 'Saída' && l.grupoFluxo === 'Custos Diretos de Obras' && !l.codigoObra);
    if (semObra.length) out.push({ id: 'custo-sem-obra', tom: 'warn', texto: `${n(semObra.length, 'custo direto', 'custos diretos')} sem obra: não entram no comprometido nem na margem.`, detalhe: semObra.slice(0, 5).map((l) => l.id).join(', '), acao: { rotulo: 'Abrir', to: `/lancamentos/${semObra[0].id}` } });
    const receberVelhos = ls.filter((l) => l.tipo === 'Entrada' && l.diasAtraso > 30);
    if (receberVelhos.length && raiz !== 'pagar') out.push({ id: 'receber-30', tom: 'bad', texto: `${n(receberVelhos.length, 'recebível vencido', 'recebíveis vencidos')} há mais de 30 dias.`, acao: { rotulo: 'Ver atrasados', to: '/receber?situacao=Atrasado' } });
    const pagarVencidos = ls.filter((l) => l.tipo === 'Saída' && l.diasAtraso > 0);
    if (pagarVencidos.length && raiz !== 'receber') out.push({ id: 'pagar-vencidos', tom: 'warn', texto: `${n(pagarVencidos.length, 'pagamento vencido', 'pagamentos vencidos')}: negociar ou regularizar.`, acao: { rotulo: 'Ver atrasados', to: '/pagar?situacao=Atrasado' } });
  }
  if (raiz === 'obras' && partes[1]) {
    const o = carteiraObras(ds).find((x) => x.obra.codigo === partes[1]);
    if (o) {
      const semDatas = o.servicos.filter((s) => s.ativo !== false && !s.inicioPrevisto);
      if (semDatas.length && semDatas.length === o.servicos.length) out.push({ id: `obra-${o.obra.codigo}-datas`, tom: 'info', texto: 'Os serviços não têm início e fim previstos: informe-os na aba Serviços para o cronograma visual e a curva S.' });
      if (o.medicoes.atrasadas > 0) out.push({ id: `obra-${o.obra.codigo}-medicoes`, tom: 'warn', texto: `${n(o.medicoes.atrasadas, 'medição prevista', 'medições previstas')} já passou da data e segue pendente.` });
      if (o.pctMargemProjetada < 0) out.push({ id: `obra-${o.obra.codigo}-margem`, tom: 'bad', texto: 'Margem projetada negativa: reorçar e travar novos compromissos até revisar o ETC.' });
      if (o.faturamentoDiretoSaldo < 0) out.push({ id: `obra-${o.obra.codigo}-direto`, tom: 'warn', texto: 'Compras com faturamento direto passaram do saldo contratado com o cliente.' });
      const parados = o.servicos.filter((s) => s.status === 'Em andamento' && s.pctExecucao === 0);
      if (parados.length) out.push({ id: `obra-${o.obra.codigo}-parados`, tom: 'info', texto: `${n(parados.length, 'serviço em andamento', 'serviços em andamento')} sem nenhum avanço apontado.`, detalhe: parados.map((s) => s.codigo).join(', ') });
    }
  }
  if (raiz === 'radar') {
    const r = ds.radar;
    if (r) {
      const fila = filaHoje(r, hoje);
      const vencidas = fila.filter((i) => i.proximaAcaoEm && i.proximaAcaoEm.slice(0, 10) < hoje);
      if (vencidas.length) out.push({ id: 'radar-vencidas', tom: 'warn', texto: `${n(vencidas.length, 'próxima ação vencida', 'próximas ações vencidas')} na fila.`, acao: { rotulo: 'Ver fila', to: '/radar/hoje' } });
      const semDecisor = fila.filter((i) => !i.decisor && (i.empresa.priorityClass === 'A+' || i.empresa.priorityClass === 'A'));
      if (semDecisor.length) out.push({ id: 'radar-sem-decisor', tom: 'info', texto: `${n(semDecisor.length, 'conta A/A+', 'contas A/A+')} sem decisor cadastrado.`, detalhe: semDecisor.slice(0, 4).map((i) => i.empresa.nomeFantasia ?? i.empresa.razaoSocial).join(', '), acao: { rotulo: 'Abrir', to: `/radar/empresas/${semDecisor[0].empresa.id}` } });
      const dup = (r.duplicatas ?? []).filter((d) => d.status === 'pendente').length;
      if (dup) out.push({ id: 'radar-duplicatas', tom: 'info', texto: `${n(dup, 'possível duplicata', 'possíveis duplicatas')} aguardando revisão.`, acao: { rotulo: 'Revisar', to: '/radar' } });
    }
  }
  if (raiz === 'conciliacao') {
    const trans = calcTransacoes(ds);
    const velhas = trans.filter((t) => t.status === 'Pendente' && diasEntre(t.data, hoje) > 7);
    if (velhas.length) out.push({ id: 'conc-velhas', tom: 'warn', texto: `${n(velhas.length, 'transação pendente', 'transações pendentes')} há mais de 7 dias: meta é conciliar até D+1.` });
    const div = trans.filter((t) => t.status === 'Divergente').length;
    if (div) out.push({ id: 'conc-divergentes', tom: 'bad', texto: `${n(div, 'transação divergente', 'transações divergentes')} fora da tolerância.` });
  }
  if (raiz === 'producao') {
    const semData = [...resumoProducao(ds.ordens, 'Fabricação', hoje).ordens, ...resumoProducao(ds.ordens, 'Montagem', hoje).ordens].filter((o) => o.status !== 'Concluída' && !o.dataNecessidade);
    if (semData.length) out.push({ id: 'ordens-sem-data', tom: 'info', texto: `${n(semData.length, 'ordem em aberto', 'ordens em aberto')} sem data de necessidade: sem data não há prioridade.`, acao: { rotulo: 'Ver obras', to: '/central' } });
  }
  if (raiz === 'aprovacoes') {
    const d = dashboard(ds);
    if (d.aprovacoesSlaVencido > 0) out.push({ id: 'sla-aprovacoes', tom: 'bad', texto: `${n(d.aprovacoesSlaVencido, 'aprovação', 'aprovações')} com SLA vencido (${ds.params.alcadas.slaAprovacaoHoras} h).` });
  }
  void usuario;
  return out;
}
