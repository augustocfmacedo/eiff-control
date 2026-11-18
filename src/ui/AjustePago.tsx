// Ajuste do valor pago/recebido de um título já liquidado (actions.ajustarValorPago): valor real, data, como tratar a
// diferença (corrigir o valor do título, multa/juros ou desconto) e motivo. Usado no detalhe do lançamento e no celular.
import { useState } from 'react';
import type { Lancamento } from '../core/types';
import { actions } from '../data/store';
import { Field, Input, Modal, MoedaInput, money } from './components';

export function AjustePago({ lancamento: l, tipo, valorPagoAtual, dataAtual, onClose, aviso }: { lancamento: Lancamento; tipo: string; valorPagoAtual: number; dataAtual?: string; onClose: () => void; aviso: (m: string) => void }) {
  const liquido = Math.round((l.valorBruto - l.retencoes - l.desconto + l.multaJuros) * 100) / 100;
  const [valor, setValor] = useState(valorPagoAtual);
  const [data, setData] = useState(dataAtual ?? '');
  const [tratamento, setTratamento] = useState<'valor' | 'juros' | 'desconto'>('valor');
  const [motivo, setMotivo] = useState('');
  const dif = Math.round((valor - liquido) * 100) / 100;
  const entrada = tipo === 'Entrada';
  const opcoes = [
    { id: 'valor' as const, rotulo: 'Corrigir o valor do título', ok: true },
    { id: 'juros' as const, rotulo: entrada ? 'Diferença como juros/multa recebidos' : 'Diferença como juros/multa pagos', ok: dif > 0 },
    { id: 'desconto' as const, rotulo: entrada ? 'Diferença como desconto concedido' : 'Diferença como desconto obtido', ok: dif < 0 },
  ];
  const escolhido = opcoes.find((o) => o.id === tratamento)?.ok ? tratamento : 'valor';
  const salvar = () => {
    try { actions.ajustarValorPago(l.id, { valorPago: valor, tratamento: escolhido, motivo, data: data || undefined }); aviso(`${l.id}: valor pago ajustado para ${money(valor)}.`); onClose(); }
    catch (e) { aviso((e as Error).message); }
  };
  return (
    <Modal title={`Ajustar valor pago · ${l.id}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Registrado como pago: <b>{money(valorPagoAtual)}</b>{dataAtual ? ` em ${dataAtual.split('-').reverse().join('/')}` : ''} · líquido previsto {money(liquido)}. Use para alinhar com o valor que realmente saiu ou entrou (tarifa, juros, desconto, arredondamento).</p>
      <Field label="Valor pago real" req><MoedaInput autoFocus value={valor} onChange={setValor} /></Field>
      <Field label="Data do pagamento"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
      {dif !== 0 && (
        <fieldset className="ajuste-opcoes">
          <legend className="small">Diferença de {dif > 0 ? '+' : '−'}{money(Math.abs(dif))} em relação ao previsto</legend>
          {opcoes.filter((o) => o.ok).map((o) => (
            <label key={o.id} className="small"><input type="radio" name="tratamento" checked={escolhido === o.id} onChange={() => setTratamento(o.id)} /> {o.rotulo}</label>
          ))}
        </fieldset>
      )}
      <Field label="Motivo do ajuste" req full><Input value={motivo} maxLength={300} placeholder="ex.: banco cobrou tarifa de R$ 2,50; fornecedor deu desconto" onChange={(e) => setMotivo(e.target.value)} /></Field>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!(valor > 0) || motivo.trim().length < 3} onClick={salvar}>Salvar ajuste</button></div>
    </Modal>
  );
}
