import React, { useState } from 'react';
import { DIMENSOES, NOME_ESTAGIO, NOME_SINAL, TIPOS_SINAL, configDe, filaHoje, oportunidadesSemProximaAcao, resumoRadar, type CondicaoRegra, type Dimensao, type Estrategia, type RegraScore } from '../../core/radar';
import { actions, pode, useStore } from '../../data/store';
import { Badge, Empty, Input, KpiHero, KpiStrip, Link, NumberInput, PageHead, ProgressRow, Select, Tabs, money, tentar, useToast } from '../../ui/components';
import { ImportarForm, ScorePill, d, dh, nomeUsuario } from './comum';

type Aba = 'visao' | 'alertas' | 'regras' | 'estrategias' | 'importacoes' | 'duplicatas' | 'supressoes';

export default function RadarCommandCenter({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const hoje = ds.params.dataBase;
  const r = ds.radar;
  const res = resumoRadar(r, hoje);
  const [aba, setAba] = useState<Aba>((aba0 as Aba) || 'visao');
  const [importar, setImportar] = useState(false);
  const podeAgir = pode(usuario, 'radar');
  const podeConfig = pode(usuario, 'radar_config');
  const fila = filaHoje(r, hoje).slice(0, 5);
  const semAcao = oportunidadesSemProximaAcao(r);
  const vencidas = r.tarefas.filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) < hoje).sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1));
  const cfg = configDe(r.configScore);
  const empresaNome = (id: string) => { const e = r.empresas.find((x) => x.id === id); return e ? e.nomeFantasia ?? e.razaoSocial : id; };
  const salvarRegra = (g: RegraScore) => tentar(() => actions.salvarRegraScoreRadar(g), toast);
  const descreveCondicao = (c: CondicaoRegra) => c.tipo === 'sinal' ? `sinal ${NOME_SINAL[c.tipoSinal]}` : c.tipo === 'campo' ? `${String(c.campo)} ${c.op} ${Array.isArray(c.valor) ? c.valor.slice(0, 4).join(', ') + (c.valor.length > 4 ? '…' : '') : String(c.valor ?? '')}` : c.tipo === 'contato' ? `contato${c.decisor ? ' decisor' : ''}${c.comEmail ? ' com e-mail' : ''}${c.comTelefone ? ' e telefone' : ''}${c.verificado ? ' verificado' : ''}` : c.tipo === 'resposta' ? `resposta ${c.codigos.join('/')}` : c.tipo === 'atividade' ? `atividade ${c.tipos.join('/')}` : c.tipo === 'projeto' ? `projeto${c.inicioEmMeses ? ` em ${c.inicioEmMeses} meses` : ''}` : `completude de ${c.campos.length} campos`;
  return (
    <>
      <PageHead title="Radar · Command Center" subtitle="Inteligência comercial da EIFF: empresas e sinais de mercado viram oportunidades priorizadas por score explicável. Aqui ficam os indicadores, os alertas e a configuração de regras.">
        {podeAgir && <button className="btn" onClick={() => setImportar(true)}>Importar CSV</button>}
        {podeAgir && <button className="btn" onClick={() => tentar(() => { const x = actions.recalcularScoresRadar(); toast(`${x.empresas} empresa(s) recalculada(s), ${x.mudaram} mudaram.`); }, toast)}>Recalcular scores</button>}
        <Link to="/radar/hoje" className="btn primary">Abrir a fila de hoje</Link>
      </PageHead>
      <div className="hero-grid">
        <KpiHero label="Pipeline ponderado" value={money(res.pipelinePonderado, true)} sufixo={`de ${money(res.pipeline, true)}`} hint={`${res.oportunidadesAtivas} oportunidade(s) ativa(s) · ${res.propostas30d} proposta(s) e ${res.projetosRecebidos30d} projeto(s) recebido(s) em 30 dias · ${res.ganhas90d} ganha(s) e ${res.perdidas90d} perdida(s) em 90 dias`}
          secundarios={[{ label: 'Propostas 30 d', value: res.propostas30d }, { label: 'Projetos recebidos', value: res.projetosRecebidos30d }, { label: 'Reuniões 30 d', value: res.reunioes30d }, { label: 'Ganhas 90 d', value: res.ganhas90d }]}>
          {res.porEstagio.filter((x) => x.estagio !== 'WON' && x.estagio !== 'LOST').map((x) => <ProgressRow key={x.estagio} label={x.nome} valor={res.pipeline ? x.valor / res.pipeline : 0} texto={`${x.quantidade} · ${money(x.valor, true)}`} />)}
          {!res.porEstagio.length && <div className="muted small">Nenhuma oportunidade ainda. Abra a primeira na página da empresa.</div>}
        </KpiHero>
        <KpiHero label="Leads prioritários" value={res.aMais + res.a} sufixo={`${res.aMais} A+ · ${res.a} A`} tone={res.followUpsVencidos || res.oportunidadesSemAcao ? 'warn' : undefined} hint={`${res.followUpsVencidos} follow-up(s) vencido(s) · ${res.oportunidadesSemAcao} oportunidade(s) sem próxima ação · ${res.novosSinais7d} sinal(is) novo(s) em 7 dias`} to="/radar/hoje"
          secundarios={[{ label: 'Classe B', value: res.b }, { label: 'Vencidos', value: res.followUpsVencidos }, { label: 'Sem ação', value: res.oportunidadesSemAcao }, { label: 'Sinais 7 d', value: res.novosSinais7d }]}>
          {fila.map((i) => <div key={i.empresa.id} className="row small" style={{ gap: 8, padding: '3px 0' }}><ScorePill e={i.empresa} compacto /><b>{i.empresa.nomeFantasia ?? i.empresa.razaoSocial}</b><span className="muted">· {i.recomendacao.acao}</span></div>)}
        </KpiHero>
      </div>
      <KpiStrip itens={[
        { label: 'A+ leads', value: res.aMais, to: '/radar/empresas?classe=A%2B' }, { label: 'A leads', value: res.a, to: '/radar/empresas?classe=A' }, { label: 'Novos sinais (7 d)', value: res.novosSinais7d, hint: `${res.sinais30d} em 30 d` },
        { label: 'Follow-ups vencidos', value: res.followUpsVencidos, tone: res.followUpsVencidos ? 'neg' : undefined }, { label: 'Sem próxima ação', value: res.oportunidadesSemAcao, tone: res.oportunidadesSemAcao ? 'warn' : undefined },
        { label: 'Atividades (7 d)', value: res.atividades7d, hint: `${res.atividades30d} em 30 d` }, { label: 'Respostas (30 d)', value: res.respostas30d, hint: `${res.respostasPositivas30d} positivas` }, { label: 'Reuniões (30 d)', value: res.reunioes30d },
        { label: 'Projetos recebidos', value: res.projetosRecebidos30d }, { label: 'Propostas (30 d)', value: res.propostas30d }, { label: 'Pipeline', value: money(res.pipeline, true), hint: `ponderado ${money(res.pipelinePonderado, true)}` },
      ]} />
      <div style={{ height: 16 }} />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'visao', label: 'Visão geral' }, { id: 'alertas', label: `Alertas (${semAcao.length + vencidas.length})` }, { id: 'regras', label: `Regras de score (${r.regrasScore.length})` }, { id: 'estrategias', label: `Estratégias (${r.estrategias.length})` }, { id: 'importacoes', label: `Importações (${r.importacoes.length})` }, { id: 'duplicatas', label: `Duplicatas (${res.duplicatasPendentes})` }, { id: 'supressoes', label: `Não contatar (${r.supressoes.length})` }]} />

      {aba === 'visao' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Sinais nos últimos 30 dias</h2>
            {!res.topSinais.length ? <Empty>Sem sinais. Registre sinais nas empresas ou conecte as fontes (CNO, PNCP, notícias).</Empty> : res.topSinais.map((s) => <ProgressRow key={s.tipo} label={s.nome} valor={res.sinais30d ? s.quantidade / res.sinais30d : 0} texto={String(s.quantidade)} />)}
            <h3 style={{ marginTop: 14 }}>Fontes</h3>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{r.fontes.filter((f) => f.ativo).map((f) => <Badge key={f.id} tone={r.registrosFonte.some((x) => x.fonteId === f.id) || r.sinais.some((s) => s.fonteId === f.id) ? 'ok' : 'muted'}>{f.nome}</Badge>)}</div>
          </div>
          <div className="card">
            <h2>Funil</h2>
            {!res.porEstagio.length ? <Empty>Sem oportunidades.</Empty> : (
              <table className="small"><thead><tr><th>Estágio</th><th className="num">Qtd</th><th className="num">Valor</th></tr></thead><tbody>{res.porEstagio.map((x) => <tr key={x.estagio}><td>{x.nome}</td><td className="num">{x.quantidade}</td><td className="num">{money(x.valor, true)}</td></tr>)}</tbody></table>
            )}
            <h3 style={{ marginTop: 14 }}>Distribuição por classe</h3>
            <div className="pipeline-bar">{(['A+', 'A', 'B', 'C', 'D'] as const).map((c) => { const n = { 'A+': res.aMais, A: res.a, B: res.b, C: res.c, D: res.d }[c]; const tot = res.aMais + res.a + res.b + res.c + res.d; return n ? <i key={c} style={{ width: `${(n / tot) * 100}%` }} title={`${c}: ${n}`} /> : null; })}</div>
            <div className="small muted" style={{ marginTop: 4 }}>A+ {res.aMais} · A {res.a} · B {res.b} · C {res.c} · D {res.d}</div>
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
