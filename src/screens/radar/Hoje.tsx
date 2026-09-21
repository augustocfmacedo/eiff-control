// Radar · Hoje 2.0 — cockpit operacional da Maquina Comercial.
// A tela so APRESENTA o que o motor decidiu: a fila, a ordem e a acao vem de construirCommercialQueue (CM1-A) e o modo,
// o contato, o objetivo, o playbook e o canal vem de planosDaFilaCM (CM1-B). Nada de prioridade, contato, canal ou
// proxima acao e recalculado aqui; filtros so escondem itens, nunca reordenam.
// Cadencia (CM2-B) e sugestao de compromisso (CM2-C) sao somente leitura: a tela mostra estado, proximo toque, natureza da
// data, tentativas, avisos e a sugestao ja calculados; nenhum botao novo, nenhuma tarefa criada a partir deles.
import React, { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIAS_COMMERCIAL_QUEUE, MOTIVOS_FORA_DA_FILA, NOME_CANAL, NOME_CATEGORIA_CM,
  TEXTO_FORA_DA_FILA, TEXTO_RAZAO_CM, VERSAO_REGRAS_CADENCIA_CM, VERSAO_REGRAS_CM, VERSAO_REGRAS_PLANO_CM,
  OBJETIVOS, cadenciasDaFilaCM, construirCommercialQueue, itemIdCM, planosDaFilaCM, sugestoesTarefaDaFilaCM,
  type CadenceRecommendationCM, type CategoriaCommercialQueue, type CommercialActionPlan, type CommercialQueueItem, type Empresa,
  type NaturezaToqueCM, type RetomadaCadenciaCM, type TarefaRadar, type TaskSuggestionCM,
} from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { normalizar } from '../../ui/busca';
import { Tabela } from '../../ui/Tabela';
import { Badge, Empty, Input, KpiStrip, Link, Modal, PageHead, Select, Tabs, useToast } from '../../ui/components';
import { Abordagem } from './Abordagem';
import { intencaoDoPlanoCM, type IntencaoComunicacaoCM } from '../../core/radar/comunicacaoIntencaoCM';
import { AtividadeForm, ConcluirTarefaForm, ScoreModal, TarefaCadenciaForm, TarefaForm, d } from './comum';
import ComercialPanorama from './ComercialPanorama';
import ComercialFoco, { NOME_MODO, TOM_CATEGORIA, TOM_MODO, gavetaFailClosed, nomeEmpresaCM as nomeEmpresa } from './ComercialFoco';
import ComercialModoFoco, { focoAoEntrarUX, focoInvalidadoUX, type AcaoFocoUX, type FocoTrabalhoUX } from './ComercialModoFoco';
import { visaoComercialUX } from './comercialVisao';
import { MENSAGEM_SEM_EXPECTATIVA_CM, abrirAgendamentoCM, ctaCadenciaCM, type AberturaAgendamentoCM } from './HojeCadencia';

// ---------------------------------------------------------------------------------------------------------------------
// Rotulos de apresentacao (nenhuma regra: so nomes para codigos que o motor ja devolve)
// ---------------------------------------------------------------------------------------------------------------------
// cadencia e sugestao: so nomes curtos e cabecalhos para estados que o motor ja devolve
const NOME_TOQUE_CURTO: Record<NaturezaToqueCM, string> = { IMEDIATA: 'Agora', FIRME: 'firme', BASE_CM1: 'intervalo', RECOMENDADA: 'recomendada' };
const NOME_RETOMADA_CURTO: Record<RetomadaCadenciaCM, string> = { DATA: 'Data definida', FATO_NOVO: 'Fato novo', DADO: 'Aguardando dado', DECISAO_HUMANA: 'Decisão humana' };
const ddmm = (s: string) => d(s).slice(0, 5);
const rotuloToque = (c: CadenceRecommendationCM) => {
  const t = c.proximoToque;
  if (t) return t.em ? `${ddmm(t.em)} ${NOME_TOQUE_CURTO[t.natureza]}` : NOME_TOQUE_CURTO[t.natureza];
  return c.retomaCom ? NOME_RETOMADA_CURTO[c.retomaCom] : '—';
};

type FiltroCategoria = 'TODAS' | CategoriaCommercialQueue;
type VisaoComercial = 'panorama' | 'foco' | 'fila';
/** Descritor de acao: o Panorama mostra so a principal e a fila mostra todas, sem duplicar o `switch (plano.modo)`. */
type AcaoItemUX = AcaoFocoUX;
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
  const [porQue, setPorQue] = useState<string | null>(null);
  // UX-3: identidade do foco de trabalho e o itemId (nunca o indice). `perdido` guarda a conta que saiu da base:
  // enquanto estiver preenchido, a tela fica no estado neutro e NENHUMA outra conta e escolhida no lugar.
  const [focoTrabalhoId, setFocoTrabalhoId] = useState<string | null>(null);
  const [focoPerdido, setFocoPerdido] = useState<string | null>(null);

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
  // UX-3: a conta em foco saiu da base (acao, filtro ou recomputacao legitima). O efeito so INVALIDA o foco e
  // registra a perda; nunca seleciona outra conta — quem escolhe a proxima e o usuario, sempre por clique.
  useEffect(() => {
    if (focoInvalidadoUX(contasUX, focoTrabalhoId)) { setFocoPerdido(focoTrabalhoId); setFocoTrabalhoId(null); }
  }, [contasUX, focoTrabalhoId]);
  /** Entrada EXPLICITA no Modo Foco: preserva foco valido, senao seleciona a primeira da fila. So no clique da aba. */
  const trocarVisao = (v: VisaoComercial) => {
    if (v === 'foco') { setFocoTrabalhoId(focoAoEntrarUX(contasUX, focoTrabalhoId)); setFocoPerdido(null); }
    setVisao(v);
  };
  const foco3: FocoTrabalhoUX = { id: focoTrabalhoId, perdido: focoPerdido };
  /** Unico caminho de saida do estado "conta indisponivel", e so por clique do usuario. */
  const irParaPrimeiraDisponivel = () => { const c = contasUX[0]; if (c) { setFocoTrabalhoId(c.itemId); setFocoPerdido(null); } };
  /** Objetivo: catalogo OBJETIVOS quando ha plano de comunicacao; senao a explicacao do modo que o CM1-B ja escreveu. */
  const objetivoDaConta = (itemId: string) => {
    const l = porLinha.get(itemId);
    if (!l) return '';
    return l.plano.comunicacao ? OBJETIVOS[l.plano.comunicacao.objetivo].nome : l.plano.explicacao.modo;
  };
  /** Leva a conta para a fila completa, em foco (a visao de trabalho completa continua a um clique da gaveta). */
  const verNaFila = (itemId: string) => {
    const linha = porLinha.get(itemId);
    if (linha && categoria !== 'TODAS' && linha.item.categoria !== categoria) setCategoria('TODAS');
    setFocoId(itemId);
    setPorQue(null);
    setVisao('fila');
  };
  // UX-2/UX-2.1: a gaveta mostra a MESMA apresentacao do foco, em modo EXPLICACAO, e vive presa a uma colecao
  // autorizada: a visao filtrada de onde foi aberta. Se a conta sai dessa visao, a gaveta fecha (fail-closed).
  const idsAutorizados = useMemo(() => base.map((l) => l.id), [base]);
  const idDaGaveta = gavetaFailClosed(porQue, idsAutorizados);
  useEffect(() => { if (porQue && !idDaGaveta) setPorQue(null); }, [porQue, idDaGaveta]);
  const indiceDaGaveta = idDaGaveta ? base.findIndex((l) => l.id === idDaGaveta) : -1;
  const linhaDaGaveta: Linha | undefined = indiceDaGaveta >= 0 ? base[indiceDaGaveta] : undefined;

  return (
    <>
      <PageHead title="Comercial" subtitle={<>{visao === 'foco'
        ? <>Uma conta por vez, na ordem da Máquina Comercial. Executar uma ação não avança a fila: a próxima conta é sempre uma escolha sua.</>
        : visao === 'panorama'
        ? <>O que precisa da sua atenção agora, o que espera alguém e o que está programado. Ordem, ação e cadência vêm da Máquina Comercial; o Panorama só apresenta.</>
        : <>Sua fila comercial priorizada pelo que exige ação agora. Ordem, ação, plano e cadência vêm da Máquina Comercial (fila {VERSAO_REGRAS_CM} · plano {VERSAO_REGRAS_PLANO_CM} · cadência {VERSAO_REGRAS_CADENCIA_CM}); os filtros só escondem itens, não mudam a ordem.</>}</>}>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={somenteMinhas} onChange={(e) => setSomenteMinhas(e.target.checked)} /> Só as minhas</label>
        <Select value={classe} onChange={setClasse} options={['A+', 'A', 'B', 'C', 'D']} allowEmpty="Todas as classes" aria-label="Classe" />
        <Input placeholder="Buscar empresa ou contato" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar empresa ou contato" style={{ width: 220 }} />
      </PageHead>

      <Tabs value={visao} onChange={trocarVisao} items={[{ id: 'panorama' as VisaoComercial, label: 'Panorama' }, { id: 'foco' as VisaoComercial, label: 'Trabalhar a fila' }, { id: 'fila' as VisaoComercial, label: `Fila completa (${base.length})` }]} />

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
              onPorQue={(c) => setPorQue(c.itemId)}
              onVerTodos={() => setVisao('fila')}
            />
          </div>
      ) : visao === 'foco' ? (
        <div style={{ marginTop: 12 }}>
          <ComercialModoFoco
            contas={contasUX}
            foco={foco3}
            nomeEmpresa={(id) => nomeEmpresa(empresaPorId.get(id))}
            nomeContato={(id) => contatoPorId.get(id)?.nome ?? '—'}
            nomeCanal={(canal) => (canal ? NOME_CANAL[canal] : '')}
            classeDaConta={(itemId) => porLinha.get(itemId)?.item.priorityClass}
            objetivoDaConta={objetivoDaConta}
            acoes={(itemId) => { const l = porLinha.get(itemId); return l ? acoesDisponiveis(l) : []; }}
            ctaCadencia={(itemId) => { const l = porLinha.get(itemId); return l ? ctaCadenciaDe(l) : null; }}
            onFoco={(itemId) => { setFocoTrabalhoId(itemId); setFocoPerdido(null); }}
            onPorQue={setPorQue}
            onPanorama={() => setVisao('panorama')}
            onPrimeiraDisponivel={irParaPrimeiraDisponivel}
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
          <ComercialFoco linha={foco} seguinte={seguinte} posicao={indiceFoco + 1} total={visiveis.length} modo="OPERACIONAL" radar={r} usuarios={ds.usuarios} acoes={acoes(foco)} ctaCadencia={ctaCadenciaDe(foco)} semPermissao={!podeAgir} onScore={setScore} />
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
      {/* UX-2/UX-2.1 — gaveta "Por quê": a MESMA apresentacao do foco, em modo EXPLICACAO (nenhum no de acao entra) */}
      {linhaDaGaveta && (
        <Modal key={`porque:${linhaDaGaveta.id}`} title={`Por quê · ${nomeEmpresa(linhaDaGaveta.empresa)}`} onClose={() => setPorQue(null)} wide>
          <ComercialFoco linha={linhaDaGaveta} seguinte={base[indiceDaGaveta + 1]} posicao={indiceDaGaveta + 1} total={base.length} modo="EXPLICACAO" radar={r} usuarios={ds.usuarios} />
          <p className="small muted" style={{ marginTop: 12 }}>Regras em vigor: fila {VERSAO_REGRAS_CM} · plano {VERSAO_REGRAS_PLANO_CM} · cadência {VERSAO_REGRAS_CADENCIA_CM}.</p>
          <div className="foot">
            <button className="btn" onClick={() => verNaFila(linhaDaGaveta.id)}>Abrir na fila completa</button>
            <button className="btn primary" onClick={() => setPorQue(null)}>Fechar</button>
          </div>
        </Modal>
      )}
      {el}
    </>
  );

  /** Acao principal + CTA governado da cadencia: montados aqui (autoridade unica) e passados ao bloco compartilhado. */
  function ctaCadenciaDe(l: Linha) {
    const rotulo = ctaCadenciaCM(l.sugestao, podeAgir);
    return rotulo ? <button className="btn sm primary" onClick={() => abrirAgendamento(l.cadencia, l.sugestao)} aria-label={`${rotulo} recomendada pela Máquina Comercial`}>{rotulo}</button> : null;
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

  /** Descritores que este usuario pode acionar: botao exige permissao (como sempre); link nao. */
  function acoesDisponiveis(linha: Linha): AcaoItemUX[] {
    return acoesDoItem(linha).filter((a) => !!a.to || podeAgir);
  }

  /** Renderiza os descritores. `primeira` e o que o Panorama mostra. */
  function acoes(linha: Linha, opcoes: { primeira?: boolean } = {}): React.ReactNode {
    const disponiveis = acoesDisponiveis(linha);
    const lista = opcoes.primeira ? [disponiveis.find((a) => a.primario) ?? disponiveis[0]].filter((a): a is AcaoItemUX => !!a) : disponiveis;
    return lista.map((a) => a.to
      ? <Link key={a.id} to={a.to} className={`btn sm${a.primario ? ' primary' : ''}`}>{a.rotulo}</Link>
      : <button key={a.id} className={`btn sm${a.primario ? ' primary' : ''}`} onClick={a.onClick}>{a.rotulo}</button>);
  }
}
