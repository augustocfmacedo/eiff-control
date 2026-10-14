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
const CACHE_PEDIDOS = 'eiff-pedidos-resumo.json';
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

// ------------------------------------------------------------------ visão "pedidos" (parâmetro do widget = pedidos)
const COR_ACAO = { programar: COR.verde, reagendar: COR.amarelo, avaliar: COR.amarelo, recusar: COR.vermelho };
const STATUS_DECIDIDO = { aguardando: 'aguardando', programado: 'programado', em_aprovacao: 'em aprovação', reagendado: 'reagendado', recusado: 'recusado', pago: 'pago' };
function linhaPedido(w, p) {
  const l1 = linha(w); l1.spacing = 6;
  if (p.novo) { texto(l1, 'novo', 10, { peso: 'medio', cor: LARANJA }); }
  texto(l1, p.descricao, 12, { peso: 'medio' }); l1.addSpacer();
  texto(l1, brl(p.valor, 2).replace('R$ ', ''), 12, { peso: 'medio' });
  const l2 = linha(w); l2.spacing = 6;
  texto(l2, p.solicitante + ' · ' + dia(p.vencimento) + (p.diasEsperando ? ' · há ' + p.diasEsperando + 'd' : ''), 11, { cor: APOIO }); l2.addSpacer();
  texto(l2, p.orientacao, 11, { cor: COR_ACAO[p.acao] || APOIO });
}
function montarPedidos(familia, r, estado) {
  const w = new ListWidget();
  w.url = BASE + '/#/diretor';
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const n = r.totalPendentes;
  const resumo = n ? n + (n === 1 ? ' pedido' : ' pedidos') + ' · ' + brl(r.valorPendente) : 'Sem pedidos da equipe';
  if (familia === 'accessoryInline') { texto(w, 'EIFF: ' + resumo); return w; }
  if (familia === 'accessoryCircular') { w.addAccessoryWidgetBackground = true; texto(w, String(n), 18, { peso: 'forte' }).centerAlignText(); texto(w, 'pedidos', 10, { cor: APOIO }).centerAlignText(); return w; }
  if (familia === 'accessoryRectangular') {
    texto(w, resumo, 13, { peso: 'forte' });
    if (n) { const p = r.pendentes[0]; texto(w, p.solicitante + ' · ' + brl(p.valor) + ' · ' + dia(p.vencimento), 12); texto(w, p.orientacao, 12); }
    return w;
  }
  w.backgroundColor = FUNDO;
  const c = linha(w);
  ponto(c, n ? LARANJA : COR.verde, 8); c.addSpacer(5);
  texto(c, familia === 'small' ? 'Pedidos' : 'Pedidos da equipe · EIFF', 12, { peso: 'medio', cor: APOIO }); c.addSpacer();
  texto(c, (estado.semRede ? 'sem conexão · ' : '') + hora(r.geradoEm), 11, { cor: estado.semRede ? COR.amarelo : APOIO });
  if (familia === 'small') {
    w.setPadding(14, 14, 12, 14); w.addSpacer();
    texto(w, String(n), 30, { peso: 'forte', cor: n ? TEXTO : COR.verde });
    texto(w, n ? 'aguardando · ' + brl(r.valorPendente) : 'nada aguardando', 11, { cor: APOIO });
    w.addSpacer(6);
    if (n) { const p = r.pendentes[0]; texto(w, p.solicitante + ' · ' + dia(p.vencimento), 11, { cor: APOIO }); texto(w, p.orientacao, 11, { cor: COR_ACAO[p.acao] || APOIO }); }
    w.addSpacer();
    return w;
  }
  const grande = familia === 'large' || familia === 'extraLarge';
  w.setPadding(14, 16, 14, 16); w.addSpacer(6);
  if (!n) { texto(w, 'Nenhum pedido aguardando sua decisão.', 13); }
  else {
    const t = linha(w); texto(t, resumo, 13, { peso: 'medio' }); t.addSpacer();
    const k = r.contagem; const partes = [];
    if (k.programar) partes.push(k.programar + ' programar');
    if (k.reagendar) partes.push(k.reagendar + ' reagendar');
    if (k.avaliar) partes.push(k.avaliar + ' seu aval');
    if (k.recusar) partes.push(k.recusar + ' não rec.');
    texto(t, partes.join(' · '), 11, { cor: APOIO });
    w.addSpacer(6);
    const max = familia === 'extraLarge' ? 8 : grande ? 6 : 2;
    for (const p of r.pendentes.slice(0, max)) { linhaPedido(w, p); w.addSpacer(4); }
    if (n > max) texto(w, '+ ' + (n - max) + ' na Central do Diretor', 11, { cor: APOIO });
  }
  if (grande && r.decididos.length) {
    w.addSpacer(8); texto(w, 'Decididos nos últimos dias', 12, { peso: 'medio', cor: APOIO }); w.addSpacer(2);
    for (const d of r.decididos.slice(0, 3)) {
      const l = linha(w); l.spacing = 6;
      texto(l, (STATUS_DECIDIDO[d.status] || d.status) + ' · ' + d.descricao, 11, { cor: APOIO }); l.addSpacer();
      texto(l, brl(d.valor), 11, { cor: APOIO });
    }
  }
  w.addSpacer();
  return w;
}
// aviso de pedido novo: compara com os pedidos já vistos neste iPad (a primeira vez só memoriza, não avisa)
async function avisarNovos(r) {
  try {
    const fm = FileManager.local();
    const arq = fm.joinPath(fm.cacheDirectory(), 'eiff-pedidos-vistos.json');
    const atuais = r.pendentes.map((p) => p.id);
    if (!fm.fileExists(arq)) { fm.writeString(arq, JSON.stringify(atuais)); return 0; }
    const vistos = JSON.parse(fm.readString(arq));
    const novos = r.pendentes.filter((p) => vistos.indexOf(p.id) < 0);
    for (const p of novos.slice(0, 3)) {
      const n = new Notification();
      n.title = 'Novo pedido de ' + p.solicitante;
      n.body = p.descricao + ' · ' + brl(p.valor, 2) + ' para ' + dia(p.vencimento) + ' · ' + p.orientacao;
      n.openURL = BASE + '/#/diretor';
      n.threadIdentifier = 'eiff-pedidos';
      await n.schedule();
    }
    if (novos.length > 3) { const n = new Notification(); n.title = 'EIFF: mais ' + (novos.length - 3) + ' pedido(s) novo(s)'; n.body = 'Abra a Central do Diretor.'; n.openURL = BASE + '/#/diretor'; n.threadIdentifier = 'eiff-pedidos'; await n.schedule(); }
    fm.writeString(arq, JSON.stringify(Array.from(new Set(vistos.concat(atuais))).slice(-500)));
    return novos.length;
  } catch (e) { return 0; }
}

function aviso(familia, titulo, detalhe, visao) {
  const w = new ListWidget(); w.url = BASE + (visao === 'pedidos' ? '/#/diretor' : '/#/caixa');
  if (familia && familia.indexOf('accessory') === 0) { texto(w, 'EIFF: ' + titulo, 12, { linhas: 2 }); return w; }
  w.backgroundColor = FUNDO; w.setPadding(14, 14, 14, 14);
  texto(w, visao === 'pedidos' ? 'Pedidos · EIFF' : 'Caixa · EIFF', 12, { peso: 'medio', cor: LARANJA }); w.addSpacer(6);
  texto(w, titulo, 14, { peso: 'medio', linhas: 2 }); w.addSpacer(4);
  texto(w, detalhe, 11, { cor: APOIO, linhas: 4 });
  w.addSpacer();
  return w;
}

async function buscar(token, visao) {
  const fm = FileManager.local();
  const arquivo = fm.joinPath(fm.cacheDirectory(), visao === 'pedidos' ? CACHE_PEDIDOS : CACHE);
  const req = new Request(BASE + '/api/widget-caixa' + (visao === 'pedidos' ? '?visao=pedidos' : ''));
  req.headers = { authorization: 'Bearer ' + token, accept: 'application/json' };
  req.timeoutInterval = 25;
  let corpo; let status = 0;
  try { corpo = await req.loadJSON(); status = req.response.statusCode; }
  catch (e) {
    if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
    return { erro: 'Sem conexão', detalhe: 'Não foi possível falar com o EIFF Control e ainda não há resumo guardado neste iPad.' };
  }
  const valido = corpo && corpo.versao === 1 && (visao === 'pedidos' ? corpo.visao === 'pedidos' : !corpo.visao);
  if (status === 200 && valido) { fm.writeString(arquivo, JSON.stringify(corpo)); return { resumo: corpo, semRede: false }; }
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

// parâmetro do widget (toque e segure › Editar widget › Parameter): vazio ou "caixa" = caixa; "pedidos" = pedidos da equipe
function visaoDoParametro() {
  const p = (typeof args !== 'undefined' && args && args.widgetParameter ? String(args.widgetParameter) : '').trim().toLowerCase();
  return p === 'pedidos' ? 'pedidos' : 'caixa';
}
function desenhar(familia, visao, x) {
  if (!x.resumo) return aviso(familia, x.erro, x.detalhe, visao);
  return visao === 'pedidos' ? montarPedidos(familia, x.resumo, x) : montar(familia, x.resumo, x);
}

async function main() {
  if (config.runsInWidget) {
    const familia = config.widgetFamily;
    const visao = visaoDoParametro();
    if (!Keychain.contains(CHAVE)) { Script.setWidget(aviso(familia, 'Configure o token', 'Abra o app Scriptable e toque no script "' + Script.name() + '".', visao)); return Script.complete(); }
    const x = await buscar(Keychain.get(CHAVE), visao);
    if (visao === 'pedidos' && x.resumo && !x.semRede) await avisarNovos(x.resumo);
    Script.setWidget(desenhar(familia, visao, x));
    return Script.complete();
  }
  if (!Keychain.contains(CHAVE) && !(await configurarToken())) return Script.complete();
  const m = new Alert(); m.title = 'EIFF Caixa';
  m.message = 'Adicione o widget pela tela de início ou de bloqueio (Scriptable › escolha este script). Para os pedidos da equipe, escreva pedidos no campo Parameter do widget.';
  const opcoes = ['Prévia pequena', 'Prévia média', 'Prévia grande', 'Prévia extra grande', 'Prévia pedidos (média)', 'Prévia pedidos (grande)', 'Trocar o token', 'Remover o token'];
  for (const t of opcoes) m.addAction(t);
  m.addCancelAction('Fechar');
  const i = await m.presentAlert();
  if (i >= 0 && i <= 5) {
    const visao = i >= 4 ? 'pedidos' : 'caixa';
    const familia = ['small', 'medium', 'large', 'extraLarge', 'medium', 'large'][i];
    const x = await buscar(Keychain.get(CHAVE), visao);
    const w = desenhar(familia, visao, x);
    if (familia === 'small') await w.presentSmall(); else if (familia === 'medium') await w.presentMedium(); else if (familia === 'large') await w.presentLarge(); else await w.presentExtraLarge();
  } else if (i === 6) { await configurarToken(); }
  else if (i === 7) { Keychain.remove(CHAVE); }
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
