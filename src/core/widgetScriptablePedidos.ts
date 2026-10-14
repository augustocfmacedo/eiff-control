// Widgets do iPad: script PRÓPRIO do widget de pedidos ao Diretor Financeiro (pedido do Augusto em 14/10/2026: o script de
// pedidos não deve carregar a parte do caixa). Só pede /api/widget-caixa?visao=pedidos e só desenha pedidos; não precisa de
// Parameter. Usa a MESMA chave do Keychain do script do caixa (o Keychain do Scriptable é do app): o token já guardado vale
// para os dois. Testado em src/core/widgetScriptablePedidos.test.ts com o Scriptable simulado.
import { CHAVE_KEYCHAIN_WIDGET } from './widgetScriptable';

export const NOME_SCRIPT_PEDIDOS = 'EIFF Pedidos';

const MODELO = String.raw`// EIFF Control · widget dos pedidos ao Diretor Financeiro (Scriptable). Gerado pelo EIFF Control em Caixa › Widgets do iPad.
// Mostra o que a equipe pediu e ainda espera decisão, com a orientação do Diretor, e avisa quando chega pedido novo.
// O token do aparelho fica no Keychain do iPad (o mesmo do widget do caixa), nunca neste arquivo.
const BASE = '__EIFF_BASE__';
const CHAVE = '__EIFF_CHAVE__';
const CACHE = 'eiff-pedidos-resumo.json';
const VISTOS = 'eiff-pedidos-vistos.json';
const LARANJA = new Color('#d1481c');
const FUNDO = Color.dynamic(new Color('#ffffff'), new Color('#15171b'));
const TEXTO = Color.dynamic(new Color('#16181d'), new Color('#f2f3f5'));
const APOIO = Color.dynamic(new Color('#5f6670'), new Color('#9aa1ab'));
const COR = { vermelho: new Color('#e5484d'), amarelo: new Color('#f5a524'), verde: new Color('#46a758') };
const COR_ACAO = { programar: COR.verde, reagendar: COR.amarelo, avaliar: COR.amarelo, recusar: COR.vermelho };
const STATUS_DECIDIDO = { aguardando: 'aguardando', programado: 'programado', em_aprovacao: 'em aprovação', reagendado: 'reagendado', recusado: 'recusado', pago: 'pago' };

function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function brl(v, casas) {
  const c = casas === undefined ? 0 : casas;
  const partes = Math.abs(v).toFixed(c).split('.');
  return (v < 0 ? '−' : '') + 'R$ ' + milhar(partes[0]) + (partes[1] ? ',' + partes[1] : '');
}
function dia(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function hora(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

function texto(alvo, t, tamanho, opcoes) {
  const o = opcoes || {};
  const el = alvo.addText(t);
  el.font = o.peso === 'forte' ? Font.boldSystemFont(tamanho) : o.peso === 'medio' ? Font.semiboldSystemFont(tamanho) : Font.systemFont(tamanho);
  el.textColor = o.cor || TEXTO;
  el.lineLimit = o.linhas || 1;
  el.minimumScaleFactor = o.escala || 0.6;
  return el;
}
function linha(alvo) { const s = alvo.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function ponto(alvo, cor, tamanho) {
  const dc = new DrawContext(); dc.size = new Size(tamanho, tamanho); dc.opaque = false; dc.respectScreenScale = true;
  dc.setFillColor(cor); dc.fillEllipse(new Rect(0, 0, tamanho, tamanho));
  const img = alvo.addImage(dc.getImage()); img.imageSize = new Size(tamanho, tamanho);
}

function linhaPedido(w, p) {
  const l1 = linha(w); l1.spacing = 6;
  if (p.novo) { texto(l1, 'novo', 10, { peso: 'medio', cor: LARANJA }); }
  texto(l1, p.descricao, 12, { peso: 'medio' }); l1.addSpacer();
  texto(l1, brl(p.valor, 2).replace('R$ ', ''), 12, { peso: 'medio' });
  const l2 = linha(w); l2.spacing = 6;
  texto(l2, p.solicitante + ' · ' + dia(p.vencimento) + (p.diasEsperando ? ' · há ' + p.diasEsperando + 'd' : ''), 11, { cor: APOIO }); l2.addSpacer();
  texto(l2, p.orientacao, 11, { cor: COR_ACAO[p.acao] || APOIO });
}

function montar(familia, r, estado) {
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
  texto(c, familia === 'small' ? 'Pedidos' : 'Pedidos ao Diretor · EIFF', 12, { peso: 'medio', cor: APOIO }); c.addSpacer();
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
    const arq = fm.joinPath(fm.cacheDirectory(), VISTOS);
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

function aviso(familia, titulo, detalhe) {
  const w = new ListWidget(); w.url = BASE + '/#/diretor';
  if (familia && familia.indexOf('accessory') === 0) { texto(w, 'EIFF: ' + titulo, 12, { linhas: 2 }); return w; }
  w.backgroundColor = FUNDO; w.setPadding(14, 14, 14, 14);
  texto(w, 'Pedidos · EIFF', 12, { peso: 'medio', cor: LARANJA }); w.addSpacer(6);
  texto(w, titulo, 14, { peso: 'medio', linhas: 2 }); w.addSpacer(4);
  texto(w, detalhe, 11, { cor: APOIO, linhas: 4 });
  w.addSpacer();
  return w;
}

async function buscar(token) {
  const fm = FileManager.local();
  const arquivo = fm.joinPath(fm.cacheDirectory(), CACHE);
  const req = new Request(BASE + '/api/widget-caixa?visao=pedidos');
  req.headers = { authorization: 'Bearer ' + token, accept: 'application/json' };
  req.timeoutInterval = 25;
  let corpo; let status = 0;
  try { corpo = await req.loadJSON(); status = req.response.statusCode; }
  catch (e) {
    if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
    return { erro: 'Sem conexão', detalhe: 'Não foi possível falar com o EIFF Control e ainda não há pedidos guardados neste iPad.' };
  }
  if (status === 200 && corpo && corpo.versao === 1 && corpo.visao === 'pedidos') { fm.writeString(arquivo, JSON.stringify(corpo)); return { resumo: corpo, semRede: false }; }
  if (status === 401 || status === 403) { if (fm.fileExists(arquivo)) fm.remove(arquivo); return { erro: 'Acesso do widget recusado', detalhe: (corpo && corpo.mensagem) || 'Gere um novo token em Caixa › Widgets do iPad.' }; }
  if (fm.fileExists(arquivo)) return { resumo: JSON.parse(fm.readString(arquivo)), semRede: true };
  return { erro: 'Pedidos indisponíveis', detalhe: (corpo && corpo.mensagem) || 'Tente de novo em instantes.' };
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
    if (x.resumo && !x.semRede) await avisarNovos(x.resumo);
    Script.setWidget(x.resumo ? montar(familia, x.resumo, x) : aviso(familia, x.erro, x.detalhe));
    return Script.complete();
  }
  if (!Keychain.contains(CHAVE) && !(await configurarToken())) return Script.complete();
  const m = new Alert(); m.title = 'EIFF Pedidos';
  m.message = 'Pedidos da equipe ao Diretor Financeiro. Adicione o widget pela tela de início ou de bloqueio (Scriptable › escolha este script) e permita as notificações do Scriptable para o aviso de pedido novo.';
  for (const t of ['Prévia pequena', 'Prévia média', 'Prévia grande', 'Prévia extra grande', 'Trocar o token', 'Remover o token']) m.addAction(t);
  m.addCancelAction('Fechar');
  const i = await m.presentAlert();
  if (i >= 0 && i <= 3) {
    const familia = ['small', 'medium', 'large', 'extraLarge'][i];
    const x = await buscar(Keychain.get(CHAVE));
    if (x.resumo && !x.semRede) await avisarNovos(x.resumo);
    const w = x.resumo ? montar(familia, x.resumo, x) : aviso(familia, x.erro, x.detalhe);
    if (i === 0) await w.presentSmall(); else if (i === 1) await w.presentMedium(); else if (i === 2) await w.presentLarge(); else await w.presentExtraLarge();
  } else if (i === 4) { await configurarToken(); }
  else if (i === 5) { Keychain.remove(CHAVE); }
  Script.complete();
}

await main();
`;

/** Texto do script do widget de pedidos para este site (mesmas regras de endereço do script do caixa). */
export function scriptWidgetPedidos(base: string): string {
  const origem = base.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origem)) throw new Error('endereço do site inválido para o widget');
  return MODELO.replace('__EIFF_BASE__', origem).replace('__EIFF_CHAVE__', CHAVE_KEYCHAIN_WIDGET);
}
