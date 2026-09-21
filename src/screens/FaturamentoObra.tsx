// Aba Faturamento da Obra 360: o contrato por etapa contra o que ja foi faturado nas duas frentes
// (direto ao cliente e pela construtora). Toda conta vem de src/core/faturamento.ts; aqui so se mostra,
// rateia um titulo por etapa e marca o repasse da nota ao cliente.
import React, { useMemo, useState } from 'react';
import type { Obra360 } from '../core/engine';
import { acompanhamentoFaturamento, type NotaFaturamento } from '../core/faturamento';
import type { Lancamento } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Link, MoedaInput, Modal, Money, Select, money, pct, tentar } from '../ui/components';
import { Tabela } from '../ui/Tabela';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

export function FaturamentoTab({ o, onErro, onOk }: { o: Obra360; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [frente, setFrente] = useState('Todas');
  const [rateando, setRateando] = useState<Lancamento | null>(null);
  const codigo = o.obra.codigo;
  const podeEditar = pode(usuario, 'editar_lancamento', codigo);

  const r = useMemo(() => acompanhamentoFaturamento({
    codigoObra: codigo, servicos: ds.servicos, medicoes: ds.medicoes, lancamentos: ds.lancamentos, rateios: ds.rateios, planoContas: ds.planoContas,
    execucaoPorServico: new Map(o.servicos.map((s) => [s.id, s.pctExecucao])),
  }), [ds, codigo, o.servicos]);

  const notas = r.notas.filter((n) => frente === 'Todas' || n.frente === frente);
  const t = r.totais;

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">Contratado</div><div className="value">{money(t.contratadoBruto, true)}</div><div className="hint">direto {money(t.previstoDireto, true)} · construtora {money(t.previstoConstrutora, true)}</div></div>
        <div className="kpi"><div className="label">Faturado</div><div className="value">{money(t.faturadoTotal, true)} · {pct(t.pctFaturado)}</div><div className="hint">direto {money(t.faturadoDireto, true)} · construtora {money(t.faturadoConstrutora, true)}</div></div>
        <div className="kpi"><div className="label">Saldo a faturar</div><div className="value">{money(t.saldo, true)}</div><div className="hint">direto {money(t.saldoDireto, true)} · construtora {money(t.saldoConstrutora, true)}</div></div>
        <div className={`kpi ${t.diretoNaoEnviado > 0 ? 'warn' : ''}`}><div className="label">A repassar ao cliente</div><div className="value">{money(t.diretoNaoEnviado, true)}</div><div className="hint">notas diretas faturadas ainda não enviadas{t.estimativaDireto > 0 ? ` · ${money(t.estimativaDireto, true)} em estimativa` : ''}</div></div>
      </div>

      <h3>Contrato por etapa</h3>
      <p className="muted small">Contratado vem do cronograma de medições; faturado, dos títulos. Retenção contratual de {money(t.retencao, true)} sobre a parte da construtora (líquido {money(t.contratadoLiquido, true)}).</p>
      <Tabela
        linhas={r.etapas}
        chave={(l) => l.servicoId ?? l.etapa}
        colunas={[
          { titulo: 'Etapa', ordenar: (l) => l.codigo || l.etapa },
          { titulo: 'Contratado', num: true, ordenar: (l) => l.contratadoBruto },
          { titulo: 'Direto previsto', num: true, ordenar: (l) => l.previstoDireto },
          { titulo: 'Construtora prevista', num: true, ordenar: (l) => l.previstoConstrutora },
          { titulo: 'Faturado direto', num: true, ordenar: (l) => l.faturadoDireto },
          { titulo: 'Faturado construtora', num: true, ordenar: (l) => l.faturadoConstrutora },
          { titulo: 'Total faturado', num: true, ordenar: (l) => l.faturadoTotal },
          { titulo: 'Saldo', num: true, ordenar: (l) => l.saldo },
          { titulo: '% faturado', num: true, ordenar: (l) => l.pctFaturado },
          { titulo: '% executado', num: true, ordenar: (l) => l.pctExecutado, title: 'Avanço físico do serviço, do motor (não é digitado)' },
        ]}
        linha={(l) => (
          <>
            <td>{l.codigo && <b>{l.codigo}</b>} {l.etapa}</td>
            <td className="num"><Money v={l.contratadoBruto} compact /></td>
            <td className="num"><Money v={l.previstoDireto} compact /></td>
            <td className="num"><Money v={l.previstoConstrutora} compact /></td>
            <td className="num"><Money v={l.faturadoDireto} compact />{l.estimativaDireto > 0 && <div className="muted small">+{money(l.estimativaDireto, true)} estimado</div>}</td>
            <td className="num"><Money v={l.faturadoConstrutora} compact /></td>
            <td className="num"><b><Money v={l.faturadoTotal} compact /></b></td>
            <td className="num"><Money v={l.saldo} compact /></td>
            <td className="num">{pct(l.pctFaturado)}</td>
            <td className="num">{pct(l.pctExecutado)}</td>
          </>
        )}
        csv={{
          nome: `faturamento-${codigo}`,
          linha: (l) => [l.codigo, l.etapa, l.contratadoBruto, l.previstoDireto, l.previstoConstrutora, l.faturadoDireto, l.faturadoConstrutora, l.faturadoTotal, l.saldo, l.pctFaturado, l.pctExecutado],
        }}
        vazio="Sem etapas: cadastre os serviços e o cronograma de medições do contrato."
      />

      <h3 style={{ marginTop: 18 }}>Notas de faturamento</h3>
      <div className="actions" style={{ marginBottom: 8 }}>
        <Select value={frente} onChange={setFrente} options={['Todas', 'Direto', 'Construtora']} aria-label="Frente de faturamento" />
        <span className="muted small">Faturamento direto é a nota que o cliente paga ao fornecedor; construtora é a nota da EIFF ao cliente. Uma nota que cobre várias etapas aparece rateada.</span>
      </div>
      {r.notas.length === 0 ? (
        <Empty titulo="Nenhuma nota registrada">O faturamento direto vem dos lançamentos de saída marcados como faturamento direto; o da construtora, dos recebíveis com rateio por etapa ou medição vinculada.</Empty>
      ) : (
        <Tabela
          linhas={notas}
          chave={(n) => n.chave}
          colunas={[
            { titulo: 'Data', ordenar: (n) => n.data },
            { titulo: 'Documento', ordenar: (n) => n.documento },
            { titulo: 'Frente', ordenar: (n) => n.frente },
            { titulo: 'Contraparte', ordenar: (n) => n.contraparte },
            { titulo: 'Etapas' },
            { titulo: 'Valor', num: true, ordenar: (n) => n.valor },
            { titulo: 'Situação', ordenar: (n) => n.situacao },
            { titulo: 'Repasse ao cliente', ordenar: (n) => n.enviadoClienteEm ?? '' },
            { titulo: '' },
          ]}
          linha={(n) => <LinhaNota n={n} podeEditar={podeEditar} onErro={onErro} onOk={onOk} onRatear={setRateando} />}
          csv={{
            nome: `notas-faturamento-${codigo}`,
            cabecalho: ['Data', 'Documento', 'Frente', 'Contraparte', 'Etapas', 'Valor', 'Situação', 'Repasse ao cliente'],
            linha: (n) => [n.data, n.documento, n.frente, n.contraparte, n.itens.map((i) => i.etapa).join(' | '), n.valor, n.situacao, n.enviadoClienteEm ?? ''],
          }}
        />
      )}
      {rateando && <RateioForm lancamento={rateando} onClose={() => setRateando(null)} onErro={onErro} onOk={onOk} />}
    </>
  );
}

function LinhaNota({ n, podeEditar, onErro, onOk, onRatear }: { n: NotaFaturamento; podeEditar: boolean; onErro: (m: string) => void; onOk: (m: string) => void; onRatear: (l: Lancamento) => void }) {
  const { ds } = useStore();
  const titulos = [...new Set(n.itens.map((i) => i.lancamentoId))];
  const lancamento = ds.lancamentos.find((l) => l.id === titulos[0]);
  const marcar = (data?: string) => tentar(() => titulos.forEach((id) => actions.marcarEnvioCliente(id, data)), onErro, () => onOk(data ? 'Repasse ao cliente registrado.' : 'Repasse desmarcado.'));
  return (
    <>
      <td>{d(n.data)}</td>
      <td><b>{n.documento}</b>{titulos.length === 1 ? <div className="muted small"><Link to={`/lancamentos/${titulos[0]}`}>{titulos[0]}</Link></div> : <div className="muted small">{titulos.length} títulos</div>}</td>
      <td><Badge tone={n.frente === 'Direto' ? 'warn' : 'ok'}>{n.frente}</Badge></td>
      <td>{n.contraparte}</td>
      <td className="small">{n.itens.map((i, ix) => <div key={ix}>{i.etapa} · {money(i.valor, true)}</div>)}</td>
      <td className="num"><b><Money v={n.valor} compact /></b></td>
      <td><Badge tone={n.situacao === 'Faturado' ? 'ok' : 'muted'}>{n.situacao}</Badge></td>
      <td className="small">{n.frente !== 'Direto' ? '—' : n.enviadoClienteEm ? <>{d(n.enviadoClienteEm)}{podeEditar && <button className="btn sm no-print" style={{ marginLeft: 6 }} onClick={() => marcar(undefined)}>Desfazer</button>}</> : podeEditar ? <button className="btn sm no-print" onClick={() => marcar(new Date().toISOString().slice(0, 10))}>Marcar enviada</button> : 'não enviada'}</td>
      <td className="actions">{podeEditar && titulos.length === 1 && lancamento && <button className="btn sm no-print" onClick={() => onRatear(lancamento)} title="Dividir este título entre etapas do contrato">Ratear</button>}</td>
    </>
  );
}

/** Divide um titulo entre etapas do contrato: as duas somas tem de fechar (regra no store). */
function RateioForm({ lancamento, onClose, onErro, onOk }: { lancamento: Lancamento; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const servicos = ds.servicos.filter((s) => s.codigoObra === lancamento.codigoObra && s.ativo);
  const atuais = ds.rateios.filter((r) => r.lancamentoId === lancamento.id);
  const [itens, setItens] = useState<{ servicoId: string; descricao: string; valor: number }[]>(
    atuais.length ? atuais.map((r) => ({ servicoId: r.servicoId, descricao: r.descricao, valor: r.valor }))
      : [{ servicoId: lancamento.servicoId ?? servicos[0]?.id ?? '', descricao: '', valor: lancamento.valorBruto }],
  );
  const total = Math.round(itens.reduce((a, i) => a + i.valor, 0) * 100) / 100;
  const diferenca = Math.round((lancamento.valorBruto - total) * 100) / 100;
  const up = (ix: number, p: Partial<{ servicoId: string; descricao: string; valor: number }>) => setItens(itens.map((i, k) => (k === ix ? { ...i, ...p } : i)));
  const salvar = () => tentar(() => actions.salvarRateioFaturamento(lancamento.id, itens), onErro, () => { onOk('Rateio por etapa gravado.'); onClose(); });
  const limpar = () => tentar(() => actions.salvarRateioFaturamento(lancamento.id, []), onErro, () => { onOk('Rateio removido.'); onClose(); });
  return (
    <Modal title={`Ratear por etapa · ${lancamento.documento || lancamento.id}`} onClose={onClose}>
      <p className="muted small">O rateio é a leitura por etapa do mesmo título ({money(lancamento.valorBruto)}): não muda valor, caixa, custo nem DRE. As duas somas têm de fechar.</p>
      <div className="form">
        {itens.map((i, ix) => (
          <React.Fragment key={ix}>
            <Field label={`Etapa ${ix + 1}`} req>
              <Select value={i.servicoId} onChange={(v) => up(ix, { servicoId: v })} options={servicos.map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="Escolha a etapa" />
            </Field>
            <Field label="Valor" req><MoedaInput value={i.valor} onChange={(v) => up(ix, { valor: v })} /></Field>
            <Field label="Descrição" full><input value={i.descricao} onChange={(e) => up(ix, { descricao: e.target.value })} placeholder="o que dessa nota entra nesta etapa" /></Field>
            <Field label="" full><button className="btn sm" onClick={() => setItens(itens.filter((_, k) => k !== ix))} disabled={itens.length === 1}>Remover etapa</button></Field>
          </React.Fragment>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={() => setItens([...itens, { servicoId: '', descricao: '', valor: diferenca > 0 ? diferenca : 0 }])}>+ Etapa</button>
        <span className={diferenca === 0 ? 'small muted' : 'small neg'}>Soma {money(total)} · {diferenca === 0 ? 'fecha com o título' : `faltam ${money(diferenca)}`}</span>
        <span style={{ flex: 1 }} />
        {atuais.length > 0 && <button className="btn sm" onClick={limpar}>Remover rateio</button>}
        <button className="btn primary" onClick={salvar} disabled={diferenca !== 0}>Gravar rateio</button>
      </div>
    </Modal>
  );
}
