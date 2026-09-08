import React, { useState } from 'react';
import { BUDGET_PADRAO_VIBE, CUSTO_VIBE, PRIORIDADE_DECISORES, RESERVA_PADRAO_VIBE, budgetGuardVibe, escolherDecisores, estimarCreditos, tamanhoPaginaVibe, type ProspectVibe } from '../../core/radar';
import { actions, useStore } from '../../data/store';
import { tokenSessao } from '../../data/supabase';
import { Badge, Empty, KpiStrip, NumberInput } from '../../ui/components';

type Resp = Record<string, unknown>;
async function chamar(acao: string, corpo: Record<string, unknown>): Promise<Resp> {
  const token = await tokenSessao();
  const r = await fetch('/api/vibe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ acao, ...corpo }) });
  const d = (await r.json().catch(() => ({}))) as Resp;
  if (!r.ok) throw new Error(String(d.mensagem ?? d.erro ?? `HTTP ${r.status}`));
  return d;
}
const PAGINAS_MAX = 5;

export function VibePainel({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, modo } = useStore();
  const r = ds.radar;
  const [ocupado, setOcupado] = useState('');
  const [teste, setTeste] = useState<Resp | null>(null);
  const [cobertura, setCobertura] = useState<{ nome: string; total: number }[] | null>(null);
  const [amostra, setAmostra] = useState<{ tier: string; amostra: ProspectVibe[] } | null>(null);
  const [max, setMax] = useState(56);
  const [budget, setBudget] = useState(BUDGET_PADRAO_VIBE);
  const [reserve, setReserve] = useState(RESERVA_PADRAO_VIBE);
  const [somenteComEmail, setSomenteComEmail] = useState(true);
  const [decisores, setDecisores] = useState<ProspectVibe[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const empresas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const comId = empresas.filter((e) => e.businessId);
  const semId = empresas.filter((e) => !e.businessId && (e.razaoSocial || e.dominio));
  const ids = comId.map((e) => e.businessId!);
  const jaImportados = new Set(r.contatos.map((c) => (c.fonteExternaId ?? '').toLowerCase()).filter((x) => /^[a-f0-9]{40}$/.test(x)));
  const coberturaTotal = (cobertura ?? []).reduce((s, c) => s + c.total, 0);
  const est = estimarCreditos({ empresasSemId: 0, decisores: Math.min(max, comId.length || max), cobertura: cobertura ? coberturaTotal : max * 2, email: true, perfil: false, paginasMax: PAGINAS_MAX, reserva: reserve });
  const registrar = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} ${m}`, ...l].slice(0, 40));
  const rodar = async (nome: string, fn: () => Promise<void>) => { setOcupado(nome); try { await fn(); } catch (e) { onErro((e as Error).message); registrar(`erro: ${(e as Error).message}`); } finally { setOcupado(''); } };
  /** Guarda de orcamento antes de qualquer chamada paga: consulta creditos e bloqueia sem iniciar lote parcial. */
  const guardar = async (custoMaximo: number) => {
    const c = await chamar('creditos', {});
    const g = budgetGuardVibe({ custoMaximo, disponiveis: Number(c.disponiveis), budget, reserve });
    registrar(`orçamento: ${g.motivo}`);
    if (!g.ok) throw new Error(`Não iniciado: ${g.motivo}.`);
    return Number(c.disponiveis);
  };

  const testar = () => rodar('teste', async () => { const t = await chamar('teste', {}); setTeste(t); registrar(`conexão ok · ${String(t.creditosDepois)} créditos`); onOk('Conexão com o Vibe validada sem chamadas pagas.'); });
  const casar = () => rodar('match', async () => {
    const custo = semId.length * CUSTO_VIBE.match;
    if (!window.confirm(`Casar ${semId.length} empresa(s) na Explorium: custo estimado ${custo} crédito(s) (1 por empresa). Continuar?`)) return;
    const antes = await guardar(custo);
    let casadas = 0;
    for (let i = 0; i < semId.length; i += 50) {
      const lote = semId.slice(i, i + 50).map((e) => ({ id: e.id, nome: e.razaoSocial, dominio: e.dominio }));
      const res = await chamar('match', { empresas: lote, confirmar: true });
      const pares = (res.resultados as { id: string; businessId: string | null }[]) ?? [];
      casadas += actions.definirBusinessIdsRadar(pares.map((p) => ({ empresaId: p.id, businessId: p.businessId })));
      registrar(`lote ${i / 50 + 1}: ${pares.filter((p) => p.businessId).length} de ${lote.length} casadas`);
    }
    const depois = await chamar('creditos', {});
    registrar(`match: créditos ${antes} → ${String(depois.disponiveis)} (estimado ${custo})`);
    onOk(`${casadas} empresa(s) com business_id.`);
  });
  const cobrir = () => rodar('cobertura', async () => {
    const c = await chamar('cobertura', { businessIds: ids, somenteComEmail });
    const cob = c.cobertura as { nome: string; total: number }[];
    setCobertura(cob);
    const primeira = cob.findIndex((x) => x.total > 0);
    if (primeira >= 0) { const a = await chamar('amostra', { businessIds: ids, tier: primeira, n: 5, somenteComEmail }); setAmostra({ tier: String(a.tier), amostra: (a.amostra as ProspectVibe[]) ?? [] }); registrar(`amostra em preview · correlation_id ${String(a.correlationId ?? '—')}`); }
    registrar('cobertura obtida (estatística, sem créditos)');
  });
  const buscar = () => rodar('decisores', async () => {
    if (!cobertura) throw new Error('Rode a cobertura primeiro.');
    if (!window.confirm(`Descoberta em modo completo: estimativa provável ${est.busca} crédito(s), máximo projetado ${est.buscaMaxima} se paginar até ${PAGINAS_MAX} páginas (1 crédito por registro devolvido; e-mail é um passo separado). Continuar?`)) return;
    const antes = await guardar(est.buscaMaxima);
    const porTier: ProspectVibe[][] = [];
    let escolhidos: ProspectVibe[] = [];
    let devolvidos = 0;
    for (let i = 0; i < PRIORIDADE_DECISORES.length; i++) {
      porTier[i] = [];
      if (!cobertura[i]?.total || escolhidos.length >= max) continue;
      let cursor: string | null = null;
      for (let pagina = 0; pagina < PAGINAS_MAX && escolhidos.length < max; pagina++) {
        const faltam = ids.filter((b) => !escolhidos.some((p) => p.business_id === b));
        if (!faltam.length) break;
        const tamanho = tamanhoPaginaVibe((max - escolhidos.length) * 2);
        const res = await chamar('decisores', { businessIds: faltam, tier: i, n: tamanho, cursor: cursor ?? undefined, somenteComEmail, confirmar: true });
        const novos = ((res.prospects as ProspectVibe[]) ?? []).filter((p) => !jaImportados.has((p.prospect_id ?? '').toLowerCase()));
        devolvidos += ((res.prospects as ProspectVibe[]) ?? []).length;
        porTier[i] = [...porTier[i], ...novos];
        escolhidos = escolherDecisores(porTier, ids, max);
        cursor = (res.nextCursor as string | null) ?? null;
        registrar(`${PRIORIDADE_DECISORES[i].nome} p${pagina + 1}: ${((res.prospects as ProspectVibe[]) ?? []).length} devolvidos · ${escolhidos.length} escolhidos · correlation_id ${String(res.correlationId ?? '—')}`);
        if (!cursor || ((res.prospects as ProspectVibe[]) ?? []).length < tamanho) break;
      }
    }
    const depois = await chamar('creditos', {});
    setDecisores(escolhidos);
    registrar(`descoberta: ${devolvidos} registros · créditos ${antes} → ${String(depois.disponiveis)} (delta ${antes - Number(depois.disponiveis)}; estimado ${est.busca})`);
    onOk(`${escolhidos.length} decisor(es) encontrados. Revise e importe.`);
  });
  const importar = () => rodar('importar', async () => { if (!decisores?.length) return; const x = actions.importarProspectsVibe(decisores); registrar(`importados ${x.importados}, atualizados ${x.atualizados}, sem empresa ${x.semEmpresa}`); onOk(`${x.importados + x.atualizados} contato(s) no Radar com prospect_id.`); });
  const enriquecer = () => rodar('enriquecer', async () => {
    // idempotencia: so contatos do Vibe sem e-mail valido
    const alvo = r.contatos.filter((c) => c.fonteExternaId && /^[a-f0-9]{40}$/i.test(c.fonteExternaId) && (!c.email || c.statusEmail === 'invalido' || c.statusEmail === 'devolvido'));
    if (!alvo.length) throw new Error('Nenhum contato do Vibe sem e-mail válido (nada a pagar de novo).');
    const custo = alvo.length * CUSTO_VIBE.email;
    if (!window.confirm(`E-mail profissional de ${alvo.length} contato(s): custo estimado ${custo} crédito(s) (2 cada; telefone não incluído). Continuar?`)) return;
    const antes = await guardar(custo);
    let aplicados = 0;
    for (let i = 0; i < alvo.length; i += 50) {
      const res = await chamar('enriquecer', { prospectIds: alvo.slice(i, i + 50).map((c) => c.fonteExternaId!), confirmar: true });
      aplicados += actions.aplicarEnriquecimentoVibe((res.resultados as { prospect_id: string; professional_email?: string | null; professional_email_status?: string | null; mobile_phone?: string | null }[]) ?? []);
      registrar(`lote ${i / 50 + 1}: ${aplicados} aplicados · correlation_id ${String(res.correlationId ?? '—')}`);
    }
    const depois = await chamar('creditos', {});
    registrar(`e-mail: créditos ${antes} → ${String(depois.disponiveis)} (delta ${antes - Number(depois.disponiveis)}; estimado ${custo})`);
    onOk(`${aplicados} contato(s) com e-mail profissional.`);
  });
  if (modo !== 'remoto') return <Empty icone="radar" titulo="Vibe só em produção">A integração roda na função protegida do Netlify com a sessão do Supabase; no modo local não há chave nem sessão.</Empty>;
  return (
    <>
      <div className="card">
        <h2>1 · Conexão e orçamento</h2>
        <div className="small muted">A chave fica no painel do Netlify (VIBE_API_KEY). O teste consulta créditos, uma estatística gratuita e 1 registro em preview; nada em modo completo.</div>
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary sm" disabled={!!ocupado} onClick={testar}>{ocupado === 'teste' ? 'Testando…' : 'Testar conexão'}</button>
          {teste && <><Badge tone="ok">ok</Badge><span className="small">créditos {String(teste.creditosDepois)} de {String(teste.alocados)} ({String(teste.conta)}) · consumo do teste {Number(teste.creditosAntes) - Number(teste.creditosDepois)} · engenharia no Brasil: {String(teste.engenhariaBrasil)}</span></>}
          <label className="small">budget <NumberInput value={budget} onChange={setBudget} style={{ width: 70 }} /></label>
          <label className="small">reserva <NumberInput value={reserve} onChange={setReserve} style={{ width: 70 }} /></label>
          <span className="small muted">nenhuma chamada paga inicia se o custo máximo projetado passar de min(budget, disponíveis − reserva)</span>
        </div>
        {teste?.preview ? <pre className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(teste.preview, null, 1)}</pre> : null}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>2 · Empresas do Radar × Explorium</h2>
        <KpiStrip itens={[{ label: 'Empresas ativas', value: empresas.length }, { label: 'Com business_id', value: comId.length }, { label: 'Sem business_id', value: semId.length, hint: `≈ ${semId.length} crédito(s) para casar` }, { label: 'Contatos Vibe já importados', value: jaImportados.size }]} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn sm" disabled={!!ocupado || !semId.length} onClick={casar}>{ocupado === 'match' ? 'Casando…' : `Casar ${semId.length} empresa(s) (≈ ${semId.length} créditos)`}</button></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>3 · Cobertura e amostra (sem créditos)</h2>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado || !ids.length} onClick={cobrir}>{ocupado === 'cobertura' ? 'Consultando…' : 'Cobertura por prioridade + amostra de 5'}</button>
          <label className="small">máximo de decisores <NumberInput value={max} onChange={setMax} style={{ width: 70 }} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={somenteComEmail} onChange={(e) => { setSomenteComEmail(e.target.checked); setCobertura(null); }} /> somente pessoas com e-mail disponível</label>
        </div>
        {cobertura && (
          <div className="grid cols-2" style={{ marginTop: 10 }}>
            <table className="small"><thead><tr><th>Prioridade</th><th className="num">Prospects</th></tr></thead><tbody>{cobertura.map((c) => <tr key={c.nome}><td>{c.nome}</td><td className="num">{c.total}</td></tr>)}</tbody></table>
            <div>
              <b className="small">Amostra ({amostra?.tier ?? '—'}, preview)</b>
              {!amostra?.amostra.length ? <div className="muted small">Sem registros.</div> : <table className="small"><thead><tr><th>Nome</th><th>Cargo</th><th>Empresa</th><th>Nível</th></tr></thead><tbody>{amostra.amostra.map((p) => <tr key={p.prospect_id}><td>{p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`}</td><td>{p.job_title}</td><td>{p.company_name}</td><td>{p.job_level_main}</td></tr>)}</tbody></table>}
              <div className="small" style={{ marginTop: 8 }}><b>Estimativa</b> (não é valor exato): descoberta provável {est.busca} (máximo {est.buscaMaxima} com paginação) · e-mail {est.email} · telefone 0 · perfil 0 (não chamado) · reserva {est.reserva} · total provável {est.total}.</div>
            </div>
          </div>
        )}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>4 · Descobrir, importar e enriquecer</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={!!ocupado || !cobertura} onClick={buscar}>{ocupado === 'decisores' ? 'Buscando…' : `Descobrir até ${max} decisores (≈ ${est.busca}, máx. ${est.buscaMaxima})`}</button>
          <button className="btn sm" disabled={!!ocupado || !decisores?.length} onClick={importar}>Importar {decisores?.length ?? 0} no Radar (sem créditos)</button>
          <button className="btn sm" disabled={!!ocupado} onClick={enriquecer}>E-mail profissional dos contatos Vibe sem e-mail válido (2 cada)</button>
        </div>
        {decisores && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="small"><thead><tr><th>Prioridade</th><th>Nome</th><th>Cargo</th><th>Empresa</th><th>Nível</th><th>Departamento</th><th>LinkedIn</th><th>prospect_id</th></tr></thead>
              <tbody>{decisores.map((p) => <tr key={p.prospect_id}><td>{p.prioridade}</td><td><b>{p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`}</b></td><td>{p.job_title}</td><td>{p.company_name}</td><td>{p.job_level_main}</td><td>{p.job_department_main}</td><td>{p.linkedin ? <a href={p.linkedin} target="_blank" rel="noreferrer">perfil</a> : '—'}</td><td className="muted">{p.prospect_id.slice(0, 8)}…</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
      {!!log.length && <div className="card small muted" style={{ marginTop: 12 }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </>
  );
}
