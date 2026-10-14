// Widgets do iPad: o script do Scriptable rodando num Scriptable SIMULADO (ListWidget, DrawContext, Request, Keychain,
// FileManager, Alert, Pasteboard). Não há Scriptable nesta máquina: a prova é que o script executa sem erro em cada tamanho,
// mostra os números certos e trata token ausente, token recusado e falta de rede.
import { describe, expect, it } from 'vitest';
import { CHAVE_KEYCHAIN_WIDGET, scriptWidgetCaixa } from './widgetScriptable';
import type { ResumoWidgetCaixa } from './widgetCaixa';

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

interface Cenario { runsInWidget: boolean; familia?: string; token?: string | null; resposta?: { status: number; corpo: unknown } | 'sem_rede'; cache?: unknown; pasteboard?: string; respostasAlerta?: number[]; campos?: string[] }
async function rodar(c: Cenario) {
  const textos: string[] = [];
  const requisicoes: { url: string; headers: Record<string, string> }[] = [];
  const keychain = new Map<string, string>(c.token ? [[CHAVE_KEYCHAIN_WIDGET, c.token]] : []);
  const arquivos = new Map<string, string>(c.cache ? [['/cache/eiff-caixa-resumo.json', JSON.stringify(c.cache)]] : []);
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
    Script: { setWidget: (w: unknown) => { widget = w; }, complete: () => undefined, name: () => 'EIFF Caixa' },
  };
  const codigo = scriptWidgetCaixa('https://eiffcontrol.com.br');
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<void>;
  await new AsyncFunction(...Object.keys(ambiente), codigo)(...Object.values(ambiente));
  return { textos, requisicoes, keychain, arquivos, alertas, pasteboard, widget, apresentou };
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
    const r = await rodar({ runsInWidget: false, token: TOKEN, respostasAlerta: [5] });
    expect(r.keychain.size).toBe(0);
  });
});
