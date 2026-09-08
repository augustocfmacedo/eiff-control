import React, { useState } from 'react';
import { PRIORIDADE_DECISORES, escolherDecisores, estimarCreditos, type ProspectVibe } from '../../core/radar';
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

export function VibePainel({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, modo } = useStore();
  const r = ds.radar;
  const [ocupado, setOcupado] = useState('');
  const [teste, setTeste] = useState<Resp | null>(null);
  const [cobertura, setCobertura] = useState<{ nome: string; total: number }[] | null>(null);
  const [amostra, setAmostra] = useState<{ tier: string; amostra: ProspectVibe[] } | null>(null);
  const [max, setMax] = useState(56);
  const [decisores, setDecisores] = useState<ProspectVibe[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const empresas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const comId = empresas.filter((e) => e.businessId);
  const semId = empresas.filter((e) => !e.businessId && (e.razaoSocial || e.dominio));
  const ids = comId.map((e) => e.businessId!);
  const coberturaTotal = (cobertura ?? []).reduce((s, c) => s + c.total, 0);
  const est = estimarCreditos({ empresasSemId: semId.length, decisores: Math.min(max, comId.length || max), cobertura: cobertura ? coberturaTotal : max * 2, email: true, perfil: false });
  const registrar = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} ${m}`, ...l].slice(0, 30));
  const rodar = async (nome: string, fn: () => Promise<void>) => { setOcupado(nome); try { await fn(); } catch (e) { onErro((e as Error).message); registrar(`erro: ${(e as Error).message}`); } finally { setOcupado(''); } };

  const testar = () => rodar('teste', async () => { const t = await chamar('teste', {}); setTeste(t); registrar(`conexão ok · ${String(t.creditosDepois)} créditos`); onOk('Conexão com o Vibe validada.'); });
  const casar = () => rodar('match', async () => {
    if (!window.confirm(`Casar ${semId.length} empresa(s) na Explorium consome ${semId.length} crédito(s). Continuar?`)) return;
    let casadas = 0;
    for (let i = 0; i < semId.length; i += 50) {
      const lote = semId.slice(i, i + 50).map((e) => ({ id: e.id, nome: e.razaoSocial, dominio: e.dominio }));
      const res = await chamar('match', { empresas: lote, confirmar: true });
      const pares = (res.resultados as { id: string; businessId: string | null }[]) ?? [];
      casadas += actions.definirBusinessIdsRadar(pares.map((p) => ({ empresaId: p.id, businessId: p.businessId })));
      registrar(`lote ${i / 50 + 1}: ${pares.filter((p) => p.businessId).length} de ${lote.length} casadas`);
    }
    onOk(`${casadas} empresa(s) com business_id.`);
  });
  const cobrir = () => rodar('cobertura', async () => { const c = await chamar('cobertura', { businessIds: ids }); setCobertura(c.cobertura as { nome: string; total: number }[]); const primeira = (c.cobertura as { nome: string; total: number }[]).findIndex((x) => x.total > 0); if (primeira >= 0) { const a = await chamar('amostra', { businessIds: ids, tier: primeira, n: 5 }); setAmostra({ tier: String(a.tier), amostra: (a.amostra as ProspectVibe[]) ?? [] }); } registrar('cobertura e amostra obtidas (sem créditos)'); });
  const buscar = () => rodar('decisores', async () => {
    if (!cobertura) throw new Error('Rode a cobertura primeiro.');
    if (!window.confirm(`Buscar até ${max} decisores em modo completo consome cerca de ${est.busca} crédito(s) (1 por registro devolvido). Continuar?`)) return;
    const porTier: ProspectVibe[][] = [];
    let escolhidos: ProspectVibe[] = [];
    for (let i = 0; i < PRIORIDADE_DECISORES.length; i++) {
      porTier[i] = [];
      if (!cobertura[i]?.total || escolhidos.length >= max) continue;
      const faltam = ids.filter((b) => !escolhidos.some((p) => p.business_id === b));
      if (!faltam.length) break;
      const res = await chamar('decisores', { businessIds: faltam, tier: i, n: Math.min(200, Math.max(10, (max - escolhidos.length) * 2)), confirmar: true });
      porTier[i] = (res.prospects as ProspectVibe[]) ?? [];
      escolhidos = escolherDecisores(porTier, ids, max);
      registrar(`${PRIORIDADE_DECISORES[i].nome}: ${porTier[i].length} devolvidos · ${escolhidos.length} escolhidos`);
    }
    setDecisores(escolhidos);
    onOk(`${escolhidos.length} decisor(es) encontrados. Revise e importe.`);
  });
  const importar = () => rodar('importar', async () => { if (!decisores?.length) return; const x = actions.importarProspectsVibe(decisores); registrar(`importados ${x.importados}, atualizados ${x.atualizados}, sem empresa ${x.semEmpresa}`); onOk(`${x.importados + x.atualizados} contato(s) no Radar com prospect_id.`); });
  const enriquecer = () => rodar('enriquecer', async () => {
    const alvo = r.contatos.filter((c) => c.fonteExternaId && /^[a-f0-9]{40}$/i.test(c.fonteExternaId) && !c.email);
    if (!alvo.length) throw new Error('Nenhum contato do Vibe sem e-mail.');
    if (!window.confirm(`E-mail profissional de ${alvo.length} contato(s) consome ${alvo.length * 2} crédito(s). Continuar? (telefone não incluído)`)) return;
    let aplicados = 0;
    for (let i = 0; i < alvo.length; i += 50) {
      const res = await chamar('enriquecer', { prospectIds: alvo.slice(i, i + 50).map((c) => c.fonteExternaId!), confirmar: true });
      aplicados += actions.aplicarEnriquecimentoVibe((res.resultados as { prospect_id: string; professional_email?: string | null; professional_email_status?: string | null; mobile_phone?: string | null }[]) ?? []);
      registrar(`lote ${i / 50 + 1}: ${aplicados} aplicados`);
    }
    onOk(`${aplicados} contato(s) com e-mail profissional.`);
  });
  if (modo !== 'remoto') return <Empty icone="radar" titulo="Vibe só em produção">A integração roda na função protegida do Netlify com a sessão do Supabase; no modo local não há chave nem sessão.</Empty>;
  return (
    <>
      <div className="card">
        <h2>1 · Conexão</h2>
        <div className="small muted">A chave fica no painel do Netlify (VIBE_API_KEY). O teste consulta créditos, uma estatística gratuita e 1 registro em preview.</div>
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary sm" disabled={!!ocupado} onClick={testar}>{ocupado === 'teste' ? 'Testando…' : 'Testar conexão'}</button>
          {teste && <><Badge tone="ok">ok</Badge><span className="small">créditos {String(teste.creditosDepois)} de {String(teste.alocados)} ({String(teste.conta)}) · consumo do teste {Number(teste.creditosAntes) - Number(teste.creditosDepois)} · engenharia no Brasil: {String(teste.engenhariaBrasil)}</span></>}
        </div>
        {teste?.preview ? <pre className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(teste.preview, null, 1)}</pre> : null}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>2 · Empresas do Radar × Explorium</h2>
        <KpiStrip itens={[{ label: 'Empresas ativas', value: empresas.length }, { label: 'Com business_id', value: comId.length }, { label: 'Sem business_id', value: semId.length, hint: `${semId.length} crédito(s) para casar` }]} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn sm" disabled={!!ocupado || !semId.length} onClick={casar}>{ocupado === 'match' ? 'Casando…' : `Casar ${semId.length} empresa(s) (${semId.length} créditos)`}</button></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>3 · Cobertura e amostra (sem créditos)</h2>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={!!ocupado || !ids.length} onClick={cobrir}>{ocupado === 'cobertura' ? 'Consultando…' : 'Cobertura por prioridade + amostra de 5'}</button>
          <label className="small">máximo de decisores <NumberInput value={max} onChange={setMax} style={{ width: 70 }} /></label>
        </div>
        {cobertura && (
          <div className="grid cols-2" style={{ marginTop: 10 }}>
            <table className="small"><thead><tr><th>Prioridade</th><th className="num">Prospects</th></tr></thead><tbody>{cobertura.map((c) => <tr key={c.nome}><td>{c.nome}</td><td className="num">{c.total}</td></tr>)}</tbody></table>
            <div>
              <b className="small">Amostra ({amostra?.tier ?? '—'}, preview)</b>
              {!amostra?.amostra.length ? <div className="muted small">Sem registros.</div> : <table className="small"><thead><tr><th>Nome</th><th>Cargo</th><th>Empresa</th><th>Nível</th></tr></thead><tbody>{amostra.amostra.map((p) => <tr key={p.prospect_id}><td>{p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`}</td><td>{p.job_title}</td><td>{p.company_name}</td><td>{p.job_level_main}</td></tr>)}</tbody></table>}
              <div className="small" style={{ marginTop: 8 }}><b>Estimativa:</b> busca ≈ {est.busca} · e-mail {est.email} · total ≈ {est.total} créditos (telefone e perfil não incluídos).</div>
            </div>
          </div>
        )}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>4 · Buscar, importar e enriquecer</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={!!ocupado || !cobertura} onClick={buscar}>{ocupado === 'decisores' ? 'Buscando…' : `Buscar até ${max} decisores (≈ ${est.busca} créditos)`}</button>
          <button className="btn sm" disabled={!!ocupado || !decisores?.length} onClick={importar}>Importar {decisores?.length ?? 0} no Radar (sem créditos)</button>
          <button className="btn sm" disabled={!!ocupado} onClick={enriquecer}>E-mail profissional dos contatos Vibe sem e-mail (2 créditos cada)</button>
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
