import React from 'react';
import { NOME_COBERTURA, NOME_PERSONA, relatorioCobertura, type NivelCobertura } from '../../core/radar';
import { useStore } from '../../data/store';
import { Badge, KpiStrip, Link, pct } from '../../ui/components';

const TOM: Record<NivelCobertura, 'ok' | 'warn' | 'bad' | 'muted'> = { IDEAL_DECISION_MAKER: 'ok', USABLE_CONTACT: 'warn', NEEDS_BETTER_DECISION_MAKER: 'bad', NO_CONTACT: 'muted' };
const dist = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';

/** Cobertura de decisores por empresa: contato ≠ decisor ideal. Cortes em Personas e decision fit (fit.ideal / fit.usavel). */
export function CoberturaDecisores() {
  const { ds } = useStore();
  const r = ds.radar;
  const rel = relatorioCobertura(r, ds.params.dataBase);
  const p = (n: number) => (rel.empresas ? pct(n / rel.empresas) : '—');
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>Cobertura de decisores</h2>
      <div className="small muted">Ter um contato não significa ter o decisor ideal. Níveis pelo melhor contato elegível de cada empresa: decisor ideal (fit ≥ {rel.cortes.ideal}), contato utilizável ({rel.cortes.usavel}–{rel.cortes.ideal - 1}), precisa de decisor melhor (&lt; {rel.cortes.usavel}) e sem contato. Os cortes {rel.cortes.ideal}/{rel.cortes.usavel} são a hipótese operacional do piloto (chaves fit.ideal e fit.usavel).</div>
      <KpiStrip itens={[
        { label: 'Empresas', value: rel.empresas },
        { label: 'Cobertas por contato', value: rel.comContato, hint: `CONTACT_COVERED · ${p(rel.comContato)}` },
        { label: 'Decisor ideal', value: rel.ideal, hint: `DECISION_MAKER_COVERED · fit ≥ ${rel.cortes.ideal} · ${p(rel.ideal)}`, tone: rel.ideal ? 'pos' : undefined },
        { label: `Fit ${rel.cortes.usavel}–${rel.cortes.ideal - 1}`, value: rel.usavel, hint: 'contato utilizável' },
        { label: `Fit < ${rel.cortes.usavel}`, value: rel.baixo, hint: 'precisa de decisor melhor', tone: rel.baixo ? 'warn' : undefined },
        { label: 'Sem contato', value: rel.semContato, hint: p(rel.semContato) },
        { label: 'Fit médio / mediana', value: rel.fitMedio == null ? '—' : `${rel.fitMedio} / ${rel.fitMediana}` },
        { label: 'E-mails', value: rel.email.disponiveis, hint: `válidos ${rel.email.validos} · catch-all ${rel.email.catchAll} · inválidos ${rel.email.invalidos}` },
      ]} />
      <div className="grid cols-2 small" style={{ marginTop: 10 }}>
        <div>
          <div><b>Persona:</b> {dist(rel.porPersona)}</div>
          <div><b>Senioridade:</b> {dist(rel.porSenioridade)}</div>
          <div><b>Qualidade do contato:</b> {dist(rel.qualidadeContato)}</div>
          <div><b>Qualidade da empresa:</b> {dist(rel.qualidadeEmpresa)}</div>
        </div>
        <div>
          <div><b>Próximas ações:</b> {rel.proximasAcoes.map((a) => `${a.nome}: ${a.quantidade}`).join(' · ') || '—'}</div>
          {!!rel.precisamDecisorMelhor.length && <div><b>Têm contato, mas precisam de decisor melhor ({rel.precisamDecisorMelhor.length}):</b> {rel.precisamDecisorMelhor.map((x) => `${x.empresa} (${x.contato}, fit ${x.fit})`).join(' · ')}</div>}
          {!!rel.semContatoLista.length && <div><b>Sem contato ({rel.semContatoLista.length}):</b> {rel.semContatoLista.map((x) => x.nome).join(' · ')}</div>}
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="small">
          <thead><tr><th>Empresa</th><th>Contato atual</th><th>Cargo</th><th>Persona</th><th className="num">Decision fit</th><th>E-mail</th><th>Principal?</th><th>Cobertura</th><th>Próxima ação</th></tr></thead>
          <tbody>{rel.linhas.map((l) => (
            <tr key={l.empresaId}>
              <td><Link to={`/radar/empresas/${l.empresaId}`}>{l.empresa}</Link></td><td>{l.contato ?? '—'}</td><td>{l.cargo ?? '—'}</td><td>{l.persona ? NOME_PERSONA[l.persona] : '—'}</td><td className="num">{l.fit ?? '—'}</td>
              <td>{l.statusEmail ?? '—'}</td><td>{l.contato ? (l.principal ? 'sim' : 'sugerido') : '—'}</td><td><Badge tone={TOM[l.nivel]}>{l.nivel}</Badge> <span className="muted">{NOME_COBERTURA[l.nivel]}</span></td><td>{l.proximaAcao}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
