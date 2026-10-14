// Widgets do iPad: script PRÓPRIO do widget de pagamentos do dia (pedido do Augusto em 14/10/2026: lista dos pagamentos de
// hoje com a situação de cada um e o somatório, para a tela de início do iPad). Só pede /api/widget-caixa?visao=pagamentos;
// usa a MESMA chave do Keychain dos scripts do caixa e dos pedidos (o token já guardado vale para os três). Pede ao iOS nova
// atualização a cada 15 minutos (refreshAfterDate), a regra dos widgets da EIFF; o iOS pode atrasar, nunca adiantar.
// Testado em src/core/widgetScriptable.test.ts com o Scriptable simulado.
import { CHAVE_KEYCHAIN_WIDGET } from './widgetScriptable';

export const NOME_SCRIPT_PAGAMENTOS = 'EIFF Pagamentos';
export const MINUTOS_ATUALIZACAO_WIDGET = 15;

const MODELO = String.raw`// EIFF Control · widget dos pagamentos do dia (Scriptable). Gerado pelo EIFF Control em Caixa › Widgets do iPad.
// Lista o que sai do caixa hoje — atrasados, a pagar, em aprovação e já pagos — com o total, o quanto falta e o caixa depois
// de pagar. Atualiza a cada __EIFF_MINUTOS__ minutos. O token do aparelho fica no Keychain do iPad, nunca neste arquivo.
const BASE = '__EIFF_BASE__';
const CHAVE = '__EIFF_CHAVE__';
const MINUTOS = __EIFF_MINUTOS__;
const CACHE = 'eiff-pagamentos-resumo.json';
const LARANJA = new Color('#d1481c');
const TEXTO = Color.dynamic(new Color('#16181d'), new Color('#f2f3f5'));
const APOIO = Color.dynamic(new Color('#5f6670'), new Color('#9aa1ab'));
const TRILHO = Color.dynamic(new Color('#e6e8eb'), new Color('#2a2e35'));
const DIVISOR = Color.dynamic(new Color('#e9ebee'), new Color('#24282e'));
const COR = { vermelho: new Color('#e5484d'), amarelo: new Color('#f5a524'), verde: new Color('#46a758') };
const STATUS = {
  atrasado: { rotulo: 'ATRASADO', cor: COR.vermelho },
  a_pagar: { rotulo: 'A PAGAR', cor: LARANJA },
  aprovacao: { rotulo: 'APROVAÇÃO', cor: COR.amarelo },
  pago: { rotulo: 'PAGO', cor: COR.verde },
};
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function brl(v, casas) {
  const c = casas === undefined ? 0 : casas;
  const partes = Math.abs(v).toFixed(c).split('.');
  return (v < 0 ? '−' : '') + 'R$ ' + milhar(partes[0]) + (partes[1] ? ',' + partes[1] : '');
}
function compacto(v) {
  const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + 'R$ ' + (a / 1e6).toFixed(1).replace('.', ',') + ' mi';
  if (a >= 1e5) return s + 'R$ ' + Math.round(a / 1e3) + ' mil';
  if (a >= 1e4) return s + 'R$ ' + (Math.round(a / 100) / 10).toFixed(1).replace('.0', '').replace('.', ',') + ' mil';
  return brl(v);
}
function dia(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function diaSemana(iso) { const d = new Date(iso + 'T12:00:00'); return SEMANA[d.getDay()] + ', ' + dia(iso); }
function hora(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

function texto(alvo, t, tamanho, opcoes) {
  const o = opcoes || {};
  const el = alvo.addText(t);
  el.font = o.peso === 'forte' ? Font.boldRoundedSystemFont(tamanho) : o.peso === 'medio' ? Font.semiboldSystemFont(tamanho) : Font.systemFont(tamanho);
  el.textColor = o.cor || TEXTO;
  el.lineLimit = o.linhas || 1;
  el.minimumScaleFactor = o.escala || 0.6;
  return el;
}
function linha(alvo) { const s = alvo.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function coluna(alvo) { const s = alvo.addStack(); s.layoutVertically(); return s; }
function ponto(alvo, cor, tamanho) {
  const dc = new DrawContext(); dc.size = new Size(tamanho, tamanho); dc.opaque = false; dc.respectScreenScale = true;
  dc.setFillColor(cor); dc.fillEllipse(new Rect(0, 0, tamanho, tamanho));
  const img = alvo.addImage(dc.getImage()); img.imageSize = new Size(tamanho, tamanho);
}
function fundo(w) {
  const g = new LinearGradient();
  g.colors = [Color.dynamic(new Color('#ffffff'), new Color('#1c1f24')), Color.dynamic(new Color('#f3f4f6'), new Color('#111316'))];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}

// barra empilhada: pago (verde), atrasado (vermelho), a pagar (laranja) sobre o trilho; aprovação fica fora (não sai hoje)
function barra(alvo, r, largura, altura) {
  const dc = new DrawContext(); dc.size = new Size(largura, altura); dc.opaque = false; dc.respectScreenScale = true;
  const raio = altura / 2;
  const trilho = new Path(); trilho.addRoundedRect(new Rect(0, 0, largura, altura), raio, raio);
  dc.addPath(trilho); dc.setFillColor(TRILHO); dc.fillPath();
  if (r.total > 0) {
    let x = 0;
    for (const [chave, cor] of [['pago', COR.verde], ['atrasado', COR.vermelho], ['a_pagar', LARANJA]]) {
      const v = r.valor[chave]; if (!(v > 0)) continue;
      const w = Math.max(altura, (v / r.total) * largura);
      const larg = Math.min(w, largura - x); if (larg <= 0) continue;
      const p = new Path(); p.addRoundedRect(new Rect(x, 0, larg, altura), raio, raio);
      dc.addPath(p); dc.setFillColor(cor); dc.fillPath();
      x += larg;
    }
  }
  const img = alvo.addImage(dc.getImage()); img.imageSize = new Size(largura, altura);
  return img;
}

// anel da tela de bloqueio: fração paga do dia
function anel(alvo, fracao, tamanho) {
  const dc = new DrawContext(); dc.size = new Size(tamanho, tamanho); dc.opaque = false; dc.respectScreenScale = true;
  const c = tamanho / 2; const raio = c - 3; const passos = 60;
  const arco = (de, ate) => { const pts = []; for (let i = 0; i <= passos; i++) { const a = -Math.PI / 2 + (de + (ate - de) * (i / passos)) * 2 * Math.PI; pts.push(new Point(c + raio * Math.cos(a), c + raio * Math.sin(a))); } const p = new Path(); p.addLines(pts); return p; };
  dc.setLineWidth(4);
  dc.addPath(arco(0, 1)); dc.setStrokeColor(new Color('#ffffff', 0.25)); dc.strokePath();
  if (fracao > 0) { dc.addPath(arco(0, Math.min(1, fracao))); dc.setStrokeColor(new Color('#ffffff')); dc.strokePath(); }
  const img = alvo.addImage(dc.getImage()); img.imageSize = new Size(tamanho, tamanho);
}

function chip(alvo, p) {
  const s = alvo.addStack(); s.setPadding(2, 6, 2, 6); s.cornerRadius = 5;
  const st = STATUS[p.status] || { rotulo: p.status, cor: APOIO };
  s.backgroundColor = new Color(st.cor.hex, 0.16);
  const rot = p.status === 'atrasado' && p.diasAtraso ? st.rotulo + ' ' + p.diasAtraso + 'D' : st.rotulo;
  texto(s, rot, 9, { peso: 'medio', cor: st.cor, escala: 0.8 });
  return s;
}

function linhaPagamento(w, p, larga) {
  const l = linha(w); l.spacing = 8;
  const ch = linha(l); ch.size = new Size(larga ? 86 : 74, 0); chip(ch, p); ch.addSpacer();
  const pago = p.status === 'pago';
  const meio = coluna(l);
  texto(meio, p.descricao, 12, { peso: 'medio', cor: pago ? APOIO : TEXTO });
  if (larga) texto(meio, [p.para, p.departamento].filter(Boolean).join(' · ') || ' ', 10, { cor: APOIO });
  l.addSpacer();
  texto(l, brl(p.valor, 2), 12, { peso: 'medio', cor: pago ? APOIO : TEXTO });
}

function cabecalho(w, r, estado, titulo) {
  const c = linha(w);
  ponto(c, r.falta > 0 ? LARANJA : COR.verde, 7); c.addSpacer(6);
  texto(c, titulo, 12, { peso: 'medio', cor: APOIO }); c.addSpacer();
  texto(c, (estado.semRede ? 'sem conexão · ' : '') + hora(r.geradoEm), 11, { cor: estado.semRede ? COR.amarelo : APOIO });
}

function legenda(w, r) {
  const l = linha(w); l.spacing = 10;
  for (const [chave, nome, cor] of [['pago', 'Pago', COR.verde], ['a_pagar', 'A pagar', LARANJA], ['atrasado', 'Atrasado', COR.vermelho], ['aprovacao', 'Aprovação', COR.amarelo]]) {
    if (!r.quantidade[chave]) continue;
    const s = linha(l); s.spacing = 4; ponto(s, cor, 6);
    texto(s, nome + ' ' + compacto(r.valor[chave]), 10, { cor: APOIO });
  }
  l.addSpacer();
}

function rodape(w, r) {
  const l = linha(w);
  const cor = r.caixaAposPagar < 0 ? COR.vermelho : r.abaixoDoMinimo ? COR.amarelo : APOIO;
  texto(l, 'Caixa depois de pagar', 11, { cor: APOIO }); l.addSpacer(6);
  texto(l, brl(r.caixaAposPagar), 11, { peso: 'medio', cor: cor === APOIO ? TEXTO : cor });
  l.addSpacer();
  texto(l, r.abaixoDoMinimo ? 'abaixo do mínimo ' + compacto(r.minimo) : 'mínimo ' + compacto(r.minimo), 10, { cor: cor });
}

function divisor(w, largura) {
  const dc = new DrawContext(); dc.size = new Size(largura, 1); dc.opaque = false; dc.respectScreenScale = true;
  dc.setFillColor(DIVISOR); dc.fillRect(new Rect(0, 0, largura, 1));
  const img = w.addImage(dc.getImage()); img.imageSize = new Size(largura, 1);
}

function montar(familia, r, estado) {
  const w = new ListWidget();
  w.url = BASE + '/#/caixa';
  w.refreshAfterDate = new Date(Date.now() + MINUTOS * 60 * 1000);
  const n = r.quantidade.atrasado + r.quantidade.a_pagar + r.quantidade.pago;
  const pagos = r.quantidade.pago;
  const abertos = r.quantidade.atrasado + r.quantidade.a_pagar;

  if (familia === 'accessoryInline') {
    texto(w, n ? 'Pagar hoje ' + compacto(r.falta) + ' · pago ' + compacto(r.valor.pago) : 'Sem pagamentos hoje');
    return w;
  }
  if (familia === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const z = w.addStack(); z.layoutVertically(); z.centerAlignContent();
    anel(z, r.progresso, 50);
    const t = linha(w); t.addSpacer(); texto(t, n ? pagos + '/' + n : 'ok', 11, { peso: 'forte' }); t.addSpacer();
    return w;
  }
  if (familia === 'accessoryRectangular') {
    texto(w, 'Pagamentos ' + dia(r.hoje) + ' · ' + compacto(r.total), 13, { peso: 'forte' });
    texto(w, abertos ? 'Falta ' + brl(r.falta) + ' (' + abertos + ')' : n ? 'Tudo pago hoje' : 'Nada para pagar hoje', 12);
    texto(w, r.quantidade.atrasado ? plural(r.quantidade.atrasado, 'atrasado', 'atrasados') + ' · ' + compacto(r.valor.atrasado) : pagos + ' de ' + n + ' pagos', 12);
    return w;
  }

  fundo(w);
  if (familia === 'small') {
    w.setPadding(14, 14, 12, 14);
    cabecalho(w, r, estado, 'Pagar hoje');
    w.addSpacer();
    texto(w, brl(r.falta), 24, { peso: 'forte', cor: r.falta > 0 ? TEXTO : COR.verde, escala: 0.5 });
    texto(w, abertos ? 'falta · de ' + compacto(r.total) : n ? 'tudo pago' : 'nada para hoje', 11, { cor: APOIO });
    w.addSpacer(8);
    barra(w, r, 130, 6);
    w.addSpacer(6);
    texto(w, n ? pagos + ' de ' + n + ' pagos' : '—', 11, { peso: 'medio', cor: APOIO });
    if (r.quantidade.atrasado) texto(w, plural(r.quantidade.atrasado, 'atrasado', 'atrasados'), 11, { cor: COR.vermelho });
    else if (r.quantidade.aprovacao) texto(w, r.quantidade.aprovacao + ' em aprovação', 11, { cor: COR.amarelo });
    w.addSpacer();
    return w;
  }

  const grande = familia === 'large' || familia === 'extraLarge';
  const larga = familia === 'extraLarge' || familia === 'large';
  const largura = familia === 'extraLarge' ? 680 : 290;
  w.setPadding(14, 16, 12, 16);
  cabecalho(w, r, estado, 'Pagamentos de hoje · ' + diaSemana(r.hoje));
  w.addSpacer(grande ? 10 : 6);

  const topo = linha(w);
  const esq = coluna(topo);
  texto(esq, brl(r.total, 2), grande ? 30 : 24, { peso: 'forte', escala: 0.5 });
  texto(esq, n ? plural(n, 'pagamento', 'pagamentos') + ' · ' + plural(pagos, 'pago', 'pagos') : 'Nenhum pagamento para hoje', 11, { cor: APOIO });
  topo.addSpacer();
  const dir = coluna(topo);
  const fl = linha(dir); fl.addSpacer(); texto(fl, 'falta pagar', 10, { cor: APOIO });
  const fv = linha(dir); fv.addSpacer(); texto(fv, brl(r.falta, 2), grande ? 18 : 15, { peso: 'forte', cor: r.falta > 0 ? (r.quantidade.atrasado ? COR.vermelho : LARANJA) : COR.verde, escala: 0.6 });
  w.addSpacer(8);
  barra(w, r, largura, grande ? 8 : 6);
  w.addSpacer(6);
  legenda(w, r);

  const visiveis = r.itens;
  const max = familia === 'extraLarge' ? 8 : familia === 'large' ? 7 : 2;
  if (!visiveis.length) {
    w.addSpacer(grande ? 16 : 8);
    const v = linha(w); ponto(v, COR.verde, 8); v.addSpacer(6); texto(v, 'Nenhum pagamento vence hoje.', 13, { cor: APOIO });
  } else {
    w.addSpacer(grande ? 10 : 6);
    if (grande) { divisor(w, largura); w.addSpacer(8); }
    for (const p of visiveis.slice(0, max)) { linhaPagamento(w, p, larga); w.addSpacer(grande ? 7 : 4); }
    const total = n + r.quantidade.aprovacao;
    if (total > max) texto(w, '+ ' + (total - max) + ' na Caixa', 10, { cor: APOIO });
  }
  w.addSpacer();
  if (grande) { divisor(w, largura); w.addSpacer(6); rodape(w, r); }
  return w;
}

function aviso(familia, titulo, detalhe) {
  const w = new ListWidget(); w.url = BASE + '/#/caixa';
  w.refreshAfterDate = new Date(Date.now() + MINUTOS * 60 * 1000);
  if (familia && familia.indexOf('accessory') === 0) { texto(w, 'EIFF: ' + titulo, 12, { linhas: 2 }); return w; }
  fundo(w); w.setPadding(14, 14, 14, 14);
  texto(w, 'Pagamentos · EIFF', 12, { peso: 'medio', cor: LARANJA }); w.addSpacer(6);
  texto(w, titulo, 14, { peso: 'medio', linhas: 2 }); w.addSpacer(4);
  texto(w, detalhe, 11, { cor: APOIO, linhas: 4 });
  w.addSpacer();
  return w;
}

async function buscar(token) {
  const fm = FileManager.local();
  const arquivo = fm.joinPath(fm.cacheDirectory(), CACHE);
  const req = new Request(BASE + '/api/widget-caixa?visao=pagamentos');
  req.headers = { authorization: 'Bearer ' + token, accept: 'application/json' };
  req.timeoutInterval = 25;
  let corpo; let status = 0;
  try { corpo = await req.loadJSON(); status = req.response.statusCode; }
  catch (e) {
    if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
    return { erro: 'Sem conexão', detalhe: 'Não foi possível falar com o EIFF Control e ainda não há pagamentos guardados neste iPad.' };
  }
  if (status === 200 && corpo && corpo.versao === 1 && corpo.visao === 'pagamentos') { fm.writeString(arquivo, JSON.stringify(corpo)); return { resumo: corpo, semRede: false }; }
  if (status === 401 || status === 403) { if (fm.fileExists(arquivo)) fm.remove(arquivo); return { erro: 'Acesso do widget recusado', detalhe: (corpo && corpo.mensagem) || 'Gere um novo token em Caixa › Widgets do iPad.' }; }
  if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
  return { erro: 'Pagamentos indisponíveis', detalhe: (corpo && corpo.mensagem) || 'Tente de novo em instantes.' };
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
  const m = new Alert(); m.title = 'EIFF Pagamentos';
  m.message = 'Pagamentos de hoje com a situação de cada um e o total. Adicione o widget pela tela de início ou de bloqueio (Scriptable › escolha este script). Atualiza a cada ' + MINUTOS + ' minutos.';
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

/** Texto do script do widget de pagamentos do dia para este site (mesmas regras de endereço do script do caixa). */
export function scriptWidgetPagamentos(base: string): string {
  const origem = base.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origem)) throw new Error('endereço do site inválido para o widget');
  return MODELO.replace('__EIFF_BASE__', origem).replace('__EIFF_CHAVE__', CHAVE_KEYCHAIN_WIDGET).split('__EIFF_MINUTOS__').join(String(MINUTOS_ATUALIZACAO_WIDGET));
}
