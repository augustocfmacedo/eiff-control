// Histórico das importações de extrato: cada linha é um arquivo que entrou, com dia e hora.
// Importou na conta errada? Troque a conta na própria linha. Toda regra vem de src/core/extratos.ts
// e das ações do store; aqui só se mostra, troca e confirma quando há algo a avisar.
import React, { useMemo, useState } from 'react';
import { lotesDeImportacao, planejarMovimentacao, type LoteImportacao } from '../core/extratos';
import { actions, pode, useStore } from '../data/store';
import { Badge, Money, Select, money, tentar } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const dh = (s?: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} às ${s.slice(11, 16)}` : 'importação antiga');

export function ImportacoesCard({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const podeConciliar = pode(usuario, 'conciliar');
  const lotes = useMemo(() => lotesDeImportacao(ds.transacoes, ds.contas), [ds.transacoes, ds.contas]);
  if (!lotes.length) return null;
  const suspeitos = lotes.filter((l) => l.contaProvavel).length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Importações do extrato <Badge tone="muted">{lotes.length}</Badge></h2>
      <p className="small muted">Cada linha é um arquivo que entrou. Importou na conta errada? <b>Troque a conta aqui na linha</b> — as transações vão junto, e as que já existirem na conta certa são descartadas em vez de duplicar. Nada é apagado.</p>
      {podeConciliar && (
        <div className="actions" style={{ marginBottom: 8 }}>
          <span style={{ flex: 1 }} />
          <LimparExtrato onErro={onErro} onOk={onOk} />
        </div>
      )}
      {suspeitos > 0 && (
        <div className="alert warn small" style={{ marginBottom: 8 }}>
          {suspeitos === 1 ? 'Uma importação parece estar' : `${suspeitos} importações parecem estar`} na conta errada: os movimentos têm o mesmo identificador do banco de linhas que já existem em outra conta.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Importado em</th><th>Período do extrato</th><th className="num">Linhas</th><th className="num">Movimento</th><th>Conta</th><th>Situação</th></tr></thead>
          <tbody>
            {lotes.map((l) => <LinhaLote key={l.chave} lote={l} podeConciliar={podeConciliar} onErro={onErro} onOk={onOk} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Recomeçar do zero: descarta o extrato importado (de uma conta ou de todas) e desfaz as conciliações dele. */
function LimparExtrato({ onErro, onOk }: { onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [conta, setConta] = useState('');
  const ativas = ds.transacoes.filter((t) => !t.descartadaEm && (!conta || t.conta === conta));
  const conciliadas = ativas.filter((t) => t.lancamentoIds.length > 0).length;
  const limpar = () => {
    const onde = conta || 'TODAS as contas';
    const aviso = [
      `Descartar ${ativas.length} transação(ões) de ${onde}?`,
      conciliadas ? `${conciliadas} está(ão) conciliada(s): a conciliação será desfeita e os lançamentos voltam para a fila.` : '',
      'Nada é apagado — as linhas ficam no sistema como descartadas e você pode reimportar o extrato do zero.',
    ].filter(Boolean).join('\n\n');
    if (!window.confirm(aviso)) return;
    tentar(
      () => {
        const r = actions.limparExtrato(conta || undefined, `Limpeza do extrato importado (${onde}) para reimportar do zero.`);
        onOk(`${r.descartadas} transação(ões) descartada(s)${r.conciliacoesDesfeitas ? `, ${r.conciliacoesDesfeitas} conciliação(ões) desfeita(s)` : ''}. Pode importar os arquivos de novo.`);
      },
      onErro,
    );
  };
  return (
    <>
      <Select value={conta} onChange={setConta} options={ds.contas.map((c) => ({ value: c.instituicao, label: c.instituicao }))} allowEmpty="todas as contas" aria-label="Conta a limpar" />
      <button className="btn sm no-print" onClick={limpar} disabled={!ativas.length} title="Descarta o extrato importado para você mandar tudo de novo">
        Limpar extrato importado ({ativas.length})
      </button>
    </>
  );
}

function LinhaLote({ lote, podeConciliar, onErro, onOk }: { lote: LoteImportacao; podeConciliar: boolean; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [trocando, setTrocando] = useState(false);
  const ativas = useMemo(
    () => ds.transacoes.filter((t) => `${t.conta}|${(t.importadoEm ?? '').slice(0, 16) || t.origem}` === lote.chave && !t.descartadaEm),
    [ds.transacoes, lote.chave],
  );

  const trocar = (destino: string) => {
    if (!destino || destino === lote.conta) return;
    const plano = planejarMovimentacao(ds.transacoes, ativas.map((t) => t.id), destino);
    // só interrompe quando há algo que o usuário precisa saber antes: duplicata ou conciliação em jogo
    if (plano.descartar > 0 || plano.conciliacoesPerdidas > 0) {
      const partes = [`Mover ${plano.mover} linha(s) para ${destino}.`];
      if (plano.descartar) partes.push(`${plano.descartar} já existe(m) lá e será(ão) descartada(s) — sem apagar nada.`);
      if (plano.conciliacoesTransferidas) partes.push(`${plano.conciliacoesTransferidas} conciliação(ões) passa(m) para a linha original.`);
      if (plano.conciliacoesPerdidas) partes.push(`Atenção: ${plano.conciliacoesPerdidas} conciliação(ões) precisará(ão) ser refeita(s).`);
      if (!window.confirm(`${partes.join('\n')}\n\nConfirmar?`)) return;
    }
    setTrocando(true);
    tentar(
      () => {
        const r = actions.moverTransacoes(ativas.map((t) => t.id), destino, `Extrato importado em ${lote.conta} e corrigido para ${destino}.`);
        const partes = [`${r.movidas} linha(s) agora em ${destino}`];
        if (r.descartadas) partes.push(`${r.descartadas} descartada(s) por já existirem lá`);
        if (r.lancamentosRealocados) partes.push(`${r.lancamentosRealocados} lançamento(s) passaram para a conta nova`);
        if (r.conciliacoesPerdidas) partes.push(`${r.conciliacoesPerdidas} conciliação(ões) a refazer`);
        onOk(`${partes.join(' · ')}.`);
      },
      onErro,
      () => setTrocando(false),
    );
    setTrocando(false);
  };

  const contas = ds.contas.filter((c) => c.ativa || c.instituicao === lote.conta);
  const tratado = ativas.length === 0;
  return (
    <tr className={lote.contaProvavel ? 'atencao' : undefined}>
      <td>{dh(lote.importadoEm)}<div className="muted small">{lote.origem === 'ofx' ? 'arquivo OFX' : lote.origem}</div></td>
      <td className="small">{d(lote.de)} a {d(lote.ate)}</td>
      <td className="num">{lote.quantidade}</td>
      <td className="num"><Money v={lote.movimento} sign /><div className="muted small">C {money(lote.creditos, true)} · D {money(lote.debitos, true)}</div></td>
      <td style={{ minWidth: 170 }}>
        {podeConciliar && !tratado ? (
          <>
            <Select value={lote.conta} onChange={trocar} options={contas.map((c) => ({ value: c.instituicao, label: c.instituicao }))} disabled={trocando} aria-label={`Conta da importação de ${dh(lote.importadoEm)}`} />
            {lote.contaProvavel && <div className="small neg">deveria ser {lote.contaProvavel}</div>}
          </>
        ) : (
          <>{lote.conta}{lote.contaProvavel && <div className="small neg">parece ser de {lote.contaProvavel}</div>}</>
        )}
      </td>
      <td className="small">
        {lote.conciliadas > 0 && <div>{lote.conciliadas} conciliada(s)</div>}
        {lote.descartadas > 0 && <div className="muted">{lote.descartadas} descartada(s)</div>}
        {lote.movidas > 0 && <div className="muted">veio de outra conta</div>}
        {!lote.conciliadas && !lote.descartadas && !lote.movidas && <span className="muted">—</span>}
      </td>
    </tr>
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
      <p className="small muted">Linhas que entraram em duplicidade. Não contam no caixa, no fluxo nem na conciliação; nada foi apagado.</p>
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
