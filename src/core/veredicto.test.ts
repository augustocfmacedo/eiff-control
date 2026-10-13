import { describe, expect, it } from 'vitest';
import { dataDoVeredicto, redigirVeredictoEquipe, validarPedidoVeredicto, type PedidoInterpretado, type VeredictoDF } from './cfo';

const u = { id: 's', nome: 'Equipe Um', email: '', papel: 'Solicitante' as const, obras: [] as string[], ativo: true };
const pedido: PedidoInterpretado = { intencao: 'pagamento', valor: 800, vencimento: '2026-10-17', categoria: 'Manutenção', contraparte: 'Oficina do Zé', descricao: 'Manutenção', faltando: [], origem: 'local' };
const v = (x: Partial<VeredictoDF>): VeredictoDF => ({ decisao: 'liberar', vencimento: '2026-10-17', precisaAprovacao: false, ...x });
const valores = (t: string) => t.match(/R\$\s?[\d.,]*\d/g) ?? [];

describe('veredito do Diretor para quem não vê caixa', () => {
  it('cada decisão vira uma frase clara, com a data certa, sem nenhum valor além do pedido', () => {
    const libera = redigirVeredictoEquipe(v({}), pedido, u);
    expect(libera).toMatch(/pode ser programado para 17\/10/);
    const reag = redigirVeredictoEquipe(v({ decisao: 'reagendar', dataSugerida: '2026-10-23' }), pedido, u);
    expect(reag).toMatch(/em 17\/10 fica apertado/); expect(reag).toMatch(/a partir de 23\/10/);
    expect(redigirVeredictoEquipe(v({ decisao: 'atencao' }), pedido, u)).toMatch(/avaliação da Diretoria/);
    expect(redigirVeredictoEquipe(v({ decisao: 'nao_recomendado' }), pedido, u)).toMatch(/não comporta/);
    expect(redigirVeredictoEquipe(v({ precisaAprovacao: true }), pedido, u)).toMatch(/aprovação da Diretoria/);
    for (const t of [libera, reag]) {
      expect(t).not.toMatch(/saldo|reserva|alçada|menor/i);
      expect(valores(t).every((x) => x.replace(/\s/g, ' ') === 'R$ 800,00')).toBe(true);
    }
  });
  it('o botão usa a data sugerida só quando a pedida aperta o caixa', () => {
    expect(dataDoVeredicto(v({ decisao: 'reagendar', dataSugerida: '2026-10-23' }))).toBe('2026-10-23');
    expect(dataDoVeredicto(v({}))).toBe('2026-10-17');
    expect(dataDoVeredicto(v({ decisao: 'atencao', dataSugerida: '2026-10-23' }))).toBe('2026-10-17');
  });
  it('o servidor só aceita valor, data e (opcionais) obra e categoria', () => {
    expect(validarPedidoVeredicto({ valor: 800.555, vencimento: '2026-10-17' })).toEqual({ valor: 800.56, vencimento: '2026-10-17' });
    expect(validarPedidoVeredicto({ valor: 800, vencimento: '2026-10-17', codigoObra: 'OB-1', categoria: 'Manutenção' })).toMatchObject({ codigoObra: 'OB-1', categoria: 'Manutenção' });
    expect(validarPedidoVeredicto({ valor: 800, vencimento: '17/10/2026' })).toBe('data inválida');
    expect(validarPedidoVeredicto({ valor: -1, vencimento: '2026-10-17' })).toBe('valor inválido');
    expect(validarPedidoVeredicto({ valor: 800, vencimento: '2026-10-17', saldo: 1 })).toBe('campos não permitidos');
    expect(validarPedidoVeredicto(null)).toBe('pedido inválido');
  });
});
