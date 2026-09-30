// Histórico das importações de extrato e revinculação de um lote à conta certa.
// Toda regra vem de src/core/extratos.ts e das ações do store; aqui só se mostra e se confirma.
import React, { useMemo, useState } from 'react';
import { lotesDeImportacao, planejarMovimentacao, type LoteImportacao } from '../core/extratos';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Modal, Money, Select, money, tentar } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const dh = (s?: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '—');

export function ImportacoesCard({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [revincular, setRevincular] = useState<LoteImportacao | null>(null);
  const podeConciliar = pode(usuario, 'conciliar');
  const lotes = useMemo(() => lotesDeImportacao(ds.transacoes, ds.contas), [ds.transacoes, ds.contas]);
  const suspeitos = lotes.filter((l) => l.contaProvavel);

  if (!lotes.length) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Importações do extrato <Badge tone="muted">{lotes.length}</Badge></h2>
      <p className="small muted">Cada linha é o que entrou de uma vez numa conta. Importou na conta errada? Revincule: as linhas vão para a conta certa e as que já existirem lá são descartadas, sem apagar nada.</p>
      {suspeitos.length > 0 && (
        <div className="alert warn small" style={{ marginBottom: 8 }}>
          {suspeitos.length === 1 ? 'Uma importação parece' : `${suspeitos.length} importações parecem`} ter entrado na conta errada: as linhas têm o mesmo identificador de movimentos que já existem em outra conta.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Importado em</th><th>Conta</th><th>Período</th><th className="num">Linhas</th><th className="num">Movimento</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.chave} className={l.contaProvavel ? 'atencao' : undefined}>
                <td>{dh(l.importadoEm)}<div className="muted small">{l.origem}</div></td>
                <td>{l.conta}{l.contaProvavel && <div className="small neg">parece ser de {l.contaProvavel}</div>}</td>
                <td className="small">{d(l.de)} a {d(l.ate)}</td>
                <td className="num">{l.quantidade}</td>
                <td className="num"><Money v={l.movimento} sign /><div className="muted small">C {money(l.creditos, true)} · D {money(l.debitos, true)}</div></td>
                <td className="small">
                  {l.conciliadas > 0 && <div>{l.conciliadas} conciliada(s)</div>}
                  {l.descartadas > 0 && <div className="muted">{l.descartadas} descartada(s)</div>}
                  {l.movidas > 0 && <div className="muted">{l.movidas} revinculada(s)</div>}
                  {!l.conciliadas && !l.descartadas && !l.movidas && <span className="muted">—</span>}
                </td>
                <td className="actions">{podeConciliar && l.quantidade > l.descartadas && <button className={`btn sm no-print ${l.contaProvavel ? 'primary' : ''}`} onClick={() => setRevincular(l)}>Revincular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {revincular && <RevincularModal lote={revincular} onClose={() => setRevincular(null)} onErro={onErro} onOk={onOk} />}
    </div>
  );
}

function RevincularModal({ lote, onClose, onErro, onOk }: { lote: LoteImportacao; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const destinos = ds.contas.filter((c) => c.ativa && c.instituicao !== lote.conta);
  const [destino, setDestino] = useState(lote.contaProvavel && destinos.some((c) => c.instituicao === lote.contaProvavel) ? lote.contaProvavel : '');
  const [motivo, setMotivo] = useState(lote.contaProvavel ? `Extrato de ${lote.contaProvavel} importado por engano em ${lote.conta}.` : '');

  const doLote = useMemo(
    () => ds.transacoes.filter((t) => `${t.conta}|${(t.importadoEm ?? '').slice(0, 16) || t.origem}` === lote.chave && !t.descartadaEm),
    [ds.transacoes, lote.chave],
  );
  const plano = useMemo(() => (destino ? planejarMovimentacao(ds.transacoes, doLote.map((t) => t.id), destino) : null), [ds.transacoes, doLote, destino]);

  const confirmar = () => tentar(
    () => {
      const r = actions.moverTransacoes(doLote.map((t) => t.id), destino, motivo);
      const partes = [`${r.movidas} revinculada(s) para ${destino}`];
      if (r.descartadas) partes.push(`${r.descartadas} descartada(s) por já existirem lá`);
      if (r.conciliacoesTransferidas) partes.push(`${r.conciliacoesTransferidas} conciliação(ões) transferida(s)`);
      if (r.lancamentosRealocados) partes.push(`${r.lancamentosRealocados} lançamento(s) passaram para a conta nova`);
      if (r.conciliacoesPerdidas) partes.push(`atenção: ${r.conciliacoesPerdidas} conciliação(ões) precisam ser refeitas`);
      onOk(`${partes.join(' · ')}.`);
    },
    onErro,
    onClose,
  );

  return (
    <Modal title={`Revincular importação de ${lote.conta}`} onClose={onClose}>
      <p className="small muted">{lote.quantidade} linha(s) de {d(lote.de)} a {d(lote.ate)}, importadas em {dh(lote.importadoEm)}. O movimento bancário não é apagado: ele muda de conta, e a linha que já existir na conta de destino é descartada.</p>
      <div className="form">
        <Field label="Conta correta" req>
          <Select value={destino} onChange={setDestino} options={destinos.map((c) => ({ value: c.instituicao, label: `${c.instituicao} · ${c.conta}` }))} allowEmpty="Escolha a conta" />
        </Field>
        <Field label="Motivo" req full hint="fica na auditoria">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: extrato do Inter importado na conta do BB" />
        </Field>
      </div>
      {plano && (
        <div style={{ marginTop: 12 }}>
          <div className="grid cols-3">
            <div className="kpi"><div className="label">Vão para {destino}</div><div className="value">{plano.mover}</div><div className="hint">efeito no caixa {money(plano.movimentoQueEntra, true)}</div></div>
            <div className="kpi"><div className="label">Descartadas (já existem lá)</div><div className="value">{plano.descartar}</div><div className="hint">{plano.conciliacoesTransferidas} conciliação(ões) passam para a linha original</div></div>
            <div className="kpi"><div className="label">Sai de {lote.conta}</div><div className="value">{money(plano.movimentoQueSai, true)}</div><div className="hint">{plano.semEfeito > 0 ? `${plano.semEfeito} sem efeito` : 'saldo da conta corrigido'}</div></div>
          </div>
          {plano.conciliacoesPerdidas > 0 && (
            <div className="alert warn small" style={{ marginTop: 8 }}>{plano.conciliacoesPerdidas} transação(ões) conciliada(s) são duplicata de linhas que já estão conciliadas na conta de destino: a conciliação fica como está e você decide o que fazer com o lançamento.</div>
          )}
          {plano.mover + plano.descartar === 0 && <div className="alert info small" style={{ marginTop: 8 }}>Nada a fazer com esta escolha.</div>}
        </div>
      )}
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={confirmar} disabled={!destino || !motivo.trim() || !plano || plano.mover + plano.descartar === 0}>Revincular</button>
      </div>
    </Modal>
  );
}

/** Transações descartadas: ficam fora do caixa e da conciliação, mas seguem auditáveis. */
export function DescartadasCard({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const descartadas = ds.transacoes.filter((t) => t.descartadaEm);
  if (!descartadas.length) return null;
  const podeConciliar = pode(usuario, 'conciliar');
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Descartadas <Badge tone="muted">{descartadas.length}</Badge></h2>
      <p className="small muted">Linhas importadas em duplicidade. Não entram no caixa, no fluxo nem na conciliação; nada foi apagado.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Conta</th><th>Histórico</th><th className="num">Movimento</th><th>Motivo</th><th /></tr></thead>
          <tbody>
            {descartadas.slice(0, 50).map((t) => (
              <tr key={t.id}>
                <td>{d(t.data)}</td><td>{t.conta}</td><td className="small">{t.historico}</td>
                <td className="num"><Money v={t.credito - t.debito} sign /></td>
                <td className="small muted">{t.motivoDescarte}</td>
                <td className="actions">{podeConciliar && <button className="btn sm no-print" onClick={() => tentar(() => actions.restaurarTransacao(t.id), onErro, () => onOk('Transação restaurada.'))}>Restaurar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {descartadas.length > 50 && <p className="small muted">Mostrando 50 de {descartadas.length}.</p>}
    </div>
  );
}

export { Empty };
