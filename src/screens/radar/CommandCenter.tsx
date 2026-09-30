import React, { useState } from 'react';
import { economiaInteligencia } from '../../core/radar/economia';
import { DIMENSOES, FAIXAS_FUNCIONARIOS, NOME_ESTAGIO, NOME_PERSONA, NOME_SINAL, PERSONAS, TIPOS_SINAL, calcularDecisionFit, configDe, descobertasSuprimidas, filaDeRevisao, oportunidadesSemProximaAcao, ESTAGIOS, estagioAtivo, NOME_CATEGORIA_CM, TEXTO_RAZAO_CM, type CondicaoRegra, type Dimensao, type Estrategia, type ImportacaoLinha, type Persona, type RegraPersona, type RegraScore } from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { Badge, Empty, Input, KpiHero, KpiStrip, Link, NumberInput, PageHead, Select, Tabs, money, tentar, useToast } from '../../ui/components';
import { ImportarForm, d, dh, nomeUsuario } from './comum';
import { snapshotComercialCD } from '../../core/radar/commercialDirector';
import type { MedidaComercial } from '../../core/radar/commercialMetrics';
import { VibePainel } from './Vibe';
import { CoberturaDecisores } from './Cobertura';
import LeadEngineCandidatos from './LeadEngineCandidatos';
import { FILTRO_VAZIO, contadoresRevisao, filtrarRevisao, metricasPiloto, type FiltroRevisao } from '../../core/radar/leadEngineRevisao';
import { SignalPilot } from './SignalPilot';

type Aba = 'visao' | 'alertas' | 'regras' | 'decisores' | 'estrategias' | 'importacoes' | 'candidatos' | 'revisao' | 'duplicatas' | 'supressoes' | 'vibe' | 'signal';

export default function RadarCommandCenter({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const hoje = ds.params.dataBase;
  const r = ds.radar;
  // D-6: os indicadores da visão geral vêm do snapshot canônico do CD-1 e a lista operacional, da Commercial Queue
  // (o snapshot só corta a fila, na ordem dela). A tela não calcula métrica: mostra a medida ou "—" com o motivo.
  const cd = snapshotComercialCD(r, hoje, { limiteReferencias: 5 });
  const mostrar = (m: MedidaComercial) => (m.estado === 'DISPONIVEL' ? m.valor : '—');
  const porque = (m: MedidaComercial) => (m.estado === 'DISPONIVEL' ? undefined : m.motivoInsuficiencia);
  const eco = economiaInteligencia(r);
  const razao = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const [aba, setAba] = useState<Aba>((aba0 as Aba) || 'visao');
  const [importar, setImportar] = useState(false);
  const podeAgir = pode(usuario, 'radar');
  const podeConfig = pode(usuario, 'radar_config');
  const semAcao = oportunidadesSemProximaAcao(r);
  const vencidas = r.tarefas.filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) < hoje).sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1));
  const cfg = configDe(r.configScore);
  // LE-2E: projecoes do Lead Engine. A fila de revisao da importacao CSV (aba "Fila de revisão") e OUTRA coisa.
  const candidatosLE = filaDeRevisao(r);
  // LE-2E: a escolha de empresa por candidato vive AQUI para LeadEngineCandidatos/LinhaCandidato ficarem puros
  const [selecaoLE, setSelecaoLE] = useState<Record<string, string>>({});
  // LE3-D.1: filtro de REVISAO e cartoes abertos tambem vivem aqui; a fila filtrada/contada vem do core
  const [filtroLE, setFiltroLE] = useState<FiltroRevisao>(FILTRO_VAZIO);
  const [abertosLE, setAbertosLE] = useState<Record<string, boolean>>({});
  const visiveisLE = filtrarRevisao(candidatosLE, filtroLE, hoje);
  const contadoresLE = contadoresRevisao(candidatosLE, hoje);
  const metricasLE = metricasPiloto(r, hoje);
  const suprimidosLE = descobertasSuprimidas(r);
  const empresaNome = (id: string) => { const e = r.empresas.find((x) => x.id === id); return e ? e.nomeFantasia ?? e.razaoSocial : id; };
  const salvarRegra = (g: RegraScore) => tentar(() => actions.salvarRegraScoreRadar(g), toast);
  const descreveCondicao = (c: CondicaoRegra) => c.tipo === 'sinal' ? `sinal ${NOME_SINAL[c.tipoSinal]}` : c.tipo === 'fitCalibrado' ? `FIT calibrado · ${c.componente}` : c.tipo === 'campo' ? `${String(c.campo)} ${c.op} ${Array.isArray(c.valor) ? c.valor.slice(0, 4).join(', ') + (c.valor.length > 4 ? '…' : '') : String(c.valor ?? '')}` : c.tipo === 'contato' ? `contato${c.decisor ? ' decisor' : ''}${c.comEmail ? ' com e-mail' : ''}${c.comTelefone ? ' e telefone' : ''}${c.verificado ? ' verificado' : ''}` : c.tipo === 'resposta' ? `resposta ${c.codigos.join('/')}` : c.tipo === 'atividade' ? `atividade ${c.tipos.join('/')}` : c.tipo === 'projeto' ? `projeto${c.inicioEmMeses ? ` em ${c.inicioEmMeses} meses` : ''}` : c.tipo === 'sinalQualquer' ? `qualquer sinal${c.diasMax ? ` em ${c.diasMax} dias` : ''}` : `completude de ${c.campos.length} campos`;
  return (
    <>
      <PageHead title="Radar · Command Center" subtitle="Inteligência comercial da EIFF: empresas e sinais de mercado viram oportunidades priorizadas por score explicável. Aqui ficam os indicadores, os alertas e a configuração de regras.">
        {podeAgir && <button className="btn" onClick={() => setImportar(true)}>Importar CSV</button>}
        {podeAgir && <button className="btn" onClick={() => tentar(() => { const x = actions.recalcularScoresRadar(); toast(`${x.empresas} empresa(s) recalculada(s), ${x.mudaram} mudaram.`); }, toast)}>Recalcular scores</button>}
        <Link to="/radar/hoje" className="btn primary">Abrir a fila de hoje</Link>
      </PageHead>
      <div className="hero-grid">
        <KpiHero label="Oportunidades ativas em contas ativas" value={mostrar(cd.funil.ativas)}
          sufixo={cd.funil.valorEstimadoAtivas.estado === 'DISPONIVEL' ? `valor estimado ${money(cd.funil.valorEstimadoAtivas.valor ?? 0, true)}` : 'sem valor estimado'}
          hint={`Valor estimado: soma das oportunidades ativas que têm valor (${mostrar(cd.funil.ativasSemValor)} sem valor).${porque(cd.funil.valorEstimadoAtivas) ? ` Indisponível: ${porque(cd.funil.valorEstimadoAtivas)}.` : ''}`}
          secundarios={[{ label: 'Sem próxima ação (contas ativas)', value: mostrar(cd.funil.semProximaAcao) }, { label: 'Paradas na fila', value: mostrar(cd.funil.paradasNaFila) }, { label: 'Paradas críticas', value: mostrar(cd.funil.paradasCriticasNaFila) }, { label: 'Sem valor', value: mostrar(cd.funil.ativasSemValor) }]}>
          {ESTAGIOS.filter((s) => estagioAtivo(s) && cd.funil.porEstagio[s].valor).map((s) => <div key={s} className="row small" style={{ gap: 8, padding: '3px 0' }}><span>{NOME_ESTAGIO[s]}</span><b>{mostrar(cd.funil.porEstagio[s])}</b></div>)}
          {!cd.funil.ativas.valor && <div className="muted small">Nenhuma oportunidade ativa. Abra a primeira na página da empresa.</div>}
        </KpiHero>
        <KpiHero label="Fila comercial" value={mostrar(cd.commercialQueue.total)} sufixo={`${mostrar(cd.commercialQueue.porCategoria.AGIR_AGORA)} para agir agora`}
          hint="Contas na Commercial Queue, na ordem da fila (a mesma da Hoje)." to="/radar/hoje"
          secundarios={[{ label: NOME_CATEGORIA_CM.AVANCAR_OPORTUNIDADE, value: mostrar(cd.commercialQueue.porCategoria.AVANCAR_OPORTUNIDADE) }, { label: NOME_CATEGORIA_CM.FOLLOW_UP, value: mostrar(cd.commercialQueue.porCategoria.FOLLOW_UP) }, { label: NOME_CATEGORIA_CM.REVISAR, value: mostrar(cd.commercialQueue.porCategoria.REVISAR) }, { label: NOME_CATEGORIA_CM.PROSPECTAR, value: mostrar(cd.commercialQueue.porCategoria.PROSPECTAR) }]}>
          {cd.commercialQueue.referencias.map((x) => <div key={x.empresaId} className="row small" style={{ gap: 8, padding: '3px 0' }}><span className="muted">{x.posicao}.</span><b>{empresaNome(x.empresaId)}</b><span className="muted">· {NOME_CATEGORIA_CM[x.categoria]} · {TEXTO_RAZAO_CM[x.porQueAgora]}</span></div>)}
          {!cd.commercialQueue.referencias.length && <div className="muted small">Nenhuma conta na fila comercial.</div>}
        </KpiHero>
      </div>
      <KpiStrip itens={[
        { label: 'A+ leads', value: mostrar(cd.base.porClasseRadar['A+']), to: '/radar/empresas?classe=A%2B' }, { label: 'A leads', value: mostrar(cd.base.porClasseRadar.A), to: '/radar/empresas?classe=A' },
        { label: 'Empresas', value: mostrar(cd.base.empresasAtivas), hint: `${mostrar(cd.decisores.comContatoElegivel)} com contato elegível`, to: '/radar/empresas' },
        { label: 'Tarefas vencidas na fila comercial', value: mostrar(cd.atividade.tarefasVencidasNaFila), tone: cd.atividade.tarefasVencidasNaFila.valor ? 'neg' : undefined },
        { label: 'Toques comerciais (7 d)', value: mostrar(cd.atividade.toquesRecentes['7d']), hint: `${mostrar(cd.atividade.toquesRecentes['30d'])} em 30 d · notas não contam` },
      ]} />
      <div style={{ height: 16 }} />
      <div className="card">
        <h2>Intelligence economics</h2>
        <div className="small muted">Custo real da inteligência comercial, lido do ledger de operações do Vibe (radar_vibe_operation). Sem consumo registrado, os valores ficam em 0 e as razões em "—". Contas cobertas vêm dos contatos do Radar com prospect_id.</div>
        <KpiStrip itens={[
          { label: 'Créditos consumidos', value: eco.creditsConsumed, hint: `credits_consumed · ${eco.operacoes.concluidas} operação(ões) concluída(s)${eco.creditsUncertain ? ` · ${eco.creditsUncertain} a reconciliar` : ''}`, tone: eco.creditsUncertain ? 'warn' : undefined },
          { label: 'Empresas pesquisadas', value: eco.companiesResearched, hint: 'companies_researched' },
          { label: 'Prospects descobertos', value: eco.prospectsDiscovered, hint: 'prospects_discovered' },
          { label: 'E-mails válidos', value: eco.validEmails, hint: `valid_emails (status valid) · disponíveis ${eco.emailsAvailable} · catch-all ${eco.emailsCatchAll} · inválidos ${eco.emailsInvalid}` },
          { label: 'Contas cobertas', value: eco.accountsCovered, hint: 'accounts_covered' },
          { label: 'Créditos por prospect', value: razao(eco.creditsPerProspect), hint: 'credits_per_prospect' },
          { label: 'Créditos por e-mail válido', value: razao(eco.creditsPerValidEmail), hint: 'credits_per_valid_email' },
          { label: 'Créditos por conta coberta', value: razao(eco.creditsPerCoveredAccount), hint: 'credits_per_covered_account' },
        ]} />
      </div>
      <div style={{ height: 16 }} />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'visao', label: 'Visão geral' }, { id: 'alertas', label: `Alertas (${semAcao.length + vencidas.length})` }, { id: 'regras', label: `Regras de score (${r.regrasScore.length})` }, { id: 'decisores', label: 'Personas e decision fit' }, { id: 'estrategias', label: `Estratégias (${r.estrategias.length})` }, { id: 'importacoes', label: `Importações (${r.importacoes.length})` }, { id: 'candidatos', label: `Candidatos (${candidatosLE.length})` }, { id: 'revisao', label: 'Fila de revisão' }, { id: 'duplicatas', label: `Duplicatas (${mostrar(cd.qualidade.duplicatasPendentes)})` }, { id: 'supressoes', label: `Não contatar (${r.supressoes.length})` }, ...(podeConfig ? [{ id: 'vibe' as const, label: 'Vibe Prospecting' }, { id: 'signal' as const, label: 'Signal Pilot' }] : [])]} />

      {aba === 'visao' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Fontes</h2>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{r.fontes.filter((f) => f.ativo).map((f) => <Badge key={f.id} tone={r.registrosFonte.some((x) => x.fonteId === f.id) || r.sinais.some((s) => s.fonteId === f.id) ? 'ok' : 'muted'}>{f.nome}</Badge>)}</div>
          </div>
          <div className="card">
            <h2>Oportunidades por estágio (contas ativas)</h2>
            {!cd.funil.oportunidades.valor ? <Empty>Sem oportunidades.</Empty> : (
              <table className="small"><thead><tr><th>Estágio</th><th className="num">Qtd</th></tr></thead><tbody>{ESTAGIOS.filter((s) => cd.funil.porEstagio[s].valor).map((s) => <tr key={s}><td>{NOME_ESTAGIO[s]}</td><td className="num">{mostrar(cd.funil.porEstagio[s])}</td></tr>)}</tbody></table>
            )}
            <h3 style={{ marginTop: 14 }}>Distribuição por classe</h3>
            <div className="pipeline-bar">{(['A+', 'A', 'B', 'C', 'D'] as const).map((c) => { const m = cd.base.porClasseRadar[c]; return m.valor && m.base ? <i key={c} style={{ width: `${(m.valor / m.base) * 100}%` }} title={`${c}: ${m.valor}`} /> : null; })}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{(['A+', 'A', 'B', 'C', 'D'] as const).map((c) => `${c} ${mostrar(cd.base.porClasseRadar[c])}`).join(' · ')}</div>
          </div>
        </div>
      )}

      {aba === 'alertas' && (
        <div className="grid cols-2">
          <div className="card table-wrap">
            <h2>Oportunidades ativas sem próxima ação</h2>
            {!semAcao.length ? <Empty icone="aprovacoes" titulo="Tudo com próxima ação">Regra cumprida: nenhuma oportunidade ativa está parada.</Empty> : (
              <table><thead><tr><th>Empresa</th><th>Oportunidade</th><th>Estágio</th><th>Responsável</th></tr></thead><tbody>{semAcao.map((o) => <tr key={o.id}><td><Link to={`/radar/empresas/${o.empresaId}?aba=oportunidades`}>{empresaNome(o.empresaId)}</Link></td><td>{o.titulo}</td><td><Badge tone="warn">{NOME_ESTAGIO[o.estagio]}</Badge></td><td className="small">{nomeUsuario(ds.usuarios, o.responsavelId)}</td></tr>)}</tbody></table>
            )}
          </div>
          <div className="card table-wrap">
            <h2>Follow-ups vencidos</h2>
            {!vencidas.length ? <Empty icone="hoje">Nenhuma tarefa vencida.</Empty> : (
              <table><thead><tr><th>Prazo</th><th>Empresa</th><th>Tarefa</th><th>Responsável</th></tr></thead><tbody>{vencidas.slice(0, 50).map((t) => <tr key={t.id}><td className="neg">{d(t.venceEm)}</td><td><Link to={`/radar/empresas/${t.empresaId}`}>{empresaNome(t.empresaId)}</Link></td><td>{t.descricao}</td><td className="small">{nomeUsuario(ds.usuarios, t.responsavelId)}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}

      {aba === 'regras' && (
        <>
          <div className="card">
            <h2>Pesos das dimensões e cortes de classe</h2>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {DIMENSOES.map((dm) => <label key={dm} className="small">{dm} <NumberInput value={cfg.pesos[dm]} step={0.05} disabled={!podeConfig} onChange={(v) => tentar(() => actions.salvarConfigScoreRadar(`peso.${dm}`, v), toast)} style={{ width: 80 }} /></label>)}
              <span className="muted small">| classes:</span>
              {cfg.classes.map((c) => <label key={c.classe} className="small">{c.classe} ≥ <NumberInput value={c.minimo} disabled={!podeConfig} onChange={(v) => tentar(() => actions.salvarConfigScoreRadar(`classe.${c.classe}`, v), toast)} style={{ width: 70 }} /></label>)}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>Score = Σ dimensão (0-100) × peso. Após mudar regras ou pesos, use "Recalcular scores". {!podeConfig && 'Só Administrador e Diretoria alteram.'}</div>
          </div>
          <div className="card table-wrap" style={{ marginTop: 12 }}>
            <h2>Regras</h2>
            <table>
              <thead><tr><th>Ativa</th><th>Dimensão</th><th>Regra</th><th>Condição</th><th className="num">Peso</th><th className="num">Decai em (dias)</th><th className="num">Ordem</th></tr></thead>
              <tbody>{[...r.regrasScore].sort((a, b) => DIMENSOES.indexOf(a.dimensao) - DIMENSOES.indexOf(b.dimensao) || a.prioridade - b.prioridade).map((g) => (
                <tr key={g.id} style={{ opacity: g.ativo ? 1 : 0.55 }}>
                  <td><input type="checkbox" checked={g.ativo} disabled={!podeConfig} onChange={(e) => salvarRegra({ ...g, ativo: e.target.checked })} /></td>
                  <td><Badge tone="muted">{g.dimensao}</Badge></td><td>{g.nome}</td><td className="small muted">{descreveCondicao(g.condicao)}</td>
                  <td className="num"><NumberInput value={g.peso} disabled={!podeConfig} onChange={(v) => salvarRegra({ ...g, peso: v })} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td className="num"><NumberInput value={g.decaimentoDias ?? 0} disabled={!podeConfig} onChange={(v) => salvarRegra({ ...g, decaimento: v > 0, decaimentoDias: v > 0 ? v : undefined })} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td className="num">{g.prioridade}</td>
                </tr>
              ))}</tbody>
            </table>
            {podeConfig && <NovaRegra onErro={toast} onOk={toast} />}
          </div>
        </>
      )}

      {aba === 'estrategias' && (
        <div className="card table-wrap">
          <h2>Estratégias de abordagem</h2>
          <div className="small muted" style={{ marginBottom: 8 }}>Cada atividade pode registrar a estratégia usada; o modelo de mensagem é editável aqui, nunca fixo no sistema.</div>
          <table><thead><tr><th>Código</th><th>Nome</th><th>Descrição</th><th>Modelo de mensagem</th><th>Ativa</th><th className="num">Usos</th></tr></thead>
            <tbody>{[...r.estrategias].sort((a, b) => a.ordem - b.ordem).map((e) => <LinhaEstrategia key={e.id} e={e} usos={r.atividades.filter((a) => a.estrategiaId === e.id).length} podeConfig={podeConfig} onErro={toast} />)}</tbody></table>
        </div>
      )}

      {aba === 'importacoes' && (
        <div className="card table-wrap">
          {!r.importacoes.length ? <Empty icone="empresas" titulo="Nenhuma importação">Importe a base de empresas (CSV) e depois a de contatos.</Empty> : (
            <table><thead><tr><th>Quando</th><th>Tipo</th><th>Arquivo</th><th>Fonte</th><th>Status</th><th className="num">Linhas</th><th className="num">Novas</th><th className="num">Atualizadas</th><th className="num">Duplicatas</th><th className="num">Erros</th><th>Por</th></tr></thead>
              <tbody>{[...r.importacoes].reverse().map((j) => <tr key={j.id}><td>{dh(j.criadoEm)}</td><td>{j.tipo}</td><td className="small">{j.arquivo}</td><td className="small">{r.fontes.find((f) => f.id === j.fonteId)?.nome ?? '—'}</td><td><Badge tone={j.status === 'Concluída' ? 'ok' : j.status === 'Falhou' ? 'bad' : 'warn'}>{j.status}</Badge></td><td className="num">{j.total}</td><td className="num">{j.importados}</td><td className="num">{j.atualizados}</td><td className="num">{j.duplicados}</td><td className={`num ${j.erros ? 'neg' : ''}`}>{j.erros}</td><td className="small">{nomeUsuario(ds.usuarios, j.criadoPor)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}

      {aba === 'decisores' && <><CoberturaDecisores /><ConfigDecisores podeConfig={podeConfig} onErro={toast} onOk={toast} /></>}
      {aba === 'vibe' && podeConfig && <VibePainel onErro={toast} onOk={toast} />}
      {aba === 'signal' && <SignalPilot />}

      {aba === 'candidatos' && <LeadEngineCandidatos candidatos={candidatosLE} visiveis={visiveisLE} suprimidos={suprimidosLE} empresas={r.empresas} podeAgir={podeAgir} hoje={hoje} filtro={filtroLE} contadores={contadoresLE} metricas={metricasLE} selecao={selecaoLE} abertos={abertosLE} onAbrir={(id) => setAbertosLE((a) => ({ ...a, [id]: !a[id] }))} onFiltro={setFiltroLE} onSelecionar={(id, empresaId) => setSelecaoLE((s) => ({ ...s, [id]: empresaId }))} onErro={toast} onOk={toast} />}

      {aba === 'revisao' && (
        <div className="card table-wrap">
          <div className="small muted" style={{ marginBottom: 8 }}>Contatos importados cuja empresa ficou ambígua ou não foi encontrada. Nenhuma empresa é criada automaticamente: escolha a empresa certa, crie uma nova a partir da linha ou ignore.</div>
          {!r.importacaoLinhas.some((l) => l.status === 'revisao') ? <Empty icone="aprovacoes" titulo="Fila vazia">Todas as linhas importadas foram associadas.</Empty> : (
            <table><thead><tr><th>Linha</th><th>Contato</th><th>Empresa na planilha</th><th>Motivo</th><th>Candidatas</th><th /></tr></thead>
              <tbody>{r.importacaoLinhas.filter((l) => l.status === 'revisao').map((l) => <LinhaRevisao key={l.id} l={l} podeAgir={podeAgir} onErro={toast} onOk={toast} />)}</tbody></table>
          )}
        </div>
      )}

      {aba === 'duplicatas' && (
        <div className="card table-wrap">
          {!r.duplicatas.some((x) => x.status === 'pendente') ? <Empty icone="aprovacoes" titulo="Sem duplicatas pendentes">A deduplicação por CNPJ, domínio e nome não achou casos para revisar.</Empty> : (
            <table><thead><tr><th>Nova empresa</th><th>Parecida com</th><th>Motivo</th><th className="num">Confiança</th><th>Quando</th><th /></tr></thead>
              <tbody>{r.duplicatas.filter((x) => x.status === 'pendente').map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/radar/empresas/${x.empresaId}`}>{empresaNome(x.empresaId)}</Link></td><td><Link to={`/radar/empresas/${x.candidataId}`}>{empresaNome(x.candidataId)}</Link></td><td className="small">{x.motivo}</td><td className="num">{Math.round(x.confianca * 100)}%</td><td className="small">{d(x.criadoEm)}</td>
                  <td className="actions">{podeAgir && <><button className="btn sm primary" onClick={() => tentar(() => actions.resolverDuplicataRadar(x.id, 'mesclar'), toast, () => toast('Mescladas: a nova foi absorvida pela existente.'))}>Mesclar na existente</button><button className="btn sm" onClick={() => tentar(() => actions.resolverDuplicataRadar(x.id, 'descartar'), toast, () => toast('Mantidas como empresas diferentes.'))}>São diferentes</button></>}</td>
                </tr>
              ))}</tbody></table>
          )}
        </div>
      )}

      {aba === 'supressoes' && (
        <div className="card table-wrap">
          {!r.supressoes.length ? <Empty icone="auditoria" titulo="Ninguém marcado">Contatos com não contatar, opt-out, e-mail devolvido ou telefone inválido aparecem aqui e saem das filas.</Empty> : (
            <table><thead><tr><th>Contato / empresa</th><th>Tipo</th><th>Motivo</th><th>Por</th><th>Quando</th><th /></tr></thead>
              <tbody>{r.supressoes.map((s) => <tr key={s.id}><td>{s.contatoId ? r.contatos.find((c) => c.id === s.contatoId)?.nome ?? s.contatoId : ''}{s.empresaId && <div className="small muted"><Link to={`/radar/empresas/${s.empresaId}`}>{empresaNome(s.empresaId)}</Link></div>}</td><td><Badge tone={s.tipo === 'do_not_contact' || s.tipo === 'opt_out' ? 'bad' : 'warn'}>{s.tipo}</Badge></td><td className="small">{s.motivo}</td><td className="small">{nomeUsuario(ds.usuarios, s.criadoPor)}</td><td className="small">{d(s.criadoEm)}</td><td>{podeAgir && <button className="btn sm" onClick={() => { const m = window.prompt('Motivo para liberar o contato:'); if (m) tentar(() => actions.removerSupressaoRadar(s.id, m), toast, () => toast('Supressão removida.')); }}>Liberar</button>}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
      {importar && <ImportarForm onClose={() => setImportar(false)} onErro={toast} onOk={toast} />}
      {el}
    </>
  );
}

function LinhaRevisao({ l, podeAgir, onErro, onOk }: { l: ImportacaoLinha; podeAgir: boolean; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [empresaId, setEmpresaId] = useState(l.candidatos?.[0]?.empresaId ?? '');
  const g = (...ks: string[]) => { for (const k of Object.keys(l.dados)) if (ks.some((x) => k.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(x))) return l.dados[k]; return ''; };
  const nome = (id: string) => { const e = ds.radar.empresas.find((x) => x.id === id); return e ? `${e.nomeFantasia ?? e.razaoSocial}${e.cidade || e.uf ? ` (${[e.cidade, e.uf].filter(Boolean).join('/')})` : ''}` : id; };
  const opcoes = [...(l.candidatos ?? []).map((c) => ({ value: c.empresaId, label: `${nome(c.empresaId)} · ${c.motivo}` })), ...ds.radar.empresas.filter((e) => e.ativo && !e.mescladaEm && !(l.candidatos ?? []).some((c) => c.empresaId === e.id)).sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial)).map((e) => ({ value: e.id, label: nome(e.id) }))];
  return (
    <tr>
      <td className="num">{l.numero}</td>
      <td><b>{g('nome', 'name', 'contato')}</b><div className="small muted">{g('cargo', 'title')}{g('email') ? ` · ${g('email')}` : ''}</div></td>
      <td className="small">{g('empresa', 'company', 'razao') || '—'}{g('dominio', 'domain', 'site') ? <div className="muted">{g('dominio', 'domain', 'site')}</div> : null}</td>
      <td className="small muted">{l.mensagem}</td>
      <td style={{ minWidth: 260 }}>{podeAgir ? <Select value={empresaId} onChange={setEmpresaId} options={opcoes} allowEmpty="— escolha a empresa —" /> : (l.candidatos ?? []).map((c) => nome(c.empresaId)).join('; ')}</td>
      <td className="actions">{podeAgir && <>
        <button className="btn sm primary" disabled={!empresaId} onClick={() => tentar(() => { actions.resolverLinhaRevisaoRadar(l.id, { empresaId }); onOk('Contato associado.'); }, onErro)}>Associar</button>
        <button className="btn sm" onClick={() => tentar(() => { actions.resolverLinhaRevisaoRadar(l.id, { criar: true }); onOk('Empresa criada e contato associado.'); }, onErro)}>Criar empresa</button>
        <button className="btn sm" onClick={() => { const m = window.prompt('Motivo para ignorar a linha:'); if (m) tentar(() => { actions.resolverLinhaRevisaoRadar(l.id, { ignorar: true, motivo: m }); onOk('Linha ignorada.'); }, onErro); }}>Ignorar</button>
      </>}</td>
    </tr>
  );
}

function ConfigDecisores({ podeConfig, onErro, onOk }: { podeConfig: boolean; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const r = ds.radar;
  const peso = (chave: string) => r.pesosDecisionFit.find((p) => p.chave === chave)?.valor ?? 0;
  const salvarPeso = (chave: string, v: number) => tentar(() => actions.salvarPesoDecisionFitRadar(chave, v), onErro);
  const [teste, setTeste] = useState({ cargo: 'Diretor Industrial', departamento: 'Industrial', porte: '1001-5000', projeto: 'Fábrica' });
  const previa = calcularDecisionFit({ cargo: teste.cargo, departamento: teste.departamento }, { faixaFuncionarios: teste.porte }, r.pesosDecisionFit, r.regrasPersona, teste.projeto);
  const [novaRegra, setNovaRegra] = useState<{ persona: Persona; campo: RegraPersona['campo']; termos: string }>({ persona: 'OTHER', campo: 'ambos', termos: '' });
  const projetos = ['expansao', 'fabrica', 'galpao', 'cd', 'escritorio', 'retrofit'];
  return (
    <>
      <div className="card">
        <h2>Simular decision fit</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="small">Cargo <Input value={teste.cargo} onChange={(e) => setTeste({ ...teste, cargo: e.target.value })} /></label>
          <label className="small">Departamento <Input value={teste.departamento} onChange={(e) => setTeste({ ...teste, departamento: e.target.value })} /></label>
          <label className="small">Porte <Select value={teste.porte} onChange={(v) => setTeste({ ...teste, porte: v })} options={FAIXAS_FUNCIONARIOS} /></label>
          <label className="small">Projeto <Input value={teste.projeto} onChange={(e) => setTeste({ ...teste, projeto: e.target.value })} /></label>
          <span className="score-pill A">{previa.score}<span className="cls">FIT</span></span>
          <span className="small">{NOME_PERSONA[previa.persona]} · {previa.senioridade} · {previa.razoes.join(' · ')}</span>
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card table-wrap">
          <div className="row"><h2 style={{ margin: 0 }}>Persona × porte (pontos base)</h2><span className="spacer" />{podeConfig && <button className="btn sm" onClick={() => tentar(() => { actions.restaurarPadroesRadar('pesosDecisionFit'); onOk('Pesos restaurados.'); }, onErro)}>Restaurar padrão</button>}</div>
          <table className="small"><thead><tr><th>Persona</th><th className="num">Pequena</th><th className="num">Média</th><th className="num">Grande</th></tr></thead>
            <tbody>{PERSONAS.map((p) => <tr key={p}><td>{NOME_PERSONA[p]}</td>{(['pequena', 'media', 'grande'] as const).map((porte) => <td key={porte} className="num"><NumberInput value={peso(`persona.${p}.${porte}`)} disabled={!podeConfig} onChange={(v) => salvarPeso(`persona.${p}.${porte}`, v)} style={{ width: 64, textAlign: 'right' }} /></td>)}</tr>)}</tbody></table>
          <div className="small muted" style={{ marginTop: 6 }}>Porte pela faixa de funcionários: pequena ≤ {peso('porte.pequena.max')}, média ≤ {peso('porte.media.max')}, grande acima. Fit adequado a partir de {r.pesosDecisionFit.find((p) => p.chave === 'fit.adequado')?.valor ?? 40}.</div>
        </div>
        <div className="card">
          <h2>Bônus</h2>
          <h3>Senioridade</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{(['C-level', 'Diretor', 'Gerente', 'Coordenador', 'Analista'] as const).map((s) => <label key={s} className="small">{s} <NumberInput value={peso(`senioridade.${s}`)} disabled={!podeConfig} onChange={(v) => salvarPeso(`senioridade.${s}`, v)} style={{ width: 60 }} /></label>)}</div>
          <h3 style={{ marginTop: 10 }}>Departamento (termo contido)</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{r.pesosDecisionFit.filter((p) => p.chave.startsWith('departamento.')).map((p) => <label key={p.chave} className="small">{p.chave.slice(13)} <NumberInput value={p.valor} disabled={!podeConfig} onChange={(v) => salvarPeso(p.chave, v)} style={{ width: 60 }} /></label>)}</div>
          <h3 style={{ marginTop: 10 }}>Tipo de projeto × persona</h3>
          <table className="small"><thead><tr><th>Projeto</th><th>Persona</th><th className="num">Bônus</th></tr></thead>
            <tbody>{projetos.flatMap((tp) => r.pesosDecisionFit.filter((p) => p.chave.startsWith(`projeto.${tp}.`)).map((p) => <tr key={p.chave}><td>{tp}</td><td>{NOME_PERSONA[p.chave.split('.')[2] as Persona] ?? p.chave.split('.')[2]}</td><td className="num"><NumberInput value={p.valor} disabled={!podeConfig} onChange={(v) => salvarPeso(p.chave, v)} style={{ width: 60, textAlign: 'right' }} /></td></tr>))}</tbody></table>
          {podeConfig && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => tentar(() => { const n = actions.recalcularContatosRadar(); onOk(`${n} contato(s) recalculado(s).`); }, onErro)}>Recalcular contatos</button>}
        </div>
      </div>
      <div className="card table-wrap" style={{ marginTop: 12 }}>
        <div className="row"><h2 style={{ margin: 0 }}>Mapeamento cargo/departamento → persona</h2><span className="spacer" />{podeConfig && <button className="btn sm" onClick={() => tentar(() => { actions.restaurarPadroesRadar('regrasPersona'); onOk('Regras restauradas.'); }, onErro)}>Restaurar padrão</button>}</div>
        <table className="small"><thead><tr><th>Ativa</th><th className="num">Ordem</th><th>Persona</th><th>Campo</th><th>Termos (palavra inteira)</th><th>Excluir se contiver</th></tr></thead>
          <tbody>{[...r.regrasPersona].sort((a, b) => a.prioridade - b.prioridade).map((g) => <LinhaRegraPersona key={g.id} g={g} podeConfig={podeConfig} onErro={onErro} />)}</tbody></table>
        {podeConfig && (
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <b className="small">Nova regra:</b>
            <Select value={novaRegra.persona} onChange={(v) => setNovaRegra({ ...novaRegra, persona: v as Persona })} options={PERSONAS.map((p) => ({ value: p, label: NOME_PERSONA[p] }))} />
            <Select value={novaRegra.campo} onChange={(v) => setNovaRegra({ ...novaRegra, campo: v as RegraPersona['campo'] })} options={[{ value: 'cargo', label: 'no cargo' }, { value: 'departamento', label: 'no departamento' }, { value: 'ambos', label: 'em qualquer um' }]} />
            <Input placeholder="termos separados por vírgula" value={novaRegra.termos} onChange={(e) => setNovaRegra({ ...novaRegra, termos: e.target.value })} style={{ width: 300 }} />
            <button className="btn sm primary" disabled={!novaRegra.termos.trim()} onClick={() => tentar(() => { actions.salvarRegraPersonaRadar({ id: `RP-${Date.now().toString(36)}`, persona: novaRegra.persona, campo: novaRegra.campo, termos: novaRegra.termos.split(',').map((t) => t.trim()).filter(Boolean), prioridade: 0, ativo: true }); onOk('Regra criada (ordem 0 = avaliada primeiro).'); setNovaRegra({ ...novaRegra, termos: '' }); }, onErro)}>Adicionar</button>
          </div>
        )}
      </div>
    </>
  );
}

function LinhaRegraPersona({ g, podeConfig, onErro }: { g: RegraPersona; podeConfig: boolean; onErro: (m: string) => void }) {
  const [x, setX] = useState({ termos: g.termos.join(', '), excluir: (g.excluir ?? []).join(', ') });
  const salvar = (p: Partial<RegraPersona>) => tentar(() => actions.salvarRegraPersonaRadar({ ...g, ...p }), onErro);
  return (
    <tr style={{ opacity: g.ativo ? 1 : 0.55 }}>
      <td><input type="checkbox" checked={g.ativo} disabled={!podeConfig} onChange={(e) => salvar({ ativo: e.target.checked })} /></td>
      <td className="num"><NumberInput value={g.prioridade} disabled={!podeConfig} onChange={(v) => salvar({ prioridade: v })} style={{ width: 56, textAlign: 'right' }} /></td>
      <td>{NOME_PERSONA[g.persona]}</td><td>{g.campo}</td>
      <td><Input value={x.termos} disabled={!podeConfig} onChange={(e) => setX({ ...x, termos: e.target.value })} onBlur={() => salvar({ termos: x.termos.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
      <td><Input value={x.excluir} disabled={!podeConfig} onChange={(e) => setX({ ...x, excluir: e.target.value })} onBlur={() => salvar({ excluir: x.excluir.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
    </tr>
  );
}

function LinhaEstrategia({ e, usos, podeConfig, onErro }: { e: Estrategia; usos: number; podeConfig: boolean; onErro: (m: string) => void }) {
  const [x, setX] = useState(e);
  const salvar = (p: Partial<Estrategia>) => { const n = { ...x, ...p }; setX(n); tentar(() => actions.salvarEstrategiaRadar(n), onErro); };
  return (
    <tr><td className="small"><b>{e.codigo}</b></td><td><Input value={x.nome} disabled={!podeConfig} onChange={(ev) => setX({ ...x, nome: ev.target.value })} onBlur={() => salvar({})} /></td><td><Input value={x.descricao} disabled={!podeConfig} onChange={(ev) => setX({ ...x, descricao: ev.target.value })} onBlur={() => salvar({})} /></td><td><Input value={x.mensagemModelo} disabled={!podeConfig} placeholder="Olá {nome}, vi que a {empresa}…" onChange={(ev) => setX({ ...x, mensagemModelo: ev.target.value })} onBlur={() => salvar({})} /></td><td><input type="checkbox" checked={x.ativo} disabled={!podeConfig} onChange={(ev) => salvar({ ativo: ev.target.checked })} /></td><td className="num">{usos}</td></tr>
  );
}

function NovaRegra({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [g, setG] = useState<{ nome: string; dimensao: Dimensao; tipo: 'sinal' | 'campo'; tipoSinal: string; campo: string; op: 'in' | 'eq' | 'gte' | 'existe' | 'contem'; valor: string; peso: number; dias: number }>({ nome: '', dimensao: 'TIMING', tipo: 'sinal', tipoSinal: 'NEWS', campo: 'setor', op: 'in', valor: '', peso: 10, dias: 0 });
  const up = (p: Partial<typeof g>) => setG({ ...g, ...p });
  const criar = () => tentar(() => {
    const condicao: CondicaoRegra = g.tipo === 'sinal' ? { tipo: 'sinal', tipoSinal: g.tipoSinal as CondicaoRegra extends { tipoSinal: infer T } ? T : never } : { tipo: 'campo', campo: g.campo as 'setor', op: g.op, valor: g.op === 'in' ? g.valor.split(',').map((x) => x.trim()).filter(Boolean) : g.op === 'gte' ? Number(g.valor) : g.valor };
    const id = `RS-${String(ds.radar.regrasScore.length + 1).padStart(3, '0')}-${Date.now().toString(36)}`;
    actions.salvarRegraScoreRadar({ id, nome: g.nome, dimensao: g.dimensao, tipoSinal: g.tipo === 'sinal' ? (g.tipoSinal as 'NEWS') : undefined, condicao, peso: g.peso, decaimento: g.dias > 0, decaimentoDias: g.dias > 0 ? g.dias : undefined, ativo: true, prioridade: ds.radar.regrasScore.length + 1 });
    onOk('Regra criada. Recalcule os scores.'); up({ nome: '' });
  }, onErro);
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
      <b className="small">Nova regra:</b>
      <Input placeholder="Nome" value={g.nome} onChange={(e) => up({ nome: e.target.value })} style={{ width: 200 }} />
      <Select value={g.dimensao} onChange={(v) => up({ dimensao: v as Dimensao })} options={[...DIMENSOES]} />
      <Select value={g.tipo} onChange={(v) => up({ tipo: v as 'sinal' })} options={[{ value: 'sinal', label: 'quando houver sinal' }, { value: 'campo', label: 'quando o campo' }]} />
      {g.tipo === 'sinal' ? <Select value={g.tipoSinal} onChange={(v) => up({ tipoSinal: v })} options={TIPOS_SINAL.map((t) => ({ value: t, label: NOME_SINAL[t] }))} /> : <><Select value={g.campo} onChange={(v) => up({ campo: v })} options={['setor', 'uf', 'cidade', 'cnae', 'faixaFuncionarios', 'faixaReceita', 'capitalSocial', 'numeroUnidades', 'dominio']} /><Select value={g.op} onChange={(v) => up({ op: v as 'in' })} options={[{ value: 'in', label: 'está em (a, b, c)' }, { value: 'eq', label: 'é igual a' }, { value: 'contem', label: 'contém' }, { value: 'gte', label: '≥' }, { value: 'existe', label: 'está preenchido' }]} />{g.op !== 'existe' && <Input placeholder="valor" value={g.valor} onChange={(e) => up({ valor: e.target.value })} style={{ width: 160 }} />}</>}
      <label className="small">peso <NumberInput value={g.peso} onChange={(v) => up({ peso: v })} style={{ width: 70 }} /></label>
      <label className="small">decai em <NumberInput value={g.dias} onChange={(v) => up({ dias: v })} style={{ width: 70 }} /> dias</label>
      <button className="btn sm primary" disabled={!g.nome.trim()} onClick={criar}>Adicionar</button>
    </div>
  );
}
