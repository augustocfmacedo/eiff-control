// Widgets do iPad: o script do Scriptable rodando num Scriptable SIMULADO (ListWidget, DrawContext, Request, Keychain,
// FileManager, Alert, Pasteboard). Não há Scriptable nesta máquina: a prova é que o script executa sem erro em cada tamanho,
// mostra os números certos e trata token ausente, token recusado e falta de rede.
import { describe, expect, it } from 'vitest';
import { CHAVE_KEYCHAIN_WIDGET, scriptWidgetCaixa } from './widgetScriptable';
import { scriptWidgetPedidos } from './widgetScriptablePedidos';
import { MINUTOS_ATUALIZACAO_WIDGET, scriptWidgetPagamentos } from './widgetScriptablePagamentos';
import type { ResumoWidgetPagamentos } from './widgetPagamentos';
import type { ResumoWidgetCaixa } from './widgetCaixa';
import type { ResumoWidgetPedidos } from './widgetPedidos';

const TOKEN = 'eiffw_' + 'c0de'.repeat(16);
const RESUMO: ResumoWidgetCaixa = {
  versao: 1, geradoEm: '2026-10-14T11:40:00.000Z', hoje: '2026-10-14',
  caixaHoje: 41988.93, minimo: 20000, abaixoDoMinimo: false,
  menor: { data: '2026-10-15', saldo: 23768.93 }, fim: { data: '2026-11-13', saldo: 259915.86 }, em7Dias: 120300.38,
  curva: [36988.93, 23768.93, 120300.38, ...Array.from({ length: 28 }, (_, i) => 120000 + i * 5000)],
  semana: { entradas: 96531.45, saidas: 18577.53 }, vencidos: { pagar: 1200, receber: 0 },
  saude: { geral: 'vermelho', vermelhos: 1, amarelos: 1, alertas: [{ titulo: 'Pagamentos vencidos', valor: 'R$ 1.200,00', sinal: 'vermelho' }, { titulo: 'Fôlego do caixa', valor: '20 dias', sinal: 'amarelo' }] },
  extrato: { ate: '2026-10-13', dias: 1, alerta: null },
  proximos: [{ data: '2026-10-01', descricao: 'Aluguel do galpão', tipo: 'Saída', valor: 1200, vencido: true, foraDoSaldo: false }, { data: '2026-10-16', descricao: 'Medição Smart Fit', tipo: 'Entrada', valor: 77531.45, vencido: false, foraDoSaldo: false }],
};

interface Cenario { script?: string; parametro?: string; arquivos?: Record<string, unknown>; runsInWidget: boolean; familia?: string; token?: string | null; resposta?: { status: number; corpo: unknown } | 'sem_rede'; cache?: unknown; pasteboard?: string; respostasAlerta?: number[]; campos?: string[] }
async function rodar(c: Cenario) {
  const textos: string[] = [];
  const requisicoes: { url: string; headers: Record<string, string> }[] = [];
  const keychain = new Map<string, string>(c.token ? [[CHAVE_KEYCHAIN_WIDGET, c.token]] : []);
  const arquivos = new Map<string, string>(c.cache ? [['/cache/eiff-caixa-resumo.json', JSON.stringify(c.cache)]] : []);
  for (const [k, v] of Object.entries(c.arquivos ?? {})) arquivos.set(`/cache/${k}`, JSON.stringify(v));
  const notificacoes: { title?: string; body?: string; openURL?: string }[] = [];
  const alertas: { title?: string }[] = [];
  const respostas = [...(c.respostasAlerta ?? [])];
  let pasteboard = c.pasteboard ?? '';
  let widget: unknown = null; let apresentou = '';
  const elemento = (): unknown => {
    const props: Record<string | symbol, unknown> = {};
    return new Proxy(props, {
      get(o, k) {
        if (k in o) return o[k];
        if (k === 'then') return undefined;
        if (k === 'addText') return (t: string) => { textos.push(String(t)); return elemento(); };
        if (typeof k === 'string' && k.startsWith('present')) return async () => { apresentou = k; };
        return () => elemento();
      },
      set(o, k, v) { o[k] = v; return true; },
    });
  };
  function Color(this: unknown, hex: string) { return { hex }; }
  (Color as unknown as { dynamic: unknown }).dynamic = (a: unknown) => a;
  const ambiente: Record<string, unknown> = {
    config: { runsInWidget: c.runsInWidget, runsInApp: !c.runsInWidget, widgetFamily: c.familia },
    ListWidget: function ListWidget() { const w = elemento(); return w; },
    DrawContext: function DrawContext() { return elemento(); },
    Path: function Path() { return elemento(); },
    LinearGradient: function LinearGradient() { return elemento(); },
    Point: function Point(x: number, y: number) { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('ponto inválido'); return { x, y }; },
    Rect: function Rect(x: number, y: number, w: number, h: number) { return { x, y, w, h }; },
    Size: function Size(w: number, h: number) { return { w, h }; },
    Color,
    Font: new Proxy({}, { get: () => (n: number) => ({ n }) }),
    Request: function Request(this: { url: string; headers: Record<string, string>; response: { statusCode: number } }, url: string) {
      const req = { url, headers: {} as Record<string, string>, timeoutInterval: 0, response: { statusCode: 0 },
        async loadJSON() { requisicoes.push({ url: req.url, headers: req.headers }); if (!c.resposta || c.resposta === 'sem_rede') throw new Error('The Internet connection appears to be offline.'); req.response.statusCode = c.resposta.status; return c.resposta.corpo; } };
      return req;
    },
    Keychain: { contains: (k: string) => keychain.has(k), get: (k: string) => keychain.get(k), set: (k: string, v: string) => { keychain.set(k, v); }, remove: (k: string) => { keychain.delete(k); } },
    FileManager: { local: () => ({ cacheDirectory: () => '/cache', joinPath: (a: string, b: string) => `${a}/${b}`, fileExists: (p: string) => arquivos.has(p), readString: (p: string) => arquivos.get(p), writeString: (p: string, s: string) => { arquivos.set(p, s); }, remove: (p: string) => { arquivos.delete(p); } }) },
    Pasteboard: { paste: () => pasteboard, copy: (s: string) => { pasteboard = s; } },
    Alert: function Alert() { const a: Record<string, unknown> = { addAction() {}, addCancelAction() {}, addDestructiveAction() {}, addTextField() {}, addSecureTextField() {}, textFieldValue: (i: number) => c.campos?.[i] ?? '', presentAlert: async () => (respostas.length ? respostas.shift() : -1) }; alertas.push(a); return a; },
    args: { widgetParameter: c.parametro ?? null },
    Notification: function Notification() { const n: Record<string, unknown> = { schedule: async () => { notificacoes.push({ title: n.title as string, body: n.body as string, openURL: n.openURL as string }); } }; return n; },
    Script: { setWidget: (w: unknown) => { widget = w; }, complete: () => undefined, name: () => 'EIFF Caixa' },
  };
  const codigo = c.script ?? scriptWidgetCaixa('https://eiffcontrol.com.br');
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<void>;
  await new AsyncFunction(...Object.keys(ambiente), codigo)(...Object.values(ambiente));
  return { textos, requisicoes, keychain, arquivos, alertas, pasteboard, widget, apresentou, notificacoes };
}

describe('script do Scriptable', () => {
  it('o token nunca está no script; endereço e chave do Keychain sim; endereço inválido é recusado', () => {
    const s = scriptWidgetCaixa('https://eiffcontrol.com.br/');
    expect(s).toContain("const BASE = 'https://eiffcontrol.com.br';");
    expect(s).toContain(`const CHAVE = '${CHAVE_KEYCHAIN_WIDGET}';`);
    expect(s).not.toMatch(/eiffw_[0-9a-f]{64}/);
    expect(s).not.toContain('__EIFF_');
    expect(() => scriptWidgetCaixa("https://x.com'; alert(1); '")).toThrow();
    expect(() => scriptWidgetCaixa('http://eiffcontrol.com.br')).toThrow();
    expect(scriptWidgetCaixa('http://localhost:5173')).toContain("const BASE = 'http://localhost:5173';");
  });

  for (const familia of ['small', 'medium', 'large', 'extraLarge', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    it(`widget ${familia}: busca o resumo com o token do Keychain e desenha sem erro`, async () => {
      const r = await rodar({ runsInWidget: true, familia, token: TOKEN, resposta: { status: 200, corpo: RESUMO } });
      expect(r.widget).not.toBeNull();
      expect(r.requisicoes).toEqual([{ url: 'https://eiffcontrol.com.br/api/widget-caixa', headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } }]);
      const tudo = r.textos.join(' | ');
      if (familia === 'accessoryInline') expect(tudo).toBe('Caixa 42,0 mil · menor 23,8 mil em 15/10');
      else if (familia === 'accessoryCircular') expect(tudo).toContain('42,0k');
      else expect(tudo).toContain('R$ 41.989');
      if (familia === 'medium' || familia === 'large' || familia === 'extraLarge') expect(tudo).toContain('R$ 23.769');
      if (familia === 'large' || familia === 'extraLarge') { expect(tudo).toContain('Próximos 7 dias'); expect(tudo).toContain('Medição Smart Fit'); expect(tudo).toContain('+ 77.531,45'); expect(tudo).toContain('pagar vencido R$ 1.200'); }
      if (familia === 'small') expect(tudo).toContain('pagar vencido R$ 1.200');
      expect(r.arquivos.has('/cache/eiff-caixa-resumo.json')).toBe(true);
    });
  }

  it('sem token no Keychain: o widget pede para configurar e não chama o servidor', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', token: null });
    expect(r.textos).toContain('Configure o token');
    expect(r.requisicoes).toEqual([]);
  });

  it('token recusado (401): mostra o aviso do servidor e APAGA o resumo guardado (nunca mostra dado antigo)', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'large', token: TOKEN, cache: RESUMO, resposta: { status: 401, corpo: { erro: 'token_revogado', mensagem: 'Este aparelho foi revogado.' } } });
    expect(r.textos).toContain('Acesso do widget recusado');
    expect(r.textos).toContain('Este aparelho foi revogado.');
    expect(r.textos.join()).not.toContain('R$ 41.989');
    expect(r.arquivos.size).toBe(0);
  });

  it('sem rede com resumo guardado: mostra o guardado marcado como "sem conexão"', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', token: TOKEN, cache: RESUMO, resposta: 'sem_rede' });
    expect(r.textos.join(' | ')).toContain('R$ 41.989');
    expect(r.textos.some((t) => t.startsWith('sem conexão'))).toBe(true);
  });

  it('sem rede e sem nada guardado: aviso, sem quebrar', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'small', token: TOKEN, resposta: 'sem_rede' });
    expect(r.textos).toContain('Sem conexão');
  });

  it('no app, primeira vez: usa o token copiado, guarda no Keychain e limpa a área de transferência', async () => {
    const r = await rodar({ runsInWidget: false, token: null, pasteboard: TOKEN, respostasAlerta: [0, -1] });
    expect(r.keychain.get(CHAVE_KEYCHAIN_WIDGET)).toBe(TOKEN);
    expect(r.pasteboard).toBe('');
  });

  it('no app, primeira vez sem nada copiado: token digitado inválido não é guardado', async () => {
    const r = await rodar({ runsInWidget: false, token: null, pasteboard: 'outra coisa', respostasAlerta: [0, 0], campos: ['eiffw_123'] });
    expect(r.keychain.size).toBe(0);
  });

  it('no app, prévia média com o token guardado', async () => {
    const r = await rodar({ runsInWidget: false, token: TOKEN, respostasAlerta: [1], resposta: { status: 200, corpo: RESUMO } });
    expect(r.apresentou).toBe('presentMedium');
    expect(r.textos.join(' | ')).toContain('R$ 41.989');
  });

  it('no app, remover o token', async () => {
    const r = await rodar({ runsInWidget: false, token: TOKEN, respostasAlerta: [7] });
    expect(r.keychain.size).toBe(0);
  });
});

const PEDIDOS: ResumoWidgetPedidos = {
  versao: 1, visao: 'pedidos', geradoEm: '2026-10-14T12:00:00.000Z', hoje: '2026-10-14',
  pendentes: [
    { id: 'PED-0001', descricao: 'Vale combustível', para: 'Posto', solicitante: 'Tiago', valor: 180, vencimento: '2026-10-14', pedidoEm: '2026-10-14T10:00:00Z', diasEsperando: 0, novo: true, acao: 'programar', orientacao: 'programar 14/10', dataSugerida: null },
    { id: 'PED-0002', descricao: 'Compra grande de aço', para: 'Usina', solicitante: 'Yuri', valor: 200000, vencimento: '2026-10-15', pedidoEm: '2026-10-11T09:00:00Z', diasEsperando: 3, novo: false, acao: 'recusar', orientacao: 'não recomendado', dataSugerida: null },
  ],
  totalPendentes: 2, valorPendente: 200180, contagem: { programar: 1, reagendar: 0, avaliar: 0, recusar: 1 },
  decididos: [{ id: 'PED-0003', descricao: 'Frete', solicitante: 'Tiago', valor: 500, status: 'programado', decididoEm: '2026-10-13T15:00:00Z' }],
};

describe('script do Scriptable · visão pedidos (Parameter = pedidos)', () => {
  for (const familia of ['small', 'medium', 'large', 'extraLarge', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    it(`widget ${familia}: pede ?visao=pedidos e mostra os pedidos`, async () => {
      const r = await rodar({ runsInWidget: true, familia, parametro: ' Pedidos ', token: TOKEN, resposta: { status: 200, corpo: PEDIDOS } });
      expect(r.requisicoes[0].url).toBe('https://eiffcontrol.com.br/api/widget-caixa?visao=pedidos');
      const tudo = r.textos.join(' | ');
      if (familia === 'accessoryInline') expect(tudo).toBe('EIFF: 2 pedidos · R$ 200.180');
      else if (familia === 'accessoryCircular') expect(r.textos[0]).toBe('2');
      else if (familia === 'small') { expect(tudo).toContain('aguardando · R$ 200.180'); expect(tudo).toContain('programar 14/10'); }
      else expect(tudo).toContain('Tiago');
      if (familia === 'large' || familia === 'extraLarge') { expect(tudo).toContain('Compra grande de aço'); expect(tudo).toContain('não recomendado'); expect(tudo).toContain('novo'); expect(tudo).toContain('programado · Frete'); }
      expect(r.arquivos.has('/cache/eiff-pedidos-resumo.json')).toBe(true);
      expect(r.arquivos.has('/cache/eiff-caixa-resumo.json')).toBe(false); // caches separados
    });
  }

  it('sem parâmetro continua sendo o caixa', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', token: TOKEN, resposta: { status: 200, corpo: RESUMO } });
    expect(r.requisicoes[0].url).toBe('https://eiffcontrol.com.br/api/widget-caixa');
  });

  it('resposta do caixa na visão pedidos não é aceita (nunca mistura as visões)', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', parametro: 'pedidos', token: TOKEN, resposta: { status: 200, corpo: RESUMO } });
    expect(r.textos).toContain('Resumo indisponível');
  });

  it('primeira vez: só memoriza os pedidos, sem notificar', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', parametro: 'pedidos', token: TOKEN, resposta: { status: 200, corpo: PEDIDOS } });
    expect(r.notificacoes).toEqual([]);
    expect(JSON.parse(r.arquivos.get('/cache/eiff-pedidos-vistos.json')!)).toEqual(['PED-0001', 'PED-0002']);
  });

  it('pedido que ainda não tinha visto: notificação com quem pediu, valor, data e orientação; abre a Central', async () => {
    const r = await rodar({ runsInWidget: true, familia: 'medium', parametro: 'pedidos', token: TOKEN, arquivos: { 'eiff-pedidos-vistos.json': ['PED-0002'] }, resposta: { status: 200, corpo: PEDIDOS } });
    expect(r.notificacoes).toEqual([{ title: 'Novo pedido de Tiago', body: 'Vale combustível · R$ 180,00 para 14/10 · programar 14/10', openURL: 'https://eiffcontrol.com.br/#/diretor' }]);
    expect(JSON.parse(r.arquivos.get('/cache/eiff-pedidos-vistos.json')!).sort()).toEqual(['PED-0001', 'PED-0002']);
  });

  it('nada novo: nenhuma notificação; sem rede: nunca notifica', async () => {
    const igual = await rodar({ runsInWidget: true, familia: 'medium', parametro: 'pedidos', token: TOKEN, arquivos: { 'eiff-pedidos-vistos.json': ['PED-0001', 'PED-0002'] }, resposta: { status: 200, corpo: PEDIDOS } });
    expect(igual.notificacoes).toEqual([]);
    const semRede = await rodar({ runsInWidget: true, familia: 'medium', parametro: 'pedidos', token: TOKEN, arquivos: { 'eiff-pedidos-vistos.json': [], 'eiff-pedidos-resumo.json': PEDIDOS }, resposta: 'sem_rede' });
    expect(semRede.notificacoes).toEqual([]);
    expect(semRede.textos.some((t) => t.startsWith('sem conexão'))).toBe(true);
  });

  it('no app: prévia de pedidos (grande)', async () => {
    const r = await rodar({ runsInWidget: false, token: TOKEN, respostasAlerta: [5], resposta: { status: 200, corpo: PEDIDOS } });
    expect(r.apresentou).toBe('presentLarge');
    expect(r.requisicoes[0].url).toContain('?visao=pedidos');
  });
});

describe('script PRÓPRIO dos pedidos (sem a parte do caixa)', () => {
  const SP = scriptWidgetPedidos('https://eiffcontrol.com.br');
  it('não carrega nada do caixa e usa o mesmo token do Keychain', () => {
    for (const trecho of ['curva(', 'caixaHoje', 'Próximos 7 dias', 'saúde do caixa', '/#/caixa', 'widgetParameter']) expect(SP, trecho).not.toContain(trecho);
    expect(SP).toContain(`const CHAVE = '${CHAVE_KEYCHAIN_WIDGET}';`);
    expect(SP).toContain("new Request(BASE + '/api/widget-caixa?visao=pedidos')");
    expect(SP).not.toMatch(/eiffw_[0-9a-f]{64}/);
    expect(() => scriptWidgetPedidos('http://eiffcontrol.com.br')).toThrow();
  });
  for (const familia of ['small', 'medium', 'large', 'extraLarge', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    it(`widget ${familia} sem Parameter: só pedidos`, async () => {
      const r = await rodar({ script: SP, runsInWidget: true, familia, token: TOKEN, resposta: { status: 200, corpo: PEDIDOS } });
      expect(r.requisicoes.map((x) => x.url)).toEqual(['https://eiffcontrol.com.br/api/widget-caixa?visao=pedidos']);
      const tudo = r.textos.join(' | ');
      expect(tudo).not.toContain('Caixa');
      if (familia === 'accessoryInline') expect(tudo).toBe('EIFF: 2 pedidos · R$ 200.180');
      if (familia === 'large') { expect(tudo).toContain('Pedidos ao Diretor · EIFF'); expect(tudo).toContain('não recomendado'); expect(tudo).toContain('programado · Frete'); }
    });
  }
  it('resposta do caixa é recusada; 401 apaga o guardado; sem token pede configuração', async () => {
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, resposta: { status: 200, corpo: RESUMO } })).textos).toContain('Pedidos indisponíveis');
    const negado = await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, arquivos: { 'eiff-pedidos-resumo.json': PEDIDOS }, resposta: { status: 401, corpo: { erro: 'token_revogado', mensagem: 'Este aparelho foi revogado.' } } });
    expect(negado.textos).toContain('Acesso do widget recusado');
    expect(negado.arquivos.has('/cache/eiff-pedidos-resumo.json')).toBe(false);
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'small', token: null })).textos).toContain('Configure o token');
  });
  it('aviso de pedido novo: só o que não tinha visto; primeira vez só memoriza', async () => {
    const primeira = await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, resposta: { status: 200, corpo: PEDIDOS } });
    expect(primeira.notificacoes).toEqual([]);
    const depois = await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, arquivos: { 'eiff-pedidos-vistos.json': ['PED-0002'] }, resposta: { status: 200, corpo: PEDIDOS } });
    expect(depois.notificacoes.map((n) => n.title)).toEqual(['Novo pedido de Tiago']);
  });
  it('no app: prévia grande e remover o token', async () => {
    const previa = await rodar({ script: SP, runsInWidget: false, token: TOKEN, respostasAlerta: [2], resposta: { status: 200, corpo: PEDIDOS } });
    expect(previa.apresentou).toBe('presentLarge');
    const rem = await rodar({ script: SP, runsInWidget: false, token: TOKEN, respostasAlerta: [5] });
    expect(rem.keychain.size).toBe(0);
  });
});

const PAGAMENTOS: ResumoWidgetPagamentos = {
  versao: 1, visao: 'pagamentos', geradoEm: '2026-10-14T12:00:00.000Z', hoje: '2026-10-14',
  itens: [
    { id: 'A:aberto', descricao: 'Conta atrasada', para: 'Enel', departamento: 'Administrativo', valor: 1500, vencimento: '2026-10-10', status: 'atrasado', diasAtraso: 4 },
    { id: 'B:aberto', descricao: 'Folha quinzenal', para: 'Equipe', departamento: 'Pessoal', valor: 5000, vencimento: '2026-10-14', status: 'a_pagar', diasAtraso: 0 },
    { id: 'C:aberto', descricao: 'Compra de parafusos', para: 'Ciser', departamento: 'Obra', valor: 800, vencimento: '2026-10-14', status: 'aprovacao', diasAtraso: 0 },
    { id: 'D:pago', descricao: 'Aluguel do galpão', para: 'Imobiliária', departamento: 'Administrativo', valor: 12000, vencimento: '2026-10-14', status: 'pago', diasAtraso: 0 },
  ],
  quantidade: { atrasado: 1, a_pagar: 1, aprovacao: 1, pago: 1 },
  valor: { atrasado: 1500, a_pagar: 5000, aprovacao: 800, pago: 12000 },
  total: 18500, falta: 6500, progresso: 0.649, caixaHoje: 41988.93, caixaAposPagar: 35488.93, minimo: 20000, abaixoDoMinimo: false,
};

describe('script PRÓPRIO dos pagamentos do dia (EIFF Pagamentos)', () => {
  const SP = scriptWidgetPagamentos('https://eiffcontrol.com.br');
  it('só pede a visão pagamentos, usa o mesmo token do Keychain e pede atualização a cada 15 minutos', () => {
    expect(MINUTOS_ATUALIZACAO_WIDGET).toBe(15);
    expect(SP).toContain('const MINUTOS = 15;');
    expect(SP).not.toContain('__EIFF_');
    expect(SP).toContain(`const CHAVE = '${CHAVE_KEYCHAIN_WIDGET}';`);
    expect(SP).toContain("new Request(BASE + '/api/widget-caixa?visao=pagamentos')");
    expect(SP).not.toMatch(/eiffw_[0-9a-f]{64}/);
    expect(() => scriptWidgetPagamentos('http://eiffcontrol.com.br')).toThrow();
  });
  for (const familia of ['small', 'medium', 'large', 'extraLarge', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    it(`widget ${familia}: pagamentos do dia com o total e a próxima atualização em 15 min`, async () => {
      const antes = Date.now();
      const r = await rodar({ script: SP, runsInWidget: true, familia, token: TOKEN, resposta: { status: 200, corpo: PAGAMENTOS } });
      expect(r.requisicoes.map((x) => x.url)).toEqual(['https://eiffcontrol.com.br/api/widget-caixa?visao=pagamentos']);
      const proxima = (r.widget as { refreshAfterDate: Date }).refreshAfterDate.getTime();
      expect(proxima - antes).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
      expect(proxima - antes).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
      expect((r.widget as { url: string }).url).toBe('https://eiffcontrol.com.br/#/caixa');
      const tudo = r.textos.join(' | ');
      if (familia === 'accessoryInline') expect(tudo).toBe('Pagar hoje R$ 6.500 · pago R$ 12 mil');
      else if (familia === 'accessoryCircular') expect(tudo).toBe('1/3');
      else if (familia === 'accessoryRectangular') { expect(tudo).toContain('Pagamentos 14/10 · R$ 18,5 mil'); expect(tudo).toContain('Falta R$ 6.500 (2)'); expect(tudo).toContain('1 atrasado'); }
      else if (familia === 'small') { expect(tudo).toContain('R$ 6.500'); expect(tudo).toContain('1 de 3 pagos'); expect(tudo).toContain('1 atrasado'); }
      else { expect(tudo).toContain('R$ 18.500,00'); expect(tudo).toContain('R$ 6.500,00'); expect(tudo).toContain('ATRASADO 4D'); expect(tudo).toContain('A PAGAR'); expect(tudo).toContain('Pagamentos de hoje · qua, 14/10'); expect(tudo).toContain('3 pagamentos · 1 pago |'); }
      if (familia === 'large' || familia === 'extraLarge') { expect(tudo).toContain('APROVAÇÃO'); expect(tudo).toContain('PAGO'); expect(tudo).toContain('Aluguel do galpão'); expect(tudo).toContain('R$ 35.489'); expect(tudo).toContain('Enel · Administrativo'); }
      expect(r.arquivos.has('/cache/eiff-pagamentos-resumo.json')).toBe(true);
    });
  }
  it('dia sem pagamentos', async () => {
    const vazio: ResumoWidgetPagamentos = { ...PAGAMENTOS, itens: [], quantidade: { atrasado: 0, a_pagar: 0, aprovacao: 0, pago: 0 }, valor: { atrasado: 0, a_pagar: 0, aprovacao: 0, pago: 0 }, total: 0, falta: 0, progresso: 1 };
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'large', token: TOKEN, resposta: { status: 200, corpo: vazio } })).textos).toContain('Nenhum pagamento vence hoje.');
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'accessoryInline', token: TOKEN, resposta: { status: 200, corpo: vazio } })).textos).toEqual(['Sem pagamentos hoje']);
  });
  it('resposta de outra visão é recusada; 401 apaga o guardado; sem rede mostra o último marcado; sem token pede configuração', async () => {
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, resposta: { status: 200, corpo: RESUMO } })).textos).toContain('Pagamentos indisponíveis');
    const negado = await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, arquivos: { 'eiff-pagamentos-resumo.json': PAGAMENTOS }, resposta: { status: 401, corpo: { erro: 'token_revogado', mensagem: 'Este aparelho foi revogado.' } } });
    expect(negado.textos).toContain('Acesso do widget recusado');
    expect(negado.arquivos.has('/cache/eiff-pagamentos-resumo.json')).toBe(false);
    const semRede = await rodar({ script: SP, runsInWidget: true, familia: 'medium', token: TOKEN, arquivos: { 'eiff-pagamentos-resumo.json': PAGAMENTOS }, resposta: 'sem_rede' });
    expect(semRede.textos.some((t) => t.startsWith('sem conexão'))).toBe(true);
    expect((await rodar({ script: SP, runsInWidget: true, familia: 'small', token: null })).textos).toContain('Configure o token');
  });
  it('no app: prévia extra grande e remover o token', async () => {
    const previa = await rodar({ script: SP, runsInWidget: false, token: TOKEN, respostasAlerta: [3], resposta: { status: 200, corpo: PAGAMENTOS } });
    expect(previa.apresentou).toBe('presentExtraLarge');
    const rem = await rodar({ script: SP, runsInWidget: false, token: TOKEN, respostasAlerta: [5] });
    expect(rem.keychain.size).toBe(0);
  });
});
