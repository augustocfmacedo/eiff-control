// Cena three.js de assinatura: o esqueleto de um galpao em estrutura metalica (porticos, tercas, contraventamentos) em
// wireframe no laranja da marca sobre a grade grafite, que se "monta" segmento a segmento e responde ao ponteiro.
// Leve (linhas e pontos, sem luzes nem texturas), DPR limitado a 2, pausa quando a aba esta oculta, dispose ao desmontar.
// Com prefers-reduced-motion a estrutura aparece pronta e parada.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { reduzMovimento } from './numero';

export type VarianteCena = 'login' | 'carregando';

/** Segmentos (pares de vertices) e nos da estrutura, na ordem em que se montam: porticos, tercas/beirais, contraventamentos. */
function estrutura(): { segmentos: THREE.Vector3[]; nos: THREE.Vector3[] } {
  const segmentos: THREE.Vector3[] = []; const nos: THREE.Vector3[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const liga = (a: THREE.Vector3, b: THREE.Vector3) => { segmentos.push(a, b); };
  const nPorticos = 7, vao = 12, altura = 4.2, cumeeira = 6.1, passo = 4.2;
  const z0 = -((nPorticos - 1) * passo) / 2;
  const cobertura: THREE.Vector3[][] = []; const bases: THREE.Vector3[][] = [];
  for (let i = 0; i < nPorticos; i++) {
    const z = z0 + i * passo;
    const be = V(-vao / 2, 0, z), te = V(-vao / 2, altura, z), bd = V(vao / 2, 0, z), td = V(vao / 2, altura, z), c = V(0, cumeeira, z);
    liga(be, te); liga(bd, td); liga(te, c); liga(td, c);
    const linha = [te, ...[0.25, 0.5, 0.75].map((k) => te.clone().lerp(c, k)), c, ...[0.25, 0.5, 0.75].map((k) => c.clone().lerp(td, k)), td];
    cobertura.push(linha); bases.push([be, bd]); nos.push(be, te, bd, td, c);
  }
  for (let i = 0; i < nPorticos - 1; i++) {
    for (let k = 0; k < cobertura[i].length; k++) liga(cobertura[i][k], cobertura[i + 1][k]); // tercas e vigas de beiral
    liga(bases[i][0], bases[i + 1][0]); liga(bases[i][1], bases[i + 1][1]); // baldrame
  }
  for (const i of [0, nPorticos - 2]) { // contraventamento em X nos vaos de extremidade: cobertura e paredes
    const a = cobertura[i], b = cobertura[i + 1];
    liga(a[0], b[4]); liga(a[4], b[0]); liga(a[4], b[8]); liga(a[8], b[4]);
    liga(bases[i][0], b[0]); liga(a[0], bases[i + 1][0]); liga(bases[i][1], b[8]); liga(a[8], bases[i + 1][1]);
  }
  return { segmentos, nos };
}

export default function Cena3D({ variante = 'login' }: { variante?: VarianteCena }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    const estatico = reduzMovimento();
    const css = getComputedStyle(document.documentElement);
    const cor = (v: string, padrao: string) => css.getPropertyValue(v).trim() || padrao;
    const marca = new THREE.Color(cor('--brand', '#d1481c')); const grafite = new THREE.Color(cor('--border-strong', '#363d48')); const fundo = new THREE.Color(cor('--bg', '#0e1013'));
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return; } // sem WebGL: nada a fazer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(fundo, 16, 58);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    const { segmentos, nos } = estrutura();
    const pos = new Float32Array(segmentos.length * 3); segmentos.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const matLinhas = new THREE.LineBasicMaterial({ color: marca, transparent: true, opacity: 0.82 });
    const linhas = new THREE.LineSegments(geo, matLinhas);
    const geoNos = new THREE.BufferGeometry().setFromPoints(nos);
    const matNos = new THREE.PointsMaterial({ color: marca, size: 0.12, transparent: true, opacity: 0.9, sizeAttenuation: true });
    const pontos = new THREE.Points(geoNos, matNos);
    const grade = new THREE.GridHelper(70, 35, grafite, grafite); const matGrade = grade.material as THREE.Material; matGrade.transparent = true; matGrade.opacity = 0.32;
    const grupo = new THREE.Group(); grupo.add(linhas, pontos); scene.add(grupo, grade);
    const total = segmentos.length; geo.setDrawRange(0, estatico ? total : 0);
    let alvoX = 0, alvoY = 0, mx = 0, my = 0;
    const onMove = (e: PointerEvent) => { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; alvoX = (e.clientX - r.left) / r.width - 0.5; alvoY = (e.clientY - r.top) / r.height - 0.5; };
    window.addEventListener('pointermove', onMove, { passive: true });
    const resize = () => { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();
    const raio = variante === 'login' ? 33 : 30; const alturaCam = variante === 'login' ? 10 : 11;
    let raf = 0; let rodando = false; let t0 = performance.now(); let acumulado = 0;
    const quadro = () => {
      const t = acumulado + (performance.now() - t0) / 1000;
      if (!estatico) { const f = Math.min(1, t / 3.4); const e = 1 - Math.pow(1 - f, 3); geo.setDrawRange(0, Math.floor(e * total)); matNos.opacity = 0.9 * e; }
      mx += (alvoX - mx) * 0.06; my += (alvoY - my) * 0.06;
      const ang = 0.55 + (estatico ? 0 : t * 0.05) + mx * 0.45;
      camera.position.set(Math.sin(ang) * raio, alturaCam - my * 4, Math.cos(ang) * raio); camera.lookAt(0, 2.6, 0);
      renderer.render(scene, camera);
      if (!estatico) raf = requestAnimationFrame(quadro); else rodando = false;
    };
    const iniciar = () => { if (rodando) return; rodando = true; t0 = performance.now(); raf = requestAnimationFrame(quadro); };
    const parar = () => { if (!rodando) return; acumulado += (performance.now() - t0) / 1000; cancelAnimationFrame(raf); rodando = false; };
    const onVis = () => { if (document.visibilityState === 'visible') iniciar(); else parar(); };
    document.addEventListener('visibilitychange', onVis);
    if (estatico) { quadro(); } else iniciar();
    return () => {
      parar(); ro.disconnect(); window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      geo.dispose(); geoNos.dispose(); matLinhas.dispose(); matNos.dispose(); grade.geometry.dispose(); matGrade.dispose(); renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, [variante]);
  return <div ref={ref} className={`cena3d cena3d-${variante}`} aria-hidden="true" />;
}
