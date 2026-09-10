// Sistema de movimento do EIFF Control (GSAP): revelacao em cascata ao trocar de tela, contadores de KPI, indicador do
// menu que desliza, ondulacao ao clicar, barras que crescem. Tudo respeita prefers-reduced-motion e nunca muda o conteudo:
// os numeros finais sao sempre os do motor; a animacao so percorre o caminho ate eles.
import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { decomporNumero, ehTextoNaoNumerico, recomporNumero, reduzMovimento } from './numero';

export const FACIL = 'power3.out';

/** Revela os blocos de uma tela em cascata (blocos de primeiro nivel e os cartoes de grades/faixas). */
export function useRevelar(ref: React.RefObject<HTMLElement | null>, chave: string) {
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz || reduzMovimento()) return;
    const alvos: Element[] = [];
    for (const filho of Array.from(raiz.children)) {
      if (filho.classList.contains('print-only')) continue;
      if (filho.classList.contains('hero-grid') || filho.classList.contains('grid') || filho.classList.contains('strip')) alvos.push(...Array.from(filho.children));
      else alvos.push(filho);
    }
    if (!alvos.length) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(alvos, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: FACIL, stagger: { each: 0.035, from: 'start' }, clearProps: 'transform,opacity,visibility', overwrite: 'auto' });
    }, raiz);
    return () => ctx.revert();
  }, [ref, chave]);
}

/** Numero formatado que "conta" ate o valor final (e do valor anterior ao novo quando o dado muda). */
export function NumeroVivo({ texto, className, duracao = 0.9 }: { texto: string; className?: string; duracao?: number }) {
  const ref = useRef<HTMLSpanElement>(null); const anterior = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const d = decomporNumero(texto);
    if (!d || reduzMovimento() || ehTextoNaoNumerico(texto)) { el.textContent = texto; anterior.current = d?.valor ?? null; return; }
    const de = anterior.current ?? 0; anterior.current = d.valor;
    if (de === d.valor) { el.textContent = texto; return; }
    const obj = { v: de }; el.textContent = recomporNumero(d, de);
    const tw = gsap.to(obj, { v: d.valor, duration: duracao, ease: 'power2.out', onUpdate: () => { el.textContent = recomporNumero(d, obj.v); }, onComplete: () => { el.textContent = texto; } });
    return () => { tw.kill(); el.textContent = texto; };
  }, [texto, duracao]);
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

/** Ondulacao discreta ao clicar em qualquer botao (delegado no documento). */
export function MicroInteracoes() {
  useLayoutEffect(() => {
    if (reduzMovimento()) return;
    const onDown = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.btn') as HTMLElement | null;
      if (!btn || btn.hasAttribute('disabled')) return;
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

/** Entrada de um cartao (login, avisos): sobe e aparece; os filhos em cascata. */
export function useEntrada(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el || reduzMovimento()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: FACIL } });
      tl.fromTo(el, { autoAlpha: 0, y: 26, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, clearProps: 'transform' })
        .fromTo(Array.from(el.children), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.06, clearProps: 'transform,opacity,visibility' }, '-=0.35');
    }, el);
    return () => ctx.revert();
  }, [ref]);
}

// cena three.js carregada sob demanda (chunk separado): so quem chega ao login/carregamento paga o download
const Cena3D = React.lazy(() => import('./Cena3D'));
export function CenaEstrutura({ variante }: { variante: 'login' | 'carregando' }) {
  return <Suspense fallback={null}><Cena3D variante={variante} /></Suspense>;
}
