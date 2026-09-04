import React, { useState } from 'react';
import type { Obra360 } from '../core/engine';
import { ETAPAS_FABRICACAO, ETAPAS_MONTAGEM, type DemandaCalc, type MedicaoCalc, type OrdemCalc, type ServicoCalc } from '../core/obras';
import type { Demanda, EtapaObra, Medicao, OrdemProducao, Periodicidade, Servico, StatusEtapa, StatusMedicao, StatusServico, TipoOrdem } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Empty, Field, Input, Link, Modal, Money, NumberInput, Select, money, pct, tentar, type Tone } from '../ui/components';

const ETAPAS_OBRA: EtapaObra[] = ['Projeto', 'Fabricação', 'Montagem', 'Civil', 'Cobertura e fechamento', 'Pintura', 'Instalações', 'Outros'];
const STATUS_SERVICO: StatusServico[] = ['Não iniciado', 'Em andamento', 'Concluído', 'Suspenso'];
const tonePrazo = (s: string): Tone => (({ Atrasado: 'bad', 'Em risco': 'warn', 'No prazo': 'ok', Concluído: 'ok', 'Não iniciado': 'muted', Suspenso: 'warn', 'Sem prazo': 'muted' }) as Record<string, Tone>)[s] ?? 'muted';
const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

// ---------------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------------
function ServicoForm({ servico, onClose, onErro }: { servico: Servico; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [s, setS] = useState<Servico>(servico);
  const up = (p: Partial<Servico>) => setS({ ...s, ...p });
  const novo = !ds.servicos.some((x) => x.id === servico.id);
  return (
    <Modal title={novo ? 'Novo serviço da obra' : `Serviço ${s.codigo} · ${s.nome}`} onClose={onClose}>
      <div className="form">
        <Field label="Código" req><Input value={s.codigo} onChange={(e) => up({ codigo: e.target.value.toUpperCase() })} /></Field>
        <Field label="Etapa"><Select value={s.etapa} onChange={(v) => up({ etapa: v as EtapaObra })} options={ETAPAS_OBRA} /></Field>
        <Field label="Status"><Select value={s.status} onChange={(v) => up({ status: v as StatusServico })} options={STATUS_SERVICO} /></Field>
        <Field label="Nome do serviço" req full><Input value={s.nome} onChange={(e) => up({ nome: e.target.value })} placeholder="ex.: Estrutura metálica — fabricação e fornecimento" /></Field>
        <Field label="Unidade"><Select value={s.unidade} onChange={(v) => up({ unidade: v })} options={['t', 'kg', 'm²', 'm', 'm³', 'un', 'pç', 'vb', 'h']} /></Field>
        <Field label="Quantidade orçada"><NumberInput value={s.quantidadeOrcada} onChange={(v) => up({ quantidadeOrcada: v })} /></Field>
        <Field label="Quantidade executada"><NumberInput value={s.quantidadeExecutada} onChange={(v) => up({ quantidadeExecutada: v })} /></Field>
        <Field label="Custo orçado" hint="Versão-base do orçamento deste serviço"><NumberInput value={s.custoOrcado} onChange={(v) => up({ custoOrcado: v })} /></Field>
        <Field label="Receita EIFF (líquida de retenção)" hint="Parte da construtora nos eventos deste serviço"><NumberInput value={s.precoVenda} onChange={(v) => up({ precoVenda: v })} /></Field>
        <Field label="Faturamento direto do cliente" hint="Materiais pagos pelo cliente; fora da receita e do custo"><NumberInput value={s.faturamentoDireto ?? 0} onChange={(v) => up({ faturamentoDireto: v })} /></Field>
        <Field label="Peso da fabricação no avanço (%)" hint="Serviços de estrutura: avanço físico = fabricação × peso + montagem × (1 − peso); vazio = 60%"><input type="number" step="5" min={0} max={100} value={s.pesoFabricacao === undefined ? '' : Math.round(s.pesoFabricacao * 100)} onChange={(e) => up({ pesoFabricacao: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} /></Field>
        <Field label="Margem alvo (%)" hint="Usada quando o custo orçado está em zero; vazio = margem da obra"><input type="number" step="1" value={s.margemAlvo === undefined ? '' : Math.round(s.margemAlvo * 100)} onChange={(e) => up({ margemAlvo: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} /></Field>
        <Field label="ETC informado" hint="Vazio = derivado (orçado − comprometido)"><input type="number" step="0.01" value={s.estimativaConcluir ?? ''} onChange={(e) => up({ estimativaConcluir: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        <Field label="Início previsto"><Input type="date" value={s.inicioPrevisto ?? ''} onChange={(e) => up({ inicioPrevisto: e.target.value || undefined })} /></Field>
        <Field label="Fim previsto"><Input type="date" value={s.fimPrevisto ?? ''} onChange={(e) => up({ fimPrevisto: e.target.value || undefined })} /></Field>
        <Field label="Início real"><Input type="date" value={s.inicioReal ?? ''} onChange={(e) => up({ inicioReal: e.target.value || undefined })} /></Field>
        <Field label="Fim real"><Input type="date" value={s.fimReal ?? ''} onChange={(e) => up({ fimReal: e.target.value || undefined })} /></Field>
        <Field label="Responsável"><Select value={s.responsavel ?? ''} onChange={(v) => up({ responsavel: v || undefined })} options={ds.usuarios.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty="—" /></Field>
        <Field label="Categoria padrão dos custos"><Select value={s.categoriaPadrao ?? ''} onChange={(v) => up({ categoriaPadrao: v || undefined })} options={ds.planoContas.filter((p) => p.tipo === 'Saída' && p.grupoFluxo === 'Custos Diretos de Obras').map((p) => p.categoria)} allowEmpty="—" /></Field>
        <Field label="Ativo"><Select value={s.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><textarea rows={2} value={s.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarServico(s), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

function AvancoForm({ s, onClose, onErro }: { s: ServicoCalc; onClose: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ quantidadeExecutada: s.quantidadeExecutada, status: s.status, estimativaConcluir: s.estimativaConcluir, inicioReal: s.inicioReal, fimReal: s.fimReal, justificativa: '' });
  return (
    <Modal title={`Avanço · ${s.codigo} ${s.nome}`} onClose={onClose}>
      <div className="form">
        <Field label={`Quantidade executada (${s.unidade}) de ${s.quantidadeOrcada}`}><NumberInput value={f.quantidadeExecutada} onChange={(v) => setF({ ...f, quantidadeExecutada: v })} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(v) => setF({ ...f, status: v as StatusServico })} options={STATUS_SERVICO} /></Field>
        <Field label="ETC informado" hint="Vazio = derivado do orçamento"><input type="number" step="0.01" value={f.estimativaConcluir ?? ''} onChange={(e) => setF({ ...f, estimativaConcluir: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        <Field label="Início real"><Input type="date" value={f.inicioReal ?? ''} onChange={(e) => setF({ ...f, inicioReal: e.target.value || undefined })} /></Field>
        <Field label="Fim real"><Input type="date" value={f.fimReal ?? ''} onChange={(e) => setF({ ...f, fimReal: e.target.value || undefined })} /></Field>
        <Field label="Justificativa" req full><textarea rows={2} value={f.justificativa} onChange={(e) => setF({ ...f, justificativa: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.atualizarServico(s.id, f), onErro, onClose)}>Registrar</button></div>
    </Modal>
  );
}

function MedirForm({ s, onClose, onErro, onOk }: { s: ServicoCalc; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const porPct = s.quantidadeOrcada <= 1 || s.unidade === 'vb';
  const [f, setF] = useState({ data: ds.params.dataBase, quantidade: 0, pct: 0, descricao: '', evidencia: '' });
  const nome = (id: string) => ds.usuarios.find((u) => u.id === id)?.nome ?? id;
  const restante = Math.max(0, (s.quantidadeOrcada > 0 ? s.quantidadeOrcada : 1) - s.quantidadeMedida);
  return (
    <Modal title={`Medição física · ${s.codigo} ${s.nome}`} onClose={onClose} wide>
      <div className="alert info">Avanço físico atual <b>{pct(s.pctExecucao)}</b> por <b>{s.origemExecucao.toLowerCase()}</b>{s.pctFabricacao !== undefined || s.pctMontagem !== undefined ? <> · fabricação {pct(s.pctFabricacao ?? 0)} × {pct(s.pesoFabricacaoEfetivo)} + montagem {pct(s.pctMontagem ?? 0)} × {pct(1 - s.pesoFabricacaoEfetivo)}</> : null}. {s.origemExecucao.startsWith('Fabricação') && <>As medições abaixo ficam registradas, mas o avanço deste serviço vem da fabricação e montagem.</>}</div>
      <div className="form">
        <Field label="Data da medição" req><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
        {porPct
          ? <Field label="Percentual medido neste boletim (%)" req hint={`acumulado ${pct(s.pctMedido)} · restante ${pct(Math.max(0, 1 - s.pctMedido))}`}><NumberInput value={f.pct} onChange={(v) => setF({ ...f, pct: v })} min={0} max={100} /></Field>
          : <Field label={`Quantidade medida (${s.unidade})`} req hint={`orçado ${s.quantidadeOrcada} · medido ${s.quantidadeMedida} · restante ${restante}`}><NumberInput value={f.quantidade} onChange={(v) => setF({ ...f, quantidade: v })} step="0.01" /></Field>}
        <Field label="Evidência" hint="Boletim, relatório fotográfico, RDO"><Input value={f.evidencia} onChange={(e) => setF({ ...f, evidencia: e.target.value })} /></Field>
        <Field label="Descrição (frente, trecho, critério)" req full><Input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn primary" onClick={() => tentar(() => { actions.registrarAvanco({ servicoId: s.id, data: f.data, quantidade: porPct ? undefined : f.quantidade, pct: porPct ? f.pct / 100 : undefined, descricao: f.descricao, evidencia: f.evidencia }); }, onErro, () => { onOk('Medição registrada.'); setF({ ...f, quantidade: 0, pct: 0, descricao: '', evidencia: '' }); })}>Registrar medição</button></div>
      <h3 style={{ marginTop: 14 }}>Boletins registrados ({s.avancos.length}) · acumulado {s.quantidadeMedida} {s.unidade} = {pct(s.pctMedido)}</h3>
      {s.avancos.length === 0 ? <Empty>Nenhuma medição ainda.</Empty> : (
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th className="num">Quantidade</th><th className="num">%</th><th>Evidência</th><th>Responsável</th><th /></tr></thead>
          <tbody>{[...s.avancos].reverse().map((a) => <tr key={a.id}><td>{d(a.data)}</td><td>{a.descricao}</td><td className="num">{a.quantidade} {s.unidade}</td><td className="num">{pct(s.quantidadeOrcada > 0 ? a.quantidade / s.quantidadeOrcada : a.quantidade)}</td><td className="small">{a.evidencia ?? '—'}</td><td className="small">{nome(a.responsavel)}</td><td>{pode(usuario, 'editar_etc', s.codigoObra) && <button className="btn sm" onClick={() => { const m = window.prompt('Motivo da exclusão da medição:'); if (m) tentar(() => actions.excluirAvanco(a.id, m), onErro); }}>Excluir</button>}</td></tr>)}</tbody>
        </table>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

export function ServicosTab({ o, onErro, onOk }: { o: Obra360; onErro: (m: string) => void; onOk?: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [edit, setEdit] = useState<Servico | null>(null);
  const [avanco, setAvanco] = useState<ServicoCalc | null>(null);
  const [medir, setMedir] = useState<ServicoCalc | null>(null);
  const podeEditar = pode(usuario, 'editar_etc', o.obra.codigo);
  const tot = (f: (s: ServicoCalc) => number) => o.servicos.reduce((a, s) => a + f(s), 0);
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <span className="muted small">Serviços são a unidade comum de orçamento, cronograma, compra e medição. Vincule cada lançamento ao serviço para o custo aparecer aqui.</span>
        <span className="spacer" style={{ flex: 1 }} />
        {podeEditar && <button className="btn primary sm" onClick={() => setEdit(actions.novoServico(o.obra.codigo))}>+ Serviço</button>}
      </div>
      {o.servicos.length === 0 ? <Empty>Nenhum serviço cadastrado. Com serviços, orçamento, ETC e avanço físico da obra passam a ser calculados a partir deles.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Serviço</th><th>Prazo</th><th>Situação</th><th>Físico</th><th>Receita EIFF</th><th>Faturado</th><th>Custo previsto</th><th>Previsto p/ faturado</th><th>Comprometido</th><th>Pago</th><th>Desvio × faturado</th><th>ETC</th><th>EAC</th><th>Margem proj.</th><th></th></tr></thead>
            <tbody>
              {o.servicos.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.codigo}</b><div className="muted small">{s.etapa}</div></td>
                  <td>{s.nome}<div className="muted small">{s.medicoes.length} evento(s) · {s.lancamentos.length} lançamento(s) · custo {s.origemCustoPrevisto.toLowerCase()}{s.diretoPrevisto || s.comprometidoDireto ? ` · direto cliente ${money(s.comprometidoDireto, true)} de ${money(s.diretoPrevisto, true)}` : ''}</div></td>
                  <td className="small">{d(s.inicioPrevisto)} → {d(s.fimPrevisto)}{s.diasParaFim !== undefined && s.status !== 'Concluído' && <div className={s.diasParaFim < 0 ? 'neg' : 'muted'}>{s.diasParaFim} d</div>}</td>
                  <td><Badge tone={tonePrazo(s.situacaoPrazo)}>{s.situacaoPrazo}</Badge></td>
                  <td><div className="progress" style={{ width: 60 }}><i style={{ width: `${s.pctExecucao * 100}%` }} /></div><span className="small">{pct(s.pctExecucao)}</span><div className="muted small" title={s.origemExecucao}>{s.pctFabricacao !== undefined || s.pctMontagem !== undefined ? `fab ${pct(s.pctFabricacao ?? 0)} · mont ${pct(s.pctMontagem ?? 0)}` : s.origemExecucao === 'Medição de serviço' ? `${s.avancos.length} boletim(ns)` : s.origemExecucao.toLowerCase()}</div></td>
                  <td><Money v={s.precoVenda} compact /></td>
                  <td><Money v={s.faturado} compact /><div className="muted small">{pct(s.pctFaturado)}</div></td>
                  <td><Money v={s.custoPrevisto} compact />{s.custoPrevistoDerivado && <div className="muted small">margem {pct(s.margemAlvoEfetiva)}</div>}</td>
                  <td><Money v={s.custoPrevistoProporcional} compact /></td>
                  <td><Money v={s.custoComprometido} compact /></td>
                  <td><Money v={s.custoPago} compact /></td>
                  <td className={s.desvioVsFaturado > 0.5 ? 'neg' : ''} title="Comprometido − custo previsto proporcional ao faturado. Positivo = gastando à frente do faturamento"><Money v={s.desvioVsFaturado} compact sign /></td>
                  <td><Money v={s.etc} compact />{s.etcDerivado && <div className="muted small">derivado</div>}</td>
                  <td><Money v={s.eac} compact /></td>
                  <td className={`num ${s.margemProjetada < 0 ? 'neg' : ''}`}>{money(s.margemProjetada, true)}<div className="muted small">{pct(s.pctMargem)}</div></td>
                  <td className="actions">{podeEditar && <>{pode(usuario, 'comentar', o.obra.codigo) && <button className="btn sm" onClick={() => setMedir(s)} title="Boletim de medição física">Medir</button>}<button className="btn sm" onClick={() => setAvanco(s)}>Avanço</button><button className="btn sm" onClick={() => setEdit(s)}>Editar</button></>}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={4}>TOTAL</td><td>{pct(o.execucaoFisica)}</td><td><Money v={tot((s) => s.precoVenda)} compact /></td><td><Money v={tot((s) => s.faturado)} compact /></td><td><Money v={tot((s) => s.custoPrevisto)} compact /></td><td><Money v={tot((s) => s.custoPrevistoProporcional)} compact /></td><td><Money v={tot((s) => s.custoComprometido)} compact /></td><td><Money v={tot((s) => s.custoPago)} compact /></td><td><Money v={tot((s) => s.desvioVsFaturado)} compact sign /></td><td><Money v={tot((s) => s.etc)} compact /></td><td><Money v={tot((s) => s.eac)} compact /></td><td><Money v={tot((s) => s.margemProjetada)} compact sign /></td><td /></tr>
            </tbody>
          </table>
          {Math.abs(tot((s) => s.precoVenda) - o.receitaTotal) > 0.5 && <div className="alert info" style={{ marginTop: 8 }}>Soma dos preços de venda dos serviços ({money(tot((s) => s.precoVenda))}) difere da receita total do contrato ({money(o.receitaTotal)}). Ajuste os serviços ou os aditivos.</div>}
        </div>
      )}
      {edit && <ServicoForm servico={edit} onClose={() => setEdit(null)} onErro={onErro} />}
      {avanco && <AvancoForm s={avanco} onClose={() => setAvanco(null)} onErro={onErro} />}
      {medir && <MedirForm s={ds.servicos.some((x) => x.id === medir.id) ? o.servicos.find((x) => x.id === medir.id) ?? medir : medir} onClose={() => setMedir(null)} onErro={onErro} onOk={onOk ?? (() => undefined)} />}
      <span hidden>{ds.params.dataBase}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Demandas (check-list)
// ---------------------------------------------------------------------------
function DemandaForm({ demanda, onClose, onErro }: { demanda: Demanda; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [dm, setDm] = useState<Demanda>(demanda);
  const up = (p: Partial<Demanda>) => setDm({ ...dm, ...p });
  return (
    <Modal title={dm.titulo ? `Demanda · ${dm.titulo}` : 'Nova demanda'} onClose={onClose}>
      <div className="form">
        <Field label="Título" req full><Input value={dm.titulo} onChange={(e) => up({ titulo: e.target.value })} placeholder="ex.: Diário de obra e fotos do dia" /></Field>
        <Field label="Periodicidade"><Select value={dm.periodicidade} onChange={(v) => up({ periodicidade: v as Periodicidade })} options={['Diária', 'Semanal', 'Mensal', 'Única']} /></Field>
        <Field label="Responsável" req><Select value={dm.responsavel} onChange={(v) => up({ responsavel: v })} options={ds.usuarios.map((u) => ({ value: u.id, label: u.nome }))} /></Field>
        {dm.periodicidade === 'Única' && <Field label="Prazo" req><Input type="date" value={dm.prazo ?? ''} onChange={(e) => up({ prazo: e.target.value || undefined })} /></Field>}
        <Field label="Serviço"><Select value={dm.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.codigoObra === dm.codigoObra && s.ativo).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="— obra toda —" /></Field>
        <Field label="Ativa"><Select value={dm.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Descrição / critério de conclusão" full><textarea rows={2} value={dm.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarDemanda(dm), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

const SUGESTOES: { titulo: string; periodicidade: Periodicidade }[] = [
  { titulo: 'Diário de obra, efetivo e fotos', periodicidade: 'Diária' },
  { titulo: 'DDS e verificação de EPI/EPC', periodicidade: 'Diária' },
  { titulo: 'Conferência de recebimento de materiais', periodicidade: 'Diária' },
  { titulo: 'Programação da semana: fabricação, transporte e montagem', periodicidade: 'Semanal' },
  { titulo: 'Reunião com cliente / fiscalização', periodicidade: 'Semanal' },
  { titulo: 'Atualizar avanço físico e ETC dos serviços', periodicidade: 'Semanal' },
  { titulo: 'Medição e boletim para faturamento', periodicidade: 'Mensal' },
  { titulo: 'Revisão de orçamento × realizado e margem', periodicidade: 'Mensal' },
  { titulo: 'Checagem de ART, licenças e seguros', periodicidade: 'Mensal' },
];

export function DemandasTab({ o, onErro }: { o: Obra360; onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const [edit, setEdit] = useState<Demanda | null>(null);
  const [filtro, setFiltro] = useState<Periodicidade | 'Todas'>('Todas');
  const podeEditar = pode(usuario, 'comentar', o.obra.codigo);
  const grupos: Periodicidade[] = ['Diária', 'Semanal', 'Mensal', 'Única'];
  const nome = (id: string) => ds.usuarios.find((u) => u.id === id)?.nome ?? id;
  const criarSugeridas = () => tentar(() => { for (const s of SUGESTOES) if (!ds.demandas.some((x) => x.codigoObra === o.obra.codigo && x.titulo === s.titulo)) actions.salvarDemanda({ ...actions.novaDemanda(o.obra.codigo), titulo: s.titulo, periodicidade: s.periodicidade }); }, onErro);
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        {(['Todas', ...grupos] as const).map((g) => <button key={g} className={`btn sm ${filtro === g ? 'primary' : ''}`} onClick={() => setFiltro(g)}>{g}</button>)}
        <span style={{ flex: 1 }} />
        {podeEditar && o.demandas.length === 0 && <button className="btn sm" onClick={criarSugeridas}>Criar check-list padrão</button>}
        {podeEditar && <button className="btn primary sm" onClick={() => setEdit(actions.novaDemanda(o.obra.codigo))}>+ Demanda</button>}
      </div>
      {o.demandas.length === 0 ? <Empty>Sem demandas. Crie o check-list padrão (diário, semanal e mensal) e ajuste ao seu processo.</Empty> : grupos.filter((g) => filtro === 'Todas' || g === filtro).map((g) => {
        const lista = o.demandas.filter((x) => x.periodicidade === g);
        if (!lista.length) return null;
        return (
          <div key={g} style={{ marginBottom: 14 }}>
            <h3>{g} · {lista.filter((x) => x.status === 'Concluída').length}/{lista.length} no período {g === 'Única' ? '' : `(até ${d(lista[0].prazoPeriodo)})`}</h3>
            <table>
              <tbody>
                {lista.map((dm: DemandaCalc) => (
                  <tr key={dm.id}>
                    <td style={{ width: 36 }}><input type="checkbox" checked={dm.concluidaNoPeriodo} disabled={!podeEditar} onChange={(e) => tentar(() => actions.concluirDemanda(dm.id, e.target.checked), onErro)} /></td>
                    <td><span style={dm.concluidaNoPeriodo ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{dm.titulo}</span>{dm.descricao && <div className="muted small">{dm.descricao}</div>}{dm.servicoId && <div className="muted small">{ds.servicos.find((s) => s.id === dm.servicoId)?.nome}</div>}</td>
                    <td className="small">{nome(dm.responsavel)}</td>
                    <td className="small">{g === 'Única' ? d(dm.prazo) : `última: ${d(dm.ultimaConclusao)}`}</td>
                    <td>{g !== 'Única' && <span className="small muted" title="conclusões / períodos desde a criação">aderência {pct(dm.aderencia)}</span>}</td>
                    <td><Badge tone={dm.status === 'Concluída' ? 'ok' : dm.status === 'Atrasada' ? 'bad' : 'warn'}>{dm.status}</Badge></td>
                    <td>{podeEditar && <button className="btn sm" onClick={() => setEdit(dm)}>Editar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {edit && <DemandaForm demanda={edit} onClose={() => setEdit(null)} onErro={onErro} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Producao: linha de fabricacao / linha de montagem (kanban por etapa)
// ---------------------------------------------------------------------------
function OrdemForm({ ordem, onClose, onErro }: { ordem: OrdemProducao; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [o, setO] = useState<OrdemProducao>(ordem);
  const up = (p: Partial<OrdemProducao>) => setO({ ...o, ...p });
  return (
    <Modal title={`${o.tipo} · ${o.codigo}`} onClose={onClose}>
      <div className="form">
        <Field label="Código" req><Input value={o.codigo} onChange={(e) => up({ codigo: e.target.value.toUpperCase() })} /></Field>
        <Field label="Prioridade"><Select value={o.prioridade} onChange={(v) => up({ prioridade: v as OrdemProducao['prioridade'] })} options={['Alta', 'Normal', 'Baixa']} /></Field>
        <Field label="Data de necessidade" hint={o.tipo === 'Fabricação' ? 'Quando precisa estar expedida' : 'Quando precisa estar montada'}><Input type="date" value={o.dataNecessidade ?? ''} onChange={(e) => up({ dataNecessidade: e.target.value || undefined })} /></Field>
        <Field label="Descrição (lote, peça, eixo, módulo)" req full><Input value={o.descricao} onChange={(e) => up({ descricao: e.target.value })} /></Field>
        <Field label="Quantidade" req><NumberInput value={o.quantidade} onChange={(v) => up({ quantidade: v })} /></Field>
        <Field label="Unidade"><Select value={o.unidade} onChange={(v) => up({ unidade: v })} options={['t', 'kg', 'pç', 'm²', 'm', 'un']} /></Field>
        <Field label="Serviço"><Select value={o.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.codigoObra === o.codigoObra && s.ativo).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
        <Field label="Observações" full><textarea rows={2} value={o.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
        <Field label="Etapas da linha" full>
          <div className="small">{o.etapas.map((e, i) => <span key={i} className="badge muted" style={{ marginRight: 4 }}>{i + 1}. {e.nome}</span>)}</div>
        </Field>
      </div>
      <div className="foot">
        {ds.ordens.some((x) => x.id === o.id) && !o.cancelada && <button className="btn danger" onClick={() => tentar(() => actions.salvarOrdem({ ...o, cancelada: true }), onErro, onClose)}>Cancelar ordem</button>}
        <button className="btn" onClick={onClose}>Fechar</button>
        <button className="btn primary" onClick={() => tentar(() => actions.salvarOrdem(o), onErro, onClose)}>Salvar</button>
      </div>
    </Modal>
  );
}

function OrdemCard({ o, onEditar, onAvancar, podeEditar }: { o: OrdemCalc; onEditar: () => void; onAvancar: (idx: number, status: StatusEtapa) => void; podeEditar: boolean }) {
  const idx = o.etapaAtualIdx;
  const etapa = idx >= 0 ? o.etapas[idx] : undefined;
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8, borderLeft: `3px solid ${o.atrasada ? 'var(--bad)' : o.prioridade === 'Alta' ? 'var(--warn)' : 'var(--primary-2)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b className="small">{o.codigo}</b><span className="small">{o.quantidade} {o.unidade}</span></div>
      <div className="small">{o.descricao}</div>
      <div className="muted small">{o.dataNecessidade ? `necessidade ${d(o.dataNecessidade)}` : 'sem data'}{o.diasParaNecessidade !== undefined && o.status !== 'Concluída' && <span className={o.atrasada ? 'neg' : ''}> · {o.diasParaNecessidade} d</span>} · {o.prioridade}</div>
      <div className="progress" style={{ margin: '6px 0' }}><i style={{ width: `${o.pctConcluido * 100}%` }} /></div>
      {podeEditar && (
        <div className="actions">
          {etapa && etapa.status !== 'Em andamento' && <button className="btn sm" onClick={() => onAvancar(idx, 'Em andamento')}>Iniciar</button>}
          {etapa && <button className="btn sm primary" onClick={() => onAvancar(idx, 'Concluída')}>Concluir etapa</button>}
          {idx > 0 && <button className="btn sm" title="Reabrir etapa anterior" onClick={() => onAvancar(idx - 1, 'Em andamento')}>↩</button>}
          <button className="btn sm" onClick={onEditar}>…</button>
        </div>
      )}
    </div>
  );
}

export function ProducaoTab({ o, tipo, onErro }: { o: Obra360; tipo: TipoOrdem; onErro: (m: string) => void }) {
  const { usuario } = useStore();
  const [edit, setEdit] = useState<OrdemProducao | null>(null);
  const r = tipo === 'Fabricação' ? o.fabricacao : o.montagem;
  const podeEditar = pode(usuario, 'editar_lancamento', o.obra.codigo);
  const etapas = tipo === 'Fabricação' ? ETAPAS_FABRICACAO : ETAPAS_MONTAGEM;
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <span className="small muted">{tipo === 'Fabricação' ? 'Linha de fabricação' : 'Linha de montagem'}: {etapas.join(' → ')}. {r.ordens.length} ordem(ns) · {r.emAndamento} em andamento · {r.atrasadas} atrasada(s) · {r.quantidadeConcluida}/{r.quantidadeTotal} concluído</span>
        <span style={{ flex: 1 }} />
        {podeEditar && <button className="btn primary sm" onClick={() => setEdit(actions.novaOrdem(o.obra.codigo, tipo))}>+ Ordem de {tipo.toLowerCase()}</button>}
      </div>
      <div className="table-wrap">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${r.porEtapa.length}, minmax(180px, 1fr))`, gap: 10, minWidth: r.porEtapa.length * 190 }}>
          {r.porEtapa.map((col) => (
            <div key={col.nome} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 8, border: '1px solid var(--border)' }}>
              <h3 style={{ marginBottom: 6 }}>{col.nome} <span className="muted">({col.ordens.length}{col.quantidade ? ` · ${col.quantidade}` : ''})</span></h3>
              {col.ordens.map((ord) => <OrdemCard key={ord.id} o={ord} podeEditar={podeEditar} onEditar={() => setEdit(ord)} onAvancar={(idx, st) => tentar(() => actions.avancarEtapa(ord.id, idx, st), onErro)} />)}
            </div>
          ))}
        </div>
      </div>
      {edit && <OrdemForm ordem={edit} onClose={() => setEdit(null)} onErro={onErro} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Medicoes / cronograma fisico-financeiro
// ---------------------------------------------------------------------------
const STATUS_MED: StatusMedicao[] = ['Pendente', 'Medido', 'Faturado', 'Recebido', 'Cancelado'];
const toneMed = (s: string, atrasada: boolean): Tone => (s === 'Recebido' ? 'ok' : s === 'Faturado' ? 'ok' : s === 'Medido' ? 'info' : s === 'Cancelado' ? 'muted' : atrasada ? 'bad' : 'warn');

function MedicaoForm({ medicao, onClose, onErro }: { medicao: Medicao; onClose: () => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [m, setM] = useState<Medicao>(medicao);
  const up = (p: Partial<Medicao>) => setM({ ...m, ...p });
  return (
    <Modal title={`Evento ${m.numero}`} onClose={onClose} wide>
      <div className="form">
        <Field label="Número" req><Input value={m.numero} onChange={(e) => up({ numero: e.target.value.toUpperCase() })} /></Field>
        <Field label="Mês contratual"><NumberInput value={m.mes} onChange={(v) => up({ mes: v })} /></Field>
        <Field label="Data prevista"><Input type="date" value={m.dataPrevista ?? ''} onChange={(e) => up({ dataPrevista: e.target.value || undefined })} /></Field>
        <Field label="Serviço"><Select value={m.servicoId ?? ''} onChange={(v) => up({ servicoId: v || undefined })} options={ds.servicos.filter((s) => s.codigoObra === m.codigoObra && s.ativo).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" /></Field>
        <Field label="Etapa do orçamento"><Input value={m.etapa} onChange={(e) => up({ etapa: e.target.value })} /></Field>
        <Field label="Evento" req full><Input value={m.evento} onChange={(e) => up({ evento: e.target.value })} /></Field>
        <Field label="Escopo / atividades" full><textarea rows={2} value={m.escopo} onChange={(e) => up({ escopo: e.target.value })} /></Field>
        <Field label="Critério de medição / aceite" full><textarea rows={2} value={m.criterio} onChange={(e) => up({ criterio: e.target.value })} /></Field>
        <Field label="Documentos obrigatórios" full><textarea rows={2} value={m.documentos} onChange={(e) => up({ documentos: e.target.value })} /></Field>
        <Field label="Valor bruto do evento" req><NumberInput value={m.valorBruto} onChange={(v) => up({ valorBruto: v })} /></Field>
        <Field label="Faturamento direto (cliente)"><NumberInput value={m.faturamentoDireto} onChange={(v) => up({ faturamentoDireto: v, faturamentoConstrutora: Math.max(0, m.valorBruto - v) })} /></Field>
        <Field label="Faturamento construtora (EIFF)"><NumberInput value={m.faturamentoConstrutora} onChange={(v) => up({ faturamentoConstrutora: v, faturamentoDireto: Math.max(0, m.valorBruto - v) })} /></Field>
        <Field label="Retenção contratual"><NumberInput value={m.retencao} onChange={(v) => up({ retencao: v })} /></Field>
        <Field label="Tipo de medição"><Input value={m.tipoMedicao} onChange={(e) => up({ tipoMedicao: e.target.value })} /></Field>
        <Field label="Responsável pela aprovação"><Input value={m.responsavelAprovacao} onChange={(e) => up({ responsavelAprovacao: e.target.value })} /></Field>
        <Field label="% evolução planejada"><NumberInput value={Math.round(m.pctEvolucaoPlanejada * 10000) / 100} onChange={(v) => up({ pctEvolucaoPlanejada: v / 100 })} /></Field>
        <Field label="Observações" full><textarea rows={2} value={m.observacoes} onChange={(e) => up({ observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarMedicao(m), onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

function RegistrarMedicaoForm({ m, onClose, onErro, onOk }: { m: MedicaoCalc; onClose: () => void; onErro: (m: string) => void; onOk: (msg: string) => void }) {
  const { ds } = useStore();
  const [f, setF] = useState({ status: (m.status === 'Pendente' ? 'Medido' : m.status) as StatusMedicao, dataMedicao: m.dataMedicao ?? ds.params.dataBase, valorMedido: m.valorMedido ?? m.faturamentoConstrutora, lancamentoId: m.lancamentoId ?? '', gerarRecebivel: !m.lancamentoId && m.faturamentoConstrutora > 0, vencimento: '', observacoes: m.observacoes });
  const pctRet = m.valorBruto > 0 ? m.retencao / m.valorBruto : 0;
  const liquido = f.valorMedido * (1 - pctRet);
  const recebiveis = ds.lancamentos.filter((l) => l.codigoObra === m.codigoObra && l.status !== 'Cancelado' && ds.planoContas.find((p) => p.categoria === l.categoria)?.tipo === 'Entrada');
  return (
    <Modal title={`Registrar medição · ${m.numero} ${m.evento}`} onClose={onClose}>
      <div className="alert info">Parte da construtora prevista {money(m.faturamentoConstrutora)} · retenção {Math.round(pctRet * 100)}% · líquido a receber <b>{money(liquido)}</b>. Faturamento direto do cliente ({money(m.faturamentoDireto)}) não entra no caixa da EIFF.</div>
      <div className="form">
        <Field label="Status"><Select value={f.status} onChange={(v) => setF({ ...f, status: v as StatusMedicao })} options={STATUS_MED} /></Field>
        <Field label="Data da medição" req><Input type="date" value={f.dataMedicao} onChange={(e) => setF({ ...f, dataMedicao: e.target.value })} /></Field>
        <Field label="Valor medido (parte construtora, bruto)"><NumberInput value={f.valorMedido} onChange={(v) => setF({ ...f, valorMedido: v })} /></Field>
        <Field label="Recebível" hint="Vincule um lançamento existente ou gere um novo"><Select value={f.lancamentoId} onChange={(v) => setF({ ...f, lancamentoId: v, gerarRecebivel: !v && f.gerarRecebivel })} options={recebiveis.map((l) => ({ value: l.id, label: `${l.id} · ${l.descricao} · ${money(l.valorBruto)}` }))} allowEmpty="— nenhum —" /></Field>
        {!f.lancamentoId && <Field label="Gerar recebível"><Select value={f.gerarRecebivel ? 'Sim' : 'Não'} onChange={(v) => setF({ ...f, gerarRecebivel: v === 'Sim' })} options={['Sim', 'Não']} /></Field>}
        {!f.lancamentoId && f.gerarRecebivel && <Field label="Vencimento do recebível" hint="Vazio = 30 dias após a medição"><Input type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></Field>}
        <Field label="Observações" full><textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.registrarMedicao(m.id, { status: f.status, dataMedicao: f.dataMedicao, valorMedido: f.valorMedido, lancamentoId: f.lancamentoId || undefined, gerarRecebivel: f.gerarRecebivel, vencimento: f.vencimento || undefined, observacoes: f.observacoes }); onOk(r.lancamentoId ? `${m.numero} registrado; recebível ${r.lancamentoId}.` : `${m.numero} registrado.`); }, onErro, onClose)}>Registrar</button></div>
    </Modal>
  );
}

export function MedicoesTab({ o, onErro, onOk }: { o: Obra360; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { usuario } = useStore();
  const [edit, setEdit] = useState<Medicao | null>(null);
  const [reg, setReg] = useState<MedicaoCalc | null>(null);
  const r = o.medicoes;
  const podeEditar = pode(usuario, 'editar_obra', o.obra.codigo);
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">Contrato (bruto)</div><div className="value">{money(r.valorBruto, true)}</div><div className="hint">direto cliente {money(r.faturamentoDireto, true)} · construtora {money(r.faturamentoConstrutora, true)}</div></div>
        <div className="kpi"><div className="label">Receita líquida EIFF</div><div className="value">{money(r.liquidoConstrutora, true)}</div><div className="hint">construtora − retenção {money(r.retencaoConstrutora, true)}</div></div>
        <div className={`kpi ${r.atrasadas ? 'bad' : ''}`}><div className="label">Faturado</div><div className="value">{money(r.faturado, true)} · {pct(r.pctFaturado)}</div><div className="hint">a faturar {money(r.aFaturar, true)} · {r.pendentes} evento(s) pendente(s), {r.atrasadas} atrasado(s)</div></div>
        <div className="kpi"><div className="label">Retenção acumulada a receber</div><div className="value">{money(r.retencaoAcumulada, true)}</div><div className="hint">liberação no encerramento, conforme contrato</div></div>
      </div>
      <div className="actions" style={{ marginBottom: 8 }}>
        <span className="muted small">Eventos do cronograma físico-financeiro. "Registrar" muda o status e gera ou vincula o recebível da parte da construtora.</span>
        <span style={{ flex: 1 }} />
        {podeEditar && <button className="btn primary sm" onClick={() => setEdit(actions.novaMedicao(o.obra.codigo))}>+ Evento</button>}
      </div>
      {r.medicoes.length === 0 ? <Empty>Sem eventos. Cadastre os marcos do cronograma físico-financeiro do contrato.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nº</th><th>Mês</th><th>Evento</th><th>Serviço</th><th>Previsto</th><th>Bruto</th><th>Direto</th><th>Construtora</th><th>Líquido EIFF</th><th>Tipo</th><th>Status</th><th>Medição</th><th>Recebível</th><th /></tr></thead>
            <tbody>
              {[...r.medicoes].sort((a, b) => a.mes - b.mes || a.numero.localeCompare(b.numero)).map((m) => (
                <tr key={m.id}>
                  <td><b>{m.numero}</b></td><td className="num">{m.mes}</td>
                  <td>{m.evento}<div className="muted small">{m.etapa}</div></td>
                  <td className="small">{o.servicos.find((s) => s.id === m.servicoId)?.codigo ?? '—'}</td>
                  <td className={m.atrasada ? 'neg' : ''}>{d(m.dataPrevista)}</td>
                  <td><Money v={m.valorBruto} compact /></td><td><Money v={m.faturamentoDireto} compact /></td><td><Money v={m.faturamentoConstrutora} compact /></td>
                  <td><b><Money v={m.valorLiquidoConstrutora} compact /></b></td>
                  <td className="small">{m.tipoMedicao}</td>
                  <td><Badge tone={toneMed(m.status, m.atrasada)}>{m.status}{m.atrasada ? ' · atrasada' : ''}</Badge></td>
                  <td className="small">{m.dataMedicao ? d(m.dataMedicao) : '—'}{m.valorMedido !== undefined && m.valorMedido !== m.faturamentoConstrutora && <div className="muted">{money(m.valorMedido, true)}</div>}</td>
                  <td className="small">{m.lancamentoId ? <Link to={`/lancamentos/${m.lancamentoId}`}>{m.lancamentoId}</Link> : '—'}</td>
                  <td className="actions">{podeEditar && m.status !== 'Cancelado' && <button className="btn sm primary" onClick={() => setReg(m)}>Registrar</button>}{podeEditar && <button className="btn sm" onClick={() => setEdit(m)}>…</button>}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={5}>TOTAL</td><td><Money v={r.valorBruto} compact /></td><td><Money v={r.faturamentoDireto} compact /></td><td><Money v={r.faturamentoConstrutora} compact /></td><td><Money v={r.liquidoConstrutora} compact /></td><td colSpan={5} /></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 14 }}>Curva mensal da parte da construtora (líquida)</h3>
          <div className="table-wrap"><table><thead><tr><th>Mês</th>{r.porMes.map((x) => <th key={x.mes} className="num">M{String(x.mes).padStart(2, '0')}<div className="muted small">{d(x.dataPrevista)}</div></th>)}</tr></thead>
            <tbody>
              <tr><td>Previsto</td>{r.porMes.map((x) => <td key={x.mes}><Money v={x.liquido} compact /></td>)}</tr>
              <tr><td>Faturado</td>{r.porMes.map((x) => <td key={x.mes}><Money v={x.faturado || undefined} compact /></td>)}</tr>
            </tbody></table></div>
        </div>
      )}
      {edit && <MedicaoForm medicao={edit} onClose={() => setEdit(null)} onErro={onErro} />}
      {reg && <RegistrarMedicaoForm m={reg} onClose={() => setReg(null)} onErro={onErro} onOk={onOk} />}
    </>
  );
}

export { Link };
