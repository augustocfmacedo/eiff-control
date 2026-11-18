// Forma e dados de pagamento na tela: campos para preencher (pedido ao Diretor Financeiro e formulário do lançamento) e o
// quadro "Dados para pagamento" no detalhe (Lançamentos e Contas a pagar), com botão de copiar a chave PIX, a linha do
// boleto e os dados da conta. Regras em src/core/pagamento.ts.
import { useState } from 'react';
import { FORMAS_PAGAMENTO, TIPOS_CHAVE_PIX, TIPOS_CONTA, linhasPagamento, type DadosPagamento, type FormaPagamento } from '../core/pagamento';
import { Field, Input, Select } from './components';

const DICA_CHAVE: Record<string, string> = { CPF: 'só números', CNPJ: 'só números', 'E-mail': 'nome@empresa.com.br', Telefone: 'DDD + número', 'Aleatória': '0000aaaa-…' };

/** Campos da forma de pagamento; `exigir` = a forma é obrigatória (pedido da equipe). Os erros vêm de validarDadosPagamento. */
export function CamposPagamento({ forma, dados, onChange, exigir = false, erros = [] }: {
  forma?: FormaPagamento; dados?: DadosPagamento; exigir?: boolean; erros?: string[];
  onChange: (forma: FormaPagamento | undefined, dados: DadosPagamento) => void;
}) {
  const d = dados ?? {};
  const up = (p: Partial<DadosPagamento>) => onChange(forma, { ...d, ...p });
  const erro = (re: RegExp) => erros.find((e) => re.test(e));
  return (
    <>
      <Field label="Forma de pagamento" req={exigir} erro={exigir && !forma ? undefined : erro(/Forma de pagamento/)}>
        <Select value={forma ?? ''} onChange={(v) => onChange((v || undefined) as FormaPagamento | undefined, d)} options={[...FORMAS_PAGAMENTO]} allowEmpty={exigir ? '— escolha —' : '— não informada —'} />
      </Field>
      {forma === 'PIX' && <>
        <Field label="Tipo da chave PIX" req erro={erro(/tipo da chave/)}><Select value={d.pixTipo ?? ''} onChange={(v) => up({ pixTipo: (v || undefined) as DadosPagamento['pixTipo'] })} options={[...TIPOS_CHAVE_PIX]} allowEmpty="— escolha —" /></Field>
        <Field label="Chave PIX" req erro={erro(/informe a chave PIX|chave PIX (CPF|CNPJ|e-mail|telefone|aleatória)/)}><Input value={d.pixChave ?? ''} placeholder={DICA_CHAVE[d.pixTipo ?? ''] ?? ''} maxLength={120} onChange={(e) => up({ pixChave: e.target.value })} /></Field>
        <Field label="Favorecido" hint="Nome que aparece no PIX (confere antes de pagar)"><Input value={d.favorecido ?? ''} maxLength={120} onChange={(e) => up({ favorecido: e.target.value })} /></Field>
      </>}
      {forma === 'Boleto' && <>
        <Field label="Linha digitável do boleto" req full erro={erro(/boleto/)}><Input value={d.boletoLinha ?? ''} inputMode="numeric" maxLength={80} placeholder="Cole os números do boleto" onChange={(e) => up({ boletoLinha: e.target.value })} /></Field>
        <Field label="Beneficiário"><Input value={d.favorecido ?? ''} maxLength={120} onChange={(e) => up({ favorecido: e.target.value })} /></Field>
      </>}
      {forma === 'Transferência' && <>
        <Field label="Banco" req erro={erro(/o banco/)}><Input value={d.banco ?? ''} maxLength={60} placeholder="ex.: Itaú, 341" onChange={(e) => up({ banco: e.target.value })} /></Field>
        <Field label="Agência" req erro={erro(/agência/)}><Input value={d.agencia ?? ''} maxLength={12} onChange={(e) => up({ agencia: e.target.value })} /></Field>
        <Field label="Conta (com dígito)" req erro={erro(/a conta\./)}><Input value={d.conta ?? ''} maxLength={20} onChange={(e) => up({ conta: e.target.value })} /></Field>
        <Field label="Tipo de conta"><Select value={d.tipoConta ?? 'Corrente'} onChange={(v) => up({ tipoConta: v as DadosPagamento['tipoConta'] })} options={[...TIPOS_CONTA]} /></Field>
        <Field label="Favorecido (titular)" req erro={erro(/favorecido \(titular/)}><Input value={d.favorecido ?? ''} maxLength={120} onChange={(e) => up({ favorecido: e.target.value })} /></Field>
        <Field label="CPF/CNPJ do favorecido" req erro={erro(/CPF\/CNPJ|CPF ou CNPJ/)}><Input value={d.documentoFavorecido ?? ''} inputMode="numeric" maxLength={20} onChange={(e) => up({ documentoFavorecido: e.target.value })} /></Field>
      </>}
      {forma && <Field label="Observação do pagamento" full><Input value={d.observacao ?? ''} maxLength={300} placeholder={forma === 'Cartão' ? 'ex.: cartão corporativo final 1234' : forma === 'Dinheiro' ? 'ex.: entregar ao motorista' : 'opcional'} onChange={(e) => up({ observacao: e.target.value })} /></Field>}
    </>
  );
}

/** Quadro somente leitura com os dados para pagar, cada um com "copiar" quando faz sentido. */
export function DadosPagamentoView({ forma, dados }: { forma?: FormaPagamento; dados?: DadosPagamento }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  if (!forma) return <p className="small muted" style={{ margin: 0 }}>Forma de pagamento não informada.</p>;
  const copiar = async (rotulo: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopiado(rotulo); window.setTimeout(() => setCopiado(null), 1800); } catch { /* sem area de transferencia: o valor esta na tela */ } };
  return (
    <dl className="dados-pagamento">
      {linhasPagamento(forma, dados).map((x) => (
        <div key={x.rotulo}>
          <dt>{x.rotulo}</dt>
          <dd><span className={x.copiar ? 'mono' : undefined}>{x.valor || '—'}</span>{x.copiar && <button type="button" className="btn sm" onClick={() => void copiar(x.rotulo, x.copiar!)}>{copiado === x.rotulo ? 'Copiado' : 'Copiar'}</button>}</dd>
        </div>
      ))}
    </dl>
  );
}
