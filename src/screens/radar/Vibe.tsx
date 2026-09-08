import React, { useEffect, useMemo, useState } from 'react';
import { CUSTO_VIBE, MAX_CANDIDATOS_POR_CONTA, NOME_PERSONA, PRIORIDADE_DECISORES, buscarDecisor, classificarPool, precisaEnriquecerEmail, recomendarAcao, type ProspectVibe, type ResultadoBuscaDecisor } from '../../core/radar';
import { actions, useStore } from '../../data/store';
import { tokenSessao } from '../../data/supabase';
import { Badge, Empty, KpiStrip, NumberInput } from '../../ui/components';

// Fluxo obrigatorio para qualquer acao paga: simular (sem creditos) -> reservar (RPC no banco decide) -> executar (com operationId
// + idempotencyKey) -> concluir. O navegador nao envia budget/reserve/confirmar como fonte de verdade: a politica esta no banco.
type Resp = Record<string, unknown>;
type Tipo = 'match' | 'discovery_pool' | 'discovery' | 'enrich_email';
interface Plano { tipo: Tipo; params: Record<string, unknown>; key: string; rotulo: string; custoProvavel: number; custoMaximo: number; registros: number }
interface Operacao { id: string; status: string; key: string; plano: Plano }
class ErroApi extends Error { constructor(msg: string, public codigo: string, public dados: Resp, public http: number) { super(msg); } }

async function chamar(acao: string, corpo: Record<string, unknown>): Promise<Resp> {
  const token = await tokenSessao();
  const r = await fetch('/api/vibe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ acao, ...corpo }) });
  const d = (await r.json().catch(() => ({}))) as Resp;
  if (!r.ok) throw new ErroApi(String(d.mensagem ?? d.erro ?? `HTTP ${r.status}`), String(d.erro ?? ''), d, r.status);
  return d;
}
const novaChave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const hoje = () => new Date().toISOString().slice(0, 10);
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
const fmt = (v: unknown) => (n(v) == null ? '—' : String(n(v)));

export function VibePainel({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, modo, usuario } = useStore();
  const r = ds.radar;
  const [ocupado, setOcupado] = useState('');
  const [teste, setTeste] = useState<Resp | null>(null);
  const [orc, setOrc] = useState<{ disponiveis: number | null; politica: Resp } | null>(null);
  const [catalogo, setCatalogo] = useState<Resp | null>(null);
  const [cobertura, setCobertura] = useState<{ nome: string; total: number; validado: boolean }[] | null>(null);
  const [amostra, setAmostra] = useState<ProspectVibe[] | null>(null);
  const [max, setMax] = useState(56);
  const [cap, setCap] = useState(20);
  const [somenteComEmail, setSomenteComEmail] = useState(true);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [simulacao, setSimulacao] = useState<Resp | null>(null);
  const [op, setOp] = useState<Operacao | null>(null);
  const [candidatos, setCandidatos] = useState<ProspectVibe[]>([]);
  const [decisores, setDecisores] = useState<(ProspectVibe & { fit: number; razoes: string[] })[] | null>(null);
  const [semCandidato, setSemCandidato] = useState<string[]>([]);
  const [forcar, setForcar] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [log, setLog] = useState<string[]>([]);
  // busca de decisor por conta (preview, sem creditos): alvo padrao = empresas cujo CRM pede SEARCH_DECISION_MAKER
  const [alvoBusca, setAlvoBusca] = useState<string[] | null>(null);
  const [busca, setBusca] = useState<ResultadoBuscaDecisor[] | null>(null);

  const pol = orc?.politica ?? {};
  const politicaOk = !!orc && pol.policy !== null;
  const cacheDias = n(pol.email_cache_days) ?? 90;
  const capPolitica = n(pol.max_paid_records_per_operation) ?? 20;
  const empresas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const comId = empresas.filter((e) => e.businessId);
  const semId = empresas.filter((e) => !e.businessId && (e.razaoSocial || e.dominio));
  const ids = comId.map((e) => e.businessId!.toLowerCase());
  const empresasPorBid = useMemo(() => new Map(comId.map((e) => [e.businessId!.toLowerCase(), e])), [comId]);
  const jaImportados = new Set(r.contatos.map((c) => (c.fonteExternaId ?? '').toLowerCase()).filter((x) => /^[a-f0-9]{40}$/.test(x)));
  const contatosVibe = r.contatos.filter((c) => c.fonteExternaId && /^[a-f0-9]{40}$/i.test(c.fonteExternaId) && c.situacao !== 'SAIU_DA_EMPRESA');
  const paraEnriquecer = contatosVibe.filter((c) => forcar || precisaEnriquecerEmail(c, hoje(), cacheDias).precisa);
  const emCache = contatosVibe.length - contatosVibe.filter((c) => precisaEnriquecerEmail(c, hoje(), cacheDias).precisa).length;
  const coberturaPool = cobertura?.find((c) => c.nome === 'DISCOVERY_POOL')?.total ?? null;
  const podeForcar = usuario.papel === 'Administrador';
  const registrar = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} ${m}`, ...l].slice(0, 60));
  const rodar = async (nome: string, fn: () => Promise<void>) => { setOcupado(nome); try { await fn(); } catch (e) { onErro((e as Error).message); registrar(`erro: ${(e as Error).message}`); } finally { setOcupado(''); } };
  const atualizarOrcamento = async () => { const o = await chamar('orcamento', {}); setOrc({ disponiveis: n(o.disponiveis), politica: (o.politica as Resp) ?? {} }); return o; };
  useEffect(() => { if (modo === 'remoto') void atualizarOrcamento().catch((e: Error) => registrar(`orçamento: ${e.message}`)); }, [modo]);
  useEffect(() => { if (politicaOk) setCap((c) => Math.min(c, capPolitica)); }, [politicaOk, capPolitica]);

  // ---------------------------------------------------------------- acoes gratuitas
  const testar = () => rodar('teste', async () => { const t = await chamar('teste', {}); setTeste(t); registrar(`conexão ok · ${String(t.creditosDepois)} créditos · consumo do teste ${Number(t.creditosAntes) - Number(t.creditosDepois)}`); await atualizarOrcamento(); onOk('Conexão validada sem chamadas pagas.'); });
  const validarCatalogo = () => rodar('catalogo', async () => { const c = await chamar('catalogo', {}); setCatalogo(c); const cat = c.catalogo as { job_level: string[]; job_department: string[] }; registrar(`catálogo: ${cat.job_level.length} job_level e ${cat.job_department.length} job_department confirmados · créditos ${String(c.creditosAntes)} → ${String(c.creditosDepois)}`); await atualizarOrcamento(); setCobertura(null); onOk('Catálogo de filtros validado pelo autocomplete (sem créditos).'); });
  const cobrir = () => rodar('cobertura', async () => {
    const c = await chamar('cobertura', { businessIds: ids, somenteComEmail });
    setCobertura(c.cobertura as { nome: string; total: number; validado: boolean }[]);
    if (c.catalogoValidado) { const a = await chamar('amostra', { businessIds: ids, n: 5, somenteComEmail }); setAmostra((a.amostra as ProspectVibe[]) ?? []); registrar(`amostra em preview (DISCOVERY_POOL) · correlation_id ${String(a.correlationId ?? '—')}`); }
    else { setAmostra(null); registrar(`cobertura: catálogo não validado (${(c.rejeitados as string[]).join(', ')}) — valide antes de descobrir`); }
  });

  const sugeridasBusca = useMemo(() => comId.filter((e) => recomendarAcao(e, r, hoje()).estado === 'SEARCH_DECISION_MAKER').map((e) => e.id), [comId, r]);
  const alvo = alvoBusca ?? sugeridasBusca;
  const buscarDecisores = () => rodar('busca', async () => {
    const emps = comId.filter((e) => alvo.includes(e.id));
    if (!emps.length) throw new Error('Selecione ao menos uma empresa com business_id.');
    const out: ResultadoBuscaDecisor[] = [];
    for (const e of emps) {
      const a = await chamar('amostra', { businessIds: [e.businessId!.toLowerCase()], n: MAX_CANDIDATOS_POR_CONTA, somenteComEmail });
      const res = buscarDecisor(e, (a.amostra as ProspectVibe[]) ?? [], r, hoje());
      out.push(res);
      registrar(`busca ${e.razaoSocial}: ${res.candidatos.length} candidato(s) em preview (pool ${String(a.total ?? '?')}) · melhor ${res.melhor ? `${res.melhor.nome} fit ${res.melhor.fit}` : '—'} · ${res.recomendacao} · correlation_id ${String(a.correlationId ?? '—')}`);
    }
    setBusca(out);
    await atualizarOrcamento();
    onOk('Candidatos classificados em preview, sem créditos. Nada foi importado.');
  });

  // ---------------------------------------------------------------- reserva em duas etapas
  const planejar = (p: Omit<Plano, 'key'>) => rodar('simular', async () => {
    const key = novaChave();
    const s = await chamar('simular', { tipo: p.tipo, ...p.params, idempotencyKey: key });
    setPlano({ ...p, key }); setSimulacao(s); setOp(null);
    registrar(`simulação ${p.tipo}: ${s.authorized ? 'autorizada' : `negada (${String(s.reason)})`} · estimado ${String(s.estimado)} · limite ${fmt((s.limits as Resp | undefined)?.limit)}`);
    await atualizarOrcamento();
  });
  const reservar = () => rodar('reservar', async () => {
    if (!plano || !simulacao?.authorized) return;
    if (!window.confirm(`Reservar ${plano.rotulo}: custo provável ${plano.custoProvavel}, máximo ${plano.custoMaximo} crédito(s), ${plano.registros} registro(s) pagos. A reserva fica registrada no banco com a chave ${plano.key.slice(0, 8)}…. Continuar?`)) return;
    const s = await chamar('reservar', { tipo: plano.tipo, ...plano.params, idempotencyKey: plano.key });
    if (!s.authorized) { setSimulacao(s); throw new Error(`Reserva negada: ${String(s.reason)}`); }
    setOp({ id: String(s.operation_id), status: 'RESERVED', key: plano.key, plano });
    registrar(`reservada operação ${String(s.operation_id)} (${plano.tipo}, ${plano.custoMaximo} créditos)`);
    await atualizarOrcamento();
  });
  const cancelar = () => rodar('cancelar', async () => { if (!op) return; await chamar('cancelar', { operationId: op.id }); registrar(`operação ${op.id} cancelada`); setOp(null); setPlano(null); setSimulacao(null); await atualizarOrcamento(); });
  const consultarEstado = () => rodar('estado', async () => { if (!op) return; const e = (await chamar('estado', { operationId: op.id })).operacao as Resp; setOp({ ...op, status: String(e.status) }); registrar(`estado ${op.id}: ${String(e.status)} · devolvidos ${String(e.records_returned)} · créditos ${String(e.credits_before ?? '—')} → ${String(e.credits_after ?? '—')}`); });
  const tratarErroExecucao = (e: unknown) => {
    if (e instanceof ErroApi && e.codigo === 'reconciliacao_necessaria') { setOp((o) => (o ? { ...o, status: 'UNCERTAIN' } : o)); throw new Error('Resposta incerta após o envio: a operação ficou como UNCERTAIN. Consulte o estado e reconcilie pelo saldo antes de repetir (nova chave).'); }
    if (e instanceof ErroApi) { setOp((o) => (o ? { ...o, status: String(e.dados.status ?? 'FAILED') } : o)); }
    throw e;
  };
  const executar = () => rodar('executar', async () => {
    if (!op || !plano || (op.status !== 'RESERVED' && op.status !== 'RUNNING')) return;
    if (!window.confirm(`Executar a operação ${op.id.slice(0, 8)}… (${plano.rotulo})? A partir daqui há consumo de créditos.`)) return;
    const base = { tipo: plano.tipo, ...plano.params, operationId: op.id, idempotencyKey: op.key };
    try {
      if (plano.tipo === 'match') {
        const res = await chamar('executar', base);
        const pares = (res.resultados as { id: string; businessId: string | null }[]) ?? [];
        const casadas = actions.definirBusinessIdsRadar(pares.map((p) => ({ empresaId: p.id, businessId: p.businessId })));
        setOp({ ...op, status: 'SUCCEEDED' });
        registrar(`match: ${casadas} casadas · créditos ${String(res.creditosAntes)} → ${String(res.creditosDepois)} · correlation_id ${String(res.correlationId ?? '—')}`);
        onOk(`${casadas} empresa(s) com business_id.`);
      } else if (plano.tipo === 'enrich_email') {
        const res = await chamar('executar', base);
        const forcado = plano.params.justificativa ? { justificativa: String(plano.params.justificativa), idempotencyKey: op.key } : undefined;
        const aplicados = actions.aplicarEnriquecimentoVibe((res.resultados as { prospect_id: string; professional_email?: string | null; professional_email_status?: string | null; mobile_phone?: string | null }[]) ?? [], { forcado });
        setOp({ ...op, status: 'SUCCEEDED' });
        registrar(`e-mail: ${aplicados} aplicados · créditos ${String(res.creditosAntes)} → ${String(res.creditosDepois)} · correlation_id ${String(res.correlationId ?? '—')}`);
        onOk(`${aplicados} contato(s) com e-mail profissional.`);
      } else {
        // descoberta: uma pagina por chamada; o servidor limita cada pagina ao teto da operacao e para em cap_atingido
        let cursor: string | null = null; let pagina = 0; let todos: ProspectVibe[] = [...candidatos]; let devolvidos = 0;
        setOp({ ...op, status: 'RUNNING' });
        for (let i = 0; i < 10; i++) {
          let res: Resp;
          try { res = await chamar('executar', { ...base, cursor: cursor ?? undefined, pagina }); }
          catch (e) { if (e instanceof ErroApi && e.codigo === 'cap_atingido') { registrar('teto de registros pagos da operação atingido'); break; } throw e; }
          const dados = (res.prospects as ProspectVibe[]) ?? [];
          devolvidos += dados.length;
          const novos = dados.filter((p) => p.prospect_id && !jaImportados.has(p.prospect_id.toLowerCase()) && !todos.some((t) => t.prospect_id === p.prospect_id));
          todos = [...todos, ...novos];
          registrar(`página ${pagina + 1}: ${dados.length} devolvidos (${novos.length} novos) · créditos ${String(res.creditosAntes)} → ${String(res.creditosDepois)} · correlation_id ${String(res.correlationId ?? '—')}`);
          cursor = (res.nextCursor as string | null) ?? null; pagina = Number(res.pagina ?? pagina + 1);
          if (!dados.length || !novos.length || !cursor) break;
        }
        const fim = await chamar('concluir', { operationId: op.id });
        setOp({ ...op, status: 'SUCCEEDED' });
        setCandidatos(todos);
        const cls = classificarPool(todos, empresasPorBid, r, max);
        setDecisores(cls.escolhidos); setSemCandidato(cls.semCandidato);
        registrar(`descoberta concluída: ${devolvidos} registros pagos · ${cls.escolhidos.length} decisor(es) por decision fit · ${cls.semCandidato.length} empresa(s) sem candidato · saldo ${String(fim.disponiveis)}`);
        onOk(`${cls.escolhidos.length} decisor(es) classificados. Revise e importe.`);
      }
    } catch (e) { tratarErroExecucao(e); }
    finally { await atualizarOrcamento().catch(() => undefined); }
  });
  const importar = () => rodar('importar', async () => { if (!decisores?.length) return; const x = actions.importarProspectsVibe(decisores); registrar(`importados ${x.importados}, atualizados ${x.atualizados}, sem empresa ${x.semEmpresa}`); onOk(`${x.importados + x.atualizados} contato(s) no Radar com prospect_id.`); });

  // ---------------------------------------------------------------- planos (o servidor recalcula tudo; aqui e so a previa)
  const planoMatch = () => { const lote = semId.slice(0, 50); planejar({ tipo: 'match', params: { empresas: lote.map((e) => ({ id: e.id, nome: e.razaoSocial, dominio: e.dominio })) }, rotulo: `casar ${lote.length} empresa(s)`, custoProvavel: lote.length * CUSTO_VIBE.match, custoMaximo: lote.length * CUSTO_VIBE.match, registros: lote.length }); };
  const planoPool = () => { const c = Math.max(1, Math.min(cap, capPolitica)); planejar({ tipo: 'discovery_pool', params: { businessIds: ids, somenteComEmail, paidRecordCap: c }, rotulo: `descoberta DISCOVERY_POOL (${ids.length} empresas, teto ${c} registros)`, custoProvavel: Math.min(c, coberturaPool ?? c) * CUSTO_VIBE.buscaFull, custoMaximo: c * CUSTO_VIBE.buscaFull, registros: c }); };
  const planoFallback = () => {
    const alvo = semCandidato.length ? semCandidato : ids;
    const tier = (cobertura ?? []).findIndex((x, i) => i > 0 && x.total > 0) - 1; // indice em PRIORIDADE_DECISORES (cobertura[0] e o pool)
    if (tier < 0) throw new Error('Nenhum tier com cobertura.');
    const c = Math.max(1, Math.min(cap, capPolitica, alvo.length * 2));
    planejar({ tipo: 'discovery', params: { businessIds: alvo, somenteComEmail, paidRecordCap: c, tier }, rotulo: `fallback ${PRIORIDADE_DECISORES[tier].nome} (${alvo.length} empresas sem candidato, teto ${c})`, custoProvavel: Math.min(c, alvo.length) * CUSTO_VIBE.buscaFull, custoMaximo: c * CUSTO_VIBE.buscaFull, registros: c });
  };
  const planoEmail = () => {
    if (forcar && (!podeForcar || justificativa.trim().length < 5)) throw new Error('Forçar nova verificação: só Administrador, com justificativa.');
    const lote = paraEnriquecer.slice(0, 50);
    planejar({ tipo: 'enrich_email', params: { prospectIds: lote.map((c) => c.fonteExternaId!.toLowerCase()), ...(forcar ? { justificativa: justificativa.trim() } : {}) }, rotulo: `e-mail profissional de ${lote.length} contato(s)${forcar ? ' (forçado)' : ''}`, custoProvavel: lote.length * CUSTO_VIBE.email, custoMaximo: lote.length * CUSTO_VIBE.email, registros: lote.length });
  };
  const planejarSeguro = (fn: () => void) => { try { fn(); } catch (e) { onErro((e as Error).message); } };

  if (modo !== 'remoto') return <Empty icone="radar" titulo="Vibe só em produção">A integração roda na função protegida do Netlify com a sessão do Supabase; no modo local não há chave nem sessão.</Empty>;
  const limites = (simulacao?.limits as Resp | undefined) ?? {};
  const podeReservar = !!plano && !!simulacao?.authorized && !op;
  const podeExecutar = !!op && (op.status === 'RESERVED' || op.status === 'RUNNING');
  const bloqueado = !!op && ['RUNNING', 'RESERVED', 'UNCERTAIN'].includes(op.status);
  return (
    <>
      <div className="card">
        <h2>1 · Saldo e política de créditos (fonte de verdade: banco)</h2>
        <KpiStrip itens={[
          { label: 'Saldo da API', value: orc?.disponiveis ?? '—' },
          { label: 'Reserva mínima', value: fmt(pol.reserve_credits) },
          { label: 'Orçamento diário restante', value: fmt(pol.daily_remaining), hint: `de ${fmt(pol.daily_budget)} · usado ${fmt(pol.daily_used)}` },
          { label: 'Orçamento mensal restante', value: fmt(pol.monthly_remaining) },
          { label: 'Máx. por operação', value: fmt(pol.max_credits_per_operation) },
          { label: 'Teto de registros pagos', value: fmt(pol.max_paid_records_per_operation) },
          { label: 'Cache de e-mail (dias)', value: fmt(pol.email_cache_days) },
        ]} />
        {orc && !politicaOk && <div className="small" style={{ marginTop: 6 }}><Badge tone="warn">sem política</Badge> A tabela radar_vibe_credit_policy não tem linha para esta organização (migration 0034). Nenhuma reserva será autorizada.</div>}
        {politicaOk && !pol.enabled && <div className="small" style={{ marginTop: 6 }}><Badge tone="warn">política desabilitada</Badge></div>}
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado} onClick={() => rodar('orcamento', async () => { await atualizarOrcamento(); })}>Atualizar saldo</button>
          <button className="btn primary sm" disabled={!!ocupado} onClick={testar}>{ocupado === 'teste' ? 'Testando…' : 'Testar conexão (sem créditos)'}</button>
          <button className="btn sm" disabled={!!ocupado} onClick={validarCatalogo}>{ocupado === 'catalogo' ? 'Validando…' : 'Validar catálogo de filtros (autocomplete, sem créditos)'}</button>
          {pol.validated_at ? <span className="small muted">catálogo validado em {new Date(String(pol.validated_at)).toLocaleString('pt-BR')}</span> : <span className="small"><Badge tone="warn">catálogo não validado</Badge></span>}
          {teste && <span className="small">conexão ok · engenharia no Brasil: {String(teste.engenhariaBrasil)}</span>}
        </div>
        {catalogo && <pre className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify({ confirmados: catalogo.catalogo, divergencias: catalogo.divergencias }, null, 1)}</pre>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>2 · Empresas do Radar × Explorium</h2>
        <KpiStrip itens={[{ label: 'Empresas ativas', value: empresas.length }, { label: 'Com business_id', value: comId.length }, { label: 'Sem business_id', value: semId.length, hint: `${Math.min(50, semId.length)} por operação · 1 crédito cada` }, { label: 'Contatos Vibe já importados', value: jaImportados.size }]} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn sm" disabled={!!ocupado || !semId.length || bloqueado} onClick={() => planejarSeguro(planoMatch)}>Simular casamento de {Math.min(50, semId.length)} empresa(s)</button></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>3 · Cobertura e amostra (sem créditos)</h2>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado || !ids.length} onClick={cobrir}>{ocupado === 'cobertura' ? 'Consultando…' : 'Cobertura (pool + tiers) e amostra de 5'}</button>
          <label className="small">máximo de decisores <NumberInput value={max} onChange={setMax} style={{ width: 70 }} /></label>
          <label className="small">teto de registros pagos <NumberInput value={cap} onChange={(v) => setCap(Math.max(1, Math.min(v, capPolitica)))} style={{ width: 70 }} /> <span className="muted">(política: {capPolitica})</span></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={somenteComEmail} onChange={(e) => { setSomenteComEmail(e.target.checked); setCobertura(null); }} /> somente pessoas com e-mail disponível</label>
        </div>
        {cobertura && (
          <div className="grid cols-2" style={{ marginTop: 10 }}>
            <table className="small"><thead><tr><th>Estratégia</th><th className="num">Prospects</th><th>Filtros</th></tr></thead><tbody>{cobertura.map((c) => <tr key={c.nome}><td>{c.nome === 'DISCOVERY_POOL' ? <b>DISCOVERY_POOL (job_level + job_department)</b> : `fallback · ${c.nome}`}</td><td className="num">{c.total}</td><td>{c.validado ? <Badge tone="ok">validados</Badge> : <span className="muted">só como fallback</span>}</td></tr>)}</tbody></table>
            <div>
              <b className="small">Amostra (DISCOVERY_POOL, preview)</b>
              {!amostra?.length ? <div className="muted small">Sem registros (ou catálogo não validado).</div> : <table className="small"><thead><tr><th>Nome</th><th>Cargo</th><th>Empresa</th><th>Nível</th></tr></thead><tbody>{amostra.map((p) => <tr key={p.prospect_id}><td>{p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`}</td><td>{p.job_title}</td><td>{p.company_name}</td><td>{p.job_level_main}</td></tr>)}</tbody></table>}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>3b · Busca de decisor por conta (preview, sem créditos, sem importar)</h2>
        <div className="small muted">Até {MAX_CANDIDATOS_POR_CONTA} candidatos por conta classificados por decision fit, adequação funcional (industrial → engenharia → operações → expansão → facilities → produção → logística → COO) e qualidade de dados. Compras e CEO/Presidente só vencem pelo decision fit. Nada é enriquecido nem importado.</div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {comId.filter((e) => sugeridasBusca.includes(e.id) || alvo.includes(e.id)).map((e) => <label key={e.id} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={alvo.includes(e.id)} onChange={(ev) => setAlvoBusca(ev.target.checked ? [...alvo, e.id] : alvo.filter((x) => x !== e.id))} /> {e.nomeFantasia ?? e.razaoSocial}</label>)}
          <select className="input" value="" onChange={(ev) => { if (ev.target.value && !alvo.includes(ev.target.value)) setAlvoBusca([...alvo, ev.target.value]); }}><option value="">+ outra empresa com business_id…</option>{comId.filter((e) => !alvo.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia ?? e.razaoSocial}</option>)}</select>
          <button className="btn primary sm" disabled={!!ocupado || !alvo.length || !pol.validated_at} onClick={buscarDecisores}>{ocupado === 'busca' ? 'Buscando…' : `Candidatos em preview (${alvo.length} conta(s))`}</button>
          {!pol.validated_at && <span className="small"><Badge tone="warn">valide o catálogo antes</Badge></span>}
        </div>
        {busca?.map((b) => (
          <div key={b.empresa.id} style={{ marginTop: 12 }}>
            <div className="row small" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <b>{b.empresa.nomeFantasia ?? b.empresa.razaoSocial}</b>
              <span>contato atual: {b.atual ? `${b.atual.contato.nome} · ${NOME_PERSONA[b.atual.persona]} · decision fit ${b.atual.fit}` : 'nenhum'}</span>
              <span>melhor candidato: {b.melhor ? `${b.melhor.nome} · ${NOME_PERSONA[b.melhor.persona]} · decision fit ${b.melhor.fit}` : '—'}{b.delta !== undefined && <> · delta <b>{b.delta > 0 ? '+' : ''}{b.delta}</b></>}</span>
              <Badge tone={b.recomendacao === 'ENRICH' ? 'ok' : b.recomendacao === 'RESEARCH_MORE' ? 'warn' : 'muted'}>{b.recomendacao}</Badge>
              <span className="muted">{b.motivo}{b.custoEnriquecerMelhor ? ` · enriquecer só o melhor: ${b.custoEnriquecerMelhor} créditos (e-mail)` : ''}{b.ignorados ? ` · ${b.ignorados} ignorado(s)` : ''}</span>
            </div>
            {!b.candidatos.length ? <div className="muted small">Sem candidatos no preview.</div> : (
              <div className="table-wrap" style={{ marginTop: 6 }}>
                <table className="small"><thead><tr><th>Fit</th><th>Prospect</th><th>Cargo</th><th>Job level</th><th>Department</th><th>Persona Radar</th><th className="num">Qualidade</th><th>Razão do fit</th><th>No Radar?</th><th>Contato?</th><th>Melhor?</th><th>Recomendação</th></tr></thead>
                  <tbody>{b.candidatos.map((c) => <tr key={c.prospect_id}><td className="num"><b>{c.fit}</b></td><td>{c.nome} <span className="muted">{c.prospect_id.slice(0, 8)}…</span></td><td>{c.job_title ?? '—'}</td><td>{c.job_level_main ?? '—'}</td><td>{c.job_department_main ?? '—'}</td><td>{NOME_PERSONA[c.persona]}{c.funcaoDireta ? '' : <span className="muted"> (indireta)</span>}</td><td className="num">{c.qualidadeDados}</td><td className="muted">{c.razoes.join('; ')}</td><td>{c.jaNoRadar ? 'sim' : 'não'}</td><td>{c.contatoDisponivel ? 'sim' : 'não'}</td><td>{c.melhorQueAtual ? <Badge tone="ok">sim</Badge> : <span className="muted">{c.motivoComparacao}</span>}</td><td>{c.recomendacao}</td></tr>)}</tbody></table>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>4 · Operação (simular → reservar → executar)</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado || !cobertura || !ids.length || bloqueado} onClick={() => planejarSeguro(planoPool)}>Simular descoberta DISCOVERY_POOL (teto {Math.min(cap, capPolitica)} registros)</button>
          <button className="btn sm" disabled={!!ocupado || !cobertura || !decisores || bloqueado} onClick={() => planejarSeguro(planoFallback)}>Simular fallback por tier ({semCandidato.length} sem candidato)</button>
          <button className="btn sm" disabled={!!ocupado || !paraEnriquecer.length || bloqueado} onClick={() => planejarSeguro(planoEmail)}>Simular e-mail de {Math.min(50, paraEnriquecer.length)} contato(s) (2 cada)</button>
          {podeForcar && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> forçar nova verificação (ignora o cache de {cacheDias} dias)</label>}
          {forcar && <input className="input" placeholder="justificativa (obrigatória, auditada)" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} style={{ minWidth: 260 }} />}
        </div>
        <KpiStrip itens={[
          { label: 'Empresas-alvo', value: plano?.tipo === 'discovery' ? (plano.params.businessIds as string[]).length : ids.length },
          { label: 'Candidatos estimados', value: coberturaPool ?? '—' },
          { label: 'E-mails a enriquecer', value: paraEnriquecer.length, hint: `${emCache} em cache (${cacheDias} dias)` },
          { label: 'Custo provável', value: plano?.custoProvavel ?? '—' },
          { label: 'Custo máximo', value: plano?.custoMaximo ?? '—' },
          { label: 'Limite da política', value: fmt(limites.limit), hint: simulacao ? `min(por operação ${fmt(limites.max_per_operation)}, diário ${fmt(limites.daily_remaining)}, mensal ${fmt(limites.monthly_remaining)}, saldo − reserva ${fmt(limites.available_minus_reserve)})` : undefined },
          { label: 'operationId', value: op ? op.id.slice(0, 8) + '…' : '—', hint: op ? `${op.status} · chave ${op.key.slice(0, 8)}…` : plano ? `chave ${plano.key.slice(0, 8)}… (não reservada)` : undefined },
        ]} />
        {simulacao && plano && (
          <div className="small" style={{ marginTop: 8 }}>
            {simulacao.authorized ? <Badge tone="ok">simulação autorizada</Badge> : <Badge tone="bad">negada: {String(simulacao.reason)}</Badge>} <b>{plano.rotulo}</b> · servidor estimou {String(simulacao.estimado)} crédito(s) para {String(simulacao.registros)} registro(s) · saldo {String(simulacao.disponiveis)}
            {simulacao.reason === 'operacao_em_andamento' || simulacao.reason === 'reconciliacao_necessaria' ? <span> · operação existente {String(simulacao.operation_id)} ({String(simulacao.status)})</span> : null}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={!!ocupado || !podeReservar} onClick={reservar}>{ocupado === 'reservar' ? 'Reservando…' : '1) Confirmar e reservar'}</button>
          <button className="btn sm primary" disabled={!!ocupado || !podeExecutar} onClick={executar}>{ocupado === 'executar' ? 'Executando…' : `2) Executar operação${op ? ` ${op.id.slice(0, 8)}…` : ''}`}</button>
          <button className="btn sm" disabled={!!ocupado || !op} onClick={consultarEstado}>Consultar estado</button>
          <button className="btn sm" disabled={!!ocupado || !op || !['RESERVED', 'RUNNING'].includes(op.status)} onClick={cancelar}>Cancelar reserva</button>
          {op && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(op.status) && <button className="btn sm" disabled={!!ocupado} onClick={() => { setOp(null); setPlano(null); setSimulacao(null); }}>Nova operação</button>}
          {op?.status === 'UNCERTAIN' && <span className="small"><Badge tone="warn">UNCERTAIN</Badge> reconcilie pelo saldo (Consultar estado) antes de repetir; a repetição exige nova chave.</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>5 · Decisores classificados (decision fit) e importação</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado || !decisores?.length} onClick={importar}>Importar {decisores?.length ?? 0} no Radar (sem créditos)</button>
          {!!candidatos.length && <span className="small muted">{candidatos.length} candidato(s) pagos nesta sessão · {semCandidato.length} empresa(s) sem candidato</span>}
        </div>
        {decisores && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="small"><thead><tr><th>Fit</th><th>Nome</th><th>Cargo</th><th>Empresa</th><th>Nível</th><th>Departamento</th><th>Razões</th><th>LinkedIn</th><th>prospect_id</th></tr></thead>
              <tbody>{decisores.map((p) => <tr key={p.prospect_id}><td className="num">{p.fit}</td><td><b>{p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`}</b></td><td>{p.job_title}</td><td>{p.company_name ?? empresasPorBid.get((p.business_id ?? '').toLowerCase())?.razaoSocial}</td><td>{p.job_level_main}</td><td>{p.job_department_main}</td><td className="muted">{p.razoes.join('; ')}</td><td>{p.linkedin ? <a href={p.linkedin} target="_blank" rel="noreferrer">perfil</a> : '—'}</td><td className="muted">{p.prospect_id.slice(0, 8)}…</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
      {!!log.length && <div className="card small muted" style={{ marginTop: 12 }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </>
  );
}
