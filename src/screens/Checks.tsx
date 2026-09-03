import React, { useState } from 'react';
import { executarChecks, periodosMensais, statusModelo } from '../core/engine';
import { actions, pode, useStore } from '../data/store';
import { Badge, Field, Link, Modal, PageHead, StatusBadge, dataHora, tentar, useToast } from '../ui/components';

export default function Checks() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const checks = executarChecks(ds);
  const status = statusModelo(checks);
  const [reabrir, setReabrir] = useState<{ periodo: string; motivo: string } | null>(null);
  const meses = periodosMensais(ds.params.dataBase, 1).map((p) => p.ini.slice(0, 7));
  const anteriores = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${ds.params.dataBase}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i - 1); return d.toISOString().slice(0, 7); });
  const periodos = [...anteriores.reverse(), ...meses];
  const fech = (p: string) => ds.fechamentos.find((f) => f.periodo === p && !f.reaberto);
  return (
    <>
      <PageHead title="Checks e fechamento" subtitle={<>Testes de integridade do modelo e alertas gerenciais. Status do modelo: <StatusBadge s={status} /></>} />
      {status === 'FAIL' && <div className="alert bad">Há checks bloqueantes com falha. O fechamento de período está bloqueado até a correção.</div>}
      <div className="grid cols-2">
        <div className="card table-wrap">
          <h2>Integridade (bloqueantes)</h2>
          <table><thead><tr><th>Check</th><th>Atual</th><th>Esperado</th><th>Status</th><th>Onde corrigir</th></tr></thead><tbody>
            {checks.filter((c) => c.tipo === 'bloqueante').map((c) => (
              <tr key={c.id}><td>{c.nome}{c.ids && c.ids.length > 0 && <div className="small">{c.ids.slice(0, 5).map((id) => <Link key={id} to={`/lancamentos/${id}`}>{id} </Link>)}{c.ids.length > 5 && `+${c.ids.length - 5}`}</div>}</td><td className="num">{String(c.atual)}</td><td className="num">{String(c.esperado)}{c.tolerancia ? ` ±${c.tolerancia}` : ''}</td><td><StatusBadge s={c.status} /></td><td className="muted small">{c.onde} — {c.nota}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card table-wrap">
          <h2>Alertas gerenciais (não afetam o status)</h2>
          <table><thead><tr><th>Alerta</th><th>Atual</th><th>Esperado</th><th>Status</th><th>Tratamento</th></tr></thead><tbody>
            {checks.filter((c) => c.tipo === 'alerta').map((c) => (
              <tr key={c.id}><td>{c.nome}</td><td className="num">{String(c.atual)}</td><td className="num">{String(c.esperado)}</td><td><StatusBadge s={c.status} /></td><td className="muted small">{c.nota}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Fechamento de período</h2>
        <p className="small muted">Fechar bloqueia edição retroativa por competência. Reabertura exige Diretoria com motivo e fica na trilha de auditoria.</p>
        <table><thead><tr><th>Período</th><th>Status</th><th>Fechado por</th><th>Ação</th></tr></thead><tbody>
          {periodos.map((p) => {
            const f = fech(p);
            const hist = ds.fechamentos.filter((x) => x.periodo === p && x.reaberto);
            return (
              <tr key={p}>
                <td><b>{p}</b></td>
                <td>{f ? <Badge tone="ok">Fechado</Badge> : <Badge tone="muted">Aberto</Badge>} {hist.length > 0 && <span className="muted small">reaberto {hist.length}×</span>}</td>
                <td className="small">{f ? `${f.fechadoPor} · ${dataHora(f.fechadoEm)}` : ''}</td>
                <td className="actions">
                  {!f && pode(usuario, 'fechar_periodo') && <button className="btn sm" disabled={status === 'FAIL'} onClick={() => tentar(() => actions.fecharPeriodo(p), toast, () => toast(`Período ${p} fechado.`))}>Fechar</button>}
                  {f && pode(usuario, 'reabrir_periodo') && <button className="btn sm danger" onClick={() => setReabrir({ periodo: p, motivo: '' })}>Reabrir</button>}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
      {reabrir && (
        <Modal title={`Reabrir ${reabrir.periodo}`} onClose={() => setReabrir(null)}>
          <Field label="Motivo" req full><textarea rows={3} value={reabrir.motivo} onChange={(e) => setReabrir({ ...reabrir, motivo: e.target.value })} /></Field>
          <div className="foot"><button className="btn" onClick={() => setReabrir(null)}>Voltar</button><button className="btn danger" onClick={() => tentar(() => actions.reabrirPeriodo(reabrir.periodo, reabrir.motivo), toast, () => setReabrir(null))}>Reabrir período</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
