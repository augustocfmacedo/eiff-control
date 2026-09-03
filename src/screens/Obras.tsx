import React, { useState } from 'react';
import { carteiraObras } from '../core/engine';
import type { Obra } from '../core/types';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Field, Input, Link, Modal, Money, NumberInput, PageHead, Select, StatusBadge, pct, tentar, useToast } from '../ui/components';
import { navegar } from '../ui/router';

const STATUS: Obra['status'][] = ['Planejamento', 'Em execução', 'Suspensa', 'Concluída', 'Cancelada'];

export function ObraForm({ obra, onClose, onErro }: { obra: Obra; onClose: () => void; onErro: (m: string) => void }) {
  const [o, setO] = useState<Obra>(obra);
  const { ds } = useStore();
  const novo = !ds.obras.some((x) => x.codigo === obra.codigo);
  const up = (p: Partial<Obra>) => setO({ ...o, ...p });
  return (
    <Modal title={novo ? 'Nova obra / contrato' : `Obra ${o.codigo}`} onClose={onClose}>
      <div className="form">
        <Field label="Código" req><Input value={o.codigo} disabled={!novo} onChange={(e) => up({ codigo: e.target.value.toUpperCase() })} placeholder="OB-XX-YY-01" /></Field>
        <Field label="Registro"><Select value={o.registro} onChange={(v) => up({ registro: v as Obra['registro'] })} options={['Real', 'Exemplo']} /></Field>
        <Field label="Status"><Select value={o.status} onChange={(v) => up({ status: v as Obra['status'] })} options={STATUS} /></Field>
        <Field label="Obra / contrato" req full><Input value={o.nome} onChange={(e) => up({ nome: e.target.value })} /></Field>
        <Field label="Cliente" req><Input value={o.cliente} onChange={(e) => up({ cliente: e.target.value })} /></Field>
        <Field label="Cidade / UF"><Input value={o.cidadeUf} onChange={(e) => up({ cidadeUf: e.target.value })} /></Field>
        <Field label="Responsável"><Select value={o.responsavel ?? ''} onChange={(v) => up({ responsavel: v })} options={ds.usuarios.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty="—" /></Field>
        <Field label="Escopo" full><textarea rows={2} value={o.escopo} onChange={(e) => up({ escopo: e.target.value })} /></Field>
        <Field label="Assinatura"><Input type="date" value={o.assinatura ?? ''} onChange={(e) => up({ assinatura: e.target.value || undefined })} /></Field>
        <Field label="Início"><Input type="date" value={o.inicio ?? ''} onChange={(e) => up({ inicio: e.target.value || undefined })} /></Field>
        <Field label="Fim contratual"><Input type="date" value={o.fimContratual ?? ''} onChange={(e) => up({ fimContratual: e.target.value || undefined })} /></Field>
        <Field label="Valor do contrato" req><NumberInput value={o.valorContrato} onChange={(v) => up({ valorContrato: v })} /></Field>
        <Field label="Aditivos aprovados"><NumberInput value={o.aditivos} onChange={(v) => up({ aditivos: v })} /></Field>
        <Field label="Custo orçado (versão-base)" hint="Ignorado quando a obra tem serviços cadastrados"><NumberInput value={o.custoOrcado} onChange={(v) => up({ custoOrcado: v })} /></Field>
        <Field label="Margem alvo (%)" hint="Custo previsto dos serviços sem orçamento = receita × (1 − margem)"><input type="number" step="1" value={o.margemAlvo === undefined ? '' : Math.round(o.margemAlvo * 100)} onChange={(e) => up({ margemAlvo: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} /></Field>
        <Field label="Medido / faturado"><NumberInput value={o.medidoFaturado} onChange={(v) => up({ medidoFaturado: v })} /></Field>
        <Field label="Execução física (%)"><NumberInput value={Math.round(o.execucaoFisica * 10000) / 100} onChange={(v) => up({ execucaoFisica: v / 100 })} /></Field>
        <Field label="Estimativa a concluir (ETC)" hint="Todo o custo ainda necessário para terminar, contratado ou não"><NumberInput value={o.estimativaConcluir} onChange={(v) => up({ estimativaConcluir: v })} /></Field>
        <Field label="Observações / fontes" full><textarea rows={2} value={o.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={() => tentar(() => actions.salvarObra(o), onErro, onClose)}>Salvar</button>
      </div>
    </Modal>
  );
}

export default function Obras() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [editando, setEditando] = useState<Obra | null>(null);
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const visiveis = new Set(obrasVisiveis(usuario, ds.obras).map((o) => o.codigo));
  const carteira = carteiraObras(ds).filter((o) => visiveis.has(o.obra.codigo))
    .filter((o) => !status || o.obra.status === status)
    .filter((o) => !busca || `${o.obra.codigo} ${o.obra.nome} ${o.obra.cliente}`.toLowerCase().includes(busca.toLowerCase()));
  const nova = (): Obra => ({ codigo: '', registro: 'Real', nome: '', cliente: '', cidadeUf: '', status: 'Planejamento', escopo: '', valorContrato: 0, aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, observacoes: '' });
  return (
    <>
      <PageHead title="Obras e contratos" subtitle="Cada obra é uma unidade econômica: receita, custo, margem, caixa e prazo.">
        {pode(usuario, 'editar_obra') && <button className="btn primary" onClick={() => setEditando(nova())}>+ Nova obra</button>}
      </PageHead>
      <div className="filters">
        <label className="field"><span>Buscar</span><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="código, nome, cliente" /></label>
        <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Obra</th><th>Cliente</th><th>Status</th><th>Prazo</th><th>Receita total</th><th>Medido</th><th>Recebido</th><th>Comprometido</th><th>Pago</th><th>EAC</th><th>Margem proj.</th><th>%</th><th>Caixa</th></tr></thead>
          <tbody>
            {carteira.map((o) => (
              <tr key={o.obra.codigo} className="clickable" onClick={() => navegar(`/obras/${o.obra.codigo}`)}>
                <td><b>{o.obra.codigo}</b><div className="muted small">{o.obra.nome}</div></td>
                <td>{o.obra.cliente}</td>
                <td><StatusBadge s={o.obra.status} /></td>
                <td className={o.diasParaPrazo !== undefined && o.diasParaPrazo < 0 ? 'neg' : ''}>{o.diasParaPrazo !== undefined ? `${o.diasParaPrazo} d` : '—'}</td>
                <td><Money v={o.receitaTotal} compact /></td>
                <td><Money v={o.medidoFaturado} compact /></td>
                <td><Money v={o.recebido} compact /></td>
                <td><Money v={o.custoComprometido} compact /></td>
                <td><Money v={o.custoPago} compact /></td>
                <td><Money v={o.eac} compact /></td>
                <td><Money v={o.margemProjetada} compact sign /></td>
                <td className={`num ${o.pctMargemProjetada < 0 ? 'neg' : ''}`}>{pct(o.pctMargemProjetada)}</td>
                <td><Money v={o.caixaGerado} compact sign /></td>
              </tr>
            ))}
            {carteira.length === 0 && <tr><td colSpan={13} className="empty">Nenhuma obra no seu escopo.</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && <ObraForm obra={editando} onClose={() => setEditando(null)} onErro={toast} />}
      {el}
    </>
  );
}

export { Link };
