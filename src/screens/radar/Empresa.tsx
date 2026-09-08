import React, { useState } from 'react';
import { NOME_CANAL, NOME_ESTAGIO, NOME_ESTADO_ACAO, NOME_PERSONA, NOME_SINAL, NOME_TIPO_ATIVIDADE, NOME_TIPO_TAREFA, calcularScore, contatoElegivel, contatoRecomendado, contatoSuprimido, contextoEmpresa, empresaSuprimida, estagioAtivo, formatarCnpj, lerEmpresa, type Contato, type Empresa, type Oportunidade, type Projeto, type TarefaRadar } from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { Badge, Empty, KpiStrip, Link, PageHead, ProgressRow, Tabs, money, tentar, useToast } from '../../ui/components';
import { Abordagem } from './Abordagem';
import { AtividadeForm, ConcluirTarefaForm, ContatoForm, EmpresaForm, OportunidadeForm, ProjetoForm, RESPOSTA_NOME, ScoreModal, ScorePill, SinalForm, TONE_ESTAGIO, TarefaForm, d, dh, nomeUsuario, toneClasse, valor } from './comum';

type Aba = 'overview' | 'contatos' | 'projetos' | 'sinais' | 'atividades' | 'oportunidades' | 'inteligencia';

export default function RadarEmpresa({ id, query }: { id: string; query: URLSearchParams }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const r = ds.radar;
  const hoje = ds.params.dataBase;
  const [aba, setAba] = useState<Aba>((query.get('aba') as Aba) || 'overview');
  const [score, setScore] = useState(false);
  const [editEmpresa, setEditEmpresa] = useState<Empresa | null>(null);
  const [contato, setContato] = useState<Contato | null>(null);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [sinal, setSinal] = useState(false);
  const [atividade, setAtividade] = useState<{ contatoId?: string; oportunidadeId?: string } | null>(null);
  const [tarefa, setTarefa] = useState<TarefaRadar | null>(null);
  const [concluir, setConcluir] = useState<TarefaRadar | null>(null);
  const [opp, setOpp] = useState<Oportunidade | null>(null);
  const e = r.empresas.find((x) => x.id === id);
  const podeAgir = pode(usuario, 'radar');
  if (!e) return <Empty icone="empresas" titulo="Empresa não encontrada"><Link to="/radar/empresas">Voltar à lista</Link></Empty>;
  const item = lerEmpresa(e, r, hoje);
  const ctx = contextoEmpresa(r, e.id)!;
  const x = calcularScore(ctx, r.regrasScore, r.configScore, hoje);
  const contatos = r.contatos.filter((c) => c.empresaId === e.id).sort((a, b) => Number(!!b.isPrimario) - Number(!!a.isPrimario) || (b.decisionFitScore ?? 0) - (a.decisionFitScore ?? 0) || b.qualidade - a.qualidade);
  const sugestao = contatoRecomendado(e.id, r);
  const projetos = r.projetos.filter((p) => p.empresaId === e.id);
  const sinais = r.sinais.filter((s) => s.empresaId === e.id).sort((a, b) => (a.eventoEm < b.eventoEm ? 1 : -1));
  const atividades = r.atividades.filter((a) => a.empresaId === e.id).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1));
  const tarefas = r.tarefas.filter((t) => t.empresaId === e.id).sort((a, b) => (a.status !== b.status ? (a.status === 'Aberta' ? -1 : 1) : a.venceEm < b.venceEm ? -1 : 1));
  const opps = r.oportunidades.filter((o) => o.empresaId === e.id);
  const snapshots = r.snapshotsScore.filter((s) => s.empresaId === e.id).sort((a, b) => (a.em < b.em ? 1 : -1));
  const fonte = r.fontes.find((f) => f.id === e.fonteId);
  const suprimida = empresaSuprimida(e.id, r);
  const estrategia = item.oportunidade?.estrategiaId ? r.estrategias.find((s) => s.id === item.oportunidade!.estrategiaId) : undefined;
  const sugerirEstrategia = () => { if (e.timingScore >= 40 && e.intentScore < 30) return 'PRELIMINARY_ENGINEERING'; if (atividades.some((a) => a.resultado === 'ALREADY_HAS_SUPPLIER')) return 'SECOND_QUOTE'; if (atividades.some((a) => a.resultado === 'PRICE_OBJECTION')) return 'COST_REDUCTION'; if (atividades.some((a) => a.resultado === 'TIME_OBJECTION')) return 'FAST_DELIVERY'; if (e.setor === 'Construção') return 'FABRICATION_PARTNER'; return 'TECHNICAL_AUDIT'; };
  const sugerida = r.estrategias.find((s) => s.codigo === sugerirEstrategia());
  return (
    <>
      <PageHead title={e.nomeFantasia ?? e.razaoSocial} subtitle={<>{e.nomeFantasia && <>{e.razaoSocial} · </>}{[e.cidade, e.uf].filter(Boolean).join('/') || 'local não informado'}{e.setor ? ` · ${e.setor}` : ''}{e.cnpj ? ` · CNPJ ${formatarCnpj(e.cnpj)}` : ''} · <Link to="/radar/empresas">todas as empresas</Link></>}>
        <ScorePill e={e} onClick={() => setScore(true)} />
        {suprimida && <Badge tone="bad">não contatar</Badge>}
        {e.mescladaEm && <Badge tone="muted">mesclada</Badge>}
        {podeAgir && <button className="btn" onClick={() => setEditEmpresa(e)}>Editar</button>}
        {podeAgir && <button className="btn" onClick={() => setSinal(true)}>+ Sinal</button>}
        {podeAgir && <button className="btn primary" onClick={() => setAtividade({ contatoId: item.decisor?.id, oportunidadeId: item.oportunidade?.id })}>Registrar atividade</button>}
      </PageHead>
      <KpiStrip itens={[
        { label: 'Prioridade', value: `${Math.round(e.priorityScore)} ${e.priorityClass}`, hint: item.motivo },
        { label: 'Fit', value: Math.round(e.fitScore) }, { label: 'Timing', value: Math.round(e.timingScore) }, { label: 'Intenção', value: Math.round(e.intentScore) }, { label: 'Relacionamento', value: Math.round(e.relationshipScore) }, { label: 'Qualidade dos dados', value: Math.round(e.dataQualityScore) },
        { label: 'Último sinal', value: d(e.ultimoSinalEm) }, { label: 'Último contato', value: d(e.ultimoContatoEm) }, { label: 'Próxima ação', value: d(e.proximaAcaoEm), tone: item.vencida ? 'neg' : undefined },
      ]} />
      <div style={{ height: 16 }} />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'overview', label: 'Overview' }, { id: 'contatos', label: `Contatos (${contatos.length})` }, { id: 'projetos', label: `Projetos (${projetos.length})` }, { id: 'sinais', label: `Sinais (${sinais.length})` }, { id: 'atividades', label: `Atividades (${atividades.length})` }, { id: 'oportunidades', label: `Oportunidades (${opps.length})` }, { id: 'inteligencia', label: 'Inteligência' }]} />

      {aba === 'overview' && <div style={{ marginBottom: 12 }}><Abordagem empresaId={e.id} contatoId={sugestao?.contato.id} /></div>}
      {aba === 'overview' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Ação recomendada</h2>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}><Badge tone={item.recomendacao.estado === 'CONTACT_NOW' ? 'ok' : item.recomendacao.estado === 'OVERDUE_TASK' ? 'bad' : 'info'}>{NOME_ESTADO_ACAO[item.recomendacao.estado]}</Badge><div style={{ fontSize: 16, fontWeight: 700 }}>{item.recomendacao.acao}</div></div>
            <div className="small muted">{item.recomendacao.motivo}{sugerida ? ` · estratégia sugerida: ${sugerida.nome}` : ''}</div>
            {item.recomendacao.contato && <div className="small" style={{ marginTop: 6 }}>Contato recomendado: <b>{item.recomendacao.contato.contato.nome}</b>{item.recomendacao.contato.contato.cargo ? ` · ${item.recomendacao.contato.contato.cargo}` : ''} · fit {item.recomendacao.contato.fit.score} <span className="muted">({item.recomendacao.contato.fit.razoes.join(', ')})</span></div>}
            {item.semProximaAcao && <div style={{ marginTop: 8 }}><Badge tone="warn">oportunidade ativa sem próxima ação</Badge></div>}
            {podeAgir && !tarefas.some((t) => t.status === 'Aberta') && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setTarefa(actions.novaTarefaRadar(e.id, { tipo: item.recomendacao.tipoTarefa, descricao: item.recomendacao.acao, contatoId: item.decisor?.id, oportunidadeId: item.oportunidade?.id }))}>Agendar esta ação</button>}
            <h3 style={{ marginTop: 14 }}>Próximas tarefas</h3>
            {!tarefas.some((t) => t.status === 'Aberta') ? <div className="muted small">Nenhuma tarefa aberta.</div> : tarefas.filter((t) => t.status === 'Aberta').map((t) => <div key={t.id} className="row small" style={{ gap: 8, padding: '4px 0', alignItems: 'center' }}><span className={t.venceEm.slice(0, 10) < hoje ? 'neg' : ''}>{d(t.venceEm)}</span><b>{NOME_TIPO_TAREFA[t.tipo]}</b><span>{t.descricao}</span><span className="muted">· {nomeUsuario(ds.usuarios, t.responsavelId)}</span><span className="spacer" />{podeAgir && <button className="btn sm" onClick={() => setConcluir(t)}>Concluir</button>}</div>)}
            <h3 style={{ marginTop: 14 }}>Dados da empresa</h3>
            <table className="small"><tbody>
              <tr><td className="muted">CNPJ</td><td>{formatarCnpj(e.cnpj) || '—'}</td><td className="muted">Domínio</td><td>{e.dominio ?? '—'}</td></tr>
              <tr><td className="muted">Site</td><td>{e.site ? <a href={/^https?:/.test(e.site) ? e.site : `https://${e.site}`} target="_blank" rel="noreferrer">{e.site}</a> : '—'}</td><td className="muted">LinkedIn</td><td>{e.linkedin ? <a href={e.linkedin} target="_blank" rel="noreferrer">perfil</a> : '—'}</td></tr>
              <tr><td className="muted">CNAE</td><td>{e.cnae ?? '—'}</td><td className="muted">Funcionários</td><td>{e.faixaFuncionarios ?? '—'}</td></tr>
              <tr><td className="muted">Faturamento</td><td>{e.faixaReceita ?? '—'}</td><td className="muted">Capital social</td><td>{valor(e.capitalSocial)}</td></tr>
              <tr><td className="muted">Unidades</td><td>{e.numeroUnidades ?? '—'}</td><td className="muted">Fonte</td><td>{fonte?.nome ?? '—'}{e.fonteExternaId ? ` · ${e.fonteExternaId}` : ''}</td></tr>
              <tr><td className="muted">Cadastro</td><td>{d(e.criadoEm)}</td><td className="muted">Atualização</td><td>{d(e.atualizadoEm)}</td></tr>
            </tbody></table>
            {e.observacoes && <p className="small" style={{ marginTop: 8 }}>{e.observacoes}</p>}
          </div>
          <div className="card">
            <h2>Score e explicação <button className="btn sm" onClick={() => setScore(true)}>detalhar</button></h2>
            {x.dimensoes.map((dm) => <ProgressRow key={dm.dimensao} label={`${dm.dimensao} × ${Math.round(dm.peso * 100)}%`} valor={dm.score / 100} texto={`${dm.score}${dm.fatores.length ? ` · ${dm.fatores.slice(0, 2).map((f) => f.regra).join(', ')}` : ''}`} />)}
            <h3 style={{ marginTop: 14 }}>Decisores</h3>
            {!contatos.length ? <div className="muted small">Nenhum contato. Pesquise o decisor de engenharia, expansão ou compras.</div> : contatos.slice(0, 4).map((c) => <div key={c.id} className="small" style={{ padding: '3px 0' }}><b>{c.nome}</b>{c.cargo ? ` · ${c.cargo}` : ''} {c.decisor && <Badge tone="ok">decisor</Badge>} {contatoSuprimido(c, r) && <Badge tone="bad">não contatar</Badge>}<div className="muted">{[c.email, c.whatsapp ?? c.celular ?? c.telefone].filter(Boolean).join(' · ') || 'sem e-mail nem telefone'}</div></div>)}
            <h3 style={{ marginTop: 14 }}>Últimos sinais</h3>
            {!sinais.length ? <div className="muted small">Nenhum sinal.</div> : sinais.slice(0, 4).map((s) => <div key={s.id} className="small" style={{ padding: '3px 0' }}><span className="muted">{d(s.eventoEm)}</span> <b>{NOME_SINAL[s.tipo]}</b> · {s.titulo}{!s.verificado && <Badge tone="muted">não verificado</Badge>}</div>)}
            <h3 style={{ marginTop: 14 }}>Última atividade</h3>
            {!atividades.length ? <div className="muted small">Nenhuma interação registrada.</div> : <div className="small"><span className="muted">{dh(atividades[0].ocorreuEm)}</span> <b>{NOME_TIPO_ATIVIDADE[atividades[0].tipo]}</b> por {NOME_CANAL[atividades[0].canal]}{atividades[0].resultado ? ` · ${RESPOSTA_NOME(atividades[0].resultado, r.tiposResposta)}` : ''}{atividades[0].notas ? <div className="muted">{atividades[0].notas}</div> : null}</div>}
          </div>
        </div>
      )}

      {aba === 'contatos' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><span className="spacer" />{podeAgir && <button className="btn primary sm" onClick={() => setContato(actions.novoContatoRadar(e.id))}>+ Contato</button>}</div>
          {sugestao && (
            <div className="card" style={{ padding: 12, marginBottom: 10, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="score-pill A">{sugestao.fit.score}<span className="cls">FIT</span></span>
                <div style={{ flex: 1 }}><b>{sugestao.contato.nome}</b>{sugestao.contato.cargo ? ` · ${sugestao.contato.cargo}` : ''} <span className="muted small">· {sugestao.contato.isPrimario ? 'contato principal' : 'sugerido como contato principal'} ({sugestao.motivo})</span>
                  <div className="small muted">Razões: {sugestao.fit.razoes.join(' · ')}</div></div>
                {podeAgir && !sugestao.contato.isPrimario && <button className="btn sm primary" onClick={() => tentar(() => actions.definirContatoPrincipalRadar(sugestao.contato.id), toast, () => toast(`${sugestao.contato.nome} definido como contato principal.`))}>Definir como principal</button>}
              </div>
            </div>
          )}
          {!contatos.length ? <Empty icone="equipe" titulo="Sem contatos">Cadastre o decisor ou importe a base de contatos.</Empty> : (
            <table><thead><tr><th>Nome</th><th>Cargo</th><th>Persona</th><th>Senioridade</th><th className="num">Decision fit</th><th>E-mail</th><th>Telefone</th><th className="num">Qualidade</th><th>Verificado</th><th>Principal</th><th /></tr></thead>
              <tbody>{contatos.map((c) => { const eleg = contatoElegivel(c, r.supressoes); return (
                <tr key={c.id} style={{ opacity: eleg ? 1 : 0.55 }}>
                  <td><b>{c.nome}</b>{contatoSuprimido(c, r) && <> <Badge tone="bad">não contatar</Badge></>}{c.situacao === 'SAIU_DA_EMPRESA' && <> <Badge tone="muted">saiu</Badge></>}{c.situacao === 'INVALIDO' && <> <Badge tone="bad">inválido</Badge></>}</td>
                  <td className="small">{c.cargo ?? '—'}{c.departamento ? <div className="muted">{c.departamento}</div> : null}</td>
                  <td className="small">{c.persona ? NOME_PERSONA[c.persona] : '—'}{c.personaManual && <span className="muted"> (fixa)</span>}</td>
                  <td className="small">{c.senioridade ?? '—'}</td>
                  <td className="num"><b>{c.decisionFitScore ?? 0}</b>{c.decisor && <div><Badge tone="ok">decisor</Badge></div>}</td>
                  <td className="small">{c.email ?? '—'}{c.email && <div><Badge tone={c.statusEmail === 'valido' ? 'ok' : c.statusEmail === 'invalido' || c.statusEmail === 'devolvido' ? 'bad' : 'muted'}>{c.statusEmail ?? 'não verificado'}</Badge></div>}</td>
                  <td className="small">{[c.telefone, c.celular, c.whatsapp && `WA ${c.whatsapp}`].filter(Boolean).join(' · ') || '—'}{(c.telefone || c.celular || c.whatsapp) && <div><Badge tone={c.statusTelefone === 'valido' ? 'ok' : c.statusTelefone === 'invalido' ? 'bad' : 'muted'}>{c.statusTelefone ?? 'não verificado'}</Badge></div>}</td>
                  <td className="num">{c.qualidade}</td><td className="small">{d(c.verificadoEm)}</td>
                  <td>{c.isPrimario ? <Badge tone="info">principal</Badge> : podeAgir && eleg ? <button className="btn sm" onClick={() => tentar(() => actions.definirContatoPrincipalRadar(c.id), toast, () => toast('Contato principal definido.'))}>Definir</button> : '—'}</td>
                  <td className="actions">{podeAgir && <><button className="btn sm" onClick={() => setContato(c)}>Editar</button>{eleg && <button className="btn sm" onClick={() => setAtividade({ contatoId: c.id, oportunidadeId: item.oportunidade?.id })}>Registrar</button>}{!contatoSuprimido(c, r) && <button className="btn sm" onClick={() => { const m = window.prompt(`Motivo para marcar ${c.nome} como não contatar:`); if (m) tentar(() => actions.adicionarSupressaoRadar({ contatoId: c.id, tipo: 'do_not_contact', motivo: m }), toast, () => toast('Contato marcado como não contatar.')); }}>Não contatar</button>}</>}</td>
                </tr>
              ); })}</tbody></table>
          )}
        </div>
      )}

      {aba === 'projetos' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><span className="spacer" />{podeAgir && <button className="btn primary sm" onClick={() => setProjeto(actions.novoProjetoRadar(e.id))}>+ Projeto</button>}</div>
          {!projetos.length ? <Empty icone="obras" titulo="Sem projetos">Registre o empreendimento conhecido: galpão, fábrica, CD, com área e início previsto.</Empty> : (
            <table><thead><tr><th>Projeto</th><th>Tipo</th><th>Local</th><th className="num">Área m²</th><th className="num">Valor</th><th>Estágio</th><th>Início</th><th>Fonte</th><th /></tr></thead>
              <tbody>{projetos.map((p) => <tr key={p.id}><td><b>{p.nome}</b></td><td className="small">{p.tipo ?? '—'}</td><td className="small">{[p.cidade, p.uf].filter(Boolean).join('/') || '—'}</td><td className="num">{p.areaM2?.toLocaleString('pt-BR') ?? '—'}</td><td className="num">{valor(p.valorEstimado)}</td><td className="small">{p.estagio ?? '—'}</td><td className="small">{d(p.inicioPrevisto)}</td><td className="small muted">{r.fontes.find((f) => f.id === p.fonteId)?.nome ?? '—'}</td><td>{podeAgir && <button className="btn sm" onClick={() => setProjeto(p)}>Editar</button>}</td></tr>)}</tbody></table>
          )}
        </div>
      )}

      {aba === 'sinais' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><span className="spacer" />{podeAgir && <button className="btn primary sm" onClick={() => setSinal(true)}>+ Sinal</button>}</div>
          {!sinais.length ? <Empty icone="radar" titulo="Sem sinais">Sinais são fatos de mercado com data: obra registrada, expansão anunciada, licitação, contratação de engenharia.</Empty> : (
            <table><thead><tr><th>Quando</th><th>Tipo</th><th>Título</th><th>Fonte</th><th className="num">Confiança</th><th className="num">Score</th><th>Verificado</th><th>Detectado</th></tr></thead>
              <tbody>{sinais.map((s) => <tr key={s.id}><td>{d(s.eventoEm)}</td><td><Badge tone="info">{NOME_SINAL[s.tipo]}</Badge></td><td><b>{s.titulo}</b>{s.descricao && <div className="small muted">{s.descricao}</div>}{s.url && <div className="small"><a href={s.url} target="_blank" rel="noreferrer">origem</a></div>}</td><td className="small">{r.fontes.find((f) => f.id === s.fonteId)?.nome ?? s.fonteTipo}</td><td className="num">{Math.round(s.confianca * 100)}%</td><td className="num">{s.scoreEfetivo}</td><td>{s.verificado ? <Badge tone="ok">sim</Badge> : podeAgir ? <button className="btn sm" onClick={() => tentar(() => actions.verificarSinalRadar(s.id), toast, () => toast('Sinal verificado.'))}>Verificar</button> : <Badge tone="muted">não</Badge>}</td><td className="small muted">{dh(s.detectadoEm)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}

      {aba === 'atividades' && (
        <div className="grid cols-2">
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Interações</h2><span className="spacer" />{podeAgir && <button className="btn primary sm" onClick={() => setAtividade({ contatoId: item.decisor?.id, oportunidadeId: item.oportunidade?.id })}>Registrar</button>}</div>
            {!atividades.length ? <Empty icone="chat">Nenhuma interação ainda.</Empty> : (
              <ul className="timeline">{atividades.map((a) => <li key={a.id}><span className="quando">{dh(a.ocorreuEm)}</span><span><b>{NOME_TIPO_ATIVIDADE[a.tipo]}</b> por {NOME_CANAL[a.canal]}{a.contatoId ? ` com ${r.contatos.find((c) => c.id === a.contatoId)?.nome ?? ''}` : ''}{a.resultado && <> · <Badge tone={r.tiposResposta.find((t) => t.codigo === a.resultado)?.sentimento === 'positivo' ? 'ok' : r.tiposResposta.find((t) => t.codigo === a.resultado)?.sentimento === 'negativo' ? 'bad' : 'muted'}>{RESPOSTA_NOME(a.resultado, r.tiposResposta)}</Badge></>}{a.estrategiaId && <span className="muted small"> · {r.estrategias.find((s) => s.id === a.estrategiaId)?.nome}</span>}{a.notas && <div className="small muted">{a.notas}</div>}<div className="small muted">{nomeUsuario(ds.usuarios, a.usuarioId)}</div></span></li>)}</ul>
            )}
          </div>
          <div className="card table-wrap">
            <div className="row" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Tarefas</h2><span className="spacer" />{podeAgir && <button className="btn sm" onClick={() => setTarefa(actions.novaTarefaRadar(e.id))}>+ Tarefa</button>}</div>
            {!tarefas.length ? <Empty icone="hoje">Sem tarefas.</Empty> : (
              <table><thead><tr><th>Prazo</th><th>Tarefa</th><th>Responsável</th><th>Status</th><th /></tr></thead>
                <tbody>{tarefas.map((t) => <tr key={t.id} style={{ opacity: t.status === 'Aberta' ? 1 : 0.6 }}><td className={t.status === 'Aberta' && t.venceEm.slice(0, 10) < hoje ? 'neg' : ''}>{d(t.venceEm)}</td><td><b>{NOME_TIPO_TAREFA[t.tipo]}</b> · {t.descricao}{t.prioridade === 'Alta' && <> <Badge tone="warn">alta</Badge></>}</td><td className="small">{nomeUsuario(ds.usuarios, t.responsavelId)}</td><td><Badge tone={t.status === 'Aberta' ? 'info' : t.status === 'Concluída' ? 'ok' : 'muted'}>{t.status}</Badge></td><td className="actions">{podeAgir && t.status === 'Aberta' && <><button className="btn sm primary" onClick={() => setConcluir(t)}>Concluir</button><button className="btn sm" onClick={() => setTarefa(t)}>Editar</button><button className="btn sm" onClick={() => { const m = window.prompt('Motivo do cancelamento:'); if (m) tentar(() => actions.cancelarTarefaRadar(t.id, m), toast); }}>Cancelar</button></>}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}

      {aba === 'oportunidades' && (
        <div className="card table-wrap">
          <div className="row" style={{ marginBottom: 8 }}><span className="spacer" />{podeAgir && <button className="btn primary sm" onClick={() => setOpp(actions.novaOportunidadeRadar(e.id))}>+ Oportunidade</button>}</div>
          {!opps.length ? <Empty icone="orcamento" titulo="Sem oportunidades">Abra a oportunidade quando houver um projeto ou necessidade a perseguir. Ela sempre precisa de uma próxima ação.</Empty> : (
            <table><thead><tr><th>Oportunidade</th><th>Estágio</th><th className="num">Valor</th><th className="num">Prob.</th><th>Responsável</th><th>Próxima ação</th><th>Histórico</th><th /></tr></thead>
              <tbody>{opps.map((o) => { const h = r.historicoEstagios.filter((k) => k.oportunidadeId === o.id).sort((a, b) => (a.em < b.em ? 1 : -1)); return (
                <tr key={o.id}><td><b>{o.titulo}</b>{o.projetoId && <div className="small muted">{r.projetos.find((p) => p.id === o.projetoId)?.nome}</div>}{o.motivoFechamento && <div className="small muted">{o.motivoFechamento}</div>}</td><td><Badge tone={TONE_ESTAGIO(o.estagio)}>{NOME_ESTAGIO[o.estagio]}</Badge></td><td className="num">{valor(o.valorEstimado)}</td><td className="num">{Math.round(o.probabilidade * 100)}%</td><td className="small">{nomeUsuario(ds.usuarios, o.responsavelId)}</td><td className="small">{estagioAtivo(o.estagio) ? (o.proximaAcaoEm ? <><span className={o.proximaAcaoEm.slice(0, 10) < hoje ? 'neg' : ''}>{d(o.proximaAcaoEm)}</span> · {o.proximaAcao}</> : r.tarefas.some((t) => t.oportunidadeId === o.id && t.status === 'Aberta') ? 'via tarefa' : <Badge tone="warn">sem próxima ação</Badge>) : '—'}</td><td className="small muted">{h.slice(0, 3).map((k) => `${d(k.em)} ${NOME_ESTAGIO[k.para]}`).join(' ← ')}</td><td>{podeAgir && <button className="btn sm" onClick={() => setOpp(o)}>Editar / mudar estágio</button>}</td></tr>
              ); })}</tbody></table>
          )}
        </div>
      )}

      {aba === 'inteligencia' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Por que este score</h2>
            {x.dimensoes.map((dm) => (
              <div key={dm.dimensao} style={{ marginBottom: 10 }}>
                <div className="dim-bar"><b style={{ width: 130 }}>{dm.dimensao}</b><div className="barra"><i style={{ width: `${dm.score}%` }} /></div><span className="num" style={{ width: 90 }}>{dm.score} × {Math.round(dm.peso * 100)}%</span></div>
                {dm.fatores.map((f) => <div key={f.regraId} className="fator"><span>{f.regra}<div className="muted">{f.motivo}</div></span><span className={`pts ${f.pontos < 0 ? 'neg' : ''}`}>{f.pontos > 0 ? '+' : ''}{f.pontos}</span></div>)}
              </div>
            ))}
            <div className="small muted">Total {x.total} → classe {x.classe}. Fatores com decaimento perdem valor com o tempo: sem sinal novo, o timing cai sozinho.</div>
          </div>
          <div className="card">
            <h2>Leitura comercial</h2>
            <p><b>Ação recomendada:</b> {item.recomendacao.acao} <span className="muted small">({item.recomendacao.motivo})</span></p>
            <p><b>Estratégia sugerida:</b> {sugerida?.nome ?? '—'}{sugerida?.descricao ? <span className="muted small"> · {sugerida.descricao}</span> : null}{estrategia && <span className="small"> · em uso: {estrategia.nome}</span>}</p>
            {sugerida?.mensagemModelo && <p className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{sugerida.mensagemModelo.replace('{nome}', item.decisor?.nome.split(' ')[0] ?? '').replace('{empresa}', e.nomeFantasia ?? e.razaoSocial)}</p>}
            <h3 style={{ marginTop: 12 }}>Histórico do score</h3>
            {!snapshots.length ? <div className="muted small">Ainda sem snapshots.</div> : <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{snapshots.slice(0, 10).map((s) => <Badge key={s.id} tone={toneClasse(s.classe)}>{d(s.em)} · {s.total} {s.classe}</Badge>)}</div>}
            <h3 style={{ marginTop: 12 }}>Linhagem dos dados</h3>
            <div className="small">Origem do cadastro: {fonte?.nome ?? 'manual'}{e.fonteExternaId ? ` (id ${e.fonteExternaId})` : ''}. {r.registrosFonte.filter((g) => g.entidadeId === e.id).length} registro(s) bruto(s) guardado(s); {sinais.filter((s) => s.payload).length} sinal(is) com payload original.</div>
            <h3 style={{ marginTop: 12 }}>Pipeline</h3>
            {!opps.length ? <div className="muted small">Sem oportunidades.</div> : opps.map((o) => <div key={o.id} className="small" style={{ padding: '3px 0' }}><Badge tone={TONE_ESTAGIO(o.estagio)}>{NOME_ESTAGIO[o.estagio]}</Badge> {o.titulo} · {money(o.valorEstimado ?? 0, true)} · {Math.round(o.probabilidade * 100)}%</div>)}
          </div>
        </div>
      )}

      {score && <ScoreModal e={e} onClose={() => setScore(false)} />}
      {editEmpresa && <EmpresaForm inicial={editEmpresa} onClose={() => setEditEmpresa(null)} onErro={toast} onOk={toast} />}
      {contato && <ContatoForm inicial={contato} onClose={() => setContato(null)} onErro={toast} onOk={toast} />}
      {projeto && <ProjetoForm inicial={projeto} onClose={() => setProjeto(null)} onErro={toast} onOk={toast} />}
      {sinal && <SinalForm empresaId={e.id} onClose={() => setSinal(false)} onErro={toast} onOk={toast} />}
      {atividade && <AtividadeForm empresaId={e.id} contatoId={atividade.contatoId} oportunidadeId={atividade.oportunidadeId} onClose={() => setAtividade(null)} onErro={toast} onOk={toast} />}
      {tarefa && <TarefaForm inicial={tarefa} onClose={() => setTarefa(null)} onErro={toast} onOk={toast} />}
      {concluir && <ConcluirTarefaForm tarefa={concluir} onClose={() => setConcluir(null)} onErro={toast} onOk={toast} />}
      {opp && <OportunidadeForm inicial={opp} onClose={() => setOpp(null)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}
