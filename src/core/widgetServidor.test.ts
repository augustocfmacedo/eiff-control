// Widgets do iPad: /api/widget-caixa com banco e rede simulados. A ordem importa: formato → RPC server-only → MATRIZ → carga.
import { describe, expect, it, vi } from 'vitest';
import { erroParaLog, hojeEmSaoPaulo, tratarWidgetCaixa, type PortasWidget, type ValidacaoTokenWidget } from './widgetServidor';
import type { Dataset, Usuario } from './types';
import { actions, getState } from '../data/store';

const TOKEN = 'eiffw_' + 'ab12'.repeat(16);
const ADM: Usuario = { id: 'p-adm', nome: 'Adm', email: 'a@x', papel: 'Administrador', obras: '*', ativo: true };
function dataset(automatica = true): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  return { ...ds, params: { ...ds.params, dataBase: '2026-01-01', dataBaseAutomatica: automatica } };
}
function portas(o: { validar?: ValidacaoTokenWidget | Error; usuario?: Usuario; automatica?: boolean; agora?: string } = {}) {
  const validar = vi.fn(async (_t: string): Promise<ValidacaoTokenWidget> => { if (o.validar instanceof Error) throw o.validar; return o.validar ?? { ok: true, perfilId: 'p-adm', tokenId: 't1', nome: 'iPad' }; });
  const carregar = vi.fn(async (_id: string) => ({ ds: dataset(o.automatica ?? true), usuario: o.usuario ?? ADM }));
  const p: PortasWidget = { validar, carregar, agora: () => new Date(o.agora ?? '2026-10-14T02:30:00Z') };
  return { p, validar, carregar };
}
const get = (autorizacao: string | null) => ({ metodo: 'GET', autorizacao });

describe('/api/widget-caixa', () => {
  it('só GET', async () => {
    const { p, validar } = portas();
    expect((await tratarWidgetCaixa({ metodo: 'POST', autorizacao: `Bearer ${TOKEN}` }, p)).status).toBe(405);
    expect(validar).not.toHaveBeenCalled();
  });

  it('sem token ou fora do formato: 401 sem nem consultar o banco', async () => {
    const { p, validar } = portas();
    expect((await tratarWidgetCaixa(get(null), p)).corpo).toMatchObject({ erro: 'token_ausente' });
    for (const ruim of ['Bearer abc', `Bearer ${TOKEN}x`, `Bearer ${TOKEN.toUpperCase()}`, 'Bearer eiffw_' + 'z'.repeat(64)]) {
      const r = await tratarWidgetCaixa(get(ruim), p);
      expect([r.status, (r.corpo as { erro: string }).erro]).toEqual([401, 'token_invalido']);
    }
    expect(validar).not.toHaveBeenCalled();
  });

  it('cada recusa da RPC vira a mensagem certa e nunca carrega o caixa', async () => {
    const casos: [string, number, string][] = [['token_invalido', 401, 'token_invalido'], ['token_revogado', 401, 'token_revogado'], ['token_expirado', 401, 'token_expirado'], ['perfil_inativo', 403, 'perfil_inativo'], ['sem_permissao', 403, 'sem_permissao'], ['somente_servidor', 503, 'indisponivel'], ['qualquer_outro', 503, 'indisponivel']];
    for (const [erroRpc, status, erro] of casos) {
      const { p, carregar } = portas({ validar: { ok: false, erro: erroRpc } });
      const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), p);
      expect([r.status, (r.corpo as { erro: string }).erro], erroRpc).toEqual([status, erro]);
      expect(carregar).not.toHaveBeenCalled();
    }
  });

  it('banco fora do ar: 503 sem detalhe', async () => {
    const { p } = portas({ validar: new Error('connect ECONNREFUSED 10.0.0.1 com segredo') });
    const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), p);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.corpo)).not.toMatch(/ECONNREFUSED|segredo/);
  });

  it('segunda barreira: perfil que não vê o caixa pela MATRIZ (ou inativo) recebe 403 mesmo com a RPC dizendo ok', async () => {
    for (const usuario of [{ ...ADM, papel: 'Diretoria' as const }, { ...ADM, papel: 'Financeiro' as const }, { ...ADM, ativo: false }]) {
      const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), portas({ usuario }).p);
      expect([r.status, (r.corpo as { erro: string }).erro]).toEqual([403, 'sem_permissao']);
    }
  });

  it('ok: carrega pelo perfil do token, data-base de hoje em São Paulo, resumo do caixa, token nunca na resposta', async () => {
    const { p, validar, carregar } = portas();
    const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), p);
    expect(r.status).toBe(200);
    expect(validar).toHaveBeenCalledWith(TOKEN);
    expect(carregar).toHaveBeenCalledWith('p-adm');
    const corpo = r.corpo as { versao: number; hoje: string; curva: number[] };
    expect([corpo.versao, corpo.hoje, corpo.curva.length]).toEqual([1, '2026-10-13', 31]); // 02:30Z de 14/10 = 23:30 de 13/10 em SP
    expect(JSON.stringify(r.corpo)).not.toContain(TOKEN.slice(6));
  });

  it('data-base fixa (fechamento/simulação) é respeitada', async () => {
    const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), portas({ automatica: false }).p);
    expect((r.corpo as { hoje: string }).hoje).toBe('2026-01-01');
  });

  it('dia em São Paulo', () => {
    expect(hojeEmSaoPaulo(new Date('2026-10-14T02:59:59Z'))).toBe('2026-10-13');
    expect(hojeEmSaoPaulo(new Date('2026-10-14T03:00:00Z'))).toBe('2026-10-14');
  });
});

describe('diagnóstico no log do servidor', () => {
  it('registra a etapa e a primeira linha do erro, nunca o token', async () => {
    const registros: [string, string][] = [];
    const { p } = portas();
    const comFalha: PortasWidget = { ...p, carregar: async () => { throw new Error(`ler profile: falhou com ${TOKEN}\nlinha 2 com Bearer abc.def`); }, registrar: (etapa, e) => registros.push([etapa, erroParaLog(e)]) };
    const r = await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), comFalha);
    expect(r.status).toBe(503);
    expect(registros).toEqual([['carregar', 'Error: ler profile: falhou com eiffw_***']]);
    expect(JSON.stringify(r.corpo)).not.toContain('ler profile');
  });
  it('resposta inesperada da validação também é registrada', async () => {
    const registros: string[] = [];
    const { p } = portas({ validar: { ok: false, erro: 'somente_servidor' } });
    await tratarWidgetCaixa(get(`Bearer ${TOKEN}`), { ...p, registrar: (etapa, e) => registros.push(`${etapa}: ${erroParaLog(e)}`) });
    expect(registros).toEqual(['validar: Error: resposta inesperada da validação: somente_servidor']);
  });
  it('erroParaLog limita o tamanho e mascara Bearer', () => {
    expect(erroParaLog(new Error('x'.repeat(500))).length).toBe(200);
    expect(erroParaLog('falha Bearer segredo123 fim')).toBe('falha Bearer *** fim');
  });
});

describe('visão pedidos (?visao=pedidos)', () => {
  it('visão desconhecida: 400 sem consultar o banco', async () => {
    const { p, validar } = portas();
    const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao: 'extrato' }, p);
    expect([r.status, (r.corpo as { erro: string }).erro]).toEqual([400, 'visao_invalida']);
    expect(validar).not.toHaveBeenCalled();
  });
  it('Administrador (vê bancos e aprova) recebe os pedidos da Central', async () => {
    const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao: 'pedidos' }, portas().p);
    expect(r.status).toBe(200);
    const corpo = r.corpo as { visao: string; pendentes: unknown[]; contagem: object };
    expect(corpo.visao).toBe('pedidos');
    expect(Array.isArray(corpo.pendentes)).toBe(true);
  });
  it('sem a visão (ou vazia) continua sendo o caixa', async () => {
    for (const visao of [undefined, null, '']) {
      const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao }, portas().p);
      expect((r.corpo as { visao?: string; curva?: number[] }).curva?.length).toBe(31);
    }
  });
  it('quem não vê bancos não recebe pedidos', async () => {
    const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao: 'pedidos' }, portas({ usuario: { ...ADM, papel: 'Diretoria' } }).p);
    expect(r.status).toBe(403);
  });
});

describe('visão pagamentos (?visao=pagamentos)', () => {
  it('Administrador recebe os pagamentos do dia', async () => {
    const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao: 'pagamentos' }, portas().p);
    expect(r.status).toBe(200);
    const corpo = r.corpo as { visao: string; itens: unknown[]; total: number; curva?: unknown };
    expect(corpo.visao).toBe('pagamentos');
    expect(Array.isArray(corpo.itens)).toBe(true);
    expect(typeof corpo.total).toBe('number');
    expect(corpo.curva).toBeUndefined();
  });
  it('quem não vê bancos não recebe os pagamentos', async () => {
    const r = await tratarWidgetCaixa({ metodo: 'GET', autorizacao: `Bearer ${TOKEN}`, visao: 'pagamentos' }, portas({ usuario: { ...ADM, papel: 'Diretoria' } }).p);
    expect(r.status).toBe(403);
  });
});
