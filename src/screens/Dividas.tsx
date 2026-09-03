import React, { useState } from 'react';
import { addDays, incluirRegistro } from '../core/engine';
import type { Divida } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Empty, Field, Input, Kpi, Modal, Money, NumberInput, PageHead, Select, StatusBadge, money, pct, tentar, useToast } from '../ui/components';

export default function Dividas() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [edit, setEdit] = useState<Divida | null>(null);
  if (!pode(usuario, 'ver_bancos')) return <Empty>Dívidas são visíveis a Financeiro, Diretoria, Contabilidade e Auditoria.</Empty>;
  const lista = ds.dividas.filter((d) => incluirRegistro(d.registro, ds.params));
  const ativas = lista.filter((d) => d.status === 'Ativa');
  const db = ds.params.dataBase;
  const prox30 = ativas.filter((d) => d.proximoVencimento && d.proximoVencimento >= db && d.proximoVencimento <= addDays(db, 30)).reduce((a, d) => a + d.parcelaMensal, 0);
  const nova = (): Divida => ({ id: `DIV-${String(ds.dividas.length + 1).padStart(3, '0')}`, registro: 'Real', credor: '', instrumento: 'Capital de giro', principal: 0, saldoDevedor: 0, taxaAa: 0, parcelaMensal: 0, parcelasRestantes: 0, garantia: '', status: 'Ativa', observacoes: '' });
  return (
    <>
      <PageHead title="Dívidas e obrigações financeiras" subtitle="Saldo devedor, custo, garantias e serviço mensal. O cadastro não cria pagamentos: parcelas e juros são lançados na base única (Amortização de dívidas / Juros e tarifas).">
        {pode(usuario, 'editar_cadastros') && <button className="btn primary" onClick={() => setEdit(nova())}>+ Nova dívida</button>}
      </PageHead>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi label="Saldo devedor total" value={money(ativas.reduce((a, d) => a + d.saldoDevedor, 0))} />
        <Kpi label="Serviço mensal atual" value={money(ativas.reduce((a, d) => a + d.parcelaMensal, 0))} />
        <Kpi label="Parcelas restantes" value={ativas.reduce((a, d) => a + d.parcelasRestantes, 0)} />
        <Kpi label="Vencimentos próximos 30 dias" value={money(prox30)} />
      </div>
      <div className="card table-wrap">
        {lista.length === 0 ? <Empty>Nenhuma dívida cadastrada.</Empty> : (
          <table><thead><tr><th>ID</th><th>Credor</th><th>Instrumento</th><th>Contratação</th><th>Principal</th><th>Saldo devedor</th><th>Taxa a.a.</th><th>Parcela</th><th>Próx. venc.</th><th>Restantes</th><th>Garantia</th><th>Status</th></tr></thead>
            <tbody>{lista.map((d) => <tr key={d.id} className="clickable" onClick={() => pode(usuario, 'editar_cadastros') && setEdit(d)}><td>{d.id}</td><td>{d.credor}</td><td>{d.instrumento}</td><td>{d.contratacao?.split('-').reverse().join('/')}</td><td><Money v={d.principal} /></td><td><Money v={d.saldoDevedor} /></td><td className="num">{pct(d.taxaAa)}</td><td><Money v={d.parcelaMensal} /></td><td>{d.proximoVencimento?.split('-').reverse().join('/')}</td><td className="num">{d.parcelasRestantes}</td><td>{d.garantia}</td><td><StatusBadge s={d.status} /></td></tr>)}</tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal title={`Dívida ${edit.id}`} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="ID"><Input value={edit.id} onChange={(e) => setEdit({ ...edit, id: e.target.value })} /></Field>
            <Field label="Credor" req><Input value={edit.credor} onChange={(e) => setEdit({ ...edit, credor: e.target.value })} /></Field>
            <Field label="Instrumento" req><Input value={edit.instrumento} onChange={(e) => setEdit({ ...edit, instrumento: e.target.value })} /></Field>
            <Field label="Contratação"><Input type="date" value={edit.contratacao ?? ''} onChange={(e) => setEdit({ ...edit, contratacao: e.target.value || undefined })} /></Field>
            <Field label="Principal"><NumberInput value={edit.principal} onChange={(v) => setEdit({ ...edit, principal: v })} /></Field>
            <Field label="Saldo devedor"><NumberInput value={edit.saldoDevedor} onChange={(v) => setEdit({ ...edit, saldoDevedor: v })} /></Field>
            <Field label="Taxa a.a. (%)"><NumberInput value={Math.round(edit.taxaAa * 10000) / 100} onChange={(v) => setEdit({ ...edit, taxaAa: v / 100 })} /></Field>
            <Field label="Parcela mensal"><NumberInput value={edit.parcelaMensal} onChange={(v) => setEdit({ ...edit, parcelaMensal: v })} /></Field>
            <Field label="Próximo vencimento"><Input type="date" value={edit.proximoVencimento ?? ''} onChange={(e) => setEdit({ ...edit, proximoVencimento: e.target.value || undefined })} /></Field>
            <Field label="Parcelas restantes"><NumberInput value={edit.parcelasRestantes} onChange={(v) => setEdit({ ...edit, parcelasRestantes: v })} /></Field>
            <Field label="Garantia"><Input value={edit.garantia} onChange={(e) => setEdit({ ...edit, garantia: e.target.value })} /></Field>
            <Field label="Status"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v as Divida['status'] })} options={['Ativa', 'Quitada', 'Renegociada']} /></Field>
            <Field label="Observações" full><textarea rows={2} value={edit.observacoes} onChange={(e) => setEdit({ ...edit, observacoes: e.target.value })} /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarDivida(edit), toast, () => setEdit(null))}>Salvar</button></div>
        </Modal>
      )}
      {el}
    </>
  );
}
