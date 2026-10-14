// Widgets do iPad: o script do app Scriptable (gratuito na App Store) que desenha os widgets do caixa. O app gera o texto
// com o endereço do site (scriptWidgetCaixa) e o usuário cola num script novo do Scriptable. O TOKEN NÃO VAI NO SCRIPT: na
// primeira execução dentro do Scriptable ele é lido da área de transferência (ou digitado), guardado no Keychain do iPad e
// a área de transferência é limpa. Tamanhos: pequeno, médio, grande, extra grande (iPad) e os três da tela de bloqueio.
// O resumo vem de GET /api/widget-caixa (src/core/widgetServidor.ts); sem rede, mostra o último resumo guardado marcado
// como "sem conexão"; token revogado/vencido mostra o aviso e NUNCA o resumo antigo.
// Testado em src/core/widgetScriptable.test.ts com um Scriptable simulado (cada tamanho, sem token, 401, sem rede).

export const NOME_SCRIPT_WIDGET = 'EIFF Caixa';
export const CHAVE_KEYCHAIN_WIDGET = 'eiff-control-widget-caixa';

const MODELO = String.raw`// EIFF Control · widget do caixa (Scriptable). Gerado pelo EIFF Control em Caixa › Widgets do iPad.
// O token do aparelho fica no Keychain do iPad, nunca neste arquivo. Para trocar: rode este script no Scriptable.
const BASE = '__EIFF_BASE__';
const CHAVE = '__EIFF_CHAVE__';
const CACHE = 'eiff-caixa-resumo.json';
const LARANJA = new Color('#d1481c');
const FUNDO = Color.dynamic(new Color('#ffffff'), new Color('#15171b'));
const TEXTO = Color.dynamic(new Color('#16181d'), new Color('#f2f3f5'));
const APOIO = Color.dynamic(new Color('#5f6670'), new Color('#9aa1ab'));
const COR = { vermelho: new Color('#e5484d'), amarelo: new Color('#f5a524'), verde: new Color('#46a758') };

function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function brl(v, casas) {
  const c = casas === undefined ? 0 : casas;
  const partes = Math.abs(v).toFixed(c).split('.');
  return (v < 0 ? '−' : '') + 'R$ ' + milhar(partes[0]) + (partes[1] ? ',' + partes[1] : '');
}
function compacto(v) {
  const n = Math.abs(v); const s = v < 0 ? '−' : '';
  if (n >= 1e6) return s + (n / 1e6).toFixed(1).replace('.', ',') + ' mi';
  if (n >= 1e3) return s + (n / 1e3).toFixed(1).replace('.', ',') + ' mil';
  return s + n.toFixed(0);
}
function dia(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function hora(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function corSaldo(v, r) { return v < 0 ? COR.vermelho : v < r.minimo ? COR.amarelo : TEXTO; }

function texto(alvo, t, tamanho, opcoes) {
  const o = opcoes || {};
  const el = alvo.addText(t);
  el.font = o.peso === 'forte' ? Font.boldSystemFont(tamanho) : o.peso === 'medio' ? Font.semiboldSystemFont(tamanho) : Font.systemFont(tamanho);
  el.textColor = o.cor || TEXTO;
  el.lineLimit = o.linhas || 1;
  el.minimumScaleFactor = o.escala || 0.6;
  if (o.direita) el.rightAlignText();
  return el;
}
function linha(alvo) { const s = alvo.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function ponto(alvo, cor, tamanho) {
  const dc = new DrawContext(); dc.size = new Size(tamanho, tamanho); dc.opaque = false; dc.respectScreenScale = true;
  dc.setFillColor(cor); dc.fillEllipse(new Rect(0, 0, tamanho, tamanho));
  const img = alvo.addImage(dc.getImage()); img.imageSize = new Size(tamanho, tamanho);
}

// curva do saldo em degrau, com a linha tracejada do caixa mínimo e o ponto do menor saldo
function curva(r, largura, altura) {
  const v = r.curva; const n = v.length;
  const dc = new DrawContext(); dc.size = new Size(largura, altura); dc.opaque = false; dc.respectScreenScale = true;
  let lo = Math.min(r.minimo, ...v); let hi = Math.max(r.minimo, ...v);
  if (hi === lo) { hi = hi + 1; lo = lo - 1; }
  const folga = (hi - lo) * 0.08; lo = lo - folga; hi = hi + folga;
  const y = (s) => altura - 3 - ((s - lo) / (hi - lo)) * (altura - 6);
  const x = (i) => (n === 1 ? 0 : (i / (n - 1)) * (largura - 4)) + 2;
  dc.setStrokeColor(COR.vermelho); dc.setLineWidth(1);
  const ym = y(r.minimo);
  for (let px = 0; px < largura; px += 10) { const t = new Path(); t.move(new Point(px, ym)); t.addLine(new Point(Math.min(px + 6, largura), ym)); dc.addPath(t); dc.strokePath(); }
  const p = new Path(); p.move(new Point(x(0), y(v[0])));
  for (let i = 1; i < n; i++) { p.addLine(new Point(x(i), y(v[i - 1]))); p.addLine(new Point(x(i), y(v[i]))); }
  dc.addPath(p); dc.setStrokeColor(LARANJA); dc.setLineWidth(2); dc.strokePath();
  const im = v.indexOf(r.menor.saldo);
  if (im >= 0) { dc.setFillColor(r.menor.saldo < r.minimo ? COR.vermelho : COR.amarelo); dc.fillEllipse(new Rect(x(im) - 3.5, y(v[im]) - 3.5, 7, 7)); }
  return dc.getImage();
}

function cabecalho(w, r, estado) {
  const c = linha(w);
  ponto(c, COR[r.saude.geral] || APOIO, 8); c.addSpacer(5);
  texto(c, 'Caixa · EIFF', 12, { peso: 'medio', cor: APOIO });
  c.addSpacer();
  texto(c, estado.semRede ? 'sem conexão · ' + hora(r.geradoEm) : 'atualizado ' + hora(r.geradoEm), 11, { cor: estado.semRede ? COR.amarelo : APOIO });
}
function trio(w, r) {
  const c = linha(w); c.spacing = 8;
  const col = (rotulo, valor, cor) => { const s = c.addStack(); s.layoutVertically(); texto(s, rotulo, 11, { cor: APOIO }); texto(s, valor, 15, { peso: 'medio', cor: cor }); };
  col('Hoje', brl(r.caixaHoje), corSaldo(r.caixaHoje, r)); c.addSpacer();
  col('Menor · ' + dia(r.menor.data), brl(r.menor.saldo), corSaldo(r.menor.saldo, r)); c.addSpacer();
  col('Em ' + dia(r.fim.data), brl(r.fim.saldo), corSaldo(r.fim.saldo, r));
}
function alertas(w, r) {
  const itens = [];
  if (r.vencidos.pagar > 0) itens.push(['vermelho', 'pagar vencido ' + brl(r.vencidos.pagar)]);
  if (r.vencidos.receber > 0) itens.push(['amarelo', 'receber vencido ' + brl(r.vencidos.receber)]);
  if (r.extrato.alerta) itens.push(['amarelo', r.extrato.ate ? 'extrato até ' + dia(r.extrato.ate) : 'sem extrato importado']);
  for (const a of r.saude.alertas) if (itens.length < 3 && a.titulo !== 'Pagamentos vencidos' && a.titulo !== 'Recebimentos vencidos' && a.titulo !== 'Extrato em dia') itens.push([a.sinal, a.titulo + ' ' + a.valor]);
  if (!itens.length) itens.push(['verde', 'saúde do caixa em ordem']);
  for (const [sinal, t] of itens.slice(0, 3)) { const c = linha(w); ponto(c, COR[sinal], 7); c.addSpacer(5); texto(c, t, 11, { cor: APOIO }); }
}
function proximos(w, r, max) {
  const c = linha(w);
  texto(c, 'Próximos 7 dias', 13, { peso: 'medio' }); c.addSpacer();
  texto(c, 'entra ' + brl(r.semana.entradas) + ' · sai ' + brl(r.semana.saidas), 11, { cor: APOIO });
  w.addSpacer(4);
  const lista = r.proximos.slice(0, max);
  if (!lista.length) texto(w, 'Nada vencendo nos próximos 7 dias.', 12, { cor: APOIO });
  for (const p of lista) {
    const l = linha(w); l.spacing = 6;
    const d = l.addStack(); d.size = new Size(44, 0); texto(d, p.vencido ? 'venc.' : dia(p.data), 12, { cor: p.vencido ? COR.vermelho : APOIO });
    texto(l, p.descricao, 12, { cor: p.foraDoSaldo ? APOIO : TEXTO }); l.addSpacer();
    texto(l, (p.tipo === 'Entrada' ? '+ ' : '− ') + brl(p.valor, 2).replace('R$ ', ''), 12, { peso: 'medio', cor: p.tipo === 'Entrada' ? COR.verde : p.vencido ? COR.vermelho : TEXTO });
  }
}

function montar(familia, r, estado) {
  const w = new ListWidget();
  w.url = BASE + '/#/caixa';
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (familia === 'accessoryInline') { texto(w, 'Caixa ' + compacto(r.caixaHoje) + ' · menor ' + compacto(r.menor.saldo) + ' em ' + dia(r.menor.data)); return w; }
  if (familia === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    texto(w, compacto(r.caixaHoje).replace(' mil', 'k').replace(' mi', 'M'), 14, { peso: 'forte' }).centerAlignText();
    texto(w, 'caixa', 10, { cor: APOIO }).centerAlignText();
    return w;
  }
  if (familia === 'accessoryRectangular') {
    texto(w, 'Caixa ' + brl(r.caixaHoje), 14, { peso: 'forte' });
    texto(w, 'menor ' + brl(r.menor.saldo) + ' · ' + dia(r.menor.data), 12);
    texto(w, r.vencidos.pagar > 0 ? 'vencido ' + brl(r.vencidos.pagar) : 'mínimo ' + brl(r.minimo), 12);
    return w;
  }
  w.backgroundColor = FUNDO;
  if (familia === 'small') {
    w.setPadding(14, 14, 12, 14);
    const c = linha(w); texto(c, 'Caixa hoje', 12, { cor: APOIO }); c.addSpacer(); ponto(c, COR[r.saude.geral] || APOIO, 10);
    w.addSpacer();
    texto(w, brl(r.caixaHoje), 24, { peso: 'forte', cor: corSaldo(r.caixaHoje, r), escala: 0.5 });
    texto(w, 'mínimo ' + brl(r.minimo), 11, { cor: APOIO });
    w.addSpacer(6);
    if (r.vencidos.pagar > 0) texto(w, 'pagar vencido ' + brl(r.vencidos.pagar), 11, { cor: COR.vermelho });
    else texto(w, 'menor ' + brl(r.menor.saldo) + ' em ' + dia(r.menor.data), 11, { cor: r.menor.saldo < r.minimo ? COR.amarelo : APOIO });
    w.addSpacer();
    texto(w, (estado.semRede ? 'sem conexão · ' : '') + hora(r.geradoEm), 10, { cor: estado.semRede ? COR.amarelo : APOIO });
    return w;
  }
  const grande = familia === 'large' || familia === 'extraLarge';
  const largura = familia === 'extraLarge' ? 660 : 300;
  w.setPadding(14, 16, 14, 16);
  cabecalho(w, r, estado); w.addSpacer(6);
  const img = w.addImage(curva(r, largura, grande ? 90 : 56)); img.imageSize = new Size(largura, grande ? 90 : 56);
  w.addSpacer(6);
  trio(w, r);
  if (!grande) return w;
  w.addSpacer(12);
  proximos(w, r, familia === 'extraLarge' ? 8 : 6);
  w.addSpacer();
  alertas(w, r);
  return w;
}

function aviso(familia, titulo, detalhe) {
  const w = new ListWidget(); w.url = BASE + '/#/caixa';
  if (familia && familia.indexOf('accessory') === 0) { texto(w, 'EIFF: ' + titulo, 12, { linhas: 2 }); return w; }
  w.backgroundColor = FUNDO; w.setPadding(14, 14, 14, 14);
  texto(w, 'Caixa · EIFF', 12, { peso: 'medio', cor: LARANJA }); w.addSpacer(6);
  texto(w, titulo, 14, { peso: 'medio', linhas: 2 }); w.addSpacer(4);
  texto(w, detalhe, 11, { cor: APOIO, linhas: 4 });
  w.addSpacer();
  return w;
}

async function buscar(token) {
  const fm = FileManager.local();
  const arquivo = fm.joinPath(fm.cacheDirectory(), CACHE);
  const req = new Request(BASE + '/api/widget-caixa');
  req.headers = { authorization: 'Bearer ' + token, accept: 'application/json' };
  req.timeoutInterval = 25;
  let corpo; let status = 0;
  try { corpo = await req.loadJSON(); status = req.response.statusCode; }
  catch (e) {
    if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
    return { erro: 'Sem conexão', detalhe: 'Não foi possível falar com o EIFF Control e ainda não há resumo guardado neste iPad.' };
  }
  if (status === 200 && corpo && corpo.versao === 1) { fm.writeString(arquivo, JSON.stringify(corpo)); return { resumo: corpo, semRede: false }; }
  if (status === 401 || status === 403) { if (fm.fileExists(arquivo)) fm.remove(arquivo); return { erro: 'Acesso do widget recusado', detalhe: (corpo && corpo.mensagem) || 'Gere um novo token em Caixa › Widgets do iPad.' }; }
  if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
  return { erro: 'Resumo indisponível', detalhe: (corpo && corpo.mensagem) || 'Tente de novo em instantes.' };
}

async function configurarToken() {
  const copiado = (Pasteboard.paste() || '').trim();
  if (/^eiffw_[0-9a-f]{64}$/.test(copiado)) {
    const a = new Alert(); a.title = 'Usar o token copiado?'; a.message = 'Token do aparelho terminado em ' + copiado.slice(-4) + '. Ele fica guardado no Keychain deste iPad.';
    a.addAction('Usar'); a.addCancelAction('Cancelar');
    if ((await a.presentAlert()) === 0) { Keychain.set(CHAVE, copiado); Pasteboard.copy(''); return true; }
    return false;
  }
  const a = new Alert(); a.title = 'Token do widget'; a.message = 'Cole o token gerado em EIFF Control › Caixa › Widgets do iPad (começa com eiffw_).';
  a.addSecureTextField('eiffw_…', ''); a.addAction('Guardar'); a.addCancelAction('Cancelar');
  if ((await a.presentAlert()) !== 0) return false;
  const t = a.textFieldValue(0).trim();
  if (!/^eiffw_[0-9a-f]{64}$/.test(t)) { const e = new Alert(); e.title = 'Token inválido'; e.message = 'Confira se copiou o token inteiro.'; e.addAction('OK'); await e.presentAlert(); return false; }
  Keychain.set(CHAVE, t); Pasteboard.copy(''); return true;
}

async function main() {
  if (config.runsInWidget) {
    const familia = config.widgetFamily;
    if (!Keychain.contains(CHAVE)) { Script.setWidget(aviso(familia, 'Configure o token', 'Abra o app Scriptable e toque no script "' + Script.name() + '".')); return Script.complete(); }
    const x = await buscar(Keychain.get(CHAVE));
    Script.setWidget(x.resumo ? montar(familia, x.resumo, x) : aviso(familia, x.erro, x.detalhe));
    return Script.complete();
  }
  if (!Keychain.contains(CHAVE) && !(await configurarToken())) return Script.complete();
  const m = new Alert(); m.title = 'EIFF Caixa';
  m.message = 'Adicione o widget pela tela de início ou de bloqueio (Scriptable › escolha este script).';
  for (const t of ['Prévia pequena', 'Prévia média', 'Prévia grande', 'Prévia extra grande', 'Trocar o token', 'Remover o token']) m.addAction(t);
  m.addCancelAction('Fechar');
  const i = await m.presentAlert();
  if (i >= 0 && i <= 3) {
    const familia = ['small', 'medium', 'large', 'extraLarge'][i];
    const x = await buscar(Keychain.get(CHAVE));
    const w = x.resumo ? montar(familia, x.resumo, x) : aviso(familia, x.erro, x.detalhe);
    if (i === 0) await w.presentSmall(); else if (i === 1) await w.presentMedium(); else if (i === 2) await w.presentLarge(); else await w.presentExtraLarge();
  } else if (i === 4) { await configurarToken(); }
  else if (i === 5) { Keychain.remove(CHAVE); }
  Script.complete();
}

await main();
`;

/** Texto do script do Scriptable para este site. `base` = origem do EIFF Control (ex.: https://eiffcontrol.com.br). */
export function scriptWidgetCaixa(base: string): string {
  const origem = base.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origem)) throw new Error('endereço do site inválido para o widget');
  return MODELO.replace('__EIFF_BASE__', origem).replace('__EIFF_CHAVE__', CHAVE_KEYCHAIN_WIDGET);
}
