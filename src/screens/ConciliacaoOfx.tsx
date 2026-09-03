import React, { useMemo, useState } from 'react';
import { BANCOS, decodificarOfx, parseOfx, sugerirCategoria, type OfxExtrato } from '../core/ofx';
import type { TransacaoBancaria } from '../core/types';
import { actions, obrasVisiveis, useStore } from '../data/store';
import { Field, Input, Modal, Money, Select, money, tentar } from '../ui/components';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');

/** Importacao de extrato OFX: arquivo ou texto colado, pre-visualizacao e deduplicacao por FITID. */
export function ImportarOfxModal({ onClose, onOk, onErro }: { onClose: () => void; onOk: (m: string) => void; onErro: (m: string) => void }) {
  const { ds } = useStore();
  const [conta, setConta] = useState(ds.contas.find((c) => c.ativa)?.instituicao ?? '');
  const [ext, setExt] = useState<OfxExtrato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState('');

  const carregar = (t: string, nome = '') => {
    try {
      const e = parseOfx(t);
      setExt(e);
      setErro(null);
      setNomeArquivo(nome);
      // tenta reconhecer a conta pelo numero
      if (e.conta) { const c = ds.contas.find((x) => x.ativa && e.conta && (x.conta.replace(/\D/g, '').includes(e.conta.replace(/\D/g, '')) || e.conta.replace(/\D/g, '').includes(x.conta.replace(/\D/g, '')) && x.conta.replace(/\D/g, '').length > 3)); if (c) setConta(c.instituicao); }
    } catch (x) {
      setExt(null);
      setErro((x as Error).message);
    }
  };
  const onFile = (f?: File) => {
    if (!f) return;
    f.arrayBuffer().then((b) => carregar(decodificarOfx(b), f.name)).catch((x) => setErro((x as Error).message));
  };
  const existentes = useMemo(() => new Set(ds.transacoes.filter((t) => t.idExterno && t.conta === conta).map((t) => t.idExterno!)), [ds.transacoes, conta]);
  const novas = ext ? ext.transacoes.filter((t) => !existentes.has(t.fitid)) : [];
  const creditos = novas.filter((t) => t.valor > 0).reduce((a, t) => a + t.valor, 0);
  const debitos = novas.filter((t) => t.valor < 0).reduce((a, t) => a - t.valor, 0);
  const importar = () =>
    tentar(
      () => {
        const r = actions.importarTransacoes(conta, novas.map((t) => ({ data: t.data, historico: t.memo || t.tipo, documento: t.documento ?? '', debito: t.valor < 0 ? -t.valor : 0, credito: t.valor > 0 ? t.valor : 0, idExterno: t.fitid })));
        onOk(`${r.importadas} transação(ões) importada(s) para ${conta}${r.duplicadas ? `, ${r.duplicadas} já existia(m)` : ''}.`);
      },
      onErro,
      onClose,
    );

  return (
    <Modal title="Importar extrato OFX" onClose={onClose}>
      <p className="small muted">Baixe o extrato no internet banking no formato OFX (também chamado Money/Quicken) e selecione o arquivo. Transações repetidas são ignoradas pelo identificador do banco, então pode importar períodos sobrepostos sem duplicar.</p>
      <div className="form">
        <Field label="Arquivo .ofx" full><input type="file" accept=".ofx,.OFX,.qfx,.xml,.txt" onChange={(e) => onFile(e.target.files?.[0])} /></Field>
        <Field label="ou cole o conteúdo do OFX" full><textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={() => texto.trim() && carregar(texto)} placeholder="OFXHEADER:100 ..." /></Field>
        <Field label="Conta financeira de destino" req><Select value={conta} onChange={setConta} options={ds.contas.filter((c) => c.ativa).map((c) => c.instituicao)} /></Field>
      </div>
      {erro && <div className="alert bad" style={{ marginTop: 10 }}>{erro}</div>}
      {ext && (
        <div style={{ marginTop: 12 }}>
          <dl className="kv">
            <dt>Arquivo</dt><dd>{nomeArquivo || 'texto colado'} · banco {ext.banco ? `${ext.banco} ${BANCOS[ext.banco] ?? ''}` : '—'} · ag. {ext.agencia ?? '—'} · conta {ext.conta ?? '—'}</dd>
            <dt>Período</dt><dd>{d(ext.inicio)} a {d(ext.fim)}</dd>
            <dt>Transações no arquivo</dt><dd>{ext.transacoes.length} · <b>{novas.length} nova(s)</b> · {ext.transacoes.length - novas.length} já importada(s)</dd>
            <dt>Novas: créditos / débitos</dt><dd><Money v={creditos} /> / <Money v={debitos} /></dd>
            {ext.saldoFinal !== undefined && <><dt>Saldo no extrato</dt><dd><Money v={ext.saldoFinal} /> em {d(ext.dataSaldo)} <span className="muted small">(compare com a Posição diária após conciliar)</span></dd></>}
          </dl>
          {novas.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
              <table><thead><tr><th>Data</th><th>Histórico</th><th>Valor</th><th>Categoria sugerida</th></tr></thead><tbody>
                {novas.slice(0, 50).map((t) => <tr key={t.fitid}><td>{d(t.data)}</td><td className="small">{t.memo}</td><td><Money v={t.valor} sign /></td><td className="small muted">{sugerirCategoria(t.memo, t.valor > 0, ds.planoContas)}</td></tr>)}
              </tbody></table>
              {novas.length > 50 && <div className="muted small">… e mais {novas.length - 50}</div>}
            </div>
          )}
        </div>
      )}
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!ext || novas.length === 0 || !conta} onClick={importar}>Importar {novas.length ? `${novas.length} transação(ões)` : ''}</button>
      </div>
    </Modal>
  );
}

/** Cria um lancamento realizado e conciliado a partir de uma transacao bancaria sem titulo. */
export function LancarTransacaoModal({ t, onClose, onOk, onErro }: { t: TransacaoBancaria; onClose: () => void; onOk: (m: string) => void; onErro: (m: string) => void }) {
  const { ds, usuario } = useStore();
  const movimento = t.credito - t.debito;
  const entrada = movimento > 0;
  const [f, setF] = useState({
    categoria: sugerirCategoria(t.historico, entrada, ds.planoContas), contraparte: '', descricao: t.historico, codigoObra: '', servicoId: '', documento: t.documento || t.idExterno || '', observacoes: '',
  });
  const categorias = ds.planoContas.filter((p) => p.ativa && p.tipo === (entrada ? 'Entrada' : 'Saída'));
  const plano = ds.planoContas.find((p) => p.categoria === f.categoria);
  const exigeObra = plano && (plano.grupoFluxo === 'Custos Diretos de Obras' || plano.grupoDre === 'Receita Operacional');
  const contrapartes = [...new Set([...ds.lancamentos.map((x) => x.contraparte), ...ds.obras.map((o) => o.cliente)])].filter(Boolean).sort();
  return (
    <Modal title={`Lançar ${entrada ? 'recebimento' : 'pagamento'} do extrato · ${money(Math.abs(movimento))}`} onClose={onClose}>
      <div className="alert info">{d(t.data)} · {t.historico} · conta {t.conta}. O lançamento nasce <b>realizado, liquidado e conciliado</b> com esta transação; não passa por aprovação porque o movimento bancário já aconteceu.</div>
      <div className="form">
        <Field label="Categoria" req><Select value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} options={categorias.map((p) => p.categoria)} /></Field>
        <Field label="Contraparte" req><Input list="cps-ofx" value={f.contraparte} onChange={(e) => setF({ ...f, contraparte: e.target.value })} placeholder="banco, fornecedor, cliente" /><datalist id="cps-ofx">{contrapartes.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Descrição" req full><Input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
        <Field label="Obra" req={!!exigeObra}><Select value={f.codigoObra} onChange={(v) => setF({ ...f, codigoObra: v, servicoId: '' })} options={obrasVisiveis(usuario, ds.obras).map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} allowEmpty="— sem obra —" /></Field>
        <Field label="Serviço"><Select value={f.servicoId} onChange={(v) => setF({ ...f, servicoId: v })} options={ds.servicos.filter((s) => s.ativo && s.codigoObra === f.codigoObra).map((s) => ({ value: s.id, label: `${s.codigo} · ${s.nome}` }))} allowEmpty="—" disabled={!f.codigoObra} /></Field>
        <Field label="Documento"><Input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></Field>
        <Field label="Observações" full><Input value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
      </div>
      <div className="foot">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!f.categoria || !f.contraparte.trim() || !f.descricao.trim()} onClick={() => tentar(() => { const l = actions.lancarTransacao(t.id, { ...f, codigoObra: f.codigoObra || undefined, servicoId: f.servicoId || undefined, observacoes: f.observacoes || undefined }); onOk(`${l.id} criado, liquidado e conciliado.`); }, onErro, onClose)}>Lançar e conciliar</button>
      </div>
    </Modal>
  );
}
