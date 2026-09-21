// Radar · Hoje 2.0 — cockpit operacional da Maquina Comercial.
// A tela so APRESENTA o que o motor decidiu: a fila, a ordem e a acao vem de construirCommercialQueue (CM1-A) e o modo,
// o contato, o objetivo, o playbook e o canal vem de planosDaFilaCM (CM1-B). Nada de prioridade, contato, canal ou
// proxima acao e recalculado aqui; filtros so escondem itens, nunca reordenam.
// Cadencia (CM2-B) e sugestao de compromisso (CM2-C) sao somente leitura: a tela mostra estado, proximo toque, natureza da
// data, tentativas, avisos e a sugestao ja calculados; nenhum botao novo, nenhuma tarefa criada a partir deles.
import React, { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIAS_COMMERCIAL_QUEUE, MOTIVOS_FORA_DA_FILA, NOME_CANAL, NOME_CATEGORIA_CM, NOME_ESTAGIO, NOME_PERSONA, NOME_TIPO_ATIVIDADE, NOME_TIPO_TAREFA, OBJETIVOS, PLAYBOOKS,
  TEXTO_AVISO_CADENCIA_CM, TEXTO_AVISO_TAREFA_CM, TEXTO_BLOQUEIO_PLANO_CM, TEXTO_COBERTURA_TAREFA_CM, TEXTO_ESTADO_CADENCIA_CM, TEXTO_FORA_DA_FILA, TEXTO_NATUREZA_TOQUE_CM,
  TEXTO_PENDENCIA_TAREFA_CM, TEXTO_RAZAO_CM, TEXTO_RETOMADA_CADENCIA_CM, TEXTO_TRAVA_CM, VERSAO_REGRAS_CADENCIA_CM, VERSAO_REGRAS_CM, VERSAO_REGRAS_PLANO_CM,
  cadenciasDaFilaCM, chaveQueDecideCM, construirCommercialQueue, itemIdCM, planosDaFilaCM, sugestoesTarefaDaFilaCM,
  type CadenceRecommendationCM, type CategoriaCommercialQueue, type ChaveOrdemCM, type CommercialActionPlan, type CommercialQueueItem, type Empresa, type EstadoSugestaoTarefaCM,
  type ModoPlanoCM, type NaturezaToqueCM, type OrigemResponsavelCM, type RazaoCM, type RetomadaCadenciaCM, type TarefaRadar, type TaskSuggestionCM,
} from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { normalizar } from '../../ui/busca';
import { Tabela } from '../../ui/Tabela';
import { Badge, Empty, Input, KpiStrip, Link, Modal, PageHead, Select, Tabs, useToast, type Tone } from '../../ui/components';
import { Abordagem } from './Abordagem';
import { intencaoDoPlanoCM, type IntencaoComunicacaoCM } from '../../core/radar/comunicacaoIntencaoCM';
import { AtividadeForm, ConcluirTarefaForm, RESPOSTA_NOME, ScoreModal, ScorePill, TarefaCadenciaForm, TarefaForm, d, nomeUsuario } from './comum';
import ComercialPanorama from './ComercialPanorama';
import { visaoComercialUX, type ContaComercialUX } from './comercialVisao';
import { MENSAGEM_SEM_EXPECTATIVA_CM, abrirAgendamentoCM, ctaCadenciaCM, type AberturaAgendamentoCM } from './HojeCadencia';

// ---------------------------------------------------------------------------------------------------------------------
// Rotulos de apresentacao (nenhuma regra: so nomes para codigos que o motor ja devolve)
// ---------------------------------------------------------------------------------------------------------------------
const NOME_MODO: Record<ModoPlanoCM, string> = { CONTATO: 'Contato', ACAO_INTERNA: 'Ação interna', REVISAR: 'Revisar', ENRIQUECER: 'Enriquecer', AGUARDAR: 'Aguardar' };
const TOM_MODO: Record<ModoPlanoCM, Tone> = { CONTATO: 'ok', ACAO_INTERNA: 'info', REVISAR: 'warn', ENRIQUECER: 'info', AGUARDAR: 'muted' };
const TOM_CATEGORIA: Record<CategoriaCommercialQueue, Tone> = { AGIR_AGORA: 'bad', AVANCAR_OPORTUNIDADE: 'warn', FOLLOW_UP: 'info', REVISAR: 'warn', PROSPECTAR: 'ok', ENRIQUECER: 'info', NURTURE: 'muted', AGENDADO: 'muted' };
const NOME_CHAVE_ORDEM: Record<ChaveOrdemCM | 'EMPATE', string> = {
  degrau: 'precedência da categoria', tier: 'prioridade da ação dentro da categoria', urgencia: 'urgência (dias do fato)', classe: 'classe da conta no Radar',
  priorityScore: 'score do Radar (desempate)', valorPonderado: 'valor ponderado da oportunidade', venceEm: 'prazo mais próximo', empresaId: 'desempate estável', EMPATE: 'empate em todas as chaves',
};
const NOME_ESTADO_RAZAO: Record<RazaoCM['estado'], string> = { PRINCIPAL: 'Principal', PENDENTE: 'Pendente', BLOQUEADA: 'Bloqueada', ADIADA: 'Adiada: já existe ação agendada' };
const NOME_ORIGEM_RESPONSAVEL: Record<OrigemResponsavelCM, string> = { TAREFA: 'pela tarefa', OPORTUNIDADE: 'pela oportunidade', ATIVIDADE: 'pela última atividade', COMUNICACAO: 'pela abordagem', NENHUMA: '' };
const nomeEmpresa = (e?: Empresa) => (e ? e.nomeFantasia ?? e.razaoSocial : '—');
const dias = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;
// cadencia e sugestao: so nomes curtos e cabecalhos para estados que o motor ja devolve
const NOME_TOQUE_CURTO: Record<NaturezaToqueCM, string> = { IMEDIATA: 'Agora', FIRME: 'firme', BASE_CM1: 'intervalo', RECOMENDADA: 'recomendada' };
const NOME_RETOMADA_CURTO: Record<RetomadaCadenciaCM, string> = { DATA: 'Data definida', FATO_NOVO: 'Fato novo', DADO: 'Aguardando dado', DECISAO_HUMANA: 'Decisão humana' };
const CABECALHO_SUGESTAO: Record<EstadoSugestaoTarefaCM, string> = {
  SUGERIDA: 'Próximo compromisso sugerido',
  COBERTA: 'Este ciclo já possui compromisso registrado.',
  REQUER_DATA: 'Falta definir a data antes de agendar.',
  REQUER_RESPONSAVEL: 'Falta definir quem será responsável pelo próximo compromisso.',
  BLOQUEADA: 'O próximo compromisso não pode ser preparado ainda.',
  NAO_APLICAVEL: 'Nenhum novo compromisso precisa ser criado agora.',
};
const ddmm = (s: string) => d(s).slice(0, 5);
const rotuloToque = (c: CadenceRecommendationCM) => {
  const t = c.proximoToque;
  if (t) return t.em ? `${ddmm(t.em)} ${NOME_TOQUE_CURTO[t.natureza]}` : NOME_TOQUE_CURTO[t.natureza];
  return c.retomaCom ? NOME_RETOMADA_CURTO[c.retomaCom] : '—';
};

type FiltroCategoria = 'TODAS' | CategoriaCommercialQueue;
type VisaoComercial = 'panorama' | 'fila';
/** Descritor de acao: o Panorama mostra so a principal e a fila mostra todas, sem duplicar o `switch (plano.modo)`. */
interface AcaoItemUX { id: string; rotulo: string; primario?: boolean; to?: string; onClick?: () => void }
interface Linha { id: string; item: CommercialQueueItem; plano: CommercialActionPlan; cadencia: CadenceRecommendationCM; sugestao: TaskSuggestionCM; empresa?: Empresa }
/** Indexa por itemId; duplicado ou ausente e erro explicito (nunca casar por posicao). */
function porItemId<T extends { itemId: string }>(xs: readonly T[], nome: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of xs) { if (m.has(x.itemId)) throw new Error(`hoje_${nome}_duplicado`); m.set(x.itemId, x); }
  return m;
}
type AbrirAbordagem = { empresaId: string; contatoId?: string; titulo: string; intencao?: IntencaoComunicacaoCM; semGeracao?: string };
type AbrirAtividade = { empresaId: string; contatoId?: string; oportunidadeId?: string };

export default function RadarHoje() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const r = ds.radar;
  const hoje = ds.params.dataBase;
  const podeAgir = pode(usuario, 'radar');
  const [somenteMinhas, setSomenteMinhas] = useState(false);
  const [classe, setClasse] = useState('');
  const [categoria, setCategoria] = useState<FiltroCategoria>('TODAS');
  const [busca, setBusca] = useState('');
  const [focoId, setFocoId] = useState<string | undefined>();
  const [score, setScore] = useState<Empresa | null>(null);
  const [abordagem, setAbordagem] = useState<AbrirAbordagem | null>(null);
  const [atividade, setAtividade] = useState<AbrirAtividade | null>(null);
  const [concluir, setConcluir] = useState<TarefaRadar | null>(null);
  const [tarefa, setTarefa] = useState<TarefaRadar | null>(null);
  const [agendar, setAgendar] = useState<Extract<AberturaAgendamentoCM, { ok: true }> | null>(null);
  const [visao, setVisao] = useState<VisaoComercial>('panorama');

  // fonte de verdade, sempre sobre o dataset inteiro e antes de qualquer filtro:
  // fila (CM1-A) -> planos (CM1-B) -> cadencias (CM2-B) -> sugestoes de compromisso (CM2-C)
  const fila = useMemo(() => construirCommercialQueue(r, hoje), [r, hoje]);
  const linhas = useMemo<Linha[]>(() => {
    const planos = planosDaFilaCM(r, fila);
    const cadencias = cadenciasDaFilaCM(r, fila, planos, hoje);
    const sugestoes = sugestoesTarefaDaFilaCM(r, fila, planos, cadencias, hoje);
    const planoPor = porItemId(planos, 'plano'); const cadenciaPor = porItemId(cadencias, 'cadencia'); const sugestaoPor = porItemId(sugestoes, 'sugestao');
    const empresas = new Map(r.empresas.map((e) => [e.id, e]));
    return fila.itens.map((item) => {
      const id = itemIdCM(item);
      const plano = planoPor.get(id); const cadencia = cadenciaPor.get(id); const sugestao = sugestaoPor.get(id);
      if (!plano || !cadencia || !sugestao) throw new Error('hoje_item_sem_correspondencia');
      return { id, item, plano, cadencia, sugestao, empresa: empresas.get(item.empresaId) };
    });
  }, [r, fila, hoje]);
  const contatoPorId = useMemo(() => new Map(r.contatos.map((c) => [c.id, c])), [r.contatos]);
  const empresaPorId = useMemo(() => new Map(r.empresas.map((e) => [e.id, e])), [r.empresas]);

  // filtros de visualizacao: escondem itens e preservam a ordem da fila
  const termo = normalizar(busca);
  const base = linhas.filter((l) =>
    (!somenteMinhas || (!!l.item.responsavelId && l.item.responsavelId === usuario.id)) &&
    (!classe || l.item.priorityClass === classe) &&
    (!termo || normalizar([l.empresa?.razaoSocial, l.empresa?.nomeFantasia, contatoPorId.get(l.plano.contato?.id ?? l.item.contato?.id ?? '')?.nome].filter(Boolean).join(' ')).includes(termo)));
  const visiveis = categoria === 'TODAS' ? base : base.filter((l) => l.item.categoria === categoria);
  const contagem = (c: CategoriaCommercialQueue) => base.filter((l) => l.item.categoria === c).length;
  const indiceFoco = Math.max(0, visiveis.findIndex((l) => l.id === focoId));
  const foco: Linha | undefined = visiveis[indiceFoco];
  const seguinte: Linha | undefined = visiveis[indiceFoco + 1];
  // filtro escondeu o item em foco: o primeiro da visao vira o foco (e continua sendo quando o filtro volta)
  useEffect(() => { if (foco && foco.id !== focoId) setFocoId(foco.id); }, [foco?.id, focoId]);
  const foraPorMotivo = MOTIVOS_FORA_DA_FILA.map((m) => [m, fila.foraDaFila.filter((f) => f.motivo === m).length] as const).filter(([, n]) => n > 0);
  const limparFiltros = () => { setSomenteMinhas(false); setClasse(''); setCategoria('TODAS'); setBusca(''); };

  // UX-1: o Panorama le o view-model do UX-0 sobre as mesmas linhas filtradas; a categoria continua sendo filtro da fila.
  const porLinha = useMemo(() => new Map(base.map((l) => [l.id, l])), [base]);
  const contasUX = useMemo(() => visaoComercialUX(base.map(({ item, plano, cadencia, sugestao }) => ({ item, plano, cadencia, sugestao }))), [base]);
  /** Enquanto o UX-2 (gaveta) nao existe, o detalhe e a propria fila completa com a conta em foco. */
  const verDetalhes = (conta: ContaComercialUX) => {
    const linha = porLinha.get(conta.itemId);
    if (linha && categoria !== 'TODAS' && linha.item.categoria !== categoria) setCategoria('TODAS');
    setFocoId(conta.itemId);
    setVisao('fila');
  };

  return (
    <>
      <PageHead title="Comercial" subtitle={<>{visao === 'panorama'
        ? <>O que precisa da sua atenção agora, o que espera alguém e o que está programado. Ordem, ação e cadência vêm da Máquina Comercial; o Panorama só apresenta.</>
        : <>Sua fila comercial priorizada pelo que exige ação agora. Ordem, ação, plano e cadência vêm da Máquina Comercial (fila {VERSAO_REGRAS_CM} · plano {VERSAO_REGRAS_PLANO_CM} · cadência {VERSAO_REGRAS_CADENCIA_CM}); os filtros só escondem itens, não mudam a ordem.</>}</>}>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={somenteMinhas} onChange={(e) => setSomenteMinhas(e.target.checked)} /> Só as minhas</label>
        <Select value={classe} onChange={setClasse} options={['A+', 'A', 'B', 'C', 'D']} allowEmpty="Todas as classes" aria-label="Classe" />
        <Input placeholder="Buscar empresa ou contato" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar empresa ou contato" style={{ width: 220 }} />
      </PageHead>

      <Tabs value={visao} onChange={setVisao} items={[{ id: 'panorama' as VisaoComercial, label: 'Panorama' }, { id: 'fila' as VisaoComercial, label: `Fila completa (${base.length})` }]} />

      {visao === 'panorama' ? (
        !fila.itens.length
          ? <Empty icone="hoje" titulo="Nada na carteira">Nenhuma conta exige ação agora. Importe empresas, registre sinais ou atividades: a fila se monta a partir do que acontece no Radar.</Empty>
          : <div style={{ marginTop: 12 }}>
            <ComercialPanorama
              contas={contasUX}
              nomeEmpresa={(id) => nomeEmpresa(empresaPorId.get(id))}
              nomeContato={(id) => contatoPorId.get(id)?.nome ?? '—'}
              nomeCanal={(canal) => (canal ? NOME_CANAL[canal] : '')}
              acaoPrincipal={(c) => { const l = porLinha.get(c.itemId); return l ? acoes(l, { primeira: true }) : null; }}
              ctaCadencia={(c) => { const l = porLinha.get(c.itemId); if (!l) return null; const rotulo = ctaCadenciaCM(l.sugestao, podeAgir); return rotulo ? <button className="btn sm" onClick={() => abrirAgendamento(l.cadencia, l.sugestao)} aria-label={`${rotulo} recomendada pela Máquina Comercial`}>{rotulo}</button> : null; }}
              onVerDetalhes={verDetalhes}
              onVerTodos={() => setVisao('fila')}
            />
          </div>
      ) : (
      <>
      <KpiStrip itens={[
        { label: 'Agir agora', value: contagem('AGIR_AGORA'), tone: contagem('AGIR_AGORA') ? 'neg' : undefined, hint: 'resposta, tarefa vencida, sinal novo, oportunidade crítica' },
        { label: 'Avançar oportunidade', value: contagem('AVANCAR_OPORTUNIDADE'), tone: contagem('AVANCAR_OPORTUNIDADE') ? 'warn' : undefined, hint: 'negócio ativo sem movimento' },
        { label: 'Follow-up', value: contagem('FOLLOW_UP'), hint: 'próximo toque devido' },
        { label: 'Revisar', value: contagem('REVISAR'), tone: contagem('REVISAR') ? 'warn' : undefined, hint: 'abordagem, trava ou inconsistência' },
        { label: 'Enriquecer', value: contagem('ENRIQUECER'), hint: 'falta decisor, canal ou verificação' },
        { label: 'Agendado', value: contagem('AGENDADO'), hint: 'ação já marcada; aguardar o prazo' },
      ]} />
      {foraPorMotivo.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{fila.foraDaFila.length} conta(s) fora da fila: {foraPorMotivo.map(([m, n]) => `${TEXTO_FORA_DA_FILA[m].toLowerCase()} (${n})`).join(' · ')}</div>}
      <div style={{ height: 12 }} />
      <Tabs value={categoria} onChange={setCategoria} items={[{ id: 'TODAS' as FiltroCategoria, label: `Toda a fila (${base.length})` }, ...CATEGORIAS_COMMERCIAL_QUEUE.map((c) => ({ id: c as FiltroCategoria, label: `${NOME_CATEGORIA_CM[c]} (${contagem(c)})` }))]} />

      {!fila.itens.length ? (
        <Empty icone="hoje" titulo="Fila vazia">Nenhuma conta exige ação agora. Importe empresas, registre sinais ou atividades: a fila se monta a partir do que acontece no Radar.</Empty>
      ) : !foco ? (
        <Empty icone="hoje" titulo="Nada com estes filtros" acao={<button className="btn" onClick={limparFiltros}>Limpar filtros</button>}>A fila tem {fila.itens.length} conta(s), mas nenhuma atende aos filtros atuais.{somenteMinhas ? ' "Só as minhas" mostra apenas itens com você como responsável; itens sem responsável não entram.' : ''}</Empty>
      ) : (
        <>
          {blocoFoco(foco, seguinte, indiceFoco + 1, visiveis.length)}
          <div style={{ height: 16 }} />
          <div className="card table-wrap">
            <h2>Fila ({visiveis.length})</h2>
            <div className="small muted" style={{ marginBottom: 8 }}>Na ordem da Máquina Comercial. Selecione uma linha para trazê-la ao foco.</div>
            <Tabela<Linha>
              colunas={[{ titulo: '#', num: true, largura: 64 }, { titulo: 'Empresa' }, { titulo: 'Categoria' }, { titulo: 'Ação' }, { titulo: 'Modo' }, { titulo: 'Pessoa' }, { titulo: 'Prazo' }, { titulo: 'Próximo toque' }, { titulo: 'Trava' }]}
              linhas={visiveis} chave={(l) => l.id} onLinha={(l) => setFocoId(l.id)} altura={520}
              linha={(l) => {
                const bloqueios = l.plano.bloqueios.length + l.item.travas.filter((t) => t.bloqueante && t.bloqueia.length).length;
                const pendencias = l.item.travas.length - l.item.travas.filter((t) => t.bloqueante && t.bloqueia.length).length;
                return (
                  <>
                    <td className="num">{l.item.posicao}{l.id === foco.id && <div><Badge tone="info">em foco</Badge></div>}</td>
                    <td><b>{nomeEmpresa(l.empresa)}</b><div className="small muted">classe {l.item.priorityClass}</div></td>
                    <td><Badge tone={TOM_CATEGORIA[l.item.categoria]}>{NOME_CATEGORIA_CM[l.item.categoria]}</Badge></td>
                    <td className="small">{TEXTO_RAZAO_CM[l.item.porQueAgora.codigo]}</td>
                    <td><Badge tone={TOM_MODO[l.plano.modo]}>{NOME_MODO[l.plano.modo]}</Badge></td>
                    <td className="small">{l.plano.contato ? contatoPorId.get(l.plano.contato.id)?.nome : <span className="muted">—</span>}</td>
                    <td className="small">{l.item.porQueAgora.venceEm ? d(l.item.porQueAgora.venceEm) : l.plano.aguardarAte ? d(l.plano.aguardarAte) : '—'}</td>
                    <td className="small">{rotuloToque(l.cadencia)}</td>
                    <td className="small">{bloqueios ? <Badge tone="bad">{`bloqueio (${bloqueios})`}</Badge> : pendencias ? <Badge tone="warn">{`pendência (${pendencias})`}</Badge> : <span className="muted">—</span>}</td>
                  </>
                );
              }}
            />
          </div>
        </>
      )}
      </>
      )}

      {score && <ScoreModal e={score} onClose={() => setScore(null)} />}
      {/* key por alvo: trocar de conta ou contato remonta o componente (o estado interno nunca carrega o alvo anterior) */}
      {abordagem && <Modal key={`abordagem:${abordagem.empresaId}:${abordagem.contatoId ?? ''}`} title={abordagem.titulo} onClose={() => setAbordagem(null)} wide><Abordagem key={`${abordagem.empresaId}:${abordagem.contatoId ?? ''}:${abordagem.intencao?.itemId ?? ''}`} empresaId={abordagem.empresaId} contatoId={abordagem.contatoId} commercialIntent={abordagem.intencao} semGeracao={abordagem.semGeracao} /></Modal>}
      {atividade && <AtividadeForm key={`atividade:${atividade.empresaId}:${atividade.contatoId ?? ''}:${atividade.oportunidadeId ?? ''}`} empresaId={atividade.empresaId} contatoId={atividade.contatoId} oportunidadeId={atividade.oportunidadeId} onClose={() => setAtividade(null)} onErro={toast} onOk={toast} />}
      {concluir && <ConcluirTarefaForm key={concluir.id} tarefa={concluir} onClose={() => setConcluir(null)} onErro={toast} onOk={toast} />}
      {tarefa && <TarefaForm key={tarefa.id} inicial={tarefa} onClose={() => setTarefa(null)} onErro={toast} onOk={toast} />}
      {agendar && <TarefaCadenciaForm key={agendar.expectativa.chave} abertura={agendar} onClose={() => setAgendar(null)} onOk={toast} onAbrirTarefa={(t) => { setAgendar(null); setTarefa(t); }} />}
      {el}
    </>
  );

  // -------------------------------------------------------------------------------------------------------------------
  // Bloco "Proxima acao" (item em foco)
  // -------------------------------------------------------------------------------------------------------------------
  function blocoFoco(linha: Linha, seguinte: Linha | undefined, posicaoFiltrada: number, totalFiltrado: number): React.ReactNode {
    const { item, plano, empresa } = linha;
    const p = item.porQueAgora;
    const oportunidade = item.oportunidadeId ? r.oportunidades.find((o) => o.id === item.oportunidadeId) : undefined;
    const pessoa = plano.contato ? contatoPorId.get(plano.contato.id) : undefined;
    const referencia = item.contato ? contatoPorId.get(item.contato.id) : undefined;
    const primeiro = posicaoFiltrada === 1;
    const chave = seguinte ? chaveQueDecideCM(item, seguinte.item) : undefined;
    const bloqueiosTrava = item.travas.filter((t) => t.bloqueante && t.bloqueia.length);
    const pendenciasTrava = item.travas.filter((t) => !(t.bloqueante && t.bloqueia.length));
    // agrupamento visual: adiadas e razoes de espera (agendado/nutrir) sao informacao; o resto e pendencia ou bloqueio
    const informativa = (s: RazaoCM) => s.estado === 'ADIADA' || (s.estado === 'PENDENTE' && (s.categoria === 'AGENDADO' || s.categoria === 'NURTURE'));
    const adiadas = item.secundarias.filter(informativa);
    const pendentes = item.secundarias.filter((s) => !informativa(s));
    const h = plano.historico;
    return (
      <section className="card" aria-labelledby="hoje-foco">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 id="hoje-foco" style={{ margin: 0 }}>{primeiro ? 'Próxima ação' : 'Em foco'}</h2>
          <span className="small muted">{posicaoFiltrada}º de {totalFiltrado} nesta visão · posição {item.posicao} na fila completa</span>
          <span className="spacer" />
          <Badge tone={TOM_CATEGORIA[item.categoria]}>{NOME_CATEGORIA_CM[item.categoria]}</Badge>
          <Badge tone={TOM_MODO[plano.modo]}>{`Modo: ${NOME_MODO[plano.modo]}`}</Badge>
        </div>

        <div className="grid cols-3" style={{ marginTop: 12, gap: 16 }}>
          <div>
            <h3>Conta</h3>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>{empresa && <ScorePill e={empresa} onClick={() => setScore(empresa)} />}<Link to={`/radar/empresas/${item.empresaId}`}><b>{nomeEmpresa(empresa)}</b></Link></div>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Classe</dt><dd>{item.priorityClass} <span className="small muted">· score do Radar {Math.round(item.priorityScore)} (informativo)</span></dd>
              <dt>Local</dt><dd>{[empresa?.cidade, empresa?.uf].filter(Boolean).join('/') || '—'}</dd>
              <dt>Oportunidade</dt><dd>{oportunidade ? `${oportunidade.titulo} · ${NOME_ESTAGIO[oportunidade.estagio]}` : '—'}</dd>
              <dt>Responsável</dt><dd>{item.responsavelId ? `${nomeUsuario(ds.usuarios, item.responsavelId)} ${NOME_ORIGEM_RESPONSAVEL[item.origemResponsavel]}` : <span className="muted">sem responsável</span>}</dd>
            </dl>
          </div>

          <div>
            <h3>Por que agora</h3>
            <p style={{ margin: 0 }}><b>{TEXTO_RAZAO_CM[p.codigo]}</b></p>
            {p.trava && <p className="small" style={{ margin: '4px 0 0' }}>{TEXTO_TRAVA_CM[p.trava]}{p.acaoBloqueada ? ` · segura: ${TEXTO_RAZAO_CM[p.acaoBloqueada].toLowerCase()}` : ''}</p>}
            <dl className="kv" style={{ marginTop: 8 }}>
              {p.em && <><dt>Fato</dt><dd>{d(p.em)}{p.dias != null && p.categoria !== 'AGENDADO' ? ` · há ${dias(p.dias)}` : ''}</dd></>}
              {p.resultado && <><dt>Resultado</dt><dd>{RESPOSTA_NOME(p.resultado, r.tiposResposta)}</dd></>}
              <dt>Prazo</dt><dd>{p.venceEm ? `${d(p.venceEm)}${p.categoria === 'AGENDADO' && p.dias != null ? ` · faltam ${dias(p.dias)}` : ''}` : '—'}</dd>
            </dl>
            <p className="small muted" style={{ marginTop: 8 }}>{seguinte && chave ? <>Acima de <b>{nomeEmpresa(seguinte.empresa)}</b> por: {NOME_CHAVE_ORDEM[chave]}.</> : 'Última conta desta visão.'}</p>
          </div>

          <div>
            <h3>Ação</h3>
            <p style={{ margin: 0 }}><b>{plano.explicacao.modo}</b></p>
            {plano.modo === 'AGUARDAR' && <p style={{ margin: '6px 0 0' }}>{plano.aguardarAte ? <>Retomar em <b>{d(plano.aguardarAte)}</b></> : 'Sem abordagem imediata.'}</p>}
            <div className="actions" style={{ marginTop: 10 }}>{acoes(linha)}</div>
            {!podeAgir && <p className="small muted" style={{ marginTop: 6 }}>Seu papel não permite registrar ações do Radar.</p>}
          </div>
        </div>

        <div className="grid cols-3" style={{ marginTop: 16, gap: 16 }}>
          <div>
            <h3>Pessoa</h3>
            {plano.contato && pessoa ? (
              <dl className="kv">
                <dt>Nome</dt><dd><b>{pessoa.nome}</b></dd>
                <dt>Cargo</dt><dd>{pessoa.cargo ?? '—'}</dd>
                <dt>Persona</dt><dd>{NOME_PERSONA[plano.contato.persona]}</dd>
                <dt>Decision fit</dt><dd>{plano.contato.fit}</dd>
                <dt>Por que ela</dt><dd>{plano.contato.motivo}</dd>
                <dt>Canais válidos</dt><dd>{plano.contato.canaisAcionaveis.map((c) => NOME_CANAL[c]).join(', ')}</dd>
              </dl>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>Este modo não aborda ninguém.{referencia && item.contato ? <> Contato de referência da conta: <b>{referencia.nome}</b> (decision fit {item.contato.fit}{item.contato.canais.length ? `, ${item.contato.canais.map((c) => NOME_CANAL[c]).join(', ')}` : ', sem canal válido'}).</> : ' A conta não tem contato elegível.'}</p>
            )}
          </div>

          <div>
            <h3>Plano de contato</h3>
            {plano.modo === 'CONTATO' && plano.comunicacao ? (
              <dl className="kv">
                <dt>Objetivo</dt><dd>{OBJETIVOS[plano.comunicacao.objetivo].nome}</dd>
                <dt>Playbook</dt><dd>{PLAYBOOKS[plano.comunicacao.playbook].nome}</dd>
                <dt>Canal</dt><dd><b>{NOME_CANAL[plano.comunicacao.canal]}</b>{plano.comunicacao.canaisAlternativos.length ? ` · alternativo: ${plano.comunicacao.canaisAlternativos.map((c) => NOME_CANAL[c]).join(', ')}` : ''}</dd>
                <dt>CTA</dt><dd>“{plano.comunicacao.cta}”</dd>
                <dt>Por que este objetivo</dt><dd>{plano.comunicacao.motivoSelecao}</dd>
                <dt>Por que este canal</dt><dd>{plano.comunicacao.motivoCanal}{plano.comunicacao.canaisDescartados.length ? ` · descartados por não serem acionáveis: ${plano.comunicacao.canaisDescartados.map((c) => NOME_CANAL[c.canal]).join(', ')}` : ''}</dd>
                {plano.comunicacao.origem === 'ARTEFATO_APROVADO' && <><dt>Origem</dt><dd>Abordagem já aprovada na revisão humana. O envio é manual e deve ser registrado como atividade.</dd></>}
              </dl>
            ) : <p className="small muted" style={{ margin: 0 }}>Sem plano de contato: o modo é {NOME_MODO[plano.modo].toLowerCase()}.</p>}
          </div>

          <div>
            <h3>Histórico</h3>
            <dl className="kv">
              <dt>Última interação</dt><dd>{h.ultimaInteracao ? `${d(h.ultimaInteracao.em)} · ${NOME_TIPO_ATIVIDADE[h.ultimaInteracao.tipo]} · ${NOME_CANAL[h.ultimaInteracao.canal]}${h.ultimaInteracao.contatoId ? ` · ${contatoPorId.get(h.ultimaInteracao.contatoId)?.nome ?? ''}` : ''}` : 'nenhuma'}</dd>
              <dt>Último resultado</dt><dd>{h.ultimoResultado ? `${RESPOSTA_NOME(h.ultimoResultado.resultado, r.tiposResposta)} · ${d(h.ultimoResultado.em)}` : '—'}</dd>
              <dt>Tentativas</dt><dd>{h.tentativas} · sem resposta seguidas: {h.semRespostaSeguidas}</dd>
              <dt>Houve resposta</dt><dd>{h.houveResposta ? 'sim' : 'não'}</dd>
              <dt>Abordagens</dt><dd>{h.comunicacoesEmRevisao.length} em revisão · {h.comunicacoesAprovadasNaoEnviadas.length} aprovada(s) não enviada(s)</dd>
            </dl>
          </div>
        </div>

        {blocoCadencia(linha)}

        <div style={{ marginTop: 16 }}>
          <h3>Travas e pendências</h3>
          {!plano.bloqueios.length && !item.travas.length && !item.secundarias.length ? <p className="small muted" style={{ margin: 0 }}>Nenhuma trava ou pendência.</p> : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {plano.bloqueios.map((b, k) => <li key={`b${k}`}><Badge tone="bad">Bloqueio</Badge> {TEXTO_BLOQUEIO_PLANO_CM[b.codigo]}</li>)}
              {bloqueiosTrava.map((t, k) => <li key={`tb${k}`}><Badge tone="bad">Bloqueio</Badge> {TEXTO_TRAVA_CM[t.codigo]} · segura: {t.bloqueia.map((c) => TEXTO_RAZAO_CM[c].toLowerCase()).join('; ')}</li>)}
              {pendenciasTrava.map((t, k) => <li key={`tp${k}`}><Badge tone="warn">Pendência</Badge> {TEXTO_TRAVA_CM[t.codigo]}</li>)}
              {pendentes.map((s, k) => <li key={`s${k}`}><Badge tone={s.estado === 'BLOQUEADA' ? 'bad' : 'warn'}>{NOME_ESTADO_RAZAO[s.estado]}</Badge> {TEXTO_RAZAO_CM[s.codigo]} <span className="muted">· {NOME_CATEGORIA_CM[s.categoria]}{s.venceEm ? ` · prazo ${d(s.venceEm)}` : ''}</span></li>)}
              {adiadas.map((s, k) => <li key={`a${k}`}><Badge tone="info">Informação</Badge> {TEXTO_RAZAO_CM[s.codigo]} <span className="muted">· {s.estado === 'ADIADA' ? NOME_ESTADO_RAZAO.ADIADA.toLowerCase() : NOME_CATEGORIA_CM[s.categoria]}{s.venceEm ? ` · prazo ${d(s.venceEm)}` : ''}</span></li>)}
            </ul>
          )}
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Bloco "Cadencia" (somente leitura): apresenta a cadencia (CM2-B) e a sugestao de compromisso (CM2-C) sem decidir nada.
  // A tarefa sugerida vem estritamente de sugestao.tarefa: sem contato nela, o contato fica "a definir" (nunca o da fila).
  // CM2-D2: o CTA abre o formulario governado com o snapshot do clique; quem cria a tarefa e a fronteira (CM2-E).
  // -------------------------------------------------------------------------------------------------------------------
  function blocoCadencia({ cadencia: c, sugestao: s }: Linha): React.ReactNode {
    const t = c.proximoToque;
    const sugerida = s.tarefa;
    const oportunidadeSugerida = sugerida?.oportunidadeId ? r.oportunidades.find((o) => o.id === sugerida.oportunidadeId) : undefined;
    const contatoSugerido = sugerida?.contatoId ? contatoPorId.get(sugerida.contatoId) : undefined;
    const tarefaCobertura = s.cobertura ? r.tarefas.find((x) => x.id === s.cobertura!.tarefaId) : undefined;
    const lista = { margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 } as const;
    const rotuloCta = ctaCadenciaCM(s, podeAgir);
    return (
      <div className="grid cols-2" style={{ marginTop: 16, gap: 16 }}>
        <div>
          <h3>Cadência</h3>
          <p style={{ margin: 0 }}><b>{TEXTO_ESTADO_CADENCIA_CM[c.estado]}</b></p>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Motivo</dt><dd>{TEXTO_RAZAO_CM[c.motivo]}</dd>
            {t && t.natureza === 'RECOMENDADA' && t.em && (
              <><dt>Próximo toque recomendado</dt><dd><b>{d(t.em)}</b><div className="small muted">Ainda não é um compromisso agendado.{t.ancoraEm ? ` Contado a partir do último movimento real em ${d(t.ancoraEm)}.` : ''}</div></dd></>
            )}
            {t && t.natureza !== 'RECOMENDADA' && (
              <><dt>Próximo toque</dt><dd>{t.em ? <><b>{d(t.em)}</b> — {TEXTO_NATUREZA_TOQUE_CM[t.natureza]}</> : <b>{TEXTO_NATUREZA_TOQUE_CM[t.natureza]}</b>}</dd></>
            )}
            {c.tentativa && <><dt>Tentativas sem resposta</dt><dd>{c.tentativa.semRespostaSeguidas} de {c.tentativa.limite}{c.tentativa.doContato != null ? ` · neste contato: ${c.tentativa.doContato}` : ''}</dd></>}
            {c.retomaCom && <><dt>Retomada</dt><dd>{TEXTO_RETOMADA_CADENCIA_CM[c.retomaCom]}</dd></>}
          </dl>
          {c.avisos.length > 0 && (
            <ul className="small" style={lista} aria-label="Avisos da cadência">
              {c.avisos.map((a) => <li key={a}><Badge tone="info">Aviso</Badge> {TEXTO_AVISO_CADENCIA_CM[a]}</li>)}
            </ul>
          )}
        </div>

        <div>
          <h3>Próximo compromisso</h3>
          {s.estado === 'NAO_APLICAVEL'
            ? <p className="small muted" style={{ margin: 0 }}>{CABECALHO_SUGESTAO.NAO_APLICAVEL}{c.estado !== 'DEVIDA' ? ` ${s.explicacao.porQue}.` : ''}</p>
            : <p style={{ margin: 0 }}><b>{CABECALHO_SUGESTAO[s.estado]}</b></p>}
          {sugerida && (s.estado === 'SUGERIDA' || s.estado === 'REQUER_RESPONSAVEL') && (
            <>
              <p className="small" style={{ margin: '6px 0 0' }}><Badge tone="info">Sugestão</Badge> ainda não existe tarefa: nada foi agendado.</p>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>Tipo</dt><dd>{NOME_TIPO_TAREFA[sugerida.tipo] ?? sugerida.tipo}</dd>
                <dt>Data</dt><dd>{d(sugerida.venceEm)}{t?.natureza === 'RECOMENDADA' ? <span className="small muted"> · {TEXTO_NATUREZA_TOQUE_CM.RECOMENDADA}</span> : null}</dd>
                {sugerida.oportunidadeId && <><dt>Oportunidade</dt><dd>{oportunidadeSugerida ? `${oportunidadeSugerida.titulo} · ${NOME_ESTAGIO[oportunidadeSugerida.estagio]}` : '—'}</dd></>}
                <dt>Responsável</dt><dd>{sugerida.responsavelId ? nomeUsuario(ds.usuarios, sugerida.responsavelId) : <span className="muted">a definir</span>}</dd>
                <dt>Contato</dt><dd>{sugerida.contatoId ? contatoSugerido?.nome ?? '—' : 'a definir no agendamento'}</dd>
                <dt>Descrição</dt><dd>{sugerida.descricaoBase}</dd>
              </dl>
              {rotuloCta && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn sm primary" onClick={() => abrirAgendamento(c, s)} aria-label={`${rotuloCta} recomendada pela Máquina Comercial`}>{rotuloCta}</button>
                  <p className="small muted" style={{ margin: '6px 0 0' }}>A recomendação é revalidada no momento de agendar: nada é criado sem passar pela Máquina Comercial.</p>
                </div>
              )}
            </>
          )}
          {s.estado === 'COBERTA' && s.cobertura && (
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Por quê</dt><dd>{TEXTO_COBERTURA_TAREFA_CM[s.cobertura.motivo]}</dd>
              {tarefaCobertura && <><dt>Tarefa</dt><dd>{tarefaCobertura.descricao}</dd><dt>Prazo</dt><dd>{d(tarefaCobertura.venceEm)}</dd><dt>Responsável</dt><dd>{nomeUsuario(ds.usuarios, tarefaCobertura.responsavelId)}</dd></>}
            </dl>
          )}
          {(s.estado === 'REQUER_DATA' || s.estado === 'BLOQUEADA') && s.pendencias.length > 0 && (
            <ul className="small" style={lista} aria-label="Pendências do próximo compromisso">
              {s.pendencias.map((p) => <li key={p}><Badge tone="warn">Pendência</Badge> {TEXTO_PENDENCIA_TAREFA_CM[p]}</li>)}
            </ul>
          )}
          {s.avisos.length > 0 && (
            <ul className="small" style={lista} aria-label="Informações do próximo compromisso">
              {s.avisos.map((a) => <li key={a}><Badge tone="info">Informação</Badge> {TEXTO_AVISO_TAREFA_CM[a]}</li>)}
            </ul>
          )}
        </div>
      </div>
    );
  }

  /** Abre o agendamento governado com o retrato do clique. Falha fechada: sem expectativa, nada abre. */
  function abrirAgendamento(cadencia: CadenceRecommendationCM, sugestao: TaskSuggestionCM) {
    const abertura = abrirAgendamentoCM(cadencia, sugestao);
    if (!abertura.ok) { toast(MENSAGEM_SEM_EXPECTATIVA_CM); return; }
    setAgendar(abertura);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // CTAs: dependem do MODO do plano e da referencia exata do item (nunca da categoria nem de "qualquer tarefa aberta")
  // -------------------------------------------------------------------------------------------------------------------
  // UX-1: as acoes viraram descritores para o Panorama poder mostrar SO a principal sem duplicar regra. O
  // `switch (plano.modo)` continua existindo aqui e so aqui; rotulos, ordem e destino sao os mesmos de sempre.
  function acoesDoItem({ item, plano, empresa }: Linha): AcaoItemUX[] {
    const empresaId = item.empresaId;
    const titulo = (t: string) => `${t} · ${nomeEmpresa(empresa)}`;
    const tarefaPorRef = (ref?: { tipo: string; id: string }) => (ref?.tipo === 'tarefa' ? r.tarefas.find((t) => t.id === ref.id && t.status === 'Aberta') : undefined);
    const tarefaDaAcao = tarefaPorRef(plano.referencia);
    // o id do descritor e o proprio rotulo (unico dentro do modo): serve so de key, nunca de regra
    const link = (to: string, texto: string, primario = false): AcaoItemUX => ({ id: texto, rotulo: texto, to, primario });
    const abrirEmpresa = (aba?: string, texto = 'Abrir empresa', primario = false): AcaoItemUX => link(`/radar/empresas/${empresaId}${aba ? `?aba=${aba}` : ''}`, texto, primario);
    const botao = (texto: string, onClick: () => void, primario = false): AcaoItemUX => ({ id: texto, rotulo: texto, onClick, primario });
    const novaTarefa = (p: Partial<TarefaRadar>) => setTarefa(actions.novaTarefaRadar(empresaId, p));

    switch (plano.modo) {
      case 'CONTATO': {
        const contatoId = plano.contato!.id;
        return [
          botao(plano.comunicacao?.origem === 'ARTEFATO_APROVADO' ? 'Abrir abordagem aprovada' : 'Preparar abordagem', () => setAbordagem({ empresaId, contatoId, titulo: titulo('Abordagem'), intencao: intencaoDoPlanoCM(plano) }), true),
          botao('Registrar atividade', () => setAtividade({ empresaId, contatoId, oportunidadeId: item.oportunidadeId })),
          tarefaDaAcao
            ? botao('Concluir esta tarefa', () => setConcluir(tarefaDaAcao))
            : botao('Agendar tarefa', () => novaTarefa({ tipo: plano.tipoTarefa, contatoId, oportunidadeId: item.oportunidadeId, descricao: plano.explicacao.acao })),
        ];
      }
      case 'ACAO_INTERNA': {
        if (tarefaDaAcao) return [
          botao('Concluir esta tarefa', () => setConcluir(tarefaDaAcao), true),
          botao('Registrar atividade', () => setAtividade({ empresaId, contatoId: tarefaDaAcao.contatoId, oportunidadeId: tarefaDaAcao.oportunidadeId })),
          abrirEmpresa(),
        ];
        if (plano.referencia?.tipo === 'oportunidade') {
          const oportunidadeId = plano.referencia.id;
          return [abrirEmpresa('oportunidades', 'Abrir oportunidade', true), botao('Criar tarefa manual', () => novaTarefa({ tipo: plano.tipoTarefa, oportunidadeId, descricao: plano.explicacao.modo }))];
        }
        return [abrirEmpresa(undefined, 'Abrir empresa', true)];
      }
      case 'REVISAR': {
        const rv = plano.revisar;
        const comunicacao = rv?.referencia?.tipo === 'comunicacao' ? r.comunicacoes.find((c) => c.id === rv.referencia!.id) : undefined;
        const tarefaRevisar = tarefaPorRef(rv?.referencia) ?? tarefaDaAcao;
        const revisarTarefa = tarefaRevisar ? [botao('Revisar tarefa', () => setTarefa(tarefaRevisar))] : [];
        if (comunicacao) return [botao('Revisar abordagem', () => setAbordagem({ empresaId, contatoId: comunicacao.contatoId, titulo: titulo('Revisar abordagem'), semGeracao: 'A Máquina Comercial pede revisar a abordagem existente: nenhuma nova é gerada daqui.' }), true), abrirEmpresa()];
        if (rv?.trava === 'DUPLICATA_PENDENTE') return [link('/radar?aba=duplicatas', 'Resolver duplicata', true), abrirEmpresa()];
        if (plano.bloqueios.some((b) => b.codigo === 'EMPRESA_SUPRIMIDA')) return [link('/radar?aba=supressoes', 'Ver lista de não contatar', true), abrirEmpresa()];
        if (rv?.trava === 'OPORTUNIDADE_SEM_RESPONSAVEL') return [abrirEmpresa('oportunidades', 'Definir responsável da oportunidade', true), ...revisarTarefa];
        if (rv?.trava === 'CONFLITO_TAREFA_COMUNICACAO') return [abrirEmpresa('atividades', 'Revisar tarefas e abordagens', true), ...revisarTarefa];
        if (rv?.alvo === 'COMPROMISSO' && tarefaRevisar) return [botao('Revisar tarefa', () => setTarefa(tarefaRevisar), true), abrirEmpresa()];
        return [abrirEmpresa('contatos', 'Revisar contatos da empresa', true), ...revisarTarefa];
      }
      case 'ENRIQUECER': {
        const en = plano.enriquecer;
        const principal = en?.alvo === 'VERIFICAR_SINAL' ? abrirEmpresa('sinais', 'Verificar sinal', true)
          : abrirEmpresa('contatos', en?.alvo === 'CANAL' ? 'Completar canal do contato' : en?.alvo === 'CONTATO_VALIDO' ? 'Validar ou trocar contato' : 'Buscar decisor nos contatos', true);
        return [principal, tarefaDaAcao
          ? botao('Revisar tarefa', () => setTarefa(tarefaDaAcao))
          : botao('Agendar pesquisa', () => novaTarefa({ tipo: 'RESEARCH', contatoId: en?.contatoId, oportunidadeId: item.oportunidadeId, descricao: plano.explicacao.modo }))];
      }
      case 'AGUARDAR':
        return [abrirEmpresa()];
    }
  }

  /** Renderiza os descritores. Botao exige permissao (como sempre); link nao. `primeira` e o que o Panorama mostra. */
  function acoes(linha: Linha, opcoes: { primeira?: boolean } = {}): React.ReactNode {
    const disponiveis = acoesDoItem(linha).filter((a) => !!a.to || podeAgir);
    const lista = opcoes.primeira ? [disponiveis.find((a) => a.primario) ?? disponiveis[0]].filter((a): a is AcaoItemUX => !!a) : disponiveis;
    return lista.map((a) => a.to
      ? <Link key={a.id} to={a.to} className={`btn sm${a.primario ? ' primary' : ''}`}>{a.rotulo}</Link>
      : <button key={a.id} className={`btn sm${a.primario ? ' primary' : ''}`} onClick={a.onClick}>{a.rotulo}</button>);
  }
}
