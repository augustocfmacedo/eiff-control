import React, { useState } from 'react';
import { NOME_ESTAGIO, NOME_SINAL, NOME_TIPO_ATIVIDADE, filaHoje, oportunidadesSemProximaAcao, type Empresa, type ItemFila, type TarefaRadar } from '../../core/radar';
import { pode, useStore } from '../../data/store';
import { Badge, Empty, KpiStrip, Link, PageHead, Select, useToast } from '../../ui/components';
import { AtividadeForm, ConcluirTarefaForm, RESPOSTA_NOME, ScoreModal, ScorePill, TarefaForm, d } from './comum';
import { actions } from '../../data/store';

export default function RadarHoje() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const hoje = ds.params.dataBase;
  const [somenteMinhas, setSomenteMinhas] = useState(true);
  const [classe, setClasse] = useState('');
  const [limite, setLimite] = useState(30);
  const [score, setScore] = useState<Empresa | null>(null);
  const [atividade, setAtividade] = useState<ItemFila | null>(null);
  const [concluir, setConcluir] = useState<TarefaRadar | null>(null);
  const [tarefa, setTarefa] = useState<TarefaRadar | null>(null);
  const podeAgir = pode(usuario, 'radar');
  const fila = filaHoje(ds.radar, hoje, somenteMinhas ? usuario.id : undefined).filter((i) => !classe || i.empresa.priorityClass === classe);
  const vencidas = fila.filter((i) => i.vencida).length;
  const semAcao = oportunidadesSemProximaAcao(ds.radar).length;
  const tarefasHoje = ds.radar.tarefas.filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) === hoje && (!somenteMinhas || t.responsavelId === usuario.id));
  const tarefaDe = (empresaId: string) => ds.radar.tarefas.filter((t) => t.empresaId === empresaId && t.status === 'Aberta').sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1))[0];
  return (
    <>
      <PageHead title="Hoje" subtitle="Fila do dia ordenada por prioridade: vencidas primeiro, depois o score. Cada linha diz por que a empresa está aqui e qual é a melhor próxima ação.">
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={somenteMinhas} onChange={(e) => setSomenteMinhas(e.target.checked)} /> só as minhas</label>
        <Select value={classe} onChange={setClasse} options={['A+', 'A', 'B', 'C', 'D']} allowEmpty="Todas as classes" />
      </PageHead>
      <KpiStrip itens={[
        { label: 'Na fila', value: fila.length, hint: `${fila.filter((i) => i.empresa.priorityClass === 'A+' || i.empresa.priorityClass === 'A').length} classe A ou A+` },
        { label: 'Vencidas', value: vencidas, tone: vencidas ? 'neg' : undefined, hint: 'próxima ação no passado' },
        { label: 'Para hoje', value: tarefasHoje.length, hint: 'tarefas com prazo hoje' },
        { label: 'Sem próxima ação', value: semAcao, tone: semAcao ? 'warn' : undefined, hint: 'oportunidades ativas', to: '/radar?aba=alertas' },
        { label: 'Atividades hoje', value: ds.radar.atividades.filter((a) => a.ocorreuEm.slice(0, 10) === hoje).length },
      ]} />
      <div style={{ height: 16 }} />
      {!fila.length ? <Empty icone="hoje" titulo="Fila vazia">Importe empresas ou registre sinais: a fila se monta pelo score e pelas próximas ações.</Empty> : (
        <div className="grid" style={{ gap: 8 }}>
          {fila.slice(0, limite).map((i) => {
            const t = tarefaDe(i.empresa.id);
            const hojeTem = !!i.proximaAcaoEm && i.proximaAcaoEm.slice(0, 10) === hoje;
            return (
              <div key={i.empresa.id} className={`fila-item ${i.vencida ? 'vencida' : hojeTem ? 'hoje' : ''}`}>
                <div>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}><ScorePill e={i.empresa} onClick={() => setScore(i.empresa)} /><Link to={`/radar/empresas/${i.empresa.id}`}><b>{i.empresa.nomeFantasia ?? i.empresa.razaoSocial}</b></Link></div>
                  <div className="small muted">{[i.empresa.cidade, i.empresa.uf].filter(Boolean).join('/') || 'local não informado'}{i.empresa.setor ? ` · ${i.empresa.setor}` : ''}</div>
                  <div className="small" style={{ marginTop: 4 }}><span className="k">Por quê</span> <span className="v">{i.motivo}</span></div>
                </div>
                <div>
                  <div className="k">Sinal principal</div><div className="v">{i.sinal ? `${NOME_SINAL[i.sinal.tipo]} · ${d(i.sinal.eventoEm)}` : '—'}</div>
                  <div className="k" style={{ marginTop: 6 }}>Decisor</div><div className="v">{i.decisor ? `${i.decisor.nome}${i.decisor.cargo ? ` · ${i.decisor.cargo}` : ''}` : <span className="muted">não identificado</span>}</div>
                </div>
                <div>
                  <div className="k">Última interação</div><div className="v">{i.ultimaAtividade ? `${d(i.ultimaAtividade.ocorreuEm)} · ${NOME_TIPO_ATIVIDADE[i.ultimaAtividade.tipo]}${i.ultimaAtividade.resultado ? ` · ${RESPOSTA_NOME(i.ultimaAtividade.resultado, ds.radar.tiposResposta)}` : ''}` : <span className="muted">nenhuma</span>}</div>
                  <div className="k" style={{ marginTop: 6 }}>Próxima ação</div><div className="v">{i.proximaAcaoEm ? <><span className={i.vencida ? 'neg' : ''}>{d(i.proximaAcaoEm)}</span>{i.proximaAcao ? ` · ${i.proximaAcao}` : ''}</> : <span className="muted">nenhuma</span>}{i.oportunidade && <div className="small muted">{i.oportunidade.titulo} · {NOME_ESTAGIO[i.oportunidade.estagio]}</div>}</div>
                </div>
                <div>
                  <div className="k">Ação recomendada</div><div className="v"><b>{i.recomendacao.acao}</b></div><div className="small muted">{i.recomendacao.motivo}</div>
                  {i.semProximaAcao && <Badge tone="warn">oportunidade sem próxima ação</Badge>}
                </div>
                <div className="actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  {podeAgir && <button className="btn sm primary" onClick={() => setAtividade(i)}>Registrar</button>}
                  {podeAgir && t && <button className="btn sm" onClick={() => setConcluir(t)}>Concluir tarefa</button>}
                  {podeAgir && !t && <button className="btn sm" onClick={() => setTarefa(actions.novaTarefaRadar(i.empresa.id, { tipo: i.recomendacao.tipoTarefa, descricao: i.recomendacao.acao, oportunidadeId: i.oportunidade?.id, contatoId: i.decisor?.id }))}>Agendar</button>}
                </div>
              </div>
            );
          })}
          {fila.length > limite && <button className="btn" onClick={() => setLimite(limite + 30)}>Mostrar mais ({fila.length - limite})</button>}
        </div>
      )}
      {score && <ScoreModal e={score} onClose={() => setScore(null)} />}
      {atividade && <AtividadeForm empresaId={atividade.empresa.id} contatoId={atividade.decisor?.id} oportunidadeId={atividade.oportunidade?.id} onClose={() => setAtividade(null)} onErro={toast} onOk={toast} />}
      {concluir && <ConcluirTarefaForm tarefa={concluir} onClose={() => setConcluir(null)} onErro={toast} onOk={toast} />}
      {tarefa && <TarefaForm inicial={tarefa} onClose={() => setTarefa(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
