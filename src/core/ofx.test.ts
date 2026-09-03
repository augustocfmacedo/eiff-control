import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Dataset } from './types';
import { decodificarOfx, parseOfx, sugerirCategoria } from './ofx';

const ds = seed as unknown as Dataset;

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260903120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>341<BRANCHID>1234<ACCTID>56789-0<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901000000[-3:BRT]<DTEND>20260903000000[-3:BRT]
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901120000[-3:BRT]<TRNAMT>150076.25<FITID>2026090100001<MEMO>PIX RECEBIDO INVEST MARKET NF 47</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000[-3:BRT]<TRNAMT>-63220.04<FITID>2026090200002<CHECKNUM>000123<MEMO>PAGAMENTO FOLHA SETEMBRO</STMTTRN>
<STMTTRN><TRNTYPE>FEE<DTPOSTED>20260903120000[-3:BRT]<TRNAMT>-89,90<FITID>2026090300003<MEMO>TARIFA PACOTE SERVIÇOS</STMTTRN>
<STMTTRN><TRNTYPE>FEE<DTPOSTED>20260903120000[-3:BRT]<TRNAMT>-89,90<FITID>2026090300003<MEMO>TARIFA PACOTE SERVIÇOS</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>98310.79<DTASOF>20260903120000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>001</BANKID><ACCTID>12345</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260902</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260902</DTPOSTED><TRNAMT>-1500.00</TRNAMT><FITID>A1</FITID><NAME>GERDAU</NAME><MEMO>TED PED-001</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
  it('lê OFX 1.x (SGML) com datas, valores com vírgula, documento, saldo e deduplica FITID', () => {
    const e = parseOfx(OFX_SGML);
    expect(e.banco).toBe('341');
    expect(e.agencia).toBe('1234');
    expect(e.conta).toBe('56789-0');
    expect(e.moeda).toBe('BRL');
    expect(e.inicio).toBe('2026-09-01');
    expect(e.fim).toBe('2026-09-03');
    expect(e.saldoFinal).toBeCloseTo(98310.79, 2);
    expect(e.dataSaldo).toBe('2026-09-03');
    expect(e.transacoes).toHaveLength(3);
    expect(e.transacoes[0]).toMatchObject({ fitid: '2026090100001', data: '2026-09-01', valor: 150076.25, tipo: 'CREDIT', memo: 'PIX RECEBIDO INVEST MARKET NF 47' });
    expect(e.transacoes[1]).toMatchObject({ valor: -63220.04, documento: '000123' });
    expect(e.transacoes[2].valor).toBeCloseTo(-89.9, 2);
  });
  it('lê OFX 2.x (XML) com NAME + MEMO', () => {
    const e = parseOfx(OFX_XML);
    expect(e.banco).toBe('001');
    expect(e.transacoes).toHaveLength(1);
    expect(e.transacoes[0].memo).toBe('GERDAU TED PED-001');
    expect(e.transacoes[0].valor).toBe(-1500);
  });
  it('resolve o sinal quando o banco exporta valores sem sinal (caso Banco do Brasil)', () => {
    const ofx = `<OFX><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260901<TRNAMT>2500.00<FITID>90.118<MEMO>Pix - Enviado 01/09 15:53 CLEITON JOSE DE MELO</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260902<TRNAMT>140.38<FITID>90.202<MEMO>Pagamento de Boleto OPERADOR NACIONAL</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260902<TRNAMT>12.86<FITID>892<MEMO>Tarifa Pix Enviado Tar. agrupadas</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260903<TRNAMT>200.00<FITID>309<MEMO>Pix - Rejeitado 03/09 09:16 Ordem rejeitada pelo PSP</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260903<TRNAMT>5000.00<FITID>310<MEMO>Pix - Recebido 03/09 10:00 INVEST MARKET</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260903<TRNAMT>99.00<FITID>311<MEMO>SEM PALAVRA-CHAVE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260903<TRNAMT>-50.00<FITID>312<MEMO>SINAL NEGATIVO PREVALECE</STMTTRN>
</BANKTRANLIST></STMTRS></OFX>`;
    const v = parseOfx(ofx).transacoes.map((t) => t.valor);
    expect(v).toEqual([-2500, -140.38, -12.86, 200, 5000, -99, -50]);
  });
  it('rejeita arquivo que não é extrato', () => {
    expect(() => parseOfx('<html>oi</html>')).toThrow(/OFX/);
  });
  it('decodifica Windows-1252 conforme o cabeçalho', () => {
    const bytes = new TextEncoder().encode('CHARSET:1252\n<OFX><STMTRS><STMTTRN><FITID>1<DTPOSTED>20260901<TRNAMT>-1<MEMO>SERVI');
    const buf = new Uint8Array([...bytes, 0xc7, 0x4f, 0x53]); // "ÇOS" em 1252
    const texto = decodificarOfx(buf.buffer);
    expect(parseOfx(texto).transacoes[0].memo).toBe('SERVIÇOS');
  });
});

describe('sugerirCategoria', () => {
  it('classifica pelos históricos mais comuns', () => {
    expect(sugerirCategoria('TARIFA PACOTE SERVICOS', false, ds.planoContas)).toBe('Juros e tarifas bancárias');
    expect(sugerirCategoria('PAGAMENTO FOLHA SETEMBRO', false, ds.planoContas)).toBe('Folha e salários');
    expect(sugerirCategoria('DARF SIMPLES NACIONAL', false, ds.planoContas)).toBe('Tributos e taxas gerais');
    expect(sugerirCategoria('TED GERDAU ACOS LONGOS', false, ds.planoContas)).toBe('Aço e perfis');
    expect(sugerirCategoria('PIX RECEBIDO INVEST MARKET NF 47', true, ds.planoContas)).toBe('Medições de obras');
    expect(sugerirCategoria('XYZ', true, ds.planoContas)).toBe('Outros recebimentos');
    expect(sugerirCategoria('XYZ', false, ds.planoContas)).toBe('Outros pagamentos');
  });
});
