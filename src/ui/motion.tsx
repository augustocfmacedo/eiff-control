// Sistema de movimento do EIFF Control (GSAP): revelacao em cascata ao trocar de tela (com transicao compartilhada a
// partir do cartao/linha clicado), contadores de KPI e de tabela, indicador do menu que desliza, ondulacao ao clicar,
// barras que crescem, entrada de cartoes e slides. Tudo respeita prefers-reduced-motion e nunca muda o conteudo: os numeros
// finais sao sempre os do motor; a animacao so percorre o caminho ate eles. GSAP so aqui.
import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { decomporNumero, ehTextoNaoNumerico, recomporNumero, reduzMovimento } from './numero';

export const FACIL = 'power3.out';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Remove qualquer resto de transform/opacity/visibility deixado por uma animacao interrompida. */
const limpar = (els: Element[]) => { if (els.length) gsap.set(els, { clearProps: 'transform,opacity,visibility' }); };

// ---------------------------------------------------------------------------------------------------------------------
// Transicao compartilhada lista -> detalhe: o elemento clicado (cartao de KPI, linha de tabela, link) e lembrado; a tela
// seguinte faz o primeiro bloco "nascer" do lugar dele. Generico: nenhuma tela precisa saber disso.
// ---------------------------------------------------------------------------------------------------------------------
interface Origem { left: number; top: number; width: number; height: number; em: number }
let origem: Origem | null = null;
const SELETOR_ORIGEM = '.content .kpi.link, .content .strip .link, .content tbody tr, .content a[href^="#/"], .content .card.licao, .content .btn';
export function marcarOrigem(el: Element) { const r = el.getBoundingClientRect(); if (r.width && r.height) origem = { left: r.left, top: r.top, width: r.width, height: r.height, em: performance.now() }; }
function consumirOrigem(): Origem | null { const o = origem; origem = null; return o && performance.now() - o.em < 1500 ? o : null; }

/** Revela os blocos de uma tela em cascata (blocos de primeiro nivel, cartoes de grades/faixas e as primeiras linhas das tabelas). */
export function useRevelar(ref: React.RefObject<HTMLElement | null>, chave: string) {
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz || reduzMovimento()) { consumirOrigem(); return; }
    const alvos: Element[] = [];
    for (const filho of Array.from(raiz.children)) {
      if (filho.classList.contains('print-only')) continue;
      if (filho.classList.contains('hero-grid') || filho.classList.contains('grid') || filho.classList.contains('strip')) alvos.push(...Array.from(filho.children));
      else alvos.push(filho);
    }
    if (!alvos.length) return;
    const linhas = Array.from(raiz.querySelectorAll('.table-wrap tbody tr, table tbody tr')).slice(0, 16);
    const o = consumirOrigem();
    const principal = o ? (alvos.find((a) => a.classList.contains('kpi') || a.classList.contains('card')) ?? alvos[0]) : null;
    const tweens: gsap.core.Tween[] = [];
    tweens.push(gsap.fromTo(alvos.filter((a) => a !== principal), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: FACIL, stagger: { each: 0.035, from: 'start' }, clearProps: 'transform,opacity,visibility', overwrite: 'auto' }));
    if (principal && o) {
      const t = principal.getBoundingClientRect();
      if (t.width && t.height) tweens.push(gsap.fromTo(principal, { x: o.left - t.left, y: o.top - t.top, scaleX: clamp(o.width / t.width, 0.15, 1.6), scaleY: clamp(o.height / t.height, 0.15, 1.6), transformOrigin: '0 0', autoAlpha: 0.4 }, { x: 0, y: 0, scaleX: 1, scaleY: 1, autoAlpha: 1, duration: 0.6, ease: FACIL, clearProps: 'transform,opacity,visibility', overwrite: 'auto' }));
    }
    if (linhas.length) tweens.push(gsap.fromTo(linhas, { autoAlpha: 0, x: -6 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: FACIL, stagger: 0.022, delay: 0.12, clearProps: 'transform,opacity,visibility', overwrite: 'auto' }));
    // limpeza explicita (kill + clearProps): nada fica escondido se o efeito for desfeito antes de a cascata terminar
    return () => { tweens.forEach((t) => t.kill()); limpar([...alvos, ...linhas]); };
  }, [ref, chave]);
}

/** Numero formatado que "conta" ate o valor final (e do valor anterior ao novo quando o dado muda).
 *  `leve` (tabelas): conta so na montagem e so em tabelas curtas (<= 30 linhas); mudancas posteriores trocam direto. */
export function NumeroVivo({ texto, className, duracao = 0.9, leve = false }: { texto: string; className?: string; duracao?: number; leve?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null); const anterior = useRef<number | null>(null); const montado = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const d = decomporNumero(texto);
    const primeira = !montado.current; montado.current = true;
    const pular = !d || reduzMovimento() || ehTextoNaoNumerico(texto) || (leve && (!primeira || (el.closest('table')?.querySelectorAll('tbody tr').length ?? 0) > 30));
    if (pular) { el.textContent = texto; anterior.current = d?.valor ?? null; return; }
    const de = anterior.current ?? 0; anterior.current = d.valor;
    if (de === d.valor) { el.textContent = texto; return; }
    const obj = { v: de }; el.textContent = recomporNumero(d, de);
    const tw = gsap.to(obj, { v: d.valor, duration: leve ? 0.6 : duracao, ease: 'power2.out', onUpdate: () => { el.textContent = recomporNumero(d, obj.v); }, onComplete: () => { el.textContent = texto; } });
    return () => { tw.kill(); el.textContent = texto; };
  }, [texto, duracao, leve]);
  return <span ref={ref} className={className}>{texto}</span>;
}
/** Valor de KPI: string numerica vira contador; qualquer outro no vai como esta. */
export const Valor = ({ v }: { v: React.ReactNode }) => (typeof v === 'string' ? <NumeroVivo texto={v} /> : <>{v}</>);

/** Barra que cresce da esquerda ate a largura pedida. */
export function useCrescer(ref: React.RefObject<HTMLElement | null>, fracao: number) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (reduzMovimento()) { el.style.transform = ''; return; }
    const tw = gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, transformOrigin: '0 50%', duration: 0.9, ease: FACIL, clearProps: 'transform' });
    return () => { tw.kill(); };
  }, [ref, fracao]);
}

/** Indicador do menu lateral que desliza ate o item ativo. */
export function IndicadorNav({ chave }: { chave: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; const nav = el?.parentElement; if (!el || !nav) return;
    const ativo = nav.querySelector<HTMLElement>('a.active');
    if (!ativo) { gsap.set(el, { autoAlpha: 0 }); return; }
    const top = ativo.offsetTop; const height = ativo.offsetHeight;
    if (reduzMovimento() || el.style.opacity === '' || el.style.opacity === '0') gsap.set(el, { top, height, autoAlpha: 1 });
    else gsap.to(el, { top, height, autoAlpha: 1, duration: 0.45, ease: FACIL, overwrite: 'auto' });
  }, [chave]);
  return <span ref={ref} className="nav-indicador" aria-hidden="true" />;
}

/** Ondulacao discreta ao clicar em qualquer botao e memoria da origem para a transicao compartilhada (delegado no documento). */
export function MicroInteracoes() {
  useLayoutEffect(() => {
    const reduzido = reduzMovimento();
    const onDown = (e: PointerEvent) => {
      const alvo = e.target as HTMLElement | null; if (!alvo?.closest) return;
      const origemEl = alvo.closest(SELETOR_ORIGEM); if (origemEl && !reduzido) marcarOrigem(origemEl);
      const btn = alvo.closest('.btn') as HTMLElement | null;
      if (!btn || btn.hasAttribute('disabled') || reduzido) return;
      const r = btn.getBoundingClientRect(); const s = document.createElement('span'); s.className = 'ripple';
      s.style.left = `${e.clientX - r.left}px`; s.style.top = `${e.clientY - r.top}px`; btn.appendChild(s);
      const raio = Math.max(r.width, r.height) * 1.2;
      gsap.fromTo(s, { scale: 0, opacity: 0.22 }, { scale: raio / 12, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => s.remove() });
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return null;
}

/** Entrada de um cartao ou slide: sobe e aparece; os filhos em cascata. */
export function useEntrada(ref: React.RefObject<HTMLElement | null>, chave: string | number = 0) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el || reduzMovimento()) return;
    const filhos = Array.from(el.children);
    const tl = gsap.timeline({ defaults: { ease: FACIL } });
    tl.fromTo(el, { autoAlpha: 0, y: 26, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, clearProps: 'transform' })
      .fromTo(filhos, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.06, clearProps: 'transform,opacity,visibility' }, '-=0.35');
    // limpeza explicita (kill + clearProps): um estado "from" nunca pode sobrar no elemento, seja qual for a ordem dos efeitos
    return () => { tl.kill(); limpar([el, ...filhos]); };
  }, [ref, chave]);
}

// cena three.js carregada sob demanda (chunk separado): so quem chega ao login/carregamento/apresentacao paga o download
const Cena3D = React.lazy(() => import('./Cena3D'));
export function CenaEstrutura({ variante }: { variante: 'login' | 'carregando' | 'apresentacao' }) {
  return <Suspense fallback={null}><Cena3D variante={variante} /></Suspense>;
}
