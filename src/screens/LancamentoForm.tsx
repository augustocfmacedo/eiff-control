import React, { useMemo, useState } from 'react';
import { calcLancamento, etapasExigidas, impactoLancamento } from '../core/engine';
import type { Lancamento } from '../core/types';
import { actions, obrasVisiveis, useStore, validarLancamento } from '../data/store';
import { Field, Input, Modal, NumberInput, Select, money, tentar } from '../ui/components';

export function LancamentoForm({ inicial, onClose, onErro, onOk }: { inicial: Lancamento; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [l, setL] = useState<Lancamento>(inicial);
  const up = (p: Partial<Lancamento>) => setL({ ...l, ...p });
  const novo = !ds.lancamentos.some((x) => x.id === inicial.id);
  const calc = useMemo(() => calcLancamento(l, ds), [l, ds]);
  const erros = useMemo(() => validarLancamento(ds, l), [l, ds]);
  const impacto = useMemo(() => (calc.tipo === 'Saída' && l.valorBruto > 0 ? impactoLancamento(ds, l) : undefined), [l, ds, calc.tipo]);
  const excecao = !!impacto?.foraDoOrcamento || !!impacto?.abaixoDaReserva;
  const precisa = calc.tipo === 'Saída' && (excecao || calc.valorLiquidoPrevisto > ds.params.alcadas.limiteGestorObra);
  const etapas = precisa ? etapasExigidas(ds.params, calc.valorLiquidoPrevisto, !!l.codigoObra, excecao) : [];
  const categorias = ds.planoContas.filter((p) => p.ativa);
  const contrapartes = [...new Set([...ds.lancamentos.map((x) => x.contraparte), ...ds.obras.map((o) => o.cliente)])].filter(Boolean).sort();

  const salvar = () =>
    tentar(
      () => {
        const r = actions.salvarLancamento(l);
        onOk(r.aprovacaoAberta ? `${r.lancamento.id} salvo e enviado para aprovação (${etapas.join(' → ')}).` : `${r.lancamento.id} salvo.`);
      },
      onErro,
      onClose,
    );

  return (
    <Modal title={novo ? 'Novo lançamento' : `Lançamento ${l.id}`} onClose={onClose} wide>
      <div className="form">
        <Field label="ID" req><Input value={l.id} disabled={!novo} onChange={(e) => up({ id: e.target.value.toUpperCase() })} /></Field>
        <Field label="Registro"><Select value={l.registro} onChange={(v) => up({ registro: v as Lancamento['registro'] })} options={['Real', 'Exemplo']} /></Field>
        <Field label="Categoria" req>
          <select value={l.categoria} onChange={(e) => up({ categoria: e.target.value, id: novo ? l.id.replace(/^(REC|PAG)/, calcLancamento({ ...l, categoria: e.target.value }, ds).tipo === 'Entrada' ? 'REC' : 'PAG') : l.id })}>
            <option value="">—</option>
            <optgroup label="Entradas">{categorias.filter((p) => p.tipo === 'Entrada').map((p) => <option key={p.categoria}>{p.categoria}</option>)}</optgroup>
            <optgroup label="Saídas">{categorias.filter((p) => p.tipo === 'Saída').map((p) => <option key={p.categoria}>{p.categoria}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Tipo / grupos"><Input disabled value={calc.tipo ? `${calc.tipo} · ${calc.grupoFluxo} · ${calc.grupoDre}` : ''} /></Field>
        <Field label="Subcategoria"><Input value={l.subcategoria} onChange={(e) => up({ subcategoria: e.target.value })} /></Field>
        <Field label="Centro de custo" req><Select value={l.centroCusto} onChange={(v) => up({ centroCusto: v })} options={['Obra', 'Corporativo', 'Fábrica', 'Comercial', 'Administrativo']} /></Field>
        <Field label="Código Obra" req={calc.grupoFluxo === 'Custos Diretos de Obras' || calc.grupoDre === 'Receita Operacional'}>
          <Select value={l.codigoObra} onChange={(v) => up({ codigoObra: v, centroCusto: v ? 'Obra' : l.centroCusto })} options={obrasVisiveis(usuario, ds.obras).map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— sem obra —" />
        </Field>
        <Field label="Serviço da obra" hint="Liga o custo/receita ao orçamento e prazo do serviço">
          <Select value={l.servicoId ?? ''} onChange={(v) => { const s = ds.servicos.find((x) => x.id === v); up({ servicoId: v || undefined, ...(s?.categoriaPadrao && !l.categoria ? { categoria: s.categoriaPadrao } : {}) }); }} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === l.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty={l.codigoObra ? '— sem serviço —' : '— escolha a obra —'} disabled={!l.codigoObra} />
        </Field>
        <Field label="Faturamento direto" hint="Cliente paga o fornecedor: não passa pelo caixa nem pelo DRE da EIFF; abate o saldo de faturamento direto do contrato"><label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 34 }}><input type="checkbox" checked={!!l.faturamentoDireto} onChange={(e) => up({ faturamentoDireto: e.target.checked, centroCusto: e.target.checked ? 'Obra' : l.centroCusto })} disabled={calc.tipo === 'Entrada'} /> Compra paga diretamente pelo cliente</label></Field>
        <Field label="Contraparte" req><Input list="cps" value={l.contraparte} onChange={(e) => up({ contraparte: e.target.value })} /><datalist id="cps">{contrapartes.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Documento"><Input value={l.documento} onChange={(e) => up({ documento: e.target.value })} placeholder="NF, contrato, pedido" /></Field>
        <Field label="Descrição" req full><Input value={l.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Competência" req hint="Regime de competência (DRE)"><Input type="date" value={l.competencia} onChange={(e) => up({ competencia: e.target.value })} /></Field>
        <Field label="Vencimento" req hint="Previsão de caixa e aging"><Input type="date" value={l.vencimento} onChange={(e) => up({ vencimento: e.target.value })} /></Field>
        <Field label="Status"><Select value={l.status} onChange={(v) => up({ status: v as Lancamento['status'] })} options={['Rascunho', 'Programado', 'Aprovado']} /></Field>
        <Field label="Confiabilidade"><Select value={l.confiabilidade} onChange={(v) => up({ confiabilidade: v as Lancamento['confiabilidade'] })} options={['Confirmado', 'Provável', 'Estimado']} /></Field>
        <Field label="Probabilidade (%)" hint="Aplica-se a entradas futuras"><NumberInput value={Math.round(l.probabilidade * 100)} onChange={(v) => up({ probabilidade: v / 100 })} min={0} max={100} /></Field>
        <Field label="Conta financeira" req><Select value={l.contaFinanceira} onChange={(v) => up({ contaFinanceira: v })} options={ds.contas.filter((c) => c.ativa).map((c) => c.instituicao)} /></Field>
        <Field label="Valor bruto" req><NumberInput value={l.valorBruto} onChange={(v) => up({ valorBruto: v })} /></Field>
        <Field label="Retenções / impostos"><NumberInput value={l.retencoes} onChange={(v) => up({ retencoes: v })} /></Field>
        <Field label="Desconto"><NumberInput value={l.desconto} onChange={(v) => up({ desconto: v })} /></Field>
        <Field label="Multa / juros"><NumberInput value={l.multaJuros} onChange={(v) => up({ multaJuros: v })} /></Field>
        <Field label="Valor líquido previsto"><Input disabled value={money(calc.valorLiquidoPrevisto)} /></Field>
        <Field label="Observações / fonte" full><textarea rows={2} value={l.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>

      {erros.length > 0 && <div className="alert bad" style={{ marginTop: 12 }}>{erros.join(' ')}</div>}
      {impacto && (
        <div className={`alert ${excecao ? 'warn' : 'info'}`} style={{ marginTop: 12 }}>
          <b>Impacto no caixa de 13 semanas:</b> menor saldo {money(impacto.saldoMinimo13sAntes)} → <b>{money(impacto.saldoMinimo13sDepois)}</b>
          {impacto.abaixoDaReserva && <> · <b>abaixo da reserva mínima</b> ({money(ds.params.reservaMinima)})</>}
          {l.codigoObra && <> · comprometido da obra {money(impacto.comprometidoObra)} · orçamento disponível {money(impacto.orcamentoDisponivel)} · margem projetada {money(impacto.margemProjetadaObra)}</>}
          {impacto.foraDoOrcamento && <> · <b>fora do orçamento</b> (desvio permitido {Math.round(ds.params.alcadas.desvioOrcamentoPermitido * 100)}%)</>}
          <div className="small" style={{ marginTop: 4 }}>{precisa ? <>Exige aprovação: <b>{etapas.join(' → ')}</b>{excecao && ' (exceção explícita)'}</> : 'Dentro da alçada do solicitante; não exige aprovação.'}</div>
        </div>
      )}
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={erros.length > 0} onClick={salvar}>{precisa && l.status !== 'Rascunho' ? 'Salvar e submeter' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}
